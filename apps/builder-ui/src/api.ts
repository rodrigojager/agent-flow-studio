import type {
  ApprovedGenerateResult,
  CreatedFlowWorkspace,
  EventView,
  FlowAssetContent,
  FlowAssetDeleteResult,
  FlowAssetMutationResult,
  FlowSummary,
  FlowWorkspaceExport,
  FlowWorkspaceImportResult,
  GenerateResult,
  LangGraphSandboxApproval,
  LangGraphSandboxApprovalEvidence,
  LangSmithCloudDeploymentAutomationStatus,
  LangSmithCloudDeploymentAutomationResult,
  LangSmithCloudDeploymentsPackage,
  LangSmithCloudDeploymentsCentralStatus,
  LangSmithCloudDeploymentsCentralSyncResult,
  LangSmithCloudHandoff,
  LangSmithCloudDeploymentStatus,
  DockerRuntimeOperationResult,
  DockerRuntimeHistory,
  DockerRuntimeHistoryQuery,
  DockerRuntimeModelExecutionProfile,
  DockerRuntimePortUpdate,
  DockerRuntimeStatus,
  ModelImageCatalog,
  ModelImageCatalogCentralStatus,
  ModelImageCatalogDiscoveryResult,
  ModelImageCatalogMergeResult,
  ModelImageCatalogRemoteRegistryResult,
  ModelImageCatalogRegisterResult,
  ModelImageCatalogSyncCentralResult,
  ModelImageCatalogSyncDiscoveredResult,
  ModelImageCatalogSyncRemoteResult,
  ModelImageRemoteRegistry,
  ModelImageRemoteRegistrySaveResult,
  ExternalEvaluatorRequest,
  ExternalEvaluatorResult,
  GeneratedArtifactFileContent,
  GeneratedArtifactListing,
  AgentFlow,
  BuilderAuthAuditQuery,
  BuilderAuthAuditReport,
  BuilderAuthCorporateHomologationResult,
  BuilderAuthExternalProbeResult,
  BuilderAuthKeyRotationResult,
  CollaborationConflictFilters,
  CollaborationConflictOverviewDiffPackage,
  CollaborationConflictOverview,
  BuilderAuthOidcLoginResult,
  BuilderAuthOidcLogoutResult,
  BuilderAuthSessionLogoutResult,
  BuilderAuthSessionResult,
  BuilderAuthStatus,
  LocalCatalog,
  LocalCatalogCentralSyncResult,
  LocalCatalogCentralSyncStatus,
  LocalCatalogConflictReviewDiffPackage,
  LocalCatalogConflictReviewPackage,
  LocalCatalogCreateFlowResult,
  LocalCatalogApplyResult,
  LocalCatalogItemPackage,
  LocalCatalogItemKind,
  LocalCatalogLibraryConflictCuratorRole,
  LocalCatalogLibraryConflictResolution,
  LocalCatalogSaveResult,
  LocalCatalogSharedLibraryPackage,
  LocalCatalogSharedSyncResult,
  LlmAdapterCatalogResult,
  LocalLlmProviderStatus,
  LoadedFlow,
  LangGraphSandboxApprovalStatus,
  MessageView,
  LoadedRuntimeManifest,
  RuntimeJobBatchResponse,
  RuntimeJobCleanupResponse,
  RuntimeJobMetrics,
  RuntimeJobRunResponse,
  RuntimeJobScheduleBatchResponse,
  RuntimeJobScheduleResponse,
  RuntimeJobScheduleView,
  RuntimeJobView,
  RuntimeAuthAudit,
  RuntimeAuthKeys,
  RuntimeOrchestrationRunResult,
  RuntimeTurnResponse,
  RuntimeTurnStreamEvent,
  RuntimeTurnStreamToken,
  RuntimeManifest,
  RuntimeManifestGenerateResult,
  RuntimeManifestValidationResult,
  SandboxListResult,
  SandboxStatus,
  SessionView,
  StudioNodePinsPackage,
  StudioRunList,
  StudioRunRecord,
  StudioRunQuery,
  StudioRunComparison,
  StudioRunExport,
  StudioProviderTelemetryReport,
  StudioProviderTelemetryQuery,
  StudioSandboxTelemetryReport,
  StudioSandboxTelemetryQuery,
  ValidationResult,
  VmRunnerCheckResult,
  WorkspaceGovernanceAction,
  WorkspaceGovernanceDecision,
  WorkspaceGovernancePackage,
  FlowNode,
} from "./types.ts";

const DEFAULT_API_URL = "http://127.0.0.1:3333";
const BUILDER_API_KEY_STORAGE_KEY = "agent-flow-builder.builder-api-key.v1";
const BUILDER_AUTH_SESSION_STORAGE_KEY = "agent-flow-builder.builder-auth-session.v1";

type RuntimeTurnStreamHandlers = {
  onEvent?: (event: RuntimeTurnStreamEvent) => void;
  onToken?: (token: RuntimeTurnStreamToken) => void;
  onCompleted?: (response: RuntimeTurnResponse) => void;
  onClosed?: (payload: Record<string, unknown>) => void;
};

export function builderApiUrl(): string {
  return (window.__AGENT_FLOW_DESKTOP__?.apiUrl || import.meta.env.VITE_BUILDER_API_URL || DEFAULT_API_URL).replace(/\/$/, "");
}

export function storedBuilderApiKey(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.localStorage.getItem(BUILDER_API_KEY_STORAGE_KEY)?.trim() ?? "";
}

export function saveStoredBuilderApiKey(value: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const trimmed = value.trim();
  if (trimmed) {
    window.localStorage.setItem(BUILDER_API_KEY_STORAGE_KEY, trimmed);
  } else {
    window.localStorage.removeItem(BUILDER_API_KEY_STORAGE_KEY);
  }
}

export function storedBuilderAuthSession(): BuilderAuthSessionResult | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(BUILDER_AUTH_SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as BuilderAuthSessionResult;
    if (
      parsed?.format === "agent-flow-builder.builder-auth-session.v1" &&
      typeof parsed.token === "string" &&
      parsed.token.startsWith("afbs_") &&
      typeof parsed.expiresAt === "string" &&
      Date.parse(parsed.expiresAt) > Date.now()
    ) {
      return parsed;
    }
  } catch {
    // Invalid local session state is cleared below.
  }
  clearStoredBuilderAuthSession();
  return null;
}

export function saveStoredBuilderAuthSession(value: BuilderAuthSessionResult): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(BUILDER_AUTH_SESSION_STORAGE_KEY, JSON.stringify(value));
}

export function clearStoredBuilderAuthSession(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(BUILDER_AUTH_SESSION_STORAGE_KEY);
}

export async function listFlows(): Promise<FlowSummary[]> {
  const data = await request<{ flows: FlowSummary[] }>("/flows");
  return data.flows;
}

export async function loadFlow(flowId: string): Promise<LoadedFlow> {
  return request<LoadedFlow>(`/flows/${encodeURIComponent(flowId)}`);
}

