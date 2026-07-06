import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadFlowById, WorkspaceError } from "./workspace.ts";

type DebugLayerScope = "run_comparison" | "scenario_batch";
type DebugLayerStatus = "same" | "changed" | "warning" | "missing";
type DebugLayerSnapshotsSharedSyncAction = "empty" | "save" | "merge" | "curate_conflict" | "resolve_conflict";
type DebugLayerSnapshotConflictCurationAction = "assign" | "release";
type DebugLayerSnapshotConflictCurationLastAction = DebugLayerSnapshotConflictCurationAction | "lease_expired";
type DebugLayerSnapshotConflictCurationStatus = "unassigned" | "assigned";
type DebugLayerSnapshotConflictCuratorRole = "owner" | "reviewer" | "viewer";

interface DebugLayerItem {
  id: string;
  title: string;
  status: DebugLayerStatus;
  statusLabel: string;
  summary: string;
  detail: string;
  action: string;
}

interface DebugLayerSummary {
  status: DebugLayerStatus;
  statusLabel: string;
  headline: string;
  items: DebugLayerItem[];
}

interface DebugLayerSnapshot {
  format: typeof DEBUG_LAYER_SUMMARY_FORMAT;
  exportedAt: string;
  packageHash: string;
  scope: DebugLayerScope;
  flow: {
    id: string;
    name: string;
    version: string;
    nodeCount: number;
    edgeCount: number;
  };
  summary: DebugLayerSummary;
  evidence: Record<string, unknown>;
  governance: {
    excludesRawNodePayloads: true;
    excludesSecretValues: true;
    source: string;
  };
}

interface DebugLayerSnapshotsMergeStats {
  incomingCount: number;
  existingCount: number;
  addedCount: number;
  unchangedCount: number;
  finalCount: number;
}

interface DebugLayerSnapshotConflictRef {
  packageHash: string;
  exportedAt: string;
  scope: DebugLayerScope;
  headline: string;
  statusLabel: string;
  leftRunId: string;
  rightRunId: string;
  selectedNodeId: string;
  batchReportHash: string;
}

interface DebugLayerSnapshotConflict {
  conflictId: string;
  status: "open";
  conflictKey: string;
  scope: DebugLayerScope;
  snapshotCount: number;
  packageHashes: string[];
  latestPackageHash: string;
  latestExportedAt: string;
  refs: DebugLayerSnapshotConflictRef[];
  curationThread: DebugLayerSnapshotConflictCurationThread;
  governance: {
    excludesRawNodePayloads: true;
    excludesSecretValues: true;
  };
}

interface DebugLayerSnapshotConflictCurationThread {
  status: DebugLayerSnapshotConflictCurationStatus;
  assignee: string;
  openedAt: string | null;
  updatedAt: string | null;
  lastActor: string;
  lastAction: DebugLayerSnapshotConflictCurationLastAction | null;
  note: string;
  leaseExpiresAt: string | null;
  leaseDurationHours: number | null;
  leaseExpired: boolean;
  events: DebugLayerSnapshotConflictCurationEvent[];
  governance: {
    excludesRawNodePayloads: true;
    excludesSecretValues: true;
    autoReleasesExpiredAssignments: true;
    configuredLeaseHoursEnv: typeof DEBUG_LAYER_SNAPSHOT_CONFLICT_CURATION_LEASE_HOURS_ENV;
  };
}

interface DebugLayerSnapshotConflictCurationEvent {
  id: string;
  at: string;
  actor: string;
  role: DebugLayerSnapshotConflictCuratorRole;
  action: DebugLayerSnapshotConflictCurationLastAction;
  assignee: string;
  note: string;
}

interface DebugLayerSnapshotResolutionRecord {
  resolutionId: string;
  conflictId: string;
  conflictKey: string;
  scope: DebugLayerScope;
  resolvedAt: string;
  resolvedBy: string;
  resolvedRole: DebugLayerSnapshotConflictCuratorRole;
  resolutionNote: string;
  keptPackageHash: string;
  keptRef: DebugLayerSnapshotConflictRef;
  discardedRefs: DebugLayerSnapshotConflictRef[];
  candidateCount: number;
  governance: {
    excludesRawNodePayloads: true;
    excludesSecretValues: true;
  };
}

export interface DebugLayerSnapshotsPackage {
  format: typeof DEBUG_LAYER_SNAPSHOTS_FORMAT;
  exportedAt: string;
  packageHash: string;
  flowId: string;
  snapshotCount: number;
  snapshots: DebugLayerSnapshot[];
  conflictCount: number;
  openConflictCount: number;
  conflicts: DebugLayerSnapshotConflict[];
  resolutionHistoryCount: number;
  resolutionHistory: DebugLayerSnapshotResolutionRecord[];
  governance: {
    excludesRawNodePayloads: true;
    excludesSecretValues: true;
    localWorkspaceFile: true;
    source: "studio-debug-layer-snapshots";
  };
  sharedSync: {
    action: DebugLayerSnapshotsSharedSyncAction;
    updatedAt: string;
    storage: typeof DEBUG_LAYER_SNAPSHOTS_FILE;
    contentHash: string;
    incomingCount: number;
    existingCount: number;
    addedCount: number;
    unchangedCount: number;
    finalCount: number;
    conflictCount: number;
    openConflictCount: number;
    governance: {
      excludesRawNodePayloads: true;
      excludesSecretValues: true;
    };
  };
}

export interface DebugLayerSnapshotsCentralSyncStatus {
  format: typeof DEBUG_LAYER_SNAPSHOTS_CENTRAL_STATUS_FORMAT;
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
    excludesRawNodePayloads: true;
    excludesSecretValues: true;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
    storesCentralToken: false;
    configuredUrlEnv: typeof DEBUG_LAYER_SNAPSHOTS_CENTRAL_URL_ENV;
    configuredTokenEnv: typeof DEBUG_LAYER_SNAPSHOTS_CENTRAL_TOKEN_ENV;
    configuredTimeoutEnv: typeof DEBUG_LAYER_SNAPSHOTS_CENTRAL_TIMEOUT_ENV;
    maxPayloadBytes: typeof DEBUG_LAYER_SNAPSHOTS_CENTRAL_MAX_BYTES;
  };
}

export interface DebugLayerSnapshotsCentralSyncResult {
  format: typeof DEBUG_LAYER_SNAPSHOTS_CENTRAL_SYNC_RESULT_FORMAT;
  flowId: string;
  snapshots: DebugLayerSnapshotsPackage;
  central: DebugLayerSnapshotsCentralSyncStatus;
  pushedSnapshotCount: number;
  pulledSnapshotCount: number;
  governance: {
    excludesRawNodePayloads: true;
    excludesSecretValues: true;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
  };
}

interface DebugLayerSnapshotConflictReview {
  conflictId: string;
  status: "open";
  conflictKey: string;
  scope: DebugLayerScope;
  snapshotCount: number;
  packageHashes: string[];
  latestPackageHash: string;
  latestExportedAt: string;
  refs: DebugLayerSnapshotConflictRef[];
  snapshotContentHashes: string[];
  curationThread: DebugLayerSnapshotConflictCurationThread;
  governance: {
    excludesSnapshots: true;
    excludesEvidence: true;
    excludesRawNodePayloads: true;
    excludesSecretValues: true;
    includesOnlyRefsAndCuration: true;
  };
}

interface DebugLayerSnapshotConflictReviewPackage {
  format: typeof DEBUG_LAYER_SNAPSHOTS_CONFLICT_REVIEW_FORMAT;
  generatedAt: string;
  flowId: string;
  packageHash: string;
  conflictCount: number;
  openConflictCount: number;
  resolutionHistoryCount: number;
  conflicts: DebugLayerSnapshotConflictReview[];
  resolutionHistory: DebugLayerSnapshotResolutionRecord[];
  summary: {
    runComparisonConflictCount: number;
    scenarioBatchConflictCount: number;
    assignedConflictCount: number;
    unassignedConflictCount: number;
  };
  governance: {
    excludesSnapshots: true;
    excludesEvidence: true;
    excludesRawNodePayloads: true;
    excludesSecretValues: true;
    includesOnlyRefsThreadsAndResolutionHistory: true;
    localWorkspaceFile: true;
  };
}

type DebugLayerSnapshotConflictReviewDiffItemStatus = "same" | "changed" | "only_current" | "only_incoming";

interface DebugLayerSnapshotConflictReviewDiffItem {
  id: string;
  label: string;
  status: DebugLayerSnapshotConflictReviewDiffItemStatus;
  current: string;
  incoming: string;
  delta: number;
}

interface DebugLayerSnapshotConflictReviewDiffSection {
  id: string;
  title: string;
  status: "same" | "changed";
  statusLabel: string;
  summary: string;
  items: DebugLayerSnapshotConflictReviewDiffItem[];
}

interface DebugLayerSnapshotsCentralSyncConfig {
  url: string | null;
  token: string | null;
  timeoutMs: number;
  invalidReason: string | null;
}

const DEBUG_LAYER_SUMMARY_FORMAT = "agent-flow-builder.debug-layer-summary.v1";
const DEBUG_LAYER_SNAPSHOTS_FORMAT = "agent-flow-builder.debug-layer-snapshots.v1";
const DEBUG_LAYER_SNAPSHOTS_FILE = ".agent-flow/debug-layers/snapshots.afdebuglayers.json";
const DEBUG_LAYER_SNAPSHOTS_CENTRAL_SYNC_REQUEST_FORMAT =
  "agent-flow-builder.debug-layer-snapshots-central-sync-request.v1";
const DEBUG_LAYER_SNAPSHOTS_CENTRAL_SYNC_RESULT_FORMAT =
  "agent-flow-builder.debug-layer-snapshots-central-sync-result.v1";
