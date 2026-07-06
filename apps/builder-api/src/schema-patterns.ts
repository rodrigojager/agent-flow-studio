import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadFlowById, WorkspaceError } from "./workspace.ts";

type SchemaPatternCurationStatus = "draft" | "approved" | "deprecated";
const SCHEMA_PATTERN_CURATION_LEASE_HOURS_ENV = "AGENT_FLOW_SCHEMA_PATTERN_CURATION_LEASE_HOURS";
const SCHEMA_PATTERN_CURATION_LEASE_HOURS = 24;

interface SchemaReusablePatternLibraryPackage {
  format: "agent-flow-builder.schema-pattern-library.v1";
  exportedAt: string;
  itemCount: number;
  conflictCount: number;
  openConflictCount: number;
  conflicts: SchemaPatternLibraryConflict[];
  items: SchemaReusablePatternLibraryItem[];
  packageHash: string;
  sharedSync: SchemaPatternSharedSyncInfo;
}

interface SchemaReusablePatternLibraryItem extends Record<string, unknown> {
  id: string;
  name: string;
  description: string;
  tags: string[];
  curationStatus: SchemaPatternCurationStatus;
  createdAt: string;
  updatedAt: string;
  schemaHash: string;
  schema: Record<string, unknown>;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  curationReviews?: SchemaPatternCurationReview[];
  curationThread?: SchemaPatternCurationThread;
  lastUsedAt?: string | null;
  usageCount?: number;
  summary?: Record<string, unknown> | null;
}

interface SchemaPatternCurationReview extends Record<string, unknown> {
  id: string;
  reviewer: string;
  role: string;
  decision: string;
  note: string;
  createdAt: string;
  schemaHash: string;
  assessmentStatus: string;
  assessmentScore: number;
}

interface SchemaPatternCurationThread extends Record<string, unknown> {
  status: string;
  assignee: string;
  openedAt: string | null;
  updatedAt: string | null;
  schemaHash: string;
  lastReviewer: string;
  lastDecision: string | null;
  leaseExpiresAt: string | null;
  leaseDurationHours: number | null;
  leaseExpired: boolean;
  reviewCount: number;
  requestChangesCount: number;
  events: SchemaPatternCurationEvent[];
  governance: {
    excludesRawSchemaContent: true;
    excludesSecretValues: true;
    autoReleasesExpiredAssignments?: true;
    configuredLeaseHoursEnv?: typeof SCHEMA_PATTERN_CURATION_LEASE_HOURS_ENV;
  };
}

type SchemaPatternCurationEventAction = "assign" | "release" | "review" | "lease_expired";

interface SchemaPatternCurationEvent {
  id: string;
  at: string;
  actor: string;
  action: SchemaPatternCurationEventAction;
  assignee: string;
  decision: string | null;
  note: string;
  schemaHash: string;
}

type SchemaPatternLibraryConflictStatus = "open" | "resolved";
type SchemaPatternLibraryConflictResolution =
  | "accept_current_library"
  | "accept_existing_snapshot"
  | "accept_incoming_snapshot"
  | "apply_manual_schema_merge";
type SchemaPatternLibraryConflictSelectedSnapshot = "current_library" | "existing_snapshot" | "incoming_snapshot";
type SchemaPatternLibraryConflictSchemaAction =
  | "current_schema_retained"
  | "selected_schema_already_current"
  | "manual_schema_reapply_required"
  | "manual_schema_merge_applied";
type SchemaPatternLibraryConflictMetadataAction =
  | "current_metadata_retained"
  | "selected_metadata_already_current"
  | "selected_metadata_applied"
  | "manual_schema_review_first";
type SchemaPatternResolvedConflictDecision = "keep_existing" | "allow_incoming";

interface SchemaPatternLibraryConflict {
  id: string;
  itemId: string;
  status: SchemaPatternLibraryConflictStatus;
  reason: string;
  existingSnapshot: SchemaPatternLibraryConflictSnapshot;
  incomingSnapshot: SchemaPatternLibraryConflictSnapshot;
  schemaMergePlan: SchemaPatternLibraryConflictMergePlan;
  existingUpdatedAt: string;
  incomingUpdatedAt: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string;
  resolution: SchemaPatternLibraryConflictResolution | null;
  resolutionNote: string;
  resolutionPlan: SchemaPatternLibraryConflictResolutionPlan | null;
  rawSchemaTextDiff?: SchemaPatternRawSchemaTextDiff;
}

interface SchemaPatternRawSchemaTextDiffRow {
  leftLine: number | null;
  rightLine: number | null;
  leftText: string;
  rightText: string;
  status: "same" | "changed" | "added" | "removed";
}

interface SchemaPatternRawSchemaTextDiff {
  format: "agent-flow-builder.schema-pattern-raw-text-diff.local.v1";
  generatedAt: string;
  existingSchemaHash: string;
  incomingSchemaHash: string;
  rowCount: number;
  changedRowCount: number;
  rows: SchemaPatternRawSchemaTextDiffRow[];
  governance: {
    localOnly: true;
    excludedFromSharedStorage: true;
    excludedFromExportsByDefault: true;
    containsRawSchemaContent: true;
    excludesSecretValues: false;
  };
}

interface SchemaPatternLibraryConflictSnapshot {
  id: string;
  name: string;
  tags: string[];
  curationStatus: SchemaPatternCurationStatus;
  curationThread?: SchemaPatternCurationThread;
  schemaHash: string;
  updatedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  lastUsedAt: string | null;
  usageCount: number;
  summary: Record<string, unknown> | null;
}

interface SchemaPatternLibraryConflictMergePlan {
  canAutoMerge: boolean;
  schemaChanged: boolean;
  propertyAdditions: string[];
  propertyExistingOnly: string[];
  propertyConflicts: string[];
  definitionAdditions: string[];
  definitionExistingOnly: string[];
  definitionConflicts: string[];
  requiredAdditions: string[];
  requiredExistingOnly: string[];
  compositionAdditions: number;
  compositionExistingOnly: number;
  additionalPropertiesChange: boolean;
  additionalPropertiesExistingOnly: boolean;
  additionalPropertiesConflict: boolean;
  governance: {
    excludesRawSchemaContent: true;
    excludesSecretValues: true;
  };
}

interface SchemaPatternLibraryConflictResolutionPlan {
  selectedSnapshot: SchemaPatternLibraryConflictSelectedSnapshot;
  requestedResolution: SchemaPatternLibraryConflictResolution;
  currentSchemaHash: string;
  selectedSchemaHash: string;
  schemaContentAction: SchemaPatternLibraryConflictSchemaAction;
  metadataAction: SchemaPatternLibraryConflictMetadataAction;
  metadataFieldsChanged: string[];
  requiresManualSchemaReview: boolean;
  governance: {
    excludesRawSchemaContent: true;
    excludesSecretValues: true;
  };
}

type SchemaPatternConflictReviewDiffItemStatus = "unchanged" | "changed" | "only_current" | "only_incoming";

interface SchemaPatternConflictReviewResolution {
  id: string;
  conflictId: string;
  itemId: string;
  resolvedAt: string;
  resolvedBy: string;
  resolution: SchemaPatternLibraryConflictResolution | null;
  resolutionNote: string;
  existingSchemaHash: string;
  incomingSchemaHash: string;
  resolutionPlan: SchemaPatternLibraryConflictResolutionPlan | null;
}

interface SchemaPatternConflictReviewPackage {
  format: "agent-flow-builder.schema-pattern-conflict-review.v1";
  exportedAt: string;
  flowId: string;
  source: {
    storage: string;
    packageHash: string;
    contentHash: string;
    itemCount: number;
  };
  summary: {
    itemCount: number;
    conflictCount: number;
    openConflictCount: number;
    resolvedConflictCount: number;
    resolutionCount: number;
    schemaChangedConflictCount: number;
    metadataOnlyConflictCount: number;
    autoMergeableConflictCount: number;
    manualMergeConflictCount: number;
    expiredLeaseCount: number;
  };
  conflictCount: number;
  openConflictCount: number;
  conflicts: SchemaPatternLibraryConflict[];
  resolutionCount: number;
  resolutions: SchemaPatternConflictReviewResolution[];
  packageHash: string;
  governance: {
    excludesRawSchemaContent: true;
    excludesLocalRawTextDiff: true;
    excludesSecretValues: true;
  };
}

interface SchemaPatternConflictReviewDiffItem {
  id: string;
  label: string;
  status: SchemaPatternConflictReviewDiffItemStatus;
  currentHash: string | null;
  incomingHash: string | null;
  currentSummary: string | null;
  incomingSummary: string | null;
}

interface SchemaPatternConflictReviewDiffSection {
  id: "summary" | "conflicts" | "resolutions";
  label: string;
  itemCount: number;
  changedCount: number;
  items: SchemaPatternConflictReviewDiffItem[];
}

interface SchemaPatternConflictReviewDiffPackage {
  format: "agent-flow-builder.schema-pattern-conflict-review-diff.v1";
  comparedAt: string;
  flowId: string;
  current: {
    packageHash: string;
    exportedAt: string;
    conflictCount: number;
    openConflictCount: number;
    resolutionCount: number;
  };
  incoming: {
    packageHash: string;
    exportedAt: string;
    conflictCount: number;
    openConflictCount: number;
    resolutionCount: number;
  };
  sections: SchemaPatternConflictReviewDiffSection[];
  packageHash: string;
  governance: {
    excludesRawSchemaContent: true;
    excludesLocalRawTextDiff: true;
    excludesSecretValues: true;
  };
}

interface SchemaPatternLibraryHistoryPackage {
  format: "agent-flow-builder.schema-pattern-library-history.v1";
  exportedAt: string;
  snapshotCount: number;
  snapshots: SchemaPatternLibraryHistorySnapshot[];
  governance: {
    excludesRawSchemaContent: true;
    excludesSecretValues: true;
  };
  packageHash: string;
  sharedSync: SchemaPatternSharedSyncInfo;
}

interface SchemaPatternLibraryHistorySnapshot extends Record<string, unknown> {
  id: string;
  capturedAt: string;
  snapshotHash: string;
}

type SchemaPatternSharedSyncAction = "empty" | "save" | "merge" | "resolve_conflict";
type SchemaPatternSharedSyncSubject = "library" | "history";

interface SchemaPatternSharedSyncInfo {
  action: SchemaPatternSharedSyncAction;
  subject: SchemaPatternSharedSyncSubject;
  updatedAt: string;
  storage: string;
  contentHash: string;
  incomingCount: number;
  existingCount: number;
  addedCount: number;
  updatedCount: number;
  unchangedCount: number;
  conflictCount: number;
  finalCount: number;
  governance: {
    excludesSecretValues: true;
    excludesRawSchemaContent: boolean;
  };
}

interface SchemaPatternSharedSyncStats {
  incomingCount: number;
  existingCount: number;
  addedCount: number;
  updatedCount: number;
  unchangedCount: number;
  conflictCount: number;
  finalCount: number;
}

const SCHEMA_PATTERN_LIBRARY_FILE = ".agent-flow/schema-patterns/library.afschemapatterns.json";
const SCHEMA_PATTERN_HISTORY_FILE = ".agent-flow/schema-patterns/history.afschemapatternhistory.json";
const SCHEMA_PATTERN_CENTRAL_SYNC_REQUEST_FORMAT = "agent-flow-builder.schema-pattern-central-sync-request.v1";
const SCHEMA_PATTERN_CENTRAL_SYNC_RESULT_FORMAT = "agent-flow-builder.schema-pattern-central-sync-result.v1";
const SCHEMA_PATTERN_CENTRAL_STATUS_FORMAT = "agent-flow-builder.schema-pattern-central-sync-status.v1";
const SCHEMA_PATTERN_COMPOSITION_KEYS = ["oneOf", "allOf", "anyOf"] as const;
const SCHEMA_PATTERN_CENTRAL_URL_ENV = "AGENT_FLOW_SCHEMA_PATTERN_CENTRAL_URL";
const SCHEMA_PATTERN_CENTRAL_TOKEN_ENV = "AGENT_FLOW_SCHEMA_PATTERN_CENTRAL_TOKEN";
const SCHEMA_PATTERN_CENTRAL_TIMEOUT_ENV = "AGENT_FLOW_SCHEMA_PATTERN_CENTRAL_TIMEOUT_MS";
const SCHEMA_PATTERN_CENTRAL_TIMEOUT_MS = 5_000;
const SCHEMA_PATTERN_CENTRAL_MAX_BYTES = 2_000_000;

interface SchemaPatternCentralSyncStatus {
  format: typeof SCHEMA_PATTERN_CENTRAL_STATUS_FORMAT;
  generatedAt: string;
  configured: boolean;
  urlConfigured: boolean;
  tokenConfigured: boolean;
  timeoutMs: number;
  invalidReason: string | null;
  lastSyncedAt: string | null;
  statusCode: number | null;
  pushedLibraryItemCount: number | null;
  pulledLibraryItemCount: number | null;
  pushedHistorySnapshotCount: number | null;
  pulledHistorySnapshotCount: number | null;
  error: string | null;
  governance: {
    excludesSecretValues: true;
    sendsRawSchemaContent: true;
    sendsHistoryRawSchemaContent: false;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
    storesCentralToken: false;
    configuredUrlEnv: typeof SCHEMA_PATTERN_CENTRAL_URL_ENV;
    configuredTokenEnv: typeof SCHEMA_PATTERN_CENTRAL_TOKEN_ENV;
    configuredTimeoutEnv: typeof SCHEMA_PATTERN_CENTRAL_TIMEOUT_ENV;
    maxPayloadBytes: typeof SCHEMA_PATTERN_CENTRAL_MAX_BYTES;
  };
}

interface SchemaPatternCentralSyncResult {
  format: typeof SCHEMA_PATTERN_CENTRAL_SYNC_RESULT_FORMAT;
  flowId: string;
  library: SchemaReusablePatternLibraryPackage;
  history: SchemaPatternLibraryHistoryPackage;
  central: SchemaPatternCentralSyncStatus;
  pushedLibraryItemCount: number;
  pulledLibraryItemCount: number;
  pushedHistorySnapshotCount: number;
  pulledHistorySnapshotCount: number;
  governance: {
    excludesSecretValues: true;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
  };
}

