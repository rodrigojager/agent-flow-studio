from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import repo
from app.cache import recent_key
from app.graph import (
    CODE_NODE_IDS,
    FINISH_NODE_IDS,
    HUMAN_INPUT_NODE_IDS,
    HTTP_REQUEST_NODE_IDS,
    INPUT_SAFETY_NODE_IDS,
    LLM_NODE_IDS,
    OUTPUT_SAFETY_NODE_IDS,
    START_NODE_IDS,
    SWITCH_NODE_IDS,
    TRANSFORM_JSON_NODE_IDS,
)
from app.models import AgentMessage, AgentSession
from app.settings import Settings


RECENT_LIMIT = 20


def session_view(row: AgentSession) -> dict[str, Any]:
    return {
        "session_id": row.session_id,
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
        "event_type": row.event_type,
        "node": row.node,
        "payload": row.payload or {},
    }


class ReferenceAgentService:
    def __init__(self, *, settings: Settings, graph, cache) -> None:
        self.settings = settings
        self.graph = graph
        self.cache = cache

    def create_session(
        self,
        db: Session,
        *,
        metadata: dict[str, Any],
        max_turns: int,
        auto_start: bool = False,
    ) -> dict[str, Any]:
        row = repo.create_session(db, max_turns=max_turns, metadata_json=metadata)
        repo.append_event(
            db,
            session_id=row.session_id,
            event_type="session_created",
            node=None,
            payload={"auto_start": auto_start},
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

        result = self._invoke_graph(
            {
                "action": "start",
                "session_id": row.session_id,
                "status": row.status,
                "phase": row.phase,
                "turn": row.turn,
                "max_turns": row.max_turns,
                "executed_nodes": [],
            },
            row.session_id,
        )
        repo.update_session_state(db, row, status=result["status"], phase=result["phase"], turn=row.turn)
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

    def process_turn(self, db: Session, session_id: str, user_message: str) -> dict[str, Any]:
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
        result = self._invoke_graph(
            {
                "action": "turn",
                "session_id": row.session_id,
                "status": row.status,
                "phase": row.phase,
                "turn": row.turn,
                "max_turns": row.max_turns,
                "user_message": user_message,
                "recent_messages": recent_messages[-RECENT_LIMIT:],
                "executed_nodes": [],
            },
            row.session_id,
        )
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
            {
                "action": "finish",
                "session_id": row.session_id,
                "status": row.status,
                "phase": row.phase,
                "turn": row.turn,
                "max_turns": row.max_turns,
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
        repo.append_event(
            db,
            session_id=row.session_id,
            event_type="post_finish_pending",
            node=None,
            payload={"kind": "mock_summary"},
        )
        self.cache.delete(recent_key(row.session_id))
        return {"session": session_view(row), "message": message_view(message)}

    def transcript(self, db: Session, session_id: str, from_seq: int | None = None) -> list[dict[str, Any]]:
        self.get_session(db, session_id)
        return [message_view(row) for row in repo.get_transcript(db, session_id, from_seq=from_seq)]

    def events(self, db: Session, session_id: str, from_seq: int | None = None) -> list[dict[str, Any]]:
        self.get_session(db, session_id)
        return [event_view(row) for row in repo.get_events(db, session_id, from_seq=from_seq)]

    def _invoke_graph(self, state: dict[str, Any], session_id: str) -> dict[str, Any]:
        return dict(
            self.graph.invoke(
                state,
                config={"configurable": {"thread_id": session_id}},
            )
        )

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
            elif node_id in START_NODE_IDS:
                payload["handler"] = "start"
            elif node_id in FINISH_NODE_IDS:
                payload["handler"] = "finish"
            repo.append_event(
                db,
                session_id=session_id,
                event_type=event_type,
                node=node_id,
                payload=payload,
            )
