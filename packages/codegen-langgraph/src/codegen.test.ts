import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import type { AgentFlow, RuntimeManifest } from "@agent-flow-builder/flow-spec";
import { generateLangGraphRuntime, generateLangGraphSandbox, generateManifestRuntime } from "./index.ts";

const execFileAsync = promisify(execFile);

test("generated runtime supports a simple flow without deterministic gate", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-codegen-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const flowRoot = path.join(workspaceRoot, "flow");
  const outDir = path.join(workspaceRoot, "runtime");
  const sandboxOutDir = path.join(workspaceRoot, "langgraph-sandbox");
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
  const db = await readFile(path.join(outDir, "app", "db.py"), "utf-8");
  const envExample = await readFile(path.join(outDir, ".env.example"), "utf-8");
  const dockerCompose = await readFile(path.join(outDir, "docker-compose.yml"), "utf-8");
  const langGraphConfig = JSON.parse(await readFile(path.join(outDir, "langgraph.json"), "utf-8"));
  const langGraphEntrypoint = await readFile(path.join(outDir, "app", "langgraph_app.py"), "utf-8");
  const runtimeMetadata = JSON.parse(await readFile(path.join(outDir, ".agent-flow", "generated-meta.json"), "utf-8"));
  assert.match(graph, /\\"llmAdapter\\": \\"openrouter\\"/);
  assert.match(graph, /\\"llmModel\\": \\"openai\/gpt-4\.1-mini\\"/);
  assert.match(db, /pg_advisory_xact_lock/);
  assert.match(envExample, /LANGSMITH_TRACING=false/);
  assert.match(dockerCompose, /path: \.env\s+required: false/);
  assert.deepEqual(langGraphConfig.dependencies, ["."]);
  assert.equal(langGraphConfig.graphs.simple_echo, "./app/langgraph_app.py:graph");
  assert.match(langGraphEntrypoint, /graph = build_graph/);
  assert.equal(runtimeMetadata.target, "fastapi-runtime");
  assert.equal(runtimeMetadata.flowId, "simple-echo");
  assert.match(runtimeMetadata.flowHash, /^[a-f0-9]{64}$/);
  await execFileAsync("python", ["-m", "pytest", "-q", outDir], {
    cwd: outDir,
    timeout: 120000,
  });

  await generateLangGraphSandbox({ flow, flowRoot, outDir: sandboxOutDir });
  const sandboxEnvExample = await readFile(path.join(sandboxOutDir, ".env.example"), "utf-8");
  const sandboxPyproject = await readFile(path.join(sandboxOutDir, "pyproject.toml"), "utf-8");
  const sandboxConfig = JSON.parse(await readFile(path.join(sandboxOutDir, "langgraph.json"), "utf-8"));
  const sandboxMetadata = JSON.parse(await readFile(path.join(sandboxOutDir, ".agent-flow", "generated-meta.json"), "utf-8"));
  await readFile(path.join(sandboxOutDir, "app", "langgraph_app.py"), "utf-8");
  assert.match(sandboxEnvExample, /LANGSMITH_TRACING=false/);
  assert.doesNotMatch(sandboxPyproject, /fastapi/);
  assert.match(sandboxPyproject, /langgraph-cli\[inmem\]/);
  assert.equal(sandboxConfig.graphs.simple_echo, "./app/langgraph_app.py:graph");
  assert.equal(sandboxMetadata.target, "langgraph-sandbox");
  assert.equal(sandboxMetadata.flowHash, runtimeMetadata.flowHash);
  await execFileAsync("python", ["-m", "pytest", "-q", sandboxOutDir], {
    cwd: sandboxOutDir,
    timeout: 120000,
  });
});

test("generated runtime replays node pins from session metadata", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-codegen-node-pins-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const flowRoot = path.join(workspaceRoot, "flow");
  const outDir = path.join(workspaceRoot, "runtime");
  await writeFlowAssets(flowRoot, "Agente com pins de nó");
  await generateLangGraphRuntime({ flow: simpleFlow("node-pin-agent", "Agente Pinado"), flowRoot, outDir });

  await writeFile(
    path.join(outDir, "tests", "test_node_pins.py"),
    `from fastapi.testclient import TestClient

from app.generated_flow import API_RESOURCE
from tests.conftest import set_test_env


def _path(suffix: str = "") -> str:
    return f"/{API_RESOURCE}{suffix}"


def _client(tmp_path):
    set_test_env(str(tmp_path / "node-pins.db"))
    from app.db import engine
    from app.main import create_app
    from app.models import Base

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestClient(create_app())


def test_llm_node_pin_replays_without_live_generation(tmp_path):
    client = _client(tmp_path)
    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "create"},
        json={
            "metadata": {
                "scenario": {"id": "scenario-1", "label": "Pinado", "useNodePins": True},
                "nodePins": {
                    "enabled": True,
                    "mode": "mock",
                    "items": [
                        {
                            "nodeId": "llm_step",
                            "nodeType": "llm_prompt",
                            "nodeHash": "fixture",
                            "output": {
                                "assistant_message": {"code": "PIN", "text": "Resposta congelada pelo pin."},
                                "provider": "fixture",
                                "model": "fixture-model",
                            },
                        }
                    ],
                },
            },
            "max_turns": 2,
        },
    )
    assert create_resp.status_code == 200
    session_id = create_resp.json()["session"]["session_id"]
    client.post(_path(f"/{session_id}/start"), headers={"Idempotency-Key": "start"}, json={})

    turn_resp = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "turn"},
        json={"user_message": "teste"},
    )
    assert turn_resp.status_code == 200
    data = turn_resp.json()
    assert data["assistant_message"] == {"code": "PIN", "text": "Resposta congelada pelo pin."}

    events = client.get(_path(f"/{session_id}/events")).json()
    llm_events = [item for item in events if item["event_type"] == "llm_called"]
    assert llm_events
    payload = llm_events[-1]["payload"]
    assert payload["pinned"] is True
    assert payload["mock"] is True
    assert payload["provider"] == "fixture"
    assert payload["model"] == "fixture-model"
`,
    "utf-8",
  );

  await execFileAsync("python", ["-m", "pytest", "-q", outDir], {
    cwd: outDir,
    timeout: 120000,
  });
});

