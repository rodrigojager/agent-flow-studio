import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadFlowById, WorkspaceError } from "./workspace.ts";

type OrchestrationDebugHistorySharedSyncAction = "empty" | "save" | "merge";
type OrchestrationDebugHistoryDiffStatus = "same" | "changed" | "warning" | "missing";

interface OrchestrationDebugHistoryEntry {
  id: string;
  createdAt: string;
  outDir: string;
  runtimeUrl: string;
  message: string;
  result: Record<string, unknown>;
}

interface OrchestrationDebugHistoryMergeStats {
  incomingCount: number;
  existingCount: number;
  addedCount: number;
  updatedCount: number;
  unchangedCount: number;
  finalCount: number;
}

interface OrchestrationDebugHistoryDiffItem {
  id: string;
  label: string;
  status: OrchestrationDebugHistoryDiffStatus;
  left: string;
  right: string;
  delta: number;
}

interface OrchestrationDebugHistoryDiffSection {
  id: string;
  title: string;
  status: OrchestrationDebugHistoryDiffStatus;
  statusLabel: string;
  summary: string;
  items: OrchestrationDebugHistoryDiffItem[];
}

interface OrchestrationDebugHistoryRunRef {
  entryId: string;
  runId: string;
  createdAt: string;
  status: string;
  message: string;
  manifestId: string;
  manifestVersion: string;
  mode: string;
  entryAgentId: string;
  stepCount: number;
  timelineEvents: number;
  handoffDecisions: number;
  matchedHandoffs: number;
  agentIds: string[];
  errorCount: number;
}

export interface OrchestrationDebugHistoryDiffPackage {
  format: typeof ORCHESTRATION_DEBUG_HISTORY_DIFF_FORMAT;
  exportedAt: string;
  packageHash: string;
  flowId: string;
  left: OrchestrationDebugHistoryRunRef;
  right: OrchestrationDebugHistoryRunRef;
  summary: {
    status: OrchestrationDebugHistoryDiffStatus;
    statusLabel: string;
    headline: string;
    statusChanged: boolean;
    stepDelta: number;
    eventDelta: number;
    matchedHandoffDelta: number;
    changedSectionCount: number;
  };
  sections: OrchestrationDebugHistoryDiffSection[];
  governance: {
    previewOnly: true;
    excludesSecrets: true;
    excludesEnvValues: true;
    excludesRawRuntimePayloads: true;
    redactsSecretLikeKeys: true;
    source: "runtime-orchestration-debug-history-diff";
  };
}

export interface OrchestrationDebugHistoryPackage {
  format: typeof ORCHESTRATION_DEBUG_HISTORY_FORMAT;
  exportedAt: string;
  packageHash: string;
  flowId: string;
  entryCount: number;
  entries: OrchestrationDebugHistoryEntry[];
  governance: {
    localWorkspaceFile: true;
    previewOnly: true;
    excludesSecrets: true;
    excludesEnvValues: true;
    redactsSecretLikeKeys: true;
    usesRuntimeDebugTrace: true;
    source: "runtime-orchestration-debug";
  };
  sharedSync: {
    action: OrchestrationDebugHistorySharedSyncAction;
    updatedAt: string;
    storage: typeof ORCHESTRATION_DEBUG_HISTORY_FILE;
    contentHash: string;
    incomingCount: number;
    existingCount: number;
    addedCount: number;
    updatedCount: number;
    unchangedCount: number;
    finalCount: number;
    governance: {
      previewOnly: true;
      excludesSecrets: true;
      excludesEnvValues: true;
      redactsSecretLikeKeys: true;
    };
  };
}

export interface OrchestrationDebugHistoryCentralSyncStatus {
  format: typeof ORCHESTRATION_DEBUG_HISTORY_CENTRAL_STATUS_FORMAT;
  generatedAt: string;
  configured: boolean;
  urlConfigured: boolean;
  tokenConfigured: boolean;
  timeoutMs: number;
  invalidReason: string | null;
  lastSyncedAt: string | null;
  statusCode: number | null;
  pushedEntryCount: number | null;
  pulledEntryCount: number | null;
  error: string | null;
  governance: {
    previewOnly: true;
    excludesSecrets: true;
    excludesEnvValues: true;
    redactsSecretLikeKeys: true;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
    storesCentralToken: false;
    configuredUrlEnv: typeof ORCHESTRATION_DEBUG_HISTORY_CENTRAL_URL_ENV;
    configuredTokenEnv: typeof ORCHESTRATION_DEBUG_HISTORY_CENTRAL_TOKEN_ENV;
    configuredTimeoutEnv: typeof ORCHESTRATION_DEBUG_HISTORY_CENTRAL_TIMEOUT_ENV;
    maxPayloadBytes: typeof ORCHESTRATION_DEBUG_HISTORY_CENTRAL_MAX_BYTES;
  };
}

