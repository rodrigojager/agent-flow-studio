import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi.testclient import TestClient

from app.generated_flow import AGENT_ID, API_RESOURCE, FLOW_ID
from tests.conftest import set_test_env


def _path(suffix: str = "") -> str:
    return f"/{API_RESOURCE}{suffix}"


def _client(tmp_path, env_overrides=None):
    set_test_env(str(tmp_path / "generated.db"))
    for key, value in (env_overrides or {}).items():
        os.environ[key] = value

    from app.settings import get_settings

    get_settings.cache_clear()

    from app.db import engine
    from app.main import create_app
    from app.models import Base

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestClient(create_app())


def test_generated_init_db_adds_agent_columns_to_legacy_sqlite(tmp_path):
    db_path = tmp_path / "legacy.db"
    connection = sqlite3.connect(db_path)
    connection.executescript(
        """
        CREATE TABLE agent_sessions (
          session_id VARCHAR PRIMARY KEY,
          status VARCHAR NOT NULL,
          phase VARCHAR NOT NULL,
          turn INTEGER NOT NULL DEFAULT 0,
          max_turns INTEGER NOT NULL DEFAULT 3,
          metadata_json JSON,
          created_at DATETIME,
          updated_at DATETIME,
          completed_at DATETIME
        );
        INSERT INTO agent_sessions (session_id, status, phase, turn, max_turns)
        VALUES ('legacy-session', 'created', 'created', 0, 3);

        CREATE TABLE agent_events (
          event_id VARCHAR PRIMARY KEY,
          session_id VARCHAR NOT NULL,
          seq INTEGER NOT NULL,
          event_type VARCHAR NOT NULL,
          node VARCHAR NULL,
          payload JSON,
          created_at DATETIME
        );
        INSERT INTO agent_events (event_id, session_id, seq, event_type)
        VALUES ('legacy-event', 'legacy-session', 1, 'legacy');

        CREATE TABLE agent_jobs (
          job_id VARCHAR PRIMARY KEY,
          session_id VARCHAR NOT NULL,
          kind VARCHAR NOT NULL,
          status VARCHAR NOT NULL
        );
        INSERT INTO agent_jobs (job_id, session_id, kind, status)
        VALUES ('legacy-job', 'legacy-session', 'post_finish_summary', 'pending');
        """
    )
    connection.close()

    project_root = Path(__file__).resolve().parents[1]
    script = """
import os
import sqlite3
from pathlib import Path

db_path = Path(os.environ["LEGACY_DB_PATH"])
expected_agent_id = os.environ["EXPECTED_AGENT_ID"]
os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
os.environ["REDIS_ENABLED"] = "false"
os.environ["USE_POSTGRES_CHECKPOINTER"] = "false"
os.environ["MOCK_LLM"] = "true"
os.environ["AUTH_ENABLED"] = "false"
os.environ["AUTO_CREATE_TABLES"] = "true"
os.environ["LANGSMITH_TRACING"] = "false"

from app.db import init_db

init_db()
connection = sqlite3.connect(db_path)
session_columns = {row[1] for row in connection.execute("PRAGMA table_info(agent_sessions)").fetchall()}
event_columns = {row[1] for row in connection.execute("PRAGMA table_info(agent_events)").fetchall()}
job_columns = {row[1] for row in connection.execute("PRAGMA table_info(agent_jobs)").fetchall()}
assert "agent_id" in session_columns
assert "agent_id" in event_columns
assert {
    "agent_id",
    "attempts",
    "max_attempts",
    "result_json",
    "last_error_json",
    "created_at",
    "updated_at",
    "next_run_at",
    "locked_by",
    "locked_until",
    "lock_acquired_at",
}.issubset(job_columns)
assert connection.execute("SELECT agent_id FROM agent_sessions WHERE session_id = 'legacy-session'").fetchone()[0] == expected_agent_id
assert connection.execute("SELECT agent_id FROM agent_events WHERE event_id = 'legacy-event'").fetchone()[0] == expected_agent_id
assert connection.execute("SELECT agent_id FROM agent_jobs WHERE job_id = 'legacy-job'").fetchone()[0] == expected_agent_id
connection.close()
"""
    env = {**os.environ, "LEGACY_DB_PATH": str(db_path), "EXPECTED_AGENT_ID": AGENT_ID, "PYTHONPATH": str(project_root)}
    subprocess.run([sys.executable, "-c", script], cwd=project_root, env=env, check=True)


def test_generated_runtime_metadata_flow_and_idempotency(tmp_path):
    client = _client(tmp_path)

    metadata = client.get("/metadata")
    assert metadata.status_code == 200
    assert metadata.json()["flow_id"] == FLOW_ID
    assert metadata.json()["agent_id"] == AGENT_ID

    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "create-1"},
        json={"metadata": {"source": "pytest"}, "max_turns": 2},
    )
    assert create_resp.status_code == 200
    session_id = create_resp.json()["session"]["session_id"]
    assert create_resp.json()["session"]["agent_id"] == AGENT_ID

    duplicate_create = client.post(
        _path(),
        headers={"Idempotency-Key": "create-1"},
        json={"metadata": {"source": "pytest"}, "max_turns": 2},
    )
    assert duplicate_create.status_code == 200
    assert duplicate_create.json()["session"]["session_id"] == session_id

    start_resp = client.post(
        _path(f"/{session_id}/start"),
        headers={"Idempotency-Key": "start-1"},
        json={},
    )
    assert start_resp.status_code == 200
    assert start_resp.json()["session"]["status"] == "active"
    assert start_resp.json()["messages"]
    assert start_resp.json()["messages"][0]["code"]

    turn_payload = {"user_message": "Este é um teste do fluxo."}
    turn_resp = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "turn-1"},
        json=turn_payload,
    )
    assert turn_resp.status_code == 200
    turn_data = turn_resp.json()
    assert turn_data["assistant_message"]["code"] == "ECHO"
    assert turn_data["safety"]["decision"] == "allow"
    assert turn_data["session"]["agent_id"] == AGENT_ID
    assert turn_data["session"]["turn"] == 1

    duplicate_turn = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "turn-1"},
        json=turn_payload,
    )
    assert duplicate_turn.status_code == 200
    assert duplicate_turn.json()["assistant_message"] == turn_data["assistant_message"]

    transcript = client.get(_path(f"/{session_id}/transcript")).json()
    assert [item["role"] for item in transcript].count("user") == 1
    assert [item["role"] for item in transcript].count("assistant") == 2

    events = client.get(_path(f"/{session_id}/events")).json()
    event_types = [item["event_type"] for item in events]
    assert "span_started" in event_types
    assert "span_completed" in event_types
    assert "llm_called" in event_types
    assert {item["agent_id"] for item in events} == {AGENT_ID}
    completed_spans = [item for item in events if item["event_type"] == "span_completed"]
    completed_node_ids = {item["node"] for item in completed_spans}
    assert "llm_step" in completed_node_ids
    llm_span = next(item for item in completed_spans if item["node"] == "llm_step")
    assert llm_span["payload"]["span"]["operation"] == "graph_node"
    assert llm_span["payload"]["span"]["node_type"] == "llm_prompt"
    assert llm_span["payload"]["span"]["duration_ms"] >= 0
    assert llm_span["payload"]["source"] == "runtime_native_span"
    if "source_message_id" in llm_span["payload"]:
        assert llm_span["payload"]["source_message_id"]


    with client.stream("GET", _path(f"/{session_id}/events/stream?from_seq=1&max_events=1")) as stream:
        assert stream.status_code == 200
        assert stream.headers["content-type"].startswith("text/event-stream")
        stream_body = "".join(stream.iter_text())
    assert "event: agent_event" in stream_body
    assert "event: stream_closed" in stream_body
    assert '"reason": "max_events"' in stream_body

    with client.websocket_connect(_path(f"/{session_id}/events/ws?from_seq=1&max_events=1")) as websocket:
        websocket_event = websocket.receive_json()
        websocket_closed = websocket.receive_json()
    assert websocket_event["event"] == "agent_event"
    assert websocket_event["data"]["seq"] == 1
    assert websocket_closed["event"] == "stream_closed"
    assert websocket_closed["data"]["reason"] == "max_events"

    finish_resp = client.post(
        _path(f"/{session_id}/finish"),
        headers={"Idempotency-Key": "finish-1"},
        json={},
    )
    assert finish_resp.status_code == 200
    jobs = client.get(f"/jobs?session_id={session_id}").json()
    assert len(jobs) == 1
    assert jobs[0]["kind"] == "post_finish_summary"
    assert jobs[0]["status"] == "pending"

    run_job = client.post(f"/jobs/{jobs[0]['job_id']}/run").json()["job"]
    assert run_job["status"] == "succeeded"
    assert run_job["result"]["message_count"] >= 3
    assert run_job["result"]["event_count"] >= len(events)
    metrics = client.get("/jobs/metrics?window_hours=24").json()
    assert metrics["total"] == 1
    assert metrics["by_status"]["succeeded"] == 1
    assert metrics["by_kind"]["post_finish_summary"] == 1
    assert metrics["attempts_total"] == 1
    assert metrics["succeeded"] == 1
    assert metrics["terminal"] == 1
    assert metrics["success_rate"] == 1
    assert metrics["duration_ms_avg"] is not None
    assert metrics["duration_ms_p95"] is not None
    assert metrics["duration_ms_max"] >= metrics["duration_ms_min"] >= 0
    assert metrics["window_hours"] == 24
    assert metrics["finished_in_window"] == 1
    assert metrics["succeeded_in_window"] == 1
    assert metrics["success_rate_in_window"] == 1
    assert metrics["window_duration_ms_p95"] is not None
    assert metrics["throughput_per_hour"] > 0
    assert metrics["finished_last_hour"] == 1
    assert metrics["last_finished_at"] is not None

    completed_events = client.get(_path(f"/{session_id}/events")).json()
    assert "post_finish_completed" in [item["event_type"] for item in completed_events]


