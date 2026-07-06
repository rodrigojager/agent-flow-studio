import { createHash } from "node:crypto";
import {
  loadStudioAnnotationQueueConflictReview,
} from "./annotation-queue.ts";
import {
  loadDebugLayerSnapshotConflictReview,
} from "./debug-layer-snapshots.ts";
import {
  loadReplayGovernanceHistoryConflictReview,
} from "./replay-governance-history.ts";
import {
  loadSchemaPatternConflictReview,
} from "./schema-patterns.ts";
import {
  loadStudioNodePinConflictReview,
} from "./studio-node-pins.ts";
import {
  loadStudioScenarioConflictReview,
} from "./studio-scenarios.ts";
import {
  listFlows,
  loadSharedLocalCatalogConflictReview,
  WorkspaceError,
  type FlowSummary,
} from "./workspace.ts";
import {
  loadWorkspaceGovernance,
} from "./workspace-governance.ts";

type CollaborationConflictScope = "workspace" | "flow";
type CollaborationConflictSeverity = "clear" | "attention" | "blocked" | "error";
const UNASSIGNED_FILTER_VALUE = "__unassigned";
const MISSING_ROLE_FILTER_VALUE = "__missing";

interface CollaborationConflictFilters {
  flowId: string | null;
  area: string | null;
  severity: CollaborationConflictSeverity | null;
  responsible: string | null;
  role: string | null;
  status: string | null;
}

interface CollaborationConflictAreaDefinition {
  id: string;
  label: string;
  scope: CollaborationConflictScope;
  governanceArea: string;
  flowId: string | null;
  reviewPath: string;
  sourceActions: CollaborationConflictSourceActions;
}

interface CollaborationConflictSourceActions {
  reviewPath: string;
  diffPath: string | null;
  curationPathTemplate: string | null;
  resolvePathTemplate: string | null;
  viewerMutationBlocked: true;
}

interface CollaborationConflictAreaSummary extends CollaborationConflictAreaDefinition {
  severity: CollaborationConflictSeverity;
  conflictCount: number;
  openConflictCount: number;
  assignedConflictCount: number;
  unassignedConflictCount: number;
  expiredLeaseCount: number;
  resolutionHistoryCount: number;
  latestDecision: CollaborationConflictDecision | null;
  loadError: string | null;
}

interface CollaborationConflictDecision {
  decidedAt: string | null;
  decidedBy: string;
  decision: string;
}

interface CollaborationConflictItem {
  areaId: string;
  areaLabel: string;
  governanceArea: string;
  scope: CollaborationConflictScope;
  flowId: string | null;
  conflictId: string;
  status: string;
  subject: string;
  responsible: string;
  role: string;
  severity: CollaborationConflictSeverity;
  openedAt: string | null;
  updatedAt: string | null;
  leaseExpiresAt: string | null;
  leaseExpired: boolean;
  lastAction: string;
  latestDecision: CollaborationConflictDecision | null;
  sourceActions: CollaborationConflictSourceActions;
}

interface CollaborationConflictFilteredTotals {
  conflictCount: number;
  openConflictCount: number;
  assignedConflictCount: number;
  unassignedConflictCount: number;
  expiredLeaseCount: number;
}

interface CollaborationConflictTotals {
  areaCount: number;
  flowCount: number;
  conflictCount: number;
  openConflictCount: number;
  assignedConflictCount: number;
  unassignedConflictCount: number;
  expiredLeaseCount: number;
  resolutionHistoryCount: number;
  blockedAreaCount: number;
  errorAreaCount: number;
}

interface CollaborationConflictFilterOption {
  value: string;
  label: string;
  count: number;
}

interface CollaborationConflictAreaFilterOption extends CollaborationConflictFilterOption {
  governanceArea: string;
  flowId: string | null;
  openConflictCount: number;
}

interface CollaborationConflictFilterOptions {
  areas: CollaborationConflictAreaFilterOption[];
  severities: CollaborationConflictFilterOption[];
  responsible: CollaborationConflictFilterOption[];
  roles: CollaborationConflictFilterOption[];
  statuses: CollaborationConflictFilterOption[];
}

export interface CollaborationConflictOverview {
  format: "agent-flow-builder.collaboration-conflict-overview.v1";
  generatedAt: string;
  scope: {
    flowId: string | null;
    includedFlowIds: string[];
  };
  filters: CollaborationConflictFilters;
  totals: CollaborationConflictTotals;
  filteredTotals: CollaborationConflictFilteredTotals;
  filterOptions: CollaborationConflictFilterOptions;
  areas: CollaborationConflictAreaSummary[];
  conflicts: CollaborationConflictItem[];
  packageHash: string;
  governance: {
    usesGovernedConflictReviewsOnly: true;
    excludesRawSchemas: true;
    excludesRawPrompts: true;
    excludesRawInputOutput: true;
    excludesHeaders: true;
    excludesTokens: true;
    excludesPayloads: true;
    excludesSecretValues: true;
    viewerMutationBlockedBySourceRoutes: true;
    localWorkspaceOnly: true;
  };
}

