import { createHash } from "node:crypto";
import { access, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  flowProjectFingerprint,
  generateLangGraphSandbox,
  generateLangGraphRuntime,
  generateManifestRuntime as generateManifestRuntimeBundle,
  type ManifestAgentRuntime,
} from "@agent-flow-builder/codegen-langgraph";
import {
  analyzeAgentFlow,
  EdgeSchema,
  type AgentFlow,
  type FlowDiagnostic,
  NodeSchema,
  parseAgentFlow,
  parseRuntimeManifest,
  type RuntimeManifest,
} from "@agent-flow-builder/flow-spec";

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

export interface SaveRuntimeManifestResult extends LoadedRuntimeManifest {}

export interface GenerateResult {
  flowId: string;
  flowPath: string;
  outDir: string;
  absoluteOutDir: string;
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

export interface LangSmithCloudHandoffPackage {
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

export interface LangSmithCloudDeploymentAutomationEvidence {
  source: "configured_endpoint";
  statusCode: number;
  requestedAt: string;
  responseHash: string;
  endpointConfiguredEnv: string;
  tokenInHeaderOnly: true;
}

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
  automation?: LangSmithCloudDeploymentAutomationEvidence;
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

export interface ApprovedGenerateResult extends GenerateResult {
  approval: LangGraphSandboxApproval;
}

interface GeneratedProjectMetadata {
  target?: string;
  flowId?: string;
  flowVersion?: string;
  flowHash?: string;
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

export interface ApprovedManifestGenerateResult extends GenerateManifestResult {
  approvalPackagePath: string;
  approvals: LangGraphSandboxApproval[];
}

export interface CreateFlowWorkspaceResult {
  flow: AgentFlow;
  flowPath: string;
  prompts: FlowAssetContent[];
  schemas: FlowAssetContent[];
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

export interface DeletedFlowAsset {
  id: string;
  path: string;
}

export interface FlowAssetMutationResult {
  flow: AgentFlow;
  flowPath: string;
  asset: FlowAssetContent;
}

export interface FlowAssetDeleteResult {
  flow: AgentFlow;
  flowPath: string;
  deleted: DeletedFlowAsset;
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
  secretPolicyProfiles?: SecretPolicyProfilePackage;
  selectedSecretPolicyProfileId?: string;
  defaultSecretPolicyProfileId?: string;
}

interface SecretPolicyProfile {
  id: string;
  name: string;
  description: string;
  requiredEnvNames: string[];
  protectedEnvNames: string[];
  createdAt: string;
  updatedAt: string;
}

interface SecretPolicyProfilePackage {
  format: "agent-flow-builder.secret-policy-profiles.v1";
  exportedAt: string;
  profileCount: number;
  profiles: SecretPolicyProfile[];
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

export interface CreateFlowFromCatalogTemplateResult extends CreateFlowWorkspaceResult {
  item: LocalCatalogItem;
}

export interface LocalCatalog {
  format: typeof LOCAL_CATALOG_FORMAT;
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

interface LocalCatalogSharedSyncStats {
  incomingCount: number;
  existingCount: number;
  addedCount: number;
  updatedCount: number;
  unchangedCount: number;
  conflictCount: number;
  finalCount: number;
}

type LocalCatalogLibraryConflictStatus = "open" | "resolved";
type LocalCatalogLibraryConflictCurationStatus = "unassigned" | "assigned" | "resolved";
type LocalCatalogLibraryConflictCurationAction = "assign" | "release";
type LocalCatalogLibraryConflictCurationLastAction =
  | LocalCatalogLibraryConflictCurationAction
  | "resolve"
  | "lease_expired";
type LocalCatalogLibraryConflictCuratorRole = "owner" | "reviewer" | "viewer";
type LocalCatalogLibraryConflictResolution = "keep_library" | "use_incoming" | "restore_existing_snapshot";
type LocalCatalogLibraryConflictSelectedSnapshot = "current_library" | "incoming_snapshot" | "existing_snapshot";
type LocalCatalogResolvedConflictDecision = "keep_existing" | "allow_incoming";
type LocalCatalogLibraryConflictContentAction =
  | "current_content_retained"
  | "selected_content_already_current"
  | "manual_content_reapply_required";
type LocalCatalogLibraryConflictMetadataAction =
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

export interface LocalCatalogLibraryConflict {
  id: string;
  itemKey: string;
  itemId: string;
  kind: LocalCatalogItemKind;
  status: LocalCatalogLibraryConflictStatus;
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
  format: typeof LOCAL_CATALOG_SHARED_LIBRARY_FORMAT;
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
  format: typeof LOCAL_CATALOG_CONFLICT_REVIEW_FORMAT;
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
  format: typeof LOCAL_CATALOG_CONFLICT_REVIEW_DIFF_FORMAT;
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
  format: typeof LOCAL_CATALOG_CENTRAL_STATUS_FORMAT;
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
  format: typeof LOCAL_CATALOG_CENTRAL_SYNC_RESULT_FORMAT;
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
  format: typeof LOCAL_CATALOG_ITEM_PACKAGE_FORMAT;
  exportedAt: string;
  source: {
    kind: LocalCatalogItemKind;
    id: string;
    name: string;
    contentHash: string;
    revision: number;
  };
  item: LocalCatalogItemInput;
}

export interface SaveLocalCatalogItemResult {
  status: "ok";
  item: LocalCatalogItem;
  catalog: LocalCatalog;
}

export interface ApplyCatalogItemResult {
  status: "ok";
  item: LocalCatalogItem;
  flow: AgentFlow;
  flowPath: string;
  prompt?: FlowAssetContent;
  schema?: FlowAssetContent;
  node?: AgentFlow["nodes"][number];
}

export interface FlowValidationResult {
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

export interface GeneratedArtifactFileSummary {
  path: string;
  sizeBytes: number;
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

export interface GeneratedArtifactArchive {
  outDir: string;
  fileName: string;
  content: Buffer;
  sizeBytes: number;
}

interface GeneratedArtifactExportManifest {
  format: "agent-flow-builder.generated-artifact-export.v1";
  generatedAt: string;
  outDir: string;
  archiveRootName: string;
  packageType: "runtime-final" | "langgraph-sandbox" | "generic-artifact";
  target: string | null;
  detachedFromBuilder: boolean;
  includesEnvValues: false;
  excludedFiles: string[];
  fileCount: number;
  totalSizeBytes: number;
  files: string[];
  runbook: GeneratedArtifactRunbook;
}

export type GeneratedArtifactPackageType = GeneratedArtifactExportManifest["packageType"];
export type GeneratedArtifactExportAuditLevel = "ok" | "warning" | "error";

export interface GeneratedArtifactExportAuditCheck {
  id: string;
  label: string;
  level: GeneratedArtifactExportAuditLevel;
  detail: string;
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

interface GeneratedArtifactRunbookModelSetup {
  services: string[];
  models: string[];
  command: string;
  modelImageCommand: string | null;
  modelImageTag: string | null;
  modelImageArchivePath: string | null;
  modelImageExportCommand: string | null;
  modelImageLoadCommand: string | null;
  modelImagePushCommand: string | null;
  gpuCommand: string | null;
}

export interface GeneratedArtifactRunbook {
  title: string;
  workingDirectory: string;
  runtimeBaseUrl: string | null;
  agents: GeneratedArtifactRunbookAgent[];
  steps: GeneratedArtifactRunbookStep[];
  endpoints: GeneratedArtifactRunbookEndpoint[];
}

const FLOW_WORKSPACE_EXPORT_FORMAT = "agent-flow-builder.flow-workspace.v1";
const LOCAL_CATALOG_FORMAT = "agent-flow-builder.local-catalog.v1";
const LOCAL_CATALOG_ITEM_PACKAGE_FORMAT = "agent-flow-builder.catalog-item.v1";
const LOCAL_CATALOG_SHARED_LIBRARY_FORMAT = "agent-flow-builder.catalog-library.v1";
const LOCAL_CATALOG_CONFLICT_REVIEW_FORMAT = "agent-flow-builder.catalog-conflict-review.v1";
const LOCAL_CATALOG_CONFLICT_REVIEW_DIFF_FORMAT = "agent-flow-builder.catalog-conflict-review-diff.v1";
const LOCAL_CATALOG_CENTRAL_SYNC_REQUEST_FORMAT = "agent-flow-builder.catalog-central-sync-request.v1";
const LOCAL_CATALOG_CENTRAL_SYNC_RESULT_FORMAT = "agent-flow-builder.catalog-central-sync-result.v1";
const LOCAL_CATALOG_CENTRAL_STATUS_FORMAT = "agent-flow-builder.catalog-central-sync-status.v1";
const AGENT_TEMPLATE_FORMAT = "agent-flow-builder.agent-template.v1";
const SKILL_CATALOG_FORMAT = "agent-flow-builder.skill.v1";
const TOOL_BUNDLE_FORMAT = "agent-flow-builder.tool-bundle.v1";
const LOCAL_CATALOG_PATH = ".agent-flow/catalog/registry.json";
const LOCAL_CATALOG_SHARED_LIBRARY_PATH = ".agent-flow/catalog/shared-library.afcataloglibrary.json";
const LOCAL_CATALOG_CENTRAL_URL_ENV = "AGENT_FLOW_CATALOG_CENTRAL_URL";
const LOCAL_CATALOG_CENTRAL_TOKEN_ENV = "AGENT_FLOW_CATALOG_CENTRAL_TOKEN";
const LOCAL_CATALOG_CENTRAL_TIMEOUT_ENV = "AGENT_FLOW_CATALOG_CENTRAL_TIMEOUT_MS";
const LOCAL_CATALOG_CENTRAL_TIMEOUT_MS = 5_000;
const LOCAL_CATALOG_CENTRAL_MAX_BYTES = 3_000_000;
const LOCAL_CATALOG_CONFLICT_CURATION_LEASE_HOURS_ENV = "AGENT_FLOW_CATALOG_CONFLICT_CURATION_LEASE_HOURS";
const LOCAL_CATALOG_CONFLICT_CURATION_LEASE_HOURS = 24;
const LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_SYNC_REQUEST_FORMAT = "agent-flow-builder.langsmith-cloud-deployments-central-sync-request.v1";
const LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_SYNC_RESULT_FORMAT = "agent-flow-builder.langsmith-cloud-deployments-central-sync-result.v1";
const LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_STATUS_FORMAT = "agent-flow-builder.langsmith-cloud-deployments-central-sync-status.v1";
const LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_URL_ENV = "AGENT_FLOW_LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_URL";
const LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_TOKEN_ENV = "AGENT_FLOW_LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_TOKEN";
const LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_TIMEOUT_ENV = "AGENT_FLOW_LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_TIMEOUT_MS";
const LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_TIMEOUT_MS = 5_000;
const LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_MAX_BYTES = 1_000_000;
const LANGSMITH_CLOUD_DEPLOY_AUTOMATION_REQUEST_FORMAT = "agent-flow-builder.langsmith-cloud-deployment-automation-request.v1";
const LANGSMITH_CLOUD_DEPLOY_AUTOMATION_RESULT_FORMAT = "agent-flow-builder.langsmith-cloud-deployment-automation-result.v1";
const LANGSMITH_CLOUD_DEPLOY_AUTOMATION_STATUS_FORMAT = "agent-flow-builder.langsmith-cloud-deployment-automation-status.v1";
const LANGSMITH_CLOUD_DEPLOY_AUTOMATION_URL_ENV = "AGENT_FLOW_LANGSMITH_CLOUD_DEPLOY_URL";
const LANGSMITH_CLOUD_DEPLOY_AUTOMATION_TOKEN_ENV = "AGENT_FLOW_LANGSMITH_CLOUD_DEPLOY_TOKEN";
const LANGSMITH_CLOUD_DEPLOY_AUTOMATION_TIMEOUT_ENV = "AGENT_FLOW_LANGSMITH_CLOUD_DEPLOY_TIMEOUT_MS";
const LANGSMITH_CLOUD_DEPLOY_AUTOMATION_TIMEOUT_MS = 30_000;
const LANGSMITH_CLOUD_DEPLOY_AUTOMATION_MAX_BYTES = 1_000_000;
const GENERATED_ARTIFACT_MAX_FILES = 1000;
const GENERATED_ARTIFACT_MAX_PREVIEW_BYTES = 512 * 1024;
const GENERATED_ARTIFACT_IGNORED_DIRS = new Set([".git", ".pytest_cache", "__pycache__", ".venv", "venv", "node_modules", ".langgraph_api"]);
const GENERATED_ARTIFACT_IGNORED_EXTENSIONS = new Set([".pyc", ".pyo", ".db", ".sqlite", ".sqlite3"]);
const GENERATED_ARTIFACT_IGNORED_FILES = new Set([".env"]);
const DEFAULT_EXPORT_RUNTIME_BASE_URL = "http://127.0.0.1:8080";
const DEFAULT_EXPORT_API_PORT = 8080;

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

export async function createFlowWorkspace(workspaceRoot: string, value: unknown): Promise<CreateFlowWorkspaceResult> {
  const input = parseCreateFlowInput(value);
  const flow = starterFlow(input);
  const prompt: FlowAssetContent = {
    id: "system",
    path: "prompts/system.md",
    content: starterPrompt(input.name),
  };
  const stateSchema: FlowAssetContent = {
    id: "session_state",
    path: "schemas/session_state.schema.json",
    content: `${JSON.stringify(starterStateSchema(input.name), null, 2)}\n`,
  };
  return createFlowWorkspaceFromAssets(workspaceRoot, flow, [prompt], [stateSchema], "create");
}

async function createFlowWorkspaceFromAssets(
  workspaceRoot: string,
  flowValue: AgentFlow,
  prompts: FlowAssetContent[],
  schemas: FlowAssetContent[],
  tempPrefix: string,
): Promise<CreateFlowWorkspaceResult> {
  const flow = parseAgentFlow(flowValue);
  assertImportableFlowId(flow.id);
  const promptAssets = assetsForRefs(flow.prompts, prompts, "prompt");
  const schemaAssets = assetsForRefs(flow.schemas, schemas, "schema");
  for (const schema of schemaAssets) {
    try {
      JSON.parse(schema.content);
    } catch (error) {
      throw new WorkspaceError(`Schema ${schema.id} do flow criado não é JSON válido.`, 422, error);
    }
  }
  assertNoPathContentConflicts([...promptAssets, ...schemaAssets]);
  assertNoReservedAssetPaths([...promptAssets, ...schemaAssets]);

  const root = normalizeWorkspaceRoot(workspaceRoot);
  const flowsDir = safeResolve(root, "flows");
  await mkdir(flowsDir, { recursive: true });
  const flowRoot = safeResolve(root, `flows/${flow.id}`);
  if (await pathExists(flowRoot)) {
    throw new WorkspaceError(`Flow já existe: ${flow.id}`, 409);
  }

  const tempDir = safeResolve(root, `flows/.${tempPrefix}-${flow.id}-${Date.now()}`);
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
    await rename(tempDir, flowRoot);
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }

  return {
    flow,
    flowPath: `${toWorkspaceRelative(root, flowRoot)}/agent.flow.json`,
    prompts: promptAssets,
    schemas: schemaAssets,
  };
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

export async function validateFlow(workspaceRoot: string, flowId: string): Promise<FlowValidationResult> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const diagnostics = [
    ...analyzeAgentFlow(loaded.flow).diagnostics,
    ...(await validateReferencedAssets(loaded)),
  ];
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const infos = diagnostics.filter((diagnostic) => diagnostic.severity === "info").length;
  return {
    status: errors ? "error" : "ok",
    id: loaded.flow.id,
    name: loaded.flow.name,
    version: loaded.flow.version,
    nodes: loaded.flow.nodes.length,
    edges: loaded.flow.edges.length,
    contract: loaded.flow.api.contract,
    diagnostics,
    summary: {
      nodes: loaded.flow.nodes.length,
      edges: loaded.flow.edges.length,
      prompts: loaded.flow.prompts.length,
      schemas: loaded.flow.schemas.length,
      errors,
      warnings,
      infos,
    },
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

export async function saveRuntimeManifest(
  workspaceRoot: string,
  value: unknown,
  manifestPath = "runtime.manifest.json",
): Promise<SaveRuntimeManifestResult> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const absolutePath = safeResolve(root, manifestPath);
  let manifest: RuntimeManifest;
  try {
    manifest = parseRuntimeManifest(value);
  } catch (error) {
    throw new WorkspaceError("Manifesto enviado não respeita o Runtime Manifest Spec.", 422, error);
  }

  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  const tempPath = `${absolutePath}.tmp-${Date.now()}`;
  await writeFile(tempPath, serialized, "utf-8");
  await rename(tempPath, absolutePath);
  return {
    manifest,
    relativePath: toWorkspaceRelative(root, absolutePath),
    absolutePath,
  };
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
      flowName: agent.flow.name,
      flowVersion: agent.flow.version,
      flowPath: loaded.manifest.agents.find((manifestAgent) => manifestAgent.id === agent.id)?.flowPath ?? "",
      routePrefix: agent.routePrefix,
      resourceName: agent.flow.api.resourceName,
      contract: agent.flow.api.contract,
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

export async function createPrompt(
  workspaceRoot: string,
  flowId: string,
  value: unknown,
): Promise<FlowAssetMutationResult> {
  const input = parsePromptAssetInput(value);
  const loaded = await loadFlowById(workspaceRoot, flowId);
  if (loaded.flow.prompts.some((prompt) => prompt.id === input.id)) {
    throw new WorkspaceError(`Prompt já existe: ${input.id}`, 409);
  }
  assertUniqueAssetPath(loaded.flow, input.path);
  const absolutePath = safeResolveFlowAsset(loaded.flowRoot, input.path);
  assertAssetPathPrefix(input.path, "prompts");
  if (await pathExists(absolutePath)) {
    throw new WorkspaceError(`Arquivo de prompt já existe: ${input.path}`, 409);
  }

  const flow = parseAgentFlow({
    ...loaded.flow,
    prompts: [
      ...loaded.flow.prompts,
      {
        id: input.id,
        path: input.path,
        version: input.version,
        description: input.description,
        tags: input.tags,
        variables: input.variables,
      },
    ],
  });
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, input.content, "utf-8");
  await writeFlowFile(loaded, flow);
  return {
    flow,
    flowPath: loaded.relativePath,
    asset: {
      id: input.id,
      path: input.path,
      content: input.content,
    },
  };
}

export async function deletePrompt(
  workspaceRoot: string,
  flowId: string,
  promptId: string,
): Promise<FlowAssetDeleteResult> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const prompt = loaded.flow.prompts.find((item) => item.id === promptId);
  if (!prompt) {
    throw new WorkspaceError(`Prompt não encontrado: ${promptId}`, 404);
  }
  if (loaded.flow.prompts.length <= 1) {
    throw new WorkspaceError("Flow precisa manter ao menos um prompt.", 409);
  }
  const referencingNode = loaded.flow.nodes.find((node) => node.promptId === promptId);
  if (referencingNode) {
    throw new WorkspaceError(`Prompt ${promptId} ainda é usado pelo nó ${referencingNode.id}.`, 409);
  }

  const flow = parseAgentFlow({
    ...loaded.flow,
    prompts: loaded.flow.prompts.filter((item) => item.id !== promptId),
  });
  await writeFlowFile(loaded, flow);
  await removeAssetFileIfUnreferenced(loaded.flowRoot, flow, prompt.path);
  return {
    flow,
    flowPath: loaded.relativePath,
    deleted: {
      id: prompt.id,
      path: prompt.path,
    },
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

export async function createSchemaAsset(
  workspaceRoot: string,
  flowId: string,
  value: unknown,
): Promise<FlowAssetMutationResult> {
  const input = parseSchemaAssetInput(value);
  const loaded = await loadFlowById(workspaceRoot, flowId);
  if (loaded.flow.schemas.some((schema) => schema.id === input.id)) {
    throw new WorkspaceError(`Schema já existe: ${input.id}`, 409);
  }
  assertUniqueAssetPath(loaded.flow, input.path);
  const absolutePath = safeResolveFlowAsset(loaded.flowRoot, input.path);
  assertAssetPathPrefix(input.path, "schemas");
  if (await pathExists(absolutePath)) {
    throw new WorkspaceError(`Arquivo de schema já existe: ${input.path}`, 409);
  }

  const formatted = `${JSON.stringify(input.parsed, null, 2)}\n`;
  const flow = parseAgentFlow({
    ...loaded.flow,
    schemas: [
      ...loaded.flow.schemas,
      {
        id: input.id,
        path: input.path,
        version: input.version,
        description: input.description,
        tags: input.tags,
      },
    ],
  });
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, formatted, "utf-8");
  await writeFlowFile(loaded, flow);
  return {
    flow,
    flowPath: loaded.relativePath,
    asset: {
      id: input.id,
      path: input.path,
      content: formatted,
    },
  };
}

export async function deleteSchemaAsset(
  workspaceRoot: string,
  flowId: string,
  schemaId: string,
): Promise<FlowAssetDeleteResult> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const schema = loaded.flow.schemas.find((item) => item.id === schemaId);
  if (!schema) {
    throw new WorkspaceError(`Schema não encontrado: ${schemaId}`, 404);
  }
  if (loaded.flow.state.schemaRef === schema.id || loaded.flow.state.schemaRef === schema.path) {
    throw new WorkspaceError(`Schema ${schemaId} é o schema de estado do flow.`, 409);
  }
  const referencingNode = loaded.flow.nodes.find((node) => node.outputSchema === schema.id || node.outputSchema === schema.path);
  if (referencingNode) {
    throw new WorkspaceError(`Schema ${schemaId} ainda é usado pelo nó ${referencingNode.id}.`, 409);
  }

  const flow = parseAgentFlow({
    ...loaded.flow,
    schemas: loaded.flow.schemas.filter((item) => item.id !== schemaId),
  });
  await writeFlowFile(loaded, flow);
  await removeAssetFileIfUnreferenced(loaded.flowRoot, flow, schema.path);
  return {
    flow,
    flowPath: loaded.relativePath,
    deleted: {
      id: schema.id,
      path: schema.path,
    },
  };
}

async function validateReferencedAssets(loaded: LoadedFlow): Promise<FlowDiagnostic[]> {
  const diagnostics: FlowDiagnostic[] = [];
  const promptBasenames = new Map<string, string>();
  const schemaBasenames = new Map<string, string>();

  for (const prompt of loaded.flow.prompts) {
    const basename = path.basename(prompt.path);
    const existing = promptBasenames.get(basename);
    if (existing && existing !== prompt.id) {
      diagnostics.push({
        severity: "warning",
        code: "codegen_prompt_basename_conflict",
        message: `Prompts ${existing} e ${prompt.id} usam o mesmo nome de arquivo ${basename} no runtime gerado.`,
        path: `prompts.${prompt.id}.path`,
        assetId: prompt.id,
      });
    }
    promptBasenames.set(basename, prompt.id);

    try {
      const content = await readFile(safeResolveFlowAsset(loaded.flowRoot, prompt.path), "utf-8");
      if (!content.trim()) {
        diagnostics.push({
          severity: "warning",
          code: "empty_prompt_file",
          message: `Prompt ${prompt.id} está vazio.`,
          path: `prompts.${prompt.id}.path`,
          assetId: prompt.id,
        });
      }
    } catch (error) {
      diagnostics.push(assetReadDiagnostic("missing_prompt_file", prompt.id, prompt.path, error));
    }
  }

  for (const schema of loaded.flow.schemas) {
    const basename = path.basename(schema.path);
    const existing = schemaBasenames.get(basename);
    if (existing && existing !== schema.id) {
      diagnostics.push({
        severity: "warning",
        code: "codegen_schema_basename_conflict",
        message: `Schemas ${existing} e ${schema.id} usam o mesmo nome de arquivo ${basename} no runtime gerado.`,
        path: `schemas.${schema.id}.path`,
        assetId: schema.id,
      });
    }
    schemaBasenames.set(basename, schema.id);

    let content: string;
    try {
      content = await readFile(safeResolveFlowAsset(loaded.flowRoot, schema.path), "utf-8");
    } catch (error) {
      diagnostics.push(assetReadDiagnostic("missing_schema_file", schema.id, schema.path, error));
      continue;
    }
    try {
      JSON.parse(content);
    } catch (error) {
      diagnostics.push(assetReadDiagnostic("invalid_schema_file", schema.id, schema.path, error));
    }
  }

  return diagnostics;
}

function assetReadDiagnostic(code: string, assetId: string, assetPath: string, error: unknown): FlowDiagnostic {
  const message =
    error instanceof WorkspaceError
      ? error.message
      : code === "invalid_schema_file"
        ? `Schema ${assetId} não é um JSON válido em ${assetPath}.`
        : `Asset ${assetId} não foi encontrado em ${assetPath}.`;
  return {
    severity: "error",
    code,
    message,
    path: assetPath,
    assetId,
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

export async function listLocalCatalog(workspaceRoot: string): Promise<LocalCatalog> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  return {
    format: LOCAL_CATALOG_FORMAT,
    path: LOCAL_CATALOG_PATH,
    items: sortCatalogItems([...builtInCatalogItems(), ...(await readStoredCatalogItems(root))]),
  };
}

export async function loadSharedLocalCatalog(workspaceRoot: string): Promise<LocalCatalogSharedLibraryPackage> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  return readSharedCatalogLibrary(root);
}

export async function loadSharedLocalCatalogConflictReview(workspaceRoot: string): Promise<LocalCatalogConflictReviewPackage> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  return buildLocalCatalogConflictReviewPackage(await readSharedCatalogLibrary(root));
}

export async function compareSharedLocalCatalogConflictReview(
  workspaceRoot: string,
  payload: unknown,
): Promise<LocalCatalogConflictReviewDiffPackage> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const reviewPayload = isRecord(payload) && payload.review !== undefined ? payload.review : payload;
  if (containsRawLocalCatalogConflictReviewPayload(reviewPayload)) {
    throw new WorkspaceError("Revisão de conflitos do catálogo não pode conter conteúdo bruto, nodePatch, itens completos ou secrets.", 400);
  }
  const incoming = normalizeLocalCatalogConflictReviewPackage(reviewPayload);
  if (!incoming) {
    throw new WorkspaceError("Revisão de conflitos do catálogo inválida.", 400);
  }
  const current = buildLocalCatalogConflictReviewPackage(await readSharedCatalogLibrary(root));
  return buildLocalCatalogConflictReviewDiffPackage(current, incoming);
}

export async function loadSharedLocalCatalogIntoRegistry(workspaceRoot: string): Promise<LocalCatalogSharedSyncResult> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const sharedLibrary = await readSharedCatalogLibrary(root);
  const stored = await readStoredCatalogItems(root);
  const merged = mergeCatalogLibraryItems(stored, sharedLibrary.items);
  await writeStoredCatalogItems(root, merged.items);
  const nextSharedLibrary = buildCatalogSharedLibraryPackage(sharedLibrary.items, {
    action: "load",
    stats: merged.stats,
  }, sharedLibrary.conflicts);
  return {
    status: "ok",
    sharedLibrary: nextSharedLibrary,
    catalog: await listLocalCatalog(root),
  };
}

export async function mergeSharedLocalCatalog(
  workspaceRoot: string,
  payload: unknown,
): Promise<LocalCatalogSharedSyncResult> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const incoming = normalizeCatalogSharedLibraryPackage(payload);
  if (!incoming) {
    throw new WorkspaceError("Payload de biblioteca compartilhada do catálogo inválido.", 400);
  }
  const existing = await readSharedCatalogLibrary(root);
  const merged = mergeCatalogLibraryItems(existing.items, incoming.items, existing.conflicts, incoming.conflicts);
  const nextSharedLibrary = buildCatalogSharedLibraryPackage(merged.items, {
    action: "merge",
    stats: merged.stats,
  }, merged.conflicts);
  await writeSharedCatalogLibrary(root, nextSharedLibrary);
  await writeStoredCatalogItems(root, merged.items);
  return {
    status: "ok",
    sharedLibrary: nextSharedLibrary,
    catalog: await listLocalCatalog(root),
  };
}

export async function loadLocalCatalogCentralSyncStatus(): Promise<LocalCatalogCentralSyncStatus> {
  return buildLocalCatalogCentralSyncStatus(localCatalogCentralSyncConfig());
}

export async function syncCentralLocalCatalog(workspaceRoot: string): Promise<LocalCatalogCentralSyncResult> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const config = localCatalogCentralSyncConfig();
  if (config.invalidReason) {
    throw new WorkspaceError(`Configuração da central do catálogo inválida: ${config.invalidReason}`, 422);
  }
  if (!config.url) {
    throw new WorkspaceError("Central do catálogo não configurada.", 400);
  }
  const catalog = await listLocalCatalog(root);
  const outgoingLibrary = buildCatalogSharedLibraryPackage(
    catalog.items.filter((item) => item.source === "local"),
    { action: "merge" },
  );
  const fetched = await fetchCentralLocalCatalogSync(config, outgoingLibrary);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fetched.body) as unknown;
  } catch (error) {
    throw new WorkspaceError("Resposta central do catálogo não é JSON válido.", 502, error);
  }
  const incomingLibrary = normalizeCatalogSharedLibraryPackage(
    isRecord(parsed) && parsed.sharedLibrary !== undefined ? parsed.sharedLibrary : parsed,
  );
  if (!incomingLibrary) {
    throw new WorkspaceError("Resposta central do catálogo não respeita o formato esperado.", 502);
  }
  const existing = await readSharedCatalogLibrary(root);
  const merged = mergeCatalogLibraryItems(existing.items, incomingLibrary.items, existing.conflicts, incomingLibrary.conflicts);
  const syncedAt = new Date().toISOString();
  const nextSharedLibrary = buildCatalogSharedLibraryPackage(merged.items, {
    action: "merge",
    stats: merged.stats,
  }, merged.conflicts);
  await writeSharedCatalogLibrary(root, nextSharedLibrary);
  await writeStoredCatalogItems(root, merged.items);
  return {
    format: LOCAL_CATALOG_CENTRAL_SYNC_RESULT_FORMAT,
    sharedLibrary: nextSharedLibrary,
    catalog: await listLocalCatalog(root),
    central: buildLocalCatalogCentralSyncStatus(config, {
      lastSyncedAt: syncedAt,
      statusCode: fetched.statusCode,
      pushedItemCount: outgoingLibrary.itemCount,
      pulledItemCount: incomingLibrary.itemCount,
      error: null,
    }),
    pushedItemCount: outgoingLibrary.itemCount,
    pulledItemCount: incomingLibrary.itemCount,
    governance: {
      excludesSecretValues: true,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  };
}

export async function resolveSharedLocalCatalogConflict(
  workspaceRoot: string,
  conflictId: string,
  payload: unknown,
): Promise<LocalCatalogSharedLibraryPackage> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const normalizedConflictId = conflictId.trim();
  if (!normalizedConflictId) {
    throw new WorkspaceError("ID do conflito do catálogo é obrigatório.", 400);
  }
  const existing = await readSharedCatalogLibrary(root);
  const conflict = existing.conflicts.find((entry) => entry.id === normalizedConflictId);
  if (!conflict) {
    throw new WorkspaceError("Conflito de catálogo compartilhado não encontrado.", 404);
  }
  const resolvedBy = resolveCatalogConflictActor(payload);
  const resolvedRole = resolveCatalogConflictCuratorRole(payload);
  assertCatalogConflictMutationAllowed(resolvedRole, "resolver conflito de catálogo compartilhado");
  const resolution = resolveCatalogConflictResolution(payload);
  const resolutionNote = resolveCatalogConflictResolutionNote(payload);
  const resolvedAt = new Date().toISOString();
  const currentItem = existing.items.find((item) => catalogItemKey(item.kind, item.id) === conflict.itemKey) ?? null;
  const resolutionResult = resolveCatalogConflictItem(currentItem, conflict, resolution, resolvedAt);
  const resolvedItemKey = resolutionResult.item ? catalogItemKey(resolutionResult.item.kind, resolutionResult.item.id) : "";
  const nextItems: LocalCatalogItem[] = resolutionResult.item
    ? existing.items.map((item) => (catalogItemKey(item.kind, item.id) === resolvedItemKey ? resolutionResult.item as LocalCatalogItem : item))
    : existing.items;
  const nextConflicts = existing.conflicts.map((entry) =>
    entry.id === normalizedConflictId
      ? {
          ...entry,
          status: "resolved" as const,
          resolvedAt,
          resolvedBy,
          resolvedRole,
          resolution,
          resolutionNote,
          resolutionPlan: resolutionResult.plan,
          curationThread: resolveCatalogConflictCurationThread(entry.curationThread, resolvedBy, resolvedRole, resolutionNote, resolvedAt),
        }
      : entry,
  );
  const itemsChanged = catalogSharedLibraryItemsFingerprint(nextItems) !== catalogSharedLibraryItemsFingerprint(existing.items);
  const nextSharedLibrary = buildCatalogSharedLibraryPackage(nextItems, {
    action: "resolve",
    stats: {
      incomingCount: existing.itemCount,
      existingCount: existing.itemCount,
      addedCount: 0,
      updatedCount: itemsChanged ? 1 : 0,
      unchangedCount: itemsChanged ? Math.max(0, existing.itemCount - 1) : existing.itemCount,
      conflictCount: 1,
      finalCount: existing.itemCount,
    },
  }, nextConflicts);
  await writeSharedCatalogLibrary(root, nextSharedLibrary);
  if (itemsChanged) {
    await writeStoredCatalogItems(root, nextSharedLibrary.items);
  }
  return nextSharedLibrary;
}

export async function curateSharedLocalCatalogConflict(
  workspaceRoot: string,
  conflictId: string,
  payload: unknown,
): Promise<LocalCatalogSharedLibraryPackage> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const normalizedConflictId = conflictId.trim();
  if (!normalizedConflictId) {
    throw new WorkspaceError("ID do conflito do catálogo é obrigatório.", 400);
  }
  const existing = await readSharedCatalogLibrary(root);
  const conflict = existing.conflicts.find((entry) => entry.id === normalizedConflictId);
  if (!conflict) {
    throw new WorkspaceError("Conflito de catálogo compartilhado não encontrado.", 404);
  }
  if (conflict.status === "resolved") {
    throw new WorkspaceError("Conflito de catálogo compartilhado já está resolvido.", 409);
  }
  const action = normalizeCatalogConflictCurationAction(isRecord(payload) ? payload.action : undefined);
  if (!action) {
    throw new WorkspaceError("Ação de curadoria do conflito é obrigatória.", 400);
  }
  const actor = resolveCatalogConflictCurationActor(payload);
  const role = resolveCatalogConflictCuratorRole(payload);
  assertCatalogConflictMutationAllowed(role, "curar conflito de catálogo compartilhado");
  const note = resolveCatalogConflictCurationNote(payload);
  const updatedAt = new Date().toISOString();
  const nextConflicts = existing.conflicts.map((entry) =>
    entry.id === normalizedConflictId
      ? {
          ...entry,
          curationThread: updateCatalogConflictCurationThread(entry.curationThread, action, actor, role, note, updatedAt),
        }
      : entry,
  );
  const nextSharedLibrary = buildCatalogSharedLibraryPackage(existing.items, {
    action: "curate_conflict",
    stats: {
      incomingCount: existing.itemCount,
      existingCount: existing.itemCount,
      addedCount: 0,
      updatedCount: 0,
      unchangedCount: existing.itemCount,
      conflictCount: 0,
      finalCount: existing.itemCount,
    },
  }, nextConflicts);
  await writeSharedCatalogLibrary(root, nextSharedLibrary);
  return nextSharedLibrary;
}

