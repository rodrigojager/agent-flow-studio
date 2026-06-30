import { pathToFileURL } from "node:url";
import fastify, { type FastifyInstance } from "fastify";
import { agentFlowJsonSchema, llmAdapterCatalog, runtimeManifestJsonSchema } from "@agent-flow-builder/flow-spec";
import {
  DockerRuntimeManager,
  type DockerCommandRunner,
  type DockerBuildProgressStatus,
  type DockerRuntimeHistoryLevel,
  type DockerRuntimeOperation,
  type DockerRuntimeOperationStatus,
} from "./docker-runtime.ts";
import { SandboxManager } from "./sandbox.ts";
import { compareStudioRuns, exportStudioRun, listStudioRuns, loadStudioRun, saveStudioRun } from "./studio-runs.ts";
import {
  archiveGeneratedArtifact,
  approveLangGraphSandbox,
  createFlowWorkspace,
  createPrompt,
  createSchemaAsset,
  deletePrompt,
  deleteSchemaAsset,
  exportFlowWorkspace,
  generateApprovedRuntime,
  generateLangGraphSandboxArtifact,
  importFlowWorkspace,
  listLocalCatalog,
  generateRuntimeManifest,
  generateRuntime,
  listGeneratedArtifact,
  readLangGraphSandboxApprovalStatus,
  listFlows,
  loadFlowById,
  loadRuntimeManifest,
  normalizeWorkspaceRoot,
  readGeneratedArtifactFile,
  readPrompt,
  readSchemaAsset,
  saveLocalCatalogItem,
  saveFlow,
  savePrompt,
  saveRuntimeManifest,
  saveSchemaAsset,
  validateRuntimeManifest,
  applyCatalogItemToFlow,
  validateFlow,
  WorkspaceError,
} from "./workspace.ts";

export interface BuildAppOptions {
  workspaceRoot?: string;
  logger?: boolean;
  dockerRunner?: DockerCommandRunner;
}

interface FlowParams {
  flowId: string;
}

interface StudioRunParams extends FlowParams {
  runId: string;
}

interface PromptParams extends FlowParams {
  promptId: string;
}

interface SchemaParams extends FlowParams {
  schemaId: string;
}

interface GenerateBody {
  outDir?: string;
}

interface CreateFlowBody {
  id?: string;
  name?: string;
  resourceName?: string;
}

interface ImportFlowWorkspaceBody {
  workspace?: unknown;
  overwrite?: boolean;
}

interface AssetBody {
  content?: unknown;
}

interface ApplyCatalogItemBody {
  itemId?: string;
  kind?: string;
  targetNodeId?: string;
  id?: string;
}

interface SandboxBody {
  runtimeDir?: string;
  port?: number;
}

interface DockerRuntimeBody {
  outDir?: string;
  runtimeUrl?: string;
  agentId?: string;
  ports?: {
    api?: number;
    postgres?: number;
    redis?: number;
  };
}

interface DockerRuntimeHistoryQuery {
  limit?: string;
  operation?: string;
  status?: string;
  ok?: string;
  search?: string;
  level?: string;
  progressStage?: string;
  progressStatus?: string;
  from?: string;
  to?: string;
}

interface ArtifactQuery {
  outDir?: string;
  path?: string;
  runtimeUrl?: string;
}

interface DockerHistoryQuery extends ArtifactQuery {
  limit?: string;
  operation?: string;
  status?: string;
  ok?: string;
  search?: string;
  level?: string;
  progressStage?: string;
  progressStatus?: string;
  from?: string;
  to?: string;
}

