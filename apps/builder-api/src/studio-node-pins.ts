import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadFlowById, WorkspaceError } from "./workspace.ts";

type StudioNodePinsSharedSyncAction = "empty" | "save" | "merge" | "resolve_conflict" | "curate_conflict";
type StudioNodePinConflictCurationStatus = "unassigned" | "assigned" | "resolved";
type StudioNodePinConflictCurationAction = "assign" | "release";
type StudioNodePinConflictCurationLastAction = StudioNodePinConflictCurationAction | "resolve" | "lease_expired";
type StudioNodePinConflictCuratorRole = "owner" | "reviewer" | "viewer";

interface StudioNodePinItem {
  id: string;
  nodeId: string;
  nodeType: string;
  runId: string;
  sessionId: string;
  eventSeq: number;
  eventType: string;
  nodeHash: string;
  input: unknown;
  output: unknown;
  createdAt: string;
  updatedAt: string;
}

interface StudioNodePinsMergeStats {
  incomingCount: number;
  existingCount: number;
  addedCount: number;
  updatedCount: number;
  unchangedCount: number;
  finalCount: number;
}

interface StudioNodePinConflictRef {
  id: string;
  nodeId: string;
  nodeType: string;
  runId: string;
  sessionId: string;
  eventSeq: number;
  eventType: string;
  nodeHash: string;
  updatedAt: string;
  contentHash: string;
}

interface StudioNodePinConflict {
  conflictId: string;
  status: "open";
  nodeId: string;
  pinCount: number;
  pinIds: string[];
  latestPinId: string;
  latestUpdatedAt: string;
  refs: StudioNodePinConflictRef[];
  candidates: StudioNodePinItem[];
  curationThread: StudioNodePinConflictCurationThread;
  governance: {
    includesPinInputOutput: true;
    redactsSecretLikeKeys: true;
    excludesSecretValues: true;
  };
}

interface StudioNodePinConflictCurationThread {
  status: StudioNodePinConflictCurationStatus;
  assignee: string;
  openedAt: string | null;
  updatedAt: string | null;
  lastActor: string;
  lastAction: StudioNodePinConflictCurationLastAction | null;
  leaseExpiresAt: string | null;
  leaseDurationHours: number | null;
  leaseExpired: boolean;
  note: string;
  events: StudioNodePinConflictCurationEvent[];
  governance: {
    excludesRawPinInputOutput: true;
    redactsSecretLikeKeys: true;
    excludesSecretValues: true;
    autoReleasesExpiredAssignments: true;
    configuredLeaseHoursEnv: typeof STUDIO_NODE_PIN_CONFLICT_CURATION_LEASE_HOURS_ENV;
  };
}

interface StudioNodePinConflictCurationEvent {
  id: string;
  at: string;
  actor: string;
  role: StudioNodePinConflictCuratorRole;
  action: StudioNodePinConflictCurationLastAction;
  assignee: string;
  note: string;
}

interface StudioNodePinResolutionRecord {
  resolutionId: string;
  conflictId: string;
  nodeId: string;
  resolvedAt: string;
  resolvedBy: string;
  resolvedRole: StudioNodePinConflictCuratorRole;
  resolutionNote: string;
  keptPinId: string;
  keptRef: StudioNodePinConflictRef;
  discardedRefs: StudioNodePinConflictRef[];
  candidateCount: number;
  governance: {
    excludesSecretValues: true;
    excludesRawPinInputOutput: true;
    redactsSecretLikeKeys: true;
  };
}

interface StudioNodePinConflictReview {
  conflictId: string;
  status: "open";
  nodeId: string;
  pinCount: number;
  pinIds: string[];
  latestPinId: string;
  latestUpdatedAt: string;
  refs: StudioNodePinConflictRef[];
  pinContentHashes: string[];
  curationThread: StudioNodePinConflictCurationThread;
  governance: {
    excludesCandidates: true;
    excludesRawPinInputOutput: true;
    redactsSecretLikeKeys: true;
    excludesSecretValues: true;
    includesOnlyRefsThreadsAndResolutionHistory: true;
  };
}

interface StudioNodePinConflictReviewSummary {
  conflictCount: number;
  nodeCount: number;
  assignedConflictCount: number;
  unassignedConflictCount: number;
  resolvedThreadCount: number;
}

interface StudioNodePinConflictReviewPackage {
  format: typeof STUDIO_NODE_PINS_CONFLICT_REVIEW_FORMAT;
  generatedAt: string;
  flowId: string;
  packageHash: string;
  conflictCount: number;
  openConflictCount: number;
  resolutionHistoryCount: number;
  conflicts: StudioNodePinConflictReview[];
  resolutionHistory: StudioNodePinResolutionRecord[];
  summary: StudioNodePinConflictReviewSummary;
  governance: {
    excludesCandidates: true;
    excludesRawPinInputOutput: true;
    redactsSecretLikeKeys: true;
    excludesSecretValues: true;
    includesOnlyRefsThreadsAndResolutionHistory: true;
    localWorkspaceFile: true;
  };
}

type StudioNodePinConflictReviewDiffItemStatus = "same" | "changed" | "only_current" | "only_incoming";

interface StudioNodePinConflictReviewDiffItem {
  id: string;
  label: string;
  status: StudioNodePinConflictReviewDiffItemStatus;
  current: string;
  incoming: string;
  delta: number;
}

interface StudioNodePinConflictReviewDiffSection {
  id: string;
  title: string;
  status: "same" | "changed";
  statusLabel: "igual" | "alterado";
  summary: string;
  items: StudioNodePinConflictReviewDiffItem[];
}

export interface StudioNodePinsPackage {
  format: typeof STUDIO_NODE_PINS_FORMAT;
  exportedAt: string;
  flowId: string;
  packageHash: string;
  pinCount: number;
  pins: StudioNodePinItem[];
  conflictCount: number;
  openConflictCount: number;
  conflicts: StudioNodePinConflict[];
  resolutionHistoryCount: number;
  resolutionHistory: StudioNodePinResolutionRecord[];
  sharedSync: {
    action: StudioNodePinsSharedSyncAction;
    updatedAt: string;
    storage: typeof STUDIO_NODE_PINS_FILE;
    contentHash: string;
    incomingCount: number;
    existingCount: number;
    addedCount: number;
    updatedCount: number;
    unchangedCount: number;
    finalCount: number;
    conflictCount: number;
    openConflictCount: number;
    governance: {
      includesPinInputOutput: true;
      redactsSecretLikeKeys: true;
      excludesSecretValues: true;
      excludesHeaders: true;
    };
  };
  governance: {
    includesPinInputOutput: true;
    redactsSecretLikeKeys: true;
    excludesSecretValues: true;
    excludesHeaders: true;
    localWorkspaceFile: true;
  };
}

export interface StudioNodePinsCentralSyncStatus {
  format: typeof STUDIO_NODE_PINS_CENTRAL_STATUS_FORMAT;
  generatedAt: string;
  configured: boolean;
  urlConfigured: boolean;
  tokenConfigured: boolean;
  timeoutMs: number;
  invalidReason: string | null;
  lastSyncedAt: string | null;
  statusCode: number | null;
  pushedPinCount: number | null;
  pulledPinCount: number | null;
  error: string | null;
  governance: {
    includesPinInputOutput: true;
    redactsSecretLikeKeys: true;
    excludesSecretValues: true;
    excludesHeaders: true;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
    storesCentralToken: false;
    configuredUrlEnv: typeof STUDIO_NODE_PINS_CENTRAL_URL_ENV;
    configuredTokenEnv: typeof STUDIO_NODE_PINS_CENTRAL_TOKEN_ENV;
    configuredTimeoutEnv: typeof STUDIO_NODE_PINS_CENTRAL_TIMEOUT_ENV;
    maxPayloadBytes: typeof STUDIO_NODE_PINS_CENTRAL_MAX_BYTES;
  };
}

export interface StudioNodePinsCentralSyncResult {
  format: typeof STUDIO_NODE_PINS_CENTRAL_SYNC_RESULT_FORMAT;
  flowId: string;
  pins: StudioNodePinsPackage;
  central: StudioNodePinsCentralSyncStatus;
  pushedPinCount: number;
  pulledPinCount: number;
  governance: {
    includesPinInputOutput: true;
    redactsSecretLikeKeys: true;
    excludesSecretValues: true;
    excludesHeaders: true;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
  };
}

interface StudioNodePinsCentralSyncConfig {
  url: string | null;
  token: string | null;
  timeoutMs: number;
  invalidReason: string | null;
}

