import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  generateLangGraphRuntime,
  generateManifestRuntime as generateManifestRuntimeBundle,
  type ManifestAgentRuntime,
} from "@agent-flow-builder/codegen-langgraph";
import { type AgentFlow, parseAgentFlow, parseRuntimeManifest, type RuntimeManifest } from "@agent-flow-builder/flow-spec";

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

export interface GenerateResult {
  flowId: string;
  flowPath: string;
  outDir: string;
  absoluteOutDir: string;
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

export interface SaveFlowResult {
  flow: AgentFlow;
  flowPath: string;
}

export interface FlowAssetContent {
  id: string;
  path: string;
  content: string;
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

const FLOW_WORKSPACE_EXPORT_FORMAT = "agent-flow-builder.flow-workspace.v1";

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

export async function validateFlow(workspaceRoot: string, flowId: string) {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  return {
    status: "ok" as const,
    id: loaded.flow.id,
    name: loaded.flow.name,
    version: loaded.flow.version,
    nodes: loaded.flow.nodes.length,
    edges: loaded.flow.edges.length,
    contract: loaded.flow.api.contract,
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
      routePrefix: agent.routePrefix,
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

function safeResolveFlowAsset(flowRoot: string, assetPath: string): string {
  const root = path.resolve(flowRoot);
  const resolved = path.resolve(root, assetPath);
  const relativePath = path.relative(root, resolved);
  if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new WorkspaceError(`Asset fora do diretório do flow: ${assetPath}`, 400);
  }
  return resolved;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