test("generated runtime restores scenario checkpoint state from metadata", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-codegen-restore-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const flowRoot = path.join(workspaceRoot, "flow");
  const outDir = path.join(workspaceRoot, "runtime");
  await writeFlowAssets(flowRoot, "Agente com restore");
  await generateLangGraphRuntime({ flow: simpleFlow("restore-agent", "Agente Restore"), flowRoot, outDir });

  await writeFile(
    path.join(outDir, "tests", "test_checkpoint_restore.py"),
    `from fastapi.testclient import TestClient

from app.generated_flow import API_RESOURCE
from tests.conftest import set_test_env


def _path(suffix: str = "") -> str:
    return f"/{API_RESOURCE}{suffix}"


def _client(tmp_path):
    set_test_env(str(tmp_path / "restore.db"))
    from app.db import engine
    from app.main import create_app
    from app.models import Base

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestClient(create_app())


def test_restore_state_continues_turn_count_and_skips_fresh_start(tmp_path):
    client = _client(tmp_path)
    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "create"},
        json={
            "metadata": {
                "scenario": {"id": "fork-1", "label": "Fork", "useNodePins": False},
                "restore": {
                    "mode": "scenario-fork",
                    "source": "studio-snapshot",
                    "sourceSessionId": "source-session",
                    "eventSeq": 7,
                    "snapshotSeq": 7,
                    "state": {
                        "session": {
                            "status": "active",
                            "phase": "awaiting_turn",
                            "turn": 1,
                            "max_turns": 3,
                        },
                        "recent_messages": [
                            {"role": "user", "content": "mensagem anterior"},
                            {"role": "assistant", "content": "resposta anterior"},
                        ],
                        "nodes": {"llm_step": {"status": "active"}},
                        "outputs": {"llm_step": {"assistant_message": {"code": "OLD", "text": "anterior"}}},
                    },
                },
            },
            "max_turns": 3,
        },
    )
    assert create_resp.status_code == 200
    session = create_resp.json()["session"]
    assert session["status"] == "active"
    assert session["phase"] == "awaiting_turn"
    assert session["turn"] == 1
    session_id = session["session_id"]

    start_resp = client.post(_path(f"/{session_id}/start"), headers={"Idempotency-Key": "start"}, json={})
    assert start_resp.status_code == 200
    assert start_resp.json()["messages"] == []
    assert start_resp.json()["session"]["turn"] == 1

    turn_resp = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "turn"},
        json={"user_message": "continue do checkpoint"},
    )
    assert turn_resp.status_code == 200
    assert turn_resp.json()["session"]["turn"] == 2

    events = client.get(_path(f"/{session_id}/events")).json()
    by_type = {item["event_type"]: item for item in events}
    assert "checkpoint_restored" in by_type
    restore_payload = by_type["checkpoint_restored"]["payload"]
    assert restore_payload["source"] == "metadata"
    assert restore_payload["turn"] == 1
    assert "recent_messages" in restore_payload["stateKeys"]
`,
    "utf-8",
  );

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

test("generated runtime applies configurable safety harness rules", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-codegen-safety-harness-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const flowRoot = path.join(workspaceRoot, "flow");
  const outDir = path.join(workspaceRoot, "runtime");
  await writeFlowAssets(flowRoot, "Agente Safety Harness");

  const flow: AgentFlow = {
    ...simpleFlow("safety-harness-agent", "Agente Safety Harness"),
    nodes: [
      { id: "start_node", type: "start" },
      {
        id: "input_safety_check",
        type: "safety_gate",
        stage: "input",
        safetyMode: "default_and_custom",
        safetySeverityThreshold: "medium",
        safetyFallbackResponse: "Posso ajudar sem processar dados sensíveis.",
        safetyRules: [
          {
            id: "privacy_request",
            label: "Dados pessoais",
            match: "cpf",
            matchType: "contains",
            category: "privacy",
            severity: "high",
            action: "safe_redirect",
            safeResponse: "Não posso processar CPF, mas posso orientar sem dados sensíveis.",
          },
        ],
      },
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

  await generateLangGraphRuntime({ flow, flowRoot, outDir });
  const graph = await readFile(path.join(outDir, "app", "graph.py"), "utf-8");
  assert.match(graph, /\\"safetyMode\\": \\"default_and_custom\\"/);
  assert.match(graph, /\\"safetyRules\\"/);
  await writeFile(
    path.join(outDir, "tests", "test_safety_harness_rules.py"),
    `from fastapi.testclient import TestClient

from app.generated_flow import API_RESOURCE
from tests.conftest import set_test_env


def _path(suffix: str = "") -> str:
    return f"/{API_RESOURCE}{suffix}"


def _client(tmp_path):
    set_test_env(str(tmp_path / "safety-harness.db"))
    from app.db import engine
    from app.main import create_app
    from app.models import Base

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestClient(create_app())


def test_configurable_safety_rule_blocks_before_llm(tmp_path):
    client = _client(tmp_path)
    create_resp = client.post(_path(), headers={"Idempotency-Key": "create"}, json={"max_turns": 2})
    session_id = create_resp.json()["session"]["session_id"]
    client.post(_path(f"/{session_id}/start"), headers={"Idempotency-Key": "start"}, json={})

    turn_resp = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "turn"},
        json={"user_message": "meu cpf é 123 e quero usar no cadastro"},
    )
    assert turn_resp.status_code == 200
    data = turn_resp.json()
    assert data["assistant_message"] == {
        "code": "SEG",
        "text": "Não posso processar CPF, mas posso orientar sem dados sensíveis.",
    }
    assert data["session"]["phase"] == "safety"
    assert data["safety"]["blocked"] is True
    assert data["safety"]["decision"] == "safe_redirect"
    assert data["safety"]["category"] == "privacy"
    assert data["safety"]["severity"] == "high"
    assert data["safety"]["action"] == "safe_redirect"
    assert data["safety"]["rule_id"] == "privacy_request"
    assert data["safety"]["rule_label"] == "Dados pessoais"
    assert data["safety"]["match_type"] == "contains"
    assert data["safety"]["matched_text"] == "cpf"
    assert data["safety"]["node_id"] == "input_safety_check"
    assert data["safety"]["stage"] == "input"

    events = client.get(_path(f"/{session_id}/events")).json()
    event_types = [item["event_type"] for item in events]
    assert "llm_called" not in event_types
`,
    "utf-8",
  );

  await execFileAsync("python", ["-m", "pytest", "-q", outDir], {
    cwd: outDir,
    timeout: 120000,
  });
});

test("generated runtime executes TypeScript custom code node files", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-codegen-custom-code-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const flowRoot = path.join(workspaceRoot, "flow");
  const outDir = path.join(workspaceRoot, "runtime");
  await writeFlowAssets(flowRoot, "Agente com código customizado");
  await mkdir(path.join(flowRoot, "code"), { recursive: true });
  await writeFile(
    path.join(flowRoot, "code", "generateQuestions.ts"),
    `export async function generateQuestions(input: string, context: { node_id: string; session_id: string; input_path: string }) {
  const text = String(input || "");
  return {
    question_count: 2,
    questions: [
      "Qual é o ponto principal de " + text.slice(0, 24) + "?",
      "Qual detalhe precisa ser confirmado?",
    ],
    node: context.node_id,
    session_id: context.session_id,
    input_path: context.input_path,
  };
}
`,
    "utf-8",
  );

  const flow: AgentFlow = {
    ...simpleFlow("custom-code-agent", "Agente Código Customizado"),
    nodes: [
      { id: "start_node", type: "start" },
      { id: "input_safety_check", type: "safety_gate", stage: "input" },
      { id: "llm_step", type: "llm_prompt", promptId: "system" },
      {
        id: "generate_questions",
        type: "code",
        codeLanguage: "typescript",
        codeExecution: "file",
        codePath: "code/generateQuestions.ts",
        codeEntry: "generateQuestions",
        codeDependencies: "zod@^3.23.0",
        inputPath: "assistant_message.text",
        resultPath: "custom.generated_questions",
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
      { from: "llm_step", to: "generate_questions" },
      { from: "generate_questions", to: "end" },
      { from: "finish_node", to: "end" },
    ],
  };

  await generateLangGraphRuntime({ flow, flowRoot, outDir });
  const graph = await readFile(path.join(outDir, "app", "graph.py"), "utf-8");
  assert.match(graph, /CODE_NODE_IDS/);
  assert.match(graph, /custom_code_executed/);
  assert.match(graph, /\\"codeLanguage\\": \\"typescript\\"/);
  assert.match(graph, /execute_custom_node_code/);
  const codePackage = JSON.parse(await readFile(path.join(outDir, "app", "code", "package.json"), "utf-8"));
  assert.equal(codePackage.type, "module");
  assert.equal(codePackage.dependencies.typescript, "^5.8.0");
  assert.equal(codePackage.dependencies.zod, "^3.23.0");
  await writeFile(
    path.join(outDir, "tests", "test_typescript_custom_code_nodes.py"),
    `from fastapi.testclient import TestClient

from app.generated_flow import API_RESOURCE
from tests.conftest import set_test_env


def _path(suffix: str = "") -> str:
    return f"/{API_RESOURCE}{suffix}"


def _client(tmp_path):
    set_test_env(str(tmp_path / "custom-code.db"))
    from app.db import engine
    from app.main import create_app
    from app.models import Base

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestClient(create_app())


def test_typescript_custom_code_executes_and_records_output(tmp_path):
    client = _client(tmp_path)
    create_resp = client.post(_path(), headers={"Idempotency-Key": "create"}, json={"max_turns": 2})
    session_id = create_resp.json()["session"]["session_id"]
    client.post(_path(f"/{session_id}/start"), headers={"Idempotency-Key": "start"}, json={})

    turn_resp = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "turn"},
        json={"user_message": "gere perguntas"},
    )
    assert turn_resp.status_code == 200

    events = client.get(_path(f"/{session_id}/events")).json()
    by_type = {item["event_type"]: item for item in events}
    custom = by_type["custom_code_executed"]["payload"]["custom"]
    assert custom["ok"] is True
    assert custom["status"] == "custom_code_executed"
    assert custom["node_id"] == "generate_questions"
    assert custom["contract"]["language"] == "typescript"
    assert custom["contract"]["execution"] == "file"
    assert custom["contract"]["path"] == "code/generateQuestions.ts"
    assert custom["contract"]["entry"] == "generateQuestions"
    assert custom["contract"]["input_path"] == "assistant_message.text"
    assert custom["contract"]["dependencies"] == "zod@^3.23.0"
    assert custom["execution_log"]["mode"] == "file"
    assert custom["execution_log"]["status"] == "custom_code_executed"
    assert custom["execution_log"]["target"] == "code/generateQuestions.ts"
    assert custom["span"]["name"] == "custom_code.file"
    assert custom["span"]["status"] == "ok"
    assert custom["output"]["question_count"] == 2
    assert len(custom["output"]["questions"]) == 2
    assert custom["output"]["node"] == "generate_questions"
    assert custom["output"]["session_id"] == session_id
    assert custom["output"]["input_path"] == "assistant_message.text"
`,
    "utf-8",
  );

  await execFileAsync("python", ["-m", "pytest", "-q", outDir], {
    cwd: outDir,
    timeout: 120000,
  });
});

test("generated runtime executes Python custom code node files", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-codegen-python-code-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const flowRoot = path.join(workspaceRoot, "flow");
  const outDir = path.join(workspaceRoot, "runtime");
  await writeFlowAssets(flowRoot, "Agente com código Python");
  await mkdir(path.join(flowRoot, "code"), { recursive: true });
  await writeFile(
    path.join(flowRoot, "code", "generate_questions.py"),
    `def generate_questions(input_value, context):
    text = str(input_value or "")
    return {
        "question_count": 2,
        "questions": [
            f"Qual é o ponto principal de {text[:24]}?",
            "Qual detalhe precisa ser confirmado?",
        ],
        "node": context["node_id"],
        "session_id": context["session_id"],
    }
`,
    "utf-8",
  );

  const flow: AgentFlow = {
    ...simpleFlow("python-code-agent", "Agente Código Python"),
    nodes: [
      { id: "start_node", type: "start" },
      { id: "input_safety_check", type: "safety_gate", stage: "input" },
      { id: "llm_step", type: "llm_prompt", promptId: "system" },
      {
        id: "generate_questions",
        type: "code",
        codeLanguage: "python",
        codeExecution: "file",
        codePath: "code/generate_questions.py",
        codeEntry: "generate_questions",
        inputPath: "assistant_message.text",
        resultPath: "custom.generated_questions",
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
      { from: "llm_step", to: "generate_questions" },
      { from: "generate_questions", to: "end" },
      { from: "finish_node", to: "end" },
    ],
  };

  await generateLangGraphRuntime({ flow, flowRoot, outDir });
  await readFile(path.join(outDir, "app", "code", "generate_questions.py"), "utf-8");
  const graph = await readFile(path.join(outDir, "app", "graph.py"), "utf-8");
  assert.match(graph, /custom_code_executed/);
  await writeFile(
    path.join(outDir, "tests", "test_python_custom_code_nodes.py"),
    `from fastapi.testclient import TestClient

from app.generated_flow import API_RESOURCE
from tests.conftest import set_test_env


def _path(suffix: str = "") -> str:
    return f"/{API_RESOURCE}{suffix}"


def _client(tmp_path):
    set_test_env(str(tmp_path / "python-code.db"))
    from app.db import engine
    from app.main import create_app
    from app.models import Base

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestClient(create_app())


def test_python_custom_code_executes_and_records_output(tmp_path):
    client = _client(tmp_path)
    create_resp = client.post(_path(), headers={"Idempotency-Key": "create"}, json={"max_turns": 2})
    session_id = create_resp.json()["session"]["session_id"]
    client.post(_path(f"/{session_id}/start"), headers={"Idempotency-Key": "start"}, json={})

    turn_resp = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "turn"},
        json={"user_message": "conteúdo para perguntas"},
    )
    assert turn_resp.status_code == 200

    events = client.get(_path(f"/{session_id}/events")).json()
    by_type = {item["event_type"]: item for item in events}
    custom = by_type["custom_code_executed"]["payload"]["custom"]
    assert custom["ok"] is True
    assert custom["status"] == "custom_code_executed"
    assert custom["node_id"] == "generate_questions"
    assert custom["contract"]["language"] == "python"
    assert custom["contract"]["execution"] == "file"
    assert custom["contract"]["path"] == "code/generate_questions.py"
    assert custom["output"]["question_count"] == 2
    assert len(custom["output"]["questions"]) == 2
    assert custom["output"]["node"] == "generate_questions"
    assert custom["output"]["session_id"] == session_id
`,
    "utf-8",
  );

  await execFileAsync("python", ["-m", "pytest", "-q", outDir], {
    cwd: outDir,
    timeout: 120000,
  });
});

test("generated runtime executes Bash custom code node files", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-codegen-bash-code-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const flowRoot = path.join(workspaceRoot, "flow");
  const outDir = path.join(workspaceRoot, "runtime");
  await writeFlowAssets(flowRoot, "Agente com código Bash");
  await mkdir(path.join(flowRoot, "code"), { recursive: true });
  await writeFile(
    path.join(flowRoot, "code", "generate_questions.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'payload="$(cat)"',
      'printf \'%s\' "$payload" > shell_payload_seen.json',
      'printf \'%s\' "shell touched workspace" > shell_wrote.txt',
      `printf '{"ok":true,"output":{"question_count":2,"questions":["Qual é o ponto principal?","Qual detalhe precisa ser confirmado?"],"node":"shell_questions","workspace_file":"shell_wrote.txt","payload_bytes":%s,"sandbox_env":"%s"}}\\n' "\${#payload}" "\${AGENT_FLOW_SANDBOX_ISOLATION:-}"`,
      "",
    ].join("\n"),
    "utf-8",
  );

  const flow: AgentFlow = {
    ...simpleFlow("bash-code-agent", "Agente Código Bash"),
    nodes: [
      { id: "start_node", type: "start" },
      { id: "input_safety_check", type: "safety_gate", stage: "input" },
      { id: "llm_step", type: "llm_prompt", promptId: "system" },
      {
        id: "shell_questions",
        type: "code",
        codeLanguage: "bash",
        codeExecution: "file",
        codePath: "code/generate_questions.sh",
        inputPath: "assistant_message.text",
        resultPath: "custom.shell_questions",
        timeoutSeconds: 5,
        sandboxIsolation: "ephemeral_workspace",
        sandboxEnvAllowlist: ["PATH"],
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
      { from: "llm_step", to: "shell_questions" },
      { from: "shell_questions", to: "end" },
      { from: "finish_node", to: "end" },
    ],
  };

  await generateLangGraphRuntime({ flow, flowRoot, outDir });
  await readFile(path.join(outDir, "app", "code", "generate_questions.sh"), "utf-8");
  const graph = await readFile(path.join(outDir, "app", "graph.py"), "utf-8");
  assert.match(graph, /execute_custom_shell_code/);
  assert.match(graph, /\\"codeLanguage\\": \\"bash\\"/);
  await writeFile(
    path.join(outDir, "tests", "test_bash_custom_code_nodes.py"),
    `from pathlib import Path

from fastapi.testclient import TestClient

from app.generated_flow import API_RESOURCE
from tests.conftest import set_test_env


def _path(suffix: str = "") -> str:
    return f"/{API_RESOURCE}{suffix}"


def _client(tmp_path):
    set_test_env(str(tmp_path / "bash-code.db"))
    from app.db import engine
    from app.main import create_app
    from app.models import Base

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestClient(create_app())


def test_bash_custom_code_executes_and_records_output(tmp_path):
    client = _client(tmp_path)
    create_resp = client.post(_path(), headers={"Idempotency-Key": "create"}, json={"max_turns": 2})
    session_id = create_resp.json()["session"]["session_id"]
    client.post(_path(f"/{session_id}/start"), headers={"Idempotency-Key": "start"}, json={})

    turn_resp = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "turn"},
        json={"user_message": "conteúdo para perguntas"},
    )
    assert turn_resp.status_code == 200

    events = client.get(_path(f"/{session_id}/events")).json()
    by_type = {item["event_type"]: item for item in events}
    custom = by_type["custom_code_executed"]["payload"]["custom"]
    assert custom["ok"] is True
    assert custom["status"] == "custom_code_executed"
    assert custom["node_id"] == "shell_questions"
    assert custom["contract"]["language"] == "bash"
    assert custom["contract"]["execution"] == "file"
    assert custom["contract"]["path"] == "code/generate_questions.sh"
    assert custom["contract"]["sandbox_isolation"] == "ephemeral_workspace"
    assert custom["contract"]["sandbox_env_allowlist"] == ["PATH"]
    assert custom["execution_log"]["mode"] == "file"
    assert custom["execution_log"]["status"] == "custom_code_executed"
    assert custom["execution_log"]["exit_code"] == 0
    assert custom["execution_log"]["target"] == "code/generate_questions.sh"
    assert custom["execution_log"]["sandbox_isolation"] == "ephemeral_workspace"
    assert custom["execution_log"]["sandbox_requested_isolation"] == "ephemeral_workspace"
    assert custom["execution_log"]["sandbox_base_isolation"] == "shell_process"
    assert custom["execution_log"]["sandbox_boundary"] == "process_workspace"
    assert custom["execution_log"]["sandbox_executor"] == "bash"
    assert custom["execution_log"]["sandbox_transport"] == "stdin_stdout_json"
    assert custom["execution_log"]["sandbox_workspace"] == "temporary_copy"
    assert custom["execution_log"]["sandbox_cleanup"] == "after_execution"
    assert custom["sandbox"]["isolation"] == "ephemeral_workspace"
    assert custom["sandbox"]["base_isolation"] == "shell_process"
    assert custom["sandbox"]["executor"] == "bash"
    assert custom["span"]["name"] == "custom_code.file"
    assert custom["span"]["status"] == "ok"
    assert custom["output"]["question_count"] == 2
    assert len(custom["output"]["questions"]) == 2
    assert custom["output"]["node"] == "shell_questions"
    assert custom["output"]["payload_bytes"] > 0
    runtime_root = Path(__file__).resolve().parents[1]
    assert not (runtime_root / "app" / "code" / "shell_wrote.txt").exists()
    assert not (runtime_root / "app" / "code" / "shell_payload_seen.json").exists()
`,
    "utf-8",
  );

  await execFileAsync("python", ["-m", "pytest", "-q", path.join(outDir, "tests", "test_bash_custom_code_nodes.py")], {
    cwd: outDir,
    timeout: 120000,
  });
});

test("generated runtime executes Python custom code in a dedicated process workspace", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-codegen-python-dedicated-code-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const flowRoot = path.join(workspaceRoot, "flow");
  const outDir = path.join(workspaceRoot, "runtime");
  await writeFlowAssets(flowRoot, "Agente Código Python Isolado");
  await mkdir(path.join(flowRoot, "code"), { recursive: true });
  await writeFile(
    path.join(flowRoot, "code", "generate_questions.py"),
    `from pathlib import Path
import os


def generate_questions(input_value, context, contract):
    marker = Path("worker_wrote.txt")
    marker.write_text("worker only", encoding="utf-8")
    text = str(input_value or "")
    return {
        "question_count": 2,
        "questions": [
            f"Qual é o ponto principal de {text[:24]}?",
            "Qual detalhe precisa ser confirmado?",
        ],
        "node": context["node_id"],
        "session_id": context["session_id"],
        "input_path": context["input_path"],
        "marker_exists_inside_worker": marker.exists(),
        "env_visible": os.environ.get("CUSTOM_VISIBLE_ENV"),
        "sandbox_env": os.environ.get("AGENT_FLOW_SANDBOX_ISOLATION"),
        "contract_isolation": contract.get("sandbox_isolation"),
    }
`,
    "utf-8",
  );

  const flow: AgentFlow = {
    ...simpleFlow("python-dedicated-code-agent", "Agente Código Python Isolado"),
    nodes: [
      { id: "start_node", type: "start" },
      { id: "input_safety_check", type: "safety_gate", stage: "input" },
      { id: "llm_step", type: "llm_prompt", promptId: "system" },
      {
        id: "generate_questions",
        type: "code",
        codeLanguage: "python",
        codeExecution: "file",
        codePath: "code/generate_questions.py",
        codeEntry: "generate_questions",
        inputPath: "assistant_message.text",
        resultPath: "custom.generated_questions",
        sandboxIsolation: "dedicated_process",
        sandboxEnvAllowlist: ["CUSTOM_VISIBLE_ENV"],
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
      { from: "llm_step", to: "generate_questions" },
      { from: "generate_questions", to: "end" },
      { from: "finish_node", to: "end" },
    ],
  };

  await generateLangGraphRuntime({ flow, flowRoot, outDir });
  await writeFile(
    path.join(outDir, "tests", "test_python_dedicated_process_custom_code_nodes.py"),
    `import os
from pathlib import Path

from fastapi.testclient import TestClient

from app.generated_flow import API_RESOURCE
from tests.conftest import set_test_env


def _path(suffix: str = "") -> str:
    return f"/{API_RESOURCE}{suffix}"


def _client(tmp_path):
    set_test_env(str(tmp_path / "python-dedicated-code.db"))
    from app.db import engine
    from app.main import create_app
    from app.models import Base

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestClient(create_app())


def test_python_custom_code_uses_dedicated_process_workspace(tmp_path):
    os.environ["CUSTOM_VISIBLE_ENV"] = "visible"
    client = _client(tmp_path)
    create_resp = client.post(_path(), headers={"Idempotency-Key": "create"}, json={"max_turns": 2})
    session_id = create_resp.json()["session"]["session_id"]
    client.post(_path(f"/{session_id}/start"), headers={"Idempotency-Key": "start"}, json={})

    turn_resp = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "turn"},
        json={"user_message": "conteúdo para perguntas"},
    )
    assert turn_resp.status_code == 200

    persistent_marker = Path(__file__).resolve().parents[1] / "app" / "code" / "worker_wrote.txt"
    assert not persistent_marker.exists()

    events = client.get(_path(f"/{session_id}/events")).json()
    by_type = {item["event_type"]: item for item in events}
    custom = by_type["custom_code_executed"]["payload"]["custom"]
    assert custom["ok"] is True
    assert custom["status"] == "custom_code_executed"
    assert custom["output"]["question_count"] == 2
    assert custom["output"]["marker_exists_inside_worker"] is True
    assert custom["output"]["env_visible"] == "visible"
    assert custom["output"]["sandbox_env"] == "dedicated_process"
    assert custom["output"]["contract_isolation"] == "dedicated_process"
    assert custom["execution_log"]["mode"] == "file"
    assert custom["execution_log"]["sandbox_isolation"] == "dedicated_process"
    assert custom["execution_log"]["sandbox_boundary"] == "process_workspace"
    assert custom["execution_log"]["sandbox_transport"] == "stdin_stdout_json"
    assert custom["execution_log"]["sandbox_base_isolation"] == "runtime_process"
    assert custom["execution_log"]["sandbox_workspace"] == "temporary_copy"
    assert custom["execution_log"]["sandbox_cleanup"] == "after_execution"
    assert custom["execution_log"]["exit_code"] == 0
    assert custom["sandbox"]["isolation"] == "dedicated_process"
    assert custom["sandbox"]["workspace"] == "temporary_copy"
`,
    "utf-8",
  );

  await execFileAsync("python", ["-m", "pytest", "-q", outDir], {
    cwd: outDir,
    timeout: 120000,
  });
});

test("generated runtime reports missing container image for container-isolated Python code nodes", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-codegen-python-container-code-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const flowRoot = path.join(workspaceRoot, "flow");
  const outDir = path.join(workspaceRoot, "runtime");
  await writeFlowAssets(flowRoot, "Agente Código Container");

  const flow: AgentFlow = {
    ...simpleFlow("python-container-code-agent", "Agente Código Container"),
    nodes: [
      { id: "start_node", type: "start" },
      { id: "input_safety_check", type: "safety_gate", stage: "input" },
      { id: "llm_step", type: "llm_prompt", promptId: "system" },
      {
        id: "container_questions",
        type: "code",
        codeLanguage: "python",
        codeExecution: "inline",
        codeEntry: "run",
        codeInline: "def run(value, context, contract):\n    return {'value': value, 'isolation': contract.get('sandbox_isolation')}\n",
        inputPath: "assistant_message.text",
        resultPath: "custom.container_questions",
        sandboxIsolation: "container",
        sandboxContainerEngine: "docker",
        sandboxContainerProfile: "hardened",
        sandboxContainerMemory: "768m",
        sandboxContainerCpus: "0.5",
        sandboxContainerPidsLimit: 64,
        sandboxContainerReadOnlyRootfs: true,
        sandboxContainerDropCapabilities: true,
        sandboxContainerNoNewPrivileges: true,
        sandboxEnvAllowlist: ["CUSTOM_VISIBLE_ENV"],
      },
      { id: "finish_node", type: "end" },
    ],
    edges: [
      { from: "start", to: "start_node", condition: "action == 'start'" },
      { from: "start", to: "input_safety_check", condition: "action == 'turn'" },
      { from: "start_node", to: "end" },
      { from: "input_safety_check", to: "llm_step", condition: "safety.decision == 'allow'" },
      { from: "input_safety_check", to: "end", condition: "safety.blocked == true" },
      { from: "llm_step", to: "container_questions" },
      { from: "container_questions", to: "end" },
      { from: "finish_node", to: "end" },
    ],
  };

  await generateLangGraphRuntime({ flow, flowRoot, outDir });
  const graph = await readFile(path.join(outDir, "app", "graph.py"), "utf-8");
  assert.match(graph, /execute_custom_python_container/);
  assert.match(graph, /\\"sandboxIsolation\\": \\"container\\"/);
  assert.match(graph, /\\"sandboxContainerEngine\\": \\"docker\\"/);
  assert.match(graph, /\\"sandboxContainerProfile\\": \\"hardened\\"/);
  assert.match(graph, /\\"sandboxContainerMemory\\": \\"768m\\"/);
  assert.match(graph, /\\"sandboxContainerPidsLimit\\": 64/);
  await writeFile(
    path.join(outDir, "tests", "test_python_container_custom_code_nodes.py"),
    `from fastapi.testclient import TestClient

from app.generated_flow import API_RESOURCE
from tests.conftest import set_test_env


def _path(suffix: str = "") -> str:
    return f"/{API_RESOURCE}{suffix}"


def _client(tmp_path):
    set_test_env(str(tmp_path / "container-code.db"))
    from app.db import engine
    from app.main import create_app
    from app.models import Base

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestClient(create_app())


def test_python_container_isolation_requires_image_without_local_fallback(tmp_path, monkeypatch):
    monkeypatch.delenv("AGENT_FLOW_CODE_CONTAINER_IMAGE", raising=False)
    client = _client(tmp_path)
    create_resp = client.post(_path(), headers={"Idempotency-Key": "create"}, json={"max_turns": 2})
    session_id = create_resp.json()["session"]["session_id"]
    client.post(_path(f"/{session_id}/start"), headers={"Idempotency-Key": "start"}, json={})

    turn_resp = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "turn"},
        json={"user_message": "gere perguntas"},
    )
    assert turn_resp.status_code == 200
    events = client.get(_path(f"/{session_id}/events")).json()
    custom_events = [
        item for item in events
        if item.get("payload", {}).get("custom", {}).get("status") == "custom_code_not_executed"
    ]
    assert custom_events
    custom = custom_events[-1]["payload"]["custom"]
    assert custom["ok"] is False
    assert custom["status"] == "custom_code_not_executed"
    assert custom["reason"] == "container_image_not_configured"
    assert custom["contract"]["sandbox_isolation"] == "container"
    assert custom["contract"]["sandbox_container_engine"] == "docker"
    assert custom["contract"]["sandbox_container_profile"] == "hardened"
    assert custom["contract"]["sandbox_container_memory"] == "768m"
    assert custom["contract"]["sandbox_container_cpus"] == "0.5"
    assert custom["contract"]["sandbox_container_pids_limit"] == 64
    assert custom["execution_log"]["sandbox_isolation"] == "container"
    assert custom["execution_log"]["sandbox_boundary"] == "container"
    assert custom["execution_log"]["sandbox_engine"] == "docker"
    assert custom["execution_log"]["sandbox_requested_isolation"] == "container"
    assert custom["sandbox"]["isolation"] == "container"
    assert custom["sandbox"]["boundary"] == "container"
    assert custom["sandbox"]["engine"] == "docker"
    assert custom["sandbox"]["network"] == "none"
    assert custom["sandbox"]["profile"] == "hardened"
    assert custom["sandbox"]["policy"]["memory"] == "768m"
    assert custom["sandbox"]["policy"]["cpus"] == "0.5"
    assert custom["sandbox"]["policy"]["pids_limit"] == 64
    assert custom["sandbox"]["policy"]["read_only_rootfs"] is True
    assert custom["sandbox"]["policy"]["drop_capabilities"] is True
    assert custom["sandbox"]["policy"]["no_new_privileges"] is True
`,
    "utf-8",
  );

  await execFileAsync("python", ["-m", "pytest", "-q", outDir], {
    cwd: outDir,
    timeout: 120000,
  });
});

test("generated runtime reports missing VM runner for VM-isolated Python code nodes", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-codegen-python-vm-code-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const flowRoot = path.join(workspaceRoot, "flow");
  const outDir = path.join(workspaceRoot, "runtime");
  await writeFlowAssets(flowRoot, "Agente Código VM");

  const flow: AgentFlow = {
    ...simpleFlow("python-vm-code-agent", "Agente Código VM"),
    nodes: [
      { id: "start_node", type: "start" },
      { id: "input_safety_check", type: "safety_gate", stage: "input" },
      { id: "llm_step", type: "llm_prompt", promptId: "system" },
      {
        id: "vm_questions",
        type: "code",
        codeLanguage: "python",
        codeExecution: "inline",
        codeEntry: "run",
        codeInline: "def run(value, context, contract):\n    return {'value': value, 'isolation': contract.get('sandbox_isolation')}\n",
        inputPath: "assistant_message.text",
        resultPath: "custom.vm_questions",
        sandboxIsolation: "vm",
        sandboxVmImageId: "python-qemu-microvm",
        sandboxVmEngine: "qemu",
        sandboxVmRunnerManifest: ".agent-flow/vm-runners/agent-flow-vm-runner.manifest.json",
        sandboxVmImageManifest: "images/agent-flow-python.afvmimage.json",
        sandboxVmProfile: "hardened",
        sandboxVmImage: "images/agent-flow-python.qcow2",
        sandboxVmMemory: "1536m",
        sandboxVmCpus: "2",
        sandboxVmArgs: ["--engine", "qemu"],
      },
      { id: "finish_node", type: "end" },
    ],
    edges: [
      { from: "start", to: "start_node", condition: "action == 'start'" },
      { from: "start", to: "input_safety_check", condition: "action == 'turn'" },
      { from: "start_node", to: "end" },
      { from: "input_safety_check", to: "llm_step", condition: "safety.decision == 'allow'" },
      { from: "input_safety_check", to: "end", condition: "safety.blocked == true" },
      { from: "llm_step", to: "vm_questions" },
      { from: "vm_questions", to: "end" },
      { from: "finish_node", to: "end" },
    ],
  };

  await generateLangGraphRuntime({ flow, flowRoot, outDir });
  const graph = await readFile(path.join(outDir, "app", "graph.py"), "utf-8");
  assert.match(graph, /execute_custom_vm_code/);
  assert.match(graph, /\\"sandboxIsolation\\": \\"vm\\"/);
  assert.match(graph, /\\"sandboxVmImageId\\": \\"python-qemu-microvm\\"/);
  assert.match(graph, /\\"sandboxVmEngine\\": \\"qemu\\"/);
  assert.match(graph, /\\"sandboxVmRunnerManifest\\": \\"\.agent-flow\/vm-runners\/agent-flow-vm-runner\.manifest\.json\\"/);
  assert.match(graph, /\\"sandboxVmImageManifest\\": \\"images\/agent-flow-python\.afvmimage\.json\\"/);
  assert.match(graph, /\\"sandboxVmProfile\\": \\"hardened\\"/);
  assert.match(graph, /\\"sandboxVmMemory\\": \\"1536m\\"/);
  assert.match(graph, /\\"sandboxVmCpus\\": \\"2\\"/);
  await writeFile(
    path.join(outDir, "tests", "test_python_vm_custom_code_nodes.py"),
    `from fastapi.testclient import TestClient

from app.generated_flow import API_RESOURCE
from tests.conftest import set_test_env


def _path(suffix: str = "") -> str:
    return f"/{API_RESOURCE}{suffix}"


def _client(tmp_path):
    set_test_env(str(tmp_path / "vm-code.db"))
    from app.db import engine
    from app.main import create_app
    from app.models import Base

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestClient(create_app())


def test_python_vm_isolation_requires_runner_without_local_fallback(tmp_path, monkeypatch):
    monkeypatch.delenv("AGENT_FLOW_CODE_VM_RUNNER", raising=False)
    monkeypatch.delenv("AGENT_FLOW_CODE_VM_IMAGE", raising=False)
    client = _client(tmp_path)
    create_resp = client.post(_path(), headers={"Idempotency-Key": "create"}, json={"max_turns": 2})
    session_id = create_resp.json()["session"]["session_id"]
    client.post(_path(f"/{session_id}/start"), headers={"Idempotency-Key": "start"}, json={})

    turn_resp = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "turn"},
        json={"user_message": "gere perguntas"},
    )
    assert turn_resp.status_code == 200
    events = client.get(_path(f"/{session_id}/events")).json()
    custom_events = [
        item for item in events
        if item.get("payload", {}).get("custom", {}).get("status") == "custom_code_not_executed"
    ]
    assert custom_events
    custom = custom_events[-1]["payload"]["custom"]
    assert custom["ok"] is False
    assert custom["status"] == "custom_code_not_executed"
    assert custom["reason"] == "vm_runner_not_configured"
    assert custom["contract"]["sandbox_isolation"] == "vm"
    assert custom["contract"]["sandbox_vm_profile"] == "hardened"
    assert custom["contract"]["sandbox_vm_image"] == "images/agent-flow-python.qcow2"
    assert custom["contract"]["sandbox_vm_memory"] == "1536m"
    assert custom["contract"]["sandbox_vm_cpus"] == "2"
    assert custom["execution_log"]["sandbox_isolation"] == "vm"
    assert custom["execution_log"]["sandbox_boundary"] == "microvm"
    assert custom["execution_log"]["sandbox_profile"] == "hardened"
    assert custom["execution_log"]["sandbox_requested_isolation"] == "vm"
    assert custom["sandbox"]["isolation"] == "vm"
    assert custom["sandbox"]["boundary"] == "microvm"
    assert custom["sandbox"]["engine"] == "vm_runner"
    assert custom["sandbox"]["profile"] == "hardened"
    assert custom["sandbox"]["image"] == "images/agent-flow-python.qcow2"
    assert custom["sandbox"]["policy"]["memory"] == "1536m"
    assert custom["sandbox"]["policy"]["cpus"] == "2"
`,
    "utf-8",
  );

  await execFileAsync("python", ["-m", "pytest", "-q", outDir], {
    cwd: outDir,
    timeout: 120000,
  });
});

