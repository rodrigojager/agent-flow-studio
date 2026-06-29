export interface FlowSummary {
  id: string;
  name: string | null;
  version: string | null;
  path: string;
  valid: boolean;
  error?: string;
}

export interface PromptRef {
  id: string;
  path: string;
  version: string;
  variables: string[];
}

export interface SchemaRef {
  id: string;
  path: string;
}

export interface FlowNode {
  id: string;
  type: string;
  description?: string;
  promptId?: string;
  outputSchema?: string;
  handler?: string;
  stage?: string;
  llm?: Record<string, unknown>;
  position?: {
    x: number;
    y: number;
  };
}

export interface FlowEdge {
  from: string;
  to: string;
  condition?: string;
}

export interface AgentFlow {
  id: string;
  name: string;
  version: string;
  runtime: string;
  api: {
    contract: string;
    resourceName: string;
    autoStartOnCreate: boolean;
  };
  persistence: {
    checkpointer: string;
    publicStore: string;
    cache: string;
  };
  llm: {
    adapter: string;
    model: string;
    apiKeyEnv?: string;
    baseUrlEnv?: string;
    mockEnv?: string;
  };
  state: {
    schemaRef: string;
  };
  prompts: PromptRef[];
  schemas: SchemaRef[];
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export type LlmAdapterStatus = "supported" | "planned";

export interface LlmAdapterCatalogItem {
  id: string;
  label: string;
  status: LlmAdapterStatus;
  protocol: string;
  defaultModel: string;
  apiKeyEnv: string;
  baseUrlEnv?: string;
  mockEnv: string;
  defaultBaseUrl?: string;
  notes: string;
}

export interface LlmAdapterCatalogResult {
  adapters: LlmAdapterCatalogItem[];
}

export interface LoadedFlow {
  path: string;
  flow: AgentFlow;
}

export type FlowDiagnosticSeverity = "error" | "warning" | "info";

export interface FlowDiagnostic {
  severity: FlowDiagnosticSeverity;
  code: string;
  message: string;
  path?: string;
  nodeId?: string;
  edgeIndex?: number;
  assetId?: string;
}

export interface ValidationResult {
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

export interface GenerateResult {
  status: "ok";
  flowId: string;
  flowPath: string;
  outDir: string;
}

export interface RuntimeManifestAgent {
  id: string;
  flowPath: string;
  routePrefix: string;
}

export interface RuntimeManifest {
  id: string;
  name: string;
  version: string;
  packaging: "monoagent" | "multiagent";
  defaultLlm?: {
    adapter: string;
    model: string;
    apiKeyEnv?: string;
    baseUrlEnv?: string;
    mockEnv?: string;
  };
  agents: RuntimeManifestAgent[];
}

export interface LoadedRuntimeManifest {
  path: string;
  manifest: RuntimeManifest;
}

export interface RuntimeManifestValidationResult {
  status: "ok";
  id: string;
  name: string;
  version: string;
  packaging: RuntimeManifest["packaging"];
  agents: Array<{
    id: string;
    flowId: string;
    routePrefix: string;
  }>;
}

export interface RuntimeManifestGenerateResult {
  status: "ok";
  manifestId: string;
  manifestPath: string;
  outDir: string;
  agents: RuntimeManifestAgent[];
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

export interface FlowAssetContent {
  id: string;
  path: string;
  content: string;
}

export interface FlowWorkspaceExport {
  format: "agent-flow-builder.flow-workspace.v1";
  exportedAt: string;
  source: {
    flowId: string;
    flowPath: string;
  };
  flow: AgentFlow;
  prompts: FlowAssetContent[];
  schemas: FlowAssetContent[];
}

export interface FlowWorkspaceImportResult {
  status: "ok";
  path: string;
  flow: AgentFlow;
  prompts: number;
  schemas: number;
}

export interface SandboxStatus {
  flowId: string;
  running: boolean;
  port: number | null;
  pid: number | null;
  url: string | null;
  docsUrl: string | null;
  runtimeDir: string | null;
  logs: string[];
}

export interface SandboxListResult {
  sandboxes: SandboxStatus[];
}

export interface SessionView {
  session_id: string;
  status: string;
  phase: string;
  turn: number;
  max_turns: number;
  metadata: Record<string, unknown>;
  is_complete: boolean;
}

export interface MessageView {
  seq: number;
  role: string;
  code?: string | null;
  content: string;
  metadata: Record<string, unknown>;
}

export interface EventView {
  seq: number;
  event_type: string;
  node?: string | null;
  payload: Record<string, unknown>;
}
