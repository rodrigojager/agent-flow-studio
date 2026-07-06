import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadFlowById, WorkspaceError } from "./workspace.ts";
import type { AgentFlow } from "@agent-flow-builder/flow-spec";

type SafetySeverity = "low" | "medium" | "high" | "critical";
type SafetyDecisionValue = "allow" | "safe_redirect" | "block";
type SafetyAction = "warn" | "safe_redirect" | "block";
type SafetyReviewStatus = "pending" | "accepted" | "rejected";
type SafetyHarnessReviewerRole = "owner" | "operator" | "reviewer" | "viewer";

interface SafetyRuleInput {
  id: string;
  label?: string;
  description?: string;
  match: string;
  matchType?: "contains" | "regex" | "empty";
  category?: string;
  severity?: SafetySeverity;
  action?: SafetyAction;
  reason?: string;
  safeResponse?: string;
}

interface SafetyPolicyInput {
  mode: "default" | "custom" | "default_and_custom";
  severityThreshold: SafetySeverity;
  fallbackResponse: string;
  rules: SafetyRuleInput[];
}

interface SafetyHarnessExternalConfig {
  endpointUrl: string;
  headers: Record<string, string>;
  blockedPath: string;
  decisionPath: string;
  severityPath: string;
  reasonPath: string;
  categoryPath: string;
  safeResponsePath: string;
  scorePath: string;
  timeoutMs: number;
}

export interface SafetyHarnessDecision {
  blocked: boolean;
  decision: SafetyDecisionValue;
  category: string | null;
  reason: string;
  safeResponse: string | null;
  severity: SafetySeverity;
  action: SafetyAction | null;
  ruleId: string | null;
  ruleLabel: string | null;
  matchType: string | null;
  matchedText: string | null;
  score: number | null;
  source: "local" | "external" | "combined";
}