def test_generated_metadata_exposes_sanitized_worker_retention_policy(tmp_path):
    client = _client(
        tmp_path,
        env_overrides={
            "WORKER_INTERVAL_SECONDS": "9",
            "WORKER_LIMIT": "7",
            "WORKER_RETRY_DELAY_SECONDS": "3",
            "WORKER_LEASE_SECONDS": "42",
            "WORKER_CLEANUP_ENABLED": "true",
            "WORKER_CLEANUP_OLDER_THAN_HOURS": "12",
            "WORKER_CLEANUP_LIMIT": "11",
            "WORKER_CLEANUP_STATUSES": "failed,succeeded",
            "AGENT_API_KEY": "metadata-secret",
        },
    )

    response = client.get("/metadata")

    assert response.status_code == 200
    data = response.json()
    jobs = data["operations"]["jobs"]
    assert jobs["manual_cleanup_endpoint"] == "POST /jobs/cleanup"
    assert jobs["worker"]["command"] == "python -m app.worker"
    assert jobs["worker"]["interval_seconds"] == 9
    assert jobs["worker"]["limit"] == 7
    assert jobs["worker"]["retry_delay_seconds"] == 3
    assert jobs["worker"]["lease_seconds"] == 42
    assert jobs["worker"]["multiworker_claims"] is True
    assert jobs["retention"]["automatic_cleanup_enabled"] is True
    assert jobs["retention"]["older_than_hours"] == 12
    assert jobs["retention"]["limit"] == 11
    assert jobs["retention"]["statuses"] == ["failed", "succeeded"]
    assert jobs["retention"]["dry_run_default"] is True
    assert jobs["retention"]["terminal_statuses"] == ["failed", "succeeded"]
    assert jobs["schedules"] == {"interval": True, "cron": "basic", "event": True}
    assert "metadata-secret" not in json.dumps(data)
    assert "api_key" not in json.dumps(data).lower()


def test_generated_job_cleanup_previews_and_deletes_only_old_terminal_jobs(tmp_path):
    client = _client(tmp_path)

    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "cleanup-create"},
        json={"max_turns": 2},
    )
    session_id = create_resp.json()["session"]["session_id"]
    assert client.post(
        _path(f"/{session_id}/start"),
        headers={"Idempotency-Key": "cleanup-start"},
        json={},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "cleanup-turn"},
        json={"user_message": "Resposta para cleanup."},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/finish"),
        headers={"Idempotency-Key": "cleanup-finish"},
        json={},
    ).status_code == 200
    job_id = client.get(f"/jobs?session_id={session_id}").json()[0]["job_id"]
    assert client.post(f"/jobs/{job_id}/run").json()["job"]["status"] == "succeeded"

    from app.db import session_scope
    from app.models import AgentJob

    old_finished_at = datetime.now(timezone.utc) - timedelta(hours=240)
    with session_scope() as db:
        row = db.get(AgentJob, job_id)
        row.finished_at = old_finished_at
        row.started_at = old_finished_at - timedelta(seconds=1)

    invalid = client.post("/jobs/cleanup", json={"statuses": ["pending"], "dry_run": True})
    assert invalid.status_code == 400

    preview = client.post(
        "/jobs/cleanup",
        json={"session_id": session_id, "older_than_hours": 24, "dry_run": True},
    ).json()
    assert preview["dry_run"] is True
    assert preview["matched"] == 1
    assert preview["deleted"] == 0
    assert preview["job_ids"] == [job_id]
    assert preview["by_status"] == {"succeeded": 1}
    assert client.get(f"/jobs/{job_id}").status_code == 200

    cleanup = client.post(
        "/jobs/cleanup",
        json={"session_id": session_id, "older_than_hours": 24, "dry_run": False},
    ).json()
    assert cleanup["dry_run"] is False
    assert cleanup["matched"] == 1
    assert cleanup["deleted"] == 1
    assert cleanup["job_ids"] == [job_id]
    assert client.get(f"/jobs/{job_id}").status_code == 404
    assert client.get(_path(f"/{session_id}/transcript")).status_code == 200
    events = client.get(_path(f"/{session_id}/events")).json()
    cleanup_events = [item for item in events if item["event_type"] == "jobs_cleanup_completed"]
    assert cleanup_events[-1]["payload"]["deleted"] == 1
    assert cleanup_events[-1]["payload"]["job_ids"] == [job_id]


def test_generated_ollama_missing_model_returns_prescriptive_fallback(tmp_path, monkeypatch):
    class FakeResponses:
        def create(self, *args, **kwargs):
            raise RuntimeError("model 'qwen3:8b' not found, try pulling it first")

    class FakeOpenAI:
        def __init__(self, **kwargs):
            self.responses = FakeResponses()

    import app.llm as llm_module

    set_test_env(str(tmp_path / "generated.db"))
    os.environ["MOCK_LLM"] = "false"
    os.environ["LLM_ADAPTER"] = "ollama"
    os.environ["LLM_MODEL"] = "qwen3:8b"
    os.environ["OPENAI_API_KEY"] = ""
    os.environ["OPENAI_BASE_URL"] = "http://localhost:11434/v1"

    from app.settings import get_settings

    get_settings.cache_clear()
    monkeypatch.setattr(llm_module, "OpenAI", FakeOpenAI)
    result = llm_module.LLMClient(get_settings()).generate(
        system_prompt="Sistema de teste",
        user_message="Vamos testar o modelo local.",
        context={"session_id": "test-session"},
        recent_messages=[],
        adapter="ollama",
        model="qwen3:8b",
    )
    assert "ollama pull qwen3:8b" in result.text
    assert "docker compose --profile model-setup up ollama-pull-qwen3-8b" in result.text
    assert result.provider == "ollama"
    assert result.fallback_reason == "local_model_missing"
    assert result.setup_command == "ollama pull qwen3:8b"
    assert result.docker_setup_command == "docker compose --profile model-setup up ollama-pull-qwen3-8b"


