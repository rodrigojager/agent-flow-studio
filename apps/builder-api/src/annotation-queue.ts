import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadFlowById, WorkspaceError } from "./workspace.ts";
import type { AgentFlow } from "@agent-flow-builder/flow-spec";

export type StudioAnnotationStatus = "pending" | "accepted" | "rejected";
export type StudioAnnotationResultStatus = "ok" | "error";
export type StudioAnnotationComparisonSeverity = "pass" | "warn" | "fail" | "missing" | "error";
export type StudioAnnotationConflictStatus = "open" | "resolved";
export type StudioAnnotationConflictResolution = "incoming" | "existing" | "manual";
export type StudioAnnotationConflictCurationStatus = "unassigned" | "assigned" | "resolved";
export type StudioAnnotationConflictCurationAction = "assign" | "release";
export type StudioAnnotationConflictCurationLastAction = StudioAnnotationConflictCurationAction | "resolve" | "lease_expired";
export type StudioAnnotationPermissionMode = "open" | "assignee_only";
export type StudioAnnotationReviewerRole = "owner" | "reviewer" | "viewer";
export type StudioAnnotationAuditAction =
  | "item_created"
  | "conflict_detected"
  | "conflict_curated"
  | "conflict_resolved"
  | "item_status_changed"
  | "item_assigned"
  | "item_note_updated"
  | "item_deleted"
  | "queue_imported"
  | "queue_synced";

export interface StudioAnnotationQueueItem {
  id: string;
  scenarioId: string;
  scenarioLabel: string;
  sessionId: string | null;
  runId: string | null;
  resultStatus: StudioAnnotationResultStatus;
  comparisonSeverity: StudioAnnotationComparisonSeverity;
  verdict: string;
  reasons: string[];
  observedOutput: string;
  batchHash: string;
  source: "batch-result" | "manual";
  status: StudioAnnotationStatus;
  assignee: string;
  reviewedBy: string;
  reviewedAt: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudioAnnotationQueueConflict {
  id: string;
  itemId: string;
  status: StudioAnnotationConflictStatus;
  resolution: StudioAnnotationConflictResolution;
  curationThread: StudioAnnotationConflictCurationThread;
  existingSnapshot: StudioAnnotationQueueItem;
  incomingSnapshot: StudioAnnotationQueueItem;
  existingStatus: StudioAnnotationStatus;
  incomingStatus: StudioAnnotationStatus;
  existingReviewer: string;
  incomingReviewer: string;
  existingAssignee: string;
  incomingAssignee: string;
  existingNote: string;
  incomingNote: string;
  existingUpdatedAt: string;
  incomingUpdatedAt: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string;
}

export interface StudioAnnotationQueueResolutionRef {
  itemId: string;
  status: StudioAnnotationStatus;
  reviewer: string;
  assignee: string;
  reviewedAt: string | null;
  noteHash: string;
  verdictHash: string;
  observedOutputHash: string;
  batchHash: string;
  updatedAt: string;
}

export interface StudioAnnotationQueueResolutionRecord {
  resolutionId: string;
  conflictId: string;
  itemId: string;
  resolvedAt: string;
  resolvedBy: string;
  resolution: StudioAnnotationConflictResolution;
  keptRef: StudioAnnotationQueueResolutionRef;
  discardedRefs: StudioAnnotationQueueResolutionRef[];
  candidateCount: number;
  governance: {
    excludesRawRunEvents: true;
    excludesObservedOutputs: true;
    excludesSecretValues: true;
  };
}

export interface StudioAnnotationConflictCurationThread {
  status: StudioAnnotationConflictCurationStatus;
  assignee: string;
  openedAt: string | null;
  updatedAt: string | null;
  lastActor: string;
  lastAction: StudioAnnotationConflictCurationLastAction | null;
  leaseExpiresAt: string | null;
  leaseDurationHours: number | null;
  leaseExpired: boolean;
  note: string;
  events: StudioAnnotationConflictCurationEvent[];
  governance: {
    excludesRawRunEvents: true;
    excludesObservedOutputs: true;
    excludesSecretValues: true;
    autoReleasesExpiredAssignments: true;
    configuredLeaseHoursEnv: typeof STUDIO_ANNOTATION_CONFLICT_CURATION_LEASE_HOURS_ENV;
  };
}

export interface StudioAnnotationConflictCurationEvent {
  id: string;
  at: string;
  actor: string;
  action: StudioAnnotationConflictCurationLastAction;
  assignee: string;
  note: string;
}

export interface StudioAnnotationQueueAuditEntry {
  id: string;
  action: StudioAnnotationAuditAction;
  itemId: string | null;
  conflictId: string | null;
  actor: string;
  at: string;
  summary: string;
  beforeStatus: StudioAnnotationStatus | null;
  afterStatus: StudioAnnotationStatus | null;
  beforeAssignee: string;
  afterAssignee: string;
}

export interface StudioAnnotationQueuePermissionPolicy {
  mode: StudioAnnotationPermissionMode;
  reviewers: StudioAnnotationQueueReviewer[];
  updatedAt: string;
  updatedBy: string;
}

export interface StudioAnnotationQueueReviewer {
  name: string;
  role: StudioAnnotationReviewerRole;
  updatedAt: string;
}

export interface StudioAnnotationQueueExport {
  format: "agent-flow-builder.annotation-queue.v1";
  exportedAt: string;
  flow: {
    id: string;
    name: string;
    version: string;
  };
  itemCount: number;
  pendingCount: number;
  acceptedCount: number;
  rejectedCount: number;
  assigneeCounts: Record<string, number>;
  reviewedCount: number;
  conflictCount: number;
  openConflictCount: number;
  conflicts: StudioAnnotationQueueConflict[];
  resolutionHistoryCount: number;
  resolutionHistory: StudioAnnotationQueueResolutionRecord[];
  auditCount: number;
  auditEntries: StudioAnnotationQueueAuditEntry[];
  permissionPolicy: StudioAnnotationQueuePermissionPolicy;
  items: StudioAnnotationQueueItem[];
}

export interface StudioAnnotationQueueCentralSyncStatus {
  format: typeof STUDIO_ANNOTATION_QUEUE_CENTRAL_STATUS_FORMAT;
  generatedAt: string;
  configured: boolean;
  urlConfigured: boolean;
  tokenConfigured: boolean;
  timeoutMs: number;
  invalidReason: string | null;
  lastSyncedAt: string | null;
  statusCode: number | null;
  pushedItemCount: number | null;
  pulledItemCount: number | null;
  error: string | null;
  governance: {
    excludesSecretValues: true;
    sendsAnnotationItems: true;
    sendsObservedOutputs: true;
    sendsRawRunEvents: false;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
    storesCentralToken: false;
    configuredUrlEnv: string;
    configuredTokenEnv: string;
    configuredTimeoutEnv: string;
    maxPayloadBytes: number;
  };
}

export interface StudioAnnotationQueueCentralSyncResult {
  format: typeof STUDIO_ANNOTATION_QUEUE_CENTRAL_SYNC_RESULT_FORMAT;
  flowId: string;
  queue: StudioAnnotationQueueExport;
  central: StudioAnnotationQueueCentralSyncStatus;
  pushedItemCount: number;
  pulledItemCount: number;
  governance: {
    excludesSecretValues: true;
    sendsAnnotationItems: true;
    sendsObservedOutputs: true;
    sendsRawRunEvents: false;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
  };
}

export interface StudioAnnotationQueueConflictSnapshotRef {
  itemId: string;
  scenarioId: string;
  scenarioLabel: string;
  sessionId: string | null;
  runId: string | null;
  resultStatus: StudioAnnotationResultStatus;
  comparisonSeverity: StudioAnnotationComparisonSeverity;
  status: StudioAnnotationStatus;
  reviewer: string;
  assignee: string;
  reviewedAt: string | null;
  noteHash: string;
  verdictHash: string;
  reasonsHash: string;
  observedOutputHash: string;
  batchHash: string;
  updatedAt: string;
  contentHash: string;
}

export interface StudioAnnotationQueueConflictReviewDifference {
  field: string;
  label: string;
  kind: "value" | "hash" | "time";
  existing: string;
  incoming: string;
  changed: boolean;
}

export interface StudioAnnotationQueueConflictReviewItem {
  id: string;
  itemId: string;
  status: StudioAnnotationConflictStatus;
  resolution: StudioAnnotationConflictResolution;
  existingRef: StudioAnnotationQueueConflictSnapshotRef;
  incomingRef: StudioAnnotationQueueConflictSnapshotRef;
  differenceCount: number;
  differences: StudioAnnotationQueueConflictReviewDifference[];
  curationThread: StudioAnnotationConflictCurationThread;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string;
  governance: {
    excludesSnapshots: true;
    excludesObservedOutputs: true;
    excludesVerdicts: true;
    excludesReasons: true;
    excludesSecretValues: true;
    includesOnlyRefsThreadsAndResolutionHistory: true;
  };
}

export interface StudioAnnotationQueueConflictReviewSummary {
  conflictCount: number;
  openConflictCount: number;
  resolvedConflictCount: number;
  assignedConflictCount: number;
  unassignedConflictCount: number;
  resolvedThreadCount: number;
  resolutionHistoryCount: number;
  itemCount: number;
}

export interface StudioAnnotationQueueConflictReviewPackage {
  format: typeof STUDIO_ANNOTATION_QUEUE_CONFLICT_REVIEW_FORMAT;
  generatedAt: string;
  flow: {
    id: string;
    name: string;
    version: string;
  };
  packageHash: string;
  conflictCount: number;
  openConflictCount: number;
  resolutionHistoryCount: number;
  conflicts: StudioAnnotationQueueConflictReviewItem[];
  resolutionHistory: StudioAnnotationQueueResolutionRecord[];
  summary: StudioAnnotationQueueConflictReviewSummary;
  governance: {
    excludesQueueItems: true;
    excludesSnapshots: true;
    excludesObservedOutputs: true;
    excludesVerdicts: true;
    excludesReasons: true;
    excludesSecretValues: true;
    includesOnlyRefsThreadsAndResolutionHistory: true;
    localWorkspaceFile: true;
  };
}

type StudioAnnotationQueueConflictReviewDiffItemStatus = "same" | "changed" | "only_current" | "only_incoming";

interface StudioAnnotationQueueConflictReviewDiffItem {
  id: string;
  label: string;
  status: StudioAnnotationQueueConflictReviewDiffItemStatus;
  statusLabel: string;
  currentHash?: string | null;
  incomingHash?: string | null;
  current?: number;
  incoming?: number;
  delta?: number;
}

interface StudioAnnotationQueueConflictReviewDiffSection {
  id: string;
  title: string;
  status: "same" | "changed";
  statusLabel: "igual" | "alterado";
  summary: string;
  items: StudioAnnotationQueueConflictReviewDiffItem[];
}

export interface StudioAnnotationQueueMutationContext {
  actorId?: string;
  enforcePermissions?: boolean;
}

const STUDIO_ANNOTATION_QUEUE_CENTRAL_SYNC_REQUEST_FORMAT = "agent-flow-builder.annotation-queue-central-sync-request.v1";
const STUDIO_ANNOTATION_QUEUE_CENTRAL_SYNC_RESULT_FORMAT = "agent-flow-builder.annotation-queue-central-sync-result.v1";
const STUDIO_ANNOTATION_QUEUE_CENTRAL_STATUS_FORMAT = "agent-flow-builder.annotation-queue-central-sync-status.v1";
const STUDIO_ANNOTATION_QUEUE_CONFLICT_REVIEW_FORMAT = "agent-flow-builder.annotation-queue-conflict-review.v1";
const STUDIO_ANNOTATION_QUEUE_CONFLICT_REVIEW_DIFF_FORMAT = "agent-flow-builder.annotation-queue-conflict-review-diff.v1";
const STUDIO_ANNOTATION_QUEUE_FILE = ".agent-flow/annotation-queue/queue.afannotations.json";
const STUDIO_ANNOTATION_QUEUE_CENTRAL_URL_ENV = "AGENT_FLOW_ANNOTATION_QUEUE_CENTRAL_URL";
const STUDIO_ANNOTATION_QUEUE_CENTRAL_TOKEN_ENV = "AGENT_FLOW_ANNOTATION_QUEUE_CENTRAL_TOKEN";
const STUDIO_ANNOTATION_QUEUE_CENTRAL_TIMEOUT_ENV = "AGENT_FLOW_ANNOTATION_QUEUE_CENTRAL_TIMEOUT_MS";
const STUDIO_ANNOTATION_CONFLICT_CURATION_LEASE_HOURS_ENV = "AGENT_FLOW_ANNOTATION_CONFLICT_CURATION_LEASE_HOURS";
const STUDIO_ANNOTATION_QUEUE_CENTRAL_TIMEOUT_MS = 5_000;
const STUDIO_ANNOTATION_QUEUE_CENTRAL_MAX_BYTES = 4_000_000;
const STUDIO_ANNOTATION_CONFLICT_CURATION_LEASE_HOURS = 24;

export async function loadStudioAnnotationQueue(
  workspaceRoot: string,
  flowId: string,
): Promise<StudioAnnotationQueueExport> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const queuePath = studioAnnotationQueuePath(loaded.flowRoot);
  try {
    const raw = await readFile(queuePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const queue = normalizeStudioAnnotationQueuePayload(parsed);
    if (!queue) {
      throw new WorkspaceError("Fila de anotação compartilhada inválida.", 422);
    }
    return buildStudioAnnotationQueueExport(loaded.flow, queue.items, queue.conflicts, queue.auditEntries, queue.permissionPolicy);
  } catch (error) {
    if (isFileNotFound(error)) {
      return buildStudioAnnotationQueueExport(loaded.flow, []);
    }
    if (error instanceof WorkspaceError) {
      throw error;
    }
    throw new WorkspaceError("Falha ao ler fila de anotação compartilhada.", 500, error);
  }
}

export async function saveStudioAnnotationQueue(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
  context: StudioAnnotationQueueMutationContext = {},
): Promise<StudioAnnotationQueueExport> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const queue = normalizeStudioAnnotationQueuePayload(payload);
  if (!queue) {
    throw new WorkspaceError("Payload de fila de anotação inválido.", 400);
  }
  if (context.enforcePermissions === true) {
    const existingQueue = await loadStudioAnnotationQueue(workspaceRoot, flowId);
    assertStudioAnnotationQueueMutationAllowed(existingQueue, queue, context, { includesPolicy: true, fullReplace: true });
  }
  const nextQueue = buildStudioAnnotationQueueExport(
    loaded.flow,
    queue.items,
    queue.conflicts,
    queue.auditEntries,
    queue.permissionPolicy,
  );
  await writeStudioAnnotationQueue(loaded.flowRoot, nextQueue);
  return nextQueue;
}

