import atexit
import time
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, Literal, TypedDict
from uuid import uuid4

from langgraph.graph import END, START, StateGraph
from langgraph.checkpoint.memory import MemorySaver

from app.llm import LLMClient, load_prompt
from app.safety import SafetyGate
from app.settings import Settings


CURRENT_TOKEN_STREAM = ContextVar("CURRENT_TOKEN_STREAM", default=None)
CURRENT_EVENT_SINK = ContextVar("CURRENT_EVENT_SINK", default=None)


class ReferenceState(TypedDict, total=False):
    action: Literal["start", "turn", "finish"]
    session_id: str
    agent_id: str
    status: str
    phase: str
    turn: int
    max_turns: int
    user_message: str
    recent_messages: list[dict[str, str]]
    assistant_message: dict[str, str]
    safety: dict[str, Any]
    llm: dict[str, Any]
    is_complete: bool


def build_checkpointer(settings: Settings):
    if settings.use_postgres_checkpointer:
        try:
            from langgraph.checkpoint.postgres import PostgresSaver

            url = settings.database_url.replace("postgresql+psycopg2://", "postgresql://")
            manager = PostgresSaver.from_conn_string(url)
            if hasattr(manager, "__enter__"):
                saver = manager.__enter__()
                atexit.register(manager.__exit__, None, None, None)
            else:
                saver = manager
            saver.setup()
            return saver
        except Exception:
            if not settings.mock_llm:
                raise
    return MemorySaver()