export interface OrchestrationDebugHistoryCentralSyncResult {
  format: typeof ORCHESTRATION_DEBUG_HISTORY_CENTRAL_SYNC_RESULT_FORMAT;
  flowId: string;
  history: OrchestrationDebugHistoryPackage;
  central: OrchestrationDebugHistoryCentralSyncStatus;
  pushedEntryCount: number;
  pulledEntryCount: number;
  governance: {
    previewOnly: true;
    excludesSecrets: true;
    excludesEnvValues: true;
    redactsSecretLikeKeys: true;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
  };
}

interface OrchestrationDebugHistoryCentralSyncConfig {
  url: string | null;
  token: string | null;
  timeoutMs: number;
  invalidReason: string | null;
}

const ORCHESTRATION_DEBUG_HISTORY_FORMAT = "agent-flow-builder.orchestration-debug-history.v1";
const ORCHESTRATION_DEBUG_HISTORY_DIFF_FORMAT = "agent-flow-builder.orchestration-debug-history-diff.v1";
const ORCHESTRATION_DEBUG_HISTORY_CENTRAL_SYNC_REQUEST_FORMAT =
  "agent-flow-builder.orchestration-debug-history-central-sync-request.v1";
const ORCHESTRATION_DEBUG_HISTORY_CENTRAL_SYNC_RESULT_FORMAT =
  "agent-flow-builder.orchestration-debug-history-central-sync-result.v1";
const ORCHESTRATION_DEBUG_HISTORY_CENTRAL_STATUS_FORMAT =
  "agent-flow-builder.orchestration-debug-history-central-sync-status.v1";
const ORCHESTRATION_DEBUG_HISTORY_FILE = ".agent-flow/orchestration-debug/history.aforchdebug.json";
const ORCHESTRATION_DEBUG_HISTORY_CENTRAL_URL_ENV = "AGENT_FLOW_ORCHESTRATION_DEBUG_HISTORY_CENTRAL_URL";
const ORCHESTRATION_DEBUG_HISTORY_CENTRAL_TOKEN_ENV = "AGENT_FLOW_ORCHESTRATION_DEBUG_HISTORY_CENTRAL_TOKEN";
const ORCHESTRATION_DEBUG_HISTORY_CENTRAL_TIMEOUT_ENV =
  "AGENT_FLOW_ORCHESTRATION_DEBUG_HISTORY_CENTRAL_TIMEOUT_MS";
const ORCHESTRATION_DEBUG_HISTORY_CENTRAL_TIMEOUT_MS = 5_000;
const ORCHESTRATION_DEBUG_HISTORY_CENTRAL_MAX_BYTES = 2_000_000;
const MAX_ORCHESTRATION_DEBUG_HISTORY_ENTRIES = 64;
const REDACTED_VALUE = "[redacted]";

