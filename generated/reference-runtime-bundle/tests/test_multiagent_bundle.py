import json
import os
import sys
from pathlib import Path

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, text


AGENTS = json.loads("[\n  {\n    \"id\": \"reference-interview\",\n    \"route_prefix\": \"/reference-interview\",\n    \"resource_name\": \"sessions\"\n  }\n]")
ORCHESTRATION = json.loads("{\n  \"mode\": \"sequential\",\n  \"entry_agent_id\": \"reference-interview\",\n  \"handoffs\": [],\n  \"memoryPolicy\": {\n    \"enabled\": true,\n    \"persistence\": \"optional_jsonl\",\n    \"defaultPersist\": false,\n    \"defaultMemoryPath\": \"\",\n    \"maxEntries\": 64,\n    \"retentionRuns\": 50,\n    \"maxPreviewChars\": 500,\n    \"redactKeys\": [\n      \"api_key\",\n      \"authorization\",\n      \"password\",\n      \"secret\",\n      \"token\"\n    ],\n    \"includeStepOutputs\": true,\n    \"includeHandoffDecisions\": true\n  }\n}")
PROJECT_ROOT = Path(__file__).resolve().parents[1]


def set_test_env(db_path: str) -> None:
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    os.environ["REDIS_ENABLED"] = "false"
    os.environ["USE_POSTGRES_CHECKPOINTER"] = "false"
    os.environ["MOCK_LLM"] = "true"
    os.environ["AUTH_ENABLED"] = "false"
    os.environ["AGENT_API_KEYS"] = ""
    os.environ["AGENT_API_KEYS_PATH"] = ""
    os.environ["AGENT_API_REVOKED_KEY_IDS"] = ""
    os.environ["AGENT_API_REVOKED_KEY_IDS_PATH"] = ""
    os.environ["AUTH_RATE_LIMIT_ENABLED"] = "false"
    os.environ["AUTH_RATE_LIMIT_REQUESTS"] = "60"
    os.environ["AUTH_RATE_LIMIT_WINDOW_SECONDS"] = "60"
    os.environ["AUTH_AUDIT_ENABLED"] = "true"
    os.environ["AUTH_AUDIT_MAX_ENTRIES"] = "200"
    os.environ["AUTH_AUDIT_PATH"] = ""
    os.environ["SAFETY_PROVIDER_ENABLED"] = "false"
    os.environ["SAFETY_PROVIDER_URL"] = ""
    os.environ["SAFETY_PROVIDER_TIMEOUT_SECONDS"] = "3"
    os.environ["SAFETY_PROVIDER_FAIL_CLOSED"] = "false"
    os.environ["SAFETY_PROVIDER_HEADERS_JSON"] = ""
    os.environ["AUTO_CREATE_TABLES"] = "true"


def _client(tmp_path):
    set_test_env(str(tmp_path / "multiagent.db"))
    create_app = _load_root_create_app()

    return TestClient(create_app())


def _client_with_database(database_url: str):
    os.environ["DATABASE_URL"] = database_url
    os.environ["REDIS_ENABLED"] = "false"
    os.environ["USE_POSTGRES_CHECKPOINTER"] = "false"
    os.environ["MOCK_LLM"] = "true"
    os.environ["AUTH_ENABLED"] = "false"
    os.environ["AGENT_API_KEYS"] = ""
    os.environ["AGENT_API_KEYS_PATH"] = ""
    os.environ["AGENT_API_REVOKED_KEY_IDS"] = ""
    os.environ["AGENT_API_REVOKED_KEY_IDS_PATH"] = ""
    os.environ["AUTH_RATE_LIMIT_ENABLED"] = "false"
    os.environ["AUTH_RATE_LIMIT_REQUESTS"] = "60"
    os.environ["AUTH_RATE_LIMIT_WINDOW_SECONDS"] = "60"
    os.environ["AUTH_AUDIT_ENABLED"] = "true"
    os.environ["AUTH_AUDIT_MAX_ENTRIES"] = "200"
    os.environ["AUTH_AUDIT_PATH"] = ""
    os.environ["SAFETY_PROVIDER_ENABLED"] = "false"
    os.environ["SAFETY_PROVIDER_URL"] = ""
    os.environ["SAFETY_PROVIDER_TIMEOUT_SECONDS"] = "3"
    os.environ["SAFETY_PROVIDER_FAIL_CLOSED"] = "false"
    os.environ["SAFETY_PROVIDER_HEADERS_JSON"] = ""
    os.environ["AUTO_CREATE_TABLES"] = "true"
    create_app = _load_root_create_app()

    return TestClient(create_app())


