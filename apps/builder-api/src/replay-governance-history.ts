import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadFlowById, WorkspaceError } from "./workspace.ts";

type ReplayGovernanceStatus = "ok" | "warning" | "pending";
type ReplayScenarioSourceKind = "manual" | "checkpoint_fork" | "node_debug" | "debug_replay" | "fixture_import" | "dataset_import";
type ReplayScenarioEvaluatorKind = "rules" | "external";
type ReplayPayloadMode = "structured" | "text";
type ReplayHistorySharedSyncAction = "empty" | "save" | "merge" | "curate_conflict" | "resolve_conflict";
type ReplayGovernanceHistoryConflictCurationAction = "assign" | "release";
type ReplayGovernanceHistoryConflictCurationLastAction =
  | ReplayGovernanceHistoryConflictCurationAction
  | "lease_expired";
type ReplayGovernanceHistoryConflictCurationStatus = "unassigned" | "assigned";
type ReplayGovernanceHistoryConflictCuratorRole = "owner" | "reviewer" | "viewer";

interface ReplayGovernanceItem {
  id: string;
  label: string;
  status: ReplayGovernanceStatus;
  expected: string;
  observed: string;
  evidence: string;
  action: string;
}

interface ReplayGovernanceComparison {
  status: ReplayGovernanceStatus;
  statusLabel: string;
  summary: string;
  items: ReplayGovernanceItem[];
}

interface ReplayGovernanceReview {
  status: "approved" | "needs_review" | "monitor";
  statusLabel: string;
  reviewer: string;
  reviewedAt: string;
  decision: "approve_snapshot" | "review_before_promotion" | "monitor_next_run";
  summary: string;
  reasons: string[];
  nextAction: string;
  governance: {
    excludesRawScenarioPayload: true;
    excludesRawPinPayloads: true;
    excludesRawCheckpointState: true;
    excludesSecretValues: true;
    source: "studio-replay-governance-review";
  };
}

interface ReplayGovernanceHistorySnapshot {
  id: string;
  capturedAt: string;
  snapshotHash: string;
  packageHash: string;
  flow: {
    id: string;
    name: string;
    version: string;
    flowHash: string;
    projectHash: string | null;
  };
  scenario: {
    id: string;
    label: string;
    sourceKind: ReplayScenarioSourceKind;
    sourceAgentId: string;
    sourceRunId: string | null;
    sourceNodeId: string | null;
    sourceEventSeq: number | null;
    hasCheckpoint: boolean;
    useNodePins: boolean;
    evaluatorKind: ReplayScenarioEvaluatorKind;
    evaluatorRuleCount: number;
    payloadMode: ReplayPayloadMode;
  };
  comparison: ReplayGovernanceComparison;
  review: ReplayGovernanceReview;
  evidence: {
    checkpointEventSeq: number | null;
    checkpointNodeId: string | null;
    compatibilityLabel: string;
    restoreObserved: boolean;
    activePinCount: number;
    stalePinCount: number;
  };
}

interface ReplayGovernanceHistorySharedSyncInfo {
  action: ReplayHistorySharedSyncAction;
  updatedAt: string;
  storage: string;
  contentHash: string;
  incomingCount: number;
  existingCount: number;
  addedCount: number;
  unchangedCount: number;
  finalCount: number;
  conflictCount: number;
  openConflictCount: number;
  governance: {
    excludesRawScenarioPayload: true;
    excludesRawPinPayloads: true;
    excludesRawCheckpointState: true;
    excludesSecretValues: true;
  };
}

interface ReplayGovernanceHistoryConflictRef {
  snapshotHash: string;
  packageHash: string;
  capturedAt: string;
  scenarioId: string;
  scenarioLabel: string;
  sourceKind: ReplayScenarioSourceKind;
  sourceRunId: string | null;
  sourceNodeId: string | null;
  sourceEventSeq: number | null;
  reviewStatus: ReplayGovernanceReview["status"];
  reviewDecision: ReplayGovernanceReview["decision"];
  reviewer: string;
  statusLabel: string;
}

interface ReplayGovernanceHistoryConflictCurationThread {
  status: ReplayGovernanceHistoryConflictCurationStatus;
  assignee: string;
  openedAt: string | null;
  updatedAt: string | null;
  lastActor: string;
  lastAction: ReplayGovernanceHistoryConflictCurationLastAction | null;
  note: string;
  leaseExpiresAt: string | null;
  leaseDurationHours: number | null;
  leaseExpired: boolean;
  events: ReplayGovernanceHistoryConflictCurationEvent[];
  governance: {
    excludesRawScenarioPayload: true;
    excludesRawPinPayloads: true;
    excludesRawCheckpointState: true;
    excludesSecretValues: true;
    autoReleasesExpiredAssignments: true;
    configuredLeaseHoursEnv: typeof REPLAY_GOVERNANCE_HISTORY_CONFLICT_CURATION_LEASE_HOURS_ENV;
  };
}

interface ReplayGovernanceHistoryConflictCurationEvent {
  id: string;
  at: string;
  actor: string;
  role: ReplayGovernanceHistoryConflictCuratorRole;
  action: ReplayGovernanceHistoryConflictCurationLastAction;
  assignee: string;
  note: string;
}

interface ReplayGovernanceHistoryConflict {
  conflictId: string;
  status: "open";
  conflictKey: string;
  scenarioId: string;
  scenarioLabel: string;
  snapshotCount: number;
  snapshotHashes: string[];
  latestSnapshotHash: string;
  latestCapturedAt: string;
  refs: ReplayGovernanceHistoryConflictRef[];
  curationThread: ReplayGovernanceHistoryConflictCurationThread;
  governance: {
    excludesRawScenarioPayload: true;
    excludesRawPinPayloads: true;
    excludesRawCheckpointState: true;
    excludesSecretValues: true;
  };
}

interface ReplayGovernanceHistoryResolutionRecord {
  resolutionId: string;
  conflictId: string;
  conflictKey: string;
  scenarioId: string;
  scenarioLabel: string;
  resolvedAt: string;
  resolvedBy: string;
  resolvedRole: ReplayGovernanceHistoryConflictCuratorRole;
  resolutionNote: string;
  keptSnapshotHash: string;
  keptRef: ReplayGovernanceHistoryConflictRef;
  discardedRefs: ReplayGovernanceHistoryConflictRef[];
  candidateCount: number;
  governance: {
    excludesRawScenarioPayload: true;
    excludesRawPinPayloads: true;
    excludesRawCheckpointState: true;
    excludesSecretValues: true;
  };
}

interface ReplayGovernanceHistoryPackage {
  format: "agent-flow-builder.replay-governance-history.v1";
  exportedAt: string;
  packageHash: string;
  flowId: string;
  snapshotCount: number;
  snapshots: ReplayGovernanceHistorySnapshot[];
  conflictCount: number;
  openConflictCount: number;
  conflicts: ReplayGovernanceHistoryConflict[];
  resolutionHistoryCount: number;
  resolutionHistory: ReplayGovernanceHistoryResolutionRecord[];
  governance: {
    excludesRawScenarioPayload: true;
    excludesRawPinPayloads: true;
    excludesRawCheckpointState: true;
    excludesSecretValues: true;
    source: "studio-scenario-replay-history";
  };
  sharedSync: ReplayGovernanceHistorySharedSyncInfo;
}

interface ReplayGovernanceHistoryConflictReview {
  conflictId: string;
  status: "open";
  conflictKey: string;
  scenarioId: string;
  scenarioLabel: string;
  snapshotCount: number;
  snapshotHashes: string[];
  latestSnapshotHash: string;
  latestCapturedAt: string;
  refs: ReplayGovernanceHistoryConflictRef[];
  curationThread: ReplayGovernanceHistoryConflictCurationThread;
  governance: {
    excludesSnapshots: true;
    excludesRawScenarioPayload: true;
    excludesRawPinPayloads: true;
    excludesRawCheckpointState: true;
    excludesSecretValues: true;
    includesOnlyRefsAndCuration: true;
  };
}

interface ReplayGovernanceHistoryConflictReviewPackage {
  format: typeof REPLAY_GOVERNANCE_HISTORY_CONFLICT_REVIEW_FORMAT;
  generatedAt: string;
  flowId: string;
  packageHash: string;
  conflictCount: number;
  openConflictCount: number;
  resolutionHistoryCount: number;
  conflicts: ReplayGovernanceHistoryConflictReview[];
  resolutionHistory: ReplayGovernanceHistoryResolutionRecord[];
  summary: {
    scenarioCount: number;
    assignedConflictCount: number;
    unassignedConflictCount: number;
    approvedDecisionCount: number;
    needsReviewDecisionCount: number;
    monitorDecisionCount: number;
  };
  governance: {
    excludesSnapshots: true;
    excludesRawScenarioPayload: true;
    excludesRawPinPayloads: true;
    excludesRawCheckpointState: true;
    excludesSecretValues: true;
    includesOnlyRefsThreadsAndResolutionHistory: true;
    localWorkspaceFile: true;
  };
}

type ReplayGovernanceHistoryConflictReviewDiffItemStatus = "same" | "changed" | "only_current" | "only_incoming";

interface ReplayGovernanceHistoryConflictReviewDiffItem {
  id: string;
  label: string;
  status: ReplayGovernanceHistoryConflictReviewDiffItemStatus;
  current: string;
  incoming: string;
  delta: number;
}

interface ReplayGovernanceHistoryConflictReviewDiffSection {
  id: string;
  title: string;
  status: "same" | "changed";
  statusLabel: string;
  summary: string;
  items: ReplayGovernanceHistoryConflictReviewDiffItem[];
}

export interface ReplayGovernanceHistoryCentralSyncStatus {
  format: typeof REPLAY_GOVERNANCE_HISTORY_CENTRAL_STATUS_FORMAT;
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
    excludesRawScenarioPayload: true;
    excludesRawPinPayloads: true;
    excludesRawCheckpointState: true;
    excludesSecretValues: true;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
    storesCentralToken: false;
    configuredUrlEnv: typeof REPLAY_GOVERNANCE_HISTORY_CENTRAL_URL_ENV;
    configuredTokenEnv: typeof REPLAY_GOVERNANCE_HISTORY_CENTRAL_TOKEN_ENV;
    configuredTimeoutEnv: typeof REPLAY_GOVERNANCE_HISTORY_CENTRAL_TIMEOUT_ENV;
    maxPayloadBytes: typeof REPLAY_GOVERNANCE_HISTORY_CENTRAL_MAX_BYTES;
  };
}