export async function loadOrchestrationDebugHistory(
  workspaceRoot: string,
  flowId: string,
): Promise<OrchestrationDebugHistoryPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  try {
    const raw = await readFile(orchestrationDebugHistoryPath(loaded.flowRoot), "utf-8");
    const payload = normalizeOrchestrationDebugHistoryPackage(JSON.parse(raw) as unknown, loaded.flow.id, "merge");
    if (!payload) {
      throw new WorkspaceError("Pacote compartilhado de debug de orquestração inválido.", 422);
    }
    return payload;
  } catch (error) {
    if (isFileNotFound(error)) {
      return buildOrchestrationDebugHistoryPackage(loaded.flow.id, [], {
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
    throw new WorkspaceError("Falha ao ler histórico compartilhado de debug de orquestração.", 500, error);
  }
}

export async function saveOrchestrationDebugHistory(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<OrchestrationDebugHistoryPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const incoming = normalizeOrchestrationDebugHistoryPackage(payload, loaded.flow.id, "save");
  if (!incoming) {
    throw new WorkspaceError("Payload de debug de orquestração inválido.", 400);
  }
  const existing = await loadOrchestrationDebugHistory(workspaceRoot, flowId);
  const stats = compareOrchestrationDebugHistoryEntries(existing.entries, incoming.entries, "save");
  const next = buildOrchestrationDebugHistoryPackage(loaded.flow.id, incoming.entries, {
    action: "save",
    ...stats,
    finalCount: incoming.entries.length,
  });
  await writeOrchestrationDebugHistory(loaded.flowRoot, next);
  return next;
}

export async function mergeOrchestrationDebugHistory(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<OrchestrationDebugHistoryPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const incoming = normalizeOrchestrationDebugHistoryPackage(payload, loaded.flow.id, "merge");
  if (!incoming) {
    throw new WorkspaceError("Payload de merge do debug de orquestração inválido.", 400);
  }
  const existing = await loadOrchestrationDebugHistory(workspaceRoot, flowId);
  const merged = mergeOrchestrationDebugHistoryEntries(existing.entries, incoming.entries);
  const stats = compareOrchestrationDebugHistoryEntries(existing.entries, incoming.entries, "merge");
  const next = buildOrchestrationDebugHistoryPackage(loaded.flow.id, merged, {
    action: "merge",
    ...stats,
    finalCount: merged.length,
  });
  await writeOrchestrationDebugHistory(loaded.flowRoot, next);
  return next;
}

export async function compareOrchestrationDebugHistory(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<OrchestrationDebugHistoryDiffPackage> {
  const history = await loadOrchestrationDebugHistory(workspaceRoot, flowId);
  if (history.entries.length < 2) {
    throw new WorkspaceError("Histórico de debug de orquestração precisa de ao menos duas execuções para comparar.", 400);
  }
  const request = isRecord(payload) ? payload : {};
  const right = findOrchestrationDebugHistoryEntry(
    history.entries,
    readString(request.rightRunId) || readString(request.rightEntryId),
  ) ?? history.entries[0];
  const left = findOrchestrationDebugHistoryEntry(
    history.entries,
    readString(request.leftRunId) || readString(request.leftEntryId),
  ) ?? history.entries.find((entry) => orchestrationDebugHistoryEntryKey(entry) !== orchestrationDebugHistoryEntryKey(right));
  if (!left || !right) {
    throw new WorkspaceError("Não foi possível encontrar as duas execuções de orquestração para comparar.", 404);
  }
  if (orchestrationDebugHistoryEntryKey(left) === orchestrationDebugHistoryEntryKey(right)) {
    throw new WorkspaceError("Escolha duas execuções de orquestração diferentes para comparar.", 400);
  }
  return buildOrchestrationDebugHistoryDiffPackage(flowId, left, right);
}

export async function loadOrchestrationDebugHistoryCentralSyncStatus(): Promise<OrchestrationDebugHistoryCentralSyncStatus> {
  return buildOrchestrationDebugHistoryCentralSyncStatus(orchestrationDebugHistoryCentralSyncConfig());
}

export async function syncCentralOrchestrationDebugHistory(
  workspaceRoot: string,
  flowId: string,
): Promise<OrchestrationDebugHistoryCentralSyncResult> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const config = orchestrationDebugHistoryCentralSyncConfig();
  if (config.invalidReason) {
    throw new WorkspaceError(`Configuração da central de debug de orquestração inválida: ${config.invalidReason}`, 422);
  }
  if (!config.url) {
    throw new WorkspaceError("Central de debug de orquestração não configurada.", 400);
  }
  const existing = await loadOrchestrationDebugHistory(workspaceRoot, flowId);
  const fetched = await fetchCentralOrchestrationDebugHistorySync(config, flowId, existing);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fetched.body) as unknown;
  } catch (error) {
    throw new WorkspaceError("Resposta central de debug de orquestração não é JSON válido.", 502, error);
  }
  const centralPayload = isRecord(parsed) && parsed.history !== undefined ? parsed.history : parsed;
  const incoming = normalizeOrchestrationDebugHistoryPackage(centralPayload, loaded.flow.id, "merge");
  if (!incoming) {
    throw new WorkspaceError("Resposta central de debug de orquestração não respeita o formato esperado.", 502);
  }
  const merged = mergeOrchestrationDebugHistoryEntries(existing.entries, incoming.entries);
  const stats = compareOrchestrationDebugHistoryEntries(existing.entries, incoming.entries, "merge");
  const next = buildOrchestrationDebugHistoryPackage(loaded.flow.id, merged, {
    action: "merge",
    ...stats,
    finalCount: merged.length,
  });
  await writeOrchestrationDebugHistory(loaded.flowRoot, next);
  const syncedAt = new Date().toISOString();
  return {
    format: ORCHESTRATION_DEBUG_HISTORY_CENTRAL_SYNC_RESULT_FORMAT,
    flowId,
    history: next,
    central: buildOrchestrationDebugHistoryCentralSyncStatus(config, {
      lastSyncedAt: syncedAt,
      statusCode: fetched.statusCode,
      pushedEntryCount: existing.entryCount,
      pulledEntryCount: incoming.entryCount,
      error: null,
    }),
    pushedEntryCount: existing.entryCount,
    pulledEntryCount: incoming.entryCount,
    governance: {
      previewOnly: true,
      excludesSecrets: true,
      excludesEnvValues: true,
      redactsSecretLikeKeys: true,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  };
}

function buildOrchestrationDebugHistoryPackage(
  flowId: string,
  entries: OrchestrationDebugHistoryEntry[],
  sync: { action: OrchestrationDebugHistorySharedSyncAction } & OrchestrationDebugHistoryMergeStats,
): OrchestrationDebugHistoryPackage {
  const exportedAt = new Date().toISOString();
  const sortedEntries = sortOrchestrationDebugHistoryEntries(entries).slice(0, MAX_ORCHESTRATION_DEBUG_HISTORY_ENTRIES);
  const contentHash = hashJson({ flowId, entries: sortedEntries });
  return {
    format: ORCHESTRATION_DEBUG_HISTORY_FORMAT,
    exportedAt,
    packageHash: hashJson({ format: ORCHESTRATION_DEBUG_HISTORY_FORMAT, flowId, contentHash, exportedAt }),
    flowId,
    entryCount: sortedEntries.length,
    entries: sortedEntries,
    governance: {
      localWorkspaceFile: true,
      previewOnly: true,
      excludesSecrets: true,
      excludesEnvValues: true,
      redactsSecretLikeKeys: true,
      usesRuntimeDebugTrace: true,
      source: "runtime-orchestration-debug",
    },
    sharedSync: {
      action: sync.action,
      updatedAt: exportedAt,
      storage: ORCHESTRATION_DEBUG_HISTORY_FILE,
      contentHash,
      incomingCount: sync.incomingCount,
      existingCount: sync.existingCount,
      addedCount: sync.addedCount,
      updatedCount: sync.updatedCount,
      unchangedCount: sync.unchangedCount,
      finalCount: sync.finalCount,
      governance: {
        previewOnly: true,
        excludesSecrets: true,
        excludesEnvValues: true,
        redactsSecretLikeKeys: true,
      },
    },
  };
}

function normalizeOrchestrationDebugHistoryPackage(
  value: unknown,
  fallbackFlowId: string,
  action: OrchestrationDebugHistorySharedSyncAction,
): OrchestrationDebugHistoryPackage | null {
  const entries = normalizeOrchestrationDebugHistoryEntries(value);
  if (!entries) {
    return null;
  }
  return buildOrchestrationDebugHistoryPackage(readPackageFlowId(value) || fallbackFlowId, entries, {
    action,
    incomingCount: entries.length,
    existingCount: 0,
    addedCount: entries.length,
    updatedCount: 0,
    unchangedCount: 0,
    finalCount: entries.length,
  });
}

function normalizeOrchestrationDebugHistoryEntries(value: unknown): OrchestrationDebugHistoryEntry[] | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.format === "agent-flow-builder.runtime-orchestration-run.v1") {
    const entry = normalizeOrchestrationDebugHistoryEntry({ result: value });
    return entry ? [entry] : null;
  }
  if (value.result !== undefined) {
    const entry = normalizeOrchestrationDebugHistoryEntry(value);
    return entry ? [entry] : null;
  }
  if (value.format !== ORCHESTRATION_DEBUG_HISTORY_FORMAT) {
    return null;
  }
  const rawEntries = Array.isArray(value.entries) ? value.entries : [];
  return rawEntries
    .map(normalizeOrchestrationDebugHistoryEntry)
    .filter((entry): entry is OrchestrationDebugHistoryEntry => entry !== null);
}