def _load_root_create_app():
    for name in [name for name in sys.modules if name == "app" or name.startswith("app.")]:
        sys.modules.pop(name, None)
    agents_root_text = str((PROJECT_ROOT / "agents").resolve())
    sys.path[:] = [
        item for item in sys.path
        if not str(Path(item).resolve()).startswith(agents_root_text)
    ]
    project_root_text = str(PROJECT_ROOT)
    if project_root_text in sys.path:
        sys.path.remove(project_root_text)
    sys.path.insert(0, project_root_text)
    from app.main import create_app

    return create_app


def _base(agent: dict) -> str:
    return f"{agent['route_prefix']}/{agent['resource_name']}"


def _load_root_worker():
    for name in [name for name in sys.modules if name == "app" or name.startswith("app.")]:
        sys.modules.pop(name, None)
    agents_root_text = str((PROJECT_ROOT / "agents").resolve())
    sys.path[:] = [
        item for item in sys.path
        if not str(Path(item).resolve()).startswith(agents_root_text)
    ]
    project_root_text = str(PROJECT_ROOT)
    if project_root_text in sys.path:
        sys.path.remove(project_root_text)
    sys.path.insert(0, project_root_text)
    from app.worker import AGENTS as worker_agents, process_bundle_jobs

    return worker_agents, process_bundle_jobs


