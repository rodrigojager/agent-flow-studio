import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import and_, func, or_, select, text, update
from sqlalchemy.orm import Session

from app.models import AgentEvent, AgentJob, AgentJobSchedule, AgentMessage, AgentSession, IdempotencyRecord


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


def create_job(
    session: Session,
    *,
    agent_id: str,
    session_id: str,
    kind: str,
    payload_json: dict[str, Any] | None = None,
    max_attempts: int = 3,
) -> AgentJob:
    row = AgentJob(
        job_id=new_id(),
        agent_id=agent_id,
        session_id=session_id,
        kind=kind,
        status="pending",
        attempts=0,
        max_attempts=max(1, int(max_attempts or 1)),
        payload_json=payload_json or {},
        result_json={},
        last_error_json={},
    )
    session.add(row)
    session.flush()
    return row


def get_job_by_id(session: Session, job_id: str) -> AgentJob | None:
    return session.get(AgentJob, job_id)


def get_job_for_update(session: Session, job_id: str) -> AgentJob | None:
    return session.execute(
        select(AgentJob).where(AgentJob.job_id == job_id).with_for_update()
    ).scalars().first()


def list_jobs(
    session: Session,
    *,
    session_id: str | None = None,
    status: str | None = None,
    limit: int = 50,
) -> list[AgentJob]:
    stmt = select(AgentJob)
    if session_id:
        stmt = stmt.where(AgentJob.session_id == session_id)
    if status:
        stmt = stmt.where(AgentJob.status == status)
    stmt = stmt.order_by(AgentJob.created_at.desc()).limit(limit)
    return list(session.execute(stmt).scalars().all())


def list_due_jobs(session: Session, *, session_id: str | None = None, limit: int = 20) -> list[AgentJob]:
    now = datetime.now(timezone.utc)
    stmt = (
        select(AgentJob)
        .where(
            AgentJob.status == "pending",
            or_(AgentJob.next_run_at.is_(None), AgentJob.next_run_at <= now),
        )
    )
    if session_id:
        stmt = stmt.where(AgentJob.session_id == session_id)
    stmt = stmt.order_by(AgentJob.created_at.asc()).limit(limit)
    return list(session.execute(stmt).scalars().all())


def _due_job_claim_filter(now: datetime):
    pending_due = and_(
        AgentJob.status == "pending",
        or_(AgentJob.next_run_at.is_(None), AgentJob.next_run_at <= now),
        or_(AgentJob.locked_until.is_(None), AgentJob.locked_until <= now),
    )
    stale_running = and_(
        AgentJob.status == "running",
        AgentJob.locked_until.is_not(None),
        AgentJob.locked_until <= now,
        AgentJob.attempts < AgentJob.max_attempts,
    )
    return or_(pending_due, stale_running)


def claim_due_jobs(
    session: Session,
    *,
    worker_id: str,
    agent_id: str | None = None,
    session_id: str | None = None,
    limit: int = 20,
    lease_seconds: float = 60.0,
) -> list[AgentJob]:
    now = datetime.now(timezone.utc)
    lease_until = now + timedelta(seconds=max(1.0, float(lease_seconds or 60.0)))
    claim_filter = _due_job_claim_filter(now)
    stmt = (
        select(AgentJob.job_id)
        .where(claim_filter)
        .order_by(AgentJob.created_at.asc())
        .limit(max(1, int(limit or 1)))
        .with_for_update(skip_locked=True)
    )
    if agent_id:
        stmt = stmt.where(AgentJob.agent_id == agent_id)
    if session_id:
        stmt = stmt.where(AgentJob.session_id == session_id)
    candidate_ids = list(session.execute(stmt).scalars().all())
    claimed: list[AgentJob] = []
    for job_id in candidate_ids:
        result = session.execute(
            update(AgentJob)
            .where(AgentJob.job_id == job_id, _due_job_claim_filter(now))
            .values(
                status="running",
                attempts=func.coalesce(AgentJob.attempts, 0) + 1,
                started_at=now,
                next_run_at=None,
                locked_by=worker_id,
                locked_until=lease_until,
                lock_acquired_at=now,
                updated_at=now,
            )
        )
        if result.rowcount:
            row = session.get(AgentJob, job_id)
            if row:
                claimed.append(row)
    session.flush()
    return claimed


