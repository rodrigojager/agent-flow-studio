import { strict as assert } from "node:assert";
import { createHmac, createSign, generateKeyPairSync } from "node:crypto";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildApp } from "./server.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function createWorkspaceWithReferenceFlow(prefix) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(workspaceRoot, "flows"), { recursive: true });
  await cp(
    path.join(REPO_ROOT, "flows", "reference-interview"),
    path.join(workspaceRoot, "flows", "reference-interview"),
    { recursive: true },
  );
  await rm(path.join(workspaceRoot, "flows", "reference-interview", ".agent-flow"), { recursive: true, force: true });
  return workspaceRoot;
}

test("Builder API manages shared workspace governance with conflicts and audit", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-builder-api-workspace-governance-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const app = buildApp({ workspaceRoot });

  const emptyGovernance = await app.inject({ method: "GET", url: "/workspace-governance" });
  assert.equal(emptyGovernance.statusCode, 200);
  assert.equal(emptyGovernance.json().format, "agent-flow-builder.workspace-governance.v1");
  assert.equal(emptyGovernance.json().participants[0].id, "local-studio");
  assert.equal(emptyGovernance.json().governance.excludesSecretValues, true);
  assert.equal(emptyGovernance.json().governance.authEnforced, false);

  const savedGovernance = await app.inject({
    method: "PUT",
    url: "/workspace-governance",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.workspace-governance.v1",
      updatedBy: "qa-owner",
      participants: [
        {
          id: "qa",
          name: "QA",
          role: "owner",
          areas: ["catalog", "schemas"],
          status: "active",
          updatedAt: "2026-07-02T10:00:00.000Z",
          updatedBy: "qa-owner",
        },
      ],
      policies: [
        {
          area: "catalog",
          mode: "owner_required",
          requiredRole: "owner",
          updatedAt: "2026-07-02T10:00:00.000Z",
          updatedBy: "qa-owner",
        },
      ],
    },
  });
  assert.equal(savedGovernance.statusCode, 200);
  assert.equal(savedGovernance.json().participantCount, 1);
  assert.equal(savedGovernance.json().ownerCount, 1);
  assert.equal(savedGovernance.json().policies[0].mode, "owner_required");
  assert.equal(savedGovernance.json().auditEntries.at(-1).action, "package_saved");

  await access(path.join(workspaceRoot, ".agent-flow", "governance", "workspace.afgovernance.json"));

  const mergedGovernance = await app.inject({
    method: "POST",
    url: "/workspace-governance/merge",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.workspace-governance.v1",
      participants: [
        {
          id: "qa",
          name: "QA",
          role: "viewer",
          areas: ["catalog"],
          status: "active",
          updatedAt: "2026-07-02T11:00:00.000Z",
          updatedBy: "remote-reviewer",
        },
      ],
      policies: [
        {
          area: "catalog",
          mode: "review_required",
          requiredRole: "reviewer",
          updatedAt: "2026-07-02T11:00:00.000Z",
          updatedBy: "remote-reviewer",
        },
      ],
    },
  });
  assert.equal(mergedGovernance.statusCode, 200);
  assert.equal(mergedGovernance.json().participants[0].role, "owner");
  assert.equal(mergedGovernance.json().openConflictCount, 1);
  assert.equal(mergedGovernance.json().conflicts[0].participantId, "qa");
  assert.equal(mergedGovernance.json().conflicts[0].incomingSnapshot.role, "viewer");
  assert.equal(mergedGovernance.json().auditEntries.some((entry) => entry.action === "conflict_detected"), true);
  assert.equal(mergedGovernance.json().policies[0].mode, "review_required");

  const allowedDecision = await app.inject({
    method: "POST",
    url: "/workspace-governance/authorize",
    headers: { "content-type": "application/json" },
    payload: {
      actorId: "qa",
      area: "catalog",
      action: "merge",
    },
  });
  assert.equal(allowedDecision.statusCode, 200);
  assert.equal(allowedDecision.json().format, "agent-flow-builder.workspace-governance-decision.v1");
  assert.equal(allowedDecision.json().allowed, true);
  assert.equal(allowedDecision.json().effect, "allowed");
  assert.equal(allowedDecision.json().enforcementMode, "advisory");
  assert.equal(allowedDecision.json().requiredRole, "reviewer");

  const deniedDecision = await app.inject({
    method: "POST",
    url: "/workspace-governance/authorize",
    headers: { "content-type": "application/json" },
    payload: {
      actorId: "qa",
      area: "runtime_delivery",
      action: "deliver_runtime",
    },
  });
  assert.equal(deniedDecision.statusCode, 200);
  assert.equal(deniedDecision.json().allowed, false);
  assert.equal(deniedDecision.json().effect, "would_block");
  assert.equal(deniedDecision.json().requiredRole, "owner");
  assert.equal(
    deniedDecision.json().reasons.some((reason) => reason.includes("não possui acesso")),
    true,
  );

  const conflictId = mergedGovernance.json().conflicts[0].id;
  const resolvedGovernance = await app.inject({
    method: "POST",
    url: `/workspace-governance/conflicts/${encodeURIComponent(conflictId)}/resolve`,
    headers: { "content-type": "application/json" },
    payload: {
      resolvedBy: "qa-owner",
      resolution: "use_incoming",
    },
  });
  assert.equal(resolvedGovernance.statusCode, 200);
  assert.equal(resolvedGovernance.json().openConflictCount, 0);
  assert.equal(resolvedGovernance.json().participants[0].role, "viewer");
  assert.equal(resolvedGovernance.json().conflicts[0].status, "resolved");
  assert.equal(resolvedGovernance.json().conflicts[0].resolvedBy, "qa-owner");
  assert.equal(resolvedGovernance.json().auditEntries.at(-1).action, "conflict_resolved");
});

test("Builder API can enforce workspace governance authorization for governance mutations", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-builder-api-workspace-governance-enforced-"));
  const previousEnforce = process.env.AGENT_FLOW_WORKSPACE_GOVERNANCE_ENFORCE;
  process.env.AGENT_FLOW_WORKSPACE_GOVERNANCE_ENFORCE = "true";
  t.after(async () => {
    if (previousEnforce === undefined) {
      delete process.env.AGENT_FLOW_WORKSPACE_GOVERNANCE_ENFORCE;
    } else {
      process.env.AGENT_FLOW_WORKSPACE_GOVERNANCE_ENFORCE = previousEnforce;
    }
    return rm(workspaceRoot, { recursive: true, force: true });
  });

  const app = buildApp({ workspaceRoot });
  const governancePayload = {
    format: "agent-flow-builder.workspace-governance.v1",
    updatedBy: "local-studio",
    participants: [
      {
        id: "local-studio",
        name: "local-studio",
        role: "owner",
        areas: ["*"],
        status: "active",
        updatedAt: "2026-07-02T10:00:00.000Z",
        updatedBy: "system",
      },
      {
        id: "qa-viewer",
        name: "QA Viewer",
        role: "viewer",
        areas: ["governance"],
        status: "active",
        updatedAt: "2026-07-02T10:00:00.000Z",
        updatedBy: "local-studio",
      },
    ],
    policies: [
      {
        area: "governance",
        mode: "review_required",
        requiredRole: "reviewer",
        updatedAt: "2026-07-02T10:00:00.000Z",
        updatedBy: "local-studio",
      },
    ],
  };

  const ownerSave = await app.inject({
    method: "PUT",
    url: "/workspace-governance",
    headers: {
      "content-type": "application/json",
      "x-agent-flow-actor": "local-studio",
    },
    payload: governancePayload,
  });
  assert.equal(ownerSave.statusCode, 200);
  assert.equal(ownerSave.json().governance.authEnforced, false);

  const viewerSave = await app.inject({
    method: "PUT",
    url: "/workspace-governance",
    headers: {
      "content-type": "application/json",
      "x-agent-flow-actor": "qa-viewer",
    },
    payload: governancePayload,
  });
  assert.equal(viewerSave.statusCode, 403);
  assert.equal(viewerSave.json().error, "workspace_error");
  assert.equal(viewerSave.json().details.decision.effect, "blocked");
  assert.equal(viewerSave.json().details.decision.enforcementMode, "enforced");

  const viewerCatalogMutation = await app.inject({
    method: "POST",
    url: "/catalog/items",
    headers: {
      "content-type": "application/json",
      "x-agent-flow-actor": "qa-viewer",
    },
    payload: {},
  });
  assert.equal(viewerCatalogMutation.statusCode, 403);
  assert.equal(viewerCatalogMutation.json().details.decision.area, "catalog");
  assert.equal(viewerCatalogMutation.json().details.decision.action, "write");

  const viewerRuntimeDelivery = await app.inject({
    method: "POST",
    url: "/docker-runtime/build",
    headers: {
      "content-type": "application/json",
      "x-agent-flow-actor": "qa-viewer",
    },
    payload: {
      outDir: "generated/reference-interview-runtime",
    },
  });
  assert.equal(viewerRuntimeDelivery.statusCode, 403);
  assert.equal(viewerRuntimeDelivery.json().details.decision.area, "runtime_delivery");
  assert.equal(viewerRuntimeDelivery.json().details.decision.action, "deliver_runtime");
});

test("Builder API enforces annotation queue item permissions when an actor is present", async (t) => {
  const workspaceRoot = await createWorkspaceWithReferenceFlow("agent-builder-api-annotation-permissions-");
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const app = buildApp({ workspaceRoot });
  const baseQueuePayload = {
    format: "agent-flow-builder.annotation-queue.v1",
    exportedAt: "2026-07-02T00:00:00.000Z",
    flow: { id: "reference-interview", name: "Reference Interview Agent", version: "0.1.0" },
    permissionPolicy: {
      mode: "assignee_only",
      reviewers: [
        { name: "qa-owner", role: "owner", updatedAt: "2026-07-02T00:00:00.000Z" },
        { name: "reviewer-a", role: "reviewer", updatedAt: "2026-07-02T00:00:00.000Z" },
        { name: "viewer-a", role: "viewer", updatedAt: "2026-07-02T00:00:00.000Z" },
      ],
      updatedAt: "2026-07-02T00:00:00.000Z",
      updatedBy: "qa-owner",
    },
    items: [
      annotationItem("annotation-a", "reviewer-a"),
      annotationItem("annotation-b", "reviewer-b"),
    ],
  };

  const ownerSeed = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/annotation-queue",
    headers: {
      "content-type": "application/json",
      "x-agent-flow-actor": "qa-owner",
    },
    payload: baseQueuePayload,
  });
  assert.equal(ownerSeed.statusCode, 200);
  assert.equal(ownerSeed.json().permissionPolicy.mode, "assignee_only");
  assert.equal(ownerSeed.json().itemCount, 2);

  const viewerDenied = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/annotation-queue/merge",
    headers: {
      "content-type": "application/json",
      "x-agent-flow-actor": "viewer-a",
    },
    payload: {
      items: [
        {
          ...ownerSeed.json().items[0],
          status: "accepted",
          reviewedBy: "viewer-a",
          reviewedAt: "2026-07-02T00:01:00.000Z",
          updatedAt: "2026-07-02T00:01:00.000Z",
        },
      ],
    },
  });
  assert.equal(viewerDenied.statusCode, 403);
  assert.equal(viewerDenied.json().details.decision.format, "agent-flow-builder.annotation-queue-permission-decision.v1");
  assert.equal(viewerDenied.json().details.decision.role, "viewer");

  const wrongAssigneeDenied = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/annotation-queue/merge",
    headers: {
      "content-type": "application/json",
      "x-agent-flow-actor": "reviewer-a",
    },
    payload: {
      items: [
        {
          ...ownerSeed.json().items[1],
          status: "accepted",
          reviewedBy: "reviewer-a",
          reviewedAt: "2026-07-02T00:02:00.000Z",
          updatedAt: "2026-07-02T00:02:00.000Z",
        },
      ],
    },
  });
  assert.equal(wrongAssigneeDenied.statusCode, 403);
  assert.match(wrongAssigneeDenied.json().details.decision.reasons.join(" "), /annotation-b/);

  const reviewerAllowed = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/annotation-queue/merge",
    headers: {
      "content-type": "application/json",
      "x-agent-flow-actor": "reviewer-a",
    },
    payload: {
      items: [
        {
          ...ownerSeed.json().items[0],
          status: "accepted",
          reviewedBy: "reviewer-a",
          reviewedAt: "2026-07-02T00:03:00.000Z",
          updatedAt: "2026-07-02T00:03:00.000Z",
        },
      ],
    },
  });
  assert.equal(reviewerAllowed.statusCode, 200);
  assert.equal(reviewerAllowed.json().items.find((item) => item.id === "annotation-a").status, "accepted");
  assert.equal(reviewerAllowed.json().items.find((item) => item.id === "annotation-b").status, "pending");

  const reviewerPolicyDenied = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/annotation-queue/merge",
    headers: {
      "content-type": "application/json",
      "x-agent-flow-actor": "reviewer-a",
    },
    payload: {
      permissionPolicy: {
        ...reviewerAllowed.json().permissionPolicy,
        mode: "open",
        updatedAt: "2026-07-02T00:04:00.000Z",
        updatedBy: "reviewer-a",
      },
      items: reviewerAllowed.json().items,
    },
  });
  assert.equal(reviewerPolicyDenied.statusCode, 403);
  assert.match(reviewerPolicyDenied.json().details.decision.reasons.join(" "), /owner/);

  const ownerPolicyAllowed = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/annotation-queue/merge",
    headers: {
      "content-type": "application/json",
      "x-agent-flow-actor": "qa-owner",
    },
    payload: {
      permissionPolicy: {
        ...reviewerAllowed.json().permissionPolicy,
        mode: "open",
        updatedAt: "2026-07-02T00:05:00.000Z",
        updatedBy: "qa-owner",
      },
      items: reviewerAllowed.json().items,
    },
  });
  assert.equal(ownerPolicyAllowed.statusCode, 200);
  assert.equal(ownerPolicyAllowed.json().permissionPolicy.mode, "open");
});