export async function createFlowWorkspace(id: string): Promise<CreatedFlowWorkspace> {
  return request<CreatedFlowWorkspace>("/flows", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
}

export async function listLlmAdapters(): Promise<LlmAdapterCatalogResult> {
  return request<LlmAdapterCatalogResult>("/llm-adapters");
}

export async function checkLocalLlmProviderStatus(input: {
  adapter: string;
  baseUrl?: string;
  model?: string;
}): Promise<LocalLlmProviderStatus> {
  const params = new URLSearchParams();
  params.set("adapter", input.adapter);
  if (input.baseUrl?.trim()) {
    params.set("baseUrl", input.baseUrl.trim());
  }
  if (input.model?.trim()) {
    params.set("model", input.model.trim());
  }
  return request<LocalLlmProviderStatus>(`/llm-adapters/local-provider-status?${params.toString()}`);
}

export async function loadBuilderAuthStatus(): Promise<BuilderAuthStatus> {
  return request<BuilderAuthStatus>("/builder-auth/status");
}

export async function loadStudioNodePins(flowId: string): Promise<StudioNodePinsPackage> {
  return request<StudioNodePinsPackage>(`/flows/${encodeURIComponent(flowId)}/studio-node-pins`);
}

export async function saveStudioNodePins(flowId: string, payload: StudioNodePinsPackage): Promise<StudioNodePinsPackage> {
  return request<StudioNodePinsPackage>(`/flows/${encodeURIComponent(flowId)}/studio-node-pins`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function mergeStudioNodePins(flowId: string, payload: StudioNodePinsPackage): Promise<StudioNodePinsPackage> {
  return request<StudioNodePinsPackage>(`/flows/${encodeURIComponent(flowId)}/studio-node-pins/merge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function loadStudioNodePinConflictReview(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/studio-node-pins/conflicts-review`);
}

export async function compareStudioNodePinConflictReview(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/studio-node-pins/conflicts-review/diff`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updateStudioNodePinConflictCuration(
  flowId: string,
  conflictId: string,
  action: "assign" | "release",
  actor = "local-studio",
  note = "",
  role: "owner" | "reviewer" | "viewer" = "reviewer",
): Promise<StudioNodePinsPackage> {
  return request<StudioNodePinsPackage>(
    `/flows/${encodeURIComponent(flowId)}/studio-node-pins/conflicts/${encodeURIComponent(conflictId)}/curation`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, actor, note, role }),
    },
  );
}

export async function resolveStudioNodePinConflict(
  flowId: string,
  conflictId: string,
  payload: { keepPinId: string; resolvedBy?: string; resolvedRole?: "owner" | "reviewer" | "viewer"; resolutionNote?: string },
): Promise<StudioNodePinsPackage> {
  return request<StudioNodePinsPackage>(
    `/flows/${encodeURIComponent(flowId)}/studio-node-pins/conflicts/${encodeURIComponent(conflictId)}/resolve`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export async function loadStudioNodePinsCentralSyncStatus(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/studio-node-pins/central`);
}

export async function syncCentralStudioNodePins(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/studio-node-pins/sync-central`, {
    method: "POST",
  });
}

export async function probeBuilderAuthExternalIntegrations(): Promise<BuilderAuthExternalProbeResult> {
  return request<BuilderAuthExternalProbeResult>("/builder-auth/external-probe", {
    method: "POST",
  });
}

export async function homologateBuilderAuthCorporateIntegrations(): Promise<BuilderAuthCorporateHomologationResult> {
  return request<BuilderAuthCorporateHomologationResult>("/builder-auth/corporate-homologation", {
    method: "POST",
  });
}

export async function loadBuilderAuthAudit(input: number | BuilderAuthAuditQuery = 20): Promise<BuilderAuthAuditReport> {
  const query = typeof input === "number" ? { limit: input } : input;
  const params = new URLSearchParams();
  if (typeof query.limit === "number") {
    params.set("limit", String(query.limit));
  }
  for (const key of ["status", "method", "route", "keyId", "actorId", "q", "from", "to"] as const) {
    const value = query[key];
    if (typeof value === "string" && value.trim()) {
      params.set(key, value.trim());
    }
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<BuilderAuthAuditReport>(`/builder-auth/audit${suffix}`);
}

export async function createBuilderAuthSession(): Promise<BuilderAuthSessionResult> {
  return request<BuilderAuthSessionResult>("/builder-auth/session", {
    method: "POST",
  });
}

export async function refreshBuilderAuthSession(): Promise<BuilderAuthSessionResult> {
  return request<BuilderAuthSessionResult>("/builder-auth/session/refresh", {
    method: "POST",
  });
}

export async function refreshBuilderAuthOidcSession(): Promise<BuilderAuthSessionResult> {
  return request<BuilderAuthSessionResult>("/builder-auth/oidc/session/refresh", {
    method: "POST",
  });
}

export async function logoutBuilderAuthSession(): Promise<BuilderAuthSessionLogoutResult> {
  return request<BuilderAuthSessionLogoutResult>("/builder-auth/session/logout", {
    method: "POST",
  });
}

export async function createBuilderAuthOidcLoginUrl(): Promise<BuilderAuthOidcLoginResult> {
  return request<BuilderAuthOidcLoginResult>("/builder-auth/oidc/login-url", {
    method: "POST",
  });
}

export async function createBuilderAuthOidcLogoutUrl(): Promise<BuilderAuthOidcLogoutResult> {
  return request<BuilderAuthOidcLogoutResult>("/builder-auth/oidc/logout-url", {
    method: "POST",
  });
}

export async function generateBuilderAuthKey(payload: {
  keyId?: string;
  actorId: string;
  name?: string;
  role: string;
  groups?: string[];
  areas: string[];
  scopes: string[];
  expiresAt?: string;
}): Promise<BuilderAuthKeyRotationResult> {
  return request<BuilderAuthKeyRotationResult>("/builder-auth/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function disableBuilderAuthKey(keyId: string): Promise<BuilderAuthStatus> {
  return request<BuilderAuthStatus>(`/builder-auth/keys/${encodeURIComponent(keyId)}/disable`, {
    method: "POST",
  });
}

export async function loadWorkspaceGovernance(): Promise<WorkspaceGovernancePackage> {
  return request<WorkspaceGovernancePackage>("/workspace-governance");
}

export async function loadCollaborationConflictOverview(
  filters: Partial<CollaborationConflictFilters> = {},
): Promise<CollaborationConflictOverview> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (typeof value === "string" && value.trim()) {
      params.set(key, value.trim());
    }
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<CollaborationConflictOverview>(`/collaboration/conflicts${suffix}`);
}

export async function compareCollaborationConflictOverview(
  payload: { overview: CollaborationConflictOverview },
  filters: Partial<CollaborationConflictFilters> = {},
): Promise<CollaborationConflictOverviewDiffPackage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (typeof value === "string" && value.trim()) {
      params.set(key, value.trim());
    }
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<CollaborationConflictOverviewDiffPackage>(`/collaboration/conflicts/diff${suffix}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function saveWorkspaceGovernance(payload: WorkspaceGovernancePackage): Promise<WorkspaceGovernancePackage> {
  return request<WorkspaceGovernancePackage>("/workspace-governance", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function mergeWorkspaceGovernance(payload: WorkspaceGovernancePackage): Promise<WorkspaceGovernancePackage> {
  return request<WorkspaceGovernancePackage>("/workspace-governance/merge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function authorizeWorkspaceGovernance(input: {
  actorId: string;
  area: string;
  action: WorkspaceGovernanceAction;
}): Promise<WorkspaceGovernanceDecision> {
  return request<WorkspaceGovernanceDecision>("/workspace-governance/authorize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function resolveWorkspaceGovernanceConflict(
  conflictId: string,
  resolvedBy: string,
  resolution: "keep_existing" | "use_incoming",
): Promise<WorkspaceGovernancePackage> {
  return request<WorkspaceGovernancePackage>(
    `/workspace-governance/conflicts/${encodeURIComponent(conflictId)}/resolve`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resolvedBy, resolution }),
    },
  );
}

export async function listLocalCatalog(): Promise<LocalCatalog> {
  return request<LocalCatalog>("/catalog");
}

export async function loadSharedLocalCatalog(): Promise<LocalCatalogSharedLibraryPackage> {
  return request<LocalCatalogSharedLibraryPackage>("/catalog/shared-library");
}

export async function loadSharedLocalCatalogConflictReview(): Promise<LocalCatalogConflictReviewPackage> {
  return request<LocalCatalogConflictReviewPackage>("/catalog/shared-library/conflicts-review");
}

export async function compareSharedLocalCatalogConflictReview(payload: unknown): Promise<LocalCatalogConflictReviewDiffPackage> {
  return request<LocalCatalogConflictReviewDiffPackage>("/catalog/shared-library/conflicts-review/diff", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function loadLocalCatalogCentralSyncStatus(): Promise<LocalCatalogCentralSyncStatus> {
  return request<LocalCatalogCentralSyncStatus>("/catalog/central");
}

export async function loadSharedLocalCatalogIntoRegistry(): Promise<LocalCatalogSharedSyncResult> {
  return request<LocalCatalogSharedSyncResult>("/catalog/shared-library/load", {
    method: "POST",
  });
}

export async function mergeSharedLocalCatalog(payload: unknown): Promise<LocalCatalogSharedSyncResult> {
  return request<LocalCatalogSharedSyncResult>("/catalog/shared-library/merge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function syncCentralLocalCatalog(): Promise<LocalCatalogCentralSyncResult> {
  return request<LocalCatalogCentralSyncResult>("/catalog/sync-central", {
    method: "POST",
  });
}

export async function resolveSharedLocalCatalogConflict(
  conflictId: string,
  resolvedBy = "local-studio",
  resolution: LocalCatalogLibraryConflictResolution = "keep_library",
  resolutionNote = "Mantida a versão atual da biblioteca compartilhada.",
  role: LocalCatalogLibraryConflictCuratorRole = "reviewer",
): Promise<LocalCatalogSharedLibraryPackage> {
  return request<LocalCatalogSharedLibraryPackage>(
    `/catalog/shared-library/conflicts/${encodeURIComponent(conflictId)}/resolve`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resolvedBy, role, resolution, resolutionNote }),
    },
  );
}

export async function updateSharedLocalCatalogConflictCuration(
  conflictId: string,
  action: "assign" | "release",
  actor = "local-studio",
  note = "",
  role: LocalCatalogLibraryConflictCuratorRole = "reviewer",
): Promise<LocalCatalogSharedLibraryPackage> {
  return request<LocalCatalogSharedLibraryPackage>(
    `/catalog/shared-library/conflicts/${encodeURIComponent(conflictId)}/curation`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, actor, role, note }),
    },
  );
}

export async function saveLocalCatalogItem(item: {
  id: string;
  kind: LocalCatalogItemKind;
  name: string;
  description?: string;
  tags?: string[];
  version?: string;
  content?: string;
  nodePatch?: Record<string, unknown>;
}): Promise<LocalCatalogSaveResult> {
  return request<LocalCatalogSaveResult>("/catalog/items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(item),
  });
}

export async function exportLocalCatalogItem(itemId: string, kind: LocalCatalogItemKind): Promise<LocalCatalogItemPackage> {
  return request<LocalCatalogItemPackage>(
    `/catalog/items/${encodeURIComponent(kind)}/${encodeURIComponent(itemId)}/export`,
  );
}

export async function importLocalCatalogItem(itemPackage: unknown): Promise<LocalCatalogSaveResult> {
  return request<LocalCatalogSaveResult>("/catalog/items/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ package: itemPackage }),
  });
}

