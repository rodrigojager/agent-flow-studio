import { findLlmAdapter, isSupportedLlmAdapter, type AgentFlow } from "@agent-flow-builder/flow-spec";

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
  handler?: string;
  codeLanguage?: string;
  codeExecution?: string;
  codePath?: string;
  codeInline?: string;
  codeEntry?: string;
  codeDependencies?: string;
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
    handler: node.handler,
    codeLanguage: optionalString(node, "codeLanguage"),
    codeExecution: optionalString(node, "codeExecution"),
    codePath: optionalString(node, "codePath"),
    codeInline: optionalString(node, "codeInline"),
    codeEntry: optionalString(node, "codeEntry"),
    codeDependencies: optionalString(node, "codeDependencies"),
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

function pyString(value: string): string {
  return JSON.stringify(value);
}

function pyJson(value: unknown): string {
  return JSON.stringify(JSON.stringify(value, null, 2));
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
MOCK_LLM=true
OPENAI_API_KEY=
OPENAI_MODEL=${flow.llm.model}
OPENAI_BASE_URL=
LLM_ADAPTER=${flow.llm.adapter}
LLM_MAX_RETRIES=2
AUTH_ENABLED=false
AGENT_API_KEY=
AUTO_CREATE_TABLES=true
LOG_LEVEL=INFO
LANGSMITH_TRACING=true
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
MOCK_LLM=true
OPENAI_API_KEY=
OPENAI_MODEL=${flow.llm.model}
OPENAI_BASE_URL=
LLM_ADAPTER=${flow.llm.adapter}
LLM_MAX_RETRIES=2
AUTH_ENABLED=false
AGENT_API_KEY=
AUTO_CREATE_TABLES=true
LOG_LEVEL=INFO
LANGSMITH_TRACING=true
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
    && apt-get install -y --no-install-recommends nodejs npm \\
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

  api:
    build: .
    env_file:
      - .env
    environment:
      DATABASE_URL: postgresql+psycopg2://agent:agent@postgres:5432/agent_runtime
      REDIS_URL: redis://redis:6379/0
      REDIS_ENABLED: "true"
      USE_POSTGRES_CHECKPOINTER: "true"
      AUTO_CREATE_TABLES: "true"
    ports:
      - "8080:8080"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started

volumes:
  ${volumeName}:
`;
}

function renderReadme(flow: AgentFlow): string {
  return `# ${flow.name}

Runtime gerado a partir de \`${flow.id}\`.

## Contrato

- \`POST /${flow.api.resourceName}\`
- \`GET /${flow.api.resourceName}/{session_id}\`
- \`POST /${flow.api.resourceName}/{session_id}/start\`
- \`POST /${flow.api.resourceName}/{session_id}/turn\`
- \`POST /${flow.api.resourceName}/{session_id}/finish\`
- \`GET /${flow.api.resourceName}/{session_id}/transcript\`
- \`GET /${flow.api.resourceName}/{session_id}/events\`

## Execução local

\`\`\`powershell
python -m pip install -e ".[dev]"
pytest -q
uvicorn app.main:app --reload --port 8080
\`\`\`

Se o fluxo usa nó \`code\` em JavaScript ou TypeScript, o ambiente local também precisa ter \`node\` disponível. O Dockerfile gerado já instala \`nodejs\`/\`npm\` e executa \`npm install --prefix app/code --omit=dev\` para preparar dependências declaradas por \`codeDependencies\`.

## Container Docker

\`\`\`powershell
Copy-Item .env.example .env
docker compose up --build
\`\`\`

A API fica em \`http://127.0.0.1:8080/docs\`.

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

Configure \`LANGSMITH_API_KEY\`, \`LANGSMITH_TRACING=true\` e \`LANGSMITH_PROJECT\` em \`.env\` para registrar traces no LangSmith.
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
  const apiKeyEnv = flow.llm.apiKeyEnv ?? "OPENAI_API_KEY";
  const baseUrlEnv = flow.llm.baseUrlEnv ?? "OPENAI_BASE_URL";
  const mockEnv = flow.llm.mockEnv ?? "MOCK_LLM";
  return `from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    service_name: str = ${pyString(serviceName)}
    database_url: str = "sqlite:///./agent_runtime.db"
    redis_url: str = "redis://localhost:6379/0"
    redis_enabled: bool = ${flow.persistence.cache === "redis" ? "True" : "False"}
    redis_ttl_seconds: int = 3600
    use_postgres_checkpointer: bool = ${flow.persistence.checkpointer === "postgres" ? "True" : "False"}
    mock_llm: bool = Field(default=True, validation_alias=${pyString(mockEnv)})
    openai_api_key: str = Field(default="", validation_alias=${pyString(apiKeyEnv)})
    openai_model: str = ${pyString(flow.llm.model)}
    openai_base_url: str = Field(default="", validation_alias=${pyString(baseUrlEnv)})
    llm_adapter: str = ${pyString(flow.llm.adapter)}
    llm_max_retries: int = 2
    auth_enabled: bool = False
    agent_api_key: str = ""
    auto_create_tables: bool = True
    log_level: str = "INFO"
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
        if self.auth_enabled and not self.agent_api_key.strip():
            raise ValueError("AGENT_API_KEY é obrigatória quando AUTH_ENABLED=true.")
        if not self.mock_llm and not self.openai_api_key.strip():
            raise ValueError("${apiKeyEnv} é obrigatória quando ${mockEnv}=false.")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
`;
}

function renderDb(): string {
  return `from collections.abc import Generator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

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


def init_db() -> None:
    from app.models import Base

    Base.metadata.create_all(bind=engine)


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
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.models import AgentEvent, AgentMessage, AgentSession, IdempotencyRecord


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
    max_turns: int,
    metadata_json: dict[str, Any] | None,
) -> AgentSession:
    row = AgentSession(
        session_id=new_id(),
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
    event_type: str,
    node: str | None = None,
    payload: dict[str, Any] | None = None,
) -> AgentEvent:
    row = AgentEvent(
        event_id=new_id(),
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
  return `from dataclasses import dataclass
from typing import Literal


Decision = Literal["allow", "block", "safe_redirect"]


@dataclass(frozen=True)
class SafetyDecision:
    blocked: bool
    decision: Decision
    category: str | None = None
    reason: str | None = None
    safe_response: str | None = None


class SafetyGate:
    def __init__(self) -> None:
        self._blocked_terms = {
            "ignore as regras": "jailbreak",
            "ignore o sistema": "jailbreak",
            "vazar prompt": "policy_leak",
            "senha secreta": "secret_request",
        }
        self._self_harm_terms = {
            "vou me matar",
            "quero me matar",
            "não aguento mais viver",
            "nao aguento mais viver",
        }

    def check_input(self, text: str) -> SafetyDecision:
        normalized = (text or "").strip().lower()
        if not normalized:
            return SafetyDecision(
                blocked=True,
                decision="safe_redirect",
                category="empty_input",
                reason="Mensagem vazia.",
                safe_response="Envie uma mensagem com conteúdo para continuarmos.",
            )
        for term in self._self_harm_terms:
            if term in normalized:
                return SafetyDecision(
                    blocked=True,
                    decision="block",
                    category="self_harm",
                    reason=f"Termo sensível detectado: {term}",
                    safe_response=(
                        "Sinto muito que você esteja passando por isso. "
                        "Procure apoio humano imediato. Se houver risco agora, ligue 188, 192 ou 190."
                    ),
                )
        for term, category in self._blocked_terms.items():
            if term in normalized:
                return SafetyDecision(
                    blocked=True,
                    decision="safe_redirect",
                    category=category,
                    reason=f"Termo bloqueado detectado: {term}",
                    safe_response="Não posso seguir com esse pedido, mas posso continuar com uma resposta segura.",
                )
        return SafetyDecision(blocked=False, decision="allow")

    def check_output(self, text: str) -> SafetyDecision:
        normalized = (text or "").strip().lower()
        if "system prompt" in normalized or "chave interna" in normalized:
            return SafetyDecision(
                blocked=True,
                decision="safe_redirect",
                category="policy_leak",
                reason="A saída tentou expor detalhes operacionais.",
                safe_response="Posso responder sem expor detalhes internos do agente.",
            )
        return SafetyDecision(blocked=False, decision="allow")
`;
}