export async function mergeStudioAnnotationQueue(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
  context: StudioAnnotationQueueMutationContext = {},
): Promise<StudioAnnotationQueueExport> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const incomingQueue = normalizeStudioAnnotationQueuePayload(payload);
  if (!incomingQueue) {
    throw new WorkspaceError("Payload de merge da fila de anotação inválido.", 400);
  }
  const existingQueue = await loadStudioAnnotationQueue(workspaceRoot, flowId);
  const incomingIncludesPolicy = isRecord(payload) && isRecord(payload.permissionPolicy);
  const effectiveIncomingQueue = incomingIncludesPolicy
    ? incomingQueue
    : { ...incomingQueue, permissionPolicy: existingQueue.permissionPolicy };
  if (context.enforcePermissions === true) {
    assertStudioAnnotationQueueMutationAllowed(existingQueue, effectiveIncomingQueue, context, {
      includesPolicy: incomingIncludesPolicy,
      fullReplace: false,
    });
  }
  const merged = mergeStudioAnnotationQueueEntries(existingQueue, effectiveIncomingQueue);
  const nextQueue = buildStudioAnnotationQueueExport(
    loaded.flow,
    merged.items,
    merged.conflicts,
    merged.auditEntries,
    merged.permissionPolicy,
  );
  await writeStudioAnnotationQueue(loaded.flowRoot, nextQueue);
  return nextQueue;
}

export async function loadStudioAnnotationQueueConflictReview(
  workspaceRoot: string,
  flowId: string,
): Promise<StudioAnnotationQueueConflictReviewPackage> {
  const queue = await loadStudioAnnotationQueue(workspaceRoot, flowId);
  return buildStudioAnnotationQueueConflictReviewPackage(queue);
}

export async function compareStudioAnnotationQueueConflictReview(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  const current = await loadStudioAnnotationQueueConflictReview(workspaceRoot, flowId);
  const reviewPayload = isRecord(payload) && payload.review !== undefined ? payload.review : payload;
  const incoming = normalizeStudioAnnotationQueueConflictReviewPackage(reviewPayload, current.flow);
  if (!incoming) {
    throw new WorkspaceError("Revisão de conflitos da fila de anotação inválida ou contendo payload bruto.", 400);
  }
  if (incoming.flow.id !== current.flow.id) {
    throw new WorkspaceError("Revisão de conflitos da fila de anotação pertence a outro flow.", 400, {
      expectedFlowId: current.flow.id,
      receivedFlowId: incoming.flow.id,
    });
  }
  return buildStudioAnnotationQueueConflictReviewDiffPackage(current, incoming);
}

export async function loadStudioAnnotationQueueCentralSyncStatus(): Promise<StudioAnnotationQueueCentralSyncStatus> {
  return buildStudioAnnotationQueueCentralSyncStatus(studioAnnotationQueueCentralSyncConfig());
}

export async function syncCentralStudioAnnotationQueue(
  workspaceRoot: string,
  flowId: string,
  context: StudioAnnotationQueueMutationContext = {},
): Promise<StudioAnnotationQueueCentralSyncResult> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const config = studioAnnotationQueueCentralSyncConfig();
  if (config.invalidReason) {
    throw new WorkspaceError(`Configuração da central da fila de anotação inválida: ${config.invalidReason}`, 422);
  }
  if (!config.url) {
    throw new WorkspaceError("Central da fila de anotação não configurada.", 400);
  }
  const existingQueue = await loadStudioAnnotationQueue(workspaceRoot, flowId);
  const fetched = await fetchCentralStudioAnnotationQueueSync(config, flowId, existingQueue);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fetched.body) as unknown;
  } catch (error) {
    throw new WorkspaceError("Resposta central da fila de anotação não é JSON válido.", 502, error);
  }
  const centralQueuePayload = isRecord(parsed) && parsed.queue !== undefined ? parsed.queue : parsed;
  const incomingQueue = normalizeStudioAnnotationQueuePayload(centralQueuePayload);
  if (!incomingQueue) {
    throw new WorkspaceError("Resposta central da fila de anotação não respeita o formato esperado.", 502);
  }
  if (context.enforcePermissions === true) {
    assertStudioAnnotationQueueMutationAllowed(existingQueue, incomingQueue, context, {
      includesPolicy: isRecord(centralQueuePayload) && isRecord(centralQueuePayload.permissionPolicy),
      fullReplace: false,
    });
  }
  const merged = mergeStudioAnnotationQueueEntries(existingQueue, incomingQueue);
  const nextQueue = buildStudioAnnotationQueueExport(
    loaded.flow,
    merged.items,
    merged.conflicts,
    merged.auditEntries,
    merged.permissionPolicy,
  );
  await writeStudioAnnotationQueue(loaded.flowRoot, nextQueue);
  const syncedAt = new Date().toISOString();
  return {
    format: STUDIO_ANNOTATION_QUEUE_CENTRAL_SYNC_RESULT_FORMAT,
    flowId,
    queue: nextQueue,
    central: buildStudioAnnotationQueueCentralSyncStatus(config, {
      lastSyncedAt: syncedAt,
      statusCode: fetched.statusCode,
      pushedItemCount: existingQueue.itemCount,
      pulledItemCount: incomingQueue.itemCount,
      error: null,
    }),
    pushedItemCount: existingQueue.itemCount,
    pulledItemCount: incomingQueue.itemCount,
    governance: {
      excludesSecretValues: true,
      sendsAnnotationItems: true,
      sendsObservedOutputs: true,
      sendsRawRunEvents: false,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  };
}

export async function curateStudioAnnotationQueueConflict(
  workspaceRoot: string,
  flowId: string,
  conflictId: string,
  payload: unknown,
  context: StudioAnnotationQueueMutationContext = {},
): Promise<StudioAnnotationQueueExport> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const normalizedConflictId = conflictId.trim();
  if (!normalizedConflictId) {
    throw new WorkspaceError("ID do conflito de anotação é obrigatório.", 400);
  }
  const existingQueue = await loadStudioAnnotationQueue(workspaceRoot, flowId);
  const conflict = existingQueue.conflicts.find((item) => item.id === normalizedConflictId);
  if (!conflict) {
    throw new WorkspaceError("Conflito de anotação não encontrado.", 404);
  }
  if (conflict.status === "resolved") {
    throw new WorkspaceError("Conflito de anotação já está resolvido.", 409);
  }
  const action = normalizeStudioAnnotationConflictCurationAction(isRecord(payload) ? payload.action : undefined);
  if (!action) {
    throw new WorkspaceError("Ação de curadoria do conflito de anotação é obrigatória.", 400);
  }
  const at = new Date().toISOString();
  const actor = resolveStudioAnnotationConflictCurationActor(payload, context);
  const note = resolveStudioAnnotationConflictCurationNote(payload);
  const nextConflicts = existingQueue.conflicts.map((item) =>
    item.id === normalizedConflictId
      ? {
          ...item,
          curationThread: updateStudioAnnotationConflictCurationThread(item.curationThread, action, actor, note, at),
        }
      : item,
  );
  const nextAuditEntries = [
    buildStudioAnnotationAuditEntry({
      action: "conflict_curated",
      itemId: conflict.itemId,
      conflictId: conflict.id,
      actor,
      at,
      summary:
        action === "assign"
          ? `Curadoria do conflito assumida por ${actor}.`
          : "Curadoria do conflito liberada.",
      beforeStatus: conflict.existingStatus,
      afterStatus: conflict.incomingStatus,
      beforeAssignee: conflict.curationThread.assignee,
      afterAssignee: action === "assign" ? actor : "",
    }),
    ...existingQueue.auditEntries,
  ];
  const nextQueue = buildStudioAnnotationQueueExport(
    loaded.flow,
    existingQueue.items,
    nextConflicts,
    nextAuditEntries,
    existingQueue.permissionPolicy,
  );
  if (context.enforcePermissions === true) {
    assertStudioAnnotationQueueMutationAllowed(existingQueue, nextQueue, context, {
      includesPolicy: false,
      fullReplace: false,
    });
  }
  await writeStudioAnnotationQueue(loaded.flowRoot, nextQueue);
  return nextQueue;
}

function studioAnnotationQueuePath(flowRoot: string): string {
  return path.join(flowRoot, STUDIO_ANNOTATION_QUEUE_FILE);
}

async function writeStudioAnnotationQueue(flowRoot: string, queue: StudioAnnotationQueueExport): Promise<void> {
  const queuePath = studioAnnotationQueuePath(flowRoot);
  await mkdir(path.dirname(queuePath), { recursive: true });
  const tempPath = `${queuePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(queue, null, 2)}\n`, "utf-8");
  await rename(tempPath, queuePath);
}

function buildStudioAnnotationQueueExport(
  flow: AgentFlow,
  items: StudioAnnotationQueueItem[],
  conflicts: StudioAnnotationQueueConflict[] = [],
  auditEntries: StudioAnnotationQueueAuditEntry[] = [],
  permissionPolicy: StudioAnnotationQueuePermissionPolicy = defaultStudioAnnotationPermissionPolicy(),
): StudioAnnotationQueueExport {
  const normalized = syncStudioAnnotationQueue(items);
  const normalizedConflicts = syncStudioAnnotationQueueConflicts(conflicts, normalized);
  const resolutionHistory = buildStudioAnnotationQueueResolutionHistory(normalizedConflicts, normalized);
  const normalizedAuditEntries = syncStudioAnnotationQueueAuditEntries(auditEntries);
  const normalizedPermissionPolicy = normalizeStudioAnnotationPermissionPolicy(permissionPolicy);
  return {
    format: "agent-flow-builder.annotation-queue.v1",
    exportedAt: new Date().toISOString(),
    flow: {
      id: flow.id,
      name: flow.name,
      version: flow.version,
    },
    itemCount: normalized.length,
    pendingCount: normalized.filter((item) => item.status === "pending").length,
    acceptedCount: normalized.filter((item) => item.status === "accepted").length,
    rejectedCount: normalized.filter((item) => item.status === "rejected").length,
    assigneeCounts: buildStudioAnnotationAssigneeCounts(normalized),
    reviewedCount: normalized.filter((item) => item.reviewedAt !== null || item.reviewedBy.trim().length > 0).length,
    conflictCount: normalizedConflicts.length,
    openConflictCount: normalizedConflicts.filter((conflict) => conflict.status === "open").length,
    conflicts: normalizedConflicts,
    resolutionHistoryCount: resolutionHistory.length,
    resolutionHistory,
    auditCount: normalizedAuditEntries.length,
    auditEntries: normalizedAuditEntries,
    permissionPolicy: normalizedPermissionPolicy,
    items: normalized,
  };
}