export interface ReplayGovernanceHistoryCentralSyncResult {
  format: typeof REPLAY_GOVERNANCE_HISTORY_CENTRAL_SYNC_RESULT_FORMAT;
  flowId: string;
  history: ReplayGovernanceHistoryPackage;
  central: ReplayGovernanceHistoryCentralSyncStatus;
  pushedSnapshotCount: number;
  pulledSnapshotCount: number;
  governance: {
    excludesRawScenarioPayload: true;
    excludesRawPinPayloads: true;
    excludesRawCheckpointState: true;
    excludesSecretValues: true;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
  };
}

interface ReplayHistoryMergeStats {
  incomingCount: number;
  existingCount: number;
  addedCount: number;
  unchangedCount: number;
  finalCount: number;
}

interface ReplayGovernanceHistoryCentralSyncConfig {
  url: string | null;
  token: string | null;
  timeoutMs: number;
  invalidReason: string | null;
}

const REPLAY_GOVERNANCE_HISTORY_FILE = ".agent-flow/replay-governance/history.afreplayhistory.json";
const MAX_REPLAY_GOVERNANCE_HISTORY_SNAPSHOTS = 64;
const REPLAY_GOVERNANCE_HISTORY_CENTRAL_SYNC_REQUEST_FORMAT =
  "agent-flow-builder.replay-governance-history-central-sync-request.v1";
const REPLAY_GOVERNANCE_HISTORY_CENTRAL_SYNC_RESULT_FORMAT =
  "agent-flow-builder.replay-governance-history-central-sync-result.v1";
const REPLAY_GOVERNANCE_HISTORY_CENTRAL_STATUS_FORMAT =
  "agent-flow-builder.replay-governance-history-central-sync-status.v1";
const REPLAY_GOVERNANCE_HISTORY_CONFLICT_REVIEW_FORMAT =
  "agent-flow-builder.replay-governance-history-conflict-review.v1";
const REPLAY_GOVERNANCE_HISTORY_CONFLICT_REVIEW_DIFF_FORMAT =
  "agent-flow-builder.replay-governance-history-conflict-review-diff.v1";
const REPLAY_GOVERNANCE_HISTORY_CENTRAL_URL_ENV = "AGENT_FLOW_REPLAY_GOVERNANCE_HISTORY_CENTRAL_URL";
const REPLAY_GOVERNANCE_HISTORY_CENTRAL_TOKEN_ENV = "AGENT_FLOW_REPLAY_GOVERNANCE_HISTORY_CENTRAL_TOKEN";
const REPLAY_GOVERNANCE_HISTORY_CENTRAL_TIMEOUT_ENV = "AGENT_FLOW_REPLAY_GOVERNANCE_HISTORY_CENTRAL_TIMEOUT_MS";
const REPLAY_GOVERNANCE_HISTORY_CONFLICT_CURATION_LEASE_HOURS_ENV =
  "AGENT_FLOW_REPLAY_GOVERNANCE_CONFLICT_CURATION_LEASE_HOURS";
const REPLAY_GOVERNANCE_HISTORY_CONFLICT_CURATION_LEASE_HOURS = 24;
const REPLAY_GOVERNANCE_HISTORY_CENTRAL_TIMEOUT_MS = 5_000;
const REPLAY_GOVERNANCE_HISTORY_CENTRAL_MAX_BYTES = 2_000_000;