const STUDIO_NODE_PINS_FORMAT = "agent-flow-builder.studio-node-pins.v1";
const STUDIO_NODE_PINS_CONFLICT_REVIEW_FORMAT = "agent-flow-builder.studio-node-pins-conflict-review.v1";
const STUDIO_NODE_PINS_FILE = ".agent-flow/studio-node-pins/pins.afnodepins.json";
const STUDIO_NODE_PINS_CENTRAL_SYNC_REQUEST_FORMAT = "agent-flow-builder.studio-node-pins-central-sync-request.v1";
const STUDIO_NODE_PINS_CENTRAL_SYNC_RESULT_FORMAT = "agent-flow-builder.studio-node-pins-central-sync-result.v1";
const STUDIO_NODE_PINS_CENTRAL_STATUS_FORMAT = "agent-flow-builder.studio-node-pins-central-sync-status.v1";
const STUDIO_NODE_PINS_CENTRAL_URL_ENV = "AGENT_FLOW_STUDIO_NODE_PINS_CENTRAL_URL";
const STUDIO_NODE_PINS_CENTRAL_TOKEN_ENV = "AGENT_FLOW_STUDIO_NODE_PINS_CENTRAL_TOKEN";
const STUDIO_NODE_PINS_CENTRAL_TIMEOUT_ENV = "AGENT_FLOW_STUDIO_NODE_PINS_CENTRAL_TIMEOUT_MS";
const STUDIO_NODE_PIN_CONFLICT_CURATION_LEASE_HOURS_ENV = "AGENT_FLOW_STUDIO_NODE_PIN_CONFLICT_CURATION_LEASE_HOURS";
const STUDIO_NODE_PINS_CENTRAL_TIMEOUT_MS = 5_000;
const STUDIO_NODE_PINS_CENTRAL_MAX_BYTES = 2_000_000;
const STUDIO_NODE_PIN_CONFLICT_CURATION_LEASE_HOURS = 24;
const MAX_STUDIO_NODE_PINS = 128;
const REDACTED_VALUE = "[redacted]";

export async function loadStudioNodePins(workspaceRoot: string, flowId: string): Promise<StudioNodePinsPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  try {
    const raw = await readFile(studioNodePinsPath(loaded.flowRoot), "utf-8");
    const payload = normalizeStudioNodePinsPackage(JSON.parse(raw) as unknown, loaded.flow.id, "merge");
    if (!payload) {
      throw new WorkspaceError("Pacote compartilhado de pins de no invalido.", 422);
    }
    return payload;
  } catch (error) {
    if (isFileNotFound(error)) {
      return buildStudioNodePinsPackage(loaded.flow.id, [], {
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
    throw new WorkspaceError("Falha ao ler pins compartilhados do Studio.", 500, error);
  }
}

export async function saveStudioNodePins(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<StudioNodePinsPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const incoming = normalizeStudioNodePinsPackage(payload, loaded.flow.id, "save");
  if (!incoming) {
    throw new WorkspaceError("Payload de pins compartilhados invalido.", 400);
  }
  const existing = await loadStudioNodePins(workspaceRoot, flowId);
  const incomingItems = packagePinItems(incoming);
  const history = mergeStudioNodePinResolutionHistory(existing.resolutionHistory, incoming.resolutionHistory);
  const stats = compareStudioNodePins(existing.pins, incoming.pins, "save");
  const next = buildStudioNodePinsPackage(loaded.flow.id, incomingItems, {
    action: "save",
    ...stats,
    finalCount: incomingItems.length,
  }, history, mergeStudioNodePinConflictCurationThreads(existing.conflicts, incoming.conflicts));
  await writeStudioNodePins(loaded.flowRoot, next);
  return next;
}

export async function mergeStudioNodePins(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<StudioNodePinsPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const incoming = normalizeStudioNodePinsPackage(payload, loaded.flow.id, "merge");
  if (!incoming) {
    throw new WorkspaceError("Payload de merge de pins compartilhados invalido.", 400);
  }
  const existing = await loadStudioNodePins(workspaceRoot, flowId);
  const merged = mergePinItems(packagePinItems(existing), packagePinItems(incoming));
  const history = mergeStudioNodePinResolutionHistory(existing.resolutionHistory, incoming.resolutionHistory);
  const stats = compareStudioNodePins(existing.pins, incoming.pins, "merge");
  const next = buildStudioNodePinsPackage(loaded.flow.id, merged, {
    action: "merge",
    ...stats,
    finalCount: merged.length,
  }, history, mergeStudioNodePinConflictCurationThreads(existing.conflicts, incoming.conflicts));
  await writeStudioNodePins(loaded.flowRoot, next);
  return next;
}

export async function loadStudioNodePinConflictReview(
  workspaceRoot: string,
  flowId: string,
): Promise<StudioNodePinConflictReviewPackage> {
  const pins = await loadStudioNodePins(workspaceRoot, flowId);
  return buildStudioNodePinConflictReviewPackage(pins);
}

export async function compareStudioNodePinConflictReview(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  const current = await loadStudioNodePins(workspaceRoot, flowId).then(buildStudioNodePinConflictReviewPackage);
  const record = isRecord(payload) ? payload : {};
  const candidate = record.review !== undefined ? record.review : payload;
  const incoming = normalizeStudioNodePinConflictReviewPackage(candidate, current.flowId);
  if (!incoming) {
    throw new WorkspaceError("Revisão de conflitos de pins inválida ou contendo input/output bruto.", 400);
  }
  if (incoming.flowId !== current.flowId) {
    throw new WorkspaceError("Revisão de conflitos de pins pertence a outro flow.", 400, {
      expectedFlowId: current.flowId,
      receivedFlowId: incoming.flowId,
    });
  }
  return buildStudioNodePinConflictReviewDiffPackage(current, incoming);
}

export async function resolveStudioNodePinConflict(
  workspaceRoot: string,
  flowId: string,
  conflictId: string,
  payload: unknown,
): Promise<StudioNodePinsPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const existing = await loadStudioNodePins(workspaceRoot, flowId);
  const conflict = existing.conflicts.find((item) => item.conflictId === conflictId);
  if (!conflict) {
    throw new WorkspaceError("Conflito de pins de nó não encontrado.", 404);
  }
  const keepPinId = normalizeId(readString(isRecord(payload) ? payload.keepPinId : undefined));
  const selectedPinId = conflict.pinIds.includes(keepPinId) ? keepPinId : conflict.latestPinId;
  const selectedPin = conflict.candidates.find((pin) => pin.id === selectedPinId);
  if (!selectedPin) {
    throw new WorkspaceError("Pin escolhido para resolver conflito não foi encontrado.", 404);
  }
  const resolvedBy = normalizeActor(readString(isRecord(payload) ? payload.resolvedBy : undefined));
  const resolvedRole = resolveStudioNodePinConflictCuratorRole(payload);
  assertStudioNodePinConflictMutationAllowed(resolvedRole, "resolver conflitos de pins de nó");
  const resolutionNote = normalizeResolutionNote(readString(isRecord(payload) ? payload.resolutionNote ?? payload.note : undefined));
  const resolutionRecord = buildStudioNodePinResolutionRecord(conflict, selectedPin, resolvedBy, resolvedRole, resolutionNote);
  const retainedPins = [...packagePinItems(existing).filter((pin) => pin.nodeId !== conflict.nodeId), selectedPin];
  const history = mergeStudioNodePinResolutionHistory(existing.resolutionHistory, [resolutionRecord]);
  const resolvedThread = resolveStudioNodePinConflictCurationThread(
    conflict.curationThread,
    resolvedBy,
    resolvedRole,
    resolutionNote,
    resolutionRecord.resolvedAt,
  );
  const next = buildStudioNodePinsPackage(loaded.flow.id, retainedPins, {
    action: "resolve_conflict",
    incomingCount: 0,
    existingCount: existing.pinCount,
    addedCount: 0,
    updatedCount: 0,
    unchangedCount: retainedPins.length,
    finalCount: retainedPins.length,
  }, history, [
    ...existing.conflicts.filter((item) => item.conflictId !== conflict.conflictId),
    { ...conflict, curationThread: resolvedThread },
  ]);
  await writeStudioNodePins(loaded.flowRoot, next);
  return next;
}

export async function curateStudioNodePinConflict(
  workspaceRoot: string,
  flowId: string,
  conflictId: string,
  payload: unknown,
): Promise<StudioNodePinsPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const existing = await loadStudioNodePins(workspaceRoot, flowId);
  const normalizedConflictId = normalizeId(conflictId);
  if (!normalizedConflictId) {
    throw new WorkspaceError("ID do conflito de pins de nó é obrigatório.", 400);
  }
  const conflict = existing.conflicts.find((item) => item.conflictId === normalizedConflictId);
  if (!conflict) {
    throw new WorkspaceError("Conflito de pins de nó não encontrado.", 404);
  }
  const action = normalizeStudioNodePinConflictCurationAction(isRecord(payload) ? payload.action : undefined);
  if (!action) {
    throw new WorkspaceError("Ação de curadoria do conflito de pins é obrigatória.", 400);
  }
  const actor = normalizeActor(readString(isRecord(payload) ? payload.actor ?? payload.actorId ?? payload.assignee ?? payload.resolvedBy : undefined));
  const role = resolveStudioNodePinConflictCuratorRole(payload);
  assertStudioNodePinConflictMutationAllowed(role, "curar conflitos de pins de nó");
  const note = normalizeStudioNodePinConflictCurationNote(readString(isRecord(payload) ? payload.note ?? payload.resolutionNote : undefined));
  const updatedAt = new Date().toISOString();
  const nextConflictThreads = existing.conflicts.map((item) =>
    item.conflictId === normalizedConflictId
      ? {
          ...item,
          curationThread: updateStudioNodePinConflictCurationThread(item.curationThread, action, actor, role, note, updatedAt),
        }
      : item,
  );
  const next = buildStudioNodePinsPackage(loaded.flow.id, packagePinItems(existing), {
    action: "curate_conflict",
    incomingCount: 0,
    existingCount: existing.pinCount,
    addedCount: 0,
    updatedCount: 0,
    unchangedCount: existing.pinCount,
    finalCount: existing.pinCount,
  }, existing.resolutionHistory, nextConflictThreads);
  await writeStudioNodePins(loaded.flowRoot, next);
  return next;
}

