import { access, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  flowProjectFingerprint,
  generateLangGraphSandbox,
  generateLangGraphRuntime,
  generateManifestRuntime as generateManifestRuntimeBundle,
  type ManifestAgentRuntime,
} from "@agent-flow-builder/codegen-langgraph";
import {
  analyzeAgentFlow,
  type AgentFlow,
  type FlowDiagnostic,
  parseAgentFlow,
  parseRuntimeManifest,
  type RuntimeManifest,
} from "@agent-flow-builder/flow-spec";

export interface FlowSummary {
  id: string;
  name: string | null;
  version: string | null;
  path: string;
  valid: boolean;
  error?: string;
}

export interface LoadedFlow {
  flow: AgentFlow;
  relativePath: string;
  absolutePath: string;
  flowRoot: string;
}

export interface LoadedRuntimeManifest {
  manifest: RuntimeManifest;
  relativePath: string;
  absolutePath: string;
}

export interface SaveRuntimeManifestResult extends LoadedRuntimeManifest {}

export interface GenerateResult {
  flowId: string;
  flowPath: string;
  outDir: string;
  absoluteOutDir: string;
}

export interface LangGraphSandboxApproval {
  status: "approved";
  flowId: string;
  flowVersion: string;
  flowHash: string;
  sandboxOutDir: string;
  approvedFor: "fastapi-runtime";
  approvalPath: string;
  approvedAt: string;
}

export interface LangGraphSandboxApprovalStatus {
  status: "approved" | "missing" | "outdated" | "invalid";
  flowId: string;
  flowVersion: string;
  flowHash: string;
  sandboxOutDir?: string;
  approvedFor?: "fastapi-runtime";
  approvalPath: string;
  approvedAt?: string;
  reason: string;
  details?: unknown;
}

export interface ApprovedGenerateResult extends GenerateResult {
  approval: LangGraphSandboxApproval;
}

interface GeneratedProjectMetadata {
  target?: string;
  flowId?: string;
  flowVersion?: string;
  flowHash?: string;
}

export interface GenerateManifestResult {
  manifestId: string;
  manifestPath: string;
  outDir: string;
  absoluteOutDir: string;
  agents: Array<{
    id: string;
    flowPath: string;
    routePrefix: string;
  }>;
}

export interface CreateFlowWorkspaceResult {
  flow: AgentFlow;
  flowPath: string;
  prompts: FlowAssetContent[];
  schemas: FlowAssetContent[];
}

export interface SaveFlowResult {
  flow: AgentFlow;
  flowPath: string;
}

export interface FlowAssetContent {
  id: string;
  path: string;
  content: string;
}

export interface DeletedFlowAsset {
  id: string;
  path: string;
}

export interface FlowAssetMutationResult {
  flow: AgentFlow;
  flowPath: string;
  asset: FlowAssetContent;
}

export interface FlowAssetDeleteResult {
  flow: AgentFlow;
  flowPath: string;
  deleted: DeletedFlowAsset;
}

export interface FlowWorkspaceExport {
  format: typeof FLOW_WORKSPACE_EXPORT_FORMAT;
  exportedAt: string;
  source: {
    flowId: string;
    flowPath: string;
  };
  flow: AgentFlow;
  prompts: FlowAssetContent[];
  schemas: FlowAssetContent[];
}

export interface ImportFlowWorkspaceOptions {
  overwrite?: boolean;
}

export interface ImportFlowWorkspaceResult {
  flow: AgentFlow;
  flowPath: string;
  prompts: number;
  schemas: number;
}

export interface FlowValidationResult {
  status: "ok" | "error";
  id: string;
  name: string;
  version: string;
  nodes: number;
  edges: number;
  contract: string;
  diagnostics: FlowDiagnostic[];
  summary: {
    nodes: number;
    edges: number;
    prompts: number;
    schemas: number;
    errors: number;
    warnings: number;
    infos: number;
  };
}

export interface GeneratedArtifactFileSummary {
  path: string;
  sizeBytes: number;
}

export interface GeneratedArtifactListing {
  outDir: string;
  files: GeneratedArtifactFileSummary[];
  totalSizeBytes: number;
}

export interface GeneratedArtifactFileContent {
  outDir: string;
  path: string;
  content: string;
  sizeBytes: number;
  truncated: boolean;
}

export interface GeneratedArtifactArchive {
  outDir: string;
  fileName: string;
  content: Buffer;
  sizeBytes: number;
}

const FLOW_WORKSPACE_EXPORT_FORMAT = "agent-flow-builder.flow-workspace.v1";
const GENERATED_ARTIFACT_MAX_FILES = 1000;
const GENERATED_ARTIFACT_MAX_PREVIEW_BYTES = 512 * 1024;
const GENERATED_ARTIFACT_IGNORED_DIRS = new Set([".git", ".pytest_cache", "__pycache__", ".venv", "venv", "node_modules", ".langgraph_api"]);
const GENERATED_ARTIFACT_IGNORED_EXTENSIONS = new Set([".pyc", ".pyo", ".db", ".sqlite", ".sqlite3"]);
const GENERATED_ARTIFACT_IGNORED_FILES = new Set([".env"]);

export class WorkspaceError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "WorkspaceError";
  }
}

export function normalizeWorkspaceRoot(workspaceRoot: string): string {
  return path.resolve(workspaceRoot);
}

export function safeResolve(workspaceRoot: string, targetPath: string): string {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const resolved = path.resolve(root, targetPath);
  const normalizedRoot = root.toLowerCase();
  const normalizedResolved = resolved.toLowerCase();
  if (normalizedResolved !== normalizedRoot && !normalizedResolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new WorkspaceError(`Caminho fora do workspace: ${targetPath}`, 400);
  }
  return resolved;
}

export function toWorkspaceRelative(workspaceRoot: string, absolutePath: string): string {
  return path.relative(normalizeWorkspaceRoot(workspaceRoot), absolutePath).replaceAll(path.sep, "/");
}

