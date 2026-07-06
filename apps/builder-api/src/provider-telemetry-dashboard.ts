import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadFlowById, WorkspaceError } from "./workspace.ts";
import type { AgentFlow } from "@agent-flow-builder/flow-spec";
import type {
  StudioProviderTelemetryAlert,
  StudioProviderTelemetryItem,
  StudioProviderTelemetryReport,
} from "./studio-runs.ts";

export interface StudioProviderTelemetryDashboardSnapshot {
  id: string;
  capturedAt: string;
  flow: {
    id: string;
    name: string;
    version: string;
    flowHash: string;
  };
  summary: {
    windowHours: number | null;
    providerTokenBudget: number | null;
    providerCostBudgetUsd: number | null;
    runCount: number;
    telemetryRunCount: number;
    eventCount: number;
    totalTokens: number;
    totalCostUsd: number;
    alertCount: number;
    providerModelCount: number;
    warningProviderModelCount: number;
  };
  telemetry: StudioProviderTelemetryReport;
}

type StudioProviderTelemetryDashboardTrend = "none" | "new" | "increased" | "decreased" | "stable";

export interface StudioProviderTelemetryDashboardHistoryAnalysis {
  latestTrend: StudioProviderTelemetryDashboardTrend;
  latestSnapshotId: string | null;
  previousSnapshotId: string | null;
  highestCostSnapshotId: string | null;
  highestTokenSnapshotId: string | null;
  firstCapturedAt: string | null;
  latestCapturedAt: string | null;
  latestTokenDelta: number | null;
  latestCostDeltaUsd: number | null;
  latestAlertDelta: number | null;
  latestProviderModelDelta: number | null;
  latestFlowChanged: boolean | null;
  averageTokens: number;
  averageCostUsd: number;
  totalAlertCount: number;
}

export interface StudioProviderTelemetryDashboardHistory {
  format: "agent-flow-builder.provider-telemetry-dashboard-history.v1";
  exportedAt: string;
  flow: {
    id: string;
    name: string;
    version: string;
  };
  snapshotCount: number;
  analysis: StudioProviderTelemetryDashboardHistoryAnalysis;
  governance: {
    includesRawRunEvents: false;
    includesRawState: false;
    includesSecretValues: false;
    includesSinkUrls: false;
    includesSinkTokens: false;
  };
  sharedSync: StudioProviderTelemetryDashboardSharedSyncInfo;
  snapshots: StudioProviderTelemetryDashboardSnapshot[];
}

type StudioProviderTelemetryDashboardSharedSyncAction = "empty" | "load" | "save" | "merge" | "central_sync";

interface StudioProviderTelemetryDashboardSharedSyncInfo {
  action: StudioProviderTelemetryDashboardSharedSyncAction;
  updatedAt: string;
  storage: string;
  contentHash: string;
  incomingCount: number;
  existingCount: number;
  addedCount: number;
  updatedCount: number;
  unchangedCount: number;
  finalCount: number;
  governance: {
    includesRawRunEvents: false;
    includesRawState: false;
    includesSecretValues: false;
    includesSinkUrls: false;
    includesSinkTokens: false;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
  };
}

interface StudioProviderTelemetryDashboardCentralSyncConfig {
  url: string | null;
  token: string | null;
  timeoutMs: number;
  invalidReason: string | null;
}

export interface StudioProviderTelemetryDashboardCentralSyncStatus {
  format: typeof PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_STATUS_FORMAT;
  generatedAt: string;
  configured: boolean;
  urlConfigured: boolean;
  tokenConfigured: boolean;
  timeoutMs: number;
  invalidReason: string | null;
  lastSyncedAt: string | null;
  statusCode: number | null;
  pushedSnapshotCount: number | null;
  pulledSnapshotCount: number | null;
  error: string | null;
  governance: {
    includesRawRunEvents: false;
    includesRawState: false;
    includesSecretValues: false;
    includesSinkUrls: false;
    includesSinkTokens: false;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
    storesCentralToken: false;
    configuredUrlEnv: typeof PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_URL_ENV;
    configuredTokenEnv: typeof PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_TOKEN_ENV;
    configuredTimeoutEnv: typeof PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_TIMEOUT_ENV;
    maxPayloadBytes: typeof PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_MAX_BYTES;
  };
}

export interface StudioProviderTelemetryDashboardCentralSyncResult {
  format: typeof PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_SYNC_RESULT_FORMAT;
  flowId: string;
  history: StudioProviderTelemetryDashboardHistory;
  central: StudioProviderTelemetryDashboardCentralSyncStatus;
  pushedSnapshotCount: number;
  pulledSnapshotCount: number;
  governance: {
    includesRawRunEvents: false;
    includesRawState: false;
    includesSecretValues: false;
    includesSinkUrls: false;
    includesSinkTokens: false;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
  };
}

interface StudioProviderTelemetryDashboardDiffRef {
  id: string;
  capturedAt: string;
  flowHash: string;
  summaryHash: string;
  telemetryHash: string;
  runCount: number;
  telemetryRunCount: number;
  eventCount: number;
  totalTokens: number;
  totalCostUsd: number;
  alertCount: number;
  providerModelCount: number;
  warningProviderModelCount: number;
}