def create_job_schedule(
    session: Session,
    *,
    agent_id: str,
    session_id: str,
    kind: str,
    interval_seconds: int,
    trigger_type: str = "interval",
    cron_expression: str | None = None,
    payload_json: dict[str, Any] | None = None,
    max_attempts: int = 3,
    next_run_at: datetime | None = None,
) -> AgentJobSchedule:
    row = AgentJobSchedule(
        schedule_id=new_id(),
        agent_id=agent_id,
        session_id=session_id,
        kind=kind,
        status="enabled",
        trigger_type=trigger_type or "interval",
        interval_seconds=max(60, int(interval_seconds or 60)),
        cron_expression=cron_expression,
        max_attempts=max(1, int(max_attempts or 1)),
        payload_json=payload_json or {},
        last_job_id=None,
        last_run_at=None,
        next_run_at=_as_utc(next_run_at) if (trigger_type or "interval") == "event" else (_as_utc(next_run_at) or datetime.now(timezone.utc)),
    )
    session.add(row)
    session.flush()
    return row


def get_job_schedule_by_id(session: Session, schedule_id: str) -> AgentJobSchedule | None:
    return session.get(AgentJobSchedule, schedule_id)


def get_job_schedule_for_update(session: Session, schedule_id: str) -> AgentJobSchedule | None:
    return session.execute(
        select(AgentJobSchedule).where(AgentJobSchedule.schedule_id == schedule_id).with_for_update()
    ).scalars().first()


def list_job_schedules(
    session: Session,
    *,
    session_id: str | None = None,
    status: str | None = None,
    limit: int = 50,
) -> list[AgentJobSchedule]:
    stmt = select(AgentJobSchedule)
    if session_id:
        stmt = stmt.where(AgentJobSchedule.session_id == session_id)
    if status:
        stmt = stmt.where(AgentJobSchedule.status == status)
    stmt = stmt.order_by(AgentJobSchedule.created_at.desc()).limit(limit)
    return list(session.execute(stmt).scalars().all())


def list_due_job_schedules(session: Session, *, limit: int = 20) -> list[AgentJobSchedule]:
    now = datetime.now(timezone.utc)
    stmt = (
        select(AgentJobSchedule)
        .where(
            AgentJobSchedule.status == "enabled",
            AgentJobSchedule.trigger_type != "event",
            or_(AgentJobSchedule.next_run_at.is_(None), AgentJobSchedule.next_run_at <= now),
        )
        .order_by(AgentJobSchedule.next_run_at.asc(), AgentJobSchedule.created_at.asc())
        .limit(limit)
    )
    return list(session.execute(stmt).scalars().all())


def mark_job_schedule_enqueued(
    session: Session,
    row: AgentJobSchedule,
    job: AgentJob,
    *,
    next_run_at: datetime | None = None,
) -> AgentJobSchedule:
    now = datetime.now(timezone.utc)
    row.last_job_id = job.job_id
    row.last_run_at = now
    if (row.trigger_type or "interval") == "event":
        row.next_run_at = None
    else:
        row.next_run_at = next_run_at or (now + timedelta(seconds=max(60, int(row.interval_seconds or 60))))
    session.flush()
    return row


def list_event_job_schedules(
    session: Session,
    *,
    event_type: str,
    session_id: str | None = None,
    limit: int = 20,
) -> list[AgentJobSchedule]:
    stmt = (
        select(AgentJobSchedule)
        .where(
            AgentJobSchedule.status == "enabled",
            AgentJobSchedule.trigger_type == "event",
            AgentJobSchedule.cron_expression == event_type,
        )
        .order_by(AgentJobSchedule.created_at.asc())
        .limit(limit)
    )
    if session_id:
        stmt = stmt.where(AgentJobSchedule.session_id == session_id)
    return list(session.execute(stmt).scalars().all())


