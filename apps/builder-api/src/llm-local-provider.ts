import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findLlmAdapter, type LlmAdapterCatalogItem } from "@agent-flow-builder/flow-spec";

const execFileAsync = promisify(execFile);

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

export interface LlmModelCatalogQuery {
  baseUrl?: string;
  baseUrlEnv?: string;
  apiKeyEnv?: string;
}

export interface LlmModelCatalogItem {
  id: string;
  label: string;
  description?: string;
  contextLength?: number;
  source: "official" | "local" | "fallback";
}

export interface LlmModelCatalogResult {
  format: "agent-flow-builder.llm-model-catalog.v1";
  adapter: string;
  provider: "codex-cli" | "ollama" | "openai-compatible" | "openrouter" | "unsupported";
  status: "ok" | "fallback" | "unsupported_adapter" | "blocked" | "unreachable" | "error";
  ok: boolean;
  checkedAt: string;
  baseUrl: string | null;
  modelCount: number;
  models: LlmModelCatalogItem[];
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

interface OpenAiCompatibleModelsResponse {
  data?: unknown;
  models?: unknown;
}

interface CodexCliModelsResponse {
  models?: unknown;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

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

export async function listLlmAdapterModels(adapterIdInput: string, query: LlmModelCatalogQuery): Promise<LlmModelCatalogResult> {
  const adapterId = adapterIdInput.trim().toLowerCase();
  const adapter = findLlmAdapter(adapterId);
  const checkedAt = new Date().toISOString();

  if (!adapter) {
    return {
      format: "agent-flow-builder.llm-model-catalog.v1",
      adapter: adapterId || adapterIdInput,
      provider: "unsupported",
      status: "unsupported_adapter",
      ok: false,
      checkedAt,
      baseUrl: null,
      modelCount: 0,
      models: [],
      message: `Adaptador LLM desconhecido: ${adapterIdInput}.`,
      nextActions: ["Selecione um provider conhecido no catálogo de adapters."],
    };
  }

  if (adapter.id === "codex-cli") {
    return listCodexCliModels(adapter, checkedAt);
  }
  if (adapter.id === "ollama") {
    return listOllamaModelCatalog(adapter, query, checkedAt);
  }
  return listOpenAiCompatibleModelCatalog(adapter, query, checkedAt);
}

async function listCodexCliModels(adapter: LlmAdapterCatalogItem, checkedAt: string): Promise<LlmModelCatalogResult> {
  try {
    const live = await readCodexCliModels(false);
    const models = normalizeCodexCliModels(live, "official");
    return modelCatalogResult({
      adapter,
      provider: "codex-cli",
      status: "ok",
      ok: true,
      checkedAt,
      baseUrl: null,
      models,
      message: models.length ? "Modelos carregados pelo catálogo atual do Codex CLI." : "Codex CLI respondeu sem modelos listáveis.",
      nextActions: models.length ? ["Escolha um modelo da lista carregada pelo Codex CLI."] : ["Atualize o Codex CLI ou confira a configuração local."],
    });
  } catch (liveError) {
    try {
      const bundled = await readCodexCliModels(true);
      const models = normalizeCodexCliModels(bundled, "fallback");
      return modelCatalogResult({
        adapter,
        provider: "codex-cli",
        status: "fallback",
        ok: true,
        checkedAt,
        baseUrl: null,
        models,
        message: `Usei o catálogo bundled do Codex CLI porque a atualização ao vivo falhou: ${errorText(liveError)}`,
        nextActions: ["A lista está disponível, mas pode não refletir permissões atuais da conta."],
      });
    } catch (bundledError) {
      return fallbackModelCatalog(adapter, "codex-cli", checkedAt, null, `Não foi possível consultar o Codex CLI: ${errorText(bundledError)}`, [
        "Confirme que o comando codex está instalado no PATH.",
        "Rode codex debug models para diagnosticar o catálogo local.",
      ]);
    }
  }
}

async function listOllamaModelCatalog(
  adapter: LlmAdapterCatalogItem,
  query: LlmModelCatalogQuery,
  checkedAt: string,
): Promise<LlmModelCatalogResult> {
  const baseUrl = resolveAdapterBaseUrl(adapter, query) || adapter.defaultBaseUrl || "http://localhost:11434/v1";
  const parsed = normalizeOllamaBaseUrl(baseUrl);
  if (!parsed.ok) {
    return modelCatalogResult({
      adapter,
      provider: "ollama",
      status: "blocked",
      ok: false,
      checkedAt,
      baseUrl,
      models: fallbackModels(adapter),
      message: parsed.message,
      nextActions: ["Use uma base local como http://localhost:11434/v1 ou http://127.0.0.1:11434/v1."],
    });
  }
  try {
    const tagsResult = await fetchJsonWithTimeout<OllamaTagsResponse>(new URL("/api/tags", parsed.nativeBaseUrl).toString());
    const models = normalizeOllamaModels(tagsResult).map((modelName) => ({
      id: modelName,
      label: modelName,
      source: "local" as const,
    }));
    return modelCatalogResult({
      adapter,
      provider: "ollama",
      status: "ok",
      ok: true,
      checkedAt,
      baseUrl,
      models,
      message: models.length ? "Modelos locais carregados do Ollama." : "Ollama respondeu sem modelos instalados.",
      nextActions: models.length ? ["Escolha um modelo local instalado."] : ["Baixe um modelo local com ollama pull <modelo>."],
    });
  } catch (error) {
    return modelCatalogResult({
      adapter,
      provider: "ollama",
      status: "unreachable",
      ok: false,
      checkedAt,
      baseUrl,
      models: fallbackModels(adapter),
      message: `Não foi possível consultar modelos do Ollama: ${errorText(error)}`,
      nextActions: ["Inicie o Ollama localmente.", "Confirme que a porta 11434 está acessível em localhost."],
    });
  }
}

async function listOpenAiCompatibleModelCatalog(
  adapter: LlmAdapterCatalogItem,
  query: LlmModelCatalogQuery,
  checkedAt: string,
): Promise<LlmModelCatalogResult> {
  const baseUrl = resolveAdapterBaseUrl(adapter, query) || (adapter.id === "openai" ? OPENAI_DEFAULT_BASE_URL : "");
  if (!baseUrl) {
    return modelCatalogResult({
      adapter,
      provider: openAiCompatibleProvider(adapter),
      status: "blocked",
      ok: false,
      checkedAt,
      baseUrl: null,
      models: fallbackModels(adapter),
      message: `Base URL não configurada para ${adapter.label}.`,
      nextActions: [
        adapter.baseUrlEnv ? `Configure ${adapter.baseUrlEnv} no ambiente ou no Studio.` : "Configure a base URL do provider.",
      ],
    });
  }

  let modelsUrl: string;
  try {
    modelsUrl = openAiCompatibleModelsUrl(baseUrl);
  } catch {
    return modelCatalogResult({
      adapter,
      provider: openAiCompatibleProvider(adapter),
      status: "blocked",
      ok: false,
      checkedAt,
      baseUrl,
      models: fallbackModels(adapter),
      message: "Base URL inválida para consulta de modelos.",
      nextActions: ["Use uma URL HTTP(S) compatível com o endpoint /models."],
    });
  }

  const apiKey = resolveAdapterApiKey(adapter, query);
  const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  try {
    const response = await fetchJsonWithTimeout<OpenAiCompatibleModelsResponse>(modelsUrl, 5000, headers);
    const models = normalizeOpenAiCompatibleModels(response);
    return modelCatalogResult({
      adapter,
      provider: openAiCompatibleProvider(adapter),
      status: "ok",
      ok: true,
      checkedAt,
      baseUrl,
      models,
      message: models.length ? `Modelos carregados de ${modelsUrl}.` : `Provider respondeu sem modelos em ${modelsUrl}.`,
      nextActions: models.length ? ["Escolha um modelo retornado pelo provider."] : ["Confirme se o endpoint /models está habilitado neste provider."],
    });
  } catch (error) {
    return modelCatalogResult({
      adapter,
      provider: openAiCompatibleProvider(adapter),
      status: "unreachable",
      ok: false,
      checkedAt,
      baseUrl,
      models: fallbackModels(adapter),
      message: `Não foi possível consultar ${modelsUrl}: ${errorText(error)}`,
      nextActions: [
        apiKey ? "Confirme se a chave e o endpoint aceitam listar modelos." : `Configure ${query.apiKeyEnv || adapter.apiKeyEnv} se o provider exigir autenticação.`,
      ],
    });
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

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 2500, headers: Record<string, string> = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
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

async function readCodexCliModels(bundled: boolean): Promise<CodexCliModelsResponse> {
  const args = ["debug", "models"];
  if (bundled) {
    args.push("--bundled");
  }
  if (process.platform === "win32") {
    const command = `codex ${args.join(" ")}`;
    const result = await execFileAsync("cmd.exe", ["/d", "/s", "/c", command], {
      timeout: 8000,
      maxBuffer: 6 * 1024 * 1024,
      windowsHide: true,
    });
    return JSON.parse(result.stdout) as CodexCliModelsResponse;
  }
  const result = await execFileAsync("codex", args, {
    timeout: 8000,
    maxBuffer: 6 * 1024 * 1024,
    windowsHide: true,
  });
  return JSON.parse(result.stdout) as CodexCliModelsResponse;
}

function normalizeCodexCliModels(response: CodexCliModelsResponse, source: "official" | "fallback"): LlmModelCatalogItem[] {
  const models = Array.isArray(response.models) ? response.models : [];
  const normalized = new Map<string, LlmModelCatalogItem>();
  for (const item of models) {
    if (!isRecord(item)) {
      continue;
    }
    const visibility = firstString(item.visibility);
    if (visibility && visibility !== "list") {
      continue;
    }
    const id = firstString(item.slug, item.id, item.name);
    if (!id) {
      continue;
    }
    const label = firstString(item.display_name, item.label, item.name) || id;
    const description = firstString(item.description);
    normalized.set(id, {
      id,
      label,
      description: description || undefined,
      source,
    });
  }
  return [...normalized.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function normalizeOpenAiCompatibleModels(response: OpenAiCompatibleModelsResponse): LlmModelCatalogItem[] {
  const rawModels = Array.isArray(response.data) ? response.data : Array.isArray(response.models) ? response.models : [];
  const normalized = new Map<string, LlmModelCatalogItem>();
  for (const item of rawModels) {
    if (!isRecord(item)) {
      continue;
    }
    const id = firstString(item.id, item.slug, item.model, item.name);
    if (!id) {
      continue;
    }
    const label = firstString(item.name, item.display_name, item.label) || id;
    const description = firstString(item.description);
    const contextLength = firstNumber(item.context_length, item.contextLength, item.max_context_length, item.maxContextLength);
    normalized.set(id, {
      id,
      label,
      description: description || undefined,
      contextLength,
      source: "official",
    });
  }
  return [...normalized.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function resolveAdapterBaseUrl(adapter: LlmAdapterCatalogItem, query: LlmModelCatalogQuery): string {
  const direct = query.baseUrl?.trim();
  if (direct) {
    return direct;
  }
  const envName = query.baseUrlEnv?.trim() || adapter.baseUrlEnv;
  if (envName && isSafeEnvName(envName)) {
    const value = process.env[envName]?.trim();
    if (value) {
      return value;
    }
  }
  return adapter.defaultBaseUrl?.trim() || "";
}

function resolveAdapterApiKey(adapter: LlmAdapterCatalogItem, query: LlmModelCatalogQuery): string {
  const envName = query.apiKeyEnv?.trim() || adapter.apiKeyEnv;
  if (!envName || !isSafeEnvName(envName)) {
    return "";
  }
  return process.env[envName]?.trim() || "";
}

function openAiCompatibleModelsUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Unsupported URL protocol");
  }
  return new URL("models", parsed).toString();
}

function openAiCompatibleProvider(adapter: LlmAdapterCatalogItem): LlmModelCatalogResult["provider"] {
  return adapter.id === "openrouter" ? "openrouter" : "openai-compatible";
}

function modelCatalogResult(input: {
  adapter: LlmAdapterCatalogItem;
  provider: LlmModelCatalogResult["provider"];
  status: LlmModelCatalogResult["status"];
  ok: boolean;
  checkedAt: string;
  baseUrl: string | null;
  models: LlmModelCatalogItem[];
  message: string;
  nextActions: string[];
}): LlmModelCatalogResult {
  return {
    format: "agent-flow-builder.llm-model-catalog.v1",
    adapter: input.adapter.id,
    provider: input.provider,
    status: input.status,
    ok: input.ok,
    checkedAt: input.checkedAt,
    baseUrl: input.baseUrl,
    modelCount: input.models.length,
    models: input.models,
    message: input.message,
    nextActions: input.nextActions,
  };
}

function fallbackModelCatalog(
  adapter: LlmAdapterCatalogItem,
  provider: LlmModelCatalogResult["provider"],
  checkedAt: string,
  baseUrl: string | null,
  message: string,
  nextActions: string[],
): LlmModelCatalogResult {
  return modelCatalogResult({
    adapter,
    provider,
    status: "error",
    ok: false,
    checkedAt,
    baseUrl,
    models: fallbackModels(adapter),
    message,
    nextActions,
  });
}

function fallbackModels(adapter: LlmAdapterCatalogItem): LlmModelCatalogItem[] {
  const model = adapter.defaultModel.trim();
  if (!model || model === "default") {
    return [];
  }
  return [{ id: model, label: model, source: "fallback" }];
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSafeEnvName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