export async function loadStudioNodePinsCentralSyncStatus(): Promise<StudioNodePinsCentralSyncStatus> {
  return buildStudioNodePinsCentralSyncStatus(studioNodePinsCentralSyncConfig());
}

export async function syncCentralStudioNodePins(
  workspaceRoot: string,
  flowId: string,
): Promise<StudioNodePinsCentralSyncResult> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const config = studioNodePinsCentralSyncConfig();
  if (config.invalidReason) {
    throw new WorkspaceError(`Configuração da central de pins de nó inválida: ${config.invalidReason}`, 422);
  }
  if (!config.url) {
    throw new WorkspaceError("Central de pins de nó não configurada.", 400);
  }
  const existing = await loadStudioNodePins(workspaceRoot, flowId);
  const fetched = await fetchCentralStudioNodePinsSync(config, flowId, existing);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fetched.body) as unknown;
  } catch (error) {
    throw new WorkspaceError("Resposta central de pins de nó não é JSON válido.", 502, error);
  }
  const centralPinsPayload = isRecord(parsed) && parsed.pins !== undefined ? parsed.pins : parsed;
  const incoming = normalizeStudioNodePinsPackage(centralPinsPayload, loaded.flow.id, "merge");
  if (!incoming) {
    throw new WorkspaceError("Resposta central de pins de nó não respeita o formato esperado.", 502);
  }
  const merged = mergePinItems(packagePinItems(existing), packagePinItems(incoming));
  const history = mergeStudioNodePinResolutionHistory(existing.resolutionHistory, incoming.resolutionHistory);
  const stats = compareStudioNodePins(existing.pins, incoming.pins, "merge");
  const next = buildStudioNodePinsPackage(loaded.flow.id, merged, {
    action: "merge",
    ...stats,
    finalCount: merged.length,
  }, history, mergeStudioNodePinConflictCurationThreads(existing.conflicts, incoming.conflicts));
  await writeStudioNodePins(loaded.flowRoot, next);
  const syncedAt = new Date().toISOString();
  return {
    format: STUDIO_NODE_PINS_CENTRAL_SYNC_RESULT_FORMAT,
    flowId,
    pins: next,
    central: buildStudioNodePinsCentralSyncStatus(config, {
      lastSyncedAt: syncedAt,
      statusCode: fetched.statusCode,
      pushedPinCount: existing.pinCount,
      pulledPinCount: incoming.pinCount,
      error: null,
    }),
    pushedPinCount: existing.pinCount,
    pulledPinCount: incoming.pinCount,
    governance: {
      includesPinInputOutput: true,
      redactsSecretLikeKeys: true,
      excludesSecretValues: true,
      excludesHeaders: true,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  };
}

function buildStudioNodePinsPackage(
  flowId: string,
  items: StudioNodePinItem[],
  sync: { action: StudioNodePinsSharedSyncAction } & StudioNodePinsMergeStats,
  resolutionHistory: unknown[] = [],
  conflictCurationSources: unknown[] = [],
): StudioNodePinsPackage {
  const exportedAt = new Date().toISOString();
  const allPins = sortPinItems(items).slice(0, MAX_STUDIO_NODE_PINS);
  const normalizedResolutionHistory = normalizeStudioNodePinResolutionHistory(resolutionHistory).slice(0, 128);
  const resolvedPins = applyStudioNodePinResolutionHistory(allPins, normalizedResolutionHistory);
  const conflicts = buildStudioNodePinConflicts(flowId, resolvedPins, conflictCurationSources);
  const pins = visiblePinItems(resolvedPins);
  const contentHash = hashJson({ flowId, pins, conflicts, resolutionHistory: normalizedResolutionHistory });
  return {
    format: STUDIO_NODE_PINS_FORMAT,
    exportedAt,
    flowId,
    packageHash: hashJson({ format: STUDIO_NODE_PINS_FORMAT, flowId, contentHash, exportedAt }),
    pinCount: pins.length,
    pins,
    conflictCount: conflicts.length,
    openConflictCount: conflicts.length,
    conflicts,
    resolutionHistoryCount: normalizedResolutionHistory.length,
    resolutionHistory: normalizedResolutionHistory,
    sharedSync: {
      action: sync.action,
      updatedAt: exportedAt,
      storage: STUDIO_NODE_PINS_FILE,
      contentHash,
      incomingCount: sync.incomingCount,
      existingCount: sync.existingCount,
      addedCount: sync.addedCount,
      updatedCount: sync.updatedCount,
      unchangedCount: sync.unchangedCount,
      finalCount: pins.length,
      conflictCount: conflicts.length,
      openConflictCount: conflicts.length,
      governance: {
        includesPinInputOutput: true,
        redactsSecretLikeKeys: true,
        excludesSecretValues: true,
        excludesHeaders: true,
      },
    },
    governance: {
      includesPinInputOutput: true,
      redactsSecretLikeKeys: true,
      excludesSecretValues: true,
      excludesHeaders: true,
      localWorkspaceFile: true,
    },
  };
}

function normalizeStudioNodePinsPackage(
  value: unknown,
  fallbackFlowId: string,
  action: StudioNodePinsSharedSyncAction,
): StudioNodePinsPackage | null {
  const record = isRecord(value) ? value : {};
  const rawPins = [
    ...(Array.isArray(record.pins) ? record.pins : Array.isArray(record.items) ? record.items : []),
    ...rawStudioNodePinConflictCandidates(record.conflicts),
  ];
  const pins = rawPins
    .map((item) => normalizeStudioNodePinItem(item, fallbackFlowId))
    .filter((item): item is StudioNodePinItem => Boolean(item));
  const deduped = mergePinItems([], pins).slice(0, MAX_STUDIO_NODE_PINS);
  return buildStudioNodePinsPackage(readString(record.flowId) || fallbackFlowId, deduped, {
    action,
    incomingCount: deduped.length,
    existingCount: 0,
    addedCount: deduped.length,
    updatedCount: 0,
    unchangedCount: 0,
    finalCount: deduped.length,
  }, Array.isArray(record.resolutionHistory) ? record.resolutionHistory : [], Array.isArray(record.conflicts) ? record.conflicts : []);
}

function rawStudioNodePinConflictCandidates(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((conflict) => {
    if (!isRecord(conflict) || !Array.isArray(conflict.candidates)) {
      return [];
    }
    return conflict.candidates;
  });
}

function packagePinItems(payload: StudioNodePinsPackage): StudioNodePinItem[] {
  return mergePinItems(
    payload.pins,
    payload.conflicts.flatMap((conflict) => conflict.candidates),
  );
}

function normalizeStudioNodePinItem(value: unknown, flowId: string): StudioNodePinItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const nodeId = normalizeId(readString(value.nodeId));
  if (!nodeId) {
    return null;
  }
  const updatedAt = normalizeDateString(value.updatedAt) ?? new Date().toISOString();
  const createdAt = normalizeDateString(value.createdAt) ?? updatedAt;
  return {
    id: normalizeId(readString(value.id)) || `node-pin-${flowId}-${nodeId}`,
    nodeId,
    nodeType: normalizeId(readString(value.nodeType)) || "unknown",
    runId: normalizeId(readString(value.runId)) || "unknown-run",
    sessionId: normalizeId(readString(value.sessionId)) || "unknown-session",
    eventSeq: normalizeNonNegativeInteger(value.eventSeq),
    eventType: normalizeId(readString(value.eventType)) || "unknown-event",
    nodeHash: normalizeId(readString(value.nodeHash)) || "unknown-node-hash",
    input: sanitizePinPayload(value.input),
    output: sanitizePinPayload(value.output),
    createdAt,
    updatedAt,
  };
}