export async function loadSchemaPatternLibrary(
  workspaceRoot: string,
  flowId: string,
): Promise<SchemaReusablePatternLibraryPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const libraryPath = schemaPatternLibraryPath(loaded.flowRoot);
  try {
    const raw = await readFile(libraryPath, "utf-8");
    const payload = normalizeSchemaPatternLibraryPackage(JSON.parse(raw) as unknown);
    if (!payload) {
      throw new WorkspaceError("Biblioteca compartilhada de padrões de schema inválida.", 422);
    }
    return payload;
  } catch (error) {
    if (isFileNotFound(error)) {
      return buildSchemaPatternLibraryPackage([], {
        action: "empty",
        subject: "library",
        storage: SCHEMA_PATTERN_LIBRARY_FILE,
        excludesRawSchemaContent: false,
      });
    }
    if (error instanceof WorkspaceError) {
      throw error;
    }
    throw new WorkspaceError("Falha ao ler biblioteca compartilhada de padrões de schema.", 500, error);
  }
}

export async function saveSchemaPatternLibrary(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<SchemaReusablePatternLibraryPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const packageValue = normalizeSchemaPatternLibraryPackage(payload);
  if (!packageValue) {
    throw new WorkspaceError("Payload de biblioteca de padrões de schema inválido.", 400);
  }
  const existing = await loadSchemaPatternLibrary(workspaceRoot, flowId);
  const nextPackage = buildSchemaPatternLibraryPackage(packageValue.items, {
    action: "save",
    subject: "library",
    storage: SCHEMA_PATTERN_LIBRARY_FILE,
    excludesRawSchemaContent: false,
    stats: {
      incomingCount: packageValue.items.length,
      existingCount: existing.itemCount,
      addedCount: packageValue.items.filter((item) => !existing.items.some((existingItem) => existingItem.id === item.id)).length,
      updatedCount: packageValue.items.filter((item) => existing.items.some((existingItem) => existingItem.id === item.id)).length,
      unchangedCount: 0,
      conflictCount: 0,
      finalCount: packageValue.items.length,
    },
  }, packageValue.conflicts);
  await writeJsonFile(schemaPatternLibraryPath(loaded.flowRoot), nextPackage);
  return nextPackage;
}

export async function mergeSchemaPatternLibrary(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<SchemaReusablePatternLibraryPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const incoming = normalizeSchemaPatternLibraryPackage(payload);
  if (!incoming) {
    throw new WorkspaceError("Payload de merge da biblioteca de padrões de schema inválido.", 400);
  }
  const existing = await loadSchemaPatternLibrary(workspaceRoot, flowId);
  const merged = mergeSchemaPatternLibraryItems(existing.items, incoming.items, existing.conflicts, incoming.conflicts);
  const nextPackage = buildSchemaPatternLibraryPackage(merged.items, {
    action: "merge",
    subject: "library",
    storage: SCHEMA_PATTERN_LIBRARY_FILE,
    excludesRawSchemaContent: false,
    stats: merged.stats,
  }, merged.conflicts);
  await writeJsonFile(schemaPatternLibraryPath(loaded.flowRoot), nextPackage);
  return attachLocalRawSchemaTextDiffs(nextPackage, existing.items, incoming.items);
}

export async function resolveSchemaPatternLibraryConflict(
  workspaceRoot: string,
  flowId: string,
  conflictId: string,
  payload: unknown,
): Promise<SchemaReusablePatternLibraryPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const normalizedConflictId = conflictId.trim();
  if (!normalizedConflictId) {
    throw new WorkspaceError("ID do conflito de padrão de schema é obrigatório.", 400);
  }
  const existing = await loadSchemaPatternLibrary(workspaceRoot, flowId);
  const conflict = existing.conflicts.find((entry) => entry.id === normalizedConflictId);
  if (!conflict) {
    throw new WorkspaceError("Conflito de padrão de schema não encontrado.", 404);
  }
  const resolvedBy = resolveSchemaPatternConflictActor(payload);
  const resolution = normalizeSchemaPatternConflictResolution(isRecord(payload) ? payload.resolution : undefined);
  const resolutionNote = normalizeOptionalText(isRecord(payload) ? payload.resolutionNote : undefined, 240);
  const resolvedAt = new Date().toISOString();
  const currentItem = existing.items.find((item) => item.id === conflict.itemId) ?? null;
  const resolutionResult = resolveSchemaPatternConflictItem(currentItem, conflict, resolution, resolvedAt, payload);
  const nextItems = resolutionResult.item
    ? existing.items.map((item) => (item.id === resolutionResult.item?.id ? resolutionResult.item : item))
    : existing.items;
  const nextConflicts = existing.conflicts.map((entry) =>
    entry.id === normalizedConflictId
      ? {
          ...entry,
          status: "resolved" as const,
          resolvedAt,
          resolvedBy,
          resolution,
          resolutionNote,
          resolutionPlan: resolutionResult.plan,
        }
      : entry,
  );
  const itemChanged = stableStringify(nextItems) !== stableStringify(existing.items);
  const nextPackage = buildSchemaPatternLibraryPackage(nextItems, {
    action: "resolve_conflict",
    subject: "library",
    storage: SCHEMA_PATTERN_LIBRARY_FILE,
    excludesRawSchemaContent: false,
    stats: {
      incomingCount: existing.itemCount,
      existingCount: existing.itemCount,
      addedCount: 0,
      updatedCount: itemChanged ? 1 : 0,
      unchangedCount: itemChanged ? Math.max(0, existing.itemCount - 1) : existing.itemCount,
      conflictCount: 1,
      finalCount: existing.itemCount,
    },
  }, nextConflicts);
  await writeJsonFile(schemaPatternLibraryPath(loaded.flowRoot), nextPackage);
  return nextPackage;
}

export async function loadSchemaPatternConflictReview(
  workspaceRoot: string,
  flowId: string,
): Promise<SchemaPatternConflictReviewPackage> {
  const library = await loadSchemaPatternLibrary(workspaceRoot, flowId);
  return buildSchemaPatternConflictReviewPackage(flowId, library);
}

export async function compareSchemaPatternConflictReview(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<SchemaPatternConflictReviewDiffPackage> {
  const reviewPayload = isRecord(payload) && payload.review !== undefined ? payload.review : payload;
  if (containsRawSchemaPatternConflictReviewPayload(reviewPayload)) {
    throw new WorkspaceError(
      "Revisão de conflitos de padrões de schema não pode conter schema bruto, diff textual local, items, payloads ou secrets.",
      400,
    );
  }
  const incoming = normalizeSchemaPatternConflictReviewPackage(reviewPayload);
  if (!incoming) {
    throw new WorkspaceError("Revisão de conflitos de padrões de schema inválida.", 400);
  }
  const current = await loadSchemaPatternConflictReview(workspaceRoot, flowId);
  return buildSchemaPatternConflictReviewDiffPackage(current, incoming);
}

export async function loadSchemaPatternHistory(
  workspaceRoot: string,
  flowId: string,
): Promise<SchemaPatternLibraryHistoryPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const historyPath = schemaPatternHistoryPath(loaded.flowRoot);
  try {
    const raw = await readFile(historyPath, "utf-8");
    const payload = normalizeSchemaPatternHistoryPackage(JSON.parse(raw) as unknown);
    if (!payload) {
      throw new WorkspaceError("Histórico compartilhado de padrões de schema inválido.", 422);
    }
    return payload;
  } catch (error) {
    if (isFileNotFound(error)) {
      return buildSchemaPatternHistoryPackage([], {
        action: "empty",
        subject: "history",
        storage: SCHEMA_PATTERN_HISTORY_FILE,
        excludesRawSchemaContent: true,
      });
    }
    if (error instanceof WorkspaceError) {
      throw error;
    }
    throw new WorkspaceError("Falha ao ler histórico compartilhado de padrões de schema.", 500, error);
  }
}

export async function saveSchemaPatternHistory(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<SchemaPatternLibraryHistoryPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const packageValue = normalizeSchemaPatternHistoryPackage(payload);
  if (!packageValue) {
    throw new WorkspaceError("Payload de histórico de padrões de schema inválido.", 400);
  }
  const existing = await loadSchemaPatternHistory(workspaceRoot, flowId);
  const nextPackage = buildSchemaPatternHistoryPackage(packageValue.snapshots, {
    action: "save",
    subject: "history",
    storage: SCHEMA_PATTERN_HISTORY_FILE,
    excludesRawSchemaContent: true,
    stats: {
      incomingCount: packageValue.snapshots.length,
      existingCount: existing.snapshotCount,
      addedCount: packageValue.snapshots.filter(
        (snapshot) => !existing.snapshots.some((existingSnapshot) => existingSnapshot.snapshotHash === snapshot.snapshotHash),
      ).length,
      updatedCount: 0,
      unchangedCount: packageValue.snapshots.filter(
        (snapshot) => existing.snapshots.some((existingSnapshot) => existingSnapshot.snapshotHash === snapshot.snapshotHash),
      ).length,
      conflictCount: 0,
      finalCount: packageValue.snapshots.length,
    },
  });
  await writeJsonFile(schemaPatternHistoryPath(loaded.flowRoot), nextPackage);
  return nextPackage;
}

export async function mergeSchemaPatternHistory(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<SchemaPatternLibraryHistoryPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const incoming = normalizeSchemaPatternHistoryPackage(payload);
  if (!incoming) {
    throw new WorkspaceError("Payload de merge do histórico de padrões de schema inválido.", 400);
  }
  const existing = await loadSchemaPatternHistory(workspaceRoot, flowId);
  const merged = mergeSchemaPatternHistorySnapshots(existing.snapshots, incoming.snapshots);
  const nextPackage = buildSchemaPatternHistoryPackage(merged.snapshots, {
    action: "merge",
    subject: "history",
    storage: SCHEMA_PATTERN_HISTORY_FILE,
    excludesRawSchemaContent: true,
    stats: merged.stats,
  });
  await writeJsonFile(schemaPatternHistoryPath(loaded.flowRoot), nextPackage);
  return nextPackage;
}

export async function loadSchemaPatternCentralSyncStatus(): Promise<SchemaPatternCentralSyncStatus> {
  return buildSchemaPatternCentralSyncStatus(schemaPatternCentralSyncConfig());
}

export async function syncCentralSchemaPatterns(
  workspaceRoot: string,
  flowId: string,
): Promise<SchemaPatternCentralSyncResult> {
  const config = schemaPatternCentralSyncConfig();
  if (config.invalidReason) {
    throw new WorkspaceError(`Serviço central de padrões de schema inválido: ${config.invalidReason}`, 422);
  }
  if (!config.url) {
    throw new WorkspaceError(`Configure ${SCHEMA_PATTERN_CENTRAL_URL_ENV} para sincronizar padrões de schema.`, 400);
  }

  const library = await loadSchemaPatternLibrary(workspaceRoot, flowId);
  const history = await loadSchemaPatternHistory(workspaceRoot, flowId);
  const fetched = await fetchCentralSchemaPatternSync(config, flowId, library, history);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fetched.body);
  } catch (error) {
    throw new WorkspaceError("Serviço central de padrões de schema não retornou JSON válido.", 502, error);
  }
  if (!isRecord(parsed)) {
    throw new WorkspaceError("Resposta central de padrões de schema deve ser objeto.", 502);
  }
  const incomingLibrary = normalizeSchemaPatternLibraryPackage(parsed.library);
  const incomingHistory = normalizeSchemaPatternHistoryPackage(parsed.history);
  if (!incomingLibrary && !incomingHistory) {
    throw new WorkspaceError("Resposta central precisa conter library e/ou history válidos.", 502);
  }
  const mergedLibrary = incomingLibrary
    ? await mergeSchemaPatternLibrary(workspaceRoot, flowId, incomingLibrary)
    : library;
  const mergedHistory = incomingHistory
    ? await mergeSchemaPatternHistory(workspaceRoot, flowId, incomingHistory)
    : history;
  const syncedAt = new Date().toISOString();
  const pulledLibraryItemCount = incomingLibrary?.itemCount ?? 0;
  const pulledHistorySnapshotCount = incomingHistory?.snapshotCount ?? 0;
  return {
    format: SCHEMA_PATTERN_CENTRAL_SYNC_RESULT_FORMAT,
    flowId,
    library: mergedLibrary,
    history: mergedHistory,
    central: buildSchemaPatternCentralSyncStatus(config, {
      lastSyncedAt: syncedAt,
      statusCode: fetched.statusCode,
      pushedLibraryItemCount: library.itemCount,
      pulledLibraryItemCount,
      pushedHistorySnapshotCount: history.snapshotCount,
      pulledHistorySnapshotCount,
      error: null,
    }),
    pushedLibraryItemCount: library.itemCount,
    pulledLibraryItemCount,
    pushedHistorySnapshotCount: history.snapshotCount,
    pulledHistorySnapshotCount,
    governance: {
      excludesSecretValues: true,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  };
}

function schemaPatternLibraryPath(flowRoot: string): string {
  return path.join(flowRoot, SCHEMA_PATTERN_LIBRARY_FILE);
}

function schemaPatternHistoryPath(flowRoot: string): string {
  return path.join(flowRoot, SCHEMA_PATTERN_HISTORY_FILE);
}

interface SchemaPatternCentralSyncConfig {
  url: string | null;
  token: string | null;
  timeoutMs: number;
  invalidReason: string | null;
}

function schemaPatternCentralSyncConfig(): SchemaPatternCentralSyncConfig {
  const errors: string[] = [];
  const configuredUrl = (process.env[SCHEMA_PATTERN_CENTRAL_URL_ENV] ?? "").trim();
  let url: string | null = null;
  if (configuredUrl) {
    try {
      url = validateSchemaPatternCentralUrl(configuredUrl);
    } catch (error) {
      errors.push(errorMessage(error));
    }
  }
  let timeoutMs = SCHEMA_PATTERN_CENTRAL_TIMEOUT_MS;
  const configuredTimeout = (process.env[SCHEMA_PATTERN_CENTRAL_TIMEOUT_ENV] ?? "").trim();
  if (configuredTimeout) {
    const parsed = Number(configuredTimeout);
    if (!Number.isInteger(parsed) || parsed < 100 || parsed > 60_000) {
      errors.push(`${SCHEMA_PATTERN_CENTRAL_TIMEOUT_ENV} deve ser inteiro entre 100 e 60000.`);
    } else {
      timeoutMs = parsed;
    }
  }
  return {
    url,
    token: (process.env[SCHEMA_PATTERN_CENTRAL_TOKEN_ENV] ?? "").trim() || null,
    timeoutMs,
    invalidReason: errors.length ? errors.join(" ") : null,
  };
}

