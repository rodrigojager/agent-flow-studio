import { execFile, spawn } from "node:child_process";
import { access, appendFile, copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parse, stringify } from "yaml";
import { normalizeWorkspaceRoot, safeResolve, toWorkspaceRelative, WorkspaceError } from "./workspace.ts";

const execFileAsync = promisify(execFile);
const DEFAULT_RUNTIME_URL = "http://127.0.0.1:8080";
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_COMMAND_BUFFER = 20 * 1024 * 1024;
const DOCKER_BUILD_PROGRESS_CACHE_MAX = 20;

export type DockerRuntimeOperation = "prepare_env" | "configure_ports" | "build" | "up" | "down" | "smoke" | "inspect" | "cancel";
export type DockerRuntimeOperationStatus = "idle" | "running" | "success" | "error" | "canceled";
type DockerBuildProgressStatus = "running" | "done" | "error" | "warning" | "info" | "canceled";

interface DockerBuildProgressEvent {
  stage: string;
  status: DockerBuildProgressStatus;
  message: string;
  line: string;
  percent?: number;
  timestamp: string;
}

export interface DockerCommandInvocation {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  onOutput?: (chunk: string) => void;
  signal?: AbortSignal;
}

export interface DockerCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  aborted?: boolean;
}

export type DockerCommandRunner = (invocation: DockerCommandInvocation) => Promise<DockerCommandResult>;

export interface DockerRuntimeProject {
  outDir: string;
  absoluteOutDir: string;
  flowId: string | null;
  flowVersion: string | null;
  flowHash: string | null;
  target: "fastapi-runtime";
  resourceName: string;
  runtimeUrl: string;
  docsUrl: string;
  openapiUrl: string;
  ports: DockerRuntimePorts;
}

export interface DockerRuntimeStatus {
  outDir: string;
  ready: boolean;
  target: "fastapi-runtime" | null;
  flowId: string | null;
  flowVersion: string | null;
  flowHash: string | null;
  resourceName: string | null;
  runtimeUrl: string;
  docsUrl: string;
  openapiUrl: string;
  ports: DockerRuntimePorts;
  composeFile: boolean;
  dockerfile: boolean;
  envFile: boolean;
  lastOperation: DockerRuntimeOperation | null;
  lastStatus: DockerRuntimeOperationStatus;
  lastExitCode: number | null;
  updatedAt: string | null;
  logs: string[];
  inspection: DockerRuntimeInspection | null;
  progress?: DockerBuildProgressEvent[];
}

export interface DockerRuntimeOperationResult extends DockerRuntimeStatus {
  operation: DockerRuntimeOperation;
  ok: boolean;
  command?: string;
  args?: string[];
  stdout?: string;
  stderr?: string;
  smoke?: DockerRuntimeSmokeResult;
  progress?: DockerBuildProgressEvent[];
  message: string;
}

export interface DockerRuntimePortBinding {
  service: "api" | "postgres" | "redis";
  hostPort: number;
  containerPort: number;
  value: string;
}

export interface DockerRuntimePorts {
  api: DockerRuntimePortBinding | null;
  postgres: DockerRuntimePortBinding | null;
  redis: DockerRuntimePortBinding | null;
}

export interface DockerRuntimePortUpdate {
  api?: number;
  postgres?: number;
  redis?: number;
}

export interface DockerRuntimeHistoryEntry {
  id: string;
  outDir: string;
  operation: DockerRuntimeOperation;
  ok: boolean;
  status: DockerRuntimeOperationStatus;
  exitCode: number | null;
  runtimeUrl: string;
  startedAt: string;
  finishedAt: string;
  message: string;
  command?: string;
  args?: string[];
  logs: string[];
  smoke?: DockerRuntimeSmokeResult;
  inspection?: DockerRuntimeInspection;
  progress?: DockerBuildProgressEvent[];
}

export interface DockerRuntimeHistory {
  outDir: string;
  entries: DockerRuntimeHistoryEntry[];
}

export interface DockerRuntimeHistoryQuery {
  limit?: number;
  operation?: DockerRuntimeOperation;
  status?: DockerRuntimeOperationStatus;
  ok?: boolean;
  search?: string;
  from?: string;
  to?: string;
}

interface DockerRuntimeHistoryFilter {
  operation?: DockerRuntimeOperation;
  status?: DockerRuntimeOperationStatus;
  ok?: boolean;
  search?: string;
  fromMs?: number;
  toMs?: number;
}

export interface DockerRuntimeSmokeResult {
  health: unknown;
  metadata: unknown;
  sessionId: string;
  transcriptCount: number;
  eventsCount: number;
}

export interface DockerComposeService {
  name: string | null;
  service: string | null;
  state: string | null;
  status: string | null;
  ports: string | null;
  raw: Record<string, unknown>;
}

export interface DockerRuntimeInspection {
  containers: DockerComposeService[];
  rawPs: string;
  rawLogs: string;
}

interface GeneratedMetadata {
  target?: string;
  flowId?: string;
  flowVersion?: string;
  flowHash?: string;
}

interface RuntimeRecord {
  lastOperation: DockerRuntimeOperation | null;
  lastStatus: DockerRuntimeOperationStatus;
  lastExitCode: number | null;
  updatedAt: string | null;
  logs: string[];
  inspection: DockerRuntimeInspection | null;
  progress?: DockerBuildProgressEvent[];
}

interface ActiveDockerOperation {
  operation: Exclude<DockerRuntimeOperation, "prepare_env" | "configure_ports" | "smoke" | "inspect" | "cancel">;
  controller: AbortController;
}

interface DockerRuntimeManagerOptions {
  runner?: DockerCommandRunner;
}

export class DockerRuntimeManager {
  private readonly workspaceRoot: string;
  private readonly runner: DockerCommandRunner;
  private readonly records = new Map<string, RuntimeRecord>();
  private readonly activeOperations = new Map<string, ActiveDockerOperation>();

