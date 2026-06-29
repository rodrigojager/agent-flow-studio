import type { AgentFlow } from "@agent-flow-builder/flow-spec";

export interface RuntimeFile {
  relativePath: string;
  content: string;
}

interface ReferenceNodes {
  startNodeId: string;
  inputSafetyNodeId: string;
  llmNodeId: string;
  outputSafetyNodeId: string;
  deterministicNodeId: string;
  finishNodeId: string;
  systemPromptFile: string;
  actionRoutes: Record<string, string>;
}

export function renderPythonRuntimeFiles(flow: AgentFlow): RuntimeFile[] {
  assertSupportedRuntime(flow);
  const nodes = referenceNodes(flow);
  const serviceName = `${slug(flow.id)}-runtime`;
  return [
    { relativePath: "pyproject.toml", content: renderPyproject(flow, serviceName) },
    { relativePath: ".env.example", content: renderEnvExample(flow, serviceName) },
    { relativePath: "Dockerfile", content: renderDockerfile() },
    { relativePath: "docker-compose.yml", content: renderDockerCompose(flow) },
    { relativePath: "README.md", content: renderReadme(flow) },
    { relativePath: "migrations/001_init.sql", content: renderMigration() },
    { relativePath: "app/__init__.py", content: "" },
    { relativePath: "app/generated_flow.py", content: renderGeneratedFlow(flow) },
    { relativePath: "app/settings.py", content: renderSettings(flow, serviceName) },
    { relativePath: "app/db.py", content: renderDb() },
    { relativePath: "app/models.py", content: renderModels() },
    { relativePath: "app/repo.py", content: renderRepo() },
    { relativePath: "app/cache.py", content: renderCache(flow) },
    { relativePath: "app/idempotency.py", content: renderIdempotency() },
    { relativePath: "app/safety.py", content: renderSafety() },
    { relativePath: "app/llm.py", content: renderLlm(flow) },
    { relativePath: "app/graph.py", content: renderGraph(flow, nodes) },
    { relativePath: "app/schemas.py", content: renderSchemas() },
    { relativePath: "app/service.py", content: renderService() },
    { relativePath: "app/auth.py", content: renderAuth() },
    { relativePath: "app/main.py", content: renderMain(flow) },
    { relativePath: "tests/conftest.py", content: renderTestConftest() },
    { relativePath: "tests/test_generated_runtime.py", content: renderRuntimeTest() },
  ];
}

function assertSupportedRuntime(flow: AgentFlow): void {
  if (flow.runtime !== "langgraph-python") {
    throw new Error(`Runtime não suportado pelo gerador: ${flow.runtime}`);
  }
  if (flow.api.contract !== "sessions-v1") {
    throw new Error(`Contrato não suportado pelo gerador: ${flow.api.contract}`);
  }
  const adapter = flow.llm.adapter.toLowerCase();
  if (!["openai", "openai-compatible", "openrouter"].includes(adapter)) {
    throw new Error(`Adaptador LLM ainda não suportado pelo gerador Python: ${flow.llm.adapter}`);
  }
}

function referenceNodes(flow: AgentFlow): ReferenceNodes {
  const startNode = flow.nodes.find((node) => node.type === "start");
  const inputSafety = flow.nodes.find((node) => node.type === "safety_gate" && node.stage === "input");
  const llmNode = flow.nodes.find((node) => node.type === "llm_prompt" || node.type === "llm_structured");
  const outputSafety = flow.nodes.find((node) => node.type === "safety_gate" && node.stage === "output");
  const deterministicNode = flow.nodes.find((node) => node.type === "code" && node.handler === "deterministic_gate");
  const finishNode = flow.nodes.find((node) => node.type === "end");

  if (!startNode || !inputSafety || !llmNode || !outputSafety || !deterministicNode || !finishNode) {
    throw new Error(
      "O gerador de referência espera nós start, safety_gate input, llm_prompt, safety_gate output, deterministic_gate e end.",
    );
  }

  const prompt = flow.prompts.find((item) => item.id === llmNode.promptId) ?? flow.prompts[0];
  const actionRoutes: Record<string, string> = {};
  for (const edge of flow.edges.filter((edge) => edge.from === "start")) {
    const action = parseActionCondition(edge.condition);
    if (action) {
      actionRoutes[action] = edge.to;
    }
  }
  actionRoutes.start ??= startNode.id;
  actionRoutes.turn ??= inputSafety.id;
  actionRoutes.finish ??= finishNode.id;

  return {
    startNodeId: startNode.id,
    inputSafetyNodeId: inputSafety.id,
    llmNodeId: llmNode.id,
    outputSafetyNodeId: outputSafety.id,
    deterministicNodeId: deterministicNode.id,
    finishNodeId: finishNode.id,
    systemPromptFile: basename(prompt.path),
    actionRoutes,
  };
}

function parseActionCondition(condition: string | undefined): string | undefined {
  const match = condition?.match(/action\s*==\s*['"]([^'"]+)['"]/);
  return match?.[1];
}