export interface SafetyHarnessRunRecord {
  id: string;
  flowId: string;
  flowVersion: string;
  nodeId: string;
  stage: "input" | "output" | "context";
  inputPreview: string;
  local: SafetyHarnessDecision;
  external: SafetyHarnessDecision | null;
  final: SafetyHarnessDecision;
  review: {
    status: SafetyReviewStatus;
    reviewer: string;
    role: SafetyHarnessReviewerRole;
    note: string;
    reviewedAt: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

export interface SafetyHarnessResolutionRef {
  id: string;
  flowId: string;
  nodeId: string;
  stage: SafetyHarnessRunRecord["stage"];
  createdAt: string;
  updatedAt: string;
  reviewStatus: SafetyReviewStatus;
  reviewer: string;
  reviewerRole: SafetyHarnessReviewerRole;
  reviewedAt: string | null;
  reviewNoteHash: string | null;
  localDecisionHash: string;
  externalDecisionHash: string | null;
  finalDecisionHash: string;
}

export interface SafetyHarnessResolutionRecord {
  resolutionId: string;
  runId: string;
  resolvedAt: string;
  resolvedBy: string;
  resolvedRole: SafetyHarnessReviewerRole;
  resolution: "latest_updated_at";
  keptRef: SafetyHarnessResolutionRef;
  discardedRefs: SafetyHarnessResolutionRef[];
  governance: {
    excludesRawInput: true;
    excludesMatchedText: true;
    excludesExternalHeaders: true;
    excludesSecretValues: true;
  };
}

export interface SafetyHarnessHistory {
  format: "agent-flow-builder.safety-harness-history.v1";
  exportedAt: string;
  flow: {
    id: string;
    name: string;
    version: string;
  };
  runCount: number;
  blockedCount: number;
  externalCount: number;
  pendingReviewCount: number;
  acceptedCount: number;
  rejectedCount: number;
  resolutionHistoryCount: number;
  resolutionHistory: SafetyHarnessResolutionRecord[];
  runs: SafetyHarnessRunRecord[];
}

export interface SafetyHarnessCentralSyncStatus {
  format: typeof SAFETY_HARNESS_CENTRAL_STATUS_FORMAT;
  generatedAt: string;
  configured: boolean;
  urlConfigured: boolean;
  tokenConfigured: boolean;
  timeoutMs: number;
  invalidReason: string | null;
  lastSyncedAt: string | null;
  statusCode: number | null;
  pushedRunCount: number | null;
  pulledRunCount: number | null;
  error: string | null;
  governance: {
    excludesRawInput: true;
    excludesMatchedText: true;
    sendsInputPreview: false;
    sendsSafetyDecisions: true;
    sendsHumanReviews: true;
    excludesExternalHeaders: true;
    excludesSecretValues: true;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
    storesCentralToken: false;
    configuredUrlEnv: typeof SAFETY_HARNESS_CENTRAL_URL_ENV;
    configuredTokenEnv: typeof SAFETY_HARNESS_CENTRAL_TOKEN_ENV;
    configuredTimeoutEnv: typeof SAFETY_HARNESS_CENTRAL_TIMEOUT_ENV;
    maxPayloadBytes: typeof SAFETY_HARNESS_CENTRAL_MAX_BYTES;
  };
}

export interface SafetyHarnessCentralSyncResult {
  format: typeof SAFETY_HARNESS_CENTRAL_SYNC_RESULT_FORMAT;
  flowId: string;
  history: SafetyHarnessHistory;
  central: SafetyHarnessCentralSyncStatus;
  pushedRunCount: number;
  pulledRunCount: number;
  governance: {
    excludesRawInput: true;
    excludesMatchedText: true;
    sendsInputPreview: false;
    sendsSafetyDecisions: true;
    sendsHumanReviews: true;
    excludesExternalHeaders: true;
    excludesSecretValues: true;
    centralAuthTokenInHeaderOnly: true;
    centralAuthTokenInBody: false;
  };
}

interface SafetyHarnessHistoryDiffRef {
  id: string;
  flowId: string;
  flowVersion: string;
  nodeId: string;
  stage: SafetyHarnessRunRecord["stage"];
  createdAt: string;
  updatedAt: string;
  blocked: boolean;
  decision: SafetyDecisionValue;
  category: string | null;
  severity: SafetySeverity;
  action: SafetyAction | null;
  source: SafetyHarnessDecision["source"];
  hasExternalDecision: boolean;
  reviewStatus: SafetyReviewStatus;
  reviewerRole: SafetyHarnessReviewerRole;
  reviewedAt: string | null;
  reviewerHash: string | null;
  reviewNoteHash: string | null;
  localDecisionHash: string;
  externalDecisionHash: string | null;
  finalDecisionHash: string;
  aggregateHash: string;
}

interface SafetyHarnessHistoryDiffSection {
  id: "added" | "removed" | "changed" | "unchanged";
  label: string;
  count: number;
  items: Array<{
    runId: string;
    current: SafetyHarnessHistoryDiffRef | null;
    incoming: SafetyHarnessHistoryDiffRef | null;
  }>;
}

export interface SafetyHarnessHistoryDiffPackage {
  format: typeof SAFETY_HARNESS_HISTORY_DIFF_FORMAT;
  generatedAt: string;
  flow: {
    id: string;
    name: string;
    version: string;
  };
  packageHash: string;
  summary: {
    currentRunCount: number;
    incomingRunCount: number;
    currentResolutionHistoryCount: number;
    incomingResolutionHistoryCount: number;
    addedCount: number;
    removedCount: number;
    changedCount: number;
    unchangedCount: number;
    headline: string;
  };
  sections: SafetyHarnessHistoryDiffSection[];
  governance: {
    excludesRawInput: true;
    excludesInputPreview: true;
    excludesMatchedText: true;
    excludesExternalHeaders: true;
    excludesProviderRawPayloads: true;
    excludesSecretValues: true;
    includesOnlyRunRefsHashesAndAggregateReviewData: true;
  };
}

interface SafetyHarnessCentralSyncConfig {
  url: string | null;
  token: string | null;
  timeoutMs: number;
  invalidReason: string | null;
}

const SAFETY_HARNESS_HISTORY_FILE = ".agent-flow/safety-harness/runs.json";
const SAFETY_HARNESS_CENTRAL_SYNC_REQUEST_FORMAT = "agent-flow-builder.safety-harness-central-sync-request.v1";
const SAFETY_HARNESS_CENTRAL_SYNC_RESULT_FORMAT = "agent-flow-builder.safety-harness-central-sync-result.v1";
const SAFETY_HARNESS_CENTRAL_STATUS_FORMAT = "agent-flow-builder.safety-harness-central-sync-status.v1";
const SAFETY_HARNESS_HISTORY_DIFF_FORMAT = "agent-flow-builder.safety-harness-history-diff.v1";
const SAFETY_HARNESS_CENTRAL_URL_ENV = "AGENT_FLOW_SAFETY_HARNESS_CENTRAL_URL";
const SAFETY_HARNESS_CENTRAL_TOKEN_ENV = "AGENT_FLOW_SAFETY_HARNESS_CENTRAL_TOKEN";
const SAFETY_HARNESS_CENTRAL_TIMEOUT_ENV = "AGENT_FLOW_SAFETY_HARNESS_CENTRAL_TIMEOUT_MS";
const SAFETY_HARNESS_CENTRAL_TIMEOUT_MS = 5_000;
const SAFETY_HARNESS_CENTRAL_MAX_BYTES = 2_000_000;
const MAX_SAFETY_HARNESS_RUNS = 100;
const SEVERITY_SCORE: Record<SafetySeverity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

const DEFAULT_INPUT_RULES: SafetyRuleInput[] = [
  {
    id: "empty_input",
    matchType: "empty",
    match: "",
    category: "empty_input",
    action: "safe_redirect",
    reason: "Mensagem vazia.",
    safeResponse: "Envie uma mensagem com conteúdo para continuarmos.",
  },
  {
    id: "self_harm_1",
    match: "vou me matar",
    category: "self_harm",
    severity: "critical",
    action: "block",
    reason: "Termo sensível detectado: vou me matar",
    safeResponse: "Sinto muito que você esteja passando por isso. Procure apoio humano imediato. Se houver risco agora, ligue 188, 192 ou 190.",
  },
  {
    id: "self_harm_2",
    match: "quero me matar",
    category: "self_harm",
    severity: "critical",
    action: "block",
    reason: "Termo sensível detectado: quero me matar",
    safeResponse: "Sinto muito que você esteja passando por isso. Procure apoio humano imediato. Se houver risco agora, ligue 188, 192 ou 190.",
  },
  {
    id: "self_harm_3",
    match: "não aguento mais viver",
    category: "self_harm",
    severity: "critical",
    action: "block",
    reason: "Termo sensível detectado: não aguento mais viver",
    safeResponse: "Sinto muito que você esteja passando por isso. Procure apoio humano imediato. Se houver risco agora, ligue 188, 192 ou 190.",
  },
  {
    id: "self_harm_4",
    match: "nao aguento mais viver",
    category: "self_harm",
    severity: "critical",
    action: "block",
    reason: "Termo sensível detectado: nao aguento mais viver",
    safeResponse: "Sinto muito que você esteja passando por isso. Procure apoio humano imediato. Se houver risco agora, ligue 188, 192 ou 190.",
  },
  {
    id: "jailbreak_1",
    match: "ignore as regras",
    category: "jailbreak",
    severity: "high",
    action: "safe_redirect",
    reason: "Termo bloqueado detectado: ignore as regras",
    safeResponse: "Não posso seguir com esse pedido, mas posso continuar com uma resposta segura.",
  },
  {
    id: "jailbreak_2",
    match: "ignore o sistema",
    category: "jailbreak",
    severity: "high",
    action: "safe_redirect",
    reason: "Termo bloqueado detectado: ignore o sistema",
    safeResponse: "Não posso seguir com esse pedido, mas posso continuar com uma resposta segura.",
  },
  {
    id: "policy_leak_1",
    match: "vazar prompt",
    category: "policy_leak",
    severity: "high",
    action: "safe_redirect",
    reason: "Termo bloqueado detectado: vazar prompt",
    safeResponse: "Não posso seguir com esse pedido, mas posso continuar com uma resposta segura.",
  },
  {
    id: "secret_request_1",
    match: "senha secreta",
    category: "secret_request",
    severity: "high",
    action: "safe_redirect",
    reason: "Termo bloqueado detectado: senha secreta",
    safeResponse: "Não posso seguir com esse pedido, mas posso continuar com uma resposta segura.",
  },
];

const DEFAULT_OUTPUT_RULES: SafetyRuleInput[] = [
  {
    id: "policy_leak_output_1",
    match: "system prompt",
    category: "policy_leak",
    severity: "high",
    action: "safe_redirect",
    reason: "A saída tentou expor detalhes operacionais.",
    safeResponse: "Posso responder sem expor detalhes internos do agente.",
  },
  {
    id: "policy_leak_output_2",
    match: "chave interna",
    category: "policy_leak",
    severity: "high",
    action: "safe_redirect",
    reason: "A saída tentou expor detalhes operacionais.",
    safeResponse: "Posso responder sem expor detalhes internos do agente.",
  },
];

export async function listSafetyHarnessRuns(workspaceRoot: string, flowId: string): Promise<SafetyHarnessHistory> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  try {
    const raw = await readFile(safetyHarnessHistoryPath(loaded.flowRoot), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const history = normalizeSafetyHarnessHistory(parsed);
    if (!history) {
      throw new WorkspaceError("Histórico de Safety Harness inválido.", 422);
    }
    return buildSafetyHarnessHistory(loaded.flow, history.runs, history.resolutionHistory);
  } catch (error) {
    if (isFileNotFound(error)) {
      return buildSafetyHarnessHistory(loaded.flow, []);
    }
    if (error instanceof WorkspaceError) {
      throw error;
    }
    throw new WorkspaceError("Falha ao ler histórico de Safety Harness.", 500, error);
  }
}

export async function evaluateSafetyHarness(workspaceRoot: string, flowId: string, payload: unknown): Promise<SafetyHarnessHistory> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  if (!isRecord(payload)) {
    throw new WorkspaceError("Payload do Safety Harness deve ser objeto.", 400);
  }
  const nodeId = requiredString(payload.nodeId, "nodeId");
  const stage = normalizeStage(payload.stage);
  const text = typeof payload.text === "string" ? payload.text : "";
  const policy = normalizeSafetyPolicy(payload.policy);
  const externalConfig = normalizeExternalConfig(payload.external);
  const local = evaluateLocalSafety(text, stage, policy);
  const external = externalConfig ? await evaluateExternalSafety(text, stage, nodeId, policy, local, externalConfig) : null;
  const final = combineSafetyDecisions(local, external);
  const now = new Date().toISOString();
  const run: SafetyHarnessRunRecord = {
    id: `safety-run-${Date.now()}`,
    flowId: loaded.flow.id,
    flowVersion: loaded.flow.version,
    nodeId,
    stage,
    inputPreview: inputPreview(text),
    local,
    external,
    final,
    review: {
      status: final.blocked || external ? "pending" : "accepted",
      reviewer: final.blocked || external ? "" : "auto",
      role: "reviewer",
      note: final.blocked || external ? "" : "Avaliação local permitida sem provider externo.",
      reviewedAt: final.blocked || external ? null : now,
    },
    createdAt: now,
    updatedAt: now,
  };
  const current = await listSafetyHarnessRuns(workspaceRoot, flowId);
  const history = buildSafetyHarnessHistory(loaded.flow, [run, ...current.runs], current.resolutionHistory);
  await writeSafetyHarnessHistory(loaded.flowRoot, history);
  return history;
}

export async function reviewSafetyHarnessRun(
  workspaceRoot: string,
  flowId: string,
  runId: string,
  payload: unknown,
): Promise<SafetyHarnessHistory> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  if (!isRecord(payload)) {
    throw new WorkspaceError("Payload de revisão do Safety Harness deve ser objeto.", 400);
  }
  const status = normalizeReviewStatus(payload.status);
  const reviewer = typeof payload.reviewer === "string" ? payload.reviewer.trim() : "local-user";
  const role = normalizeSafetyHarnessReviewerRole(payload.role);
  assertSafetyHarnessReviewMutationAllowed(role);
  const note = typeof payload.note === "string" ? payload.note.trim() : "";
  const now = new Date().toISOString();
  const current = await listSafetyHarnessRuns(workspaceRoot, flowId);
  let found = false;
  const runs = current.runs.map((run) => {
    if (run.id !== runId) {
      return run;
    }
    found = true;
    return {
      ...run,
      review: {
        status,
        reviewer: reviewer || "local-user",
        role,
        note,
        reviewedAt: status === "pending" ? null : now,
      },
      updatedAt: now,
    };
  });
  if (!found) {
    throw new WorkspaceError("Run do Safety Harness não encontrado.", 404);
  }
  const history = buildSafetyHarnessHistory(loaded.flow, runs, current.resolutionHistory);
  await writeSafetyHarnessHistory(loaded.flowRoot, history);
  return history;
}

