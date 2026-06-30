import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadFlowById, toWorkspaceRelative, WorkspaceError } from "./workspace.ts";
import type { AgentFlow } from "@agent-flow-builder/flow-spec";

export interface StudioSessionSnapshot {
  session_id: string;
  status: string;
  phase: string;
  turn: number;
  max_turns: number;
  metadata: Record<string, unknown>;
  is_complete: boolean;
}

export interface StudioMessageSnapshot {
  seq: number;
  role: string;
  code?: string | null;
  content: string;
  metadata: Record<string, unknown>;
}

export interface StudioEventSnapshot {
  seq: number;
  event_type: string;
  node?: string | null;
  payload: Record<string, unknown>;
}

export interface StudioStateDiffEntry {
  path: string;
  kind: "added" | "removed" | "changed";
  before?: unknown;
  after?: unknown;
}

export interface StudioStateSnapshot {
  seq: number;
  node: string | null;
  eventType: string;
  status: string | null;
  phase: string | null;
  turn: number | null;
  state: Record<string, unknown>;
  diff: StudioStateDiffEntry[];
}

export interface SaveStudioRunInput {
  runtimeUrl?: unknown;
  resourceName?: unknown;
  session?: unknown;
  transcript?: unknown;
  events?: unknown;
  logs?: unknown;
}

export interface StudioRunSummary {
  id: string;
  flowId: string;
  flowVersion: string | null;
  sessionId: string;
  status: string;
  phase: string;
  turn: number;
  maxTurns: number;
  isComplete: boolean;
  resourceName: string;
  runtimeUrl: string;
  messageCount: number;
  eventCount: number;
  snapshotCount: number;
  nodeCount: number;
  errorCount: number;
  causalAnalysis: StudioRunCausalAnalysis | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface StudioRunCausalAnalysis {
  failedEventSeq: number | null;
  failedEventType: string | null;
  failedNode: string | null;
  upstreamPath: string[];
  impactPath: string[];
  impactedNodes: string[];
}

export interface StudioRunComparison {
  format: "agent-flow-builder.studio-run-comparison.v1";
  exportedAt: string;
  flowId: string;
  flowName: string | null;
  leftRunId: string;
  rightRunId: string;
  left: StudioRunRecord;
  right: StudioRunRecord;
  metrics: {
    statusChanged: boolean;
    phaseChanged: boolean;
    isCompleteChanged: boolean;
    nodeCountDelta: number;
    eventCountDelta: number;
    errorCountDelta: number;
    messageCountDelta: number;
    runtimeUrlChanged: boolean;
    durationMsLeft: number | null;
    durationMsRight: number | null;
    durationMsDelta: number | null;
    pinnedEventCountLeft: number;
    pinnedEventCountRight: number;
    pinnedEventCountDelta: number;
    mockEventCountLeft: number;
    mockEventCountRight: number;
    mockEventCountDelta: number;
    totalTokensLeft: number | null;
    totalTokensRight: number | null;
    totalTokensDelta: number | null;
    totalCostUsdLeft: number | null;
    totalCostUsdRight: number | null;
    totalCostUsdDelta: number | null;
    runKindLeft: "live" | "mock" | "pinned" | "mixed";
    runKindRight: "live" | "mock" | "pinned" | "mixed";
  };
  regression: StudioRunRegressionSummary;
  nodeDiff: {
    leftOnly: string[];
    rightOnly: string[];
    both: string[];
  };
  nodeComparisons: StudioNodeComparison[];
  leftOnlyNodes: string[];
  rightOnlyNodes: string[];
}

export interface StudioRunRegressionSummary {
  severity: "pass" | "warn" | "fail";
  comparesPinnedToLive: boolean;
  baselineRunId: string;
  candidateRunId: string;
  verdict: string;
  reasons: string[];
  appliedThresholds: StudioRunRegressionThresholds;
}

export interface StudioRunRegressionThresholds {
  tokenGrowthPct: number;
  costGrowthPct: number;
  durationGrowthPct: number;
}

export interface StudioNodeComparison {
  nodeId: string;
  inLeft: boolean;
  inRight: boolean;
  changed: boolean;
  stateDiff: StudioStateDiffEntry[];
  outputDiff: StudioStateDiffEntry[];
  left: {
    seq: number | null;
    eventType: string | null;
    status: string | null;
    phase: string | null;
    turn: number | null;
  };
  right: {
    seq: number | null;
    eventType: string | null;
    status: string | null;
    phase: string | null;
    turn: number | null;
  };
}

export interface StudioRunRecord extends StudioRunSummary {
  flowName: string | null;
  runPath: string;
  session: StudioSessionSnapshot;
  transcript: StudioMessageSnapshot[];
  events: StudioEventSnapshot[];
  stateSnapshots: StudioStateSnapshot[];
  logs: string[];
  causalAnalysis: StudioRunCausalAnalysis | null;
}

export interface StudioRunFilterOptions {
  q?: string;
  status?: string;
  phase?: string;
  hasErrors?: boolean;
  isComplete?: boolean;
  node?: string;
  minDurationMs?: number;
  maxDurationMs?: number;
}

export interface StudioRunExport {
  format: "agent-flow-builder.studio-run-export.v1";
  exportedAt: string;
  flowId: string;
  runId: string;
  run: StudioRunRecord;
}

export interface StudioRunList {
  flowId: string;
  runs: StudioRunSummary[];
}

const STUDIO_RUN_DIR = ".agent-flow/studio-runs";
const LOG_LIMIT = 120;
const DEFAULT_REGRESSION_THRESHOLDS: StudioRunRegressionThresholds = {
  tokenGrowthPct: 20,
  costGrowthPct: 20,
  durationGrowthPct: 30,
};

export async function listStudioRuns(
  workspaceRoot: string,
  flowId: string,
  options: StudioRunFilterOptions = {},
): Promise<StudioRunList> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const dir = path.join(loaded.flowRoot, STUDIO_RUN_DIR);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return { flowId: loaded.flow.id, runs: [] };
  }

  const runs: StudioRunSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    try {
      const record = await readStudioRunFile(path.join(dir, entry.name), loaded.flow);
      if (!matchStudioRunFilter(record, options)) {
        continue;
      }
      runs.push(toSummary(record));
    } catch {
      // Ignore corrupted local trace files so one bad snapshot does not break the Studio.
    }
  }
  runs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { flowId: loaded.flow.id, runs };
}