test("generated runtime executes VM-isolated Bash code nodes through the VM runner contract", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-codegen-bash-vm-code-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const flowRoot = path.join(workspaceRoot, "flow");
  const outDir = path.join(workspaceRoot, "runtime");
  await writeFlowAssets(flowRoot, "Agente Bash VM");

  const flow: AgentFlow = {
    ...simpleFlow("bash-vm-code-agent", "Agente Bash VM"),
    nodes: [
      { id: "start_node", type: "start" },
      { id: "input_safety_check", type: "safety_gate", stage: "input" },
      { id: "llm_step", type: "llm_prompt", promptId: "system" },
      {
        id: "vm_shell_questions",
        type: "code",
        codeLanguage: "bash",
        codeExecution: "inline",
        codeEntry: "run",
        codeInline: "read -r payload\nprintf '%s' \"$payload\"\n",
        inputPath: "assistant_message.text",
        resultPath: "custom.vm_shell_questions",
        sandboxIsolation: "vm",
        sandboxVmRunner: "python",
        sandboxVmArgs: ["vm_runner_stub.py"],
        sandboxVmImageId: "bash-qemu-microvm",
        sandboxVmProfile: "hardened",
        sandboxVmImage: "images/agent-flow-bash.qcow2",
        sandboxVmMemory: "512m",
        sandboxVmCpus: "1",
      },
      { id: "finish_node", type: "end" },
    ],
    edges: [
      { from: "start", to: "start_node", condition: "action == 'start'" },
      { from: "start", to: "input_safety_check", condition: "action == 'turn'" },
      { from: "start_node", to: "end" },
      { from: "input_safety_check", to: "llm_step", condition: "safety.decision == 'allow'" },
      { from: "input_safety_check", to: "end", condition: "safety.blocked == true" },
      { from: "llm_step", to: "vm_shell_questions" },
      { from: "vm_shell_questions", to: "end" },
      { from: "finish_node", to: "end" },
    ],
  };

  await generateLangGraphRuntime({ flow, flowRoot, outDir });
  const graph = await readFile(path.join(outDir, "app", "graph.py"), "utf-8");
  assert.match(graph, /execute_custom_vm_code/);
  assert.match(graph, /\\"codeLanguage\\": \\"bash\\"/);
  assert.match(graph, /\\"sandboxIsolation\\": \\"vm\\"/);
  assert.doesNotMatch(graph, /shell_vm_not_supported/);
  await writeFile(
    path.join(outDir, "app", "code", "vm_runner_stub.py"),
    [
      "import json",
      "import os",
      "import pathlib",
      "import sys",
      "",
      "request = json.loads(sys.stdin.read() or '{}')",
      "workspace = pathlib.Path(request.get('workspace') or '.')",
      "output = {",
      "    'language': request.get('language'),",
      "    'workspace_isolation': request.get('workspaceIsolation'),",
      "    'vm_profile': (request.get('vm') or {}).get('profile'),",
      "    'vm_image': (request.get('vm') or {}).get('image'),",
      "    'inline_contains_read': 'read -r payload' in str(request.get('inlineSource') or ''),",
      "    'workspace_has_runner': (workspace / 'vm_runner_stub.py').exists(),",
      "    'contract_isolation': (request.get('contract') or {}).get('sandbox_isolation'),",
      "}",
      "provides_isolation = os.environ.get('AGENT_FLOW_TEST_VM_UNVERIFIED') != '1'",
      "print(json.dumps({'ok': True, 'output': output, 'stdout': 'vm bash ok', 'providesVmIsolation': provides_isolation}))",
      "",
    ].join("\n"),
    "utf-8",
  );
  await writeFile(
    path.join(outDir, "tests", "test_bash_vm_custom_code_nodes.py"),
    `from fastapi.testclient import TestClient

from app.generated_flow import API_RESOURCE
from tests.conftest import set_test_env


def _path(suffix: str = "") -> str:
    return f"/{API_RESOURCE}{suffix}"


def _client(tmp_path):
    set_test_env(str(tmp_path / "bash-vm-code.db"))
    from app.db import engine
    from app.main import create_app
    from app.models import Base

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestClient(create_app())


def test_bash_vm_isolation_uses_runner_contract(tmp_path):
    client = _client(tmp_path)
    create_resp = client.post(_path(), headers={"Idempotency-Key": "create"}, json={"max_turns": 2})
    session_id = create_resp.json()["session"]["session_id"]
    client.post(_path(f"/{session_id}/start"), headers={"Idempotency-Key": "start"}, json={})

    turn_resp = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "turn"},
        json={"user_message": "gere perguntas"},
    )
    assert turn_resp.status_code == 200
    events = client.get(_path(f"/{session_id}/events")).json()
    custom_events = [
        item for item in events
        if item.get("payload", {}).get("custom", {}).get("status") == "custom_code_executed"
    ]
    assert custom_events
    custom = custom_events[-1]["payload"]["custom"]
    assert custom["ok"] is True
    assert custom["status"] == "custom_code_executed"
    assert custom["vm_runner_provides_isolation"] is True
    assert custom["node_id"] == "vm_shell_questions"
    assert custom["contract"]["language"] == "bash"
    assert custom["contract"]["sandbox_isolation"] == "vm"
    assert custom["contract"]["sandbox_vm_runner"] == "python"
    assert custom["contract"]["sandbox_vm_profile"] == "hardened"
    assert custom["output"]["language"] == "bash"
    assert custom["output"]["workspace_isolation"] == "vm"
    assert custom["output"]["vm_profile"] == "hardened"
    assert custom["output"]["vm_image"] == "images/agent-flow-bash.qcow2"
    assert custom["output"]["inline_contains_read"] is True
    assert custom["output"]["workspace_has_runner"] is True
    assert custom["output"]["contract_isolation"] == "vm"
    assert custom["execution_log"]["sandbox_isolation"] == "vm"
    assert custom["execution_log"]["sandbox_requested_isolation"] == "vm"
    assert custom["execution_log"]["sandbox_base_isolation"] == "shell_process"
    assert custom["execution_log"]["sandbox_boundary"] == "microvm"
    assert custom["execution_log"]["sandbox_executor"] == "bash"
    assert custom["execution_log"]["sandbox_profile"] == "hardened"
    assert custom["sandbox"]["isolation"] == "vm"
    assert custom["sandbox"]["base_isolation"] == "shell_process"
    assert custom["sandbox"]["boundary"] == "microvm"
    assert custom["sandbox"]["executor"] == "bash"
    assert custom["sandbox"]["engine"] == "python"
    assert custom["sandbox"]["profile"] == "hardened"
    assert custom["sandbox"]["image"] == "images/agent-flow-bash.qcow2"
    assert custom["sandbox"]["policy"]["memory"] == "512m"
    assert custom["sandbox"]["policy"]["cpus"] == "1"


def test_bash_vm_isolation_rejects_unverified_runner(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_FLOW_TEST_VM_UNVERIFIED", "1")
    client = _client(tmp_path)
    create_resp = client.post(_path(), headers={"Idempotency-Key": "create-unverified"}, json={"max_turns": 2})
    session_id = create_resp.json()["session"]["session_id"]
    client.post(_path(f"/{session_id}/start"), headers={"Idempotency-Key": "start-unverified"}, json={})

    turn_resp = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "turn-unverified"},
        json={"user_message": "gere perguntas"},
    )
    assert turn_resp.status_code == 200
    events = client.get(_path(f"/{session_id}/events")).json()
    custom_events = [
        item for item in events
        if item.get("payload", {}).get("custom", {}).get("error") == "vm_runner_unverified_isolation"
    ]
    assert custom_events
    custom = custom_events[-1]["payload"]["custom"]
    assert custom["ok"] is False
    assert custom["status"] == "custom_code_failed"
    assert custom["vm_runner_provides_isolation"] is False
    assert custom["contract"]["sandbox_isolation"] == "vm"
    assert custom["execution_log"]["sandbox_isolation"] == "vm"
    assert custom["execution_log"]["sandbox_boundary"] == "microvm"
`,
    "utf-8",
  );

  await execFileAsync("python", ["-m", "pytest", "-q", outDir], {
    cwd: outDir,
    timeout: 120000,
  });
});

