import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadFlowById, WorkspaceError } from "./workspace.ts";
import type { AgentFlow } from "@agent-flow-builder/flow-spec";

interface RuntimeJobMetrics {
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

export interface RuntimeJobMetricsHistorySnapshot {
  id: string;
  capturedAt: string;
  flow: {
    id: string;
    name: string;
    version: string;
    flowHash: string;
  };
  windowHours: number;
  summary: {
    total: number;
    pendingDue: number;
    failed: number;
    exhausted: number;
    successRate: number | null;
    successRateInWindow: number | null;
    durationMsAvg: number | null;
    durationMsP95: number | null;
    throughputPerHour: number | null;
    finishedInWindow: number;
    finishedLastHour: number;
    lastFinishedAt: string | null;
    nextDueAt: string | null;
  };
  metrics: RuntimeJobMetrics;
}

type RuntimeJobMetricsHistoryTrend = "none" | "new" | "improved" | "regressed" | "stable";
type RuntimeJobMetricsHistorySharedSyncAction = "empty" | "load" | "save" | "merge" | "central_sync";

export interface RuntimeJobMetricsHistoryAnalysis {
  latestTrend: RuntimeJobMetricsHistoryTrend;
  latestSnapshotId: string | null;
  previousSnapshotId: string | null;
  bestSuccessSnapshotId: string | null;
  worstFailureSnapshotId: string | null;
  firstCapturedAt: string | null;
  latestCapturedAt: string | null;
  latestPendingDelta: number | null;
  latestFailedDelta: number | null;
  latestSuccessRateDelta: number | null;
  latestP95DeltaMs: number | null;
  latestFlowChanged: boolean | null;
  averageSuccessRate: number | null;
  averageThroughputPerHour: number | null;
  totalFinishedInWindow: number;
}

interface RuntimeJobMetricsHistorySharedSyncInfo {
  action: RuntimeJobMetricsHistorySharedSyncAction;
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
    includesRawJobPayloads: false;
    includesRawJobResults: false;
    includesRawJobErrors: false;
    includesSecretValues: false;
    includesEnvValues: false;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
  };
}

export interface RuntimeJobMetricsHistory {
  format: "agent-flow-builder.runtime-job-metrics-history.v1";
  exportedAt: string;
  flow: {
    id: string;
    name: string;
    version: string;
    flowHash: string;
  };
  snapshotCount: number;
  analysis: RuntimeJobMetricsHistoryAnalysis;
  governance: {
    includesRawJobPayloads: false;
    includesRawJobResults: false;
    includesRawJobErrors: false;
    includesSecretValues: false;
    includesEnvValues: false;
    includesOnlyAggregateJobMetrics: true;
  };
  sharedSync: RuntimeJobMetricsHistorySharedSyncInfo;
  snapshots: RuntimeJobMetricsHistorySnapshot[];
}

interface RuntimeJobMetricsCentralSyncConfig {
  url: string | null;
  token: string | null;
  timeoutMs: number;
  invalidReason: string | null;
}

export interface RuntimeJobMetricsCentralSyncStatus {
  format: typeof RUNTIME_JOB_METRICS_CENTRAL_STATUS_FORMAT;
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
    includesRawJobPayloads: false;
    includesRawJobResults: false;
    includesRawJobErrors: false;
    includesSecretValues: false;
    includesEnvValues: false;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
    storesCentralToken: false;
    configuredUrlEnv: typeof RUNTIME_JOB_METRICS_CENTRAL_URL_ENV;
    configuredTokenEnv: typeof RUNTIME_JOB_METRICS_CENTRAL_TOKEN_ENV;
    configuredTimeoutEnv: typeof RUNTIME_JOB_METRICS_CENTRAL_TIMEOUT_ENV;
    maxPayloadBytes: typeof RUNTIME_JOB_METRICS_CENTRAL_MAX_BYTES;
  };
}

export interface RuntimeJobMetricsCentralSyncResult {
  format: typeof RUNTIME_JOB_METRICS_CENTRAL_SYNC_RESULT_FORMAT;
  flowId: string;
  history: RuntimeJobMetricsHistory;
  central: RuntimeJobMetricsCentralSyncStatus;
  pushedSnapshotCount: number;
  pulledSnapshotCount: number;
  governance: {
    includesRawJobPayloads: false;
    includesRawJobResults: false;
    includesRawJobErrors: false;
    includesSecretValues: false;
    includesEnvValues: false;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
  };
}

