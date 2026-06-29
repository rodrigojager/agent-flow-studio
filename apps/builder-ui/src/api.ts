import type {
  EventView,
  FlowAssetContent,
  FlowAssetDeleteResult,
  FlowAssetMutationResult,
  FlowSummary,
  FlowWorkspaceExport,
  FlowWorkspaceImportResult,
  GenerateResult,
  GeneratedArtifactFileContent,
  GeneratedArtifactListing,
  AgentFlow,
  LlmAdapterCatalogResult,
  LoadedFlow,
  MessageView,
  LoadedRuntimeManifest,
  RuntimeManifestGenerateResult,
  RuntimeManifestValidationResult,
  SandboxListResult,
  SandboxStatus,
  SessionView,
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

export async function createRuntimeSession(runtimeUrl: string, resourceName: string): Promise<{ session: SessionView }> {
  return runtimeRequest<{ session: SessionView }>(runtimeUrl, `/${resourceName}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": `ui-create-${Date.now()}`,
    },
    body: JSON.stringify({ metadata: { source: "builder-ui" }, max_turns: 3 }),
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${builderApiUrl()}${path}`, init);
  return parseResponse<T>(response);
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

function generatedArtifactQuery(outDir: string, filePath?: string): string {
  const params = new URLSearchParams({ outDir });
  if (filePath) {
    params.set("path", filePath);
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
