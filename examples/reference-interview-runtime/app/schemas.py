from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class IdempotentBody(BaseModel):
    idempotency_key: str | None = Field(default=None, min_length=1)


class CreateSessionRequest(IdempotentBody):
    metadata: dict[str, Any] = Field(default_factory=dict)
    max_turns: int = Field(default=3, ge=1, le=50)
    auto_start: bool = False


class EmptyIdempotentRequest(IdempotentBody):
    pass


class TurnRequest(IdempotentBody):
    user_message: str = Field(..., min_length=1)


class SessionView(BaseModel):
    session_id: str
    agent_id: str
    status: str
    phase: str
    turn: int
    max_turns: int
    metadata: dict[str, Any] = Field(default_factory=dict)
    is_complete: bool


class MessageView(BaseModel):
    seq: int
    role: str
    code: str | None = None
    content: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class EventView(BaseModel):
    seq: int
    agent_id: str
    event_type: str
    node: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class JobView(BaseModel):
    job_id: str
    agent_id: str
    session_id: str
    kind: str
    status: str
    attempts: int
    max_attempts: int
    payload: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any] = Field(default_factory=dict)
    last_error: dict[str, Any] = Field(default_factory=dict)
    next_run_at: str | None = None
    locked_by: str | None = None
    locked_until: str | None = None
    lock_acquired_at: str | None = None


class JobScheduleRequest(BaseModel):
    delay_seconds: float | None = Field(default=None, ge=0, le=31536000)
    run_at: datetime | None = None


class RecurringJobScheduleRequest(BaseModel):
    trigger_type: str = Field(default="interval", pattern="^(interval|cron|event)$")
    interval_seconds: int | None = Field(default=None, ge=60, le=31536000)
    cron_expression: str | None = Field(default=None, max_length=120)
    event_type: str | None = Field(default=None, min_length=1, max_length=120)
    delay_seconds: float | None = Field(default=None, ge=0, le=31536000)
    run_at: datetime | None = None


class EventJobScheduleTriggerRequest(BaseModel):
    event_type: str = Field(..., min_length=1, max_length=120)
    session_id: str | None = Field(default=None, min_length=1)
    payload: dict[str, Any] = Field(default_factory=dict)
    limit: int = Field(default=20, ge=1, le=200)


class JobScheduleView(BaseModel):
    schedule_id: str
    agent_id: str
    session_id: str
    kind: str
    status: str
    trigger_type: str
    interval_seconds: int
    cron_expression: str | None = None
    event_type: str | None = None
    max_attempts: int
    payload: dict[str, Any] = Field(default_factory=dict)
    last_job_id: str | None = None
    last_run_at: str | None = None
    next_run_at: str | None = None


class JobScheduleResponse(BaseModel):
    schedule: JobScheduleView


class JobScheduleBatchResponse(BaseModel):
    schedules: list[JobScheduleView] = Field(default_factory=list)
    jobs: list[JobView] = Field(default_factory=list)
    total: int
    enqueued: int


class JobCleanupRequest(BaseModel):
    statuses: list[str] = Field(default_factory=lambda: ["succeeded", "failed"])
    older_than_hours: float = Field(default=168.0, ge=0.0, le=87600.0)
    session_id: str | None = Field(default=None, min_length=1)
    limit: int = Field(default=100, ge=1, le=1000)
    dry_run: bool = True


class JobCleanupResponse(BaseModel):
    dry_run: bool
    matched: int
    deleted: int
    statuses: list[str]
    older_than_hours: float
    cutoff: str
    job_ids: list[str] = Field(default_factory=list)
    by_status: dict[str, int] = Field(default_factory=dict)


class JobMetricsResponse(BaseModel):
    total: int
    by_status: dict[str, int] = Field(default_factory=dict)
    by_kind: dict[str, int] = Field(default_factory=dict)
    attempts_total: int
    pending_due: int
    failed: int
    exhausted: int
    succeeded: int
    terminal: int
    success_rate: float | None = None
    duration_ms_avg: float | None = None
    duration_ms_min: float | None = None
    duration_ms_max: float | None = None
    duration_ms_p95: float | None = None
    window_hours: float
    finished_in_window: int
    succeeded_in_window: int
    failed_in_window: int
    success_rate_in_window: float | None = None
    window_duration_ms_avg: float | None = None
    window_duration_ms_p95: float | None = None
    throughput_per_hour: float | None = None
    oldest_pending_at: str | None = None
    next_due_at: str | None = None
    leased_running: int
    expired_leases: int
    finished_last_hour: int
    last_finished_at: str | None = None


class AssistantMessageView(BaseModel):
    code: str
    text: str


class SafetyView(BaseModel):
    blocked: bool = False
    decision: str = "allow"
    category: str | None = None
    reason: str | None = None
    severity: str | None = None
    action: str | None = None
    rule_id: str | None = None
    rule_label: str | None = None
    match_type: str | None = None
    matched_text: str | None = None
    node_id: str | None = None
    stage: str | None = None
    source: str | None = None
    provider_score: float | None = None
    provider_error: str | None = None


class CreateSessionResponse(BaseModel):
    session: SessionView
    messages: list[MessageView] = Field(default_factory=list)


class StartResponse(BaseModel):
    session: SessionView
    messages: list[MessageView]


class TurnResponse(BaseModel):
    session: SessionView
    assistant_message: AssistantMessageView
    safety: SafetyView
    can_finish: bool


class FinishResponse(BaseModel):
    session: SessionView
    message: MessageView | None = None


class JobRunResponse(BaseModel):
    job: JobView


class JobBatchResponse(BaseModel):
    jobs: list[JobView] = Field(default_factory=list)
    total: int
    succeeded: int
    failed: int
    errors: list[dict[str, Any]] = Field(default_factory=list)


class MetadataResponse(BaseModel):
    service: str
    runtime: str
    contract: str
    flow_id: str
    agent_id: str
    flow_version: str
    llm_adapter: str
    supports_multi_agent_bundle: bool
    operations: dict[str, Any] = Field(default_factory=dict)
