import importlib
import importlib.util
import json
import logging
import os
import sys
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient


MANIFEST = json.loads("{\n  \"id\": \"reference-runtime\",\n  \"name\": \"Reference Runtime\",\n  \"version\": \"0.1.0\",\n  \"packaging\": \"multiagent\",\n  \"orchestration\": {\n    \"format\": \"agent-flow-builder.runtime-orchestration.v1\",\n    \"manifestId\": \"reference-runtime\",\n    \"manifestVersion\": \"0.1.0\",\n    \"mode\": \"sequential\",\n    \"capabilities\": {\n      \"executableRun\": true,\n      \"debugTrace\": true,\n      \"structuredConditions\": true,\n      \"optionalJsonlMemory\": true,\n      \"persistentMemoryPolicy\": true\n    },\n    \"memoryPolicy\": {\n      \"enabled\": true,\n      \"persistence\": \"optional_jsonl\",\n      \"defaultPersist\": false,\n      \"defaultMemoryPath\": \"\",\n      \"maxEntries\": 64,\n      \"retentionRuns\": 50,\n      \"maxPreviewChars\": 500,\n      \"redactKeys\": [\n        \"api_key\",\n        \"authorization\",\n        \"password\",\n        \"secret\",\n        \"token\"\n      ],\n      \"includeStepOutputs\": true,\n      \"includeHandoffDecisions\": true\n    },\n    \"entryAgentId\": \"reference-interview\",\n    \"handoffs\": [],\n    \"agents\": [\n      {\n        \"id\": \"reference-interview\",\n        \"routePrefix\": \"/reference-interview\",\n        \"resourceName\": \"sessions\",\n        \"metadataPath\": \"/reference-interview/metadata\",\n        \"sessionsPath\": \"/reference-interview/sessions\"\n      }\n    ],\n    \"governance\": {\n      \"declarativeOnly\": true,\n      \"generatedFromManifest\": true,\n      \"excludesSecrets\": true,\n      \"excludesEnvValues\": true,\n      \"excludesRuntimePayloads\": true\n    }\n  }\n}")
AGENTS = json.loads("[\n  {\n    \"id\": \"reference-interview\",\n    \"flow_id\": \"reference-interview\",\n    \"flow_name\": \"Agente de Referência\",\n    \"flow_version\": \"0.1.0\",\n    \"route_prefix\": \"/reference-interview\",\n    \"runtime_dir\": \"agents/reference-interview\",\n    \"resource_name\": \"sessions\",\n    \"contract\": \"sessions-v1\"\n  }\n]")
SHARED_STORAGE = json.loads("{\n  \"database\": {\n    \"scope\": \"bundle\",\n    \"mode\": \"single-database\",\n    \"env\": \"DATABASE_URL\",\n    \"dockerService\": \"postgres\",\n    \"recommendedDriver\": \"postgresql+psycopg2\",\n    \"tablesAreNamespacedBy\": \"agent_id\"\n  },\n  \"checkpointer\": {\n    \"scope\": \"bundle\",\n    \"env\": \"USE_POSTGRES_CHECKPOINTER\",\n    \"dockerService\": \"postgres\"\n  },\n  \"cache\": {\n    \"scope\": \"bundle\",\n    \"env\": \"REDIS_URL\",\n    \"dockerService\": \"redis\"\n  }\n}")
AGENT_ISOLATION = json.loads("{\n  \"format\": \"agent-flow-builder.runtime-agent-isolation.v1\",\n  \"manifestId\": \"reference-runtime\",\n  \"manifestVersion\": \"0.1.0\",\n  \"packaging\": \"multiagent\",\n  \"routeIsolation\": {\n    \"required\": true,\n    \"uniqueRoutePrefixes\": true,\n    \"prefixOwnsOpenApiSubtree\": true,\n    \"rootMetadataOnlyAt\": \"/metadata\"\n  },\n  \"runtimeImportIsolation\": {\n    \"mode\": \"isolated-python-app-namespace\",\n    \"clearsModulePrefixes\": [\n      \"app\",\n      \"app.*\"\n    ],\n    \"restoresPreviousModules\": true,\n    \"restoresSysPath\": true\n  },\n  \"requestIsolation\": {\n    \"idempotencyNamespace\": \"route_prefix\",\n    \"sessionNamespace\": \"agent_id\",\n    \"eventNamespace\": \"agent_id\",\n    \"jobNamespace\": \"agent_id\"\n  },\n  \"authIsolation\": {\n    \"scopeNamespace\": \"agents:<agent_id>\",\n    \"examples\": [\n      \"agents:<agent_id>:metadata:read\",\n      \"agents:<agent_id>:sessions:*\",\n      \"agents:<agent_id>:jobs:*\",\n      \"agents:<agent_id>:auth:read\"\n    ]\n  },\n  \"sharedStorage\": {\n    \"database\": {\n      \"scope\": \"bundle\",\n      \"mode\": \"single-database\",\n      \"env\": \"DATABASE_URL\",\n      \"dockerService\": \"postgres\",\n      \"recommendedDriver\": \"postgresql+psycopg2\",\n      \"tablesAreNamespacedBy\": \"agent_id\"\n    },\n    \"checkpointer\": {\n      \"scope\": \"bundle\",\n      \"env\": \"USE_POSTGRES_CHECKPOINTER\",\n      \"dockerService\": \"postgres\"\n    },\n    \"cache\": {\n      \"scope\": \"bundle\",\n      \"env\": \"REDIS_URL\",\n      \"dockerService\": \"redis\"\n    }\n  },\n  \"agents\": [\n    {\n      \"id\": \"reference-interview\",\n      \"routePrefix\": \"/reference-interview\",\n      \"runtimeDir\": \"agents/reference-interview\",\n      \"resourceName\": \"sessions\",\n      \"metadataPath\": \"/reference-interview/metadata\",\n      \"sessionsPath\": \"/reference-interview/sessions\",\n      \"storageNamespaceField\": \"agent_id\"\n    }\n  ],\n  \"governance\": {\n    \"excludesSecrets\": true,\n    \"excludesEnvValues\": true,\n    \"excludesRuntimePayloads\": true,\n    \"generatedFromManifest\": true\n  }\n}")
PROJECT_ROOT = Path(__file__).resolve().parents[1]

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    logging.basicConfig(level="INFO")
    app = FastAPI(title=MANIFEST["name"])
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.manifest = MANIFEST
    app.state.agents = {}

    @app.get("/health")
    def health():
        return {
            "status": "ok",
            "manifest_id": MANIFEST["id"],
            "agents": [
                {
                    "id": agent["id"],
                    "route_prefix": agent["route_prefix"],
                    "mounted": agent["id"] in app.state.agents,
                }
                for agent in AGENTS
            ],
            "shared_storage": {
                "database_env": SHARED_STORAGE["database"]["env"],
                "database_configured": bool(os.getenv(SHARED_STORAGE["database"]["env"])),
                "checkpointer_enabled": os.getenv(SHARED_STORAGE["checkpointer"]["env"], "").lower() == "true",
                "cache_configured": bool(os.getenv(SHARED_STORAGE["cache"]["env"])),
            },
            "agent_isolation": {
                "route_prefix_unique": AGENT_ISOLATION["routeIsolation"]["uniqueRoutePrefixes"],
                "idempotency_namespace": AGENT_ISOLATION["requestIsolation"]["idempotencyNamespace"],
                "storage_namespace": AGENT_ISOLATION["requestIsolation"]["sessionNamespace"],
                "runtime_import_mode": AGENT_ISOLATION["runtimeImportIsolation"]["mode"],
            },
        }

    @app.get("/metadata")
    def metadata():
        return {
            "service": MANIFEST["name"],
            "runtime": "langgraph-fastapi-python",
            "contract": "sessions-v1",
            "manifest_id": MANIFEST["id"],
            "manifest_version": MANIFEST["version"],
            "packaging": MANIFEST["packaging"],
            "supports_multi_agent_bundle": True,
            "shared_storage": SHARED_STORAGE,
            "orchestration": MANIFEST["orchestration"],
            "agent_isolation": AGENT_ISOLATION,
            "agents": AGENTS,
        }

    @app.post("/orchestration/run")
    def run_orchestration(payload: dict[str, Any]):
        plan = _build_orchestration_plan(payload)
        steps = []
        shared_memory = _new_orchestration_memory(plan)
        debug_trace = _new_orchestration_debug_trace(plan)
        queue = list(plan["steps"])
        visited = set()
        status = "completed"
        error = None
        try:
            while queue:
                planned_step = queue.pop(0)
                step_index = len(steps)
                agent = _agent_by_id(planned_step["agent_id"])
                _record_orchestration_trace_event(
                    debug_trace,
                    "step_started",
                    status="running",
                    step_index=step_index,
                    agent_id=agent["id"],
                    route_prefix=agent["route_prefix"],
                    handoff_condition=planned_step.get("condition"),
                    queue_remaining=len(queue),
                )
                child_app = app.state.agents.get(agent["id"])
                if child_app is None:
                    raise RuntimeError(f"Agente não montado: {agent['id']}")
                step = _execute_agent_step(
                    child_app=child_app,
                    agent=agent,
                    message=plan["user_message"],
                    metadata=plan["metadata"],
                    max_turns=plan["max_turns"],
                    step_index=step_index,
                    handoff_condition=planned_step.get("condition"),
                    shared_memory=shared_memory,
                )
                steps.append(step)
                _append_orchestration_memory(shared_memory, step, step_index, plan)
                _record_orchestration_step_completed(debug_trace, step, step_index, shared_memory)
                visited.add(agent["id"])
                if plan["explicit_steps"]:
                    continue
                for decision in _handoff_decisions(agent["id"], plan, shared_memory):
                    if plan["memory_policy"].get("includeHandoffDecisions") is not False:
                        shared_memory["decisions"].append(decision)
                    _record_orchestration_decision_trace(debug_trace, decision, step_index, len(queue))
                    if decision["matched"] and decision["to_agent_id"] not in visited:
                        queue.append(
                            {
                                "agent_id": decision["to_agent_id"],
                                "condition": decision["condition"],
                                "decision": decision,
                            }
                        )
                        _record_orchestration_trace_event(
                            debug_trace,
                            "handoff_enqueued",
                            status="queued",
                            step_index=step_index,
                            agent_id=decision["from_agent_id"],
                            to_agent_id=decision["to_agent_id"],
                            condition=decision["condition"],
                            queue_size=len(queue),
                        )
        except Exception as exc:
            status = "failed"
            error = {
                "message": _sanitize_orchestration_error(exc),
                "step_index": len(steps),
            }
            _record_orchestration_trace_event(
                debug_trace,
                "orchestration_failed",
                status="error",
                step_index=len(steps),
                error=error["message"],
            )
        _finish_orchestration_debug_trace(debug_trace, status, steps, shared_memory)
        shared_memory["persistence"] = _persist_orchestration_memory(plan, shared_memory, steps, debug_trace)
        safe_steps = _redact_orchestration_value(steps, plan["memory_policy"])
        safe_shared_memory = _redact_orchestration_value(shared_memory, plan["memory_policy"])
        safe_debug_trace = _redact_orchestration_value(debug_trace, plan["memory_policy"])
        response = {
            "format": "agent-flow-builder.runtime-orchestration-run.v1",
            "manifest_id": MANIFEST["id"],
            "manifest_version": MANIFEST["version"],
            "mode": MANIFEST["orchestration"]["mode"],
            "entry_agent_id": plan["entry_agent_id"],
            "status": status,
            "steps": safe_steps,
            "shared_memory": safe_shared_memory,
            "debug_trace": safe_debug_trace,
            "governance": {
                "executedInProcess": True,
                "usedMountedAgents": True,
                "excludesSecrets": True,
                "excludesEnvValues": True,
                "sharedMemoryPreviewOnly": True,
                "persistentMemorySupported": True,
                "debugTracePreviewOnly": True,
            },
        }
        if error:
            response["error"] = error
        return response

    for agent in AGENTS:
        child_app = _load_agent_app(agent)
        app.mount(agent["route_prefix"], child_app)
        app.state.agents[agent["id"]] = child_app

    return app