export async function restoreLocalCatalogRevision(item: {
  itemId: string;
  kind?: LocalCatalogItemKind;
  revision: number;
}): Promise<LocalCatalogSaveResult> {
  return request<LocalCatalogSaveResult>("/catalog/items/restore-revision", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(item),
  });
}

export async function applyLocalCatalogItem(
  flowId: string,
  itemId: string,
  kind: LocalCatalogItemKind,
  targetNodeId?: string,
): Promise<LocalCatalogApplyResult> {
  return request<LocalCatalogApplyResult>(`/flows/${encodeURIComponent(flowId)}/catalog/apply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ itemId, kind, targetNodeId }),
  });
}

export async function createFlowFromCatalogTemplate(
  itemId: string,
  id: string,
  name?: string,
  resourceName?: string,
): Promise<LocalCatalogCreateFlowResult> {
  return request<LocalCatalogCreateFlowResult>("/catalog/agent-templates/create-flow", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ itemId, id, name, resourceName }),
  });
}

export async function saveFlow(flowId: string, flow: AgentFlow): Promise<LoadedFlow> {
  return request<LoadedFlow>(`/flows/${encodeURIComponent(flowId)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(flow),
  });
}

export async function checkVmRunnerReadiness(flowId: string, node: FlowNode): Promise<VmRunnerCheckResult> {
  return request<VmRunnerCheckResult>(`/flows/${encodeURIComponent(flowId)}/code-vm-runner/check`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ node }),
  });
}

export async function exportFlowWorkspace(flowId: string): Promise<FlowWorkspaceExport> {
  return request<FlowWorkspaceExport>(`/flows/${encodeURIComponent(flowId)}/export`);
}

export async function importFlowWorkspace(
  workspace: FlowWorkspaceExport,
  overwrite: boolean,
): Promise<FlowWorkspaceImportResult> {
  return request<FlowWorkspaceImportResult>("/flows/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspace, overwrite }),
  });
}

export async function loadPromptAsset(flowId: string, promptId: string): Promise<FlowAssetContent> {
  return request<FlowAssetContent>(`/flows/${encodeURIComponent(flowId)}/prompts/${encodeURIComponent(promptId)}`);
}

export async function createPromptAsset(flowId: string, id: string): Promise<FlowAssetMutationResult> {
  return request<FlowAssetMutationResult>(`/flows/${encodeURIComponent(flowId)}/prompts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
}

export async function savePromptAsset(flowId: string, promptId: string, content: string): Promise<FlowAssetContent> {
  return request<FlowAssetContent>(`/flows/${encodeURIComponent(flowId)}/prompts/${encodeURIComponent(promptId)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

export async function deletePromptAsset(flowId: string, promptId: string): Promise<FlowAssetDeleteResult> {
  return request<FlowAssetDeleteResult>(`/flows/${encodeURIComponent(flowId)}/prompts/${encodeURIComponent(promptId)}`, {
    method: "DELETE",
  });
}

export async function loadSchemaAsset(flowId: string, schemaId: string): Promise<FlowAssetContent> {
  return request<FlowAssetContent>(`/flows/${encodeURIComponent(flowId)}/schemas/${encodeURIComponent(schemaId)}`);
}

export async function createSchemaAsset(flowId: string, id: string): Promise<FlowAssetMutationResult> {
  return request<FlowAssetMutationResult>(`/flows/${encodeURIComponent(flowId)}/schemas`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
}

export async function saveSchemaAsset(flowId: string, schemaId: string, content: string): Promise<FlowAssetContent> {
  return request<FlowAssetContent>(`/flows/${encodeURIComponent(flowId)}/schemas/${encodeURIComponent(schemaId)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

export async function deleteSchemaAsset(flowId: string, schemaId: string): Promise<FlowAssetDeleteResult> {
  return request<FlowAssetDeleteResult>(`/flows/${encodeURIComponent(flowId)}/schemas/${encodeURIComponent(schemaId)}`, {
    method: "DELETE",
  });
}

export async function validateFlow(flowId: string): Promise<ValidationResult> {
  return request<ValidationResult>(`/flows/${encodeURIComponent(flowId)}/validate`, {
    method: "POST",
  });
}

export async function generateFlow(flowId: string, outDir?: string): Promise<GenerateResult> {
  return request<GenerateResult>(`/flows/${encodeURIComponent(flowId)}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ outDir }),
  });
}

export async function generateLangGraphSandbox(flowId: string, outDir?: string): Promise<GenerateResult> {
  return request<GenerateResult>(`/flows/${encodeURIComponent(flowId)}/generate-langgraph-sandbox`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ outDir }),
  });
}

export async function approveLangGraphSandbox(
  flowId: string,
  outDir?: string,
  approvalEvidence?: LangGraphSandboxApprovalEvidence,
): Promise<LangGraphSandboxApproval> {
  const result = await request<{ status: "ok"; approval: LangGraphSandboxApproval }>(
    `/flows/${encodeURIComponent(flowId)}/approve-langgraph-sandbox`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outDir, ...(approvalEvidence ? { approvalEvidence } : {}) }),
    },
  );
  return result.approval;
}

export async function readLangGraphSandboxApprovalStatus(flowId: string): Promise<LangGraphSandboxApprovalStatus> {
  return request<LangGraphSandboxApprovalStatus>(`/flows/${encodeURIComponent(flowId)}/langgraph-sandbox-approval-status`);
}

export async function generateLangSmithCloudHandoff(flowId: string): Promise<LangSmithCloudHandoff> {
  const result = await request<{ status: "ok"; handoff: LangSmithCloudHandoff }>(
    `/flows/${encodeURIComponent(flowId)}/generate-langsmith-cloud-handoff`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
    },
  );
  return result.handoff;
}

export async function loadLangSmithCloudDeployments(flowId: string): Promise<LangSmithCloudDeploymentsPackage> {
  return request<LangSmithCloudDeploymentsPackage>(`/flows/${encodeURIComponent(flowId)}/langsmith-cloud-deployments`);
}

export async function loadLangSmithCloudDeploymentsCentralStatus(
  flowId: string,
): Promise<LangSmithCloudDeploymentsCentralStatus> {
  return request<LangSmithCloudDeploymentsCentralStatus>(
    `/flows/${encodeURIComponent(flowId)}/langsmith-cloud-deployments/central`,
  );
}

export async function loadLangSmithCloudDeploymentAutomationStatus(
  flowId: string,
): Promise<LangSmithCloudDeploymentAutomationStatus> {
  return request<LangSmithCloudDeploymentAutomationStatus>(
    `/flows/${encodeURIComponent(flowId)}/langsmith-cloud-deployment-automation`,
  );
}

export async function recordLangSmithCloudDeployment(
  flowId: string,
  payload: {
    status: LangSmithCloudDeploymentStatus;
    deploymentName: string;
    environment?: string;
    cloudProject?: string;
    externalDeploymentId?: string;
    deploymentUrl?: string;
    traceUrl?: string;
    note?: string;
    recordedBy?: string;
    recordedRole?: string;
  },
): Promise<LangSmithCloudDeploymentsPackage> {
  const result = await request<{ status: "ok"; deployments: LangSmithCloudDeploymentsPackage }>(
    `/flows/${encodeURIComponent(flowId)}/langsmith-cloud-deployments`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  return result.deployments;
}

export async function triggerLangSmithCloudDeployment(
  flowId: string,
  payload: {
    deploymentName: string;
    environment?: string;
    recordedBy?: string;
    recordedRole?: string;
  },
): Promise<LangSmithCloudDeploymentAutomationResult> {
  return request<LangSmithCloudDeploymentAutomationResult>(
    `/flows/${encodeURIComponent(flowId)}/langsmith-cloud-deployment-automation/deploy`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export async function syncCentralLangSmithCloudDeployments(
  flowId: string,
): Promise<LangSmithCloudDeploymentsCentralSyncResult> {
  return request<LangSmithCloudDeploymentsCentralSyncResult>(
    `/flows/${encodeURIComponent(flowId)}/langsmith-cloud-deployments/sync-central`,
    {
      method: "POST",
    },
  );
}

export async function generateApprovedRuntime(flowId: string, outDir?: string): Promise<ApprovedGenerateResult> {
  return request<ApprovedGenerateResult>(`/flows/${encodeURIComponent(flowId)}/generate-approved-runtime`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ outDir }),
  });
}

export async function listGeneratedArtifact(outDir: string): Promise<GeneratedArtifactListing> {
  return request<GeneratedArtifactListing>(`/artifacts?${generatedArtifactQuery(outDir)}`);
}

export async function readGeneratedArtifactFile(
  outDir: string,
  filePath: string,
): Promise<GeneratedArtifactFileContent> {
  return request<GeneratedArtifactFileContent>(`/artifacts/file?${generatedArtifactQuery(outDir, filePath)}`);
}

export async function downloadGeneratedArtifactArchive(outDir: string): Promise<Blob> {
  const headers = new Headers();
  applyBuilderApiKeyHeader(headers);
  const response = await fetch(`${builderApiUrl()}/artifacts/archive?${generatedArtifactQuery(outDir)}`, { headers });
  if (!response.ok) {
    throw await responseError(response);
  }
  return response.blob();
}

export async function dockerRuntimeStatus(outDir: string, runtimeUrl?: string): Promise<DockerRuntimeStatus> {
  return request<DockerRuntimeStatus>(`/docker-runtime/status?${generatedArtifactQuery(outDir, undefined, runtimeUrl)}`);
}

