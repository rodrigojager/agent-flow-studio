import { access } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { safeResolve, WorkspaceError } from "./workspace.ts";

export interface SandboxStartOptions {
  runtimeDir?: string;
  port?: number;
}

export interface SandboxStatus {
  flowId: string;
  running: boolean;
  port: number | null;
  pid: number | null;
  url: string | null;
  docsUrl: string | null;
  runtimeDir: string | null;
  logs: string[];
}

interface SandboxProcess {
  flowId: string;
  runtimeDir: string;
  port: number;
  child: ChildProcessWithoutNullStreams;
  logs: string[];
}

const DEFAULT_PORT = 8090;
const LOG_LIMIT = 120;

export class SandboxManager {
  private readonly sandboxes = new Map<string, SandboxProcess>();

  constructor(private readonly workspaceRoot: string) {}

  list(): SandboxStatus[] {
    return [...this.sandboxes.values()].map((sandbox) => this.toStatus(sandbox));
  }

  async start(flowId: string, options: SandboxStartOptions = {}): Promise<SandboxStatus> {
    const current = this.sandboxes.get(flowId);
    if (current && isRunning(current.child)) {
      return this.toStatus(current);
    }
    if (current) {
      this.sandboxes.delete(flowId);
    }

    const runtimeDir = safeResolve(this.workspaceRoot, options.runtimeDir || `generated/${flowId}-runtime`);
    await assertRuntimeDir(runtimeDir);
    const port = normalizePort(options.port);
    const conflict = [...this.sandboxes.values()].find(
      (sandbox) => sandbox.flowId !== flowId && sandbox.port === port && isRunning(sandbox.child),
    );
    if (conflict) {
      throw new WorkspaceError(`Porta ${port} já está em uso pelo sandbox ${conflict.flowId}.`, 409);
    }

    const logs: string[] = [];
    const child = spawn(
      "python",
      ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(port)],
      {
        cwd: runtimeDir,
        env: {
          ...process.env,
          DATABASE_URL: "sqlite:///./sandbox_runtime.db",
          REDIS_ENABLED: "false",
          USE_POSTGRES_CHECKPOINTER: "false",
          MOCK_LLM: "true",
          AUTH_ENABLED: "false",
          AUTO_CREATE_TABLES: "true",
        },
        windowsHide: true,
      },
    );

    const sandbox: SandboxProcess = { flowId, runtimeDir, port, child, logs };
    child.stdout.on("data", (chunk) => appendLog(logs, chunk.toString()));
    child.stderr.on("data", (chunk) => appendLog(logs, chunk.toString()));
    child.on("exit", (code, signal) => {
      appendLog(logs, `process exited code=${code ?? "null"} signal=${signal ?? "null"}`);
    });
    this.sandboxes.set(flowId, sandbox);

    try {
      await waitForHealth(port, logs);
    } catch (error) {
      await stopChild(child);
      this.sandboxes.delete(flowId);
      throw error;
    }
    return this.toStatus(sandbox);
  }

  status(flowId: string): SandboxStatus {
    const sandbox = this.sandboxes.get(flowId);
    if (!sandbox || !isRunning(sandbox.child)) {
      return emptyStatus(flowId);
    }
    return this.toStatus(sandbox);
  }

  async stop(flowId: string): Promise<SandboxStatus> {
    const sandbox = this.sandboxes.get(flowId);
    if (!sandbox) {
      return emptyStatus(flowId);
    }
    await stopChild(sandbox.child);
    this.sandboxes.delete(flowId);
    return {
      ...emptyStatus(flowId),
      port: sandbox.port,
      runtimeDir: path.relative(this.workspaceRoot, sandbox.runtimeDir).replaceAll(path.sep, "/"),
      logs: sandbox.logs.slice(-LOG_LIMIT),
    };
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.sandboxes.keys()].map((flowId) => this.stop(flowId)));
  }

  private toStatus(sandbox: SandboxProcess): SandboxStatus {
    const running = isRunning(sandbox.child);
    return {
      flowId: sandbox.flowId,
      running,
      port: sandbox.port,
      pid: sandbox.child.pid ?? null,
      url: running ? `http://127.0.0.1:${sandbox.port}` : null,
      docsUrl: running ? `http://127.0.0.1:${sandbox.port}/docs` : null,
      runtimeDir: path.relative(this.workspaceRoot, sandbox.runtimeDir).replaceAll(path.sep, "/"),
      logs: sandbox.logs.slice(-LOG_LIMIT),
    };
  }
}

async function assertRuntimeDir(runtimeDir: string): Promise<void> {
  try {
    await access(path.join(runtimeDir, "app", "main.py"));
    await access(path.join(runtimeDir, "pyproject.toml"));
  } catch {
    throw new WorkspaceError(`Runtime gerado não encontrado em ${runtimeDir}. Gere o flow antes de iniciar o sandbox.`, 404);
  }
}

function normalizePort(port: number | undefined): number {
  if (port === undefined) {
    return DEFAULT_PORT;
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new WorkspaceError("port deve ser inteiro entre 1024 e 65535.", 400);
  }
  return port;
}

function isRunning(child: ChildProcessWithoutNullStreams): boolean {
  return !child.killed && child.exitCode === null;
}

function appendLog(logs: string[], text: string): void {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) {
      logs.push(trimmed);
    }
  }
  while (logs.length > LOG_LIMIT) {
    logs.shift();
  }
}

async function waitForHealth(port: number, logs: string[]): Promise<void> {
  const deadline = Date.now() + 15000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  appendLog(logs, `health check timeout: ${lastError}`);
  throw new WorkspaceError(`Sandbox não respondeu em http://127.0.0.1:${port}/health.`, 504, logs.slice(-20));
}

async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.killed || child.exitCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2500);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}

function emptyStatus(flowId: string): SandboxStatus {
  return {
    flowId,
    running: false,
    port: null,
    pid: null,
    url: null,
    docsUrl: null,
    runtimeDir: null,
    logs: [],
  };
}