function normalizeStudioAnnotationQueuePayload(value: unknown): StudioAnnotationQueueExport | null {
  if (!isRecord(value)) {
    return null;
  }
  const rawItems = Array.isArray(value.items)
    ? value.items
    : value.format === "agent-flow-builder.annotation-queue.v1" && Array.isArray(value.queue)
      ? value.queue
      : null;
  if (!rawItems) {
    return null;
  }
  const flow = isRecord(value.flow) ? value.flow : {};
  const items = syncStudioAnnotationQueue(rawItems);
  const conflicts = syncStudioAnnotationQueueConflicts(
    Array.isArray(value.conflicts) ? value.conflicts : [],
    items,
  );
  const resolutionHistory = buildStudioAnnotationQueueResolutionHistory(conflicts, items);
  const auditEntries = syncStudioAnnotationQueueAuditEntries(
    Array.isArray(value.auditEntries) ? value.auditEntries : Array.isArray(value.auditTrail) ? value.auditTrail : [],
  );
  const permissionPolicy = normalizeStudioAnnotationPermissionPolicy(value.permissionPolicy);
  return {
    format: "agent-flow-builder.annotation-queue.v1",
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : new Date().toISOString(),
    flow: {
      id: typeof flow.id === "string" ? flow.id : "",
      name: typeof flow.name === "string" ? flow.name : "",
      version: typeof flow.version === "string" ? flow.version : "",
    },
    itemCount: items.length,
    pendingCount: items.filter((item) => item.status === "pending").length,
    acceptedCount: items.filter((item) => item.status === "accepted").length,
    rejectedCount: items.filter((item) => item.status === "rejected").length,
    assigneeCounts: buildStudioAnnotationAssigneeCounts(items),
    reviewedCount: items.filter((item) => item.reviewedAt !== null || item.reviewedBy.trim().length > 0).length,
    conflictCount: conflicts.length,
    openConflictCount: conflicts.filter((conflict) => conflict.status === "open").length,
    conflicts,
    resolutionHistoryCount: resolutionHistory.length,
    resolutionHistory,
    auditCount: auditEntries.length,
    auditEntries,
    permissionPolicy,
    items,
  };
}

function buildStudioAnnotationQueueConflictReviewPackage(
  queue: StudioAnnotationQueueExport,
  generatedAt = new Date().toISOString(),
): StudioAnnotationQueueConflictReviewPackage {
  const conflicts = queue.conflicts.map(studioAnnotationQueueConflictReviewItem);
  return buildStudioAnnotationQueueConflictReviewPackageFromParts(
    queue.flow,
    conflicts,
    queue.resolutionHistory,
    queue.itemCount,
    generatedAt,
  );
}

function buildStudioAnnotationQueueConflictReviewPackageFromParts(
  flow: { id: string; name: string; version: string },
  conflicts: StudioAnnotationQueueConflictReviewItem[],
  resolutionHistory: StudioAnnotationQueueResolutionRecord[],
  itemCount: number,
  generatedAt = new Date().toISOString(),
): StudioAnnotationQueueConflictReviewPackage {
  const summary: StudioAnnotationQueueConflictReviewSummary = {
    conflictCount: conflicts.length,
    openConflictCount: conflicts.filter((conflict) => conflict.status === "open").length,
    resolvedConflictCount: conflicts.filter((conflict) => conflict.status === "resolved").length,
    assignedConflictCount: conflicts.filter((conflict) => conflict.curationThread.status === "assigned").length,
    unassignedConflictCount: conflicts.filter((conflict) => conflict.curationThread.status === "unassigned").length,
    resolvedThreadCount: conflicts.filter((conflict) => conflict.curationThread.status === "resolved").length,
    resolutionHistoryCount: resolutionHistory.length,
    itemCount,
  };
  const packageHash = hashAnnotationReview({
    flow,
    conflictRefs: conflicts.map((conflict) => ({
      id: conflict.id,
      itemId: conflict.itemId,
      status: conflict.status,
      resolution: conflict.resolution,
      existingContentHash: conflict.existingRef.contentHash,
      incomingContentHash: conflict.incomingRef.contentHash,
      curationStatus: conflict.curationThread.status,
      curationAssignee: conflict.curationThread.assignee,
      resolvedAt: conflict.resolvedAt,
    })),
    resolutionIds: resolutionHistory.map((record) => record.resolutionId),
    summary,
  });
  return {
    format: STUDIO_ANNOTATION_QUEUE_CONFLICT_REVIEW_FORMAT,
    generatedAt,
    flow,
    packageHash,
    conflictCount: conflicts.length,
    openConflictCount: summary.openConflictCount,
    resolutionHistoryCount: resolutionHistory.length,
    conflicts,
    resolutionHistory,
    summary,
    governance: {
      excludesQueueItems: true,
      excludesSnapshots: true,
      excludesObservedOutputs: true,
      excludesVerdicts: true,
      excludesReasons: true,
      excludesSecretValues: true,
      includesOnlyRefsThreadsAndResolutionHistory: true,
      localWorkspaceFile: true,
    },
  };
}

function studioAnnotationQueueConflictReviewItem(
  conflict: StudioAnnotationQueueConflict,
): StudioAnnotationQueueConflictReviewItem {
  const existingRef = studioAnnotationQueueConflictSnapshotRef(conflict.existingSnapshot);
  const incomingRef = studioAnnotationQueueConflictSnapshotRef(conflict.incomingSnapshot);
  const differences = buildStudioAnnotationQueueConflictReviewDifferences(existingRef, incomingRef);
  return {
    id: conflict.id,
    itemId: conflict.itemId,
    status: conflict.status,
    resolution: conflict.resolution,
    existingRef,
    incomingRef,
    differenceCount: differences.filter((difference) => difference.changed).length,
    differences,
    curationThread: conflict.curationThread,
    createdAt: conflict.createdAt,
    resolvedAt: conflict.resolvedAt,
    resolvedBy: conflict.resolvedBy,
    governance: {
      excludesSnapshots: true,
      excludesObservedOutputs: true,
      excludesVerdicts: true,
      excludesReasons: true,
      excludesSecretValues: true,
      includesOnlyRefsThreadsAndResolutionHistory: true,
    },
  };
}

function studioAnnotationQueueConflictSnapshotRef(
  item: StudioAnnotationQueueItem,
): StudioAnnotationQueueConflictSnapshotRef {
  const base = {
    itemId: item.id,
    scenarioId: item.scenarioId,
    scenarioLabel: item.scenarioLabel,
    sessionId: item.sessionId,
    runId: item.runId,
    resultStatus: item.resultStatus,
    comparisonSeverity: item.comparisonSeverity,
    status: item.status,
    reviewer: item.reviewedBy,
    assignee: item.assignee,
    reviewedAt: item.reviewedAt,
    noteHash: hashAnnotationReview(item.note),
    verdictHash: hashAnnotationReview(item.verdict),
    reasonsHash: hashAnnotationReview(item.reasons),
    observedOutputHash: hashAnnotationReview(item.observedOutput),
    batchHash: item.batchHash,
    updatedAt: item.updatedAt,
  };
  return {
    ...base,
    contentHash: hashAnnotationReview(base),
  };
}

function buildStudioAnnotationQueueConflictReviewDifferences(
  existing: StudioAnnotationQueueConflictSnapshotRef,
  incoming: StudioAnnotationQueueConflictSnapshotRef,
): StudioAnnotationQueueConflictReviewDifference[] {
  return [
    buildStudioAnnotationQueueConflictReviewDifference("status", "Status", "value", existing.status, incoming.status),
    buildStudioAnnotationQueueConflictReviewDifference("assignee", "Responsável", "value", existing.assignee, incoming.assignee),
    buildStudioAnnotationQueueConflictReviewDifference("reviewer", "Revisor", "value", existing.reviewer, incoming.reviewer),
    buildStudioAnnotationQueueConflictReviewDifference("reviewedAt", "Revisado em", "time", existing.reviewedAt ?? "", incoming.reviewedAt ?? ""),
    buildStudioAnnotationQueueConflictReviewDifference("noteHash", "Nota", "hash", existing.noteHash, incoming.noteHash),
    buildStudioAnnotationQueueConflictReviewDifference("verdictHash", "Veredito", "hash", existing.verdictHash, incoming.verdictHash),
    buildStudioAnnotationQueueConflictReviewDifference("reasonsHash", "Razões", "hash", existing.reasonsHash, incoming.reasonsHash),
    buildStudioAnnotationQueueConflictReviewDifference("observedOutputHash", "Saída observada", "hash", existing.observedOutputHash, incoming.observedOutputHash),
    buildStudioAnnotationQueueConflictReviewDifference("batchHash", "Batch", "hash", existing.batchHash, incoming.batchHash),
    buildStudioAnnotationQueueConflictReviewDifference("updatedAt", "Atualizado em", "time", existing.updatedAt, incoming.updatedAt),
  ].filter((difference) => difference.changed);
}

function buildStudioAnnotationQueueConflictReviewDifference(
  field: string,
  label: string,
  kind: "value" | "hash" | "time",
  existing: string,
  incoming: string,
): StudioAnnotationQueueConflictReviewDifference {
  return {
    field,
    label,
    kind,
    existing: existing || "-",
    incoming: incoming || "-",
    changed: existing !== incoming,
  };
}

function normalizeStudioAnnotationQueueConflictReviewPackage(
  value: unknown,
  fallbackFlow: { id: string; name: string; version: string },
): StudioAnnotationQueueConflictReviewPackage | null {
  if (
    !isRecord(value) ||
    value.format !== STUDIO_ANNOTATION_QUEUE_CONFLICT_REVIEW_FORMAT ||
    containsRawStudioAnnotationConflictReviewPayload(value)
  ) {
    return null;
  }
  const flowValue = isRecord(value.flow) ? value.flow : {};
  const flow = {
    id: typeof flowValue.id === "string" && flowValue.id.trim() ? flowValue.id.trim() : fallbackFlow.id,
    name: typeof flowValue.name === "string" && flowValue.name.trim() ? flowValue.name.trim() : fallbackFlow.name,
    version:
      typeof flowValue.version === "string" && flowValue.version.trim()
        ? flowValue.version.trim()
        : fallbackFlow.version,
  };
  const generatedAt = typeof value.generatedAt === "string" ? value.generatedAt : new Date().toISOString();
  const conflicts = Array.isArray(value.conflicts)
    ? value.conflicts
        .map(normalizeStudioAnnotationQueueConflictReviewItem)
        .filter((conflict): conflict is StudioAnnotationQueueConflictReviewItem => conflict !== null)
        .slice(0, 128)
    : [];
  const resolutionHistory = Array.isArray(value.resolutionHistory)
    ? value.resolutionHistory
        .map(normalizeStudioAnnotationQueueResolutionRecord)
        .filter((record): record is StudioAnnotationQueueResolutionRecord => record !== null)
        .slice(0, 128)
    : [];
  const itemCount = isRecord(value.summary) ? toNonNegativeInteger(value.summary.itemCount) : 0;
  return buildStudioAnnotationQueueConflictReviewPackageFromParts(
    flow,
    conflicts,
    resolutionHistory,
    itemCount,
    generatedAt,
  );
}

function containsRawStudioAnnotationConflictReviewPayload(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsRawStudioAnnotationConflictReviewPayload);
  }
  if (!isRecord(value)) {
    return false;
  }
  for (const [key, child] of Object.entries(value)) {
    if (
      key === "items" ||
      key === "queue" ||
      key === "auditEntries" ||
      key === "existingSnapshot" ||
      key === "incomingSnapshot" ||
      key === "observedOutput" ||
      key === "verdict" ||
      key === "reasons" ||
      key === "existingNote" ||
      key === "incomingNote"
    ) {
      return true;
    }
    if (containsRawStudioAnnotationConflictReviewPayload(child)) {
      return true;
    }
  }
  return false;
}

function normalizeStudioAnnotationQueueConflictReviewItem(
  value: unknown,
): StudioAnnotationQueueConflictReviewItem | null {
  if (!isRecord(value) || value.existingSnapshot !== undefined || value.incomingSnapshot !== undefined) {
    return null;
  }
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : "";
  const itemId = typeof value.itemId === "string" && value.itemId.trim() ? value.itemId.trim() : "";
  const existingRef = normalizeStudioAnnotationQueueConflictSnapshotRef(value.existingRef);
  const incomingRef = normalizeStudioAnnotationQueueConflictSnapshotRef(value.incomingRef);
  if (!id || !itemId || !existingRef || !incomingRef) {
    return null;
  }
  const differences = buildStudioAnnotationQueueConflictReviewDifferences(existingRef, incomingRef);
  const status = value.status === "resolved" ? "resolved" : "open";
  return {
    id,
    itemId,
    status,
    resolution:
      value.resolution === "existing" || value.resolution === "manual" || value.resolution === "incoming"
        ? value.resolution
        : "incoming",
    existingRef,
    incomingRef,
    differenceCount: differences.length,
    differences,
    curationThread: normalizeStudioAnnotationConflictCurationThread(value.curationThread),
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    resolvedAt: value.resolvedAt === null || typeof value.resolvedAt === "string" ? value.resolvedAt : null,
    resolvedBy: typeof value.resolvedBy === "string" ? value.resolvedBy.trim() : "",
    governance: {
      excludesSnapshots: true,
      excludesObservedOutputs: true,
      excludesVerdicts: true,
      excludesReasons: true,
      excludesSecretValues: true,
      includesOnlyRefsThreadsAndResolutionHistory: true,
    },
  };
}

