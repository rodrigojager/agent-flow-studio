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
  description?: string;
  tags?: string[];
  variables: string[];
}

export interface SchemaRef {
  id: string;
  path: string;
  version?: string;
  description?: string;
  tags?: string[];
}

export interface FlowNode {
  id: string;
  type: string;
  description?: string;
  tags?: string[];
  promptId?: string;
  outputSchema?: string;
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
  sandboxContainerImageId?: string;
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
  stage?: string;
  safetyMode?: string;
  safetySeverityThreshold?: string;
  safetyFallbackResponse?: string;
  safetyRules?: SafetyRule[];
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
  retryAttempts?: number;
  payloadAllowPaths?: string[];
  redactPaths?: string[];
  maxPayloadBytes?: number;
  position?: {
    x: number;
    y: number;
  };
}

export interface VmRunnerCheckItem {
  id: string;
  label: string;
  level: "ok" | "warning" | "error";
  message: string;
  path?: string;
}

export interface VmRunnerCheckResult {
  format: "agent-flow-builder.vm-runner-check.v1";
  checkedAt: string;
  flowId: string;
  nodeId: string | null;
  status: "ready" | "warning" | "blocked" | "not_vm";
  protocol: "agent-flow-vm-runner.v1";
  executesUserCode: false;
  runner: {
    value: string;
    source: "node" | "env" | "none";
    resolved: boolean;
    path: string | null;
    args: string[];
  };
  image: {
    value: string;
    source: "node" | "env" | "manifest" | "none";
    resolved: boolean;
    path: string | null;
  };
  runnerManifest: {
    value: string;
    source: "node" | "env" | "manifest" | "none";
    resolved: boolean;
    path: string | null;
    format: string | null;
    protocol: string | null;
    runnerId: string | null;
    engines: string[];
    languages: string[];
    capabilities: {
      networkNone: boolean | null;
      readOnlyRootfs: boolean | null;
      workspaceMount: boolean | null;
      snapshotRestore: boolean | null;
    };
  };
  imageManifest: {
    value: string;
    source: "node" | "env" | "manifest" | "none";
    resolved: boolean;
    path: string | null;
    format: string | null;
    imageId: string | null;
    engine: string | null;
    language: string | null;
    imagePath: string | null;
    imagePathResolved: boolean;
    imageSizeBytes: number | null;
    declaredSizeBytes: number | null;
    sha256: string | null;
    sha256Verified: boolean | null;
  };
  policy: {
    imageId: string | null;
    engine: string | null;
    profile: string;
    memory: string | null;
    cpus: string | null;
  };
  checks: VmRunnerCheckItem[];
}

export interface SafetyRule {
  id: string;
  label?: string;
  description?: string;
  match: string;
  matchType?: "contains" | "regex";
  category?: string;
  severity?: "low" | "medium" | "high" | "critical";
  action?: "warn" | "safe_redirect" | "block";
  safeResponse?: string;
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

export interface LlmLocalModelPreset {
  id: string;
  label: string;
  model: string;
  hardware: string;
  description: string;
}

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
  requiresApiKey?: boolean;
  defaultApiKey?: string;
  localModelPresets?: LlmLocalModelPreset[];
  notes: string;
}

export interface LlmAdapterCatalogResult {
  adapters: LlmAdapterCatalogItem[];
}

export interface LocalLlmProviderStatus {
  format: "agent-flow-builder.local-llm-provider-status.v1";
  adapter: string;
  provider: "ollama" | "unsupported";
  status: "ok" | "unsupported_adapter" | "blocked" | "unreachable" | "error";
  ok: boolean;
  checkedAt: string;
  baseUrl: string;
  nativeBaseUrl?: string;
  selectedModel?: string;
  selectedModelInstalled?: boolean;
  modelCount: number;
  models: string[];
  version?: string;
  message: string;
  nextActions: string[];
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
  evidence?: LangGraphSandboxApprovalEvidence;
}

export interface LangGraphSandboxApprovalEvidence {
  source: "studio" | "api";
  runId?: string;
  sessionId?: string;
  agentId?: string;
  eventCount?: number;
  visibleEventCount?: number;
  selectedEventSeq?: number;
  selectedEventType?: string;
  selectedNodeId?: string;
  failedNodeId?: string;
  latestEventSeq?: number;
  latestEventType?: string;
  capturedAt: string;
  excludesRawPayloads: true;
  excludesSecretValues: true;
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
  evidence?: LangGraphSandboxApprovalEvidence;
  reason: string;
  details?: unknown;
}

export interface LangSmithCloudHandoffCommand {
  id: string;
  label: string;
  command: string | null;
  detail: string;
}

export interface LangSmithCloudHandoff {
  format: "agent-flow-builder.langsmith-cloud-handoff.v1";
  status: "ready" | "blocked";
  flowId: string;
  flowName: string;
  flowVersion: string;
  flowHash: string;
  generatedAt: string;
  handoffPath: string;
  packageHash: string;
  sandbox: {
    status: "ready" | "missing" | "outdated" | "invalid";
    outDir: string;
    generated: boolean;
    target: string | null;
    flowHash: string | null;
    reason: string;
  };
  approval: {
    status: LangGraphSandboxApprovalStatus["status"];
    ready: boolean;
    approvalPath: string;
    approvedAt?: string;
    reason: string;
    evidence?: LangGraphSandboxApprovalEvidence;
  };
  environment: {
    llmAdapter: string;
    model: string;
    referencedEnvNames: string[];
    protectedEnvNames: string[];
    baseUrlEnvNames: string[];
    mockEnvNames: string[];
    includesEnvValues: false;
  };
  checklist: Array<{
    id: string;
    label: string;
    status: "done" | "pending" | "blocked";
    detail: string;
  }>;
  commands: LangSmithCloudHandoffCommand[];
  governance: {
    localFirstOptional: true;
    doesNotCallCloud: true;
    cloudTokenNotStored: true;
    includesSecrets: false;
    includesEnvValues: false;
    includesRawPayloads: false;
    includesPromptContent: false;
    includesSchemaContent: false;
  };
}

export type LangSmithCloudDeploymentStatus = "prepared" | "deployed" | "verified" | "failed";
export type LangSmithCloudDeploymentRecorderRole = "owner" | "operator" | "reviewer" | "viewer";

export interface LangSmithCloudDeploymentRecord {
  id: string;
  status: LangSmithCloudDeploymentStatus;
  flowId: string;
  flowName: string;
  flowVersion: string;
  flowHash: string;
  handoffPackageHash: string;
  sandboxOutDir: string;
  approvalPath: string;
  deploymentName: string;
  environment: string;
  cloudProject?: string;
  externalDeploymentId?: string;
  deploymentUrl?: string;
  traceUrl?: string;
  note?: string;
  recordedBy: string;
  recordedRole: LangSmithCloudDeploymentRecorderRole;
  recordedAt: string;
  verifiedAt?: string;
  automation?: {
    source: "configured_endpoint";
    statusCode: number;
    requestedAt: string;
    responseHash: string;
    endpointConfiguredEnv: string;
    tokenInHeaderOnly: true;
  };
  governance: {
    localFirstOptional: true;
    doesNotCallCloud: true;
    cloudTokenNotStored: true;
    includesSecrets: false;
    includesEnvValues: false;
    includesRawPayloads: false;
    sanitizedExternalUrls: true;
  };
}

export interface LangSmithCloudDeploymentAutomationStatus {
  format: "agent-flow-builder.langsmith-cloud-deployment-automation-status.v1";
  generatedAt: string;
  configured: boolean;
  urlConfigured: boolean;
  tokenConfigured: boolean;
  timeoutMs: number;
  invalidReason: string | null;
  lastTriggeredAt: string | null;
  statusCode: number | null;
  error: string | null;
  governance: {
    localFirstOptional: true;
    excludesSecretValues: true;
    sendsHandoffPackage: true;
    sendsDeploymentRecords: true;
    sendsCloudTokens: false;
    sendsRawPayloads: false;
    deployAuthTokenInHeaderOnly: true;
    deployAuthTokenInBody: false;
    storesDeployToken: false;
    configuredUrlEnv: string;
    configuredTokenEnv: string;
    configuredTimeoutEnv: string;
    maxPayloadBytes: number;
  };
}

export interface LangSmithCloudDeploymentAutomationResult {
  format: "agent-flow-builder.langsmith-cloud-deployment-automation-result.v1";
  flowId: string;
  deployment: LangSmithCloudDeploymentRecord;
  deployments: LangSmithCloudDeploymentsPackage;
  automation: {
    statusCode: number;
    requestedAt: string;
    responseHash: string;
  };
  status: LangSmithCloudDeploymentAutomationStatus;
  governance: {
    localFirstOptional: true;
    excludesSecretValues: true;
    sendsHandoffPackage: true;
    sendsDeploymentRecords: true;
    sendsCloudTokens: false;
    sendsRawPayloads: false;
    deployAuthTokenInHeaderOnly: true;
    deployAuthTokenInBody: false;
  };
}