function normalizeOrchestrationDebugHistoryEntry(value: unknown): OrchestrationDebugHistoryEntry | null {
  if (!isRecord(value) || !isRecord(value.result)) {
    return null;
  }
  const result = normalizeOrchestrationRunResult(value.result);
  if (!result) {
    return null;
  }
  const debugTrace = isRecord(result.debug_trace) ? result.debug_trace : {};
  const runId = normalizeString(readString(debugTrace.run_id), 160);
  const createdAt = normalizeDateString(value.createdAt) ??
    normalizeDateString(debugTrace.finished_at) ??
    normalizeDateString(debugTrace.started_at) ??
    new Date().toISOString();
  const base: Omit<OrchestrationDebugHistoryEntry, "id"> = {
    createdAt,
    outDir: normalizeString(readString(value.outDir), 240),
    runtimeUrl: sanitizeRuntimeUrl(readString(value.runtimeUrl)),
    message: normalizeString(readString(value.message) || readDebugTraceInputMessage(debugTrace), 500) ||
      "Executar orquestração multiagente.",
    result,
  };
  return {
    id: normalizeString(readString(value.id), 220) || `${runId || "orch"}-${hashJson(base).slice(0, 16)}`,
    ...base,
  };
}

function normalizeOrchestrationRunResult(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || value.format !== "agent-flow-builder.runtime-orchestration-run.v1") {
    return null;
  }
  const trace = isRecord(value.debug_trace) ? value.debug_trace : {};
  if (!Array.isArray(trace.timeline)) {
    return null;
  }
  return sanitizeValue(value) as Record<string, unknown>;
}

function readDebugTraceInputMessage(debugTrace: Record<string, unknown>): string {
  const input = isRecord(debugTrace.input) ? debugTrace.input : {};
  return readString(input.user_message) || readString(input.message);
}