def build_graph(
    *,
    settings: Settings,
    llm_client: LLMClient,
    safety_gate: SafetyGate,
    checkpointer,
):
    system_prompt = load_prompt()

    def route_action(state: ReferenceState) -> str:
        return state.get("action", "turn")

    def emit_graph_event(event_type: str, node_id: str, payload: dict[str, Any]) -> None:
        sink = CURRENT_EVENT_SINK.get()
        if not callable(sink):
            return
        try:
            sink(event_type, node_id, payload)
        except Exception:
            return

    def trace_node(node_id: str, node_type: str, handler):
        def run(state: ReferenceState) -> ReferenceState:
            span_id = str(uuid4())
            started_perf = time.perf_counter()
            started_at = datetime.now(timezone.utc)
            base_payload = {
                "span_id": span_id,
                "node_id": node_id,
                "node_type": node_type,
                "action": state.get("action"),
                "phase": state.get("phase"),
                "turn": state.get("turn"),
                "source": "runtime_native_span",
            }
            emit_graph_event("span_started", node_id, {**base_payload, "status": "running", "started_at": started_at.isoformat()})
            try:
                result = handler(state)
            except Exception as exc:
                finished_at = datetime.now(timezone.utc)
                duration_ms = round((time.perf_counter() - started_perf) * 1000, 3)
                emit_graph_event(
                    "span_completed",
                    node_id,
                    {
                        **base_payload,
                        "status": "error",
                        "started_at": started_at.isoformat(),
                        "finished_at": finished_at.isoformat(),
                        "duration_ms": duration_ms,
                        "error": str(exc),
                        "span": {
                            "id": span_id,
                            "name": f"node.{node_type}",
                            "operation": "graph_node",
                            "node_id": node_id,
                            "node_type": node_type,
                            "status": "error",
                            "started_at": started_at.isoformat(),
                            "finished_at": finished_at.isoformat(),
                            "duration_ms": duration_ms,
                        },
                    },
                )
                raise
            finished_at = datetime.now(timezone.utc)
            duration_ms = round((time.perf_counter() - started_perf) * 1000, 3)
            status = "error" if isinstance(result, dict) and result.get("status") == "error" else "ok"
            emit_graph_event(
                "span_completed",
                node_id,
                {
                    **base_payload,
                    "status": status,
                    "started_at": started_at.isoformat(),
                    "finished_at": finished_at.isoformat(),
                    "duration_ms": duration_ms,
                    "span": {
                        "id": span_id,
                        "name": f"node.{node_type}",
                        "operation": "graph_node",
                        "node_id": node_id,
                        "node_type": node_type,
                        "status": status,
                        "started_at": started_at.isoformat(),
                        "finished_at": finished_at.isoformat(),
                        "duration_ms": duration_ms,
                    },
                },
            )
            return result

        return run

    def start_node(state: ReferenceState) -> ReferenceState:
        return {
            "status": "active",
            "phase": "awaiting_turn",
            "assistant_message": {
                "code": "ABR",
                "text": (
                    "Olá! Este é o agente de referência. "
                    "Envie uma mensagem para eu ecoar o fluxo com segurança, LLM e estado."
                ),
            },
            "is_complete": False,
        }

    def safety_decision_payload(decision: Any, node_id: str, stage: str | None) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "blocked": decision.blocked,
            "decision": decision.decision,
        }
        for attr in ["category", "reason"]:
            value = getattr(decision, attr, None)
            if value is not None:
                payload[attr] = value
        extra_values = {
            "severity": getattr(decision, "severity", None),
            "action": getattr(decision, "action", None),
            "rule_id": getattr(decision, "rule_id", None),
            "rule_label": getattr(decision, "rule_label", None),
            "match_type": getattr(decision, "match_type", None),
            "matched_text": getattr(decision, "matched_text", None),
            "source": getattr(decision, "source", None),
            "provider_score": getattr(decision, "provider_score", None),
            "provider_error": getattr(decision, "provider_error", None),
        }
        if any(value not in (None, "") for value in extra_values.values()):
            payload["node_id"] = node_id
            if stage:
                payload["stage"] = stage
            for key, value in extra_values.items():
                if value not in (None, ""):
                    payload[key] = value
        return payload

    def input_safety_check(state: ReferenceState) -> ReferenceState:
        decision = safety_gate.check_input(state.get("user_message", ""), {"id": "input_safety_check", "stage": "input"})
        payload = safety_decision_payload(decision, "input_safety_check", "input")
        if decision.blocked:
            return {
                "safety": payload,
                "assistant_message": {"code": "SEG", "text": decision.safe_response or "Mensagem bloqueada."},
                "phase": "safety",
                "is_complete": decision.decision == "block",
                "status": "completed" if decision.decision == "block" else "active",
                "turn": int(state.get("turn") or 0) + 1,
            }
        if payload.get("category"):
            return {"safety": payload}
        return {
            "safety": {"blocked": False, "decision": "allow"},
        }

    def route_after_input_safety(state: ReferenceState) -> str:
        return "blocked" if (state.get("safety") or {}).get("blocked") else "safe"

    def llm_step(state: ReferenceState) -> ReferenceState:
        token_callback = CURRENT_TOKEN_STREAM.get()
        result = llm_client.generate(
            system_prompt=system_prompt,
            user_message=state.get("user_message", ""),
            context={
                "session_id": state.get("session_id"),
                "turn": state.get("turn", 0),
                "max_turns": state.get("max_turns", 3),
                "phase": state.get("phase"),
            },
            recent_messages=state.get("recent_messages", []),
            token_callback=token_callback,
        )
        llm_payload = {
            "provider": result.provider,
            "model": result.model,
            "attempts": result.attempts,
        }
        if result.fallback_reason:
            llm_payload["fallback_reason"] = result.fallback_reason
            llm_payload["setup_command"] = result.setup_command
            llm_payload["docker_setup_command"] = result.docker_setup_command
            llm_payload["provider_error"] = result.provider_error
        return {
            "assistant_message": {"code": "ECHO", "text": result.text},
            "llm": llm_payload,
        }

    def output_safety_check(state: ReferenceState) -> ReferenceState:
        current_message = state.get("assistant_message") or {}
        decision = safety_gate.check_output(str(current_message.get("text") or ""), {"id": "output_safety_check", "stage": "output"})
        payload = safety_decision_payload(decision, "output_safety_check", "output")
        if decision.blocked:
            return {
                "safety": payload,
                "assistant_message": {"code": "SEG", "text": decision.safe_response or "Saída ajustada por segurança."},
            }
        if payload.get("category"):
            return {"safety": payload}
        return {}

    def deterministic_gate(state: ReferenceState) -> ReferenceState:
        next_turn = int(state.get("turn") or 0) + 1
        max_turns = int(state.get("max_turns") or 3)
        if next_turn >= max_turns:
            text = (state.get("assistant_message") or {}).get("text") or "Obrigado pela resposta."
            return {
                "turn": next_turn,
                "status": "completed",
                "phase": "closing",
                "is_complete": True,
                "assistant_message": {
                    "code": "ENC",
                    "text": f"{text}\n\nEncerramos por aqui porque o limite de turnos foi atingido.",
                },
            }
        return {
            "turn": next_turn,
            "status": "active",
            "phase": "awaiting_turn",
            "is_complete": False,
        }

    def finish_node(state: ReferenceState) -> ReferenceState:
        return {
            "status": "completed",
            "phase": "closing",
            "is_complete": True,
            "assistant_message": {"code": "ENC", "text": "Sessão finalizada manualmente."},
        }

    builder = StateGraph(ReferenceState)
    builder.add_node("start_node", trace_node("start_node", "start", start_node))
    builder.add_node("input_safety_check", trace_node("input_safety_check", "safety_gate", input_safety_check))
    builder.add_node("llm_step", trace_node("llm_step", "llm_prompt", llm_step))
    builder.add_node("output_safety_check", trace_node("output_safety_check", "safety_gate", output_safety_check))
    builder.add_node("deterministic_gate", trace_node("deterministic_gate", "code", deterministic_gate))
    builder.add_node("finish_node", trace_node("finish_node", "end", finish_node))

    builder.add_conditional_edges(
        START,
        route_action,
        {"start": "start_node", "turn": "input_safety_check", "finish": "finish_node"},
    )
    builder.add_edge("start_node", END)
    builder.add_conditional_edges(
        "input_safety_check",
        route_after_input_safety,
        {"blocked": END, "safe": "llm_step"},
    )
    builder.add_edge("llm_step", "output_safety_check")
    builder.add_edge("output_safety_check", "deterministic_gate")
    builder.add_edge("deterministic_gate", END)
    builder.add_edge("finish_node", END)

    return builder.compile(checkpointer=checkpointer)