def _load_agent_app(agent: dict[str, Any]) -> FastAPI:
    agent_root = PROJECT_ROOT / agent["runtime_dir"]
    if not agent_root.exists():
        raise RuntimeError(f"Runtime do agente não encontrado: {agent_root}")
    with _isolated_app_import(agent_root):
        module = importlib.import_module("app.main")
        child_app = module.create_app()
    child_app.title = agent["flow_name"]
    return child_app


def _build_orchestration_plan(payload: dict[str, Any]) -> dict[str, Any]:
    user_message = _orchestration_user_message(payload)
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    max_turns = int(payload.get("max_turns") or 3)
    input_payload = payload.get("input") if isinstance(payload.get("input"), dict) else {}
    orchestration = MANIFEST["orchestration"]
    memory_policy = _orchestration_memory_policy()
    entry_agent_id = orchestration.get("entryAgentId") or (AGENTS[0]["id"] if AGENTS else "")
    requested_agent_ids = payload.get("agent_ids") if isinstance(payload.get("agent_ids"), list) else []
    if requested_agent_ids:
        steps = [{"agent_id": agent_id, "condition": "solicitado no payload"} for agent_id in requested_agent_ids]
    else:
        steps = _default_orchestration_steps(entry_agent_id, orchestration)
    return {
        "entry_agent_id": entry_agent_id,
        "user_message": user_message,
        "metadata": metadata,
        "max_turns": max_turns,
        "input_payload": {
            **input_payload,
            "user_message": user_message,
            "metadata": metadata,
            "max_turns": max_turns,
        },
        "run_id": str(payload.get("run_id") or f"orch_{uuid.uuid4().hex}"),
        "memory_path": _orchestration_memory_path(payload, memory_policy),
        "memory_policy": memory_policy,
        "steps": steps,
        "explicit_steps": bool(requested_agent_ids),
        "orchestration": orchestration,
    }


