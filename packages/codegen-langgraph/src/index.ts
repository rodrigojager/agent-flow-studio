import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentFlow, RuntimeManifest } from "@agent-flow-builder/flow-spec";
import { renderPythonRuntimeFiles } from "./pythonRuntimeTemplates.ts";

export interface GenerateOptions {
  flow: AgentFlow;
  flowRoot: string;
  outDir: string;
}

export async function generateLangGraphRuntime(options: GenerateOptions): Promise<void> {
  const { flow, flowRoot, outDir } = options;
  await rm(outDir, { force: true, recursive: true });
  await mkdir(path.join(outDir, "app", "prompts"), { recursive: true });
  await mkdir(path.join(outDir, "app", "schemas"), { recursive: true });
  await mkdir(path.join(outDir, ".agent-flow"), { recursive: true });

  await writeFile(
    path.join(outDir, ".agent-flow", "agent.flow.json"),
    `${JSON.stringify(flow, null, 2)}\n`,
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

  for (const file of renderPythonRuntimeFiles(flow)) {
    const target = path.join(outDir, file.relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf-8");
  }
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
  await mkdir(path.join(outDir, ".runtime-manifest"), { recursive: true });
  await mkdir(path.join(outDir, "agents"), { recursive: true });

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

Cada subdiretório em \`agents/\` contém um runtime FastAPI independente gerado a partir do respectivo \`agent.flow.json\`. O próximo passo do suporte multiagente é compor esses agentes em um único processo FastAPI compartilhado quando \`packaging\` for \`multiagent\`.
`;
}

function safeSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "");
}