export async function loadSafetyHarnessCentralSyncStatus(): Promise<SafetyHarnessCentralSyncStatus> {
  return buildSafetyHarnessCentralSyncStatus(safetyHarnessCentralSyncConfig());
}

export async function syncCentralSafetyHarness(workspaceRoot: string, flowId: string): Promise<SafetyHarnessCentralSyncResult> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const config = safetyHarnessCentralSyncConfig();
  if (config.invalidReason) {
    throw new WorkspaceError(`Configuração da central de Safety Harness inválida: ${config.invalidReason}`, 422);
  }
  if (!config.url) {
    throw new WorkspaceError("Central de Safety Harness não configurada.", 400);
  }
  const existing = await listSafetyHarnessRuns(workspaceRoot, flowId);
  const outgoing = sanitizeSafetyHarnessHistoryForCentral(existing);
  const fetched = await fetchCentralSafetyHarnessSync(config, flowId, outgoing);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fetched.body) as unknown;
  } catch (error) {
    throw new WorkspaceError("Resposta central de Safety Harness não é JSON válido.", 502, error);
  }
  const centralHistoryPayload = isRecord(parsed) && parsed.history !== undefined ? parsed.history : parsed;
  const incoming = normalizeSafetyHarnessHistory(centralHistoryPayload);
  if (!incoming) {
    throw new WorkspaceError("Resposta central de Safety Harness não respeita o formato esperado.", 502);
  }
  const sanitizedIncoming = sanitizeSafetyHarnessHistoryForCentral(incoming);
  const next = buildSafetyHarnessHistory(loaded.flow, [...existing.runs, ...sanitizedIncoming.runs], [
    ...existing.resolutionHistory,
    ...sanitizedIncoming.resolutionHistory,
  ]);
  await writeSafetyHarnessHistory(loaded.flowRoot, next);
  const syncedAt = new Date().toISOString();
  return {
    format: SAFETY_HARNESS_CENTRAL_SYNC_RESULT_FORMAT,
    flowId,
    history: next,
    central: buildSafetyHarnessCentralSyncStatus(config, {
      lastSyncedAt: syncedAt,
      statusCode: fetched.statusCode,
      pushedRunCount: outgoing.runCount,
      pulledRunCount: sanitizedIncoming.runCount,
      error: null,
    }),
    pushedRunCount: outgoing.runCount,
    pulledRunCount: sanitizedIncoming.runCount,
    governance: {
      excludesRawInput: true,
      excludesMatchedText: true,
      sendsInputPreview: false,
      sendsSafetyDecisions: true,
      sendsHumanReviews: true,
      excludesExternalHeaders: true,
      excludesSecretValues: true,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  };
}

export async function compareSafetyHarnessHistory(
  workspaceRoot: string,
  flowId: string,
  payload: unknown,
): Promise<SafetyHarnessHistoryDiffPackage> {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const current = await listSafetyHarnessRuns(workspaceRoot, flowId);
  const incomingRaw = normalizeSafetyHarnessHistory(isRecord(payload) && payload.history !== undefined ? payload.history : payload);
  if (!incomingRaw) {
    throw new WorkspaceError("Payload de comparação de Safety Harness inválido.", 400);
  }
  const incoming = buildSafetyHarnessHistory(loaded.flow, incomingRaw.runs, incomingRaw.resolutionHistory);
  const currentById = new Map(current.runs.map((run) => [run.id, run]));
  const incomingById = new Map(incoming.runs.map((run) => [run.id, run]));
  const sections: SafetyHarnessHistoryDiffSection[] = [
    { id: "added", label: "Novos no pacote recebido", count: 0, items: [] },
    { id: "removed", label: "Ausentes no pacote recebido", count: 0, items: [] },
    { id: "changed", label: "Alterados", count: 0, items: [] },
    { id: "unchanged", label: "Iguais", count: 0, items: [] },
  ];
  const bySection = new Map(sections.map((section) => [section.id, section]));
  for (const id of Array.from(new Set([...currentById.keys(), ...incomingById.keys()])).sort()) {
    const currentRun = currentById.get(id) ?? null;
    const incomingRun = incomingById.get(id) ?? null;
    const currentRef = currentRun ? safetyHarnessHistoryDiffRef(currentRun) : null;
    const incomingRef = incomingRun ? safetyHarnessHistoryDiffRef(incomingRun) : null;
    const sectionId: SafetyHarnessHistoryDiffSection["id"] =
      currentRun && !incomingRun
        ? "removed"
        : !currentRun && incomingRun
          ? "added"
          : currentRef && incomingRef && currentRef.aggregateHash !== incomingRef.aggregateHash
            ? "changed"
            : "unchanged";
    bySection.get(sectionId)?.items.push({ runId: id, current: currentRef, incoming: incomingRef });
  }
  for (const section of sections) {
    section.count = section.items.length;
  }
  const summary = {
    currentRunCount: current.runCount,
    incomingRunCount: incoming.runCount,
    currentResolutionHistoryCount: current.resolutionHistoryCount,
    incomingResolutionHistoryCount: incoming.resolutionHistoryCount,
    addedCount: bySection.get("added")?.count ?? 0,
    removedCount: bySection.get("removed")?.count ?? 0,
    changedCount: bySection.get("changed")?.count ?? 0,
    unchangedCount: bySection.get("unchanged")?.count ?? 0,
    headline: "",
  };
  summary.headline = `${summary.addedCount} novo(s), ${summary.removedCount} ausente(s), ${summary.changedCount} alterado(s), ${summary.unchangedCount} igual(is).`;
  const packageHash = shortSafetyHash({ flowId, summary, sections });
  return {
    format: SAFETY_HARNESS_HISTORY_DIFF_FORMAT,
    generatedAt: new Date().toISOString(),
    flow: {
      id: loaded.flow.id,
      name: loaded.flow.name,
      version: loaded.flow.version,
    },
    packageHash,
    summary,
    sections,
    governance: {
      excludesRawInput: true,
      excludesInputPreview: true,
      excludesMatchedText: true,
      excludesExternalHeaders: true,
      excludesProviderRawPayloads: true,
      excludesSecretValues: true,
      includesOnlyRunRefsHashesAndAggregateReviewData: true,
    },
  };
}