export async function exportLocalCatalogItem(
  workspaceRoot: string,
  itemId: string,
  kind?: LocalCatalogItemKind,
): Promise<LocalCatalogItemPackage> {
  const catalog = await listLocalCatalog(workspaceRoot);
  const item = findCatalogItem(catalog.items, itemId, kind);
  if (!item) {
    throw new WorkspaceError(`Item de catálogo não encontrado: ${itemId}`, 404);
  }
  return {
    format: LOCAL_CATALOG_ITEM_PACKAGE_FORMAT,
    exportedAt: new Date().toISOString(),
    source: {
      kind: item.kind,
      id: item.id,
      name: item.name,
      contentHash: item.contentHash,
      revision: item.revision,
    },
    item: localCatalogItemInputFromItem(item),
  };
}

export async function importLocalCatalogItemPackage(
  workspaceRoot: string,
  value: unknown,
): Promise<SaveLocalCatalogItemResult> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const itemPackage = parseLocalCatalogItemPackage(value);
  const builtIns = builtInCatalogItems();
  const stored = await readStoredCatalogItems(root);
  const isBuiltInConflict = builtIns.some((item) => catalogItemKey(item.kind, item.id) === catalogItemKey(itemPackage.item.kind, itemPackage.item.id));
  const item = isBuiltInConflict
    ? {
        ...itemPackage.item,
        id: uniqueCatalogImportItemId(
          itemPackage.item.id,
          itemPackage.item.kind,
          [...builtIns, ...stored],
        ),
      }
    : itemPackage.item;
  return saveLocalCatalogItem(root, item);
}

export async function saveLocalCatalogItem(workspaceRoot: string, value: unknown): Promise<SaveLocalCatalogItemResult> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const input = parseLocalCatalogItemInput(value);
  const builtInKey = catalogItemKey(input.kind, input.id);
  if (builtInCatalogItems().some((item) => catalogItemKey(item.kind, item.id) === builtInKey)) {
    throw new WorkspaceError(`Item de catálogo embutido não pode ser sobrescrito: ${input.kind}/${input.id}`, 409);
  }
  const now = new Date().toISOString();
  const stored = await readStoredCatalogItems(root);
  const previous = stored.find((item) => catalogItemKey(item.kind, item.id) === builtInKey);
  const item: LocalCatalogItem = {
    ...input,
    scope: "local",
    source: "local",
    version: input.version ?? previous?.version ?? "1.0.0",
    revision: (previous?.revision ?? 0) + 1,
    contentHash: catalogItemContentHash(input),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    history: previous ? [...previous.history, catalogRevisionFromItem(previous)] : [],
  };
  const nextItems = sortCatalogItems([
    ...stored.filter((existing) => catalogItemKey(existing.kind, existing.id) !== builtInKey),
    item,
  ]);
  await writeStoredCatalogItems(root, nextItems);
  return {
    status: "ok",
    item,
    catalog: await listLocalCatalog(root),
  };
}

export async function restoreLocalCatalogRevision(workspaceRoot: string, value: unknown): Promise<SaveLocalCatalogItemResult> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const input = parseRestoreCatalogRevisionInput(value);
  const stored = await readStoredCatalogItems(root);
  const previous = findCatalogItem(stored, input.itemId, input.kind);
  if (!previous) {
    throw new WorkspaceError(`Item local de catálogo não encontrado: ${input.itemId}`, 404);
  }
  const revision = previous.history.find((item) => item.revision === input.revision);
  if (!revision) {
    throw new WorkspaceError(`Revisão ${input.revision} não encontrada para ${previous.kind}/${previous.id}.`, 404);
  }
  const now = new Date().toISOString();
  const restored: LocalCatalogItem = {
    id: previous.id,
    kind: previous.kind,
    name: revision.name,
    description: revision.description,
    tags: revision.tags,
    scope: "local",
    source: "local",
    version: revision.version,
    revision: previous.revision + 1,
    contentHash: revision.contentHash,
    createdAt: previous.createdAt,
    updatedAt: now,
    ...(revision.content !== undefined ? { content: revision.content } : {}),
    ...(revision.nodePatch !== undefined ? { nodePatch: revision.nodePatch } : {}),
    history: [...previous.history, catalogRevisionFromItem(previous)],
  };
  const nextItems = sortCatalogItems([
    ...stored.filter((existing) => catalogItemKey(existing.kind, existing.id) !== catalogItemKey(previous.kind, previous.id)),
    restored,
  ]);
  await writeStoredCatalogItems(root, nextItems);
  return {
    status: "ok",
    item: restored,
    catalog: await listLocalCatalog(root),
  };
}

export async function createFlowFromCatalogTemplate(
  workspaceRoot: string,
  value: unknown,
): Promise<CreateFlowFromCatalogTemplateResult> {
  const input = parseCreateFlowFromCatalogTemplateInput(value);
  const catalog = await listLocalCatalog(workspaceRoot);
  const item = findCatalogItem(catalog.items, input.itemId, "agent_template");
  if (!item) {
    throw new WorkspaceError(`Template de agente não encontrado: ${input.itemId}`, 404);
  }
  const template = parseAgentTemplateCatalogContent(item);
  const rendered = renderAgentTemplate(template, input);
  const created = await createFlowWorkspaceFromAssets(
    workspaceRoot,
    rendered.flow,
    rendered.prompts,
    rendered.schemas,
    "catalog-template",
  );
  return {
    ...created,
    item,
  };
}

export async function applyCatalogItemToFlow(
  workspaceRoot: string,
  flowId: string,
  value: unknown,
): Promise<ApplyCatalogItemResult> {
  const input = parseApplyCatalogItemInput(value);
  const catalog = await listLocalCatalog(workspaceRoot);
  const item = findCatalogItem(catalog.items, input.itemId, input.kind);
  if (!item) {
    throw new WorkspaceError(`Item de catálogo não encontrado: ${input.itemId}`, 404);
  }
  if (item.kind === "prompt") {
    return applyPromptCatalogItem(workspaceRoot, flowId, item, input);
  }
  if (item.kind === "schema") {
    return applySchemaCatalogItem(workspaceRoot, flowId, item, input);
  }
  if (item.kind === "tool") {
    return applyToolCatalogItem(workspaceRoot, flowId, item, input);
  }
  if (item.kind === "skill") {
    return applySkillCatalogItem(workspaceRoot, flowId, item, input);
  }
  throw new WorkspaceError(`Aplicação de ${item.kind} ainda não está disponível para flows.`, 409);
}

export async function listGeneratedArtifact(workspaceRoot: string, outDir: string): Promise<GeneratedArtifactListing> {
  const artifact = await resolveGeneratedArtifactRoot(workspaceRoot, outDir);
  const files = await collectGeneratedArtifactFiles(artifact.absoluteOutDir);
  const archiveRootName = path.basename(artifact.relativeOutDir) || "runtime-artifact";
  const exportManifest = await buildGeneratedArtifactExportManifest(artifact.relativeOutDir, artifact.absoluteOutDir, archiveRootName, files);
  return {
    outDir: artifact.relativeOutDir,
    files,
    totalSizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
    exportAudit: buildGeneratedArtifactExportAudit(exportManifest, files),
  };
}

export async function readGeneratedArtifactFile(
  workspaceRoot: string,
  outDir: string,
  filePath: string,
): Promise<GeneratedArtifactFileContent> {
  const artifact = await resolveGeneratedArtifactRoot(workspaceRoot, outDir);
  const relativePath = normalizeArtifactRelativePath(filePath);
  const absolutePath = safeResolveArtifactFile(artifact.absoluteOutDir, relativePath);
  let fileStat;
  try {
    fileStat = await stat(absolutePath);
  } catch (error) {
    throw new WorkspaceError(`Arquivo gerado não encontrado: ${relativePath}`, 404, error);
  }
  if (!fileStat.isFile()) {
    throw new WorkspaceError(`Path do artefato não é arquivo: ${relativePath}`, 400);
  }

  const bytesToRead = Math.min(fileStat.size, GENERATED_ARTIFACT_MAX_PREVIEW_BYTES);
  const handle = await open(absolutePath, "r");
  try {
    const buffer = Buffer.alloc(bytesToRead);
    const result = await handle.read(buffer, 0, bytesToRead, 0);
    return {
      outDir: artifact.relativeOutDir,
      path: relativePath,
      content: buffer.subarray(0, result.bytesRead).toString("utf-8"),
      sizeBytes: fileStat.size,
      truncated: fileStat.size > result.bytesRead,
    };
  } finally {
    await handle.close();
  }
}

