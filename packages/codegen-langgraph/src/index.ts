import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentFlow, RuntimeManifest } from "@agent-flow-builder/flow-spec";
import { renderPythonMultiAgentBundleFiles } from "./pythonBundleTemplates.ts";
import {
  renderPythonLangGraphSandboxFiles,
  renderPythonRuntimeFiles,
  type RuntimeFile,
} from "./pythonRuntimeTemplates.ts";

export interface GenerateOptions {
  flow: AgentFlow;
  flowRoot: string;
  outDir: string;
}

type GeneratedProjectTarget = "fastapi-runtime" | "langgraph-sandbox";

export async function generateLangGraphRuntime(options: GenerateOptions): Promise<void> {
  const { flow, flowRoot, outDir } = options;
  await generatePythonAgentProject({ flow, flowRoot, outDir, target: "fastapi-runtime", files: renderPythonRuntimeFiles(flow) });
}

export async function generateLangGraphSandbox(options: GenerateOptions): Promise<void> {
  const { flow, flowRoot, outDir } = options;
  await generatePythonAgentProject({
    flow,
    flowRoot,
    outDir,
    target: "langgraph-sandbox",
    files: renderPythonLangGraphSandboxFiles(flow),
  });
}

async function generatePythonAgentProject(options: GenerateOptions & { target: GeneratedProjectTarget; files: RuntimeFile[] }): Promise<void> {
  const { flow, flowRoot, outDir, target, files } = options;
  await rm(outDir, { force: true, recursive: true });
  await mkdir(path.join(outDir, "app", "prompts"), { recursive: true });
  await mkdir(path.join(outDir, "app", "schemas"), { recursive: true });
  await mkdir(path.join(outDir, "app", "files"), { recursive: true });
  await mkdir(path.join(outDir, "app", "code"), { recursive: true });
  await mkdir(path.join(outDir, ".agent-flow"), { recursive: true });

  await writeFile(
    path.join(outDir, ".agent-flow", "agent.flow.json"),
    `${JSON.stringify(flow, null, 2)}\n`,
    "utf-8",
  );
  await writeFile(
    path.join(outDir, ".agent-flow", "generated-meta.json"),
    `${JSON.stringify(await generatedProjectMetadata(flow, flowRoot, target), null, 2)}\n`,
    "utf-8",
  );

  for (const prompt of flow.prompts) {
    const content = await readFile(path.join(flowRoot, prompt.path), "utf-8");
    await writeFile(path.join(outDir, "app", "prompts", path.basename(prompt.path)), content, "utf-8");
  }

  for (const schema of flow.schemas) {
    const content = await readFile(path.join(flowRoot, schema.path), "utf-8");
    await writeFile(path.join(outDir, "app", "schemas", path.basename(schema.path)), content, "utf-8");
  }

  const filesRoot = path.join(flowRoot, "files");
  if (await pathExists(filesRoot)) {
    await cp(filesRoot, path.join(outDir, "app", "files"), { recursive: true, force: true });
  }

  for (const codePath of codeAssetPaths(flow)) {
    const source = path.join(flowRoot, codePath);
    const target = path.join(outDir, "app", "code", codeArtifactPath(codePath));
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { force: true });
  }

  for (const file of files) {
    const target = path.join(outDir, file.relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf-8");
  }
}

export function flowFingerprint(flow: AgentFlow): string {
  return createHash("sha256").update(stableJson(flow)).digest("hex");
}

export async function flowProjectFingerprint(flow: AgentFlow, flowRoot: string): Promise<string> {
  return createHash("sha256").update(stableJson({ flow, assets: await fingerprintAssets(flow, flowRoot) })).digest("hex");
}

async function generatedProjectMetadata(flow: AgentFlow, flowRoot: string, target: GeneratedProjectTarget) {
  return {
    target,
    flowId: flow.id,
    flowVersion: flow.version,
    flowHash: await flowProjectFingerprint(flow, flowRoot),
  };
}

async function generatedManifestBundleMetadata(manifest: RuntimeManifest, agents: ManifestAgentRuntime[]) {
  return {
    target: "runtime-manifest-bundle",
    manifestId: manifest.id,
    manifestName: manifest.name,
    manifestVersion: manifest.version,
    packaging: manifest.packaging,
    manifestHash: createHash("sha256").update(stableJson(manifest)).digest("hex"),
    agents: await Promise.all(
      agents.map(async (agent) => ({
        id: agent.id,
        flowId: agent.flow.id,
        flowName: agent.flow.name,
        flowVersion: agent.flow.version,
        flowHash: await flowProjectFingerprint(agent.flow, agent.flowRoot),
        routePrefix: agent.routePrefix,
        runtimeDir: `agents/${safeSegment(agent.id)}`,
        resourceName: agent.flow.api.resourceName,
        contract: agent.flow.api.contract,
      })),
    ),
  };
}

interface FingerprintAsset {
  kind: "prompt" | "schema" | "file" | "code";
  path: string;
  sha256: string;
}

async function fingerprintAssets(flow: AgentFlow, flowRoot: string): Promise<FingerprintAsset[]> {
  const assets: FingerprintAsset[] = [];
  for (const prompt of flow.prompts) {
    assets.push(await fingerprintAsset(flowRoot, "prompt", prompt.path));
  }
  for (const schema of flow.schemas) {
    assets.push(await fingerprintAsset(flowRoot, "schema", schema.path));
  }
  const filesRoot = path.join(flowRoot, "files");
  if (await pathExists(filesRoot)) {
    for (const relativePath of await listRelativeFiles(filesRoot)) {
      assets.push(await fingerprintAsset(filesRoot, "file", relativePath));
    }
  }
  for (const codePath of codeAssetPaths(flow)) {
    assets.push(await fingerprintAsset(flowRoot, "code", codePath));
  }
  return assets.sort((left, right) => `${left.kind}:${left.path}`.localeCompare(`${right.kind}:${right.path}`));
}