interface StudioRunQuery {
  q?: string;
  agentId?: string;
  status?: string;
  phase?: string;
  hasErrors?: string;
  isComplete?: string;
  node?: string;
  minDurationMs?: string;
  maxDurationMs?: string;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const workspaceRoot = normalizeWorkspaceRoot(
    options.workspaceRoot ?? process.env.AGENT_BUILDER_WORKSPACE ?? process.cwd(),
  );
  const app = fastify({ logger: options.logger ?? false });
  const sandboxManager = new SandboxManager(workspaceRoot);
  const dockerRunner = options.dockerRunner ?? createEnvironmentDockerRunner();
  const dockerRuntimeManager = new DockerRuntimeManager(workspaceRoot, {
    runner: dockerRunner,
  });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Headers", "content-type");
    reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    reply.header("Access-Control-Expose-Headers", "content-disposition");
    if (request.method === "OPTIONS") {
      return reply.status(204).send();
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof WorkspaceError) {
      return reply.status(error.statusCode).send({
        error: "workspace_error",
        message: error.message,
        details: serializeErrorDetails(error.details),
      });
    }
    request.log.error(error);
    return reply.status(500).send({
      error: "internal_error",
      message: "Erro interno na Builder API.",
    });
  });

  app.get("/health", async () => ({
    status: "ok",
    workspaceRoot,
  }));

  app.get("/flow-schema", async () => agentFlowJsonSchema());

  app.get("/llm-adapters", async () => ({
    adapters: llmAdapterCatalog(),
  }));

  app.get("/runtime-manifest-schema", async () => runtimeManifestJsonSchema());

  app.get("/catalog", async () => listLocalCatalog(workspaceRoot));

  app.post<{ Body: unknown }>("/catalog/items", async (request) => saveLocalCatalogItem(workspaceRoot, request.body));

  app.get("/runtime-manifest", async () => {
    const loaded = await loadRuntimeManifest(workspaceRoot);
    return {
      path: loaded.relativePath,
      manifest: loaded.manifest,
    };
  });

  app.put<{ Body: unknown }>("/runtime-manifest", async (request) => {
    const saved = await saveRuntimeManifest(workspaceRoot, request.body);
    return {
      path: saved.relativePath,
      manifest: saved.manifest,
    };
  });

  app.post("/runtime-manifest/validate", async () => validateRuntimeManifest(workspaceRoot));

  app.post<{ Body: GenerateBody }>("/runtime-manifest/generate", async (request) => {
    const body = request.body ?? {};
    if (body.outDir !== undefined && typeof body.outDir !== "string") {
      throw new WorkspaceError("outDir deve ser string quando informado.", 400);
    }
    const result = await generateRuntimeManifest(workspaceRoot, body.outDir);
    return {
      status: "ok",
      manifestId: result.manifestId,
      manifestPath: result.manifestPath,
      outDir: result.outDir,
      agents: result.agents,
    };
  });

  app.get("/flows", async () => ({
    flows: await listFlows(workspaceRoot),
  }));

  app.post<{ Body: CreateFlowBody }>("/flows", async (request) => {
    const result = await createFlowWorkspace(workspaceRoot, request.body);
    return {
      status: "ok",
      path: result.flowPath,
      flow: result.flow,
      prompts: result.prompts,
      schemas: result.schemas,
    };
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId", async (request) => {
    const loaded = await loadFlowById(workspaceRoot, request.params.flowId);
    return {
      path: loaded.relativePath,
      flow: loaded.flow,
    };
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/export", async (request) => {
    return exportFlowWorkspace(workspaceRoot, request.params.flowId);
  });

  app.post<{ Body: ImportFlowWorkspaceBody }>("/flows/import", async (request) => {
    const body = request.body ?? {};
    const payload =
      body && typeof body === "object" && "workspace" in body ? (body as ImportFlowWorkspaceBody).workspace : body;
    if (body && typeof body === "object" && "overwrite" in body && typeof body.overwrite !== "boolean") {
      throw new WorkspaceError("overwrite deve ser boolean quando informado.", 400);
    }
    const result = await importFlowWorkspace(workspaceRoot, payload, { overwrite: body.overwrite });
    return {
      status: "ok",
      path: result.flowPath,
      flow: result.flow,
      prompts: result.prompts,
      schemas: result.schemas,
    };
  });

  app.put<{ Params: FlowParams; Body: unknown }>("/flows/:flowId", async (request) => {
    const result = await saveFlow(workspaceRoot, request.params.flowId, request.body);
    return {
      status: "ok",
      path: result.flowPath,
      flow: result.flow,
    };
  });

  app.get<{ Params: PromptParams }>("/flows/:flowId/prompts/:promptId", async (request) => {
    return readPrompt(workspaceRoot, request.params.flowId, request.params.promptId);
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/prompts", async (request) => {
    const result = await createPrompt(workspaceRoot, request.params.flowId, request.body);
    return {
      status: "ok",
      path: result.flowPath,
      flow: result.flow,
      prompt: result.asset,
    };
  });

  app.put<{ Params: PromptParams; Body: AssetBody }>("/flows/:flowId/prompts/:promptId", async (request) => {
    return savePrompt(workspaceRoot, request.params.flowId, request.params.promptId, request.body?.content);
  });

  app.delete<{ Params: PromptParams }>("/flows/:flowId/prompts/:promptId", async (request) => {
    const result = await deletePrompt(workspaceRoot, request.params.flowId, request.params.promptId);
    return {
      status: "ok",
      path: result.flowPath,
      flow: result.flow,
      deleted: result.deleted,
    };
  });

  app.get<{ Params: SchemaParams }>("/flows/:flowId/schemas/:schemaId", async (request) => {
    return readSchemaAsset(workspaceRoot, request.params.flowId, request.params.schemaId);
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/schemas", async (request) => {
    const result = await createSchemaAsset(workspaceRoot, request.params.flowId, request.body);
    return {
      status: "ok",
      path: result.flowPath,
      flow: result.flow,
      schema: result.asset,
    };
  });

  app.put<{ Params: SchemaParams; Body: AssetBody }>("/flows/:flowId/schemas/:schemaId", async (request) => {
    return saveSchemaAsset(workspaceRoot, request.params.flowId, request.params.schemaId, request.body?.content);
  });

  app.delete<{ Params: SchemaParams }>("/flows/:flowId/schemas/:schemaId", async (request) => {
    const result = await deleteSchemaAsset(workspaceRoot, request.params.flowId, request.params.schemaId);
    return {
      status: "ok",
      path: result.flowPath,
      flow: result.flow,
      deleted: result.deleted,
    };
  });

  app.post<{ Params: FlowParams; Body: ApplyCatalogItemBody }>("/flows/:flowId/catalog/apply", async (request) => {
    return applyCatalogItemToFlow(workspaceRoot, request.params.flowId, request.body);
  });

  app.post<{ Params: FlowParams }>("/flows/:flowId/validate", async (request) => {
    return validateFlow(workspaceRoot, request.params.flowId);
  });

  app.post<{ Params: FlowParams; Body: GenerateBody }>("/flows/:flowId/generate", async (request) => {
    const body = request.body ?? {};
    if (body.outDir !== undefined && typeof body.outDir !== "string") {
      throw new WorkspaceError("outDir deve ser string quando informado.", 400);
    }
    const result = await generateRuntime(workspaceRoot, request.params.flowId, body.outDir);
    return {
      status: "ok",
      flowId: result.flowId,
      flowPath: result.flowPath,
      outDir: result.outDir,
    };
  });

  app.post<{ Params: FlowParams; Body: GenerateBody }>("/flows/:flowId/generate-langgraph-sandbox", async (request) => {
    const body = request.body ?? {};
    if (body.outDir !== undefined && typeof body.outDir !== "string") {
      throw new WorkspaceError("outDir deve ser string quando informado.", 400);
    }
    const result = await generateLangGraphSandboxArtifact(workspaceRoot, request.params.flowId, body.outDir);
    return {
      status: "ok",
      flowId: result.flowId,
      flowPath: result.flowPath,
      outDir: result.outDir,
    };
  });

  app.post<{ Params: FlowParams; Body: GenerateBody }>("/flows/:flowId/approve-langgraph-sandbox", async (request) => {
    const body = request.body ?? {};
    if (body.outDir !== undefined && typeof body.outDir !== "string") {
      throw new WorkspaceError("outDir deve ser string quando informado.", 400);
    }
    const approval = await approveLangGraphSandbox(workspaceRoot, request.params.flowId, body.outDir);
    return { status: "ok", approval };
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/langgraph-sandbox-approval-status", async (request) => {
    return readLangGraphSandboxApprovalStatus(workspaceRoot, request.params.flowId);
  });

  app.post<{ Params: FlowParams; Body: GenerateBody }>("/flows/:flowId/generate-approved-runtime", async (request) => {
    const body = request.body ?? {};
    if (body.outDir !== undefined && typeof body.outDir !== "string") {
      throw new WorkspaceError("outDir deve ser string quando informado.", 400);
    }
    const result = await generateApprovedRuntime(workspaceRoot, request.params.flowId, body.outDir);
    return {
      status: "ok",
      flowId: result.flowId,
      flowPath: result.flowPath,
      outDir: result.outDir,
      approval: result.approval,
    };
  });

  app.get<{ Querystring: ArtifactQuery }>("/artifacts", async (request) => {
    const outDir = requiredQueryString(request.query.outDir, "outDir");
    return listGeneratedArtifact(workspaceRoot, outDir);
  });

  app.get<{ Querystring: ArtifactQuery }>("/artifacts/file", async (request) => {
    const outDir = requiredQueryString(request.query.outDir, "outDir");
    const filePath = requiredQueryString(request.query.path, "path");
    return readGeneratedArtifactFile(workspaceRoot, outDir, filePath);
  });

  app.get<{ Querystring: ArtifactQuery }>("/artifacts/archive", async (request, reply) => {
    const outDir = requiredQueryString(request.query.outDir, "outDir");
    const archive = await archiveGeneratedArtifact(workspaceRoot, outDir);
    reply.header("content-type", "application/zip");
    reply.header("content-disposition", `attachment; filename="${archive.fileName}"`);
    reply.header("content-length", String(archive.sizeBytes));
    return reply.send(archive.content);
  });

  app.get<{ Querystring: ArtifactQuery }>("/docker-runtime/status", async (request) => {
    const outDir = requiredQueryString(request.query.outDir, "outDir");
    return dockerRuntimeManager.status(outDir, optionalString(request.query.runtimeUrl, "runtimeUrl"));
  });

  app.get<{ Querystring: DockerHistoryQuery }>("/docker-runtime/history", async (request) => {
    const outDir = requiredQueryString(request.query.outDir, "outDir");
    const runtimeUrl = optionalString(request.query.runtimeUrl, "runtimeUrl");
    const from = parseDateQuery(request.query.from, "from");
    const to = parseDateQuery(request.query.to, "to");
    if (from && to && from > to) {
      throw new WorkspaceError("from deve ser menor ou igual a to.", 400);
    }
    const operation = optionalDockerRuntimeOperation(request.query.operation, "operation");
    const status = optionalDockerRuntimeStatus(request.query.status, "status");
    const level = optionalDockerRuntimeHistoryLevel(request.query.level, "level");
    const progressStatus = optionalDockerBuildProgressStatus(request.query.progressStatus, "progressStatus");
    return dockerRuntimeManager.history(
      outDir,
      runtimeUrl,
      {
        limit: optionalPositiveInteger(request.query.limit, "limit") ?? 20,
        operation,
        status,
        ok: optionalBooleanQuery(request.query.ok, "ok"),
        search: optionalQueryString(request.query.search, "search"),
        level,
        progressStage: optionalQueryString(request.query.progressStage, "progressStage"),
        progressStatus,
        from,
        to,
      },
    );
  });

  app.post<{ Body: DockerRuntimeBody }>("/docker-runtime/build", async (request) => {
    const outDir = requiredBodyString(request.body?.outDir, "outDir");
    return dockerRuntimeManager.build(outDir, optionalString(request.body?.runtimeUrl, "runtimeUrl"));
  });

  app.post<{ Body: DockerRuntimeBody }>("/docker-runtime/cancel", async (request) => {
    const outDir = requiredBodyString(request.body?.outDir, "outDir");
    return dockerRuntimeManager.cancel(outDir, optionalString(request.body?.runtimeUrl, "runtimeUrl"));
  });

  app.post<{ Body: DockerRuntimeBody }>("/docker-runtime/prepare-env", async (request) => {
    const outDir = requiredBodyString(request.body?.outDir, "outDir");
    return dockerRuntimeManager.prepareEnv(outDir, optionalString(request.body?.runtimeUrl, "runtimeUrl"));
  });

  app.post<{ Body: DockerRuntimeBody }>("/docker-runtime/configure-ports", async (request) => {
    const outDir = requiredBodyString(request.body?.outDir, "outDir");
    return dockerRuntimeManager.configurePorts(
      outDir,
      optionalPorts(request.body?.ports),
      optionalString(request.body?.runtimeUrl, "runtimeUrl"),
    );
  });

  app.post<{ Body: DockerRuntimeBody }>("/docker-runtime/up", async (request) => {
    const outDir = requiredBodyString(request.body?.outDir, "outDir");
    return dockerRuntimeManager.up(outDir, optionalString(request.body?.runtimeUrl, "runtimeUrl"));
  });

  app.post<{ Body: DockerRuntimeBody }>("/docker-runtime/down", async (request) => {
    const outDir = requiredBodyString(request.body?.outDir, "outDir");
    return dockerRuntimeManager.down(outDir, optionalString(request.body?.runtimeUrl, "runtimeUrl"));
  });

  app.post<{ Body: DockerRuntimeBody }>("/docker-runtime/smoke", async (request) => {
    const outDir = requiredBodyString(request.body?.outDir, "outDir");
    return dockerRuntimeManager.smoke(
      outDir,
      optionalString(request.body?.runtimeUrl, "runtimeUrl"),
      optionalString(request.body?.agentId, "agentId"),
    );
  });

  app.post<{ Body: DockerRuntimeBody }>("/docker-runtime/inspect", async (request) => {
    const outDir = requiredBodyString(request.body?.outDir, "outDir");
    return dockerRuntimeManager.inspect(outDir, optionalString(request.body?.runtimeUrl, "runtimeUrl"));
  });

  app.get("/sandboxes", async () => ({
    sandboxes: sandboxManager.list(),
  }));

  app.get<{ Params: FlowParams }>("/sandboxes/:flowId/status", async (request) => {
    return sandboxManager.status(request.params.flowId);
  });

  app.post<{ Params: FlowParams; Body: SandboxBody }>("/sandboxes/:flowId/start", async (request) => {
    const body = request.body ?? {};
    if (body.runtimeDir !== undefined && typeof body.runtimeDir !== "string") {
      throw new WorkspaceError("runtimeDir deve ser string quando informado.", 400);
    }
    if (body.port !== undefined && typeof body.port !== "number") {
      throw new WorkspaceError("port deve ser número quando informado.", 400);
    }
    return sandboxManager.start(request.params.flowId, body);
  });

  app.post<{ Params: FlowParams }>("/sandboxes/:flowId/stop", async (request) => {
    return sandboxManager.stop(request.params.flowId);
  });

  app.get<{ Params: FlowParams; Querystring: StudioRunQuery }>(
    "/flows/:flowId/studio-runs",
    async (request) => {
      const minDurationMs = optionalNonNegativeInteger(request.query.minDurationMs, "minDurationMs");
      const maxDurationMs = optionalNonNegativeInteger(request.query.maxDurationMs, "maxDurationMs");
      if (minDurationMs !== undefined && maxDurationMs !== undefined && minDurationMs > maxDurationMs) {
        throw new WorkspaceError("minDurationMs deve ser menor ou igual a maxDurationMs.", 400);
      }
      return listStudioRuns(workspaceRoot, request.params.flowId, {
        q: optionalQueryString(request.query.q, "q"),
        agentId: optionalQueryString(request.query.agentId, "agentId"),
        status: optionalQueryString(request.query.status, "status"),
        phase: optionalQueryString(request.query.phase, "phase"),
        hasErrors: optionalBooleanQuery(request.query.hasErrors, "hasErrors"),
        isComplete: optionalBooleanQuery(request.query.isComplete, "isComplete"),
        node: optionalQueryString(request.query.node, "node"),
        minDurationMs,
        maxDurationMs,
      });
    },
  );

  app.get<{ Params: FlowParams; Querystring: { left: string; right: string } }>(
    "/flows/:flowId/studio-runs/compare",
    async (request) => {
      const leftRunId = optionalQueryString(request.query.left, "left");
      const rightRunId = optionalQueryString(request.query.right, "right");
      if (!leftRunId || !rightRunId) {
        throw new WorkspaceError("left e right são obrigatórios.", 400);
      }
      return compareStudioRuns(workspaceRoot, request.params.flowId, leftRunId, rightRunId);
    },
  );

  app.get<{ Params: StudioRunParams }>("/flows/:flowId/studio-runs/:runId/export", async (request) => {
    return exportStudioRun(workspaceRoot, request.params.flowId, request.params.runId);
  });

  app.get<{ Params: StudioRunParams }>("/flows/:flowId/studio-runs/:runId", async (request) => {
    return loadStudioRun(workspaceRoot, request.params.flowId, request.params.runId);
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/studio-runs", async (request) => {
    return saveStudioRun(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.addHook("onClose", async () => {
    await sandboxManager.stopAll();
  });

  return app;
}

function serializeErrorDetails(details: unknown): unknown {
  if (details instanceof Error) {
    return details.message;
  }
  return details;
}

function requiredQueryString(value: string | undefined, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkspaceError(`${name} é obrigatório.`, 400);
  }
  return value;
}

function requiredBodyString(value: string | undefined, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkspaceError(`${name} é obrigatório.`, 400);
  }
  return value;
}