type CollaborationConflictOverviewDiffStatus = "unchanged" | "changed" | "added" | "removed";

interface CollaborationConflictOverviewDiffEntry {
  id: string;
  label: string;
  status: CollaborationConflictOverviewDiffStatus;
  currentHash: string | null;
  comparedHash: string | null;
  detail: string;
}

interface CollaborationConflictOverviewDiffSection {
  id: string;
  label: string;
  status: "unchanged" | "changed";
  currentCount: number;
  comparedCount: number;
  changedCount: number;
  entries: CollaborationConflictOverviewDiffEntry[];
}

export interface CollaborationConflictOverviewDiffPackage {
  format: "agent-flow-builder.collaboration-conflict-overview-diff.v1";
  generatedAt: string;
  basePackageHash: string;
  comparedPackageHash: string;
  scope: {
    current: CollaborationConflictOverview["scope"];
    compared: CollaborationConflictOverview["scope"];
  };
  filters: {
    current: CollaborationConflictFilters;
    compared: CollaborationConflictFilters;
  };
  summary: {
    status: "unchanged" | "changed";
    areaCountDelta: number;
    conflictCountDelta: number;
    openConflictDelta: number;
    assignedConflictDelta: number;
    unassignedConflictDelta: number;
    expiredLeaseDelta: number;
    resolutionHistoryDelta: number;
  };
  sections: CollaborationConflictOverviewDiffSection[];
  packageHash: string;
  governance: {
    usesGovernedConflictReviewsOnly: true;
    excludesRawSchemas: true;
    excludesRawPrompts: true;
    excludesRawInputOutput: true;
    excludesHeaders: true;
    excludesTokens: true;
    excludesPayloads: true;
    excludesSecretValues: true;
    comparesHashesAndGovernedRefsOnly: true;
    localWorkspaceOnly: true;
  };
}

export async function loadCollaborationConflictOverview(
  workspaceRoot: string,
  options: {
    flowId?: string;
    area?: string;
    severity?: string;
    responsible?: string;
    role?: string;
    status?: string;
  } = {},
): Promise<CollaborationConflictOverview> {
  const filters = normalizeConflictFilters(options);
  const flows = await selectOverviewFlows(workspaceRoot, filters.flowId);
  const generatedAt = new Date().toISOString();
  const workspaceDefinitions: Array<{
    definition: CollaborationConflictAreaDefinition;
    loader: () => Promise<unknown>;
  }> = [
    {
      definition: {
        id: "workspace-governance",
        label: "Governanca do workspace",
        scope: "workspace",
        governanceArea: "governance",
        flowId: null,
        reviewPath: "/workspace-governance",
        sourceActions: sourceActions({
          reviewPath: "/workspace-governance",
          resolvePathTemplate: "/workspace-governance/conflicts/:conflictId/resolve",
        }),
      },
      loader: () => loadWorkspaceGovernance(workspaceRoot),
    },
    {
      definition: {
        id: "catalog-shared-library",
        label: "Catalogo compartilhado",
        scope: "workspace",
        governanceArea: "catalog",
        flowId: null,
        reviewPath: "/catalog/shared-library/conflicts-review",
        sourceActions: sourceActions({
          reviewPath: "/catalog/shared-library/conflicts-review",
          diffPath: "/catalog/shared-library/conflicts-review/diff",
          curationPathTemplate: "/catalog/shared-library/conflicts/:conflictId/curation",
          resolvePathTemplate: "/catalog/shared-library/conflicts/:conflictId/resolve",
        }),
      },
      loader: () => loadSharedLocalCatalogConflictReview(workspaceRoot),
    },
  ];

  const flowDefinitions = flows.flatMap((flow) => buildFlowAreaDefinitions(workspaceRoot, flow.id));
  const areaResults = await Promise.all(
    [...workspaceDefinitions, ...flowDefinitions].map(({ definition, loader }) =>
      buildAreaSummary(definition, loader),
    ),
  );
  const areas = areaResults.map((result) => result.area);
  const unfilteredConflicts = areaResults.flatMap((result) => result.conflicts);
  const conflicts = applyConflictFilters(unfilteredConflicts, filters);
  const totals = buildTotals(areas, flows.length);
  const filteredTotals = buildFilteredTotals(conflicts);
  const filterOptions = buildFilterOptions(areas, unfilteredConflicts);
  const base = {
    format: "agent-flow-builder.collaboration-conflict-overview.v1" as const,
    generatedAt,
    scope: {
      flowId: filters.flowId,
      includedFlowIds: flows.map((flow) => flow.id),
    },
    filters,
    totals,
    filteredTotals,
    filterOptions,
    areas,
    conflicts,
    governance: {
      usesGovernedConflictReviewsOnly: true as const,
      excludesRawSchemas: true as const,
      excludesRawPrompts: true as const,
      excludesRawInputOutput: true as const,
      excludesHeaders: true as const,
      excludesTokens: true as const,
      excludesPayloads: true as const,
      excludesSecretValues: true as const,
      viewerMutationBlockedBySourceRoutes: true as const,
      localWorkspaceOnly: true as const,
    },
  };
  return {
    ...base,
    packageHash: hashJson(base),
  };
}