test("Builder API optional local auth protects routes and injects the governance actor", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-builder-api-builder-auth-"));
  const previousRequired = process.env.AGENT_FLOW_BUILDER_AUTH_REQUIRED;
  const previousKeys = process.env.AGENT_FLOW_BUILDER_API_KEYS;
  const previousKeysPath = process.env.AGENT_FLOW_BUILDER_API_KEYS_PATH;
  const previousAuditPath = process.env.AGENT_FLOW_BUILDER_AUTH_AUDIT_PATH;
  const previousSessionPath = process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_PATH;
  const previousSessionServiceUrl = process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_URL;
  const previousSessionServiceToken = process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_TOKEN;
  const previousSessionServiceTimeout = process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_TIMEOUT_MS;
  const previousSessionIntrospectionUrl = process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_URL;
  const previousSessionIntrospectionToken = process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_TOKEN;
  const previousSessionIntrospectionTimeout = process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_TIMEOUT_MS;
  const previousSessionIntrospectionRequired = process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_REQUIRED;
  const previousAuditSinkUrl = process.env.AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_URL;
  const previousAuditSinkToken = process.env.AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_TOKEN;
  const previousAuditSinkTimeout = process.env.AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_TIMEOUT_MS;
  const previousEnforce = process.env.AGENT_FLOW_WORKSPACE_GOVERNANCE_ENFORCE;
  const keyFilePath = path.join(workspaceRoot, ".agent-flow", "builder-auth", "keys.json");
  const auditFilePath = path.join(workspaceRoot, ".agent-flow", "builder-auth", "audit.jsonl");
  const sessionFilePath = path.join(workspaceRoot, ".agent-flow", "builder-auth", "sessions.json");
  const auditSink = await startBuilderAuthAuditSinkServer();
  const sessionService = await startBuilderAuthSessionServiceServer();
  const sessionIntrospection = await startBuilderAuthSessionIntrospectionServer();
  process.env.AGENT_FLOW_BUILDER_AUTH_REQUIRED = "true";
  process.env.AGENT_FLOW_WORKSPACE_GOVERNANCE_ENFORCE = "true";
  process.env.AGENT_FLOW_BUILDER_API_KEYS_PATH = keyFilePath;
  process.env.AGENT_FLOW_BUILDER_AUTH_AUDIT_PATH = auditFilePath;
  process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_PATH = sessionFilePath;
  process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_URL = sessionService.url;
  process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_TOKEN = "builder-session-service-secret";
  process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_TIMEOUT_MS = "1000";
  process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_URL = sessionIntrospection.url;
  process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_TOKEN = "builder-session-introspection-secret";
  process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_TIMEOUT_MS = "1000";
  process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_REQUIRED = "true";
  process.env.AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_URL = auditSink.url;
  process.env.AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_TOKEN = "builder-audit-sink-secret";
  process.env.AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_TIMEOUT_MS = "1000";
  process.env.AGENT_FLOW_BUILDER_API_KEYS = JSON.stringify([
    {
      key_id: "owner",
      key: "owner-secret",
      actor_id: "local-studio",
      name: "Local Owner",
      role: "owner",
      areas: ["*"],
    },
    {
      key_id: "viewer",
      key: "viewer-secret",
      actor_id: "qa-viewer",
      name: "QA Viewer",
      role: "viewer",
      areas: ["runtime_delivery"],
    },
  ]);
  t.after(async () => {
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_REQUIRED", previousRequired);
    restoreEnv("AGENT_FLOW_BUILDER_API_KEYS", previousKeys);
    restoreEnv("AGENT_FLOW_BUILDER_API_KEYS_PATH", previousKeysPath);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_AUDIT_PATH", previousAuditPath);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_SESSION_PATH", previousSessionPath);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_URL", previousSessionServiceUrl);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_TOKEN", previousSessionServiceToken);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_TIMEOUT_MS", previousSessionServiceTimeout);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_URL", previousSessionIntrospectionUrl);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_TOKEN", previousSessionIntrospectionToken);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_TIMEOUT_MS", previousSessionIntrospectionTimeout);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_REQUIRED", previousSessionIntrospectionRequired);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_URL", previousAuditSinkUrl);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_TOKEN", previousAuditSinkToken);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_TIMEOUT_MS", previousAuditSinkTimeout);
    restoreEnv("AGENT_FLOW_WORKSPACE_GOVERNANCE_ENFORCE", previousEnforce);
    await auditSink.close();
    await sessionService.close();
    await sessionIntrospection.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const app = buildApp({ workspaceRoot });

  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);

  const authStatus = await app.inject({ method: "GET", url: "/builder-auth/status" });
  assert.equal(authStatus.statusCode, 200);
  assert.equal(authStatus.json().required, true);
  assert.equal(authStatus.json().keyCount, 2);
  assert.equal(authStatus.json().sessions.persistent, true);
  assert.equal(authStatus.json().sessions.externalServiceConfigured, true);
  assert.equal(authStatus.json().sessions.externalServiceTokenConfigured, true);
  assert.equal(authStatus.json().sessions.externalServiceTimeoutMs, 1000);
  assert.equal(authStatus.json().sessions.centralIntrospectionConfigured, true);
  assert.equal(authStatus.json().sessions.centralIntrospectionRequired, true);
  assert.equal(authStatus.json().sessions.centralIntrospectionTokenConfigured, true);
  assert.equal(authStatus.json().sessions.centralIntrospectionTimeoutMs, 1000);
  assert.equal(authStatus.json().sessions.centralIntrospectionSendsTokenHashes, true);
  assert.equal(authStatus.json().sessions.centralIntrospectionSendsRawTokens, false);
  assert.equal(authStatus.json().sessions.centralIntrospectionFailClosed, true);
  assert.equal(authStatus.json().sessions.storesTokenHashes, true);
  assert.equal(authStatus.json().sessions.storesRawTokens, false);
  assert.equal(authStatus.json().sessions.externalServiceSendsTokenHashes, true);
  assert.equal(authStatus.json().sessions.externalServiceSendsRawTokens, false);
  assert.equal(authStatus.json().audit.persistent, true);
  assert.equal(authStatus.json().audit.externalSinkConfigured, true);
  assert.equal(authStatus.json().audit.externalSinkTokenConfigured, true);
  assert.equal(authStatus.json().audit.externalSinkTimeoutMs, 1000);
  assert.equal(authStatus.json().governance.excludesRawKeyValues, true);
  assert.equal(JSON.stringify(authStatus.json()).includes("owner-secret"), false);
  assert.equal(JSON.stringify(authStatus.json()).includes("viewer-secret"), false);
  assert.equal(JSON.stringify(authStatus.json()).includes("builder-audit-sink-secret"), false);
  assert.equal(JSON.stringify(authStatus.json()).includes("builder-session-service-secret"), false);
  assert.equal(JSON.stringify(authStatus.json()).includes("builder-session-introspection-secret"), false);
  assert.equal(JSON.stringify(authStatus.json()).includes(auditSink.url), false);
  assert.equal(JSON.stringify(authStatus.json()).includes(sessionService.url), false);
  assert.equal(JSON.stringify(authStatus.json()).includes(sessionIntrospection.url), false);

  const missingAuth = await app.inject({ method: "GET", url: "/flows" });
  assert.equal(missingAuth.statusCode, 401);
  assert.equal(missingAuth.json().details.auth.status, "missing");
  const missingSinkEvent = await auditSink.waitForEvent((event) => event.body.entry?.status === "missing" && event.body.entry?.route === "/flows");
  assert.equal(missingSinkEvent.headers.authorization, "Bearer builder-audit-sink-secret");
  assert.equal(missingSinkEvent.body.format, "agent-flow-builder.builder-auth-audit-sink-event.v1");
  assert.equal(missingSinkEvent.body.governance.excludesRawKeyValues, true);
  assert.equal(missingSinkEvent.body.governance.excludesHeaders, true);
  assert.equal(missingSinkEvent.body.governance.sinkAuthTokenInBody, false);
  assert.equal(JSON.stringify(missingSinkEvent.body).includes("owner-secret"), false);
  assert.equal(JSON.stringify(missingSinkEvent.body).includes("viewer-secret"), false);
  assert.equal(JSON.stringify(missingSinkEvent.body).includes("builder-audit-sink-secret"), false);

  const authenticatedList = await app.inject({
    method: "GET",
    url: "/flows",
    headers: { "x-agent-flow-builder-key": "owner-secret" },
  });
  assert.equal(authenticatedList.statusCode, 200);

  const builderSession = await app.inject({
    method: "POST",
    url: "/builder-auth/session",
    headers: { "x-agent-flow-builder-key": "owner-secret" },
  });
  assert.equal(builderSession.statusCode, 200);
  assert.equal(builderSession.json().format, "agent-flow-builder.builder-auth-session.v1");
  assert.equal(builderSession.json().token.startsWith("afbs_"), true);
  assert.equal(builderSession.json().governance.storesRawToken, false);
  assert.equal(builderSession.json().governance.returnsRawTokenOnce, true);
  assert.equal(JSON.stringify(builderSession.json()).includes("owner-secret"), false);
  const sessionFileAfterCreate = await readFile(sessionFilePath, "utf-8");
  assert.equal(sessionFileAfterCreate.includes(builderSession.json().token), false);
  assert.equal(sessionFileAfterCreate.includes("owner-secret"), false);
  assert.equal(JSON.parse(sessionFileAfterCreate).sessions.length, 1);
  const createSessionServiceEvent = await sessionService.waitForEvent((event) => event.body.action === "created");
  assert.equal(createSessionServiceEvent.headers.authorization, "Bearer builder-session-service-secret");
  assert.equal(createSessionServiceEvent.body.format, "agent-flow-builder.builder-auth-session-service-event.v1");
  assert.equal(createSessionServiceEvent.body.session.tokenHash.length, 64);
  assert.equal(createSessionServiceEvent.body.session.previousTokenHash, null);
  assert.equal(createSessionServiceEvent.body.session.identity.actorId, "local-studio");
  assert.equal(createSessionServiceEvent.body.governance.sendsRawToken, false);
  assert.equal(createSessionServiceEvent.body.governance.sendsProviderTokens, false);
  assert.equal(createSessionServiceEvent.body.governance.serviceAuthTokenInBody, false);
  assert.equal(JSON.stringify(createSessionServiceEvent.body).includes(builderSession.json().token), false);
  assert.equal(JSON.stringify(createSessionServiceEvent.body).includes("owner-secret"), false);
  assert.equal(JSON.stringify(createSessionServiceEvent.body).includes("builder-session-service-secret"), false);

  const sessionList = await app.inject({
    method: "GET",
    url: "/flows",
    headers: { authorization: `Bearer ${builderSession.json().token}` },
  });
  assert.equal(sessionList.statusCode, 200);
  const sessionIntrospectionEvent = await sessionIntrospection.waitForEvent((event) => (
    event.body.session?.tokenHash === createSessionServiceEvent.body.session.tokenHash
  ));
  assert.equal(sessionIntrospectionEvent.headers.authorization, "Bearer builder-session-introspection-secret");
  assert.equal(sessionIntrospectionEvent.body.format, "agent-flow-builder.builder-auth-session-introspection-request.v1");
  assert.equal(sessionIntrospectionEvent.body.session.localIdentity.actorId, "local-studio");
  assert.equal(sessionIntrospectionEvent.body.session.localIdentity.source, "session");
  assert.equal(sessionIntrospectionEvent.body.governance.sendsTokenHash, true);
  assert.equal(sessionIntrospectionEvent.body.governance.sendsRawToken, false);
  assert.equal(sessionIntrospectionEvent.body.governance.sendsProviderTokens, false);
  assert.equal(sessionIntrospectionEvent.body.governance.serviceAuthTokenInBody, false);
  assert.equal(JSON.stringify(sessionIntrospectionEvent.body).includes(builderSession.json().token), false);
  assert.equal(JSON.stringify(sessionIntrospectionEvent.body).includes("owner-secret"), false);
  assert.equal(JSON.stringify(sessionIntrospectionEvent.body).includes("builder-session-introspection-secret"), false);
  const centralSessionAuditEvent = await auditSink.waitForEvent((event) => (
    event.body.entry?.status === "allowed" &&
    event.body.entry?.route === "/flows" &&
    event.body.entry?.actorId === "central-owner"
  ));
  assert.equal(centralSessionAuditEvent.body.entry.source, "central-session");

  const reloadedApp = buildApp({ workspaceRoot });
  const reloadedSessionList = await reloadedApp.inject({
    method: "GET",
    url: "/flows",
    headers: { authorization: `Bearer ${builderSession.json().token}` },
  });
  assert.equal(reloadedSessionList.statusCode, 200);

  const refreshedSession = await app.inject({
    method: "POST",
    url: "/builder-auth/session/refresh",
    headers: { authorization: `Bearer ${builderSession.json().token}` },
  });
  assert.equal(refreshedSession.statusCode, 200);
  assert.equal(refreshedSession.json().format, "agent-flow-builder.builder-auth-session.v1");
  assert.equal(refreshedSession.json().token.startsWith("afbs_"), true);
  assert.notEqual(refreshedSession.json().token, builderSession.json().token);
  assert.equal(JSON.stringify(refreshedSession.json()).includes("owner-secret"), false);
  const sessionFileAfterRefresh = await readFile(sessionFilePath, "utf-8");
  assert.equal(sessionFileAfterRefresh.includes(builderSession.json().token), false);
  assert.equal(sessionFileAfterRefresh.includes(refreshedSession.json().token), false);
  assert.equal(JSON.parse(sessionFileAfterRefresh).sessions.length, 1);
  const refreshSessionServiceEvent = await sessionService.waitForEvent((event) => event.body.action === "refreshed");
  assert.equal(refreshSessionServiceEvent.body.session.tokenHash.length, 64);
  assert.equal(refreshSessionServiceEvent.body.session.previousTokenHash, createSessionServiceEvent.body.session.tokenHash);
  assert.equal(JSON.stringify(refreshSessionServiceEvent.body).includes(builderSession.json().token), false);
  assert.equal(JSON.stringify(refreshSessionServiceEvent.body).includes(refreshedSession.json().token), false);

  const oldSessionRejected = await app.inject({
    method: "GET",
    url: "/flows",
    headers: { authorization: `Bearer ${builderSession.json().token}` },
  });
  assert.equal(oldSessionRejected.statusCode, 403);
  assert.match(oldSessionRejected.json().details.auth.reason, /inválida ou expirada/);

  const refreshedSessionList = await app.inject({
    method: "GET",
    url: "/flows",
    headers: { authorization: `Bearer ${refreshedSession.json().token}` },
  });
  assert.equal(refreshedSessionList.statusCode, 200);

  sessionIntrospection.setDecision({
    allowed: false,
    reason: "central session policy revoked",
  });
  const centrallyRejectedSession = await app.inject({
    method: "GET",
    url: "/flows",
    headers: { authorization: `Bearer ${refreshedSession.json().token}` },
  });
  assert.equal(centrallyRejectedSession.statusCode, 403);
  assert.match(centrallyRejectedSession.json().details.auth.reason, /central session policy revoked/);
  const centralRejectAuditEvent = await auditSink.waitForEvent((event) => (
    event.body.entry?.status === "rejected" &&
    event.body.entry?.route === "/flows" &&
    event.body.entry?.reason === "central session policy revoked"
  ));
  assert.equal(centralRejectAuditEvent.body.entry.actorId, null);
  sessionIntrospection.setDecision(null);

  const logoutSession = await app.inject({
    method: "POST",
    url: "/builder-auth/session/logout",
    headers: { authorization: `Bearer ${refreshedSession.json().token}` },
  });
  assert.equal(logoutSession.statusCode, 200);
  assert.equal(logoutSession.json().format, "agent-flow-builder.builder-auth-session-logout.v1");
  assert.equal(logoutSession.json().revoked, true);
  assert.equal(logoutSession.json().governance.returnsRawToken, false);
  const sessionFileAfterLogout = await readFile(sessionFilePath, "utf-8");
  assert.equal(sessionFileAfterLogout.includes(refreshedSession.json().token), false);
  assert.equal(JSON.parse(sessionFileAfterLogout).sessions.length, 0);
  const revokeSessionServiceEvent = await sessionService.waitForEvent((event) => event.body.action === "revoked");
  assert.equal(revokeSessionServiceEvent.body.session.tokenHash, refreshSessionServiceEvent.body.session.tokenHash);
  assert.equal(revokeSessionServiceEvent.body.session.revoked, true);
  assert.equal(JSON.stringify(revokeSessionServiceEvent.body).includes(refreshedSession.json().token), false);

  const loggedOutSessionRejected = await app.inject({
    method: "GET",
    url: "/flows",
    headers: { authorization: `Bearer ${refreshedSession.json().token}` },
  });
  assert.equal(loggedOutSessionRejected.statusCode, 403);
  assert.match(loggedOutSessionRejected.json().details.auth.reason, /inválida ou expirada/);

  const governancePayload = {
    format: "agent-flow-builder.workspace-governance.v1",
    updatedBy: "local-studio",
    participants: [
      {
        id: "local-studio",
        name: "Local Owner",
        role: "owner",
        areas: ["*"],
        status: "active",
        updatedAt: "2026-07-02T10:00:00.000Z",
        updatedBy: "system",
      },
      {
        id: "qa-viewer",
        name: "QA Viewer",
        role: "viewer",
        areas: ["runtime_delivery"],
        status: "active",
        updatedAt: "2026-07-02T10:00:00.000Z",
        updatedBy: "local-studio",
      },
    ],
    policies: [
      {
        area: "runtime_delivery",
        mode: "owner_required",
        requiredRole: "owner",
        updatedAt: "2026-07-02T10:00:00.000Z",
        updatedBy: "local-studio",
      },
    ],
  };

  const ownerSave = await app.inject({
    method: "PUT",
    url: "/workspace-governance",
    headers: { "x-agent-flow-builder-key": "owner-secret", "content-type": "application/json" },
    payload: governancePayload,
  });
  assert.equal(ownerSave.statusCode, 200);

  const spoofedViewerDelivery = await app.inject({
    method: "POST",
    url: "/docker-runtime/build",
    headers: {
      "x-agent-flow-builder-key": "viewer-secret",
      "x-agent-flow-actor": "local-studio",
      "content-type": "application/json",
    },
    payload: { outDir: "generated/reference-interview-runtime" },
  });
  assert.equal(spoofedViewerDelivery.statusCode, 403);
  assert.equal(spoofedViewerDelivery.json().details.decision.actorId, "qa-viewer");
  assert.equal(spoofedViewerDelivery.json().details.decision.effect, "blocked");

  const audit = await app.inject({
    method: "GET",
    url: "/builder-auth/audit?limit=20",
    headers: { "x-agent-flow-builder-key": "owner-secret" },
  });
  assert.equal(audit.statusCode, 200);
  assert.equal(audit.json().format, "agent-flow-builder.builder-auth-audit.v1");
  assert.equal(audit.json().governance.excludesRawKeyValues, true);
  assert.equal(audit.json().governance.persistent, true);
  assert.equal(audit.json().governance.localOnly, false);
  assert.equal(audit.json().governance.externalSinkConfigured, true);
  assert.equal(audit.json().governance.externalSinkNonBlocking, true);
  assert.equal(audit.json().governance.externalSinkSendsRawKeyValues, false);
  assert.equal(audit.json().governance.externalSinkSendsHeaders, false);
  assert.equal(audit.json().governance.loadedFromPersistentStore, true);
  assert.equal(audit.json().entries.some((entry) => entry.status === "missing" && entry.route === "/flows"), true);
  assert.equal(audit.json().entries.some((entry) => entry.status === "allowed" && entry.keyId === "viewer"), true);
  assert.equal(audit.json().filteredTotal, audit.json().total);
  assert.equal(audit.json().summary.returnedCount, audit.json().entries.length);
  assert.equal(audit.json().summary.statusCounts.allowed > 0, true);
  assert.equal(audit.json().entries.some((entry) => entry.status === "allowed" && entry.source === "central-session"), true);
  assert.equal(JSON.stringify(audit.json()).includes("owner-secret"), false);
  assert.equal(JSON.stringify(audit.json()).includes("viewer-secret"), false);
  assert.equal(JSON.stringify(audit.json()).includes(builderSession.json().token), false);
  assert.equal(JSON.stringify(audit.json()).includes("builder-audit-sink-secret"), false);
  assert.equal(JSON.stringify(audit.json()).includes("builder-session-service-secret"), false);
  assert.equal(JSON.stringify(audit.json()).includes("builder-session-introspection-secret"), false);

  const filteredAudit = await app.inject({
    method: "GET",
    url: "/builder-auth/audit?limit=5&status=allowed&actorId=qa-viewer&route=docker-runtime",
    headers: { "x-agent-flow-builder-key": "owner-secret" },
  });
  assert.equal(filteredAudit.statusCode, 200);
  assert.equal(filteredAudit.json().query.status, "allowed");
  assert.equal(filteredAudit.json().query.actorId, "qa-viewer");
  assert.equal(filteredAudit.json().query.route, "docker-runtime");
  assert.equal(filteredAudit.json().filteredTotal > 0, true);
  assert.equal(filteredAudit.json().summary.statusCounts.allowed, filteredAudit.json().filteredTotal);
  assert.equal(filteredAudit.json().summary.statusCounts.missing, 0);
  assert.equal(filteredAudit.json().summary.uniqueActorCount, 1);
  assert.equal(filteredAudit.json().entries.every((entry) => entry.status === "allowed" && entry.actorId === "qa-viewer"), true);
  assert.equal(JSON.stringify(filteredAudit.json()).includes("viewer-secret"), false);

  const invalidAuditStatus = await app.inject({
    method: "GET",
    url: "/builder-auth/audit?status=blocked",
    headers: { "x-agent-flow-builder-key": "owner-secret" },
  });
  assert.equal(invalidAuditStatus.statusCode, 400);

  const auditFile = await readFile(auditFilePath, "utf-8");
  assert.equal(auditFile.includes("owner-secret"), false);
  assert.equal(auditFile.includes("viewer-secret"), false);
  assert.equal(auditFile.includes("builder-session-service-secret"), false);
  assert.equal(auditFile.includes("builder-session-introspection-secret"), false);
  assert.equal(auditFile.split(/\r?\n/).filter(Boolean).length > 0, true);

  const restartedApp = buildApp({ workspaceRoot });
  const reloadedAudit = await restartedApp.inject({
    method: "GET",
    url: "/builder-auth/audit?status=missing&route=flows&limit=20",
    headers: { "x-agent-flow-builder-key": "owner-secret" },
  });
  assert.equal(reloadedAudit.statusCode, 200);
  assert.equal(reloadedAudit.json().governance.loadedFromPersistentStore, true);
  assert.equal(reloadedAudit.json().governance.persistentEntryCount > 0, true);
  assert.equal(reloadedAudit.json().query.status, "missing");
  assert.equal(reloadedAudit.json().entries.some((entry) => entry.status === "missing" && entry.route === "/flows"), true);
  assert.equal(JSON.stringify(reloadedAudit.json()).includes("owner-secret"), false);
  assert.equal(JSON.stringify(reloadedAudit.json()).includes("viewer-secret"), false);

  const rotated = await app.inject({
    method: "POST",
    url: "/builder-auth/keys",
    headers: { "x-agent-flow-builder-key": "owner-secret", "content-type": "application/json" },
    payload: {
      keyId: "generated-reviewer",
      actorId: "generated-reviewer",
      name: "Generated Reviewer",
      role: "reviewer",
      areas: ["catalog", "schemas"],
      scopes: ["*"],
    },
  });
  assert.equal(rotated.statusCode, 200);
  assert.equal(rotated.json().format, "agent-flow-builder.builder-auth-key-rotation.v1");
  assert.match(rotated.json().keyValue, /^afbk_/);
  assert.equal(rotated.json().governance.storesRawKeyValue, false);
  assert.equal(rotated.json().status.keys.some((key) => key.keyId === "generated-reviewer"), true);

  const keyFile = await readFile(keyFilePath, "utf-8");
  assert.equal(keyFile.includes(rotated.json().keyValue), false);
  assert.equal(JSON.parse(keyFile).governance.storesRawKeyValues, false);

  const generatedAuth = await app.inject({
    method: "GET",
    url: "/flows",
    headers: { "x-agent-flow-builder-key": rotated.json().keyValue },
  });
  assert.equal(generatedAuth.statusCode, 200);

  const disabledStatus = await app.inject({
    method: "POST",
    url: "/builder-auth/keys/generated-reviewer/disable",
    headers: { "x-agent-flow-builder-key": "owner-secret" },
  });
  assert.equal(disabledStatus.statusCode, 200);
  assert.equal(
    disabledStatus.json().keys.find((key) => key.keyId === "generated-reviewer").disabled,
    true,
  );

  const disabledAuth = await app.inject({
    method: "GET",
    url: "/flows",
    headers: { "x-agent-flow-builder-key": rotated.json().keyValue },
  });
  assert.equal(disabledAuth.statusCode, 403);
});

