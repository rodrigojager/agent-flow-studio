import { findLlmAdapter, type AgentFlow, type RuntimeManifest } from "@agent-flow-builder/flow-spec";
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
    { relativePath: ".env.example", content: renderEnvExample(manifest, agents, serviceName) },
    { relativePath: "Dockerfile", content: renderDockerfile() },
    { relativePath: "docker-compose.yml", content: renderDockerCompose(manifest, agents) },
    ...(bundleUsesOllama(manifest, agents)
      ? [
          { relativePath: "docker-compose.gpu.yml", content: renderOllamaGpuComposeOverride() },
          { relativePath: "docker-compose.model-image.yml", content: renderOllamaModelImageComposeOverride(manifest, agents) },
          { relativePath: "ollama-models/Dockerfile", content: renderOllamaModelDockerfile() },
        ]
      : []),
    { relativePath: "app/__init__.py", content: "" },
    { relativePath: "app/main.py", content: renderMain(manifest, agents) },
    { relativePath: "app/worker.py", content: renderBundleWorker(agents) },
    { relativePath: "tests/conftest.py", content: renderTestConftest() },
    { relativePath: "tests/test_multiagent_bundle.py", content: renderMultiAgentTest(manifest, agents) },
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
markers = [
  "integration: testes opcionais que exigem infraestrutura externa, como Postgres real",
]

[tool.setuptools.packages.find]
include = ["app*"]
`;
}

function renderEnvExample(manifest: RuntimeManifest, agents: PythonBundleAgent[], serviceName: string): string {
  const adapter = manifest.defaultLlm?.adapter ?? "openai";
  const model = manifest.defaultLlm?.model ?? "gpt-4.1-mini";
  const adapterCatalogItem = findLlmAdapter(adapter);
  const apiKeyEnv = manifest.defaultLlm?.apiKeyEnv ?? adapterCatalogItem?.apiKeyEnv ?? "OPENAI_API_KEY";
  const baseUrlEnv = manifest.defaultLlm?.baseUrlEnv ?? adapterCatalogItem?.baseUrlEnv ?? "OPENAI_BASE_URL";
  const defaultApiKey = adapterCatalogItem?.defaultApiKey ?? "";
  const defaultBaseUrl = adapterCatalogItem?.defaultBaseUrl ?? "";
  const ollamaExtraEnv = bundleUsesOllama(manifest, agents) && adapter.toLowerCase() !== "ollama"
    ? `OLLAMA_API_KEY=ollama
OLLAMA_BASE_URL=http://localhost:11434/v1
`
    : "";
  const ollamaRuntimeEnv = bundleUsesOllama(manifest, agents)
    ? `OLLAMA_IMAGE=ollama/ollama:latest
OLLAMA_MODEL_IMAGE=${slug(manifest.id)}-ollama-models:local
OLLAMA_MODEL_NAMES=${bundleOllamaModelNames(manifest, agents)}
OLLAMA_KEEP_ALIVE=5m
OLLAMA_NUM_PARALLEL=1
OLLAMA_MAX_LOADED_MODELS=1
OLLAMA_MAX_QUEUE=512
OLLAMA_CONTEXT_LENGTH=4096
OLLAMA_GPU_COUNT=1
`
    : "";
  return `SERVICE_NAME=${serviceName}
DATABASE_URL=postgresql+psycopg2://agent:agent@localhost:5433/agent_runtime
REDIS_URL=redis://localhost:6380/0
REDIS_ENABLED=true
USE_POSTGRES_CHECKPOINTER=true
MOCK_LLM=true
${apiKeyEnv}=${defaultApiKey}
LLM_MODEL=${model}
${baseUrlEnv}=${defaultBaseUrl}
${ollamaExtraEnv}${ollamaRuntimeEnv}LLM_ADAPTER=${adapter}
LLM_MAX_RETRIES=2
AUTH_ENABLED=false
AGENT_API_KEY=
AGENT_API_KEYS=
AGENT_API_KEYS_PATH=
AGENT_API_REVOKED_KEY_IDS=
AGENT_API_REVOKED_KEY_IDS_PATH=
AUTH_RATE_LIMIT_ENABLED=false
AUTH_RATE_LIMIT_REQUESTS=60
AUTH_RATE_LIMIT_WINDOW_SECONDS=60
AUTH_AUDIT_ENABLED=true
AUTH_AUDIT_MAX_ENTRIES=200
AUTH_AUDIT_PATH=
SAFETY_PROVIDER_ENABLED=false
SAFETY_PROVIDER_URL=
SAFETY_PROVIDER_TIMEOUT_SECONDS=3
SAFETY_PROVIDER_FAIL_CLOSED=false
SAFETY_PROVIDER_HEADERS_JSON=
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

