from fastapi.testclient import TestClient

from tests.conftest import set_test_env


def _client(tmp_path):
    set_test_env(str(tmp_path / "reference.db"))
    from app.db import engine
    from app.models import Base
    from app.main import create_app

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestClient(create_app())


def test_reference_session_flow_idempotency_transcript_and_events(tmp_path):
    client = _client(tmp_path)

    create_resp = client.post(
        "/sessions",
        headers={"Idempotency-Key": "create-1"},
        json={"metadata": {"source": "pytest"}, "max_turns": 2},
    )
    assert create_resp.status_code == 200
    session_id = create_resp.json()["session"]["session_id"]

    duplicate_create = client.post(
        "/sessions",
        headers={"Idempotency-Key": "create-1"},
        json={"metadata": {"source": "pytest"}, "max_turns": 2},
    )
    assert duplicate_create.status_code == 200
    assert duplicate_create.json()["session"]["session_id"] == session_id

    start_resp = client.post(
        f"/sessions/{session_id}/start",
        headers={"Idempotency-Key": "start-1"},
        json={},
    )
    assert start_resp.status_code == 200
    assert start_resp.json()["session"]["status"] == "active"
    assert start_resp.json()["messages"][0]["code"] == "ABR"

    turn_payload = {"user_message": "Este é um teste do fluxo."}
    turn_resp = client.post(
        f"/sessions/{session_id}/turn",
        headers={"Idempotency-Key": "turn-1"},
        json=turn_payload,
    )
    assert turn_resp.status_code == 200
    turn_data = turn_resp.json()
    assert turn_data["assistant_message"]["code"] == "ECHO"
    assert turn_data["safety"]["decision"] == "allow"
    assert turn_data["session"]["turn"] == 1

    duplicate_turn = client.post(
        f"/sessions/{session_id}/turn",
        headers={"Idempotency-Key": "turn-1"},
        json=turn_payload,
    )
    assert duplicate_turn.status_code == 200
    assert duplicate_turn.json()["assistant_message"] == turn_data["assistant_message"]

    transcript = client.get(f"/sessions/{session_id}/transcript").json()
    assert [item["role"] for item in transcript].count("user") == 1
    assert [item["role"] for item in transcript].count("assistant") == 2

    events = client.get(f"/sessions/{session_id}/events").json()
    event_types = [item["event_type"] for item in events]
    assert "session_created" in event_types
    assert "llm_called" in event_types

    finish_resp = client.post(
        f"/sessions/{session_id}/finish",
        headers={"Idempotency-Key": "finish-1"},
        json={},
    )
    assert finish_resp.status_code == 200
    assert finish_resp.json()["session"]["status"] == "completed"


def test_idempotency_key_conflict_is_rejected(tmp_path):
    client = _client(tmp_path)

    first = client.post(
        "/sessions",
        headers={"Idempotency-Key": "create-conflict"},
        json={"metadata": {"source": "one"}, "max_turns": 2},
    )
    assert first.status_code == 200

    second = client.post(
        "/sessions",
        headers={"Idempotency-Key": "create-conflict"},
        json={"metadata": {"source": "two"}, "max_turns": 2},
    )
    assert second.status_code == 409


def test_input_safety_blocks_without_llm_event(tmp_path):
    client = _client(tmp_path)

    create_resp = client.post(
        "/sessions",
        headers={"Idempotency-Key": "safe-create"},
        json={"max_turns": 3},
    )
    session_id = create_resp.json()["session"]["session_id"]
    assert client.post(
        f"/sessions/{session_id}/start",
        headers={"Idempotency-Key": "safe-start"},
        json={},
    ).status_code == 200

    risk_resp = client.post(
        f"/sessions/{session_id}/turn",
        headers={"Idempotency-Key": "safe-risk"},
        json={"user_message": "Eu vou me matar hoje."},
    )
    assert risk_resp.status_code == 200
    data = risk_resp.json()
    assert data["safety"]["blocked"] is True
    assert data["safety"]["category"] == "self_harm"
    assert data["session"]["status"] == "completed"

    events = client.get(f"/sessions/{session_id}/events").json()
    assert "llm_called" not in [item["event_type"] for item in events]
