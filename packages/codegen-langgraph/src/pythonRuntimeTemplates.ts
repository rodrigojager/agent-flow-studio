import { findLlmAdapter, isSupportedLlmAdapter, llmAdapterCatalog, type AgentFlow } from "@agent-flow-builder/flow-spec";

export interface RuntimeFile {
  relativePath: string;
  content: string;
}

type FlowNode = AgentFlow["nodes"][number];
type FlowEdge = AgentFlow["edges"][number];

interface RuntimeNodeConfig {
  id: string;
  type: string;
  stage?: string;
  safetyMode?: string;
  safetySeverityThreshold?: string;
  safetyFallbackResponse?: string;
  safetyRules?: unknown[];
  handler?: string;
  codeLanguage?: string;
  codeExecution?: string;
  codePath?: string;
  codeInline?: string;
  codeEntry?: string;
  codeDependencies?: string;
  mcpCommand?: string;
  mcpArgs?: string[];
  mcpToolName?: string;
  mcpProtocolVersion?: string;
  sidecarCommand?: string;
  sidecarArgs?: string[];
  sandboxIsolation?: string;
  sandboxEnvAllowlist?: string[];
  sandboxContainerImage?: string;
  sandboxContainerEngine?: string;
  sandboxContainerProfile?: string;
  sandboxContainerMemory?: string;
  sandboxContainerCpus?: string;
  sandboxContainerPidsLimit?: number;
  sandboxContainerReadOnlyRootfs?: boolean;
  sandboxContainerDropCapabilities?: boolean;
  sandboxContainerNoNewPrivileges?: boolean;
  sandboxVmImageId?: string;
  sandboxVmRunner?: string;
  sandboxVmArgs?: string[];
  sandboxVmRunnerManifest?: string;
  sandboxVmImage?: string;
  sandboxVmImageManifest?: string;
  sandboxVmEngine?: string;
  sandboxVmProfile?: string;
  sandboxVmMemory?: string;
  sandboxVmCpus?: string;
  retryAttempts?: number;
  payloadAllowPaths?: string[];
  redactPaths?: string[];
  maxPayloadBytes?: number;
  promptFile?: string;
  llmAdapter?: string;
  llmModel?: string;
  method?: string;
  url?: string;
  bodyPath?: string;
  responsePath?: string;
  inputPath?: string;
  outputPath?: string;
  query?: string;
  table?: string;
  dataPath?: string;
  paramsPath?: string;
  resultPath?: string;
  maxRows?: number;
  sourcePath?: string;
  contentPath?: string;
  collectionPath?: string;
  queryPath?: string;
  contextPath?: string;
  decisionPath?: string;
  approvalValue?: string;
  rejectionValue?: string;
  payloadPath?: string;
  metricName?: string;
  threshold?: number;
  topK?: number;
  chunkSize?: number;
  maxChars?: number;
  timeoutSeconds?: number;
}

interface RuntimeRouteCondition {
  key: string;
  kind:
    | "always"
    | "safety_blocked"
    | "safety_decision"
    | "status_equals"
    | "phase_equals"
    | "state_compare"
    | "all";
  value?: string | boolean | number;
  path?: string;
  operator?: "==" | "!=" | ">=" | "<=" | ">" | "<";
  rightPath?: string;
  conditions?: RuntimeRouteCondition[];
}

interface RuntimePlan {
  nodes: RuntimeNodeConfig[];
  directNodeEdges: Record<string, string>;
  nodeRouteMap: Record<string, Record<string, string>>;
  nodeRouteConditions: Record<string, RuntimeRouteCondition[]>;
  actionRoutes: Record<string, string>;
  defaultActionRoute: string;
  defaultPromptFile: string;
}

export function renderPythonRuntimeFiles(flow: AgentFlow): RuntimeFile[] {
  assertSupportedRuntime(flow);
  const plan = runtimePlan(flow);
  const serviceName = `${slug(flow.id)}-runtime`;
  return [
    { relativePath: "langgraph.json", content: renderLangGraphConfig(flow) },
    { relativePath: "pyproject.toml", content: renderPyproject(flow, serviceName) },
    { relativePath: ".env.example", content: renderEnvExample(flow, serviceName) },
    { relativePath: "Dockerfile", content: renderDockerfile() },
    { relativePath: "docker-compose.yml", content: renderDockerCompose(flow) },
    ...(flowUsesOllama(flow)
      ? [
          { relativePath: "docker-compose.gpu.yml", content: renderOllamaGpuComposeOverride() },
          { relativePath: "docker-compose.model-image.yml", content: renderOllamaModelImageComposeOverride(flow) },
          { relativePath: "ollama-models/Dockerfile", content: renderOllamaModelDockerfile() },
        ]
      : []),
    { relativePath: "README.md", content: renderReadme(flow) },
    { relativePath: "migrations/001_init.sql", content: renderMigration() },
    { relativePath: "app/__init__.py", content: "" },
    { relativePath: "app/generated_flow.py", content: renderGeneratedFlow(flow) },
    { relativePath: "app/settings.py", content: renderSettings(flow, serviceName) },
    { relativePath: "app/db.py", content: renderDb() },
    { relativePath: "app/models.py", content: renderModels() },
    { relativePath: "app/repo.py", content: renderRepo() },
    { relativePath: "app/cache.py", content: renderCache(flow) },
    { relativePath: "app/idempotency.py", content: renderIdempotency() },
    { relativePath: "app/safety.py", content: renderSafety() },
    { relativePath: "app/llm.py", content: renderLlm(flow) },
    { relativePath: "app/code_runner.mjs", content: renderCodeRunner() },
    { relativePath: "app/code/package.json", content: renderCodePackageJson(flow) },
    { relativePath: "app/graph.py", content: renderGraph(flow, plan) },
    { relativePath: "app/schemas.py", content: renderSchemas() },
    { relativePath: "app/service.py", content: renderService() },
    { relativePath: "app/worker.py", content: renderWorker() },
    { relativePath: "app/auth.py", content: renderAuth() },
    { relativePath: "app/main.py", content: renderMain(flow) },
    { relativePath: "app/langgraph_app.py", content: renderLangGraphApp() },
    { relativePath: "tests/conftest.py", content: renderTestConftest() },
    { relativePath: "tests/test_generated_runtime.py", content: renderRuntimeTest() },
    { relativePath: "tests/test_langgraph_platform.py", content: renderLangGraphPlatformTest() },
  ];
}

export function renderPythonLangGraphSandboxFiles(flow: AgentFlow): RuntimeFile[] {
  assertSupportedRuntime(flow);
  const plan = runtimePlan(flow);
  const serviceName = `${slug(flow.id)}-langgraph-sandbox`;
  return [
    { relativePath: "langgraph.json", content: renderLangGraphConfig(flow) },
    { relativePath: "pyproject.toml", content: renderLangGraphSandboxPyproject(flow, serviceName) },
    { relativePath: ".env.example", content: renderLangGraphSandboxEnvExample(flow, serviceName) },
    { relativePath: "README.md", content: renderLangGraphSandboxReadme(flow) },
    { relativePath: "app/__init__.py", content: "" },
    { relativePath: "app/generated_flow.py", content: renderGeneratedFlow(flow) },
    { relativePath: "app/settings.py", content: renderSettings(flow, serviceName) },
    { relativePath: "app/db.py", content: renderDb() },
    { relativePath: "app/models.py", content: renderModels() },
    { relativePath: "app/safety.py", content: renderSafety() },
    { relativePath: "app/llm.py", content: renderLlm(flow) },
    { relativePath: "app/code_runner.mjs", content: renderCodeRunner() },
    { relativePath: "app/code/package.json", content: renderCodePackageJson(flow) },
    { relativePath: "app/graph.py", content: renderGraph(flow, plan) },
    { relativePath: "app/langgraph_app.py", content: renderLangGraphApp() },
    { relativePath: "tests/conftest.py", content: renderTestConftest() },
    { relativePath: "tests/test_langgraph_platform.py", content: renderLangGraphPlatformTest() },
  ];
}

function assertSupportedRuntime(flow: AgentFlow): void {
  if (flow.runtime !== "langgraph-python") {
    throw new Error(`Runtime não suportado pelo gerador: ${flow.runtime}`);
  }
  if (flow.api.contract !== "sessions-v1") {
    throw new Error(`Contrato não suportado pelo gerador: ${flow.api.contract}`);
  }
  const adapter = flow.llm.adapter.toLowerCase();
  if (!isSupportedLlmAdapter(adapter)) {
    throw new Error(`Adaptador LLM ainda não suportado pelo gerador Python: ${flow.llm.adapter}`);
  }
  for (const node of flow.nodes) {
    const nodeAdapter = node.llm?.adapter?.toLowerCase();
    if (nodeAdapter && !isSupportedLlmAdapter(nodeAdapter)) {
      throw new Error(`Adaptador LLM do nó ${node.id} ainda não suportado pelo gerador Python: ${node.llm?.adapter}`);
    }
  }
}

function runtimePlan(flow: AgentFlow): RuntimePlan {
  const defaultPrompt = flow.prompts[0];
  if (!defaultPrompt) {
    throw new Error("O gerador Python exige ao menos um prompt no flow.");
  }
  const firstNode = flow.nodes[0];
  if (!firstNode) {
    throw new Error("O gerador Python exige ao menos um nó no flow.");
  }

  const nodes = flow.nodes.map((node) => runtimeNodeConfig(flow, node, defaultPrompt.path));
  const actionRoutes: Record<string, string> = {};
  let defaultActionRoute = firstNode.id;
  for (const edge of flow.edges.filter((edge) => edge.from === "start")) {
    const action = parseActionCondition(edge.condition);
    if (action) {
      actionRoutes[action] = edge.to;
    } else if (!edge.condition) {
      defaultActionRoute = edge.to;
    } else {
      throw new Error(`Condição de entrada ainda não suportada pelo gerador Python: ${edge.condition}`);
    }
  }
  actionRoutes.start ??= flow.nodes.find((node) => node.type === "start")?.id ?? defaultActionRoute;
  actionRoutes.turn ??=
    flow.nodes.find((node) => node.type === "safety_gate" && node.stage === "input")?.id ??
    flow.nodes.find((node) => node.type === "llm_prompt" || node.type === "llm_structured")?.id ??
    defaultActionRoute;
  actionRoutes.finish ??= flow.nodes.find((node) => node.type === "end")?.id ?? "end";

  const directNodeEdges: Record<string, string> = {};
  const nodeRouteMap: Record<string, Record<string, string>> = {};
  const nodeRouteConditions: Record<string, RuntimeRouteCondition[]> = {};
  for (const node of flow.nodes) {
    const outgoing = flow.edges.filter((edge) => edge.from === node.id);
    if (outgoing.length === 0) {
      directNodeEdges[node.id] = "end";
      continue;
    }
    if (outgoing.length === 1 && !outgoing[0].condition) {
      directNodeEdges[node.id] = outgoing[0].to;
      continue;
    }
    const routeMap: Record<string, string> = {};
    const routeConditions: RuntimeRouteCondition[] = [];
    outgoing.forEach((edge, index) => {
      const route = parseNodeRouteCondition(edge, index);
      routeMap[route.key] = edge.to;
      routeConditions.push(route);
    });
    nodeRouteMap[node.id] = routeMap;
    nodeRouteConditions[node.id] = routeConditions;
  }

  return {
    nodes,
    directNodeEdges,
    nodeRouteMap,
    nodeRouteConditions,
    actionRoutes,
    defaultActionRoute,
    defaultPromptFile: basename(defaultPrompt.path),
  };
}

function runtimeNodeConfig(flow: AgentFlow, node: FlowNode, defaultPromptPath: string): RuntimeNodeConfig {
  const prompt = node.promptId ? flow.prompts.find((item) => item.id === node.promptId) : undefined;
  return {
    id: node.id,
    type: node.type,
    stage: node.stage,
    safetyMode: optionalString(node, "safetyMode"),
    safetySeverityThreshold: optionalString(node, "safetySeverityThreshold"),
    safetyFallbackResponse: optionalString(node, "safetyFallbackResponse"),
    safetyRules: Array.isArray(node.safetyRules) ? node.safetyRules : undefined,
    handler: node.handler,
    codeLanguage: optionalString(node, "codeLanguage"),
    codeExecution: optionalString(node, "codeExecution"),
    codePath: optionalString(node, "codePath"),
    codeInline: optionalString(node, "codeInline"),
    codeEntry: optionalString(node, "codeEntry"),
    codeDependencies: optionalString(node, "codeDependencies"),
    mcpCommand: optionalString(node, "mcpCommand"),
    mcpArgs: optionalStringArray(node, "mcpArgs"),
    mcpToolName: optionalString(node, "mcpToolName"),
    mcpProtocolVersion: optionalString(node, "mcpProtocolVersion"),
    sidecarCommand: optionalString(node, "sidecarCommand"),
    sidecarArgs: optionalStringArray(node, "sidecarArgs"),
    sandboxIsolation: optionalString(node, "sandboxIsolation"),
    sandboxEnvAllowlist: optionalStringArray(node, "sandboxEnvAllowlist"),
    sandboxContainerImage: optionalString(node, "sandboxContainerImage"),
    sandboxContainerEngine: optionalString(node, "sandboxContainerEngine"),
    sandboxContainerProfile: optionalString(node, "sandboxContainerProfile"),
    sandboxContainerMemory: optionalString(node, "sandboxContainerMemory"),
    sandboxContainerCpus: optionalString(node, "sandboxContainerCpus"),
    sandboxContainerPidsLimit: optionalNumber(node, "sandboxContainerPidsLimit"),
    sandboxContainerReadOnlyRootfs: optionalBoolean(node, "sandboxContainerReadOnlyRootfs"),
    sandboxContainerDropCapabilities: optionalBoolean(node, "sandboxContainerDropCapabilities"),
    sandboxContainerNoNewPrivileges: optionalBoolean(node, "sandboxContainerNoNewPrivileges"),
    sandboxVmImageId: optionalString(node, "sandboxVmImageId"),
    sandboxVmRunner: optionalString(node, "sandboxVmRunner"),
    sandboxVmArgs: optionalStringArray(node, "sandboxVmArgs"),
    sandboxVmRunnerManifest: optionalString(node, "sandboxVmRunnerManifest"),
    sandboxVmImage: optionalString(node, "sandboxVmImage"),
    sandboxVmImageManifest: optionalString(node, "sandboxVmImageManifest"),
    sandboxVmEngine: optionalString(node, "sandboxVmEngine"),
    sandboxVmProfile: optionalString(node, "sandboxVmProfile"),
    sandboxVmMemory: optionalString(node, "sandboxVmMemory"),
    sandboxVmCpus: optionalString(node, "sandboxVmCpus"),
    retryAttempts: optionalNumber(node, "retryAttempts"),
    payloadAllowPaths: optionalStringArray(node, "payloadAllowPaths"),
    redactPaths: optionalStringArray(node, "redactPaths"),
    maxPayloadBytes: optionalNumber(node, "maxPayloadBytes"),
    promptFile: basename(prompt?.path ?? defaultPromptPath),
    llmAdapter: node.llm?.adapter,
    llmModel: node.llm?.model,
    method: optionalString(node, "method"),
    url: optionalString(node, "url"),
    bodyPath: optionalString(node, "bodyPath"),
    responsePath: optionalString(node, "responsePath"),
    inputPath: optionalString(node, "inputPath"),
    outputPath: optionalString(node, "outputPath"),
    query: optionalString(node, "query"),
    table: optionalString(node, "table"),
    dataPath: optionalString(node, "dataPath"),
    paramsPath: optionalString(node, "paramsPath"),
    resultPath: optionalString(node, "resultPath"),
    maxRows: optionalNumber(node, "maxRows"),
    sourcePath: optionalString(node, "sourcePath"),
    contentPath: optionalString(node, "contentPath"),
    collectionPath: optionalString(node, "collectionPath"),
    queryPath: optionalString(node, "queryPath"),
    contextPath: optionalString(node, "contextPath"),
    decisionPath: optionalString(node, "decisionPath"),
    approvalValue: optionalString(node, "approvalValue"),
    rejectionValue: optionalString(node, "rejectionValue"),
    payloadPath: optionalString(node, "payloadPath"),
    metricName: optionalString(node, "metricName"),
    threshold: optionalNumber(node, "threshold"),
    topK: optionalNumber(node, "topK"),
    chunkSize: optionalNumber(node, "chunkSize"),
    maxChars: optionalNumber(node, "maxChars"),
    timeoutSeconds: optionalNumber(node, "timeoutSeconds"),
  };
}

function optionalString(node: FlowNode, key: string): string | undefined {
  const value = (node as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalNumber(node: FlowNode, key: string): number | undefined {
  const value = (node as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(node: FlowNode, key: string): boolean | undefined {
  const value = (node as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : undefined;
}

function optionalStringArray(node: FlowNode, key: string): string[] | undefined {
  const value = (node as Record<string, unknown>)[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  return values.length ? values : undefined;
}

function parseActionCondition(condition: string | undefined): string | undefined {
  const match = condition?.match(/action\s*==\s*['"]([^'"]+)['"]/);
  return match?.[1];
}

function parseNodeRouteCondition(edge: FlowEdge, index: number): RuntimeRouteCondition {
  const key = `route_${index}`;
  if (!edge.condition) {
    return { key, kind: "always" };
  }
  const condition = edge.condition.trim();
  const conjunctiveParts = condition.split(/\s+and\s+/i).map((part) => part.trim()).filter(Boolean);
  if (conjunctiveParts.length > 1) {
    return {
      key,
      kind: "all",
      conditions: conjunctiveParts.map((part, partIndex) => parseSingleNodeRouteCondition(part, `${key}_${partIndex}`, edge)),
    };
  }
  return parseSingleNodeRouteCondition(condition, key, edge);
}

function parseSingleNodeRouteCondition(condition: string, key: string, edge: FlowEdge): RuntimeRouteCondition {
  const safetyBlocked = condition.match(/safety\.blocked\s*==\s*(true|false)/i);
  if (safetyBlocked) {
    return { key, kind: "safety_blocked", value: safetyBlocked[1].toLowerCase() === "true" };
  }
  const safetyDecision = condition.match(/safety\.decision\s*==\s*['"]([^'"]+)['"]/i);
  if (safetyDecision) {
    return { key, kind: "safety_decision", value: safetyDecision[1] };
  }
  const status = condition.match(/status\s*==\s*['"]([^'"]+)['"]/i);
  if (status) {
    return { key, kind: "status_equals", value: status[1] };
  }
  const phase = condition.match(/phase\s*==\s*['"]([^'"]+)['"]/i);
  if (phase) {
    return { key, kind: "phase_equals", value: phase[1] };
  }
  const comparison = condition.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (comparison) {
    const rightOperand = parseRouteOperand(comparison[3].trim());
    return {
      key,
      kind: "state_compare",
      path: normalizeStatePath(comparison[1]),
      operator: comparison[2] as RuntimeRouteCondition["operator"],
      ...(rightOperand.kind === "path" ? { rightPath: rightOperand.path } : { value: rightOperand.value }),
    };
  }
  throw new Error(`Condição de aresta ainda não suportada pelo gerador Python: ${edge.condition}`);
}

function normalizeStatePath(value: string): string {
  return value.replace(/^state\./i, "");
}

type RouteOperand = { kind: "path"; path: string } | { kind: "literal"; value: string | boolean | number };

function parseRouteOperand(value: string): RouteOperand {
  const quoted = value.match(/^['"]([^'"]*)['"]$/);
  if (quoted) {
    return { kind: "literal", value: quoted[1] };
  }
  if (/^(true|false)$/i.test(value)) {
    return { kind: "literal", value: value.toLowerCase() === "true" };
  }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return { kind: "literal", value: Number(value) };
  }
  if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(value)) {
    return { kind: "path", path: normalizeStatePath(value) };
  }
  throw new Error(`Operando de condição ainda não suportado pelo gerador Python: ${value}`);
}

function basename(value: string): string {
  return value.split(/[\\/]/).at(-1) ?? value;
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

function pyString(value: string): string {
  return JSON.stringify(value);
}

function pyJson(value: unknown): string {
  return JSON.stringify(JSON.stringify(value, null, 2));
}

function llmRuntimeEnv(flow: AgentFlow) {
  const adapter = findLlmAdapter(flow.llm.adapter);
  return {
    adapterId: flow.llm.adapter,
    apiKeyEnv: flow.llm.apiKeyEnv ?? adapter?.apiKeyEnv ?? "OPENAI_API_KEY",
    baseUrlEnv: flow.llm.baseUrlEnv ?? adapter?.baseUrlEnv ?? "OPENAI_BASE_URL",
    mockEnv: flow.llm.mockEnv ?? adapter?.mockEnv ?? "MOCK_LLM",
    defaultBaseUrl: adapter?.defaultBaseUrl ?? "",
    requiresApiKey: adapter?.requiresApiKey !== false,
    defaultApiKey: adapter?.defaultApiKey ?? "",
  };
}

function renderLlmEnvBlock(flow: AgentFlow): string {
  const env = llmRuntimeEnv(flow);
  return `${env.mockEnv}=true
${env.apiKeyEnv}=${env.defaultApiKey}
LLM_MODEL=${flow.llm.model}
${env.baseUrlEnv}=${env.defaultBaseUrl}
LLM_ADAPTER=${flow.llm.adapter}
LLM_MAX_RETRIES=2`;
}

function renderOllamaRuntimeEnvBlock(flow: AgentFlow): string {
  if (!flowUsesOllama(flow)) {
    return "";
  }
  return `
OLLAMA_IMAGE=ollama/ollama:latest
OLLAMA_MODEL_IMAGE=${slug(flow.id)}-ollama-models:local
OLLAMA_MODEL_NAMES=${ollamaModelNamesForFlow(flow)}
OLLAMA_KEEP_ALIVE=5m
OLLAMA_NUM_PARALLEL=1
OLLAMA_MAX_LOADED_MODELS=1
OLLAMA_MAX_QUEUE=512
OLLAMA_CONTEXT_LENGTH=4096
OLLAMA_GPU_COUNT=1`;
}

function flowUsesOllama(flow: AgentFlow): boolean {
  return (
    flow.llm.adapter.toLowerCase() === "ollama" ||
    flow.nodes.some((node) => typeof node.llm?.adapter === "string" && node.llm.adapter.toLowerCase() === "ollama")
  );
}

function ollamaLlmConfigForFlow(
  flow: AgentFlow,
): AgentFlow["llm"] | NonNullable<AgentFlow["nodes"][number]["llm"]> | undefined {
  if (flow.llm.adapter.toLowerCase() === "ollama") {
    return flow.llm;
  }
  return flow.nodes.find((node) => node.llm?.adapter?.toLowerCase() === "ollama")?.llm;
}

function ollamaBaseUrlEnvForFlow(flow: AgentFlow): string {
  return ollamaLlmConfigForFlow(flow)?.baseUrlEnv ?? findLlmAdapter("ollama")?.baseUrlEnv ?? "OLLAMA_BASE_URL";
}

function ollamaModelForFlow(flow: AgentFlow): string {
  return ollamaLlmConfigForFlow(flow)?.model ?? "qwen3:8b";
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
  return models.length ? models : ["qwen3:8b"];
}

function ollamaComposeService(): string {
  return `  ollama:
    image: \${OLLAMA_IMAGE:-ollama/ollama:latest}
    ports:
      - "11434:11434"
    environment:
      OLLAMA_KEEP_ALIVE: \${OLLAMA_KEEP_ALIVE:-5m}
      OLLAMA_NUM_PARALLEL: \${OLLAMA_NUM_PARALLEL:-1}
      OLLAMA_MAX_LOADED_MODELS: \${OLLAMA_MAX_LOADED_MODELS:-1}
      OLLAMA_MAX_QUEUE: \${OLLAMA_MAX_QUEUE:-512}
      OLLAMA_CONTEXT_LENGTH: \${OLLAMA_CONTEXT_LENGTH:-4096}
    volumes:
      - ollama_models:/root/.ollama
    healthcheck:
      test: ["CMD", "ollama", "list"]
      interval: 10s
      timeout: 5s
      retries: 12
`;
}

function ollamaPullServiceName(model: string, index: number): string {
  return slug(`ollama-pull-${model}`) || `ollama-pull-${index + 1}`;
}

function ollamaPullComposeServices(models: string[]): string {
  return models
    .map(
      (model, index) => `  ${ollamaPullServiceName(model, index)}:
    image: \${OLLAMA_IMAGE:-ollama/ollama:latest}
    profiles:
      - model-setup
    environment:
      OLLAMA_HOST: http://ollama:11434
    entrypoint: ["ollama"]
    command: ["pull", "${model}"]
    depends_on:
      ollama:
        condition: service_healthy
    restart: "no"
`,
    )
    .join("");
}

function ollamaPullCommandForFlow(flow: AgentFlow): string {
  const services = ollamaModelsForFlow(flow).map(ollamaPullServiceName);
  return `docker compose --profile model-setup up ${services.join(" ")}`;
}

function ollamaModelNamesForFlow(flow: AgentFlow): string {
  return ollamaModelsForFlow(flow).join(" ");
}

function renderOllamaGpuComposeOverride(): string {
  return `services:
  ollama:
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: \${OLLAMA_GPU_COUNT:-1}
              capabilities: [gpu]
`;
}

function renderOllamaModelImageComposeOverride(flow: AgentFlow): string {
  return `services:
  ollama:
    build:
      context: .
      dockerfile: ollama-models/Dockerfile
      args:
        OLLAMA_MODEL_NAMES: \${OLLAMA_MODEL_NAMES:-${ollamaModelNamesForFlow(flow)}}
    image: \${OLLAMA_MODEL_IMAGE:-${slug(flow.id)}-ollama-models:local}
`;
}

function renderOllamaModelDockerfile(): string {
  return `FROM ollama/ollama:latest

ARG OLLAMA_MODEL_NAMES=""
ENV OLLAMA_MODELS=/models

RUN set -eux; \\
    mkdir -p "$OLLAMA_MODELS"; \\
    ollama serve >/tmp/ollama-preload.log 2>&1 & \\
    pid="$!"; \\
    ready=0; \\
    i=0; \\
    while [ "$i" -lt 60 ]; do \\
      if ollama list >/dev/null 2>&1; then ready=1; break; fi; \\
      i=$((i + 1)); \\
      sleep 1; \\
    done; \\
    if [ "$ready" -ne 1 ]; then cat /tmp/ollama-preload.log; exit 1; fi; \\
    for model in $OLLAMA_MODEL_NAMES; do \\
      ollama pull "$model"; \\
    done; \\
    kill "$pid"; \\
    wait "$pid" || true
`;
}

function ollamaComposeEnv(flow: AgentFlow): string {
  if (!flowUsesOllama(flow)) {
    return "";
  }
  const baseUrlEnv = ollamaBaseUrlEnvForFlow(flow);
  return `
      ${baseUrlEnv}: \${${baseUrlEnv}:-http://ollama:11434/v1}`;
}

function ollamaComposeDependsOn(flow: AgentFlow): string {
  if (!flowUsesOllama(flow)) {
    return "";
  }
  return `
      ollama:
        condition: service_healthy`;
}

function ollamaComposeVolume(flow: AgentFlow): string {
  return flowUsesOllama(flow) ? "\n  ollama_models:" : "";
}

function llmAdapterDefaultBaseUrls(): Record<string, string> {
  return Object.fromEntries(
    llmAdapterCatalog()
      .filter((adapter) => adapter.defaultBaseUrl)
      .map((adapter) => [adapter.id, adapter.defaultBaseUrl as string]),
  );
}

function llmAdapterDefaultApiKeys(): Record<string, string> {
  return Object.fromEntries(
    llmAdapterCatalog()
      .filter((adapter) => adapter.defaultApiKey)
      .map((adapter) => [adapter.id, adapter.defaultApiKey as string]),
  );
}

function renderLangGraphConfig(flow: AgentFlow): string {
  return `${JSON.stringify(
    {
      dependencies: ["."],
      graphs: {
        [slug(flow.id).replace(/-/g, "_") || "agent"]: "./app/langgraph_app.py:graph",
      },
      env: ".env",
      python_version: "3.12",
    },
    null,
    2,
  )}\n`;
}

function renderPyproject(flow: AgentFlow, serviceName: string): string {
  return `[project]
name = "${serviceName}"
version = "${flow.version}"
description = "Runtime LangGraph + FastAPI gerado para ${flow.name}."
requires-python = ">=3.12"
dependencies = [
  "fastapi",
  "uvicorn[standard]",
  "pydantic-settings",
  "sqlalchemy",
  "psycopg2-binary",
  "redis",
  "openai",
  "langgraph",
  "langgraph-checkpoint-postgres",
  "psycopg[binary,pool]",
  "python-dotenv",
  "pypdf",
]

[project.optional-dependencies]
dev = [
  "pytest",
  "httpx",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]

[tool.setuptools.packages.find]
include = ["app*"]
`;
}

function renderLangGraphSandboxPyproject(flow: AgentFlow, serviceName: string): string {
  return `[project]
name = "${serviceName}"
version = "${flow.version}"
description = "Artefato LangGraph Platform gerado para sandbox de ${flow.name}."
requires-python = ">=3.12"
dependencies = [
  "pydantic-settings",
  "sqlalchemy",
  "psycopg2-binary",
  "redis",
  "openai",
  "langgraph",
  "langgraph-checkpoint-postgres",
  "psycopg[binary,pool]",
  "python-dotenv",
  "pypdf",
]

[project.optional-dependencies]
dev = [
  "pytest",
  "langgraph-cli[inmem]",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]

[tool.setuptools.packages.find]
include = ["app*"]
`;
}

function renderEnvExample(flow: AgentFlow, serviceName: string): string {
  const postgresCheckpointer = flow.persistence.checkpointer === "postgres" ? "true" : "false";
  const redisEnabled = flow.persistence.cache === "redis" ? "true" : "false";
  return `SERVICE_NAME=${serviceName}
DATABASE_URL=postgresql+psycopg2://agent:agent@localhost:5433/agent_runtime
REDIS_URL=redis://localhost:6380/0
REDIS_ENABLED=${redisEnabled}
USE_POSTGRES_CHECKPOINTER=${postgresCheckpointer}
${renderLlmEnvBlock(flow)}${renderOllamaRuntimeEnvBlock(flow)}
AUTH_ENABLED=false
AGENT_API_KEY=
AGENT_API_KEYS=
AGENT_API_KEYS_PATH=
AGENT_API_REVOKED_KEY_IDS=
AGENT_API_REVOKED_KEY_IDS_PATH=
AUTH_RATE_LIMIT_ENABLED=false
AUTH_RATE_LIMIT_REQUESTS=60
AUTH_RATE_LIMIT_WINDOW_SECONDS=60
AUTH_AUDIT_ENABLED=true
AUTH_AUDIT_MAX_ENTRIES=200
AUTH_AUDIT_PATH=
SAFETY_PROVIDER_ENABLED=false
SAFETY_PROVIDER_URL=
SAFETY_PROVIDER_TIMEOUT_SECONDS=3
SAFETY_PROVIDER_FAIL_CLOSED=false
SAFETY_PROVIDER_HEADERS_JSON=
AUTO_CREATE_TABLES=true
LOG_LEVEL=INFO
WORKER_INTERVAL_SECONDS=5
WORKER_LIMIT=20
WORKER_RETRY_DELAY_SECONDS=5
WORKER_LEASE_SECONDS=60
WORKER_CLEANUP_ENABLED=false
WORKER_CLEANUP_OLDER_THAN_HOURS=168
WORKER_CLEANUP_LIMIT=100
WORKER_CLEANUP_STATUSES=succeeded,failed
LANGSMITH_TRACING=false
LANGSMITH_API_KEY=
LANGSMITH_PROJECT=${serviceName}
`;
}

function renderLangGraphSandboxEnvExample(flow: AgentFlow, serviceName: string): string {
  return `SERVICE_NAME=${serviceName}
DATABASE_URL=sqlite:///./langgraph_sandbox.db
REDIS_URL=redis://localhost:6380/0
REDIS_ENABLED=false
USE_POSTGRES_CHECKPOINTER=false
${renderLlmEnvBlock(flow)}
AUTH_ENABLED=false
AGENT_API_KEY=
AGENT_API_KEYS=
AGENT_API_KEYS_PATH=
AGENT_API_REVOKED_KEY_IDS=
AGENT_API_REVOKED_KEY_IDS_PATH=
AUTH_RATE_LIMIT_ENABLED=false
AUTH_RATE_LIMIT_REQUESTS=60
AUTH_RATE_LIMIT_WINDOW_SECONDS=60
AUTH_AUDIT_ENABLED=true
AUTH_AUDIT_MAX_ENTRIES=200
AUTH_AUDIT_PATH=
SAFETY_PROVIDER_ENABLED=false
SAFETY_PROVIDER_URL=
SAFETY_PROVIDER_TIMEOUT_SECONDS=3
SAFETY_PROVIDER_FAIL_CLOSED=false
SAFETY_PROVIDER_HEADERS_JSON=
AUTO_CREATE_TABLES=true
LOG_LEVEL=INFO
LANGSMITH_TRACING=false
LANGSMITH_API_KEY=
LANGSMITH_PROJECT=${serviceName}
`;
}

function renderDockerfile(): string {
  return `FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update \\
    && apt-get install -y --no-install-recommends bash nodejs npm \\
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
RUN pip install --no-cache-dir .

COPY app ./app
COPY migrations ./migrations
RUN npm install --prefix app/code --omit=dev

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
`;
}

function renderCodePackageJson(flow: AgentFlow): string {
  const dependencies = collectNodeCodeDependencies(flow);
  if (flow.nodes.some((node) => node.type === "code" && isTypeScriptCodeLanguage(node.codeLanguage))) {
    dependencies.set("typescript", dependencies.get("typescript") ?? "^5.8.0");
  }
  const packageJson: Record<string, unknown> = {
    type: "module",
  };
  if (dependencies.size) {
    packageJson.dependencies = Object.fromEntries([...dependencies.entries()].sort(([left], [right]) => left.localeCompare(right)));
  }
  return `${JSON.stringify(packageJson, null, 2)}\n`;
}

function collectNodeCodeDependencies(flow: AgentFlow): Map<string, string> {
  const dependencies = new Map<string, string>();
  for (const node of flow.nodes) {
    if (node.type !== "code" || !node.codeDependencies || !isNodePackageCodeLanguage(node.codeLanguage)) {
      continue;
    }
    for (const dependency of String(node.codeDependencies).split(/[\n,]+/)) {
      const parsed = parseNpmDependencySpec(dependency);
      if (parsed) {
        dependencies.set(parsed.name, parsed.version);
      }
    }
  }
  return dependencies;
}

function parseNpmDependencySpec(value: string): { name: string; version: string } | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const atIndex = trimmed.startsWith("@") ? trimmed.indexOf("@", 1) : trimmed.lastIndexOf("@");
  if (atIndex > 0) {
    const name = trimmed.slice(0, atIndex);
    const version = trimmed.slice(atIndex + 1) || "*";
    return { name, version };
  }
  return { name: trimmed, version: "*" };
}

function isTypeScriptCodeLanguage(language: unknown): boolean {
  return typeof language === "string" && ["typescript", "ts"].includes(language.toLowerCase());
}

function isNodePackageCodeLanguage(language: unknown): boolean {
  return typeof language === "string" && ["javascript", "js", "typescript", "ts"].includes(language.toLowerCase());
}

function renderCodeRunner(): string {
  return `import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const codeRoot = path.join(appRoot, "code");
const requireFromRunner = createRequire(import.meta.url);
const requireFromCode = createRequire(path.join(codeRoot, "package.json"));

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}

async function loadModule(request) {
  if (request.sourcePath) {
    if (isTypeScriptRequest(request)) {
      const source = await readFile(request.sourcePath, "utf8");
      return loadTypeScriptModule(source, request.sourcePath);
    }
    const url = pathToFileURL(request.sourcePath);
    url.searchParams.set("t", String(Date.now()));
    return import(url.href);
  }

  if (!request.inlineSource) {
    throw new Error("missing_code_source");
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-flow-js-"));
  const inlinePath = path.join(tempDir, isTypeScriptRequest(request) ? "inline.ts" : "inline.mjs");
  const modulePath = isTypeScriptRequest(request)
    ? await materializeTypeScriptModule(request.inlineSource, inlinePath, tempDir)
    : inlinePath;
  await writeFile(inlinePath, request.inlineSource, "utf8");
  try {
    const url = pathToFileURL(modulePath);
    url.searchParams.set("t", String(Date.now()));
    return await import(url.href);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function isTypeScriptRequest(request) {
  const language = String(request.language || "").toLowerCase();
  return language === "typescript" || language === "ts" || isTypeScriptPath(request.sourcePath || "");
}

function isTypeScriptPath(filePath) {
  return /\\.tsx?$/i.test(String(filePath || ""));
}

async function loadTypeScriptModule(source, sourceName) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agent-flow-ts-"));
  try {
    const modulePath = await materializeTypeScriptModule(source, sourceName, tempDir);
    const url = pathToFileURL(modulePath);
    url.searchParams.set("t", String(Date.now()));
    return await import(url.href);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function materializeTypeScriptModule(source, sourceName, tempDir) {
  const output = transpileTypeScript(source, sourceName);
  const modulePath = path.join(tempDir, path.basename(String(sourceName || "inline.ts")).replace(/\\.tsx?$/i, ".mjs"));
  await writeFile(modulePath, output, "utf8");
  return modulePath;
}

function transpileTypeScript(source, sourceName) {
  try {
    const ts = requireFromCode("typescript");
    const result = ts.transpileModule(source, {
      fileName: String(sourceName || "agent-flow.ts"),
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        sourceMap: false,
        inlineSources: false,
      },
    });
    return result.outputText;
  } catch {
    const nodeModule = requireFromRunner("node:module");
    if (typeof nodeModule.stripTypeScriptTypes === "function") {
      return nodeModule.stripTypeScriptTypes(source);
    }
    throw new Error("typescript_transpiler_unavailable");
  }
}

async function main() {
  const raw = await readStdin();
  const request = raw ? JSON.parse(raw) : {};
  const module = await loadModule(request);
  const entryName = request.entry || "run";
  const entry = module[entryName] || module.default;
  if (typeof entry !== "function") {
    throw new Error("Entry point not found or not callable: " + entryName);
  }
  const output = await entry(request.input, request.context || {});
  process.stdout.write(JSON.stringify({ ok: true, output }));
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({ ok: false, error: serializeError(error) }));
  process.exitCode = 1;
});
`;
}

function renderDockerCompose(flow: AgentFlow): string {
  const volumeName = `${slug(flow.id).replace(/-/g, "_")}_postgres_data`;
  const ollamaServices = flowUsesOllama(flow)
    ? `\n${ollamaComposeService()}${ollamaPullComposeServices(ollamaModelsForFlow(flow))}`
    : "";
  return `services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: agent
      POSTGRES_PASSWORD: agent
      POSTGRES_DB: agent_runtime
    ports:
      - "5433:5432"
    volumes:
      - ${volumeName}:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U agent -d agent_runtime"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    ports:
      - "6380:6379"
${ollamaServices}

  api:
    build: .
    env_file:
      - path: .env
        required: false
    environment:
      DATABASE_URL: postgresql+psycopg2://agent:agent@postgres:5432/agent_runtime
      REDIS_URL: redis://redis:6379/0
      REDIS_ENABLED: "true"
      USE_POSTGRES_CHECKPOINTER: "true"
      AUTO_CREATE_TABLES: "true"
      MOCK_LLM: \${MOCK_LLM:-true}${ollamaComposeEnv(flow)}
    ports:
      - "8080:8080"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started${ollamaComposeDependsOn(flow)}

  worker:
    build: .
    env_file:
      - path: .env
        required: false
    command: ["python", "-m", "app.worker"]
    environment:
      DATABASE_URL: postgresql+psycopg2://agent:agent@postgres:5432/agent_runtime
      REDIS_URL: redis://redis:6379/0
      REDIS_ENABLED: "true"
      USE_POSTGRES_CHECKPOINTER: "true"
      AUTO_CREATE_TABLES: "true"
      MOCK_LLM: \${MOCK_LLM:-true}${ollamaComposeEnv(flow)}
      WORKER_INTERVAL_SECONDS: \${WORKER_INTERVAL_SECONDS:-5}
      WORKER_LIMIT: \${WORKER_LIMIT:-20}
      WORKER_RETRY_DELAY_SECONDS: \${WORKER_RETRY_DELAY_SECONDS:-5}
      WORKER_LEASE_SECONDS: \${WORKER_LEASE_SECONDS:-60}
      WORKER_CLEANUP_ENABLED: \${WORKER_CLEANUP_ENABLED:-false}
      WORKER_CLEANUP_OLDER_THAN_HOURS: \${WORKER_CLEANUP_OLDER_THAN_HOURS:-168}
      WORKER_CLEANUP_LIMIT: \${WORKER_CLEANUP_LIMIT:-100}
      WORKER_CLEANUP_STATUSES: \${WORKER_CLEANUP_STATUSES:-succeeded,failed}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started${ollamaComposeDependsOn(flow)}

volumes:
  ${volumeName}:${ollamaComposeVolume(flow)}
`;
}

function renderReadme(flow: AgentFlow): string {
  const ollamaBaseUrlEnv = ollamaBaseUrlEnvForFlow(flow);
  const ollamaModelNames = ollamaModelNamesForFlow(flow);
  const ollamaModelImageTag = `${slug(flow.id)}-ollama-models:local`;
  const ollamaModelImageArchive = `model-distribution/${modelImageArchiveName(ollamaModelImageTag)}.tar`;
  const localModelSection = flowUsesOllama(flow)
    ? `
## Modelo local com Ollama

Este runtime foi gerado com adapter Ollama. O \`docker-compose.yml\` inclui o serviço \`ollama\`, volume persistente \`ollama_models\`, variáveis locais de capacidade/concurrency e injeta \`${ollamaBaseUrlEnv}\` como \`http://ollama:11434/v1\` dentro dos containers.

\`\`\`powershell
Copy-Item .env.example .env
docker compose up -d ollama
${ollamaPullCommandForFlow(flow)}
docker compose up -d --build
\`\`\`

O profile \`model-setup\` executa serviços one-shot para baixar os modelos usados pelo flow. Como alternativa manual, use \`docker compose exec ollama ollama pull ${ollamaModelForFlow(flow)}\`. Para usar um Ollama já rodando fora do compose, ajuste \`${ollamaBaseUrlEnv}\` no \`.env\`. Dentro do compose, prefira \`http://ollama:11434/v1\`; no host, prefira \`http://localhost:11434/v1\`.

Para criar uma imagem local com os modelos já baixados, use o override gerado:

\`\`\`powershell
docker compose -f docker-compose.yml -f docker-compose.model-image.yml build ollama
docker compose -f docker-compose.yml -f docker-compose.model-image.yml up -d ollama
\`\`\`

O build usa \`OLLAMA_MODEL_NAMES=${ollamaModelNames}\` por padrão. Ajuste essa variável no \`.env\` se quiser pré-carregar outro conjunto de modelos.

Para distribuir essa imagem para outra máquina sem baixar os modelos de novo, use uma tag versionada em \`OLLAMA_MODEL_IMAGE\` e salve/carregue o tar:

\`\`\`powershell
New-Item -ItemType Directory -Force model-distribution | Out-Null
docker image save -o ${ollamaModelImageArchive} ${ollamaModelImageTag}
docker image load -i ${ollamaModelImageArchive}
\`\`\`

Se \`OLLAMA_MODEL_IMAGE\` apontar para um registry privado, use \`docker image push <sua-tag-versionada>\` depois do build.

Para habilitar GPU NVIDIA em hosts compatíveis, combine o override de GPU:

\`\`\`powershell
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
\`\`\`

Use \`OLLAMA_KEEP_ALIVE\`, \`OLLAMA_NUM_PARALLEL\`, \`OLLAMA_MAX_LOADED_MODELS\`, \`OLLAMA_MAX_QUEUE\`, \`OLLAMA_CONTEXT_LENGTH\` e \`OLLAMA_GPU_COUNT\` no \`.env\` para ajustar o perfil local.
`
    : "";
  return `# ${flow.name}

Runtime gerado a partir de \`${flow.id}\`.
${localModelSection}

## Contrato

- \`POST /${flow.api.resourceName}\`
- \`GET /${flow.api.resourceName}/{session_id}\`
- \`POST /${flow.api.resourceName}/{session_id}/start\`
- \`POST /${flow.api.resourceName}/{session_id}/turn\`
- \`POST /${flow.api.resourceName}/{session_id}/finish\`
- \`GET /${flow.api.resourceName}/{session_id}/transcript\`
- \`GET /${flow.api.resourceName}/{session_id}/events\`
- \`GET /${flow.api.resourceName}/{session_id}/events/stream\` (SSE)
- \`WS /${flow.api.resourceName}/{session_id}/events/ws\` (WebSocket)
- \`POST /${flow.api.resourceName}/{session_id}/turn/stream\` (SSE token stream)
- \`WS /${flow.api.resourceName}/{session_id}/turn/stream/ws\` (WebSocket token stream)
- \`GET /jobs\`
- \`GET /jobs/metrics\`
- \`POST /jobs/cleanup\`
- \`POST /jobs/run-pending\`
- \`POST /jobs/retry-failed\`
- \`GET /jobs/{job_id}\`
- \`POST /jobs/{job_id}/run\`
- \`POST /jobs/{job_id}/retry\`
- \`POST /jobs/{job_id}/schedule\`
- \`POST /jobs/{job_id}/recurrence\`
- \`GET /job-schedules\`
- \`POST /job-schedules/run-due\`
- \`POST /job-schedules/trigger-event\`
- \`POST /job-schedules/{schedule_id}/disable\`

\`GET /jobs/metrics?window_hours=24\` retorna contadores por status/tipo, pendências, tentativas, taxa de sucesso, duração média/mínima/máxima/p95, janela configurável, finalizações/taxa/throughput na janela, próxima pendência agendada, finalizações na última hora e último término observado. \`POST /jobs/cleanup\` faz retenção governada de jobs antigos: por padrão retorna apenas uma prévia (\`dry_run=true\`) de jobs \`succeeded\`/\`failed\` finalizados há mais de 168 horas, e só remove registros quando \`dry_run=false\`. \`POST /jobs/{job_id}/schedule\` aceita \`delay_seconds\` ou \`run_at\` para reagendar jobs pendentes/falhos sem apagar histórico de erro/tentativas. Recorrências simples por intervalo ou cron básico usam \`POST /jobs/{job_id}/recurrence\`, \`trigger_type\`, \`cron_expression\`, \`GET /job-schedules\`, \`POST /job-schedules/run-due\` e \`POST /job-schedules/{schedule_id}/disable\`. Schedules orientados a evento usam \`trigger_type="event"\`, \`event_type\` e \`POST /job-schedules/trigger-event\`; o payload externo é redigido para chaves sensíveis óbvias antes de ser persistido no job.
Eventos podem ser acompanhados por polling em \`GET /${flow.api.resourceName}/{session_id}/events\`, por SSE em \`GET /${flow.api.resourceName}/{session_id}/events/stream\` ou por WebSocket em \`/${flow.api.resourceName}/{session_id}/events/ws\`, todos com suporte a \`from_seq\`.
\`POST /${flow.api.resourceName}/{session_id}/turn/stream\` preserva o mesmo contrato e idempotência de \`POST /${flow.api.resourceName}/{session_id}/turn\`, mas responde em SSE com \`turn_started\`, \`token\`, \`turn_completed\` e \`stream_closed\`. \`WS /${flow.api.resourceName}/{session_id}/turn/stream/ws\` oferece o mesmo ciclo por WebSocket usando \`user_message\` e \`idempotency_key\` na query. Tokens usam callback incremental do grafo/LLM quando disponível e carregam \`source\` para diferenciar \`llm_callback\` do fallback \`assistant_message\`.

## Autenticação

Com \`AUTH_ENABLED=true\`, o runtime exige \`X-Agent-API-Key\` nas rotas protegidas. \`AGENT_API_KEY\` mantém uma chave legada de acesso total. \`AGENT_API_KEYS\` permite múltiplas chaves com scopes como \`metadata:read\`, \`auth:read\`, \`sessions:read\`, \`sessions:write\`, \`jobs:read\`, \`jobs:write\`, \`sessions:*\` ou \`*\`. Em bundles multiagente, também é possível restringir por agente com \`agents:<agent_id>:metadata:read\`, \`agents:<agent_id>:sessions:*\`, \`agents:<agent_id>:jobs:*\`, \`agents:<agent_id>:auth:read\` ou \`agents:<agent_id>:*\`.
\`AGENT_API_KEYS_PATH\` aponta para um JSON local com o mesmo formato ou com \`{ "keys": [{ "id": "...", "key": "...", "scopes": [...] }] }\`; o runtime lê esse arquivo nas autenticações, permitindo rotação local sem rebuild ou restart. \`GET /auth/keys\` lista apenas \`key_id\`, origem e scopes, sem expor o valor bruto da chave.
Objetos de chave também aceitam \`expires_at\` ou \`expiresAt\` em ISO 8601 ou timestamp Unix; chaves expiradas são rejeitadas e aparecem com \`expired=true\` em \`/auth/keys\`.
\`AGENT_API_REVOKED_KEY_IDS\` e \`AGENT_API_REVOKED_KEY_IDS_PATH\` revogam chaves por \`key_id\` simples ou por identificador qualificado de origem, como \`AGENT_API_KEYS_PATH:reader\`; chaves revogadas são rejeitadas e aparecem com \`revoked=true\` em \`/auth/keys\`.
\`AUTH_RATE_LIMIT_ENABLED=true\` ativa limite local em memória por chave/scope, e \`GET /auth/audit\` lista a auditoria recente por \`key_id\`, scope, rota e status sem expor o valor da chave. Configure \`AUTH_AUDIT_PATH\` para persistir a auditoria local em JSONL.

\`\`\`env
AUTH_ENABLED=true
AGENT_API_KEY=
AGENT_API_KEYS={"reader-key":["metadata:read","sessions:read"],"operator-key":["sessions:*"],"job-key":["jobs:*"]}
AGENT_API_KEYS_PATH=.agent-flow/api-keys.json
AGENT_API_REVOKED_KEY_IDS=
AGENT_API_REVOKED_KEY_IDS_PATH=.agent-flow/revoked-api-keys.json
AUTH_RATE_LIMIT_ENABLED=true
AUTH_RATE_LIMIT_REQUESTS=60
AUTH_RATE_LIMIT_WINDOW_SECONDS=60
AUTH_AUDIT_ENABLED=true
AUTH_AUDIT_MAX_ENTRIES=200
AUTH_AUDIT_PATH=.agent-flow/auth-audit.jsonl
\`\`\`

O SSE de eventos em \`GET /${flow.api.resourceName}/{session_id}/events/stream\` e os WebSockets também aceitam a chave por query \`api_key\` quando o cliente de navegador não permite enviar header.

## Safety externo

O runtime sempre executa as regras locais do \`safety_gate\` primeiro. Se nenhuma regra local bloquear e \`SAFETY_PROVIDER_ENABLED=true\`, ele chama \`SAFETY_PROVIDER_URL\` por HTTP POST com \`text\`, \`stage\`, \`nodeId\`, \`policy\` e decisão local. A resposta pode usar campos como \`blocked\`, \`decision\`, \`category\`, \`reason\`, \`safeResponse\`, \`severity\` e \`score\`. Use \`SAFETY_PROVIDER_HEADERS_JSON\` apenas em \`.env\`, nunca no flow versionado.

\`\`\`env
SAFETY_PROVIDER_ENABLED=true
SAFETY_PROVIDER_URL=https://safety.local/evaluate
SAFETY_PROVIDER_TIMEOUT_SECONDS=3
SAFETY_PROVIDER_FAIL_CLOSED=false
SAFETY_PROVIDER_HEADERS_JSON={"Authorization":"Bearer ..."}
\`\`\`

## Execução local

\`\`\`powershell
python -m pip install -e ".[dev]"
pytest -q
uvicorn app.main:app --reload --port 8080
\`\`\`

Para processar jobs pós-finalização pendentes sem a UI:

\`\`\`powershell
python -m app.worker --once
WORKER_INTERVAL_SECONDS=10 WORKER_LIMIT=50 WORKER_RETRY_DELAY_SECONDS=30 python -m app.worker
WORKER_LEASE_SECONDS=60 python -m app.worker --interval 5 --limit 20 --retry-delay 5
WORKER_CLEANUP_ENABLED=true WORKER_CLEANUP_OLDER_THAN_HOURS=168 python -m app.worker
\`\`\`

Se o fluxo usa nó \`code\` em JavaScript ou TypeScript, o ambiente local também precisa ter \`node\` disponível. O Dockerfile gerado já instala \`nodejs\`/\`npm\` e executa \`npm install --prefix app/code --omit=dev\` para preparar dependências declaradas por \`codeDependencies\`.

## Container Docker

\`\`\`powershell
Copy-Item .env.example .env
docker compose up -d --build
\`\`\`

A cópia de \`.env.example\` é opcional para o caminho mock/local padrão; use-a quando precisar ajustar chaves, provider, auth ou variáveis operacionais. O \`docker-compose.yml\` aceita \`.env\` ausente, sobe com \`MOCK_LLM=true\` e o \`.env.example\` mantém \`LANGSMITH_TRACING=false\` para não enviar traces ao LangSmith Cloud por padrão.

A API fica em \`http://127.0.0.1:8080/docs\`.
O Compose também sobe o serviço \`worker\`, que executa jobs pós-finalização pendentes com \`python -m app.worker\`. Ajuste \`WORKER_INTERVAL_SECONDS\`, \`WORKER_LIMIT\`, \`WORKER_RETRY_DELAY_SECONDS\` e \`WORKER_LEASE_SECONDS\` no ambiente para controlar frequência, escala por ciclo, atraso de retry e tempo de lease sem reconstruir a imagem. A limpeza automática governada fica desligada por padrão; ative \`WORKER_CLEANUP_ENABLED=true\` para remover jobs terminais antigos após cada ciclo usando \`WORKER_CLEANUP_OLDER_THAN_HOURS\`, \`WORKER_CLEANUP_LIMIT\` e \`WORKER_CLEANUP_STATUSES\`. Para escala horizontal, suba múltiplas réplicas do serviço \`worker\`: cada processo claim jobs por \`worker_id\` e \`locked_until\`, outro worker ignora o job enquanto o lease está ativo e pode retomá-lo quando o lease expira.

## Validação LangSmith/LangGraph

Para testar no sandbox LangSmith/LangGraph, gere o pacote separado pelo botão \`LangGraph\` do builder ou pelo script \`npm run codegen:sandbox\`. Esse runtime é o alvo final FastAPI/Docker e não instala o CLI do LangGraph para evitar conflito de dependências com FastAPI.

Este pacote ainda inclui \`langgraph.json\` e \`app/langgraph_app.py\` para rastreabilidade do grafo aprovado, mas o artefato preferencial para upload/teste no LangSmith é \`generated/${flow.id}-langgraph-sandbox\`.

## Nós

${flow.nodes.map((node) => `- \`${node.id}\` (${node.type})`).join("\n")}
`;
}

function renderLangGraphSandboxReadme(flow: AgentFlow): string {
  return `# ${flow.name} - Sandbox LangGraph

Artefato gerado a partir de \`${flow.id}\` para validação no sandbox LangSmith/LangGraph.

Este pacote não é o runtime FastAPI/Docker final.

## Execução

\`\`\`powershell
Copy-Item .env.example .env
python -m pip install -e ".[dev]"
pytest -q
langgraph dev
\`\`\`

O modo local não envia traces para LangSmith por padrão. Para registrar traces no serviço hospedado, configure \`LANGSMITH_API_KEY\`, \`LANGSMITH_TRACING=true\` e \`LANGSMITH_PROJECT\` em \`.env\`.
Para testar sem chamada real de modelo, mantenha \`MOCK_LLM=true\`.

## Entry Point

- \`langgraph.json\`
- \`app/langgraph_app.py:graph\`

## Depois da aprovação

Volte ao builder, registre a aprovação do sandbox e gere o runtime FastAPI/Docker. O builder valida o hash do flow aprovado antes de criar o pacote final da API.

## Nós

${flow.nodes.map((node) => `- \`${node.id}\` (${node.type})`).join("\n")}
`;
}

function renderGeneratedFlow(flow: AgentFlow): string {
  return `"""Artefato gerado a partir de agent.flow.json."""

import json


FLOW = json.loads(${pyJson(flow)})
FLOW_ID = FLOW["id"]
AGENT_ID = FLOW_ID
FLOW_NAME = FLOW["name"]
FLOW_VERSION = FLOW["version"]
API_RESOURCE = FLOW["api"]["resourceName"]
API_CONTRACT = FLOW["api"]["contract"]
LLM_ADAPTER = FLOW["llm"]["adapter"]
LLM_MODEL = FLOW["llm"]["model"]
NODES = [{"id": item["id"], "type": item["type"]} for item in FLOW["nodes"]]
EDGES = [
    {"from": item["from"], "to": item["to"], "condition": item.get("condition")}
    for item in FLOW["edges"]
]
`;
}

function renderSettings(flow: AgentFlow, serviceName: string): string {
  const env = llmRuntimeEnv(flow);
  return `from functools import lru_cache

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    service_name: str = ${pyString(serviceName)}
    agent_id: str = ${pyString(flow.id)}
    database_url: str = "sqlite:///./agent_runtime.db"
    redis_url: str = "redis://localhost:6379/0"
    redis_enabled: bool = ${flow.persistence.cache === "redis" ? "True" : "False"}
    redis_ttl_seconds: int = 3600
    use_postgres_checkpointer: bool = ${flow.persistence.checkpointer === "postgres" ? "True" : "False"}
    mock_llm: bool = Field(default=True, validation_alias=${pyString(env.mockEnv)})
    openai_api_key: str = Field(default=${pyString(env.defaultApiKey)}, validation_alias=${pyString(env.apiKeyEnv)})
    openai_model: str = Field(default=${pyString(flow.llm.model)}, validation_alias=AliasChoices("LLM_MODEL", "OPENAI_MODEL"))
    openai_base_url: str = Field(default=${pyString(env.defaultBaseUrl)}, validation_alias=${pyString(env.baseUrlEnv)})
    llm_adapter: str = ${pyString(flow.llm.adapter)}
    llm_max_retries: int = 2
    auth_enabled: bool = False
    agent_api_key: str = ""
    agent_api_keys: str = ""
    agent_api_keys_path: str = ""
    agent_api_revoked_key_ids: str = ""
    agent_api_revoked_key_ids_path: str = ""
    auth_rate_limit_enabled: bool = False
    auth_rate_limit_requests: int = 60
    auth_rate_limit_window_seconds: int = 60
    auth_audit_enabled: bool = True
    auth_audit_max_entries: int = 200
    auth_audit_path: str = ""
    auto_create_tables: bool = True
    log_level: str = "INFO"
    worker_interval_seconds: float = 5.0
    worker_limit: int = 20
    worker_retry_delay_seconds: float = 5.0
    worker_lease_seconds: float = 60.0
    worker_cleanup_enabled: bool = False
    worker_cleanup_older_than_hours: float = 168.0
    worker_cleanup_limit: int = 100
    worker_cleanup_statuses: str = "succeeded,failed"
    langsmith_tracing: bool = False
    langsmith_api_key: str = ""
    langsmith_project: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8-sig",
        env_prefix="",
        case_sensitive=False,
    )

    @model_validator(mode="after")
    def validate_runtime_settings(self):
        has_auth_key = self.agent_api_key.strip() or self.agent_api_keys.strip() or self.agent_api_keys_path.strip()
        if self.auth_enabled and not has_auth_key:
            raise ValueError("AGENT_API_KEY, AGENT_API_KEYS ou AGENT_API_KEYS_PATH é obrigatória quando AUTH_ENABLED=true.")
        requires_api_key = ${env.requiresApiKey ? 'self.llm_adapter.strip().lower() not in {"ollama"}' : "False"}
        if not self.mock_llm and requires_api_key and not self.openai_api_key.strip():
            raise ValueError("${env.apiKeyEnv} é obrigatória quando ${env.mockEnv}=false.")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
`;
}

function renderDb(): string {
  return `from collections.abc import Generator
from contextlib import contextmanager

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from app.generated_flow import AGENT_ID
from app.settings import get_settings


def _connect_args(database_url: str) -> dict:
    if database_url.startswith("sqlite"):
        return {"check_same_thread": False}
    return {}


settings = get_settings()
engine = create_engine(
    settings.database_url,
    connect_args=_connect_args(settings.database_url),
    future=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def _table_columns(connection, table_name: str) -> set[str]:
    try:
        return {column["name"] for column in inspect(connection).get_columns(table_name)}
    except Exception:
        return set()


def _add_column_if_missing(connection, table_name: str, column_name: str, definition: str) -> None:
    if column_name not in _table_columns(connection, table_name):
        connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}"))


def _apply_compat_migrations(connection) -> None:
    dialect = connection.dialect.name
    timestamp_type = "DATETIME" if dialect == "sqlite" else "TIMESTAMPTZ"
    timestamp_default = "CURRENT_TIMESTAMP" if dialect == "sqlite" else "now()"
    timestamp_column = timestamp_type if dialect == "sqlite" else f"{timestamp_type} DEFAULT {timestamp_default}"

    if _table_columns(connection, "agent_sessions"):
        _add_column_if_missing(connection, "agent_sessions", "agent_id", "VARCHAR")
        connection.execute(text("UPDATE agent_sessions SET agent_id = :agent_id WHERE agent_id IS NULL OR agent_id = ''"), {"agent_id": AGENT_ID})
        if dialect != "sqlite":
            connection.execute(text("ALTER TABLE agent_sessions ALTER COLUMN agent_id SET NOT NULL"))

    if _table_columns(connection, "agent_events"):
        _add_column_if_missing(connection, "agent_events", "agent_id", "VARCHAR")
        connection.execute(text("UPDATE agent_events SET agent_id = :agent_id WHERE agent_id IS NULL OR agent_id = ''"), {"agent_id": AGENT_ID})
        if dialect != "sqlite":
            connection.execute(text("ALTER TABLE agent_events ALTER COLUMN agent_id SET NOT NULL"))

    if _table_columns(connection, "agent_jobs"):
        _add_column_if_missing(connection, "agent_jobs", "agent_id", "VARCHAR")
        _add_column_if_missing(connection, "agent_jobs", "attempts", "INTEGER DEFAULT 0")
        _add_column_if_missing(connection, "agent_jobs", "max_attempts", "INTEGER DEFAULT 3")
        _add_column_if_missing(connection, "agent_jobs", "payload_json", "JSON")
        _add_column_if_missing(connection, "agent_jobs", "result_json", "JSON")
        _add_column_if_missing(connection, "agent_jobs", "last_error_json", "JSON")
        _add_column_if_missing(connection, "agent_jobs", "created_at", timestamp_column)
        _add_column_if_missing(connection, "agent_jobs", "updated_at", timestamp_column)
        _add_column_if_missing(connection, "agent_jobs", "started_at", f"{timestamp_type} NULL")
        _add_column_if_missing(connection, "agent_jobs", "finished_at", f"{timestamp_type} NULL")
        _add_column_if_missing(connection, "agent_jobs", "next_run_at", f"{timestamp_type} NULL")
        _add_column_if_missing(connection, "agent_jobs", "locked_by", "VARCHAR")
        _add_column_if_missing(connection, "agent_jobs", "locked_until", f"{timestamp_type} NULL")
        _add_column_if_missing(connection, "agent_jobs", "lock_acquired_at", f"{timestamp_type} NULL")
        connection.execute(text("UPDATE agent_jobs SET agent_id = :agent_id WHERE agent_id IS NULL OR agent_id = ''"), {"agent_id": AGENT_ID})
        connection.execute(text("UPDATE agent_jobs SET attempts = 0 WHERE attempts IS NULL"))
        connection.execute(text("UPDATE agent_jobs SET max_attempts = 3 WHERE max_attempts IS NULL"))
        connection.execute(text(f"UPDATE agent_jobs SET created_at = {timestamp_default} WHERE created_at IS NULL"))
        connection.execute(text(f"UPDATE agent_jobs SET updated_at = {timestamp_default} WHERE updated_at IS NULL"))
        if dialect != "sqlite":
            connection.execute(text("ALTER TABLE agent_jobs ALTER COLUMN agent_id SET NOT NULL"))

    if _table_columns(connection, "agent_job_schedules"):
        _add_column_if_missing(connection, "agent_job_schedules", "agent_id", "VARCHAR")
        _add_column_if_missing(connection, "agent_job_schedules", "session_id", "VARCHAR")
        _add_column_if_missing(connection, "agent_job_schedules", "kind", "VARCHAR")
        _add_column_if_missing(connection, "agent_job_schedules", "status", "VARCHAR DEFAULT 'enabled'")
        _add_column_if_missing(connection, "agent_job_schedules", "trigger_type", "VARCHAR DEFAULT 'interval'")
        _add_column_if_missing(connection, "agent_job_schedules", "interval_seconds", "INTEGER DEFAULT 3600")
        _add_column_if_missing(connection, "agent_job_schedules", "cron_expression", "VARCHAR")
        _add_column_if_missing(connection, "agent_job_schedules", "max_attempts", "INTEGER DEFAULT 3")
        _add_column_if_missing(connection, "agent_job_schedules", "payload_json", "JSON")
        _add_column_if_missing(connection, "agent_job_schedules", "last_job_id", "VARCHAR")
        _add_column_if_missing(connection, "agent_job_schedules", "created_at", timestamp_column)
        _add_column_if_missing(connection, "agent_job_schedules", "updated_at", timestamp_column)
        _add_column_if_missing(connection, "agent_job_schedules", "last_run_at", f"{timestamp_type} NULL")
        _add_column_if_missing(connection, "agent_job_schedules", "next_run_at", f"{timestamp_type} NULL")
        connection.execute(text("UPDATE agent_job_schedules SET agent_id = :agent_id WHERE agent_id IS NULL OR agent_id = ''"), {"agent_id": AGENT_ID})
        connection.execute(text("UPDATE agent_job_schedules SET status = 'enabled' WHERE status IS NULL OR status = ''"))
        connection.execute(text("UPDATE agent_job_schedules SET trigger_type = 'interval' WHERE trigger_type IS NULL OR trigger_type = ''"))
        connection.execute(text("UPDATE agent_job_schedules SET interval_seconds = 3600 WHERE interval_seconds IS NULL OR interval_seconds <= 0"))
        connection.execute(text("UPDATE agent_job_schedules SET max_attempts = 3 WHERE max_attempts IS NULL OR max_attempts <= 0"))
        connection.execute(text(f"UPDATE agent_job_schedules SET created_at = {timestamp_default} WHERE created_at IS NULL"))
        connection.execute(text(f"UPDATE agent_job_schedules SET updated_at = {timestamp_default} WHERE updated_at IS NULL"))
        if dialect != "sqlite":
            connection.execute(text("ALTER TABLE agent_job_schedules ALTER COLUMN agent_id SET NOT NULL"))
            connection.execute(text("ALTER TABLE agent_job_schedules ALTER COLUMN status SET NOT NULL"))
            connection.execute(text("ALTER TABLE agent_job_schedules ALTER COLUMN trigger_type SET NOT NULL"))


def _acquire_schema_lock(connection) -> None:
    if connection.dialect.name == "postgresql":
        connection.execute(text("SELECT pg_advisory_xact_lock(73475001)"))


def init_db() -> None:
    from app.models import Base

    with engine.begin() as connection:
        _acquire_schema_lock(connection)
        Base.metadata.create_all(bind=connection)
        _apply_compat_migrations(connection)


def get_session() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@contextmanager
def session_scope() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
`;
}

function renderModels(): string {
  return `from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.sql import func


Base = declarative_base()


class AgentSession(Base):
    __tablename__ = "agent_sessions"

    session_id = Column(String, primary_key=True)
    agent_id = Column(String, nullable=False, index=True)
    status = Column(String, nullable=False, default="created")
    phase = Column(String, nullable=False, default="created")
    turn = Column(Integer, nullable=False, default=0)
    max_turns = Column(Integer, nullable=False, default=3)
    metadata_json = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    messages = relationship("AgentMessage", back_populates="agent_session", cascade="all, delete-orphan")
    events = relationship("AgentEvent", back_populates="agent_session", cascade="all, delete-orphan")
    jobs = relationship("AgentJob", back_populates="agent_session", cascade="all, delete-orphan")
    job_schedules = relationship("AgentJobSchedule", back_populates="agent_session", cascade="all, delete-orphan")


class AgentMessage(Base):
    __tablename__ = "agent_messages"

    message_id = Column(String, primary_key=True)
    session_id = Column(String, ForeignKey("agent_sessions.session_id"), nullable=False)
    seq = Column(Integer, nullable=False)
    role = Column(String, nullable=False)
    code = Column(String, nullable=True)
    content = Column(Text, nullable=False)
    metadata_json = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("session_id", "seq", name="uq_agent_message_seq"),
    )

    agent_session = relationship("AgentSession", back_populates="messages")


class AgentEvent(Base):
    __tablename__ = "agent_events"

    event_id = Column(String, primary_key=True)
    agent_id = Column(String, nullable=False, index=True)
    session_id = Column(String, ForeignKey("agent_sessions.session_id"), nullable=False)
    seq = Column(Integer, nullable=False)
    event_type = Column(String, nullable=False)
    node = Column(String, nullable=True)
    payload = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("session_id", "seq", name="uq_agent_event_seq"),
    )

    agent_session = relationship("AgentSession", back_populates="events")


class AgentNodeRecord(Base):
    __tablename__ = "agent_node_records"

    record_id = Column(String, primary_key=True)
    session_id = Column(String, nullable=False)
    node_id = Column(String, nullable=False)
    payload_json = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class AgentJob(Base):
    __tablename__ = "agent_jobs"

    job_id = Column(String, primary_key=True)
    agent_id = Column(String, nullable=False, index=True)
    session_id = Column(String, ForeignKey("agent_sessions.session_id"), nullable=False, index=True)
    kind = Column(String, nullable=False)
    status = Column(String, nullable=False, default="pending", index=True)
    attempts = Column(Integer, nullable=False, default=0)
    max_attempts = Column(Integer, nullable=False, default=3)
    payload_json = Column(JSON, nullable=True)
    result_json = Column(JSON, nullable=True)
    last_error_json = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    next_run_at = Column(DateTime(timezone=True), nullable=True)
    locked_by = Column(String, nullable=True, index=True)
    locked_until = Column(DateTime(timezone=True), nullable=True)
    lock_acquired_at = Column(DateTime(timezone=True), nullable=True)

    agent_session = relationship("AgentSession", back_populates="jobs")


class AgentJobSchedule(Base):
    __tablename__ = "agent_job_schedules"

    schedule_id = Column(String, primary_key=True)
    agent_id = Column(String, nullable=False, index=True)
    session_id = Column(String, ForeignKey("agent_sessions.session_id"), nullable=False, index=True)
    kind = Column(String, nullable=False)
    status = Column(String, nullable=False, default="enabled", index=True)
    trigger_type = Column(String, nullable=False, default="interval", index=True)
    interval_seconds = Column(Integer, nullable=False)
    cron_expression = Column(String, nullable=True)
    max_attempts = Column(Integer, nullable=False, default=3)
    payload_json = Column(JSON, nullable=True)
    last_job_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    last_run_at = Column(DateTime(timezone=True), nullable=True)
    next_run_at = Column(DateTime(timezone=True), nullable=True)

    agent_session = relationship("AgentSession", back_populates="job_schedules")


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_records"

    record_id = Column(String, primary_key=True)
    idempotency_key = Column(String, nullable=False)
    operation = Column(String, nullable=False)
    request_hash = Column(String, nullable=False)
    status_code = Column(Integer, nullable=False)
    response_json = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("operation", "idempotency_key", name="uq_idempotency_operation_key"),
    )
`;
}

function renderRepo(): string {
  return `import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import and_, func, or_, select, text, update
from sqlalchemy.orm import Session

from app.models import AgentEvent, AgentJob, AgentJobSchedule, AgentMessage, AgentSession, IdempotencyRecord


def new_id() -> str:
    return str(uuid.uuid4())


def check_db_health(session: Session) -> bool:
    try:
        session.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


def create_session(
    session: Session,
    *,
    agent_id: str,
    max_turns: int,
    metadata_json: dict[str, Any] | None,
) -> AgentSession:
    row = AgentSession(
        session_id=new_id(),
        agent_id=agent_id,
        status="created",
        phase="created",
        turn=0,
        max_turns=max_turns,
        metadata_json=metadata_json or {},
    )
    session.add(row)
    session.flush()
    return row


def get_session_by_id(session: Session, session_id: str) -> AgentSession | None:
    return session.get(AgentSession, session_id)


def get_session_for_update(session: Session, session_id: str) -> AgentSession | None:
    return session.execute(
        select(AgentSession).where(AgentSession.session_id == session_id).with_for_update()
    ).scalars().first()


def update_session_state(
    session: Session,
    row: AgentSession,
    *,
    status: str | None = None,
    phase: str | None = None,
    turn: int | None = None,
    completed: bool = False,
) -> AgentSession:
    if status is not None:
        row.status = status
    if phase is not None:
        row.phase = phase
    if turn is not None:
        row.turn = turn
    if completed:
        row.completed_at = func.now()
    session.flush()
    return row


def _next_message_seq(session: Session, session_id: str) -> int:
    value = session.execute(
        select(func.max(AgentMessage.seq)).where(AgentMessage.session_id == session_id)
    ).scalar()
    return int(value or 0) + 1


def append_message(
    session: Session,
    *,
    session_id: str,
    role: str,
    content: str,
    code: str | None = None,
    metadata_json: dict[str, Any] | None = None,
) -> AgentMessage:
    row = AgentMessage(
        message_id=new_id(),
        session_id=session_id,
        seq=_next_message_seq(session, session_id),
        role=role,
        code=code,
        content=content,
        metadata_json=metadata_json or {},
    )
    session.add(row)
    session.flush()
    return row


def get_transcript(session: Session, session_id: str, from_seq: int | None = None) -> list[AgentMessage]:
    stmt = select(AgentMessage).where(AgentMessage.session_id == session_id)
    if from_seq is not None:
        stmt = stmt.where(AgentMessage.seq >= from_seq)
    stmt = stmt.order_by(AgentMessage.seq.asc())
    return list(session.execute(stmt).scalars().all())


def get_recent_messages(session: Session, session_id: str, limit: int) -> list[AgentMessage]:
    stmt = (
        select(AgentMessage)
        .where(AgentMessage.session_id == session_id)
        .order_by(AgentMessage.seq.desc())
        .limit(limit)
    )
    return list(reversed(session.execute(stmt).scalars().all()))


def get_last_assistant_message(session: Session, session_id: str) -> AgentMessage | None:
    stmt = (
        select(AgentMessage)
        .where(AgentMessage.session_id == session_id, AgentMessage.role == "assistant")
        .order_by(AgentMessage.seq.desc())
    )
    return session.execute(stmt).scalars().first()


def _next_event_seq(session: Session, session_id: str) -> int:
    value = session.execute(
        select(func.max(AgentEvent.seq)).where(AgentEvent.session_id == session_id)
    ).scalar()
    return int(value or 0) + 1


def append_event(
    session: Session,
    *,
    session_id: str,
    agent_id: str,
    event_type: str,
    node: str | None = None,
    payload: dict[str, Any] | None = None,
) -> AgentEvent:
    row = AgentEvent(
        event_id=new_id(),
        agent_id=agent_id,
        session_id=session_id,
        seq=_next_event_seq(session, session_id),
        event_type=event_type,
        node=node,
        payload=payload or {},
    )
    session.add(row)
    session.flush()
    return row


def get_events(session: Session, session_id: str, from_seq: int | None = None) -> list[AgentEvent]:
    stmt = select(AgentEvent).where(AgentEvent.session_id == session_id)
    if from_seq is not None:
        stmt = stmt.where(AgentEvent.seq >= from_seq)
    stmt = stmt.order_by(AgentEvent.seq.asc())
    return list(session.execute(stmt).scalars().all())


def create_job(
    session: Session,
    *,
    agent_id: str,
    session_id: str,
    kind: str,
    payload_json: dict[str, Any] | None = None,
    max_attempts: int = 3,
) -> AgentJob:
    row = AgentJob(
        job_id=new_id(),
        agent_id=agent_id,
        session_id=session_id,
        kind=kind,
        status="pending",
        attempts=0,
        max_attempts=max(1, int(max_attempts or 1)),
        payload_json=payload_json or {},
        result_json={},
        last_error_json={},
    )
    session.add(row)
    session.flush()
    return row


def get_job_by_id(session: Session, job_id: str) -> AgentJob | None:
    return session.get(AgentJob, job_id)


def get_job_for_update(session: Session, job_id: str) -> AgentJob | None:
    return session.execute(
        select(AgentJob).where(AgentJob.job_id == job_id).with_for_update()
    ).scalars().first()


def list_jobs(
    session: Session,
    *,
    session_id: str | None = None,
    status: str | None = None,
    limit: int = 50,
) -> list[AgentJob]:
    stmt = select(AgentJob)
    if session_id:
        stmt = stmt.where(AgentJob.session_id == session_id)
    if status:
        stmt = stmt.where(AgentJob.status == status)
    stmt = stmt.order_by(AgentJob.created_at.desc()).limit(limit)
    return list(session.execute(stmt).scalars().all())


def list_due_jobs(session: Session, *, session_id: str | None = None, limit: int = 20) -> list[AgentJob]:
    now = datetime.now(timezone.utc)
    stmt = (
        select(AgentJob)
        .where(
            AgentJob.status == "pending",
            or_(AgentJob.next_run_at.is_(None), AgentJob.next_run_at <= now),
        )
    )
    if session_id:
        stmt = stmt.where(AgentJob.session_id == session_id)
    stmt = stmt.order_by(AgentJob.created_at.asc()).limit(limit)
    return list(session.execute(stmt).scalars().all())


def _due_job_claim_filter(now: datetime):
    pending_due = and_(
        AgentJob.status == "pending",
        or_(AgentJob.next_run_at.is_(None), AgentJob.next_run_at <= now),
        or_(AgentJob.locked_until.is_(None), AgentJob.locked_until <= now),
    )
    stale_running = and_(
        AgentJob.status == "running",
        AgentJob.locked_until.is_not(None),
        AgentJob.locked_until <= now,
        AgentJob.attempts < AgentJob.max_attempts,
    )
    return or_(pending_due, stale_running)


def claim_due_jobs(
    session: Session,
    *,
    worker_id: str,
    agent_id: str | None = None,
    session_id: str | None = None,
    limit: int = 20,
    lease_seconds: float = 60.0,
) -> list[AgentJob]:
    now = datetime.now(timezone.utc)
    lease_until = now + timedelta(seconds=max(1.0, float(lease_seconds or 60.0)))
    claim_filter = _due_job_claim_filter(now)
    stmt = (
        select(AgentJob.job_id)
        .where(claim_filter)
        .order_by(AgentJob.created_at.asc())
        .limit(max(1, int(limit or 1)))
        .with_for_update(skip_locked=True)
    )
    if agent_id:
        stmt = stmt.where(AgentJob.agent_id == agent_id)
    if session_id:
        stmt = stmt.where(AgentJob.session_id == session_id)
    candidate_ids = list(session.execute(stmt).scalars().all())
    claimed: list[AgentJob] = []
    for job_id in candidate_ids:
        result = session.execute(
            update(AgentJob)
            .where(AgentJob.job_id == job_id, _due_job_claim_filter(now))
            .values(
                status="running",
                attempts=func.coalesce(AgentJob.attempts, 0) + 1,
                started_at=now,
                next_run_at=None,
                locked_by=worker_id,
                locked_until=lease_until,
                lock_acquired_at=now,
                updated_at=now,
            )
        )
        if result.rowcount:
            row = session.get(AgentJob, job_id)
            if row:
                claimed.append(row)
    session.flush()
    return claimed


def create_job_schedule(
    session: Session,
    *,
    agent_id: str,
    session_id: str,
    kind: str,
    interval_seconds: int,
    trigger_type: str = "interval",
    cron_expression: str | None = None,
    payload_json: dict[str, Any] | None = None,
    max_attempts: int = 3,
    next_run_at: datetime | None = None,
) -> AgentJobSchedule:
    row = AgentJobSchedule(
        schedule_id=new_id(),
        agent_id=agent_id,
        session_id=session_id,
        kind=kind,
        status="enabled",
        trigger_type=trigger_type or "interval",
        interval_seconds=max(60, int(interval_seconds or 60)),
        cron_expression=cron_expression,
        max_attempts=max(1, int(max_attempts or 1)),
        payload_json=payload_json or {},
        last_job_id=None,
        last_run_at=None,
        next_run_at=_as_utc(next_run_at) if (trigger_type or "interval") == "event" else (_as_utc(next_run_at) or datetime.now(timezone.utc)),
    )
    session.add(row)
    session.flush()
    return row


def get_job_schedule_by_id(session: Session, schedule_id: str) -> AgentJobSchedule | None:
    return session.get(AgentJobSchedule, schedule_id)


def get_job_schedule_for_update(session: Session, schedule_id: str) -> AgentJobSchedule | None:
    return session.execute(
        select(AgentJobSchedule).where(AgentJobSchedule.schedule_id == schedule_id).with_for_update()
    ).scalars().first()


def list_job_schedules(
    session: Session,
    *,
    session_id: str | None = None,
    status: str | None = None,
    limit: int = 50,
) -> list[AgentJobSchedule]:
    stmt = select(AgentJobSchedule)
    if session_id:
        stmt = stmt.where(AgentJobSchedule.session_id == session_id)
    if status:
        stmt = stmt.where(AgentJobSchedule.status == status)
    stmt = stmt.order_by(AgentJobSchedule.created_at.desc()).limit(limit)
    return list(session.execute(stmt).scalars().all())


def list_due_job_schedules(session: Session, *, limit: int = 20) -> list[AgentJobSchedule]:
    now = datetime.now(timezone.utc)
    stmt = (
        select(AgentJobSchedule)
        .where(
            AgentJobSchedule.status == "enabled",
            AgentJobSchedule.trigger_type != "event",
            or_(AgentJobSchedule.next_run_at.is_(None), AgentJobSchedule.next_run_at <= now),
        )
        .order_by(AgentJobSchedule.next_run_at.asc(), AgentJobSchedule.created_at.asc())
        .limit(limit)
    )
    return list(session.execute(stmt).scalars().all())


def mark_job_schedule_enqueued(
    session: Session,
    row: AgentJobSchedule,
    job: AgentJob,
    *,
    next_run_at: datetime | None = None,
) -> AgentJobSchedule:
    now = datetime.now(timezone.utc)
    row.last_job_id = job.job_id
    row.last_run_at = now
    if (row.trigger_type or "interval") == "event":
        row.next_run_at = None
    else:
        row.next_run_at = next_run_at or (now + timedelta(seconds=max(60, int(row.interval_seconds or 60))))
    session.flush()
    return row


def list_event_job_schedules(
    session: Session,
    *,
    event_type: str,
    session_id: str | None = None,
    limit: int = 20,
) -> list[AgentJobSchedule]:
    stmt = (
        select(AgentJobSchedule)
        .where(
            AgentJobSchedule.status == "enabled",
            AgentJobSchedule.trigger_type == "event",
            AgentJobSchedule.cron_expression == event_type,
        )
        .order_by(AgentJobSchedule.created_at.asc())
        .limit(limit)
    )
    if session_id:
        stmt = stmt.where(AgentJobSchedule.session_id == session_id)
    return list(session.execute(stmt).scalars().all())


def disable_job_schedule(session: Session, row: AgentJobSchedule) -> AgentJobSchedule:
    row.status = "disabled"
    session.flush()
    return row


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (len(ordered) - 1) * percentile
    lower = int(rank)
    upper = min(lower + 1, len(ordered) - 1)
    weight = rank - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def get_job_metrics(session: Session, window_hours: float = 1.0) -> dict[str, Any]:
    rows = list(session.execute(select(AgentJob)).scalars().all())
    now = datetime.now(timezone.utc)
    normalized_window_hours = max(0.0, float(window_hours or 0.0))
    window_start = None if normalized_window_hours <= 0 else now - timedelta(hours=normalized_window_hours)
    by_status: dict[str, int] = {}
    by_kind: dict[str, int] = {}
    attempts_total = 0
    pending_due = 0
    exhausted = 0
    durations_ms: list[float] = []
    window_durations_ms: list[float] = []
    finished_last_hour = 0
    finished_in_window = 0
    succeeded_in_window = 0
    failed_in_window = 0
    last_finished_at: datetime | None = None
    oldest_pending_at: datetime | None = None
    next_due_at: datetime | None = None
    leased_running = 0
    expired_leases = 0

    for row in rows:
        by_status[row.status] = by_status.get(row.status, 0) + 1
        by_kind[row.kind] = by_kind.get(row.kind, 0) + 1
        attempts = int(row.attempts or 0)
        attempts_total += attempts
        next_run_at = _as_utc(row.next_run_at)
        locked_until = _as_utc(row.locked_until)
        if row.status == "pending":
            created_at = _as_utc(row.created_at)
            if created_at and (oldest_pending_at is None or created_at < oldest_pending_at):
                oldest_pending_at = created_at
            candidate_due_at = next_run_at or created_at or now
            if candidate_due_at and (next_due_at is None or candidate_due_at < next_due_at):
                next_due_at = candidate_due_at
            if next_run_at is None or next_run_at <= now:
                pending_due += 1
        if row.status == "running" and locked_until:
            if locked_until > now:
                leased_running += 1
            else:
                expired_leases += 1
        if row.status == "failed" and attempts >= int(row.max_attempts or 1):
            exhausted += 1
        started_at = _as_utc(row.started_at)
        finished_at = _as_utc(row.finished_at)
        duration_ms = None
        if started_at and finished_at and finished_at >= started_at:
            duration_ms = (finished_at - started_at).total_seconds() * 1000
            durations_ms.append(duration_ms)
        if finished_at:
            if finished_at >= now - timedelta(hours=1):
                finished_last_hour += 1
            if window_start is None or finished_at >= window_start:
                finished_in_window += 1
                if row.status == "succeeded":
                    succeeded_in_window += 1
                if row.status == "failed":
                    failed_in_window += 1
                if duration_ms is not None:
                    window_durations_ms.append(duration_ms)
            if last_finished_at is None or finished_at > last_finished_at:
                last_finished_at = finished_at

    succeeded = by_status.get("succeeded", 0)
    failed = by_status.get("failed", 0)
    terminal = succeeded + failed
    terminal_in_window = succeeded_in_window + failed_in_window

    return {
        "total": len(rows),
        "by_status": by_status,
        "by_kind": by_kind,
        "attempts_total": attempts_total,
        "pending_due": pending_due,
        "failed": failed,
        "exhausted": exhausted,
        "succeeded": succeeded,
        "terminal": terminal,
        "success_rate": (succeeded / terminal) if terminal else None,
        "duration_ms_avg": (sum(durations_ms) / len(durations_ms)) if durations_ms else None,
        "duration_ms_min": min(durations_ms) if durations_ms else None,
        "duration_ms_max": max(durations_ms) if durations_ms else None,
        "duration_ms_p95": _percentile(durations_ms, 0.95),
        "window_hours": normalized_window_hours,
        "finished_in_window": finished_in_window,
        "succeeded_in_window": succeeded_in_window,
        "failed_in_window": failed_in_window,
        "success_rate_in_window": (succeeded_in_window / terminal_in_window) if terminal_in_window else None,
        "window_duration_ms_avg": (sum(window_durations_ms) / len(window_durations_ms)) if window_durations_ms else None,
        "window_duration_ms_p95": _percentile(window_durations_ms, 0.95),
        "throughput_per_hour": (finished_in_window / normalized_window_hours) if normalized_window_hours > 0 else None,
        "oldest_pending_at": oldest_pending_at.isoformat() if oldest_pending_at else None,
        "next_due_at": next_due_at.isoformat() if next_due_at else None,
        "leased_running": leased_running,
        "expired_leases": expired_leases,
        "finished_last_hour": finished_last_hour,
        "last_finished_at": last_finished_at.isoformat() if last_finished_at else None,
    }


def list_job_cleanup_candidates(
    session: Session,
    *,
    statuses: list[str],
    cutoff: datetime,
    session_id: str | None = None,
    limit: int = 100,
) -> list[AgentJob]:
    stmt = (
        select(AgentJob)
        .where(
            AgentJob.status.in_(statuses),
            AgentJob.finished_at.is_not(None),
            AgentJob.finished_at <= _as_utc(cutoff),
        )
        .order_by(AgentJob.finished_at.asc(), AgentJob.created_at.asc())
        .limit(max(1, int(limit or 1)))
    )
    if session_id:
        stmt = stmt.where(AgentJob.session_id == session_id)
    return list(session.execute(stmt).scalars().all())


def delete_jobs(session: Session, rows: list[AgentJob]) -> None:
    for row in rows:
        session.delete(row)
    session.flush()


def mark_job_running(session: Session, row: AgentJob) -> AgentJob:
    row.status = "running"
    row.attempts = int(row.attempts or 0) + 1
    row.started_at = func.now()
    row.next_run_at = None
    session.flush()
    return row


def mark_job_finished(
    session: Session,
    row: AgentJob,
    *,
    status: str,
    result_json: dict[str, Any],
) -> AgentJob:
    now = datetime.now(timezone.utc)
    row.status = status
    row.result_json = result_json
    row.last_error_json = {} if status == "succeeded" else result_json
    if row.started_at is None:
        row.started_at = now
    row.finished_at = now
    row.next_run_at = None
    row.locked_by = None
    row.locked_until = None
    row.lock_acquired_at = None
    session.flush()
    return row


def mark_job_retry(
    session: Session,
    row: AgentJob,
    *,
    error_json: dict[str, Any],
    delay_seconds: float,
) -> AgentJob:
    row.status = "pending"
    row.result_json = error_json
    row.last_error_json = error_json
    row.next_run_at = datetime.now(timezone.utc) + timedelta(seconds=max(0.0, float(delay_seconds)))
    row.locked_by = None
    row.locked_until = None
    row.lock_acquired_at = None
    session.flush()
    return row


def reset_job_for_retry(session: Session, row: AgentJob, *, reset_attempts: bool = True) -> AgentJob:
    row.status = "pending"
    row.result_json = {}
    row.last_error_json = {}
    row.next_run_at = None
    row.started_at = None
    row.finished_at = None
    row.locked_by = None
    row.locked_until = None
    row.lock_acquired_at = None
    if reset_attempts:
        row.attempts = 0
    session.flush()
    return row


def schedule_job(session: Session, row: AgentJob, *, run_at: datetime) -> AgentJob:
    scheduled_at = _as_utc(run_at) or datetime.now(timezone.utc)
    row.status = "pending"
    row.next_run_at = scheduled_at
    row.started_at = None
    row.finished_at = None
    row.locked_by = None
    row.locked_until = None
    row.lock_acquired_at = None
    session.flush()
    return row


def get_idempotency_record(
    session: Session,
    *,
    operation: str,
    idempotency_key: str,
) -> IdempotencyRecord | None:
    return session.execute(
        select(IdempotencyRecord).where(
            IdempotencyRecord.operation == operation,
            IdempotencyRecord.idempotency_key == idempotency_key,
        )
    ).scalars().first()


def save_idempotency_record(
    session: Session,
    *,
    operation: str,
    idempotency_key: str,
    request_hash: str,
    status_code: int,
    response_json: dict[str, Any],
) -> IdempotencyRecord:
    row = IdempotencyRecord(
        record_id=new_id(),
        operation=operation,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        status_code=status_code,
        response_json=response_json,
    )
    session.add(row)
    session.flush()
    return row
`;
}

function renderCache(flow: AgentFlow): string {
  const cachePrefix = `${slug(flow.id)}-runtime`;
  return `import json
from typing import Any

import redis

from app.settings import Settings


CACHE_PREFIX = ${pyString(cachePrefix)}


class InMemoryCache:
    def __init__(self) -> None:
        self._store: dict[str, str] = {}

    def get_json(self, key: str) -> Any | None:
        raw = self._store.get(key)
        return json.loads(raw) if raw else None

    def set_json(self, key: str, value: Any, ttl_seconds: int | None = None) -> None:
        self._store[key] = json.dumps(value, ensure_ascii=False)

    def delete(self, *keys: str) -> None:
        for key in keys:
            self._store.pop(key, None)

    def ping(self) -> bool:
        return True


class RedisCache:
    def __init__(self, redis_url: str) -> None:
        self._client = redis.Redis.from_url(redis_url, decode_responses=True)

    def get_json(self, key: str) -> Any | None:
        raw = self._client.get(key)
        return json.loads(raw) if raw else None

    def set_json(self, key: str, value: Any, ttl_seconds: int | None = None) -> None:
        self._client.set(key, json.dumps(value, ensure_ascii=False), ex=ttl_seconds)

    def delete(self, *keys: str) -> None:
        if keys:
            self._client.delete(*keys)

    def ping(self) -> bool:
        return bool(self._client.ping())


def recent_key(session_id: str) -> str:
    return f"{CACHE_PREFIX}:{session_id}:recent"


def build_cache(settings: Settings):
    if settings.redis_enabled:
        return RedisCache(settings.redis_url)
    return InMemoryCache()
`;
}

function renderIdempotency(): string {
  return `import hashlib
import json
from datetime import datetime
from typing import Any, Callable

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import repo


def normalize_idempotency_key(header_value: str | None, body_value: str | None) -> str:
    header = (header_value or "").strip()
    body = (body_value or "").strip()
    if header and body and header != body:
        raise HTTPException(
            status_code=400,
            detail="Header Idempotency-Key e campo idempotency_key possuem valores diferentes.",
        )
    key = header or body
    if not key:
        raise HTTPException(status_code=400, detail="Idempotency-Key é obrigatório para esta operação.")
    return key


def request_hash(payload: dict[str, Any]) -> str:
    cleaned = {key: value for key, value in payload.items() if key != "idempotency_key"}
    raw = json.dumps(cleaned, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def run_idempotent(
    session: Session,
    *,
    operation: str,
    idempotency_key: str,
    payload: dict[str, Any],
    handler: Callable[[], dict[str, Any]],
) -> dict[str, Any]:
    current_hash = request_hash(payload)
    existing = repo.get_idempotency_record(
        session,
        operation=operation,
        idempotency_key=idempotency_key,
    )
    if existing:
        if existing.request_hash != current_hash:
            raise HTTPException(
                status_code=409,
                detail="Chave de idempotência já usada com payload diferente.",
            )
        return dict(existing.response_json)

    response = handler()
    repo.save_idempotency_record(
        session,
        operation=operation,
        idempotency_key=idempotency_key,
        request_hash=current_hash,
        status_code=200,
        response_json=response,
    )
    return response
`;
}

function renderSafety(): string {
  return `import json
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Literal


Decision = Literal["allow", "block", "safe_redirect"]
Action = Literal["warn", "safe_redirect", "block"]


@dataclass(frozen=True)
class SafetyDecision:
    blocked: bool
    decision: Decision
    category: str | None = None
    reason: str | None = None
    safe_response: str | None = None
    severity: str | None = None
    action: str | None = None
    rule_id: str | None = None
    rule_label: str | None = None
    match_type: str | None = None
    matched_text: str | None = None
    source: str = "local"
    provider_score: float | None = None
    provider_error: str | None = None


class SafetyGate:
    def __init__(self) -> None:
        self._severity_score = {"low": 1, "medium": 2, "high": 3, "critical": 4}
        self._provider_enabled = self._env_bool("SAFETY_PROVIDER_ENABLED", False)
        self._provider_url = os.getenv("SAFETY_PROVIDER_URL", "").strip()
        self._provider_timeout_seconds = self._env_float("SAFETY_PROVIDER_TIMEOUT_SECONDS", 3.0)
        self._provider_fail_closed = self._env_bool("SAFETY_PROVIDER_FAIL_CLOSED", False)
        self._provider_headers = self._load_provider_headers(os.getenv("SAFETY_PROVIDER_HEADERS_JSON", ""))
        self._default_input_rules = [
            {
                "id": "empty_input",
                "matchType": "empty",
                "match": "",
                "category": "empty_input",
                "action": "safe_redirect",
                "reason": "Mensagem vazia.",
                "safeResponse": "Envie uma mensagem com conteúdo para continuarmos.",
            },
            {
                "id": "self_harm_1",
                "matchType": "contains",
                "match": "vou me matar",
                "category": "self_harm",
                "action": "block",
                "reason": "Termo sensível detectado: vou me matar",
                "safeResponse": (
                    "Sinto muito que você esteja passando por isso. "
                    "Procure apoio humano imediato. Se houver risco agora, ligue 188, 192 ou 190."
                ),
            },
            {
                "id": "self_harm_2",
                "matchType": "contains",
                "match": "quero me matar",
                "category": "self_harm",
                "action": "block",
                "reason": "Termo sensível detectado: quero me matar",
                "safeResponse": (
                    "Sinto muito que você esteja passando por isso. "
                    "Procure apoio humano imediato. Se houver risco agora, ligue 188, 192 ou 190."
                ),
            },
            {
                "id": "self_harm_3",
                "matchType": "contains",
                "match": "não aguento mais viver",
                "category": "self_harm",
                "action": "block",
                "reason": "Termo sensível detectado: não aguento mais viver",
                "safeResponse": (
                    "Sinto muito que você esteja passando por isso. "
                    "Procure apoio humano imediato. Se houver risco agora, ligue 188, 192 ou 190."
                ),
            },
            {
                "id": "self_harm_4",
                "matchType": "contains",
                "match": "nao aguento mais viver",
                "category": "self_harm",
                "action": "block",
                "reason": "Termo sensível detectado: nao aguento mais viver",
                "safeResponse": (
                    "Sinto muito que você esteja passando por isso. "
                    "Procure apoio humano imediato. Se houver risco agora, ligue 188, 192 ou 190."
                ),
            },
            {
                "id": "jailbreak_1",
                "matchType": "contains",
                "match": "ignore as regras",
                "category": "jailbreak",
                "action": "safe_redirect",
                "reason": "Termo bloqueado detectado: ignore as regras",
                "safeResponse": "Não posso seguir com esse pedido, mas posso continuar com uma resposta segura.",
            },
            {
                "id": "jailbreak_2",
                "matchType": "contains",
                "match": "ignore o sistema",
                "category": "jailbreak",
                "action": "safe_redirect",
                "reason": "Termo bloqueado detectado: ignore o sistema",
                "safeResponse": "Não posso seguir com esse pedido, mas posso continuar com uma resposta segura.",
            },
            {
                "id": "policy_leak_1",
                "matchType": "contains",
                "match": "vazar prompt",
                "category": "policy_leak",
                "action": "safe_redirect",
                "reason": "Termo bloqueado detectado: vazar prompt",
                "safeResponse": "Não posso seguir com esse pedido, mas posso continuar com uma resposta segura.",
            },
            {
                "id": "secret_request_1",
                "matchType": "contains",
                "match": "senha secreta",
                "category": "secret_request",
                "action": "safe_redirect",
                "reason": "Termo bloqueado detectado: senha secreta",
                "safeResponse": "Não posso seguir com esse pedido, mas posso continuar com uma resposta segura.",
            },
        ]
        self._default_output_rules = [
            {
                "id": "policy_leak_output_1",
                "matchType": "contains",
                "match": "system prompt",
                "category": "policy_leak",
                "action": "safe_redirect",
                "reason": "A saída tentou expor detalhes operacionais.",
                "safeResponse": "Posso responder sem expor detalhes internos do agente.",
            },
            {
                "id": "policy_leak_output_2",
                "matchType": "contains",
                "match": "chave interna",
                "category": "policy_leak",
                "action": "safe_redirect",
                "reason": "A saída tentou expor detalhes operacionais.",
                "safeResponse": "Posso responder sem expor detalhes internos do agente.",
            },
        ]

    def check_input(self, text: str, config: dict[str, Any] | None = None) -> SafetyDecision:
        return self.check(text, stage="input", config=config)

    def check_output(self, text: str, config: dict[str, Any] | None = None) -> SafetyDecision:
        return self.check(text, stage="output", config=config)

    def check(self, text: str, *, stage: str, config: dict[str, Any] | None = None) -> SafetyDecision:
        normalized = (text or "").strip().lower()
        mode = str((config or {}).get("safetyMode") or "default_and_custom")
        rules: list[dict[str, Any]] = []
        if mode in {"default", "default_and_custom"}:
            rules.extend(self._default_input_rules if stage == "input" else self._default_output_rules)
        if mode in {"custom", "default_and_custom"}:
            custom_rules = (config or {}).get("safetyRules")
            if isinstance(custom_rules, list):
                rules.extend([rule for rule in custom_rules if isinstance(rule, dict)])
        threshold = str((config or {}).get("safetySeverityThreshold") or "low")
        fallback_response = str((config or {}).get("safetyFallbackResponse") or "").strip()
        for rule in rules:
            decision = self._evaluate_rule(rule, text or "", normalized, threshold, fallback_response)
            if decision is not None:
                return decision
        external_decision = self._check_external_provider(
            text or "",
            stage=stage,
            config=config or {},
            fallback_response=fallback_response,
        )
        if external_decision is not None:
            return external_decision
        return SafetyDecision(blocked=False, decision="allow")

    def _check_external_provider(
        self,
        text: str,
        *,
        stage: str,
        config: dict[str, Any],
        fallback_response: str,
    ) -> SafetyDecision | None:
        if not self._provider_enabled or not self._provider_url:
            return None

        payload = {
            "text": text,
            "stage": stage,
            "nodeId": str(config.get("id") or ""),
            "policy": {
                "mode": config.get("safetyMode"),
                "severityThreshold": config.get("safetySeverityThreshold"),
                "fallbackResponse": config.get("safetyFallbackResponse"),
                "rules": config.get("safetyRules") if isinstance(config.get("safetyRules"), list) else [],
            },
            "local": {"blocked": False, "decision": "allow"},
        }
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers = {"Content-Type": "application/json", **self._provider_headers}
        request = urllib.request.Request(self._provider_url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=self._provider_timeout_seconds) as response:
                raw_body = response.read(1_000_000).decode("utf-8")
            data = json.loads(raw_body or "{}")
        except (OSError, TimeoutError, ValueError, urllib.error.URLError) as exc:
            if self._provider_fail_closed:
                return SafetyDecision(
                    blocked=True,
                    decision="safe_redirect",
                    category="external_safety_unavailable",
                    reason=f"Provider externo de safety indisponível: {exc}",
                    safe_response=fallback_response or "A política de segurança externa precisa responder antes de continuar.",
                    severity="high",
                    action="safe_redirect",
                    source="external",
                    provider_error=str(exc),
                )
            return SafetyDecision(
                blocked=False,
                decision="allow",
                category="external_safety_unavailable",
                reason=f"Provider externo de safety indisponível: {exc}",
                source="external",
                provider_error=str(exc),
            )

        if not isinstance(data, dict):
            if self._provider_fail_closed:
                return SafetyDecision(
                    blocked=True,
                    decision="safe_redirect",
                    category="external_safety_invalid_response",
                    reason="Provider externo de safety retornou payload inválido.",
                    safe_response=fallback_response or "A política de segurança externa precisa ser revisada antes de continuar.",
                    severity="high",
                    action="safe_redirect",
                    source="external",
                    provider_error="invalid_response",
                )
            return SafetyDecision(
                blocked=False,
                decision="allow",
                category="external_safety_invalid_response",
                reason="Provider externo de safety retornou payload inválido.",
                source="external",
                provider_error="invalid_response",
            )
        return self._decision_from_provider(data, fallback_response)

    def _decision_from_provider(self, data: dict[str, Any], fallback_response: str) -> SafetyDecision:
        raw_decision = str(data.get("decision") or "").strip().lower()
        blocked = bool(data.get("blocked"))
        if raw_decision in {"block", "safe_redirect"}:
            blocked = True
            decision: Decision = "block" if raw_decision == "block" else "safe_redirect"
        elif blocked:
            decision = "safe_redirect"
        else:
            decision = "allow"

        score = self._optional_float(data.get("score") if "score" in data else data.get("providerScore"))
        return SafetyDecision(
            blocked=blocked,
            decision=decision,
            category=str(data.get("category") or ("external_safety_policy" if blocked else "external_safety_allow")),
            reason=str(data.get("reason") or ("Provider externo bloqueou a mensagem." if blocked else "Provider externo permitiu a mensagem.")),
            safe_response=str(
                data.get("safeResponse")
                or data.get("safe_response")
                or fallback_response
                or "Não posso seguir com esse pedido, mas posso continuar com uma resposta segura."
            ) if blocked else None,
            severity=str(data.get("severity") or ("high" if blocked else "low")),
            action=str(data.get("action") or ("safe_redirect" if blocked else "allow")),
            rule_id=str(data.get("ruleId") or data.get("rule_id") or ""),
            rule_label=str(data.get("ruleLabel") or data.get("rule_label") or ""),
            source="external",
            provider_score=score,
        )

    def _load_provider_headers(self, raw_headers: str) -> dict[str, str]:
        if not raw_headers.strip():
            return {}
        try:
            decoded = json.loads(raw_headers)
        except ValueError:
            return {}
        if not isinstance(decoded, dict):
            return {}
        return {str(key): str(value) for key, value in decoded.items() if str(key).strip()}

    def _env_bool(self, name: str, default: bool) -> bool:
        value = os.getenv(name)
        if value is None:
            return default
        return value.strip().lower() in {"1", "true", "yes", "on"}

    def _env_float(self, name: str, default: float) -> float:
        value = os.getenv(name)
        if value is None:
            return default
        try:
            return max(0.1, float(value))
        except ValueError:
            return default

    def _optional_float(self, value: Any) -> float | None:
        if value is None or value == "":
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _evaluate_rule(
        self,
        rule: dict[str, Any],
        raw_text: str,
        normalized: str,
        threshold: str,
        fallback_response: str,
    ) -> SafetyDecision | None:
        match_type = str(rule.get("matchType") or rule.get("match_type") or "contains")
        pattern = str(rule.get("match") or "")
        matched_text: str | None = None
        if match_type == "empty":
            if normalized:
                return None
            matched_text = ""
        elif match_type == "regex":
            try:
                match = re.search(pattern, raw_text, flags=re.IGNORECASE)
            except re.error as exc:
                return SafetyDecision(
                    blocked=True,
                    decision="safe_redirect",
                    category="invalid_safety_rule",
                    reason=f"Regex inválida na regra {rule.get('id') or 'sem_id'}: {exc}",
                    safe_response=fallback_response or "A política de segurança precisa ser revisada antes de continuar.",
                    severity="high",
                    action="safe_redirect",
                    rule_id=str(rule.get("id") or ""),
                    rule_label=str(rule.get("label") or ""),
                    match_type=match_type,
                    matched_text=pattern,
                )
            if not match:
                return None
            matched_text = match.group(0)
        else:
            if pattern.lower() not in normalized:
                return None
            matched_text = pattern

        action = str(rule.get("action") or "safe_redirect")
        severity = str(rule.get("severity") or "medium")
        if self._severity_score.get(severity, 2) < self._severity_score.get(threshold, 1):
            action = "warn"
        if action == "warn":
            return SafetyDecision(
                blocked=False,
                decision="allow",
                category=str(rule.get("category") or "safety_warning"),
                reason=str(rule.get("reason") or f"Regra de safety acionada em modo aviso: {rule.get('id') or matched_text}."),
                severity=severity,
                action=action,
                rule_id=str(rule.get("id") or ""),
                rule_label=str(rule.get("label") or ""),
                match_type=match_type,
                matched_text=matched_text,
            )
        decision: Decision = "block" if action == "block" else "safe_redirect"
        return SafetyDecision(
            blocked=True,
            decision=decision,
            category=str(rule.get("category") or "safety_policy"),
            reason=str(rule.get("reason") or f"Regra de safety acionada: {rule.get('id') or matched_text}."),
            safe_response=str(rule.get("safeResponse") or fallback_response or "Não posso seguir com esse pedido, mas posso continuar com uma resposta segura."),
            severity=severity,
            action=action,
            rule_id=str(rule.get("id") or ""),
            rule_label=str(rule.get("label") or ""),
            match_type=match_type,
            matched_text=matched_text,
        )
`;
}

function renderLlm(flow: AgentFlow): string {
  const adapter = flow.llm.adapter.toLowerCase();
  const defaultBaseUrl = findLlmAdapter(adapter)?.defaultBaseUrl ?? "";
  const defaultApiKey = findLlmAdapter(adapter)?.defaultApiKey ?? "";
  return `import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from openai import OpenAI

from app.settings import Settings


@dataclass(frozen=True)
class LLMResult:
    text: str
    provider: str
    model: str
    attempts: int
    fallback_reason: str | None = None
    setup_command: str | None = None
    docker_setup_command: str | None = None
    provider_error: str | None = None


class LLMClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def generate(
        self,
        *,
        system_prompt: str,
        user_message: str,
        context: dict[str, Any],
        recent_messages: list[dict[str, str]],
        adapter: str | None = None,
        model: str | None = None,
        token_callback: Any | None = None,
    ) -> LLMResult:
        selected_adapter = (adapter or self.settings.llm_adapter).strip()
        selected_model = (model or self.settings.openai_model).strip()
        if self.settings.mock_llm:
            text = (
                "Recebi sua mensagem e mantive o fluxo do agente ativo. "
                f"Você disse: {user_message}"
            )
            if callable(token_callback):
                for chunk in _iter_text_stream_chunks(text):
                    token_callback(chunk)
            return LLMResult(
                text=text,
                provider="mock",
                model=selected_model or "mock",
                attempts=1,
            )

        default_api_keys = json.loads(${pyJson(llmAdapterDefaultApiKeys())})
        default_base_urls = json.loads(${pyJson(llmAdapterDefaultBaseUrls())})
        client_kwargs: dict[str, Any] = {
            "api_key": self.settings.openai_api_key.strip()
            or default_api_keys.get(selected_adapter.lower(), ${pyString(defaultApiKey)})
        }
        base_url = self.settings.openai_base_url.strip() or default_base_urls.get(selected_adapter.lower(), ${pyString(defaultBaseUrl)})
        if base_url:
            client_kwargs["base_url"] = base_url
        client = OpenAI(**client_kwargs)

        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(recent_messages)
        messages.append(
            {
                "role": "user",
                "content": json.dumps(
                    {"context": context, "user_message": user_message},
                    ensure_ascii=False,
                ),
            }
        )

        max_attempts = max(1, int(self.settings.llm_max_retries or 1))
        last_error: Exception | None = None
        for attempt in range(1, max_attempts + 1):
            try:
                has_token_callback = callable(token_callback)
                if has_token_callback:
                    stream_response = client.responses.create(
                        model=selected_model,
                        input=messages,
                        stream=True,
                    )
                    stream_chunks: list[str] = []
                    for raw_chunk in stream_response:
                        chunk = _extract_llm_stream_text(raw_chunk)
                        if chunk:
                            stream_chunks.append(chunk)
                            token_callback(chunk)
                    response_text = "".join(stream_chunks).strip()
                    if response_text:
                        return LLMResult(
                            text=response_text,
                            provider=selected_adapter,
                            model=selected_model,
                            attempts=attempt,
                        )
                    response = client.responses.create(
                        model=selected_model,
                        input=messages,
                    )
                else:
                    response = client.responses.create(
                        model=selected_model,
                        input=messages,
                    )

                return LLMResult(
                    text=(response.output_text or "").strip() or "Sem resposta do modelo.",
                    provider=selected_adapter,
                    model=selected_model,
                    attempts=attempt,
                )
            except Exception as exc:
                last_error = exc
                if _is_ollama_missing_model_error(exc, selected_adapter):
                    return _ollama_missing_model_result(
                        model=selected_model,
                        provider=selected_adapter,
                        attempts=attempt,
                        error=exc,
                        token_callback=token_callback,
                    )
                if attempt < max_attempts:
                    time.sleep(min(0.25 * attempt, 1.0))
        raise RuntimeError(f"Falha ao chamar LLM após {max_attempts} tentativa(s): {last_error}") from last_error


def _iter_text_stream_chunks(text: str):
    for chunk in re.findall(r"\\S+\\s*", text):
        if chunk:
            yield chunk


def _extract_llm_stream_text(raw_chunk: Any) -> str:
    if raw_chunk is None:
        return ""
    payload: Any = raw_chunk
    if hasattr(payload, "model_dump"):
        try:
            payload = payload.model_dump()
        except Exception:
            payload = getattr(payload, "__dict__", {})
    elif not isinstance(payload, dict):
        try:
            payload = dict(payload)
        except Exception:
            return ""
    if not isinstance(payload, dict):
        return ""
    chunk_type = str(payload.get("type") or payload.get("event_type") or "")
    if not chunk_type.endswith("delta"):
        return ""
    candidate = payload.get("delta")
    if isinstance(candidate, dict):
        value = candidate.get("text")
    else:
        value = candidate
    if not isinstance(value, str):
        value = payload.get("text")
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return str(value.get("text") or "")
    return ""


def _is_ollama_missing_model_error(exc: Exception, adapter: str) -> bool:
    if adapter.strip().lower() != "ollama":
        return False
    text = _exception_text(exc).lower()
    if "model" not in text:
        return False
    missing_markers = (
        "not found",
        "not installed",
        "pull",
        "does not exist",
        "no such model",
        "modelo",
    )
    return any(marker in text for marker in missing_markers)


def _exception_text(exc: Exception) -> str:
    parts = [str(exc)]
    for attr in ("body", "response", "status_code"):
        value = getattr(exc, attr, None)
        if value is not None:
            parts.append(str(value))
    return " ".join(parts)


def _ollama_missing_model_result(
    *,
    model: str,
    provider: str,
    attempts: int,
    error: Exception,
    token_callback: Any | None,
) -> LLMResult:
    setup_command = f"ollama pull {model}"
    docker_setup_command = f"docker compose --profile model-setup up {_ollama_pull_service_name(model)}"
    text = (
        f"O modelo local {model} ainda não está disponível no Ollama. "
        f"Baixe o modelo com '{setup_command}' ou, no pacote Docker gerado, rode "
        f"'{docker_setup_command}'. Depois execute o turno novamente."
    )
    if callable(token_callback):
        for chunk in _iter_text_stream_chunks(text):
            token_callback(chunk)
    return LLMResult(
        text=text,
        provider=provider,
        model=model,
        attempts=attempts,
        fallback_reason="local_model_missing",
        setup_command=setup_command,
        docker_setup_command=docker_setup_command,
        provider_error=_exception_text(error)[:500],
    )


def _ollama_pull_service_name(model: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", f"ollama-pull-{model}".lower()).strip("-")
    return slug or "ollama-pull-model"


def load_prompt(name: str = "system.md") -> str:
    path = Path(__file__).resolve().parent / "prompts" / name
    return path.read_text(encoding="utf-8").strip()
`;
}

function renderGraph(flow: AgentFlow, plan: RuntimePlan): string {
  return `import atexit
import inspect
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.error
import urllib.request
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, TypedDict
from uuid import uuid4

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from sqlalchemy import text

from app.db import session_scope
from app.llm import LLMClient, load_prompt
from app.models import AgentNodeRecord
from app.safety import SafetyGate
from app.settings import Settings


NODE_CONFIGS = json.loads(${pyJson(plan.nodes)})
NODE_CONFIG_BY_ID = {item["id"]: item for item in NODE_CONFIGS}
RAW_ACTION_ROUTE_MAP = json.loads(${pyJson(plan.actionRoutes)})
DEFAULT_ACTION_ROUTE = ${pyString(plan.defaultActionRoute)}
DEFAULT_PROMPT_FILE = ${pyString(plan.defaultPromptFile)}
DIRECT_NODE_EDGES_RAW = json.loads(${pyJson(plan.directNodeEdges)})
NODE_ROUTE_MAP_RAW = json.loads(${pyJson(plan.nodeRouteMap)})
NODE_ROUTE_CONDITIONS = json.loads(${pyJson(plan.nodeRouteConditions)})
START_MESSAGE = ${pyString(`Olá! Este é o ${flow.name}. Envie uma mensagem para eu ecoar o fluxo com segurança, LLM e estado.`)}
CURRENT_DB_SESSION = ContextVar("CURRENT_DB_SESSION", default=None)
CURRENT_EVENT_SINK = ContextVar("CURRENT_EVENT_SINK", default=None)
CURRENT_TOKEN_STREAM = ContextVar("CURRENT_TOKEN_STREAM", default=None)
FILES_ROOT = Path(__file__).resolve().parent / "files"
CODE_ROOT = Path(__file__).resolve().parent / "code"


@contextmanager
def graph_session_scope():
    current = CURRENT_DB_SESSION.get()
    if current is not None:
        yield current
    else:
        with session_scope() as db:
            yield db


def _node_ids(*, node_type: str, stage: str | None = None) -> list[str]:
    result = []
    for item in NODE_CONFIGS:
        if item["type"] != node_type:
            continue
        if stage is not None and item.get("stage") != stage:
            continue
        result.append(item["id"])
    return result


START_NODE_IDS = _node_ids(node_type="start")
FINISH_NODE_IDS = _node_ids(node_type="end")
INPUT_SAFETY_NODE_IDS = _node_ids(node_type="safety_gate", stage="input")
OUTPUT_SAFETY_NODE_IDS = _node_ids(node_type="safety_gate", stage="output")
LLM_NODE_IDS = [
    item["id"]
    for item in NODE_CONFIGS
    if item["type"] in {"llm_prompt", "llm_structured"}
]
CODE_NODE_IDS = _node_ids(node_type="code")
SWITCH_NODE_IDS = _node_ids(node_type="switch")
HUMAN_INPUT_NODE_IDS = _node_ids(node_type="human_input")
HTTP_REQUEST_NODE_IDS = _node_ids(node_type="http_request")
TRANSFORM_JSON_NODE_IDS = _node_ids(node_type="transform_json")
DATABASE_QUERY_NODE_IDS = _node_ids(node_type="database_query")
DATABASE_SAVE_NODE_IDS = _node_ids(node_type="database_save")
FILE_EXTRACT_NODE_IDS = _node_ids(node_type="file_extract")
RAG_RETRIEVAL_NODE_IDS = _node_ids(node_type="rag_retrieval")
APPROVAL_GATE_NODE_IDS = _node_ids(node_type="approval_gate")
SCORING_NODE_IDS = _node_ids(node_type="scoring")
ANALYTICS_NODE_IDS = _node_ids(node_type="analytics")


class ReferenceState(TypedDict, total=False):
    action: Literal["start", "turn", "finish"]
    session_id: str
    agent_id: str
    status: str
    phase: str
    turn: int
    max_turns: int
    user_message: str
    recent_messages: list[dict[str, str]]
    assistant_message: dict[str, str]
    safety: dict[str, Any]
    llm: dict[str, Any]
    http: dict[str, Any]
    transforms: dict[str, Any]
    database: dict[str, Any]
    files: dict[str, Any]
    rag: dict[str, Any]
    approvals: dict[str, Any]
    scores: dict[str, Any]
    analytics: dict[str, Any]
    custom: dict[str, Any]
    session_metadata: dict[str, Any]
    is_complete: bool
    executed_nodes: list[str]


def build_checkpointer(settings: Settings):
    if settings.use_postgres_checkpointer:
        try:
            from langgraph.checkpoint.postgres import PostgresSaver

            url = settings.database_url.replace("postgresql+psycopg2://", "postgresql://")
            manager = PostgresSaver.from_conn_string(url)
            if hasattr(manager, "__enter__"):
                saver = manager.__enter__()
                atexit.register(manager.__exit__, None, None, None)
            else:
                saver = manager
            saver.setup()
            return saver
        except Exception:
            if not settings.mock_llm:
                raise
    return MemorySaver()


def build_graph(
    *,
    settings: Settings,
    llm_client: LLMClient,
    safety_gate: SafetyGate,
    checkpointer,
):
    prompt_cache: dict[str, str] = {}

    def normalize_graph_target(target: str):
        return END if target == "end" else target

    raw_action_map = dict(RAW_ACTION_ROUTE_MAP)
    raw_action_map["__default__"] = DEFAULT_ACTION_ROUTE
    action_route_map = {key: normalize_graph_target(value) for key, value in raw_action_map.items()}
    direct_node_edges = {key: normalize_graph_target(value) for key, value in DIRECT_NODE_EDGES_RAW.items()}
    node_route_map = {
        node_id: {key: normalize_graph_target(value) for key, value in route_map.items()}
        for node_id, route_map in NODE_ROUTE_MAP_RAW.items()
    }

    def route_action(state: ReferenceState) -> str:
        action = state.get("action", "turn")
        return action if action in action_route_map else "__default__"

    def prompt_for_node(config: dict[str, Any]) -> str:
        prompt_file = str(config.get("promptFile") or DEFAULT_PROMPT_FILE)
        if prompt_file not in prompt_cache:
            prompt_cache[prompt_file] = load_prompt(prompt_file)
        return prompt_cache[prompt_file]

    def mark_node(state: ReferenceState, node_id: str, updates: ReferenceState) -> ReferenceState:
        executed = list(state.get("executed_nodes") or [])
        executed.append(node_id)
        return {**updates, "executed_nodes": executed}

    def emit_graph_event(event_type: str, node_id: str, payload: dict[str, Any]) -> None:
        sink = CURRENT_EVENT_SINK.get()
        if not callable(sink):
            return
        try:
            sink(event_type, node_id, jsonable(payload))
        except Exception:
            return

    def trace_node(config: dict[str, Any], handler):
        node_id = str(config["id"])
        node_type = str(config.get("type") or "node")

        def run(state: ReferenceState) -> ReferenceState:
            span_id = str(uuid4())
            started_perf = time.perf_counter()
            started_at = datetime.now(timezone.utc)
            base_payload = {
                "span_id": span_id,
                "node_id": node_id,
                "node_type": node_type,
                "action": state.get("action"),
                "phase": state.get("phase"),
                "turn": state.get("turn"),
                "source": "runtime_native_span",
            }
            emit_graph_event("span_started", node_id, {**base_payload, "status": "running", "started_at": started_at.isoformat()})
            try:
                result = handler(state)
            except Exception as exc:
                finished_at = datetime.now(timezone.utc)
                duration_ms = round((time.perf_counter() - started_perf) * 1000, 3)
                emit_graph_event(
                    "span_completed",
                    node_id,
                    {
                        **base_payload,
                        "status": "error",
                        "started_at": started_at.isoformat(),
                        "finished_at": finished_at.isoformat(),
                        "duration_ms": duration_ms,
                        "error": str(exc),
                        "span": {
                            "id": span_id,
                            "name": f"node.{node_type}",
                            "operation": "graph_node",
                            "node_id": node_id,
                            "node_type": node_type,
                            "status": "error",
                            "started_at": started_at.isoformat(),
                            "finished_at": finished_at.isoformat(),
                            "duration_ms": duration_ms,
                        },
                    },
                )
                raise
            finished_at = datetime.now(timezone.utc)
            duration_ms = round((time.perf_counter() - started_perf) * 1000, 3)
            status = "error" if isinstance(result, dict) and result.get("status") == "error" else "ok"
            emit_graph_event(
                "span_completed",
                node_id,
                {
                    **base_payload,
                    "status": status,
                    "started_at": started_at.isoformat(),
                    "finished_at": finished_at.isoformat(),
                    "duration_ms": duration_ms,
                    "span": {
                        "id": span_id,
                        "name": f"node.{node_type}",
                        "operation": "graph_node",
                        "node_id": node_id,
                        "node_type": node_type,
                        "status": status,
                        "started_at": started_at.isoformat(),
                        "finished_at": finished_at.isoformat(),
                        "duration_ms": duration_ms,
                    },
                },
            )
            return result

        return run

    def state_path_value(state: ReferenceState, path: str):
        if not path or str(path).strip() in {"state", "."}:
            return state
        current: Any = state
        normalized = str(path or "").removeprefix("state.")
        for part in normalized.split("."):
            if not part:
                continue
            if isinstance(current, dict):
                current = current.get(part)
            else:
                current = getattr(current, part, None)
            if current is None:
                return None
        return current

    def assign_state_path(updates: dict[str, Any], state: ReferenceState, path: str, value: Any) -> None:
        parts = [part for part in str(path or "").removeprefix("state.").split(".") if part]
        if not parts:
            return
        root_key = parts[0]
        if len(parts) == 1:
            updates[root_key] = value
            return
        root = updates.get(root_key)
        if not isinstance(root, dict):
            source_root = state.get(root_key)
            root = dict(source_root) if isinstance(source_root, dict) else {}
            updates[root_key] = root
        current = root
        for part in parts[1:-1]:
            child = current.get(part)
            if not isinstance(child, dict):
                child = {}
                current[part] = child
            current = child
        current[parts[-1]] = value

    def jsonable(value: Any) -> Any:
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        if isinstance(value, (list, tuple)):
            return [jsonable(item) for item in value]
        if isinstance(value, dict):
            return {str(key): jsonable(item) for key, item in value.items()}
        return str(value)

    REDACTED_VALUE = "***REDACTED***"

    def config_string_list(config: dict[str, Any], key: str) -> list[str]:
        value = config.get(key)
        if isinstance(value, str):
            return [item.strip() for item in value.splitlines() if item.strip()]
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        return []

    def config_int(config: dict[str, Any], key: str, default: int, min_value: int, max_value: int) -> int:
        try:
            value = int(config.get(key) if config.get(key) is not None else default)
        except (TypeError, ValueError):
            value = default
        return max(min_value, min(max_value, value))

    def code_retry_attempts(config: dict[str, Any]) -> int:
        return config_int(config, "retryAttempts", 0, 0, 5)

    def code_max_payload_bytes(config: dict[str, Any]) -> int:
        return config_int(config, "maxPayloadBytes", 0, 0, 10_000_000)

    def normalized_state_path(path: str) -> str:
        return str(path or "").strip().removeprefix("state.").strip(".")

    def assign_payload_path(payload: dict[str, Any], path: str, value: Any) -> None:
        parts = [part for part in normalized_state_path(path).split(".") if part]
        if not parts:
            return
        current = payload
        for part in parts[:-1]:
            child = current.get(part)
            if not isinstance(child, dict):
                child = {}
                current[part] = child
            current = child
        current[parts[-1]] = value

    def redact_payload_path(payload: dict[str, Any], path: str) -> None:
        parts = [part for part in str(path or "").strip().split(".") if part]
        if not parts:
            return
        current: Any = payload
        for part in parts[:-1]:
            if not isinstance(current, dict):
                return
            current = current.get(part)
        if isinstance(current, dict) and parts[-1] in current:
            current[parts[-1]] = REDACTED_VALUE

    def selected_external_state_payload(state: ReferenceState, allow_paths: list[str]) -> dict[str, Any]:
        if not allow_paths:
            return jsonable(state)
        selected: dict[str, Any] = {}
        for raw_path in allow_paths:
            path = normalized_state_path(raw_path)
            if not path or path == "state":
                return jsonable(state)
            value = state_path_value(state, path)
            if value is not None:
                assign_payload_path(selected, path, jsonable(value))
        return selected

    def external_payload_policy(config: dict[str, Any]) -> dict[str, Any]:
        policy: dict[str, Any] = {}
        allow_paths = config_string_list(config, "payloadAllowPaths")
        redact_paths = config_string_list(config, "redactPaths")
        retry_attempts = code_retry_attempts(config)
        max_payload_bytes = code_max_payload_bytes(config)
        if allow_paths:
            policy["payload_allow_paths"] = allow_paths
        if redact_paths:
            policy["redact_paths"] = redact_paths
        if retry_attempts:
            policy["retry_attempts"] = retry_attempts
        if max_payload_bytes:
            policy["max_payload_bytes"] = max_payload_bytes
        return policy

    def apply_external_redactions(payload: dict[str, Any], redact_paths: list[str], input_path: str) -> None:
        normalized_input_path = normalized_state_path(input_path)
        for raw_path in redact_paths:
            path = str(raw_path or "").strip()
            if not path:
                continue
            if path == "input" or path.startswith("input."):
                redact_payload_path(payload, path)
                continue
            if path.startswith("context."):
                redact_payload_path(payload, path)
                continue
            normalized = normalized_state_path(path)
            redact_payload_path(payload, f"context.state.{normalized}")
            if normalized and normalized == normalized_input_path:
                payload["input"] = REDACTED_VALUE

    def external_request_payload(
        config: dict[str, Any],
        state: ReferenceState,
        contract: dict[str, Any],
        *,
        adapter_payload: bool = False,
    ) -> tuple[dict[str, Any], int, dict[str, Any]]:
        node_id = config["id"]
        input_path = str(config.get("inputPath") or "state")
        input_value = state_path_value(state, input_path)
        allow_paths = config_string_list(config, "payloadAllowPaths")
        redact_paths = config_string_list(config, "redactPaths")
        request_payload: dict[str, Any] = {
            "input": jsonable(input_value),
            "context": {
                "node_id": node_id,
                "session_id": state.get("session_id"),
                "turn": state.get("turn"),
                "input_path": input_path,
                "state": selected_external_state_payload(state, allow_paths),
            },
            "contract": contract,
        }
        if adapter_payload:
            request_payload["adapter"] = {
                "id": str(config.get("codeEntry") or config.get("handler") or node_id),
                "execution": "runtime_adapter",
                "language": config.get("codeLanguage"),
                "node_id": node_id,
                "timeout_seconds": int(config.get("timeoutSeconds") or 30),
            }
        policy = external_payload_policy(config)
        if policy:
            request_payload["security"] = policy
        apply_external_redactions(request_payload, redact_paths, input_path)
        payload_bytes = len(json.dumps(request_payload, ensure_ascii=False).encode("utf-8"))
        return request_payload, payload_bytes, policy

    def payload_too_large_result(
        config: dict[str, Any],
        contract: dict[str, Any],
        payload_bytes: int,
        payload_policy: dict[str, Any],
        started_at: float,
    ) -> dict[str, Any]:
        max_payload_bytes = code_max_payload_bytes(config)
        return {
            "ok": False,
            "status": "custom_code_failed",
            "node_id": config["id"],
            "contract": contract,
            "reason": "payload_too_large",
            "error": f"custom_code_payload_{payload_bytes}_bytes_exceeds_{max_payload_bytes}",
            "payload_bytes": payload_bytes,
            "payload_policy": payload_policy,
            "attempts": 0,
            "retry_attempts": code_retry_attempts(config),
            "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
        }

    def attach_external_execution_metadata(
        result: dict[str, Any],
        *,
        attempts: int,
        retry_attempts: int,
        payload_bytes: int,
        payload_policy: dict[str, Any],
    ) -> dict[str, Any]:
        result["attempts"] = attempts
        result["retry_attempts"] = retry_attempts
        result["payload_bytes"] = payload_bytes
        if payload_policy:
            result["payload_policy"] = payload_policy
        return result

    def pinned_node_output(state: ReferenceState, node_id: str) -> tuple[bool, Any]:
        metadata = state.get("session_metadata") or {}
        if not isinstance(metadata, dict):
            return False, None
        node_pins = metadata.get("nodePins") or metadata.get("node_pins")
        if not isinstance(node_pins, dict) or node_pins.get("enabled") is not True:
            return False, None
        items = node_pins.get("items")
        if not isinstance(items, list):
            return False, None
        for item in items:
            if isinstance(item, dict) and item.get("nodeId") == node_id:
                return True, item.get("output")
        return False, None

    def pinned_payload(output: Any) -> dict[str, Any]:
        payload = dict(output) if isinstance(output, dict) else {"value": output}
        payload.setdefault("mock", True)
        payload.setdefault("pinned", True)
        return payload

    def pinned_assistant_message(output: Any, fallback: str) -> dict[str, str]:
        payload = output if isinstance(output, dict) else {}
        assistant = None
        if isinstance(payload, dict):
            assistant = payload.get("assistant_message") or payload.get("assistantMessage")
        if isinstance(assistant, dict):
            text = assistant.get("text") or assistant.get("content") or fallback
            code = assistant.get("code") or "PIN"
            return {"code": str(code), "text": str(text)}
        if isinstance(payload, dict):
            for key in ("text", "content", "message", "value"):
                value = payload.get(key)
                if isinstance(value, (str, int, float, bool)) and str(value).strip():
                    return {"code": "PIN", "text": str(value)}
        if output is not None and not isinstance(output, dict):
            return {"code": "PIN", "text": str(output)}
        return {"code": "PIN", "text": fallback}

    def pinned_category_updates(
        state: ReferenceState,
        node_id: str,
        root_key: str,
        result_path: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        updates: dict[str, Any] = {}
        results = dict(state.get(root_key) or {})
        results[node_id] = payload
        updates[root_key] = results
        default_path = f"{root_key}.{node_id}"
        if result_path != default_path:
            assign_state_path(updates, state, result_path, payload)
        return updates

    def apply_pinned_state_overrides(updates: dict[str, Any], payload: dict[str, Any]) -> None:
        for key in ("status", "phase", "turn", "is_complete"):
            if key in payload:
                updates[key] = payload[key]
        assistant = payload.get("assistant_message") or payload.get("assistantMessage")
        if isinstance(assistant, dict) and "assistant_message" not in updates:
            updates["assistant_message"] = {
                "code": str(assistant.get("code") or "PIN"),
                "text": str(assistant.get("text") or assistant.get("content") or "Resposta fixada por pin de nó."),
            }

    def pinned_node_update(
        state: ReferenceState,
        node_id: str,
        kind: str,
        *,
        result_path: str | None = None,
    ) -> ReferenceState | None:
        found, output = pinned_node_output(state, node_id)
        if not found:
            return None
        payload = pinned_payload(output)
        updates: dict[str, Any] = {}
        if kind == "start":
            updates.update({
                "status": "active",
                "phase": "awaiting_turn",
                "assistant_message": pinned_assistant_message(output, START_MESSAGE),
                "is_complete": False,
            })
        elif kind == "finish":
            updates.update({
                "status": "completed",
                "phase": "closing",
                "assistant_message": pinned_assistant_message(output, "Sessão finalizada por replay de pin."),
                "is_complete": True,
            })
        elif kind == "human_input":
            updates.update({
                "status": "active",
                "phase": "awaiting_turn",
                "is_complete": False,
                "assistant_message": pinned_assistant_message(output, "Aguardando entrada do usuário."),
            })
        elif kind == "llm":
            llm_payload = dict(payload)
            llm_payload.setdefault("provider", "pinned")
            llm_payload.setdefault("model", "pinned")
            llm_payload.setdefault("attempts", 0)
            llm_payload.setdefault("node_id", node_id)
            updates["assistant_message"] = pinned_assistant_message(output, "Resposta fixada por pin de nó.")
            updates["llm"] = llm_payload
        elif kind == "safety":
            safety_source = payload.get("safety") if isinstance(payload.get("safety"), dict) else payload
            safety_payload = dict(safety_source) if isinstance(safety_source, dict) else {"value": safety_source}
            safety_payload.setdefault("blocked", False)
            safety_payload.setdefault("decision", "allow")
            safety_payload.setdefault("mock", True)
            safety_payload.setdefault("pinned", True)
            updates["safety"] = safety_payload
            if safety_payload.get("blocked"):
                updates["assistant_message"] = pinned_assistant_message(output, "Mensagem bloqueada por replay de pin.")
                updates["phase"] = "safety"
                updates["is_complete"] = safety_payload.get("decision") == "block"
                updates["status"] = "completed" if updates["is_complete"] else "active"
        elif kind == "code":
            payload.setdefault("status", "custom_code_executed")
            payload.setdefault("node_id", node_id)
            updates.update(pinned_category_updates(state, node_id, "custom", result_path or f"custom.{node_id}", payload))
        elif kind == "http":
            updates.update(pinned_category_updates(state, node_id, "http", result_path or f"http.{node_id}", payload))
        elif kind == "transform":
            updates.update(pinned_category_updates(state, node_id, "transforms", result_path or f"transforms.{node_id}", payload))
        elif kind == "database":
            updates.update(pinned_category_updates(state, node_id, "database", result_path or f"database.{node_id}", payload))
        elif kind == "file":
            updates.update(pinned_category_updates(state, node_id, "files", result_path or f"files.{node_id}", payload))
        elif kind == "rag":
            updates.update(pinned_category_updates(state, node_id, "rag", result_path or f"rag.{node_id}", payload))
        elif kind == "approval":
            updates.update(pinned_category_updates(state, node_id, "approvals", result_path or f"approvals.{node_id}", payload))
        elif kind == "score":
            updates.update(pinned_category_updates(state, node_id, "scores", result_path or f"scores.{node_id}", payload))
        elif kind == "analytics":
            updates.update(pinned_category_updates(state, node_id, "analytics", result_path or f"analytics.{node_id}", payload))
        else:
            custom = dict(state.get("custom") or {})
            custom[node_id] = payload
            updates["custom"] = custom
        apply_pinned_state_overrides(updates, payload)
        return mark_node(state, node_id, updates)

    def normalized_params(value: Any, state: ReferenceState) -> dict[str, Any]:
        if value is None:
            params: dict[str, Any] = {}
        elif isinstance(value, dict):
            params = dict(value)
        else:
            params = {"value": value}
        params.setdefault("session_id", state.get("session_id"))
        return params

    def is_sql_identifier(value: str) -> bool:
        first = value[:1]
        return bool(first) and (first.isalpha() or first == "_") and all(part.isalnum() or part == "_" for part in value)

    def remember_database_result(state: ReferenceState, node_id: str, result_path: str, result: dict[str, Any]) -> ReferenceState:
        updates: dict[str, Any] = {}
        database_results = dict(state.get("database") or {})
        database_results[node_id] = result
        updates["database"] = database_results
        if result_path != f"database.{node_id}":
            assign_state_path(updates, state, result_path, result)
        return mark_node(state, node_id, updates)

    def safe_asset_path(relative_path: str) -> Path:
        candidate = Path(relative_path or "")
        if candidate.is_absolute() or ".." in candidate.parts:
            raise ValueError("Caminho de arquivo deve ser relativo a app/files e não pode usar '..'.")
        resolved = (FILES_ROOT / candidate).resolve()
        root = FILES_ROOT.resolve()
        if root not in [resolved, *resolved.parents]:
            raise ValueError("Caminho de arquivo sai de app/files.")
        return resolved

    def safe_code_path(relative_path: str) -> Path:
        return safe_code_path_in_root(relative_path, CODE_ROOT)

    def safe_code_path_in_root(relative_path: str, root_path: Path) -> Path:
        raw_path = str(relative_path or "").replace("\\\\", "/")
        candidate = Path(raw_path)
        if candidate.parts and candidate.parts[0] == "code":
            candidate = Path(*candidate.parts[1:]) if len(candidate.parts) > 1 else Path("")
        if not candidate.parts or candidate.is_absolute() or ".." in candidate.parts:
            raise ValueError("codePath deve ser relativo a app/code e não pode usar '..'.")
        resolved = (root_path / candidate).resolve()
        root = root_path.resolve()
        if root not in [resolved, *resolved.parents]:
            raise ValueError("codePath sai de app/code.")
        return resolved

    def process_backed_custom_code(config: dict[str, Any]) -> bool:
        execution = str(config.get("codeExecution") or "native").lower()
        language = str(config.get("codeLanguage") or "python").lower()
        runtime_execution = execution in {"native", "inline", "file"}
        return execution in {"mcp", "sidecar"} or (
            runtime_execution and language in {"javascript", "js", "typescript", "ts", "bash", "shell", "sh"}
        )

    def requested_ephemeral_workspace(config: dict[str, Any]) -> bool:
        return str(config.get("sandboxIsolation") or "shared").lower() == "ephemeral_workspace"

    def requested_dedicated_process(config: dict[str, Any]) -> bool:
        return str(config.get("sandboxIsolation") or "shared").lower() == "dedicated_process"

    def requested_container(config: dict[str, Any]) -> bool:
        return str(config.get("sandboxIsolation") or "shared").lower() == "container"

    def requested_vm(config: dict[str, Any]) -> bool:
        return str(config.get("sandboxIsolation") or "shared").lower() == "vm"

    def runtime_adapter_vm_custom_code(config: dict[str, Any]) -> bool:
        execution = str(config.get("codeExecution") or "native").lower()
        return execution == "runtime_adapter" and requested_vm(config)

    def python_runtime_custom_code(config: dict[str, Any]) -> bool:
        execution = str(config.get("codeExecution") or "native").lower()
        language = str(config.get("codeLanguage") or "python").lower()
        return language in {"python", "py"} and execution in {"native", "inline", "file"}

    def node_runtime_custom_code(config: dict[str, Any]) -> bool:
        language = str(config.get("codeLanguage") or "").lower()
        return language in {"javascript", "js", "typescript", "ts"}

    def shell_runtime_custom_code(config: dict[str, Any]) -> bool:
        execution = str(config.get("codeExecution") or "native").lower()
        language = str(config.get("codeLanguage") or "").lower()
        return language in {"bash", "shell", "sh"} and execution in {"native", "inline", "file"}

    def cleanup_temporary_code_workspace(temp_dir: str) -> None:
        attempts = 12 if os.name == "nt" else 1
        for attempt in range(attempts):
            try:
                shutil.rmtree(temp_dir)
                return
            except FileNotFoundError:
                return
            except PermissionError:
                if os.name == "nt" and attempt < attempts - 1:
                    time.sleep(min(0.1 * (attempt + 1), 0.5))
                    continue
                raise
            except OSError:
                if os.name == "nt" and attempt < attempts - 1:
                    time.sleep(min(0.1 * (attempt + 1), 0.5))
                    continue
                raise

    @contextmanager
    def custom_code_workspace(config: dict[str, Any]):
        workspace_isolation = "shared"
        if requested_dedicated_process(config) and (python_runtime_custom_code(config) or shell_runtime_custom_code(config)):
            workspace_isolation = "dedicated_process"
        elif requested_container(config) and (python_runtime_custom_code(config) or node_runtime_custom_code(config) or shell_runtime_custom_code(config)):
            workspace_isolation = "container"
        elif requested_vm(config) and (
            python_runtime_custom_code(config)
            or node_runtime_custom_code(config)
            or shell_runtime_custom_code(config)
            or runtime_adapter_vm_custom_code(config)
        ):
            workspace_isolation = "vm"
        elif requested_ephemeral_workspace(config) and process_backed_custom_code(config):
            workspace_isolation = "ephemeral_workspace"
        if workspace_isolation == "shared":
            yield CODE_ROOT, "shared"
            return
        temp_dir = tempfile.mkdtemp(prefix=f"agent-flow-code-{config.get('id', 'node')}-")
        try:
            workspace = Path(temp_dir) / "code"
            if CODE_ROOT.exists():
                shutil.copytree(CODE_ROOT, workspace, dirs_exist_ok=True)
            else:
                workspace.mkdir(parents=True, exist_ok=True)
            yield workspace, workspace_isolation
        finally:
            cleanup_temporary_code_workspace(temp_dir)

    def custom_subprocess_env(config: dict[str, Any], workspace_isolation: str) -> dict[str, str] | None:
        allowlist = config_string_list(config, "sandboxEnvAllowlist")
        if not allowlist:
            if workspace_isolation != "shared":
                env = dict(os.environ)
                env["AGENT_FLOW_SANDBOX_ISOLATION"] = workspace_isolation
                return env
            return None
        env: dict[str, str] = {}
        for key in ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "COMSPEC", "PATHEXT", "TEMP", "TMP", "HOME", "USERPROFILE"]:
            value = os.environ.get(key)
            if value is not None:
                env[key] = value
        for key in allowlist:
            value = os.environ.get(key)
            if value is not None:
                env[key] = value
        env["AGENT_FLOW_SANDBOX_ISOLATION"] = workspace_isolation
        return env

    def call_custom_entry(entry: Any, input_value: Any, context: dict[str, Any]) -> Any:
        signature = inspect.signature(entry)
        positional = [
            parameter
            for parameter in signature.parameters.values()
            if parameter.kind in {inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD}
        ]
        has_varargs = any(parameter.kind == inspect.Parameter.VAR_POSITIONAL for parameter in signature.parameters.values())
        if has_varargs or len(positional) >= 2:
            return entry(input_value, context)
        if len(positional) == 1:
            return entry(input_value)
        return entry()

    def execute_custom_python_code(config: dict[str, Any], state: ReferenceState, contract: dict[str, Any]) -> dict[str, Any]:
        node_id = config["id"]
        started_at = time.perf_counter()
        entry_name = str(config.get("codeEntry") or "run")
        source_path = config.get("codePath")
        inline_source = config.get("codeInline")
        if inline_source:
            source = str(inline_source)
            filename = f"<agent-flow:{node_id}>"
        elif source_path:
            path = safe_code_path(str(source_path))
            source = path.read_text(encoding="utf-8")
            filename = str(path)
        else:
            return {
                "ok": False,
                "status": "custom_code_not_executed",
                "node_id": node_id,
                "contract": contract,
                "reason": "missing_code_source",
            }

        namespace: dict[str, Any] = {
            "__builtins__": __builtins__,
            "json": json,
            "Path": Path,
        }
        exec(compile(source, filename, "exec"), namespace)
        entry = namespace.get(entry_name)
        if not callable(entry):
            return {
                "ok": False,
                "status": "custom_code_failed",
                "node_id": node_id,
                "contract": contract,
                "error": f"Entry point não encontrado ou não chamável: {entry_name}",
            }

        input_path = str(config.get("inputPath") or "state")
        input_value = state_path_value(state, input_path)
        context = {
            "node_id": node_id,
            "session_id": state.get("session_id"),
            "turn": state.get("turn"),
            "input_path": input_path,
            "state": state,
            "settings": settings,
            "llm_client": llm_client,
            "state_path_value": state_path_value,
            "jsonable": jsonable,
        }
        output = call_custom_entry(entry, input_value, context)
        return {
            "ok": True,
            "status": "custom_code_executed",
            "node_id": node_id,
            "contract": contract,
            "output": jsonable(output),
            "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
        }

    def execute_custom_python_dedicated_process(config: dict[str, Any], state: ReferenceState, contract: dict[str, Any]) -> dict[str, Any]:
        node_id = config["id"]
        started_at = time.perf_counter()
        entry_name = str(config.get("codeEntry") or "run")
        source_path = config.get("codePath")
        inline_source = config.get("codeInline")
        input_path = str(config.get("inputPath") or "state")
        input_value = state_path_value(state, input_path)
        request: dict[str, Any] = {
            "entry": entry_name,
            "input": jsonable(input_value),
            "context": {
                "node_id": node_id,
                "session_id": state.get("session_id"),
                "turn": state.get("turn"),
                "input_path": input_path,
                "state": jsonable(state),
            },
            "contract": contract,
        }
        worker_source = r'''
import contextlib
import inspect
import io
import json
import pathlib
import sys
import traceback


def _json_default(value):
    if isinstance(value, pathlib.Path):
        return str(value)
    if isinstance(value, set):
        return list(value)
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        return model_dump()
    as_dict = getattr(value, "dict", None)
    if callable(as_dict):
        return as_dict()
    return str(value)


def _call_entry(entry, input_value, context, contract):
    signature = inspect.signature(entry)
    positional = [
        parameter
        for parameter in signature.parameters.values()
        if parameter.kind in {inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD}
    ]
    has_varargs = any(parameter.kind == inspect.Parameter.VAR_POSITIONAL for parameter in signature.parameters.values())
    if has_varargs or len(positional) >= 3:
        return entry(input_value, context, contract)
    if len(positional) == 2:
        return entry(input_value, context)
    if len(positional) == 1:
        return entry(input_value)
    return entry()


try:
    request = json.load(sys.stdin)
    entry_name = str(request.get("entry") or "run")
    inline_source = request.get("inlineSource")
    source_path = request.get("sourcePath")
    if inline_source:
        source = str(inline_source)
        filename = "<agent-flow-dedicated-python>"
    elif source_path:
        path = pathlib.Path(str(source_path))
        source = path.read_text(encoding="utf-8")
        filename = str(path)
    else:
        raise RuntimeError("missing_code_source")
    namespace = {
        "__builtins__": __builtins__,
        "json": json,
        "Path": pathlib.Path,
    }
    exec(compile(source, filename, "exec"), namespace)
    entry = namespace.get(entry_name)
    if not callable(entry):
        raise RuntimeError(f"Entry point não encontrado ou não chamável: {entry_name}")
    captured_stdout = io.StringIO()
    with contextlib.redirect_stdout(captured_stdout):
        output = _call_entry(entry, request.get("input"), request.get("context") or {}, request.get("contract") or {})
    response = {
        "ok": True,
        "output": output,
        "stdout": captured_stdout.getvalue(),
    }
except Exception as exc:
    response = {
        "ok": False,
        "error": str(exc),
        "traceback": traceback.format_exc(limit=5),
    }

print(json.dumps(response, ensure_ascii=False, default=_json_default))
'''
        with custom_code_workspace(config) as (workspace, workspace_isolation):
            if inline_source:
                request["inlineSource"] = str(inline_source)
            elif source_path:
                safe_source_path = safe_code_path_in_root(str(source_path), workspace)
                if workspace_isolation == "container":
                    request["sourcePath"] = f"/workspace/code/{safe_source_path.relative_to(workspace).as_posix()}"
                else:
                    request["sourcePath"] = str(safe_source_path)
            else:
                return {
                    "ok": False,
                    "status": "custom_code_not_executed",
                    "node_id": node_id,
                    "contract": contract,
                    "reason": "missing_code_source",
                    "sandbox_workspace_isolation": workspace_isolation,
                }
            timeout_seconds = int(config.get("timeoutSeconds") or 30)
            try:
                completed = subprocess.run(
                    [sys.executable, "-c", worker_source],
                    input=json.dumps(request),
                    text=True,
                    capture_output=True,
                    timeout=timeout_seconds,
                    cwd=str(workspace),
                    env=custom_subprocess_env(config, workspace_isolation),
                    check=False,
                )
            except subprocess.TimeoutExpired as exc:
                return {
                    "ok": False,
                    "status": "custom_code_failed",
                    "node_id": node_id,
                    "contract": contract,
                    "error": f"python_dedicated_process_timeout_after_{timeout_seconds}s",
                    "stdout": str(exc.stdout or ""),
                    "stderr": str(exc.stderr or ""),
                    "sandbox_workspace_isolation": workspace_isolation,
                    "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
                }
        stdout = (completed.stdout or "").strip()
        stderr = (completed.stderr or "").strip()
        try:
            worker_result = json.loads(stdout) if stdout else {}
        except json.JSONDecodeError:
            worker_result = {"ok": False, "error": stdout or "empty_python_worker_output"}
        if completed.returncode != 0 or not worker_result.get("ok"):
            return {
                "ok": False,
                "status": "custom_code_failed",
                "node_id": node_id,
                "contract": contract,
                "error": worker_result.get("error") or "python_worker_failed",
                "traceback": worker_result.get("traceback"),
                "exit_code": completed.returncode,
                "stderr": stderr,
                "sandbox_workspace_isolation": workspace_isolation,
                "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
            }
        return {
            "ok": True,
            "status": "custom_code_executed",
            "node_id": node_id,
            "contract": contract,
            "output": jsonable(worker_result.get("output")),
            "stdout": worker_result.get("stdout"),
            "exit_code": completed.returncode,
            "stderr": stderr,
            "sandbox_workspace_isolation": workspace_isolation,
            "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
        }

    def container_runtime_policy(config: dict[str, Any]) -> tuple[list[str], dict[str, Any]]:
        profile = str(config.get("sandboxContainerProfile") or "baseline").strip().lower()
        if profile not in {"baseline", "hardened"}:
            profile = "baseline"
        memory = str(config.get("sandboxContainerMemory") or ("512m" if profile == "hardened" else "")).strip()
        cpus = str(config.get("sandboxContainerCpus") or ("1" if profile == "hardened" else "")).strip()
        raw_pids = config.get("sandboxContainerPidsLimit")
        if raw_pids is None and profile == "hardened":
            raw_pids = 128
        pids_limit = int(raw_pids) if isinstance(raw_pids, (int, float)) and int(raw_pids) > 0 else None
        read_only_rootfs = bool(config.get("sandboxContainerReadOnlyRootfs") or profile == "hardened")
        drop_capabilities = bool(config.get("sandboxContainerDropCapabilities") or profile == "hardened")
        no_new_privileges = bool(config.get("sandboxContainerNoNewPrivileges") or profile == "hardened")
        args: list[str] = []
        metadata: dict[str, Any] = {
            "profile": profile,
            "network": "none",
            "read_only_rootfs": read_only_rootfs,
            "drop_capabilities": drop_capabilities,
            "no_new_privileges": no_new_privileges,
        }
        if memory:
            args.extend(["--memory", memory])
            metadata["memory"] = memory
        if cpus:
            args.extend(["--cpus", cpus])
            metadata["cpus"] = cpus
        if pids_limit:
            args.extend(["--pids-limit", str(pids_limit)])
            metadata["pids_limit"] = pids_limit
        if read_only_rootfs:
            args.append("--read-only")
            args.extend(["--tmpfs", "/tmp:rw,nosuid,nodev,size=64m"])
        if drop_capabilities:
            args.extend(["--cap-drop", "ALL"])
        if no_new_privileges:
            args.extend(["--security-opt", "no-new-privileges"])
        return args, metadata

    def vm_runtime_policy(config: dict[str, Any]) -> dict[str, Any]:
        profile = str(config.get("sandboxVmProfile") or "baseline").strip().lower()
        if profile not in {"baseline", "hardened"}:
            profile = "baseline"
        image = str(config.get("sandboxVmImage") or os.environ.get("AGENT_FLOW_CODE_VM_IMAGE") or "").strip()
        engine = str(config.get("sandboxVmEngine") or os.environ.get("AGENT_FLOW_CODE_VM_ENGINE") or "").strip().lower()
        runner_manifest = str(
            config.get("sandboxVmRunnerManifest") or os.environ.get("AGENT_FLOW_CODE_VM_RUNNER_MANIFEST") or ""
        ).strip()
        image_manifest = str(
            config.get("sandboxVmImageManifest") or os.environ.get("AGENT_FLOW_CODE_VM_IMAGE_MANIFEST") or ""
        ).strip()
        memory = str(config.get("sandboxVmMemory") or ("1024m" if profile == "hardened" else "")).strip()
        cpus = str(config.get("sandboxVmCpus") or ("1" if profile == "hardened" else "")).strip()
        metadata: dict[str, Any] = {
            "profile": profile,
            "runner_protocol": "agent-flow-vm-runner.v1",
            "ephemeral": True,
        }
        image_id = str(config.get("sandboxVmImageId") or "").strip()
        if image_id:
            metadata["image_id"] = image_id
        if engine:
            metadata["engine"] = engine
        if image:
            metadata["image"] = image
        if runner_manifest:
            metadata["runner_manifest"] = runner_manifest
        if image_manifest:
            metadata["image_manifest"] = image_manifest
        if memory:
            metadata["memory"] = memory
        if cpus:
            metadata["cpus"] = cpus
        return metadata

    def vm_runner_command(config: dict[str, Any]) -> tuple[str, list[str]]:
        runner = str(config.get("sandboxVmRunner") or os.environ.get("AGENT_FLOW_CODE_VM_RUNNER") or "").strip()
        args = config_string_list(config, "sandboxVmArgs")
        if not args:
            env_args = os.environ.get("AGENT_FLOW_CODE_VM_ARGS")
            if env_args:
                args = shlex.split(env_args)
        return runner, args

    def execute_custom_vm_code(config: dict[str, Any], state: ReferenceState, contract: dict[str, Any]) -> dict[str, Any]:
        node_id = config["id"]
        started_at = time.perf_counter()
        runner, runner_args = vm_runner_command(config)
        vm_policy = vm_runtime_policy(config)
        if not runner:
            return {
                "ok": False,
                "status": "custom_code_not_executed",
                "node_id": node_id,
                "contract": contract,
                "reason": "vm_runner_not_configured",
                "error": "sandboxVmRunner ou AGENT_FLOW_CODE_VM_RUNNER precisa ser configurado para sandboxIsolation=vm.",
                "sandbox_workspace_isolation": "vm",
                "vm_policy": vm_policy,
                "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
            }
        runner_path = shutil.which(runner)
        if not runner_path:
            candidate = Path(runner)
            if candidate.exists():
                runner_path = str(candidate)
        if not runner_path:
            return {
                "ok": False,
                "status": "custom_code_failed",
                "node_id": node_id,
                "contract": contract,
                "error": f"vm_runner_not_available:{runner}",
                "sandbox_workspace_isolation": "vm",
                "vm_runner": runner,
                "vm_policy": vm_policy,
                "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
            }
        entry_name = str(config.get("codeEntry") or "run")
        source_path = config.get("codePath")
        inline_source = config.get("codeInline")
        language = str(config.get("codeLanguage") or "python").lower()
        execution = str(config.get("codeExecution") or "native").lower()
        input_path = str(config.get("inputPath") or "state")
        input_value = state_path_value(state, input_path)
        adapter_metadata = {
            "id": str(config.get("codeEntry") or config.get("handler") or node_id),
            "execution": "runtime_adapter",
            "language": config.get("codeLanguage"),
            "node_id": node_id,
            "timeout_seconds": int(config.get("timeoutSeconds") or 30),
            "sandbox_isolation": str(config.get("sandboxIsolation") or ""),
            "vm_image_id": config.get("sandboxVmImageId"),
        } if execution == "runtime_adapter" else None
        request: dict[str, Any] = {
            "protocol": "agent-flow-vm-runner.v1",
            "entry": entry_name,
            "language": language,
            "input": jsonable(input_value),
            "context": {
                "node_id": node_id,
                "session_id": state.get("session_id"),
                "turn": state.get("turn"),
                "input_path": input_path,
                "state": jsonable(state),
            },
            "contract": contract,
            "vm": vm_policy,
        }
        if adapter_metadata:
            request["adapter"] = {key: value for key, value in adapter_metadata.items() if value not in (None, "")}
            request["context"]["adapter"] = request["adapter"]
        with custom_code_workspace(config) as (workspace, workspace_isolation):
            workspace_isolation = "vm"
            if inline_source:
                request["inlineSource"] = str(inline_source)
            elif source_path:
                safe_source_path = safe_code_path_in_root(str(source_path), workspace)
                request["sourcePath"] = str(safe_source_path)
                request["sourcePathRelative"] = safe_source_path.relative_to(workspace).as_posix()
            else:
                return {
                    "ok": False,
                    "status": "custom_code_not_executed",
                    "node_id": node_id,
                    "contract": contract,
                    "reason": "runtime_adapter_vm_source_not_configured" if execution == "runtime_adapter" else "missing_code_source",
                    "sandbox_workspace_isolation": workspace_isolation,
                    "vm_runner": runner,
                    "vm_policy": vm_policy,
                    "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
                }
            request["workspace"] = str(workspace)
            request["workspaceIsolation"] = workspace_isolation
            timeout_seconds = int(config.get("timeoutSeconds") or 30)
            try:
                completed = subprocess.run(
                    [runner_path, *runner_args],
                    input=json.dumps(request),
                    text=True,
                    capture_output=True,
                    timeout=timeout_seconds,
                    cwd=str(workspace),
                    env=custom_subprocess_env(config, workspace_isolation),
                    check=False,
                )
            except subprocess.TimeoutExpired as exc:
                return {
                    "ok": False,
                    "status": "custom_code_failed",
                    "node_id": node_id,
                    "contract": contract,
                    "error": f"vm_runner_timeout_after_{timeout_seconds}s",
                    "stdout": str(exc.stdout or ""),
                    "stderr": str(exc.stderr or ""),
                    "sandbox_workspace_isolation": workspace_isolation,
                    "vm_runner": runner,
                    "vm_policy": vm_policy,
                    "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
                }
        stdout = (completed.stdout or "").strip()
        stderr = (completed.stderr or "").strip()
        try:
            runner_result = json.loads(stdout) if stdout else {}
        except json.JSONDecodeError:
            runner_result = {"ok": False, "error": stdout or "empty_vm_runner_output"}
        if completed.returncode != 0 or not runner_result.get("ok"):
            return {
                "ok": False,
                "status": "custom_code_failed",
                "node_id": node_id,
                "contract": contract,
                "error": runner_result.get("error") or "vm_runner_failed",
                "traceback": runner_result.get("traceback"),
                "exit_code": completed.returncode,
                "stderr": stderr,
                "sandbox_workspace_isolation": "vm",
                "vm_runner": runner,
                "vm_policy": vm_policy,
                "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
            }
        allow_unverified_isolation = str(os.environ.get("AGENT_FLOW_CODE_VM_ALLOW_UNVERIFIED_ISOLATION") or "").lower() in {"1", "true", "yes"}
        if runner_result.get("providesVmIsolation") is not True and not allow_unverified_isolation:
            return {
                "ok": False,
                "status": "custom_code_failed",
                "node_id": node_id,
                "contract": contract,
                "error": "vm_runner_unverified_isolation",
                "vm_runner_provides_isolation": runner_result.get("providesVmIsolation"),
                "vm_runner_allow_unverified_isolation": False,
                "exit_code": completed.returncode,
                "stderr": stderr,
                "sandbox_workspace_isolation": "vm",
                "vm_runner": runner,
                "vm_policy": vm_policy,
                "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
            }
        return {
            "ok": True,
            "status": "custom_code_executed",
            "node_id": node_id,
            "contract": contract,
            "output": jsonable(runner_result.get("output")),
            "stdout": runner_result.get("stdout"),
            "vm_runner_provides_isolation": runner_result.get("providesVmIsolation"),
            "exit_code": completed.returncode,
            "stderr": stderr,
            "sandbox_workspace_isolation": "vm",
            "vm_runner": runner,
            "vm_policy": vm_policy,
            "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
        }

    def execute_custom_python_container(config: dict[str, Any], state: ReferenceState, contract: dict[str, Any]) -> dict[str, Any]:
        node_id = config["id"]
        started_at = time.perf_counter()
        image = str(config.get("sandboxContainerImage") or os.environ.get("AGENT_FLOW_CODE_CONTAINER_IMAGE") or "").strip()
        engine = str(config.get("sandboxContainerEngine") or os.environ.get("AGENT_FLOW_CODE_CONTAINER_ENGINE") or "docker").strip()
        container_policy_args, container_policy = container_runtime_policy(config)
        if not image:
            return {
                "ok": False,
                "status": "custom_code_not_executed",
                "node_id": node_id,
                "contract": contract,
                "reason": "container_image_not_configured",
                "error": "sandboxContainerImage ou AGENT_FLOW_CODE_CONTAINER_IMAGE precisa ser configurado para sandboxIsolation=container.",
                "sandbox_workspace_isolation": "container",
                "container_engine": engine,
                "container_policy": container_policy,
                "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
            }
        engine_path = shutil.which(engine)
        if not engine_path:
            return {
                "ok": False,
                "status": "custom_code_failed",
                "node_id": node_id,
                "contract": contract,
                "error": f"container_engine_not_available:{engine}",
                "sandbox_workspace_isolation": "container",
                "container_image": image,
                "container_engine": engine,
                "container_policy": container_policy,
                "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
            }
        entry_name = str(config.get("codeEntry") or "run")
        source_path = config.get("codePath")
        inline_source = config.get("codeInline")
        input_path = str(config.get("inputPath") or "state")
        input_value = state_path_value(state, input_path)
        request: dict[str, Any] = {
            "entry": entry_name,
            "input": jsonable(input_value),
            "context": {
                "node_id": node_id,
                "session_id": state.get("session_id"),
                "turn": state.get("turn"),
                "input_path": input_path,
                "state": jsonable(state),
            },
            "contract": contract,
        }
        worker_source = r'''
import contextlib
import inspect
import io
import json
import pathlib
import sys
import traceback


def _json_default(value):
    if isinstance(value, pathlib.Path):
        return str(value)
    if isinstance(value, set):
        return list(value)
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        return model_dump()
    as_dict = getattr(value, "dict", None)
    if callable(as_dict):
        return as_dict()
    return str(value)


def _call_entry(entry, input_value, context, contract):
    signature = inspect.signature(entry)
    positional = [
        parameter
        for parameter in signature.parameters.values()
        if parameter.kind in {inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD}
    ]
    has_varargs = any(parameter.kind == inspect.Parameter.VAR_POSITIONAL for parameter in signature.parameters.values())
    if has_varargs or len(positional) >= 3:
        return entry(input_value, context, contract)
    if len(positional) == 2:
        return entry(input_value, context)
    if len(positional) == 1:
        return entry(input_value)
    return entry()


try:
    request = json.load(sys.stdin)
    entry_name = str(request.get("entry") or "run")
    inline_source = request.get("inlineSource")
    source_path = request.get("sourcePath")
    if inline_source:
        source = str(inline_source)
        filename = "<agent-flow-container-python>"
    elif source_path:
        path = pathlib.Path(str(source_path))
        source = path.read_text(encoding="utf-8")
        filename = str(path)
    else:
        raise RuntimeError("missing_code_source")
    namespace = {
        "__builtins__": __builtins__,
        "json": json,
        "Path": pathlib.Path,
    }
    exec(compile(source, filename, "exec"), namespace)
    entry = namespace.get(entry_name)
    if not callable(entry):
        raise RuntimeError(f"Entry point não encontrado ou não chamável: {entry_name}")
    captured_stdout = io.StringIO()
    with contextlib.redirect_stdout(captured_stdout):
        output = _call_entry(entry, request.get("input"), request.get("context") or {}, request.get("contract") or {})
    response = {
        "ok": True,
        "output": output,
        "stdout": captured_stdout.getvalue(),
    }
except Exception as exc:
    response = {
        "ok": False,
        "error": str(exc),
        "traceback": traceback.format_exc(limit=5),
    }

print(json.dumps(response, ensure_ascii=False, default=_json_default))
'''
        with custom_code_workspace(config) as (workspace, workspace_isolation):
            workspace_isolation = "container"
            if inline_source:
                request["inlineSource"] = str(inline_source)
            elif source_path:
                safe_source_path = safe_code_path_in_root(str(source_path), workspace)
                relative_source_path = safe_source_path.relative_to(workspace).as_posix()
                request["sourcePath"] = f"/workspace/code/{relative_source_path}"
            else:
                return {
                    "ok": False,
                    "status": "custom_code_not_executed",
                    "node_id": node_id,
                    "contract": contract,
                    "reason": "missing_code_source",
                    "sandbox_workspace_isolation": workspace_isolation,
                    "container_image": image,
                    "container_engine": engine,
                }
            worker_path = workspace.parent / "worker.py"
            worker_path.write_text(worker_source, encoding="utf-8")
            timeout_seconds = int(config.get("timeoutSeconds") or 30)
            env_args: list[str] = ["-e", "AGENT_FLOW_SANDBOX_ISOLATION=container"]
            for key in config_string_list(config, "sandboxEnvAllowlist"):
                value = os.environ.get(key)
                if value is not None:
                    env_args.extend(["-e", f"{key}={value}"])
            container_command = [
                engine_path,
                "run",
                "--rm",
                "--network",
                "none",
                *container_policy_args,
                "-i",
                "-v",
                f"{workspace.parent.resolve()}:/workspace:rw",
                "-w",
                "/workspace/code",
                *env_args,
                image,
                "python",
                "/workspace/worker.py",
            ]
            try:
                completed = subprocess.run(
                    container_command,
                    input=json.dumps(request),
                    text=True,
                    capture_output=True,
                    timeout=timeout_seconds,
                    check=False,
                )
            except subprocess.TimeoutExpired as exc:
                return {
                    "ok": False,
                    "status": "custom_code_failed",
                    "node_id": node_id,
                    "contract": contract,
                    "error": f"python_container_timeout_after_{timeout_seconds}s",
                    "stdout": str(exc.stdout or ""),
                    "stderr": str(exc.stderr or ""),
                    "sandbox_workspace_isolation": workspace_isolation,
                    "container_image": image,
                    "container_engine": engine,
                    "container_network": "none",
                    "container_policy": container_policy,
                    "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
                }
        stdout = (completed.stdout or "").strip()
        stderr = (completed.stderr or "").strip()
        try:
            worker_result = json.loads(stdout) if stdout else {}
        except json.JSONDecodeError:
            worker_result = {"ok": False, "error": stdout or "empty_python_container_output"}
        if completed.returncode != 0 or not worker_result.get("ok"):
            return {
                "ok": False,
                "status": "custom_code_failed",
                "node_id": node_id,
                "contract": contract,
                "error": worker_result.get("error") or "python_container_failed",
                "traceback": worker_result.get("traceback"),
                "exit_code": completed.returncode,
                "stderr": stderr,
                "sandbox_workspace_isolation": "container",
                "container_image": image,
                "container_engine": engine,
                "container_network": "none",
                "container_policy": container_policy,
                "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
            }
        return {
            "ok": True,
            "status": "custom_code_executed",
            "node_id": node_id,
            "contract": contract,
            "output": jsonable(worker_result.get("output")),
            "stdout": worker_result.get("stdout"),
            "exit_code": completed.returncode,
            "stderr": stderr,
            "sandbox_workspace_isolation": "container",
            "container_image": image,
            "container_engine": engine,
            "container_network": "none",
            "container_policy": container_policy,
            "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
        }

    def execute_custom_node_code(config: dict[str, Any], state: ReferenceState, contract: dict[str, Any]) -> dict[str, Any]:
        node_id = config["id"]
        started_at = time.perf_counter()
        entry_name = str(config.get("codeEntry") or "run")
        source_path = config.get("codePath")
        inline_source = config.get("codeInline")
        language = str(config.get("codeLanguage") or "javascript").lower()
        request: dict[str, Any] = {
            "entry": entry_name,
            "language": language,
        }
        input_path = str(config.get("inputPath") or "state")
        input_value = state_path_value(state, input_path)
        request["input"] = jsonable(input_value)
        request["context"] = {
            "node_id": node_id,
            "session_id": state.get("session_id"),
            "turn": state.get("turn"),
            "input_path": input_path,
            "state": jsonable(state),
        }

        with custom_code_workspace(config) as (workspace, workspace_isolation):
            if inline_source:
                request["inlineSource"] = str(inline_source)
            elif source_path:
                request["sourcePath"] = str(safe_code_path_in_root(str(source_path), workspace))
            else:
                return {
                    "ok": False,
                    "status": "custom_code_not_executed",
                    "node_id": node_id,
                    "contract": contract,
                    "reason": "missing_code_source",
                    "sandbox_workspace_isolation": workspace_isolation,
                }

            runner_path = Path(__file__).resolve().parent / "code_runner.mjs"
            timeout_seconds = int(config.get("timeoutSeconds") or 30)
            if workspace_isolation == "container":
                image = str(config.get("sandboxContainerImage") or os.environ.get("AGENT_FLOW_CODE_CONTAINER_IMAGE") or "").strip()
                engine = str(config.get("sandboxContainerEngine") or os.environ.get("AGENT_FLOW_CODE_CONTAINER_ENGINE") or "docker").strip()
                container_policy_args, container_policy = container_runtime_policy(config)
                if not image:
                    return {
                        "ok": False,
                        "status": "custom_code_not_executed",
                        "node_id": node_id,
                        "contract": contract,
                        "reason": "container_image_not_configured",
                        "error": "sandboxContainerImage ou AGENT_FLOW_CODE_CONTAINER_IMAGE precisa ser configurado para sandboxIsolation=container.",
                        "sandbox_workspace_isolation": workspace_isolation,
                        "container_engine": engine,
                        "container_policy": container_policy,
                        "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
                    }
                engine_path = shutil.which(engine)
                if not engine_path:
                    return {
                        "ok": False,
                        "status": "custom_code_failed",
                        "node_id": node_id,
                        "contract": contract,
                        "error": f"container_engine_not_available:{engine}",
                        "sandbox_workspace_isolation": workspace_isolation,
                        "container_image": image,
                        "container_engine": engine,
                        "container_policy": container_policy,
                        "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
                    }
                runner_copy = workspace.parent / "code_runner.mjs"
                runner_copy.write_text(runner_path.read_text(encoding="utf-8"), encoding="utf-8")
                env_args: list[str] = ["-e", "AGENT_FLOW_SANDBOX_ISOLATION=container"]
                for key in config_string_list(config, "sandboxEnvAllowlist"):
                    value = os.environ.get(key)
                    if value is not None:
                        env_args.extend(["-e", f"{key}={value}"])
                container_command = [
                    engine_path,
                    "run",
                    "--rm",
                    "--network",
                    "none",
                    *container_policy_args,
                    "-i",
                    "-v",
                    f"{workspace.parent.resolve()}:/workspace:rw",
                    "-w",
                    "/workspace/code",
                    *env_args,
                    image,
                    "node",
                    "/workspace/code_runner.mjs",
                ]
                try:
                    completed = subprocess.run(
                        container_command,
                        input=json.dumps(request),
                        text=True,
                        capture_output=True,
                        timeout=timeout_seconds,
                        check=False,
                    )
                except subprocess.TimeoutExpired as exc:
                    return {
                        "ok": False,
                        "status": "custom_code_failed",
                        "node_id": node_id,
                        "contract": contract,
                        "error": f"node_container_timeout_after_{timeout_seconds}s",
                        "stdout": str(exc.stdout or ""),
                        "stderr": str(exc.stderr or ""),
                        "sandbox_workspace_isolation": workspace_isolation,
                        "container_image": image,
                        "container_engine": engine,
                        "container_network": "none",
                        "container_policy": container_policy,
                        "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
                    }
            else:
                completed = subprocess.run(
                    ["node", str(runner_path)],
                    input=json.dumps(request),
                    text=True,
                    capture_output=True,
                    timeout=timeout_seconds,
                    cwd=str(workspace),
                    env=custom_subprocess_env(config, workspace_isolation),
                    check=False,
                )
        stdout = (completed.stdout or "").strip()
        stderr = (completed.stderr or "").strip()
        try:
            runner_result = json.loads(stdout) if stdout else {}
        except json.JSONDecodeError:
            runner_result = {"ok": False, "error": {"message": stdout or "empty_node_output"}}
        if completed.returncode != 0 or not runner_result.get("ok"):
            error = runner_result.get("error")
            return {
                "ok": False,
                "status": "custom_code_failed",
                "node_id": node_id,
                "contract": contract,
                "error": error.get("message") if isinstance(error, dict) else str(error or "node_runner_failed"),
                "stderr": stderr,
                "sandbox_workspace_isolation": workspace_isolation,
                "container_image": image if workspace_isolation == "container" else None,
                "container_engine": engine if workspace_isolation == "container" else None,
                "container_network": "none" if workspace_isolation == "container" else None,
                "container_policy": container_policy if workspace_isolation == "container" else None,
            }
        result = {
            "ok": True,
            "status": "custom_code_executed",
            "node_id": node_id,
            "contract": contract,
            "output": jsonable(runner_result.get("output")),
            "sandbox_workspace_isolation": workspace_isolation,
            "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
        }
        if workspace_isolation == "container":
            result["stderr"] = stderr
            result["container_image"] = image
            result["container_engine"] = engine
            result["container_network"] = "none"
            result["container_policy"] = container_policy
        return result

    def shell_command_for_language(language: str) -> str:
        return "sh" if language in {"shell", "sh"} else "bash"

    def execute_custom_shell_code(config: dict[str, Any], state: ReferenceState, contract: dict[str, Any]) -> dict[str, Any]:
        node_id = config["id"]
        started_at = time.perf_counter()
        language = str(config.get("codeLanguage") or "bash").lower()
        command_name = shell_command_for_language(language)
        source_path = config.get("codePath")
        inline_source = config.get("codeInline")
        request_payload, payload_bytes, payload_policy = external_request_payload(config, state, contract)
        max_payload_bytes = code_max_payload_bytes(config)
        if max_payload_bytes and payload_bytes > max_payload_bytes:
            return payload_too_large_result(config, contract, payload_bytes, payload_policy, started_at)
        retry_attempts = code_retry_attempts(config)
        max_attempts = retry_attempts + 1
        timeout_seconds = int(config.get("timeoutSeconds") or 30)
        image = None
        engine = None
        container_policy = None
        last_result: dict[str, Any] | None = None
        with custom_code_workspace(config) as (workspace, workspace_isolation):
            if inline_source:
                script_path = workspace / f"agent_flow_inline_{node_id}.sh"
                script_path.write_text(str(inline_source), encoding="utf-8")
            elif source_path:
                script_path = safe_code_path_in_root(str(source_path), workspace)
            else:
                return {
                    "ok": False,
                    "status": "custom_code_not_executed",
                    "node_id": node_id,
                    "contract": contract,
                    "reason": "missing_code_source",
                    "sandbox_workspace_isolation": workspace_isolation,
                }
            relative_script_path = script_path.relative_to(workspace).as_posix()
            run_command = [command_name, relative_script_path]
            subprocess_env = custom_subprocess_env(config, workspace_isolation)
            if workspace_isolation == "container":
                image = str(config.get("sandboxContainerImage") or os.environ.get("AGENT_FLOW_CODE_CONTAINER_IMAGE") or "").strip()
                engine = str(config.get("sandboxContainerEngine") or os.environ.get("AGENT_FLOW_CODE_CONTAINER_ENGINE") or "docker").strip()
                container_policy_args, container_policy = container_runtime_policy(config)
                if not image:
                    return {
                        "ok": False,
                        "status": "custom_code_not_executed",
                        "node_id": node_id,
                        "contract": contract,
                        "reason": "container_image_not_configured",
                        "error": "sandboxContainerImage ou AGENT_FLOW_CODE_CONTAINER_IMAGE precisa ser configurado para sandboxIsolation=container.",
                        "sandbox_workspace_isolation": workspace_isolation,
                        "container_engine": engine,
                        "container_policy": container_policy,
                        "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
                    }
                engine_path = shutil.which(engine)
                if not engine_path:
                    return {
                        "ok": False,
                        "status": "custom_code_failed",
                        "node_id": node_id,
                        "contract": contract,
                        "error": f"container_engine_not_available:{engine}",
                        "sandbox_workspace_isolation": workspace_isolation,
                        "container_image": image,
                        "container_engine": engine,
                        "container_policy": container_policy,
                        "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
                    }
                env_args: list[str] = ["-e", "AGENT_FLOW_SANDBOX_ISOLATION=container"]
                for key in config_string_list(config, "sandboxEnvAllowlist"):
                    value = os.environ.get(key)
                    if value is not None:
                        env_args.extend(["-e", f"{key}={value}"])
                run_command = [
                    engine_path,
                    "run",
                    "--rm",
                    "--network",
                    "none",
                    *container_policy_args,
                    "-i",
                    "-v",
                    f"{workspace.parent.resolve()}:/workspace:rw",
                    "-w",
                    "/workspace/code",
                    *env_args,
                    image,
                    command_name,
                    relative_script_path,
                ]
                subprocess_env = None
            for attempt in range(1, max_attempts + 1):
                try:
                    completed = subprocess.run(
                        run_command,
                        input=json.dumps(request_payload),
                        text=True,
                        capture_output=True,
                        timeout=timeout_seconds,
                        cwd=str(workspace) if workspace_isolation != "container" else None,
                        env=subprocess_env,
                        check=False,
                    )
                    stdout = (completed.stdout or "").strip()
                    stderr = (completed.stderr or "").strip()
                    try:
                        content: Any = json.loads(stdout) if stdout else None
                    except json.JSONDecodeError:
                        content = stdout
                    if isinstance(content, dict):
                        external_ok = bool(content.get("ok", True))
                        output = content.get("output") if "output" in content else content
                        error = content.get("error")
                    else:
                        external_ok = True
                        output = content
                        error = None
                    ok = completed.returncode == 0 and external_ok
                    last_result = attach_external_execution_metadata({
                        "ok": ok,
                        "status": "custom_code_executed" if ok else "custom_code_failed",
                        "node_id": node_id,
                        "contract": contract,
                        "output": jsonable(output),
                        "exit_code": completed.returncode,
                        "stderr": stderr,
                        "error": error,
                        "sandbox_workspace_isolation": workspace_isolation,
                        "container_image": image if workspace_isolation == "container" else None,
                        "container_engine": engine if workspace_isolation == "container" else None,
                        "container_network": "none" if workspace_isolation == "container" else None,
                        "container_policy": container_policy if workspace_isolation == "container" else None,
                        "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
                    }, attempts=attempt, retry_attempts=retry_attempts, payload_bytes=payload_bytes, payload_policy=payload_policy)
                    if ok or attempt >= max_attempts:
                        return last_result
                except subprocess.TimeoutExpired as exc:
                    last_result = attach_external_execution_metadata({
                        "ok": False,
                        "status": "custom_code_failed",
                        "node_id": node_id,
                        "contract": contract,
                        "error": f"shell_timeout_after_{timeout_seconds}s",
                        "stdout": str(exc.stdout or ""),
                        "stderr": str(exc.stderr or ""),
                        "sandbox_workspace_isolation": workspace_isolation,
                        "container_image": image if workspace_isolation == "container" else None,
                        "container_engine": engine if workspace_isolation == "container" else None,
                        "container_network": "none" if workspace_isolation == "container" else None,
                        "container_policy": container_policy if workspace_isolation == "container" else None,
                        "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
                    }, attempts=attempt, retry_attempts=retry_attempts, payload_bytes=payload_bytes, payload_policy=payload_policy)
                    if attempt >= max_attempts:
                        return last_result
                except Exception as exc:
                    last_result = attach_external_execution_metadata({
                        "ok": False,
                        "status": "custom_code_failed",
                        "node_id": node_id,
                        "contract": contract,
                        "error": str(exc),
                        "sandbox_workspace_isolation": workspace_isolation,
                        "container_image": image if workspace_isolation == "container" else None,
                        "container_engine": engine if workspace_isolation == "container" else None,
                        "container_network": "none" if workspace_isolation == "container" else None,
                        "container_policy": container_policy if workspace_isolation == "container" else None,
                        "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
                    }, attempts=attempt, retry_attempts=retry_attempts, payload_bytes=payload_bytes, payload_policy=payload_policy)
                    if attempt >= max_attempts:
                        return last_result
                time.sleep(min(0.25 * attempt, 1.0))
            return last_result or {
                "ok": False,
                "status": "custom_code_failed",
                "node_id": node_id,
                "contract": contract,
                "error": "shell_attempts_exhausted",
                "sandbox_workspace_isolation": workspace_isolation,
                "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
            }

    def execute_custom_http_adapter(
        config: dict[str, Any],
        state: ReferenceState,
        contract: dict[str, Any],
        missing_url_reason: str = "url_not_configured",
        adapter_payload: bool = False,
    ) -> dict[str, Any]:
        node_id = config["id"]
        started_at = time.perf_counter()
        method = str(config.get("method") or "POST").upper()
        url = str(config.get("url") or "").strip()
        if not url:
            return {
                "ok": False,
                "status": "custom_code_not_executed",
                "node_id": node_id,
                "contract": contract,
                "reason": missing_url_reason,
            }

        request_payload, payload_bytes, payload_policy = external_request_payload(
            config,
            state,
            contract,
            adapter_payload=adapter_payload,
        )
        max_payload_bytes = code_max_payload_bytes(config)
        if max_payload_bytes and payload_bytes > max_payload_bytes:
            return payload_too_large_result(config, contract, payload_bytes, payload_policy, started_at)
        retry_attempts = code_retry_attempts(config)
        if url.startswith("mock://"):
            return attach_external_execution_metadata({
                "ok": True,
                "status": "custom_code_executed",
                "node_id": node_id,
                "contract": contract,
                "output": {
                    "mock": True,
                    "method": method,
                    "url": url,
                    "request": request_payload,
                },
                "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
            }, attempts=1, retry_attempts=retry_attempts, payload_bytes=payload_bytes, payload_policy=payload_policy)

        max_attempts = retry_attempts + 1
        last_result: dict[str, Any] | None = None
        for attempt in range(1, max_attempts + 1):
            data = None
            headers = {"Accept": "application/json"}
            if method not in {"GET", "DELETE"}:
                data = json.dumps(request_payload).encode("utf-8")
                headers["Content-Type"] = "application/json"
            request = urllib.request.Request(url, data=data, headers=headers, method=method)
            timeout = int(config.get("timeoutSeconds") or 30)
            try:
                with urllib.request.urlopen(request, timeout=timeout) as result:
                    raw = result.read().decode("utf-8", errors="replace")
                    try:
                        content: Any = json.loads(raw) if raw else None
                    except json.JSONDecodeError:
                        content = raw
                    if isinstance(content, dict):
                        external_ok = bool(content.get("ok", True))
                        output = content.get("output") if "output" in content else content
                        error = content.get("error")
                    else:
                        external_ok = True
                        output = content
                        error = None
                    last_result = attach_external_execution_metadata({
                        "ok": external_ok and 200 <= result.status < 400,
                        "status": "custom_code_executed" if external_ok and 200 <= result.status < 400 else "custom_code_failed",
                        "node_id": node_id,
                        "contract": contract,
                        "output": jsonable(output),
                        "status_code": result.status,
                        "error": error,
                        "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
                    }, attempts=attempt, retry_attempts=retry_attempts, payload_bytes=payload_bytes, payload_policy=payload_policy)
                    if last_result.get("ok") or attempt >= max_attempts:
                        return last_result
            except urllib.error.HTTPError as exc:
                raw = exc.read().decode("utf-8", errors="replace")
                last_result = attach_external_execution_metadata({
                    "ok": False,
                    "status": "custom_code_failed",
                    "node_id": node_id,
                    "contract": contract,
                    "status_code": exc.code,
                    "error": raw,
                    "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
                }, attempts=attempt, retry_attempts=retry_attempts, payload_bytes=payload_bytes, payload_policy=payload_policy)
                if attempt >= max_attempts:
                    return last_result
            except Exception as exc:
                last_result = attach_external_execution_metadata({
                    "ok": False,
                    "status": "custom_code_failed",
                    "node_id": node_id,
                    "contract": contract,
                    "error": str(exc),
                    "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
                }, attempts=attempt, retry_attempts=retry_attempts, payload_bytes=payload_bytes, payload_policy=payload_policy)
                if attempt >= max_attempts:
                    return last_result
            time.sleep(min(0.25 * attempt, 1.0))
        return last_result or {
            "ok": False,
            "status": "custom_code_failed",
            "node_id": node_id,
            "contract": contract,
            "error": "external_executor_attempts_exhausted",
            "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
        }

    def execute_custom_http_code(config: dict[str, Any], state: ReferenceState, contract: dict[str, Any]) -> dict[str, Any]:
        return execute_custom_http_adapter(config, state, contract)

    def execute_custom_runtime_adapter_code(config: dict[str, Any], state: ReferenceState, contract: dict[str, Any]) -> dict[str, Any]:
        return execute_custom_http_adapter(
            config,
            state,
            contract,
            missing_url_reason="runtime_adapter_url_not_configured",
            adapter_payload=True,
        )

    def execute_custom_sidecar_code(config: dict[str, Any], state: ReferenceState, contract: dict[str, Any]) -> dict[str, Any]:
        node_id = config["id"]
        started_at = time.perf_counter()
        command = str(config.get("sidecarCommand") or "").strip()
        raw_args = config.get("sidecarArgs") or []
        if isinstance(raw_args, str):
            sidecar_args = [item.strip() for item in raw_args.splitlines() if item.strip()]
        elif isinstance(raw_args, list):
            sidecar_args = [str(item).strip() for item in raw_args if str(item).strip()]
        else:
            sidecar_args = []
        if not command:
            return {
                "ok": False,
                "status": "custom_code_not_executed",
                "node_id": node_id,
                "contract": contract,
                "reason": "sidecar_command_not_configured",
            }

        request_payload, payload_bytes, payload_policy = external_request_payload(config, state, contract)
        max_payload_bytes = code_max_payload_bytes(config)
        if max_payload_bytes and payload_bytes > max_payload_bytes:
            return payload_too_large_result(config, contract, payload_bytes, payload_policy, started_at)
        retry_attempts = code_retry_attempts(config)
        max_attempts = retry_attempts + 1
        timeout_seconds = int(config.get("timeoutSeconds") or 30)
        last_result: dict[str, Any] | None = None
        with custom_code_workspace(config) as (workspace, workspace_isolation):
            subprocess_env = custom_subprocess_env(config, workspace_isolation)
            for attempt in range(1, max_attempts + 1):
                try:
                    completed = subprocess.run(
                        [command, *sidecar_args],
                        input=json.dumps(request_payload),
                        text=True,
                        capture_output=True,
                        timeout=timeout_seconds,
                        cwd=str(workspace),
                        env=subprocess_env,
                        check=False,
                    )
                    stdout = (completed.stdout or "").strip()
                    stderr = (completed.stderr or "").strip()
                    try:
                        content: Any = json.loads(stdout) if stdout else None
                    except json.JSONDecodeError:
                        content = stdout
                    if isinstance(content, dict):
                        external_ok = bool(content.get("ok", True))
                        output = content.get("output") if "output" in content else content
                        error = content.get("error")
                    else:
                        external_ok = True
                        output = content
                        error = None
                    ok = completed.returncode == 0 and external_ok
                    last_result = attach_external_execution_metadata({
                        "ok": ok,
                        "status": "custom_code_executed" if ok else "custom_code_failed",
                        "node_id": node_id,
                        "contract": contract,
                        "output": jsonable(output),
                        "exit_code": completed.returncode,
                        "stderr": stderr,
                        "error": error,
                        "sandbox_workspace_isolation": workspace_isolation,
                        "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
                    }, attempts=attempt, retry_attempts=retry_attempts, payload_bytes=payload_bytes, payload_policy=payload_policy)
                    if ok or attempt >= max_attempts:
                        return last_result
                except subprocess.TimeoutExpired as exc:
                    last_result = attach_external_execution_metadata({
                        "ok": False,
                        "status": "custom_code_failed",
                        "node_id": node_id,
                        "contract": contract,
                        "error": f"sidecar_timeout_after_{timeout_seconds}s",
                        "stdout": str(exc.stdout or ""),
                        "stderr": str(exc.stderr or ""),
                        "sandbox_workspace_isolation": workspace_isolation,
                        "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
                    }, attempts=attempt, retry_attempts=retry_attempts, payload_bytes=payload_bytes, payload_policy=payload_policy)
                    if attempt >= max_attempts:
                        return last_result
                except Exception as exc:
                    last_result = attach_external_execution_metadata({
                        "ok": False,
                        "status": "custom_code_failed",
                        "node_id": node_id,
                        "contract": contract,
                        "error": str(exc),
                        "sandbox_workspace_isolation": workspace_isolation,
                        "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
                    }, attempts=attempt, retry_attempts=retry_attempts, payload_bytes=payload_bytes, payload_policy=payload_policy)
                    if attempt >= max_attempts:
                        return last_result
                time.sleep(min(0.25 * attempt, 1.0))
            return last_result or {
                "ok": False,
                "status": "custom_code_failed",
                "node_id": node_id,
                "contract": contract,
                "error": "sidecar_attempts_exhausted",
                "sandbox_workspace_isolation": workspace_isolation,
                "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
            }

    def execute_custom_mcp_code(config: dict[str, Any], state: ReferenceState, contract: dict[str, Any]) -> dict[str, Any]:
        node_id = config["id"]
        started_at = time.perf_counter()
        command = str(config.get("mcpCommand") or "").strip()
        tool_name = str(config.get("mcpToolName") or "").strip()
        raw_args = config.get("mcpArgs") or []
        if isinstance(raw_args, str):
            mcp_args = [item.strip() for item in raw_args.splitlines() if item.strip()]
        elif isinstance(raw_args, list):
            mcp_args = [str(item).strip() for item in raw_args if str(item).strip()]
        else:
            mcp_args = []
        if not command:
            return {
                "ok": False,
                "status": "custom_code_not_executed",
                "node_id": node_id,
                "contract": contract,
                "reason": "mcp_command_not_configured",
            }
        if not tool_name:
            return {
                "ok": False,
                "status": "custom_code_not_executed",
                "node_id": node_id,
                "contract": contract,
                "reason": "mcp_tool_not_configured",
            }

        request_payload, payload_bytes, payload_policy = external_request_payload(config, state, contract)
        max_payload_bytes = code_max_payload_bytes(config)
        if max_payload_bytes and payload_bytes > max_payload_bytes:
            return payload_too_large_result(config, contract, payload_bytes, payload_policy, started_at)
        retry_attempts = code_retry_attempts(config)
        tool_input = request_payload.get("input")
        tool_arguments = tool_input if isinstance(tool_input, dict) else {"input": jsonable(tool_input)}
        protocol_version = str(config.get("mcpProtocolVersion") or "2025-11-25")
        messages = [
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": protocol_version,
                    "capabilities": {},
                    "clientInfo": {"name": "agent-flow-runtime", "version": "0.1.0"},
                },
            },
            {
                "jsonrpc": "2.0",
                "method": "notifications/initialized",
                "params": {},
            },
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": tool_name,
                    "arguments": jsonable(tool_arguments),
                },
            },
        ]
        stdin_payload = "\\n".join(json.dumps(message) for message in messages) + "\\n"
        timeout_seconds = int(config.get("timeoutSeconds") or 30)
        max_attempts = retry_attempts + 1
        last_result: dict[str, Any] | None = None
        with custom_code_workspace(config) as (workspace, workspace_isolation):
            subprocess_env = custom_subprocess_env(config, workspace_isolation)
            for attempt in range(1, max_attempts + 1):
                try:
                    completed = subprocess.run(
                        [command, *mcp_args],
                        input=stdin_payload,
                        text=True,
                        capture_output=True,
                        timeout=timeout_seconds,
                        cwd=str(workspace),
                        env=subprocess_env,
                        check=False,
                    )
                except subprocess.TimeoutExpired as exc:
                    last_result = attach_external_execution_metadata({
                        "ok": False,
                        "status": "custom_code_failed",
                        "node_id": node_id,
                        "contract": contract,
                        "error": f"mcp_timeout_after_{timeout_seconds}s",
                        "stdout": str(exc.stdout or ""),
                        "stderr": str(exc.stderr or ""),
                        "sandbox_workspace_isolation": workspace_isolation,
                        "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
                    }, attempts=attempt, retry_attempts=retry_attempts, payload_bytes=payload_bytes, payload_policy=payload_policy)
                    if attempt >= max_attempts:
                        return last_result
                    time.sleep(min(0.25 * attempt, 1.0))
                    continue
                except Exception as exc:
                    last_result = attach_external_execution_metadata({
                        "ok": False,
                        "status": "custom_code_failed",
                        "node_id": node_id,
                        "contract": contract,
                        "error": str(exc),
                        "sandbox_workspace_isolation": workspace_isolation,
                        "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
                    }, attempts=attempt, retry_attempts=retry_attempts, payload_bytes=payload_bytes, payload_policy=payload_policy)
                    if attempt >= max_attempts:
                        return last_result
                    time.sleep(min(0.25 * attempt, 1.0))
                    continue

                stdout = (completed.stdout or "").strip()
                stderr = (completed.stderr or "").strip()
                responses: list[dict[str, Any]] = []
                for line in stdout.splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        message = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(message, dict):
                        responses.append(message)
                initialize_response = next((message for message in responses if message.get("id") == 1), None)
                tool_response = next((message for message in responses if message.get("id") == 2), None)
                if completed.returncode != 0:
                    last_result = attach_external_execution_metadata({
                        "ok": False,
                        "status": "custom_code_failed",
                        "node_id": node_id,
                        "contract": contract,
                        "exit_code": completed.returncode,
                        "stderr": stderr,
                        "error": "mcp_process_failed",
                        "sandbox_workspace_isolation": workspace_isolation,
                        "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
                    }, attempts=attempt, retry_attempts=retry_attempts, payload_bytes=payload_bytes, payload_policy=payload_policy)
                elif not tool_response:
                    last_result = attach_external_execution_metadata({
                        "ok": False,
                        "status": "custom_code_failed",
                        "node_id": node_id,
                        "contract": contract,
                        "stderr": stderr,
                        "error": "mcp_tools_call_response_missing",
                        "mcp_initialize": jsonable(initialize_response),
                        "sandbox_workspace_isolation": workspace_isolation,
                        "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
                    }, attempts=attempt, retry_attempts=retry_attempts, payload_bytes=payload_bytes, payload_policy=payload_policy)
                elif tool_response.get("error"):
                    last_result = attach_external_execution_metadata({
                        "ok": False,
                        "status": "custom_code_failed",
                        "node_id": node_id,
                        "contract": contract,
                        "stderr": stderr,
                        "error": jsonable(tool_response.get("error")),
                        "mcp_initialize": jsonable(initialize_response),
                        "sandbox_workspace_isolation": workspace_isolation,
                        "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
                    }, attempts=attempt, retry_attempts=retry_attempts, payload_bytes=payload_bytes, payload_policy=payload_policy)
                else:
                    result = tool_response.get("result") if isinstance(tool_response.get("result"), dict) else {}
                    output: Any = result
                    content = result.get("content") if isinstance(result, dict) else None
                    if isinstance(result, dict) and "structuredContent" in result:
                        output = result.get("structuredContent")
                    elif isinstance(content, list) and len(content) == 1 and isinstance(content[0], dict) and content[0].get("type") == "text":
                        text = str(content[0].get("text") or "")
                        try:
                            output = json.loads(text)
                        except json.JSONDecodeError:
                            output = text
                    return attach_external_execution_metadata({
                        "ok": True,
                        "status": "custom_code_executed",
                        "node_id": node_id,
                        "contract": contract,
                        "output": jsonable(output),
                        "mcp_initialize": jsonable(initialize_response),
                        "sandbox_workspace_isolation": workspace_isolation,
                        "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
                    }, attempts=attempt, retry_attempts=retry_attempts, payload_bytes=payload_bytes, payload_policy=payload_policy)
                if attempt >= max_attempts:
                    return last_result
                time.sleep(min(0.25 * attempt, 1.0))
            return last_result or {
                "ok": False,
                "status": "custom_code_failed",
                "node_id": node_id,
                "contract": contract,
                "error": "mcp_attempts_exhausted",
                "sandbox_workspace_isolation": workspace_isolation,
                "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
            }

    def execute_custom_code(config: dict[str, Any], state: ReferenceState, contract: dict[str, Any]) -> dict[str, Any]:
        language = str(config.get("codeLanguage") or "python").lower()
        execution = str(config.get("codeExecution") or "native").lower()
        if execution == "http":
            return execute_custom_http_code(config, state, contract)
        if execution == "runtime_adapter":
            if requested_vm(config):
                try:
                    return execute_custom_vm_code(config, state, contract)
                except Exception as exc:
                    return {
                        "ok": False,
                        "status": "custom_code_failed",
                        "node_id": config["id"],
                        "contract": contract,
                        "error": str(exc),
                        "traceback": traceback.format_exc(limit=5),
                        "sandbox_workspace_isolation": "vm",
                    }
            return execute_custom_runtime_adapter_code(config, state, contract)
        if execution == "mcp":
            return execute_custom_mcp_code(config, state, contract)
        if execution == "sidecar":
            return execute_custom_sidecar_code(config, state, contract)
        if language == "external":
            return {
                "ok": False,
                "status": "custom_code_not_executed",
                "node_id": config["id"],
                "contract": contract,
                "reason": "external_executor_not_configured",
            }
        if shell_runtime_custom_code(config):
            if requested_vm(config):
                try:
                    return execute_custom_vm_code(config, state, contract)
                except Exception as exc:
                    return {
                        "ok": False,
                        "status": "custom_code_failed",
                        "node_id": config["id"],
                        "contract": contract,
                        "error": str(exc),
                        "traceback": traceback.format_exc(limit=5),
                        "sandbox_workspace_isolation": "vm",
                    }
            try:
                return execute_custom_shell_code(config, state, contract)
            except Exception as exc:
                return {
                    "ok": False,
                    "status": "custom_code_failed",
                    "node_id": config["id"],
                    "contract": contract,
                    "error": str(exc),
                    "traceback": traceback.format_exc(limit=5),
                }
        if requested_vm(config) and (python_runtime_custom_code(config) or node_runtime_custom_code(config)):
            try:
                return execute_custom_vm_code(config, state, contract)
            except Exception as exc:
                return {
                    "ok": False,
                    "status": "custom_code_failed",
                    "node_id": config["id"],
                    "contract": contract,
                    "error": str(exc),
                    "traceback": traceback.format_exc(limit=5),
                    "sandbox_workspace_isolation": "vm",
                }
        if language in {"javascript", "js", "typescript", "ts"}:
            try:
                return execute_custom_node_code(config, state, contract)
            except Exception as exc:
                return {
                    "ok": False,
                    "status": "custom_code_failed",
                    "node_id": config["id"],
                    "contract": contract,
                    "error": str(exc),
                    "traceback": traceback.format_exc(limit=5),
                }
        if language not in {"python", "py"}:
            return {
                "ok": False,
                "status": "custom_code_not_executed",
                "node_id": config["id"],
                "contract": contract,
                "reason": "unsupported_language",
            }
        try:
            if requested_container(config) and python_runtime_custom_code(config):
                return execute_custom_python_container(config, state, contract)
            if requested_dedicated_process(config) and python_runtime_custom_code(config):
                return execute_custom_python_dedicated_process(config, state, contract)
            return execute_custom_python_code(config, state, contract)
        except Exception as exc:
            return {
                "ok": False,
                "status": "custom_code_failed",
                "node_id": config["id"],
                "contract": contract,
                "error": str(exc),
                "traceback": traceback.format_exc(limit=5),
            }

    def redact_log_text(value: Any) -> str:
        text = str(value or "")
        for marker in ["api_key=", "apikey=", "token=", "password=", "senha=", "secret="]:
            lower = text.lower()
            index = lower.find(marker)
            while index >= 0:
                end = len(text)
                for separator in ["&", " ", "\\n", "\\r", "\\t"]:
                    separator_index = text.find(separator, index + len(marker))
                    if separator_index >= 0:
                        end = min(end, separator_index)
                text = f"{text[:index]}{text[index:index + len(marker)]}***REDACTED***{text[end:]}"
                lower = text.lower()
                index = lower.find(marker, index + len(marker) + len("***REDACTED***"))
        return text

    def custom_execution_target(contract: dict[str, Any]) -> str:
        for key in ["url", "mcp_tool_name", "sidecar_command", "path", "entry"]:
            value = contract.get(key)
            if value not in (None, ""):
                return redact_log_text(value)
        return "inline"

    def custom_sandbox_metadata(contract: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
        execution = str(contract.get("execution") or "").lower()
        language = str(contract.get("language") or "").lower()
        requested_isolation = str(contract.get("sandbox_isolation") or "").lower()
        workspace_isolation = str(result.get("sandbox_workspace_isolation") or "").lower()
        if execution in {"http", "runtime_adapter"}:
            sandbox = {
                "isolation": "external_endpoint",
                "boundary": "network",
                "executor": execution,
                "transport": "http_json",
            }
        elif execution == "mcp":
            sandbox = {
                "isolation": "subprocess_stdio",
                "boundary": "process",
                "executor": redact_log_text(contract.get("mcp_command") or "mcp"),
                "transport": "jsonrpc_stdio",
                "cwd": "app/code",
            }
        elif execution == "sidecar":
            sandbox = {
                "isolation": "subprocess_stdio",
                "boundary": "process",
                "executor": redact_log_text(contract.get("sidecar_command") or "sidecar"),
                "transport": "stdin_stdout_json",
                "cwd": "app/code",
            }
        elif language in {"javascript", "js", "typescript", "ts"}:
            sandbox = {
                "isolation": "node_runner_process",
                "boundary": "process",
                "executor": "node",
                "transport": "stdin_stdout_json",
                "cwd": "app/code",
            }
        elif language in {"bash", "shell", "sh"}:
            sandbox = {
                "isolation": "shell_process",
                "boundary": "process",
                "executor": shell_command_for_language(language),
                "transport": "stdin_stdout_json",
                "cwd": "app/code",
            }
        elif language == "external":
            sandbox = {
                "isolation": "declared_external",
                "boundary": "external",
                "executor": "unconfigured",
                "transport": "declared",
            }
        else:
            sandbox = {
                "isolation": "runtime_process",
                "boundary": "in_process",
                "executor": "python",
                "transport": "function_call",
            }
        if requested_isolation:
            sandbox["requested_isolation"] = requested_isolation
        env_allowlist = contract.get("sandbox_env_allowlist")
        if isinstance(env_allowlist, list) and env_allowlist:
            sandbox["env_allowlist"] = env_allowlist
        if workspace_isolation == "dedicated_process":
            base_isolation = sandbox.get("isolation")
            sandbox["base_isolation"] = base_isolation
            sandbox["isolation"] = "dedicated_process"
            sandbox["boundary"] = "process_workspace"
            sandbox["executor"] = shell_command_for_language(language) if language in {"bash", "shell", "sh"} else "python"
            sandbox["transport"] = "stdin_stdout_json"
            sandbox["workspace"] = "temporary_copy"
            sandbox["cleanup"] = "after_execution"
        elif workspace_isolation == "container":
            base_isolation = sandbox.get("isolation")
            sandbox["base_isolation"] = base_isolation
            sandbox["isolation"] = "container"
            sandbox["boundary"] = "container"
            if language in {"javascript", "js", "typescript", "ts"}:
                sandbox["executor"] = "node"
            elif language in {"bash", "shell", "sh"}:
                sandbox["executor"] = shell_command_for_language(language)
            else:
                sandbox["executor"] = "python"
            sandbox["transport"] = "stdin_stdout_json"
            sandbox["workspace"] = "temporary_copy"
            sandbox["cleanup"] = "after_execution"
            sandbox["image"] = result.get("container_image") or contract.get("sandbox_container_image")
            sandbox["engine"] = result.get("container_engine") or contract.get("sandbox_container_engine") or "docker"
            sandbox["network"] = result.get("container_network") or "none"
            container_policy = result.get("container_policy")
            if isinstance(container_policy, dict) and container_policy:
                sandbox["policy"] = container_policy
                sandbox["profile"] = container_policy.get("profile")
                sandbox["memory"] = container_policy.get("memory")
                sandbox["cpus"] = container_policy.get("cpus")
                sandbox["pids_limit"] = container_policy.get("pids_limit")
                sandbox["read_only_rootfs"] = container_policy.get("read_only_rootfs")
                sandbox["drop_capabilities"] = container_policy.get("drop_capabilities")
                sandbox["no_new_privileges"] = container_policy.get("no_new_privileges")
        elif workspace_isolation == "vm":
            base_isolation = sandbox.get("isolation")
            sandbox["base_isolation"] = base_isolation
            sandbox["isolation"] = "vm"
            sandbox["boundary"] = "microvm"
            if language in {"javascript", "js", "typescript", "ts"}:
                sandbox["executor"] = "node"
            elif language in {"bash", "shell", "sh"}:
                sandbox["executor"] = shell_command_for_language(language)
            else:
                sandbox["executor"] = "python"
            sandbox["transport"] = "stdin_stdout_json"
            sandbox["workspace"] = "temporary_copy"
            sandbox["cleanup"] = "after_execution"
            sandbox["engine"] = result.get("vm_runner") or contract.get("sandbox_vm_runner") or "vm_runner"
            vm_policy = result.get("vm_policy")
            if isinstance(vm_policy, dict) and vm_policy:
                sandbox["policy"] = vm_policy
                sandbox["profile"] = vm_policy.get("profile")
                sandbox["image"] = vm_policy.get("image") or contract.get("sandbox_vm_image")
                sandbox["memory"] = vm_policy.get("memory")
                sandbox["cpus"] = vm_policy.get("cpus")
        elif workspace_isolation == "ephemeral_workspace":
            base_isolation = sandbox.get("isolation")
            sandbox["base_isolation"] = base_isolation
            sandbox["isolation"] = "ephemeral_workspace"
            sandbox["boundary"] = "process_workspace"
            sandbox["workspace"] = "temporary_copy"
            sandbox["cleanup"] = "after_execution"
        elif requested_isolation == "ephemeral_workspace":
            sandbox["isolation_status"] = "not_applicable"
        elif requested_isolation == "dedicated_process":
            sandbox["isolation_status"] = "not_applicable"
        elif requested_isolation == "container":
            sandbox["isolation_status"] = "not_applicable"
        elif requested_isolation == "vm":
            sandbox["isolation_status"] = "not_applicable"
        for source_key, target_key in [
            ("timeout_seconds", "timeout_seconds"),
            ("attempts", "attempts"),
            ("retry_attempts", "retry_attempts"),
            ("payload_bytes", "payload_bytes"),
        ]:
            value = result.get(source_key) if source_key in result else contract.get(source_key)
            if value not in (None, ""):
                sandbox[target_key] = value
        payload_policy = result.get("payload_policy")
        if isinstance(payload_policy, dict) and payload_policy:
            sandbox["payload_policy"] = payload_policy
        return {key: value for key, value in sandbox.items() if value not in (None, "")}

    def with_custom_observability(node_id: str, result: dict[str, Any]) -> dict[str, Any]:
        enriched = dict(result)
        contract = enriched.get("contract") if isinstance(enriched.get("contract"), dict) else {}
        mode = str(contract.get("execution") or contract.get("language") or "native")
        status = str(enriched.get("status") or ("custom_code_executed" if enriched.get("ok") else "custom_code_failed"))
        sandbox = custom_sandbox_metadata(contract, enriched)
        execution_log = {
            "mode": mode,
            "status": status,
            "node_id": node_id,
            "target": custom_execution_target(contract),
            "sandbox_isolation": sandbox.get("isolation"),
            "sandbox_boundary": sandbox.get("boundary"),
            "sandbox_executor": sandbox.get("executor"),
            "sandbox_transport": sandbox.get("transport"),
            "sandbox_requested_isolation": sandbox.get("requested_isolation"),
            "sandbox_base_isolation": sandbox.get("base_isolation"),
            "sandbox_workspace": sandbox.get("workspace"),
            "sandbox_cleanup": sandbox.get("cleanup"),
            "sandbox_image": sandbox.get("image"),
            "sandbox_engine": sandbox.get("engine"),
            "sandbox_network": sandbox.get("network"),
            "sandbox_profile": sandbox.get("profile"),
            "input_path": contract.get("input_path"),
            "duration_ms": enriched.get("duration_ms"),
            "status_code": enriched.get("status_code"),
            "exit_code": enriched.get("exit_code"),
            "attempts": enriched.get("attempts"),
            "retry_attempts": enriched.get("retry_attempts"),
            "payload_bytes": enriched.get("payload_bytes"),
            "payload_policy": enriched.get("payload_policy"),
            "reason": enriched.get("reason"),
            "error": redact_log_text(enriched.get("error")) if enriched.get("error") is not None else None,
            "stderr": redact_log_text(enriched.get("stderr")) if enriched.get("stderr") else None,
        }
        enriched["execution_log"] = {key: value for key, value in execution_log.items() if value not in (None, "")}
        enriched["sandbox"] = sandbox
        enriched["span"] = {
            "name": f"custom_code.{mode}",
            "status": "ok" if enriched.get("ok") else "error",
            "duration_ms": enriched.get("duration_ms"),
            "operation": "custom_code",
            "target": enriched["execution_log"].get("target"),
        }
        return enriched

    def remember_custom_result(state: ReferenceState, node_id: str, result_path: str, result: dict[str, Any]) -> ReferenceState:
        result = with_custom_observability(node_id, result)
        updates: dict[str, Any] = {}
        custom_results = dict(state.get("custom") or {})
        custom_results[node_id] = result
        updates["custom"] = custom_results
        if result.get("ok") and result_path != f"custom.{node_id}":
            assign_state_path(updates, state, result_path, result.get("output"))
        if not result.get("ok") and result.get("status") == "custom_code_failed":
            updates["status"] = "error"
            updates["phase"] = "failed"
            updates["is_complete"] = True
            updates["assistant_message"] = {"code": "ERR", "text": f"Falha no código customizado do nó {node_id}."}
        return mark_node(state, node_id, updates)

    def read_asset_text(relative_path: str, max_chars: int) -> dict[str, Any]:
        path = safe_asset_path(relative_path)
        if not path.exists() or not path.is_file():
            return {
                "ok": False,
                "source_path": relative_path,
                "error": "file_not_found",
            }
        if path.suffix.lower() == ".pdf":
            try:
                from pypdf import PdfReader

                reader = PdfReader(str(path))
                content = "\\n".join(page.extract_text() or "" for page in reader.pages)
            except Exception as exc:
                return {
                    "ok": False,
                    "source_path": relative_path,
                    "error": str(exc),
                }
        else:
            content = path.read_text(encoding="utf-8", errors="replace")
        content = content[:max_chars]
        return {
            "ok": True,
            "source_path": relative_path,
            "chars": len(content),
            "content": content,
        }

    def chunk_text(content: str, chunk_size: int) -> list[str]:
        normalized = "\\n".join(line.strip() for line in content.splitlines())
        paragraphs = [part.strip() for part in normalized.split("\\n\\n") if part.strip()]
        chunks: list[str] = []
        current = ""
        for paragraph in paragraphs or [normalized]:
            if len(current) + len(paragraph) + 2 <= chunk_size:
                current = f"{current}\\n\\n{paragraph}".strip()
                continue
            if current:
                chunks.append(current)
            while len(paragraph) > chunk_size:
                chunks.append(paragraph[:chunk_size])
                paragraph = paragraph[chunk_size:]
            current = paragraph
        if current:
            chunks.append(current)
        return chunks

    def lexical_score(query: str, text_value: str) -> int:
        terms = [term for term in query.lower().replace("\\n", " ").split(" ") if len(term) >= 3]
        haystack = text_value.lower()
        return sum(haystack.count(term) for term in terms)

    def remember_file_result(state: ReferenceState, node_id: str, content_path: str, result: dict[str, Any]) -> ReferenceState:
        updates: dict[str, Any] = {}
        file_results = dict(state.get("files") or {})
        file_results[node_id] = result
        updates["files"] = file_results
        if content_path != f"files.{node_id}":
            assign_state_path(updates, state, content_path, result)
        return mark_node(state, node_id, updates)

    def remember_rag_result(state: ReferenceState, node_id: str, context_path: str, result: dict[str, Any]) -> ReferenceState:
        updates: dict[str, Any] = {}
        rag_results = dict(state.get("rag") or {})
        rag_results[node_id] = result
        updates["rag"] = rag_results
        if context_path != f"rag.{node_id}":
            assign_state_path(updates, state, context_path, result)
        return mark_node(state, node_id, updates)

    def remember_approval_result(state: ReferenceState, node_id: str, result_path: str, result: dict[str, Any]) -> ReferenceState:
        updates: dict[str, Any] = {}
        approval_results = dict(state.get("approvals") or {})
        approval_results[node_id] = result
        updates["approvals"] = approval_results
        if result["decision"] == "pending":
            updates["status"] = "active"
            updates["phase"] = "awaiting_approval"
            updates["is_complete"] = False
            updates["assistant_message"] = {"code": "APR", "text": "Aguardando aprovação humana."}
        if result_path != f"approvals.{node_id}":
            assign_state_path(updates, state, result_path, result)
        return mark_node(state, node_id, updates)

    def remember_score_result(state: ReferenceState, node_id: str, result_path: str, result: dict[str, Any]) -> ReferenceState:
        updates: dict[str, Any] = {}
        score_results = dict(state.get("scores") or {})
        score_results[node_id] = result
        updates["scores"] = score_results
        if result_path != f"scores.{node_id}":
            assign_state_path(updates, state, result_path, result)
        return mark_node(state, node_id, updates)

    def remember_analytics_result(state: ReferenceState, node_id: str, result_path: str, result: dict[str, Any]) -> ReferenceState:
        updates: dict[str, Any] = {}
        analytics_results = dict(state.get("analytics") or {})
        analytics_results[node_id] = result
        updates["analytics"] = analytics_results
        if result_path != f"analytics.{node_id}":
            assign_state_path(updates, state, result_path, result)
        return mark_node(state, node_id, updates)

    def make_start_node(config: dict[str, Any]):
        node_id = config["id"]

        def run(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "start")
            if pinned is not None:
                return pinned
            return mark_node(state, node_id, {
                "status": "active",
                "phase": "awaiting_turn",
                "assistant_message": {"code": "ABR", "text": START_MESSAGE},
                "is_complete": False,
            })

        return run

    def safety_decision_payload(decision: Any, node_id: str, stage: str | None) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "blocked": decision.blocked,
            "decision": decision.decision,
        }
        for attr in ["category", "reason"]:
            value = getattr(decision, attr, None)
            if value is not None:
                payload[attr] = value
        extra_values = {
            "severity": getattr(decision, "severity", None),
            "action": getattr(decision, "action", None),
            "rule_id": getattr(decision, "rule_id", None),
            "rule_label": getattr(decision, "rule_label", None),
            "match_type": getattr(decision, "match_type", None),
            "matched_text": getattr(decision, "matched_text", None),
            "source": getattr(decision, "source", None),
            "provider_score": getattr(decision, "provider_score", None),
            "provider_error": getattr(decision, "provider_error", None),
        }
        if any(value not in (None, "") for value in extra_values.values()):
            payload["node_id"] = node_id
            if stage:
                payload["stage"] = stage
            for key, value in extra_values.items():
                if value not in (None, ""):
                    payload[key] = value
        return payload

    def make_safety_node(config: dict[str, Any]):
        node_id = config["id"]
        stage = config.get("stage")

        def run(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "safety")
            if pinned is not None:
                return pinned
            if stage == "input":
                decision = safety_gate.check_input(state.get("user_message", ""), config)
                if decision.blocked:
                    return mark_node(state, node_id, {
                        "safety": safety_decision_payload(decision, node_id, stage),
                        "assistant_message": {"code": "SEG", "text": decision.safe_response or "Mensagem bloqueada."},
                        "phase": "safety",
                        "is_complete": decision.decision == "block",
                        "status": "completed" if decision.decision == "block" else "active",
                    })
                payload = safety_decision_payload(decision, node_id, stage)
                if payload.get("category"):
                    return mark_node(state, node_id, {"safety": payload})
                return mark_node(state, node_id, {
                    "safety": {"blocked": False, "decision": "allow"},
                })

            if stage == "output":
                current_message = state.get("assistant_message") or {}
                decision = safety_gate.check_output(str(current_message.get("text") or ""), config)
                if decision.blocked:
                    return mark_node(state, node_id, {
                        "safety": safety_decision_payload(decision, node_id, stage),
                        "assistant_message": {"code": "SEG", "text": decision.safe_response or "Saída ajustada por segurança."},
                    })
                payload = safety_decision_payload(decision, node_id, stage)
                if payload.get("category"):
                    return mark_node(state, node_id, {"safety": payload})
                return mark_node(state, node_id, {})

            return mark_node(state, node_id, {})

        return run

    def make_llm_node(config: dict[str, Any]):
        node_id = config["id"]

        def run(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "llm")
            if pinned is not None:
                return pinned
            token_callback = CURRENT_TOKEN_STREAM.get()
            result = llm_client.generate(
                system_prompt=prompt_for_node(config),
                user_message=state.get("user_message", ""),
                context={
                    "session_id": state.get("session_id"),
                    "turn": state.get("turn", 0),
                    "max_turns": state.get("max_turns", 3),
                    "phase": state.get("phase"),
                    "node_id": node_id,
                },
                recent_messages=state.get("recent_messages", []),
                adapter=config.get("llmAdapter"),
                model=config.get("llmModel"),
                token_callback=token_callback,
            )
            llm_payload = {
                "provider": result.provider,
                "model": result.model,
                "attempts": result.attempts,
                "node_id": node_id,
            }
            if result.fallback_reason:
                llm_payload["fallback_reason"] = result.fallback_reason
                llm_payload["setup_command"] = result.setup_command
                llm_payload["docker_setup_command"] = result.docker_setup_command
                llm_payload["provider_error"] = result.provider_error
            return mark_node(state, node_id, {
                "assistant_message": {"code": "ECHO", "text": result.text},
                "llm": llm_payload,
            })

        return run

    def make_code_node(config: dict[str, Any]):
        node_id = config["id"]
        handler = config.get("handler")
        result_path = str(config.get("resultPath") or f"custom.{node_id}")
        custom_contract = {
            "language": config.get("codeLanguage"),
            "execution": config.get("codeExecution"),
            "path": config.get("codePath"),
            "entry": config.get("codeEntry"),
            "input_path": config.get("inputPath"),
            "has_inline_code": bool(config.get("codeInline")),
            "dependencies": config.get("codeDependencies"),
            "method": config.get("method"),
            "url": config.get("url"),
            "mcp_command": config.get("mcpCommand"),
            "mcp_args": config.get("mcpArgs"),
            "mcp_tool_name": config.get("mcpToolName"),
            "mcp_protocol_version": config.get("mcpProtocolVersion"),
            "sidecar_command": config.get("sidecarCommand"),
            "sidecar_args": config.get("sidecarArgs"),
            "timeout_seconds": config.get("timeoutSeconds"),
            "retry_attempts": config.get("retryAttempts"),
            "payload_allow_paths": config.get("payloadAllowPaths"),
            "redact_paths": config.get("redactPaths"),
            "max_payload_bytes": config.get("maxPayloadBytes"),
            "sandbox_isolation": config.get("sandboxIsolation"),
            "sandbox_env_allowlist": config.get("sandboxEnvAllowlist"),
            "sandbox_container_image": config.get("sandboxContainerImage"),
            "sandbox_container_engine": config.get("sandboxContainerEngine"),
            "sandbox_container_profile": config.get("sandboxContainerProfile"),
            "sandbox_container_memory": config.get("sandboxContainerMemory"),
            "sandbox_container_cpus": config.get("sandboxContainerCpus"),
            "sandbox_container_pids_limit": config.get("sandboxContainerPidsLimit"),
            "sandbox_container_read_only_rootfs": config.get("sandboxContainerReadOnlyRootfs"),
            "sandbox_container_drop_capabilities": config.get("sandboxContainerDropCapabilities"),
            "sandbox_container_no_new_privileges": config.get("sandboxContainerNoNewPrivileges"),
            "sandbox_vm_image_id": config.get("sandboxVmImageId"),
            "sandbox_vm_runner": config.get("sandboxVmRunner"),
            "sandbox_vm_args": config.get("sandboxVmArgs"),
            "sandbox_vm_image": config.get("sandboxVmImage"),
            "sandbox_vm_profile": config.get("sandboxVmProfile"),
            "sandbox_vm_memory": config.get("sandboxVmMemory"),
            "sandbox_vm_cpus": config.get("sandboxVmCpus"),
        }

        def deterministic_gate(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "code", result_path=result_path)
            if pinned is not None:
                return pinned
            next_turn = int(state.get("turn") or 0) + 1
            max_turns = int(state.get("max_turns") or 3)
            if next_turn >= max_turns:
                text = (state.get("assistant_message") or {}).get("text") or "Obrigado pela resposta."
                return mark_node(state, node_id, {
                    "turn": next_turn,
                    "status": "completed",
                    "phase": "closing",
                    "is_complete": True,
                    "assistant_message": {
                        "code": "ENC",
                        "text": f"{text}\\n\\nEncerramos por aqui porque o limite de turnos foi atingido.",
                    },
                })
            return mark_node(state, node_id, {
                "turn": next_turn,
                "status": "active",
                "phase": "awaiting_turn",
                "is_complete": False,
            })

        def run_custom_code(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "code", result_path=result_path)
            if pinned is not None:
                return pinned
            contract = {key: value for key, value in custom_contract.items() if value not in (None, "", False)}
            if not contract:
                return mark_node(state, node_id, {})
            return remember_custom_result(state, node_id, result_path, execute_custom_code(config, state, contract))

        return deterministic_gate if handler == "deterministic_gate" else run_custom_code

    def make_switch_node(config: dict[str, Any]):
        node_id = config["id"]

        def run(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "state")
            if pinned is not None:
                return pinned
            return mark_node(state, node_id, {})

        return run

    def make_human_input_node(config: dict[str, Any]):
        node_id = config["id"]

        def run(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "human_input")
            if pinned is not None:
                return pinned
            updates: ReferenceState = {
                "status": "active",
                "phase": "awaiting_turn",
                "is_complete": False,
            }
            if not state.get("assistant_message"):
                updates["assistant_message"] = {"code": "WAIT", "text": "Aguardando entrada do usuário."}
            return mark_node(state, node_id, updates)

        return run

    def make_http_request_node(config: dict[str, Any]):
        node_id = config["id"]
        method = str(config.get("method") or "GET").upper()
        url = str(config.get("url") or "")
        body_path = str(config.get("bodyPath") or "")
        response_path = str(config.get("responsePath") or f"http.{node_id}")
        timeout = int(config.get("timeoutSeconds") or 10)

        def run(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "http", result_path=response_path)
            if pinned is not None:
                return pinned
            request_body = state_path_value(state, body_path) if body_path else None
            if not url:
                response = {
                    "ok": False,
                    "skipped": True,
                    "method": method,
                    "url": url,
                    "reason": "url_not_configured",
                }
            elif url.startswith("mock://"):
                response = {
                    "ok": True,
                    "mock": True,
                    "method": method,
                    "url": url,
                    "request": request_body,
                }
            else:
                try:
                    data = None
                    headers = {"Accept": "application/json"}
                    if request_body is not None and method not in {"GET", "DELETE"}:
                        data = json.dumps(request_body).encode("utf-8")
                        headers["Content-Type"] = "application/json"
                    request = urllib.request.Request(url, data=data, headers=headers, method=method)
                    with urllib.request.urlopen(request, timeout=timeout) as result:
                        raw = result.read().decode("utf-8", errors="replace")
                        try:
                            content: Any = json.loads(raw)
                        except json.JSONDecodeError:
                            content = raw
                        response = {
                            "ok": 200 <= result.status < 400,
                            "status_code": result.status,
                            "method": method,
                            "url": url,
                            "body": content,
                        }
                except urllib.error.HTTPError as exc:
                    raw = exc.read().decode("utf-8", errors="replace")
                    response = {
                        "ok": False,
                        "status_code": exc.code,
                        "method": method,
                        "url": url,
                        "error": raw,
                    }
                except Exception as exc:
                    response = {
                        "ok": False,
                        "method": method,
                        "url": url,
                        "error": str(exc),
                    }

            updates: dict[str, Any] = {}
            http_results = dict(state.get("http") or {})
            http_results[node_id] = response
            updates["http"] = http_results
            if response_path != f"http.{node_id}":
                assign_state_path(updates, state, response_path, response)
            return mark_node(state, node_id, updates)

        return run

    def make_transform_json_node(config: dict[str, Any]):
        node_id = config["id"]
        input_path = str(config.get("inputPath") or "assistant_message")
        output_path = str(config.get("outputPath") or f"transforms.{node_id}")

        def run(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "transform", result_path=output_path)
            if pinned is not None:
                return pinned
            value = state_path_value(state, input_path)
            transformed = {
                "node_id": node_id,
                "input_path": input_path,
                "value": value,
            }
            updates: dict[str, Any] = {}
            transform_results = dict(state.get("transforms") or {})
            transform_results[node_id] = transformed
            updates["transforms"] = transform_results
            if output_path != f"transforms.{node_id}":
                assign_state_path(updates, state, output_path, transformed)
            return mark_node(state, node_id, updates)

        return run

    def make_database_query_node(config: dict[str, Any]):
        node_id = config["id"]
        query = str(config.get("query") or "")
        params_path = str(config.get("paramsPath") or "")
        result_path = str(config.get("resultPath") or f"database.{node_id}")
        max_rows = int(config.get("maxRows") or 50)

        def run(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "database", result_path=result_path)
            if pinned is not None:
                return pinned
            if not query.strip():
                result_payload = {
                    "ok": False,
                    "skipped": True,
                    "reason": "query_not_configured",
                }
                return remember_database_result(state, node_id, result_path, result_payload)

            params_value = state_path_value(state, params_path) if params_path else {}
            params = normalized_params(params_value, state)
            try:
                with graph_session_scope() as db:
                    result = db.execute(text(query), params)
                    if result.returns_rows:
                        rows = [dict(row) for row in result.mappings().fetchmany(max_rows)]
                        result_payload = {
                            "ok": True,
                            "rows": jsonable(rows),
                            "row_count": len(rows),
                            "max_rows": max_rows,
                        }
                    else:
                        result_payload = {
                            "ok": True,
                            "rows": [],
                            "row_count": result.rowcount,
                            "max_rows": max_rows,
                        }
            except Exception as exc:
                result_payload = {
                    "ok": False,
                    "error": str(exc),
                }
            return remember_database_result(state, node_id, result_path, result_payload)

        return run

    def make_database_save_node(config: dict[str, Any]):
        node_id = config["id"]
        table = str(config.get("table") or "agent_node_records")
        query = str(config.get("query") or "")
        data_path = str(config.get("dataPath") or "assistant_message")
        params_path = str(config.get("paramsPath") or data_path)
        result_path = str(config.get("resultPath") or f"database.{node_id}")

        def run(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "database", result_path=result_path)
            if pinned is not None:
                return pinned
            data_value = jsonable(state_path_value(state, data_path))
            params = normalized_params(state_path_value(state, params_path), state)
            try:
                with graph_session_scope() as db:
                    if query.strip():
                        result = db.execute(text(query), params)
                        result_payload = {
                            "ok": True,
                            "mode": "query",
                            "row_count": result.rowcount,
                        }
                    elif table == "agent_node_records":
                        record_id = str(uuid4())
                        db.add(
                            AgentNodeRecord(
                                record_id=record_id,
                                session_id=str(state.get("session_id") or ""),
                                node_id=node_id,
                                payload_json=data_value,
                            )
                        )
                        db.flush()
                        result_payload = {
                            "ok": True,
                            "mode": "node_record",
                            "table": table,
                            "record_id": record_id,
                        }
                    else:
                        if not is_sql_identifier(table):
                            raise ValueError("Tabela configurada não é um identificador SQL simples.")
                        if not isinstance(data_value, dict):
                            raise ValueError("database_save em tabela customizada exige dataPath apontando para objeto JSON.")
                        columns = sorted(data_value)
                        for column in columns:
                            if not is_sql_identifier(column):
                                raise ValueError(f"Coluna inválida para insert: {column}")
                        column_sql = ", ".join(columns)
                        values_sql = ", ".join(f":{column}" for column in columns)
                        db.execute(text(f"INSERT INTO {table} ({column_sql}) VALUES ({values_sql})"), data_value)
                        result_payload = {
                            "ok": True,
                            "mode": "insert",
                            "table": table,
                            "row_count": 1,
                        }
            except Exception as exc:
                result_payload = {
                    "ok": False,
                    "table": table,
                    "error": str(exc),
                }
            return remember_database_result(state, node_id, result_path, result_payload)

        return run

    def make_file_extract_node(config: dict[str, Any]):
        node_id = config["id"]
        source_path = str(config.get("sourcePath") or "")
        content_path = str(config.get("contentPath") or f"files.{node_id}")
        max_chars = int(config.get("maxChars") or 20000)

        def run(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "file", result_path=content_path)
            if pinned is not None:
                return pinned
            try:
                result_payload = read_asset_text(source_path, max_chars)
            except Exception as exc:
                result_payload = {
                    "ok": False,
                    "source_path": source_path,
                    "error": str(exc),
                }
            return remember_file_result(state, node_id, content_path, result_payload)

        return run

    def make_rag_retrieval_node(config: dict[str, Any]):
        node_id = config["id"]
        collection_path = str(config.get("collectionPath") or ".")
        query_path = str(config.get("queryPath") or "user_message")
        context_path = str(config.get("contextPath") or f"rag.{node_id}")
        top_k = int(config.get("topK") or 3)
        chunk_size = int(config.get("chunkSize") or 900)
        max_chars = int(config.get("maxChars") or 200000)

        def run(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "rag", result_path=context_path)
            if pinned is not None:
                return pinned
            query = str(state_path_value(state, query_path) or "")
            try:
                root = safe_asset_path(collection_path)
                if not root.exists():
                    result_payload = {
                        "ok": False,
                        "query": query,
                        "collection_path": collection_path,
                        "error": "collection_not_found",
                    }
                    return remember_rag_result(state, node_id, context_path, result_payload)
                files = [root] if root.is_file() else sorted(
                    path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in {".txt", ".md", ".markdown", ".pdf"}
                )
                candidates: list[dict[str, Any]] = []
                for file_path in files:
                    relative = file_path.relative_to(FILES_ROOT.resolve()).as_posix()
                    read_result = read_asset_text(relative, max_chars)
                    if not read_result.get("ok"):
                        continue
                    for index, chunk in enumerate(chunk_text(str(read_result.get("content") or ""), chunk_size)):
                        candidates.append({
                            "source_path": relative,
                            "chunk_index": index,
                            "score": lexical_score(query, chunk),
                            "text": chunk,
                        })
                candidates.sort(key=lambda item: (-int(item["score"]), item["source_path"], int(item["chunk_index"])))
                chunks = candidates[:top_k]
                result_payload = {
                    "ok": True,
                    "query": query,
                    "collection_path": collection_path,
                    "chunks": chunks,
                    "chunk_count": len(chunks),
                }
            except Exception as exc:
                result_payload = {
                    "ok": False,
                    "query": query,
                    "collection_path": collection_path,
                    "error": str(exc),
                }
            return remember_rag_result(state, node_id, context_path, result_payload)

        return run

    def make_approval_gate_node(config: dict[str, Any]):
        node_id = config["id"]
        decision_path = str(config.get("decisionPath") or "approval.decision")
        approval_value = str(config.get("approvalValue") or "approved").lower()
        rejection_value = str(config.get("rejectionValue") or "rejected").lower()
        result_path = str(config.get("resultPath") or f"approvals.{node_id}")

        def normalize_decision(value: Any) -> str:
            if value is True:
                return "approved"
            if value is False:
                return "rejected"
            text_value = str(value or "").strip().lower()
            approved_values = {approval_value, "approved", "approve", "aprovado", "aprovar", "sim", "yes", "ok", "true"}
            rejected_values = {rejection_value, "rejected", "reject", "reprovado", "rejeitar", "não", "nao", "no", "false"}
            if text_value in approved_values or any(token in text_value for token in approved_values if len(token) >= 3):
                return "approved"
            if text_value in rejected_values or any(token in text_value for token in rejected_values if len(token) >= 3):
                return "rejected"
            return "pending"

        def run(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "approval", result_path=result_path)
            if pinned is not None:
                return pinned
            raw_value = state_path_value(state, decision_path)
            decision = normalize_decision(raw_value)
            result_payload = {
                "decision": decision,
                "approved": decision == "approved",
                "rejected": decision == "rejected",
                "pending": decision == "pending",
                "decision_path": decision_path,
                "raw_value": jsonable(raw_value),
            }
            return remember_approval_result(state, node_id, result_path, result_payload)

        return run

    def make_scoring_node(config: dict[str, Any]):
        node_id = config["id"]
        input_path = str(config.get("inputPath") or "assistant_message")
        result_path = str(config.get("resultPath") or f"scores.{node_id}")
        threshold = float(config.get("threshold") if config.get("threshold") is not None else 0.7)

        def score_value(value: Any) -> float:
            if isinstance(value, dict):
                for key in ("score", "confidence", "rating"):
                    candidate = value.get(key)
                    if isinstance(candidate, (int, float)):
                        return max(0.0, min(1.0, float(candidate)))
                text_value = " ".join(str(item) for item in value.values())
            else:
                text_value = str(value or "")
            lowered = text_value.lower()
            positive = {"accepted", "approved", "adequado", "correto", "bom", "ok", "sim"}
            negative = {"rejected", "bloqueado", "ruim", "incorreto", "não", "nao"}
            if any(term in lowered for term in positive):
                return 1.0
            if any(term in lowered for term in negative):
                return 0.0
            words = [word for word in lowered.replace("\\n", " ").split(" ") if len(word) >= 3]
            return max(0.1, min(1.0, len(words) / 30))

        def run(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "score", result_path=result_path)
            if pinned is not None:
                return pinned
            value = state_path_value(state, input_path)
            score = score_value(value)
            result_payload = {
                "score": score,
                "threshold": threshold,
                "passed": score >= threshold,
                "input_path": input_path,
                "value": jsonable(value),
            }
            return remember_score_result(state, node_id, result_path, result_payload)

        return run

    def make_analytics_node(config: dict[str, Any]):
        node_id = config["id"]
        metric_name = str(config.get("metricName") or node_id)
        payload_path = str(config.get("payloadPath") or "")
        result_path = str(config.get("resultPath") or f"analytics.{node_id}")

        def run(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "analytics", result_path=result_path)
            if pinned is not None:
                return pinned
            payload = jsonable(state_path_value(state, payload_path)) if payload_path else {
                "session_id": state.get("session_id"),
                "turn": state.get("turn"),
                "status": state.get("status"),
                "phase": state.get("phase"),
            }
            try:
                with graph_session_scope() as db:
                    record_id = str(uuid4())
                    db.add(
                        AgentNodeRecord(
                            record_id=record_id,
                            session_id=str(state.get("session_id") or ""),
                            node_id=node_id,
                            payload_json={
                                "kind": "analytics",
                                "metric_name": metric_name,
                                "payload": payload,
                            },
                        )
                    )
                    db.flush()
                result_payload = {
                    "ok": True,
                    "metric_name": metric_name,
                    "payload_path": payload_path,
                    "payload": payload,
                    "record_id": record_id,
                }
            except Exception as exc:
                result_payload = {
                    "ok": False,
                    "metric_name": metric_name,
                    "payload_path": payload_path,
                    "error": str(exc),
                }
            return remember_analytics_result(state, node_id, result_path, result_payload)

        return run

    def make_finish_node(config: dict[str, Any]):
        node_id = config["id"]

        def run(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "finish")
            if pinned is not None:
                return pinned
            return mark_node(state, node_id, {
                "status": "completed",
                "phase": "closing",
                "is_complete": True,
                "assistant_message": {"code": "ENC", "text": "Sessão finalizada manualmente."},
            })

        return run

    def make_noop_node(config: dict[str, Any]):
        node_id = config["id"]

        def run(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "state")
            if pinned is not None:
                return pinned
            return mark_node(state, node_id, {})

        return run

    def handler_for_node(config: dict[str, Any]):
        node_type = config["type"]
        if node_type == "start":
            return make_start_node(config)
        if node_type == "safety_gate":
            return make_safety_node(config)
        if node_type in {"llm_prompt", "llm_structured"}:
            return make_llm_node(config)
        if node_type == "code":
            return make_code_node(config)
        if node_type == "switch":
            return make_switch_node(config)
        if node_type == "human_input":
            return make_human_input_node(config)
        if node_type == "http_request":
            return make_http_request_node(config)
        if node_type == "transform_json":
            return make_transform_json_node(config)
        if node_type == "database_query":
            return make_database_query_node(config)
        if node_type == "database_save":
            return make_database_save_node(config)
        if node_type == "file_extract":
            return make_file_extract_node(config)
        if node_type == "rag_retrieval":
            return make_rag_retrieval_node(config)
        if node_type == "approval_gate":
            return make_approval_gate_node(config)
        if node_type == "scoring":
            return make_scoring_node(config)
        if node_type == "analytics":
            return make_analytics_node(config)
        if node_type == "end":
            return make_finish_node(config)
        return make_noop_node(config)

    def compare_values(left: Any, operator: str, right: Any) -> bool:
        if operator == "==":
            return left == right
        if operator == "!=":
            return left != right
        try:
            left_number = float(left)
            right_number = float(right)
        except (TypeError, ValueError):
            return False
        if operator == ">=":
            return left_number >= right_number
        if operator == "<=":
            return left_number <= right_number
        if operator == ">":
            return left_number > right_number
        if operator == "<":
            return left_number < right_number
        return False

    def condition_matches(state: ReferenceState, condition: dict[str, Any]) -> bool:
        kind = condition.get("kind")
        if kind == "always":
            return True
        if kind == "all":
            return all(condition_matches(state, item) for item in condition.get("conditions", []))
        if kind == "safety_blocked":
            return bool((state.get("safety") or {}).get("blocked")) is bool(condition.get("value"))
        if kind == "safety_decision":
            return (state.get("safety") or {}).get("decision") == condition.get("value")
        if kind == "status_equals":
            return state.get("status") == condition.get("value")
        if kind == "phase_equals":
            return state.get("phase") == condition.get("value")
        if kind == "state_compare":
            left = state_path_value(state, condition.get("path", ""))
            right = state_path_value(state, condition["rightPath"]) if "rightPath" in condition else condition.get("value")
            return compare_values(left, condition.get("operator", "=="), right)
        return False

    def make_route_after_node(node_id: str):
        conditions = NODE_ROUTE_CONDITIONS.get(node_id, [])
        fallback = conditions[0]["key"] if conditions else "__end__"

        def route(state: ReferenceState) -> str:
            for condition in conditions:
                if condition_matches(state, condition):
                    return condition["key"]
            return fallback

        return route

    builder = StateGraph(ReferenceState)
    for config in NODE_CONFIGS:
        builder.add_node(config["id"], trace_node(config, handler_for_node(config)))

    builder.add_conditional_edges(START, route_action, action_route_map)
    for node_id, target in direct_node_edges.items():
        builder.add_edge(node_id, target)
    for node_id, route_map in node_route_map.items():
        builder.add_conditional_edges(node_id, make_route_after_node(node_id), route_map)

    return builder.compile(checkpointer=checkpointer)
`;
}

function renderSchemas(): string {
  return `from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class IdempotentBody(BaseModel):
    idempotency_key: str | None = Field(default=None, min_length=1)


class CreateSessionRequest(IdempotentBody):
    metadata: dict[str, Any] = Field(default_factory=dict)
    max_turns: int = Field(default=3, ge=1, le=50)
    auto_start: bool = False


class EmptyIdempotentRequest(IdempotentBody):
    pass


class TurnRequest(IdempotentBody):
    user_message: str = Field(..., min_length=1)


class SessionView(BaseModel):
    session_id: str
    agent_id: str
    status: str
    phase: str
    turn: int
    max_turns: int
    metadata: dict[str, Any] = Field(default_factory=dict)
    is_complete: bool


class MessageView(BaseModel):
    seq: int
    role: str
    code: str | None = None
    content: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class EventView(BaseModel):
    seq: int
    agent_id: str
    event_type: str
    node: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class JobView(BaseModel):
    job_id: str
    agent_id: str
    session_id: str
    kind: str
    status: str
    attempts: int
    max_attempts: int
    payload: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any] = Field(default_factory=dict)
    last_error: dict[str, Any] = Field(default_factory=dict)
    next_run_at: str | None = None
    locked_by: str | None = None
    locked_until: str | None = None
    lock_acquired_at: str | None = None


class JobScheduleRequest(BaseModel):
    delay_seconds: float | None = Field(default=None, ge=0, le=31536000)
    run_at: datetime | None = None


class RecurringJobScheduleRequest(BaseModel):
    trigger_type: str = Field(default="interval", pattern="^(interval|cron|event)$")
    interval_seconds: int | None = Field(default=None, ge=60, le=31536000)
    cron_expression: str | None = Field(default=None, max_length=120)
    event_type: str | None = Field(default=None, min_length=1, max_length=120)
    delay_seconds: float | None = Field(default=None, ge=0, le=31536000)
    run_at: datetime | None = None


class EventJobScheduleTriggerRequest(BaseModel):
    event_type: str = Field(..., min_length=1, max_length=120)
    session_id: str | None = Field(default=None, min_length=1)
    payload: dict[str, Any] = Field(default_factory=dict)
    limit: int = Field(default=20, ge=1, le=200)


class JobScheduleView(BaseModel):
    schedule_id: str
    agent_id: str
    session_id: str
    kind: str
    status: str
    trigger_type: str
    interval_seconds: int
    cron_expression: str | None = None
    event_type: str | None = None
    max_attempts: int
    payload: dict[str, Any] = Field(default_factory=dict)
    last_job_id: str | None = None
    last_run_at: str | None = None
    next_run_at: str | None = None


class JobScheduleResponse(BaseModel):
    schedule: JobScheduleView


class JobScheduleBatchResponse(BaseModel):
    schedules: list[JobScheduleView] = Field(default_factory=list)
    jobs: list[JobView] = Field(default_factory=list)
    total: int
    enqueued: int


class JobCleanupRequest(BaseModel):
    statuses: list[str] = Field(default_factory=lambda: ["succeeded", "failed"])
    older_than_hours: float = Field(default=168.0, ge=0.0, le=87600.0)
    session_id: str | None = Field(default=None, min_length=1)
    limit: int = Field(default=100, ge=1, le=1000)
    dry_run: bool = True


class JobCleanupResponse(BaseModel):
    dry_run: bool
    matched: int
    deleted: int
    statuses: list[str]
    older_than_hours: float
    cutoff: str
    job_ids: list[str] = Field(default_factory=list)
    by_status: dict[str, int] = Field(default_factory=dict)


class JobMetricsResponse(BaseModel):
    total: int
    by_status: dict[str, int] = Field(default_factory=dict)
    by_kind: dict[str, int] = Field(default_factory=dict)
    attempts_total: int
    pending_due: int
    failed: int
    exhausted: int
    succeeded: int
    terminal: int
    success_rate: float | None = None
    duration_ms_avg: float | None = None
    duration_ms_min: float | None = None
    duration_ms_max: float | None = None
    duration_ms_p95: float | None = None
    window_hours: float
    finished_in_window: int
    succeeded_in_window: int
    failed_in_window: int
    success_rate_in_window: float | None = None
    window_duration_ms_avg: float | None = None
    window_duration_ms_p95: float | None = None
    throughput_per_hour: float | None = None
    oldest_pending_at: str | None = None
    next_due_at: str | None = None
    leased_running: int
    expired_leases: int
    finished_last_hour: int
    last_finished_at: str | None = None


class AssistantMessageView(BaseModel):
    code: str
    text: str


class SafetyView(BaseModel):
    blocked: bool = False
    decision: str = "allow"
    category: str | None = None
    reason: str | None = None
    severity: str | None = None
    action: str | None = None
    rule_id: str | None = None
    rule_label: str | None = None
    match_type: str | None = None
    matched_text: str | None = None
    node_id: str | None = None
    stage: str | None = None
    source: str | None = None
    provider_score: float | None = None
    provider_error: str | None = None


class CreateSessionResponse(BaseModel):
    session: SessionView
    messages: list[MessageView] = Field(default_factory=list)


class StartResponse(BaseModel):
    session: SessionView
    messages: list[MessageView]


class TurnResponse(BaseModel):
    session: SessionView
    assistant_message: AssistantMessageView
    safety: SafetyView
    can_finish: bool


class FinishResponse(BaseModel):
    session: SessionView
    message: MessageView | None = None


class JobRunResponse(BaseModel):
    job: JobView


class JobBatchResponse(BaseModel):
    jobs: list[JobView] = Field(default_factory=list)
    total: int
    succeeded: int
    failed: int
    errors: list[dict[str, Any]] = Field(default_factory=list)


class MetadataResponse(BaseModel):
    service: str
    runtime: str
    contract: str
    flow_id: str
    agent_id: str
    flow_version: str
    llm_adapter: str
    supports_multi_agent_bundle: bool
    operations: dict[str, Any] = Field(default_factory=dict)
`;
}

function renderService(): string {
  return `from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import repo
from app.cache import recent_key
from app.graph import (
    ANALYTICS_NODE_IDS,
    APPROVAL_GATE_NODE_IDS,
    CODE_NODE_IDS,
    CURRENT_DB_SESSION,
    CURRENT_EVENT_SINK,
    CURRENT_TOKEN_STREAM,
    DATABASE_QUERY_NODE_IDS,
    DATABASE_SAVE_NODE_IDS,
    FILE_EXTRACT_NODE_IDS,
    FINISH_NODE_IDS,
    HUMAN_INPUT_NODE_IDS,
    HTTP_REQUEST_NODE_IDS,
    INPUT_SAFETY_NODE_IDS,
    LLM_NODE_IDS,
    OUTPUT_SAFETY_NODE_IDS,
    RAG_RETRIEVAL_NODE_IDS,
    SCORING_NODE_IDS,
    START_NODE_IDS,
    SWITCH_NODE_IDS,
    TRANSFORM_JSON_NODE_IDS,
)
from app.generated_flow import AGENT_ID
from app.models import AgentJob, AgentJobSchedule, AgentMessage, AgentSession
from app.settings import Settings


RECENT_LIMIT = 20


def session_view(row: AgentSession) -> dict[str, Any]:
    return {
        "session_id": row.session_id,
        "agent_id": row.agent_id,
        "status": row.status,
        "phase": row.phase,
        "turn": row.turn,
        "max_turns": row.max_turns,
        "metadata": row.metadata_json or {},
        "is_complete": row.status == "completed",
    }


def message_view(row: AgentMessage) -> dict[str, Any]:
    return {
        "seq": row.seq,
        "role": row.role,
        "code": row.code,
        "content": row.content,
        "metadata": row.metadata_json or {},
    }


def event_view(row) -> dict[str, Any]:
    return {
        "seq": row.seq,
        "agent_id": row.agent_id,
        "event_type": row.event_type,
        "node": row.node,
        "payload": row.payload or {},
    }


def job_view(row: AgentJob) -> dict[str, Any]:
    return {
        "job_id": row.job_id,
        "agent_id": row.agent_id,
        "session_id": row.session_id,
        "kind": row.kind,
        "status": row.status,
        "attempts": int(row.attempts or 0),
        "max_attempts": int(row.max_attempts or 1),
        "payload": row.payload_json or {},
        "result": row.result_json or {},
        "last_error": row.last_error_json or {},
        "next_run_at": row.next_run_at.isoformat() if row.next_run_at else None,
        "locked_by": row.locked_by,
        "locked_until": row.locked_until.isoformat() if row.locked_until else None,
        "lock_acquired_at": row.lock_acquired_at.isoformat() if row.lock_acquired_at else None,
    }


def job_schedule_view(row: AgentJobSchedule) -> dict[str, Any]:
    return {
        "schedule_id": row.schedule_id,
        "agent_id": row.agent_id,
        "session_id": row.session_id,
        "kind": row.kind,
        "status": row.status,
        "trigger_type": row.trigger_type or "interval",
        "interval_seconds": int(row.interval_seconds or 0),
        "cron_expression": row.cron_expression,
        "event_type": row.cron_expression if (row.trigger_type or "interval") == "event" else None,
        "max_attempts": int(row.max_attempts or 1),
        "payload": row.payload_json or {},
        "last_job_id": row.last_job_id,
        "last_run_at": row.last_run_at.isoformat() if row.last_run_at else None,
        "next_run_at": row.next_run_at.isoformat() if row.next_run_at else None,
    }


def _cron_values(field: str, minimum: int, maximum: int, *, allow_sunday_7: bool = False) -> tuple[set[int], bool]:
    value = field.strip()
    if not value:
        raise ValueError("Campo cron vazio.")
    if value == "*":
        return set(range(minimum, maximum + 1)), True
    allowed: set[int] = set()
    for part in value.split(","):
        part = part.strip()
        if not part:
            raise ValueError("Campo cron inválido.")
        step = 1
        base = part
        if "/" in part:
            base, step_text = part.split("/", 1)
            step = int(step_text)
            if step <= 0:
                raise ValueError("Step cron inválido.")
        if base == "*":
            start, end = minimum, maximum
        elif "-" in base:
            start_text, end_text = base.split("-", 1)
            start, end = int(start_text), int(end_text)
        else:
            start = end = int(base)
        if start < minimum or end > maximum or start > end:
            raise ValueError("Faixa cron fora do permitido.")
        for item in range(start, end + 1, step):
            allowed.add(0 if allow_sunday_7 and item == 7 else item)
    return allowed, False


def _normalize_cron_expression(expression: str | None) -> str:
    parts = (expression or "").strip().split()
    if len(parts) != 5:
        raise ValueError("Use expressão cron com 5 campos: minuto hora dia mês dia-da-semana.")
    _cron_values(parts[0], 0, 59)
    _cron_values(parts[1], 0, 23)
    _cron_values(parts[2], 1, 31)
    _cron_values(parts[3], 1, 12)
    _cron_values(parts[4], 0, 7, allow_sunday_7=True)
    return " ".join(parts)


def _normalize_schedule_event_type(event_type: str | None) -> str:
    value = str(event_type or "").strip()
    if not value:
        raise ValueError("Informe event_type para schedule por evento.")
    if len(value) > 120:
        raise ValueError("event_type deve ter no máximo 120 caracteres.")
    if any(not (char.isalnum() or char in "._:-") for char in value):
        raise ValueError("event_type aceita apenas letras, números, ponto, hífen, sublinhado e dois-pontos.")
    return value


def _next_cron_run(expression: str, after: datetime | None = None) -> datetime:
    parts = _normalize_cron_expression(expression).split()
    minutes, _ = _cron_values(parts[0], 0, 59)
    hours, _ = _cron_values(parts[1], 0, 23)
    days, day_any = _cron_values(parts[2], 1, 31)
    months, _ = _cron_values(parts[3], 1, 12)
    weekdays, weekday_any = _cron_values(parts[4], 0, 7, allow_sunday_7=True)
    current = after or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    current = current.astimezone(timezone.utc).replace(second=0, microsecond=0) + timedelta(minutes=1)
    for _ in range(366 * 24 * 60):
        cron_weekday = (current.weekday() + 1) % 7
        day_match = current.day in days
        weekday_match = cron_weekday in weekdays
        if not day_any and not weekday_any:
            calendar_match = day_match or weekday_match
        else:
            calendar_match = day_match and weekday_match
        if current.minute in minutes and current.hour in hours and current.month in months and calendar_match:
            return current
        current += timedelta(minutes=1)
    raise ValueError("Expressão cron não encontrou próxima execução em até 366 dias.")


def _next_schedule_run(row: AgentJobSchedule, after: datetime | None = None) -> datetime:
    if (row.trigger_type or "interval") == "cron":
        return _next_cron_run(str(row.cron_expression or ""), after)
    if (row.trigger_type or "interval") == "event":
        raise ValueError("Schedule por evento não executa por due time.")
    base = after or datetime.now(timezone.utc)
    if base.tzinfo is None:
        base = base.replace(tzinfo=timezone.utc)
    return base + timedelta(seconds=max(60, int(row.interval_seconds or 60)))


def _redact_external_event_payload(value: Any, depth: int = 0) -> Any:
    if depth >= 5:
        return "[truncated]"
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key)
            marker = key_text.lower().replace("-", "_")
            if any(token in marker for token in ("api_key", "apikey", "authorization", "credential", "password", "secret", "token")):
                redacted[key_text] = "[redacted]"
            else:
                redacted[key_text] = _redact_external_event_payload(item, depth + 1)
        return redacted
    if isinstance(value, list):
        return [_redact_external_event_payload(item, depth + 1) for item in value[:100]]
    return value


class ReferenceAgentService:
    def __init__(self, *, settings: Settings, graph, cache) -> None:
        self.settings = settings
        self.graph = graph
        self.cache = cache

    def _restore_envelope(self, metadata: dict[str, Any]) -> dict[str, Any] | None:
        restore = metadata.get("restore")
        if isinstance(restore, dict):
            return dict(restore)
        checkpoint = metadata.get("checkpoint")
        if isinstance(checkpoint, dict):
            return dict(checkpoint)
        return None

    def _load_checkpoint_values(self, source_session_id: str | None) -> dict[str, Any] | None:
        if not source_session_id:
            return None
        try:
            snapshot = self.graph.get_state({"configurable": {"thread_id": source_session_id}})
            values = getattr(snapshot, "values", None)
            if values is None and isinstance(snapshot, dict):
                values = snapshot.get("values")
            return dict(values) if isinstance(values, dict) else None
        except Exception:
            return None

    def _resolve_restore_state(self, metadata: dict[str, Any]) -> dict[str, Any] | None:
        envelope = self._restore_envelope(metadata)
        if not envelope:
            return None
        source_session_id = str(envelope.get("sourceSessionId") or envelope.get("source_session_id") or "").strip() or None
        checkpoint_values = self._load_checkpoint_values(source_session_id)
        if checkpoint_values:
            return {
                "source": "checkpointer",
                "sourceSessionId": source_session_id,
                "state": checkpoint_values,
            }
        raw_state = envelope.get("state")
        if isinstance(raw_state, dict):
            return {
                "source": "metadata",
                "sourceSessionId": source_session_id,
                "state": dict(raw_state),
            }
        return None

    def _restore_recent_messages(self, restored_state: dict[str, Any]) -> list[dict[str, str]]:
        recent = restored_state.get("recent_messages")
        if isinstance(recent, list):
            normalized = [
                {"role": str(item.get("role")), "content": str(item.get("content"))}
                for item in recent
                if isinstance(item, dict) and item.get("role") and item.get("content")
            ]
            if normalized:
                return normalized[-RECENT_LIMIT:]

        transcript = restored_state.get("transcript")
        if not isinstance(transcript, dict):
            return []
        messages: list[dict[str, str]] = []
        last_user = transcript.get("last_user")
        if isinstance(last_user, dict) and last_user.get("content"):
            messages.append({"role": "user", "content": str(last_user["content"])})
        last_assistant = transcript.get("last_assistant")
        if isinstance(last_assistant, dict) and last_assistant.get("content"):
            messages.append({"role": "assistant", "content": str(last_assistant["content"])})
        return messages[-RECENT_LIMIT:]

    def _normalize_restore_state(
        self,
        raw_state: dict[str, Any],
        row: AgentSession,
        metadata: dict[str, Any],
    ) -> dict[str, Any]:
        restored = dict(raw_state)
        session_state = restored.get("session") if isinstance(restored.get("session"), dict) else {}
        status = str(session_state.get("status") or restored.get("status") or row.status or "active")
        if status == "completed":
            status = "active"
        phase = str(session_state.get("phase") or restored.get("phase") or row.phase or "restored")
        raw_turn = session_state.get("turn", restored.get("turn", row.turn))
        try:
            turn = max(0, int(raw_turn))
        except Exception:
            turn = max(0, int(row.turn or 0))

        restored["session_id"] = row.session_id
        restored["status"] = status
        restored["phase"] = phase
        restored["turn"] = turn
        restored["max_turns"] = row.max_turns
        restored["session_metadata"] = metadata
        restored["is_complete"] = False
        if "recent_messages" not in restored:
            recent = self._restore_recent_messages(restored)
            if recent:
                restored["recent_messages"] = recent
        if "executed_nodes" not in restored:
            nodes = restored.get("nodes")
            restored["executed_nodes"] = list(nodes.keys()) if isinstance(nodes, dict) else []
        return restored

    def _initial_restore(self, row: AgentSession) -> dict[str, Any] | None:
        metadata = row.metadata_json or {}
        resolved = self._resolve_restore_state(metadata)
        if not resolved:
            return None
        state = self._normalize_restore_state(resolved["state"], row, metadata)
        return {
            "source": resolved.get("source"),
            "sourceSessionId": resolved.get("sourceSessionId"),
            "state": state,
        }

    def _restore_event_payload(self, restore: dict[str, Any]) -> dict[str, Any]:
        state = restore.get("state") if isinstance(restore.get("state"), dict) else {}
        return {
            "source": restore.get("source"),
            "sourceSessionId": restore.get("sourceSessionId"),
            "status": state.get("status"),
            "phase": state.get("phase"),
            "turn": state.get("turn"),
            "stateKeys": sorted(str(key) for key in state.keys()),
        }

    def _merge_restore_state(self, base_state: dict[str, Any], restored_state: dict[str, Any]) -> dict[str, Any]:
        merged = dict(restored_state)
        restored_recent = restored_state.get("recent_messages")
        base_recent = base_state.get("recent_messages")
        merged.update(base_state)
        if isinstance(restored_recent, list) and isinstance(base_recent, list):
            merged["recent_messages"] = [*restored_recent, *base_recent][-RECENT_LIMIT:]
        return merged

    def create_session(
        self,
        db: Session,
        *,
        metadata: dict[str, Any],
        max_turns: int,
        auto_start: bool = False,
    ) -> dict[str, Any]:
        row = repo.create_session(db, agent_id=AGENT_ID, max_turns=max_turns, metadata_json=metadata)
        restore = self._initial_restore(row)
        if restore:
            restore_state = restore["state"]
            repo.update_session_state(
                db,
                row,
                status=str(restore_state.get("status") or "active"),
                phase=str(restore_state.get("phase") or "restored"),
                turn=int(restore_state.get("turn") or 0),
            )
        repo.append_event(
            db,
            session_id=row.session_id,
            agent_id=row.agent_id,
            event_type="session_created",
            node=None,
            payload={"auto_start": auto_start, "restored": bool(restore)},
        )
        if restore:
            repo.append_event(
                db,
                session_id=row.session_id,
                agent_id=row.agent_id,
                event_type="checkpoint_restored",
                node=None,
                payload=self._restore_event_payload(restore),
            )
        response = {"session": session_view(row), "messages": []}
        if auto_start:
            started = self.start_session(db, row.session_id)
            response["session"] = started["session"]
            response["messages"] = started["messages"]
        return response

    def get_session(self, db: Session, session_id: str) -> dict[str, Any]:
        row = repo.get_session_by_id(db, session_id)
        if not row:
            raise HTTPException(status_code=404, detail="Sessão não encontrada.")
        return session_view(row)

    def start_session(self, db: Session, session_id: str) -> dict[str, Any]:
        row = repo.get_session_for_update(db, session_id)
        if not row:
            raise HTTPException(status_code=404, detail="Sessão não encontrada.")
        if row.status == "completed":
            return {"session": session_view(row), "messages": []}

        existing_messages = repo.get_transcript(db, session_id)
        if existing_messages:
            repo.update_session_state(db, row, status="active")
            return {"session": session_view(row), "messages": [message_view(item) for item in existing_messages]}
        restore = self._initial_restore(row)
        if restore:
            restore_state = restore["state"]
            repo.update_session_state(
                db,
                row,
                status=str(restore_state.get("status") or "active"),
                phase=str(restore_state.get("phase") or "restored"),
                turn=int(restore_state.get("turn") or row.turn or 0),
            )
            recent = self._restore_recent_messages(restore_state)
            if recent:
                self.cache.set_json(recent_key(row.session_id), recent, ttl_seconds=self.settings.redis_ttl_seconds)
            return {"session": session_view(row), "messages": []}

        result = self._invoke_graph(
            db,
            {
                "action": "start",
                "session_id": row.session_id,
                "agent_id": row.agent_id,
                "status": row.status,
                "phase": row.phase,
                "turn": row.turn,
                "max_turns": row.max_turns,
                "session_metadata": row.metadata_json or {},
                "executed_nodes": [],
            },
            row.session_id,
        )
        repo.update_session_state(db, row, status=result["status"], phase=result["phase"], turn=row.turn)
        assistant = result["assistant_message"]
        message = repo.append_message(
            db,
            session_id=row.session_id,
            role="assistant",
            code=assistant["code"],
            content=assistant["text"],
        )
        self._persist_graph_events(db, row.session_id, result)
        self._cache_recent(row.session_id, [message_view(message)])
        return {"session": session_view(row), "messages": [message_view(message)]}

    def process_turn(
        self,
        db: Session,
        session_id: str,
        user_message: str,
        token_callback: Callable[[str], None] | None = None,
    ) -> dict[str, Any]:
        row = repo.get_session_for_update(db, session_id)
        if not row:
            raise HTTPException(status_code=404, detail="Sessão não encontrada.")
        if row.status == "created":
            raise HTTPException(status_code=409, detail="Sessão precisa ser iniciada antes do primeiro turno.")
        if row.status == "completed":
            last_message = repo.get_last_assistant_message(db, session_id)
            if not last_message:
                raise HTTPException(status_code=409, detail="Sessão finalizada sem mensagem final.")
            return {
                "session": session_view(row),
                "assistant_message": {"code": last_message.code or "ENC", "text": last_message.content},
                "safety": {"blocked": False, "decision": "allow"},
                "can_finish": True,
            }

        user_row = repo.append_message(
            db,
            session_id=row.session_id,
            role="user",
            content=user_message,
        )
        recent_messages = self._recent_messages(db, row.session_id)
        recent_messages.append({"role": "user", "content": user_message})
        graph_state = {
            "action": "turn",
            "session_id": row.session_id,
            "agent_id": row.agent_id,
            "status": row.status,
            "phase": row.phase,
            "turn": row.turn,
            "max_turns": row.max_turns,
            "user_message": user_message,
            "recent_messages": recent_messages[-RECENT_LIMIT:],
            "session_metadata": row.metadata_json or {},
            "executed_nodes": [],
        }
        restore = self._initial_restore(row)
        if restore and row.turn <= int(restore["state"].get("turn") or 0):
            graph_state = self._merge_restore_state(graph_state, restore["state"])
        result = self._invoke_graph(db, graph_state, row.session_id, token_callback=token_callback, source_message_id=user_row.message_id)
        result = self._normalize_turn_result(result, row)
        completed = bool(result.get("is_complete"))
        repo.update_session_state(
            db,
            row,
            status=result.get("status", row.status),
            phase=result.get("phase", row.phase),
            turn=int(result.get("turn", row.turn)),
            completed=completed,
        )
        assistant = result["assistant_message"]
        assistant_row = repo.append_message(
            db,
            session_id=row.session_id,
            role="assistant",
            code=assistant["code"],
            content=assistant["text"],
            metadata_json={"llm": result.get("llm"), "safety": result.get("safety")},
        )
        self._persist_graph_events(db, row.session_id, result, source_message_id=user_row.message_id)
        recent_payload = [*recent_messages[-RECENT_LIMIT:], {"role": "assistant", "content": assistant["text"]}]
        self.cache.set_json(recent_key(row.session_id), recent_payload[-RECENT_LIMIT:], ttl_seconds=self.settings.redis_ttl_seconds)
        return {
            "session": session_view(row),
            "assistant_message": {"code": assistant["code"], "text": assistant["text"]},
            "safety": result.get("safety") or {"blocked": False, "decision": "allow"},
            "can_finish": row.status == "completed" or row.turn >= row.max_turns,
        }

    def finish_session(self, db: Session, session_id: str) -> dict[str, Any]:
        row = repo.get_session_for_update(db, session_id)
        if not row:
            raise HTTPException(status_code=404, detail="Sessão não encontrada.")
        if row.status == "completed":
            return {"session": session_view(row), "message": None}

        result = self._invoke_graph(
            db,
            {
                "action": "finish",
                "session_id": row.session_id,
                "agent_id": row.agent_id,
                "status": row.status,
                "phase": row.phase,
                "turn": row.turn,
                "max_turns": row.max_turns,
                "session_metadata": row.metadata_json or {},
                "executed_nodes": [],
            },
            row.session_id,
        )
        repo.update_session_state(db, row, status="completed", phase="closing", completed=True)
        assistant = result["assistant_message"]
        message = repo.append_message(
            db,
            session_id=row.session_id,
            role="assistant",
            code=assistant["code"],
            content=assistant["text"],
        )
        self._persist_graph_events(db, row.session_id, result)
        job = repo.create_job(
            db,
            agent_id=row.agent_id,
            session_id=row.session_id,
            kind="post_finish_summary",
            max_attempts=3,
            payload_json={
                "source": "finish_session",
                "message_seq": message.seq,
                "flow": AGENT_ID,
            },
        )
        repo.append_event(
            db,
            session_id=row.session_id,
            agent_id=row.agent_id,
            event_type="post_finish_pending",
            node=None,
            payload={"kind": job.kind, "job_id": job.job_id},
        )
        self.cache.delete(recent_key(row.session_id))
        return {"session": session_view(row), "message": message_view(message)}

    def transcript(self, db: Session, session_id: str, from_seq: int | None = None) -> list[dict[str, Any]]:
        self.get_session(db, session_id)
        return [message_view(row) for row in repo.get_transcript(db, session_id, from_seq=from_seq)]

    def events(self, db: Session, session_id: str, from_seq: int | None = None) -> list[dict[str, Any]]:
        self.get_session(db, session_id)
        return [event_view(row) for row in repo.get_events(db, session_id, from_seq=from_seq)]

    def jobs(self, db: Session, session_id: str | None = None, status: str | None = None) -> list[dict[str, Any]]:
        if session_id:
            self.get_session(db, session_id)
        return [job_view(row) for row in repo.list_jobs(db, session_id=session_id, status=status)]

    def job_metrics(self, db: Session, window_hours: float = 1.0) -> dict[str, Any]:
        return repo.get_job_metrics(db, window_hours=window_hours)

    def cleanup_jobs(
        self,
        db: Session,
        *,
        statuses: list[str] | None = None,
        older_than_hours: float = 168.0,
        session_id: str | None = None,
        limit: int = 100,
        dry_run: bool = True,
    ) -> dict[str, Any]:
        if session_id:
            self.get_session(db, session_id)
        allowed_statuses = {"succeeded", "failed"}
        normalized_statuses = sorted(
            {
                str(status).strip().lower()
                for status in (statuses or ["succeeded", "failed"])
                if str(status).strip()
            }
        )
        invalid_statuses = [status for status in normalized_statuses if status not in allowed_statuses]
        if invalid_statuses:
            raise HTTPException(
                status_code=400,
                detail=f"Limpeza aceita apenas jobs terminais: {', '.join(sorted(allowed_statuses))}.",
            )
        if not normalized_statuses:
            raise HTTPException(status_code=400, detail="Informe ao menos um status terminal para limpeza.")
        normalized_older_than_hours = max(0.0, float(older_than_hours or 0.0))
        normalized_limit = max(1, min(1000, int(limit or 100)))
        cutoff = datetime.now(timezone.utc) - timedelta(hours=normalized_older_than_hours)
        rows = repo.list_job_cleanup_candidates(
            db,
            statuses=normalized_statuses,
            cutoff=cutoff,
            session_id=session_id,
            limit=normalized_limit,
        )
        by_status: dict[str, int] = {}
        for row in rows:
            by_status[row.status] = by_status.get(row.status, 0) + 1
        job_ids = [row.job_id for row in rows]
        if not dry_run and rows:
            by_session: dict[str, dict[str, Any]] = {}
            for row in rows:
                summary = by_session.setdefault(
                    row.session_id,
                    {"agent_id": row.agent_id, "job_ids": [], "by_status": {}},
                )
                summary["job_ids"].append(row.job_id)
                summary["by_status"][row.status] = summary["by_status"].get(row.status, 0) + 1
            for cleaned_session_id, summary in by_session.items():
                repo.append_event(
                    db,
                    session_id=cleaned_session_id,
                    agent_id=str(summary["agent_id"]),
                    event_type="jobs_cleanup_completed",
                    node=None,
                    payload={
                        "deleted": len(summary["job_ids"]),
                        "job_ids": summary["job_ids"],
                        "by_status": summary["by_status"],
                        "statuses": normalized_statuses,
                        "older_than_hours": normalized_older_than_hours,
                        "cutoff": cutoff.isoformat(),
                    },
                )
            repo.delete_jobs(db, rows)
        return {
            "dry_run": bool(dry_run),
            "matched": len(rows),
            "deleted": 0 if dry_run else len(rows),
            "statuses": normalized_statuses,
            "older_than_hours": normalized_older_than_hours,
            "cutoff": cutoff.isoformat(),
            "job_ids": job_ids,
            "by_status": by_status,
        }

    def get_job(self, db: Session, job_id: str) -> dict[str, Any]:
        row = repo.get_job_by_id(db, job_id)
        if not row:
            raise HTTPException(status_code=404, detail="Job não encontrado.")
        return job_view(row)

    def run_job(
        self,
        db: Session,
        job_id: str,
        *,
        worker_id: str | None = None,
        lease_seconds: float = 60.0,
    ) -> dict[str, Any]:
        job = repo.get_job_for_update(db, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job não encontrado.")
        if job.status == "succeeded":
            return {"job": job_view(job)}
        if job.status == "running":
            lock_owner = str(job.locked_by or "")
            if worker_id and lock_owner == worker_id:
                locked_until = repo._as_utc(job.locked_until)
                if locked_until and locked_until <= datetime.now(timezone.utc):
                    raise HTTPException(status_code=409, detail="Lease do job expirou antes da execução.")
            else:
                raise HTTPException(status_code=409, detail="Job já está em execução por outro worker.")
        else:
            repo.mark_job_running(db, job)
        transcript = self.transcript(db, job.session_id)
        events = self.events(db, job.session_id)
        assistant_messages = [message for message in transcript if message.get("role") == "assistant"]
        result = {
            "summary": assistant_messages[-1]["content"] if assistant_messages else "Sem mensagem final.",
            "message_count": len(transcript),
            "event_count": len(events),
            "kind": job.kind,
        }
        repo.mark_job_finished(db, job, status="succeeded", result_json=result)
        repo.append_event(
            db,
            session_id=job.session_id,
            agent_id=job.agent_id,
            event_type="post_finish_completed",
            node=None,
            payload={"kind": job.kind, "job_id": job.job_id, "result": result},
        )
        return {"job": job_view(job)}

    def retry_job(self, db: Session, job_id: str) -> dict[str, Any]:
        job = repo.get_job_for_update(db, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job não encontrado.")
        if job.status == "succeeded":
            return {"job": job_view(job)}
        repo.reset_job_for_retry(db, job, reset_attempts=True)
        repo.append_event(
            db,
            session_id=job.session_id,
            agent_id=job.agent_id,
            event_type="post_finish_retry_requested",
            node=None,
            payload={"kind": job.kind, "job_id": job.job_id},
        )
        return {"job": job_view(job)}

    def schedule_job(self, db: Session, job_id: str, run_at: datetime) -> dict[str, Any]:
        job = repo.get_job_for_update(db, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job não encontrado.")
        if job.status == "running":
            raise HTTPException(status_code=409, detail="Job em execução não pode ser reagendado.")
        if job.status == "succeeded":
            raise HTTPException(status_code=409, detail="Job já concluído não pode ser reagendado.")
        repo.schedule_job(db, job, run_at=run_at)
        repo.append_event(
            db,
            session_id=job.session_id,
            agent_id=job.agent_id,
            event_type="post_finish_scheduled",
            node=None,
            payload={"kind": job.kind, "job_id": job.job_id, "next_run_at": job.next_run_at.isoformat() if job.next_run_at else None},
        )
        return {"job": job_view(job)}

    def job_schedules(
        self,
        db: Session,
        session_id: str | None = None,
        status: str | None = None,
    ) -> list[dict[str, Any]]:
        if session_id:
            self.get_session(db, session_id)
        return [job_schedule_view(row) for row in repo.list_job_schedules(db, session_id=session_id, status=status)]

    def create_job_recurrence(
        self,
        db: Session,
        job_id: str,
        *,
        interval_seconds: int | None = None,
        trigger_type: str = "interval",
        cron_expression: str | None = None,
        event_type: str | None = None,
        run_at: datetime | None = None,
        delay_seconds: float | None = None,
    ) -> dict[str, Any]:
        job = repo.get_job_by_id(db, job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job não encontrado.")
        if run_at and run_at.tzinfo is None:
            run_at = run_at.replace(tzinfo=timezone.utc)
        if run_at is None and delay_seconds is not None:
            run_at = datetime.now(timezone.utc) + timedelta(seconds=max(0.0, float(delay_seconds or 0.0)))
        if trigger_type == "event" or event_type:
            normalized_trigger = "event"
        else:
            normalized_trigger = "cron" if trigger_type == "cron" or cron_expression else "interval"
        normalized_interval = max(60, int(interval_seconds or 3600))
        normalized_cron: str | None = None
        normalized_event: str | None = None
        if normalized_trigger == "cron":
            try:
                normalized_cron = _normalize_cron_expression(cron_expression)
            except (TypeError, ValueError) as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            if run_at is None:
                run_at = _next_cron_run(normalized_cron)
        elif normalized_trigger == "event":
            try:
                normalized_event = _normalize_schedule_event_type(event_type or cron_expression)
            except (TypeError, ValueError) as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            run_at = None
        payload = dict(job.payload_json or {})
        payload["recurrence"] = {
            "source": "job_recurrence",
            "source_job_id": job.job_id,
            "trigger_type": normalized_trigger,
            "interval_seconds": normalized_interval,
            "cron_expression": normalized_cron,
            "event_type": normalized_event,
        }
        schedule = repo.create_job_schedule(
            db,
            agent_id=job.agent_id,
            session_id=job.session_id,
            kind=job.kind,
            interval_seconds=normalized_interval,
            trigger_type=normalized_trigger,
            cron_expression=normalized_event or normalized_cron,
            payload_json=payload,
            max_attempts=int(job.max_attempts or 3),
            next_run_at=run_at,
        )
        repo.append_event(
            db,
            session_id=schedule.session_id,
            agent_id=schedule.agent_id,
            event_type="job_schedule_created",
            node=None,
            payload={
                "kind": schedule.kind,
                "schedule_id": schedule.schedule_id,
                "source_job_id": job.job_id,
                "trigger_type": schedule.trigger_type,
                "interval_seconds": schedule.interval_seconds,
                "cron_expression": schedule.cron_expression,
                "event_type": normalized_event,
                "next_run_at": schedule.next_run_at.isoformat() if schedule.next_run_at else None,
            },
        )
        return {"schedule": job_schedule_view(schedule)}

    def run_due_job_schedules(self, db: Session, limit: int = 20) -> dict[str, Any]:
        rows = repo.list_due_job_schedules(db, limit=limit)
        jobs: list[dict[str, Any]] = []
        schedules: list[dict[str, Any]] = []
        for schedule in rows:
            payload = dict(schedule.payload_json or {})
            payload["schedule_id"] = schedule.schedule_id
            payload["source"] = "job_schedule"
            payload["schedule_trigger_type"] = schedule.trigger_type or "interval"
            payload["schedule_interval_seconds"] = int(schedule.interval_seconds or 0)
            payload["schedule_cron_expression"] = schedule.cron_expression
            try:
                next_run_at = _next_schedule_run(schedule)
            except ValueError as exc:
                repo.disable_job_schedule(db, schedule)
                repo.append_event(
                    db,
                    session_id=schedule.session_id,
                    agent_id=schedule.agent_id,
                    event_type="job_schedule_disabled",
                    node=None,
                    payload={"kind": schedule.kind, "schedule_id": schedule.schedule_id, "reason": str(exc)},
                )
                continue
            job = repo.create_job(
                db,
                agent_id=schedule.agent_id,
                session_id=schedule.session_id,
                kind=schedule.kind,
                payload_json=payload,
                max_attempts=int(schedule.max_attempts or 3),
            )
            repo.mark_job_schedule_enqueued(db, schedule, job, next_run_at=next_run_at)
            repo.append_event(
                db,
                session_id=schedule.session_id,
                agent_id=schedule.agent_id,
                event_type="job_schedule_enqueued",
                node=None,
                payload={
                    "kind": schedule.kind,
                    "schedule_id": schedule.schedule_id,
                    "job_id": job.job_id,
                    "trigger_type": schedule.trigger_type,
                    "next_run_at": schedule.next_run_at.isoformat() if schedule.next_run_at else None,
                },
            )
            jobs.append(job_view(job))
            schedules.append(job_schedule_view(schedule))
        return {"schedules": schedules, "jobs": jobs, "total": len(rows), "enqueued": len(jobs)}

    def trigger_event_job_schedules(
        self,
        db: Session,
        *,
        event_type: str,
        session_id: str | None = None,
        payload: dict[str, Any] | None = None,
        limit: int = 20,
    ) -> dict[str, Any]:
        try:
            normalized_event = _normalize_schedule_event_type(event_type)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if session_id:
            self.get_session(db, session_id)
        event_payload = _redact_external_event_payload(payload or {})
        rows = repo.list_event_job_schedules(
            db,
            event_type=normalized_event,
            session_id=session_id,
            limit=limit,
        )
        jobs: list[dict[str, Any]] = []
        schedules: list[dict[str, Any]] = []
        for schedule in rows:
            job_payload = dict(schedule.payload_json or {})
            job_payload["schedule_id"] = schedule.schedule_id
            job_payload["source"] = "job_event"
            job_payload["schedule_trigger_type"] = "event"
            job_payload["schedule_event_type"] = normalized_event
            job_payload["event_payload"] = event_payload
            job = repo.create_job(
                db,
                agent_id=schedule.agent_id,
                session_id=schedule.session_id,
                kind=schedule.kind,
                payload_json=job_payload,
                max_attempts=int(schedule.max_attempts or 3),
            )
            repo.mark_job_schedule_enqueued(db, schedule, job, next_run_at=None)
            repo.append_event(
                db,
                session_id=schedule.session_id,
                agent_id=schedule.agent_id,
                event_type="job_schedule_event_triggered",
                node=None,
                payload={
                    "kind": schedule.kind,
                    "schedule_id": schedule.schedule_id,
                    "job_id": job.job_id,
                    "event_type": normalized_event,
                    "payload_keys": sorted(event_payload.keys()) if isinstance(event_payload, dict) else [],
                },
            )
            jobs.append(job_view(job))
            schedules.append(job_schedule_view(schedule))
        return {"schedules": schedules, "jobs": jobs, "total": len(rows), "enqueued": len(jobs)}

    def disable_job_schedule(self, db: Session, schedule_id: str) -> dict[str, Any]:
        schedule = repo.get_job_schedule_for_update(db, schedule_id)
        if not schedule:
            raise HTTPException(status_code=404, detail="Schedule não encontrado.")
        repo.disable_job_schedule(db, schedule)
        repo.append_event(
            db,
            session_id=schedule.session_id,
            agent_id=schedule.agent_id,
            event_type="job_schedule_disabled",
            node=None,
            payload={"kind": schedule.kind, "schedule_id": schedule.schedule_id},
        )
        return {"schedule": job_schedule_view(schedule)}

    def run_pending_jobs(
        self,
        db: Session,
        session_id: str | None = None,
        limit: int = 50,
        worker_id: str | None = None,
        lease_seconds: float = 60.0,
    ) -> dict[str, Any]:
        if session_id:
            self.get_session(db, session_id)
        owner = worker_id or "api-run-pending"
        rows = repo.claim_due_jobs(
            db,
            session_id=session_id,
            limit=limit,
            worker_id=owner,
            lease_seconds=lease_seconds,
        )
        jobs: list[dict[str, Any]] = []
        errors: list[dict[str, Any]] = []
        for row in rows:
            try:
                jobs.append(self.run_job(db, row.job_id, worker_id=owner, lease_seconds=lease_seconds)["job"])
            except Exception as exc:
                errors.append({"job_id": row.job_id, "error": str(exc)})
        return {
            "jobs": jobs,
            "total": len(rows),
            "succeeded": len(jobs),
            "failed": len(errors),
            "errors": errors,
        }

    def retry_failed_jobs(self, db: Session, session_id: str | None = None, limit: int = 50) -> dict[str, Any]:
        if session_id:
            self.get_session(db, session_id)
        rows = repo.list_jobs(db, session_id=session_id, status="failed", limit=limit)
        jobs: list[dict[str, Any]] = []
        errors: list[dict[str, Any]] = []
        for row in rows:
            try:
                jobs.append(self.retry_job(db, row.job_id)["job"])
            except Exception as exc:
                errors.append({"job_id": row.job_id, "error": str(exc)})
        return {
            "jobs": jobs,
            "total": len(rows),
            "succeeded": len(jobs),
            "failed": len(errors),
            "errors": errors,
        }

    def _invoke_graph(
        self,
        db: Session,
        state: dict[str, Any],
        session_id: str,
        token_callback: Callable[[str], None] | None = None,
        source_message_id: str | None = None,
    ) -> dict[str, Any]:
        agent_id = str(state.get("agent_id") or AGENT_ID)

        def event_sink(event_type: str, node_id: str, payload: dict[str, Any]) -> None:
            event_payload = dict(payload or {})
            if source_message_id:
                event_payload["source_message_id"] = source_message_id
            repo.append_event(
                db,
                session_id=session_id,
                agent_id=agent_id,
                event_type=event_type,
                node=node_id,
                payload=event_payload,
            )

        token = CURRENT_DB_SESSION.set(db)
        event_sink_token = CURRENT_EVENT_SINK.set(event_sink)
        token_stream = CURRENT_TOKEN_STREAM.set(token_callback)
        try:
            return dict(
                self.graph.invoke(
                    state,
                    config={"configurable": {"thread_id": session_id}},
                )
            )
        finally:
            CURRENT_TOKEN_STREAM.reset(token_stream)
            CURRENT_EVENT_SINK.reset(event_sink_token)
            CURRENT_DB_SESSION.reset(token)

    def _recent_messages(self, db: Session, session_id: str) -> list[dict[str, str]]:
        cached = self.cache.get_json(recent_key(session_id))
        if isinstance(cached, list):
            return [{"role": item["role"], "content": item["content"]} for item in cached if "role" in item and "content" in item]
        rows = repo.get_recent_messages(db, session_id, RECENT_LIMIT)
        return [{"role": row.role, "content": row.content} for row in rows]

    def _cache_recent(self, session_id: str, messages: list[dict[str, Any]]) -> None:
        payload = [{"role": item["role"], "content": item["content"]} for item in messages]
        self.cache.set_json(recent_key(session_id), payload[-RECENT_LIMIT:], ttl_seconds=self.settings.redis_ttl_seconds)

    def _normalize_turn_result(self, result: dict[str, Any], row: AgentSession) -> dict[str, Any]:
        assistant = result.get("assistant_message")
        if not assistant:
            result["assistant_message"] = {"code": "OK", "text": "Turno processado."}

        next_turn = int(result.get("turn") or row.turn)
        if next_turn <= row.turn:
            next_turn = row.turn + 1
        result["turn"] = next_turn

        if next_turn >= row.max_turns and result.get("status") != "completed":
            text = result["assistant_message"]["text"]
            result["assistant_message"] = {
                "code": "ENC",
                "text": f"{text}\\n\\nEncerramos por aqui porque o limite de turnos foi atingido.",
            }
            result["status"] = "completed"
            result["phase"] = "closing"
            result["is_complete"] = True
        else:
            result.setdefault("status", "active")
            result.setdefault("phase", "awaiting_turn")
            result.setdefault("is_complete", False)
        return result

    def _persist_graph_events(
        self,
        db: Session,
        session_id: str,
        result: dict[str, Any],
        source_message_id: str | None = None,
    ) -> None:
        agent_id = str(result.get("agent_id") or AGENT_ID)
        for node_id in result.get("executed_nodes") or []:
            payload: dict[str, Any] = {
                "status": result.get("status"),
                "phase": result.get("phase"),
                "turn": result.get("turn"),
            }
            if source_message_id:
                payload["source_message_id"] = source_message_id
            event_type = "node_completed"
            if node_id in LLM_NODE_IDS:
                event_type = "llm_called"
                payload.update(result.get("llm") or {})
            elif node_id in INPUT_SAFETY_NODE_IDS or node_id in OUTPUT_SAFETY_NODE_IDS:
                payload["safety"] = result.get("safety") or {"blocked": False, "decision": "allow"}
            elif node_id in CODE_NODE_IDS:
                custom_payload = (result.get("custom") or {}).get(node_id, {})
                if custom_payload:
                    if custom_payload.get("status") == "custom_code_executed":
                        event_type = "custom_code_executed"
                    elif custom_payload.get("status") == "custom_code_failed":
                        event_type = "custom_code_failed"
                    else:
                        event_type = "custom_code_declared"
                    payload["custom"] = custom_payload
                payload["handler"] = "code"
            elif node_id in SWITCH_NODE_IDS:
                event_type = "switch_evaluated"
                payload["handler"] = "switch"
            elif node_id in HUMAN_INPUT_NODE_IDS:
                event_type = "human_input_wait"
                payload["handler"] = "human_input"
            elif node_id in HTTP_REQUEST_NODE_IDS:
                event_type = "http_request_completed"
                payload["handler"] = "http_request"
                payload["http"] = (result.get("http") or {}).get(node_id, {})
            elif node_id in TRANSFORM_JSON_NODE_IDS:
                event_type = "transform_json_completed"
                payload["handler"] = "transform_json"
                payload["transform"] = (result.get("transforms") or {}).get(node_id, {})
            elif node_id in DATABASE_QUERY_NODE_IDS:
                event_type = "database_query_completed"
                payload["handler"] = "database_query"
                payload["database"] = (result.get("database") or {}).get(node_id, {})
            elif node_id in DATABASE_SAVE_NODE_IDS:
                event_type = "database_save_completed"
                payload["handler"] = "database_save"
                payload["database"] = (result.get("database") or {}).get(node_id, {})
            elif node_id in FILE_EXTRACT_NODE_IDS:
                event_type = "file_extract_completed"
                payload["handler"] = "file_extract"
                payload["file"] = (result.get("files") or {}).get(node_id, {})
            elif node_id in RAG_RETRIEVAL_NODE_IDS:
                event_type = "rag_retrieval_completed"
                payload["handler"] = "rag_retrieval"
                payload["rag"] = (result.get("rag") or {}).get(node_id, {})
            elif node_id in APPROVAL_GATE_NODE_IDS:
                event_type = "approval_gate_evaluated"
                payload["handler"] = "approval_gate"
                payload["approval"] = (result.get("approvals") or {}).get(node_id, {})
            elif node_id in SCORING_NODE_IDS:
                event_type = "scoring_completed"
                payload["handler"] = "scoring"
                payload["score"] = (result.get("scores") or {}).get(node_id, {})
            elif node_id in ANALYTICS_NODE_IDS:
                event_type = "analytics_recorded"
                payload["handler"] = "analytics"
                payload["analytics"] = (result.get("analytics") or {}).get(node_id, {})
            elif node_id in START_NODE_IDS:
                payload["handler"] = "start"
            elif node_id in FINISH_NODE_IDS:
                payload["handler"] = "finish"
            repo.append_event(
                db,
                session_id=session_id,
                agent_id=agent_id,
                event_type=event_type,
                node=node_id,
                payload=payload,
            )
`;
}

function renderWorker(): string {
  return `import argparse
import inspect
import logging
import os
import time
import uuid
from typing import Any

from app import repo
from app.cache import build_cache
from app.db import init_db, session_scope
from app.graph import build_checkpointer, build_graph
from app.llm import LLMClient
from app.safety import SafetyGate
from app.service import ReferenceAgentService
from app.settings import get_settings


logger = logging.getLogger(__name__)


def build_worker_service() -> ReferenceAgentService:
    settings = get_settings()
    logging.basicConfig(level=settings.log_level)
    if settings.auto_create_tables:
        init_db()

    cache = build_cache(settings)
    llm_client = LLMClient(settings)
    safety_gate = SafetyGate()
    checkpointer = build_checkpointer(settings)
    graph = build_graph(
        settings=settings,
        llm_client=llm_client,
        safety_gate=safety_gate,
        checkpointer=checkpointer,
    )
    return ReferenceAgentService(settings=settings, graph=graph, cache=cache)


def _run_service_job(
    service: ReferenceAgentService,
    db,
    job_id: str,
    *,
    worker_id: str,
    lease_seconds: float,
):
    try:
        parameters = inspect.signature(service.run_job).parameters
    except (TypeError, ValueError):
        parameters = {}
    if "worker_id" in parameters:
        return service.run_job(db, job_id, worker_id=worker_id, lease_seconds=lease_seconds)
    return service.run_job(db, job_id)


def process_pending_jobs(
    service: ReferenceAgentService,
    *,
    limit: int = 20,
    retry_delay_seconds: float = 5.0,
    worker_id: str = "worker",
    lease_seconds: float = 60.0,
    cleanup_enabled: bool = False,
    cleanup_older_than_hours: float = 168.0,
    cleanup_limit: int = 100,
    cleanup_statuses: list[str] | None = None,
) -> dict[str, Any]:
    cleanup_result: dict[str, Any] | None = None
    agent_id = getattr(getattr(service, "settings", None), "agent_id", None)
    with session_scope() as db:
        if hasattr(service, "run_due_job_schedules"):
            service.run_due_job_schedules(db, limit=limit)
        claimed_jobs = repo.claim_due_jobs(
            db,
            limit=limit,
            worker_id=worker_id,
            agent_id=agent_id,
            lease_seconds=lease_seconds,
        )
        job_ids = [job.job_id for job in claimed_jobs]

    processed = 0
    failed = 0
    retried = 0
    for job_id in job_ids:
        try:
            with session_scope() as db:
                _run_service_job(service, db, job_id, worker_id=worker_id, lease_seconds=lease_seconds)
            processed += 1
        except Exception as exc:
            logger.exception("Falha ao processar job %s", job_id)
            with session_scope() as db:
                job = repo.get_job_for_update(db, job_id)
                if job and job.status != "succeeded":
                    if job.status != "running":
                        repo.mark_job_running(db, job)
                    error = {"error": str(exc), "kind": job.kind, "attempt": int(job.attempts or 0)}
                    if int(job.attempts or 0) >= int(job.max_attempts or 1):
                        repo.mark_job_finished(db, job, status="failed", result_json=error)
                        event_type = "post_finish_failed"
                        failed += 1
                    else:
                        repo.mark_job_retry(db, job, error_json=error, delay_seconds=retry_delay_seconds)
                        event_type = "post_finish_retry_scheduled"
                        retried += 1
                    repo.append_event(
                        db,
                        session_id=job.session_id,
                        agent_id=job.agent_id,
                        event_type=event_type,
                        node=None,
                        payload={"kind": job.kind, "job_id": job.job_id, **error},
                    )

    if cleanup_enabled and hasattr(service, "cleanup_jobs"):
        with session_scope() as db:
            cleanup_result = service.cleanup_jobs(
                db,
                statuses=cleanup_statuses or ["succeeded", "failed"],
                older_than_hours=cleanup_older_than_hours,
                limit=cleanup_limit,
                dry_run=False,
            )

    result: dict[str, Any] = {"processed": processed, "failed": failed, "retried": retried, "pending_seen": len(job_ids)}
    if cleanup_result is not None:
        result["cleanup"] = cleanup_result
    return result


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name, "").strip().lower()
    if not value:
        return default
    return value in {"1", "true", "yes", "on"}


def _env_str(name: str, default: str) -> str:
    value = os.getenv(name, "").strip()
    return value or default


def _split_statuses(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description="Processa jobs pendentes do runtime.")
    parser.add_argument("--once", action="store_true", help="Processa a fila uma vez e encerra.")
    parser.add_argument(
        "--interval",
        type=float,
        default=_env_float("WORKER_INTERVAL_SECONDS", 5.0),
        help="Intervalo em segundos entre ciclos.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=_env_int("WORKER_LIMIT", 20),
        help="Máximo de jobs por ciclo.",
    )
    parser.add_argument(
        "--retry-delay",
        type=float,
        default=_env_float("WORKER_RETRY_DELAY_SECONDS", 5.0),
        help="Atraso em segundos antes de nova tentativa.",
    )
    parser.add_argument(
        "--worker-id",
        default=_env_str("WORKER_ID", f"afw_{uuid.uuid4().hex[:12]}"),
        help="Identidade operacional deste worker para claim de jobs.",
    )
    parser.add_argument(
        "--lease-seconds",
        type=float,
        default=_env_float("WORKER_LEASE_SECONDS", 60.0),
        help="Tempo de lease do job antes de outro worker poder retomá-lo.",
    )
    parser.add_argument(
        "--cleanup-enabled",
        action=argparse.BooleanOptionalAction,
        default=_env_bool("WORKER_CLEANUP_ENABLED", False),
        help="Executa limpeza governada de jobs terminais antigos após cada ciclo.",
    )
    parser.add_argument(
        "--cleanup-older-than-hours",
        type=float,
        default=_env_float("WORKER_CLEANUP_OLDER_THAN_HOURS", 168.0),
        help="Idade mínima, em horas, para cleanup automático de jobs terminais.",
    )
    parser.add_argument(
        "--cleanup-limit",
        type=int,
        default=_env_int("WORKER_CLEANUP_LIMIT", 100),
        help="Máximo de jobs removidos por ciclo de cleanup automático.",
    )
    parser.add_argument(
        "--cleanup-statuses",
        default=_env_str("WORKER_CLEANUP_STATUSES", "succeeded,failed"),
        help="Status terminais separados por vírgula para cleanup automático.",
    )
    args = parser.parse_args()

    service = build_worker_service()
    while True:
        result = process_pending_jobs(
            service,
            limit=max(1, args.limit),
            retry_delay_seconds=max(0.0, args.retry_delay),
            worker_id=str(args.worker_id),
            lease_seconds=max(1.0, args.lease_seconds),
            cleanup_enabled=bool(args.cleanup_enabled),
            cleanup_older_than_hours=max(0.0, args.cleanup_older_than_hours),
            cleanup_limit=max(1, args.cleanup_limit),
            cleanup_statuses=_split_statuses(str(args.cleanup_statuses)),
        )
        logger.info("Jobs processados: %s", result)
        if args.once:
            return 0 if result["failed"] == 0 else 1
        time.sleep(max(0.5, args.interval))


if __name__ == "__main__":
    raise SystemExit(main())
`;
}

function renderAuth(): string {
  return `import json
import secrets
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Header, HTTPException, Query, Request


@dataclass(frozen=True)
class AgentAuthContext:
    key_id: str
    scopes: frozenset[str]
    source: str
    expires_at: str | None = None


class AgentRateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = {}

    def check(self, settings: Any, context: AgentAuthContext, *, scope: str | None = None) -> None:
        if not bool(getattr(settings, "auth_rate_limit_enabled", False)):
            return
        window_seconds = max(1, int(getattr(settings, "auth_rate_limit_window_seconds", 60) or 60))
        limit = max(1, int(getattr(settings, "auth_rate_limit_requests", 60) or 60))
        now = time.monotonic()
        bucket_key = f"{context.source}:{context.key_id}:{scope or '*'}"
        bucket = self._hits.setdefault(bucket_key, deque())
        while bucket and now - bucket[0] >= window_seconds:
            bucket.popleft()
        if len(bucket) >= limit:
            raise HTTPException(status_code=429, detail="Limite de requisições da chave de API excedido.")
        bucket.append(now)


class AgentAuthAuditLog:
    def __init__(self, max_entries: int = 200, path: str = "") -> None:
        self.max_entries = max(1, int(max_entries or 200))
        self._entries: deque[dict[str, Any]] = deque(maxlen=self.max_entries)
        self.total = 0
        self.path = str(path or "").strip()
        self.persistent = bool(self.path)
        if self.persistent:
            self._load_existing_entries()

    def record(
        self,
        *,
        request: Request | None,
        context: AgentAuthContext | None,
        scope: str | None,
        status: str,
        reason: str | None = None,
    ) -> None:
        self.total += 1
        entry = {
            "seq": self.total,
            "timestamp": time.time(),
            "method": request.method if request is not None else "WS",
            "path": request.url.path if request is not None else "",
            "scope": scope,
            "status": status,
            "reason": reason,
            "key_id": context.key_id if context is not None else "anonymous",
            "source": context.source if context is not None else "auth_failed",
        }
        self._entries.append(entry)
        self._append_entry(entry)

    def list_entries(self, limit: int = 100) -> list[dict[str, Any]]:
        normalized_limit = max(1, min(int(limit or 100), self.max_entries))
        return list(self._entries)[-normalized_limit:]

    def _load_existing_entries(self) -> None:
        audit_path = Path(self.path)
        if not audit_path.exists():
            return
        for line in audit_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(entry, dict):
                self._entries.append(entry)
                try:
                    self.total = max(self.total, int(entry.get("seq") or 0))
                except (TypeError, ValueError):
                    self.total += 1

    def _append_entry(self, entry: dict[str, Any]) -> None:
        if not self.persistent:
            return
        audit_path = Path(self.path)
        audit_path.parent.mkdir(parents=True, exist_ok=True)
        with audit_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False, separators=(",", ":")) + "\\n")


def _audit_log(request: Request) -> AgentAuthAuditLog | None:
    audit = getattr(request.app.state, "auth_audit", None)
    settings = request.app.state.settings
    if audit is None or not bool(getattr(settings, "auth_audit_enabled", True)):
        return None
    return audit


def _apply_auth_controls(request: Request, context: AgentAuthContext, required_scope: str | None) -> AgentAuthContext:
    limiter = getattr(request.app.state, "auth_rate_limiter", None)
    audit = _audit_log(request)
    try:
        if limiter is not None:
            limiter.check(request.app.state.settings, context, scope=required_scope)
    except HTTPException as exc:
        if audit is not None:
            audit.record(request=request, context=context, scope=required_scope, status="rate_limited", reason=str(exc.detail))
        raise
    if audit is not None:
        audit.record(request=request, context=context, scope=required_scope, status="allowed")
    return context


def _record_auth_failure(request: Request, required_scope: str | None, exc: HTTPException) -> None:
    audit = _audit_log(request)
    if audit is not None:
        audit.record(request=request, context=None, scope=required_scope, status="rejected", reason=str(exc.detail))


def _normalize_scopes(value: Any) -> frozenset[str]:
    if value is None:
        return frozenset({"*"})
    if isinstance(value, str):
        scopes = [item.strip() for item in value.replace(";", ",").split(",") if item.strip()]
        return frozenset(scopes or ["*"])
    if isinstance(value, list):
        scopes = [str(item).strip() for item in value if str(item).strip()]
        return frozenset(scopes or ["*"])
    raise ValueError("Escopos de AGENT_API_KEYS devem ser string ou lista.")


def _normalize_expiration(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _parse_expiration(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        if value.isdigit():
            return datetime.fromtimestamp(float(value), timezone.utc)
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ValueError("Expiração de API key deve ser ISO 8601 ou timestamp Unix.") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _is_expired(value: str | None) -> bool:
    expires_at = _parse_expiration(value)
    return bool(expires_at and expires_at <= datetime.now(timezone.utc))


def _append_revoked_key_ids(revoked: set[str], parsed: Any, *, source: str) -> None:
    if isinstance(parsed, str):
        for item in parsed.replace(";", ",").split(","):
            clean_item = item.strip()
            if clean_item:
                revoked.add(clean_item)
        return

    if isinstance(parsed, list):
        for item in parsed:
            clean_item = str(item or "").strip()
            if clean_item:
                revoked.add(clean_item)
        return

    if isinstance(parsed, dict):
        for key in ("revoked", "revoked_key_ids", "keys", "ids"):
            if key in parsed:
                _append_revoked_key_ids(revoked, parsed[key], source=source)
                return
        for key, value in parsed.items():
            if value:
                clean_item = str(key or "").strip()
                if clean_item:
                    revoked.add(clean_item)
        return

    raise ValueError(f"{source} deve ser JSON object, JSON array ou lista separada por vírgulas.")


def _load_revoked_key_ids_file(settings: Any, revoked: set[str]) -> None:
    raw_path = str(getattr(settings, "agent_api_revoked_key_ids_path", "") or "").strip()
    if not raw_path:
        return
    revoked_path = Path(raw_path)
    if not revoked_path.exists():
        raise ValueError("AGENT_API_REVOKED_KEY_IDS_PATH não encontrado.")
    try:
        parsed = json.loads(revoked_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError("AGENT_API_REVOKED_KEY_IDS_PATH deve conter JSON válido.") from exc
    _append_revoked_key_ids(revoked, parsed, source="AGENT_API_REVOKED_KEY_IDS_PATH")


def _iter_revoked_key_ids(settings: Any) -> set[str]:
    revoked: set[str] = set()
    raw_revoked = str(getattr(settings, "agent_api_revoked_key_ids", "") or "").strip()
    if raw_revoked:
        try:
            parsed = json.loads(raw_revoked)
        except json.JSONDecodeError:
            parsed = raw_revoked
        _append_revoked_key_ids(revoked, parsed, source="AGENT_API_REVOKED_KEY_IDS")
    _load_revoked_key_ids_file(settings, revoked)
    return revoked


def _is_revoked(settings: Any, context: AgentAuthContext, revoked_key_ids: set[str] | None = None) -> bool:
    revoked = revoked_key_ids if revoked_key_ids is not None else _iter_revoked_key_ids(settings)
    candidates = {context.key_id, f"{context.source}:{context.key_id}"}
    return bool(candidates.intersection(revoked))


def _append_configured_key(
    configured: list[tuple[str, AgentAuthContext]],
    *,
    key_id: str,
    api_key: Any,
    scopes: Any,
    source: str,
    expires_at: Any = None,
) -> None:
    clean_key = str(api_key or "").strip()
    if not clean_key:
        return
    normalized_expiration = _normalize_expiration(expires_at)
    configured.append(
        (
            clean_key,
            AgentAuthContext(
                key_id=str(key_id or f"key-{len(configured) + 1}"),
                scopes=_normalize_scopes(scopes),
                source=source,
                expires_at=normalized_expiration,
            ),
        )
    )


def _append_configured_keys_from_payload(
    configured: list[tuple[str, AgentAuthContext]],
    parsed: Any,
    *,
    source: str,
) -> None:
    if isinstance(parsed, dict) and isinstance(parsed.get("keys"), list):
        parsed = parsed["keys"]

    if isinstance(parsed, dict):
        for index, (api_key, scopes) in enumerate(parsed.items(), start=1):
            _append_configured_key(
                configured,
                key_id=f"key-{index}",
                api_key=api_key,
                scopes=scopes,
                source=source,
            )
        return

    if isinstance(parsed, list):
        for index, item in enumerate(parsed, start=1):
            if isinstance(item, str):
                _append_configured_key(
                    configured,
                    key_id=f"key-{index}",
                    api_key=item,
                    scopes="*",
                    source=source,
                )
                continue
            if isinstance(item, dict):
                if item.get("enabled") is False:
                    continue
                _append_configured_key(
                    configured,
                    key_id=str(item.get("id") or item.get("name") or f"key-{index}"),
                    api_key=item.get("key") or item.get("api_key"),
                    scopes=item.get("scopes"),
                    source=source,
                    expires_at=item.get("expires_at") or item.get("expiresAt"),
                )
                continue
            raise ValueError(f"Itens de {source} devem ser strings ou objetos.")
        return

    raise ValueError(f"{source} deve ser JSON object, JSON array ou lista separada por vírgulas.")


def _load_configured_keys_file(settings: Any, configured: list[tuple[str, AgentAuthContext]]) -> None:
    raw_path = str(getattr(settings, "agent_api_keys_path", "") or "").strip()
    if not raw_path:
        return
    keys_path = Path(raw_path)
    if not keys_path.exists():
        raise ValueError("AGENT_API_KEYS_PATH não encontrado.")
    try:
        parsed = json.loads(keys_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError("AGENT_API_KEYS_PATH deve conter JSON válido.") from exc
    _append_configured_keys_from_payload(configured, parsed, source="AGENT_API_KEYS_PATH")


def _iter_configured_keys(settings: Any) -> list[tuple[str, AgentAuthContext]]:
    configured: list[tuple[str, AgentAuthContext]] = []
    legacy_key = (getattr(settings, "agent_api_key", "") or "").strip()
    if legacy_key:
        configured.append(
            (
                legacy_key,
                AgentAuthContext(key_id="legacy", scopes=frozenset({"*"}), source="AGENT_API_KEY"),
            )
        )

    raw_keys = (getattr(settings, "agent_api_keys", "") or "").strip()
    if not raw_keys:
        _load_configured_keys_file(settings, configured)
        return configured

    try:
        parsed = json.loads(raw_keys)
    except json.JSONDecodeError:
        parsed = [item.strip() for item in raw_keys.split(",") if item.strip()]

    _append_configured_keys_from_payload(configured, parsed, source="AGENT_API_KEYS")
    _load_configured_keys_file(settings, configured)
    return configured


def describe_agent_auth_keys(settings: Any) -> dict[str, Any]:
    configured = _iter_configured_keys(settings)
    revoked_key_ids = _iter_revoked_key_ids(settings)
    file_path = str(getattr(settings, "agent_api_keys_path", "") or "").strip()
    file_info: dict[str, Any] = {"configured": bool(file_path), "path": file_path or None}
    if file_path:
        path = Path(file_path)
        file_info["exists"] = path.exists()
        if path.exists():
            stat = path.stat()
            file_info["mtime"] = stat.st_mtime
            file_info["size"] = stat.st_size

    revoked_file_path = str(getattr(settings, "agent_api_revoked_key_ids_path", "") or "").strip()
    revoked_file_info: dict[str, Any] = {"configured": bool(revoked_file_path), "path": revoked_file_path or None}
    if revoked_file_path:
        revoked_path = Path(revoked_file_path)
        revoked_file_info["exists"] = revoked_path.exists()
        if revoked_path.exists():
            stat = revoked_path.stat()
            revoked_file_info["mtime"] = stat.st_mtime
            revoked_file_info["size"] = stat.st_size

    source_counts: dict[str, int] = {}
    keys: list[dict[str, Any]] = []
    for _, context in configured:
        source_counts[context.source] = source_counts.get(context.source, 0) + 1
        keys.append(
            {
                "key_id": context.key_id,
                "source": context.source,
                "scopes": sorted(context.scopes),
                "expires_at": context.expires_at,
                "expired": _is_expired(context.expires_at),
                "revoked": _is_revoked(settings, context, revoked_key_ids),
            }
        )
    return {
        "enabled": bool(getattr(settings, "auth_enabled", False)),
        "agent_id": str(getattr(settings, "agent_id", "") or ""),
        "total": len(configured),
        "sources": source_counts,
        "file": file_info,
        "revocation": {
            "configured": bool(revoked_key_ids),
            "total": len(revoked_key_ids),
            "file": revoked_file_info,
        },
        "keys": keys,
    }


def _scope_pattern_matches(scope: str, required_scope: str) -> bool:
    if scope == "*" or scope == required_scope:
        return True
    required_prefix = required_scope.split(":", 1)[0]
    if scope == required_prefix or scope == f"{required_prefix}:*":
        return True
    return bool(scope.endswith(":*") and required_scope.startswith(scope[:-1]))


def _scope_matches(scopes: frozenset[str], required_scope: str | None, *, agent_id: str | None = None) -> bool:
    if not required_scope:
        return True
    if any(_scope_pattern_matches(scope, required_scope) for scope in scopes):
        return True

    normalized_agent_id = str(agent_id or "").strip()
    if not normalized_agent_id:
        return False
    agent_required_scopes = [
        f"agents:{normalized_agent_id}:{required_scope}",
        f"agent:{normalized_agent_id}:{required_scope}",
    ]
    for agent_required_scope in agent_required_scopes:
        if any(_scope_pattern_matches(scope, agent_required_scope) for scope in scopes):
            return True
    return False


def authenticate_agent_api_key(
    settings: Any,
    api_key: str | None,
    required_scope: str | None = None,
) -> AgentAuthContext:
    if not settings.auth_enabled:
        return AgentAuthContext(key_id="disabled", scopes=frozenset({"*"}), source="auth_disabled")

    provided_key = (api_key or "").strip()
    if not provided_key:
        raise HTTPException(status_code=403, detail="Chave de API inválida.")

    try:
        configured_keys = _iter_configured_keys(settings)
        revoked_key_ids = _iter_revoked_key_ids(settings)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    for configured_key, context in configured_keys:
        if secrets.compare_digest(provided_key, configured_key):
            if _is_revoked(settings, context, revoked_key_ids):
                raise HTTPException(status_code=403, detail="Chave de API revogada.")
            if _is_expired(context.expires_at):
                raise HTTPException(status_code=403, detail="Chave de API expirada.")
            if _scope_matches(context.scopes, required_scope, agent_id=getattr(settings, "agent_id", "")):
                return context
            raise HTTPException(status_code=403, detail="Chave de API sem permissão para este recurso.")

    raise HTTPException(status_code=403, detail="Chave de API inválida.")


def require_agent_api_key(
    request: Request,
    x_agent_api_key: str | None = Header(default=None, alias="X-Agent-API-Key"),
) -> AgentAuthContext:
    try:
        context = authenticate_agent_api_key(request.app.state.settings, x_agent_api_key)
    except HTTPException as exc:
        _record_auth_failure(request, None, exc)
        raise
    return _apply_auth_controls(request, context, None)


def require_agent_scope(required_scope: str):
    def dependency(
        request: Request,
        x_agent_api_key: str | None = Header(default=None, alias="X-Agent-API-Key"),
    ) -> AgentAuthContext:
        try:
            context = authenticate_agent_api_key(request.app.state.settings, x_agent_api_key, required_scope)
        except HTTPException as exc:
            _record_auth_failure(request, required_scope, exc)
            raise
        return _apply_auth_controls(request, context, required_scope)

    return dependency


def require_agent_scope_from_header_or_query(required_scope: str):
    def dependency(
        request: Request,
        x_agent_api_key: str | None = Header(default=None, alias="X-Agent-API-Key"),
        api_key: str | None = Query(default=None, alias="api_key"),
    ) -> AgentAuthContext:
        token = x_agent_api_key if (x_agent_api_key or "").strip() else api_key
        try:
            context = authenticate_agent_api_key(request.app.state.settings, token, required_scope)
        except HTTPException as exc:
            _record_auth_failure(request, required_scope, exc)
            raise
        return _apply_auth_controls(request, context, required_scope)

    return dependency
`;
}

function renderMain(flow: AgentFlow): string {
  return `import asyncio
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.orm import Session

from app import repo
from app.auth import (
    AgentAuthAuditLog,
    AgentRateLimiter,
    authenticate_agent_api_key,
    describe_agent_auth_keys,
    require_agent_scope,
    require_agent_scope_from_header_or_query,
)
from app.cache import build_cache
from app.db import get_session, init_db, session_scope
from app.generated_flow import AGENT_ID, API_CONTRACT, API_RESOURCE, FLOW_ID, FLOW_NAME, FLOW_VERSION
from app.graph import build_checkpointer, build_graph
from app.idempotency import normalize_idempotency_key, run_idempotent
from app.llm import LLMClient
from app.safety import SafetyGate
from app.schemas import (
    CreateSessionRequest,
    CreateSessionResponse,
    EmptyIdempotentRequest,
    EventJobScheduleTriggerRequest,
    EventView,
    FinishResponse,
    JobBatchResponse,
    JobCleanupRequest,
    JobCleanupResponse,
    JobMetricsResponse,
    JobRunResponse,
    JobScheduleBatchResponse,
    JobScheduleRequest,
    JobScheduleResponse,
    JobScheduleView,
    JobView,
    MessageView,
    MetadataResponse,
    RecurringJobScheduleRequest,
    SessionView,
    StartResponse,
    TurnRequest,
    TurnResponse,
)
from app.service import ReferenceAgentService
from app.settings import get_settings


logger = logging.getLogger(__name__)


def _format_sse(event: str, data: dict[str, Any], event_id: int | None = None) -> str:
    lines: list[str] = []
    if event_id is not None:
        lines.append(f"id: {event_id}")
    lines.append(f"event: {event}")
    encoded = json.dumps(data, ensure_ascii=False, default=str)
    for line in encoded.splitlines() or [""]:
        lines.append(f"data: {line}")
    return "\\n".join(lines) + "\\n\\n"


async def _accept_websocket_or_close(websocket: WebSocket, required_scope: str = "sessions:read") -> bool:
    settings = websocket.app.state.settings
    if settings.auth_enabled:
        token = (websocket.headers.get("x-agent-api-key") or websocket.query_params.get("api_key") or "").strip()
        try:
            context = authenticate_agent_api_key(settings, token, required_scope)
            websocket.app.state.auth_rate_limiter.check(settings, context, scope=required_scope)
            if settings.auth_audit_enabled:
                websocket.app.state.auth_audit.record(
                    request=None,
                    context=context,
                    scope=required_scope,
                    status="allowed",
                )
        except HTTPException as exc:
            if settings.auth_audit_enabled:
                websocket.app.state.auth_audit.record(
                    request=None,
                    context=None,
                    scope=required_scope,
                    status="rejected",
                    reason=str(exc.detail),
                )
            await websocket.close(code=1008, reason="invalid_api_key")
            return False
    await websocket.accept()
    return True


def _stream_closed_payload(reason: str, session_id: str, next_seq: int, sent: int) -> dict[str, Any]:
    return {"reason": reason, "session_id": session_id, "next_seq": next_seq, "sent": sent}


def _turn_token_payload(index: int, text: str, source: str) -> dict[str, Any]:
    return {"index": index, "text": text, "source": source}


def _iter_turn_tokens(text: str, source: str = "assistant_message"):
    chunks = re.findall(r"\\S+\\s*", text)
    for index, chunk in enumerate(chunks or [text]):
        if chunk:
            yield _turn_token_payload(index + 1, chunk, source)


def _split_configured_statuses(value: str) -> list[str]:
    return [item.strip() for item in str(value or "").split(",") if item.strip()]


def _operations_metadata(settings: Any) -> dict[str, Any]:
    cleanup_statuses = _split_configured_statuses(settings.worker_cleanup_statuses) or ["succeeded", "failed"]
    return {
        "jobs": {
            "enabled": True,
            "manual_cleanup_endpoint": "POST /jobs/cleanup",
            "worker": {
                "command": "python -m app.worker",
                "interval_seconds": settings.worker_interval_seconds,
                "limit": settings.worker_limit,
                "retry_delay_seconds": settings.worker_retry_delay_seconds,
                "lease_seconds": settings.worker_lease_seconds,
                "multiworker_claims": True,
            },
            "retention": {
                "automatic_cleanup_enabled": settings.worker_cleanup_enabled,
                "older_than_hours": settings.worker_cleanup_older_than_hours,
                "limit": settings.worker_cleanup_limit,
                "statuses": cleanup_statuses,
                "dry_run_default": True,
                "terminal_statuses": ["failed", "succeeded"],
            },
            "schedules": {
                "interval": True,
                "cron": "basic",
                "event": True,
            },
        }
    }


def create_app() -> FastAPI:
    settings = get_settings()
    logging.basicConfig(level=settings.log_level)
    if settings.auto_create_tables:
        init_db()

    cache = build_cache(settings)
    llm_client = LLMClient(settings)
    safety_gate = SafetyGate()
    checkpointer = build_checkpointer(settings)
    graph = build_graph(
        settings=settings,
        llm_client=llm_client,
        safety_gate=safety_gate,
        checkpointer=checkpointer,
    )
    service = ReferenceAgentService(settings=settings, graph=graph, cache=cache)

    app = FastAPI(title=FLOW_NAME)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.settings = settings
    app.state.cache = cache
    app.state.service = service
    app.state.auth_rate_limiter = AgentRateLimiter()
    app.state.auth_audit = AgentAuthAuditLog(settings.auth_audit_max_entries, settings.auth_audit_path)

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        logger.exception("Erro não tratado em %s", request.url.path)
        return JSONResponse(status_code=500, content={"detail": "Erro interno no agente."})

    @app.get("/health")
    def health(db: Session = Depends(get_session)):
        db_ok = repo.check_db_health(db)
        try:
            cache_ok = bool(cache.ping())
        except Exception:
            cache_ok = False
        return {
            "status": "ok" if db_ok and cache_ok else "degraded",
            "db_ok": db_ok,
            "cache_ok": cache_ok,
        }

    @app.get(
        "/metadata",
        response_model=MetadataResponse,
        dependencies=[Depends(require_agent_scope("metadata:read"))],
    )
    def metadata():
        return {
            "service": settings.service_name,
            "runtime": "langgraph-fastapi-python",
            "contract": API_CONTRACT,
            "flow_id": FLOW_ID,
            "agent_id": AGENT_ID,
            "flow_version": FLOW_VERSION,
            "llm_adapter": settings.llm_adapter,
            "supports_multi_agent_bundle": False,
            "operations": _operations_metadata(settings),
        }

    @app.get(
        "/auth/audit",
        dependencies=[Depends(require_agent_scope("metadata:read"))],
    )
    def auth_audit(limit: int = Query(default=100, ge=1, le=500)):
        audit = app.state.auth_audit
        return {
            "enabled": settings.auth_audit_enabled,
            "persistent": audit.persistent,
            "path": audit.path or None,
            "total": audit.total,
            "entries": audit.list_entries(limit),
        }

    @app.get(
        "/auth/keys",
        dependencies=[Depends(require_agent_scope("auth:read"))],
    )
    def auth_keys():
        return describe_agent_auth_keys(settings)

    def idempotency_key(header: str | None, body_key: str | None) -> str:
        return normalize_idempotency_key(header, body_key)

    def operation_name(request: Request, method: str, path_template: str) -> str:
        root_path = (request.scope.get("root_path") or "").rstrip("/")
        return f"{method} {root_path}{path_template}"

    @app.post(
        f"/{API_RESOURCE}",
        response_model=CreateSessionResponse,
        dependencies=[Depends(require_agent_scope("sessions:write"))],
    )
    def create_session(
        request: Request,
        payload: CreateSessionRequest,
        db: Session = Depends(get_session),
        header_idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ):
        key = idempotency_key(header_idempotency_key, payload.idempotency_key)
        request_payload = payload.model_dump(mode="json")
        return run_idempotent(
            db,
            operation=operation_name(request, "POST", f"/{API_RESOURCE}"),
            idempotency_key=key,
            payload=request_payload,
            handler=lambda: app.state.service.create_session(
                db,
                metadata=payload.metadata,
                max_turns=payload.max_turns,
                auto_start=payload.auto_start,
            ),
        )

    @app.get(
        f"/{API_RESOURCE}/{{session_id}}",
        response_model=SessionView,
        dependencies=[Depends(require_agent_scope("sessions:read"))],
    )
    def get_session_view(session_id: str, db: Session = Depends(get_session)):
        return app.state.service.get_session(db, session_id)

    @app.post(
        f"/{API_RESOURCE}/{{session_id}}/start",
        response_model=StartResponse,
        dependencies=[Depends(require_agent_scope("sessions:write"))],
    )
    def start_session(
        request: Request,
        session_id: str,
        payload: EmptyIdempotentRequest,
        db: Session = Depends(get_session),
        header_idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ):
        key = idempotency_key(header_idempotency_key, payload.idempotency_key)
        request_payload: dict[str, Any] = {"session_id": session_id, **payload.model_dump(mode="json")}
        return run_idempotent(
            db,
            operation=operation_name(request, "POST", f"/{API_RESOURCE}/{{session_id}}/start"),
            idempotency_key=key,
            payload=request_payload,
            handler=lambda: app.state.service.start_session(db, session_id),
        )

    @app.post(
        f"/{API_RESOURCE}/{{session_id}}/turn",
        response_model=TurnResponse,
        dependencies=[Depends(require_agent_scope("sessions:write"))],
    )
    def turn_session(
        request: Request,
        session_id: str,
        payload: TurnRequest,
        db: Session = Depends(get_session),
        header_idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ):
        key = idempotency_key(header_idempotency_key, payload.idempotency_key)
        request_payload: dict[str, Any] = {"session_id": session_id, **payload.model_dump(mode="json")}
        return run_idempotent(
            db,
            operation=operation_name(request, "POST", f"/{API_RESOURCE}/{{session_id}}/turn"),
            idempotency_key=key,
            payload=request_payload,
            handler=lambda: app.state.service.process_turn(db, session_id, payload.user_message),
        )

    @app.post(
        f"/{API_RESOURCE}/{{session_id}}/turn/stream",
        dependencies=[Depends(require_agent_scope("sessions:write"))],
    )
    async def turn_session_stream(
        request: Request,
        session_id: str,
        payload: TurnRequest,
        header_idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ):
        key = idempotency_key(header_idempotency_key, payload.idempotency_key)
        request_payload: dict[str, Any] = {"session_id": session_id, **payload.model_dump(mode="json")}
        turn_operation = operation_name(request, "POST", f"/{API_RESOURCE}/{{session_id}}/turn")

        async def turn_event_generator():
            token_queue: asyncio.Queue[str | None] = asyncio.Queue()
            result: dict[str, Any] = {}
            error: dict[str, Any] = {}
            loop = asyncio.get_running_loop()
            sent = 0
            token_index = 0

            def token_callback(chunk: str):
                if chunk:
                    loop.call_soon_threadsafe(token_queue.put_nowait, str(chunk))

            def run_turn_in_thread() -> None:
                try:
                    with session_scope() as scoped_db:
                        result["response"] = run_idempotent(
                            scoped_db,
                            operation=turn_operation,
                            idempotency_key=key,
                            payload=request_payload,
                            handler=lambda: app.state.service.process_turn(
                                scoped_db,
                                session_id,
                                payload.user_message,
                                token_callback=token_callback,
                            ),
                        )
                except HTTPException as exc:
                    error["value"] = {"status_code": exc.status_code, "detail": exc.detail}
                except Exception as exc:
                    error["value"] = {"status_code": 500, "detail": str(exc)}
                finally:
                    loop.call_soon_threadsafe(token_queue.put_nowait, None)

            yield _format_sse("turn_started", {"session_id": session_id, "idempotency_key": key})

            worker = asyncio.create_task(asyncio.to_thread(run_turn_in_thread))
            try:
                while True:
                    token_or_done = await token_queue.get()
                    if token_or_done is None:
                        break
                    token_index += 1
                    sent += 1
                    yield _format_sse(
                        "token",
                        _turn_token_payload(token_index, str(token_or_done), "llm_callback"),
                    )
                    await asyncio.sleep(0)

                await worker
            except asyncio.CancelledError:
                worker.cancel()
                raise

            if "value" in error:
                yield _format_sse("turn_error", error["value"])
                yield _format_sse("stream_closed", _stream_closed_payload("error", session_id, 0, sent))
                return

            response = result.get("response") or {}
            assistant = response.get("assistant_message") or {}
            if sent == 0:
                for token_payload in _iter_turn_tokens(str(assistant.get("text") or "")):
                    sent += 1
                    yield _format_sse("token", token_payload)
                    await asyncio.sleep(0)
            yield _format_sse("turn_completed", response)
            yield _format_sse("stream_closed", _stream_closed_payload("turn_completed", session_id, 0, sent))

        return StreamingResponse(
            turn_event_generator(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.websocket(
        f"/{API_RESOURCE}/{{session_id}}/turn/stream/ws"
    )
    async def websocket_turn_session_stream(
        websocket: WebSocket,
        session_id: str,
        user_message: str = Query(..., alias="user_message"),
        query_idempotency_key: str | None = Query(default=None, alias="idempotency_key"),
        payload_idempotency_key: str | None = Query(default=None, alias="payload.idempotency_key"),
    ):
        if not await _accept_websocket_or_close(websocket, "sessions:write"):
            return

        key = idempotency_key(header=query_idempotency_key, body_key=payload_idempotency_key)
        request_payload: dict[str, Any] = {
            "session_id": session_id,
            "user_message": user_message,
            "idempotency_key": key,
        }
        turn_operation = f"POST /{API_RESOURCE}/{{session_id}}/turn"
        token_queue: asyncio.Queue[str | None] = asyncio.Queue()
        result: dict[str, Any] = {}
        error: dict[str, Any] = {}
        loop = asyncio.get_running_loop()
        sent = 0
        token_index = 0

        def token_callback(chunk: str):
            if chunk:
                loop.call_soon_threadsafe(token_queue.put_nowait, str(chunk))

        def run_turn_in_thread() -> None:
            try:
                with session_scope() as scoped_db:
                    result["response"] = run_idempotent(
                        scoped_db,
                        operation=turn_operation,
                        idempotency_key=key,
                        payload={"session_id": session_id, "user_message": user_message, "idempotency_key": key},
                        handler=lambda: app.state.service.process_turn(
                            scoped_db,
                            session_id,
                            user_message,
                            token_callback=token_callback,
                        ),
                    )
            except HTTPException as exc:
                error["value"] = {"status_code": exc.status_code, "detail": exc.detail}
            except Exception as exc:
                error["value"] = {"status_code": 500, "detail": str(exc)}
            finally:
                loop.call_soon_threadsafe(token_queue.put_nowait, None)

        await websocket.send_json({"event": "turn_started", "data": {"session_id": session_id, "idempotency_key": key}})

        worker = asyncio.create_task(asyncio.to_thread(run_turn_in_thread))
        try:
            while True:
                token_or_done = await token_queue.get()
                if token_or_done is None:
                    break
                token = str(token_or_done)
                token_index += 1
                sent += 1
                await websocket.send_json(
                    {"event": "token", "data": _turn_token_payload(token_index, token, "llm_callback")}
                )

            await worker
            if "value" in error:
                await websocket.send_json({"event": "turn_error", "data": error["value"]})
                await websocket.send_json({"event": "stream_closed", "data": _stream_closed_payload("error", session_id, 0, sent)})
                await websocket.close(code=4000, reason="turn_error")
                return

            response = result.get("response") or {}
            if sent == 0:
                assistant = response.get("assistant_message") or {}
                for token_payload in _iter_turn_tokens(str(assistant.get("text") or "")):
                    sent += 1
                    await websocket.send_json({"event": "token", "data": token_payload})
            await websocket.send_json({"event": "turn_completed", "data": response})
            await websocket.send_json({"event": "stream_closed", "data": _stream_closed_payload("turn_completed", session_id, 0, sent)})
            await websocket.close(code=1000, reason="turn_completed")
        except WebSocketDisconnect:
            worker.cancel()
            return

    @app.post(
        f"/{API_RESOURCE}/{{session_id}}/finish",
        response_model=FinishResponse,
        dependencies=[Depends(require_agent_scope("sessions:write"))],
    )
    def finish_session(
        request: Request,
        session_id: str,
        payload: EmptyIdempotentRequest,
        db: Session = Depends(get_session),
        header_idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    ):
        key = idempotency_key(header_idempotency_key, payload.idempotency_key)
        request_payload: dict[str, Any] = {"session_id": session_id, **payload.model_dump(mode="json")}
        return run_idempotent(
            db,
            operation=operation_name(request, "POST", f"/{API_RESOURCE}/{{session_id}}/finish"),
            idempotency_key=key,
            payload=request_payload,
            handler=lambda: app.state.service.finish_session(db, session_id),
        )

    @app.get(
        f"/{API_RESOURCE}/{{session_id}}/transcript",
        response_model=list[MessageView],
        dependencies=[Depends(require_agent_scope("sessions:read"))],
    )
    def transcript(
        session_id: str,
        from_seq: int | None = Query(default=None, alias="from_seq"),
        db: Session = Depends(get_session),
    ):
        return app.state.service.transcript(db, session_id, from_seq=from_seq)

    @app.get(
        f"/{API_RESOURCE}/{{session_id}}/events",
        response_model=list[EventView],
        dependencies=[Depends(require_agent_scope("sessions:read"))],
    )
    def events(
        session_id: str,
        from_seq: int | None = Query(default=None, alias="from_seq"),
        db: Session = Depends(get_session),
    ):
        return app.state.service.events(db, session_id, from_seq=from_seq)

    @app.get(
        "/jobs",
        response_model=list[JobView],
        dependencies=[Depends(require_agent_scope("jobs:read"))],
    )
    def jobs(
        session_id: str | None = Query(default=None),
        status: str | None = Query(default=None),
        db: Session = Depends(get_session),
    ):
        return app.state.service.jobs(db, session_id=session_id, status=status)

    @app.get(
        "/jobs/metrics",
        response_model=JobMetricsResponse,
        dependencies=[Depends(require_agent_scope("jobs:read"))],
    )
    def job_metrics(
        window_hours: float = Query(default=1.0, ge=0.0, le=8760.0),
        db: Session = Depends(get_session),
    ):
        return app.state.service.job_metrics(db, window_hours=window_hours)

    @app.post(
        "/jobs/cleanup",
        response_model=JobCleanupResponse,
        dependencies=[Depends(require_agent_scope("jobs:write"))],
    )
    def cleanup_jobs(payload: JobCleanupRequest, db: Session = Depends(get_session)):
        return app.state.service.cleanup_jobs(
            db,
            statuses=payload.statuses,
            older_than_hours=payload.older_than_hours,
            session_id=payload.session_id,
            limit=payload.limit,
            dry_run=payload.dry_run,
        )

    @app.post(
        "/jobs/run-pending",
        response_model=JobBatchResponse,
        dependencies=[Depends(require_agent_scope("jobs:write"))],
    )
    def run_pending_jobs(
        session_id: str | None = Query(default=None),
        limit: int = Query(default=50, ge=1, le=200),
        worker_id: str | None = Query(default=None, max_length=120),
        lease_seconds: float = Query(default=60.0, ge=1.0, le=86400.0),
        db: Session = Depends(get_session),
    ):
        return app.state.service.run_pending_jobs(
            db,
            session_id=session_id,
            limit=limit,
            worker_id=worker_id,
            lease_seconds=lease_seconds,
        )

    @app.post(
        "/jobs/retry-failed",
        response_model=JobBatchResponse,
        dependencies=[Depends(require_agent_scope("jobs:write"))],
    )
    def retry_failed_jobs(
        session_id: str | None = Query(default=None),
        limit: int = Query(default=50, ge=1, le=200),
        db: Session = Depends(get_session),
    ):
        return app.state.service.retry_failed_jobs(db, session_id=session_id, limit=limit)

    @app.get(
        "/jobs/{job_id}",
        response_model=JobView,
        dependencies=[Depends(require_agent_scope("jobs:read"))],
    )
    def get_job(job_id: str, db: Session = Depends(get_session)):
        return app.state.service.get_job(db, job_id)

    @app.post(
        "/jobs/{job_id}/run",
        response_model=JobRunResponse,
        dependencies=[Depends(require_agent_scope("jobs:write"))],
    )
    def run_job(job_id: str, db: Session = Depends(get_session)):
        return app.state.service.run_job(db, job_id)

    @app.post(
        "/jobs/{job_id}/retry",
        response_model=JobRunResponse,
        dependencies=[Depends(require_agent_scope("jobs:write"))],
    )
    def retry_job(job_id: str, db: Session = Depends(get_session)):
        return app.state.service.retry_job(db, job_id)

    @app.post(
        "/jobs/{job_id}/schedule",
        response_model=JobRunResponse,
        dependencies=[Depends(require_agent_scope("jobs:write"))],
    )
    def schedule_job(job_id: str, payload: JobScheduleRequest, db: Session = Depends(get_session)):
        run_at = payload.run_at
        if run_at is None:
            run_at = datetime.now(timezone.utc) + timedelta(seconds=max(0.0, float(payload.delay_seconds or 0.0)))
        return app.state.service.schedule_job(db, job_id, run_at)

    @app.get(
        "/job-schedules",
        response_model=list[JobScheduleView],
        dependencies=[Depends(require_agent_scope("jobs:read"))],
    )
    def job_schedules(
        session_id: str | None = Query(default=None),
        status: str | None = Query(default=None),
        db: Session = Depends(get_session),
    ):
        return app.state.service.job_schedules(db, session_id=session_id, status=status)

    @app.post(
        "/jobs/{job_id}/recurrence",
        response_model=JobScheduleResponse,
        dependencies=[Depends(require_agent_scope("jobs:write"))],
    )
    def create_job_recurrence(
        job_id: str,
        payload: RecurringJobScheduleRequest,
        db: Session = Depends(get_session),
    ):
        return app.state.service.create_job_recurrence(
            db,
            job_id,
            interval_seconds=payload.interval_seconds,
            trigger_type=payload.trigger_type,
            cron_expression=payload.cron_expression,
            event_type=payload.event_type,
            run_at=payload.run_at,
            delay_seconds=payload.delay_seconds,
        )

    @app.post(
        "/job-schedules/trigger-event",
        response_model=JobScheduleBatchResponse,
        dependencies=[Depends(require_agent_scope("jobs:write"))],
    )
    def trigger_event_job_schedules(payload: EventJobScheduleTriggerRequest, db: Session = Depends(get_session)):
        return app.state.service.trigger_event_job_schedules(
            db,
            event_type=payload.event_type,
            session_id=payload.session_id,
            payload=payload.payload,
            limit=payload.limit,
        )

    @app.post(
        "/job-schedules/run-due",
        response_model=JobScheduleBatchResponse,
        dependencies=[Depends(require_agent_scope("jobs:write"))],
    )
    def run_due_job_schedules(limit: int = Query(default=20, ge=1, le=200), db: Session = Depends(get_session)):
        return app.state.service.run_due_job_schedules(db, limit=limit)

    @app.post(
        "/job-schedules/{schedule_id}/disable",
        response_model=JobScheduleResponse,
        dependencies=[Depends(require_agent_scope("jobs:write"))],
    )
    def disable_job_schedule(schedule_id: str, db: Session = Depends(get_session)):
        return app.state.service.disable_job_schedule(db, schedule_id)

    @app.get(
        f"/{API_RESOURCE}/{{session_id}}/events/stream",
        dependencies=[Depends(require_agent_scope_from_header_or_query("sessions:read"))],
    )
    async def stream_events(
        session_id: str,
        from_seq: int | None = Query(default=None, alias="from_seq"),
        poll_seconds: float = Query(default=0.5, ge=0.1, le=5.0),
        timeout_seconds: float = Query(default=30.0, ge=0.0, le=300.0),
        max_events: int = Query(default=200, ge=1, le=1000),
        end_after_complete: bool = Query(default=True),
        db: Session = Depends(get_session),
    ):
        app.state.service.get_session(db, session_id)

        async def event_generator():
            next_seq = max(1, int(from_seq or 1))
            sent = 0
            loop = asyncio.get_running_loop()
            deadline = None if timeout_seconds <= 0 else loop.time() + timeout_seconds
            while True:
                batch = app.state.service.events(db, session_id, from_seq=next_seq)
                for event in batch:
                    seq = int(event.get("seq") or next_seq)
                    next_seq = max(next_seq, seq + 1)
                    sent += 1
                    yield _format_sse("agent_event", event, seq)
                    if sent >= max_events:
                        yield _format_sse("stream_closed", _stream_closed_payload("max_events", session_id, next_seq, sent))
                        return

                session = app.state.service.get_session(db, session_id)
                if end_after_complete and session.get("is_complete") and not batch:
                    yield _format_sse("stream_closed", _stream_closed_payload("session_complete", session_id, next_seq, sent))
                    return
                if deadline is not None and loop.time() >= deadline:
                    yield _format_sse("stream_closed", _stream_closed_payload("timeout", session_id, next_seq, sent))
                    return
                await asyncio.sleep(poll_seconds)

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.websocket(f"/{API_RESOURCE}/{{session_id}}/events/ws")
    async def websocket_events(
        websocket: WebSocket,
        session_id: str,
        from_seq: int | None = Query(default=None, alias="from_seq"),
        poll_seconds: float = Query(default=0.5, ge=0.1, le=5.0),
        timeout_seconds: float = Query(default=30.0, ge=0.0, le=300.0),
        max_events: int = Query(default=200, ge=1, le=1000),
        end_after_complete: bool = Query(default=True),
    ):
        if not await _accept_websocket_or_close(websocket):
            return

        next_seq = max(1, int(from_seq or 1))
        sent = 0
        loop = asyncio.get_running_loop()
        deadline = None if timeout_seconds <= 0 else loop.time() + timeout_seconds
        try:
            with session_scope() as db:
                app.state.service.get_session(db, session_id)
        except Exception:
            await websocket.send_json(
                {"event": "stream_closed", "data": _stream_closed_payload("session_not_found", session_id, next_seq, sent)}
            )
            await websocket.close(code=1008, reason="session_not_found")
            return

        try:
            while True:
                with session_scope() as db:
                    batch = app.state.service.events(db, session_id, from_seq=next_seq)
                    session = app.state.service.get_session(db, session_id)

                for event in batch:
                    seq = int(event.get("seq") or next_seq)
                    next_seq = max(next_seq, seq + 1)
                    sent += 1
                    await websocket.send_json({"event": "agent_event", "id": seq, "data": event})
                    if sent >= max_events:
                        await websocket.send_json(
                            {"event": "stream_closed", "data": _stream_closed_payload("max_events", session_id, next_seq, sent)}
                        )
                        await websocket.close(code=1000, reason="max_events")
                        return

                if end_after_complete and session.get("is_complete") and not batch:
                    await websocket.send_json(
                        {
                            "event": "stream_closed",
                            "data": _stream_closed_payload("session_complete", session_id, next_seq, sent),
                        }
                    )
                    await websocket.close(code=1000, reason="session_complete")
                    return
                if deadline is not None and loop.time() >= deadline:
                    await websocket.send_json(
                        {"event": "stream_closed", "data": _stream_closed_payload("timeout", session_id, next_seq, sent)}
                    )
                    await websocket.close(code=1000, reason="timeout")
                    return
                await asyncio.sleep(poll_seconds)
        except WebSocketDisconnect:
            return

    return app


app = create_app()
`;
}

function renderLangGraphApp(): string {
  return `"""Entrypoint do LangGraph Platform para sandbox LangSmith/LangGraph.

Este modulo exporta \`graph\` no formato esperado por \`langgraph.json\`.
O runtime FastAPI continua em \`app.main:app\`; este arquivo existe para
validar o comportamento do agente no sandbox antes do empacotamento final.
"""

from app.db import init_db
from app.graph import build_graph
from app.llm import LLMClient
from app.safety import SafetyGate
from app.settings import get_settings


settings = get_settings()
if settings.auto_create_tables:
    init_db()

llm_client = LLMClient(settings)
safety_gate = SafetyGate()

graph = build_graph(
    settings=settings,
    llm_client=llm_client,
    safety_gate=safety_gate,
    checkpointer=None,
)
`;
}

function renderTestConftest(): string {
  return `import os
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
project_root_text = str(PROJECT_ROOT)
if project_root_text not in sys.path:
    sys.path.insert(0, project_root_text)


def set_test_env(db_path: str) -> None:
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    os.environ["REDIS_ENABLED"] = "false"
    os.environ["USE_POSTGRES_CHECKPOINTER"] = "false"
    os.environ["MOCK_LLM"] = "true"
    os.environ["AUTH_ENABLED"] = "false"
    os.environ["AGENT_API_KEY"] = ""
    os.environ["AGENT_API_KEYS"] = ""
    os.environ["AGENT_API_KEYS_PATH"] = ""
    os.environ["AGENT_API_REVOKED_KEY_IDS"] = ""
    os.environ["AGENT_API_REVOKED_KEY_IDS_PATH"] = ""
    os.environ["AUTH_RATE_LIMIT_ENABLED"] = "false"
    os.environ["AUTH_RATE_LIMIT_REQUESTS"] = "60"
    os.environ["AUTH_RATE_LIMIT_WINDOW_SECONDS"] = "60"
    os.environ["AUTH_AUDIT_ENABLED"] = "true"
    os.environ["AUTH_AUDIT_MAX_ENTRIES"] = "200"
    os.environ["AUTH_AUDIT_PATH"] = ""
    os.environ["SAFETY_PROVIDER_ENABLED"] = "false"
    os.environ["SAFETY_PROVIDER_URL"] = ""
    os.environ["SAFETY_PROVIDER_TIMEOUT_SECONDS"] = "3"
    os.environ["SAFETY_PROVIDER_FAIL_CLOSED"] = "false"
    os.environ["SAFETY_PROVIDER_HEADERS_JSON"] = ""
    os.environ["AUTO_CREATE_TABLES"] = "true"
    os.environ["WORKER_INTERVAL_SECONDS"] = "5"
    os.environ["WORKER_LIMIT"] = "20"
    os.environ["WORKER_RETRY_DELAY_SECONDS"] = "5"
    os.environ["WORKER_LEASE_SECONDS"] = "60"
    os.environ["WORKER_CLEANUP_ENABLED"] = "false"
    os.environ["WORKER_CLEANUP_OLDER_THAN_HOURS"] = "168"
    os.environ["WORKER_CLEANUP_LIMIT"] = "100"
    os.environ["WORKER_CLEANUP_STATUSES"] = "succeeded,failed"
    os.environ["LANGSMITH_TRACING"] = "false"

    from app.settings import get_settings

    get_settings.cache_clear()
`;
}

function renderLangGraphPlatformTest(): string {
  return `import importlib
import sys

from tests.conftest import set_test_env


def test_langgraph_platform_entrypoint_loads_and_invokes(tmp_path):
    set_test_env(str(tmp_path / "langgraph-platform.db"))
    sys.modules.pop("app.langgraph_app", None)

    module = importlib.import_module("app.langgraph_app")
    assert hasattr(module.graph, "invoke")
    from app.graph import START_NODE_IDS

    result = module.graph.invoke(
        {
            "action": "start",
            "session_id": "platform-smoke",
            "status": "created",
            "phase": "created",
            "turn": 0,
            "max_turns": 3,
            "executed_nodes": [],
        },
        config={"configurable": {"thread_id": "platform-smoke"}},
    )
    assert result["assistant_message"]["code"] == "ABR"
    assert START_NODE_IDS[0] in result["executed_nodes"]
`;
}

function renderRuntimeTest(): string {
  return `import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi.testclient import TestClient

from app.generated_flow import AGENT_ID, API_RESOURCE, FLOW_ID
from tests.conftest import set_test_env


def _path(suffix: str = "") -> str:
    return f"/{API_RESOURCE}{suffix}"


def _client(tmp_path, env_overrides=None):
    set_test_env(str(tmp_path / "generated.db"))
    for key, value in (env_overrides or {}).items():
        os.environ[key] = value

    from app.settings import get_settings

    get_settings.cache_clear()

    from app.db import engine
    from app.main import create_app
    from app.models import Base

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestClient(create_app())


def test_generated_init_db_adds_agent_columns_to_legacy_sqlite(tmp_path):
    db_path = tmp_path / "legacy.db"
    connection = sqlite3.connect(db_path)
    connection.executescript(
        """
        CREATE TABLE agent_sessions (
          session_id VARCHAR PRIMARY KEY,
          status VARCHAR NOT NULL,
          phase VARCHAR NOT NULL,
          turn INTEGER NOT NULL DEFAULT 0,
          max_turns INTEGER NOT NULL DEFAULT 3,
          metadata_json JSON,
          created_at DATETIME,
          updated_at DATETIME,
          completed_at DATETIME
        );
        INSERT INTO agent_sessions (session_id, status, phase, turn, max_turns)
        VALUES ('legacy-session', 'created', 'created', 0, 3);

        CREATE TABLE agent_events (
          event_id VARCHAR PRIMARY KEY,
          session_id VARCHAR NOT NULL,
          seq INTEGER NOT NULL,
          event_type VARCHAR NOT NULL,
          node VARCHAR NULL,
          payload JSON,
          created_at DATETIME
        );
        INSERT INTO agent_events (event_id, session_id, seq, event_type)
        VALUES ('legacy-event', 'legacy-session', 1, 'legacy');

        CREATE TABLE agent_jobs (
          job_id VARCHAR PRIMARY KEY,
          session_id VARCHAR NOT NULL,
          kind VARCHAR NOT NULL,
          status VARCHAR NOT NULL
        );
        INSERT INTO agent_jobs (job_id, session_id, kind, status)
        VALUES ('legacy-job', 'legacy-session', 'post_finish_summary', 'pending');
        """
    )
    connection.close()

    project_root = Path(__file__).resolve().parents[1]
    script = """
import os
import sqlite3
from pathlib import Path

db_path = Path(os.environ["LEGACY_DB_PATH"])
expected_agent_id = os.environ["EXPECTED_AGENT_ID"]
os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
os.environ["REDIS_ENABLED"] = "false"
os.environ["USE_POSTGRES_CHECKPOINTER"] = "false"
os.environ["MOCK_LLM"] = "true"
os.environ["AUTH_ENABLED"] = "false"
os.environ["AUTO_CREATE_TABLES"] = "true"
os.environ["LANGSMITH_TRACING"] = "false"

from app.db import init_db

init_db()
connection = sqlite3.connect(db_path)
session_columns = {row[1] for row in connection.execute("PRAGMA table_info(agent_sessions)").fetchall()}
event_columns = {row[1] for row in connection.execute("PRAGMA table_info(agent_events)").fetchall()}
job_columns = {row[1] for row in connection.execute("PRAGMA table_info(agent_jobs)").fetchall()}
assert "agent_id" in session_columns
assert "agent_id" in event_columns
assert {
    "agent_id",
    "attempts",
    "max_attempts",
    "result_json",
    "last_error_json",
    "created_at",
    "updated_at",
    "next_run_at",
    "locked_by",
    "locked_until",
    "lock_acquired_at",
}.issubset(job_columns)
assert connection.execute("SELECT agent_id FROM agent_sessions WHERE session_id = 'legacy-session'").fetchone()[0] == expected_agent_id
assert connection.execute("SELECT agent_id FROM agent_events WHERE event_id = 'legacy-event'").fetchone()[0] == expected_agent_id
assert connection.execute("SELECT agent_id FROM agent_jobs WHERE job_id = 'legacy-job'").fetchone()[0] == expected_agent_id
connection.close()
"""
    env = {**os.environ, "LEGACY_DB_PATH": str(db_path), "EXPECTED_AGENT_ID": AGENT_ID, "PYTHONPATH": str(project_root)}
    subprocess.run([sys.executable, "-c", script], cwd=project_root, env=env, check=True)


def test_generated_runtime_metadata_flow_and_idempotency(tmp_path):
    client = _client(tmp_path)

    metadata = client.get("/metadata")
    assert metadata.status_code == 200
    assert metadata.json()["flow_id"] == FLOW_ID
    assert metadata.json()["agent_id"] == AGENT_ID

    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "create-1"},
        json={"metadata": {"source": "pytest"}, "max_turns": 2},
    )
    assert create_resp.status_code == 200
    session_id = create_resp.json()["session"]["session_id"]
    assert create_resp.json()["session"]["agent_id"] == AGENT_ID

    duplicate_create = client.post(
        _path(),
        headers={"Idempotency-Key": "create-1"},
        json={"metadata": {"source": "pytest"}, "max_turns": 2},
    )
    assert duplicate_create.status_code == 200
    assert duplicate_create.json()["session"]["session_id"] == session_id

    start_resp = client.post(
        _path(f"/{session_id}/start"),
        headers={"Idempotency-Key": "start-1"},
        json={},
    )
    assert start_resp.status_code == 200
    assert start_resp.json()["session"]["status"] == "active"
    assert start_resp.json()["messages"][0]["code"] == "ABR"

    turn_payload = {"user_message": "Este é um teste do fluxo."}
    turn_resp = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "turn-1"},
        json=turn_payload,
    )
    assert turn_resp.status_code == 200
    turn_data = turn_resp.json()
    assert turn_data["assistant_message"]["code"] == "ECHO"
    assert turn_data["safety"]["decision"] == "allow"
    assert turn_data["session"]["agent_id"] == AGENT_ID
    assert turn_data["session"]["turn"] == 1

    duplicate_turn = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "turn-1"},
        json=turn_payload,
    )
    assert duplicate_turn.status_code == 200
    assert duplicate_turn.json()["assistant_message"] == turn_data["assistant_message"]

    transcript = client.get(_path(f"/{session_id}/transcript")).json()
    assert [item["role"] for item in transcript].count("user") == 1
    assert [item["role"] for item in transcript].count("assistant") == 2

    events = client.get(_path(f"/{session_id}/events")).json()
    event_types = [item["event_type"] for item in events]
    assert "span_started" in event_types
    assert "span_completed" in event_types
    assert "llm_called" in event_types
    assert {item["agent_id"] for item in events} == {AGENT_ID}
    completed_spans = [item for item in events if item["event_type"] == "span_completed"]
    assert "llm_step" in {item["node"] for item in completed_spans}
    llm_span = next(item for item in completed_spans if item["node"] == "llm_step")
    assert llm_span["payload"]["span"]["operation"] == "graph_node"
    assert llm_span["payload"]["span"]["node_type"] == "llm_prompt"
    assert llm_span["payload"]["span"]["duration_ms"] >= 0
    assert llm_span["payload"]["source"] == "runtime_native_span"
    assert llm_span["payload"]["source_message_id"]

    with client.stream("GET", _path(f"/{session_id}/events/stream?from_seq=1&max_events=1")) as stream:
        assert stream.status_code == 200
        assert stream.headers["content-type"].startswith("text/event-stream")
        stream_body = "".join(stream.iter_text())
    assert "event: agent_event" in stream_body
    assert "event: stream_closed" in stream_body
    assert '"reason": "max_events"' in stream_body

    with client.websocket_connect(_path(f"/{session_id}/events/ws?from_seq=1&max_events=1")) as websocket:
        websocket_event = websocket.receive_json()
        websocket_closed = websocket.receive_json()
    assert websocket_event["event"] == "agent_event"
    assert websocket_event["data"]["seq"] == 1
    assert websocket_closed["event"] == "stream_closed"
    assert websocket_closed["data"]["reason"] == "max_events"

    finish_resp = client.post(
        _path(f"/{session_id}/finish"),
        headers={"Idempotency-Key": "finish-1"},
        json={},
    )
    assert finish_resp.status_code == 200
    jobs = client.get(f"/jobs?session_id={session_id}").json()
    assert len(jobs) == 1
    assert jobs[0]["kind"] == "post_finish_summary"
    assert jobs[0]["status"] == "pending"

    run_job = client.post(f"/jobs/{jobs[0]['job_id']}/run").json()["job"]
    assert run_job["status"] == "succeeded"
    assert run_job["result"]["message_count"] >= 3
    assert run_job["result"]["event_count"] >= len(events)
    metrics = client.get("/jobs/metrics?window_hours=24").json()
    assert metrics["total"] == 1
    assert metrics["by_status"]["succeeded"] == 1
    assert metrics["by_kind"]["post_finish_summary"] == 1
    assert metrics["attempts_total"] == 1
    assert metrics["succeeded"] == 1
    assert metrics["terminal"] == 1
    assert metrics["success_rate"] == 1
    assert metrics["duration_ms_avg"] is not None
    assert metrics["duration_ms_p95"] is not None
    assert metrics["duration_ms_max"] >= metrics["duration_ms_min"] >= 0
    assert metrics["window_hours"] == 24
    assert metrics["finished_in_window"] == 1
    assert metrics["succeeded_in_window"] == 1
    assert metrics["success_rate_in_window"] == 1
    assert metrics["window_duration_ms_p95"] is not None
    assert metrics["throughput_per_hour"] > 0
    assert metrics["finished_last_hour"] == 1
    assert metrics["last_finished_at"] is not None

    completed_events = client.get(_path(f"/{session_id}/events")).json()
    assert "post_finish_completed" in [item["event_type"] for item in completed_events]


def test_generated_metadata_exposes_sanitized_worker_retention_policy(tmp_path):
    client = _client(
        tmp_path,
        env_overrides={
            "WORKER_INTERVAL_SECONDS": "9",
            "WORKER_LIMIT": "7",
            "WORKER_RETRY_DELAY_SECONDS": "3",
            "WORKER_LEASE_SECONDS": "42",
            "WORKER_CLEANUP_ENABLED": "true",
            "WORKER_CLEANUP_OLDER_THAN_HOURS": "12",
            "WORKER_CLEANUP_LIMIT": "11",
            "WORKER_CLEANUP_STATUSES": "failed,succeeded",
            "AGENT_API_KEY": "metadata-secret",
        },
    )

    response = client.get("/metadata")

    assert response.status_code == 200
    data = response.json()
    jobs = data["operations"]["jobs"]
    assert jobs["manual_cleanup_endpoint"] == "POST /jobs/cleanup"
    assert jobs["worker"]["command"] == "python -m app.worker"
    assert jobs["worker"]["interval_seconds"] == 9
    assert jobs["worker"]["limit"] == 7
    assert jobs["worker"]["retry_delay_seconds"] == 3
    assert jobs["worker"]["lease_seconds"] == 42
    assert jobs["worker"]["multiworker_claims"] is True
    assert jobs["retention"]["automatic_cleanup_enabled"] is True
    assert jobs["retention"]["older_than_hours"] == 12
    assert jobs["retention"]["limit"] == 11
    assert jobs["retention"]["statuses"] == ["failed", "succeeded"]
    assert jobs["retention"]["dry_run_default"] is True
    assert jobs["retention"]["terminal_statuses"] == ["failed", "succeeded"]
    assert jobs["schedules"] == {"interval": True, "cron": "basic", "event": True}
    assert "metadata-secret" not in json.dumps(data)
    assert "api_key" not in json.dumps(data).lower()


def test_generated_job_cleanup_previews_and_deletes_only_old_terminal_jobs(tmp_path):
    client = _client(tmp_path)

    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "cleanup-create"},
        json={"max_turns": 2},
    )
    session_id = create_resp.json()["session"]["session_id"]
    assert client.post(
        _path(f"/{session_id}/start"),
        headers={"Idempotency-Key": "cleanup-start"},
        json={},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "cleanup-turn"},
        json={"user_message": "Resposta para cleanup."},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/finish"),
        headers={"Idempotency-Key": "cleanup-finish"},
        json={},
    ).status_code == 200
    job_id = client.get(f"/jobs?session_id={session_id}").json()[0]["job_id"]
    assert client.post(f"/jobs/{job_id}/run").json()["job"]["status"] == "succeeded"

    from app.db import session_scope
    from app.models import AgentJob

    old_finished_at = datetime.now(timezone.utc) - timedelta(hours=240)
    with session_scope() as db:
        row = db.get(AgentJob, job_id)
        row.finished_at = old_finished_at
        row.started_at = old_finished_at - timedelta(seconds=1)

    invalid = client.post("/jobs/cleanup", json={"statuses": ["pending"], "dry_run": True})
    assert invalid.status_code == 400

    preview = client.post(
        "/jobs/cleanup",
        json={"session_id": session_id, "older_than_hours": 24, "dry_run": True},
    ).json()
    assert preview["dry_run"] is True
    assert preview["matched"] == 1
    assert preview["deleted"] == 0
    assert preview["job_ids"] == [job_id]
    assert preview["by_status"] == {"succeeded": 1}
    assert client.get(f"/jobs/{job_id}").status_code == 200

    cleanup = client.post(
        "/jobs/cleanup",
        json={"session_id": session_id, "older_than_hours": 24, "dry_run": False},
    ).json()
    assert cleanup["dry_run"] is False
    assert cleanup["matched"] == 1
    assert cleanup["deleted"] == 1
    assert cleanup["job_ids"] == [job_id]
    assert client.get(f"/jobs/{job_id}").status_code == 404
    assert client.get(_path(f"/{session_id}/transcript")).status_code == 200
    events = client.get(_path(f"/{session_id}/events")).json()
    cleanup_events = [item for item in events if item["event_type"] == "jobs_cleanup_completed"]
    assert cleanup_events[-1]["payload"]["deleted"] == 1
    assert cleanup_events[-1]["payload"]["job_ids"] == [job_id]


def test_generated_ollama_missing_model_returns_prescriptive_fallback(tmp_path, monkeypatch):
    class FakeResponses:
        def create(self, *args, **kwargs):
            raise RuntimeError("model 'qwen3:8b' not found, try pulling it first")

    class FakeOpenAI:
        def __init__(self, **kwargs):
            self.responses = FakeResponses()

    import app.llm as llm_module

    set_test_env(str(tmp_path / "generated.db"))
    os.environ["MOCK_LLM"] = "false"
    os.environ["LLM_ADAPTER"] = "ollama"
    os.environ["LLM_MODEL"] = "qwen3:8b"
    os.environ["OPENAI_API_KEY"] = ""
    os.environ["OPENAI_BASE_URL"] = "http://localhost:11434/v1"

    from app.settings import get_settings

    get_settings.cache_clear()
    monkeypatch.setattr(llm_module, "OpenAI", FakeOpenAI)
    result = llm_module.LLMClient(get_settings()).generate(
        system_prompt="Sistema de teste",
        user_message="Vamos testar o modelo local.",
        context={"session_id": "test-session"},
        recent_messages=[],
        adapter="ollama",
        model="qwen3:8b",
    )
    assert "ollama pull qwen3:8b" in result.text
    assert "docker compose --profile model-setup up ollama-pull-qwen3-8b" in result.text
    assert result.provider == "ollama"
    assert result.fallback_reason == "local_model_missing"
    assert result.setup_command == "ollama pull qwen3:8b"
    assert result.docker_setup_command == "docker compose --profile model-setup up ollama-pull-qwen3-8b"


def test_generated_turn_stream_emits_tokens_and_reuses_idempotency(tmp_path):
    client = _client(tmp_path)

    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "stream-create"},
        json={"max_turns": 2},
    )
    session_id = create_resp.json()["session"]["session_id"]
    assert client.post(
        _path(f"/{session_id}/start"),
        headers={"Idempotency-Key": "stream-start"},
        json={},
    ).status_code == 200

    payload = {"user_message": "Mensagem com stream."}
    with client.stream(
        "POST",
        _path(f"/{session_id}/turn/stream"),
        headers={"Idempotency-Key": "stream-turn"},
        json=payload,
    ) as stream:
        assert stream.status_code == 200
        assert stream.headers["content-type"].startswith("text/event-stream")
        stream_body = "".join(stream.iter_text())

    assert "event: turn_started" in stream_body
    assert "event: token" in stream_body
    assert "event: turn_completed" in stream_body
    assert "event: stream_closed" in stream_body
    assert '"source": "llm_callback"' in stream_body
    assert '"reason": "turn_completed"' in stream_body

    duplicate_turn = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "stream-turn"},
        json=payload,
    )
    assert duplicate_turn.status_code == 200
    assert duplicate_turn.json()["assistant_message"]["code"] == "ECHO"

    transcript = client.get(_path(f"/{session_id}/transcript")).json()
    assert [item["role"] for item in transcript].count("user") == 1
    assert [item["role"] for item in transcript].count("assistant") == 2
    events = client.get(_path(f"/{session_id}/events")).json()
    assert "llm_called" in [item["event_type"] for item in events]


def test_generated_turn_stream_ws_emits_events_and_reuses_idempotency(tmp_path):
    client = _client(tmp_path)

    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "ws-stream-create"},
        json={"max_turns": 2},
    )
    session_id = create_resp.json()["session"]["session_id"]
    assert client.post(
        _path(f"/{session_id}/start"),
        headers={"Idempotency-Key": "ws-stream-start"},
        json={},
    ).status_code == 200

    with client.websocket_connect(
        _path(f"/{session_id}/turn/stream/ws?user_message=Mensagem%20com%20stream%20WS.&idempotency_key=ws-turn-stream")
    ) as websocket:
        start_event = websocket.receive_json()
        events = [start_event]
        while True:
            item = websocket.receive_json()
            events.append(item)
            if item["event"] in {"turn_completed", "turn_error"}:
                break
        closed = websocket.receive_json() if events[-1]["event"] != "stream_closed" else None
        if closed is not None:
            events.append(closed)

    assert events[0]["event"] == "turn_started"
    assert any(item["event"] == "token" for item in events)
    assert any(item.get("data", {}).get("source") == "llm_callback" for item in events if item["event"] == "token")
    assert any(item["event"] in {"turn_completed", "turn_error"} for item in events)
    assert events[-1]["event"] == "stream_closed"
    assert any(item.get("data", {}).get("reason") == "turn_completed" for item in events if item["event"] == "stream_closed")


def test_generated_legacy_api_key_still_has_full_access(tmp_path):
    client = _client(
        tmp_path,
        env_overrides={
            "AUTH_ENABLED": "true",
            "AGENT_API_KEY": "legacy-key",
            "AGENT_API_KEYS": "",
        },
    )

    assert client.post(_path(), json={"max_turns": 2}).status_code == 403
    create_resp = client.post(
        _path(),
        headers={"X-Agent-API-Key": "legacy-key", "Idempotency-Key": "legacy-auth-create"},
        json={"max_turns": 2},
    )
    assert create_resp.status_code == 200
    assert client.get("/metadata", headers={"X-Agent-API-Key": "legacy-key"}).status_code == 200


def test_generated_scoped_api_keys_enforce_runtime_permissions(tmp_path):
    scoped_keys = (
        '{"reader-key":["metadata:read","sessions:read"],'
        '"operator-key":["sessions:*"],'
        '"job-reader-key":["jobs:read"]}'
    )
    client = _client(
        tmp_path,
        env_overrides={
            "AUTH_ENABLED": "true",
            "AGENT_API_KEY": "",
            "AGENT_API_KEYS": scoped_keys,
        },
    )

    assert client.get("/health").status_code == 200
    assert client.get("/metadata").status_code == 403
    assert client.get("/metadata", headers={"X-Agent-API-Key": "reader-key"}).status_code == 200
    assert client.post(
        _path(),
        headers={"X-Agent-API-Key": "reader-key"},
        json={"max_turns": 2},
    ).status_code == 403

    create_resp = client.post(
        _path(),
        headers={"X-Agent-API-Key": "operator-key", "Idempotency-Key": "scoped-auth-create"},
        json={"max_turns": 2},
    )
    assert create_resp.status_code == 200
    session_id = create_resp.json()["session"]["session_id"]

    assert client.get(
        _path(f"/{session_id}"),
        headers={"X-Agent-API-Key": "reader-key"},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/start"),
        headers={"X-Agent-API-Key": "reader-key"},
        json={},
    ).status_code == 403
    assert client.post(
        _path(f"/{session_id}/start"),
        headers={"X-Agent-API-Key": "operator-key", "Idempotency-Key": "scoped-auth-start"},
        json={},
    ).status_code == 200

    with client.stream(
        "GET",
        _path(f"/{session_id}/events/stream?from_seq=1&max_events=1"),
    ) as stream:
        assert stream.status_code == 403

    with client.stream(
        "GET",
        _path(f"/{session_id}/events/stream?from_seq=1&max_events=1&api_key=reader-key"),
    ) as stream:
        assert stream.status_code == 200

    with client.stream(
        "GET",
        _path(f"/{session_id}/events/stream?from_seq=1&max_events=1"),
        headers={"X-Agent-API-Key": "reader-key"},
    ) as stream:
        assert stream.status_code == 200

    with client.websocket_connect(
        _path(f"/{session_id}/events/ws?from_seq=1&max_events=1&api_key=reader-key")
    ) as websocket:
        assert websocket.receive_json()["event"] == "agent_event"

    assert client.get("/jobs/metrics", headers={"X-Agent-API-Key": "reader-key"}).status_code == 403
    assert client.get("/jobs/metrics", headers={"X-Agent-API-Key": "job-reader-key"}).status_code == 200
    assert client.post("/jobs/run-pending", headers={"X-Agent-API-Key": "job-reader-key"}).status_code == 403


def test_generated_agent_scoped_api_keys_are_limited_to_current_agent(tmp_path):
    scoped_keys = json.dumps(
        {
            "agent-reader-key": [
                f"agents:{AGENT_ID}:metadata:read",
                f"agents:{AGENT_ID}:sessions:read",
            ],
            "agent-operator-key": [f"agents:{AGENT_ID}:sessions:*"],
            "agent-auth-key": [f"agents:{AGENT_ID}:auth:read"],
            "other-agent-key": ["agents:other-agent:sessions:*", "agents:other-agent:metadata:read"],
        }
    )
    client = _client(
        tmp_path,
        env_overrides={
            "AUTH_ENABLED": "true",
            "AGENT_API_KEY": "",
            "AGENT_API_KEYS": scoped_keys,
        },
    )

    assert client.get("/metadata", headers={"X-Agent-API-Key": "agent-reader-key"}).status_code == 200
    assert client.get("/metadata", headers={"X-Agent-API-Key": "other-agent-key"}).status_code == 403
    assert client.post(
        _path(),
        headers={"X-Agent-API-Key": "other-agent-key"},
        json={"max_turns": 2},
    ).status_code == 403

    create_resp = client.post(
        _path(),
        headers={"X-Agent-API-Key": "agent-operator-key", "Idempotency-Key": "agent-scope-create"},
        json={"max_turns": 2},
    )
    assert create_resp.status_code == 200
    session_id = create_resp.json()["session"]["session_id"]

    assert client.get(
        _path(f"/{session_id}"),
        headers={"X-Agent-API-Key": "agent-reader-key"},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/start"),
        headers={"X-Agent-API-Key": "agent-reader-key"},
        json={},
    ).status_code == 403

    keys_resp = client.get("/auth/keys", headers={"X-Agent-API-Key": "agent-auth-key"})
    assert keys_resp.status_code == 200
    keys_payload = keys_resp.json()
    assert keys_payload["agent_id"] == AGENT_ID
    assert {item["key_id"] for item in keys_payload["keys"]} == {
        "key-1",
        "key-2",
        "key-3",
        "key-4",
    }
    assert "agent-reader-key" not in json.dumps(keys_payload)


def test_generated_api_keys_support_local_expiration_metadata(tmp_path):
    past = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    scoped_keys = json.dumps(
        {
            "keys": [
                {"id": "expired-reader", "key": "expired-reader-key", "scopes": ["metadata:read"], "expires_at": past},
                {"id": "active-reader", "key": "active-reader-key", "scopes": ["metadata:read"], "expires_at": future},
                {"id": "auth-viewer", "key": "auth-viewer-key", "scopes": ["auth:read"], "expiresAt": future},
            ]
        }
    )
    client = _client(
        tmp_path,
        env_overrides={
            "AUTH_ENABLED": "true",
            "AGENT_API_KEY": "",
            "AGENT_API_KEYS": scoped_keys,
        },
    )

    expired_resp = client.get("/metadata", headers={"X-Agent-API-Key": "expired-reader-key"})
    assert expired_resp.status_code == 403
    assert expired_resp.json()["detail"] == "Chave de API expirada."
    assert client.get("/metadata", headers={"X-Agent-API-Key": "active-reader-key"}).status_code == 200

    keys_resp = client.get("/auth/keys", headers={"X-Agent-API-Key": "auth-viewer-key"})
    assert keys_resp.status_code == 200
    keys_payload = keys_resp.json()
    by_id = {item["key_id"]: item for item in keys_payload["keys"]}
    assert by_id["expired-reader"]["expired"] is True
    assert by_id["active-reader"]["expired"] is False
    assert by_id["auth-viewer"]["expires_at"] == future
    assert "expired-reader-key" not in json.dumps(keys_payload)
    assert "active-reader-key" not in json.dumps(keys_payload)


def test_generated_api_keys_support_local_revocation_metadata(tmp_path):
    keys_path = tmp_path / "api-keys.json"
    revoked_path = tmp_path / "revoked-keys.json"
    keys_path.write_text(
        json.dumps(
            {
                "keys": [
                    {"id": "revoked-reader", "key": "revoked-reader-key", "scopes": ["metadata:read"]},
                    {"id": "active-reader", "key": "active-reader-key", "scopes": ["metadata:read"]},
                    {"id": "file-revoked", "key": "file-revoked-key", "scopes": ["metadata:read"]},
                    {"id": "auth-viewer", "key": "auth-viewer-key", "scopes": ["auth:read"]},
                ]
            }
        ),
        encoding="utf-8",
    )
    revoked_path.write_text(
        json.dumps({"revoked": ["AGENT_API_KEYS_PATH:file-revoked"]}),
        encoding="utf-8",
    )
    client = _client(
        tmp_path,
        env_overrides={
            "AUTH_ENABLED": "true",
            "AGENT_API_KEY": "",
            "AGENT_API_KEYS": "",
            "AGENT_API_KEYS_PATH": str(keys_path),
            "AGENT_API_REVOKED_KEY_IDS": '["revoked-reader"]',
            "AGENT_API_REVOKED_KEY_IDS_PATH": str(revoked_path),
        },
    )

    revoked_resp = client.get("/metadata", headers={"X-Agent-API-Key": "revoked-reader-key"})
    assert revoked_resp.status_code == 403
    assert revoked_resp.json()["detail"] == "Chave de API revogada."
    file_revoked_resp = client.get("/metadata", headers={"X-Agent-API-Key": "file-revoked-key"})
    assert file_revoked_resp.status_code == 403
    assert file_revoked_resp.json()["detail"] == "Chave de API revogada."
    assert client.get("/metadata", headers={"X-Agent-API-Key": "active-reader-key"}).status_code == 200

    keys_resp = client.get("/auth/keys", headers={"X-Agent-API-Key": "auth-viewer-key"})
    assert keys_resp.status_code == 200
    keys_payload = keys_resp.json()
    by_id = {item["key_id"]: item for item in keys_payload["keys"]}
    assert keys_payload["revocation"]["configured"] is True
    assert keys_payload["revocation"]["total"] == 2
    assert keys_payload["revocation"]["file"]["exists"] is True
    assert by_id["revoked-reader"]["revoked"] is True
    assert by_id["file-revoked"]["revoked"] is True
    assert by_id["active-reader"]["revoked"] is False
    assert "revoked-reader-key" not in json.dumps(keys_payload)
    assert "file-revoked-key" not in json.dumps(keys_payload)
    assert "active-reader-key" not in json.dumps(keys_payload)


def test_generated_api_keys_file_supports_local_rotation_without_restart(tmp_path):
    keys_path = tmp_path / "api-keys.json"
    keys_path.write_text(
        json.dumps(
            {
                "keys": [
                    {"id": "reader", "key": "reader-file-key", "scopes": ["metadata:read", "auth:read"]},
                    {"id": "operator-v1", "key": "operator-v1-key", "scopes": ["sessions:*"]},
                    {"id": "disabled", "key": "disabled-key", "scopes": ["*"], "enabled": False},
                ]
            }
        ),
        encoding="utf-8",
    )
    client = _client(
        tmp_path,
        env_overrides={
            "AUTH_ENABLED": "true",
            "AGENT_API_KEY": "",
            "AGENT_API_KEYS": "",
            "AGENT_API_KEYS_PATH": str(keys_path),
        },
    )

    assert client.get("/metadata", headers={"X-Agent-API-Key": "reader-file-key"}).status_code == 200
    assert client.post(_path(), headers={"X-Agent-API-Key": "reader-file-key"}, json={"max_turns": 2}).status_code == 403
    assert client.post(_path(), headers={"X-Agent-API-Key": "disabled-key"}, json={"max_turns": 2}).status_code == 403

    keys_resp = client.get("/auth/keys", headers={"X-Agent-API-Key": "reader-file-key"})
    assert keys_resp.status_code == 200
    key_status = keys_resp.json()
    assert key_status["total"] == 2
    assert key_status["sources"]["AGENT_API_KEYS_PATH"] == 2
    assert key_status["file"]["exists"] is True
    assert {item["key_id"] for item in key_status["keys"]} == {"reader", "operator-v1"}
    assert "reader-file-key" not in json.dumps(key_status)
    assert "operator-v1-key" not in json.dumps(key_status)

    create_v1 = client.post(
        _path(),
        headers={"X-Agent-API-Key": "operator-v1-key", "Idempotency-Key": "file-auth-create-v1"},
        json={"max_turns": 2},
    )
    assert create_v1.status_code == 200

    keys_path.write_text(
        json.dumps(
            {
                "keys": [
                    {"id": "reader", "key": "reader-file-key", "scopes": ["metadata:read", "auth:read"]},
                    {"id": "operator-v2", "key": "operator-v2-key", "scopes": ["sessions:*"]},
                ]
            }
        ),
        encoding="utf-8",
    )

    assert client.post(
        _path(),
        headers={"X-Agent-API-Key": "operator-v1-key", "Idempotency-Key": "file-auth-create-old"},
        json={"max_turns": 2},
    ).status_code == 403
    create_v2 = client.post(
        _path(),
        headers={"X-Agent-API-Key": "operator-v2-key", "Idempotency-Key": "file-auth-create-v2"},
        json={"max_turns": 2},
    )
    assert create_v2.status_code == 200

    rotated = client.get("/auth/keys", headers={"X-Agent-API-Key": "reader-file-key"}).json()
    assert {item["key_id"] for item in rotated["keys"]} == {"reader", "operator-v2"}
    assert "operator-v1-key" not in json.dumps(rotated)
    assert "operator-v2-key" not in json.dumps(rotated)


def test_generated_auth_rate_limit_and_audit_log(tmp_path):
    scoped_keys = '{"reader-key":["metadata:read"],"audit-key":["metadata:read"]}'
    audit_path = tmp_path / "auth-audit.jsonl"
    client = _client(
        tmp_path,
        env_overrides={
            "AUTH_ENABLED": "true",
            "AGENT_API_KEY": "",
            "AGENT_API_KEYS": scoped_keys,
            "AUTH_RATE_LIMIT_ENABLED": "true",
            "AUTH_RATE_LIMIT_REQUESTS": "2",
            "AUTH_RATE_LIMIT_WINDOW_SECONDS": "60",
            "AUTH_AUDIT_ENABLED": "true",
            "AUTH_AUDIT_PATH": str(audit_path),
        },
    )

    assert client.get("/metadata").status_code == 403
    assert client.get("/metadata", headers={"X-Agent-API-Key": "reader-key"}).status_code == 200
    assert client.get("/metadata", headers={"X-Agent-API-Key": "reader-key"}).status_code == 200
    limited = client.get("/metadata", headers={"X-Agent-API-Key": "reader-key"})
    assert limited.status_code == 429

    audit_resp = client.get("/auth/audit?limit=20", headers={"X-Agent-API-Key": "audit-key"})
    assert audit_resp.status_code == 200
    audit = audit_resp.json()
    assert audit["persistent"] is True
    assert audit["path"] == str(audit_path)
    statuses = [entry["status"] for entry in audit["entries"]]
    assert "allowed" in statuses
    assert "rejected" in statuses
    assert "rate_limited" in statuses
    assert any(entry["key_id"] == "key-1" and entry["status"] == "rate_limited" for entry in audit["entries"])
    assert all("reader-key" not in json.dumps(entry) for entry in audit["entries"])
    persisted = [json.loads(line) for line in audit_path.read_text(encoding="utf-8").splitlines()]
    assert len(persisted) >= 3
    assert any(entry["status"] == "rate_limited" for entry in persisted)
    assert all("reader-key" not in json.dumps(entry) for entry in persisted)

    reloaded = _client(
        tmp_path,
        env_overrides={
            "AUTH_ENABLED": "true",
            "AGENT_API_KEY": "",
            "AGENT_API_KEYS": scoped_keys,
            "AUTH_AUDIT_ENABLED": "true",
            "AUTH_AUDIT_PATH": str(audit_path),
        },
    )
    reloaded_audit = reloaded.get("/auth/audit?limit=20", headers={"X-Agent-API-Key": "audit-key"}).json()
    assert reloaded_audit["total"] >= audit["total"]
    assert any(entry["status"] == "rate_limited" for entry in reloaded_audit["entries"])


def test_generated_worker_processes_pending_jobs(tmp_path):
    client = _client(tmp_path)

    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "worker-create"},
        json={"max_turns": 2},
    )
    session_id = create_resp.json()["session"]["session_id"]
    assert client.post(
        _path(f"/{session_id}/start"),
        headers={"Idempotency-Key": "worker-start"},
        json={},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "worker-turn"},
        json={"user_message": "Resposta para gerar job."},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/finish"),
        headers={"Idempotency-Key": "worker-finish"},
        json={},
    ).status_code == 200

    pending_jobs = client.get(f"/jobs?session_id={session_id}").json()
    assert len(pending_jobs) == 1
    assert pending_jobs[0]["status"] == "pending"

    from app.worker import build_worker_service, process_pending_jobs

    result = process_pending_jobs(build_worker_service(), limit=5)
    assert result == {"processed": 1, "failed": 0, "retried": 0, "pending_seen": 1}

    jobs = client.get(f"/jobs?session_id={session_id}").json()
    assert jobs[0]["status"] == "succeeded"
    completed_events = client.get(_path(f"/{session_id}/events")).json()
    assert "post_finish_completed" in [item["event_type"] for item in completed_events]


def test_generated_worker_can_run_governed_cleanup_policy(tmp_path):
    client = _client(tmp_path)

    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "worker-cleanup-create"},
        json={"max_turns": 2},
    )
    session_id = create_resp.json()["session"]["session_id"]
    assert client.post(
        _path(f"/{session_id}/start"),
        headers={"Idempotency-Key": "worker-cleanup-start"},
        json={},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "worker-cleanup-turn"},
        json={"user_message": "Resposta para limpeza automatica."},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/finish"),
        headers={"Idempotency-Key": "worker-cleanup-finish"},
        json={},
    ).status_code == 200
    job_id = client.get(f"/jobs?session_id={session_id}").json()[0]["job_id"]

    from app.worker import build_worker_service, process_pending_jobs

    run_result = process_pending_jobs(build_worker_service(), limit=5)
    assert run_result == {"processed": 1, "failed": 0, "retried": 0, "pending_seen": 1}

    from app.db import session_scope
    from app.models import AgentJob

    old_finished_at = datetime.now(timezone.utc) - timedelta(hours=240)
    with session_scope() as db:
        row = db.get(AgentJob, job_id)
        row.finished_at = old_finished_at
        row.started_at = old_finished_at - timedelta(seconds=1)

    idle_result = process_pending_jobs(build_worker_service(), limit=5)
    assert idle_result == {"processed": 0, "failed": 0, "retried": 0, "pending_seen": 0}
    assert client.get(f"/jobs/{job_id}").status_code == 200

    cleanup_result = process_pending_jobs(
        build_worker_service(),
        limit=5,
        cleanup_enabled=True,
        cleanup_older_than_hours=24,
        cleanup_limit=10,
        cleanup_statuses=["succeeded"],
    )
    assert cleanup_result["processed"] == 0
    assert cleanup_result["failed"] == 0
    assert cleanup_result["retried"] == 0
    assert cleanup_result["pending_seen"] == 0
    assert cleanup_result["cleanup"]["dry_run"] is False
    assert cleanup_result["cleanup"]["matched"] == 1
    assert cleanup_result["cleanup"]["deleted"] == 1
    assert cleanup_result["cleanup"]["job_ids"] == [job_id]
    assert cleanup_result["cleanup"]["by_status"] == {"succeeded": 1}
    assert client.get(f"/jobs/{job_id}").status_code == 404
    events = client.get(_path(f"/{session_id}/events")).json()
    cleanup_events = [item for item in events if item["event_type"] == "jobs_cleanup_completed"]
    assert cleanup_events[-1]["payload"]["deleted"] == 1
    assert cleanup_events[-1]["payload"]["job_ids"] == [job_id]


def test_generated_job_claim_lease_prevents_duplicate_multiworker_and_allows_takeover(tmp_path):
    client = _client(tmp_path)

    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "lease-create"},
        json={"max_turns": 2},
    )
    session_id = create_resp.json()["session"]["session_id"]
    assert client.post(_path(f"/{session_id}/start"), headers={"Idempotency-Key": "lease-start"}, json={}).status_code == 200
    assert client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "lease-turn"},
        json={"user_message": "Resposta para testar lease."},
    ).status_code == 200
    assert client.post(_path(f"/{session_id}/finish"), headers={"Idempotency-Key": "lease-finish"}, json={}).status_code == 200

    pending = client.get(f"/jobs?session_id={session_id}").json()
    assert len(pending) == 1
    job_id = pending[0]["job_id"]

    from app import repo
    from app.db import session_scope
    from app.worker import build_worker_service

    with session_scope() as db:
        first_claim = repo.claim_due_jobs(db, worker_id="worker-a", lease_seconds=60, limit=5)
        assert [job.job_id for job in first_claim] == [job_id]
        assert first_claim[0].status == "running"
        assert first_claim[0].locked_by == "worker-a"
        assert first_claim[0].locked_until is not None
        assert int(first_claim[0].attempts or 0) == 1

    active_metrics = client.get("/jobs/metrics").json()
    assert active_metrics["leased_running"] == 1
    assert active_metrics["expired_leases"] == 0

    duplicate = client.post("/jobs/run-pending?worker_id=worker-b&lease_seconds=60&limit=5").json()
    assert duplicate["total"] == 0
    assert duplicate["succeeded"] == 0

    service = build_worker_service()
    with session_scope() as db:
        try:
            service.run_job(db, job_id, worker_id="worker-b")
        except Exception as exc:
            assert getattr(exc, "status_code", None) == 409
        else:
            raise AssertionError("Worker diferente não deve executar job com lease ativo.")

    with session_scope() as db:
        row = repo.get_job_for_update(db, job_id)
        row.locked_until = datetime.now(timezone.utc) - timedelta(seconds=1)

    expired_metrics = client.get("/jobs/metrics").json()
    assert expired_metrics["expired_leases"] == 1

    with session_scope() as db:
        takeover = repo.claim_due_jobs(db, worker_id="worker-b", lease_seconds=60, limit=5)
        assert [job.job_id for job in takeover] == [job_id]
        assert takeover[0].locked_by == "worker-b"
        assert int(takeover[0].attempts or 0) == 2

    with session_scope() as db:
        completed = service.run_job(db, job_id, worker_id="worker-b")["job"]
        assert completed["status"] == "succeeded"
        assert completed["locked_by"] is None
        assert completed["locked_until"] is None


def test_generated_job_batch_endpoints_run_pending_jobs(tmp_path):
    client = _client(tmp_path)

    for index in range(2):
        create_resp = client.post(
            _path(),
            headers={"Idempotency-Key": f"batch-create-{index}"},
            json={"max_turns": 2},
        )
        session_id = create_resp.json()["session"]["session_id"]
        assert client.post(
            _path(f"/{session_id}/start"),
            headers={"Idempotency-Key": f"batch-start-{index}"},
            json={},
        ).status_code == 200
        assert client.post(
            _path(f"/{session_id}/turn"),
            headers={"Idempotency-Key": f"batch-turn-{index}"},
            json={"user_message": f"Resposta para batch {index}."},
        ).status_code == 200
        assert client.post(
            _path(f"/{session_id}/finish"),
            headers={"Idempotency-Key": f"batch-finish-{index}"},
            json={},
        ).status_code == 200

    pending_jobs = client.get("/jobs?status=pending").json()
    assert len(pending_jobs) == 2

    batch = client.post("/jobs/run-pending?limit=10").json()
    assert batch["total"] == 2
    assert batch["succeeded"] == 2
    assert batch["failed"] == 0
    assert len(batch["jobs"]) == 2
    assert {job["status"] for job in batch["jobs"]} == {"succeeded"}
    metrics = client.get("/jobs/metrics").json()
    assert metrics["by_status"]["succeeded"] == 2
    assert metrics["succeeded"] == 2
    assert metrics["terminal"] == 2
    assert metrics["success_rate"] == 1
    assert metrics["finished_in_window"] == 2
    assert metrics["throughput_per_hour"] >= 2
    assert metrics["finished_last_hour"] == 2


def test_generated_worker_retries_and_exposes_manual_retry(tmp_path):
    client = _client(tmp_path)

    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "worker-retry-create"},
        json={"max_turns": 2},
    )
    session_id = create_resp.json()["session"]["session_id"]
    assert client.post(
        _path(f"/{session_id}/start"),
        headers={"Idempotency-Key": "worker-retry-start"},
        json={},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "worker-retry-turn"},
        json={"user_message": "Resposta para gerar job com retry."},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/finish"),
        headers={"Idempotency-Key": "worker-retry-finish"},
        json={},
    ).status_code == 200
    job_id = client.get(f"/jobs?session_id={session_id}").json()[0]["job_id"]

    class FailingService:
        def run_job(self, db, job_id):
            raise RuntimeError("boom")

    from app.worker import process_pending_jobs

    first = process_pending_jobs(FailingService(), limit=5, retry_delay_seconds=0)
    assert first == {"processed": 0, "failed": 0, "retried": 1, "pending_seen": 1}
    job = client.get(f"/jobs/{job_id}").json()
    assert job["status"] == "pending"
    assert job["attempts"] == 1
    assert job["last_error"]["error"] == "boom"
    assert job["next_run_at"] is not None

    second = process_pending_jobs(FailingService(), limit=5, retry_delay_seconds=0)
    assert second == {"processed": 0, "failed": 0, "retried": 1, "pending_seen": 1}
    third = process_pending_jobs(FailingService(), limit=5, retry_delay_seconds=0)
    assert third == {"processed": 0, "failed": 1, "retried": 0, "pending_seen": 1}
    failed_job = client.get(f"/jobs/{job_id}").json()
    assert failed_job["status"] == "failed"
    assert failed_job["attempts"] == 3
    failed_metrics = client.get("/jobs/metrics").json()
    assert failed_metrics["failed"] == 1
    assert failed_metrics["exhausted"] == 1
    assert failed_metrics["attempts_total"] == 3
    assert failed_metrics["terminal"] == 1
    assert failed_metrics["success_rate"] == 0
    assert failed_metrics["duration_ms_avg"] is not None

    batch_retry = client.post(f"/jobs/retry-failed?session_id={session_id}").json()
    assert batch_retry["total"] == 1
    assert batch_retry["succeeded"] == 1
    assert batch_retry["failed"] == 0
    assert batch_retry["jobs"][0]["status"] == "pending"

    retry = client.post(f"/jobs/{job_id}/retry").json()["job"]
    assert retry["status"] == "pending"
    assert retry["attempts"] == 0
    assert retry["last_error"] == {}
    retry_metrics = client.get("/jobs/metrics").json()
    assert retry_metrics["by_status"]["pending"] == 1
    assert retry_metrics["pending_due"] == 1
    assert retry_metrics["oldest_pending_at"] is not None
    assert retry_metrics["next_due_at"] is not None
    retry_events = client.get(_path(f"/{session_id}/events")).json()
    assert "post_finish_retry_scheduled" in [item["event_type"] for item in retry_events]
    assert "post_finish_failed" in [item["event_type"] for item in retry_events]
    assert "post_finish_retry_requested" in [item["event_type"] for item in retry_events]


def test_generated_job_schedule_endpoint_delays_due_work(tmp_path):
    client = _client(tmp_path)

    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "schedule-create"},
        json={"max_turns": 2},
    )
    session_id = create_resp.json()["session"]["session_id"]
    assert client.post(
        _path(f"/{session_id}/start"),
        headers={"Idempotency-Key": "schedule-start"},
        json={},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "schedule-turn"},
        json={"user_message": "Resposta para agendar job."},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/finish"),
        headers={"Idempotency-Key": "schedule-finish"},
        json={},
    ).status_code == 200
    job_id = client.get(f"/jobs?session_id={session_id}").json()[0]["job_id"]

    scheduled = client.post(f"/jobs/{job_id}/schedule", json={"delay_seconds": 3600}).json()["job"]
    assert scheduled["status"] == "pending"
    assert scheduled["next_run_at"] is not None
    metrics = client.get("/jobs/metrics").json()
    assert metrics["pending_due"] == 0
    assert metrics["next_due_at"] == scheduled["next_run_at"]

    from app.worker import build_worker_service, process_pending_jobs

    future_result = process_pending_jobs(build_worker_service(), limit=5)
    assert future_result == {"processed": 0, "failed": 0, "retried": 0, "pending_seen": 0}
    assert client.get(f"/jobs/{job_id}").json()["status"] == "pending"

    due = client.post(f"/jobs/{job_id}/schedule", json={"delay_seconds": 0}).json()["job"]
    assert due["status"] == "pending"
    due_metrics = client.get("/jobs/metrics").json()
    assert due_metrics["pending_due"] == 1

    due_result = process_pending_jobs(build_worker_service(), limit=5)
    assert due_result == {"processed": 1, "failed": 0, "retried": 0, "pending_seen": 1}
    assert client.get(f"/jobs/{job_id}").json()["status"] == "succeeded"
    events = client.get(_path(f"/{session_id}/events")).json()
    assert "post_finish_scheduled" in [item["event_type"] for item in events]


def test_generated_recurring_job_schedule_enqueues_due_work(tmp_path):
    client = _client(tmp_path)

    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "recurrence-create"},
        json={"max_turns": 2},
    )
    session_id = create_resp.json()["session"]["session_id"]
    assert client.post(
        _path(f"/{session_id}/start"),
        headers={"Idempotency-Key": "recurrence-start"},
        json={},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "recurrence-turn"},
        json={"user_message": "Resposta para job recorrente."},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/finish"),
        headers={"Idempotency-Key": "recurrence-finish"},
        json={},
    ).status_code == 200
    source_job_id = client.get(f"/jobs?session_id={session_id}").json()[0]["job_id"]
    assert client.post(f"/jobs/{source_job_id}/run").json()["job"]["status"] == "succeeded"

    created = client.post(
        f"/jobs/{source_job_id}/recurrence",
        json={"interval_seconds": 3600, "delay_seconds": 0},
    ).json()["schedule"]
    schedule_id = created["schedule_id"]
    assert created["status"] == "enabled"
    assert created["payload"]["recurrence"]["source_job_id"] == source_job_id
    assert created["next_run_at"] is not None
    schedules = client.get(f"/job-schedules?session_id={session_id}").json()
    assert [item["schedule_id"] for item in schedules] == [schedule_id]

    from app.worker import build_worker_service, process_pending_jobs

    worker_result = process_pending_jobs(build_worker_service(), limit=5)
    assert worker_result == {"processed": 1, "failed": 0, "retried": 0, "pending_seen": 1}
    refreshed = client.get(f"/job-schedules?session_id={session_id}").json()[0]
    assert refreshed["last_job_id"] is not None
    assert refreshed["last_job_id"] != source_job_id
    assert refreshed["next_run_at"] != created["next_run_at"]
    generated_job = client.get(f"/jobs/{refreshed['last_job_id']}").json()
    assert generated_job["status"] == "succeeded"
    assert generated_job["payload"]["schedule_id"] == schedule_id
    assert generated_job["payload"]["source"] == "job_schedule"

    second = client.post(
        f"/jobs/{source_job_id}/recurrence",
        json={"interval_seconds": 3600, "delay_seconds": 0},
    ).json()["schedule"]
    batch = client.post("/job-schedules/run-due?limit=5").json()
    assert batch["total"] == 1
    assert batch["enqueued"] == 1
    assert batch["schedules"][0]["schedule_id"] == second["schedule_id"]
    assert batch["jobs"][0]["payload"]["schedule_id"] == second["schedule_id"]

    disabled = client.post(f"/job-schedules/{second['schedule_id']}/disable").json()["schedule"]
    assert disabled["status"] == "disabled"
    disabled_list = client.get("/job-schedules?status=disabled").json()
    assert second["schedule_id"] in [item["schedule_id"] for item in disabled_list]
    events = client.get(_path(f"/{session_id}/events")).json()
    event_types = [item["event_type"] for item in events]
    assert "job_schedule_created" in event_types
    assert "job_schedule_enqueued" in event_types
    assert "job_schedule_disabled" in event_types


def test_generated_event_job_schedule_enqueues_only_when_event_is_triggered(tmp_path):
    client = _client(tmp_path)

    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "event-create"},
        json={"max_turns": 2},
    )
    session_id = create_resp.json()["session"]["session_id"]
    assert client.post(
        _path(f"/{session_id}/start"),
        headers={"Idempotency-Key": "event-start"},
        json={},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "event-turn"},
        json={"user_message": "Resposta para evento."},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/finish"),
        headers={"Idempotency-Key": "event-finish"},
        json={},
    ).status_code == 200
    source_job_id = client.get(f"/jobs?session_id={session_id}").json()[0]["job_id"]
    assert client.post(f"/jobs/{source_job_id}/run").json()["job"]["status"] == "succeeded"

    invalid = client.post(
        f"/jobs/{source_job_id}/recurrence",
        json={"trigger_type": "event", "event_type": "post finish"},
    )
    assert invalid.status_code == 400

    created = client.post(
        f"/jobs/{source_job_id}/recurrence",
        json={"trigger_type": "event", "event_type": "session.finished"},
    ).json()["schedule"]
    assert created["trigger_type"] == "event"
    assert created["cron_expression"] == "session.finished"
    assert created["event_type"] == "session.finished"
    assert created["next_run_at"] is None
    assert created["payload"]["recurrence"]["event_type"] == "session.finished"

    due_batch = client.post("/job-schedules/run-due?limit=5").json()
    assert due_batch["total"] == 0
    assert due_batch["enqueued"] == 0

    wrong_event = client.post(
        "/job-schedules/trigger-event",
        json={"event_type": "session.started", "session_id": session_id},
    ).json()
    assert wrong_event["total"] == 0
    assert wrong_event["enqueued"] == 0

    batch = client.post(
        "/job-schedules/trigger-event",
        json={
            "event_type": "session.finished",
            "session_id": session_id,
            "payload": {"reason": "manual", "api_key": "should-not-persist"},
        },
    ).json()
    assert batch["total"] == 1
    assert batch["enqueued"] == 1
    assert batch["schedules"][0]["schedule_id"] == created["schedule_id"]
    assert batch["schedules"][0]["event_type"] == "session.finished"
    assert batch["schedules"][0]["next_run_at"] is None
    event_job = batch["jobs"][0]
    assert event_job["payload"]["source"] == "job_event"
    assert event_job["payload"]["schedule_trigger_type"] == "event"
    assert event_job["payload"]["schedule_event_type"] == "session.finished"
    assert event_job["payload"]["event_payload"] == {"reason": "manual", "api_key": "[redacted]"}

    from app.worker import build_worker_service, process_pending_jobs

    worker_result = process_pending_jobs(build_worker_service(), limit=5)
    assert worker_result == {"processed": 1, "failed": 0, "retried": 0, "pending_seen": 1}
    assert client.get(f"/jobs/{event_job['job_id']}").json()["status"] == "succeeded"
    events = client.get(_path(f"/{session_id}/events")).json()
    event_types = [item["event_type"] for item in events]
    assert "job_schedule_event_triggered" in event_types
    event_payloads = [item["payload"] for item in events if item["event_type"] == "job_schedule_event_triggered"]
    assert event_payloads[-1]["payload_keys"] == ["api_key", "reason"]


def test_generated_cron_job_schedule_uses_cron_expression(tmp_path):
    client = _client(tmp_path)

    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "cron-create"},
        json={"max_turns": 2},
    )
    session_id = create_resp.json()["session"]["session_id"]
    assert client.post(
        _path(f"/{session_id}/start"),
        headers={"Idempotency-Key": "cron-start"},
        json={},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "cron-turn"},
        json={"user_message": "Resposta para cron."},
    ).status_code == 200
    assert client.post(
        _path(f"/{session_id}/finish"),
        headers={"Idempotency-Key": "cron-finish"},
        json={},
    ).status_code == 200
    source_job_id = client.get(f"/jobs?session_id={session_id}").json()[0]["job_id"]
    assert client.post(f"/jobs/{source_job_id}/run").json()["job"]["status"] == "succeeded"

    invalid = client.post(
        f"/jobs/{source_job_id}/recurrence",
        json={"trigger_type": "cron", "cron_expression": "invalid"},
    )
    assert invalid.status_code == 400

    created = client.post(
        f"/jobs/{source_job_id}/recurrence",
        json={
            "trigger_type": "cron",
            "cron_expression": "0 9 * * *",
            "run_at": "2026-01-01T00:00:00+00:00",
        },
    ).json()["schedule"]
    assert created["trigger_type"] == "cron"
    assert created["cron_expression"] == "0 9 * * *"
    assert created["payload"]["recurrence"]["cron_expression"] == "0 9 * * *"

    from app.worker import build_worker_service, process_pending_jobs

    worker_result = process_pending_jobs(build_worker_service(), limit=5)
    assert worker_result == {"processed": 1, "failed": 0, "retried": 0, "pending_seen": 1}
    refreshed = client.get(f"/job-schedules?session_id={session_id}").json()[0]
    assert refreshed["trigger_type"] == "cron"
    assert refreshed["cron_expression"] == "0 9 * * *"
    assert refreshed["last_job_id"] is not None
    assert refreshed["next_run_at"] != created["next_run_at"]
    generated_job = client.get(f"/jobs/{refreshed['last_job_id']}").json()
    assert generated_job["payload"]["schedule_trigger_type"] == "cron"
    assert generated_job["payload"]["schedule_cron_expression"] == "0 9 * * *"
    events = client.get(_path(f"/{session_id}/events")).json()
    assert "job_schedule_enqueued" in [item["event_type"] for item in events]


def test_generated_compose_includes_worker_service():
    compose = (Path(__file__).resolve().parents[1] / "docker-compose.yml").read_text(encoding="utf-8")
    assert "  worker:" in compose
    assert 'command: ["python", "-m", "app.worker"]' in compose
    assert "WORKER_INTERVAL_SECONDS:" in compose
    assert "WORKER_LIMIT:" in compose
    assert "WORKER_RETRY_DELAY_SECONDS:" in compose
    assert "WORKER_LEASE_SECONDS:" in compose
    assert "WORKER_CLEANUP_ENABLED:" in compose
    assert "WORKER_CLEANUP_OLDER_THAN_HOURS:" in compose
    assert "WORKER_CLEANUP_LIMIT:" in compose
    assert "WORKER_CLEANUP_STATUSES:" in compose


def test_generated_runtime_idempotency_conflict_and_safety(tmp_path):
    client = _client(tmp_path)

    first = client.post(
        _path(),
        headers={"Idempotency-Key": "create-conflict"},
        json={"metadata": {"source": "one"}, "max_turns": 2},
    )
    assert first.status_code == 200

    second = client.post(
        _path(),
        headers={"Idempotency-Key": "create-conflict"},
        json={"metadata": {"source": "two"}, "max_turns": 2},
    )
    assert second.status_code == 409

    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "safe-create"},
        json={"max_turns": 3},
    )
    session_id = create_resp.json()["session"]["session_id"]
    assert client.post(
        _path(f"/{session_id}/start"),
        headers={"Idempotency-Key": "safe-start"},
        json={},
    ).status_code == 200

    risk_resp = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "safe-risk"},
        json={"user_message": "Eu vou me matar hoje."},
    )
    assert risk_resp.status_code == 200
    data = risk_resp.json()
    assert data["safety"]["blocked"] is True
    assert data["safety"]["category"] == "self_harm"
    assert data["session"]["status"] == "completed"

    events = client.get(_path(f"/{session_id}/events")).json()
    assert "llm_called" not in [item["event_type"] for item in events]


def test_generated_external_safety_provider_blocks_when_local_allows(tmp_path, monkeypatch):
    calls = []

    class ProviderResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def read(self, limit=-1):
            return json.dumps({
                "blocked": True,
                "decision": "safe_redirect",
                "category": "external_policy",
                "reason": "Provider externo bloqueou.",
                "safeResponse": "Resposta segura do provider.",
                "severity": "critical",
                "score": 0.98,
            }).encode("utf-8")

    def fake_urlopen(request, timeout):
        calls.append({
            "url": request.full_url,
            "timeout": timeout,
            "body": json.loads(request.data.decode("utf-8")),
        })
        return ProviderResponse()

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    client = _client(tmp_path, {
        "SAFETY_PROVIDER_ENABLED": "true",
        "SAFETY_PROVIDER_URL": "http://safety.local/evaluate",
        "SAFETY_PROVIDER_TIMEOUT_SECONDS": "1",
    })

    create_resp = client.post(_path(), headers={"Idempotency-Key": "external-safe-create"}, json={"max_turns": 2})
    session_id = create_resp.json()["session"]["session_id"]
    assert client.post(_path(f"/{session_id}/start"), headers={"Idempotency-Key": "external-safe-start"}, json={}).status_code == 200

    turn_resp = client.post(
        _path(f"/{session_id}/turn"),
        headers={"Idempotency-Key": "external-safe-turn"},
        json={"user_message": "Mensagem comum sem regra local."},
    )
    assert turn_resp.status_code == 200
    data = turn_resp.json()
    assert data["assistant_message"] == {"code": "SEG", "text": "Resposta segura do provider."}
    assert data["safety"]["blocked"] is True
    assert data["safety"]["category"] == "external_policy"
    assert data["safety"]["source"] == "external"
    assert data["safety"]["provider_score"] == 0.98
    assert calls[0]["url"] == "http://safety.local/evaluate"
    assert calls[0]["body"]["stage"] == "input"
    assert calls[0]["body"]["nodeId"] == "input_safety_check"

    events = client.get(_path(f"/{session_id}/events")).json()
    assert "llm_called" not in [item["event_type"] for item in events]
`;
}

function renderMigration(): string {
  return `CREATE TABLE IF NOT EXISTS agent_sessions (
  session_id VARCHAR PRIMARY KEY,
  agent_id VARCHAR NOT NULL,
  status VARCHAR NOT NULL,
  phase VARCHAR NOT NULL,
  turn INTEGER NOT NULL DEFAULT 0,
  max_turns INTEGER NOT NULL DEFAULT 3,
  metadata_json JSON,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS agent_messages (
  message_id VARCHAR PRIMARY KEY,
  session_id VARCHAR NOT NULL REFERENCES agent_sessions(session_id),
  seq INTEGER NOT NULL,
  role VARCHAR NOT NULL,
  code VARCHAR NULL,
  content TEXT NOT NULL,
  metadata_json JSON,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_agent_message_seq UNIQUE (session_id, seq)
);

CREATE TABLE IF NOT EXISTS agent_events (
  event_id VARCHAR PRIMARY KEY,
  agent_id VARCHAR NOT NULL,
  session_id VARCHAR NOT NULL REFERENCES agent_sessions(session_id),
  seq INTEGER NOT NULL,
  event_type VARCHAR NOT NULL,
  node VARCHAR NULL,
  payload JSON,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_agent_event_seq UNIQUE (session_id, seq)
);

CREATE TABLE IF NOT EXISTS agent_node_records (
  record_id VARCHAR PRIMARY KEY,
  session_id VARCHAR NOT NULL,
  node_id VARCHAR NOT NULL,
  payload_json JSON NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_jobs (
  job_id VARCHAR PRIMARY KEY,
  agent_id VARCHAR NOT NULL,
  session_id VARCHAR NOT NULL REFERENCES agent_sessions(session_id),
  kind VARCHAR NOT NULL,
  status VARCHAR NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  payload_json JSON,
  result_json JSON,
  last_error_json JSON,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  next_run_at TIMESTAMPTZ NULL,
  locked_by VARCHAR NULL,
  locked_until TIMESTAMPTZ NULL,
  lock_acquired_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS agent_job_schedules (
  schedule_id VARCHAR PRIMARY KEY,
  agent_id VARCHAR NOT NULL,
  session_id VARCHAR NOT NULL REFERENCES agent_sessions(session_id),
  kind VARCHAR NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'enabled',
  trigger_type VARCHAR NOT NULL DEFAULT 'interval',
  interval_seconds INTEGER NOT NULL,
  cron_expression VARCHAR NULL,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  payload_json JSON,
  last_job_id VARCHAR NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_run_at TIMESTAMPTZ NULL,
  next_run_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  record_id VARCHAR PRIMARY KEY,
  idempotency_key VARCHAR NOT NULL,
  operation VARCHAR NOT NULL,
  request_hash VARCHAR NOT NULL,
  status_code INTEGER NOT NULL,
  response_json JSON NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_idempotency_operation_key UNIQUE (operation, idempotency_key)
);
`;
}