function evaluateLocalSafety(
  text: string,
  stage: "input" | "output" | "context",
  policy: SafetyPolicyInput,
): SafetyHarnessDecision {
  const rules: SafetyRuleInput[] = [];
  if (policy.mode === "default" || policy.mode === "default_and_custom") {
    rules.push(...(stage === "output" ? DEFAULT_OUTPUT_RULES : DEFAULT_INPUT_RULES));
  }
  if (policy.mode === "custom" || policy.mode === "default_and_custom") {
    rules.push(...policy.rules);
  }
  const normalized = text.trim().toLowerCase();
  for (const rule of rules) {
    const decision = evaluateSafetyRule(rule, text, normalized, policy.severityThreshold, policy.fallbackResponse);
    if (decision) {
      return decision;
    }
  }
  return {
    blocked: false,
    decision: "allow",
    category: null,
    reason: "Nenhuma regra de safety acionada.",
    safeResponse: null,
    severity: "low",
    action: null,
    ruleId: null,
    ruleLabel: null,
    matchType: null,
    matchedText: null,
    score: null,
    source: "local",
  };
}

function evaluateSafetyRule(
  rule: SafetyRuleInput,
  rawText: string,
  normalizedText: string,
  threshold: SafetySeverity,
  fallbackResponse: string,
): SafetyHarnessDecision | null {
  const matchType = rule.matchType ?? "contains";
  const pattern = rule.match ?? "";
  let matchedText: string | null = null;
  if (matchType === "empty") {
    if (normalizedText) {
      return null;
    }
    matchedText = "";
  } else if (matchType === "regex") {
    try {
      const match = rawText.match(new RegExp(pattern, "i"));
      if (!match) {
        return null;
      }
      matchedText = match[0] ?? pattern;
    } catch (error) {
      return blockedDecision({
        decision: "safe_redirect",
        severity: "high",
        action: "safe_redirect",
        category: "invalid_safety_rule",
        reason: `Regex inválida na regra ${rule.id}: ${error instanceof Error ? error.message : String(error)}`,
        safeResponse: fallbackResponse || "A política de segurança precisa ser revisada antes de continuar.",
        rule,
        matchType,
        matchedText: pattern,
        source: "local",
      });
    }
  } else {
    if (!normalizedText.includes(pattern.toLowerCase())) {
      return null;
    }
    matchedText = pattern;
  }
  const severity = normalizeSeverity(rule.severity);
  let action = normalizeAction(rule.action);
  if (SEVERITY_SCORE[severity] < SEVERITY_SCORE[threshold]) {
    action = "warn";
  }
  if (action === "warn") {
    return {
      blocked: false,
      decision: "allow",
      category: rule.category ?? "safety_warning",
      reason: rule.reason ?? `Regra de safety acionada em modo aviso: ${rule.id || matchedText}.`,
      safeResponse: null,
      severity,
      action,
      ruleId: rule.id,
      ruleLabel: rule.label ?? null,
      matchType,
      matchedText,
      score: null,
      source: "local",
    };
  }
  return blockedDecision({
    decision: action === "block" ? "block" : "safe_redirect",
    severity,
    action,
    category: rule.category ?? "safety_policy",
    reason: rule.reason ?? `Regra de safety acionada: ${rule.id || matchedText}.`,
    safeResponse: rule.safeResponse || fallbackResponse || "Não posso seguir com esse pedido, mas posso continuar com uma resposta segura.",
    rule,
    matchType,
    matchedText,
    source: "local",
  });
}

async function evaluateExternalSafety(
  text: string,
  stage: string,
  nodeId: string,
  policy: SafetyPolicyInput,
  local: SafetyHarnessDecision,
  config: SafetyHarnessExternalConfig,
): Promise<SafetyHarnessDecision> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(config.endpointUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...config.headers,
      },
      body: JSON.stringify({ text, stage, nodeId, policy, local }),
      signal: controller.signal,
    });
    const rawText = await response.text();
    const raw = parseJsonBody(rawText);
    if (!response.ok) {
      throw new WorkspaceError(`Provider externo de safety retornou HTTP ${response.status}.`, 502, raw);
    }
    const blocked = normalizeBoolean(readJsonPath(raw, config.blockedPath).value);
    const decisionValue = normalizeDecisionValue(readJsonPath(raw, config.decisionPath).value, blocked ? "safe_redirect" : "allow");
    const severity = normalizeSeverity(readJsonPath(raw, config.severityPath).value);
    const reason = normalizeString(readJsonPath(raw, config.reasonPath).value, blocked ? "Provider externo bloqueou a entrada." : "Provider externo permitiu.");
    const category = normalizeNullableString(readJsonPath(raw, config.categoryPath).value);
    const safeResponse = normalizeNullableString(readJsonPath(raw, config.safeResponsePath).value);
    const score = normalizeScore(readJsonPath(raw, config.scorePath).value);
    return {
      blocked: blocked || decisionValue === "block" || decisionValue === "safe_redirect",
      decision: decisionValue,
      category,
      reason,
      safeResponse,
      severity,
      action: decisionValue === "allow" ? null : decisionValue === "block" ? "block" : "safe_redirect",
      ruleId: null,
      ruleLabel: null,
      matchType: null,
      matchedText: null,
      score,
      source: "external",
    };
  } catch (error) {
    if (error instanceof WorkspaceError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new WorkspaceError(`Provider externo de safety excedeu timeout de ${config.timeoutMs}ms.`, 504);
    }
    throw new WorkspaceError(error instanceof Error ? error.message : "Falha ao executar provider externo de safety.", 502);
  } finally {
    clearTimeout(timeout);
  }
}

function combineSafetyDecisions(local: SafetyHarnessDecision, external: SafetyHarnessDecision | null): SafetyHarnessDecision {
  if (!external) {
    return local;
  }
  if (external.blocked && !local.blocked) {
    return { ...external, source: "external" };
  }
  if (local.blocked && !external.blocked) {
    return local;
  }
  if (local.blocked && external.blocked) {
    return SEVERITY_SCORE[external.severity] >= SEVERITY_SCORE[local.severity]
      ? { ...external, source: "combined", reason: `${external.reason} Local: ${local.reason}` }
      : { ...local, source: "combined", reason: `${local.reason} Externo: ${external.reason}` };
  }
  if (external.category || external.score !== null) {
    return { ...external, source: "external" };
  }
  return local;
}