export interface LangSmithCloudDeploymentsPackage {
  format: "agent-flow-builder.langsmith-cloud-deployments.v1";
  flowId: string;
  flowName: string;
  flowVersion: string;
  flowHash: string;
  deploymentPath: string;
  updatedAt: string;
  deploymentCount: number;
  latestStatus: LangSmithCloudDeploymentStatus | "none";
  deployments: LangSmithCloudDeploymentRecord[];
  governance: {
    localFirstOptional: true;
    doesNotCallCloud: true;
    cloudTokenNotStored: true;
    includesSecrets: false;
    includesEnvValues: false;
    includesRawPayloads: false;
  };
}

export interface LangSmithCloudDeploymentsCentralStatus {
  format: "agent-flow-builder.langsmith-cloud-deployments-central-sync-status.v1";
  generatedAt: string;
  configured: boolean;
  urlConfigured: boolean;
  tokenConfigured: boolean;
  timeoutMs: number;
  invalidReason: string | null;
  lastSyncedAt: string | null;
  statusCode: number | null;
  pushedDeploymentCount: number | null;
  pulledDeploymentCount: number | null;
  error: string | null;
  governance: {
    localFirstOptional: true;
    excludesSecretValues: true;
    sendsDeploymentRecords: true;
    sendsCloudTokens: false;
    sendsRawPayloads: false;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
    storesCentralToken: false;
    configuredUrlEnv: string;
    configuredTokenEnv: string;
    configuredTimeoutEnv: string;
    maxPayloadBytes: number;
  };
}

export interface LangSmithCloudDeploymentsCentralSyncResult {
  format: "agent-flow-builder.langsmith-cloud-deployments-central-sync-result.v1";
  flowId: string;
  deployments: LangSmithCloudDeploymentsPackage;
  central: LangSmithCloudDeploymentsCentralStatus;
  pushedDeploymentCount: number;
  pulledDeploymentCount: number;
  governance: {
    localFirstOptional: true;
    excludesSecretValues: true;
    sendsDeploymentRecords: true;
    sendsCloudTokens: false;
    sendsRawPayloads: false;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
  };
}

export interface ApprovedGenerateResult extends GenerateResult {
  approval: LangGraphSandboxApproval;
}

export interface ExternalEvaluatorRequest {
  endpointUrl: string;
  headers?: Record<string, string>;
  payload: unknown;
  passPath?: string;
  reasonPath?: string;
  scorePath?: string;
  verdictPath?: string;
  minScore?: number | null;
  timeoutMs?: number;
}

export interface ExternalEvaluatorResult {
  format: "agent-flow-builder.external-evaluator-result.v1";
  ok: boolean;
  pass: boolean;
  severity: "pass" | "fail";
  verdict: string;
  reason: string;
  score: number | null;
  status: number;
  elapsedMs: number;
  raw: unknown;
}

export interface RuntimeManifestAgent {
  id: string;
  flowPath: string;
  routePrefix: string;
}

export interface RuntimeManifestHandoff {
  fromAgentId: string;
  toAgentId: string;
  condition?: string;
}

export interface RuntimeManifestOrchestrationMemoryPolicy {
  enabled: boolean;
  persistence: "disabled" | "optional_jsonl" | "always_jsonl";
  defaultPersist: boolean;
  defaultMemoryPath: string;
  maxEntries: number;
  retentionRuns: number;
  maxPreviewChars: number;
  redactKeys: string[];
  includeStepOutputs: boolean;
  includeHandoffDecisions: boolean;
}

export interface RuntimeManifestOrchestration {
  mode: "router" | "sequential" | "parallel";
  entryAgentId?: string;
  handoffs: RuntimeManifestHandoff[];
  memoryPolicy?: RuntimeManifestOrchestrationMemoryPolicy;
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
  orchestration?: RuntimeManifestOrchestration;
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
    flowName: string;
    flowVersion: string;
    flowPath: string;
    routePrefix: string;
    resourceName: string;
    contract: string;
  }>;
}

export interface RuntimeManifestGenerateResult {
  status: "ok";
  manifestId: string;
  manifestPath: string;
  outDir: string;
  agents: RuntimeManifestAgent[];
  approvalPackagePath?: string;
  approvals?: LangGraphSandboxApproval[];
}

export interface GeneratedArtifactFileSummary {
  path: string;
  sizeBytes: number;
}

export type GeneratedArtifactPackageType = "runtime-final" | "langgraph-sandbox" | "generic-artifact";
export type GeneratedArtifactExportAuditLevel = "ok" | "warning" | "error";

export interface GeneratedArtifactExportAuditCheck {
  id: string;
  label: string;
  level: GeneratedArtifactExportAuditLevel;
  detail: string;
}

export interface GeneratedArtifactRunbookStep {
  id: string;
  label: string;
  command: string | null;
  detail: string;
}

export interface GeneratedArtifactRunbookEndpoint {
  label: string;
  url: string;
}

export interface GeneratedArtifactRunbookAgent {
  id: string;
  routePrefix: string;
  resourceName: string;
  metadataUrl: string;
  sessionsUrl: string;
}

export interface GeneratedArtifactRunbook {
  title: string;
  workingDirectory: string;
  runtimeBaseUrl: string | null;
  agents: GeneratedArtifactRunbookAgent[];
  steps: GeneratedArtifactRunbookStep[];
  endpoints: GeneratedArtifactRunbookEndpoint[];
}

export interface GeneratedArtifactExportAudit {
  format: "agent-flow-builder.generated-artifact-export-audit.v1";
  packageType: GeneratedArtifactPackageType;
  target: string | null;
  ready: boolean;
  detachedFromBuilder: boolean;
  archiveManifestPath: string;
  includesEnvValues: false;
  blockedFiles: string[];
  requiredFiles: Array<{ path: string; present: boolean }>;
  checks: GeneratedArtifactExportAuditCheck[];
  blockers: string[];
  runbook: GeneratedArtifactRunbook;
}

export interface GeneratedArtifactListing {
  outDir: string;
  files: GeneratedArtifactFileSummary[];
  totalSizeBytes: number;
  exportAudit: GeneratedArtifactExportAudit;
}

export interface GeneratedArtifactFileContent {
  outDir: string;
  path: string;
  content: string;
  sizeBytes: number;
  truncated: boolean;
}

export type DockerRuntimeOperation =
  | "prepare_env"
  | "configure_ports"
  | "setup_models"
  | "build_model_image"
  | "export_model_image"
  | "push_model_image"
  | "check_gpu"
  | "build"
  | "up"
  | "down"
  | "smoke"
  | "inspect"
  | "cancel";
export type DockerRuntimeOperationStatus = "idle" | "running" | "success" | "error" | "canceled";

export type DockerRuntimeProgressStatus = "running" | "done" | "error" | "warning" | "info" | "canceled";
export type DockerRuntimeHistoryLevel = "error" | "warning" | "info" | "success";
export type DockerRuntimeTarget = "fastapi-runtime" | "runtime-manifest-bundle";
export type DockerRuntimeModelExecutionProfile = "cpu" | "gpu";

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
  agentMetadata?: unknown;
  agentId?: string;
  routePrefix?: string;
  resourceName: string;
  basePath: string;
  sessionId: string;
  transcriptCount: number;
  eventsCount: number;
}

export interface DockerRuntimeSmokeFailure {
  agentId: string | null;
  routePrefix: string;
  resourceName: string;
  basePath: string;
  message: string;
}

export interface DockerRuntimeSmokeAllResult {
  agentCount: number;
  okCount: number;
  failedCount: number;
  results: DockerRuntimeSmokeResult[];
  failures: DockerRuntimeSmokeFailure[];
}

export interface DockerRuntimeGpuProbe {
  image: string;
  command: string;
  args: string[];
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  devices: string[];
  checkedAt: string;
}

