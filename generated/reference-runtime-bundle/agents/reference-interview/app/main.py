import logging
from typing import Any

from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app import repo
from app.auth import require_agent_api_key
from app.cache import build_cache
from app.db import get_session, init_db
from app.generated_flow import API_CONTRACT, API_RESOURCE, FLOW_ID, FLOW_NAME, FLOW_VERSION
from app.graph import build_checkpointer, build_graph
from app.idempotency import normalize_idempotency_key, run_idempotent
from app.llm import LLMClient
from app.safety import SafetyGate
from app.schemas import (
    CreateSessionRequest,
    CreateSessionResponse,
    EmptyIdempotentRequest,
    EventView,
    FinishResponse,
    MessageView,
    MetadataResponse,
    SessionView,
    StartResponse,
    TurnRequest,
    TurnResponse,
)
from app.service import ReferenceAgentService
from app.settings import get_settings


logger = logging.getLogger(__name__)


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

    @app.get("/metadata", response_model=MetadataResponse)
    def metadata():
        return {
            "service": settings.service_name,
            "runtime": "langgraph-fastapi-python",
            "contract": API_CONTRACT,
            "flow_id": FLOW_ID,
            "flow_version": FLOW_VERSION,
            "llm_adapter": settings.llm_adapter,
            "supports_multi_agent_bundle": False,
        }

    def idempotency_key(header: str | None, body_key: str | None) -> str:
        return normalize_idempotency_key(header, body_key)

    @app.post(
        f"/{API_RESOURCE}",
        response_model=CreateSessionResponse,
        dependencies=[Depends(require_agent_api_key)],
    )
    def create_session(
        payload: CreateSessionRequest,
        db: Session = Depends(get_session),
        header_idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ):
        key = idempotency_key(header_idempotency_key, payload.idempotency_key)
        request_payload = payload.model_dump(mode="json")
        return run_idempotent(
            db,
            operation=f"POST /{API_RESOURCE}",
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
        dependencies=[Depends(require_agent_api_key)],
    )
    def get_session_view(session_id: str, db: Session = Depends(get_session)):
        return app.state.service.get_session(db, session_id)

    @app.post(
        f"/{API_RESOURCE}/{{session_id}}/start",
        response_model=StartResponse,
        dependencies=[Depends(require_agent_api_key)],
    )
    def start_session(
        session_id: str,
        payload: EmptyIdempotentRequest,
        db: Session = Depends(get_session),
        header_idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ):
        key = idempotency_key(header_idempotency_key, payload.idempotency_key)
        request_payload: dict[str, Any] = {"session_id": session_id, **payload.model_dump(mode="json")}
        return run_idempotent(
            db,
            operation=f"POST /{API_RESOURCE}/{{session_id}}/start",
            idempotency_key=key,
            payload=request_payload,
            handler=lambda: app.state.service.start_session(db, session_id),
        )

    @app.post(
        f"/{API_RESOURCE}/{{session_id}}/turn",
        response_model=TurnResponse,
        dependencies=[Depends(require_agent_api_key)],
    )
    def turn_session(
        session_id: str,
        payload: TurnRequest,
        db: Session = Depends(get_session),
        header_idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ):
        key = idempotency_key(header_idempotency_key, payload.idempotency_key)
        request_payload: dict[str, Any] = {"session_id": session_id, **payload.model_dump(mode="json")}
        return run_idempotent(
            db,
            operation=f"POST /{API_RESOURCE}/{{session_id}}/turn",
            idempotency_key=key,
            payload=request_payload,
            handler=lambda: app.state.service.process_turn(db, session_id, payload.user_message),
        )

    @app.post(
        f"/{API_RESOURCE}/{{session_id}}/finish",
        response_model=FinishResponse,
        dependencies=[Depends(require_agent_api_key)],
    )
    def finish_session(
        session_id: str,
        payload: EmptyIdempotentRequest,
        db: Session = Depends(get_session),
        header_idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ):
        key = idempotency_key(header_idempotency_key, payload.idempotency_key)
        request_payload: dict[str, Any] = {"session_id": session_id, **payload.model_dump(mode="json")}
        return run_idempotent(
            db,
            operation=f"POST /{API_RESOURCE}/{{session_id}}/finish",
            idempotency_key=key,
            payload=request_payload,
            handler=lambda: app.state.service.finish_session(db, session_id),
        )

    @app.get(
        f"/{API_RESOURCE}/{{session_id}}/transcript",
        response_model=list[MessageView],
        dependencies=[Depends(require_agent_api_key)],
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
        dependencies=[Depends(require_agent_api_key)],
    )
    def events(
        session_id: str,
        from_seq: int | None = Query(default=None, alias="from_seq"),
        db: Session = Depends(get_session),
    ):
        return app.state.service.events(db, session_id, from_seq=from_seq)

    return app


app = create_app()
