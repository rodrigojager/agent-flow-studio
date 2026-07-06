import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadFlowById, WorkspaceError } from "./workspace.ts";
import type { AgentFlow } from "@agent-flow-builder/flow-spec";

export interface StudioExperimentDashboardSnapshot {
  id: string;
  capturedAt: string;
  flow: {
    id: string;
    name: string;
    version: string;
    flowHash: string;
  };
  summary: {
    datasetCount: number;
    datasetWithRunsCount: number;
    scenarioCount: number;
    runCount: number;
    latestRunAt: string | null;
    averageOkRatePct: number;
    averagePassRatePct: number;
    regressingDatasetCount: number;
    flowChangedRunCount: number;
  };
  dashboard: Record<string, unknown>;
}

type StudioExperimentDashboardHistoryTrend = "none" | "new" | "improved" | "regressed" | "stable";

export interface StudioExperimentDashboardHistoryAnalysis {
  latestTrend: StudioExperimentDashboardHistoryTrend;
  latestSnapshotId: string | null;
  previousSnapshotId: string | null;
  bestSnapshotId: string | null;
  worstSnapshotId: string | null;
  firstCapturedAt: string | null;
  latestCapturedAt: string | null;
  latestOkRateDeltaPct: number | null;
  latestPassRateDeltaPct: number | null;
  latestRunCountDelta: number | null;
  latestRegressionDelta: number | null;
  latestFlowChanged: boolean | null;
  averageOkRatePct: number;
  averagePassRatePct: number;
  totalRunCount: number;
  totalRegressionCount: number;
}

export interface StudioExperimentDashboardHistory {
  format: "agent-flow-builder.experiment-dashboard-history.v1";
  exportedAt: string;
  flow: {
    id: string;
    name: string;
    version: string;
  };
  snapshotCount: number;
  analysis: StudioExperimentDashboardHistoryAnalysis;
  governance: {
    includesRawRunEvents: false;
    includesObservedOutputs: false;
    includesRawScenarioPayloads: false;
    includesSecretValues: false;
    includesOnlyAggregateDashboardData: true;
  };
  sharedSync: StudioExperimentDashboardHistorySharedSyncInfo;
  snapshots: StudioExperimentDashboardSnapshot[];
}

type StudioExperimentDashboardHistorySharedSyncAction = "empty" | "load" | "save" | "merge" | "central_sync";

interface StudioExperimentDashboardHistorySharedSyncInfo {
  action: StudioExperimentDashboardHistorySharedSyncAction;
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
    includesObservedOutputs: false;
    includesRawScenarioPayloads: false;
    includesSecretValues: false;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
  };
}

interface StudioExperimentDashboardHistoryCentralSyncConfig {
  url: string | null;
  token: string | null;
  timeoutMs: number;
  invalidReason: string | null;
}

export interface StudioExperimentDashboardHistoryCentralSyncStatus {
  format: typeof STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_STATUS_FORMAT;
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
    includesObservedOutputs: false;
    includesRawScenarioPayloads: false;
    includesSecretValues: false;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
    storesCentralToken: false;
    configuredUrlEnv: typeof STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_URL_ENV;
    configuredTokenEnv: typeof STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_TOKEN_ENV;
    configuredTimeoutEnv: typeof STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_TIMEOUT_ENV;
    maxPayloadBytes: typeof STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_MAX_BYTES;
  };
}

export interface StudioExperimentDashboardHistoryCentralSyncResult {
  format: typeof STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_SYNC_RESULT_FORMAT;
  flowId: string;
  history: StudioExperimentDashboardHistory;
  central: StudioExperimentDashboardHistoryCentralSyncStatus;
  pushedSnapshotCount: number;
  pulledSnapshotCount: number;
  governance: {
    includesRawRunEvents: false;
    includesObservedOutputs: false;
    includesRawScenarioPayloads: false;
    includesSecretValues: false;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
  };
}

interface StudioExperimentDashboardHistoryDiffRef {
  id: string;
  capturedAt: string;
  flowHash: string;
  summaryHash: string;
  dashboardHash: string;
  runCount: number;
  averageOkRatePct: number;
  averagePassRatePct: number;
  regressingDatasetCount: number;
  flowChangedRunCount: number;
}