export async function compareCollaborationConflictOverview(
  workspaceRoot: string,
  payload: unknown,
  options: {
    flowId?: string;
    area?: string;
    severity?: string;
    responsible?: string;
    role?: string;
    status?: string;
  } = {},
): Promise<CollaborationConflictOverviewDiffPackage> {
  const compared = normalizeCollaborationConflictOverviewPayload(payload);
  const current = await loadCollaborationConflictOverview(workspaceRoot, options);
  const sections = [
    buildCollaborationOverviewDiffSection(
      "areas",
      "Areas agregadas",
      current.areas,
      compared.areas,
      collaborationAreaDiffKey,
      (area) => area.flowId ? `${area.label} · ${area.flowId}` : area.label,
      (area) => `${area.openConflictCount} aberto(s), ${area.resolutionHistoryCount} decisao(oes), area ${area.governanceArea}`,
    ),
    buildCollaborationOverviewDiffSection(
      "conflicts",
      "Conflitos governados",
      current.conflicts,
      compared.conflicts,
      collaborationConflictDiffKey,
      (conflict) => `${conflict.areaLabel} · ${conflict.subject}`,
      (conflict) =>
        `${conflict.status || "sem status"} · ${conflict.responsible || "sem responsavel"} · ${conflict.role || "sem papel"}`,
    ),
  ];
  const base = {
    format: "agent-flow-builder.collaboration-conflict-overview-diff.v1" as const,
    generatedAt: new Date().toISOString(),
    basePackageHash: current.packageHash,
    comparedPackageHash: compared.packageHash,
    scope: {
      current: current.scope,
      compared: compared.scope,
    },
    filters: {
      current: current.filters,
      compared: compared.filters,
    },
    summary: {
      status: current.packageHash === compared.packageHash ? "unchanged" as const : "changed" as const,
      areaCountDelta: current.totals.areaCount - compared.totals.areaCount,
      conflictCountDelta: current.totals.conflictCount - compared.totals.conflictCount,
      openConflictDelta: current.totals.openConflictCount - compared.totals.openConflictCount,
      assignedConflictDelta: current.totals.assignedConflictCount - compared.totals.assignedConflictCount,
      unassignedConflictDelta: current.totals.unassignedConflictCount - compared.totals.unassignedConflictCount,
      expiredLeaseDelta: current.totals.expiredLeaseCount - compared.totals.expiredLeaseCount,
      resolutionHistoryDelta: current.totals.resolutionHistoryCount - compared.totals.resolutionHistoryCount,
    },
    sections,
    governance: {
      usesGovernedConflictReviewsOnly: true as const,
      excludesRawSchemas: true as const,
      excludesRawPrompts: true as const,
      excludesRawInputOutput: true as const,
      excludesHeaders: true as const,
      excludesTokens: true as const,
      excludesPayloads: true as const,
      excludesSecretValues: true as const,
      comparesHashesAndGovernedRefsOnly: true as const,
      localWorkspaceOnly: true as const,
    },
  };
  return {
    ...base,
    packageHash: hashJson(base),
  };
}

