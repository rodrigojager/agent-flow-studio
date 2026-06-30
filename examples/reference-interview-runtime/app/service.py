from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import repo
from app.cache import recent_key
from app.models import AgentMessage, AgentSession
from app.settings import Settings


RECENT_LIMIT = 20
AGENT_ID = "reference-interview"


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
            return {"source": "checkpointer", "sourceSessionId": source_session_id, "state": checkpoint_values}
        raw_state = envelope.get("state")
        if isinstance(raw_state, dict):
            return {"source": "metadata", "sourceSessionId": source_session_id, "state": dict(raw_state)}
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
        restored["agent_id"] = row.agent_id
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
        return {"source": resolved.get("source"), "sourceSessionId": resolved.get("sourceSessionId"), "state": state}

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
            {
                "action": "start",
                "session_id": row.session_id,
                "agent_id": row.agent_id,
                "status": row.status,
                "phase": row.phase,
                "turn": row.turn,
                "max_turns": row.max_turns,
                "session_metadata": row.metadata_json or {},
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
        repo.append_event(
            db,
            session_id=row.session_id,
            agent_id=row.agent_id,
            event_type="node_completed",
            node="start_node",
            payload={
                "status": result.get("status"),
                "phase": result.get("phase"),
                "turn": result.get("turn"),
                "handler": "start",
            },
        )
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
        result = self._invoke_graph(graph_state, row.session_id)
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
        self._persist_turn_events(db, row.session_id, result, user_row.message_id)
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
                "agent_id": row.agent_id,
                "status": row.status,
                "phase": row.phase,
                "turn": row.turn,
                "max_turns": row.max_turns,
                "session_metadata": row.metadata_json or {},
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
        repo.append_event(
            db,
            session_id=row.session_id,
            agent_id=row.agent_id,
            event_type="node_completed",
            node="finish_node",
            payload={
                "status": result.get("status"),
                "phase": result.get("phase"),
                "turn": result.get("turn"),
                "handler": "finish",
            },
        )
        repo.append_event(
            db,
            session_id=row.session_id,
            agent_id=row.agent_id,
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

    def _persist_turn_events(self, db: Session, session_id: str, result: dict[str, Any], user_message_id: str) -> None:
        agent_id = str(result.get("agent_id") or AGENT_ID)
        repo.append_event(
            db,
            session_id=session_id,
            agent_id=agent_id,
            event_type="node_completed",
            node="input_safety_check",
            payload={
                "status": result.get("status"),
                "phase": result.get("phase"),
                "turn": result.get("turn"),
                "safety": result.get("safety"),
                "source_message_id": user_message_id,
            },
        )
        if not (result.get("safety") or {}).get("blocked"):
            llm_payload = {
                "status": result.get("status"),
                "phase": result.get("phase"),
                "turn": result.get("turn"),
                "node_id": "llm_step",
                "source_message_id": user_message_id,
            }
            llm_payload.update(result.get("llm") or {})
            repo.append_event(
                db,
                session_id=session_id,
                agent_id=agent_id,
                event_type="llm_called",
                node="llm_step",
                payload=llm_payload,
            )
            repo.append_event(
                db,
                session_id=session_id,
                agent_id=agent_id,
                event_type="node_completed",
                node="output_safety_check",
                payload={
                    "status": result.get("status"),
                    "phase": result.get("phase"),
                    "turn": result.get("turn"),
                    "safety": result.get("safety") or {"blocked": False, "decision": "allow"},
                    "source_message_id": user_message_id,
                },
            )
            repo.append_event(
                db,
                session_id=session_id,
                agent_id=agent_id,
                event_type="node_completed",
                node="deterministic_gate",
                payload={
                    "status": result.get("status"),
                    "phase": result.get("phase"),
                    "turn": result.get("turn"),
                    "handler": "code",
                    "source_message_id": user_message_id,
                },
            )