export async function dockerRuntimeHistory(
  outDir: string,
  runtimeUrl?: string,
  limit = 20,
  filters: Omit<DockerRuntimeHistoryQuery, "limit"> = {},
): Promise<DockerRuntimeHistory> {
  return request<DockerRuntimeHistory>(
    `/docker-runtime/history?${generatedRuntimeHistoryQuery(outDir, runtimeUrl, limit, filters)}`,
  );
}

export async function dockerRuntimeBuild(outDir: string, runtimeUrl?: string): Promise<DockerRuntimeOperationResult> {
  return dockerRuntimeCommand("build", outDir, runtimeUrl);
}

export async function dockerRuntimeCancel(outDir: string, runtimeUrl?: string): Promise<DockerRuntimeOperationResult> {
  return dockerRuntimeCommand("cancel", outDir, runtimeUrl);
}

export async function dockerRuntimePrepareEnv(outDir: string, runtimeUrl?: string): Promise<DockerRuntimeOperationResult> {
  return dockerRuntimeCommand("prepare-env", outDir, runtimeUrl);
}

export async function dockerRuntimeSetupModels(outDir: string, runtimeUrl?: string): Promise<DockerRuntimeOperationResult> {
  return dockerRuntimeCommand("setup-models", outDir, runtimeUrl);
}

export async function dockerRuntimeBuildModelImage(outDir: string, runtimeUrl?: string): Promise<DockerRuntimeOperationResult> {
  return dockerRuntimeCommand("build-model-image", outDir, runtimeUrl);
}

export async function dockerRuntimeExportModelImage(outDir: string, runtimeUrl?: string): Promise<DockerRuntimeOperationResult> {
  return dockerRuntimeCommand("export-model-image", outDir, runtimeUrl);
}

export async function dockerRuntimePushModelImage(outDir: string, runtimeUrl?: string): Promise<DockerRuntimeOperationResult> {
  return dockerRuntimeCommand("push-model-image", outDir, runtimeUrl);
}

export async function dockerRuntimeCheckGpu(outDir: string, runtimeUrl?: string): Promise<DockerRuntimeOperationResult> {
  return dockerRuntimeCommand("check-gpu", outDir, runtimeUrl);
}

export async function listModelImageCatalog(): Promise<ModelImageCatalog> {
  return request<ModelImageCatalog>("/model-image-catalog");
}

export async function discoverModelImageCatalogs(): Promise<ModelImageCatalogDiscoveryResult> {
  return request<ModelImageCatalogDiscoveryResult>("/model-image-catalog/discovery");
}

export async function discoverRemoteModelImageCatalogs(): Promise<ModelImageCatalogRemoteRegistryResult> {
  return request<ModelImageCatalogRemoteRegistryResult>("/model-image-catalog/remote");
}

export async function loadModelImageCatalogCentralStatus(): Promise<ModelImageCatalogCentralStatus> {
  return request<ModelImageCatalogCentralStatus>("/model-image-catalog/central");
}

export async function loadModelImageRemoteRegistry(): Promise<ModelImageRemoteRegistry> {
  return request<ModelImageRemoteRegistry>("/model-image-catalog/remote-registry");
}

export async function saveModelImageRemoteRegistryEntry(payload: {
  id?: string;
  name?: string;
  url: string;
  enabled?: boolean;
  status?: "candidate" | "approved" | "disabled";
  notes?: string;
}): Promise<ModelImageRemoteRegistrySaveResult> {
  return request<ModelImageRemoteRegistrySaveResult>("/model-image-catalog/remote-registry", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function deleteModelImageRemoteRegistryEntry(entryId: string): Promise<ModelImageRemoteRegistry> {
  return request<ModelImageRemoteRegistry>(`/model-image-catalog/remote-registry/${encodeURIComponent(entryId)}`, {
    method: "DELETE",
  });
}

export async function registerRuntimeModelImageCatalogItem(
  outDir: string,
  runtimeUrl?: string,
  notes?: string,
): Promise<ModelImageCatalogRegisterResult> {
  return request<ModelImageCatalogRegisterResult>("/model-image-catalog/register-runtime", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ outDir, runtimeUrl, notes }),
  });
}

export async function mergeModelImageCatalog(payload: unknown): Promise<ModelImageCatalogMergeResult> {
  return request<ModelImageCatalogMergeResult>("/model-image-catalog/merge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function syncDiscoveredModelImageCatalogs(): Promise<ModelImageCatalogSyncDiscoveredResult> {
  return request<ModelImageCatalogSyncDiscoveredResult>("/model-image-catalog/sync-discovered", {
    method: "POST",
  });
}

export async function syncRemoteModelImageCatalogs(): Promise<ModelImageCatalogSyncRemoteResult> {
  return request<ModelImageCatalogSyncRemoteResult>("/model-image-catalog/sync-remote", {
    method: "POST",
  });
}

export async function syncCentralModelImageCatalogs(): Promise<ModelImageCatalogSyncCentralResult> {
  return request<ModelImageCatalogSyncCentralResult>("/model-image-catalog/sync-central", {
    method: "POST",
  });
}

export async function dockerRuntimeConfigurePorts(
  outDir: string,
  ports: DockerRuntimePortUpdate,
  runtimeUrl?: string,
): Promise<DockerRuntimeOperationResult> {
  return request<DockerRuntimeOperationResult>("/docker-runtime/configure-ports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ outDir, ports, runtimeUrl }),
  });
}

export async function dockerRuntimeUp(
  outDir: string,
  runtimeUrl?: string,
  modelExecutionProfile: DockerRuntimeModelExecutionProfile = "cpu",
): Promise<DockerRuntimeOperationResult> {
  return request<DockerRuntimeOperationResult>("/docker-runtime/up", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ outDir, runtimeUrl, modelExecutionProfile }),
  });
}

export async function dockerRuntimeDown(outDir: string, runtimeUrl?: string): Promise<DockerRuntimeOperationResult> {
  return dockerRuntimeCommand("down", outDir, runtimeUrl);
}

export async function dockerRuntimeSmoke(
  outDir: string,
  runtimeUrl?: string,
  agentId?: string,
): Promise<DockerRuntimeOperationResult> {
  return dockerRuntimeCommand("smoke", outDir, runtimeUrl, agentId);
}

export async function dockerRuntimeSmokeAll(outDir: string, runtimeUrl?: string): Promise<DockerRuntimeOperationResult> {
  return dockerRuntimeCommand("smoke-all", outDir, runtimeUrl);
}

export async function dockerRuntimeInspect(outDir: string, runtimeUrl?: string): Promise<DockerRuntimeOperationResult> {
  return dockerRuntimeCommand("inspect", outDir, runtimeUrl);
}

export async function loadRuntimeManifest(): Promise<LoadedRuntimeManifest> {
  return request<LoadedRuntimeManifest>("/runtime-manifest");
}

export async function saveRuntimeManifest(manifest: RuntimeManifest): Promise<LoadedRuntimeManifest> {
  return request<LoadedRuntimeManifest>("/runtime-manifest", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(manifest),
  });
}

export async function validateRuntimeManifest(): Promise<RuntimeManifestValidationResult> {
  return request<RuntimeManifestValidationResult>("/runtime-manifest/validate", {
    method: "POST",
  });
}

export async function generateRuntimeManifest(outDir?: string): Promise<RuntimeManifestGenerateResult> {
  return request<RuntimeManifestGenerateResult>("/runtime-manifest/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ outDir }),
  });
}

export async function generateApprovedRuntimeManifest(outDir?: string): Promise<RuntimeManifestGenerateResult> {
  return request<RuntimeManifestGenerateResult>("/runtime-manifest/generate-approved", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ outDir }),
  });
}

export async function sandboxStatus(flowId: string): Promise<SandboxStatus> {
  return request<SandboxStatus>(`/sandboxes/${encodeURIComponent(flowId)}/status`);
}

export async function listSandboxes(): Promise<SandboxListResult> {
  return request<SandboxListResult>("/sandboxes");
}

export async function startSandbox(flowId: string, port?: number, env?: Record<string, string>): Promise<SandboxStatus> {
  return request<SandboxStatus>(`/sandboxes/${encodeURIComponent(flowId)}/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ port, env }),
  });
}

export async function stopSandbox(flowId: string): Promise<SandboxStatus> {
  return request<SandboxStatus>(`/sandboxes/${encodeURIComponent(flowId)}/stop`, {
    method: "POST",
  });
}

export async function createRuntimeSession(
  runtimeUrl: string,
  resourceName: string,
  metadata: Record<string, unknown> = {},
  runtimeApiKey?: string,
): Promise<{ session: SessionView }> {
  return runtimeRequest<{ session: SessionView }>(runtimeUrl, `/${resourceName}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": `ui-create-${Date.now()}`,
    },
    body: JSON.stringify({ metadata: { source: "builder-ui", ...metadata }, max_turns: 3 }),
  }, runtimeApiKey);
}

export async function startRuntimeSession(
  runtimeUrl: string,
  resourceName: string,
  sessionId: string,
  runtimeApiKey?: string,
): Promise<{ session: SessionView; messages: MessageView[] }> {
  return runtimeRequest<{ session: SessionView; messages: MessageView[] }>(
    runtimeUrl,
    `/${resourceName}/${sessionId}/start`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": `ui-start-${Date.now()}`,
      },
      body: JSON.stringify({}),
    },
    runtimeApiKey,
  );
}

