import atexit
import inspect
import json
import subprocess
import time
import traceback
import urllib.error
import urllib.request
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
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
FILES_ROOT = Path(__file__).resolve().parent / "files"
CODE_ROOT = Path(__file__).resolve().parent / "code"


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
FILE_EXTRACT_NODE_IDS = _node_ids(node_type="file_extract")
RAG_RETRIEVAL_NODE_IDS = _node_ids(node_type="rag_retrieval")
APPROVAL_GATE_NODE_IDS = _node_ids(node_type="approval_gate")
SCORING_NODE_IDS = _node_ids(node_type="scoring")
ANALYTICS_NODE_IDS = _node_ids(node_type="analytics")


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
    http: dict[str, Any]
    transforms: dict[str, Any]
    database: dict[str, Any]
    files: dict[str, Any]
    rag: dict[str, Any]
    approvals: dict[str, Any]
    scores: dict[str, Any]
    analytics: dict[str, Any]
    custom: dict[str, Any]
    session_metadata: dict[str, Any]
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
        if not path or str(path).strip() in {"state", "."}:
            return state
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

    def pinned_node_output(state: ReferenceState, node_id: str) -> tuple[bool, Any]:
        metadata = state.get("session_metadata") or {}
        if not isinstance(metadata, dict):
            return False, None
        node_pins = metadata.get("nodePins") or metadata.get("node_pins")
        if not isinstance(node_pins, dict) or node_pins.get("enabled") is not True:
            return False, None
        items = node_pins.get("items")
        if not isinstance(items, list):
            return False, None
        for item in items:
            if isinstance(item, dict) and item.get("nodeId") == node_id:
                return True, item.get("output")
        return False, None

    def pinned_payload(output: Any) -> dict[str, Any]:
        payload = dict(output) if isinstance(output, dict) else {"value": output}
        payload.setdefault("mock", True)
        payload.setdefault("pinned", True)
        return payload

    def pinned_assistant_message(output: Any, fallback: str) -> dict[str, str]:
        payload = output if isinstance(output, dict) else {}
        assistant = None
        if isinstance(payload, dict):
            assistant = payload.get("assistant_message") or payload.get("assistantMessage")
        if isinstance(assistant, dict):
            text = assistant.get("text") or assistant.get("content") or fallback
            code = assistant.get("code") or "PIN"
            return {"code": str(code), "text": str(text)}
        if isinstance(payload, dict):
            for key in ("text", "content", "message", "value"):
                value = payload.get(key)
                if isinstance(value, (str, int, float, bool)) and str(value).strip():
                    return {"code": "PIN", "text": str(value)}
        if output is not None and not isinstance(output, dict):
            return {"code": "PIN", "text": str(output)}
        return {"code": "PIN", "text": fallback}

    def pinned_category_updates(
        state: ReferenceState,
        node_id: str,
        root_key: str,
        result_path: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        updates: dict[str, Any] = {}
        results = dict(state.get(root_key) or {})
        results[node_id] = payload
        updates[root_key] = results
        default_path = f"{root_key}.{node_id}"
        if result_path != default_path:
            assign_state_path(updates, state, result_path, payload)
        return updates

    def apply_pinned_state_overrides(updates: dict[str, Any], payload: dict[str, Any]) -> None:
        for key in ("status", "phase", "turn", "is_complete"):
            if key in payload:
                updates[key] = payload[key]
        assistant = payload.get("assistant_message") or payload.get("assistantMessage")
        if isinstance(assistant, dict) and "assistant_message" not in updates:
            updates["assistant_message"] = {
                "code": str(assistant.get("code") or "PIN"),
                "text": str(assistant.get("text") or assistant.get("content") or "Resposta fixada por pin de nó."),
            }

    def pinned_node_update(
        state: ReferenceState,
        node_id: str,
        kind: str,
        *,
        result_path: str | None = None,
    ) -> ReferenceState | None:
        found, output = pinned_node_output(state, node_id)
        if not found:
            return None
        payload = pinned_payload(output)
        updates: dict[str, Any] = {}
        if kind == "start":
            updates.update({
                "status": "active",
                "phase": "awaiting_turn",
                "assistant_message": pinned_assistant_message(output, START_MESSAGE),
                "is_complete": False,
            })
        elif kind == "finish":
            updates.update({
                "status": "completed",
                "phase": "closing",
                "assistant_message": pinned_assistant_message(output, "Sessão finalizada por replay de pin."),
                "is_complete": True,
            })
        elif kind == "human_input":
            updates.update({
                "status": "active",
                "phase": "awaiting_turn",
                "is_complete": False,
                "assistant_message": pinned_assistant_message(output, "Aguardando entrada do usuário."),
            })
        elif kind == "llm":
            llm_payload = dict(payload)
            llm_payload.setdefault("provider", "pinned")
            llm_payload.setdefault("model", "pinned")
            llm_payload.setdefault("attempts", 0)
            llm_payload.setdefault("node_id", node_id)
            updates["assistant_message"] = pinned_assistant_message(output, "Resposta fixada por pin de nó.")
            updates["llm"] = llm_payload
        elif kind == "safety":
            safety_source = payload.get("safety") if isinstance(payload.get("safety"), dict) else payload
            safety_payload = dict(safety_source) if isinstance(safety_source, dict) else {"value": safety_source}
            safety_payload.setdefault("blocked", False)
            safety_payload.setdefault("decision", "allow")
            safety_payload.setdefault("mock", True)
            safety_payload.setdefault("pinned", True)
            updates["safety"] = safety_payload
            if safety_payload.get("blocked"):
                updates["assistant_message"] = pinned_assistant_message(output, "Mensagem bloqueada por replay de pin.")
                updates["phase"] = "safety"
                updates["is_complete"] = safety_payload.get("decision") == "block"
                updates["status"] = "completed" if updates["is_complete"] else "active"
        elif kind == "code":
            payload.setdefault("status", "custom_code_executed")
            payload.setdefault("node_id", node_id)
            updates.update(pinned_category_updates(state, node_id, "custom", result_path or f"custom.{node_id}", payload))
        elif kind == "http":
            updates.update(pinned_category_updates(state, node_id, "http", result_path or f"http.{node_id}", payload))
        elif kind == "transform":
            updates.update(pinned_category_updates(state, node_id, "transforms", result_path or f"transforms.{node_id}", payload))
        elif kind == "database":
            updates.update(pinned_category_updates(state, node_id, "database", result_path or f"database.{node_id}", payload))
        elif kind == "file":
            updates.update(pinned_category_updates(state, node_id, "files", result_path or f"files.{node_id}", payload))
        elif kind == "rag":
            updates.update(pinned_category_updates(state, node_id, "rag", result_path or f"rag.{node_id}", payload))
        elif kind == "approval":
            updates.update(pinned_category_updates(state, node_id, "approvals", result_path or f"approvals.{node_id}", payload))
        elif kind == "score":
            updates.update(pinned_category_updates(state, node_id, "scores", result_path or f"scores.{node_id}", payload))
        elif kind == "analytics":
            updates.update(pinned_category_updates(state, node_id, "analytics", result_path or f"analytics.{node_id}", payload))
        else:
            custom = dict(state.get("custom") or {})
            custom[node_id] = payload
            updates["custom"] = custom
        apply_pinned_state_overrides(updates, payload)
        return mark_node(state, node_id, updates)

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

    def safe_asset_path(relative_path: str) -> Path:
        candidate = Path(relative_path or "")
        if candidate.is_absolute() or ".." in candidate.parts:
            raise ValueError("Caminho de arquivo deve ser relativo a app/files e não pode usar '..'.")
        resolved = (FILES_ROOT / candidate).resolve()
        root = FILES_ROOT.resolve()
        if root not in [resolved, *resolved.parents]:
            raise ValueError("Caminho de arquivo sai de app/files.")
        return resolved

    def safe_code_path(relative_path: str) -> Path:
        raw_path = str(relative_path or "").replace("\\", "/")
        candidate = Path(raw_path)
        if candidate.parts and candidate.parts[0] == "code":
            candidate = Path(*candidate.parts[1:]) if len(candidate.parts) > 1 else Path("")
        if not candidate.parts or candidate.is_absolute() or ".." in candidate.parts:
            raise ValueError("codePath deve ser relativo a app/code e não pode usar '..'.")
        resolved = (CODE_ROOT / candidate).resolve()
        root = CODE_ROOT.resolve()
        if root not in [resolved, *resolved.parents]:
            raise ValueError("codePath sai de app/code.")
        return resolved

    def call_custom_entry(entry: Any, input_value: Any, context: dict[str, Any]) -> Any:
        signature = inspect.signature(entry)
        positional = [
            parameter
            for parameter in signature.parameters.values()
            if parameter.kind in {inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD}
        ]
        has_varargs = any(parameter.kind == inspect.Parameter.VAR_POSITIONAL for parameter in signature.parameters.values())
        if has_varargs or len(positional) >= 2:
            return entry(input_value, context)
        if len(positional) == 1:
            return entry(input_value)
        return entry()

    def execute_custom_python_code(config: dict[str, Any], state: ReferenceState, contract: dict[str, Any]) -> dict[str, Any]:
        node_id = config["id"]
        started_at = time.perf_counter()
        entry_name = str(config.get("codeEntry") or "run")
        source_path = config.get("codePath")
        inline_source = config.get("codeInline")
        if inline_source:
            source = str(inline_source)
            filename = f"<agent-flow:{node_id}>"
        elif source_path:
            path = safe_code_path(str(source_path))
            source = path.read_text(encoding="utf-8")
            filename = str(path)
        else:
            return {
                "ok": False,
                "status": "custom_code_not_executed",
                "node_id": node_id,
                "contract": contract,
                "reason": "missing_code_source",
            }

        namespace: dict[str, Any] = {
            "__builtins__": __builtins__,
            "json": json,
            "Path": Path,
        }
        exec(compile(source, filename, "exec"), namespace)
        entry = namespace.get(entry_name)
        if not callable(entry):
            return {
                "ok": False,
                "status": "custom_code_failed",
                "node_id": node_id,
                "contract": contract,
                "error": f"Entry point não encontrado ou não chamável: {entry_name}",
            }

        input_path = str(config.get("inputPath") or "state")
        input_value = state_path_value(state, input_path)
        context = {
            "node_id": node_id,
            "session_id": state.get("session_id"),
            "turn": state.get("turn"),
            "input_path": input_path,
            "state": state,
            "settings": settings,
            "llm_client": llm_client,
            "state_path_value": state_path_value,
            "jsonable": jsonable,
        }
        output = call_custom_entry(entry, input_value, context)
        return {
            "ok": True,
            "status": "custom_code_executed",
            "node_id": node_id,
            "contract": contract,
            "output": jsonable(output),
            "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
        }

    def execute_custom_node_code(config: dict[str, Any], state: ReferenceState, contract: dict[str, Any]) -> dict[str, Any]:
        node_id = config["id"]
        started_at = time.perf_counter()
        entry_name = str(config.get("codeEntry") or "run")
        source_path = config.get("codePath")
        inline_source = config.get("codeInline")
        language = str(config.get("codeLanguage") or "javascript").lower()
        request: dict[str, Any] = {
            "entry": entry_name,
            "language": language,
        }
        if inline_source:
            request["inlineSource"] = str(inline_source)
        elif source_path:
            request["sourcePath"] = str(safe_code_path(str(source_path)))
        else:
            return {
                "ok": False,
                "status": "custom_code_not_executed",
                "node_id": node_id,
                "contract": contract,
                "reason": "missing_code_source",
            }

        input_path = str(config.get("inputPath") or "state")
        input_value = state_path_value(state, input_path)
        request["input"] = jsonable(input_value)
        request["context"] = {
            "node_id": node_id,
            "session_id": state.get("session_id"),
            "turn": state.get("turn"),
            "input_path": input_path,
            "state": jsonable(state),
        }

        runner_path = Path(__file__).resolve().parent / "code_runner.mjs"
        timeout_seconds = int(config.get("timeoutSeconds") or 30)
        completed = subprocess.run(
            ["node", str(runner_path)],
            input=json.dumps(request),
            text=True,
            capture_output=True,
            timeout=timeout_seconds,
            check=False,
        )
        stdout = (completed.stdout or "").strip()
        stderr = (completed.stderr or "").strip()
        try:
            runner_result = json.loads(stdout) if stdout else {}
        except json.JSONDecodeError:
            runner_result = {"ok": False, "error": {"message": stdout or "empty_node_output"}}
        if completed.returncode != 0 or not runner_result.get("ok"):
            error = runner_result.get("error")
            return {
                "ok": False,
                "status": "custom_code_failed",
                "node_id": node_id,
                "contract": contract,
                "error": error.get("message") if isinstance(error, dict) else str(error or "node_runner_failed"),
                "stderr": stderr,
            }
        return {
            "ok": True,
            "status": "custom_code_executed",
            "node_id": node_id,
            "contract": contract,
            "output": jsonable(runner_result.get("output")),
            "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
        }

    def execute_custom_http_code(config: dict[str, Any], state: ReferenceState, contract: dict[str, Any]) -> dict[str, Any]:
        node_id = config["id"]
        started_at = time.perf_counter()
        method = str(config.get("method") or "POST").upper()
        url = str(config.get("url") or "")
        input_path = str(config.get("inputPath") or "state")
        input_value = state_path_value(state, input_path)
        if not url:
            return {
                "ok": False,
                "status": "custom_code_not_executed",
                "node_id": node_id,
                "contract": contract,
                "reason": "url_not_configured",
            }

        request_payload = {
            "input": jsonable(input_value),
            "context": {
                "node_id": node_id,
                "session_id": state.get("session_id"),
                "turn": state.get("turn"),
                "input_path": input_path,
                "state": jsonable(state),
            },
            "contract": contract,
        }
        if url.startswith("mock://"):
            return {
                "ok": True,
                "status": "custom_code_executed",
                "node_id": node_id,
                "contract": contract,
                "output": {
                    "mock": True,
                    "method": method,
                    "url": url,
                    "request": request_payload,
                },
                "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
            }

        try:
            data = None
            headers = {"Accept": "application/json"}
            if method not in {"GET", "DELETE"}:
                data = json.dumps(request_payload).encode("utf-8")
                headers["Content-Type"] = "application/json"
            request = urllib.request.Request(url, data=data, headers=headers, method=method)
            timeout = int(config.get("timeoutSeconds") or 30)
            with urllib.request.urlopen(request, timeout=timeout) as result:
                raw = result.read().decode("utf-8", errors="replace")
                try:
                    content: Any = json.loads(raw) if raw else None
                except json.JSONDecodeError:
                    content = raw
                if isinstance(content, dict):
                    external_ok = bool(content.get("ok", True))
                    output = content.get("output") if "output" in content else content
                    error = content.get("error")
                else:
                    external_ok = True
                    output = content
                    error = None
                return {
                    "ok": external_ok and 200 <= result.status < 400,
                    "status": "custom_code_executed" if external_ok and 200 <= result.status < 400 else "custom_code_failed",
                    "node_id": node_id,
                    "contract": contract,
                    "output": jsonable(output),
                    "status_code": result.status,
                    "error": error,
                    "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
                }
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            return {
                "ok": False,
                "status": "custom_code_failed",
                "node_id": node_id,
                "contract": contract,
                "status_code": exc.code,
                "error": raw,
                "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
            }
        except Exception as exc:
            return {
                "ok": False,
                "status": "custom_code_failed",
                "node_id": node_id,
                "contract": contract,
                "error": str(exc),
                "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
            }

    def execute_custom_sidecar_code(config: dict[str, Any], state: ReferenceState, contract: dict[str, Any]) -> dict[str, Any]:
        node_id = config["id"]
        started_at = time.perf_counter()
        command = str(config.get("sidecarCommand") or "").strip()
        raw_args = config.get("sidecarArgs") or []
        if isinstance(raw_args, str):
            sidecar_args = [item.strip() for item in raw_args.splitlines() if item.strip()]
        elif isinstance(raw_args, list):
            sidecar_args = [str(item).strip() for item in raw_args if str(item).strip()]
        else:
            sidecar_args = []
        input_path = str(config.get("inputPath") or "state")
        input_value = state_path_value(state, input_path)
        if not command:
            return {
                "ok": False,
                "status": "custom_code_not_executed",
                "node_id": node_id,
                "contract": contract,
                "reason": "sidecar_command_not_configured",
            }

        request_payload = {
            "input": jsonable(input_value),
            "context": {
                "node_id": node_id,
                "session_id": state.get("session_id"),
                "turn": state.get("turn"),
                "input_path": input_path,
                "state": jsonable(state),
            },
            "contract": contract,
        }
        timeout_seconds = int(config.get("timeoutSeconds") or 30)
        try:
            completed = subprocess.run(
                [command, *sidecar_args],
                input=json.dumps(request_payload),
                text=True,
                capture_output=True,
                timeout=timeout_seconds,
                cwd=str(CODE_ROOT),
                check=False,
            )
            stdout = (completed.stdout or "").strip()
            stderr = (completed.stderr or "").strip()
            try:
                content: Any = json.loads(stdout) if stdout else None
            except json.JSONDecodeError:
                content = stdout
            if isinstance(content, dict):
                external_ok = bool(content.get("ok", True))
                output = content.get("output") if "output" in content else content
                error = content.get("error")
            else:
                external_ok = True
                output = content
                error = None
            ok = completed.returncode == 0 and external_ok
            return {
                "ok": ok,
                "status": "custom_code_executed" if ok else "custom_code_failed",
                "node_id": node_id,
                "contract": contract,
                "output": jsonable(output),
                "exit_code": completed.returncode,
                "stderr": stderr,
                "error": error,
                "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
            }
        except subprocess.TimeoutExpired as exc:
            return {
                "ok": False,
                "status": "custom_code_failed",
                "node_id": node_id,
                "contract": contract,
                "error": f"sidecar_timeout_after_{timeout_seconds}s",
                "stdout": str(exc.stdout or ""),
                "stderr": str(exc.stderr or ""),
                "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
            }
        except Exception as exc:
            return {
                "ok": False,
                "status": "custom_code_failed",
                "node_id": node_id,
                "contract": contract,
                "error": str(exc),
                "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
            }

    def execute_custom_mcp_code(config: dict[str, Any], state: ReferenceState, contract: dict[str, Any]) -> dict[str, Any]:
        node_id = config["id"]
        started_at = time.perf_counter()
        command = str(config.get("mcpCommand") or "").strip()
        tool_name = str(config.get("mcpToolName") or "").strip()
        raw_args = config.get("mcpArgs") or []
        if isinstance(raw_args, str):
            mcp_args = [item.strip() for item in raw_args.splitlines() if item.strip()]
        elif isinstance(raw_args, list):
            mcp_args = [str(item).strip() for item in raw_args if str(item).strip()]
        else:
            mcp_args = []
        input_path = str(config.get("inputPath") or "state")
        input_value = state_path_value(state, input_path)
        if not command:
            return {
                "ok": False,
                "status": "custom_code_not_executed",
                "node_id": node_id,
                "contract": contract,
                "reason": "mcp_command_not_configured",
            }
        if not tool_name:
            return {
                "ok": False,
                "status": "custom_code_not_executed",
                "node_id": node_id,
                "contract": contract,
                "reason": "mcp_tool_not_configured",
            }

        tool_arguments = input_value if isinstance(input_value, dict) else {"input": jsonable(input_value)}
        protocol_version = str(config.get("mcpProtocolVersion") or "2025-11-25")
        messages = [
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": protocol_version,
                    "capabilities": {},
                    "clientInfo": {"name": "agent-flow-runtime", "version": "0.1.0"},
                },
            },
            {
                "jsonrpc": "2.0",
                "method": "notifications/initialized",
                "params": {},
            },
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": tool_name,
                    "arguments": jsonable(tool_arguments),
                },
            },
        ]
        stdin_payload = "\n".join(json.dumps(message) for message in messages) + "\n"
        timeout_seconds = int(config.get("timeoutSeconds") or 30)
        try:
            completed = subprocess.run(
                [command, *mcp_args],
                input=stdin_payload,
                text=True,
                capture_output=True,
                timeout=timeout_seconds,
                cwd=str(CODE_ROOT),
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            return {
                "ok": False,
                "status": "custom_code_failed",
                "node_id": node_id,
                "contract": contract,
                "error": f"mcp_timeout_after_{timeout_seconds}s",
                "stdout": str(exc.stdout or ""),
                "stderr": str(exc.stderr or ""),
                "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
            }
        except Exception as exc:
            return {
                "ok": False,
                "status": "custom_code_failed",
                "node_id": node_id,
                "contract": contract,
                "error": str(exc),
                "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
            }

        stdout = (completed.stdout or "").strip()
        stderr = (completed.stderr or "").strip()
        responses: list[dict[str, Any]] = []
        for line in stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(message, dict):
                responses.append(message)
        initialize_response = next((message for message in responses if message.get("id") == 1), None)
        tool_response = next((message for message in responses if message.get("id") == 2), None)
        if completed.returncode != 0:
            return {
                "ok": False,
                "status": "custom_code_failed",
                "node_id": node_id,
                "contract": contract,
                "exit_code": completed.returncode,
                "stderr": stderr,
                "error": "mcp_process_failed",
                "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
            }
        if not tool_response:
            return {
                "ok": False,
                "status": "custom_code_failed",
                "node_id": node_id,
                "contract": contract,
                "stderr": stderr,
                "error": "mcp_tools_call_response_missing",
                "mcp_initialize": jsonable(initialize_response),
                "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
            }
        if tool_response.get("error"):
            return {
                "ok": False,
                "status": "custom_code_failed",
                "node_id": node_id,
                "contract": contract,
                "stderr": stderr,
                "error": jsonable(tool_response.get("error")),
                "mcp_initialize": jsonable(initialize_response),
                "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
            }
        result = tool_response.get("result") if isinstance(tool_response.get("result"), dict) else {}
        output: Any = result
        content = result.get("content") if isinstance(result, dict) else None
        if isinstance(result, dict) and "structuredContent" in result:
            output = result.get("structuredContent")
        elif isinstance(content, list) and len(content) == 1 and isinstance(content[0], dict) and content[0].get("type") == "text":
            text = str(content[0].get("text") or "")
            try:
                output = json.loads(text)
            except json.JSONDecodeError:
                output = text
        return {
            "ok": True,
            "status": "custom_code_executed",
            "node_id": node_id,
            "contract": contract,
            "output": jsonable(output),
            "mcp_initialize": jsonable(initialize_response),
            "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
        }

    def execute_custom_code(config: dict[str, Any], state: ReferenceState, contract: dict[str, Any]) -> dict[str, Any]:
        language = str(config.get("codeLanguage") or "python").lower()
        execution = str(config.get("codeExecution") or "native").lower()
        if execution == "http":
            return execute_custom_http_code(config, state, contract)
        if execution == "mcp":
            return execute_custom_mcp_code(config, state, contract)
        if execution == "sidecar":
            return execute_custom_sidecar_code(config, state, contract)
        if language == "external" or execution in {"runtime_adapter"}:
            return {
                "ok": False,
                "status": "custom_code_not_executed",
                "node_id": config["id"],
                "contract": contract,
                "reason": "external_executor_not_configured",
            }
        if language in {"javascript", "js", "typescript", "ts"}:
            try:
                return execute_custom_node_code(config, state, contract)
            except Exception as exc:
                return {
                    "ok": False,
                    "status": "custom_code_failed",
                    "node_id": config["id"],
                    "contract": contract,
                    "error": str(exc),
                    "traceback": traceback.format_exc(limit=5),
                }
        if language not in {"python", "py"}:
            return {
                "ok": False,
                "status": "custom_code_not_executed",
                "node_id": config["id"],
                "contract": contract,
                "reason": "unsupported_language",
            }
        try:
            return execute_custom_python_code(config, state, contract)
        except Exception as exc:
            return {
                "ok": False,
                "status": "custom_code_failed",
                "node_id": config["id"],
                "contract": contract,
                "error": str(exc),
                "traceback": traceback.format_exc(limit=5),
            }

    def redact_log_text(value: Any) -> str:
        text = str(value or "")
        for marker in ["api_key=", "apikey=", "token=", "password=", "senha=", "secret="]:
            lower = text.lower()
            index = lower.find(marker)
            while index >= 0:
                end = len(text)
                for separator in ["&", " ", "\n", "\r", "\t"]:
                    separator_index = text.find(separator, index + len(marker))
                    if separator_index >= 0:
                        end = min(end, separator_index)
                text = f"{text[:index]}{text[index:index + len(marker)]}***REDACTED***{text[end:]}"
                lower = text.lower()
                index = lower.find(marker, index + len(marker) + len("***REDACTED***"))
        return text

    def custom_execution_target(contract: dict[str, Any]) -> str:
        for key in ["url", "mcp_tool_name", "sidecar_command", "path", "entry"]:
            value = contract.get(key)
            if value not in (None, ""):
                return redact_log_text(value)
        return "inline"

    def with_custom_observability(node_id: str, result: dict[str, Any]) -> dict[str, Any]:
        enriched = dict(result)
        contract = enriched.get("contract") if isinstance(enriched.get("contract"), dict) else {}
        mode = str(contract.get("execution") or contract.get("language") or "native")
        status = str(enriched.get("status") or ("custom_code_executed" if enriched.get("ok") else "custom_code_failed"))
        execution_log = {
            "mode": mode,
            "status": status,
            "node_id": node_id,
            "target": custom_execution_target(contract),
            "input_path": contract.get("input_path"),
            "duration_ms": enriched.get("duration_ms"),
            "status_code": enriched.get("status_code"),
            "exit_code": enriched.get("exit_code"),
            "reason": enriched.get("reason"),
            "error": redact_log_text(enriched.get("error")) if enriched.get("error") is not None else None,
            "stderr": redact_log_text(enriched.get("stderr")) if enriched.get("stderr") else None,
        }
        enriched["execution_log"] = {key: value for key, value in execution_log.items() if value not in (None, "")}
        enriched["span"] = {
            "name": f"custom_code.{mode}",
            "status": "ok" if enriched.get("ok") else "error",
            "duration_ms": enriched.get("duration_ms"),
            "operation": "custom_code",
            "target": enriched["execution_log"].get("target"),
        }
        return enriched

    def remember_custom_result(state: ReferenceState, node_id: str, result_path: str, result: dict[str, Any]) -> ReferenceState:
        result = with_custom_observability(node_id, result)
        updates: dict[str, Any] = {}
        custom_results = dict(state.get("custom") or {})
        custom_results[node_id] = result
        updates["custom"] = custom_results
        if result.get("ok") and result_path != f"custom.{node_id}":
            assign_state_path(updates, state, result_path, result.get("output"))
        if not result.get("ok") and result.get("status") == "custom_code_failed":
            updates["status"] = "error"
            updates["phase"] = "failed"
            updates["is_complete"] = True
            updates["assistant_message"] = {"code": "ERR", "text": f"Falha no código customizado do nó {node_id}."}
        return mark_node(state, node_id, updates)

    def read_asset_text(relative_path: str, max_chars: int) -> dict[str, Any]:
        path = safe_asset_path(relative_path)
        if not path.exists() or not path.is_file():
            return {
                "ok": False,
                "source_path": relative_path,
                "error": "file_not_found",
            }
        if path.suffix.lower() == ".pdf":
            try:
                from pypdf import PdfReader

                reader = PdfReader(str(path))
                content = "\n".join(page.extract_text() or "" for page in reader.pages)
            except Exception as exc:
                return {
                    "ok": False,
                    "source_path": relative_path,
                    "error": str(exc),
                }
        else:
            content = path.read_text(encoding="utf-8", errors="replace")
        content = content[:max_chars]
        return {
            "ok": True,
            "source_path": relative_path,
            "chars": len(content),
            "content": content,
        }

    def chunk_text(content: str, chunk_size: int) -> list[str]:
        normalized = "\n".join(line.strip() for line in content.splitlines())
        paragraphs = [part.strip() for part in normalized.split("\n\n") if part.strip()]
        chunks: list[str] = []
        current = ""
        for paragraph in paragraphs or [normalized]:
            if len(current) + len(paragraph) + 2 <= chunk_size:
                current = f"{current}\n\n{paragraph}".strip()
                continue
            if current:
                chunks.append(current)
            while len(paragraph) > chunk_size:
                chunks.append(paragraph[:chunk_size])
                paragraph = paragraph[chunk_size:]
            current = paragraph
        if current:
            chunks.append(current)
        return chunks

    def lexical_score(query: str, text_value: str) -> int:
        terms = [term for term in query.lower().replace("\n", " ").split(" ") if len(term) >= 3]
        haystack = text_value.lower()
        return sum(haystack.count(term) for term in terms)

    def remember_file_result(state: ReferenceState, node_id: str, content_path: str, result: dict[str, Any]) -> ReferenceState:
        updates: dict[str, Any] = {}
        file_results = dict(state.get("files") or {})
        file_results[node_id] = result
        updates["files"] = file_results
        if content_path != f"files.{node_id}":
            assign_state_path(updates, state, content_path, result)
        return mark_node(state, node_id, updates)

    def remember_rag_result(state: ReferenceState, node_id: str, context_path: str, result: dict[str, Any]) -> ReferenceState:
        updates: dict[str, Any] = {}
        rag_results = dict(state.get("rag") or {})
        rag_results[node_id] = result
        updates["rag"] = rag_results
        if context_path != f"rag.{node_id}":
            assign_state_path(updates, state, context_path, result)
        return mark_node(state, node_id, updates)

    def remember_approval_result(state: ReferenceState, node_id: str, result_path: str, result: dict[str, Any]) -> ReferenceState:
        updates: dict[str, Any] = {}
        approval_results = dict(state.get("approvals") or {})
        approval_results[node_id] = result
        updates["approvals"] = approval_results
        if result["decision"] == "pending":
            updates["status"] = "active"
            updates["phase"] = "awaiting_approval"
            updates["is_complete"] = False
            updates["assistant_message"] = {"code": "APR", "text": "Aguardando aprovação humana."}
        if result_path != f"approvals.{node_id}":
            assign_state_path(updates, state, result_path, result)
        return mark_node(state, node_id, updates)

    def remember_score_result(state: ReferenceState, node_id: str, result_path: str, result: dict[str, Any]) -> ReferenceState:
        updates: dict[str, Any] = {}
        score_results = dict(state.get("scores") or {})
        score_results[node_id] = result
        updates["scores"] = score_results
        if result_path != f"scores.{node_id}":
            assign_state_path(updates, state, result_path, result)
        return mark_node(state, node_id, updates)

    def remember_analytics_result(state: ReferenceState, node_id: str, result_path: str, result: dict[str, Any]) -> ReferenceState:
        updates: dict[str, Any] = {}
        analytics_results = dict(state.get("analytics") or {})
        analytics_results[node_id] = result
        updates["analytics"] = analytics_results
        if result_path != f"analytics.{node_id}":
            assign_state_path(updates, state, result_path, result)
        return mark_node(state, node_id, updates)

    def make_start_node(config: dict[str, Any]):
        node_id = config["id"]

        def run(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "start")
            if pinned is not None:
                return pinned
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
            pinned = pinned_node_update(state, node_id, "safety")
            if pinned is not None:
                return pinned
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
            pinned = pinned_node_update(state, node_id, "llm")
            if pinned is not None:
                return pinned
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
        result_path = str(config.get("resultPath") or f"custom.{node_id}")
        custom_contract = {
            "language": config.get("codeLanguage"),
            "execution": config.get("codeExecution"),
            "path": config.get("codePath"),
            "entry": config.get("codeEntry"),
            "input_path": config.get("inputPath"),
            "has_inline_code": bool(config.get("codeInline")),
            "dependencies": config.get("codeDependencies"),
            "method": config.get("method"),
            "url": config.get("url"),
            "mcp_command": config.get("mcpCommand"),
            "mcp_args": config.get("mcpArgs"),
            "mcp_tool_name": config.get("mcpToolName"),
            "mcp_protocol_version": config.get("mcpProtocolVersion"),
            "sidecar_command": config.get("sidecarCommand"),
            "sidecar_args": config.get("sidecarArgs"),
            "timeout_seconds": config.get("timeoutSeconds"),
        }

        def deterministic_gate(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "code", result_path=result_path)
            if pinned is not None:
                return pinned
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

        def run_custom_code(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "code", result_path=result_path)
            if pinned is not None:
                return pinned
            contract = {key: value for key, value in custom_contract.items() if value not in (None, "", False)}
            if not contract:
                return mark_node(state, node_id, {})
            return remember_custom_result(state, node_id, result_path, execute_custom_code(config, state, contract))

        return deterministic_gate if handler == "deterministic_gate" else run_custom_code

    def make_switch_node(config: dict[str, Any]):
        node_id = config["id"]

        def run(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "state")
            if pinned is not None:
                return pinned
            return mark_node(state, node_id, {})

        return run

    def make_human_input_node(config: dict[str, Any]):
        node_id = config["id"]

        def run(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "human_input")
            if pinned is not None:
                return pinned
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
            pinned = pinned_node_update(state, node_id, "http", result_path=response_path)
            if pinned is not None:
                return pinned
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
            pinned = pinned_node_update(state, node_id, "transform", result_path=output_path)
            if pinned is not None:
                return pinned
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
            pinned = pinned_node_update(state, node_id, "database", result_path=result_path)
            if pinned is not None:
                return pinned
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
            pinned = pinned_node_update(state, node_id, "database", result_path=result_path)
            if pinned is not None:
                return pinned
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

    def make_file_extract_node(config: dict[str, Any]):
        node_id = config["id"]
        source_path = str(config.get("sourcePath") or "")
        content_path = str(config.get("contentPath") or f"files.{node_id}")
        max_chars = int(config.get("maxChars") or 20000)

        def run(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "file", result_path=content_path)
            if pinned is not None:
                return pinned
            try:
                result_payload = read_asset_text(source_path, max_chars)
            except Exception as exc:
                result_payload = {
                    "ok": False,
                    "source_path": source_path,
                    "error": str(exc),
                }
            return remember_file_result(state, node_id, content_path, result_payload)

        return run

    def make_rag_retrieval_node(config: dict[str, Any]):
        node_id = config["id"]
        collection_path = str(config.get("collectionPath") or ".")
        query_path = str(config.get("queryPath") or "user_message")
        context_path = str(config.get("contextPath") or f"rag.{node_id}")
        top_k = int(config.get("topK") or 3)
        chunk_size = int(config.get("chunkSize") or 900)
        max_chars = int(config.get("maxChars") or 200000)

        def run(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "rag", result_path=context_path)
            if pinned is not None:
                return pinned
            query = str(state_path_value(state, query_path) or "")
            try:
                root = safe_asset_path(collection_path)
                if not root.exists():
                    result_payload = {
                        "ok": False,
                        "query": query,
                        "collection_path": collection_path,
                        "error": "collection_not_found",
                    }
                    return remember_rag_result(state, node_id, context_path, result_payload)
                files = [root] if root.is_file() else sorted(
                    path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in {".txt", ".md", ".markdown", ".pdf"}
                )
                candidates: list[dict[str, Any]] = []
                for file_path in files:
                    relative = file_path.relative_to(FILES_ROOT.resolve()).as_posix()
                    read_result = read_asset_text(relative, max_chars)
                    if not read_result.get("ok"):
                        continue
                    for index, chunk in enumerate(chunk_text(str(read_result.get("content") or ""), chunk_size)):
                        candidates.append({
                            "source_path": relative,
                            "chunk_index": index,
                            "score": lexical_score(query, chunk),
                            "text": chunk,
                        })
                candidates.sort(key=lambda item: (-int(item["score"]), item["source_path"], int(item["chunk_index"])))
                chunks = candidates[:top_k]
                result_payload = {
                    "ok": True,
                    "query": query,
                    "collection_path": collection_path,
                    "chunks": chunks,
                    "chunk_count": len(chunks),
                }
            except Exception as exc:
                result_payload = {
                    "ok": False,
                    "query": query,
                    "collection_path": collection_path,
                    "error": str(exc),
                }
            return remember_rag_result(state, node_id, context_path, result_payload)

        return run

    def make_approval_gate_node(config: dict[str, Any]):
        node_id = config["id"]
        decision_path = str(config.get("decisionPath") or "approval.decision")
        approval_value = str(config.get("approvalValue") or "approved").lower()
        rejection_value = str(config.get("rejectionValue") or "rejected").lower()
        result_path = str(config.get("resultPath") or f"approvals.{node_id}")

        def normalize_decision(value: Any) -> str:
            if value is True:
                return "approved"
            if value is False:
                return "rejected"
            text_value = str(value or "").strip().lower()
            approved_values = {approval_value, "approved", "approve", "aprovado", "aprovar", "sim", "yes", "ok", "true"}
            rejected_values = {rejection_value, "rejected", "reject", "reprovado", "rejeitar", "não", "nao", "no", "false"}
            if text_value in approved_values or any(token in text_value for token in approved_values if len(token) >= 3):
                return "approved"
            if text_value in rejected_values or any(token in text_value for token in rejected_values if len(token) >= 3):
                return "rejected"
            return "pending"

        def run(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "approval", result_path=result_path)
            if pinned is not None:
                return pinned
            raw_value = state_path_value(state, decision_path)
            decision = normalize_decision(raw_value)
            result_payload = {
                "decision": decision,
                "approved": decision == "approved",
                "rejected": decision == "rejected",
                "pending": decision == "pending",
                "decision_path": decision_path,
                "raw_value": jsonable(raw_value),
            }
            return remember_approval_result(state, node_id, result_path, result_payload)

        return run

    def make_scoring_node(config: dict[str, Any]):
        node_id = config["id"]
        input_path = str(config.get("inputPath") or "assistant_message")
        result_path = str(config.get("resultPath") or f"scores.{node_id}")
        threshold = float(config.get("threshold") if config.get("threshold") is not None else 0.7)

        def score_value(value: Any) -> float:
            if isinstance(value, dict):
                for key in ("score", "confidence", "rating"):
                    candidate = value.get(key)
                    if isinstance(candidate, (int, float)):
                        return max(0.0, min(1.0, float(candidate)))
                text_value = " ".join(str(item) for item in value.values())
            else:
                text_value = str(value or "")
            lowered = text_value.lower()
            positive = {"accepted", "approved", "adequado", "correto", "bom", "ok", "sim"}
            negative = {"rejected", "bloqueado", "ruim", "incorreto", "não", "nao"}
            if any(term in lowered for term in positive):
                return 1.0
            if any(term in lowered for term in negative):
                return 0.0
            words = [word for word in lowered.replace("\n", " ").split(" ") if len(word) >= 3]
            return max(0.1, min(1.0, len(words) / 30))

        def run(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "score", result_path=result_path)
            if pinned is not None:
                return pinned
            value = state_path_value(state, input_path)
            score = score_value(value)
            result_payload = {
                "score": score,
                "threshold": threshold,
                "passed": score >= threshold,
                "input_path": input_path,
                "value": jsonable(value),
            }
            return remember_score_result(state, node_id, result_path, result_payload)

        return run

    def make_analytics_node(config: dict[str, Any]):
        node_id = config["id"]
        metric_name = str(config.get("metricName") or node_id)
        payload_path = str(config.get("payloadPath") or "")
        result_path = str(config.get("resultPath") or f"analytics.{node_id}")

        def run(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "analytics", result_path=result_path)
            if pinned is not None:
                return pinned
            payload = jsonable(state_path_value(state, payload_path)) if payload_path else {
                "session_id": state.get("session_id"),
                "turn": state.get("turn"),
                "status": state.get("status"),
                "phase": state.get("phase"),
            }
            try:
                with graph_session_scope() as db:
                    record_id = str(uuid4())
                    db.add(
                        AgentNodeRecord(
                            record_id=record_id,
                            session_id=str(state.get("session_id") or ""),
                            node_id=node_id,
                            payload_json={
                                "kind": "analytics",
                                "metric_name": metric_name,
                                "payload": payload,
                            },
                        )
                    )
                    db.flush()
                result_payload = {
                    "ok": True,
                    "metric_name": metric_name,
                    "payload_path": payload_path,
                    "payload": payload,
                    "record_id": record_id,
                }
            except Exception as exc:
                result_payload = {
                    "ok": False,
                    "metric_name": metric_name,
                    "payload_path": payload_path,
                    "error": str(exc),
                }
            return remember_analytics_result(state, node_id, result_path, result_payload)

        return run

    def make_finish_node(config: dict[str, Any]):
        node_id = config["id"]

        def run(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "finish")
            if pinned is not None:
                return pinned
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
            pinned = pinned_node_update(state, node_id, "state")
            if pinned is not None:
                return pinned
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
        if node_type == "file_extract":
            return make_file_extract_node(config)
        if node_type == "rag_retrieval":
            return make_rag_retrieval_node(config)
        if node_type == "approval_gate":
            return make_approval_gate_node(config)
        if node_type == "scoring":
            return make_scoring_node(config)
        if node_type == "analytics":
            return make_analytics_node(config)
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
