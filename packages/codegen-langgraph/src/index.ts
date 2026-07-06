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
    sharedStorage: manifestSharedStorageMetadata(),
    orchestration: manifestOrchestrationMetadata(manifest, agents),
    agentIsolation: manifestAgentIsolationMetadata(manifest, agents),
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
  await writeFile(
    path.join(outDir, ".runtime-manifest", "agent-isolation.json"),
    `${JSON.stringify(manifestAgentIsolationMetadata(manifest, agents), null, 2)}\n`,
    "utf-8",
  );
  await writeFile(
    path.join(outDir, ".runtime-manifest", "orchestration.json"),
    `${JSON.stringify(manifestOrchestrationMetadata(manifest, agents), null, 2)}\n`,
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
    sharedStorage: manifestSharedStorageMetadata(),
    orchestration: manifestOrchestrationMetadata(manifest, agents),
    agentIsolation: manifestAgentIsolationMetadata(manifest, agents),
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

function manifestOrchestrationMetadata(manifest: RuntimeManifest, agents: ManifestAgentRuntime[]) {
  const agentIds = new Set(agents.map((agent) => agent.id));
  const memoryPolicy = normalizeOrchestrationMemoryPolicy(manifest.orchestration?.memoryPolicy);
  const handoffs = (manifest.orchestration?.handoffs ?? [])
    .filter(
      (handoff) =>
        agentIds.has(handoff.fromAgentId) &&
        agentIds.has(handoff.toAgentId) &&
        handoff.fromAgentId !== handoff.toAgentId,
    )
    .map((handoff) => ({
      fromAgentId: handoff.fromAgentId,
      toAgentId: handoff.toAgentId,
      condition: handoff.condition?.trim() || "handoff definido no runtime.manifest.json",
    }));
  const entryAgentId =
    manifest.orchestration?.entryAgentId && agentIds.has(manifest.orchestration.entryAgentId)
      ? manifest.orchestration.entryAgentId
      : agents[0]?.id;

  return {
    format: "agent-flow-builder.runtime-orchestration.v1",
    manifestId: manifest.id,
    manifestVersion: manifest.version,
    mode: manifest.orchestration?.mode ?? (manifest.packaging === "multiagent" ? "router" : "sequential"),
    capabilities: {
      executableRun: true,
      debugTrace: true,
      structuredConditions: true,
      optionalJsonlMemory: true,
      persistentMemoryPolicy: true,
    },
    memoryPolicy,
    entryAgentId,
    handoffs,
    agents: agents.map((agent) => ({
      id: agent.id,
      routePrefix: agent.routePrefix,
      resourceName: agent.flow.api.resourceName,
      metadataPath: `${agent.routePrefix}/metadata`,
      sessionsPath: `${agent.routePrefix}/${agent.flow.api.resourceName}`,
    })),
    governance: {
      declarativeOnly: true,
      generatedFromManifest: true,
      excludesSecrets: true,
      excludesEnvValues: true,
      excludesRuntimePayloads: true,
    },
  };
}

function normalizeOrchestrationMemoryPolicy(policy: NonNullable<RuntimeManifest["orchestration"]>["memoryPolicy"] | undefined) {
  const defaultRedactKeys = ["api_key", "authorization", "password", "secret", "token"];
  const persistenceValues = new Set(["disabled", "optional_jsonl", "always_jsonl"]);
  const persistence = persistenceValues.has(policy?.persistence ?? "") ? policy?.persistence : "optional_jsonl";
  const positiveInt = (value: unknown, fallback: number, min: number, max: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.trunc(parsed)));
  };
  const redactKeys = (policy?.redactKeys ?? defaultRedactKeys)
    .map((key) => String(key).trim().toLowerCase())
    .filter(Boolean);
  return {
    enabled: policy?.enabled ?? true,
    persistence,
    defaultPersist: policy?.defaultPersist ?? false,
    defaultMemoryPath: policy?.defaultMemoryPath?.trim() ?? "",
    maxEntries: positiveInt(policy?.maxEntries, 64, 1, 1000),
    retentionRuns: positiveInt(policy?.retentionRuns, 50, 1, 10000),
    maxPreviewChars: positiveInt(policy?.maxPreviewChars, 500, 80, 5000),
    redactKeys: redactKeys.length ? redactKeys : defaultRedactKeys,
    includeStepOutputs: policy?.includeStepOutputs ?? true,
    includeHandoffDecisions: policy?.includeHandoffDecisions ?? true,
  };
}