export async function sendRuntimeTurn(
  runtimeUrl: string,
  resourceName: string,
  sessionId: string,
  payload: Record<string, unknown>,
  idempotencyKey?: string,
  runtimeApiKey?: string,
): Promise<{ session: SessionView; assistant_message: { code: string; text: string } }> {
  return runtimeRequest<{ session: SessionView; assistant_message: { code: string; text: string } }>(
    runtimeUrl,
    `/${resourceName}/${sessionId}/turn`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": normalizeIdempotencyKey(idempotencyKey),
      },
      body: JSON.stringify(payload),
    },
    runtimeApiKey,
  );
}

export async function runRuntimeOrchestration(
  runtimeUrl: string,
  payload: Record<string, unknown>,
  runtimeApiKey?: string,
): Promise<RuntimeOrchestrationRunResult> {
  return runtimeRequest<RuntimeOrchestrationRunResult>(
    runtimeUrl,
    "/orchestration/run",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
    runtimeApiKey,
  );
}

export async function sendRuntimeTurnStream(
  runtimeUrl: string,
  resourceName: string,
  sessionId: string,
  payload: Record<string, unknown>,
  handlers: RuntimeTurnStreamHandlers = {},
  idempotencyKey?: string,
  runtimeApiKey?: string,
): Promise<RuntimeTurnResponse> {
  const headers = new Headers({
    "content-type": "application/json",
    "Idempotency-Key": normalizeIdempotencyKey(idempotencyKey),
  });
  applyRuntimeApiKeyHeader(headers, runtimeApiKey);
  const response = await fetch(`${runtimeUrl.replace(/\/$/, "")}/${resourceName}/${sessionId}/turn/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    return parseResponse<RuntimeTurnResponse>(response);
  }
  if (!response.body) {
    throw new Error("Runtime não retornou corpo SSE para o stream do turno.");
  }

  let completed: RuntimeTurnResponse | null = null;
  for await (const envelope of readSseEnvelopes(response.body)) {
    const event = parseRuntimeTurnStreamEvent(envelope.event, envelope.data);
    if (!event) {
      continue;
    }
    handlers.onEvent?.(event);
    if (event.event === "token") {
      handlers.onToken?.(event.data);
    } else if (event.event === "turn_completed") {
      completed = event.data;
      handlers.onCompleted?.(event.data);
    } else if (event.event === "stream_closed") {
      handlers.onClosed?.(event.data);
    } else if (event.event === "turn_error") {
      throw new Error(readRuntimeStreamError(event.data));
    }
  }
  if (!completed) {
    throw new Error("Stream do turno encerrou sem evento turn_completed.");
  }
  return completed;
}

export async function sendRuntimeTurnStreamWebSocket(
  runtimeUrl: string,
  resourceName: string,
  sessionId: string,
  payload: Record<string, unknown>,
  handlers: RuntimeTurnStreamHandlers = {},
  idempotencyKey?: string,
  runtimeApiKey?: string,
): Promise<RuntimeTurnResponse> {
  if (typeof WebSocket === "undefined") {
    throw new Error("Este navegador não suporta WebSocket.");
  }
  const userMessage = typeof payload.user_message === "string" ? payload.user_message : "";
  if (!userMessage.trim()) {
    throw new Error("Payload do turno precisa conter user_message para streaming WebSocket.");
  }
  const socketUrl = buildRuntimeTurnStreamWebSocketUrl(
    runtimeUrl,
    resourceName,
    sessionId,
    userMessage,
    normalizeIdempotencyKey(idempotencyKey),
    runtimeApiKey,
  );

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl);
    let completed: RuntimeTurnResponse | null = null;
    let settled = false;

    const settleReject = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        socket.close();
      } catch {
        // Browser may already have closed the socket.
      }
      reject(error);
    };

    const settleResolve = () => {
      if (settled) {
        return;
      }
      if (!completed) {
        settleReject(new Error("Stream WebSocket do turno encerrou sem evento turn_completed."));
        return;
      }
      settled = true;
      try {
        socket.close(1000, "turn_completed");
      } catch {
        // Browser may already have closed the socket.
      }
      resolve(completed);
    };

    socket.onmessage = (message) => {
      const event = parseRuntimeTurnWebSocketEvent(message.data);
      if (!event) {
        return;
      }
      handlers.onEvent?.(event);
      if (event.event === "token") {
        handlers.onToken?.(event.data);
        return;
      }
      if (event.event === "turn_completed") {
        completed = event.data;
        handlers.onCompleted?.(event.data);
        return;
      }
      if (event.event === "stream_closed") {
        handlers.onClosed?.(event.data);
        if (completed) {
          settleResolve();
        } else if (typeof event.data.reason === "string" && event.data.reason !== "turn_completed") {
          settleReject(new Error(`Stream WebSocket encerrado: ${event.data.reason}.`));
        }
        return;
      }
      if (event.event === "turn_error") {
        settleReject(new Error(readRuntimeStreamError(event.data)));
      }
    };

    socket.onerror = () => {
      settleReject(new Error("Stream WebSocket do turno indisponível."));
    };

    socket.onclose = (event) => {
      if (settled) {
        return;
      }
      if (completed) {
        settleResolve();
        return;
      }
      settleReject(new Error(event.reason || "Stream WebSocket do turno foi encerrado antes da conclusão."));
    };
  });
}

function normalizeIdempotencyKey(idempotencyKey?: string): string {
  const trimmed = idempotencyKey?.trim();
  return trimmed || `ui-turn-${Date.now()}`;
}

export async function finishRuntimeSession(
  runtimeUrl: string,
  resourceName: string,
  sessionId: string,
  runtimeApiKey?: string,
): Promise<{ session: SessionView; message: MessageView | null }> {
  return runtimeRequest<{ session: SessionView; message: MessageView | null }>(
    runtimeUrl,
    `/${resourceName}/${sessionId}/finish`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": `ui-finish-${Date.now()}`,
      },
      body: JSON.stringify({}),
    },
    runtimeApiKey,
  );
}

export async function runtimeTranscript(
  runtimeUrl: string,
  resourceName: string,
  sessionId: string,
  runtimeApiKey?: string,
): Promise<MessageView[]> {
  return runtimeRequest<MessageView[]>(runtimeUrl, `/${resourceName}/${sessionId}/transcript`, undefined, runtimeApiKey);
}

export async function runtimeEvents(
  runtimeUrl: string,
  resourceName: string,
  sessionId: string,
  runtimeApiKey?: string,
): Promise<EventView[]> {
  return runtimeRequest<EventView[]>(runtimeUrl, `/${resourceName}/${sessionId}/events`, undefined, runtimeApiKey);
}

export async function runtimeMetadata(
  runtimeUrl: string,
  runtimeApiKey?: string,
): Promise<Record<string, unknown>> {
  return runtimeRequest<Record<string, unknown>>(runtimeUrl, "/metadata", undefined, runtimeApiKey);
}

export async function runtimeJobs(
  runtimeUrl: string,
  sessionId?: string,
  status?: string,
  runtimeApiKey?: string,
): Promise<RuntimeJobView[]> {
  const params = new URLSearchParams();
  if (sessionId) {
    params.set("session_id", sessionId);
  }
  if (status) {
    params.set("status", status);
  }
  const query = params.toString();
  return runtimeRequest<RuntimeJobView[]>(runtimeUrl, `/jobs${query ? `?${query}` : ""}`, undefined, runtimeApiKey);
}

export async function runtimeJobMetrics(
  runtimeUrl: string,
  runtimeApiKey?: string,
  windowHours = 1,
): Promise<RuntimeJobMetrics> {
  const params = new URLSearchParams({ window_hours: String(Math.max(0, windowHours)) });
  return runtimeRequest<RuntimeJobMetrics>(runtimeUrl, `/jobs/metrics?${params.toString()}`, undefined, runtimeApiKey);
}

export async function runtimeJobSchedules(
  runtimeUrl: string,
  sessionId?: string,
  status?: string,
  runtimeApiKey?: string,
): Promise<RuntimeJobScheduleView[]> {
  const params = new URLSearchParams();
  if (sessionId) {
    params.set("session_id", sessionId);
  }
  if (status) {
    params.set("status", status);
  }
  const query = params.toString();
  return runtimeRequest<RuntimeJobScheduleView[]>(
    runtimeUrl,
    `/job-schedules${query ? `?${query}` : ""}`,
    undefined,
    runtimeApiKey,
  );
}

export async function runRuntimeJob(
  runtimeUrl: string,
  jobId: string,
  runtimeApiKey?: string,
): Promise<RuntimeJobRunResponse> {
  return runtimeRequest<RuntimeJobRunResponse>(runtimeUrl, `/jobs/${encodeURIComponent(jobId)}/run`, {
    method: "POST",
  }, runtimeApiKey);
}

export async function retryRuntimeJob(
  runtimeUrl: string,
  jobId: string,
  runtimeApiKey?: string,
): Promise<RuntimeJobRunResponse> {
  return runtimeRequest<RuntimeJobRunResponse>(runtimeUrl, `/jobs/${encodeURIComponent(jobId)}/retry`, {
    method: "POST",
  }, runtimeApiKey);
}

export async function scheduleRuntimeJob(
  runtimeUrl: string,
  jobId: string,
  delaySeconds: number,
  runtimeApiKey?: string,
): Promise<RuntimeJobRunResponse> {
  return runtimeRequest<RuntimeJobRunResponse>(runtimeUrl, `/jobs/${encodeURIComponent(jobId)}/schedule`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ delay_seconds: Math.max(0, delaySeconds) }),
  }, runtimeApiKey);
}

export async function createRuntimeJobRecurrence(
  runtimeUrl: string,
  jobId: string,
  intervalSeconds: number,
  delaySeconds = 0,
  runtimeApiKey?: string,
): Promise<RuntimeJobScheduleResponse> {
  return runtimeRequest<RuntimeJobScheduleResponse>(
    runtimeUrl,
    `/jobs/${encodeURIComponent(jobId)}/recurrence`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        interval_seconds: Math.max(60, Math.round(intervalSeconds)),
        delay_seconds: Math.max(0, delaySeconds),
      }),
    },
    runtimeApiKey,
  );
}

export async function createRuntimeJobCron(
  runtimeUrl: string,
  jobId: string,
  cronExpression: string,
  runtimeApiKey?: string,
): Promise<RuntimeJobScheduleResponse> {
  return runtimeRequest<RuntimeJobScheduleResponse>(
    runtimeUrl,
    `/jobs/${encodeURIComponent(jobId)}/recurrence`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        trigger_type: "cron",
        cron_expression: cronExpression,
      }),
    },
    runtimeApiKey,
  );
}

export async function createRuntimeJobEventSchedule(
  runtimeUrl: string,
  jobId: string,
  eventType: string,
  runtimeApiKey?: string,
): Promise<RuntimeJobScheduleResponse> {
  return runtimeRequest<RuntimeJobScheduleResponse>(
    runtimeUrl,
    `/jobs/${encodeURIComponent(jobId)}/recurrence`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        trigger_type: "event",
        event_type: eventType,
      }),
    },
    runtimeApiKey,
  );
}

export async function runDueRuntimeJobSchedules(
  runtimeUrl: string,
  limit = 50,
  runtimeApiKey?: string,
): Promise<RuntimeJobScheduleBatchResponse> {
  const params = new URLSearchParams({ limit: String(Math.max(1, Math.min(200, Math.round(limit)))) });
  return runtimeRequest<RuntimeJobScheduleBatchResponse>(runtimeUrl, `/job-schedules/run-due?${params.toString()}`, {
    method: "POST",
  }, runtimeApiKey);
}

export async function triggerRuntimeJobScheduleEvent(
  runtimeUrl: string,
  eventType: string,
  sessionId?: string,
  payload: Record<string, unknown> = {},
  limit = 50,
  runtimeApiKey?: string,
): Promise<RuntimeJobScheduleBatchResponse> {
  return runtimeRequest<RuntimeJobScheduleBatchResponse>(
    runtimeUrl,
    "/job-schedules/trigger-event",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event_type: eventType,
        session_id: sessionId || undefined,
        payload,
        limit: Math.max(1, Math.min(200, Math.round(limit))),
      }),
    },
    runtimeApiKey,
  );
}

export async function disableRuntimeJobSchedule(
  runtimeUrl: string,
  scheduleId: string,
  runtimeApiKey?: string,
): Promise<RuntimeJobScheduleResponse> {
  return runtimeRequest<RuntimeJobScheduleResponse>(
    runtimeUrl,
    `/job-schedules/${encodeURIComponent(scheduleId)}/disable`,
    { method: "POST" },
    runtimeApiKey,
  );
}

export async function runPendingRuntimeJobs(
  runtimeUrl: string,
  sessionId?: string,
  limit = 50,
  runtimeApiKey?: string,
): Promise<RuntimeJobBatchResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (sessionId) {
    params.set("session_id", sessionId);
  }
  return runtimeRequest<RuntimeJobBatchResponse>(runtimeUrl, `/jobs/run-pending?${params.toString()}`, {
    method: "POST",
  }, runtimeApiKey);
}

export async function retryFailedRuntimeJobs(
  runtimeUrl: string,
  sessionId?: string,
  limit = 50,
  runtimeApiKey?: string,
): Promise<RuntimeJobBatchResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (sessionId) {
    params.set("session_id", sessionId);
  }
  return runtimeRequest<RuntimeJobBatchResponse>(runtimeUrl, `/jobs/retry-failed?${params.toString()}`, {
    method: "POST",
  }, runtimeApiKey);
}

export async function cleanupRuntimeJobs(
  runtimeUrl: string,
  payload: {
    statuses?: string[];
    older_than_hours?: number;
    session_id?: string;
    limit?: number;
    dry_run?: boolean;
  },
  runtimeApiKey?: string,
): Promise<RuntimeJobCleanupResponse> {
  return runtimeRequest<RuntimeJobCleanupResponse>(
    runtimeUrl,
    "/jobs/cleanup",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        statuses: payload.statuses ?? ["succeeded", "failed"],
        older_than_hours: Math.max(0, payload.older_than_hours ?? 168),
        session_id: payload.session_id || undefined,
        limit: Math.max(1, Math.min(1000, Math.round(payload.limit ?? 100))),
        dry_run: payload.dry_run ?? true,
      }),
    },
    runtimeApiKey,
  );
}

export async function runtimeAuthAudit(
  runtimeUrl: string,
  limit = 50,
  runtimeApiKey?: string,
): Promise<RuntimeAuthAudit> {
  const safeLimit = Math.max(1, Math.min(500, Math.round(limit)));
  return runtimeRequest<RuntimeAuthAudit>(runtimeUrl, `/auth/audit?limit=${safeLimit}`, undefined, runtimeApiKey);
}

export async function runtimeAuthKeys(runtimeUrl: string, runtimeApiKey?: string): Promise<RuntimeAuthKeys> {
  return runtimeRequest<RuntimeAuthKeys>(runtimeUrl, "/auth/keys", undefined, runtimeApiKey);
}

export async function listStudioRuns(flowId: string, query: StudioRunQuery = {}): Promise<StudioRunList> {
  const params = new URLSearchParams();
  if (query.q) {
    params.set("q", query.q);
  }
  if (query.agentId) {
    params.set("agentId", query.agentId);
  }
  if (query.status) {
    params.set("status", query.status);
  }
  if (query.phase) {
    params.set("phase", query.phase);
  }
  if (query.hasErrors !== undefined) {
    params.set("hasErrors", query.hasErrors ? "true" : "false");
  }
  if (query.isComplete !== undefined) {
    params.set("isComplete", query.isComplete ? "true" : "false");
  }
  if (query.node) {
    params.set("node", query.node);
  }
  if (query.minDurationMs !== undefined) {
    params.set("minDurationMs", String(query.minDurationMs));
  }
  if (query.maxDurationMs !== undefined) {
    params.set("maxDurationMs", String(query.maxDurationMs));
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<StudioRunList>(`/flows/${encodeURIComponent(flowId)}/studio-runs${suffix}`);
}

export async function loadStudioRun(flowId: string, runId: string): Promise<StudioRunRecord> {
  return request<StudioRunRecord>(`/flows/${encodeURIComponent(flowId)}/studio-runs/${encodeURIComponent(runId)}`);
}

export async function loadStudioProviderTelemetry(
  flowId: string,
  query: StudioProviderTelemetryQuery = {},
): Promise<StudioProviderTelemetryReport> {
  const params = new URLSearchParams();
  if (query.windowHours !== undefined) {
    params.set("windowHours", String(query.windowHours));
  }
  if (query.providerTokenBudget !== undefined) {
    params.set("providerTokenBudget", String(query.providerTokenBudget));
  }
  if (query.providerCostBudgetUsd !== undefined) {
    params.set("providerCostBudgetUsd", String(query.providerCostBudgetUsd));
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<StudioProviderTelemetryReport>(`/flows/${encodeURIComponent(flowId)}/studio-runs/provider-telemetry${suffix}`);
}

export async function loadStudioSandboxTelemetry(
  flowId: string,
  query: StudioSandboxTelemetryQuery = {},
): Promise<StudioSandboxTelemetryReport> {
  const params = new URLSearchParams();
  if (query.windowHours !== undefined) {
    params.set("windowHours", String(query.windowHours));
  }
  if (query.onlyFailures !== undefined) {
    params.set("onlyFailures", query.onlyFailures ? "true" : "false");
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request<StudioSandboxTelemetryReport>(`/flows/${encodeURIComponent(flowId)}/studio-runs/sandbox-telemetry${suffix}`);
}

export async function exportStudioRun(flowId: string, runId: string): Promise<StudioRunExport> {
  return request<StudioRunExport>(`/flows/${encodeURIComponent(flowId)}/studio-runs/${encodeURIComponent(runId)}/export`);
}

export async function compareStudioRuns(
  flowId: string,
  leftRunId: string,
  rightRunId: string,
): Promise<StudioRunComparison> {
  const params = new URLSearchParams({
    left: leftRunId,
    right: rightRunId,
  });
  return request<StudioRunComparison>(`/flows/${encodeURIComponent(flowId)}/studio-runs/compare?${params.toString()}`);
}

export async function saveStudioRun(
  flowId: string,
  payload: {
    runtimeUrl: string;
    resourceName: string;
    session: SessionView;
    transcript: MessageView[];
    events: EventView[];
    logs: string[];
  },
): Promise<StudioRunRecord> {
  return request<StudioRunRecord>(`/flows/${encodeURIComponent(flowId)}/studio-runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function loadStudioAnnotationQueue(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/annotation-queue`);
}

export async function saveStudioAnnotationQueue(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/annotation-queue`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function mergeStudioAnnotationQueue(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/annotation-queue/merge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function loadStudioAnnotationQueueConflictReview(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/annotation-queue/conflicts-review`);
}

export async function compareStudioAnnotationQueueConflictReview(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/annotation-queue/conflicts-review/diff`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updateStudioAnnotationQueueConflictCuration(
  flowId: string,
  conflictId: string,
  action: "assign" | "release",
  actor = "local-studio",
  note = "",
): Promise<unknown> {
  return request<unknown>(
    `/flows/${encodeURIComponent(flowId)}/annotation-queue/conflicts/${encodeURIComponent(conflictId)}/curation`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, actor, note }),
    },
  );
}

export async function loadStudioAnnotationQueueCentralSyncStatus(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/annotation-queue/central`);
}

export async function syncCentralStudioAnnotationQueue(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/annotation-queue/sync-central`, {
    method: "POST",
  });
}

export async function loadSchemaPatternLibrary(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/schema-pattern-library`);
}

export async function saveSchemaPatternLibrary(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/schema-pattern-library`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function mergeSchemaPatternLibrary(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/schema-pattern-library/merge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function loadSchemaPatternCentralSyncStatus(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/schema-pattern-library/central`);
}

export async function syncCentralSchemaPatterns(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/schema-pattern-library/sync-central`, {
    method: "POST",
  });
}

export async function loadSchemaPatternConflictReview(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/schema-pattern-library/conflicts-review`);
}

export async function compareSchemaPatternConflictReview(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/schema-pattern-library/conflicts-review/diff`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function resolveSchemaPatternLibraryConflict(
  flowId: string,
  conflictId: string,
  resolvedBy: string,
  resolution = "accept_current_library",
  resolutionNote = "",
  extraPayload: Record<string, unknown> = {},
): Promise<unknown> {
  return request<unknown>(
    `/flows/${encodeURIComponent(flowId)}/schema-pattern-library/conflicts/${encodeURIComponent(conflictId)}/resolve`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...extraPayload, resolvedBy, resolution, resolutionNote }),
    },
  );
}