  constructor(workspaceRoot: string, options: DockerRuntimeManagerOptions = {}) {
    this.workspaceRoot = normalizeWorkspaceRoot(workspaceRoot);
    this.runner = options.runner ?? defaultDockerCommandRunner;
  }

  async status(outDir: string, runtimeUrl?: string): Promise<DockerRuntimeStatus> {
    const project = await this.resolveProject(outDir, runtimeUrl);
    return this.statusFromProject(project);
  }

  async history(
    outDir: string,
    runtimeUrl?: string,
    limitOrQuery: number | DockerRuntimeHistoryQuery = 20,
  ): Promise<DockerRuntimeHistory> {
    const project = await this.resolveProject(outDir, runtimeUrl);
    const query = normalizeDockerRuntimeHistoryQuery(limitOrQuery);
    const entries = await this.readHistoryEntries(project.outDir, query);
    return { outDir: project.outDir, entries };
  }

  async build(outDir: string, runtimeUrl?: string): Promise<DockerRuntimeOperationResult> {
    return this.runDockerCompose(outDir, "build", ["compose", "build", "api"], runtimeUrl);
  }

  async cancel(outDir: string, runtimeUrl?: string): Promise<DockerRuntimeOperationResult> {
    const project = await this.resolveProject(outDir, runtimeUrl);
    const active = this.activeOperations.get(project.outDir);
    if (!active || active.operation !== "build") {
      throw new WorkspaceError("Nenhum build Docker em execução para cancelar.", 409);
    }

    active.controller.abort();
    const logs = [
      ...this.readRecord(project.outDir).logs,
      "Cancelamento do build Docker solicitado pelo usuário.",
    ].slice(-40);
    this.updateRecord(project.outDir, {
      ...this.readRecord(project.outDir),
      lastOperation: "build",
      lastStatus: "running",
      lastExitCode: null,
      updatedAt: new Date().toISOString(),
      logs,
    });
    await this.appendHistory(project, {
      operation: "cancel",
      ok: true,
      status: "success",
      exitCode: 0,
      startedAt: new Date().toISOString(),
      message: "Cancelamento do build Docker solicitado.",
      command: "docker",
      args: ["compose", "build", "api"],
      logs,
    });

    return {
      ...(await this.statusFromProject(project)),
      operation: "cancel",
      ok: true,
      command: "docker",
      args: ["compose", "build", "api"],
      message: "Cancelamento do build Docker solicitado.",
    };
  }

  async prepareEnv(outDir: string, runtimeUrl?: string): Promise<DockerRuntimeOperationResult> {
    const project = await this.resolveProject(outDir, runtimeUrl);
    const startedAt = new Date().toISOString();
    const envPath = path.join(project.absoluteOutDir, ".env");
    const envExamplePath = path.join(project.absoluteOutDir, ".env.example");
    let created = false;

    try {
      await access(envPath);
    } catch {
      try {
        await copyFile(envExamplePath, envPath);
        created = true;
      } catch (error) {
        throw new WorkspaceError("Runtime final não possui .env.example para preparar o .env local.", 409, error);
      }
    }

    const logs = [created ? ".env criado a partir de .env.example." : ".env já existia; nada foi sobrescrito."];
    this.updateRecord(project.outDir, {
      lastOperation: "prepare_env",
      lastStatus: "success",
      lastExitCode: 0,
      updatedAt: new Date().toISOString(),
      logs,
      inspection: this.readRecord(project.outDir).inspection,
    });
    const message = created ? ".env local criado para o runtime final." : ".env local já estava preparado.";
    await this.appendHistory(project, {
      operation: "prepare_env",
      ok: true,
      status: "success",
      exitCode: 0,
      startedAt,
      message,
      logs,
    });
    return {
      ...(await this.statusFromProject(project)),
      operation: "prepare_env",
      ok: true,
      message,
    };
  }

  async configurePorts(
    outDir: string,
    ports: DockerRuntimePortUpdate,
    runtimeUrl?: string,
  ): Promise<DockerRuntimeOperationResult> {
    const project = await this.resolveProject(outDir, runtimeUrl);
    const startedAt = new Date().toISOString();
    const currentPorts = project.ports;
    const nextPorts = {
      api: normalizeOptionalPort(ports.api, "api") ?? currentPorts.api?.hostPort ?? 8080,
      postgres: normalizeOptionalPort(ports.postgres, "postgres") ?? currentPorts.postgres?.hostPort ?? 5433,
      redis: normalizeOptionalPort(ports.redis, "redis") ?? currentPorts.redis?.hostPort ?? 6380,
    };
    const compose = await readDockerCompose(project.absoluteOutDir);
    setComposeServicePort(compose, "api", nextPorts.api, currentPorts.api?.containerPort ?? 8080);
    setComposeServicePort(compose, "postgres", nextPorts.postgres, currentPorts.postgres?.containerPort ?? 5432);
    setComposeServicePort(compose, "redis", nextPorts.redis, currentPorts.redis?.containerPort ?? 6379);
    await writeDockerCompose(project.absoluteOutDir, compose);

    const updatedProject = await this.resolveProject(project.outDir, `http://127.0.0.1:${nextPorts.api}`);
    const logs = [
      `api ${nextPorts.api}:${updatedProject.ports.api?.containerPort ?? 8080}`,
      `postgres ${nextPorts.postgres}:${updatedProject.ports.postgres?.containerPort ?? 5432}`,
      `redis ${nextPorts.redis}:${updatedProject.ports.redis?.containerPort ?? 6379}`,
    ];
    const message = "Portas do docker-compose atualizadas.";
    this.updateRecord(updatedProject.outDir, {
      lastOperation: "configure_ports",
      lastStatus: "success",
      lastExitCode: 0,
      updatedAt: new Date().toISOString(),
      logs,
      inspection: this.readRecord(updatedProject.outDir).inspection,
    });
    await this.appendHistory(updatedProject, {
      operation: "configure_ports",
      ok: true,
      status: "success",
      exitCode: 0,
      startedAt,
      message,
      logs,
    });
    return {
      ...(await this.statusFromProject(updatedProject)),
      operation: "configure_ports",
      ok: true,
      message,
    };
  }