interface StudioProviderTelemetryDashboardDiffSection {
  id: "added" | "removed" | "changed" | "unchanged";
  label: string;
  count: number;
  items: Array<{
    snapshotId: string;
    current: StudioProviderTelemetryDashboardDiffRef | null;
    incoming: StudioProviderTelemetryDashboardDiffRef | null;
  }>;
}

export interface StudioProviderTelemetryDashboardDiffPackage {
  format: typeof PROVIDER_TELEMETRY_DASHBOARD_DIFF_FORMAT;
  generatedAt: string;
  flow: {
    id: string;
    name: string;
    version: string;
  };
  packageHash: string;
  summary: {
    currentSnapshotCount: number;
    incomingSnapshotCount: number;
    addedCount: number;
    removedCount: number;
    changedCount: number;
    unchangedCount: number;
    headline: string;
  };
  sections: StudioProviderTelemetryDashboardDiffSection[];
  governance: {
    excludesTelemetryPayload: true;
    excludesRawRunEvents: true;
    excludesRawState: true;
    excludesSecretValues: true;
    excludesSinkUrls: true;
    excludesSinkTokens: true;
    includesOnlySnapshotRefsHashesAndAggregateMetrics: true;
  };
}

const PROVIDER_TELEMETRY_DASHBOARD_HISTORY_FILE = ".agent-flow/provider-telemetry-dashboard-history/history.json";
const MAX_PROVIDER_TELEMETRY_DASHBOARD_SNAPSHOTS = 50;
const PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_STATUS_FORMAT =
  "agent-flow-builder.provider-telemetry-dashboard-history-central-status.v1";
const PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_SYNC_RESULT_FORMAT =
  "agent-flow-builder.provider-telemetry-dashboard-history-central-sync-result.v1";
const PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_SYNC_REQUEST_FORMAT =
  "agent-flow-builder.provider-telemetry-dashboard-history-central-sync-request.v1";
const PROVIDER_TELEMETRY_DASHBOARD_DIFF_FORMAT =
  "agent-flow-builder.provider-telemetry-dashboard-history-diff.v1";
const PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_URL_ENV =
  "AGENT_FLOW_PROVIDER_TELEMETRY_DASHBOARD_HISTORY_CENTRAL_URL";
const PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_TOKEN_ENV =
  "AGENT_FLOW_PROVIDER_TELEMETRY_DASHBOARD_HISTORY_CENTRAL_TOKEN";
const PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_TIMEOUT_ENV =
  "AGENT_FLOW_PROVIDER_TELEMETRY_DASHBOARD_HISTORY_CENTRAL_TIMEOUT_MS";
const PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_TIMEOUT_MS = 5_000;
const PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_MAX_BYTES = 1_000_000;

export async function loadProviderTelemetryDashboardHistory(
  workspaceRoot: string,
  flowId: string,
): Promise<StudioProviderTelemetryDashboardHistory> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  try {
    const raw = await readFile(providerTelemetryDashboardHistoryPath(loaded.flowRoot), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const history = normalizeProviderTelemetryDashboardHistoryPayload(parsed);
    if (!history) {
      throw new WorkspaceError("Histórico de dashboard de telemetria por provider inválido.", 422);
    }
    return buildProviderTelemetryDashboardHistory(loaded.flow, history.snapshots);
  } catch (error) {
    if (isFileNotFound(error)) {
      return buildProviderTelemetryDashboardHistory(loaded.flow, []);
    }
    if (error instanceof WorkspaceError) {
      throw error;
    }
    throw new WorkspaceError("Falha ao ler histórico de dashboard de telemetria por provider.", 500, error);
  }
}

export async function saveProviderTelemetryDashboardSnapshot(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<StudioProviderTelemetryDashboardHistory> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const snapshot = normalizeProviderTelemetryDashboardSnapshotPayload(payload, loaded.flow);
  if (!snapshot) {
    throw new WorkspaceError("Payload de dashboard de telemetria por provider inválido.", 400);
  }
  const current = await loadProviderTelemetryDashboardHistory(workspaceRoot, flowId);
  const merged = mergeProviderTelemetryDashboardSnapshots(current.snapshots, [snapshot]);
  const next = buildProviderTelemetryDashboardHistory(loaded.flow, merged.snapshots, buildProviderTelemetryDashboardSharedSync(
    "save",
    {
      incomingCount: 1,
      existingCount: current.snapshotCount,
      addedCount: merged.stats.addedCount,
      updatedCount: merged.stats.updatedCount,
      unchangedCount: merged.stats.unchangedCount,
      finalCount: merged.snapshots.length,
    },
    merged.snapshots,
  ));
  await writeProviderTelemetryDashboardHistory(loaded.flowRoot, next);
  return next;
}