function optionalString(value: string | undefined, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new WorkspaceError(`${name} deve ser string quando informado.`, 400);
  }
  return value;
}

function optionalQueryString(value: string | undefined, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new WorkspaceError(`${name} deve ser string quando informado.`, 400);
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function optionalPositiveInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new WorkspaceError(`${name} deve ser inteiro positivo quando informado.`, 400);
  }
  return parsed;
}

function optionalDockerRuntimeOperation(value: string | undefined, name: string): DockerRuntimeOperation | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  if (
    normalized === "prepare_env" ||
    normalized === "configure_ports" ||
    normalized === "build" ||
    normalized === "up" ||
    normalized === "down" ||
    normalized === "smoke" ||
    normalized === "inspect" ||
    normalized === "cancel"
  ) {
    return normalized;
  }
  throw new WorkspaceError(`${name} deve ser prepare_env, configure_ports, build, up, down, smoke, inspect ou cancel.`, 400);
}

function optionalDockerRuntimeStatus(value: string | undefined, name: string): DockerRuntimeOperationStatus | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "idle" || normalized === "running" || normalized === "success" || normalized === "error" || normalized === "canceled") {
    return normalized;
  }
  throw new WorkspaceError(`${name} deve ser idle, running, success, error ou canceled.`, 400);
}