interface StudioExperimentDashboardHistoryDiffSection {
  id: "added" | "removed" | "changed" | "unchanged";
  label: string;
  count: number;
  items: Array<{
    snapshotId: string;
    current: StudioExperimentDashboardHistoryDiffRef | null;
    incoming: StudioExperimentDashboardHistoryDiffRef | null;
  }>;
}

export interface StudioExperimentDashboardHistoryDiffPackage {
  format: typeof STUDIO_EXPERIMENT_DASHBOARD_HISTORY_DIFF_FORMAT;
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
  sections: StudioExperimentDashboardHistoryDiffSection[];
  governance: {
    excludesRawDashboardPayload: true;
    excludesRawRunEvents: true;
    excludesObservedOutputs: true;
    excludesRawScenarioPayloads: true;
    excludesSecretValues: true;
    includesOnlySnapshotRefsHashesAndAggregateMetrics: true;
  };
}

const STUDIO_EXPERIMENT_DASHBOARD_HISTORY_FILE = ".agent-flow/experiment-dashboard-history/history.json";
const MAX_EXPERIMENT_DASHBOARD_SNAPSHOTS = 50;
const STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_STATUS_FORMAT =
  "agent-flow-builder.experiment-dashboard-history-central-status.v1";
const STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_SYNC_RESULT_FORMAT =
  "agent-flow-builder.experiment-dashboard-history-central-sync-result.v1";
const STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_SYNC_REQUEST_FORMAT =
  "agent-flow-builder.experiment-dashboard-history-central-sync-request.v1";
const STUDIO_EXPERIMENT_DASHBOARD_HISTORY_DIFF_FORMAT =
  "agent-flow-builder.experiment-dashboard-history-diff.v1";
const STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_URL_ENV =
  "AGENT_FLOW_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_URL";
const STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_TOKEN_ENV =
  "AGENT_FLOW_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_TOKEN";
const STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_TIMEOUT_ENV =
  "AGENT_FLOW_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_TIMEOUT_MS";
const STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_TIMEOUT_MS = 5_000;
const STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_MAX_BYTES = 1_000_000;

export async function loadStudioExperimentDashboardHistory(
  workspaceRoot: string,
  flowId: string,
): Promise<StudioExperimentDashboardHistory> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  try {
    const raw = await readFile(studioExperimentDashboardHistoryPath(loaded.flowRoot), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const history = normalizeStudioExperimentDashboardHistoryPayload(parsed);
    if (!history) {
      throw new WorkspaceError("Histórico de dashboard experimental inválido.", 422);
    }
    return buildStudioExperimentDashboardHistory(loaded.flow, history.snapshots);
  } catch (error) {
    if (isFileNotFound(error)) {
      return buildStudioExperimentDashboardHistory(loaded.flow, []);
    }
    if (error instanceof WorkspaceError) {
      throw error;
    }
    throw new WorkspaceError("Falha ao ler histórico de dashboard experimental.", 500, error);
  }
}