const DEBUG_LAYER_SNAPSHOTS_CENTRAL_STATUS_FORMAT =
  "agent-flow-builder.debug-layer-snapshots-central-sync-status.v1";
const DEBUG_LAYER_SNAPSHOTS_CONFLICT_REVIEW_FORMAT =
  "agent-flow-builder.debug-layer-snapshots-conflict-review.v1";
const DEBUG_LAYER_SNAPSHOTS_CONFLICT_REVIEW_DIFF_FORMAT =
  "agent-flow-builder.debug-layer-snapshots-conflict-review-diff.v1";
const DEBUG_LAYER_SNAPSHOTS_CENTRAL_URL_ENV = "AGENT_FLOW_DEBUG_LAYER_SNAPSHOTS_CENTRAL_URL";
const DEBUG_LAYER_SNAPSHOTS_CENTRAL_TOKEN_ENV = "AGENT_FLOW_DEBUG_LAYER_SNAPSHOTS_CENTRAL_TOKEN";
const DEBUG_LAYER_SNAPSHOTS_CENTRAL_TIMEOUT_ENV = "AGENT_FLOW_DEBUG_LAYER_SNAPSHOTS_CENTRAL_TIMEOUT_MS";
const DEBUG_LAYER_SNAPSHOT_CONFLICT_CURATION_LEASE_HOURS_ENV =
  "AGENT_FLOW_DEBUG_LAYER_SNAPSHOT_CONFLICT_CURATION_LEASE_HOURS";
const DEBUG_LAYER_SNAPSHOT_CONFLICT_CURATION_LEASE_HOURS = 24;
const DEBUG_LAYER_SNAPSHOTS_CENTRAL_TIMEOUT_MS = 5_000;
const DEBUG_LAYER_SNAPSHOTS_CENTRAL_MAX_BYTES = 2_000_000;
const MAX_DEBUG_LAYER_SNAPSHOTS = 64;
const MAX_DEBUG_LAYER_ITEMS = 16;
const REDACTED_VALUE = "[redacted]";

export async function loadDebugLayerSnapshots(
  workspaceRoot: string,
  flowId: string,
): Promise<DebugLayerSnapshotsPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  try {
    const raw = await readFile(debugLayerSnapshotsPath(loaded.flowRoot), "utf-8");
    const payload = normalizeDebugLayerSnapshotsPackage(JSON.parse(raw) as unknown, loaded.flow.id, "merge");
    if (!payload) {
      throw new WorkspaceError("Pacote compartilhado de camadas de debug inválido.", 422);
    }
    return payload;
  } catch (error) {
    if (isFileNotFound(error)) {
      return buildDebugLayerSnapshotsPackage(loaded.flow.id, [], {
        action: "empty",
        incomingCount: 0,
        existingCount: 0,
        addedCount: 0,
        unchangedCount: 0,
        finalCount: 0,
      });
    }
    if (error instanceof WorkspaceError) {
      throw error;
    }
    throw new WorkspaceError("Falha ao ler camadas de debug compartilhadas.", 500, error);
  }
}

export async function saveDebugLayerSnapshots(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<DebugLayerSnapshotsPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const incoming = normalizeDebugLayerSnapshotsPackage(payload, loaded.flow.id, "save");
  if (!incoming) {
    throw new WorkspaceError("Payload de camadas de debug inválido.", 400);
  }
  const existing = await loadDebugLayerSnapshots(workspaceRoot, flowId);
  const stats = compareDebugLayerSnapshots(existing.snapshots, incoming.snapshots, "save");
  const history = mergeDebugLayerSnapshotResolutionHistory(existing.resolutionHistory, incoming.resolutionHistory);
  const next = buildDebugLayerSnapshotsPackage(
    loaded.flow.id,
    incoming.snapshots,
    {
      action: "save",
      ...stats,
      finalCount: incoming.snapshots.length,
    },
    [...existing.conflicts, ...incoming.conflicts],
    history,
  );
  await writeDebugLayerSnapshots(loaded.flowRoot, next);
  return next;
}

export async function mergeDebugLayerSnapshots(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<DebugLayerSnapshotsPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const incoming = normalizeDebugLayerSnapshotsPackage(payload, loaded.flow.id, "merge");
  if (!incoming) {
    throw new WorkspaceError("Payload de merge de camadas de debug inválido.", 400);
  }
  const existing = await loadDebugLayerSnapshots(workspaceRoot, flowId);
  const merged = mergeDebugLayerSnapshotItems(existing.snapshots, incoming.snapshots);
  const stats = compareDebugLayerSnapshots(existing.snapshots, incoming.snapshots, "merge");
  const history = mergeDebugLayerSnapshotResolutionHistory(existing.resolutionHistory, incoming.resolutionHistory);
  const next = buildDebugLayerSnapshotsPackage(
    loaded.flow.id,
    merged,
    {
      action: "merge",
      ...stats,
      finalCount: merged.length,
    },
    [...existing.conflicts, ...incoming.conflicts],
    history,
  );
  await writeDebugLayerSnapshots(loaded.flowRoot, next);
  return next;
}

export async function loadDebugLayerSnapshotConflictReview(
  workspaceRoot: string,
  flowId: string,
): Promise<DebugLayerSnapshotConflictReviewPackage> {
  const snapshots = await loadDebugLayerSnapshots(workspaceRoot, flowId);
  return buildDebugLayerSnapshotConflictReviewPackage(snapshots);
}

export async function compareDebugLayerSnapshotConflictReview(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  const current = await loadDebugLayerSnapshots(workspaceRoot, flowId).then(buildDebugLayerSnapshotConflictReviewPackage);
  const record = isRecord(payload) ? payload : {};
  const candidate = record.review !== undefined ? record.review : payload;
  const incoming = normalizeDebugLayerSnapshotConflictReviewPackage(candidate, current.flowId);
  if (!incoming) {
    throw new WorkspaceError("Revisão de conflitos de camadas inválida ou contendo snapshots/evidência bruta.", 400);
  }
  if (incoming.flowId !== current.flowId) {
    throw new WorkspaceError("Revisão de conflitos de camadas pertence a outro flow.", 400, {
      expectedFlowId: current.flowId,
      receivedFlowId: incoming.flowId,
    });
  }
  return buildDebugLayerSnapshotConflictReviewDiffPackage(current, incoming);
}

export async function resolveDebugLayerSnapshotConflict(
  workspaceRoot: string,
  flowId: string,
  conflictId: string,
  payload: unknown,
): Promise<DebugLayerSnapshotsPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const existing = await loadDebugLayerSnapshots(workspaceRoot, flowId);
  const conflict = existing.conflicts.find((item) => item.conflictId === conflictId);
  if (!conflict) {
    throw new WorkspaceError("Conflito de camadas de debug não encontrado.", 404);
  }
  const keepPackageHash = normalizeString(
    readString(isRecord(payload) ? payload.keepPackageHash : undefined),
    128,
  );
  const selectedPackageHash = conflict.packageHashes.includes(keepPackageHash)
    ? keepPackageHash
    : conflict.latestPackageHash;
  const resolvedBy = resolveDebugLayerSnapshotConflictActor(payload);
  const resolvedRole = resolveDebugLayerSnapshotConflictCuratorRole(payload);
  assertDebugLayerSnapshotConflictMutationAllowed(resolvedRole, "resolver conflitos de camadas de debug");
  const resolutionNote = resolveDebugLayerSnapshotConflictNote(payload);
  const resolutionRecord = buildDebugLayerSnapshotResolutionRecord(
    conflict,
    selectedPackageHash,
    resolvedBy,
    resolvedRole,
    resolutionNote,
  );
  const history = mergeDebugLayerSnapshotResolutionHistory(existing.resolutionHistory, [resolutionRecord]);
  const retainedSnapshots = existing.snapshots.filter(
    (snapshot) =>
      debugLayerSnapshotConflictKey(snapshot) !== conflict.conflictKey || snapshot.packageHash === selectedPackageHash,
  );
  const next = buildDebugLayerSnapshotsPackage(loaded.flow.id, retainedSnapshots, {
    action: "resolve_conflict",
    incomingCount: 0,
    existingCount: existing.snapshotCount,
    addedCount: 0,
    unchangedCount: retainedSnapshots.length,
    finalCount: retainedSnapshots.length,
  }, existing.conflicts, history);
  await writeDebugLayerSnapshots(loaded.flowRoot, next);
  return next;
}

export async function updateDebugLayerSnapshotConflictCuration(
  workspaceRoot: string,
  flowId: string,
  conflictId: string,
  payload: unknown,
): Promise<DebugLayerSnapshotsPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const existing = await loadDebugLayerSnapshots(workspaceRoot, flowId);
  const conflict = existing.conflicts.find((item) => item.conflictId === conflictId);
  if (!conflict) {
    throw new WorkspaceError("Conflito de camadas de debug não encontrado.", 404);
  }
  const action = normalizeDebugLayerSnapshotConflictCurationAction(isRecord(payload) ? payload.action : undefined);
  if (!action) {
    throw new WorkspaceError("Ação de curadoria do conflito de camadas é obrigatória.", 400);
  }
  const actor = resolveDebugLayerSnapshotConflictCurationActor(payload);
  const role = resolveDebugLayerSnapshotConflictCuratorRole(payload);
  assertDebugLayerSnapshotConflictMutationAllowed(role, "curar conflitos de camadas de debug");
  const note = resolveDebugLayerSnapshotConflictCurationNote(payload);
  const updatedAt = new Date().toISOString();
  const nextConflicts = existing.conflicts.map((entry) =>
    entry.conflictId === conflictId
      ? {
          ...entry,
          curationThread: updateDebugLayerSnapshotConflictCurationThread(
            entry.curationThread,
            action,
            actor,
            role,
            note,
            updatedAt,
          ),
        }
      : entry,
  );
  const next = buildDebugLayerSnapshotsPackage(loaded.flow.id, existing.snapshots, {
    action: "curate_conflict",
    incomingCount: existing.snapshotCount,
    existingCount: existing.snapshotCount,
    addedCount: 0,
    unchangedCount: existing.snapshotCount,
    finalCount: existing.snapshotCount,
  }, nextConflicts, existing.resolutionHistory);
  await writeDebugLayerSnapshots(loaded.flowRoot, next);
  return next;
}

