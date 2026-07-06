import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadFlowById, WorkspaceError } from "./workspace.ts";

type StudioScenariosSharedSyncAction = "empty" | "save" | "merge" | "central_sync" | "resolve_conflict" | "curate_conflict";
type StudioScenarioConflictKind = "scenario" | "dataset" | "evaluator";
type StudioScenarioConflictCurationStatus = "unassigned" | "assigned" | "resolved";
type StudioScenarioConflictCurationAction = "assign" | "release";
type StudioScenarioConflictCurationLastAction = StudioScenarioConflictCurationAction | "resolve" | "lease_expired";
type StudioScenarioConflictCuratorRole = "owner" | "reviewer" | "viewer";

interface StudioScenarioItem {
  id: string;
  label: string;
  input: string;
  payload: unknown;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  sourceContext: {
    kind: string;
    agentId: string;
    primaryRunId: string | null;
    baselineRunId: string | null;
    candidateRunId: string | null;
    sessionId: string | null;
    nodeId: string | null;
    eventSeq: number | null;
    label: string;
  };
  [key: string]: unknown;
}

interface StudioScenarioDatasetItem {
  id: string;
  name: string;
  description: string;
  scenarioIds: string[];
  tags: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  runHistory: unknown[];
}

interface StudioScenarioEvaluatorItem {
  id: string;
  name: string;
  description: string;
  kind: string;
  operator: string;
  expectedText: string;
  matchMode: string;
  caseSensitive: boolean;
  rules: unknown[];
  external: unknown;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

interface StudioScenariosMergeStats {
  incomingScenarioCount: number;
  incomingDatasetCount: number;
  incomingEvaluatorCount: number;
  existingScenarioCount: number;
  existingDatasetCount: number;
  existingEvaluatorCount: number;
  addedScenarioCount: number;
  updatedScenarioCount: number;
  unchangedScenarioCount: number;
  addedDatasetCount: number;
  updatedDatasetCount: number;
  unchangedDatasetCount: number;
  addedEvaluatorCount: number;
  updatedEvaluatorCount: number;
  unchangedEvaluatorCount: number;
  finalScenarioCount: number;
  finalDatasetCount: number;
  finalEvaluatorCount: number;
}

interface StudioScenarioConflictRef {
  kind: StudioScenarioConflictKind;
  id: string;
  label: string;
  updatedAt: string;
  contentHash: string;
  agentId: string | null;
  primaryRunId: string | null;
  datasetScenarioCount: number | null;
}

interface StudioScenarioConflictDiffValue {
  contentHash: string;
  preview: string;
}

interface StudioScenarioConflictDiffField {
  field: string;
  label: string;
  valueCount: number;
  values: StudioScenarioConflictDiffValue[];
}

interface StudioScenarioConflictDiff {
  changedFieldCount: number;
  fields: StudioScenarioConflictDiffField[];
  governance: {
    excludesRawScenarioPayloads: true;
    excludesRawScenarioInputs: true;
    redactsSecretLikeKeys: true;
    excludesSecretValues: true;
  };
}

interface StudioScenarioConflict {
  conflictId: string;
  status: "open";
  kind: StudioScenarioConflictKind;
  itemId: string;
  itemLabel: string;
  candidateCount: number;
  latestUpdatedAt: string;
  latestContentHash: string;
  refs: StudioScenarioConflictRef[];
  candidates: Array<StudioScenarioItem | StudioScenarioDatasetItem | StudioScenarioEvaluatorItem>;
  diff: StudioScenarioConflictDiff;
  curationThread: StudioScenarioConflictCurationThread;
  governance: {
    includesScenarioInputs: true;
    includesScenarioPayloads: true;
    redactsSecretLikeKeys: true;
    excludesSecretValues: true;
  };
}

interface StudioScenarioConflictCurationThread {
  status: StudioScenarioConflictCurationStatus;
  assignee: string;
  openedAt: string | null;
  updatedAt: string | null;
  lastActor: string;
  lastAction: StudioScenarioConflictCurationLastAction | null;
  note: string;
  leaseExpiresAt: string | null;
  leaseDurationHours: number | null;
  leaseExpired: boolean;
  events: StudioScenarioConflictCurationEvent[];
  governance: {
    excludesRawScenarioPayloads: true;
    redactsSecretLikeKeys: true;
    excludesSecretValues: true;
    autoReleasesExpiredAssignments: true;
    configuredLeaseHoursEnv: typeof STUDIO_SCENARIO_CONFLICT_CURATION_LEASE_HOURS_ENV;
  };
}

interface StudioScenarioConflictCurationEvent {
  id: string;
  at: string;
  actor: string;
  action: StudioScenarioConflictCurationLastAction;
  assignee: string;
  role: StudioScenarioConflictCuratorRole;
  note: string;
}

interface StudioScenarioResolutionRecord {
  resolutionId: string;
  conflictId: string;
  kind: StudioScenarioConflictKind;
  itemId: string;
  resolvedAt: string;
  resolvedBy: string;
  resolvedRole: StudioScenarioConflictCuratorRole;
  resolutionNote: string;
  keptRef: StudioScenarioConflictRef;
  discardedRefs: StudioScenarioConflictRef[];
  candidateCount: number;
  governance: {
    excludesRawScenarioPayloads: true;
    redactsSecretLikeKeys: true;
    excludesSecretValues: true;
  };
}

interface StudioScenarioConflictReview {
  conflictId: string;
  status: "open";
  kind: StudioScenarioConflictKind;
  itemId: string;
  itemLabel: string;
  candidateCount: number;
  latestUpdatedAt: string;
  latestContentHash: string;
  refs: StudioScenarioConflictRef[];
  candidateContentHashes: string[];
  diff: StudioScenarioConflictDiff;
  curationThread: StudioScenarioConflictCurationThread;
  governance: {
    excludesCandidates: true;
    excludesRawScenarioInputs: true;
    excludesRawScenarioPayloads: true;
    redactsSecretLikeKeys: true;
    excludesSecretValues: true;
    includesOnlyRefsDiffsAndCuration: true;
  };
}

interface StudioScenariosConflictReviewPackage {
  format: typeof STUDIO_SCENARIOS_CONFLICT_REVIEW_FORMAT;
  generatedAt: string;
  flowId: string;
  packageHash: string;
  conflictCount: number;
  openConflictCount: number;
  resolutionHistoryCount: number;
  conflicts: StudioScenarioConflictReview[];
  resolutionHistory: StudioScenarioResolutionRecord[];
  summary: StudioScenarioConflictReviewSummary;
  governance: {
    excludesCandidates: true;
    excludesRawScenarioInputs: true;
    excludesRawScenarioPayloads: true;
    redactsSecretLikeKeys: true;
    excludesSecretValues: true;
    includesOnlyRefsDiffsThreadsAndResolutionHistory: true;
    localWorkspaceFile: true;
  };
}

interface StudioScenarioConflictReviewSummary {
  scenarioConflictCount: number;
  datasetConflictCount: number;
  evaluatorConflictCount: number;
  assignedConflictCount: number;
  unassignedConflictCount: number;
  resolvedThreadCount: number;
}

type StudioScenarioConflictReviewDiffItemStatus = "same" | "changed" | "only_current" | "only_incoming";

interface StudioScenarioConflictReviewDiffItem {
  id: string;
  label: string;
  status: StudioScenarioConflictReviewDiffItemStatus;
  current: string;
  incoming: string;
  delta: number;
}

interface StudioScenarioConflictReviewDiffSection {
  id: string;
  title: string;
  status: "same" | "changed";
  statusLabel: "igual" | "alterado";
  summary: string;
  items: StudioScenarioConflictReviewDiffItem[];
}

export interface StudioScenariosPackage {
  format: typeof STUDIO_SCENARIOS_FORMAT;
  exportedAt: string;
  flowId: string;
  packageHash: string;
  scenarioCount: number;
  datasetCount: number;
  evaluatorCount: number;
  scenarios: StudioScenarioItem[];
  datasets: StudioScenarioDatasetItem[];
  evaluators: StudioScenarioEvaluatorItem[];
  conflictCount: number;
  openConflictCount: number;
  conflicts: StudioScenarioConflict[];
  resolutionHistoryCount: number;
  resolutionHistory: StudioScenarioResolutionRecord[];
  multiAgent: {
    agentIds: string[];
    runIds: string[];
    sessionIds: string[];
    sourceKinds: string[];
    datasetScenarioCoverage: number;
  };
  sharedSync: {
    action: StudioScenariosSharedSyncAction;
    updatedAt: string;
    storage: typeof STUDIO_SCENARIOS_FILE;
    contentHash: string;
    incomingScenarioCount: number;
    incomingDatasetCount: number;
    incomingEvaluatorCount: number;
    existingScenarioCount: number;
    existingDatasetCount: number;
    existingEvaluatorCount: number;
    addedScenarioCount: number;
    updatedScenarioCount: number;
    unchangedScenarioCount: number;
    addedDatasetCount: number;
    updatedDatasetCount: number;
    unchangedDatasetCount: number;
    addedEvaluatorCount: number;
    updatedEvaluatorCount: number;
    unchangedEvaluatorCount: number;
    finalScenarioCount: number;
    finalDatasetCount: number;
    finalEvaluatorCount: number;
    conflictCount: number;
    openConflictCount: number;
    governance: {
      redactsSecretLikeKeys: true;
      excludesSecretValues: true;
      excludesHeaders: true;
      localWorkspaceFile: true;
    };
  };
  governance: {
    includesScenarioInputs: true;
    includesScenarioPayloads: true;
    redactsSecretLikeKeys: true;
    excludesSecretValues: true;
    excludesHeaders: true;
    localWorkspaceFile: true;
  };
}

export interface StudioScenariosCentralSyncStatus {
  format: typeof STUDIO_SCENARIOS_CENTRAL_STATUS_FORMAT;
  generatedAt: string;
  configured: boolean;
  urlConfigured: boolean;
  tokenConfigured: boolean;
  timeoutMs: number;
  invalidReason: string | null;
  lastSyncedAt: string | null;
  statusCode: number | null;
  pushedScenarioCount: number | null;
  pushedDatasetCount: number | null;
  pushedEvaluatorCount: number | null;
  pulledScenarioCount: number | null;
  pulledDatasetCount: number | null;
  pulledEvaluatorCount: number | null;
  error: string | null;
  governance: {
    includesScenarioInputs: true;
    includesScenarioPayloads: true;
    redactsSecretLikeKeys: true;
    excludesSecretValues: true;
    excludesHeaders: true;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
    storesCentralToken: false;
    configuredUrlEnv: typeof STUDIO_SCENARIOS_CENTRAL_URL_ENV;
    configuredTokenEnv: typeof STUDIO_SCENARIOS_CENTRAL_TOKEN_ENV;
    configuredTimeoutEnv: typeof STUDIO_SCENARIOS_CENTRAL_TIMEOUT_ENV;
    maxPayloadBytes: typeof STUDIO_SCENARIOS_CENTRAL_MAX_BYTES;
  };
}

export interface StudioScenariosCentralSyncResult {
  format: typeof STUDIO_SCENARIOS_CENTRAL_SYNC_RESULT_FORMAT;
  flowId: string;
  scenarios: StudioScenariosPackage;
  central: StudioScenariosCentralSyncStatus;
  pushedScenarioCount: number;
  pushedDatasetCount: number;
  pushedEvaluatorCount: number;
  pulledScenarioCount: number;
  pulledDatasetCount: number;
  pulledEvaluatorCount: number;
  governance: {
    includesScenarioInputs: true;
    includesScenarioPayloads: true;
    redactsSecretLikeKeys: true;
    excludesSecretValues: true;
    excludesHeaders: true;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
  };
}

interface StudioScenariosCentralSyncConfig {
  url: string | null;
  token: string | null;
  timeoutMs: number;
  invalidReason: string | null;
}

const STUDIO_SCENARIOS_FORMAT = "agent-flow-builder.studio-scenarios.v1";
const STUDIO_SCENARIOS_CONFLICT_REVIEW_FORMAT = "agent-flow-builder.studio-scenarios-conflict-review.v1";
const STUDIO_SCENARIOS_FILE = ".agent-flow/studio-scenarios/scenarios.afscenarios.json";
const STUDIO_SCENARIOS_CENTRAL_SYNC_REQUEST_FORMAT = "agent-flow-builder.studio-scenarios-central-sync-request.v1";
const STUDIO_SCENARIOS_CENTRAL_SYNC_RESULT_FORMAT = "agent-flow-builder.studio-scenarios-central-sync-result.v1";
const STUDIO_SCENARIOS_CENTRAL_STATUS_FORMAT = "agent-flow-builder.studio-scenarios-central-sync-status.v1";
const STUDIO_SCENARIOS_CENTRAL_URL_ENV = "AGENT_FLOW_STUDIO_SCENARIOS_CENTRAL_URL";
const STUDIO_SCENARIOS_CENTRAL_TOKEN_ENV = "AGENT_FLOW_STUDIO_SCENARIOS_CENTRAL_TOKEN";
const STUDIO_SCENARIOS_CENTRAL_TIMEOUT_ENV = "AGENT_FLOW_STUDIO_SCENARIOS_CENTRAL_TIMEOUT_MS";
const STUDIO_SCENARIO_CONFLICT_CURATION_LEASE_HOURS_ENV = "AGENT_FLOW_STUDIO_SCENARIO_CONFLICT_CURATION_LEASE_HOURS";
const STUDIO_SCENARIOS_CENTRAL_TIMEOUT_MS = 5_000;
const STUDIO_SCENARIO_CONFLICT_CURATION_LEASE_HOURS = 24;
const STUDIO_SCENARIOS_CENTRAL_MAX_BYTES = 2_000_000;
const MAX_STUDIO_SCENARIOS = 500;
const MAX_STUDIO_DATASETS = 100;
const MAX_STUDIO_EVALUATORS = 200;
const REDACTED_VALUE = "[redacted]";

export async function loadStudioScenarios(workspaceRoot: string, flowId: string): Promise<StudioScenariosPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  try {
    const raw = await readFile(studioScenariosPath(loaded.flowRoot), "utf-8");
    const payload = normalizeStudioScenariosPackage(JSON.parse(raw) as unknown, loaded.flow.id, "merge");
    if (!payload) {
      throw new WorkspaceError("Pacote compartilhado de cenarios invalido.", 422);
    }
    return payload;
  } catch (error) {
    if (isFileNotFound(error)) {
      return buildStudioScenariosPackage(loaded.flow.id, [], [], [], {
        action: "empty",
        incomingScenarioCount: 0,
        incomingDatasetCount: 0,
        incomingEvaluatorCount: 0,
        existingScenarioCount: 0,
        existingDatasetCount: 0,
        existingEvaluatorCount: 0,
        addedScenarioCount: 0,
        updatedScenarioCount: 0,
        unchangedScenarioCount: 0,
        addedDatasetCount: 0,
        updatedDatasetCount: 0,
        unchangedDatasetCount: 0,
        addedEvaluatorCount: 0,
        updatedEvaluatorCount: 0,
        unchangedEvaluatorCount: 0,
        finalScenarioCount: 0,
        finalDatasetCount: 0,
        finalEvaluatorCount: 0,
      });
    }
    if (error instanceof WorkspaceError) {
      throw error;
    }
    throw new WorkspaceError("Falha ao ler cenarios compartilhados do Studio.", 500, error);
  }
}