function normalizeStudioAnnotationQueueConflictSnapshotRef(
  value: unknown,
): StudioAnnotationQueueConflictSnapshotRef | null {
  if (!isRecord(value)) {
    return null;
  }
  const itemId = typeof value.itemId === "string" && value.itemId.trim() ? value.itemId.trim() : "";
  const scenarioId = typeof value.scenarioId === "string" && value.scenarioId.trim() ? value.scenarioId.trim() : itemId;
  if (!itemId || !scenarioId) {
    return null;
  }
  const base = {
    itemId,
    scenarioId,
    scenarioLabel:
      typeof value.scenarioLabel === "string" && value.scenarioLabel.trim()
        ? value.scenarioLabel.trim()
        : scenarioId,
    sessionId: typeof value.sessionId === "string" && value.sessionId.trim() ? value.sessionId.trim() : null,
    runId: typeof value.runId === "string" && value.runId.trim() ? value.runId.trim() : null,
    resultStatus: value.resultStatus === "error" ? "error" as const : "ok" as const,
    comparisonSeverity: normalizeStudioAnnotationComparisonSeverity(value.comparisonSeverity),
    status: normalizeStudioAnnotationStatus(value.status),
    reviewer: typeof value.reviewer === "string" ? value.reviewer.trim() : "",
    assignee: typeof value.assignee === "string" ? value.assignee.trim() : "",
    reviewedAt: value.reviewedAt === null || typeof value.reviewedAt === "string" ? value.reviewedAt : null,
    noteHash: typeof value.noteHash === "string" ? value.noteHash.trim() : "",
    verdictHash: typeof value.verdictHash === "string" ? value.verdictHash.trim() : "",
    reasonsHash: typeof value.reasonsHash === "string" ? value.reasonsHash.trim() : "",
    observedOutputHash: typeof value.observedOutputHash === "string" ? value.observedOutputHash.trim() : "",
    batchHash: typeof value.batchHash === "string" ? value.batchHash.trim() : "",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
  };
  return {
    ...base,
    contentHash: typeof value.contentHash === "string" && value.contentHash.trim()
      ? value.contentHash.trim()
      : hashAnnotationReview(base),
  };
}

function buildStudioAnnotationQueueConflictReviewDiffPackage(
  current: StudioAnnotationQueueConflictReviewPackage,
  incoming: StudioAnnotationQueueConflictReviewPackage,
): Record<string, unknown> {
  const generatedAt = new Date().toISOString();
  const conflictSection = buildStudioAnnotationQueueConflictReviewConflictDiffSection(current.conflicts, incoming.conflicts);
  const resolutionSection = buildStudioAnnotationQueueConflictReviewResolutionDiffSection(
    current.resolutionHistory,
    incoming.resolutionHistory,
  );
  const sections = [
    buildStudioAnnotationQueueConflictReviewSummaryDiffSection(current, incoming),
    conflictSection,
    resolutionSection,
  ];
  const changedSectionCount = sections.filter((section) => section.status !== "same").length;
  const conflictDelta = incoming.conflictCount - current.conflictCount;
  const resolutionDelta = incoming.resolutionHistoryCount - current.resolutionHistoryCount;
  const status = changedSectionCount || conflictDelta || resolutionDelta ? "changed" : "same";
  const base = {
    format: STUDIO_ANNOTATION_QUEUE_CONFLICT_REVIEW_DIFF_FORMAT,
    generatedAt,
    flow: current.flow,
    current: studioAnnotationQueueConflictReviewPackageRef(current),
    incoming: studioAnnotationQueueConflictReviewPackageRef(incoming),
    sections,
    summary: {
      status,
      statusLabel: status === "same" ? "igual" : "alterado",
      headline: [
        `${formatSignedInteger(conflictDelta)} conflito(s)`,
        `${formatSignedInteger(resolutionDelta)} decisão(ões)`,
        `${conflictSection.items.filter((item) => item.status === "changed").length} conflito(s) alterado(s)`,
        `${conflictSection.items.filter((item) => item.status === "only_current").length} só no atual`,
        `${conflictSection.items.filter((item) => item.status === "only_incoming").length} só na revisão`,
        `${changedSectionCount} seção(ões) alterada(s)`,
      ].join(" · "),
      conflictDelta,
      resolutionDelta,
      changedConflictCount: conflictSection.items.filter((item) => item.status === "changed").length,
      onlyCurrentConflictCount: conflictSection.items.filter((item) => item.status === "only_current").length,
      onlyIncomingConflictCount: conflictSection.items.filter((item) => item.status === "only_incoming").length,
      changedResolutionCount: resolutionSection.items.filter((item) => item.status === "changed").length,
      changedSectionCount,
    },
    governance: {
      previewOnly: true,
      excludesQueueItems: true,
      excludesSnapshots: true,
      excludesObservedOutputs: true,
      excludesVerdicts: true,
      excludesReasons: true,
      excludesSecretValues: true,
      includesOnlyRefsThreadsAndResolutionHistory: true,
      source: "annotation-queue-conflict-review-diff",
    },
  };
  return {
    ...base,
    packageHash: hashAnnotationReview(base),
  };
}

function studioAnnotationQueueConflictReviewPackageRef(
  packageValue: StudioAnnotationQueueConflictReviewPackage,
): Record<string, unknown> {
  return {
    generatedAt: packageValue.generatedAt,
    packageHash: packageValue.packageHash,
    conflictCount: packageValue.conflictCount,
    openConflictCount: packageValue.openConflictCount,
    resolutionHistoryCount: packageValue.resolutionHistoryCount,
    summary: packageValue.summary,
  };
}

function buildStudioAnnotationQueueConflictReviewSummaryDiffSection(
  current: StudioAnnotationQueueConflictReviewPackage,
  incoming: StudioAnnotationQueueConflictReviewPackage,
): StudioAnnotationQueueConflictReviewDiffSection {
  return buildStudioAnnotationQueueConflictReviewDiffSection("summary", "Resumo", [
    buildStudioAnnotationQueueConflictReviewCountDiffItem("conflicts", "Conflitos", current.conflictCount, incoming.conflictCount),
    buildStudioAnnotationQueueConflictReviewCountDiffItem("open", "Abertos", current.openConflictCount, incoming.openConflictCount),
    buildStudioAnnotationQueueConflictReviewCountDiffItem("resolved", "Resolvidos", current.summary.resolvedConflictCount, incoming.summary.resolvedConflictCount),
    buildStudioAnnotationQueueConflictReviewCountDiffItem("assigned", "Atribuídos", current.summary.assignedConflictCount, incoming.summary.assignedConflictCount),
    buildStudioAnnotationQueueConflictReviewCountDiffItem("unassigned", "Sem responsável", current.summary.unassignedConflictCount, incoming.summary.unassignedConflictCount),
    buildStudioAnnotationQueueConflictReviewCountDiffItem("resolutions", "Histórico de decisões", current.resolutionHistoryCount, incoming.resolutionHistoryCount),
  ]);
}

function buildStudioAnnotationQueueConflictReviewConflictDiffSection(
  current: StudioAnnotationQueueConflictReviewItem[],
  incoming: StudioAnnotationQueueConflictReviewItem[],
): StudioAnnotationQueueConflictReviewDiffSection {
  return buildStudioAnnotationQueueConflictReviewObjectDiffSection(
    "conflicts",
    "Conflitos",
    current,
    incoming,
    (conflict) => conflict.id,
    (conflict) => `${conflict.itemId} · ${conflict.status}`,
    (conflict) => hashAnnotationReview({
      id: conflict.id,
      status: conflict.status,
      resolution: conflict.resolution,
      existingContentHash: conflict.existingRef.contentHash,
      incomingContentHash: conflict.incomingRef.contentHash,
      curationThread: conflict.curationThread,
      resolvedAt: conflict.resolvedAt,
      resolvedBy: conflict.resolvedBy,
    }),
  );
}

function buildStudioAnnotationQueueConflictReviewResolutionDiffSection(
  current: StudioAnnotationQueueResolutionRecord[],
  incoming: StudioAnnotationQueueResolutionRecord[],
): StudioAnnotationQueueConflictReviewDiffSection {
  return buildStudioAnnotationQueueConflictReviewObjectDiffSection(
    "resolution_history",
    "Histórico de decisões",
    current,
    incoming,
    (record) => record.resolutionId,
    (record) => `${record.itemId} · ${record.resolution}`,
    (record) => hashAnnotationReview(record),
  );
}

function buildStudioAnnotationQueueConflictReviewObjectDiffSection<T>(
  id: string,
  title: string,
  current: T[],
  incoming: T[],
  keyOf: (item: T) => string,
  labelOf: (item: T) => string,
  hashOf: (item: T) => string,
): StudioAnnotationQueueConflictReviewDiffSection {
  const currentById = new Map(current.map((item) => [keyOf(item), item]));
  const incomingById = new Map(incoming.map((item) => [keyOf(item), item]));
  const ids = Array.from(new Set([...currentById.keys(), ...incomingById.keys()])).sort((left, right) =>
    left.localeCompare(right),
  );
  const items = ids.map((itemId) => {
    const currentItem = currentById.get(itemId) ?? null;
    const incomingItem = incomingById.get(itemId) ?? null;
    const currentHash = currentItem ? hashOf(currentItem) : "";
    const incomingHash = incomingItem ? hashOf(incomingItem) : "";
    const status: StudioAnnotationQueueConflictReviewDiffItemStatus = !currentItem
      ? "only_incoming"
      : !incomingItem
        ? "only_current"
        : currentHash === incomingHash
          ? "same"
          : "changed";
    return {
      id: itemId,
      label: currentItem ? labelOf(currentItem) : incomingItem ? labelOf(incomingItem) : itemId,
      status,
      statusLabel: formatAnnotationReviewDiffStatus(status),
      currentHash: currentHash || null,
      incomingHash: incomingHash || null,
    };
  });
  return buildStudioAnnotationQueueConflictReviewDiffSection(id, title, items);
}

function buildStudioAnnotationQueueConflictReviewDiffSection(
  id: string,
  title: string,
  items: StudioAnnotationQueueConflictReviewDiffItem[],
): StudioAnnotationQueueConflictReviewDiffSection {
  const changedCount = items.filter((item) => item.status !== "same").length;
  return {
    id,
    title,
    status: changedCount ? "changed" : "same",
    statusLabel: changedCount ? "alterado" : "igual",
    summary: `${changedCount}/${items.length} alterado(s)`,
    items,
  };
}

function buildStudioAnnotationQueueConflictReviewCountDiffItem(
  id: string,
  label: string,
  current: number,
  incoming: number,
): StudioAnnotationQueueConflictReviewDiffItem {
  const delta = incoming - current;
  return {
    id,
    label,
    status: delta === 0 ? "same" : "changed",
    statusLabel: delta === 0 ? "igual" : "alterado",
    current,
    incoming,
    delta,
  };
}

function formatAnnotationReviewDiffStatus(status: string): string {
  if (status === "only_current") {
    return "só no atual";
  }
  if (status === "only_incoming") {
    return "só na revisão";
  }
  return status === "changed" ? "alterado" : "igual";
}

interface StudioAnnotationQueueCentralSyncConfig {
  url: string | null;
  token: string | null;
  timeoutMs: number;
  invalidReason: string | null;
}

function studioAnnotationQueueCentralSyncConfig(): StudioAnnotationQueueCentralSyncConfig {
  const errors: string[] = [];
  const configuredUrl = (process.env[STUDIO_ANNOTATION_QUEUE_CENTRAL_URL_ENV] ?? "").trim();
  let url: string | null = null;
  if (configuredUrl) {
    try {
      url = validateStudioAnnotationQueueCentralUrl(configuredUrl);
    } catch (error) {
      errors.push(errorMessage(error));
    }
  }

  let timeoutMs = STUDIO_ANNOTATION_QUEUE_CENTRAL_TIMEOUT_MS;
  const configuredTimeout = (process.env[STUDIO_ANNOTATION_QUEUE_CENTRAL_TIMEOUT_ENV] ?? "").trim();
  if (configuredTimeout) {
    const parsed = Number(configuredTimeout);
    if (!Number.isInteger(parsed) || parsed < 100 || parsed > 60_000) {
      errors.push(`${STUDIO_ANNOTATION_QUEUE_CENTRAL_TIMEOUT_ENV} deve ser inteiro entre 100 e 60000.`);
    } else {
      timeoutMs = parsed;
    }
  }

  return {
    url,
    token: (process.env[STUDIO_ANNOTATION_QUEUE_CENTRAL_TOKEN_ENV] ?? "").trim() || null,
    timeoutMs,
    invalidReason: errors.length ? errors.join(" ") : null,
  };
}