export async function loadDebugLayerSnapshotsCentralSyncStatus(): Promise<DebugLayerSnapshotsCentralSyncStatus> {
  return buildDebugLayerSnapshotsCentralSyncStatus(debugLayerSnapshotsCentralSyncConfig());
}

export async function syncCentralDebugLayerSnapshots(
  workspaceRoot: string,
  flowId: string,
): Promise<DebugLayerSnapshotsCentralSyncResult> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const config = debugLayerSnapshotsCentralSyncConfig();
  if (config.invalidReason) {
    throw new WorkspaceError(`Configuração da central de camadas de debug inválida: ${config.invalidReason}`, 422);
  }
  if (!config.url) {
    throw new WorkspaceError("Central de camadas de debug não configurada.", 400);
  }
  const existing = await loadDebugLayerSnapshots(workspaceRoot, flowId);
  const fetched = await fetchCentralDebugLayerSnapshotsSync(config, flowId, existing);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fetched.body) as unknown;
  } catch (error) {
    throw new WorkspaceError("Resposta central de camadas de debug não é JSON válido.", 502, error);
  }
  const centralPayload = isRecord(parsed) && parsed.snapshots !== undefined ? parsed.snapshots : parsed;
  const incoming = normalizeDebugLayerSnapshotsPackage(centralPayload, loaded.flow.id, "merge");
  if (!incoming) {
    throw new WorkspaceError("Resposta central de camadas de debug não respeita o formato esperado.", 502);
  }
  const merged = mergeDebugLayerSnapshotItems(existing.snapshots, incoming.snapshots);
  const stats = compareDebugLayerSnapshots(existing.snapshots, incoming.snapshots, "merge");
  const history = mergeDebugLayerSnapshotResolutionHistory(existing.resolutionHistory, incoming.resolutionHistory);
  const next = buildDebugLayerSnapshotsPackage(
    loaded.flow.id,
    merged,
    {
      action: "merge",
      ...stats,
      finalCount: merged.length,
    },
    [...existing.conflicts, ...incoming.conflicts],
    history,
  );
  await writeDebugLayerSnapshots(loaded.flowRoot, next);
  const syncedAt = new Date().toISOString();
  return {
    format: DEBUG_LAYER_SNAPSHOTS_CENTRAL_SYNC_RESULT_FORMAT,
    flowId,
    snapshots: next,
    central: buildDebugLayerSnapshotsCentralSyncStatus(config, {
      lastSyncedAt: syncedAt,
      statusCode: fetched.statusCode,
      pushedSnapshotCount: existing.snapshotCount,
      pulledSnapshotCount: incoming.snapshotCount,
      error: null,
    }),
    pushedSnapshotCount: existing.snapshotCount,
    pulledSnapshotCount: incoming.snapshotCount,
    governance: {
      excludesRawNodePayloads: true,
      excludesSecretValues: true,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  };
}

function buildDebugLayerSnapshotsPackage(
  flowId: string,
  snapshots: DebugLayerSnapshot[],
  sync: { action: DebugLayerSnapshotsSharedSyncAction } & DebugLayerSnapshotsMergeStats,
  previousConflicts: unknown[] = [],
  resolutionHistory: unknown[] = [],
): DebugLayerSnapshotsPackage {
  const exportedAt = new Date().toISOString();
  const normalizedResolutionHistory = normalizeDebugLayerSnapshotResolutionHistory(resolutionHistory).slice(0, 128);
  const sortedSnapshots = applyDebugLayerSnapshotResolutionHistory(
    sortDebugLayerSnapshots(snapshots),
    normalizedResolutionHistory,
  ).slice(0, MAX_DEBUG_LAYER_SNAPSHOTS);
  const conflicts = buildDebugLayerSnapshotConflicts(flowId, sortedSnapshots, previousConflicts);
  const contentHash = hashJson({ flowId, snapshots: sortedSnapshots, resolutionHistory: normalizedResolutionHistory });
  return {
    format: DEBUG_LAYER_SNAPSHOTS_FORMAT,
    exportedAt,
    packageHash: hashJson({ format: DEBUG_LAYER_SNAPSHOTS_FORMAT, flowId, contentHash, exportedAt }),
    flowId,
    snapshotCount: sortedSnapshots.length,
    snapshots: sortedSnapshots,
    conflictCount: conflicts.length,
    openConflictCount: conflicts.length,
    conflicts,
    resolutionHistoryCount: normalizedResolutionHistory.length,
    resolutionHistory: normalizedResolutionHistory,
    governance: {
      excludesRawNodePayloads: true,
      excludesSecretValues: true,
      localWorkspaceFile: true,
      source: "studio-debug-layer-snapshots",
    },
    sharedSync: {
      action: sync.action,
      updatedAt: exportedAt,
      storage: DEBUG_LAYER_SNAPSHOTS_FILE,
      contentHash,
      incomingCount: sync.incomingCount,
      existingCount: sync.existingCount,
      addedCount: sync.addedCount,
      unchangedCount: sync.unchangedCount,
      finalCount: sync.finalCount,
      conflictCount: conflicts.length,
      openConflictCount: conflicts.length,
      governance: {
        excludesRawNodePayloads: true,
        excludesSecretValues: true,
      },
    },
  };
}

function normalizeDebugLayerSnapshotsPackage(
  value: unknown,
  fallbackFlowId: string,
  action: DebugLayerSnapshotsSharedSyncAction,
): DebugLayerSnapshotsPackage | null {
  const snapshots = normalizeDebugLayerSnapshots(value, fallbackFlowId);
  if (!snapshots) {
    return null;
  }
  return buildDebugLayerSnapshotsPackage(readPackageFlowId(value) || fallbackFlowId, snapshots, {
    action,
    incomingCount: snapshots.length,
    existingCount: 0,
    addedCount: snapshots.length,
    unchangedCount: 0,
    finalCount: snapshots.length,
  },
  isRecord(value) && Array.isArray(value.conflicts) ? value.conflicts : [],
  isRecord(value) && Array.isArray(value.resolutionHistory) ? value.resolutionHistory : []);
}

function buildDebugLayerSnapshotConflictReviewPackage(
  source: DebugLayerSnapshotsPackage,
): DebugLayerSnapshotConflictReviewPackage {
  return buildDebugLayerSnapshotConflictReviewPackageFromParts(
    source.flowId,
    source.conflicts.map(debugLayerSnapshotConflictReview),
    source.resolutionHistory,
  );
}

function buildDebugLayerSnapshotConflictReviewPackageFromParts(
  flowId: string,
  conflicts: DebugLayerSnapshotConflictReview[],
  resolutionHistory: DebugLayerSnapshotResolutionRecord[],
): DebugLayerSnapshotConflictReviewPackage {
  const generatedAt = new Date().toISOString();
  const sortedConflicts = [...conflicts].sort((left, right) => right.latestExportedAt.localeCompare(left.latestExportedAt));
  const sortedHistory = normalizeDebugLayerSnapshotResolutionHistory(resolutionHistory);
  const summary = {
    runComparisonConflictCount: sortedConflicts.filter((conflict) => conflict.scope === "run_comparison").length,
    scenarioBatchConflictCount: sortedConflicts.filter((conflict) => conflict.scope === "scenario_batch").length,
    assignedConflictCount: sortedConflicts.filter((conflict) => conflict.curationThread.status === "assigned").length,
    unassignedConflictCount: sortedConflicts.filter((conflict) => conflict.curationThread.status === "unassigned").length,
  };
  const packageHash = hashJson({
    format: DEBUG_LAYER_SNAPSHOTS_CONFLICT_REVIEW_FORMAT,
    flowId,
    conflicts: sortedConflicts,
    resolutionHistory: sortedHistory,
    summary,
  });
  return {
    format: DEBUG_LAYER_SNAPSHOTS_CONFLICT_REVIEW_FORMAT,
    generatedAt,
    flowId,
    packageHash,
    conflictCount: sortedConflicts.length,
    openConflictCount: sortedConflicts.length,
    resolutionHistoryCount: sortedHistory.length,
    conflicts: sortedConflicts,
    resolutionHistory: sortedHistory,
    summary,
    governance: {
      excludesSnapshots: true,
      excludesEvidence: true,
      excludesRawNodePayloads: true,
      excludesSecretValues: true,
      includesOnlyRefsThreadsAndResolutionHistory: true,
      localWorkspaceFile: true,
    },
  };
}

function debugLayerSnapshotConflictReview(
  conflict: DebugLayerSnapshotConflict,
): DebugLayerSnapshotConflictReview {
  return {
    conflictId: conflict.conflictId,
    status: "open",
    conflictKey: conflict.conflictKey,
    scope: conflict.scope,
    snapshotCount: conflict.snapshotCount,
    packageHashes: uniqueSortedText(conflict.packageHashes),
    latestPackageHash: conflict.latestPackageHash,
    latestExportedAt: conflict.latestExportedAt,
    refs: conflict.refs,
    snapshotContentHashes: uniqueSortedText(conflict.refs.map((ref) => ref.packageHash)),
    curationThread: normalizeDebugLayerSnapshotConflictCurationThread(conflict.curationThread),
    governance: {
      excludesSnapshots: true,
      excludesEvidence: true,
      excludesRawNodePayloads: true,
      excludesSecretValues: true,
      includesOnlyRefsAndCuration: true,
    },
  };
}

