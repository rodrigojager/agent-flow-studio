import atexit
import json
import urllib.error
import urllib.request
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Literal, TypedDict
from uuid import uuid4

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from sqlalchemy import text

from app.db import session_scope
from app.llm import LLMClient, load_prompt
from app.models import AgentNodeRecord
from app.safety import SafetyGate
from app.settings import Settings


NODE_CONFIGS = json.loads("[\n  {\n    \"id\": \"start_node\",\n    \"type\": \"start\",\n    \"promptFile\": \"system.md\"\n  },\n  {\n    \"id\": \"input_safety_check\",\n    \"type\": \"safety_gate\",\n    \"stage\": \"input\",\n    \"promptFile\": \"system.md\"\n  },\n  {\n    \"id\": \"llm_step\",\n    \"type\": \"llm_prompt\",\n    \"promptFile\": \"system.md\",\n    \"llmAdapter\": \"openai\",\n    \"llmModel\": \"gpt-4.1-mini\"\n  },\n  {\n    \"id\": \"output_safety_check\",\n    \"type\": \"safety_gate\",\n    \"stage\": \"output\",\n    \"promptFile\": \"system.md\"\n  },\n  {\n    \"id\": \"deterministic_gate\",\n    \"type\": \"code\",\n    \"handler\": \"deterministic_gate\",\n    \"promptFile\": \"system.md\"\n  },\n  {\n    \"id\": \"finish_node\",\n    \"type\": \"end\",\n    \"promptFile\": \"system.md\"\n  }\n]")
NODE_CONFIG_BY_ID = {item["id"]: item for item in NODE_CONFIGS}
RAW_ACTION_ROUTE_MAP = json.loads("{\n  \"start\": \"start_node\",\n  \"turn\": \"input_safety_check\",\n  \"finish\": \"finish_node\"\n}")
DEFAULT_ACTION_ROUTE = "start_node"
DEFAULT_PROMPT_FILE = "system.md"
DIRECT_NODE_EDGES_RAW = json.loads("{\n  \"start_node\": \"end\",\n  \"llm_step\": \"output_safety_check\",\n  \"output_safety_check\": \"deterministic_gate\",\n  \"deterministic_gate\": \"end\",\n  \"finish_node\": \"end\"\n}")
NODE_ROUTE_MAP_RAW = json.loads("{\n  \"input_safety_check\": {\n    \"route_0\": \"llm_step\",\n    \"route_1\": \"end\"\n  }\n}")
NODE_ROUTE_CONDITIONS = json.loads("{\n  \"input_safety_check\": [\n    {\n      \"key\": \"route_0\",\n      \"kind\": \"safety_decision\",\n      \"value\": \"allow\"\n    },\n    {\n      \"key\": \"route_1\",\n      \"kind\": \"safety_blocked\",\n      \"value\": true\n    }\n  ]\n}")
START_MESSAGE = "Olá! Este é o Agente de Referência. Envie uma mensagem para eu ecoar o fluxo com segurança, LLM e estado."
CURRENT_DB_SESSION = ContextVar("CURRENT_DB_SESSION", default=None)


@contextmanager
def graph_session_scope():
    current = CURRENT_DB_SESSION.get()
    if current is not None:
        yield current
    else:
        with session_scope() as db:
            yield db


def _node_ids(*, node_type: str, stage: str | None = None) -> list[str]:
    result = []
    for item in NODE_CONFIGS:
        if item["type"] != node_type:
            continue
        if stage is not None and item.get("stage") != stage:
            continue
        result.append(item["id"])
    return result