export async function listFlows(workspaceRoot: string): Promise<FlowSummary[]> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const flowsDir = safeResolve(root, "flows");
  let entries;
  try {
    entries = await readdir(flowsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const summaries: FlowSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const relativePath = `flows/${entry.name}/agent.flow.json`;
    const absolutePath = safeResolve(root, relativePath);
    try {
      await access(absolutePath);
      const loaded = await loadFlowByPath(root, relativePath);
      summaries.push({
        id: loaded.flow.id,
        name: loaded.flow.name,
        version: loaded.flow.version,
        path: relativePath,
        valid: true,
      });
    } catch (error) {
      summaries.push({
        id: entry.name,
        name: null,
        version: null,
        path: relativePath,
        valid: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return summaries.sort((left, right) => left.id.localeCompare(right.id));
}

export async function createFlowWorkspace(workspaceRoot: string, value: unknown): Promise<CreateFlowWorkspaceResult> {
  const input = parseCreateFlowInput(value);
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const flowsDir = safeResolve(root, "flows");
  await mkdir(flowsDir, { recursive: true });
  const flowRoot = safeResolve(root, `flows/${input.id}`);
  if (await pathExists(flowRoot)) {
    throw new WorkspaceError(`Flow já existe: ${input.id}`, 409);
  }

  const flow = starterFlow(input);
  const parsedFlow = parseAgentFlow(flow);
  const prompt: FlowAssetContent = {
    id: "system",
    path: "prompts/system.md",
    content: starterPrompt(input.name),
  };
  const stateSchema: FlowAssetContent = {
    id: "session_state",
    path: "schemas/session_state.schema.json",
    content: `${JSON.stringify(starterStateSchema(input.name), null, 2)}\n`,
  };
  const tempDir = safeResolve(root, `flows/.create-${input.id}-${Date.now()}`);
  await rm(tempDir, { recursive: true, force: true });
  await mkdir(path.join(tempDir, "prompts"), { recursive: true });
  await mkdir(path.join(tempDir, "schemas"), { recursive: true });

  try {
    await writeFile(path.join(tempDir, "agent.flow.json"), `${JSON.stringify(parsedFlow, null, 2)}\n`, "utf-8");
    await writeFile(path.join(tempDir, prompt.path), prompt.content, "utf-8");
    await writeFile(path.join(tempDir, stateSchema.path), stateSchema.content, "utf-8");
    await rename(tempDir, flowRoot);
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }

  return {
    flow: parsedFlow,
    flowPath: `${toWorkspaceRelative(root, flowRoot)}/agent.flow.json`,
    prompts: [prompt],
    schemas: [stateSchema],
  };
}

export async function loadFlowById(workspaceRoot: string, flowId: string): Promise<LoadedFlow> {
  const summary = (await listFlows(workspaceRoot)).find((item) => item.id === flowId);
  if (!summary) {
    throw new WorkspaceError(`Flow não encontrado: ${flowId}`, 404);
  }
  if (!summary.valid) {
    throw new WorkspaceError(`Flow inválido: ${flowId}`, 422, summary.error);
  }
  return loadFlowByPath(workspaceRoot, summary.path);
}

export async function loadFlowByPath(workspaceRoot: string, relativePath: string): Promise<LoadedFlow> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const absolutePath = safeResolve(root, relativePath);
  const raw = await readFile(absolutePath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new WorkspaceError("agent.flow.json não é JSON válido.", 422, error);
  }

  try {
    const flow = parseAgentFlow(parsed);
    return {
      flow,
      relativePath: toWorkspaceRelative(root, absolutePath),
      absolutePath,
      flowRoot: path.dirname(absolutePath),
    };
  } catch (error) {
    throw new WorkspaceError("agent.flow.json não respeita o Flow Spec.", 422, error);
  }
}

export async function validateFlow(workspaceRoot: string, flowId: string): Promise<FlowValidationResult> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const diagnostics = [
    ...analyzeAgentFlow(loaded.flow).diagnostics,
    ...(await validateReferencedAssets(loaded)),
  ];
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const infos = diagnostics.filter((diagnostic) => diagnostic.severity === "info").length;
  return {
    status: errors ? "error" : "ok",
    id: loaded.flow.id,
    name: loaded.flow.name,
    version: loaded.flow.version,
    nodes: loaded.flow.nodes.length,
    edges: loaded.flow.edges.length,
    contract: loaded.flow.api.contract,
    diagnostics,
    summary: {
      nodes: loaded.flow.nodes.length,
      edges: loaded.flow.edges.length,
      prompts: loaded.flow.prompts.length,
      schemas: loaded.flow.schemas.length,
      errors,
      warnings,
      infos,
    },
  };
}

export async function loadRuntimeManifest(
  workspaceRoot: string,
  manifestPath = "runtime.manifest.json",
): Promise<LoadedRuntimeManifest> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const absolutePath = safeResolve(root, manifestPath);
  const raw = await readFile(absolutePath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new WorkspaceError("runtime.manifest.json não é JSON válido.", 422, error);
  }

  try {
    return {
      manifest: parseRuntimeManifest(parsed),
      relativePath: toWorkspaceRelative(root, absolutePath),
      absolutePath,
    };
  } catch (error) {
    throw new WorkspaceError("runtime.manifest.json não respeita o Runtime Manifest Spec.", 422, error);
  }
}

export async function saveRuntimeManifest(
  workspaceRoot: string,
  value: unknown,
  manifestPath = "runtime.manifest.json",
): Promise<SaveRuntimeManifestResult> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const absolutePath = safeResolve(root, manifestPath);
  let manifest: RuntimeManifest;
  try {
    manifest = parseRuntimeManifest(value);
  } catch (error) {
    throw new WorkspaceError("Manifesto enviado não respeita o Runtime Manifest Spec.", 422, error);
  }

  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  const tempPath = `${absolutePath}.tmp-${Date.now()}`;
  await writeFile(tempPath, serialized, "utf-8");
  await rename(tempPath, absolutePath);
  return {
    manifest,
    relativePath: toWorkspaceRelative(root, absolutePath),
    absolutePath,
  };
}

export async function validateRuntimeManifest(workspaceRoot: string) {
  const loaded = await loadRuntimeManifest(workspaceRoot);
  const agents = await resolveManifestAgents(workspaceRoot, loaded.manifest);
  return {
    status: "ok" as const,
    id: loaded.manifest.id,
    name: loaded.manifest.name,
    version: loaded.manifest.version,
    packaging: loaded.manifest.packaging,
    agents: agents.map((agent) => ({
      id: agent.id,
      flowId: agent.flow.id,
      flowName: agent.flow.name,
      flowVersion: agent.flow.version,
      flowPath: loaded.manifest.agents.find((manifestAgent) => manifestAgent.id === agent.id)?.flowPath ?? "",
      routePrefix: agent.routePrefix,
      resourceName: agent.flow.api.resourceName,
      contract: agent.flow.api.contract,
    })),
  };
}

export async function saveFlow(workspaceRoot: string, flowId: string, value: unknown): Promise<SaveFlowResult> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const existing = await loadFlowById(root, flowId);
  let flow: AgentFlow;
  try {
    flow = parseAgentFlow(value);
  } catch (error) {
    throw new WorkspaceError("Flow enviado não respeita o Flow Spec.", 422, error);
  }
  if (flow.id !== existing.flow.id) {
    throw new WorkspaceError(
      `O id do flow enviado (${flow.id}) não pode divergir da rota (${existing.flow.id}).`,
      409,
    );
  }

  const serialized = `${JSON.stringify(flow, null, 2)}\n`;
  const tempPath = `${existing.absolutePath}.tmp-${Date.now()}`;
  await writeFile(tempPath, serialized, "utf-8");
  await rename(tempPath, existing.absolutePath);
  return {
    flow,
    flowPath: existing.relativePath,
  };
}

export async function readPrompt(workspaceRoot: string, flowId: string, promptId: string): Promise<FlowAssetContent> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const prompt = loaded.flow.prompts.find((item) => item.id === promptId);
  if (!prompt) {
    throw new WorkspaceError(`Prompt não encontrado: ${promptId}`, 404);
  }
  const absolutePath = safeResolveFlowAsset(loaded.flowRoot, prompt.path);
  return {
    id: prompt.id,
    path: prompt.path,
    content: await readFile(absolutePath, "utf-8"),
  };
}

export async function savePrompt(
  workspaceRoot: string,
  flowId: string,
  promptId: string,
  content: unknown,
): Promise<FlowAssetContent> {
  if (typeof content !== "string") {
    throw new WorkspaceError("Conteúdo do prompt deve ser string.", 400);
  }
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const prompt = loaded.flow.prompts.find((item) => item.id === promptId);
  if (!prompt) {
    throw new WorkspaceError(`Prompt não encontrado: ${promptId}`, 404);
  }
  const absolutePath = safeResolveFlowAsset(loaded.flowRoot, prompt.path);
  await writeFile(absolutePath, content, "utf-8");
  return {
    id: prompt.id,
    path: prompt.path,
    content,
  };
}

