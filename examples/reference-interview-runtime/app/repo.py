import uuid
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.models import AgentEvent, AgentMessage, AgentSession, IdempotencyRecord


def new_id() -> str:
    return str(uuid.uuid4())


def check_db_health(session: Session) -> bool:
    try:
        session.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


def create_session(
    session: Session,
    *,
    agent_id: str,
    max_turns: int,
    metadata_json: dict[str, Any] | None,
) -> AgentSession:
    row = AgentSession(
        session_id=new_id(),
        agent_id=agent_id,
        status="created",
        phase="created",
        turn=0,
        max_turns=max_turns,
        metadata_json=metadata_json or {},
    )
    session.add(row)
    session.flush()
    return row


def get_session_by_id(session: Session, session_id: str) -> AgentSession | None:
    return session.get(AgentSession, session_id)


def get_session_for_update(session: Session, session_id: str) -> AgentSession | None:
    return session.execute(
        select(AgentSession).where(AgentSession.session_id == session_id).with_for_update()
    ).scalars().first()


def update_session_state(
    session: Session,
    row: AgentSession,
    *,
    status: str | None = None,
    phase: str | None = None,
    turn: int | None = None,
    completed: bool = False,
) -> AgentSession:
    if status is not None:
        row.status = status
    if phase is not None:
        row.phase = phase
    if turn is not None:
        row.turn = turn
    if completed:
        row.completed_at = func.now()
    session.flush()
    return row


def _next_message_seq(session: Session, session_id: str) -> int:
    value = session.execute(
        select(func.max(AgentMessage.seq)).where(AgentMessage.session_id == session_id)
    ).scalar()
    return int(value or 0) + 1


def append_message(
    session: Session,
    *,
    session_id: str,
    role: str,
    content: str,
    code: str | None = None,
    metadata_json: dict[str, Any] | None = None,
) -> AgentMessage:
    row = AgentMessage(
        message_id=new_id(),
        session_id=session_id,
        seq=_next_message_seq(session, session_id),
        role=role,
        code=code,
        content=content,
        metadata_json=metadata_json or {},
    )
    session.add(row)
    session.flush()
    return row


def get_transcript(session: Session, session_id: str, from_seq: int | None = None) -> list[AgentMessage]:
    stmt = select(AgentMessage).where(AgentMessage.session_id == session_id)
    if from_seq is not None:
        stmt = stmt.where(AgentMessage.seq >= from_seq)
    stmt = stmt.order_by(AgentMessage.seq.asc())
    return list(session.execute(stmt).scalars().all())


def get_recent_messages(session: Session, session_id: str, limit: int) -> list[AgentMessage]:
    stmt = (
        select(AgentMessage)
        .where(AgentMessage.session_id == session_id)
        .order_by(AgentMessage.seq.desc())
        .limit(limit)
    )
    return list(reversed(session.execute(stmt).scalars().all()))


def get_last_assistant_message(session: Session, session_id: str) -> AgentMessage | None:
    stmt = (
        select(AgentMessage)
        .where(AgentMessage.session_id == session_id, AgentMessage.role == "assistant")
        .order_by(AgentMessage.seq.desc())
    )
    return session.execute(stmt).scalars().first()


def _next_event_seq(session: Session, session_id: str) -> int:
    value = session.execute(
        select(func.max(AgentEvent.seq)).where(AgentEvent.session_id == session_id)
    ).scalar()
    return int(value or 0) + 1


def append_event(
    session: Session,
    *,
    session_id: str,
    agent_id: str,
    event_type: str,
    node: str | None = None,
    payload: dict[str, Any] | None = None,
) -> AgentEvent:
    row = AgentEvent(
        event_id=new_id(),
        agent_id=agent_id,
        session_id=session_id,
        seq=_next_event_seq(session, session_id),
        event_type=event_type,
        node=node,
        payload=payload or {},
    )
    session.add(row)
    session.flush()
    return row


def get_events(session: Session, session_id: str, from_seq: int | None = None) -> list[AgentEvent]:
    stmt = select(AgentEvent).where(AgentEvent.session_id == session_id)
    if from_seq is not None:
        stmt = stmt.where(AgentEvent.seq >= from_seq)
    stmt = stmt.order_by(AgentEvent.seq.asc())
    return list(session.execute(stmt).scalars().all())


def get_idempotency_record(
    session: Session,
    *,
    operation: str,
    idempotency_key: str,
) -> IdempotencyRecord | None:
    return session.execute(
        select(IdempotencyRecord).where(
            IdempotencyRecord.operation == operation,
            IdempotencyRecord.idempotency_key == idempotency_key,
        )
    ).scalars().first()


def save_idempotency_record(
    session: Session,
    *,
    operation: str,
    idempotency_key: str,
    request_hash: str,
    status_code: int,
    response_json: dict[str, Any],
) -> IdempotencyRecord:
    row = IdempotencyRecord(
        record_id=new_id(),
        operation=operation,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        status_code=status_code,
        response_json=response_json,
    )
    session.add(row)
    session.flush()
    return row