export async function loadReplayGovernanceHistory(
  workspaceRoot: string,
  flowId: string,
): Promise<ReplayGovernanceHistoryPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  try {
    const raw = await readFile(replayGovernanceHistoryPath(loaded.flowRoot), "utf-8");
    const payload = normalizeReplayGovernanceHistoryPackage(JSON.parse(raw) as unknown, loaded.flow.id, "merge");
    if (!payload) {
      throw new WorkspaceError("Histórico compartilhado de replay inválido.", 422);
    }
    return payload;
  } catch (error) {
    if (isFileNotFound(error)) {
      return buildReplayGovernanceHistoryPackage(loaded.flow.id, [], {
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
    throw new WorkspaceError("Falha ao ler histórico compartilhado de replay.", 500, error);
  }
}

export async function saveReplayGovernanceHistory(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<ReplayGovernanceHistoryPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const incoming = normalizeReplayGovernanceHistoryPackage(payload, loaded.flow.id, "save");
  if (!incoming) {
    throw new WorkspaceError("Payload de histórico de replay inválido.", 400);
  }
  const existing = await loadReplayGovernanceHistory(workspaceRoot, flowId);
  const resolutionHistory = mergeReplayGovernanceHistoryResolutionHistory(
    existing.resolutionHistory,
    incoming.resolutionHistory,
  );
  const next = buildReplayGovernanceHistoryPackage(loaded.flow.id, incoming.snapshots, {
    action: "save",
    incomingCount: incoming.snapshots.length,
    existingCount: existing.snapshotCount,
    addedCount: incoming.snapshots.filter(
      (snapshot) => !existing.snapshots.some((existingSnapshot) => existingSnapshot.snapshotHash === snapshot.snapshotHash),
    ).length,
    unchangedCount: incoming.snapshots.filter(
      (snapshot) => existing.snapshots.some((existingSnapshot) => existingSnapshot.snapshotHash === snapshot.snapshotHash),
    ).length,
    finalCount: incoming.snapshots.length,
  }, [...existing.conflicts, ...incoming.conflicts], resolutionHistory);
  await writeReplayGovernanceHistory(loaded.flowRoot, next);
  return next;
}

export async function mergeReplayGovernanceHistory(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<ReplayGovernanceHistoryPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const incoming = normalizeReplayGovernanceHistoryPackage(payload, loaded.flow.id, "merge");
  if (!incoming) {
    throw new WorkspaceError("Payload de merge do histórico de replay inválido.", 400);
  }
  const existing = await loadReplayGovernanceHistory(workspaceRoot, flowId);
  const merged = mergeReplayGovernanceHistorySnapshots(existing.snapshots, incoming.snapshots);
  const resolutionHistory = mergeReplayGovernanceHistoryResolutionHistory(
    existing.resolutionHistory,
    incoming.resolutionHistory,
  );
  const next = buildReplayGovernanceHistoryPackage(loaded.flow.id, merged.snapshots, {
    action: "merge",
    ...merged.stats,
  }, [...existing.conflicts, ...incoming.conflicts], resolutionHistory);
  await writeReplayGovernanceHistory(loaded.flowRoot, next);
  return next;
}

export async function loadReplayGovernanceHistoryConflictReview(
  workspaceRoot: string,
  flowId: string,
): Promise<ReplayGovernanceHistoryConflictReviewPackage> {
  const history = await loadReplayGovernanceHistory(workspaceRoot, flowId);
  return buildReplayGovernanceHistoryConflictReviewPackage(history);
}

export async function compareReplayGovernanceHistoryConflictReview(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  const current = await loadReplayGovernanceHistory(workspaceRoot, flowId).then(
    buildReplayGovernanceHistoryConflictReviewPackage,
  );
  const record = isRecord(payload) ? payload : {};
  const candidate = record.review !== undefined ? record.review : payload;
  const incoming = normalizeReplayGovernanceHistoryConflictReviewPackage(candidate, current.flowId);
  if (!incoming) {
    throw new WorkspaceError("Revisão de conflitos de replay inválida ou contendo snapshots/payload bruto.", 400);
  }
  if (incoming.flowId !== current.flowId) {
    throw new WorkspaceError("Revisão de conflitos de replay pertence a outro flow.", 400, {
      expectedFlowId: current.flowId,
      receivedFlowId: incoming.flowId,
    });
  }
  return buildReplayGovernanceHistoryConflictReviewDiffPackage(current, incoming);
}

export async function updateReplayGovernanceHistoryConflictCuration(
  workspaceRoot: string,
  flowId: string,
  conflictId: string,
  payload: unknown,
): Promise<ReplayGovernanceHistoryPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const existing = await loadReplayGovernanceHistory(workspaceRoot, flowId);
  const conflict = existing.conflicts.find((item) => item.conflictId === conflictId);
  if (!conflict) {
    throw new WorkspaceError("Conflito do histórico de replay não encontrado.", 404);
  }
  const action = normalizeReplayGovernanceHistoryConflictCurationAction(isRecord(payload) ? payload.action : undefined);
  if (!action) {
    throw new WorkspaceError("Ação de curadoria do conflito de replay é obrigatória.", 400);
  }
  const actor = resolveReplayGovernanceHistoryConflictCurationActor(payload);
  const role = resolveReplayGovernanceHistoryConflictCuratorRole(payload);
  assertReplayGovernanceHistoryConflictMutationAllowed(role, "curar conflitos de replay");
  const note = resolveReplayGovernanceHistoryConflictCurationNote(payload);
  const updatedAt = new Date().toISOString();
  const nextConflicts = existing.conflicts.map((entry) =>
    entry.conflictId === conflictId
      ? {
          ...entry,
          curationThread: updateReplayGovernanceHistoryConflictCurationThread(
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
  const next = buildReplayGovernanceHistoryPackage(loaded.flow.id, existing.snapshots, {
    action: "curate_conflict",
    incomingCount: existing.snapshotCount,
    existingCount: existing.snapshotCount,
    addedCount: 0,
    unchangedCount: existing.snapshotCount,
    finalCount: existing.snapshotCount,
  }, nextConflicts, existing.resolutionHistory);
  await writeReplayGovernanceHistory(loaded.flowRoot, next);
  return next;
}

export async function resolveReplayGovernanceHistoryConflict(
  workspaceRoot: string,
  flowId: string,
  conflictId: string,
  payload: unknown,
): Promise<ReplayGovernanceHistoryPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const existing = await loadReplayGovernanceHistory(workspaceRoot, flowId);
  const conflict = existing.conflicts.find((item) => item.conflictId === conflictId);
  if (!conflict) {
    throw new WorkspaceError("Conflito do histórico de replay não encontrado.", 404);
  }
  const keepSnapshotHash = normalizeString(readString(isRecord(payload) ? payload.keepSnapshotHash : undefined), 128);
  if (!conflict.snapshotHashes.includes(keepSnapshotHash)) {
    throw new WorkspaceError("Snapshot escolhido não pertence ao conflito de replay.", 400);
  }
  const retainedSnapshots = existing.snapshots.filter(
    (snapshot) =>
      replayGovernanceHistoryConflictKey(snapshot) !== conflict.conflictKey ||
      snapshot.snapshotHash === keepSnapshotHash,
  );
  const resolvedBy = resolveReplayGovernanceHistoryConflictCurationActor(payload);
  const resolvedRole = resolveReplayGovernanceHistoryConflictCuratorRole(payload);
  assertReplayGovernanceHistoryConflictMutationAllowed(resolvedRole, "resolver conflitos de replay");
  const resolutionNote = resolveReplayGovernanceHistoryConflictResolutionNote(payload);
  const resolutionRecord = buildReplayGovernanceHistoryResolutionRecord(
    conflict,
    keepSnapshotHash,
    resolvedBy,
    resolvedRole,
    resolutionNote,
  );
  const resolutionHistory = mergeReplayGovernanceHistoryResolutionHistory(existing.resolutionHistory, [resolutionRecord]);
  const next = buildReplayGovernanceHistoryPackage(loaded.flow.id, retainedSnapshots, {
    action: "resolve_conflict",
    incomingCount: 0,
    existingCount: existing.snapshotCount,
    addedCount: 0,
    unchangedCount: retainedSnapshots.length,
    finalCount: retainedSnapshots.length,
  }, existing.conflicts, resolutionHistory);
  await writeReplayGovernanceHistory(loaded.flowRoot, next);
  return next;
}

export async function loadReplayGovernanceHistoryCentralSyncStatus(): Promise<ReplayGovernanceHistoryCentralSyncStatus> {
  return buildReplayGovernanceHistoryCentralSyncStatus(replayGovernanceHistoryCentralSyncConfig());
}

export async function syncCentralReplayGovernanceHistory(
  workspaceRoot: string,
  flowId: string,
): Promise<ReplayGovernanceHistoryCentralSyncResult> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const config = replayGovernanceHistoryCentralSyncConfig();
  if (config.invalidReason) {
    throw new WorkspaceError(`Configuração da central de histórico de replay inválida: ${config.invalidReason}`, 422);
  }
  if (!config.url) {
    throw new WorkspaceError("Central de histórico de replay não configurada.", 400);
  }
  const existing = await loadReplayGovernanceHistory(workspaceRoot, flowId);
  const fetched = await fetchCentralReplayGovernanceHistorySync(config, flowId, existing);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fetched.body) as unknown;
  } catch (error) {
    throw new WorkspaceError("Resposta central de histórico de replay não é JSON válido.", 502, error);
  }
  const centralHistoryPayload = isRecord(parsed) && parsed.history !== undefined ? parsed.history : parsed;
  const incoming = normalizeReplayGovernanceHistoryPackage(centralHistoryPayload, loaded.flow.id, "merge");
  if (!incoming) {
    throw new WorkspaceError("Resposta central de histórico de replay não respeita o formato esperado.", 502);
  }
  const merged = mergeReplayGovernanceHistorySnapshots(existing.snapshots, incoming.snapshots);
  const resolutionHistory = mergeReplayGovernanceHistoryResolutionHistory(
    existing.resolutionHistory,
    incoming.resolutionHistory,
  );
  const next = buildReplayGovernanceHistoryPackage(loaded.flow.id, merged.snapshots, {
    action: "merge",
    ...merged.stats,
  }, [...existing.conflicts, ...incoming.conflicts], resolutionHistory);
  await writeReplayGovernanceHistory(loaded.flowRoot, next);
  const syncedAt = new Date().toISOString();
  return {
    format: REPLAY_GOVERNANCE_HISTORY_CENTRAL_SYNC_RESULT_FORMAT,
    flowId,
    history: next,
    central: buildReplayGovernanceHistoryCentralSyncStatus(config, {
      lastSyncedAt: syncedAt,
      statusCode: fetched.statusCode,
      pushedSnapshotCount: existing.snapshotCount,
      pulledSnapshotCount: incoming.snapshotCount,
      error: null,
    }),
    pushedSnapshotCount: existing.snapshotCount,
    pulledSnapshotCount: incoming.snapshotCount,
    governance: {
      excludesRawScenarioPayload: true,
      excludesRawPinPayloads: true,
      excludesRawCheckpointState: true,
      excludesSecretValues: true,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  };
}

function replayGovernanceHistoryPath(flowRoot: string): string {
  return path.join(flowRoot, REPLAY_GOVERNANCE_HISTORY_FILE);
}

async function writeReplayGovernanceHistory(flowRoot: string, value: ReplayGovernanceHistoryPackage): Promise<void> {
  const filePath = replayGovernanceHistoryPath(flowRoot);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await rename(tempPath, filePath);
}

function replayGovernanceHistoryCentralSyncConfig(): ReplayGovernanceHistoryCentralSyncConfig {
  const configuredUrl = process.env[REPLAY_GOVERNANCE_HISTORY_CENTRAL_URL_ENV]?.trim() ?? "";
  let url: string | null = null;
  let invalidReason: string | null = null;
  if (configuredUrl) {
    try {
      url = validateReplayGovernanceHistoryCentralUrl(configuredUrl);
    } catch (error) {
      invalidReason = errorMessage(error);
    }
  }
  const timeoutValue = Number(process.env[REPLAY_GOVERNANCE_HISTORY_CENTRAL_TIMEOUT_ENV] ?? "");
  const timeoutMs = Number.isFinite(timeoutValue)
    ? Math.min(Math.max(Math.floor(timeoutValue), 100), 60_000)
    : REPLAY_GOVERNANCE_HISTORY_CENTRAL_TIMEOUT_MS;
  return {
    url,
    token: process.env[REPLAY_GOVERNANCE_HISTORY_CENTRAL_TOKEN_ENV]?.trim() || null,
    timeoutMs,
    invalidReason,
  };
}

function buildReplayGovernanceHistoryCentralSyncStatus(
  config: ReplayGovernanceHistoryCentralSyncConfig,
  sync?: Pick<
    ReplayGovernanceHistoryCentralSyncStatus,
    "lastSyncedAt" | "statusCode" | "pushedSnapshotCount" | "pulledSnapshotCount" | "error"
  >,
): ReplayGovernanceHistoryCentralSyncStatus {
  return {
    format: REPLAY_GOVERNANCE_HISTORY_CENTRAL_STATUS_FORMAT,
    generatedAt: new Date().toISOString(),
    configured: Boolean(config.url && !config.invalidReason),
    urlConfigured: Boolean(process.env[REPLAY_GOVERNANCE_HISTORY_CENTRAL_URL_ENV]?.trim()),
    tokenConfigured: Boolean(config.token),
    timeoutMs: config.timeoutMs,
    invalidReason: config.invalidReason,
    lastSyncedAt: sync?.lastSyncedAt ?? null,
    statusCode: sync?.statusCode ?? null,
    pushedSnapshotCount: sync?.pushedSnapshotCount ?? null,
    pulledSnapshotCount: sync?.pulledSnapshotCount ?? null,
    error: sync?.error ?? null,
    governance: {
      excludesRawScenarioPayload: true,
      excludesRawPinPayloads: true,
      excludesRawCheckpointState: true,
      excludesSecretValues: true,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
      storesCentralToken: false,
      configuredUrlEnv: REPLAY_GOVERNANCE_HISTORY_CENTRAL_URL_ENV,
      configuredTokenEnv: REPLAY_GOVERNANCE_HISTORY_CENTRAL_TOKEN_ENV,
      configuredTimeoutEnv: REPLAY_GOVERNANCE_HISTORY_CENTRAL_TIMEOUT_ENV,
      maxPayloadBytes: REPLAY_GOVERNANCE_HISTORY_CENTRAL_MAX_BYTES,
    },
  };
}

async function fetchCentralReplayGovernanceHistorySync(
  config: ReplayGovernanceHistoryCentralSyncConfig,
  flowId: string,
  history: ReplayGovernanceHistoryPackage,
): Promise<{ statusCode: number; body: string }> {
  if (!config.url) {
    throw new WorkspaceError("Central de histórico de replay não configurada.", 400);
  }
  const body = JSON.stringify({
    format: REPLAY_GOVERNANCE_HISTORY_CENTRAL_SYNC_REQUEST_FORMAT,
    generatedAt: new Date().toISOString(),
    flowId,
    history,
    snapshotCount: history.snapshotCount,
    governance: {
      excludesRawScenarioPayload: true,
      excludesRawPinPayloads: true,
      excludesRawCheckpointState: true,
      excludesSecretValues: true,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  });
  if (Buffer.byteLength(body, "utf-8") > REPLAY_GOVERNANCE_HISTORY_CENTRAL_MAX_BYTES) {
    throw new WorkspaceError("Histórico de replay excede o limite de tamanho permitido para sync central.", 413);
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
    if (Number.isFinite(contentLength) && contentLength > REPLAY_GOVERNANCE_HISTORY_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central de histórico de replay excede o limite de tamanho permitido.", 413);
    }
    if (!response.ok) {
      throw new WorkspaceError(`Central de histórico de replay respondeu HTTP ${response.status}.`, response.status);
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > REPLAY_GOVERNANCE_HISTORY_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central de histórico de replay excede o limite de tamanho permitido.", 413);
    }
    return {
      statusCode: response.status,
      body: Buffer.from(buffer).toString("utf-8"),
    };
  } catch (error) {
    if (isRecord(error) && error.name === "AbortError") {
      throw new WorkspaceError("Timeout ao sincronizar central de histórico de replay.", 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeReplayGovernanceHistoryPackage(
  value: unknown,
  fallbackFlowId: string,
  action: ReplayHistorySharedSyncAction,
): ReplayGovernanceHistoryPackage | null {
  if (
    !isRecord(value) ||
    value.format !== "agent-flow-builder.replay-governance-history.v1" ||
    !Array.isArray(value.snapshots)
  ) {
    return null;
  }
  const flowId = typeof value.flowId === "string" && value.flowId.trim() ? value.flowId.trim() : fallbackFlowId;
  const snapshots = syncReplayGovernanceHistorySnapshots(value.snapshots);
  const conflicts = Array.isArray(value.conflicts) ? value.conflicts : [];
  const resolutionHistory = Array.isArray(value.resolutionHistory) ? value.resolutionHistory : [];
  return buildReplayGovernanceHistoryPackage(flowId, snapshots, {
    action,
    incomingCount: snapshots.length,
    existingCount: 0,
    addedCount: snapshots.length,
    unchangedCount: 0,
    finalCount: snapshots.length,
  }, conflicts, resolutionHistory);
}

function buildReplayGovernanceHistoryPackage(
  flowId: string,
  snapshots: unknown[],
  stats: ReplayHistoryMergeStats & { action: ReplayHistorySharedSyncAction },
  previousConflicts: unknown[] = [],
  resolutionHistory: unknown[] = [],
): ReplayGovernanceHistoryPackage {
  const normalizedResolutionHistory = normalizeReplayGovernanceHistoryResolutionHistory(resolutionHistory).slice(0, 128);
  const normalized = applyReplayGovernanceHistoryResolutionHistory(
    syncReplayGovernanceHistorySnapshots(snapshots),
    normalizedResolutionHistory,
  ).slice(0, MAX_REPLAY_GOVERNANCE_HISTORY_SNAPSHOTS);
  const conflicts = buildReplayGovernanceHistoryConflicts(flowId, normalized, previousConflicts);
  const withoutHash = {
    format: "agent-flow-builder.replay-governance-history.v1" as const,
    exportedAt: new Date().toISOString(),
    flowId,
    snapshotCount: normalized.length,
    snapshots: normalized,
    conflictCount: conflicts.length,
    openConflictCount: conflicts.length,
    conflicts,
    resolutionHistoryCount: normalizedResolutionHistory.length,
    resolutionHistory: normalizedResolutionHistory,
    governance: {
      excludesRawScenarioPayload: true as const,
      excludesRawPinPayloads: true as const,
      excludesRawCheckpointState: true as const,
      excludesSecretValues: true as const,
      source: "studio-scenario-replay-history" as const,
    },
  };
  return {
    ...withoutHash,
    packageHash: shortHash(stableStringify(withoutHash)),
    sharedSync: {
      action: stats.action,
      updatedAt: new Date().toISOString(),
      storage: REPLAY_GOVERNANCE_HISTORY_FILE,
      contentHash: shortHash(stableStringify({ flowId, snapshots: normalized, resolutionHistory: normalizedResolutionHistory })),
      incomingCount: stats.incomingCount,
      existingCount: stats.existingCount,
      addedCount: stats.addedCount,
      unchangedCount: stats.unchangedCount,
      finalCount: normalized.length,
      conflictCount: conflicts.length,
      openConflictCount: conflicts.length,
      governance: {
        excludesRawScenarioPayload: true,
        excludesRawPinPayloads: true,
        excludesRawCheckpointState: true,
        excludesSecretValues: true,
      },
    },
  };
}

function buildReplayGovernanceHistoryConflictReviewPackage(
  source: ReplayGovernanceHistoryPackage,
): ReplayGovernanceHistoryConflictReviewPackage {
  return buildReplayGovernanceHistoryConflictReviewPackageFromParts(
    source.flowId,
    source.conflicts.map(replayGovernanceHistoryConflictReview),
    source.resolutionHistory,
  );
}

function buildReplayGovernanceHistoryConflictReviewPackageFromParts(
  flowId: string,
  conflicts: ReplayGovernanceHistoryConflictReview[],
  resolutionHistory: ReplayGovernanceHistoryResolutionRecord[],
): ReplayGovernanceHistoryConflictReviewPackage {
  const generatedAt = new Date().toISOString();
  const sortedConflicts = [...conflicts].sort((left, right) => right.latestCapturedAt.localeCompare(left.latestCapturedAt));
  const sortedHistory = normalizeReplayGovernanceHistoryResolutionHistory(resolutionHistory);
  const allRefs = sortedConflicts.flatMap((conflict) => conflict.refs);
  const summary = {
    scenarioCount: uniqueSortedText(sortedConflicts.map((conflict) => conflict.scenarioId)).length,
    assignedConflictCount: sortedConflicts.filter((conflict) => conflict.curationThread.status === "assigned").length,
    unassignedConflictCount: sortedConflicts.filter((conflict) => conflict.curationThread.status === "unassigned").length,
    approvedDecisionCount: allRefs.filter((ref) => ref.reviewDecision === "approve_snapshot").length,
    needsReviewDecisionCount: allRefs.filter((ref) => ref.reviewDecision === "review_before_promotion").length,
    monitorDecisionCount: allRefs.filter((ref) => ref.reviewDecision === "monitor_next_run").length,
  };
  const packageHash = shortHash(stableStringify({
    format: REPLAY_GOVERNANCE_HISTORY_CONFLICT_REVIEW_FORMAT,
    flowId,
    conflicts: sortedConflicts,
    resolutionHistory: sortedHistory,
    summary,
  }));
  return {
    format: REPLAY_GOVERNANCE_HISTORY_CONFLICT_REVIEW_FORMAT,
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
      excludesRawScenarioPayload: true,
      excludesRawPinPayloads: true,
      excludesRawCheckpointState: true,
      excludesSecretValues: true,
      includesOnlyRefsThreadsAndResolutionHistory: true,
      localWorkspaceFile: true,
    },
  };
}

function replayGovernanceHistoryConflictReview(
  conflict: ReplayGovernanceHistoryConflict,
): ReplayGovernanceHistoryConflictReview {
  return {
    conflictId: conflict.conflictId,
    status: "open",
    conflictKey: conflict.conflictKey,
    scenarioId: conflict.scenarioId,
    scenarioLabel: conflict.scenarioLabel,
    snapshotCount: conflict.snapshotCount,
    snapshotHashes: uniqueSortedText(conflict.snapshotHashes),
    latestSnapshotHash: conflict.latestSnapshotHash,
    latestCapturedAt: conflict.latestCapturedAt,
    refs: conflict.refs,
    curationThread: normalizeReplayGovernanceHistoryConflictCurationThread(conflict.curationThread),
    governance: {
      excludesSnapshots: true,
      excludesRawScenarioPayload: true,
      excludesRawPinPayloads: true,
      excludesRawCheckpointState: true,
      excludesSecretValues: true,
      includesOnlyRefsAndCuration: true,
    },
  };
}

function normalizeReplayGovernanceHistoryConflictReviewPackage(
  value: unknown,
  fallbackFlowId: string,
): ReplayGovernanceHistoryConflictReviewPackage | null {
  if (!isRecord(value) || value.format !== REPLAY_GOVERNANCE_HISTORY_CONFLICT_REVIEW_FORMAT) {
    return null;
  }
  if (containsRawReplayGovernanceHistoryReviewPayload(value)) {
    return null;
  }
  const conflicts = Array.isArray(value.conflicts)
    ? value.conflicts
        .map(normalizeReplayGovernanceHistoryConflictReview)
        .filter((conflict): conflict is ReplayGovernanceHistoryConflictReview => conflict !== null)
    : [];
  const resolutionHistory = Array.isArray(value.resolutionHistory)
    ? normalizeReplayGovernanceHistoryResolutionHistory(value.resolutionHistory)
    : [];
  return buildReplayGovernanceHistoryConflictReviewPackageFromParts(
    normalizeString(readString(value.flowId), 160) || fallbackFlowId,
    conflicts,
    resolutionHistory,
  );
}

function normalizeReplayGovernanceHistoryConflictReview(
  value: unknown,
): ReplayGovernanceHistoryConflictReview | null {
  if (!isRecord(value) || "snapshots" in value || "snapshot" in value || "evidence" in value) {
    return null;
  }
  const conflictId = normalizeString(readString(value.conflictId), 160);
  const conflictKey = normalizeString(readString(value.conflictKey), 500);
  const scenarioId = normalizeString(readString(value.scenarioId), 160);
  const refs = Array.isArray(value.refs)
    ? value.refs
        .map(normalizeReplayGovernanceHistoryConflictRef)
        .filter((ref): ref is ReplayGovernanceHistoryConflictRef => ref !== null)
        .slice(0, 16)
    : [];
  if (!conflictId || !conflictKey || !scenarioId || !refs.length) {
    return null;
  }
  return {
    conflictId,
    status: "open",
    conflictKey,
    scenarioId,
    scenarioLabel: normalizeString(readString(value.scenarioLabel), 240) || refs[0]?.scenarioLabel || "Cenário",
    snapshotCount: readNonNegativeInteger(value.snapshotCount || refs.length),
    snapshotHashes: Array.isArray(value.snapshotHashes)
      ? uniqueSortedText(value.snapshotHashes.map(readString).filter((hash): hash is string => Boolean(hash)))
      : uniqueSortedText(refs.map((ref) => ref.snapshotHash)),
    latestSnapshotHash: normalizeString(readString(value.latestSnapshotHash), 128) || refs[0]?.snapshotHash || "",
    latestCapturedAt: readIsoDate(value.latestCapturedAt) ?? refs[0]?.capturedAt ?? new Date().toISOString(),
    refs,
    curationThread: normalizeReplayGovernanceHistoryConflictCurationThread(value.curationThread),
    governance: {
      excludesSnapshots: true,
      excludesRawScenarioPayload: true,
      excludesRawPinPayloads: true,
      excludesRawCheckpointState: true,
      excludesSecretValues: true,
      includesOnlyRefsAndCuration: true,
    },
  };
}

function containsRawReplayGovernanceHistoryReviewPayload(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(containsRawReplayGovernanceHistoryReviewPayload);
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (
      key === "snapshots" ||
      key === "snapshot" ||
      key === "evidence" ||
      key === "rawScenarioPayload" ||
      key === "scenarioPayload" ||
      key === "pinPayload" ||
      key === "pinPayloads" ||
      key === "checkpoint" ||
      key === "checkpointState" ||
      key === "payload" ||
      key === "input" ||
      key === "output" ||
      key === "state"
    ) {
      return true;
    }
    if (containsRawReplayGovernanceHistoryReviewPayload(child)) {
      return true;
    }
  }
  return false;
}

function buildReplayGovernanceHistoryConflictReviewDiffPackage(
  current: ReplayGovernanceHistoryConflictReviewPackage,
  incoming: ReplayGovernanceHistoryConflictReviewPackage,
): Record<string, unknown> {
  const sections = [
    buildReplayGovernanceHistoryConflictReviewSummaryDiffSection(current, incoming),
    buildReplayGovernanceHistoryConflictReviewConflictDiffSection(current, incoming),
    buildReplayGovernanceHistoryConflictReviewResolutionDiffSection(current, incoming),
  ];
  const changedConflictItems = sections[1].items.filter((item) => item.status === "changed").length;
  const onlyCurrentConflictItems = sections[1].items.filter((item) => item.status === "only_current").length;
  const onlyIncomingConflictItems = sections[1].items.filter((item) => item.status === "only_incoming").length;
  const changedResolutionItems = sections[2].items.filter((item) => item.status !== "same").length;
  const changedSectionCount = sections.filter((section) => section.status === "changed").length;
  const summaryStatus = changedSectionCount ? "changed" : "same";
  const base = {
    format: REPLAY_GOVERNANCE_HISTORY_CONFLICT_REVIEW_DIFF_FORMAT,
    generatedAt: new Date().toISOString(),
    flowId: current.flowId,
    current: replayGovernanceHistoryConflictReviewPackageRef(current),
    incoming: replayGovernanceHistoryConflictReviewPackageRef(incoming),
    summary: {
      status: summaryStatus,
      statusLabel: summaryStatus === "changed" ? "alterado" : "igual",
      headline: summaryStatus === "changed"
        ? `${changedSectionCount} seção(ões) divergente(s), ${onlyCurrentConflictItems} conflito(s) só no atual e ${onlyIncomingConflictItems} só no importado`
        : "Revisões de conflitos de replay equivalentes",
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
      excludesRawScenarioPayload: true,
      excludesRawPinPayloads: true,
      excludesRawCheckpointState: true,
      excludesSecretValues: true,
      includesOnlyRefsThreadsAndResolutionHistory: true,
    },
  };
  return {
    ...base,
    packageHash: shortHash(stableStringify(base)),
  };
}

function replayGovernanceHistoryConflictReviewPackageRef(
  packageValue: ReplayGovernanceHistoryConflictReviewPackage,
): Record<string, unknown> {
  return {
    packageHash: packageValue.packageHash,
    conflictCount: packageValue.conflictCount,
    resolutionHistoryCount: packageValue.resolutionHistoryCount,
  };
}

function buildReplayGovernanceHistoryConflictReviewSummaryDiffSection(
  current: ReplayGovernanceHistoryConflictReviewPackage,
  incoming: ReplayGovernanceHistoryConflictReviewPackage,
): ReplayGovernanceHistoryConflictReviewDiffSection {
  return buildReplayGovernanceHistoryConflictReviewDiffSection("summary", "Resumo", [
    buildReplayGovernanceHistoryConflictReviewCountItem("conflicts", "Conflitos", current.conflictCount, incoming.conflictCount),
    buildReplayGovernanceHistoryConflictReviewCountItem("scenarios", "Cenários", current.summary.scenarioCount, incoming.summary.scenarioCount),
    buildReplayGovernanceHistoryConflictReviewCountItem("assigned", "Curadorias atribuídas", current.summary.assignedConflictCount, incoming.summary.assignedConflictCount),
    buildReplayGovernanceHistoryConflictReviewCountItem("unassigned", "Curadorias livres", current.summary.unassignedConflictCount, incoming.summary.unassignedConflictCount),
    buildReplayGovernanceHistoryConflictReviewCountItem("approved", "Aprovar snapshot", current.summary.approvedDecisionCount, incoming.summary.approvedDecisionCount),
    buildReplayGovernanceHistoryConflictReviewCountItem("needs-review", "Revisar antes de promover", current.summary.needsReviewDecisionCount, incoming.summary.needsReviewDecisionCount),
    buildReplayGovernanceHistoryConflictReviewCountItem("monitor", "Monitorar próximo run", current.summary.monitorDecisionCount, incoming.summary.monitorDecisionCount),
    buildReplayGovernanceHistoryConflictReviewCountItem("resolutions", "Histórico de resoluções", current.resolutionHistoryCount, incoming.resolutionHistoryCount),
  ]);
}

function buildReplayGovernanceHistoryConflictReviewConflictDiffSection(
  current: ReplayGovernanceHistoryConflictReviewPackage,
  incoming: ReplayGovernanceHistoryConflictReviewPackage,
): ReplayGovernanceHistoryConflictReviewDiffSection {
  const currentById = new Map(current.conflicts.map((conflict) => [conflict.conflictId, conflict]));
  const incomingById = new Map(incoming.conflicts.map((conflict) => [conflict.conflictId, conflict]));
  const ids = uniqueSortedText([...currentById.keys(), ...incomingById.keys()]);
  const items = ids.map((id): ReplayGovernanceHistoryConflictReviewDiffItem => {
    const currentConflict = currentById.get(id);
    const incomingConflict = incomingById.get(id);
    const status = replayGovernanceHistoryConflictReviewItemStatus(currentConflict, incomingConflict);
    return {
      id,
      label: currentConflict?.scenarioLabel || incomingConflict?.scenarioLabel || id,
      status,
      current: currentConflict ? replayGovernanceHistoryConflictReviewItemSummary(currentConflict) : "ausente",
      incoming: incomingConflict ? replayGovernanceHistoryConflictReviewItemSummary(incomingConflict) : "ausente",
      delta: (incomingConflict?.snapshotCount ?? 0) - (currentConflict?.snapshotCount ?? 0),
    };
  });
  return buildReplayGovernanceHistoryConflictReviewDiffSection("conflicts", "Conflitos", items);
}

function buildReplayGovernanceHistoryConflictReviewResolutionDiffSection(
  current: ReplayGovernanceHistoryConflictReviewPackage,
  incoming: ReplayGovernanceHistoryConflictReviewPackage,
): ReplayGovernanceHistoryConflictReviewDiffSection {
  const currentById = new Map(current.resolutionHistory.map((record) => [record.resolutionId, record]));
  const incomingById = new Map(incoming.resolutionHistory.map((record) => [record.resolutionId, record]));
  const ids = uniqueSortedText([...currentById.keys(), ...incomingById.keys()]);
  const items = ids.map((id): ReplayGovernanceHistoryConflictReviewDiffItem => {
    const currentRecord = currentById.get(id);
    const incomingRecord = incomingById.get(id);
    const status = replayGovernanceHistoryResolutionReviewItemStatus(currentRecord, incomingRecord);
    return {
      id,
      label: currentRecord?.scenarioLabel || incomingRecord?.scenarioLabel || id,
      status,
      current: currentRecord ? replayGovernanceHistoryResolutionReviewItemSummary(currentRecord) : "ausente",
      incoming: incomingRecord ? replayGovernanceHistoryResolutionReviewItemSummary(incomingRecord) : "ausente",
      delta: (incomingRecord?.candidateCount ?? 0) - (currentRecord?.candidateCount ?? 0),
    };
  });
  return buildReplayGovernanceHistoryConflictReviewDiffSection("resolution-history", "Histórico de resolução", items);
}

function buildReplayGovernanceHistoryConflictReviewDiffSection(
  id: string,
  title: string,
  items: ReplayGovernanceHistoryConflictReviewDiffItem[],
): ReplayGovernanceHistoryConflictReviewDiffSection {
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

function buildReplayGovernanceHistoryConflictReviewCountItem(
  id: string,
  label: string,
  current: number,
  incoming: number,
): ReplayGovernanceHistoryConflictReviewDiffItem {
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

function replayGovernanceHistoryConflictReviewItemStatus(
  current: ReplayGovernanceHistoryConflictReview | undefined,
  incoming: ReplayGovernanceHistoryConflictReview | undefined,
): ReplayGovernanceHistoryConflictReviewDiffItemStatus {
  if (!current) {
    return "only_incoming";
  }
  if (!incoming) {
    return "only_current";
  }
  return replayGovernanceHistoryConflictReviewSignature(current) === replayGovernanceHistoryConflictReviewSignature(incoming)
    ? "same"
    : "changed";
}

function replayGovernanceHistoryResolutionReviewItemStatus(
  current: ReplayGovernanceHistoryResolutionRecord | undefined,
  incoming: ReplayGovernanceHistoryResolutionRecord | undefined,
): ReplayGovernanceHistoryConflictReviewDiffItemStatus {
  if (!current) {
    return "only_incoming";
  }
  if (!incoming) {
    return "only_current";
  }
  return stableStringify(current) === stableStringify(incoming) ? "same" : "changed";
}

function replayGovernanceHistoryConflictReviewSignature(
  conflict: ReplayGovernanceHistoryConflictReview,
): string {
  return shortHash(stableStringify({
    conflictKey: conflict.conflictKey,
    scenarioId: conflict.scenarioId,
    snapshotCount: conflict.snapshotCount,
    snapshotHashes: conflict.snapshotHashes,
    latestSnapshotHash: conflict.latestSnapshotHash,
    refs: conflict.refs,
    curationThread: conflict.curationThread,
  }));
}

function replayGovernanceHistoryConflictReviewItemSummary(
  conflict: ReplayGovernanceHistoryConflictReview,
): string {
  return `${conflict.scenarioLabel} · ${conflict.snapshotCount} snapshot(s) · ${conflict.latestSnapshotHash.slice(0, 10)} · ${conflict.curationThread.status}`;
}

function replayGovernanceHistoryResolutionReviewItemSummary(
  record: ReplayGovernanceHistoryResolutionRecord,
): string {
  return `${record.scenarioLabel} · manter ${record.keptSnapshotHash.slice(0, 10)} · ${record.candidateCount} candidato(s) · ${record.resolvedBy}`;
}

function mergeReplayGovernanceHistorySnapshots(
  existingSnapshots: unknown[],
  incomingSnapshots: unknown[],
): {
  snapshots: ReplayGovernanceHistorySnapshot[];
  stats: ReplayHistoryMergeStats;
} {
  const existing = syncReplayGovernanceHistorySnapshots(existingSnapshots);
  const incoming = syncReplayGovernanceHistorySnapshots(incomingSnapshots);
  const byHash = new Map(existing.map((snapshot) => [snapshot.snapshotHash, snapshot]));
  let addedCount = 0;
  let unchangedCount = 0;
  for (const incomingSnapshot of incoming) {
    if (byHash.has(incomingSnapshot.snapshotHash)) {
      unchangedCount += 1;
      continue;
    }
    addedCount += 1;
    byHash.set(incomingSnapshot.snapshotHash, incomingSnapshot);
  }
  const snapshots = syncReplayGovernanceHistorySnapshots(Array.from(byHash.values()));
  return {
    snapshots,
    stats: {
      incomingCount: incoming.length,
      existingCount: existing.length,
      addedCount,
      unchangedCount,
      finalCount: snapshots.length,
    },
  };
}

function applyReplayGovernanceHistoryResolutionHistory(
  snapshots: ReplayGovernanceHistorySnapshot[],
  history: ReplayGovernanceHistoryResolutionRecord[],
): ReplayGovernanceHistorySnapshot[] {
  if (!history.length || snapshots.length < 2) {
    return sortReplayGovernanceHistorySnapshots(snapshots);
  }
  const sortedHistory = [...history].sort((left, right) => right.resolvedAt.localeCompare(left.resolvedAt));
  let currentSnapshots = sortReplayGovernanceHistorySnapshots(snapshots);
  for (const record of sortedHistory) {
    const keptSnapshot = currentSnapshots.find((snapshot) =>
      replayGovernanceHistorySnapshotMatchesConflictRef(snapshot, record.keptRef),
    );
    if (!keptSnapshot) {
      continue;
    }
    currentSnapshots = currentSnapshots.filter((snapshot) => {
      if (replayGovernanceHistorySnapshotMatchesConflictRef(snapshot, record.keptRef)) {
        return true;
      }
      return !record.discardedRefs.some((ref) => replayGovernanceHistorySnapshotMatchesConflictRef(snapshot, ref));
    });
  }
  return sortReplayGovernanceHistorySnapshots(currentSnapshots);
}

function replayGovernanceHistorySnapshotMatchesConflictRef(
  snapshot: ReplayGovernanceHistorySnapshot,
  ref: ReplayGovernanceHistoryConflictRef,
): boolean {
  return (
    snapshot.snapshotHash === ref.snapshotHash &&
    snapshot.packageHash === ref.packageHash &&
    snapshot.capturedAt === ref.capturedAt &&
    snapshot.scenario.id === ref.scenarioId
  );
}

function buildReplayGovernanceHistoryResolutionRecord(
  conflict: ReplayGovernanceHistoryConflict,
  keptSnapshotHash: string,
  resolvedBy: string,
  resolvedRole: ReplayGovernanceHistoryConflictCuratorRole,
  resolutionNote: string,
): ReplayGovernanceHistoryResolutionRecord {
  const resolvedAt = new Date().toISOString();
  const keptRef = conflict.refs.find((ref) => ref.snapshotHash === keptSnapshotHash) ?? conflict.refs[0];
  const discardedRefs = conflict.refs.filter((ref) => ref.snapshotHash !== keptRef.snapshotHash);
  return {
    resolutionId: `replay-governance-resolution-${shortHash(
      stableStringify({
        conflictId: conflict.conflictId,
        keptSnapshotHash: keptRef.snapshotHash,
        discardedRefs,
        resolvedBy,
        resolvedRole,
        resolvedAt,
      }),
    )}`,
    conflictId: conflict.conflictId,
    conflictKey: conflict.conflictKey,
    scenarioId: conflict.scenarioId,
    scenarioLabel: conflict.scenarioLabel,
    resolvedAt,
    resolvedBy,
    resolvedRole,
    resolutionNote,
    keptSnapshotHash: keptRef.snapshotHash,
    keptRef,
    discardedRefs,
    candidateCount: conflict.snapshotCount,
    governance: {
      excludesRawScenarioPayload: true,
      excludesRawPinPayloads: true,
      excludesRawCheckpointState: true,
      excludesSecretValues: true,
    },
  };
}

function mergeReplayGovernanceHistoryResolutionHistory(
  existing: unknown[],
  incoming: unknown[],
): ReplayGovernanceHistoryResolutionRecord[] {
  const byId = new Map<string, ReplayGovernanceHistoryResolutionRecord>();
  for (const record of [
    ...normalizeReplayGovernanceHistoryResolutionHistory(existing),
    ...normalizeReplayGovernanceHistoryResolutionHistory(incoming),
  ]) {
    const current = byId.get(record.resolutionId);
    if (!current || record.resolvedAt.localeCompare(current.resolvedAt) >= 0) {
      byId.set(record.resolutionId, record);
    }
  }
  return Array.from(byId.values()).sort((left, right) => right.resolvedAt.localeCompare(left.resolvedAt));
}

function normalizeReplayGovernanceHistoryResolutionHistory(value: unknown[]): ReplayGovernanceHistoryResolutionRecord[] {
  return value
    .map(normalizeReplayGovernanceHistoryResolutionRecord)
    .filter((record): record is ReplayGovernanceHistoryResolutionRecord => record !== null)
    .sort((left, right) => right.resolvedAt.localeCompare(left.resolvedAt));
}

function normalizeReplayGovernanceHistoryResolutionRecord(value: unknown): ReplayGovernanceHistoryResolutionRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const conflictId = normalizeString(readString(value.conflictId), 160);
  const conflictKey = normalizeString(readString(value.conflictKey), 500);
  const scenarioId = normalizeString(readString(value.scenarioId), 160);
  const scenarioLabel = normalizeString(readString(value.scenarioLabel), 240);
  const resolvedAt = readIsoDate(value.resolvedAt);
  const keptSnapshotHash = normalizeString(readString(value.keptSnapshotHash), 128);
  const keptRef = normalizeReplayGovernanceHistoryConflictRef(value.keptRef);
  if (!conflictId || !resolvedAt || !keptSnapshotHash || !keptRef) {
    return null;
  }
  const discardedRefs = Array.isArray(value.discardedRefs)
    ? value.discardedRefs
        .map(normalizeReplayGovernanceHistoryConflictRef)
        .filter((ref): ref is ReplayGovernanceHistoryConflictRef => ref !== null)
    : [];
  const resolutionId =
    normalizeString(readString(value.resolutionId), 180) ||
    `replay-governance-resolution-${shortHash(
      stableStringify({ conflictId, keptSnapshotHash, discardedRefs, resolvedAt }),
    )}`;
  return {
    resolutionId,
    conflictId,
    conflictKey,
    scenarioId: scenarioId || keptRef.scenarioId,
    scenarioLabel: scenarioLabel || keptRef.scenarioLabel,
    resolvedAt,
    resolvedBy: normalizeString(readString(value.resolvedBy), 120) || "local-studio",
    resolvedRole: normalizeReplayGovernanceHistoryConflictCuratorRole(value.resolvedRole ?? value.role),
    resolutionNote: normalizeString(readString(value.resolutionNote), 280),
    keptSnapshotHash,
    keptRef,
    discardedRefs,
    candidateCount: readNonNegativeInteger(value.candidateCount || discardedRefs.length + 1),
    governance: {
      excludesRawScenarioPayload: true,
      excludesRawPinPayloads: true,
      excludesRawCheckpointState: true,
      excludesSecretValues: true,
    },
  };
}

function normalizeReplayGovernanceHistoryConflictRef(value: unknown): ReplayGovernanceHistoryConflictRef | null {
  if (!isRecord(value)) {
    return null;
  }
  const snapshotHash = normalizeString(readString(value.snapshotHash), 128);
  const packageHash = normalizeString(readString(value.packageHash), 128);
  const capturedAt = readIsoDate(value.capturedAt);
  const scenarioId = normalizeString(readString(value.scenarioId), 160);
  if (!snapshotHash || !packageHash || !capturedAt || !scenarioId) {
    return null;
  }
  return {
    snapshotHash,
    packageHash,
    capturedAt,
    scenarioId,
    scenarioLabel: normalizeString(readString(value.scenarioLabel), 240) || "Cenário",
    sourceKind: normalizeReplayScenarioSourceKind(value.sourceKind),
    sourceRunId: readString(value.sourceRunId),
    sourceNodeId: readString(value.sourceNodeId),
    sourceEventSeq: readNumber(value.sourceEventSeq),
    reviewStatus: normalizeReplayGovernanceReviewStatus(value.reviewStatus),
    reviewDecision: normalizeReplayGovernanceReviewDecision(value.reviewDecision),
    reviewer: normalizeString(readString(value.reviewer), 120) || "local-user",
    statusLabel: normalizeString(readString(value.statusLabel), 120) || "em monitoramento",
  };
}

function buildReplayGovernanceHistoryConflicts(
  flowId: string,
  snapshots: ReplayGovernanceHistorySnapshot[],
  previousConflicts: unknown[] = [],
): ReplayGovernanceHistoryConflict[] {
  const previousCurationById = mergeReplayGovernanceHistoryConflictCurationById(previousConflicts);
  const byConflictKey = new Map<string, ReplayGovernanceHistorySnapshot[]>();
  for (const snapshot of snapshots) {
    const conflictKey = replayGovernanceHistoryConflictKey(snapshot);
    const current = byConflictKey.get(conflictKey) ?? [];
    current.push(snapshot);
    byConflictKey.set(conflictKey, current);
  }
  const conflicts: ReplayGovernanceHistoryConflict[] = [];
  for (const [conflictKey, conflictSnapshots] of byConflictKey) {
    const reviewHashes = new Set(conflictSnapshots.map(replayGovernanceHistoryReviewHash));
    if (reviewHashes.size < 2) {
      continue;
    }
    const sorted = sortReplayGovernanceHistorySnapshots(conflictSnapshots);
    const latest = sorted[0];
    const conflictId = `replay-governance-conflict-${shortHash(stableStringify({ flowId, conflictKey }))}`;
    conflicts.push({
      conflictId,
      status: "open",
      conflictKey,
      scenarioId: latest.scenario.id,
      scenarioLabel: latest.scenario.label,
      snapshotCount: sorted.length,
      snapshotHashes: sorted.map((snapshot) => snapshot.snapshotHash),
      latestSnapshotHash: latest.snapshotHash,
      latestCapturedAt: latest.capturedAt,
      refs: sorted.map(replayGovernanceHistoryConflictRef),
      curationThread:
        previousCurationById.get(conflictId) ?? defaultReplayGovernanceHistoryConflictCurationThread(),
      governance: {
        excludesRawScenarioPayload: true,
        excludesRawPinPayloads: true,
        excludesRawCheckpointState: true,
        excludesSecretValues: true,
      },
    });
  }
  return conflicts.sort((left, right) => right.latestCapturedAt.localeCompare(left.latestCapturedAt));
}

function mergeReplayGovernanceHistoryConflictCurationById(
  conflicts: unknown[],
): Map<string, ReplayGovernanceHistoryConflictCurationThread> {
  const byId = new Map<string, ReplayGovernanceHistoryConflictCurationThread>();
  for (const conflict of conflicts) {
    if (!isRecord(conflict)) {
      continue;
    }
    const conflictId = readString(conflict.conflictId);
    if (!conflictId) {
      continue;
    }
    const current = byId.get(conflictId) ?? defaultReplayGovernanceHistoryConflictCurationThread();
    const incoming = normalizeReplayGovernanceHistoryConflictCurationThread(conflict.curationThread);
    byId.set(conflictId, mergeReplayGovernanceHistoryConflictCurationThreads(current, incoming));
  }
  return byId;
}

function mergeReplayGovernanceHistoryConflictCurationThreads(
  left: ReplayGovernanceHistoryConflictCurationThread,
  right: ReplayGovernanceHistoryConflictCurationThread,
): ReplayGovernanceHistoryConflictCurationThread {
  const leftTime = left.updatedAt ? Date.parse(left.updatedAt) : 0;
  const rightTime = right.updatedAt ? Date.parse(right.updatedAt) : 0;
  const winner = rightTime >= leftTime ? right : left;
  return normalizeReplayGovernanceHistoryConflictCurationThread({
    ...winner,
    events: mergeReplayGovernanceHistoryConflictCurationEvents(left.events, right.events),
  });
}

function normalizeReplayGovernanceHistoryConflictCurationAction(
  value: unknown,
): ReplayGovernanceHistoryConflictCurationAction | null {
  return value === "assign" || value === "release" ? value : null;
}

function normalizeReplayGovernanceHistoryConflictCurationLastAction(
  value: unknown,
): ReplayGovernanceHistoryConflictCurationLastAction | null {
  return value === "lease_expired" ? value : normalizeReplayGovernanceHistoryConflictCurationAction(value);
}

function normalizeReplayGovernanceHistoryConflictCuratorRole(value: unknown): ReplayGovernanceHistoryConflictCuratorRole {
  if (value === "owner" || value === "viewer") {
    return value;
  }
  return "reviewer";
}

function resolveReplayGovernanceHistoryConflictCuratorRole(payload: unknown): ReplayGovernanceHistoryConflictCuratorRole {
  if (!isRecord(payload)) {
    return normalizeReplayGovernanceHistoryConflictCuratorRole(payload);
  }
  return normalizeReplayGovernanceHistoryConflictCuratorRole(payload.role ?? payload.resolvedRole);
}

function assertReplayGovernanceHistoryConflictMutationAllowed(
  role: ReplayGovernanceHistoryConflictCuratorRole,
  action: string,
): void {
  if (role !== "viewer") {
    return;
  }
  throw new WorkspaceError(`Viewer não pode ${action}.`, 403, {
    code: "replay_governance_history_conflict_viewer_forbidden",
    role,
    requiredRole: "reviewer",
  });
}

function defaultReplayGovernanceHistoryConflictCurationThread(): ReplayGovernanceHistoryConflictCurationThread {
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
      excludesRawScenarioPayload: true,
      excludesRawPinPayloads: true,
      excludesRawCheckpointState: true,
      excludesSecretValues: true,
      autoReleasesExpiredAssignments: true,
      configuredLeaseHoursEnv: REPLAY_GOVERNANCE_HISTORY_CONFLICT_CURATION_LEASE_HOURS_ENV,
    },
  };
}

function normalizeReplayGovernanceHistoryConflictCurationThread(
  value: unknown,
): ReplayGovernanceHistoryConflictCurationThread {
  const source = isRecord(value) ? value : {};
  const assignee = normalizeString(readString(source.assignee), 120);
  const status: ReplayGovernanceHistoryConflictCurationStatus =
    source.status === "assigned" || assignee ? "assigned" : "unassigned";
  const updatedAt = readIsoDate(source.updatedAt);
  const leaseDurationHours = normalizeReplayGovernanceHistoryConflictCurationLeaseHours(source.leaseDurationHours);
  const leaseExpiresAt =
    status === "assigned"
      ? readIsoDate(source.leaseExpiresAt) ?? (updatedAt ? addHoursIso(updatedAt, leaseDurationHours) : null)
      : null;
  return expireReplayGovernanceHistoryConflictCurationThreadIfNeeded({
    status,
    assignee: status === "assigned" ? assignee : "",
    openedAt: readIsoDate(source.openedAt),
    updatedAt,
    lastActor: normalizeString(readString(source.lastActor), 120),
    lastAction: normalizeReplayGovernanceHistoryConflictCurationLastAction(source.lastAction),
    note: normalizeString(readString(source.note), 280),
    leaseExpiresAt,
    leaseDurationHours: status === "assigned" ? leaseDurationHours : null,
    leaseExpired: status !== "assigned" && source.leaseExpired === true,
    events: Array.isArray(source.events)
      ? source.events
          .map(normalizeReplayGovernanceHistoryConflictCurationEvent)
          .filter((event): event is ReplayGovernanceHistoryConflictCurationEvent => event !== null)
          .sort((left, right) => right.at.localeCompare(left.at))
          .slice(0, 12)
      : [],
    governance: {
      excludesRawScenarioPayload: true,
      excludesRawPinPayloads: true,
      excludesRawCheckpointState: true,
      excludesSecretValues: true,
      autoReleasesExpiredAssignments: true,
      configuredLeaseHoursEnv: REPLAY_GOVERNANCE_HISTORY_CONFLICT_CURATION_LEASE_HOURS_ENV,
    },
  });
}

function normalizeReplayGovernanceHistoryConflictCurationEvent(
  value: unknown,
): ReplayGovernanceHistoryConflictCurationEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  const at = readIsoDate(value.at);
  const actor = normalizeString(readString(value.actor), 120);
  const action = normalizeReplayGovernanceHistoryConflictCurationLastAction(value.action);
  if (!at || !actor || !action) {
    return null;
  }
  const role = normalizeReplayGovernanceHistoryConflictCuratorRole(value.role);
  const assignee = normalizeString(readString(value.assignee), 120);
  const note = normalizeString(readString(value.note), 280);
  return {
    id:
      normalizeString(readString(value.id), 160) ||
      `replay-governance-conflict-curation-${shortHash(stableStringify({ at, actor, role, action, assignee, note }))}`,
    at,
    actor,
    role,
    action,
    assignee,
    note,
  };
}

function mergeReplayGovernanceHistoryConflictCurationEvents(
  existing: ReplayGovernanceHistoryConflictCurationEvent[],
  incoming: ReplayGovernanceHistoryConflictCurationEvent[],
): ReplayGovernanceHistoryConflictCurationEvent[] {
  const byId = new Map<string, ReplayGovernanceHistoryConflictCurationEvent>();
  for (const event of [...existing, ...incoming]) {
    byId.set(event.id, event);
  }
  return Array.from(byId.values())
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, 12);
}

function buildReplayGovernanceHistoryConflictCurationEvent(
  action: ReplayGovernanceHistoryConflictCurationLastAction,
  actor: string,
  role: ReplayGovernanceHistoryConflictCuratorRole,
  assignee: string,
  note: string,
  at: string,
): ReplayGovernanceHistoryConflictCurationEvent {
  const normalizedNote = note.trim().slice(0, 280);
  return {
    id: `replay-governance-conflict-curation-${shortHash(
      stableStringify({ at, actor, role, action, assignee, note: normalizedNote }),
    )}`,
    at,
    actor,
    role,
    action,
    assignee,
    note: normalizedNote,
  };
}

function updateReplayGovernanceHistoryConflictCurationThread(
  value: unknown,
  action: ReplayGovernanceHistoryConflictCurationAction,
  actor: string,
  role: ReplayGovernanceHistoryConflictCuratorRole,
  note: string,
  updatedAt: string,
): ReplayGovernanceHistoryConflictCurationThread {
  const current = normalizeReplayGovernanceHistoryConflictCurationThread(value);
  if (action === "release") {
    const event = buildReplayGovernanceHistoryConflictCurationEvent("release", actor, role, "", note, updatedAt);
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
      events: mergeReplayGovernanceHistoryConflictCurationEvents([event], current.events),
    };
  }
  const leaseDurationHours = readReplayGovernanceHistoryConflictCurationLeaseHours();
  const event = buildReplayGovernanceHistoryConflictCurationEvent("assign", actor, role, actor, note, updatedAt);
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
    events: mergeReplayGovernanceHistoryConflictCurationEvents([event], current.events),
  };
}

