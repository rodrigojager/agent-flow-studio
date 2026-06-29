import type { AgentFlow, RuntimeManifest } from "@agent-flow-builder/flow-spec";
import type { RuntimeFile } from "./pythonRuntimeTemplates.ts";

export interface PythonBundleAgent {
  id: string;
  routePrefix: string;
  flow: AgentFlow;
}

export function renderPythonMultiAgentBundleFiles(
  manifest: RuntimeManifest,
  agents: PythonBundleAgent[],
): RuntimeFile[] {
  assertMultiAgentBundle(manifest, agents);
  const serviceName = `${slug(manifest.id)}-bundle`;
  return [
    { relativePath: "pyproject.toml", content: renderPyproject(manifest, serviceName) },
    { relativePath: ".env.example", content: renderEnvExample(manifest, serviceName) },
    { relativePath: "Dockerfile", content: renderDockerfile() },
    { relativePath: "docker-compose.yml", content: renderDockerCompose(manifest) },
    { relativePath: "app/__init__.py", content: "" },
    { relativePath: "app/main.py", content: renderMain(manifest, agents) },
    { relativePath: "tests/conftest.py", content: renderTestConftest() },
    { relativePath: "tests/test_multiagent_bundle.py", content: renderMultiAgentTest(agents) },
  ];
}

function assertMultiAgentBundle(manifest: RuntimeManifest, agents: PythonBundleAgent[]): void {
  if (manifest.packaging !== "multiagent") {
    throw new Error("O bundle Python compartilhado só deve ser gerado para manifestos multiagent.");
  }
  if (agents.length < 1) {
    throw new Error("O bundle Python compartilhado exige ao menos um agente.");
  }
  const prefixes = new Set<string>();
  for (const agent of agents) {
    const prefix = normalizeRoutePrefix(agent.routePrefix);
    if (!prefix || prefix === "/") {
      throw new Error(`Agente ${agent.id} precisa de routePrefix não vazio no modo multiagent.`);
    }
    if (prefixes.has(prefix)) {
      throw new Error(`routePrefix duplicado no modo multiagent: ${prefix}.`);
    }
    prefixes.add(prefix);
  }
}