def disable_job_schedule(session: Session, row: AgentJobSchedule) -> AgentJobSchedule:
    row.status = "disabled"
    session.flush()
    return row


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (len(ordered) - 1) * percentile
    lower = int(rank)
    upper = min(lower + 1, len(ordered) - 1)
    weight = rank - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def get_job_metrics(session: Session, window_hours: float = 1.0) -> dict[str, Any]:
    rows = list(session.execute(select(AgentJob)).scalars().all())
    now = datetime.now(timezone.utc)
    normalized_window_hours = max(0.0, float(window_hours or 0.0))
    window_start = None if normalized_window_hours <= 0 else now - timedelta(hours=normalized_window_hours)
    by_status: dict[str, int] = {}
    by_kind: dict[str, int] = {}
    attempts_total = 0
    pending_due = 0
    exhausted = 0
    durations_ms: list[float] = []
    window_durations_ms: list[float] = []
    finished_last_hour = 0
    finished_in_window = 0
    succeeded_in_window = 0
    failed_in_window = 0
    last_finished_at: datetime | None = None
    oldest_pending_at: datetime | None = None
    next_due_at: datetime | None = None
    leased_running = 0
    expired_leases = 0

    for row in rows:
        by_status[row.status] = by_status.get(row.status, 0) + 1
        by_kind[row.kind] = by_kind.get(row.kind, 0) + 1
        attempts = int(row.attempts or 0)
        attempts_total += attempts
        next_run_at = _as_utc(row.next_run_at)
        locked_until = _as_utc(row.locked_until)
        if row.status == "pending":
            created_at = _as_utc(row.created_at)
            if created_at and (oldest_pending_at is None or created_at < oldest_pending_at):
                oldest_pending_at = created_at
            candidate_due_at = next_run_at or created_at or now
            if candidate_due_at and (next_due_at is None or candidate_due_at < next_due_at):
                next_due_at = candidate_due_at
            if next_run_at is None or next_run_at <= now:
                pending_due += 1
        if row.status == "running" and locked_until:
            if locked_until > now:
                leased_running += 1
            else:
                expired_leases += 1
        if row.status == "failed" and attempts >= int(row.max_attempts or 1):
            exhausted += 1
        started_at = _as_utc(row.started_at)
        finished_at = _as_utc(row.finished_at)
        duration_ms = None
        if started_at and finished_at and finished_at >= started_at:
            duration_ms = (finished_at - started_at).total_seconds() * 1000
            durations_ms.append(duration_ms)
        if finished_at:
            if finished_at >= now - timedelta(hours=1):
                finished_last_hour += 1
            if window_start is None or finished_at >= window_start:
                finished_in_window += 1
                if row.status == "succeeded":
                    succeeded_in_window += 1
                if row.status == "failed":
                    failed_in_window += 1
                if duration_ms is not None:
                    window_durations_ms.append(duration_ms)
            if last_finished_at is None or finished_at > last_finished_at:
                last_finished_at = finished_at

    succeeded = by_status.get("succeeded", 0)
    failed = by_status.get("failed", 0)
    terminal = succeeded + failed
    terminal_in_window = succeeded_in_window + failed_in_window

    return {
        "total": len(rows),
        "by_status": by_status,
        "by_kind": by_kind,
        "attempts_total": attempts_total,
        "pending_due": pending_due,
        "failed": failed,
        "exhausted": exhausted,
        "succeeded": succeeded,
        "terminal": terminal,
        "success_rate": (succeeded / terminal) if terminal else None,
        "duration_ms_avg": (sum(durations_ms) / len(durations_ms)) if durations_ms else None,
        "duration_ms_min": min(durations_ms) if durations_ms else None,
        "duration_ms_max": max(durations_ms) if durations_ms else None,
        "duration_ms_p95": _percentile(durations_ms, 0.95),
        "window_hours": normalized_window_hours,
        "finished_in_window": finished_in_window,
        "succeeded_in_window": succeeded_in_window,
        "failed_in_window": failed_in_window,
        "success_rate_in_window": (succeeded_in_window / terminal_in_window) if terminal_in_window else None,
        "window_duration_ms_avg": (sum(window_durations_ms) / len(window_durations_ms)) if window_durations_ms else None,
        "window_duration_ms_p95": _percentile(window_durations_ms, 0.95),
        "throughput_per_hour": (finished_in_window / normalized_window_hours) if normalized_window_hours > 0 else None,
        "oldest_pending_at": oldest_pending_at.isoformat() if oldest_pending_at else None,
        "next_due_at": next_due_at.isoformat() if next_due_at else None,
        "leased_running": leased_running,
        "expired_leases": expired_leases,
        "finished_last_hour": finished_last_hour,
        "last_finished_at": last_finished_at.isoformat() if last_finished_at else None,
    }