function buildSchemaPatternCentralSyncStatus(
  config: SchemaPatternCentralSyncConfig,
  sync?: Pick<
    SchemaPatternCentralSyncStatus,
    | "lastSyncedAt"
    | "statusCode"
    | "pushedLibraryItemCount"
    | "pulledLibraryItemCount"
    | "pushedHistorySnapshotCount"
    | "pulledHistorySnapshotCount"
    | "error"
  >,
): SchemaPatternCentralSyncStatus {
  return {
    format: SCHEMA_PATTERN_CENTRAL_STATUS_FORMAT,
    generatedAt: new Date().toISOString(),
    configured: Boolean(config.url && !config.invalidReason),
    urlConfigured: Boolean(config.url),
    tokenConfigured: Boolean(config.token),
    timeoutMs: config.timeoutMs,
    invalidReason: config.invalidReason,
    lastSyncedAt: sync?.lastSyncedAt ?? null,
    statusCode: sync?.statusCode ?? null,
    pushedLibraryItemCount: sync?.pushedLibraryItemCount ?? null,
    pulledLibraryItemCount: sync?.pulledLibraryItemCount ?? null,
    pushedHistorySnapshotCount: sync?.pushedHistorySnapshotCount ?? null,
    pulledHistorySnapshotCount: sync?.pulledHistorySnapshotCount ?? null,
    error: sync?.error ?? null,
    governance: {
      excludesSecretValues: true,
      sendsRawSchemaContent: true,
      sendsHistoryRawSchemaContent: false,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
      storesCentralToken: false,
      configuredUrlEnv: SCHEMA_PATTERN_CENTRAL_URL_ENV,
      configuredTokenEnv: SCHEMA_PATTERN_CENTRAL_TOKEN_ENV,
      configuredTimeoutEnv: SCHEMA_PATTERN_CENTRAL_TIMEOUT_ENV,
      maxPayloadBytes: SCHEMA_PATTERN_CENTRAL_MAX_BYTES,
    },
  };
}