export async function saveStudioScenarios(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<StudioScenariosPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const existing = await loadStudioScenarios(workspaceRoot, flowId);
  const incoming = normalizeStudioScenariosPackage(payload, loaded.flow.id, "save");
  if (!incoming) {
    throw new WorkspaceError("Payload de cenarios compartilhados invalido.", 400);
  }
  const history = mergeStudioScenarioResolutionHistory(existing.resolutionHistory, incoming.resolutionHistory);
  const next = buildStudioScenariosPackage(loaded.flow.id, incoming.scenarios, incoming.datasets, incoming.evaluators, {
    action: "save",
    incomingScenarioCount: incoming.scenarios.length,
    incomingDatasetCount: incoming.datasets.length,
    incomingEvaluatorCount: incoming.evaluators.length,
    existingScenarioCount: 0,
    existingDatasetCount: 0,
    existingEvaluatorCount: 0,
    addedScenarioCount: incoming.scenarios.length,
    updatedScenarioCount: 0,
    unchangedScenarioCount: 0,
    addedDatasetCount: incoming.datasets.length,
    updatedDatasetCount: 0,
    unchangedDatasetCount: 0,
    addedEvaluatorCount: incoming.evaluators.length,
    updatedEvaluatorCount: 0,
    unchangedEvaluatorCount: 0,
    finalScenarioCount: incoming.scenarios.length,
    finalDatasetCount: incoming.datasets.length,
    finalEvaluatorCount: incoming.evaluators.length,
  }, history, mergeStudioScenarioConflictCurationThreads(existing.conflicts, incoming.conflicts));
  await writeStudioScenariosPackage(loaded.flowRoot, next);
  return next;
}

export async function mergeStudioScenarios(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<StudioScenariosPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const existing = await loadStudioScenarios(workspaceRoot, flowId);
  const incoming = normalizeStudioScenariosPackage(payload, loaded.flow.id, "merge");
  if (!incoming) {
    throw new WorkspaceError("Payload de merge de cenarios invalido.", 400);
  }
  const history = mergeStudioScenarioResolutionHistory(existing.resolutionHistory, incoming.resolutionHistory);
  const conflictCurationSources = mergeStudioScenarioConflictCurationThreads(existing.conflicts, incoming.conflicts);
  const scenarioMerge = mergeStudioScenarioItemsWithConflicts(
    loaded.flow.id,
    "scenario",
    existing.scenarios,
    incoming.scenarios,
    MAX_STUDIO_SCENARIOS,
    history,
    conflictCurationSources,
  );
  const datasetMerge = mergeStudioScenarioItemsWithConflicts(
    loaded.flow.id,
    "dataset",
    existing.datasets,
    incoming.datasets,
    MAX_STUDIO_DATASETS,
    history,
    conflictCurationSources,
  );
  const evaluatorMerge = mergeStudioScenarioItemsWithConflicts(
    loaded.flow.id,
    "evaluator",
    existing.evaluators,
    incoming.evaluators,
    MAX_STUDIO_EVALUATORS,
    history,
    conflictCurationSources,
  );
  const next = buildStudioScenariosPackage(loaded.flow.id, scenarioMerge.items, datasetMerge.items, evaluatorMerge.items, {
    action: "merge",
    incomingScenarioCount: incoming.scenarios.length,
    incomingDatasetCount: incoming.datasets.length,
    incomingEvaluatorCount: incoming.evaluators.length,
    existingScenarioCount: existing.scenarios.length,
    existingDatasetCount: existing.datasets.length,
    existingEvaluatorCount: existing.evaluators.length,
    addedScenarioCount: scenarioMerge.addedCount,
    updatedScenarioCount: scenarioMerge.updatedCount,
    unchangedScenarioCount: scenarioMerge.unchangedCount,
    addedDatasetCount: datasetMerge.addedCount,
    updatedDatasetCount: datasetMerge.updatedCount,
    unchangedDatasetCount: datasetMerge.unchangedCount,
    addedEvaluatorCount: evaluatorMerge.addedCount,
    updatedEvaluatorCount: evaluatorMerge.updatedCount,
    unchangedEvaluatorCount: evaluatorMerge.unchangedCount,
    finalScenarioCount: scenarioMerge.items.length,
    finalDatasetCount: datasetMerge.items.length,
    finalEvaluatorCount: evaluatorMerge.items.length,
  }, history, [...scenarioMerge.conflicts, ...datasetMerge.conflicts, ...evaluatorMerge.conflicts]);
  await writeStudioScenariosPackage(loaded.flowRoot, next);
  return next;
}

export async function loadStudioScenarioConflictReview(
  workspaceRoot: string,
  flowId: string,
): Promise<StudioScenariosConflictReviewPackage> {
  const scenarios = await loadStudioScenarios(workspaceRoot, flowId);
  return buildStudioScenarioConflictReviewPackage(scenarios);
}

export async function compareStudioScenarioConflictReview(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  const current = await loadStudioScenarios(workspaceRoot, flowId).then(buildStudioScenarioConflictReviewPackage);
  const record = isRecord(payload) ? payload : {};
  const candidate = record.review !== undefined ? record.review : payload;
  const incoming = normalizeStudioScenariosConflictReviewPackage(candidate, current.flowId);
  if (!incoming) {
    throw new WorkspaceError("Revisão de conflitos de cenários inválida ou contendo payload bruto.", 400);
  }
  if (incoming.flowId !== current.flowId) {
    throw new WorkspaceError("Revisão de conflitos pertence a outro flow.", 400, {
      expectedFlowId: current.flowId,
      receivedFlowId: incoming.flowId,
    });
  }
  return buildStudioScenarioConflictReviewDiffPackage(current, incoming);
}

export async function resolveStudioScenarioConflict(
  workspaceRoot: string,
  flowId: string,
  conflictId: string,
  payload: unknown,
): Promise<StudioScenariosPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const existing = await loadStudioScenarios(workspaceRoot, flowId);
  const conflict = existing.conflicts.find((item) => item.conflictId === normalizeId(conflictId));
  if (!conflict) {
    throw new WorkspaceError("Conflito de cenarios compartilhados nao encontrado.", 404);
  }
  const recordPayload = isRecord(payload) ? payload : {};
  const keepContentHash = stringValue(recordPayload.keepContentHash) || conflict.latestContentHash;
  const selected = conflict.candidates.find((candidate) =>
    studioScenarioItemContentHash(conflict.kind, candidate) === keepContentHash,
  );
  if (!selected) {
    throw new WorkspaceError("Candidato escolhido para resolver conflito nao foi encontrado.", 404);
  }
  const resolvedBy = normalizeActor(stringValue(recordPayload.resolvedBy ?? recordPayload.actor ?? recordPayload.assignee));
  const resolvedRole = normalizeStudioScenarioConflictCuratorRole(recordPayload.role ?? recordPayload.resolvedRole);
  assertStudioScenarioConflictMutationAllowed(resolvedRole, "resolver conflito de cenarios compartilhados");
  const resolutionNote = normalizeResolutionNote(stringValue(recordPayload.resolutionNote ?? recordPayload.note));
  const resolutionRecord = buildStudioScenarioResolutionRecord(conflict, selected, resolvedBy, resolvedRole, resolutionNote);
  const scenarios = conflict.kind === "scenario"
    ? replaceStudioScenarioItem(existing.scenarios, selected as StudioScenarioItem, MAX_STUDIO_SCENARIOS)
    : existing.scenarios;
  const datasets = conflict.kind === "dataset"
    ? replaceStudioScenarioItem(existing.datasets, selected as StudioScenarioDatasetItem, MAX_STUDIO_DATASETS)
    : existing.datasets;
  const evaluators = conflict.kind === "evaluator"
    ? replaceStudioScenarioItem(existing.evaluators, selected as StudioScenarioEvaluatorItem, MAX_STUDIO_EVALUATORS)
    : existing.evaluators;
  const history = mergeStudioScenarioResolutionHistory(existing.resolutionHistory, [resolutionRecord]);
  const resolvedThread = resolveStudioScenarioConflictCurationThread(
    conflict.curationThread,
    resolvedBy,
    resolvedRole,
    resolutionNote,
    resolutionRecord.resolvedAt,
  );
  const next = buildStudioScenariosPackage(loaded.flow.id, scenarios, datasets, evaluators, {
    ...emptyStats(),
    action: "resolve_conflict",
    existingScenarioCount: existing.scenarioCount,
    existingDatasetCount: existing.datasetCount,
    existingEvaluatorCount: existing.evaluatorCount,
    unchangedScenarioCount: scenarios.length,
    unchangedDatasetCount: datasets.length,
    unchangedEvaluatorCount: evaluators.length,
    finalScenarioCount: scenarios.length,
    finalDatasetCount: datasets.length,
    finalEvaluatorCount: evaluators.length,
  }, history, [
    ...existing.conflicts.filter((item) => item.conflictId !== conflict.conflictId),
    { ...conflict, curationThread: resolvedThread },
  ]);
  await writeStudioScenariosPackage(loaded.flowRoot, next);
  return next;
}