export interface DockerRuntimeAgent {
  id: string;
  flowId: string;
  flowName: string;
  flowVersion: string;
  flowHash: string | null;
  routePrefix: string;
  runtimeDir: string;
  resourceName: string;
  contract: string;
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

export interface DockerRuntimeModelSetup {
  required: boolean;
  profile: "model-setup";
  services: string[];
  models: string[];
  command: string | null;
  execution: DockerRuntimeModelExecution;
  distribution: DockerRuntimeModelDistribution;
}

export interface DockerRuntimeModelDistribution {
  modelImageComposeFile: boolean;
  modelImageDockerfile: boolean;
  modelImageCommand: string | null;
  modelImageTag: string | null;
  modelImageArchivePath: string | null;
  modelImageExportCommand: string | null;
  modelImageLoadCommand: string | null;
  modelImagePushCommand: string | null;
}

export interface DockerRuntimeModelExecution {
  cpuCommand: string;
  gpuCommand: string | null;
  gpuComposeFile: boolean;
  hostGpuDetected: boolean;
  hostGpuDevices: string[];
  dockerGpuRuntimeAvailable: boolean;
  dockerGpuRuntimeDetails: string[];
  dockerGpuRuntimeError: string | null;
  recommendedProfile: DockerRuntimeModelExecutionProfile;
  reason: string;
  checkedAt: string;
}

export interface ModelImageCatalogItem {
  id: string;
  tag: string;
  registryHost: string | null;
  versionTag: string | null;
  models: string[];
  archivePath: string | null;
  buildCommand: string | null;
  exportCommand: string | null;
  loadCommand: string | null;
  pushCommand: string | null;
  sourceOutDir: string;
  sourceTarget: DockerRuntimeTarget | null;
  flowId: string | null;
  flowVersion: string | null;
  flowHash: string | null;
  agents: Array<{ id: string; flowId: string; routePrefix: string; resourceName: string }>;
  createdAt: string;
  updatedAt: string;
  revision: number;
  contentHash: string;
  notes: string | null;
  governance: {
    excludesSecretValues: true;
    storesDockerCredentials: false;
    storesEnvValues: false;
    source: "docker-runtime";
  };
}

export interface ModelImageCatalog {
  format: "agent-flow-builder.model-image-catalog.v1";
  version: 1;
  generatedAt: string;
  itemCount: number;
  items: ModelImageCatalogItem[];
  governance: {
    excludesSecretValues: true;
    storesDockerCredentials: false;
    storesEnvValues: false;
    fileBacked: true;
    path: string;
  };
}

export interface ModelImageCatalogRegisterResult {
  catalog: ModelImageCatalog;
  item: ModelImageCatalogItem;
  created: boolean;
  updated: boolean;
}

export interface ModelImageCatalogMergeResult {
  catalog: ModelImageCatalog;
  added: number;
  updated: number;
  unchanged: number;
}

export interface ModelImageCatalogDiscoverySearchPath {
  source: "workspace-imports" | "configured-path";
  path: string;
  exists: boolean;
  fileCount: number;
  error: string | null;
}

export interface ModelImageCatalogDiscoveryItem {
  id: string;
  source: "workspace-imports" | "configured-path";
  path: string;
  itemCount: number;
  tags: string[];
  latestUpdatedAt: string | null;
  contentHash: string;
}

export interface ModelImageCatalogDiscoveryResult {
  format: "agent-flow-builder.model-image-catalog-discovery.v1";
  generatedAt: string;
  catalogCount: number;
  itemCount: number;
  searchPaths: ModelImageCatalogDiscoverySearchPath[];
  catalogs: ModelImageCatalogDiscoveryItem[];
  errors: Array<{ path: string; message: string }>;
  governance: {
    excludesSecretValues: true;
    storesDockerCredentials: false;
    storesEnvValues: false;
    localOnly: true;
    defaultImportDir: string;
    configuredPathsEnv: string;
  };
}

export interface ModelImageCatalogSyncDiscoveredResult extends ModelImageCatalogMergeResult {
  discovery: ModelImageCatalogDiscoveryResult;
  mergedCatalogCount: number;
}

export type ModelImageRemoteRegistryEntryStatus = "candidate" | "approved" | "disabled";
export type ModelImageRemoteRegistryEntrySource = "workspace-registry" | "env";

export interface ModelImageRemoteRegistryEntry {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  status: ModelImageRemoteRegistryEntryStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  lastCheckedAt: string | null;
  lastSyncedAt: string | null;
  lastStatusCode: number | null;
  lastItemCount: number | null;
  lastError: string | null;
  contentHash: string;
  governance: {
    excludesSecretValues: true;
    storesDockerCredentials: false;
    storesEnvValues: false;
    sendsCredentials: false;
    source: "workspace-registry";
  };
}

export interface ModelImageRemoteRegistry {
  format: "agent-flow-builder.model-image-remote-registry.v1";
  version: 1;
  generatedAt: string;
  registryCount: number;
  enabledCount: number;
  registries: ModelImageRemoteRegistryEntry[];
  governance: {
    excludesSecretValues: true;
    storesDockerCredentials: false;
    storesEnvValues: false;
    sendsCredentials: false;
    fileBacked: true;
    path: string;
    configuredUrlsEnv: string;
  };
}

export interface ModelImageRemoteRegistrySaveResult {
  registry: ModelImageRemoteRegistry;
  entry: ModelImageRemoteRegistryEntry;
  created: boolean;
  updated: boolean;
}

export interface ModelImageCatalogRemoteRegistryItem {
  id: string;
  source: ModelImageRemoteRegistryEntrySource;
  name: string;
  url: string;
  enabled: boolean;
  curationStatus: ModelImageRemoteRegistryEntryStatus | "env";
  statusCode: number | null;
  itemCount: number;
  tags: string[];
  latestUpdatedAt: string | null;
  contentHash: string | null;
  error: string | null;
}

export interface ModelImageCatalogRemoteRegistryResult {
  format: "agent-flow-builder.model-image-catalog-remote-registry.v1";
  generatedAt: string;
  registryCount: number;
  itemCount: number;
  registries: ModelImageCatalogRemoteRegistryItem[];
  errors: Array<{ url: string; message: string }>;
  governance: {
    excludesSecretValues: true;
    storesDockerCredentials: false;
    storesEnvValues: false;
    sendsCredentials: false;
    configuredUrlsEnv: string;
    workspaceRegistryPath: string;
    timeoutMs: number;
    maxPayloadBytes: number;
  };
}

export interface ModelImageCatalogSyncRemoteResult extends ModelImageCatalogMergeResult {
  remote: ModelImageCatalogRemoteRegistryResult;
  mergedRegistryCount: number;
}

export interface ModelImageCatalogCentralStatus {
  format: "agent-flow-builder.model-image-catalog-central-status.v1";
  generatedAt: string;
  configured: boolean;
  urlConfigured: boolean;
  tokenConfigured: boolean;
  timeoutMs: number;
  invalidReason: string | null;
  lastSyncedAt: string | null;
  statusCode: number | null;
  pushedItemCount: number | null;
  pulledItemCount: number | null;
  error: string | null;
  governance: {
    excludesSecretValues: true;
    storesDockerCredentials: false;
    storesEnvValues: false;
    sendsDockerCredentials: false;
    sendsEnvValues: false;
    sendsCatalog: true;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
    storesCentralToken: false;
    configuredUrlEnv: string;
    configuredTokenEnv: string;
    configuredTimeoutEnv: string;
    maxPayloadBytes: number;
  };
}

export interface ModelImageCatalogSyncCentralResult extends ModelImageCatalogMergeResult {
  central: ModelImageCatalogCentralStatus;
  pushedItemCount: number;
  pulledItemCount: number;
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
  target: "fastapi-runtime" | "runtime-manifest-bundle" | null;
  flowId: string | null;
  flowVersion: string | null;
  flowHash: string | null;
  resourceName: string | null;
  agents: DockerRuntimeAgent[];
  runtimeUrl: string;
  docsUrl: string;
  openapiUrl: string;
  ports: DockerRuntimePorts;
  modelSetup: DockerRuntimeModelSetup;
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
  smokeFailure?: DockerRuntimeSmokeFailure;
  smokeAll?: DockerRuntimeSmokeAllResult;
  gpuProbe?: DockerRuntimeGpuProbe;
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
  smokeFailure?: DockerRuntimeSmokeFailure;
  smokeAll?: DockerRuntimeSmokeAllResult;
  gpuProbe?: DockerRuntimeGpuProbe;
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
  level?: DockerRuntimeHistoryLevel;
  progressStage?: string;
  progressStatus?: DockerRuntimeProgressStatus;
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

export interface FlowWorkspaceSecretPolicyProfile {
  id: string;
  name: string;
  description: string;
  requiredEnvNames: string[];
  protectedEnvNames: string[];
  createdAt: string;
  updatedAt: string;
}

export interface FlowWorkspaceSecretPolicyProfilePackage {
  format: "agent-flow-builder.secret-policy-profiles.v1";
  exportedAt: string;
  profileCount: number;
  profiles: FlowWorkspaceSecretPolicyProfile[];
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
  secretPolicyProfiles?: FlowWorkspaceSecretPolicyProfilePackage;
  selectedSecretPolicyProfileId?: string;
  defaultSecretPolicyProfileId?: string;
}

export interface FlowWorkspaceImportResult {
  status: "ok";
  path: string;
  flow: AgentFlow;
  prompts: number;
  schemas: number;
}

export type LocalCatalogItemKind = "prompt" | "schema" | "tool" | "agent_template" | "skill";

export interface LocalCatalogItem {
  id: string;
  kind: LocalCatalogItemKind;
  name: string;
  description: string;
  tags: string[];
  scope: "local";
  source: "builtin" | "local";
  version: string;
  revision: number;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
  content?: string;
  nodePatch?: Record<string, unknown>;
  history: LocalCatalogRevision[];
}

export interface LocalCatalogRevision {
  version: string;
  revision: number;
  contentHash: string;
  updatedAt: string;
  name: string;
  description: string;
  tags: string[];
  content?: string;
  nodePatch?: Record<string, unknown>;
}

export interface LocalCatalogCreateFlowResult extends CreatedFlowWorkspace {
  item: LocalCatalogItem;
}

export interface LocalCatalog {
  format: "agent-flow-builder.local-catalog.v1";
  path: string;
  items: LocalCatalogItem[];
}

export interface LocalCatalogSharedSyncInfo {
  action: "empty" | "load" | "merge" | "resolve" | "curate_conflict";
  storage: string;
  updatedAt: string;
  contentHash: string;
  incomingCount: number;
  existingCount: number;
  addedCount: number;
  updatedCount: number;
  unchangedCount: number;
  conflictCount: number;
  finalCount: number;
  governance: {
    excludesSecretValues: true;
    excludesRawCatalogContent: false;
    excludesRawConflictContent: true;
  };
}

export type LocalCatalogLibraryConflictResolution = "keep_library" | "use_incoming" | "restore_existing_snapshot";
export type LocalCatalogLibraryConflictCurationAction = "assign" | "release";
export type LocalCatalogLibraryConflictCurationLastAction =
  | LocalCatalogLibraryConflictCurationAction
  | "resolve"
  | "lease_expired";
export type LocalCatalogLibraryConflictCurationStatus = "unassigned" | "assigned" | "resolved";
export type LocalCatalogLibraryConflictCuratorRole = "owner" | "reviewer" | "viewer";
export type LocalCatalogLibraryConflictSelectedSnapshot = "current_library" | "incoming_snapshot" | "existing_snapshot";
export type LocalCatalogLibraryConflictContentAction =
  | "current_content_retained"
  | "selected_content_already_current"
  | "manual_content_reapply_required";
export type LocalCatalogLibraryConflictMetadataAction =
  | "current_metadata_retained"
  | "selected_metadata_already_current"
  | "selected_metadata_applied"
  | "manual_content_review_first";

export interface LocalCatalogLibraryConflictSnapshot {
  id: string;
  kind: LocalCatalogItemKind;
  name: string;
  description: string;
  tags: string[];
  version: string;
  revision: number;
  contentHash: string;
  itemHash: string;
  updatedAt: string;
  historyCount: number;
  hasContent: boolean;
  hasNodePatch: boolean;
}

export interface LocalCatalogLibraryConflictResolutionPlan {
  selectedSnapshot: LocalCatalogLibraryConflictSelectedSnapshot;
  requestedResolution: LocalCatalogLibraryConflictResolution;
  currentItemHash: string;
  selectedItemHash: string;
  currentContentHash: string;
  selectedContentHash: string;
  contentAction: LocalCatalogLibraryConflictContentAction;
  metadataAction: LocalCatalogLibraryConflictMetadataAction;
  metadataFieldsChanged: string[];
  requiresManualContentReview: boolean;
  governance: {
    excludesRawCatalogContent: true;
    excludesSecretValues: true;
  };
}

export interface LocalCatalogLibraryConflictCurationThread {
  status: LocalCatalogLibraryConflictCurationStatus;
  assignee: string;
  openedAt: string | null;
  updatedAt: string | null;
  lastActor: string;
  lastAction: LocalCatalogLibraryConflictCurationLastAction | null;
  leaseExpiresAt: string | null;
  leaseDurationHours: number | null;
  leaseExpired: boolean;
  note: string;
  events: LocalCatalogLibraryConflictCurationEvent[];
  governance: {
    excludesRawCatalogContent: true;
    excludesSecretValues: true;
    autoReleasesExpiredAssignments: true;
    configuredLeaseHoursEnv: string;
  };
}

export interface LocalCatalogLibraryConflictCurationEvent {
  id: string;
  at: string;
  actor: string;
  action: LocalCatalogLibraryConflictCurationLastAction;
  assignee: string;
  role: LocalCatalogLibraryConflictCuratorRole;
  note: string;
}

export interface LocalCatalogLibraryConflict {
  id: string;
  itemKey: string;
  itemId: string;
  kind: LocalCatalogItemKind;
  status: "open" | "resolved";
  reason: string;
  curationThread: LocalCatalogLibraryConflictCurationThread;
  existingSnapshot: LocalCatalogLibraryConflictSnapshot;
  incomingSnapshot: LocalCatalogLibraryConflictSnapshot;
  existingUpdatedAt: string;
  incomingUpdatedAt: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string;
  resolvedRole: LocalCatalogLibraryConflictCuratorRole;
  resolution: LocalCatalogLibraryConflictResolution | null;
  resolutionNote: string;
  resolutionPlan: LocalCatalogLibraryConflictResolutionPlan | null;
}

export interface LocalCatalogLibraryResolutionRecord {
  resolutionId: string;
  conflictId: string;
  itemKey: string;
  itemId: string;
  kind: LocalCatalogItemKind;
  resolvedAt: string;
  resolvedBy: string;
  resolvedRole: LocalCatalogLibraryConflictCuratorRole;
  resolution: LocalCatalogLibraryConflictResolution;
  resolutionNote: string;
  keptSnapshot: LocalCatalogLibraryConflictSnapshot;
  discardedSnapshots: LocalCatalogLibraryConflictSnapshot[];
  governance: {
    excludesRawCatalogContent: true;
    excludesSecretValues: true;
  };
}

export interface LocalCatalogSharedLibraryPackage {
  format: "agent-flow-builder.catalog-library.v1";
  exportedAt: string;
  itemCount: number;
  conflictCount: number;
  openConflictCount: number;
  conflicts: LocalCatalogLibraryConflict[];
  resolutionHistoryCount: number;
  resolutionHistory: LocalCatalogLibraryResolutionRecord[];
  items: LocalCatalogItem[];
  packageHash: string;
  sharedSync: LocalCatalogSharedSyncInfo;
}

export type LocalCatalogConflictReviewDiffItemStatus = "unchanged" | "changed" | "only_current" | "only_incoming";

export interface LocalCatalogConflictReviewPackage {
  format: "agent-flow-builder.catalog-conflict-review.v1";
  exportedAt: string;
  source: {
    storage: string;
    packageHash: string;
    contentHash: string;
    itemCount: number;
  };
  summary: {
    itemCount: number;
    conflictCount: number;
    openConflictCount: number;
    resolutionHistoryCount: number;
    promptConflictCount: number;
    schemaConflictCount: number;
    toolConflictCount: number;
    agentTemplateConflictCount: number;
    skillConflictCount: number;
    assignedConflictCount: number;
    unassignedConflictCount: number;
    resolvedThreadCount: number;
  };
  conflictCount: number;
  openConflictCount: number;
  conflicts: LocalCatalogLibraryConflict[];
  resolutionHistoryCount: number;
  resolutionHistory: LocalCatalogLibraryResolutionRecord[];
  packageHash: string;
  governance: {
    excludesRawCatalogContent: true;
    excludesRawConflictContent: true;
    excludesSecretValues: true;
  };
}

export interface LocalCatalogConflictReviewDiffItem {
  id: string;
  label: string;
  status: LocalCatalogConflictReviewDiffItemStatus;
  currentHash: string | null;
  incomingHash: string | null;
  currentSummary: string | null;
  incomingSummary: string | null;
}

export interface LocalCatalogConflictReviewDiffSection {
  id: "summary" | "conflicts" | "resolution_history";
  label: string;
  itemCount: number;
  changedCount: number;
  items: LocalCatalogConflictReviewDiffItem[];
}

export interface LocalCatalogConflictReviewDiffPackage {
  format: "agent-flow-builder.catalog-conflict-review-diff.v1";
  comparedAt: string;
  current: {
    packageHash: string;
    exportedAt: string;
    conflictCount: number;
    openConflictCount: number;
    resolutionHistoryCount: number;
  };
  incoming: {
    packageHash: string;
    exportedAt: string;
    conflictCount: number;
    openConflictCount: number;
    resolutionHistoryCount: number;
  };
  sections: LocalCatalogConflictReviewDiffSection[];
  packageHash: string;
  governance: {
    excludesRawCatalogContent: true;
    excludesRawConflictContent: true;
    excludesSecretValues: true;
  };
}

export interface LocalCatalogSharedSyncResult {
  status: "ok";
  sharedLibrary: LocalCatalogSharedLibraryPackage;
  catalog: LocalCatalog;
}

export interface LocalCatalogCentralSyncStatus {
  format: "agent-flow-builder.catalog-central-sync-status.v1";
  generatedAt: string;
  configured: boolean;
  urlConfigured: boolean;
  tokenConfigured: boolean;
  timeoutMs: number;
  invalidReason: string | null;
  lastSyncedAt: string | null;
  statusCode: number | null;
  pushedItemCount: number | null;
  pulledItemCount: number | null;
  error: string | null;
  governance: {
    excludesSecretValues: true;
    sendsRawCatalogContent: true;
    sendsRawConflictContent: false;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
    storesCentralToken: false;
    configuredUrlEnv: string;
    configuredTokenEnv: string;
    configuredTimeoutEnv: string;
    maxPayloadBytes: number;
  };
}

export interface LocalCatalogCentralSyncResult {
  format: "agent-flow-builder.catalog-central-sync-result.v1";
  sharedLibrary: LocalCatalogSharedLibraryPackage;
  catalog: LocalCatalog;
  central: LocalCatalogCentralSyncStatus;
  pushedItemCount: number;
  pulledItemCount: number;
  governance: {
    excludesSecretValues: true;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
  };
}

export interface LocalCatalogItemPackage {
  format: "agent-flow-builder.catalog-item.v1";
  exportedAt: string;
  source: {
    kind: LocalCatalogItemKind;
    id: string;
    name: string;
    contentHash: string;
    revision: number;
  };
  item: {
    id: string;
    kind: LocalCatalogItemKind;
    name: string;
    description?: string;
    tags?: string[];
    version?: string;
    content?: string;
    nodePatch?: Record<string, unknown>;
  };
}

export interface LocalCatalogApplyResult {
  status: "ok";
  item: LocalCatalogItem;
  flow: AgentFlow;
  flowPath: string;
  prompt?: FlowAssetContent;
  schema?: FlowAssetContent;
  node?: FlowNode;
}

export interface LocalCatalogSaveResult {
  status: "ok";
  item: LocalCatalogItem;
  catalog: LocalCatalog;
}

export interface BuilderAuthInventoryKey {
  keyId: string;
  actorId: string;
  name: string;
  role: string;
  groups: string[];
  areas: string[];
  scopes: string[];
  source: string;
  disabled: boolean;
  expired: boolean;
  expiresAt: string | null;
  hashPrefix: string;
}

export interface BuilderAuthStatus {
  enabled: boolean;
  required: boolean;
  keyCount: number;
  activeKeyCount: number;
  keys: BuilderAuthInventoryKey[];
  jwt: {
    configured: boolean;
    algorithms: string[];
    issuerConfigured: boolean;
    audienceConfigured: boolean;
    jwks: {
      configured: boolean;
      pathConfigured: boolean;
      urlConfigured: boolean;
      keyCount: number;
      cacheSeconds: number;
      storesPublicKeysOnly: true;
    };
    oidc: {
      configured: boolean;
      issuerConfigured: boolean;
      discoveryUrlConfigured: boolean;
      discoveredJwks: boolean;
      loginConfigured: boolean;
      logoutConfigured: boolean;
      authorizationEndpointConfigured: boolean;
      tokenEndpointConfigured: boolean;
      endSessionEndpointConfigured: boolean;
      redirectUriConfigured: boolean;
      postLogoutRedirectUriConfigured: boolean;
      logoutCallbackSupported: boolean;
      sessionIdTokenHintSupported: boolean;
      sessionRefreshSupported: boolean;
      usesDiscoveryCache: true;
    };
    actorClaim: string;
    roleClaim: string;
    groupsClaim: string;
    areasClaim: string;
    scopesClaim: string;
    acceptsBearer: true;
    storesJwtSecrets: false;
  };
  rotation: {
    fileConfigured: boolean;
    canWriteFile: boolean;
    storesKeyHashes: true;
    returnsRawKeyOnce: true;
  };
  sessions: {
    ttlSeconds: number;
    persistent: boolean;
    pathConfigured: boolean;
    centralLocalStore: boolean;
    externalServiceConfigured: boolean;
    externalServiceUrlConfigured: boolean;
    externalServiceTokenConfigured: boolean;
    externalServiceTimeoutMs: number;
    externalServiceInvalidReason: string | null;
    centralIntrospectionConfigured: boolean;
    centralIntrospectionRequired: boolean;
    centralIntrospectionUrlConfigured: boolean;
    centralIntrospectionTokenConfigured: boolean;
    centralIntrospectionTimeoutMs: number;
    centralIntrospectionInvalidReason: string | null;
    storesTokenHashes: true;
    storesRawTokens: false;
    storesProviderTokens: false;
    externalServiceSendsTokenHashes: true;
    externalServiceSendsRawTokens: false;
    externalServiceNonBlocking: true;
    centralIntrospectionSendsTokenHashes: true;
    centralIntrospectionSendsRawTokens: false;
    centralIntrospectionEnforcesCentralDecision: boolean;
    centralIntrospectionFailClosed: boolean;
  };
  audit: {
    persistent: boolean;
    pathConfigured: boolean;
    externalSinkConfigured: boolean;
    externalSinkUrlConfigured: boolean;
    externalSinkTokenConfigured: boolean;
    externalSinkTimeoutMs: number;
    externalSinkInvalidReason: string | null;
    sendsRawKeyValues: false;
    sendsHeaders: false;
    nonBlocking: true;
  };
  groupPolicies: {
    configured: boolean;
    pathConfigured: boolean;
    policyCount: number;
    groups: string[];
    governance: {
      excludesRawTokens: true;
      excludesSecretValues: true;
      localOnly: true;
    };
  };
  groupDirectory: {
    configured: boolean;
    pathConfigured: boolean;
    externalConfigured: boolean;
    externalUrlConfigured: boolean;
    externalTokenConfigured: boolean;
    externalTimeoutMs: number;
    externalInvalidReason: string | null;
    actorCount: number;
    groupCount: number;
    groups: string[];
    governance: {
      excludesRawTokens: true;
      excludesSecretValues: true;
      enrichesIdentityGroups: true;
      externalSendsActorSecrets: false;
      localOnly: boolean;
    };
  };
  governance: {
    excludesRawKeyValues: true;
    excludesJwtSecrets: true;
    localOnly: true;
  };
}

export interface BuilderAuthExternalProbeComponent {
  id: "session_service" | "session_introspection" | "audit_sink" | "group_directory";
  label: string;
  configured: boolean;
  urlConfigured: boolean;
  tokenConfigured: boolean;
  timeoutMs: number;
  status: "not_configured" | "invalid_config" | "ok" | "warning" | "error";
  statusCode: number | null;
  reason: string;
  actorCount?: number;
  groupCount?: number;
  governance: {
    excludesUrls: true;
    excludesSecretValues: true;
    sendsAuthTokenInHeaderOnly: true;
    sendsAuthTokenInBody: false;
    sendsRawKeyValues: false;
    sendsSessionTokens: false;
    sendsProviderTokens: false;
    usesSideEffectFreeProbe: boolean;
  };
}

export interface BuilderAuthExternalProbeResult {
  format: "agent-flow-builder.builder-auth-external-probe.v1";
  generatedAt: string;
  configuredCount: number;
  checkedCount: number;
  okCount: number;
  warningCount: number;
  errorCount: number;
  components: BuilderAuthExternalProbeComponent[];
  governance: {
    excludesUrls: true;
    excludesSecretValues: true;
    excludesRawKeyValues: true;
    excludesHeaders: true;
    excludesSessionTokens: true;
    excludesProviderTokens: true;
    authTokensInHeaderOnly: true;
    authTokensInBody: false;
    usesSideEffectFreeProbe: true;
  };
}

export interface BuilderAuthCorporateHomologationResult {
  format: "agent-flow-builder.builder-auth-corporate-homologation.v1";
  generatedAt: string;
  status: "blocked" | "verified" | "homologated";
  homologationLevel: "none" | "partial_external_probe" | "full_external_probe";
  requiredComponentCount: number;
  configuredCount: number;
  checkedCount: number;
  okCount: number;
  warningCount: number;
  errorCount: number;
  missingEvidence: string[];
  artifact: {
    saved: boolean;
    relativePath: string | null;
  };
  statusSnapshot: {
    authRequired: boolean;
    activeKeyCount: number;
    jwtConfigured: boolean;
    oidcConfigured: boolean;
    centralLocalSessionStore: boolean;
    sessionServiceConfigured: boolean;
    centralIntrospectionConfigured: boolean;
    centralIntrospectionRequired: boolean;
    auditSinkConfigured: boolean;
    groupDirectoryExternalConfigured: boolean;
    groupPoliciesConfigured: boolean;
  };
  components: BuilderAuthExternalProbeComponent[];
  governance: {
    excludesUrls: true;
    excludesSecretValues: true;
    excludesRawKeyValues: true;
    excludesHeaders: true;
    excludesSessionTokens: true;
    excludesProviderTokens: true;
    excludesResolvedLocalPaths: true;
    storesHomologationArtifactLocally: boolean;
    authTokensInHeaderOnly: true;
    authTokensInBody: false;
    usesSideEffectFreeProbe: true;
  };
}

export interface StudioNodePinsPackage {
  format: "agent-flow-builder.studio-node-pins.v1";
  exportedAt: string;
  flowId: string;
  packageHash: string;
  pinCount: number;
  pins: Array<{
    id: string;
    nodeId: string;
    nodeType: string;
    runId: string;
    sessionId: string;
    eventSeq: number;
    eventType: string;
    nodeHash: string;
    input: unknown;
    output: unknown;
    createdAt: string;
    updatedAt: string;
  }>;
  conflictCount?: number;
  openConflictCount?: number;
  conflicts?: Array<{
    conflictId: string;
    status: "open";
    nodeId: string;
    pinCount: number;
    pinIds: string[];
    latestPinId: string;
    latestUpdatedAt: string;
    refs: Array<{
      id: string;
      nodeId: string;
      nodeType: string;
      runId: string;
      sessionId: string;
      eventSeq: number;
      eventType: string;
      nodeHash: string;
      updatedAt: string;
      contentHash: string;
    }>;
    curationThread?: StudioNodePinConflictCurationThread;
  }>;
  resolutionHistoryCount?: number;
  resolutionHistory?: Array<{
    resolutionId: string;
    conflictId: string;
    nodeId: string;
    resolvedAt: string;
    resolvedBy: string;
    resolvedRole: StudioNodePinConflictCuratorRole;
    resolutionNote: string;
    keptPinId: string;
    keptRef: {
      id: string;
      nodeId: string;
      nodeType: string;
      runId: string;
      sessionId: string;
      eventSeq: number;
      eventType: string;
      nodeHash: string;
      updatedAt: string;
      contentHash: string;
    };
    discardedRefs: Array<{
      id: string;
      nodeId: string;
      nodeType: string;
      runId: string;
      sessionId: string;
      eventSeq: number;
      eventType: string;
      nodeHash: string;
      updatedAt: string;
      contentHash: string;
    }>;
    candidateCount: number;
    governance: {
      excludesSecretValues: true;
      excludesRawPinInputOutput: true;
      redactsSecretLikeKeys: true;
    };
  }>;
  sharedSync: {
    action: "empty" | "save" | "merge" | "resolve_conflict" | "curate_conflict";
    updatedAt: string;
    storage: string;
    contentHash: string;
    incomingCount: number;
    existingCount: number;
    addedCount: number;
    updatedCount: number;
    unchangedCount: number;
    finalCount: number;
    conflictCount?: number;
    openConflictCount?: number;
    governance: {
      includesPinInputOutput: true;
      redactsSecretLikeKeys: true;
      excludesSecretValues: true;
      excludesHeaders: true;
    };
  };
  governance: {
    includesPinInputOutput: true;
    redactsSecretLikeKeys: true;
    excludesSecretValues: true;
    excludesHeaders: true;
    localWorkspaceFile: true;
  };
}

export type StudioNodePinConflictCurationAction = "assign" | "release";
export type StudioNodePinConflictCurationLastAction = StudioNodePinConflictCurationAction | "resolve" | "lease_expired";
export type StudioNodePinConflictCurationStatus = "unassigned" | "assigned" | "resolved";
export type StudioNodePinConflictCuratorRole = "owner" | "reviewer" | "viewer";

export interface StudioNodePinConflictCurationThread {
  status: StudioNodePinConflictCurationStatus;
  assignee: string;
  openedAt: string | null;
  updatedAt: string | null;
  lastActor: string;
  lastAction: StudioNodePinConflictCurationLastAction | null;
  leaseExpiresAt: string | null;
  leaseDurationHours: number | null;
  leaseExpired: boolean;
  note: string;
  events: StudioNodePinConflictCurationEvent[];
  governance: {
    excludesRawPinInputOutput: true;
    redactsSecretLikeKeys: true;
    excludesSecretValues: true;
    autoReleasesExpiredAssignments?: true;
    configuredLeaseHoursEnv?: string;
  };
}

export interface StudioNodePinConflictCurationEvent {
  id: string;
  at: string;
  actor: string;
  role: StudioNodePinConflictCuratorRole;
  action: StudioNodePinConflictCurationLastAction;
  assignee: string;
  note: string;
}

export interface BuilderAuthAuditEntry {
  seq: number;
  at: string;
  status: "allowed" | "missing" | "rejected";
  method: string;
  route: string;
  keyId: string | null;
  actorId: string | null;
  source: string | null;
  reason: string | null;
}

export interface BuilderAuthAuditQuery {
  limit?: number;
  status?: BuilderAuthAuditEntry["status"];
  method?: string;
  route?: string;
  keyId?: string;
  actorId?: string;
  q?: string;
  from?: string;
  to?: string;
}

export interface BuilderAuthAuditCounter {
  id: string;
  count: number;
  allowed: number;
  missing: number;
  rejected: number;
}

export interface BuilderAuthAuditReport {
  format: "agent-flow-builder.builder-auth-audit.v1";
  generatedAt: string;
  total: number;
  filteredTotal: number;
  query: {
    limit: number;
    status: BuilderAuthAuditEntry["status"] | null;
    method: string | null;
    route: string | null;
    keyId: string | null;
    actorId: string | null;
    q: string | null;
    from: string | null;
    to: string | null;
  };
  summary: {
    returnedCount: number;
    statusCounts: Record<BuilderAuthAuditEntry["status"], number>;
    uniqueActorCount: number;
    uniqueKeyCount: number;
    topActors: BuilderAuthAuditCounter[];
    topKeys: BuilderAuthAuditCounter[];
    topRoutes: BuilderAuthAuditCounter[];
    earliestAt: string | null;
    latestAt: string | null;
  };
  entries: BuilderAuthAuditEntry[];
  governance: {
    excludesRawKeyValues: true;
    excludesHeaders: true;
    localOnly: boolean;
    persistent: boolean;
    pathConfigured: boolean;
    externalSinkConfigured: boolean;
    externalSinkNonBlocking: true;
    externalSinkSendsRawKeyValues: false;
    externalSinkSendsHeaders: false;
    loadedFromPersistentStore: boolean;
    persistentEntryCount: number;
    malformedPersistentLineCount: number;
  };
}

export interface BuilderAuthKeyRotationResult {
  format: "agent-flow-builder.builder-auth-key-rotation.v1";
  generatedAt: string;
  keyValue: string;
  key: BuilderAuthInventoryKey;
  status: BuilderAuthStatus;
  governance: {
    storesRawKeyValue: false;
    storesKeyHash: true;
    returnsRawKeyValueOnce: true;
    excludesExistingRawKeyValues: true;
    localOnly: true;
  };
}

export interface BuilderAuthSessionResult {
  format: "agent-flow-builder.builder-auth-session.v1";
  generatedAt: string;
  token: string;
  expiresAt: string;
  ttlSeconds: number;
  identity: {
    keyId: string;
    actorId: string;
    name: string;
    role: string;
    groups: string[];
    areas: string[];
    scopes: string[];
    source: string;
    expiresAt: string | null;
  };
  governance: {
    storesRawToken: false;
    storesTokenHash: true;
    returnsRawTokenOnce: true;
    storesProviderLogoutHint: boolean;
    storesProviderRefreshToken: boolean;
    returnsProviderTokens: false;
    localOnly: true;
  };
}

export interface BuilderAuthSessionLogoutResult {
  format: "agent-flow-builder.builder-auth-session-logout.v1";
  generatedAt: string;
  revoked: boolean;
  identity: BuilderAuthSessionResult["identity"] | null;
  governance: {
    storesRawToken: false;
    storesTokenHash: true;
    returnsRawToken: false;
    removesProviderLogoutHint: true;
    removesProviderRefreshToken: true;
    localOnly: true;
  };
}

export interface BuilderAuthOidcLoginResult {
  format: "agent-flow-builder.builder-auth-oidc-login.v1";
  generatedAt: string;
  authorizationUrl: string;
  state: string;
  expiresAt: string;
  issuer: string | null;
  authorizationEndpoint: string;
  redirectUri: string;
  scopes: string[];
  governance: {
    usesPkce: true;
    storesStateHash: true;
    storesNonceHash: true;
    storesProviderTokens: false;
    localOnly: true;
  };
}

export interface BuilderAuthOidcLogoutResult {
  format: "agent-flow-builder.builder-auth-oidc-logout.v1";
  generatedAt: string;
  logoutUrl: string;
  state: string;
  expiresAt: string;
  issuer: string | null;
  endSessionEndpoint: string;
  postLogoutRedirectUri: string | null;
  governance: {
    storesStateHash: true;
    storesProviderTokens: "id_token_hint_session_memory_only" | false;
    sendsIdTokenHint: boolean;
    validatesCallbackState: true;
    returnsProviderTokens: false;
    returnsIdTokenHintInLogoutUrl: boolean;
    localOnly: true;
  };
}

export interface BuilderAuthOidcLogoutCallbackResult {
  format: "agent-flow-builder.builder-auth-oidc-logout-callback.v1";
  generatedAt: string;
  state: string;
  issuer: string | null;
  postLogoutRedirectUri: string | null;
  identity: BuilderAuthSessionResult["identity"] | null;
  governance: {
    validatesState: true;
    returnsProviderTokens: false;
    localOnly: true;
  };
}

export interface BuilderAuthOidcCallbackResult {
  format: "agent-flow-builder.builder-auth-oidc-callback.v1";
  generatedAt: string;
  session: BuilderAuthSessionResult;
  identity: BuilderAuthSessionResult["identity"];
  governance: {
    validatesState: true;
    validatesNonce: true;
    validatesIdTokenSignature: true;
    storesProviderTokens: "id_token_hint_session_memory_only" | "id_token_hint_and_refresh_token_session_memory_only";
    storesProviderLogoutHint: true;
    storesProviderRefreshToken: boolean;
    returnsProviderTokens: false;
    localOnly: true;
  };
}

export type WorkspaceGovernanceRole = "owner" | "reviewer" | "operator" | "viewer";
export type WorkspaceGovernanceAction =
  | "read"
  | "write"
  | "merge"
  | "resolve_conflict"
  | "approve"
  | "export"
  | "run"
  | "manage_secrets"
  | "deliver_runtime";

export interface WorkspaceGovernanceParticipant {
  id: string;
  name: string;
  role: WorkspaceGovernanceRole;
  areas: string[];
  status: "active" | "inactive";
  updatedAt: string;
  updatedBy: string;
}

export interface WorkspaceGovernancePolicy {
  area: string;
  mode: "open" | "review_required" | "owner_required" | "disabled";
  requiredRole: WorkspaceGovernanceRole;
  updatedAt: string;
  updatedBy: string;
}

export interface WorkspaceGovernanceConflict {
  id: string;
  participantId: string;
  status: "open" | "resolved";
  resolution: "keep_existing" | "use_incoming" | null;
  existingSnapshot: WorkspaceGovernanceParticipant;
  incomingSnapshot: WorkspaceGovernanceParticipant;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string;
}

export interface WorkspaceGovernanceAuditEntry {
  id: string;
  action: string;
  actor: string;
  at: string;
  summary: string;
  participantId: string | null;
  area: string | null;
  conflictId: string | null;
}

export interface WorkspaceGovernancePackage {
  format: "agent-flow-builder.workspace-governance.v1";
  exportedAt: string;
  storagePath: string;
  participantCount: number;
  activeParticipantCount: number;
  ownerCount: number;
  policyCount: number;
  conflictCount: number;
  openConflictCount: number;
  participants: WorkspaceGovernanceParticipant[];
  policies: WorkspaceGovernancePolicy[];
  conflicts: WorkspaceGovernanceConflict[];
  auditCount: number;
  auditEntries: WorkspaceGovernanceAuditEntry[];
  governance: {
    excludesSecretValues: true;
    excludesEnvValues: true;
    excludesRawRuns: true;
    localOnly: true;
    authEnforced: false;
  };
}

export interface WorkspaceGovernanceDecision {
  format: "agent-flow-builder.workspace-governance-decision.v1";
  evaluatedAt: string;
  actorId: string;
  actorName: string;
  participantStatus: "active" | "inactive" | "missing";
  role: WorkspaceGovernanceRole | null;
  area: string;
  action: WorkspaceGovernanceAction;
  allowed: boolean;
  enforcementMode: "advisory" | "enforced";
  effect: "allowed" | "would_block" | "blocked";
  requiredRole: WorkspaceGovernanceRole;
  policy: {
    area: string;
    mode: "open" | "review_required" | "owner_required" | "disabled";
    requiredRole: WorkspaceGovernanceRole;
  };
  reasons: string[];
  governance: {
    localOnly: true;
    excludesSecretValues: true;
    excludesEnvValues: true;
    excludesRawRuns: true;
    authEnforced: boolean;
  };
}

export type CollaborationConflictSeverity = "clear" | "attention" | "blocked" | "error";

export interface CollaborationConflictFilters {
  flowId: string | null;
  area: string | null;
  severity: CollaborationConflictSeverity | null;
  responsible: string | null;
  role: string | null;
  status: string | null;
}

export interface CollaborationConflictDecision {
  decidedAt: string | null;
  decidedBy: string;
  decision: string;
}

export interface CollaborationConflictSourceActions {
  reviewPath: string;
  diffPath: string | null;
  curationPathTemplate: string | null;
  resolvePathTemplate: string | null;
  viewerMutationBlocked: true;
}

export interface CollaborationConflictAreaSummary {
  id: string;
  label: string;
  scope: "workspace" | "flow";
  governanceArea: string;
  flowId: string | null;
  reviewPath: string;
  sourceActions: CollaborationConflictSourceActions;
  severity: CollaborationConflictSeverity;
  conflictCount: number;
  openConflictCount: number;
  assignedConflictCount: number;
  unassignedConflictCount: number;
  expiredLeaseCount: number;
  resolutionHistoryCount: number;
  latestDecision: CollaborationConflictDecision | null;
  loadError: string | null;
}

export interface CollaborationConflictItem {
  areaId: string;
  areaLabel: string;
  governanceArea: string;
  scope: "workspace" | "flow";
  flowId: string | null;
  conflictId: string;
  status: string;
  subject: string;
  responsible: string;
  role: string;
  severity: CollaborationConflictSeverity;
  openedAt: string | null;
  updatedAt: string | null;
  leaseExpiresAt: string | null;
  leaseExpired: boolean;
  lastAction: string;
  latestDecision: CollaborationConflictDecision | null;
  sourceActions: CollaborationConflictSourceActions;
}

export interface CollaborationConflictFilterOption {
  value: string;
  label: string;
  count: number;
}

export interface CollaborationConflictAreaFilterOption extends CollaborationConflictFilterOption {
  governanceArea: string;
  flowId: string | null;
  openConflictCount: number;
}

export interface CollaborationConflictOverview {
  format: "agent-flow-builder.collaboration-conflict-overview.v1";
  generatedAt: string;
  scope: {
    flowId: string | null;
    includedFlowIds: string[];
  };
  filters: CollaborationConflictFilters;
  totals: {
    areaCount: number;
    flowCount: number;
    conflictCount: number;
    openConflictCount: number;
    assignedConflictCount: number;
    unassignedConflictCount: number;
    expiredLeaseCount: number;
    resolutionHistoryCount: number;
    blockedAreaCount: number;
    errorAreaCount: number;
  };
  filteredTotals: {
    conflictCount: number;
    openConflictCount: number;
    assignedConflictCount: number;
    unassignedConflictCount: number;
    expiredLeaseCount: number;
  };
  filterOptions: {
    areas: CollaborationConflictAreaFilterOption[];
    severities: CollaborationConflictFilterOption[];
    responsible: CollaborationConflictFilterOption[];
    roles: CollaborationConflictFilterOption[];
    statuses: CollaborationConflictFilterOption[];
  };
  areas: CollaborationConflictAreaSummary[];
  conflicts: CollaborationConflictItem[];
  packageHash: string;
  governance: {
    usesGovernedConflictReviewsOnly: true;
    excludesRawSchemas: true;
    excludesRawPrompts: true;
    excludesRawInputOutput: true;
    excludesHeaders: true;
    excludesTokens: true;
    excludesPayloads: true;
    excludesSecretValues: true;
    viewerMutationBlockedBySourceRoutes: true;
    localWorkspaceOnly: true;
  };
}

export interface CollaborationConflictOverviewDiffPackage {
  format: "agent-flow-builder.collaboration-conflict-overview-diff.v1";
  generatedAt: string;
  basePackageHash: string;
  comparedPackageHash: string;
  scope: {
    current: CollaborationConflictOverview["scope"];
    compared: CollaborationConflictOverview["scope"];
  };
  filters: {
    current: CollaborationConflictFilters;
    compared: CollaborationConflictFilters;
  };
  summary: {
    status: "unchanged" | "changed";
    areaCountDelta: number;
    conflictCountDelta: number;
    openConflictDelta: number;
    assignedConflictDelta: number;
    unassignedConflictDelta: number;
    expiredLeaseDelta: number;
    resolutionHistoryDelta: number;
  };
  sections: Array<{
    id: string;
    label: string;
    status: "unchanged" | "changed";
    currentCount: number;
    comparedCount: number;
    changedCount: number;
    entries: Array<{
      id: string;
      label: string;
      status: "unchanged" | "changed" | "added" | "removed";
      currentHash: string | null;
      comparedHash: string | null;
      detail: string;
    }>;
  }>;
  packageHash: string;
  governance: {
    usesGovernedConflictReviewsOnly: true;
    excludesRawSchemas: true;
    excludesRawPrompts: true;
    excludesRawInputOutput: true;
    excludesHeaders: true;
    excludesTokens: true;
    excludesPayloads: true;
    excludesSecretValues: true;
    comparesHashesAndGovernedRefsOnly: true;
    localWorkspaceOnly: true;
  };
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
  agent_id: string;
  status: string;
  phase: string;
  turn: number;
  max_turns: number;
  metadata: Record<string, unknown>;
  is_complete: boolean;
}

export interface RuntimeTurnResponse {
  session: SessionView;
  assistant_message: {
    code: string;
    text: string;
  };
  safety?: Record<string, unknown>;
  can_finish?: boolean;
}

export interface RuntimeOrchestrationDebugTraceEvent {
  seq: number;
  at: string;
  type: string;
  status: string;
  step_index?: number;
  agent_id?: string;
  to_agent_id?: string;
  route_prefix?: string;
  session_id?: string;
  condition?: string;
  handoff_condition?: string;
  reason?: string;
  output_code?: string;
  output_preview?: string;
  error?: string;
  [key: string]: unknown;
}

export interface RuntimeOrchestrationDebugTrace {
  format: string;
  run_id: string;
  manifest_id: string;
  manifest_version: string;
  mode: string;
  entry_agent_id: string;
  started_at: string;
  finished_at: string | null;
  input: Record<string, unknown>;
  timeline: RuntimeOrchestrationDebugTraceEvent[];
  summary: {
    status?: string;
    step_count?: number;
    agent_ids?: string[];
    memory_entries?: number;
    handoff_decisions?: number;
    matched_handoffs?: number;
    timeline_events?: number;
    [key: string]: unknown;
  };
  governance: Record<string, unknown>;
}

export interface RuntimeOrchestrationStep {
  agent_id: string;
  route_prefix: string;
  resource_name: string;
  session_id: string;
  handoff_condition?: string | null;
  start?: Record<string, unknown>;
  turn?: RuntimeTurnResponse & Record<string, unknown>;
}

export interface RuntimeOrchestrationRunResult {
  format: "agent-flow-builder.runtime-orchestration-run.v1";
  manifest_id: string;
  manifest_version: string;
  mode: string;
  entry_agent_id: string;
  status: "completed" | "failed" | string;
  steps: RuntimeOrchestrationStep[];
  shared_memory: Record<string, unknown>;
  debug_trace: RuntimeOrchestrationDebugTrace;
  governance: Record<string, unknown>;
  error?: {
    message?: string;
    step_index?: number;
    [key: string]: unknown;
  };
}

export interface RuntimeTurnStreamToken {
  index: number;
  text: string;
  source?: string;
}

export type RuntimeTurnStreamEvent =
  | { event: "turn_started"; data: Record<string, unknown> }
  | { event: "token"; data: RuntimeTurnStreamToken }
  | { event: "turn_completed"; data: RuntimeTurnResponse }
  | { event: "stream_closed"; data: Record<string, unknown> }
  | { event: "turn_error"; data: Record<string, unknown> };

export interface MessageView {
  seq: number;
  role: string;
  code?: string | null;
  content: string;
  metadata: Record<string, unknown>;
}

export interface EventView {
  seq: number;
  agent_id?: string | null;
  event_type: string;
  node?: string | null;
  payload: Record<string, unknown>;
}

export interface RuntimeJobView {
  job_id: string;
  agent_id: string;
  session_id: string;
  kind: string;
  status: string;
  attempts: number;
  max_attempts: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  last_error: Record<string, unknown>;
  next_run_at: string | null;
}

export interface RuntimeJobScheduleView {
  schedule_id: string;
  agent_id: string;
  session_id: string;
  kind: string;
  status: string;
  trigger_type: string;
  interval_seconds: number;
  cron_expression: string | null;
  event_type?: string | null;
  max_attempts: number;
  payload: Record<string, unknown>;
  last_job_id: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
}

export interface RuntimeJobMetrics {
  total: number;
  by_status: Record<string, number>;
  by_kind: Record<string, number>;
  attempts_total: number;
  pending_due: number;
  failed: number;
  exhausted: number;
  succeeded: number;
  terminal: number;
  success_rate: number | null;
  duration_ms_avg: number | null;
  duration_ms_min: number | null;
  duration_ms_max: number | null;
  duration_ms_p95: number | null;
  window_hours: number;
  finished_in_window: number;
  succeeded_in_window: number;
  failed_in_window: number;
  success_rate_in_window: number | null;
  window_duration_ms_avg: number | null;
  window_duration_ms_p95: number | null;
  throughput_per_hour: number | null;
  oldest_pending_at: string | null;
  next_due_at: string | null;
  finished_last_hour: number;
  last_finished_at: string | null;
}

export interface RuntimeJobRunResponse {
  job: RuntimeJobView;
}

export interface RuntimeJobBatchResponse {
  jobs: RuntimeJobView[];
  total: number;
  succeeded: number;
  failed: number;
  errors: Array<Record<string, unknown>>;
}

export interface RuntimeJobCleanupResponse {
  dry_run: boolean;
  matched: number;
  deleted: number;
  statuses: string[];
  older_than_hours: number;
  cutoff: string;
  job_ids: string[];
  by_status: Record<string, number>;
}

export interface RuntimeJobScheduleResponse {
  schedule: RuntimeJobScheduleView;
}

export interface RuntimeJobScheduleBatchResponse {
  schedules: RuntimeJobScheduleView[];
  jobs: RuntimeJobView[];
  total: number;
  enqueued: number;
}

export interface RuntimeAuthAuditEntry {
  seq: number;
  timestamp: string;
  method: string;
  path: string;
  scope: string | null;
  status: string;
  reason: string | null;
  key_id: string | null;
  source: string;
}

export interface RuntimeAuthAudit {
  enabled: boolean;
  total: number;
  entries: RuntimeAuthAuditEntry[];
}

export interface RuntimeAuthKeyFileInfo {
  configured: boolean;
  path: string | null;
  exists?: boolean;
  mtime?: number;
  size?: number;
}

export interface RuntimeAuthKeyInfo {
  key_id: string;
  source: string;
  scopes: string[];
  expires_at: string | null;
  expired: boolean;
  revoked: boolean;
}

export interface RuntimeAuthKeys {
  enabled: boolean;
  agent_id: string;
  total: number;
  sources: Record<string, number>;
  file: RuntimeAuthKeyFileInfo;
  revocation?: {
    configured: boolean;
    total: number;
    file: RuntimeAuthKeyFileInfo;
  };
  keys: RuntimeAuthKeyInfo[];
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
  agentId: string;
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
  agentId?: string;
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
    pinnedEventCountLeft: number;
    pinnedEventCountRight: number;
    pinnedEventCountDelta: number;
    mockEventCountLeft: number;
    mockEventCountRight: number;
    mockEventCountDelta: number;
    totalTokensLeft: number | null;
    totalTokensRight: number | null;
    totalTokensDelta: number | null;
    totalCostUsdLeft: number | null;
    totalCostUsdRight: number | null;
    totalCostUsdDelta: number | null;
    runKindLeft: "live" | "mock" | "pinned" | "mixed";
    runKindRight: "live" | "mock" | "pinned" | "mixed";
  };
  regression: {
    severity: "pass" | "warn" | "fail";
    comparesPinnedToLive: boolean;
    baselineRunId: string;
    candidateRunId: string;
    verdict: string;
    reasons: string[];
    appliedThresholds: {
      tokenGrowthPct: number;
      costGrowthPct: number;
      durationGrowthPct: number;
      nodeTypeThresholds: Record<
        string,
        {
          maxChangedNodes: number | null;
          maxStateDiffs: number | null;
          maxOutputDiffs: number | null;
        }
      >;
    };
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

export interface StudioProviderTelemetryItem {
  provider: string;
  model: string;
  runCount: number;
  eventCount: number;
  errorCount: number;
  totalTokens: number;
  totalCostUsd: number;
  tokenBudgetPct: number | null;
  costBudgetPct: number | null;
  alertSeverity: "ok" | "warning";
  lastRunId: string;
  lastSessionId: string;
  lastEventSeq: number;
  updatedAt: string;
}

export interface StudioProviderTelemetryAlert {
  scope: "provider_model";
  severity: "warning";
  provider: string;
  model: string;
  metric: "tokens" | "cost";
  observed: number;
  limit: number;
  message: string;
}

export interface StudioProviderTelemetryReport {
  format: "agent-flow-builder.studio-provider-telemetry.v1";
  flowId: string;
  generatedAt: string;
  windowHours: number | null;
  windowStartedAt: string | null;
  providerTokenBudget: number | null;
  providerCostBudgetUsd: number | null;
  runCount: number;
  telemetryRunCount: number;
  eventCount: number;
  totalTokens: number;
  totalCostUsd: number;
  alertCount: number;
  alerts: StudioProviderTelemetryAlert[];
  items: StudioProviderTelemetryItem[];
}

export interface StudioProviderTelemetryQuery {
  windowHours?: number;
  providerTokenBudget?: number;
  providerCostBudgetUsd?: number;
}

export interface StudioSandboxTelemetryItem {
  nodeId: string;
  mode: string;
  status: string;
  sandboxIsolation: string;
  sandboxOrchestration: string;
  sandboxBoundary: string | null;
  sandboxExecutor: string | null;
  sandboxTransport: string | null;
  sandboxImage: string | null;
  sandboxEngine: string | null;
  sandboxNetwork: string | null;
  sandboxProfile: string | null;
  sandboxHardening: "hardened" | "baseline" | "weak" | "unknown";
  sandboxVmProvidesIsolation: boolean | null;
  sandboxVmAssurance: string | null;
  sandboxPolicySummary: string | null;
  runCount: number;
  eventCount: number;
  failureCount: number;
  severity: "ok" | "error";
  lastRunId: string;
  lastSessionId: string;
  lastEventSeq: number;
  updatedAt: string;
  lastError: string | null;
  lastDetail: string | null;
}

export interface StudioSandboxTelemetryReport {
  format: "agent-flow-builder.studio-sandbox-telemetry.v1";
  flowId: string;
  generatedAt: string;
  windowHours: number | null;
  windowStartedAt: string | null;
  onlyFailures: boolean;
  runCount: number;
  telemetryRunCount: number;
  eventCount: number;
  failureCount: number;
  containerEventCount: number;
  containerFailureCount: number;
  vmEventCount: number;
  vmFailureCount: number;
  microvmEventCount: number;
  microvmFailureCount: number;
  hardenedEventCount: number;
  verifiedVmIsolationEventCount: number;
  isolatedEventCount: number;
  latestEventAt: string | null;
  items: StudioSandboxTelemetryItem[];
}

export interface StudioSandboxTelemetryQuery {
  windowHours?: number;
  onlyFailures?: boolean;
}
