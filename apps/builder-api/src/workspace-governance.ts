import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { WorkspaceError } from "./workspace.ts";

export type WorkspaceGovernanceRole = "owner" | "reviewer" | "operator" | "viewer";
export type WorkspaceGovernanceParticipantStatus = "active" | "inactive";
export type WorkspaceGovernancePolicyMode = "open" | "review_required" | "owner_required" | "disabled";
export type WorkspaceGovernanceConflictStatus = "open" | "resolved";
export type WorkspaceGovernanceConflictResolution = "keep_existing" | "use_incoming";
export type WorkspaceGovernanceAction =
  | "read"
  | "write"
  | "merge"
  | "resolve_conflict"
  | "approve"
  | "export"
  | "run"
  | "manage_secrets"
  | "deliver_runtime";
export type WorkspaceGovernanceAuditAction =
  | "package_saved"
  | "package_merged"
  | "participant_added"
  | "participant_updated"
  | "policy_updated"
  | "conflict_detected"
  | "conflict_resolved";

export interface WorkspaceGovernanceParticipant {
  id: string;
  name: string;
  role: WorkspaceGovernanceRole;
  areas: string[];
  status: WorkspaceGovernanceParticipantStatus;
  updatedAt: string;
  updatedBy: string;
}

export interface WorkspaceGovernancePolicy {
  area: string;
  mode: WorkspaceGovernancePolicyMode;
  requiredRole: WorkspaceGovernanceRole;
  updatedAt: string;
  updatedBy: string;
}

export interface WorkspaceGovernanceConflict {
  id: string;
  participantId: string;
  status: WorkspaceGovernanceConflictStatus;
  resolution: WorkspaceGovernanceConflictResolution | null;
  existingSnapshot: WorkspaceGovernanceParticipant;
  incomingSnapshot: WorkspaceGovernanceParticipant;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string;
}

export interface WorkspaceGovernanceAuditEntry {
  id: string;
  action: WorkspaceGovernanceAuditAction;
  actor: string;
  at: string;
  summary: string;
  participantId: string | null;
  area: string | null;
  conflictId: string | null;
}

export interface WorkspaceGovernancePackage {
  format: "agent-flow-builder.workspace-governance.v1";
  exportedAt: string;
  storagePath: ".agent-flow/governance/workspace.afgovernance.json";
  participantCount: number;
  activeParticipantCount: number;
  ownerCount: number;
  policyCount: number;
  conflictCount: number;
  openConflictCount: number;
  participants: WorkspaceGovernanceParticipant[];
  policies: WorkspaceGovernancePolicy[];
  conflicts: WorkspaceGovernanceConflict[];
  auditCount: number;
  auditEntries: WorkspaceGovernanceAuditEntry[];
  governance: {
    excludesSecretValues: true;
    excludesEnvValues: true;
    excludesRawRuns: true;
    localOnly: true;
    authEnforced: false;
  };
}

export interface WorkspaceGovernanceAuthorizationRequest {
  actorId?: string;
  area?: string;
  action?: WorkspaceGovernanceAction;
}

export interface WorkspaceGovernanceDecision {
  format: "agent-flow-builder.workspace-governance-decision.v1";
  evaluatedAt: string;
  actorId: string;
  actorName: string;
  participantStatus: WorkspaceGovernanceParticipantStatus | "missing";
  role: WorkspaceGovernanceRole | null;
  area: string;
  action: WorkspaceGovernanceAction;
  allowed: boolean;
  enforcementMode: "advisory" | "enforced";
  effect: "allowed" | "would_block" | "blocked";
  requiredRole: WorkspaceGovernanceRole;
  policy: {
    area: string;
    mode: WorkspaceGovernancePolicyMode;
    requiredRole: WorkspaceGovernanceRole;
  };
  reasons: string[];
  governance: {
    localOnly: true;
    excludesSecretValues: true;
    excludesEnvValues: true;
    excludesRawRuns: true;
    authEnforced: boolean;
  };
}

const WORKSPACE_GOVERNANCE_FILE = ".agent-flow/governance/workspace.afgovernance.json";
const DEFAULT_AREAS = [
  "governance",
  "catalog",
  "schemas",
  "annotation_queue",
  "safety_harness",
  "replay_governance",
  "experiments",
  "runtime_delivery",
  "secrets",
];
const ROLE_RANK: Record<WorkspaceGovernanceRole, number> = {
  viewer: 0,
  reviewer: 1,
  operator: 2,
  owner: 3,
};

