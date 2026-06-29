import { pathToFileURL } from "node:url";
import fastify, { type FastifyInstance } from "fastify";
import { agentFlowJsonSchema, llmAdapterCatalog, runtimeManifestJsonSchema } from "@agent-flow-builder/flow-spec";
import { SandboxManager } from "./sandbox.ts";
import {
  archiveGeneratedArtifact,
  createFlowWorkspace,
  createPrompt,
  createSchemaAsset,
  deletePrompt,
  deleteSchemaAsset,
  exportFlowWorkspace,
  importFlowWorkspace,
  generateRuntimeManifest,
  generateRuntime,
  listGeneratedArtifact,
  listFlows,
  loadFlowById,
  loadRuntimeManifest,
  normalizeWorkspaceRoot,
  readGeneratedArtifactFile,
  readPrompt,
  readSchemaAsset,
  saveFlow,
  savePrompt,
  saveSchemaAsset,
  validateRuntimeManifest,
  validateFlow,
  WorkspaceError,
} from "./workspace.ts";

export interface BuildAppOptions {
  workspaceRoot?: string;
  logger?: boolean;
}

interface FlowParams {
  flowId: string;
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

interface SandboxBody {
  runtimeDir?: string;
  port?: number;
}

interface ArtifactQuery {
  outDir?: string;
  path?: string;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const workspaceRoot = normalizeWorkspaceRoot(
    options.workspaceRoot ?? process.env.AGENT_BUILDER_WORKSPACE ?? process.cwd(),
  );
  const app = fastify({ logger: options.logger ?? false });
  const sandboxManager = new SandboxManager(workspaceRoot);

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

  app.get("/runtime-manifest", async () => {
    const loaded = await loadRuntimeManifest(workspaceRoot);
    return {
      path: loaded.relativePath,
      manifest: loaded.manifest,
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3333);
  const host = process.env.HOST ?? "127.0.0.1";
  const app = buildApp({ logger: true });
  await app.listen({ port, host });
}