function expireReplayGovernanceHistoryConflictCurationThreadIfNeeded(
  thread: ReplayGovernanceHistoryConflictCurationThread,
): ReplayGovernanceHistoryConflictCurationThread {
  if (thread.status !== "assigned" || !thread.leaseExpiresAt) {
    return thread;
  }
  const expiresAt = Date.parse(thread.leaseExpiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt > Date.now()) {
    return thread;
  }
  const actor = thread.assignee || thread.lastActor || "local-studio";
  const note = thread.note || "Lease de curadoria expirado.";
  const event = buildReplayGovernanceHistoryConflictCurationEvent(
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
    events: mergeReplayGovernanceHistoryConflictCurationEvents([event], thread.events),
  };
}

function readReplayGovernanceHistoryConflictCurationLeaseHours(): number {
  const value = Number(process.env[REPLAY_GOVERNANCE_HISTORY_CONFLICT_CURATION_LEASE_HOURS_ENV] ?? "");
  if (!Number.isFinite(value) || value <= 0) {
    return REPLAY_GOVERNANCE_HISTORY_CONFLICT_CURATION_LEASE_HOURS;
  }
  return Math.min(Math.max(Math.floor(value), 1), 168);
}

function normalizeReplayGovernanceHistoryConflictCurationLeaseHours(value: unknown): number {
  const hours = readNumber(value);
  if (!hours || hours <= 0) {
    return readReplayGovernanceHistoryConflictCurationLeaseHours();
  }
  return Math.min(Math.max(Math.floor(hours), 1), 168);
}

