import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import type { AgentFlow, RuntimeManifest } from "@agent-flow-builder/flow-spec";
import { generateLangGraphRuntime, generateManifestRuntime } from "./index.ts";

const execFileAsync = promisify(execFile);

test("generated runtime supports a simple flow without deterministic gate", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-codegen-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const flowRoot = path.join(workspaceRoot, "flow");
  const outDir = path.join(workspaceRoot, "runtime");
  await mkdir(path.join(flowRoot, "prompts"), { recursive: true });
  await mkdir(path.join(flowRoot, "schemas"), { recursive: true });
  await writeFile(
    path.join(flowRoot, "prompts", "system.md"),
    "# Agente simples\n\nResponda em português brasileiro de forma curta.\n",
    "utf-8",
  );
  await writeFile(
    path.join(flowRoot, "schemas", "session_state.schema.json"),
    JSON.stringify({ type: "object", properties: { session_id: { type: "string" } } }, null, 2),
    "utf-8",
  );

  const flow: AgentFlow = {
    id: "simple-echo",
    name: "Agente Simples",
    version: "0.1.0",
    runtime: "langgraph-python",
    api: {
      contract: "sessions-v1",
      resourceName: "sessions",
      autoStartOnCreate: false,
    },
    persistence: {
      checkpointer: "memory",
      publicStore: "sqlite",
      cache: "memory",
    },
    llm: {
      adapter: "openrouter",
      model: "openai/gpt-4.1-mini",
      apiKeyEnv: "OPENROUTER_API_KEY",
      baseUrlEnv: "OPENROUTER_BASE_URL",
      mockEnv: "MOCK_LLM",
    },
    state: {
      schemaRef: "schemas/session_state.schema.json",
    },
    prompts: [
      {
        id: "system",
        path: "prompts/system.md",
        version: "v1",
        variables: [],
      },
    ],
    schemas: [
      {
        id: "session_state",
        path: "schemas/session_state.schema.json",
      },
    ],
    nodes: [
      { id: "start_node", type: "start" },
      { id: "input_safety_check", type: "safety_gate", stage: "input" },
      { id: "llm_step", type: "llm_prompt", promptId: "system", llm: { adapter: "openrouter", model: "openai/gpt-4.1-mini" } },
      { id: "finish_node", type: "end" },
    ],
    edges: [
      { from: "start", to: "start_node", condition: "action == 'start'" },
      { from: "start", to: "input_safety_check", condition: "action == 'turn'" },
      { from: "start", to: "finish_node", condition: "action == 'finish'" },
      { from: "start_node", to: "end" },
      { from: "input_safety_check", to: "llm_step", condition: "safety.decision == 'allow'" },
      { from: "input_safety_check", to: "end", condition: "safety.blocked == true" },
      { from: "llm_step", to: "end" },
      { from: "finish_node", to: "end" },
    ],
  };

  await generateLangGraphRuntime({ flow, flowRoot, outDir });
  const graph = await readFile(path.join(outDir, "app", "graph.py"), "utf-8");
  assert.match(graph, /\\"llmAdapter\\": \\"openrouter\\"/);
  assert.match(graph, /\\"llmModel\\": \\"openai\/gpt-4\.1-mini\\"/);
  await execFileAsync("python", ["-m", "pytest", "-q", outDir], {
    cwd: outDir,
    timeout: 120000,
  });
});