function buildStudioAnnotationQueueCentralSyncStatus(
  config: StudioAnnotationQueueCentralSyncConfig,
  sync?: Pick<StudioAnnotationQueueCentralSyncStatus, "lastSyncedAt" | "statusCode" | "pushedItemCount" | "pulledItemCount" | "error">,
): StudioAnnotationQueueCentralSyncStatus {
  return {
    format: STUDIO_ANNOTATION_QUEUE_CENTRAL_STATUS_FORMAT,
    generatedAt: new Date().toISOString(),
    configured: Boolean(config.url && !config.invalidReason),
    urlConfigured: Boolean(config.url),
    tokenConfigured: Boolean(config.token),
    timeoutMs: config.timeoutMs,
    invalidReason: config.invalidReason,
    lastSyncedAt: sync?.lastSyncedAt ?? null,
    statusCode: sync?.statusCode ?? null,
    pushedItemCount: sync?.pushedItemCount ?? null,
    pulledItemCount: sync?.pulledItemCount ?? null,
    error: sync?.error ?? null,
    governance: {
      excludesSecretValues: true,
      sendsAnnotationItems: true,
      sendsObservedOutputs: true,
      sendsRawRunEvents: false,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
      storesCentralToken: false,
      configuredUrlEnv: STUDIO_ANNOTATION_QUEUE_CENTRAL_URL_ENV,
      configuredTokenEnv: STUDIO_ANNOTATION_QUEUE_CENTRAL_TOKEN_ENV,
      configuredTimeoutEnv: STUDIO_ANNOTATION_QUEUE_CENTRAL_TIMEOUT_ENV,
      maxPayloadBytes: STUDIO_ANNOTATION_QUEUE_CENTRAL_MAX_BYTES,
    },
  };
}