function addHoursIso(value: string, hours: number): string {
  const base = Date.parse(value);
  const timestamp = Number.isFinite(base) ? base : Date.now();
  return new Date(timestamp + hours * 60 * 60 * 1000).toISOString();
}

function resolveReplayGovernanceHistoryConflictCurationActor(payload: unknown): string {
  if (!isRecord(payload)) {
    return "local-studio";
  }
  return normalizeString(
    readString(payload.actor) || readString(payload.assignee) || readString(payload.resolvedBy),
    120,
  ) || "local-studio";
}

function resolveReplayGovernanceHistoryConflictCurationNote(payload: unknown): string {
  return isRecord(payload) ? normalizeString(readString(payload.note), 280) : "";
}

function resolveReplayGovernanceHistoryConflictResolutionNote(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }
  return normalizeString(readString(payload.resolutionNote) || readString(payload.note), 280);
}

function replayGovernanceHistoryConflictKey(snapshot: ReplayGovernanceHistorySnapshot): string {
  return stableConflictKey([
    "replay",
    snapshot.flow.id,
    snapshot.flow.version,
    snapshot.flow.flowHash,
    snapshot.flow.projectHash ?? "-",
    snapshot.scenario.id,
    snapshot.scenario.sourceKind,
    snapshot.scenario.sourceAgentId,
    snapshot.scenario.sourceRunId ?? "-",
    snapshot.scenario.sourceNodeId ?? "-",
    String(snapshot.scenario.sourceEventSeq ?? "-"),
    String(snapshot.evidence.checkpointEventSeq ?? "-"),
    snapshot.evidence.checkpointNodeId ?? "-",
    snapshot.evidence.compatibilityLabel,
    snapshot.evidence.restoreObserved ? "restore-observed" : "restore-pending",
    String(snapshot.evidence.activePinCount),
    String(snapshot.evidence.stalePinCount),
    shortHash(stableStringify(snapshot.comparison)),
  ]);
}

