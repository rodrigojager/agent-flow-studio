import { access, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateLangGraphRuntime } from "@agent-flow-builder/codegen-langgraph";
import { type AgentFlow, parseAgentFlow } from "@agent-flow-builder/flow-spec";

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

export interface GenerateResult {
  flowId: string;
  flowPath: string;
  outDir: string;
  absoluteOutDir: string;
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

function safeResolveFlowAsset(flowRoot: string, assetPath: string): string {
  const root = path.resolve(flowRoot);
  const resolved = path.resolve(root, assetPath);
  const relativePath = path.relative(root, resolved);
  if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new WorkspaceError(`Asset fora do diretório do flow: ${assetPath}`, 400);
  }
  return resolved;
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