async function fetchCentralStudioAnnotationQueueSync(
  config: StudioAnnotationQueueCentralSyncConfig,
  flowId: string,
  queue: StudioAnnotationQueueExport,
): Promise<{ statusCode: number; body: string }> {
  if (!config.url) {
    throw new WorkspaceError("Central da fila de anotação não configurada.", 400);
  }
  const body = JSON.stringify({
    format: STUDIO_ANNOTATION_QUEUE_CENTRAL_SYNC_REQUEST_FORMAT,
    generatedAt: new Date().toISOString(),
    flowId,
    queue,
    itemCount: queue.itemCount,
    governance: {
      excludesSecretValues: true,
      sendsAnnotationItems: true,
      sendsObservedOutputs: true,
      sendsRawRunEvents: false,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  });
  if (Buffer.byteLength(body, "utf-8") > STUDIO_ANNOTATION_QUEUE_CENTRAL_MAX_BYTES) {
    throw new WorkspaceError("Fila de anotação excede o limite de tamanho permitido para sync central.", 413);
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
    if (Number.isFinite(contentLength) && contentLength > STUDIO_ANNOTATION_QUEUE_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central da fila de anotação excede o limite de tamanho permitido.", 413);
    }
    if (!response.ok) {
      throw new WorkspaceError(`Central da fila de anotação respondeu HTTP ${response.status}.`, response.status);
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > STUDIO_ANNOTATION_QUEUE_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central da fila de anotação excede o limite de tamanho permitido.", 413);
    }
    return {
      statusCode: response.status,
      body: Buffer.from(buffer).toString("utf-8"),
    };
  } catch (error) {
    if (isRecord(error) && error.name === "AbortError") {
      throw new WorkspaceError("Timeout ao sincronizar central da fila de anotação.", 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function mergeStudioAnnotationQueueEntries(
  existingQueue: StudioAnnotationQueueExport,
  incomingQueue: StudioAnnotationQueueExport,
): {
  items: StudioAnnotationQueueItem[];
  conflicts: StudioAnnotationQueueConflict[];
  auditEntries: StudioAnnotationQueueAuditEntry[];
  permissionPolicy: StudioAnnotationQueuePermissionPolicy;
} {
  const existingItems = syncStudioAnnotationQueue(existingQueue.items);
  const incomingItems = syncStudioAnnotationQueue(incomingQueue.items);
  const byId = new Map(existingItems.map((item) => [item.id, item]));
  const discoveredConflicts: StudioAnnotationQueueConflict[] = [
    ...existingQueue.conflicts,
    ...incomingQueue.conflicts,
  ];
  const resolutionHistory = buildStudioAnnotationQueueResolutionHistory(discoveredConflicts, existingItems);
  const auditEntries: StudioAnnotationQueueAuditEntry[] = [
    ...existingQueue.auditEntries,
    ...incomingQueue.auditEntries,
  ];
  const permissionPolicy = newestStudioAnnotationPermissionPolicy(
    existingQueue.permissionPolicy,
    incomingQueue.permissionPolicy,
  );

  for (const incoming of incomingItems) {
    const existing = byId.get(incoming.id);
    if (existing) {
      const resolvedReplay = resolveStudioAnnotationResolvedReplay(existing, incoming, resolutionHistory);
      if (resolvedReplay === "keep_existing") {
        continue;
      }
      if (resolvedReplay === "use_incoming") {
        byId.set(incoming.id, incoming);
        continue;
      }
    }
    if (existing && shouldCreateStudioAnnotationConflict(existing, incoming)) {
      const conflict = buildStudioAnnotationQueueConflict(existing, incoming);
      discoveredConflicts.push(conflict);
      auditEntries.push(buildStudioAnnotationAuditEntry({
        action: "conflict_detected",
        itemId: conflict.itemId,
        conflictId: conflict.id,
        actor: conflict.incomingReviewer || conflict.incomingAssignee || "remote-reviewer",
        at: conflict.createdAt,
        summary: `Conflito detectado: ${conflict.existingStatus} vs ${conflict.incomingStatus}.`,
        beforeStatus: conflict.existingStatus,
        afterStatus: conflict.incomingStatus,
        beforeAssignee: conflict.existingAssignee,
        afterAssignee: conflict.incomingAssignee,
      }));
    }
    if (!existing || Date.parse(existing.updatedAt) <= Date.parse(incoming.updatedAt)) {
      byId.set(incoming.id, incoming);
    }
  }

  const items = sortStudioAnnotationQueueItems(Array.from(byId.values()));
  return {
    items,
    conflicts: syncStudioAnnotationQueueConflicts(discoveredConflicts, items),
    auditEntries: syncStudioAnnotationQueueAuditEntries(auditEntries),
    permissionPolicy,
  };
}

function assertStudioAnnotationQueueMutationAllowed(
  existingQueue: StudioAnnotationQueueExport,
  incomingQueue: StudioAnnotationQueueExport,
  context: StudioAnnotationQueueMutationContext,
  options: { includesPolicy: boolean; fullReplace: boolean },
): void {
  const actorId = normalizeAnnotationActorId(context.actorId || "local-studio");
  const currentPolicy = existingQueue.permissionPolicy;
  const currentRole = studioAnnotationReviewerRoleForActor(currentPolicy, actorId);
  const incomingRole = studioAnnotationReviewerRoleForActor(incomingQueue.permissionPolicy, actorId);
  const effectiveRole = highestStudioAnnotationReviewerRole(currentRole, incomingRole);
  const reasons: string[] = [];

  if (effectiveRole === "viewer") {
    reasons.push(`Ator ${actorId} possui papel viewer na fila de anotação.`);
  }

  if (options.includesPolicy && !studioAnnotationPermissionPolicyEquals(currentPolicy, incomingQueue.permissionPolicy)) {
    if (effectiveRole !== "owner") {
      reasons.push("Alterar a política da fila de anotação exige papel owner.");
    }
  }

  if (currentPolicy.mode === "assignee_only" && effectiveRole !== "owner") {
    const deniedItems = changedStudioAnnotationQueueItemIds(existingQueue, incomingQueue, { fullReplace: options.fullReplace })
      .filter((itemId) => !studioAnnotationActorCanMutateItem(actorId, existingQueue, incomingQueue, itemId));
    if (deniedItems.length) {
      reasons.push(
        `Modo assignee_only permite alterar apenas itens atribuídos ao ator; bloqueado para ${deniedItems.slice(0, 5).join(", ")}.`,
      );
    }
  }

  if (reasons.length) {
    throw new WorkspaceError("Ação bloqueada pela política da fila de anotação.", 403, {
      decision: {
        format: "agent-flow-builder.annotation-queue-permission-decision.v1",
        evaluatedAt: new Date().toISOString(),
        actorId,
        allowed: false,
        currentMode: currentPolicy.mode,
        role: effectiveRole,
        reasons,
        governance: {
          localOnly: true,
          excludesRawRuns: true,
          excludesSecretValues: true,
        },
      },
    });
  }
}

function changedStudioAnnotationQueueItemIds(
  existingQueue: StudioAnnotationQueueExport,
  incomingQueue: StudioAnnotationQueueExport,
  options: { fullReplace: boolean },
): string[] {
  const existingItems = new Map(existingQueue.items.map((item) => [item.id, item]));
  const incomingItems = new Map(incomingQueue.items.map((item) => [item.id, item]));
  const changedIds = new Set<string>();
  for (const [itemId, incoming] of incomingItems) {
    const existing = existingItems.get(itemId);
    if (!existing || studioAnnotationItemPermissionHash(existing) !== studioAnnotationItemPermissionHash(incoming)) {
      changedIds.add(itemId);
    }
  }
  if (options.fullReplace) {
    for (const itemId of existingItems.keys()) {
      if (!incomingItems.has(itemId)) {
        changedIds.add(itemId);
      }
    }
  }
  for (const conflict of incomingQueue.conflicts) {
    const existing = existingQueue.conflicts.find((item) => item.id === conflict.id);
    if (!existing || studioAnnotationConflictPermissionHash(existing) !== studioAnnotationConflictPermissionHash(conflict)) {
      changedIds.add(conflict.itemId);
    }
  }
  if (options.fullReplace) {
    for (const conflict of existingQueue.conflicts) {
      if (!incomingQueue.conflicts.some((item) => item.id === conflict.id)) {
        changedIds.add(conflict.itemId);
      }
    }
  }
  return Array.from(changedIds).sort();
}

function studioAnnotationActorCanMutateItem(
  actorId: string,
  existingQueue: StudioAnnotationQueueExport,
  incomingQueue: StudioAnnotationQueueExport,
  itemId: string,
): boolean {
  const existing = existingQueue.items.find((item) => item.id === itemId);
  const incoming = incomingQueue.items.find((item) => item.id === itemId);
  return Boolean(
    (existing && annotationActorMatches(existing.assignee, actorId)) ||
      (incoming && annotationActorMatches(incoming.assignee, actorId)),
  );
}

function studioAnnotationReviewerRoleForActor(
  policy: StudioAnnotationQueuePermissionPolicy,
  actorId: string,
): StudioAnnotationReviewerRole {
  const normalizedActor = normalizeAnnotationActorId(actorId);
  const reviewer = policy.reviewers.find((item) => normalizeAnnotationActorId(item.name) === normalizedActor);
  return reviewer?.role ?? "reviewer";
}

function highestStudioAnnotationReviewerRole(
  left: StudioAnnotationReviewerRole,
  right: StudioAnnotationReviewerRole,
): StudioAnnotationReviewerRole {
  return studioAnnotationReviewerRoleRank(left) >= studioAnnotationReviewerRoleRank(right) ? left : right;
}

function studioAnnotationReviewerRoleRank(role: StudioAnnotationReviewerRole): number {
  if (role === "owner") {
    return 2;
  }
  if (role === "reviewer") {
    return 1;
  }
  return 0;
}

function studioAnnotationPermissionPolicyEquals(
  left: StudioAnnotationQueuePermissionPolicy,
  right: StudioAnnotationQueuePermissionPolicy,
): boolean {
  return hashAnnotationConflict(JSON.stringify(studioAnnotationPermissionPolicyComparable(left))) ===
    hashAnnotationConflict(JSON.stringify(studioAnnotationPermissionPolicyComparable(right)));
}

function studioAnnotationPermissionPolicyComparable(policy: StudioAnnotationQueuePermissionPolicy): unknown {
  return {
    mode: policy.mode,
    reviewers: policy.reviewers.map((reviewer) => ({
      name: normalizeAnnotationActorId(reviewer.name),
      role: reviewer.role,
    })),
  };
}

function studioAnnotationItemPermissionHash(item: StudioAnnotationQueueItem): string {
  return hashAnnotationConflict(JSON.stringify({
    scenarioId: item.scenarioId,
    scenarioLabel: item.scenarioLabel,
    sessionId: item.sessionId,
    runId: item.runId,
    resultStatus: item.resultStatus,
    comparisonSeverity: item.comparisonSeverity,
    verdict: item.verdict,
    reasons: item.reasons,
    observedOutput: item.observedOutput,
    batchHash: item.batchHash,
    source: item.source,
    status: item.status,
    assignee: item.assignee,
    reviewedBy: item.reviewedBy,
    reviewedAt: item.reviewedAt,
    note: item.note,
  }));
}

function studioAnnotationConflictPermissionHash(conflict: StudioAnnotationQueueConflict): string {
  return hashAnnotationConflict(JSON.stringify({
    itemId: conflict.itemId,
    status: conflict.status,
    resolution: conflict.resolution,
    existingStatus: conflict.existingStatus,
    incomingStatus: conflict.incomingStatus,
    existingReviewer: conflict.existingReviewer,
    incomingReviewer: conflict.incomingReviewer,
    existingAssignee: conflict.existingAssignee,
    incomingAssignee: conflict.incomingAssignee,
    existingNote: conflict.existingNote,
    incomingNote: conflict.incomingNote,
    curationThread: conflict.curationThread,
    resolvedAt: conflict.resolvedAt,
    resolvedBy: conflict.resolvedBy,
  }));
}

function annotationActorMatches(value: string, actorId: string): boolean {
  return normalizeAnnotationActorId(value) === normalizeAnnotationActorId(actorId);
}

function normalizeAnnotationActorId(value: string): string {
  return value.trim().toLowerCase();
}

function syncStudioAnnotationQueue(items: unknown[]): StudioAnnotationQueueItem[] {
  const byId = new Map<string, StudioAnnotationQueueItem>();
  for (const item of items.map(normalizeStudioAnnotationQueueItem).filter((entry): entry is StudioAnnotationQueueItem => entry !== null)) {
    const existing = byId.get(item.id);
    if (!existing || Date.parse(existing.updatedAt) <= Date.parse(item.updatedAt)) {
      byId.set(item.id, item);
    }
  }
  return sortStudioAnnotationQueueItems(Array.from(byId.values()));
}

function sortStudioAnnotationQueueItems(items: StudioAnnotationQueueItem[]): StudioAnnotationQueueItem[] {
  return [...items].sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === "pending" ? -1 : right.status === "pending" ? 1 : left.status.localeCompare(right.status);
    }
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });
}

function normalizeStudioAnnotationQueueItem(value: unknown): StudioAnnotationQueueItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : "";
  const scenarioId = typeof value.scenarioId === "string" && value.scenarioId.trim() ? value.scenarioId.trim() : "";
  if (!id || !scenarioId) {
    return null;
  }
  const createdAt = typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString();
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : createdAt;
  return {
    id,
    scenarioId,
    scenarioLabel: typeof value.scenarioLabel === "string" && value.scenarioLabel.trim() ? value.scenarioLabel.trim() : scenarioId,
    sessionId: typeof value.sessionId === "string" && value.sessionId.trim() ? value.sessionId.trim() : null,
    runId: typeof value.runId === "string" && value.runId.trim() ? value.runId.trim() : null,
    resultStatus: value.resultStatus === "error" ? "error" : "ok",
    comparisonSeverity: normalizeStudioAnnotationComparisonSeverity(value.comparisonSeverity),
    verdict: typeof value.verdict === "string" ? value.verdict : "",
    reasons: Array.isArray(value.reasons)
      ? value.reasons.filter((reason): reason is string => typeof reason === "string" && reason.trim().length > 0)
      : [],
    observedOutput: typeof value.observedOutput === "string" ? value.observedOutput : "",
    batchHash: typeof value.batchHash === "string" ? value.batchHash : "",
    source: value.source === "manual" ? "manual" : "batch-result",
    status: normalizeStudioAnnotationStatus(value.status),
    assignee: typeof value.assignee === "string" ? value.assignee.trim() : "",
    reviewedBy: typeof value.reviewedBy === "string" ? value.reviewedBy.trim() : "",
    reviewedAt: value.reviewedAt === null || typeof value.reviewedAt === "string" ? value.reviewedAt : null,
    note: typeof value.note === "string" ? value.note : "",
    createdAt,
    updatedAt,
  };
}

function normalizeStudioAnnotationComparisonSeverity(value: unknown): StudioAnnotationComparisonSeverity {
  if (value === "warn" || value === "fail" || value === "missing" || value === "error") {
    return value;
  }
  return "pass";
}

function normalizeStudioAnnotationStatus(value: unknown): StudioAnnotationStatus {
  if (value === "accepted" || value === "rejected") {
    return value;
  }
  return "pending";
}

function normalizeNullableStudioAnnotationStatus(value: unknown): StudioAnnotationStatus | null {
  if (value === "pending" || value === "accepted" || value === "rejected") {
    return value;
  }
  return null;
}

function normalizeStudioAnnotationConflictCurationAction(
  value: unknown,
): StudioAnnotationConflictCurationAction | null {
  return value === "assign" || value === "release" ? value : null;
}

function resolveStudioAnnotationConflictCurationActor(
  payload: unknown,
  context: StudioAnnotationQueueMutationContext,
): string {
  if (isRecord(payload)) {
    for (const key of ["actor", "actorId", "assignee", "resolvedBy", "updatedBy"]) {
      const value = payload[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return context.actorId?.trim() || "local-studio";
}

function resolveStudioAnnotationConflictCurationNote(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }
  return typeof payload.note === "string" ? payload.note.trim() : "";
}

function defaultStudioAnnotationConflictCurationThread(): StudioAnnotationConflictCurationThread {
  return {
    status: "unassigned",
    assignee: "",
    openedAt: null,
    updatedAt: null,
    lastActor: "",
    lastAction: null,
    leaseExpiresAt: null,
    leaseDurationHours: null,
    leaseExpired: false,
    note: "",
    events: [],
    governance: {
      excludesRawRunEvents: true,
      excludesObservedOutputs: true,
      excludesSecretValues: true,
      autoReleasesExpiredAssignments: true,
      configuredLeaseHoursEnv: STUDIO_ANNOTATION_CONFLICT_CURATION_LEASE_HOURS_ENV,
    },
  };
}

function normalizeStudioAnnotationConflictCurationThread(
  value: unknown,
): StudioAnnotationConflictCurationThread {
  if (!isRecord(value)) {
    return defaultStudioAnnotationConflictCurationThread();
  }
  const assignee = typeof value.assignee === "string" && value.assignee.trim() ? value.assignee.trim() : "";
  const status = normalizeStudioAnnotationConflictCurationStatus(value.status) ?? (assignee ? "assigned" : "unassigned");
  const updatedAt = typeof value.updatedAt === "string" && value.updatedAt.trim() ? value.updatedAt.trim() : null;
  const leaseDurationHours = normalizeStudioAnnotationCurationLeaseHours(value.leaseDurationHours);
  const leaseExpiresAt =
    status === "assigned"
      ? normalizeDateString(value.leaseExpiresAt) ?? (updatedAt ? addHoursIso(updatedAt, leaseDurationHours) : null)
      : null;
  const normalized: StudioAnnotationConflictCurationThread = {
    status,
    assignee: status === "unassigned" ? "" : assignee,
    openedAt: typeof value.openedAt === "string" && value.openedAt.trim() ? value.openedAt.trim() : null,
    updatedAt,
    lastActor: typeof value.lastActor === "string" && value.lastActor.trim() ? value.lastActor.trim() : "",
    lastAction: normalizeStudioAnnotationConflictCurationLastAction(value.lastAction),
    leaseExpiresAt,
    leaseDurationHours: status === "assigned" ? leaseDurationHours : null,
    leaseExpired: status !== "assigned" && value.leaseExpired === true,
    note: typeof value.note === "string" ? value.note.trim() : "",
    events: Array.isArray(value.events)
      ? value.events
          .map(normalizeStudioAnnotationConflictCurationEvent)
          .filter((event): event is StudioAnnotationConflictCurationEvent => event !== null)
          .sort((left, right) => right.at.localeCompare(left.at))
          .slice(0, 12)
      : [],
    governance: {
      excludesRawRunEvents: true,
      excludesObservedOutputs: true,
      excludesSecretValues: true,
      autoReleasesExpiredAssignments: true,
      configuredLeaseHoursEnv: STUDIO_ANNOTATION_CONFLICT_CURATION_LEASE_HOURS_ENV,
    },
  };
  return expireStudioAnnotationConflictCurationThreadIfNeeded(normalized);
}

function normalizeStudioAnnotationConflictCurationStatus(
  value: unknown,
): StudioAnnotationConflictCurationStatus | null {
  if (value === "unassigned" || value === "assigned" || value === "resolved") {
    return value;
  }
  return null;
}

function normalizeStudioAnnotationConflictCurationLastAction(
  value: unknown,
): StudioAnnotationConflictCurationLastAction | null {
  if (value === "assign" || value === "release" || value === "resolve" || value === "lease_expired") {
    return value;
  }
  return null;
}

function normalizeStudioAnnotationConflictCurationEvent(
  value: unknown,
): StudioAnnotationConflictCurationEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  const at = typeof value.at === "string" && value.at.trim() ? value.at.trim() : "";
  const actor = typeof value.actor === "string" && value.actor.trim() ? value.actor.trim().slice(0, 120) : "";
  const action = normalizeStudioAnnotationConflictCurationLastAction(value.action);
  if (!at || !actor || !action) {
    return null;
  }
  const assignee = typeof value.assignee === "string" && value.assignee.trim() ? value.assignee.trim().slice(0, 120) : "";
  const note = typeof value.note === "string" && value.note.trim() ? value.note.trim().slice(0, 280) : "";
  const id = typeof value.id === "string" && value.id.trim()
    ? value.id.trim().slice(0, 160)
    : `annotation-conflict-curation-${hashAnnotationConflict(JSON.stringify({ at, actor, action, assignee, note }))}`;
  return {
    id,
    at,
    actor,
    action,
    assignee,
    note,
  };
}

function mergeStudioAnnotationConflictCurationEvents(
  existing: StudioAnnotationConflictCurationEvent[],
  incoming: StudioAnnotationConflictCurationEvent[],
): StudioAnnotationConflictCurationEvent[] {
  const byId = new Map<string, StudioAnnotationConflictCurationEvent>();
  for (const event of [...existing, ...incoming]) {
    byId.set(event.id, event);
  }
  return Array.from(byId.values())
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, 12);
}

function buildStudioAnnotationConflictCurationEvent(
  action: StudioAnnotationConflictCurationLastAction,
  actor: string,
  assignee: string,
  note: string,
  at: string,
): StudioAnnotationConflictCurationEvent {
  const normalizedNote = note.trim().slice(0, 280);
  return {
    id: `annotation-conflict-curation-${hashAnnotationConflict(JSON.stringify({
      at,
      actor,
      action,
      assignee,
      note: normalizedNote,
    }))}`,
    at,
    actor,
    action,
    assignee,
    note: normalizedNote,
  };
}

function updateStudioAnnotationConflictCurationThread(
  thread: StudioAnnotationConflictCurationThread,
  action: StudioAnnotationConflictCurationAction,
  actor: string,
  note: string,
  at: string,
): StudioAnnotationConflictCurationThread {
  const normalized = normalizeStudioAnnotationConflictCurationThread(thread);
  if (action === "release") {
    const event = buildStudioAnnotationConflictCurationEvent("release", actor, "", note, at);
    return {
      ...normalized,
      status: "unassigned",
      assignee: "",
      updatedAt: at,
      lastActor: actor,
      lastAction: "release",
      leaseExpiresAt: null,
      leaseDurationHours: null,
      leaseExpired: false,
      note,
      events: mergeStudioAnnotationConflictCurationEvents([event], normalized.events),
    };
  }
  const leaseDurationHours = readStudioAnnotationCurationLeaseHours();
  const event = buildStudioAnnotationConflictCurationEvent("assign", actor, actor, note, at);
  return {
    ...normalized,
    status: "assigned",
    assignee: actor,
    openedAt: normalized.openedAt ?? at,
    updatedAt: at,
    lastActor: actor,
    lastAction: "assign",
    leaseExpiresAt: addHoursIso(at, leaseDurationHours),
    leaseDurationHours,
    leaseExpired: false,
    note,
    events: mergeStudioAnnotationConflictCurationEvents([event], normalized.events),
  };
}

function resolveStudioAnnotationConflictCurationThread(
  thread: StudioAnnotationConflictCurationThread,
  actor: string,
  note: string,
  at: string,
): StudioAnnotationConflictCurationThread {
  const normalized = normalizeStudioAnnotationConflictCurationThread(thread);
  const assignee = normalized.assignee || actor;
  const resolvedNote = note || normalized.note;
  const event = buildStudioAnnotationConflictCurationEvent("resolve", actor, assignee, resolvedNote, at);
  return {
    ...normalized,
    status: "resolved",
    assignee,
    openedAt: normalized.openedAt ?? at,
    updatedAt: at,
    lastActor: actor,
    lastAction: "resolve",
    leaseExpiresAt: null,
    leaseDurationHours: null,
    leaseExpired: false,
    note: resolvedNote,
    events: mergeStudioAnnotationConflictCurationEvents([event], normalized.events),
  };
}

function expireStudioAnnotationConflictCurationThreadIfNeeded(
  thread: StudioAnnotationConflictCurationThread,
  now = new Date(),
): StudioAnnotationConflictCurationThread {
  if (thread.status !== "assigned" || !thread.leaseExpiresAt) {
    return thread;
  }
  const expiresAt = Date.parse(thread.leaseExpiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt > now.getTime()) {
    return thread;
  }
  const expiredAt = new Date(Math.max(expiresAt, Date.parse(thread.updatedAt ?? "") || expiresAt)).toISOString();
  const actor = thread.assignee || thread.lastActor || "local-studio";
  const event = buildStudioAnnotationConflictCurationEvent(
    "lease_expired",
    actor,
    "",
    "Lease de curadoria expirado; conflito liberado automaticamente.",
    expiredAt,
  );
  return {
    ...thread,
    status: "unassigned",
    assignee: "",
    updatedAt: expiredAt,
    lastActor: actor,
    lastAction: "lease_expired",
    leaseExpiresAt: null,
    leaseDurationHours: null,
    leaseExpired: true,
    note: event.note,
    events: mergeStudioAnnotationConflictCurationEvents([event], thread.events),
  };
}

function readStudioAnnotationCurationLeaseHours(): number {
  return normalizeStudioAnnotationCurationLeaseHours(process.env[STUDIO_ANNOTATION_CONFLICT_CURATION_LEASE_HOURS_ENV]);
}

function normalizeStudioAnnotationCurationLeaseHours(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return STUDIO_ANNOTATION_CONFLICT_CURATION_LEASE_HOURS;
  }
  return Math.min(Math.max(numeric, 1 / 60), 24 * 30);
}