function replayGovernanceHistoryReviewHash(snapshot: ReplayGovernanceHistorySnapshot): string {
  return shortHash(stableStringify(snapshot.review));
}

function replayGovernanceHistoryConflictRef(snapshot: ReplayGovernanceHistorySnapshot): ReplayGovernanceHistoryConflictRef {
  return {
    snapshotHash: snapshot.snapshotHash,
    packageHash: snapshot.packageHash,
    capturedAt: snapshot.capturedAt,
    scenarioId: snapshot.scenario.id,
    scenarioLabel: snapshot.scenario.label,
    sourceKind: snapshot.scenario.sourceKind,
    sourceRunId: snapshot.scenario.sourceRunId,
    sourceNodeId: snapshot.scenario.sourceNodeId,
    sourceEventSeq: snapshot.scenario.sourceEventSeq,
    reviewStatus: snapshot.review.status,
    reviewDecision: snapshot.review.decision,
    reviewer: snapshot.review.reviewer,
    statusLabel: snapshot.review.statusLabel,
  };
}

function syncReplayGovernanceHistorySnapshots(snapshots: unknown[]): ReplayGovernanceHistorySnapshot[] {
  const byHash = new Map<string, ReplayGovernanceHistorySnapshot>();
  for (const snapshot of snapshots
    .map(normalizeReplayGovernanceHistorySnapshot)
    .filter((item): item is ReplayGovernanceHistorySnapshot => item !== null)) {
    byHash.set(snapshot.snapshotHash, snapshot);
  }
  return sortReplayGovernanceHistorySnapshots(Array.from(byHash.values()));
}