function normalizeCollaborationConflictOverviewPayload(payload: unknown): CollaborationConflictOverview {
  const candidate = isRecord(payload) && isRecord(payload.overview) ? payload.overview : payload;
  if (!isRecord(candidate) || candidate.format !== "agent-flow-builder.collaboration-conflict-overview.v1") {
    throw new WorkspaceError("Pacote de pendencias de colaboracao invalido para comparacao.", 400);
  }
  if (containsRawCollaborationConflictOverviewPayload(candidate)) {
    throw new WorkspaceError("Pacote de pendencias contem conteudo bruto ou sensivel e nao pode ser comparado.", 400);
  }
  const governance = isRecord(candidate.governance) ? candidate.governance : {};
  const totals = isRecord(candidate.totals) ? candidate.totals : {};
  const filteredTotals = isRecord(candidate.filteredTotals) ? candidate.filteredTotals : {};
  if (
    !isRecord(candidate.scope)
    || !isRecord(candidate.filters)
    || !Array.isArray(candidate.areas)
    || !Array.isArray(candidate.conflicts)
    || typeof candidate.packageHash !== "string"
    || !hasRequiredCollaborationOverviewTotals(totals)
    || !hasRequiredCollaborationOverviewFilteredTotals(filteredTotals)
    || governance.usesGovernedConflictReviewsOnly !== true
    || governance.excludesRawSchemas !== true
    || governance.excludesRawPrompts !== true
    || governance.excludesRawInputOutput !== true
    || governance.excludesHeaders !== true
    || governance.excludesTokens !== true
    || governance.excludesPayloads !== true
    || governance.excludesSecretValues !== true
    || governance.localWorkspaceOnly !== true
  ) {
    throw new WorkspaceError("Pacote de pendencias nao preserva o contrato governado de colaboracao.", 400);
  }
  return candidate as unknown as CollaborationConflictOverview;
}

function hasRequiredCollaborationOverviewTotals(value: Record<string, unknown>): boolean {
  return [
    "areaCount",
    "flowCount",
    "conflictCount",
    "openConflictCount",
    "assignedConflictCount",
    "unassignedConflictCount",
    "expiredLeaseCount",
    "resolutionHistoryCount",
  ].every((key) => typeof value[key] === "number" && Number.isFinite(value[key]));
}

function hasRequiredCollaborationOverviewFilteredTotals(value: Record<string, unknown>): boolean {
  return [
    "conflictCount",
    "openConflictCount",
    "assignedConflictCount",
    "unassignedConflictCount",
    "expiredLeaseCount",
  ].every((key) => typeof value[key] === "number" && Number.isFinite(value[key]));
}

function containsRawCollaborationConflictOverviewPayload(value: unknown): boolean {
  const rawKeys = new Set([
    "authorization",
    "body",
    "header",
    "headers",
    "input",
    "output",
    "payload",
    "prompt",
    "prompts",
    "raw",
    "request",
    "response",
    "schema",
    "schemas",
    "secret",
    "secrets",
    "token",
    "tokens",
  ]);
  const sensitiveStringPattern = /\b(authorization|bearer|password|secret|api[_-]?key|token)\b/i;
  const visit = (entry: unknown): boolean => {
    if (typeof entry === "string") {
      return sensitiveStringPattern.test(entry);
    }
    if (Array.isArray(entry)) {
      return entry.some(visit);
    }
    if (!isRecord(entry)) {
      return false;
    }
    return Object.entries(entry).some(([key, item]) => rawKeys.has(key.trim().toLowerCase()) || visit(item));
  };
  return visit(value);
}

function buildCollaborationOverviewDiffSection<T>(
  id: string,
  label: string,
  currentItems: T[],
  comparedItems: T[],
  keyFor: (item: T) => string,
  labelFor: (item: T) => string,
  detailFor: (item: T) => string,
): CollaborationConflictOverviewDiffSection {
  const currentByKey = new Map(currentItems.map((item) => [keyFor(item), item]));
  const comparedByKey = new Map(comparedItems.map((item) => [keyFor(item), item]));
  const entries = [...new Set([...currentByKey.keys(), ...comparedByKey.keys()])]
    .sort((left, right) => left.localeCompare(right))
    .map((key) => {
      const current = currentByKey.get(key) ?? null;
      const compared = comparedByKey.get(key) ?? null;
      const currentHash = current ? hashJson(current) : null;
      const comparedHash = compared ? hashJson(compared) : null;
      const status = diffStatusFor(currentHash, comparedHash);
      const source = current ?? compared;
      return {
        id: key,
        label: source ? labelFor(source) : key,
        status,
        currentHash,
        comparedHash,
        detail: source ? detailFor(source) : "",
      };
    });
  const changedEntries = entries.filter((entry) => entry.status !== "unchanged");
  return {
    id,
    label,
    status: changedEntries.length ? "changed" : "unchanged",
    currentCount: currentByKey.size,
    comparedCount: comparedByKey.size,
    changedCount: changedEntries.length,
    entries: changedEntries.slice(0, 200),
  };
}

function diffStatusFor(currentHash: string | null, comparedHash: string | null): CollaborationConflictOverviewDiffStatus {
  if (currentHash && !comparedHash) {
    return "added";
  }
  if (!currentHash && comparedHash) {
    return "removed";
  }
  return currentHash === comparedHash ? "unchanged" : "changed";
}

function collaborationAreaDiffKey(area: CollaborationConflictAreaSummary): string {
  return `${area.id}@${area.flowId ?? "workspace"}`;
}