function mergeOrchestrationDebugHistoryEntries(
  existing: OrchestrationDebugHistoryEntry[],
  incoming: OrchestrationDebugHistoryEntry[],
): OrchestrationDebugHistoryEntry[] {
  const byKey = new Map<string, OrchestrationDebugHistoryEntry>();
  for (const entry of existing) {
    byKey.set(orchestrationDebugHistoryEntryKey(entry), entry);
  }
  for (const entry of incoming) {
    const key = orchestrationDebugHistoryEntryKey(entry);
    const current = byKey.get(key);
    if (!current || entryIsNewerOrDifferent(entry, current)) {
      byKey.set(key, entry);
    }
  }
  return sortOrchestrationDebugHistoryEntries(Array.from(byKey.values()));
}

function compareOrchestrationDebugHistoryEntries(
  existing: OrchestrationDebugHistoryEntry[],
  incoming: OrchestrationDebugHistoryEntry[],
  mode: "save" | "merge",
): OrchestrationDebugHistoryMergeStats {
  const existingByKey = new Map(existing.map((entry) => [orchestrationDebugHistoryEntryKey(entry), entry] as const));
  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  for (const entry of incoming) {
    const current = existingByKey.get(orchestrationDebugHistoryEntryKey(entry));
    if (!current) {
      addedCount += 1;
    } else if (hashJson(current) !== hashJson(entry)) {
      updatedCount += 1;
    } else {
      unchangedCount += 1;
    }
  }
  return {
    incomingCount: incoming.length,
    existingCount: existing.length,
    addedCount,
    updatedCount,
    unchangedCount,
    finalCount: mode === "save" ? incoming.length : mergeOrchestrationDebugHistoryEntries(existing, incoming).length,
  };
}

function orchestrationDebugHistoryEntryKey(entry: OrchestrationDebugHistoryEntry): string {
  const debugTrace = isRecord(entry.result.debug_trace) ? entry.result.debug_trace : {};
  const runId = normalizeString(readString(debugTrace.run_id), 160);
  return runId || entry.id;
}

function entryIsNewerOrDifferent(left: OrchestrationDebugHistoryEntry, right: OrchestrationDebugHistoryEntry): boolean {
  const leftTime = Date.parse(left.createdAt);
  const rightTime = Date.parse(right.createdAt);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime > rightTime;
  }
  return hashJson(left) !== hashJson(right);
}

function sortOrchestrationDebugHistoryEntries(entries: OrchestrationDebugHistoryEntry[]): OrchestrationDebugHistoryEntry[] {
  return [...entries].sort((left, right) => {
    const dateDelta = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    return dateDelta || orchestrationDebugHistoryEntryKey(left).localeCompare(orchestrationDebugHistoryEntryKey(right));
  });
}

function findOrchestrationDebugHistoryEntry(
  entries: OrchestrationDebugHistoryEntry[],
  runOrEntryId: string,
): OrchestrationDebugHistoryEntry | null {
  const target = normalizeString(runOrEntryId, 220);
  if (!target) {
    return null;
  }
  return entries.find((entry) => entry.id === target || orchestrationDebugHistoryEntryKey(entry) === target) ?? null;
}

function buildOrchestrationDebugHistoryDiffPackage(
  flowId: string,
  leftEntry: OrchestrationDebugHistoryEntry,
  rightEntry: OrchestrationDebugHistoryEntry,
): OrchestrationDebugHistoryDiffPackage {
  const exportedAt = new Date().toISOString();
  const left = buildOrchestrationDebugHistoryRunRef(leftEntry);
  const right = buildOrchestrationDebugHistoryRunRef(rightEntry);
  const sections = [
    buildScalarOrchestrationDiffSection(left, right),
    buildCountMapDiffSection(
      "event-types",
      "Tipos de evento",
      countValues(orchestrationTimeline(leftEntry).map((event) => readString(event.type) || "unknown")),
      countValues(orchestrationTimeline(rightEntry).map((event) => readString(event.type) || "unknown")),
    ),
    buildCountMapDiffSection(
      "agents",
      "Agentes envolvidos",
      countValues(orchestrationTimeline(leftEntry).flatMap((event) => [readString(event.agent_id), readString(event.to_agent_id)]).filter(Boolean)),
      countValues(orchestrationTimeline(rightEntry).flatMap((event) => [readString(event.agent_id), readString(event.to_agent_id)]).filter(Boolean)),
    ),
    buildCountMapDiffSection(
      "handoffs",
      "Handoffs",
      countValues(orchestrationTimeline(leftEntry).map(handoffSignature).filter(Boolean)),
      countValues(orchestrationTimeline(rightEntry).map(handoffSignature).filter(Boolean)),
    ),
    buildCountMapDiffSection(
      "errors",
      "Erros",
      countValues(orchestrationErrors(leftEntry)),
      countValues(orchestrationErrors(rightEntry)),
    ),
  ];
  const changedSectionCount = sections.filter((section) => section.status !== "same").length;
  const statusChanged = left.status !== right.status;
  const stepDelta = right.stepCount - left.stepCount;
  const eventDelta = right.timelineEvents - left.timelineEvents;
  const matchedHandoffDelta = right.matchedHandoffs - left.matchedHandoffs;
  const status: OrchestrationDebugHistoryDiffStatus =
    statusChanged || changedSectionCount > 0 || stepDelta !== 0 || eventDelta !== 0 || matchedHandoffDelta !== 0
      ? "changed"
      : "same";
  const headlineParts = [
    statusChanged ? "status mudou" : "status igual",
    `${formatSignedNumber(stepDelta)} etapa(s)`,
    `${formatSignedNumber(eventDelta)} evento(s)`,
    `${formatSignedNumber(matchedHandoffDelta)} handoff(s)`,
    `${changedSectionCount} seção(ões) alterada(s)`,
  ];
  const packageBase = {
    format: "agent-flow-builder.orchestration-debug-history-diff.v1" as const,
    flowId,
    left,
    right,
    sections,
    summary: {
      status,
      statusLabel: status === "same" ? "igual" : "alterado",
      headline: headlineParts.join(" · "),
      statusChanged,
      stepDelta,
      eventDelta,
      matchedHandoffDelta,
      changedSectionCount,
    },
  };
  return {
    ...packageBase,
    exportedAt,
    packageHash: hashJson({ ...packageBase, exportedAt }),
    governance: {
      previewOnly: true,
      excludesSecrets: true,
      excludesEnvValues: true,
      excludesRawRuntimePayloads: true,
      redactsSecretLikeKeys: true,
      source: "runtime-orchestration-debug-history-diff",
    },
  };
}