function basename(value: string): string {
  return value.split(/[\\/]/).at(-1) ?? value;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function pyString(value: string): string {
  return JSON.stringify(value);
}

function pyJson(value: unknown): string {
  return JSON.stringify(JSON.stringify(value, null, 2));
}

function renderPyproject(flow: AgentFlow, serviceName: string): string {
  return `[project]
name = "${serviceName}"
version = "${flow.version}"
description = "Runtime LangGraph + FastAPI gerado para ${flow.name}."
requires-python = ">=3.12"
dependencies = [
  "fastapi",
  "uvicorn[standard]",
  "pydantic-settings",
  "sqlalchemy",
  "psycopg2-binary",
  "redis",
  "openai",
  "langgraph",
  "langgraph-checkpoint-postgres",
  "psycopg[binary,pool]",
  "python-dotenv",
]

[project.optional-dependencies]
dev = [
  "pytest",
  "httpx",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]

[tool.setuptools.packages.find]
include = ["app*"]
`;
}

function renderEnvExample(flow: AgentFlow, serviceName: string): string {
  const postgresCheckpointer = flow.persistence.checkpointer === "postgres" ? "true" : "false";
  const redisEnabled = flow.persistence.cache === "redis" ? "true" : "false";
  return `SERVICE_NAME=${serviceName}
DATABASE_URL=postgresql+psycopg2://agent:agent@localhost:5433/agent_runtime
REDIS_URL=redis://localhost:6380/0
REDIS_ENABLED=${redisEnabled}
USE_POSTGRES_CHECKPOINTER=${postgresCheckpointer}
MOCK_LLM=true
OPENAI_API_KEY=
OPENAI_MODEL=${flow.llm.model}
OPENAI_BASE_URL=
LLM_ADAPTER=${flow.llm.adapter}
LLM_MAX_RETRIES=2
AUTH_ENABLED=false
AGENT_API_KEY=
AUTO_CREATE_TABLES=true
LOG_LEVEL=INFO
`;
}

function renderDockerfile(): string {
  return `FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY pyproject.toml ./
RUN pip install --no-cache-dir .

COPY app ./app
COPY migrations ./migrations

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
`;
}

function renderDockerCompose(flow: AgentFlow): string {
  const volumeName = `${slug(flow.id).replace(/-/g, "_")}_postgres_data`;
  return `services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: agent
      POSTGRES_PASSWORD: agent
      POSTGRES_DB: agent_runtime
    ports:
      - "5433:5432"
    volumes:
      - ${volumeName}:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U agent -d agent_runtime"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    ports:
      - "6380:6379"

  api:
    build: .
    env_file:
      - .env
    environment:
      DATABASE_URL: postgresql+psycopg2://agent:agent@postgres:5432/agent_runtime
      REDIS_URL: redis://redis:6379/0
      REDIS_ENABLED: "true"
      USE_POSTGRES_CHECKPOINTER: "true"
      AUTO_CREATE_TABLES: "true"
    ports:
      - "8080:8080"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started

volumes:
  ${volumeName}:
`;
}

function renderReadme(flow: AgentFlow): string {
  return `# ${flow.name}

Runtime gerado a partir de \`${flow.id}\`.

## Contrato

- \`POST /${flow.api.resourceName}\`
- \`GET /${flow.api.resourceName}/{session_id}\`
- \`POST /${flow.api.resourceName}/{session_id}/start\`
- \`POST /${flow.api.resourceName}/{session_id}/turn\`
- \`POST /${flow.api.resourceName}/{session_id}/finish\`
- \`GET /${flow.api.resourceName}/{session_id}/transcript\`
- \`GET /${flow.api.resourceName}/{session_id}/events\`

## Execução local

\`\`\`powershell
python -m pip install -e ".[dev]"
pytest -q
uvicorn app.main:app --reload --port 8080
\`\`\`

## Nós

${flow.nodes.map((node) => `- \`${node.id}\` (${node.type})`).join("\n")}
`;
}

function renderGeneratedFlow(flow: AgentFlow): string {
  return `"""Artefato gerado a partir de agent.flow.json."""

import json


FLOW = json.loads(${pyJson(flow)})
FLOW_ID = FLOW["id"]
FLOW_NAME = FLOW["name"]
FLOW_VERSION = FLOW["version"]
API_RESOURCE = FLOW["api"]["resourceName"]
API_CONTRACT = FLOW["api"]["contract"]
LLM_ADAPTER = FLOW["llm"]["adapter"]
LLM_MODEL = FLOW["llm"]["model"]
NODES = [{"id": item["id"], "type": item["type"]} for item in FLOW["nodes"]]
EDGES = [
    {"from": item["from"], "to": item["to"], "condition": item.get("condition")}
    for item in FLOW["edges"]
]
`;
}

function renderSettings(flow: AgentFlow, serviceName: string): string {
  const apiKeyEnv = flow.llm.apiKeyEnv ?? "OPENAI_API_KEY";
  const baseUrlEnv = flow.llm.baseUrlEnv ?? "OPENAI_BASE_URL";
  const mockEnv = flow.llm.mockEnv ?? "MOCK_LLM";
  return `from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    service_name: str = ${pyString(serviceName)}
    database_url: str = "sqlite:///./agent_runtime.db"
    redis_url: str = "redis://localhost:6379/0"
    redis_enabled: bool = ${flow.persistence.cache === "redis" ? "True" : "False"}
    redis_ttl_seconds: int = 3600
    use_postgres_checkpointer: bool = ${flow.persistence.checkpointer === "postgres" ? "True" : "False"}
    mock_llm: bool = Field(default=True, validation_alias=${pyString(mockEnv)})
    openai_api_key: str = Field(default="", validation_alias=${pyString(apiKeyEnv)})
    openai_model: str = ${pyString(flow.llm.model)}
    openai_base_url: str = Field(default="", validation_alias=${pyString(baseUrlEnv)})
    llm_adapter: str = ${pyString(flow.llm.adapter)}
    llm_max_retries: int = 2
    auth_enabled: bool = False
    agent_api_key: str = ""
    auto_create_tables: bool = True
    log_level: str = "INFO"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8-sig",
        env_prefix="",
        case_sensitive=False,
    )

    @model_validator(mode="after")
    def validate_runtime_settings(self):
        if self.auth_enabled and not self.agent_api_key.strip():
            raise ValueError("AGENT_API_KEY é obrigatória quando AUTH_ENABLED=true.")
        if not self.mock_llm and not self.openai_api_key.strip():
            raise ValueError("${apiKeyEnv} é obrigatória quando ${mockEnv}=false.")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