def _orchestration_user_message(payload: dict[str, Any]) -> str:
    if isinstance(payload.get("user_message"), str) and payload["user_message"].strip():
        return payload["user_message"].strip()
    input_payload = payload.get("input")
    if isinstance(input_payload, dict) and isinstance(input_payload.get("user_message"), str) and input_payload["user_message"].strip():
        return input_payload["user_message"].strip()
    if isinstance(input_payload, str) and input_payload.strip():
        return input_payload.strip()
    return "Executar orquestração multiagente."


def _default_orchestration_steps(entry_agent_id: str, orchestration: dict[str, Any]) -> list[dict[str, str]]:
    if not entry_agent_id:
        return []
    has_handoffs = any(
        handoff.get("fromAgentId") == entry_agent_id and handoff.get("toAgentId")
        for handoff in orchestration.get("handoffs", [])
    )
    if not has_handoffs and orchestration.get("mode") == "sequential":
        agent_ids = [agent["id"] for agent in AGENTS]
        return [{"agent_id": agent_id, "condition": "sequência declarada"} for agent_id in agent_ids]
    return [{"agent_id": entry_agent_id, "condition": "entrada"}]


def _new_orchestration_memory(plan: dict[str, Any]) -> dict[str, Any]:
    policy = plan.get("memory_policy") if isinstance(plan.get("memory_policy"), dict) else _orchestration_memory_policy()
    max_preview_chars = int(policy.get("maxPreviewChars") or 500)
    return {
        "format": "agent-flow-builder.runtime-orchestration-memory.v1",
        "run_id": plan["run_id"],
        "entry_agent_id": plan["entry_agent_id"],
        "entries": [],
        "decisions": [],
        "policy": _orchestration_memory_policy_summary(policy, bool(plan.get("memory_path"))),
        "governance": {
            "previewOnly": True,
            "maxPreviewChars": max_preview_chars,
            "excludesSecrets": True,
            "excludesEnvValues": True,
            "persistentJsonl": bool(plan.get("memory_path")),
            "maxEntries": int(policy.get("maxEntries") or 64),
            "retentionRuns": int(policy.get("retentionRuns") or 50),
            "redactKeysConfigured": len(policy.get("redactKeys") or []),
        },
    }