function manifestAgentIsolationMetadata(manifest: RuntimeManifest, agents: ManifestAgentRuntime[]) {
  return {
    format: "agent-flow-builder.runtime-agent-isolation.v1",
    manifestId: manifest.id,
    manifestVersion: manifest.version,
    packaging: manifest.packaging,
    routeIsolation: {
      required: manifest.packaging === "multiagent",
      uniqueRoutePrefixes: true,
      prefixOwnsOpenApiSubtree: true,
      rootMetadataOnlyAt: "/metadata",
    },
    runtimeImportIsolation: {
      mode: "isolated-python-app-namespace",
      clearsModulePrefixes: ["app", "app.*"],
      restoresPreviousModules: true,
      restoresSysPath: true,
    },
    requestIsolation: {
      idempotencyNamespace: "route_prefix",
      sessionNamespace: "agent_id",
      eventNamespace: "agent_id",
      jobNamespace: "agent_id",
    },
    authIsolation: {
      scopeNamespace: "agents:<agent_id>",
      examples: [
        "agents:<agent_id>:metadata:read",
        "agents:<agent_id>:sessions:*",
        "agents:<agent_id>:jobs:*",
        "agents:<agent_id>:auth:read",
      ],
    },
    sharedStorage: manifestSharedStorageMetadata(),
    agents: agents.map((agent) => ({
      id: agent.id,
      routePrefix: agent.routePrefix,
      runtimeDir: `agents/${safeSegment(agent.id)}`,
      resourceName: agent.flow.api.resourceName,
      metadataPath: `${agent.routePrefix}/metadata`,
      sessionsPath: `${agent.routePrefix}/${agent.flow.api.resourceName}`,
      storageNamespaceField: "agent_id",
    })),
    governance: {
      excludesSecrets: true,
      excludesEnvValues: true,
      excludesRuntimePayloads: true,
      generatedFromManifest: true,
    },
  };
}

function manifestSharedStorageMetadata() {
  return {
    database: {
      scope: "bundle",
      mode: "single-database",
      env: "DATABASE_URL",
      dockerService: "postgres",
      recommendedDriver: "postgresql+psycopg2",
      tablesAreNamespacedBy: "agent_id",
    },
    checkpointer: {
      scope: "bundle",
      env: "USE_POSTGRES_CHECKPOINTER",
      dockerService: "postgres",
    },
    cache: {
      scope: "bundle",
      env: "REDIS_URL",
      dockerService: "redis",
    },
  };
}

