import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import type { AgentFlow } from "@agent-flow-builder/flow-spec";
import { generateLangGraphRuntime } from "./index.ts";

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

  await generateLangGraphRuntime({ flow, flowRoot, outDir });
  await execFileAsync("python", ["-m", "pytest", "-q", outDir], {
    cwd: outDir,
    timeout: 120000,
  });
});
