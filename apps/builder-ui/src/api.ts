import type {
  EventView,
  FlowSummary,
  GenerateResult,
  AgentFlow,
  LoadedFlow,
  MessageView,
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

export async function saveFlow(flowId: string, flow: AgentFlow): Promise<LoadedFlow> {
  return request<LoadedFlow>(`/flows/${encodeURIComponent(flowId)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(flow),
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

export async function sandboxStatus(flowId: string): Promise<SandboxStatus> {
  return request<SandboxStatus>(`/sandboxes/${encodeURIComponent(flowId)}/status`);
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
    const message = payload?.message || payload?.error || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}