export async function mergeProviderTelemetryDashboardHistory(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<StudioProviderTelemetryDashboardHistory> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const incoming = normalizeProviderTelemetryDashboardHistoryPayload(
    isRecord(payload) && payload.history !== undefined ? payload.history : payload,
  );
  if (!incoming) {
    throw new WorkspaceError("Payload de histórico de telemetria por provider inválido.", 400);
  }
  const existing = await loadProviderTelemetryDashboardHistory(workspaceRoot, flowId);
  const merged = mergeProviderTelemetryDashboardSnapshots(existing.snapshots, incoming.snapshots);
  const next = buildProviderTelemetryDashboardHistory(loaded.flow, merged.snapshots, buildProviderTelemetryDashboardSharedSync(
    "merge",
    {
      incomingCount: incoming.snapshotCount,
      existingCount: existing.snapshotCount,
      addedCount: merged.stats.addedCount,
      updatedCount: merged.stats.updatedCount,
      unchangedCount: merged.stats.unchangedCount,
      finalCount: merged.snapshots.length,
    },
    merged.snapshots,
  ));
  await writeProviderTelemetryDashboardHistory(loaded.flowRoot, next);
  return next;
}

export async function loadProviderTelemetryDashboardCentralSyncStatus(): Promise<StudioProviderTelemetryDashboardCentralSyncStatus> {
  return buildProviderTelemetryDashboardCentralSyncStatus(providerTelemetryDashboardCentralSyncConfig());
}

export async function syncCentralProviderTelemetryDashboardHistory(
  workspaceRoot: string,
  flowId: string,
): Promise<StudioProviderTelemetryDashboardCentralSyncResult> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const config = providerTelemetryDashboardCentralSyncConfig();
  if (config.invalidReason) {
    throw new WorkspaceError(`Configuração da central de dashboard de provider inválida: ${config.invalidReason}`, 422);
  }
  if (!config.url) {
    throw new WorkspaceError("Central de dashboard de provider não configurada.", 400);
  }
  const existing = await loadProviderTelemetryDashboardHistory(workspaceRoot, flowId);
  const fetched = await fetchCentralProviderTelemetryDashboardHistory(config, flowId, existing);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fetched.body) as unknown;
  } catch (error) {
    throw new WorkspaceError("Resposta central de dashboard de provider não é JSON válido.", 502, error);
  }
  const incoming = normalizeProviderTelemetryDashboardHistoryPayload(
    isRecord(parsed) && parsed.history !== undefined ? parsed.history : parsed,
  );
  if (!incoming) {
    throw new WorkspaceError("Resposta central de dashboard de provider não respeita o formato esperado.", 502);
  }
  const merged = mergeProviderTelemetryDashboardSnapshots(existing.snapshots, incoming.snapshots);
  const next = buildProviderTelemetryDashboardHistory(loaded.flow, merged.snapshots, buildProviderTelemetryDashboardSharedSync(
    "central_sync",
    {
      incomingCount: incoming.snapshotCount,
      existingCount: existing.snapshotCount,
      addedCount: merged.stats.addedCount,
      updatedCount: merged.stats.updatedCount,
      unchangedCount: merged.stats.unchangedCount,
      finalCount: merged.snapshots.length,
    },
    merged.snapshots,
  ));
  await writeProviderTelemetryDashboardHistory(loaded.flowRoot, next);
  const syncedAt = new Date().toISOString();
  return {
    format: PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_SYNC_RESULT_FORMAT,
    flowId,
    history: next,
    central: buildProviderTelemetryDashboardCentralSyncStatus(config, {
      lastSyncedAt: syncedAt,
      statusCode: fetched.statusCode,
      pushedSnapshotCount: existing.snapshotCount,
      pulledSnapshotCount: incoming.snapshotCount,
      error: null,
    }),
    pushedSnapshotCount: existing.snapshotCount,
    pulledSnapshotCount: incoming.snapshotCount,
    governance: {
      includesRawRunEvents: false,
      includesRawState: false,
      includesSecretValues: false,
      includesSinkUrls: false,
      includesSinkTokens: false,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  };
}

