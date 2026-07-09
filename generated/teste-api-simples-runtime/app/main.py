import asyncio
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.orm import Session

from app import repo
from app.auth import (
    AgentAuthAuditLog,
    AgentRateLimiter,
    authenticate_agent_api_key,
    describe_agent_auth_keys,
    require_agent_scope,
    require_agent_scope_from_header_or_query,
)
from app.cache import build_cache
from app.db import get_session, init_db, session_scope
from app.generated_flow import AGENT_ID, API_CONTRACT, API_RESOURCE, FLOW_ID, FLOW_NAME, FLOW_VERSION
from app.graph import build_checkpointer, build_graph
from app.idempotency import normalize_idempotency_key, run_idempotent
from app.llm import LLMClient
from app.safety import SafetyGate
from app.schemas import (
    CreateSessionRequest,
    CreateSessionResponse,
    EmptyIdempotentRequest,
    EventJobScheduleTriggerRequest,
    EventView,
    FinishResponse,
    JobBatchResponse,
    JobCleanupRequest,
    JobCleanupResponse,
    JobMetricsResponse,
    JobRunResponse,
    JobScheduleBatchResponse,
    JobScheduleRequest,
    JobScheduleResponse,
    JobScheduleView,
    JobView,
    MessageView,
    MetadataResponse,
    RecurringJobScheduleRequest,
    SessionView,
    StartResponse,
    TurnRequest,
    TurnResponse,
)
from app.service import ReferenceAgentService
from app.settings import get_settings


logger = logging.getLogger(__name__)


def _format_sse(event: str, data: dict[str, Any], event_id: int | None = None) -> str:
    lines: list[str] = []
    if event_id is not None:
        lines.append(f"id: {event_id}")
    lines.append(f"event: {event}")
    encoded = json.dumps(data, ensure_ascii=False, default=str)
    for line in encoded.splitlines() or [""]:
        lines.append(f"data: {line}")
    return "\n".join(lines) + "\n\n"


async def _accept_websocket_or_close(websocket: WebSocket, required_scope: str = "sessions:read") -> bool:
    settings = websocket.app.state.settings
    if settings.auth_enabled:
        token = (websocket.headers.get("x-agent-api-key") or websocket.query_params.get("api_key") or "").strip()
        try:
            context = authenticate_agent_api_key(settings, token, required_scope)
            websocket.app.state.auth_rate_limiter.check(settings, context, scope=required_scope)
            if settings.auth_audit_enabled:
                websocket.app.state.auth_audit.record(
                    request=None,
                    context=context,
                    scope=required_scope,
                    status="allowed",
                )
        except HTTPException as exc:
            if settings.auth_audit_enabled:
                websocket.app.state.auth_audit.record(
                    request=None,
                    context=None,
                    scope=required_scope,
                    status="rejected",
                    reason=str(exc.detail),
                )
            await websocket.close(code=1008, reason="invalid_api_key")
            return False
    await websocket.accept()
    return True


def _stream_closed_payload(reason: str, session_id: str, next_seq: int, sent: int) -> dict[str, Any]:
    return {"reason": reason, "session_id": session_id, "next_seq": next_seq, "sent": sent}


def _turn_token_payload(index: int, text: str, source: str) -> dict[str, Any]:
    return {"index": index, "text": text, "source": source}


def _iter_turn_tokens(text: str, source: str = "assistant_message"):
    chunks = re.findall(r"\S+\s*", text)
    for index, chunk in enumerate(chunks or [text]):
        if chunk:
            yield _turn_token_payload(index + 1, chunk, source)


def _split_configured_statuses(value: str) -> list[str]:
    return [item.strip() for item in str(value or "").split(",") if item.strip()]