function renderPyproject(manifest: RuntimeManifest, serviceName: string): string {
  return `[project]
name = "${serviceName}"
version = "${manifest.version}"
description = "Runtime FastAPI multiagente gerado para ${manifest.name}."
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

function renderEnvExample(manifest: RuntimeManifest, serviceName: string): string {
  const adapter = manifest.defaultLlm?.adapter ?? "openai";
  const model = manifest.defaultLlm?.model ?? "gpt-4.1-mini";
  const apiKeyEnv = manifest.defaultLlm?.apiKeyEnv ?? "OPENAI_API_KEY";
  const baseUrlEnv = manifest.defaultLlm?.baseUrlEnv ?? "OPENAI_BASE_URL";
  return `SERVICE_NAME=${serviceName}
DATABASE_URL=postgresql+psycopg2://agent:agent@localhost:5433/agent_runtime
REDIS_URL=redis://localhost:6380/0
REDIS_ENABLED=true
USE_POSTGRES_CHECKPOINTER=true
MOCK_LLM=true
${apiKeyEnv}=
OPENAI_MODEL=${model}
${baseUrlEnv}=
LLM_ADAPTER=${adapter}
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
COPY agents ./agents
COPY .runtime-manifest ./.runtime-manifest
COPY bundle.json ./bundle.json

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
`;
}

function renderDockerCompose(manifest: RuntimeManifest): string {
  const volumeName = `${slug(manifest.id).replace(/-/g, "_")}_postgres_data`;
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

function renderMain(manifest: RuntimeManifest, agents: PythonBundleAgent[]): string {
  const agentMetadata = agents.map((agent) => ({
    id: agent.id,
    flow_id: agent.flow.id,
    flow_name: agent.flow.name,
    flow_version: agent.flow.version,
    route_prefix: normalizeRoutePrefix(agent.routePrefix),
    runtime_dir: `agents/${safeSegment(agent.id)}`,
    resource_name: agent.flow.api.resourceName,
    contract: agent.flow.api.contract,
  }));

  return `import importlib
import importlib.util
import json
import logging
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


MANIFEST = json.loads(${pyJson({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    packaging: manifest.packaging,
  })})
AGENTS = json.loads(${pyJson(agentMetadata)})
PROJECT_ROOT = Path(__file__).resolve().parents[1]

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    logging.basicConfig(level="INFO")
    app = FastAPI(title=MANIFEST["name"])
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.manifest = MANIFEST
    app.state.agents = {}

    @app.get("/health")
    def health():
        return {
            "status": "ok",
            "manifest_id": MANIFEST["id"],
            "agents": [
                {
                    "id": agent["id"],
                    "route_prefix": agent["route_prefix"],
                    "mounted": agent["id"] in app.state.agents,
                }
                for agent in AGENTS
            ],
        }

    @app.get("/metadata")
    def metadata():
        return {
            "service": MANIFEST["name"],
            "runtime": "langgraph-fastapi-python",
            "contract": "sessions-v1",
            "manifest_id": MANIFEST["id"],
            "manifest_version": MANIFEST["version"],
            "packaging": MANIFEST["packaging"],
            "supports_multi_agent_bundle": True,
            "agents": AGENTS,
        }

    for agent in AGENTS:
        child_app = _load_agent_app(agent)
        app.mount(agent["route_prefix"], child_app)
        app.state.agents[agent["id"]] = child_app

    return app


def _load_agent_app(agent: dict[str, Any]) -> FastAPI:
    agent_root = PROJECT_ROOT / agent["runtime_dir"]
    if not agent_root.exists():
        raise RuntimeError(f"Runtime do agente não encontrado: {agent_root}")
    with _isolated_app_import(agent_root):
        module = importlib.import_module("app.main")
        child_app = module.create_app()
    child_app.title = agent["flow_name"]
    return child_app


@contextmanager
def _isolated_app_import(agent_root: Path) -> Iterator[None]:
    previous_path = list(sys.path)
    previous_modules = {
        name: module
        for name, module in sys.modules.items()
        if name == "app" or name.startswith("app.")
    }
    for name in list(previous_modules):
        sys.modules.pop(name, None)
    sys.path.insert(0, str(agent_root))
    importlib.invalidate_caches()
    try:
        yield
    finally:
        for name in [name for name in sys.modules if name == "app" or name.startswith("app.")]:
            sys.modules.pop(name, None)
        sys.modules.update(previous_modules)
        sys.path[:] = previous_path
        importlib.invalidate_caches()


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
`;
}

function renderMultiAgentTest(agents: PythonBundleAgent[]): string {
  const testAgents = agents.map((agent) => ({
    id: agent.id,
    route_prefix: normalizeRoutePrefix(agent.routePrefix),
    resource_name: agent.flow.api.resourceName,
  }));
  return `from fastapi.testclient import TestClient
import pytest

from tests.conftest import set_test_env


AGENTS = ${JSON.stringify(testAgents, null, 4)}


def _client(tmp_path):
    set_test_env(str(tmp_path / "multiagent.db"))
    from app.main import create_app

    return TestClient(create_app())


def _base(agent: dict) -> str:
    return f"{agent['route_prefix']}/{agent['resource_name']}"


def test_multiagent_bundle_metadata_and_mounted_routes(tmp_path):
    client = _client(tmp_path)

    metadata = client.get("/metadata")
    assert metadata.status_code == 200
    data = metadata.json()
    assert data["supports_multi_agent_bundle"] is True
    assert data["packaging"] == "multiagent"
    assert [agent["id"] for agent in data["agents"]] == [agent["id"] for agent in AGENTS]

    health = client.get("/health")
    assert health.status_code == 200
    assert all(agent["mounted"] for agent in health.json()["agents"])

    for agent in AGENTS:
        child_metadata = client.get(f"{agent['route_prefix']}/metadata")
        assert child_metadata.status_code == 200
        assert child_metadata.json()["flow_id"] == agent["id"]


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
    assert second_session_id != first_session_id

    first_start = client.post(
        f"{_base(first)}/{first_session_id}/start",
        headers={"Idempotency-Key": "shared-start"},
        json={},
    )
    assert first_start.status_code == 200

    second_start = client.post(
        f"{_base(second)}/{second_session_id}/start",
        headers={"Idempotency-Key": "shared-start"},
        json={},
    )
    assert second_start.status_code == 200
`;
}

function normalizeRoutePrefix(prefix: string): string {
  return prefix.replace(/\/+$/g, "") || "/";
}

function safeSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "");
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function pyJson(value: unknown): string {
  return JSON.stringify(JSON.stringify(value, null, 2));
}
