CREATE TABLE IF NOT EXISTS agent_sessions (
  session_id VARCHAR PRIMARY KEY,
  agent_id VARCHAR NOT NULL,
  status VARCHAR NOT NULL,
  phase VARCHAR NOT NULL,
  turn INTEGER NOT NULL DEFAULT 0,
  max_turns INTEGER NOT NULL DEFAULT 3,
  metadata_json JSON,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS agent_messages (
  message_id VARCHAR PRIMARY KEY,
  session_id VARCHAR NOT NULL REFERENCES agent_sessions(session_id),
  seq INTEGER NOT NULL,
  role VARCHAR NOT NULL,
  code VARCHAR NULL,
  content TEXT NOT NULL,
  metadata_json JSON,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_agent_message_seq UNIQUE (session_id, seq)
);

CREATE TABLE IF NOT EXISTS agent_events (
  event_id VARCHAR PRIMARY KEY,
  agent_id VARCHAR NOT NULL,
  session_id VARCHAR NOT NULL REFERENCES agent_sessions(session_id),
  seq INTEGER NOT NULL,
  event_type VARCHAR NOT NULL,
  node VARCHAR NULL,
  payload JSON,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_agent_event_seq UNIQUE (session_id, seq)
);

CREATE TABLE IF NOT EXISTS agent_jobs (
  job_id VARCHAR PRIMARY KEY,
  agent_id VARCHAR NOT NULL,
  session_id VARCHAR NOT NULL REFERENCES agent_sessions(session_id),
  kind VARCHAR NOT NULL,
  status VARCHAR NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  payload_json JSON,
  result_json JSON,
  last_error_json JSON,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  next_run_at TIMESTAMPTZ NULL,
  locked_by VARCHAR NULL,
  locked_until TIMESTAMPTZ NULL,
  lock_acquired_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS agent_job_schedules (
  schedule_id VARCHAR PRIMARY KEY,
  agent_id VARCHAR NOT NULL,
  session_id VARCHAR NOT NULL REFERENCES agent_sessions(session_id),
  kind VARCHAR NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'enabled',
  trigger_type VARCHAR NOT NULL DEFAULT 'interval',
  interval_seconds INTEGER NOT NULL,
  cron_expression VARCHAR NULL,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  payload_json JSON,
  last_job_id VARCHAR NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_run_at TIMESTAMPTZ NULL,
  next_run_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  record_id VARCHAR PRIMARY KEY,
  idempotency_key VARCHAR NOT NULL,
  operation VARCHAR NOT NULL,
  request_hash VARCHAR NOT NULL,
  status_code INTEGER NOT NULL,
  response_json JSON NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_idempotency_operation_key UNIQUE (operation, idempotency_key)
);