export async function compareProviderTelemetryDashboardHistory(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<StudioProviderTelemetryDashboardDiffPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const existing = await loadProviderTelemetryDashboardHistory(workspaceRoot, flowId);
  const incoming = normalizeProviderTelemetryDashboardHistoryPayload(
    isRecord(payload) && payload.history !== undefined ? payload.history : payload,
  );
  if (!incoming) {
    throw new WorkspaceError("Payload de comparação de dashboard de provider inválido.", 400);
  }
  const currentById = new Map(existing.snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const incomingById = new Map(incoming.snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const sections: StudioProviderTelemetryDashboardDiffPackage["sections"] = [
    { id: "added", label: "Novos no pacote recebido", count: 0, items: [] },
    { id: "removed", label: "Ausentes no pacote recebido", count: 0, items: [] },
    { id: "changed", label: "Alterados", count: 0, items: [] },
    { id: "unchanged", label: "Iguais", count: 0, items: [] },
  ];
  const bySection = new Map(sections.map((section) => [section.id, section]));
  for (const id of Array.from(new Set([...currentById.keys(), ...incomingById.keys()])).sort()) {
    const current = currentById.get(id) ?? null;
    const incomingSnapshot = incomingById.get(id) ?? null;
    const currentRef = current ? providerTelemetryDashboardDiffRef(current) : null;
    const incomingRef = incomingSnapshot ? providerTelemetryDashboardDiffRef(incomingSnapshot) : null;
    const sectionId: StudioProviderTelemetryDashboardDiffSection["id"] =
      current && !incomingSnapshot
        ? "removed"
        : !current && incomingSnapshot
          ? "added"
          : currentRef && incomingRef && currentRef.telemetryHash !== incomingRef.telemetryHash
            ? "changed"
            : "unchanged";
    bySection.get(sectionId)?.items.push({
      snapshotId: id,
      current: currentRef,
      incoming: incomingRef,
    });
  }
  for (const section of sections) {
    section.count = section.items.length;
  }
  const summary = {
    currentSnapshotCount: existing.snapshotCount,
    incomingSnapshotCount: incoming.snapshotCount,
    addedCount: bySection.get("added")?.count ?? 0,
    removedCount: bySection.get("removed")?.count ?? 0,
    changedCount: bySection.get("changed")?.count ?? 0,
    unchangedCount: bySection.get("unchanged")?.count ?? 0,
    headline: "",
  };
  summary.headline = `${summary.addedCount} novo(s), ${summary.removedCount} ausente(s), ${summary.changedCount} alterado(s), ${summary.unchangedCount} igual(is).`;
  const packageHash = shortHash(stableStringify({ flowId, summary, sections }));
  return {
    format: PROVIDER_TELEMETRY_DASHBOARD_DIFF_FORMAT,
    generatedAt: new Date().toISOString(),
    flow: {
      id: loaded.flow.id,
      name: loaded.flow.name,
      version: loaded.flow.version,
    },
    packageHash,
    summary,
    sections,
    governance: {
      excludesTelemetryPayload: true,
      excludesRawRunEvents: true,
      excludesRawState: true,
      excludesSecretValues: true,
      excludesSinkUrls: true,
      excludesSinkTokens: true,
      includesOnlySnapshotRefsHashesAndAggregateMetrics: true,
    },
  };
}

function providerTelemetryDashboardHistoryPath(flowRoot: string): string {
  return path.join(flowRoot, PROVIDER_TELEMETRY_DASHBOARD_HISTORY_FILE);
}

async function writeProviderTelemetryDashboardHistory(
  flowRoot: string,
  history: StudioProviderTelemetryDashboardHistory,
): Promise<void> {
  const historyPath = providerTelemetryDashboardHistoryPath(flowRoot);
  await mkdir(path.dirname(historyPath), { recursive: true });
  const tempPath = `${historyPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(history, null, 2)}\n`, "utf-8");
  await rename(tempPath, historyPath);
}

function mergeProviderTelemetryDashboardSnapshots(
  existing: StudioProviderTelemetryDashboardSnapshot[],
  incoming: StudioProviderTelemetryDashboardSnapshot[],
): {
  snapshots: StudioProviderTelemetryDashboardSnapshot[];
  stats: {
    addedCount: number;
    updatedCount: number;
    unchangedCount: number;
  };
} {
  const byId = new Map(syncProviderTelemetryDashboardSnapshots(existing).map((snapshot) => [snapshot.id, snapshot]));
  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  for (const snapshot of syncProviderTelemetryDashboardSnapshots(incoming)) {
    const current = byId.get(snapshot.id);
    if (!current) {
      byId.set(snapshot.id, snapshot);
      addedCount += 1;
      continue;
    }
    const currentHash = shortHash(stableStringify(current));
    const incomingHash = shortHash(stableStringify(snapshot));
    if (currentHash === incomingHash) {
      unchangedCount += 1;
      continue;
    }
    if (Date.parse(snapshot.capturedAt) >= Date.parse(current.capturedAt)) {
      byId.set(snapshot.id, snapshot);
      updatedCount += 1;
    } else {
      unchangedCount += 1;
    }
  }
  return {
    snapshots: syncProviderTelemetryDashboardSnapshots(Array.from(byId.values())),
    stats: {
      addedCount,
      updatedCount,
      unchangedCount,
    },
  };
}

function providerTelemetryDashboardCentralSyncConfig(): StudioProviderTelemetryDashboardCentralSyncConfig {
  const configuredUrl = process.env[PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_URL_ENV]?.trim() ?? "";
  let url: string | null = null;
  let invalidReason: string | null = null;
  if (configuredUrl) {
    try {
      url = validateProviderTelemetryDashboardCentralUrl(configuredUrl);
    } catch (error) {
      invalidReason = errorMessage(error);
    }
  }
  const timeoutValue = Number(process.env[PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_TIMEOUT_ENV] ?? "");
  const timeoutMs = Number.isFinite(timeoutValue)
    ? Math.min(Math.max(Math.floor(timeoutValue), 100), 60_000)
    : PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_TIMEOUT_MS;
  return {
    url,
    token: process.env[PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_TOKEN_ENV]?.trim() || null,
    timeoutMs,
    invalidReason,
  };
}

function buildProviderTelemetryDashboardCentralSyncStatus(
  config: StudioProviderTelemetryDashboardCentralSyncConfig,
  sync?: Pick<
    StudioProviderTelemetryDashboardCentralSyncStatus,
    "lastSyncedAt" | "statusCode" | "pushedSnapshotCount" | "pulledSnapshotCount" | "error"
  >,
): StudioProviderTelemetryDashboardCentralSyncStatus {
  return {
    format: PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_STATUS_FORMAT,
    generatedAt: new Date().toISOString(),
    configured: Boolean(config.url && !config.invalidReason),
    urlConfigured: Boolean(process.env[PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_URL_ENV]?.trim()),
    tokenConfigured: Boolean(config.token),
    timeoutMs: config.timeoutMs,
    invalidReason: config.invalidReason,
    lastSyncedAt: sync?.lastSyncedAt ?? null,
    statusCode: sync?.statusCode ?? null,
    pushedSnapshotCount: sync?.pushedSnapshotCount ?? null,
    pulledSnapshotCount: sync?.pulledSnapshotCount ?? null,
    error: sync?.error ?? null,
    governance: {
      includesRawRunEvents: false,
      includesRawState: false,
      includesSecretValues: false,
      includesSinkUrls: false,
      includesSinkTokens: false,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
      storesCentralToken: false,
      configuredUrlEnv: PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_URL_ENV,
      configuredTokenEnv: PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_TOKEN_ENV,
      configuredTimeoutEnv: PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_TIMEOUT_ENV,
      maxPayloadBytes: PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_MAX_BYTES,
    },
  };
}

async function fetchCentralProviderTelemetryDashboardHistory(
  config: StudioProviderTelemetryDashboardCentralSyncConfig,
  flowId: string,
  history: StudioProviderTelemetryDashboardHistory,
): Promise<{ statusCode: number; body: string }> {
  if (!config.url) {
    throw new WorkspaceError("Central de dashboard de provider não configurada.", 400);
  }
  const body = JSON.stringify({
    format: PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_SYNC_REQUEST_FORMAT,
    generatedAt: new Date().toISOString(),
    flowId,
    history,
    snapshotCount: history.snapshotCount,
    governance: {
      includesRawRunEvents: false,
      includesRawState: false,
      includesSecretValues: false,
      includesSinkUrls: false,
      includesSinkTokens: false,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  });
  if (Buffer.byteLength(body, "utf-8") > PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_MAX_BYTES) {
    throw new WorkspaceError("Histórico de dashboard de provider excede o limite de tamanho permitido para sync central.", 413);
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
    if (Number.isFinite(contentLength) && contentLength > PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central de dashboard de provider excede o limite de tamanho permitido.", 413);
    }
    if (!response.ok) {
      throw new WorkspaceError(`Central de dashboard de provider respondeu HTTP ${response.status}.`, response.status);
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central de dashboard de provider excede o limite de tamanho permitido.", 413);
    }
    return {
      statusCode: response.status,
      body: Buffer.from(buffer).toString("utf-8"),
    };
  } catch (error) {
    if (isRecord(error) && error.name === "AbortError") {
      throw new WorkspaceError("Timeout ao sincronizar central de dashboard de provider.", 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function validateProviderTelemetryDashboardCentralUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WorkspaceError(`${PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_URL_ENV} deve ser uma URL HTTP/HTTPS válida.`, 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WorkspaceError(`${PROVIDER_TELEMETRY_DASHBOARD_CENTRAL_URL_ENV} deve usar http ou https.`, 400);
  }
  parsed.username = "";
  parsed.password = "";
  return parsed.toString();
}

function buildProviderTelemetryDashboardHistory(
  flow: AgentFlow,
  snapshots: StudioProviderTelemetryDashboardSnapshot[],
  sharedSync?: StudioProviderTelemetryDashboardSharedSyncInfo,
): StudioProviderTelemetryDashboardHistory {
  const normalized = syncProviderTelemetryDashboardSnapshots(snapshots);
  return {
    format: "agent-flow-builder.provider-telemetry-dashboard-history.v1",
    exportedAt: new Date().toISOString(),
    flow: {
      id: flow.id,
      name: flow.name,
      version: flow.version,
    },
    snapshotCount: normalized.length,
    analysis: analyzeProviderTelemetryDashboardHistory(normalized),
    governance: providerTelemetryDashboardHistoryGovernance(),
    sharedSync: sharedSync ?? buildProviderTelemetryDashboardSharedSync(
      normalized.length ? "load" : "empty",
      {
        incomingCount: 0,
        existingCount: normalized.length,
        addedCount: 0,
        updatedCount: 0,
        unchangedCount: normalized.length,
        finalCount: normalized.length,
      },
      normalized,
    ),
    snapshots: normalized,
  };
}

function providerTelemetryDashboardHistoryGovernance(): StudioProviderTelemetryDashboardHistory["governance"] {
  return {
    includesRawRunEvents: false,
    includesRawState: false,
    includesSecretValues: false,
    includesSinkUrls: false,
    includesSinkTokens: false,
  };
}

function normalizeProviderTelemetryDashboardHistoryPayload(
  value: unknown,
): StudioProviderTelemetryDashboardHistory | null {
  if (
    !isRecord(value) ||
    value.format !== "agent-flow-builder.provider-telemetry-dashboard-history.v1" ||
    !Array.isArray(value.snapshots)
  ) {
    return null;
  }
  const flow = isRecord(value.flow) ? value.flow : {};
  const snapshots = syncProviderTelemetryDashboardSnapshots(value.snapshots);
  return {
    format: "agent-flow-builder.provider-telemetry-dashboard-history.v1",
    exportedAt: readString(value.exportedAt) ?? new Date().toISOString(),
    flow: {
      id: readString(flow.id) ?? "",
      name: readString(flow.name) ?? "",
      version: readString(flow.version) ?? "",
    },
    snapshotCount: snapshots.length,
    analysis: analyzeProviderTelemetryDashboardHistory(snapshots),
    governance: providerTelemetryDashboardHistoryGovernance(),
    sharedSync: buildProviderTelemetryDashboardSharedSync(
      snapshots.length ? "load" : "empty",
      {
        incomingCount: 0,
        existingCount: snapshots.length,
        addedCount: 0,
        updatedCount: 0,
        unchangedCount: snapshots.length,
        finalCount: snapshots.length,
      },
      snapshots,
    ),
    snapshots,
  };
}

function buildProviderTelemetryDashboardSharedSync(
  action: StudioProviderTelemetryDashboardSharedSyncAction,
  stats: Pick<
    StudioProviderTelemetryDashboardSharedSyncInfo,
    "incomingCount" | "existingCount" | "addedCount" | "updatedCount" | "unchangedCount" | "finalCount"
  >,
  snapshots: StudioProviderTelemetryDashboardSnapshot[],
): StudioProviderTelemetryDashboardSharedSyncInfo {
  return {
    action,
    updatedAt: new Date().toISOString(),
    storage: PROVIDER_TELEMETRY_DASHBOARD_HISTORY_FILE,
    contentHash: shortHash(stableStringify(snapshots.map(providerTelemetryDashboardDiffRef))),
    ...stats,
    governance: {
      includesRawRunEvents: false,
      includesRawState: false,
      includesSecretValues: false,
      includesSinkUrls: false,
      includesSinkTokens: false,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  };
}

function normalizeProviderTelemetryDashboardSnapshotPayload(
  value: unknown,
  flow: AgentFlow,
): StudioProviderTelemetryDashboardSnapshot | null {
  const telemetry = normalizeProviderTelemetryReport(value, flow.id);
  if (!telemetry) {
    return null;
  }
  const summary = providerTelemetryDashboardSummary(telemetry);
  const flowHash = shortHash(stableStringify(flow));
  const id = `provider-telemetry-dashboard-${shortHash(stableStringify({
    flowId: flow.id,
    flowHash,
    summary,
    alerts: telemetry.alerts,
    items: telemetry.items,
  }))}`;
  return {
    id,
    capturedAt: telemetry.generatedAt,
    flow: {
      id: flow.id,
      name: flow.name,
      version: flow.version,
      flowHash,
    },
    summary,
    telemetry,
  };
}

function normalizeProviderTelemetryDashboardSnapshot(value: unknown): StudioProviderTelemetryDashboardSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id);
  const capturedAt = readString(value.capturedAt);
  const summary = normalizeProviderTelemetryDashboardSummary(value.summary);
  const flow = isRecord(value.flow) ? value.flow : {};
  const telemetry =
    normalizeProviderTelemetryReport(value.telemetry, readFlowId(value.flow)) ??
    (summary ? fallbackProviderTelemetryReportFromSnapshot(summary, readString(flow.id) ?? "", capturedAt ?? "") : null);
  if (!id || !capturedAt || !summary || !telemetry) {
    return null;
  }
  return {
    id,
    capturedAt,
    flow: {
      id: readString(flow.id) ?? telemetry.flowId,
      name: readString(flow.name) ?? "",
      version: readString(flow.version) ?? "",
      flowHash: readString(flow.flowHash) ?? "",
    },
    summary,
    telemetry,
  };
}

function fallbackProviderTelemetryReportFromSnapshot(
  summary: StudioProviderTelemetryDashboardSnapshot["summary"],
  flowId: string,
  capturedAt: string,
): StudioProviderTelemetryReport {
  return {
    format: "agent-flow-builder.studio-provider-telemetry.v1",
    flowId,
    generatedAt: readIsoDate(capturedAt) ?? new Date().toISOString(),
    windowHours: summary.windowHours,
    windowStartedAt: null,
    providerTokenBudget: summary.providerTokenBudget,
    providerCostBudgetUsd: summary.providerCostBudgetUsd,
    runCount: summary.runCount,
    telemetryRunCount: summary.telemetryRunCount,
    eventCount: summary.eventCount,
    totalTokens: summary.totalTokens,
    totalCostUsd: summary.totalCostUsd,
    alertCount: summary.alertCount,
    alerts: [],
    items: [],
  };
}

function readFlowId(value: unknown): string {
  return isRecord(value) ? readString(value.id) ?? "" : "";
}

function analyzeProviderTelemetryDashboardHistory(
  snapshots: StudioProviderTelemetryDashboardSnapshot[],
): StudioProviderTelemetryDashboardHistoryAnalysis {
  const latest = snapshots[0] ?? null;
  const previous = snapshots[1] ?? null;
  const highestCost = snapshots.reduce<StudioProviderTelemetryDashboardSnapshot | null>(
    (current, snapshot) => (!current || snapshot.summary.totalCostUsd > current.summary.totalCostUsd ? snapshot : current),
    null,
  );
  const highestToken = snapshots.reduce<StudioProviderTelemetryDashboardSnapshot | null>(
    (current, snapshot) => (!current || snapshot.summary.totalTokens > current.summary.totalTokens ? snapshot : current),
    null,
  );
  const totals = snapshots.reduce(
    (acc, snapshot) => ({
      tokens: acc.tokens + snapshot.summary.totalTokens,
      cost: acc.cost + snapshot.summary.totalCostUsd,
      alerts: acc.alerts + snapshot.summary.alertCount,
    }),
    { tokens: 0, cost: 0, alerts: 0 },
  );
  const latestTokenDelta = latest && previous ? latest.summary.totalTokens - previous.summary.totalTokens : null;
  const latestCostDeltaUsd = latest && previous
    ? Number((latest.summary.totalCostUsd - previous.summary.totalCostUsd).toFixed(8))
    : null;
  return {
    latestTrend: providerTelemetryDashboardTrend(latest, previous, latestCostDeltaUsd, latestTokenDelta),
    latestSnapshotId: latest?.id ?? null,
    previousSnapshotId: previous?.id ?? null,
    highestCostSnapshotId: highestCost?.id ?? null,
    highestTokenSnapshotId: highestToken?.id ?? null,
    firstCapturedAt: snapshots.length ? snapshots[snapshots.length - 1].capturedAt : null,
    latestCapturedAt: latest?.capturedAt ?? null,
    latestTokenDelta,
    latestCostDeltaUsd,
    latestAlertDelta: latest && previous ? latest.summary.alertCount - previous.summary.alertCount : null,
    latestProviderModelDelta: latest && previous
      ? latest.summary.providerModelCount - previous.summary.providerModelCount
      : null,
    latestFlowChanged: latest && previous ? latest.flow.flowHash !== previous.flow.flowHash : null,
    averageTokens: snapshots.length ? Math.round(totals.tokens / snapshots.length) : 0,
    averageCostUsd: snapshots.length ? Number((totals.cost / snapshots.length).toFixed(8)) : 0,
    totalAlertCount: totals.alerts,
  };
}

function providerTelemetryDashboardTrend(
  latest: StudioProviderTelemetryDashboardSnapshot | null,
  previous: StudioProviderTelemetryDashboardSnapshot | null,
  latestCostDeltaUsd: number | null,
  latestTokenDelta: number | null,
): StudioProviderTelemetryDashboardTrend {
  if (!latest) {
    return "none";
  }
  if (!previous || latestCostDeltaUsd === null || latestTokenDelta === null) {
    return "new";
  }
  if (latestCostDeltaUsd > 0 || latestTokenDelta > 0) {
    return "increased";
  }
  if (latestCostDeltaUsd < 0 || latestTokenDelta < 0) {
    return "decreased";
  }
  return "stable";
}

function syncProviderTelemetryDashboardSnapshots(items: unknown[]): StudioProviderTelemetryDashboardSnapshot[] {
  const byId = new Map<string, StudioProviderTelemetryDashboardSnapshot>();
  for (const item of items) {
    const snapshot = normalizeProviderTelemetryDashboardSnapshot(item);
    if (!snapshot) {
      continue;
    }
    const existing = byId.get(snapshot.id);
    if (!existing || Date.parse(existing.capturedAt) <= Date.parse(snapshot.capturedAt)) {
      byId.set(snapshot.id, snapshot);
    }
  }
  return Array.from(byId.values())
    .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt))
    .slice(0, MAX_PROVIDER_TELEMETRY_DASHBOARD_SNAPSHOTS);
}

function providerTelemetryDashboardSummary(
  telemetry: StudioProviderTelemetryReport,
): StudioProviderTelemetryDashboardSnapshot["summary"] {
  return {
    windowHours: telemetry.windowHours,
    providerTokenBudget: telemetry.providerTokenBudget,
    providerCostBudgetUsd: telemetry.providerCostBudgetUsd,
    runCount: telemetry.runCount,
    telemetryRunCount: telemetry.telemetryRunCount,
    eventCount: telemetry.eventCount,
    totalTokens: telemetry.totalTokens,
    totalCostUsd: telemetry.totalCostUsd,
    alertCount: telemetry.alertCount,
    providerModelCount: telemetry.items.length,
    warningProviderModelCount: telemetry.items.filter((item) => item.alertSeverity === "warning").length,
  };
}

function normalizeProviderTelemetryDashboardSummary(
  value: unknown,
): StudioProviderTelemetryDashboardSnapshot["summary"] | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    windowHours: normalizeNullablePositiveNumber(value.windowHours),
    providerTokenBudget: normalizeNullablePositiveNumber(value.providerTokenBudget),
    providerCostBudgetUsd: normalizeNullablePositiveNumber(value.providerCostBudgetUsd),
    runCount: normalizeNonNegativeInteger(value.runCount),
    telemetryRunCount: normalizeNonNegativeInteger(value.telemetryRunCount),
    eventCount: normalizeNonNegativeInteger(value.eventCount),
    totalTokens: normalizeNonNegativeInteger(value.totalTokens),
    totalCostUsd: normalizeNonNegativeNumber(value.totalCostUsd),
    alertCount: normalizeNonNegativeInteger(value.alertCount),
    providerModelCount: normalizeNonNegativeInteger(value.providerModelCount),
    warningProviderModelCount: normalizeNonNegativeInteger(value.warningProviderModelCount),
  };
}