function mergePinItems(existing: StudioNodePinItem[], incoming: StudioNodePinItem[]): StudioNodePinItem[] {
  const byId = new Map<string, StudioNodePinItem>();
  for (const item of [...existing, ...incoming]) {
    const key = `${item.nodeId}:${item.id}`;
    const current = byId.get(key);
    if (!current || new Date(item.updatedAt).getTime() >= new Date(current.updatedAt).getTime()) {
      byId.set(key, item);
    }
  }
  return sortPinItems(Array.from(byId.values()));
}

function compareStudioNodePins(
  existing: StudioNodePinItem[],
  incoming: StudioNodePinItem[],
  mode: "save" | "merge",
): StudioNodePinsMergeStats {
  const existingByNode = new Map(existing.map((item) => [item.nodeId, item]));
  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  for (const item of incoming) {
    const current = existingByNode.get(item.nodeId);
    if (!current) {
      addedCount += 1;
      continue;
    }
    if (hashJson(current) === hashJson(item)) {
      unchangedCount += 1;
      continue;
    }
    if (mode === "save" || new Date(item.updatedAt).getTime() >= new Date(current.updatedAt).getTime()) {
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
    finalCount: mode === "save" ? incoming.length : mergePinItems(existing, incoming).length,
  };
}

function sanitizePinPayload(value: unknown, depth = 0): unknown {
  if (depth > 8) {
    return "[max-depth]";
  }
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 256).map((item) => sanitizePinPayload(item, depth + 1));
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
    next[key] = sanitizePinPayload(child, depth + 1);
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
    "secret",
    "sessiontoken",
    "token",
  ].some((part) => normalized.includes(part));
}

function sortPinItems(items: StudioNodePinItem[]): StudioNodePinItem[] {
  return [...items].sort((left, right) => {
    const dateDelta = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    return dateDelta || left.nodeId.localeCompare(right.nodeId);
  });
}

function visiblePinItems(items: StudioNodePinItem[]): StudioNodePinItem[] {
  const byNode = new Map<string, StudioNodePinItem>();
  for (const item of sortPinItems(items)) {
    if (!byNode.has(item.nodeId)) {
      byNode.set(item.nodeId, item);
    }
  }
  return sortPinItems(Array.from(byNode.values()));
}

function buildStudioNodePinConflicts(
  flowId: string,
  items: StudioNodePinItem[],
  curationSources: unknown[] = [],
): StudioNodePinConflict[] {
  const curationByConflictId = new Map<string, StudioNodePinConflictCurationThread>();
  for (const source of curationSources) {
    if (!isRecord(source)) {
      continue;
    }
    const conflictId = normalizeId(readString(source.conflictId));
    if (!conflictId) {
      continue;
    }
    curationByConflictId.set(conflictId, normalizeStudioNodePinConflictCurationThread(source.curationThread));
  }
  const byNode = new Map<string, StudioNodePinItem[]>();
  for (const item of items) {
    const current = byNode.get(item.nodeId) ?? [];
    current.push(item);
    byNode.set(item.nodeId, current);
  }
  const conflicts: StudioNodePinConflict[] = [];
  for (const [nodeId, pins] of byNode) {
    const uniqueContentHashes = new Set(pins.map(studioNodePinContentHash));
    if (uniqueContentHashes.size < 2) {
      continue;
    }
    const sorted = sortPinItems(pins);
    const latest = sorted[0];
    const conflictId = `studio-node-pin-conflict-${hashJson({ flowId, nodeId }).slice(0, 16)}`;
    conflicts.push({
      conflictId,
      status: "open",
      nodeId,
      pinCount: sorted.length,
      pinIds: sorted.map((pin) => pin.id),
      latestPinId: latest.id,
      latestUpdatedAt: latest.updatedAt,
      refs: sorted.map(studioNodePinConflictRef),
      candidates: sorted,
      curationThread: curationByConflictId.get(conflictId) ?? defaultStudioNodePinConflictCurationThread(),
      governance: {
        includesPinInputOutput: true,
        redactsSecretLikeKeys: true,
        excludesSecretValues: true,
      },
    });
  }
  return conflicts.sort((left, right) => right.latestUpdatedAt.localeCompare(left.latestUpdatedAt));
}

function buildStudioNodePinConflictReviewPackage(
  pins: StudioNodePinsPackage,
): StudioNodePinConflictReviewPackage {
  return buildStudioNodePinConflictReviewPackageFromParts(
    pins.flowId,
    pins.conflicts.map(studioNodePinConflictReview),
    pins.resolutionHistory,
  );
}

function buildStudioNodePinConflictReviewPackageFromParts(
  flowId: string,
  conflicts: StudioNodePinConflictReview[],
  resolutionHistory: StudioNodePinResolutionRecord[],
  generatedAt = new Date().toISOString(),
): StudioNodePinConflictReviewPackage {
  const summary = {
    conflictCount: conflicts.length,
    nodeCount: uniqueSortedText(conflicts.map((conflict) => conflict.nodeId)).length,
    assignedConflictCount: conflicts.filter((conflict) => conflict.curationThread.status === "assigned").length,
    unassignedConflictCount: conflicts.filter((conflict) => conflict.curationThread.status === "unassigned").length,
    resolvedThreadCount: conflicts.filter((conflict) => conflict.curationThread.status === "resolved").length,
  };
  const packageHash = hashJson({
    flowId,
    conflictRefs: conflicts.map((conflict) => ({
      conflictId: conflict.conflictId,
      latestPinId: conflict.latestPinId,
      pinContentHashes: conflict.pinContentHashes,
      curationStatus: conflict.curationThread.status,
      curationAssignee: conflict.curationThread.assignee,
    })),
    resolutionIds: resolutionHistory.map((record) => record.resolutionId),
    summary,
  });
  return {
    format: STUDIO_NODE_PINS_CONFLICT_REVIEW_FORMAT,
    generatedAt,
    flowId,
    packageHash,
    conflictCount: conflicts.length,
    openConflictCount: conflicts.length,
    resolutionHistoryCount: resolutionHistory.length,
    conflicts,
    resolutionHistory,
    summary,
    governance: {
      excludesCandidates: true,
      excludesRawPinInputOutput: true,
      redactsSecretLikeKeys: true,
      excludesSecretValues: true,
      includesOnlyRefsThreadsAndResolutionHistory: true,
      localWorkspaceFile: true,
    },
  };
}

function studioNodePinConflictReview(conflict: StudioNodePinConflict): StudioNodePinConflictReview {
  return {
    conflictId: conflict.conflictId,
    status: conflict.status,
    nodeId: conflict.nodeId,
    pinCount: conflict.pinCount,
    pinIds: conflict.pinIds,
    latestPinId: conflict.latestPinId,
    latestUpdatedAt: conflict.latestUpdatedAt,
    refs: conflict.refs,
    pinContentHashes: uniqueSortedText(conflict.refs.map((ref) => ref.contentHash)),
    curationThread: conflict.curationThread,
    governance: {
      excludesCandidates: true,
      excludesRawPinInputOutput: true,
      redactsSecretLikeKeys: true,
      excludesSecretValues: true,
      includesOnlyRefsThreadsAndResolutionHistory: true,
    },
  };
}

function normalizeStudioNodePinConflictReviewPackage(
  value: unknown,
  fallbackFlowId: string,
): StudioNodePinConflictReviewPackage | null {
  if (!isRecord(value) || value.format !== STUDIO_NODE_PINS_CONFLICT_REVIEW_FORMAT) {
    return null;
  }
  if (containsRawStudioNodePinReviewPayload(value)) {
    return null;
  }
  const flowId = normalizeId(readString(value.flowId)) || fallbackFlowId;
  const generatedAt = normalizeDateString(value.generatedAt) ?? new Date().toISOString();
  const conflicts = Array.isArray(value.conflicts)
    ? value.conflicts
        .map(normalizeStudioNodePinConflictReview)
        .filter((conflict): conflict is StudioNodePinConflictReview => conflict !== null)
        .slice(0, 128)
    : [];
  const resolutionHistory = Array.isArray(value.resolutionHistory)
    ? normalizeStudioNodePinResolutionHistory(value.resolutionHistory).slice(0, 128)
    : [];
  return buildStudioNodePinConflictReviewPackageFromParts(flowId, conflicts, resolutionHistory, generatedAt);
}