export async function loadSchemaPatternHistory(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/schema-pattern-history`);
}

export async function saveSchemaPatternHistory(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/schema-pattern-history`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function mergeSchemaPatternHistory(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/schema-pattern-history/merge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function loadStudioExperimentDashboardHistory(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/experiment-dashboard-history`);
}

export async function loadStudioExperimentDashboardHistoryCentralStatus(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/experiment-dashboard-history/central`);
}

export async function saveStudioExperimentDashboardSnapshot(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/experiment-dashboard-history`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function mergeStudioExperimentDashboardHistory(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/experiment-dashboard-history/merge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function compareStudioExperimentDashboardHistory(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/experiment-dashboard-history/diff`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function syncCentralStudioExperimentDashboardHistory(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/experiment-dashboard-history/sync-central`, {
    method: "POST",
  });
}

export async function loadProviderTelemetryDashboardHistory(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/provider-telemetry-dashboard-history`);
}

export async function loadProviderTelemetryDashboardHistoryCentralStatus(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/provider-telemetry-dashboard-history/central`);
}

export async function saveProviderTelemetryDashboardSnapshot(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/provider-telemetry-dashboard-history`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function mergeProviderTelemetryDashboardHistory(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/provider-telemetry-dashboard-history/merge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function compareProviderTelemetryDashboardHistory(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/provider-telemetry-dashboard-history/diff`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function syncCentralProviderTelemetryDashboardHistory(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/provider-telemetry-dashboard-history/sync-central`, {
    method: "POST",
  });
}

export async function loadRuntimeJobMetricsHistory(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/runtime-job-metrics-history`);
}

export async function loadRuntimeJobMetricsHistoryCentralStatus(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/runtime-job-metrics-history/central`);
}

export async function saveRuntimeJobMetricsSnapshot(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/runtime-job-metrics-history`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function mergeRuntimeJobMetricsHistory(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/runtime-job-metrics-history/merge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function compareRuntimeJobMetricsHistory(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/runtime-job-metrics-history/diff`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function syncCentralRuntimeJobMetricsHistory(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/runtime-job-metrics-history/sync-central`, {
    method: "POST",
  });
}

export async function loadReplayGovernanceHistory(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/replay-governance-history`);
}

export async function saveReplayGovernanceHistory(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/replay-governance-history`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function mergeReplayGovernanceHistory(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/replay-governance-history/merge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function loadReplayGovernanceHistoryConflictReview(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/replay-governance-history/conflicts-review`);
}