export async function archiveGeneratedArtifact(
  workspaceRoot: string,
  outDir: string,
): Promise<GeneratedArtifactArchive> {
  const artifact = await resolveGeneratedArtifactRoot(workspaceRoot, outDir);
  const files = await collectGeneratedArtifactFiles(artifact.absoluteOutDir);
  const archiveRootName = path.basename(artifact.relativeOutDir) || "runtime-artifact";
  const exportManifest = await buildGeneratedArtifactExportManifest(artifact.relativeOutDir, artifact.absoluteOutDir, archiveRootName, files);
  const archiveFiles = await Promise.all(
    files.map(async (file) => ({
      path: `${archiveRootName}/${file.path}`,
      content: await readFile(path.join(artifact.absoluteOutDir, file.path)),
    })),
  );
  archiveFiles.push({
    path: `${archiveRootName}/.agent-flow/export-manifest.json`,
    content: Buffer.from(`${JSON.stringify(exportManifest, null, 2)}\n`, "utf-8"),
  });
  const content = writeZipArchive(archiveFiles);
  return {
    outDir: artifact.relativeOutDir,
    fileName: `${sanitizeFileName(archiveRootName)}.zip`,
    content,
    sizeBytes: content.byteLength,
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

async function writeFlowFile(loaded: LoadedFlow, flow: AgentFlow): Promise<void> {
  const serialized = `${JSON.stringify(flow, null, 2)}\n`;
  const tempPath = `${loaded.absolutePath}.tmp-${Date.now()}`;
  await writeFile(tempPath, serialized, "utf-8");
  await rename(tempPath, loaded.absolutePath);
}

export interface LocalCatalogItemInput {
  id: string;
  kind: LocalCatalogItemKind;
  name: string;
  description: string;
  tags: string[];
  content?: string;
  nodePatch?: Record<string, unknown>;
  version?: string;
}

interface ApplyCatalogItemInput {
  itemId: string;
  kind?: LocalCatalogItemKind;
  targetNodeId?: string;
  id?: string;
}

interface RestoreCatalogRevisionInput {
  itemId: string;
  kind?: LocalCatalogItemKind;
  revision: number;
}

interface CreateFlowFromCatalogTemplateInput extends CreateFlowInput {
  itemId: string;
}

interface AgentTemplateDefinition {
  format: typeof AGENT_TEMPLATE_FORMAT;
  flow: unknown;
  prompts: unknown;
  schemas: unknown;
}

interface SkillCatalogDefinition {
  format: typeof SKILL_CATALOG_FORMAT;
  prompts: unknown;
  schemas: unknown;
  targetNodePatch?: Record<string, unknown>;
  nodes?: AgentFlow["nodes"];
  edges?: AgentFlow["edges"];
}

interface ToolBundleCatalogDefinition {
  format: typeof TOOL_BUNDLE_FORMAT;
  nodes: AgentFlow["nodes"];
  edges: AgentFlow["edges"];
}

function builtInCatalogItems(): LocalCatalogItem[] {
  const createdAt = "2026-06-30T00:00:00.000Z";
  const items: Array<Omit<LocalCatalogItem, "version" | "revision" | "contentHash" | "history">> = [
    {
      id: "guided-question-system",
      kind: "prompt",
      name: "Prompt de perguntas guiadas",
      description: "System prompt para agentes que fazem perguntas, coletam respostas e encerram com resumo.",
      tags: ["starter", "conversation", "questions"],
      scope: "local",
      source: "builtin",
      createdAt,
      updatedAt: createdAt,
      content:
        "Você é um agente de conversa guiada.\n\n" +
        "- Faça uma pergunta objetiva por vez.\n" +
        "- Use as respostas anteriores para decidir a próxima pergunta.\n" +
        "- Quando tiver contexto suficiente, gere um resumo claro e acionável.\n",
    },
    {
      id: "question-list-output",
      kind: "schema",
      name: "Schema de lista de perguntas",
      description: "Output estruturado para geração de perguntas a partir de conteúdo consultado.",
      tags: ["questions", "structured-output"],
      scope: "local",
      source: "builtin",
      createdAt,
      updatedAt: createdAt,
      content: `${JSON.stringify(
        {
          type: "object",
          required: ["questions"],
          properties: {
            questions: {
              type: "array",
              items: {
                type: "object",
                required: ["question", "reason"],
                properties: {
                  question: { type: "string" },
                  reason: { type: "string" },
                },
              },
            },
          },
        },
        null,
        2,
      )}\n`,
    },
    {
      id: "guided-conversation-agent",
      kind: "agent_template",
      name: "Agente de conversa guiada",
      description: "Flow completo para sessão conversacional com safety, roteamento, LLM, pausa para input humano e gate determinístico.",
      tags: ["agent", "starter", "conversation", "questions"],
      scope: "local",
      source: "builtin",
      createdAt,
      updatedAt: createdAt,
      content: agentTemplateContent(
        starterFlow({ id: "{{flowId}}", name: "{{flowName}}", resourceName: "{{resourceName}}" }),
        [
          {
            id: "system",
            path: "prompts/system.md",
            content: starterPrompt("{{flowName}}"),
          },
        ],
        [
          {
            id: "session_state",
            path: "schemas/session_state.schema.json",
            content: `${JSON.stringify(starterStateSchema("{{flowName}}"), null, 2)}\n`,
          },
        ],
      ),
    },
    {
      id: "content-question-generator-agent",
      kind: "agent_template",
      name: "Agente gerador de perguntas por conteúdo",
      description: "Flow completo para consultar conteúdo local/RAG e gerar uma lista estruturada de perguntas a partir do material.",
      tags: ["agent", "questions", "rag", "content"],
      scope: "local",
      source: "builtin",
      createdAt,
      updatedAt: createdAt,
      content: agentTemplateContent(
        contentQuestionGeneratorFlow({ id: "{{flowId}}", name: "{{flowName}}", resourceName: "{{resourceName}}" }),
        [
          {
            id: "system",
            path: "prompts/system.md",
            content: contentQuestionGeneratorPrompt("{{flowName}}"),
          },
        ],
        [
          {
            id: "session_state",
            path: "schemas/session_state.schema.json",
            content: `${JSON.stringify(contentQuestionGeneratorStateSchema("{{flowName}}"), null, 2)}\n`,
          },
          {
            id: "question_list",
            path: "schemas/question_list.schema.json",
            content: questionListSchemaContent(),
          },
        ],
      ),
    },
    {
      id: "pro-up-parity-complex-agent",
      kind: "agent_template",
      name: "Agente complexo de paridade ProUp",
      description: "Flow completo para provar conversa por sessão, consulta de conteúdo, geração de perguntas, estado, avaliação, analytics e escape hatch por código/HTTP.",
      tags: ["agent", "complex", "proup", "conversation", "rag", "questions", "evaluation"],
      scope: "local",
      source: "builtin",
      createdAt,
      updatedAt: createdAt,
      content: agentTemplateContent(
        proUpParityComplexFlow({ id: "{{flowId}}", name: "{{flowName}}", resourceName: "{{resourceName}}" }),
        [
          {
            id: "system",
            path: "prompts/system.md",
            content: proUpParityComplexPrompt("{{flowName}}"),
          },
        ],
        [
          {
            id: "session_state",
            path: "schemas/session_state.schema.json",
            content: `${JSON.stringify(proUpParityComplexStateSchema("{{flowName}}"), null, 2)}\n`,
          },
          {
            id: "conversation_turn",
            path: "schemas/conversation_turn.schema.json",
            content: proUpParityComplexTurnSchemaContent(),
          },
        ],
      ),
    },
    {
      id: "structured-question-generation-skill",
      kind: "skill",
      name: "Skill de perguntas estruturadas",
      description: "Adiciona prompt e schema para transformar um nó LLM selecionado em gerador de perguntas estruturadas.",
      tags: ["skill", "questions", "structured-output"],
      scope: "local",
      source: "builtin",
      createdAt,
      updatedAt: createdAt,
      content: skillCatalogContent(
        [
          {
            id: "question_generation",
            path: "prompts/question_generation.md",
            content: contentQuestionGeneratorPrompt("Gerador de Perguntas"),
          },
        ],
        [
          {
            id: "question_list",
            path: "schemas/question_list.schema.json",
            content: questionListSchemaContent(),
          },
        ],
        {
          type: "llm_structured",
          description: "Gera perguntas estruturadas a partir do contexto disponível.",
        },
      ),
    },
    {
      id: "context-review-composite-skill",
      kind: "skill",
      name: "Skill composta de revisão com contexto",
      description: "Materializa extração de conteúdo, recuperação local e resposta estruturada com prompt/schema próprios.",
      tags: ["skill", "bundle", "rag", "questions", "structured-output"],
      scope: "local",
      source: "builtin",
      createdAt,
      updatedAt: createdAt,
      content: skillCatalogContent(
        [
          {
            id: "context_review",
            path: "prompts/context_review.md",
            content:
              "Você revisa conteúdo recuperado antes de gerar perguntas.\n\n" +
              "- Use o contexto recuperado quando existir.\n" +
              "- Responda com resumo, riscos e próximas perguntas.\n" +
              "- Se o contexto estiver incompleto, explicite a lacuna.\n",
          },
        ],
        [
          {
            id: "context_review_result",
            path: "schemas/context_review_result.schema.json",
            content: `${JSON.stringify(
              {
                type: "object",
                required: ["summary", "risks", "next_questions"],
                properties: {
                  summary: { type: "string" },
                  risks: {
                    type: "array",
                    items: { type: "string" },
                  },
                  next_questions: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
              },
              null,
              2,
            )}\n`,
          },
        ],
        undefined,
        [
          {
            id: "extract_context",
            type: "file_extract",
            description: "Extrai conteúdo local para alimentar a skill.",
            sourcePath: "files/context.md",
            contentPath: "context.raw",
            maxChars: 20000,
            position: { x: 0, y: 0 },
          },
          {
            id: "retrieve_context",
            type: "rag_retrieval",
            description: "Seleciona trechos relevantes para a pergunta atual.",
            collectionPath: "files/context.md",
            queryPath: "user_message",
            contextPath: "context.relevant",
            topK: 5,
            position: { x: 260, y: 0 },
          },
          {
            id: "review_context",
            type: "llm_structured",
            description: "Gera revisão estruturada com próximas perguntas.",
            promptId: "context_review",
            outputSchema: "context_review_result",
            position: { x: 520, y: 0 },
          },
        ],
        [
          { from: "extract_context", to: "retrieve_context" },
          { from: "retrieve_context", to: "review_context" },
        ],
      ),
    },
    {
      id: "http-json-tool",
      kind: "tool",
      name: "HTTP JSON tool",
      description: "Template para chamar um executor HTTP local por contrato JSON.",
      tags: ["tool", "http", "json"],
      scope: "local",
      source: "builtin",
      createdAt,
      updatedAt: createdAt,
      nodePatch: {
        type: "code",
        codeLanguage: "external",
        codeExecution: "http",
        method: "POST",
        url: "http://127.0.0.1:9001/run",
        inputPath: "$.input",
        outputPath: "$.tool_result",
        timeoutSeconds: 30,
      },
    },
    {
      id: "guarded-http-json-block",
      kind: "tool",
      name: "Bloco HTTP JSON validado",
      description: "Bloco composto com normalização de payload seguida de chamada HTTP local por contrato JSON.",
      tags: ["tool", "bundle", "http", "json"],
      scope: "local",
      source: "builtin",
      createdAt,
      updatedAt: createdAt,
      content: toolBundleCatalogContent(
        [
          {
            id: "prepare_payload",
            type: "transform_json",
            description: "Normaliza o input recebido antes da execução externa.",
            inputPath: "input",
            outputPath: "tool_payload",
            position: { x: 0, y: 0 },
          },
          {
            id: "call_http_json",
            type: "code",
            description: "Executa a tool HTTP local usando o payload normalizado.",
            handler: "http_json_tool",
            codeLanguage: "external",
            codeExecution: "http",
            method: "POST",
            url: "http://127.0.0.1:9001/run",
            inputPath: "tool_payload",
            outputPath: "tool_result",
            timeoutSeconds: 30,
            position: { x: 260, y: 0 },
          },
        ],
        [{ from: "prepare_payload", to: "call_http_json" }],
      ),
    },
    {
      id: "mcp-stdio-tool",
      kind: "tool",
      name: "MCP stdio tool",
      description: "Template para chamar uma tool MCP local via stdio.",
      tags: ["tool", "mcp", "stdio"],
      scope: "local",
      source: "builtin",
      createdAt,
      updatedAt: createdAt,
      nodePatch: {
        type: "code",
        codeLanguage: "external",
        codeExecution: "mcp",
        mcpCommand: "python",
        mcpArgs: ["tools/server.py"],
        mcpToolName: "tool_name",
        mcpProtocolVersion: "2025-11-25",
        inputPath: "$.input",
        outputPath: "$.tool_result",
        timeoutSeconds: 30,
      },
    },
    {
      id: "sidecar-python-tool",
      kind: "tool",
      name: "Sidecar Python tool",
      description: "Template para chamar um processo Python local por stdin/stdout JSON.",
      tags: ["tool", "sidecar", "python"],
      scope: "local",
      source: "builtin",
      createdAt,
      updatedAt: createdAt,
      nodePatch: {
        type: "code",
        codeLanguage: "python",
        codeExecution: "sidecar",
        sidecarCommand: "python",
        sidecarArgs: ["app/code/tool.py"],
        inputPath: "$.input",
        outputPath: "$.tool_result",
        timeoutSeconds: 30,
      },
    },
  ];
  return items.map((item) => ({
    ...item,
    version: "1.0.0",
    revision: 1,
    contentHash: catalogItemContentHash(item),
    history: [],
  }));
}

async function readSharedCatalogLibrary(workspaceRoot: string): Promise<LocalCatalogSharedLibraryPackage> {
  const libraryPath = safeResolve(workspaceRoot, LOCAL_CATALOG_SHARED_LIBRARY_PATH);
  try {
    const raw = await readFile(libraryPath, "utf-8");
    const payload = normalizeCatalogSharedLibraryPackage(JSON.parse(raw) as unknown);
    if (!payload) {
      throw new WorkspaceError("Biblioteca compartilhada do catálogo não respeita o formato esperado.", 422);
    }
    return payload;
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return buildCatalogSharedLibraryPackage([], { action: "empty" });
    }
    if (error instanceof WorkspaceError) {
      throw error;
    }
    throw new WorkspaceError("Falha ao ler biblioteca compartilhada do catálogo.", 500, error);
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

async function writeSharedCatalogLibrary(
  workspaceRoot: string,
  library: LocalCatalogSharedLibraryPackage,
): Promise<void> {
  const libraryPath = safeResolve(workspaceRoot, LOCAL_CATALOG_SHARED_LIBRARY_PATH);
  await mkdir(path.dirname(libraryPath), { recursive: true });
  await writeFile(libraryPath, `${JSON.stringify(library, null, 2)}\n`, "utf-8");
}

function normalizeCatalogSharedLibraryPackage(value: unknown): LocalCatalogSharedLibraryPackage | null {
  if (
    !isRecord(value) ||
    value.format !== LOCAL_CATALOG_SHARED_LIBRARY_FORMAT ||
    !Array.isArray(value.items)
  ) {
    return null;
  }
  return buildCatalogSharedLibraryPackage(value.items, { action: "merge" }, Array.isArray(value.conflicts) ? value.conflicts : []);
}

function buildCatalogSharedLibraryPackage(
  items: unknown[],
  syncInput: {
    action: LocalCatalogSharedSyncInfo["action"];
    stats?: Partial<LocalCatalogSharedSyncStats>;
  },
  conflicts: unknown[] = [],
): LocalCatalogSharedLibraryPackage {
  const normalized = syncCatalogSharedLibraryItems(items);
  const normalizedConflicts = syncCatalogLibraryConflicts(conflicts, normalized);
  const resolutionHistory = buildCatalogLibraryResolutionHistory(normalizedConflicts);
  const withoutHash = {
    format: LOCAL_CATALOG_SHARED_LIBRARY_FORMAT as typeof LOCAL_CATALOG_SHARED_LIBRARY_FORMAT,
    exportedAt: new Date().toISOString(),
    itemCount: normalized.length,
    conflictCount: normalizedConflicts.length,
    openConflictCount: normalizedConflicts.filter((conflict) => conflict.status === "open").length,
    conflicts: normalizedConflicts,
    resolutionHistoryCount: resolutionHistory.length,
    resolutionHistory,
    items: normalized,
  };
  const contentHash = createHash("sha256")
    .update(JSON.stringify({ conflicts: normalizedConflicts, items: normalized.map(catalogSharedLibraryItemFingerprint) }))
    .digest("hex")
    .slice(0, 12);
  return {
    ...withoutHash,
    packageHash: createHash("sha256")
      .update(JSON.stringify({ format: LOCAL_CATALOG_SHARED_LIBRARY_FORMAT, itemCount: normalized.length, contentHash }))
      .digest("hex")
      .slice(0, 12),
    sharedSync: {
      action: syncInput.action,
      storage: LOCAL_CATALOG_SHARED_LIBRARY_PATH,
      updatedAt: new Date().toISOString(),
      contentHash,
      incomingCount: Math.max(0, Math.floor(syncInput.stats?.incomingCount ?? normalized.length)),
      existingCount: Math.max(0, Math.floor(syncInput.stats?.existingCount ?? 0)),
      addedCount: Math.max(0, Math.floor(syncInput.stats?.addedCount ?? 0)),
      updatedCount: Math.max(0, Math.floor(syncInput.stats?.updatedCount ?? 0)),
      unchangedCount: Math.max(0, Math.floor(syncInput.stats?.unchangedCount ?? 0)),
      conflictCount: Math.max(0, Math.floor(syncInput.stats?.conflictCount ?? normalizedConflicts.filter((conflict) => conflict.status === "open").length)),
      finalCount: Math.max(0, Math.floor(syncInput.stats?.finalCount ?? normalized.length)),
      governance: {
        excludesSecretValues: true,
        excludesRawCatalogContent: false,
        excludesRawConflictContent: true,
      },
    },
  };
}

function buildLocalCatalogConflictReviewPackage(
  sharedLibrary: LocalCatalogSharedLibraryPackage,
): LocalCatalogConflictReviewPackage {
  return buildLocalCatalogConflictReviewPackageFromParts({
    source: {
      storage: LOCAL_CATALOG_SHARED_LIBRARY_PATH,
      packageHash: sharedLibrary.packageHash,
      contentHash: sharedLibrary.sharedSync.contentHash,
      itemCount: sharedLibrary.itemCount,
    },
    conflicts: sharedLibrary.conflicts,
    resolutionHistory: sharedLibrary.resolutionHistory,
  });
}

function buildLocalCatalogConflictReviewPackageFromParts(input: {
  exportedAt?: string;
  source: LocalCatalogConflictReviewPackage["source"];
  conflicts: LocalCatalogLibraryConflict[];
  resolutionHistory?: LocalCatalogLibraryResolutionRecord[];
}): LocalCatalogConflictReviewPackage {
  const conflicts = [...input.conflicts].sort(
    (left, right) => comparableCatalogTimestamp(right.createdAt) - comparableCatalogTimestamp(left.createdAt),
  );
  const resolutionHistory = (input.resolutionHistory?.length ? input.resolutionHistory : buildCatalogLibraryResolutionHistory(conflicts))
    .slice(0, 128);
  const withoutHash = {
    format: LOCAL_CATALOG_CONFLICT_REVIEW_FORMAT as typeof LOCAL_CATALOG_CONFLICT_REVIEW_FORMAT,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    source: input.source,
    summary: {
      itemCount: input.source.itemCount,
      conflictCount: conflicts.length,
      openConflictCount: conflicts.filter((conflict) => conflict.status === "open").length,
      resolutionHistoryCount: resolutionHistory.length,
      promptConflictCount: conflicts.filter((conflict) => conflict.kind === "prompt").length,
      schemaConflictCount: conflicts.filter((conflict) => conflict.kind === "schema").length,
      toolConflictCount: conflicts.filter((conflict) => conflict.kind === "tool").length,
      agentTemplateConflictCount: conflicts.filter((conflict) => conflict.kind === "agent_template").length,
      skillConflictCount: conflicts.filter((conflict) => conflict.kind === "skill").length,
      assignedConflictCount: conflicts.filter((conflict) => conflict.curationThread.status === "assigned").length,
      unassignedConflictCount: conflicts.filter((conflict) => conflict.curationThread.status === "unassigned").length,
      resolvedThreadCount: conflicts.filter((conflict) => conflict.curationThread.status === "resolved").length,
    },
    conflictCount: conflicts.length,
    openConflictCount: conflicts.filter((conflict) => conflict.status === "open").length,
    conflicts,
    resolutionHistoryCount: resolutionHistory.length,
    resolutionHistory,
    governance: {
      excludesRawCatalogContent: true,
      excludesRawConflictContent: true,
      excludesSecretValues: true,
    } as const,
  };
  return {
    ...withoutHash,
    packageHash: createHash("sha256")
      .update(JSON.stringify({
        format: LOCAL_CATALOG_CONFLICT_REVIEW_FORMAT,
        source: withoutHash.source,
        conflicts: conflicts.map(localCatalogConflictReviewSignature),
        resolutionHistory: resolutionHistory.map(localCatalogConflictReviewResolutionSignature),
      }))
      .digest("hex")
      .slice(0, 12),
  };
}

function normalizeLocalCatalogConflictReviewPackage(value: unknown): LocalCatalogConflictReviewPackage | null {
  if (
    !isRecord(value) ||
    value.format !== LOCAL_CATALOG_CONFLICT_REVIEW_FORMAT ||
    !Array.isArray(value.conflicts)
  ) {
    return null;
  }
  if (containsRawLocalCatalogConflictReviewPayload(value)) {
    return null;
  }
  const conflicts = value.conflicts
    .map((conflict) => {
      try {
        return normalizeCatalogLibraryConflict(conflict);
      } catch {
        return null;
      }
    })
    .filter((conflict): conflict is LocalCatalogLibraryConflict => conflict !== null);
  const source = isRecord(value.source)
    ? {
        storage: typeof value.source.storage === "string" && value.source.storage.trim()
          ? value.source.storage.trim()
          : LOCAL_CATALOG_SHARED_LIBRARY_PATH,
        packageHash: typeof value.source.packageHash === "string" && value.source.packageHash.trim()
          ? value.source.packageHash.trim()
          : "",
        contentHash: typeof value.source.contentHash === "string" && value.source.contentHash.trim()
          ? value.source.contentHash.trim()
          : "",
        itemCount: normalizeCatalogReviewCount(value.source.itemCount, conflicts.length),
      }
    : {
        storage: LOCAL_CATALOG_SHARED_LIBRARY_PATH,
        packageHash: "",
        contentHash: "",
        itemCount: conflicts.length,
      };
  return buildLocalCatalogConflictReviewPackageFromParts({
    exportedAt: typeof value.exportedAt === "string" && value.exportedAt.trim() ? value.exportedAt.trim() : undefined,
    source,
    conflicts,
  });
}

function containsRawLocalCatalogConflictReviewPayload(value: unknown): boolean {
  const rawKeys = new Set([
    "items",
    "item",
    "content",
    "nodePatch",
    "history",
    "sharedLibrary",
    "catalog",
    "payload",
    "input",
    "output",
    "secret",
    "secrets",
  ]);
  const visit = (entry: unknown): boolean => {
    if (Array.isArray(entry)) {
      return entry.some(visit);
    }
    if (!isRecord(entry)) {
      return false;
    }
    return Object.entries(entry).some(([key, item]) => rawKeys.has(key) || visit(item));
  };
  return visit(value);
}

function buildLocalCatalogConflictReviewDiffPackage(
  current: LocalCatalogConflictReviewPackage,
  incoming: LocalCatalogConflictReviewPackage,
): LocalCatalogConflictReviewDiffPackage {
  const sections: LocalCatalogConflictReviewDiffSection[] = [
    buildLocalCatalogConflictReviewSummaryDiffSection(current, incoming),
    buildLocalCatalogConflictReviewDiffSection(
      "conflicts",
      "Conflitos",
      current.conflicts,
      incoming.conflicts,
      (conflict) => conflict.id,
      localCatalogConflictReviewSignature,
      localCatalogConflictReviewSummary,
    ),
    buildLocalCatalogConflictReviewDiffSection(
      "resolution_history",
      "Histórico de resolução",
      current.resolutionHistory,
      incoming.resolutionHistory,
      (record) => record.resolutionId,
      localCatalogConflictReviewResolutionSignature,
      localCatalogConflictReviewResolutionSummary,
    ),
  ];
  const withoutHash = {
    format: LOCAL_CATALOG_CONFLICT_REVIEW_DIFF_FORMAT as typeof LOCAL_CATALOG_CONFLICT_REVIEW_DIFF_FORMAT,
    comparedAt: new Date().toISOString(),
    current: {
      packageHash: current.packageHash,
      exportedAt: current.exportedAt,
      conflictCount: current.conflictCount,
      openConflictCount: current.openConflictCount,
      resolutionHistoryCount: current.resolutionHistoryCount,
    },
    incoming: {
      packageHash: incoming.packageHash,
      exportedAt: incoming.exportedAt,
      conflictCount: incoming.conflictCount,
      openConflictCount: incoming.openConflictCount,
      resolutionHistoryCount: incoming.resolutionHistoryCount,
    },
    sections,
    governance: {
      excludesRawCatalogContent: true,
      excludesRawConflictContent: true,
      excludesSecretValues: true,
    } as const,
  };
  return {
    ...withoutHash,
    packageHash: createHash("sha256")
      .update(JSON.stringify({ format: LOCAL_CATALOG_CONFLICT_REVIEW_DIFF_FORMAT, current: current.packageHash, incoming: incoming.packageHash, sections }))
      .digest("hex")
      .slice(0, 12),
  };
}

function buildLocalCatalogConflictReviewSummaryDiffSection(
  current: LocalCatalogConflictReviewPackage,
  incoming: LocalCatalogConflictReviewPackage,
): LocalCatalogConflictReviewDiffSection {
  const currentItems = localCatalogConflictReviewSummaryItems(current);
  const incomingItems = localCatalogConflictReviewSummaryItems(incoming);
  return buildLocalCatalogConflictReviewDiffSection(
    "summary",
    "Resumo",
    currentItems,
    incomingItems,
    (item) => item.id,
    (item) => String(item.value),
    (item) => `${item.label}: ${item.value}`,
  );
}

function buildLocalCatalogConflictReviewDiffSection<T>(
  id: LocalCatalogConflictReviewDiffSection["id"],
  label: string,
  currentItems: T[],
  incomingItems: T[],
  keyFor: (item: T) => string,
  hashFor: (item: T) => string,
  summaryFor: (item: T) => string,
): LocalCatalogConflictReviewDiffSection {
  const currentByKey = new Map(currentItems.map((item) => [keyFor(item), item]));
  const incomingByKey = new Map(incomingItems.map((item) => [keyFor(item), item]));
  const keys = Array.from(new Set([...currentByKey.keys(), ...incomingByKey.keys()])).sort((left, right) => left.localeCompare(right));
  const items = keys.map((key) => {
    const current = currentByKey.get(key) ?? null;
    const incoming = incomingByKey.get(key) ?? null;
    const currentHash = current ? hashFor(current) : null;
    const incomingHash = incoming ? hashFor(incoming) : null;
    return {
      id: key,
      label: current ? summaryFor(current) : incoming ? summaryFor(incoming) : key,
      status: localCatalogConflictReviewDiffStatus(currentHash, incomingHash),
      currentHash,
      incomingHash,
      currentSummary: current ? summaryFor(current) : null,
      incomingSummary: incoming ? summaryFor(incoming) : null,
    };
  });
  return {
    id,
    label,
    itemCount: items.length,
    changedCount: items.filter((item) => item.status !== "unchanged").length,
    items,
  };
}

function localCatalogConflictReviewDiffStatus(
  currentHash: string | null,
  incomingHash: string | null,
): LocalCatalogConflictReviewDiffItemStatus {
  if (currentHash && incomingHash) {
    return currentHash === incomingHash ? "unchanged" : "changed";
  }
  return currentHash ? "only_current" : "only_incoming";
}

function localCatalogConflictReviewSummaryItems(
  review: LocalCatalogConflictReviewPackage,
): Array<{ id: string; label: string; value: number }> {
  return [
    { id: "itemCount", label: "Itens", value: review.summary.itemCount },
    { id: "conflictCount", label: "Conflitos", value: review.summary.conflictCount },
    { id: "openConflictCount", label: "Abertos", value: review.summary.openConflictCount },
    { id: "resolutionHistoryCount", label: "Decisões", value: review.summary.resolutionHistoryCount },
    { id: "promptConflictCount", label: "Prompts", value: review.summary.promptConflictCount },
    { id: "schemaConflictCount", label: "Schemas", value: review.summary.schemaConflictCount },
    { id: "toolConflictCount", label: "Tools", value: review.summary.toolConflictCount },
    { id: "agentTemplateConflictCount", label: "Templates", value: review.summary.agentTemplateConflictCount },
    { id: "skillConflictCount", label: "Skills", value: review.summary.skillConflictCount },
    { id: "assignedConflictCount", label: "Assumidos", value: review.summary.assignedConflictCount },
    { id: "unassignedConflictCount", label: "Sem responsável", value: review.summary.unassignedConflictCount },
    { id: "resolvedThreadCount", label: "Threads resolvidas", value: review.summary.resolvedThreadCount },
  ];
}

function localCatalogConflictReviewSignature(conflict: LocalCatalogLibraryConflict): string {
  return createHash("sha256")
    .update(JSON.stringify({
      id: conflict.id,
      itemKey: conflict.itemKey,
      status: conflict.status,
      reason: conflict.reason,
      existingSnapshot: catalogResolutionSnapshotRef(conflict.existingSnapshot),
      incomingSnapshot: catalogResolutionSnapshotRef(conflict.incomingSnapshot),
      curationThread: {
        status: conflict.curationThread.status,
        assignee: conflict.curationThread.assignee,
        lastActor: conflict.curationThread.lastActor,
        lastAction: conflict.curationThread.lastAction,
        events: conflict.curationThread.events.map((event) => ({
          id: event.id,
          action: event.action,
          actor: event.actor,
          assignee: event.assignee,
          role: event.role,
        })),
      },
      resolution: conflict.resolution,
      resolutionPlan: conflict.resolutionPlan,
      resolvedBy: conflict.resolvedBy,
      resolvedRole: conflict.resolvedRole,
    }))
    .digest("hex")
    .slice(0, 12);
}

function localCatalogConflictReviewResolutionSignature(record: LocalCatalogLibraryResolutionRecord): string {
  return createHash("sha256")
    .update(JSON.stringify({
      resolutionId: record.resolutionId,
      conflictId: record.conflictId,
      itemKey: record.itemKey,
      resolvedBy: record.resolvedBy,
      resolvedRole: record.resolvedRole,
      resolution: record.resolution,
      keptSnapshot: catalogResolutionSnapshotRef(record.keptSnapshot),
      discardedSnapshots: record.discardedSnapshots.map(catalogResolutionSnapshotRef),
    }))
    .digest("hex")
    .slice(0, 12);
}

function localCatalogConflictReviewSummary(conflict: LocalCatalogLibraryConflict): string {
  const name = conflict.incomingSnapshot.name || conflict.existingSnapshot.name || conflict.itemId;
  return `${conflict.kind}:${conflict.itemId} · ${name} · ${conflict.status} · ${conflict.reason}`;
}

function localCatalogConflictReviewResolutionSummary(record: LocalCatalogLibraryResolutionRecord): string {
  return `${record.kind}:${record.itemId} · ${record.resolution} · ${record.resolvedBy || "local-studio"}`;
}

function normalizeCatalogReviewCount(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

interface LocalCatalogCentralSyncConfig {
  url: string | null;
  token: string | null;
  timeoutMs: number;
  invalidReason: string | null;
}

function localCatalogCentralSyncConfig(): LocalCatalogCentralSyncConfig {
  const errors: string[] = [];
  const configuredUrl = (process.env[LOCAL_CATALOG_CENTRAL_URL_ENV] ?? "").trim();
  let url: string | null = null;
  if (configuredUrl) {
    try {
      url = validateLocalCatalogCentralUrl(configuredUrl);
    } catch (error) {
      errors.push(errorMessage(error));
    }
  }

  let timeoutMs = LOCAL_CATALOG_CENTRAL_TIMEOUT_MS;
  const configuredTimeout = (process.env[LOCAL_CATALOG_CENTRAL_TIMEOUT_ENV] ?? "").trim();
  if (configuredTimeout) {
    const parsed = Number(configuredTimeout);
    if (!Number.isInteger(parsed) || parsed < 100 || parsed > 60_000) {
      errors.push(`${LOCAL_CATALOG_CENTRAL_TIMEOUT_ENV} deve ser inteiro entre 100 e 60000.`);
    } else {
      timeoutMs = parsed;
    }
  }

  return {
    url,
    token: (process.env[LOCAL_CATALOG_CENTRAL_TOKEN_ENV] ?? "").trim() || null,
    timeoutMs,
    invalidReason: errors.length ? errors.join(" ") : null,
  };
}

function buildLocalCatalogCentralSyncStatus(
  config: LocalCatalogCentralSyncConfig,
  sync?: Pick<LocalCatalogCentralSyncStatus, "lastSyncedAt" | "statusCode" | "pushedItemCount" | "pulledItemCount" | "error">,
): LocalCatalogCentralSyncStatus {
  return {
    format: LOCAL_CATALOG_CENTRAL_STATUS_FORMAT,
    generatedAt: new Date().toISOString(),
    configured: Boolean(config.url && !config.invalidReason),
    urlConfigured: Boolean(config.url),
    tokenConfigured: Boolean(config.token),
    timeoutMs: config.timeoutMs,
    invalidReason: config.invalidReason,
    lastSyncedAt: sync?.lastSyncedAt ?? null,
    statusCode: sync?.statusCode ?? null,
    pushedItemCount: sync?.pushedItemCount ?? null,
    pulledItemCount: sync?.pulledItemCount ?? null,
    error: sync?.error ?? null,
    governance: {
      excludesSecretValues: true,
      sendsRawCatalogContent: true,
      sendsRawConflictContent: false,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
      storesCentralToken: false,
      configuredUrlEnv: LOCAL_CATALOG_CENTRAL_URL_ENV,
      configuredTokenEnv: LOCAL_CATALOG_CENTRAL_TOKEN_ENV,
      configuredTimeoutEnv: LOCAL_CATALOG_CENTRAL_TIMEOUT_ENV,
      maxPayloadBytes: LOCAL_CATALOG_CENTRAL_MAX_BYTES,
    },
  };
}

async function fetchCentralLocalCatalogSync(
  config: LocalCatalogCentralSyncConfig,
  sharedLibrary: LocalCatalogSharedLibraryPackage,
): Promise<{ statusCode: number; body: string }> {
  if (!config.url) {
    throw new WorkspaceError("Central do catálogo não configurada.", 400);
  }
  const body = JSON.stringify({
    format: LOCAL_CATALOG_CENTRAL_SYNC_REQUEST_FORMAT,
    generatedAt: new Date().toISOString(),
    sharedLibrary,
    itemCount: sharedLibrary.itemCount,
    governance: {
      excludesSecretValues: true,
      sendsRawCatalogContent: true,
      sendsRawConflictContent: false,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  });
  if (Buffer.byteLength(body, "utf-8") > LOCAL_CATALOG_CENTRAL_MAX_BYTES) {
    throw new WorkspaceError("Biblioteca local do catálogo excede o limite de tamanho permitido para sync central.", 413);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
    };
    if (config.token) {
      headers.authorization = `Bearer ${config.token}`;
    }
    const response = await fetch(config.url, {
      method: "POST",
      signal: controller.signal,
      headers,
      body,
      redirect: "follow",
    });
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > LOCAL_CATALOG_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central do catálogo excede o limite de tamanho permitido.", 413);
    }
    if (!response.ok) {
      throw new WorkspaceError(`Central do catálogo respondeu HTTP ${response.status}.`, response.status);
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > LOCAL_CATALOG_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central do catálogo excede o limite de tamanho permitido.", 413);
    }
    return {
      statusCode: response.status,
      body: Buffer.from(buffer).toString("utf-8"),
    };
  } catch (error) {
    if (isRecord(error) && error.name === "AbortError") {
      throw new WorkspaceError("Timeout ao sincronizar central do catálogo.", 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function mergeCatalogLibraryItems(
  existingItems: unknown[],
  incomingItems: unknown[],
  existingConflicts: unknown[] = [],
  incomingConflicts: unknown[] = [],
): {
  items: LocalCatalogItem[];
  conflicts: LocalCatalogLibraryConflict[];
  stats: LocalCatalogSharedSyncStats;
} {
  const existing = syncCatalogSharedLibraryItems(existingItems);
  const incoming = syncCatalogSharedLibraryItems(incomingItems);
  const byKey = new Map(existing.map((item) => [catalogItemKey(item.kind, item.id), item]));
  const conflicts: LocalCatalogLibraryConflict[] = [
    ...syncCatalogLibraryConflicts(existingConflicts, existing),
    ...syncCatalogLibraryConflicts(incomingConflicts, incoming),
  ];
  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  let conflictCount = 0;
  for (const incomingItem of incoming) {
    const key = catalogItemKey(incomingItem.kind, incomingItem.id);
    const existingItem = byKey.get(key);
    if (!existingItem) {
      addedCount += 1;
      byKey.set(key, incomingItem);
      continue;
    }
    if (shouldCreateCatalogConflict(existingItem, incomingItem)) {
      const conflict = buildCatalogLibraryConflict(existingItem, incomingItem);
      const resolvedDecision = resolveCatalogConflictFromHistory(conflicts, existingItem, incomingItem);
      if (resolvedDecision === "keep_existing") {
        unchangedCount += 1;
        continue;
      }
      const previousConflict = conflicts.find((entry) => entry.id === conflict.id);
      if (!previousConflict && resolvedDecision !== "allow_incoming") {
        conflicts.push(conflict);
        conflictCount += 1;
      }
    }
    if (Date.parse(existingItem.updatedAt) <= Date.parse(incomingItem.updatedAt)) {
      if (catalogSharedLibraryItemFingerprint(existingItem) === catalogSharedLibraryItemFingerprint(incomingItem)) {
        unchangedCount += 1;
      } else {
        updatedCount += 1;
      }
      byKey.set(key, incomingItem);
    } else {
      unchangedCount += 1;
    }
  }
  const items = sortCatalogItems(Array.from(byKey.values()));
  return {
    items,
    conflicts: syncCatalogLibraryConflicts(conflicts, items),
    stats: {
      incomingCount: incoming.length,
      existingCount: existing.length,
      addedCount,
      updatedCount,
      unchangedCount,
      conflictCount,
      finalCount: items.length,
    },
  };
}

function shouldCreateCatalogConflict(existing: LocalCatalogItem, incoming: LocalCatalogItem): boolean {
  return catalogSharedLibraryItemFingerprint(existing) !== catalogSharedLibraryItemFingerprint(incoming);
}

function resolveCatalogConflictFromHistory(
  conflicts: LocalCatalogLibraryConflict[],
  existingItem: LocalCatalogItem,
  incomingItem: LocalCatalogItem,
): LocalCatalogResolvedConflictDecision | null {
  const itemKey = catalogItemKey(existingItem.kind, existingItem.id);
  if (itemKey !== catalogItemKey(incomingItem.kind, incomingItem.id)) {
    return null;
  }
  const existingSnapshot = catalogLibraryConflictSnapshot(existingItem);
  const incomingSnapshot = catalogLibraryConflictSnapshot(incomingItem);
  for (const conflict of conflicts.filter((entry) => entry.status === "resolved" && entry.itemKey === itemKey)) {
    const selectedSnapshot = selectedResolvedCatalogConflictSnapshot(conflict);
    const discardedSnapshot = discardedResolvedCatalogConflictSnapshot(conflict, selectedSnapshot);
    if (!selectedSnapshot || !discardedSnapshot) {
      continue;
    }
    if (
      catalogConflictSnapshotsMatch(existingSnapshot, selectedSnapshot) &&
      catalogConflictSnapshotsMatch(incomingSnapshot, discardedSnapshot)
    ) {
      return "keep_existing";
    }
    if (
      catalogConflictSnapshotsMatch(existingSnapshot, discardedSnapshot) &&
      catalogConflictSnapshotsMatch(incomingSnapshot, selectedSnapshot)
    ) {
      return "allow_incoming";
    }
  }
  return null;
}

function buildCatalogLibraryResolutionHistory(
  conflicts: LocalCatalogLibraryConflict[],
): LocalCatalogLibraryResolutionRecord[] {
  return conflicts
    .map(buildCatalogLibraryResolutionRecord)
    .filter((record): record is LocalCatalogLibraryResolutionRecord => record !== null)
    .sort((left, right) => comparableCatalogTimestamp(right.resolvedAt) - comparableCatalogTimestamp(left.resolvedAt))
    .slice(0, 128);
}

function buildCatalogLibraryResolutionRecord(
  conflict: LocalCatalogLibraryConflict,
): LocalCatalogLibraryResolutionRecord | null {
  if (conflict.status !== "resolved" || !conflict.resolvedAt || !conflict.resolution) {
    return null;
  }
  const keptSnapshot = selectedResolvedCatalogConflictSnapshot(conflict);
  const discardedSnapshot = discardedResolvedCatalogConflictSnapshot(conflict, keptSnapshot);
  if (!keptSnapshot || !discardedSnapshot) {
    return null;
  }
  const resolutionId = `catalog-resolution-${createHash("sha256")
    .update(JSON.stringify({
      conflictId: conflict.id,
      resolvedAt: conflict.resolvedAt,
      kept: catalogResolutionSnapshotRef(keptSnapshot),
      discarded: catalogResolutionSnapshotRef(discardedSnapshot),
      resolution: conflict.resolution,
      resolvedRole: conflict.resolvedRole,
    }))
    .digest("hex")
    .slice(0, 16)}`;
  return {
    resolutionId,
    conflictId: conflict.id,
    itemKey: conflict.itemKey,
    itemId: conflict.itemId,
    kind: conflict.kind,
    resolvedAt: conflict.resolvedAt,
    resolvedBy: conflict.resolvedBy || conflict.curationThread.lastActor || "local-studio",
    resolvedRole: conflict.resolvedRole,
    resolution: conflict.resolution,
    resolutionNote: conflict.resolutionNote,
    keptSnapshot,
    discardedSnapshots: [discardedSnapshot],
    governance: {
      excludesRawCatalogContent: true,
      excludesSecretValues: true,
    },
  };
}

function catalogResolutionSnapshotRef(snapshot: LocalCatalogLibraryConflictSnapshot): unknown {
  return {
    id: snapshot.id,
    kind: snapshot.kind,
    contentHash: snapshot.contentHash,
    itemHash: snapshot.itemHash,
    updatedAt: snapshot.updatedAt,
  };
}

function selectedResolvedCatalogConflictSnapshot(
  conflict: LocalCatalogLibraryConflict,
): LocalCatalogLibraryConflictSnapshot | null {
  const selectedSnapshot = conflict.resolutionPlan?.selectedSnapshot;
  if (selectedSnapshot === "incoming_snapshot") {
    return conflict.incomingSnapshot;
  }
  if (
    selectedSnapshot === "existing_snapshot" ||
    selectedSnapshot === "current_library"
  ) {
    return conflict.existingSnapshot;
  }
  if (conflict.resolution === "use_incoming") {
    return conflict.incomingSnapshot;
  }
  if (conflict.resolution === "restore_existing_snapshot" || conflict.resolution === "keep_library") {
    return conflict.existingSnapshot;
  }
  return null;
}

function discardedResolvedCatalogConflictSnapshot(
  conflict: LocalCatalogLibraryConflict,
  selectedSnapshot: LocalCatalogLibraryConflictSnapshot | null,
): LocalCatalogLibraryConflictSnapshot | null {
  if (!selectedSnapshot) {
    return null;
  }
  if (catalogConflictSnapshotsMatch(selectedSnapshot, conflict.incomingSnapshot)) {
    return conflict.existingSnapshot;
  }
  if (catalogConflictSnapshotsMatch(selectedSnapshot, conflict.existingSnapshot)) {
    return conflict.incomingSnapshot;
  }
  return null;
}

function catalogConflictSnapshotsMatch(
  left: LocalCatalogLibraryConflictSnapshot,
  right: LocalCatalogLibraryConflictSnapshot,
): boolean {
  return left.id === right.id &&
    left.kind === right.kind &&
    left.itemHash === right.itemHash &&
    left.contentHash === right.contentHash;
}

function buildCatalogLibraryConflict(
  existing: LocalCatalogItem,
  incoming: LocalCatalogItem,
): LocalCatalogLibraryConflict {
  const existingSnapshot = catalogLibraryConflictSnapshot(existing);
  const incomingSnapshot = catalogLibraryConflictSnapshot(incoming);
  const createdAt = new Date().toISOString();
  return {
    id: `catalog-conflict-${createHash("sha256")
      .update(JSON.stringify({ existingSnapshot, incomingSnapshot }))
      .digest("hex")
      .slice(0, 12)}`,
    itemKey: catalogItemKey(incoming.kind, incoming.id),
    itemId: incoming.id,
    kind: incoming.kind,
    status: "open",
    reason: catalogConflictReason(existingSnapshot, incomingSnapshot),
    curationThread: defaultCatalogConflictCurationThread(),
    existingSnapshot,
    incomingSnapshot,
    existingUpdatedAt: existingSnapshot.updatedAt,
    incomingUpdatedAt: incomingSnapshot.updatedAt,
    createdAt,
    resolvedAt: null,
    resolvedBy: "",
    resolvedRole: "reviewer",
    resolution: null,
    resolutionNote: "",
    resolutionPlan: null,
  };
}

function catalogConflictReason(
  existing: LocalCatalogLibraryConflictSnapshot,
  incoming: LocalCatalogLibraryConflictSnapshot,
): string {
  const reasons: string[] = [];
  if (existing.itemHash !== incoming.itemHash || existing.contentHash !== incoming.contentHash) {
    reasons.push("conteúdo");
  }
  if (existing.name !== incoming.name || existing.description !== incoming.description) {
    reasons.push("metadados");
  }
  if (JSON.stringify(existing.tags) !== JSON.stringify(incoming.tags)) {
    reasons.push("tags");
  }
  if (existing.version !== incoming.version || existing.revision !== incoming.revision) {
    reasons.push("versão");
  }
  return reasons.length ? reasons.join(", ") : "metadados";
}

function catalogLibraryConflictSnapshot(item: LocalCatalogItem): LocalCatalogLibraryConflictSnapshot {
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    description: item.description,
    tags: [...item.tags].sort((left, right) => left.localeCompare(right)),
    version: item.version,
    revision: item.revision,
    contentHash: item.contentHash,
    itemHash: catalogSharedLibraryItemFingerprint(item),
    updatedAt: item.updatedAt,
    historyCount: item.history.length,
    hasContent: typeof item.content === "string",
    hasNodePatch: item.nodePatch !== undefined,
  };
}

function resolveCatalogConflictActor(payload: unknown): string {
  if (!isRecord(payload)) {
    return "local-studio";
  }
  const resolvedBy = typeof payload.resolvedBy === "string" && payload.resolvedBy.trim()
    ? payload.resolvedBy.trim()
    : "";
  return resolvedBy || "local-studio";
}

function resolveCatalogConflictCurationActor(payload: unknown): string {
  if (!isRecord(payload)) {
    return "local-studio";
  }
  const actor = typeof payload.actor === "string" && payload.actor.trim()
    ? payload.actor.trim()
    : typeof payload.assignee === "string" && payload.assignee.trim()
      ? payload.assignee.trim()
      : typeof payload.resolvedBy === "string" && payload.resolvedBy.trim()
        ? payload.resolvedBy.trim()
        : "";
  return actor.slice(0, 120) || "local-studio";
}

function resolveCatalogConflictCuratorRole(payload: unknown): LocalCatalogLibraryConflictCuratorRole {
  if (!isRecord(payload)) {
    return normalizeCatalogConflictCuratorRole(payload);
  }
  return normalizeCatalogConflictCuratorRole(payload.role ?? payload.resolvedRole);
}

function normalizeCatalogConflictCuratorRole(value: unknown): LocalCatalogLibraryConflictCuratorRole {
  return value === "owner" || value === "viewer" ? value : "reviewer";
}

function assertCatalogConflictMutationAllowed(role: LocalCatalogLibraryConflictCuratorRole, action: string): void {
  if (role !== "viewer") {
    return;
  }
  throw new WorkspaceError(`Viewer não pode ${action}.`, 403, {
    code: "catalog_conflict_viewer_forbidden",
    role,
    requiredRole: "reviewer",
  });
}

function resolveCatalogConflictCurationNote(payload: unknown): string {
  if (!isRecord(payload) || typeof payload.note !== "string") {
    return "";
  }
  return payload.note.trim().slice(0, 280);
}

function normalizeCatalogConflictCurationAction(value: unknown): LocalCatalogLibraryConflictCurationAction | null {
  return value === "assign" || value === "release" ? value : null;
}

function defaultCatalogConflictCurationThread(): LocalCatalogLibraryConflictCurationThread {
  return {
    status: "unassigned",
    assignee: "",
    openedAt: null,
    updatedAt: null,
    lastActor: "",
    lastAction: null,
    leaseExpiresAt: null,
    leaseDurationHours: null,
    leaseExpired: false,
    note: "",
    events: [],
    governance: {
      excludesRawCatalogContent: true,
      excludesSecretValues: true,
      autoReleasesExpiredAssignments: true,
      configuredLeaseHoursEnv: LOCAL_CATALOG_CONFLICT_CURATION_LEASE_HOURS_ENV,
    },
  };
}

function normalizeCatalogConflictCurationThread(value: unknown): LocalCatalogLibraryConflictCurationThread {
  const source = isRecord(value) ? value : {};
  const assignee = typeof source.assignee === "string" && source.assignee.trim() ? source.assignee.trim().slice(0, 120) : "";
  const status = normalizeCatalogConflictCurationStatus(source.status) ?? (assignee ? "assigned" : "unassigned");
  const lastAction = normalizeCatalogConflictCurationLastAction(source.lastAction);
  const updatedAt = normalizeDateString(source.updatedAt);
  const leaseDurationHours = normalizeCatalogConflictCurationLeaseHours(source.leaseDurationHours);
  const leaseExpiresAt =
    status === "assigned"
      ? normalizeDateString(source.leaseExpiresAt) ?? (updatedAt ? addHoursIso(updatedAt, leaseDurationHours) : null)
      : null;
  const normalized: LocalCatalogLibraryConflictCurationThread = {
    status,
    assignee: status === "unassigned" ? "" : assignee,
    openedAt: normalizeDateString(source.openedAt),
    updatedAt,
    lastActor: typeof source.lastActor === "string" && source.lastActor.trim() ? source.lastActor.trim().slice(0, 120) : "",
    lastAction,
    leaseExpiresAt,
    leaseDurationHours: status === "assigned" ? leaseDurationHours : null,
    leaseExpired: status !== "assigned" && source.leaseExpired === true,
    note: typeof source.note === "string" && source.note.trim() ? source.note.trim().slice(0, 280) : "",
    events: Array.isArray(source.events)
      ? source.events
          .map(normalizeCatalogConflictCurationEvent)
          .filter((event): event is LocalCatalogLibraryConflictCurationEvent => event !== null)
          .sort((left, right) => right.at.localeCompare(left.at))
          .slice(0, 12)
      : [],
    governance: {
      excludesRawCatalogContent: true,
      excludesSecretValues: true,
      autoReleasesExpiredAssignments: true,
      configuredLeaseHoursEnv: LOCAL_CATALOG_CONFLICT_CURATION_LEASE_HOURS_ENV,
    },
  };
  return expireCatalogConflictCurationThreadIfNeeded(normalized);
}

function normalizeCatalogConflictCurationStatus(value: unknown): LocalCatalogLibraryConflictCurationStatus | null {
  return value === "unassigned" || value === "assigned" || value === "resolved" ? value : null;
}

function normalizeCatalogConflictCurationLastAction(
  value: unknown,
): LocalCatalogLibraryConflictCurationLastAction | null {
  return value === "assign" || value === "release" || value === "resolve" || value === "lease_expired" ? value : null;
}

function normalizeCatalogConflictCurationEvent(value: unknown): LocalCatalogLibraryConflictCurationEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  const at = typeof value.at === "string" && value.at.trim() ? value.at.trim() : "";
  const actor = typeof value.actor === "string" && value.actor.trim() ? value.actor.trim().slice(0, 120) : "";
  const action = normalizeCatalogConflictCurationLastAction(value.action);
  if (!at || !actor || !action) {
    return null;
  }
  const assignee = typeof value.assignee === "string" && value.assignee.trim() ? value.assignee.trim().slice(0, 120) : "";
  const role = resolveCatalogConflictCuratorRole(value);
  const note = typeof value.note === "string" && value.note.trim() ? value.note.trim().slice(0, 280) : "";
  const id = typeof value.id === "string" && value.id.trim()
    ? value.id.trim().slice(0, 160)
    : `catalog-conflict-curation-${createHash("sha256")
        .update(JSON.stringify({ at, actor, action, assignee, role, note }))
        .digest("hex")
        .slice(0, 16)}`;
  return {
    id,
    at,
    actor,
    action,
    assignee,
    role,
    note,
  };
}

function mergeCatalogConflictCurationEvents(
  existing: LocalCatalogLibraryConflictCurationEvent[],
  incoming: LocalCatalogLibraryConflictCurationEvent[],
): LocalCatalogLibraryConflictCurationEvent[] {
  const byId = new Map<string, LocalCatalogLibraryConflictCurationEvent>();
  for (const event of [...existing, ...incoming]) {
    byId.set(event.id, event);
  }
  return Array.from(byId.values())
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, 12);
}

function buildCatalogConflictCurationEvent(
  action: LocalCatalogLibraryConflictCurationLastAction,
  actor: string,
  assignee: string,
  role: LocalCatalogLibraryConflictCuratorRole,
  note: string,
  at: string,
): LocalCatalogLibraryConflictCurationEvent {
  const normalizedNote = note.trim().slice(0, 280);
  return {
    id: `catalog-conflict-curation-${createHash("sha256")
      .update(JSON.stringify({ at, actor, action, assignee, role, note: normalizedNote }))
      .digest("hex")
      .slice(0, 16)}`,
    at,
    actor,
    action,
    assignee,
    role,
    note: normalizedNote,
  };
}

function updateCatalogConflictCurationThread(
  value: unknown,
  action: LocalCatalogLibraryConflictCurationAction,
  actor: string,
  role: LocalCatalogLibraryConflictCuratorRole,
  note: string,
  updatedAt: string,
): LocalCatalogLibraryConflictCurationThread {
  const current = normalizeCatalogConflictCurationThread(value);
  if (action === "release") {
    const event = buildCatalogConflictCurationEvent("release", actor, "", role, note, updatedAt);
    return {
      ...current,
      status: "unassigned",
      assignee: "",
      updatedAt,
      lastActor: actor,
      lastAction: "release",
      leaseExpiresAt: null,
      leaseDurationHours: null,
      leaseExpired: false,
      note,
      events: mergeCatalogConflictCurationEvents([event], current.events),
    };
  }
  const leaseDurationHours = readCatalogConflictCurationLeaseHours();
  const event = buildCatalogConflictCurationEvent("assign", actor, actor, role, note, updatedAt);
  return {
    ...current,
    status: "assigned",
    assignee: actor,
    openedAt: current.openedAt ?? updatedAt,
    updatedAt,
    lastActor: actor,
    lastAction: "assign",
    leaseExpiresAt: addHoursIso(updatedAt, leaseDurationHours),
    leaseDurationHours,
    leaseExpired: false,
    note,
    events: mergeCatalogConflictCurationEvents([event], current.events),
  };
}

function resolveCatalogConflictCurationThread(
  value: unknown,
  actor: string,
  role: LocalCatalogLibraryConflictCuratorRole,
  note: string,
  updatedAt: string,
): LocalCatalogLibraryConflictCurationThread {
  const current = normalizeCatalogConflictCurationThread(value);
  const assignee = current.assignee || actor;
  const resolvedNote = note || current.note;
  const event = buildCatalogConflictCurationEvent("resolve", actor, assignee, role, resolvedNote, updatedAt);
  return {
    ...current,
    status: "resolved",
    assignee,
    openedAt: current.openedAt ?? updatedAt,
    updatedAt,
    lastActor: actor,
    lastAction: "resolve",
    leaseExpiresAt: null,
    leaseDurationHours: null,
    leaseExpired: false,
    note: resolvedNote,
    events: mergeCatalogConflictCurationEvents([event], current.events),
  };
}

function expireCatalogConflictCurationThreadIfNeeded(
  thread: LocalCatalogLibraryConflictCurationThread,
  now = new Date(),
): LocalCatalogLibraryConflictCurationThread {
  if (thread.status !== "assigned" || !thread.leaseExpiresAt) {
    return thread;
  }
  const expiresAt = Date.parse(thread.leaseExpiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt > now.getTime()) {
    return thread;
  }
  const eventAt = new Date(Math.max(expiresAt, Date.parse(thread.updatedAt ?? "") || expiresAt)).toISOString();
  const event = buildCatalogConflictCurationEvent(
    "lease_expired",
    thread.lastActor || thread.assignee || "local-studio",
    "",
    "reviewer",
    "Lease de curadoria expirado; conflito liberado automaticamente.",
    eventAt,
  );
  return {
    ...thread,
    status: "unassigned",
    assignee: "",
    updatedAt: eventAt,
    lastActor: event.actor,
    lastAction: "lease_expired",
    leaseExpiresAt: null,
    leaseDurationHours: null,
    leaseExpired: true,
    note: event.note,
    events: mergeCatalogConflictCurationEvents([event], thread.events),
  };
}

function readCatalogConflictCurationLeaseHours(): number {
  return normalizeCatalogConflictCurationLeaseHours(process.env[LOCAL_CATALOG_CONFLICT_CURATION_LEASE_HOURS_ENV]);
}

function normalizeCatalogConflictCurationLeaseHours(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return LOCAL_CATALOG_CONFLICT_CURATION_LEASE_HOURS;
  }
  return Math.min(Math.max(numeric, 1 / 60), 24 * 30);
}

function addHoursIso(value: string, hours: number): string {
  const base = Date.parse(value);
  const timestamp = Number.isFinite(base) ? base : Date.now();
  return new Date(timestamp + hours * 60 * 60 * 1000).toISOString();
}

function resolveCatalogConflictResolution(payload: unknown): LocalCatalogLibraryConflictResolution {
  if (isRecord(payload)) {
    if (payload.resolution === "use_incoming" || payload.resolution === "restore_existing_snapshot") {
      return payload.resolution;
    }
  }
  return "keep_library";
}

function resolveCatalogConflictItem(
  currentItem: LocalCatalogItem | null,
  conflict: LocalCatalogLibraryConflict,
  resolution: LocalCatalogLibraryConflictResolution,
  resolvedAt: string,
): { item: LocalCatalogItem | null; plan: LocalCatalogLibraryConflictResolutionPlan } {
  const selectedSnapshot = selectedCatalogConflictSnapshot(conflict, resolution);
  const currentItemHash = currentItem ? catalogSharedLibraryItemFingerprint(currentItem) : "";
  const currentContentHash = currentItem?.contentHash ?? "";
  const selectedItemHash = selectedSnapshot?.snapshot.itemHash ?? currentItemHash;
  const selectedContentHash = selectedSnapshot?.snapshot.contentHash ?? currentContentHash;
  const selectedItemMatchesCurrent = Boolean(selectedSnapshot && selectedItemHash && selectedItemHash === currentItemHash);
  const selectedContentMatchesCurrent = Boolean(
    selectedSnapshot &&
    selectedContentHash &&
    currentContentHash &&
    selectedContentHash === currentContentHash,
  );
  const metadataFieldsChanged = currentItem && selectedSnapshot && selectedContentMatchesCurrent
    ? catalogConflictMetadataFieldsChanged(currentItem, selectedSnapshot.snapshot)
    : [];
  const requiresManualContentReview = Boolean(selectedSnapshot && !selectedItemMatchesCurrent && !selectedContentMatchesCurrent);
  const contentAction: LocalCatalogLibraryConflictContentAction = !selectedSnapshot
    ? "current_content_retained"
    : selectedItemMatchesCurrent || selectedContentMatchesCurrent
      ? "selected_content_already_current"
      : "manual_content_reapply_required";
  const metadataAction: LocalCatalogLibraryConflictMetadataAction = !selectedSnapshot
    ? "current_metadata_retained"
    : requiresManualContentReview
      ? "manual_content_review_first"
      : metadataFieldsChanged.length
        ? "selected_metadata_applied"
        : "selected_metadata_already_current";
  const item = currentItem && selectedSnapshot && selectedContentMatchesCurrent && metadataFieldsChanged.length
    ? applyCatalogConflictSnapshotMetadata(currentItem, selectedSnapshot.snapshot, resolvedAt)
    : currentItem;
  return {
    item,
    plan: {
      selectedSnapshot: selectedSnapshot?.selectedSnapshot ?? "current_library",
      requestedResolution: resolution,
      currentItemHash,
      selectedItemHash,
      currentContentHash,
      selectedContentHash,
      contentAction,
      metadataAction,
      metadataFieldsChanged,
      requiresManualContentReview,
      governance: {
        excludesRawCatalogContent: true,
        excludesSecretValues: true,
      },
    },
  };
}

function selectedCatalogConflictSnapshot(
  conflict: LocalCatalogLibraryConflict,
  resolution: LocalCatalogLibraryConflictResolution,
): { selectedSnapshot: LocalCatalogLibraryConflictSelectedSnapshot; snapshot: LocalCatalogLibraryConflictSnapshot } | null {
  if (resolution === "use_incoming") {
    return { selectedSnapshot: "incoming_snapshot", snapshot: conflict.incomingSnapshot };
  }
  if (resolution === "restore_existing_snapshot") {
    return { selectedSnapshot: "existing_snapshot", snapshot: conflict.existingSnapshot };
  }
  return null;
}

function catalogConflictMetadataFieldsChanged(
  item: LocalCatalogItem,
  snapshot: LocalCatalogLibraryConflictSnapshot,
): string[] {
  const checks: Array<[string, unknown, unknown]> = [
    ["name", item.name, snapshot.name],
    ["description", item.description, snapshot.description],
    ["tags", [...item.tags].sort((left, right) => left.localeCompare(right)), snapshot.tags],
    ["version", item.version, snapshot.version],
    ["revision", item.revision, snapshot.revision],
  ];
  return checks
    .filter(([, currentValue, snapshotValue]) => JSON.stringify(currentValue) !== JSON.stringify(snapshotValue))
    .map(([field]) => field);
}

function applyCatalogConflictSnapshotMetadata(
  item: LocalCatalogItem,
  snapshot: LocalCatalogLibraryConflictSnapshot,
  resolvedAt: string,
): LocalCatalogItem {
  return {
    ...item,
    name: snapshot.name,
    description: snapshot.description,
    tags: [...snapshot.tags],
    version: snapshot.version,
    revision: snapshot.revision,
    updatedAt: resolvedAt,
  };
}

function resolveCatalogConflictResolutionNote(payload: unknown): string {
  if (!isRecord(payload) || typeof payload.resolutionNote !== "string") {
    return "Mantida a versão atual da biblioteca compartilhada; snapshots compactos não incluem conteúdo bruto.";
  }
  const note = payload.resolutionNote.trim();
  return note.slice(0, 280) || "Mantida a versão atual da biblioteca compartilhada.";
}

function syncCatalogLibraryConflicts(
  conflicts: unknown[],
  items: LocalCatalogItem[],
): LocalCatalogLibraryConflict[] {
  const itemKeys = new Set(items.map((item) => catalogItemKey(item.kind, item.id)));
  const byId = new Map<string, LocalCatalogLibraryConflict>();
  for (const conflict of conflicts
    .map((value) => {
      try {
        return normalizeCatalogLibraryConflict(value);
      } catch {
        return null;
      }
    })
    .filter((entry): entry is LocalCatalogLibraryConflict => entry !== null)) {
    if (!itemKeys.has(conflict.itemKey)) {
      continue;
    }
    const existing = byId.get(conflict.id);
    if (!existing || comparableCatalogTimestamp(existing.createdAt) <= comparableCatalogTimestamp(conflict.createdAt)) {
      byId.set(conflict.id, conflict);
    }
  }
  return Array.from(byId.values()).sort(
    (left, right) => comparableCatalogTimestamp(right.createdAt) - comparableCatalogTimestamp(left.createdAt),
  );
}

function normalizeCatalogLibraryConflict(value: unknown): LocalCatalogLibraryConflict | null {
  if (!isRecord(value)) {
    return null;
  }
  const existingSnapshot = normalizeCatalogLibraryConflictSnapshot(value.existingSnapshot);
  const incomingSnapshot = normalizeCatalogLibraryConflictSnapshot(value.incomingSnapshot);
  if (!existingSnapshot || !incomingSnapshot) {
    return null;
  }
  const kind = parseCatalogKind(value.kind ?? incomingSnapshot.kind);
  const itemId = typeof value.itemId === "string" && value.itemId.trim() ? value.itemId.trim() : incomingSnapshot.id;
  const itemKey = typeof value.itemKey === "string" && value.itemKey.trim()
    ? value.itemKey.trim()
    : catalogItemKey(kind, itemId);
  const id = typeof value.id === "string" && value.id.trim()
    ? value.id.trim()
    : `catalog-conflict-${createHash("sha256")
        .update(JSON.stringify({ existingSnapshot, incomingSnapshot }))
        .digest("hex")
        .slice(0, 12)}`;
  const status: LocalCatalogLibraryConflictStatus = value.status === "resolved" ? "resolved" : "open";
  const resolvedAt = typeof value.resolvedAt === "string" && value.resolvedAt.trim() ? value.resolvedAt.trim() : null;
  const resolvedBy = typeof value.resolvedBy === "string" && value.resolvedBy.trim() ? value.resolvedBy.trim() : "";
  const resolvedRole = resolveCatalogConflictCuratorRole(value.resolvedRole ?? value.role);
  const normalizedThread = normalizeCatalogConflictCurationThread(value.curationThread);
  return {
    id,
    itemKey,
    itemId,
    kind,
    status,
    reason: typeof value.reason === "string" && value.reason.trim()
      ? value.reason.trim()
      : catalogConflictReason(existingSnapshot, incomingSnapshot),
    curationThread: status === "resolved" && normalizedThread.status !== "resolved"
      ? resolveCatalogConflictCurationThread(
          normalizedThread,
          resolvedBy || "local-studio",
          resolvedRole,
          "",
          resolvedAt ?? new Date().toISOString(),
        )
      : normalizedThread,
    existingSnapshot,
    incomingSnapshot,
    existingUpdatedAt: typeof value.existingUpdatedAt === "string" && value.existingUpdatedAt.trim()
      ? value.existingUpdatedAt.trim()
      : existingSnapshot.updatedAt,
    incomingUpdatedAt: typeof value.incomingUpdatedAt === "string" && value.incomingUpdatedAt.trim()
      ? value.incomingUpdatedAt.trim()
      : incomingSnapshot.updatedAt,
    createdAt: typeof value.createdAt === "string" && value.createdAt.trim()
      ? value.createdAt.trim()
      : new Date().toISOString(),
    resolvedAt,
    resolvedBy,
    resolvedRole,
    resolution: normalizeCatalogConflictResolution(value.resolution),
    resolutionNote: typeof value.resolutionNote === "string" && value.resolutionNote.trim()
      ? value.resolutionNote.trim().slice(0, 280)
      : "",
    resolutionPlan: normalizeCatalogConflictResolutionPlan(value.resolutionPlan),
  };
}

function normalizeCatalogConflictResolution(value: unknown): LocalCatalogLibraryConflictResolution | null {
  return value === "keep_library" || value === "use_incoming" || value === "restore_existing_snapshot" ? value : null;
}

function normalizeCatalogConflictResolutionPlan(value: unknown): LocalCatalogLibraryConflictResolutionPlan | null {
  if (!isRecord(value)) {
    return null;
  }
  const selectedSnapshot = normalizeCatalogConflictSelectedSnapshot(value.selectedSnapshot);
  const requestedResolution = normalizeCatalogConflictResolution(value.requestedResolution);
  const contentAction = normalizeCatalogConflictContentAction(value.contentAction);
  const metadataAction = normalizeCatalogConflictMetadataAction(value.metadataAction);
  if (!selectedSnapshot || !requestedResolution || !contentAction || !metadataAction) {
    return null;
  }
  return {
    selectedSnapshot,
    requestedResolution,
    currentItemHash: typeof value.currentItemHash === "string" && value.currentItemHash.trim() ? value.currentItemHash.trim() : "",
    selectedItemHash: typeof value.selectedItemHash === "string" && value.selectedItemHash.trim() ? value.selectedItemHash.trim() : "",
    currentContentHash: typeof value.currentContentHash === "string" && value.currentContentHash.trim()
      ? value.currentContentHash.trim()
      : "",
    selectedContentHash: typeof value.selectedContentHash === "string" && value.selectedContentHash.trim()
      ? value.selectedContentHash.trim()
      : "",
    contentAction,
    metadataAction,
    metadataFieldsChanged: Array.isArray(value.metadataFieldsChanged)
      ? Array.from(
          new Set(
            value.metadataFieldsChanged
              .filter((field): field is string => typeof field === "string")
              .map((field) => field.trim())
              .filter(Boolean),
          ),
        ).sort((left, right) => left.localeCompare(right))
      : [],
    requiresManualContentReview: value.requiresManualContentReview === true,
    governance: {
      excludesRawCatalogContent: true,
      excludesSecretValues: true,
    },
  };
}

function normalizeCatalogConflictSelectedSnapshot(value: unknown): LocalCatalogLibraryConflictSelectedSnapshot | null {
  return value === "current_library" || value === "incoming_snapshot" || value === "existing_snapshot" ? value : null;
}

function normalizeCatalogConflictContentAction(value: unknown): LocalCatalogLibraryConflictContentAction | null {
  return value === "current_content_retained" ||
      value === "selected_content_already_current" ||
      value === "manual_content_reapply_required"
    ? value
    : null;
}

function normalizeCatalogConflictMetadataAction(value: unknown): LocalCatalogLibraryConflictMetadataAction | null {
  return value === "current_metadata_retained" ||
      value === "selected_metadata_already_current" ||
      value === "selected_metadata_applied" ||
      value === "manual_content_review_first"
    ? value
    : null;
}

function normalizeCatalogLibraryConflictSnapshot(value: unknown): LocalCatalogLibraryConflictSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : "";
  if (!id) {
    return null;
  }
  return {
    id,
    kind: parseCatalogKind(value.kind),
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : id,
    description: typeof value.description === "string" ? value.description.trim() : "",
    tags: Array.isArray(value.tags)
      ? Array.from(new Set(value.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean)))
          .sort((left, right) => left.localeCompare(right))
      : [],
    version: readCatalogVersion(value.version),
    revision: value.revision === undefined ? 1 : readCatalogRevision(value.revision),
    contentHash: typeof value.contentHash === "string" && value.contentHash.trim() ? value.contentHash.trim() : "",
    itemHash: typeof value.itemHash === "string" && value.itemHash.trim() ? value.itemHash.trim() : "",
    updatedAt: typeof value.updatedAt === "string" && value.updatedAt.trim() ? value.updatedAt.trim() : new Date().toISOString(),
    historyCount: typeof value.historyCount === "number" && Number.isFinite(value.historyCount)
      ? Math.max(0, Math.floor(value.historyCount))
      : 0,
    hasContent: value.hasContent === true,
    hasNodePatch: value.hasNodePatch === true,
  };
}

function comparableCatalogTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDateString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function syncCatalogSharedLibraryItems(items: unknown[]): LocalCatalogItem[] {
  const builtInKeys = new Set(builtInCatalogItems().map((item) => catalogItemKey(item.kind, item.id)));
  const byKey = new Map<string, LocalCatalogItem>();
  for (const rawItem of items) {
    let item: LocalCatalogItem;
    try {
      item = parseStoredCatalogItem(rawItem);
    } catch {
      continue;
    }
    const key = catalogItemKey(item.kind, item.id);
    if (builtInKeys.has(key)) {
      continue;
    }
    const existing = byKey.get(key);
    if (!existing || Date.parse(existing.updatedAt) <= Date.parse(item.updatedAt)) {
      byKey.set(key, item);
    }
  }
  return sortCatalogItems(Array.from(byKey.values()));
}

function catalogSharedLibraryItemFingerprint(item: LocalCatalogItem): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: item.id,
        kind: item.kind,
        name: item.name,
        description: item.description,
        tags: [...item.tags].sort((left, right) => left.localeCompare(right)),
        version: item.version,
        revision: item.revision,
        contentHash: item.contentHash,
        content: item.content ?? null,
        nodePatch: item.nodePatch ?? null,
      }),
    )
    .digest("hex")
    .slice(0, 12);
}