function normalizeDebugLayerSnapshotConflictReviewPackage(
  value: unknown,
  fallbackFlowId: string,
): DebugLayerSnapshotConflictReviewPackage | null {
  if (!isRecord(value) || value.format !== DEBUG_LAYER_SNAPSHOTS_CONFLICT_REVIEW_FORMAT) {
    return null;
  }
  if (containsRawDebugLayerSnapshotReviewPayload(value)) {
    return null;
  }
  const conflicts = Array.isArray(value.conflicts)
    ? value.conflicts
        .map(normalizeDebugLayerSnapshotConflictReview)
        .filter((conflict): conflict is DebugLayerSnapshotConflictReview => conflict !== null)
    : [];
  const resolutionHistory = Array.isArray(value.resolutionHistory)
    ? normalizeDebugLayerSnapshotResolutionHistory(value.resolutionHistory)
    : [];
  return buildDebugLayerSnapshotConflictReviewPackageFromParts(
    normalizeString(readString(value.flowId), 160) || fallbackFlowId,
    conflicts,
    resolutionHistory,
  );
}

function normalizeDebugLayerSnapshotConflictReview(value: unknown): DebugLayerSnapshotConflictReview | null {
  if (!isRecord(value) || "snapshots" in value || "evidence" in value) {
    return null;
  }
  const conflictId = normalizeString(readString(value.conflictId), 160);
  const conflictKey = normalizeString(readString(value.conflictKey), 500);
  const refs = Array.isArray(value.refs)
    ? value.refs
        .map(normalizeDebugLayerSnapshotConflictRef)
        .filter((ref): ref is DebugLayerSnapshotConflictRef => ref !== null)
        .slice(0, 16)
    : [];
  if (!conflictId || !conflictKey || !refs.length) {
    return null;
  }
  const packageHashes = Array.isArray(value.packageHashes)
    ? uniqueSortedText(value.packageHashes.map(readString).filter(Boolean))
    : uniqueSortedText(refs.map((ref) => ref.packageHash));
  const scope = value.scope === "scenario_batch" ? "scenario_batch" : "run_comparison";
  return {
    conflictId,
    status: "open",
    conflictKey,
    scope,
    snapshotCount: normalizeNonNegativeInteger(value.snapshotCount || refs.length),
    packageHashes,
    latestPackageHash: normalizeString(readString(value.latestPackageHash), 128) || refs[0]?.packageHash || "",
    latestExportedAt: normalizeDateString(value.latestExportedAt) ?? refs[0]?.exportedAt ?? new Date().toISOString(),
    refs,
    snapshotContentHashes: Array.isArray(value.snapshotContentHashes)
      ? uniqueSortedText(value.snapshotContentHashes.map(readString).filter(Boolean))
      : uniqueSortedText(refs.map((ref) => ref.packageHash)),
    curationThread: normalizeDebugLayerSnapshotConflictCurationThread(value.curationThread),
    governance: {
      excludesSnapshots: true,
      excludesEvidence: true,
      excludesRawNodePayloads: true,
      excludesSecretValues: true,
      includesOnlyRefsAndCuration: true,
    },
  };
}

function containsRawDebugLayerSnapshotReviewPayload(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(containsRawDebugLayerSnapshotReviewPayload);
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (
      key === "snapshots" ||
      key === "snapshot" ||
      key === "evidence" ||
      key === "rawNodePayload" ||
      key === "nodePayload" ||
      key === "payload" ||
      key === "input" ||
      key === "output"
    ) {
      return true;
    }
    if (containsRawDebugLayerSnapshotReviewPayload(child)) {
      return true;
    }
  }
  return false;
}

function buildDebugLayerSnapshotConflictReviewDiffPackage(
  current: DebugLayerSnapshotConflictReviewPackage,
  incoming: DebugLayerSnapshotConflictReviewPackage,
): Record<string, unknown> {
  const sections = [
    buildDebugLayerSnapshotConflictReviewSummaryDiffSection(current, incoming),
    buildDebugLayerSnapshotConflictReviewConflictDiffSection(current, incoming),
    buildDebugLayerSnapshotConflictReviewResolutionDiffSection(current, incoming),
  ];
  const changedConflictItems = sections[1].items.filter((item) => item.status === "changed").length;
  const onlyCurrentConflictItems = sections[1].items.filter((item) => item.status === "only_current").length;
  const onlyIncomingConflictItems = sections[1].items.filter((item) => item.status === "only_incoming").length;
  const changedResolutionItems = sections[2].items.filter((item) => item.status !== "same").length;
  const changedSectionCount = sections.filter((section) => section.status === "changed").length;
  const summaryStatus = changedSectionCount ? "changed" : "same";
  const base = {
    format: DEBUG_LAYER_SNAPSHOTS_CONFLICT_REVIEW_DIFF_FORMAT,
    generatedAt: new Date().toISOString(),
    flowId: current.flowId,
    current: debugLayerSnapshotConflictReviewPackageRef(current),
    incoming: debugLayerSnapshotConflictReviewPackageRef(incoming),
    summary: {
      status: summaryStatus,
      statusLabel: summaryStatus === "changed" ? "alterado" : "igual",
      headline: summaryStatus === "changed"
        ? `${changedSectionCount} seção(ões) divergente(s), ${onlyCurrentConflictItems} conflito(s) só no atual e ${onlyIncomingConflictItems} só no importado`
        : "Revisões de conflitos de camadas equivalentes",
      conflictDelta: incoming.conflictCount - current.conflictCount,
      resolutionDelta: incoming.resolutionHistoryCount - current.resolutionHistoryCount,
      changedConflictCount: changedConflictItems,
      onlyCurrentConflictCount: onlyCurrentConflictItems,
      onlyIncomingConflictCount: onlyIncomingConflictItems,
      changedResolutionCount: changedResolutionItems,
      changedSectionCount,
    },
    sections,
    governance: {
      excludesSnapshots: true,
      excludesEvidence: true,
      excludesRawNodePayloads: true,
      excludesSecretValues: true,
      includesOnlyRefsThreadsAndResolutionHistory: true,
    },
  };
  return {
    ...base,
    packageHash: hashJson(base),
  };
}

function debugLayerSnapshotConflictReviewPackageRef(packageValue: DebugLayerSnapshotConflictReviewPackage): {
  packageHash: string;
  conflictCount: number;
  resolutionHistoryCount: number;
} {
  return {
    packageHash: packageValue.packageHash,
    conflictCount: packageValue.conflictCount,
    resolutionHistoryCount: packageValue.resolutionHistoryCount,
  };
}

function buildDebugLayerSnapshotConflictReviewSummaryDiffSection(
  current: DebugLayerSnapshotConflictReviewPackage,
  incoming: DebugLayerSnapshotConflictReviewPackage,
): DebugLayerSnapshotConflictReviewDiffSection {
  return buildDebugLayerSnapshotConflictReviewDiffSection("summary", "Resumo", [
    buildDebugLayerSnapshotConflictReviewCountItem("conflicts", "Conflitos", current.conflictCount, incoming.conflictCount),
    buildDebugLayerSnapshotConflictReviewCountItem(
      "run-comparison",
      "Comparações de runs",
      current.summary.runComparisonConflictCount,
      incoming.summary.runComparisonConflictCount,
    ),
    buildDebugLayerSnapshotConflictReviewCountItem(
      "scenario-batch",
      "Lotes de cenário",
      current.summary.scenarioBatchConflictCount,
      incoming.summary.scenarioBatchConflictCount,
    ),
    buildDebugLayerSnapshotConflictReviewCountItem(
      "assigned",
      "Curadorias atribuídas",
      current.summary.assignedConflictCount,
      incoming.summary.assignedConflictCount,
    ),
    buildDebugLayerSnapshotConflictReviewCountItem(
      "unassigned",
      "Curadorias livres",
      current.summary.unassignedConflictCount,
      incoming.summary.unassignedConflictCount,
    ),
    buildDebugLayerSnapshotConflictReviewCountItem(
      "resolutions",
      "Histórico de resoluções",
      current.resolutionHistoryCount,
      incoming.resolutionHistoryCount,
    ),
  ]);
}

function buildDebugLayerSnapshotConflictReviewConflictDiffSection(
  current: DebugLayerSnapshotConflictReviewPackage,
  incoming: DebugLayerSnapshotConflictReviewPackage,
): DebugLayerSnapshotConflictReviewDiffSection {
  const currentById = new Map(current.conflicts.map((conflict) => [conflict.conflictId, conflict]));
  const incomingById = new Map(incoming.conflicts.map((conflict) => [conflict.conflictId, conflict]));
  const ids = uniqueSortedText([...currentById.keys(), ...incomingById.keys()]);
  const items = ids.map((id): DebugLayerSnapshotConflictReviewDiffItem => {
    const currentConflict = currentById.get(id);
    const incomingConflict = incomingById.get(id);
    const status = debugLayerSnapshotConflictReviewItemStatus(currentConflict, incomingConflict);
    return {
      id,
      label: currentConflict?.conflictKey || incomingConflict?.conflictKey || id,
      status,
      current: currentConflict ? debugLayerSnapshotConflictReviewItemSummary(currentConflict) : "ausente",
      incoming: incomingConflict ? debugLayerSnapshotConflictReviewItemSummary(incomingConflict) : "ausente",
      delta: (incomingConflict?.snapshotCount ?? 0) - (currentConflict?.snapshotCount ?? 0),
    };
  });
  return buildDebugLayerSnapshotConflictReviewDiffSection("conflicts", "Conflitos", items);
}

