import atexit
from typing import Any, Literal, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.checkpoint.memory import MemorySaver

from app.llm import LLMClient, load_prompt
from app.safety import SafetyGate
from app.settings import Settings


class ReferenceState(TypedDict, total=False):
    action: Literal["start", "turn", "finish"]
    session_id: str
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

    def input_safety_check(state: ReferenceState) -> ReferenceState:
        decision = safety_gate.check_input(state.get("user_message", ""))
        if decision.blocked:
            return {
                "safety": {
                    "blocked": True,
                    "decision": decision.decision,
                    "category": decision.category,
                    "reason": decision.reason,
                },
                "assistant_message": {"code": "SEG", "text": decision.safe_response or "Mensagem bloqueada."},
                "phase": "safety",
                "is_complete": decision.decision == "block",
                "status": "completed" if decision.decision == "block" else "active",
                "turn": int(state.get("turn") or 0) + 1,
            }
        return {
            "safety": {"blocked": False, "decision": "allow"},
        }

    def route_after_input_safety(state: ReferenceState) -> str:
        return "blocked" if (state.get("safety") or {}).get("blocked") else "safe"

    def llm_step(state: ReferenceState) -> ReferenceState:
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
        )
        return {
            "assistant_message": {"code": "ECHO", "text": result.text},
            "llm": {
                "provider": result.provider,
                "model": result.model,
                "attempts": result.attempts,
            },
        }

    def output_safety_check(state: ReferenceState) -> ReferenceState:
        current_message = state.get("assistant_message") or {}
        decision = safety_gate.check_output(str(current_message.get("text") or ""))
        if decision.blocked:
            return {
                "safety": {
                    "blocked": True,
                    "decision": decision.decision,
                    "category": decision.category,
                    "reason": decision.reason,
                },
                "assistant_message": {"code": "SEG", "text": decision.safe_response or "Saída ajustada por segurança."},
            }
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
    builder.add_node("start_node", start_node)
    builder.add_node("input_safety_check", input_safety_check)
    builder.add_node("llm_step", llm_step)
    builder.add_node("output_safety_check", output_safety_check)
    builder.add_node("deterministic_gate", deterministic_gate)
    builder.add_node("finish_node", finish_node)

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