export async function curateStudioScenarioConflict(
  workspaceRoot: string,
  flowId: string,
  conflictId: string,
  payload: unknown,
): Promise<StudioScenariosPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const existing = await loadStudioScenarios(workspaceRoot, flowId);
  const normalizedConflictId = normalizeId(conflictId);
  const conflict = existing.conflicts.find((item) => item.conflictId === normalizedConflictId);
  if (!conflict) {
    throw new WorkspaceError("Conflito de cenarios compartilhados nao encontrado.", 404);
  }
  const recordPayload = isRecord(payload) ? payload : {};
  const action = normalizeStudioScenarioConflictCurationAction(recordPayload.action);
  if (!action) {
    throw new WorkspaceError("Acao de curadoria do conflito de cenarios e obrigatoria.", 400);
  }
  const actor = normalizeActor(stringValue(recordPayload.actor ?? recordPayload.actorId ?? recordPayload.assignee ?? recordPayload.resolvedBy));
  const role = normalizeStudioScenarioConflictCuratorRole(recordPayload.role ?? recordPayload.resolvedRole);
  assertStudioScenarioConflictMutationAllowed(role, "curar conflito de cenarios compartilhados");
  const note = normalizeResolutionNote(stringValue(recordPayload.note ?? recordPayload.resolutionNote));
  const updatedAt = new Date().toISOString();
  const nextConflicts = existing.conflicts.map((item) =>
    item.conflictId === normalizedConflictId
      ? {
          ...item,
          curationThread: updateStudioScenarioConflictCurationThread(item.curationThread, action, actor, role, note, updatedAt),
        }
      : item,
  );
  const next = buildStudioScenariosPackage(loaded.flow.id, existing.scenarios, existing.datasets, existing.evaluators, {
    ...emptyStats(),
    action: "curate_conflict",
    existingScenarioCount: existing.scenarioCount,
    existingDatasetCount: existing.datasetCount,
    existingEvaluatorCount: existing.evaluatorCount,
    unchangedScenarioCount: existing.scenarioCount,
    unchangedDatasetCount: existing.datasetCount,
    unchangedEvaluatorCount: existing.evaluatorCount,
    finalScenarioCount: existing.scenarioCount,
    finalDatasetCount: existing.datasetCount,
    finalEvaluatorCount: existing.evaluatorCount,
  }, existing.resolutionHistory, nextConflicts);
  await writeStudioScenariosPackage(loaded.flowRoot, next);
  return next;
}

export function loadStudioScenariosCentralSyncStatus(
  previous?: Partial<StudioScenariosCentralSyncStatus>,
): StudioScenariosCentralSyncStatus {
  const config = readStudioScenariosCentralSyncConfig();
  return {
    format: STUDIO_SCENARIOS_CENTRAL_STATUS_FORMAT,
    generatedAt: new Date().toISOString(),
    configured: Boolean(config.url && !config.invalidReason),
    urlConfigured: Boolean(config.url),
    tokenConfigured: Boolean(config.token),
    timeoutMs: config.timeoutMs,
    invalidReason: config.invalidReason,
    lastSyncedAt: previous?.lastSyncedAt ?? null,
    statusCode: previous?.statusCode ?? null,
    pushedScenarioCount: previous?.pushedScenarioCount ?? null,
    pushedDatasetCount: previous?.pushedDatasetCount ?? null,
    pushedEvaluatorCount: previous?.pushedEvaluatorCount ?? null,
    pulledScenarioCount: previous?.pulledScenarioCount ?? null,
    pulledDatasetCount: previous?.pulledDatasetCount ?? null,
    pulledEvaluatorCount: previous?.pulledEvaluatorCount ?? null,
    error: previous?.error ?? null,
    governance: centralGovernance(),
  };
}

export async function syncCentralStudioScenarios(
  workspaceRoot: string,
  flowId: string,
): Promise<StudioScenariosCentralSyncResult> {
  const config = readStudioScenariosCentralSyncConfig();
  if (!config.url || config.invalidReason) {
    throw new WorkspaceError(config.invalidReason ?? "Central de cenarios nao configurada.", 400);
  }
  const local = await loadStudioScenarios(workspaceRoot, flowId);
  const body = {
    format: STUDIO_SCENARIOS_CENTRAL_SYNC_REQUEST_FORMAT,
    flowId: local.flowId,
    scenarioCount: local.scenarioCount,
    datasetCount: local.datasetCount,
    evaluatorCount: local.evaluatorCount,
    scenarios: local,
    governance: {
      redactsSecretLikeKeys: true,
      excludesSecretValues: true,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    const parsed = text.trim() ? JSON.parse(text) as unknown : {};
    if (!response.ok) {
      throw new WorkspaceError(`Central de cenarios retornou HTTP ${response.status}.`, 502);
    }
    const remotePayload = isRecord(parsed) && "scenarios" in parsed ? parsed.scenarios : parsed;
    const remotePackage = normalizeStudioScenariosPackage(remotePayload, flowId, "merge");
    const merged = await mergeStudioScenarios(workspaceRoot, flowId, remotePayload);
    const status = loadStudioScenariosCentralSyncStatus({
      lastSyncedAt: new Date().toISOString(),
      statusCode: response.status,
      pushedScenarioCount: local.scenarioCount,
      pushedDatasetCount: local.datasetCount,
      pushedEvaluatorCount: local.evaluatorCount,
      pulledScenarioCount: remotePackage?.scenarioCount ?? 0,
      pulledDatasetCount: remotePackage?.datasetCount ?? 0,
      pulledEvaluatorCount: remotePackage?.evaluatorCount ?? 0,
      error: null,
    });
    return {
      format: STUDIO_SCENARIOS_CENTRAL_SYNC_RESULT_FORMAT,
      flowId,
      scenarios: buildStudioScenariosPackage(merged.flowId, merged.scenarios, merged.datasets, merged.evaluators, {
        ...emptyStats(),
        action: "central_sync",
        incomingScenarioCount: merged.scenarioCount,
        incomingDatasetCount: merged.datasetCount,
        incomingEvaluatorCount: merged.evaluatorCount,
        finalScenarioCount: merged.scenarioCount,
        finalDatasetCount: merged.datasetCount,
        finalEvaluatorCount: merged.evaluatorCount,
      }, merged.resolutionHistory, merged.conflicts),
      central: status,
      pushedScenarioCount: local.scenarioCount,
      pushedDatasetCount: local.datasetCount,
      pushedEvaluatorCount: local.evaluatorCount,
      pulledScenarioCount: status.pulledScenarioCount ?? 0,
      pulledDatasetCount: status.pulledDatasetCount ?? 0,
      pulledEvaluatorCount: status.pulledEvaluatorCount ?? 0,
      governance: {
        includesScenarioInputs: true,
        includesScenarioPayloads: true,
        redactsSecretLikeKeys: true,
        excludesSecretValues: true,
        excludesHeaders: true,
        centralAuthTokenInHeaderOnly: true,
        centralAuthTokenInBody: false,
      },
    };
  } catch (error) {
    if (error instanceof WorkspaceError) {
      throw error;
    }
    throw new WorkspaceError("Falha ao sincronizar cenarios com a central.", 502, error);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeStudioScenariosPackage(
  value: unknown,
  flowId: string,
  action: StudioScenariosSharedSyncAction,
): StudioScenariosPackage | null {
  const record = isRecord(value) ? value : {};
  const rawScenarios = Array.isArray(record.scenarios) ? record.scenarios : [];
  const scenarios = rawScenarios
    .map(normalizeStudioScenarioItem)
    .filter((item): item is StudioScenarioItem => item !== null)
    .slice(0, MAX_STUDIO_SCENARIOS);
  const rawDatasets = Array.isArray(record.datasets) ? record.datasets : [];
  const datasets = syncDatasets(
    rawDatasets
      .map(normalizeStudioScenarioDatasetItem)
      .filter((item): item is StudioScenarioDatasetItem => item !== null),
    scenarios,
  ).slice(0, MAX_STUDIO_DATASETS);
  const rawEvaluators = Array.isArray(record.evaluators) ? record.evaluators : [];
  const evaluators = rawEvaluators
    .map(normalizeStudioScenarioEvaluatorItem)
    .filter((item): item is StudioScenarioEvaluatorItem => item !== null)
    .slice(0, MAX_STUDIO_EVALUATORS);
  const conflicts = Array.isArray(record.conflicts)
    ? record.conflicts
        .map(normalizeStudioScenarioConflict)
        .filter((item): item is StudioScenarioConflict => item !== null)
    : [];
  const resolutionHistory = Array.isArray(record.resolutionHistory)
    ? normalizeStudioScenarioResolutionHistory(record.resolutionHistory)
    : [];
  if (!scenarios.length && !datasets.length && record.format && record.format !== STUDIO_SCENARIOS_FORMAT) {
    return null;
  }
  return buildStudioScenariosPackage(flowId, scenarios, datasets, evaluators, {
    ...emptyStats(),
    action,
    incomingScenarioCount: scenarios.length,
    incomingDatasetCount: datasets.length,
    incomingEvaluatorCount: evaluators.length,
    finalScenarioCount: scenarios.length,
    finalDatasetCount: datasets.length,
    finalEvaluatorCount: evaluators.length,
  }, resolutionHistory, conflicts);
}

function normalizeStudioScenarioItem(value: unknown): StudioScenarioItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id);
  const label = stringValue(value.label);
  if (!id || !label) {
    return null;
  }
  const now = new Date().toISOString();
  const sourceContext = normalizeSourceContext(value.sourceContext);
  return redactSecretLikeKeys({
    ...value,
    id,
    label,
    input: stringValue(value.input),
    payload: value.payload === undefined ? null : value.payload,
    tags: stringArray(value.tags),
    createdAt: stringValue(value.createdAt) || now,
    updatedAt: stringValue(value.updatedAt) || stringValue(value.createdAt) || now,
    sourceContext,
  }) as StudioScenarioItem;
}

function normalizeSourceContext(value: unknown): StudioScenarioItem["sourceContext"] {
  const record = isRecord(value) ? value : {};
  return {
    kind: stringValue(record.kind) || "manual",
    agentId: stringValue(record.agentId),
    primaryRunId: nullableString(record.primaryRunId),
    baselineRunId: nullableString(record.baselineRunId),
    candidateRunId: nullableString(record.candidateRunId),
    sessionId: nullableString(record.sessionId),
    nodeId: nullableString(record.nodeId),
    eventSeq: typeof record.eventSeq === "number" && Number.isFinite(record.eventSeq) ? record.eventSeq : null,
    label: stringValue(record.label),
  };
}

function normalizeStudioScenarioDatasetItem(value: unknown): StudioScenarioDatasetItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id);
  const name = stringValue(value.name);
  const scenarioIds = stringArray(value.scenarioIds);
  if (!id || !name || !scenarioIds.length) {
    return null;
  }
  const now = new Date().toISOString();
  return {
    id,
    name,
    description: stringValue(value.description),
    scenarioIds,
    tags: stringArray(value.tags),
    version: positiveInteger(value.version, 1),
    createdAt: stringValue(value.createdAt) || now,
    updatedAt: stringValue(value.updatedAt) || stringValue(value.createdAt) || now,
    lastRunAt: nullableString(value.lastRunAt),
    runHistory: Array.isArray(value.runHistory)
      ? redactSecretLikeKeys(value.runHistory).slice(0, 20)
      : [],
  };
}

function normalizeStudioScenarioEvaluatorItem(value: unknown): StudioScenarioEvaluatorItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id);
  const name = stringValue(value.name);
  if (!id || !name) {
    return null;
  }
  const now = new Date().toISOString();
  return redactSecretLikeKeys({
    ...value,
    id,
    name,
    description: stringValue(value.description),
    kind: stringValue(value.kind) || "rules",
    operator: stringValue(value.operator) || "all",
    expectedText: stringValue(value.expectedText),
    matchMode: stringValue(value.matchMode) || "contains",
    caseSensitive: value.caseSensitive === true,
    rules: Array.isArray(value.rules) ? redactSecretLikeKeys(value.rules).slice(0, 50) : [],
    external: value.external === undefined ? null : redactSecretLikeKeys(value.external),
    createdAt: stringValue(value.createdAt) || now,
    updatedAt: stringValue(value.updatedAt) || stringValue(value.createdAt) || now,
  }) as StudioScenarioEvaluatorItem;
}

function syncDatasets(datasets: StudioScenarioDatasetItem[], scenarios: StudioScenarioItem[]): StudioScenarioDatasetItem[] {
  const scenarioIds = new Set(scenarios.map((scenario) => scenario.id));
  return datasets
    .map((dataset) => ({
      ...dataset,
      scenarioIds: dataset.scenarioIds.filter((scenarioId) => scenarioIds.has(scenarioId)),
    }))
    .filter((dataset) => dataset.scenarioIds.length > 0)
    .sort((left, right) => compareUpdatedAt(left, right));
}