def test_generated_turn_stream_emits_tokens_and_reuses_idempotency(tmp_path):
    client = _client(tmp_path)

    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "stream-create"},
        json={"max_turns": 2},
    )
    session_id = create_resp.json()["session"]["session_id"]
    assert client.post(
        _path(f"/{session_id}/start"),
        headers={"Idempotency-Key": "stream-start"},
        json={},
    ).status_code == 200

    payload = {"user_message": "Mensagem com stream."}
    with client.stream(
        "POST",
        _path(f"/{session_id}/turn/stream"),
        headers={"Idempotency-Key": "stream-turn"},
        json=payload,
    ) as stream:
        assert stream.status_code == 200
        assert stream.headers["content-type"].startswith("text/event-stream")
        stream_body = "".join(stream.iter_text())

    assert "event: turn_started" in stream_body
    assert "event: token" in stream_body
    assert "event: turn_completed" in stream_body
    assert "event: stream_closed" in stream_body
    assert '"source": "llm_callback"' in stream_body
    assert '"reason": "turn_completed"' in stream_body

    duplicate_turn = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "stream-turn"},
        json=payload,
    )
    assert duplicate_turn.status_code == 200
    assert duplicate_turn.json()["assistant_message"]["code"] == "ECHO"

    transcript = client.get(_path(f"/{session_id}/transcript")).json()
    assert [item["role"] for item in transcript].count("user") == 1
    assert [item["role"] for item in transcript].count("assistant") == 2
    events = client.get(_path(f"/{session_id}/events")).json()
    assert "llm_called" in [item["event_type"] for item in events]


def test_generated_turn_stream_ws_emits_events_and_reuses_idempotency(tmp_path):
    client = _client(tmp_path)

    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "ws-stream-create"},
        json={"max_turns": 2},
    )
    session_id = create_resp.json()["session"]["session_id"]
    assert client.post(
        _path(f"/{session_id}/start"),
        headers={"Idempotency-Key": "ws-stream-start"},
        json={},
    ).status_code == 200

    with client.websocket_connect(
        _path(f"/{session_id}/turn/stream/ws?user_message=Mensagem%20com%20stream%20WS.&idempotency_key=ws-turn-stream")
    ) as websocket:
        start_event = websocket.receive_json()
        events = [start_event]
        while True:
            item = websocket.receive_json()
            events.append(item)
            if item["event"] in {"turn_completed", "turn_error"}:
                break
        closed = websocket.receive_json() if events[-1]["event"] != "stream_closed" else None
        if closed is not None:
            events.append(closed)

    assert events[0]["event"] == "turn_started"
    assert any(item["event"] == "token" for item in events)
    assert any(item.get("data", {}).get("source") == "llm_callback" for item in events if item["event"] == "token")
    assert any(item["event"] in {"turn_completed", "turn_error"} for item in events)
    assert events[-1]["event"] == "stream_closed"
    assert any(item.get("data", {}).get("reason") == "turn_completed" for item in events if item["event"] == "stream_closed")


def test_generated_legacy_api_key_still_has_full_access(tmp_path):
    client = _client(
        tmp_path,
        env_overrides={
            "AUTH_ENABLED": "true",
            "AGENT_API_KEY": "legacy-key",
            "AGENT_API_KEYS": "",
        },
    )

    assert client.post(_path(), json={"max_turns": 2}).status_code == 403
    create_resp = client.post(
        _path(),
        headers={"X-Agent-API-Key": "legacy-key", "Idempotency-Key": "legacy-auth-create"},
        json={"max_turns": 2},
    )
    assert create_resp.status_code == 200
    assert client.get("/metadata", headers={"X-Agent-API-Key": "legacy-key"}).status_code == 200


def test_generated_scoped_api_keys_enforce_runtime_permissions(tmp_path):
    scoped_keys = (
        '{"reader-key":["metadata:read","sessions:read"],'
        '"operator-key":["sessions:*"],'
        '"job-reader-key":["jobs:read"]}'
    )
    client = _client(
        tmp_path,
        env_overrides={
            "AUTH_ENABLED": "true",
            "AGENT_API_KEY": "",
            "AGENT_API_KEYS": scoped_keys,
        },
    )

    assert client.get("/health").status_code == 200
    assert client.get("/metadata").status_code == 403
    assert client.get("/metadata", headers={"X-Agent-API-Key": "reader-key"}).status_code == 200
    assert client.post(
        _path(),
        headers={"X-Agent-API-Key": "reader-key"},
        json={"max_turns": 2},
    ).status_code == 403

    create_resp = client.post(
        _path(),
        headers={"X-Agent-API-Key": "operator-key", "Idempotency-Key": "scoped-auth-create"},
        json={"max_turns": 2},
    )
    assert create_resp.status_code == 200
    session_id = create_resp.json()["session"]["session_id"]

    assert client.get(
        _path(f"/{session_id}"),
        headers={"X-Agent-API-Key": "reader-key"},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/start"),
        headers={"X-Agent-API-Key": "reader-key"},
        json={},
    ).status_code == 403
    assert client.post(
        _path(f"/{session_id}/start"),
        headers={"X-Agent-API-Key": "operator-key", "Idempotency-Key": "scoped-auth-start"},
        json={},
    ).status_code == 200

    with client.stream(
        "GET",
        _path(f"/{session_id}/events/stream?from_seq=1&max_events=1"),
    ) as stream:
        assert stream.status_code == 403

    with client.stream(
        "GET",
        _path(f"/{session_id}/events/stream?from_seq=1&max_events=1&api_key=reader-key"),
    ) as stream:
        assert stream.status_code == 200

    with client.stream(
        "GET",
        _path(f"/{session_id}/events/stream?from_seq=1&max_events=1"),
        headers={"X-Agent-API-Key": "reader-key"},
    ) as stream:
        assert stream.status_code == 200

    with client.websocket_connect(
        _path(f"/{session_id}/events/ws?from_seq=1&max_events=1&api_key=reader-key")
    ) as websocket:
        assert websocket.receive_json()["event"] == "agent_event"

    assert client.get("/jobs/metrics", headers={"X-Agent-API-Key": "reader-key"}).status_code == 403
    assert client.get("/jobs/metrics", headers={"X-Agent-API-Key": "job-reader-key"}).status_code == 200
    assert client.post("/jobs/run-pending", headers={"X-Agent-API-Key": "job-reader-key"}).status_code == 403