export async function compareReplayGovernanceHistoryConflictReview(
  flowId: string,
  payload: unknown,
): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/replay-governance-history/conflicts-review/diff`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function resolveReplayGovernanceHistoryConflict(
  flowId: string,
  conflictId: string,
  payload: {
    keepSnapshotHash: string;
    resolvedBy?: string;
    resolvedRole?: "owner" | "reviewer" | "viewer";
    resolutionNote?: string;
    note?: string;
  },
): Promise<unknown> {
  return request<unknown>(
    `/flows/${encodeURIComponent(flowId)}/replay-governance-history/conflicts/${encodeURIComponent(conflictId)}/resolve`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export async function updateReplayGovernanceHistoryConflictCuration(
  flowId: string,
  conflictId: string,
  payload: unknown,
): Promise<unknown> {
  return request<unknown>(
    `/flows/${encodeURIComponent(flowId)}/replay-governance-history/conflicts/${encodeURIComponent(conflictId)}/curation`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export async function loadReplayGovernanceHistoryCentralSyncStatus(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/replay-governance-history/central`);
}

export async function syncCentralReplayGovernanceHistory(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/replay-governance-history/sync-central`, {
    method: "POST",
  });
}

export async function loadDebugLayerSnapshots(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/debug-layer-snapshots`);
}