def test_multiagent_bundle_worker_artifact_and_idle_cycle(tmp_path):
    set_test_env(str(tmp_path / "multiagent-worker.db"))
    compose = (PROJECT_ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    assert "\n  worker:\n" in compose
    assert 'command: ["python", "-m", "app.worker"]' in compose
    assert "required: false" in compose
    worker_source = (PROJECT_ROOT / "app" / "worker.py").read_text(encoding="utf-8")
    assert "def process_bundle_jobs" in worker_source
    assert "build_worker_service" in worker_source

    worker_agents, process_bundle_jobs = _load_root_worker()
    assert [agent["id"] for agent in worker_agents] == [agent["id"] for agent in AGENTS]

    class Args:
        limit = 5
        retry_delay = 0
        worker_id = "pytest-bundle-worker"
        lease_seconds = 30
        cleanup_enabled = False
        cleanup_older_than_hours = 168
        cleanup_limit = 10
        cleanup_statuses = "succeeded,failed"

    result = process_bundle_jobs(Args())
    assert result["processed"] == 0
    assert result["failed"] == 0
    assert result["retried"] == 0
    assert result["pending_seen"] == 0
    assert [agent["agent_id"] for agent in result["agents"]] == [agent["id"] for agent in AGENTS]


def test_multiagent_bundle_metadata_and_mounted_routes(tmp_path):
    client = _client(tmp_path)

    metadata = client.get("/metadata")
    assert metadata.status_code == 200
    data = metadata.json()
    assert data["supports_multi_agent_bundle"] is True
    assert data["packaging"] == "multiagent"
    assert [agent["id"] for agent in data["agents"]] == [agent["id"] for agent in AGENTS]
    assert data["shared_storage"]["database"]["scope"] == "bundle"
    assert data["shared_storage"]["database"]["mode"] == "single-database"
    assert data["shared_storage"]["database"]["tablesAreNamespacedBy"] == "agent_id"
    assert data["orchestration"]["format"] == "agent-flow-builder.runtime-orchestration.v1"
    assert data["orchestration"]["governance"]["declarativeOnly"] is True
    assert data["orchestration"]["capabilities"]["persistentMemoryPolicy"] is True
    assert data["orchestration"]["memoryPolicy"]["maxEntries"] == ORCHESTRATION["memoryPolicy"]["maxEntries"]
    assert data["orchestration"]["memoryPolicy"]["retentionRuns"] == ORCHESTRATION["memoryPolicy"]["retentionRuns"]
    assert data["agent_isolation"]["format"] == "agent-flow-builder.runtime-agent-isolation.v1"
    assert data["agent_isolation"]["routeIsolation"]["uniqueRoutePrefixes"] is True
    assert data["agent_isolation"]["runtimeImportIsolation"]["mode"] == "isolated-python-app-namespace"
    assert data["agent_isolation"]["requestIsolation"]["idempotencyNamespace"] == "route_prefix"
    assert data["agent_isolation"]["requestIsolation"]["sessionNamespace"] == "agent_id"
    assert data["agent_isolation"]["authIsolation"]["scopeNamespace"] == "agents:<agent_id>"
    assert data["agent_isolation"]["governance"]["excludesSecrets"] is True
    assert [agent["routePrefix"] for agent in data["agent_isolation"]["agents"]] == [agent["route_prefix"] for agent in AGENTS]

    isolation_path = PROJECT_ROOT / ".runtime-manifest" / "agent-isolation.json"
    isolation = json.loads(isolation_path.read_text(encoding="utf-8"))
    assert isolation["format"] == "agent-flow-builder.runtime-agent-isolation.v1"
    assert isolation["requestIsolation"]["eventNamespace"] == "agent_id"
    assert "OPENAI_API_KEY" not in json.dumps(isolation)

    health = client.get("/health")
    assert health.status_code == 200
    assert all(agent["mounted"] for agent in health.json()["agents"])
    assert health.json()["shared_storage"]["database_env"] == "DATABASE_URL"
    assert health.json()["agent_isolation"]["route_prefix_unique"] is True
    assert health.json()["agent_isolation"]["idempotency_namespace"] == "route_prefix"
    assert health.json()["agent_isolation"]["storage_namespace"] == "agent_id"

    for agent in AGENTS:
        child_metadata = client.get(f"{agent['route_prefix']}/metadata")
        assert child_metadata.status_code == 200
        assert child_metadata.json()["flow_id"] == agent["id"]
        assert child_metadata.json()["agent_id"] == agent["id"]


def test_multiagent_orchestration_run_executes_entry_and_handoffs(tmp_path):
    client = _client(tmp_path)
    memory_path = tmp_path / "orchestration-memory.jsonl"
    response = client.post(
        "/orchestration/run",
        json={
            "user_message": "Mensagem para execução orquestrada.",
            "metadata": {"source": "pytest-orchestration", "authorization": "Bearer orchestration-secret"},
            "max_turns": 2,
            "memory_path": str(memory_path),
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["format"] == "agent-flow-builder.runtime-orchestration-run.v1"
    assert data["status"] == "completed"
    expected_steps = 1 + len([
        handoff
        for handoff in ORCHESTRATION["handoffs"]
        if handoff["fromAgentId"] == data["entry_agent_id"]
    ])
    assert len(data["steps"]) == expected_steps
    assert data["steps"][0]["agent_id"] == data["entry_agent_id"]
    assert data["steps"][0]["session_id"]
    assert data["steps"][0]["turn"]["session"]["agent_id"] == data["steps"][0]["agent_id"]
    assert data["shared_memory"]["format"] == "agent-flow-builder.runtime-orchestration-memory.v1"
    assert data["shared_memory"]["policy"]["max_entries"] == ORCHESTRATION["memoryPolicy"]["maxEntries"]
    assert data["debug_trace"]["governance"]["memoryPolicy"]["retention_runs"] == ORCHESTRATION["memoryPolicy"]["retentionRuns"]
    assert len(data["shared_memory"]["entries"]) == len(data["steps"])
    assert data["shared_memory"]["entries"][0]["output_preview"]
    assert data["debug_trace"]["format"] == "agent-flow-builder.runtime-orchestration-debug-trace.v1"
    assert data["debug_trace"]["run_id"] == data["shared_memory"]["run_id"]
    assert data["debug_trace"]["summary"]["status"] == "completed"
    assert data["debug_trace"]["summary"]["step_count"] == len(data["steps"])
    trace_event_types = [event["type"] for event in data["debug_trace"]["timeline"]]
    assert "plan_created" in trace_event_types
    assert "step_started" in trace_event_types
    assert "step_completed" in trace_event_types
    assert "OPENAI_API_KEY" not in json.dumps(data["debug_trace"])
    if ORCHESTRATION["handoffs"]:
        assert any(decision["matched"] for decision in data["shared_memory"]["decisions"])
        assert "match" in data["shared_memory"]["decisions"][0]["reason"]
        assert "handoff_decision" in trace_event_types
    assert data["governance"]["executedInProcess"] is True
    assert data["governance"]["excludesSecrets"] is True
    assert data["governance"]["sharedMemoryPreviewOnly"] is True
    assert data["governance"]["debugTracePreviewOnly"] is True
    assert data["shared_memory"]["persistence"]["enabled"] is True
    assert data["shared_memory"]["persistence"]["storage"] == "jsonl"
    assert "orchestration-secret" not in json.dumps(data)
    persisted = [json.loads(line) for line in memory_path.read_text(encoding="utf-8").splitlines()]
    assert persisted[-1]["format"] == "agent-flow-builder.runtime-orchestration-memory-record.v1"
    assert persisted[-1]["shared_memory"]["entries"][0]["output_preview"]
    assert persisted[-1]["debug_trace"]["format"] == "agent-flow-builder.runtime-orchestration-debug-trace.v1"
    assert persisted[-1]["debug_trace"]["summary"]["step_count"] == len(data["steps"])
    assert "orchestration-secret" not in json.dumps(persisted[-1])

    policy = ORCHESTRATION["memoryPolicy"]
    if policy["defaultPersist"] or policy["persistence"] == "always_jsonl":
        default_path_value = policy["defaultMemoryPath"] or ".runtime-manifest/orchestration-memory.jsonl"
        default_memory_path = PROJECT_ROOT / default_path_value
        if default_memory_path.exists():
            default_memory_path.unlink()
        default_response = client.post(
            "/orchestration/run",
            json={
                "user_message": "Execução com persistência default.",
                "metadata": {"source": "pytest-orchestration-default"},
                "max_turns": 2,
            },
        )
        assert default_response.status_code == 200
        default_data = default_response.json()
        assert default_data["shared_memory"]["policy"]["persistence_active"] is True
        assert default_data["shared_memory"]["persistence"]["enabled"] is True
        assert default_memory_path.exists()


def test_multiagent_idempotency_is_namespaced_by_route_prefix(tmp_path):
    if len(AGENTS) < 2:
        pytest.skip("A validação de namespace de idempotência exige ao menos dois agentes.")

    client = _client(tmp_path)
    first, second = AGENTS[0], AGENTS[1]

    first_create = client.post(
        _base(first),
        headers={"Idempotency-Key": "shared-create"},
        json={"metadata": {"agent": first["id"]}, "max_turns": 2},
    )
    assert first_create.status_code == 200
    first_session_id = first_create.json()["session"]["session_id"]
    assert first_create.json()["session"]["agent_id"] == first["id"]

    first_duplicate = client.post(
        _base(first),
        headers={"Idempotency-Key": "shared-create"},
        json={"metadata": {"agent": first["id"]}, "max_turns": 2},
    )
    assert first_duplicate.status_code == 200
    assert first_duplicate.json()["session"]["session_id"] == first_session_id

    second_create = client.post(
        _base(second),
        headers={"Idempotency-Key": "shared-create"},
        json={"metadata": {"agent": second["id"]}, "max_turns": 2},
    )
    assert second_create.status_code == 200
    second_session_id = second_create.json()["session"]["session_id"]
    assert second_create.json()["session"]["agent_id"] == second["id"]
    assert second_session_id != first_session_id

    first_start = client.post(
        f"{_base(first)}/{first_session_id}/start",
        headers={"Idempotency-Key": "shared-start"},
        json={},
    )
    assert first_start.status_code == 200
    first_events = client.get(f"{_base(first)}/{first_session_id}/events")
    assert first_events.status_code == 200
    assert {item["agent_id"] for item in first_events.json()} == {first["id"]}

    second_start = client.post(
        f"{_base(second)}/{second_session_id}/start",
        headers={"Idempotency-Key": "shared-start"},
        json={},
    )
    assert second_start.status_code == 200
    second_events = client.get(f"{_base(second)}/{second_session_id}/events")
    assert second_events.status_code == 200
    assert {item["agent_id"] for item in second_events.json()} == {second["id"]}


@pytest.mark.integration
def test_multiagent_bundle_can_share_real_postgres_database_when_configured():
    if len(AGENTS) < 2:
        pytest.skip("A validação de Postgres compartilhado exige ao menos dois agentes.")
    database_url = os.getenv("AGENT_FLOW_TEST_POSTGRES_URL")
    if not database_url:
        pytest.skip("Defina AGENT_FLOW_TEST_POSTGRES_URL para validar Postgres real compartilhado.")

    client = _client_with_database(database_url)
    engine = create_engine(database_url)
    with engine.begin() as conn:
        for table in [
            "agent_jobs",
            "agent_events",
            "agent_messages",
            "agent_node_records",
            "idempotency_records",
            "agent_sessions",
        ]:
            conn.execute(text(f"DELETE FROM {table}"))

    first, second = AGENTS[0], AGENTS[1]
    first_create = client.post(
        _base(first),
        headers={"Idempotency-Key": "postgres-first-create"},
        json={"metadata": {"agent": first["id"], "storage": "postgres"}, "max_turns": 2},
    )
    assert first_create.status_code == 200
    second_create = client.post(
        _base(second),
        headers={"Idempotency-Key": "postgres-second-create"},
        json={"metadata": {"agent": second["id"], "storage": "postgres"}, "max_turns": 2},
    )
    assert second_create.status_code == 200

    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT agent_id, COUNT(*) AS total FROM agent_sessions GROUP BY agent_id")
        ).mappings().all()
    totals = {row["agent_id"]: row["total"] for row in rows}
    assert totals[first["id"]] == 1
    assert totals[second["id"]] == 1