test("generated runtime executes switch and human input nodes", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-codegen-switch-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const flowRoot = path.join(workspaceRoot, "flow");
  const outDir = path.join(workspaceRoot, "runtime");
  await writeFlowAssets(flowRoot, "Agente com switch");

  const flow: AgentFlow = {
    ...simpleFlow("switch-human-agent", "Agente Switch Humano"),
    nodes: [
      { id: "start_node", type: "start" },
      { id: "input_safety_check", type: "safety_gate", stage: "input" },
      { id: "turn_router", type: "switch" },
      { id: "llm_step", type: "llm_prompt", promptId: "system" },
      { id: "wait_user_answer", type: "human_input" },
      { id: "finish_node", type: "end" },
    ],
    edges: [
      { from: "start", to: "start_node", condition: "action == 'start'" },
      { from: "start", to: "input_safety_check", condition: "action == 'turn'" },
      { from: "start", to: "finish_node", condition: "action == 'finish'" },
      { from: "start_node", to: "end" },
      { from: "input_safety_check", to: "turn_router", condition: "safety.decision == 'allow'" },
      { from: "input_safety_check", to: "end", condition: "safety.blocked == true" },
      { from: "turn_router", to: "llm_step", condition: "status == 'active' and turn < max_turns" },
      { from: "turn_router", to: "finish_node", condition: "turn >= max_turns" },
      { from: "llm_step", to: "wait_user_answer" },
      { from: "wait_user_answer", to: "end" },
      { from: "finish_node", to: "end" },
    ],
  };

  await generateLangGraphRuntime({ flow, flowRoot, outDir });
  const graph = await readFile(path.join(outDir, "app", "graph.py"), "utf-8");
  assert.match(graph, /SWITCH_NODE_IDS/);
  assert.match(graph, /HUMAN_INPUT_NODE_IDS/);
  assert.match(graph, /state_compare/);
  await writeFile(
    path.join(outDir, "tests", "test_switch_human_nodes.py"),
    `from fastapi.testclient import TestClient

from app.generated_flow import API_RESOURCE
from tests.conftest import set_test_env


def _path(suffix: str = "") -> str:
    return f"/{API_RESOURCE}{suffix}"


def _client(tmp_path):
    set_test_env(str(tmp_path / "switch-human.db"))
    from app.db import engine
    from app.main import create_app
    from app.models import Base

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestClient(create_app())


def test_switch_and_human_input_events(tmp_path):
    client = _client(tmp_path)
    create_resp = client.post(_path(), headers={"Idempotency-Key": "create"}, json={"max_turns": 2})
    session_id = create_resp.json()["session"]["session_id"]
    client.post(_path(f"/{session_id}/start"), headers={"Idempotency-Key": "start"}, json={})

    turn_resp = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "turn"},
        json={"user_message": "teste"},
    )
    assert turn_resp.status_code == 200
    data = turn_resp.json()
    assert data["assistant_message"]["code"] == "ECHO"
    assert data["session"]["phase"] == "awaiting_turn"

    events = client.get(_path(f"/{session_id}/events")).json()
    event_types = [item["event_type"] for item in events]
    assert "switch_evaluated" in event_types
    assert "human_input_wait" in event_types
`,
    "utf-8",
  );

  await execFileAsync("python", ["-m", "pytest", "-q", outDir], {
    cwd: outDir,
    timeout: 120000,
  });
});

test("generated runtime executes deterministic HTTP and transform nodes", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-codegen-integration-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const flowRoot = path.join(workspaceRoot, "flow");
  const outDir = path.join(workspaceRoot, "runtime");
  await writeFlowAssets(flowRoot, "Agente com integração");

  const flow: AgentFlow = {
    ...simpleFlow("integration-agent", "Agente Integração"),
    nodes: [
      { id: "start_node", type: "start" },
      { id: "input_safety_check", type: "safety_gate", stage: "input" },
      { id: "llm_step", type: "llm_prompt", promptId: "system" },
      {
        id: "echo_http",
        type: "http_request",
        method: "POST",
        url: "mock://echo",
        bodyPath: "user_message",
        responsePath: "http.echo_http",
      },
      {
        id: "capture_http",
        type: "transform_json",
        inputPath: "http.echo_http.request",
        outputPath: "transforms.capture_http",
      },
      { id: "finish_node", type: "end" },
    ],
    edges: [
      { from: "start", to: "start_node", condition: "action == 'start'" },
      { from: "start", to: "input_safety_check", condition: "action == 'turn'" },
      { from: "start", to: "finish_node", condition: "action == 'finish'" },
      { from: "start_node", to: "end" },
      { from: "input_safety_check", to: "llm_step", condition: "safety.decision == 'allow'" },
      { from: "input_safety_check", to: "end", condition: "safety.blocked == true" },
      { from: "llm_step", to: "echo_http" },
      { from: "echo_http", to: "capture_http" },
      { from: "capture_http", to: "end" },
      { from: "finish_node", to: "end" },
    ],
  };

  await generateLangGraphRuntime({ flow, flowRoot, outDir });
  const graph = await readFile(path.join(outDir, "app", "graph.py"), "utf-8");
  assert.match(graph, /HTTP_REQUEST_NODE_IDS/);
  assert.match(graph, /TRANSFORM_JSON_NODE_IDS/);
  assert.match(graph, /mock:\/\/echo/);
  await writeFile(
    path.join(outDir, "tests", "test_integration_nodes.py"),
    `from fastapi.testclient import TestClient

from app.generated_flow import API_RESOURCE
from tests.conftest import set_test_env


def _path(suffix: str = "") -> str:
    return f"/{API_RESOURCE}{suffix}"


def _client(tmp_path):
    set_test_env(str(tmp_path / "integration.db"))
    from app.db import engine
    from app.main import create_app
    from app.models import Base

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestClient(create_app())


def test_http_and_transform_events(tmp_path):
    client = _client(tmp_path)
    create_resp = client.post(_path(), headers={"Idempotency-Key": "create"}, json={"max_turns": 2})
    session_id = create_resp.json()["session"]["session_id"]
    client.post(_path(f"/{session_id}/start"), headers={"Idempotency-Key": "start"}, json={})

    turn_resp = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "turn"},
        json={"user_message": "payload de teste"},
    )
    assert turn_resp.status_code == 200

    events = client.get(_path(f"/{session_id}/events")).json()
    by_type = {item["event_type"]: item for item in events}
    assert by_type["http_request_completed"]["payload"]["http"]["mock"] is True
    assert by_type["http_request_completed"]["payload"]["http"]["request"] == "payload de teste"
    assert by_type["transform_json_completed"]["payload"]["transform"]["value"] == "payload de teste"
`,
    "utf-8",
  );

  await execFileAsync("python", ["-m", "pytest", "-q", outDir], {
    cwd: outDir,
    timeout: 120000,
  });
});