test("Builder API accepts local JWT bearer auth and enforces claim-based areas", async (t) => {
  const workspaceRoot = await createWorkspaceWithReferenceFlow("agent-builder-api-builder-jwt-auth-");
  const previousRequired = process.env.AGENT_FLOW_BUILDER_AUTH_REQUIRED;
  const previousApiKey = process.env.AGENT_FLOW_BUILDER_API_KEY;
  const previousKeys = process.env.AGENT_FLOW_BUILDER_API_KEYS;
  const previousKeysPath = process.env.AGENT_FLOW_BUILDER_API_KEYS_PATH;
  const previousJwtSecret = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_SECRET;
  const previousJwtIssuer = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_ISSUER;
  const previousJwtAudience = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_AUDIENCE;
  const previousJwtActorClaim = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_ACTOR_CLAIM;
  const previousJwtRoleClaim = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_ROLE_CLAIM;
  const previousJwtGroupsClaim = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_GROUPS_CLAIM;
  const previousJwtAreasClaim = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_AREAS_CLAIM;
  const previousJwtScopesClaim = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_SCOPES_CLAIM;
  const previousGroupDirectory = process.env.AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY;
  const previousGroupDirectoryPath = process.env.AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_PATH;
  const previousGroupDirectoryUrl = process.env.AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_URL;
  const previousGroupDirectoryToken = process.env.AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_TOKEN;
  const previousGroupDirectoryTimeout = process.env.AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_TIMEOUT_MS;
  const previousGroupPolicies = process.env.AGENT_FLOW_BUILDER_AUTH_GROUP_POLICIES;
  const previousGroupPoliciesPath = process.env.AGENT_FLOW_BUILDER_AUTH_GROUP_POLICIES_PATH;
  const previousAuditPath = process.env.AGENT_FLOW_BUILDER_AUTH_AUDIT_PATH;
  const secret = "local-jwt-secret-for-tests";
  const auditFilePath = path.join(workspaceRoot, ".agent-flow", "builder-auth", "jwt-audit.jsonl");
  const groupDirectoryServer = await startBuilderAuthGroupDirectoryServer({
    actors: [
      {
        actorId: "external-directory-viewer",
        groups: ["schema-reviewers"],
      },
    ],
  });
  process.env.AGENT_FLOW_BUILDER_AUTH_REQUIRED = "true";
  delete process.env.AGENT_FLOW_BUILDER_API_KEY;
  delete process.env.AGENT_FLOW_BUILDER_API_KEYS;
  delete process.env.AGENT_FLOW_BUILDER_API_KEYS_PATH;
  process.env.AGENT_FLOW_BUILDER_AUTH_JWT_SECRET = secret;
  process.env.AGENT_FLOW_BUILDER_AUTH_JWT_ISSUER = "https://issuer.local";
  process.env.AGENT_FLOW_BUILDER_AUTH_JWT_AUDIENCE = "agent-flow-builder";
  process.env.AGENT_FLOW_BUILDER_AUTH_JWT_ACTOR_CLAIM = "sub";
  process.env.AGENT_FLOW_BUILDER_AUTH_JWT_ROLE_CLAIM = "role";
  process.env.AGENT_FLOW_BUILDER_AUTH_JWT_GROUPS_CLAIM = "groups";
  process.env.AGENT_FLOW_BUILDER_AUTH_JWT_AREAS_CLAIM = "areas";
  process.env.AGENT_FLOW_BUILDER_AUTH_JWT_SCOPES_CLAIM = "scope";
  delete process.env.AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_PATH;
  process.env.AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY = JSON.stringify({
    format: "agent-flow-builder.builder-auth-group-directory.v1",
    actors: [
      {
        actorId: "corp-directory-viewer",
        groups: ["schema-reviewers"],
      },
    ],
  });
  process.env.AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_URL = groupDirectoryServer.url;
  process.env.AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_TOKEN = "group-directory-secret";
  process.env.AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_TIMEOUT_MS = "1000";
  delete process.env.AGENT_FLOW_BUILDER_AUTH_GROUP_POLICIES_PATH;
  process.env.AGENT_FLOW_BUILDER_AUTH_GROUP_POLICIES = JSON.stringify({
    format: "agent-flow-builder.builder-auth-group-policies.v1",
    policies: [
      {
        group: "schema-reviewers",
        role: "reviewer",
        areas: ["schemas"],
        scopes: ["workspace:read", "workspace:write"],
      },
    ],
  });
  process.env.AGENT_FLOW_BUILDER_AUTH_AUDIT_PATH = auditFilePath;
  t.after(async () => {
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_REQUIRED", previousRequired);
    restoreEnv("AGENT_FLOW_BUILDER_API_KEY", previousApiKey);
    restoreEnv("AGENT_FLOW_BUILDER_API_KEYS", previousKeys);
    restoreEnv("AGENT_FLOW_BUILDER_API_KEYS_PATH", previousKeysPath);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_SECRET", previousJwtSecret);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_ISSUER", previousJwtIssuer);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_AUDIENCE", previousJwtAudience);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_ACTOR_CLAIM", previousJwtActorClaim);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_ROLE_CLAIM", previousJwtRoleClaim);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_GROUPS_CLAIM", previousJwtGroupsClaim);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_AREAS_CLAIM", previousJwtAreasClaim);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_SCOPES_CLAIM", previousJwtScopesClaim);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY", previousGroupDirectory);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_PATH", previousGroupDirectoryPath);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_URL", previousGroupDirectoryUrl);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_TOKEN", previousGroupDirectoryToken);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_TIMEOUT_MS", previousGroupDirectoryTimeout);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_GROUP_POLICIES", previousGroupPolicies);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_GROUP_POLICIES_PATH", previousGroupPoliciesPath);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_AUDIT_PATH", previousAuditPath);
    await groupDirectoryServer.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const app = buildApp({ workspaceRoot });
  const token = signBuilderJwt(
    {
      sub: "corp-reviewer",
      name: "Corp Reviewer",
      role: "reviewer",
      groups: ["qa-team", "schema-reviewers"],
      areas: ["schemas"],
      scope: "workspace:read workspace:write",
      iss: "https://issuer.local",
      aud: "agent-flow-builder",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    secret,
    { kid: "corp-key-1" },
  );

  const status = await app.inject({ method: "GET", url: "/builder-auth/status" });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().required, true);
  assert.equal(status.json().keyCount, 0);
  assert.equal(status.json().jwt.configured, true);
  assert.deepEqual(status.json().jwt.algorithms, ["HS256"]);
  assert.equal(status.json().jwt.issuerConfigured, true);
  assert.equal(status.json().jwt.audienceConfigured, true);
  assert.equal(status.json().jwt.groupsClaim, "groups");
  assert.equal(status.json().groupPolicies.configured, true);
  assert.equal(status.json().groupPolicies.policyCount, 1);
  assert.deepEqual(status.json().groupPolicies.groups, ["schema-reviewers"]);
  assert.equal(status.json().groupDirectory.configured, true);
  assert.equal(status.json().groupDirectory.actorCount, 2);
  assert.equal(status.json().groupDirectory.groupCount, 1);
  assert.equal(status.json().groupDirectory.externalConfigured, true);
  assert.equal(status.json().groupDirectory.externalTokenConfigured, true);
  assert.equal(status.json().groupDirectory.externalTimeoutMs, 1000);
  assert.deepEqual(status.json().groupDirectory.groups, ["schema-reviewers"]);
  assert.equal(status.json().governance.excludesJwtSecrets, true);
  assert.equal(JSON.stringify(status.json()).includes(secret), false);
  assert.equal(JSON.stringify(status.json()).includes("group-directory-secret"), false);
  assert.equal(JSON.stringify(status.json()).includes(groupDirectoryServer.url), false);
  assert.equal(groupDirectoryServer.lastAuthorization, "Bearer group-directory-secret");

  const authenticatedList = await app.inject({
    method: "GET",
    url: "/flows",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(authenticatedList.statusCode, 200);

  const schemaWrite = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/schema-pattern-library",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: schemaPatternLibraryPackage([schemaPatternItem("jwt-contact-card")]),
  });
  assert.equal(schemaWrite.statusCode, 200);
  assert.equal(schemaWrite.json().itemCount, 1);

  const runtimeBlocked = await app.inject({
    method: "POST",
    url: "/docker-runtime/build",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: { outDir: "generated/reference-interview-runtime" },
  });
  assert.equal(runtimeBlocked.statusCode, 403);
  assert.equal(runtimeBlocked.json().details.decision.actorId, "corp-reviewer");
  assert.equal(runtimeBlocked.json().details.decision.role, "reviewer");
  assert.equal(runtimeBlocked.json().details.decision.area, "runtime_delivery");

  const builderSession = await app.inject({
    method: "POST",
    url: "/builder-auth/session",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(builderSession.statusCode, 200);
  assert.equal(builderSession.json().identity.actorId, "corp-reviewer");
  assert.equal(builderSession.json().identity.source, "jwt");
  assert.deepEqual(builderSession.json().identity.groups, ["qa-team", "schema-reviewers"]);
  assert.equal(builderSession.json().token.startsWith("afbs_"), true);

  const sessionList = await app.inject({
    method: "GET",
    url: "/flows",
    headers: { authorization: `Bearer ${builderSession.json().token}` },
  });
  assert.equal(sessionList.statusCode, 200);

  const groupPolicyToken = signBuilderJwt(
    {
      sub: "corp-viewer",
      name: "Corp Viewer",
      role: "viewer",
      groups: ["schema-reviewers"],
      areas: ["catalog"],
      scope: "workspace:read",
      iss: "https://issuer.local",
      aud: "agent-flow-builder",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    secret,
    { kid: "corp-key-2" },
  );
  const groupPolicySchemaWrite = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/schema-pattern-library",
    headers: { authorization: `Bearer ${groupPolicyToken}`, "content-type": "application/json" },
    payload: schemaPatternLibraryPackage([schemaPatternItem("jwt-group-contact-card")]),
  });
  assert.equal(groupPolicySchemaWrite.statusCode, 200);

  const directoryPolicyToken = signBuilderJwt(
    {
      sub: "corp-directory-viewer",
      name: "Corp Directory Viewer",
      role: "viewer",
      areas: ["catalog"],
      scope: "workspace:read",
      iss: "https://issuer.local",
      aud: "agent-flow-builder",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    secret,
    { kid: "corp-key-3" },
  );
  const directoryPolicySchemaWrite = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/schema-pattern-library",
    headers: { authorization: `Bearer ${directoryPolicyToken}`, "content-type": "application/json" },
    payload: schemaPatternLibraryPackage([schemaPatternItem("jwt-directory-group-contact-card")]),
  });
  assert.equal(directoryPolicySchemaWrite.statusCode, 200);

  const externalDirectoryPolicyToken = signBuilderJwt(
    {
      sub: "external-directory-viewer",
      name: "External Directory Viewer",
      role: "viewer",
      areas: ["catalog"],
      scope: "workspace:read",
      iss: "https://issuer.local",
      aud: "agent-flow-builder",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    secret,
    { kid: "corp-key-4" },
  );
  const externalDirectoryPolicySchemaWrite = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/schema-pattern-library",
    headers: { authorization: `Bearer ${externalDirectoryPolicyToken}`, "content-type": "application/json" },
    payload: schemaPatternLibraryPackage([schemaPatternItem("jwt-external-directory-group-contact-card")]),
  });
  assert.equal(externalDirectoryPolicySchemaWrite.statusCode, 200);

  const badAudienceToken = signBuilderJwt(
    {
      sub: "corp-reviewer",
      role: "reviewer",
      areas: ["schemas"],
      iss: "https://issuer.local",
      aud: "wrong-audience",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    secret,
  );
  const badAudience = await app.inject({
    method: "GET",
    url: "/flows",
    headers: { authorization: `Bearer ${badAudienceToken}` },
  });
  assert.equal(badAudience.statusCode, 403);
  assert.match(badAudience.json().details.auth.reason, /Audience/);

  const expiredToken = signBuilderJwt(
    {
      sub: "corp-reviewer",
      role: "reviewer",
      areas: ["schemas"],
      iss: "https://issuer.local",
      aud: "agent-flow-builder",
      exp: Math.floor(Date.now() / 1000) - 120,
    },
    secret,
  );
  const expired = await app.inject({
    method: "GET",
    url: "/flows",
    headers: { authorization: `Bearer ${expiredToken}` },
  });
  assert.equal(expired.statusCode, 403);
  assert.match(expired.json().details.auth.reason, /expirado/);

  const audit = await app.inject({
    method: "GET",
    url: "/builder-auth/audit?limit=50&q=jwt",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(audit.statusCode, 200);
  assert.equal(audit.json().entries.some((entry) => entry.source === "jwt" && entry.keyId === "jwt-corp-key-1"), true);
  assert.equal(audit.json().entries.some((entry) => entry.source === "session"), true);
  assert.equal(JSON.stringify(audit.json()).includes(secret), false);
  assert.equal(JSON.stringify(audit.json()).includes(token), false);
  assert.equal(JSON.stringify(audit.json()).includes(builderSession.json().token), false);
  assert.equal(JSON.stringify(audit.json()).includes("group-directory-secret"), false);
  assert.equal(JSON.stringify(audit.json()).includes(groupDirectoryServer.url), false);

  const auditFile = await readFile(auditFilePath, "utf-8");
  assert.equal(auditFile.includes(secret), false);
  assert.equal(auditFile.includes(token), false);
  assert.equal(auditFile.includes(builderSession.json().token), false);
  assert.equal(auditFile.includes("group-directory-secret"), false);
  assert.equal(auditFile.includes(groupDirectoryServer.url), false);
});

test("Builder API accepts RS256 JWT bearer auth from a local JWKS file", async (t) => {
  const workspaceRoot = await createWorkspaceWithReferenceFlow("agent-builder-api-builder-jwks-auth-");
  const previousRequired = process.env.AGENT_FLOW_BUILDER_AUTH_REQUIRED;
  const previousApiKey = process.env.AGENT_FLOW_BUILDER_API_KEY;
  const previousKeys = process.env.AGENT_FLOW_BUILDER_API_KEYS;
  const previousKeysPath = process.env.AGENT_FLOW_BUILDER_API_KEYS_PATH;
  const previousJwtSecret = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_SECRET;
  const previousJwtPublicKey = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_PUBLIC_KEY;
  const previousJwtJwksPath = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_JWKS_PATH;
  const previousJwtJwksUrl = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_JWKS_URL;
  const previousJwtAlgorithms = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_ALGORITHMS;
  const previousJwtIssuer = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_ISSUER;
  const previousJwtAudience = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_AUDIENCE;
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwksPath = path.join(workspaceRoot, ".agent-flow", "builder-auth", "jwks.json");
  const publicJwk = publicKey.export({ format: "jwk" });
  await mkdir(path.dirname(jwksPath), { recursive: true });
  await writeFile(
    jwksPath,
    JSON.stringify({
      keys: [
        {
          ...publicJwk,
          kid: "jwks-key-1",
          alg: "RS256",
          use: "sig",
        },
      ],
    }, null, 2),
    "utf-8",
  );
  process.env.AGENT_FLOW_BUILDER_AUTH_REQUIRED = "true";
  delete process.env.AGENT_FLOW_BUILDER_API_KEY;
  delete process.env.AGENT_FLOW_BUILDER_API_KEYS;
  delete process.env.AGENT_FLOW_BUILDER_API_KEYS_PATH;
  delete process.env.AGENT_FLOW_BUILDER_AUTH_JWT_SECRET;
  delete process.env.AGENT_FLOW_BUILDER_AUTH_JWT_PUBLIC_KEY;
  delete process.env.AGENT_FLOW_BUILDER_AUTH_JWT_JWKS_URL;
  process.env.AGENT_FLOW_BUILDER_AUTH_JWT_JWKS_PATH = jwksPath;
  process.env.AGENT_FLOW_BUILDER_AUTH_JWT_ALGORITHMS = "RS256";
  process.env.AGENT_FLOW_BUILDER_AUTH_JWT_ISSUER = "https://issuer.local";
  process.env.AGENT_FLOW_BUILDER_AUTH_JWT_AUDIENCE = "agent-flow-builder";
  t.after(() => {
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_REQUIRED", previousRequired);
    restoreEnv("AGENT_FLOW_BUILDER_API_KEY", previousApiKey);
    restoreEnv("AGENT_FLOW_BUILDER_API_KEYS", previousKeys);
    restoreEnv("AGENT_FLOW_BUILDER_API_KEYS_PATH", previousKeysPath);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_SECRET", previousJwtSecret);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_PUBLIC_KEY", previousJwtPublicKey);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_JWKS_PATH", previousJwtJwksPath);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_JWKS_URL", previousJwtJwksUrl);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_ALGORITHMS", previousJwtAlgorithms);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_ISSUER", previousJwtIssuer);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_AUDIENCE", previousJwtAudience);
    return rm(workspaceRoot, { recursive: true, force: true });
  });

  const app = buildApp({ workspaceRoot });
  const token = signBuilderJwtRs256(
    {
      sub: "jwks-operator",
      name: "JWKS Operator",
      role: "operator",
      areas: ["runtime_delivery"],
      scopes: ["runtime:read", "runtime:write"],
      iss: "https://issuer.local",
      aud: "agent-flow-builder",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    privateKey,
    { kid: "jwks-key-1" },
  );

  const status = await app.inject({ method: "GET", url: "/builder-auth/status" });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().jwt.configured, true);
  assert.deepEqual(status.json().jwt.algorithms, ["RS256"]);
  assert.equal(status.json().jwt.jwks.configured, true);
  assert.equal(status.json().jwt.jwks.pathConfigured, true);
  assert.equal(status.json().jwt.jwks.urlConfigured, false);
  assert.equal(status.json().jwt.jwks.keyCount, 1);
  assert.equal(status.json().jwt.jwks.storesPublicKeysOnly, true);
  assert.equal(JSON.stringify(status.json()).includes(String(publicJwk.n)), false);

  const authenticatedList = await app.inject({
    method: "GET",
    url: "/flows",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(authenticatedList.statusCode, 200);

  const schemaWriteDenied = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/schema-pattern-library",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: schemaPatternLibraryPackage([schemaPatternItem("jwks-contact-card")]),
  });
  assert.equal(schemaWriteDenied.statusCode, 403);
  assert.equal(schemaWriteDenied.json().details.decision.actorId, "jwks-operator");
  assert.equal(schemaWriteDenied.json().details.decision.area, "schemas");

  const unknownKidToken = signBuilderJwtRs256(
    {
      sub: "jwks-operator",
      role: "operator",
      areas: ["runtime_delivery"],
      iss: "https://issuer.local",
      aud: "agent-flow-builder",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    privateKey,
    { kid: "unknown-key" },
  );
  const unknownKid = await app.inject({
    method: "GET",
    url: "/flows",
    headers: { authorization: `Bearer ${unknownKidToken}` },
  });
  assert.equal(unknownKid.statusCode, 403);
  assert.match(unknownKid.json().details.auth.reason, /Assinatura/);
});

