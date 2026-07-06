from collections.abc import Generator
from contextlib import contextmanager

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from app.generated_flow import AGENT_ID
from app.settings import get_settings


def _connect_args(database_url: str) -> dict:
    if database_url.startswith("sqlite"):
        return {"check_same_thread": False}
    return {}


settings = get_settings()
engine = create_engine(
    settings.database_url,
    connect_args=_connect_args(settings.database_url),
    future=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def _table_columns(connection, table_name: str) -> set[str]:
    try:
        return {column["name"] for column in inspect(connection).get_columns(table_name)}
    except Exception:
        return set()


def _add_column_if_missing(connection, table_name: str, column_name: str, definition: str) -> None:
    if column_name not in _table_columns(connection, table_name):
        connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}"))


def _apply_compat_migrations(connection) -> None:
    dialect = connection.dialect.name
    timestamp_type = "DATETIME" if dialect == "sqlite" else "TIMESTAMPTZ"
    timestamp_default = "CURRENT_TIMESTAMP" if dialect == "sqlite" else "now()"
    timestamp_column = timestamp_type if dialect == "sqlite" else f"{timestamp_type} DEFAULT {timestamp_default}"

    if _table_columns(connection, "agent_sessions"):
        _add_column_if_missing(connection, "agent_sessions", "agent_id", "VARCHAR")
        connection.execute(text("UPDATE agent_sessions SET agent_id = :agent_id WHERE agent_id IS NULL OR agent_id = ''"), {"agent_id": AGENT_ID})
        if dialect != "sqlite":
            connection.execute(text("ALTER TABLE agent_sessions ALTER COLUMN agent_id SET NOT NULL"))

    if _table_columns(connection, "agent_events"):
        _add_column_if_missing(connection, "agent_events", "agent_id", "VARCHAR")
        connection.execute(text("UPDATE agent_events SET agent_id = :agent_id WHERE agent_id IS NULL OR agent_id = ''"), {"agent_id": AGENT_ID})
        if dialect != "sqlite":
            connection.execute(text("ALTER TABLE agent_events ALTER COLUMN agent_id SET NOT NULL"))

    if _table_columns(connection, "agent_jobs"):
        _add_column_if_missing(connection, "agent_jobs", "agent_id", "VARCHAR")
        _add_column_if_missing(connection, "agent_jobs", "attempts", "INTEGER DEFAULT 0")
        _add_column_if_missing(connection, "agent_jobs", "max_attempts", "INTEGER DEFAULT 3")
        _add_column_if_missing(connection, "agent_jobs", "payload_json", "JSON")
        _add_column_if_missing(connection, "agent_jobs", "result_json", "JSON")
        _add_column_if_missing(connection, "agent_jobs", "last_error_json", "JSON")
        _add_column_if_missing(connection, "agent_jobs", "created_at", timestamp_column)
        _add_column_if_missing(connection, "agent_jobs", "updated_at", timestamp_column)
        _add_column_if_missing(connection, "agent_jobs", "started_at", f"{timestamp_type} NULL")
        _add_column_if_missing(connection, "agent_jobs", "finished_at", f"{timestamp_type} NULL")
        _add_column_if_missing(connection, "agent_jobs", "next_run_at", f"{timestamp_type} NULL")
        _add_column_if_missing(connection, "agent_jobs", "locked_by", "VARCHAR")
        _add_column_if_missing(connection, "agent_jobs", "locked_until", f"{timestamp_type} NULL")
        _add_column_if_missing(connection, "agent_jobs", "lock_acquired_at", f"{timestamp_type} NULL")
        connection.execute(text("UPDATE agent_jobs SET agent_id = :agent_id WHERE agent_id IS NULL OR agent_id = ''"), {"agent_id": AGENT_ID})
        connection.execute(text("UPDATE agent_jobs SET attempts = 0 WHERE attempts IS NULL"))
        connection.execute(text("UPDATE agent_jobs SET max_attempts = 3 WHERE max_attempts IS NULL"))
        connection.execute(text(f"UPDATE agent_jobs SET created_at = {timestamp_default} WHERE created_at IS NULL"))
        connection.execute(text(f"UPDATE agent_jobs SET updated_at = {timestamp_default} WHERE updated_at IS NULL"))
        if dialect != "sqlite":
            connection.execute(text("ALTER TABLE agent_jobs ALTER COLUMN agent_id SET NOT NULL"))

    if _table_columns(connection, "agent_job_schedules"):
        _add_column_if_missing(connection, "agent_job_schedules", "agent_id", "VARCHAR")
        _add_column_if_missing(connection, "agent_job_schedules", "session_id", "VARCHAR")
        _add_column_if_missing(connection, "agent_job_schedules", "kind", "VARCHAR")
        _add_column_if_missing(connection, "agent_job_schedules", "status", "VARCHAR DEFAULT 'enabled'")
        _add_column_if_missing(connection, "agent_job_schedules", "trigger_type", "VARCHAR DEFAULT 'interval'")
        _add_column_if_missing(connection, "agent_job_schedules", "interval_seconds", "INTEGER DEFAULT 3600")
        _add_column_if_missing(connection, "agent_job_schedules", "cron_expression", "VARCHAR")
        _add_column_if_missing(connection, "agent_job_schedules", "max_attempts", "INTEGER DEFAULT 3")
        _add_column_if_missing(connection, "agent_job_schedules", "payload_json", "JSON")
        _add_column_if_missing(connection, "agent_job_schedules", "last_job_id", "VARCHAR")
        _add_column_if_missing(connection, "agent_job_schedules", "created_at", timestamp_column)
        _add_column_if_missing(connection, "agent_job_schedules", "updated_at", timestamp_column)
        _add_column_if_missing(connection, "agent_job_schedules", "last_run_at", f"{timestamp_type} NULL")
        _add_column_if_missing(connection, "agent_job_schedules", "next_run_at", f"{timestamp_type} NULL")
        connection.execute(text("UPDATE agent_job_schedules SET agent_id = :agent_id WHERE agent_id IS NULL OR agent_id = ''"), {"agent_id": AGENT_ID})
        connection.execute(text("UPDATE agent_job_schedules SET status = 'enabled' WHERE status IS NULL OR status = ''"))
        connection.execute(text("UPDATE agent_job_schedules SET trigger_type = 'interval' WHERE trigger_type IS NULL OR trigger_type = ''"))
        connection.execute(text("UPDATE agent_job_schedules SET interval_seconds = 3600 WHERE interval_seconds IS NULL OR interval_seconds <= 0"))
        connection.execute(text("UPDATE agent_job_schedules SET max_attempts = 3 WHERE max_attempts IS NULL OR max_attempts <= 0"))
        connection.execute(text(f"UPDATE agent_job_schedules SET created_at = {timestamp_default} WHERE created_at IS NULL"))
        connection.execute(text(f"UPDATE agent_job_schedules SET updated_at = {timestamp_default} WHERE updated_at IS NULL"))
        if dialect != "sqlite":
            connection.execute(text("ALTER TABLE agent_job_schedules ALTER COLUMN agent_id SET NOT NULL"))
            connection.execute(text("ALTER TABLE agent_job_schedules ALTER COLUMN status SET NOT NULL"))
            connection.execute(text("ALTER TABLE agent_job_schedules ALTER COLUMN trigger_type SET NOT NULL"))


def _acquire_schema_lock(connection) -> None:
    if connection.dialect.name == "postgresql":
        connection.execute(text("SELECT pg_advisory_xact_lock(73475001)"))


def init_db() -> None:
    from app.models import Base

    with engine.begin() as connection:
        _acquire_schema_lock(connection)
        Base.metadata.create_all(bind=connection)
        _apply_compat_migrations(connection)


def get_session() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@contextmanager
def session_scope() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