function normalizeStudioNodePinConflictReview(value: unknown): StudioNodePinConflictReview | null {
  if (!isRecord(value) || value.candidates !== undefined || value.input !== undefined || value.output !== undefined) {
    return null;
  }
  const conflictId = normalizeId(readString(value.conflictId));
  const nodeId = normalizeId(readString(value.nodeId));
  if (!conflictId || !nodeId) {
    return null;
  }
  const refs = Array.isArray(value.refs)
    ? value.refs.map(normalizeStudioNodePinConflictRef).filter((ref): ref is StudioNodePinConflictRef => ref !== null)
    : [];
  const pinContentHashes = uniqueSortedText([
    ...(Array.isArray(value.pinContentHashes) ? value.pinContentHashes.map(readString).filter(Boolean) : []),
    ...refs.map((ref) => ref.contentHash),
  ]);
  if (!refs.length && !pinContentHashes.length) {
    return null;
  }
  const latestRef = refs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
  return {
    conflictId,
    status: "open",
    nodeId,
    pinCount: normalizeNonNegativeInteger(value.pinCount) || Math.max(refs.length, pinContentHashes.length),
    pinIds: Array.isArray(value.pinIds) ? value.pinIds.map(readString).map(normalizeId).filter(Boolean).slice(0, 32) : refs.map((ref) => ref.id),
    latestPinId: normalizeId(readString(value.latestPinId)) || latestRef?.id || "",
    latestUpdatedAt: normalizeDateString(value.latestUpdatedAt) ?? latestRef?.updatedAt ?? new Date().toISOString(),
    refs,
    pinContentHashes,
    curationThread: normalizeStudioNodePinConflictCurationThread(value.curationThread),
    governance: {
      excludesCandidates: true,
      excludesRawPinInputOutput: true,
      redactsSecretLikeKeys: true,
      excludesSecretValues: true,
      includesOnlyRefsThreadsAndResolutionHistory: true,
    },
  };
}

function containsRawStudioNodePinReviewPayload(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsRawStudioNodePinReviewPayload);
  }
  if (!isRecord(value)) {
    return false;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "candidates" || key === "pins" || key === "input" || key === "output") {
      return true;
    }
    if (containsRawStudioNodePinReviewPayload(child)) {
      return true;
    }
  }
  return false;
}

function buildStudioNodePinConflictReviewDiffPackage(
  current: StudioNodePinConflictReviewPackage,
  incoming: StudioNodePinConflictReviewPackage,
): Record<string, unknown> {
  const generatedAt = new Date().toISOString();
  const conflictSection = buildStudioNodePinConflictReviewConflictDiffSection(current.conflicts, incoming.conflicts);
  const resolutionSection = buildStudioNodePinConflictReviewResolutionDiffSection(current.resolutionHistory, incoming.resolutionHistory);
  const sections = [
    buildStudioNodePinConflictReviewSummaryDiffSection(current, incoming),
    conflictSection,
    resolutionSection,
  ];
  const changedSectionCount = sections.filter((section) => section.status !== "same").length;
  const conflictDelta = incoming.conflictCount - current.conflictCount;
  const resolutionDelta = incoming.resolutionHistoryCount - current.resolutionHistoryCount;
  const status = changedSectionCount || conflictDelta || resolutionDelta ? "changed" : "same";
  const base = {
    format: "agent-flow-builder.studio-node-pins-conflict-review-diff.v1",
    generatedAt,
    flowId: current.flowId,
    current: studioNodePinConflictReviewPackageRef(current),
    incoming: studioNodePinConflictReviewPackageRef(incoming),
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
      excludesCandidates: true,
      excludesRawPinInputOutput: true,
      redactsSecretLikeKeys: true,
      excludesSecretValues: true,
      includesOnlyRefsThreadsAndResolutionHistory: true,
      source: "studio-node-pins-conflict-review-diff",
    },
  };
  return {
    ...base,
    packageHash: hashJson(base),
  };
}

function studioNodePinConflictReviewPackageRef(packageValue: StudioNodePinConflictReviewPackage): Record<string, unknown> {
  return {
    generatedAt: packageValue.generatedAt,
    packageHash: packageValue.packageHash,
    conflictCount: packageValue.conflictCount,
    openConflictCount: packageValue.openConflictCount,
    resolutionHistoryCount: packageValue.resolutionHistoryCount,
    summary: packageValue.summary,
  };
}

function buildStudioNodePinConflictReviewSummaryDiffSection(
  current: StudioNodePinConflictReviewPackage,
  incoming: StudioNodePinConflictReviewPackage,
): StudioNodePinConflictReviewDiffSection {
  return buildStudioNodePinConflictReviewDiffSection("summary", "Resumo", [
    buildStudioNodePinConflictReviewCountItem("conflicts", "Conflitos", current.conflictCount, incoming.conflictCount),
    buildStudioNodePinConflictReviewCountItem("nodes", "Nós", current.summary.nodeCount, incoming.summary.nodeCount),
    buildStudioNodePinConflictReviewCountItem("assigned", "Atribuídos", current.summary.assignedConflictCount, incoming.summary.assignedConflictCount),
    buildStudioNodePinConflictReviewCountItem("unassigned", "Sem responsável", current.summary.unassignedConflictCount, incoming.summary.unassignedConflictCount),
    buildStudioNodePinConflictReviewCountItem("resolved-thread", "Threads resolvidas", current.summary.resolvedThreadCount, incoming.summary.resolvedThreadCount),
    buildStudioNodePinConflictReviewCountItem("resolutions", "Histórico de decisões", current.resolutionHistoryCount, incoming.resolutionHistoryCount),
  ]);
}

function buildStudioNodePinConflictReviewConflictDiffSection(
  current: StudioNodePinConflictReview[],
  incoming: StudioNodePinConflictReview[],
): StudioNodePinConflictReviewDiffSection {
  const currentById = new Map(current.map((conflict) => [conflict.conflictId, conflict] as const));
  const incomingById = new Map(incoming.map((conflict) => [conflict.conflictId, conflict] as const));
  const ids = uniqueSortedText([...currentById.keys(), ...incomingById.keys()]);
  const items = ids.map((id) => {
    const left = currentById.get(id) ?? null;
    const right = incomingById.get(id) ?? null;
    const status = studioNodePinConflictReviewItemStatus(left, right);
    return {
      id,
      label: left?.nodeId || right?.nodeId || id,
      status,
      current: left ? studioNodePinConflictReviewItemSummary(left) : "-",
      incoming: right ? studioNodePinConflictReviewItemSummary(right) : "-",
      delta: status === "only_incoming" ? 1 : status === "only_current" ? -1 : 0,
    };
  });
  return buildStudioNodePinConflictReviewDiffSection("conflicts", "Conflitos", items);
}

function buildStudioNodePinConflictReviewResolutionDiffSection(
  current: StudioNodePinResolutionRecord[],
  incoming: StudioNodePinResolutionRecord[],
): StudioNodePinConflictReviewDiffSection {
  const currentById = new Map(current.map((record) => [record.resolutionId, record] as const));
  const incomingById = new Map(incoming.map((record) => [record.resolutionId, record] as const));
  const ids = uniqueSortedText([...currentById.keys(), ...incomingById.keys()]);
  const items = ids.map((id) => {
    const left = currentById.get(id) ?? null;
    const right = incomingById.get(id) ?? null;
    const status = studioNodePinResolutionReviewItemStatus(left, right);
    return {
      id,
      label: left?.nodeId || right?.nodeId || id,
      status,
      current: left ? studioNodePinResolutionReviewItemSummary(left) : "-",
      incoming: right ? studioNodePinResolutionReviewItemSummary(right) : "-",
      delta: status === "only_incoming" ? 1 : status === "only_current" ? -1 : 0,
    };
  });
  return buildStudioNodePinConflictReviewDiffSection("resolution-history", "Histórico de decisões", items);
}

function buildStudioNodePinConflictReviewDiffSection(
  id: string,
  title: string,
  items: StudioNodePinConflictReviewDiffItem[],
): StudioNodePinConflictReviewDiffSection {
  const changedCount = items.filter((item) => item.status !== "same").length;
  const status = changedCount ? "changed" : "same";
  return {
    id,
    title,
    status,
    statusLabel: status === "same" ? "igual" : "alterado",
    summary: changedCount ? `${changedCount}/${items.length} item(ns) alterado(s)` : `${items.length} item(ns) sem mudança`,
    items: items.slice(0, 128),
  };
}

function buildStudioNodePinConflictReviewCountItem(
  id: string,
  label: string,
  current: number,
  incoming: number,
): StudioNodePinConflictReviewDiffItem {
  return {
    id,
    label,
    status: current === incoming ? "same" : "changed",
    current: String(current),
    incoming: String(incoming),
    delta: incoming - current,
  };
}

function studioNodePinConflictReviewItemStatus(
  current: StudioNodePinConflictReview | null,
  incoming: StudioNodePinConflictReview | null,
): StudioNodePinConflictReviewDiffItemStatus {
  if (!current) {
    return "only_incoming";
  }
  if (!incoming) {
    return "only_current";
  }
  return studioNodePinConflictReviewSignature(current) === studioNodePinConflictReviewSignature(incoming) ? "same" : "changed";
}