test("Builder API discovers JWKS from OIDC issuer metadata", async (t) => {
  const workspaceRoot = await createWorkspaceWithReferenceFlow("agent-builder-api-builder-oidc-auth-");
  const previousRequired = process.env.AGENT_FLOW_BUILDER_AUTH_REQUIRED;
  const previousApiKey = process.env.AGENT_FLOW_BUILDER_API_KEY;
  const previousKeys = process.env.AGENT_FLOW_BUILDER_API_KEYS;
  const previousKeysPath = process.env.AGENT_FLOW_BUILDER_API_KEYS_PATH;
  const previousJwtSecret = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_SECRET;
  const previousJwtPublicKey = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_PUBLIC_KEY;
  const previousJwtJwksPath = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_JWKS_PATH;
  const previousJwtJwksUrl = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_JWKS_URL;
  const previousOidcIssuer = process.env.AGENT_FLOW_BUILDER_AUTH_OIDC_ISSUER_URL;
  const previousOidcDiscovery = process.env.AGENT_FLOW_BUILDER_AUTH_OIDC_DISCOVERY_URL;
  const previousJwtAlgorithms = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_ALGORITHMS;
  const previousJwtIssuer = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_ISSUER;
  const previousJwtAudience = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_AUDIENCE;
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = publicKey.export({ format: "jwk" });
  const oidcServer = await startBuilderAuthOidcServer({
    jwk: {
      ...publicJwk,
      kid: "oidc-key-1",
      alg: "RS256",
      use: "sig",
    },
  });
  process.env.AGENT_FLOW_BUILDER_AUTH_REQUIRED = "true";
  delete process.env.AGENT_FLOW_BUILDER_API_KEY;
  delete process.env.AGENT_FLOW_BUILDER_API_KEYS;
  delete process.env.AGENT_FLOW_BUILDER_API_KEYS_PATH;
  delete process.env.AGENT_FLOW_BUILDER_AUTH_JWT_SECRET;
  delete process.env.AGENT_FLOW_BUILDER_AUTH_JWT_PUBLIC_KEY;
  delete process.env.AGENT_FLOW_BUILDER_AUTH_JWT_JWKS_PATH;
  delete process.env.AGENT_FLOW_BUILDER_AUTH_JWT_JWKS_URL;
  delete process.env.AGENT_FLOW_BUILDER_AUTH_JWT_ISSUER;
  delete process.env.AGENT_FLOW_BUILDER_AUTH_OIDC_DISCOVERY_URL;
  process.env.AGENT_FLOW_BUILDER_AUTH_OIDC_ISSUER_URL = oidcServer.issuer;
  process.env.AGENT_FLOW_BUILDER_AUTH_JWT_ALGORITHMS = "RS256";
  process.env.AGENT_FLOW_BUILDER_AUTH_JWT_AUDIENCE = "agent-flow-builder";
  t.after(async () => {
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_REQUIRED", previousRequired);
    restoreEnv("AGENT_FLOW_BUILDER_API_KEY", previousApiKey);
    restoreEnv("AGENT_FLOW_BUILDER_API_KEYS", previousKeys);
    restoreEnv("AGENT_FLOW_BUILDER_API_KEYS_PATH", previousKeysPath);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_SECRET", previousJwtSecret);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_PUBLIC_KEY", previousJwtPublicKey);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_JWKS_PATH", previousJwtJwksPath);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_JWKS_URL", previousJwtJwksUrl);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_OIDC_ISSUER_URL", previousOidcIssuer);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_OIDC_DISCOVERY_URL", previousOidcDiscovery);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_ALGORITHMS", previousJwtAlgorithms);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_ISSUER", previousJwtIssuer);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_AUDIENCE", previousJwtAudience);
    await oidcServer.close();
    return rm(workspaceRoot, { recursive: true, force: true });
  });

  const app = buildApp({ workspaceRoot });
  const token = signBuilderJwtRs256(
    {
      sub: "oidc-owner",
      name: "OIDC Owner",
      role: "owner",
      areas: ["*"],
      scope: "workspace:read workspace:write runtime:write",
      iss: oidcServer.issuer,
      aud: "agent-flow-builder",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    privateKey,
    { kid: "oidc-key-1" },
  );

  const status = await app.inject({ method: "GET", url: "/builder-auth/status" });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().jwt.configured, true);
  assert.deepEqual(status.json().jwt.algorithms, ["RS256"]);
  assert.equal(status.json().jwt.oidc.configured, true);
  assert.equal(status.json().jwt.oidc.issuerConfigured, true);
  assert.equal(status.json().jwt.oidc.discoveryUrlConfigured, false);
  assert.equal(status.json().jwt.oidc.discoveredJwks, true);
  assert.equal(status.json().jwt.jwks.configured, true);
  assert.equal(status.json().jwt.jwks.urlConfigured, false);
  assert.equal(status.json().jwt.jwks.keyCount, 1);
  assert.equal(JSON.stringify(status.json()).includes(String(publicJwk.n)), false);

  const authenticatedList = await app.inject({
    method: "GET",
    url: "/flows",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(authenticatedList.statusCode, 200);

  const badIssuerToken = signBuilderJwtRs256(
    {
      sub: "oidc-owner",
      role: "owner",
      areas: ["*"],
      iss: "https://wrong-issuer.local",
      aud: "agent-flow-builder",
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    privateKey,
    { kid: "oidc-key-1" },
  );
  const badIssuer = await app.inject({
    method: "GET",
    url: "/flows",
    headers: { authorization: `Bearer ${badIssuerToken}` },
  });
  assert.equal(badIssuer.statusCode, 403);
  assert.match(badIssuer.json().details.auth.reason, /Issuer/);

  assert.equal(oidcServer.discoveryHits >= 1, true);
  assert.equal(oidcServer.jwksHits >= 1, true);
});

test("Builder API completes OIDC authorization code login into a local Builder session", async (t) => {
  const workspaceRoot = await createWorkspaceWithReferenceFlow("agent-builder-api-builder-oidc-login-");
  const previousRequired = process.env.AGENT_FLOW_BUILDER_AUTH_REQUIRED;
  const previousApiKey = process.env.AGENT_FLOW_BUILDER_API_KEY;
  const previousKeys = process.env.AGENT_FLOW_BUILDER_API_KEYS;
  const previousKeysPath = process.env.AGENT_FLOW_BUILDER_API_KEYS_PATH;
  const previousJwtSecret = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_SECRET;
  const previousJwtPublicKey = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_PUBLIC_KEY;
  const previousJwtJwksPath = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_JWKS_PATH;
  const previousJwtJwksUrl = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_JWKS_URL;
  const previousOidcIssuer = process.env.AGENT_FLOW_BUILDER_AUTH_OIDC_ISSUER_URL;
  const previousOidcDiscovery = process.env.AGENT_FLOW_BUILDER_AUTH_OIDC_DISCOVERY_URL;
  const previousOidcClientId = process.env.AGENT_FLOW_BUILDER_AUTH_OIDC_CLIENT_ID;
  const previousOidcClientSecret = process.env.AGENT_FLOW_BUILDER_AUTH_OIDC_CLIENT_SECRET;
  const previousOidcRedirectUri = process.env.AGENT_FLOW_BUILDER_AUTH_OIDC_REDIRECT_URI;
  const previousOidcEndSessionEndpoint = process.env.AGENT_FLOW_BUILDER_AUTH_OIDC_END_SESSION_ENDPOINT;
  const previousOidcPostLogoutRedirectUri = process.env.AGENT_FLOW_BUILDER_AUTH_OIDC_POST_LOGOUT_REDIRECT_URI;
  const previousOidcScopes = process.env.AGENT_FLOW_BUILDER_AUTH_OIDC_SCOPES;
  const previousOidcFlowTtl = process.env.AGENT_FLOW_BUILDER_AUTH_OIDC_FLOW_TTL_SECONDS;
  const previousJwtAlgorithms = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_ALGORITHMS;
  const previousJwtIssuer = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_ISSUER;
  const previousJwtAudience = process.env.AGENT_FLOW_BUILDER_AUTH_JWT_AUDIENCE;
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = publicKey.export({ format: "jwk" });
  const oidcServer = await startBuilderAuthOidcServer({
    privateKey,
    jwk: {
      ...publicJwk,
      kid: "oidc-login-key-1",
      alg: "RS256",
      use: "sig",
    },
  });
  process.env.AGENT_FLOW_BUILDER_AUTH_REQUIRED = "true";
  delete process.env.AGENT_FLOW_BUILDER_API_KEY;
  delete process.env.AGENT_FLOW_BUILDER_API_KEYS;
  delete process.env.AGENT_FLOW_BUILDER_API_KEYS_PATH;
  delete process.env.AGENT_FLOW_BUILDER_AUTH_JWT_SECRET;
  delete process.env.AGENT_FLOW_BUILDER_AUTH_JWT_PUBLIC_KEY;
  delete process.env.AGENT_FLOW_BUILDER_AUTH_JWT_JWKS_PATH;
  delete process.env.AGENT_FLOW_BUILDER_AUTH_JWT_JWKS_URL;
  delete process.env.AGENT_FLOW_BUILDER_AUTH_JWT_ISSUER;
  delete process.env.AGENT_FLOW_BUILDER_AUTH_JWT_AUDIENCE;
  delete process.env.AGENT_FLOW_BUILDER_AUTH_OIDC_DISCOVERY_URL;
  delete process.env.AGENT_FLOW_BUILDER_AUTH_OIDC_CLIENT_SECRET;
  delete process.env.AGENT_FLOW_BUILDER_AUTH_OIDC_END_SESSION_ENDPOINT;
  process.env.AGENT_FLOW_BUILDER_AUTH_OIDC_ISSUER_URL = oidcServer.issuer;
  process.env.AGENT_FLOW_BUILDER_AUTH_OIDC_CLIENT_ID = "agent-flow-builder-client";
  process.env.AGENT_FLOW_BUILDER_AUTH_OIDC_REDIRECT_URI = "http://127.0.0.1:3333/builder-auth/oidc/callback";
  process.env.AGENT_FLOW_BUILDER_AUTH_OIDC_POST_LOGOUT_REDIRECT_URI = "http://127.0.0.1:3333/builder-auth/oidc/logout-callback";
  process.env.AGENT_FLOW_BUILDER_AUTH_OIDC_SCOPES = "openid profile email workspace";
  process.env.AGENT_FLOW_BUILDER_AUTH_OIDC_FLOW_TTL_SECONDS = "300";
  process.env.AGENT_FLOW_BUILDER_AUTH_JWT_ALGORITHMS = "RS256";
  t.after(async () => {
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_REQUIRED", previousRequired);
    restoreEnv("AGENT_FLOW_BUILDER_API_KEY", previousApiKey);
    restoreEnv("AGENT_FLOW_BUILDER_API_KEYS", previousKeys);
    restoreEnv("AGENT_FLOW_BUILDER_API_KEYS_PATH", previousKeysPath);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_SECRET", previousJwtSecret);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_PUBLIC_KEY", previousJwtPublicKey);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_JWKS_PATH", previousJwtJwksPath);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_JWKS_URL", previousJwtJwksUrl);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_OIDC_ISSUER_URL", previousOidcIssuer);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_OIDC_DISCOVERY_URL", previousOidcDiscovery);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_OIDC_CLIENT_ID", previousOidcClientId);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_OIDC_CLIENT_SECRET", previousOidcClientSecret);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_OIDC_REDIRECT_URI", previousOidcRedirectUri);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_OIDC_END_SESSION_ENDPOINT", previousOidcEndSessionEndpoint);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_OIDC_POST_LOGOUT_REDIRECT_URI", previousOidcPostLogoutRedirectUri);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_OIDC_SCOPES", previousOidcScopes);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_OIDC_FLOW_TTL_SECONDS", previousOidcFlowTtl);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_ALGORITHMS", previousJwtAlgorithms);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_ISSUER", previousJwtIssuer);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_JWT_AUDIENCE", previousJwtAudience);
    await oidcServer.close();
    return rm(workspaceRoot, { recursive: true, force: true });
  });

  const app = buildApp({ workspaceRoot });

  const status = await app.inject({ method: "GET", url: "/builder-auth/status" });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().jwt.oidc.loginConfigured, true);
  assert.equal(status.json().jwt.oidc.logoutConfigured, true);
  assert.equal(status.json().jwt.oidc.authorizationEndpointConfigured, true);
  assert.equal(status.json().jwt.oidc.tokenEndpointConfigured, true);
  assert.equal(status.json().jwt.oidc.endSessionEndpointConfigured, true);
  assert.equal(status.json().jwt.oidc.redirectUriConfigured, true);
  assert.equal(status.json().jwt.oidc.postLogoutRedirectUriConfigured, true);
  assert.equal(status.json().jwt.oidc.logoutCallbackSupported, true);
  assert.equal(status.json().jwt.oidc.sessionIdTokenHintSupported, true);
  assert.equal(status.json().jwt.audienceConfigured, true);

  const login = await app.inject({ method: "POST", url: "/builder-auth/oidc/login-url" });
  assert.equal(login.statusCode, 200);
  assert.equal(login.json().format, "agent-flow-builder.builder-auth-oidc-login.v1");
  assert.equal(login.json().governance.usesPkce, true);
  assert.equal(login.json().governance.storesProviderTokens, false);
  const authorizationUrl = new URL(login.json().authorizationUrl);
  assert.equal(authorizationUrl.origin, oidcServer.issuer);
  assert.equal(authorizationUrl.pathname, "/authorize");
  assert.equal(authorizationUrl.searchParams.get("client_id"), "agent-flow-builder-client");
  assert.equal(authorizationUrl.searchParams.get("redirect_uri"), "http://127.0.0.1:3333/builder-auth/oidc/callback");
  assert.equal(authorizationUrl.searchParams.get("scope"), "openid profile email workspace");
  assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authorizationUrl.searchParams.get("code_challenge"));
  const state = authorizationUrl.searchParams.get("state");
  const nonce = authorizationUrl.searchParams.get("nonce");
  assert.ok(state);
  assert.ok(nonce);
  oidcServer.setNextNonce(nonce);

  const logout = await app.inject({ method: "POST", url: "/builder-auth/oidc/logout-url" });
  assert.equal(logout.statusCode, 200);
  assert.equal(logout.json().format, "agent-flow-builder.builder-auth-oidc-logout.v1");
  assert.equal(typeof logout.json().expiresAt, "string");
  assert.equal(logout.json().governance.storesProviderTokens, false);
  assert.equal(logout.json().governance.sendsIdTokenHint, false);
  assert.equal(logout.json().governance.validatesCallbackState, true);
  assert.equal(logout.json().governance.returnsIdTokenHintInLogoutUrl, false);
  assert.equal(JSON.stringify(logout.json()).includes("id_token"), false);
  const logoutUrl = new URL(logout.json().logoutUrl);
  assert.equal(logoutUrl.origin, oidcServer.issuer);
  assert.equal(logoutUrl.pathname, "/logout");
  assert.equal(logoutUrl.searchParams.get("client_id"), "agent-flow-builder-client");
  assert.equal(logoutUrl.searchParams.get("post_logout_redirect_uri"), "http://127.0.0.1:3333/builder-auth/oidc/logout-callback");
  assert.ok(logoutUrl.searchParams.get("state"));

  const callback = await app.inject({
    method: "GET",
    url: `/builder-auth/oidc/callback?state=${encodeURIComponent(state)}&code=valid-code`,
    headers: { accept: "application/json" },
  });
  assert.equal(callback.statusCode, 200);
  assert.equal(callback.json().format, "agent-flow-builder.builder-auth-oidc-callback.v1");
  assert.match(callback.json().session.token, /^afbs_/);
  assert.equal(callback.json().identity.actorId, "oidc-login-owner");
  assert.equal(callback.json().identity.role, "owner");
  assert.deepEqual(callback.json().identity.groups, ["engineering", "owners"]);
  assert.equal(callback.json().governance.validatesState, true);
  assert.equal(callback.json().governance.validatesNonce, true);
  assert.equal(callback.json().governance.storesProviderTokens, "id_token_hint_and_refresh_token_session_memory_only");
  assert.equal(callback.json().governance.storesProviderLogoutHint, true);
  assert.equal(callback.json().governance.storesProviderRefreshToken, true);
  assert.equal(callback.json().governance.returnsProviderTokens, false);
  assert.equal(callback.json().session.governance.storesProviderRefreshToken, true);
  assert.equal(JSON.stringify(callback.json()).includes("valid-code"), false);
  assert.equal(JSON.stringify(callback.json()).includes(oidcServer.lastIdToken), false);
  assert.equal(JSON.stringify(callback.json()).includes(oidcServer.lastRefreshToken), false);
  assert.equal(oidcServer.tokenHits, 1);
  assert.equal(oidcServer.lastTokenBody.get("grant_type"), "authorization_code");
  assert.equal(oidcServer.lastTokenBody.get("code"), "valid-code");
  assert.equal(oidcServer.lastTokenBody.get("client_id"), "agent-flow-builder-client");
  assert.equal(oidcServer.lastTokenBody.get("redirect_uri"), "http://127.0.0.1:3333/builder-auth/oidc/callback");
  assert.ok(oidcServer.lastTokenBody.get("code_verifier"));

  const sessionList = await app.inject({
    method: "GET",
    url: "/flows",
    headers: { authorization: `Bearer ${callback.json().session.token}` },
  });
  assert.equal(sessionList.statusCode, 200);

  const refreshedOidcSession = await app.inject({
    method: "POST",
    url: "/builder-auth/oidc/session/refresh",
    headers: { authorization: `Bearer ${callback.json().session.token}` },
  });
  assert.equal(refreshedOidcSession.statusCode, 200);
  assert.equal(refreshedOidcSession.json().format, "agent-flow-builder.builder-auth-session.v1");
  assert.match(refreshedOidcSession.json().token, /^afbs_/);
  assert.notEqual(refreshedOidcSession.json().token, callback.json().session.token);
  assert.equal(refreshedOidcSession.json().identity.actorId, "oidc-login-owner");
  assert.equal(refreshedOidcSession.json().governance.storesProviderRefreshToken, true);
  assert.equal(JSON.stringify(refreshedOidcSession.json()).includes(oidcServer.lastRefreshToken), false);
  assert.equal(oidcServer.tokenHits, 2);
  assert.equal(oidcServer.lastTokenBody.get("grant_type"), "refresh_token");
  assert.equal(oidcServer.lastTokenBody.get("refresh_token"), "refresh-token-1");

  const oldSessionList = await app.inject({
    method: "GET",
    url: "/flows",
    headers: { authorization: `Bearer ${callback.json().session.token}` },
  });
  assert.equal(oldSessionList.statusCode, 403);

  const advancedLogout = await app.inject({
    method: "POST",
    url: "/builder-auth/oidc/logout-url",
    headers: { authorization: `Bearer ${refreshedOidcSession.json().token}` },
  });
  assert.equal(advancedLogout.statusCode, 200);
  assert.equal(advancedLogout.json().governance.storesProviderTokens, "id_token_hint_session_memory_only");
  assert.equal(advancedLogout.json().governance.sendsIdTokenHint, true);
  assert.equal(advancedLogout.json().governance.returnsProviderTokens, false);
  assert.equal(advancedLogout.json().governance.returnsIdTokenHintInLogoutUrl, true);
  const advancedLogoutUrl = new URL(advancedLogout.json().logoutUrl);
  assert.equal(advancedLogoutUrl.searchParams.get("post_logout_redirect_uri"), "http://127.0.0.1:3333/builder-auth/oidc/logout-callback");
  assert.equal(advancedLogoutUrl.searchParams.get("id_token_hint"), oidcServer.lastIdToken);
  const advancedLogoutState = advancedLogoutUrl.searchParams.get("state");
  assert.ok(advancedLogoutState);
  const logoutCallback = await app.inject({
    method: "GET",
    url: `/builder-auth/oidc/logout-callback?state=${encodeURIComponent(advancedLogoutState)}`,
    headers: { accept: "application/json" },
  });
  assert.equal(logoutCallback.statusCode, 200);
  assert.equal(logoutCallback.json().format, "agent-flow-builder.builder-auth-oidc-logout-callback.v1");
  assert.equal(logoutCallback.json().identity.actorId, "oidc-login-owner");
  assert.equal(logoutCallback.json().governance.validatesState, true);
  assert.equal(logoutCallback.json().governance.returnsProviderTokens, false);
  assert.equal(JSON.stringify(logoutCallback.json()).includes("id_token"), false);

  const logoutReplay = await app.inject({
    method: "GET",
    url: `/builder-auth/oidc/logout-callback?state=${encodeURIComponent(advancedLogoutState)}`,
    headers: { accept: "application/json" },
  });
  assert.equal(logoutReplay.statusCode, 403);

  const badLogoutState = await app.inject({
    method: "GET",
    url: "/builder-auth/oidc/logout-callback?state=wrong-state",
    headers: { accept: "application/json" },
  });
  assert.equal(badLogoutState.statusCode, 403);

  const replay = await app.inject({
    method: "GET",
    url: `/builder-auth/oidc/callback?state=${encodeURIComponent(state)}&code=valid-code`,
    headers: { accept: "application/json" },
  });
  assert.equal(replay.statusCode, 403);

  const badState = await app.inject({
    method: "GET",
    url: "/builder-auth/oidc/callback?state=wrong-state&code=valid-code",
    headers: { accept: "application/json" },
  });
  assert.equal(badState.statusCode, 403);
});