function providerTelemetryDashboardDiffRef(
  snapshot: StudioProviderTelemetryDashboardSnapshot,
): StudioProviderTelemetryDashboardDiffRef {
  return {
    id: snapshot.id,
    capturedAt: snapshot.capturedAt,
    flowHash: snapshot.flow.flowHash,
    summaryHash: shortHash(stableStringify(snapshot.summary)),
    telemetryHash: shortHash(stableStringify(snapshot.telemetry)),
    runCount: snapshot.summary.runCount,
    telemetryRunCount: snapshot.summary.telemetryRunCount,
    eventCount: snapshot.summary.eventCount,
    totalTokens: snapshot.summary.totalTokens,
    totalCostUsd: snapshot.summary.totalCostUsd,
    alertCount: snapshot.summary.alertCount,
    providerModelCount: snapshot.summary.providerModelCount,
    warningProviderModelCount: snapshot.summary.warningProviderModelCount,
  };
}

function normalizeProviderTelemetryReport(value: unknown, fallbackFlowId: string): StudioProviderTelemetryReport | null {
  if (!isRecord(value) || value.format !== "agent-flow-builder.studio-provider-telemetry.v1") {
    return null;
  }
  const flowId = readString(value.flowId) ?? fallbackFlowId;
  const items = Array.isArray(value.items)
    ? value.items.map(normalizeProviderTelemetryItem).filter((item): item is StudioProviderTelemetryItem => item !== null)
    : [];
  const alerts = Array.isArray(value.alerts)
    ? value.alerts.map(normalizeProviderTelemetryAlert).filter((alert): alert is StudioProviderTelemetryAlert => alert !== null)
    : [];
  return {
    format: "agent-flow-builder.studio-provider-telemetry.v1",
    flowId,
    generatedAt: readIsoDate(value.generatedAt) ?? new Date().toISOString(),
    windowHours: normalizeNullablePositiveNumber(value.windowHours),
    windowStartedAt: readIsoDate(value.windowStartedAt),
    providerTokenBudget: normalizeNullablePositiveNumber(value.providerTokenBudget),
    providerCostBudgetUsd: normalizeNullablePositiveNumber(value.providerCostBudgetUsd),
    runCount: normalizeNonNegativeInteger(value.runCount),
    telemetryRunCount: normalizeNonNegativeInteger(value.telemetryRunCount),
    eventCount: normalizeNonNegativeInteger(value.eventCount),
    totalTokens: normalizeNonNegativeInteger(value.totalTokens),
    totalCostUsd: normalizeNonNegativeNumber(value.totalCostUsd),
    alertCount: alerts.length,
    alerts,
    items,
  };
}