def _new_orchestration_debug_trace(plan: dict[str, Any]) -> dict[str, Any]:
    policy = plan.get("memory_policy") if isinstance(plan.get("memory_policy"), dict) else _orchestration_memory_policy()
    trace = {
        "format": "agent-flow-builder.runtime-orchestration-debug-trace.v1",
        "run_id": plan["run_id"],
        "manifest_id": MANIFEST["id"],
        "manifest_version": MANIFEST["version"],
        "mode": MANIFEST["orchestration"]["mode"],
        "entry_agent_id": plan["entry_agent_id"],
        "started_at": datetime.now(timezone.utc).isoformat(),
        "finished_at": None,
        "input": _orchestration_input_summary(plan),
        "timeline": [],
        "summary": {},
        "governance": {
            "previewOnly": True,
            "maxPreviewChars": int(policy.get("maxPreviewChars") or 500),
            "excludesSecrets": True,
            "excludesEnvValues": True,
            "excludesRuntimePayloads": True,
            "safeForStudioTimeline": True,
            "memoryPolicy": _orchestration_memory_policy_summary(policy, bool(plan.get("memory_path"))),
        },
    }
    _record_orchestration_trace_event(
        trace,
        "plan_created",
        status="planned",
        entry_agent_id=plan["entry_agent_id"],
        explicit_steps=plan["explicit_steps"],
        planned_step_count=len(plan["steps"]),
        handoff_count=len(plan["orchestration"].get("handoffs", [])),
    )
    return trace


def _orchestration_input_summary(plan: dict[str, Any]) -> dict[str, Any]:
    input_payload = plan.get("input_payload") if isinstance(plan.get("input_payload"), dict) else {}
    metadata = plan.get("metadata") if isinstance(plan.get("metadata"), dict) else {}
    return {
        "user_message_preview": _truncate_preview(str(plan.get("user_message") or ""), 180),
        "input_keys": sorted([key for key in input_payload.keys() if key not in {"user_message", "metadata"}]),
        "metadata_keys": sorted(metadata.keys()),
        "max_turns": plan.get("max_turns"),
        "explicit_agent_plan": bool(plan.get("explicit_steps")),
    }