function buildOrchestrationDebugHistoryRunRef(entry: OrchestrationDebugHistoryEntry): OrchestrationDebugHistoryRunRef {
  const trace = orchestrationTrace(entry);
  const summary = isRecord(trace.summary) ? trace.summary : {};
  const timeline = orchestrationTimeline(entry);
  const agentIds = uniqueSortedText([
    ...readStringArray(summary.agent_ids),
    ...timeline.flatMap((event) => [readString(event.agent_id), readString(event.to_agent_id)]).filter(Boolean),
  ]);
  return {
    entryId: entry.id,
    runId: readString(trace.run_id) || entry.id,
    createdAt: entry.createdAt,
    status: readString(entry.result.status) || readString(summary.status) || "unknown",
    message: normalizeString(entry.message, 300),
    manifestId: readString(entry.result.manifest_id) || readString(trace.manifest_id),
    manifestVersion: readString(entry.result.manifest_version) || readString(trace.manifest_version),
    mode: readString(entry.result.mode) || readString(trace.mode),
    entryAgentId: readString(entry.result.entry_agent_id) || readString(trace.entry_agent_id),
    stepCount: readNumber(summary.step_count) || (Array.isArray(entry.result.steps) ? entry.result.steps.length : 0),
    timelineEvents: readNumber(summary.timeline_events) || timeline.length,
    handoffDecisions: readNumber(summary.handoff_decisions) || timeline.filter((event) => event.type === "handoff_decision").length,
    matchedHandoffs: readNumber(summary.matched_handoffs) || timeline.filter((event) => event.type === "handoff_enqueued").length,
    agentIds,
    errorCount: orchestrationErrors(entry).length,
  };
}

function buildScalarOrchestrationDiffSection(
  left: OrchestrationDebugHistoryRunRef,
  right: OrchestrationDebugHistoryRunRef,
): OrchestrationDebugHistoryDiffSection {
  const items: OrchestrationDebugHistoryDiffItem[] = [
    buildTextDiffItem("status", "Status", left.status, right.status),
    buildTextDiffItem("mode", "Modo", left.mode, right.mode),
    buildTextDiffItem("entry-agent", "Agente de entrada", left.entryAgentId, right.entryAgentId),
    buildNumberDiffItem("steps", "Etapas", left.stepCount, right.stepCount),
    buildNumberDiffItem("timeline-events", "Eventos", left.timelineEvents, right.timelineEvents),
    buildNumberDiffItem("handoff-decisions", "Decisões de handoff", left.handoffDecisions, right.handoffDecisions),
    buildNumberDiffItem("matched-handoffs", "Handoffs executados", left.matchedHandoffs, right.matchedHandoffs),
    buildNumberDiffItem("errors", "Erros", left.errorCount, right.errorCount),
  ];
  return buildDiffSection("summary", "Resumo", items);
}

function buildCountMapDiffSection(
  id: string,
  title: string,
  leftCounts: Map<string, number>,
  rightCounts: Map<string, number>,
): OrchestrationDebugHistoryDiffSection {
  const keys = uniqueSortedText([...leftCounts.keys(), ...rightCounts.keys()]);
  const items = keys.map((key) => buildNumberDiffItem(key, key, leftCounts.get(key) ?? 0, rightCounts.get(key) ?? 0));
  return buildDiffSection(id, title, items);
}