function blockedDecision(input: {
  decision: SafetyDecisionValue;
  severity: SafetySeverity;
  action: SafetyAction;
  category: string;
  reason: string;
  safeResponse: string;
  rule: SafetyRuleInput;
  matchType: string;
  matchedText: string | null;
  source: "local" | "external" | "combined";
}): SafetyHarnessDecision {
  return {
    blocked: true,
    decision: input.decision,
    category: input.category,
    reason: input.reason,
    safeResponse: input.safeResponse,
    severity: input.severity,
    action: input.action,
    ruleId: input.rule.id,
    ruleLabel: input.rule.label ?? null,
    matchType: input.matchType,
    matchedText: input.matchedText,
    score: null,
    source: input.source,
  };
}

function safetyHarnessHistoryPath(flowRoot: string): string {
  return path.join(flowRoot, SAFETY_HARNESS_HISTORY_FILE);
}

async function writeSafetyHarnessHistory(flowRoot: string, history: SafetyHarnessHistory): Promise<void> {
  const historyPath = safetyHarnessHistoryPath(flowRoot);
  await mkdir(path.dirname(historyPath), { recursive: true });
  const tempPath = `${historyPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(history, null, 2)}\n`, "utf-8");
  await rename(tempPath, historyPath);
}

function safetyHarnessCentralSyncConfig(): SafetyHarnessCentralSyncConfig {
  const configuredUrl = process.env[SAFETY_HARNESS_CENTRAL_URL_ENV]?.trim() ?? "";
  let url: string | null = null;
  let invalidReason: string | null = null;
  if (configuredUrl) {
    try {
      url = validateSafetyHarnessCentralUrl(configuredUrl);
    } catch (error) {
      invalidReason = errorMessage(error);
    }
  }
  const timeoutValue = Number(process.env[SAFETY_HARNESS_CENTRAL_TIMEOUT_ENV] ?? "");
  const timeoutMs = Number.isFinite(timeoutValue)
    ? Math.min(Math.max(Math.floor(timeoutValue), 100), 60_000)
    : SAFETY_HARNESS_CENTRAL_TIMEOUT_MS;
  return {
    url,
    token: process.env[SAFETY_HARNESS_CENTRAL_TOKEN_ENV]?.trim() || null,
    timeoutMs,
    invalidReason,
  };
}

function buildSafetyHarnessCentralSyncStatus(
  config: SafetyHarnessCentralSyncConfig,
  sync?: Pick<
    SafetyHarnessCentralSyncStatus,
    "lastSyncedAt" | "statusCode" | "pushedRunCount" | "pulledRunCount" | "error"
  >,
): SafetyHarnessCentralSyncStatus {
  return {
    format: SAFETY_HARNESS_CENTRAL_STATUS_FORMAT,
    generatedAt: new Date().toISOString(),
    configured: Boolean(config.url && !config.invalidReason),
    urlConfigured: Boolean(process.env[SAFETY_HARNESS_CENTRAL_URL_ENV]?.trim()),
    tokenConfigured: Boolean(config.token),
    timeoutMs: config.timeoutMs,
    invalidReason: config.invalidReason,
    lastSyncedAt: sync?.lastSyncedAt ?? null,
    statusCode: sync?.statusCode ?? null,
    pushedRunCount: sync?.pushedRunCount ?? null,
    pulledRunCount: sync?.pulledRunCount ?? null,
    error: sync?.error ?? null,
    governance: {
      excludesRawInput: true,
      excludesMatchedText: true,
      sendsInputPreview: false,
      sendsSafetyDecisions: true,
      sendsHumanReviews: true,
      excludesExternalHeaders: true,
      excludesSecretValues: true,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
      storesCentralToken: false,
      configuredUrlEnv: SAFETY_HARNESS_CENTRAL_URL_ENV,
      configuredTokenEnv: SAFETY_HARNESS_CENTRAL_TOKEN_ENV,
      configuredTimeoutEnv: SAFETY_HARNESS_CENTRAL_TIMEOUT_ENV,
      maxPayloadBytes: SAFETY_HARNESS_CENTRAL_MAX_BYTES,
    },
  };
}