async function fetchCentralSchemaPatternSync(
  config: SchemaPatternCentralSyncConfig,
  flowId: string,
  library: SchemaReusablePatternLibraryPackage,
  history: SchemaPatternLibraryHistoryPackage,
): Promise<{ statusCode: number; body: string }> {
  if (!config.url) {
    throw new WorkspaceError("Serviço central de padrões de schema não configurado.", 400);
  }
  const body = JSON.stringify({
    format: SCHEMA_PATTERN_CENTRAL_SYNC_REQUEST_FORMAT,
    generatedAt: new Date().toISOString(),
    flowId,
    library,
    history,
    governance: {
      excludesSecretValues: true,
      sendsRawSchemaContent: true,
      sendsHistoryRawSchemaContent: false,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  });
  if (Buffer.byteLength(body, "utf-8") > SCHEMA_PATTERN_CENTRAL_MAX_BYTES) {
    throw new WorkspaceError("Pacote local de padrões de schema excede o limite do sync central.", 413);
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
    if (Number.isFinite(contentLength) && contentLength > SCHEMA_PATTERN_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central de padrões de schema excede o limite permitido.", 413);
    }
    if (!response.ok) {
      throw new WorkspaceError(`Serviço central de padrões de schema respondeu HTTP ${response.status}.`, response.status);
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > SCHEMA_PATTERN_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central de padrões de schema excede o limite permitido.", 413);
    }
    return {
      statusCode: response.status,
      body: Buffer.from(buffer).toString("utf-8"),
    };
  } catch (error) {
    if (isRecord(error) && error.name === "AbortError") {
      throw new WorkspaceError("Timeout ao sincronizar padrões de schema com serviço central.", 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function validateSchemaPatternCentralUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WorkspaceError(`URL central de padrões de schema inválida: ${value}`, 422);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WorkspaceError(`URL central de padrões de schema deve usar http ou https: ${value}`, 422);
  }
  if (url.username || url.password) {
    throw new WorkspaceError("URL central de padrões de schema não pode conter usuário ou senha.", 422);
  }
  return url.toString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await rename(tempPath, filePath);
}

function normalizeSchemaPatternLibraryPackage(value: unknown): SchemaReusablePatternLibraryPackage | null {
  if (!isRecord(value) || value.format !== "agent-flow-builder.schema-pattern-library.v1" || !Array.isArray(value.items)) {
    return null;
  }
  return buildSchemaPatternLibraryPackage(
    value.items,
    normalizeSchemaPatternSharedSyncInfo(value.sharedSync, {
      action: "merge",
      subject: "library",
      storage: SCHEMA_PATTERN_LIBRARY_FILE,
      excludesRawSchemaContent: false,
    }),
    Array.isArray(value.conflicts) ? value.conflicts : [],
  );
}

function buildSchemaPatternLibraryPackage(
  items: unknown[],
  syncInput: SchemaPatternSharedSyncBuildInput,
  conflicts: unknown[] = [],
): SchemaReusablePatternLibraryPackage {
  const normalized = syncSchemaPatternLibraryItems(items);
  const normalizedConflicts = syncSchemaPatternLibraryConflicts(conflicts, normalized);
  const contentHash = shortHash(stableStringify({
    format: "agent-flow-builder.schema-pattern-library.v1",
    conflicts: normalizedConflicts,
    items: normalized,
  }));
  return {
    format: "agent-flow-builder.schema-pattern-library.v1",
    exportedAt: new Date().toISOString(),
    itemCount: normalized.length,
    conflictCount: normalizedConflicts.length,
    openConflictCount: normalizedConflicts.filter((conflict) => conflict.status === "open").length,
    conflicts: normalizedConflicts,
    items: normalized,
    packageHash: contentHash,
    sharedSync: buildSchemaPatternSharedSyncInfo(syncInput, contentHash, normalized.length),
  };
}

function buildSchemaPatternConflictReviewPackage(
  flowId: string,
  library: SchemaReusablePatternLibraryPackage,
): SchemaPatternConflictReviewPackage {
  return buildSchemaPatternConflictReviewPackageFromParts({
    flowId,
    source: {
      storage: SCHEMA_PATTERN_LIBRARY_FILE,
      packageHash: library.packageHash,
      contentHash: shortHash(stableStringify({
        conflicts: library.conflicts.map(stripSchemaPatternConflictReviewLocalFields),
        itemCount: library.itemCount,
      })),
      itemCount: library.itemCount,
    },
    conflicts: library.conflicts,
  });
}

function buildSchemaPatternConflictReviewPackageFromParts(input: {
  flowId: string;
  exportedAt?: string;
  source: SchemaPatternConflictReviewPackage["source"];
  conflicts: unknown[];
}): SchemaPatternConflictReviewPackage {
  const conflicts = input.conflicts
    .map(normalizeSchemaPatternLibraryConflict)
    .filter((conflict): conflict is SchemaPatternLibraryConflict => conflict !== null)
    .map(stripSchemaPatternConflictReviewLocalFields);
  const resolutions = schemaPatternConflictReviewResolutions(conflicts);
  const summary = schemaPatternConflictReviewSummary(input.source.itemCount, conflicts, resolutions);
  const withoutHash = {
    format: "agent-flow-builder.schema-pattern-conflict-review.v1" as const,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    flowId: input.flowId,
    source: input.source,
    summary,
    conflictCount: conflicts.length,
    openConflictCount: conflicts.filter((conflict) => conflict.status === "open").length,
    conflicts,
    resolutionCount: resolutions.length,
    resolutions,
    governance: {
      excludesRawSchemaContent: true as const,
      excludesLocalRawTextDiff: true as const,
      excludesSecretValues: true as const,
    },
  };
  return {
    ...withoutHash,
    packageHash: shortHash(stableStringify(withoutHash)),
  };
}

function normalizeSchemaPatternConflictReviewPackage(value: unknown): SchemaPatternConflictReviewPackage | null {
  if (!isRecord(value) || value.format !== "agent-flow-builder.schema-pattern-conflict-review.v1" || !Array.isArray(value.conflicts)) {
    return null;
  }
  const conflicts = value.conflicts
    .map(normalizeSchemaPatternLibraryConflict)
    .filter((conflict): conflict is SchemaPatternLibraryConflict => conflict !== null);
  const source = isRecord(value.source)
    ? {
        storage: typeof value.source.storage === "string" && value.source.storage.trim()
          ? value.source.storage.trim()
          : SCHEMA_PATTERN_LIBRARY_FILE,
        packageHash: typeof value.source.packageHash === "string" && value.source.packageHash.trim()
          ? value.source.packageHash.trim()
          : "",
        contentHash: typeof value.source.contentHash === "string" && value.source.contentHash.trim()
          ? value.source.contentHash.trim()
          : shortHash(stableStringify(conflicts.map(stripSchemaPatternConflictReviewLocalFields))),
        itemCount: normalizeNonNegativeInteger(value.source.itemCount) ?? conflicts.length,
      }
    : {
        storage: SCHEMA_PATTERN_LIBRARY_FILE,
        packageHash: "",
        contentHash: shortHash(stableStringify(conflicts.map(stripSchemaPatternConflictReviewLocalFields))),
        itemCount: conflicts.length,
      };
  return buildSchemaPatternConflictReviewPackageFromParts({
    flowId: typeof value.flowId === "string" && value.flowId.trim() ? value.flowId.trim() : "",
    exportedAt: typeof value.exportedAt === "string" && value.exportedAt.trim() ? value.exportedAt.trim() : undefined,
    source,
    conflicts,
  });
}

function containsRawSchemaPatternConflictReviewPayload(value: unknown): boolean {
  const rawKeys = new Set([
    "schema",
    "items",
    "item",
    "payload",
    "input",
    "output",
    "rawSchemaTextDiff",
    "leftText",
    "rightText",
    "secret",
    "secrets",
  ]);
  const visit = (entry: unknown): boolean => {
    if (Array.isArray(entry)) {
      return entry.some(visit);
    }
    if (!isRecord(entry)) {
      return false;
    }
    return Object.entries(entry).some(([key, item]) => rawKeys.has(key) || visit(item));
  };
  return visit(value);
}

function buildSchemaPatternConflictReviewDiffPackage(
  current: SchemaPatternConflictReviewPackage,
  incoming: SchemaPatternConflictReviewPackage,
): SchemaPatternConflictReviewDiffPackage {
  const sections: SchemaPatternConflictReviewDiffSection[] = [
    buildSchemaPatternConflictReviewSummaryDiffSection(current, incoming),
    buildSchemaPatternConflictReviewDiffSection(
      "conflicts",
      "Conflitos",
      current.conflicts,
      incoming.conflicts,
      (conflict) => conflict.id,
      schemaPatternConflictReviewConflictSignature,
      schemaPatternConflictReviewConflictSummary,
    ),
    buildSchemaPatternConflictReviewDiffSection(
      "resolutions",
      "Decisões",
      current.resolutions,
      incoming.resolutions,
      (resolution) => resolution.id,
      (resolution) => stableStringify(resolution),
      schemaPatternConflictReviewResolutionSummary,
    ),
  ];
  const withoutHash = {
    format: "agent-flow-builder.schema-pattern-conflict-review-diff.v1" as const,
    comparedAt: new Date().toISOString(),
    flowId: current.flowId || incoming.flowId,
    current: {
      packageHash: current.packageHash,
      exportedAt: current.exportedAt,
      conflictCount: current.conflictCount,
      openConflictCount: current.openConflictCount,
      resolutionCount: current.resolutionCount,
    },
    incoming: {
      packageHash: incoming.packageHash,
      exportedAt: incoming.exportedAt,
      conflictCount: incoming.conflictCount,
      openConflictCount: incoming.openConflictCount,
      resolutionCount: incoming.resolutionCount,
    },
    sections,
    governance: {
      excludesRawSchemaContent: true as const,
      excludesLocalRawTextDiff: true as const,
      excludesSecretValues: true as const,
    },
  };
  return {
    ...withoutHash,
    packageHash: shortHash(stableStringify(withoutHash)),
  };
}

function buildSchemaPatternConflictReviewSummaryDiffSection(
  current: SchemaPatternConflictReviewPackage,
  incoming: SchemaPatternConflictReviewPackage,
): SchemaPatternConflictReviewDiffSection {
  return buildSchemaPatternConflictReviewDiffSection(
    "summary",
    "Resumo",
    schemaPatternConflictReviewSummaryItems(current),
    schemaPatternConflictReviewSummaryItems(incoming),
    (item) => item.id,
    (item) => String(item.value),
    (item) => `${item.label}: ${item.value}`,
  );
}

function buildSchemaPatternConflictReviewDiffSection<T>(
  id: SchemaPatternConflictReviewDiffSection["id"],
  label: string,
  currentItems: T[],
  incomingItems: T[],
  keyFor: (item: T) => string,
  hashFor: (item: T) => string,
  summaryFor: (item: T) => string,
): SchemaPatternConflictReviewDiffSection {
  const currentByKey = new Map(currentItems.map((item) => [keyFor(item), item]));
  const incomingByKey = new Map(incomingItems.map((item) => [keyFor(item), item]));
  const keys = Array.from(new Set([...currentByKey.keys(), ...incomingByKey.keys()])).sort((left, right) => left.localeCompare(right));
  const items = keys.map((key) => {
    const current = currentByKey.get(key) ?? null;
    const incoming = incomingByKey.get(key) ?? null;
    const currentHash = current ? hashFor(current) : null;
    const incomingHash = incoming ? hashFor(incoming) : null;
    return {
      id: key,
      label: current ? summaryFor(current) : incoming ? summaryFor(incoming) : key,
      status: schemaPatternConflictReviewDiffStatus(currentHash, incomingHash),
      currentHash,
      incomingHash,
      currentSummary: current ? summaryFor(current) : null,
      incomingSummary: incoming ? summaryFor(incoming) : null,
    };
  });
  return {
    id,
    label,
    itemCount: items.length,
    changedCount: items.filter((item) => item.status !== "unchanged").length,
    items,
  };
}

function schemaPatternConflictReviewDiffStatus(
  currentHash: string | null,
  incomingHash: string | null,
): SchemaPatternConflictReviewDiffItemStatus {
  if (currentHash && incomingHash) {
    return currentHash === incomingHash ? "unchanged" : "changed";
  }
  return currentHash ? "only_current" : "only_incoming";
}

function schemaPatternConflictReviewSummary(
  itemCount: number,
  conflicts: SchemaPatternLibraryConflict[],
  resolutions: SchemaPatternConflictReviewResolution[],
): SchemaPatternConflictReviewPackage["summary"] {
  return {
    itemCount,
    conflictCount: conflicts.length,
    openConflictCount: conflicts.filter((conflict) => conflict.status === "open").length,
    resolvedConflictCount: conflicts.filter((conflict) => conflict.status === "resolved").length,
    resolutionCount: resolutions.length,
    schemaChangedConflictCount: conflicts.filter((conflict) => conflict.schemaMergePlan.schemaChanged).length,
    metadataOnlyConflictCount: conflicts.filter((conflict) => !conflict.schemaMergePlan.schemaChanged).length,
    autoMergeableConflictCount: conflicts.filter((conflict) => conflict.schemaMergePlan.canAutoMerge).length,
    manualMergeConflictCount: conflicts.filter((conflict) => conflict.schemaMergePlan.schemaChanged && !conflict.schemaMergePlan.canAutoMerge).length,
    expiredLeaseCount: conflicts.filter((conflict) => schemaPatternConflictHasExpiredLease(conflict)).length,
  };
}

function schemaPatternConflictReviewSummaryItems(
  review: SchemaPatternConflictReviewPackage,
): Array<{ id: keyof SchemaPatternConflictReviewPackage["summary"]; label: string; value: number }> {
  return [
    { id: "itemCount", label: "Itens", value: review.summary.itemCount },
    { id: "conflictCount", label: "Conflitos", value: review.summary.conflictCount },
    { id: "openConflictCount", label: "Abertos", value: review.summary.openConflictCount },
    { id: "resolvedConflictCount", label: "Resolvidos", value: review.summary.resolvedConflictCount },
    { id: "resolutionCount", label: "Decisões", value: review.summary.resolutionCount },
    { id: "schemaChangedConflictCount", label: "Schema alterado", value: review.summary.schemaChangedConflictCount },
    { id: "metadataOnlyConflictCount", label: "Metadados", value: review.summary.metadataOnlyConflictCount },
    { id: "autoMergeableConflictCount", label: "Auto-merge", value: review.summary.autoMergeableConflictCount },
    { id: "manualMergeConflictCount", label: "Merge manual", value: review.summary.manualMergeConflictCount },
    { id: "expiredLeaseCount", label: "Lease expirado", value: review.summary.expiredLeaseCount },
  ];
}

function schemaPatternConflictReviewResolutions(
  conflicts: SchemaPatternLibraryConflict[],
): SchemaPatternConflictReviewResolution[] {
  return conflicts
    .filter((conflict) => conflict.status === "resolved" || Boolean(conflict.resolvedAt || conflict.resolution))
    .map((conflict) => ({
      id: `schema-pattern-resolution-${shortHash(stableStringify({
        conflictId: conflict.id,
        resolvedAt: conflict.resolvedAt,
        resolution: conflict.resolution,
        plan: conflict.resolutionPlan,
      }))}`,
      conflictId: conflict.id,
      itemId: conflict.itemId,
      resolvedAt: conflict.resolvedAt ?? "",
      resolvedBy: conflict.resolvedBy,
      resolution: conflict.resolution,
      resolutionNote: conflict.resolutionNote,
      existingSchemaHash: conflict.existingSnapshot.schemaHash,
      incomingSchemaHash: conflict.incomingSnapshot.schemaHash,
      resolutionPlan: conflict.resolutionPlan,
    }))
    .sort((left, right) => comparableTimestamp(right.resolvedAt) - comparableTimestamp(left.resolvedAt));
}

function schemaPatternConflictHasExpiredLease(conflict: SchemaPatternLibraryConflict): boolean {
  return conflict.existingSnapshot.curationThread?.leaseExpired === true ||
    conflict.incomingSnapshot.curationThread?.leaseExpired === true;
}

function schemaPatternConflictReviewConflictSignature(conflict: SchemaPatternLibraryConflict): string {
  return stableStringify(stripSchemaPatternConflictReviewLocalFields(conflict));
}

function schemaPatternConflictReviewConflictSummary(conflict: SchemaPatternLibraryConflict): string {
  const status = conflict.status === "resolved" ? `resolvido por ${conflict.resolvedBy || "curador"}` : "aberto";
  return `${conflict.itemId}: ${status} (${conflict.reason})`;
}

function schemaPatternConflictReviewResolutionSummary(resolution: SchemaPatternConflictReviewResolution): string {
  return `${resolution.itemId}: ${resolution.resolution ?? "sem decisão"} por ${resolution.resolvedBy || "curador"}`;
}

function stripSchemaPatternConflictReviewLocalFields(
  conflict: SchemaPatternLibraryConflict,
): SchemaPatternLibraryConflict {
  const { rawSchemaTextDiff: _rawSchemaTextDiff, ...sharedConflict } = conflict;
  return {
    ...sharedConflict,
    existingSnapshot: {
      ...sharedConflict.existingSnapshot,
      curationThread: sharedConflict.existingSnapshot.curationThread
        ? normalizeSchemaPatternCurationThread(sharedConflict.existingSnapshot.curationThread, sharedConflict.existingSnapshot.schemaHash, [])
        : undefined,
    },
    incomingSnapshot: {
      ...sharedConflict.incomingSnapshot,
      curationThread: sharedConflict.incomingSnapshot.curationThread
        ? normalizeSchemaPatternCurationThread(sharedConflict.incomingSnapshot.curationThread, sharedConflict.incomingSnapshot.schemaHash, [])
        : undefined,
    },
  };
}

function attachLocalRawSchemaTextDiffs(
  packageValue: SchemaReusablePatternLibraryPackage,
  existingItems: unknown[],
  incomingItems: unknown[],
): SchemaReusablePatternLibraryPackage {
  if (!packageValue.conflicts?.length) {
    return packageValue;
  }
  const existingById = new Map(syncSchemaPatternLibraryItems(existingItems).map((item) => [item.id, item]));
  const incomingById = new Map(syncSchemaPatternLibraryItems(incomingItems).map((item) => [item.id, item]));
  return {
    ...packageValue,
    conflicts: packageValue.conflicts.map((conflict) => {
      if (conflict.status !== "open" || !conflict.schemaMergePlan.schemaChanged) {
        return conflict;
      }
      const existingItem = existingById.get(conflict.itemId);
      const incomingItem = incomingById.get(conflict.itemId);
      if (!existingItem || !incomingItem) {
        return conflict;
      }
      const existingSchemaHash = shortHash(stableStringify(existingItem.schema));
      const incomingSchemaHash = shortHash(stableStringify(incomingItem.schema));
      if (
        existingSchemaHash !== conflict.existingSnapshot.schemaHash ||
        incomingSchemaHash !== conflict.incomingSnapshot.schemaHash
      ) {
        return conflict;
      }
      return {
        ...conflict,
        rawSchemaTextDiff: buildSchemaPatternRawTextDiff(existingItem.schema, incomingItem.schema),
      };
    }),
  };
}

function buildSchemaPatternRawTextDiff(
  existingSchema: Record<string, unknown>,
  incomingSchema: Record<string, unknown>,
): SchemaPatternRawSchemaTextDiff {
  const leftText = stableStringify(existingSchema);
  const rightText = stableStringify(incomingSchema);
  const rows = alignSchemaPatternRawTextDiffRows(leftText.split("\n"), rightText.split("\n"));
  return {
    format: "agent-flow-builder.schema-pattern-raw-text-diff.local.v1",
    generatedAt: new Date().toISOString(),
    existingSchemaHash: shortHash(leftText),
    incomingSchemaHash: shortHash(rightText),
    rowCount: rows.length,
    changedRowCount: rows.filter((row) => row.status !== "same").length,
    rows,
    governance: {
      localOnly: true,
      excludedFromSharedStorage: true,
      excludedFromExportsByDefault: true,
      containsRawSchemaContent: true,
      excludesSecretValues: false,
    },
  };
}

function alignSchemaPatternRawTextDiffRows(
  leftLines: string[],
  rightLines: string[],
): SchemaPatternRawSchemaTextDiffRow[] {
  const common = schemaPatternLineDiffCommonSubsequence(leftLines, rightLines);
  const rows: SchemaPatternRawSchemaTextDiffRow[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  for (const match of common) {
    appendSchemaPatternRawTextDiffChanges(rows, leftLines, rightLines, leftIndex, match.left, rightIndex, match.right);
    rows.push({
      leftLine: match.left + 1,
      rightLine: match.right + 1,
      leftText: leftLines[match.left],
      rightText: rightLines[match.right],
      status: "same",
    });
    leftIndex = match.left + 1;
    rightIndex = match.right + 1;
  }
  appendSchemaPatternRawTextDiffChanges(rows, leftLines, rightLines, leftIndex, leftLines.length, rightIndex, rightLines.length);
  return rows;
}

function appendSchemaPatternRawTextDiffChanges(
  rows: SchemaPatternRawSchemaTextDiffRow[],
  leftLines: string[],
  rightLines: string[],
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): void {
  const removed = leftLines.slice(leftStart, leftEnd);
  const added = rightLines.slice(rightStart, rightEnd);
  const pairedLength = Math.max(removed.length, added.length);
  for (let index = 0; index < pairedLength; index += 1) {
    const hasLeft = index < removed.length;
    const hasRight = index < added.length;
    rows.push({
      leftLine: hasLeft ? leftStart + index + 1 : null,
      rightLine: hasRight ? rightStart + index + 1 : null,
      leftText: hasLeft ? removed[index] : "",
      rightText: hasRight ? added[index] : "",
      status: hasLeft && hasRight ? "changed" : hasLeft ? "removed" : "added",
    });
  }
}

function schemaPatternLineDiffCommonSubsequence(
  leftLines: string[],
  rightLines: string[],
): Array<{ left: number; right: number }> {
  const width = rightLines.length + 1;
  const table = new Uint16Array((leftLines.length + 1) * width);
  for (let left = leftLines.length - 1; left >= 0; left -= 1) {
    for (let right = rightLines.length - 1; right >= 0; right -= 1) {
      table[left * width + right] = leftLines[left] === rightLines[right]
        ? table[(left + 1) * width + right + 1] + 1
        : Math.max(table[(left + 1) * width + right], table[left * width + right + 1]);
    }
  }
  const matches: Array<{ left: number; right: number }> = [];
  let left = 0;
  let right = 0;
  while (left < leftLines.length && right < rightLines.length) {
    if (leftLines[left] === rightLines[right]) {
      matches.push({ left, right });
      left += 1;
      right += 1;
    } else if (table[(left + 1) * width + right] >= table[left * width + right + 1]) {
      left += 1;
    } else {
      right += 1;
    }
  }
  return matches;
}

function mergeSchemaPatternLibraryItems(
  existingItems: unknown[],
  incomingItems: unknown[],
  existingConflicts: unknown[] = [],
  incomingConflicts: unknown[] = [],
): {
  items: SchemaReusablePatternLibraryItem[];
  conflicts: SchemaPatternLibraryConflict[];
  stats: SchemaPatternSharedSyncStats;
} {
  const existing = syncSchemaPatternLibraryItems(existingItems);
  const incoming = syncSchemaPatternLibraryItems(incomingItems);
  const byId = new Map(existing.map((item) => [item.id, item]));
  const conflicts: SchemaPatternLibraryConflict[] = [
    ...syncSchemaPatternLibraryConflicts(existingConflicts, existing),
    ...syncSchemaPatternLibraryConflicts(incomingConflicts, incoming),
  ];
  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  let conflictCount = 0;
  for (const incomingItem of incoming) {
    const existingItem = byId.get(incomingItem.id);
    if (!existingItem) {
      addedCount += 1;
      byId.set(incomingItem.id, incomingItem);
      continue;
    }
    if (shouldCreateSchemaPatternConflict(existingItem, incomingItem)) {
      const resolvedDecision = resolveSchemaPatternConflictFromHistory(conflicts, existingItem, incomingItem);
      if (resolvedDecision === "keep_existing") {
        unchangedCount += 1;
        continue;
      }
      const structurallyMergedItem = resolvedDecision === null
        ? mergeSchemaPatternItemsStructurally(existingItem, incomingItem)
        : null;
      if (structurallyMergedItem) {
        if (stableStringify(existingItem) === stableStringify(structurallyMergedItem)) {
          unchangedCount += 1;
        } else {
          updatedCount += 1;
        }
        byId.set(incomingItem.id, structurallyMergedItem);
        continue;
      }
      const conflict = buildSchemaPatternLibraryConflict(existingItem, incomingItem);
      const previousConflict = conflicts.find((entry) => entry.id === conflict.id);
      if (!previousConflict && resolvedDecision !== "allow_incoming") {
        conflicts.push(conflict);
        conflictCount += 1;
      }
    }
    if (comparableTimestamp(existingItem.updatedAt) <= comparableTimestamp(incomingItem.updatedAt)) {
      if (stableStringify(existingItem) === stableStringify(incomingItem)) {
        unchangedCount += 1;
      } else {
        updatedCount += 1;
      }
      byId.set(incomingItem.id, incomingItem);
    } else {
      unchangedCount += 1;
    }
  }
  const items = syncSchemaPatternLibraryItems(Array.from(byId.values()));
  return {
    items,
    conflicts: syncSchemaPatternLibraryConflicts(conflicts, items),
    stats: {
      incomingCount: incoming.length,
      existingCount: existing.length,
      addedCount,
      updatedCount,
      unchangedCount,
      conflictCount,
      finalCount: items.length,
    },
  };
}

function shouldCreateSchemaPatternConflict(
  existing: SchemaReusablePatternLibraryItem,
  incoming: SchemaReusablePatternLibraryItem,
): boolean {
  return stableStringify(schemaPatternConflictComparable(existing)) !== stableStringify(schemaPatternConflictComparable(incoming));
}

function mergeSchemaPatternItemsStructurally(
  existing: SchemaReusablePatternLibraryItem,
  incoming: SchemaReusablePatternLibraryItem,
): SchemaReusablePatternLibraryItem | null {
  if (
    stableStringify(schemaPatternConflictMetadataComparable(existing)) !==
    stableStringify(schemaPatternConflictMetadataComparable(incoming))
  ) {
    return null;
  }
  const existingSchemaHash = shortHash(stableStringify(existing.schema));
  const incomingSchemaHash = shortHash(stableStringify(incoming.schema));
  if (existingSchemaHash === incomingSchemaHash) {
    return null;
  }
  const mergedSchema = mergeSchemaPatternRawSchemas(existing.schema, incoming.schema);
  if (!mergedSchema) {
    return null;
  }
  const mergedSchemaHash = shortHash(stableStringify(mergedSchema));
  if (mergedSchemaHash === existingSchemaHash) {
    return null;
  }
  return {
    ...existing,
    schema: mergedSchema,
    schemaHash: mergedSchemaHash,
    summary: summarizeSchemaPatternRawSchema(mergedSchema),
    updatedAt: comparableTimestamp(existing.updatedAt) >= comparableTimestamp(incoming.updatedAt)
      ? existing.updatedAt
      : incoming.updatedAt,
  };
}

function mergeSchemaPatternRawSchemas(
  existingSchema: Record<string, unknown>,
  incomingSchema: Record<string, unknown>,
): Record<string, unknown> | null {
  const merged = cloneRecord(existingSchema);
  const existingType = typeof existingSchema.type === "string" ? existingSchema.type : "";
  const incomingType = typeof incomingSchema.type === "string" ? incomingSchema.type : "";
  if (existingType && incomingType && existingType !== incomingType) {
    return null;
  }
  if (!existingType && incomingType) {
    merged.type = incomingType;
  }
  if (typeof merged.title !== "string" && typeof incomingSchema.title === "string") {
    merged.title = incomingSchema.title;
  }
  if (typeof merged.description !== "string" && typeof incomingSchema.description === "string") {
    merged.description = incomingSchema.description;
  }

  const existingDefinitions = schemaPatternDefinitionMap(merged);
  for (const [name, definition] of schemaPatternDefinitionEntries(incomingSchema)) {
    const currentDefinition = existingDefinitions.get(name);
    if (currentDefinition && stableStringify(currentDefinition) !== stableStringify(definition)) {
      return null;
    }
    if (!currentDefinition) {
      const definitions = ensureSchemaPatternDefinitions(merged);
      definitions[name] = cloneRecord(definition);
      existingDefinitions.set(name, definition);
    }
  }

  const existingProperties = schemaPatternPropertyMap(merged);
  for (const [name, property] of schemaPatternPropertyEntries(incomingSchema)) {
    const currentProperty = existingProperties.get(name);
    if (currentProperty && stableStringify(currentProperty) !== stableStringify(property)) {
      return null;
    }
    if (!currentProperty) {
      const properties = ensureSchemaPatternProperties(merged);
      properties[name] = cloneRecord(property);
      existingProperties.set(name, property);
    }
  }

  const required = Array.from(new Set([...schemaPatternRequiredList(merged), ...schemaPatternRequiredList(incomingSchema)]));
  if (required.length) {
    merged.required = required;
  }

  for (const key of SCHEMA_PATTERN_COMPOSITION_KEYS) {
    const existingEntries = schemaPatternCompositionList(merged, key);
    const known = new Set(existingEntries.map((entry) => stableStringify(entry)));
    const nextEntries = [...existingEntries.map((entry) => cloneRecord(entry))];
    for (const entry of schemaPatternCompositionList(incomingSchema, key)) {
      const hash = stableStringify(entry);
      if (!known.has(hash)) {
        nextEntries.push(cloneRecord(entry));
        known.add(hash);
      }
    }
    if (nextEntries.length) {
      merged[key] = nextEntries;
    }
  }

  if (incomingSchema.additionalProperties !== undefined) {
    if (merged.additionalProperties === undefined) {
      merged.additionalProperties = cloneSchemaPatternJsonValue(incomingSchema.additionalProperties);
    } else if (stableStringify(merged.additionalProperties) !== stableStringify(incomingSchema.additionalProperties)) {
      return null;
    }
  }

  return merged;
}

function schemaPatternConflictMetadataComparable(item: SchemaReusablePatternLibraryItem): Record<string, unknown> {
  const comparable = schemaPatternConflictComparable(item);
  delete comparable.schemaHash;
  return comparable;
}

function resolveSchemaPatternConflictFromHistory(
  conflicts: SchemaPatternLibraryConflict[],
  existingItem: SchemaReusablePatternLibraryItem,
  incomingItem: SchemaReusablePatternLibraryItem,
): SchemaPatternResolvedConflictDecision | null {
  if (existingItem.id !== incomingItem.id) {
    return null;
  }
  const existingSnapshot = schemaPatternLibraryConflictSnapshot(existingItem);
  const incomingSnapshot = schemaPatternLibraryConflictSnapshot(incomingItem);
  for (const conflict of conflicts) {
    if (conflict.status !== "resolved" || conflict.itemId !== existingItem.id) {
      continue;
    }
    const selectedSnapshot = selectedResolvedSchemaPatternConflictSnapshot(conflict);
    const discardedSnapshot = discardedResolvedSchemaPatternConflictSnapshot(conflict, selectedSnapshot);
    if (!selectedSnapshot || !discardedSnapshot) {
      continue;
    }
    if (
      schemaPatternConflictSnapshotsMatch(existingSnapshot, selectedSnapshot) &&
      schemaPatternConflictSnapshotsMatch(incomingSnapshot, discardedSnapshot)
    ) {
      return "keep_existing";
    }
    if (
      schemaPatternConflictSnapshotsMatch(existingSnapshot, discardedSnapshot) &&
      schemaPatternConflictSnapshotsMatch(incomingSnapshot, selectedSnapshot)
    ) {
      return "allow_incoming";
    }
  }
  return null;
}

function selectedResolvedSchemaPatternConflictSnapshot(
  conflict: SchemaPatternLibraryConflict,
): SchemaPatternLibraryConflictSnapshot | null {
  const selectedSnapshot = conflict.resolutionPlan?.selectedSnapshot;
  if (selectedSnapshot === "incoming_snapshot") {
    return conflict.incomingSnapshot;
  }
  if (selectedSnapshot === "existing_snapshot") {
    return conflict.existingSnapshot;
  }
  if (conflict.resolution === "accept_incoming_snapshot") {
    return conflict.incomingSnapshot;
  }
  if (conflict.resolution === "accept_existing_snapshot") {
    return conflict.existingSnapshot;
  }
  return null;
}

function discardedResolvedSchemaPatternConflictSnapshot(
  conflict: SchemaPatternLibraryConflict,
  selectedSnapshot: SchemaPatternLibraryConflictSnapshot | null,
): SchemaPatternLibraryConflictSnapshot | null {
  if (!selectedSnapshot) {
    return null;
  }
  if (schemaPatternConflictSnapshotsMatch(selectedSnapshot, conflict.incomingSnapshot)) {
    return conflict.existingSnapshot;
  }
  if (schemaPatternConflictSnapshotsMatch(selectedSnapshot, conflict.existingSnapshot)) {
    return conflict.incomingSnapshot;
  }
  return null;
}

function schemaPatternConflictSnapshotsMatch(
  left: SchemaPatternLibraryConflictSnapshot,
  right: SchemaPatternLibraryConflictSnapshot,
): boolean {
  return stableStringify(schemaPatternConflictSnapshotComparable(left)) ===
    stableStringify(schemaPatternConflictSnapshotComparable(right));
}

function schemaPatternConflictSnapshotComparable(
  snapshot: SchemaPatternLibraryConflictSnapshot,
): Record<string, unknown> {
  return {
    id: snapshot.id,
    name: snapshot.name,
    tags: normalizeStringArray(snapshot.tags),
    curationStatus: normalizeSchemaPatternCurationStatus(snapshot.curationStatus),
    curationThread: snapshot.curationThread
      ? schemaPatternCurationThreadComparable(snapshot.curationThread)
      : null,
    schemaHash: snapshot.schemaHash,
    reviewedAt: snapshot.reviewedAt,
    reviewedBy: snapshot.reviewedBy,
    lastUsedAt: snapshot.lastUsedAt,
    usageCount: snapshot.usageCount,
    summary: snapshot.summary ? cloneRecord(snapshot.summary) : null,
  };
}

function schemaPatternConflictComparable(item: SchemaReusablePatternLibraryItem): Record<string, unknown> {
  const reviews = syncSchemaPatternCurationReviews(item.curationReviews ?? []);
  return {
    id: item.id,
    name: item.name,
    tags: normalizeStringArray(item.tags),
    curationStatus: item.curationStatus,
    schemaHash: item.schemaHash,
    reviewedBy: typeof item.reviewedBy === "string" ? item.reviewedBy : "",
    curationReviews: reviews.map((review) => ({
      id: review.id,
      reviewer: review.reviewer,
      role: review.role,
      decision: review.decision,
      createdAt: review.createdAt,
      schemaHash: review.schemaHash,
      assessmentStatus: review.assessmentStatus,
      assessmentScore: review.assessmentScore,
    })),
    curationThread: schemaPatternCurationThreadComparable(
      normalizeSchemaPatternCurationThread(item.curationThread, item.schemaHash, reviews),
    ),
    usageCount: typeof item.usageCount === "number" && Number.isFinite(item.usageCount) ? Math.max(0, Math.floor(item.usageCount)) : 0,
    summary: isRecord(item.summary) ? item.summary : null,
  };
}

function schemaPatternCurationThreadComparable(thread: SchemaPatternCurationThread): Record<string, unknown> {
  return {
    status: normalizeSchemaPatternCurationThreadStatus(thread.status) ?? "unassigned",
    assignee: normalizeOptionalText(thread.assignee, 80),
    updatedAt: normalizeNullableText(thread.updatedAt),
    lastReviewer: normalizeOptionalText(thread.lastReviewer, 80),
    lastDecision: normalizeSchemaPatternCurationReviewDecision(thread.lastDecision),
    reviewCount: normalizeNonNegativeInteger(thread.reviewCount) ?? 0,
    requestChangesCount: normalizeNonNegativeInteger(thread.requestChangesCount) ?? 0,
  };
}

function buildSchemaPatternLibraryConflict(
  existing: SchemaReusablePatternLibraryItem,
  incoming: SchemaReusablePatternLibraryItem,
): SchemaPatternLibraryConflict {
  const existingSnapshot = schemaPatternLibraryConflictSnapshot(existing);
  const incomingSnapshot = schemaPatternLibraryConflictSnapshot(incoming);
  const createdAt = new Date().toISOString();
  return {
    id: `schema-pattern-conflict-${shortHash(stableStringify({ existingSnapshot, incomingSnapshot }))}`,
    itemId: incoming.id,
    status: "open",
    reason: schemaPatternConflictReason(existingSnapshot, incomingSnapshot),
    existingSnapshot,
    incomingSnapshot,
    schemaMergePlan: schemaPatternConflictMergePlan(existing.schema, incoming.schema),
    existingUpdatedAt: existingSnapshot.updatedAt,
    incomingUpdatedAt: incomingSnapshot.updatedAt,
    createdAt,
    resolvedAt: null,
    resolvedBy: "",
    resolution: null,
    resolutionNote: "",
    resolutionPlan: null,
  };
}

function schemaPatternConflictReason(
  existing: SchemaPatternLibraryConflictSnapshot,
  incoming: SchemaPatternLibraryConflictSnapshot,
): string {
  const reasons: string[] = [];
  if (existing.schemaHash !== incoming.schemaHash) {
    reasons.push("schema");
  }
  if (existing.curationStatus !== incoming.curationStatus) {
    reasons.push("status");
  }
  if (
    stableStringify(existing.curationThread ? schemaPatternCurationThreadComparable(existing.curationThread) : null) !==
    stableStringify(incoming.curationThread ? schemaPatternCurationThreadComparable(incoming.curationThread) : null)
  ) {
    reasons.push("curadoria");
  }
  if (stableStringify(existing.tags) !== stableStringify(incoming.tags)) {
    reasons.push("tags");
  }
  if (existing.reviewedBy !== incoming.reviewedBy) {
    reasons.push("revisor");
  }
  if (existing.usageCount !== incoming.usageCount) {
    reasons.push("uso");
  }
  return reasons.length ? reasons.join(", ") : "metadados";
}

function schemaPatternConflictMergePlan(
  existingSchema: Record<string, unknown>,
  incomingSchema: Record<string, unknown>,
): SchemaPatternLibraryConflictMergePlan {
  const existingProperties = schemaPatternPropertyMap(existingSchema);
  const incomingProperties = schemaPatternPropertyMap(incomingSchema);
  const propertyAdditions: string[] = [];
  const propertyExistingOnly: string[] = [];
  const propertyConflicts: string[] = [];
  for (const [name, property] of schemaPatternPropertyEntries(incomingSchema)) {
    const current = existingProperties.get(name);
    if (!current) {
      propertyAdditions.push(name);
    } else if (stableStringify(current) !== stableStringify(property)) {
      propertyConflicts.push(name);
    }
  }
  for (const [name] of schemaPatternPropertyEntries(existingSchema)) {
    if (!incomingProperties.has(name)) {
      propertyExistingOnly.push(name);
    }
  }

  const existingDefinitions = schemaPatternDefinitionMap(existingSchema);
  const incomingDefinitions = schemaPatternDefinitionMap(incomingSchema);
  const definitionAdditions: string[] = [];
  const definitionExistingOnly: string[] = [];
  const definitionConflicts: string[] = [];
  for (const [name, definition] of schemaPatternDefinitionEntries(incomingSchema)) {
    const current = existingDefinitions.get(name);
    if (!current) {
      definitionAdditions.push(name);
    } else if (stableStringify(current) !== stableStringify(definition)) {
      definitionConflicts.push(name);
    }
  }
  for (const [name] of schemaPatternDefinitionEntries(existingSchema)) {
    if (!incomingDefinitions.has(name)) {
      definitionExistingOnly.push(name);
    }
  }

  const existingRequired = new Set(schemaPatternRequiredList(existingSchema));
  const incomingRequired = new Set(schemaPatternRequiredList(incomingSchema));
  const requiredAdditions = schemaPatternRequiredList(incomingSchema).filter((name) => !existingRequired.has(name));
  const requiredExistingOnly = schemaPatternRequiredList(existingSchema).filter((name) => !incomingRequired.has(name));
  let compositionAdditions = 0;
  let compositionExistingOnly = 0;
  for (const key of SCHEMA_PATTERN_COMPOSITION_KEYS) {
    const current = new Set(schemaPatternCompositionList(existingSchema, key).map((entry) => stableStringify(entry)));
    const incoming = new Set(schemaPatternCompositionList(incomingSchema, key).map((entry) => stableStringify(entry)));
    compositionAdditions += schemaPatternCompositionList(incomingSchema, key)
      .filter((entry) => !current.has(stableStringify(entry))).length;
    compositionExistingOnly += schemaPatternCompositionList(existingSchema, key)
      .filter((entry) => !incoming.has(stableStringify(entry))).length;
  }
  const additionalPropertiesChange =
    existingSchema.additionalProperties === undefined && incomingSchema.additionalProperties !== undefined;
  const additionalPropertiesExistingOnly =
    existingSchema.additionalProperties !== undefined && incomingSchema.additionalProperties === undefined;
  const additionalPropertiesConflict =
    existingSchema.additionalProperties !== undefined &&
    incomingSchema.additionalProperties !== undefined &&
    stableStringify(existingSchema.additionalProperties) !== stableStringify(incomingSchema.additionalProperties);
  return {
    canAutoMerge: mergeSchemaPatternRawSchemas(existingSchema, incomingSchema) !== null,
    schemaChanged: stableStringify(existingSchema) !== stableStringify(incomingSchema),
    propertyAdditions: normalizeStringArray(propertyAdditions),
    propertyExistingOnly: normalizeStringArray(propertyExistingOnly),
    propertyConflicts: normalizeStringArray(propertyConflicts),
    definitionAdditions: normalizeStringArray(definitionAdditions),
    definitionExistingOnly: normalizeStringArray(definitionExistingOnly),
    definitionConflicts: normalizeStringArray(definitionConflicts),
    requiredAdditions: normalizeStringArray(requiredAdditions),
    requiredExistingOnly: normalizeStringArray(requiredExistingOnly),
    compositionAdditions,
    compositionExistingOnly,
    additionalPropertiesChange,
    additionalPropertiesExistingOnly,
    additionalPropertiesConflict,
    governance: {
      excludesRawSchemaContent: true,
      excludesSecretValues: true,
    },
  };
}

function schemaPatternLibraryConflictSnapshot(
  item: SchemaReusablePatternLibraryItem,
): SchemaPatternLibraryConflictSnapshot {
  const reviews = syncSchemaPatternCurationReviews(item.curationReviews ?? []);
  return {
    id: item.id,
    name: item.name,
    tags: normalizeStringArray(item.tags),
    curationStatus: normalizeSchemaPatternCurationStatus(item.curationStatus),
    curationThread: normalizeSchemaPatternCurationThread(item.curationThread, item.schemaHash, reviews),
    schemaHash: typeof item.schemaHash === "string" ? item.schemaHash : "",
    updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
    reviewedAt: typeof item.reviewedAt === "string" && item.reviewedAt.trim() ? item.reviewedAt.trim() : null,
    reviewedBy: typeof item.reviewedBy === "string" && item.reviewedBy.trim() ? item.reviewedBy.trim() : null,
    lastUsedAt: typeof item.lastUsedAt === "string" && item.lastUsedAt.trim() ? item.lastUsedAt.trim() : null,
    usageCount: typeof item.usageCount === "number" && Number.isFinite(item.usageCount) ? Math.max(0, Math.floor(item.usageCount)) : 0,
    summary: isRecord(item.summary) ? cloneRecord(item.summary) : null,
  };
}

function resolveSchemaPatternConflictActor(payload: unknown): string {
  if (!isRecord(payload)) {
    return "local-studio";
  }
  const resolvedBy = normalizeOptionalText(payload.resolvedBy, 120);
  return resolvedBy || "local-studio";
}

function normalizeSchemaPatternConflictResolution(value: unknown): SchemaPatternLibraryConflictResolution {
  if (
    value === "accept_existing_snapshot" ||
    value === "accept_incoming_snapshot" ||
    value === "accept_current_library" ||
    value === "apply_manual_schema_merge"
  ) {
    return value;
  }
  return "accept_current_library";
}

function resolveSchemaPatternConflictItem(
  currentItem: SchemaReusablePatternLibraryItem | null,
  conflict: SchemaPatternLibraryConflict,
  resolution: SchemaPatternLibraryConflictResolution,
  resolvedAt: string,
  payload: unknown,
): { item: SchemaReusablePatternLibraryItem | null; plan: SchemaPatternLibraryConflictResolutionPlan } {
  if (resolution === "apply_manual_schema_merge") {
    if (!currentItem) {
      throw new WorkspaceError("Conflito de schema não possui item atual para aplicar merge manual.", 409);
    }
    const mergedSchema = isRecord(payload) && isRecord(payload.mergedSchema) ? cloneRecord(payload.mergedSchema) : null;
    if (!mergedSchema) {
      throw new WorkspaceError("Resolução manual de schema exige mergedSchema JSON.", 400);
    }
    const mergedSchemaHash = shortHash(stableStringify(mergedSchema));
    const item: SchemaReusablePatternLibraryItem = {
      ...currentItem,
      schema: mergedSchema,
      schemaHash: mergedSchemaHash,
      summary: summarizeSchemaPatternRawSchema(mergedSchema),
      updatedAt: resolvedAt,
    };
    return {
      item,
      plan: {
        selectedSnapshot: "current_library",
        requestedResolution: resolution,
        currentSchemaHash: currentItem.schemaHash,
        selectedSchemaHash: mergedSchemaHash,
        schemaContentAction: "manual_schema_merge_applied",
        metadataAction: "current_metadata_retained",
        metadataFieldsChanged: [],
        requiresManualSchemaReview: false,
        governance: {
          excludesRawSchemaContent: true,
          excludesSecretValues: true,
        },
      },
    };
  }
  const selectedSnapshot = schemaPatternConflictSelectedSnapshot(conflict, resolution);
  const currentSchemaHash = currentItem?.schemaHash ?? "";
  const selectedSchemaHash = selectedSnapshot?.snapshot.schemaHash ?? currentSchemaHash;
  const metadataFieldsChanged = currentItem && selectedSnapshot
    ? schemaPatternConflictMetadataFieldsChanged(currentItem, selectedSnapshot.snapshot)
    : [];
  const selectedSchemaMatchesCurrent = selectedSnapshot ? selectedSchemaHash === currentSchemaHash : true;
  const requiresManualSchemaReview = Boolean(selectedSnapshot && !selectedSchemaMatchesCurrent);
  const schemaContentAction: SchemaPatternLibraryConflictSchemaAction = !selectedSnapshot
    ? "current_schema_retained"
    : selectedSchemaMatchesCurrent
      ? "selected_schema_already_current"
      : "manual_schema_reapply_required";
  const metadataAction: SchemaPatternLibraryConflictMetadataAction = !selectedSnapshot
    ? "current_metadata_retained"
    : requiresManualSchemaReview
      ? "manual_schema_review_first"
      : metadataFieldsChanged.length
        ? "selected_metadata_applied"
        : "selected_metadata_already_current";
  const item = currentItem && selectedSnapshot && selectedSchemaMatchesCurrent && metadataFieldsChanged.length
    ? applySchemaPatternConflictSnapshotMetadata(currentItem, selectedSnapshot.snapshot, resolvedAt)
    : currentItem;
  return {
    item,
    plan: {
      selectedSnapshot: selectedSnapshot?.selectedSnapshot ?? "current_library",
      requestedResolution: resolution,
      currentSchemaHash,
      selectedSchemaHash,
      schemaContentAction,
      metadataAction,
      metadataFieldsChanged,
      requiresManualSchemaReview,
      governance: {
        excludesRawSchemaContent: true,
        excludesSecretValues: true,
      },
    },
  };
}

function schemaPatternConflictSelectedSnapshot(
  conflict: SchemaPatternLibraryConflict,
  resolution: SchemaPatternLibraryConflictResolution,
): { selectedSnapshot: SchemaPatternLibraryConflictSelectedSnapshot; snapshot: SchemaPatternLibraryConflictSnapshot } | null {
  if (resolution === "accept_existing_snapshot") {
    return { selectedSnapshot: "existing_snapshot", snapshot: conflict.existingSnapshot };
  }
  if (resolution === "accept_incoming_snapshot") {
    return { selectedSnapshot: "incoming_snapshot", snapshot: conflict.incomingSnapshot };
  }
  return null;
}

function schemaPatternConflictMetadataFieldsChanged(
  item: SchemaReusablePatternLibraryItem,
  snapshot: SchemaPatternLibraryConflictSnapshot,
): string[] {
  const checks: Array<[string, unknown, unknown]> = [
    ["name", item.name, snapshot.name],
    ["tags", normalizeStringArray(item.tags), snapshot.tags],
    ["curationStatus", normalizeSchemaPatternCurationStatus(item.curationStatus), snapshot.curationStatus],
    [
      "curationThread",
      schemaPatternCurationThreadComparable(normalizeSchemaPatternCurationThread(item.curationThread, item.schemaHash, item.curationReviews ?? [])),
      schemaPatternCurationThreadComparable(snapshot.curationThread ?? defaultSchemaPatternCurationThread(snapshot.schemaHash)),
    ],
    ["reviewedAt", normalizeNullableText(item.reviewedAt), snapshot.reviewedAt],
    ["reviewedBy", normalizeNullableText(item.reviewedBy), snapshot.reviewedBy],
    ["lastUsedAt", normalizeNullableText(item.lastUsedAt), snapshot.lastUsedAt],
    ["usageCount", normalizeNonNegativeInteger(item.usageCount) ?? 0, snapshot.usageCount],
    ["summary", isRecord(item.summary) ? cloneRecord(item.summary) : null, snapshot.summary],
  ];
  return checks
    .filter(([, currentValue, snapshotValue]) => stableStringify(currentValue) !== stableStringify(snapshotValue))
    .map(([field]) => field);
}

function applySchemaPatternConflictSnapshotMetadata(
  item: SchemaReusablePatternLibraryItem,
  snapshot: SchemaPatternLibraryConflictSnapshot,
  resolvedAt: string,
): SchemaReusablePatternLibraryItem {
  return {
    ...item,
    name: snapshot.name,
    tags: [...snapshot.tags],
    curationStatus: snapshot.curationStatus,
    curationThread: normalizeSchemaPatternCurationThread(snapshot.curationThread, snapshot.schemaHash, item.curationReviews ?? []),
    reviewedAt: snapshot.reviewedAt,
    reviewedBy: snapshot.reviewedBy,
    lastUsedAt: snapshot.lastUsedAt,
    usageCount: snapshot.usageCount,
    summary: snapshot.summary ? cloneRecord(snapshot.summary) : null,
    updatedAt: resolvedAt,
  };
}

function syncSchemaPatternLibraryConflicts(
  conflicts: unknown[],
  items: SchemaReusablePatternLibraryItem[],
): SchemaPatternLibraryConflict[] {
  const itemIds = new Set(items.map((item) => item.id));
  const byId = new Map<string, SchemaPatternLibraryConflict>();
  for (const conflict of conflicts
    .map(normalizeSchemaPatternLibraryConflict)
    .filter((entry): entry is SchemaPatternLibraryConflict => entry !== null)) {
    if (!itemIds.has(conflict.itemId)) {
      continue;
    }
    const existing = byId.get(conflict.id);
    if (!existing || comparableTimestamp(existing.createdAt) <= comparableTimestamp(conflict.createdAt)) {
      byId.set(conflict.id, conflict);
    }
  }
  return Array.from(byId.values()).sort((left, right) => comparableTimestamp(right.createdAt) - comparableTimestamp(left.createdAt));
}

function normalizeSchemaPatternLibraryConflict(value: unknown): SchemaPatternLibraryConflict | null {
  if (!isRecord(value)) {
    return null;
  }
  const itemId = typeof value.itemId === "string" && value.itemId.trim() ? value.itemId.trim() : "";
  const existingSnapshot = normalizeSchemaPatternLibraryConflictSnapshot(value.existingSnapshot);
  const incomingSnapshot = normalizeSchemaPatternLibraryConflictSnapshot(value.incomingSnapshot);
  if (!itemId || !existingSnapshot || !incomingSnapshot) {
    return null;
  }
  const id = typeof value.id === "string" && value.id.trim()
    ? value.id.trim()
    : `schema-pattern-conflict-${shortHash(stableStringify({ existingSnapshot, incomingSnapshot }))}`;
  return {
    id,
    itemId,
    status: value.status === "resolved" ? "resolved" : "open",
    reason: typeof value.reason === "string" && value.reason.trim() ? value.reason.trim() : schemaPatternConflictReason(existingSnapshot, incomingSnapshot),
    existingSnapshot,
    incomingSnapshot,
    schemaMergePlan: normalizeSchemaPatternLibraryConflictMergePlan(value.schemaMergePlan, existingSnapshot, incomingSnapshot),
    existingUpdatedAt: typeof value.existingUpdatedAt === "string" && value.existingUpdatedAt.trim() ? value.existingUpdatedAt.trim() : existingSnapshot.updatedAt,
    incomingUpdatedAt: typeof value.incomingUpdatedAt === "string" && value.incomingUpdatedAt.trim() ? value.incomingUpdatedAt.trim() : incomingSnapshot.updatedAt,
    createdAt: typeof value.createdAt === "string" && value.createdAt.trim() ? value.createdAt.trim() : new Date().toISOString(),
    resolvedAt: typeof value.resolvedAt === "string" && value.resolvedAt.trim() ? value.resolvedAt.trim() : null,
    resolvedBy: typeof value.resolvedBy === "string" && value.resolvedBy.trim() ? value.resolvedBy.trim() : "",
    resolution: normalizeNullableSchemaPatternConflictResolution(value.resolution),
    resolutionNote: normalizeOptionalText(value.resolutionNote, 240),
    resolutionPlan: normalizeSchemaPatternConflictResolutionPlan(value.resolutionPlan),
  };
}

function normalizeSchemaPatternLibraryConflictMergePlan(
  value: unknown,
  existingSnapshot: SchemaPatternLibraryConflictSnapshot,
  incomingSnapshot: SchemaPatternLibraryConflictSnapshot,
): SchemaPatternLibraryConflictMergePlan {
  if (!isRecord(value)) {
    return {
      canAutoMerge: false,
      schemaChanged: existingSnapshot.schemaHash !== incomingSnapshot.schemaHash,
      propertyAdditions: [],
      propertyExistingOnly: [],
      propertyConflicts: [],
      definitionAdditions: [],
      definitionExistingOnly: [],
      definitionConflicts: [],
      requiredAdditions: [],
      requiredExistingOnly: [],
      compositionAdditions: 0,
      compositionExistingOnly: 0,
      additionalPropertiesChange: false,
      additionalPropertiesExistingOnly: false,
      additionalPropertiesConflict: existingSnapshot.schemaHash !== incomingSnapshot.schemaHash,
      governance: {
        excludesRawSchemaContent: true,
        excludesSecretValues: true,
      },
    };
  }
  return {
    canAutoMerge: value.canAutoMerge === true,
    schemaChanged: value.schemaChanged === true || existingSnapshot.schemaHash !== incomingSnapshot.schemaHash,
    propertyAdditions: normalizeStringArray(value.propertyAdditions),
    propertyExistingOnly: normalizeStringArray(value.propertyExistingOnly),
    propertyConflicts: normalizeStringArray(value.propertyConflicts),
    definitionAdditions: normalizeStringArray(value.definitionAdditions),
    definitionExistingOnly: normalizeStringArray(value.definitionExistingOnly),
    definitionConflicts: normalizeStringArray(value.definitionConflicts),
    requiredAdditions: normalizeStringArray(value.requiredAdditions),
    requiredExistingOnly: normalizeStringArray(value.requiredExistingOnly),
    compositionAdditions: normalizeNonNegativeInteger(value.compositionAdditions) ?? 0,
    compositionExistingOnly: normalizeNonNegativeInteger(value.compositionExistingOnly) ?? 0,
    additionalPropertiesChange: value.additionalPropertiesChange === true,
    additionalPropertiesExistingOnly: value.additionalPropertiesExistingOnly === true,
    additionalPropertiesConflict: value.additionalPropertiesConflict === true,
    governance: {
      excludesRawSchemaContent: true,
      excludesSecretValues: true,
    },
  };
}

function normalizeNullableSchemaPatternConflictResolution(value: unknown): SchemaPatternLibraryConflictResolution | null {
  if (
    value === "accept_existing_snapshot" ||
    value === "accept_incoming_snapshot" ||
    value === "accept_current_library" ||
    value === "apply_manual_schema_merge"
  ) {
    return value;
  }
  return null;
}

function normalizeSchemaPatternConflictResolutionPlan(
  value: unknown,
): SchemaPatternLibraryConflictResolutionPlan | null {
  if (!isRecord(value)) {
    return null;
  }
  const selectedSnapshot = normalizeSchemaPatternConflictSelectedSnapshot(value.selectedSnapshot);
  const requestedResolution = normalizeNullableSchemaPatternConflictResolution(value.requestedResolution);
  const schemaContentAction = normalizeSchemaPatternConflictSchemaAction(value.schemaContentAction);
  const metadataAction = normalizeSchemaPatternConflictMetadataAction(value.metadataAction);
  if (!selectedSnapshot || !requestedResolution || !schemaContentAction || !metadataAction) {
    return null;
  }
  return {
    selectedSnapshot,
    requestedResolution,
    currentSchemaHash: normalizeOptionalText(value.currentSchemaHash, 120),
    selectedSchemaHash: normalizeOptionalText(value.selectedSchemaHash, 120),
    schemaContentAction,
    metadataAction,
    metadataFieldsChanged: normalizeStringArray(value.metadataFieldsChanged),
    requiresManualSchemaReview: value.requiresManualSchemaReview === true,
    governance: {
      excludesRawSchemaContent: true,
      excludesSecretValues: true,
    },
  };
}

function normalizeSchemaPatternConflictSelectedSnapshot(
  value: unknown,
): SchemaPatternLibraryConflictSelectedSnapshot | null {
  return value === "current_library" || value === "existing_snapshot" || value === "incoming_snapshot" ? value : null;
}

function normalizeSchemaPatternConflictSchemaAction(value: unknown): SchemaPatternLibraryConflictSchemaAction | null {
  return value === "current_schema_retained" ||
      value === "selected_schema_already_current" ||
      value === "manual_schema_reapply_required" ||
      value === "manual_schema_merge_applied"
    ? value
    : null;
}

function normalizeSchemaPatternConflictMetadataAction(value: unknown): SchemaPatternLibraryConflictMetadataAction | null {
  return value === "current_metadata_retained" ||
      value === "selected_metadata_already_current" ||
      value === "selected_metadata_applied" ||
      value === "manual_schema_review_first"
    ? value
    : null;
}

function normalizeSchemaPatternLibraryConflictSnapshot(value: unknown): SchemaPatternLibraryConflictSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : "";
  const name = typeof value.name === "string" && value.name.trim() ? value.name.trim() : "";
  if (!id || !name) {
    return null;
  }
  const schemaHash = typeof value.schemaHash === "string" && value.schemaHash.trim() ? value.schemaHash.trim() : "";
  return {
    id,
    name,
    tags: normalizeStringArray(value.tags),
    curationStatus: normalizeSchemaPatternCurationStatus(value.curationStatus),
    curationThread: normalizeSchemaPatternCurationThread(value.curationThread, schemaHash, []),
    schemaHash,
    updatedAt: typeof value.updatedAt === "string" && value.updatedAt.trim() ? value.updatedAt.trim() : "",
    reviewedAt: typeof value.reviewedAt === "string" && value.reviewedAt.trim() ? value.reviewedAt.trim() : null,
    reviewedBy: typeof value.reviewedBy === "string" && value.reviewedBy.trim() ? value.reviewedBy.trim() : null,
    lastUsedAt: typeof value.lastUsedAt === "string" && value.lastUsedAt.trim() ? value.lastUsedAt.trim() : null,
    usageCount: normalizeNonNegativeInteger(value.usageCount) ?? 0,
    summary: isRecord(value.summary) ? cloneRecord(value.summary) : null,
  };
}

function schemaPatternDefinitionEntries(schema: Record<string, unknown>): Array<[string, Record<string, unknown>]> {
  const definitions = isRecord(schema.$defs) ? schema.$defs : {};
  return Object.entries(definitions).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]));
}