test("generated runtime executes database query and save nodes", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-codegen-database-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const flowRoot = path.join(workspaceRoot, "flow");
  const outDir = path.join(workspaceRoot, "runtime");
  await writeFlowAssets(flowRoot, "Agente com banco");

  const flow: AgentFlow = {
    ...simpleFlow("database-agent", "Agente Banco"),
    nodes: [
      { id: "start_node", type: "start" },
      { id: "input_safety_check", type: "safety_gate", stage: "input" },
      { id: "llm_step", type: "llm_prompt", promptId: "system" },
      {
        id: "save_response",
        type: "database_save",
        table: "agent_node_records",
        dataPath: "assistant_message",
        resultPath: "database.save_response",
      },
      {
        id: "load_saved_response",
        type: "database_query",
        query: "SELECT node_id, payload_json FROM agent_node_records WHERE session_id = :session_id ORDER BY created_at DESC",
        resultPath: "database.load_saved_response",
      },
      { id: "finish_node", type: "end" },
    ],
    edges: [
      { from: "start", to: "start_node", condition: "action == 'start'" },
      { from: "start", to: "input_safety_check", condition: "action == 'turn'" },
      { from: "start", to: "finish_node", condition: "action == 'finish'" },
      { from: "start_node", to: "end" },
      { from: "input_safety_check", to: "llm_step", condition: "safety.decision == 'allow'" },
      { from: "input_safety_check", to: "end", condition: "safety.blocked == true" },
      { from: "llm_step", to: "save_response" },
      { from: "save_response", to: "load_saved_response" },
      { from: "load_saved_response", to: "end" },
      { from: "finish_node", to: "end" },
    ],
  };

  await generateLangGraphRuntime({ flow, flowRoot, outDir });
  const graph = await readFile(path.join(outDir, "app", "graph.py"), "utf-8");
  assert.match(graph, /DATABASE_QUERY_NODE_IDS/);
  assert.match(graph, /DATABASE_SAVE_NODE_IDS/);
  assert.match(graph, /AgentNodeRecord/);
  await writeFile(
    path.join(outDir, "tests", "test_database_nodes.py"),
    `from fastapi.testclient import TestClient

from app.generated_flow import API_RESOURCE
from tests.conftest import set_test_env


def _path(suffix: str = "") -> str:
    return f"/{API_RESOURCE}{suffix}"


def _client(tmp_path):
    set_test_env(str(tmp_path / "database.db"))
    from app.db import engine
    from app.main import create_app
    from app.models import Base

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestClient(create_app())


def test_database_query_and_save_events(tmp_path):
    client = _client(tmp_path)
    create_resp = client.post(_path(), headers={"Idempotency-Key": "create"}, json={"max_turns": 2})
    session_id = create_resp.json()["session"]["session_id"]
    client.post(_path(f"/{session_id}/start"), headers={"Idempotency-Key": "start"}, json={})

    turn_resp = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "turn"},
        json={"user_message": "grave isto"},
    )
    assert turn_resp.status_code == 200
    assert turn_resp.json()["assistant_message"]["code"] == "ECHO"

    events = client.get(_path(f"/{session_id}/events")).json()
    by_type = {item["event_type"]: item for item in events}
    saved = by_type["database_save_completed"]["payload"]["database"]
    loaded = by_type["database_query_completed"]["payload"]["database"]
    assert saved["ok"] is True
    assert saved["table"] == "agent_node_records"
    assert loaded["ok"] is True
    assert loaded["row_count"] == 1
    assert loaded["rows"][0]["node_id"] == "save_response"
`,
    "utf-8",
  );

  await execFileAsync("python", ["-m", "pytest", "-q", outDir], {
    cwd: outDir,
    timeout: 120000,
  });
});

