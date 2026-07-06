import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_RUNTIME_DIR = "generated/reference-interview-runtime";
const COMMAND_TIMEOUT_MS = 300_000;
const HTTP_TIMEOUT_MS = 20_000;

interface CliOptions {
  runtimeDir: string;
  runtimeUrl?: string;
  downAfter: boolean;
  skipBuild: boolean;
}

interface SmokeSummary {
  runtimeDir: string;
  runtimeUrl: string;
  envFileExists: boolean;
  health: unknown;
  metadata: Record<string, unknown>;
  sessionId: string;
  assistantCode: string | null;
  safetyDecision: string | null;
  transcriptCount: number;
  eventTypes: string[];
  finishStatus: string | null;
  jobStatuses: string[];
  forbiddenLogMatches: string[];
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const runtimeDir = resolveRuntimeDir(options.runtimeDir);
  const envFileExists = await fileExists(path.join(runtimeDir, ".env"));

  await assertComposeAcceptsMissingEnv(runtimeDir, envFileExists);
  if (!options.skipBuild) {
    await runDocker(runtimeDir, ["compose", "up", "-d", "--build"]);
  }

  const runtimeUrl = options.runtimeUrl ?? await resolveRuntimeUrl(runtimeDir);
  try {
    const summary = await smokeRuntime(runtimeDir, runtimeUrl, envFileExists);
    console.log(JSON.stringify({ status: "ok", ...summary }, null, 2));
  } finally {
    if (options.downAfter) {
      await runDocker(runtimeDir, ["compose", "down"]).catch((error) => {
        console.error(`Falha ao executar docker compose down: ${formatError(error)}`);
      });
    }
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    runtimeDir: DEFAULT_RUNTIME_DIR,
    downAfter: false,
    skipBuild: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--runtime-dir") {
      options.runtimeDir = requireValue(args, ++index, arg);
      continue;
    }
    if (arg.startsWith("--runtime-dir=")) {
      options.runtimeDir = arg.slice("--runtime-dir=".length);
      continue;
    }
    if (arg === "--runtime-url") {
      options.runtimeUrl = requireValue(args, ++index, arg);
      continue;
    }
    if (arg.startsWith("--runtime-url=")) {
      options.runtimeUrl = arg.slice("--runtime-url=".length);
      continue;
    }
    if (arg === "--down-after") {
      options.downAfter = true;
      continue;
    }
    if (arg === "--skip-build") {
      options.skipBuild = true;
      continue;
    }
    throw new Error(`Argumento desconhecido: ${arg}`);
  }

  return options;
}

function requireValue(args: string[], index: number, name: string): string {
  const value = args[index];
  if (!value) {
    throw new Error(`${name} precisa de valor.`);
  }
  return value;
}

function resolveRuntimeDir(runtimeDir: string): string {
  const resolved = path.resolve(REPO_ROOT, runtimeDir);
  if (!resolved.startsWith(REPO_ROOT + path.sep)) {
    throw new Error(`runtimeDir fora do repositório: ${runtimeDir}`);
  }
  return resolved;
}

async function assertComposeAcceptsMissingEnv(runtimeDir: string, envFileExists: boolean): Promise<void> {
  const composePath = path.join(runtimeDir, "docker-compose.yml");
  const compose = await readFile(composePath, "utf-8");
  assert.match(compose, /required:\s*false/, "docker-compose.yml deve aceitar .env ausente.");
  if (!envFileExists) {
    await runDocker(runtimeDir, ["compose", "config"]);
  }
}

async function resolveRuntimeUrl(runtimeDir: string): Promise<string> {
  try {
    const result = await runDocker(runtimeDir, ["compose", "port", "api", "8080"], { timeoutMs: 30_000 });
    const raw = result.stdout.trim().split(/\r?\n/).at(-1)?.trim() ?? "";
    const port = parsePort(raw);
    if (port) {
      return `http://127.0.0.1:${port}`;
    }
  } catch {
    // Fall back to the generated default below.
  }
  return "http://127.0.0.1:8080";
}

function parsePort(raw: string): string | null {
  const bracketMatch = /\]:(\d+)$/.exec(raw);
  if (bracketMatch) {
    return bracketMatch[1];
  }
  const match = /:(\d+)$/.exec(raw);
  return match?.[1] ?? null;
}

