import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
BASELINE_DIR = REPO_ROOT / "examples" / "reference-interview-runtime"
GENERATED_DIR = REPO_ROOT / "generated" / "reference-interview-runtime"
FLOW_PATH = REPO_ROOT / "flows" / "reference-interview" / "agent.flow.json"
GENERATED_FLOW_PATH = GENERATED_DIR / ".agent-flow" / "agent.flow.json"

SELECTED_SCHEMAS = [
    "AssistantMessageView",
    "CreateSessionRequest",
    "CreateSessionResponse",
    "EmptyIdempotentRequest",
    "EventView",
    "FinishResponse",
    "JobBatchResponse",
    "JobCleanupRequest",
    "JobCleanupResponse",
    "JobMetricsResponse",
    "JobRunResponse",
    "JobView",
    "MessageView",
    "MetadataResponse",
    "SafetyView",
    "SessionView",
    "StartResponse",
    "TurnRequest",
    "TurnResponse",
]

CHILD_SCRIPT = r"""
import json
import os
import sys
from pathlib import Path

from fastapi.testclient import TestClient


runtime_dir = Path(sys.argv[1])
db_path = Path(sys.argv[2])
sys.path.insert(0, str(runtime_dir))

os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
os.environ["REDIS_ENABLED"] = "false"
os.environ["USE_POSTGRES_CHECKPOINTER"] = "false"
os.environ["MOCK_LLM"] = "true"
os.environ["AUTH_ENABLED"] = "false"
os.environ["AUTO_CREATE_TABLES"] = "true"

from app.db import engine
from app.main import create_app
from app.models import Base


Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)
client = TestClient(create_app())


def assert_status(response, expected: int) -> dict:
    if response.status_code != expected:
        raise AssertionError(f"{response.request.method} {response.request.url.path} retornou {response.status_code}: {response.text}")
    try:
        return response.json()
    except Exception:
        return {}


def session_signature(session: dict) -> dict:
    return {
        "status": session["status"],
        "phase": session["phase"],
        "turn": session["turn"],
        "max_turns": session["max_turns"],
        "metadata": session["metadata"],
        "is_complete": session["is_complete"],
    }


def message_signature(message: dict) -> dict:
    return {
        "seq": message["seq"],
        "role": message["role"],
        "code": message.get("code"),
    }


def event_signature(event: dict) -> dict:
    payload = event.get("payload") or {}
    return {
        "seq": event["seq"],
        "event_type": event["event_type"],
        "node": event.get("node"),
        "payload_keys": sorted(payload.keys()),
    }


def job_signature(job: dict, session_id: str) -> dict:
    payload = job.get("payload") or {}
    result = job.get("result") or {}
    return {
        "agent_id": job["agent_id"],
        "session_id_matches": job["session_id"] == session_id,
        "kind": job["kind"],
        "status": job["status"],
        "attempts": job["attempts"],
        "max_attempts": job["max_attempts"],
        "payload_keys": sorted(payload.keys()),
        "result_shape": response_shape(result),
        "last_error_shape": response_shape(job.get("last_error") or {}),
        "next_run_at_present": bool(job.get("next_run_at")),
    }


def job_metrics_signature(metrics: dict) -> dict:
    required_keys = {
        "total",
        "by_status",
        "by_kind",
        "attempts_total",
        "pending_due",
        "failed",
        "exhausted",
        "succeeded",
        "terminal",
        "success_rate",
        "duration_ms_avg",
        "duration_ms_min",
        "duration_ms_max",
        "duration_ms_p95",
        "window_hours",
        "finished_in_window",
        "succeeded_in_window",
        "failed_in_window",
        "success_rate_in_window",
        "window_duration_ms_avg",
        "window_duration_ms_p95",
        "throughput_per_hour",
        "oldest_pending_at",
        "next_due_at",
        "finished_last_hour",
        "last_finished_at",
    }
    missing = sorted(required_keys - set(metrics))
    if missing:
        raise AssertionError(f"JobMetricsResponse sem campos esperados: {missing}")
    return {
        "total": metrics["total"],
        "by_status": metrics["by_status"],
        "by_kind": metrics["by_kind"],
        "attempts_total": metrics["attempts_total"],
        "pending_due": metrics["pending_due"],
        "failed": metrics["failed"],
        "exhausted": metrics["exhausted"],
        "succeeded": metrics["succeeded"],
        "terminal": metrics["terminal"],
        "success_rate": metrics["success_rate"],
        "duration_ms_avg_present": metrics["duration_ms_avg"] is not None,
        "duration_ms_min_present": metrics["duration_ms_min"] is not None,
        "duration_ms_max_present": metrics["duration_ms_max"] is not None,
        "duration_ms_p95_present": metrics["duration_ms_p95"] is not None,
        "window_hours": metrics["window_hours"],
        "finished_in_window": metrics["finished_in_window"],
        "succeeded_in_window": metrics["succeeded_in_window"],
        "failed_in_window": metrics["failed_in_window"],
        "success_rate_in_window": metrics["success_rate_in_window"],
        "window_duration_ms_avg_present": metrics["window_duration_ms_avg"] is not None,
        "window_duration_ms_p95_present": metrics["window_duration_ms_p95"] is not None,
        "throughput_per_hour_present": metrics["throughput_per_hour"] is not None,
        "oldest_pending_at_present": metrics["oldest_pending_at"] is not None,
        "next_due_at_present": metrics["next_due_at"] is not None,
        "finished_last_hour": metrics["finished_last_hour"],
        "last_finished_at_present": metrics["last_finished_at"] is not None,
    }


def job_cleanup_signature(cleanup: dict) -> dict:
    required_keys = {
        "dry_run",
        "matched",
        "deleted",
        "statuses",
        "older_than_hours",
        "cutoff",
        "job_ids",
        "by_status",
    }
    missing = sorted(required_keys - set(cleanup))
    if missing:
        raise AssertionError(f"JobCleanupResponse sem campos esperados: {missing}")
    return {
        "dry_run": cleanup["dry_run"],
        "matched": cleanup["matched"],
        "deleted": cleanup["deleted"],
        "statuses": cleanup["statuses"],
        "older_than_hours": cleanup["older_than_hours"],
        "job_id_count": len(cleanup["job_ids"]),
        "by_status": cleanup["by_status"],
        "cutoff_present": bool(cleanup["cutoff"]),
    }


def response_shape(value):
    if isinstance(value, dict):
        return {key: response_shape(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        return [response_shape(item) for item in value]
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int):
        return "int"
    if value is None:
        return "null"
    return "str"


def normalize_openapi(openapi: dict) -> dict:
    return {
        "paths": {
            path: sorted(method for method in path_item if method in {"get", "post", "put", "patch", "delete"})
            for path, path_item in sorted(openapi["paths"].items())
        },
        "schemas": {
            name: openapi["components"]["schemas"][name]
            for name in sorted(openapi["components"]["schemas"])
            if name in set(%s)
        },
    }


metadata = assert_status(client.get("/metadata"), 200)
openapi = normalize_openapi(assert_status(client.get("/openapi.json"), 200))

create = assert_status(
    client.post(
        "/sessions",
        headers={"Idempotency-Key": "parity-create"},
        json={"metadata": {"source": "parity"}, "max_turns": 2},
    ),
    200,
)
session_id = create["session"]["session_id"]
duplicate_create = assert_status(
    client.post(
        "/sessions",
        headers={"Idempotency-Key": "parity-create"},
        json={"metadata": {"source": "parity"}, "max_turns": 2},
    ),
    200,
)
start = assert_status(
    client.post(f"/sessions/{session_id}/start", headers={"Idempotency-Key": "parity-start"}, json={}),
    200,
)
turn = assert_status(
    client.post(
        f"/sessions/{session_id}/turn",
        headers={"Idempotency-Key": "parity-turn"},
        json={"user_message": "Este é um teste de paridade."},
    ),
    200,
)
duplicate_turn = assert_status(
    client.post(
        f"/sessions/{session_id}/turn",
        headers={"Idempotency-Key": "parity-turn"},
        json={"user_message": "Este é um teste de paridade."},
    ),
    200,
)
transcript = assert_status(client.get(f"/sessions/{session_id}/transcript"), 200)
events = assert_status(client.get(f"/sessions/{session_id}/events"), 200)
finish = assert_status(
    client.post(f"/sessions/{session_id}/finish", headers={"Idempotency-Key": "parity-finish"}, json={}),
    200,
)
jobs = assert_status(client.get(f"/jobs?session_id={session_id}"), 200)
if len(jobs) != 1:
    raise AssertionError(f"Esperado 1 job pos-finalizacao, recebido {len(jobs)}")
job_id = jobs[0]["job_id"]
job = assert_status(client.get(f"/jobs/{job_id}"), 200)
run_job = assert_status(client.post(f"/jobs/{job_id}/run"), 200)["job"]
run_pending_empty = assert_status(client.post(f"/jobs/run-pending?session_id={session_id}"), 200)
retry_failed_empty = assert_status(client.post(f"/jobs/retry-failed?session_id={session_id}"), 200)
job_metrics = assert_status(client.get("/jobs/metrics"), 200)
job_cleanup_preview = assert_status(
    client.post("/jobs/cleanup", json={"session_id": session_id, "older_than_hours": 0, "dry_run": True}),
    200,
)
completed_events = assert_status(client.get(f"/sessions/{session_id}/events"), 200)

conflict_first = assert_status(
    client.post(
        "/sessions",
        headers={"Idempotency-Key": "parity-conflict"},
        json={"metadata": {"source": "one"}, "max_turns": 2},
    ),
    200,
)
conflict_second = client.post(
    "/sessions",
    headers={"Idempotency-Key": "parity-conflict"},
    json={"metadata": {"source": "two"}, "max_turns": 2},
)

safety_create = assert_status(
    client.post("/sessions", headers={"Idempotency-Key": "parity-safe-create"}, json={"max_turns": 3}),
    200,
)
safety_session_id = safety_create["session"]["session_id"]
assert_status(
    client.post(f"/sessions/{safety_session_id}/start", headers={"Idempotency-Key": "parity-safe-start"}, json={}),
    200,
)
safety_turn = assert_status(
    client.post(
        f"/sessions/{safety_session_id}/turn",
        headers={"Idempotency-Key": "parity-safe-turn"},
        json={"user_message": "Eu vou me matar hoje."},
    ),
    200,
)
safety_events = assert_status(client.get(f"/sessions/{safety_session_id}/events"), 200)

payload = {
    "metadata": metadata,
    "openapi": openapi,
    "normal_flow": {
        "create_shape": response_shape(create),
        "duplicate_create_session_matches": duplicate_create["session"]["session_id"] == session_id,
        "start_session": session_signature(start["session"]),
        "start_messages": [message_signature(item) for item in start["messages"]],
        "turn_session": session_signature(turn["session"]),
        "turn_assistant_code": turn["assistant_message"]["code"],
        "turn_safety": turn["safety"],
        "duplicate_turn_assistant_matches": duplicate_turn["assistant_message"] == turn["assistant_message"],
        "transcript": [message_signature(item) for item in transcript],
        "events": [event_signature(item) for item in events],
        "finish_session": session_signature(finish["session"]),
        "finish_message": message_signature(finish["message"]) if finish.get("message") else None,
        "jobs": [job_signature(item, session_id) for item in jobs],
        "job": job_signature(job, session_id),
        "run_job": job_signature(run_job, session_id),
        "run_pending_empty": run_pending_empty,
        "retry_failed_empty": retry_failed_empty,
        "job_metrics": job_metrics_signature(job_metrics),
        "job_cleanup_preview": job_cleanup_signature(job_cleanup_preview),
        "events_after_job": [event_signature(item) for item in completed_events],
    },
    "conflict": {
        "first_status": 200 if conflict_first else None,
        "second_status": conflict_second.status_code,
    },
    "safety": {
        "session": session_signature(safety_turn["session"]),
        "assistant_code": safety_turn["assistant_message"]["code"],
        "safety": safety_turn["safety"],
        "events": [event_signature(item) for item in safety_events],
    },
}

print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
""" % json.dumps(SELECTED_SCHEMAS, ensure_ascii=False)