function sortReplayGovernanceHistorySnapshots(
  snapshots: ReplayGovernanceHistorySnapshot[],
): ReplayGovernanceHistorySnapshot[] {
  return [...snapshots].sort((left, right) => {
    const leftTime = Date.parse(left.capturedAt);
    const rightTime = Date.parse(right.capturedAt);
    if (leftTime !== rightTime) {
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    }
    return left.snapshotHash.localeCompare(right.snapshotHash);
  });
}

function normalizeReplayGovernanceHistorySnapshot(value: unknown): ReplayGovernanceHistorySnapshot | null {
  if (!isRecord(value) || !isRecord(value.flow) || !isRecord(value.scenario) || !isRecord(value.comparison)) {
    return null;
  }
  const items = Array.isArray(value.comparison.items)
    ? value.comparison.items
        .map(normalizeReplayGovernanceItem)
        .filter((item): item is ReplayGovernanceItem => item !== null)
    : [];
  const capturedAt = readIsoDate(value.capturedAt) ?? new Date().toISOString();
  const evidence = isRecord(value.evidence) ? value.evidence : {};
  const normalizedComparison = {
    status: normalizeReplayGovernanceStatus(value.comparison.status),
    statusLabel: readString(value.comparison.statusLabel) ?? "pendente",
    summary: readString(value.comparison.summary) ?? "sem resumo",
    items,
  };
  const normalizedEvidence = {
    checkpointEventSeq: readNumber(evidence.checkpointEventSeq),
    checkpointNodeId: readString(evidence.checkpointNodeId),
    compatibilityLabel: readString(evidence.compatibilityLabel) ?? "não verificado",
    restoreObserved: evidence.restoreObserved === true,
    activePinCount: readNonNegativeInteger(evidence.activePinCount),
    stalePinCount: readNonNegativeInteger(evidence.stalePinCount),
  };
  const base = {
    id: readString(value.id) ?? `replay-history-${capturedAt}`,
    capturedAt,
    packageHash: readString(value.packageHash) ?? "",
    flow: {
      id: readString(value.flow.id) ?? "unknown-flow",
      name: readString(value.flow.name) ?? "Flow",
      version: readString(value.flow.version) ?? "0.0.0",
      flowHash: readString(value.flow.flowHash) ?? "",
      projectHash: readString(value.flow.projectHash),
    },
    scenario: {
      id: readString(value.scenario.id) ?? "scenario",
      label: readString(value.scenario.label) ?? "Cenário",
      sourceKind: normalizeReplayScenarioSourceKind(value.scenario.sourceKind),
      sourceAgentId: readString(value.scenario.sourceAgentId) ?? "unknown-agent",
      sourceRunId: readString(value.scenario.sourceRunId),
      sourceNodeId: readString(value.scenario.sourceNodeId),
      sourceEventSeq: readNumber(value.scenario.sourceEventSeq),
      hasCheckpoint: value.scenario.hasCheckpoint === true,
      useNodePins: value.scenario.useNodePins === true,
      evaluatorKind: value.scenario.evaluatorKind === "external" ? "external" as const : "rules" as const,
      evaluatorRuleCount: readNonNegativeInteger(value.scenario.evaluatorRuleCount),
      payloadMode: value.scenario.payloadMode === "structured" ? "structured" as const : "text" as const,
    },
    comparison: normalizedComparison,
    review: normalizeReplayGovernanceReview(
      value.review,
      normalizedComparison,
      {
        compatibilityLabel: normalizedEvidence.compatibilityLabel,
        hasCheckpoint: value.scenario.hasCheckpoint === true,
        restoreObserved: normalizedEvidence.restoreObserved,
        stalePinCount: normalizedEvidence.stalePinCount,
      },
      capturedAt,
    ),
    evidence: normalizedEvidence,
  };
  return {
    ...base,
    snapshotHash: readString(value.snapshotHash) ?? shortHash(stableStringify(base)),
  };
}