test("Builder API enforces Safety Harness review permissions for authenticated local actors", async (t) => {
  const workspaceRoot = await createWorkspaceWithReferenceFlow("agent-builder-api-safety-review-auth-");
  const previousRequired = process.env.AGENT_FLOW_BUILDER_AUTH_REQUIRED;
  const previousKeys = process.env.AGENT_FLOW_BUILDER_API_KEYS;
  const previousKeysPath = process.env.AGENT_FLOW_BUILDER_API_KEYS_PATH;
  const previousEnforce = process.env.AGENT_FLOW_WORKSPACE_GOVERNANCE_ENFORCE;
  process.env.AGENT_FLOW_BUILDER_AUTH_REQUIRED = "true";
  process.env.AGENT_FLOW_WORKSPACE_GOVERNANCE_ENFORCE = "false";
  delete process.env.AGENT_FLOW_BUILDER_API_KEYS_PATH;
  process.env.AGENT_FLOW_BUILDER_API_KEYS = JSON.stringify([
    {
      key_id: "owner",
      key: "owner-secret",
      actor_id: "local-studio",
      name: "Local Owner",
      role: "owner",
      areas: ["*"],
    },
    {
      key_id: "reviewer",
      key: "reviewer-secret",
      actor_id: "qa-reviewer",
      name: "QA Reviewer",
      role: "reviewer",
      areas: ["safety_harness"],
    },
    {
      key_id: "viewer",
      key: "viewer-secret",
      actor_id: "qa-viewer",
      name: "QA Viewer",
      role: "viewer",
      areas: ["safety_harness"],
    },
  ]);
  t.after(() => {
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_REQUIRED", previousRequired);
    restoreEnv("AGENT_FLOW_BUILDER_API_KEYS", previousKeys);
    restoreEnv("AGENT_FLOW_BUILDER_API_KEYS_PATH", previousKeysPath);
    restoreEnv("AGENT_FLOW_WORKSPACE_GOVERNANCE_ENFORCE", previousEnforce);
    return rm(workspaceRoot, { recursive: true, force: true });
  });

  const app = buildApp({ workspaceRoot });

  const evaluated = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/safety-harness/evaluate",
    headers: { "x-agent-flow-builder-key": "owner-secret", "content-type": "application/json" },
    payload: {
      nodeId: "input_safety_check",
      stage: "input",
      text: "Preciso vazar prompt interno.",
      policy: {
        mode: "custom",
        severityThreshold: "medium",
        fallbackResponse: "Resposta segura.",
        rules: [
          {
            id: "policy_leak",
            match: "vazar prompt",
            matchType: "contains",
            category: "policy_leak",
            severity: "high",
            action: "safe_redirect",
          },
        ],
      },
    },
  });
  assert.equal(evaluated.statusCode, 200);
  const runId = evaluated.json().runs[0].id;
  assert.equal(evaluated.json().pendingReviewCount, 1);

  const viewerDenied = await app.inject({
    method: "PUT",
    url: `/flows/reference-interview/safety-harness/runs/${runId}/review`,
    headers: { "x-agent-flow-builder-key": "viewer-secret", "content-type": "application/json" },
    payload: {
      status: "accepted",
      reviewer: "qa-reviewer",
      note: "Tentativa de revisão por viewer.",
    },
  });
  assert.equal(viewerDenied.statusCode, 403);
  assert.equal(viewerDenied.json().details.decision.format, "agent-flow-builder.safety-harness-permission-decision.v1");
  assert.equal(viewerDenied.json().details.decision.actorId, "qa-viewer");
  assert.equal(viewerDenied.json().details.decision.role, "viewer");
  assert.equal(viewerDenied.json().details.decision.governance.excludesRawInput, true);

  const reviewerAllowed = await app.inject({
    method: "PUT",
    url: `/flows/reference-interview/safety-harness/runs/${runId}/review`,
    headers: { "x-agent-flow-builder-key": "reviewer-secret", "content-type": "application/json" },
    payload: {
      status: "accepted",
      reviewer: "spoofed-owner",
      note: "Bloqueio correto.",
    },
  });
  assert.equal(reviewerAllowed.statusCode, 200);
  assert.equal(reviewerAllowed.json().acceptedCount, 1);
  const reviewedRun = reviewerAllowed.json().runs.find((run) => run.id === runId);
  assert.equal(reviewedRun.review.reviewer, "qa-reviewer");
  assert.equal(reviewedRun.review.note, "Bloqueio correto.");
});