function buildStudioScenariosPackage(
  flowId: string,
  scenarios: StudioScenarioItem[],
  datasets: StudioScenarioDatasetItem[],
  evaluators: StudioScenarioEvaluatorItem[],
  stats: StudioScenariosMergeStats & { action: StudioScenariosSharedSyncAction },
  resolutionHistory: unknown[] = [],
  conflictSources: unknown[] = [],
): StudioScenariosPackage {
  const normalizedScenarios = uniqueById(scenarios.map(normalizeStudioScenarioItem), MAX_STUDIO_SCENARIOS);
  const normalizedDatasets = syncDatasets(uniqueById(datasets.map(normalizeStudioScenarioDatasetItem), MAX_STUDIO_DATASETS), normalizedScenarios);
  const normalizedEvaluators = uniqueById(evaluators.map(normalizeStudioScenarioEvaluatorItem), MAX_STUDIO_EVALUATORS);
  const normalizedResolutionHistory = normalizeStudioScenarioResolutionHistory(resolutionHistory).slice(0, 128);
  const conflicts = syncStudioScenarioConflicts(flowId, conflictSources, normalizedResolutionHistory);
  const contentHash = hashValue({
    scenarios: normalizedScenarios,
    datasets: normalizedDatasets,
    evaluators: normalizedEvaluators,
    conflicts: conflicts.map((conflict) => ({
      conflictId: conflict.conflictId,
      refs: conflict.refs,
      curationThread: conflict.curationThread,
    })),
    resolutionHistory: normalizedResolutionHistory,
  });
  return {
    format: STUDIO_SCENARIOS_FORMAT,
    exportedAt: new Date().toISOString(),
    flowId,
    packageHash: contentHash,
    scenarioCount: normalizedScenarios.length,
    datasetCount: normalizedDatasets.length,
    evaluatorCount: normalizedEvaluators.length,
    scenarios: normalizedScenarios,
    datasets: normalizedDatasets,
    evaluators: normalizedEvaluators,
    conflictCount: conflicts.length,
    openConflictCount: conflicts.length,
    conflicts,
    resolutionHistoryCount: normalizedResolutionHistory.length,
    resolutionHistory: normalizedResolutionHistory,
    multiAgent: buildMultiAgentSummary(normalizedScenarios, normalizedDatasets),
    sharedSync: {
      action: stats.action,
      updatedAt: new Date().toISOString(),
      storage: STUDIO_SCENARIOS_FILE,
      contentHash,
      incomingScenarioCount: stats.incomingScenarioCount,
      incomingDatasetCount: stats.incomingDatasetCount,
      incomingEvaluatorCount: stats.incomingEvaluatorCount,
      existingScenarioCount: stats.existingScenarioCount,
      existingDatasetCount: stats.existingDatasetCount,
      existingEvaluatorCount: stats.existingEvaluatorCount,
      addedScenarioCount: stats.addedScenarioCount,
      updatedScenarioCount: stats.updatedScenarioCount,
      unchangedScenarioCount: stats.unchangedScenarioCount,
      addedDatasetCount: stats.addedDatasetCount,
      updatedDatasetCount: stats.updatedDatasetCount,
      unchangedDatasetCount: stats.unchangedDatasetCount,
      addedEvaluatorCount: stats.addedEvaluatorCount,
      updatedEvaluatorCount: stats.updatedEvaluatorCount,
      unchangedEvaluatorCount: stats.unchangedEvaluatorCount,
      finalScenarioCount: normalizedScenarios.length,
      finalDatasetCount: normalizedDatasets.length,
      finalEvaluatorCount: normalizedEvaluators.length,
      conflictCount: conflicts.length,
      openConflictCount: conflicts.length,
      governance: {
        redactsSecretLikeKeys: true,
        excludesSecretValues: true,
        excludesHeaders: true,
        localWorkspaceFile: true,
      },
    },
    governance: {
      includesScenarioInputs: true,
      includesScenarioPayloads: true,
      redactsSecretLikeKeys: true,
      excludesSecretValues: true,
      excludesHeaders: true,
      localWorkspaceFile: true,
    },
  };
}

function buildMultiAgentSummary(scenarios: StudioScenarioItem[], datasets: StudioScenarioDatasetItem[]) {
  const agentIds = uniqueSorted(scenarios.map((scenario) => scenario.sourceContext.agentId).filter(Boolean));
  const runIds = uniqueSorted(
    scenarios.flatMap((scenario) => [scenario.sourceContext.primaryRunId, scenario.sourceContext.baselineRunId, scenario.sourceContext.candidateRunId]).filter(isString),
  );
  const sessionIds = uniqueSorted(scenarios.map((scenario) => scenario.sourceContext.sessionId).filter(isString));
  const sourceKinds = uniqueSorted(scenarios.map((scenario) => scenario.sourceContext.kind).filter(Boolean));
  const datasetScenarioIds = new Set(datasets.flatMap((dataset) => dataset.scenarioIds));
  return {
    agentIds,
    runIds,
    sessionIds,
    sourceKinds,
    datasetScenarioCoverage: scenarios.length ? Math.round((datasetScenarioIds.size / scenarios.length) * 100) : 0,
  };
}

function mergeStudioScenarioItemsWithConflicts<T extends StudioScenarioItem | StudioScenarioDatasetItem | StudioScenarioEvaluatorItem>(
  flowId: string,
  kind: StudioScenarioConflictKind,
  existing: T[],
  incoming: T[],
  maxItems: number,
  resolutionHistory: StudioScenarioResolutionRecord[],
  conflictSources: unknown[],
) {
  const byId = new Map<string, T>();
  for (const item of existing) {
    byId.set(item.id, item);
  }
  const conflicts: StudioScenarioConflict[] = [];
  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  for (const item of incoming) {
    const previous = byId.get(item.id);
    if (!previous) {
      byId.set(item.id, item);
      addedCount += 1;
      continue;
    }
    if (studioScenarioItemContentHash(kind, previous) === studioScenarioItemContentHash(kind, item)) {
      if (new Date(item.updatedAt).getTime() > new Date(previous.updatedAt).getTime()) {
        byId.set(item.id, item);
      }
      unchangedCount += 1;
      continue;
    }
    const resolved = resolveStudioScenarioMergeByHistory(kind, previous, item, resolutionHistory);
    if (resolved) {
      byId.set(item.id, resolved as T);
      if (studioScenarioItemContentHash(kind, resolved) !== studioScenarioItemContentHash(kind, previous)) {
        updatedCount += 1;
      } else {
        unchangedCount += 1;
      }
      continue;
    }
    const conflict = buildStudioScenarioConflict(flowId, kind, previous, item, conflictSources);
    conflicts.push(conflict);
    if (new Date(item.updatedAt).getTime() > new Date(previous.updatedAt).getTime()) {
      byId.set(item.id, item);
      updatedCount += 1;
    } else {
      unchangedCount += 1;
    }
  }
  return {
    items: Array.from(byId.values()).sort(compareUpdatedAt).slice(0, maxItems),
    addedCount,
    updatedCount,
    unchangedCount,
    conflicts,
  };
}

function resolveStudioScenarioMergeByHistory<T extends StudioScenarioItem | StudioScenarioDatasetItem | StudioScenarioEvaluatorItem>(
  kind: StudioScenarioConflictKind,
  existing: T,
  incoming: T,
  history: StudioScenarioResolutionRecord[],
): T | null {
  const existingRef = studioScenarioConflictRef(kind, existing);
  const incomingRef = studioScenarioConflictRef(kind, incoming);
  for (const record of history.filter((item) => item.kind === kind && item.itemId === existing.id)) {
    const existingKept = studioScenarioConflictRefsMatch(existingRef, record.keptRef);
    const incomingKept = studioScenarioConflictRefsMatch(incomingRef, record.keptRef);
    const existingDiscarded = record.discardedRefs.some((ref) => studioScenarioConflictRefsMatch(existingRef, ref));
    const incomingDiscarded = record.discardedRefs.some((ref) => studioScenarioConflictRefsMatch(incomingRef, ref));
    if (existingKept && incomingDiscarded) {
      return existing;
    }
    if (incomingKept && existingDiscarded) {
      return incoming;
    }
  }
  return null;
}

function buildStudioScenarioConflict<T extends StudioScenarioItem | StudioScenarioDatasetItem | StudioScenarioEvaluatorItem>(
  flowId: string,
  kind: StudioScenarioConflictKind,
  existing: T,
  incoming: T,
  conflictSources: unknown[] = [],
): StudioScenarioConflict {
  const conflictId = studioScenarioConflictId(flowId, kind, existing.id);
  const previous = conflictSources
    .map(normalizeStudioScenarioConflict)
    .find((item): item is StudioScenarioConflict => item !== null && item.conflictId === conflictId);
  const candidates = uniqueStudioScenarioConflictCandidates(kind, [
    ...(previous?.candidates ?? []),
    existing,
    incoming,
  ]);
  const sortedCandidates = candidates.sort(compareUpdatedAt);
  const latest = sortedCandidates[0];
  return {
    conflictId,
    status: "open",
    kind,
    itemId: existing.id,
    itemLabel: studioScenarioConflictItemLabel(kind, latest),
    candidateCount: sortedCandidates.length,
    latestUpdatedAt: latest.updatedAt,
    latestContentHash: studioScenarioItemContentHash(kind, latest),
    refs: sortedCandidates.map((candidate) => studioScenarioConflictRef(kind, candidate)),
    candidates: sortedCandidates,
    diff: buildStudioScenarioConflictDiff(kind, sortedCandidates),
    curationThread: previous?.curationThread ?? defaultStudioScenarioConflictCurationThread(),
    governance: {
      includesScenarioInputs: true,
      includesScenarioPayloads: true,
      redactsSecretLikeKeys: true,
      excludesSecretValues: true,
    },
  };
}

function buildStudioScenarioConflictReviewPackage(
  scenarios: StudioScenariosPackage,
): StudioScenariosConflictReviewPackage {
  return buildStudioScenarioConflictReviewPackageFromParts(
    scenarios.flowId,
    scenarios.conflicts.map(studioScenarioConflictReview),
    scenarios.resolutionHistory,
  );
}

function buildStudioScenarioConflictReviewPackageFromParts(
  flowId: string,
  conflicts: StudioScenarioConflictReview[],
  resolutionHistory: StudioScenarioResolutionRecord[],
  generatedAt = new Date().toISOString(),
): StudioScenariosConflictReviewPackage {
  const summary = {
    scenarioConflictCount: conflicts.filter((conflict) => conflict.kind === "scenario").length,
    datasetConflictCount: conflicts.filter((conflict) => conflict.kind === "dataset").length,
    evaluatorConflictCount: conflicts.filter((conflict) => conflict.kind === "evaluator").length,
    assignedConflictCount: conflicts.filter((conflict) => conflict.curationThread.status === "assigned").length,
    unassignedConflictCount: conflicts.filter((conflict) => conflict.curationThread.status === "unassigned").length,
    resolvedThreadCount: conflicts.filter((conflict) => conflict.curationThread.status === "resolved").length,
  };
  const packageHash = hashValue({
    flowId,
    conflictRefs: conflicts.map((conflict) => ({
      conflictId: conflict.conflictId,
      latestContentHash: conflict.latestContentHash,
      candidateContentHashes: conflict.candidateContentHashes,
      curationStatus: conflict.curationThread.status,
      curationAssignee: conflict.curationThread.assignee,
    })),
    resolutionIds: resolutionHistory.map((record) => record.resolutionId),
    summary,
  });
  return {
    format: STUDIO_SCENARIOS_CONFLICT_REVIEW_FORMAT,
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
      excludesRawScenarioInputs: true,
      excludesRawScenarioPayloads: true,
      redactsSecretLikeKeys: true,
      excludesSecretValues: true,
      includesOnlyRefsDiffsThreadsAndResolutionHistory: true,
      localWorkspaceFile: true,
    },
  };
}

function studioScenarioConflictReview(conflict: StudioScenarioConflict): StudioScenarioConflictReview {
  return {
    conflictId: conflict.conflictId,
    status: conflict.status,
    kind: conflict.kind,
    itemId: conflict.itemId,
    itemLabel: conflict.itemLabel,
    candidateCount: conflict.candidateCount,
    latestUpdatedAt: conflict.latestUpdatedAt,
    latestContentHash: conflict.latestContentHash,
    refs: conflict.refs,
    candidateContentHashes: conflict.refs.map((ref) => ref.contentHash),
    diff: conflict.diff,
    curationThread: conflict.curationThread,
    governance: {
      excludesCandidates: true,
      excludesRawScenarioInputs: true,
      excludesRawScenarioPayloads: true,
      redactsSecretLikeKeys: true,
      excludesSecretValues: true,
      includesOnlyRefsDiffsAndCuration: true,
    },
  };
}