export async function createPrompt(
  workspaceRoot: string,
  flowId: string,
  value: unknown,
): Promise<FlowAssetMutationResult> {
  const input = parsePromptAssetInput(value);
  const loaded = await loadFlowById(workspaceRoot, flowId);
  if (loaded.flow.prompts.some((prompt) => prompt.id === input.id)) {
    throw new WorkspaceError(`Prompt já existe: ${input.id}`, 409);
  }
  assertUniqueAssetPath(loaded.flow, input.path);
  const absolutePath = safeResolveFlowAsset(loaded.flowRoot, input.path);
  assertAssetPathPrefix(input.path, "prompts");
  if (await pathExists(absolutePath)) {
    throw new WorkspaceError(`Arquivo de prompt já existe: ${input.path}`, 409);
  }

  const flow = parseAgentFlow({
    ...loaded.flow,
    prompts: [
      ...loaded.flow.prompts,
      {
        id: input.id,
        path: input.path,
        version: input.version,
        description: input.description,
        tags: input.tags,
        variables: input.variables,
      },
    ],
  });
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, input.content, "utf-8");
  await writeFlowFile(loaded, flow);
  return {
    flow,
    flowPath: loaded.relativePath,
    asset: {
      id: input.id,
      path: input.path,
      content: input.content,
    },
  };
}

export async function deletePrompt(
  workspaceRoot: string,
  flowId: string,
  promptId: string,
): Promise<FlowAssetDeleteResult> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const prompt = loaded.flow.prompts.find((item) => item.id === promptId);
  if (!prompt) {
    throw new WorkspaceError(`Prompt não encontrado: ${promptId}`, 404);
  }
  if (loaded.flow.prompts.length <= 1) {
    throw new WorkspaceError("Flow precisa manter ao menos um prompt.", 409);
  }
  const referencingNode = loaded.flow.nodes.find((node) => node.promptId === promptId);
  if (referencingNode) {
    throw new WorkspaceError(`Prompt ${promptId} ainda é usado pelo nó ${referencingNode.id}.`, 409);
  }

  const flow = parseAgentFlow({
    ...loaded.flow,
    prompts: loaded.flow.prompts.filter((item) => item.id !== promptId),
  });
  await writeFlowFile(loaded, flow);
  await removeAssetFileIfUnreferenced(loaded.flowRoot, flow, prompt.path);
  return {
    flow,
    flowPath: loaded.relativePath,
    deleted: {
      id: prompt.id,
      path: prompt.path,
    },
  };
}

export async function readSchemaAsset(workspaceRoot: string, flowId: string, schemaId: string): Promise<FlowAssetContent> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const schema = loaded.flow.schemas.find((item) => item.id === schemaId);
  if (!schema) {
    throw new WorkspaceError(`Schema não encontrado: ${schemaId}`, 404);
  }
  const absolutePath = safeResolveFlowAsset(loaded.flowRoot, schema.path);
  return {
    id: schema.id,
    path: schema.path,
    content: await readFile(absolutePath, "utf-8"),
  };
}

export async function saveSchemaAsset(
  workspaceRoot: string,
  flowId: string,
  schemaId: string,
  content: unknown,
): Promise<FlowAssetContent> {
  if (typeof content !== "string") {
    throw new WorkspaceError("Conteúdo do schema deve ser string.", 400);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new WorkspaceError("Schema deve ser JSON válido.", 422, error);
  }
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const schema = loaded.flow.schemas.find((item) => item.id === schemaId);
  if (!schema) {
    throw new WorkspaceError(`Schema não encontrado: ${schemaId}`, 404);
  }
  const formatted = `${JSON.stringify(parsed, null, 2)}\n`;
  const absolutePath = safeResolveFlowAsset(loaded.flowRoot, schema.path);
  await writeFile(absolutePath, formatted, "utf-8");
  return {
    id: schema.id,
    path: schema.path,
    content: formatted,
  };
}

export async function createSchemaAsset(
  workspaceRoot: string,
  flowId: string,
  value: unknown,
): Promise<FlowAssetMutationResult> {
  const input = parseSchemaAssetInput(value);
  const loaded = await loadFlowById(workspaceRoot, flowId);
  if (loaded.flow.schemas.some((schema) => schema.id === input.id)) {
    throw new WorkspaceError(`Schema já existe: ${input.id}`, 409);
  }
  assertUniqueAssetPath(loaded.flow, input.path);
  const absolutePath = safeResolveFlowAsset(loaded.flowRoot, input.path);
  assertAssetPathPrefix(input.path, "schemas");
  if (await pathExists(absolutePath)) {
    throw new WorkspaceError(`Arquivo de schema já existe: ${input.path}`, 409);
  }

  const formatted = `${JSON.stringify(input.parsed, null, 2)}\n`;
  const flow = parseAgentFlow({
    ...loaded.flow,
    schemas: [
      ...loaded.flow.schemas,
      {
        id: input.id,
        path: input.path,
        version: input.version,
        description: input.description,
        tags: input.tags,
      },
    ],
  });
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, formatted, "utf-8");
  await writeFlowFile(loaded, flow);
  return {
    flow,
    flowPath: loaded.relativePath,
    asset: {
      id: input.id,
      path: input.path,
      content: formatted,
    },
  };
}

export async function deleteSchemaAsset(
  workspaceRoot: string,
  flowId: string,
  schemaId: string,
): Promise<FlowAssetDeleteResult> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const schema = loaded.flow.schemas.find((item) => item.id === schemaId);
  if (!schema) {
    throw new WorkspaceError(`Schema não encontrado: ${schemaId}`, 404);
  }
  if (loaded.flow.state.schemaRef === schema.id || loaded.flow.state.schemaRef === schema.path) {
    throw new WorkspaceError(`Schema ${schemaId} é o schema de estado do flow.`, 409);
  }
  const referencingNode = loaded.flow.nodes.find((node) => node.outputSchema === schema.id || node.outputSchema === schema.path);
  if (referencingNode) {
    throw new WorkspaceError(`Schema ${schemaId} ainda é usado pelo nó ${referencingNode.id}.`, 409);
  }

  const flow = parseAgentFlow({
    ...loaded.flow,
    schemas: loaded.flow.schemas.filter((item) => item.id !== schemaId),
  });
  await writeFlowFile(loaded, flow);
  await removeAssetFileIfUnreferenced(loaded.flowRoot, flow, schema.path);
  return {
    flow,
    flowPath: loaded.relativePath,
    deleted: {
      id: schema.id,
      path: schema.path,
    },
  };
}

