import { findLlmAdapter } from "@agent-flow-builder/flow-spec";

export interface LocalLlmProviderStatusQuery {
  adapter?: string;
  baseUrl?: string;
  model?: string;
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

interface OllamaTagsResponse {
  models?: Array<{
    name?: unknown;
    model?: unknown;
  }>;
}

interface OllamaVersionResponse {
  version?: unknown;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export async function checkLocalLlmProviderStatus(query: LocalLlmProviderStatusQuery): Promise<LocalLlmProviderStatus> {
  const adapterId = (query.adapter || "ollama").trim() || "ollama";
  const adapter = findLlmAdapter(adapterId);
  const selectedModel = query.model?.trim() || adapter?.defaultModel || "";
  const checkedAt = new Date().toISOString();

  if (adapterId !== "ollama" || adapter?.status !== "supported") {
    return {
      format: "agent-flow-builder.local-llm-provider-status.v1",
      adapter: adapterId,
      provider: "unsupported",
      status: "unsupported_adapter",
      ok: false,
      checkedAt,
      baseUrl: query.baseUrl?.trim() || adapter?.defaultBaseUrl || "",
      selectedModel,
      selectedModelInstalled: false,
      modelCount: 0,
      models: [],
      message: "Healthcheck local disponível apenas para o adapter Ollama nesta camada.",
      nextActions: ["Selecione o adapter Ollama local para verificar modelos instalados sem cloud."],
    };
  }

  const baseUrl = query.baseUrl?.trim() || adapter.defaultBaseUrl || "http://localhost:11434/v1";
  const parsed = normalizeOllamaBaseUrl(baseUrl);
  if (!parsed.ok) {
    return {
      format: "agent-flow-builder.local-llm-provider-status.v1",
      adapter: adapterId,
      provider: "ollama",
      status: "blocked",
      ok: false,
      checkedAt,
      baseUrl,
      selectedModel,
      selectedModelInstalled: false,
      modelCount: 0,
      models: [],
      message: parsed.message,
      nextActions: ["Use uma base local como http://localhost:11434/v1 ou http://127.0.0.1:11434/v1."],
    };
  }

  try {
    const [tagsResult, versionResult] = await Promise.all([
      fetchJsonWithTimeout<OllamaTagsResponse>(new URL("/api/tags", parsed.nativeBaseUrl).toString()),
      fetchJsonWithTimeout<OllamaVersionResponse>(new URL("/api/version", parsed.nativeBaseUrl).toString()).catch(() => null),
    ]);
    const models = normalizeOllamaModels(tagsResult);
    const selectedModelInstalled = selectedModel ? models.includes(selectedModel) : undefined;
    const nextActions = selectedModelInstalled === false && selectedModel
      ? [`Baixe o modelo local com: ollama pull ${selectedModel}`]
      : ["O provedor local está pronto para execução sem chave paga."];
    return {
      format: "agent-flow-builder.local-llm-provider-status.v1",
      adapter: adapterId,
      provider: "ollama",
      status: "ok",
      ok: true,
      checkedAt,
      baseUrl,
      nativeBaseUrl: parsed.nativeBaseUrl,
      selectedModel,
      selectedModelInstalled,
      modelCount: models.length,
      models,
      version: typeof versionResult?.version === "string" ? versionResult.version : undefined,
      message: selectedModelInstalled === false
        ? `Ollama respondeu, mas o modelo ${selectedModel} não está instalado.`
        : "Ollama local respondeu com sucesso.",
      nextActions,
    };
  } catch (error) {
    return {
      format: "agent-flow-builder.local-llm-provider-status.v1",
      adapter: adapterId,
      provider: "ollama",
      status: "unreachable",
      ok: false,
      checkedAt,
      baseUrl,
      nativeBaseUrl: parsed.nativeBaseUrl,
      selectedModel,
      selectedModelInstalled: false,
      modelCount: 0,
      models: [],
      message: `Não foi possível consultar o Ollama local: ${error instanceof Error ? error.message : String(error)}`,
      nextActions: [
        "Inicie o Ollama localmente.",
        "Confirme que a porta 11434 está acessível em localhost.",
        selectedModel ? `Se o modelo ainda não existir, rode: ollama pull ${selectedModel}` : "Escolha um modelo local para o flow.",
      ],
    };
  }
}

function normalizeOllamaBaseUrl(baseUrl: string): { ok: true; nativeBaseUrl: string } | { ok: false; message: string } {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return { ok: false, message: "Base URL do Ollama inválida." };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, message: "Healthcheck local aceita apenas HTTP/HTTPS." };
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    return { ok: false, message: "Healthcheck local bloqueado para hosts remotos." };
  }
  if (parsed.pathname === "/v1" || parsed.pathname === "/v1/") {
    parsed.pathname = "/";
  }
  parsed.search = "";
  parsed.hash = "";
  return { ok: true, nativeBaseUrl: parsed.toString().replace(/\/$/, "") };
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 2500): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeOllamaModels(response: OllamaTagsResponse): string[] {
  const names = new Set<string>();
  for (const model of response.models ?? []) {
    const name = typeof model.name === "string" && model.name.trim() ? model.name.trim() : "";
    const fallback = typeof model.model === "string" && model.model.trim() ? model.model.trim() : "";
    if (name || fallback) {
      names.add(name || fallback);
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}