START_NODE_IDS = _node_ids(node_type="start")
FINISH_NODE_IDS = _node_ids(node_type="end")
INPUT_SAFETY_NODE_IDS = _node_ids(node_type="safety_gate", stage="input")
OUTPUT_SAFETY_NODE_IDS = _node_ids(node_type="safety_gate", stage="output")
LLM_NODE_IDS = [
    item["id"]
    for item in NODE_CONFIGS
    if item["type"] in {"llm_prompt", "llm_structured"}
]
CODE_NODE_IDS = _node_ids(node_type="code")
SWITCH_NODE_IDS = _node_ids(node_type="switch")
HUMAN_INPUT_NODE_IDS = _node_ids(node_type="human_input")
HTTP_REQUEST_NODE_IDS = _node_ids(node_type="http_request")
TRANSFORM_JSON_NODE_IDS = _node_ids(node_type="transform_json")
DATABASE_QUERY_NODE_IDS = _node_ids(node_type="database_query")
DATABASE_SAVE_NODE_IDS = _node_ids(node_type="database_save")


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
    http: dict[str, Any]
    transforms: dict[str, Any]
    database: dict[str, Any]
    is_complete: bool
    executed_nodes: list[str]


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
    prompt_cache: dict[str, str] = {}

    def normalize_graph_target(target: str):
        return END if target == "end" else target

    raw_action_map = dict(RAW_ACTION_ROUTE_MAP)
    raw_action_map["__default__"] = DEFAULT_ACTION_ROUTE
    action_route_map = {key: normalize_graph_target(value) for key, value in raw_action_map.items()}
    direct_node_edges = {key: normalize_graph_target(value) for key, value in DIRECT_NODE_EDGES_RAW.items()}
    node_route_map = {
        node_id: {key: normalize_graph_target(value) for key, value in route_map.items()}
        for node_id, route_map in NODE_ROUTE_MAP_RAW.items()
    }

    def route_action(state: ReferenceState) -> str:
        action = state.get("action", "turn")
        return action if action in action_route_map else "__default__"

    def prompt_for_node(config: dict[str, Any]) -> str:
        prompt_file = str(config.get("promptFile") or DEFAULT_PROMPT_FILE)
        if prompt_file not in prompt_cache:
            prompt_cache[prompt_file] = load_prompt(prompt_file)
        return prompt_cache[prompt_file]

    def mark_node(state: ReferenceState, node_id: str, updates: ReferenceState) -> ReferenceState:
        executed = list(state.get("executed_nodes") or [])
        executed.append(node_id)
        return {**updates, "executed_nodes": executed}

    def state_path_value(state: ReferenceState, path: str):
        current: Any = state
        normalized = str(path or "").removeprefix("state.")
        for part in normalized.split("."):
            if not part:
                continue
            if isinstance(current, dict):
                current = current.get(part)
            else:
                current = getattr(current, part, None)
            if current is None:
                return None
        return current

    def assign_state_path(updates: dict[str, Any], state: ReferenceState, path: str, value: Any) -> None:
        parts = [part for part in str(path or "").removeprefix("state.").split(".") if part]
        if not parts:
            return
        root_key = parts[0]
        if len(parts) == 1:
            updates[root_key] = value
            return
        root = updates.get(root_key)
        if not isinstance(root, dict):
            source_root = state.get(root_key)
            root = dict(source_root) if isinstance(source_root, dict) else {}
            updates[root_key] = root
        current = root
        for part in parts[1:-1]:
            child = current.get(part)
            if not isinstance(child, dict):
                child = {}
                current[part] = child
            current = child
        current[parts[-1]] = value

    def jsonable(value: Any) -> Any:
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        if isinstance(value, (list, tuple)):
            return [jsonable(item) for item in value]
        if isinstance(value, dict):
            return {str(key): jsonable(item) for key, item in value.items()}
        return str(value)

    def normalized_params(value: Any, state: ReferenceState) -> dict[str, Any]:
        if value is None:
            params: dict[str, Any] = {}
        elif isinstance(value, dict):
            params = dict(value)
        else:
            params = {"value": value}
        params.setdefault("session_id", state.get("session_id"))
        return params

    def is_sql_identifier(value: str) -> bool:
        first = value[:1]
        return bool(first) and (first.isalpha() or first == "_") and all(part.isalnum() or part == "_" for part in value)

    def remember_database_result(state: ReferenceState, node_id: str, result_path: str, result: dict[str, Any]) -> ReferenceState:
        updates: dict[str, Any] = {}
        database_results = dict(state.get("database") or {})
        database_results[node_id] = result
        updates["database"] = database_results
        if result_path != f"database.{node_id}":
            assign_state_path(updates, state, result_path, result)
        return mark_node(state, node_id, updates)

    def make_start_node(config: dict[str, Any]):
        node_id = config["id"]

        def run(state: ReferenceState) -> ReferenceState:
            return mark_node(state, node_id, {
                "status": "active",
                "phase": "awaiting_turn",
                "assistant_message": {"code": "ABR", "text": START_MESSAGE},
                "is_complete": False,
            })

        return run

    def make_safety_node(config: dict[str, Any]):
        node_id = config["id"]
        stage = config.get("stage")

        def run(state: ReferenceState) -> ReferenceState:
            if stage == "input":
                decision = safety_gate.check_input(state.get("user_message", ""))
                if decision.blocked:
                    return mark_node(state, node_id, {
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
                    })
                return mark_node(state, node_id, {
                    "safety": {"blocked": False, "decision": "allow"},
                })

            if stage == "output":
                current_message = state.get("assistant_message") or {}
                decision = safety_gate.check_output(str(current_message.get("text") or ""))
                if decision.blocked:
                    return mark_node(state, node_id, {
                        "safety": {
                            "blocked": True,
                            "decision": decision.decision,
                            "category": decision.category,
                            "reason": decision.reason,
                        },
                        "assistant_message": {"code": "SEG", "text": decision.safe_response or "Saída ajustada por segurança."},
                    })
                return mark_node(state, node_id, {})

            return mark_node(state, node_id, {})

        return run

    def make_llm_node(config: dict[str, Any]):
        node_id = config["id"]

        def run(state: ReferenceState) -> ReferenceState:
            result = llm_client.generate(
                system_prompt=prompt_for_node(config),
                user_message=state.get("user_message", ""),
                context={
                    "session_id": state.get("session_id"),
                    "turn": state.get("turn", 0),
                    "max_turns": state.get("max_turns", 3),
                    "phase": state.get("phase"),
                    "node_id": node_id,
                },
                recent_messages=state.get("recent_messages", []),
                adapter=config.get("llmAdapter"),
                model=config.get("llmModel"),
            )
            return mark_node(state, node_id, {
                "assistant_message": {"code": "ECHO", "text": result.text},
                "llm": {
                    "provider": result.provider,
                    "model": result.model,
                    "attempts": result.attempts,
                    "node_id": node_id,
                },
            })

        return run

    def make_code_node(config: dict[str, Any]):
        node_id = config["id"]
        handler = config.get("handler")

        def deterministic_gate(state: ReferenceState) -> ReferenceState:
            next_turn = int(state.get("turn") or 0) + 1
            max_turns = int(state.get("max_turns") or 3)
            if next_turn >= max_turns:
                text = (state.get("assistant_message") or {}).get("text") or "Obrigado pela resposta."
                return mark_node(state, node_id, {
                    "turn": next_turn,
                    "status": "completed",
                    "phase": "closing",
                    "is_complete": True,
                    "assistant_message": {
                        "code": "ENC",
                        "text": f"{text}\n\nEncerramos por aqui porque o limite de turnos foi atingido.",
                    },
                })
            return mark_node(state, node_id, {
                "turn": next_turn,
                "status": "active",
                "phase": "awaiting_turn",
                "is_complete": False,
            })

        def noop_code(state: ReferenceState) -> ReferenceState:
            return mark_node(state, node_id, {})

        return deterministic_gate if handler == "deterministic_gate" else noop_code

    def make_switch_node(config: dict[str, Any]):
        node_id = config["id"]

        def run(state: ReferenceState) -> ReferenceState:
            return mark_node(state, node_id, {})

        return run

    def make_human_input_node(config: dict[str, Any]):
        node_id = config["id"]

        def run(state: ReferenceState) -> ReferenceState:
            updates: ReferenceState = {
                "status": "active",
                "phase": "awaiting_turn",
                "is_complete": False,
            }
            if not state.get("assistant_message"):
                updates["assistant_message"] = {"code": "WAIT", "text": "Aguardando entrada do usuário."}
            return mark_node(state, node_id, updates)

        return run

    def make_http_request_node(config: dict[str, Any]):
        node_id = config["id"]
        method = str(config.get("method") or "GET").upper()
        url = str(config.get("url") or "")
        body_path = str(config.get("bodyPath") or "")
        response_path = str(config.get("responsePath") or f"http.{node_id}")
        timeout = int(config.get("timeoutSeconds") or 10)

        def run(state: ReferenceState) -> ReferenceState:
            request_body = state_path_value(state, body_path) if body_path else None
            if not url:
                response = {
                    "ok": False,
                    "skipped": True,
                    "method": method,
                    "url": url,
                    "reason": "url_not_configured",
                }
            elif url.startswith("mock://"):
                response = {
                    "ok": True,
                    "mock": True,
                    "method": method,
                    "url": url,
                    "request": request_body,
                }
            else:
                try:
                    data = None
                    headers = {"Accept": "application/json"}
                    if request_body is not None and method not in {"GET", "DELETE"}:
                        data = json.dumps(request_body).encode("utf-8")
                        headers["Content-Type"] = "application/json"
                    request = urllib.request.Request(url, data=data, headers=headers, method=method)
                    with urllib.request.urlopen(request, timeout=timeout) as result:
                        raw = result.read().decode("utf-8", errors="replace")
                        try:
                            content: Any = json.loads(raw)
                        except json.JSONDecodeError:
                            content = raw
                        response = {
                            "ok": 200 <= result.status < 400,
                            "status_code": result.status,
                            "method": method,
                            "url": url,
                            "body": content,
                        }
                except urllib.error.HTTPError as exc:
                    raw = exc.read().decode("utf-8", errors="replace")
                    response = {
                        "ok": False,
                        "status_code": exc.code,
                        "method": method,
                        "url": url,
                        "error": raw,
                    }
                except Exception as exc:
                    response = {
                        "ok": False,
                        "method": method,
                        "url": url,
                        "error": str(exc),
                    }

            updates: dict[str, Any] = {}
            http_results = dict(state.get("http") or {})
            http_results[node_id] = response
            updates["http"] = http_results
            if response_path != f"http.{node_id}":
                assign_state_path(updates, state, response_path, response)
            return mark_node(state, node_id, updates)

        return run

    def make_transform_json_node(config: dict[str, Any]):
        node_id = config["id"]
        input_path = str(config.get("inputPath") or "assistant_message")
        output_path = str(config.get("outputPath") or f"transforms.{node_id}")

        def run(state: ReferenceState) -> ReferenceState:
            value = state_path_value(state, input_path)
            transformed = {
                "node_id": node_id,
                "input_path": input_path,
                "value": value,
            }
            updates: dict[str, Any] = {}
            transform_results = dict(state.get("transforms") or {})
            transform_results[node_id] = transformed
            updates["transforms"] = transform_results
            if output_path != f"transforms.{node_id}":
                assign_state_path(updates, state, output_path, transformed)
            return mark_node(state, node_id, updates)

        return run

    def make_database_query_node(config: dict[str, Any]):
        node_id = config["id"]
        query = str(config.get("query") or "")
        params_path = str(config.get("paramsPath") or "")
        result_path = str(config.get("resultPath") or f"database.{node_id}")
        max_rows = int(config.get("maxRows") or 50)

        def run(state: ReferenceState) -> ReferenceState:
            if not query.strip():
                result_payload = {
                    "ok": False,
                    "skipped": True,
                    "reason": "query_not_configured",
                }
                return remember_database_result(state, node_id, result_path, result_payload)

            params_value = state_path_value(state, params_path) if params_path else {}
            params = normalized_params(params_value, state)
            try:
                with graph_session_scope() as db:
                    result = db.execute(text(query), params)
                    if result.returns_rows:
                        rows = [dict(row) for row in result.mappings().fetchmany(max_rows)]
                        result_payload = {
                            "ok": True,
                            "rows": jsonable(rows),
                            "row_count": len(rows),
                            "max_rows": max_rows,
                        }
                    else:
                        result_payload = {
                            "ok": True,
                            "rows": [],
                            "row_count": result.rowcount,
                            "max_rows": max_rows,
                        }
            except Exception as exc:
                result_payload = {
                    "ok": False,
                    "error": str(exc),
                }
            return remember_database_result(state, node_id, result_path, result_payload)

        return run

    def make_database_save_node(config: dict[str, Any]):
        node_id = config["id"]
        table = str(config.get("table") or "agent_node_records")
        query = str(config.get("query") or "")
        data_path = str(config.get("dataPath") or "assistant_message")
        params_path = str(config.get("paramsPath") or data_path)
        result_path = str(config.get("resultPath") or f"database.{node_id}")

        def run(state: ReferenceState) -> ReferenceState:
            data_value = jsonable(state_path_value(state, data_path))
            params = normalized_params(state_path_value(state, params_path), state)
            try:
                with graph_session_scope() as db:
                    if query.strip():
                        result = db.execute(text(query), params)
                        result_payload = {
                            "ok": True,
                            "mode": "query",
                            "row_count": result.rowcount,
                        }
                    elif table == "agent_node_records":
                        record_id = str(uuid4())
                        db.add(
                            AgentNodeRecord(
                                record_id=record_id,
                                session_id=str(state.get("session_id") or ""),
                                node_id=node_id,
                                payload_json=data_value,
                            )
                        )
                        db.flush()
                        result_payload = {
                            "ok": True,
                            "mode": "node_record",
                            "table": table,
                            "record_id": record_id,
                        }
                    else:
                        if not is_sql_identifier(table):
                            raise ValueError("Tabela configurada não é um identificador SQL simples.")
                        if not isinstance(data_value, dict):
                            raise ValueError("database_save em tabela customizada exige dataPath apontando para objeto JSON.")
                        columns = sorted(data_value)
                        for column in columns:
                            if not is_sql_identifier(column):
                                raise ValueError(f"Coluna inválida para insert: {column}")
                        column_sql = ", ".join(columns)
                        values_sql = ", ".join(f":{column}" for column in columns)
                        db.execute(text(f"INSERT INTO {table} ({column_sql}) VALUES ({values_sql})"), data_value)
                        result_payload = {
                            "ok": True,
                            "mode": "insert",
                            "table": table,
                            "row_count": 1,
                        }
            except Exception as exc:
                result_payload = {
                    "ok": False,
                    "table": table,
                    "error": str(exc),
                }
            return remember_database_result(state, node_id, result_path, result_payload)

        return run

    def make_finish_node(config: dict[str, Any]):
        node_id = config["id"]

        def run(state: ReferenceState) -> ReferenceState:
            return mark_node(state, node_id, {
                "status": "completed",
                "phase": "closing",
                "is_complete": True,
                "assistant_message": {"code": "ENC", "text": "Sessão finalizada manualmente."},
            })

        return run

    def make_noop_node(config: dict[str, Any]):
        node_id = config["id"]

        def run(state: ReferenceState) -> ReferenceState:
            return mark_node(state, node_id, {})

        return run

    def handler_for_node(config: dict[str, Any]):
        node_type = config["type"]
        if node_type == "start":
            return make_start_node(config)
        if node_type == "safety_gate":
            return make_safety_node(config)
        if node_type in {"llm_prompt", "llm_structured"}:
            return make_llm_node(config)
        if node_type == "code":
            return make_code_node(config)
        if node_type == "switch":
            return make_switch_node(config)
        if node_type == "human_input":
            return make_human_input_node(config)
        if node_type == "http_request":
            return make_http_request_node(config)
        if node_type == "transform_json":
            return make_transform_json_node(config)
        if node_type == "database_query":
            return make_database_query_node(config)
        if node_type == "database_save":
            return make_database_save_node(config)
        if node_type == "end":
            return make_finish_node(config)
        return make_noop_node(config)

    def compare_values(left: Any, operator: str, right: Any) -> bool:
        if operator == "==":
            return left == right
        if operator == "!=":
            return left != right
        try:
            left_number = float(left)
            right_number = float(right)
        except (TypeError, ValueError):
            return False
        if operator == ">=":
            return left_number >= right_number
        if operator == "<=":
            return left_number <= right_number
        if operator == ">":
            return left_number > right_number
        if operator == "<":
            return left_number < right_number
        return False

    def condition_matches(state: ReferenceState, condition: dict[str, Any]) -> bool:
        kind = condition.get("kind")
        if kind == "always":
            return True
        if kind == "all":
            return all(condition_matches(state, item) for item in condition.get("conditions", []))
        if kind == "safety_blocked":
            return bool((state.get("safety") or {}).get("blocked")) is bool(condition.get("value"))
        if kind == "safety_decision":
            return (state.get("safety") or {}).get("decision") == condition.get("value")
        if kind == "status_equals":
            return state.get("status") == condition.get("value")
        if kind == "phase_equals":
            return state.get("phase") == condition.get("value")
        if kind == "state_compare":
            left = state_path_value(state, condition.get("path", ""))
            right = state_path_value(state, condition["rightPath"]) if "rightPath" in condition else condition.get("value")
            return compare_values(left, condition.get("operator", "=="), right)
        return False

    def make_route_after_node(node_id: str):
        conditions = NODE_ROUTE_CONDITIONS.get(node_id, [])
        fallback = conditions[0]["key"] if conditions else "__end__"

        def route(state: ReferenceState) -> str:
            for condition in conditions:
                if condition_matches(state, condition):
                    return condition["key"]
            return fallback

        return route

    builder = StateGraph(ReferenceState)
    for config in NODE_CONFIGS:
        builder.add_node(config["id"], handler_for_node(config))

    builder.add_conditional_edges(START, route_action, action_route_map)
    for node_id, target in direct_node_edges.items():
        builder.add_edge(node_id, target)
    for node_id, route_map in node_route_map.items():
        builder.add_conditional_edges(node_id, make_route_after_node(node_id), route_map)

    return builder.compile(checkpointer=checkpointer)