function studioNodePinResolutionReviewItemStatus(
  current: StudioNodePinResolutionRecord | null,
  incoming: StudioNodePinResolutionRecord | null,
): StudioNodePinConflictReviewDiffItemStatus {
  if (!current) {
    return "only_incoming";
  }
  if (!incoming) {
    return "only_current";
  }
  return hashJson(current) === hashJson(incoming) ? "same" : "changed";
}

function studioNodePinConflictReviewSignature(conflict: StudioNodePinConflictReview): string {
  return hashJson({
    nodeId: conflict.nodeId,
    pinCount: conflict.pinCount,
    pinIds: conflict.pinIds,
    latestPinId: conflict.latestPinId,
    refs: conflict.refs,
    pinContentHashes: uniqueSortedText(conflict.pinContentHashes),
    curationThread: conflict.curationThread,
  });
}

function studioNodePinConflictReviewItemSummary(conflict: StudioNodePinConflictReview): string {
  return [
    conflict.nodeId,
    `${conflict.pinCount} pin(s)`,
    `latest ${conflict.latestPinId || "-"}`,
    `thread ${conflict.curationThread.status}`,
    conflict.curationThread.assignee ? `responsável ${conflict.curationThread.assignee}` : "",
  ].filter(Boolean).join(" · ");
}

function studioNodePinResolutionReviewItemSummary(record: StudioNodePinResolutionRecord): string {
  return [
    record.nodeId,
    `mantido ${record.keptPinId}`,
    `${record.discardedRefs.length} descartado(s)`,
    `por ${record.resolvedBy}`,
    record.resolvedRole,
  ].join(" · ");
}

function applyStudioNodePinResolutionHistory(
  items: StudioNodePinItem[],
  history: StudioNodePinResolutionRecord[],
): StudioNodePinItem[] {
  if (!history.length || items.length < 2) {
    return sortPinItems(items);
  }
  const byNode = new Map<string, StudioNodePinItem[]>();
  for (const item of items) {
    const current = byNode.get(item.nodeId) ?? [];
    current.push(item);
    byNode.set(item.nodeId, current);
  }
  const sortedHistory = [...history].sort((left, right) => right.resolvedAt.localeCompare(left.resolvedAt));
  const resolved: StudioNodePinItem[] = [];
  for (const [nodeId, nodePins] of byNode) {
    const nodeHistory = sortedHistory.filter((record) => record.nodeId === nodeId);
    let currentPins = nodePins;
    for (const record of nodeHistory) {
      const keptPin = currentPins.find((pin) => studioNodePinMatchesConflictRef(pin, record.keptRef));
      if (!keptPin) {
        continue;
      }
      const filtered = currentPins.filter((pin) => {
        if (studioNodePinMatchesConflictRef(pin, record.keptRef)) {
          return true;
        }
        return !record.discardedRefs.some((ref) => studioNodePinMatchesConflictRef(pin, ref));
      });
      if (filtered.length !== currentPins.length) {
        currentPins = filtered;
        break;
      }
    }
    resolved.push(...currentPins);
  }
  return sortPinItems(resolved);
}

function studioNodePinMatchesConflictRef(pin: StudioNodePinItem, ref: StudioNodePinConflictRef): boolean {
  return pin.id === ref.id && pin.nodeId === ref.nodeId && studioNodePinContentHash(pin) === ref.contentHash;
}

function studioNodePinConflictRef(pin: StudioNodePinItem): StudioNodePinConflictRef {
  return {
    id: pin.id,
    nodeId: pin.nodeId,
    nodeType: pin.nodeType,
    runId: pin.runId,
    sessionId: pin.sessionId,
    eventSeq: pin.eventSeq,
    eventType: pin.eventType,
    nodeHash: pin.nodeHash,
    updatedAt: pin.updatedAt,
    contentHash: studioNodePinContentHash(pin),
  };
}

function studioNodePinContentHash(pin: StudioNodePinItem): string {
  return hashJson({
    nodeId: pin.nodeId,
    nodeType: pin.nodeType,
    eventType: pin.eventType,
    nodeHash: pin.nodeHash,
    input: pin.input,
    output: pin.output,
  });
}

function buildStudioNodePinResolutionRecord(
  conflict: StudioNodePinConflict,
  selectedPin: StudioNodePinItem,
  resolvedBy: string,
  resolvedRole: StudioNodePinConflictCuratorRole,
  resolutionNote: string,
): StudioNodePinResolutionRecord {
  const resolvedAt = new Date().toISOString();
  const keptRef = studioNodePinConflictRef(selectedPin);
  const discardedRefs = conflict.refs.filter((ref) => ref.id !== selectedPin.id);
  return {
    resolutionId: `studio-node-pin-resolution-${hashJson({
      conflictId: conflict.conflictId,
      keptPinId: selectedPin.id,
      discardedRefs,
      resolvedBy,
      resolvedRole,
      resolvedAt,
    }).slice(0, 16)}`,
    conflictId: conflict.conflictId,
    nodeId: conflict.nodeId,
    resolvedAt,
    resolvedBy,
    resolvedRole,
    resolutionNote,
    keptPinId: selectedPin.id,
    keptRef,
    discardedRefs,
    candidateCount: conflict.pinCount,
    governance: {
      excludesSecretValues: true,
      excludesRawPinInputOutput: true,
      redactsSecretLikeKeys: true,
    },
  };
}

function mergeStudioNodePinResolutionHistory(
  existing: unknown[],
  incoming: unknown[],
): StudioNodePinResolutionRecord[] {
  const byId = new Map<string, StudioNodePinResolutionRecord>();
  for (const record of [...normalizeStudioNodePinResolutionHistory(existing), ...normalizeStudioNodePinResolutionHistory(incoming)]) {
    const current = byId.get(record.resolutionId);
    if (!current || record.resolvedAt.localeCompare(current.resolvedAt) >= 0) {
      byId.set(record.resolutionId, record);
    }
  }
  return Array.from(byId.values()).sort((left, right) => right.resolvedAt.localeCompare(left.resolvedAt));
}

function normalizeStudioNodePinResolutionHistory(value: unknown[]): StudioNodePinResolutionRecord[] {
  return value
    .map(normalizeStudioNodePinResolutionRecord)
    .filter((record): record is StudioNodePinResolutionRecord => record !== null)
    .sort((left, right) => right.resolvedAt.localeCompare(left.resolvedAt));
}

function normalizeStudioNodePinResolutionRecord(value: unknown): StudioNodePinResolutionRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const conflictId = normalizeId(readString(value.conflictId));
  const nodeId = normalizeId(readString(value.nodeId));
  const keptPinId = normalizeId(readString(value.keptPinId));
  const resolvedAt = normalizeDateString(value.resolvedAt);
  const keptRef = normalizeStudioNodePinConflictRef(value.keptRef);
  if (!conflictId || !nodeId || !keptPinId || !resolvedAt || !keptRef) {
    return null;
  }
  const discardedRefs = Array.isArray(value.discardedRefs)
    ? value.discardedRefs
        .map(normalizeStudioNodePinConflictRef)
        .filter((ref): ref is StudioNodePinConflictRef => ref !== null)
    : [];
  const resolutionId = normalizeId(readString(value.resolutionId)) ||
    `studio-node-pin-resolution-${hashJson({ conflictId, keptPinId, discardedRefs, resolvedAt }).slice(0, 16)}`;
  return {
    resolutionId,
    conflictId,
    nodeId,
    resolvedAt,
    resolvedBy: normalizeActor(readString(value.resolvedBy)),
    resolvedRole: normalizeStudioNodePinConflictCuratorRole(value.resolvedRole ?? value.role),
    resolutionNote: normalizeResolutionNote(readString(value.resolutionNote)),
    keptPinId,
    keptRef,
    discardedRefs,
    candidateCount: normalizeNonNegativeInteger(value.candidateCount || discardedRefs.length + 1),
    governance: {
      excludesSecretValues: true,
      excludesRawPinInputOutput: true,
      redactsSecretLikeKeys: true,
    },
  };
}

