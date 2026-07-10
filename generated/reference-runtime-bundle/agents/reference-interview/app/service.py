from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import repo
from app.cache import recent_key
from app.graph import (
    ANALYTICS_NODE_IDS,
    APPROVAL_GATE_NODE_IDS,
    CODE_NODE_IDS,
    CURRENT_DB_SESSION,
    CURRENT_EVENT_SINK,
    CURRENT_TOKEN_STREAM,
    DATABASE_QUERY_NODE_IDS,
    DATABASE_SAVE_NODE_IDS,
    FILE_EXTRACT_NODE_IDS,
    FINISH_NODE_IDS,
    HUMAN_INPUT_NODE_IDS,
    HTTP_REQUEST_NODE_IDS,
    INPUT_SAFETY_NODE_IDS,
    LLM_NODE_IDS,
    OUTPUT_SAFETY_NODE_IDS,
    RAG_RETRIEVAL_NODE_IDS,
    SCORING_NODE_IDS,
    START_NODE_IDS,
    SWITCH_NODE_IDS,
    TRANSFORM_JSON_NODE_IDS,
)
from app.generated_flow import AGENT_ID, FLOW_TRIGGERS
from app.models import AgentJob, AgentJobSchedule, AgentMessage, AgentSession
from app.settings import Settings


RECENT_LIMIT = 20


def session_view(row: AgentSession) -> dict[str, Any]:
    return {
        "session_id": row.session_id,
        "agent_id": row.agent_id,
        "status": row.status,
        "phase": row.phase,
        "turn": row.turn,
        "max_turns": row.max_turns,
        "metadata": row.metadata_json or {},
        "is_complete": row.status == "completed",
    }


def message_view(row: AgentMessage) -> dict[str, Any]:
    return {
        "seq": row.seq,
        "role": row.role,
        "code": row.code,
        "content": row.content,
        "metadata": row.metadata_json or {},
    }


def event_view(row) -> dict[str, Any]:
    return {
        "seq": row.seq,
        "agent_id": row.agent_id,
        "event_type": row.event_type,
        "node": row.node,
        "payload": row.payload or {},
    }


def job_view(row: AgentJob) -> dict[str, Any]:
    return {
        "job_id": row.job_id,
        "agent_id": row.agent_id,
        "session_id": row.session_id,
        "kind": row.kind,
        "status": row.status,
        "attempts": int(row.attempts or 0),
        "max_attempts": int(row.max_attempts or 1),
        "payload": row.payload_json or {},
        "result": row.result_json or {},
        "last_error": row.last_error_json or {},
        "next_run_at": row.next_run_at.isoformat() if row.next_run_at else None,
        "locked_by": row.locked_by,
        "locked_until": row.locked_until.isoformat() if row.locked_until else None,
        "lock_acquired_at": row.lock_acquired_at.isoformat() if row.lock_acquired_at else None,
    }


def job_schedule_view(row: AgentJobSchedule) -> dict[str, Any]:
    return {
        "schedule_id": row.schedule_id,
        "agent_id": row.agent_id,
        "session_id": row.session_id,
        "kind": row.kind,
        "status": row.status,
        "trigger_type": row.trigger_type or "interval",
        "interval_seconds": int(row.interval_seconds or 0),
        "cron_expression": row.cron_expression,
        "event_type": row.cron_expression if (row.trigger_type or "interval") == "event" else None,
        "max_attempts": int(row.max_attempts or 1),
        "payload": row.payload_json or {},
        "last_job_id": row.last_job_id,
        "last_run_at": row.last_run_at.isoformat() if row.last_run_at else None,
        "next_run_at": row.next_run_at.isoformat() if row.next_run_at else None,
    }


def _cron_values(field: str, minimum: int, maximum: int, *, allow_sunday_7: bool = False) -> tuple[set[int], bool]:
    value = field.strip()
    if not value:
        raise ValueError("Campo cron vazio.")
    if value == "*":
        return set(range(minimum, maximum + 1)), True
    allowed: set[int] = set()
    for part in value.split(","):
        part = part.strip()
        if not part:
            raise ValueError("Campo cron inválido.")
        step = 1
        base = part
        if "/" in part:
            base, step_text = part.split("/", 1)
            step = int(step_text)
            if step <= 0:
                raise ValueError("Step cron inválido.")
        if base == "*":
            start, end = minimum, maximum
        elif "-" in base:
            start_text, end_text = base.split("-", 1)
            start, end = int(start_text), int(end_text)
        else:
            start = end = int(base)
        if start < minimum or end > maximum or start > end:
            raise ValueError("Faixa cron fora do permitido.")
        for item in range(start, end + 1, step):
            allowed.add(0 if allow_sunday_7 and item == 7 else item)
    return allowed, False


def _normalize_cron_expression(expression: str | None) -> str:
    parts = (expression or "").strip().split()
    if len(parts) != 5:
        raise ValueError("Use expressão cron com 5 campos: minuto hora dia mês dia-da-semana.")
    _cron_values(parts[0], 0, 59)
    _cron_values(parts[1], 0, 23)
    _cron_values(parts[2], 1, 31)
    _cron_values(parts[3], 1, 12)
    _cron_values(parts[4], 0, 7, allow_sunday_7=True)
    return " ".join(parts)


def _normalize_schedule_event_type(event_type: str | None) -> str:
    value = str(event_type or "").strip()
    if not value:
        raise ValueError("Informe event_type para schedule por evento.")
    if len(value) > 120:
        raise ValueError("event_type deve ter no máximo 120 caracteres.")
    if any(not (char.isalnum() or char in "._:-") for char in value):
        raise ValueError("event_type aceita apenas letras, números, ponto, hífen, sublinhado e dois-pontos.")
    return value


def _next_cron_run(expression: str, after: datetime | None = None) -> datetime:
    parts = _normalize_cron_expression(expression).split()
    minutes, _ = _cron_values(parts[0], 0, 59)
    hours, _ = _cron_values(parts[1], 0, 23)
    days, day_any = _cron_values(parts[2], 1, 31)
    months, _ = _cron_values(parts[3], 1, 12)
    weekdays, weekday_any = _cron_values(parts[4], 0, 7, allow_sunday_7=True)
    current = after or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    current = current.astimezone(timezone.utc).replace(second=0, microsecond=0) + timedelta(minutes=1)
    for _ in range(366 * 24 * 60):
        cron_weekday = (current.weekday() + 1) % 7
        day_match = current.day in days
        weekday_match = cron_weekday in weekdays
        if not day_any and not weekday_any:
            calendar_match = day_match or weekday_match
        else:
            calendar_match = day_match and weekday_match
        if current.minute in minutes and current.hour in hours and current.month in months and calendar_match:
            return current
        current += timedelta(minutes=1)
    raise ValueError("Expressão cron não encontrou próxima execução em até 366 dias.")