export async function exportStudioRun(
  workspaceRoot: string,
  flowId: string,
  runId: string,
): Promise<StudioRunExport> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const record = await loadStudioRun(workspaceRoot, loaded.flow.id, runId);
  return {
    format: "agent-flow-builder.studio-run-export.v1",
    exportedAt: new Date().toISOString(),
    flowId: loaded.flow.id,
    runId: record.id,
    run: record,
  };
}

export async function compareStudioRuns(
  workspaceRoot: string,
  flowId: string,
  leftRunId: string,
  rightRunId: string,
): Promise<StudioRunComparison> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const left = await loadStudioRun(workspaceRoot, loaded.flow.id, leftRunId);
  const right = await loadStudioRun(workspaceRoot, loaded.flow.id, rightRunId);

  if (left.id === right.id) {
    throw new WorkspaceError("Escolha dois runs diferentes para comparar.", 400);
  }

  const leftNodes = collectNodeIds(left.events);
  const rightNodes = collectNodeIds(right.events);
  const leftDuration = calcDurationMs(left);
  const rightDuration = calcDurationMs(right);
  const leftMetrics = collectRunSignalMetrics(left);
  const rightMetrics = collectRunSignalMetrics(right);
  const leftOnlyNodes = leftNodes.filter((node) => !rightNodes.includes(node));
  const rightOnlyNodes = rightNodes.filter((node) => !leftNodes.includes(node));
  const nodeComparisons = buildNodeComparisons(left, right);
  const regression = buildRegressionSummary(left, right, leftMetrics, rightMetrics, nodeComparisons);

  return {
    format: "agent-flow-builder.studio-run-comparison.v1",
    exportedAt: new Date().toISOString(),
    flowId: loaded.flow.id,
    flowName: loaded.flow.name,
    leftRunId: left.id,
    rightRunId: right.id,
    left,
    right,
    metrics: {
      statusChanged: left.status !== right.status,
      phaseChanged: left.phase !== right.phase,
      isCompleteChanged: left.isComplete !== right.isComplete,
      nodeCountDelta: right.nodeCount - left.nodeCount,
      eventCountDelta: right.eventCount - left.eventCount,
      errorCountDelta: right.errorCount - left.errorCount,
      messageCountDelta: right.messageCount - left.messageCount,
      runtimeUrlChanged: left.runtimeUrl !== right.runtimeUrl,
      durationMsLeft: leftDuration,
      durationMsRight: rightDuration,
      durationMsDelta:
        leftDuration === null || rightDuration === null ? null : rightDuration - leftDuration,
      pinnedEventCountLeft: leftMetrics.pinnedEventCount,
      pinnedEventCountRight: rightMetrics.pinnedEventCount,
      pinnedEventCountDelta: rightMetrics.pinnedEventCount - leftMetrics.pinnedEventCount,
      mockEventCountLeft: leftMetrics.mockEventCount,
      mockEventCountRight: rightMetrics.mockEventCount,
      mockEventCountDelta: rightMetrics.mockEventCount - leftMetrics.mockEventCount,
      totalTokensLeft: leftMetrics.totalTokens,
      totalTokensRight: rightMetrics.totalTokens,
      totalTokensDelta: nullableDelta(leftMetrics.totalTokens, rightMetrics.totalTokens),
      totalCostUsdLeft: leftMetrics.totalCostUsd,
      totalCostUsdRight: rightMetrics.totalCostUsd,
      totalCostUsdDelta: nullableDelta(leftMetrics.totalCostUsd, rightMetrics.totalCostUsd),
      runKindLeft: leftMetrics.runKind,
      runKindRight: rightMetrics.runKind,
    },
    regression,
    nodeDiff: {
      leftOnly: leftOnlyNodes,
      rightOnly: rightOnlyNodes,
      both: leftNodes.filter((node) => rightNodes.includes(node)),
    },
    nodeComparisons,
    leftOnlyNodes,
    rightOnlyNodes,
  };
}

export async function loadStudioRun(workspaceRoot: string, flowId: string, runId: string): Promise<StudioRunRecord> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const safeRunId = normalizeRunId(runId);
  const runPath = path.join(loaded.flowRoot, STUDIO_RUN_DIR, `${safeRunId}.json`);
  try {
    return await readStudioRunFile(runPath, loaded.flow);
  } catch (error) {
    throw new WorkspaceError(`Run local não encontrada: ${runId}`, 404, error);
  }
}

