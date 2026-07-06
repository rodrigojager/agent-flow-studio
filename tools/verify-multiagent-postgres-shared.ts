import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AgentFlow, RuntimeManifest } from "@agent-flow-builder/flow-spec";
import { generateManifestRuntime } from "../packages/codegen-langgraph/src/index.ts";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 180_000;

async function main(): Promise<void> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-flow-postgres-shared-"));
  const firstRoot = path.join(workspaceRoot, "first-flow");
  const secondRoot = path.join(workspaceRoot, "second-flow");
  const outDir = path.join(workspaceRoot, "bundle");
  const port = await findFreePort();
  const containerName = `agent-flow-postgres-${process.pid}-${Date.now()}`;
  let containerStarted = false;

  try {
    await writeFlowAssets(firstRoot, "Primeiro agente");
    await writeFlowAssets(secondRoot, "Segundo agente");
    const firstFlow = simpleFlow("first-agent", "Primeiro Agente");
    const secondFlow = simpleFlow("second-agent", "Segundo Agente");
    const manifest: RuntimeManifest = {
      id: "postgres-shared-reference",
      name: "Postgres Shared Reference",
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
        { id: firstFlow.id, flowPath: "first-flow/agent.flow.json", routePrefix: "/first" },
        { id: secondFlow.id, flowPath: "second-flow/agent.flow.json", routePrefix: "/second" },
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

    await run("docker", [
      "run",
      "-d",
      "--rm",
      "--name",
      containerName,
      "-e",
      "POSTGRES_USER=agent",
      "-e",
      "POSTGRES_PASSWORD=agent",
      "-e",
      "POSTGRES_DB=agent_runtime",
      "-p",
      `127.0.0.1:${port}:5432`,
      "postgres:16-alpine",
    ]);
    containerStarted = true;
    await waitForPostgres(containerName);

    const databaseUrl = `postgresql+psycopg2://agent:agent@127.0.0.1:${port}/agent_runtime`;
    const result = await run("python", ["-m", "pytest", "-q", "-m", "integration", "tests/test_multiagent_bundle.py"], {
      cwd: outDir,
      env: {
        ...process.env,
        AGENT_FLOW_TEST_POSTGRES_URL: databaseUrl,
      },
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    console.log(
      JSON.stringify(
        {
          status: "ok",
          bundle: outDir,
          agents: ["first-agent", "second-agent"],
          postgres: `127.0.0.1:${port}`,
        },
        null,
        2,
      ),
    );
  } finally {
    if (containerStarted) {
      await run("docker", ["rm", "-f", containerName]).catch(() => ({ stdout: "", stderr: "" }));
    }
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(command, args, {
    cwd: options.cwd,
    env: options.env,
    timeout: COMMAND_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
}

async function waitForPostgres(containerName: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      await run("docker", ["exec", containerName, "pg_isready", "-U", "agent", "-d", "agent_runtime"]);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await sleep(1000);
    }
  }
  throw new Error(`Postgres Docker não ficou pronto em 60s: ${lastError}`);
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address?.port) {
        server.close(() => resolve(address.port));
      } else {
        server.close(() => reject(new Error("Não foi possível reservar porta local.")));
      }
    });
  });
}

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();