function addHoursIso(value: string, hours: number): string {
  const parsed = Date.parse(value);
  const base = Number.isFinite(parsed) ? parsed : Date.now();
  return new Date(base + hours * 60 * 60 * 1000).toISOString();
}

function normalizeDateString(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeStudioAnnotationAuditAction(value: unknown): StudioAnnotationAuditAction | null {
  if (
    value === "item_created" ||
    value === "conflict_detected" ||
    value === "conflict_curated" ||
    value === "conflict_resolved" ||
    value === "item_status_changed" ||
    value === "item_assigned" ||
    value === "item_note_updated" ||
    value === "item_deleted" ||
    value === "queue_imported" ||
    value === "queue_synced"
  ) {
    return value;
  }
  return null;
}

function defaultStudioAnnotationPermissionPolicy(): StudioAnnotationQueuePermissionPolicy {
  return {
    mode: "open",
    reviewers: [],
    updatedAt: new Date().toISOString(),
    updatedBy: "system",
  };
}

function normalizeStudioAnnotationPermissionPolicy(value: unknown): StudioAnnotationQueuePermissionPolicy {
  if (!isRecord(value)) {
    return defaultStudioAnnotationPermissionPolicy();
  }
  return {
    mode: value.mode === "assignee_only" ? "assignee_only" : "open",
    reviewers: normalizeStudioAnnotationReviewers(value.reviewers),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
    updatedBy: typeof value.updatedBy === "string" && value.updatedBy.trim() ? value.updatedBy.trim() : "system",
  };
}

function normalizeStudioAnnotationReviewers(value: unknown): StudioAnnotationQueueReviewer[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const byName = new Map<string, StudioAnnotationQueueReviewer>();
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : "";
    if (!name) {
      continue;
    }
    const reviewer: StudioAnnotationQueueReviewer = {
      name,
      role: normalizeStudioAnnotationReviewerRole(entry.role),
      updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : new Date().toISOString(),
    };
    const existing = byName.get(name);
    if (!existing || Date.parse(existing.updatedAt) <= Date.parse(reviewer.updatedAt)) {
      byName.set(name, reviewer);
    }
  }
  return Array.from(byName.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeStudioAnnotationReviewerRole(value: unknown): StudioAnnotationReviewerRole {
  if (value === "owner" || value === "viewer") {
    return value;
  }
  return "reviewer";
}

function newestStudioAnnotationPermissionPolicy(
  existing: StudioAnnotationQueuePermissionPolicy,
  incoming: StudioAnnotationQueuePermissionPolicy,
): StudioAnnotationQueuePermissionPolicy {
  return Date.parse(incoming.updatedAt) >= Date.parse(existing.updatedAt) ? incoming : existing;
}

function syncStudioAnnotationQueueConflicts(
  conflicts: unknown[],
  items: StudioAnnotationQueueItem[],
): StudioAnnotationQueueConflict[] {
  const itemIds = new Set(items.map((item) => item.id));
  const byId = new Map<string, StudioAnnotationQueueConflict>();
  for (const conflict of conflicts
    .map((entry) => normalizeStudioAnnotationQueueConflict(entry, itemIds))
    .filter((entry): entry is StudioAnnotationQueueConflict => entry !== null)) {
    byId.set(conflict.id, conflict);
  }
  return Array.from(byId.values()).sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === "open" ? -1 : 1;
    }
    return Date.parse(right.createdAt) - Date.parse(left.createdAt);
  });
}

function syncStudioAnnotationQueueAuditEntries(auditEntries: unknown[]): StudioAnnotationQueueAuditEntry[] {
  const byId = new Map<string, StudioAnnotationQueueAuditEntry>();
  for (const entry of auditEntries
    .map(normalizeStudioAnnotationQueueAuditEntry)
    .filter((item): item is StudioAnnotationQueueAuditEntry => item !== null)) {
    byId.set(entry.id, entry);
  }
  return Array.from(byId.values()).sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
}

function buildStudioAnnotationQueueResolutionHistory(
  conflicts: unknown[],
  items: StudioAnnotationQueueItem[],
): StudioAnnotationQueueResolutionRecord[] {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const byId = new Map<string, StudioAnnotationQueueResolutionRecord>();
  for (const conflict of conflicts
    .map((entry) => normalizeStudioAnnotationQueueConflict(entry, new Set(items.map((item) => item.id))))
    .filter((entry): entry is StudioAnnotationQueueConflict => entry !== null && entry.status === "resolved")) {
    const record = buildStudioAnnotationQueueResolutionRecord(conflict, itemById.get(conflict.itemId) ?? null);
    if (!record) {
      continue;
    }
    const current = byId.get(record.resolutionId);
    if (!current || record.resolvedAt.localeCompare(current.resolvedAt) >= 0) {
      byId.set(record.resolutionId, record);
    }
  }
  return Array.from(byId.values()).sort((left, right) => right.resolvedAt.localeCompare(left.resolvedAt)).slice(0, 128);
}

function buildStudioAnnotationQueueResolutionRecord(
  conflict: StudioAnnotationQueueConflict,
  currentItem: StudioAnnotationQueueItem | null,
): StudioAnnotationQueueResolutionRecord | null {
  if (conflict.status !== "resolved" || !conflict.resolvedAt) {
    return null;
  }
  const existingRef = studioAnnotationQueueResolutionRef(conflict.existingSnapshot);
  const incomingRef = studioAnnotationQueueResolutionRef(conflict.incomingSnapshot);
  const currentRef = currentItem ? studioAnnotationQueueResolutionRef(currentItem) : null;
  const keptRef =
    conflict.resolution === "existing"
      ? existingRef
      : conflict.resolution === "incoming"
        ? incomingRef
        : currentRef ?? incomingRef;
  const candidateRefs = [existingRef, incomingRef];
  const discardedRefs = candidateRefs.filter((ref) => !studioAnnotationQueueResolutionRefsMatch(ref, keptRef));
  return {
    resolutionId: `annotation-resolution-${hashAnnotationConflict([
      conflict.id,
      conflict.itemId,
      conflict.resolvedAt,
      conflict.resolvedBy,
      conflict.resolution,
      keptRef.observedOutputHash,
      keptRef.updatedAt,
    ].join("|"))}`,
    conflictId: conflict.id,
    itemId: conflict.itemId,
    resolvedAt: conflict.resolvedAt,
    resolvedBy: conflict.resolvedBy || conflict.curationThread.lastActor || "local-user",
    resolution: conflict.resolution,
    keptRef,
    discardedRefs,
    candidateCount: candidateRefs.length,
    governance: {
      excludesRawRunEvents: true,
      excludesObservedOutputs: true,
      excludesSecretValues: true,
    },
  };
}

function normalizeStudioAnnotationQueueResolutionRecord(
  value: unknown,
): StudioAnnotationQueueResolutionRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const conflictId = typeof value.conflictId === "string" && value.conflictId.trim() ? value.conflictId.trim() : "";
  const itemId = typeof value.itemId === "string" && value.itemId.trim() ? value.itemId.trim() : "";
  const resolvedAt = typeof value.resolvedAt === "string" && value.resolvedAt.trim() ? value.resolvedAt.trim() : "";
  const keptRef = normalizeStudioAnnotationQueueResolutionRef(value.keptRef);
  if (!conflictId || !itemId || !resolvedAt || !keptRef) {
    return null;
  }
  const discardedRefs = Array.isArray(value.discardedRefs)
    ? value.discardedRefs
        .map(normalizeStudioAnnotationQueueResolutionRef)
        .filter((ref): ref is StudioAnnotationQueueResolutionRef => ref !== null)
        .slice(0, 16)
    : [];
  const resolution =
    value.resolution === "existing" || value.resolution === "manual" || value.resolution === "incoming"
      ? value.resolution
      : "manual";
  return {
    resolutionId:
      typeof value.resolutionId === "string" && value.resolutionId.trim()
        ? value.resolutionId.trim()
        : `annotation-resolution-${hashAnnotationReview({ conflictId, itemId, resolvedAt, keptRef }).slice(0, 16)}`,
    conflictId,
    itemId,
    resolvedAt,
    resolvedBy:
      typeof value.resolvedBy === "string" && value.resolvedBy.trim() ? value.resolvedBy.trim() : "local-user",
    resolution,
    keptRef,
    discardedRefs,
    candidateCount: Math.max(1, toNonNegativeInteger(value.candidateCount) || discardedRefs.length + 1),
    governance: {
      excludesRawRunEvents: true,
      excludesObservedOutputs: true,
      excludesSecretValues: true,
    },
  };
}

function normalizeStudioAnnotationQueueResolutionRef(
  value: unknown,
): StudioAnnotationQueueResolutionRef | null {
  if (!isRecord(value)) {
    return null;
  }
  const itemId = typeof value.itemId === "string" && value.itemId.trim() ? value.itemId.trim() : "";
  const updatedAt = typeof value.updatedAt === "string" && value.updatedAt.trim() ? value.updatedAt.trim() : "";
  if (!itemId || !updatedAt) {
    return null;
  }
  return {
    itemId,
    status: normalizeStudioAnnotationStatus(value.status),
    reviewer: typeof value.reviewer === "string" ? value.reviewer.trim() : "",
    assignee: typeof value.assignee === "string" ? value.assignee.trim() : "",
    reviewedAt: value.reviewedAt === null || typeof value.reviewedAt === "string" ? value.reviewedAt : null,
    noteHash: typeof value.noteHash === "string" ? value.noteHash.trim() : "",
    verdictHash: typeof value.verdictHash === "string" ? value.verdictHash.trim() : "",
    observedOutputHash: typeof value.observedOutputHash === "string" ? value.observedOutputHash.trim() : "",
    batchHash: typeof value.batchHash === "string" ? value.batchHash.trim() : "",
    updatedAt,
  };
}

function resolveStudioAnnotationResolvedReplay(
  existing: StudioAnnotationQueueItem,
  incoming: StudioAnnotationQueueItem,
  history: StudioAnnotationQueueResolutionRecord[],
): "keep_existing" | "use_incoming" | null {
  if (!history.length) {
    return null;
  }
  const existingRef = studioAnnotationQueueResolutionRef(existing);
  const incomingRef = studioAnnotationQueueResolutionRef(incoming);
  for (const record of history) {
    if (record.itemId !== incoming.id) {
      continue;
    }
    const existingIsKept = studioAnnotationQueueResolutionRefsMatch(existingRef, record.keptRef);
    const incomingIsKept = studioAnnotationQueueResolutionRefsMatch(incomingRef, record.keptRef);
    const existingIsDiscarded = record.discardedRefs.some((ref) =>
      studioAnnotationQueueResolutionRefsMatch(existingRef, ref),
    );
    const incomingIsDiscarded = record.discardedRefs.some((ref) =>
      studioAnnotationQueueResolutionRefsMatch(incomingRef, ref),
    );
    if (existingIsKept && incomingIsDiscarded) {
      return "keep_existing";
    }
    if (existingIsDiscarded && incomingIsKept) {
      return "use_incoming";
    }
  }
  return null;
}