function buildDiffSection(
  id: string,
  title: string,
  items: OrchestrationDebugHistoryDiffItem[],
): OrchestrationDebugHistoryDiffSection {
  const changedCount = items.filter((item) => item.status !== "same").length;
  const status: OrchestrationDebugHistoryDiffStatus = changedCount ? "changed" : "same";
  return {
    id,
    title,
    status,
    statusLabel: status === "same" ? "igual" : "alterado",
    summary: changedCount ? `${changedCount}/${items.length} item(ns) alterado(s)` : `${items.length} item(ns) sem mudança`,
    items: items.slice(0, 64),
  };
}

function buildTextDiffItem(id: string, label: string, left: string, right: string): OrchestrationDebugHistoryDiffItem {
  return {
    id,
    label,
    status: left === right ? "same" : "changed",
    left: left || "-",
    right: right || "-",
    delta: 0,
  };
}

function buildNumberDiffItem(id: string, label: string, left: number, right: number): OrchestrationDebugHistoryDiffItem {
  return {
    id,
    label,
    status: left === right ? "same" : "changed",
    left: String(left),
    right: String(right),
    delta: right - left,
  };
}

function orchestrationTrace(entry: OrchestrationDebugHistoryEntry): Record<string, unknown> {
  return isRecord(entry.result.debug_trace) ? entry.result.debug_trace : {};
}

function orchestrationTimeline(entry: OrchestrationDebugHistoryEntry): Array<Record<string, unknown>> {
  const trace = orchestrationTrace(entry);
  return Array.isArray(trace.timeline) ? trace.timeline.filter(isRecord) : [];
}

function orchestrationErrors(entry: OrchestrationDebugHistoryEntry): string[] {
  const resultError = isRecord(entry.result.error) ? readString(entry.result.error.message) : "";
  const timelineErrors = orchestrationTimeline(entry)
    .map((event) => readString(event.error) || (readString(event.type) === "orchestration_failed" ? readString(event.reason) : ""))
    .filter(Boolean);
  return uniqueSortedText([resultError, ...timelineErrors].filter(Boolean)).map((item) => normalizeString(item, 220));
}

function handoffSignature(event: Record<string, unknown>): string {
  const type = readString(event.type);
  if (type !== "handoff_decision" && type !== "handoff_enqueued") {
    return "";
  }
  const from = readString(event.agent_id) || "origem";
  const to = readString(event.to_agent_id) || "destino";
  const condition = readString(event.condition) || readString(event.handoff_condition) || "sem-condicao";
  const status = readString(event.status) || "unknown";
  return `${from} -> ${to} · ${condition} · ${status}`;
}

function countValues(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const normalized = normalizeString(value, 220);
    if (!normalized) {
      continue;
    }
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return counts;
}

function uniqueSortedText(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => normalizeString(value, 220)).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  );
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(readString).filter(Boolean) : [];
}