async function fetchCentralSafetyHarnessSync(
  config: SafetyHarnessCentralSyncConfig,
  flowId: string,
  history: SafetyHarnessHistory,
): Promise<{ statusCode: number; body: string }> {
  if (!config.url) {
    throw new WorkspaceError("Central de Safety Harness não configurada.", 400);
  }
  const body = JSON.stringify({
    format: SAFETY_HARNESS_CENTRAL_SYNC_REQUEST_FORMAT,
    generatedAt: new Date().toISOString(),
    flowId,
    history,
    runCount: history.runCount,
    governance: {
      excludesRawInput: true,
      excludesMatchedText: true,
      sendsInputPreview: false,
      sendsSafetyDecisions: true,
      sendsHumanReviews: true,
      excludesExternalHeaders: true,
      excludesSecretValues: true,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  });
  if (Buffer.byteLength(body, "utf-8") > SAFETY_HARNESS_CENTRAL_MAX_BYTES) {
    throw new WorkspaceError("Histórico do Safety Harness excede o limite de tamanho permitido para sync central.", 413);
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
    if (Number.isFinite(contentLength) && contentLength > SAFETY_HARNESS_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central de Safety Harness excede o limite de tamanho permitido.", 413);
    }
    if (!response.ok) {
      throw new WorkspaceError(`Central de Safety Harness respondeu HTTP ${response.status}.`, response.status);
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > SAFETY_HARNESS_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central de Safety Harness excede o limite de tamanho permitido.", 413);
    }
    return {
      statusCode: response.status,
      body: Buffer.from(buffer).toString("utf-8"),
    };
  } catch (error) {
    if (isRecord(error) && error.name === "AbortError") {
      throw new WorkspaceError("Timeout ao sincronizar central de Safety Harness.", 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function sanitizeSafetyHarnessHistoryForCentral(history: SafetyHarnessHistory): SafetyHarnessHistory {
  const runs = syncSafetyHarnessRuns(
    history.runs.map((run) => ({
      ...run,
      inputPreview: "",
      local: sanitizeSafetyHarnessDecisionForCentral(run.local),
      external: run.external ? sanitizeSafetyHarnessDecisionForCentral(run.external) : null,
      final: sanitizeSafetyHarnessDecisionForCentral(run.final),
    })),
  );
  const resolutionHistory = normalizeSafetyHarnessResolutionHistory(history.resolutionHistory);
  return {
    ...history,
    exportedAt: new Date().toISOString(),
    runCount: runs.length,
    blockedCount: runs.filter((run) => run.final.blocked).length,
    externalCount: runs.filter((run) => run.external !== null).length,
    pendingReviewCount: runs.filter((run) => run.review.status === "pending").length,
    acceptedCount: runs.filter((run) => run.review.status === "accepted").length,
    rejectedCount: runs.filter((run) => run.review.status === "rejected").length,
    resolutionHistoryCount: resolutionHistory.length,
    resolutionHistory,
    runs,
  };
}

function sanitizeSafetyHarnessDecisionForCentral(decision: SafetyHarnessDecision): SafetyHarnessDecision {
  return {
    ...decision,
    matchedText: null,
  };
}

function validateSafetyHarnessCentralUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WorkspaceError(`${SAFETY_HARNESS_CENTRAL_URL_ENV} deve ser uma URL HTTP/HTTPS válida.`, 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WorkspaceError(`${SAFETY_HARNESS_CENTRAL_URL_ENV} deve usar http ou https.`, 400);
  }
  return parsed.toString();
}

function buildSafetyHarnessHistory(
  flow: Pick<AgentFlow, "id" | "name" | "version">,
  runs: SafetyHarnessRunRecord[],
  resolutionHistory: SafetyHarnessResolutionRecord[] = [],
): SafetyHarnessHistory {
  const merged = syncSafetyHarnessRunsWithResolution(runs, resolutionHistory);
  const normalized = merged.runs;
  return {
    format: "agent-flow-builder.safety-harness-history.v1",
    exportedAt: new Date().toISOString(),
    flow: {
      id: flow.id,
      name: flow.name,
      version: flow.version,
    },
    runCount: normalized.length,
    blockedCount: normalized.filter((run) => run.final.blocked).length,
    externalCount: normalized.filter((run) => run.external !== null).length,
    pendingReviewCount: normalized.filter((run) => run.review.status === "pending").length,
    acceptedCount: normalized.filter((run) => run.review.status === "accepted").length,
    rejectedCount: normalized.filter((run) => run.review.status === "rejected").length,
    resolutionHistoryCount: merged.resolutionHistory.length,
    resolutionHistory: merged.resolutionHistory,
    runs: normalized,
  };
}

function normalizeSafetyHarnessHistory(value: unknown): SafetyHarnessHistory | null {
  if (!isRecord(value) || value.format !== "agent-flow-builder.safety-harness-history.v1" || !Array.isArray(value.runs)) {
    return null;
  }
  const flow = isRecord(value.flow) ? value.flow : {};
  const resolutionHistory = Array.isArray(value.resolutionHistory)
    ? normalizeSafetyHarnessResolutionHistory(value.resolutionHistory)
    : [];
  const merged = syncSafetyHarnessRunsWithResolution(value.runs, resolutionHistory);
  const runs = merged.runs;
  return {
    format: "agent-flow-builder.safety-harness-history.v1",
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : new Date().toISOString(),
    flow: {
      id: typeof flow.id === "string" ? flow.id : "",
      name: typeof flow.name === "string" ? flow.name : "",
      version: typeof flow.version === "string" ? flow.version : "",
    },
    runCount: runs.length,
    blockedCount: runs.filter((run) => run.final.blocked).length,
    externalCount: runs.filter((run) => run.external !== null).length,
    pendingReviewCount: runs.filter((run) => run.review.status === "pending").length,
    acceptedCount: runs.filter((run) => run.review.status === "accepted").length,
    rejectedCount: runs.filter((run) => run.review.status === "rejected").length,
    resolutionHistoryCount: merged.resolutionHistory.length,
    resolutionHistory: merged.resolutionHistory,
    runs,
  };
}

function syncSafetyHarnessRuns(items: unknown[]): SafetyHarnessRunRecord[] {
  return syncSafetyHarnessRunsWithResolution(items).runs;
}

function syncSafetyHarnessRunsWithResolution(
  items: unknown[],
  resolutionHistory: SafetyHarnessResolutionRecord[] = [],
): { runs: SafetyHarnessRunRecord[]; resolutionHistory: SafetyHarnessResolutionRecord[] } {
  const byId = new Map<string, SafetyHarnessRunRecord>();
  const records = normalizeSafetyHarnessResolutionHistory(resolutionHistory);
  for (const item of items.map(normalizeSafetyHarnessRun).filter((run): run is SafetyHarnessRunRecord => run !== null)) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      continue;
    }
    const existingRef = safetyHarnessResolutionRef(existing);
    const incomingRef = safetyHarnessResolutionRef(item);
    const keepIncoming = Date.parse(existing.updatedAt) <= Date.parse(item.updatedAt);
    const kept = keepIncoming ? item : existing;
    const discarded = keepIncoming ? existing : item;
    if (!safetyHarnessResolutionRefsMatch(existingRef, incomingRef)) {
      const record = buildSafetyHarnessResolutionRecord(kept, discarded);
      if (!safetyHarnessResolutionAlreadyRecorded(records, record)) {
        records.push(record);
      }
    }
    if (keepIncoming) {
      byId.set(item.id, item);
    }
  }
  const runs = Array.from(byId.values())
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, MAX_SAFETY_HARNESS_RUNS);
  return {
    runs,
    resolutionHistory: normalizeSafetyHarnessResolutionHistory(records),
  };
}

function normalizeSafetyHarnessResolutionHistory(value: unknown[]): SafetyHarnessResolutionRecord[] {
  const byId = new Map<string, SafetyHarnessResolutionRecord>();
  for (const record of value
    .map(normalizeSafetyHarnessResolutionRecord)
    .filter((item): item is SafetyHarnessResolutionRecord => item !== null)) {
    byId.set(record.resolutionId, record);
  }
  return Array.from(byId.values())
    .sort((left, right) => Date.parse(right.resolvedAt) - Date.parse(left.resolvedAt))
    .slice(0, MAX_SAFETY_HARNESS_RUNS);
}

function normalizeSafetyHarnessResolutionRecord(value: unknown): SafetyHarnessResolutionRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const resolutionId = typeof value.resolutionId === "string" && value.resolutionId.trim() ? value.resolutionId.trim() : "";
  const runId = typeof value.runId === "string" && value.runId.trim() ? value.runId.trim() : "";
  const keptRef = normalizeSafetyHarnessResolutionRef(value.keptRef);
  const discardedRefs = Array.isArray(value.discardedRefs)
    ? value.discardedRefs
        .map(normalizeSafetyHarnessResolutionRef)
        .filter((item): item is SafetyHarnessResolutionRef => item !== null)
    : [];
  if (!resolutionId || !runId || !keptRef || discardedRefs.length === 0) {
    return null;
  }
  return {
    resolutionId,
    runId,
    resolvedAt: typeof value.resolvedAt === "string" && value.resolvedAt.trim() ? value.resolvedAt.trim() : new Date().toISOString(),
    resolvedBy: typeof value.resolvedBy === "string" && value.resolvedBy.trim() ? value.resolvedBy.trim() : "safety-harness-sync",
    resolvedRole: normalizeSafetyHarnessReviewerRole(value.resolvedRole),
    resolution: "latest_updated_at",
    keptRef,
    discardedRefs,
    governance: {
      excludesRawInput: true,
      excludesMatchedText: true,
      excludesExternalHeaders: true,
      excludesSecretValues: true,
    },
  };
}

function normalizeSafetyHarnessResolutionRef(value: unknown): SafetyHarnessResolutionRef | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : "";
  const flowId = typeof value.flowId === "string" && value.flowId.trim() ? value.flowId.trim() : "";
  const nodeId = typeof value.nodeId === "string" && value.nodeId.trim() ? value.nodeId.trim() : "";
  const localDecisionHash =
    typeof value.localDecisionHash === "string" && value.localDecisionHash.trim() ? value.localDecisionHash.trim() : "";
  const finalDecisionHash =
    typeof value.finalDecisionHash === "string" && value.finalDecisionHash.trim() ? value.finalDecisionHash.trim() : "";
  if (!id || !flowId || !nodeId || !localDecisionHash || !finalDecisionHash) {
    return null;
  }
  return {
    id,
    flowId,
    nodeId,
    stage: normalizeStage(value.stage),
    createdAt: typeof value.createdAt === "string" && value.createdAt.trim() ? value.createdAt.trim() : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === "string" && value.updatedAt.trim() ? value.updatedAt.trim() : new Date().toISOString(),
    reviewStatus: normalizeReviewStatus(value.reviewStatus),
    reviewer: typeof value.reviewer === "string" ? value.reviewer : "",
    reviewerRole: normalizeSafetyHarnessReviewerRole(value.reviewerRole),
    reviewedAt: value.reviewedAt === null || typeof value.reviewedAt === "string" ? value.reviewedAt : null,
    reviewNoteHash: typeof value.reviewNoteHash === "string" && value.reviewNoteHash.trim() ? value.reviewNoteHash.trim() : null,
    localDecisionHash,
    externalDecisionHash:
      typeof value.externalDecisionHash === "string" && value.externalDecisionHash.trim()
        ? value.externalDecisionHash.trim()
        : null,
    finalDecisionHash,
  };
}