function collaborationConflictDiffKey(conflict: CollaborationConflictItem): string {
  return `${conflict.areaId}@${conflict.flowId ?? "workspace"}#${conflict.conflictId}`;
}

async function selectOverviewFlows(workspaceRoot: string, requestedFlowId: string | null): Promise<FlowSummary[]> {
  const flows = (await listFlows(workspaceRoot)).filter((flow) => flow.valid);
  if (!requestedFlowId) {
    return flows;
  }
  const selected = flows.filter((flow) => flow.id === requestedFlowId);
  if (!selected.length) {
    throw new WorkspaceError(`Flow nao encontrado para visao de conflitos: ${requestedFlowId}`, 404);
  }
  return selected;
}

function normalizeConflictFilters(options: {
  flowId?: string;
  area?: string;
  severity?: string;
  responsible?: string;
  role?: string;
  status?: string;
}): CollaborationConflictFilters {
  return {
    flowId: normalizeOptionalString(options.flowId),
    area: normalizeOptionalString(options.area),
    severity: normalizeSeverityFilter(options.severity),
    responsible: normalizeOptionalString(options.responsible),
    role: normalizeOptionalString(options.role),
    status: normalizeOptionalString(options.status),
  };
}

function buildFlowAreaDefinitions(
  workspaceRoot: string,
  flowId: string,
): Array<{ definition: CollaborationConflictAreaDefinition; loader: () => Promise<unknown> }> {
  const encodedFlowId = encodeURIComponent(flowId);
  return [
    {
      definition: {
        id: "schema-patterns",
        label: "Padroes de schema",
        scope: "flow",
        governanceArea: "schemas",
        flowId,
        reviewPath: `/flows/${encodedFlowId}/schema-pattern-library/conflicts-review`,
        sourceActions: sourceActions({
          reviewPath: `/flows/${encodedFlowId}/schema-pattern-library/conflicts-review`,
          diffPath: `/flows/${encodedFlowId}/schema-pattern-library/conflicts-review/diff`,
          resolvePathTemplate: `/flows/${encodedFlowId}/schema-pattern-library/conflicts/:conflictId/resolve`,
        }),
      },
      loader: () => loadSchemaPatternConflictReview(workspaceRoot, flowId),
    },
    {
      definition: {
        id: "studio-scenarios",
        label: "Cenarios, datasets e evaluators",
        scope: "flow",
        governanceArea: "experiments",
        flowId,
        reviewPath: `/flows/${encodedFlowId}/studio-scenarios/conflicts-review`,
        sourceActions: sourceActions({
          reviewPath: `/flows/${encodedFlowId}/studio-scenarios/conflicts-review`,
          diffPath: `/flows/${encodedFlowId}/studio-scenarios/conflicts-review/diff`,
          curationPathTemplate: `/flows/${encodedFlowId}/studio-scenarios/conflicts/:conflictId/curation`,
          resolvePathTemplate: `/flows/${encodedFlowId}/studio-scenarios/conflicts/:conflictId/resolve`,
        }),
      },
      loader: () => loadStudioScenarioConflictReview(workspaceRoot, flowId),
    },
    {
      definition: {
        id: "annotation-queue",
        label: "Fila de anotacao",
        scope: "flow",
        governanceArea: "experiments",
        flowId,
        reviewPath: `/flows/${encodedFlowId}/annotation-queue/conflicts-review`,
        sourceActions: sourceActions({
          reviewPath: `/flows/${encodedFlowId}/annotation-queue/conflicts-review`,
          diffPath: `/flows/${encodedFlowId}/annotation-queue/conflicts-review/diff`,
          curationPathTemplate: `/flows/${encodedFlowId}/annotation-queue/conflicts/:conflictId/curation`,
        }),
      },
      loader: () => loadStudioAnnotationQueueConflictReview(workspaceRoot, flowId),
    },
    {
      definition: {
        id: "studio-node-pins",
        label: "Pins de nos",
        scope: "flow",
        governanceArea: "replay_governance",
        flowId,
        reviewPath: `/flows/${encodedFlowId}/studio-node-pins/conflicts-review`,
        sourceActions: sourceActions({
          reviewPath: `/flows/${encodedFlowId}/studio-node-pins/conflicts-review`,
          diffPath: `/flows/${encodedFlowId}/studio-node-pins/conflicts-review/diff`,
          curationPathTemplate: `/flows/${encodedFlowId}/studio-node-pins/conflicts/:conflictId/curation`,
          resolvePathTemplate: `/flows/${encodedFlowId}/studio-node-pins/conflicts/:conflictId/resolve`,
        }),
      },
      loader: () => loadStudioNodePinConflictReview(workspaceRoot, flowId),
    },
    {
      definition: {
        id: "debug-layer-snapshots",
        label: "Camadas de debug",
        scope: "flow",
        governanceArea: "replay_governance",
        flowId,
        reviewPath: `/flows/${encodedFlowId}/debug-layer-snapshots/conflicts-review`,
        sourceActions: sourceActions({
          reviewPath: `/flows/${encodedFlowId}/debug-layer-snapshots/conflicts-review`,
          diffPath: `/flows/${encodedFlowId}/debug-layer-snapshots/conflicts-review/diff`,
          curationPathTemplate: `/flows/${encodedFlowId}/debug-layer-snapshots/conflicts/:conflictId/curation`,
          resolvePathTemplate: `/flows/${encodedFlowId}/debug-layer-snapshots/conflicts/:conflictId/resolve`,
        }),
      },
      loader: () => loadDebugLayerSnapshotConflictReview(workspaceRoot, flowId),
    },
    {
      definition: {
        id: "replay-governance",
        label: "Replay governado",
        scope: "flow",
        governanceArea: "replay_governance",
        flowId,
        reviewPath: `/flows/${encodedFlowId}/replay-governance-history/conflicts-review`,
        sourceActions: sourceActions({
          reviewPath: `/flows/${encodedFlowId}/replay-governance-history/conflicts-review`,
          diffPath: `/flows/${encodedFlowId}/replay-governance-history/conflicts-review/diff`,
          curationPathTemplate: `/flows/${encodedFlowId}/replay-governance-history/conflicts/:conflictId/curation`,
          resolvePathTemplate: `/flows/${encodedFlowId}/replay-governance-history/conflicts/:conflictId/resolve`,
        }),
      },
      loader: () => loadReplayGovernanceHistoryConflictReview(workspaceRoot, flowId),
    },
  ];
}