test("Builder API enforces schema pattern permissions for authenticated local actors", async (t) => {
  const workspaceRoot = await createWorkspaceWithReferenceFlow("agent-builder-api-schema-pattern-auth-");
  const previousRequired = process.env.AGENT_FLOW_BUILDER_AUTH_REQUIRED;
  const previousKeys = process.env.AGENT_FLOW_BUILDER_API_KEYS;
  const previousKeysPath = process.env.AGENT_FLOW_BUILDER_API_KEYS_PATH;
  const previousEnforce = process.env.AGENT_FLOW_WORKSPACE_GOVERNANCE_ENFORCE;
  process.env.AGENT_FLOW_BUILDER_AUTH_REQUIRED = "true";
  process.env.AGENT_FLOW_WORKSPACE_GOVERNANCE_ENFORCE = "false";
  delete process.env.AGENT_FLOW_BUILDER_API_KEYS_PATH;
  process.env.AGENT_FLOW_BUILDER_API_KEYS = JSON.stringify([
    {
      key_id: "reviewer",
      key: "reviewer-secret",
      actor_id: "schema-reviewer",
      name: "Schema Reviewer",
      role: "reviewer",
      areas: ["schemas"],
    },
    {
      key_id: "wrong-area",
      key: "wrong-area-secret",
      actor_id: "runtime-reviewer",
      name: "Runtime Reviewer",
      role: "reviewer",
      areas: ["runtime_delivery"],
    },
    {
      key_id: "viewer",
      key: "viewer-secret",
      actor_id: "schema-viewer",
      name: "Schema Viewer",
      role: "viewer",
      areas: ["schemas"],
    },
  ]);
  t.after(() => {
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_REQUIRED", previousRequired);
    restoreEnv("AGENT_FLOW_BUILDER_API_KEYS", previousKeys);
    restoreEnv("AGENT_FLOW_BUILDER_API_KEYS_PATH", previousKeysPath);
    restoreEnv("AGENT_FLOW_WORKSPACE_GOVERNANCE_ENFORCE", previousEnforce);
    return rm(workspaceRoot, { recursive: true, force: true });
  });

  const app = buildApp({ workspaceRoot });
  const payload = schemaPatternLibraryPackage([schemaPatternItem("contact-card")]);

  const viewerDenied = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/schema-pattern-library",
    headers: { "x-agent-flow-builder-key": "viewer-secret", "content-type": "application/json" },
    payload,
  });
  assert.equal(viewerDenied.statusCode, 403);
  assert.equal(viewerDenied.json().details.decision.format, "agent-flow-builder.builder-auth-area-decision.v1");
  assert.equal(viewerDenied.json().details.decision.actorId, "schema-viewer");
  assert.equal(viewerDenied.json().details.decision.role, "viewer");
  assert.equal(viewerDenied.json().details.decision.area, "schemas");
  assert.equal(viewerDenied.json().details.decision.requiredRole, "reviewer");
  assert.equal(viewerDenied.json().details.decision.governance.excludesRawPayload, true);

  const wrongAreaDenied = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/schema-pattern-library",
    headers: { "x-agent-flow-builder-key": "wrong-area-secret", "content-type": "application/json" },
    payload,
  });
  assert.equal(wrongAreaDenied.statusCode, 403);
  assert.match(wrongAreaDenied.json().details.decision.reasons.join(" "), /schemas/);

  const reviewerAllowed = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/schema-pattern-library",
    headers: { "x-agent-flow-builder-key": "reviewer-secret", "content-type": "application/json" },
    payload,
  });
  assert.equal(reviewerAllowed.statusCode, 200);
  assert.equal(reviewerAllowed.json().format, "agent-flow-builder.schema-pattern-library.v1");
  assert.equal(reviewerAllowed.json().itemCount, 1);
  assert.equal(reviewerAllowed.json().items[0].id, "contact-card");

  const mergeAllowed = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/schema-pattern-library/merge",
    headers: { "x-agent-flow-builder-key": "reviewer-secret", "content-type": "application/json" },
    payload: schemaPatternLibraryPackage([schemaPatternItem("contact-card-v2")]),
  });
  assert.equal(mergeAllowed.statusCode, 200);
  assert.equal(mergeAllowed.json().itemCount, 2);
});