function optionalDockerRuntimeHistoryLevel(value: string | undefined, name: string): DockerRuntimeHistoryLevel | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "error" || normalized === "warning" || normalized === "info" || normalized === "success") {
    return normalized;
  }
  throw new WorkspaceError(`${name} deve ser error, warning, info ou success.`, 400);
}

function optionalDockerBuildProgressStatus(value: string | undefined, name: string): DockerBuildProgressStatus | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  if (
    normalized === "running" ||
    normalized === "done" ||
    normalized === "error" ||
    normalized === "warning" ||
    normalized === "info" ||
    normalized === "canceled"
  ) {
    return normalized;
  }
  throw new WorkspaceError(`${name} deve ser running, done, error, warning, info ou canceled.`, 400);
}

function parseDateQuery(value: string | undefined, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    throw new WorkspaceError(`${name} deve ser uma data ISO válida.`, 400);
  }
  return new Date(parsed).toISOString();
}

function optionalNonNegativeInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new WorkspaceError(`${name} deve ser inteiro quando informado.`, 400);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new WorkspaceError(`${name} deve ser inteiro não negativo quando informado.`, 400);
  }
  return parsed;
}

function optionalBooleanQuery(value: string | undefined, name: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new WorkspaceError(`${name} deve ser boolean quando informado.`, 400);
  }
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new WorkspaceError(`${name} deve ser true, false, 1 ou 0.`, 400);
}