test("generated multiagent manifest bundle mounts agents in one FastAPI process", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-codegen-multi-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const firstRoot = path.join(workspaceRoot, "first-flow");
  const secondRoot = path.join(workspaceRoot, "second-flow");
  const outDir = path.join(workspaceRoot, "bundle");
  await writeFlowAssets(firstRoot, "Primeiro agente");
  await writeFlowAssets(secondRoot, "Segundo agente");

  const firstFlow = simpleFlow("first-agent", "Primeiro Agente");
  const secondFlow = simpleFlow("second-agent", "Segundo Agente");
  const manifest: RuntimeManifest = {
    id: "multiagent-reference",
    name: "Multiagent Reference",
    version: "0.1.0",
    packaging: "multiagent",
    defaultLlm: {
      adapter: "openai",
      model: "gpt-4.1-mini",
      apiKeyEnv: "OPENAI_API_KEY",
      baseUrlEnv: "OPENAI_BASE_URL",
      mockEnv: "MOCK_LLM",
    },
    agents: [
      {
        id: firstFlow.id,
        flowPath: "first-flow/agent.flow.json",
        routePrefix: "/first",
      },
      {
        id: secondFlow.id,
        flowPath: "second-flow/agent.flow.json",
        routePrefix: "/second",
      },
    ],
  };

  await generateManifestRuntime({
    manifest,
    outDir,
    agents: [
      { id: firstFlow.id, routePrefix: "/first", flow: firstFlow, flowRoot: firstRoot },
      { id: secondFlow.id, routePrefix: "/second", flow: secondFlow, flowRoot: secondRoot },
    ],
  });

  await execFileAsync("python", ["-m", "pytest", "-q"], {
    cwd: outDir,
    timeout: 120000,
  });
});

async function writeFlowAssets(flowRoot: string, title: string): Promise<void> {
  await mkdir(path.join(flowRoot, "prompts"), { recursive: true });
  await mkdir(path.join(flowRoot, "schemas"), { recursive: true });
  await writeFile(
    path.join(flowRoot, "prompts", "system.md"),
    `# ${title}\n\nResponda em português brasileiro de forma curta.\n`,
    "utf-8",
  );
  await writeFile(
    path.join(flowRoot, "schemas", "session_state.schema.json"),
    JSON.stringify({ type: "object", properties: { session_id: { type: "string" } } }, null, 2),
    "utf-8",
  );
}

function simpleFlow(id: string, name: string): AgentFlow {
  return {
    id,
    name,
    version: "0.1.0",
    runtime: "langgraph-python",
    api: {
      contract: "sessions-v1",
      resourceName: "sessions",
      autoStartOnCreate: false,
    },
    persistence: {
      checkpointer: "memory",
      publicStore: "sqlite",
      cache: "memory",
    },
    llm: {
      adapter: "openai",
      model: "gpt-4.1-mini",
      apiKeyEnv: "OPENAI_API_KEY",
      baseUrlEnv: "OPENAI_BASE_URL",
      mockEnv: "MOCK_LLM",
    },
    state: {
      schemaRef: "schemas/session_state.schema.json",
    },
    prompts: [
      {
        id: "system",
        path: "prompts/system.md",
        version: "v1",
        variables: [],
      },
    ],
    schemas: [
      {
        id: "session_state",
        path: "schemas/session_state.schema.json",
      },
    ],
    nodes: [
      { id: "start_node", type: "start" },
      { id: "input_safety_check", type: "safety_gate", stage: "input" },
      { id: "llm_step", type: "llm_prompt", promptId: "system" },
      { id: "finish_node", type: "end" },
    ],
    edges: [
      { from: "start", to: "start_node", condition: "action == 'start'" },
      { from: "start", to: "input_safety_check", condition: "action == 'turn'" },
      { from: "start", to: "finish_node", condition: "action == 'finish'" },
      { from: "start_node", to: "end" },
      { from: "input_safety_check", to: "llm_step", condition: "safety.decision == 'allow'" },
      { from: "input_safety_check", to: "end", condition: "safety.blocked == true" },
      { from: "llm_step", to: "end" },
      { from: "finish_node", to: "end" },
    ],
  };
}