test("Builder API probes external Builder auth integrations without leaking endpoints or tokens", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-builder-api-builder-auth-probe-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const probeServer = await startBuilderAuthExternalProbeServer({
    actors: [{ actorId: "corp-reviewer", groups: ["reviewers"] }],
    groups: [{ group: "reviewers", members: ["corp-reviewer"] }],
  });
  t.after(() => probeServer.close());

  const previousSessionServiceUrl = process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_URL;
  const previousSessionServiceToken = process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_TOKEN;
  const previousSessionServiceTimeout = process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_TIMEOUT_MS;
  const previousSessionIntrospectionUrl = process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_URL;
  const previousSessionIntrospectionToken = process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_TOKEN;
  const previousSessionIntrospectionTimeout = process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_TIMEOUT_MS;
  const previousAuditSinkUrl = process.env.AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_URL;
  const previousAuditSinkToken = process.env.AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_TOKEN;
  const previousAuditSinkTimeout = process.env.AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_TIMEOUT_MS;
  const previousGroupDirectoryUrl = process.env.AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_URL;
  const previousGroupDirectoryToken = process.env.AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_TOKEN;
  const previousGroupDirectoryTimeout = process.env.AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_TIMEOUT_MS;
  t.after(() => {
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_URL", previousSessionServiceUrl);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_TOKEN", previousSessionServiceToken);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_TIMEOUT_MS", previousSessionServiceTimeout);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_URL", previousSessionIntrospectionUrl);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_TOKEN", previousSessionIntrospectionToken);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_TIMEOUT_MS", previousSessionIntrospectionTimeout);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_URL", previousAuditSinkUrl);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_TOKEN", previousAuditSinkToken);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_TIMEOUT_MS", previousAuditSinkTimeout);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_URL", previousGroupDirectoryUrl);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_TOKEN", previousGroupDirectoryToken);
    restoreEnv("AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_TIMEOUT_MS", previousGroupDirectoryTimeout);
  });

  process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_URL = probeServer.url("/sessions");
  process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_TOKEN = "builder-session-probe-secret";
  process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_TIMEOUT_MS = "1000";
  process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_URL = probeServer.url("/introspect");
  process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_TOKEN = "builder-introspection-probe-secret";
  process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_TIMEOUT_MS = "1000";
  process.env.AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_URL = probeServer.url("/audit");
  process.env.AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_TOKEN = "builder-audit-probe-secret";
  process.env.AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_TIMEOUT_MS = "1000";
  process.env.AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_URL = probeServer.url("/groups");
  process.env.AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_TOKEN = "builder-directory-probe-secret";
  process.env.AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_TIMEOUT_MS = "1000";

  const app = buildApp({ workspaceRoot });
  const probe = await app.inject({ method: "POST", url: "/builder-auth/external-probe" });
  assert.equal(probe.statusCode, 200);
  const body = probe.json();
  assert.equal(body.format, "agent-flow-builder.builder-auth-external-probe.v1");
  assert.equal(body.configuredCount, 4);
  assert.equal(body.checkedCount, 4);
  assert.equal(body.okCount, 4);
  assert.equal(body.errorCount, 0);
  assert.equal(body.governance.excludesUrls, true);
  assert.equal(body.governance.excludesSecretValues, true);
  assert.equal(body.governance.authTokensInHeaderOnly, true);
  assert.equal(body.governance.authTokensInBody, false);
  assert.equal(JSON.stringify(body).includes("builder-session-probe-secret"), false);
  assert.equal(JSON.stringify(body).includes("builder-introspection-probe-secret"), false);
  assert.equal(JSON.stringify(body).includes("builder-audit-probe-secret"), false);
  assert.equal(JSON.stringify(body).includes("builder-directory-probe-secret"), false);
  assert.equal(JSON.stringify(body).includes(String(probeServer.port)), false);

  const groupDirectory = body.components.find((component) => component.id === "group_directory");
  assert.equal(groupDirectory.status, "ok");
  assert.equal(groupDirectory.actorCount, 1);
  assert.equal(groupDirectory.groupCount, 1);

  assert.equal(probeServer.authorizationFor("HEAD", "/sessions"), "Bearer builder-session-probe-secret");
  assert.equal(probeServer.authorizationFor("HEAD", "/introspect"), "Bearer builder-introspection-probe-secret");
  assert.equal(probeServer.authorizationFor("HEAD", "/audit"), "Bearer builder-audit-probe-secret");
  assert.equal(probeServer.authorizationFor("GET", "/groups"), "Bearer builder-directory-probe-secret");
  assert.equal(probeServer.bodyFor("HEAD", "/sessions"), "");
  assert.equal(probeServer.bodyFor("HEAD", "/introspect"), "");
  assert.equal(probeServer.bodyFor("HEAD", "/audit"), "");
  assert.equal(probeServer.bodyFor("GET", "/groups"), "");
});