function buildDebugLayerSnapshotConflictReviewResolutionDiffSection(
  current: DebugLayerSnapshotConflictReviewPackage,
  incoming: DebugLayerSnapshotConflictReviewPackage,
): DebugLayerSnapshotConflictReviewDiffSection {
  const currentById = new Map(current.resolutionHistory.map((record) => [record.resolutionId, record]));
  const incomingById = new Map(incoming.resolutionHistory.map((record) => [record.resolutionId, record]));
  const ids = uniqueSortedText([...currentById.keys(), ...incomingById.keys()]);
  const items = ids.map((id): DebugLayerSnapshotConflictReviewDiffItem => {
    const currentRecord = currentById.get(id);
    const incomingRecord = incomingById.get(id);
    const status = debugLayerSnapshotResolutionReviewItemStatus(currentRecord, incomingRecord);
    return {
      id,
      label: currentRecord?.conflictKey || incomingRecord?.conflictKey || id,
      status,
      current: currentRecord ? debugLayerSnapshotResolutionReviewItemSummary(currentRecord) : "ausente",
      incoming: incomingRecord ? debugLayerSnapshotResolutionReviewItemSummary(incomingRecord) : "ausente",
      delta: (incomingRecord?.candidateCount ?? 0) - (currentRecord?.candidateCount ?? 0),
    };
  });
  return buildDebugLayerSnapshotConflictReviewDiffSection("resolution-history", "Histórico de resolução", items);
}

function buildDebugLayerSnapshotConflictReviewDiffSection(
  id: string,
  title: string,
  items: DebugLayerSnapshotConflictReviewDiffItem[],
): DebugLayerSnapshotConflictReviewDiffSection {
  const changedCount = items.filter((item) => item.status !== "same").length;
  return {
    id,
    title,
    status: changedCount ? "changed" : "same",
    statusLabel: changedCount ? "alterado" : "igual",
    summary: changedCount ? `${changedCount} item(ns) divergente(s)` : "Sem divergências",
    items,
  };
}

function buildDebugLayerSnapshotConflictReviewCountItem(
  id: string,
  label: string,
  current: number,
  incoming: number,
): DebugLayerSnapshotConflictReviewDiffItem {
  const delta = incoming - current;
  return {
    id,
    label,
    status: delta === 0 ? "same" : "changed",
    current: String(current),
    incoming: String(incoming),
    delta,
  };
}

function debugLayerSnapshotConflictReviewItemStatus(
  current: DebugLayerSnapshotConflictReview | undefined,
  incoming: DebugLayerSnapshotConflictReview | undefined,
): DebugLayerSnapshotConflictReviewDiffItemStatus {
  if (!current) {
    return "only_incoming";
  }
  if (!incoming) {
    return "only_current";
  }
  return debugLayerSnapshotConflictReviewSignature(current) === debugLayerSnapshotConflictReviewSignature(incoming)
    ? "same"
    : "changed";
}

function debugLayerSnapshotResolutionReviewItemStatus(
  current: DebugLayerSnapshotResolutionRecord | undefined,
  incoming: DebugLayerSnapshotResolutionRecord | undefined,
): DebugLayerSnapshotConflictReviewDiffItemStatus {
  if (!current) {
    return "only_incoming";
  }
  if (!incoming) {
    return "only_current";
  }
  return hashJson(current) === hashJson(incoming) ? "same" : "changed";
}

function debugLayerSnapshotConflictReviewSignature(conflict: DebugLayerSnapshotConflictReview): string {
  return hashJson({
    conflictKey: conflict.conflictKey,
    scope: conflict.scope,
    snapshotCount: conflict.snapshotCount,
    packageHashes: conflict.packageHashes,
    latestPackageHash: conflict.latestPackageHash,
    refs: conflict.refs,
    curationThread: conflict.curationThread,
    snapshotContentHashes: conflict.snapshotContentHashes,
  });
}

function debugLayerSnapshotConflictReviewItemSummary(conflict: DebugLayerSnapshotConflictReview): string {
  return `${conflict.scope} · ${conflict.snapshotCount} snapshot(s) · ${conflict.latestPackageHash.slice(0, 10)} · ${conflict.curationThread.status}`;
}

function debugLayerSnapshotResolutionReviewItemSummary(record: DebugLayerSnapshotResolutionRecord): string {
  return `${record.scope} · manter ${record.keptPackageHash.slice(0, 10)} · ${record.candidateCount} candidato(s) · ${record.resolvedBy}`;
}

function normalizeDebugLayerSnapshots(value: unknown, fallbackFlowId: string): DebugLayerSnapshot[] | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.format === DEBUG_LAYER_SUMMARY_FORMAT) {
    const snapshot = normalizeDebugLayerSnapshot(value, fallbackFlowId);
    return snapshot ? [snapshot] : null;
  }
  if (value.format !== DEBUG_LAYER_SNAPSHOTS_FORMAT) {
    return null;
  }
  const rawSnapshots = Array.isArray(value.snapshots) ? value.snapshots : [];
  return rawSnapshots
    .map((snapshot) => normalizeDebugLayerSnapshot(snapshot, fallbackFlowId))
    .filter((snapshot): snapshot is DebugLayerSnapshot => Boolean(snapshot));
}

function normalizeDebugLayerSnapshot(value: unknown, fallbackFlowId: string): DebugLayerSnapshot | null {
  if (!isRecord(value) || value.format !== DEBUG_LAYER_SUMMARY_FORMAT) {
    return null;
  }
  const flow = isRecord(value.flow) ? value.flow : {};
  const summary = normalizeDebugLayerSummary(value.summary);
  if (!summary) {
    return null;
  }
  const exportedAt = normalizeDateString(value.exportedAt) ?? new Date().toISOString();
  const scope = value.scope === "scenario_batch" ? "scenario_batch" : "run_comparison";
  const snapshotBase: Omit<DebugLayerSnapshot, "packageHash"> = {
    format: DEBUG_LAYER_SUMMARY_FORMAT,
    exportedAt,
    scope,
    flow: {
      id: normalizeString(readString(flow.id) || fallbackFlowId, 160),
      name: normalizeString(readString(flow.name), 160),
      version: normalizeString(readString(flow.version), 80),
      nodeCount: normalizeNonNegativeInteger(flow.nodeCount),
      edgeCount: normalizeNonNegativeInteger(flow.edgeCount),
    },
    summary,
    evidence: sanitizeEvidence(isRecord(value.evidence) ? value.evidence : {}),
    governance: {
      excludesRawNodePayloads: true,
      excludesSecretValues: true,
      source: normalizeString(readString(isRecord(value.governance) ? value.governance.source : ""), 120) || "studio-debug-layer",
    },
  };
  const packageHash = normalizeString(readString(value.packageHash), 128) || hashJson(snapshotBase);
  return {
    ...snapshotBase,
    packageHash,
  };
}

function normalizeDebugLayerSummary(value: unknown): DebugLayerSummary | null {
  if (!isRecord(value)) {
    return null;
  }
  const items = Array.isArray(value.items)
    ? value.items
        .slice(0, MAX_DEBUG_LAYER_ITEMS)
        .map(normalizeDebugLayerItem)
        .filter((item): item is DebugLayerItem => Boolean(item))
    : [];
  if (!items.length) {
    return null;
  }
  return {
    status: normalizeDebugLayerStatus(value.status),
    statusLabel: normalizeString(readString(value.statusLabel), 80),
    headline: normalizeString(readString(value.headline), 300),
    items,
  };
}

function normalizeDebugLayerItem(value: unknown): DebugLayerItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = normalizeString(readString(value.id), 120);
  if (!id) {
    return null;
  }
  return {
    id,
    title: normalizeString(readString(value.title), 120),
    status: normalizeDebugLayerStatus(value.status),
    statusLabel: normalizeString(readString(value.statusLabel), 80),
    summary: normalizeString(readString(value.summary), 300),
    detail: normalizeString(readString(value.detail), 500),
    action: normalizeString(readString(value.action), 500),
  };
}

function normalizeDebugLayerStatus(value: unknown): DebugLayerStatus {
  return value === "same" || value === "changed" || value === "warning" || value === "missing" ? value : "missing";
}

function mergeDebugLayerSnapshotItems(existing: DebugLayerSnapshot[], incoming: DebugLayerSnapshot[]): DebugLayerSnapshot[] {
  const byHash = new Map<string, DebugLayerSnapshot>();
  for (const snapshot of existing) {
    byHash.set(snapshot.packageHash, snapshot);
  }
  for (const snapshot of incoming) {
    byHash.set(snapshot.packageHash, snapshot);
  }
  return sortDebugLayerSnapshots(Array.from(byHash.values()));
}

function applyDebugLayerSnapshotResolutionHistory(
  snapshots: DebugLayerSnapshot[],
  history: DebugLayerSnapshotResolutionRecord[],
): DebugLayerSnapshot[] {
  if (!history.length || snapshots.length < 2) {
    return sortDebugLayerSnapshots(snapshots);
  }
  const sortedHistory = [...history].sort((left, right) => right.resolvedAt.localeCompare(left.resolvedAt));
  let currentSnapshots = sortDebugLayerSnapshots(snapshots);
  for (const record of sortedHistory) {
    const keptSnapshot = currentSnapshots.find((snapshot) => debugLayerSnapshotMatchesConflictRef(snapshot, record.keptRef));
    if (!keptSnapshot) {
      continue;
    }
    const filtered = currentSnapshots.filter((snapshot) => {
      if (debugLayerSnapshotMatchesConflictRef(snapshot, record.keptRef)) {
        return true;
      }
      return !record.discardedRefs.some((ref) => debugLayerSnapshotMatchesConflictRef(snapshot, ref));
    });
    currentSnapshots = filtered;
  }
  return sortDebugLayerSnapshots(currentSnapshots);
}