def test_generated_agent_scoped_api_keys_are_limited_to_current_agent(tmp_path):
    scoped_keys = json.dumps(
        {
            "agent-reader-key": [
                f"agents:{AGENT_ID}:metadata:read",
                f"agents:{AGENT_ID}:sessions:read",
            ],
            "agent-operator-key": [f"agents:{AGENT_ID}:sessions:*"],
            "agent-auth-key": [f"agents:{AGENT_ID}:auth:read"],
            "other-agent-key": ["agents:other-agent:sessions:*", "agents:other-agent:metadata:read"],
        }
    )
    client = _client(
        tmp_path,
        env_overrides={
            "AUTH_ENABLED": "true",
            "AGENT_API_KEY": "",
            "AGENT_API_KEYS": scoped_keys,
        },
    )

    assert client.get("/metadata", headers={"X-Agent-API-Key": "agent-reader-key"}).status_code == 200
    assert client.get("/metadata", headers={"X-Agent-API-Key": "other-agent-key"}).status_code == 403
    assert client.post(
        _path(),
        headers={"X-Agent-API-Key": "other-agent-key"},
        json={"max_turns": 2},
    ).status_code == 403

    create_resp = client.post(
        _path(),
        headers={"X-Agent-API-Key": "agent-operator-key", "Idempotency-Key": "agent-scope-create"},
        json={"max_turns": 2},
    )
    assert create_resp.status_code == 200
    session_id = create_resp.json()["session"]["session_id"]

    assert client.get(
        _path(f"/{session_id}"),
        headers={"X-Agent-API-Key": "agent-reader-key"},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/start"),
        headers={"X-Agent-API-Key": "agent-reader-key"},
        json={},
    ).status_code == 403

    keys_resp = client.get("/auth/keys", headers={"X-Agent-API-Key": "agent-auth-key"})
    assert keys_resp.status_code == 200
    keys_payload = keys_resp.json()
    assert keys_payload["agent_id"] == AGENT_ID
    assert {item["key_id"] for item in keys_payload["keys"]} == {
        "key-1",
        "key-2",
        "key-3",
        "key-4",
    }
    assert "agent-reader-key" not in json.dumps(keys_payload)


def test_generated_api_keys_support_local_expiration_metadata(tmp_path):
    past = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    scoped_keys = json.dumps(
        {
            "keys": [
                {"id": "expired-reader", "key": "expired-reader-key", "scopes": ["metadata:read"], "expires_at": past},
                {"id": "active-reader", "key": "active-reader-key", "scopes": ["metadata:read"], "expires_at": future},
                {"id": "auth-viewer", "key": "auth-viewer-key", "scopes": ["auth:read"], "expiresAt": future},
            ]
        }
    )
    client = _client(
        tmp_path,
        env_overrides={
            "AUTH_ENABLED": "true",
            "AGENT_API_KEY": "",
            "AGENT_API_KEYS": scoped_keys,
        },
    )

    expired_resp = client.get("/metadata", headers={"X-Agent-API-Key": "expired-reader-key"})
    assert expired_resp.status_code == 403
    assert expired_resp.json()["detail"] == "Chave de API expirada."
    assert client.get("/metadata", headers={"X-Agent-API-Key": "active-reader-key"}).status_code == 200

    keys_resp = client.get("/auth/keys", headers={"X-Agent-API-Key": "auth-viewer-key"})
    assert keys_resp.status_code == 200
    keys_payload = keys_resp.json()
    by_id = {item["key_id"]: item for item in keys_payload["keys"]}
    assert by_id["expired-reader"]["expired"] is True
    assert by_id["active-reader"]["expired"] is False
    assert by_id["auth-viewer"]["expires_at"] == future
    assert "expired-reader-key" not in json.dumps(keys_payload)
    assert "active-reader-key" not in json.dumps(keys_payload)


def test_generated_api_keys_support_local_revocation_metadata(tmp_path):
    keys_path = tmp_path / "api-keys.json"
    revoked_path = tmp_path / "revoked-keys.json"
    keys_path.write_text(
        json.dumps(
            {
                "keys": [
                    {"id": "revoked-reader", "key": "revoked-reader-key", "scopes": ["metadata:read"]},
                    {"id": "active-reader", "key": "active-reader-key", "scopes": ["metadata:read"]},
                    {"id": "file-revoked", "key": "file-revoked-key", "scopes": ["metadata:read"]},
                    {"id": "auth-viewer", "key": "auth-viewer-key", "scopes": ["auth:read"]},
                ]
            }
        ),
        encoding="utf-8",
    )
    revoked_path.write_text(
        json.dumps({"revoked": ["AGENT_API_KEYS_PATH:file-revoked"]}),
        encoding="utf-8",
    )
    client = _client(
        tmp_path,
        env_overrides={
            "AUTH_ENABLED": "true",
            "AGENT_API_KEY": "",
            "AGENT_API_KEYS": "",
            "AGENT_API_KEYS_PATH": str(keys_path),
            "AGENT_API_REVOKED_KEY_IDS": '["revoked-reader"]',
            "AGENT_API_REVOKED_KEY_IDS_PATH": str(revoked_path),
        },
    )

    revoked_resp = client.get("/metadata", headers={"X-Agent-API-Key": "revoked-reader-key"})
    assert revoked_resp.status_code == 403
    assert revoked_resp.json()["detail"] == "Chave de API revogada."
    file_revoked_resp = client.get("/metadata", headers={"X-Agent-API-Key": "file-revoked-key"})
    assert file_revoked_resp.status_code == 403
    assert file_revoked_resp.json()["detail"] == "Chave de API revogada."
    assert client.get("/metadata", headers={"X-Agent-API-Key": "active-reader-key"}).status_code == 200

    keys_resp = client.get("/auth/keys", headers={"X-Agent-API-Key": "auth-viewer-key"})
    assert keys_resp.status_code == 200
    keys_payload = keys_resp.json()
    by_id = {item["key_id"]: item for item in keys_payload["keys"]}
    assert keys_payload["revocation"]["configured"] is True
    assert keys_payload["revocation"]["total"] == 2
    assert keys_payload["revocation"]["file"]["exists"] is True
    assert by_id["revoked-reader"]["revoked"] is True
    assert by_id["file-revoked"]["revoked"] is True
    assert by_id["active-reader"]["revoked"] is False
    assert "revoked-reader-key" not in json.dumps(keys_payload)
    assert "file-revoked-key" not in json.dumps(keys_payload)
    assert "active-reader-key" not in json.dumps(keys_payload)


def test_generated_api_keys_file_supports_local_rotation_without_restart(tmp_path):
    keys_path = tmp_path / "api-keys.json"
    keys_path.write_text(
        json.dumps(
            {
                "keys": [
                    {"id": "reader", "key": "reader-file-key", "scopes": ["metadata:read", "auth:read"]},
                    {"id": "operator-v1", "key": "operator-v1-key", "scopes": ["sessions:*"]},
                    {"id": "disabled", "key": "disabled-key", "scopes": ["*"], "enabled": False},
                ]
            }
        ),
        encoding="utf-8",
    )
    client = _client(
        tmp_path,
        env_overrides={
            "AUTH_ENABLED": "true",
            "AGENT_API_KEY": "",
            "AGENT_API_KEYS": "",
            "AGENT_API_KEYS_PATH": str(keys_path),
        },
    )

    assert client.get("/metadata", headers={"X-Agent-API-Key": "reader-file-key"}).status_code == 200
    assert client.post(_path(), headers={"X-Agent-API-Key": "reader-file-key"}, json={"max_turns": 2}).status_code == 403
    assert client.post(_path(), headers={"X-Agent-API-Key": "disabled-key"}, json={"max_turns": 2}).status_code == 403

    keys_resp = client.get("/auth/keys", headers={"X-Agent-API-Key": "reader-file-key"})
    assert keys_resp.status_code == 200
    key_status = keys_resp.json()
    assert key_status["total"] == 2
    assert key_status["sources"]["AGENT_API_KEYS_PATH"] == 2
    assert key_status["file"]["exists"] is True
    assert {item["key_id"] for item in key_status["keys"]} == {"reader", "operator-v1"}
    assert "reader-file-key" not in json.dumps(key_status)
    assert "operator-v1-key" not in json.dumps(key_status)

    create_v1 = client.post(
        _path(),
        headers={"X-Agent-API-Key": "operator-v1-key", "Idempotency-Key": "file-auth-create-v1"},
        json={"max_turns": 2},
    )
    assert create_v1.status_code == 200

    keys_path.write_text(
        json.dumps(
            {
                "keys": [
                    {"id": "reader", "key": "reader-file-key", "scopes": ["metadata:read", "auth:read"]},
                    {"id": "operator-v2", "key": "operator-v2-key", "scopes": ["sessions:*"]},
                ]
            }
        ),
        encoding="utf-8",
    )

    assert client.post(
        _path(),
        headers={"X-Agent-API-Key": "operator-v1-key", "Idempotency-Key": "file-auth-create-old"},
        json={"max_turns": 2},
    ).status_code == 403
    create_v2 = client.post(
        _path(),
        headers={"X-Agent-API-Key": "operator-v2-key", "Idempotency-Key": "file-auth-create-v2"},
        json={"max_turns": 2},
    )
    assert create_v2.status_code == 200

    rotated = client.get("/auth/keys", headers={"X-Agent-API-Key": "reader-file-key"}).json()
    assert {item["key_id"] for item in rotated["keys"]} == {"reader", "operator-v2"}
    assert "operator-v1-key" not in json.dumps(rotated)
    assert "operator-v2-key" not in json.dumps(rotated)