function readNumber(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

function formatSignedNumber(value: number): string {
  if (!Number.isFinite(value) || value === 0) {
    return "0";
  }
  return value > 0 ? `+${value}` : String(value);
}

async function writeOrchestrationDebugHistory(
  flowRoot: string,
  payload: OrchestrationDebugHistoryPackage,
): Promise<void> {
  const filePath = orchestrationDebugHistoryPath(flowRoot);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  await rename(tempPath, filePath);
}

function orchestrationDebugHistoryPath(flowRoot: string): string {
  return path.join(flowRoot, ORCHESTRATION_DEBUG_HISTORY_FILE);
}

function orchestrationDebugHistoryCentralSyncConfig(): OrchestrationDebugHistoryCentralSyncConfig {
  const configuredUrl = process.env[ORCHESTRATION_DEBUG_HISTORY_CENTRAL_URL_ENV]?.trim() ?? "";
  let url: string | null = null;
  let invalidReason: string | null = null;
  if (configuredUrl) {
    try {
      url = validateOrchestrationDebugHistoryCentralUrl(configuredUrl);
    } catch (error) {
      invalidReason = errorMessage(error);
    }
  }
  const timeoutValue = Number(process.env[ORCHESTRATION_DEBUG_HISTORY_CENTRAL_TIMEOUT_ENV] ?? "");
  const timeoutMs = Number.isFinite(timeoutValue)
    ? Math.min(Math.max(Math.floor(timeoutValue), 100), 60_000)
    : ORCHESTRATION_DEBUG_HISTORY_CENTRAL_TIMEOUT_MS;
  return {
    url,
    token: process.env[ORCHESTRATION_DEBUG_HISTORY_CENTRAL_TOKEN_ENV]?.trim() || null,
    timeoutMs,
    invalidReason,
  };
}

function buildOrchestrationDebugHistoryCentralSyncStatus(
  config: OrchestrationDebugHistoryCentralSyncConfig,
  sync?: Pick<
    OrchestrationDebugHistoryCentralSyncStatus,
    "lastSyncedAt" | "statusCode" | "pushedEntryCount" | "pulledEntryCount" | "error"
  >,
): OrchestrationDebugHistoryCentralSyncStatus {
  return {
    format: ORCHESTRATION_DEBUG_HISTORY_CENTRAL_STATUS_FORMAT,
    generatedAt: new Date().toISOString(),
    configured: Boolean(config.url && !config.invalidReason),
    urlConfigured: Boolean(process.env[ORCHESTRATION_DEBUG_HISTORY_CENTRAL_URL_ENV]?.trim()),
    tokenConfigured: Boolean(config.token),
    timeoutMs: config.timeoutMs,
    invalidReason: config.invalidReason,
    lastSyncedAt: sync?.lastSyncedAt ?? null,
    statusCode: sync?.statusCode ?? null,
    pushedEntryCount: sync?.pushedEntryCount ?? null,
    pulledEntryCount: sync?.pulledEntryCount ?? null,
    error: sync?.error ?? null,
    governance: {
      previewOnly: true,
      excludesSecrets: true,
      excludesEnvValues: true,
      redactsSecretLikeKeys: true,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
      storesCentralToken: false,
      configuredUrlEnv: ORCHESTRATION_DEBUG_HISTORY_CENTRAL_URL_ENV,
      configuredTokenEnv: ORCHESTRATION_DEBUG_HISTORY_CENTRAL_TOKEN_ENV,
      configuredTimeoutEnv: ORCHESTRATION_DEBUG_HISTORY_CENTRAL_TIMEOUT_ENV,
      maxPayloadBytes: ORCHESTRATION_DEBUG_HISTORY_CENTRAL_MAX_BYTES,
    },
  };
}

async function fetchCentralOrchestrationDebugHistorySync(
  config: OrchestrationDebugHistoryCentralSyncConfig,
  flowId: string,
  history: OrchestrationDebugHistoryPackage,
): Promise<{ statusCode: number; body: string }> {
  if (!config.url) {
    throw new WorkspaceError("Central de debug de orquestração não configurada.", 400);
  }
  const body = JSON.stringify({
    format: ORCHESTRATION_DEBUG_HISTORY_CENTRAL_SYNC_REQUEST_FORMAT,
    generatedAt: new Date().toISOString(),
    flowId,
    history,
    entryCount: history.entryCount,
    governance: {
      previewOnly: true,
      excludesSecrets: true,
      excludesEnvValues: true,
      redactsSecretLikeKeys: true,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  });
  if (Buffer.byteLength(body, "utf-8") > ORCHESTRATION_DEBUG_HISTORY_CENTRAL_MAX_BYTES) {
    throw new WorkspaceError("Histórico de debug de orquestração excede o limite permitido para sync central.", 413);
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
    if (Number.isFinite(contentLength) && contentLength > ORCHESTRATION_DEBUG_HISTORY_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central de debug de orquestração excede o limite permitido.", 413);
    }
    if (!response.ok) {
      throw new WorkspaceError(`Central de debug de orquestração respondeu HTTP ${response.status}.`, response.status);
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > ORCHESTRATION_DEBUG_HISTORY_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central de debug de orquestração excede o limite permitido.", 413);
    }
    return {
      statusCode: response.status,
      body: Buffer.from(buffer).toString("utf-8"),
    };
  } catch (error) {
    if (isRecord(error) && error.name === "AbortError") {
      throw new WorkspaceError("Timeout ao sincronizar central de debug de orquestração.", 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function validateOrchestrationDebugHistoryCentralUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WorkspaceError(`${ORCHESTRATION_DEBUG_HISTORY_CENTRAL_URL_ENV} deve ser uma URL HTTP/HTTPS válida.`, 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WorkspaceError(`${ORCHESTRATION_DEBUG_HISTORY_CENTRAL_URL_ENV} deve usar http ou https.`, 400);
  }
  return parsed.toString();
}

function sanitizeRuntimeUrl(value: string): string {
  if (!value.trim()) {
    return "";
  }
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return normalizeString(value, 240);
  }
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 8) {
    return "[max-depth]";
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.slice(0, 1500);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 256).map((item) => sanitizeValue(item, depth + 1));
  }
  if (!isRecord(value)) {
    return null;
  }
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value).slice(0, 256)) {
    if (isSensitiveKey(key)) {
      next[key] = REDACTED_VALUE;
      continue;
    }
    next[key] = sanitizeValue(child, depth + 1);
  }
  return next;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return [
    "apikey",
    "authorization",
    "bearer",
    "clientsecret",
    "cookie",
    "env",
    "password",
    "rawpayload",
    "secret",
    "sessiontoken",
    "token",
  ].some((part) => normalized.includes(part));
}

function readPackageFlowId(value: unknown): string {
  if (!isRecord(value)) {
    return "";
  }
  if (typeof value.flowId === "string") {
    return value.flowId.trim();
  }
  return "";
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeDateString(value: unknown): string | null {
  const raw = readString(value);
  if (!raw) {
    return null;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeString(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isFileNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