function debugLayerSnapshotMatchesConflictRef(
  snapshot: DebugLayerSnapshot,
  ref: DebugLayerSnapshotConflictRef,
): boolean {
  return snapshot.packageHash === ref.packageHash && snapshot.exportedAt === ref.exportedAt && snapshot.scope === ref.scope;
}

function buildDebugLayerSnapshotResolutionRecord(
  conflict: DebugLayerSnapshotConflict,
  keptPackageHash: string,
  resolvedBy: string,
  resolvedRole: DebugLayerSnapshotConflictCuratorRole,
  resolutionNote: string,
): DebugLayerSnapshotResolutionRecord {
  const resolvedAt = new Date().toISOString();
  const keptRef = conflict.refs.find((ref) => ref.packageHash === keptPackageHash) ?? conflict.refs[0];
  const discardedRefs = conflict.refs.filter((ref) => ref.packageHash !== keptRef.packageHash);
  return {
    resolutionId: `debug-layer-resolution-${hashJson({
      conflictId: conflict.conflictId,
      keptPackageHash: keptRef.packageHash,
      discardedRefs,
      resolvedBy,
      resolvedRole,
      resolvedAt,
    }).slice(0, 16)}`,
    conflictId: conflict.conflictId,
    conflictKey: conflict.conflictKey,
    scope: conflict.scope,
    resolvedAt,
    resolvedBy,
    resolvedRole,
    resolutionNote,
    keptPackageHash: keptRef.packageHash,
    keptRef,
    discardedRefs,
    candidateCount: conflict.snapshotCount,
    governance: {
      excludesRawNodePayloads: true,
      excludesSecretValues: true,
    },
  };
}

function mergeDebugLayerSnapshotResolutionHistory(
  existing: unknown[],
  incoming: unknown[],
): DebugLayerSnapshotResolutionRecord[] {
  const byId = new Map<string, DebugLayerSnapshotResolutionRecord>();
  for (const record of [
    ...normalizeDebugLayerSnapshotResolutionHistory(existing),
    ...normalizeDebugLayerSnapshotResolutionHistory(incoming),
  ]) {
    const current = byId.get(record.resolutionId);
    if (!current || record.resolvedAt.localeCompare(current.resolvedAt) >= 0) {
      byId.set(record.resolutionId, record);
    }
  }
  return Array.from(byId.values()).sort((left, right) => right.resolvedAt.localeCompare(left.resolvedAt));
}

function normalizeDebugLayerSnapshotResolutionHistory(value: unknown[]): DebugLayerSnapshotResolutionRecord[] {
  return value
    .map(normalizeDebugLayerSnapshotResolutionRecord)
    .filter((record): record is DebugLayerSnapshotResolutionRecord => record !== null)
    .sort((left, right) => right.resolvedAt.localeCompare(left.resolvedAt));
}

function normalizeDebugLayerSnapshotResolutionRecord(value: unknown): DebugLayerSnapshotResolutionRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const conflictId = normalizeString(readString(value.conflictId), 160);
  const conflictKey = normalizeString(readString(value.conflictKey), 500);
  const scope = value.scope === "scenario_batch" ? "scenario_batch" : "run_comparison";
  const resolvedAt = normalizeDateString(value.resolvedAt);
  const keptPackageHash = normalizeString(readString(value.keptPackageHash), 128);
  const keptRef = normalizeDebugLayerSnapshotConflictRef(value.keptRef);
  if (!conflictId || !resolvedAt || !keptPackageHash || !keptRef) {
    return null;
  }
  const discardedRefs = Array.isArray(value.discardedRefs)
    ? value.discardedRefs
        .map(normalizeDebugLayerSnapshotConflictRef)
        .filter((ref): ref is DebugLayerSnapshotConflictRef => ref !== null)
    : [];
  const resolutionId =
    normalizeString(readString(value.resolutionId), 160) ||
    `debug-layer-resolution-${hashJson({ conflictId, keptPackageHash, discardedRefs, resolvedAt }).slice(0, 16)}`;
  return {
    resolutionId,
    conflictId,
    conflictKey,
    scope,
    resolvedAt,
    resolvedBy: normalizeString(readString(value.resolvedBy), 120) || "local-studio",
    resolvedRole: normalizeDebugLayerSnapshotConflictCuratorRole(value.resolvedRole ?? value.role),
    resolutionNote: normalizeString(readString(value.resolutionNote), 280),
    keptPackageHash,
    keptRef,
    discardedRefs,
    candidateCount: normalizeNonNegativeInteger(value.candidateCount || discardedRefs.length + 1),
    governance: {
      excludesRawNodePayloads: true,
      excludesSecretValues: true,
    },
  };
}

function normalizeDebugLayerSnapshotConflictRef(value: unknown): DebugLayerSnapshotConflictRef | null {
  if (!isRecord(value)) {
    return null;
  }
  const packageHash = normalizeString(readString(value.packageHash), 128);
  if (!packageHash) {
    return null;
  }
  return {
    packageHash,
    exportedAt: normalizeDateString(value.exportedAt) ?? new Date().toISOString(),
    scope: value.scope === "scenario_batch" ? "scenario_batch" : "run_comparison",
    headline: normalizeString(readString(value.headline), 300),
    statusLabel: normalizeString(readString(value.statusLabel), 80),
    leftRunId: normalizeString(readString(value.leftRunId), 160),
    rightRunId: normalizeString(readString(value.rightRunId), 160),
    selectedNodeId: normalizeString(readString(value.selectedNodeId), 160),
    batchReportHash: normalizeString(readString(value.batchReportHash), 160),
  };
}

function compareDebugLayerSnapshots(
  existing: DebugLayerSnapshot[],
  incoming: DebugLayerSnapshot[],
  mode: "save" | "merge",
): DebugLayerSnapshotsMergeStats {
  const existingHashes = new Set(existing.map((snapshot) => snapshot.packageHash));
  const addedCount = incoming.filter((snapshot) => !existingHashes.has(snapshot.packageHash)).length;
  const unchangedCount = incoming.length - addedCount;
  return {
    incomingCount: incoming.length,
    existingCount: existing.length,
    addedCount,
    unchangedCount,
    finalCount: mode === "save" ? incoming.length : mergeDebugLayerSnapshotItems(existing, incoming).length,
  };
}

function buildDebugLayerSnapshotConflicts(
  flowId: string,
  snapshots: DebugLayerSnapshot[],
  previousConflicts: unknown[] = [],
): DebugLayerSnapshotConflict[] {
  const previousCurationById = mergeDebugLayerSnapshotConflictCurationById(previousConflicts);
  const byConflictKey = new Map<string, DebugLayerSnapshot[]>();
  for (const snapshot of snapshots) {
    const conflictKey = debugLayerSnapshotConflictKey(snapshot);
    const current = byConflictKey.get(conflictKey) ?? [];
    current.push(snapshot);
    byConflictKey.set(conflictKey, current);
  }
  const conflicts: DebugLayerSnapshotConflict[] = [];
  for (const [conflictKey, conflictSnapshots] of byConflictKey) {
    const packageHashes = Array.from(new Set(conflictSnapshots.map((snapshot) => snapshot.packageHash))).sort();
    if (packageHashes.length < 2) {
      continue;
    }
    const sorted = sortDebugLayerSnapshots(conflictSnapshots);
    const latest = sorted[0];
    const conflictId = `debug-layer-conflict-${hashJson({ flowId, conflictKey }).slice(0, 16)}`;
    conflicts.push({
      conflictId,
      status: "open",
      conflictKey,
      scope: latest.scope,
      snapshotCount: sorted.length,
      packageHashes,
      latestPackageHash: latest.packageHash,
      latestExportedAt: latest.exportedAt,
      refs: sorted.map(debugLayerSnapshotConflictRef),
      curationThread: previousCurationById.get(conflictId) ?? defaultDebugLayerSnapshotConflictCurationThread(),
      governance: {
        excludesRawNodePayloads: true,
        excludesSecretValues: true,
      },
    });
  }
  return conflicts.sort((left, right) => right.latestExportedAt.localeCompare(left.latestExportedAt));
}

function mergeDebugLayerSnapshotConflictCurationById(
  conflicts: unknown[],
): Map<string, DebugLayerSnapshotConflictCurationThread> {
  const byId = new Map<string, DebugLayerSnapshotConflictCurationThread>();
  for (const conflict of conflicts) {
    if (!isRecord(conflict)) {
      continue;
    }
    const conflictId = readString(conflict.conflictId);
    if (!conflictId) {
      continue;
    }
    const current = byId.get(conflictId) ?? defaultDebugLayerSnapshotConflictCurationThread();
    const incoming = normalizeDebugLayerSnapshotConflictCurationThread(conflict.curationThread);
    byId.set(conflictId, mergeDebugLayerSnapshotConflictCurationThreads(current, incoming));
  }
  return byId;
}

function mergeDebugLayerSnapshotConflictCurationThreads(
  left: DebugLayerSnapshotConflictCurationThread,
  right: DebugLayerSnapshotConflictCurationThread,
): DebugLayerSnapshotConflictCurationThread {
  const leftTime = left.updatedAt ? Date.parse(left.updatedAt) : 0;
  const rightTime = right.updatedAt ? Date.parse(right.updatedAt) : 0;
  const winner = rightTime >= leftTime ? right : left;
  return normalizeDebugLayerSnapshotConflictCurationThread({
    ...winner,
    events: mergeDebugLayerSnapshotConflictCurationEvents(left.events, right.events),
  });
}

function normalizeDebugLayerSnapshotConflictCurationAction(
  value: unknown,
): DebugLayerSnapshotConflictCurationAction | null {
  return value === "assign" || value === "release" ? value : null;
}