def test_generated_auth_rate_limit_and_audit_log(tmp_path):
    scoped_keys = '{"reader-key":["metadata:read"],"audit-key":["metadata:read"]}'
    audit_path = tmp_path / "auth-audit.jsonl"
    client = _client(
        tmp_path,
        env_overrides={
            "AUTH_ENABLED": "true",
            "AGENT_API_KEY": "",
            "AGENT_API_KEYS": scoped_keys,
            "AUTH_RATE_LIMIT_ENABLED": "true",
            "AUTH_RATE_LIMIT_REQUESTS": "2",
            "AUTH_RATE_LIMIT_WINDOW_SECONDS": "60",
            "AUTH_AUDIT_ENABLED": "true",
            "AUTH_AUDIT_PATH": str(audit_path),
        },
    )

    assert client.get("/metadata").status_code == 403
    assert client.get("/metadata", headers={"X-Agent-API-Key": "reader-key"}).status_code == 200
    assert client.get("/metadata", headers={"X-Agent-API-Key": "reader-key"}).status_code == 200
    limited = client.get("/metadata", headers={"X-Agent-API-Key": "reader-key"})
    assert limited.status_code == 429

    audit_resp = client.get("/auth/audit?limit=20", headers={"X-Agent-API-Key": "audit-key"})
    assert audit_resp.status_code == 200
    audit = audit_resp.json()
    assert audit["persistent"] is True
    assert audit["path"] == str(audit_path)
    statuses = [entry["status"] for entry in audit["entries"]]
    assert "allowed" in statuses
    assert "rejected" in statuses
    assert "rate_limited" in statuses
    assert any(entry["key_id"] == "key-1" and entry["status"] == "rate_limited" for entry in audit["entries"])
    assert all("reader-key" not in json.dumps(entry) for entry in audit["entries"])
    persisted = [json.loads(line) for line in audit_path.read_text(encoding="utf-8").splitlines()]
    assert len(persisted) >= 3
    assert any(entry["status"] == "rate_limited" for entry in persisted)
    assert all("reader-key" not in json.dumps(entry) for entry in persisted)

    reloaded = _client(
        tmp_path,
        env_overrides={
            "AUTH_ENABLED": "true",
            "AGENT_API_KEY": "",
            "AGENT_API_KEYS": scoped_keys,
            "AUTH_AUDIT_ENABLED": "true",
            "AUTH_AUDIT_PATH": str(audit_path),
        },
    )
    reloaded_audit = reloaded.get("/auth/audit?limit=20", headers={"X-Agent-API-Key": "audit-key"}).json()
    assert reloaded_audit["total"] >= audit["total"]
    assert any(entry["status"] == "rate_limited" for entry in reloaded_audit["entries"])


def test_generated_worker_processes_pending_jobs(tmp_path):
    client = _client(tmp_path)

    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "worker-create"},
        json={"max_turns": 2},
    )
    session_id = create_resp.json()["session"]["session_id"]
    assert client.post(
        _path(f"/{session_id}/start"),
        headers={"Idempotency-Key": "worker-start"},
        json={},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "worker-turn"},
        json={"user_message": "Resposta para gerar job."},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/finish"),
        headers={"Idempotency-Key": "worker-finish"},
        json={},
    ).status_code == 200

    pending_jobs = client.get(f"/jobs?session_id={session_id}").json()
    assert len(pending_jobs) == 1
    assert pending_jobs[0]["status"] == "pending"

    from app.worker import build_worker_service, process_pending_jobs

    result = process_pending_jobs(build_worker_service(), limit=5, bootstrap_flow_triggers=False)
    assert result == {"processed": 1, "failed": 0, "retried": 0, "pending_seen": 1}

    jobs = client.get(f"/jobs?session_id={session_id}").json()
    assert jobs[0]["status"] == "succeeded"
    completed_events = client.get(_path(f"/{session_id}/events")).json()
    assert "post_finish_completed" in [item["event_type"] for item in completed_events]


def test_generated_worker_can_run_governed_cleanup_policy(tmp_path):
    client = _client(tmp_path)

    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "worker-cleanup-create"},
        json={"max_turns": 2},
    )
    session_id = create_resp.json()["session"]["session_id"]
    assert client.post(
        _path(f"/{session_id}/start"),
        headers={"Idempotency-Key": "worker-cleanup-start"},
        json={},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "worker-cleanup-turn"},
        json={"user_message": "Resposta para limpeza automatica."},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/finish"),
        headers={"Idempotency-Key": "worker-cleanup-finish"},
        json={},
    ).status_code == 200
    job_id = client.get(f"/jobs?session_id={session_id}").json()[0]["job_id"]

    from app.worker import build_worker_service, process_pending_jobs

    run_result = process_pending_jobs(build_worker_service(), limit=5, bootstrap_flow_triggers=False)
    assert run_result == {"processed": 1, "failed": 0, "retried": 0, "pending_seen": 1}

    from app.db import session_scope
    from app.models import AgentJob

    old_finished_at = datetime.now(timezone.utc) - timedelta(hours=240)
    with session_scope() as db:
        row = db.get(AgentJob, job_id)
        row.finished_at = old_finished_at
        row.started_at = old_finished_at - timedelta(seconds=1)

    idle_result = process_pending_jobs(build_worker_service(), limit=5, bootstrap_flow_triggers=False)
    assert idle_result == {"processed": 0, "failed": 0, "retried": 0, "pending_seen": 0}
    assert client.get(f"/jobs/{job_id}").status_code == 200

    cleanup_result = process_pending_jobs(
        build_worker_service(),
        limit=5,
        cleanup_enabled=True,
        cleanup_older_than_hours=24,
        cleanup_limit=10,
        cleanup_statuses=["succeeded"],
        bootstrap_flow_triggers=False,
    )
    assert cleanup_result["processed"] == 0
    assert cleanup_result["failed"] == 0
    assert cleanup_result["retried"] == 0
    assert cleanup_result["pending_seen"] == 0
    assert cleanup_result["cleanup"]["dry_run"] is False
    assert cleanup_result["cleanup"]["matched"] == 1
    assert cleanup_result["cleanup"]["deleted"] == 1
    assert cleanup_result["cleanup"]["job_ids"] == [job_id]
    assert cleanup_result["cleanup"]["by_status"] == {"succeeded": 1}
    assert client.get(f"/jobs/{job_id}").status_code == 404
    events = client.get(_path(f"/{session_id}/events")).json()
    cleanup_events = [item for item in events if item["event_type"] == "jobs_cleanup_completed"]
    assert cleanup_events[-1]["payload"]["deleted"] == 1
    assert cleanup_events[-1]["payload"]["job_ids"] == [job_id]