export async function saveStudioRun(
  workspaceRoot: string,
  flowId: string,
  input: SaveStudioRunInput,
): Promise<StudioRunRecord> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const session = parseSession(input.session);
  const transcript = parseMessages(input.transcript);
  const events = parseEvents(input.events);
  const logs = parseLogs(input.logs);
  const stateSnapshots = buildStateSnapshots(session, transcript, events);
  const resourceName = parseOptionalString(input.resourceName, "resourceName") || loaded.flow.api.resourceName;
  const runtimeUrl = parseOptionalString(input.runtimeUrl, "runtimeUrl") || "";
  const id = runIdFromSession(session.session_id);
  const now = new Date().toISOString();
  const dir = path.join(loaded.flowRoot, STUDIO_RUN_DIR);
  const runPath = path.join(dir, `${id}.json`);
  const existing = await readExistingRun(runPath);
  const nodeCount = new Set(events.map((event) => event.node).filter((node): node is string => Boolean(node))).size;
  const errorCount = events.filter(isErrorEvent).length;
  const completedAt = session.is_complete ? existing?.completedAt ?? now : null;
  const causalAnalysis = buildCausalAnalysis(loaded.flow, events);

  const record: StudioRunRecord = {
    id,
    flowId: loaded.flow.id,
    flowName: loaded.flow.name,
    flowVersion: loaded.flow.version,
    sessionId: session.session_id,
    status: session.status,
    phase: session.phase,
    turn: session.turn,
    maxTurns: session.max_turns,
    isComplete: session.is_complete,
    resourceName,
    runtimeUrl,
    messageCount: transcript.length,
    eventCount: events.length,
    snapshotCount: stateSnapshots.length,
    nodeCount,
    errorCount,
    causalAnalysis,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    completedAt,
    runPath: toWorkspaceRelative(workspaceRoot, runPath),
    session,
    transcript,
    events,
    stateSnapshots,
    logs: logs.slice(-LOG_LIMIT),
  };

  await mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `${id}.${process.pid}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
  await rename(tempPath, runPath);
  return record;
}

function toSummary(record: StudioRunRecord): StudioRunSummary {
  return {
    id: record.id,
    flowId: record.flowId,
    flowVersion: record.flowVersion,
    sessionId: record.sessionId,
    status: record.status,
    phase: record.phase,
    turn: record.turn,
    maxTurns: record.maxTurns,
    isComplete: record.isComplete,
    resourceName: record.resourceName,
    runtimeUrl: record.runtimeUrl,
    messageCount: record.messageCount,
    eventCount: record.eventCount,
    snapshotCount: record.snapshotCount ?? record.stateSnapshots?.length ?? 0,
    nodeCount: record.nodeCount,
    errorCount: record.errorCount,
    causalAnalysis: record.causalAnalysis ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt,
  };
}

async function readExistingRun(runPath: string): Promise<StudioRunRecord | null> {
  try {
    return await readStudioRunFile(runPath);
  } catch {
    return null;
  }
}

async function readStudioRunFile(runPath: string, flow?: AgentFlow): Promise<StudioRunRecord> {
  const parsed = JSON.parse(await readFile(runPath, "utf-8"));
  if (!isRecord(parsed) || typeof parsed.id !== "string" || typeof parsed.sessionId !== "string") {
    throw new WorkspaceError("Arquivo de run local inválido.", 422);
  }
  const record = parsed as unknown as StudioRunRecord;
  if (!Array.isArray(record.stateSnapshots)) {
    record.stateSnapshots = buildStateSnapshots(record.session, record.transcript ?? [], record.events ?? []);
  }
  if (!record.causalAnalysis && flow && Array.isArray(record.events)) {
    record.causalAnalysis = buildCausalAnalysis(flow, record.events);
  }
  if (!record.causalAnalysis) {
    record.causalAnalysis = null;
  }
  if (typeof record.snapshotCount !== "number") {
    record.snapshotCount = record.stateSnapshots.length;
  }
  return record;
}

function collectNodeIds(events: StudioEventSnapshot[]): string[] {
  return Array.from(new Set(events.map((event) => event.node).filter((node): node is string => Boolean(node)))).sort();
}

interface FlowTopology {
  outgoing: Map<string, string[]>;
  incoming: Map<string, string[]>;
}

function buildCausalAnalysis(flow: AgentFlow, events: StudioEventSnapshot[]): StudioRunCausalAnalysis {
  if (!events.length) {
    return {
      failedEventSeq: null,
      failedEventType: null,
      failedNode: null,
      upstreamPath: [],
      impactPath: [],
      impactedNodes: [],
    };
  }
  const orderedEvents = [...events].sort((a, b) => a.seq - b.seq);
  const failedEvent = orderedEvents.filter(isErrorEvent).at(-1);
  if (!failedEvent) {
    return {
      failedEventSeq: null,
      failedEventType: null,
      failedNode: null,
      upstreamPath: [],
      impactPath: [],
      impactedNodes: [],
    };
  }
  const failedNode = failedEvent.node ?? null;
  if (!failedNode) {
    return {
      failedEventSeq: failedEvent.seq,
      failedEventType: failedEvent.event_type,
      failedNode: null,
      upstreamPath: [],
      impactPath: [],
      impactedNodes: [],
    };
  }
  const topology = buildFlowGraphIndex(flow);
  const eventSeqIndex = buildFailureExecutionIndex(orderedEvents, failedEvent.seq);
  const downstreamEligible = buildDownstreamImpactIndex(
    topology,
    failedNode,
    failedEvent.seq,
    eventSeqIndex.firstAfterFailure,
  );
  return {
    failedEventSeq: failedEvent.seq,
    failedEventType: failedEvent.event_type,
    failedNode,
    upstreamPath: deriveUpstreamPath(topology, failedNode, failedEvent.seq, eventSeqIndex.lastBeforeFailure),
    impactPath: deriveImpactPath(topology, failedNode, downstreamEligible),
    impactedNodes: deriveImpactedNodeOrder(topology, failedNode, downstreamEligible),
  };
}

function buildFlowGraphIndex(flow: AgentFlow): FlowTopology {
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const edge of flow.edges ?? []) {
    const from = String(edge.from);
    const to = String(edge.to);
    const outgoingList = outgoing.get(from) ?? [];
    outgoingList.push(to);
    outgoing.set(from, outgoingList);

    const incomingList = incoming.get(to) ?? [];
    incomingList.push(from);
    incoming.set(to, incomingList);
  }
  return { outgoing, incoming };
}

function buildFailureExecutionIndex(
  events: StudioEventSnapshot[],
  failedEventSeq: number,
): {
  lastBeforeFailure: Map<string, number>;
  firstAfterFailure: Map<string, number>;
} {
  const firstAfterFailure = new Map<string, number>();
  const lastBeforeFailure = new Map<string, number>();
  for (const event of events) {
    if (!event.node) {
      continue;
    }
    if (event.seq < failedEventSeq) {
      lastBeforeFailure.set(event.node, event.seq);
    }
    if (event.seq > failedEventSeq && !firstAfterFailure.has(event.node)) {
      firstAfterFailure.set(event.node, event.seq);
    }
  }
  return {
    lastBeforeFailure,
    firstAfterFailure,
  };
}

function buildDownstreamImpactIndex(
  topology: FlowTopology,
  failedNode: string,
  failedEventSeq: number,
  firstAfterFailure: Map<string, number>,
): Map<string, number> {
  const earliestPostFailure = new Map<string, number>();
  const memo = new Map<string, number | null>();
  const visiting = new Set<string>();

  const dfs = (node: string): number | null => {
    const cached = memo.get(node);
    if (cached !== undefined) {
      return cached;
    }
    if (visiting.has(node)) {
      return null;
    }
    visiting.add(node);

    const directSeq = firstAfterFailure.get(node);
    if (directSeq !== undefined) {
      memo.set(node, directSeq);
      visiting.delete(node);
      return directSeq;
    }

    let best: number | null = null;
    for (const child of topology.outgoing.get(node) ?? []) {
      const candidate = dfs(child);
      if (candidate !== null && (best === null || candidate < best)) {
        best = candidate;
      }
    }
    memo.set(node, best);
    visiting.delete(node);
    return best;
  };

  // Seed with descendants explicitly impacted after the failure.
  // For consistency keep the failed node itself as impacted even if it has no future event.
  dfs(failedNode);
  const stack = [failedNode];
  while (stack.length) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const parentImpact = dfs(current);
    if (parentImpact === null) {
      continue;
    }
    for (const child of topology.outgoing.get(current) ?? []) {
      const childImpact = dfs(child);
      if (childImpact !== null && !earliestPostFailure.has(child)) {
        earliestPostFailure.set(child, childImpact);
        stack.push(child);
      }
    }
  }
  earliestPostFailure.set(failedNode, earliestPostFailure.get(failedNode) ?? failedEventSeq);
  return earliestPostFailure;
}

function deriveUpstreamPath(
  topology: FlowTopology,
  node: string,
  failureSeq: number,
  lastByNodeBeforeFailure: Map<string, number>,
): string[] {
  const visited = new Set<string>();
  const path: string[] = [node];
  let current = node;
  visited.add(current);
  while (true) {
    const parents = topology.incoming.get(current);
    let next: string | undefined;
    for (const parent of parents ?? []) {
      const parentSeq = lastByNodeBeforeFailure.get(parent);
      if (parentSeq === undefined || parentSeq >= failureSeq || visited.has(parent)) {
        continue;
      }
      if (!next) {
        next = parent;
        continue;
      }
      const nextSeq = lastByNodeBeforeFailure.get(next);
      if (nextSeq !== undefined && parentSeq > nextSeq) {
        next = parent;
      }
    }
    if (!next) {
      return path.slice().reverse();
    }
    visited.add(next);
    path.push(next);
    current = next;
  }
}

function deriveImpactPath(topology: FlowTopology, node: string, downstreamImpactByNode: Map<string, number>): string[] {
  const visited = new Set<string>();
  const path: string[] = [node];
  let current = node;
  visited.add(current);
  while (true) {
    const candidates = topology.outgoing.get(current) ?? [];
    const next = candidates
      .filter((child) => !visited.has(child) && downstreamImpactByNode.has(child))
      .sort((a, b) => {
        const aSeq = downstreamImpactByNode.get(a) ?? Number.POSITIVE_INFINITY;
        const bSeq = downstreamImpactByNode.get(b) ?? Number.POSITIVE_INFINITY;
        return aSeq - bSeq;
      })[0];
    if (!next) {
      return path;
    }
    visited.add(next);
    path.push(next);
    current = next;
  }
}

function deriveImpactedNodes(topology: FlowTopology, failedNode: string, downstreamImpactByNode: Map<string, number>): Set<string> {
  const impacted = new Set<string>([failedNode]);
  const stack = [failedNode];
  while (stack.length) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const children = topology.outgoing.get(current);
    if (!children) {
      continue;
    }
    for (const child of children) {
      if (!impacted.has(child) && downstreamImpactByNode.has(child)) {
        impacted.add(child);
        stack.push(child);
      }
    }
  }
  return impacted;
}

function deriveImpactedNodeOrder(
  topology: FlowTopology,
  failedNode: string,
  downstreamImpactByNode: Map<string, number>,
): string[] {
  const impacted = deriveImpactedNodes(topology, failedNode, downstreamImpactByNode);
  const ordered: string[] = [];
  const visited = new Set<string>();
  const stack = [failedNode];

  while (stack.length) {
    const current = stack.shift();
    if (!current || visited.has(current) || !impacted.has(current)) {
      continue;
    }
    visited.add(current);
    ordered.push(current);

    const children = (topology.outgoing.get(current) ?? [])
      .filter((child) => impacted.has(child) && !visited.has(child))
      .sort((left, right) => {
        const leftSeq = downstreamImpactByNode.get(left) ?? Number.POSITIVE_INFINITY;
        const rightSeq = downstreamImpactByNode.get(right) ?? Number.POSITIVE_INFINITY;
        return leftSeq - rightSeq || left.localeCompare(right);
      });
    stack.push(...children);
  }

  for (const node of impacted) {
    if (!visited.has(node)) {
      ordered.push(node);
    }
  }
  return ordered;
}

interface StudioRunSignalMetrics {
  pinnedEventCount: number;
  mockEventCount: number;
  totalTokens: number | null;
  totalCostUsd: number | null;
  runKind: "live" | "mock" | "pinned" | "mixed";
}

function collectRunSignalMetrics(run: StudioRunRecord): StudioRunSignalMetrics {
  const events = run.events ?? [];
  const sessionMetadata = run.session.metadata ?? {};
  let pinnedEventCount = 0;
  let mockEventCount = 0;
  let tokenTotal = 0;
  let tokenSeen = false;
  let costTotal = 0;
  let costSeen = false;

  for (const event of events) {
    if (payloadHasFlag(event.payload, "pinned")) {
      pinnedEventCount += 1;
    }
    if (payloadHasFlag(event.payload, "mock")) {
      mockEventCount += 1;
    }
    const tokens = collectNumericSignals(event.payload, [
      "total_tokens",
      "totalTokens",
      "tokens",
      "inputTokens",
      "outputTokens",
    ]);
    if (tokens.length > 0) {
      tokenSeen = true;
      tokenTotal += Math.max(...tokens);
    }
    const costs = collectNumericSignals(event.payload, [
      "total_usd",
      "totalUsd",
      "cost_usd",
      "costUsd",
      "input_usd",
      "output_usd",
    ]);
    if (costs.length > 0) {
      costSeen = true;
      costTotal += Math.max(...costs);
    }
  }

  const metadataNodePins = isRecord(sessionMetadata.nodePins) || isRecord(sessionMetadata.node_pins);
  const metadataMock = metadataNodePins || readNestedBoolean(sessionMetadata, ["scenario", "useNodePins"]) === true;
  const hasPinned = pinnedEventCount > 0 || metadataNodePins;
  const hasMock = mockEventCount > 0 || metadataMock;
  const runKind = hasPinned && mockEventCount > pinnedEventCount
    ? "mixed"
    : hasPinned
      ? "pinned"
      : hasMock
        ? "mock"
        : "live";

  return {
    pinnedEventCount,
    mockEventCount,
    totalTokens: tokenSeen ? tokenTotal : null,
    totalCostUsd: costSeen ? Number(costTotal.toFixed(8)) : null,
    runKind,
  };
}

function buildRegressionSummary(
  left: StudioRunRecord,
  right: StudioRunRecord,
  leftMetrics: StudioRunSignalMetrics,
  rightMetrics: StudioRunSignalMetrics,
  nodeComparisons: StudioNodeComparison[],
): StudioRunRegressionSummary {
  const reasons: string[] = [];
  let severity: StudioRunRegressionSummary["severity"] = "pass";
  const appliedThresholds = readRegressionThresholds(right);

  if (right.errorCount > left.errorCount) {
    severity = "fail";
    reasons.push(`erros aumentaram de ${left.errorCount} para ${right.errorCount}`);
  }
  if (left.isComplete && !right.isComplete) {
    severity = "fail";
    reasons.push("candidate deixou de finalizar uma run que antes finalizava");
  }
  if (left.status !== "error" && right.status === "error") {
    severity = "fail";
    reasons.push(`status regrediu de ${left.status} para error`);
  }

  const changedSharedNodes = nodeComparisons.filter((node) => node.inLeft && node.inRight && node.changed).length;
  if (changedSharedNodes > 0) {
    if (severity === "pass") {
      severity = "warn";
    }
    reasons.push(`${changedSharedNodes} nó(s) em comum mudaram state/output`);
  }

  addGrowthReason(reasons, leftMetrics.totalTokens, rightMetrics.totalTokens, "tokens totais", appliedThresholds.tokenGrowthPct);
  addGrowthReason(reasons, leftMetrics.totalCostUsd, rightMetrics.totalCostUsd, "custo estimado", appliedThresholds.costGrowthPct);
  addGrowthReason(reasons, calcDurationMs(left), calcDurationMs(right), "duração", appliedThresholds.durationGrowthPct);
  if (severity === "pass" && reasons.length > 0) {
    severity = "warn";
  }

  const comparesPinnedToLive =
    (leftMetrics.runKind === "pinned" && rightMetrics.runKind === "live") ||
    (leftMetrics.runKind === "live" && rightMetrics.runKind === "pinned");
  const verdict = severity === "fail"
    ? "Regressão funcional detectada."
    : severity === "warn"
      ? "Mudanças detectadas; revisar antes de aprovar."
      : "Sem regressão detectada.";

  return {
    severity,
    comparesPinnedToLive,
    baselineRunId: left.id,
    candidateRunId: right.id,
    verdict,
    reasons,
    appliedThresholds,
  };
}

function readRegressionThresholds(run: StudioRunRecord): StudioRunRegressionThresholds {
  const sessionMetadata = run.session.metadata ?? {};
  const scenarioMetadata = isRecord(sessionMetadata.scenario) ? sessionMetadata.scenario : {};
  const rawThresholds = isRecord(scenarioMetadata.regressionThresholds)
    ? scenarioMetadata.regressionThresholds
    : isRecord(sessionMetadata.regressionThresholds)
      ? sessionMetadata.regressionThresholds
      : {};
  return {
    tokenGrowthPct: normalizeThresholdPercent(rawThresholds.tokenGrowthPct, DEFAULT_REGRESSION_THRESHOLDS.tokenGrowthPct),
    costGrowthPct: normalizeThresholdPercent(rawThresholds.costGrowthPct, DEFAULT_REGRESSION_THRESHOLDS.costGrowthPct),
    durationGrowthPct: normalizeThresholdPercent(rawThresholds.durationGrowthPct, DEFAULT_REGRESSION_THRESHOLDS.durationGrowthPct),
  };
}

function normalizeThresholdPercent(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(1000, Math.round(numeric)));
}

function addGrowthReason(
  reasons: string[],
  left: number | null,
  right: number | null,
  label: string,
  thresholdPct: number,
): void {
  if (left === null || right === null || left <= 0) {
    return;
  }
  const growth = (right - left) / left;
  if (growth * 100 > thresholdPct) {
    reasons.push(`${label} aumentou ${Math.round(growth * 100)}% (limite ${thresholdPct}%)`);
  }
}

function nullableDelta(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : Number((right - left).toFixed(8));
}

function payloadHasFlag(value: unknown, flag: "mock" | "pinned"): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (value[flag] === true) {
    return true;
  }
  for (const nestedKey of ["llm", "custom", "http", "transform", "database", "file", "rag", "approval", "score", "analytics", "safety"]) {
    const nested = value[nestedKey];
    if (isRecord(nested) && nested[flag] === true) {
      return true;
    }
  }
  return false;
}

function collectNumericSignals(value: unknown, keys: string[], depth = 0): number[] {
  if (depth > 4) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectNumericSignals(item, keys, depth + 1));
  }
  if (!isRecord(value)) {
    return [];
  }
  const found: number[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (keys.includes(key) && typeof item === "number" && Number.isFinite(item)) {
      found.push(item);
    }
    if (isRecord(item) || Array.isArray(item)) {
      found.push(...collectNumericSignals(item, keys, depth + 1));
    }
  }
  return found;
}

function readNestedBoolean(value: unknown, pathParts: string[]): boolean | null {
  let current: unknown = value;
  for (const part of pathParts) {
    if (!isRecord(current)) {
      return null;
    }
    current = current[part];
  }
  return typeof current === "boolean" ? current : null;
}

function buildNodeComparisons(left: StudioRunRecord, right: StudioRunRecord): StudioNodeComparison[] {
  const leftByNode = collectLatestNodeStates(left.stateSnapshots);
  const rightByNode = collectLatestNodeStates(right.stateSnapshots);
  const nodeIds = Array.from(new Set([...leftByNode.keys(), ...rightByNode.keys()])).sort();

  return nodeIds.map((nodeId) => {
    const leftNode = leftByNode.get(nodeId);
    const rightNode = rightByNode.get(nodeId);
    const stateDiff = diffRecords(leftNode?.state ?? null, rightNode?.state ?? null).slice(0, 120);
    const outputDiff = diffRecords(leftNode?.output, rightNode?.output).slice(0, 120);

    return {
      nodeId,
      inLeft: Boolean(leftNode),
      inRight: Boolean(rightNode),
      changed: stateDiff.length > 0 || outputDiff.length > 0,
      stateDiff,
      outputDiff,
      left: {
        seq: leftNode?.seq ?? null,
        eventType: leftNode?.eventType ?? null,
        status: leftNode?.status ?? null,
        phase: leftNode?.phase ?? null,
        turn: leftNode?.turn ?? null,
      },
      right: {
        seq: rightNode?.seq ?? null,
        eventType: rightNode?.eventType ?? null,
        status: rightNode?.status ?? null,
        phase: rightNode?.phase ?? null,
        turn: rightNode?.turn ?? null,
      },
    };
  });
}

function collectLatestNodeStates(snapshots: StudioStateSnapshot[]): Map<
  string,
  {
    seq: number;
    eventType: string;
    status: string | null;
    phase: string | null;
    turn: number | null;
    state: Record<string, unknown>;
    output: unknown;
  }
> {
  const latest = new Map<
    string,
    {
      seq: number;
      eventType: string;
      status: string | null;
      phase: string | null;
      turn: number | null;
      state: Record<string, unknown>;
      output: unknown;
    }
  >();

  for (const snapshot of snapshots) {
    const nodes = snapshot.state.nodes;
    const outputs = snapshot.state.outputs;
    if (!isRecord(nodes) || !isRecord(outputs)) {
      continue;
    }

    for (const [nodeId, nodeState] of Object.entries(nodes)) {
      if (!isRecord(nodeState)) {
        continue;
      }
      latest.set(nodeId, {
        seq: snapshot.seq,
        eventType: snapshot.eventType,
        status: snapshot.status,
        phase: snapshot.phase,
        turn: snapshot.turn,
        state: cloneRecord(nodeState),
        output: outputs[nodeId],
      });
    }
  }

  return latest;
}

function calcDurationMs(run: StudioRunRecord): number | null {
  const started = new Date(run.createdAt).getTime();
  const finished = new Date(run.completedAt ?? run.updatedAt).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(finished)) {
    return null;
  }
  return Math.max(0, finished - started);
}

function matchStudioRunFilter(record: StudioRunRecord, options: StudioRunFilterOptions): boolean {
  if (options.status && record.status !== options.status) {
    return false;
  }
  if (options.phase && record.phase !== options.phase) {
    return false;
  }
  if (options.hasErrors === true && record.errorCount <= 0) {
    return false;
  }
  if (options.hasErrors === false && record.errorCount > 0) {
    return false;
  }
  if (options.isComplete !== undefined && record.isComplete !== options.isComplete) {
    return false;
  }
  const durationMs = calcDurationMs(record);
  if (options.minDurationMs !== undefined && durationMs !== null && durationMs < options.minDurationMs) {
    return false;
  }
  if (options.maxDurationMs !== undefined && durationMs !== null && durationMs > options.maxDurationMs) {
    return false;
  }
  const node = options.node?.trim().toLowerCase();
  if (node) {
    const nodeIds = collectNodeIds(record.events);
    const hasNode = nodeIds.some((nodeId) => nodeId.toLowerCase() === node);
    if (!hasNode) {
      return false;
    }
  }
  const q = options.q?.trim().toLowerCase();
  if (!q) {
    return true;
  }
  const searchable = [
    record.id,
    record.sessionId,
    record.status,
    record.phase,
    record.resourceName,
    record.runtimeUrl,
    record.flowVersion ?? "",
    record.sessionId,
    String(record.isComplete),
  ]
    .join(" ")
    .toLowerCase();
  return searchable.includes(q);
}

function runIdFromSession(sessionId: string): string {
  return normalizeRunId(`run-${sessionId}`);
}

function normalizeRunId(runId: string): string {
  const normalized = runId.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  if (!normalized || normalized.length > 160) {
    throw new WorkspaceError("runId inválido.", 400);
  }
  return normalized;
}

function parseSession(value: unknown): StudioSessionSnapshot {
  if (!isRecord(value)) {
    throw new WorkspaceError("session é obrigatório.", 400);
  }
  const sessionId = requiredString(value.session_id, "session.session_id");
  return {
    session_id: sessionId,
    status: requiredString(value.status, "session.status"),
    phase: requiredString(value.phase, "session.phase"),
    turn: requiredInteger(value.turn, "session.turn"),
    max_turns: requiredInteger(value.max_turns, "session.max_turns"),
    metadata: isRecord(value.metadata) ? value.metadata : {},
    is_complete: Boolean(value.is_complete),
  };
}

function parseMessages(value: unknown): StudioMessageSnapshot[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new WorkspaceError("transcript deve ser array.", 400);
  }
  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new WorkspaceError(`transcript[${index}] inválido.`, 400);
    }
    return {
      seq: requiredInteger(item.seq, `transcript[${index}].seq`),
      role: requiredString(item.role, `transcript[${index}].role`),
      code: typeof item.code === "string" ? item.code : null,
      content: requiredString(item.content, `transcript[${index}].content`),
      metadata: isRecord(item.metadata) ? item.metadata : {},
    };
  });
}

function parseEvents(value: unknown): StudioEventSnapshot[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new WorkspaceError("events deve ser array.", 400);
  }
  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new WorkspaceError(`events[${index}] inválido.`, 400);
    }
    return {
      seq: requiredInteger(item.seq, `events[${index}].seq`),
      event_type: requiredString(item.event_type, `events[${index}].event_type`),
      node: typeof item.node === "string" ? item.node : null,
      payload: isRecord(item.payload) ? item.payload : {},
    };
  });
}

function buildStateSnapshots(
  session: StudioSessionSnapshot,
  transcript: StudioMessageSnapshot[],
  events: StudioEventSnapshot[],
): StudioStateSnapshot[] {
  let currentState: Record<string, unknown> = {
    session: {
      session_id: session.session_id,
      status: "created",
      phase: "created",
      turn: 0,
      max_turns: session.max_turns,
      is_complete: false,
      metadata: session.metadata,
    },
    transcript: transcriptSummary(transcript),
    counters: {
      events: 0,
      messages: transcript.length,
      nodes: 0,
    },
    nodes: {},
    outputs: {},
  };

  return [...events]
    .sort((a, b) => a.seq - b.seq)
    .map((event, index) => {
      const previous = currentState;
      const payloadStatus = optionalPayloadString(event.payload.status);
      const payloadPhase = optionalPayloadString(event.payload.phase);
      const payloadTurn = optionalPayloadInteger(event.payload.turn);
      const nodeId = event.node ?? null;
      const nextState = cloneRecord(previous);
      const nodes = isRecord(nextState.nodes) ? cloneRecord(nextState.nodes) : {};
      const outputs = isRecord(nextState.outputs) ? cloneRecord(nextState.outputs) : {};
      const nodeOutput = extractNodeOutput(event.payload);

      nextState.session = {
        ...(isRecord(nextState.session) ? nextState.session : {}),
        session_id: session.session_id,
        status: payloadStatus ?? (index === events.length - 1 ? session.status : "running"),
        phase: payloadPhase ?? (index === events.length - 1 ? session.phase : "running"),
        turn: payloadTurn ?? (index === events.length - 1 ? session.turn : 0),
        max_turns: session.max_turns,
        is_complete: index === events.length - 1 ? session.is_complete : false,
        metadata: session.metadata,
      };
      nextState.current = {
        seq: event.seq,
        node: nodeId,
        event_type: event.event_type,
        handler: optionalPayloadString(event.payload.handler),
        status: payloadStatus,
        phase: payloadPhase,
        turn: payloadTurn,
      };
      if (nodeId) {
        nodes[nodeId] = {
          seq: event.seq,
          event_type: event.event_type,
          handler: optionalPayloadString(event.payload.handler),
          status: payloadStatus,
          phase: payloadPhase,
          turn: payloadTurn,
          payload: event.payload,
        };
        if (nodeOutput !== undefined) {
          outputs[nodeId] = nodeOutput;
        }
      }
      nextState.nodes = nodes;
      nextState.outputs = outputs;
      nextState.transcript = transcriptSummary(transcript);
      nextState.counters = {
        events: index + 1,
        messages: transcript.length,
        nodes: Object.keys(nodes).length,
      };

      currentState = nextState;
      return {
        seq: event.seq,
        node: nodeId,
        eventType: event.event_type,
        status: payloadStatus,
        phase: payloadPhase,
        turn: payloadTurn,
        state: nextState,
        diff: diffRecords(previous, nextState),
      };
    });
}

function transcriptSummary(transcript: StudioMessageSnapshot[]): Record<string, unknown> {
  const lastUser = [...transcript].reverse().find((message) => message.role === "user");
  const lastAssistant = [...transcript].reverse().find((message) => message.role === "assistant");
  return {
    message_count: transcript.length,
    last_user: lastUser ? { seq: lastUser.seq, content: lastUser.content } : null,
    last_assistant: lastAssistant ? { seq: lastAssistant.seq, code: lastAssistant.code ?? null, content: lastAssistant.content } : null,
  };
}

function extractNodeOutput(payload: Record<string, unknown>): unknown {
  for (const key of ["custom", "http", "transform", "database", "file", "rag", "approval", "score", "analytics", "safety"]) {
    if (key in payload) {
      return payload[key];
    }
  }
  const outputKeys = Object.keys(payload).filter((key) => !["status", "phase", "turn", "handler", "source_message_id"].includes(key));
  if (outputKeys.length) {
    return Object.fromEntries(outputKeys.map((key) => [key, payload[key]]));
  }
  return undefined;
}

function diffRecords(before: unknown, after: unknown): StudioStateDiffEntry[] {
  const diffs = diffValue("", before, after, 0);
  return diffs.slice(0, 120);
}

function diffValue(pathName: string, before: unknown, after: unknown, depth: number): StudioStateDiffEntry[] {
  if (stableJson(before) === stableJson(after)) {
    return [];
  }
  if (isRecord(before) && isRecord(after) && depth < 4) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((key) => diffValue(pathName ? `${pathName}.${key}` : key, before[key], after[key], depth + 1));
  }
  const kind = before === undefined ? "added" : after === undefined ? "removed" : "changed";
  return [{ path: pathName || "$", kind, before, after }];
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
  }
  return value;
}

function optionalPayloadString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optionalPayloadInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function parseLogs(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new WorkspaceError("logs deve ser array.", 400);
  }
  return value.map((item) => String(item));
}

function parseOptionalString(value: unknown, name: string): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value !== "string") {
    throw new WorkspaceError(`${name} deve ser string quando informado.`, 400);
  }
  return value;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkspaceError(`${name} deve ser string não vazia.`, 400);
  }
  return value;
}

function requiredInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new WorkspaceError(`${name} deve ser inteiro.`, 400);
  }
  return value;
}

function isErrorEvent(event: StudioEventSnapshot): boolean {
  if (event.event_type.toLowerCase().includes("error") || event.event_type.toLowerCase().includes("failed")) {
    return true;
  }
  const status = event.payload.status;
  return typeof status === "string" && ["error", "failed"].includes(status.toLowerCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