function renderBundleReadme(manifest: RuntimeManifest, agents: ManifestAgentRuntime[]): string {
  const runtimeDescription =
    manifest.packaging === "multiagent"
      ? "Este bundle também contém um app FastAPI raiz que monta todos os agentes em um único processo, usando os `routePrefix` do manifesto."
      : "Cada subdiretório em `agents/` contém um runtime FastAPI independente gerado a partir do respectivo `agent.flow.json`.";
  const ollamaModelImageTag = `${slug(manifest.id)}-ollama-models:local`;
  const ollamaModelImageArchive = `model-distribution/${modelImageArchiveName(ollamaModelImageTag)}.tar`;
  const ollamaSection = bundleUsesOllama(manifest, agents)
    ? `
## Modelo local com Ollama

Este bundle usa pelo menos um agente com adapter Ollama. O \`docker-compose.yml\` raiz inclui serviço \`ollama\`, volume persistente \`ollama_models\`, variáveis locais de capacidade/concurrency e configura \`OLLAMA_BASE_URL=http://ollama:11434/v1\` dentro do container da API.

\`\`\`powershell
Copy-Item .env.example .env
docker compose up -d ollama
${bundleOllamaPullCommand(manifest, agents)}
docker compose up --build
\`\`\`

O profile \`model-setup\` executa serviços one-shot para baixar os modelos usados pelos agentes. Como alternativa manual, use \`docker compose exec ollama ollama pull ${bundleOllamaModel(manifest, agents)}\`.

Para criar uma imagem local com modelos já baixados:

\`\`\`powershell
docker compose -f docker-compose.yml -f docker-compose.model-image.yml build ollama
docker compose -f docker-compose.yml -f docker-compose.model-image.yml up -d ollama
\`\`\`

O build usa \`OLLAMA_MODEL_NAMES=${bundleOllamaModelNames(manifest, agents)}\` por padrão.

Para distribuir essa imagem para outra máquina sem baixar os modelos de novo, use uma tag versionada em \`OLLAMA_MODEL_IMAGE\` e salve/carregue o tar:

\`\`\`powershell
New-Item -ItemType Directory -Force model-distribution | Out-Null
docker image save -o ${ollamaModelImageArchive} ${ollamaModelImageTag}
docker image load -i ${ollamaModelImageArchive}
\`\`\`

Se \`OLLAMA_MODEL_IMAGE\` apontar para um registry privado, use \`docker image push <sua-tag-versionada>\` depois do build.

Para habilitar GPU NVIDIA em hosts compatíveis:

\`\`\`powershell
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
\`\`\`
`
    : "";
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
  const dockerRun =
    manifest.packaging === "multiagent"
      ? `
## Operação Docker Fora do Studio

O bundle raiz é removível: copie este diretório para outro workspace, ajuste \`.env\` se necessário e suba a API raiz sem abrir o Builder.

\`\`\`powershell
Copy-Item .env.example .env
docker compose up -d --build
\`\`\`

Verificações rápidas:

\`\`\`powershell
Invoke-RestMethod http://127.0.0.1:8080/health
Invoke-RestMethod http://127.0.0.1:8080/metadata
Invoke-RestMethod http://127.0.0.1:8080/openapi.json
\`\`\`

Cada agente continua exposto no próprio prefixo de rota, por exemplo \`${agents[0]?.routePrefix ?? "/agent"}/metadata\` e \`${agents[0]?.routePrefix ?? "/agent"}/${agents[0]?.flow.api.resourceName ?? "sessions"}\`.
`
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

## Storage Compartilhado

- Banco: um único \`DATABASE_URL\` no processo raiz e nos agentes montados.
- Docker: serviço \`postgres\` compartilhado por todos os agentes do bundle.
- Namespacing: tabelas persistentes carregam \`agent_id\` para separar sessões, eventos, mensagens, jobs e registros operacionais.
- Validação opcional: rode \`AGENT_FLOW_TEST_POSTGRES_URL=postgresql+psycopg2://... pytest -q -m integration\` para provar escrita de dois agentes no mesmo Postgres real.

## Isolamento Operacional Por Agente

- Contrato: \`.runtime-manifest/agent-isolation.json\` e campo \`agentIsolation\` em \`bundle.json\`.
- Rota: cada agente possui \`routePrefix\` único e só expõe metadata/sessões dentro do próprio prefixo.
- Import: o app raiz limpa temporariamente módulos \`app\`/\`app.*\` e restaura \`sys.path\` ao montar cada runtime.
- Request/storage: idempotência é namespaced por rota, e sessões/eventos/jobs são namespaced por \`agent_id\`.
- Auth: scopes por agente seguem \`agents:<agent_id>:...\`.

## Orquestração Declarativa

- Contrato: \`.runtime-manifest/orchestration.json\` e campo \`orchestration\` em \`bundle.json\`.
- Modo: \`${manifestOrchestrationMetadata(manifest, agents).mode}\`.
- Entrada: \`${manifestOrchestrationMetadata(manifest, agents).entryAgentId ?? "não definida"}\`.
- Handoffs: ${manifestOrchestrationMetadata(manifest, agents).handoffs.length} ligação(ões) declarativas entre agentes, sem payload bruto ou secrets.
- Execução inicial: \`POST /orchestration/run\` cria sessões nos agentes montados e executa \`start\`/\`turn\` seguindo entrada e handoffs do manifesto. Condições textuais continuam como anotação declarativa; condições explícitas como \`input contains: texto\`, \`output contains: texto\` e caminhos estruturados como \`output.assistant_message.code == ECHO\` controlam roteamento simples. A resposta inclui \`shared_memory\` governada com previews compactos das saídas e decisões e \`debug_trace\` com timeline step-by-step de plano, etapa, decisão de handoff e falha sanitizada para o Studio Local; para persistir esse resumo em JSONL, envie \`memory_path\`, \`persist_memory=true\` ou defina \`ORCHESTRATION_MEMORY_PATH\`.

${runtimeDescription}${localRun}${ollamaSection}
${dockerRun}
`.trimEnd() + "\n";
}