function normalizeStudioScenariosConflictReviewPackage(
  value: unknown,
  fallbackFlowId: string,
): StudioScenariosConflictReviewPackage | null {
  if (!isRecord(value) || value.format !== STUDIO_SCENARIOS_CONFLICT_REVIEW_FORMAT) {
    return null;
  }
  if (containsRawStudioScenarioReviewPayload(value)) {
    return null;
  }
  const flowId = normalizeId(stringValue(value.flowId)) || fallbackFlowId;
  const generatedAt = normalizeDateString(value.generatedAt) ?? new Date().toISOString();
  const conflicts = Array.isArray(value.conflicts)
    ? value.conflicts
        .map(normalizeStudioScenarioConflictReview)
        .filter((conflict): conflict is StudioScenarioConflictReview => conflict !== null)
        .slice(0, 128)
    : [];
  const resolutionHistory = Array.isArray(value.resolutionHistory)
    ? normalizeStudioScenarioResolutionHistory(value.resolutionHistory).slice(0, 128)
    : [];
  return buildStudioScenarioConflictReviewPackageFromParts(flowId, conflicts, resolutionHistory, generatedAt);
}

function normalizeStudioScenarioConflictReview(value: unknown): StudioScenarioConflictReview | null {
  if (!isRecord(value) || value.candidates !== undefined) {
    return null;
  }
  const kind = normalizeStudioScenarioConflictKind(value.kind);
  const itemId = normalizeId(stringValue(value.itemId ?? value.id));
  if (!kind || !itemId) {
    return null;
  }
  const refs = Array.isArray(value.refs)
    ? value.refs.map(normalizeStudioScenarioConflictRef).filter((ref): ref is StudioScenarioConflictRef => ref !== null)
    : [];
  const latestRef = refs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
  const candidateContentHashes = uniqueSorted([
    ...stringArray(value.candidateContentHashes),
    ...refs.map((ref) => ref.contentHash),
  ]);
  if (!refs.length && !candidateContentHashes.length) {
    return null;
  }
  const latestContentHash = stringValue(value.latestContentHash) || latestRef?.contentHash || candidateContentHashes[0] || "";
  return {
    conflictId: normalizeId(stringValue(value.conflictId)) || `studio-scenario-conflict-${hashValue({ kind, itemId }).slice(0, 16)}`,
    status: "open",
    kind,
    itemId,
    itemLabel: stringValue(value.itemLabel) || latestRef?.label || itemId,
    candidateCount: positiveInteger(value.candidateCount, Math.max(refs.length, candidateContentHashes.length)),
    latestUpdatedAt: normalizeDateString(value.latestUpdatedAt) ?? latestRef?.updatedAt ?? new Date().toISOString(),
    latestContentHash,
    refs,
    candidateContentHashes,
    diff: normalizeStudioScenarioConflictDiff(value.diff, kind, []),
    curationThread: normalizeStudioScenarioConflictCurationThread(value.curationThread),
    governance: {
      excludesCandidates: true,
      excludesRawScenarioInputs: true,
      excludesRawScenarioPayloads: true,
      redactsSecretLikeKeys: true,
      excludesSecretValues: true,
      includesOnlyRefsDiffsAndCuration: true,
    },
  };
}

function containsRawStudioScenarioReviewPayload(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsRawStudioScenarioReviewPayload);
  }
  if (!isRecord(value)) {
    return false;
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === "candidates" || key === "scenarios" || key === "datasets" || key === "evaluators" || key === "input" || key === "payload") {
      return true;
    }
    if (containsRawStudioScenarioReviewPayload(item)) {
      return true;
    }
  }
  return false;
}

function buildStudioScenarioConflictReviewDiffPackage(
  current: StudioScenariosConflictReviewPackage,
  incoming: StudioScenariosConflictReviewPackage,
): Record<string, unknown> {
  const generatedAt = new Date().toISOString();
  const conflictSection = buildStudioScenarioConflictReviewConflictDiffSection(current.conflicts, incoming.conflicts);
  const resolutionSection = buildStudioScenarioConflictReviewResolutionDiffSection(current.resolutionHistory, incoming.resolutionHistory);
  const sections = [
    buildStudioScenarioConflictReviewSummaryDiffSection(current, incoming),
    conflictSection,
    resolutionSection,
  ];
  const changedSectionCount = sections.filter((section) => section.status !== "same").length;
  const conflictDelta = incoming.conflictCount - current.conflictCount;
  const resolutionDelta = incoming.resolutionHistoryCount - current.resolutionHistoryCount;
  const status = changedSectionCount || conflictDelta || resolutionDelta ? "changed" : "same";
  const base = {
    format: "agent-flow-builder.studio-scenarios-conflict-review-diff.v1",
    generatedAt,
    flowId: current.flowId,
    current: studioScenarioConflictReviewPackageRef(current),
    incoming: studioScenarioConflictReviewPackageRef(incoming),
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
      excludesRawScenarioInputs: true,
      excludesRawScenarioPayloads: true,
      redactsSecretLikeKeys: true,
      excludesSecretValues: true,
      includesOnlyRefsDiffsThreadsAndResolutionHistory: true,
      source: "studio-scenarios-conflict-review-diff",
    },
  };
  return {
    ...base,
    packageHash: hashValue(base),
  };
}

function studioScenarioConflictReviewPackageRef(packageValue: StudioScenariosConflictReviewPackage): Record<string, unknown> {
  return {
    generatedAt: packageValue.generatedAt,
    packageHash: packageValue.packageHash,
    conflictCount: packageValue.conflictCount,
    openConflictCount: packageValue.openConflictCount,
    resolutionHistoryCount: packageValue.resolutionHistoryCount,
    summary: packageValue.summary,
  };
}

function buildStudioScenarioConflictReviewSummaryDiffSection(
  current: StudioScenariosConflictReviewPackage,
  incoming: StudioScenariosConflictReviewPackage,
): StudioScenarioConflictReviewDiffSection {
  return buildStudioScenarioConflictReviewDiffSection("summary", "Resumo", [
    buildStudioScenarioConflictReviewCountItem("conflicts", "Conflitos", current.conflictCount, incoming.conflictCount),
    buildStudioScenarioConflictReviewCountItem("scenario-conflicts", "Cenários", current.summary.scenarioConflictCount, incoming.summary.scenarioConflictCount),
    buildStudioScenarioConflictReviewCountItem("dataset-conflicts", "Datasets", current.summary.datasetConflictCount, incoming.summary.datasetConflictCount),
    buildStudioScenarioConflictReviewCountItem("evaluator-conflicts", "Evaluators", current.summary.evaluatorConflictCount, incoming.summary.evaluatorConflictCount),
    buildStudioScenarioConflictReviewCountItem("assigned", "Atribuídos", current.summary.assignedConflictCount, incoming.summary.assignedConflictCount),
    buildStudioScenarioConflictReviewCountItem("unassigned", "Sem responsável", current.summary.unassignedConflictCount, incoming.summary.unassignedConflictCount),
    buildStudioScenarioConflictReviewCountItem("resolved-thread", "Threads resolvidas", current.summary.resolvedThreadCount, incoming.summary.resolvedThreadCount),
    buildStudioScenarioConflictReviewCountItem("resolutions", "Histórico de decisões", current.resolutionHistoryCount, incoming.resolutionHistoryCount),
  ]);
}

function buildStudioScenarioConflictReviewConflictDiffSection(
  current: StudioScenarioConflictReview[],
  incoming: StudioScenarioConflictReview[],
): StudioScenarioConflictReviewDiffSection {
  const currentById = new Map(current.map((conflict) => [conflict.conflictId, conflict] as const));
  const incomingById = new Map(incoming.map((conflict) => [conflict.conflictId, conflict] as const));
  const ids = uniqueSorted([...currentById.keys(), ...incomingById.keys()]);
  const items = ids.map((id) => {
    const left = currentById.get(id) ?? null;
    const right = incomingById.get(id) ?? null;
    const status = studioScenarioConflictReviewItemStatus(left, right);
    return {
      id,
      label: left?.itemLabel || right?.itemLabel || id,
      status,
      current: left ? studioScenarioConflictReviewItemSummary(left) : "-",
      incoming: right ? studioScenarioConflictReviewItemSummary(right) : "-",
      delta: status === "only_incoming" ? 1 : status === "only_current" ? -1 : 0,
    };
  });
  return buildStudioScenarioConflictReviewDiffSection("conflicts", "Conflitos", items);
}

function buildStudioScenarioConflictReviewResolutionDiffSection(
  current: StudioScenarioResolutionRecord[],
  incoming: StudioScenarioResolutionRecord[],
): StudioScenarioConflictReviewDiffSection {
  const currentById = new Map(current.map((record) => [record.resolutionId, record] as const));
  const incomingById = new Map(incoming.map((record) => [record.resolutionId, record] as const));
  const ids = uniqueSorted([...currentById.keys(), ...incomingById.keys()]);
  const items = ids.map((id) => {
    const left = currentById.get(id) ?? null;
    const right = incomingById.get(id) ?? null;
    const status = studioScenarioResolutionReviewItemStatus(left, right);
    return {
      id,
      label: left?.conflictId || right?.conflictId || id,
      status,
      current: left ? studioScenarioResolutionReviewItemSummary(left) : "-",
      incoming: right ? studioScenarioResolutionReviewItemSummary(right) : "-",
      delta: status === "only_incoming" ? 1 : status === "only_current" ? -1 : 0,
    };
  });
  return buildStudioScenarioConflictReviewDiffSection("resolution-history", "Histórico de decisões", items);
}