test("generated runtime reports missing container image for container-isolated JavaScript code nodes", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-codegen-javascript-container-code-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const flowRoot = path.join(workspaceRoot, "flow");
  const outDir = path.join(workspaceRoot, "runtime");
  await writeFlowAssets(flowRoot, "Agente JavaScript Container");

  const flow: AgentFlow = {
    ...simpleFlow("javascript-container-code-agent", "Agente JavaScript Container"),
    nodes: [
      { id: "start_node", type: "start" },
      { id: "input_safety_check", type: "safety_gate", stage: "input" },
      { id: "llm_step", type: "llm_prompt", promptId: "system" },
      {
        id: "generate_questions",
        type: "code",
        codeLanguage: "javascript",
        codeExecution: "inline",
        codeEntry: "run",
        codeInline:
          "export function run(value, context) { return { value, node: context.node_id, sandbox: process.env.AGENT_FLOW_SANDBOX_ISOLATION }; }",
        inputPath: "assistant_message.text",
        resultPath: "custom.container_questions",
        sandboxIsolation: "container",
        sandboxContainerEngine: "docker",
        sandboxContainerProfile: "hardened",
        sandboxContainerMemory: "512m",
        sandboxContainerCpus: "1",
        sandboxContainerPidsLimit: 128,
        sandboxContainerReadOnlyRootfs: true,
        sandboxContainerDropCapabilities: true,
        sandboxContainerNoNewPrivileges: true,
      },
      { id: "finish_node", type: "end" },
    ],
    edges: [
      { from: "start", to: "start_node", condition: "action == 'start'" },
      { from: "start", to: "input_safety_check", condition: "action == 'turn'" },
      { from: "start_node", to: "end" },
      { from: "input_safety_check", to: "llm_step", condition: "safety.decision == 'allow'" },
      { from: "input_safety_check", to: "end", condition: "safety.blocked == true" },
      { from: "llm_step", to: "generate_questions" },
      { from: "generate_questions", to: "end" },
      { from: "start", to: "finish_node", condition: "action == 'finish'" },
      { from: "finish_node", to: "end" },
    ],
  };

  await generateLangGraphRuntime({ flow, flowRoot, outDir });
  const graph = await readFile(path.join(outDir, "app", "graph.py"), "utf-8");
  assert.match(graph, /node_container_timeout_after/);
  assert.match(graph, /\\"sandboxIsolation\\": \\"container\\"/);
  assert.match(graph, /\\"sandboxContainerEngine\\": \\"docker\\"/);
  assert.match(graph, /\\"sandboxContainerProfile\\": \\"hardened\\"/);
  await writeFile(
    path.join(outDir, "tests", "test_javascript_container_custom_code_nodes.py"),
    `from fastapi.testclient import TestClient

from app.generated_flow import API_RESOURCE
from tests.conftest import set_test_env


def _path(suffix: str = "") -> str:
    return f"/{API_RESOURCE}{suffix}"


def _client(tmp_path):
    set_test_env(str(tmp_path / "javascript-container-code.db"))
    from app.db import engine
    from app.main import create_app
    from app.models import Base

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestClient(create_app())


def test_container_isolation_requires_image_for_javascript_nodes(tmp_path):
    client = _client(tmp_path)
    create_resp = client.post(_path(), headers={"Idempotency-Key": "create"}, json={"max_turns": 2})
    session_id = create_resp.json()["session"]["session_id"]
    client.post(_path(f"/{session_id}/start"), headers={"Idempotency-Key": "start"}, json={})

    turn_resp = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "turn"},
        json={"user_message": "gere perguntas"},
    )
    assert turn_resp.status_code == 200
    events = client.get(_path(f"/{session_id}/events")).json()
    custom_events = [
        item for item in events
        if item.get("payload", {}).get("custom", {}).get("status") == "custom_code_not_executed"
    ]
    assert custom_events
    custom = custom_events[-1]["payload"]["custom"]
    assert custom["ok"] is False
    assert custom["status"] == "custom_code_not_executed"
    assert custom["reason"] == "container_image_not_configured"
    assert custom["contract"]["language"] == "javascript"
    assert custom["contract"]["sandbox_isolation"] == "container"
    assert custom["contract"]["sandbox_container_engine"] == "docker"
    assert custom["contract"]["sandbox_container_profile"] == "hardened"
    assert custom["contract"]["sandbox_container_pids_limit"] == 128
    assert custom["execution_log"]["sandbox_isolation"] == "container"
    assert custom["execution_log"]["sandbox_boundary"] == "container"
    assert custom["execution_log"]["sandbox_executor"] == "node"
    assert custom["execution_log"]["sandbox_engine"] == "docker"
    assert custom["sandbox"]["isolation"] == "container"
    assert custom["sandbox"]["executor"] == "node"
    assert custom["sandbox"]["engine"] == "docker"
    assert custom["sandbox"]["profile"] == "hardened"
    assert custom["sandbox"]["policy"]["pids_limit"] == 128
    assert custom["sandbox"]["policy"]["read_only_rootfs"] is True
`,
    "utf-8",
  );

  await execFileAsync("python", ["-m", "pytest", "-q", outDir], {
    cwd: outDir,
    timeout: 120000,
  });
});

test("generated runtime executes JavaScript custom code node files", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-codegen-javascript-code-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const flowRoot = path.join(workspaceRoot, "flow");
  const outDir = path.join(workspaceRoot, "runtime");
  await writeFlowAssets(flowRoot, "Agente com código JavaScript");
  await mkdir(path.join(flowRoot, "code"), { recursive: true });
  await writeFile(
    path.join(flowRoot, "code", "generateQuestions.js"),
    `export async function generateQuestions(input, context) {
  const text = String(input || "");
  return {
    question_count: 2,
    questions: [
      "Qual é o ponto principal de " + text.slice(0, 24) + "?",
      "Qual detalhe precisa ser confirmado?",
    ],
    node: context.node_id,
    session_id: context.session_id,
    input_path: context.input_path,
  };
}
`,
    "utf-8",
  );

  const flow: AgentFlow = {
    ...simpleFlow("javascript-code-agent", "Agente Código JavaScript"),
    nodes: [
      { id: "start_node", type: "start" },
      { id: "input_safety_check", type: "safety_gate", stage: "input" },
      { id: "llm_step", type: "llm_prompt", promptId: "system" },
      {
        id: "generate_questions",
        type: "code",
        codeLanguage: "javascript",
        codeExecution: "file",
        codePath: "code/generateQuestions.js",
        codeEntry: "generateQuestions",
        inputPath: "assistant_message.text",
        resultPath: "custom.generated_questions",
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
      { from: "llm_step", to: "generate_questions" },
      { from: "generate_questions", to: "end" },
      { from: "finish_node", to: "end" },
    ],
  };

  await generateLangGraphRuntime({ flow, flowRoot, outDir });
  await readFile(path.join(outDir, "app", "code", "generateQuestions.js"), "utf-8");
  await readFile(path.join(outDir, "app", "code_runner.mjs"), "utf-8");
  const graph = await readFile(path.join(outDir, "app", "graph.py"), "utf-8");
  assert.match(graph, /execute_custom_node_code/);
  await writeFile(
    path.join(outDir, "tests", "test_javascript_custom_code_nodes.py"),
    `from fastapi.testclient import TestClient

from app.generated_flow import API_RESOURCE
from tests.conftest import set_test_env


def _path(suffix: str = "") -> str:
    return f"/{API_RESOURCE}{suffix}"


def _client(tmp_path):
    set_test_env(str(tmp_path / "javascript-code.db"))
    from app.db import engine
    from app.main import create_app
    from app.models import Base

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestClient(create_app())


def test_javascript_custom_code_executes_and_records_output(tmp_path):
    client = _client(tmp_path)
    create_resp = client.post(_path(), headers={"Idempotency-Key": "create"}, json={"max_turns": 2})
    session_id = create_resp.json()["session"]["session_id"]
    client.post(_path(f"/{session_id}/start"), headers={"Idempotency-Key": "start"}, json={})

    turn_resp = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "turn"},
        json={"user_message": "conteúdo para perguntas"},
    )
    assert turn_resp.status_code == 200

    events = client.get(_path(f"/{session_id}/events")).json()
    by_type = {item["event_type"]: item for item in events}
    custom = by_type["custom_code_executed"]["payload"]["custom"]
    assert custom["ok"] is True
    assert custom["status"] == "custom_code_executed"
    assert custom["node_id"] == "generate_questions"
    assert custom["contract"]["language"] == "javascript"
    assert custom["contract"]["execution"] == "file"
    assert custom["contract"]["path"] == "code/generateQuestions.js"
    assert custom["output"]["question_count"] == 2
    assert len(custom["output"]["questions"]) == 2
    assert custom["output"]["node"] == "generate_questions"
    assert custom["output"]["session_id"] == session_id
    assert custom["output"]["input_path"] == "assistant_message.text"
`,
    "utf-8",
  );

  await execFileAsync("python", ["-m", "pytest", "-q", outDir], {
    cwd: outDir,
    timeout: 120000,
  });
});