function renderLlm(flow: AgentFlow): string {
  const adapter = flow.llm.adapter.toLowerCase();
  const defaultBaseUrl = findLlmAdapter(adapter)?.defaultBaseUrl ?? "";
  return `import json
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
    ) -> LLMResult:
        selected_adapter = (adapter or self.settings.llm_adapter).strip()
        selected_model = (model or self.settings.openai_model).strip()
        if self.settings.mock_llm:
            return LLMResult(
                text=(
                    "Recebi sua mensagem e mantive o fluxo do agente ativo. "
                    f"Você disse: {user_message}"
                ),
                provider="mock",
                model=selected_model or "mock",
                attempts=1,
            )

        client_kwargs: dict[str, Any] = {"api_key": self.settings.openai_api_key}
        default_base_urls = {"openrouter": "https://openrouter.ai/api/v1"}
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
                if attempt < max_attempts:
                    time.sleep(min(0.25 * attempt, 1.0))
        raise RuntimeError(f"Falha ao chamar LLM após {max_attempts} tentativa(s): {last_error}") from last_error


def load_prompt(name: str = "system.md") -> str:
    path = Path(__file__).resolve().parent / "prompts" / name
    return path.read_text(encoding="utf-8").strip()
`;
}

function renderGraph(flow: AgentFlow, plan: RuntimePlan): string {
  return `import atexit
import inspect
import json
import subprocess
import time
import traceback
import urllib.error
import urllib.request
from contextlib import contextmanager
from contextvars import ContextVar
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
        raw_path = str(relative_path or "").replace("\\\\", "/")
        candidate = Path(raw_path)
        if candidate.parts and candidate.parts[0] == "code":
            candidate = Path(*candidate.parts[1:]) if len(candidate.parts) > 1 else Path("")
        if not candidate.parts or candidate.is_absolute() or ".." in candidate.parts:
            raise ValueError("codePath deve ser relativo a app/code e não pode usar '..'.")
        resolved = (CODE_ROOT / candidate).resolve()
        root = CODE_ROOT.resolve()
        if root not in [resolved, *resolved.parents]:
            raise ValueError("codePath sai de app/code.")
        return resolved

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
        if inline_source:
            request["inlineSource"] = str(inline_source)
        elif source_path:
            request["sourcePath"] = str(safe_code_path(str(source_path)))
        else:
            return {
                "ok": False,
                "status": "custom_code_not_executed",
                "node_id": node_id,
                "contract": contract,
                "reason": "missing_code_source",
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

        runner_path = Path(__file__).resolve().parent / "code_runner.mjs"
        timeout_seconds = int(config.get("timeoutSeconds") or 30)
        completed = subprocess.run(
            ["node", str(runner_path)],
            input=json.dumps(request),
            text=True,
            capture_output=True,
            timeout=timeout_seconds,
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
            }
        return {
            "ok": True,
            "status": "custom_code_executed",
            "node_id": node_id,
            "contract": contract,
            "output": jsonable(runner_result.get("output")),
            "duration_ms": round((time.perf_counter() - started_at) * 1000, 3),
        }

    def execute_custom_code(config: dict[str, Any], state: ReferenceState, contract: dict[str, Any]) -> dict[str, Any]:
        language = str(config.get("codeLanguage") or "python").lower()
        execution = str(config.get("codeExecution") or "native").lower()
        if language == "external" or execution in {"http", "mcp", "sidecar", "runtime_adapter"}:
            return {
                "ok": False,
                "status": "custom_code_not_executed",
                "node_id": config["id"],
                "contract": contract,
                "reason": "external_executor_not_configured",
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

    def remember_custom_result(state: ReferenceState, node_id: str, result_path: str, result: dict[str, Any]) -> ReferenceState:
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

    def make_safety_node(config: dict[str, Any]):
        node_id = config["id"]
        stage = config.get("stage")

        def run(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "safety")
            if pinned is not None:
                return pinned
            if stage == "input":
                decision = safety_gate.check_input(state.get("user_message", ""))
                if decision.blocked:
                    return mark_node(state, node_id, {
                        "safety": {
                            "blocked": True,
                            "decision": decision.decision,
                            "category": decision.category,
                            "reason": decision.reason,
                        },
                        "assistant_message": {"code": "SEG", "text": decision.safe_response or "Mensagem bloqueada."},
                        "phase": "safety",
                        "is_complete": decision.decision == "block",
                        "status": "completed" if decision.decision == "block" else "active",
                    })
                return mark_node(state, node_id, {
                    "safety": {"blocked": False, "decision": "allow"},
                })

            if stage == "output":
                current_message = state.get("assistant_message") or {}
                decision = safety_gate.check_output(str(current_message.get("text") or ""))
                if decision.blocked:
                    return mark_node(state, node_id, {
                        "safety": {
                            "blocked": True,
                            "decision": decision.decision,
                            "category": decision.category,
                            "reason": decision.reason,
                        },
                        "assistant_message": {"code": "SEG", "text": decision.safe_response or "Saída ajustada por segurança."},
                    })
                return mark_node(state, node_id, {})

            return mark_node(state, node_id, {})

        return run

    def make_llm_node(config: dict[str, Any]):
        node_id = config["id"]

        def run(state: ReferenceState) -> ReferenceState:
            pinned = pinned_node_update(state, node_id, "llm")
            if pinned is not None:
                return pinned
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
            )
            return mark_node(state, node_id, {
                "assistant_message": {"code": "ECHO", "text": result.text},
                "llm": {
                    "provider": result.provider,
                    "model": result.model,
                    "attempts": result.attempts,
                    "node_id": node_id,
                },
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
        builder.add_node(config["id"], handler_for_node(config))

    builder.add_conditional_edges(START, route_action, action_route_map)
    for node_id, target in direct_node_edges.items():
        builder.add_edge(node_id, target)
    for node_id, route_map in node_route_map.items():
        builder.add_conditional_edges(node_id, make_route_after_node(node_id), route_map)

    return builder.compile(checkpointer=checkpointer)
`;
}