function buildStudioScenarioConflictReviewDiffSection(
  id: string,
  title: string,
  items: StudioScenarioConflictReviewDiffItem[],
): StudioScenarioConflictReviewDiffSection {
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

function buildStudioScenarioConflictReviewCountItem(
  id: string,
  label: string,
  current: number,
  incoming: number,
): StudioScenarioConflictReviewDiffItem {
  return {
    id,
    label,
    status: current === incoming ? "same" : "changed",
    current: String(current),
    incoming: String(incoming),
    delta: incoming - current,
  };
}

function studioScenarioConflictReviewItemStatus(
  current: StudioScenarioConflictReview | null,
  incoming: StudioScenarioConflictReview | null,
): StudioScenarioConflictReviewDiffItemStatus {
  if (!current) {
    return "only_incoming";
  }
  if (!incoming) {
    return "only_current";
  }
  return studioScenarioConflictReviewSignature(current) === studioScenarioConflictReviewSignature(incoming) ? "same" : "changed";
}

function studioScenarioResolutionReviewItemStatus(
  current: StudioScenarioResolutionRecord | null,
  incoming: StudioScenarioResolutionRecord | null,
): StudioScenarioConflictReviewDiffItemStatus {
  if (!current) {
    return "only_incoming";
  }
  if (!incoming) {
    return "only_current";
  }
  return hashValue(current) === hashValue(incoming) ? "same" : "changed";
}

function studioScenarioConflictReviewSignature(conflict: StudioScenarioConflictReview): string {
  return hashValue({
    kind: conflict.kind,
    itemId: conflict.itemId,
    candidateCount: conflict.candidateCount,
    latestContentHash: conflict.latestContentHash,
    refs: conflict.refs,
    candidateContentHashes: uniqueSorted(conflict.candidateContentHashes),
    diff: conflict.diff,
    curationThread: conflict.curationThread,
  });
}

function studioScenarioConflictReviewItemSummary(conflict: StudioScenarioConflictReview): string {
  return [
    conflict.kind,
    `${conflict.candidateCount} candidato(s)`,
    `hash ${conflict.latestContentHash.slice(0, 12)}`,
    `thread ${conflict.curationThread.status}`,
    conflict.curationThread.assignee ? `responsável ${conflict.curationThread.assignee}` : "",
  ].filter(Boolean).join(" · ");
}

function studioScenarioResolutionReviewItemSummary(record: StudioScenarioResolutionRecord): string {
  return [
    record.kind,
    `mantido ${record.keptRef.contentHash.slice(0, 12)}`,
    `${record.discardedRefs.length} descartado(s)`,
    `por ${record.resolvedBy}`,
    record.resolvedRole,
  ].join(" · ");
}

function formatSignedInteger(value: number): string {
  if (!Number.isFinite(value) || value === 0) {
    return "0";
  }
  return value > 0 ? `+${value}` : String(value);
}

function syncStudioScenarioConflicts(
  flowId: string,
  conflictSources: unknown[],
  resolutionHistory: StudioScenarioResolutionRecord[],
): StudioScenarioConflict[] {
  const byId = new Map<string, StudioScenarioConflict>();
  for (const source of conflictSources) {
    const conflict = normalizeStudioScenarioConflict(source);
    if (!conflict) {
      continue;
    }
    if (resolutionHistory.some((record) => record.conflictId === conflict.conflictId)) {
      continue;
    }
    const expectedConflictId = studioScenarioConflictId(flowId, conflict.kind, conflict.itemId);
    const normalizedConflict = {
      ...conflict,
      conflictId: expectedConflictId,
    };
    const current = byId.get(expectedConflictId);
    if (!current || normalizedConflict.latestUpdatedAt.localeCompare(current.latestUpdatedAt) >= 0) {
      byId.set(expectedConflictId, normalizedConflict);
    }
  }
  return Array.from(byId.values()).sort((left, right) => right.latestUpdatedAt.localeCompare(left.latestUpdatedAt)).slice(0, 128);
}

function normalizeStudioScenarioConflict(value: unknown): StudioScenarioConflict | null {
  if (!isRecord(value)) {
    return null;
  }
  const kind = normalizeStudioScenarioConflictKind(value.kind);
  const itemId = normalizeId(stringValue(value.itemId ?? value.id));
  if (!kind || !itemId) {
    return null;
  }
  const candidates = Array.isArray(value.candidates)
    ? uniqueStudioScenarioConflictCandidates(kind, value.candidates)
    : [];
  const refs = Array.isArray(value.refs)
    ? value.refs.map(normalizeStudioScenarioConflictRef).filter((ref): ref is StudioScenarioConflictRef => ref !== null)
    : candidates.map((candidate) => studioScenarioConflictRef(kind, candidate));
  if (!refs.length && !candidates.length) {
    return null;
  }
  const latestCandidate = candidates[0] ?? null;
  const latestRef = refs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  return {
    conflictId: normalizeId(stringValue(value.conflictId)) || `studio-scenario-conflict-${hashValue({ kind, itemId }).slice(0, 16)}`,
    status: "open",
    kind,
    itemId,
    itemLabel: stringValue(value.itemLabel) || latestRef?.label || (latestCandidate ? studioScenarioConflictItemLabel(kind, latestCandidate) : itemId),
    candidateCount: positiveInteger(value.candidateCount, Math.max(candidates.length, refs.length)),
    latestUpdatedAt: normalizeDateString(value.latestUpdatedAt) ?? latestRef?.updatedAt ?? latestCandidate?.updatedAt ?? new Date().toISOString(),
    latestContentHash: stringValue(value.latestContentHash) || latestRef?.contentHash || (latestCandidate ? studioScenarioItemContentHash(kind, latestCandidate) : ""),
    refs,
    candidates,
    diff: normalizeStudioScenarioConflictDiff(value.diff, kind, candidates),
    curationThread: normalizeStudioScenarioConflictCurationThread(value.curationThread),
    governance: {
      includesScenarioInputs: true,
      includesScenarioPayloads: true,
      redactsSecretLikeKeys: true,
      excludesSecretValues: true,
    },
  };
}

function uniqueStudioScenarioConflictCandidates(
  kind: StudioScenarioConflictKind,
  values: unknown[],
): Array<StudioScenarioItem | StudioScenarioDatasetItem | StudioScenarioEvaluatorItem> {
  const byHash = new Map<string, StudioScenarioItem | StudioScenarioDatasetItem | StudioScenarioEvaluatorItem>();
  for (const value of values) {
    const candidate =
      kind === "scenario"
        ? normalizeStudioScenarioItem(value)
        : kind === "dataset"
          ? normalizeStudioScenarioDatasetItem(value)
          : normalizeStudioScenarioEvaluatorItem(value);
    if (!candidate) {
      continue;
    }
    byHash.set(studioScenarioItemContentHash(kind, candidate), candidate);
  }
  return Array.from(byHash.values()).sort(compareUpdatedAt);
}

function replaceStudioScenarioItem<T extends StudioScenarioItem | StudioScenarioDatasetItem | StudioScenarioEvaluatorItem>(
  items: T[],
  selected: T,
  maxItems: number,
): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  byId.set(selected.id, selected);
  return Array.from(byId.values()).sort(compareUpdatedAt).slice(0, maxItems);
}

function studioScenarioConflictId(flowId: string, kind: StudioScenarioConflictKind, itemId: string): string {
  return `studio-scenario-conflict-${hashValue({ flowId, kind, itemId }).slice(0, 16)}`;
}

function studioScenarioConflictItemLabel(
  kind: StudioScenarioConflictKind,
  item: StudioScenarioItem | StudioScenarioDatasetItem | StudioScenarioEvaluatorItem,
): string {
  return kind === "scenario" ? (item as StudioScenarioItem).label : (item as StudioScenarioDatasetItem | StudioScenarioEvaluatorItem).name;
}

function studioScenarioConflictRef(
  kind: StudioScenarioConflictKind,
  item: StudioScenarioItem | StudioScenarioDatasetItem | StudioScenarioEvaluatorItem,
): StudioScenarioConflictRef {
  const scenario = kind === "scenario" ? item as StudioScenarioItem : null;
  const dataset = kind === "dataset" ? item as StudioScenarioDatasetItem : null;
  return {
    kind,
    id: item.id,
    label: studioScenarioConflictItemLabel(kind, item),
    updatedAt: item.updatedAt,
    contentHash: studioScenarioItemContentHash(kind, item),
    agentId: scenario?.sourceContext.agentId || null,
    primaryRunId: scenario?.sourceContext.primaryRunId ?? null,
    datasetScenarioCount: dataset ? dataset.scenarioIds.length : null,
  };
}

function normalizeStudioScenarioConflictRef(value: unknown): StudioScenarioConflictRef | null {
  if (!isRecord(value)) {
    return null;
  }
  const kind = normalizeStudioScenarioConflictKind(value.kind);
  const id = normalizeId(stringValue(value.id));
  const contentHash = stringValue(value.contentHash);
  const updatedAt = normalizeDateString(value.updatedAt);
  if (!kind || !id || !contentHash || !updatedAt) {
    return null;
  }
  return {
    kind,
    id,
    label: stringValue(value.label) || id,
    updatedAt,
    contentHash,
    agentId: nullableString(value.agentId),
    primaryRunId: nullableString(value.primaryRunId),
    datasetScenarioCount: value.datasetScenarioCount === null
      ? null
      : typeof value.datasetScenarioCount === "number" && Number.isFinite(value.datasetScenarioCount)
        ? Math.max(0, Math.round(value.datasetScenarioCount))
        : null,
  };
}

function studioScenarioConflictRefsMatch(left: StudioScenarioConflictRef, right: StudioScenarioConflictRef): boolean {
  return left.kind === right.kind && left.id === right.id && left.contentHash === right.contentHash;
}

function buildStudioScenarioConflictDiff(
  kind: StudioScenarioConflictKind,
  candidates: Array<StudioScenarioItem | StudioScenarioDatasetItem | StudioScenarioEvaluatorItem>,
): StudioScenarioConflictDiff {
  const candidateFields = candidates.map((candidate) => ({
    contentHash: studioScenarioItemContentHash(kind, candidate),
    fields: studioScenarioConflictComparableFields(kind, candidate),
  }));
  const fieldOrder = new Map<string, string>();
  for (const candidate of candidateFields) {
    for (const field of candidate.fields) {
      if (!fieldOrder.has(field.field)) {
        fieldOrder.set(field.field, field.label);
      }
    }
  }
  const fields: StudioScenarioConflictDiffField[] = [];
  for (const [field, label] of fieldOrder.entries()) {
    const values = candidateFields.map((candidate) => {
      const match = candidate.fields.find((item) => item.field === field);
      return {
        contentHash: candidate.contentHash,
        preview: match?.preview ?? "-",
      };
    });
    const uniquePreviewCount = new Set(values.map((value) => value.preview)).size;
    if (uniquePreviewCount <= 1) {
      continue;
    }
    fields.push({
      field,
      label,
      valueCount: uniquePreviewCount,
      values,
    });
  }
  return {
    changedFieldCount: fields.length,
    fields: fields.slice(0, 12),
    governance: {
      excludesRawScenarioPayloads: true,
      excludesRawScenarioInputs: true,
      redactsSecretLikeKeys: true,
      excludesSecretValues: true,
    },
  };
}

function normalizeStudioScenarioConflictDiff(
  value: unknown,
  kind: StudioScenarioConflictKind,
  candidates: Array<StudioScenarioItem | StudioScenarioDatasetItem | StudioScenarioEvaluatorItem>,
): StudioScenarioConflictDiff {
  if (candidates.length) {
    return buildStudioScenarioConflictDiff(kind, candidates);
  }
  const record = isRecord(value) ? value : {};
  const fields = Array.isArray(record.fields)
    ? record.fields.map(normalizeStudioScenarioConflictDiffField).filter((field): field is StudioScenarioConflictDiffField => field !== null).slice(0, 12)
    : [];
  return {
    changedFieldCount: positiveInteger(record.changedFieldCount, fields.length),
    fields,
    governance: {
      excludesRawScenarioPayloads: true,
      excludesRawScenarioInputs: true,
      redactsSecretLikeKeys: true,
      excludesSecretValues: true,
    },
  };
}

function normalizeStudioScenarioConflictDiffField(value: unknown): StudioScenarioConflictDiffField | null {
  if (!isRecord(value)) {
    return null;
  }
  const field = normalizeId(stringValue(value.field));
  if (!field) {
    return null;
  }
  const values = Array.isArray(value.values)
    ? value.values.map(normalizeStudioScenarioConflictDiffValue).filter((item): item is StudioScenarioConflictDiffValue => item !== null).slice(0, 8)
    : [];
  if (!values.length) {
    return null;
  }
  return {
    field,
    label: stringValue(value.label) || field,
    valueCount: positiveInteger(value.valueCount, new Set(values.map((item) => item.preview)).size),
    values,
  };
}

function normalizeStudioScenarioConflictDiffValue(value: unknown): StudioScenarioConflictDiffValue | null {
  if (!isRecord(value)) {
    return null;
  }
  const contentHash = stringValue(value.contentHash);
  if (!contentHash) {
    return null;
  }
  return {
    contentHash,
    preview: previewStudioScenarioConflictDiffValue(value.preview),
  };
}