def main() -> int:
    flow = read_json(FLOW_PATH)
    generated_flow = read_json(GENERATED_FLOW_PATH)
    assert_equal("generated .agent-flow/agent.flow.json", generated_flow, flow)

    expected_paths = expected_contract_paths(flow["api"]["resourceName"])
    with tempfile.TemporaryDirectory(prefix="agent-parity-") as tmp_dir:
        tmp_path = Path(tmp_dir)
        baseline = collect_runtime(BASELINE_DIR, tmp_path / "baseline.db")
        generated = collect_runtime(GENERATED_DIR, tmp_path / "generated.db")

    assert_equal("OpenAPI paths", baseline["openapi"]["paths"], generated["openapi"]["paths"])
    assert_equal("OpenAPI paths contra flow spec", generated["openapi"]["paths"], expected_paths)
    assert_equal("OpenAPI schemas principais", baseline["openapi"]["schemas"], generated["openapi"]["schemas"])

    for label, snapshot in {"baseline": baseline, "generated": generated}.items():
        assert_metadata_matches_flow(label, snapshot["metadata"], flow)

    assert_equal("metadata comum", baseline["metadata"], generated["metadata"])
    assert_equal("fluxo normal", baseline["normal_flow"], generated["normal_flow"])
    assert_equal("conflito de idempotência", baseline["conflict"], generated["conflict"])
    assert_equal("safety de entrada", baseline["safety"], generated["safety"])

    print(
        json.dumps(
            {
                "status": "ok",
                "baseline": str(BASELINE_DIR.relative_to(REPO_ROOT)),
                "generated": str(GENERATED_DIR.relative_to(REPO_ROOT)),
                "flow": flow["id"],
                "paths": len(expected_paths),
                "schemas": len(SELECTED_SCHEMAS),
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    )
    return 0


def collect_runtime(runtime_dir: Path, db_path: Path) -> dict[str, Any]:
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    result = subprocess.run(
        [sys.executable, "-c", CHILD_SCRIPT, str(runtime_dir), str(db_path)],
        cwd=runtime_dir,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"Falha ao coletar runtime {runtime_dir}.\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )
    return json.loads(result.stdout)


def expected_contract_paths(resource_name: str) -> dict[str, list[str]]:
    base = f"/{resource_name}"
    return {
        "/health": ["get"],
        "/jobs": ["get"],
        "/jobs/cleanup": ["post"],
        "/jobs/metrics": ["get"],
        "/jobs/retry-failed": ["post"],
        "/jobs/run-pending": ["post"],
        "/jobs/{job_id}": ["get"],
        "/jobs/{job_id}/recurrence": ["post"],
        "/jobs/{job_id}/retry": ["post"],
        "/jobs/{job_id}/run": ["post"],
        "/jobs/{job_id}/schedule": ["post"],
        "/job-schedules": ["get"],
        "/job-schedules/run-due": ["post"],
        "/job-schedules/trigger-event": ["post"],
        "/job-schedules/{schedule_id}/disable": ["post"],
        "/auth/audit": ["get"],
        "/auth/keys": ["get"],
        "/metadata": ["get"],
        base: ["post"],
        f"{base}/{{session_id}}": ["get"],
        f"{base}/{{session_id}}/events": ["get"],
        f"{base}/{{session_id}}/events/stream": ["get"],
        f"{base}/{{session_id}}/finish": ["post"],
        f"{base}/{{session_id}}/start": ["post"],
        f"{base}/{{session_id}}/transcript": ["get"],
        f"{base}/{{session_id}}/turn": ["post"],
        f"{base}/{{session_id}}/turn/stream": ["post"],
    }


def assert_metadata_matches_flow(label: str, metadata: dict[str, Any], flow: dict[str, Any]) -> None:
    expected = {
        "service": "reference-interview-runtime",
        "runtime": "langgraph-fastapi-python",
        "contract": flow["api"]["contract"],
        "flow_id": flow["id"],
        "agent_id": flow["id"],
        "flow_version": flow["version"],
        "llm_adapter": flow["llm"]["adapter"],
        "supports_multi_agent_bundle": False,
        "operations": {
            "jobs": {
                "enabled": True,
                "manual_cleanup_endpoint": "POST /jobs/cleanup",
                "worker": {
                    "command": "python -m app.worker",
                    "interval_seconds": 5.0,
                    "limit": 20,
                    "retry_delay_seconds": 5.0,
                    "lease_seconds": 60.0,
                    "multiworker_claims": True,
                },
                "retention": {
                    "automatic_cleanup_enabled": False,
                    "older_than_hours": 168.0,
                    "limit": 100,
                    "statuses": ["succeeded", "failed"],
                    "dry_run_default": True,
                    "terminal_statuses": ["failed", "succeeded"],
                },
                "schedules": {
                    "interval": True,
                    "cron": "basic",
                    "event": True,
                },
            }
        },
    }
    assert_equal(f"metadata {label}", metadata, expected)


def assert_equal(label: str, actual: Any, expected: Any) -> None:
    if actual != expected:
        raise AssertionError(
            f"{label} divergiu.\n"
            f"Atual:\n{json.dumps(actual, ensure_ascii=False, indent=2, sort_keys=True)}\n"
            f"Esperado:\n{json.dumps(expected, ensure_ascii=False, indent=2, sort_keys=True)}"
        )


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


if __name__ == "__main__":
    raise SystemExit(main())