function renderDockerCompose(manifest: RuntimeManifest, agents: PythonBundleAgent[]): string {
  const volumeName = `${slug(manifest.id).replace(/-/g, "_")}_postgres_data`;
  const usesOllama = bundleUsesOllama(manifest, agents);
  const ollamaEnvName = bundleOllamaBaseUrlEnv(manifest, agents);
  const ollamaServices = usesOllama
    ? `\n${ollamaComposeService()}${ollamaPullComposeServices(bundleOllamaModels(manifest, agents))}`
    : "";
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
${ollamaServices}

  api:
    build: .
    env_file:
      - path: .env
        required: false
    environment:
      DATABASE_URL: postgresql+psycopg2://agent:agent@postgres:5432/agent_runtime
      REDIS_URL: redis://redis:6379/0
      REDIS_ENABLED: "true"
      USE_POSTGRES_CHECKPOINTER: "true"
      AUTO_CREATE_TABLES: "true"
      MOCK_LLM: \${MOCK_LLM:-true}${usesOllama ? `\n      ${ollamaEnvName}: \${${ollamaEnvName}:-http://ollama:11434/v1}` : ""}
    ports:
      - "8080:8080"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started${usesOllama ? `\n      ollama:\n        condition: service_healthy` : ""}

  worker:
    build: .
    env_file:
      - path: .env
        required: false
    command: ["python", "-m", "app.worker"]
    environment:
      DATABASE_URL: postgresql+psycopg2://agent:agent@postgres:5432/agent_runtime
      REDIS_URL: redis://redis:6379/0
      REDIS_ENABLED: "true"
      USE_POSTGRES_CHECKPOINTER: "true"
      AUTO_CREATE_TABLES: "true"
      MOCK_LLM: \${MOCK_LLM:-true}${usesOllama ? `\n      ${ollamaEnvName}: \${${ollamaEnvName}:-http://ollama:11434/v1}` : ""}
      WORKER_INTERVAL_SECONDS: \${WORKER_INTERVAL_SECONDS:-5}
      WORKER_LIMIT: \${WORKER_LIMIT:-20}
      WORKER_RETRY_DELAY_SECONDS: \${WORKER_RETRY_DELAY_SECONDS:-5}
      WORKER_LEASE_SECONDS: \${WORKER_LEASE_SECONDS:-60}
      WORKER_CLEANUP_ENABLED: \${WORKER_CLEANUP_ENABLED:-false}
      WORKER_CLEANUP_OLDER_THAN_HOURS: \${WORKER_CLEANUP_OLDER_THAN_HOURS:-168}
      WORKER_CLEANUP_LIMIT: \${WORKER_CLEANUP_LIMIT:-100}
      WORKER_CLEANUP_STATUSES: \${WORKER_CLEANUP_STATUSES:-succeeded,failed}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started${usesOllama ? `\n      ollama:\n        condition: service_healthy` : ""}

volumes:
  ${volumeName}:${usesOllama ? "\n  ollama_models:" : ""}
`;
}

function bundleUsesOllama(manifest: RuntimeManifest, agents: PythonBundleAgent[]): boolean {
  if (manifest.defaultLlm?.adapter?.toLowerCase() === "ollama") {
    return true;
  }
  return agents.some((agent) => flowUsesOllama(agent.flow));
}

function flowUsesOllama(flow: AgentFlow): boolean {
  return (
    flow.llm.adapter.toLowerCase() === "ollama" ||
    flow.nodes.some((node) => typeof node.llm?.adapter === "string" && node.llm.adapter.toLowerCase() === "ollama")
  );
}

function bundleOllamaBaseUrlEnv(manifest: RuntimeManifest, agents: PythonBundleAgent[]): string {
  if (manifest.defaultLlm?.adapter?.toLowerCase() === "ollama") {
    return manifest.defaultLlm.baseUrlEnv ?? findLlmAdapter("ollama")?.baseUrlEnv ?? "OLLAMA_BASE_URL";
  }
  const agentFlow = agents.find((agent) => flowUsesOllama(agent.flow))?.flow;
  return agentFlow ? ollamaBaseUrlEnvForFlow(agentFlow) : findLlmAdapter("ollama")?.baseUrlEnv ?? "OLLAMA_BASE_URL";
}

function bundleOllamaModels(manifest: RuntimeManifest, agents: PythonBundleAgent[]): string[] {
  const models: string[] = [];
  const push = (model: string | undefined) => {
    const value = model?.trim() || "qwen3:8b";
    if (!models.includes(value)) {
      models.push(value);
    }
  };
  if (manifest.defaultLlm?.adapter?.toLowerCase() === "ollama") {
    push(manifest.defaultLlm.model);
  }
  for (const agent of agents) {
    for (const model of ollamaModelsForFlow(agent.flow)) {
      push(model);
    }
  }
  return models.length ? models : ["qwen3:8b"];
}

function ollamaLlmConfigForFlow(
  flow: AgentFlow,
): AgentFlow["llm"] | NonNullable<AgentFlow["nodes"][number]["llm"]> | undefined {
  if (flow.llm.adapter.toLowerCase() === "ollama") {
    return flow.llm;
  }
  return flow.nodes.find((node) => node.llm?.adapter?.toLowerCase() === "ollama")?.llm;
}

function ollamaBaseUrlEnvForFlow(flow: AgentFlow): string {
  return ollamaLlmConfigForFlow(flow)?.baseUrlEnv ?? findLlmAdapter("ollama")?.baseUrlEnv ?? "OLLAMA_BASE_URL";
}

function ollamaModelsForFlow(flow: AgentFlow): string[] {
  const models: string[] = [];
  const push = (model: string | undefined) => {
    const value = model?.trim() || "qwen3:8b";
    if (!models.includes(value)) {
      models.push(value);
    }
  };
  if (flow.llm.adapter.toLowerCase() === "ollama") {
    push(flow.llm.model);
  }
  for (const node of flow.nodes) {
    if (node.llm?.adapter?.toLowerCase() === "ollama") {
      push(node.llm.model);
    }
  }
  return models;
}

function ollamaComposeService(): string {
  return `  ollama:
    image: \${OLLAMA_IMAGE:-ollama/ollama:latest}
    ports:
      - "11434:11434"
    environment:
      OLLAMA_KEEP_ALIVE: \${OLLAMA_KEEP_ALIVE:-5m}
      OLLAMA_NUM_PARALLEL: \${OLLAMA_NUM_PARALLEL:-1}
      OLLAMA_MAX_LOADED_MODELS: \${OLLAMA_MAX_LOADED_MODELS:-1}
      OLLAMA_MAX_QUEUE: \${OLLAMA_MAX_QUEUE:-512}
      OLLAMA_CONTEXT_LENGTH: \${OLLAMA_CONTEXT_LENGTH:-4096}
    volumes:
      - ollama_models:/root/.ollama
    healthcheck:
      test: ["CMD", "ollama", "list"]
      interval: 10s
      timeout: 5s
      retries: 12
`;
}

function ollamaPullServiceName(model: string, index: number): string {
  return slug(`ollama-pull-${model}`) || `ollama-pull-${index + 1}`;
}

function ollamaPullComposeServices(models: string[]): string {
  return models
    .map(
      (model, index) => `  ${ollamaPullServiceName(model, index)}:
    image: \${OLLAMA_IMAGE:-ollama/ollama:latest}
    profiles:
      - model-setup
    environment:
      OLLAMA_HOST: http://ollama:11434
    entrypoint: ["ollama"]
    command: ["pull", "${model}"]
    depends_on:
      ollama:
        condition: service_healthy
    restart: "no"
`,
    )
    .join("");
}

function bundleOllamaModelNames(manifest: RuntimeManifest, agents: PythonBundleAgent[]): string {
  return bundleOllamaModels(manifest, agents).join(" ");
}

function renderOllamaGpuComposeOverride(): string {
  return `services:
  ollama:
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: \${OLLAMA_GPU_COUNT:-1}
              capabilities: [gpu]
`;
}

function renderOllamaModelImageComposeOverride(manifest: RuntimeManifest, agents: PythonBundleAgent[]): string {
  return `services:
  ollama:
    build:
      context: .
      dockerfile: ollama-models/Dockerfile
      args:
        OLLAMA_MODEL_NAMES: \${OLLAMA_MODEL_NAMES:-${bundleOllamaModelNames(manifest, agents)}}
    image: \${OLLAMA_MODEL_IMAGE:-${slug(manifest.id)}-ollama-models:local}
`;
}

function renderOllamaModelDockerfile(): string {
  return `FROM ollama/ollama:latest

ARG OLLAMA_MODEL_NAMES=""
ENV OLLAMA_MODELS=/models

RUN set -eux; \\
    mkdir -p "$OLLAMA_MODELS"; \\
    ollama serve >/tmp/ollama-preload.log 2>&1 & \\
    pid="$!"; \\
    ready=0; \\
    i=0; \\
    while [ "$i" -lt 60 ]; do \\
      if ollama list >/dev/null 2>&1; then ready=1; break; fi; \\
      i=$((i + 1)); \\
      sleep 1; \\
    done; \\
    if [ "$ready" -ne 1 ]; then cat /tmp/ollama-preload.log; exit 1; fi; \\
    for model in $OLLAMA_MODEL_NAMES; do \\
      ollama pull "$model"; \\
    done; \\
    kill "$pid"; \\
    wait "$pid" || true
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
  const sharedStorage = {
    database: {
      scope: "bundle",
      mode: "single-database",
      env: "DATABASE_URL",
      dockerService: "postgres",
      recommendedDriver: "postgresql+psycopg2",
      tablesAreNamespacedBy: "agent_id",
    },
    checkpointer: {
      scope: "bundle",
      env: "USE_POSTGRES_CHECKPOINTER",
      dockerService: "postgres",
    },
    cache: {
      scope: "bundle",
      env: "REDIS_URL",
      dockerService: "redis",
    },
  };
  const agentIsolation = {
    format: "agent-flow-builder.runtime-agent-isolation.v1",
    manifestId: manifest.id,
    manifestVersion: manifest.version,
    packaging: manifest.packaging,
    routeIsolation: {
      required: true,
      uniqueRoutePrefixes: true,
      prefixOwnsOpenApiSubtree: true,
      rootMetadataOnlyAt: "/metadata",
    },
    runtimeImportIsolation: {
      mode: "isolated-python-app-namespace",
      clearsModulePrefixes: ["app", "app.*"],
      restoresPreviousModules: true,
      restoresSysPath: true,
    },
    requestIsolation: {
      idempotencyNamespace: "route_prefix",
      sessionNamespace: "agent_id",
      eventNamespace: "agent_id",
      jobNamespace: "agent_id",
    },
    authIsolation: {
      scopeNamespace: "agents:<agent_id>",
      examples: [
        "agents:<agent_id>:metadata:read",
        "agents:<agent_id>:sessions:*",
        "agents:<agent_id>:jobs:*",
        "agents:<agent_id>:auth:read",
      ],
    },
    sharedStorage,
    agents: agentMetadata.map((agent) => ({
      id: agent.id,
      routePrefix: agent.route_prefix,
      runtimeDir: agent.runtime_dir,
      resourceName: agent.resource_name,
      metadataPath: `${agent.route_prefix}/metadata`,
      sessionsPath: `${agent.route_prefix}/${agent.resource_name}`,
      storageNamespaceField: "agent_id",
    })),
    governance: {
      excludesSecrets: true,
      excludesEnvValues: true,
      excludesRuntimePayloads: true,
      generatedFromManifest: true,
    },
  };
  const memoryPolicy = normalizeOrchestrationMemoryPolicy(manifest.orchestration?.memoryPolicy);
  const orchestration = {
    format: "agent-flow-builder.runtime-orchestration.v1",
    manifestId: manifest.id,
    manifestVersion: manifest.version,
    mode: manifest.orchestration?.mode ?? "router",
    capabilities: {
      executableRun: true,
      debugTrace: true,
      structuredConditions: true,
      optionalJsonlMemory: true,
      persistentMemoryPolicy: true,
    },
    memoryPolicy,
    entryAgentId:
      manifest.orchestration?.entryAgentId && agentMetadata.some((agent) => agent.id === manifest.orchestration?.entryAgentId)
        ? manifest.orchestration.entryAgentId
        : agentMetadata[0]?.id,
    handoffs: (manifest.orchestration?.handoffs ?? [])
      .filter(
        (handoff) =>
          agentMetadata.some((agent) => agent.id === handoff.fromAgentId) &&
          agentMetadata.some((agent) => agent.id === handoff.toAgentId) &&
          handoff.fromAgentId !== handoff.toAgentId,
      )
      .map((handoff) => ({
        fromAgentId: handoff.fromAgentId,
        toAgentId: handoff.toAgentId,
        condition: handoff.condition?.trim() || "handoff definido no runtime.manifest.json",
      })),
    agents: agentMetadata.map((agent) => ({
      id: agent.id,
      routePrefix: agent.route_prefix,
      resourceName: agent.resource_name,
      metadataPath: `${agent.route_prefix}/metadata`,
      sessionsPath: `${agent.route_prefix}/${agent.resource_name}`,
    })),
    governance: {
      declarativeOnly: true,
      generatedFromManifest: true,
      excludesSecrets: true,
      excludesEnvValues: true,
      excludesRuntimePayloads: true,
    },
  };

  return `import importlib
import importlib.util
import json
import logging
import os
import sys
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient


MANIFEST = json.loads(${pyJson({
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    packaging: manifest.packaging,
    orchestration,
  })})
AGENTS = json.loads(${pyJson(agentMetadata)})
SHARED_STORAGE = json.loads(${pyJson(sharedStorage)})
AGENT_ISOLATION = json.loads(${pyJson(agentIsolation)})
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
            "shared_storage": {
                "database_env": SHARED_STORAGE["database"]["env"],
                "database_configured": bool(os.getenv(SHARED_STORAGE["database"]["env"])),
                "checkpointer_enabled": os.getenv(SHARED_STORAGE["checkpointer"]["env"], "").lower() == "true",
                "cache_configured": bool(os.getenv(SHARED_STORAGE["cache"]["env"])),
            },
            "agent_isolation": {
                "route_prefix_unique": AGENT_ISOLATION["routeIsolation"]["uniqueRoutePrefixes"],
                "idempotency_namespace": AGENT_ISOLATION["requestIsolation"]["idempotencyNamespace"],
                "storage_namespace": AGENT_ISOLATION["requestIsolation"]["sessionNamespace"],
                "runtime_import_mode": AGENT_ISOLATION["runtimeImportIsolation"]["mode"],
            },
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
            "shared_storage": SHARED_STORAGE,
            "orchestration": MANIFEST["orchestration"],
            "agent_isolation": AGENT_ISOLATION,
            "agents": AGENTS,
        }

    @app.post("/orchestration/run")
    def run_orchestration(payload: dict[str, Any]):
        plan = _build_orchestration_plan(payload)
        steps = []
        shared_memory = _new_orchestration_memory(plan)
        debug_trace = _new_orchestration_debug_trace(plan)
        queue = list(plan["steps"])
        visited = set()
        status = "completed"
        error = None
        try:
            while queue:
                planned_step = queue.pop(0)
                step_index = len(steps)
                agent = _agent_by_id(planned_step["agent_id"])
                _record_orchestration_trace_event(
                    debug_trace,
                    "step_started",
                    status="running",
                    step_index=step_index,
                    agent_id=agent["id"],
                    route_prefix=agent["route_prefix"],
                    handoff_condition=planned_step.get("condition"),
                    queue_remaining=len(queue),
                )
                child_app = app.state.agents.get(agent["id"])
                if child_app is None:
                    raise RuntimeError(f"Agente não montado: {agent['id']}")
                step = _execute_agent_step(
                    child_app=child_app,
                    agent=agent,
                    message=plan["user_message"],
                    metadata=plan["metadata"],
                    max_turns=plan["max_turns"],
                    step_index=step_index,
                    handoff_condition=planned_step.get("condition"),
                    shared_memory=shared_memory,
                )
                steps.append(step)
                _append_orchestration_memory(shared_memory, step, step_index, plan)
                _record_orchestration_step_completed(debug_trace, step, step_index, shared_memory)
                visited.add(agent["id"])
                if plan["explicit_steps"]:
                    continue
                for decision in _handoff_decisions(agent["id"], plan, shared_memory):
                    if plan["memory_policy"].get("includeHandoffDecisions") is not False:
                        shared_memory["decisions"].append(decision)
                    _record_orchestration_decision_trace(debug_trace, decision, step_index, len(queue))
                    if decision["matched"] and decision["to_agent_id"] not in visited:
                        queue.append(
                            {
                                "agent_id": decision["to_agent_id"],
                                "condition": decision["condition"],
                                "decision": decision,
                            }
                        )
                        _record_orchestration_trace_event(
                            debug_trace,
                            "handoff_enqueued",
                            status="queued",
                            step_index=step_index,
                            agent_id=decision["from_agent_id"],
                            to_agent_id=decision["to_agent_id"],
                            condition=decision["condition"],
                            queue_size=len(queue),
                        )
        except Exception as exc:
            status = "failed"
            error = {
                "message": _sanitize_orchestration_error(exc),
                "step_index": len(steps),
            }
            _record_orchestration_trace_event(
                debug_trace,
                "orchestration_failed",
                status="error",
                step_index=len(steps),
                error=error["message"],
            )
        _finish_orchestration_debug_trace(debug_trace, status, steps, shared_memory)
        shared_memory["persistence"] = _persist_orchestration_memory(plan, shared_memory, steps, debug_trace)
        safe_steps = _redact_orchestration_value(steps, plan["memory_policy"])
        safe_shared_memory = _redact_orchestration_value(shared_memory, plan["memory_policy"])
        safe_debug_trace = _redact_orchestration_value(debug_trace, plan["memory_policy"])
        response = {
            "format": "agent-flow-builder.runtime-orchestration-run.v1",
            "manifest_id": MANIFEST["id"],
            "manifest_version": MANIFEST["version"],
            "mode": MANIFEST["orchestration"]["mode"],
            "entry_agent_id": plan["entry_agent_id"],
            "status": status,
            "steps": safe_steps,
            "shared_memory": safe_shared_memory,
            "debug_trace": safe_debug_trace,
            "governance": {
                "executedInProcess": True,
                "usedMountedAgents": True,
                "excludesSecrets": True,
                "excludesEnvValues": True,
                "sharedMemoryPreviewOnly": True,
                "persistentMemorySupported": True,
                "debugTracePreviewOnly": True,
            },
        }
        if error:
            response["error"] = error
        return response

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


def _build_orchestration_plan(payload: dict[str, Any]) -> dict[str, Any]:
    user_message = _orchestration_user_message(payload)
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    max_turns = int(payload.get("max_turns") or 3)
    input_payload = payload.get("input") if isinstance(payload.get("input"), dict) else {}
    orchestration = MANIFEST["orchestration"]
    memory_policy = _orchestration_memory_policy()
    entry_agent_id = orchestration.get("entryAgentId") or (AGENTS[0]["id"] if AGENTS else "")
    requested_agent_ids = payload.get("agent_ids") if isinstance(payload.get("agent_ids"), list) else []
    if requested_agent_ids:
        steps = [{"agent_id": agent_id, "condition": "solicitado no payload"} for agent_id in requested_agent_ids]
    else:
        steps = _default_orchestration_steps(entry_agent_id, orchestration)
    return {
        "entry_agent_id": entry_agent_id,
        "user_message": user_message,
        "metadata": metadata,
        "max_turns": max_turns,
        "input_payload": {
            **input_payload,
            "user_message": user_message,
            "metadata": metadata,
            "max_turns": max_turns,
        },
        "run_id": str(payload.get("run_id") or f"orch_{uuid.uuid4().hex}"),
        "memory_path": _orchestration_memory_path(payload, memory_policy),
        "memory_policy": memory_policy,
        "steps": steps,
        "explicit_steps": bool(requested_agent_ids),
        "orchestration": orchestration,
    }


def _orchestration_user_message(payload: dict[str, Any]) -> str:
    if isinstance(payload.get("user_message"), str) and payload["user_message"].strip():
        return payload["user_message"].strip()
    input_payload = payload.get("input")
    if isinstance(input_payload, dict) and isinstance(input_payload.get("user_message"), str) and input_payload["user_message"].strip():
        return input_payload["user_message"].strip()
    if isinstance(input_payload, str) and input_payload.strip():
        return input_payload.strip()
    return "Executar orquestração multiagente."


def _default_orchestration_steps(entry_agent_id: str, orchestration: dict[str, Any]) -> list[dict[str, str]]:
    if not entry_agent_id:
        return []
    has_handoffs = any(
        handoff.get("fromAgentId") == entry_agent_id and handoff.get("toAgentId")
        for handoff in orchestration.get("handoffs", [])
    )
    if not has_handoffs and orchestration.get("mode") == "sequential":
        agent_ids = [agent["id"] for agent in AGENTS]
        return [{"agent_id": agent_id, "condition": "sequência declarada"} for agent_id in agent_ids]
    return [{"agent_id": entry_agent_id, "condition": "entrada"}]


def _new_orchestration_memory(plan: dict[str, Any]) -> dict[str, Any]:
    policy = plan.get("memory_policy") if isinstance(plan.get("memory_policy"), dict) else _orchestration_memory_policy()
    max_preview_chars = int(policy.get("maxPreviewChars") or 500)
    return {
        "format": "agent-flow-builder.runtime-orchestration-memory.v1",
        "run_id": plan["run_id"],
        "entry_agent_id": plan["entry_agent_id"],
        "entries": [],
        "decisions": [],
        "policy": _orchestration_memory_policy_summary(policy, bool(plan.get("memory_path"))),
        "governance": {
            "previewOnly": True,
            "maxPreviewChars": max_preview_chars,
            "excludesSecrets": True,
            "excludesEnvValues": True,
            "persistentJsonl": bool(plan.get("memory_path")),
            "maxEntries": int(policy.get("maxEntries") or 64),
            "retentionRuns": int(policy.get("retentionRuns") or 50),
            "redactKeysConfigured": len(policy.get("redactKeys") or []),
        },
    }


def _new_orchestration_debug_trace(plan: dict[str, Any]) -> dict[str, Any]:
    policy = plan.get("memory_policy") if isinstance(plan.get("memory_policy"), dict) else _orchestration_memory_policy()
    trace = {
        "format": "agent-flow-builder.runtime-orchestration-debug-trace.v1",
        "run_id": plan["run_id"],
        "manifest_id": MANIFEST["id"],
        "manifest_version": MANIFEST["version"],
        "mode": MANIFEST["orchestration"]["mode"],
        "entry_agent_id": plan["entry_agent_id"],
        "started_at": datetime.now(timezone.utc).isoformat(),
        "finished_at": None,
        "input": _orchestration_input_summary(plan),
        "timeline": [],
        "summary": {},
        "governance": {
            "previewOnly": True,
            "maxPreviewChars": int(policy.get("maxPreviewChars") or 500),
            "excludesSecrets": True,
            "excludesEnvValues": True,
            "excludesRuntimePayloads": True,
            "safeForStudioTimeline": True,
            "memoryPolicy": _orchestration_memory_policy_summary(policy, bool(plan.get("memory_path"))),
        },
    }
    _record_orchestration_trace_event(
        trace,
        "plan_created",
        status="planned",
        entry_agent_id=plan["entry_agent_id"],
        explicit_steps=plan["explicit_steps"],
        planned_step_count=len(plan["steps"]),
        handoff_count=len(plan["orchestration"].get("handoffs", [])),
    )
    return trace


def _orchestration_input_summary(plan: dict[str, Any]) -> dict[str, Any]:
    input_payload = plan.get("input_payload") if isinstance(plan.get("input_payload"), dict) else {}
    metadata = plan.get("metadata") if isinstance(plan.get("metadata"), dict) else {}
    return {
        "user_message_preview": _truncate_preview(str(plan.get("user_message") or ""), 180),
        "input_keys": sorted([key for key in input_payload.keys() if key not in {"user_message", "metadata"}]),
        "metadata_keys": sorted(metadata.keys()),
        "max_turns": plan.get("max_turns"),
        "explicit_agent_plan": bool(plan.get("explicit_steps")),
    }


def _record_orchestration_trace_event(trace: dict[str, Any], event_type: str, status: str = "info", **fields: Any) -> None:
    event = {
        "seq": len(trace["timeline"]) + 1,
        "at": datetime.now(timezone.utc).isoformat(),
        "type": event_type,
        "status": status,
    }
    for key, value in fields.items():
        if value is None or value == "":
            continue
        event[key] = value
    trace["timeline"].append(event)


def _record_orchestration_step_completed(
    trace: dict[str, Any],
    step: dict[str, Any],
    step_index: int,
    shared_memory: dict[str, Any],
) -> None:
    turn = step.get("turn") if isinstance(step.get("turn"), dict) else {}
    session = turn.get("session") if isinstance(turn.get("session"), dict) else {}
    assistant = turn.get("assistant_message") if isinstance(turn.get("assistant_message"), dict) else {}
    _record_orchestration_trace_event(
        trace,
        "step_completed",
        status=str(session.get("status") or "completed"),
        step_index=step_index,
        agent_id=step.get("agent_id"),
        route_prefix=step.get("route_prefix"),
        session_id=step.get("session_id"),
        handoff_condition=step.get("handoff_condition"),
        output_code=assistant.get("code"),
        output_preview=_truncate_preview(_extract_turn_output_text(turn)),
        memory_entries=len(shared_memory.get("entries", [])),
    )


def _record_orchestration_decision_trace(
    trace: dict[str, Any],
    decision: dict[str, Any],
    step_index: int,
    queue_size: int,
) -> None:
    _record_orchestration_trace_event(
        trace,
        "handoff_decision",
        status="matched" if decision.get("matched") else "skipped",
        step_index=step_index,
        agent_id=decision.get("from_agent_id"),
        to_agent_id=decision.get("to_agent_id"),
        condition=decision.get("condition"),
        matched=bool(decision.get("matched")),
        reason=decision.get("reason"),
        queue_size=queue_size,
    )


def _finish_orchestration_debug_trace(
    trace: dict[str, Any],
    status: str,
    steps: list[dict[str, Any]],
    shared_memory: dict[str, Any],
) -> None:
    trace["finished_at"] = datetime.now(timezone.utc).isoformat()
    trace["summary"] = {
        "status": status,
        "step_count": len(steps),
        "agent_ids": [step.get("agent_id") for step in steps],
        "memory_entries": len(shared_memory.get("entries", [])),
        "handoff_decisions": len(shared_memory.get("decisions", [])),
        "matched_handoffs": len([decision for decision in shared_memory.get("decisions", []) if decision.get("matched")]),
        "timeline_events": len(trace.get("timeline", [])),
    }


def _append_orchestration_memory(shared_memory: dict[str, Any], step: dict[str, Any], step_index: int, plan: dict[str, Any]) -> None:
    policy = plan.get("memory_policy") if isinstance(plan.get("memory_policy"), dict) else _orchestration_memory_policy()
    turn = step.get("turn", {}) if isinstance(step.get("turn"), dict) else {}
    assistant = turn.get("assistant_message") if isinstance(turn.get("assistant_message"), dict) else {}
    session = turn.get("session") if isinstance(turn.get("session"), dict) else {}
    max_preview_chars = int(policy.get("maxPreviewChars") or 500)
    entry = {
        "step_index": step_index,
        "agent_id": step["agent_id"],
        "session_id": step["session_id"],
        "status": session.get("status"),
        "output_preview": _truncate_preview(_extract_turn_output_text(turn), max_preview_chars),
    }
    if policy.get("includeStepOutputs") is not False:
        entry["output"] = {
            "assistant_message": {
                "code": assistant.get("code"),
                "text_preview": _truncate_preview(str(assistant.get("text") or assistant.get("content") or ""), max_preview_chars),
            },
            "session": {
                "agent_id": session.get("agent_id"),
                "status": session.get("status"),
                "turn": session.get("turn"),
            },
        }
    shared_memory["entries"].append(entry)
    max_entries = max(1, int(policy.get("maxEntries") or 64))
    if len(shared_memory["entries"]) > max_entries:
        shared_memory["entries"] = shared_memory["entries"][-max_entries:]


def _shared_memory_context(shared_memory: dict[str, Any]) -> dict[str, Any]:
    return {
        "format": shared_memory["format"],
        "entries": shared_memory["entries"],
        "decisions": shared_memory["decisions"],
        "policy": shared_memory.get("policy", {}),
        "governance": shared_memory["governance"],
    }


def _handoff_decisions(current_agent_id: str, plan: dict[str, Any], shared_memory: dict[str, Any]) -> list[dict[str, Any]]:
    decisions = []
    for handoff in plan["orchestration"].get("handoffs", []):
        if handoff.get("fromAgentId") != current_agent_id or not handoff.get("toAgentId"):
            continue
        matched, reason = _handoff_matches(handoff.get("condition") or "", plan, shared_memory)
        decisions.append(
            {
                "from_agent_id": current_agent_id,
                "to_agent_id": handoff["toAgentId"],
                "condition": handoff.get("condition") or "",
                "matched": matched,
                "reason": reason,
            }
        )
    return decisions


def _handoff_matches(condition: str, plan: dict[str, Any], shared_memory: dict[str, Any]) -> tuple[bool, str]:
    normalized = condition.strip()
    if not normalized:
        return True, "handoff sem condição executa por padrão"
    lowered = normalized.lower()
    if lowered in {"always", "true", "sempre"}:
        return True, "condição always"
    operators = [
        ("input not contains:", plan["user_message"], False),
        ("input contains:", plan["user_message"], True),
        ("output not contains:", _last_output_text(shared_memory), False),
        ("output contains:", _last_output_text(shared_memory), True),
        ("last_output not contains:", _last_output_text(shared_memory), False),
        ("last_output contains:", _last_output_text(shared_memory), True),
        ("assistant not contains:", _last_output_text(shared_memory), False),
        ("assistant contains:", _last_output_text(shared_memory), True),
    ]
    for prefix, haystack, expected in operators:
        if lowered.startswith(prefix):
            needle = normalized[len(prefix):].strip().lower()
            contains = needle in haystack.lower() if needle else True
            return contains is expected, f"{prefix} {'match' if contains else 'no_match'}"
    structured = _structured_handoff_match(normalized, plan, shared_memory)
    if structured is not None:
        return structured
    return True, "condição textual tratada como anotação declarativa"


def _structured_handoff_match(condition: str, plan: dict[str, Any], shared_memory: dict[str, Any]) -> tuple[bool, str] | None:
    for operator in [" not contains ", " contains ", " != ", " == "]:
        index = condition.lower().find(operator)
        if index < 0:
            continue
        left = condition[:index].strip()
        right = condition[index + len(operator):].strip()
        if not left.startswith(("input.", "output.", "memory.")):
            return None
        value = _resolve_condition_path(left, plan, shared_memory)
        expected = _parse_condition_literal(right)
        if operator == " == ":
            matched = _condition_values_equal(value, expected)
        elif operator == " != ":
            matched = not _condition_values_equal(value, expected)
        elif operator == " contains ":
            matched = str(expected).lower() in str(value or "").lower()
        else:
            matched = str(expected).lower() not in str(value or "").lower()
        return matched, f"{left}{operator.strip()} {'match' if matched else 'no_match'}"
    return None


def _resolve_condition_path(path_expression: str, plan: dict[str, Any], shared_memory: dict[str, Any]) -> Any:
    root_name, _, path = path_expression.partition(".")
    if root_name == "input":
        value: Any = plan.get("input_payload", {})
    elif root_name == "output":
        value = _last_output_structured(shared_memory)
    elif root_name == "memory":
        value = shared_memory
    else:
        return None
    for part in [item for item in path.split(".") if item]:
        if isinstance(value, list):
            try:
                value = value[int(part)]
            except (ValueError, IndexError):
                return None
            continue
        if isinstance(value, dict):
            value = value.get(part)
            continue
        return None
    return value


def _parse_condition_literal(raw: str) -> Any:
    value = raw.strip()
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        return value[1:-1]
    try:
        return json.loads(value)
    except Exception:
        return value


def _condition_values_equal(left: Any, right: Any) -> bool:
    if isinstance(left, (int, float, bool)) or isinstance(right, (int, float, bool)):
        return left == right
    return str(left) == str(right)


def _last_output_text(shared_memory: dict[str, Any]) -> str:
    entries = shared_memory.get("entries") or []
    if not entries:
        return ""
    return str(entries[-1].get("output_preview") or "")


def _last_output_structured(shared_memory: dict[str, Any]) -> dict[str, Any]:
    entries = shared_memory.get("entries") or []
    if not entries:
        return {}
    output = entries[-1].get("output")
    return output if isinstance(output, dict) else {}


def _extract_turn_output_text(turn: dict[str, Any]) -> str:
    assistant = turn.get("assistant_message") if isinstance(turn, dict) else None
    if isinstance(assistant, dict):
        return str(assistant.get("text") or assistant.get("content") or "")
    return ""


def _truncate_preview(value: str, limit: int = 500) -> str:
    text = value.strip()
    return text if len(text) <= limit else f"{text[:limit]}..."


def _sanitize_orchestration_error(error: Exception) -> str:
    text = str(error).replace(str(PROJECT_ROOT), "<project_root>")
    return _truncate_preview(text, 500)


def _orchestration_memory_policy() -> dict[str, Any]:
    raw = MANIFEST.get("orchestration", {}).get("memoryPolicy")
    policy = raw if isinstance(raw, dict) else {}
    redact_keys = policy.get("redactKeys") if isinstance(policy.get("redactKeys"), list) else []
    normalized_redact_keys = [str(key).strip().lower() for key in redact_keys if str(key).strip()]
    if not normalized_redact_keys:
        normalized_redact_keys = ["api_key", "authorization", "password", "secret", "token"]
    persistence = str(policy.get("persistence") or "optional_jsonl")
    if persistence not in {"disabled", "optional_jsonl", "always_jsonl"}:
        persistence = "optional_jsonl"
    return {
        "enabled": policy.get("enabled") is not False,
        "persistence": persistence,
        "defaultPersist": bool(policy.get("defaultPersist")),
        "defaultMemoryPath": str(policy.get("defaultMemoryPath") or "").strip(),
        "maxEntries": max(1, int(policy.get("maxEntries") or 64)),
        "retentionRuns": max(1, int(policy.get("retentionRuns") or 50)),
        "maxPreviewChars": max(80, int(policy.get("maxPreviewChars") or 500)),
        "redactKeys": normalized_redact_keys,
        "includeStepOutputs": policy.get("includeStepOutputs") is not False,
        "includeHandoffDecisions": policy.get("includeHandoffDecisions") is not False,
    }


def _orchestration_memory_policy_summary(policy: dict[str, Any], persistence_active: bool) -> dict[str, Any]:
    return {
        "enabled": bool(policy.get("enabled")),
        "persistence": policy.get("persistence"),
        "persistence_active": persistence_active,
        "default_persist": bool(policy.get("defaultPersist")),
        "default_memory_path_configured": bool(policy.get("defaultMemoryPath")),
        "max_entries": int(policy.get("maxEntries") or 64),
        "retention_runs": int(policy.get("retentionRuns") or 50),
        "max_preview_chars": int(policy.get("maxPreviewChars") or 500),
        "redact_key_count": len(policy.get("redactKeys") or []),
        "include_step_outputs": policy.get("includeStepOutputs") is not False,
        "include_handoff_decisions": policy.get("includeHandoffDecisions") is not False,
    }


def _orchestration_memory_path(payload: dict[str, Any], policy: dict[str, Any]) -> str:
    if not policy.get("enabled") or policy.get("persistence") == "disabled":
        return ""
    if payload.get("persist_memory") is False:
        return ""
    path = payload.get("memory_path") or os.getenv("ORCHESTRATION_MEMORY_PATH", "") or policy.get("defaultMemoryPath", "")
    if path:
        return str(path)
    should_persist = (
        payload.get("persist_memory") is True
        or policy.get("persistence") == "always_jsonl"
        or (payload.get("persist_memory") is None and bool(policy.get("defaultPersist")))
    )
    if should_persist:
        return str(PROJECT_ROOT / ".runtime-manifest" / "orchestration-memory.jsonl")
    return ""


def _redact_orchestration_value(value: Any, policy: dict[str, Any]) -> Any:
    redact_keys = [str(key).lower() for key in policy.get("redactKeys", [])]
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            lowered = str(key).lower()
            if any(redact_key and redact_key in lowered for redact_key in redact_keys):
                result[key] = "<redacted>"
            else:
                result[key] = _redact_orchestration_value(item, policy)
        return result
    if isinstance(value, list):
        return [_redact_orchestration_value(item, policy) for item in value]
    return value


def _persist_orchestration_memory(
    plan: dict[str, Any],
    shared_memory: dict[str, Any],
    steps: list[dict[str, Any]],
    debug_trace: dict[str, Any],
) -> dict[str, Any]:
    policy = plan.get("memory_policy") if isinstance(plan.get("memory_policy"), dict) else _orchestration_memory_policy()
    memory_path = str(plan.get("memory_path") or "").strip()
    if not memory_path:
        return {"enabled": False, "storage": "none"}
    target = Path(memory_path)
    if not target.is_absolute():
        target = PROJECT_ROOT / target
    target.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "format": "agent-flow-builder.runtime-orchestration-memory-record.v1",
        "run_id": plan["run_id"],
        "manifest_id": MANIFEST["id"],
        "manifest_version": MANIFEST["version"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "entry_agent_id": plan["entry_agent_id"],
        "step_count": len(steps),
        "steps": _redact_orchestration_value([
            {
                "agent_id": step["agent_id"],
                "session_id": step["session_id"],
                "handoff_condition": step.get("handoff_condition"),
            }
            for step in steps
        ], policy),
        "shared_memory": _redact_orchestration_value(shared_memory, policy),
        "debug_trace": {
            "format": debug_trace["format"],
            "run_id": debug_trace["run_id"],
            "summary": _redact_orchestration_value(debug_trace.get("summary", {}), policy),
            "timeline": _redact_orchestration_value(debug_trace.get("timeline", []), policy),
            "governance": debug_trace.get("governance", {}),
        },
        "governance": {
            "previewOnly": True,
            "excludesSecrets": True,
            "excludesEnvValues": True,
            "excludesRuntimePayloads": True,
        },
    }
    with target.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False, default=str) + "\\n")
    retention_runs = int(policy.get("retentionRuns") or 50)
    if retention_runs > 0:
        lines = target.read_text(encoding="utf-8").splitlines()
        if len(lines) > retention_runs:
            target.write_text("\\n".join(lines[-retention_runs:]) + "\\n", encoding="utf-8")
    return {
        "enabled": True,
        "storage": "jsonl",
        "record_format": record["format"],
        "entries": len(shared_memory.get("entries", [])),
        "decisions": len(shared_memory.get("decisions", [])),
        "retention_runs": retention_runs,
    }


def _agent_by_id(agent_id: str) -> dict[str, Any]:
    for agent in AGENTS:
        if agent["id"] == agent_id:
            return agent
    raise ValueError(f"Agente desconhecido no plano de orquestração: {agent_id}")


def _execute_agent_step(
    *,
    child_app: FastAPI,
    agent: dict[str, Any],
    message: str,
    metadata: dict[str, Any],
    max_turns: int,
    step_index: int,
    handoff_condition: str | None,
    shared_memory: dict[str, Any],
) -> dict[str, Any]:
    client = TestClient(child_app)
    resource_path = f"/{agent['resource_name']}"
    idempotency_base = f"orchestration-{MANIFEST['id']}-{agent['id']}-{step_index}"
    create_response = client.post(
        resource_path,
        headers={"Idempotency-Key": f"{idempotency_base}-create"},
        json={
            "metadata": {
                **metadata,
                "orchestration": {
                    "manifest_id": MANIFEST["id"],
                    "agent_id": agent["id"],
                    "step_index": step_index,
                    "handoff_condition": handoff_condition,
                    "shared_memory": _shared_memory_context(shared_memory),
                },
            },
            "max_turns": max_turns,
        },
    )
    _raise_for_agent_error(agent, "create_session", create_response)
    session_id = create_response.json()["session"]["session_id"]

    start_response = client.post(
        f"{resource_path}/{session_id}/start",
        headers={"Idempotency-Key": f"{idempotency_base}-start"},
        json={},
    )
    _raise_for_agent_error(agent, "start", start_response)
    turn_response = client.post(
        f"{resource_path}/{session_id}/turn",
        headers={"Idempotency-Key": f"{idempotency_base}-turn"},
        json={"user_message": message},
    )
    _raise_for_agent_error(agent, "turn", turn_response)
    return {
        "agent_id": agent["id"],
        "route_prefix": agent["route_prefix"],
        "resource_name": agent["resource_name"],
        "session_id": session_id,
        "handoff_condition": handoff_condition,
        "start": start_response.json(),
        "turn": turn_response.json(),
    }


def _raise_for_agent_error(agent: dict[str, Any], stage: str, response) -> None:
    if response.status_code < 400:
        return
    raise RuntimeError(
        json.dumps(
            {
                "agent_id": agent["id"],
                "stage": stage,
                "status_code": response.status_code,
                "body": response.text,
            },
            ensure_ascii=False,
        )
    )


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

function renderBundleWorker(agents: PythonBundleAgent[]): string {
  const workerAgents = agents.map((agent) => ({
    id: agent.id,
    runtime_dir: `agents/${safeSegment(agent.id)}`,
  }));
  return `import argparse
import importlib
import json
import logging
import os
import sys
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any


AGENTS = json.loads(${pyJson(workerAgents)})
PROJECT_ROOT = Path(__file__).resolve().parents[1]

logger = logging.getLogger(__name__)


@contextmanager
def _isolated_agent_import(agent_root: Path) -> Iterator[None]:
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


def _process_agent_jobs(agent: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    agent_root = PROJECT_ROOT / agent["runtime_dir"]
    if not agent_root.exists():
        raise RuntimeError(f"Runtime do agente não encontrado: {agent_root}")
    with _isolated_agent_import(agent_root):
        worker_module = importlib.import_module("app.worker")
        service = worker_module.build_worker_service()
        result = worker_module.process_pending_jobs(
            service,
            limit=max(1, int(args.limit)),
            retry_delay_seconds=max(0.0, float(args.retry_delay)),
            worker_id=f"{args.worker_id}:{agent['id']}",
            lease_seconds=max(1.0, float(args.lease_seconds)),
            cleanup_enabled=bool(args.cleanup_enabled),
            cleanup_older_than_hours=max(0.0, float(args.cleanup_older_than_hours)),
            cleanup_limit=max(1, int(args.cleanup_limit)),
            cleanup_statuses=_split_statuses(str(args.cleanup_statuses)),
        )
    if not isinstance(result, dict):
        result = {}
    return {
        "agent_id": agent["id"],
        "runtime_dir": agent["runtime_dir"],
        "processed": int(result.get("processed") or 0),
        "failed": int(result.get("failed") or 0),
        "retried": int(result.get("retried") or 0),
        "pending_seen": int(result.get("pending_seen") or 0),
        **({"cleanup": result["cleanup"]} if "cleanup" in result else {}),
    }


def process_bundle_jobs(args: argparse.Namespace) -> dict[str, Any]:
    aggregate: dict[str, Any] = {
        "processed": 0,
        "failed": 0,
        "retried": 0,
        "pending_seen": 0,
        "agents": [],
    }
    for agent in AGENTS:
        result = _process_agent_jobs(agent, args)
        aggregate["agents"].append(result)
        for key in ["processed", "failed", "retried", "pending_seen"]:
            aggregate[key] += int(result.get(key) or 0)
    return aggregate


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name, "").strip().lower()
    if not value:
        return default
    return value in {"1", "true", "yes", "on"}


def _env_str(name: str, default: str) -> str:
    value = os.getenv(name, "").strip()
    return value or default


def _split_statuses(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description="Processa jobs pendentes de todos os agentes do bundle.")
    parser.add_argument("--once", action="store_true", help="Processa a fila uma vez e encerra.")
    parser.add_argument(
        "--interval",
        type=float,
        default=_env_float("WORKER_INTERVAL_SECONDS", 5.0),
        help="Intervalo em segundos entre ciclos.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=_env_int("WORKER_LIMIT", 20),
        help="Maximo de jobs por agente em cada ciclo.",
    )
    parser.add_argument(
        "--retry-delay",
        type=float,
        default=_env_float("WORKER_RETRY_DELAY_SECONDS", 5.0),
        help="Atraso em segundos antes de nova tentativa.",
    )
    parser.add_argument(
        "--worker-id",
        default=_env_str("WORKER_ID", f"afw_bundle_{uuid.uuid4().hex[:12]}"),
        help="Identidade operacional deste worker para claim de jobs.",
    )
    parser.add_argument(
        "--lease-seconds",
        type=float,
        default=_env_float("WORKER_LEASE_SECONDS", 60.0),
        help="Tempo de lease do job antes de outro worker poder retoma-lo.",
    )
    parser.add_argument(
        "--cleanup-enabled",
        action=argparse.BooleanOptionalAction,
        default=_env_bool("WORKER_CLEANUP_ENABLED", False),
        help="Executa limpeza governada de jobs terminais antigos apos cada ciclo.",
    )
    parser.add_argument(
        "--cleanup-older-than-hours",
        type=float,
        default=_env_float("WORKER_CLEANUP_OLDER_THAN_HOURS", 168.0),
        help="Idade minima, em horas, para cleanup automatico de jobs terminais.",
    )
    parser.add_argument(
        "--cleanup-limit",
        type=int,
        default=_env_int("WORKER_CLEANUP_LIMIT", 100),
        help="Maximo de jobs removidos por ciclo de cleanup automatico.",
    )
    parser.add_argument(
        "--cleanup-statuses",
        default=_env_str("WORKER_CLEANUP_STATUSES", "succeeded,failed"),
        help="Status terminais separados por virgula para cleanup automatico.",
    )
    args = parser.parse_args()

    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    while True:
        result = process_bundle_jobs(args)
        logger.info("Jobs do bundle processados: %s", result)
        if args.once:
            return 0 if result["failed"] == 0 else 1
        time.sleep(max(0.5, float(args.interval)))


if __name__ == "__main__":
    raise SystemExit(main())
`;
}

function renderTestConftest(): string {
  return `import json
import os
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
    os.environ["AGENT_API_KEYS"] = ""
    os.environ["AGENT_API_KEYS_PATH"] = ""
    os.environ["AGENT_API_REVOKED_KEY_IDS"] = ""
    os.environ["AGENT_API_REVOKED_KEY_IDS_PATH"] = ""
    os.environ["AUTH_RATE_LIMIT_ENABLED"] = "false"
    os.environ["AUTH_RATE_LIMIT_REQUESTS"] = "60"
    os.environ["AUTH_RATE_LIMIT_WINDOW_SECONDS"] = "60"
    os.environ["AUTH_AUDIT_ENABLED"] = "true"
    os.environ["AUTH_AUDIT_MAX_ENTRIES"] = "200"
    os.environ["AUTH_AUDIT_PATH"] = ""
    os.environ["SAFETY_PROVIDER_ENABLED"] = "false"
    os.environ["SAFETY_PROVIDER_URL"] = ""
    os.environ["SAFETY_PROVIDER_TIMEOUT_SECONDS"] = "3"
    os.environ["SAFETY_PROVIDER_FAIL_CLOSED"] = "false"
    os.environ["SAFETY_PROVIDER_HEADERS_JSON"] = ""
    os.environ["AUTO_CREATE_TABLES"] = "true"
`;
}

function renderMultiAgentTest(manifest: RuntimeManifest, agents: PythonBundleAgent[]): string {
  const testAgents = agents.map((agent) => ({
    id: agent.id,
    route_prefix: normalizeRoutePrefix(agent.routePrefix),
    resource_name: agent.flow.api.resourceName,
  }));
  const testOrchestration = {
    mode: manifest.orchestration?.mode ?? "router",
    entry_agent_id: manifest.orchestration?.entryAgentId ?? agents[0]?.id,
    handoffs: manifest.orchestration?.handoffs ?? [],
    memoryPolicy: normalizeOrchestrationMemoryPolicy(manifest.orchestration?.memoryPolicy),
  };
  return `import json
import os
import sys
from pathlib import Path

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, text


AGENTS = json.loads(${pyJson(testAgents)})
ORCHESTRATION = json.loads(${pyJson(testOrchestration)})
PROJECT_ROOT = Path(__file__).resolve().parents[1]


def set_test_env(db_path: str) -> None:
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    os.environ["REDIS_ENABLED"] = "false"
    os.environ["USE_POSTGRES_CHECKPOINTER"] = "false"
    os.environ["MOCK_LLM"] = "true"
    os.environ["AUTH_ENABLED"] = "false"
    os.environ["AGENT_API_KEYS"] = ""
    os.environ["AGENT_API_KEYS_PATH"] = ""
    os.environ["AGENT_API_REVOKED_KEY_IDS"] = ""
    os.environ["AGENT_API_REVOKED_KEY_IDS_PATH"] = ""
    os.environ["AUTH_RATE_LIMIT_ENABLED"] = "false"
    os.environ["AUTH_RATE_LIMIT_REQUESTS"] = "60"
    os.environ["AUTH_RATE_LIMIT_WINDOW_SECONDS"] = "60"
    os.environ["AUTH_AUDIT_ENABLED"] = "true"
    os.environ["AUTH_AUDIT_MAX_ENTRIES"] = "200"
    os.environ["AUTH_AUDIT_PATH"] = ""
    os.environ["SAFETY_PROVIDER_ENABLED"] = "false"
    os.environ["SAFETY_PROVIDER_URL"] = ""
    os.environ["SAFETY_PROVIDER_TIMEOUT_SECONDS"] = "3"
    os.environ["SAFETY_PROVIDER_FAIL_CLOSED"] = "false"
    os.environ["SAFETY_PROVIDER_HEADERS_JSON"] = ""
    os.environ["AUTO_CREATE_TABLES"] = "true"


def _client(tmp_path):
    set_test_env(str(tmp_path / "multiagent.db"))
    create_app = _load_root_create_app()

    return TestClient(create_app())


def _client_with_database(database_url: str):
    os.environ["DATABASE_URL"] = database_url
    os.environ["REDIS_ENABLED"] = "false"
    os.environ["USE_POSTGRES_CHECKPOINTER"] = "false"
    os.environ["MOCK_LLM"] = "true"
    os.environ["AUTH_ENABLED"] = "false"
    os.environ["AGENT_API_KEYS"] = ""
    os.environ["AGENT_API_KEYS_PATH"] = ""
    os.environ["AGENT_API_REVOKED_KEY_IDS"] = ""
    os.environ["AGENT_API_REVOKED_KEY_IDS_PATH"] = ""
    os.environ["AUTH_RATE_LIMIT_ENABLED"] = "false"
    os.environ["AUTH_RATE_LIMIT_REQUESTS"] = "60"
    os.environ["AUTH_RATE_LIMIT_WINDOW_SECONDS"] = "60"
    os.environ["AUTH_AUDIT_ENABLED"] = "true"
    os.environ["AUTH_AUDIT_MAX_ENTRIES"] = "200"
    os.environ["AUTH_AUDIT_PATH"] = ""
    os.environ["SAFETY_PROVIDER_ENABLED"] = "false"
    os.environ["SAFETY_PROVIDER_URL"] = ""
    os.environ["SAFETY_PROVIDER_TIMEOUT_SECONDS"] = "3"
    os.environ["SAFETY_PROVIDER_FAIL_CLOSED"] = "false"
    os.environ["SAFETY_PROVIDER_HEADERS_JSON"] = ""
    os.environ["AUTO_CREATE_TABLES"] = "true"
    create_app = _load_root_create_app()

    return TestClient(create_app())


def _load_root_create_app():
    for name in [name for name in sys.modules if name == "app" or name.startswith("app.")]:
        sys.modules.pop(name, None)
    agents_root_text = str((PROJECT_ROOT / "agents").resolve())
    sys.path[:] = [
        item for item in sys.path
        if not str(Path(item).resolve()).startswith(agents_root_text)
    ]
    project_root_text = str(PROJECT_ROOT)
    if project_root_text in sys.path:
        sys.path.remove(project_root_text)
    sys.path.insert(0, project_root_text)
    from app.main import create_app

    return create_app


def _base(agent: dict) -> str:
    return f"{agent['route_prefix']}/{agent['resource_name']}"


def _load_root_worker():
    for name in [name for name in sys.modules if name == "app" or name.startswith("app.")]:
        sys.modules.pop(name, None)
    agents_root_text = str((PROJECT_ROOT / "agents").resolve())
    sys.path[:] = [
        item for item in sys.path
        if not str(Path(item).resolve()).startswith(agents_root_text)
    ]
    project_root_text = str(PROJECT_ROOT)
    if project_root_text in sys.path:
        sys.path.remove(project_root_text)
    sys.path.insert(0, project_root_text)
    from app.worker import AGENTS as worker_agents, process_bundle_jobs

    return worker_agents, process_bundle_jobs


def test_multiagent_bundle_worker_artifact_and_idle_cycle(tmp_path):
    set_test_env(str(tmp_path / "multiagent-worker.db"))
    compose = (PROJECT_ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    assert "\\n  worker:\\n" in compose
    assert 'command: ["python", "-m", "app.worker"]' in compose
    assert "required: false" in compose
    worker_source = (PROJECT_ROOT / "app" / "worker.py").read_text(encoding="utf-8")
    assert "def process_bundle_jobs" in worker_source
    assert "build_worker_service" in worker_source

    worker_agents, process_bundle_jobs = _load_root_worker()
    assert [agent["id"] for agent in worker_agents] == [agent["id"] for agent in AGENTS]

    class Args:
        limit = 5
        retry_delay = 0
        worker_id = "pytest-bundle-worker"
        lease_seconds = 30
        cleanup_enabled = False
        cleanup_older_than_hours = 168
        cleanup_limit = 10
        cleanup_statuses = "succeeded,failed"

    result = process_bundle_jobs(Args())
    assert result["processed"] == 0
    assert result["failed"] == 0
    assert result["retried"] == 0
    assert result["pending_seen"] == 0
    assert [agent["agent_id"] for agent in result["agents"]] == [agent["id"] for agent in AGENTS]


def test_multiagent_bundle_metadata_and_mounted_routes(tmp_path):
    client = _client(tmp_path)

    metadata = client.get("/metadata")
    assert metadata.status_code == 200
    data = metadata.json()
    assert data["supports_multi_agent_bundle"] is True
    assert data["packaging"] == "multiagent"
    assert [agent["id"] for agent in data["agents"]] == [agent["id"] for agent in AGENTS]
    assert data["shared_storage"]["database"]["scope"] == "bundle"
    assert data["shared_storage"]["database"]["mode"] == "single-database"
    assert data["shared_storage"]["database"]["tablesAreNamespacedBy"] == "agent_id"
    assert data["orchestration"]["format"] == "agent-flow-builder.runtime-orchestration.v1"
    assert data["orchestration"]["governance"]["declarativeOnly"] is True
    assert data["orchestration"]["capabilities"]["persistentMemoryPolicy"] is True
    assert data["orchestration"]["memoryPolicy"]["maxEntries"] == ORCHESTRATION["memoryPolicy"]["maxEntries"]
    assert data["orchestration"]["memoryPolicy"]["retentionRuns"] == ORCHESTRATION["memoryPolicy"]["retentionRuns"]
    assert data["agent_isolation"]["format"] == "agent-flow-builder.runtime-agent-isolation.v1"
    assert data["agent_isolation"]["routeIsolation"]["uniqueRoutePrefixes"] is True
    assert data["agent_isolation"]["runtimeImportIsolation"]["mode"] == "isolated-python-app-namespace"
    assert data["agent_isolation"]["requestIsolation"]["idempotencyNamespace"] == "route_prefix"
    assert data["agent_isolation"]["requestIsolation"]["sessionNamespace"] == "agent_id"
    assert data["agent_isolation"]["authIsolation"]["scopeNamespace"] == "agents:<agent_id>"
    assert data["agent_isolation"]["governance"]["excludesSecrets"] is True
    assert [agent["routePrefix"] for agent in data["agent_isolation"]["agents"]] == [agent["route_prefix"] for agent in AGENTS]

    isolation_path = PROJECT_ROOT / ".runtime-manifest" / "agent-isolation.json"
    isolation = json.loads(isolation_path.read_text(encoding="utf-8"))
    assert isolation["format"] == "agent-flow-builder.runtime-agent-isolation.v1"
    assert isolation["requestIsolation"]["eventNamespace"] == "agent_id"
    assert "OPENAI_API_KEY" not in json.dumps(isolation)

    health = client.get("/health")
    assert health.status_code == 200
    assert all(agent["mounted"] for agent in health.json()["agents"])
    assert health.json()["shared_storage"]["database_env"] == "DATABASE_URL"
    assert health.json()["agent_isolation"]["route_prefix_unique"] is True
    assert health.json()["agent_isolation"]["idempotency_namespace"] == "route_prefix"
    assert health.json()["agent_isolation"]["storage_namespace"] == "agent_id"

    for agent in AGENTS:
        child_metadata = client.get(f"{agent['route_prefix']}/metadata")
        assert child_metadata.status_code == 200
        assert child_metadata.json()["flow_id"] == agent["id"]
        assert child_metadata.json()["agent_id"] == agent["id"]


def test_multiagent_orchestration_run_executes_entry_and_handoffs(tmp_path):
    client = _client(tmp_path)
    memory_path = tmp_path / "orchestration-memory.jsonl"
    response = client.post(
        "/orchestration/run",
        json={
            "user_message": "Mensagem para execução orquestrada.",
            "metadata": {"source": "pytest-orchestration", "authorization": "Bearer orchestration-secret"},
            "max_turns": 2,
            "memory_path": str(memory_path),
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["format"] == "agent-flow-builder.runtime-orchestration-run.v1"
    assert data["status"] == "completed"
    expected_steps = 1 + len([
        handoff
        for handoff in ORCHESTRATION["handoffs"]
        if handoff["fromAgentId"] == data["entry_agent_id"]
    ])
    assert len(data["steps"]) == expected_steps
    assert data["steps"][0]["agent_id"] == data["entry_agent_id"]
    assert data["steps"][0]["session_id"]
    assert data["steps"][0]["turn"]["session"]["agent_id"] == data["steps"][0]["agent_id"]
    assert data["shared_memory"]["format"] == "agent-flow-builder.runtime-orchestration-memory.v1"
    assert data["shared_memory"]["policy"]["max_entries"] == ORCHESTRATION["memoryPolicy"]["maxEntries"]
    assert data["debug_trace"]["governance"]["memoryPolicy"]["retention_runs"] == ORCHESTRATION["memoryPolicy"]["retentionRuns"]
    assert len(data["shared_memory"]["entries"]) == len(data["steps"])
    assert data["shared_memory"]["entries"][0]["output_preview"]
    assert data["debug_trace"]["format"] == "agent-flow-builder.runtime-orchestration-debug-trace.v1"
    assert data["debug_trace"]["run_id"] == data["shared_memory"]["run_id"]
    assert data["debug_trace"]["summary"]["status"] == "completed"
    assert data["debug_trace"]["summary"]["step_count"] == len(data["steps"])
    trace_event_types = [event["type"] for event in data["debug_trace"]["timeline"]]
    assert "plan_created" in trace_event_types
    assert "step_started" in trace_event_types
    assert "step_completed" in trace_event_types
    assert "OPENAI_API_KEY" not in json.dumps(data["debug_trace"])
    if ORCHESTRATION["handoffs"]:
        assert any(decision["matched"] for decision in data["shared_memory"]["decisions"])
        assert "match" in data["shared_memory"]["decisions"][0]["reason"]
        assert "handoff_decision" in trace_event_types
    assert data["governance"]["executedInProcess"] is True
    assert data["governance"]["excludesSecrets"] is True
    assert data["governance"]["sharedMemoryPreviewOnly"] is True
    assert data["governance"]["debugTracePreviewOnly"] is True
    assert data["shared_memory"]["persistence"]["enabled"] is True
    assert data["shared_memory"]["persistence"]["storage"] == "jsonl"
    assert "orchestration-secret" not in json.dumps(data)
    persisted = [json.loads(line) for line in memory_path.read_text(encoding="utf-8").splitlines()]
    assert persisted[-1]["format"] == "agent-flow-builder.runtime-orchestration-memory-record.v1"
    assert persisted[-1]["shared_memory"]["entries"][0]["output_preview"]
    assert persisted[-1]["debug_trace"]["format"] == "agent-flow-builder.runtime-orchestration-debug-trace.v1"
    assert persisted[-1]["debug_trace"]["summary"]["step_count"] == len(data["steps"])
    assert "orchestration-secret" not in json.dumps(persisted[-1])

    policy = ORCHESTRATION["memoryPolicy"]
    if policy["defaultPersist"] or policy["persistence"] == "always_jsonl":
        default_path_value = policy["defaultMemoryPath"] or ".runtime-manifest/orchestration-memory.jsonl"
        default_memory_path = PROJECT_ROOT / default_path_value
        if default_memory_path.exists():
            default_memory_path.unlink()
        default_response = client.post(
            "/orchestration/run",
            json={
                "user_message": "Execução com persistência default.",
                "metadata": {"source": "pytest-orchestration-default"},
                "max_turns": 2,
            },
        )
        assert default_response.status_code == 200
        default_data = default_response.json()
        assert default_data["shared_memory"]["policy"]["persistence_active"] is True
        assert default_data["shared_memory"]["persistence"]["enabled"] is True
        assert default_memory_path.exists()


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
    assert first_create.json()["session"]["agent_id"] == first["id"]

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
    assert second_create.json()["session"]["agent_id"] == second["id"]
    assert second_session_id != first_session_id

    first_start = client.post(
        f"{_base(first)}/{first_session_id}/start",
        headers={"Idempotency-Key": "shared-start"},
        json={},
    )
    assert first_start.status_code == 200
    first_events = client.get(f"{_base(first)}/{first_session_id}/events")
    assert first_events.status_code == 200
    assert {item["agent_id"] for item in first_events.json()} == {first["id"]}

    second_start = client.post(
        f"{_base(second)}/{second_session_id}/start",
        headers={"Idempotency-Key": "shared-start"},
        json={},
    )
    assert second_start.status_code == 200
    second_events = client.get(f"{_base(second)}/{second_session_id}/events")
    assert second_events.status_code == 200
    assert {item["agent_id"] for item in second_events.json()} == {second["id"]}


@pytest.mark.integration
def test_multiagent_bundle_can_share_real_postgres_database_when_configured():
    if len(AGENTS) < 2:
        pytest.skip("A validação de Postgres compartilhado exige ao menos dois agentes.")
    database_url = os.getenv("AGENT_FLOW_TEST_POSTGRES_URL")
    if not database_url:
        pytest.skip("Defina AGENT_FLOW_TEST_POSTGRES_URL para validar Postgres real compartilhado.")

    client = _client_with_database(database_url)
    engine = create_engine(database_url)
    with engine.begin() as conn:
        for table in [
            "agent_jobs",
            "agent_events",
            "agent_messages",
            "agent_node_records",
            "idempotency_records",
            "agent_sessions",
        ]:
            conn.execute(text(f"DELETE FROM {table}"))

    first, second = AGENTS[0], AGENTS[1]
    first_create = client.post(
        _base(first),
        headers={"Idempotency-Key": "postgres-first-create"},
        json={"metadata": {"agent": first["id"], "storage": "postgres"}, "max_turns": 2},
    )
    assert first_create.status_code == 200
    second_create = client.post(
        _base(second),
        headers={"Idempotency-Key": "postgres-second-create"},
        json={"metadata": {"agent": second["id"], "storage": "postgres"}, "max_turns": 2},
    )
    assert second_create.status_code == 200

    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT agent_id, COUNT(*) AS total FROM agent_sessions GROUP BY agent_id")
        ).mappings().all()
    totals = {row["agent_id"]: row["total"] for row in rows}
    assert totals[first["id"]] == 1
    assert totals[second["id"]] == 1
`;
}

function normalizeRoutePrefix(prefix: string): string {
  return prefix.replace(/\/+$/g, "") || "/";
}

function normalizeOrchestrationMemoryPolicy(policy: NonNullable<RuntimeManifest["orchestration"]>["memoryPolicy"] | undefined) {
  const defaultRedactKeys = ["api_key", "authorization", "password", "secret", "token"];
  const persistenceValues = new Set(["disabled", "optional_jsonl", "always_jsonl"]);
  const persistence = persistenceValues.has(policy?.persistence ?? "") ? policy?.persistence : "optional_jsonl";
  const positiveInt = (value: unknown, fallback: number, min: number, max: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.trunc(parsed)));
  };
  const redactKeys = (policy?.redactKeys ?? defaultRedactKeys)
    .map((key) => String(key).trim().toLowerCase())
    .filter(Boolean);
  return {
    enabled: policy?.enabled ?? true,
    persistence,
    defaultPersist: policy?.defaultPersist ?? false,
    defaultMemoryPath: policy?.defaultMemoryPath?.trim() ?? "",
    maxEntries: positiveInt(policy?.maxEntries, 64, 1, 1000),
    retentionRuns: positiveInt(policy?.retentionRuns, 50, 1, 10000),
    maxPreviewChars: positiveInt(policy?.maxPreviewChars, 500, 80, 5000),
    redactKeys: redactKeys.length ? redactKeys : defaultRedactKeys,
    includeStepOutputs: policy?.includeStepOutputs ?? true,
    includeHandoffDecisions: policy?.includeHandoffDecisions ?? true,
  };
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