function mergeStudioNodePinConflictCurationThreads(
  existing: unknown[],
  incoming: unknown[],
): StudioNodePinConflict[] {
  const byId = new Map<string, StudioNodePinConflict>();
  for (const source of [...existing, ...incoming]) {
    if (!isRecord(source)) {
      continue;
    }
    const conflictId = normalizeId(readString(source.conflictId));
    if (!conflictId) {
      continue;
    }
    const current = byId.get(conflictId);
    const normalizedThread = normalizeStudioNodePinConflictCurationThread(source.curationThread);
    const existingThread = current ? normalizeStudioNodePinConflictCurationThread(current.curationThread) : null;
    if (!existingThread || compareNullableDateStrings(normalizedThread.updatedAt, existingThread.updatedAt) >= 0) {
      const mergedThread = existingThread
        ? {
            ...normalizedThread,
            events: mergeStudioNodePinConflictCurationEvents(existingThread.events, normalizedThread.events),
          }
        : normalizedThread;
      byId.set(conflictId, {
        conflictId,
        status: "open",
        nodeId: normalizeId(readString(source.nodeId)),
        pinCount: normalizeNonNegativeInteger(source.pinCount),
        pinIds: Array.isArray(source.pinIds) ? source.pinIds.map((item) => normalizeId(readString(item))).filter(Boolean) : [],
        latestPinId: normalizeId(readString(source.latestPinId)),
        latestUpdatedAt: normalizeDateString(source.latestUpdatedAt) ?? new Date().toISOString(),
        refs: Array.isArray(source.refs)
          ? source.refs.map(normalizeStudioNodePinConflictRef).filter((ref): ref is StudioNodePinConflictRef => ref !== null)
          : [],
        candidates: Array.isArray(source.candidates)
          ? source.candidates.map((item) => normalizeStudioNodePinItem(item, "pins")).filter((item): item is StudioNodePinItem => item !== null)
          : [],
        curationThread: mergedThread,
        governance: {
          includesPinInputOutput: true,
          redactsSecretLikeKeys: true,
          excludesSecretValues: true,
        },
      });
    }
  }
  return Array.from(byId.values());
}

function normalizeStudioNodePinConflictCurationAction(
  value: unknown,
): StudioNodePinConflictCurationAction | null {
  return value === "assign" || value === "release" ? value : null;
}

function normalizeStudioNodePinConflictCuratorRole(value: unknown): StudioNodePinConflictCuratorRole {
  if (value === "owner" || value === "viewer") {
    return value;
  }
  return "reviewer";
}

function resolveStudioNodePinConflictCuratorRole(payload: unknown): StudioNodePinConflictCuratorRole {
  if (!isRecord(payload)) {
    return normalizeStudioNodePinConflictCuratorRole(payload);
  }
  return normalizeStudioNodePinConflictCuratorRole(payload.role ?? payload.resolvedRole);
}

function assertStudioNodePinConflictMutationAllowed(
  role: StudioNodePinConflictCuratorRole,
  action: string,
): void {
  if (role !== "viewer") {
    return;
  }
  throw new WorkspaceError(`Viewer não pode ${action}.`, 403, {
    code: "studio_node_pin_conflict_viewer_forbidden",
    role,
    requiredRole: "reviewer",
  });
}

function defaultStudioNodePinConflictCurationThread(): StudioNodePinConflictCurationThread {
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
      excludesRawPinInputOutput: true,
      redactsSecretLikeKeys: true,
      excludesSecretValues: true,
      autoReleasesExpiredAssignments: true,
      configuredLeaseHoursEnv: STUDIO_NODE_PIN_CONFLICT_CURATION_LEASE_HOURS_ENV,
    },
  };
}

function normalizeStudioNodePinConflictCurationThread(value: unknown): StudioNodePinConflictCurationThread {
  if (!isRecord(value)) {
    return defaultStudioNodePinConflictCurationThread();
  }
  const assignee = normalizeActor(readString(value.assignee));
  const hasAssignee = assignee !== "local-studio" || readString(value.assignee).trim().length > 0;
  const status = normalizeStudioNodePinConflictCurationStatus(value.status) ?? (hasAssignee ? "assigned" : "unassigned");
  const updatedAt = normalizeDateString(value.updatedAt);
  const leaseDurationHours = normalizeStudioNodePinCurationLeaseHours(value.leaseDurationHours);
  const leaseExpiresAt =
    status === "assigned"
      ? normalizeDateString(value.leaseExpiresAt) ?? (updatedAt ? addHoursIso(updatedAt, leaseDurationHours) : null)
      : null;
  const normalized: StudioNodePinConflictCurationThread = {
    status,
    assignee: status === "unassigned" ? "" : assignee,
    openedAt: normalizeDateString(value.openedAt),
    updatedAt,
    lastActor: normalizeNullableActor(readString(value.lastActor)),
    lastAction: normalizeStudioNodePinConflictCurationLastAction(value.lastAction),
    leaseExpiresAt,
    leaseDurationHours: status === "assigned" ? leaseDurationHours : null,
    leaseExpired: status !== "assigned" && value.leaseExpired === true,
    note: normalizeStudioNodePinConflictCurationNote(readString(value.note)),
    events: Array.isArray(value.events)
      ? value.events
          .map(normalizeStudioNodePinConflictCurationEvent)
          .filter((event): event is StudioNodePinConflictCurationEvent => event !== null)
          .sort((left, right) => right.at.localeCompare(left.at))
          .slice(0, 12)
      : [],
    governance: {
      excludesRawPinInputOutput: true,
      redactsSecretLikeKeys: true,
      excludesSecretValues: true,
      autoReleasesExpiredAssignments: true,
      configuredLeaseHoursEnv: STUDIO_NODE_PIN_CONFLICT_CURATION_LEASE_HOURS_ENV,
    },
  };
  return expireStudioNodePinConflictCurationThreadIfNeeded(normalized);
}

function normalizeStudioNodePinConflictCurationStatus(
  value: unknown,
): StudioNodePinConflictCurationStatus | null {
  if (value === "unassigned" || value === "assigned" || value === "resolved") {
    return value;
  }
  return null;
}

function normalizeStudioNodePinConflictCurationLastAction(
  value: unknown,
): StudioNodePinConflictCurationLastAction | null {
  if (value === "assign" || value === "release" || value === "resolve" || value === "lease_expired") {
    return value;
  }
  return null;
}

function normalizeStudioNodePinConflictCurationEvent(
  value: unknown,
): StudioNodePinConflictCurationEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  const at = normalizeDateString(value.at);
  const actor = normalizeNullableActor(readString(value.actor));
  const action = normalizeStudioNodePinConflictCurationLastAction(value.action);
  if (!at || !actor || !action) {
    return null;
  }
  const role = normalizeStudioNodePinConflictCuratorRole(value.role);
  const assignee = normalizeNullableActor(readString(value.assignee));
  const note = normalizeStudioNodePinConflictCurationNote(readString(value.note));
  const id = normalizeId(readString(value.id)) ||
    `studio-node-pin-curation-${hashJson({ at, actor, role, action, assignee, note }).slice(0, 16)}`;
  return {
    id,
    at,
    actor,
    role,
    action,
    assignee,
    note,
  };
}

function mergeStudioNodePinConflictCurationEvents(
  existing: StudioNodePinConflictCurationEvent[],
  incoming: StudioNodePinConflictCurationEvent[],
): StudioNodePinConflictCurationEvent[] {
  const byId = new Map<string, StudioNodePinConflictCurationEvent>();
  for (const event of [...existing, ...incoming]) {
    byId.set(event.id, event);
  }
  return Array.from(byId.values())
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, 12);
}

function buildStudioNodePinConflictCurationEvent(
  action: StudioNodePinConflictCurationLastAction,
  actor: string,
  role: StudioNodePinConflictCuratorRole,
  assignee: string,
  note: string,
  at: string,
): StudioNodePinConflictCurationEvent {
  const normalizedNote = normalizeStudioNodePinConflictCurationNote(note);
  return {
    id: `studio-node-pin-curation-${hashJson({ at, actor, role, action, assignee, note: normalizedNote }).slice(0, 16)}`,
    at,
    actor,
    role,
    action,
    assignee,
    note: normalizedNote,
  };
}

function updateStudioNodePinConflictCurationThread(
  thread: StudioNodePinConflictCurationThread,
  action: StudioNodePinConflictCurationAction,
  actor: string,
  role: StudioNodePinConflictCuratorRole,
  note: string,
  at: string,
): StudioNodePinConflictCurationThread {
  const normalized = normalizeStudioNodePinConflictCurationThread(thread);
  if (action === "release") {
    const event = buildStudioNodePinConflictCurationEvent("release", actor, role, "", note, at);
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
      events: mergeStudioNodePinConflictCurationEvents([event], normalized.events),
    };
  }
  const leaseDurationHours = readStudioNodePinCurationLeaseHours();
  const event = buildStudioNodePinConflictCurationEvent("assign", actor, role, actor, note, at);
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
    events: mergeStudioNodePinConflictCurationEvents([event], normalized.events),
  };
}

function resolveStudioNodePinConflictCurationThread(
  thread: StudioNodePinConflictCurationThread,
  actor: string,
  role: StudioNodePinConflictCuratorRole,
  note: string,
  at: string,
): StudioNodePinConflictCurationThread {
  const normalized = normalizeStudioNodePinConflictCurationThread(thread);
  const assignee = normalized.assignee || actor;
  const resolvedNote = note || normalized.note;
  const event = buildStudioNodePinConflictCurationEvent("resolve", actor, role, assignee, resolvedNote, at);
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
    events: mergeStudioNodePinConflictCurationEvents([event], normalized.events),
  };
}