async function validateReferencedAssets(loaded: LoadedFlow): Promise<FlowDiagnostic[]> {
  const diagnostics: FlowDiagnostic[] = [];
  const promptBasenames = new Map<string, string>();
  const schemaBasenames = new Map<string, string>();

  for (const prompt of loaded.flow.prompts) {
    const basename = path.basename(prompt.path);
    const existing = promptBasenames.get(basename);
    if (existing && existing !== prompt.id) {
      diagnostics.push({
        severity: "warning",
        code: "codegen_prompt_basename_conflict",
        message: `Prompts ${existing} e ${prompt.id} usam o mesmo nome de arquivo ${basename} no runtime gerado.`,
        path: `prompts.${prompt.id}.path`,
        assetId: prompt.id,
      });
    }
    promptBasenames.set(basename, prompt.id);

    try {
      const content = await readFile(safeResolveFlowAsset(loaded.flowRoot, prompt.path), "utf-8");
      if (!content.trim()) {
        diagnostics.push({
          severity: "warning",
          code: "empty_prompt_file",
          message: `Prompt ${prompt.id} está vazio.`,
          path: `prompts.${prompt.id}.path`,
          assetId: prompt.id,
        });
      }
    } catch (error) {
      diagnostics.push(assetReadDiagnostic("missing_prompt_file", prompt.id, prompt.path, error));
    }
  }

  for (const schema of loaded.flow.schemas) {
    const basename = path.basename(schema.path);
    const existing = schemaBasenames.get(basename);
    if (existing && existing !== schema.id) {
      diagnostics.push({
        severity: "warning",
        code: "codegen_schema_basename_conflict",
        message: `Schemas ${existing} e ${schema.id} usam o mesmo nome de arquivo ${basename} no runtime gerado.`,
        path: `schemas.${schema.id}.path`,
        assetId: schema.id,
      });
    }
    schemaBasenames.set(basename, schema.id);

    let content: string;
    try {
      content = await readFile(safeResolveFlowAsset(loaded.flowRoot, schema.path), "utf-8");
    } catch (error) {
      diagnostics.push(assetReadDiagnostic("missing_schema_file", schema.id, schema.path, error));
      continue;
    }
    try {
      JSON.parse(content);
    } catch (error) {
      diagnostics.push(assetReadDiagnostic("invalid_schema_file", schema.id, schema.path, error));
    }
  }

  return diagnostics;
}

function assetReadDiagnostic(code: string, assetId: string, assetPath: string, error: unknown): FlowDiagnostic {
  const message =
    error instanceof WorkspaceError
      ? error.message
      : code === "invalid_schema_file"
        ? `Schema ${assetId} não é um JSON válido em ${assetPath}.`
        : `Asset ${assetId} não foi encontrado em ${assetPath}.`;
  return {
    severity: "error",
    code,
    message,
    path: assetPath,
    assetId,
  };
}

export async function exportFlowWorkspace(workspaceRoot: string, flowId: string): Promise<FlowWorkspaceExport> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const prompts = await Promise.all(
    loaded.flow.prompts.map(async (prompt) => ({
      id: prompt.id,
      path: prompt.path,
      content: await readReferencedAsset(loaded.flowRoot, prompt.path, `prompt ${prompt.id}`),
    })),
  );
  const schemas = await Promise.all(
    loaded.flow.schemas.map(async (schema) => ({
      id: schema.id,
      path: schema.path,
      content: await readReferencedAsset(loaded.flowRoot, schema.path, `schema ${schema.id}`),
    })),
  );

  return {
    format: FLOW_WORKSPACE_EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    source: {
      flowId: loaded.flow.id,
      flowPath: loaded.relativePath,
    },
    flow: loaded.flow,
    prompts,
    schemas,
  };
}

export async function importFlowWorkspace(
  workspaceRoot: string,
  value: unknown,
  options: ImportFlowWorkspaceOptions = {},
): Promise<ImportFlowWorkspaceResult> {
  const workspace = parseFlowWorkspaceExport(value);
  const flow = workspace.flow;
  assertImportableFlowId(flow.id);
  const promptAssets = assetsForRefs(flow.prompts, workspace.prompts, "prompt");
  const schemaAssets = assetsForRefs(flow.schemas, workspace.schemas, "schema");
  for (const schema of schemaAssets) {
    try {
      JSON.parse(schema.content);
    } catch (error) {
      throw new WorkspaceError(`Schema ${schema.id} importado não é JSON válido.`, 422, error);
    }
  }
  assertNoPathContentConflicts([...promptAssets, ...schemaAssets]);
  assertNoReservedAssetPaths([...promptAssets, ...schemaAssets]);

  const root = normalizeWorkspaceRoot(workspaceRoot);
  const flowsDir = safeResolve(root, "flows");
  await mkdir(flowsDir, { recursive: true });
  const targetDir = safeResolve(root, `flows/${flow.id}`);
  const flowPath = `${toWorkspaceRelative(root, targetDir)}/agent.flow.json`;
  const targetExists = await pathExists(targetDir);
  if (targetExists && !options.overwrite) {
    throw new WorkspaceError(`Flow já existe: ${flow.id}`, 409);
  }

  const tempDir = safeResolve(root, `flows/.import-${flow.id}-${Date.now()}`);
  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });

  try {
    await writeFile(path.join(tempDir, "agent.flow.json"), `${JSON.stringify(flow, null, 2)}\n`, "utf-8");
    for (const asset of promptAssets) {
      await writeImportedAsset(tempDir, asset.path, asset.content);
    }
    for (const asset of schemaAssets) {
      await writeImportedAsset(tempDir, asset.path, `${JSON.stringify(JSON.parse(asset.content), null, 2)}\n`);
    }
    if (targetExists) {
      await rm(targetDir, { recursive: true, force: true });
    }
    await rename(tempDir, targetDir);
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }

  return {
    flow,
    flowPath,
    prompts: promptAssets.length,
    schemas: schemaAssets.length,
  };
}

export async function listGeneratedArtifact(workspaceRoot: string, outDir: string): Promise<GeneratedArtifactListing> {
  const artifact = await resolveGeneratedArtifactRoot(workspaceRoot, outDir);
  const files = await collectGeneratedArtifactFiles(artifact.absoluteOutDir);
  return {
    outDir: artifact.relativeOutDir,
    files,
    totalSizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
  };
}

export async function readGeneratedArtifactFile(
  workspaceRoot: string,
  outDir: string,
  filePath: string,
): Promise<GeneratedArtifactFileContent> {
  const artifact = await resolveGeneratedArtifactRoot(workspaceRoot, outDir);
  const relativePath = normalizeArtifactRelativePath(filePath);
  const absolutePath = safeResolveArtifactFile(artifact.absoluteOutDir, relativePath);
  let fileStat;
  try {
    fileStat = await stat(absolutePath);
  } catch (error) {
    throw new WorkspaceError(`Arquivo gerado não encontrado: ${relativePath}`, 404, error);
  }
  if (!fileStat.isFile()) {
    throw new WorkspaceError(`Path do artefato não é arquivo: ${relativePath}`, 400);
  }

  const bytesToRead = Math.min(fileStat.size, GENERATED_ARTIFACT_MAX_PREVIEW_BYTES);
  const handle = await open(absolutePath, "r");
  try {
    const buffer = Buffer.alloc(bytesToRead);
    const result = await handle.read(buffer, 0, bytesToRead, 0);
    return {
      outDir: artifact.relativeOutDir,
      path: relativePath,
      content: buffer.subarray(0, result.bytesRead).toString("utf-8"),
      sizeBytes: fileStat.size,
      truncated: fileStat.size > result.bytesRead,
    };
  } finally {
    await handle.close();
  }
}

export async function archiveGeneratedArtifact(
  workspaceRoot: string,
  outDir: string,
): Promise<GeneratedArtifactArchive> {
  const artifact = await resolveGeneratedArtifactRoot(workspaceRoot, outDir);
  const files = await collectGeneratedArtifactFiles(artifact.absoluteOutDir);
  const archiveRootName = path.basename(artifact.relativeOutDir) || "runtime-artifact";
  const archiveFiles = await Promise.all(
    files.map(async (file) => ({
      path: `${archiveRootName}/${file.path}`,
      content: await readFile(path.join(artifact.absoluteOutDir, file.path)),
    })),
  );
  const content = writeZipArchive(archiveFiles);
  return {
    outDir: artifact.relativeOutDir,
    fileName: `${sanitizeFileName(archiveRootName)}.zip`,
    content,
    sizeBytes: content.byteLength,
  };
}