function renderSchemas(): string {
  return `from typing import Any

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
    event_type: str
    node: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class AssistantMessageView(BaseModel):
    code: str
    text: str


class SafetyView(BaseModel):
    blocked: bool = False
    decision: str = "allow"
    category: str | None = None
    reason: str | None = None


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


class MetadataResponse(BaseModel):
    service: str
    runtime: str
    contract: str
    flow_id: str
    flow_version: str
    llm_adapter: str
    supports_multi_agent_bundle: bool
`;
}

function renderService(): string {
  return `from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import repo
from app.cache import recent_key
from app.graph import (
    ANALYTICS_NODE_IDS,
    APPROVAL_GATE_NODE_IDS,
    CODE_NODE_IDS,
    CURRENT_DB_SESSION,
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
from app.models import AgentMessage, AgentSession
from app.settings import Settings


RECENT_LIMIT = 20


def session_view(row: AgentSession) -> dict[str, Any]:
    return {
        "session_id": row.session_id,
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
        "event_type": row.event_type,
        "node": row.node,
        "payload": row.payload or {},
    }


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
        row = repo.create_session(db, max_turns=max_turns, metadata_json=metadata)
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
            event_type="session_created",
            node=None,
            payload={"auto_start": auto_start, "restored": bool(restore)},
        )
        if restore:
            repo.append_event(
                db,
                session_id=row.session_id,
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

    def process_turn(self, db: Session, session_id: str, user_message: str) -> dict[str, Any]:
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
        result = self._invoke_graph(db, graph_state, row.session_id)
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
        repo.append_event(
            db,
            session_id=row.session_id,
            event_type="post_finish_pending",
            node=None,
            payload={"kind": "mock_summary"},
        )
        self.cache.delete(recent_key(row.session_id))
        return {"session": session_view(row), "message": message_view(message)}

    def transcript(self, db: Session, session_id: str, from_seq: int | None = None) -> list[dict[str, Any]]:
        self.get_session(db, session_id)
        return [message_view(row) for row in repo.get_transcript(db, session_id, from_seq=from_seq)]

    def events(self, db: Session, session_id: str, from_seq: int | None = None) -> list[dict[str, Any]]:
        self.get_session(db, session_id)
        return [event_view(row) for row in repo.get_events(db, session_id, from_seq=from_seq)]

    def _invoke_graph(self, db: Session, state: dict[str, Any], session_id: str) -> dict[str, Any]:
        token = CURRENT_DB_SESSION.set(db)
        try:
            return dict(
                self.graph.invoke(
                    state,
                    config={"configurable": {"thread_id": session_id}},
                )
            )
        finally:
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
                event_type=event_type,
                node=node_id,
                payload=payload,
            )
`;
}