export async function mergeDebugLayerSnapshots(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/debug-layer-snapshots/merge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function loadDebugLayerSnapshotConflictReview(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/debug-layer-snapshots/conflicts-review`);
}

export async function compareDebugLayerSnapshotConflictReview(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/debug-layer-snapshots/conflicts-review/diff`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function resolveDebugLayerSnapshotConflict(
  flowId: string,
  conflictId: string,
  payload: unknown,
): Promise<unknown> {
  return request<unknown>(
    `/flows/${encodeURIComponent(flowId)}/debug-layer-snapshots/conflicts/${encodeURIComponent(conflictId)}/resolve`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export async function updateDebugLayerSnapshotConflictCuration(
  flowId: string,
  conflictId: string,
  payload: unknown,
): Promise<unknown> {
  return request<unknown>(
    `/flows/${encodeURIComponent(flowId)}/debug-layer-snapshots/conflicts/${encodeURIComponent(conflictId)}/curation`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export async function loadDebugLayerSnapshotsCentralSyncStatus(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/debug-layer-snapshots/central`);
}

export async function syncCentralDebugLayerSnapshots(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/debug-layer-snapshots/sync-central`, {
    method: "POST",
  });
}

export async function loadOrchestrationDebugHistory(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/orchestration-debug-history`);
}

export async function saveOrchestrationDebugHistory(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/orchestration-debug-history`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function mergeOrchestrationDebugHistory(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/orchestration-debug-history/merge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function compareOrchestrationDebugHistory(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/orchestration-debug-history/diff`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function loadOrchestrationDebugHistoryCentralSyncStatus(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/orchestration-debug-history/central`);
}

export async function syncCentralOrchestrationDebugHistory(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/orchestration-debug-history/sync-central`, {
    method: "POST",
  });
}

export async function loadSharedStudioScenarios(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/studio-scenarios`);
}

export async function loadSharedStudioScenariosConflictReview(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/studio-scenarios/conflicts-review`);
}

export async function compareSharedStudioScenariosConflictReview(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/studio-scenarios/conflicts-review/diff`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function saveSharedStudioScenarios(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/studio-scenarios`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function mergeSharedStudioScenarios(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/studio-scenarios/merge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function curateSharedStudioScenarioConflict(
  flowId: string,
  conflictId: string,
  payload: unknown,
): Promise<unknown> {
  return request<unknown>(
    `/flows/${encodeURIComponent(flowId)}/studio-scenarios/conflicts/${encodeURIComponent(conflictId)}/curation`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export async function resolveSharedStudioScenarioConflict(
  flowId: string,
  conflictId: string,
  payload: unknown,
): Promise<unknown> {
  return request<unknown>(
    `/flows/${encodeURIComponent(flowId)}/studio-scenarios/conflicts/${encodeURIComponent(conflictId)}/resolve`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export async function loadSharedStudioScenariosCentralStatus(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/studio-scenarios/central`);
}

export async function syncCentralSharedStudioScenarios(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/studio-scenarios/sync-central`, {
    method: "POST",
  });
}

export async function loadRegressionAlerts(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/regression-alerts`);
}

export async function loadRegressionAlertsCentralSyncStatus(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/regression-alerts/central`);
}

export async function saveRegressionAlerts(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/regression-alerts`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function mergeRegressionAlerts(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/regression-alerts/merge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function syncCentralRegressionAlerts(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/regression-alerts/sync-central`, {
    method: "POST",
  });
}

export async function loadProviderTelemetryAlerts(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/provider-telemetry-alerts`);
}

export async function loadProviderTelemetryAlertsCentralSyncStatus(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/provider-telemetry-alerts/central`);
}

export async function loadProviderTelemetryAlertDispatchStatus(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/provider-telemetry-alerts/dispatch`);
}

export async function loadProviderTelemetryAlertDeliveryReadiness(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/provider-telemetry-alerts/delivery-readiness`);
}

export async function saveProviderTelemetryAlerts(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/provider-telemetry-alerts`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function mergeProviderTelemetryAlerts(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/provider-telemetry-alerts/merge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function syncCentralProviderTelemetryAlerts(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/provider-telemetry-alerts/sync-central`, {
    method: "POST",
  });
}

export async function dispatchProviderTelemetryAlerts(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/provider-telemetry-alerts/dispatch`, {
    method: "POST",
  });
}

export async function listSafetyHarnessRuns(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/safety-harness/runs`);
}

export async function loadSafetyHarnessCentralSyncStatus(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/safety-harness/central`);
}

export async function evaluateSafetyHarness(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/safety-harness/evaluate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function reviewSafetyHarnessRun(flowId: string, runId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(
    `/flows/${encodeURIComponent(flowId)}/safety-harness/runs/${encodeURIComponent(runId)}/review`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export async function syncCentralSafetyHarness(flowId: string): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/safety-harness/sync-central`, {
    method: "POST",
  });
}

export async function compareSafetyHarnessHistory(flowId: string, payload: unknown): Promise<unknown> {
  return request<unknown>(`/flows/${encodeURIComponent(flowId)}/safety-harness/diff`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function evaluateExternalEvaluator(payload: ExternalEvaluatorRequest): Promise<ExternalEvaluatorResult> {
  return request<ExternalEvaluatorResult>("/evaluators/external", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  applyBuilderApiKeyHeader(headers);
  const response = await fetch(`${builderApiUrl()}${path}`, {
    ...init,
    headers,
  });
  return parseResponse<T>(response);
}

async function dockerRuntimeCommand(
  operation:
    | "prepare-env"
    | "setup-models"
    | "build-model-image"
    | "export-model-image"
    | "push-model-image"
    | "check-gpu"
    | "build"
    | "cancel"
    | "up"
    | "down"
    | "smoke"
    | "smoke-all"
    | "inspect",
  outDir: string,
  runtimeUrl?: string,
  agentId?: string,
): Promise<DockerRuntimeOperationResult> {
  return request<DockerRuntimeOperationResult>(`/docker-runtime/${operation}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ outDir, runtimeUrl, agentId }),
  });
}

async function runtimeRequest<T>(
  runtimeUrl: string,
  path: string,
  init?: RequestInit,
  runtimeApiKey?: string,
): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  applyRuntimeApiKeyHeader(headers, runtimeApiKey);
  const response = await fetch(`${runtimeUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers,
  });
  return parseResponse<T>(response);
}

function applyRuntimeApiKeyHeader(headers: Headers, runtimeApiKey?: string): void {
  const trimmed = runtimeApiKey?.trim();
  if (trimmed && !headers.has("X-Agent-API-Key")) {
    headers.set("X-Agent-API-Key", trimmed);
  }
}

function applyBuilderApiKeyHeader(headers: Headers): void {
  const session = storedBuilderAuthSession();
  if (session && !headers.has("Authorization") && !headers.has("X-Agent-Flow-Builder-Key")) {
    headers.set("Authorization", `Bearer ${session.token}`);
    return;
  }
  const configured = (import.meta.env.VITE_BUILDER_API_KEY || storedBuilderApiKey()).trim();
  if (configured && !headers.has("X-Agent-Flow-Builder-Key")) {
    headers.set("X-Agent-Flow-Builder-Key", configured);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw responseErrorFromPayload(response, payload);
  }
  return payload as T;
}

async function* readSseEnvelopes(stream: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    let boundary = findSseBoundary(buffer);
    while (boundary >= 0) {
      const rawEvent = buffer.slice(0, boundary);
      const separatorLength = buffer.startsWith("\r\n\r\n", boundary) ? 4 : 2;
      buffer = buffer.slice(boundary + separatorLength);
      const parsed = parseSseEnvelope(rawEvent);
      if (parsed) {
        yield parsed;
      }
      boundary = findSseBoundary(buffer);
    }
    if (done) {
      const parsed = parseSseEnvelope(buffer);
      if (parsed) {
        yield parsed;
      }
      return;
    }
  }
}

function findSseBoundary(value: string): number {
  const crlf = value.indexOf("\r\n\r\n");
  const lf = value.indexOf("\n\n");
  if (crlf < 0) {
    return lf;
  }
  if (lf < 0) {
    return crlf;
  }
  return Math.min(crlf, lf);
}

function parseSseEnvelope(rawEvent: string): { event: string; data: string } | null {
  if (!rawEvent.trim()) {
    return null;
  }
  let event = "message";
  const dataLines: string[] = [];
  for (const rawLine of rawEvent.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }
  return { event, data: dataLines.join("\n") };
}

function parseRuntimeTurnStreamEvent(event: string, rawData: string): RuntimeTurnStreamEvent | null {
  const data = parseJsonRecord(rawData);
  if (!data) {
    return null;
  }
  return normalizeRuntimeTurnStreamEvent(event, data);
}

function parseRuntimeTurnWebSocketEvent(value: unknown): RuntimeTurnStreamEvent | null {
  if (typeof value !== "string") {
    return null;
  }
  const envelope = parseJsonRecord(value);
  if (!envelope || typeof envelope.event !== "string") {
    return null;
  }
  const data = envelope.data && typeof envelope.data === "object" && !Array.isArray(envelope.data)
    ? (envelope.data as Record<string, unknown>)
    : null;
  if (!data) {
    return null;
  }
  return normalizeRuntimeTurnStreamEvent(envelope.event, data);
}

function normalizeRuntimeTurnStreamEvent(event: string, data: Record<string, unknown>): RuntimeTurnStreamEvent | null {
  if (event === "token") {
    return {
      event,
      data: {
        index: Number(data.index) || 0,
        text: typeof data.text === "string" ? data.text : "",
        source: typeof data.source === "string" ? data.source : undefined,
      },
    };
  }
  if (event === "turn_completed") {
    return { event, data: data as unknown as RuntimeTurnResponse };
  }
  if (event === "turn_started" || event === "stream_closed" || event === "turn_error") {
    return { event, data };
  }
  return null;
}

function buildRuntimeTurnStreamWebSocketUrl(
  runtimeUrl: string,
  resourceName: string,
  sessionId: string,
  userMessage: string,
  idempotencyKey: string,
  runtimeApiKey?: string,
): string {
  const base = runtimeUrl.replace(/\/$/, "").replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
  const params = new URLSearchParams({
    user_message: userMessage,
    idempotency_key: idempotencyKey,
  });
  if (runtimeApiKey?.trim()) {
    params.set("api_key", runtimeApiKey.trim());
  }
  return `${base}/${encodeURIComponent(resourceName)}/${encodeURIComponent(sessionId)}/turn/stream/ws?${params.toString()}`;
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readRuntimeStreamError(data: Record<string, unknown>): string {
  if (typeof data.detail === "string") {
    return data.detail;
  }
  if (typeof data.status_code === "number") {
    return `Erro ${data.status_code} no stream do turno.`;
  }
  return "Erro no stream do turno.";
}

function generatedArtifactQuery(outDir: string, filePath?: string, runtimeUrl?: string): string {
  const params = new URLSearchParams({ outDir });
  if (filePath) {
    params.set("path", filePath);
  }
  if (runtimeUrl) {
    params.set("runtimeUrl", runtimeUrl);
  }
  return params.toString();
}

function generatedRuntimeHistoryQuery(
  outDir: string,
  runtimeUrl: string | undefined,
  limit: number,
  filters: Omit<DockerRuntimeHistoryQuery, "limit">,
): string {
  const params = new URLSearchParams({ outDir, limit: String(limit) });
  if (runtimeUrl) {
    params.set("runtimeUrl", runtimeUrl);
  }
  if (filters.operation) {
    params.set("operation", filters.operation);
  }
  if (filters.status) {
    params.set("status", filters.status);
  }
  if (filters.ok !== undefined) {
    params.set("ok", filters.ok ? "true" : "false");
  }
  if (filters.search) {
    params.set("search", filters.search);
  }
  if (filters.level) {
    params.set("level", filters.level);
  }
  if (filters.progressStage) {
    params.set("progressStage", filters.progressStage);
  }
  if (filters.progressStatus) {
    params.set("progressStatus", filters.progressStatus);
  }
  if (filters.from) {
    params.set("from", filters.from);
  }
  if (filters.to) {
    params.set("to", filters.to);
  }
  return params.toString();
}

async function responseError(response: Response): Promise<Error> {
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  return responseErrorFromPayload(response, payload);
}

function responseErrorFromPayload(response: Response, payload: unknown): Error {
  const candidate = payload && typeof payload === "object" ? (payload as { message?: string; error?: string }) : null;
  return new Error(candidate?.message || candidate?.error || `HTTP ${response.status}`);
}