function safeResolveFlowAsset(flowRoot: string, assetPath: string): string {
  const root = path.resolve(flowRoot);
  const resolved = path.resolve(root, assetPath);
  const relativePath = path.relative(root, resolved);
  if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new WorkspaceError(`Asset fora do diretório do flow: ${assetPath}`, 400);
  }
  return resolved;
}

async function writeFlowFile(loaded: LoadedFlow, flow: AgentFlow): Promise<void> {
  const serialized = `${JSON.stringify(flow, null, 2)}\n`;
  const tempPath = `${loaded.absolutePath}.tmp-${Date.now()}`;
  await writeFile(tempPath, serialized, "utf-8");
  await rename(tempPath, loaded.absolutePath);
}

interface PromptAssetInput {
  id: string;
  path: string;
  version: string;
  description?: string;
  tags: string[];
  variables: string[];
  content: string;
}

interface SchemaAssetInput {
  id: string;
  path: string;
  version: string;
  description?: string;
  tags: string[];
  parsed: unknown;
}

function parsePromptAssetInput(value: unknown): PromptAssetInput {
  if (!isRecord(value)) {
    throw new WorkspaceError("Prompt deve ser um objeto JSON.", 400);
  }
  const id = parseAssetId(value.id, "id do prompt");
  const promptPath = typeof value.path === "string" && value.path.trim() ? value.path.trim() : `prompts/${id}.md`;
  const version = typeof value.version === "string" && value.version.trim() ? value.version.trim() : "v1";
  const description = parseOptionalAssetText(value.description);
  const tags = value.tags === undefined ? [] : parseStringList(value.tags, "tags");
  const variables = value.variables === undefined ? [] : parseStringList(value.variables, "variables");
  const content =
    typeof value.content === "string"
      ? value.content
      : `# ${id}\n\nDefina o prompt deste nó em português brasileiro.\n`;
  return {
    id,
    path: normalizeAssetPath(promptPath),
    version,
    description,
    tags,
    variables,
    content,
  };
}

function parseSchemaAssetInput(value: unknown): SchemaAssetInput {
  if (!isRecord(value)) {
    throw new WorkspaceError("Schema deve ser um objeto JSON.", 400);
  }
  const id = parseAssetId(value.id, "id do schema");
  const schemaPath = typeof value.path === "string" && value.path.trim() ? value.path.trim() : `schemas/${id}.schema.json`;
  const version = typeof value.version === "string" && value.version.trim() ? value.version.trim() : "v1";
  const description = parseOptionalAssetText(value.description);
  const tags = value.tags === undefined ? [] : parseStringList(value.tags, "tags");
  const content = typeof value.content === "string" && value.content.trim()
    ? value.content
    : '{"type":"object","properties":{}}';
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new WorkspaceError("Schema deve ser JSON válido.", 422, error);
  }
  return {
    id,
    path: normalizeAssetPath(schemaPath),
    version,
    description,
    tags,
    parsed,
  };
}

function parseOptionalAssetText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseAssetId(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkspaceError(`${label} é obrigatório.`, 400);
  }
  const id = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) {
    throw new WorkspaceError(`${label} deve usar letras, números, _ ou -.`, 422);
  }
  return id;
}

function parseStringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new WorkspaceError(`${label} deve ser uma lista de strings.`, 400);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new WorkspaceError(`${label}[${index}] deve ser uma string não vazia.`, 400);
    }
    return item.trim();
  });
}

function normalizeAssetPath(assetPath: string): string {
  const normalized = assetPath.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (!normalized || normalized.includes("\0") || normalized.split("/").includes("..") || path.isAbsolute(normalized)) {
    throw new WorkspaceError(`Path de asset inválido: ${assetPath}`, 400);
  }
  if (normalized === "agent.flow.json") {
    throw new WorkspaceError("Asset não pode sobrescrever agent.flow.json.", 422);
  }
  return normalized;
}

function assertAssetPathPrefix(assetPath: string, prefix: "prompts" | "schemas"): void {
  if (assetPath !== prefix && !assetPath.startsWith(`${prefix}/`)) {
    throw new WorkspaceError(`Path de asset deve ficar em ${prefix}/.`, 422);
  }
}

function assertUniqueAssetPath(flow: AgentFlow, assetPath: string): void {
  const existing = [...flow.prompts, ...flow.schemas].find((asset) => normalizeAssetPath(asset.path) === assetPath);
  if (existing) {
    throw new WorkspaceError(`Já existe asset usando o path ${assetPath}.`, 409);
  }
}

async function removeAssetFileIfUnreferenced(flowRoot: string, flow: AgentFlow, assetPath: string): Promise<void> {
  const normalized = normalizeAssetPath(assetPath);
  const stillReferenced = [...flow.prompts, ...flow.schemas].some((asset) => normalizeAssetPath(asset.path) === normalized);
  if (!stillReferenced) {
    await rm(safeResolveFlowAsset(flowRoot, normalized), { force: true });
  }
}

async function readReferencedAsset(flowRoot: string, assetPath: string, label: string): Promise<string> {
  try {
    return await readFile(safeResolveFlowAsset(flowRoot, assetPath), "utf-8");
  } catch (error) {
    if (error instanceof WorkspaceError) {
      throw error;
    }
    throw new WorkspaceError(`Asset referenciado não encontrado: ${label} (${assetPath}).`, 422, error);
  }
}