function bundleUsesOllama(manifest: RuntimeManifest, agents: ManifestAgentRuntime[]): boolean {
  if (manifest.defaultLlm?.adapter?.toLowerCase() === "ollama") {
    return true;
  }
  return agents.some((agent) => flowUsesOllama(agent.flow));
}

function flowUsesOllama(flow: AgentFlow): boolean {
  return (
    flow.llm.adapter.toLowerCase() === "ollama" ||
    flow.nodes.some((node) => typeof node.llm?.adapter === "string" && node.llm.adapter.toLowerCase() === "ollama")
  );
}

function bundleOllamaModel(manifest: RuntimeManifest, agents: ManifestAgentRuntime[]): string {
  return bundleOllamaModels(manifest, agents)[0] ?? "qwen3:8b";
}

function bundleOllamaModels(manifest: RuntimeManifest, agents: ManifestAgentRuntime[]): string[] {
  const models: string[] = [];
  const push = (model: string | undefined) => {
    const value = model?.trim() || "qwen3:8b";
    if (!models.includes(value)) {
      models.push(value);
    }
  };
  if (manifest.defaultLlm?.adapter?.toLowerCase() === "ollama") {
    push(manifest.defaultLlm.model);
  }
  for (const agent of agents) {
    for (const model of ollamaModelsForFlow(agent.flow)) {
      push(model);
    }
  }
  return models.length ? models : ["qwen3:8b"];
}

function bundleOllamaModelNames(manifest: RuntimeManifest, agents: ManifestAgentRuntime[]): string {
  return bundleOllamaModels(manifest, agents).join(" ");
}

function ollamaModelsForFlow(flow: AgentFlow): string[] {
  const models: string[] = [];
  const push = (model: string | undefined) => {
    const value = model?.trim() || "qwen3:8b";
    if (!models.includes(value)) {
      models.push(value);
    }
  };
  if (flow.llm.adapter.toLowerCase() === "ollama") {
    push(flow.llm.model);
  }
  for (const node of flow.nodes) {
    if (node.llm?.adapter?.toLowerCase() === "ollama") {
      push(node.llm.model);
    }
  }
  return models;
}

function ollamaPullServiceName(model: string, index: number): string {
  return safeSegment(`ollama-pull-${model}`) || `ollama-pull-${index + 1}`;
}

function bundleOllamaPullCommand(manifest: RuntimeManifest, agents: ManifestAgentRuntime[]): string {
  const services = bundleOllamaModels(manifest, agents).map(ollamaPullServiceName);
  return `docker compose --profile model-setup up ${services.join(" ")}`;
}

function safeSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "");
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function modelImageArchiveName(imageTag: string): string {
  return imageTag
    .trim()
    .toLowerCase()
    .replace(/:/g, ".")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "ollama-models";
}