def test_generated_job_claim_lease_prevents_duplicate_multiworker_and_allows_takeover(tmp_path):
    client = _client(tmp_path)

    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "lease-create"},
        json={"max_turns": 2},
    )
    session_id = create_resp.json()["session"]["session_id"]
    assert client.post(_path(f"/{session_id}/start"), headers={"Idempotency-Key": "lease-start"}, json={}).status_code == 200
    assert client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "lease-turn"},
        json={"user_message": "Resposta para testar lease."},
    ).status_code == 200
    assert client.post(_path(f"/{session_id}/finish"), headers={"Idempotency-Key": "lease-finish"}, json={}).status_code == 200

    pending = client.get(f"/jobs?session_id={session_id}").json()
    assert len(pending) == 1
    job_id = pending[0]["job_id"]

    from app import repo
    from app.db import session_scope
    from app.worker import build_worker_service

    with session_scope() as db:
        first_claim = repo.claim_due_jobs(db, worker_id="worker-a", lease_seconds=60, limit=5)
        assert [job.job_id for job in first_claim] == [job_id]
        assert first_claim[0].status == "running"
        assert first_claim[0].locked_by == "worker-a"
        assert first_claim[0].locked_until is not None
        assert int(first_claim[0].attempts or 0) == 1

    active_metrics = client.get("/jobs/metrics").json()
    assert active_metrics["leased_running"] == 1
    assert active_metrics["expired_leases"] == 0

    duplicate = client.post("/jobs/run-pending?worker_id=worker-b&lease_seconds=60&limit=5").json()
    assert duplicate["total"] == 0
    assert duplicate["succeeded"] == 0

    service = build_worker_service()
    with session_scope() as db:
        try:
            service.run_job(db, job_id, worker_id="worker-b")
        except Exception as exc:
            assert getattr(exc, "status_code", None) == 409
        else:
            raise AssertionError("Worker diferente não deve executar job com lease ativo.")

    with session_scope() as db:
        row = repo.get_job_for_update(db, job_id)
        row.locked_until = datetime.now(timezone.utc) - timedelta(seconds=1)

    expired_metrics = client.get("/jobs/metrics").json()
    assert expired_metrics["expired_leases"] == 1

    with session_scope() as db:
        takeover = repo.claim_due_jobs(db, worker_id="worker-b", lease_seconds=60, limit=5)
        assert [job.job_id for job in takeover] == [job_id]
        assert takeover[0].locked_by == "worker-b"
        assert int(takeover[0].attempts or 0) == 2

    with session_scope() as db:
        completed = service.run_job(db, job_id, worker_id="worker-b")["job"]
        assert completed["status"] == "succeeded"
        assert completed["locked_by"] is None
        assert completed["locked_until"] is None


def test_generated_job_batch_endpoints_run_pending_jobs(tmp_path):
    client = _client(tmp_path)

    for index in range(2):
        create_resp = client.post(
            _path(),
            headers={"Idempotency-Key": f"batch-create-{index}"},
            json={"max_turns": 2},
        )
        session_id = create_resp.json()["session"]["session_id"]
        assert client.post(
            _path(f"/{session_id}/start"),
            headers={"Idempotency-Key": f"batch-start-{index}"},
            json={},
        ).status_code == 200
        assert client.post(
            _path(f"/{session_id}/turn"),
            headers={"Idempotency-Key": f"batch-turn-{index}"},
            json={"user_message": f"Resposta para batch {index}."},
        ).status_code == 200
        assert client.post(
            _path(f"/{session_id}/finish"),
            headers={"Idempotency-Key": f"batch-finish-{index}"},
            json={},
        ).status_code == 200

    pending_jobs = client.get("/jobs?status=pending").json()
    assert len(pending_jobs) == 2

    batch = client.post("/jobs/run-pending?limit=10").json()
    assert batch["total"] == 2
    assert batch["succeeded"] == 2
    assert batch["failed"] == 0
    assert len(batch["jobs"]) == 2
    assert {job["status"] for job in batch["jobs"]} == {"succeeded"}
    metrics = client.get("/jobs/metrics").json()
    assert metrics["by_status"]["succeeded"] == 2
    assert metrics["succeeded"] == 2
    assert metrics["terminal"] == 2
    assert metrics["success_rate"] == 1
    assert metrics["finished_in_window"] == 2
    assert metrics["throughput_per_hour"] >= 2
    assert metrics["finished_last_hour"] == 2


def test_generated_worker_retries_and_exposes_manual_retry(tmp_path):
    client = _client(tmp_path)

    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "worker-retry-create"},
        json={"max_turns": 2},
    )
    session_id = create_resp.json()["session"]["session_id"]
    assert client.post(
        _path(f"/{session_id}/start"),
        headers={"Idempotency-Key": "worker-retry-start"},
        json={},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "worker-retry-turn"},
        json={"user_message": "Resposta para gerar job com retry."},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/finish"),
        headers={"Idempotency-Key": "worker-retry-finish"},
        json={},
    ).status_code == 200
    job_id = client.get(f"/jobs?session_id={session_id}").json()[0]["job_id"]

    class FailingService:
        def run_job(self, db, job_id):
            raise RuntimeError("boom")

    from app.worker import process_pending_jobs

    first = process_pending_jobs(FailingService(), limit=5, retry_delay_seconds=0)
    assert first == {"processed": 0, "failed": 0, "retried": 1, "pending_seen": 1}
    job = client.get(f"/jobs/{job_id}").json()
    assert job["status"] == "pending"
    assert job["attempts"] == 1
    assert job["last_error"]["error"] == "boom"
    assert job["next_run_at"] is not None

    second = process_pending_jobs(FailingService(), limit=5, retry_delay_seconds=0)
    assert second == {"processed": 0, "failed": 0, "retried": 1, "pending_seen": 1}
    third = process_pending_jobs(FailingService(), limit=5, retry_delay_seconds=0)
    assert third == {"processed": 0, "failed": 1, "retried": 0, "pending_seen": 1}
    failed_job = client.get(f"/jobs/{job_id}").json()
    assert failed_job["status"] == "failed"
    assert failed_job["attempts"] == 3
    failed_metrics = client.get("/jobs/metrics").json()
    assert failed_metrics["failed"] == 1
    assert failed_metrics["exhausted"] == 1
    assert failed_metrics["attempts_total"] == 3
    assert failed_metrics["terminal"] == 1
    assert failed_metrics["success_rate"] == 0
    assert failed_metrics["duration_ms_avg"] is not None

    batch_retry = client.post(f"/jobs/retry-failed?session_id={session_id}").json()
    assert batch_retry["total"] == 1
    assert batch_retry["succeeded"] == 1
    assert batch_retry["failed"] == 0
    assert batch_retry["jobs"][0]["status"] == "pending"

    retry = client.post(f"/jobs/{job_id}/retry").json()["job"]
    assert retry["status"] == "pending"
    assert retry["attempts"] == 0
    assert retry["last_error"] == {}
    retry_metrics = client.get("/jobs/metrics").json()
    assert retry_metrics["by_status"]["pending"] == 1
    assert retry_metrics["pending_due"] == 1
    assert retry_metrics["oldest_pending_at"] is not None
    assert retry_metrics["next_due_at"] is not None
    retry_events = client.get(_path(f"/{session_id}/events")).json()
    assert "post_finish_retry_scheduled" in [item["event_type"] for item in retry_events]
    assert "post_finish_failed" in [item["event_type"] for item in retry_events]
    assert "post_finish_retry_requested" in [item["event_type"] for item in retry_events]


