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
  DockerRuntimeOperationResult,
  DockerRuntimeHistory,
  DockerRuntimeHistoryQuery,
  DockerRuntimePortUpdate,
  DockerRuntimeStatus,
  GeneratedArtifactFileContent,
  GeneratedArtifactListing,
  AgentFlow,
  LlmAdapterCatalogResult,
  LoadedFlow,
  LangGraphSandboxApprovalStatus,
  MessageView,
  LoadedRuntimeManifest,
  RuntimeManifestGenerateResult,
  RuntimeManifestValidationResult,
  SandboxListResult,
  SandboxStatus,
  SessionView,
  StudioRunList,
  StudioRunRecord,
  StudioRunQuery,
  StudioRunComparison,
  StudioRunExport,
  ValidationResult,
} from "./types.ts";

const DEFAULT_API_URL = "http://127.0.0.1:3333";

export function builderApiUrl(): string {
  return (import.meta.env.VITE_BUILDER_API_URL || DEFAULT_API_URL).replace(/\/$/, "");
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

export async function saveFlow(flowId: string, flow: AgentFlow): Promise<LoadedFlow> {
  return request<LoadedFlow>(`/flows/${encodeURIComponent(flowId)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(flow),
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

export async function approveLangGraphSandbox(flowId: string, outDir?: string): Promise<LangGraphSandboxApproval> {
  const result = await request<{ status: "ok"; approval: LangGraphSandboxApproval }>(
    `/flows/${encodeURIComponent(flowId)}/approve-langgraph-sandbox`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outDir }),
    },
  );
  return result.approval;
}

export async function readLangGraphSandboxApprovalStatus(flowId: string): Promise<LangGraphSandboxApprovalStatus> {
  return request<LangGraphSandboxApprovalStatus>(`/flows/${encodeURIComponent(flowId)}/langgraph-sandbox-approval-status`);
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
  const response = await fetch(`${builderApiUrl()}/artifacts/archive?${generatedArtifactQuery(outDir)}`);
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

export async function dockerRuntimeUp(outDir: string, runtimeUrl?: string): Promise<DockerRuntimeOperationResult> {
  return dockerRuntimeCommand("up", outDir, runtimeUrl);
}

export async function dockerRuntimeDown(outDir: string, runtimeUrl?: string): Promise<DockerRuntimeOperationResult> {
  return dockerRuntimeCommand("down", outDir, runtimeUrl);
}

export async function dockerRuntimeSmoke(outDir: string, runtimeUrl?: string): Promise<DockerRuntimeOperationResult> {
  return dockerRuntimeCommand("smoke", outDir, runtimeUrl);
}

export async function dockerRuntimeInspect(outDir: string, runtimeUrl?: string): Promise<DockerRuntimeOperationResult> {
  return dockerRuntimeCommand("inspect", outDir, runtimeUrl);
}

export async function loadRuntimeManifest(): Promise<LoadedRuntimeManifest> {
  return request<LoadedRuntimeManifest>("/runtime-manifest");
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

export async function sandboxStatus(flowId: string): Promise<SandboxStatus> {
  return request<SandboxStatus>(`/sandboxes/${encodeURIComponent(flowId)}/status`);
}

export async function listSandboxes(): Promise<SandboxListResult> {
  return request<SandboxListResult>("/sandboxes");
}

export async function startSandbox(flowId: string, port?: number): Promise<SandboxStatus> {
  return request<SandboxStatus>(`/sandboxes/${encodeURIComponent(flowId)}/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ port }),
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
): Promise<{ session: SessionView }> {
  return runtimeRequest<{ session: SessionView }>(runtimeUrl, `/${resourceName}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": `ui-create-${Date.now()}`,
    },
    body: JSON.stringify({ metadata: { source: "builder-ui", ...metadata }, max_turns: 3 }),
  });
}

export async function startRuntimeSession(
  runtimeUrl: string,
  resourceName: string,
  sessionId: string,
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
  );
}

export async function sendRuntimeTurn(
  runtimeUrl: string,
  resourceName: string,
  sessionId: string,
  userMessage: string,
): Promise<{ session: SessionView; assistant_message: { code: string; text: string } }> {
  return runtimeRequest<{ session: SessionView; assistant_message: { code: string; text: string } }>(
    runtimeUrl,
    `/${resourceName}/${sessionId}/turn`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": `ui-turn-${Date.now()}`,
      },
      body: JSON.stringify({ user_message: userMessage }),
    },
  );
}

export async function finishRuntimeSession(
  runtimeUrl: string,
  resourceName: string,
  sessionId: string,
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
  );
}

export async function runtimeTranscript(
  runtimeUrl: string,
  resourceName: string,
  sessionId: string,
): Promise<MessageView[]> {
  return runtimeRequest<MessageView[]>(runtimeUrl, `/${resourceName}/${sessionId}/transcript`);
}

export async function runtimeEvents(runtimeUrl: string, resourceName: string, sessionId: string): Promise<EventView[]> {
  return runtimeRequest<EventView[]>(runtimeUrl, `/${resourceName}/${sessionId}/events`);
}

export async function listStudioRuns(flowId: string, query: StudioRunQuery = {}): Promise<StudioRunList> {
  const params = new URLSearchParams();
  if (query.q) {
    params.set("q", query.q);
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${builderApiUrl()}${path}`, init);
  return parseResponse<T>(response);
}

async function dockerRuntimeCommand(
  operation: "prepare-env" | "build" | "cancel" | "up" | "down" | "smoke" | "inspect",
  outDir: string,
  runtimeUrl?: string,
): Promise<DockerRuntimeOperationResult> {
  return request<DockerRuntimeOperationResult>(`/docker-runtime/${operation}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ outDir, runtimeUrl }),
  });
}

async function runtimeRequest<T>(runtimeUrl: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${runtimeUrl.replace(/\/$/, "")}${path}`, init);
  return parseResponse<T>(response);
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw responseErrorFromPayload(response, payload);
  }
  return payload as T;
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