test("generated runtime executes HTTP custom code nodes", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-codegen-http-code-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const flowRoot = path.join(workspaceRoot, "flow");
  const outDir = path.join(workspaceRoot, "runtime");
  await writeFlowAssets(flowRoot, "Agente Código HTTP");

  const flow: AgentFlow = {
    ...simpleFlow("http-code-agent", "Agente Código HTTP"),
    nodes: [
      { id: "start_node", type: "start" },
      { id: "input_safety_check", type: "safety_gate", stage: "input" },
      { id: "llm_step", type: "llm_prompt", promptId: "system" },
      {
        id: "external_questions",
        type: "code",
        codeLanguage: "external",
        codeExecution: "http",
        method: "POST",
        url: "mock://external-questions",
        inputPath: "assistant_message.text",
        resultPath: "custom.external_questions",
        timeoutSeconds: 5,
        retryAttempts: 1,
        payloadAllowPaths: ["assistant_message.text", "session_metadata.safe_value", "session_metadata.secret_value"],
        redactPaths: ["assistant_message.text", "session_metadata.secret_value"],
        maxPayloadBytes: 100000,
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
      { from: "llm_step", to: "external_questions" },
      { from: "external_questions", to: "end" },
      { from: "finish_node", to: "end" },
    ],
  };

  await generateLangGraphRuntime({ flow, flowRoot, outDir });
  const graph = await readFile(path.join(outDir, "app", "graph.py"), "utf-8");
  assert.match(graph, /execute_custom_http_code/);
  await writeFile(
    path.join(outDir, "tests", "test_http_custom_code_nodes.py"),
    `import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from fastapi.testclient import TestClient

from app.generated_flow import API_RESOURCE
from tests.conftest import set_test_env


def _path(suffix: str = "") -> str:
    return f"/{API_RESOURCE}{suffix}"


class Handler(BaseHTTPRequestHandler):
    received = []
    attempts = 0

    def do_POST(self):
        Handler.attempts += 1
        length = int(self.headers.get("content-length") or "0")
        payload = json.loads(self.rfile.read(length).decode("utf-8"))
        Handler.received.append(payload)
        if Handler.attempts == 1:
            self.send_response(503)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": False, "error": "retry_me"}).encode("utf-8"))
            return
        response = {
            "ok": True,
            "output": {
                "question_count": 1,
                "node": payload["context"]["node_id"],
                "session_id": payload["context"]["session_id"],
                "input_path": payload["context"]["input_path"],
                "input_preview": str(payload["input"])[:24],
                "contract_execution": payload["contract"]["execution"],
            },
        }
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(response).encode("utf-8"))

    def log_message(self, format, *args):
        return None


def _client(tmp_path):
    set_test_env(str(tmp_path / "http-code.db"))
    from app import graph as graph_module
    from app.db import engine
    from app.main import create_app
    from app.models import Base

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    graph_module.NODE_CONFIG_BY_ID["external_questions"]["url"] = f"http://127.0.0.1:{server.server_port}/run"

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestClient(create_app()), server


def test_http_custom_code_executes_and_records_output(tmp_path):
    Handler.received = []
    Handler.attempts = 0
    client, server = _client(tmp_path)
    try:
        create_resp = client.post(
            _path(),
            headers={"Idempotency-Key": "create"},
            json={"max_turns": 2, "metadata": {"safe_value": "ok-to-share", "secret_value": "do-not-share"}},
        )
        session_id = create_resp.json()["session"]["session_id"]
        client.post(_path(f"/{session_id}/start"), headers={"Idempotency-Key": "start"}, json={})

        turn_resp = client.post(
            _path(f"/{session_id}/turn"),
            headers={"Idempotency-Key": "turn"},
            json={"user_message": "conteúdo para perguntas"},
        )
        assert turn_resp.status_code == 200

        events = client.get(_path(f"/{session_id}/events")).json()
        by_type = {item["event_type"]: item for item in events}
        custom = by_type["custom_code_executed"]["payload"]["custom"]
        assert custom["ok"] is True
        assert custom["status"] == "custom_code_executed"
        assert custom["node_id"] == "external_questions"
        assert custom["contract"]["execution"] == "http"
        assert custom["contract"]["method"] == "POST"
        assert custom["contract"]["url"].startswith("http://127.0.0.1:")
        assert custom["contract"]["retry_attempts"] == 1
        assert custom["contract"]["payload_allow_paths"] == [
            "assistant_message.text",
            "session_metadata.safe_value",
            "session_metadata.secret_value",
        ]
        assert custom["contract"]["redact_paths"] == ["assistant_message.text", "session_metadata.secret_value"]
        assert custom["contract"]["max_payload_bytes"] == 100000
        assert custom["attempts"] == 2
        assert custom["retry_attempts"] == 1
        assert custom["payload_bytes"] > 0
        assert custom["payload_policy"]["payload_allow_paths"] == custom["contract"]["payload_allow_paths"]
        assert custom["payload_policy"]["redact_paths"] == custom["contract"]["redact_paths"]
        assert custom["execution_log"]["mode"] == "http"
        assert custom["execution_log"]["status"] == "custom_code_executed"
        assert custom["execution_log"]["status_code"] == 200
        assert custom["execution_log"]["sandbox_isolation"] == "external_endpoint"
        assert custom["execution_log"]["sandbox_boundary"] == "network"
        assert custom["execution_log"]["sandbox_transport"] == "http_json"
        assert custom["execution_log"]["attempts"] == 2
        assert custom["execution_log"]["retry_attempts"] == 1
        assert custom["execution_log"]["payload_bytes"] == custom["payload_bytes"]
        assert custom["sandbox"]["isolation"] == "external_endpoint"
        assert custom["sandbox"]["boundary"] == "network"
        assert custom["sandbox"]["transport"] == "http_json"
        assert custom["execution_log"]["target"].startswith("http://127.0.0.1:")
        assert custom["span"]["name"] == "custom_code.http"
        assert custom["span"]["status"] == "ok"
        assert custom["output"]["question_count"] == 1
        assert custom["output"]["node"] == "external_questions"
        assert custom["output"]["session_id"] == session_id
        assert custom["output"]["input_path"] == "assistant_message.text"
        assert custom["output"]["contract_execution"] == "http"
        assert len(Handler.received) == 2
        assert Handler.received[0]["context"]["node_id"] == "external_questions"
        assert Handler.received[0]["input"] == "***REDACTED***"
        assert Handler.received[0]["context"]["state"] == {
            "assistant_message": {"text": "***REDACTED***"},
            "session_metadata": {"safe_value": "ok-to-share", "secret_value": "***REDACTED***"},
        }
        assert "user_message" not in Handler.received[0]["context"]["state"]
    finally:
        server.shutdown()
        server.server_close()
`,
    "utf-8",
  );

  await execFileAsync("python", ["-m", "pytest", "-q", outDir], {
    cwd: outDir,
    timeout: 120000,
  });
});

test("generated runtime executes runtime_adapter custom code nodes", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-codegen-runtime-adapter-code-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const flowRoot = path.join(workspaceRoot, "flow");
  const outDir = path.join(workspaceRoot, "runtime");
  await writeFlowAssets(flowRoot, "Agente Runtime Adapter");

  const flow: AgentFlow = {
    ...simpleFlow("runtime-adapter-agent", "Agente Runtime Adapter"),
    nodes: [
      { id: "start_node", type: "start" },
      { id: "input_safety_check", type: "safety_gate", stage: "input" },
      { id: "llm_step", type: "llm_prompt", promptId: "system" },
      {
        id: "adapter_questions",
        type: "code",
        codeLanguage: "external",
        codeExecution: "runtime_adapter",
        codeEntry: "question_adapter",
        method: "POST",
        url: "mock://runtime-adapter",
        inputPath: "assistant_message.text",
        resultPath: "custom.adapter_questions",
        timeoutSeconds: 5,
        retryAttempts: 1,
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
      { from: "llm_step", to: "adapter_questions" },
      { from: "adapter_questions", to: "end" },
      { from: "finish_node", to: "end" },
    ],
  };

  await generateLangGraphRuntime({ flow, flowRoot, outDir });
  const graph = await readFile(path.join(outDir, "app", "graph.py"), "utf-8");
  assert.match(graph, /execute_custom_runtime_adapter_code/);
  assert.match(graph, /\\"codeExecution\\": \\"runtime_adapter\\"/);
  await writeFile(
    path.join(outDir, "tests", "test_runtime_adapter_custom_code_nodes.py"),
    `import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from fastapi.testclient import TestClient

from app.generated_flow import API_RESOURCE
from tests.conftest import set_test_env


def _path(suffix: str = "") -> str:
    return f"/{API_RESOURCE}{suffix}"


class Handler(BaseHTTPRequestHandler):
    received = []
    attempts = 0

    def do_POST(self):
        Handler.attempts += 1
        length = int(self.headers.get("content-length") or "0")
        payload = json.loads(self.rfile.read(length).decode("utf-8"))
        Handler.received.append(payload)
        if Handler.attempts == 1:
            self.send_response(503)
            self.send_header("content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": False, "error": "retry_me"}).encode("utf-8"))
            return
        response = {
            "ok": True,
            "output": {
                "question_count": 1,
                "node": payload["context"]["node_id"],
                "session_id": payload["context"]["session_id"],
                "input_path": payload["context"]["input_path"],
                "contract_execution": payload["contract"]["execution"],
                "adapter_execution": payload["adapter"]["execution"],
                "adapter_id": payload["adapter"]["id"],
            },
        }
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(response).encode("utf-8"))

    def log_message(self, format, *args):
        return None


def _client(tmp_path):
    set_test_env(str(tmp_path / "runtime-adapter-code.db"))
    from app import graph as graph_module
    from app.db import engine
    from app.main import create_app
    from app.models import Base

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    graph_module.NODE_CONFIG_BY_ID["adapter_questions"]["url"] = f"http://127.0.0.1:{server.server_port}/adapter"

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestClient(create_app()), server


def test_runtime_adapter_custom_code_executes_and_records_output(tmp_path):
    Handler.received = []
    Handler.attempts = 0
    client, server = _client(tmp_path)
    try:
        create_resp = client.post(_path(), headers={"Idempotency-Key": "create"}, json={"max_turns": 2})
        session_id = create_resp.json()["session"]["session_id"]
        client.post(_path(f"/{session_id}/start"), headers={"Idempotency-Key": "start"}, json={})

        turn_resp = client.post(
            _path(f"/{session_id}/turn"),
            headers={"Idempotency-Key": "turn"},
            json={"user_message": "conteúdo para adapter"},
        )
        assert turn_resp.status_code == 200

        events = client.get(_path(f"/{session_id}/events")).json()
        by_type = {item["event_type"]: item for item in events}
        custom = by_type["custom_code_executed"]["payload"]["custom"]
        assert custom["ok"] is True
        assert custom["status"] == "custom_code_executed"
        assert custom["node_id"] == "adapter_questions"
        assert custom["contract"]["execution"] == "runtime_adapter"
        assert custom["contract"]["method"] == "POST"
        assert custom["contract"]["url"].startswith("http://127.0.0.1:")
        assert custom["contract"]["retry_attempts"] == 1
        assert custom["attempts"] == 2
        assert custom["retry_attempts"] == 1
        assert custom["execution_log"]["mode"] == "runtime_adapter"
        assert custom["execution_log"]["status"] == "custom_code_executed"
        assert custom["execution_log"]["status_code"] == 200
        assert custom["execution_log"]["sandbox_isolation"] == "external_endpoint"
        assert custom["execution_log"]["sandbox_boundary"] == "network"
        assert custom["execution_log"]["attempts"] == 2
        assert custom["sandbox"]["isolation"] == "external_endpoint"
        assert custom["sandbox"]["executor"] == "runtime_adapter"
        assert custom["execution_log"]["target"].startswith("http://127.0.0.1:")
        assert custom["span"]["name"] == "custom_code.runtime_adapter"
        assert custom["span"]["status"] == "ok"
        assert custom["output"]["question_count"] == 1
        assert custom["output"]["node"] == "adapter_questions"
        assert custom["output"]["session_id"] == session_id
        assert custom["output"]["input_path"] == "assistant_message.text"
        assert custom["output"]["contract_execution"] == "runtime_adapter"
        assert custom["output"]["adapter_execution"] == "runtime_adapter"
        assert custom["output"]["adapter_id"] == "question_adapter"
        assert len(Handler.received) == 2
        assert Handler.received[0]["adapter"]["node_id"] == "adapter_questions"
    finally:
        server.shutdown()
        server.server_close()
`,
    "utf-8",
  );

  await execFileAsync("python", ["-m", "pytest", "-q", outDir], {
    cwd: outDir,
    timeout: 120000,
  });
});

