import { strict as assert } from "node:assert";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../apps/builder-api/src/server.ts";
import { saveWorkspaceGovernance } from "../apps/builder-api/src/workspace-governance.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const OWNER_KEY = "test-only-owner-key";
const SESSION_SERVICE_TOKEN = "test-only-session-service-token";
const INTROSPECTION_TOKEN = "test-only-introspection-token";
const AUDIT_SINK_TOKEN = "test-only-audit-sink-token";
const GROUP_DIRECTORY_TOKEN = "test-only-directory-token";

const ENV_KEYS = [
  "AGENT_FLOW_BUILDER_AUTH_REQUIRED",
  "AGENT_FLOW_WORKSPACE_GOVERNANCE_ENFORCE",
  "AGENT_FLOW_BUILDER_API_KEYS",
  "AGENT_FLOW_BUILDER_API_KEYS_PATH",
  "AGENT_FLOW_BUILDER_AUTH_AUDIT_PATH",
  "AGENT_FLOW_BUILDER_AUTH_SESSION_PATH",
  "AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_URL",
  "AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_TOKEN",
  "AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_TIMEOUT_MS",
  "AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_URL",
  "AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_TOKEN",
  "AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_TIMEOUT_MS",
  "AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_REQUIRED",
  "AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_URL",
  "AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_TOKEN",
  "AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_TIMEOUT_MS",
  "AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_URL",
  "AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_TOKEN",
  "AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_TIMEOUT_MS",
  "AGENT_FLOW_BUILDER_AUTH_GROUP_POLICIES",
] as const;

interface CapturedRequest {
  method: string;
  pathname: string;
  authorization: string;
  rawBody: string;
  body: unknown;
}

interface CorporateAuthFixture {
  port: number;
  url(pathname: string): string;
  setIntrospectionDecision(decision: unknown | null): void;
  waitForHit(predicate: (hit: CapturedRequest) => boolean, timeoutMs?: number, label?: string): Promise<CapturedRequest>;
  findHit(method: string, pathname: string): CapturedRequest | undefined;
  close(): Promise<void>;
}