function buildSafetyHarnessResolutionRecord(
  kept: SafetyHarnessRunRecord,
  discarded: SafetyHarnessRunRecord,
): SafetyHarnessResolutionRecord {
  const keptRef = safetyHarnessResolutionRef(kept);
  const discardedRef = safetyHarnessResolutionRef(discarded);
  const resolvedAt = latestIsoDate([kept.updatedAt, discarded.updatedAt]);
  const resolutionId = `safety-harness-resolution-${shortSafetyHash({
    runId: kept.id,
    keptRef,
    discardedRef,
  })}`;
  return {
    resolutionId,
    runId: kept.id,
    resolvedAt,
    resolvedBy: kept.review.reviewer || discarded.review.reviewer || "safety-harness-sync",
    resolvedRole: kept.review.role || discarded.review.role || "reviewer",
    resolution: "latest_updated_at",
    keptRef,
    discardedRefs: [discardedRef],
    governance: {
      excludesRawInput: true,
      excludesMatchedText: true,
      excludesExternalHeaders: true,
      excludesSecretValues: true,
    },
  };
}

function safetyHarnessResolutionAlreadyRecorded(
  records: SafetyHarnessResolutionRecord[],
  candidate: SafetyHarnessResolutionRecord,
): boolean {
  return records.some(
    (record) =>
      record.runId === candidate.runId &&
      safetyHarnessResolutionRefsMatch(record.keptRef, candidate.keptRef) &&
      candidate.discardedRefs.every((candidateRef) =>
        record.discardedRefs.some((recordRef) => safetyHarnessResolutionRefsMatch(recordRef, candidateRef)),
      ),
  );
}

function safetyHarnessResolutionRef(run: SafetyHarnessRunRecord): SafetyHarnessResolutionRef {
  return {
    id: run.id,
    flowId: run.flowId,
    nodeId: run.nodeId,
    stage: run.stage,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    reviewStatus: run.review.status,
    reviewer: run.review.reviewer,
    reviewerRole: run.review.role,
    reviewedAt: run.review.reviewedAt,
    reviewNoteHash: run.review.note ? shortSafetyHash(run.review.note) : null,
    localDecisionHash: safetyHarnessDecisionHash(run.local),
    externalDecisionHash: run.external ? safetyHarnessDecisionHash(run.external) : null,
    finalDecisionHash: safetyHarnessDecisionHash(run.final),
  };
}

function safetyHarnessResolutionRefsMatch(left: SafetyHarnessResolutionRef, right: SafetyHarnessResolutionRef): boolean {
  return shortSafetyHash(left) === shortSafetyHash(right);
}

function safetyHarnessDecisionHash(decision: SafetyHarnessDecision): string {
  return shortSafetyHash({
    blocked: decision.blocked,
    decision: decision.decision,
    category: decision.category,
    reason: decision.reason,
    safeResponse: decision.safeResponse,
    severity: decision.severity,
    action: decision.action,
    ruleId: decision.ruleId,
    ruleLabel: decision.ruleLabel,
    matchType: decision.matchType,
    score: decision.score,
    source: decision.source,
  });
}

function safetyHarnessHistoryDiffRef(run: SafetyHarnessRunRecord): SafetyHarnessHistoryDiffRef {
  const reviewNoteHash = run.review.note ? shortSafetyHash(run.review.note) : null;
  const localDecisionHash = safetyHarnessDecisionHash(run.local);
  const externalDecisionHash = run.external ? safetyHarnessDecisionHash(run.external) : null;
  const finalDecisionHash = safetyHarnessDecisionHash(run.final);
  const reviewerHash = run.review.reviewer ? shortSafetyHash(run.review.reviewer) : null;
  const aggregateHash = shortSafetyHash({
    flowId: run.flowId,
    flowVersion: run.flowVersion,
    nodeId: run.nodeId,
    stage: run.stage,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    localDecisionHash,
    externalDecisionHash,
    finalDecisionHash,
    reviewStatus: run.review.status,
    reviewerRole: run.review.role,
    reviewerHash,
    reviewNoteHash,
    reviewedAt: run.review.reviewedAt,
  });
  return {
    id: run.id,
    flowId: run.flowId,
    flowVersion: run.flowVersion,
    nodeId: run.nodeId,
    stage: run.stage,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    blocked: run.final.blocked,
    decision: run.final.decision,
    category: run.final.category,
    severity: run.final.severity,
    action: run.final.action,
    source: run.final.source,
    hasExternalDecision: run.external !== null,
    reviewStatus: run.review.status,
    reviewerRole: run.review.role,
    reviewedAt: run.review.reviewedAt,
    reviewerHash,
    reviewNoteHash,
    localDecisionHash,
    externalDecisionHash,
    finalDecisionHash,
    aggregateHash,
  };
}

function normalizeSafetyHarnessRun(value: unknown): SafetyHarnessRunRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : "";
  const flowId = typeof value.flowId === "string" && value.flowId.trim() ? value.flowId.trim() : "";
  const nodeId = typeof value.nodeId === "string" && value.nodeId.trim() ? value.nodeId.trim() : "";
  const local = normalizeSafetyHarnessDecision(value.local);
  const final = normalizeSafetyHarnessDecision(value.final);
  if (!id || !flowId || !nodeId || !local || !final) {
    return null;
  }
  const review = isRecord(value.review) ? value.review : {};
  const createdAt = typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString();
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : createdAt;
  return {
    id,
    flowId,
    flowVersion: typeof value.flowVersion === "string" ? value.flowVersion : "",
    nodeId,
    stage: normalizeStage(value.stage),
    inputPreview: typeof value.inputPreview === "string" ? value.inputPreview : "",
    local,
    external: value.external === null ? null : normalizeSafetyHarnessDecision(value.external),
    final,
    review: {
      status: normalizeReviewStatus(review.status),
      reviewer: typeof review.reviewer === "string" ? review.reviewer : "",
      role: normalizeSafetyHarnessReviewerRole(review.role),
      note: typeof review.note === "string" ? review.note : "",
      reviewedAt: review.reviewedAt === null || typeof review.reviewedAt === "string" ? review.reviewedAt : null,
    },
    createdAt,
    updatedAt,
  };
}

function normalizeSafetyHarnessDecision(value: unknown): SafetyHarnessDecision | null {
  if (!isRecord(value)) {
    return null;
  }
  const decision = normalizeDecisionValue(value.decision, normalizeBoolean(value.blocked) ? "safe_redirect" : "allow");
  return {
    blocked: normalizeBoolean(value.blocked) || decision === "block" || decision === "safe_redirect",
    decision,
    category: normalizeNullableString(value.category),
    reason: normalizeString(value.reason, ""),
    safeResponse: normalizeNullableString(value.safeResponse),
    severity: normalizeSeverity(value.severity),
    action: value.action === "warn" || value.action === "safe_redirect" || value.action === "block" ? value.action : null,
    ruleId: normalizeNullableString(value.ruleId),
    ruleLabel: normalizeNullableString(value.ruleLabel),
    matchType: normalizeNullableString(value.matchType),
    matchedText: normalizeNullableString(value.matchedText),
    score: normalizeScore(value.score),
    source: value.source === "external" || value.source === "combined" ? value.source : "local",
  };
}