function renderAuth(): string {
  return `from fastapi import Header, HTTPException, Request


def require_agent_api_key(
    request: Request,
    x_agent_api_key: str | None = Header(default=None, alias="X-Agent-API-Key"),
) -> None:
    settings = request.app.state.settings
    if not settings.auth_enabled:
        return
    if (x_agent_api_key or "").strip() != settings.agent_api_key:
        raise HTTPException(status_code=403, detail="Chave de API inválida.")
`;
}

function renderMain(flow: AgentFlow): string {
  return `import logging
from typing import Any

from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app import repo
from app.auth import require_agent_api_key
from app.cache import build_cache
from app.db import get_session, init_db
from app.generated_flow import API_CONTRACT, API_RESOURCE, FLOW_ID, FLOW_NAME, FLOW_VERSION
from app.graph import build_checkpointer, build_graph
from app.idempotency import normalize_idempotency_key, run_idempotent
from app.llm import LLMClient
from app.safety import SafetyGate
from app.schemas import (
    CreateSessionRequest,
    CreateSessionResponse,
    EmptyIdempotentRequest,
    EventView,
    FinishResponse,
    MessageView,
    MetadataResponse,
    SessionView,
    StartResponse,
    TurnRequest,
    TurnResponse,
)
from app.service import ReferenceAgentService
from app.settings import get_settings


logger = logging.getLogger(__name__)


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

    @app.get("/metadata", response_model=MetadataResponse)
    def metadata():
        return {
            "service": settings.service_name,
            "runtime": "langgraph-fastapi-python",
            "contract": API_CONTRACT,
            "flow_id": FLOW_ID,
            "flow_version": FLOW_VERSION,
            "llm_adapter": settings.llm_adapter,
            "supports_multi_agent_bundle": False,
        }

    def idempotency_key(header: str | None, body_key: str | None) -> str:
        return normalize_idempotency_key(header, body_key)

    def operation_name(request: Request, method: str, path_template: str) -> str:
        root_path = (request.scope.get("root_path") or "").rstrip("/")
        return f"{method} {root_path}{path_template}"

    @app.post(
        f"/{API_RESOURCE}",
        response_model=CreateSessionResponse,
        dependencies=[Depends(require_agent_api_key)],
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
        dependencies=[Depends(require_agent_api_key)],
    )
    def get_session_view(session_id: str, db: Session = Depends(get_session)):
        return app.state.service.get_session(db, session_id)

    @app.post(
        f"/{API_RESOURCE}/{{session_id}}/start",
        response_model=StartResponse,
        dependencies=[Depends(require_agent_api_key)],
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
        dependencies=[Depends(require_agent_api_key)],
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
        f"/{API_RESOURCE}/{{session_id}}/finish",
        response_model=FinishResponse,
        dependencies=[Depends(require_agent_api_key)],
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
        dependencies=[Depends(require_agent_api_key)],
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
        dependencies=[Depends(require_agent_api_key)],
    )
    def events(
        session_id: str,
        from_seq: int | None = Query(default=None, alias="from_seq"),
        db: Session = Depends(get_session),
    ):
        return app.state.service.events(db, session_id, from_seq=from_seq)

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
    os.environ["AUTO_CREATE_TABLES"] = "true"
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
  return `from fastapi.testclient import TestClient

from app.generated_flow import API_RESOURCE, FLOW_ID
from tests.conftest import set_test_env


def _path(suffix: str = "") -> str:
    return f"/{API_RESOURCE}{suffix}"


def _client(tmp_path):
    set_test_env(str(tmp_path / "generated.db"))
    from app.db import engine
    from app.main import create_app
    from app.models import Base

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return TestClient(create_app())


def test_generated_runtime_metadata_flow_and_idempotency(tmp_path):
    client = _client(tmp_path)

    metadata = client.get("/metadata")
    assert metadata.status_code == 200
    assert metadata.json()["flow_id"] == FLOW_ID

    create_resp = client.post(
        _path(),
        headers={"Idempotency-Key": "create-1"},
        json={"metadata": {"source": "pytest"}, "max_turns": 2},
    )
    assert create_resp.status_code == 200
    session_id = create_resp.json()["session"]["session_id"]

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
    assert "llm_called" in [item["event_type"] for item in events]


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
`;
}

function renderMigration(): string {
  return `CREATE TABLE IF NOT EXISTS agent_sessions (
  session_id VARCHAR PRIMARY KEY,
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