async function main(): Promise<void> {
  const previousEnv = snapshotEnv();
  const workspaceRoot = await createWorkspaceFixture();
  const fixture = await startCorporateAuthFixture();

  configureCorporateAuthEnv(workspaceRoot, fixture);
  const app = buildApp({ workspaceRoot });

  try {
    await app.ready();
    const status = await requestJson(app, "GET", "/builder-auth/status");
    assert.equal(status.statusCode, 200);
    assert.equal(status.body.required, true);
    assert.equal(status.body.sessions.externalServiceConfigured, true);
    assert.equal(status.body.sessions.centralIntrospectionConfigured, true);
    assert.equal(status.body.sessions.centralIntrospectionRequired, true);
    assert.equal(status.body.sessions.centralIntrospectionSendsRawTokens, false);
    assert.equal(status.body.sessions.externalServiceSendsRawTokens, false);
    assert.equal(status.body.audit.externalSinkConfigured, true);
    assert.equal(status.body.audit.externalSinkTokenConfigured, true);
    assert.equal(status.body.groupDirectory.externalConfigured, true);
    assert.equal(status.body.groupDirectory.externalTokenConfigured, true);
    assertNoSensitiveValues(status.body, fixture);

    await verifyExternalProbe(app, fixture);
    await verifyCorporateHomologation(app, fixture, workspaceRoot);
    await verifySessionLifecycleAndCentralIntrospection(app, fixture, workspaceRoot);

    console.log(JSON.stringify({
      status: "ok",
      checked: [
        "builder-auth status sanitizado",
        "probe corporativo sem URL/token/body sensível",
        "homologação corporativa salva sem URL/token/path absoluto",
        "session service recebe somente token hash",
        "introspecção central fail-closed e sem token bruto",
        "audit sink sanitizado",
        "diretório corporativo de grupos via GET sem body",
        "persistência local hash-only",
      ],
      integrations: {
        sessionService: true,
        centralIntrospection: true,
        auditSink: true,
        groupDirectory: true,
      },
    }, null, 2));
  } finally {
    restoreEnv(previousEnv);
    await app.close();
    await fixture.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function verifyExternalProbe(app: ReturnType<typeof buildApp>, fixture: CorporateAuthFixture): Promise<void> {
  const probe = await requestJson(app, "POST", "/builder-auth/external-probe", {
    headers: { "x-agent-flow-builder-key": OWNER_KEY },
  });
  assert.equal(probe.statusCode, 200);
  assert.equal(probe.body.format, "agent-flow-builder.builder-auth-external-probe.v1");
  assert.equal(probe.body.configuredCount, 4);
  assert.equal(probe.body.checkedCount, 4);
  assert.equal(probe.body.okCount, 4);
  assert.equal(probe.body.errorCount, 0);
  assert.equal(probe.body.governance.excludesUrls, true);
  assert.equal(probe.body.governance.excludesSecretValues, true);
  assert.equal(probe.body.governance.authTokensInHeaderOnly, true);
  assert.equal(probe.body.governance.authTokensInBody, false);
  assertNoSensitiveValues(probe.body, fixture);

  assert.equal(fixture.findHit("HEAD", "/sessions")?.authorization, `Bearer ${SESSION_SERVICE_TOKEN}`);
  assert.equal(fixture.findHit("HEAD", "/introspect")?.authorization, `Bearer ${INTROSPECTION_TOKEN}`);
  assert.equal(fixture.findHit("HEAD", "/audit")?.authorization, `Bearer ${AUDIT_SINK_TOKEN}`);
  assert.equal(fixture.findHit("GET", "/groups")?.authorization, `Bearer ${GROUP_DIRECTORY_TOKEN}`);
  assert.equal(fixture.findHit("HEAD", "/sessions")?.rawBody, "");
  assert.equal(fixture.findHit("HEAD", "/introspect")?.rawBody, "");
  assert.equal(fixture.findHit("HEAD", "/audit")?.rawBody, "");
  assert.equal(fixture.findHit("GET", "/groups")?.rawBody, "");
}

async function verifyCorporateHomologation(
  app: ReturnType<typeof buildApp>,
  fixture: CorporateAuthFixture,
  workspaceRoot: string,
): Promise<void> {
  const homologation = await requestJson(app, "POST", "/builder-auth/corporate-homologation", {
    headers: { "x-agent-flow-builder-key": OWNER_KEY },
  });
  assert.equal(homologation.statusCode, 200);
  assert.equal(homologation.body.format, "agent-flow-builder.builder-auth-corporate-homologation.v1");
  assert.equal(homologation.body.status, "homologated");
  assert.equal(homologation.body.homologationLevel, "full_external_probe");
  assert.equal(homologation.body.requiredComponentCount, 4);
  assert.equal(homologation.body.okCount, 4);
  assert.deepEqual(homologation.body.missingEvidence, []);
  assert.equal(homologation.body.artifact.saved, true);
  assert.equal(
    homologation.body.artifact.relativePath,
    ".agent-flow/builder-auth/corporate-homologation.afbuilderauthhomologation.json",
  );
  assert.equal(homologation.body.statusSnapshot.authRequired, true);
  assert.equal(homologation.body.statusSnapshot.centralIntrospectionRequired, true);
  assert.equal(homologation.body.governance.excludesUrls, true);
  assert.equal(homologation.body.governance.excludesSecretValues, true);
  assert.equal(homologation.body.governance.excludesResolvedLocalPaths, true);
  assertNoSensitiveValues(homologation.body, fixture);
  assert.equal(JSON.stringify(homologation.body).includes(workspaceRoot), false);

  const savedPath = path.join(
    workspaceRoot,
    ".agent-flow",
    "builder-auth",
    "corporate-homologation.afbuilderauthhomologation.json",
  );
  const saved = JSON.parse(await readFile(savedPath, "utf-8"));
  assert.equal(saved.format, "agent-flow-builder.builder-auth-corporate-homologation.v1");
  assert.equal(saved.status, "homologated");
  assert.equal(saved.artifact.saved, true);
  assert.equal(JSON.stringify(saved).includes(workspaceRoot), false);
  assertNoSensitiveValues(saved, fixture);
}

async function verifySessionLifecycleAndCentralIntrospection(
  app: ReturnType<typeof buildApp>,
  fixture: CorporateAuthFixture,
  workspaceRoot: string,
): Promise<void> {
  const missingAuth = await requestJson(app, "GET", "/flows");
  assert.equal(missingAuth.statusCode, 401);
  assert.equal(missingAuth.body.details.auth.status, "missing");
  const missingAudit = await fixture.waitForHit((hit) => (
    hit.method === "POST" &&
    hit.pathname === "/audit" &&
    readPath(hit.body, ["entry", "status"]) === "missing" &&
    readPath(hit.body, ["entry", "route"]) === "/flows"
  ), 3000, "missing auth audit");
  assert.equal(missingAudit.authorization, `Bearer ${AUDIT_SINK_TOKEN}`);
  assert.equal(readPath(missingAudit.body, ["governance", "excludesRawKeyValues"]), true);
  assertNoSensitiveValues(missingAudit.body, fixture);

  const ownerList = await requestJson(app, "GET", "/flows", {
    headers: { "x-agent-flow-builder-key": OWNER_KEY },
  });
  assert.equal(ownerList.statusCode, 200);

  const session = await requestJson(app, "POST", "/builder-auth/session", {
    headers: { "x-agent-flow-builder-key": OWNER_KEY },
  });
  assert.equal(session.statusCode, 200);
  assert.equal(session.body.format, "agent-flow-builder.builder-auth-session.v1");
  assert.equal(session.body.token.startsWith("afbs_"), true);
  assert.equal(session.body.governance.storesRawToken, false);
  const sessionToken = session.body.token;

  const createdSession = await fixture.waitForHit((hit) => (
    hit.method === "POST" &&
    hit.pathname === "/sessions" &&
    readPath(hit.body, ["action"]) === "created"
  ), 3000, "session created");
  const createdTokenHash = readPath(createdSession.body, ["session", "tokenHash"]);
  assert.equal(createdSession.authorization, `Bearer ${SESSION_SERVICE_TOKEN}`);
  assert.equal(typeof createdTokenHash, "string");
  assert.equal(String(createdTokenHash).length, 64);
  assert.equal(readPath(createdSession.body, ["governance", "sendsRawToken"]), false);
  assert.equal(readPath(createdSession.body, ["governance", "sendsProviderTokens"]), false);
  assertNoSensitiveValues(createdSession.body, fixture, [sessionToken]);

  const sessionFile = await readFile(path.join(workspaceRoot, ".agent-flow", "builder-auth", "sessions.json"), "utf-8");
  assert.equal(sessionFile.includes(sessionToken), false);
  assert.equal(sessionFile.includes(OWNER_KEY), false);
  assert.equal(JSON.parse(sessionFile).sessions.length, 1);

  const centralList = await requestJson(app, "GET", "/flows", {
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  assert.equal(centralList.statusCode, 200);
  const introspection = await fixture.waitForHit((hit) => (
    hit.method === "POST" &&
    hit.pathname === "/introspect" &&
    readPath(hit.body, ["session", "tokenHash"]) === createdTokenHash
  ), 3000, "central introspection");
  assert.equal(introspection.authorization, `Bearer ${INTROSPECTION_TOKEN}`);
  assert.equal(readPath(introspection.body, ["governance", "sendsTokenHash"]), true);
  assert.equal(readPath(introspection.body, ["governance", "sendsRawToken"]), false);
  assert.equal(readPath(introspection.body, ["governance", "centralDecisionCanOverrideIdentity"]), true);
  assertNoSensitiveValues(introspection.body, fixture, [sessionToken]);

  const centralAllowedAudit = await fixture.waitForHit((hit) => (
    hit.method === "POST" &&
    hit.pathname === "/audit" &&
    readPath(hit.body, ["entry", "status"]) === "allowed" &&
    readPath(hit.body, ["entry", "source"]) === "central-session" &&
    readPath(hit.body, ["entry", "actorId"]) === "central-owner"
  ), 3000, "central allowed audit");
  assertNoSensitiveValues(centralAllowedAudit.body, fixture, [sessionToken]);

  const refreshed = await requestJson(app, "POST", "/builder-auth/session/refresh", {
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  assert.equal(refreshed.statusCode, 200);
  assert.equal(refreshed.body.format, "agent-flow-builder.builder-auth-session.v1");
  assert.notEqual(refreshed.body.token, sessionToken);
  const refreshedToken = refreshed.body.token;
  const refreshedSession = await fixture.waitForHit((hit) => (
    hit.method === "POST" &&
    hit.pathname === "/sessions" &&
    readPath(hit.body, ["action"]) === "refreshed"
  ), 3000, "session refreshed");
  assert.equal(readPath(refreshedSession.body, ["session", "previousTokenHash"]), createdTokenHash);
  assertNoSensitiveValues(refreshedSession.body, fixture, [sessionToken, refreshedToken]);

  const oldSessionRejected = await requestJson(app, "GET", "/flows", {
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  assert.equal(oldSessionRejected.statusCode, 403);

  fixture.setIntrospectionDecision({ allowed: false, reason: "central policy rejected test session" });
  const centrallyRejected = await requestJson(app, "GET", "/flows", {
    headers: { authorization: `Bearer ${refreshedToken}` },
  });
  assert.equal(centrallyRejected.statusCode, 403);
  assert.match(centrallyRejected.body.details.auth.reason, /central policy rejected test session/);
  const centralRejectedAudit = await fixture.waitForHit((hit) => (
    hit.method === "POST" &&
    hit.pathname === "/audit" &&
    readPath(hit.body, ["entry", "status"]) === "rejected" &&
    readPath(hit.body, ["entry", "reason"]) === "central policy rejected test session"
  ), 3000, "central rejected audit");
  assertNoSensitiveValues(centralRejectedAudit.body, fixture, [sessionToken, refreshedToken]);
  fixture.setIntrospectionDecision(null);

  const logout = await requestJson(app, "POST", "/builder-auth/session/logout", {
    headers: { authorization: `Bearer ${refreshedToken}` },
  });
  assert.equal(logout.statusCode, 200);
  assert.equal(logout.body.format, "agent-flow-builder.builder-auth-session-logout.v1");
  assert.equal(logout.body.revoked, true);
  assert.equal(logout.body.governance.returnsRawToken, false);
  const revokedSession = await fixture.waitForHit((hit) => (
    hit.method === "POST" &&
    hit.pathname === "/sessions" &&
    readPath(hit.body, ["action"]) === "revoked"
  ), 3000, "session revoked");
  assert.equal(readPath(revokedSession.body, ["session", "revoked"]), true);
  assertNoSensitiveValues(revokedSession.body, fixture, [sessionToken, refreshedToken]);
}

function configureCorporateAuthEnv(workspaceRoot: string, fixture: CorporateAuthFixture): void {
  process.env.AGENT_FLOW_BUILDER_AUTH_REQUIRED = "true";
  process.env.AGENT_FLOW_WORKSPACE_GOVERNANCE_ENFORCE = "true";
  process.env.AGENT_FLOW_BUILDER_API_KEYS = JSON.stringify([
    {
      key_id: "owner",
      key: OWNER_KEY,
      actor_id: "local-owner",
      name: "Local Owner",
      role: "owner",
      areas: ["*"],
      scopes: ["*"],
    },
  ]);
  process.env.AGENT_FLOW_BUILDER_API_KEYS_PATH = path.join(workspaceRoot, ".agent-flow", "builder-auth", "keys.json");
  process.env.AGENT_FLOW_BUILDER_AUTH_AUDIT_PATH = path.join(workspaceRoot, ".agent-flow", "builder-auth", "audit.jsonl");
  process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_PATH = path.join(workspaceRoot, ".agent-flow", "builder-auth", "sessions.json");
  process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_URL = fixture.url("/sessions");
  process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_TOKEN = SESSION_SERVICE_TOKEN;
  process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_TIMEOUT_MS = "1000";
  process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_URL = fixture.url("/introspect");
  process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_TOKEN = INTROSPECTION_TOKEN;
  process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_TIMEOUT_MS = "1000";
  process.env.AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_REQUIRED = "true";
  process.env.AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_URL = fixture.url("/audit");
  process.env.AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_TOKEN = AUDIT_SINK_TOKEN;
  process.env.AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_TIMEOUT_MS = "1000";
  process.env.AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_URL = fixture.url("/groups");
  process.env.AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_TOKEN = GROUP_DIRECTORY_TOKEN;
  process.env.AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_TIMEOUT_MS = "1000";
  process.env.AGENT_FLOW_BUILDER_AUTH_GROUP_POLICIES = JSON.stringify({
    format: "agent-flow-builder.builder-auth-group-policies.v1",
    policies: [
      {
        group: "central-governance",
        role: "owner",
        areas: ["*"],
        scopes: ["*"],
      },
    ],
  });
}

async function createWorkspaceFixture(): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-flow-builder-auth-corporate-"));
  await mkdir(path.join(workspaceRoot, "flows"), { recursive: true });
  await cp(
    path.join(REPO_ROOT, "flows", "reference-interview"),
    path.join(workspaceRoot, "flows", "reference-interview"),
    { recursive: true },
  );
  await rm(path.join(workspaceRoot, "flows", "reference-interview", ".agent-flow"), { recursive: true, force: true });
  await cp(path.join(REPO_ROOT, "runtime.manifest.json"), path.join(workspaceRoot, "runtime.manifest.json"));
  await saveWorkspaceGovernance(workspaceRoot, {
    format: "agent-flow-builder.workspace-governance.v1",
    updatedBy: "local-owner",
    participants: [
      {
        id: "local-owner",
        name: "Local Owner",
        role: "owner",
        areas: ["*"],
        status: "active",
        updatedAt: "2026-07-03T00:00:00.000Z",
        updatedBy: "system",
      },
      {
        id: "central-owner",
        name: "Central Owner",
        role: "owner",
        areas: ["*"],
        status: "active",
        updatedAt: "2026-07-03T00:00:00.000Z",
        updatedBy: "system",
      },
    ],
    policies: [
      {
        area: "governance",
        mode: "review_required",
        requiredRole: "reviewer",
        updatedAt: "2026-07-03T00:00:00.000Z",
        updatedBy: "local-owner",
      },
      {
        area: "runtime_delivery",
        mode: "owner_required",
        requiredRole: "owner",
        updatedAt: "2026-07-03T00:00:00.000Z",
        updatedBy: "local-owner",
      },
    ],
  });
  return workspaceRoot;
}

async function startCorporateAuthFixture(): Promise<CorporateAuthFixture> {
  const hits: CapturedRequest[] = [];
  const waiters: Array<{
    predicate: (hit: CapturedRequest) => boolean;
    resolve: (hit: CapturedRequest) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = [];
  const state: { introspectionDecision: unknown | null } = {
    introspectionDecision: null,
  };

  const server = createServer((request, response) => {
    void handleFixtureRequest(request, response, hits, waiters, state);
  });
  await listen(server);
  const address = server.address() as AddressInfo;

  return {
    port: address.port,
    url(pathname: string): string {
      return `http://127.0.0.1:${address.port}${pathname}`;
    },
    setIntrospectionDecision(decision: unknown | null): void {
      state.introspectionDecision = decision;
    },
    findHit(method: string, pathname: string): CapturedRequest | undefined {
      return hits.find((hit) => hit.method === method && hit.pathname === pathname);
    },
    waitForHit(predicate: (hit: CapturedRequest) => boolean, timeoutMs = 3000, label = "request"): Promise<CapturedRequest> {
      const existing = hits.find(predicate);
      if (existing) {
        return Promise.resolve(existing);
      }
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          const index = waiters.findIndex((waiter) => waiter.reject === reject);
          if (index >= 0) {
            waiters.splice(index, 1);
          }
          const seen = hits.map((hit) => `${hit.method} ${hit.pathname}`).join(", ") || "none";
          reject(new Error(`Timed out waiting for corporate auth fixture ${label}. Seen: ${seen}.`));
        }, timeoutMs);
        waiters.push({ predicate, resolve, reject, timeout });
      });
    },
    close(): Promise<void> {
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

async function handleFixtureRequest(
  request: IncomingMessage,
  response: ServerResponse,
  hits: CapturedRequest[],
  waiters: Array<{
    predicate: (hit: CapturedRequest) => boolean;
    resolve: (hit: CapturedRequest) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>,
  state: { introspectionDecision: unknown | null },
): Promise<void> {
  const rawBody = await readRequestBody(request);
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const hit: CapturedRequest = {
    method: request.method ?? "",
    pathname,
    authorization: String(request.headers.authorization ?? ""),
    rawBody,
    body: parseJson(rawBody),
  };
  hits.push(hit);
  resolveWaiters(hit, waiters);

  if (hit.method === "HEAD" && ["/sessions", "/introspect", "/audit"].includes(pathname)) {
    response.statusCode = 204;
    response.end();
    return;
  }
  if (hit.method === "GET" && pathname === "/groups") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      format: "agent-flow-builder.builder-auth-group-directory.v1",
      actors: [{ actorId: "central-owner", groups: ["central-governance"] }],
      groups: [{ group: "central-governance", members: ["central-owner"] }],
    }));
    return;
  }
  if (hit.method === "POST" && pathname === "/sessions") {
    response.statusCode = 204;
    response.end();
    return;
  }
  if (hit.method === "POST" && pathname === "/audit") {
    response.statusCode = 204;
    response.end();
    return;
  }
  if (hit.method === "POST" && pathname === "/introspect") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(state.introspectionDecision ?? {
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
    return;
  }
  response.statusCode = 404;
  response.end("not found");
}

function resolveWaiters(
  hit: CapturedRequest,
  waiters: Array<{
    predicate: (hit: CapturedRequest) => boolean;
    resolve: (hit: CapturedRequest) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>,
): void {
  for (let index = waiters.length - 1; index >= 0; index -= 1) {
    const waiter = waiters[index];
    if (waiter.predicate(hit)) {
      clearTimeout(waiter.timeout);
      waiters.splice(index, 1);
      waiter.resolve(hit);
    }
  }
}

async function requestJson(
  app: ReturnType<typeof buildApp>,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  options: { headers?: Record<string, string>; payload?: unknown } = {},
): Promise<{ statusCode: number; body: any; rawBody: string }> {
  const response = await app.inject({
    method,
    url,
    headers: options.headers,
    payload: options.payload,
  });
  return {
    statusCode: response.statusCode,
    body: parseJson(response.body),
    rawBody: response.body,
  };
}

function assertNoSensitiveValues(value: unknown, fixture: CorporateAuthFixture, extraValues: string[] = []): void {
  const serialized = JSON.stringify(value);
  for (const forbidden of [
    OWNER_KEY,
    SESSION_SERVICE_TOKEN,
    INTROSPECTION_TOKEN,
    AUDIT_SINK_TOKEN,
    GROUP_DIRECTORY_TOKEN,
    String(fixture.port),
    fixture.url("/sessions"),
    fixture.url("/introspect"),
    fixture.url("/audit"),
    fixture.url("/groups"),
    ...extraValues,
  ]) {
    assert.equal(serialized.includes(forbidden), false, `Payload leaked sensitive value: ${forbidden}`);
  }
}

function readPath(value: unknown, pathParts: string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || !(part in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function parseJson(raw: string): any {
  if (!raw.trim()) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { parseError: true, raw };
  }
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let rawBody = "";
    request.setEncoding("utf-8");
    request.on("data", (chunk) => {
      rawBody += chunk;
    });
    request.on("end", () => {
      resolve(rawBody);
    });
  });
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function snapshotEnv(): Map<string, string | undefined> {
  return new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(previousEnv: Map<string, string | undefined>): void {
  for (const [key, value] of previousEnv.entries()) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