async function buildAreaSummary(
  definition: CollaborationConflictAreaDefinition,
  loader: () => Promise<unknown>,
): Promise<{ area: CollaborationConflictAreaSummary; conflicts: CollaborationConflictItem[] }> {
  try {
    const review = await loader();
    const record = isRecord(review) ? review : {};
    const conflicts = readRecordArray(record.conflicts).map((conflict) => buildConflictItem(definition, conflict));
    const summary = isRecord(record.summary) ? record.summary : {};
    const resolutionHistory = readRecordArray(record.resolutionHistory);
    const resolutions = readRecordArray(record.resolutions);
    const resolutionHistoryCount = readNumber(record.resolutionHistoryCount)
      ?? readNumber(record.resolutionCount)
      ?? resolutionHistory.length
      + resolutions.length;
    const assignedConflictCount = readNumber(summary.assignedConflictCount)
      ?? conflicts.filter((conflict) => conflict.responsible).length;
    const unassignedConflictCount = readNumber(summary.unassignedConflictCount)
      ?? conflicts.filter((conflict) => conflict.status === "open" && !conflict.responsible).length;
    const expiredLeaseCount = readNumber(summary.expiredLeaseCount)
      ?? conflicts.filter((conflict) => conflict.leaseExpired).length;
    const openConflictCount = readNumber(record.openConflictCount)
      ?? readNumber(summary.openConflictCount)
      ?? conflicts.filter((conflict) => conflict.status === "open").length;
    const conflictCount = readNumber(record.conflictCount)
      ?? readNumber(summary.conflictCount)
      ?? conflicts.length;
    const latestDecision = latestDecisionFromReview([...resolutionHistory, ...resolutions]);
    return {
      area: {
        ...definition,
        severity: severityFor(openConflictCount, expiredLeaseCount, false),
        conflictCount,
        openConflictCount,
        assignedConflictCount,
        unassignedConflictCount,
        expiredLeaseCount,
        resolutionHistoryCount,
        latestDecision,
        loadError: null,
      },
      conflicts: conflicts.map((conflict) => ({
        ...conflict,
        latestDecision,
      })),
    };
  } catch {
    return {
      area: {
        ...definition,
        severity: "error",
        conflictCount: 0,
        openConflictCount: 0,
        assignedConflictCount: 0,
        unassignedConflictCount: 0,
        expiredLeaseCount: 0,
        resolutionHistoryCount: 0,
        latestDecision: null,
        loadError: "Falha ao carregar a revisao governada desta area.",
      },
      conflicts: [],
    };
  }
}