function normalizeDebugLayerSnapshotConflictCurationLastAction(
  value: unknown,
): DebugLayerSnapshotConflictCurationLastAction | null {
  return value === "lease_expired" ? value : normalizeDebugLayerSnapshotConflictCurationAction(value);
}

function normalizeDebugLayerSnapshotConflictCuratorRole(value: unknown): DebugLayerSnapshotConflictCuratorRole {
  if (value === "owner" || value === "viewer") {
    return value;
  }
  return "reviewer";
}

function resolveDebugLayerSnapshotConflictCuratorRole(payload: unknown): DebugLayerSnapshotConflictCuratorRole {
  if (!isRecord(payload)) {
    return normalizeDebugLayerSnapshotConflictCuratorRole(payload);
  }
  return normalizeDebugLayerSnapshotConflictCuratorRole(payload.role ?? payload.resolvedRole);
}

function assertDebugLayerSnapshotConflictMutationAllowed(
  role: DebugLayerSnapshotConflictCuratorRole,
  action: string,
): void {
  if (role !== "viewer") {
    return;
  }
  throw new WorkspaceError(`Viewer não pode ${action}.`, 403, {
    code: "debug_layer_snapshot_conflict_viewer_forbidden",
    role,
    requiredRole: "reviewer",
  });
}

function defaultDebugLayerSnapshotConflictCurationThread(): DebugLayerSnapshotConflictCurationThread {
  return {
    status: "unassigned",
    assignee: "",
    openedAt: null,
    updatedAt: null,
    lastActor: "",
    lastAction: null,
    note: "",
    leaseExpiresAt: null,
    leaseDurationHours: null,
    leaseExpired: false,
    events: [],
    governance: {
      excludesRawNodePayloads: true,
      excludesSecretValues: true,
      autoReleasesExpiredAssignments: true,
      configuredLeaseHoursEnv: DEBUG_LAYER_SNAPSHOT_CONFLICT_CURATION_LEASE_HOURS_ENV,
    },
  };
}

function normalizeDebugLayerSnapshotConflictCurationThread(
  value: unknown,
): DebugLayerSnapshotConflictCurationThread {
  const source = isRecord(value) ? value : {};
  const assignee = normalizeString(readString(source.assignee), 120);
  const status: DebugLayerSnapshotConflictCurationStatus =
    source.status === "assigned" || assignee ? "assigned" : "unassigned";
  const updatedAt = normalizeDateString(source.updatedAt);
  const leaseDurationHours = normalizeDebugLayerSnapshotConflictCurationLeaseHours(source.leaseDurationHours);
  const leaseExpiresAt =
    status === "assigned"
      ? normalizeDateString(source.leaseExpiresAt) ?? (updatedAt ? addHoursIso(updatedAt, leaseDurationHours) : null)
      : null;
  return expireDebugLayerSnapshotConflictCurationThreadIfNeeded({
    status,
    assignee: status === "assigned" ? assignee : "",
    openedAt: normalizeDateString(source.openedAt),
    updatedAt,
    lastActor: normalizeString(readString(source.lastActor), 120),
    lastAction: normalizeDebugLayerSnapshotConflictCurationLastAction(source.lastAction),
    note: normalizeString(readString(source.note), 280),
    leaseExpiresAt,
    leaseDurationHours: status === "assigned" ? leaseDurationHours : null,
    leaseExpired: status !== "assigned" && source.leaseExpired === true,
    events: Array.isArray(source.events)
      ? source.events
          .map(normalizeDebugLayerSnapshotConflictCurationEvent)
          .filter((event): event is DebugLayerSnapshotConflictCurationEvent => event !== null)
          .sort((left, right) => right.at.localeCompare(left.at))
          .slice(0, 12)
      : [],
    governance: {
      excludesRawNodePayloads: true,
      excludesSecretValues: true,
      autoReleasesExpiredAssignments: true,
      configuredLeaseHoursEnv: DEBUG_LAYER_SNAPSHOT_CONFLICT_CURATION_LEASE_HOURS_ENV,
    },
  });
}

function normalizeDebugLayerSnapshotConflictCurationEvent(
  value: unknown,
): DebugLayerSnapshotConflictCurationEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  const at = normalizeDateString(value.at);
  const actor = normalizeString(readString(value.actor), 120);
  const action = normalizeDebugLayerSnapshotConflictCurationLastAction(value.action);
  if (!at || !actor || !action) {
    return null;
  }
  const role = normalizeDebugLayerSnapshotConflictCuratorRole(value.role);
  const assignee = normalizeString(readString(value.assignee), 120);
  const note = normalizeString(readString(value.note), 280);
  return {
    id: normalizeString(readString(value.id), 160) ||
      `debug-layer-conflict-curation-${hashJson({ at, actor, role, action, assignee, note }).slice(0, 16)}`,
    at,
    actor,
    role,
    action,
    assignee,
    note,
  };
}

function mergeDebugLayerSnapshotConflictCurationEvents(
  existing: DebugLayerSnapshotConflictCurationEvent[],
  incoming: DebugLayerSnapshotConflictCurationEvent[],
): DebugLayerSnapshotConflictCurationEvent[] {
  const byId = new Map<string, DebugLayerSnapshotConflictCurationEvent>();
  for (const event of [...existing, ...incoming]) {
    byId.set(event.id, event);
  }
  return Array.from(byId.values())
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, 12);
}

function buildDebugLayerSnapshotConflictCurationEvent(
  action: DebugLayerSnapshotConflictCurationLastAction,
  actor: string,
  role: DebugLayerSnapshotConflictCuratorRole,
  assignee: string,
  note: string,
  at: string,
): DebugLayerSnapshotConflictCurationEvent {
  const normalizedNote = note.trim().slice(0, 280);
  return {
    id: `debug-layer-conflict-curation-${hashJson({ at, actor, role, action, assignee, note: normalizedNote }).slice(0, 16)}`,
    at,
    actor,
    role,
    action,
    assignee,
    note: normalizedNote,
  };
}

function updateDebugLayerSnapshotConflictCurationThread(
  value: unknown,
  action: DebugLayerSnapshotConflictCurationAction,
  actor: string,
  role: DebugLayerSnapshotConflictCuratorRole,
  note: string,
  updatedAt: string,
): DebugLayerSnapshotConflictCurationThread {
  const current = normalizeDebugLayerSnapshotConflictCurationThread(value);
  if (action === "release") {
    const event = buildDebugLayerSnapshotConflictCurationEvent("release", actor, role, "", note, updatedAt);
    return {
      ...current,
      status: "unassigned",
      assignee: "",
      updatedAt,
      lastActor: actor,
      lastAction: "release",
      note,
      leaseExpiresAt: null,
      leaseDurationHours: null,
      leaseExpired: false,
      events: mergeDebugLayerSnapshotConflictCurationEvents([event], current.events),
    };
  }
  const leaseDurationHours = readDebugLayerSnapshotConflictCurationLeaseHours();
  const event = buildDebugLayerSnapshotConflictCurationEvent("assign", actor, role, actor, note, updatedAt);
  return {
    ...current,
    status: "assigned",
    assignee: actor,
    openedAt: current.openedAt ?? updatedAt,
    updatedAt,
    lastActor: actor,
    lastAction: "assign",
    note,
    leaseExpiresAt: addHoursIso(updatedAt, leaseDurationHours),
    leaseDurationHours,
    leaseExpired: false,
    events: mergeDebugLayerSnapshotConflictCurationEvents([event], current.events),
  };
}

function expireDebugLayerSnapshotConflictCurationThreadIfNeeded(
  thread: DebugLayerSnapshotConflictCurationThread,
): DebugLayerSnapshotConflictCurationThread {
  if (thread.status !== "assigned" || !thread.leaseExpiresAt) {
    return thread;
  }
  const expiresAt = Date.parse(thread.leaseExpiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt > Date.now()) {
    return thread;
  }
  const actor = thread.assignee || thread.lastActor || "local-studio";
  const note = thread.note || "Lease de curadoria expirado.";
  const event = buildDebugLayerSnapshotConflictCurationEvent(
    "lease_expired",
    actor,
    "reviewer",
    "",
    note,
    thread.leaseExpiresAt,
  );
  return {
    ...thread,
    status: "unassigned",
    assignee: "",
    updatedAt: thread.leaseExpiresAt,
    lastActor: actor,
    lastAction: "lease_expired",
    leaseExpiresAt: null,
    leaseDurationHours: null,
    leaseExpired: true,
    events: mergeDebugLayerSnapshotConflictCurationEvents([event], thread.events),
  };
}

function readDebugLayerSnapshotConflictCurationLeaseHours(): number {
  const value = Number(process.env[DEBUG_LAYER_SNAPSHOT_CONFLICT_CURATION_LEASE_HOURS_ENV] ?? "");
  if (!Number.isFinite(value) || value <= 0) {
    return DEBUG_LAYER_SNAPSHOT_CONFLICT_CURATION_LEASE_HOURS;
  }
  return Math.min(Math.max(Math.floor(value), 1), 168);
}

function normalizeDebugLayerSnapshotConflictCurationLeaseHours(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return readDebugLayerSnapshotConflictCurationLeaseHours();
  }
  return Math.min(Math.max(Math.floor(numeric), 1), 168);
}

function addHoursIso(value: string, hours: number): string {
  const base = Date.parse(value);
  const timestamp = Number.isFinite(base) ? base : Date.now();
  return new Date(timestamp + hours * 60 * 60 * 1000).toISOString();
}

function resolveDebugLayerSnapshotConflictCurationActor(payload: unknown): string {
  if (!isRecord(payload)) {
    return "local-studio";
  }
  return normalizeString(
    readString(payload.actor) || readString(payload.assignee) || readString(payload.resolvedBy),
    120,
  ) || "local-studio";
}