export async function loadWorkspaceGovernance(workspaceRoot: string): Promise<WorkspaceGovernancePackage> {
  try {
    const raw = await readFile(workspaceGovernancePath(workspaceRoot), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizeWorkspaceGovernancePackage(parsed);
    if (!normalized) {
      throw new WorkspaceError("Governança do workspace inválida.", 422);
    }
    return normalized;
  } catch (error) {
    if (isFileNotFound(error)) {
      return buildWorkspaceGovernancePackage(defaultWorkspaceParticipants(), defaultWorkspacePolicies());
    }
    if (error instanceof WorkspaceError) {
      throw error;
    }
    throw new WorkspaceError("Falha ao ler governança do workspace.", 500, error);
  }
}

export async function saveWorkspaceGovernance(
  workspaceRoot: string,
  payload: unknown,
): Promise<WorkspaceGovernancePackage> {
  const normalized = normalizeWorkspaceGovernancePackage(payload);
  if (!normalized) {
    throw new WorkspaceError("Payload de governança do workspace inválido.", 400);
  }
  const actor = resolveActor(payload, normalized.auditEntries);
  const nextPackage = buildWorkspaceGovernancePackage(
    normalized.participants,
    normalized.policies,
    normalized.conflicts,
    [
      ...normalized.auditEntries,
      buildAuditEntry({
        action: "package_saved",
        actor,
        summary: `Governança do workspace salva por ${actor}.`,
      }),
    ],
  );
  await writeWorkspaceGovernance(workspaceRoot, nextPackage);
  return nextPackage;
}

export async function mergeWorkspaceGovernance(
  workspaceRoot: string,
  payload: unknown,
): Promise<WorkspaceGovernancePackage> {
  const incoming = normalizeWorkspaceGovernancePackage(payload);
  if (!incoming) {
    throw new WorkspaceError("Payload de merge da governança do workspace inválido.", 400);
  }
  const existing = await loadWorkspaceGovernance(workspaceRoot);
  const merged = mergeWorkspaceGovernancePackages(existing, incoming);
  await writeWorkspaceGovernance(workspaceRoot, merged);
  return merged;
}

export async function resolveWorkspaceGovernanceConflict(
  workspaceRoot: string,
  conflictId: string,
  payload: unknown,
): Promise<WorkspaceGovernancePackage> {
  const existing = await loadWorkspaceGovernance(workspaceRoot);
  const resolution = isRecord(payload) && payload.resolution === "use_incoming" ? "use_incoming" : "keep_existing";
  const resolvedBy = isRecord(payload) && typeof payload.resolvedBy === "string" && payload.resolvedBy.trim()
    ? payload.resolvedBy.trim()
    : "local-studio";
  const now = new Date().toISOString();
  let resolvedConflict: WorkspaceGovernanceConflict | null = null;
  let resolvedParticipantId: string | null = null;
  const participants = [...existing.participants];
  const conflicts = existing.conflicts.map((conflict) => {
    if (conflict.id !== conflictId || conflict.status === "resolved") {
      return conflict;
    }
    resolvedConflict = {
      ...conflict,
      status: "resolved",
      resolution,
      resolvedAt: now,
      resolvedBy,
    };
    resolvedParticipantId = conflict.participantId;
    if (resolution === "use_incoming") {
      upsertParticipant(participants, { ...conflict.incomingSnapshot, updatedAt: now, updatedBy: resolvedBy });
    }
    return resolvedConflict;
  });
  if (!resolvedConflict) {
    throw new WorkspaceError("Conflito de governança não encontrado.", 404);
  }
  const nextPackage = buildWorkspaceGovernancePackage(
    participants,
    existing.policies,
    conflicts,
    [
      ...existing.auditEntries,
      buildAuditEntry({
        action: "conflict_resolved",
        actor: resolvedBy,
        summary: `Conflito de governança ${conflictId} resolvido com ${resolution}.`,
        participantId: resolvedParticipantId,
        conflictId,
      }),
    ],
  );
  await writeWorkspaceGovernance(workspaceRoot, nextPackage);
  return nextPackage;
}

export async function authorizeWorkspaceGovernance(
  workspaceRoot: string,
  payload: unknown,
  options: { enforced?: boolean } = {},
): Promise<WorkspaceGovernanceDecision> {
  const governance = await loadWorkspaceGovernance(workspaceRoot);
  return evaluateWorkspaceGovernanceAuthorization(governance, payload, options);
}

export function evaluateWorkspaceGovernanceAuthorization(
  governance: WorkspaceGovernancePackage,
  payload: unknown,
  options: { enforced?: boolean } = {},
): WorkspaceGovernanceDecision {
  const actorId = normalizeParticipantId(
    isRecord(payload) && typeof payload.actorId === "string" && payload.actorId.trim()
      ? payload.actorId
      : "local-studio",
  );
  const area = normalizeArea(
    isRecord(payload) && typeof payload.area === "string" && payload.area.trim()
      ? payload.area
      : "catalog",
  ) || "catalog";
  const action = normalizeWorkspaceGovernanceAction(isRecord(payload) ? payload.action : undefined);
  const participant = governance.participants.find((item) => item.id === actorId) ??
    governance.participants.find((item) => normalizeParticipantId(item.name) === actorId) ??
    null;
  const policy = governance.policies.find((item) => item.area === area) ?? defaultWorkspacePolicy(area);
  const requiredRole = requiredRoleForAction(policy, action);
  const reasons: string[] = [];
  let allowed = true;

  if (!participant) {
    allowed = false;
    reasons.push(`Participante ${actorId} não está registrado na governança.`);
  } else {
    if (participant.status !== "active") {
      allowed = false;
      reasons.push(`Participante ${participant.name} está inativo.`);
    }
    if (!participantHasArea(participant, area)) {
      allowed = false;
      reasons.push(`Participante ${participant.name} não possui acesso à área ${area}.`);
    }
    if (!roleMeets(participant.role, requiredRole)) {
      allowed = false;
      reasons.push(`Papel ${participant.role} não atende ao mínimo ${requiredRole}.`);
    }
  }
  if (policy.mode === "disabled") {
    allowed = false;
    reasons.push(`Área ${area} está desabilitada pela política do workspace.`);
  }
  if (governance.openConflictCount > 0 && ["approve", "deliver_runtime", "manage_secrets"].includes(action)) {
    reasons.push(`${governance.openConflictCount} conflito(s) de governança aberto(s) exigem revisão antes da entrega.`);
  }
  if (!reasons.length) {
    reasons.push("Política e papel permitem a ação solicitada.");
  }
  const enforced = options.enforced === true;
  return {
    format: "agent-flow-builder.workspace-governance-decision.v1",
    evaluatedAt: new Date().toISOString(),
    actorId,
    actorName: participant?.name ?? actorId,
    participantStatus: participant?.status ?? "missing",
    role: participant?.role ?? null,
    area,
    action,
    allowed,
    enforcementMode: enforced ? "enforced" : "advisory",
    effect: allowed ? "allowed" : enforced ? "blocked" : "would_block",
    requiredRole,
    policy: {
      area: policy.area,
      mode: policy.mode,
      requiredRole: policy.requiredRole,
    },
    reasons,
    governance: {
      localOnly: true,
      excludesSecretValues: true,
      excludesEnvValues: true,
      excludesRawRuns: true,
      authEnforced: enforced,
    },
  };
}

function workspaceGovernancePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, WORKSPACE_GOVERNANCE_FILE);
}

