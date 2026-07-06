import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadFlowById, WorkspaceError } from "./workspace.ts";

type RegressionAlertStatus = "open" | "acknowledged";
type RegressionAlertSeverity = "warn" | "fail";
type RegressionAlertSharedSyncAction = "empty" | "save" | "merge";
type RegressionAlertReviewerRole = "owner" | "operator" | "reviewer" | "viewer";

interface RegressionAlertNodeTypeThresholds {
  maxChangedNodes: number | null;
  maxStateDiffs: number | null;
  maxOutputDiffs: number | null;
}

interface RegressionAlertThresholds {
  tokenGrowthPct: number;
  costGrowthPct: number;
  durationGrowthPct: number;
  nodeTypeThresholds: Record<string, RegressionAlertNodeTypeThresholds>;
}

interface RegressionAlertItem {
  id: string;
  flowId: string;
  source: "run-comparison";
  route: "local-inbox";
  status: RegressionAlertStatus;
  severity: RegressionAlertSeverity;
  baselineRunId: string;
  candidateRunId: string;
  verdict: string;
  reasons: string[];
  appliedThresholds: RegressionAlertThresholds;
  metrics: {
    errorCountDelta: number;
    eventCountDelta: number;
    durationMsDelta: number | null;
    totalTokensDelta: number | null;
    totalCostUsdDelta: number | null;
    changedNodeCount: number;
    stateDiffCount: number;
    outputDiffCount: number;
    nodeTypeThresholdCount: number;
    comparesPinnedToLive: boolean;
  };
  firstSeenAt: string;
  lastSeenAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  acknowledgedRole: RegressionAlertReviewerRole | null;
  occurrenceCount: number;
  retainedUntil: string;
}

interface RegressionAlertPackage {
  format: "agent-flow-builder.regression-alerts.v1";
  exportedAt: string;
  flowId: string;
  packageHash: string;
  retentionPolicy: {
    mode: "shared-file";
    source: "run-comparison";
    excludesRawRuns: true;
    excludesRawNodePayloads: true;
    excludesSecretValues: true;
  };
  alertCount: number;
  openCount: number;
  items: RegressionAlertItem[];
  sharedSync: {
    action: RegressionAlertSharedSyncAction;
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
      excludesRawRuns: true;
      excludesRawNodePayloads: true;
      excludesSecretValues: true;
    };
  };
}

export interface RegressionAlertsCentralSyncStatus {
  format: typeof REGRESSION_ALERTS_CENTRAL_STATUS_FORMAT;
  generatedAt: string;
  configured: boolean;
  urlConfigured: boolean;
  tokenConfigured: boolean;
  timeoutMs: number;
  invalidReason: string | null;
  lastSyncedAt: string | null;
  statusCode: number | null;
  pushedAlertCount: number | null;
  pulledAlertCount: number | null;
  error: string | null;
  governance: {
    excludesRawRuns: true;
    excludesRawNodePayloads: true;
    excludesSecretValues: true;
    sendsRegressionMetrics: true;
    sendsRunIds: true;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
    storesCentralToken: false;
    configuredUrlEnv: typeof REGRESSION_ALERTS_CENTRAL_URL_ENV;
    configuredTokenEnv: typeof REGRESSION_ALERTS_CENTRAL_TOKEN_ENV;
    configuredTimeoutEnv: typeof REGRESSION_ALERTS_CENTRAL_TIMEOUT_ENV;
    maxPayloadBytes: typeof REGRESSION_ALERTS_CENTRAL_MAX_BYTES;
  };
}

export interface RegressionAlertsCentralSyncResult {
  format: typeof REGRESSION_ALERTS_CENTRAL_SYNC_RESULT_FORMAT;
  flowId: string;
  alerts: RegressionAlertPackage;
  central: RegressionAlertsCentralSyncStatus;
  pushedAlertCount: number;
  pulledAlertCount: number;
  governance: {
    excludesRawRuns: true;
    excludesRawNodePayloads: true;
    excludesSecretValues: true;
    sendsRegressionMetrics: true;
    sendsRunIds: true;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
  };
}

interface RegressionAlertMergeStats {
  incomingCount: number;
  existingCount: number;
  addedCount: number;
  updatedCount: number;
  unchangedCount: number;
  finalCount: number;
}

interface RegressionAlertsCentralSyncConfig {
  url: string | null;
  token: string | null;
  timeoutMs: number;
  invalidReason: string | null;
}