test("generated runtime executes runtime_adapter nodes through the VM runner contract", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-codegen-runtime-adapter-vm-code-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const flowRoot = path.join(workspaceRoot, "flow");
  const outDir = path.join(workspaceRoot, "runtime");
  await writeFlowAssets(flowRoot, "Agente Runtime Adapter VM");

  const flow: AgentFlow = {
    ...simpleFlow("runtime-adapter-vm-agent", "Agente Runtime Adapter VM"),
    nodes: [
      { id: "start_node", type: "start" },
      { id: "input_safety_check", type: "safety_gate", stage: "input" },
      { id: "llm_step", type: "llm_prompt", promptId: "system" },
      {
        id: "adapter_vm_questions",
        type: "code",
        codeLanguage: "python",
        codeExecution: "runtime_adapter",
        codeEntry: "question_adapter",
        codeInline:
          "def question_adapter(value, context, contract):\n    return {'value': value, 'node': context['node_id'], 'adapter': context['adapter']['id'], 'execution': contract['execution'], 'isolation': contract['sandbox_isolation']}\n",
        inputPath: "assistant_message.text",
        resultPath: "custom.adapter_vm_questions",
        sandboxIsolation: "vm",
        sandboxVmRunner: "python",
        sandboxVmArgs: ["vm_runner_stub.py"],
        sandboxVmImageId: "runtime-adapter-microvm",
        sandboxVmProfile: "hardened",
        sandboxVmImage: "images/agent-flow-runtime-adapter.qcow2",
        sandboxVmMemory: "768m",
        sandboxVmCpus: "1",
        timeoutSeconds: 5,
      },
      { id: "finish_node", type: "end" },
    ],
    edges: [
      { from: "start", to: "start_node", condition: "action == 'start'" },
      { from: "start", to: "input_safety_check", condition: "action == 'turn'" },
      { from: "start_node", to: "end" },
      { from: "input_safety_check", to: "llm_step", condition: "safety.decision == 'allow'" },
      { from: "input_safety_check", to: "end", condition: "safety.blocked == true" },
      { from: "llm_step", to: "adapter_vm_questions" },
      { from: "adapter_vm_questions", to: "end" },
      { from: "finish_node", to: "end" },
    ],
  };

  await generateLangGraphRuntime({ flow, flowRoot, outDir });
  const graph = await readFile(path.join(outDir, "app", "graph.py"), "utf-8");
  assert.match(graph, /execute_custom_vm_code/);
  assert.match(graph, /\\"codeExecution\\": \\"runtime_adapter\\"/);
  assert.doesNotMatch(graph, /\\"url\\": \\"mock:\/\/runtime-adapter\\"/);
  await writeFile(
    path.join(outDir, "app", "code", "vm_runner_stub.py"),
    `import json
import pathlib
import sys


request = json.loads(sys.stdin.read() or "{}")
workspace = pathlib.Path(request.get("workspace") or ".")
source = request.get("inlineSource") or pathlib.Path(request["sourcePath"]).read_text(encoding="utf-8")
globals_dict = {"__name__": "__agent_flow_vm_adapter__"}
exec(compile(source, "<runtime-adapter-vm>", "exec"), globals_dict)
entry = globals_dict[request["entry"]]
output = entry(request["input"], request["context"], request["contract"])
print(json.dumps({
    "ok": True,
    "output": {
        "adapter_output": output,
        "adapter": request.get("adapter"),
        "language": request.get("language"),
        "workspace_isolation": request.get("workspaceIsolation"),
        "workspace_has_stub": (workspace / "vm_runner_stub.py").exists(),
        "vm_profile": (request.get("vm") or {}).get("profile"),
    },
    "stdout": "runtime adapter vm ok",
    "providesVmIsolation": True,
}))
`,
    "utf-8",
  );
  await writeFile(
    path.join(outDir, "tests", "test_runtime_adapter_vm_custom_code_nodes.py"),
    `from fastapi.testclient import TestClient

from app.generated_flow import API_RESOURCE
from tests.conftest import set_test_env


def _path(suffix: str = "") -> str:
    return f"/{API_RESOURCE}{suffix}"


def _client(tmp_path):
    set_test_env(str(tmp_path / "runtime-adapter-vm-code.db"))
    from app.db import engine
    from app.main import create_app
    from app.models import Base

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestClient(create_app())


def test_runtime_adapter_vm_executes_without_http_url(tmp_path):
    client = _client(tmp_path)
    create_resp = client.post(_path(), headers={"Idempotency-Key": "create"}, json={"max_turns": 2})
    session_id = create_resp.json()["session"]["session_id"]
    client.post(_path(f"/{session_id}/start"), headers={"Idempotency-Key": "start"}, json={})

    turn_resp = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "turn"},
        json={"user_message": "conteúdo para adapter vm"},
    )
    assert turn_resp.status_code == 200

    events = client.get(_path(f"/{session_id}/events")).json()
    custom_events = [
        item for item in events
        if item.get("payload", {}).get("custom", {}).get("status") == "custom_code_executed"
    ]
    assert custom_events
    custom = custom_events[-1]["payload"]["custom"]
    assert custom["ok"] is True
    assert custom["status"] == "custom_code_executed"
    assert custom["node_id"] == "adapter_vm_questions"
    assert custom["contract"]["execution"] == "runtime_adapter"
    assert custom["contract"]["sandbox_isolation"] == "vm"
    assert "url" not in custom["contract"]
    assert custom["vm_runner_provides_isolation"] is True
    assert custom["output"]["adapter"]["id"] == "question_adapter"
    assert custom["output"]["adapter"]["execution"] == "runtime_adapter"
    assert custom["output"]["adapter_output"]["adapter"] == "question_adapter"
    assert custom["output"]["adapter_output"]["execution"] == "runtime_adapter"
    assert custom["output"]["adapter_output"]["isolation"] == "vm"
    assert custom["output"]["workspace_isolation"] == "vm"
    assert custom["output"]["workspace_has_stub"] is True
    assert custom["output"]["vm_profile"] == "hardened"
    assert custom["execution_log"]["mode"] == "runtime_adapter"
    assert custom["execution_log"]["sandbox_isolation"] == "vm"
    assert custom["execution_log"]["sandbox_boundary"] == "microvm"
    assert custom["execution_log"]["sandbox_base_isolation"] == "external_endpoint"
    assert custom["execution_log"]["sandbox_profile"] == "hardened"
    assert custom["sandbox"]["isolation"] == "vm"
    assert custom["sandbox"]["base_isolation"] == "external_endpoint"
    assert custom["sandbox"]["engine"] == "python"
    assert custom["sandbox"]["image"] == "images/agent-flow-runtime-adapter.qcow2"
    assert custom["sandbox"]["policy"]["memory"] == "768m"
    assert custom["sandbox"]["policy"]["cpus"] == "1"
`,
    "utf-8",
  );

  await execFileAsync("python", ["-m", "pytest", "-q", outDir], {
    cwd: outDir,
    timeout: 120000,
  });
});

test("generated runtime executes MCP custom code nodes", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-codegen-mcp-code-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const flowRoot = path.join(workspaceRoot, "flow");
  const outDir = path.join(workspaceRoot, "runtime");
  await writeFlowAssets(flowRoot, "Agente Código MCP");
  await mkdir(path.join(flowRoot, "code"), { recursive: true });
  await writeFile(
    path.join(flowRoot, "code", "mcp_questions.py"),
    `import json
import sys


def send(message):
    sys.stdout.write(json.dumps(message) + "\\n")
    sys.stdout.flush()


def main():
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        message = json.loads(line)
        method = message.get("method")
        if method == "initialize":
            send({
                "jsonrpc": "2.0",
                "id": message.get("id"),
                "result": {
                    "protocolVersion": message.get("params", {}).get("protocolVersion"),
                    "serverInfo": {"name": "test-mcp", "version": "0.1.0"},
                    "capabilities": {"tools": {}},
                },
            })
        elif method == "notifications/initialized":
            continue
        elif method == "tools/call":
            params = message.get("params") or {}
            args = params.get("arguments") or {}
            text = str(args.get("input") or args.get("text") or "")
            output = {
                "question_count": 2,
                "questions": [
                    f"Qual é o ponto principal de {text[:24]}?",
                    "Qual detalhe precisa ser confirmado?",
                ],
                "tool": params.get("name"),
                "received_input": text,
            }
            send({
                "jsonrpc": "2.0",
                "id": message.get("id"),
                "result": {
                    "content": [{"type": "text", "text": json.dumps(output)}],
                    "isError": False,
                },
            })


if __name__ == "__main__":
    main()
`,
    "utf-8",
  );

  const flow: AgentFlow = {
    ...simpleFlow("mcp-code-agent", "Agente Código MCP"),
    nodes: [
      { id: "start_node", type: "start" },
      { id: "input_safety_check", type: "safety_gate", stage: "input" },
      { id: "llm_step", type: "llm_prompt", promptId: "system" },
      {
        id: "mcp_questions",
        type: "code",
        codeLanguage: "external",
        codeExecution: "mcp",
        codePath: "code/mcp_questions.py",
        mcpCommand: "python",
        mcpArgs: ["mcp_questions.py"],
        mcpToolName: "generate_questions",
        mcpProtocolVersion: "2025-11-25",
        inputPath: "assistant_message.text",
        resultPath: "custom.mcp_questions",
        timeoutSeconds: 5,
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
      { from: "llm_step", to: "mcp_questions" },
      { from: "mcp_questions", to: "end" },
      { from: "finish_node", to: "end" },
    ],
  };

  await generateLangGraphRuntime({ flow, flowRoot, outDir });
  await readFile(path.join(outDir, "app", "code", "mcp_questions.py"), "utf-8");
  const graph = await readFile(path.join(outDir, "app", "graph.py"), "utf-8");
  assert.match(graph, /execute_custom_mcp_code/);
  assert.match(graph, /\\"mcpToolName\\": \\"generate_questions\\"/);
  await writeFile(
    path.join(outDir, "tests", "test_mcp_custom_code_nodes.py"),
    `from fastapi.testclient import TestClient

from app.generated_flow import API_RESOURCE
from tests.conftest import set_test_env


def _path(suffix: str = "") -> str:
    return f"/{API_RESOURCE}{suffix}"


def _client(tmp_path):
    set_test_env(str(tmp_path / "mcp-code.db"))
    from app.db import engine
    from app.main import create_app
    from app.models import Base

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestClient(create_app())


def test_mcp_custom_code_executes_and_records_output(tmp_path):
    client = _client(tmp_path)
    create_resp = client.post(_path(), headers={"Idempotency-Key": "create"}, json={"max_turns": 2})
    session_id = create_resp.json()["session"]["session_id"]
    client.post(_path(f"/{session_id}/start"), headers={"Idempotency-Key": "start"}, json={})

    turn_resp = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "turn"},
        json={"user_message": "conteúdo para perguntas"},
    )
    assert turn_resp.status_code == 200

    events = client.get(_path(f"/{session_id}/events")).json()
    by_type = {item["event_type"]: item for item in events}
    custom = by_type["custom_code_executed"]["payload"]["custom"]
    assert custom["ok"] is True
    assert custom["status"] == "custom_code_executed"
    assert custom["node_id"] == "mcp_questions"
    assert custom["contract"]["execution"] == "mcp"
    assert custom["contract"]["mcp_command"] == "python"
    assert custom["contract"]["mcp_args"] == ["mcp_questions.py"]
    assert custom["contract"]["mcp_tool_name"] == "generate_questions"
    assert custom["contract"]["mcp_protocol_version"] == "2025-11-25"
    assert custom["execution_log"]["mode"] == "mcp"
    assert custom["execution_log"]["status"] == "custom_code_executed"
    assert custom["execution_log"]["target"] == "generate_questions"
    assert custom["execution_log"]["sandbox_isolation"] == "subprocess_stdio"
    assert custom["execution_log"]["sandbox_boundary"] == "process"
    assert custom["execution_log"]["sandbox_transport"] == "jsonrpc_stdio"
    assert custom["sandbox"]["isolation"] == "subprocess_stdio"
    assert custom["sandbox"]["executor"] == "python"
    assert custom["span"]["name"] == "custom_code.mcp"
    assert custom["span"]["status"] == "ok"
    assert custom["output"]["question_count"] == 2
    assert custom["output"]["tool"] == "generate_questions"
    assert custom["output"]["received_input"]
    assert custom["mcp_initialize"]["result"]["serverInfo"]["name"] == "test-mcp"
`,
    "utf-8",
  );

  await execFileAsync("python", ["-m", "pytest", "-q", outDir], {
    cwd: outDir,
    timeout: 120000,
  });
});