def test_generated_job_schedule_endpoint_delays_due_work(tmp_path):
    client = _client(tmp_path)

    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "schedule-create"},
        json={"max_turns": 2},
    )
    session_id = create_resp.json()["session"]["session_id"]
    assert client.post(
        _path(f"/{session_id}/start"),
        headers={"Idempotency-Key": "schedule-start"},
        json={},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "schedule-turn"},
        json={"user_message": "Resposta para agendar job."},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/finish"),
        headers={"Idempotency-Key": "schedule-finish"},
        json={},
    ).status_code == 200
    job_id = client.get(f"/jobs?session_id={session_id}").json()[0]["job_id"]

    scheduled = client.post(f"/jobs/{job_id}/schedule", json={"delay_seconds": 3600}).json()["job"]
    assert scheduled["status"] == "pending"
    assert scheduled["next_run_at"] is not None
    metrics = client.get("/jobs/metrics").json()
    assert metrics["pending_due"] == 0
    assert metrics["next_due_at"] == scheduled["next_run_at"]

    from app.worker import build_worker_service, process_pending_jobs

    future_result = process_pending_jobs(build_worker_service(), limit=5, bootstrap_flow_triggers=False)
    assert future_result == {"processed": 0, "failed": 0, "retried": 0, "pending_seen": 0}
    assert client.get(f"/jobs/{job_id}").json()["status"] == "pending"

    due = client.post(f"/jobs/{job_id}/schedule", json={"delay_seconds": 0}).json()["job"]
    assert due["status"] == "pending"
    due_metrics = client.get("/jobs/metrics").json()
    assert due_metrics["pending_due"] == 1

    due_result = process_pending_jobs(build_worker_service(), limit=5, bootstrap_flow_triggers=False)
    assert due_result == {"processed": 1, "failed": 0, "retried": 0, "pending_seen": 1}
    assert client.get(f"/jobs/{job_id}").json()["status"] == "succeeded"
    events = client.get(_path(f"/{session_id}/events")).json()
    assert "post_finish_scheduled" in [item["event_type"] for item in events]


def test_generated_recurring_job_schedule_enqueues_due_work(tmp_path):
    client = _client(tmp_path)

    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "recurrence-create"},
        json={"max_turns": 2},
    )
    session_id = create_resp.json()["session"]["session_id"]
    assert client.post(
        _path(f"/{session_id}/start"),
        headers={"Idempotency-Key": "recurrence-start"},
        json={},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "recurrence-turn"},
        json={"user_message": "Resposta para job recorrente."},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/finish"),
        headers={"Idempotency-Key": "recurrence-finish"},
        json={},
    ).status_code == 200
    source_job_id = client.get(f"/jobs?session_id={session_id}").json()[0]["job_id"]
    assert client.post(f"/jobs/{source_job_id}/run").json()["job"]["status"] == "succeeded"

    created = client.post(
        f"/jobs/{source_job_id}/recurrence",
        json={"interval_seconds": 3600, "delay_seconds": 0},
    ).json()["schedule"]
    schedule_id = created["schedule_id"]
    assert created["status"] == "enabled"
    assert created["payload"]["recurrence"]["source_job_id"] == source_job_id
    assert created["next_run_at"] is not None
    schedules = client.get(f"/job-schedules?session_id={session_id}").json()
    assert [item["schedule_id"] for item in schedules] == [schedule_id]

    from app.worker import build_worker_service, process_pending_jobs

    worker_result = process_pending_jobs(build_worker_service(), limit=5, bootstrap_flow_triggers=False)
    assert worker_result == {"processed": 1, "failed": 0, "retried": 0, "pending_seen": 1}
    refreshed = client.get(f"/job-schedules?session_id={session_id}").json()[0]
    assert refreshed["last_job_id"] is not None
    assert refreshed["last_job_id"] != source_job_id
    assert refreshed["next_run_at"] != created["next_run_at"]
    generated_job = client.get(f"/jobs/{refreshed['last_job_id']}").json()
    assert generated_job["status"] == "succeeded"
    assert generated_job["payload"]["schedule_id"] == schedule_id
    assert generated_job["payload"]["source"] == "job_schedule"

    second = client.post(
        f"/jobs/{source_job_id}/recurrence",
        json={"interval_seconds": 3600, "delay_seconds": 0},
    ).json()["schedule"]
    batch = client.post("/job-schedules/run-due?limit=5").json()
    assert batch["total"] == 1
    assert batch["enqueued"] == 1
    assert batch["schedules"][0]["schedule_id"] == second["schedule_id"]
    assert batch["jobs"][0]["payload"]["schedule_id"] == second["schedule_id"]

    disabled = client.post(f"/job-schedules/{second['schedule_id']}/disable").json()["schedule"]
    assert disabled["status"] == "disabled"
    disabled_list = client.get("/job-schedules?status=disabled").json()
    assert second["schedule_id"] in [item["schedule_id"] for item in disabled_list]
    events = client.get(_path(f"/{session_id}/events")).json()
    event_types = [item["event_type"] for item in events]
    assert "job_schedule_created" in event_types
    assert "job_schedule_enqueued" in event_types
    assert "job_schedule_disabled" in event_types


def test_generated_event_job_schedule_enqueues_only_when_event_is_triggered(tmp_path):
    client = _client(tmp_path)

    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "event-create"},
        json={"max_turns": 2},
    )
    session_id = create_resp.json()["session"]["session_id"]
    assert client.post(
        _path(f"/{session_id}/start"),
        headers={"Idempotency-Key": "event-start"},
        json={},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "event-turn"},
        json={"user_message": "Resposta para evento."},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/finish"),
        headers={"Idempotency-Key": "event-finish"},
        json={},
    ).status_code == 200
    source_job_id = client.get(f"/jobs?session_id={session_id}").json()[0]["job_id"]
    assert client.post(f"/jobs/{source_job_id}/run").json()["job"]["status"] == "succeeded"

    invalid = client.post(
        f"/jobs/{source_job_id}/recurrence",
        json={"trigger_type": "event", "event_type": "post finish"},
    )
    assert invalid.status_code == 400

    created = client.post(
        f"/jobs/{source_job_id}/recurrence",
        json={"trigger_type": "event", "event_type": "session.finished"},
    ).json()["schedule"]
    assert created["trigger_type"] == "event"
    assert created["cron_expression"] == "session.finished"
    assert created["event_type"] == "session.finished"
    assert created["next_run_at"] is None
    assert created["payload"]["recurrence"]["event_type"] == "session.finished"

    due_batch = client.post("/job-schedules/run-due?limit=5").json()
    assert due_batch["total"] == 0
    assert due_batch["enqueued"] == 0

    wrong_event = client.post(
        "/job-schedules/trigger-event",
        json={"event_type": "session.started", "session_id": session_id},
    ).json()
    assert wrong_event["total"] == 0
    assert wrong_event["enqueued"] == 0

    batch = client.post(
        "/job-schedules/trigger-event",
        json={
            "event_type": "session.finished",
            "session_id": session_id,
            "payload": {"reason": "manual", "api_key": "should-not-persist"},
        },
    ).json()
    assert batch["total"] == 1
    assert batch["enqueued"] == 1
    assert batch["schedules"][0]["schedule_id"] == created["schedule_id"]
    assert batch["schedules"][0]["event_type"] == "session.finished"
    assert batch["schedules"][0]["next_run_at"] is None
    event_job = batch["jobs"][0]
    assert event_job["payload"]["source"] == "job_event"
    assert event_job["payload"]["schedule_trigger_type"] == "event"
    assert event_job["payload"]["schedule_event_type"] == "session.finished"
    assert event_job["payload"]["event_payload"] == {"reason": "manual", "api_key": "[redacted]"}

    from app.worker import build_worker_service, process_pending_jobs

    worker_result = process_pending_jobs(build_worker_service(), limit=5, bootstrap_flow_triggers=False)
    assert worker_result == {"processed": 1, "failed": 0, "retried": 0, "pending_seen": 1}
    assert client.get(f"/jobs/{event_job['job_id']}").json()["status"] == "succeeded"
    events = client.get(_path(f"/{session_id}/events")).json()
    event_types = [item["event_type"] for item in events]
    assert "job_schedule_event_triggered" in event_types
    event_payloads = [item["payload"] for item in events if item["event_type"] == "job_schedule_event_triggered"]
    assert event_payloads[-1]["payload_keys"] == ["api_key", "reason"]