const REGRESSION_ALERTS_FILE = ".agent-flow/regression-alerts/inbox.afregressionalerts.json";
const REGRESSION_ALERTS_CENTRAL_SYNC_REQUEST_FORMAT = "agent-flow-builder.regression-alerts-central-sync-request.v1";
const REGRESSION_ALERTS_CENTRAL_SYNC_RESULT_FORMAT = "agent-flow-builder.regression-alerts-central-sync-result.v1";
const REGRESSION_ALERTS_CENTRAL_STATUS_FORMAT = "agent-flow-builder.regression-alerts-central-sync-status.v1";
const REGRESSION_ALERTS_CENTRAL_URL_ENV = "AGENT_FLOW_REGRESSION_ALERTS_CENTRAL_URL";
const REGRESSION_ALERTS_CENTRAL_TOKEN_ENV = "AGENT_FLOW_REGRESSION_ALERTS_CENTRAL_TOKEN";
const REGRESSION_ALERTS_CENTRAL_TIMEOUT_ENV = "AGENT_FLOW_REGRESSION_ALERTS_CENTRAL_TIMEOUT_MS";
const REGRESSION_ALERTS_CENTRAL_TIMEOUT_MS = 5_000;
const REGRESSION_ALERTS_CENTRAL_MAX_BYTES = 2_000_000;
const MAX_REGRESSION_ALERTS = 96;

export async function loadRegressionAlerts(workspaceRoot: string, flowId: string): Promise<RegressionAlertPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  try {
    const raw = await readFile(regressionAlertsPath(loaded.flowRoot), "utf-8");
    const payload = normalizeRegressionAlertPackage(JSON.parse(raw) as unknown, loaded.flow.id, "merge");
    if (!payload) {
      throw new WorkspaceError("Inbox compartilhada de alertas de regressao invalida.", 422);
    }
    return payload;
  } catch (error) {
    if (isFileNotFound(error)) {
      return buildRegressionAlertPackage(loaded.flow.id, [], {
        action: "empty",
        incomingCount: 0,
        existingCount: 0,
        addedCount: 0,
        updatedCount: 0,
        unchangedCount: 0,
        finalCount: 0,
      });
    }
    if (error instanceof WorkspaceError) {
      throw error;
    }
    throw new WorkspaceError("Falha ao ler inbox compartilhada de alertas de regressao.", 500, error);
  }
}

export async function saveRegressionAlerts(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<RegressionAlertPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const incoming = normalizeRegressionAlertPackage(payload, loaded.flow.id, "save");
  if (!incoming) {
    throw new WorkspaceError("Payload de alertas de regressao invalido.", 400);
  }
  const existing = await loadRegressionAlerts(workspaceRoot, flowId);
  const stats = compareRegressionAlertSets(existing.items, incoming.items, "save");
  const next = buildRegressionAlertPackage(loaded.flow.id, incoming.items, {
    action: "save",
    ...stats,
    finalCount: incoming.items.length,
  });
  await writeRegressionAlerts(loaded.flowRoot, next);
  return next;
}

export async function mergeRegressionAlerts(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<RegressionAlertPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const incoming = normalizeRegressionAlertPackage(payload, loaded.flow.id, "merge");
  if (!incoming) {
    throw new WorkspaceError("Payload de merge de alertas de regressao invalido.", 400);
  }
  const existing = await loadRegressionAlerts(workspaceRoot, flowId);
  const merged = mergeRegressionAlertItems(existing.items, incoming.items);
  const next = buildRegressionAlertPackage(loaded.flow.id, merged.items, {
    action: "merge",
    ...merged.stats,
  });
  await writeRegressionAlerts(loaded.flowRoot, next);
  return next;
}

export async function loadRegressionAlertsCentralSyncStatus(): Promise<RegressionAlertsCentralSyncStatus> {
  return buildRegressionAlertsCentralSyncStatus(regressionAlertsCentralSyncConfig());
}