async function writeWorkspaceGovernance(workspaceRoot: string, governance: WorkspaceGovernancePackage): Promise<void> {
  const filePath = workspaceGovernancePath(workspaceRoot);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(governance, null, 2)}\n`, "utf-8");
  await rename(tempPath, filePath);
}

function buildWorkspaceGovernancePackage(
  participants: WorkspaceGovernanceParticipant[],
  policies: WorkspaceGovernancePolicy[],
  conflicts: WorkspaceGovernanceConflict[] = [],
  auditEntries: WorkspaceGovernanceAuditEntry[] = [],
): WorkspaceGovernancePackage {
  const normalizedParticipants = normalizeParticipants(participants);
  const normalizedPolicies = normalizePolicies(policies);
  const normalizedConflicts = normalizeConflicts(conflicts, normalizedParticipants);
  const normalizedAuditEntries = normalizeAuditEntries(auditEntries);
  return {
    format: "agent-flow-builder.workspace-governance.v1",
    exportedAt: new Date().toISOString(),
    storagePath: WORKSPACE_GOVERNANCE_FILE,
    participantCount: normalizedParticipants.length,
    activeParticipantCount: normalizedParticipants.filter((participant) => participant.status === "active").length,
    ownerCount: normalizedParticipants.filter((participant) => participant.role === "owner").length,
    policyCount: normalizedPolicies.length,
    conflictCount: normalizedConflicts.length,
    openConflictCount: normalizedConflicts.filter((conflict) => conflict.status === "open").length,
    participants: normalizedParticipants,
    policies: normalizedPolicies,
    conflicts: normalizedConflicts,
    auditCount: normalizedAuditEntries.length,
    auditEntries: normalizedAuditEntries,
    governance: {
      excludesSecretValues: true,
      excludesEnvValues: true,
      excludesRawRuns: true,
      localOnly: true,
      authEnforced: false,
    },
  };
}

function normalizeWorkspaceGovernancePackage(value: unknown): WorkspaceGovernancePackage | null {
  if (!isRecord(value)) {
    return null;
  }
  const participants = normalizeParticipants(Array.isArray(value.participants) ? value.participants : []);
  const policies = normalizePolicies(Array.isArray(value.policies) ? value.policies : []);
  const conflicts = normalizeConflicts(Array.isArray(value.conflicts) ? value.conflicts : [], participants);
  const auditEntries = normalizeAuditEntries(Array.isArray(value.auditEntries) ? value.auditEntries : []);
  return buildWorkspaceGovernancePackage(
    participants.length ? participants : defaultWorkspaceParticipants(),
    policies.length ? policies : defaultWorkspacePolicies(),
    conflicts,
    auditEntries,
  );
}

function mergeWorkspaceGovernancePackages(
  existing: WorkspaceGovernancePackage,
  incoming: WorkspaceGovernancePackage,
): WorkspaceGovernancePackage {
  const participants = [...existing.participants];
  const conflicts = [...existing.conflicts];
  const auditEntries = [
    ...existing.auditEntries,
    ...incoming.auditEntries,
    buildAuditEntry({
      action: "package_merged",
      actor: resolveActor(incoming, incoming.auditEntries),
      summary: `Pacote de governança recebido com ${incoming.participantCount} participante(s).`,
    }),
  ];
  for (const incomingParticipant of incoming.participants) {
    const existingParticipant = participants.find((participant) => participant.id === incomingParticipant.id);
    if (!existingParticipant) {
      participants.push(incomingParticipant);
      auditEntries.push(buildAuditEntry({
        action: "participant_added",
        actor: incomingParticipant.updatedBy || "remote-governance",
        summary: `Participante ${incomingParticipant.name} adicionado à governança.`,
        participantId: incomingParticipant.id,
      }));
      continue;
    }
    if (participantsConflict(existingParticipant, incomingParticipant)) {
      const conflict = buildParticipantConflict(existingParticipant, incomingParticipant);
      if (!conflicts.some((item) => item.id === conflict.id)) {
        conflicts.push(conflict);
        auditEntries.push(buildAuditEntry({
          action: "conflict_detected",
          actor: incomingParticipant.updatedBy || "remote-governance",
          summary: `Conflito de papel detectado para ${incomingParticipant.name}.`,
          participantId: incomingParticipant.id,
          conflictId: conflict.id,
        }));
      }
      continue;
    }
    if (Date.parse(incomingParticipant.updatedAt) > Date.parse(existingParticipant.updatedAt)) {
      upsertParticipant(participants, incomingParticipant);
      auditEntries.push(buildAuditEntry({
        action: "participant_updated",
        actor: incomingParticipant.updatedBy || "remote-governance",
        summary: `Participante ${incomingParticipant.name} atualizado por pacote recebido.`,
        participantId: incomingParticipant.id,
      }));
    }
  }
  const policies = [...existing.policies];
  for (const incomingPolicy of incoming.policies) {
    const existingPolicy = policies.find((policy) => policy.area === incomingPolicy.area);
    if (!existingPolicy || Date.parse(incomingPolicy.updatedAt) > Date.parse(existingPolicy.updatedAt)) {
      upsertPolicy(policies, incomingPolicy);
      auditEntries.push(buildAuditEntry({
        action: "policy_updated",
        actor: incomingPolicy.updatedBy || "remote-governance",
        summary: `Política ${incomingPolicy.area} atualizada por pacote recebido.`,
        area: incomingPolicy.area,
      }));
    }
  }
  return buildWorkspaceGovernancePackage(participants, policies, conflicts, auditEntries);
}

function defaultWorkspaceParticipants(): WorkspaceGovernanceParticipant[] {
  const now = new Date().toISOString();
  return [
    {
      id: "local-studio",
      name: "local-studio",
      role: "owner",
      areas: ["*"],
      status: "active",
      updatedAt: now,
      updatedBy: "system",
    },
  ];
}

function defaultWorkspacePolicies(): WorkspaceGovernancePolicy[] {
  const now = new Date().toISOString();
  return DEFAULT_AREAS.map((area) => ({
    area,
    mode: area === "secrets" || area === "runtime_delivery" ? "owner_required" : "open",
    requiredRole: area === "secrets" || area === "runtime_delivery" ? "owner" : "viewer",
    updatedAt: now,
    updatedBy: "system",
  }));
}

function defaultWorkspacePolicy(area: string): WorkspaceGovernancePolicy {
  const now = new Date().toISOString();
  return {
    area,
    mode: "open",
    requiredRole: "viewer",
    updatedAt: now,
    updatedBy: "system",
  };
}

function normalizeParticipants(value: unknown[]): WorkspaceGovernanceParticipant[] {
  const byId = new Map<string, WorkspaceGovernanceParticipant>();
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : "local-studio";
    const id = normalizeParticipantId(typeof item.id === "string" && item.id.trim() ? item.id : name);
    const participant: WorkspaceGovernanceParticipant = {
      id,
      name,
      role: normalizeRole(item.role),
      areas: normalizeAreas(item.areas),
      status: item.status === "inactive" ? "inactive" : "active",
      updatedAt: normalizeDate(item.updatedAt),
      updatedBy: typeof item.updatedBy === "string" && item.updatedBy.trim() ? item.updatedBy.trim() : "local-studio",
    };
    const existing = byId.get(id);
    if (!existing || Date.parse(existing.updatedAt) <= Date.parse(participant.updatedAt)) {
      byId.set(id, participant);
    }
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function normalizePolicies(value: unknown[]): WorkspaceGovernancePolicy[] {
  const byArea = new Map<string, WorkspaceGovernancePolicy>();
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const area = normalizeArea(typeof item.area === "string" ? item.area : "");
    if (!area) {
      continue;
    }
    const policy: WorkspaceGovernancePolicy = {
      area,
      mode: normalizePolicyMode(item.mode),
      requiredRole: normalizeRole(item.requiredRole),
      updatedAt: normalizeDate(item.updatedAt),
      updatedBy: typeof item.updatedBy === "string" && item.updatedBy.trim() ? item.updatedBy.trim() : "local-studio",
    };
    const existing = byArea.get(area);
    if (!existing || Date.parse(existing.updatedAt) <= Date.parse(policy.updatedAt)) {
      byArea.set(area, policy);
    }
  }
  return [...byArea.values()].sort((left, right) => left.area.localeCompare(right.area));
}

function normalizeConflicts(
  value: unknown[],
  participants: WorkspaceGovernanceParticipant[],
): WorkspaceGovernanceConflict[] {
  const participantIds = new Set(participants.map((participant) => participant.id));
  const byId = new Map<string, WorkspaceGovernanceConflict>();
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const existingSnapshot = normalizeParticipantSnapshot(item.existingSnapshot);
    const incomingSnapshot = normalizeParticipantSnapshot(item.incomingSnapshot);
    if (!existingSnapshot || !incomingSnapshot || existingSnapshot.id !== incomingSnapshot.id) {
      continue;
    }
    const participantId = existingSnapshot.id;
    if (!participantIds.has(participantId)) {
      continue;
    }
    const id = typeof item.id === "string" && item.id.trim()
      ? item.id.trim()
      : participantConflictId(existingSnapshot, incomingSnapshot);
    byId.set(id, {
      id,
      participantId,
      status: item.status === "resolved" ? "resolved" : "open",
      resolution: item.resolution === "use_incoming" || item.resolution === "keep_existing" ? item.resolution : null,
      existingSnapshot,
      incomingSnapshot,
      createdAt: normalizeDate(item.createdAt),
      resolvedAt: typeof item.resolvedAt === "string" && item.resolvedAt.trim() ? normalizeDate(item.resolvedAt) : null,
      resolvedBy: typeof item.resolvedBy === "string" && item.resolvedBy.trim() ? item.resolvedBy.trim() : "",
    });
  }
  return [...byId.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function normalizeAuditEntries(value: unknown[]): WorkspaceGovernanceAuditEntry[] {
  const byId = new Map<string, WorkspaceGovernanceAuditEntry>();
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const action = normalizeAuditAction(item.action);
    const at = normalizeDate(item.at);
    const actor = typeof item.actor === "string" && item.actor.trim() ? item.actor.trim() : "local-studio";
    const summary = typeof item.summary === "string" && item.summary.trim() ? item.summary.trim() : action;
    const participantId = typeof item.participantId === "string" && item.participantId.trim() ? normalizeParticipantId(item.participantId) : null;
    const area = typeof item.area === "string" && item.area.trim() ? normalizeArea(item.area) : null;
    const conflictId = typeof item.conflictId === "string" && item.conflictId.trim() ? item.conflictId.trim() : null;
    const id = typeof item.id === "string" && item.id.trim()
      ? item.id.trim()
      : auditId([action, actor, at, summary, participantId ?? "", area ?? "", conflictId ?? ""]);
    byId.set(id, { id, action, actor, at, summary, participantId, area, conflictId });
  }
  return [...byId.values()].sort((left, right) => left.at.localeCompare(right.at));
}

function normalizeParticipantSnapshot(value: unknown): WorkspaceGovernanceParticipant | null {
  return normalizeParticipants([value]).at(0) ?? null;
}

function normalizeParticipantId(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "local-studio";
}

function normalizeAreas(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return ["*"];
  }
  const areas = Array.from(new Set(value.map((item) => normalizeArea(String(item))).filter(Boolean)));
  return areas.length ? areas.sort((left, right) => left.localeCompare(right)) : ["*"];
}

function normalizeArea(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_*.-]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeRole(value: unknown): WorkspaceGovernanceRole {
  if (value === "owner" || value === "operator" || value === "viewer") {
    return value;
  }
  return "reviewer";
}

function normalizePolicyMode(value: unknown): WorkspaceGovernancePolicyMode {
  if (value === "review_required" || value === "owner_required" || value === "disabled") {
    return value;
  }
  return "open";
}

function normalizeWorkspaceGovernanceAction(value: unknown): WorkspaceGovernanceAction {
  const allowed: WorkspaceGovernanceAction[] = [
    "read",
    "write",
    "merge",
    "resolve_conflict",
    "approve",
    "export",
    "run",
    "manage_secrets",
    "deliver_runtime",
  ];
  return allowed.includes(value as WorkspaceGovernanceAction) ? value as WorkspaceGovernanceAction : "read";
}

function requiredRoleForAction(
  policy: WorkspaceGovernancePolicy,
  action: WorkspaceGovernanceAction,
): WorkspaceGovernanceRole {
  if (policy.mode === "owner_required") {
    return "owner";
  }
  if (policy.mode === "review_required") {
    return maxRole(policy.requiredRole, maxRole(defaultRequiredRoleForAction(action), "reviewer"));
  }
  if (policy.mode === "disabled") {
    return "owner";
  }
  return defaultRequiredRoleForAction(action);
}

function defaultRequiredRoleForAction(action: WorkspaceGovernanceAction): WorkspaceGovernanceRole {
  if (action === "manage_secrets" || action === "deliver_runtime") {
    return "owner";
  }
  if (action === "run") {
    return "operator";
  }
  if (action === "write" || action === "merge" || action === "resolve_conflict" || action === "approve") {
    return "reviewer";
  }
  return "viewer";
}

function maxRole(left: WorkspaceGovernanceRole, right: WorkspaceGovernanceRole): WorkspaceGovernanceRole {
  return ROLE_RANK[left] >= ROLE_RANK[right] ? left : right;
}

function roleMeets(actual: WorkspaceGovernanceRole, required: WorkspaceGovernanceRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

function participantHasArea(participant: WorkspaceGovernanceParticipant, area: string): boolean {
  return participant.areas.includes("*") || participant.areas.includes(area);
}

function normalizeAuditAction(value: unknown): WorkspaceGovernanceAuditAction {
  const allowed: WorkspaceGovernanceAuditAction[] = [
    "package_saved",
    "package_merged",
    "participant_added",
    "participant_updated",
    "policy_updated",
    "conflict_detected",
    "conflict_resolved",
  ];
  return allowed.includes(value as WorkspaceGovernanceAuditAction) ? value as WorkspaceGovernanceAuditAction : "package_merged";
}

function normalizeDate(value: unknown): string {
  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) {
      return new Date(timestamp).toISOString();
    }
  }
  return new Date().toISOString();
}

function participantsConflict(
  existing: WorkspaceGovernanceParticipant,
  incoming: WorkspaceGovernanceParticipant,
): boolean {
  return existing.role !== incoming.role ||
    existing.status !== incoming.status ||
    existing.areas.join("\n") !== incoming.areas.join("\n");
}

function buildParticipantConflict(
  existingSnapshot: WorkspaceGovernanceParticipant,
  incomingSnapshot: WorkspaceGovernanceParticipant,
): WorkspaceGovernanceConflict {
  return {
    id: participantConflictId(existingSnapshot, incomingSnapshot),
    participantId: existingSnapshot.id,
    status: "open",
    resolution: null,
    existingSnapshot,
    incomingSnapshot,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolvedBy: "",
  };
}

function participantConflictId(
  existingSnapshot: WorkspaceGovernanceParticipant,
  incomingSnapshot: WorkspaceGovernanceParticipant,
): string {
  return `workspace-governance-conflict-${hashJson({
    id: existingSnapshot.id,
    existing: participantConflictComparable(existingSnapshot),
    incoming: participantConflictComparable(incomingSnapshot),
  })}`;
}

function participantConflictComparable(participant: WorkspaceGovernanceParticipant): object {
  return {
    role: participant.role,
    areas: participant.areas,
    status: participant.status,
  };
}

function upsertParticipant(
  participants: WorkspaceGovernanceParticipant[],
  participant: WorkspaceGovernanceParticipant,
): void {
  const index = participants.findIndex((item) => item.id === participant.id);
  if (index >= 0) {
    participants[index] = participant;
  } else {
    participants.push(participant);
  }
}

function upsertPolicy(policies: WorkspaceGovernancePolicy[], policy: WorkspaceGovernancePolicy): void {
  const index = policies.findIndex((item) => item.area === policy.area);
  if (index >= 0) {
    policies[index] = policy;
  } else {
    policies.push(policy);
  }
}

function buildAuditEntry(input: {
  action: WorkspaceGovernanceAuditAction;
  actor: string;
  summary: string;
  participantId?: string | null;
  area?: string | null;
  conflictId?: string | null;
}): WorkspaceGovernanceAuditEntry {
  const at = new Date().toISOString();
  return {
    id: auditId([input.action, input.actor, at, input.summary, input.participantId ?? "", input.area ?? "", input.conflictId ?? ""]),
    action: input.action,
    actor: input.actor || "local-studio",
    at,
    summary: input.summary,
    participantId: input.participantId ?? null,
    area: input.area ?? null,
    conflictId: input.conflictId ?? null,
  };
}

function resolveActor(payload: unknown, auditEntries: WorkspaceGovernanceAuditEntry[]): string {
  if (isRecord(payload) && typeof payload.updatedBy === "string" && payload.updatedBy.trim()) {
    return payload.updatedBy.trim();
  }
  const lastActor = [...auditEntries].reverse().find((entry) => entry.actor.trim())?.actor;
  return lastActor || "local-studio";
}

function auditId(parts: string[]): string {
  return `workspace-governance-audit-${hashJson(parts)}`;
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