def test_generated_cron_job_schedule_uses_cron_expression(tmp_path):
    client = _client(tmp_path)

    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "cron-create"},
        json={"max_turns": 2},
    )
    session_id = create_resp.json()["session"]["session_id"]
    assert client.post(
        _path(f"/{session_id}/start"),
        headers={"Idempotency-Key": "cron-start"},
        json={},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "cron-turn"},
        json={"user_message": "Resposta para cron."},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/finish"),
        headers={"Idempotency-Key": "cron-finish"},
        json={},
    ).status_code == 200
    source_job_id = client.get(f"/jobs?session_id={session_id}").json()[0]["job_id"]
    assert client.post(f"/jobs/{source_job_id}/run").json()["job"]["status"] == "succeeded"

    invalid = client.post(
        f"/jobs/{source_job_id}/recurrence",
        json={"trigger_type": "cron", "cron_expression": "invalid"},
    )
    assert invalid.status_code == 400

    created = client.post(
        f"/jobs/{source_job_id}/recurrence",
        json={
            "trigger_type": "cron",
            "cron_expression": "0 9 * * *",
            "run_at": "2026-01-01T00:00:00+00:00",
        },
    ).json()["schedule"]
    assert created["trigger_type"] == "cron"
    assert created["cron_expression"] == "0 9 * * *"
    assert created["payload"]["recurrence"]["cron_expression"] == "0 9 * * *"

    from app.worker import build_worker_service, process_pending_jobs

    worker_result = process_pending_jobs(build_worker_service(), limit=5, bootstrap_flow_triggers=False)
    assert worker_result == {"processed": 1, "failed": 0, "retried": 0, "pending_seen": 1}
    refreshed = client.get(f"/job-schedules?session_id={session_id}").json()[0]
    assert refreshed["trigger_type"] == "cron"
    assert refreshed["cron_expression"] == "0 9 * * *"
    assert refreshed["last_job_id"] is not None
    assert refreshed["next_run_at"] != created["next_run_at"]
    generated_job = client.get(f"/jobs/{refreshed['last_job_id']}").json()
    assert generated_job["payload"]["schedule_trigger_type"] == "cron"
    assert generated_job["payload"]["schedule_cron_expression"] == "0 9 * * *"
    events = client.get(_path(f"/{session_id}/events")).json()
    assert "job_schedule_enqueued" in [item["event_type"] for item in events]


def test_generated_compose_includes_worker_service():
    compose = (Path(__file__).resolve().parents[1] / "docker-compose.yml").read_text(encoding="utf-8")
    assert "  worker:" in compose
    assert 'command: ["python", "-m", "app.worker"]' in compose
    assert "WORKER_INTERVAL_SECONDS:" in compose
    assert "WORKER_LIMIT:" in compose
    assert "WORKER_RETRY_DELAY_SECONDS:" in compose
    assert "WORKER_LEASE_SECONDS:" in compose
    assert "WORKER_CLEANUP_ENABLED:" in compose
    assert "WORKER_CLEANUP_OLDER_THAN_HOURS:" in compose
    assert "WORKER_CLEANUP_LIMIT:" in compose
    assert "WORKER_CLEANUP_STATUSES:" in compose


def test_generated_runtime_idempotency_conflict(tmp_path):
    client = _client(tmp_path)

    first = client.post(
        _path(),
        headers={"Idempotency-Key": "create-conflict"},
        json={"metadata": {"source": "one"}, "max_turns": 2},
    )
    assert first.status_code == 200

    second = client.post(
        _path(),
        headers={"Idempotency-Key": "create-conflict"},
        json={"metadata": {"source": "two"}, "max_turns": 2},
    )
    assert second.status_code == 409


def test_generated_runtime_input_safety_blocks_before_llm(tmp_path):
    client = _client(tmp_path)

    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "safe-create"},
        json={"max_turns": 3},
    )
    session_id = create_resp.json()["session"]["session_id"]
    assert client.post(
        _path(f"/{session_id}/start"),
        headers={"Idempotency-Key": "safe-start"},
        json={},
    ).status_code == 200

    risk_resp = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "safe-risk"},
        json={"user_message": "Eu vou me matar hoje."},
    )
    assert risk_resp.status_code == 200
    data = risk_resp.json()
    assert data["safety"]["blocked"] is True
    assert data["safety"]["category"] == "self_harm"
    assert data["session"]["status"] == "completed"

    events = client.get(_path(f"/{session_id}/events")).json()
    assert "llm_called" not in [item["event_type"] for item in events]


def test_generated_external_safety_provider_blocks_when_local_allows(tmp_path, monkeypatch):
    calls = []

    class ProviderResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self, limit=-1):
            return json.dumps({
                "blocked": True,
                "decision": "safe_redirect",
                "category": "external_policy",
                "reason": "Provider externo bloqueou.",
                "safeResponse": "Resposta segura do provider.",
                "severity": "critical",
                "score": 0.98,
            }).encode("utf-8")

    def fake_urlopen(request, timeout):
        calls.append({
            "url": request.full_url,
            "timeout": timeout,
            "body": json.loads(request.data.decode("utf-8")),
        })
        return ProviderResponse()

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    client = _client(tmp_path, {
        "SAFETY_PROVIDER_ENABLED": "true",
        "SAFETY_PROVIDER_URL": "http://safety.local/evaluate",
        "SAFETY_PROVIDER_TIMEOUT_SECONDS": "1",
    })

    create_resp = client.post(_path(), headers={"Idempotency-Key": "external-safe-create"}, json={"max_turns": 2})
    session_id = create_resp.json()["session"]["session_id"]
    assert client.post(_path(f"/{session_id}/start"), headers={"Idempotency-Key": "external-safe-start"}, json={}).status_code == 200

    turn_resp = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "external-safe-turn"},
        json={"user_message": "Mensagem comum sem regra local."},
    )
    assert turn_resp.status_code == 200
    data = turn_resp.json()
    assert data["assistant_message"] == {"code": "SEG", "text": "Resposta segura do provider."}
    assert data["safety"]["blocked"] is True
    assert data["safety"]["category"] == "external_policy"
    assert data["safety"]["source"] == "external"
    assert data["safety"]["provider_score"] == 0.98
    assert calls[0]["url"] == "http://safety.local/evaluate"
    assert calls[0]["body"]["stage"] == "input"
    assert calls[0]["body"]["nodeId"] == "input_safety_check"

    events = client.get(_path(f"/{session_id}/events")).json()
    assert "llm_called" not in [item["event_type"] for item in events]