function catalogSharedLibraryItemsFingerprint(items: LocalCatalogItem[]): string {
  return createHash("sha256")
    .update(JSON.stringify(sortCatalogItems(items).map((item) => catalogSharedLibraryItemFingerprint(item))))
    .digest("hex")
    .slice(0, 12);
}

function validateLocalCatalogCentralUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WorkspaceError(`URL da central do catálogo inválida: ${value}`, 422);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WorkspaceError(`URL da central do catálogo deve usar http ou https: ${value}`, 422);
  }
  if (url.username || url.password) {
    throw new WorkspaceError("URL da central do catálogo não pode conter usuário ou senha.", 422);
  }
  return url.toString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readStoredCatalogItems(workspaceRoot: string): Promise<LocalCatalogItem[]> {
  const catalogPath = safeResolve(workspaceRoot, LOCAL_CATALOG_PATH);
  let raw = "";
  try {
    raw = await readFile(catalogPath, "utf-8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new WorkspaceError("Catálogo local não é JSON válido.", 422, error);
  }
  if (!isRecord(parsed) || parsed.format !== LOCAL_CATALOG_FORMAT || !Array.isArray(parsed.items)) {
    throw new WorkspaceError("Catálogo local não respeita o formato esperado.", 422);
  }
  return parsed.items.map(parseStoredCatalogItem);
}

async function writeStoredCatalogItems(workspaceRoot: string, items: LocalCatalogItem[]): Promise<void> {
  const catalogPath = safeResolve(workspaceRoot, LOCAL_CATALOG_PATH);
  await mkdir(path.dirname(catalogPath), { recursive: true });
  await writeFile(
    catalogPath,
    `${JSON.stringify({ format: LOCAL_CATALOG_FORMAT, updatedAt: new Date().toISOString(), items }, null, 2)}\n`,
    "utf-8",
  );
}

function parseStoredCatalogItem(value: unknown): LocalCatalogItem {
  const input = parseLocalCatalogItemInput(value);
  if (!isRecord(value)) {
    throw new WorkspaceError("Item de catálogo deve ser objeto JSON.", 422);
  }
  return {
    ...input,
    scope: "local",
    source: "local",
    version: readCatalogVersion(value.version),
    revision: readCatalogRevision(value.revision),
    contentHash:
      typeof value.contentHash === "string" && value.contentHash.trim() ? value.contentHash.trim() : catalogItemContentHash(input),
    createdAt: readCatalogTimestamp(value.createdAt, "createdAt"),
    updatedAt: readCatalogTimestamp(value.updatedAt, "updatedAt"),
    history: readCatalogRevisionHistory(value.history),
  };
}

function localCatalogItemInputFromItem(item: LocalCatalogItem): LocalCatalogItemInput {
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    description: item.description,
    tags: [...item.tags],
    version: item.version,
    ...(typeof item.content === "string" ? { content: item.content } : {}),
    ...(item.nodePatch ? { nodePatch: { ...item.nodePatch } } : {}),
  };
}

function parseLocalCatalogItemPackage(value: unknown): LocalCatalogItemPackage {
  if (!isRecord(value)) {
    throw new WorkspaceError("Pacote de catálogo deve ser objeto JSON.", 422);
  }
  if (value.format !== LOCAL_CATALOG_ITEM_PACKAGE_FORMAT) {
    throw new WorkspaceError(`Formato de pacote de catálogo inválido: ${String(value.format)}`, 422);
  }
  const item = parseLocalCatalogItemInput(value.item);
  const exportedAt = typeof value.exportedAt === "string" && value.exportedAt.trim()
    ? value.exportedAt.trim()
    : new Date().toISOString();
  const source = isRecord(value.source)
    ? {
        kind: parseCatalogKind(value.source.kind ?? item.kind),
        id: typeof value.source.id === "string" && value.source.id.trim() ? value.source.id.trim() : item.id,
        name: typeof value.source.name === "string" && value.source.name.trim() ? value.source.name.trim() : item.name,
        contentHash: typeof value.source.contentHash === "string" && value.source.contentHash.trim()
          ? value.source.contentHash.trim()
          : catalogItemContentHash(item),
        revision: value.source.revision === undefined ? 1 : readCatalogRevision(value.source.revision),
      }
    : {
        kind: item.kind,
        id: item.id,
        name: item.name,
        contentHash: catalogItemContentHash(item),
        revision: 1,
      };
  return {
    format: LOCAL_CATALOG_ITEM_PACKAGE_FORMAT,
    exportedAt,
    source,
    item,
  };
}

function parseLocalCatalogItemInput(value: unknown): LocalCatalogItemInput {
  if (!isRecord(value)) {
    throw new WorkspaceError("Item de catálogo deve ser objeto JSON.", 400);
  }
  const kind = parseCatalogKind(value.kind);
  const id = parseAssetId(value.id, "id do item");
  const name = typeof value.name === "string" && value.name.trim() ? value.name.trim() : titleFromId(id);
  const description = typeof value.description === "string" ? value.description.trim() : "";
  const tags = value.tags === undefined ? [] : parseStringList(value.tags, "tags");
  const version = value.version === undefined ? undefined : readCatalogVersion(value.version);
  const item: LocalCatalogItemInput = {
    id,
    kind,
    name,
    description,
    tags,
  };
  if (version) {
    item.version = version;
  }
  if (kind === "prompt") {
    item.content = typeof value.content === "string" ? value.content : builtInCatalogItems()[0].content ?? "";
  } else if (kind === "schema") {
    const content = typeof value.content === "string" && value.content.trim() ? value.content : '{"type":"object","properties":{}}';
    try {
      item.content = `${JSON.stringify(JSON.parse(content), null, 2)}\n`;
    } catch (error) {
      throw new WorkspaceError("Conteúdo do item schema deve ser JSON válido.", 422, error);
    }
  } else if (kind === "tool") {
    const content = typeof value.content === "string" && value.content.trim() ? value.content : "";
    if (content) {
      item.content = normalizeToolBundleCatalogContent(content);
    }
    if (isRecord(value.nodePatch)) {
      item.nodePatch = sanitizeCatalogNodePatch(value.nodePatch);
    }
    if (!item.content && !item.nodePatch) {
      throw new WorkspaceError("Item tool precisa de nodePatch ou content JSON de tool bundle.", 422);
    }
  } else if (kind === "agent_template") {
    const content = typeof value.content === "string" && value.content.trim() ? value.content : "";
    if (!content) {
      throw new WorkspaceError("Item agent_template precisa de content JSON.", 422);
    }
    item.content = normalizeAgentTemplateCatalogContent(content);
  } else if (kind === "skill") {
    const content = typeof value.content === "string" && value.content.trim() ? value.content : "";
    if (!content) {
      throw new WorkspaceError("Item skill precisa de content JSON.", 422);
    }
    item.content = normalizeSkillCatalogContent(content);
  } else if (typeof value.content === "string") {
    item.content = value.content;
  }
  return item;
}

function parseApplyCatalogItemInput(value: unknown): ApplyCatalogItemInput {
  if (!isRecord(value)) {
    throw new WorkspaceError("Aplicação de catálogo deve ser objeto JSON.", 400);
  }
  const itemId = parseAssetId(value.itemId, "itemId");
  const kind = value.kind === undefined ? undefined : parseCatalogKind(value.kind);
  const targetNodeId = typeof value.targetNodeId === "string" && value.targetNodeId.trim() ? value.targetNodeId.trim() : undefined;
  const id = typeof value.id === "string" && value.id.trim() ? parseAssetId(value.id, "id") : undefined;
  return { itemId, kind, targetNodeId, id };
}

function parseRestoreCatalogRevisionInput(value: unknown): RestoreCatalogRevisionInput {
  if (!isRecord(value)) {
    throw new WorkspaceError("Restauração de revisão deve ser objeto JSON.", 400);
  }
  const itemId = parseAssetId(value.itemId, "itemId");
  const kind = value.kind === undefined ? undefined : parseCatalogKind(value.kind);
  const revision = readCatalogRevision(value.revision);
  return { itemId, kind, revision };
}

function parseCreateFlowFromCatalogTemplateInput(value: unknown): CreateFlowFromCatalogTemplateInput {
  if (!isRecord(value)) {
    throw new WorkspaceError("Criação por template deve ser um objeto JSON.", 400);
  }
  const base = parseCreateFlowInput(value);
  const itemId = parseAssetId(value.itemId, "itemId");
  return { ...base, itemId };
}

function parseCatalogKind(value: unknown): LocalCatalogItemKind {
  if (
    value === "prompt" ||
    value === "schema" ||
    value === "tool" ||
    value === "agent_template" ||
    value === "skill"
  ) {
    return value;
  }
  throw new WorkspaceError("kind do catálogo deve ser prompt, schema, tool, agent_template ou skill.", 422);
}

function readCatalogTimestamp(value: unknown, label: string): string {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return value;
  }
  throw new WorkspaceError(`Timestamp inválido no catálogo local: ${label}`, 422);
}

function readCatalogVersion(value: unknown): string {
  if (value === undefined) {
    return "1.0.0";
  }
  if (typeof value !== "string") {
    throw new WorkspaceError("version do catálogo deve ser texto.", 422);
  }
  const version = value.trim();
  if (!version || version.length > 64) {
    throw new WorkspaceError("version do catálogo deve ter entre 1 e 64 caracteres.", 422);
  }
  return version;
}

function readCatalogRevision(value: unknown): number {
  if (value === undefined) {
    return 1;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new WorkspaceError("revision do catálogo deve ser inteiro positivo.", 422);
  }
  return value;
}

function readCatalogRevisionHistory(value: unknown): LocalCatalogRevision[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new WorkspaceError("history do catálogo deve ser lista.", 422);
  }
  return value.map(parseCatalogRevision);
}

function parseCatalogRevision(value: unknown): LocalCatalogRevision {
  if (!isRecord(value)) {
    throw new WorkspaceError("Revisão do catálogo deve ser objeto JSON.", 422);
  }
  const revision = readCatalogRevision(value.revision);
  const version = readCatalogVersion(value.version);
  const name = typeof value.name === "string" && value.name.trim() ? value.name.trim() : `Revisão ${revision}`;
  const description = typeof value.description === "string" ? value.description.trim() : "";
  const tags = value.tags === undefined ? [] : parseStringList(value.tags, "tags da revisão");
  const content = typeof value.content === "string" ? value.content : undefined;
  const nodePatch = isRecord(value.nodePatch) ? sanitizeCatalogNodePatch(value.nodePatch) : undefined;
  const fallbackHash = catalogRevisionContentHash({ content, nodePatch });
  return {
    version,
    revision,
    contentHash: typeof value.contentHash === "string" && value.contentHash.trim() ? value.contentHash.trim() : fallbackHash,
    updatedAt: readCatalogTimestamp(value.updatedAt, "updatedAt da revisão"),
    name,
    description,
    tags,
    ...(content !== undefined ? { content } : {}),
    ...(nodePatch !== undefined ? { nodePatch } : {}),
  };
}

function findCatalogItem(
  items: LocalCatalogItem[],
  itemId: string,
  kind?: LocalCatalogItemKind,
): LocalCatalogItem | null {
  return items.find((item) => item.id === itemId && (!kind || item.kind === kind)) ?? null;
}

function normalizeAgentTemplateCatalogContent(content: string): string {
  const parsed = parseAgentTemplateCatalogContent({ id: "local-template", content } as LocalCatalogItem);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function parseAgentTemplateCatalogContent(item: LocalCatalogItem): AgentTemplateDefinition {
  if (!item.content) {
    throw new WorkspaceError(`Template de agente ${item.id} não possui content JSON.`, 422);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(item.content);
  } catch (error) {
    throw new WorkspaceError(`Template de agente ${item.id} não é JSON válido.`, 422, error);
  }
  if (!isRecord(parsed) || parsed.format !== AGENT_TEMPLATE_FORMAT) {
    throw new WorkspaceError(`Template de agente ${item.id} deve usar formato ${AGENT_TEMPLATE_FORMAT}.`, 422);
  }
  if (!isRecord(parsed.flow)) {
    throw new WorkspaceError(`Template de agente ${item.id} precisa conter flow.`, 422);
  }
  if (!Array.isArray(parsed.prompts)) {
    throw new WorkspaceError(`Template de agente ${item.id} precisa conter prompts.`, 422);
  }
  if (!Array.isArray(parsed.schemas)) {
    throw new WorkspaceError(`Template de agente ${item.id} precisa conter schemas.`, 422);
  }
  return {
    format: AGENT_TEMPLATE_FORMAT,
    flow: parsed.flow,
    prompts: parsed.prompts,
    schemas: parsed.schemas,
  };
}

function renderAgentTemplate(
  template: AgentTemplateDefinition,
  input: CreateFlowInput,
): { flow: AgentFlow; prompts: FlowAssetContent[]; schemas: FlowAssetContent[] } {
  const context = {
    flowId: input.id,
    flowName: input.name,
    resourceName: input.resourceName,
  };
  const renderedFlow = substituteTemplateValue(template.flow, context);
  if (!isRecord(renderedFlow)) {
    throw new WorkspaceError("Template de agente renderizado não gerou um flow válido.", 422);
  }
  const renderedApi = isRecord(renderedFlow.api) ? renderedFlow.api : {};
  const flow = parseAgentFlow({
    ...renderedFlow,
    id: input.id,
    name: input.name,
    api: {
      ...renderedApi,
      resourceName: input.resourceName,
    },
  });
  const prompts = parseAssetList(substituteTemplateValue(template.prompts, context), "prompts");
  const schemas = parseAssetList(substituteTemplateValue(template.schemas, context), "schemas");
  return { flow, prompts, schemas };
}

function substituteTemplateValue(value: unknown, context: { flowId: string; flowName: string; resourceName: string }): unknown {
  if (typeof value === "string") {
    return value
      .replaceAll("{{flowId}}", context.flowId)
      .replaceAll("{{flowName}}", context.flowName)
      .replaceAll("{{resourceName}}", context.resourceName);
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteTemplateValue(item, context));
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substituteTemplateValue(item, context)]));
  }
  return value;
}