function buildConflictItem(
  definition: CollaborationConflictAreaDefinition,
  conflict: Record<string, unknown>,
): CollaborationConflictItem {
  const thread = isRecord(conflict.curationThread) ? conflict.curationThread : {};
  const latestEvent = readRecordArray(thread.events)[0] ?? {};
  const conflictId = firstString(conflict.conflictId, conflict.id, conflict.itemId, conflict.participantId) || "conflict";
  const status = firstString(conflict.status) || "open";
  const leaseExpired = readBoolean(thread.leaseExpired) ?? false;
  const openedAt = firstString(thread.openedAt, conflict.createdAt);
  const updatedAt = latestTimestamp([
    thread.updatedAt,
    conflict.latestUpdatedAt,
    conflict.incomingUpdatedAt,
    conflict.existingUpdatedAt,
    conflict.createdAt,
    conflict.resolvedAt,
  ]);
  const responsible = firstString(thread.assignee, conflict.assignee) || "";
  const role = firstString(latestEvent.role, conflict.resolvedRole) || "";
  return {
    areaId: definition.id,
    areaLabel: definition.label,
    governanceArea: definition.governanceArea,
    scope: definition.scope,
    flowId: definition.flowId,
    conflictId,
    status,
    subject: conflictSubject(conflict),
    responsible,
    role,
    severity: severityFor(status === "open" ? 1 : 0, leaseExpired ? 1 : 0, false),
    openedAt: openedAt || null,
    updatedAt,
    leaseExpiresAt: firstString(thread.leaseExpiresAt) || null,
    leaseExpired,
    lastAction: firstString(thread.lastAction, latestEvent.action, conflict.resolution) || "",
    latestDecision: null,
    sourceActions: definition.sourceActions,
  };
}

function sourceActions(paths: {
  reviewPath: string;
  diffPath?: string;
  curationPathTemplate?: string;
  resolvePathTemplate?: string;
}): CollaborationConflictSourceActions {
  return {
    reviewPath: paths.reviewPath,
    diffPath: paths.diffPath ?? null,
    curationPathTemplate: paths.curationPathTemplate ?? null,
    resolvePathTemplate: paths.resolvePathTemplate ?? null,
    viewerMutationBlocked: true,
  };
}

function buildTotals(areas: CollaborationConflictAreaSummary[], flowCount: number): CollaborationConflictTotals {
  return {
    areaCount: areas.length,
    flowCount,
    conflictCount: sumAreas(areas, "conflictCount"),
    openConflictCount: sumAreas(areas, "openConflictCount"),
    assignedConflictCount: sumAreas(areas, "assignedConflictCount"),
    unassignedConflictCount: sumAreas(areas, "unassignedConflictCount"),
    expiredLeaseCount: sumAreas(areas, "expiredLeaseCount"),
    resolutionHistoryCount: sumAreas(areas, "resolutionHistoryCount"),
    blockedAreaCount: areas.filter((area) => area.severity === "blocked").length,
    errorAreaCount: areas.filter((area) => area.severity === "error").length,
  };
}

function buildFilteredTotals(conflicts: CollaborationConflictItem[]): CollaborationConflictFilteredTotals {
  return {
    conflictCount: conflicts.length,
    openConflictCount: conflicts.filter((conflict) => conflict.status === "open").length,
    assignedConflictCount: conflicts.filter((conflict) => conflict.responsible).length,
    unassignedConflictCount: conflicts.filter((conflict) => conflict.status === "open" && !conflict.responsible).length,
    expiredLeaseCount: conflicts.filter((conflict) => conflict.leaseExpired).length,
  };
}

function applyConflictFilters(
  conflicts: CollaborationConflictItem[],
  filters: CollaborationConflictFilters,
): CollaborationConflictItem[] {
  return conflicts.filter((conflict) => {
    if (filters.area && !matchesAreaFilter(conflict, filters.area)) {
      return false;
    }
    if (filters.severity && conflict.severity !== filters.severity) {
      return false;
    }
    if (filters.responsible && !matchesPrincipalFilter(conflict.responsible, filters.responsible, UNASSIGNED_FILTER_VALUE)) {
      return false;
    }
    if (filters.role && !matchesPrincipalFilter(conflict.role, filters.role, MISSING_ROLE_FILTER_VALUE)) {
      return false;
    }
    if (filters.status && !sameFilterValue(conflict.status, filters.status)) {
      return false;
    }
    return true;
  });
}

function buildFilterOptions(
  areas: CollaborationConflictAreaSummary[],
  conflicts: CollaborationConflictItem[],
): CollaborationConflictFilterOptions {
  const areaCounts = new Map<string, number>();
  for (const conflict of conflicts) {
    areaCounts.set(conflict.areaId, (areaCounts.get(conflict.areaId) ?? 0) + 1);
  }
  return {
    areas: areas.map((area) => ({
      value: area.id,
      label: area.flowId ? `${area.label} · ${area.flowId}` : area.label,
      count: areaCounts.get(area.id) ?? 0,
      governanceArea: area.governanceArea,
      flowId: area.flowId,
      openConflictCount: area.openConflictCount,
    })),
    severities: countOptions(conflicts, (conflict) => conflict.severity, severityLabel),
    responsible: countOptions(conflicts, (conflict) => conflict.responsible || UNASSIGNED_FILTER_VALUE, responsibleLabel),
    roles: countOptions(conflicts, (conflict) => conflict.role || MISSING_ROLE_FILTER_VALUE, roleLabel),
    statuses: countOptions(conflicts, (conflict) => conflict.status, statusLabel),
  };
}