function schemaPatternDefinitionMap(schema: Record<string, unknown>): Map<string, Record<string, unknown>> {
  return new Map(schemaPatternDefinitionEntries(schema));
}

function ensureSchemaPatternDefinitions(schema: Record<string, unknown>): Record<string, Record<string, unknown>> {
  if (!isRecord(schema.$defs)) {
    schema.$defs = {};
  }
  return schema.$defs as Record<string, Record<string, unknown>>;
}

function schemaPatternPropertyEntries(schema: Record<string, unknown>): Array<[string, Record<string, unknown>]> {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  return Object.entries(properties).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]));
}

function schemaPatternPropertyMap(schema: Record<string, unknown>): Map<string, Record<string, unknown>> {
  return new Map(schemaPatternPropertyEntries(schema));
}

function ensureSchemaPatternProperties(schema: Record<string, unknown>): Record<string, Record<string, unknown>> {
  if (!isRecord(schema.properties)) {
    schema.properties = {};
  }
  return schema.properties as Record<string, Record<string, unknown>>;
}

function schemaPatternRequiredList(schema: Record<string, unknown>): string[] {
  return Array.isArray(schema.required)
    ? Array.from(new Set(schema.required.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())))
    : [];
}

function schemaPatternCompositionList(
  schema: Record<string, unknown>,
  key: typeof SCHEMA_PATTERN_COMPOSITION_KEYS[number],
): Record<string, unknown>[] {
  return Array.isArray(schema[key]) ? schema[key].filter(isRecord).map(cloneRecord) : [];
}

function summarizeSchemaPatternRawSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const summary = {
    propertyCount: 0,
    requiredCount: 0,
    definitionCount: 0,
    refCount: 0,
    enumCount: 0,
    enumValueCount: 0,
    objectCount: 0,
    arrayCount: 0,
    compositionCount: 0,
    openAdditionalPropertiesCount: 0,
    lockedAdditionalPropertiesCount: 0,
    schemaAdditionalPropertiesCount: 0,
    maxDepth: 0,
  };
  visitSchemaPatternRawSchema(schema, summary, 1);
  return summary;
}

function visitSchemaPatternRawSchema(
  schema: Record<string, unknown>,
  summary: {
    propertyCount: number;
    requiredCount: number;
    definitionCount: number;
    refCount: number;
    enumCount: number;
    enumValueCount: number;
    objectCount: number;
    arrayCount: number;
    compositionCount: number;
    openAdditionalPropertiesCount: number;
    lockedAdditionalPropertiesCount: number;
    schemaAdditionalPropertiesCount: number;
    maxDepth: number;
  },
  depth: number,
): void {
  summary.maxDepth = Math.max(summary.maxDepth, depth);
  const properties = schemaPatternPropertyEntries(schema);
  const definitions = schemaPatternDefinitionEntries(schema);
  const type = typeof schema.type === "string" ? schema.type : "";
  if (type === "object" || properties.length || definitions.length) {
    summary.objectCount += 1;
  }
  if (type === "array" || schema.items !== undefined) {
    summary.arrayCount += 1;
  }
  if (typeof schema.$ref === "string" && schema.$ref.trim()) {
    summary.refCount += 1;
  }
  if (Array.isArray(schema.enum)) {
    summary.enumCount += 1;
    summary.enumValueCount += schema.enum.length;
  }
  if (schema.additionalProperties === true) {
    summary.openAdditionalPropertiesCount += 1;
  } else if (schema.additionalProperties === false) {
    summary.lockedAdditionalPropertiesCount += 1;
  } else if (isRecord(schema.additionalProperties)) {
    summary.schemaAdditionalPropertiesCount += 1;
    visitSchemaPatternRawSchema(schema.additionalProperties, summary, depth + 1);
  }
  summary.propertyCount += properties.length;
  summary.definitionCount += definitions.length;
  summary.requiredCount += schemaPatternRequiredList(schema).length;
  for (const [, property] of properties) {
    visitSchemaPatternRawSchema(property, summary, depth + 1);
  }
  for (const [, definition] of definitions) {
    visitSchemaPatternRawSchema(definition, summary, depth + 1);
  }
  if (isRecord(schema.items)) {
    visitSchemaPatternRawSchema(schema.items, summary, depth + 1);
  } else if (Array.isArray(schema.items)) {
    for (const item of schema.items.filter(isRecord)) {
      visitSchemaPatternRawSchema(item, summary, depth + 1);
    }
  }
  for (const key of SCHEMA_PATTERN_COMPOSITION_KEYS) {
    const entries = schemaPatternCompositionList(schema, key);
    summary.compositionCount += entries.length;
    for (const entry of entries) {
      visitSchemaPatternRawSchema(entry, summary, depth + 1);
    }
  }
}