function normalizeToolBundleCatalogContent(content: string): string {
  const parsed = parseToolBundleCatalogContent({ id: "local-tool-bundle", content } as LocalCatalogItem);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function parseToolBundleCatalogContent(item: LocalCatalogItem): ToolBundleCatalogDefinition {
  if (!item.content) {
    throw new WorkspaceError(`Tool ${item.id} não possui content JSON de bundle.`, 422);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(item.content);
  } catch (error) {
    throw new WorkspaceError(`Tool bundle ${item.id} não é JSON válido.`, 422, error);
  }
  if (!isRecord(parsed) || parsed.format !== TOOL_BUNDLE_FORMAT) {
    throw new WorkspaceError(`Tool bundle ${item.id} deve usar formato ${TOOL_BUNDLE_FORMAT}.`, 422);
  }
  const bundle = parseCatalogNodeBundleFields(item, "Tool bundle", parsed.nodes, parsed.edges, true);
  return {
    format: TOOL_BUNDLE_FORMAT,
    nodes: bundle.nodes,
    edges: bundle.edges,
  };
}

function parseCatalogNodeBundleFields(
  item: LocalCatalogItem,
  label: string,
  nodesValue: unknown,
  edgesValue: unknown,
  requireNodes: boolean,
): { nodes: AgentFlow["nodes"]; edges: AgentFlow["edges"] } {
  if (nodesValue === undefined && edgesValue === undefined && !requireNodes) {
    return { nodes: [], edges: [] };
  }
  if (!Array.isArray(nodesValue) || (requireNodes && !nodesValue.length)) {
    throw new WorkspaceError(`${label} ${item.id} precisa conter ao menos um nó.`, 422);
  }
  const usedNodeIds = new Set<string>();
  const nodes = nodesValue.map((rawNode, index) => {
    try {
      const node = NodeSchema.parse(rawNode);
      const id = parseAssetId(node.id, `id do nó ${index + 1} do bundle`);
      if (usedNodeIds.has(id)) {
        throw new WorkspaceError(`${label} ${item.id} contém nó duplicado: ${id}.`, 422);
      }
      usedNodeIds.add(id);
      return { ...node, id };
    } catch (error) {
      if (error instanceof WorkspaceError) {
        throw error;
      }
      throw new WorkspaceError(`Nó ${index + 1} de ${label.toLowerCase()} ${item.id} é inválido.`, 422, error);
    }
  });
  const rawEdges = edgesValue === undefined ? [] : edgesValue;
  if (!Array.isArray(rawEdges)) {
    throw new WorkspaceError(`${label} ${item.id} precisa conter edges como lista.`, 422);
  }
  const edges = rawEdges.map((rawEdge, index) => {
    try {
      const edge = EdgeSchema.parse(rawEdge);
      if (!usedNodeIds.has(edge.from) || !usedNodeIds.has(edge.to)) {
        throw new WorkspaceError(`Edge ${index + 1} de ${label.toLowerCase()} ${item.id} referencia nó fora do bundle.`, 422);
      }
      return edge;
    } catch (error) {
      if (error instanceof WorkspaceError) {
        throw error;
      }
      throw new WorkspaceError(`Edge ${index + 1} de ${label.toLowerCase()} ${item.id} é inválida.`, 422, error);
    }
  });
  return { nodes, edges };
}

function normalizeSkillCatalogContent(content: string): string {
  const parsed = parseSkillCatalogContent({ id: "local-skill", content } as LocalCatalogItem);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function parseSkillCatalogContent(item: LocalCatalogItem): SkillCatalogDefinition {
  if (!item.content) {
    throw new WorkspaceError(`Skill ${item.id} não possui content JSON.`, 422);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(item.content);
  } catch (error) {
    throw new WorkspaceError(`Skill ${item.id} não é JSON válida.`, 422, error);
  }
  if (!isRecord(parsed) || parsed.format !== SKILL_CATALOG_FORMAT) {
    throw new WorkspaceError(`Skill ${item.id} deve usar formato ${SKILL_CATALOG_FORMAT}.`, 422);
  }
  if (!Array.isArray(parsed.prompts)) {
    throw new WorkspaceError(`Skill ${item.id} precisa conter prompts.`, 422);
  }
  if (!Array.isArray(parsed.schemas)) {
    throw new WorkspaceError(`Skill ${item.id} precisa conter schemas.`, 422);
  }
  const bundle = parseCatalogNodeBundleFields(item, "Skill", parsed.nodes, parsed.edges, false);
  return {
    format: SKILL_CATALOG_FORMAT,
    prompts: parsed.prompts,
    schemas: parsed.schemas,
    targetNodePatch: isRecord(parsed.targetNodePatch) ? sanitizeCatalogNodePatch(parsed.targetNodePatch) : undefined,
    ...(bundle.nodes.length ? { nodes: bundle.nodes, edges: bundle.edges } : {}),
  };
}

async function applyPromptCatalogItem(
  workspaceRoot: string,
  flowId: string,
  item: LocalCatalogItem,
  input: ApplyCatalogItemInput,
): Promise<ApplyCatalogItemResult> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const id = uniqueCatalogRefId(input.id ?? item.id, loaded.flow.prompts.map((prompt) => prompt.id));
  const assetPath = uniqueCatalogAssetPath(loaded.flow, "prompts", `${id}.md`);
  const content = item.content ?? "";
  const nextNodes = input.targetNodeId
    ? patchNodeById(loaded.flow.nodes, input.targetNodeId, { promptId: id })
    : loaded.flow.nodes;
  const promptRef = {
    id,
    path: assetPath,
    version: "v1",
    description: item.description || undefined,
    tags: uniqueCatalogTags(["catalog", ...item.tags]),
    variables: extractPromptVariables(content),
  };
  const flow = parseAgentFlow({
    ...loaded.flow,
    prompts: [...loaded.flow.prompts, promptRef],
    nodes: nextNodes,
  });
  await mkdir(path.dirname(safeResolveFlowAsset(loaded.flowRoot, assetPath)), { recursive: true });
  await writeFile(safeResolveFlowAsset(loaded.flowRoot, assetPath), content, "utf-8");
  await writeFlowFile(loaded, flow);
  return {
    status: "ok",
    item,
    flow,
    flowPath: loaded.relativePath,
    prompt: { id, path: assetPath, content },
  };
}

async function applySchemaCatalogItem(
  workspaceRoot: string,
  flowId: string,
  item: LocalCatalogItem,
  input: ApplyCatalogItemInput,
): Promise<ApplyCatalogItemResult> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const id = uniqueCatalogRefId(input.id ?? item.id, loaded.flow.schemas.map((schema) => schema.id));
  const assetPath = uniqueCatalogAssetPath(loaded.flow, "schemas", `${id}.schema.json`);
  let content = item.content ?? '{"type":"object","properties":{}}';
  try {
    content = `${JSON.stringify(JSON.parse(content), null, 2)}\n`;
  } catch (error) {
    throw new WorkspaceError(`Schema do item de catálogo ${item.id} não é JSON válido.`, 422, error);
  }
  const nextNodes = input.targetNodeId
    ? patchNodeById(loaded.flow.nodes, input.targetNodeId, { outputSchema: id })
    : loaded.flow.nodes;
  const schemaRef = {
    id,
    path: assetPath,
    version: "v1",
    description: item.description || undefined,
    tags: uniqueCatalogTags(["catalog", ...item.tags]),
  };
  const flow = parseAgentFlow({
    ...loaded.flow,
    schemas: [...loaded.flow.schemas, schemaRef],
    nodes: nextNodes,
  });
  await mkdir(path.dirname(safeResolveFlowAsset(loaded.flowRoot, assetPath)), { recursive: true });
  await writeFile(safeResolveFlowAsset(loaded.flowRoot, assetPath), content, "utf-8");
  await writeFlowFile(loaded, flow);
  return {
    status: "ok",
    item,
    flow,
    flowPath: loaded.relativePath,
    schema: { id, path: assetPath, content },
  };
}

async function applyToolCatalogItem(
  workspaceRoot: string,
  flowId: string,
  item: LocalCatalogItem,
  input: ApplyCatalogItemInput,
): Promise<ApplyCatalogItemResult> {
  if (item.content) {
    return applyToolBundleCatalogItem(workspaceRoot, flowId, item, input);
  }
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const patch = sanitizeCatalogNodePatch(item.nodePatch ?? {});
  let appliedNode: AgentFlow["nodes"][number] | null = null;
  const nodes = input.targetNodeId
    ? loaded.flow.nodes.map((node) => {
        if (node.id !== input.targetNodeId) {
          return node;
        }
        appliedNode = {
          ...node,
          ...patch,
          id: node.id,
          position: node.position,
          description: stringFromPatch(patch.description) || node.description || item.description || item.name,
        };
        return appliedNode;
      })
    : [
        ...loaded.flow.nodes,
        {
          type: "code",
          description: item.description || item.name,
          ...patch,
          id: uniqueCatalogRefId(input.id ?? item.id, loaded.flow.nodes.map((node) => node.id)),
          position: nextCatalogNodePosition(loaded.flow.nodes),
        },
      ];
  if (input.targetNodeId && !appliedNode) {
    throw new WorkspaceError(`Nó alvo não encontrado para aplicar tool: ${input.targetNodeId}`, 404);
  }
  const flow = parseAgentFlow({
    ...loaded.flow,
    nodes,
  });
  const node = appliedNode ?? flow.nodes.at(-1);
  await writeFlowFile(loaded, flow);
  return {
    status: "ok",
    item,
    flow,
    flowPath: loaded.relativePath,
    node,
  };
}

async function applyToolBundleCatalogItem(
  workspaceRoot: string,
  flowId: string,
  item: LocalCatalogItem,
  input: ApplyCatalogItemInput,
): Promise<ApplyCatalogItemResult> {
  const bundle = parseToolBundleCatalogContent(item);
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const applied = appendCatalogNodeBundleToFlow(loaded.flow, item, input, bundle);
  const flow = applied.flow;
  await writeFlowFile(loaded, flow);
  return {
    status: "ok",
    item,
    flow,
    flowPath: loaded.relativePath,
    node: applied.node,
  };
}

function appendCatalogNodeBundleToFlow(
  flow: AgentFlow,
  item: LocalCatalogItem,
  input: ApplyCatalogItemInput,
  bundle: { nodes: AgentFlow["nodes"]; edges: AgentFlow["edges"] },
  assetIds?: {
    promptIds?: Map<string, string>;
    schemaIds?: Map<string, string>;
  },
): { flow: AgentFlow; node?: AgentFlow["nodes"][number] } {
  if (!bundle.nodes.length) {
    return { flow };
  }
  const targetNode = input.targetNodeId ? flow.nodes.find((node) => node.id === input.targetNodeId) : undefined;
  if (input.targetNodeId && !targetNode) {
    throw new WorkspaceError(`Nó alvo não encontrado para aplicar bundle: ${input.targetNodeId}`, 404);
  }

  const usedNodeIds = new Set(flow.nodes.map((node) => node.id));
  const idMap = new Map<string, string>();
  for (const node of bundle.nodes) {
    const preferredId = input.id && bundle.nodes.length === 1 ? input.id : `${input.id ?? item.id}-${node.id}`;
    const id = uniqueCatalogRefId(preferredId, Array.from(usedNodeIds));
    usedNodeIds.add(id);
    idMap.set(node.id, id);
  }

  const basePosition = targetNode
    ? { x: (targetNode.position?.x ?? 0) + 260, y: targetNode.position?.y ?? 120 }
    : nextCatalogNodePosition(flow.nodes);
  const bundlePositions = bundle.nodes.map((node, index) => node.position ?? { x: index * 260, y: 0 });
  const minX = Math.min(...bundlePositions.map((position) => position.x));
  const minY = Math.min(...bundlePositions.map((position) => position.y));
  const nodes = bundle.nodes.map((node, index) => {
    const localPosition = bundlePositions[index];
    const promptId = node.promptId ? assetIds?.promptIds?.get(node.promptId) ?? node.promptId : undefined;
    const outputSchema = node.outputSchema ? assetIds?.schemaIds?.get(node.outputSchema) ?? node.outputSchema : undefined;
    return {
      ...node,
      ...(promptId ? { promptId } : {}),
      ...(outputSchema ? { outputSchema } : {}),
      id: idMap.get(node.id) ?? node.id,
      description: node.description || item.description || item.name,
      position: {
        x: basePosition.x + localPosition.x - minX,
        y: basePosition.y + localPosition.y - minY,
      },
    };
  });
  const bundleEdges = bundle.edges.map((edge) => ({
    ...edge,
    from: idMap.get(edge.from) ?? edge.from,
    to: idMap.get(edge.to) ?? edge.to,
  }));
  const entryEdges = [
    {
      from: input.targetNodeId ?? "start",
      to: nodes[0].id,
    },
  ];
  const bundleEdgeSources = new Set(bundleEdges.map((edge) => edge.from));
  const terminalEdges = nodes
    .filter((node) => !bundleEdgeSources.has(node.id))
    .map((node) => ({
      from: node.id,
      to: "end",
    }));
  const nextFlow = parseAgentFlow({
    ...flow,
    nodes: [...flow.nodes, ...nodes],
    edges: [...flow.edges, ...entryEdges, ...bundleEdges, ...terminalEdges],
  });
  return {
    flow: nextFlow,
    node: nextFlow.nodes.find((candidate) => candidate.id === nodes[0]?.id),
  };
}

async function applySkillCatalogItem(
  workspaceRoot: string,
  flowId: string,
  item: LocalCatalogItem,
  input: ApplyCatalogItemInput,
): Promise<ApplyCatalogItemResult> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const skill = parseSkillCatalogContent(item);
  const rawPrompts = parseAssetList(skill.prompts, "prompts");
  const rawSchemas = parseAssetList(skill.schemas, "schemas");
  const createdPrompts: FlowAssetContent[] = [];
  const createdSchemas: FlowAssetContent[] = [];
  const promptIdMap = new Map<string, string>();
  const schemaIdMap = new Map<string, string>();
  let nextFlow = loaded.flow;

  for (const promptAsset of rawPrompts) {
    const id = uniqueCatalogRefId(promptAsset.id, nextFlow.prompts.map((prompt) => prompt.id));
    promptIdMap.set(promptAsset.id, id);
    const assetPath = uniqueCatalogAssetPath(nextFlow, "prompts", `${id}.md`);
    const promptRef = {
      id,
      path: assetPath,
      version: "v1",
      description: item.description || undefined,
      tags: uniqueCatalogTags(["catalog", "skill", ...item.tags]),
      variables: extractPromptVariables(promptAsset.content),
    };
    nextFlow = parseAgentFlow({
      ...nextFlow,
      prompts: [...nextFlow.prompts, promptRef],
    });
    createdPrompts.push({ id, path: assetPath, content: promptAsset.content });
  }

  for (const schemaAsset of rawSchemas) {
    const id = uniqueCatalogRefId(schemaAsset.id, nextFlow.schemas.map((schema) => schema.id));
    schemaIdMap.set(schemaAsset.id, id);
    const assetPath = uniqueCatalogAssetPath(nextFlow, "schemas", `${id}.schema.json`);
    let content = schemaAsset.content;
    try {
      content = `${JSON.stringify(JSON.parse(content), null, 2)}\n`;
    } catch (error) {
      throw new WorkspaceError(`Schema da skill ${item.id} não é JSON válido: ${schemaAsset.id}.`, 422, error);
    }
    const schemaRef = {
      id,
      path: assetPath,
      version: "v1",
      description: item.description || undefined,
      tags: uniqueCatalogTags(["catalog", "skill", ...item.tags]),
    };
    nextFlow = parseAgentFlow({
      ...nextFlow,
      schemas: [...nextFlow.schemas, schemaRef],
    });
    createdSchemas.push({ id, path: assetPath, content });
  }

  let node: AgentFlow["nodes"][number] | undefined;
  if (input.targetNodeId) {
    const firstPromptId = createdPrompts[0]?.id;
    const firstSchemaId = createdSchemas[0]?.id;
    const patch: Partial<AgentFlow["nodes"][number]> = {
      ...(skill.targetNodePatch ?? {}),
      ...(firstPromptId ? { promptId: firstPromptId } : {}),
      ...(firstSchemaId ? { outputSchema: firstSchemaId } : {}),
    };
    const nodes = patchNodeById(nextFlow.nodes, input.targetNodeId, patch);
    nextFlow = parseAgentFlow({
      ...nextFlow,
      nodes,
    });
    node = nextFlow.nodes.find((candidate) => candidate.id === input.targetNodeId);
  }

  if (skill.nodes?.length) {
    const appliedBundle = appendCatalogNodeBundleToFlow(
      nextFlow,
      item,
      input,
      { nodes: skill.nodes, edges: skill.edges ?? [] },
      { promptIds: promptIdMap, schemaIds: schemaIdMap },
    );
    nextFlow = appliedBundle.flow;
    node = appliedBundle.node ?? node;
  }

  for (const promptAsset of createdPrompts) {
    await mkdir(path.dirname(safeResolveFlowAsset(loaded.flowRoot, promptAsset.path)), { recursive: true });
    await writeFile(safeResolveFlowAsset(loaded.flowRoot, promptAsset.path), promptAsset.content, "utf-8");
  }
  for (const schemaAsset of createdSchemas) {
    await mkdir(path.dirname(safeResolveFlowAsset(loaded.flowRoot, schemaAsset.path)), { recursive: true });
    await writeFile(safeResolveFlowAsset(loaded.flowRoot, schemaAsset.path), schemaAsset.content, "utf-8");
  }
  await writeFlowFile(loaded, nextFlow);
  return {
    status: "ok",
    item,
    flow: nextFlow,
    flowPath: loaded.relativePath,
    prompt: createdPrompts[0],
    schema: createdSchemas[0],
    node,
  };
}

function sanitizeCatalogNodePatch(value: Record<string, unknown>): Record<string, unknown> {
  const patch = { ...value };
  delete patch.id;
  delete patch.position;
  return patch;
}

function stringFromPatch(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function patchNodeById(
  nodes: AgentFlow["nodes"],
  targetNodeId: string,
  patch: Partial<AgentFlow["nodes"][number]>,
): AgentFlow["nodes"] {
  let found = false;
  const nextNodes = nodes.map((node) => {
    if (node.id !== targetNodeId) {
      return node;
    }
    found = true;
    return { ...node, ...patch, id: node.id, position: node.position };
  });
  if (!found) {
    throw new WorkspaceError(`Nó alvo não encontrado: ${targetNodeId}`, 404);
  }
  return nextNodes;
}

function uniqueCatalogRefId(preferred: string, existing: string[]): string {
  const base = slugAssetId(preferred);
  const used = new Set(existing);
  if (!used.has(base)) {
    return base;
  }
  let index = 2;
  while (used.has(`${base}-${index}`)) {
    index += 1;
  }
  return `${base}-${index}`;
}

function uniqueCatalogAssetPath(flow: AgentFlow, prefix: "prompts" | "schemas", fileName: string): string {
  const normalizedFile = sanitizeFileName(fileName);
  const extension = path.extname(normalizedFile);
  const basename = extension ? normalizedFile.slice(0, -extension.length) : normalizedFile;
  const used = new Set([...flow.prompts, ...flow.schemas].map((asset) => normalizeAssetPath(asset.path)));
  let candidate = normalizeAssetPath(`${prefix}/${normalizedFile}`);
  let index = 2;
  while (used.has(candidate)) {
    candidate = normalizeAssetPath(`${prefix}/${basename}-${index}${extension}`);
    index += 1;
  }
  return candidate;
}

function nextCatalogNodePosition(nodes: AgentFlow["nodes"]): { x: number; y: number } {
  const maxX = Math.max(0, ...nodes.map((node) => node.position?.x ?? 0));
  const averageY = nodes.length
    ? Math.round(nodes.reduce((total, node) => total + (node.position?.y ?? 0), 0) / nodes.length)
    : 120;
  return { x: maxX + 260, y: averageY };
}

function slugAssetId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "catalog-item";
}

function uniqueCatalogTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function extractPromptVariables(content: string): string[] {
  const variables = new Set<string>();
  const pattern = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    variables.add(match[1]);
  }
  return Array.from(variables).sort((left, right) => left.localeCompare(right));
}

function sortCatalogItems(items: LocalCatalogItem[]): LocalCatalogItem[] {
  return [...items].sort((left, right) => {
    const kindCompare = left.kind.localeCompare(right.kind);
    return kindCompare || left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  });
}

function catalogItemKey(kind: LocalCatalogItemKind, id: string): string {
  return `${kind}:${id}`;
}

function uniqueCatalogImportItemId(preferred: string, kind: LocalCatalogItemKind, existing: LocalCatalogItem[]): string {
  const base = slugAssetId(`${preferred}-imported`);
  const used = new Set(existing.filter((item) => item.kind === kind).map((item) => item.id));
  if (!used.has(base)) {
    return base;
  }
  let index = 2;
  while (used.has(`${base}-${index}`)) {
    index += 1;
  }
  return `${base}-${index}`;
}

function catalogItemContentHash(item: LocalCatalogItemInput): string {
  return catalogRevisionContentHash({ content: item.content, nodePatch: item.nodePatch, kind: item.kind });
}

function catalogRevisionContentHash(value: { content?: string; nodePatch?: Record<string, unknown>; kind?: LocalCatalogItemKind }): string {
  const payload = {
    kind: value.kind ?? null,
    content: value.content ?? null,
    nodePatch: value.nodePatch ?? null,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 12);
}

function catalogRevisionFromItem(item: LocalCatalogItem): LocalCatalogRevision {
  return {
    version: item.version,
    revision: item.revision,
    contentHash: item.contentHash,
    updatedAt: item.updatedAt,
    name: item.name,
    description: item.description,
    tags: item.tags,
    ...(item.content !== undefined ? { content: item.content } : {}),
    ...(item.nodePatch !== undefined ? { nodePatch: item.nodePatch } : {}),
  };
}

interface PromptAssetInput {
  id: string;
  path: string;
  version: string;
  description?: string;
  tags: string[];
  variables: string[];
  content: string;
}

interface SchemaAssetInput {
  id: string;
  path: string;
  version: string;
  description?: string;
  tags: string[];
  parsed: unknown;
}

function parsePromptAssetInput(value: unknown): PromptAssetInput {
  if (!isRecord(value)) {
    throw new WorkspaceError("Prompt deve ser um objeto JSON.", 400);
  }
  const id = parseAssetId(value.id, "id do prompt");
  const promptPath = typeof value.path === "string" && value.path.trim() ? value.path.trim() : `prompts/${id}.md`;
  const version = typeof value.version === "string" && value.version.trim() ? value.version.trim() : "v1";
  const description = parseOptionalAssetText(value.description);
  const tags = value.tags === undefined ? [] : parseStringList(value.tags, "tags");
  const variables = value.variables === undefined ? [] : parseStringList(value.variables, "variables");
  const content =
    typeof value.content === "string"
      ? value.content
      : `# ${id}\n\nDefina o prompt deste nó em português brasileiro.\n`;
  return {
    id,
    path: normalizeAssetPath(promptPath),
    version,
    description,
    tags,
    variables,
    content,
  };
}

function parseSchemaAssetInput(value: unknown): SchemaAssetInput {
  if (!isRecord(value)) {
    throw new WorkspaceError("Schema deve ser um objeto JSON.", 400);
  }
  const id = parseAssetId(value.id, "id do schema");
  const schemaPath = typeof value.path === "string" && value.path.trim() ? value.path.trim() : `schemas/${id}.schema.json`;
  const version = typeof value.version === "string" && value.version.trim() ? value.version.trim() : "v1";
  const description = parseOptionalAssetText(value.description);
  const tags = value.tags === undefined ? [] : parseStringList(value.tags, "tags");
  const content = typeof value.content === "string" && value.content.trim()
    ? value.content
    : '{"type":"object","properties":{}}';
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new WorkspaceError("Schema deve ser JSON válido.", 422, error);
  }
  return {
    id,
    path: normalizeAssetPath(schemaPath),
    version,
    description,
    tags,
    parsed,
  };
}

function parseOptionalAssetText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseAssetId(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkspaceError(`${label} é obrigatório.`, 400);
  }
  const id = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) {
    throw new WorkspaceError(`${label} deve usar letras, números, _ ou -.`, 422);
  }
  return id;
}

function parseStringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new WorkspaceError(`${label} deve ser uma lista de strings.`, 400);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new WorkspaceError(`${label}[${index}] deve ser uma string não vazia.`, 400);
    }
    return item.trim();
  });
}

function normalizeAssetPath(assetPath: string): string {
  const normalized = assetPath.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (!normalized || normalized.includes("\0") || normalized.split("/").includes("..") || path.isAbsolute(normalized)) {
    throw new WorkspaceError(`Path de asset inválido: ${assetPath}`, 400);
  }
  if (normalized === "agent.flow.json") {
    throw new WorkspaceError("Asset não pode sobrescrever agent.flow.json.", 422);
  }
  return normalized;
}

function assertAssetPathPrefix(assetPath: string, prefix: "prompts" | "schemas"): void {
  if (assetPath !== prefix && !assetPath.startsWith(`${prefix}/`)) {
    throw new WorkspaceError(`Path de asset deve ficar em ${prefix}/.`, 422);
  }
}

function assertUniqueAssetPath(flow: AgentFlow, assetPath: string): void {
  const existing = [...flow.prompts, ...flow.schemas].find((asset) => normalizeAssetPath(asset.path) === assetPath);
  if (existing) {
    throw new WorkspaceError(`Já existe asset usando o path ${assetPath}.`, 409);
  }
}

