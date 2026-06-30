from fastapi.testclient import TestClient

from app.generated_flow import AGENT_ID, API_RESOURCE, FLOW_ID
from tests.conftest import set_test_env


def _path(suffix: str = "") -> str:
    return f"/{API_RESOURCE}{suffix}"


def _client(tmp_path):
    set_test_env(str(tmp_path / "generated.db"))
    from app.db import engine
    from app.main import create_app
    from app.models import Base

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestClient(create_app())


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
    assert start_resp.json()["messages"][0]["code"] == "ABR"

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
    assert "llm_called" in [item["event_type"] for item in events]
    assert {item["agent_id"] for item in events} == {AGENT_ID}


def test_generated_runtime_idempotency_conflict_and_safety(tmp_path):
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