test("generated runtime executes sidecar custom code nodes", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-codegen-sidecar-code-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const flowRoot = path.join(workspaceRoot, "flow");
  const outDir = path.join(workspaceRoot, "runtime");
  await writeFlowAssets(flowRoot, "Agente Código Sidecar");
  await mkdir(path.join(flowRoot, "code"), { recursive: true });
  await writeFile(
    path.join(flowRoot, "code", "sidecar_questions.py"),
    `import json
import os
import sys
from pathlib import Path


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    text = str(payload.get("input") or "")
    context = payload.get("context") or {}
    contract = payload.get("contract") or {}
    workspace_file = Path("sidecar_wrote.txt")
    workspace_file.write_text("sidecar touched workspace", encoding="utf-8")
    print(json.dumps({
        "ok": True,
        "output": {
            "question_count": 2,
            "questions": [
                f"Qual é o ponto principal de {text[:24]}?",
                "Qual detalhe precisa ser confirmado?",
            ],
            "node": context.get("node_id"),
            "session_id": context.get("session_id"),
            "input_path": context.get("input_path"),
            "contract_execution": contract.get("execution"),
            "contract_sandbox": contract.get("sandbox_isolation"),
            "arg_probe": sys.argv[1:] or [],
            "sandbox_env": os.environ.get("AGENT_FLOW_SANDBOX_ISOLATION"),
            "workspace_file": str(workspace_file),
        },
    }))


if __name__ == "__main__":
    main()
`,
    "utf-8",
  );

  const flow: AgentFlow = {
    ...simpleFlow("sidecar-code-agent", "Agente Código Sidecar"),
    nodes: [
      { id: "start_node", type: "start" },
      { id: "input_safety_check", type: "safety_gate", stage: "input" },
      { id: "llm_step", type: "llm_prompt", promptId: "system" },
      {
        id: "sidecar_questions",
        type: "code",
        codeLanguage: "external",
        codeExecution: "sidecar",
        codePath: "code/sidecar_questions.py",
        sidecarCommand: "python",
        sidecarArgs: ["sidecar_questions.py", "--mode", "questions"],
        inputPath: "assistant_message.text",
        resultPath: "custom.sidecar_questions",
        timeoutSeconds: 5,
        sandboxIsolation: "ephemeral_workspace",
        sandboxEnvAllowlist: ["PATH"],
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
      { from: "llm_step", to: "sidecar_questions" },
      { from: "sidecar_questions", to: "end" },
      { from: "finish_node", to: "end" },
    ],
  };

  await generateLangGraphRuntime({ flow, flowRoot, outDir });
  await readFile(path.join(outDir, "app", "code", "sidecar_questions.py"), "utf-8");
  const graph = await readFile(path.join(outDir, "app", "graph.py"), "utf-8");
  assert.match(graph, /execute_custom_sidecar_code/);
  assert.match(graph, /\\"sidecarCommand\\": \\"python\\"/);
  await writeFile(
    path.join(outDir, "tests", "test_sidecar_custom_code_nodes.py"),
    `from pathlib import Path

from fastapi.testclient import TestClient

from app.generated_flow import API_RESOURCE
from tests.conftest import set_test_env


def _path(suffix: str = "") -> str:
    return f"/{API_RESOURCE}{suffix}"


def _client(tmp_path):
    set_test_env(str(tmp_path / "sidecar-code.db"))
    from app.db import engine
    from app.main import create_app
    from app.models import Base

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestClient(create_app())


def test_sidecar_custom_code_executes_and_records_output(tmp_path):
    client = _client(tmp_path)
    create_resp = client.post(_path(), headers={"Idempotency-Key": "create"}, json={"max_turns": 2})
    session_id = create_resp.json()["session"]["session_id"]
    client.post(_path(f"/{session_id}/start"), headers={"Idempotency-Key": "start"}, json={})

    turn_resp = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "turn"},
        json={"user_message": "conteúdo para perguntas"},
    )
    assert turn_resp.status_code == 200

    events = client.get(_path(f"/{session_id}/events")).json()
    by_type = {item["event_type"]: item for item in events}
    custom = by_type["custom_code_executed"]["payload"]["custom"]
    assert custom["ok"] is True
    assert custom["status"] == "custom_code_executed"
    assert custom["node_id"] == "sidecar_questions"
    assert custom["contract"]["execution"] == "sidecar"
    assert custom["contract"]["sidecar_command"] == "python"
    assert custom["contract"]["sidecar_args"] == ["sidecar_questions.py", "--mode", "questions"]
    assert custom["contract"]["sandbox_isolation"] == "ephemeral_workspace"
    assert custom["contract"]["sandbox_env_allowlist"] == ["PATH"]
    assert custom["execution_log"]["mode"] == "sidecar"
    assert custom["execution_log"]["status"] == "custom_code_executed"
    assert custom["execution_log"]["exit_code"] == 0
    assert custom["execution_log"]["target"] == "python"
    assert custom["execution_log"]["sandbox_isolation"] == "ephemeral_workspace"
    assert custom["execution_log"]["sandbox_requested_isolation"] == "ephemeral_workspace"
    assert custom["execution_log"]["sandbox_base_isolation"] == "subprocess_stdio"
    assert custom["execution_log"]["sandbox_boundary"] == "process_workspace"
    assert custom["execution_log"]["sandbox_transport"] == "stdin_stdout_json"
    assert custom["execution_log"]["sandbox_workspace"] == "temporary_copy"
    assert custom["execution_log"]["sandbox_cleanup"] == "after_execution"
    assert custom["sandbox"]["isolation"] == "ephemeral_workspace"
    assert custom["sandbox"]["base_isolation"] == "subprocess_stdio"
    assert custom["sandbox"]["boundary"] == "process_workspace"
    assert custom["sandbox"]["workspace"] == "temporary_copy"
    assert custom["sandbox"]["cleanup"] == "after_execution"
    assert custom["sandbox"]["executor"] == "python"
    assert custom["span"]["name"] == "custom_code.sidecar"
    assert custom["span"]["status"] == "ok"
    assert custom["output"]["question_count"] == 2
    assert custom["output"]["node"] == "sidecar_questions"
    assert custom["output"]["session_id"] == session_id
    assert custom["output"]["input_path"] == "assistant_message.text"
    assert custom["output"]["contract_execution"] == "sidecar"
    assert custom["output"]["contract_sandbox"] == "ephemeral_workspace"
    assert custom["output"]["arg_probe"] == ["--mode", "questions"]
    assert custom["output"]["sandbox_env"] == "ephemeral_workspace"
    assert custom["output"]["workspace_file"] == "sidecar_wrote.txt"
    runtime_root = Path(__file__).resolve().parents[1]
    assert not (runtime_root / "app" / "code" / "sidecar_wrote.txt").exists()
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

test("generated runtime executes file extraction and lexical RAG nodes", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-codegen-rag-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const flowRoot = path.join(workspaceRoot, "flow");
  const outDir = path.join(workspaceRoot, "runtime");
  await writeFlowAssets(flowRoot, "Agente com RAG");
  await mkdir(path.join(flowRoot, "files"), { recursive: true });
  await writeFile(
    path.join(flowRoot, "files", "knowledge.md"),
    "# Base de Conhecimento\n\nLangGraph orquestra fluxos stateful com nós e arestas.\n\nFastAPI expõe o agente como API HTTP.",
    "utf-8",
  );

  const flow: AgentFlow = {
    ...simpleFlow("rag-agent", "Agente RAG"),
    nodes: [
      { id: "start_node", type: "start" },
      { id: "input_safety_check", type: "safety_gate", stage: "input" },
      {
        id: "extract_knowledge",
        type: "file_extract",
        sourcePath: "knowledge.md",
        contentPath: "files.extract_knowledge",
        maxChars: 20000,
      },
      {
        id: "retrieve_context",
        type: "rag_retrieval",
        collectionPath: ".",
        queryPath: "user_message",
        contextPath: "rag.retrieve_context",
        topK: 2,
        chunkSize: 400,
      },
      { id: "llm_step", type: "llm_prompt", promptId: "system" },
      { id: "finish_node", type: "end" },
    ],
    edges: [
      { from: "start", to: "start_node", condition: "action == 'start'" },
      { from: "start", to: "input_safety_check", condition: "action == 'turn'" },
      { from: "start", to: "finish_node", condition: "action == 'finish'" },
      { from: "start_node", to: "end" },
      { from: "input_safety_check", to: "extract_knowledge", condition: "safety.decision == 'allow'" },
      { from: "input_safety_check", to: "end", condition: "safety.blocked == true" },
      { from: "extract_knowledge", to: "retrieve_context" },
      { from: "retrieve_context", to: "llm_step" },
      { from: "llm_step", to: "end" },
      { from: "finish_node", to: "end" },
    ],
  };

  await generateLangGraphRuntime({ flow, flowRoot, outDir });
  await readFile(path.join(outDir, "app", "files", "knowledge.md"), "utf-8");
  const graph = await readFile(path.join(outDir, "app", "graph.py"), "utf-8");
  assert.match(graph, /FILE_EXTRACT_NODE_IDS/);
  assert.match(graph, /RAG_RETRIEVAL_NODE_IDS/);
  await writeFile(
    path.join(outDir, "tests", "test_rag_nodes.py"),
    `from fastapi.testclient import TestClient

from app.generated_flow import API_RESOURCE
from tests.conftest import set_test_env


def _path(suffix: str = "") -> str:
    return f"/{API_RESOURCE}{suffix}"


def _client(tmp_path):
    set_test_env(str(tmp_path / "rag.db"))
    from app.db import engine
    from app.main import create_app
    from app.models import Base

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestClient(create_app())


def test_file_extract_and_rag_events(tmp_path):
    client = _client(tmp_path)
    create_resp = client.post(_path(), headers={"Idempotency-Key": "create"}, json={"max_turns": 2})
    session_id = create_resp.json()["session"]["session_id"]
    client.post(_path(f"/{session_id}/start"), headers={"Idempotency-Key": "start"}, json={})

    turn_resp = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "turn"},
        json={"user_message": "Como o LangGraph organiza fluxos?"},
    )
    assert turn_resp.status_code == 200
    assert turn_resp.json()["assistant_message"]["code"] == "ECHO"

    events = client.get(_path(f"/{session_id}/events")).json()
    by_type = {item["event_type"]: item for item in events}
    extracted = by_type["file_extract_completed"]["payload"]["file"]
    retrieved = by_type["rag_retrieval_completed"]["payload"]["rag"]
    assert extracted["ok"] is True
    assert "LangGraph orquestra fluxos" in extracted["content"]
    assert retrieved["ok"] is True
    assert retrieved["chunk_count"] >= 1
    assert "LangGraph" in retrieved["chunks"][0]["text"]
`,
    "utf-8",
  );

  await execFileAsync("python", ["-m", "pytest", "-q", outDir], {
    cwd: outDir,
    timeout: 120000,
  });
});

test("generated runtime executes approval, scoring and analytics nodes", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-codegen-decision-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const flowRoot = path.join(workspaceRoot, "flow");
  const outDir = path.join(workspaceRoot, "runtime");
  await writeFlowAssets(flowRoot, "Agente com decisão");

  const flow: AgentFlow = {
    ...simpleFlow("decision-agent", "Agente Decisão"),
    nodes: [
      { id: "start_node", type: "start" },
      { id: "input_safety_check", type: "safety_gate", stage: "input" },
      {
        id: "approval_step",
        type: "approval_gate",
        decisionPath: "user_message",
        approvalValue: "approved",
        rejectionValue: "rejected",
        resultPath: "approvals.approval_step",
      },
      {
        id: "score_response",
        type: "scoring",
        inputPath: "user_message",
        resultPath: "scores.score_response",
        threshold: 0.7,
      },
      {
        id: "record_metric",
        type: "analytics",
        metricName: "approval_score",
        payloadPath: "scores.score_response",
        resultPath: "analytics.record_metric",
      },
      { id: "llm_step", type: "llm_prompt", promptId: "system" },
      { id: "finish_node", type: "end" },
    ],
    edges: [
      { from: "start", to: "start_node", condition: "action == 'start'" },
      { from: "start", to: "input_safety_check", condition: "action == 'turn'" },
      { from: "start", to: "finish_node", condition: "action == 'finish'" },
      { from: "start_node", to: "end" },
      { from: "input_safety_check", to: "approval_step", condition: "safety.decision == 'allow'" },
      { from: "input_safety_check", to: "end", condition: "safety.blocked == true" },
      { from: "approval_step", to: "score_response" },
      { from: "score_response", to: "record_metric" },
      { from: "record_metric", to: "llm_step" },
      { from: "llm_step", to: "end" },
      { from: "finish_node", to: "end" },
    ],
  };

  await generateLangGraphRuntime({ flow, flowRoot, outDir });
  const graph = await readFile(path.join(outDir, "app", "graph.py"), "utf-8");
  assert.match(graph, /APPROVAL_GATE_NODE_IDS/);
  assert.match(graph, /SCORING_NODE_IDS/);
  assert.match(graph, /ANALYTICS_NODE_IDS/);
  await writeFile(
    path.join(outDir, "tests", "test_decision_nodes.py"),
    `from fastapi.testclient import TestClient

from app.generated_flow import API_RESOURCE
from tests.conftest import set_test_env


def _path(suffix: str = "") -> str:
    return f"/{API_RESOURCE}{suffix}"


def _client(tmp_path):
    set_test_env(str(tmp_path / "decision.db"))
    from app.db import engine
    from app.main import create_app
    from app.models import Base

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestClient(create_app())


def test_approval_scoring_and_analytics_events(tmp_path):
    client = _client(tmp_path)
    create_resp = client.post(_path(), headers={"Idempotency-Key": "create"}, json={"max_turns": 2})
    session_id = create_resp.json()["session"]["session_id"]
    client.post(_path(f"/{session_id}/start"), headers={"Idempotency-Key": "start"}, json={})

    turn_resp = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "turn"},
        json={"user_message": "approved resposta adequada"},
    )
    assert turn_resp.status_code == 200
    assert turn_resp.json()["assistant_message"]["code"] == "ECHO"

    events = client.get(_path(f"/{session_id}/events")).json()
    by_type = {item["event_type"]: item for item in events}
    approval = by_type["approval_gate_evaluated"]["payload"]["approval"]
    score = by_type["scoring_completed"]["payload"]["score"]
    analytics = by_type["analytics_recorded"]["payload"]["analytics"]
    assert approval["approved"] is True
    assert approval["decision"] == "approved"
    assert score["passed"] is True
    assert score["score"] == 1.0
    assert analytics["ok"] is True
    assert analytics["metric_name"] == "approval_score"
    assert analytics["payload"]["passed"] is True
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
    orchestration: {
      mode: "router",
      entryAgentId: firstFlow.id,
      handoffs: [
        {
          fromAgentId: firstFlow.id,
          toAgentId: secondFlow.id,
          condition: "output.assistant_message.code == ECHO",
        },
      ],
      memoryPolicy: {
        enabled: true,
        persistence: "optional_jsonl",
        defaultPersist: true,
        defaultMemoryPath: ".runtime-manifest/orchestration-memory-policy.jsonl",
        maxEntries: 8,
        retentionRuns: 2,
        maxPreviewChars: 240,
        redactKeys: ["api_key", "authorization", "token", "secret"],
        includeStepOutputs: true,
        includeHandoffDecisions: true,
      },
    },
  };

  await generateManifestRuntime({
    manifest,
    outDir,
    agents: [
      { id: firstFlow.id, routePrefix: "/first", flow: firstFlow, flowRoot: firstRoot },
      { id: secondFlow.id, routePrefix: "/second", flow: secondFlow, flowRoot: secondRoot },
    ],
  });

  const metadata = JSON.parse(await readFile(path.join(outDir, ".agent-flow", "generated-meta.json"), "utf-8"));
  assert.equal(metadata.target, "runtime-manifest-bundle");
  assert.equal(metadata.manifestId, "multiagent-reference");
  assert.equal(metadata.packaging, "multiagent");
  assert.equal(metadata.agents[0].resourceName, "sessions");
  assert.equal(metadata.agents[0].routePrefix, "/first");
  assert.equal(metadata.agents[1].runtimeDir, "agents/second-agent");
  assert.equal(metadata.sharedStorage.database.mode, "single-database");
  assert.equal(metadata.sharedStorage.database.tablesAreNamespacedBy, "agent_id");
  assert.equal(metadata.orchestration.format, "agent-flow-builder.runtime-orchestration.v1");
  assert.equal(metadata.orchestration.entryAgentId, "first-agent");
  assert.equal(metadata.orchestration.capabilities.debugTrace, true);
  assert.equal(metadata.orchestration.capabilities.structuredConditions, true);
  assert.equal(metadata.orchestration.capabilities.persistentMemoryPolicy, true);
  assert.equal(metadata.orchestration.memoryPolicy.defaultPersist, true);
  assert.equal(metadata.orchestration.memoryPolicy.maxEntries, 8);
  assert.equal(metadata.orchestration.handoffs[0].toAgentId, "second-agent");
  assert.equal(metadata.agentIsolation.format, "agent-flow-builder.runtime-agent-isolation.v1");
  assert.equal(metadata.agentIsolation.routeIsolation.uniqueRoutePrefixes, true);
  assert.equal(metadata.agentIsolation.runtimeImportIsolation.mode, "isolated-python-app-namespace");
  assert.equal(metadata.agentIsolation.requestIsolation.idempotencyNamespace, "route_prefix");
  assert.equal(metadata.agentIsolation.requestIsolation.sessionNamespace, "agent_id");
  assert.equal(metadata.agentIsolation.authIsolation.scopeNamespace, "agents:<agent_id>");

  const bundle = JSON.parse(await readFile(path.join(outDir, "bundle.json"), "utf-8"));
  assert.equal(bundle.agentIsolation.format, "agent-flow-builder.runtime-agent-isolation.v1");
  assert.equal(bundle.agentIsolation.agents[0].metadataPath, "/first/metadata");
  assert.equal(bundle.agentIsolation.agents[1].sessionsPath, "/second/sessions");
  assert.equal(bundle.orchestration.mode, "router");
  assert.equal(bundle.orchestration.capabilities.debugTrace, true);
  assert.equal(bundle.orchestration.memoryPolicy.retentionRuns, 2);
  assert.equal(bundle.orchestration.handoffs[0].condition, "output.assistant_message.code == ECHO");
  assert.equal(JSON.stringify(bundle.agentIsolation).includes("OPENAI_API_KEY"), false);

  const isolation = JSON.parse(await readFile(path.join(outDir, ".runtime-manifest", "agent-isolation.json"), "utf-8"));
  assert.equal(isolation.format, "agent-flow-builder.runtime-agent-isolation.v1");
  assert.equal(isolation.requestIsolation.eventNamespace, "agent_id");
  assert.deepEqual(isolation.runtimeImportIsolation.clearsModulePrefixes, ["app", "app.*"]);

  const orchestration = JSON.parse(await readFile(path.join(outDir, ".runtime-manifest", "orchestration.json"), "utf-8"));
  assert.equal(orchestration.format, "agent-flow-builder.runtime-orchestration.v1");
  assert.equal(orchestration.governance.excludesSecrets, true);
  assert.equal(orchestration.memoryPolicy.defaultMemoryPath, ".runtime-manifest/orchestration-memory-policy.jsonl");
  assert.equal(orchestration.handoffs[0].fromAgentId, "first-agent");

  const dockerCompose = await readFile(path.join(outDir, "docker-compose.yml"), "utf-8");
  assert.match(dockerCompose, /\n  worker:\n/);
  assert.match(dockerCompose, /command: \["python", "-m", "app\.worker"\]/);
  assert.match(dockerCompose, /required:\s*false/);
  const rootWorker = await readFile(path.join(outDir, "app", "worker.py"), "utf-8");
  assert.match(rootWorker, /def process_bundle_jobs/);
  assert.match(rootWorker, /build_worker_service/);
  assert.match(rootWorker, /_isolated_agent_import/);

  await execFileAsync("python", ["-m", "pytest", "-q"], {
    cwd: outDir,
    timeout: 120000,
  });
});