def _record_orchestration_trace_event(trace: dict[str, Any], event_type: str, status: str = "info", **fields: Any) -> None:
    event = {
        "seq": len(trace["timeline"]) + 1,
        "at": datetime.now(timezone.utc).isoformat(),
        "type": event_type,
        "status": status,
    }
    for key, value in fields.items():
        if value is None or value == "":
            continue
        event[key] = value
    trace["timeline"].append(event)


def _record_orchestration_step_completed(
    trace: dict[str, Any],
    step: dict[str, Any],
    step_index: int,
    shared_memory: dict[str, Any],
) -> None:
    turn = step.get("turn") if isinstance(step.get("turn"), dict) else {}
    session = turn.get("session") if isinstance(turn.get("session"), dict) else {}
    assistant = turn.get("assistant_message") if isinstance(turn.get("assistant_message"), dict) else {}
    _record_orchestration_trace_event(
        trace,
        "step_completed",
        status=str(session.get("status") or "completed"),
        step_index=step_index,
        agent_id=step.get("agent_id"),
        route_prefix=step.get("route_prefix"),
        session_id=step.get("session_id"),
        handoff_condition=step.get("handoff_condition"),
        output_code=assistant.get("code"),
        output_preview=_truncate_preview(_extract_turn_output_text(turn)),
        memory_entries=len(shared_memory.get("entries", [])),
    )


def _record_orchestration_decision_trace(
    trace: dict[str, Any],
    decision: dict[str, Any],
    step_index: int,
    queue_size: int,
) -> None:
    _record_orchestration_trace_event(
        trace,
        "handoff_decision",
        status="matched" if decision.get("matched") else "skipped",
        step_index=step_index,
        agent_id=decision.get("from_agent_id"),
        to_agent_id=decision.get("to_agent_id"),
        condition=decision.get("condition"),
        matched=bool(decision.get("matched")),
        reason=decision.get("reason"),
        queue_size=queue_size,
    )


def _finish_orchestration_debug_trace(
    trace: dict[str, Any],
    status: str,
    steps: list[dict[str, Any]],
    shared_memory: dict[str, Any],
) -> None:
    trace["finished_at"] = datetime.now(timezone.utc).isoformat()
    trace["summary"] = {
        "status": status,
        "step_count": len(steps),
        "agent_ids": [step.get("agent_id") for step in steps],
        "memory_entries": len(shared_memory.get("entries", [])),
        "handoff_decisions": len(shared_memory.get("decisions", [])),
        "matched_handoffs": len([decision for decision in shared_memory.get("decisions", []) if decision.get("matched")]),
        "timeline_events": len(trace.get("timeline", [])),
    }


def _append_orchestration_memory(shared_memory: dict[str, Any], step: dict[str, Any], step_index: int, plan: dict[str, Any]) -> None:
    policy = plan.get("memory_policy") if isinstance(plan.get("memory_policy"), dict) else _orchestration_memory_policy()
    turn = step.get("turn", {}) if isinstance(step.get("turn"), dict) else {}
    assistant = turn.get("assistant_message") if isinstance(turn.get("assistant_message"), dict) else {}
    session = turn.get("session") if isinstance(turn.get("session"), dict) else {}
    max_preview_chars = int(policy.get("maxPreviewChars") or 500)
    entry = {
        "step_index": step_index,
        "agent_id": step["agent_id"],
        "session_id": step["session_id"],
        "status": session.get("status"),
        "output_preview": _truncate_preview(_extract_turn_output_text(turn), max_preview_chars),
    }
    if policy.get("includeStepOutputs") is not False:
        entry["output"] = {
            "assistant_message": {
                "code": assistant.get("code"),
                "text_preview": _truncate_preview(str(assistant.get("text") or assistant.get("content") or ""), max_preview_chars),
            },
            "session": {
                "agent_id": session.get("agent_id"),
                "status": session.get("status"),
                "turn": session.get("turn"),
            },
        }
    shared_memory["entries"].append(entry)
    max_entries = max(1, int(policy.get("maxEntries") or 64))
    if len(shared_memory["entries"]) > max_entries:
        shared_memory["entries"] = shared_memory["entries"][-max_entries:]


def _shared_memory_context(shared_memory: dict[str, Any]) -> dict[str, Any]:
    return {
        "format": shared_memory["format"],
        "entries": shared_memory["entries"],
        "decisions": shared_memory["decisions"],
        "policy": shared_memory.get("policy", {}),
        "governance": shared_memory["governance"],
    }