async function writeImportedAsset(flowRoot: string, assetPath: string, content: string): Promise<void> {
  const absolutePath = safeResolveFlowAsset(flowRoot, assetPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf-8");
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

interface CreateFlowInput {
  id: string;
  name: string;
  resourceName: string;
}

function parseCreateFlowInput(value: unknown): CreateFlowInput {
  if (!isRecord(value)) {
    throw new WorkspaceError("Novo flow deve ser um objeto JSON.", 400);
  }
  const id = parseAssetId(value.id, "id do flow");
  assertImportableFlowId(id);
  const name = typeof value.name === "string" && value.name.trim() ? value.name.trim() : titleFromId(id);
  const resourceName =
    typeof value.resourceName === "string" && value.resourceName.trim() ? value.resourceName.trim() : "sessions";
  if (!/^[A-Za-z0-9_-]+$/.test(resourceName)) {
    throw new WorkspaceError("resourceName deve usar letras, números, _ ou -.", 422);
  }
  return { id, name, resourceName };
}

function titleFromId(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function starterFlow(input: CreateFlowInput): AgentFlow {
  return {
    id: input.id,
    name: input.name,
    version: "0.1.0",
    runtime: "langgraph-python",
    api: {
      contract: "sessions-v1",
      resourceName: input.resourceName,
      autoStartOnCreate: false,
    },
    persistence: {
      checkpointer: "postgres",
      publicStore: "postgres",
      cache: "redis",
    },
    llm: {
      adapter: "openai",
      model: "gpt-4.1-mini",
      apiKeyEnv: "OPENAI_API_KEY",
      baseUrlEnv: "OPENAI_BASE_URL",
      mockEnv: "MOCK_LLM",
    },
    state: {
      schemaRef: "session_state",
    },
    prompts: [
      {
        id: "system",
        path: "prompts/system.md",
        version: "v1",
        variables: ["session_id", "turn", "max_turns", "user_message", "recent_messages"],
      },
    ],
    schemas: [
      {
        id: "session_state",
        path: "schemas/session_state.schema.json",
      },
    ],
    nodes: [
      {
        id: "start_node",
        type: "start",
        description: "Emite a primeira mensagem do agente.",
        position: { x: 230, y: 300 },
      },
      {
        id: "input_safety_check",
        type: "safety_gate",
        stage: "input",
        position: { x: 460, y: 140 },
      },
      {
        id: "turn_router",
        type: "switch",
        description: "Roteia o turno conforme status e limite.",
        position: { x: 690, y: 300 },
      },
      {
        id: "llm_step",
        type: "llm_prompt",
        promptId: "system",
        llm: {
          adapter: "openai",
          model: "gpt-4.1-mini",
        },
        position: { x: 920, y: 140 },
      },
      {
        id: "output_safety_check",
        type: "safety_gate",
        stage: "output",
        position: { x: 1150, y: 300 },
      },
      {
        id: "wait_user_input",
        type: "human_input",
        description: "Pausa lógica para o próximo turno do consumidor.",
        position: { x: 1380, y: 140 },
      },
      {
        id: "deterministic_gate",
        type: "code",
        handler: "deterministic_gate",
        position: { x: 1610, y: 300 },
      },
      {
        id: "finish_node",
        type: "end",
        description: "Finaliza a sessão manualmente ou por limite.",
        position: { x: 1840, y: 140 },
      },
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
      { from: "llm_step", to: "output_safety_check" },
      { from: "output_safety_check", to: "wait_user_input" },
      { from: "wait_user_input", to: "deterministic_gate" },
      { from: "deterministic_gate", to: "end" },
      { from: "finish_node", to: "end" },
    ],
  };
}

function starterPrompt(name: string): string {
  return `# ${name}

Você é um agente de IA orientado a fluxo e consumido por API.

Responda em português brasileiro, de forma objetiva, usando o contexto recebido no payload do turno.

Mantenha a resposta adequada para continuidade da sessão. A lógica de avanço, repetição e encerramento é responsabilidade dos nós determinísticos do runtime.
`;
}

function starterStateSchema(name: string) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: `${name} State`,
    type: "object",
    properties: {
      session_id: { type: "string" },
      turn: { type: "integer", minimum: 0 },
      max_turns: { type: "integer", minimum: 1 },
      user_message: { type: "string" },
      assistant_message: { type: "object" },
      safety: { type: "object" },
      llm: { type: "object" },
      executed_nodes: {
        type: "array",
        items: { type: "string" },
      },
    },
  };
}

function parseFlowWorkspaceExport(value: unknown): FlowWorkspaceExport {
  if (!isRecord(value)) {
    throw new WorkspaceError("Pacote de flow deve ser um objeto JSON.", 422);
  }
  if (value.format !== FLOW_WORKSPACE_EXPORT_FORMAT) {
    throw new WorkspaceError(`Formato de pacote inválido: ${String(value.format)}`, 422);
  }
  const flow = parseAgentFlow(value.flow);
  const prompts = parseAssetList(value.prompts, "prompts");
  const schemas = parseAssetList(value.schemas, "schemas");
  return {
    format: FLOW_WORKSPACE_EXPORT_FORMAT,
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : new Date().toISOString(),
    source: isRecord(value.source) && typeof value.source.flowId === "string" && typeof value.source.flowPath === "string"
      ? { flowId: value.source.flowId, flowPath: value.source.flowPath }
      : { flowId: flow.id, flowPath: `flows/${flow.id}/agent.flow.json` },
    flow,
    prompts,
    schemas,
  };
}

function parseAssetList(value: unknown, field: string): FlowAssetContent[] {
  if (!Array.isArray(value)) {
    throw new WorkspaceError(`${field} deve ser uma lista.`, 422);
  }
  return value.map((item, index) => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.path !== "string" || typeof item.content !== "string") {
      throw new WorkspaceError(`${field}[${index}] deve conter id, path e content como strings.`, 422);
    }
    return {
      id: item.id,
      path: item.path,
      content: item.content,
    };
  });
}

function assetsForRefs<T extends { id: string; path: string }>(
  refs: T[],
  assets: FlowAssetContent[],
  kind: string,
): FlowAssetContent[] {
  const byId = new Map<string, FlowAssetContent>();
  for (const asset of assets) {
    if (byId.has(asset.id)) {
      throw new WorkspaceError(`Asset duplicado no pacote: ${kind} ${asset.id}.`, 422);
    }
    byId.set(asset.id, asset);
  }
  return refs.map((ref) => {
    const asset = byId.get(ref.id);
    if (!asset) {
      throw new WorkspaceError(`Pacote não contém ${kind} referenciado: ${ref.id}.`, 422);
    }
    if (asset.path !== ref.path) {
      throw new WorkspaceError(
        `Path do ${kind} ${ref.id} diverge do flow: pacote=${asset.path}, flow=${ref.path}.`,
        422,
      );
    }
    return asset;
  });
}

function assertNoPathContentConflicts(assets: FlowAssetContent[]): void {
  const byPath = new Map<string, string>();
  for (const asset of assets) {
    const existing = byPath.get(asset.path);
    if (existing !== undefined && existing !== asset.content) {
      throw new WorkspaceError(`Assets importados usam o mesmo path com conteúdos diferentes: ${asset.path}.`, 422);
    }
    byPath.set(asset.path, asset.content);
  }
}

function assertNoReservedAssetPaths(assets: FlowAssetContent[]): void {
  for (const asset of assets) {
    const normalized = asset.path.replaceAll("\\", "/").replace(/^\.\/+/, "");
    if (normalized === "agent.flow.json") {
      throw new WorkspaceError("Assets importados não podem sobrescrever agent.flow.json.", 422);
    }
  }
}

function assertImportableFlowId(flowId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(flowId)) {
    throw new WorkspaceError("ID de flow importado deve usar letras, números, _ ou -.", 422);
  }
}

async function resolveGeneratedArtifactRoot(
  workspaceRoot: string,
  outDir: string,
): Promise<{ absoluteOutDir: string; relativeOutDir: string }> {
  const requestedOutDir = outDir.trim();
  if (!requestedOutDir) {
    throw new WorkspaceError("outDir do artefato gerado é obrigatório.", 400);
  }
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const absoluteOutDir = safeResolve(root, requestedOutDir);
  const relativeOutDir = toWorkspaceRelative(root, absoluteOutDir);
  if (relativeOutDir !== "generated" && !relativeOutDir.startsWith("generated/")) {
    throw new WorkspaceError("Artefatos gerados só podem ser lidos dentro de generated/.", 400);
  }

  let outDirStat;
  try {
    outDirStat = await stat(absoluteOutDir);
  } catch (error) {
    throw new WorkspaceError(`Diretório gerado não encontrado: ${relativeOutDir}`, 404, error);
  }
  if (!outDirStat.isDirectory()) {
    throw new WorkspaceError(`outDir do artefato não é diretório: ${relativeOutDir}`, 400);
  }
  return { absoluteOutDir, relativeOutDir };
}

