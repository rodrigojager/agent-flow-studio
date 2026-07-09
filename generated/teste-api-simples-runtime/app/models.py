from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.sql import func


Base = declarative_base()


class AgentSession(Base):
    __tablename__ = "agent_sessions"

    session_id = Column(String, primary_key=True)
    agent_id = Column(String, nullable=False, index=True)
    status = Column(String, nullable=False, default="created")
    phase = Column(String, nullable=False, default="created")
    turn = Column(Integer, nullable=False, default=0)
    max_turns = Column(Integer, nullable=False, default=3)
    metadata_json = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    messages = relationship("AgentMessage", back_populates="agent_session", cascade="all, delete-orphan")
    events = relationship("AgentEvent", back_populates="agent_session", cascade="all, delete-orphan")
    jobs = relationship("AgentJob", back_populates="agent_session", cascade="all, delete-orphan")
    job_schedules = relationship("AgentJobSchedule", back_populates="agent_session", cascade="all, delete-orphan")


class AgentMessage(Base):
    __tablename__ = "agent_messages"

    message_id = Column(String, primary_key=True)
    session_id = Column(String, ForeignKey("agent_sessions.session_id"), nullable=False)
    seq = Column(Integer, nullable=False)
    role = Column(String, nullable=False)
    code = Column(String, nullable=True)
    content = Column(Text, nullable=False)
    metadata_json = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("session_id", "seq", name="uq_agent_message_seq"),
    )

    agent_session = relationship("AgentSession", back_populates="messages")


class AgentEvent(Base):
    __tablename__ = "agent_events"

    event_id = Column(String, primary_key=True)
    agent_id = Column(String, nullable=False, index=True)
    session_id = Column(String, ForeignKey("agent_sessions.session_id"), nullable=False)
    seq = Column(Integer, nullable=False)
    event_type = Column(String, nullable=False)
    node = Column(String, nullable=True)
    payload = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("session_id", "seq", name="uq_agent_event_seq"),
    )

    agent_session = relationship("AgentSession", back_populates="events")


class AgentNodeRecord(Base):
    __tablename__ = "agent_node_records"

    record_id = Column(String, primary_key=True)
    session_id = Column(String, nullable=False)
    node_id = Column(String, nullable=False)
    payload_json = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AgentJob(Base):
    __tablename__ = "agent_jobs"

    job_id = Column(String, primary_key=True)
    agent_id = Column(String, nullable=False, index=True)
    session_id = Column(String, ForeignKey("agent_sessions.session_id"), nullable=False, index=True)
    kind = Column(String, nullable=False)
    status = Column(String, nullable=False, default="pending", index=True)
    attempts = Column(Integer, nullable=False, default=0)
    max_attempts = Column(Integer, nullable=False, default=3)
    payload_json = Column(JSON, nullable=True)
    result_json = Column(JSON, nullable=True)
    last_error_json = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    next_run_at = Column(DateTime(timezone=True), nullable=True)
    locked_by = Column(String, nullable=True, index=True)
    locked_until = Column(DateTime(timezone=True), nullable=True)
    lock_acquired_at = Column(DateTime(timezone=True), nullable=True)

    agent_session = relationship("AgentSession", back_populates="jobs")


class AgentJobSchedule(Base):
    __tablename__ = "agent_job_schedules"

    schedule_id = Column(String, primary_key=True)
    agent_id = Column(String, nullable=False, index=True)
    session_id = Column(String, ForeignKey("agent_sessions.session_id"), nullable=False, index=True)
    kind = Column(String, nullable=False)
    status = Column(String, nullable=False, default="enabled", index=True)
    trigger_type = Column(String, nullable=False, default="interval", index=True)
    interval_seconds = Column(Integer, nullable=False)
    cron_expression = Column(String, nullable=True)
    max_attempts = Column(Integer, nullable=False, default=3)
    payload_json = Column(JSON, nullable=True)
    last_job_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    last_run_at = Column(DateTime(timezone=True), nullable=True)
    next_run_at = Column(DateTime(timezone=True), nullable=True)

    agent_session = relationship("AgentSession", back_populates="job_schedules")


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_records"

    record_id = Column(String, primary_key=True)
    idempotency_key = Column(String, nullable=False)
    operation = Column(String, nullable=False)
    request_hash = Column(String, nullable=False)
    status_code = Column(Integer, nullable=False)
    response_json = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("operation", "idempotency_key", name="uq_idempotency_operation_key"),
    )