function studioAnnotationQueueResolutionRef(item: StudioAnnotationQueueItem): StudioAnnotationQueueResolutionRef {
  return {
    itemId: item.id,
    status: item.status,
    reviewer: item.reviewedBy,
    assignee: item.assignee,
    reviewedAt: item.reviewedAt,
    noteHash: hashAnnotationConflict(item.note),
    verdictHash: hashAnnotationConflict(item.verdict),
    observedOutputHash: hashAnnotationConflict(item.observedOutput),
    batchHash: item.batchHash,
    updatedAt: item.updatedAt,
  };
}

function studioAnnotationQueueResolutionRefsMatch(
  left: StudioAnnotationQueueResolutionRef,
  right: StudioAnnotationQueueResolutionRef,
): boolean {
  return (
    left.itemId === right.itemId &&
    left.status === right.status &&
    left.reviewer === right.reviewer &&
    left.assignee === right.assignee &&
    left.reviewedAt === right.reviewedAt &&
    left.noteHash === right.noteHash &&
    left.verdictHash === right.verdictHash &&
    left.observedOutputHash === right.observedOutputHash &&
    left.batchHash === right.batchHash
  );
}

function normalizeStudioAnnotationQueueConflict(
  value: unknown,
  itemIds: Set<string>,
): StudioAnnotationQueueConflict | null {
  if (!isRecord(value)) {
    return null;
  }
  const itemId = typeof value.itemId === "string" && value.itemId.trim() ? value.itemId.trim() : "";
  if (!itemId || !itemIds.has(itemId)) {
    return null;
  }
  const existingUpdatedAt = typeof value.existingUpdatedAt === "string" ? value.existingUpdatedAt : "";
  const incomingUpdatedAt = typeof value.incomingUpdatedAt === "string" ? value.incomingUpdatedAt : "";
  const existingStatus = normalizeStudioAnnotationStatus(value.existingStatus);
  const incomingStatus = normalizeStudioAnnotationStatus(value.incomingStatus);
  const existingReviewer = typeof value.existingReviewer === "string" ? value.existingReviewer.trim() : "";
  const incomingReviewer = typeof value.incomingReviewer === "string" ? value.incomingReviewer.trim() : "";
  const existingAssignee = typeof value.existingAssignee === "string" ? value.existingAssignee.trim() : "";
  const incomingAssignee = typeof value.incomingAssignee === "string" ? value.incomingAssignee.trim() : "";
  const existingNote = typeof value.existingNote === "string" ? value.existingNote : "";
  const incomingNote = typeof value.incomingNote === "string" ? value.incomingNote : "";
  const status = value.status === "resolved" ? "resolved" : "open";
  const resolvedAt = value.resolvedAt === null || typeof value.resolvedAt === "string" ? value.resolvedAt : null;
  const resolvedBy = typeof value.resolvedBy === "string" ? value.resolvedBy.trim() : "";
  const normalizedCurationThread = normalizeStudioAnnotationConflictCurationThread(value.curationThread);
  const id =
    typeof value.id === "string" && value.id.trim()
      ? value.id.trim()
      : `annotation-conflict-${safeAnnotationIdSegment(itemId)}-${hashAnnotationConflict([
          itemId,
          existingUpdatedAt,
          incomingUpdatedAt,
          existingStatus,
          incomingStatus,
        ].join("|"))}`;
  return {
    id,
    itemId,
    status,
    resolution:
      value.resolution === "existing" || value.resolution === "manual" || value.resolution === "incoming"
        ? value.resolution
        : "incoming",
    curationThread:
      status === "resolved" && normalizedCurationThread.status !== "resolved"
        ? resolveStudioAnnotationConflictCurationThread(
            normalizedCurationThread,
            resolvedBy || "local-studio",
            "",
            resolvedAt ?? new Date().toISOString(),
          )
        : normalizedCurationThread,
    existingSnapshot: normalizeStudioAnnotationConflictSnapshot(value.existingSnapshot, {
      id: itemId,
      status: existingStatus,
      reviewer: existingReviewer,
      assignee: existingAssignee,
      note: existingNote,
      updatedAt: existingUpdatedAt,
    }),
    incomingSnapshot: normalizeStudioAnnotationConflictSnapshot(value.incomingSnapshot, {
      id: itemId,
      status: incomingStatus,
      reviewer: incomingReviewer,
      assignee: incomingAssignee,
      note: incomingNote,
      updatedAt: incomingUpdatedAt,
    }),
    existingStatus,
    incomingStatus,
    existingReviewer,
    incomingReviewer,
    existingAssignee,
    incomingAssignee,
    existingNote,
    incomingNote,
    existingUpdatedAt,
    incomingUpdatedAt,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    resolvedAt,
    resolvedBy,
  };
}

function normalizeStudioAnnotationConflictSnapshot(
  value: unknown,
  fallback: {
    id: string;
    status: StudioAnnotationStatus;
    reviewer: string;
    assignee: string;
    note: string;
    updatedAt: string;
  },
): StudioAnnotationQueueItem {
  const normalized = normalizeStudioAnnotationQueueItem(value);
  if (normalized && normalized.id === fallback.id) {
    return normalized;
  }
  const record = isRecord(value) ? value : {};
  const timestamp = fallback.updatedAt || new Date().toISOString();
  const fallbackItem = normalizeStudioAnnotationQueueItem({
    id: fallback.id,
    scenarioId:
      typeof record.scenarioId === "string" && record.scenarioId.trim()
        ? record.scenarioId.trim()
        : fallback.id,
    scenarioLabel:
      typeof record.scenarioLabel === "string" && record.scenarioLabel.trim()
        ? record.scenarioLabel.trim()
        : fallback.id,
    sessionId: null,
    runId: null,
    resultStatus: "ok",
    comparisonSeverity: "pass",
    verdict: typeof record.verdict === "string" ? record.verdict : "",
    reasons: Array.isArray(record.reasons) ? record.reasons : [],
    observedOutput: typeof record.observedOutput === "string" ? record.observedOutput : "",
    batchHash: typeof record.batchHash === "string" ? record.batchHash : "",
    source: "manual",
    status: fallback.status,
    assignee: fallback.assignee,
    reviewedBy: fallback.reviewer,
    reviewedAt: null,
    note: fallback.note,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  if (!fallbackItem) {
    throw new WorkspaceError("Snapshot de conflito de anotação inválido.", 500);
  }
  return fallbackItem;
}

function normalizeStudioAnnotationQueueAuditEntry(value: unknown): StudioAnnotationQueueAuditEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const action = normalizeStudioAnnotationAuditAction(value.action);
  const at = typeof value.at === "string" ? value.at : typeof value.createdAt === "string" ? value.createdAt : "";
  if (!action || !at) {
    return null;
  }
  const itemId = typeof value.itemId === "string" && value.itemId.trim() ? value.itemId.trim() : null;
  const conflictId = typeof value.conflictId === "string" && value.conflictId.trim() ? value.conflictId.trim() : null;
  const actor = typeof value.actor === "string" && value.actor.trim() ? value.actor.trim() : "local-user";
  const summary = typeof value.summary === "string" && value.summary.trim() ? value.summary.trim() : action;
  const id =
    typeof value.id === "string" && value.id.trim()
      ? value.id.trim()
      : `annotation-audit-${hashAnnotationConflict([
          action,
          itemId ?? "",
          conflictId ?? "",
          actor,
          at,
          summary,
        ].join("|"))}`;
  return {
    id,
    action,
    itemId,
    conflictId,
    actor,
    at,
    summary,
    beforeStatus: normalizeNullableStudioAnnotationStatus(value.beforeStatus),
    afterStatus: normalizeNullableStudioAnnotationStatus(value.afterStatus),
    beforeAssignee: typeof value.beforeAssignee === "string" ? value.beforeAssignee.trim() : "",
    afterAssignee: typeof value.afterAssignee === "string" ? value.afterAssignee.trim() : "",
  };
}

function shouldCreateStudioAnnotationConflict(
  existing: StudioAnnotationQueueItem,
  incoming: StudioAnnotationQueueItem,
): boolean {
  const existingActor = studioAnnotationReviewActor(existing);
  const incomingActor = studioAnnotationReviewActor(incoming);
  if (!existingActor || !incomingActor || existingActor === incomingActor) {
    return false;
  }
  if (!studioAnnotationWasReviewed(existing) || !studioAnnotationWasReviewed(incoming)) {
    return false;
  }
  return (
    existing.status !== incoming.status ||
    existing.note !== incoming.note ||
    existing.assignee !== incoming.assignee ||
    existing.reviewedBy !== incoming.reviewedBy
  );
}

function buildStudioAnnotationAuditEntry(input: {
  action: StudioAnnotationAuditAction;
  itemId: string | null;
  conflictId: string | null;
  actor: string;
  at: string;
  summary: string;
  beforeStatus?: StudioAnnotationStatus | null;
  afterStatus?: StudioAnnotationStatus | null;
  beforeAssignee?: string;
  afterAssignee?: string;
}): StudioAnnotationQueueAuditEntry {
  const id = `annotation-audit-${hashAnnotationConflict([
    input.action,
    input.itemId ?? "",
    input.conflictId ?? "",
    input.actor,
    input.at,
    input.summary,
  ].join("|"))}`;
  return {
    id,
    action: input.action,
    itemId: input.itemId,
    conflictId: input.conflictId,
    actor: input.actor.trim() || "local-user",
    at: input.at,
    summary: input.summary,
    beforeStatus: input.beforeStatus ?? null,
    afterStatus: input.afterStatus ?? null,
    beforeAssignee: input.beforeAssignee ?? "",
    afterAssignee: input.afterAssignee ?? "",
  };
}

function buildStudioAnnotationQueueConflict(
  existing: StudioAnnotationQueueItem,
  incoming: StudioAnnotationQueueItem,
): StudioAnnotationQueueConflict {
  const resolution = Date.parse(incoming.updatedAt) >= Date.parse(existing.updatedAt) ? "incoming" : "existing";
  const conflictHash = hashAnnotationConflict([
    existing.id,
    existing.status,
    incoming.status,
    existing.reviewedBy,
    incoming.reviewedBy,
    existing.assignee,
    incoming.assignee,
    existing.updatedAt,
    incoming.updatedAt,
  ].join("|"));
  return {
    id: `annotation-conflict-${safeAnnotationIdSegment(existing.id)}-${conflictHash}`,
    itemId: existing.id,
    status: "open",
    resolution,
    curationThread: defaultStudioAnnotationConflictCurationThread(),
    existingSnapshot: existing,
    incomingSnapshot: incoming,
    existingStatus: existing.status,
    incomingStatus: incoming.status,
    existingReviewer: existing.reviewedBy,
    incomingReviewer: incoming.reviewedBy,
    existingAssignee: existing.assignee,
    incomingAssignee: incoming.assignee,
    existingNote: existing.note,
    incomingNote: incoming.note,
    existingUpdatedAt: existing.updatedAt,
    incomingUpdatedAt: incoming.updatedAt,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolvedBy: "",
  };
}

function studioAnnotationReviewActor(item: StudioAnnotationQueueItem): string {
  return (item.reviewedBy || item.assignee).trim();
}

function studioAnnotationWasReviewed(item: StudioAnnotationQueueItem): boolean {
  return item.status !== "pending" || item.reviewedAt !== null || item.reviewedBy.trim().length > 0;
}

function hashAnnotationConflict(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function hashAnnotationReview(value: unknown): string {
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

function toNonNegativeInteger(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
}

function formatSignedInteger(value: number): string {
  if (!Number.isFinite(value) || value === 0) {
    return "0";
  }
  return value > 0 ? `+${value}` : String(value);
}

function safeAnnotationIdSegment(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "item";
}

function buildStudioAnnotationAssigneeCounts(items: StudioAnnotationQueueItem[]): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const assignee = item.assignee || "sem responsável";
    counts[assignee] = (counts[assignee] ?? 0) + 1;
    return counts;
  }, {});
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateStudioAnnotationQueueCentralUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WorkspaceError(`URL da central da fila de anotação inválida: ${value}`, 422);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WorkspaceError(`URL da central da fila de anotação deve usar http ou https: ${value}`, 422);
  }
  if (url.username || url.password) {
    throw new WorkspaceError("URL da central da fila de anotação não pode conter usuário ou senha.", 422);
  }
  return url.toString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isFileNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