async function collectGeneratedArtifactFiles(
  artifactRoot: string,
  currentDir = "",
  result: GeneratedArtifactFileSummary[] = [],
): Promise<GeneratedArtifactFileSummary[]> {
  if (result.length > GENERATED_ARTIFACT_MAX_FILES) {
    throw new WorkspaceError(`Artefato gerado excede ${GENERATED_ARTIFACT_MAX_FILES} arquivos.`, 422);
  }

  const absoluteDir = path.join(artifactRoot, currentDir);
  const entries = (await readdir(absoluteDir, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    const relativePath = currentDir ? `${currentDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!GENERATED_ARTIFACT_IGNORED_DIRS.has(entry.name)) {
        await collectGeneratedArtifactFiles(artifactRoot, relativePath, result);
      }
      continue;
    }
    if (
      !entry.isFile() ||
      GENERATED_ARTIFACT_IGNORED_FILES.has(entry.name) ||
      GENERATED_ARTIFACT_IGNORED_EXTENSIONS.has(path.extname(entry.name))
    ) {
      continue;
    }
    const fileStat = await stat(path.join(artifactRoot, relativePath));
    result.push({
      path: relativePath.replaceAll(path.sep, "/"),
      sizeBytes: fileStat.size,
    });
  }
  return result;
}

function normalizeArtifactRelativePath(filePath: string): string {
  const normalized = filePath.trim().replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (!normalized) {
    throw new WorkspaceError("path do arquivo gerado é obrigatório.", 400);
  }
  if (normalized.includes("\0") || path.isAbsolute(normalized) || normalized.split("/").includes("..")) {
    throw new WorkspaceError(`Path de arquivo gerado inválido: ${filePath}`, 400);
  }
  return normalized;
}

function safeResolveArtifactFile(artifactRoot: string, filePath: string): string {
  const root = path.resolve(artifactRoot);
  const resolved = path.resolve(root, filePath);
  const relativePath = path.relative(root, resolved);
  if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new WorkspaceError(`Arquivo fora do artefato gerado: ${filePath}`, 400);
  }
  return resolved;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "runtime-artifact";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ZipArchiveFile {
  path: string;
  content: Buffer;
}

function writeZipArchive(files: ZipArchiveFile[]): Buffer {
  const chunks: Buffer[] = [];
  const centralDirectory: Buffer[] = [];
  let offset = 0;
  const timestamp = dosDateTime(new Date());

  for (const file of files) {
    const fileName = Buffer.from(file.path.replaceAll("\\", "/"), "utf-8");
    const checksum = crc32(file.content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(timestamp.time, 10);
    localHeader.writeUInt16LE(timestamp.date, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(file.content.byteLength, 18);
    localHeader.writeUInt32LE(file.content.byteLength, 22);
    localHeader.writeUInt16LE(fileName.byteLength, 26);
    localHeader.writeUInt16LE(0, 28);
    chunks.push(localHeader, fileName, file.content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(timestamp.time, 12);
    centralHeader.writeUInt16LE(timestamp.date, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(file.content.byteLength, 20);
    centralHeader.writeUInt32LE(file.content.byteLength, 24);
    centralHeader.writeUInt16LE(fileName.byteLength, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralDirectory.push(centralHeader, fileName);

    offset += localHeader.byteLength + fileName.byteLength + file.content.byteLength;
  }

  const centralDirectoryOffset = offset;
  const centralDirectoryBuffer = Buffer.concat(centralDirectory);
  chunks.push(centralDirectoryBuffer);
  offset += centralDirectoryBuffer.byteLength;

  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(files.length, 8);
  endRecord.writeUInt16LE(files.length, 10);
  endRecord.writeUInt32LE(centralDirectoryBuffer.byteLength, 12);
  endRecord.writeUInt32LE(centralDirectoryOffset, 16);
  endRecord.writeUInt16LE(0, 20);
  chunks.push(endRecord);
  return Buffer.concat(chunks, offset + endRecord.byteLength);
}

function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const CRC32_TABLE = createCrc32Table();

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function resolveManifestAgents(workspaceRoot: string, manifest: RuntimeManifest): Promise<ManifestAgentRuntime[]> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const agents: ManifestAgentRuntime[] = [];
  for (const agent of manifest.agents) {
    const loaded = await loadFlowByPath(root, agent.flowPath);
    if (loaded.flow.id !== agent.id) {
      throw new WorkspaceError(
        `Manifesto referencia agente ${agent.id}, mas o flow ${agent.flowPath} tem id ${loaded.flow.id}.`,
        422,
      );
    }
    agents.push({
      id: agent.id,
      routePrefix: agent.routePrefix,
      flow: loaded.flow,
      flowRoot: loaded.flowRoot,
    });
  }
  return agents;
}

export async function generateRuntime(
  workspaceRoot: string,
  flowId: string,
  requestedOutDir?: string,
): Promise<GenerateResult> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const loaded = await loadFlowById(root, flowId);
  const outDir = requestedOutDir?.trim() || `generated/${loaded.flow.id}-runtime`;
  const absoluteOutDir = safeResolve(root, outDir);
  await mkdir(path.dirname(absoluteOutDir), { recursive: true });
  await generateLangGraphRuntime({
    flow: loaded.flow,
    flowRoot: loaded.flowRoot,
    outDir: absoluteOutDir,
  });
  return {
    flowId: loaded.flow.id,
    flowPath: loaded.relativePath,
    outDir: toWorkspaceRelative(root, absoluteOutDir),
    absoluteOutDir,
  };
}

export async function generateLangGraphSandboxArtifact(
  workspaceRoot: string,
  flowId: string,
  requestedOutDir?: string,
): Promise<GenerateResult> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const loaded = await loadFlowById(root, flowId);
  const outDir = requestedOutDir?.trim() || `generated/${loaded.flow.id}-langgraph-sandbox`;
  const absoluteOutDir = safeResolve(root, outDir);
  await mkdir(path.dirname(absoluteOutDir), { recursive: true });
  await generateLangGraphSandbox({
    flow: loaded.flow,
    flowRoot: loaded.flowRoot,
    outDir: absoluteOutDir,
  });
  return {
    flowId: loaded.flow.id,
    flowPath: loaded.relativePath,
    outDir: toWorkspaceRelative(root, absoluteOutDir),
    absoluteOutDir,
  };
}

export async function approveLangGraphSandbox(
  workspaceRoot: string,
  flowId: string,
  requestedOutDir?: string,
): Promise<LangGraphSandboxApproval> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const loaded = await loadFlowById(root, flowId);
  const outDir = requestedOutDir?.trim() || `generated/${loaded.flow.id}-langgraph-sandbox`;
  const absoluteOutDir = safeResolve(root, outDir);
  const metadata = await readGeneratedProjectMetadata(absoluteOutDir);
  const expectedHash = await flowProjectFingerprint(loaded.flow, loaded.flowRoot);

  if (metadata.target !== "langgraph-sandbox") {
    throw new WorkspaceError("O artefato informado não é um pacote LangGraph sandbox.", 409, metadata);
  }
  if (metadata.flowId !== loaded.flow.id || metadata.flowVersion !== loaded.flow.version || metadata.flowHash !== expectedHash) {
    throw new WorkspaceError(
      "O pacote LangGraph sandbox não corresponde ao flow atual. Gere e teste o sandbox novamente antes de aprovar.",
      409,
      {
        current: { flowId: loaded.flow.id, flowVersion: loaded.flow.version, flowHash: expectedHash },
        sandbox: metadata,
      },
    );
  }

  const approvalDir = path.join(loaded.flowRoot, ".agent-flow");
  await mkdir(approvalDir, { recursive: true });
  const approvalPath = path.join(approvalDir, "langgraph-sandbox-approval.json");
  const approval: LangGraphSandboxApproval = {
    status: "approved",
    flowId: loaded.flow.id,
    flowVersion: loaded.flow.version,
    flowHash: expectedHash,
    sandboxOutDir: toWorkspaceRelative(root, absoluteOutDir),
    approvedFor: "fastapi-runtime",
    approvalPath: toWorkspaceRelative(root, approvalPath),
    approvedAt: new Date().toISOString(),
  };
  await writeFile(approvalPath, `${JSON.stringify(approval, null, 2)}\n`, "utf-8");
  return approval;
}

export async function readLangGraphSandboxApprovalStatus(
  workspaceRoot: string,
  flowId: string,
): Promise<LangGraphSandboxApprovalStatus> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const loaded = await loadFlowById(root, flowId);
  const approvalPath = path.join(loaded.flowRoot, ".agent-flow", "langgraph-sandbox-approval.json");
  const expectedHash = await flowProjectFingerprint(loaded.flow, loaded.flowRoot);
  const base: Omit<LangGraphSandboxApprovalStatus, "status" | "reason" | "details"> = {
    flowId: loaded.flow.id,
    flowVersion: loaded.flow.version,
    flowHash: expectedHash,
    approvalPath: toWorkspaceRelative(root, approvalPath),
  };

  let rawApproval: unknown;
  try {
    rawApproval = JSON.parse(await readFile(approvalPath, "utf-8"));
  } catch (error) {
    return {
      ...base,
      status: "missing",
      reason: "Não há aprovação de sandbox registrada para este flow.",
      details: error instanceof Error ? error.message : error,
    };
  }

  const approval = parseLangGraphSandboxApproval(rawApproval);
  if (!approval) {
    return {
      ...base,
      status: "invalid",
      reason: "Arquivo de aprovação inválido ou inconsistente.",
      details: rawApproval,
    };
  }

  if (
    approval.status !== "approved" ||
    approval.flowId !== loaded.flow.id ||
    approval.flowVersion !== loaded.flow.version ||
    approval.flowHash !== expectedHash
  ) {
    return {
      ...base,
      ...approval,
      status: "outdated",
      reason: "Aprovação existente não corresponde ao flow atual.",
      details: {
        approval,
        expected: {
          flowId: loaded.flow.id,
          flowVersion: loaded.flow.version,
          flowHash: expectedHash,
        },
      },
    };
  }

  let sandboxMetadata: GeneratedProjectMetadata;
  try {
    const sandboxOutDir = safeResolve(root, approval.sandboxOutDir);
    sandboxMetadata = await readGeneratedProjectMetadata(sandboxOutDir);
    if (sandboxMetadata.target !== "langgraph-sandbox" || sandboxMetadata.flowHash !== expectedHash) {
      return {
        ...base,
        ...approval,
        status: "outdated",
        reason: "O sandbox aprovado não corresponde ao flow atual.",
        details: sandboxMetadata,
      };
    }
  } catch (error) {
    return {
      ...base,
      ...approval,
      status: "outdated",
      reason: "Arquivo de metadados do sandbox não encontrado ou inválido.",
      details: error instanceof Error ? error.message : error,
    };
  }

  return {
    ...approval,
    status: "approved",
    reason: "Sandbox aprovado para geração da API Docker.",
    details: undefined,
  };
}

export async function generateApprovedRuntime(
  workspaceRoot: string,
  flowId: string,
  requestedOutDir?: string,
): Promise<ApprovedGenerateResult> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const loaded = await loadFlowById(root, flowId);
  const status = await readLangGraphSandboxApprovalStatus(root, flowId);
  if (status.status !== "approved") {
    throw approvalStatusToWorkspaceError(status);
  }
  const approval = status as LangGraphSandboxApproval;
  const result = await generateRuntime(root, flowId, requestedOutDir);
  await writeFile(
    path.join(result.absoluteOutDir, ".agent-flow", "langgraph-sandbox-approval.json"),
    `${JSON.stringify(approval, null, 2)}\n`,
    "utf-8",
  );
  return { ...result, approval };
}

export async function generateRuntimeManifest(
  workspaceRoot: string,
  requestedOutDir?: string,
): Promise<GenerateManifestResult> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const loaded = await loadRuntimeManifest(root);
  const agents = await resolveManifestAgents(root, loaded.manifest);
  const outDir = requestedOutDir?.trim() || `generated/${loaded.manifest.id}-bundle`;
  const absoluteOutDir = safeResolve(root, outDir);
  await mkdir(path.dirname(absoluteOutDir), { recursive: true });
  await generateManifestRuntimeBundle({
    manifest: loaded.manifest,
    agents,
    outDir: absoluteOutDir,
  });
  return {
    manifestId: loaded.manifest.id,
    manifestPath: loaded.relativePath,
    outDir: toWorkspaceRelative(root, absoluteOutDir),
    absoluteOutDir,
    agents: loaded.manifest.agents.map((agent) => ({
      id: agent.id,
      flowPath: agent.flowPath,
      routePrefix: agent.routePrefix,
    })),
  };
}

async function readGeneratedProjectMetadata(absoluteOutDir: string): Promise<GeneratedProjectMetadata> {
  const metadataPath = path.join(absoluteOutDir, ".agent-flow", "generated-meta.json");
  let raw: string;
  try {
    raw = await readFile(metadataPath, "utf-8");
  } catch (error) {
    throw new WorkspaceError(
      "Gere o pacote LangGraph sandbox antes de aprovar essa versão do flow.",
      409,
      error instanceof Error ? error.message : error,
    );
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("metadata não é objeto");
    }
    return parsed as GeneratedProjectMetadata;
  } catch (error) {
    throw new WorkspaceError(
      "O metadado do artefato gerado não é JSON válido.",
      422,
      error instanceof Error ? error.message : error,
    );
  }
}

async function readCurrentLangGraphApproval(
  root: string,
  loaded: LoadedFlow,
): Promise<LangGraphSandboxApproval> {
  const status = await readLangGraphSandboxApprovalStatus(root, loaded.flow.id);
  if (status.status !== "approved") {
    throw approvalStatusToWorkspaceError(status);
  }
  return {
    status: "approved",
    flowId: status.flowId,
    flowVersion: status.flowVersion,
    flowHash: status.flowHash,
    sandboxOutDir: status.sandboxOutDir!,
    approvedFor: status.approvedFor ?? "fastapi-runtime",
    approvalPath: status.approvalPath,
    approvedAt: status.approvedAt ?? "",
  };
}

function parseLangGraphSandboxApproval(value: unknown): LangGraphSandboxApproval | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.status !== "approved") {
    return null;
  }
  if (typeof value.flowId !== "string" || typeof value.flowVersion !== "string" || typeof value.flowHash !== "string") {
    return null;
  }
  if (typeof value.sandboxOutDir !== "string" || typeof value.approvalPath !== "string") {
    return null;
  }
  if (typeof value.approvedFor !== "string" || value.approvedFor !== "fastapi-runtime") {
    return null;
  }
  if (typeof value.approvedAt !== "string") {
    return null;
  }
  return {
    status: "approved",
    flowId: value.flowId,
    flowVersion: value.flowVersion,
    flowHash: value.flowHash,
    sandboxOutDir: value.sandboxOutDir,
    approvedFor: value.approvedFor,
    approvalPath: value.approvalPath,
    approvedAt: value.approvedAt,
  };
}

function approvalStatusToWorkspaceError(status: LangGraphSandboxApprovalStatus): WorkspaceError {
  if (status.status === "approved") {
    return new WorkspaceError("Aprovação LangGraph inválida para esta operação.", 409, status);
  }
  if (status.status === "missing") {
    return new WorkspaceError(
      "Aprove o sandbox LangSmith/LangGraph desta versão antes de gerar o runtime FastAPI/Docker aprovado.",
      409,
      status,
    );
  }
  if (status.status === "invalid") {
    return new WorkspaceError(
      "A aprovação LangSmith/LangGraph está inválida para esta versão. Corrija ou gere e aprove novamente.",
      409,
      status,
    );
  }
  return new WorkspaceError(
    "A aprovação LangSmith/LangGraph está desatualizada para o flow atual. Gere, teste e aprove novamente.",
    409,
    status,
  );
}