async function removeAssetFileIfUnreferenced(flowRoot: string, flow: AgentFlow, assetPath: string): Promise<void> {
  const normalized = normalizeAssetPath(assetPath);
  const stillReferenced = [...flow.prompts, ...flow.schemas].some((asset) => normalizeAssetPath(asset.path) === normalized);
  if (!stillReferenced) {
    await rm(safeResolveFlowAsset(flowRoot, normalized), { force: true });
  }
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

interface CreateFlowInput {
  id: string;
  name: string;
  resourceName: string;
}

function parseCreateFlowInput(value: unknown): CreateFlowInput {
  if (!isRecord(value)) {
    throw new WorkspaceError("Novo flow deve ser um objeto JSON.", 400);
  }
  const id = parseAssetId(value.id, "id do flow");
  assertImportableFlowId(id);
  const name = typeof value.name === "string" && value.name.trim() ? value.name.trim() : titleFromId(id);
  const resourceName =
    typeof value.resourceName === "string" && value.resourceName.trim() ? value.resourceName.trim() : "sessions";
  if (!/^[A-Za-z0-9_-]+$/.test(resourceName)) {
    throw new WorkspaceError("resourceName deve usar letras, números, _ ou -.", 422);
  }
  return { id, name, resourceName };
}

function titleFromId(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function agentTemplateContent(flow: AgentFlow, prompts: FlowAssetContent[], schemas: FlowAssetContent[]): string {
  return `${JSON.stringify({ format: AGENT_TEMPLATE_FORMAT, flow, prompts, schemas }, null, 2)}\n`;
}

function skillCatalogContent(
  prompts: FlowAssetContent[],
  schemas: FlowAssetContent[],
  targetNodePatch?: Record<string, unknown>,
  nodes?: AgentFlow["nodes"],
  edges?: AgentFlow["edges"],
): string {
  return `${JSON.stringify({ format: SKILL_CATALOG_FORMAT, prompts, schemas, targetNodePatch, nodes, edges }, null, 2)}\n`;
}

function toolBundleCatalogContent(nodes: AgentFlow["nodes"], edges: AgentFlow["edges"]): string {
  return `${JSON.stringify({ format: TOOL_BUNDLE_FORMAT, nodes, edges }, null, 2)}\n`;
}

function starterFlow(input: CreateFlowInput): AgentFlow {
  return {
    id: input.id,
    name: input.name,
    version: "0.1.0",
    runtime: "langgraph-python",
    api: {
      contract: "sessions-v1",
      resourceName: input.resourceName,
      autoStartOnCreate: false,
    },
    persistence: {
      checkpointer: "postgres",
      publicStore: "postgres",
      cache: "redis",
    },
    llm: {
      adapter: "openai",
      model: "gpt-4.1-mini",
      apiKeyEnv: "OPENAI_API_KEY",
      baseUrlEnv: "OPENAI_BASE_URL",
      mockEnv: "MOCK_LLM",
    },
    state: {
      schemaRef: "session_state",
    },
    prompts: [
      {
        id: "system",
        path: "prompts/system.md",
        version: "v1",
        variables: ["session_id", "turn", "max_turns", "user_message", "recent_messages"],
      },
    ],
    schemas: [
      {
        id: "session_state",
        path: "schemas/session_state.schema.json",
      },
    ],
    nodes: [
      {
        id: "start_node",
        type: "start",
        description: "Emite a primeira mensagem do agente.",
        position: { x: 230, y: 300 },
      },
      {
        id: "input_safety_check",
        type: "safety_gate",
        stage: "input",
        position: { x: 460, y: 140 },
      },
      {
        id: "turn_router",
        type: "switch",
        description: "Roteia o turno conforme status e limite.",
        position: { x: 690, y: 300 },
      },
      {
        id: "llm_step",
        type: "llm_prompt",
        promptId: "system",
        llm: {
          adapter: "openai",
          model: "gpt-4.1-mini",
        },
        position: { x: 920, y: 140 },
      },
      {
        id: "output_safety_check",
        type: "safety_gate",
        stage: "output",
        position: { x: 1150, y: 300 },
      },
      {
        id: "wait_user_input",
        type: "human_input",
        description: "Pausa lógica para o próximo turno do consumidor.",
        position: { x: 1380, y: 140 },
      },
      {
        id: "deterministic_gate",
        type: "code",
        handler: "deterministic_gate",
        position: { x: 1610, y: 300 },
      },
      {
        id: "finish_node",
        type: "end",
        description: "Finaliza a sessão manualmente ou por limite.",
        position: { x: 1840, y: 140 },
      },
    ],
    edges: [
      { from: "start", to: "start_node", condition: "action == 'start'" },
      { from: "start", to: "input_safety_check", condition: "action == 'turn'" },
      { from: "start", to: "finish_node", condition: "action == 'finish'" },
      { from: "start_node", to: "end" },
      { from: "input_safety_check", to: "turn_router", condition: "safety.decision == 'allow'" },
      { from: "input_safety_check", to: "end", condition: "safety.blocked == true" },
      { from: "turn_router", to: "llm_step", condition: "status == 'active' and turn < max_turns" },
      { from: "turn_router", to: "finish_node", condition: "turn >= max_turns" },
      { from: "llm_step", to: "output_safety_check" },
      { from: "output_safety_check", to: "wait_user_input" },
      { from: "wait_user_input", to: "deterministic_gate" },
      { from: "deterministic_gate", to: "end" },
      { from: "finish_node", to: "end" },
    ],
  };
}

function contentQuestionGeneratorFlow(input: CreateFlowInput): AgentFlow {
  return {
    id: input.id,
    name: input.name,
    version: "0.1.0",
    runtime: "langgraph-python",
    api: {
      contract: "sessions-v1",
      resourceName: input.resourceName,
      autoStartOnCreate: false,
    },
    persistence: {
      checkpointer: "postgres",
      publicStore: "postgres",
      cache: "redis",
    },
    llm: {
      adapter: "openai",
      model: "gpt-4.1-mini",
      apiKeyEnv: "OPENAI_API_KEY",
      baseUrlEnv: "OPENAI_BASE_URL",
      mockEnv: "MOCK_LLM",
    },
    state: {
      schemaRef: "session_state",
    },
    prompts: [
      {
        id: "system",
        path: "prompts/system.md",
        version: "v1",
        description: "Prompt para consultar contexto e gerar perguntas.",
        tags: ["questions", "rag", "content"],
        variables: ["session_id", "turn", "user_message", "rag_context", "extracted_content"],
      },
    ],
    schemas: [
      {
        id: "session_state",
        path: "schemas/session_state.schema.json",
      },
      {
        id: "question_list",
        path: "schemas/question_list.schema.json",
        version: "v1",
        description: "Lista estruturada de perguntas geradas a partir de conteúdo.",
        tags: ["questions", "structured-output"],
      },
    ],
    nodes: [
      {
        id: "start_node",
        type: "start",
        description: "Emite a primeira mensagem do agente.",
        position: { x: 230, y: 300 },
      },
      {
        id: "input_safety_check",
        type: "safety_gate",
        stage: "input",
        position: { x: 460, y: 140 },
      },
      {
        id: "extract_content",
        type: "file_extract",
        description: "Extrai texto de um arquivo local opcional em files/.",
        sourcePath: "knowledge.md",
        contentPath: "extracted_content",
        maxChars: 200000,
        position: { x: 690, y: 300 },
      },
      {
        id: "retrieve_context",
        type: "rag_retrieval",
        description: "Consulta conteúdo local para apoiar a geração de perguntas.",
        collectionPath: ".",
        queryPath: "user_message",
        contextPath: "rag_context",
        topK: 5,
        chunkSize: 800,
        position: { x: 920, y: 140 },
      },
      {
        id: "generate_questions",
        type: "llm_structured",
        description: "Gera perguntas estruturadas a partir do conteúdo consultado.",
        promptId: "system",
        outputSchema: "question_list",
        llm: {
          adapter: "openai",
          model: "gpt-4.1-mini",
        },
        position: { x: 1150, y: 300 },
      },
      {
        id: "output_safety_check",
        type: "safety_gate",
        stage: "output",
        position: { x: 1380, y: 140 },
      },
      {
        id: "wait_user_input",
        type: "human_input",
        description: "Pausa lógica para o próximo turno do consumidor.",
        position: { x: 1610, y: 300 },
      },
      {
        id: "finish_node",
        type: "end",
        description: "Finaliza a sessão manualmente.",
        position: { x: 1840, y: 140 },
      },
    ],
    edges: [
      { from: "start", to: "start_node", condition: "action == 'start'" },
      { from: "start", to: "input_safety_check", condition: "action == 'turn'" },
      { from: "start", to: "finish_node", condition: "action == 'finish'" },
      { from: "start_node", to: "end" },
      { from: "input_safety_check", to: "extract_content", condition: "safety.decision == 'allow'" },
      { from: "input_safety_check", to: "end", condition: "safety.blocked == true" },
      { from: "extract_content", to: "retrieve_context" },
      { from: "retrieve_context", to: "generate_questions" },
      { from: "generate_questions", to: "output_safety_check" },
      { from: "output_safety_check", to: "wait_user_input" },
      { from: "wait_user_input", to: "end" },
      { from: "finish_node", to: "end" },
    ],
  };
}

function proUpParityComplexFlow(input: CreateFlowInput): AgentFlow {
  return {
    id: input.id,
    name: input.name,
    version: "0.1.0",
    runtime: "langgraph-python",
    api: {
      contract: "sessions-v1",
      resourceName: input.resourceName,
      autoStartOnCreate: false,
    },
    persistence: {
      checkpointer: "postgres",
      publicStore: "postgres",
      cache: "redis",
    },
    llm: {
      adapter: "openai",
      model: "gpt-4.1-mini",
      apiKeyEnv: "OPENAI_API_KEY",
      baseUrlEnv: "OPENAI_BASE_URL",
      mockEnv: "MOCK_LLM",
    },
    state: {
      schemaRef: "session_state",
    },
    prompts: [
      {
        id: "system",
        path: "prompts/system.md",
        version: "v1",
        description: "Prompt de entrevista complexa com consulta de conteúdo, perguntas e avaliação.",
        tags: ["conversation", "proup", "rag", "questions", "evaluation"],
        variables: [
          "session_id",
          "turn",
          "user_message",
          "recent_messages",
          "content_context",
          "external_context",
          "conversation_memory",
        ],
      },
    ],
    schemas: [
      {
        id: "session_state",
        path: "schemas/session_state.schema.json",
        version: "v1",
        description: "Estado conversacional rico para agente complexo de paridade.",
        tags: ["state", "conversation", "proup"],
      },
      {
        id: "conversation_turn",
        path: "schemas/conversation_turn.schema.json",
        version: "v1",
        description: "Saída estruturada com resposta, perguntas geradas, fontes e avaliação.",
        tags: ["structured-output", "questions", "evaluation"],
      },
    ],
    nodes: [
      {
        id: "start_node",
        type: "start",
        description: "Abre a sessão e deixa claro que o agente conduz uma conversa por etapas.",
        position: { x: 180, y: 300 },
      },
      {
        id: "input_safety_check",
        type: "safety_gate",
        stage: "input",
        safetyMode: "default_and_custom",
        safetySeverityThreshold: "high",
        safetyRules: [
          {
            id: "block-secret-sharing",
            label: "Bloquear segredos no input",
            match: "(api[_-]?key|authorization|password|token)",
            matchType: "regex",
            category: "secrets",
            severity: "high",
            action: "safe_redirect",
            safeResponse: "Não envie chaves, tokens ou senhas. Descreva o objetivo sem credenciais.",
          },
        ],
        position: { x: 430, y: 120 },
      },
      {
        id: "collect_turn_context",
        type: "transform_json",
        description: "Normaliza a mensagem, memória e parâmetros do turno para consulta e avaliação.",
        inputPath: "$",
        outputPath: "conversation.turn_context",
        position: { x: 680, y: 300 },
      },
      {
        id: "load_reference_content",
        type: "file_extract",
        description: "Consulta conteúdo local versionado do workspace para apoiar a conversa.",
        sourcePath: "files/knowledge.md",
        contentPath: "content.extracted",
        maxChars: 200000,
        position: { x: 930, y: 120 },
      },
      {
        id: "retrieve_context",
        type: "rag_retrieval",
        description: "Seleciona trechos relevantes para o turno atual.",
        collectionPath: "files",
        queryPath: "user_message",
        contextPath: "content.retrieved",
        topK: 5,
        chunkSize: 900,
        position: { x: 1180, y: 300 },
      },
      {
        id: "external_content_lookup",
        type: "http_request",
        description: "Escape hatch opcional para consultar uma base externa por contrato HTTP governado.",
        method: "POST",
        url: "http://127.0.0.1:9100/content/search",
        bodyPath: "conversation.turn_context",
        responsePath: "content.external",
        timeoutSeconds: 10,
        retryAttempts: 1,
        position: { x: 1430, y: 120 },
      },
      {
        id: "generate_interview_step",
        type: "llm_structured",
        description: "Gera resposta, próximas perguntas e perguntas derivadas do conteúdo consultado.",
        promptId: "system",
        outputSchema: "conversation_turn",
        llm: {
          adapter: "openai",
          model: "gpt-4.1-mini",
        },
        position: { x: 1680, y: 300 },
      },
      {
        id: "update_conversation_state",
        type: "code",
        description: "Escape hatch local para consolidar estado, progresso e sinais de negócio.",
        codeLanguage: "python",
        codeExecution: "inline",
        inputPath: "$",
        resultPath: "conversation.state_patch",
        codeInline:
          "def handler(input, state, context):\n" +
          "    turn = int((state or {}).get('turn') or 0)\n" +
          "    generated = (state or {}).get('generated_questions') or []\n" +
          "    return {\n" +
          "        'turn': turn,\n" +
          "        'status': 'collecting' if turn < int((state or {}).get('max_turns') or 6) else 'ready_for_review',\n" +
          "        'question_count': len(generated),\n" +
          "        'needs_more_context': not bool((state or {}).get('content')),\n" +
          "    }\n",
        position: { x: 1930, y: 120 },
      },
      {
        id: "score_readiness",
        type: "scoring",
        description: "Avalia se há contexto suficiente para seguir ou pedir novas respostas.",
        metricName: "conversation_readiness",
        payloadPath: "conversation.state_patch",
        threshold: 0.7,
        resultPath: "evaluation.readiness",
        position: { x: 2180, y: 300 },
      },
      {
        id: "record_analytics",
        type: "analytics",
        description: "Registra métrica operacional do turno sem expor payload bruto em export governado.",
        metricName: "pro_up_parity_turn",
        payloadPath: "evaluation.readiness",
        resultPath: "analytics.turn",
        position: { x: 2430, y: 120 },
      },
      {
        id: "output_safety_check",
        type: "safety_gate",
        stage: "output",
        safetyMode: "default",
        position: { x: 2680, y: 300 },
      },
      {
        id: "human_followup",
        type: "human_input",
        description: "Mantém a conversa aberta para o próximo turno quando ainda falta contexto.",
        position: { x: 2930, y: 120 },
      },
      {
        id: "approval_checkpoint",
        type: "approval_gate",
        description: "Marca o ponto de revisão humana antes de promover a versão final.",
        decisionPath: "approval.decision",
        approvalValue: "approved",
        rejectionValue: "revise",
        position: { x: 3180, y: 300 },
      },
      {
        id: "finish_node",
        type: "end",
        description: "Finaliza a sessão manualmente ou após aprovação externa.",
        position: { x: 3430, y: 120 },
      },
    ],
    edges: [
      { from: "start", to: "start_node", condition: "action == 'start'" },
      { from: "start", to: "input_safety_check", condition: "action == 'turn'" },
      { from: "start", to: "approval_checkpoint", condition: "action == 'finish'" },
      { from: "start_node", to: "end" },
      { from: "input_safety_check", to: "collect_turn_context", condition: "safety.decision == 'allow'" },
      { from: "input_safety_check", to: "end", condition: "safety.blocked == true" },
      { from: "collect_turn_context", to: "load_reference_content" },
      { from: "load_reference_content", to: "retrieve_context" },
      { from: "retrieve_context", to: "external_content_lookup" },
      { from: "external_content_lookup", to: "generate_interview_step" },
      { from: "generate_interview_step", to: "update_conversation_state" },
      { from: "update_conversation_state", to: "score_readiness" },
      { from: "score_readiness", to: "record_analytics" },
      { from: "record_analytics", to: "output_safety_check" },
      { from: "output_safety_check", to: "human_followup" },
      { from: "human_followup", to: "end" },
      { from: "approval_checkpoint", to: "finish_node" },
      { from: "finish_node", to: "end" },
    ],
  };
}

function starterPrompt(name: string): string {
  return `# ${name}

Você é um agente de IA orientado a fluxo e consumido por API.

Responda em português brasileiro, de forma objetiva, usando o contexto recebido no payload do turno.

Mantenha a resposta adequada para continuidade da sessão. A lógica de avanço, repetição e encerramento é responsabilidade dos nós determinísticos do runtime.
`;
}

function starterStateSchema(name: string) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: `${name} State`,
    type: "object",
    properties: {
      session_id: { type: "string" },
      turn: { type: "integer", minimum: 0 },
      max_turns: { type: "integer", minimum: 1 },
      user_message: { type: "string" },
      assistant_message: { type: "object" },
      safety: { type: "object" },
      llm: { type: "object" },
      executed_nodes: {
        type: "array",
        items: { type: "string" },
      },
    },
  };
}

function contentQuestionGeneratorPrompt(name: string): string {
  return `# ${name}

Você é um agente que transforma conteúdo em perguntas úteis.

Use o contexto extraído do arquivo e o contexto recuperado por RAG para gerar perguntas claras, específicas e úteis para avaliação ou entrevista.

Regras:

- Gere perguntas em português brasileiro.
- Evite perguntas genéricas quando houver conteúdo específico disponível.
- Quando o conteúdo for insuficiente, gere perguntas de descoberta que ajudem a obter contexto.
- Retorne a saída respeitando o schema estruturado de perguntas.
`;
}

function contentQuestionGeneratorStateSchema(name: string) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: `${name} State`,
    type: "object",
    properties: {
      session_id: { type: "string" },
      turn: { type: "integer", minimum: 0 },
      max_turns: { type: "integer", minimum: 1 },
      user_message: { type: "string" },
      extracted_content: { type: "string" },
      rag_context: { type: "string" },
      questions: { type: "array" },
      safety: { type: "object" },
      llm: { type: "object" },
      executed_nodes: {
        type: "array",
        items: { type: "string" },
      },
    },
  };
}

function proUpParityComplexPrompt(name: string): string {
  return `# ${name}

Você é um agente conversacional complexo, inspirado no benchmark de paridade ProUp.

Objetivo:

- conduzir uma conversa por sessão;
- consultar conteúdo local e contexto externo quando estiver configurado;
- fazer perguntas objetivas para completar lacunas;
- gerar perguntas derivadas do conteúdo consultado;
- manter estado conversacional e sinais de avaliação;
- responder com saída estruturada compatível com o schema do flow.

Regras operacionais:

- Faça uma pergunta principal por vez quando ainda faltar contexto.
- Use o conteúdo recuperado antes de fazer afirmações.
- Se uma fonte estiver ausente ou incompleta, marque a lacuna em "state_updates".
- Gere "generated_questions" apenas quando houver conteúdo ou objetivo suficiente.
- Nunca inclua headers, tokens, senhas, payload bruto de tool ou valores sensíveis na resposta.
- Mantenha "content_sources" como referências compactas, não como conteúdo bruto.
`;
}

function proUpParityComplexStateSchema(name: string) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: `${name} State`,
    type: "object",
    properties: {
      session_id: { type: "string" },
      turn: { type: "integer", minimum: 0 },
      max_turns: { type: "integer", minimum: 1, default: 6 },
      user_message: { type: "string" },
      recent_messages: {
        type: "array",
        items: { type: "object" },
      },
      conversation: {
        type: "object",
        properties: {
          turn_context: { type: "object" },
          state_patch: { type: "object" },
          status: { type: "string" },
          question_count: { type: "integer", minimum: 0 },
          needs_more_context: { type: "boolean" },
        },
      },
      content: {
        type: "object",
        properties: {
          extracted: { type: "string" },
          retrieved: { type: "string" },
          external: { type: "object" },
        },
      },
      assistant_message: { type: "object" },
      generated_questions: {
        type: "array",
        items: { type: "object" },
      },
      content_sources: {
        type: "array",
        items: { type: "object" },
      },
      evaluation: { type: "object" },
      analytics: { type: "object" },
      approval: { type: "object" },
      safety: { type: "object" },
      llm: { type: "object" },
      executed_nodes: {
        type: "array",
        items: { type: "string" },
      },
    },
  };
}

function proUpParityComplexTurnSchemaContent(): string {
  return `${JSON.stringify(
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "ProUp Parity Conversation Turn",
      type: "object",
      required: [
        "assistant_message",
        "next_questions",
        "generated_questions",
        "content_sources",
        "state_updates",
        "evaluation",
      ],
      properties: {
        assistant_message: {
          type: "object",
          required: ["text", "intent"],
          properties: {
            text: { type: "string" },
            intent: {
              type: "string",
              enum: ["ask_followup", "answer_with_context", "generate_questions", "summarize", "handoff"],
            },
          },
        },
        next_questions: {
          type: "array",
          items: {
            type: "object",
            required: ["question", "reason"],
            properties: {
              question: { type: "string" },
              reason: { type: "string" },
              required_for: { type: "string" },
            },
          },
        },
        generated_questions: {
          type: "array",
          items: {
            type: "object",
            required: ["question", "source_hint"],
            properties: {
              question: { type: "string" },
              source_hint: { type: "string" },
              difficulty: { type: "string", enum: ["basic", "intermediate", "advanced"] },
            },
          },
        },
        content_sources: {
          type: "array",
          items: {
            type: "object",
            required: ["kind", "ref"],
            properties: {
              kind: { type: "string", enum: ["local_file", "rag_chunk", "external_tool", "user_context"] },
              ref: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
          },
        },
        state_updates: {
          type: "object",
          properties: {
            status: { type: "string" },
            known_facts: {
              type: "array",
              items: { type: "string" },
            },
            missing_context: {
              type: "array",
              items: { type: "string" },
            },
            should_finish: { type: "boolean" },
          },
        },
        evaluation: {
          type: "object",
          required: ["readiness_score", "needs_human_review"],
          properties: {
            readiness_score: { type: "number", minimum: 0, maximum: 1 },
            needs_human_review: { type: "boolean" },
            rationale: { type: "string" },
          },
        },
      },
    },
    null,
    2,
  )}\n`;
}

function questionListSchemaContent(): string {
  return `${JSON.stringify(
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "Question List Output",
      type: "object",
      required: ["questions"],
      properties: {
        questions: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            required: ["question", "reason"],
            properties: {
              question: { type: "string" },
              reason: { type: "string" },
              source_hint: { type: "string" },
            },
          },
        },
      },
    },
    null,
    2,
  )}\n`;
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
  const secretPolicyProfiles = parseSecretPolicyProfilePackage(value.secretPolicyProfiles);
  const normalizedSelectedSecretPolicyProfileId = normalizeSecretPolicyProfileId(
    typeof value.selectedSecretPolicyProfileId === "string" ? value.selectedSecretPolicyProfileId : "",
  );
  const normalizedDefaultSecretPolicyProfileId = normalizeSecretPolicyProfileId(
    typeof value.defaultSecretPolicyProfileId === "string" ? value.defaultSecretPolicyProfileId : "",
  );
  const selectedSecretPolicyProfileId = normalizedSelectedSecretPolicyProfileId
    && (secretPolicyProfiles?.profiles.some((profile) => profile.id === normalizedSelectedSecretPolicyProfileId) ??
      false)
      ? normalizedSelectedSecretPolicyProfileId
      : "";
  const defaultSecretPolicyProfileId = normalizedDefaultSecretPolicyProfileId
    && (secretPolicyProfiles?.profiles.some((profile) => profile.id === normalizedDefaultSecretPolicyProfileId) ?? false)
      ? normalizedDefaultSecretPolicyProfileId
      : "";
  return {
    format: FLOW_WORKSPACE_EXPORT_FORMAT,
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : new Date().toISOString(),
    source: isRecord(value.source) && typeof value.source.flowId === "string" && typeof value.source.flowPath === "string"
      ? { flowId: value.source.flowId, flowPath: value.source.flowPath }
      : { flowId: flow.id, flowPath: `flows/${flow.id}/agent.flow.json` },
    flow,
    prompts,
    schemas,
    secretPolicyProfiles,
    selectedSecretPolicyProfileId,
    defaultSecretPolicyProfileId,
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

function parseSecretPolicyProfilePackage(value: unknown): SecretPolicyProfilePackage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (value.format !== "agent-flow-builder.secret-policy-profiles.v1") {
    return undefined;
  }
  if (!Array.isArray(value.profiles)) {
    return undefined;
  }
  const profiles = value.profiles
    .map((rawProfile) => parseSecretPolicyProfile(rawProfile))
    .filter((profile): profile is SecretPolicyProfile => Boolean(profile));
  if (!profiles.length) {
    return undefined;
  }
  const normalizedProfiles = sortSecretPolicyProfiles(profiles);
  const declaredProfileCount =
    typeof value.profileCount === "number" && Number.isFinite(value.profileCount) && value.profileCount > 0 ? value.profileCount : normalizedProfiles.length;
  return {
    format: "agent-flow-builder.secret-policy-profiles.v1",
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : new Date().toISOString(),
    profileCount: declaredProfileCount,
    profiles: normalizedProfiles,
  };
}

function parseSecretPolicyProfile(raw: unknown): SecretPolicyProfile | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = normalizeSecretPolicyProfileId(String(raw.id ?? ""));
  if (!id) {
    return null;
  }
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) {
    return null;
  }
  return {
    id,
    name,
    description: typeof raw.description === "string" ? raw.description.trim() : "",
    requiredEnvNames: parseEnvNameList(raw.requiredEnvNames),
    protectedEnvNames: parseEnvNameList(raw.protectedEnvNames),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
  };
}

function parseEnvNameList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return uniqueEnvNameList(value.map((item) => (typeof item === "string" ? item : String(item))));
  }
  if (typeof value === "string") {
    return uniqueEnvNameList(value.split(/[\n,;]+/));
  }
  return [];
}

function uniqueEnvNameList(values: string[]): string[] {
  const normalized = values
    .map((value) => value.trim())
    .map((value) => value.replace(/\s+/g, "_").replace(/[^A-Za-z0-9_]/g, ""))
    .filter(Boolean);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of normalized) {
    const upper = value.toLocaleUpperCase();
    if (seen.has(upper)) {
      continue;
    }
    seen.add(upper);
    ordered.push(upper);
  }
  return ordered;
}

function normalizeSecretPolicyProfileId(candidate: string): string {
  return candidate.trim().replace(/[^A-Za-z0-9._-]+/g, "-");
}

function sortSecretPolicyProfiles(profiles: SecretPolicyProfile[]): SecretPolicyProfile[] {
  return [...profiles].sort((left, right) => {
    const leftName = left.name.trim().toLocaleLowerCase();
    const rightName = right.name.trim().toLocaleLowerCase();
    if (leftName !== rightName) {
      return leftName.localeCompare(rightName);
    }
    return left.id.localeCompare(right.id);
  });
}

async function resolveGeneratedArtifactRoot(
  workspaceRoot: string,
  outDir: string,
): Promise<{ absoluteOutDir: string; relativeOutDir: string }> {
  const requestedOutDir = outDir.trim();
  if (!requestedOutDir) {
    throw new WorkspaceError("outDir do artefato gerado é obrigatório.", 400);
  }
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const absoluteOutDir = safeResolve(root, requestedOutDir);
  const relativeOutDir = toWorkspaceRelative(root, absoluteOutDir);
  if (relativeOutDir !== "generated" && !relativeOutDir.startsWith("generated/")) {
    throw new WorkspaceError("Artefatos gerados só podem ser lidos dentro de generated/.", 400);
  }

  let outDirStat;
  try {
    outDirStat = await stat(absoluteOutDir);
  } catch (error) {
    throw new WorkspaceError(`Diretório gerado não encontrado: ${relativeOutDir}`, 404, error);
  }
  if (!outDirStat.isDirectory()) {
    throw new WorkspaceError(`outDir do artefato não é diretório: ${relativeOutDir}`, 400);
  }
  return { absoluteOutDir, relativeOutDir };
}

async function collectGeneratedArtifactFiles(
  artifactRoot: string,
  currentDir = "",
  result: GeneratedArtifactFileSummary[] = [],
): Promise<GeneratedArtifactFileSummary[]> {
  if (result.length > GENERATED_ARTIFACT_MAX_FILES) {
    throw new WorkspaceError(`Artefato gerado excede ${GENERATED_ARTIFACT_MAX_FILES} arquivos.`, 422);
  }

  const absoluteDir = path.join(artifactRoot, currentDir);
  const entries = (await readdir(absoluteDir, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    const relativePath = currentDir ? `${currentDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!GENERATED_ARTIFACT_IGNORED_DIRS.has(entry.name)) {
        await collectGeneratedArtifactFiles(artifactRoot, relativePath, result);
      }
      continue;
    }
    if (
      !entry.isFile() ||
      GENERATED_ARTIFACT_IGNORED_FILES.has(entry.name) ||
      GENERATED_ARTIFACT_IGNORED_EXTENSIONS.has(path.extname(entry.name))
    ) {
      continue;
    }
    const fileStat = await stat(path.join(artifactRoot, relativePath));
    result.push({
      path: relativePath.replaceAll(path.sep, "/"),
      sizeBytes: fileStat.size,
    });
  }
  return result;
}

function normalizeArtifactRelativePath(filePath: string): string {
  const normalized = filePath.trim().replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (!normalized) {
    throw new WorkspaceError("path do arquivo gerado é obrigatório.", 400);
  }
  if (normalized.includes("\0") || path.isAbsolute(normalized) || normalized.split("/").includes("..")) {
    throw new WorkspaceError(`Path de arquivo gerado inválido: ${filePath}`, 400);
  }
  return normalized;
}

function safeResolveArtifactFile(artifactRoot: string, filePath: string): string {
  const root = path.resolve(artifactRoot);
  const resolved = path.resolve(root, filePath);
  const relativePath = path.relative(root, resolved);
  if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new WorkspaceError(`Arquivo fora do artefato gerado: ${filePath}`, 400);
  }
  return resolved;
}

async function buildGeneratedArtifactExportManifest(
  outDir: string,
  absoluteOutDir: string,
  archiveRootName: string,
  files: GeneratedArtifactFileSummary[],
): Promise<GeneratedArtifactExportManifest> {
  const filePaths = new Set(files.map((file) => file.path));
  const generatedMeta = await readGeneratedArtifactMetadata(absoluteOutDir);
  const target = typeof generatedMeta?.target === "string" ? generatedMeta.target : null;
  const isRuntimeFinal =
    filePaths.has("Dockerfile") &&
    filePaths.has("docker-compose.yml") &&
    filePaths.has(".agent-flow/generated-meta.json") &&
    (target === "fastapi-runtime" || target === "runtime-manifest-bundle");
  const packageType = isRuntimeFinal
    ? "runtime-final"
    : filePaths.has("langgraph.json")
      ? "langgraph-sandbox"
      : "generic-artifact";
  const runtimeBaseUrl = packageType === "runtime-final"
    ? await readGeneratedRuntimeBaseUrl(absoluteOutDir)
    : null;
  const modelSetup = packageType === "runtime-final"
    ? await readGeneratedRunbookModelSetup(absoluteOutDir)
    : null;

  return {
    format: "agent-flow-builder.generated-artifact-export.v1",
    generatedAt: new Date().toISOString(),
    outDir,
    archiveRootName,
    packageType,
    target,
    detachedFromBuilder: isRuntimeFinal,
    includesEnvValues: false,
    excludedFiles: [...GENERATED_ARTIFACT_IGNORED_FILES].sort(),
    fileCount: files.length,
    totalSizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
    files: files.map((file) => file.path),
    runbook: buildGeneratedArtifactRunbook(packageType, target, generatedMeta, runtimeBaseUrl, modelSetup),
  };
}

function buildGeneratedArtifactExportAudit(
  manifest: GeneratedArtifactExportManifest,
  files: GeneratedArtifactFileSummary[],
): GeneratedArtifactExportAudit {
  const filePaths = new Set(files.map((file) => file.path));
  const requiredFiles = requiredExportFilesForPackage(manifest.packageType).map((filePath) => ({
    path: filePath,
    present: filePaths.has(filePath),
  }));
  const checks: GeneratedArtifactExportAuditCheck[] = [
    {
      id: "archive_manifest",
      label: "Manifesto embarcado",
      level: "ok",
      detail: "O ZIP inclui .agent-flow/export-manifest.json com tipo, target e contrato de exportação.",
    },
    {
      id: "package_type",
      label: "Tipo do pacote",
      level: manifest.packageType === "generic-artifact" ? "warning" : "ok",
      detail: manifest.packageType === "runtime-final"
        ? `Runtime final detectado com target ${manifest.target ?? "desconhecido"}.`
        : manifest.packageType === "langgraph-sandbox"
          ? "Pacote de sandbox LangGraph detectado."
          : "Artefato genérico detectado; revise o conteúdo antes de usar como entrega final.",
    },
    {
      id: "required_files",
      label: "Arquivos obrigatórios",
      level: requiredFiles.every((file) => file.present) ? "ok" : "error",
      detail: requiredFiles.every((file) => file.present)
        ? "Todos os arquivos obrigatórios do tipo de pacote estão presentes."
        : `Arquivos ausentes: ${requiredFiles.filter((file) => !file.present).map((file) => file.path).join(", ")}.`,
    },
    {
      id: "env_excluded",
      label: "Secrets fora do ZIP",
      level: manifest.files.includes(".env") ? "error" : "ok",
      detail: manifest.files.includes(".env")
        ? "O arquivo .env entrou na lista exportável."
        : "Valores locais de .env não são incluídos no ZIP exportado.",
    },
    {
      id: "detached_runtime",
      label: "Runtime removível",
      level: manifest.packageType === "runtime-final" && manifest.detachedFromBuilder ? "ok" : "warning",
      detail: manifest.packageType === "runtime-final" && manifest.detachedFromBuilder
        ? "O pacote é classificado como runtime final destacável do Builder."
        : "Este pacote não é classificado como runtime final destacável.",
    },
  ];
  const blockers = checks.filter((check) => check.level === "error").map((check) => `${check.label}: ${check.detail}`);

  return {
    format: "agent-flow-builder.generated-artifact-export-audit.v1",
    packageType: manifest.packageType,
    target: manifest.target,
    ready: blockers.length === 0,
    detachedFromBuilder: manifest.detachedFromBuilder,
    archiveManifestPath: ".agent-flow/export-manifest.json",
    includesEnvValues: manifest.includesEnvValues,
    blockedFiles: manifest.excludedFiles,
    requiredFiles,
    checks,
    blockers,
    runbook: manifest.runbook,
  };
}

function buildGeneratedArtifactRunbook(
  packageType: GeneratedArtifactPackageType,
  target: string | null,
  generatedMeta: Record<string, unknown> | null,
  runtimeBaseUrl: string | null,
  modelSetup: GeneratedArtifactRunbookModelSetup | null,
): GeneratedArtifactRunbook {
  const baseUrl = runtimeBaseUrl ?? DEFAULT_EXPORT_RUNTIME_BASE_URL;
  const agents = packageType === "runtime-final" ? readRunbookAgents(generatedMeta, baseUrl) : [];
  const firstAgent = agents[0] ?? null;
  const smokeCommand = firstAgent
    ? `curl ${firstAgent.metadataUrl}`
    : `curl ${baseUrl}/health`;
  if (packageType === "runtime-final") {
    return {
      title: "Rodar runtime final fora do Builder",
      workingDirectory: ".",
      runtimeBaseUrl: baseUrl,
      agents,
      steps: [
        {
          id: "extract",
          label: "Extrair pacote",
          command: null,
          detail: "Extraia o ZIP em uma pasta própria e abra um terminal nessa pasta.",
        },
        {
          id: "prepare_env",
          label: "Preparar ambiente",
          command: "cp .env.example .env",
          detail: "Edite o .env local com as chaves e URLs reais antes de subir a API. O ZIP não inclui valores de .env.",
        },
        ...(modelSetup
          ? [
              {
                id: "model_setup",
                label: "Preparar modelos locais",
                command: modelSetup.command,
                detail: `Baixa os modelos locais usados pelo runtime via profile model-setup: ${modelSetup.models.join(", ")}.`,
              },
              ...(modelSetup.modelImageCommand
                ? [
                  {
                      id: "model_image",
                      label: "Opcional: imagem Ollama pré-carregada",
                      command: modelSetup.modelImageCommand,
                      detail: "Constrói o serviço Ollama com os modelos já incluídos na imagem local usando docker-compose.model-image.yml.",
                    },
                    ...(modelSetup.modelImageExportCommand
                      ? [
                          {
                            id: "model_image_export",
                            label: "Opcional: exportar imagem Ollama",
                            command: modelSetup.modelImageExportCommand,
                            detail: modelSetup.modelImageLoadCommand
                              ? `Salva a imagem ${modelSetup.modelImageTag ?? "Ollama"} em ${modelSetup.modelImageArchivePath}; em outra máquina, carregue com ${modelSetup.modelImageLoadCommand}.`
                              : "Salva a imagem Ollama pré-carregada como arquivo tar versionável.",
                          },
                        ]
                      : []),
                    ...(modelSetup.modelImagePushCommand
                      ? [
                          {
                            id: "model_image_push",
                            label: "Opcional: publicar imagem Ollama",
                            command: modelSetup.modelImagePushCommand,
                            detail: "Publica a tag OLLAMA_MODEL_IMAGE usando a autenticação já configurada no Docker local; o runbook não inclui credenciais.",
                          },
                        ]
                      : []),
                  ]
                : []),
              ...(modelSetup.gpuCommand
                ? [
                    {
                      id: "model_gpu",
                      label: "Opcional: perfil GPU",
                      command: modelSetup.gpuCommand,
                      detail: "Sobe o runtime com reserva NVIDIA GPU para o serviço Ollama usando docker-compose.gpu.yml em hosts compatíveis.",
                    },
                    {
                      id: "model_gpu_probe",
                      label: "Opcional: testar GPU Docker",
                      command: "docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi -L",
                      detail: "Confirma que o Docker consegue enxergar a GPU dentro de um container CUDA descartável antes de usar o perfil GPU.",
                    },
                  ]
                : []),
            ]
          : []),
        {
          id: "build",
          label: "Build Docker",
          command: "docker compose build",
          detail: "Constrói as imagens do runtime final usando apenas os arquivos exportados.",
        },
        {
          id: "up",
          label: "Subir serviços",
          command: "docker compose up -d",
          detail: "Sobe a API e serviços auxiliares definidos no docker-compose.yml sem depender do Builder.",
        },
        {
          id: "smoke",
          label: "Smoke manual",
          command: smokeCommand,
          detail: firstAgent
            ? "Verifique a metadata do agente e depois crie uma sessão na rota de sessões indicada no runbook."
            : "Verifique também /docs e /openapi.json na porta configurada no compose.",
        },
      ],
      endpoints: [
        { label: "Health", url: `${baseUrl}/health` },
        { label: "Docs", url: `${baseUrl}/docs` },
        { label: "OpenAPI", url: `${baseUrl}/openapi.json` },
        ...agents.flatMap((agent) => [
          { label: `${agent.id} metadata`, url: agent.metadataUrl },
          { label: `${agent.id} sessões`, url: agent.sessionsUrl },
        ]),
      ],
    };
  }
  if (packageType === "langgraph-sandbox") {
    return {
      title: "Abrir sandbox LangGraph",
      workingDirectory: ".",
      runtimeBaseUrl: null,
      agents: [],
      steps: [
        {
          id: "prepare_env",
          label: "Preparar ambiente",
          command: "cp .env.example .env",
          detail: "Preencha as variáveis necessárias para o sandbox local ou integração opcional com LangSmith.",
        },
        {
          id: "dev",
          label: "Iniciar sandbox",
          command: "langgraph dev",
          detail: "Execute dentro da pasta extraída para abrir o grafo no runtime LangGraph local.",
        },
      ],
      endpoints: [],
    };
  }
  return {
    title: "Inspecionar artefato exportado",
    workingDirectory: ".",
    runtimeBaseUrl: null,
    agents: [],
    steps: [
      {
        id: "inspect",
        label: "Revisar arquivos",
        command: null,
        detail: `Artefato genérico${target ? ` com target ${target}` : ""}; revise o conteúdo antes de usar como entrega final.`,
      },
    ],
    endpoints: [],
  };
}

async function readGeneratedRuntimeBaseUrl(absoluteOutDir: string): Promise<string> {
  const apiPort = await readGeneratedComposeApiHostPort(absoluteOutDir);
  return `http://127.0.0.1:${apiPort}`;
}

async function readGeneratedRunbookModelSetup(
  absoluteOutDir: string,
): Promise<GeneratedArtifactRunbookModelSetup | null> {
  let compose: unknown;
  try {
    compose = parseYaml(await readFile(path.join(absoluteOutDir, "docker-compose.yml"), "utf-8"));
  } catch {
    return null;
  }
  if (!isRecord(compose) || !isRecord(compose.services)) {
    return null;
  }
  const setupServices = Object.entries(compose.services)
    .filter(([name, service]) => isGeneratedOllamaPullService(name, service))
    .map(([name, service]) => ({
      service: name,
      model: readGeneratedOllamaPullModel(service as Record<string, unknown>) ?? name.replace(/^ollama-pull-/, "").replace(/-/g, ":"),
    }))
    .sort((left, right) => left.service.localeCompare(right.service));
  if (!setupServices.length) {
    return null;
  }
  const services = setupServices.map((service) => service.service);
  const hasModelImageOverride = await generatedArtifactFileExists(absoluteOutDir, "docker-compose.model-image.yml")
    && await generatedArtifactFileExists(absoluteOutDir, "ollama-models/Dockerfile");
  const hasGpuOverride = await generatedArtifactFileExists(absoluteOutDir, "docker-compose.gpu.yml");
  const modelImageTag = hasModelImageOverride ? await readGeneratedModelImageTag(absoluteOutDir) : null;
  const modelImageArchivePath = modelImageTag ? `model-distribution/${safeGeneratedModelImageArchiveName(modelImageTag)}.tar` : null;
  return {
    services,
    models: setupServices.map((service) => service.model),
    command: `docker compose --profile model-setup up ${services.join(" ")}`,
    modelImageCommand: hasModelImageOverride
      ? "docker compose -f docker-compose.yml -f docker-compose.model-image.yml build ollama"
      : null,
    modelImageTag,
    modelImageArchivePath,
    modelImageExportCommand: modelImageTag && modelImageArchivePath
      ? `docker image save -o ${toGeneratedPosixPath(modelImageArchivePath)} ${modelImageTag}`
      : null,
    modelImageLoadCommand: modelImageArchivePath
      ? `docker image load -i ${toGeneratedPosixPath(modelImageArchivePath)}`
      : null,
    modelImagePushCommand: modelImageTag && isGeneratedPushableModelImageTag(modelImageTag)
      ? `docker image push ${modelImageTag}`
      : null,
    gpuCommand: hasGpuOverride
      ? "docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build"
      : null,
  };
}

async function readGeneratedModelImageTag(absoluteOutDir: string): Promise<string | null> {
  let parsed: unknown;
  try {
    parsed = parseYaml(await readFile(path.join(absoluteOutDir, "docker-compose.model-image.yml"), "utf-8"));
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !isRecord(parsed.services)) {
    return null;
  }
  const ollama = parsed.services.ollama;
  if (!isRecord(ollama) || typeof ollama.image !== "string") {
    return null;
  }
  return resolveGeneratedComposeImageValue(ollama.image.trim(), await readGeneratedRuntimeEnvValues(absoluteOutDir));
}

async function readGeneratedRuntimeEnvValues(absoluteOutDir: string): Promise<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const fileName of [".env", ".env.example"]) {
    const content = await readFile(path.join(absoluteOutDir, fileName), "utf-8").catch(() => "");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const index = line.indexOf("=");
      if (index <= 0) {
        continue;
      }
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key && values[key] === undefined) {
        values[key] = value;
      }
    }
  }
  return values;
}