function syncSchemaPatternLibraryItems(items: unknown[]): SchemaReusablePatternLibraryItem[] {
  const byId = new Map<string, SchemaReusablePatternLibraryItem>();
  for (const item of items.map(normalizeSchemaPatternLibraryItem).filter((entry): entry is SchemaReusablePatternLibraryItem => entry !== null)) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      continue;
    }
    const winner = comparableTimestamp(existing.updatedAt) <= comparableTimestamp(item.updatedAt) ? item : existing;
    byId.set(item.id, {
      ...winner,
      curationReviews: syncSchemaPatternCurationReviews([
        ...(existing.curationReviews ?? []),
        ...(item.curationReviews ?? []),
      ]),
      curationThread: mergeSchemaPatternCurationThreads(
        existing.curationThread,
        item.curationThread,
        syncSchemaPatternCurationReviews([...(existing.curationReviews ?? []), ...(item.curationReviews ?? [])]),
        winner.schemaHash,
      ),
    });
  }
  return Array.from(byId.values()).sort((left, right) => {
    const timeDelta = comparableTimestamp(right.updatedAt) - comparableTimestamp(left.updatedAt);
    return timeDelta === 0 ? left.name.localeCompare(right.name) : timeDelta;
  });
}

function syncSchemaPatternCurationReviews(value: unknown): SchemaPatternCurationReview[] {
  const reviews = Array.isArray(value)
    ? value.map(normalizeSchemaPatternCurationReview).filter((entry): entry is SchemaPatternCurationReview => entry !== null)
    : [];
  const byId = new Map<string, SchemaPatternCurationReview>();
  for (const review of reviews) {
    byId.set(review.id, review);
  }
  return Array.from(byId.values())
    .sort((left, right) => comparableTimestamp(right.createdAt) - comparableTimestamp(left.createdAt) || left.id.localeCompare(right.id))
    .slice(0, 24);
}

function normalizeSchemaPatternCurationReview(value: unknown): SchemaPatternCurationReview | null {
  if (!isRecord(value)) {
    return null;
  }
  const decision = normalizeSchemaPatternCurationReviewDecision(value.decision);
  const id = normalizeOptionalText(value.id, 160);
  const schemaHash = normalizeOptionalText(value.schemaHash, 120);
  if (!decision || !schemaHash) {
    return null;
  }
  const createdAt = normalizeOptionalText(value.createdAt, 80) || new Date().toISOString();
  return {
    id: id || `schema-pattern-review-${shortHash(`${schemaHash}|${decision}|${createdAt}`)}`,
    reviewer: normalizeOptionalText(value.reviewer, 80) || "local-curator",
    role: normalizeOptionalText(value.role, 40) || "reviewer",
    decision,
    note: normalizeOptionalText(value.note, 220),
    createdAt,
    schemaHash,
    assessmentStatus: normalizeOptionalText(value.assessmentStatus, 40) || "review",
    assessmentScore: normalizeNonNegativeInteger(value.assessmentScore) ?? 0,
    governance: {
      excludesRawSchemaContent: true,
      excludesSecretValues: true,
    },
  };
}

function normalizeSchemaPatternCurationReviewDecision(value: unknown): string | null {
  return value === "approve" || value === "request_changes" || value === "deprecate" || value === "comment"
    ? value
    : null;
}

function defaultSchemaPatternCurationThread(schemaHash: string): SchemaPatternCurationThread {
  return {
    status: "unassigned",
    assignee: "",
    openedAt: null,
    updatedAt: null,
    schemaHash,
    lastReviewer: "",
    lastDecision: null,
    leaseExpiresAt: null,
    leaseDurationHours: null,
    leaseExpired: false,
    reviewCount: 0,
    requestChangesCount: 0,
    events: [],
    governance: {
      excludesRawSchemaContent: true,
      excludesSecretValues: true,
      autoReleasesExpiredAssignments: true,
      configuredLeaseHoursEnv: SCHEMA_PATTERN_CURATION_LEASE_HOURS_ENV,
    },
  };
}

function normalizeSchemaPatternCurationThread(
  value: unknown,
  schemaHash: string,
  reviews: SchemaPatternCurationReview[],
): SchemaPatternCurationThread {
  const source = isRecord(value) ? value : {};
  const latestReview = reviews[0] ?? null;
  const explicitStatus = normalizeSchemaPatternCurationThreadStatus(source.status);
  const assignee = normalizeOptionalText(source.assignee, 80);
  const normalizedEvents = Array.isArray(source.events)
    ? source.events
        .map(normalizeSchemaPatternCurationEvent)
        .filter((event): event is SchemaPatternCurationEvent => event !== null)
    : [];
  const reviewCount = reviews.length || normalizeNonNegativeInteger(source.reviewCount) || 0;
  const requestChangesCount = reviews.length
    ? reviews.filter((review) => review.decision === "request_changes").length
    : normalizeNonNegativeInteger(source.requestChangesCount) || 0;
  const updatedAt = normalizeSchemaPatternDateString(source.updatedAt) ?? latestReview?.createdAt ?? null;
  const status = explicitStatus ??
    (latestReview?.decision === "approve" || latestReview?.decision === "deprecate"
      ? "resolved"
      : latestReview?.decision === "request_changes"
        ? "blocked"
        : assignee
          ? "assigned"
          : "unassigned");
  const leaseDurationHours = normalizeSchemaPatternCurationLeaseHours(source.leaseDurationHours);
  const leaseExpiresAt =
    status === "assigned"
      ? normalizeSchemaPatternDateString(source.leaseExpiresAt) ?? (updatedAt ? addHoursIso(updatedAt, leaseDurationHours) : null)
      : null;
  return expireSchemaPatternCurationThreadIfNeeded({
    ...defaultSchemaPatternCurationThread(schemaHash),
    status,
    assignee,
    openedAt: normalizeSchemaPatternDateString(source.openedAt),
    updatedAt,
    lastReviewer: latestReview?.reviewer ?? normalizeOptionalText(source.lastReviewer, 80),
    lastDecision: latestReview?.decision ?? normalizeSchemaPatternCurationReviewDecision(source.lastDecision),
    leaseExpiresAt,
    leaseDurationHours: status === "assigned" ? leaseDurationHours : null,
    leaseExpired: status !== "assigned" && source.leaseExpired === true,
    reviewCount,
    requestChangesCount,
    events: mergeSchemaPatternCurationEvents(
      normalizedEvents,
      reviews.map((review) => buildSchemaPatternCurationReviewEvent(review, assignee)),
    ),
    governance: {
      excludesRawSchemaContent: true,
      excludesSecretValues: true,
      autoReleasesExpiredAssignments: true,
      configuredLeaseHoursEnv: SCHEMA_PATTERN_CURATION_LEASE_HOURS_ENV,
    },
  });
}