def _next_schedule_run(row: AgentJobSchedule, after: datetime | None = None) -> datetime:
    if (row.trigger_type or "interval") == "cron":
        return _next_cron_run(str(row.cron_expression or ""), after)
    if (row.trigger_type or "interval") == "event":
        raise ValueError("Schedule por evento não executa por due time.")
    base = after or datetime.now(timezone.utc)
    if base.tzinfo is None:
        base = base.replace(tzinfo=timezone.utc)
    return base + timedelta(seconds=max(60, int(row.interval_seconds or 60)))


def _redact_external_event_payload(value: Any, depth: int = 0) -> Any:
    if depth >= 5:
        return "[truncated]"
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key)
            marker = key_text.lower().replace("-", "_")
            if any(token in marker for token in ("api_key", "apikey", "authorization", "credential", "password", "secret", "token")):
                redacted[key_text] = "[redacted]"
            else:
                redacted[key_text] = _redact_external_event_payload(item, depth + 1)
        return redacted
    if isinstance(value, list):
        return [_redact_external_event_payload(item, depth + 1) for item in value[:100]]
    return value


class ReferenceAgentService:
    def __init__(self, *, settings: Settings, graph, cache) -> None:
        self.settings = settings
        self.graph = graph
        self.cache = cache

    def _restore_envelope(self, metadata: dict[str, Any]) -> dict[str, Any] | None:
        restore = metadata.get("restore")
        if isinstance(restore, dict):
            return dict(restore)
        checkpoint = metadata.get("checkpoint")
        if isinstance(checkpoint, dict):
            return dict(checkpoint)
        return None

    def _load_checkpoint_values(self, source_session_id: str | None) -> dict[str, Any] | None:
        if not source_session_id:
            return None
        try:
            snapshot = self.graph.get_state({"configurable": {"thread_id": source_session_id}})
            values = getattr(snapshot, "values", None)
            if values is None and isinstance(snapshot, dict):
                values = snapshot.get("values")
            return dict(values) if isinstance(values, dict) else None
        except Exception:
            return None

    def _resolve_restore_state(self, metadata: dict[str, Any]) -> dict[str, Any] | None:
        envelope = self._restore_envelope(metadata)
        if not envelope:
            return None
        source_session_id = str(envelope.get("sourceSessionId") or envelope.get("source_session_id") or "").strip() or None
        checkpoint_values = self._load_checkpoint_values(source_session_id)
        if checkpoint_values:
            return {
                "source": "checkpointer",
                "sourceSessionId": source_session_id,
                "state": checkpoint_values,
            }
        raw_state = envelope.get("state")
        if isinstance(raw_state, dict):
            return {
                "source": "metadata",
                "sourceSessionId": source_session_id,
                "state": dict(raw_state),
            }
        return None

    def _restore_recent_messages(self, restored_state: dict[str, Any]) -> list[dict[str, str]]:
        recent = restored_state.get("recent_messages")
        if isinstance(recent, list):
            normalized = [
                {"role": str(item.get("role")), "content": str(item.get("content"))}
                for item in recent
                if isinstance(item, dict) and item.get("role") and item.get("content")
            ]
            if normalized:
                return normalized[-RECENT_LIMIT:]

        transcript = restored_state.get("transcript")
        if not isinstance(transcript, dict):
            return []
        messages: list[dict[str, str]] = []
        last_user = transcript.get("last_user")
        if isinstance(last_user, dict) and last_user.get("content"):
            messages.append({"role": "user", "content": str(last_user["content"])})
        last_assistant = transcript.get("last_assistant")
        if isinstance(last_assistant, dict) and last_assistant.get("content"):
            messages.append({"role": "assistant", "content": str(last_assistant["content"])})
        return messages[-RECENT_LIMIT:]

    def _normalize_restore_state(
        self,
        raw_state: dict[str, Any],
        row: AgentSession,
        metadata: dict[str, Any],
    ) -> dict[str, Any]:
        restored = dict(raw_state)
        session_state = restored.get("session") if isinstance(restored.get("session"), dict) else {}
        status = str(session_state.get("status") or restored.get("status") or row.status or "active")
        if status == "completed":
            status = "active"
        phase = str(session_state.get("phase") or restored.get("phase") or row.phase or "restored")
        raw_turn = session_state.get("turn", restored.get("turn", row.turn))
        try:
            turn = max(0, int(raw_turn))
        except Exception:
            turn = max(0, int(row.turn or 0))

        restored["session_id"] = row.session_id
        restored["status"] = status
        restored["phase"] = phase
        restored["turn"] = turn
        restored["max_turns"] = row.max_turns
        restored["session_metadata"] = metadata
        restored["is_complete"] = False
        if "recent_messages" not in restored:
            recent = self._restore_recent_messages(restored)
            if recent:
                restored["recent_messages"] = recent
        if "executed_nodes" not in restored:
            nodes = restored.get("nodes")
            restored["executed_nodes"] = list(nodes.keys()) if isinstance(nodes, dict) else []
        return restored

    def _initial_restore(self, row: AgentSession) -> dict[str, Any] | None:
        metadata = row.metadata_json or {}
        resolved = self._resolve_restore_state(metadata)
        if not resolved:
            return None
        state = self._normalize_restore_state(resolved["state"], row, metadata)
        return {
            "source": resolved.get("source"),
            "sourceSessionId": resolved.get("sourceSessionId"),
            "state": state,
        }

    def _restore_event_payload(self, restore: dict[str, Any]) -> dict[str, Any]:
        state = restore.get("state") if isinstance(restore.get("state"), dict) else {}
        return {
            "source": restore.get("source"),
            "sourceSessionId": restore.get("sourceSessionId"),
            "status": state.get("status"),
            "phase": state.get("phase"),
            "turn": state.get("turn"),
            "stateKeys": sorted(str(key) for key in state.keys()),
        }

    def _merge_restore_state(self, base_state: dict[str, Any], restored_state: dict[str, Any]) -> dict[str, Any]:
        merged = dict(restored_state)
        restored_recent = restored_state.get("recent_messages")
        base_recent = base_state.get("recent_messages")
        merged.update(base_state)
        if isinstance(restored_recent, list) and isinstance(base_recent, list):
            merged["recent_messages"] = [*restored_recent, *base_recent][-RECENT_LIMIT:]
        return merged

    def create_session(
        self,
        db: Session,
        *,
        metadata: dict[str, Any],
        max_turns: int,
        auto_start: bool = False,
    ) -> dict[str, Any]:
        row = repo.create_session(db, agent_id=AGENT_ID, max_turns=max_turns, metadata_json=metadata)
        restore = self._initial_restore(row)
        if restore:
            restore_state = restore["state"]
            repo.update_session_state(
                db,
                row,
                status=str(restore_state.get("status") or "active"),
                phase=str(restore_state.get("phase") or "restored"),
                turn=int(restore_state.get("turn") or 0),
            )
        repo.append_event(
            db,
            session_id=row.session_id,
            agent_id=row.agent_id,
            event_type="session_created",
            node=None,
            payload={"auto_start": auto_start, "restored": bool(restore)},
        )
        if restore:
            repo.append_event(
                db,
                session_id=row.session_id,
                agent_id=row.agent_id,
                event_type="checkpoint_restored",
                node=None,
                payload=self._restore_event_payload(restore),
            )
        response = {"session": session_view(row), "messages": []}
        if auto_start:
            started = self.start_session(db, row.session_id)
            response["session"] = started["session"]
            response["messages"] = started["messages"]
        return response

    def get_session(self, db: Session, session_id: str) -> dict[str, Any]:
        row = repo.get_session_by_id(db, session_id)
        if not row:
            raise HTTPException(status_code=404, detail="Sessão não encontrada.")
        return session_view(row)

    def start_session(self, db: Session, session_id: str) -> dict[str, Any]:
        row = repo.get_session_for_update(db, session_id)
        if not row:
            raise HTTPException(status_code=404, detail="Sessão não encontrada.")
        if row.status == "completed":
            return {"session": session_view(row), "messages": []}

        existing_messages = repo.get_transcript(db, session_id)
        if existing_messages:
            repo.update_session_state(db, row, status="active")
            return {"session": session_view(row), "messages": [message_view(item) for item in existing_messages]}
        restore = self._initial_restore(row)
        if restore:
            restore_state = restore["state"]
            repo.update_session_state(
                db,
                row,
                status=str(restore_state.get("status") or "active"),
                phase=str(restore_state.get("phase") or "restored"),
                turn=int(restore_state.get("turn") or row.turn or 0),
            )
            recent = self._restore_recent_messages(restore_state)
            if recent:
                self.cache.set_json(recent_key(row.session_id), recent, ttl_seconds=self.settings.redis_ttl_seconds)
            return {"session": session_view(row), "messages": []}

        result = self._invoke_graph(
            db,
            {
                "action": "start",
                "session_id": row.session_id,
                "agent_id": row.agent_id,
                "status": row.status,
                "phase": row.phase,
                "turn": row.turn,
                "max_turns": row.max_turns,
                "session_metadata": row.metadata_json or {},
                "executed_nodes": [],
            },
            row.session_id,
        )
        next_status = str(result.get("status") or "active")
        next_phase = str(result.get("phase") or "started")
        if next_status == "created":
            next_status = "active"
        if next_phase == "created":
            next_phase = "started"
        repo.update_session_state(db, row, status=next_status, phase=next_phase, turn=row.turn)
        assistant = result["assistant_message"]
        message = repo.append_message(
            db,
            session_id=row.session_id,
            role="assistant",
            code=assistant["code"],
            content=assistant["text"],
        )
        self._persist_graph_events(db, row.session_id, result)
        self._cache_recent(row.session_id, [message_view(message)])
        return {"session": session_view(row), "messages": [message_view(message)]}

    def process_turn(
        self,
        db: Session,
        session_id: str,
        user_message: str,
        token_callback: Callable[[str], None] | None = None,
    ) -> dict[str, Any]:
        row = repo.get_session_for_update(db, session_id)
        if not row:
            raise HTTPException(status_code=404, detail="Sessão não encontrada.")
        if row.status == "created":
            raise HTTPException(status_code=409, detail="Sessão precisa ser iniciada antes do primeiro turno.")
        if row.status == "completed":
            last_message = repo.get_last_assistant_message(db, session_id)
            if not last_message:
                raise HTTPException(status_code=409, detail="Sessão finalizada sem mensagem final.")
            return {
                "session": session_view(row),
                "assistant_message": {"code": last_message.code or "ENC", "text": last_message.content},
                "safety": {"blocked": False, "decision": "allow"},
                "can_finish": True,
            }

        user_row = repo.append_message(
            db,
            session_id=row.session_id,
            role="user",
            content=user_message,
        )
        recent_messages = self._recent_messages(db, row.session_id)
        recent_messages.append({"role": "user", "content": user_message})
        graph_state = {
            "action": "turn",
            "session_id": row.session_id,
            "agent_id": row.agent_id,
            "status": row.status,
            "phase": row.phase,
            "turn": row.turn,
            "max_turns": row.max_turns,
            "user_message": user_message,
            "recent_messages": recent_messages[-RECENT_LIMIT:],
            "session_metadata": row.metadata_json or {},
            "executed_nodes": [],
        }
        restore = self._initial_restore(row)
        if restore and row.turn <= int(restore["state"].get("turn") or 0):
            graph_state = self._merge_restore_state(graph_state, restore["state"])
        result = self._invoke_graph(db, graph_state, row.session_id, token_callback=token_callback, source_message_id=user_row.message_id)
        result = self._normalize_turn_result(result, row)
        completed = bool(result.get("is_complete"))
        repo.update_session_state(
            db,
            row,
            status=result.get("status", row.status),
            phase=result.get("phase", row.phase),
            turn=int(result.get("turn", row.turn)),
            completed=completed,
        )
        assistant = result["assistant_message"]
        assistant_row = repo.append_message(
            db,
            session_id=row.session_id,
            role="assistant",
            code=assistant["code"],
            content=assistant["text"],
            metadata_json={"llm": result.get("llm"), "safety": result.get("safety")},
        )
        self._persist_graph_events(db, row.session_id, result, source_message_id=user_row.message_id)
        recent_payload = [*recent_messages[-RECENT_LIMIT:], {"role": "assistant", "content": assistant["text"]}]
        self.cache.set_json(recent_key(row.session_id), recent_payload[-RECENT_LIMIT:], ttl_seconds=self.settings.redis_ttl_seconds)
        return {
            "session": session_view(row),
            "assistant_message": {"code": assistant["code"], "text": assistant["text"]},
            "safety": result.get("safety") or {"blocked": False, "decision": "allow"},
            "can_finish": row.status == "completed" or row.turn >= row.max_turns,
        }

    def finish_session(self, db: Session, session_id: str) -> dict[str, Any]:
        row = repo.get_session_for_update(db, session_id)
        if not row:
            raise HTTPException(status_code=404, detail="Sessão não encontrada.")
        if row.status == "completed":
            return {"session": session_view(row), "message": None}

        result = self._invoke_graph(
            db,
            {
                "action": "finish",
                "session_id": row.session_id,
                "agent_id": row.agent_id,
                "status": row.status,
                "phase": row.phase,
                "turn": row.turn,
                "max_turns": row.max_turns,
                "session_metadata": row.metadata_json or {},
                "executed_nodes": [],
            },
            row.session_id,
        )
        repo.update_session_state(db, row, status="completed", phase="closing", completed=True)
        assistant = result["assistant_message"]
        message = repo.append_message(
            db,
            session_id=row.session_id,
            role="assistant",
            code=assistant["code"],
            content=assistant["text"],
        )
        self._persist_graph_events(db, row.session_id, result)
        job = repo.create_job(
            db,
            agent_id=row.agent_id,
            session_id=row.session_id,
            kind="post_finish_summary",
            max_attempts=3,
            payload_json={
                "source": "finish_session",
                "message_seq": message.seq,
                "flow": AGENT_ID,
            },
        )
        repo.append_event(
            db,
            session_id=row.session_id,
            agent_id=row.agent_id,
            event_type="post_finish_pending",
            node=None,
            payload={"kind": job.kind, "job_id": job.job_id},
        )
        self.cache.delete(recent_key(row.session_id))
        return {"session": session_view(row), "message": message_view(message)}

    def transcript(self, db: Session, session_id: str, from_seq: int | None = None) -> list[dict[str, Any]]:
        self.get_session(db, session_id)
        return [message_view(row) for row in repo.get_transcript(db, session_id, from_seq=from_seq)]

    def events(self, db: Session, session_id: str, from_seq: int | None = None) -> list[dict[str, Any]]:
        self.get_session(db, session_id)
        return [event_view(row) for row in repo.get_events(db, session_id, from_seq=from_seq)]

    def jobs(self, db: Session, session_id: str | None = None, status: str | None = None) -> list[dict[str, Any]]:
        if session_id:
            self.get_session(db, session_id)
        return [job_view(row) for row in repo.list_jobs(db, session_id=session_id, status=status)]

    def job_metrics(self, db: Session, window_hours: float = 1.0) -> dict[str, Any]:
        return repo.get_job_metrics(db, window_hours=window_hours)

    def cleanup_jobs(
        self,
        db: Session,
        *,
        statuses: list[str] | None = None,
        older_than_hours: float = 168.0,
        session_id: str | None = None,
        limit: int = 100,
        dry_run: bool = True,
    ) -> dict[str, Any]:
        if session_id:
            self.get_session(db, session_id)
        allowed_statuses = {"succeeded", "failed"}
        normalized_statuses = sorted(
            {
                str(status).strip().lower()
                for status in (statuses or ["succeeded", "failed"])
                if str(status).strip()
            }
        )
        invalid_statuses = [status for status in normalized_statuses if status not in allowed_statuses]
        if invalid_statuses:
            raise HTTPException(
                status_code=400,
                detail=f"Limpeza aceita apenas jobs terminais: {', '.join(sorted(allowed_statuses))}.",
            )
        if not normalized_statuses:
            raise HTTPException(status_code=400, detail="Informe ao menos um status terminal para limpeza.")
        normalized_older_than_hours = max(0.0, float(older_than_hours or 0.0))
        normalized_limit = max(1, min(1000, int(limit or 100)))
        cutoff = datetime.now(timezone.utc) - timedelta(hours=normalized_older_than_hours)
        rows = repo.list_job_cleanup_candidates(
            db,
            statuses=normalized_statuses,
            cutoff=cutoff,
            session_id=session_id,
            limit=normalized_limit,
        )
        by_status: dict[str, int] = {}
        for row in rows:
            by_status[row.status] = by_status.get(row.status, 0) + 1
        job_ids = [row.job_id for row in rows]
        if not dry_run and rows:
            by_session: dict[str, dict[str, Any]] = {}
            for row in rows:
                summary = by_session.setdefault(
                    row.session_id,
                    {"agent_id": row.agent_id, "job_ids": [], "by_status": {}},
                )
                summary["job_ids"].append(row.job_id)
                summary["by_status"][row.status] = summary["by_status"].get(row.status, 0) + 1
            for cleaned_session_id, summary in by_session.items():
                repo.append_event(
                    db,
                    session_id=cleaned_session_id,
                    agent_id=str(summary["agent_id"]),
                    event_type="jobs_cleanup_completed",
                    node=None,
                    payload={
                        "deleted": len(summary["job_ids"]),
                        "job_ids": summary["job_ids"],
                        "by_status": summary["by_status"],
                        "statuses": normalized_statuses,
                        "older_than_hours": normalized_older_than_hours,
                        "cutoff": cutoff.isoformat(),
                    },
                )
            repo.delete_jobs(db, rows)
        return {
            "dry_run": bool(dry_run),
            "matched": len(rows),
            "deleted": 0 if dry_run else len(rows),
            "statuses": normalized_statuses,
            "older_than_hours": normalized_older_than_hours,
            "cutoff": cutoff.isoformat(),
            "job_ids": job_ids,
            "by_status": by_status,
        }

    def get_job(self, db: Session, job_id: str) -> dict[str, Any]:
        row = repo.get_job_by_id(db, job_id)
        if not row:
            raise HTTPException(status_code=404, detail="Job não encontrado.")
        return job_view(row)

    def _normalize_flow_trigger(self, raw: Any) -> dict[str, Any] | None:
        if not isinstance(raw, dict):
            return None
        trigger_id = str(raw.get("id") or "").strip()
        if not trigger_id:
            return None
        if raw.get("enabled") is False:
            return None
        kind = str(raw.get("kind") or "manual").strip().lower()
        if kind == "manual":
            return None
        if kind not in {"interval", "cron", "event"}:
            return None
        interval_seconds = max(60, int(raw.get("intervalSeconds") or raw.get("interval_seconds") or 300))
        normalized: dict[str, Any] = {
            "id": trigger_id,
            "kind": kind,
            "label": str(raw.get("label") or trigger_id),
            "description": str(raw.get("description") or ""),
            "intervalSeconds": interval_seconds,
            "userMessage": str(raw.get("userMessage") or raw.get("user_message") or "").strip(),
            "input": raw.get("input") if isinstance(raw.get("input"), dict) else {},
            "metadata": raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {},
            "maxTurns": max(1, min(50, int(raw.get("maxTurns") or raw.get("max_turns") or 3))),
            "maxAttempts": max(1, min(10, int(raw.get("maxAttempts") or raw.get("max_attempts") or 3))),
            "autoFinish": bool(raw.get("autoFinish") or raw.get("auto_finish") or False),
        }
        if kind == "cron":
            normalized["cronExpression"] = _normalize_cron_expression(str(raw.get("cronExpression") or raw.get("cron_expression") or ""))
        if kind == "event":
            normalized["eventType"] = _normalize_schedule_event_type(str(raw.get("eventType") or raw.get("event_type") or ""))
        return normalized

    def _flow_trigger_schedule_config(self, trigger: dict[str, Any]) -> dict[str, Any]:
        kind = str(trigger.get("kind") or "interval")
        if kind == "cron":
            cron_expression = str(trigger.get("cronExpression") or "")
            return {
                "trigger_type": "cron",
                "interval_seconds": int(trigger.get("intervalSeconds") or 300),
                "cron_expression": cron_expression,
                "next_run_at": _next_cron_run(cron_expression),
            }
        if kind == "event":
            return {
                "trigger_type": "event",
                "interval_seconds": int(trigger.get("intervalSeconds") or 300),
                "cron_expression": str(trigger.get("eventType") or ""),
                "next_run_at": None,
            }
        return {
            "trigger_type": "interval",
            "interval_seconds": int(trigger.get("intervalSeconds") or 300),
            "cron_expression": None,
            "next_run_at": datetime.now(timezone.utc),
        }

    def _flow_trigger_schedule_payload(self, trigger: dict[str, Any]) -> dict[str, Any]:
        return {
            "source": "flow_trigger",
            "flow_trigger": trigger,
        }

    def _flow_trigger_schedules_by_id(self, db: Session) -> dict[str, AgentJobSchedule]:
        schedules: dict[str, AgentJobSchedule] = {}
        for row in repo.list_job_schedules(db, limit=1000):
            if row.agent_id != AGENT_ID or row.kind != "flow_trigger":
                continue
            payload = row.payload_json if isinstance(row.payload_json, dict) else {}
            trigger = payload.get("flow_trigger") if isinstance(payload.get("flow_trigger"), dict) else {}
            trigger_id = str(trigger.get("id") or "").strip()
            if trigger_id and trigger_id not in schedules:
                schedules[trigger_id] = row
        return schedules

    def ensure_flow_trigger_schedules(self, db: Session) -> dict[str, Any]:
        desired: dict[str, dict[str, Any]] = {}
        skipped: list[dict[str, Any]] = []
        for raw in FLOW_TRIGGERS:
            try:
                trigger = self._normalize_flow_trigger(raw)
            except Exception as exc:
                skipped.append({"id": str(raw.get("id") if isinstance(raw, dict) else ""), "error": str(exc)})
                continue
            if trigger:
                desired[str(trigger["id"])] = trigger

        existing = self._flow_trigger_schedules_by_id(db)
        created: list[dict[str, Any]] = []
        updated: list[dict[str, Any]] = []
        disabled: list[dict[str, Any]] = []

        for trigger_id, schedule in existing.items():
            if trigger_id not in desired and schedule.status == "enabled":
                repo.disable_job_schedule(db, schedule)
                repo.append_event(
                    db,
                    session_id=schedule.session_id,
                    agent_id=schedule.agent_id,
                    event_type="flow_trigger_schedule_disabled",
                    node=None,
                    payload={"trigger_id": trigger_id, "schedule_id": schedule.schedule_id},
                )
                disabled.append(job_schedule_view(schedule))

        for trigger_id, trigger in desired.items():
            config = self._flow_trigger_schedule_config(trigger)
            payload = self._flow_trigger_schedule_payload(trigger)
            schedule = existing.get(trigger_id)
            if schedule:
                schedule.status = "enabled"
                schedule.trigger_type = config["trigger_type"]
                schedule.interval_seconds = max(60, int(config["interval_seconds"] or 60))
                schedule.cron_expression = config["cron_expression"]
                schedule.max_attempts = int(trigger.get("maxAttempts") or 3)
                schedule.payload_json = payload
                if schedule.trigger_type == "event":
                    schedule.next_run_at = None
                elif schedule.next_run_at is None:
                    schedule.next_run_at = config["next_run_at"]
                db.flush()
                repo.append_event(
                    db,
                    session_id=schedule.session_id,
                    agent_id=schedule.agent_id,
                    event_type="flow_trigger_schedule_synced",
                    node=None,
                    payload={"trigger_id": trigger_id, "schedule_id": schedule.schedule_id, "trigger_type": schedule.trigger_type},
                )
                updated.append(job_schedule_view(schedule))
                continue

            control = self.create_session(
                db,
                metadata={
                    "source": "flow_trigger_control",
                    "trigger_id": trigger_id,
                    "trigger": trigger,
                },
                max_turns=1,
                auto_start=False,
            )["session"]
            schedule = repo.create_job_schedule(
                db,
                agent_id=AGENT_ID,
                session_id=str(control["session_id"]),
                kind="flow_trigger",
                interval_seconds=int(config["interval_seconds"]),
                trigger_type=str(config["trigger_type"]),
                cron_expression=config["cron_expression"],
                payload_json=payload,
                max_attempts=int(trigger.get("maxAttempts") or 3),
                next_run_at=config["next_run_at"],
            )
            repo.append_event(
                db,
                session_id=schedule.session_id,
                agent_id=schedule.agent_id,
                event_type="flow_trigger_schedule_created",
                node=None,
                payload={
                    "trigger_id": trigger_id,
                    "schedule_id": schedule.schedule_id,
                    "trigger_type": schedule.trigger_type,
                    "next_run_at": schedule.next_run_at.isoformat() if schedule.next_run_at else None,
                },
            )
            created.append(job_schedule_view(schedule))
        return {
            "total": len(desired),
            "created": created,
            "updated": updated,
            "disabled": disabled,
            "skipped": skipped,
        }

    def _run_flow_trigger_job(self, db: Session, job: AgentJob) -> dict[str, Any]:
        payload = dict(job.payload_json or {})
        trigger = payload.get("flow_trigger") if isinstance(payload.get("flow_trigger"), dict) else {}
        trigger_id = str(trigger.get("id") or "")
        execution = self.create_session(
            db,
            metadata={
                "source": "flow_trigger",
                "trigger_id": trigger_id,
                "trigger_label": trigger.get("label"),
                "schedule_id": payload.get("schedule_id"),
                "job_id": job.job_id,
                "input": trigger.get("input") if isinstance(trigger.get("input"), dict) else {},
                "trigger_metadata": trigger.get("metadata") if isinstance(trigger.get("metadata"), dict) else {},
            },
            max_turns=max(1, min(50, int(trigger.get("maxTurns") or 3))),
            auto_start=False,
        )["session"]
        execution_session_id = str(execution["session_id"])
        repo.append_event(
            db,
            session_id=job.session_id,
            agent_id=job.agent_id,
            event_type="flow_trigger_started",
            node=None,
            payload={"trigger_id": trigger_id, "job_id": job.job_id, "execution_session_id": execution_session_id},
        )
        start_result = self.start_session(db, execution_session_id)
        turn_result: dict[str, Any] | None = None
        user_message = str(trigger.get("userMessage") or "").strip()
        if user_message:
            turn_result = self.process_turn(db, execution_session_id, user_message)
        finish_result: dict[str, Any] | None = None
        if bool(trigger.get("autoFinish")):
            finish_result = self.finish_session(db, execution_session_id)
        repo.append_event(
            db,
            session_id=job.session_id,
            agent_id=job.agent_id,
            event_type="flow_trigger_completed",
            node=None,
            payload={"trigger_id": trigger_id, "job_id": job.job_id, "execution_session_id": execution_session_id},
        )
        return {
            "kind": job.kind,
            "trigger_id": trigger_id,
            "execution_session_id": execution_session_id,
            "started_messages": len(start_result.get("messages") or []),
            "turn_ran": turn_result is not None,
            "auto_finish": finish_result is not None,
        }

    def run_job(
        self,
        db: Session,
        job_id: str,
        *,
        worker_id: str | None = None,
        lease_seconds: float = 60.0,
    ) -> dict[str, Any]:
        job = repo.get_job_for_update(db, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job não encontrado.")
        if job.status == "succeeded":
            return {"job": job_view(job)}
        if job.status == "running":
            lock_owner = str(job.locked_by or "")
            if worker_id and lock_owner == worker_id:
                locked_until = repo._as_utc(job.locked_until)
                if locked_until and locked_until <= datetime.now(timezone.utc):
                    raise HTTPException(status_code=409, detail="Lease do job expirou antes da execução.")
            else:
                raise HTTPException(status_code=409, detail="Job já está em execução por outro worker.")
        else:
            repo.mark_job_running(db, job)
        if job.kind == "flow_trigger":
            try:
                result = self._run_flow_trigger_job(db, job)
                repo.mark_job_finished(db, job, status="succeeded", result_json=result)
                return {"job": job_view(job)}
            except Exception as exc:
                result = {
                    "kind": job.kind,
                    "error": str(exc),
                }
                repo.mark_job_finished(db, job, status="failed", result_json=result)
                repo.append_event(
                    db,
                    session_id=job.session_id,
                    agent_id=job.agent_id,
                    event_type="flow_trigger_failed",
                    node=None,
                    payload={"kind": job.kind, "job_id": job.job_id, "error": str(exc)},
                )
                raise
        transcript = self.transcript(db, job.session_id)
        events = self.events(db, job.session_id)
        assistant_messages = [message for message in transcript if message.get("role") == "assistant"]
        result = {
            "summary": assistant_messages[-1]["content"] if assistant_messages else "Sem mensagem final.",
            "message_count": len(transcript),
            "event_count": len(events),
            "kind": job.kind,
        }
        repo.mark_job_finished(db, job, status="succeeded", result_json=result)
        repo.append_event(
            db,
            session_id=job.session_id,
            agent_id=job.agent_id,
            event_type="post_finish_completed",
            node=None,
            payload={"kind": job.kind, "job_id": job.job_id, "result": result},
        )
        return {"job": job_view(job)}

    def retry_job(self, db: Session, job_id: str) -> dict[str, Any]:
        job = repo.get_job_for_update(db, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job não encontrado.")
        if job.status == "succeeded":
            return {"job": job_view(job)}
        repo.reset_job_for_retry(db, job, reset_attempts=True)
        repo.append_event(
            db,
            session_id=job.session_id,
            agent_id=job.agent_id,
            event_type="post_finish_retry_requested",
            node=None,
            payload={"kind": job.kind, "job_id": job.job_id},
        )
        return {"job": job_view(job)}

    def schedule_job(self, db: Session, job_id: str, run_at: datetime) -> dict[str, Any]:
        job = repo.get_job_for_update(db, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job não encontrado.")
        if job.status == "running":
            raise HTTPException(status_code=409, detail="Job em execução não pode ser reagendado.")
        if job.status == "succeeded":
            raise HTTPException(status_code=409, detail="Job já concluído não pode ser reagendado.")
        repo.schedule_job(db, job, run_at=run_at)
        repo.append_event(
            db,
            session_id=job.session_id,
            agent_id=job.agent_id,
            event_type="post_finish_scheduled",
            node=None,
            payload={"kind": job.kind, "job_id": job.job_id, "next_run_at": job.next_run_at.isoformat() if job.next_run_at else None},
        )
        return {"job": job_view(job)}

    def job_schedules(
        self,
        db: Session,
        session_id: str | None = None,
        status: str | None = None,
    ) -> list[dict[str, Any]]:
        if session_id:
            self.get_session(db, session_id)
        return [job_schedule_view(row) for row in repo.list_job_schedules(db, session_id=session_id, status=status)]

    def create_job_recurrence(
        self,
        db: Session,
        job_id: str,
        *,
        interval_seconds: int | None = None,
        trigger_type: str = "interval",
        cron_expression: str | None = None,
        event_type: str | None = None,
        run_at: datetime | None = None,
        delay_seconds: float | None = None,
    ) -> dict[str, Any]:
        job = repo.get_job_by_id(db, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job não encontrado.")
        if run_at and run_at.tzinfo is None:
            run_at = run_at.replace(tzinfo=timezone.utc)
        if run_at is None and delay_seconds is not None:
            run_at = datetime.now(timezone.utc) + timedelta(seconds=max(0.0, float(delay_seconds or 0.0)))
        if trigger_type == "event" or event_type:
            normalized_trigger = "event"
        else:
            normalized_trigger = "cron" if trigger_type == "cron" or cron_expression else "interval"
        normalized_interval = max(60, int(interval_seconds or 3600))
        normalized_cron: str | None = None
        normalized_event: str | None = None
        if normalized_trigger == "cron":
            try:
                normalized_cron = _normalize_cron_expression(cron_expression)
            except (TypeError, ValueError) as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            if run_at is None:
                run_at = _next_cron_run(normalized_cron)
        elif normalized_trigger == "event":
            try:
                normalized_event = _normalize_schedule_event_type(event_type or cron_expression)
            except (TypeError, ValueError) as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            run_at = None
        payload = dict(job.payload_json or {})
        payload["recurrence"] = {
            "source": "job_recurrence",
            "source_job_id": job.job_id,
            "trigger_type": normalized_trigger,
            "interval_seconds": normalized_interval,
            "cron_expression": normalized_cron,
            "event_type": normalized_event,
        }
        schedule = repo.create_job_schedule(
            db,
            agent_id=job.agent_id,
            session_id=job.session_id,
            kind=job.kind,
            interval_seconds=normalized_interval,
            trigger_type=normalized_trigger,
            cron_expression=normalized_event or normalized_cron,
            payload_json=payload,
            max_attempts=int(job.max_attempts or 3),
            next_run_at=run_at,
        )
        repo.append_event(
            db,
            session_id=schedule.session_id,
            agent_id=schedule.agent_id,
            event_type="job_schedule_created",
            node=None,
            payload={
                "kind": schedule.kind,
                "schedule_id": schedule.schedule_id,
                "source_job_id": job.job_id,
                "trigger_type": schedule.trigger_type,
                "interval_seconds": schedule.interval_seconds,
                "cron_expression": schedule.cron_expression,
                "event_type": normalized_event,
                "next_run_at": schedule.next_run_at.isoformat() if schedule.next_run_at else None,
            },
        )
        return {"schedule": job_schedule_view(schedule)}

    def run_due_job_schedules(self, db: Session, limit: int = 20) -> dict[str, Any]:
        rows = repo.list_due_job_schedules(db, limit=limit)
        jobs: list[dict[str, Any]] = []
        schedules: list[dict[str, Any]] = []
        for schedule in rows:
            payload = dict(schedule.payload_json or {})
            payload["schedule_id"] = schedule.schedule_id
            payload["source"] = "job_schedule"
            payload["schedule_trigger_type"] = schedule.trigger_type or "interval"
            payload["schedule_interval_seconds"] = int(schedule.interval_seconds or 0)
            payload["schedule_cron_expression"] = schedule.cron_expression
            try:
                next_run_at = _next_schedule_run(schedule)
            except ValueError as exc:
                repo.disable_job_schedule(db, schedule)
                repo.append_event(
                    db,
                    session_id=schedule.session_id,
                    agent_id=schedule.agent_id,
                    event_type="job_schedule_disabled",
                    node=None,
                    payload={"kind": schedule.kind, "schedule_id": schedule.schedule_id, "reason": str(exc)},
                )
                continue
            job = repo.create_job(
                db,
                agent_id=schedule.agent_id,
                session_id=schedule.session_id,
                kind=schedule.kind,
                payload_json=payload,
                max_attempts=int(schedule.max_attempts or 3),
            )
            repo.mark_job_schedule_enqueued(db, schedule, job, next_run_at=next_run_at)
            repo.append_event(
                db,
                session_id=schedule.session_id,
                agent_id=schedule.agent_id,
                event_type="job_schedule_enqueued",
                node=None,
                payload={
                    "kind": schedule.kind,
                    "schedule_id": schedule.schedule_id,
                    "job_id": job.job_id,
                    "trigger_type": schedule.trigger_type,
                    "next_run_at": schedule.next_run_at.isoformat() if schedule.next_run_at else None,
                },
            )
            jobs.append(job_view(job))
            schedules.append(job_schedule_view(schedule))
        return {"schedules": schedules, "jobs": jobs, "total": len(rows), "enqueued": len(jobs)}

    def trigger_event_job_schedules(
        self,
        db: Session,
        *,
        event_type: str,
        session_id: str | None = None,
        payload: dict[str, Any] | None = None,
        limit: int = 20,
    ) -> dict[str, Any]:
        try:
            normalized_event = _normalize_schedule_event_type(event_type)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if session_id:
            self.get_session(db, session_id)
        event_payload = _redact_external_event_payload(payload or {})
        rows = repo.list_event_job_schedules(
            db,
            event_type=normalized_event,
            session_id=session_id,
            limit=limit,
        )
        jobs: list[dict[str, Any]] = []
        schedules: list[dict[str, Any]] = []
        for schedule in rows:
            job_payload = dict(schedule.payload_json or {})
            job_payload["schedule_id"] = schedule.schedule_id
            job_payload["source"] = "job_event"
            job_payload["schedule_trigger_type"] = "event"
            job_payload["schedule_event_type"] = normalized_event
            job_payload["event_payload"] = event_payload
            job = repo.create_job(
                db,
                agent_id=schedule.agent_id,
                session_id=schedule.session_id,
                kind=schedule.kind,
                payload_json=job_payload,
                max_attempts=int(schedule.max_attempts or 3),
            )
            repo.mark_job_schedule_enqueued(db, schedule, job, next_run_at=None)
            repo.append_event(
                db,
                session_id=schedule.session_id,
                agent_id=schedule.agent_id,
                event_type="job_schedule_event_triggered",
                node=None,
                payload={
                    "kind": schedule.kind,
                    "schedule_id": schedule.schedule_id,
                    "job_id": job.job_id,
                    "event_type": normalized_event,
                    "payload_keys": sorted(event_payload.keys()) if isinstance(event_payload, dict) else [],
                },
            )
            jobs.append(job_view(job))
            schedules.append(job_schedule_view(schedule))
        return {"schedules": schedules, "jobs": jobs, "total": len(rows), "enqueued": len(jobs)}

    def disable_job_schedule(self, db: Session, schedule_id: str) -> dict[str, Any]:
        schedule = repo.get_job_schedule_for_update(db, schedule_id)
        if not schedule:
            raise HTTPException(status_code=404, detail="Schedule não encontrado.")
        repo.disable_job_schedule(db, schedule)
        repo.append_event(
            db,
            session_id=schedule.session_id,
            agent_id=schedule.agent_id,
            event_type="job_schedule_disabled",
            node=None,
            payload={"kind": schedule.kind, "schedule_id": schedule.schedule_id},
        )
        return {"schedule": job_schedule_view(schedule)}

    def run_pending_jobs(
        self,
        db: Session,
        session_id: str | None = None,
        limit: int = 50,
        worker_id: str | None = None,
        lease_seconds: float = 60.0,
    ) -> dict[str, Any]:
        if session_id:
            self.get_session(db, session_id)
        owner = worker_id or "api-run-pending"
        rows = repo.claim_due_jobs(
            db,
            session_id=session_id,
            limit=limit,
            worker_id=owner,
            lease_seconds=lease_seconds,
        )
        jobs: list[dict[str, Any]] = []
        errors: list[dict[str, Any]] = []
        for row in rows:
            try:
                jobs.append(self.run_job(db, row.job_id, worker_id=owner, lease_seconds=lease_seconds)["job"])
            except Exception as exc:
                errors.append({"job_id": row.job_id, "error": str(exc)})
        return {
            "jobs": jobs,
            "total": len(rows),
            "succeeded": len(jobs),
            "failed": len(errors),
            "errors": errors,
        }

    def retry_failed_jobs(self, db: Session, session_id: str | None = None, limit: int = 50) -> dict[str, Any]:
        if session_id:
            self.get_session(db, session_id)
        rows = repo.list_jobs(db, session_id=session_id, status="failed", limit=limit)
        jobs: list[dict[str, Any]] = []
        errors: list[dict[str, Any]] = []
        for row in rows:
            try:
                jobs.append(self.retry_job(db, row.job_id)["job"])
            except Exception as exc:
                errors.append({"job_id": row.job_id, "error": str(exc)})
        return {
            "jobs": jobs,
            "total": len(rows),
            "succeeded": len(jobs),
            "failed": len(errors),
            "errors": errors,
        }

    def _invoke_graph(
        self,
        db: Session,
        state: dict[str, Any],
        session_id: str,
        token_callback: Callable[[str], None] | None = None,
        source_message_id: str | None = None,
    ) -> dict[str, Any]:
        agent_id = str(state.get("agent_id") or AGENT_ID)

        def event_sink(event_type: str, node_id: str, payload: dict[str, Any]) -> None:
            event_payload = dict(payload or {})
            if source_message_id:
                event_payload["source_message_id"] = source_message_id
            repo.append_event(
                db,
                session_id=session_id,
                agent_id=agent_id,
                event_type=event_type,
                node=node_id,
                payload=event_payload,
            )

        token = CURRENT_DB_SESSION.set(db)
        event_sink_token = CURRENT_EVENT_SINK.set(event_sink)
        token_stream = CURRENT_TOKEN_STREAM.set(token_callback)
        try:
            return dict(
                self.graph.invoke(
                    state,
                    config={"configurable": {"thread_id": session_id}},
                )
            )
        finally:
            CURRENT_TOKEN_STREAM.reset(token_stream)
            CURRENT_EVENT_SINK.reset(event_sink_token)
            CURRENT_DB_SESSION.reset(token)

    def _recent_messages(self, db: Session, session_id: str) -> list[dict[str, str]]:
        cached = self.cache.get_json(recent_key(session_id))
        if isinstance(cached, list):
            return [{"role": item["role"], "content": item["content"]} for item in cached if "role" in item and "content" in item]
        rows = repo.get_recent_messages(db, session_id, RECENT_LIMIT)
        return [{"role": row.role, "content": row.content} for row in rows]

    def _cache_recent(self, session_id: str, messages: list[dict[str, Any]]) -> None:
        payload = [{"role": item["role"], "content": item["content"]} for item in messages]
        self.cache.set_json(recent_key(session_id), payload[-RECENT_LIMIT:], ttl_seconds=self.settings.redis_ttl_seconds)

    def _normalize_turn_result(self, result: dict[str, Any], row: AgentSession) -> dict[str, Any]:
        assistant = result.get("assistant_message")
        if not assistant:
            result["assistant_message"] = {"code": "OK", "text": "Turno processado."}

        next_turn = int(result.get("turn") or row.turn)
        if next_turn <= row.turn:
            next_turn = row.turn + 1
        result["turn"] = next_turn

        if next_turn >= row.max_turns and result.get("status") != "completed":
            text = result["assistant_message"]["text"]
            result["assistant_message"] = {
                "code": "ENC",
                "text": f"{text}\n\nEncerramos por aqui porque o limite de turnos foi atingido.",
            }
            result["status"] = "completed"
            result["phase"] = "closing"
            result["is_complete"] = True
        else:
            result.setdefault("status", "active")
            result.setdefault("phase", "awaiting_turn")
            result.setdefault("is_complete", False)
        return result

    def _persist_graph_events(
        self,
        db: Session,
        session_id: str,
        result: dict[str, Any],
        source_message_id: str | None = None,
    ) -> None:
        agent_id = str(result.get("agent_id") or AGENT_ID)
        for node_id in result.get("executed_nodes") or []:
            payload: dict[str, Any] = {
                "status": result.get("status"),
                "phase": result.get("phase"),
                "turn": result.get("turn"),
            }
            if source_message_id:
                payload["source_message_id"] = source_message_id
            event_type = "node_completed"
            if node_id in LLM_NODE_IDS:
                event_type = "llm_called"
                payload.update(result.get("llm") or {})
            elif node_id in INPUT_SAFETY_NODE_IDS or node_id in OUTPUT_SAFETY_NODE_IDS:
                payload["safety"] = result.get("safety") or {"blocked": False, "decision": "allow"}
            elif node_id in CODE_NODE_IDS:
                custom_payload = (result.get("custom") or {}).get(node_id, {})
                if custom_payload:
                    if custom_payload.get("status") == "custom_code_executed":
                        event_type = "custom_code_executed"
                    elif custom_payload.get("status") == "custom_code_failed":
                        event_type = "custom_code_failed"
                    else:
                        event_type = "custom_code_declared"
                    payload["custom"] = custom_payload
                payload["handler"] = "code"
            elif node_id in SWITCH_NODE_IDS:
                event_type = "switch_evaluated"
                payload["handler"] = "switch"
            elif node_id in HUMAN_INPUT_NODE_IDS:
                event_type = "human_input_wait"
                payload["handler"] = "human_input"
            elif node_id in HTTP_REQUEST_NODE_IDS:
                event_type = "http_request_completed"
                payload["handler"] = "http_request"
                payload["http"] = (result.get("http") or {}).get(node_id, {})
            elif node_id in TRANSFORM_JSON_NODE_IDS:
                event_type = "transform_json_completed"
                payload["handler"] = "transform_json"
                payload["transform"] = (result.get("transforms") or {}).get(node_id, {})
            elif node_id in DATABASE_QUERY_NODE_IDS:
                event_type = "database_query_completed"
                payload["handler"] = "database_query"
                payload["database"] = (result.get("database") or {}).get(node_id, {})
            elif node_id in DATABASE_SAVE_NODE_IDS:
                event_type = "database_save_completed"
                payload["handler"] = "database_save"
                payload["database"] = (result.get("database") or {}).get(node_id, {})
            elif node_id in FILE_EXTRACT_NODE_IDS:
                event_type = "file_extract_completed"
                payload["handler"] = "file_extract"
                payload["file"] = (result.get("files") or {}).get(node_id, {})
            elif node_id in RAG_RETRIEVAL_NODE_IDS:
                event_type = "rag_retrieval_completed"
                payload["handler"] = "rag_retrieval"
                payload["rag"] = (result.get("rag") or {}).get(node_id, {})
            elif node_id in APPROVAL_GATE_NODE_IDS:
                event_type = "approval_gate_evaluated"
                payload["handler"] = "approval_gate"
                payload["approval"] = (result.get("approvals") or {}).get(node_id, {})
            elif node_id in SCORING_NODE_IDS:
                event_type = "scoring_completed"
                payload["handler"] = "scoring"
                payload["score"] = (result.get("scores") or {}).get(node_id, {})
            elif node_id in ANALYTICS_NODE_IDS:
                event_type = "analytics_recorded"
                payload["handler"] = "analytics"
                payload["analytics"] = (result.get("analytics") or {}).get(node_id, {})
            elif node_id in START_NODE_IDS:
                payload["handler"] = "start"
            elif node_id in FINISH_NODE_IDS:
                payload["handler"] = "finish"
            repo.append_event(
                db,
                session_id=session_id,
                agent_id=agent_id,
                event_type=event_type,
                node=node_id,
                payload=payload,
            )