async function startBuilderAuthExternalProbeServer(directory) {
  const hits = [];
  const server = createServer((request, response) => {
    let rawBody = "";
    request.setEncoding("utf-8");
    request.on("data", (chunk) => {
      rawBody += chunk;
    });
    request.on("end", () => {
      hits.push({
        method: request.method,
        url: request.url,
        authorization: String(request.headers.authorization ?? ""),
        body: rawBody,
      });
      if (request.method === "HEAD" && ["/sessions", "/introspect", "/audit"].includes(request.url)) {
        response.statusCode = 204;
        response.end();
        return;
      }
      if (request.method === "GET" && request.url === "/groups") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({
          format: "agent-flow-builder.builder-auth-group-directory.v1",
          actors: directory.actors ?? [],
          groups: directory.groups ?? [],
        }));
        return;
      }
      response.statusCode = 404;
      response.end("not found");
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.notEqual(typeof address, "string");
  return {
    port: address.port,
    url(pathname) {
      return `http://127.0.0.1:${address.port}${pathname}`;
    },
    authorizationFor(method, pathname) {
      const hit = hits.find((entry) => entry.method === method && entry.url === pathname);
      return hit?.authorization ?? "";
    },
    bodyFor(method, pathname) {
      const hit = hits.find((entry) => entry.method === method && entry.url === pathname);
      return hit?.body ?? "";
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function startBuilderAuthAuditSinkServer() {
  const events = [];
  const waiters = [];
  const server = createServer((request, response) => {
    let rawBody = "";
    request.setEncoding("utf-8");
    request.on("data", (chunk) => {
      rawBody += chunk;
    });
    request.on("end", () => {
      if (request.method !== "POST" || request.url !== "/audit") {
        response.statusCode = 404;
        response.end("not found");
        return;
      }
      let body = null;
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = { parseError: true };
      }
      const event = {
        headers: request.headers,
        body,
      };
      events.push(event);
      for (let index = waiters.length - 1; index >= 0; index -= 1) {
        const waiter = waiters[index];
        if (waiter.predicate(event)) {
          clearTimeout(waiter.timeout);
          waiters.splice(index, 1);
          waiter.resolve(event);
        }
      }
      response.statusCode = 204;
      response.end();
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.notEqual(typeof address, "string");
  return {
    url: `http://127.0.0.1:${address.port}/audit`,
    events,
    waitForEvent(predicate, timeoutMs = 3000) {
      const existing = events.find(predicate);
      if (existing) {
        return Promise.resolve(existing);
      }
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          const index = waiters.findIndex((waiter) => waiter.resolve === resolve);
          if (index >= 0) {
            waiters.splice(index, 1);
          }
          reject(new Error("Timed out waiting for Builder auth audit sink event."));
        }, timeoutMs);
        waiters.push({ predicate, resolve, timeout });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function startBuilderAuthSessionServiceServer() {
  const events = [];
  const waiters = [];
  const server = createServer((request, response) => {
    let rawBody = "";
    request.setEncoding("utf-8");
    request.on("data", (chunk) => {
      rawBody += chunk;
    });
    request.on("end", () => {
      if (request.method !== "POST" || request.url !== "/sessions") {
        response.statusCode = 404;
        response.end("not found");
        return;
      }
      let body = null;
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = { parseError: true };
      }
      const event = {
        headers: request.headers,
        body,
      };
      events.push(event);
      for (let index = waiters.length - 1; index >= 0; index -= 1) {
        const waiter = waiters[index];
        if (waiter.predicate(event)) {
          clearTimeout(waiter.timeout);
          waiters.splice(index, 1);
          waiter.resolve(event);
        }
      }
      response.statusCode = 204;
      response.end();
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.notEqual(typeof address, "string");
  return {
    url: `http://127.0.0.1:${address.port}/sessions`,
    events,
    waitForEvent(predicate, timeoutMs = 3000) {
      const existing = events.find(predicate);
      if (existing) {
        return Promise.resolve(existing);
      }
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          const index = waiters.findIndex((waiter) => waiter.resolve === resolve);
          if (index >= 0) {
            waiters.splice(index, 1);
          }
          reject(new Error("Timed out waiting for Builder auth session service event."));
        }, timeoutMs);
        waiters.push({ predicate, resolve, timeout });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function startBuilderAuthSessionIntrospectionServer() {
  const events = [];
  const waiters = [];
  const state = {
    decision: null,
  };
  const server = createServer((request, response) => {
    let rawBody = "";
    request.setEncoding("utf-8");
    request.on("data", (chunk) => {
      rawBody += chunk;
    });
    request.on("end", () => {
      if (request.method !== "POST" || request.url !== "/introspect") {
        response.statusCode = 404;
        response.end("not found");
        return;
      }
      let body = null;
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = { parseError: true };
      }
      const event = {
        headers: request.headers,
        body,
      };
      events.push(event);
      for (let index = waiters.length - 1; index >= 0; index -= 1) {
        const waiter = waiters[index];
        if (waiter.predicate(event)) {
          clearTimeout(waiter.timeout);
          waiters.splice(index, 1);
          waiter.resolve(event);
        }
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(state.decision ?? {
        allowed: true,
        identity: {
          keyId: "central-session",
          actorId: "central-owner",
          name: "Central Owner",
          role: "owner",
          groups: ["central-governance"],
          areas: ["*"],
          scopes: ["*"],
        },
      }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.notEqual(typeof address, "string");
  return {
    url: `http://127.0.0.1:${address.port}/introspect`,
    events,
    setDecision(decision) {
      state.decision = decision;
    },
    waitForEvent(predicate, timeoutMs = 3000) {
      const existing = events.find(predicate);
      if (existing) {
        return Promise.resolve(existing);
      }
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          const index = waiters.findIndex((waiter) => waiter.resolve === resolve);
          if (index >= 0) {
            waiters.splice(index, 1);
          }
          reject(new Error("Timed out waiting for Builder auth session introspection event."));
        }, timeoutMs);
        waiters.push({ predicate, resolve, timeout });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function startBuilderAuthGroupDirectoryServer(directory) {
  const state = {
    hits: 0,
    lastAuthorization: "",
  };
  const server = createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/groups") {
      response.statusCode = 404;
      response.end("not found");
      return;
    }
    state.hits += 1;
    state.lastAuthorization = String(request.headers.authorization ?? "");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      format: "agent-flow-builder.builder-auth-group-directory.v1",
      actors: directory.actors ?? [],
      groups: directory.groups ?? [],
    }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.notEqual(typeof address, "string");
  return {
    url: `http://127.0.0.1:${address.port}/groups`,
    get hits() {
      return state.hits;
    },
    get lastAuthorization() {
      return state.lastAuthorization;
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function startBuilderAuthOidcServer({ jwk, privateKey = null }) {
  const state = {
    discoveryHits: 0,
    jwksHits: 0,
    tokenHits: 0,
    lastTokenBody: new URLSearchParams(),
    lastIdToken: "",
    lastRefreshToken: "",
    nextNonce: "",
  };
  const server = createServer((request, response) => {
    const host = request.headers.host;
    const issuer = `http://${host}`;
    if (request.url === "/.well-known/openid-configuration") {
      state.discoveryHits += 1;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({
        issuer,
        jwks_uri: `${issuer}/jwks.json`,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        end_session_endpoint: `${issuer}/logout`,
      }));
      return;
    }
    if (request.url === "/jwks.json") {
      state.jwksHits += 1;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    if (request.url === "/token" && request.method === "POST") {
      state.tokenHits += 1;
      let rawBody = "";
      request.setEncoding("utf-8");
      request.on("data", (chunk) => {
        rawBody += chunk;
      });
      request.on("end", () => {
        state.lastTokenBody = new URLSearchParams(rawBody);
        if (!privateKey) {
          response.statusCode = 400;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ error: "invalid_request" }));
          return;
        }
        const grantType = state.lastTokenBody.get("grant_type");
        const clientId = state.lastTokenBody.get("client_id") || "agent-flow-builder-client";
        if (grantType === "refresh_token") {
          if (state.lastTokenBody.get("refresh_token") !== state.lastRefreshToken) {
            response.statusCode = 400;
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify({ error: "invalid_grant" }));
            return;
          }
          const refreshedIdToken = signBuilderJwtRs256(
            {
              sub: "oidc-login-owner",
              name: "OIDC Login Owner",
              role: "owner",
              groups: ["engineering", "owners"],
              areas: ["*"],
              scope: "workspace:read workspace:write runtime:write",
              iss: issuer,
              aud: clientId,
              exp: Math.floor(Date.now() / 1000) + 3600,
            },
            privateKey,
            { kid: jwk.kid || "oidc-key-1" },
          );
          state.lastIdToken = refreshedIdToken;
          state.lastRefreshToken = "refresh-token-2";
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({
            token_type: "Bearer",
            expires_in: 3600,
            id_token: refreshedIdToken,
            refresh_token: state.lastRefreshToken,
          }));
          return;
        }
        if (grantType !== "authorization_code" || !state.nextNonce) {
          response.statusCode = 400;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ error: "invalid_request" }));
          return;
        }
        const idToken = signBuilderJwtRs256(
          {
            sub: "oidc-login-owner",
            name: "OIDC Login Owner",
            role: "owner",
            groups: ["engineering", "owners"],
            areas: ["*"],
            scope: "workspace:read workspace:write runtime:write",
            iss: issuer,
            aud: clientId,
            nonce: state.nextNonce,
            exp: Math.floor(Date.now() / 1000) + 3600,
          },
          privateKey,
          { kid: jwk.kid || "oidc-key-1" },
        );
        state.lastIdToken = idToken;
        state.lastRefreshToken = "refresh-token-1";
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({
          token_type: "Bearer",
          expires_in: 3600,
          id_token: idToken,
          refresh_token: state.lastRefreshToken,
        }));
      });
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const issuer = `http://127.0.0.1:${address.port}`;
  return {
    issuer,
    get discoveryHits() {
      return state.discoveryHits;
    },
    get jwksHits() {
      return state.jwksHits;
    },
    get tokenHits() {
      return state.tokenHits;
    },
    get lastTokenBody() {
      return state.lastTokenBody;
    },
    get lastIdToken() {
      return state.lastIdToken;
    },
    get lastRefreshToken() {
      return state.lastRefreshToken;
    },
    setNextNonce: (nonce) => {
      state.nextNonce = nonce;
    },
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function signBuilderJwt(payload, secret, header = {}) {
  const jwtHeader = {
    alg: "HS256",
    typ: "JWT",
    ...header,
  };
  const encodedHeader = Buffer.from(JSON.stringify(jwtHeader)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

function signBuilderJwtRs256(payload, privateKey, header = {}) {
  const jwtHeader = {
    alg: "RS256",
    typ: "JWT",
    ...header,
  };
  const encodedHeader = Buffer.from(JSON.stringify(jwtHeader)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

function annotationItem(id, assignee) {
  const index = id.endsWith("b") ? "b" : "a";
  return {
    id,
    scenarioId: `scenario-${index}`,
    scenarioLabel: `Scenario ${index.toUpperCase()}`,
    sessionId: `session-${index}`,
    runId: `run-${index}`,
    resultStatus: "ok",
    comparisonSeverity: "warn",
    verdict: "Revisar resposta",
    reasons: ["baseline mudou"],
    observedOutput: `saida observada ${index}`,
    batchHash: `batch-${index}`,
    source: "batch-result",
    status: "pending",
    assignee,
    reviewedBy: "",
    reviewedAt: null,
    note: "",
    createdAt: "2026-07-02T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
  };
}

function schemaPatternLibraryPackage(items) {
  return {
    format: "agent-flow-builder.schema-pattern-library.v1",
    items,
  };
}

function schemaPatternItem(id) {
  return {
    id,
    name: `Pattern ${id}`,
    tags: ["governance"],
    curationStatus: "approved",
    reviewedAt: "2026-07-02T00:00:00.000Z",
    reviewedBy: "schema-reviewer",
    updatedAt: "2026-07-02T00:00:00.000Z",
    schema: {
      type: "object",
      properties: {
        value: { type: "string" },
      },
      required: ["value"],
    },
  };
}