function expireStudioNodePinConflictCurationThreadIfNeeded(
  thread: StudioNodePinConflictCurationThread,
  now = new Date(),
): StudioNodePinConflictCurationThread {
  if (thread.status !== "assigned" || !thread.leaseExpiresAt) {
    return thread;
  }
  const expiresAt = Date.parse(thread.leaseExpiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt > now.getTime()) {
    return thread;
  }
  const eventAt = new Date(Math.max(expiresAt, Date.parse(thread.updatedAt ?? "") || expiresAt)).toISOString();
  const event = buildStudioNodePinConflictCurationEvent(
    "lease_expired",
    thread.lastActor || thread.assignee || "local-studio",
    "reviewer",
    "",
    "Lease de curadoria expirado; conflito liberado automaticamente.",
    eventAt,
  );
  return {
    ...thread,
    status: "unassigned",
    assignee: "",
    updatedAt: eventAt,
    lastActor: event.actor,
    lastAction: "lease_expired",
    leaseExpiresAt: null,
    leaseDurationHours: null,
    leaseExpired: true,
    note: event.note,
    events: mergeStudioNodePinConflictCurationEvents([event], thread.events),
  };
}

function readStudioNodePinCurationLeaseHours(): number {
  return normalizeStudioNodePinCurationLeaseHours(process.env[STUDIO_NODE_PIN_CONFLICT_CURATION_LEASE_HOURS_ENV]);
}

function normalizeStudioNodePinCurationLeaseHours(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return STUDIO_NODE_PIN_CONFLICT_CURATION_LEASE_HOURS;
  }
  return Math.min(Math.max(numeric, 1 / 60), 24 * 30);
}

function addHoursIso(value: string, hours: number): string {
  const parsed = Date.parse(value);
  const base = Number.isFinite(parsed) ? parsed : Date.now();
  return new Date(base + hours * 60 * 60 * 1000).toISOString();
}

function normalizeStudioNodePinConflictRef(value: unknown): StudioNodePinConflictRef | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = normalizeId(readString(value.id));
  const nodeId = normalizeId(readString(value.nodeId));
  if (!id || !nodeId) {
    return null;
  }
  return {
    id,
    nodeId,
    nodeType: normalizeId(readString(value.nodeType)) || "unknown",
    runId: normalizeId(readString(value.runId)) || "unknown-run",
    sessionId: normalizeId(readString(value.sessionId)) || "unknown-session",
    eventSeq: normalizeNonNegativeInteger(value.eventSeq),
    eventType: normalizeId(readString(value.eventType)) || "unknown-event",
    nodeHash: normalizeId(readString(value.nodeHash)) || "unknown-node-hash",
    updatedAt: normalizeDateString(value.updatedAt) ?? new Date().toISOString(),
    contentHash: normalizeId(readString(value.contentHash)) || hashJson({ id, nodeId }),
  };
}

function normalizeActor(value: string): string {
  return normalizeId(value) || "local-studio";
}

function normalizeNullableActor(value: string): string {
  return normalizeId(value);
}

function normalizeResolutionNote(value: string): string {
  return value.trim().slice(0, 240) || "Pin escolhido como candidato ativo para o nó.";
}

function normalizeStudioNodePinConflictCurationNote(value: string): string {
  return value.trim().slice(0, 240);
}

function compareNullableDateStrings(left: string | null, right: string | null): number {
  if (left === right) {
    return 0;
  }
  if (!left) {
    return -1;
  }
  if (!right) {
    return 1;
  }
  return left.localeCompare(right);
}

async function writeStudioNodePins(flowRoot: string, payload: StudioNodePinsPackage): Promise<void> {
  const filePath = studioNodePinsPath(flowRoot);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  await rename(tempPath, filePath);
}

function studioNodePinsCentralSyncConfig(): StudioNodePinsCentralSyncConfig {
  const configuredUrl = process.env[STUDIO_NODE_PINS_CENTRAL_URL_ENV]?.trim() ?? "";
  let url: string | null = null;
  let invalidReason: string | null = null;
  if (configuredUrl) {
    try {
      url = validateStudioNodePinsCentralUrl(configuredUrl);
    } catch (error) {
      invalidReason = errorMessage(error);
    }
  }
  const timeoutValue = Number(process.env[STUDIO_NODE_PINS_CENTRAL_TIMEOUT_ENV] ?? "");
  const timeoutMs = Number.isFinite(timeoutValue)
    ? Math.min(Math.max(Math.floor(timeoutValue), 100), 60_000)
    : STUDIO_NODE_PINS_CENTRAL_TIMEOUT_MS;
  return {
    url,
    token: process.env[STUDIO_NODE_PINS_CENTRAL_TOKEN_ENV]?.trim() || null,
    timeoutMs,
    invalidReason,
  };
}

function buildStudioNodePinsCentralSyncStatus(
  config: StudioNodePinsCentralSyncConfig,
  sync?: Pick<
    StudioNodePinsCentralSyncStatus,
    "lastSyncedAt" | "statusCode" | "pushedPinCount" | "pulledPinCount" | "error"
  >,
): StudioNodePinsCentralSyncStatus {
  return {
    format: STUDIO_NODE_PINS_CENTRAL_STATUS_FORMAT,
    generatedAt: new Date().toISOString(),
    configured: Boolean(config.url && !config.invalidReason),
    urlConfigured: Boolean(process.env[STUDIO_NODE_PINS_CENTRAL_URL_ENV]?.trim()),
    tokenConfigured: Boolean(config.token),
    timeoutMs: config.timeoutMs,
    invalidReason: config.invalidReason,
    lastSyncedAt: sync?.lastSyncedAt ?? null,
    statusCode: sync?.statusCode ?? null,
    pushedPinCount: sync?.pushedPinCount ?? null,
    pulledPinCount: sync?.pulledPinCount ?? null,
    error: sync?.error ?? null,
    governance: {
      includesPinInputOutput: true,
      redactsSecretLikeKeys: true,
      excludesSecretValues: true,
      excludesHeaders: true,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
      storesCentralToken: false,
      configuredUrlEnv: STUDIO_NODE_PINS_CENTRAL_URL_ENV,
      configuredTokenEnv: STUDIO_NODE_PINS_CENTRAL_TOKEN_ENV,
      configuredTimeoutEnv: STUDIO_NODE_PINS_CENTRAL_TIMEOUT_ENV,
      maxPayloadBytes: STUDIO_NODE_PINS_CENTRAL_MAX_BYTES,
    },
  };
}

async function fetchCentralStudioNodePinsSync(
  config: StudioNodePinsCentralSyncConfig,
  flowId: string,
  pins: StudioNodePinsPackage,
): Promise<{ statusCode: number; body: string }> {
  if (!config.url) {
    throw new WorkspaceError("Central de pins de nó não configurada.", 400);
  }
  const body = JSON.stringify({
    format: STUDIO_NODE_PINS_CENTRAL_SYNC_REQUEST_FORMAT,
    generatedAt: new Date().toISOString(),
    flowId,
    pins,
    pinCount: pins.pinCount,
    governance: {
      includesPinInputOutput: true,
      redactsSecretLikeKeys: true,
      excludesSecretValues: true,
      excludesHeaders: true,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  });
  if (Buffer.byteLength(body, "utf-8") > STUDIO_NODE_PINS_CENTRAL_MAX_BYTES) {
    throw new WorkspaceError("Pacote de pins de nó excede o limite de tamanho permitido para sync central.", 413);
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
    if (Number.isFinite(contentLength) && contentLength > STUDIO_NODE_PINS_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central de pins de nó excede o limite de tamanho permitido.", 413);
    }
    if (!response.ok) {
      throw new WorkspaceError(`Central de pins de nó respondeu HTTP ${response.status}.`, response.status);
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > STUDIO_NODE_PINS_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central de pins de nó excede o limite de tamanho permitido.", 413);
    }
    return {
      statusCode: response.status,
      body: Buffer.from(buffer).toString("utf-8"),
    };
  } catch (error) {
    if (isRecord(error) && error.name === "AbortError") {
      throw new WorkspaceError("Timeout ao sincronizar central de pins de nó.", 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function validateStudioNodePinsCentralUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WorkspaceError(`${STUDIO_NODE_PINS_CENTRAL_URL_ENV} deve ser uma URL HTTP/HTTPS válida.`, 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WorkspaceError(`${STUDIO_NODE_PINS_CENTRAL_URL_ENV} deve usar http ou https.`, 400);
  }
  return parsed.toString();
}

function studioNodePinsPath(flowRoot: string): string {
  return path.join(flowRoot, STUDIO_NODE_PINS_FILE);
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

function normalizeId(value: string): string {
  return value.trim().slice(0, 160);
}

function normalizeNonNegativeInteger(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
}

function uniqueSortedText(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  );
}

function formatSignedInteger(value: number): string {
  if (!Number.isFinite(value) || value === 0) {
    return "0";
  }
  return value > 0 ? `+${value}` : String(value);
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