export async function syncCentralRegressionAlerts(
  workspaceRoot: string,
  flowId: string,
): Promise<RegressionAlertsCentralSyncResult> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const config = regressionAlertsCentralSyncConfig();
  if (config.invalidReason) {
    throw new WorkspaceError(`Configuração da central de alertas de regressão inválida: ${config.invalidReason}`, 422);
  }
  if (!config.url) {
    throw new WorkspaceError("Central de alertas de regressão não configurada.", 400);
  }
  const existing = await loadRegressionAlerts(workspaceRoot, flowId);
  const fetched = await fetchCentralRegressionAlertsSync(config, flowId, existing);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fetched.body) as unknown;
  } catch (error) {
    throw new WorkspaceError("Resposta central de alertas de regressão não é JSON válido.", 502, error);
  }
  const centralAlertsPayload = isRecord(parsed) && parsed.alerts !== undefined ? parsed.alerts : parsed;
  const incoming = normalizeRegressionAlertPackage(centralAlertsPayload, loaded.flow.id, "merge");
  if (!incoming) {
    throw new WorkspaceError("Resposta central de alertas de regressão não respeita o formato esperado.", 502);
  }
  const merged = mergeRegressionAlertItems(existing.items, incoming.items);
  const next = buildRegressionAlertPackage(loaded.flow.id, merged.items, {
    action: "merge",
    ...merged.stats,
  });
  await writeRegressionAlerts(loaded.flowRoot, next);
  const syncedAt = new Date().toISOString();
  return {
    format: REGRESSION_ALERTS_CENTRAL_SYNC_RESULT_FORMAT,
    flowId,
    alerts: next,
    central: buildRegressionAlertsCentralSyncStatus(config, {
      lastSyncedAt: syncedAt,
      statusCode: fetched.statusCode,
      pushedAlertCount: existing.alertCount,
      pulledAlertCount: incoming.alertCount,
      error: null,
    }),
    pushedAlertCount: existing.alertCount,
    pulledAlertCount: incoming.alertCount,
    governance: {
      excludesRawRuns: true,
      excludesRawNodePayloads: true,
      excludesSecretValues: true,
      sendsRegressionMetrics: true,
      sendsRunIds: true,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  };
}

function regressionAlertsPath(flowRoot: string): string {
  return path.join(flowRoot, REGRESSION_ALERTS_FILE);
}

async function writeRegressionAlerts(flowRoot: string, value: RegressionAlertPackage): Promise<void> {
  const filePath = regressionAlertsPath(flowRoot);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await rename(tempPath, filePath);
}

function regressionAlertsCentralSyncConfig(): RegressionAlertsCentralSyncConfig {
  const configuredUrl = process.env[REGRESSION_ALERTS_CENTRAL_URL_ENV]?.trim() ?? "";
  let url: string | null = null;
  let invalidReason: string | null = null;
  if (configuredUrl) {
    try {
      url = validateRegressionAlertsCentralUrl(configuredUrl);
    } catch (error) {
      invalidReason = errorMessage(error);
    }
  }
  const timeoutValue = Number(process.env[REGRESSION_ALERTS_CENTRAL_TIMEOUT_ENV] ?? "");
  const timeoutMs = Number.isFinite(timeoutValue)
    ? Math.min(Math.max(Math.floor(timeoutValue), 100), 60_000)
    : REGRESSION_ALERTS_CENTRAL_TIMEOUT_MS;
  return {
    url,
    token: process.env[REGRESSION_ALERTS_CENTRAL_TOKEN_ENV]?.trim() || null,
    timeoutMs,
    invalidReason,
  };
}

function buildRegressionAlertsCentralSyncStatus(
  config: RegressionAlertsCentralSyncConfig,
  sync?: Pick<
    RegressionAlertsCentralSyncStatus,
    "lastSyncedAt" | "statusCode" | "pushedAlertCount" | "pulledAlertCount" | "error"
  >,
): RegressionAlertsCentralSyncStatus {
  return {
    format: REGRESSION_ALERTS_CENTRAL_STATUS_FORMAT,
    generatedAt: new Date().toISOString(),
    configured: Boolean(config.url && !config.invalidReason),
    urlConfigured: Boolean(process.env[REGRESSION_ALERTS_CENTRAL_URL_ENV]?.trim()),
    tokenConfigured: Boolean(config.token),
    timeoutMs: config.timeoutMs,
    invalidReason: config.invalidReason,
    lastSyncedAt: sync?.lastSyncedAt ?? null,
    statusCode: sync?.statusCode ?? null,
    pushedAlertCount: sync?.pushedAlertCount ?? null,
    pulledAlertCount: sync?.pulledAlertCount ?? null,
    error: sync?.error ?? null,
    governance: {
      excludesRawRuns: true,
      excludesRawNodePayloads: true,
      excludesSecretValues: true,
      sendsRegressionMetrics: true,
      sendsRunIds: true,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
      storesCentralToken: false,
      configuredUrlEnv: REGRESSION_ALERTS_CENTRAL_URL_ENV,
      configuredTokenEnv: REGRESSION_ALERTS_CENTRAL_TOKEN_ENV,
      configuredTimeoutEnv: REGRESSION_ALERTS_CENTRAL_TIMEOUT_ENV,
      maxPayloadBytes: REGRESSION_ALERTS_CENTRAL_MAX_BYTES,
    },
  };
}