function optionalPorts(value: DockerRuntimeBody["ports"] | undefined): NonNullable<DockerRuntimeBody["ports"]> {
  if (value === undefined) {
    return {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkspaceError("ports deve ser objeto quando informado.", 400);
  }
  for (const [key, port] of Object.entries(value)) {
    if (!["api", "postgres", "redis"].includes(key)) {
      throw new WorkspaceError(`Porta desconhecida: ${key}`, 400);
    }
    if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      throw new WorkspaceError(`Porta ${key} deve ser inteiro entre 1 e 65535.`, 400);
    }
  }
  return value;
}

function createEnvironmentDockerRunner(): DockerCommandRunner | undefined {
  if (process.env.AGENT_BUILDER_DOCKER_RUNNER !== "ui-audit-mock") {
    return undefined;
  }
  let state: "stopped" | "running" = "stopped";
  return async (invocation) => {
    const args = invocation.args.join(" ");
    if (args === "compose build api") {
      const chunks = [
        "#1 [internal] load build definition from Dockerfile\n",
        "#2 [internal] load metadata for docker.io/library/python:3.12-slim\n#2 DONE 0.1s\n",
        "#3 [3/8] COPY . /app\n#3 DONE 0.1s\n",
        "#4 [4/8] RUN pip install -r requirements.txt\n#4 DONE 0.2s\n",
        "#5 exporting to image\n#5 DONE 0.1s\n",
      ];
      let stdout = "";
      for (const chunk of chunks) {
        if (invocation.signal?.aborted) {
          return {
            exitCode: 130,
            stdout,
            stderr: "Comando cancelado pelo usuário.",
            aborted: true,
          };
        }
        await delay(180);
        stdout += chunk;
        invocation.onOutput?.(chunk);
      }
      return { exitCode: 0, stdout, stderr: "" };
    }
    if (args === "compose up -d --build") {
      state = "running";
      return {
        exitCode: 0,
        stdout: "Container reference-api-1 Started\nContainer reference-postgres-1 Started\nContainer reference-redis-1 Started\n",
        stderr: "",
      };
    }
    if (args === "compose down") {
      state = "stopped";
      return {
        exitCode: 0,
        stdout: "Container reference-api-1 Stopped\nContainer reference-postgres-1 Stopped\nContainer reference-redis-1 Stopped\n",
        stderr: "",
      };
    }
    if (args === "compose ps --format json") {
      return {
        exitCode: 0,
        stdout: JSON.stringify([
          {
            Name: "reference-api-1",
            Service: "api",
            State: state === "running" ? "running" : "exited",
            Status: state === "running" ? "Up 12 seconds" : "Exited (0) 3 seconds ago",
            Publishers: [{ PublishedPort: 8080, TargetPort: 8080 }],
          },
          {
            Name: "reference-postgres-1",
            Service: "postgres",
            State: state === "running" ? "running" : "exited",
            Status: state === "running" ? "Up 12 seconds" : "Exited (0) 3 seconds ago",
            Publishers: [{ PublishedPort: 5433, TargetPort: 5432 }],
          },
          {
            Name: "reference-redis-1",
            Service: "redis",
            State: state === "running" ? "running" : "exited",
            Status: state === "running" ? "Up 12 seconds" : "Exited (0) 3 seconds ago",
            Publishers: [{ PublishedPort: 6380, TargetPort: 6379 }],
          },
        ]),
        stderr: "",
      };
    }
    if (args === "compose logs --tail 120 --no-color") {
      return {
        exitCode: 0,
        stdout: state === "running"
          ? "api-1  | Application startup complete.\npostgres-1  | database system is ready\nredis-1  | Ready to accept connections\n"
          : "api-1  | Graceful shutdown complete.\n",
        stderr: "",
      };
    }
    return { exitCode: 0, stdout: `ok ${args}`, stderr: "" };
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3333);
  const host = process.env.HOST ?? "127.0.0.1";
  const app = buildApp({ logger: true });
  await app.listen({ port, host });
}