function resolveGeneratedComposeImageValue(value: string, envValues: Record<string, string>): string | null {
  const expression = /^\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*))?\}$/.exec(value);
  if (!expression) {
    return value || null;
  }
  const [, envName, fallback = ""] = expression;
  return envValues[envName]?.trim() || fallback.trim() || null;
}

function safeGeneratedModelImageArchiveName(imageTag: string): string {
  return imageTag
    .trim()
    .toLowerCase()
    .replace(/:/g, ".")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "ollama-models";
}

function toGeneratedPosixPath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function isGeneratedPushableModelImageTag(imageTag: string): boolean {
  const trimmed = imageTag.trim();
  if (!trimmed || trimmed.endsWith(":local")) {
    return false;
  }
  return trimmed.includes("/") && !trimmed.startsWith("ollama/");
}

async function generatedArtifactFileExists(absoluteOutDir: string, relativePath: string): Promise<boolean> {
  try {
    await access(path.join(absoluteOutDir, relativePath));
    return true;
  } catch {
    return false;
  }
}

function isGeneratedOllamaPullService(name: string, service: unknown): service is Record<string, unknown> {
  if (!name.startsWith("ollama-pull-") || !isRecord(service)) {
    return false;
  }
  const profiles = service.profiles;
  return Array.isArray(profiles) && profiles.map(String).includes("model-setup");
}

function readGeneratedOllamaPullModel(service: Record<string, unknown>): string | null {
  const command = service.command;
  if (Array.isArray(command)) {
    const pullIndex = command.findIndex((item) => String(item) === "pull");
    const next = pullIndex >= 0 ? command[pullIndex + 1] : command.at(-1);
    return typeof next === "string" && next.trim() ? next.trim() : null;
  }
  if (typeof command === "string") {
    return /\bpull\s+([^\s]+)/.exec(command)?.[1] ?? null;
  }
  return null;
}

async function readGeneratedComposeApiHostPort(absoluteOutDir: string): Promise<number> {
  try {
    const compose = parseYaml(await readFile(path.join(absoluteOutDir, "docker-compose.yml"), "utf-8"));
    if (!isRecord(compose) || !isRecord(compose.services)) {
      return DEFAULT_EXPORT_API_PORT;
    }
    const apiService = compose.services.api;
    if (!isRecord(apiService) || !Array.isArray(apiService.ports)) {
      return DEFAULT_EXPORT_API_PORT;
    }
    for (const binding of apiService.ports) {
      const hostPort = readGeneratedComposeHostPort(binding);
      if (hostPort !== null) {
        return hostPort;
      }
    }
  } catch {
    return DEFAULT_EXPORT_API_PORT;
  }
  return DEFAULT_EXPORT_API_PORT;
}

function readGeneratedComposeHostPort(binding: unknown): number | null {
  if (isRecord(binding)) {
    const published = toValidPort(binding.published);
    if (published !== null) {
      return published;
    }
    return toValidPort(binding.target);
  }
  const value = String(binding).trim().replace(/\/(?:tcp|udp)$/i, "");
  const directPort = toValidPort(value);
  if (directPort !== null) {
    return directPort;
  }
  const parts = value.split(":").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return toValidPort(parts[parts.length - 2]);
  }
  return null;
}

function toValidPort(value: unknown): number | null {
  const port = Number(value);
  if (Number.isInteger(port) && port >= 1 && port <= 65535) {
    return port;
  }
  return null;
}

function readRunbookAgents(generatedMeta: Record<string, unknown> | null, runtimeBaseUrl: string): GeneratedArtifactRunbookAgent[] {
  if (!generatedMeta || !Array.isArray(generatedMeta.agents)) {
    const flowId = typeof generatedMeta?.flowId === "string" && generatedMeta.flowId.trim()
      ? generatedMeta.flowId.trim()
      : "agent";
    return [
      {
        id: flowId,
        routePrefix: "",
        resourceName: "sessions",
        metadataUrl: `${runtimeBaseUrl}/metadata`,
        sessionsUrl: `${runtimeBaseUrl}/sessions`,
      },
    ];
  }
  return generatedMeta.agents
    .filter(isRecord)
    .map((agent) => {
      const id = readStringField(agent, "id") || readStringField(agent, "flowId") || "agent";
      const routePrefix = normalizeExportRoutePrefix(readStringField(agent, "routePrefix"));
      const resourceName = readStringField(agent, "resourceName") || "sessions";
      return {
        id,
        routePrefix,
        resourceName,
        metadataUrl: `${runtimeBaseUrl}${joinExportRuntimePath(routePrefix, "metadata")}`,
        sessionsUrl: `${runtimeBaseUrl}${joinExportRuntimePath(routePrefix, resourceName)}`,
      };
    });
}

function readStringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function normalizeExportRoutePrefix(routePrefix: string): string {
  const trimmed = routePrefix.trim();
  if (!trimmed || trimmed === "/") {
    return "";
  }
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

function joinExportRuntimePath(...parts: string[]): string {
  const normalized = parts
    .flatMap((part) => part.split("/"))
    .map((part) => part.trim())
    .filter(Boolean);
  return `/${normalized.join("/")}`;
}

function requiredExportFilesForPackage(packageType: GeneratedArtifactPackageType): string[] {
  if (packageType === "runtime-final") {
    return [
      "Dockerfile",
      "docker-compose.yml",
      ".env.example",
      ".agent-flow/generated-meta.json",
      ".agent-flow/langgraph-sandbox-approval.json",
    ];
  }
  if (packageType === "langgraph-sandbox") {
    return ["langgraph.json", "README.md", ".env.example"];
  }
  return [];
}

async function readGeneratedArtifactMetadata(absoluteOutDir: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path.join(absoluteOutDir, ".agent-flow", "generated-meta.json"), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "runtime-artifact";
}

function safeRuntimeSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "") || "agent";
}

function uniqueSortedStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))).sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ZipArchiveFile {
  path: string;
  content: Buffer;
}