async function fetchCentralRegressionAlertsSync(
  config: RegressionAlertsCentralSyncConfig,
  flowId: string,
  alerts: RegressionAlertPackage,
): Promise<{ statusCode: number; body: string }> {
  if (!config.url) {
    throw new WorkspaceError("Central de alertas de regressão não configurada.", 400);
  }
  const body = JSON.stringify({
    format: REGRESSION_ALERTS_CENTRAL_SYNC_REQUEST_FORMAT,
    generatedAt: new Date().toISOString(),
    flowId,
    alerts,
    alertCount: alerts.alertCount,
    governance: {
      excludesRawRuns: true,
      excludesRawNodePayloads: true,
      excludesSecretValues: true,
      sendsRegressionMetrics: true,
      sendsRunIds: true,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  });
  if (Buffer.byteLength(body, "utf-8") > REGRESSION_ALERTS_CENTRAL_MAX_BYTES) {
    throw new WorkspaceError("Inbox de alertas de regressão excede o limite de tamanho permitido para sync central.", 413);
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
    if (Number.isFinite(contentLength) && contentLength > REGRESSION_ALERTS_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central de alertas de regressão excede o limite de tamanho permitido.", 413);
    }
    if (!response.ok) {
      throw new WorkspaceError(`Central de alertas de regressão respondeu HTTP ${response.status}.`, response.status);
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > REGRESSION_ALERTS_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central de alertas de regressão excede o limite de tamanho permitido.", 413);
    }
    return {
      statusCode: response.status,
      body: Buffer.from(buffer).toString("utf-8"),
    };
  } catch (error) {
    if (isRecord(error) && error.name === "AbortError") {
      throw new WorkspaceError("Timeout ao sincronizar central de alertas de regressão.", 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function validateRegressionAlertsCentralUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WorkspaceError(`${REGRESSION_ALERTS_CENTRAL_URL_ENV} deve ser uma URL HTTP/HTTPS válida.`, 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WorkspaceError(`${REGRESSION_ALERTS_CENTRAL_URL_ENV} deve usar http ou https.`, 400);
  }
  return parsed.toString();
}

function normalizeRegressionAlertPackage(
  value: unknown,
  fallbackFlowId: string,
  action: RegressionAlertSharedSyncAction,
): RegressionAlertPackage | null {
  if (!isRecord(value) || value.format !== "agent-flow-builder.regression-alerts.v1" || !Array.isArray(value.items)) {
    return null;
  }
  const flowId = readString(value.flowId) ?? fallbackFlowId;
  const items = syncRegressionAlertItems(
    value.items
      .map((item) => normalizeRegressionAlertItem(item, flowId))
      .filter((item): item is RegressionAlertItem => item !== null),
  );
  return buildRegressionAlertPackage(flowId, items, {
    action,
    incomingCount: items.length,
    existingCount: 0,
    addedCount: items.length,
    updatedCount: 0,
    unchangedCount: 0,
    finalCount: items.length,
  });
}

function buildRegressionAlertPackage(
  flowId: string,
  items: unknown[],
  stats: RegressionAlertMergeStats & { action: RegressionAlertSharedSyncAction },
): RegressionAlertPackage {
  const normalized = syncRegressionAlertItems(
    items
      .map((item) => normalizeRegressionAlertItem(item, flowId))
      .filter((item): item is RegressionAlertItem => item !== null),
  ).slice(0, MAX_REGRESSION_ALERTS);
  const withoutHash = {
    format: "agent-flow-builder.regression-alerts.v1" as const,
    exportedAt: new Date().toISOString(),
    flowId,
    retentionPolicy: {
      mode: "shared-file" as const,
      source: "run-comparison" as const,
      excludesRawRuns: true as const,
      excludesRawNodePayloads: true as const,
      excludesSecretValues: true as const,
    },
    alertCount: normalized.length,
    openCount: normalized.filter((item) => item.status === "open").length,
    items: normalized,
  };
  return {
    ...withoutHash,
    packageHash: shortHash(stableStringify(withoutHash)),
    sharedSync: {
      action: stats.action,
      updatedAt: new Date().toISOString(),
      storage: REGRESSION_ALERTS_FILE,
      contentHash: shortHash(stableStringify({ flowId, items: normalized })),
      incomingCount: stats.incomingCount,
      existingCount: stats.existingCount,
      addedCount: stats.addedCount,
      updatedCount: stats.updatedCount,
      unchangedCount: stats.unchangedCount,
      finalCount: normalized.length,
      governance: {
        excludesRawRuns: true,
        excludesRawNodePayloads: true,
        excludesSecretValues: true,
      },
    },
  };
}

function mergeRegressionAlertItems(
  existingItems: RegressionAlertItem[],
  incomingItems: RegressionAlertItem[],
): { items: RegressionAlertItem[]; stats: RegressionAlertMergeStats } {
  const existing = syncRegressionAlertItems(existingItems);
  const incoming = syncRegressionAlertItems(incomingItems);
  const byId = new Map(existing.map((item) => [item.id, item]));
  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  for (const incomingItem of incoming) {
    const current = byId.get(incomingItem.id);
    if (!current) {
      byId.set(incomingItem.id, incomingItem);
      addedCount += 1;
      continue;
    }
    const selected = selectFresherRegressionAlert(current, incomingItem);
    if (stableStringify(selected) === stableStringify(current)) {
      unchangedCount += 1;
    } else {
      updatedCount += 1;
      byId.set(incomingItem.id, selected);
    }
  }
  const items = syncRegressionAlertItems(Array.from(byId.values()));
  return {
    items,
    stats: {
      incomingCount: incoming.length,
      existingCount: existing.length,
      addedCount,
      updatedCount,
      unchangedCount,
      finalCount: items.length,
    },
  };
}

function compareRegressionAlertSets(
  existingItems: RegressionAlertItem[],
  incomingItems: RegressionAlertItem[],
  action: RegressionAlertSharedSyncAction,
): RegressionAlertMergeStats {
  if (action === "merge") {
    return mergeRegressionAlertItems(existingItems, incomingItems).stats;
  }
  const existingById = new Map(syncRegressionAlertItems(existingItems).map((item) => [item.id, item]));
  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  for (const incoming of syncRegressionAlertItems(incomingItems)) {
    const existing = existingById.get(incoming.id);
    if (!existing) {
      addedCount += 1;
    } else if (stableStringify(existing) === stableStringify(incoming)) {
      unchangedCount += 1;
    } else {
      updatedCount += 1;
    }
  }
  return {
    incomingCount: incomingItems.length,
    existingCount: existingById.size,
    addedCount,
    updatedCount,
    unchangedCount,
    finalCount: incomingItems.length,
  };
}

function syncRegressionAlertItems(items: RegressionAlertItem[]): RegressionAlertItem[] {
  const now = Date.now();
  const byId = new Map<string, RegressionAlertItem>();
  for (const item of items) {
    const retainedUntil = Date.parse(item.retainedUntil);
    if (Number.isFinite(retainedUntil) && retainedUntil < now) {
      continue;
    }
    const current = byId.get(item.id);
    byId.set(item.id, current ? selectFresherRegressionAlert(current, item) : item);
  }
  return Array.from(byId.values()).sort((left, right) => alertFreshness(right) - alertFreshness(left));
}

function selectFresherRegressionAlert(left: RegressionAlertItem, right: RegressionAlertItem): RegressionAlertItem {
  const leftFreshness = alertFreshness(left);
  const rightFreshness = alertFreshness(right);
  if (rightFreshness > leftFreshness) {
    return right;
  }
  if (leftFreshness > rightFreshness) {
    return left;
  }
  if (left.status === "acknowledged" && right.status === "open") {
    return left;
  }
  if (right.status === "acknowledged" && left.status === "open") {
    return right;
  }
  return right.occurrenceCount > left.occurrenceCount ? right : left;
}

function alertFreshness(item: RegressionAlertItem): number {
  return Math.max(
    parsedTime(item.acknowledgedAt),
    parsedTime(item.lastSeenAt),
    parsedTime(item.firstSeenAt),
  );
}

function normalizeRegressionAlertItem(value: unknown, fallbackFlowId: string): RegressionAlertItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const baselineRunId = readString(value.baselineRunId);
  const candidateRunId = readString(value.candidateRunId);
  if (!baselineRunId || !candidateRunId) {
    return null;
  }
  const flowId = readString(value.flowId) ?? fallbackFlowId;
  const severity: RegressionAlertSeverity = value.severity === "fail" ? "fail" : "warn";
  const status: RegressionAlertStatus = value.status === "acknowledged" ? "acknowledged" : "open";
  const acknowledgedRole =
    status === "acknowledged" ? normalizeRegressionAlertReviewerRole(value.acknowledgedRole) : null;
  assertRegressionAlertAcknowledgementAllowed(acknowledgedRole);
  const metrics = isRecord(value.metrics) ? value.metrics : {};
  const now = new Date().toISOString();
  return {
    id: readString(value.id) ?? `regression-alert-${shortHash(`${flowId}|${baselineRunId}|${candidateRunId}`)}`,
    flowId,
    source: "run-comparison",
    route: "local-inbox",
    status,
    severity,
    baselineRunId,
    candidateRunId,
    verdict: readString(value.verdict) ?? (severity === "fail" ? "Regressao detectada." : "Regressao em atencao."),
    reasons: normalizeStringList(value.reasons, 12),
    appliedThresholds: normalizeRegressionAlertThresholds(value.appliedThresholds),
    metrics: {
      errorCountDelta: readFiniteNumber(metrics.errorCountDelta, 0),
      eventCountDelta: readFiniteNumber(metrics.eventCountDelta, 0),
      durationMsDelta: readNullableNumber(metrics.durationMsDelta),
      totalTokensDelta: readNullableNumber(metrics.totalTokensDelta),
      totalCostUsdDelta: readNullableNumber(metrics.totalCostUsdDelta),
      changedNodeCount: readNonNegativeInteger(metrics.changedNodeCount),
      stateDiffCount: readNonNegativeInteger(metrics.stateDiffCount),
      outputDiffCount: readNonNegativeInteger(metrics.outputDiffCount),
      nodeTypeThresholdCount: readNonNegativeInteger(metrics.nodeTypeThresholdCount),
      comparesPinnedToLive: metrics.comparesPinnedToLive === true,
    },
    firstSeenAt: readIsoDate(value.firstSeenAt) ?? now,
    lastSeenAt: readIsoDate(value.lastSeenAt) ?? now,
    acknowledgedAt: status === "acknowledged" ? readIsoDate(value.acknowledgedAt) ?? now : null,
    acknowledgedBy:
      status === "acknowledged" ? readString(value.acknowledgedBy) ?? readString(value.acknowledgedActor) ?? "local-studio" : null,
    acknowledgedRole,
    occurrenceCount: Math.max(1, readNonNegativeInteger(value.occurrenceCount)),
    retainedUntil: readIsoDate(value.retainedUntil) ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

function normalizeRegressionAlertReviewerRole(value: unknown): RegressionAlertReviewerRole {
  if (value === "owner" || value === "operator" || value === "viewer") {
    return value;
  }
  return "reviewer";
}

function assertRegressionAlertAcknowledgementAllowed(role: RegressionAlertReviewerRole | null): void {
  if (role !== "viewer") {
    return;
  }
  throw new WorkspaceError("Viewer não pode reconhecer alertas de regressão.", 403, {
    code: "regression_alert_acknowledgement_viewer_forbidden",
    role,
    requiredRole: "reviewer",
  });
}

function normalizeRegressionAlertThresholds(value: unknown): RegressionAlertThresholds {
  const record = isRecord(value) ? value : {};
  return {
    tokenGrowthPct: readFiniteNumber(record.tokenGrowthPct, 25),
    costGrowthPct: readFiniteNumber(record.costGrowthPct, 25),
    durationGrowthPct: readFiniteNumber(record.durationGrowthPct, 50),
    nodeTypeThresholds: normalizeNodeTypeThresholds(record.nodeTypeThresholds),
  };
}

function normalizeNodeTypeThresholds(value: unknown): Record<string, RegressionAlertNodeTypeThresholds> {
  if (!isRecord(value)) {
    return {};
  }
  const result: Record<string, RegressionAlertNodeTypeThresholds> = {};
  for (const [key, raw] of Object.entries(value).slice(0, 32)) {
    const id = key.trim();
    if (!id || !isRecord(raw)) {
      continue;
    }
    result[id] = {
      maxChangedNodes: readNullableNonNegativeInteger(raw.maxChangedNodes),
      maxStateDiffs: readNullableNonNegativeInteger(raw.maxStateDiffs),
      maxOutputDiffs: readNullableNonNegativeInteger(raw.maxOutputDiffs),
    };
  }
  return result;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeStringList(value: unknown, limit: number): string[] {
  return Array.isArray(value) ? value.map(readString).filter((item): item is string => item !== null).slice(0, limit) : [];
}

function readIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  return Number.isNaN(Date.parse(value)) ? null : value.trim();
}

function readFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function readNullableNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function parsedTime(value: string | null): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
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
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