async function smokeRuntime(runtimeDir: string, runtimeUrl: string, envFileExists: boolean): Promise<SmokeSummary> {
  const health = await waitForHealth(runtimeUrl);
  assert.equal((health as Record<string, unknown>).status, "ok", "health.status deve ser ok");
  assert.equal((health as Record<string, unknown>).db_ok, true, "health.db_ok deve ser true");
  assert.equal((health as Record<string, unknown>).cache_ok, true, "health.cache_ok deve ser true");

  const metadata = await requestJson<Record<string, unknown>>(`${runtimeUrl}/metadata`);
  assert.equal(metadata.flow_id, "reference-interview");
  assert.equal(metadata.agent_id, "reference-interview");
  assert.equal(metadata.runtime, "langgraph-fastapi-python");

  const runId = randomUUID().replace(/-/g, "");
  const create = await requestJson<Record<string, any>>(`${runtimeUrl}/sessions`, {
    method: "POST",
    headers: { "Idempotency-Key": `create-${runId}` },
    body: {
      metadata: {
        source: "docker-runtime-smoke",
        run: runId,
      },
      max_turns: 2,
    },
  });
  const sessionId = create.session?.session_id;
  assert.equal(typeof sessionId, "string", "create deve retornar session.session_id");

  const start = await requestJson<Record<string, any>>(`${runtimeUrl}/sessions/${sessionId}/start`, {
    method: "POST",
    headers: { "Idempotency-Key": `start-${runId}` },
    body: {},
  });
  assert.equal(start.session?.status, "active");

  const turn = await requestJson<Record<string, any>>(`${runtimeUrl}/sessions/${sessionId}/turn`, {
    method: "POST",
    headers: { "Idempotency-Key": `turn-${runId}` },
    body: { user_message: "Gere uma pergunta sobre IA." },
  });
  assert.equal(turn.safety?.decision, "allow");
  assert.equal(turn.assistant_message?.code, "ECHO");

  const transcript = await requestJson<unknown[]>(`${runtimeUrl}/sessions/${sessionId}/transcript`);
  assert.ok(Array.isArray(transcript));
  assert.ok(transcript.length >= 3, `transcript deveria ter pelo menos 3 mensagens, recebeu ${transcript.length}`);

  const events = await requestJson<Array<Record<string, unknown>>>(`${runtimeUrl}/sessions/${sessionId}/events`);
  const eventTypes = events.map((event) => String(event.event_type ?? ""));
  assert.ok(eventTypes.includes("llm_called"), "events deve incluir llm_called");

  const finish = await requestJson<Record<string, any>>(`${runtimeUrl}/sessions/${sessionId}/finish`, {
    method: "POST",
    headers: { "Idempotency-Key": `finish-${runId}` },
    body: {},
  });
  assert.equal(finish.session?.status, "completed");

  const jobs = await waitForSucceededJob(runtimeUrl, sessionId);
  const jobStatuses = jobs.map((job) => String(job.status ?? ""));
  assert.ok(jobStatuses.includes("succeeded"), `esperava job succeeded, recebeu ${jobStatuses.join(",")}`);

  const forbiddenLogMatches = await inspectLogsForForbiddenPatterns(runtimeDir);
  assert.deepEqual(forbiddenLogMatches, [], `logs contem erros: ${forbiddenLogMatches.join(", ")}`);

  return {
    runtimeDir: path.relative(REPO_ROOT, runtimeDir),
    runtimeUrl,
    envFileExists,
    health,
    metadata,
    sessionId,
    assistantCode: turn.assistant_message?.code ?? null,
    safetyDecision: turn.safety?.decision ?? null,
    transcriptCount: transcript.length,
    eventTypes,
    finishStatus: finish.session?.status ?? null,
    jobStatuses,
    forbiddenLogMatches,
  };
}

async function waitForHealth(runtimeUrl: string): Promise<unknown> {
  const deadline = Date.now() + 90_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const health = await requestJson(`${runtimeUrl}/health`, { timeoutMs: 5_000 });
      if ((health as Record<string, unknown>).status === "ok") {
        return health;
      }
      lastError = JSON.stringify(health);
    } catch (error) {
      lastError = formatError(error);
    }
    await sleep(2_000);
  }
  throw new Error(`Runtime não ficou saudável em 90s: ${lastError}`);
}

async function waitForSucceededJob(runtimeUrl: string, sessionId: string): Promise<Array<Record<string, unknown>>> {
  const deadline = Date.now() + 45_000;
  let jobs: Array<Record<string, unknown>> = [];
  while (Date.now() < deadline) {
    jobs = await requestJson<Array<Record<string, unknown>>>(
      `${runtimeUrl}/jobs?session_id=${encodeURIComponent(sessionId)}`,
      { timeoutMs: 10_000 },
    );
    if (jobs.some((job) => job.status === "succeeded")) {
      return jobs;
    }
    await sleep(2_000);
  }
  throw new Error(`Job pós-finalização não ficou succeeded: ${JSON.stringify(jobs)}`);
}

async function inspectLogsForForbiddenPatterns(runtimeDir: string): Promise<string[]> {
  const result = await runDocker(runtimeDir, ["compose", "logs", "--tail", "240", "--no-color"], { timeoutMs: 60_000 });
  const logs = `${result.stdout}\n${result.stderr}`;
  const forbidden = [
    "Traceback",
    "IntegrityError",
    "duplicate key",
    "LangSmithMissingAPIKeyWarning",
    "LangSmithAuthError",
    "Unauthorized",
  ];
  return forbidden.filter((pattern) => logs.includes(pattern));
}

interface RequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

async function requestJson<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...(options.headers ?? {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${options.method ?? "GET"} ${url} -> ${response.status}: ${text}`);
    }
    return (text ? JSON.parse(text) : null) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function runDocker(
  cwd: string,
  args: string[],
  options: { timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("docker", args, {
    cwd,
    timeout: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 30 * 1024 * 1024,
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

await main();