def list_job_cleanup_candidates(
    session: Session,
    *,
    statuses: list[str],
    cutoff: datetime,
    session_id: str | None = None,
    limit: int = 100,
) -> list[AgentJob]:
    stmt = (
        select(AgentJob)
        .where(
            AgentJob.status.in_(statuses),
            AgentJob.finished_at.is_not(None),
            AgentJob.finished_at <= _as_utc(cutoff),
        )
        .order_by(AgentJob.finished_at.asc(), AgentJob.created_at.asc())
        .limit(max(1, int(limit or 1)))
    )
    if session_id:
        stmt = stmt.where(AgentJob.session_id == session_id)
    return list(session.execute(stmt).scalars().all())


def delete_jobs(session: Session, rows: list[AgentJob]) -> None:
    for row in rows:
        session.delete(row)
    session.flush()


def mark_job_running(session: Session, row: AgentJob) -> AgentJob:
    row.status = "running"
    row.attempts = int(row.attempts or 0) + 1
    row.started_at = func.now()
    row.next_run_at = None
    session.flush()
    return row


def mark_job_finished(
    session: Session,
    row: AgentJob,
    *,
    status: str,
    result_json: dict[str, Any],
) -> AgentJob:
    now = datetime.now(timezone.utc)
    row.status = status
    row.result_json = result_json
    row.last_error_json = {} if status == "succeeded" else result_json
    if row.started_at is None:
        row.started_at = now
    row.finished_at = now
    row.next_run_at = None
    row.locked_by = None
    row.locked_until = None
    row.lock_acquired_at = None
    session.flush()
    return row


def mark_job_retry(
    session: Session,
    row: AgentJob,
    *,
    error_json: dict[str, Any],
    delay_seconds: float,
) -> AgentJob:
    row.status = "pending"
    row.result_json = error_json
    row.last_error_json = error_json
    row.next_run_at = datetime.now(timezone.utc) + timedelta(seconds=max(0.0, float(delay_seconds)))
    row.locked_by = None
    row.locked_until = None
    row.lock_acquired_at = None
    session.flush()
    return row


def reset_job_for_retry(session: Session, row: AgentJob, *, reset_attempts: bool = True) -> AgentJob:
    row.status = "pending"
    row.result_json = {}
    row.last_error_json = {}
    row.next_run_at = None
    row.started_at = None
    row.finished_at = None
    row.locked_by = None
    row.locked_until = None
    row.lock_acquired_at = None
    if reset_attempts:
        row.attempts = 0
    session.flush()
    return row


def schedule_job(session: Session, row: AgentJob, *, run_at: datetime) -> AgentJob:
    scheduled_at = _as_utc(run_at) or datetime.now(timezone.utc)
    row.status = "pending"
    row.next_run_at = scheduled_at
    row.started_at = None
    row.finished_at = None
    row.locked_by = None
    row.locked_until = None
    row.lock_acquired_at = None
    session.flush()
    return row


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