def _handoff_decisions(current_agent_id: str, plan: dict[str, Any], shared_memory: dict[str, Any]) -> list[dict[str, Any]]:
    decisions = []
    for handoff in plan["orchestration"].get("handoffs", []):
        if handoff.get("fromAgentId") != current_agent_id or not handoff.get("toAgentId"):
            continue
        matched, reason = _handoff_matches(handoff.get("condition") or "", plan, shared_memory)
        decisions.append(
            {
                "from_agent_id": current_agent_id,
                "to_agent_id": handoff["toAgentId"],
                "condition": handoff.get("condition") or "",
                "matched": matched,
                "reason": reason,
            }
        )
    return decisions


def _handoff_matches(condition: str, plan: dict[str, Any], shared_memory: dict[str, Any]) -> tuple[bool, str]:
    normalized = condition.strip()
    if not normalized:
        return True, "handoff sem condição executa por padrão"
    lowered = normalized.lower()
    if lowered in {"always", "true", "sempre"}:
        return True, "condição always"
    operators = [
        ("input not contains:", plan["user_message"], False),
        ("input contains:", plan["user_message"], True),
        ("output not contains:", _last_output_text(shared_memory), False),
        ("output contains:", _last_output_text(shared_memory), True),
        ("last_output not contains:", _last_output_text(shared_memory), False),
        ("last_output contains:", _last_output_text(shared_memory), True),
        ("assistant not contains:", _last_output_text(shared_memory), False),
        ("assistant contains:", _last_output_text(shared_memory), True),
    ]
    for prefix, haystack, expected in operators:
        if lowered.startswith(prefix):
            needle = normalized[len(prefix):].strip().lower()
            contains = needle in haystack.lower() if needle else True
            return contains is expected, f"{prefix} {'match' if contains else 'no_match'}"
    structured = _structured_handoff_match(normalized, plan, shared_memory)
    if structured is not None:
        return structured
    return True, "condição textual tratada como anotação declarativa"


def _structured_handoff_match(condition: str, plan: dict[str, Any], shared_memory: dict[str, Any]) -> tuple[bool, str] | None:
    for operator in [" not contains ", " contains ", " != ", " == "]:
        index = condition.lower().find(operator)
        if index < 0:
            continue
        left = condition[:index].strip()
        right = condition[index + len(operator):].strip()
        if not left.startswith(("input.", "output.", "memory.")):
            return None
        value = _resolve_condition_path(left, plan, shared_memory)
        expected = _parse_condition_literal(right)
        if operator == " == ":
            matched = _condition_values_equal(value, expected)
        elif operator == " != ":
            matched = not _condition_values_equal(value, expected)
        elif operator == " contains ":
            matched = str(expected).lower() in str(value or "").lower()
        else:
            matched = str(expected).lower() not in str(value or "").lower()
        return matched, f"{left}{operator.strip()} {'match' if matched else 'no_match'}"
    return None


def _resolve_condition_path(path_expression: str, plan: dict[str, Any], shared_memory: dict[str, Any]) -> Any:
    root_name, _, path = path_expression.partition(".")
    if root_name == "input":
        value: Any = plan.get("input_payload", {})
    elif root_name == "output":
        value = _last_output_structured(shared_memory)
    elif root_name == "memory":
        value = shared_memory
    else:
        return None
    for part in [item for item in path.split(".") if item]:
        if isinstance(value, list):
            try:
                value = value[int(part)]
            except (ValueError, IndexError):
                return None
            continue
        if isinstance(value, dict):
            value = value.get(part)
            continue
        return None
    return value


def _parse_condition_literal(raw: str) -> Any:
    value = raw.strip()
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        return value[1:-1]
    try:
        return json.loads(value)
    except Exception:
        return value


def _condition_values_equal(left: Any, right: Any) -> bool:
    if isinstance(left, (int, float, bool)) or isinstance(right, (int, float, bool)):
        return left == right
    return str(left) == str(right)


def _last_output_text(shared_memory: dict[str, Any]) -> str:
    entries = shared_memory.get("entries") or []
    if not entries:
        return ""
    return str(entries[-1].get("output_preview") or "")


def _last_output_structured(shared_memory: dict[str, Any]) -> dict[str, Any]:
    entries = shared_memory.get("entries") or []
    if not entries:
        return {}
    output = entries[-1].get("output")
    return output if isinstance(output, dict) else {}


def _extract_turn_output_text(turn: dict[str, Any]) -> str:
    assistant = turn.get("assistant_message") if isinstance(turn, dict) else None
    if isinstance(assistant, dict):
        return str(assistant.get("text") or assistant.get("content") or "")
    return ""