function normalizeProviderTelemetryItem(value: unknown): StudioProviderTelemetryItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const provider = readString(value.provider);
  const model = readString(value.model);
  if (!provider || !model) {
    return null;
  }
  return {
    provider,
    model,
    runCount: normalizeNonNegativeInteger(value.runCount),
    eventCount: normalizeNonNegativeInteger(value.eventCount),
    errorCount: normalizeNonNegativeInteger(value.errorCount),
    totalTokens: normalizeNonNegativeInteger(value.totalTokens),
    totalCostUsd: normalizeNonNegativeNumber(value.totalCostUsd),
    tokenBudgetPct: normalizeNullableNonNegativeNumber(value.tokenBudgetPct),
    costBudgetPct: normalizeNullableNonNegativeNumber(value.costBudgetPct),
    alertSeverity: value.alertSeverity === "warning" ? "warning" : "ok",
    lastRunId: readString(value.lastRunId) ?? "",
    lastSessionId: readString(value.lastSessionId) ?? "",
    lastEventSeq: normalizeNonNegativeInteger(value.lastEventSeq),
    updatedAt: readIsoDate(value.updatedAt) ?? new Date().toISOString(),
  };
}

function normalizeProviderTelemetryAlert(value: unknown): StudioProviderTelemetryAlert | null {
  if (!isRecord(value)) {
    return null;
  }
  const provider = readString(value.provider);
  const model = readString(value.model);
  const metric = value.metric === "cost" || value.metric === "tokens" ? value.metric : null;
  if (!provider || !model || !metric) {
    return null;
  }
  return {
    scope: "provider_model",
    severity: "warning",
    provider,
    model,
    metric,
    observed: normalizeNonNegativeNumber(value.observed),
    limit: normalizeNonNegativeNumber(value.limit),
    message: readString(value.message) ?? `${provider}/${model} excedeu limite de ${metric}.`,
  };
}

function normalizeNonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function normalizeNonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Number(value.toFixed(8))) : 0;
}

function normalizeNullablePositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Number(value.toFixed(8)) : null;
}

function normalizeNullableNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Number(value.toFixed(8)) : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readIsoDate(value: unknown): string | null {
  const raw = readString(value);
  return raw && !Number.isNaN(Date.parse(raw)) ? raw : null;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