def _operations_metadata(settings: Any) -> dict[str, Any]:
    cleanup_statuses = _split_configured_statuses(settings.worker_cleanup_statuses) or ["succeeded", "failed"]
    return {
        "jobs": {
            "enabled": True,
            "manual_cleanup_endpoint": "POST /jobs/cleanup",
            "worker": {
                "command": "python -m app.worker",
                "interval_seconds": settings.worker_interval_seconds,
                "limit": settings.worker_limit,
                "retry_delay_seconds": settings.worker_retry_delay_seconds,
                "lease_seconds": settings.worker_lease_seconds,
                "multiworker_claims": True,
            },
            "retention": {
                "automatic_cleanup_enabled": settings.worker_cleanup_enabled,
                "older_than_hours": settings.worker_cleanup_older_than_hours,
                "limit": settings.worker_cleanup_limit,
                "statuses": cleanup_statuses,
                "dry_run_default": True,
                "terminal_statuses": ["failed", "succeeded"],
            },
            "schedules": {
                "interval": True,
                "cron": "basic",
                "event": True,
            },
        }
    }


def create_app() -> FastAPI:
    settings = get_settings()
    logging.basicConfig(level=settings.log_level)
    if settings.auto_create_tables:
        init_db()

    cache = build_cache(settings)
    llm_client = LLMClient(settings)
    safety_gate = SafetyGate()
    checkpointer = build_checkpointer(settings)
    graph = build_graph(
        settings=settings,
        llm_client=llm_client,
        safety_gate=safety_gate,
        checkpointer=checkpointer,
    )
    service = ReferenceAgentService(settings=settings, graph=graph, cache=cache)

    app = FastAPI(title=FLOW_NAME)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.settings = settings
    app.state.cache = cache
    app.state.service = service
    app.state.auth_rate_limiter = AgentRateLimiter()
    app.state.auth_audit = AgentAuthAuditLog(settings.auth_audit_max_entries, settings.auth_audit_path)

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        logger.exception("Erro não tratado em %s", request.url.path)
        return JSONResponse(status_code=500, content={"detail": "Erro interno no agente."})

    @app.get("/health")
    def health(db: Session = Depends(get_session)):
        db_ok = repo.check_db_health(db)
        try:
            cache_ok = bool(cache.ping())
        except Exception:
            cache_ok = False
        return {
            "status": "ok" if db_ok and cache_ok else "degraded",
            "db_ok": db_ok,
            "cache_ok": cache_ok,
        }

    @app.get(
        "/metadata",
        response_model=MetadataResponse,
        dependencies=[Depends(require_agent_scope("metadata:read"))],
    )
    def metadata():
        return {
            "service": settings.service_name,
            "runtime": "langgraph-fastapi-python",
            "contract": API_CONTRACT,
            "flow_id": FLOW_ID,
            "agent_id": AGENT_ID,
            "flow_version": FLOW_VERSION,
            "llm_adapter": settings.llm_adapter,
            "supports_multi_agent_bundle": False,
            "operations": _operations_metadata(settings),
        }

    @app.get(
        "/auth/audit",
        dependencies=[Depends(require_agent_scope("metadata:read"))],
    )
    def auth_audit(limit: int = Query(default=100, ge=1, le=500)):
        audit = app.state.auth_audit
        return {
            "enabled": settings.auth_audit_enabled,
            "persistent": audit.persistent,
            "path": audit.path or None,
            "total": audit.total,
            "entries": audit.list_entries(limit),
        }

    @app.get(
        "/auth/keys",
        dependencies=[Depends(require_agent_scope("auth:read"))],
    )
    def auth_keys():
        return describe_agent_auth_keys(settings)

    def idempotency_key(header: str | None, body_key: str | None) -> str:
        return normalize_idempotency_key(header, body_key)

    def operation_name(request: Request, method: str, path_template: str) -> str:
        root_path = (request.scope.get("root_path") or "").rstrip("/")
        return f"{method} {root_path}{path_template}"

    @app.post(
        f"/{API_RESOURCE}",
        response_model=CreateSessionResponse,
        dependencies=[Depends(require_agent_scope("sessions:write"))],
    )
    def create_session(
        request: Request,
        payload: CreateSessionRequest,
        db: Session = Depends(get_session),
        header_idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ):
        key = idempotency_key(header_idempotency_key, payload.idempotency_key)
        request_payload = payload.model_dump(mode="json")
        return run_idempotent(
            db,
            operation=operation_name(request, "POST", f"/{API_RESOURCE}"),
            idempotency_key=key,
            payload=request_payload,
            handler=lambda: app.state.service.create_session(
                db,
                metadata=payload.metadata,
                max_turns=payload.max_turns,
                auto_start=payload.auto_start,
            ),
        )

    @app.get(
        f"/{API_RESOURCE}/{{session_id}}",
        response_model=SessionView,
        dependencies=[Depends(require_agent_scope("sessions:read"))],
    )
    def get_session_view(session_id: str, db: Session = Depends(get_session)):
        return app.state.service.get_session(db, session_id)

    @app.post(
        f"/{API_RESOURCE}/{{session_id}}/start",
        response_model=StartResponse,
        dependencies=[Depends(require_agent_scope("sessions:write"))],
    )
    def start_session(
        request: Request,
        session_id: str,
        payload: EmptyIdempotentRequest,
        db: Session = Depends(get_session),
        header_idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ):
        key = idempotency_key(header_idempotency_key, payload.idempotency_key)
        request_payload: dict[str, Any] = {"session_id": session_id, **payload.model_dump(mode="json")}
        return run_idempotent(
            db,
            operation=operation_name(request, "POST", f"/{API_RESOURCE}/{{session_id}}/start"),
            idempotency_key=key,
            payload=request_payload,
            handler=lambda: app.state.service.start_session(db, session_id),
        )

    @app.post(
        f"/{API_RESOURCE}/{{session_id}}/turn",
        response_model=TurnResponse,
        dependencies=[Depends(require_agent_scope("sessions:write"))],
    )
    def turn_session(
        request: Request,
        session_id: str,
        payload: TurnRequest,
        db: Session = Depends(get_session),
        header_idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ):
        key = idempotency_key(header_idempotency_key, payload.idempotency_key)
        request_payload: dict[str, Any] = {"session_id": session_id, **payload.model_dump(mode="json")}
        return run_idempotent(
            db,
            operation=operation_name(request, "POST", f"/{API_RESOURCE}/{{session_id}}/turn"),
            idempotency_key=key,
            payload=request_payload,
            handler=lambda: app.state.service.process_turn(db, session_id, payload.user_message),
        )

    @app.post(
        f"/{API_RESOURCE}/{{session_id}}/turn/stream",
        dependencies=[Depends(require_agent_scope("sessions:write"))],
    )
    async def turn_session_stream(
        request: Request,
        session_id: str,
        payload: TurnRequest,
        header_idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ):
        key = idempotency_key(header_idempotency_key, payload.idempotency_key)
        request_payload: dict[str, Any] = {"session_id": session_id, **payload.model_dump(mode="json")}
        turn_operation = operation_name(request, "POST", f"/{API_RESOURCE}/{{session_id}}/turn")

        async def turn_event_generator():
            token_queue: asyncio.Queue[str | None] = asyncio.Queue()
            result: dict[str, Any] = {}
            error: dict[str, Any] = {}
            loop = asyncio.get_running_loop()
            sent = 0
            token_index = 0

            def token_callback(chunk: str):
                if chunk:
                    loop.call_soon_threadsafe(token_queue.put_nowait, str(chunk))

            def run_turn_in_thread() -> None:
                try:
                    with session_scope() as scoped_db:
                        result["response"] = run_idempotent(
                            scoped_db,
                            operation=turn_operation,
                            idempotency_key=key,
                            payload=request_payload,
                            handler=lambda: app.state.service.process_turn(
                                scoped_db,
                                session_id,
                                payload.user_message,
                                token_callback=token_callback,
                            ),
                        )
                except HTTPException as exc:
                    error["value"] = {"status_code": exc.status_code, "detail": exc.detail}
                except Exception as exc:
                    error["value"] = {"status_code": 500, "detail": str(exc)}
                finally:
                    loop.call_soon_threadsafe(token_queue.put_nowait, None)

            yield _format_sse("turn_started", {"session_id": session_id, "idempotency_key": key})

            worker = asyncio.create_task(asyncio.to_thread(run_turn_in_thread))
            try:
                while True:
                    token_or_done = await token_queue.get()
                    if token_or_done is None:
                        break
                    token_index += 1
                    sent += 1
                    yield _format_sse(
                        "token",
                        _turn_token_payload(token_index, str(token_or_done), "llm_callback"),
                    )
                    await asyncio.sleep(0)

                await worker
            except asyncio.CancelledError:
                worker.cancel()
                raise

            if "value" in error:
                yield _format_sse("turn_error", error["value"])
                yield _format_sse("stream_closed", _stream_closed_payload("error", session_id, 0, sent))
                return

            response = result.get("response") or {}
            assistant = response.get("assistant_message") or {}
            if sent == 0:
                for token_payload in _iter_turn_tokens(str(assistant.get("text") or "")):
                    sent += 1
                    yield _format_sse("token", token_payload)
                    await asyncio.sleep(0)
            yield _format_sse("turn_completed", response)
            yield _format_sse("stream_closed", _stream_closed_payload("turn_completed", session_id, 0, sent))

        return StreamingResponse(
            turn_event_generator(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.websocket(
        f"/{API_RESOURCE}/{{session_id}}/turn/stream/ws"
    )
    async def websocket_turn_session_stream(
        websocket: WebSocket,
        session_id: str,
        user_message: str = Query(..., alias="user_message"),
        query_idempotency_key: str | None = Query(default=None, alias="idempotency_key"),
        payload_idempotency_key: str | None = Query(default=None, alias="payload.idempotency_key"),
    ):
        if not await _accept_websocket_or_close(websocket, "sessions:write"):
            return

        key = idempotency_key(header=query_idempotency_key, body_key=payload_idempotency_key)
        request_payload: dict[str, Any] = {
            "session_id": session_id,
            "user_message": user_message,
            "idempotency_key": key,
        }
        turn_operation = f"POST /{API_RESOURCE}/{{session_id}}/turn"
        token_queue: asyncio.Queue[str | None] = asyncio.Queue()
        result: dict[str, Any] = {}
        error: dict[str, Any] = {}
        loop = asyncio.get_running_loop()
        sent = 0
        token_index = 0

        def token_callback(chunk: str):
            if chunk:
                loop.call_soon_threadsafe(token_queue.put_nowait, str(chunk))

        def run_turn_in_thread() -> None:
            try:
                with session_scope() as scoped_db:
                    result["response"] = run_idempotent(
                        scoped_db,
                        operation=turn_operation,
                        idempotency_key=key,
                        payload={"session_id": session_id, "user_message": user_message, "idempotency_key": key},
                        handler=lambda: app.state.service.process_turn(
                            scoped_db,
                            session_id,
                            user_message,
                            token_callback=token_callback,
                        ),
                    )
            except HTTPException as exc:
                error["value"] = {"status_code": exc.status_code, "detail": exc.detail}
            except Exception as exc:
                error["value"] = {"status_code": 500, "detail": str(exc)}
            finally:
                loop.call_soon_threadsafe(token_queue.put_nowait, None)

        await websocket.send_json({"event": "turn_started", "data": {"session_id": session_id, "idempotency_key": key}})

        worker = asyncio.create_task(asyncio.to_thread(run_turn_in_thread))
        try:
            while True:
                token_or_done = await token_queue.get()
                if token_or_done is None:
                    break
                token = str(token_or_done)
                token_index += 1
                sent += 1
                await websocket.send_json(
                    {"event": "token", "data": _turn_token_payload(token_index, token, "llm_callback")}
                )

            await worker
            if "value" in error:
                await websocket.send_json({"event": "turn_error", "data": error["value"]})
                await websocket.send_json({"event": "stream_closed", "data": _stream_closed_payload("error", session_id, 0, sent)})
                await websocket.close(code=4000, reason="turn_error")
                return

            response = result.get("response") or {}
            if sent == 0:
                assistant = response.get("assistant_message") or {}
                for token_payload in _iter_turn_tokens(str(assistant.get("text") or "")):
                    sent += 1
                    await websocket.send_json({"event": "token", "data": token_payload})
            await websocket.send_json({"event": "turn_completed", "data": response})
            await websocket.send_json({"event": "stream_closed", "data": _stream_closed_payload("turn_completed", session_id, 0, sent)})
            await websocket.close(code=1000, reason="turn_completed")
        except WebSocketDisconnect:
            worker.cancel()
            return

    @app.post(
        f"/{API_RESOURCE}/{{session_id}}/finish",
        response_model=FinishResponse,
        dependencies=[Depends(require_agent_scope("sessions:write"))],
    )
    def finish_session(
        request: Request,
        session_id: str,
        payload: EmptyIdempotentRequest,
        db: Session = Depends(get_session),
        header_idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ):
        key = idempotency_key(header_idempotency_key, payload.idempotency_key)
        request_payload: dict[str, Any] = {"session_id": session_id, **payload.model_dump(mode="json")}
        return run_idempotent(
            db,
            operation=operation_name(request, "POST", f"/{API_RESOURCE}/{{session_id}}/finish"),
            idempotency_key=key,
            payload=request_payload,
            handler=lambda: app.state.service.finish_session(db, session_id),
        )

    @app.get(
        f"/{API_RESOURCE}/{{session_id}}/transcript",
        response_model=list[MessageView],
        dependencies=[Depends(require_agent_scope("sessions:read"))],
    )
    def transcript(
        session_id: str,
        from_seq: int | None = Query(default=None, alias="from_seq"),
        db: Session = Depends(get_session),
    ):
        return app.state.service.transcript(db, session_id, from_seq=from_seq)

    @app.get(
        f"/{API_RESOURCE}/{{session_id}}/events",
        response_model=list[EventView],
        dependencies=[Depends(require_agent_scope("sessions:read"))],
    )
    def events(
        session_id: str,
        from_seq: int | None = Query(default=None, alias="from_seq"),
        db: Session = Depends(get_session),
    ):
        return app.state.service.events(db, session_id, from_seq=from_seq)

    @app.get(
        "/jobs",
        response_model=list[JobView],
        dependencies=[Depends(require_agent_scope("jobs:read"))],
    )
    def jobs(
        session_id: str | None = Query(default=None),
        status: str | None = Query(default=None),
        db: Session = Depends(get_session),
    ):
        return app.state.service.jobs(db, session_id=session_id, status=status)

    @app.get(
        "/jobs/metrics",
        response_model=JobMetricsResponse,
        dependencies=[Depends(require_agent_scope("jobs:read"))],
    )
    def job_metrics(
        window_hours: float = Query(default=1.0, ge=0.0, le=8760.0),
        db: Session = Depends(get_session),
    ):
        return app.state.service.job_metrics(db, window_hours=window_hours)

    @app.post(
        "/jobs/cleanup",
        response_model=JobCleanupResponse,
        dependencies=[Depends(require_agent_scope("jobs:write"))],
    )
    def cleanup_jobs(payload: JobCleanupRequest, db: Session = Depends(get_session)):
        return app.state.service.cleanup_jobs(
            db,
            statuses=payload.statuses,
            older_than_hours=payload.older_than_hours,
            session_id=payload.session_id,
            limit=payload.limit,
            dry_run=payload.dry_run,
        )

    @app.post(
        "/jobs/run-pending",
        response_model=JobBatchResponse,
        dependencies=[Depends(require_agent_scope("jobs:write"))],
    )
    def run_pending_jobs(
        session_id: str | None = Query(default=None),
        limit: int = Query(default=50, ge=1, le=200),
        worker_id: str | None = Query(default=None, max_length=120),
        lease_seconds: float = Query(default=60.0, ge=1.0, le=86400.0),
        db: Session = Depends(get_session),
    ):
        return app.state.service.run_pending_jobs(
            db,
            session_id=session_id,
            limit=limit,
            worker_id=worker_id,
            lease_seconds=lease_seconds,
        )

    @app.post(
        "/jobs/retry-failed",
        response_model=JobBatchResponse,
        dependencies=[Depends(require_agent_scope("jobs:write"))],
    )
    def retry_failed_jobs(
        session_id: str | None = Query(default=None),
        limit: int = Query(default=50, ge=1, le=200),
        db: Session = Depends(get_session),
    ):
        return app.state.service.retry_failed_jobs(db, session_id=session_id, limit=limit)

    @app.get(
        "/jobs/{job_id}",
        response_model=JobView,
        dependencies=[Depends(require_agent_scope("jobs:read"))],
    )
    def get_job(job_id: str, db: Session = Depends(get_session)):
        return app.state.service.get_job(db, job_id)

    @app.post(
        "/jobs/{job_id}/run",
        response_model=JobRunResponse,
        dependencies=[Depends(require_agent_scope("jobs:write"))],
    )
    def run_job(job_id: str, db: Session = Depends(get_session)):
        return app.state.service.run_job(db, job_id)

    @app.post(
        "/jobs/{job_id}/retry",
        response_model=JobRunResponse,
        dependencies=[Depends(require_agent_scope("jobs:write"))],
    )
    def retry_job(job_id: str, db: Session = Depends(get_session)):
        return app.state.service.retry_job(db, job_id)

    @app.post(
        "/jobs/{job_id}/schedule",
        response_model=JobRunResponse,
        dependencies=[Depends(require_agent_scope("jobs:write"))],
    )
    def schedule_job(job_id: str, payload: JobScheduleRequest, db: Session = Depends(get_session)):
        run_at = payload.run_at
        if run_at is None:
            run_at = datetime.now(timezone.utc) + timedelta(seconds=max(0.0, float(payload.delay_seconds or 0.0)))
        return app.state.service.schedule_job(db, job_id, run_at)

    @app.get(
        "/job-schedules",
        response_model=list[JobScheduleView],
        dependencies=[Depends(require_agent_scope("jobs:read"))],
    )
    def job_schedules(
        session_id: str | None = Query(default=None),
        status: str | None = Query(default=None),
        db: Session = Depends(get_session),
    ):
        return app.state.service.job_schedules(db, session_id=session_id, status=status)

    @app.post(
        "/jobs/{job_id}/recurrence",
        response_model=JobScheduleResponse,
        dependencies=[Depends(require_agent_scope("jobs:write"))],
    )
    def create_job_recurrence(
        job_id: str,
        payload: RecurringJobScheduleRequest,
        db: Session = Depends(get_session),
    ):
        return app.state.service.create_job_recurrence(
            db,
            job_id,
            interval_seconds=payload.interval_seconds,
            trigger_type=payload.trigger_type,
            cron_expression=payload.cron_expression,
            event_type=payload.event_type,
            run_at=payload.run_at,
            delay_seconds=payload.delay_seconds,
        )

    @app.post(
        "/job-schedules/trigger-event",
        response_model=JobScheduleBatchResponse,
        dependencies=[Depends(require_agent_scope("jobs:write"))],
    )
    def trigger_event_job_schedules(payload: EventJobScheduleTriggerRequest, db: Session = Depends(get_session)):
        return app.state.service.trigger_event_job_schedules(
            db,
            event_type=payload.event_type,
            session_id=payload.session_id,
            payload=payload.payload,
            limit=payload.limit,
        )

    @app.post(
        "/job-schedules/run-due",
        response_model=JobScheduleBatchResponse,
        dependencies=[Depends(require_agent_scope("jobs:write"))],
    )
    def run_due_job_schedules(limit: int = Query(default=20, ge=1, le=200), db: Session = Depends(get_session)):
        return app.state.service.run_due_job_schedules(db, limit=limit)

    @app.post(
        "/job-schedules/{schedule_id}/disable",
        response_model=JobScheduleResponse,
        dependencies=[Depends(require_agent_scope("jobs:write"))],
    )
    def disable_job_schedule(schedule_id: str, db: Session = Depends(get_session)):
        return app.state.service.disable_job_schedule(db, schedule_id)

    @app.get(
        f"/{API_RESOURCE}/{{session_id}}/events/stream",
        dependencies=[Depends(require_agent_scope_from_header_or_query("sessions:read"))],
    )
    async def stream_events(
        session_id: str,
        from_seq: int | None = Query(default=None, alias="from_seq"),
        poll_seconds: float = Query(default=0.5, ge=0.1, le=5.0),
        timeout_seconds: float = Query(default=30.0, ge=0.0, le=300.0),
        max_events: int = Query(default=200, ge=1, le=1000),
        end_after_complete: bool = Query(default=True),
        db: Session = Depends(get_session),
    ):
        app.state.service.get_session(db, session_id)

        async def event_generator():
            next_seq = max(1, int(from_seq or 1))
            sent = 0
            loop = asyncio.get_running_loop()
            deadline = None if timeout_seconds <= 0 else loop.time() + timeout_seconds
            while True:
                batch = app.state.service.events(db, session_id, from_seq=next_seq)
                for event in batch:
                    seq = int(event.get("seq") or next_seq)
                    next_seq = max(next_seq, seq + 1)
                    sent += 1
                    yield _format_sse("agent_event", event, seq)
                    if sent >= max_events:
                        yield _format_sse("stream_closed", _stream_closed_payload("max_events", session_id, next_seq, sent))
                        return

                session = app.state.service.get_session(db, session_id)
                if end_after_complete and session.get("is_complete") and not batch:
                    yield _format_sse("stream_closed", _stream_closed_payload("session_complete", session_id, next_seq, sent))
                    return
                if deadline is not None and loop.time() >= deadline:
                    yield _format_sse("stream_closed", _stream_closed_payload("timeout", session_id, next_seq, sent))
                    return
                await asyncio.sleep(poll_seconds)

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.websocket(f"/{API_RESOURCE}/{{session_id}}/events/ws")
    async def websocket_events(
        websocket: WebSocket,
        session_id: str,
        from_seq: int | None = Query(default=None, alias="from_seq"),
        poll_seconds: float = Query(default=0.5, ge=0.1, le=5.0),
        timeout_seconds: float = Query(default=30.0, ge=0.0, le=300.0),
        max_events: int = Query(default=200, ge=1, le=1000),
        end_after_complete: bool = Query(default=True),
    ):
        if not await _accept_websocket_or_close(websocket):
            return

        next_seq = max(1, int(from_seq or 1))
        sent = 0
        loop = asyncio.get_running_loop()
        deadline = None if timeout_seconds <= 0 else loop.time() + timeout_seconds
        try:
            with session_scope() as db:
                app.state.service.get_session(db, session_id)
        except Exception:
            await websocket.send_json(
                {"event": "stream_closed", "data": _stream_closed_payload("session_not_found", session_id, next_seq, sent)}
            )
            await websocket.close(code=1008, reason="session_not_found")
            return

        try:
            while True:
                with session_scope() as db:
                    batch = app.state.service.events(db, session_id, from_seq=next_seq)
                    session = app.state.service.get_session(db, session_id)

                for event in batch:
                    seq = int(event.get("seq") or next_seq)
                    next_seq = max(next_seq, seq + 1)
                    sent += 1
                    await websocket.send_json({"event": "agent_event", "id": seq, "data": event})
                    if sent >= max_events:
                        await websocket.send_json(
                            {"event": "stream_closed", "data": _stream_closed_payload("max_events", session_id, next_seq, sent)}
                        )
                        await websocket.close(code=1000, reason="max_events")
                        return

                if end_after_complete and session.get("is_complete") and not batch:
                    await websocket.send_json(
                        {
                            "event": "stream_closed",
                            "data": _stream_closed_payload("session_complete", session_id, next_seq, sent),
                        }
                    )
                    await websocket.close(code=1000, reason="session_complete")
                    return
                if deadline is not None and loop.time() >= deadline:
                    await websocket.send_json(
                        {"event": "stream_closed", "data": _stream_closed_payload("timeout", session_id, next_seq, sent)}
                    )
                    await websocket.close(code=1000, reason="timeout")
                    return
                await asyncio.sleep(poll_seconds)
        except WebSocketDisconnect:
            return

    return app


app = create_app()