def _truncate_preview(value: str, limit: int = 500) -> str:
    text = value.strip()
    return text if len(text) <= limit else f"{text[:limit]}..."


def _sanitize_orchestration_error(error: Exception) -> str:
    text = str(error).replace(str(PROJECT_ROOT), "<project_root>")
    return _truncate_preview(text, 500)


def _orchestration_memory_policy() -> dict[str, Any]:
    raw = MANIFEST.get("orchestration", {}).get("memoryPolicy")
    policy = raw if isinstance(raw, dict) else {}
    redact_keys = policy.get("redactKeys") if isinstance(policy.get("redactKeys"), list) else []
    normalized_redact_keys = [str(key).strip().lower() for key in redact_keys if str(key).strip()]
    if not normalized_redact_keys:
        normalized_redact_keys = ["api_key", "authorization", "password", "secret", "token"]
    persistence = str(policy.get("persistence") or "optional_jsonl")
    if persistence not in {"disabled", "optional_jsonl", "always_jsonl"}:
        persistence = "optional_jsonl"
    return {
        "enabled": policy.get("enabled") is not False,
        "persistence": persistence,
        "defaultPersist": bool(policy.get("defaultPersist")),
        "defaultMemoryPath": str(policy.get("defaultMemoryPath") or "").strip(),
        "maxEntries": max(1, int(policy.get("maxEntries") or 64)),
        "retentionRuns": max(1, int(policy.get("retentionRuns") or 50)),
        "maxPreviewChars": max(80, int(policy.get("maxPreviewChars") or 500)),
        "redactKeys": normalized_redact_keys,
        "includeStepOutputs": policy.get("includeStepOutputs") is not False,
        "includeHandoffDecisions": policy.get("includeHandoffDecisions") is not False,
    }


def _orchestration_memory_policy_summary(policy: dict[str, Any], persistence_active: bool) -> dict[str, Any]:
    return {
        "enabled": bool(policy.get("enabled")),
        "persistence": policy.get("persistence"),
        "persistence_active": persistence_active,
        "default_persist": bool(policy.get("defaultPersist")),
        "default_memory_path_configured": bool(policy.get("defaultMemoryPath")),
        "max_entries": int(policy.get("maxEntries") or 64),
        "retention_runs": int(policy.get("retentionRuns") or 50),
        "max_preview_chars": int(policy.get("maxPreviewChars") or 500),
        "redact_key_count": len(policy.get("redactKeys") or []),
        "include_step_outputs": policy.get("includeStepOutputs") is not False,
        "include_handoff_decisions": policy.get("includeHandoffDecisions") is not False,
    }


def _orchestration_memory_path(payload: dict[str, Any], policy: dict[str, Any]) -> str:
    if not policy.get("enabled") or policy.get("persistence") == "disabled":
        return ""
    if payload.get("persist_memory") is False:
        return ""
    path = payload.get("memory_path") or os.getenv("ORCHESTRATION_MEMORY_PATH", "") or policy.get("defaultMemoryPath", "")
    if path:
        return str(path)
    should_persist = (
        payload.get("persist_memory") is True
        or policy.get("persistence") == "always_jsonl"
        or (payload.get("persist_memory") is None and bool(policy.get("defaultPersist")))
    )
    if should_persist:
        return str(PROJECT_ROOT / ".runtime-manifest" / "orchestration-memory.jsonl")
    return ""


def _redact_orchestration_value(value: Any, policy: dict[str, Any]) -> Any:
    redact_keys = [str(key).lower() for key in policy.get("redactKeys", [])]
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            lowered = str(key).lower()
            if any(redact_key and redact_key in lowered for redact_key in redact_keys):
                result[key] = "<redacted>"
            else:
                result[key] = _redact_orchestration_value(item, policy)
        return result
    if isinstance(value, list):
        return [_redact_orchestration_value(item, policy) for item in value]
    return value