`;
}

function renderDb(): string {
  return `from collections.abc import Generator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

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


def init_db() -> None:
    from app.models import Base

    Base.metadata.create_all(bind=engine)


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
`;
}

function renderModels(): string {
  return `from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.sql import func


Base = declarative_base()


class AgentSession(Base):
    __tablename__ = "agent_sessions"

    session_id = Column(String, primary_key=True)
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
`;
}

function renderRepo(): string {
  return `import uuid
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
    max_turns: int,
    metadata_json: dict[str, Any] | None,
) -> AgentSession:
    row = AgentSession(
        session_id=new_id(),
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
    event_type: str,
    node: str | None = None,
    payload: dict[str, Any] | None = None,
) -> AgentEvent:
    row = AgentEvent(
        event_id=new_id(),
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
`;
}

function renderCache(flow: AgentFlow): string {
  const cachePrefix = `${slug(flow.id)}-runtime`;
  return `import json
from typing import Any

import redis

from app.settings import Settings


CACHE_PREFIX = ${pyString(cachePrefix)}


class InMemoryCache:
    def __init__(self) -> None:
        self._store: dict[str, str] = {}

    def get_json(self, key: str) -> Any | None:
        raw = self._store.get(key)
        return json.loads(raw) if raw else None

    def set_json(self, key: str, value: Any, ttl_seconds: int | None = None) -> None:
        self._store[key] = json.dumps(value, ensure_ascii=False)

    def delete(self, *keys: str) -> None:
        for key in keys:
            self._store.pop(key, None)

    def ping(self) -> bool:
        return True


class RedisCache:
    def __init__(self, redis_url: str) -> None:
        self._client = redis.Redis.from_url(redis_url, decode_responses=True)

    def get_json(self, key: str) -> Any | None:
        raw = self._client.get(key)
        return json.loads(raw) if raw else None

    def set_json(self, key: str, value: Any, ttl_seconds: int | None = None) -> None:
        self._client.set(key, json.dumps(value, ensure_ascii=False), ex=ttl_seconds)

    def delete(self, *keys: str) -> None:
        if keys:
            self._client.delete(*keys)

    def ping(self) -> bool:
        return bool(self._client.ping())


def recent_key(session_id: str) -> str:
    return f"{CACHE_PREFIX}:{session_id}:recent"


def build_cache(settings: Settings):
    if settings.redis_enabled:
        return RedisCache(settings.redis_url)
    return InMemoryCache()
`;
}

function renderIdempotency(): string {
  return `import hashlib
import json
from typing import Any, Callable

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import repo


def normalize_idempotency_key(header_value: str | None, body_value: str | None) -> str:
    header = (header_value or "").strip()
    body = (body_value or "").strip()
    if header and body and header != body:
        raise HTTPException(
            status_code=400,
            detail="Header Idempotency-Key e campo idempotency_key possuem valores diferentes.",
        )
    key = header or body
    if not key:
        raise HTTPException(status_code=400, detail="Idempotency-Key é obrigatório para esta operação.")
    return key


def request_hash(payload: dict[str, Any]) -> str:
    cleaned = {key: value for key, value in payload.items() if key != "idempotency_key"}
    raw = json.dumps(cleaned, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def run_idempotent(
    session: Session,
    *,
    operation: str,
    idempotency_key: str,
    payload: dict[str, Any],
    handler: Callable[[], dict[str, Any]],
) -> dict[str, Any]:
    current_hash = request_hash(payload)
    existing = repo.get_idempotency_record(
        session,
        operation=operation,
        idempotency_key=idempotency_key,
    )
    if existing:
        if existing.request_hash != current_hash:
            raise HTTPException(
                status_code=409,
                detail="Chave de idempotência já usada com payload diferente.",
            )
        return dict(existing.response_json)

    response = handler()
    repo.save_idempotency_record(
        session,
        operation=operation,
        idempotency_key=idempotency_key,
        request_hash=current_hash,
        status_code=200,
        response_json=response,
    )
    return response
`;
}

function renderSafety(): string {
  return `from dataclasses import dataclass
from typing import Literal


Decision = Literal["allow", "block", "safe_redirect"]


@dataclass(frozen=True)
class SafetyDecision:
    blocked: bool
    decision: Decision
    category: str | None = None
    reason: str | None = None
    safe_response: str | None = None


class SafetyGate:
    def __init__(self) -> None:
        self._blocked_terms = {
            "ignore as regras": "jailbreak",
            "ignore o sistema": "jailbreak",
            "vazar prompt": "policy_leak",
            "senha secreta": "secret_request",
        }
        self._self_harm_terms = {
            "vou me matar",
            "quero me matar",
            "não aguento mais viver",
            "nao aguento mais viver",
        }

    def check_input(self, text: str) -> SafetyDecision:
        normalized = (text or "").strip().lower()
        if not normalized:
            return SafetyDecision(
                blocked=True,
                decision="safe_redirect",
                category="empty_input",
                reason="Mensagem vazia.",
                safe_response="Envie uma mensagem com conteúdo para continuarmos.",
            )
        for term in self._self_harm_terms:
            if term in normalized:
                return SafetyDecision(
                    blocked=True,
                    decision="block",
                    category="self_harm",
                    reason=f"Termo sensível detectado: {term}",
                    safe_response=(
                        "Sinto muito que você esteja passando por isso. "
                        "Procure apoio humano imediato. Se houver risco agora, ligue 188, 192 ou 190."
                    ),
                )
        for term, category in self._blocked_terms.items():
            if term in normalized:
                return SafetyDecision(
                    blocked=True,
                    decision="safe_redirect",
                    category=category,
                    reason=f"Termo bloqueado detectado: {term}",
                    safe_response="Não posso seguir com esse pedido, mas posso continuar com uma resposta segura.",
                )
        return SafetyDecision(blocked=False, decision="allow")

    def check_output(self, text: str) -> SafetyDecision:
        normalized = (text or "").strip().lower()
        if "system prompt" in normalized or "chave interna" in normalized:
            return SafetyDecision(
                blocked=True,
                decision="safe_redirect",
                category="policy_leak",
                reason="A saída tentou expor detalhes operacionais.",
                safe_response="Posso responder sem expor detalhes internos do agente.",
            )
        return SafetyDecision(blocked=False, decision="allow")
`;
}

function renderLlm(flow: AgentFlow): string {
  const adapter = flow.llm.adapter.toLowerCase();
  const defaultBaseUrl = adapter === "openrouter" ? "https://openrouter.ai/api/v1" : "";
  return `import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from openai import OpenAI

from app.settings import Settings


@dataclass(frozen=True)
class LLMResult:
    text: str
    provider: str
    model: str
    attempts: int


class LLMClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def generate(
        self,
        *,
        system_prompt: str,
        user_message: str,
        context: dict[str, Any],
        recent_messages: list[dict[str, str]],
    ) -> LLMResult:
        if self.settings.mock_llm:
            return LLMResult(
                text=(
                    "Recebi sua mensagem e mantive o fluxo do agente ativo. "
                    f"Você disse: {user_message}"
                ),
                provider="mock",
                model="mock",
                attempts=1,
            )

        client_kwargs: dict[str, Any] = {"api_key": self.settings.openai_api_key}
        base_url = self.settings.openai_base_url.strip() or ${pyString(defaultBaseUrl)}
        if base_url:
            client_kwargs["base_url"] = base_url
        client = OpenAI(**client_kwargs)

        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(recent_messages)
        messages.append(
            {
                "role": "user",
                "content": json.dumps(
                    {"context": context, "user_message": user_message},
                    ensure_ascii=False,
                ),
            }
        )

        max_attempts = max(1, int(self.settings.llm_max_retries or 1))
        last_error: Exception | None = None
        for attempt in range(1, max_attempts + 1):
            try:
                response = client.responses.create(
                    model=self.settings.openai_model,
                    input=messages,
                )
                return LLMResult(
                    text=(response.output_text or "").strip() or "Sem resposta do modelo.",
                    provider=self.settings.llm_adapter,
                    model=self.settings.openai_model,
                    attempts=attempt,
                )
            except Exception as exc:
                last_error = exc
                if attempt < max_attempts:
                    time.sleep(min(0.25 * attempt, 1.0))
        raise RuntimeError(f"Falha ao chamar LLM após {max_attempts} tentativa(s): {last_error}") from last_error


def load_prompt(name: str = "system.md") -> str:
    path = Path(__file__).resolve().parent / "prompts" / name
    return path.read_text(encoding="utf-8").strip()
`;
}

function renderGraph(flow: AgentFlow, nodes: ReferenceNodes): string {
  return `import atexit
import json
from typing import Any, Literal, TypedDict

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from app.llm import LLMClient, load_prompt
from app.safety import SafetyGate
from app.settings import Settings


START_NODE_ID = ${pyString(nodes.startNodeId)}
INPUT_SAFETY_NODE_ID = ${pyString(nodes.inputSafetyNodeId)}
LLM_NODE_ID = ${pyString(nodes.llmNodeId)}
OUTPUT_SAFETY_NODE_ID = ${pyString(nodes.outputSafetyNodeId)}
DETERMINISTIC_NODE_ID = ${pyString(nodes.deterministicNodeId)}
FINISH_NODE_ID = ${pyString(nodes.finishNodeId)}
SYSTEM_PROMPT_FILE = ${pyString(nodes.systemPromptFile)}
ACTION_ROUTE_MAP = json.loads(${pyJson(nodes.actionRoutes)})
START_MESSAGE = ${pyString(`Olá! Este é o ${flow.name}. Envie uma mensagem para eu ecoar o fluxo com segurança, LLM e estado.`)}


class ReferenceState(TypedDict, total=False):
    action: Literal["start", "turn", "finish"]
    session_id: str
    status: str
    phase: str
    turn: int
    max_turns: int
    user_message: str
    recent_messages: list[dict[str, str]]
    assistant_message: dict[str, str]
    safety: dict[str, Any]
    llm: dict[str, Any]
    is_complete: bool


def build_checkpointer(settings: Settings):
    if settings.use_postgres_checkpointer:
        try:
            from langgraph.checkpoint.postgres import PostgresSaver

            url = settings.database_url.replace("postgresql+psycopg2://", "postgresql://")
            manager = PostgresSaver.from_conn_string(url)
            if hasattr(manager, "__enter__"):
                saver = manager.__enter__()
                atexit.register(manager.__exit__, None, None, None)
            else:
                saver = manager
            saver.setup()
            return saver
        except Exception:
            if not settings.mock_llm:
                raise
    return MemorySaver()


def build_graph(
    *,
    settings: Settings,
    llm_client: LLMClient,
    safety_gate: SafetyGate,
    checkpointer,
):
    system_prompt = load_prompt(SYSTEM_PROMPT_FILE)

    def route_action(state: ReferenceState) -> str:
        action = state.get("action", "turn")
        return action if action in ACTION_ROUTE_MAP else "turn"

    def start_node(state: ReferenceState) -> ReferenceState:
        return {
            "status": "active",
            "phase": "awaiting_turn",
            "assistant_message": {"code": "ABR", "text": START_MESSAGE},
            "is_complete": False,
        }

    def input_safety_check(state: ReferenceState) -> ReferenceState:
        decision = safety_gate.check_input(state.get("user_message", ""))
        if decision.blocked:
            return {
                "safety": {
                    "blocked": True,
                    "decision": decision.decision,
                    "category": decision.category,
                    "reason": decision.reason,
                },
                "assistant_message": {"code": "SEG", "text": decision.safe_response or "Mensagem bloqueada."},
                "phase": "safety",
                "is_complete": decision.decision == "block",
                "status": "completed" if decision.decision == "block" else "active",
            }
        return {
            "safety": {"blocked": False, "decision": "allow"},
        }

    def route_after_input_safety(state: ReferenceState) -> str:
        return "blocked" if (state.get("safety") or {}).get("blocked") else "safe"

    def llm_step(state: ReferenceState) -> ReferenceState:
        result = llm_client.generate(
            system_prompt=system_prompt,
            user_message=state.get("user_message", ""),
            context={
                "session_id": state.get("session_id"),
                "turn": state.get("turn", 0),
                "max_turns": state.get("max_turns", 3),
                "phase": state.get("phase"),
            },
            recent_messages=state.get("recent_messages", []),
        )
        return {
            "assistant_message": {"code": "ECHO", "text": result.text},
            "llm": {
                "provider": result.provider,
                "model": result.model,
                "attempts": result.attempts,
            },
        }

    def output_safety_check(state: ReferenceState) -> ReferenceState:
        current_message = state.get("assistant_message") or {}
        decision = safety_gate.check_output(str(current_message.get("text") or ""))
        if decision.blocked:
            return {
                "safety": {
                    "blocked": True,
                    "decision": decision.decision,
                    "category": decision.category,
                    "reason": decision.reason,
                },
                "assistant_message": {"code": "SEG", "text": decision.safe_response or "Saída ajustada por segurança."},
            }
        return {}

    def deterministic_gate(state: ReferenceState) -> ReferenceState:
        next_turn = int(state.get("turn") or 0) + 1
        max_turns = int(state.get("max_turns") or 3)
        if next_turn >= max_turns:
            text = (state.get("assistant_message") or {}).get("text") or "Obrigado pela resposta."
            return {
                "turn": next_turn,
                "status": "completed",
                "phase": "closing",
                "is_complete": True,
                "assistant_message": {
                    "code": "ENC",
                    "text": f"{text}\\n\\nEncerramos por aqui porque o limite de turnos foi atingido.",
                },
            }
        return {
            "turn": next_turn,
            "status": "active",
            "phase": "awaiting_turn",
            "is_complete": False,
        }

    def finish_node(state: ReferenceState) -> ReferenceState:
        return {
            "status": "completed",
            "phase": "closing",
            "is_complete": True,
            "assistant_message": {"code": "ENC", "text": "Sessão finalizada manualmente."},
        }

    builder = StateGraph(ReferenceState)
    builder.add_node(START_NODE_ID, start_node)
    builder.add_node(INPUT_SAFETY_NODE_ID, input_safety_check)
    builder.add_node(LLM_NODE_ID, llm_step)
    builder.add_node(OUTPUT_SAFETY_NODE_ID, output_safety_check)
    builder.add_node(DETERMINISTIC_NODE_ID, deterministic_gate)
    builder.add_node(FINISH_NODE_ID, finish_node)

    builder.add_conditional_edges(START, route_action, ACTION_ROUTE_MAP)
    builder.add_edge(START_NODE_ID, END)
    builder.add_conditional_edges(
        INPUT_SAFETY_NODE_ID,
        route_after_input_safety,
        {"blocked": END, "safe": LLM_NODE_ID},
    )
    builder.add_edge(LLM_NODE_ID, OUTPUT_SAFETY_NODE_ID)
    builder.add_edge(OUTPUT_SAFETY_NODE_ID, DETERMINISTIC_NODE_ID)
    builder.add_edge(DETERMINISTIC_NODE_ID, END)
    builder.add_edge(FINISH_NODE_ID, END)

    return builder.compile(checkpointer=checkpointer)
`;
}

function renderSchemas(): string {
  return `from typing import Any

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
    event_type: str
    node: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class AssistantMessageView(BaseModel):
    code: str
    text: str


class SafetyView(BaseModel):
    blocked: bool = False
    decision: str = "allow"
    category: str | None = None
    reason: str | None = None


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


class MetadataResponse(BaseModel):
    service: str
    runtime: str
    contract: str
    flow_id: str
    flow_version: str
    llm_adapter: str
    supports_multi_agent_bundle: bool
`;
}

function renderService(): string {
  return `from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import repo
from app.cache import recent_key
from app.graph import (
    DETERMINISTIC_NODE_ID,
    FINISH_NODE_ID,
    INPUT_SAFETY_NODE_ID,
    LLM_NODE_ID,
    OUTPUT_SAFETY_NODE_ID,
    START_NODE_ID,
)
from app.models import AgentMessage, AgentSession
from app.settings import Settings


RECENT_LIMIT = 20


def session_view(row: AgentSession) -> dict[str, Any]:
    return {
        "session_id": row.session_id,
        "status": row.status,
        "phase": row.phase,
        "turn": row.turn,
        "max_turns": row.max_turns,
        "metadata": row.metadata_json or {},
        "is_complete": row.status == "completed",
    }


def message_view(row: AgentMessage) -> dict[str, Any]:
    return {
        "seq": row.seq,
        "role": row.role,
        "code": row.code,
        "content": row.content,
        "metadata": row.metadata_json or {},
    }


def event_view(row) -> dict[str, Any]:
    return {
        "seq": row.seq,
        "event_type": row.event_type,
        "node": row.node,
        "payload": row.payload or {},
    }


class ReferenceAgentService:
    def __init__(self, *, settings: Settings, graph, cache) -> None:
        self.settings = settings
        self.graph = graph
        self.cache = cache

    def create_session(
        self,
        db: Session,
        *,
        metadata: dict[str, Any],
        max_turns: int,
        auto_start: bool = False,
    ) -> dict[str, Any]:
        row = repo.create_session(db, max_turns=max_turns, metadata_json=metadata)
        repo.append_event(
            db,
            session_id=row.session_id,
            event_type="session_created",
            node=None,
            payload={"auto_start": auto_start},
        )
        response = {"session": session_view(row), "messages": []}
        if auto_start:
            started = self.start_session(db, row.session_id)
            response["session"] = started["session"]
            response["messages"] = started["messages"]
        return response

    def get_session(self, db: Session, session_id: str) -> dict[str, Any]:
        row = repo.get_session_by_id(db, session_id)
        if not row:
            raise HTTPException(status_code=404, detail="Sessão não encontrada.")
        return session_view(row)

    def start_session(self, db: Session, session_id: str) -> dict[str, Any]:
        row = repo.get_session_for_update(db, session_id)
        if not row:
            raise HTTPException(status_code=404, detail="Sessão não encontrada.")
        if row.status == "completed":
            return {"session": session_view(row), "messages": []}

        existing_messages = repo.get_transcript(db, session_id)
        if existing_messages:
            repo.update_session_state(db, row, status="active")
            return {"session": session_view(row), "messages": [message_view(item) for item in existing_messages]}

        result = self._invoke_graph(
            {
                "action": "start",
                "session_id": row.session_id,
                "status": row.status,
                "phase": row.phase,
                "turn": row.turn,
                "max_turns": row.max_turns,
            },
            row.session_id,
        )
        repo.update_session_state(db, row, status=result["status"], phase=result["phase"], turn=row.turn)
        assistant = result["assistant_message"]
        message = repo.append_message(
            db,
            session_id=row.session_id,
            role="assistant",
            code=assistant["code"],
            content=assistant["text"],
        )
        repo.append_event(db, session_id=row.session_id, event_type="node_completed", node=START_NODE_ID, payload=result)
        self._cache_recent(row.session_id, [message_view(message)])
        return {"session": session_view(row), "messages": [message_view(message)]}

    def process_turn(self, db: Session, session_id: str, user_message: str) -> dict[str, Any]:
        row = repo.get_session_for_update(db, session_id)
        if not row:
            raise HTTPException(status_code=404, detail="Sessão não encontrada.")
        if row.status == "created":
            raise HTTPException(status_code=409, detail="Sessão precisa ser iniciada antes do primeiro turno.")
        if row.status == "completed":
            last_message = repo.get_last_assistant_message(db, session_id)
            if not last_message:
                raise HTTPException(status_code=409, detail="Sessão finalizada sem mensagem final.")
            return {
                "session": session_view(row),
                "assistant_message": {"code": last_message.code or "ENC", "text": last_message.content},
                "safety": {"blocked": False, "decision": "allow"},
                "can_finish": True,
            }

        user_row = repo.append_message(
            db,
            session_id=row.session_id,
            role="user",
            content=user_message,
        )
        recent_messages = self._recent_messages(db, row.session_id)
        recent_messages.append({"role": "user", "content": user_message})
        result = self._invoke_graph(
            {
                "action": "turn",
                "session_id": row.session_id,
                "status": row.status,
                "phase": row.phase,
                "turn": row.turn,
                "max_turns": row.max_turns,
                "user_message": user_message,
                "recent_messages": recent_messages[-RECENT_LIMIT:],
            },
            row.session_id,
        )
        completed = bool(result.get("is_complete"))
        repo.update_session_state(
            db,
            row,
            status=result.get("status", row.status),
            phase=result.get("phase", row.phase),
            turn=int(result.get("turn", row.turn)),
            completed=completed,
        )
        assistant = result["assistant_message"]
        assistant_row = repo.append_message(
            db,
            session_id=row.session_id,
            role="assistant",
            code=assistant["code"],
            content=assistant["text"],
            metadata_json={"llm": result.get("llm"), "safety": result.get("safety")},
        )
        self._persist_turn_events(db, row.session_id, result, user_row.message_id)
        recent_payload = [*recent_messages[-RECENT_LIMIT:], {"role": "assistant", "content": assistant["text"]}]
        self.cache.set_json(recent_key(row.session_id), recent_payload[-RECENT_LIMIT:], ttl_seconds=self.settings.redis_ttl_seconds)
        return {
            "session": session_view(row),
            "assistant_message": {"code": assistant["code"], "text": assistant["text"]},
            "safety": result.get("safety") or {"blocked": False, "decision": "allow"},
            "can_finish": row.status == "completed" or row.turn >= row.max_turns,
        }

    def finish_session(self, db: Session, session_id: str) -> dict[str, Any]:
        row = repo.get_session_for_update(db, session_id)
        if not row:
            raise HTTPException(status_code=404, detail="Sessão não encontrada.")
        if row.status == "completed":
            return {"session": session_view(row), "message": None}

        result = self._invoke_graph(
            {
                "action": "finish",
                "session_id": row.session_id,
                "status": row.status,
                "phase": row.phase,
                "turn": row.turn,
                "max_turns": row.max_turns,
            },
            row.session_id,
        )
        repo.update_session_state(db, row, status="completed", phase="closing", completed=True)
        assistant = result["assistant_message"]
        message = repo.append_message(
            db,
            session_id=row.session_id,
            role="assistant",
            code=assistant["code"],
            content=assistant["text"],
        )
        repo.append_event(db, session_id=row.session_id, event_type="node_completed", node=FINISH_NODE_ID, payload=result)
        repo.append_event(
            db,
            session_id=row.session_id,
            event_type="post_finish_pending",
            node=None,
            payload={"kind": "mock_summary"},
        )
        self.cache.delete(recent_key(row.session_id))
        return {"session": session_view(row), "message": message_view(message)}

    def transcript(self, db: Session, session_id: str, from_seq: int | None = None) -> list[dict[str, Any]]:
        self.get_session(db, session_id)
        return [message_view(row) for row in repo.get_transcript(db, session_id, from_seq=from_seq)]

    def events(self, db: Session, session_id: str, from_seq: int | None = None) -> list[dict[str, Any]]:
        self.get_session(db, session_id)
        return [event_view(row) for row in repo.get_events(db, session_id, from_seq=from_seq)]

    def _invoke_graph(self, state: dict[str, Any], session_id: str) -> dict[str, Any]:
        return dict(
            self.graph.invoke(
                state,
                config={"configurable": {"thread_id": session_id}},
            )
        )

    def _recent_messages(self, db: Session, session_id: str) -> list[dict[str, str]]:
        cached = self.cache.get_json(recent_key(session_id))
        if isinstance(cached, list):
            return [{"role": item["role"], "content": item["content"]} for item in cached if "role" in item and "content" in item]
        rows = repo.get_recent_messages(db, session_id, RECENT_LIMIT)
        return [{"role": row.role, "content": row.content} for row in rows]

    def _cache_recent(self, session_id: str, messages: list[dict[str, Any]]) -> None:
        payload = [{"role": item["role"], "content": item["content"]} for item in messages]
        self.cache.set_json(recent_key(session_id), payload[-RECENT_LIMIT:], ttl_seconds=self.settings.redis_ttl_seconds)

    def _persist_turn_events(self, db: Session, session_id: str, result: dict[str, Any], user_message_id: str) -> None:
        repo.append_event(
            db,
            session_id=session_id,
            event_type="node_completed",
            node=INPUT_SAFETY_NODE_ID,
            payload={"safety": result.get("safety"), "source_message_id": user_message_id},
        )
        if not (result.get("safety") or {}).get("blocked"):
            repo.append_event(
                db,
                session_id=session_id,
                event_type="llm_called",
                node=LLM_NODE_ID,
                payload=result.get("llm") or {},
            )
            repo.append_event(
                db,
                session_id=session_id,
                event_type="node_completed",
                node=OUTPUT_SAFETY_NODE_ID,
                payload={"safety": result.get("safety") or {"blocked": False, "decision": "allow"}},
            )
            repo.append_event(
                db,
                session_id=session_id,
                event_type="node_completed",
                node=DETERMINISTIC_NODE_ID,
                payload={"turn": result.get("turn"), "status": result.get("status"), "phase": result.get("phase")},
            )
`;
}

function renderAuth(): string {
  return `from fastapi import Header, HTTPException, Request


def require_agent_api_key(
    request: Request,
    x_agent_api_key: str | None = Header(default=None, alias="X-Agent-API-Key"),
) -> None:
    settings = request.app.state.settings
    if not settings.auth_enabled:
        return
    if (x_agent_api_key or "").strip() != settings.agent_api_key:
        raise HTTPException(status_code=403, detail="Chave de API inválida.")
`;
}

function renderMain(flow: AgentFlow): string {
  return `import logging
from typing import Any

from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app import repo
from app.auth import require_agent_api_key
from app.cache import build_cache
from app.db import get_session, init_db
from app.generated_flow import API_CONTRACT, API_RESOURCE, FLOW_ID, FLOW_NAME, FLOW_VERSION
from app.graph import build_checkpointer, build_graph
from app.idempotency import normalize_idempotency_key, run_idempotent
from app.llm import LLMClient
from app.safety import SafetyGate
from app.schemas import (
    CreateSessionRequest,
    CreateSessionResponse,
    EmptyIdempotentRequest,
    EventView,
    FinishResponse,
    MessageView,
    MetadataResponse,
    SessionView,
    StartResponse,
    TurnRequest,
    TurnResponse,
)
from app.service import ReferenceAgentService
from app.settings import get_settings


logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    settings = get_settings()
    logging.basicConfig(level=settings.log_level)
    if settings.auto_create_tables:
        init_db()

    cache = build_cache(settings)
    llm_client = LLMClient(settings)
    safety_gate = SafetyGate()
    checkpointer = build_checkpointer(settings)
    graph = build_graph(
        settings=settings,
        llm_client=llm_client,
        safety_gate=safety_gate,
        checkpointer=checkpointer,
    )
    service = ReferenceAgentService(settings=settings, graph=graph, cache=cache)

    app = FastAPI(title=FLOW_NAME)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.settings = settings
    app.state.cache = cache
    app.state.service = service

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        logger.exception("Erro não tratado em %s", request.url.path)
        return JSONResponse(status_code=500, content={"detail": "Erro interno no agente."})

    @app.get("/health")
    def health(db: Session = Depends(get_session)):
        db_ok = repo.check_db_health(db)
        try:
            cache_ok = bool(cache.ping())
        except Exception:
            cache_ok = False
        return {
            "status": "ok" if db_ok and cache_ok else "degraded",
            "db_ok": db_ok,
            "cache_ok": cache_ok,
        }

    @app.get("/metadata", response_model=MetadataResponse)
    def metadata():
        return {
            "service": settings.service_name,
            "runtime": "langgraph-fastapi-python",
            "contract": API_CONTRACT,
            "flow_id": FLOW_ID,
            "flow_version": FLOW_VERSION,
            "llm_adapter": settings.llm_adapter,
            "supports_multi_agent_bundle": False,
        }

    def idempotency_key(header: str | None, body_key: str | None) -> str:
        return normalize_idempotency_key(header, body_key)

    @app.post(
        f"/{API_RESOURCE}",
        response_model=CreateSessionResponse,
        dependencies=[Depends(require_agent_api_key)],
    )
    def create_session(
        payload: CreateSessionRequest,
        db: Session = Depends(get_session),
        header_idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ):
        key = idempotency_key(header_idempotency_key, payload.idempotency_key)
        request_payload = payload.model_dump(mode="json")
        return run_idempotent(
            db,
            operation=f"POST /{API_RESOURCE}",
            idempotency_key=key,
            payload=request_payload,
            handler=lambda: app.state.service.create_session(
                db,
                metadata=payload.metadata,
                max_turns=payload.max_turns,
                auto_start=payload.auto_start,
            ),
        )

    @app.get(
        f"/{API_RESOURCE}/{{session_id}}",
        response_model=SessionView,
        dependencies=[Depends(require_agent_api_key)],
    )
    def get_session_view(session_id: str, db: Session = Depends(get_session)):
        return app.state.service.get_session(db, session_id)

    @app.post(
        f"/{API_RESOURCE}/{{session_id}}/start",
        response_model=StartResponse,
        dependencies=[Depends(require_agent_api_key)],
    )
    def start_session(
        session_id: str,
        payload: EmptyIdempotentRequest,
        db: Session = Depends(get_session),
        header_idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ):
        key = idempotency_key(header_idempotency_key, payload.idempotency_key)
        request_payload: dict[str, Any] = {"session_id": session_id, **payload.model_dump(mode="json")}
        return run_idempotent(
            db,
            operation=f"POST /{API_RESOURCE}/{{session_id}}/start",
            idempotency_key=key,
            payload=request_payload,
            handler=lambda: app.state.service.start_session(db, session_id),
        )

    @app.post(
        f"/{API_RESOURCE}/{{session_id}}/turn",
        response_model=TurnResponse,
        dependencies=[Depends(require_agent_api_key)],
    )
    def turn_session(
        session_id: str,
        payload: TurnRequest,
        db: Session = Depends(get_session),
        header_idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ):
        key = idempotency_key(header_idempotency_key, payload.idempotency_key)
        request_payload: dict[str, Any] = {"session_id": session_id, **payload.model_dump(mode="json")}
        return run_idempotent(
            db,
            operation=f"POST /{API_RESOURCE}/{{session_id}}/turn",
            idempotency_key=key,
            payload=request_payload,
            handler=lambda: app.state.service.process_turn(db, session_id, payload.user_message),
        )

    @app.post(
        f"/{API_RESOURCE}/{{session_id}}/finish",
        response_model=FinishResponse,
        dependencies=[Depends(require_agent_api_key)],
    )
    def finish_session(
        session_id: str,
        payload: EmptyIdempotentRequest,
        db: Session = Depends(get_session),
        header_idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ):
        key = idempotency_key(header_idempotency_key, payload.idempotency_key)
        request_payload: dict[str, Any] = {"session_id": session_id, **payload.model_dump(mode="json")}
        return run_idempotent(
            db,
            operation=f"POST /{API_RESOURCE}/{{session_id}}/finish",
            idempotency_key=key,
            payload=request_payload,
            handler=lambda: app.state.service.finish_session(db, session_id),
        )

    @app.get(
        f"/{API_RESOURCE}/{{session_id}}/transcript",
        response_model=list[MessageView],
        dependencies=[Depends(require_agent_api_key)],
    )
    def transcript(
        session_id: str,
        from_seq: int | None = Query(default=None, alias="from_seq"),
        db: Session = Depends(get_session),
    ):
        return app.state.service.transcript(db, session_id, from_seq=from_seq)

    @app.get(
        f"/{API_RESOURCE}/{{session_id}}/events",
        response_model=list[EventView],
        dependencies=[Depends(require_agent_api_key)],
    )
    def events(
        session_id: str,
        from_seq: int | None = Query(default=None, alias="from_seq"),
        db: Session = Depends(get_session),
    ):
        return app.state.service.events(db, session_id, from_seq=from_seq)

    return app


app = create_app()
`;
}

function renderTestConftest(): string {
  return `import os
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
project_root_text = str(PROJECT_ROOT)
if project_root_text not in sys.path:
    sys.path.insert(0, project_root_text)


def set_test_env(db_path: str) -> None:
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    os.environ["REDIS_ENABLED"] = "false"
    os.environ["USE_POSTGRES_CHECKPOINTER"] = "false"
    os.environ["MOCK_LLM"] = "true"
    os.environ["AUTH_ENABLED"] = "false"
    os.environ["AUTO_CREATE_TABLES"] = "true"

    from app.settings import get_settings

    get_settings.cache_clear()
`;
}

function renderRuntimeTest(): string {
  return `from fastapi.testclient import TestClient

from app.generated_flow import API_RESOURCE, FLOW_ID
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

    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "create-1"},
        json={"metadata": {"source": "pytest"}, "max_turns": 2},
    )
    assert create_resp.status_code == 200
    session_id = create_resp.json()["session"]["session_id"]

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
`;
}

function renderMigration(): string {
  return `CREATE TABLE IF NOT EXISTS agent_sessions (
  session_id VARCHAR PRIMARY KEY,
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
  session_id VARCHAR NOT NULL REFERENCES agent_sessions(session_id),
  seq INTEGER NOT NULL,
  event_type VARCHAR NOT NULL,
  node VARCHAR NULL,
  payload JSON,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_agent_event_seq UNIQUE (session_id, seq)
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
`;
}