interface RuntimeJobMetricsDiffRef {
  id: string;
  capturedAt: string;
  flowHash: string;
  summaryHash: string;
  aggregateHash: string;
  windowHours: number;
  total: number;
  pendingDue: number;
  failed: number;
  exhausted: number;
  successRate: number | null;
  successRateInWindow: number | null;
  durationMsP95: number | null;
  throughputPerHour: number | null;
  finishedInWindow: number;
  finishedLastHour: number;
}

interface RuntimeJobMetricsDiffSection {
  id: "added" | "removed" | "changed" | "unchanged";
  label: string;
  count: number;
  items: Array<{
    snapshotId: string;
    current: RuntimeJobMetricsDiffRef | null;
    incoming: RuntimeJobMetricsDiffRef | null;
  }>;
}

export interface RuntimeJobMetricsDiffPackage {
  format: typeof RUNTIME_JOB_METRICS_DIFF_FORMAT;
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
  sections: RuntimeJobMetricsDiffSection[];
  governance: {
    excludesRawJobPayloads: true;
    excludesRawJobResults: true;
    excludesRawJobErrors: true;
    excludesSecretValues: true;
    excludesEnvValues: true;
    includesOnlySnapshotRefsHashesAndAggregateMetrics: true;
  };
}

const RUNTIME_JOB_METRICS_HISTORY_FILE = ".agent-flow/runtime-job-metrics-history/history.json";
const MAX_RUNTIME_JOB_METRICS_SNAPSHOTS = 50;
const RUNTIME_JOB_METRICS_CENTRAL_STATUS_FORMAT =
  "agent-flow-builder.runtime-job-metrics-history-central-status.v1";
const RUNTIME_JOB_METRICS_CENTRAL_SYNC_RESULT_FORMAT =
  "agent-flow-builder.runtime-job-metrics-history-central-sync-result.v1";
const RUNTIME_JOB_METRICS_CENTRAL_SYNC_REQUEST_FORMAT =
  "agent-flow-builder.runtime-job-metrics-history-central-sync-request.v1";
const RUNTIME_JOB_METRICS_DIFF_FORMAT = "agent-flow-builder.runtime-job-metrics-history-diff.v1";
const RUNTIME_JOB_METRICS_CENTRAL_URL_ENV = "AGENT_FLOW_RUNTIME_JOB_METRICS_HISTORY_CENTRAL_URL";
const RUNTIME_JOB_METRICS_CENTRAL_TOKEN_ENV = "AGENT_FLOW_RUNTIME_JOB_METRICS_HISTORY_CENTRAL_TOKEN";
const RUNTIME_JOB_METRICS_CENTRAL_TIMEOUT_ENV = "AGENT_FLOW_RUNTIME_JOB_METRICS_HISTORY_CENTRAL_TIMEOUT_MS";
const RUNTIME_JOB_METRICS_CENTRAL_TIMEOUT_MS = 5_000;
const RUNTIME_JOB_METRICS_CENTRAL_MAX_BYTES = 1_000_000;

export async function loadRuntimeJobMetricsHistory(
  workspaceRoot: string,
  flowId: string,
): Promise<RuntimeJobMetricsHistory> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  try {
    const raw = await readFile(runtimeJobMetricsHistoryPath(loaded.flowRoot), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const history = normalizeRuntimeJobMetricsHistoryPayload(parsed);
    if (!history) {
      throw new WorkspaceError("Histórico de métricas de jobs inválido.", 422);
    }
    return buildRuntimeJobMetricsHistory(loaded.flow, history.snapshots);
  } catch (error) {
    if (isFileNotFound(error)) {
      return buildRuntimeJobMetricsHistory(loaded.flow, []);
    }
    if (error instanceof WorkspaceError) {
      throw error;
    }
    throw new WorkspaceError("Falha ao ler histórico de métricas de jobs.", 500, error);
  }
}