export async function saveStudioExperimentDashboardSnapshot(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<StudioExperimentDashboardHistory> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const snapshot = normalizeStudioExperimentDashboardSnapshotPayload(payload, loaded.flow);
  if (!snapshot) {
    throw new WorkspaceError("Payload de dashboard experimental inválido.", 400);
  }
  const current = await loadStudioExperimentDashboardHistory(workspaceRoot, flowId);
  const merged = mergeStudioExperimentDashboardSnapshots(current.snapshots, [snapshot]);
  const next = buildStudioExperimentDashboardHistory(loaded.flow, merged.snapshots, buildStudioExperimentDashboardSharedSync(
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
  await writeStudioExperimentDashboardHistory(loaded.flowRoot, next);
  return next;
}

export async function mergeStudioExperimentDashboardHistory(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<StudioExperimentDashboardHistory> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const incoming = normalizeStudioExperimentDashboardHistoryPayload(
    isRecord(payload) && payload.history !== undefined ? payload.history : payload,
  );
  if (!incoming) {
    throw new WorkspaceError("Payload de histórico de dashboard experimental inválido.", 400);
  }
  const existing = await loadStudioExperimentDashboardHistory(workspaceRoot, flowId);
  const merged = mergeStudioExperimentDashboardSnapshots(existing.snapshots, incoming.snapshots);
  const next = buildStudioExperimentDashboardHistory(loaded.flow, merged.snapshots, buildStudioExperimentDashboardSharedSync(
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
  await writeStudioExperimentDashboardHistory(loaded.flowRoot, next);
  return next;
}

export async function loadStudioExperimentDashboardHistoryCentralSyncStatus(): Promise<StudioExperimentDashboardHistoryCentralSyncStatus> {
  return buildStudioExperimentDashboardHistoryCentralSyncStatus(studioExperimentDashboardHistoryCentralSyncConfig());
}

export async function syncCentralStudioExperimentDashboardHistory(
  workspaceRoot: string,
  flowId: string,
): Promise<StudioExperimentDashboardHistoryCentralSyncResult> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const config = studioExperimentDashboardHistoryCentralSyncConfig();
  if (config.invalidReason) {
    throw new WorkspaceError(`Configuração da central de dashboard experimental inválida: ${config.invalidReason}`, 422);
  }
  if (!config.url) {
    throw new WorkspaceError("Central de dashboard experimental não configurada.", 400);
  }
  const existing = await loadStudioExperimentDashboardHistory(workspaceRoot, flowId);
  const fetched = await fetchCentralStudioExperimentDashboardHistory(config, flowId, existing);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fetched.body) as unknown;
  } catch (error) {
    throw new WorkspaceError("Resposta central de dashboard experimental não é JSON válido.", 502, error);
  }
  const incoming = normalizeStudioExperimentDashboardHistoryPayload(
    isRecord(parsed) && parsed.history !== undefined ? parsed.history : parsed,
  );
  if (!incoming) {
    throw new WorkspaceError("Resposta central de dashboard experimental não respeita o formato esperado.", 502);
  }
  const merged = mergeStudioExperimentDashboardSnapshots(existing.snapshots, incoming.snapshots);
  const next = buildStudioExperimentDashboardHistory(loaded.flow, merged.snapshots, buildStudioExperimentDashboardSharedSync(
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
  await writeStudioExperimentDashboardHistory(loaded.flowRoot, next);
  const syncedAt = new Date().toISOString();
  return {
    format: STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_SYNC_RESULT_FORMAT,
    flowId,
    history: next,
    central: buildStudioExperimentDashboardHistoryCentralSyncStatus(config, {
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
      includesObservedOutputs: false,
      includesRawScenarioPayloads: false,
      includesSecretValues: false,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  };
}

export async function compareStudioExperimentDashboardHistory(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<StudioExperimentDashboardHistoryDiffPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const existing = await loadStudioExperimentDashboardHistory(workspaceRoot, flowId);
  const incoming = normalizeStudioExperimentDashboardHistoryPayload(
    isRecord(payload) && payload.history !== undefined ? payload.history : payload,
  );
  if (!incoming) {
    throw new WorkspaceError("Payload de comparação de histórico experimental inválido.", 400);
  }
  const currentById = new Map(existing.snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const incomingById = new Map(incoming.snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const allIds = Array.from(new Set([...currentById.keys(), ...incomingById.keys()])).sort();
  const sections: StudioExperimentDashboardHistoryDiffPackage["sections"] = [
    { id: "added", label: "Novos no pacote recebido", count: 0, items: [] },
    { id: "removed", label: "Ausentes no pacote recebido", count: 0, items: [] },
    { id: "changed", label: "Alterados", count: 0, items: [] },
    { id: "unchanged", label: "Iguais", count: 0, items: [] },
  ];
  const bySection = new Map(sections.map((section) => [section.id, section]));
  for (const id of allIds) {
    const current = currentById.get(id) ?? null;
    const incomingSnapshot = incomingById.get(id) ?? null;
    const currentRef = current ? experimentDashboardHistoryDiffRef(current) : null;
    const incomingRef = incomingSnapshot ? experimentDashboardHistoryDiffRef(incomingSnapshot) : null;
    const sectionId: StudioExperimentDashboardHistoryDiffSection["id"] =
      current && !incomingSnapshot
        ? "removed"
        : !current && incomingSnapshot
          ? "added"
          : currentRef && incomingRef && currentRef.dashboardHash !== incomingRef.dashboardHash
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
  const packageHash = shortHash(stableStringify({
    flowId,
    summary,
    sections,
  }));
  return {
    format: STUDIO_EXPERIMENT_DASHBOARD_HISTORY_DIFF_FORMAT,
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
      excludesRawDashboardPayload: true,
      excludesRawRunEvents: true,
      excludesObservedOutputs: true,
      excludesRawScenarioPayloads: true,
      excludesSecretValues: true,
      includesOnlySnapshotRefsHashesAndAggregateMetrics: true,
    },
  };
}

function studioExperimentDashboardHistoryPath(flowRoot: string): string {
  return path.join(flowRoot, STUDIO_EXPERIMENT_DASHBOARD_HISTORY_FILE);
}

async function writeStudioExperimentDashboardHistory(
  flowRoot: string,
  history: StudioExperimentDashboardHistory,
): Promise<void> {
  const historyPath = studioExperimentDashboardHistoryPath(flowRoot);
  await mkdir(path.dirname(historyPath), { recursive: true });
  const tempPath = `${historyPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(history, null, 2)}\n`, "utf-8");
  await rename(tempPath, historyPath);
}

function mergeStudioExperimentDashboardSnapshots(
  existing: StudioExperimentDashboardSnapshot[],
  incoming: StudioExperimentDashboardSnapshot[],
): {
  snapshots: StudioExperimentDashboardSnapshot[];
  stats: {
    addedCount: number;
    updatedCount: number;
    unchangedCount: number;
  };
} {
  const normalizedExisting = syncStudioExperimentDashboardSnapshots(existing);
  const byId = new Map(normalizedExisting.map((snapshot) => [snapshot.id, snapshot]));
  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  for (const snapshot of syncStudioExperimentDashboardSnapshots(incoming)) {
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
    snapshots: syncStudioExperimentDashboardSnapshots(Array.from(byId.values())),
    stats: {
      addedCount,
      updatedCount,
      unchangedCount,
    },
  };
}

function studioExperimentDashboardHistoryCentralSyncConfig(): StudioExperimentDashboardHistoryCentralSyncConfig {
  const configuredUrl = process.env[STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_URL_ENV]?.trim() ?? "";
  let url: string | null = null;
  let invalidReason: string | null = null;
  if (configuredUrl) {
    try {
      url = validateStudioExperimentDashboardHistoryCentralUrl(configuredUrl);
    } catch (error) {
      invalidReason = errorMessage(error);
    }
  }
  const timeoutValue = Number(process.env[STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_TIMEOUT_ENV] ?? "");
  const timeoutMs = Number.isFinite(timeoutValue)
    ? Math.min(Math.max(Math.floor(timeoutValue), 100), 60_000)
    : STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_TIMEOUT_MS;
  return {
    url,
    token: process.env[STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_TOKEN_ENV]?.trim() || null,
    timeoutMs,
    invalidReason,
  };
}

function buildStudioExperimentDashboardHistoryCentralSyncStatus(
  config: StudioExperimentDashboardHistoryCentralSyncConfig,
  sync?: Pick<
    StudioExperimentDashboardHistoryCentralSyncStatus,
    "lastSyncedAt" | "statusCode" | "pushedSnapshotCount" | "pulledSnapshotCount" | "error"
  >,
): StudioExperimentDashboardHistoryCentralSyncStatus {
  return {
    format: STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_STATUS_FORMAT,
    generatedAt: new Date().toISOString(),
    configured: Boolean(config.url && !config.invalidReason),
    urlConfigured: Boolean(process.env[STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_URL_ENV]?.trim()),
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
      includesObservedOutputs: false,
      includesRawScenarioPayloads: false,
      includesSecretValues: false,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
      storesCentralToken: false,
      configuredUrlEnv: STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_URL_ENV,
      configuredTokenEnv: STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_TOKEN_ENV,
      configuredTimeoutEnv: STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_TIMEOUT_ENV,
      maxPayloadBytes: STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_MAX_BYTES,
    },
  };
}

async function fetchCentralStudioExperimentDashboardHistory(
  config: StudioExperimentDashboardHistoryCentralSyncConfig,
  flowId: string,
  history: StudioExperimentDashboardHistory,
): Promise<{ statusCode: number; body: string }> {
  if (!config.url) {
    throw new WorkspaceError("Central de dashboard experimental não configurada.", 400);
  }
  const body = JSON.stringify({
    format: STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_SYNC_REQUEST_FORMAT,
    generatedAt: new Date().toISOString(),
    flowId,
    history,
    snapshotCount: history.snapshotCount,
    governance: {
      includesRawRunEvents: false,
      includesObservedOutputs: false,
      includesRawScenarioPayloads: false,
      includesSecretValues: false,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  });
  if (Buffer.byteLength(body, "utf-8") > STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_MAX_BYTES) {
    throw new WorkspaceError("Histórico de dashboard experimental excede o limite de tamanho permitido para sync central.", 413);
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
    if (Number.isFinite(contentLength) && contentLength > STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central de dashboard experimental excede o limite de tamanho permitido.", 413);
    }
    if (!response.ok) {
      throw new WorkspaceError(`Central de dashboard experimental respondeu HTTP ${response.status}.`, response.status);
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central de dashboard experimental excede o limite de tamanho permitido.", 413);
    }
    return {
      statusCode: response.status,
      body: Buffer.from(buffer).toString("utf-8"),
    };
  } catch (error) {
    if (isRecord(error) && error.name === "AbortError") {
      throw new WorkspaceError("Timeout ao sincronizar central de dashboard experimental.", 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function validateStudioExperimentDashboardHistoryCentralUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WorkspaceError(`${STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_URL_ENV} deve ser uma URL HTTP/HTTPS válida.`, 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WorkspaceError(`${STUDIO_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_URL_ENV} deve usar http ou https.`, 400);
  }
  parsed.username = "";
  parsed.password = "";
  return parsed.toString();
}

function experimentDashboardHistoryDiffRef(
  snapshot: StudioExperimentDashboardSnapshot,
): StudioExperimentDashboardHistoryDiffRef {
  return {
    id: snapshot.id,
    capturedAt: snapshot.capturedAt,
    flowHash: snapshot.flow.flowHash,
    summaryHash: shortHash(stableStringify(snapshot.summary)),
    dashboardHash: shortHash(stableStringify(snapshot.dashboard)),
    runCount: snapshot.summary.runCount,
    averageOkRatePct: snapshot.summary.averageOkRatePct,
    averagePassRatePct: snapshot.summary.averagePassRatePct,
    regressingDatasetCount: snapshot.summary.regressingDatasetCount,
    flowChangedRunCount: snapshot.summary.flowChangedRunCount,
  };
}

function buildStudioExperimentDashboardHistory(
  flow: AgentFlow,
  snapshots: StudioExperimentDashboardSnapshot[],
  sharedSync?: StudioExperimentDashboardHistorySharedSyncInfo,
): StudioExperimentDashboardHistory {
  const normalized = syncStudioExperimentDashboardSnapshots(snapshots);
  const analysis = analyzeStudioExperimentDashboardHistory(normalized);
  return {
    format: "agent-flow-builder.experiment-dashboard-history.v1",
    exportedAt: new Date().toISOString(),
    flow: {
      id: flow.id,
      name: flow.name,
      version: flow.version,
    },
    snapshotCount: normalized.length,
    analysis,
    governance: studioExperimentDashboardHistoryGovernance(),
    sharedSync: sharedSync ?? buildStudioExperimentDashboardSharedSync(
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

function studioExperimentDashboardHistoryGovernance(): StudioExperimentDashboardHistory["governance"] {
  return {
    includesRawRunEvents: false,
    includesObservedOutputs: false,
    includesRawScenarioPayloads: false,
    includesSecretValues: false,
    includesOnlyAggregateDashboardData: true,
  };
}

function buildStudioExperimentDashboardSharedSync(
  action: StudioExperimentDashboardHistorySharedSyncAction,
  stats: Pick<
    StudioExperimentDashboardHistorySharedSyncInfo,
    "incomingCount" | "existingCount" | "addedCount" | "updatedCount" | "unchangedCount" | "finalCount"
  >,
  snapshots: StudioExperimentDashboardSnapshot[],
): StudioExperimentDashboardHistorySharedSyncInfo {
  return {
    action,
    updatedAt: new Date().toISOString(),
    storage: STUDIO_EXPERIMENT_DASHBOARD_HISTORY_FILE,
    contentHash: shortHash(stableStringify(snapshots.map(experimentDashboardHistoryDiffRef))),
    ...stats,
    governance: {
      includesRawRunEvents: false,
      includesObservedOutputs: false,
      includesRawScenarioPayloads: false,
      includesSecretValues: false,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  };
}

function normalizeStudioExperimentDashboardHistoryPayload(value: unknown): StudioExperimentDashboardHistory | null {
  if (!isRecord(value) || value.format !== "agent-flow-builder.experiment-dashboard-history.v1" || !Array.isArray(value.snapshots)) {
    return null;
  }
  const flow = isRecord(value.flow) ? value.flow : {};
  const snapshots = syncStudioExperimentDashboardSnapshots(value.snapshots);
  return {
    format: "agent-flow-builder.experiment-dashboard-history.v1",
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : new Date().toISOString(),
    flow: {
      id: typeof flow.id === "string" ? flow.id : "",
      name: typeof flow.name === "string" ? flow.name : "",
      version: typeof flow.version === "string" ? flow.version : "",
    },
    snapshotCount: snapshots.length,
    analysis: analyzeStudioExperimentDashboardHistory(snapshots),
    governance: studioExperimentDashboardHistoryGovernance(),
    sharedSync: buildStudioExperimentDashboardSharedSync(
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

function analyzeStudioExperimentDashboardHistory(
  snapshots: StudioExperimentDashboardSnapshot[],
): StudioExperimentDashboardHistoryAnalysis {
  const latest = snapshots[0] ?? null;
  const previous = snapshots[1] ?? null;
  const best = snapshots.reduce<StudioExperimentDashboardSnapshot | null>(
    (currentBest, snapshot) =>
      !currentBest ||
      snapshot.summary.averageOkRatePct > currentBest.summary.averageOkRatePct ||
      (
        snapshot.summary.averageOkRatePct === currentBest.summary.averageOkRatePct &&
        snapshot.summary.averagePassRatePct > currentBest.summary.averagePassRatePct
      )
        ? snapshot
        : currentBest,
    null,
  );
  const worst = snapshots.reduce<StudioExperimentDashboardSnapshot | null>(
    (currentWorst, snapshot) =>
      !currentWorst ||
      snapshot.summary.averageOkRatePct < currentWorst.summary.averageOkRatePct ||
      (
        snapshot.summary.averageOkRatePct === currentWorst.summary.averageOkRatePct &&
        snapshot.summary.averagePassRatePct < currentWorst.summary.averagePassRatePct
      )
        ? snapshot
        : currentWorst,
    null,
  );
  const latestOkRateDeltaPct = latest && previous ? latest.summary.averageOkRatePct - previous.summary.averageOkRatePct : null;
  const latestPassRateDeltaPct = latest && previous ? latest.summary.averagePassRatePct - previous.summary.averagePassRatePct : null;
  const latestTrend = latestDashboardHistoryTrend(latest, previous, latestOkRateDeltaPct);
  const averages = snapshots.reduce(
    (acc, snapshot) => ({
      ok: acc.ok + snapshot.summary.averageOkRatePct,
      pass: acc.pass + snapshot.summary.averagePassRatePct,
      runs: acc.runs + snapshot.summary.runCount,
      regressions: acc.regressions + snapshot.summary.regressingDatasetCount,
    }),
    { ok: 0, pass: 0, runs: 0, regressions: 0 },
  );
  return {
    latestTrend,
    latestSnapshotId: latest?.id ?? null,
    previousSnapshotId: previous?.id ?? null,
    bestSnapshotId: best?.id ?? null,
    worstSnapshotId: worst?.id ?? null,
    firstCapturedAt: snapshots.length ? snapshots[snapshots.length - 1].capturedAt : null,
    latestCapturedAt: latest?.capturedAt ?? null,
    latestOkRateDeltaPct,
    latestPassRateDeltaPct,
    latestRunCountDelta: latest && previous ? latest.summary.runCount - previous.summary.runCount : null,
    latestRegressionDelta: latest && previous
      ? latest.summary.regressingDatasetCount - previous.summary.regressingDatasetCount
      : null,
    latestFlowChanged: latest && previous ? latest.flow.flowHash !== previous.flow.flowHash : null,
    averageOkRatePct: snapshots.length ? Math.round(averages.ok / snapshots.length) : 0,
    averagePassRatePct: snapshots.length ? Math.round(averages.pass / snapshots.length) : 0,
    totalRunCount: averages.runs,
    totalRegressionCount: averages.regressions,
  };
}

function latestDashboardHistoryTrend(
  latest: StudioExperimentDashboardSnapshot | null,
  previous: StudioExperimentDashboardSnapshot | null,
  latestOkRateDeltaPct: number | null,
): StudioExperimentDashboardHistoryTrend {
  if (!latest) {
    return "none";
  }
  if (!previous || latestOkRateDeltaPct === null) {
    return "new";
  }
  if (latestOkRateDeltaPct >= 1) {
    return "improved";
  }
  if (latestOkRateDeltaPct <= -1) {
    return "regressed";
  }
  return "stable";
}

function normalizeStudioExperimentDashboardSnapshotPayload(
  value: unknown,
  flow: AgentFlow,
): StudioExperimentDashboardSnapshot | null {
  if (!isRecord(value) || value.format !== "agent-flow-builder.experiment-dashboard.v1") {
    return null;
  }
  const summary = normalizeStudioExperimentDashboardSummary(value.summary);
  if (!summary) {
    return null;
  }
  const dashboard = { ...value };
  const dashboardFlow = isRecord(value.flow) ? value.flow : {};
  const id = `dashboard-${createHash("sha256")
    .update(JSON.stringify({
      flowId: flow.id,
      flowHash: typeof dashboardFlow.flowHash === "string" ? dashboardFlow.flowHash : "",
      summary,
      datasets: Array.isArray(value.datasets) ? value.datasets : [],
    }))
    .digest("hex")
    .slice(0, 16)}`;
  return {
    id,
    capturedAt: typeof value.exportedAt === "string" ? value.exportedAt : new Date().toISOString(),
    flow: {
      id: flow.id,
      name: flow.name,
      version: flow.version,
      flowHash: typeof dashboardFlow.flowHash === "string" ? dashboardFlow.flowHash : "",
    },
    summary,
    dashboard,
  };
}

function normalizeStudioExperimentDashboardSnapshot(value: unknown): StudioExperimentDashboardSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : "";
  const capturedAt = typeof value.capturedAt === "string" ? value.capturedAt : "";
  const summary = normalizeStudioExperimentDashboardSummary(value.summary);
  const dashboard = isRecord(value.dashboard) ? value.dashboard : null;
  if (!id || !capturedAt || !summary || !dashboard) {
    return null;
  }
  const flow = isRecord(value.flow) ? value.flow : {};
  return {
    id,
    capturedAt,
    flow: {
      id: typeof flow.id === "string" ? flow.id : "",
      name: typeof flow.name === "string" ? flow.name : "",
      version: typeof flow.version === "string" ? flow.version : "",
      flowHash: typeof flow.flowHash === "string" ? flow.flowHash : "",
    },
    summary,
    dashboard,
  };
}

function syncStudioExperimentDashboardSnapshots(items: unknown[]): StudioExperimentDashboardSnapshot[] {
  const byId = new Map<string, StudioExperimentDashboardSnapshot>();
  for (const item of items.map(normalizeStudioExperimentDashboardSnapshot).filter((entry): entry is StudioExperimentDashboardSnapshot => entry !== null)) {
    const existing = byId.get(item.id);
    if (!existing || Date.parse(existing.capturedAt) <= Date.parse(item.capturedAt)) {
      byId.set(item.id, item);
    }
  }
  return Array.from(byId.values())
    .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt))
    .slice(0, MAX_EXPERIMENT_DASHBOARD_SNAPSHOTS);
}

function normalizeStudioExperimentDashboardSummary(value: unknown): StudioExperimentDashboardSnapshot["summary"] | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    datasetCount: normalizeNonNegativeInteger(value.datasetCount),
    datasetWithRunsCount: normalizeNonNegativeInteger(value.datasetWithRunsCount),
    scenarioCount: normalizeNonNegativeInteger(value.scenarioCount),
    runCount: normalizeNonNegativeInteger(value.runCount),
    latestRunAt: value.latestRunAt === null || typeof value.latestRunAt === "string" ? value.latestRunAt : null,
    averageOkRatePct: normalizePercent(value.averageOkRatePct),
    averagePassRatePct: normalizePercent(value.averagePassRatePct),
    regressingDatasetCount: normalizeNonNegativeInteger(value.regressingDatasetCount),
    flowChangedRunCount: normalizeNonNegativeInteger(value.flowChangedRunCount),
  };
}

function normalizeNonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function normalizePercent(value: unknown): number {
  return Math.min(100, Math.max(0, normalizeNonNegativeInteger(value)));
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
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