def _persist_orchestration_memory(
    plan: dict[str, Any],
    shared_memory: dict[str, Any],
    steps: list[dict[str, Any]],
    debug_trace: dict[str, Any],
) -> dict[str, Any]:
    policy = plan.get("memory_policy") if isinstance(plan.get("memory_policy"), dict) else _orchestration_memory_policy()
    memory_path = str(plan.get("memory_path") or "").strip()
    if not memory_path:
        return {"enabled": False, "storage": "none"}
    target = Path(memory_path)
    if not target.is_absolute():
        target = PROJECT_ROOT / target
    target.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "format": "agent-flow-builder.runtime-orchestration-memory-record.v1",
        "run_id": plan["run_id"],
        "manifest_id": MANIFEST["id"],
        "manifest_version": MANIFEST["version"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "entry_agent_id": plan["entry_agent_id"],
        "step_count": len(steps),
        "steps": _redact_orchestration_value([
            {
                "agent_id": step["agent_id"],
                "session_id": step["session_id"],
                "handoff_condition": step.get("handoff_condition"),
            }
            for step in steps
        ], policy),
        "shared_memory": _redact_orchestration_value(shared_memory, policy),
        "debug_trace": {
            "format": debug_trace["format"],
            "run_id": debug_trace["run_id"],
            "summary": _redact_orchestration_value(debug_trace.get("summary", {}), policy),
            "timeline": _redact_orchestration_value(debug_trace.get("timeline", []), policy),
            "governance": debug_trace.get("governance", {}),
        },
        "governance": {
            "previewOnly": True,
            "excludesSecrets": True,
            "excludesEnvValues": True,
            "excludesRuntimePayloads": True,
        },
    }
    with target.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")
    retention_runs = int(policy.get("retentionRuns") or 50)
    if retention_runs > 0:
        lines = target.read_text(encoding="utf-8").splitlines()
        if len(lines) > retention_runs:
            target.write_text("\n".join(lines[-retention_runs:]) + "\n", encoding="utf-8")
    return {
        "enabled": True,
        "storage": "jsonl",
        "record_format": record["format"],
        "entries": len(shared_memory.get("entries", [])),
        "decisions": len(shared_memory.get("decisions", [])),
        "retention_runs": retention_runs,
    }


def _agent_by_id(agent_id: str) -> dict[str, Any]:
    for agent in AGENTS:
        if agent["id"] == agent_id:
            return agent
    raise ValueError(f"Agente desconhecido no plano de orquestração: {agent_id}")


def _execute_agent_step(
    *,
    child_app: FastAPI,
    agent: dict[str, Any],
    message: str,
    metadata: dict[str, Any],
    max_turns: int,
    step_index: int,
    handoff_condition: str | None,
    shared_memory: dict[str, Any],
) -> dict[str, Any]:
    client = TestClient(child_app)
    resource_path = f"/{agent['resource_name']}"
    idempotency_base = f"orchestration-{MANIFEST['id']}-{agent['id']}-{step_index}"
    create_response = client.post(
        resource_path,
        headers={"Idempotency-Key": f"{idempotency_base}-create"},
        json={
            "metadata": {
                **metadata,
                "orchestration": {
                    "manifest_id": MANIFEST["id"],
                    "agent_id": agent["id"],
                    "step_index": step_index,
                    "handoff_condition": handoff_condition,
                    "shared_memory": _shared_memory_context(shared_memory),
                },
            },
            "max_turns": max_turns,
        },
    )
    _raise_for_agent_error(agent, "create_session", create_response)
    session_id = create_response.json()["session"]["session_id"]

    start_response = client.post(
        f"{resource_path}/{session_id}/start",
        headers={"Idempotency-Key": f"{idempotency_base}-start"},
        json={},
    )
    _raise_for_agent_error(agent, "start", start_response)
    turn_response = client.post(
        f"{resource_path}/{session_id}/turn",
        headers={"Idempotency-Key": f"{idempotency_base}-turn"},
        json={"user_message": message},
    )
    _raise_for_agent_error(agent, "turn", turn_response)
    return {
        "agent_id": agent["id"],
        "route_prefix": agent["route_prefix"],
        "resource_name": agent["resource_name"],
        "session_id": session_id,
        "handoff_condition": handoff_condition,
        "start": start_response.json(),
        "turn": turn_response.json(),
    }


def _raise_for_agent_error(agent: dict[str, Any], stage: str, response) -> None:
    if response.status_code < 400:
        return
    raise RuntimeError(
        json.dumps(
            {
                "agent_id": agent["id"],
                "stage": stage,
                "status_code": response.status_code,
                "body": response.text,
            },
            ensure_ascii=False,
        )
    )


@contextmanager
def _isolated_app_import(agent_root: Path) -> Iterator[None]:
    previous_path = list(sys.path)
    previous_modules = {
        name: module
        for name, module in sys.modules.items()
        if name == "app" or name.startswith("app.")
    }
    for name in list(previous_modules):
        sys.modules.pop(name, None)
    sys.path.insert(0, str(agent_root))
    importlib.invalidate_caches()
    try:
        yield
    finally:
        for name in [name for name in sys.modules if name == "app" or name.startswith("app.")]:
            sys.modules.pop(name, None)
        sys.modules.update(previous_modules)
        sys.path[:] = previous_path
        importlib.invalidate_caches()


app = create_app()