function normalizeSafetyPolicy(value: unknown): SafetyPolicyInput {
  const policy = isRecord(value) ? value : {};
  return {
    mode: policy.mode === "default" || policy.mode === "custom" ? policy.mode : "default_and_custom",
    severityThreshold: normalizeSeverity(policy.severityThreshold),
    fallbackResponse: typeof policy.fallbackResponse === "string" ? policy.fallbackResponse.trim() : "",
    rules: Array.isArray(policy.rules) ? policy.rules.map(normalizeSafetyRule).filter((rule): rule is SafetyRuleInput => rule !== null) : [],
  };
}

function normalizeSafetyRule(value: unknown): SafetyRuleInput | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = requiredStringOrEmpty(value.id);
  const match = typeof value.match === "string" ? value.match : "";
  const matchType = value.matchType === "regex" || value.matchType === "empty" ? value.matchType : "contains";
  if (!id || (!match && matchType !== "empty")) {
    return null;
  }
  return {
    id,
    label: typeof value.label === "string" ? value.label : undefined,
    description: typeof value.description === "string" ? value.description : undefined,
    match,
    matchType,
    category: typeof value.category === "string" ? value.category : undefined,
    severity: normalizeSeverity(value.severity),
    action: normalizeAction(value.action),
    reason: typeof value.reason === "string" ? value.reason : undefined,
    safeResponse: typeof value.safeResponse === "string" ? value.safeResponse : undefined,
  };
}

function normalizeExternalConfig(value: unknown): SafetyHarnessExternalConfig | null {
  if (!isRecord(value) || value.enabled !== true) {
    return null;
  }
  const endpointUrl = requiredString(value.endpointUrl, "external.endpointUrl");
  return {
    endpointUrl: parseEndpointUrl(endpointUrl),
    headers: normalizeHeaders(value.headers),
    blockedPath: optionalPath(value.blockedPath, "external.blockedPath", "blocked"),
    decisionPath: optionalPath(value.decisionPath, "external.decisionPath", "decision"),
    severityPath: optionalPath(value.severityPath, "external.severityPath", "severity"),
    reasonPath: optionalPath(value.reasonPath, "external.reasonPath", "reason"),
    categoryPath: optionalPath(value.categoryPath, "external.categoryPath", "category"),
    safeResponsePath: optionalPath(value.safeResponsePath, "external.safeResponsePath", "safeResponse"),
    scorePath: optionalPath(value.scorePath, "external.scorePath", "score"),
    timeoutMs: normalizeTimeoutMs(value.timeoutMs),
  };
}

function parseEndpointUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WorkspaceError("external.endpointUrl deve ser uma URL HTTP/HTTPS válida.", 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WorkspaceError("external.endpointUrl deve usar http ou https.", 400);
  }
  return parsed.toString();
}

function normalizeHeaders(value: unknown): Record<string, string> {
  if (value === undefined || value === null) {
    return {};
  }
  if (!isRecord(value)) {
    throw new WorkspaceError("external.headers deve ser um objeto string:string.", 400);
  }
  const headers: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(value)) {
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(key)) {
      throw new WorkspaceError(`Header inválido: ${key}.`, 400);
    }
    if (typeof headerValue !== "string") {
      throw new WorkspaceError(`Header ${key} deve ser string.`, 400);
    }
    if (key.toLowerCase() === "host" || key.toLowerCase() === "content-length") {
      continue;
    }
    headers[key] = headerValue;
  }
  return headers;
}

function readJsonPath(value: unknown, pathValue: string): { found: boolean; value: unknown } {
  const segments = jsonPathSegments(pathValue);
  let current = value;
  for (const segment of segments) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      const index = Number(segment);
      if (index < 0 || index >= current.length) {
        return { found: false, value: undefined };
      }
      current = current[index];
      continue;
    }
    if (!isRecord(current) || !(segment in current)) {
      return { found: false, value: undefined };
    }
    current = current[segment];
  }
  return { found: true, value: current };
}

function jsonPathSegments(pathValue: string): string[] {
  const normalized = pathValue.trim().replace(/^\$\.?/, "");
  const segments: string[] = [];
  for (const part of normalized.split(".")) {
    const matches = part.matchAll(/([^\[\]]+)|\[(\d+)\]/g);
    for (const match of matches) {
      const segment = match[1] ?? match[2];
      if (segment) {
        segments.push(segment);
      }
    }
  }
  return segments;
}

function parseJsonBody(value: string): unknown {
  if (!value.trim()) {
    return {};
  }
  try {
    return JSON.parse(value);
  } catch {
    return { text: value };
  }
}

function inputPreview(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 300);
}

function normalizeStage(value: unknown): "input" | "output" | "context" {
  return value === "output" || value === "context" ? value : "input";
}

function normalizeReviewStatus(value: unknown): SafetyReviewStatus {
  if (value === "accepted" || value === "rejected") {
    return value;
  }
  return "pending";
}

function normalizeSafetyHarnessReviewerRole(value: unknown): SafetyHarnessReviewerRole {
  if (value === "owner" || value === "operator" || value === "viewer") {
    return value;
  }
  return "reviewer";
}

function assertSafetyHarnessReviewMutationAllowed(role: SafetyHarnessReviewerRole): void {
  if (role !== "viewer") {
    return;
  }
  throw new WorkspaceError("Viewer não pode revisar runs do Safety Harness.", 403, {
    code: "safety_harness_review_viewer_forbidden",
    role,
    requiredRole: "reviewer",
  });
}

function normalizeSeverity(value: unknown): SafetySeverity {
  if (value === "low" || value === "high" || value === "critical") {
    return value;
  }
  return "medium";
}

function normalizeAction(value: unknown): SafetyAction {
  if (value === "warn" || value === "block") {
    return value;
  }
  return "safe_redirect";
}

function normalizeDecisionValue(value: unknown, fallback: SafetyDecisionValue): SafetyDecisionValue {
  if (value === "allow" || value === "safe_redirect" || value === "block") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "blocked" || normalized === "deny" || normalized === "denied") {
      return "block";
    }
    if (normalized === "redirect" || normalized === "safe") {
      return "safe_redirect";
    }
  }
  return fallback;
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value > 0;
  }
  if (typeof value === "string") {
    return ["true", "blocked", "block", "deny", "denied", "1", "sim"].includes(value.trim().toLowerCase());
  }
  return false;
}

function normalizeScore(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeTimeoutMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 10_000;
  }
  return Math.min(60_000, Math.max(500, Math.round(value)));
}

function optionalPath(value: unknown, name: string, fallback: string): string {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkspaceError(`${name} deve ser string.`, 400);
  }
  return value.trim();
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function latestIsoDate(values: string[]): string {
  const valid = values
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));
  return new Date(valid.length ? Math.max(...valid) : Date.now()).toISOString();
}

function shortSafetyHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 16);
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

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkspaceError(`${name} é obrigatório.`, 400);
  }
  return value.trim();
}

function requiredStringOrEmpty(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
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