export async function saveRuntimeJobMetricsSnapshot(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<RuntimeJobMetricsHistory> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const snapshot = normalizeRuntimeJobMetricsSnapshot(payload);
  if (!snapshot) {
    throw new WorkspaceError("Payload de snapshot de métricas de jobs inválido.", 400);
  }
  const current = await loadRuntimeJobMetricsHistory(workspaceRoot, flowId);
  const merged = mergeRuntimeJobMetricsSnapshots(current.snapshots, [normalizeSnapshotFlow(snapshot, loaded.flow)]);
  const next = buildRuntimeJobMetricsHistory(loaded.flow, merged.snapshots, buildRuntimeJobMetricsSharedSync(
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
  await writeRuntimeJobMetricsHistory(loaded.flowRoot, next);
  return next;
}

export async function mergeRuntimeJobMetricsHistory(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<RuntimeJobMetricsHistory> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const incoming = normalizeRuntimeJobMetricsHistoryPayload(
    isRecord(payload) && payload.history !== undefined ? payload.history : payload,
  );
  if (!incoming) {
    throw new WorkspaceError("Payload de histórico de métricas de jobs inválido.", 400);
  }
  const existing = await loadRuntimeJobMetricsHistory(workspaceRoot, flowId);
  const merged = mergeRuntimeJobMetricsSnapshots(existing.snapshots, incoming.snapshots.map((snapshot) => normalizeSnapshotFlow(snapshot, loaded.flow)));
  const next = buildRuntimeJobMetricsHistory(loaded.flow, merged.snapshots, buildRuntimeJobMetricsSharedSync(
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
  await writeRuntimeJobMetricsHistory(loaded.flowRoot, next);
  return next;
}

export async function loadRuntimeJobMetricsCentralSyncStatus(): Promise<RuntimeJobMetricsCentralSyncStatus> {
  return buildRuntimeJobMetricsCentralSyncStatus(runtimeJobMetricsCentralSyncConfig());
}

export async function syncCentralRuntimeJobMetricsHistory(
  workspaceRoot: string,
  flowId: string,
): Promise<RuntimeJobMetricsCentralSyncResult> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const config = runtimeJobMetricsCentralSyncConfig();
  if (config.invalidReason) {
    throw new WorkspaceError(`Configuração da central de métricas de jobs inválida: ${config.invalidReason}`, 422);
  }
  if (!config.url) {
    throw new WorkspaceError("Central de métricas de jobs não configurada.", 400);
  }
  const existing = await loadRuntimeJobMetricsHistory(workspaceRoot, flowId);
  const fetched = await fetchCentralRuntimeJobMetricsHistory(config, flowId, existing);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fetched.body) as unknown;
  } catch (error) {
    throw new WorkspaceError("Resposta central de métricas de jobs não é JSON válido.", 502, error);
  }
  const incoming = normalizeRuntimeJobMetricsHistoryPayload(
    isRecord(parsed) && parsed.history !== undefined ? parsed.history : parsed,
  );
  if (!incoming) {
    throw new WorkspaceError("Resposta central de métricas de jobs não respeita o formato esperado.", 502);
  }
  const merged = mergeRuntimeJobMetricsSnapshots(existing.snapshots, incoming.snapshots.map((snapshot) => normalizeSnapshotFlow(snapshot, loaded.flow)));
  const next = buildRuntimeJobMetricsHistory(loaded.flow, merged.snapshots, buildRuntimeJobMetricsSharedSync(
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
  await writeRuntimeJobMetricsHistory(loaded.flowRoot, next);
  const syncedAt = new Date().toISOString();
  return {
    format: RUNTIME_JOB_METRICS_CENTRAL_SYNC_RESULT_FORMAT,
    flowId,
    history: next,
    central: buildRuntimeJobMetricsCentralSyncStatus(config, {
      lastSyncedAt: syncedAt,
      statusCode: fetched.statusCode,
      pushedSnapshotCount: existing.snapshotCount,
      pulledSnapshotCount: incoming.snapshotCount,
      error: null,
    }),
    pushedSnapshotCount: existing.snapshotCount,
    pulledSnapshotCount: incoming.snapshotCount,
    governance: runtimeJobMetricsCentralGovernance(),
  };
}

export async function compareRuntimeJobMetricsHistory(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<RuntimeJobMetricsDiffPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const existing = await loadRuntimeJobMetricsHistory(workspaceRoot, flowId);
  const incoming = normalizeRuntimeJobMetricsHistoryPayload(
    isRecord(payload) && payload.history !== undefined ? payload.history : payload,
  );
  if (!incoming) {
    throw new WorkspaceError("Payload de comparação de métricas de jobs inválido.", 400);
  }
  const currentById = new Map(existing.snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const incomingById = new Map(incoming.snapshots.map((snapshot) => [snapshot.id, normalizeSnapshotFlow(snapshot, loaded.flow)]));
  const sections: RuntimeJobMetricsDiffPackage["sections"] = [
    { id: "added", label: "Novos no pacote recebido", count: 0, items: [] },
    { id: "removed", label: "Ausentes no pacote recebido", count: 0, items: [] },
    { id: "changed", label: "Alterados", count: 0, items: [] },
    { id: "unchanged", label: "Iguais", count: 0, items: [] },
  ];
  const bySection = new Map(sections.map((section) => [section.id, section]));
  for (const id of Array.from(new Set([...currentById.keys(), ...incomingById.keys()])).sort()) {
    const current = currentById.get(id) ?? null;
    const incomingSnapshot = incomingById.get(id) ?? null;
    const currentRef = current ? runtimeJobMetricsDiffRef(current) : null;
    const incomingRef = incomingSnapshot ? runtimeJobMetricsDiffRef(incomingSnapshot) : null;
    const sectionId: RuntimeJobMetricsDiffSection["id"] =
      current && !incomingSnapshot
        ? "removed"
        : !current && incomingSnapshot
          ? "added"
          : currentRef && incomingRef && currentRef.aggregateHash !== incomingRef.aggregateHash
            ? "changed"
            : "unchanged";
    bySection.get(sectionId)?.items.push({ snapshotId: id, current: currentRef, incoming: incomingRef });
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
    format: RUNTIME_JOB_METRICS_DIFF_FORMAT,
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
      excludesRawJobPayloads: true,
      excludesRawJobResults: true,
      excludesRawJobErrors: true,
      excludesSecretValues: true,
      excludesEnvValues: true,
      includesOnlySnapshotRefsHashesAndAggregateMetrics: true,
    },
  };
}

function runtimeJobMetricsHistoryPath(flowRoot: string): string {
  return path.join(flowRoot, RUNTIME_JOB_METRICS_HISTORY_FILE);
}

async function writeRuntimeJobMetricsHistory(flowRoot: string, history: RuntimeJobMetricsHistory): Promise<void> {
  const historyPath = runtimeJobMetricsHistoryPath(flowRoot);
  await mkdir(path.dirname(historyPath), { recursive: true });
  const tempPath = `${historyPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(history, null, 2)}\n`, "utf-8");
  await rename(tempPath, historyPath);
}

function buildRuntimeJobMetricsHistory(
  flow: AgentFlow,
  snapshots: RuntimeJobMetricsHistorySnapshot[],
  sharedSync?: RuntimeJobMetricsHistorySharedSyncInfo,
): RuntimeJobMetricsHistory {
  const normalized = syncRuntimeJobMetricsSnapshots(snapshots.map((snapshot) => normalizeSnapshotFlow(snapshot, flow)));
  return {
    format: "agent-flow-builder.runtime-job-metrics-history.v1",
    exportedAt: new Date().toISOString(),
    flow: {
      id: flow.id,
      name: flow.name,
      version: flow.version,
      flowHash: shortHash(stableStringify(flow)),
    },
    snapshotCount: normalized.length,
    analysis: analyzeRuntimeJobMetricsHistory(normalized),
    governance: {
      includesRawJobPayloads: false,
      includesRawJobResults: false,
      includesRawJobErrors: false,
      includesSecretValues: false,
      includesEnvValues: false,
      includesOnlyAggregateJobMetrics: true,
    },
    sharedSync: sharedSync ?? buildRuntimeJobMetricsSharedSync(
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

function normalizeRuntimeJobMetricsHistoryPayload(value: unknown): RuntimeJobMetricsHistory | null {
  if (!isRecord(value) || value.format !== "agent-flow-builder.runtime-job-metrics-history.v1" || !Array.isArray(value.snapshots)) {
    return null;
  }
  const flow = isRecord(value.flow) ? value.flow : {};
  const snapshots = syncRuntimeJobMetricsSnapshots(value.snapshots);
  return {
    format: "agent-flow-builder.runtime-job-metrics-history.v1",
    exportedAt: readString(value.exportedAt) ?? new Date().toISOString(),
    flow: {
      id: readString(flow.id) ?? "",
      name: readString(flow.name) ?? "",
      version: readString(flow.version) ?? "",
      flowHash: readString(flow.flowHash) ?? "",
    },
    snapshotCount: snapshots.length,
    analysis: analyzeRuntimeJobMetricsHistory(snapshots),
    governance: {
      includesRawJobPayloads: false,
      includesRawJobResults: false,
      includesRawJobErrors: false,
      includesSecretValues: false,
      includesEnvValues: false,
      includesOnlyAggregateJobMetrics: true,
    },
    sharedSync: buildRuntimeJobMetricsSharedSync(
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

function buildRuntimeJobMetricsSharedSync(
  action: RuntimeJobMetricsHistorySharedSyncAction,
  stats: Pick<
    RuntimeJobMetricsHistorySharedSyncInfo,
    "incomingCount" | "existingCount" | "addedCount" | "updatedCount" | "unchangedCount" | "finalCount"
  >,
  snapshots: RuntimeJobMetricsHistorySnapshot[],
): RuntimeJobMetricsHistorySharedSyncInfo {
  return {
    action,
    updatedAt: new Date().toISOString(),
    storage: RUNTIME_JOB_METRICS_HISTORY_FILE,
    contentHash: shortHash(stableStringify(snapshots.map(runtimeJobMetricsDiffRef))),
    ...stats,
    governance: runtimeJobMetricsCentralGovernance(),
  };
}

function normalizeRuntimeJobMetricsSnapshot(value: unknown): RuntimeJobMetricsHistorySnapshot | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id);
  const capturedAt = readIsoDate(value.capturedAt);
  const metrics = normalizeRuntimeJobMetrics(value.metrics);
  if (!id || !capturedAt || !metrics) {
    return null;
  }
  const flow = isRecord(value.flow) ? value.flow : {};
  const summary = normalizeRuntimeJobMetricsSummary(value.summary, metrics);
  return {
    id,
    capturedAt,
    flow: {
      id: readString(flow.id) ?? "",
      name: readString(flow.name) ?? "",
      version: readString(flow.version) ?? "",
      flowHash: readString(flow.flowHash) ?? "",
    },
    windowHours: normalizeFiniteNumber(value.windowHours, metrics.window_hours),
    summary,
    metrics,
  };
}

function normalizeSnapshotFlow(
  snapshot: RuntimeJobMetricsHistorySnapshot,
  flow: AgentFlow,
): RuntimeJobMetricsHistorySnapshot {
  return {
    ...snapshot,
    flow: {
      id: flow.id,
      name: flow.name,
      version: flow.version,
      flowHash: shortHash(stableStringify(flow)),
    },
    summary: normalizeRuntimeJobMetricsSummary(snapshot.summary, snapshot.metrics),
    windowHours: snapshot.metrics.window_hours,
  };
}

function syncRuntimeJobMetricsSnapshots(items: unknown[]): RuntimeJobMetricsHistorySnapshot[] {
  const byId = new Map<string, RuntimeJobMetricsHistorySnapshot>();
  for (const item of items) {
    const snapshot = normalizeRuntimeJobMetricsSnapshot(item);
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
    .slice(0, MAX_RUNTIME_JOB_METRICS_SNAPSHOTS);
}

function mergeRuntimeJobMetricsSnapshots(
  existing: RuntimeJobMetricsHistorySnapshot[],
  incoming: RuntimeJobMetricsHistorySnapshot[],
): {
  snapshots: RuntimeJobMetricsHistorySnapshot[];
  stats: { addedCount: number; updatedCount: number; unchangedCount: number };
} {
  const byId = new Map(syncRuntimeJobMetricsSnapshots(existing).map((snapshot) => [snapshot.id, snapshot]));
  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  for (const snapshot of syncRuntimeJobMetricsSnapshots(incoming)) {
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
    snapshots: syncRuntimeJobMetricsSnapshots(Array.from(byId.values())),
    stats: { addedCount, updatedCount, unchangedCount },
  };
}

function analyzeRuntimeJobMetricsHistory(snapshots: RuntimeJobMetricsHistorySnapshot[]): RuntimeJobMetricsHistoryAnalysis {
  const latest = snapshots[0] ?? null;
  const previous = snapshots[1] ?? null;
  const bestSuccess = snapshots.reduce<RuntimeJobMetricsHistorySnapshot | null>((current, snapshot) => {
    const successRate = snapshot.summary.successRateInWindow ?? snapshot.summary.successRate ?? -1;
    const currentRate = current ? current.summary.successRateInWindow ?? current.summary.successRate ?? -1 : -1;
    return !current || successRate > currentRate ? snapshot : current;
  }, null);
  const worstFailure = snapshots.reduce<RuntimeJobMetricsHistorySnapshot | null>(
    (current, snapshot) => (!current || snapshot.summary.failed > current.summary.failed ? snapshot : current),
    null,
  );
  const latestSuccessRate = latest ? latest.summary.successRateInWindow ?? latest.summary.successRate : null;
  const previousSuccessRate = previous ? previous.summary.successRateInWindow ?? previous.summary.successRate : null;
  const latestP95 = latest?.summary.durationMsP95 ?? null;
  const previousP95 = previous?.summary.durationMsP95 ?? null;
  const successRates = snapshots
    .map((snapshot) => snapshot.summary.successRateInWindow ?? snapshot.summary.successRate)
    .filter((value): value is number => value !== null);
  const throughputs = snapshots
    .map((snapshot) => snapshot.summary.throughputPerHour)
    .filter((value): value is number => value !== null);
  const totalFinishedInWindow = snapshots.reduce((sum, snapshot) => sum + snapshot.summary.finishedInWindow, 0);
  return {
    latestTrend: runtimeJobMetricsTrend(latest, previous),
    latestSnapshotId: latest?.id ?? null,
    previousSnapshotId: previous?.id ?? null,
    bestSuccessSnapshotId: bestSuccess?.id ?? null,
    worstFailureSnapshotId: worstFailure?.id ?? null,
    firstCapturedAt: snapshots.length ? snapshots[snapshots.length - 1].capturedAt : null,
    latestCapturedAt: latest?.capturedAt ?? null,
    latestPendingDelta: latest && previous ? latest.summary.pendingDue - previous.summary.pendingDue : null,
    latestFailedDelta: latest && previous ? latest.summary.failed - previous.summary.failed : null,
    latestSuccessRateDelta: latestSuccessRate !== null && previousSuccessRate !== null
      ? Number((latestSuccessRate - previousSuccessRate).toFixed(4))
      : null,
    latestP95DeltaMs: latestP95 !== null && previousP95 !== null ? Number((latestP95 - previousP95).toFixed(4)) : null,
    latestFlowChanged: latest && previous ? latest.flow.flowHash !== previous.flow.flowHash : null,
    averageSuccessRate: successRates.length
      ? Number((successRates.reduce((sum, value) => sum + value, 0) / successRates.length).toFixed(4))
      : null,
    averageThroughputPerHour: throughputs.length
      ? Number((throughputs.reduce((sum, value) => sum + value, 0) / throughputs.length).toFixed(4))
      : null,
    totalFinishedInWindow,
  };
}

function runtimeJobMetricsTrend(
  latest: RuntimeJobMetricsHistorySnapshot | null,
  previous: RuntimeJobMetricsHistorySnapshot | null,
): RuntimeJobMetricsHistoryTrend {
  if (!latest) {
    return "none";
  }
  if (!previous) {
    return "new";
  }
  const latestRate = latest.summary.successRateInWindow ?? latest.summary.successRate ?? 0;
  const previousRate = previous.summary.successRateInWindow ?? previous.summary.successRate ?? 0;
  const failureDelta = latest.summary.failed + latest.summary.exhausted - previous.summary.failed - previous.summary.exhausted;
  if (latestRate > previousRate && failureDelta <= 0) {
    return "improved";
  }
  if (latestRate < previousRate || failureDelta > 0) {
    return "regressed";
  }
  return "stable";
}

function normalizeRuntimeJobMetricsSummary(
  value: unknown,
  metrics: RuntimeJobMetrics,
): RuntimeJobMetricsHistorySnapshot["summary"] {
  const source = isRecord(value) ? value : {};
  return {
    total: normalizeNonNegativeInteger(source.total, metrics.total),
    pendingDue: normalizeNonNegativeInteger(source.pendingDue, metrics.pending_due),
    failed: normalizeNonNegativeInteger(source.failed, metrics.failed),
    exhausted: normalizeNonNegativeInteger(source.exhausted, metrics.exhausted),
    successRate: normalizeNullableNumber(source.successRate, metrics.success_rate),
    successRateInWindow: normalizeNullableNumber(source.successRateInWindow, metrics.success_rate_in_window),
    durationMsAvg: normalizeNullableNumber(source.durationMsAvg, metrics.window_duration_ms_avg ?? metrics.duration_ms_avg),
    durationMsP95: normalizeNullableNumber(source.durationMsP95, metrics.window_duration_ms_p95 ?? metrics.duration_ms_p95),
    throughputPerHour: normalizeNullableNumber(source.throughputPerHour, metrics.throughput_per_hour),
    finishedInWindow: normalizeNonNegativeInteger(source.finishedInWindow, metrics.finished_in_window),
    finishedLastHour: normalizeNonNegativeInteger(source.finishedLastHour, metrics.finished_last_hour),
    lastFinishedAt: readIsoDate(source.lastFinishedAt) ?? metrics.last_finished_at,
    nextDueAt: readIsoDate(source.nextDueAt) ?? metrics.next_due_at,
  };
}

function normalizeRuntimeJobMetrics(value: unknown): RuntimeJobMetrics | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    total: normalizeNonNegativeInteger(value.total, 0),
    by_status: normalizeMetricRecord(value.by_status),
    by_kind: normalizeMetricRecord(value.by_kind),
    attempts_total: normalizeNonNegativeInteger(value.attempts_total, 0),
    pending_due: normalizeNonNegativeInteger(value.pending_due, 0),
    failed: normalizeNonNegativeInteger(value.failed, 0),
    exhausted: normalizeNonNegativeInteger(value.exhausted, 0),
    succeeded: normalizeNonNegativeInteger(value.succeeded, 0),
    terminal: normalizeNonNegativeInteger(value.terminal, 0),
    success_rate: normalizeNullableNumber(value.success_rate, null),
    duration_ms_avg: normalizeNullableNumber(value.duration_ms_avg, null),
    duration_ms_min: normalizeNullableNumber(value.duration_ms_min, null),
    duration_ms_max: normalizeNullableNumber(value.duration_ms_max, null),
    duration_ms_p95: normalizeNullableNumber(value.duration_ms_p95, null),
    window_hours: normalizeFiniteNumber(value.window_hours, 0),
    finished_in_window: normalizeNonNegativeInteger(value.finished_in_window, 0),
    succeeded_in_window: normalizeNonNegativeInteger(value.succeeded_in_window, 0),
    failed_in_window: normalizeNonNegativeInteger(value.failed_in_window, 0),
    success_rate_in_window: normalizeNullableNumber(value.success_rate_in_window, null),
    window_duration_ms_avg: normalizeNullableNumber(value.window_duration_ms_avg, null),
    window_duration_ms_p95: normalizeNullableNumber(value.window_duration_ms_p95, null),
    throughput_per_hour: normalizeNullableNumber(value.throughput_per_hour, null),
    oldest_pending_at: readIsoDate(value.oldest_pending_at),
    next_due_at: readIsoDate(value.next_due_at),
    finished_last_hour: normalizeNonNegativeInteger(value.finished_last_hour, 0),
    last_finished_at: readIsoDate(value.last_finished_at),
  };
}

function runtimeJobMetricsDiffRef(snapshot: RuntimeJobMetricsHistorySnapshot): RuntimeJobMetricsDiffRef {
  return {
    id: snapshot.id,
    capturedAt: snapshot.capturedAt,
    flowHash: snapshot.flow.flowHash,
    summaryHash: shortHash(stableStringify(snapshot.summary)),
    aggregateHash: shortHash(stableStringify(snapshot.metrics)),
    windowHours: snapshot.windowHours,
    total: snapshot.summary.total,
    pendingDue: snapshot.summary.pendingDue,
    failed: snapshot.summary.failed,
    exhausted: snapshot.summary.exhausted,
    successRate: snapshot.summary.successRate,
    successRateInWindow: snapshot.summary.successRateInWindow,
    durationMsP95: snapshot.summary.durationMsP95,
    throughputPerHour: snapshot.summary.throughputPerHour,
    finishedInWindow: snapshot.summary.finishedInWindow,
    finishedLastHour: snapshot.summary.finishedLastHour,
  };
}

function runtimeJobMetricsCentralSyncConfig(): RuntimeJobMetricsCentralSyncConfig {
  const configuredUrl = process.env[RUNTIME_JOB_METRICS_CENTRAL_URL_ENV]?.trim() ?? "";
  let url: string | null = null;
  let invalidReason: string | null = null;
  if (configuredUrl) {
    try {
      url = validateRuntimeJobMetricsCentralUrl(configuredUrl);
    } catch (error) {
      invalidReason = errorMessage(error);
    }
  }
  const timeoutValue = Number(process.env[RUNTIME_JOB_METRICS_CENTRAL_TIMEOUT_ENV] ?? "");
  const timeoutMs = Number.isFinite(timeoutValue)
    ? Math.min(Math.max(Math.floor(timeoutValue), 100), 60_000)
    : RUNTIME_JOB_METRICS_CENTRAL_TIMEOUT_MS;
  return {
    url,
    token: process.env[RUNTIME_JOB_METRICS_CENTRAL_TOKEN_ENV]?.trim() || null,
    timeoutMs,
    invalidReason,
  };
}

function buildRuntimeJobMetricsCentralSyncStatus(
  config: RuntimeJobMetricsCentralSyncConfig,
  sync?: Pick<
    RuntimeJobMetricsCentralSyncStatus,
    "lastSyncedAt" | "statusCode" | "pushedSnapshotCount" | "pulledSnapshotCount" | "error"
  >,
): RuntimeJobMetricsCentralSyncStatus {
  return {
    format: RUNTIME_JOB_METRICS_CENTRAL_STATUS_FORMAT,
    generatedAt: new Date().toISOString(),
    configured: Boolean(config.url && !config.invalidReason),
    urlConfigured: Boolean(process.env[RUNTIME_JOB_METRICS_CENTRAL_URL_ENV]?.trim()),
    tokenConfigured: Boolean(config.token),
    timeoutMs: config.timeoutMs,
    invalidReason: config.invalidReason,
    lastSyncedAt: sync?.lastSyncedAt ?? null,
    statusCode: sync?.statusCode ?? null,
    pushedSnapshotCount: sync?.pushedSnapshotCount ?? null,
    pulledSnapshotCount: sync?.pulledSnapshotCount ?? null,
    error: sync?.error ?? null,
    governance: {
      ...runtimeJobMetricsCentralGovernance(),
      storesCentralToken: false,
      configuredUrlEnv: RUNTIME_JOB_METRICS_CENTRAL_URL_ENV,
      configuredTokenEnv: RUNTIME_JOB_METRICS_CENTRAL_TOKEN_ENV,
      configuredTimeoutEnv: RUNTIME_JOB_METRICS_CENTRAL_TIMEOUT_ENV,
      maxPayloadBytes: RUNTIME_JOB_METRICS_CENTRAL_MAX_BYTES,
    },
  };
}

async function fetchCentralRuntimeJobMetricsHistory(
  config: RuntimeJobMetricsCentralSyncConfig,
  flowId: string,
  history: RuntimeJobMetricsHistory,
): Promise<{ statusCode: number; body: string }> {
  if (!config.url) {
    throw new WorkspaceError("Central de métricas de jobs não configurada.", 400);
  }
  const body = JSON.stringify({
    format: RUNTIME_JOB_METRICS_CENTRAL_SYNC_REQUEST_FORMAT,
    generatedAt: new Date().toISOString(),
    flowId,
    history,
    snapshotCount: history.snapshotCount,
    governance: runtimeJobMetricsCentralGovernance(),
  });
  if (Buffer.byteLength(body, "utf-8") > RUNTIME_JOB_METRICS_CENTRAL_MAX_BYTES) {
    throw new WorkspaceError("Histórico de métricas de jobs excede o limite de tamanho permitido para sync central.", 413);
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
    if (Number.isFinite(contentLength) && contentLength > RUNTIME_JOB_METRICS_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central de métricas de jobs excede o limite de tamanho permitido.", 413);
    }
    if (!response.ok) {
      throw new WorkspaceError(`Central de métricas de jobs respondeu HTTP ${response.status}.`, response.status);
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > RUNTIME_JOB_METRICS_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central de métricas de jobs excede o limite de tamanho permitido.", 413);
    }
    return {
      statusCode: response.status,
      body: Buffer.from(buffer).toString("utf-8"),
    };
  } catch (error) {
    if (isRecord(error) && error.name === "AbortError") {
      throw new WorkspaceError("Timeout ao sincronizar central de métricas de jobs.", 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function validateRuntimeJobMetricsCentralUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WorkspaceError(`${RUNTIME_JOB_METRICS_CENTRAL_URL_ENV} deve ser uma URL HTTP/HTTPS válida.`, 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WorkspaceError(`${RUNTIME_JOB_METRICS_CENTRAL_URL_ENV} deve usar http ou https.`, 400);
  }
  parsed.username = "";
  parsed.password = "";
  return parsed.toString();
}

function runtimeJobMetricsCentralGovernance(): RuntimeJobMetricsHistorySharedSyncInfo["governance"] {
  return {
    includesRawJobPayloads: false,
    includesRawJobResults: false,
    includesRawJobErrors: false,
    includesSecretValues: false,
    includesEnvValues: false,
    centralAuthTokenInHeaderOnly: true,
    centralAuthTokenInBody: false,
  };
}

function normalizeMetricRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, normalizeNonNegativeInteger(item, 0)] as const)
      .filter(([key]) => key.trim().length > 0),
  );
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : fallback;
}

function normalizeFiniteNumber(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeNullableNumber(value: unknown, fallback: number | null): number | null {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : fallback;
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