function writeZipArchive(files: ZipArchiveFile[]): Buffer {
  const chunks: Buffer[] = [];
  const centralDirectory: Buffer[] = [];
  let offset = 0;
  const timestamp = dosDateTime(new Date());

  for (const file of files) {
    const fileName = Buffer.from(file.path.replaceAll("\\", "/"), "utf-8");
    const checksum = crc32(file.content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(timestamp.time, 10);
    localHeader.writeUInt16LE(timestamp.date, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(file.content.byteLength, 18);
    localHeader.writeUInt32LE(file.content.byteLength, 22);
    localHeader.writeUInt16LE(fileName.byteLength, 26);
    localHeader.writeUInt16LE(0, 28);
    chunks.push(localHeader, fileName, file.content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(timestamp.time, 12);
    centralHeader.writeUInt16LE(timestamp.date, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(file.content.byteLength, 20);
    centralHeader.writeUInt32LE(file.content.byteLength, 24);
    centralHeader.writeUInt16LE(fileName.byteLength, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralDirectory.push(centralHeader, fileName);

    offset += localHeader.byteLength + fileName.byteLength + file.content.byteLength;
  }

  const centralDirectoryOffset = offset;
  const centralDirectoryBuffer = Buffer.concat(centralDirectory);
  chunks.push(centralDirectoryBuffer);
  offset += centralDirectoryBuffer.byteLength;

  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(files.length, 8);
  endRecord.writeUInt16LE(files.length, 10);
  endRecord.writeUInt32LE(centralDirectoryBuffer.byteLength, 12);
  endRecord.writeUInt32LE(centralDirectoryOffset, 16);
  endRecord.writeUInt16LE(0, 20);
  chunks.push(endRecord);
  return Buffer.concat(chunks, offset + endRecord.byteLength);
}

function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const CRC32_TABLE = createCrc32Table();

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
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

export async function generateLangGraphSandboxArtifact(
  workspaceRoot: string,
  flowId: string,
  requestedOutDir?: string,
): Promise<GenerateResult> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const loaded = await loadFlowById(root, flowId);
  const outDir = requestedOutDir?.trim() || `generated/${loaded.flow.id}-langgraph-sandbox`;
  const absoluteOutDir = safeResolve(root, outDir);
  await mkdir(path.dirname(absoluteOutDir), { recursive: true });
  await generateLangGraphSandbox({
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

export async function approveLangGraphSandbox(
  workspaceRoot: string,
  flowId: string,
  requestedOutDir?: string,
  approvalEvidence?: LangGraphSandboxApprovalEvidence,
): Promise<LangGraphSandboxApproval> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const loaded = await loadFlowById(root, flowId);
  const outDir = requestedOutDir?.trim() || `generated/${loaded.flow.id}-langgraph-sandbox`;
  const absoluteOutDir = safeResolve(root, outDir);
  const metadata = await readGeneratedProjectMetadata(absoluteOutDir);
  const expectedHash = await flowProjectFingerprint(loaded.flow, loaded.flowRoot);

  if (metadata.target !== "langgraph-sandbox") {
    throw new WorkspaceError("O artefato informado não é um pacote LangGraph sandbox.", 409, metadata);
  }
  if (metadata.flowId !== loaded.flow.id || metadata.flowVersion !== loaded.flow.version || metadata.flowHash !== expectedHash) {
    throw new WorkspaceError(
      "O pacote LangGraph sandbox não corresponde ao flow atual. Gere e teste o sandbox novamente antes de aprovar.",
      409,
      {
        current: { flowId: loaded.flow.id, flowVersion: loaded.flow.version, flowHash: expectedHash },
        sandbox: metadata,
      },
    );
  }

  const approvalDir = path.join(loaded.flowRoot, ".agent-flow");
  await mkdir(approvalDir, { recursive: true });
  const approvalPath = path.join(approvalDir, "langgraph-sandbox-approval.json");
  const sanitizedApprovalEvidence = parseLangGraphSandboxApprovalEvidence(approvalEvidence);
  const approval: LangGraphSandboxApproval = {
    status: "approved",
    flowId: loaded.flow.id,
    flowVersion: loaded.flow.version,
    flowHash: expectedHash,
    sandboxOutDir: toWorkspaceRelative(root, absoluteOutDir),
    approvedFor: "fastapi-runtime",
    approvalPath: toWorkspaceRelative(root, approvalPath),
    approvedAt: new Date().toISOString(),
    ...(sanitizedApprovalEvidence ? { evidence: sanitizedApprovalEvidence } : {}),
  };
  await writeFile(approvalPath, `${JSON.stringify(approval, null, 2)}\n`, "utf-8");
  return approval;
}

export async function readLangGraphSandboxApprovalStatus(
  workspaceRoot: string,
  flowId: string,
): Promise<LangGraphSandboxApprovalStatus> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const loaded = await loadFlowById(root, flowId);
  const approvalPath = path.join(loaded.flowRoot, ".agent-flow", "langgraph-sandbox-approval.json");
  const expectedHash = await flowProjectFingerprint(loaded.flow, loaded.flowRoot);
  const base: Omit<LangGraphSandboxApprovalStatus, "status" | "reason" | "details"> = {
    flowId: loaded.flow.id,
    flowVersion: loaded.flow.version,
    flowHash: expectedHash,
    approvalPath: toWorkspaceRelative(root, approvalPath),
  };

  let rawApproval: unknown;
  try {
    rawApproval = JSON.parse(await readFile(approvalPath, "utf-8"));
  } catch (error) {
    return {
      ...base,
      status: "missing",
      reason: "Não há aprovação de sandbox registrada para este flow.",
      details: error instanceof Error ? error.message : error,
    };
  }

  const approval = parseLangGraphSandboxApproval(rawApproval);
  if (!approval) {
    return {
      ...base,
      status: "invalid",
      reason: "Arquivo de aprovação inválido ou inconsistente.",
      details: rawApproval,
    };
  }

  if (
    approval.status !== "approved" ||
    approval.flowId !== loaded.flow.id ||
    approval.flowVersion !== loaded.flow.version ||
    approval.flowHash !== expectedHash
  ) {
    return {
      ...base,
      ...approval,
      status: "outdated",
      reason: "Aprovação existente não corresponde ao flow atual.",
      details: {
        approval,
        expected: {
          flowId: loaded.flow.id,
          flowVersion: loaded.flow.version,
          flowHash: expectedHash,
        },
      },
    };
  }

  let sandboxMetadata: GeneratedProjectMetadata;
  try {
    const sandboxOutDir = safeResolve(root, approval.sandboxOutDir);
    sandboxMetadata = await readGeneratedProjectMetadata(sandboxOutDir);
    if (sandboxMetadata.target !== "langgraph-sandbox" || sandboxMetadata.flowHash !== expectedHash) {
      return {
        ...base,
        ...approval,
        status: "outdated",
        reason: "O sandbox aprovado não corresponde ao flow atual.",
        details: sandboxMetadata,
      };
    }
  } catch (error) {
    return {
      ...base,
      ...approval,
      status: "outdated",
      reason: "Arquivo de metadados do sandbox não encontrado ou inválido.",
      details: error instanceof Error ? error.message : error,
    };
  }

  return {
    ...approval,
    status: "approved",
    reason: "Sandbox aprovado para geração da API Docker.",
    details: undefined,
  };
}

export async function generateLangSmithCloudHandoff(
  workspaceRoot: string,
  flowId: string,
): Promise<LangSmithCloudHandoffPackage> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const loaded = await loadFlowById(root, flowId);
  const approvalStatus = await readLangGraphSandboxApprovalStatus(root, loaded.flow.id);
  const sandboxOutDir = approvalStatus.sandboxOutDir ?? `generated/${loaded.flow.id}-langgraph-sandbox`;
  const expectedHash = approvalStatus.flowHash || await flowProjectFingerprint(loaded.flow, loaded.flowRoot);

  let sandboxStatus: LangSmithCloudHandoffPackage["sandbox"] = {
    status: "missing",
    outDir: sandboxOutDir,
    generated: false,
    target: null,
    flowHash: null,
    reason: "Gere o pacote LangGraph sandbox antes do handoff opcional para LangSmith Cloud.",
  };
  try {
    const sandboxMetadata = await readGeneratedProjectMetadata(safeResolve(root, sandboxOutDir));
    const sandboxReady = sandboxMetadata.target === "langgraph-sandbox"
      && sandboxMetadata.flowId === loaded.flow.id
      && sandboxMetadata.flowVersion === loaded.flow.version
      && sandboxMetadata.flowHash === expectedHash;
    sandboxStatus = {
      status: sandboxReady ? "ready" : "outdated",
      outDir: sandboxOutDir,
      generated: true,
      target: typeof sandboxMetadata.target === "string" ? sandboxMetadata.target : null,
      flowHash: typeof sandboxMetadata.flowHash === "string" ? sandboxMetadata.flowHash : null,
      reason: sandboxReady
        ? "Sandbox LangGraph gerado para a versão atual."
        : "O sandbox LangGraph gerado não corresponde ao flow atual.",
    };
  } catch (error) {
    sandboxStatus = {
      ...sandboxStatus,
      status: error instanceof WorkspaceError && error.statusCode === 422 ? "invalid" : "missing",
      reason: error instanceof Error ? error.message : sandboxStatus.reason,
    };
  }

  const approvalReady = approvalStatus.status === "approved";
  const now = new Date().toISOString();
  const handoffPath = path.join(loaded.flowRoot, ".agent-flow", "langsmith-handoff.aflangsmithhandoff.json");
  const llmConfigs = [
    loaded.flow.llm,
    ...loaded.flow.nodes.map((node) => node.llm),
  ];
  const protectedEnvNames = uniqueSortedStrings(llmConfigs.map((config) => config?.apiKeyEnv));
  const baseUrlEnvNames = uniqueSortedStrings(llmConfigs.map((config) => config?.baseUrlEnv));
  const mockEnvNames = uniqueSortedStrings(llmConfigs.map((config) => config?.mockEnv));
  const referencedEnvNames = uniqueSortedStrings([...protectedEnvNames, ...baseUrlEnvNames, ...mockEnvNames]);
  const handoffWithoutHash = {
    format: "agent-flow-builder.langsmith-cloud-handoff.v1" as const,
    status: sandboxStatus.status === "ready" && approvalReady ? "ready" as const : "blocked" as const,
    flowId: loaded.flow.id,
    flowName: loaded.flow.name,
    flowVersion: loaded.flow.version,
    flowHash: expectedHash,
    generatedAt: now,
    handoffPath: toWorkspaceRelative(root, handoffPath),
    sandbox: sandboxStatus,
    approval: {
      status: approvalStatus.status,
      ready: approvalReady,
      approvalPath: approvalStatus.approvalPath,
      ...(approvalStatus.approvedAt ? { approvedAt: approvalStatus.approvedAt } : {}),
      reason: approvalStatus.reason,
      ...(approvalStatus.evidence ? { evidence: approvalStatus.evidence } : {}),
    },
    environment: {
      llmAdapter: loaded.flow.llm.adapter,
      model: loaded.flow.llm.model,
      referencedEnvNames,
      protectedEnvNames,
      baseUrlEnvNames,
      mockEnvNames,
      includesEnvValues: false as const,
    },
    checklist: [
      {
        id: "generate_sandbox",
        label: "Pacote LangGraph gerado",
        status: sandboxStatus.status === "ready" ? "done" as const : "pending" as const,
        detail: sandboxStatus.reason,
      },
      {
        id: "test_local_or_cloud_sandbox",
        label: "Sandbox testado com evidência",
        status: approvalReady ? "done" as const : "pending" as const,
        detail: approvalReady
          ? "A aprovação local possui evidência sanitizada para esta versão."
          : "Execute o sandbox, confira runs/eventos e registre aprovação no Studio.",
      },
      {
        id: "operator_cloud_import",
        label: "Importação cloud pelo operador",
        status: sandboxStatus.status === "ready" && approvalReady ? "pending" as const : "blocked" as const,
        detail: "Opcional: use o pacote gerado em LangSmith/LangGraph Cloud sem salvar token no Studio.",
      },
    ],
    commands: buildLangSmithCloudHandoffCommands(loaded.relativePath, sandboxOutDir),
    governance: {
      localFirstOptional: true as const,
      doesNotCallCloud: true as const,
      cloudTokenNotStored: true as const,
      includesSecrets: false as const,
      includesEnvValues: false as const,
      includesRawPayloads: false as const,
      includesPromptContent: false as const,
      includesSchemaContent: false as const,
    },
  };
  const packageHash = createHash("sha256")
    .update(JSON.stringify({ ...handoffWithoutHash, generatedAt: "" }))
    .digest("hex");
  const handoff: LangSmithCloudHandoffPackage = {
    ...handoffWithoutHash,
    packageHash,
  };
  await mkdir(path.dirname(handoffPath), { recursive: true });
  await writeFile(handoffPath, `${JSON.stringify(handoff, null, 2)}\n`, "utf-8");
  return handoff;
}

export async function loadLangSmithCloudDeployments(
  workspaceRoot: string,
  flowId: string,
): Promise<LangSmithCloudDeploymentsPackage> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const loaded = await loadFlowById(root, flowId);
  const flowHash = await flowProjectFingerprint(loaded.flow, loaded.flowRoot);
  const deploymentPath = langSmithCloudDeploymentsPath(loaded.flowRoot);
  const base = emptyLangSmithCloudDeploymentsPackage(root, loaded, flowHash, deploymentPath);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(deploymentPath, "utf-8"));
  } catch {
    return base;
  }
  const parsed = parseLangSmithCloudDeploymentsPackage(raw, root, loaded, flowHash, deploymentPath);
  return parsed ?? base;
}

export async function loadLangSmithCloudDeploymentsCentralStatus(): Promise<LangSmithCloudDeploymentsCentralStatus> {
  return buildLangSmithCloudDeploymentsCentralStatus(langSmithCloudDeploymentsCentralConfig());
}

export async function loadLangSmithCloudDeploymentAutomationStatus(): Promise<LangSmithCloudDeploymentAutomationStatus> {
  return buildLangSmithCloudDeploymentAutomationStatus(langSmithCloudDeploymentAutomationConfig());
}

export async function triggerLangSmithCloudDeployment(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<LangSmithCloudDeploymentAutomationResult> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const loaded = await loadFlowById(root, flowId);
  const config = langSmithCloudDeploymentAutomationConfig();
  if (config.invalidReason) {
    throw new WorkspaceError(`Configuração do deploy cloud LangSmith inválida: ${config.invalidReason}`, 422);
  }
  if (!config.url) {
    throw new WorkspaceError("Endpoint de deploy cloud LangSmith não configurado.", 400);
  }

  const body = isRecord(payload) ? payload : {};
  const recordedRole = normalizeLangSmithCloudDeploymentRecorderRole(body.recordedRole ?? body.role);
  if (recordedRole === "viewer") {
    throw new WorkspaceError("Viewer não pode disparar deploy cloud.", 403, {
      code: "langsmith_cloud_deployment_automation_viewer_forbidden",
      role: recordedRole,
      requiredRole: "reviewer",
    });
  }
  const recordedBy = sanitizeCompactText(body.recordedBy ?? body.actorId ?? body.reviewer, 120) || "local-studio";
  const requestedAt = new Date().toISOString();
  const handoff = await generateLangSmithCloudHandoff(root, loaded.flow.id);
  if (handoff.status !== "ready" || !handoff.approval.ready) {
    throw new WorkspaceError("Gere, teste e aprove o sandbox antes de disparar deploy cloud opcional.", 409, handoff);
  }
  const currentDeployments = await loadLangSmithCloudDeployments(root, flowId);
  const requestedDeploymentName = sanitizeCompactText(body.deploymentName ?? body.name, 120) || loaded.flow.name;
  const requestedEnvironment = sanitizeCompactText(body.environment, 80) || "cloud";
  const fetched = await fetchLangSmithCloudDeploymentAutomation(config, {
    flowId,
    requestedAt,
    requestedBy: recordedBy,
    requestedRole: recordedRole,
    deploymentName: requestedDeploymentName,
    environment: requestedEnvironment,
    handoff,
    currentDeployments,
  });
  const responseHash = createHash("sha256").update(fetched.body).digest("hex");
  let parsed: unknown;
  try {
    parsed = fetched.body.trim() ? JSON.parse(fetched.body) : {};
  } catch (error) {
    throw new WorkspaceError("Resposta do deploy cloud LangSmith não é JSON válido.", 502, error);
  }
  const deploymentPayload = isRecord(parsed) && isRecord(parsed.deployment) ? parsed.deployment : parsed;
  const deploymentRecordPayload = buildLangSmithCloudDeploymentPayloadFromAutomationResponse(
    deploymentPayload,
    {
      requestedDeploymentName,
      requestedEnvironment,
      recordedBy,
      recordedRole,
      requestedAt,
      statusCode: fetched.statusCode,
      responseHash,
    },
  );
  const deployments = await recordLangSmithCloudDeployment(root, flowId, deploymentRecordPayload);
  const deployment = deployments.deployments[0];
  if (!deployment) {
    throw new WorkspaceError("Deploy cloud LangSmith não gerou registro local.", 500);
  }
  return {
    format: LANGSMITH_CLOUD_DEPLOY_AUTOMATION_RESULT_FORMAT,
    flowId,
    deployment,
    deployments,
    automation: {
      statusCode: fetched.statusCode,
      requestedAt,
      responseHash,
    },
    status: buildLangSmithCloudDeploymentAutomationStatus(config, {
      lastTriggeredAt: requestedAt,
      statusCode: fetched.statusCode,
      error: null,
    }),
    governance: {
      localFirstOptional: true,
      excludesSecretValues: true,
      sendsHandoffPackage: true,
      sendsDeploymentRecords: true,
      sendsCloudTokens: false,
      sendsRawPayloads: false,
      deployAuthTokenInHeaderOnly: true,
      deployAuthTokenInBody: false,
    },
  };
}

export async function syncCentralLangSmithCloudDeployments(
  workspaceRoot: string,
  flowId: string,
): Promise<LangSmithCloudDeploymentsCentralSyncResult> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const loaded = await loadFlowById(root, flowId);
  const config = langSmithCloudDeploymentsCentralConfig();
  if (config.invalidReason) {
    throw new WorkspaceError(`Configuração da central de deploy LangSmith inválida: ${config.invalidReason}`, 422);
  }
  if (!config.url) {
    throw new WorkspaceError("Central de deploy LangSmith não configurada.", 400);
  }

  const existing = await loadLangSmithCloudDeployments(root, flowId);
  const fetched = await fetchCentralLangSmithCloudDeploymentsSync(config, flowId, existing);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fetched.body) as unknown;
  } catch (error) {
    throw new WorkspaceError("Resposta central de deploy LangSmith não é JSON válido.", 502, error);
  }
  const deploymentPath = langSmithCloudDeploymentsPath(loaded.flowRoot);
  const centralPackagePayload = isRecord(parsed) && isRecord(parsed.deploymentsPackage)
    ? parsed.deploymentsPackage
    : isRecord(parsed) && isRecord(parsed.deployments) && parsed.deployments.format === "agent-flow-builder.langsmith-cloud-deployments.v1"
      ? parsed.deployments
      : parsed;
  const incoming = parseLangSmithCloudDeploymentsPackage(
    centralPackagePayload,
    root,
    loaded,
    existing.flowHash,
    deploymentPath,
  );
  if (!incoming) {
    throw new WorkspaceError("Resposta central de deploy LangSmith não respeita o formato esperado.", 502);
  }

  const now = new Date().toISOString();
  const deployments = mergeLangSmithCloudDeploymentRecords(existing.deployments, incoming.deployments);
  const next: LangSmithCloudDeploymentsPackage = {
    format: "agent-flow-builder.langsmith-cloud-deployments.v1",
    flowId: loaded.flow.id,
    flowName: loaded.flow.name,
    flowVersion: loaded.flow.version,
    flowHash: existing.flowHash,
    deploymentPath: toWorkspaceRelative(root, deploymentPath),
    updatedAt: now,
    deploymentCount: deployments.length,
    latestStatus: deployments[0]?.status ?? "none",
    deployments,
    governance: {
      localFirstOptional: true,
      doesNotCallCloud: true,
      cloudTokenNotStored: true,
      includesSecrets: false,
      includesEnvValues: false,
      includesRawPayloads: false,
    },
  };
  await mkdir(path.dirname(deploymentPath), { recursive: true });
  await writeFile(deploymentPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");

  return {
    format: LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_SYNC_RESULT_FORMAT,
    flowId,
    deployments: next,
    central: buildLangSmithCloudDeploymentsCentralStatus(config, {
      lastSyncedAt: now,
      statusCode: fetched.statusCode,
      pushedDeploymentCount: existing.deploymentCount,
      pulledDeploymentCount: incoming.deploymentCount,
      error: null,
    }),
    pushedDeploymentCount: existing.deploymentCount,
    pulledDeploymentCount: incoming.deploymentCount,
    governance: {
      localFirstOptional: true,
      excludesSecretValues: true,
      sendsDeploymentRecords: true,
      sendsCloudTokens: false,
      sendsRawPayloads: false,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  };
}

export async function recordLangSmithCloudDeployment(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<LangSmithCloudDeploymentsPackage> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const loaded = await loadFlowById(root, flowId);
  const handoff = await generateLangSmithCloudHandoff(root, loaded.flow.id);
  if (handoff.status !== "ready" || !handoff.approval.ready) {
    throw new WorkspaceError("Gere, teste e aprove o sandbox antes de registrar deploy cloud opcional.", 409, handoff);
  }
  const body = isRecord(payload) ? payload : {};
  const recordedRole = normalizeLangSmithCloudDeploymentRecorderRole(body.recordedRole ?? body.role);
  if (recordedRole === "viewer") {
    throw new WorkspaceError("Viewer não pode registrar evidência de deploy cloud.", 403, {
      code: "langsmith_cloud_deployment_viewer_forbidden",
      role: recordedRole,
      requiredRole: "reviewer",
    });
  }

  const now = new Date().toISOString();
  const deploymentPath = langSmithCloudDeploymentsPath(loaded.flowRoot);
  const current = await loadLangSmithCloudDeployments(root, loaded.flow.id);
  const status = normalizeLangSmithCloudDeploymentStatus(body.status);
  const deploymentName = sanitizeCompactText(body.deploymentName ?? body.name, 120) || "LangSmith/LangGraph Cloud";
  const environment = sanitizeCompactText(body.environment, 80) || "cloud";
  const cloudProject = sanitizeCompactText(body.cloudProject ?? body.project, 160);
  const externalDeploymentId = sanitizeCompactText(body.externalDeploymentId ?? body.deploymentId, 160);
  const deploymentUrl = sanitizeExternalCloudUrl(body.deploymentUrl ?? body.url);
  const traceUrl = sanitizeExternalCloudUrl(body.traceUrl);
  const note = sanitizeCompactText(body.note, 300);
  const automation = parseLangSmithCloudDeploymentAutomation(body.automation);
  const verifiedAtCandidate = sanitizeCompactText(body.verifiedAt, 80);
  const verifiedAt = status === "verified"
    ? verifiedAtCandidate || now
    : verifiedAtCandidate;
  const recordedBy = sanitizeCompactText(body.recordedBy ?? body.actorId ?? body.reviewer, 120) || "local-studio";
  const id = `langsmith-deploy-${createHash("sha256")
    .update([loaded.flow.id, handoff.flowHash, now, deploymentName, deploymentUrl ?? externalDeploymentId ?? ""].join("\n"))
    .digest("hex")
    .slice(0, 16)}`;
  const record: LangSmithCloudDeploymentRecord = {
    id,
    status,
    flowId: loaded.flow.id,
    flowName: loaded.flow.name,
    flowVersion: loaded.flow.version,
    flowHash: handoff.flowHash,
    handoffPackageHash: handoff.packageHash,
    sandboxOutDir: handoff.sandbox.outDir,
    approvalPath: handoff.approval.approvalPath,
    deploymentName,
    environment,
    ...(cloudProject ? { cloudProject } : {}),
    ...(externalDeploymentId ? { externalDeploymentId } : {}),
    ...(deploymentUrl ? { deploymentUrl } : {}),
    ...(traceUrl ? { traceUrl } : {}),
    ...(note ? { note } : {}),
    recordedBy,
    recordedRole,
    recordedAt: now,
    ...(verifiedAt ? { verifiedAt } : {}),
    ...(automation ? { automation } : {}),
    governance: {
      localFirstOptional: true,
      doesNotCallCloud: true,
      cloudTokenNotStored: true,
      includesSecrets: false,
      includesEnvValues: false,
      includesRawPayloads: false,
      sanitizedExternalUrls: true,
    },
  };
  const deployments = [record, ...current.deployments]
    .filter((item, index, list) => list.findIndex((candidate) => candidate.id === item.id) === index)
    .slice(0, 50);
  const next: LangSmithCloudDeploymentsPackage = {
    format: "agent-flow-builder.langsmith-cloud-deployments.v1",
    flowId: loaded.flow.id,
    flowName: loaded.flow.name,
    flowVersion: loaded.flow.version,
    flowHash: handoff.flowHash,
    deploymentPath: toWorkspaceRelative(root, deploymentPath),
    updatedAt: now,
    deploymentCount: deployments.length,
    latestStatus: deployments[0]?.status ?? "none",
    deployments,
    governance: {
      localFirstOptional: true,
      doesNotCallCloud: true,
      cloudTokenNotStored: true,
      includesSecrets: false,
      includesEnvValues: false,
      includesRawPayloads: false,
    },
  };
  await mkdir(path.dirname(deploymentPath), { recursive: true });
  await writeFile(deploymentPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
  return next;
}

export async function generateApprovedRuntime(
  workspaceRoot: string,
  flowId: string,
  requestedOutDir?: string,
): Promise<ApprovedGenerateResult> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const loaded = await loadFlowById(root, flowId);
  const status = await readLangGraphSandboxApprovalStatus(root, flowId);
  if (status.status !== "approved") {
    throw approvalStatusToWorkspaceError(status);
  }
  const approval = status as LangGraphSandboxApproval;
  const result = await generateRuntime(root, flowId, requestedOutDir);
  await writeFile(
    path.join(result.absoluteOutDir, ".agent-flow", "langgraph-sandbox-approval.json"),
    `${JSON.stringify(approval, null, 2)}\n`,
    "utf-8",
  );
  return { ...result, approval };
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

export async function generateApprovedRuntimeManifest(
  workspaceRoot: string,
  requestedOutDir?: string,
): Promise<ApprovedManifestGenerateResult> {
  const root = normalizeWorkspaceRoot(workspaceRoot);
  const loaded = await loadRuntimeManifest(root);
  const agents = await resolveManifestAgents(root, loaded.manifest);
  const approvals: LangGraphSandboxApproval[] = [];
  for (const agent of agents) {
    const status = await readLangGraphSandboxApprovalStatus(root, agent.id);
    if (status.status !== "approved") {
      const approvalError = approvalStatusToWorkspaceError(status);
      throw new WorkspaceError(
        `Agente ${agent.id} ainda não possui sandbox aprovado para gerar o bundle final: ${status.reason}`,
        approvalError.statusCode,
        status,
      );
    }
    approvals.push(status as LangGraphSandboxApproval);
  }

  const result = await generateRuntimeManifest(root, requestedOutDir);
  const approvalPackage = {
    format: "agent-flow-builder.runtime-manifest-approval.v1",
    status: "approved",
    manifestId: loaded.manifest.id,
    manifestName: loaded.manifest.name,
    manifestVersion: loaded.manifest.version,
    approvedFor: "runtime-manifest-bundle",
    approvedAt: new Date().toISOString(),
    approvalCount: approvals.length,
    approvals,
  };
  const rootApprovalPath = path.join(result.absoluteOutDir, ".agent-flow", "langgraph-sandbox-approval.json");
  await writeFile(rootApprovalPath, `${JSON.stringify(approvalPackage, null, 2)}\n`, "utf-8");

  for (const approval of approvals) {
    await writeFile(
      path.join(result.absoluteOutDir, "agents", safeRuntimeSegment(approval.flowId), ".agent-flow", "langgraph-sandbox-approval.json"),
      `${JSON.stringify(approval, null, 2)}\n`,
      "utf-8",
    );
  }

  return {
    ...result,
    approvalPackagePath: ".agent-flow/langgraph-sandbox-approval.json",
    approvals,
  };
}

function buildLangSmithCloudHandoffCommands(flowPath: string, sandboxOutDir: string): LangSmithCloudHandoffCommand[] {
  return [
    {
      id: "generate_sandbox_cli",
      label: "Gerar sandbox por CLI",
      command: `npx tsx packages/codegen-langgraph/src/sandbox-cli.ts --flow ${flowPath} --out ${sandboxOutDir}`,
      detail: "Equivalente ao botão LangGraph do Studio para reproduzir o pacote em linha de comando.",
    },
    {
      id: "run_langgraph_dev",
      label: "Rodar sandbox local",
      command: "langgraph dev",
      detail: `Execute dentro de ${sandboxOutDir} para testar manualmente antes de qualquer publicação opcional.`,
    },
    {
      id: "cloud_import",
      label: "Importar na cloud",
      command: null,
      detail: "Opcional: importe o pacote no projeto LangSmith/LangGraph Cloud do operador. O Studio não chama a cloud nem salva token.",
    },
    {
      id: "record_approval",
      label: "Registrar aprovação",
      command: null,
      detail: "Volte ao Studio, confira runs/eventos e registre a aprovação sanitizada por hash.",
    },
  ];
}

function langSmithCloudDeploymentsPath(flowRoot: string): string {
  return path.join(flowRoot, ".agent-flow", "langsmith-cloud-deployments.aflangsmithdeployments.json");
}

function emptyLangSmithCloudDeploymentsPackage(
  root: string,
  loaded: LoadedFlow,
  flowHash: string,
  deploymentPath: string,
): LangSmithCloudDeploymentsPackage {
  return {
    format: "agent-flow-builder.langsmith-cloud-deployments.v1",
    flowId: loaded.flow.id,
    flowName: loaded.flow.name,
    flowVersion: loaded.flow.version,
    flowHash,
    deploymentPath: toWorkspaceRelative(root, deploymentPath),
    updatedAt: "",
    deploymentCount: 0,
    latestStatus: "none",
    deployments: [],
    governance: {
      localFirstOptional: true,
      doesNotCallCloud: true,
      cloudTokenNotStored: true,
      includesSecrets: false,
      includesEnvValues: false,
      includesRawPayloads: false,
    },
  };
}

function parseLangSmithCloudDeploymentsPackage(
  value: unknown,
  root: string,
  loaded: LoadedFlow,
  flowHash: string,
  deploymentPath: string,
): LangSmithCloudDeploymentsPackage | null {
  if (!isRecord(value) || value.format !== "agent-flow-builder.langsmith-cloud-deployments.v1") {
    return null;
  }
  const deployments = Array.isArray(value.deployments)
    ? value.deployments.map(parseLangSmithCloudDeploymentRecord).filter((item): item is LangSmithCloudDeploymentRecord => Boolean(item))
    : [];
  return {
    format: "agent-flow-builder.langsmith-cloud-deployments.v1",
    flowId: loaded.flow.id,
    flowName: loaded.flow.name,
    flowVersion: loaded.flow.version,
    flowHash,
    deploymentPath: toWorkspaceRelative(root, deploymentPath),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
    deploymentCount: deployments.length,
    latestStatus: deployments[0]?.status ?? "none",
    deployments,
    governance: {
      localFirstOptional: true,
      doesNotCallCloud: true,
      cloudTokenNotStored: true,
      includesSecrets: false,
      includesEnvValues: false,
      includesRawPayloads: false,
    },
  };
}

function parseLangSmithCloudDeploymentRecord(value: unknown): LangSmithCloudDeploymentRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = sanitizeCompactText(value.id, 120);
  const flowId = sanitizeCompactText(value.flowId, 120);
  const flowName = sanitizeCompactText(value.flowName, 160);
  const flowVersion = sanitizeCompactText(value.flowVersion, 80);
  const flowHash = sanitizeCompactText(value.flowHash, 80);
  const handoffPackageHash = sanitizeCompactText(value.handoffPackageHash, 80);
  const sandboxOutDir = sanitizeCompactText(value.sandboxOutDir, 240);
  const approvalPath = sanitizeCompactText(value.approvalPath, 240);
  const deploymentName = sanitizeCompactText(value.deploymentName, 120);
  if (!id || !flowId || !flowName || !flowVersion || !flowHash || !handoffPackageHash || !sandboxOutDir || !approvalPath || !deploymentName) {
    return null;
  }
  const status = normalizeLangSmithCloudDeploymentStatus(value.status);
  const recordedRole = normalizeLangSmithCloudDeploymentRecorderRole(value.recordedRole ?? value.role);
  return {
    id,
    status,
    flowId,
    flowName,
    flowVersion,
    flowHash,
    handoffPackageHash,
    sandboxOutDir,
    approvalPath,
    deploymentName,
    environment: sanitizeCompactText(value.environment, 80) || "cloud",
    ...(sanitizeCompactText(value.cloudProject, 160) ? { cloudProject: sanitizeCompactText(value.cloudProject, 160)! } : {}),
    ...(sanitizeCompactText(value.externalDeploymentId, 160) ? { externalDeploymentId: sanitizeCompactText(value.externalDeploymentId, 160)! } : {}),
    ...(sanitizeExternalCloudUrl(value.deploymentUrl) ? { deploymentUrl: sanitizeExternalCloudUrl(value.deploymentUrl)! } : {}),
    ...(sanitizeExternalCloudUrl(value.traceUrl) ? { traceUrl: sanitizeExternalCloudUrl(value.traceUrl)! } : {}),
    ...(sanitizeCompactText(value.note, 300) ? { note: sanitizeCompactText(value.note, 300)! } : {}),
    recordedBy: sanitizeCompactText(value.recordedBy, 120) || "local-studio",
    recordedRole,
    recordedAt: sanitizeCompactText(value.recordedAt, 80) || "",
    ...(sanitizeCompactText(value.verifiedAt, 80) ? { verifiedAt: sanitizeCompactText(value.verifiedAt, 80)! } : {}),
    ...(parseLangSmithCloudDeploymentAutomation(value.automation) ? { automation: parseLangSmithCloudDeploymentAutomation(value.automation)! } : {}),
    governance: {
      localFirstOptional: true,
      doesNotCallCloud: true,
      cloudTokenNotStored: true,
      includesSecrets: false,
      includesEnvValues: false,
      includesRawPayloads: false,
      sanitizedExternalUrls: true,
    },
  };
}

interface LangSmithCloudDeploymentAutomationConfig {
  url: string | null;
  token: string | null;
  timeoutMs: number;
  invalidReason: string | null;
}

function langSmithCloudDeploymentAutomationConfig(): LangSmithCloudDeploymentAutomationConfig {
  const errors: string[] = [];
  const configuredUrl = (process.env[LANGSMITH_CLOUD_DEPLOY_AUTOMATION_URL_ENV] ?? "").trim();
  let url: string | null = null;
  if (configuredUrl) {
    try {
      url = validateLangSmithCloudDeploymentAutomationUrl(configuredUrl);
    } catch (error) {
      errors.push(errorMessage(error));
    }
  }

  let timeoutMs = LANGSMITH_CLOUD_DEPLOY_AUTOMATION_TIMEOUT_MS;
  const configuredTimeout = (process.env[LANGSMITH_CLOUD_DEPLOY_AUTOMATION_TIMEOUT_ENV] ?? "").trim();
  if (configuredTimeout) {
    const parsed = Number(configuredTimeout);
    if (!Number.isInteger(parsed) || parsed < 100 || parsed > 120_000) {
      errors.push(`${LANGSMITH_CLOUD_DEPLOY_AUTOMATION_TIMEOUT_ENV} deve ser inteiro entre 100 e 120000.`);
    } else {
      timeoutMs = parsed;
    }
  }

  return {
    url,
    token: (process.env[LANGSMITH_CLOUD_DEPLOY_AUTOMATION_TOKEN_ENV] ?? "").trim() || null,
    timeoutMs,
    invalidReason: errors.length ? errors.join(" ") : null,
  };
}

function buildLangSmithCloudDeploymentAutomationStatus(
  config: LangSmithCloudDeploymentAutomationConfig,
  trigger?: Pick<LangSmithCloudDeploymentAutomationStatus, "lastTriggeredAt" | "statusCode" | "error">,
): LangSmithCloudDeploymentAutomationStatus {
  return {
    format: LANGSMITH_CLOUD_DEPLOY_AUTOMATION_STATUS_FORMAT,
    generatedAt: new Date().toISOString(),
    configured: Boolean(config.url && !config.invalidReason),
    urlConfigured: Boolean(config.url),
    tokenConfigured: Boolean(config.token),
    timeoutMs: config.timeoutMs,
    invalidReason: config.invalidReason,
    lastTriggeredAt: trigger?.lastTriggeredAt ?? null,
    statusCode: trigger?.statusCode ?? null,
    error: trigger?.error ?? null,
    governance: {
      localFirstOptional: true,
      excludesSecretValues: true,
      sendsHandoffPackage: true,
      sendsDeploymentRecords: true,
      sendsCloudTokens: false,
      sendsRawPayloads: false,
      deployAuthTokenInHeaderOnly: true,
      deployAuthTokenInBody: false,
      storesDeployToken: false,
      configuredUrlEnv: LANGSMITH_CLOUD_DEPLOY_AUTOMATION_URL_ENV,
      configuredTokenEnv: LANGSMITH_CLOUD_DEPLOY_AUTOMATION_TOKEN_ENV,
      configuredTimeoutEnv: LANGSMITH_CLOUD_DEPLOY_AUTOMATION_TIMEOUT_ENV,
      maxPayloadBytes: LANGSMITH_CLOUD_DEPLOY_AUTOMATION_MAX_BYTES,
    },
  };
}

async function fetchLangSmithCloudDeploymentAutomation(
  config: LangSmithCloudDeploymentAutomationConfig,
  request: {
    flowId: string;
    requestedAt: string;
    requestedBy: string;
    requestedRole: LangSmithCloudDeploymentRecorderRole;
    deploymentName: string;
    environment: string;
    handoff: LangSmithCloudHandoffPackage;
    currentDeployments: LangSmithCloudDeploymentsPackage;
  },
): Promise<{ statusCode: number; body: string }> {
  if (!config.url) {
    throw new WorkspaceError("Endpoint de deploy cloud LangSmith não configurado.", 400);
  }
  const body = JSON.stringify({
    format: LANGSMITH_CLOUD_DEPLOY_AUTOMATION_REQUEST_FORMAT,
    generatedAt: request.requestedAt,
    flowId: request.flowId,
    requestedBy: request.requestedBy,
    requestedRole: request.requestedRole,
    deploymentName: request.deploymentName,
    environment: request.environment,
    handoff: request.handoff,
    currentDeployments: request.currentDeployments,
    governance: {
      localFirstOptional: true,
      excludesSecretValues: true,
      sendsHandoffPackage: true,
      sendsDeploymentRecords: true,
      sendsCloudTokens: false,
      sendsRawPayloads: false,
      deployAuthTokenInHeaderOnly: true,
      deployAuthTokenInBody: false,
    },
  });
  if (Buffer.byteLength(body, "utf-8") > LANGSMITH_CLOUD_DEPLOY_AUTOMATION_MAX_BYTES) {
    throw new WorkspaceError("Payload de deploy cloud LangSmith excede o limite permitido.", 413);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
    };
    if (config.token) {
      headers.authorization = `Bearer ${config.token}`;
    }
    const response = await fetch(config.url, {
      method: "POST",
      signal: controller.signal,
      headers,
      body,
      redirect: "follow",
    });
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > LANGSMITH_CLOUD_DEPLOY_AUTOMATION_MAX_BYTES) {
      throw new WorkspaceError("Resposta de deploy cloud LangSmith excede o limite permitido.", 413);
    }
    if (!response.ok) {
      throw new WorkspaceError(`Endpoint de deploy cloud LangSmith respondeu HTTP ${response.status}.`, response.status);
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > LANGSMITH_CLOUD_DEPLOY_AUTOMATION_MAX_BYTES) {
      throw new WorkspaceError("Resposta de deploy cloud LangSmith excede o limite permitido.", 413);
    }
    return {
      statusCode: response.status,
      body: Buffer.from(buffer).toString("utf-8"),
    };
  } catch (error) {
    if (isRecord(error) && error.name === "AbortError") {
      throw new WorkspaceError("Timeout ao disparar deploy cloud LangSmith.", 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildLangSmithCloudDeploymentPayloadFromAutomationResponse(
  value: unknown,
  fallback: {
    requestedDeploymentName: string;
    requestedEnvironment: string;
    recordedBy: string;
    recordedRole: LangSmithCloudDeploymentRecorderRole;
    requestedAt: string;
    statusCode: number;
    responseHash: string;
  },
): Record<string, unknown> {
  const response = isRecord(value) ? value : {};
  const responseNote = sanitizeCompactText(response.note ?? response.message ?? response.summary, 220);
  const automationNote = responseNote
    ? `Deploy automatizado: ${responseNote}`
    : "Deploy cloud automatizado pelo Builder via endpoint configurado.";
  return {
    status: normalizeLangSmithCloudDeploymentStatus(response.status),
    deploymentName: sanitizeCompactText(response.deploymentName ?? response.name, 120) || fallback.requestedDeploymentName,
    environment: sanitizeCompactText(response.environment, 80) || fallback.requestedEnvironment,
    cloudProject: sanitizeCompactText(response.cloudProject ?? response.project, 160),
    externalDeploymentId: sanitizeCompactText(response.externalDeploymentId ?? response.deploymentId ?? response.id, 160),
    deploymentUrl: sanitizeExternalCloudUrl(response.deploymentUrl ?? response.url),
    traceUrl: sanitizeExternalCloudUrl(response.traceUrl),
    note: automationNote,
    recordedBy: fallback.recordedBy,
    recordedRole: fallback.recordedRole,
    verifiedAt: sanitizeCompactText(response.verifiedAt, 80),
    automation: {
      source: "configured_endpoint",
      statusCode: fallback.statusCode,
      requestedAt: fallback.requestedAt,
      responseHash: fallback.responseHash,
      endpointConfiguredEnv: LANGSMITH_CLOUD_DEPLOY_AUTOMATION_URL_ENV,
      tokenInHeaderOnly: true,
    },
  };
}

function parseLangSmithCloudDeploymentAutomation(value: unknown): LangSmithCloudDeploymentAutomationEvidence | null {
  if (!isRecord(value) || value.source !== "configured_endpoint") {
    return null;
  }
  const statusCode = typeof value.statusCode === "number" && Number.isInteger(value.statusCode)
    ? value.statusCode
    : null;
  const requestedAt = sanitizeCompactText(value.requestedAt, 80);
  const responseHash = sanitizeCompactText(value.responseHash, 80);
  if (statusCode === null || !requestedAt || !responseHash) {
    return null;
  }
  return {
    source: "configured_endpoint",
    statusCode,
    requestedAt,
    responseHash,
    endpointConfiguredEnv: LANGSMITH_CLOUD_DEPLOY_AUTOMATION_URL_ENV,
    tokenInHeaderOnly: true,
  };
}

interface LangSmithCloudDeploymentsCentralConfig {
  url: string | null;
  token: string | null;
  timeoutMs: number;
  invalidReason: string | null;
}

function langSmithCloudDeploymentsCentralConfig(): LangSmithCloudDeploymentsCentralConfig {
  const errors: string[] = [];
  const configuredUrl = (process.env[LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_URL_ENV] ?? "").trim();
  let url: string | null = null;
  if (configuredUrl) {
    try {
      url = validateLangSmithCloudDeploymentsCentralUrl(configuredUrl);
    } catch (error) {
      errors.push(errorMessage(error));
    }
  }

  let timeoutMs = LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_TIMEOUT_MS;
  const configuredTimeout = (process.env[LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_TIMEOUT_ENV] ?? "").trim();
  if (configuredTimeout) {
    const parsed = Number(configuredTimeout);
    if (!Number.isInteger(parsed) || parsed < 100 || parsed > 60_000) {
      errors.push(`${LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_TIMEOUT_ENV} deve ser inteiro entre 100 e 60000.`);
    } else {
      timeoutMs = parsed;
    }
  }

  return {
    url,
    token: (process.env[LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_TOKEN_ENV] ?? "").trim() || null,
    timeoutMs,
    invalidReason: errors.length ? errors.join(" ") : null,
  };
}

function buildLangSmithCloudDeploymentsCentralStatus(
  config: LangSmithCloudDeploymentsCentralConfig,
  sync?: Pick<
    LangSmithCloudDeploymentsCentralStatus,
    "lastSyncedAt" | "statusCode" | "pushedDeploymentCount" | "pulledDeploymentCount" | "error"
  >,
): LangSmithCloudDeploymentsCentralStatus {
  return {
    format: LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_STATUS_FORMAT,
    generatedAt: new Date().toISOString(),
    configured: Boolean(config.url && !config.invalidReason),
    urlConfigured: Boolean(config.url),
    tokenConfigured: Boolean(config.token),
    timeoutMs: config.timeoutMs,
    invalidReason: config.invalidReason,
    lastSyncedAt: sync?.lastSyncedAt ?? null,
    statusCode: sync?.statusCode ?? null,
    pushedDeploymentCount: sync?.pushedDeploymentCount ?? null,
    pulledDeploymentCount: sync?.pulledDeploymentCount ?? null,
    error: sync?.error ?? null,
    governance: {
      localFirstOptional: true,
      excludesSecretValues: true,
      sendsDeploymentRecords: true,
      sendsCloudTokens: false,
      sendsRawPayloads: false,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
      storesCentralToken: false,
      configuredUrlEnv: LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_URL_ENV,
      configuredTokenEnv: LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_TOKEN_ENV,
      configuredTimeoutEnv: LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_TIMEOUT_ENV,
      maxPayloadBytes: LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_MAX_BYTES,
    },
  };
}

async function fetchCentralLangSmithCloudDeploymentsSync(
  config: LangSmithCloudDeploymentsCentralConfig,
  flowId: string,
  deployments: LangSmithCloudDeploymentsPackage,
): Promise<{ statusCode: number; body: string }> {
  if (!config.url) {
    throw new WorkspaceError("Central de deploy LangSmith não configurada.", 400);
  }
  const body = JSON.stringify({
    format: LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_SYNC_REQUEST_FORMAT,
    generatedAt: new Date().toISOString(),
    flowId,
    deployments,
    deploymentCount: deployments.deploymentCount,
    governance: {
      localFirstOptional: true,
      excludesSecretValues: true,
      sendsDeploymentRecords: true,
      sendsCloudTokens: false,
      sendsRawPayloads: false,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  });
  if (Buffer.byteLength(body, "utf-8") > LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_MAX_BYTES) {
    throw new WorkspaceError("Registro de deploy LangSmith excede o limite de tamanho permitido para sync central.", 413);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const headers: Record<string, string> = {
      accept: "application/json",
      "content-type": "application/json",
    };
    if (config.token) {
      headers.authorization = `Bearer ${config.token}`;
    }
    const response = await fetch(config.url, {
      method: "POST",
      signal: controller.signal,
      headers,
      body,
      redirect: "follow",
    });
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central de deploy LangSmith excede o limite de tamanho permitido.", 413);
    }
    if (!response.ok) {
      throw new WorkspaceError(`Central de deploy LangSmith respondeu HTTP ${response.status}.`, response.status);
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central de deploy LangSmith excede o limite de tamanho permitido.", 413);
    }
    return {
      statusCode: response.status,
      body: Buffer.from(buffer).toString("utf-8"),
    };
  } catch (error) {
    if (isRecord(error) && error.name === "AbortError") {
      throw new WorkspaceError("Timeout ao sincronizar central de deploy LangSmith.", 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function mergeLangSmithCloudDeploymentRecords(
  existing: LangSmithCloudDeploymentRecord[],
  incoming: LangSmithCloudDeploymentRecord[],
): LangSmithCloudDeploymentRecord[] {
  const byId = new Map<string, LangSmithCloudDeploymentRecord>();
  for (const record of existing) {
    byId.set(record.id, record);
  }
  for (const record of incoming) {
    const current = byId.get(record.id);
    if (!current || langSmithCloudDeploymentTimestamp(record) > langSmithCloudDeploymentTimestamp(current)) {
      byId.set(record.id, record);
    }
  }
  return Array.from(byId.values())
    .sort((left, right) => {
      const timeDelta = langSmithCloudDeploymentTimestamp(right) - langSmithCloudDeploymentTimestamp(left);
      return timeDelta || right.id.localeCompare(left.id);
    })
    .slice(0, 50);
}

function langSmithCloudDeploymentTimestamp(record: LangSmithCloudDeploymentRecord): number {
  const candidates = [record.verifiedAt, record.recordedAt].filter((value): value is string => Boolean(value));
  for (const value of candidates) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function validateLangSmithCloudDeploymentsCentralUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WorkspaceError(`${LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_URL_ENV} deve ser uma URL HTTP/HTTPS válida.`, 422);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WorkspaceError(`${LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_URL_ENV} deve usar http ou https.`, 422);
  }
  if (url.username || url.password) {
    throw new WorkspaceError(`${LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_URL_ENV} não pode conter usuário ou senha.`, 422);
  }
  return url.toString();
}

function validateLangSmithCloudDeploymentAutomationUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WorkspaceError(`${LANGSMITH_CLOUD_DEPLOY_AUTOMATION_URL_ENV} deve ser uma URL HTTP/HTTPS válida.`, 422);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WorkspaceError(`${LANGSMITH_CLOUD_DEPLOY_AUTOMATION_URL_ENV} deve usar http ou https.`, 422);
  }
  if (url.username || url.password) {
    throw new WorkspaceError(`${LANGSMITH_CLOUD_DEPLOY_AUTOMATION_URL_ENV} não pode conter usuário ou senha.`, 422);
  }
  return url.toString();
}

function normalizeLangSmithCloudDeploymentStatus(value: unknown): LangSmithCloudDeploymentStatus {
  return value === "prepared" || value === "deployed" || value === "verified" || value === "failed"
    ? value
    : "deployed";
}

function normalizeLangSmithCloudDeploymentRecorderRole(value: unknown): LangSmithCloudDeploymentRecorderRole {
  return value === "owner" || value === "operator" || value === "reviewer" || value === "viewer"
    ? value
    : "reviewer";
}

function sanitizeCompactText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function sanitizeExternalCloudUrl(value: unknown): string | undefined {
  const text = sanitizeCompactText(value, 500);
  if (!text) {
    return undefined;
  }
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return undefined;
    }
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().slice(0, 300);
  } catch {
    return text.replace(/[?#].*$/, "").slice(0, 240);
  }
}

async function readGeneratedProjectMetadata(absoluteOutDir: string): Promise<GeneratedProjectMetadata> {
  const metadataPath = path.join(absoluteOutDir, ".agent-flow", "generated-meta.json");
  let raw: string;
  try {
    raw = await readFile(metadataPath, "utf-8");
  } catch (error) {
    throw new WorkspaceError(
      "Gere o pacote LangGraph sandbox antes de aprovar essa versão do flow.",
      409,
      error instanceof Error ? error.message : error,
    );
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("metadata não é objeto");
    }
    return parsed as GeneratedProjectMetadata;
  } catch (error) {
    throw new WorkspaceError(
      "O metadado do artefato gerado não é JSON válido.",
      422,
      error instanceof Error ? error.message : error,
    );
  }
}

async function readCurrentLangGraphApproval(
  root: string,
  loaded: LoadedFlow,
): Promise<LangGraphSandboxApproval> {
  const status = await readLangGraphSandboxApprovalStatus(root, loaded.flow.id);
  if (status.status !== "approved") {
    throw approvalStatusToWorkspaceError(status);
  }
  return {
    status: "approved",
    flowId: status.flowId,
    flowVersion: status.flowVersion,
    flowHash: status.flowHash,
    sandboxOutDir: status.sandboxOutDir!,
    approvedFor: status.approvedFor ?? "fastapi-runtime",
    approvalPath: status.approvalPath,
    approvedAt: status.approvedAt ?? "",
    ...(status.evidence ? { evidence: status.evidence } : {}),
  };
}

function parseLangGraphSandboxApproval(value: unknown): LangGraphSandboxApproval | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.status !== "approved") {
    return null;
  }
  if (typeof value.flowId !== "string" || typeof value.flowVersion !== "string" || typeof value.flowHash !== "string") {
    return null;
  }
  if (typeof value.sandboxOutDir !== "string" || typeof value.approvalPath !== "string") {
    return null;
  }
  if (typeof value.approvedFor !== "string" || value.approvedFor !== "fastapi-runtime") {
    return null;
  }
  if (typeof value.approvedAt !== "string") {
    return null;
  }
  const evidence = parseLangGraphSandboxApprovalEvidence(value.evidence);
  return {
    status: "approved",
    flowId: value.flowId,
    flowVersion: value.flowVersion,
    flowHash: value.flowHash,
    sandboxOutDir: value.sandboxOutDir,
    approvedFor: value.approvedFor,
    approvalPath: value.approvalPath,
    approvedAt: value.approvedAt,
    ...(evidence ? { evidence } : {}),
  };
}

function parseLangGraphSandboxApprovalEvidence(value: unknown): LangGraphSandboxApprovalEvidence | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const source = value.source === "studio" || value.source === "api" ? value.source : "api";
  const capturedAt = typeof value.capturedAt === "string" && value.capturedAt.trim()
    ? value.capturedAt
    : new Date().toISOString();
  const evidence: LangGraphSandboxApprovalEvidence = {
    source,
    capturedAt,
    excludesRawPayloads: true,
    excludesSecretValues: true,
  };
  for (const key of ["runId", "sessionId", "agentId", "selectedEventType", "selectedNodeId", "failedNodeId", "latestEventType"] as const) {
    const fieldValue = value[key];
    if (typeof fieldValue === "string" && fieldValue.trim()) {
      evidence[key] = fieldValue.trim().slice(0, 160);
    }
  }
  for (const key of ["eventCount", "visibleEventCount", "selectedEventSeq", "latestEventSeq"] as const) {
    const fieldValue = value[key];
    if (typeof fieldValue === "number" && Number.isFinite(fieldValue) && fieldValue >= 0) {
      evidence[key] = Math.floor(fieldValue);
    }
  }
  return evidence;
}

function approvalStatusToWorkspaceError(status: LangGraphSandboxApprovalStatus): WorkspaceError {
  if (status.status === "approved") {
    return new WorkspaceError("Aprovação LangGraph inválida para esta operação.", 409, status);
  }
  if (status.status === "missing") {
    return new WorkspaceError(
      "Aprove o sandbox LangSmith/LangGraph desta versão antes de gerar o runtime FastAPI/Docker aprovado.",
      409,
      status,
    );
  }
  if (status.status === "invalid") {
    return new WorkspaceError(
      "A aprovação LangSmith/LangGraph está inválida para esta versão. Corrija ou gere e aprove novamente.",
      409,
      status,
    );
  }
  return new WorkspaceError(
    "A aprovação LangSmith/LangGraph está desatualizada para o flow atual. Gere, teste e aprove novamente.",
    409,
    status,
  );
}