  async up(outDir: string, runtimeUrl?: string): Promise<DockerRuntimeOperationResult> {
    return this.runDockerCompose(outDir, "up", ["compose", "up", "-d", "--build"], runtimeUrl);
  }

  async down(outDir: string, runtimeUrl?: string): Promise<DockerRuntimeOperationResult> {
    return this.runDockerCompose(outDir, "down", ["compose", "down"], runtimeUrl);
  }

  async smoke(outDir: string, runtimeUrl?: string): Promise<DockerRuntimeOperationResult> {
    const project = await this.resolveProject(outDir, runtimeUrl);
    const startedAt = new Date().toISOString();
    this.updateRecord(project.outDir, {
      lastOperation: "smoke",
      lastStatus: "running",
      lastExitCode: null,
      updatedAt: new Date().toISOString(),
      logs: [`Smoke test iniciado em ${project.runtimeUrl}.`],
      inspection: this.readRecord(project.outDir).inspection,
    });

    try {
      const health = await runtimeJson(project.runtimeUrl, "/health");
      const metadata = await runtimeJson(project.runtimeUrl, "/metadata");
      const created = await runtimeJson(project.runtimeUrl, `/${project.resourceName}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": `builder-smoke-create-${Date.now()}`,
        },
        body: JSON.stringify({
          metadata: { source: "builder-api-smoke" },
          max_turns: 2,
        }),
      });
      const sessionId = extractSessionId(created);
      await runtimeJson(project.runtimeUrl, `/${project.resourceName}/${sessionId}/start`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": `builder-smoke-start-${Date.now()}`,
        },
        body: JSON.stringify({}),
      });
      await runtimeJson(project.runtimeUrl, `/${project.resourceName}/${sessionId}/turn`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": `builder-smoke-turn-${Date.now()}`,
        },
        body: JSON.stringify({ user_message: "Smoke test do container final." }),
      });
      const transcript = await runtimeJson(project.runtimeUrl, `/${project.resourceName}/${sessionId}/transcript`);
      const events = await runtimeJson(project.runtimeUrl, `/${project.resourceName}/${sessionId}/events`);
      const smoke: DockerRuntimeSmokeResult = {
        health,
        metadata,
        sessionId,
        transcriptCount: Array.isArray(transcript) ? transcript.length : 0,
        eventsCount: Array.isArray(events) ? events.length : 0,
      };
      const logs = [
        `Health: ${readStatusField(health) ?? "ok"}.`,
        `Sessao: ${sessionId}.`,
        `Transcript: ${smoke.transcriptCount} mensagem(ns).`,
        `Eventos: ${smoke.eventsCount} evento(s).`,
      ];
      this.updateRecord(project.outDir, {
        lastOperation: "smoke",
        lastStatus: "success",
        lastExitCode: 0,
        updatedAt: new Date().toISOString(),
        logs,
        inspection: this.readRecord(project.outDir).inspection,
      });
      const message = "Smoke test do container final executado com sucesso.";
      await this.appendHistory(project, {
        operation: "smoke",
        ok: true,
        status: "success",
        exitCode: 0,
        startedAt,
        message,
        logs,
        smoke,
      });
      return {
        ...(await this.statusFromProject(project)),
        operation: "smoke",
        ok: true,
        smoke,
        message,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateRecord(project.outDir, {
        lastOperation: "smoke",
        lastStatus: "error",
        lastExitCode: 1,
        updatedAt: new Date().toISOString(),
        logs: [`Smoke test falhou: ${message}`],
        inspection: this.readRecord(project.outDir).inspection,
      });
      await this.appendHistory(project, {
        operation: "smoke",
        ok: false,
        status: "error",
        exitCode: 1,
        startedAt,
        message,
        logs: [`Smoke test falhou: ${message}`],
      });
      return {
        ...(await this.statusFromProject(project)),
        operation: "smoke",
        ok: false,
        message,
      };
    }
  }

  async inspect(outDir: string, runtimeUrl?: string): Promise<DockerRuntimeOperationResult> {
    const project = await this.resolveProject(outDir, runtimeUrl);
    const startedAt = new Date().toISOString();
    this.updateRecord(project.outDir, {
      lastOperation: "inspect",
      lastStatus: "running",
      lastExitCode: null,
      updatedAt: new Date().toISOString(),
      logs: ["Inspecionando docker compose ps/logs."],
      inspection: this.readRecord(project.outDir).inspection,
    });

    const ps = await this.runner({
      command: "docker",
      args: ["compose", "ps", "--format", "json"],
      cwd: project.absoluteOutDir,
      timeoutMs: COMMAND_TIMEOUT_MS,
    }).catch(commandErrorToResult);
    const logs = await this.runner({
      command: "docker",
      args: ["compose", "logs", "--tail", "120", "--no-color"],
      cwd: project.absoluteOutDir,
      timeoutMs: COMMAND_TIMEOUT_MS,
    }).catch(commandErrorToResult);
    const ok = ps.exitCode === 0 && logs.exitCode === 0;
    const inspection: DockerRuntimeInspection = {
      containers: parseComposePs(ps.stdout),
      rawPs: ps.stdout,
      rawLogs: logs.stdout || logs.stderr,
    };
    this.updateRecord(project.outDir, {
      lastOperation: "inspect",
      lastStatus: ok ? "success" : "error",
      lastExitCode: ok ? 0 : ps.exitCode || logs.exitCode,
      updatedAt: new Date().toISOString(),
      logs: [
        ...(ps.stderr.trim() ? [`ps: ${ps.stderr.trim()}`] : []),
        ...(logs.stderr.trim() ? [`logs: ${logs.stderr.trim()}`] : []),
        ...(inspection.rawLogs.trim() ? [inspection.rawLogs.trim()] : []),
      ],
      inspection,
    });
    const message = ok ? "Status e logs Docker carregados." : dockerInspectionFailureMessage(ps, logs);
    const historyLogs = [
      ...(ps.stderr.trim() ? [`ps: ${ps.stderr.trim()}`] : []),
      ...(logs.stderr.trim() ? [`logs: ${logs.stderr.trim()}`] : []),
      ...(inspection.rawLogs.trim() ? [inspection.rawLogs.trim()] : []),
    ];
    await this.appendHistory(project, {
      operation: "inspect",
      ok,
      status: ok ? "success" : "error",
      exitCode: ok ? 0 : ps.exitCode || logs.exitCode,
      startedAt,
      message,
      command: "docker",
      args: ["compose", "ps", "--format", "json", "&&", "compose", "logs", "--tail", "120", "--no-color"],
      logs: historyLogs,
      inspection,
    });
    return {
      ...(await this.statusFromProject(project)),
      operation: "inspect",
      ok,
      command: "docker",
      args: ["compose", "ps", "--format", "json", "&&", "compose", "logs", "--tail", "120", "--no-color"],
      stdout: [ps.stdout, logs.stdout].filter(Boolean).join("\n"),
      stderr: [ps.stderr, logs.stderr].filter(Boolean).join("\n"),
      inspection,
      message,
    };
  }

  private async runDockerCompose(
    outDir: string,
    operation: Exclude<DockerRuntimeOperation, "prepare_env" | "configure_ports" | "smoke" | "inspect" | "cancel">,
    args: string[],
    runtimeUrl?: string,
  ): Promise<DockerRuntimeOperationResult> {
    const project = await this.resolveProject(outDir, runtimeUrl);
    if (this.activeOperations.has(project.outDir)) {
      throw new WorkspaceError("Já existe uma operação Docker em execução para este runtime.", 409);
    }
    const controller = new AbortController();
    const startedAt = new Date().toISOString();
    this.activeOperations.set(project.outDir, { operation, controller });
    this.updateRecord(project.outDir, {
      lastOperation: operation,
      lastStatus: "running",
      lastExitCode: null,
      updatedAt: new Date().toISOString(),
      logs: [`docker ${args.join(" ")}`],
      inspection: this.readRecord(project.outDir).inspection,
      progress: operation === "build" ? [] : undefined,
    });

    let liveBuildLogs: string[] = [];
    let liveBuildProgress: DockerBuildProgressEvent[] = [];
    const onBuildOutput = operation === "build"
      ? (chunk: string) => {
          liveBuildLogs = [...liveBuildLogs, chunk.trim()].filter(Boolean).slice(-40);
          liveBuildProgress = dedupeDockerBuildProgress([
            ...liveBuildProgress,
            ...parseDockerBuildProgress([chunk]),
          ]).slice(-DOCKER_BUILD_PROGRESS_CACHE_MAX);
          this.updateRecord(project.outDir, {
            lastOperation: operation,
            lastStatus: "running",
            lastExitCode: null,
            updatedAt: new Date().toISOString(),
            logs: liveBuildLogs,
            inspection: this.readRecord(project.outDir).inspection,
            progress: liveBuildProgress,
          });
        }
      : undefined;

    let result: DockerCommandResult;
    try {
      result = await this.runner({
        command: "docker",
        args,
        cwd: project.absoluteOutDir,
        timeoutMs: COMMAND_TIMEOUT_MS,
        onOutput: onBuildOutput,
        signal: controller.signal,
      });
    } catch (error) {
      result = commandErrorToResult(error);
    } finally {
      const active = this.activeOperations.get(project.outDir);
      if (active?.controller === controller) {
        this.activeOperations.delete(project.outDir);
      }
    }

    const logs = commandLogs(result);
    const ok = result.exitCode === 0;
    const canceled = result.aborted === true;
    const now = new Date().toISOString();
    const progress = operation === "build"
      ? withBuildProgressTail(dedupeDockerBuildProgress(parseDockerBuildProgress(logs)), ok, now, canceled)
      : [];
    this.updateRecord(project.outDir, {
      lastOperation: operation,
      lastStatus: canceled ? "canceled" : ok ? "success" : "error",
      lastExitCode: result.exitCode,
      updatedAt: new Date().toISOString(),
      logs,
      inspection: this.readRecord(project.outDir).inspection,
      progress,
    });
    const message = canceled ? dockerCanceledMessage(operation) : ok ? dockerSuccessMessage(operation) : dockerFailureMessage(operation, result);
    await this.appendHistory(project, {
      operation,
      ok,
      status: canceled ? "canceled" : ok ? "success" : "error",
      exitCode: result.exitCode,
      startedAt,
      message,
      command: "docker",
      args,
      logs,
      progress,
    });
    return {
      ...(await this.statusFromProject(project)),
      operation,
      ok,
      command: "docker",
      args,
      stdout: result.stdout,
      stderr: result.stderr,
      message,
    };
  }

  private async resolveProject(outDir: string, runtimeUrl?: string): Promise<DockerRuntimeProject> {
    const requestedOutDir = outDir.trim();
    if (!requestedOutDir) {
      throw new WorkspaceError("outDir do runtime Docker é obrigatório.", 400);
    }
    const absoluteOutDir = safeResolve(this.workspaceRoot, requestedOutDir);
    const relativeOutDir = toWorkspaceRelative(this.workspaceRoot, absoluteOutDir);
    if (relativeOutDir !== "generated" && !relativeOutDir.startsWith("generated/")) {
      throw new WorkspaceError("Runtime Docker final só pode ser executado a partir de generated/.", 400);
    }
    const outDirStat = await stat(absoluteOutDir).catch((error) => {
      throw new WorkspaceError(`Diretório de runtime não encontrado: ${relativeOutDir}`, 404, error);
    });
    if (!outDirStat.isDirectory()) {
      throw new WorkspaceError(`outDir do runtime Docker não é diretório: ${relativeOutDir}`, 400);
    }
    const metadata = await readGeneratedMetadata(absoluteOutDir);
    if (metadata.target !== "fastapi-runtime") {
      throw new WorkspaceError("O artefato informado não é um runtime FastAPI/Docker final.", 409, metadata);
    }
    await requireRuntimeFile(absoluteOutDir, "Dockerfile");
    await requireRuntimeFile(absoluteOutDir, "docker-compose.yml");
    const flow = await readEmbeddedFlow(absoluteOutDir);
    const resourceName = readResourceName(flow);
    const ports = await readComposePorts(absoluteOutDir);
    const normalizedRuntimeUrl = normalizeRuntimeUrl(runtimeUrl, ports.api?.hostPort ?? 8080);
    return {
      outDir: relativeOutDir,
      absoluteOutDir,
      flowId: metadata.flowId ?? null,
      flowVersion: metadata.flowVersion ?? null,
      flowHash: metadata.flowHash ?? null,
      target: "fastapi-runtime",
      resourceName,
      runtimeUrl: normalizedRuntimeUrl,
      docsUrl: `${normalizedRuntimeUrl}/docs`,
      openapiUrl: `${normalizedRuntimeUrl}/openapi.json`,
      ports,
    };
  }

  private async statusFromProject(project: DockerRuntimeProject): Promise<DockerRuntimeStatus> {
    const record = this.readRecord(project.outDir);
    return {
      outDir: project.outDir,
      ready: true,
      target: project.target,
      flowId: project.flowId,
      flowVersion: project.flowVersion,
      flowHash: project.flowHash,
      resourceName: project.resourceName,
      runtimeUrl: project.runtimeUrl,
      docsUrl: project.docsUrl,
      openapiUrl: project.openapiUrl,
      ports: project.ports,
      composeFile: await fileExists(project.absoluteOutDir, "docker-compose.yml"),
      dockerfile: await fileExists(project.absoluteOutDir, "Dockerfile"),
      envFile: await fileExists(project.absoluteOutDir, ".env"),
      ...record,
    };
  }

  private readRecord(outDir: string): RuntimeRecord {
    return (
      this.records.get(outDir) ?? {
        lastOperation: null,
        lastStatus: "idle",
        lastExitCode: null,
        updatedAt: null,
        logs: [],
        inspection: null,
        progress: undefined,
      }
    );
  }

  private updateRecord(outDir: string, record: RuntimeRecord): void {
    this.records.set(outDir, record);
  }

  private async appendHistory(
    project: DockerRuntimeProject,
    entry: Omit<DockerRuntimeHistoryEntry, "id" | "outDir" | "runtimeUrl" | "finishedAt">,
  ): Promise<void> {
    const finishedAt = new Date().toISOString();
    const historyEntry: DockerRuntimeHistoryEntry = {
      id: `${Date.now()}-${entry.operation}-${Math.random().toString(16).slice(2, 8)}`,
      outDir: project.outDir,
      runtimeUrl: project.runtimeUrl,
      finishedAt,
      ...entry,
    };
    const filePath = this.historyFilePath(project.outDir);
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, `${JSON.stringify(historyEntry)}\n`, "utf-8");
  }

  private async readHistoryEntries(outDir: string, query: DockerRuntimeHistoryFilterQuery): Promise<DockerRuntimeHistoryEntry[]> {
    const normalizedLimit = Number.isInteger(query.limit)
      ? Math.max(1, Math.min(query.limit, 100))
      : 20;
    const statusFilter = query.status;
    const operationFilter = query.operation;
    const okFilter = query.ok;
    const searchFilter = query.search?.toLowerCase();
    const fromMs = query.fromMs;
    const toMs = query.toMs;
    let raw = "";
    try {
      raw = await readFile(this.historyFilePath(outDir), "utf-8");
    } catch {
      return [];
    }
    const entries = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((entry): entry is DockerRuntimeHistoryEntry => {
        if (!isHistoryEntry(entry)) {
          return false;
        }
        if (operationFilter && entry.operation !== operationFilter) {
          return false;
        }
        if (statusFilter && entry.status !== statusFilter) {
          return false;
        }
        if (okFilter !== undefined && entry.ok !== okFilter) {
          return false;
        }
        if (searchFilter) {
          const haystack = [entry.operation, entry.status, entry.message, ...entry.logs, entry.runtimeUrl]
            .filter((item): item is string => Boolean(item))
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(searchFilter)) {
            return false;
          }
        }
        const finishedAtMs = Date.parse(entry.finishedAt);
        if (Number.isNaN(finishedAtMs)) {
          return false;
        }
        if (fromMs !== undefined && finishedAtMs < fromMs) {
          return false;
        }
        if (toMs !== undefined && finishedAtMs > toMs) {
          return false;
        }
        return true;
      });
    return entries.slice(-normalizedLimit).reverse();
  }

  private historyFilePath(outDir: string): string {
    return path.join(this.workspaceRoot, ".agent-flow", "docker-runtime-history", `${historyKey(outDir)}.jsonl`);
  }
}

async function defaultDockerCommandRunner(invocation: DockerCommandInvocation): Promise<DockerCommandResult> {
  if (invocation.onOutput) {
    return runStreamingCommand(invocation);
  }
  try {
    const result = await execFileAsync(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      timeout: invocation.timeoutMs,
      windowsHide: true,
      maxBuffer: MAX_COMMAND_BUFFER,
      signal: invocation.signal,
    });
    return {
      exitCode: 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch (error) {
    return commandErrorToResult(error);
  }
}

function runStreamingCommand(invocation: DockerCommandInvocation): Promise<DockerCommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      windowsHide: true,
    });

    const finish = (result: DockerCommandResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      invocation.signal?.removeEventListener("abort", abortHandler);
      resolve(result);
    };

    const append = (target: "stdout" | "stderr", chunk: Buffer) => {
      const text = chunk.toString();
      if (target === "stdout") {
        stdout = appendLimited(stdout, text);
      } else {
        stderr = appendLimited(stderr, text);
      }
      invocation.onOutput?.(text);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish({
        exitCode: 1,
        stdout,
        stderr: stderr || `Comando excedeu timeout de ${invocation.timeoutMs}ms.`,
      });
    }, invocation.timeoutMs);

    const abortHandler = () => {
      child.kill();
      finish({
        exitCode: 130,
        stdout,
        stderr: stderr || "Comando cancelado pelo usuário.",
        aborted: true,
      });
    };
    if (invocation.signal?.aborted) {
      abortHandler();
      return;
    }
    invocation.signal?.addEventListener("abort", abortHandler, { once: true });

    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.on("error", (error) => {
      finish({
        exitCode: 1,
        stdout,
        stderr: stderr || error.message,
      });
    });
    child.on("close", (code) => {
      finish({
        exitCode: typeof code === "number" ? code : 1,
        stdout,
        stderr,
      });
    });
  });
}

function appendLimited(current: string, chunk: string): string {
  const next = `${current}${chunk}`;
  if (next.length <= MAX_COMMAND_BUFFER) {
    return next;
  }
  return next.slice(-MAX_COMMAND_BUFFER);
}

function commandErrorToResult(error: unknown): DockerCommandResult {
  if (error instanceof Error && error.name === "AbortError") {
    return {
      exitCode: 130,
      stdout: "",
      stderr: "Comando cancelado pelo usuário.",
      aborted: true,
    };
  }
  if (isExecError(error)) {
    return {
      exitCode: typeof error.code === "number" ? error.code : 1,
      stdout: typeof error.stdout === "string" ? error.stdout : "",
      stderr: typeof error.stderr === "string" ? error.stderr : error.message,
    };
  }
  return {
    exitCode: 1,
    stdout: "",
    stderr: error instanceof Error ? error.message : String(error),
  };
}

function isExecError(error: unknown): error is Error & { code?: unknown; stdout?: unknown; stderr?: unknown } {
  return error instanceof Error;
}

async function readGeneratedMetadata(absoluteOutDir: string): Promise<GeneratedMetadata> {
  const metadataPath = path.join(absoluteOutDir, ".agent-flow", "generated-meta.json");
  try {
    const parsed = JSON.parse(await readFile(metadataPath, "utf-8"));
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    throw new WorkspaceError("Metadado do runtime final não encontrado ou inválido.", 409, error);
  }
}

async function readEmbeddedFlow(absoluteOutDir: string): Promise<Record<string, unknown>> {
  const flowPath = path.join(absoluteOutDir, ".agent-flow", "agent.flow.json");
  try {
    const parsed = JSON.parse(await readFile(flowPath, "utf-8"));
    if (!isRecord(parsed)) {
      throw new Error("agent.flow.json não é objeto.");
    }
    return parsed;
  } catch (error) {
    throw new WorkspaceError("Flow embutido do runtime final não encontrado ou inválido.", 409, error);
  }
}

function readResourceName(flow: Record<string, unknown>): string {
  const api = flow.api;
  if (isRecord(api) && typeof api.resourceName === "string" && api.resourceName.trim()) {
    return api.resourceName.trim();
  }
  return "sessions";
}

async function requireRuntimeFile(absoluteOutDir: string, fileName: string): Promise<void> {
  try {
    await access(path.join(absoluteOutDir, fileName));
  } catch (error) {
    throw new WorkspaceError(`Runtime final incompleto: ${fileName} não encontrado.`, 409, error);
  }
}

async function fileExists(absoluteOutDir: string, fileName: string): Promise<boolean> {
  try {
    await access(path.join(absoluteOutDir, fileName));
    return true;
  } catch {
    return false;
  }
}

async function runtimeJson(runtimeUrl: string, route: string, init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`${runtimeUrl.replace(/\/$/, "")}${route}`, {
      ...init,
      signal: controller.signal,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} em ${route}: ${text || response.statusText}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function extractSessionId(payload: unknown): string {
  if (isRecord(payload) && isRecord(payload.session) && typeof payload.session.session_id === "string") {
    return payload.session.session_id;
  }
  throw new Error("Resposta de criação de sessão não retornou session.session_id.");
}

function readStatusField(payload: unknown): string | null {
  if (isRecord(payload) && typeof payload.status === "string") {
    return payload.status;
  }
  return null;
}

function commandLogs(result: DockerCommandResult): string[] {
  return [result.stdout.trim(), result.stderr.trim()].filter(Boolean);
}

function dedupeDockerBuildProgress(progress: DockerBuildProgressEvent[]): DockerBuildProgressEvent[] {
  const seen = new Set<string>();
  const deduped: DockerBuildProgressEvent[] = [];
  for (const item of progress) {
    const key = `${item.stage}|${item.status}|${item.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function parseDockerBuildProgress(lines: string[]): DockerBuildProgressEvent[] {
  return lines
    .flatMap((rawLine) => {
      const text = stripAnsi(rawLine);
      if (!text.trim()) {
        return [];
      }
      return text
        .split(/\r?\n/)
        .flatMap((line) => parseDockerBuildLine(line))
        .filter((item): item is DockerBuildProgressEvent => item !== null);
    })
    .filter((item): item is DockerBuildProgressEvent => item !== null)
    .slice(-DOCKER_BUILD_PROGRESS_CACHE_MAX);
}

function withBuildProgressTail(
  progress: DockerBuildProgressEvent[],
  ok: boolean,
  timestamp: string,
  canceled = false,
): DockerBuildProgressEvent[] {
  if (canceled) {
    const canceledEvent: DockerBuildProgressEvent = {
      stage: "cancel",
      status: "canceled",
      message: "Build cancelado pelo usuário.",
      line: "Build cancelado pelo usuário.",
      timestamp,
    };
    return [
      ...progress,
      canceledEvent,
    ].slice(-DOCKER_BUILD_PROGRESS_CACHE_MAX);
  }
  if (!progress.length) {
    return [
      {
        stage: "build",
        status: ok ? "done" : "error",
        message: ok ? "Build finalizado." : "Build falhou.",
        line: ok ? "Build finalizado." : "Build falhou.",
        timestamp,
      },
    ];
  }
  if (ok) {
    const maybeLast = progress.at(-1);
    if (maybeLast && maybeLast.status !== "error") {
      return [
        ...progress,
        {
          stage: maybeLast.stage,
          status: "done",
          message: "Build finalizado.",
          line: "Build finalizado.",
          timestamp,
        },
      ];
    }
  }
  return progress;
}

function parseDockerBuildLine(rawLine: string): DockerBuildProgressEvent[] {
  const line = stripAnsi(rawLine).trim();
  if (!line) {
    return [];
  }
  const lower = line.toLowerCase();
  const percent = parsePercentFromLine(line);
  const status: DockerBuildProgressStatus = lower.includes("error") || lower.includes("failed")
    ? "error"
    : lower.includes("cached")
      ? "done"
      : lower.includes("warn") || lower.includes("warning")
        ? "warning"
        : "running";
  return [
    {
      stage: inferDockerBuildStage(line),
      status,
      message: line,
      line,
      percent,
      timestamp: new Date().toISOString(),
    },
  ];
}

function parsePercentFromLine(line: string): number | undefined {
  const match = /\[(\d+)\/(\d+)\]/.exec(line);
  if (!match) {
    return undefined;
  }
  const value = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(value) || !Number.isFinite(total) || total === 0) {
    return undefined;
  }
  return Math.round((value / total) * 100);
}

function inferDockerBuildStage(line: string): string {
  const lower = line.toLowerCase();
  if (lower.includes("load metadata")) {
    return "metadata";
  }
  if (lower.includes("resolve")) {
    return "resolução";
  }
  if (lower.includes("copy") || lower.includes("adding")) {
    return "copy";
  }
  if (lower.includes("download") || lower.includes("transferring")) {
    return "download";
  }
  if (lower.includes("export") || lower.includes("writing image") || lower.includes("writing manifest")) {
    return "export";
  }
  if (lower.includes("run")) {
    return "run";
  }
  return "build";
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function dockerSuccessMessage(
  operation: Exclude<DockerRuntimeOperation, "prepare_env" | "configure_ports" | "smoke" | "inspect" | "cancel">,
): string {
  if (operation === "build") {
    return "Build Docker final concluido.";
  }
  if (operation === "up") {
    return "Container Docker final iniciado.";
  }
  return "Container Docker final parado.";
}

function dockerFailureMessage(
  operation: Exclude<DockerRuntimeOperation, "prepare_env" | "configure_ports" | "smoke" | "inspect" | "cancel">,
  result: DockerCommandResult,
): string {
  const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
  if (operation === "build") {
    return `Build Docker final falhou: ${detail}`;
  }
  if (operation === "up") {
    return `Inicialização do container final falhou: ${detail}`;
  }
  return `Parada do container final falhou: ${detail}`;
}

function dockerCanceledMessage(
  operation: Exclude<DockerRuntimeOperation, "prepare_env" | "configure_ports" | "smoke" | "inspect" | "cancel">,
): string {
  if (operation === "build") {
    return "Build Docker final cancelado pelo usuário.";
  }
  if (operation === "up") {
    return "Inicialização do container final cancelada pelo usuário.";
  }
  return "Parada do container final cancelada pelo usuário.";
}

function dockerInspectionFailureMessage(ps: DockerCommandResult, logs: DockerCommandResult): string {
  const detail =
    ps.stderr.trim() ||
    logs.stderr.trim() ||
    ps.stdout.trim() ||
    logs.stdout.trim() ||
    `ps=${ps.exitCode}, logs=${logs.exitCode}`;
  return `Inspeção Docker falhou: ${detail}`;
}

function normalizeRuntimeUrl(runtimeUrl?: string, apiHostPort = 8080): string {
  const raw = runtimeUrl?.trim() || `http://127.0.0.1:${apiHostPort || 8080}`;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new WorkspaceError(`URL do runtime inválida: ${raw}`, 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WorkspaceError("URL do runtime deve usar http ou https.", 400);
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname)) {
    throw new WorkspaceError("Por segurança, o smoke test do Builder só aceita runtimes locais.", 400);
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

async function readDockerCompose(absoluteOutDir: string): Promise<Record<string, unknown>> {
  const composePath = path.join(absoluteOutDir, "docker-compose.yml");
  try {
    const parsed = parse(await readFile(composePath, "utf-8"));
    if (isRecord(parsed)) {
      return parsed;
    }
  } catch (error) {
    throw new WorkspaceError("docker-compose.yml do runtime final não é YAML válido.", 422, error);
  }
  throw new WorkspaceError("docker-compose.yml do runtime final não contém objeto YAML.", 422);
}

async function writeDockerCompose(absoluteOutDir: string, compose: Record<string, unknown>): Promise<void> {
  await writeFile(path.join(absoluteOutDir, "docker-compose.yml"), stringify(compose), "utf-8");
}

async function readComposePorts(absoluteOutDir: string): Promise<DockerRuntimePorts> {
  const compose = await readDockerCompose(absoluteOutDir);
  return {
    api: readComposeServicePort(compose, "api", 8080),
    postgres: readComposeServicePort(compose, "postgres", 5432),
    redis: readComposeServicePort(compose, "redis", 6379),
  };
}

function readComposeServicePort(
  compose: Record<string, unknown>,
  service: "api" | "postgres" | "redis",
  fallbackContainerPort: number,
): DockerRuntimePortBinding | null {
  const serviceRecord = getComposeService(compose, service);
  if (!serviceRecord) {
    return null;
  }
  const ports = serviceRecord.ports;
  if (!Array.isArray(ports) || !ports.length) {
    return null;
  }
  const value = String(ports[0]);
  const match = /^(\d+):(\d+)$/.exec(value.trim());
  if (match) {
    return {
      service,
      hostPort: Number(match[1]),
      containerPort: Number(match[2]),
      value,
    };
  }
  const port = Number(value);
  if (Number.isInteger(port)) {
    return {
      service,
      hostPort: port,
      containerPort: fallbackContainerPort,
      value,
    };
  }
  return null;
}

function setComposeServicePort(
  compose: Record<string, unknown>,
  service: "api" | "postgres" | "redis",
  hostPort: number,
  containerPort: number,
): void {
  const serviceRecord = getComposeService(compose, service);
  if (!serviceRecord) {
    throw new WorkspaceError(`Serviço ${service} não encontrado em docker-compose.yml.`, 422);
  }
  serviceRecord.ports = [`${hostPort}:${containerPort}`];
}

function getComposeService(compose: Record<string, unknown>, service: string): Record<string, unknown> | null {
  const services = compose.services;
  if (!isRecord(services)) {
    throw new WorkspaceError("docker-compose.yml não possui services.", 422);
  }
  const serviceRecord = services[service];
  if (!isRecord(serviceRecord)) {
    return null;
  }
  return serviceRecord;
}

function normalizeOptionalPort(value: number | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new WorkspaceError(`Porta ${label} deve ser inteiro entre 1 e 65535.`, 400);
  }
  return value;
}

function parseComposePs(raw: string): DockerComposeService[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.filter(isRecord).map(composeServiceFromRecord);
    }
    if (isRecord(parsed)) {
      return [composeServiceFromRecord(parsed)];
    }
  } catch {
    // Docker Compose can emit one JSON object per line.
  }
  return trimmed
    .split(/\r?\n/)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(isRecord)
    .map(composeServiceFromRecord);
}

function composeServiceFromRecord(raw: Record<string, unknown>): DockerComposeService {
  return {
    name: pickString(raw, "Name", "name"),
    service: pickString(raw, "Service", "service"),
    state: pickString(raw, "State", "state"),
    status: pickString(raw, "Status", "status"),
    ports: pickPorts(raw),
    raw,
  };
}

function pickString(raw: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

function pickPorts(raw: Record<string, unknown>): string | null {
  const direct = pickString(raw, "Ports", "ports", "Publishers", "publishers");
  if (direct) {
    return direct;
  }
  const publishers = raw.Publishers ?? raw.publishers;
  if (Array.isArray(publishers)) {
    const values = publishers
      .filter(isRecord)
      .map((item) => {
        const published = item.PublishedPort ?? item.published_port ?? item.Published ?? item.published;
        const target = item.TargetPort ?? item.target_port ?? item.Target ?? item.target;
        return published && target ? `${String(published)}:${String(target)}` : "";
      })
      .filter(Boolean);
    return values.length ? values.join(", ") : null;
  }
  return null;
}

function historyKey(outDir: string): string {
  return outDir.replace(/[^A-Za-z0-9._-]+/g, "__").replace(/^_+|_+$/g, "") || "runtime";
}

function isHistoryEntry(value: unknown): value is DockerRuntimeHistoryEntry {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.outDir === "string" &&
    typeof value.operation === "string" &&
    typeof value.ok === "boolean" &&
    typeof value.status === "string" &&
    typeof value.runtimeUrl === "string" &&
    typeof value.startedAt === "string" &&
    typeof value.finishedAt === "string" &&
    typeof value.message === "string" &&
    Array.isArray(value.logs) &&
    (value.progress === undefined || (Array.isArray(value.progress) && value.progress.every(isDockerBuildProgress)))
  );
}

interface DockerRuntimeHistoryFilterQuery {
  limit: number;
  operation?: DockerRuntimeOperation;
  status?: DockerRuntimeOperationStatus;
  ok?: boolean;
  search?: string;
  fromMs?: number;
  toMs?: number;
}

function normalizeDockerRuntimeHistoryQuery(
  query: number | DockerRuntimeHistoryQuery,
): DockerRuntimeHistoryFilterQuery {
  const normalizedLimit = typeof query === "number" ? query : query.limit;
  const source = typeof query === "number" ? {} : query;
  const fromMs = source.from ? Date.parse(source.from) : undefined;
  const toMs = source.to ? Date.parse(source.to) : undefined;
  return {
    limit: Number.isInteger(normalizedLimit) ? Math.max(1, Math.min(Number(normalizedLimit), 100)) : 20,
    operation: source.operation,
    status: source.status,
    ok: source.ok,
    search: source.search?.trim() || undefined,
    fromMs: Number.isFinite(fromMs) ? fromMs : undefined,
    toMs: Number.isFinite(toMs) ? toMs : undefined,
  };
}

function isDockerBuildProgress(value: unknown): value is DockerBuildProgressEvent {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.stage === "string" &&
    typeof value.status === "string" &&
    typeof value.message === "string" &&
    typeof value.line === "string" &&
    typeof value.timestamp === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