function normalizeReplayGovernanceItem(value: unknown): ReplayGovernanceItem | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    id: readString(value.id) ?? "item",
    label: readString(value.label) ?? "Item",
    status: normalizeReplayGovernanceStatus(value.status),
    expected: readString(value.expected) ?? "",
    observed: readString(value.observed) ?? "",
    evidence: readString(value.evidence) ?? "",
    action: readString(value.action) ?? "",
  };
}

function normalizeReplayGovernanceReview(
  value: unknown,
  comparison: ReplayGovernanceComparison,
  evidence: {
    compatibilityLabel: string;
    hasCheckpoint: boolean;
    restoreObserved: boolean;
    stalePinCount: number;
  },
  fallbackReviewedAt: string,
): ReplayGovernanceReview {
  const fallback = buildReplayGovernanceReview(comparison, evidence, "local-user", fallbackReviewedAt);
  if (!isRecord(value)) {
    return fallback;
  }
  const reasons = Array.isArray(value.reasons)
    ? value.reasons.filter((reason): reason is string => typeof reason === "string" && reason.trim().length > 0)
    : fallback.reasons;
  return {
    status: normalizeReplayGovernanceReviewStatus(value.status),
    statusLabel: readString(value.statusLabel) ?? fallback.statusLabel,
    reviewer: readString(value.reviewer) ?? fallback.reviewer,
    reviewedAt: readIsoDate(value.reviewedAt) ?? fallback.reviewedAt,
    decision: normalizeReplayGovernanceReviewDecision(value.decision),
    summary: readString(value.summary) ?? fallback.summary,
    reasons,
    nextAction: readString(value.nextAction) ?? fallback.nextAction,
    governance: {
      excludesRawScenarioPayload: true,
      excludesRawPinPayloads: true,
      excludesRawCheckpointState: true,
      excludesSecretValues: true,
      source: "studio-replay-governance-review",
    },
  };
}

function buildReplayGovernanceReview(
  comparison: ReplayGovernanceComparison,
  evidence: {
    compatibilityLabel: string;
    hasCheckpoint: boolean;
    restoreObserved: boolean;
    stalePinCount: number;
  },
  reviewer: string,
  reviewedAt: string,
): ReplayGovernanceReview {
  const warningCount = comparison.items.filter((item) => item.status === "warning").length;
  const pendingCount = comparison.items.filter((item) => item.status === "pending").length;
  const reasons: string[] = [];
  if (warningCount > 0) {
    reasons.push(`${warningCount} camada(s) com atenção`);
  }
  if (pendingCount > 0) {
    reasons.push(`${pendingCount} camada(s) pendente(s)`);
  }
  if (evidence.compatibilityLabel.includes("incompatível") || evidence.compatibilityLabel.includes("parcial")) {
    reasons.push(evidence.compatibilityLabel);
  }
  if (evidence.hasCheckpoint && !evidence.restoreObserved) {
    reasons.push("restore ainda não observado");
  }
  if (evidence.stalePinCount > 0) {
    reasons.push(`${evidence.stalePinCount} pin(s) stale`);
  }
  if (reasons.length === 0) {
    reasons.push("checkpoint, pins, restore e evaluator consistentes no snapshot");
  }
  const status: ReplayGovernanceReview["status"] =
    warningCount > 0 || evidence.stalePinCount > 0 || evidence.compatibilityLabel.includes("incompatível")
      ? "needs_review"
      : pendingCount > 0 || (evidence.hasCheckpoint && !evidence.restoreObserved)
        ? "monitor"
        : "approved";
  return {
    status,
    statusLabel: status === "approved" ? "aprovada" : status === "needs_review" ? "precisa revisão" : "em monitoramento",
    reviewer: reviewer.trim() || "local-user",
    reviewedAt,
    decision: status === "approved" ? "approve_snapshot" : status === "needs_review" ? "review_before_promotion" : "monitor_next_run",
    summary: comparison.summary,
    reasons,
    nextAction: status === "approved"
      ? "compartilhar snapshot como evidência governada"
      : status === "needs_review"
        ? "revisar checkpoint/pins antes de promover o replay"
        : "executar novo replay e salvar outro snapshot",
    governance: {
      excludesRawScenarioPayload: true,
      excludesRawPinPayloads: true,
      excludesRawCheckpointState: true,
      excludesSecretValues: true,
      source: "studio-replay-governance-review",
    },
  };
}

function normalizeReplayGovernanceStatus(value: unknown): ReplayGovernanceStatus {
  return value === "ok" || value === "warning" || value === "pending" ? value : "pending";
}

function normalizeReplayGovernanceReviewStatus(value: unknown): ReplayGovernanceReview["status"] {
  return value === "approved" || value === "needs_review" || value === "monitor" ? value : "monitor";
}

function normalizeReplayGovernanceReviewDecision(value: unknown): ReplayGovernanceReview["decision"] {
  return value === "approve_snapshot" || value === "review_before_promotion" || value === "monitor_next_run"
    ? value
    : "monitor_next_run";
}

function normalizeReplayScenarioSourceKind(value: unknown): ReplayScenarioSourceKind {
  return value === "manual" ||
    value === "checkpoint_fork" ||
    value === "node_debug" ||
    value === "debug_replay" ||
    value === "fixture_import" ||
    value === "dataset_import"
    ? value
    : "manual";
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeString(value: string | null | undefined, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  return Number.isNaN(Date.parse(value)) ? null : value.trim();
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function uniqueSortedText(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  );
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

function stableConflictKey(parts: string[]): string {
  return parts.map((part) => part.trim().toLowerCase()).join("|");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateReplayGovernanceHistoryCentralUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new Error("URL inválida.", { cause: error });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("apenas HTTP(S) é aceito.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URL não pode conter usuário ou senha.");
  }
  return parsed.toString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isFileNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}