function studioScenarioConflictComparableFields(
  kind: StudioScenarioConflictKind,
  item: StudioScenarioItem | StudioScenarioDatasetItem | StudioScenarioEvaluatorItem,
): Array<{ field: string; label: string; preview: string }> {
  if (kind === "scenario") {
    const scenario = item as StudioScenarioItem;
    return [
      { field: "label", label: "Rótulo", preview: previewStudioScenarioConflictDiffValue(scenario.label) },
      { field: "tags", label: "Tags", preview: previewStudioScenarioConflictDiffValue(scenario.tags.join(", ") || "-") },
      { field: "inputHash", label: "Input", preview: hashedPreview(scenario.input, `${scenario.input.length} caractere(s)`) },
      { field: "payloadHash", label: "Payload", preview: hashedPreview(scenario.payload, "payload sanitizado") },
      { field: "sourceContext", label: "Origem", preview: studioScenarioSourceContextPreview(scenario) },
      { field: "expectedOutput", label: "Saída esperada", preview: hashedPreview(scenario.expectedOutputText, "critério textual") },
      { field: "expectedMode", label: "Modo de avaliação", preview: previewStudioScenarioConflictDiffValue({
        matchMode: scenario.expectedOutputMatchMode,
        caseSensitive: scenario.expectedOutputCaseSensitive,
      }) },
      { field: "evaluator", label: "Evaluator", preview: studioScenarioEvaluatorPreview(scenario) },
      { field: "nodePins", label: "Pins de nó", preview: scenario.useNodePins === true ? "ativo" : "inativo" },
      { field: "regressionThresholds", label: "Thresholds", preview: hashedPreview(scenario.regressionThresholds, "thresholds") },
    ];
  }
  if (kind === "evaluator") {
    const evaluator = item as StudioScenarioEvaluatorItem;
    return [
      { field: "name", label: "Nome", preview: previewStudioScenarioConflictDiffValue(evaluator.name) },
      { field: "descriptionHash", label: "Descrição", preview: hashedPreview(evaluator.description, `${evaluator.description.length} caractere(s)`) },
      { field: "kind", label: "Tipo", preview: previewStudioScenarioConflictDiffValue(evaluator.kind) },
      { field: "operator", label: "Operador", preview: previewStudioScenarioConflictDiffValue(evaluator.operator) },
      { field: "expectedTextHash", label: "Texto esperado", preview: hashedPreview(evaluator.expectedText, `${evaluator.expectedText.length} caractere(s)`) },
      { field: "matchMode", label: "Modo", preview: previewStudioScenarioConflictDiffValue(evaluator.matchMode) },
      { field: "caseSensitive", label: "Case sensitive", preview: evaluator.caseSensitive ? "sim" : "não" },
      { field: "rules", label: "Regras", preview: hashedPreview(evaluator.rules, `${evaluator.rules.length} regra(s)`) },
      { field: "external", label: "Config externo", preview: studioScenarioEvaluatorExternalPreview(evaluator.external) },
    ];
  }
  const dataset = item as StudioScenarioDatasetItem;
  return [
    { field: "name", label: "Nome", preview: previewStudioScenarioConflictDiffValue(dataset.name) },
    { field: "descriptionHash", label: "Descrição", preview: hashedPreview(dataset.description, `${dataset.description.length} caractere(s)`) },
    { field: "tags", label: "Tags", preview: previewStudioScenarioConflictDiffValue(dataset.tags.join(", ") || "-") },
    { field: "scenarioCount", label: "Cenários", preview: `${dataset.scenarioIds.length} cenário(s)` },
    { field: "scenarioIdsHash", label: "Lista de cenários", preview: hashedPreview(dataset.scenarioIds, `${dataset.scenarioIds.length} id(s)`) },
    { field: "version", label: "Versão", preview: String(dataset.version) },
    { field: "runHistory", label: "Histórico de runs", preview: hashedPreview(dataset.runHistory, `${dataset.runHistory.length} run(s)`) },
    { field: "lastRunAt", label: "Última execução", preview: dataset.lastRunAt ?? "-" },
  ];
}

function studioScenarioSourceContextPreview(scenario: StudioScenarioItem): string {
  return [
    `tipo ${scenario.sourceContext.kind || "-"}`,
    `agente ${scenario.sourceContext.agentId || "-"}`,
    `nó ${scenario.sourceContext.nodeId || "-"}`,
    `run ${scenario.sourceContext.primaryRunId || "-"}`,
  ].join(" · ");
}

function studioScenarioEvaluatorPreview(scenario: StudioScenarioItem): string {
  const record = isRecord(scenario.evaluator) ? scenario.evaluator : {};
  const parts = [
    stringValue(scenario.evaluatorName ?? record.name),
    stringValue(scenario.evaluatorId ?? record.id),
    stringValue(scenario.evaluatorKind ?? record.kind),
    stringValue(scenario.evaluatorOperator ?? record.operator),
  ].filter(Boolean);
  return parts.length ? previewStudioScenarioConflictDiffValue(parts.join(" · ")) : "-";
}

function studioScenarioEvaluatorExternalPreview(value: unknown): string {
  const external = redactSecretLikeKeys(value);
  const record = isRecord(external) ? external : {};
  const endpointConfigured = stringValue(record.endpointUrl).trim() ? "endpoint configurado" : "sem endpoint";
  const timeout = typeof record.timeoutMs === "number" && Number.isFinite(record.timeoutMs) ? `${Math.round(record.timeoutMs)}ms` : "timeout padrão";
  const minScore = typeof record.minScore === "number" && Number.isFinite(record.minScore) ? `score ${record.minScore}` : "sem score mínimo";
  return `${endpointConfigured} · ${timeout} · ${minScore} · hash ${hashValue(external).slice(0, 12)}`;
}

function hashedPreview(value: unknown, label: string): string {
  const sanitized = redactSecretLikeKeys(value);
  return `${label} · hash ${hashValue(sanitized).slice(0, 12)}`;
}

function previewStudioScenarioConflictDiffValue(value: unknown): string {
  const sanitized = redactSecretLikeKeys(value);
  let preview: string;
  if (typeof sanitized === "string") {
    preview = sanitized.trim() || "-";
  } else if (typeof sanitized === "number" || typeof sanitized === "boolean") {
    preview = String(sanitized);
  } else if (sanitized === null || sanitized === undefined) {
    preview = "-";
  } else {
    preview = stableStringify(sanitized);
  }
  return preview.length > 96 ? `${preview.slice(0, 93)}...` : preview;
}

function studioScenarioItemContentHash(
  kind: StudioScenarioConflictKind,
  item: StudioScenarioItem | StudioScenarioDatasetItem | StudioScenarioEvaluatorItem,
): string {
  if (kind === "scenario") {
    const scenario = item as StudioScenarioItem;
    return hashValue({
      id: scenario.id,
      label: scenario.label,
      input: scenario.input,
      payload: scenario.payload,
      tags: scenario.tags,
      sourceContext: scenario.sourceContext,
      expectedOutputText: scenario.expectedOutputText,
      expectedOutputMatchMode: scenario.expectedOutputMatchMode,
      expectedOutputCaseSensitive: scenario.expectedOutputCaseSensitive,
      evaluator: scenario.evaluator,
      regressionThresholds: scenario.regressionThresholds,
      useNodePins: scenario.useNodePins,
    });
  }
  const dataset = item as StudioScenarioDatasetItem;
  if (kind === "evaluator") {
    const evaluator = item as StudioScenarioEvaluatorItem;
    return hashValue({
      id: evaluator.id,
      name: evaluator.name,
      description: evaluator.description,
      kind: evaluator.kind,
      operator: evaluator.operator,
      expectedText: evaluator.expectedText,
      matchMode: evaluator.matchMode,
      caseSensitive: evaluator.caseSensitive,
      rules: evaluator.rules,
      external: evaluator.external,
    });
  }
  return hashValue({
    id: dataset.id,
    name: dataset.name,
    description: dataset.description,
    scenarioIds: dataset.scenarioIds,
    tags: dataset.tags,
    version: dataset.version,
    runHistory: dataset.runHistory,
  });
}

function buildStudioScenarioResolutionRecord(
  conflict: StudioScenarioConflict,
  selected: StudioScenarioItem | StudioScenarioDatasetItem | StudioScenarioEvaluatorItem,
  resolvedBy: string,
  resolvedRole: StudioScenarioConflictCuratorRole,
  resolutionNote: string,
): StudioScenarioResolutionRecord {
  const resolvedAt = new Date().toISOString();
  const keptRef = studioScenarioConflictRef(conflict.kind, selected);
  const discardedRefs = conflict.refs.filter((ref) => !studioScenarioConflictRefsMatch(ref, keptRef));
  return {
    resolutionId: `studio-scenario-resolution-${hashValue({
      conflictId: conflict.conflictId,
      keptRef,
      discardedRefs,
      resolvedAt,
      resolvedBy,
      resolvedRole,
    }).slice(0, 16)}`,
    conflictId: conflict.conflictId,
    kind: conflict.kind,
    itemId: conflict.itemId,
    resolvedAt,
    resolvedBy,
    resolvedRole,
    resolutionNote,
    keptRef,
    discardedRefs,
    candidateCount: conflict.candidateCount,
    governance: {
      excludesRawScenarioPayloads: true,
      redactsSecretLikeKeys: true,
      excludesSecretValues: true,
    },
  };
}

function normalizeStudioScenarioResolutionHistory(value: unknown[]): StudioScenarioResolutionRecord[] {
  const byId = new Map<string, StudioScenarioResolutionRecord>();
  for (const record of value.map(normalizeStudioScenarioResolutionRecord).filter((item): item is StudioScenarioResolutionRecord => item !== null)) {
    const current = byId.get(record.resolutionId);
    if (!current || record.resolvedAt.localeCompare(current.resolvedAt) >= 0) {
      byId.set(record.resolutionId, record);
    }
  }
  return Array.from(byId.values()).sort((left, right) => right.resolvedAt.localeCompare(left.resolvedAt));
}

function normalizeStudioScenarioResolutionRecord(value: unknown): StudioScenarioResolutionRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const kind = normalizeStudioScenarioConflictKind(value.kind);
  const itemId = normalizeId(stringValue(value.itemId));
  const resolvedAt = normalizeDateString(value.resolvedAt);
  const keptRef = normalizeStudioScenarioConflictRef(value.keptRef);
  if (!kind || !itemId || !resolvedAt || !keptRef) {
    return null;
  }
  const discardedRefs = Array.isArray(value.discardedRefs)
    ? value.discardedRefs
        .map(normalizeStudioScenarioConflictRef)
        .filter((ref): ref is StudioScenarioConflictRef => ref !== null)
    : [];
  const conflictId = normalizeId(stringValue(value.conflictId)) || `studio-scenario-conflict-${hashValue({ kind, itemId }).slice(0, 16)}`;
  return {
    resolutionId: normalizeId(stringValue(value.resolutionId)) ||
      `studio-scenario-resolution-${hashValue({ conflictId, keptRef, discardedRefs, resolvedAt }).slice(0, 16)}`,
    conflictId,
    kind,
    itemId,
    resolvedAt,
    resolvedBy: normalizeActor(stringValue(value.resolvedBy)),
    resolvedRole: normalizeStudioScenarioConflictCuratorRole(value.resolvedRole ?? value.role),
    resolutionNote: normalizeResolutionNote(stringValue(value.resolutionNote)),
    keptRef,
    discardedRefs,
    candidateCount: positiveInteger(value.candidateCount, discardedRefs.length + 1),
    governance: {
      excludesRawScenarioPayloads: true,
      redactsSecretLikeKeys: true,
      excludesSecretValues: true,
    },
  };
}

function mergeStudioScenarioResolutionHistory(
  existing: unknown[],
  incoming: unknown[],
): StudioScenarioResolutionRecord[] {
  return normalizeStudioScenarioResolutionHistory([...existing, ...incoming]);
}

function mergeStudioScenarioConflictCurationThreads(
  existing: unknown[],
  incoming: unknown[],
): StudioScenarioConflict[] {
  const byId = new Map<string, StudioScenarioConflict>();
  for (const conflict of [...existing, ...incoming].map(normalizeStudioScenarioConflict).filter((item): item is StudioScenarioConflict => item !== null)) {
    const current = byId.get(conflict.conflictId);
    if (!current || compareNullableDateStrings(conflict.curationThread.updatedAt, current.curationThread.updatedAt) >= 0) {
      const events = current
        ? mergeStudioScenarioConflictCurationEvents(current.curationThread.events, conflict.curationThread.events)
        : conflict.curationThread.events;
      byId.set(conflict.conflictId, {
        ...conflict,
        curationThread: {
          ...conflict.curationThread,
          events,
        },
      });
    }
  }
  return Array.from(byId.values());
}

function normalizeStudioScenarioConflictKind(value: unknown): StudioScenarioConflictKind | null {
  return value === "scenario" || value === "dataset" || value === "evaluator" ? value : null;
}

function normalizeStudioScenarioConflictCurationAction(value: unknown): StudioScenarioConflictCurationAction | null {
  return value === "assign" || value === "release" ? value : null;
}

function normalizeStudioScenarioConflictCuratorRole(value: unknown): StudioScenarioConflictCuratorRole {
  return value === "owner" || value === "viewer" ? value : "reviewer";
}

function assertStudioScenarioConflictMutationAllowed(role: StudioScenarioConflictCuratorRole, action: string): void {
  if (role !== "viewer") {
    return;
  }
  throw new WorkspaceError(`Viewer nao pode ${action}.`, 403, {
    code: "studio_scenario_conflict_viewer_forbidden",
    role,
    requiredRole: "reviewer",
  });
}

function defaultStudioScenarioConflictCurationThread(): StudioScenarioConflictCurationThread {
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
      excludesRawScenarioPayloads: true,
      redactsSecretLikeKeys: true,
      excludesSecretValues: true,
      autoReleasesExpiredAssignments: true,
      configuredLeaseHoursEnv: STUDIO_SCENARIO_CONFLICT_CURATION_LEASE_HOURS_ENV,
    },
  };
}

