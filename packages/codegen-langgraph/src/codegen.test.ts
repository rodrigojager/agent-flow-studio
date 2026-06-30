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
  const langGraphConfig = JSON.parse(await readFile(path.join(outDir, "langgraph.json"), "utf-8"));
  const langGraphEntrypoint = await readFile(path.join(outDir, "app", "langgraph_app.py"), "utf-8");
  const runtimeMetadata = JSON.parse(await readFile(path.join(outDir, ".agent-flow", "generated-meta.json"), "utf-8"));
  assert.match(graph, /\\"llmAdapter\\": \\"openrouter\\"/);
  assert.match(graph, /\\"llmModel\\": \\"openai\/gpt-4\.1-mini\\"/);
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
  const sandboxPyproject = await readFile(path.join(sandboxOutDir, "pyproject.toml"), "utf-8");
  const sandboxConfig = JSON.parse(await readFile(path.join(sandboxOutDir, "langgraph.json"), "utf-8"));
  const sandboxMetadata = JSON.parse(await readFile(path.join(sandboxOutDir, ".agent-flow", "generated-meta.json"), "utf-8"));
  await readFile(path.join(sandboxOutDir, "app", "langgraph_app.py"), "utf-8");
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