test("generated runtime supports local Ollama adapter without a real API key", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-codegen-ollama-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const flowRoot = path.join(workspaceRoot, "flow");
  const outDir = path.join(workspaceRoot, "runtime");
  const sandboxOutDir = path.join(workspaceRoot, "sandbox");
  await writeFlowAssets(flowRoot, "Agente local");

  const flow = simpleFlow("local-agent", "Agente Local");
  flow.llm = {
    adapter: "ollama",
    model: "qwen3:8b",
    apiKeyEnv: "OLLAMA_API_KEY",
    baseUrlEnv: "OLLAMA_BASE_URL",
    mockEnv: "MOCK_LLM",
  };
  flow.nodes = flow.nodes.map((node) =>
    node.id === "llm_step" ? { ...node, llm: { adapter: "ollama", model: "qwen3:8b" } } : node,
  );

  await generateLangGraphRuntime({ flow, flowRoot, outDir });

  const envExample = await readFile(path.join(outDir, ".env.example"), "utf-8");
  const settings = await readFile(path.join(outDir, "app", "settings.py"), "utf-8");
  const llmClient = await readFile(path.join(outDir, "app", "llm.py"), "utf-8");
  const graph = await readFile(path.join(outDir, "app", "graph.py"), "utf-8");
  const dockerCompose = await readFile(path.join(outDir, "docker-compose.yml"), "utf-8");
  const dockerComposeGpu = await readFile(path.join(outDir, "docker-compose.gpu.yml"), "utf-8");
  const dockerComposeModelImage = await readFile(path.join(outDir, "docker-compose.model-image.yml"), "utf-8");
  const ollamaModelDockerfile = await readFile(path.join(outDir, "ollama-models", "Dockerfile"), "utf-8");
  const readme = await readFile(path.join(outDir, "README.md"), "utf-8");
  assert.match(envExample, /OLLAMA_API_KEY=ollama/);
  assert.match(envExample, /LLM_MODEL=qwen3:8b/);
  assert.match(envExample, /OLLAMA_BASE_URL=http:\/\/localhost:11434\/v1/);
  assert.match(envExample, /OLLAMA_IMAGE=ollama\/ollama:latest/);
  assert.match(envExample, /OLLAMA_MODEL_IMAGE=local-agent-ollama-models:local/);
  assert.match(envExample, /OLLAMA_MODEL_NAMES=qwen3:8b/);
  assert.match(envExample, /OLLAMA_NUM_PARALLEL=1/);
  assert.match(envExample, /OLLAMA_MAX_LOADED_MODELS=1/);
  assert.match(envExample, /OLLAMA_CONTEXT_LENGTH=4096/);
  assert.doesNotMatch(envExample, /OPENAI_MODEL=/);
  assert.match(settings, /AliasChoices\("LLM_MODEL", "OPENAI_MODEL"\)/);
  assert.match(settings, /requires_api_key = False/);
  assert.match(settings, /if not self\.mock_llm and requires_api_key and not self\.openai_api_key\.strip\(\):/);
  assert.match(llmClient, /default_api_keys = json\.loads/);
  assert.match(llmClient, /default_base_urls = json\.loads/);
  assert.match(llmClient, /default_api_keys\.get\(selected_adapter\.lower\(\), "ollama"\)/);
  assert.match(llmClient, /default_base_urls\.get\(selected_adapter\.lower\(\), "http:\/\/localhost:11434\/v1"\)/);
  assert.match(llmClient, /_is_ollama_missing_model_error/);
  assert.match(llmClient, /fallback_reason="local_model_missing"/);
  assert.match(llmClient, /docker compose --profile model-setup up/);
  assert.match(graph, /llm_payload\["fallback_reason"\] = result\.fallback_reason/);
  assert.match(dockerCompose, /image: \$\{OLLAMA_IMAGE:-ollama\/ollama:latest\}/);
  assert.match(dockerCompose, /OLLAMA_KEEP_ALIVE: \$\{OLLAMA_KEEP_ALIVE:-5m\}/);
  assert.match(dockerCompose, /OLLAMA_NUM_PARALLEL: \$\{OLLAMA_NUM_PARALLEL:-1\}/);
  assert.match(dockerCompose, /ollama_models:\/root\/\.ollama/);
  assert.match(dockerCompose, /OLLAMA_BASE_URL: \$\{OLLAMA_BASE_URL:-http:\/\/ollama:11434\/v1\}/);
  assert.match(dockerCompose, /ollama:\n        condition: service_healthy/);
  assert.match(dockerCompose, /ollama-pull-qwen3-8b:/);
  assert.match(dockerCompose, /profiles:\n      - model-setup/);
  assert.match(dockerCompose, /OLLAMA_HOST: http:\/\/ollama:11434/);
  assert.match(dockerCompose, /command: \["pull", "qwen3:8b"\]/);
  assert.match(dockerComposeGpu, /driver: nvidia/);
  assert.match(dockerComposeGpu, /capabilities: \[gpu\]/);
  assert.match(dockerComposeModelImage, /dockerfile: ollama-models\/Dockerfile/);
  assert.match(dockerComposeModelImage, /OLLAMA_MODEL_NAMES: \$\{OLLAMA_MODEL_NAMES:-qwen3:8b\}/);
  assert.match(dockerComposeModelImage, /image: \$\{OLLAMA_MODEL_IMAGE:-local-agent-ollama-models:local\}/);
  assert.match(ollamaModelDockerfile, /ENV OLLAMA_MODELS=\/models/);
  assert.match(ollamaModelDockerfile, /ollama pull "\$model"/);
  assert.match(readme, /docker compose --profile model-setup up ollama-pull-qwen3-8b/);
  assert.match(readme, /docker compose exec ollama ollama pull qwen3:8b/);
  assert.match(readme, /docker-compose\.model-image\.yml build ollama/);
  assert.match(readme, /docker image save -o model-distribution\/local-agent-ollama-models.local.tar local-agent-ollama-models:local/);
  assert.match(readme, /docker-compose\.gpu\.yml up -d --build/);

  await generateLangGraphSandbox({ flow, flowRoot, outDir: sandboxOutDir });
  const sandboxEnv = await readFile(path.join(sandboxOutDir, ".env.example"), "utf-8");
  assert.match(sandboxEnv, /OLLAMA_API_KEY=ollama/);
  assert.match(sandboxEnv, /LLM_MODEL=qwen3:8b/);
  assert.match(sandboxEnv, /OLLAMA_BASE_URL=http:\/\/localhost:11434\/v1/);
});

test("generated runtime uses Ollama compose env for node-level local adapter overrides", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-codegen-ollama-node-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const flowRoot = path.join(workspaceRoot, "flow");
  const outDir = path.join(workspaceRoot, "runtime");
  await writeFlowAssets(flowRoot, "Agente local por nó");

  const flow = simpleFlow("mixed-local-agent", "Agente Misto Local");
  flow.nodes = flow.nodes.map((node) =>
    node.id === "llm_step" ? { ...node, llm: { adapter: "ollama", model: "llama3.2:3b" } } : node,
  );

  await generateLangGraphRuntime({ flow, flowRoot, outDir });

  const dockerCompose = await readFile(path.join(outDir, "docker-compose.yml"), "utf-8");
  const envExample = await readFile(path.join(outDir, ".env.example"), "utf-8");
  const dockerComposeModelImage = await readFile(path.join(outDir, "docker-compose.model-image.yml"), "utf-8");
  const readme = await readFile(path.join(outDir, "README.md"), "utf-8");
  assert.match(envExample, /OLLAMA_MODEL_IMAGE=mixed-local-agent-ollama-models:local/);
  assert.match(envExample, /OLLAMA_MODEL_NAMES=llama3\.2:3b/);
  assert.match(dockerCompose, /image: \$\{OLLAMA_IMAGE:-ollama\/ollama:latest\}/);
  assert.match(dockerCompose, /OLLAMA_BASE_URL: \$\{OLLAMA_BASE_URL:-http:\/\/ollama:11434\/v1\}/);
  assert.doesNotMatch(dockerCompose, /OPENAI_BASE_URL: \$\{OPENAI_BASE_URL:-http:\/\/ollama:11434\/v1\}/);
  assert.match(dockerCompose, /ollama-pull-llama3-2-3b:/);
  assert.match(dockerCompose, /command: \["pull", "llama3\.2:3b"\]/);
  assert.match(dockerComposeModelImage, /OLLAMA_MODEL_NAMES: \$\{OLLAMA_MODEL_NAMES:-llama3\.2:3b\}/);
  assert.match(dockerComposeModelImage, /image: \$\{OLLAMA_MODEL_IMAGE:-mixed-local-agent-ollama-models:local\}/);
  assert.match(readme, /docker compose --profile model-setup up ollama-pull-llama3-2-3b/);
  assert.match(readme, /docker compose exec ollama ollama pull llama3\.2:3b/);
});

test("generated multiagent bundle includes Ollama service when one agent uses a local adapter", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-codegen-multi-ollama-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const firstRoot = path.join(workspaceRoot, "first-flow");
  const secondRoot = path.join(workspaceRoot, "second-flow");
  const outDir = path.join(workspaceRoot, "bundle");
  await writeFlowAssets(firstRoot, "Primeiro agente local");
  await writeFlowAssets(secondRoot, "Segundo agente");

  const firstFlow = simpleFlow("first-local-agent", "Primeiro Agente Local");
  firstFlow.llm = {
    adapter: "ollama",
    model: "qwen3:8b",
    apiKeyEnv: "OLLAMA_API_KEY",
    baseUrlEnv: "OLLAMA_BASE_URL",
    mockEnv: "MOCK_LLM",
  };
  firstFlow.nodes = firstFlow.nodes.map((node) =>
    node.id === "llm_step" ? { ...node, llm: { adapter: "ollama", model: "llama3.2:3b" } } : node,
  );
  const secondFlow = simpleFlow("second-openai-agent", "Segundo Agente OpenAI");
  const manifest: RuntimeManifest = {
    id: "multiagent-local-reference",
    name: "Multiagent Local Reference",
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
    orchestration: {
      mode: "router",
      entryAgentId: firstFlow.id,
      handoffs: [
        {
          fromAgentId: firstFlow.id,
          toAgentId: secondFlow.id,
          condition: "output.assistant_message.code == ECHO",
        },
      ],
    },
  };

  await generateManifestRuntime({
    manifest,
    outDir,
    agents: [
      { id: firstFlow.id, routePrefix: "/first", flow: firstFlow, flowRoot: firstRoot },
      { id: secondFlow.id, routePrefix: "/second", flow: secondFlow, flowRoot: secondRoot },
    ],
  });

  const envExample = await readFile(path.join(outDir, ".env.example"), "utf-8");
  const dockerCompose = await readFile(path.join(outDir, "docker-compose.yml"), "utf-8");
  const dockerComposeGpu = await readFile(path.join(outDir, "docker-compose.gpu.yml"), "utf-8");
  const dockerComposeModelImage = await readFile(path.join(outDir, "docker-compose.model-image.yml"), "utf-8");
  const ollamaModelDockerfile = await readFile(path.join(outDir, "ollama-models", "Dockerfile"), "utf-8");
  const readme = await readFile(path.join(outDir, "README.md"), "utf-8");
  assert.match(envExample, /OLLAMA_API_KEY=ollama/);
  assert.match(envExample, /OLLAMA_BASE_URL=http:\/\/localhost:11434\/v1/);
  assert.match(envExample, /OLLAMA_MODEL_IMAGE=multiagent-local-reference-ollama-models:local/);
  assert.match(envExample, /OLLAMA_MODEL_NAMES=qwen3:8b llama3\.2:3b/);
  assert.match(dockerCompose, /image: \$\{OLLAMA_IMAGE:-ollama\/ollama:latest\}/);
  assert.match(dockerCompose, /ollama_models:\/root\/\.ollama/);
  assert.match(dockerCompose, /OLLAMA_BASE_URL: \$\{OLLAMA_BASE_URL:-http:\/\/ollama:11434\/v1\}/);
  assert.doesNotMatch(dockerCompose, /OPENAI_BASE_URL: \$\{OPENAI_BASE_URL:-http:\/\/ollama:11434\/v1\}/);
  assert.match(dockerCompose, /ollama-pull-qwen3-8b:/);
  assert.match(dockerCompose, /command: \["pull", "qwen3:8b"\]/);
  assert.match(dockerCompose, /ollama-pull-llama3-2-3b:/);
  assert.match(dockerCompose, /command: \["pull", "llama3\.2:3b"\]/);
  assert.match(dockerComposeGpu, /driver: nvidia/);
  assert.match(dockerComposeModelImage, /OLLAMA_MODEL_NAMES: \$\{OLLAMA_MODEL_NAMES:-qwen3:8b llama3\.2:3b\}/);
  assert.match(dockerComposeModelImage, /image: \$\{OLLAMA_MODEL_IMAGE:-multiagent-local-reference-ollama-models:local\}/);
  assert.match(ollamaModelDockerfile, /ENV OLLAMA_MODELS=\/models/);
  assert.match(readme, /docker compose --profile model-setup up ollama-pull-qwen3-8b ollama-pull-llama3-2-3b/);
  assert.match(readme, /docker compose exec ollama ollama pull qwen3:8b/);
  assert.match(readme, /docker-compose\.model-image\.yml build ollama/);
  assert.match(readme, /docker image save -o model-distribution\/multiagent-local-reference-ollama-models.local.tar multiagent-local-reference-ollama-models:local/);
  assert.match(readme, /docker-compose\.gpu\.yml up -d --build/);
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