function resolveDebugLayerSnapshotConflictCurationNote(payload: unknown): string {
  return isRecord(payload) ? normalizeString(readString(payload.note), 280) : "";
}

function resolveDebugLayerSnapshotConflictActor(payload: unknown): string {
  if (!isRecord(payload)) {
    return "local-studio";
  }
  return normalizeString(
    readString(payload.resolvedBy) || readString(payload.actor) || readString(payload.assignee),
    120,
  ) || "local-studio";
}

function resolveDebugLayerSnapshotConflictNote(payload: unknown): string {
  return isRecord(payload)
    ? normalizeString(readString(payload.resolutionNote) || readString(payload.note), 280)
    : "";
}

function debugLayerSnapshotConflictKey(snapshot: DebugLayerSnapshot): string {
  if (snapshot.scope === "run_comparison") {
    const runComparison = isRecord(snapshot.evidence.runComparison) ? snapshot.evidence.runComparison : {};
    const selectedNode = isRecord(snapshot.evidence.selectedNode) ? snapshot.evidence.selectedNode : {};
    const leftRunId = normalizeString(readString(runComparison.leftRunId), 160);
    const rightRunId = normalizeString(readString(runComparison.rightRunId), 160);
    const selectedNodeId = normalizeString(readString(selectedNode.nodeId), 160);
    if (leftRunId || rightRunId || selectedNodeId) {
      return stableConflictKey([
        "run",
        snapshot.flow.id,
        leftRunId || "-",
        rightRunId || "-",
        selectedNodeId || "sem-no",
      ]);
    }
  }
  if (snapshot.scope === "scenario_batch") {
    const batch = isRecord(snapshot.evidence.batch) ? snapshot.evidence.batch : {};
    const reportHash = normalizeString(readString(batch.reportHash), 160);
    if (reportHash) {
      return stableConflictKey(["batch", snapshot.flow.id, reportHash]);
    }
  }
  return stableConflictKey([
    "summary",
    snapshot.flow.id,
    snapshot.scope,
    snapshot.summary.headline,
    snapshot.summary.statusLabel,
  ]);
}

function debugLayerSnapshotConflictRef(snapshot: DebugLayerSnapshot): DebugLayerSnapshotConflictRef {
  const runComparison = isRecord(snapshot.evidence.runComparison) ? snapshot.evidence.runComparison : {};
  const selectedNode = isRecord(snapshot.evidence.selectedNode) ? snapshot.evidence.selectedNode : {};
  const batch = isRecord(snapshot.evidence.batch) ? snapshot.evidence.batch : {};
  return {
    packageHash: snapshot.packageHash,
    exportedAt: snapshot.exportedAt,
    scope: snapshot.scope,
    headline: normalizeString(snapshot.summary.headline, 300),
    statusLabel: normalizeString(snapshot.summary.statusLabel, 80),
    leftRunId: normalizeString(readString(runComparison.leftRunId), 160),
    rightRunId: normalizeString(readString(runComparison.rightRunId), 160),
    selectedNodeId: normalizeString(readString(selectedNode.nodeId), 160),
    batchReportHash: normalizeString(readString(batch.reportHash), 160),
  };
}

function stableConflictKey(parts: string[]): string {
  return parts.map((part) => part.trim().toLowerCase()).join("|");
}

function sortDebugLayerSnapshots(snapshots: DebugLayerSnapshot[]): DebugLayerSnapshot[] {
  return [...snapshots].sort((left, right) => {
    const dateDelta = new Date(right.exportedAt).getTime() - new Date(left.exportedAt).getTime();
    return dateDelta || left.packageHash.localeCompare(right.packageHash);
  });
}

async function writeDebugLayerSnapshots(flowRoot: string, payload: DebugLayerSnapshotsPackage): Promise<void> {
  const filePath = debugLayerSnapshotsPath(flowRoot);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  await rename(tempPath, filePath);
}

function debugLayerSnapshotsPath(flowRoot: string): string {
  return path.join(flowRoot, DEBUG_LAYER_SNAPSHOTS_FILE);
}

function debugLayerSnapshotsCentralSyncConfig(): DebugLayerSnapshotsCentralSyncConfig {
  const configuredUrl = process.env[DEBUG_LAYER_SNAPSHOTS_CENTRAL_URL_ENV]?.trim() ?? "";
  let url: string | null = null;
  let invalidReason: string | null = null;
  if (configuredUrl) {
    try {
      url = validateDebugLayerSnapshotsCentralUrl(configuredUrl);
    } catch (error) {
      invalidReason = errorMessage(error);
    }
  }
  const timeoutValue = Number(process.env[DEBUG_LAYER_SNAPSHOTS_CENTRAL_TIMEOUT_ENV] ?? "");
  const timeoutMs = Number.isFinite(timeoutValue)
    ? Math.min(Math.max(Math.floor(timeoutValue), 100), 60_000)
    : DEBUG_LAYER_SNAPSHOTS_CENTRAL_TIMEOUT_MS;
  return {
    url,
    token: process.env[DEBUG_LAYER_SNAPSHOTS_CENTRAL_TOKEN_ENV]?.trim() || null,
    timeoutMs,
    invalidReason,
  };
}

function buildDebugLayerSnapshotsCentralSyncStatus(
  config: DebugLayerSnapshotsCentralSyncConfig,
  sync?: Pick<
    DebugLayerSnapshotsCentralSyncStatus,
    "lastSyncedAt" | "statusCode" | "pushedSnapshotCount" | "pulledSnapshotCount" | "error"
  >,
): DebugLayerSnapshotsCentralSyncStatus {
  return {
    format: DEBUG_LAYER_SNAPSHOTS_CENTRAL_STATUS_FORMAT,
    generatedAt: new Date().toISOString(),
    configured: Boolean(config.url && !config.invalidReason),
    urlConfigured: Boolean(process.env[DEBUG_LAYER_SNAPSHOTS_CENTRAL_URL_ENV]?.trim()),
    tokenConfigured: Boolean(config.token),
    timeoutMs: config.timeoutMs,
    invalidReason: config.invalidReason,
    lastSyncedAt: sync?.lastSyncedAt ?? null,
    statusCode: sync?.statusCode ?? null,
    pushedSnapshotCount: sync?.pushedSnapshotCount ?? null,
    pulledSnapshotCount: sync?.pulledSnapshotCount ?? null,
    error: sync?.error ?? null,
    governance: {
      excludesRawNodePayloads: true,
      excludesSecretValues: true,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
      storesCentralToken: false,
      configuredUrlEnv: DEBUG_LAYER_SNAPSHOTS_CENTRAL_URL_ENV,
      configuredTokenEnv: DEBUG_LAYER_SNAPSHOTS_CENTRAL_TOKEN_ENV,
      configuredTimeoutEnv: DEBUG_LAYER_SNAPSHOTS_CENTRAL_TIMEOUT_ENV,
      maxPayloadBytes: DEBUG_LAYER_SNAPSHOTS_CENTRAL_MAX_BYTES,
    },
  };
}

async function fetchCentralDebugLayerSnapshotsSync(
  config: DebugLayerSnapshotsCentralSyncConfig,
  flowId: string,
  snapshots: DebugLayerSnapshotsPackage,
): Promise<{ statusCode: number; body: string }> {
  if (!config.url) {
    throw new WorkspaceError("Central de camadas de debug não configurada.", 400);
  }
  const body = JSON.stringify({
    format: DEBUG_LAYER_SNAPSHOTS_CENTRAL_SYNC_REQUEST_FORMAT,
    generatedAt: new Date().toISOString(),
    flowId,
    snapshots,
    snapshotCount: snapshots.snapshotCount,
    governance: {
      excludesRawNodePayloads: true,
      excludesSecretValues: true,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  });
  if (Buffer.byteLength(body, "utf-8") > DEBUG_LAYER_SNAPSHOTS_CENTRAL_MAX_BYTES) {
    throw new WorkspaceError("Camadas de debug excedem o limite de tamanho permitido para sync central.", 413);
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
    if (Number.isFinite(contentLength) && contentLength > DEBUG_LAYER_SNAPSHOTS_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central de camadas de debug excede o limite de tamanho permitido.", 413);
    }
    if (!response.ok) {
      throw new WorkspaceError(`Central de camadas de debug respondeu HTTP ${response.status}.`, response.status);
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > DEBUG_LAYER_SNAPSHOTS_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central de camadas de debug excede o limite de tamanho permitido.", 413);
    }
    return {
      statusCode: response.status,
      body: Buffer.from(buffer).toString("utf-8"),
    };
  } catch (error) {
    if (isRecord(error) && error.name === "AbortError") {
      throw new WorkspaceError("Timeout ao sincronizar central de camadas de debug.", 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function validateDebugLayerSnapshotsCentralUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WorkspaceError(`${DEBUG_LAYER_SNAPSHOTS_CENTRAL_URL_ENV} deve ser uma URL HTTP/HTTPS válida.`, 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WorkspaceError(`${DEBUG_LAYER_SNAPSHOTS_CENTRAL_URL_ENV} deve usar http ou https.`, 400);
  }
  return parsed.toString();
}

function sanitizeEvidence(value: unknown, depth = 0): Record<string, unknown> {
  const sanitized = sanitizeValue(value, depth);
  return isRecord(sanitized) ? sanitized : {};
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 8) {
    return "[max-depth]";
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.slice(0, 1000);
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
    "password",
    "rawnodepayload",
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
  const flow = isRecord(value.flow) ? value.flow : {};
  return readString(flow.id);
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

function normalizeNonNegativeInteger(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
}

function normalizeString(value: string, maxLength: number): string {
  return value.trim().slice(0, maxLength);
}

function uniqueSortedText(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  );
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
