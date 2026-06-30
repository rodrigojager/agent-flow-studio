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
  codeLanguage?: string;
  codeExecution?: string;
  codePath?: string;
  codeInline?: string;
  codeEntry?: string;
  codeDependencies?: string;
  stage?: string;
  llm?: Record<string, unknown>;
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
  maxRows?: number;
  timeoutSeconds?: number;
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

export interface CreatedFlowWorkspace {
  status: "ok";
  path: string;
  flow: AgentFlow;
  prompts: FlowAssetContent[];
  schemas: FlowAssetContent[];
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

export type DockerRuntimeOperation = "prepare_env" | "configure_ports" | "build" | "up" | "down" | "smoke" | "inspect" | "cancel";
export type DockerRuntimeOperationStatus = "idle" | "running" | "success" | "error" | "canceled";

export type DockerRuntimeProgressStatus = "running" | "done" | "error" | "warning" | "info" | "canceled";

export interface DockerRuntimeProgressEvent {
  stage: string;
  status: DockerRuntimeProgressStatus;
  message: string;
  line: string;
  percent?: number;
  timestamp: string;
}

export interface DockerRuntimeSmokeResult {
  health: unknown;
  metadata: unknown;
  sessionId: string;
  transcriptCount: number;
  eventsCount: number;
}

export interface DockerRuntimePortBinding {
  service: "api" | "postgres" | "redis";
  hostPort: number;
  containerPort: number;
  value: string;
}

export interface DockerRuntimePorts {
  api: DockerRuntimePortBinding | null;
  postgres: DockerRuntimePortBinding | null;
  redis: DockerRuntimePortBinding | null;
}

export interface DockerRuntimePortUpdate {
  api?: number;
  postgres?: number;
  redis?: number;
}

export interface DockerComposeService {
  name: string | null;
  service: string | null;
  state: string | null;
  status: string | null;
  ports: string | null;
  raw: Record<string, unknown>;
}

export interface DockerRuntimeInspection {
  containers: DockerComposeService[];
  rawPs: string;
  rawLogs: string;
}

export interface DockerRuntimeStatus {
  outDir: string;
  ready: boolean;
  target: "fastapi-runtime" | null;
  flowId: string | null;
  flowVersion: string | null;
  flowHash: string | null;
  resourceName: string | null;
  runtimeUrl: string;
  docsUrl: string;
  openapiUrl: string;
  ports: DockerRuntimePorts;
  composeFile: boolean;
  dockerfile: boolean;
  envFile: boolean;
  lastOperation: DockerRuntimeOperation | null;
  lastStatus: DockerRuntimeOperationStatus;
  lastExitCode: number | null;
  updatedAt: string | null;
  logs: string[];
  inspection: DockerRuntimeInspection | null;
  progress?: DockerRuntimeProgressEvent[];
}

export interface DockerRuntimeOperationResult extends DockerRuntimeStatus {
  operation: DockerRuntimeOperation;
  ok: boolean;
  command?: string;
  args?: string[];
  stdout?: string;
  stderr?: string;
  smoke?: DockerRuntimeSmokeResult;
  progress?: DockerRuntimeProgressEvent[];
  message: string;
}

export interface DockerRuntimeHistoryEntry {
  id: string;
  outDir: string;
  operation: DockerRuntimeOperation;
  ok: boolean;
  status: DockerRuntimeOperationStatus;
  exitCode: number | null;
  runtimeUrl: string;
  startedAt: string;
  finishedAt: string;
  message: string;
  command?: string;
  args?: string[];
  logs: string[];
  smoke?: DockerRuntimeSmokeResult;
  inspection?: DockerRuntimeInspection;
  progress?: DockerRuntimeProgressEvent[];
}

export interface DockerRuntimeHistory {
  outDir: string;
  entries: DockerRuntimeHistoryEntry[];
}

export interface DockerRuntimeHistoryQuery {
  limit?: number;
  operation?: DockerRuntimeOperation;
  status?: DockerRuntimeOperationStatus;
  ok?: boolean;
  search?: string;
  from?: string;
  to?: string;
}

export interface FlowAssetContent {
  id: string;
  path: string;
  content: string;
}

export interface FlowAssetMutationResult {
  status: "ok";
  path: string;
  flow: AgentFlow;
  prompt?: FlowAssetContent;
  schema?: FlowAssetContent;
}

export interface FlowAssetDeleteResult {
  status: "ok";
  path: string;
  flow: AgentFlow;
  deleted: {
    id: string;
    path: string;
  };
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

export interface StudioStateDiffEntry {
  path: string;
  kind: "added" | "removed" | "changed";
  before?: unknown;
  after?: unknown;
}

export interface StudioStateSnapshot {
  seq: number;
  node: string | null;
  eventType: string;
  status: string | null;
  phase: string | null;
  turn: number | null;
  state: Record<string, unknown>;
  diff: StudioStateDiffEntry[];
}

export interface StudioRunCausalAnalysis {
  failedEventSeq: number | null;
  failedEventType: string | null;
  failedNode: string | null;
  upstreamPath: string[];
  impactPath: string[];
  impactedNodes: string[];
}

export interface StudioRunSummary {
  id: string;
  flowId: string;
  flowVersion: string | null;
  sessionId: string;
  status: string;
  phase: string;
  turn: number;
  maxTurns: number;
  isComplete: boolean;
  resourceName: string;
  runtimeUrl: string;
  messageCount: number;
  eventCount: number;
  snapshotCount: number;
  nodeCount: number;
  errorCount: number;
  causalAnalysis: StudioRunCausalAnalysis | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface StudioRunQuery {
  q?: string;
  status?: string;
  phase?: string;
  hasErrors?: boolean;
  isComplete?: boolean;
  node?: string;
  minDurationMs?: number;
  maxDurationMs?: number;
}

export interface StudioRunExport {
  format: "agent-flow-builder.studio-run-export.v1";
  exportedAt: string;
  flowId: string;
  runId: string;
  run: StudioRunRecord;
}

export interface StudioRunComparison {
  format: "agent-flow-builder.studio-run-comparison.v1";
  exportedAt: string;
  flowId: string;
  flowName: string | null;
  leftRunId: string;
  rightRunId: string;
  left: StudioRunRecord;
  right: StudioRunRecord;
  metrics: {
    statusChanged: boolean;
    phaseChanged: boolean;
    isCompleteChanged: boolean;
    nodeCountDelta: number;
    eventCountDelta: number;
    errorCountDelta: number;
    messageCountDelta: number;
    runtimeUrlChanged: boolean;
    durationMsLeft: number | null;
    durationMsRight: number | null;
    durationMsDelta: number | null;
  };
  nodeDiff: {
    leftOnly: string[];
    rightOnly: string[];
    both: string[];
  };
  nodeComparisons: StudioNodeComparison[];
  leftOnlyNodes: string[];
  rightOnlyNodes: string[];
}

export interface StudioNodeComparison {
  nodeId: string;
  inLeft: boolean;
  inRight: boolean;
  changed: boolean;
  stateDiff: StudioStateDiffEntry[];
  outputDiff: StudioStateDiffEntry[];
  left: {
    seq: number | null;
    eventType: string | null;
    status: string | null;
    phase: string | null;
    turn: number | null;
  };
  right: {
    seq: number | null;
    eventType: string | null;
    status: string | null;
    phase: string | null;
    turn: number | null;
  };
}

export interface StudioRunRecord extends StudioRunSummary {
  flowName: string | null;
  runPath: string;
  session: SessionView;
  transcript: MessageView[];
  events: EventView[];
  stateSnapshots: StudioStateSnapshot[];
  causalAnalysis: StudioRunCausalAnalysis | null;
  logs: string[];
}

export interface StudioRunList {
  flowId: string;
  runs: StudioRunSummary[];
}