async function fingerprintAsset(root: string, kind: FingerprintAsset["kind"], relativePath: string): Promise<FingerprintAsset> {
  const content = await readFile(path.join(root, relativePath));
  return {
    kind,
    path: relativePath.replaceAll(path.sep, "/"),
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

async function listRelativeFiles(root: string, current = ""): Promise<string[]> {
  const absoluteCurrent = path.join(root, current);
  const entries = await readdir(absoluteCurrent, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = path.join(current, entry.name);
    const absolutePath = path.join(root, relativePath);
    if (entry.isDirectory()) {
      files.push(...(await listRelativeFiles(root, relativePath)));
    } else if (entry.isFile() || (await stat(absolutePath)).isFile()) {
      files.push(relativePath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function codeAssetPaths(flow: AgentFlow): string[] {
  return Array.from(
    new Set(
      flow.nodes
        .filter((node) => node.type === "code" && typeof node.codePath === "string" && node.codePath.trim())
        .map((node) => normalizeRelativeCodePath(String(node.codePath))),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function normalizeRelativeCodePath(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length || path.isAbsolute(normalized) || parts.includes("..")) {
    throw new Error(`codePath inválido: ${value}`);
  }
  return parts.join("/");
}

function codeArtifactPath(value: string): string {
  const normalized = normalizeRelativeCodePath(value);
  return normalized.startsWith("code/") ? normalized.slice("code/".length) : normalized;
}

export interface ManifestAgentRuntime {
  id: string;
  routePrefix: string;
  flow: AgentFlow;
  flowRoot: string;
}

export interface GenerateManifestOptions {
  manifest: RuntimeManifest;
  agents: ManifestAgentRuntime[];
  outDir: string;
}

export async function generateManifestRuntime(options: GenerateManifestOptions): Promise<void> {
  const { manifest, agents, outDir } = options;
  await rm(outDir, { force: true, recursive: true });
  await mkdir(path.join(outDir, ".agent-flow"), { recursive: true });
  await mkdir(path.join(outDir, ".runtime-manifest"), { recursive: true });
  await mkdir(path.join(outDir, "agents"), { recursive: true });

  await writeFile(
    path.join(outDir, ".agent-flow", "generated-meta.json"),
    `${JSON.stringify(await generatedManifestBundleMetadata(manifest, agents), null, 2)}\n`,
    "utf-8",
  );
  await writeFile(
    path.join(outDir, ".runtime-manifest", "runtime.manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf-8",
  );
  await writeFile(path.join(outDir, "bundle.json"), `${JSON.stringify(bundleMetadata(manifest, agents), null, 2)}\n`, "utf-8");
  await writeFile(path.join(outDir, "README.md"), renderBundleReadme(manifest, agents), "utf-8");

  for (const agent of agents) {
    await generateLangGraphRuntime({
      flow: agent.flow,
      flowRoot: agent.flowRoot,
      outDir: path.join(outDir, "agents", safeSegment(agent.id)),
    });
  }

  if (manifest.packaging === "multiagent") {
    for (const file of renderPythonMultiAgentBundleFiles(manifest, agents)) {
      const target = path.join(outDir, file.relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.content, "utf-8");
    }
  }
}

function bundleMetadata(manifest: RuntimeManifest, agents: ManifestAgentRuntime[]) {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    packaging: manifest.packaging,
    generatedKind: "runtime-bundle",
    agents: agents.map((agent) => ({
      id: agent.id,
      flowId: agent.flow.id,
      flowName: agent.flow.name,
      routePrefix: agent.routePrefix,
      runtimeDir: `agents/${safeSegment(agent.id)}`,
      resourceName: agent.flow.api.resourceName,
    })),
  };
}

function renderBundleReadme(manifest: RuntimeManifest, agents: ManifestAgentRuntime[]): string {
  const runtimeDescription =
    manifest.packaging === "multiagent"
      ? "Este bundle também contém um app FastAPI raiz que monta todos os agentes em um único processo, usando os `routePrefix` do manifesto."
      : "Cada subdiretório em `agents/` contém um runtime FastAPI independente gerado a partir do respectivo `agent.flow.json`.";
  const localRun =
    manifest.packaging === "multiagent"
      ? `
## Execução do bundle compartilhado

\`\`\`powershell
python -m pip install -e ".[dev]"
pytest -q
uvicorn app.main:app --reload --port 8080
\`\`\``
      : "";

  return `# ${manifest.name}

Bundle gerado a partir de \`runtime.manifest.json\`.

## Empacotamento

- ID: \`${manifest.id}\`
- Versão: \`${manifest.version}\`
- Modo: \`${manifest.packaging}\`

## Agentes

${agents
  .map(
    (agent) =>
      `- \`${agent.id}\`: \`${agent.flow.id}\`, rota \`${agent.routePrefix || "/"}\`, runtime \`agents/${safeSegment(agent.id)}\``,
  )
  .join("\n")}

${runtimeDescription}${localRun}
`;
}

function safeSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "");
}