function normalizeSchemaPatternCurationThreadStatus(value: unknown): string | null {
  return value === "unassigned" || value === "assigned" || value === "blocked" || value === "resolved"
    ? value
    : null;
}

function mergeSchemaPatternCurationThreads(
  left: unknown,
  right: unknown,
  reviews: SchemaPatternCurationReview[],
  schemaHash: string,
): SchemaPatternCurationThread {
  const leftThread = normalizeSchemaPatternCurationThread(left, schemaHash, reviews);
  const rightThread = normalizeSchemaPatternCurationThread(right, schemaHash, reviews);
  const leftTime = leftThread.updatedAt ? comparableTimestamp(leftThread.updatedAt) : 0;
  const rightTime = rightThread.updatedAt ? comparableTimestamp(rightThread.updatedAt) : 0;
  const winner = rightTime >= leftTime ? rightThread : leftThread;
  return normalizeSchemaPatternCurationThread({
    ...winner,
    events: mergeSchemaPatternCurationEvents(leftThread.events, rightThread.events),
  }, schemaHash, reviews);
}

function normalizeSchemaPatternCurationEvent(value: unknown): SchemaPatternCurationEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  const action = value.action === "assign" || value.action === "release" || value.action === "review" || value.action === "lease_expired"
    ? value.action
    : null;
  const actor = normalizeOptionalText(value.actor, 120);
  const at = normalizeOptionalText(value.at, 64);
  if (!action || !actor || !at) {
    return null;
  }
  const decision = normalizeSchemaPatternCurationReviewDecision(value.decision);
  return {
    id: normalizeOptionalText(value.id, 160) ||
      `schema-pattern-curation-event-${shortHash(stableStringify({ action, actor, at, decision }))}`,
    at,
    actor,
    action,
    assignee: normalizeOptionalText(value.assignee, 120),
    decision,
    note: normalizeOptionalText(value.note, 240),
    schemaHash: normalizeOptionalText(value.schemaHash, 80),
  };
}

function mergeSchemaPatternCurationEvents(
  existing: SchemaPatternCurationEvent[],
  incoming: SchemaPatternCurationEvent[],
): SchemaPatternCurationEvent[] {
  const byId = new Map<string, SchemaPatternCurationEvent>();
  for (const event of [...existing, ...incoming]) {
    byId.set(event.id, event);
  }
  return Array.from(byId.values())
    .sort((left, right) => comparableTimestamp(right.at) - comparableTimestamp(left.at) || left.id.localeCompare(right.id))
    .slice(0, 12);
}

function buildSchemaPatternCurationEvent(
  action: SchemaPatternCurationEventAction,
  actor: string,
  assignee: string,
  schemaHash: string,
  note: string,
  at: string,
  decision: string | null = null,
): SchemaPatternCurationEvent {
  const normalizedNote = normalizeOptionalText(note, 240);
  return {
    id: `schema-pattern-curation-event-${shortHash(stableStringify({ action, actor, assignee, schemaHash, note: normalizedNote, at, decision }))}`,
    at,
    actor: normalizeOptionalText(actor, 120) || "schema-curator",
    action,
    assignee: normalizeOptionalText(assignee, 120),
    decision: normalizeSchemaPatternCurationReviewDecision(decision),
    note: normalizedNote,
    schemaHash: normalizeOptionalText(schemaHash, 80),
  };
}

function buildSchemaPatternCurationReviewEvent(
  review: SchemaPatternCurationReview,
  currentAssignee: string,
): SchemaPatternCurationEvent {
  return {
    id: `schema-pattern-curation-event-${shortHash(`review|${review.id}|${review.schemaHash}`)}`,
    at: review.createdAt,
    actor: review.reviewer,
    action: "review",
    assignee: currentAssignee || review.reviewer,
    decision: review.decision,
    note: normalizeOptionalText(review.note, 240),
    schemaHash: review.schemaHash,
  };
}

function expireSchemaPatternCurationThreadIfNeeded(
  thread: SchemaPatternCurationThread,
): SchemaPatternCurationThread {
  if (thread.status !== "assigned" || !thread.leaseExpiresAt) {
    return thread;
  }
  const expiresAt = Date.parse(thread.leaseExpiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt > Date.now()) {
    return thread;
  }
  const actor = thread.assignee || thread.lastReviewer || "schema-curator";
  const event = buildSchemaPatternCurationEvent(
    "lease_expired",
    actor,
    "",
    thread.schemaHash,
    "Lease de curadoria do padrão expirado.",
    thread.leaseExpiresAt,
  );
  return {
    ...thread,
    status: "unassigned",
    assignee: "",
    updatedAt: thread.leaseExpiresAt,
    leaseExpiresAt: null,
    leaseDurationHours: null,
    leaseExpired: true,
    events: mergeSchemaPatternCurationEvents([event], thread.events),
  };
}

function normalizeSchemaPatternLibraryItem(value: unknown): SchemaReusablePatternLibraryItem | null {
  if (!isRecord(value) || !isRecord(value.schema)) {
    return null;
  }
  const name = typeof value.name === "string" && value.name.trim() ? value.name.trim() : "";
  if (!name) {
    return null;
  }
  const schema = cloneRecord(value.schema);
  const schemaHash = typeof value.schemaHash === "string" && value.schemaHash.trim()
    ? value.schemaHash.trim()
    : shortHash(stableStringify(schema));
  const id = typeof value.id === "string" && value.id.trim()
    ? value.id.trim()
    : `schema-pattern-${shortHash(`${name}|${schemaHash}`)}`;
  const createdAt = typeof value.createdAt === "string" && value.createdAt.trim() ? value.createdAt.trim() : new Date().toISOString();
  const updatedAt = typeof value.updatedAt === "string" && value.updatedAt.trim() ? value.updatedAt.trim() : createdAt;
  const curationReviews = syncSchemaPatternCurationReviews(value.curationReviews);
  return {
    ...value,
    id,
    name,
    description: typeof value.description === "string" ? value.description.trim() : "",
    tags: normalizeStringArray(value.tags),
    curationStatus: normalizeSchemaPatternCurationStatus(value.curationStatus),
    createdAt,
    updatedAt,
    curationReviews,
    curationThread: normalizeSchemaPatternCurationThread(value.curationThread, schemaHash, curationReviews),
    schemaHash,
    schema,
  };
}

function normalizeSchemaPatternHistoryPackage(value: unknown): SchemaPatternLibraryHistoryPackage | null {
  if (
    !isRecord(value) ||
    value.format !== "agent-flow-builder.schema-pattern-library-history.v1" ||
    !Array.isArray(value.snapshots)
  ) {
    return null;
  }
  return buildSchemaPatternHistoryPackage(value.snapshots, normalizeSchemaPatternSharedSyncInfo(value.sharedSync, {
    action: "merge",
    subject: "history",
    storage: SCHEMA_PATTERN_HISTORY_FILE,
    excludesRawSchemaContent: true,
  }));
}

function buildSchemaPatternHistoryPackage(
  snapshots: unknown[],
  syncInput: SchemaPatternSharedSyncBuildInput,
): SchemaPatternLibraryHistoryPackage {
  const normalized = syncSchemaPatternHistorySnapshots(snapshots);
  const withoutHash = {
    format: "agent-flow-builder.schema-pattern-library-history.v1" as const,
    exportedAt: new Date().toISOString(),
    snapshotCount: normalized.length,
    snapshots: normalized,
    governance: {
      excludesRawSchemaContent: true as const,
      excludesSecretValues: true as const,
    },
  };
  return {
    ...withoutHash,
    packageHash: shortHash(stableStringify(withoutHash)),
    sharedSync: buildSchemaPatternSharedSyncInfo(syncInput, shortHash(stableStringify({ snapshots: normalized })), normalized.length),
  };
}

function mergeSchemaPatternHistorySnapshots(
  existingSnapshots: unknown[],
  incomingSnapshots: unknown[],
): {
  snapshots: SchemaPatternLibraryHistorySnapshot[];
  stats: SchemaPatternSharedSyncStats;
} {
  const existing = syncSchemaPatternHistorySnapshots(existingSnapshots);
  const incoming = syncSchemaPatternHistorySnapshots(incomingSnapshots);
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
  const snapshots = syncSchemaPatternHistorySnapshots(Array.from(byHash.values()));
  return {
    snapshots,
    stats: {
      incomingCount: incoming.length,
      existingCount: existing.length,
      addedCount,
      updatedCount: 0,
      unchangedCount,
      conflictCount: 0,
      finalCount: snapshots.length,
    },
  };
}

function syncSchemaPatternHistorySnapshots(snapshots: unknown[]): SchemaPatternLibraryHistorySnapshot[] {
  const byHash = new Map<string, SchemaPatternLibraryHistorySnapshot>();
  for (const snapshot of snapshots
    .map(normalizeSchemaPatternHistorySnapshot)
    .filter((entry): entry is SchemaPatternLibraryHistorySnapshot => entry !== null)) {
    byHash.set(snapshot.snapshotHash, snapshot);
  }
  return Array.from(byHash.values()).sort((left, right) => comparableTimestamp(right.capturedAt) - comparableTimestamp(left.capturedAt));
}

function normalizeSchemaPatternHistorySnapshot(value: unknown): SchemaPatternLibraryHistorySnapshot | null {
  if (!isRecord(value)) {
    return null;
  }
  const capturedAt = typeof value.capturedAt === "string" && value.capturedAt.trim() ? value.capturedAt.trim() : "";
  if (!capturedAt) {
    return null;
  }
  const id = typeof value.id === "string" && value.id.trim()
    ? value.id.trim()
    : `schema-pattern-history-${shortHash(stableStringify(value))}`;
  const snapshotWithoutHash: Record<string, unknown> = { ...value, id, capturedAt };
  delete snapshotWithoutHash.snapshotHash;
  const snapshotHash = typeof value.snapshotHash === "string" && value.snapshotHash.trim()
    ? value.snapshotHash.trim()
    : shortHash(stableStringify(snapshotWithoutHash));
  return {
    ...value,
    id,
    capturedAt,
    snapshotHash,
  };
}

function normalizeSchemaPatternCurationStatus(value: unknown): SchemaPatternCurationStatus {
  return value === "approved" || value === "deprecated" || value === "draft" ? value : "draft";
}

type SchemaPatternSharedSyncBuildInput = {
  action: SchemaPatternSharedSyncAction;
  subject: SchemaPatternSharedSyncSubject;
  storage: string;
  excludesRawSchemaContent: boolean;
  stats?: Partial<SchemaPatternSharedSyncStats>;
};

function buildSchemaPatternSharedSyncInfo(
  input: SchemaPatternSharedSyncBuildInput,
  contentHash: string,
  finalCount: number,
): SchemaPatternSharedSyncInfo {
  return {
    action: input.action,
    subject: input.subject,
    updatedAt: new Date().toISOString(),
    storage: input.storage,
    contentHash,
    incomingCount: Math.max(0, Math.floor(input.stats?.incomingCount ?? 0)),
    existingCount: Math.max(0, Math.floor(input.stats?.existingCount ?? 0)),
    addedCount: Math.max(0, Math.floor(input.stats?.addedCount ?? 0)),
    updatedCount: Math.max(0, Math.floor(input.stats?.updatedCount ?? 0)),
    unchangedCount: Math.max(0, Math.floor(input.stats?.unchangedCount ?? 0)),
    conflictCount: Math.max(0, Math.floor(input.stats?.conflictCount ?? 0)),
    finalCount: Math.max(0, Math.floor(input.stats?.finalCount ?? finalCount)),
    governance: {
      excludesSecretValues: true,
      excludesRawSchemaContent: input.excludesRawSchemaContent,
    },
  };
}

function normalizeSchemaPatternSharedSyncInfo(
  value: unknown,
  fallback: SchemaPatternSharedSyncBuildInput,
): SchemaPatternSharedSyncBuildInput {
  if (!isRecord(value)) {
    return fallback;
  }
  return {
    action: normalizeSchemaPatternSharedSyncAction(value.action, fallback.action),
    subject: value.subject === "history" || value.subject === "library" ? value.subject : fallback.subject,
    storage: typeof value.storage === "string" && value.storage.trim() ? value.storage.trim() : fallback.storage,
    excludesRawSchemaContent: isRecord(value.governance) && typeof value.governance.excludesRawSchemaContent === "boolean"
      ? value.governance.excludesRawSchemaContent
      : fallback.excludesRawSchemaContent,
    stats: {
      incomingCount: normalizeNonNegativeInteger(value.incomingCount),
      existingCount: normalizeNonNegativeInteger(value.existingCount),
      addedCount: normalizeNonNegativeInteger(value.addedCount),
      updatedCount: normalizeNonNegativeInteger(value.updatedCount),
      unchangedCount: normalizeNonNegativeInteger(value.unchangedCount),
      conflictCount: normalizeNonNegativeInteger(value.conflictCount),
      finalCount: normalizeNonNegativeInteger(value.finalCount),
    },
  };
}

function normalizeSchemaPatternSharedSyncAction(
  value: unknown,
  fallback: SchemaPatternSharedSyncAction,
): SchemaPatternSharedSyncAction {
  return value === "empty" || value === "save" || value === "merge" || value === "resolve_conflict"
    ? value
    : fallback;
}

function normalizeNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.floor(value);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right));
}

function normalizeOptionalText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function normalizeNullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeSchemaPatternDateString(value: unknown): string | null {
  const raw = normalizeNullableText(value);
  if (!raw) {
    return null;
  }
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function readSchemaPatternCurationLeaseHours(): number {
  return normalizeSchemaPatternCurationLeaseHours(process.env[SCHEMA_PATTERN_CURATION_LEASE_HOURS_ENV]);
}

function normalizeSchemaPatternCurationLeaseHours(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return SCHEMA_PATTERN_CURATION_LEASE_HOURS;
  }
  return Math.min(Math.max(Math.floor(numeric), 1), 168);
}

function addHoursIso(value: string, hours: number): string {
  const base = Date.parse(value);
  const timestamp = Number.isFinite(base) ? base : Date.now();
  return new Date(timestamp + hours * 60 * 60 * 1000).toISOString();
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function cloneSchemaPatternJsonValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function comparableTimestamp(value: string): number {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFileNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT");
}
