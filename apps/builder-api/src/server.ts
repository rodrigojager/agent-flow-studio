import { pathToFileURL } from "node:url";
import fastify, { type FastifyInstance } from "fastify";
import { agentFlowJsonSchema, runtimeManifestJsonSchema } from "@agent-flow-builder/flow-spec";
import { SandboxManager } from "./sandbox.ts";
import {
  generateRuntimeManifest,
  generateRuntime,
  listFlows,
  loadFlowById,
  loadRuntimeManifest,
  normalizeWorkspaceRoot,
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

interface AssetBody {
  content?: unknown;
}

interface SandboxBody {
  runtimeDir?: string;
  port?: number;
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
    reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
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

  app.get<{ Params: FlowParams }>("/flows/:flowId", async (request) => {
    const loaded = await loadFlowById(workspaceRoot, request.params.flowId);
    return {
      path: loaded.relativePath,
      flow: loaded.flow,
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

  app.put<{ Params: PromptParams; Body: AssetBody }>("/flows/:flowId/prompts/:promptId", async (request) => {
    return savePrompt(workspaceRoot, request.params.flowId, request.params.promptId, request.body?.content);
  });

  app.get<{ Params: SchemaParams }>("/flows/:flowId/schemas/:schemaId", async (request) => {
    return readSchemaAsset(workspaceRoot, request.params.flowId, request.params.schemaId);
  });

  app.put<{ Params: SchemaParams; Body: AssetBody }>("/flows/:flowId/schemas/:schemaId", async (request) => {
    return saveSchemaAsset(workspaceRoot, request.params.flowId, request.params.schemaId, request.body?.content);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3333);
  const host = process.env.HOST ?? "127.0.0.1";
  const app = buildApp({ logger: true });
  await app.listen({ port, host });
}