function normalizeStudioScenarioConflictCurationThread(value: unknown): StudioScenarioConflictCurationThread {
  if (!isRecord(value)) {
    return defaultStudioScenarioConflictCurationThread();
  }
  const assignee = normalizeNullableActor(stringValue(value.assignee));
  const status = normalizeStudioScenarioConflictCurationStatus(value.status) ?? (assignee ? "assigned" : "unassigned");
  const updatedAt = normalizeDateString(value.updatedAt);
  const leaseDurationHours = normalizeStudioScenarioCurationLeaseHours(value.leaseDurationHours);
  const leaseExpiresAt =
    status === "assigned"
      ? normalizeDateString(value.leaseExpiresAt) ?? (updatedAt ? addHoursIso(updatedAt, leaseDurationHours) : null)
      : null;
  const normalized: StudioScenarioConflictCurationThread = {
    status,
    assignee: status === "unassigned" ? "" : assignee,
    openedAt: normalizeDateString(value.openedAt),
    updatedAt,
    lastActor: normalizeNullableActor(stringValue(value.lastActor)),
    lastAction: normalizeStudioScenarioConflictCurationLastAction(value.lastAction),
    note: normalizeResolutionNote(stringValue(value.note)),
    leaseExpiresAt,
    leaseDurationHours: status === "assigned" ? leaseDurationHours : null,
    leaseExpired: status !== "assigned" && value.leaseExpired === true,
    events: Array.isArray(value.events)
      ? value.events
          .map(normalizeStudioScenarioConflictCurationEvent)
          .filter((event): event is StudioScenarioConflictCurationEvent => event !== null)
          .sort((left, right) => right.at.localeCompare(left.at))
          .slice(0, 12)
      : [],
    governance: {
      excludesRawScenarioPayloads: true,
      redactsSecretLikeKeys: true,
      excludesSecretValues: true,
      autoReleasesExpiredAssignments: true,
      configuredLeaseHoursEnv: STUDIO_SCENARIO_CONFLICT_CURATION_LEASE_HOURS_ENV,
    },
  };
  return expireStudioScenarioConflictCurationThreadIfNeeded(normalized);
}

function normalizeStudioScenarioConflictCurationStatus(value: unknown): StudioScenarioConflictCurationStatus | null {
  return value === "unassigned" || value === "assigned" || value === "resolved" ? value : null;
}

function normalizeStudioScenarioConflictCurationLastAction(
  value: unknown,
): StudioScenarioConflictCurationLastAction | null {
  return value === "assign" || value === "release" || value === "resolve" || value === "lease_expired" ? value : null;
}

function normalizeStudioScenarioConflictCurationEvent(value: unknown): StudioScenarioConflictCurationEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  const at = normalizeDateString(value.at);
  const action = normalizeStudioScenarioConflictCurationLastAction(value.action);
  if (!at || !action) {
    return null;
  }
  return {
    id: normalizeId(stringValue(value.id)) || `studio-scenario-curation-${hashValue({ at, action, actor: value.actor }).slice(0, 16)}`,
    at,
    actor: normalizeActor(stringValue(value.actor)),
    action,
    assignee: normalizeNullableActor(stringValue(value.assignee)),
    role: normalizeStudioScenarioConflictCuratorRole(value.role),
    note: normalizeResolutionNote(stringValue(value.note)),
  };
}

function updateStudioScenarioConflictCurationThread(
  thread: StudioScenarioConflictCurationThread,
  action: StudioScenarioConflictCurationAction,
  actor: string,
  role: StudioScenarioConflictCuratorRole,
  note: string,
  at: string,
): StudioScenarioConflictCurationThread {
  const normalized = normalizeStudioScenarioConflictCurationThread(thread);
  const nextAssignee = action === "assign" ? actor : "";
  const event = buildStudioScenarioConflictCurationEvent(action, actor, nextAssignee, role, note, at);
  const leaseDurationHours = action === "assign" ? readStudioScenarioCurationLeaseHours() : null;
  return {
    ...normalized,
    status: action === "assign" ? "assigned" : "unassigned",
    assignee: nextAssignee,
    openedAt: normalized.openedAt ?? at,
    updatedAt: at,
    lastActor: actor,
    lastAction: action,
    note: note || normalized.note,
    leaseExpiresAt: action === "assign" && leaseDurationHours !== null ? addHoursIso(at, leaseDurationHours) : null,
    leaseDurationHours,
    leaseExpired: false,
    events: mergeStudioScenarioConflictCurationEvents([event], normalized.events),
  };
}

function resolveStudioScenarioConflictCurationThread(
  thread: StudioScenarioConflictCurationThread,
  actor: string,
  role: StudioScenarioConflictCuratorRole,
  note: string,
  at: string,
): StudioScenarioConflictCurationThread {
  const normalized = normalizeStudioScenarioConflictCurationThread(thread);
  const event = buildStudioScenarioConflictCurationEvent("resolve", actor, normalized.assignee || actor, role, note || normalized.note, at);
  return {
    ...normalized,
    status: "resolved",
    assignee: normalized.assignee || actor,
    openedAt: normalized.openedAt ?? at,
    updatedAt: at,
    lastActor: actor,
    lastAction: "resolve",
    note: note || normalized.note,
    leaseExpiresAt: null,
    leaseDurationHours: null,
    leaseExpired: false,
    events: mergeStudioScenarioConflictCurationEvents([event], normalized.events),
  };
}

function expireStudioScenarioConflictCurationThreadIfNeeded(
  thread: StudioScenarioConflictCurationThread,
  now = new Date(),
): StudioScenarioConflictCurationThread {
  if (thread.status !== "assigned" || !thread.leaseExpiresAt) {
    return thread;
  }
  const expiresAt = Date.parse(thread.leaseExpiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt > now.getTime()) {
    return thread;
  }
  const expiredAt = new Date(Math.max(expiresAt, Date.parse(thread.updatedAt ?? "") || expiresAt)).toISOString();
  const actor = thread.assignee || thread.lastActor || "local-studio";
  const event = buildStudioScenarioConflictCurationEvent(
    "lease_expired",
    actor,
    "",
    "reviewer",
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
    note: "Lease de curadoria expirado; conflito liberado automaticamente.",
    leaseExpiresAt: null,
    leaseExpired: true,
    events: mergeStudioScenarioConflictCurationEvents([event], thread.events),
  };
}

function readStudioScenarioCurationLeaseHours(): number {
  return normalizeStudioScenarioCurationLeaseHours(process.env[STUDIO_SCENARIO_CONFLICT_CURATION_LEASE_HOURS_ENV]);
}

function normalizeStudioScenarioCurationLeaseHours(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) {
    return STUDIO_SCENARIO_CONFLICT_CURATION_LEASE_HOURS;
  }
  return Math.min(Math.max(parsed, 1 / 60), 24 * 30);
}

function addHoursIso(value: string, hours: number): string {
  const base = Date.parse(value);
  const timestamp = Number.isFinite(base) ? base : Date.now();
  return new Date(timestamp + hours * 60 * 60 * 1000).toISOString();
}

function buildStudioScenarioConflictCurationEvent(
  action: StudioScenarioConflictCurationLastAction,
  actor: string,
  assignee: string,
  role: StudioScenarioConflictCuratorRole,
  note: string,
  at: string,
): StudioScenarioConflictCurationEvent {
  return {
    id: `studio-scenario-curation-${hashValue({ action, actor, assignee, role, note, at }).slice(0, 16)}`,
    at,
    actor,
    action,
    assignee,
    role,
    note,
  };
}

function mergeStudioScenarioConflictCurationEvents(
  existing: StudioScenarioConflictCurationEvent[],
  incoming: StudioScenarioConflictCurationEvent[],
): StudioScenarioConflictCurationEvent[] {
  const byId = new Map<string, StudioScenarioConflictCurationEvent>();
  for (const event of [...existing, ...incoming]) {
    byId.set(event.id, event);
  }
  return Array.from(byId.values()).sort((left, right) => right.at.localeCompare(left.at)).slice(0, 12);
}

async function writeStudioScenariosPackage(flowRoot: string, payload: StudioScenariosPackage): Promise<void> {
  const target = studioScenariosPath(flowRoot);
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  await rename(temp, target);
}

function readStudioScenariosCentralSyncConfig(): StudioScenariosCentralSyncConfig {
  const rawUrl = process.env[STUDIO_SCENARIOS_CENTRAL_URL_ENV]?.trim() ?? "";
  const rawTimeout = Number(process.env[STUDIO_SCENARIOS_CENTRAL_TIMEOUT_ENV] ?? STUDIO_SCENARIOS_CENTRAL_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(rawTimeout) ? Math.min(60_000, Math.max(500, Math.round(rawTimeout))) : STUDIO_SCENARIOS_CENTRAL_TIMEOUT_MS;
  let invalidReason: string | null = null;
  let url: string | null = rawUrl || null;
  if (url) {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        invalidReason = "Central de cenarios precisa usar http(s).";
        url = null;
      }
    } catch {
      invalidReason = "URL central de cenarios invalida.";
      url = null;
    }
  }
  return {
    url,
    token: process.env[STUDIO_SCENARIOS_CENTRAL_TOKEN_ENV]?.trim() || null,
    timeoutMs,
    invalidReason,
  };
}

function centralGovernance() {
  return {
    includesScenarioInputs: true,
    includesScenarioPayloads: true,
    redactsSecretLikeKeys: true,
    excludesSecretValues: true,
    excludesHeaders: true,
    centralAuthTokenInHeaderOnly: true,
    centralAuthTokenInBody: false,
    storesCentralToken: false,
    configuredUrlEnv: STUDIO_SCENARIOS_CENTRAL_URL_ENV,
    configuredTokenEnv: STUDIO_SCENARIOS_CENTRAL_TOKEN_ENV,
    configuredTimeoutEnv: STUDIO_SCENARIOS_CENTRAL_TIMEOUT_ENV,
    maxPayloadBytes: STUDIO_SCENARIOS_CENTRAL_MAX_BYTES,
  } as const;
}

function studioScenariosPath(flowRoot: string): string {
  return path.join(flowRoot, STUDIO_SCENARIOS_FILE);
}

function redactSecretLikeKeys(value: unknown): any {
  if (Array.isArray(value)) {
    return value.map(redactSecretLikeKeys);
  }
  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (isSecretLikeKey(key)) {
        result[key] = REDACTED_VALUE;
      } else {
        result[key] = redactSecretLikeKeys(item);
      }
    }
    return result;
  }
  return value;
}

function isSecretLikeKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return ["api_key", "apikey", "authorization", "password", "secret", "token", "headers"].some((part) => normalized.includes(part));
}

function uniqueById<T extends { id: string; updatedAt: string }>(items: Array<T | null>, maxItems: number): T[] {
  const byId = new Map<string, T>();
  for (const item of items) {
    if (!item) {
      continue;
    }
    const existing = byId.get(item.id);
    if (!existing || new Date(item.updatedAt).getTime() >= new Date(existing.updatedAt).getTime()) {
      byId.set(item.id, item);
    }
  }
  return Array.from(byId.values()).sort(compareUpdatedAt).slice(0, maxItems);
}

function compareUpdatedAt<T extends { id: string; updatedAt: string }>(left: T, right: T): number {
  const leftTime = new Date(left.updatedAt).getTime();
  const rightTime = new Date(right.updatedAt).getTime();
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  return left.id.localeCompare(right.id);
}

function emptyStats(): StudioScenariosMergeStats {
  return {
    incomingScenarioCount: 0,
    incomingDatasetCount: 0,
    incomingEvaluatorCount: 0,
    existingScenarioCount: 0,
    existingDatasetCount: 0,
    existingEvaluatorCount: 0,
    addedScenarioCount: 0,
    updatedScenarioCount: 0,
    unchangedScenarioCount: 0,
    addedDatasetCount: 0,
    updatedDatasetCount: 0,
    unchangedDatasetCount: 0,
    addedEvaluatorCount: 0,
    updatedEvaluatorCount: 0,
    unchangedEvaluatorCount: 0,
    finalScenarioCount: 0,
    finalDatasetCount: 0,
    finalEvaluatorCount: 0,
  };
}

function hashValue(value: unknown): string {
  return createHash("sha256").update(stableStringify(value) ?? "undefined").digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeId(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_.:-]/g, "-").replace(/-+/g, "-").slice(0, 120);
}

function normalizeActor(value: string): string {
  return normalizeNullableActor(value) || "local-studio";
}

function normalizeNullableActor(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 80);
}

function normalizeResolutionNote(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 240);
}

function normalizeDateString(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function compareNullableDateStrings(left: string | null, right: string | null): number {
  if (!left && !right) {
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter(isString).map((item) => item.trim()))).sort((left, right) => left.localeCompare(right))
    : [];
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function isFileNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