function countOptions(
  conflicts: CollaborationConflictItem[],
  selector: (conflict: CollaborationConflictItem) => string,
  labeler: (value: string) => string,
): CollaborationConflictFilterOption[] {
  const counts = new Map<string, number>();
  for (const conflict of conflicts) {
    const value = selector(conflict).trim();
    if (!value) {
      continue;
    }
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: labeler(value), count }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function matchesAreaFilter(conflict: CollaborationConflictItem, filter: string): boolean {
  return sameFilterValue(conflict.areaId, filter)
    || sameFilterValue(conflict.governanceArea, filter)
    || sameFilterValue(conflict.scope, filter)
    || (conflict.flowId ? sameFilterValue(conflict.flowId, filter) : false);
}

function matchesPrincipalFilter(value: string, filter: string, missingValue: string): boolean {
  if (sameFilterValue(filter, missingValue)) {
    return !value;
  }
  return sameFilterValue(value, filter);
}

function sameFilterValue(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function severityLabel(value: string): string {
  if (value === "blocked") {
    return "Bloqueado";
  }
  if (value === "attention") {
    return "Atenção";
  }
  if (value === "error") {
    return "Erro";
  }
  return "Sem pendência";
}

function responsibleLabel(value: string): string {
  return value === UNASSIGNED_FILTER_VALUE ? "Sem responsável" : value;
}

function roleLabel(value: string): string {
  return value === MISSING_ROLE_FILTER_VALUE ? "Sem papel" : value;
}

function statusLabel(value: string): string {
  return value || "sem status";
}

function sumAreas(areas: CollaborationConflictAreaSummary[], key: keyof Pick<
  CollaborationConflictAreaSummary,
  | "conflictCount"
  | "openConflictCount"
  | "assignedConflictCount"
  | "unassignedConflictCount"
  | "expiredLeaseCount"
  | "resolutionHistoryCount"
>): number {
  return areas.reduce((total, area) => total + area[key], 0);
}

function severityFor(openConflictCount: number, expiredLeaseCount: number, hasError: boolean): CollaborationConflictSeverity {
  if (hasError) {
    return "error";
  }
  if (expiredLeaseCount > 0) {
    return "blocked";
  }
  if (openConflictCount > 0) {
    return "attention";
  }
  return "clear";
}

function latestDecisionFromReview(records: Record<string, unknown>[]): CollaborationConflictDecision | null {
  const sorted = [...records].sort((left, right) => {
    const rightTime = Date.parse(firstString(right.resolvedAt, right.decidedAt, right.updatedAt) || "");
    const leftTime = Date.parse(firstString(left.resolvedAt, left.decidedAt, left.updatedAt) || "");
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  });
  const latest = sorted[0];
  if (!latest) {
    return null;
  }
  return {
    decidedAt: firstString(latest.resolvedAt, latest.decidedAt, latest.updatedAt) || null,
    decidedBy: firstString(latest.resolvedBy, latest.decidedBy, latest.reviewer) || "",
    decision: firstString(latest.resolution, latest.resolutionNote, latest.decision, latest.keptPinId, latest.keptPackageHash) || "",
  };
}

function conflictSubject(conflict: Record<string, unknown>): string {
  const parts = [
    firstString(conflict.kind, conflict.scope),
    firstString(conflict.itemLabel, conflict.scenarioLabel, conflict.nodeId, conflict.itemId, conflict.participantId, conflict.conflictKey),
  ].filter((part): part is string => Boolean(part));
  return [...new Set(parts)].join(" · ") || "conflito compartilhado";
}

function latestTimestamp(values: unknown[]): string | null {
  const timestamps = values
    .map((value) => firstString(value))
    .filter((value): value is string => Boolean(value))
    .map((value) => ({ value, time: Date.parse(value) }))
    .filter((entry) => Number.isFinite(entry.time))
    .sort((left, right) => right.time - left.time);
  return timestamps[0]?.value ?? null;
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeSeverityFilter(value: unknown): CollaborationConflictSeverity | null {
  const normalized = normalizeOptionalString(value);
  if (
    normalized === "clear"
    || normalized === "attention"
    || normalized === "blocked"
    || normalized === "error"
  ) {
    return normalized;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
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
