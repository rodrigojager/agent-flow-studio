import { strict as assert } from "node:assert";
import { access, cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildApp } from "./server.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function createWorkspaceFixture() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-builder-api-provider-alerts-"));
  await mkdir(path.join(workspaceRoot, "flows"), { recursive: true });
  await cp(
    path.join(REPO_ROOT, "flows", "reference-interview"),
    path.join(workspaceRoot, "flows", "reference-interview"),
    { recursive: true },
  );
  await rm(path.join(workspaceRoot, "flows", "reference-interview", ".agent-flow"), { recursive: true, force: true });
  await cp(path.join(REPO_ROOT, "runtime.manifest.json"), path.join(workspaceRoot, "runtime.manifest.json"));
  return workspaceRoot;
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  return raw ? JSON.parse(raw) : {};
}

test("Builder API shares provider telemetry alerts without raw run events", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const previousRoutes = process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTES;
  process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTES = JSON.stringify([
    {
      id: "token-budget",
      metric: "tokens",
      route: "token-budget",
      label: "Orçamento de tokens",
      minObservedPct: 100,
    },
  ]);
  t.after(() => {
    if (previousRoutes === undefined) {
      delete process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTES;
    } else {
      process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTES = previousRoutes;
    }
  });

  const app = buildApp({ workspaceRoot });

  const emptyProviderTelemetryAlerts = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/provider-telemetry-alerts",
  });
  assert.equal(emptyProviderTelemetryAlerts.statusCode, 200);
  assert.equal(emptyProviderTelemetryAlerts.json().format, "agent-flow-builder.provider-telemetry-alerts.v1");
  assert.equal(emptyProviderTelemetryAlerts.json().alertCount, 0);
  assert.equal(emptyProviderTelemetryAlerts.json().openCount, 0);
  assert.equal(emptyProviderTelemetryAlerts.json().sharedSync.action, "empty");
  assert.equal(emptyProviderTelemetryAlerts.json().sharedSync.governance.excludesRawRunEvents, true);
  assert.equal(emptyProviderTelemetryAlerts.json().sharedSync.governance.excludesSecretValues, true);
  assert.equal(emptyProviderTelemetryAlerts.json().routingPolicy.configured, true);
  assert.equal(emptyProviderTelemetryAlerts.json().routingPolicy.ruleCount, 1);
  assert.equal(emptyProviderTelemetryAlerts.json().routingPolicy.rules[0].route, "token-budget");
  assert.equal(emptyProviderTelemetryAlerts.json().routingPolicy.governance.storesRouteWebhookUrls, false);
  assert.equal(emptyProviderTelemetryAlerts.json().routingPolicy.governance.storesRouteSecrets, false);

  const providerTelemetryAlertItem = {
    id: "provider-alert-a",
    flowId: "reference-interview",
    source: "provider-telemetry",
    route: "local-inbox",
    status: "open",
    severity: "warning",
    provider: "openai",
    model: "gpt-4.1-mini",
    metric: "tokens",
    observed: 1200,
    limit: 1000,
    message: "openai/gpt-4.1-mini excedeu limite de tokens.",
    windowHours: 24,
    firstSeenAt: "2026-07-02T13:00:00.000Z",
    lastSeenAt: "2026-07-02T13:00:00.000Z",
    acknowledgedAt: null,
    occurrenceCount: 1,
    retainedUntil: "2999-01-01T00:00:00.000Z",
    rawEvents: [{ payload: "SHOULD_NOT_PERSIST" }],
    secret: "SHOULD_NOT_PERSIST",
  };

  const savedProviderTelemetryAlerts = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/provider-telemetry-alerts",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.provider-telemetry-alerts.v1",
      exportedAt: "2026-07-02T13:00:00.000Z",
      flowId: "reference-interview",
      items: [providerTelemetryAlertItem],
    },
  });
  assert.equal(savedProviderTelemetryAlerts.statusCode, 200);
  assert.equal(savedProviderTelemetryAlerts.json().alertCount, 1);
  assert.equal(savedProviderTelemetryAlerts.json().openCount, 1);
  assert.equal(savedProviderTelemetryAlerts.json().items[0].id, "provider-alert-a");
  assert.equal(savedProviderTelemetryAlerts.json().items[0].route, "token-budget");
  assert.equal(savedProviderTelemetryAlerts.json().items[0].routeLabel, "Orçamento de tokens");
  assert.equal(savedProviderTelemetryAlerts.json().items[0].routingRuleId, "token-budget");
  assert.equal(savedProviderTelemetryAlerts.json().items[0].routingReason.includes("usage>=100%"), true);
  assert.deepEqual(savedProviderTelemetryAlerts.json().routeBreakdown, [
    {
      route: "token-budget",
      label: "Orçamento de tokens",
      alertCount: 1,
      openCount: 1,
    },
  ]);
  assert.equal(savedProviderTelemetryAlerts.json().items[0].rawEvents, undefined);
  assert.equal(savedProviderTelemetryAlerts.json().items[0].secret, undefined);
  assert.equal(JSON.stringify(savedProviderTelemetryAlerts.json()).includes("SHOULD_NOT_PERSIST"), false);
  assert.equal(savedProviderTelemetryAlerts.json().retentionPolicy.excludesRawRunEvents, true);
  assert.equal(savedProviderTelemetryAlerts.json().retentionPolicy.excludesSecretValues, true);
  assert.equal(savedProviderTelemetryAlerts.json().sharedSync.action, "save");
  assert.equal(savedProviderTelemetryAlerts.json().sharedSync.addedCount, 1);
  assert.equal(savedProviderTelemetryAlerts.json().sharedSync.finalCount, 1);

  const viewerAcknowledgedProviderTelemetryAlerts = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/provider-telemetry-alerts/merge",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.provider-telemetry-alerts.v1",
      exportedAt: "2026-07-02T13:02:00.000Z",
      flowId: "reference-interview",
      items: [
        {
          ...providerTelemetryAlertItem,
          status: "acknowledged",
          acknowledgedAt: "2026-07-02T13:02:00.000Z",
          acknowledgedBy: "qa-viewer",
          acknowledgedRole: "viewer",
        },
      ],
    },
  });
  assert.equal(viewerAcknowledgedProviderTelemetryAlerts.statusCode, 403);
  assert.equal(
    viewerAcknowledgedProviderTelemetryAlerts.json().details.code,
    "provider_telemetry_alert_acknowledgement_viewer_forbidden",
  );

  const mergedProviderTelemetryAlerts = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/provider-telemetry-alerts/merge",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.provider-telemetry-alerts.v1",
      exportedAt: "2026-07-02T13:03:00.000Z",
      flowId: "reference-interview",
      items: [
        {
          ...providerTelemetryAlertItem,
          status: "acknowledged",
          acknowledgedAt: "2026-07-02T13:03:00.000Z",
          acknowledgedBy: "qa-reviewer",
          acknowledgedRole: "reviewer",
        },
        {
          ...providerTelemetryAlertItem,
          id: "provider-alert-b",
          metric: "cost",
          observed: 2,
          limit: 1,
          message: "openai/gpt-4.1-mini excedeu limite de custo.",
          firstSeenAt: "2026-07-02T13:02:00.000Z",
          lastSeenAt: "2026-07-02T13:02:00.000Z",
          acknowledgedAt: null,
        },
      ],
    },
  });
  assert.equal(mergedProviderTelemetryAlerts.statusCode, 200);
  assert.equal(mergedProviderTelemetryAlerts.json().alertCount, 2);
  assert.equal(mergedProviderTelemetryAlerts.json().openCount, 1);
  assert.equal(
    mergedProviderTelemetryAlerts.json().routeBreakdown.find((route) => route.route === "token-budget").alertCount,
    1,
  );
  assert.equal(
    mergedProviderTelemetryAlerts.json().routeBreakdown.find((route) => route.route === "local-inbox").alertCount,
    1,
  );
  assert.equal(
    mergedProviderTelemetryAlerts.json().items.find((item) => item.id === "provider-alert-a").status,
    "acknowledged",
  );
  assert.equal(
    mergedProviderTelemetryAlerts.json().items.find((item) => item.id === "provider-alert-a").acknowledgedBy,
    "qa-reviewer",
  );
  assert.equal(
    mergedProviderTelemetryAlerts.json().items.find((item) => item.id === "provider-alert-a").acknowledgedRole,
    "reviewer",
  );
  assert.equal(mergedProviderTelemetryAlerts.json().sharedSync.action, "merge");
  assert.equal(mergedProviderTelemetryAlerts.json().sharedSync.incomingCount, 2);
  assert.equal(mergedProviderTelemetryAlerts.json().sharedSync.existingCount, 1);
  assert.equal(mergedProviderTelemetryAlerts.json().sharedSync.addedCount, 1);
  assert.equal(mergedProviderTelemetryAlerts.json().sharedSync.updatedCount, 1);
  assert.equal(mergedProviderTelemetryAlerts.json().sharedSync.finalCount, 2);
  assert.equal(JSON.stringify(mergedProviderTelemetryAlerts.json()).includes("SHOULD_NOT_PERSIST"), false);
  await access(path.join(
    workspaceRoot,
    "flows",
    "reference-interview",
    ".agent-flow",
    "provider-telemetry-alerts",
    "inbox.aftelemetryalerts.json",
  ));

  const invalidProviderTelemetryAlerts = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/provider-telemetry-alerts",
    headers: { "content-type": "application/json" },
    payload: { format: "invalid" },
  });
  assert.equal(invalidProviderTelemetryAlerts.statusCode, 400);
});

test("Builder API syncs provider telemetry alerts with the central service without raw events", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const app = buildApp({ workspaceRoot });
  t.after(() => app.close());

  const providerTelemetryAlertItem = {
    id: "provider-alert-local",
    flowId: "reference-interview",
    source: "provider-telemetry",
    route: "local-inbox",
    status: "open",
    severity: "warning",
    provider: "openai",
    model: "gpt-4.1-mini",
    metric: "tokens",
    observed: 1200,
    limit: 1000,
    message: "openai/gpt-4.1-mini excedeu limite de tokens.",
    windowHours: 24,
    firstSeenAt: "2026-07-02T13:00:00.000Z",
    lastSeenAt: "2026-07-02T13:00:00.000Z",
    acknowledgedAt: null,
    occurrenceCount: 1,
    retainedUntil: "2999-01-01T00:00:00.000Z",
    rawEvents: [{ payload: "SHOULD_NOT_SYNC" }],
    secret: "SHOULD_NOT_SYNC",
  };

  const savedProviderTelemetryAlerts = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/provider-telemetry-alerts",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.provider-telemetry-alerts.v1",
      exportedAt: "2026-07-02T13:00:00.000Z",
      flowId: "reference-interview",
      items: [providerTelemetryAlertItem],
    },
  });
  assert.equal(savedProviderTelemetryAlerts.statusCode, 200);
  assert.equal(savedProviderTelemetryAlerts.json().alertCount, 1);
  assert.equal(JSON.stringify(savedProviderTelemetryAlerts.json()).includes("SHOULD_NOT_SYNC"), false);

  const previousCentralUrl = process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERTS_CENTRAL_URL;
  const previousCentralToken = process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERTS_CENTRAL_TOKEN;
  const previousCentralTimeout = process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERTS_CENTRAL_TIMEOUT_MS;
  t.after(() => {
    if (previousCentralUrl === undefined) {
      delete process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERTS_CENTRAL_URL;
    } else {
      process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERTS_CENTRAL_URL = previousCentralUrl;
    }
    if (previousCentralToken === undefined) {
      delete process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERTS_CENTRAL_TOKEN;
    } else {
      process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERTS_CENTRAL_TOKEN = previousCentralToken;
    }
    if (previousCentralTimeout === undefined) {
      delete process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERTS_CENTRAL_TIMEOUT_MS;
    } else {
      process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERTS_CENTRAL_TIMEOUT_MS = previousCentralTimeout;
    }
  });

  const centralAlerts = {
    format: "agent-flow-builder.provider-telemetry-alerts.v1",
    exportedAt: "2026-07-02T13:05:00.000Z",
    flowId: "reference-interview",
    items: [
      {
        ...providerTelemetryAlertItem,
        id: "provider-alert-central",
        metric: "cost",
        observed: 2,
        limit: 1,
        message: "openai/gpt-4.1-mini excedeu limite de custo.",
        firstSeenAt: "2026-07-02T13:05:00.000Z",
        lastSeenAt: "2026-07-02T13:05:00.000Z",
      },
    ],
  };
  const centralRequests = [];
  const centralServer = createServer(async (request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/sync");
    centralRequests.push({
      authorization: request.headers.authorization,
      body: await readJsonBody(request),
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ alerts: centralAlerts }));
  });
  await new Promise((resolve) => centralServer.listen(0, "127.0.0.1", resolve));
  t.after(() => centralServer.close());
  const centralAddress = centralServer.address();
  process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERTS_CENTRAL_URL = `http://127.0.0.1:${centralAddress.port}/sync`;
  process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERTS_CENTRAL_TOKEN = "provider-central-token";
  process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERTS_CENTRAL_TIMEOUT_MS = "1500";

  const centralStatus = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/provider-telemetry-alerts/central",
  });
  const centralStatusBody = centralStatus.json();
  assert.equal(centralStatus.statusCode, 200);
  assert.equal(centralStatusBody.format, "agent-flow-builder.provider-telemetry-alerts-central-sync-status.v1");
  assert.equal(centralStatusBody.configured, true);
  assert.equal(centralStatusBody.tokenConfigured, true);
  assert.equal(centralStatusBody.timeoutMs, 1500);
  assert.equal(centralStatusBody.governance.centralAuthTokenInHeaderOnly, true);
  assert.equal(centralStatusBody.governance.centralAuthTokenInBody, false);
  assert.equal(centralStatusBody.governance.storesCentralToken, false);
  assert.equal(centralStatusBody.governance.excludesRawRunEvents, true);
  assert.equal(centralStatusBody.governance.excludesSecretValues, true);
  assert.equal(JSON.stringify(centralStatusBody).includes("provider-central-token"), false);
  assert.equal(JSON.stringify(centralStatusBody).includes(String(centralAddress.port)), false);

  const synced = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/provider-telemetry-alerts/sync-central",
  });
  const syncedBody = synced.json();
  assert.equal(synced.statusCode, 200);
  assert.equal(syncedBody.format, "agent-flow-builder.provider-telemetry-alerts-central-sync-result.v1");
  assert.equal(syncedBody.pushedAlertCount, 1);
  assert.equal(syncedBody.pulledAlertCount, 1);
  assert.equal(syncedBody.central.statusCode, 200);
  assert.equal(syncedBody.alerts.alertCount, 2);
  assert.ok(syncedBody.alerts.items.some((item) => item.id === "provider-alert-central"));
  assert.equal(syncedBody.governance.centralAuthTokenInHeaderOnly, true);
  assert.equal(syncedBody.governance.centralAuthTokenInBody, false);
  assert.equal(syncedBody.governance.excludesRawRunEvents, true);
  assert.equal(syncedBody.governance.excludesSecretValues, true);
  assert.equal(JSON.stringify(syncedBody).includes("provider-central-token"), false);
  assert.equal(JSON.stringify(syncedBody).includes(String(centralAddress.port)), false);
  assert.equal(JSON.stringify(syncedBody).includes("SHOULD_NOT_SYNC"), false);

  assert.equal(centralRequests.length, 1);
  assert.equal(centralRequests[0].authorization, "Bearer provider-central-token");
  const centralBody = centralRequests[0].body;
  assert.equal(centralBody.format, "agent-flow-builder.provider-telemetry-alerts-central-sync-request.v1");
  assert.equal(centralBody.alertCount, 1);
  assert.equal(centralBody.alerts.alertCount, 1);
  assert.equal(centralBody.governance.centralAuthTokenInHeaderOnly, true);
  assert.equal(centralBody.governance.centralAuthTokenInBody, false);
  assert.equal(centralBody.governance.excludesRawRunEvents, true);
  assert.equal(centralBody.governance.excludesSecretValues, true);
  assert.equal(JSON.stringify(centralBody).includes("provider-central-token"), false);
  assert.equal(JSON.stringify(centralBody).includes("SHOULD_NOT_SYNC"), false);
});

test("Builder API dispatches provider telemetry alerts by route without leaking sink configuration", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const app = buildApp({ workspaceRoot });
  t.after(() => app.close());

  const previousRoutes = process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTES;
  const previousEscalationPolicy = process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ESCALATION_POLICY;
  const previousSinks = process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTE_SINKS;
  const previousSinkToken = process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTE_TOKEN;
  const previousDispatchTimeout = process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTE_DISPATCH_TIMEOUT_MS;
  t.after(() => {
    if (previousRoutes === undefined) {
      delete process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTES;
    } else {
      process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTES = previousRoutes;
    }
    if (previousEscalationPolicy === undefined) {
      delete process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ESCALATION_POLICY;
    } else {
      process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ESCALATION_POLICY = previousEscalationPolicy;
    }
    if (previousSinks === undefined) {
      delete process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTE_SINKS;
    } else {
      process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTE_SINKS = previousSinks;
    }
    if (previousSinkToken === undefined) {
      delete process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTE_TOKEN;
    } else {
      process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTE_TOKEN = previousSinkToken;
    }
    if (previousDispatchTimeout === undefined) {
      delete process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTE_DISPATCH_TIMEOUT_MS;
    } else {
      process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTE_DISPATCH_TIMEOUT_MS = previousDispatchTimeout;
    }
  });

  process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTES = JSON.stringify([
    {
      id: "token-budget",
      metric: "tokens",
      route: "token-budget",
      label: "Orçamento de tokens",
      minObservedPct: 100,
    },
  ]);
  process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ESCALATION_POLICY = JSON.stringify([
    {
      id: "repeat-token-budget",
      route: "token-budget",
      metric: "tokens",
      minObservedPct: 100,
      minOccurrences: 2,
      level: "critical",
      dispatchPriority: 900,
    },
  ]);
  process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTE_TOKEN = "route-sink-token";
  process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTE_DISPATCH_TIMEOUT_MS = "1500";

  const receivedDispatches = [];
  const sinkServer = createServer(async (request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/alerts");
    receivedDispatches.push({
      authorization: request.headers.authorization,
      body: await readJsonBody(request),
    });
    response.writeHead(202, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => sinkServer.listen(0, "127.0.0.1", resolve));
  t.after(() => sinkServer.close());
  const sinkAddress = sinkServer.address();
  const sinkUrl = `http://127.0.0.1:${sinkAddress.port}/alerts`;
  process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTE_SINKS = JSON.stringify([
    {
      route: "token-budget",
      label: "Orçamento de tokens",
      url: sinkUrl,
      tokenEnv: "AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTE_TOKEN",
    },
  ]);

  const savedProviderTelemetryAlerts = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/provider-telemetry-alerts",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.provider-telemetry-alerts.v1",
      exportedAt: "2026-07-02T13:00:00.000Z",
      flowId: "reference-interview",
      items: [
        {
          id: "provider-alert-token",
          flowId: "reference-interview",
          source: "provider-telemetry",
          route: "local-inbox",
          status: "open",
          severity: "warning",
          provider: "openai",
          model: "gpt-4.1-mini",
          metric: "tokens",
          observed: 1200,
          limit: 1000,
          message: "openai/gpt-4.1-mini excedeu limite de tokens.",
          windowHours: 24,
          firstSeenAt: "2026-07-02T13:00:00.000Z",
          lastSeenAt: "2026-07-02T13:00:00.000Z",
          acknowledgedAt: null,
          occurrenceCount: 3,
          retainedUntil: "2999-01-01T00:00:00.000Z",
          secret: "SHOULD_NOT_DISPATCH",
        },
        {
          id: "provider-alert-cost",
          flowId: "reference-interview",
          source: "provider-telemetry",
          route: "local-inbox",
          status: "open",
          severity: "warning",
          provider: "openai",
          model: "gpt-4.1-mini",
          metric: "cost",
          observed: 2,
          limit: 1,
          message: "openai/gpt-4.1-mini excedeu limite de custo.",
          windowHours: 24,
          firstSeenAt: "2026-07-02T13:00:00.000Z",
          lastSeenAt: "2026-07-02T13:00:00.000Z",
          acknowledgedAt: null,
          occurrenceCount: 1,
          retainedUntil: "2999-01-01T00:00:00.000Z",
        },
      ],
    },
  });
  assert.equal(savedProviderTelemetryAlerts.statusCode, 200);
  assert.equal(savedProviderTelemetryAlerts.json().routeBreakdown.length, 2);
  assert.equal(savedProviderTelemetryAlerts.json().escalationPolicy.configured, true);
  assert.equal(savedProviderTelemetryAlerts.json().escalationPolicy.ruleCount, 1);
  assert.equal(savedProviderTelemetryAlerts.json().escalationBreakdown[0].level, "critical");
  assert.equal(
    savedProviderTelemetryAlerts.json().items.find((item) => item.id === "provider-alert-token").escalationLevel,
    "critical",
  );
  assert.equal(
    savedProviderTelemetryAlerts.json().items.find((item) => item.id === "provider-alert-token").dispatchPriority,
    900,
  );

  const dispatchStatus = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/provider-telemetry-alerts/dispatch",
  });
  const dispatchStatusBody = dispatchStatus.json();
  assert.equal(dispatchStatus.statusCode, 200);
  assert.equal(dispatchStatusBody.format, "agent-flow-builder.provider-telemetry-alert-route-dispatch-status.v1");
  assert.equal(dispatchStatusBody.configured, true);
  assert.equal(dispatchStatusBody.sinkCount, 1);
  assert.equal(dispatchStatusBody.routes[0].route, "token-budget");
  assert.equal(dispatchStatusBody.routes[0].tokenConfigured, true);
  assert.equal(dispatchStatusBody.escalationPolicy.configured, true);
  assert.equal(dispatchStatusBody.escalationPolicy.rules[0].level, "critical");
  assert.equal(dispatchStatusBody.governance.configuredEscalationPolicyEnv, "AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ESCALATION_POLICY");
  assert.equal(dispatchStatusBody.governance.storesEscalationSecrets, false);
  assert.equal(dispatchStatusBody.governance.routeSinkUrlsInStatus, false);
  assert.equal(dispatchStatusBody.governance.routeTokensInHeaderOnly, true);
  assert.equal(JSON.stringify(dispatchStatusBody).includes(String(sinkAddress.port)), false);
  assert.equal(JSON.stringify(dispatchStatusBody).includes("route-sink-token"), false);

  const dispatched = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/provider-telemetry-alerts/dispatch",
  });
  const dispatchedBody = dispatched.json();
  assert.equal(dispatched.statusCode, 200);
  assert.equal(dispatchedBody.format, "agent-flow-builder.provider-telemetry-alert-route-dispatch-result.v1");
  assert.equal(dispatchedBody.sentAlertCount, 1);
  assert.equal(dispatchedBody.skippedAlertCount, 1);
  assert.equal(dispatchedBody.attemptedRouteCount, 1);
  assert.equal(dispatchedBody.deliveries.find((delivery) => delivery.route === "token-budget").status, "sent");
  assert.equal(dispatchedBody.deliveries.find((delivery) => delivery.route === "token-budget").maxDispatchPriority, 900);
  assert.equal(
    dispatchedBody.deliveries.find((delivery) => delivery.route === "token-budget").escalationBreakdown[0].level,
    "critical",
  );
  assert.equal(dispatchedBody.deliveries.find((delivery) => delivery.route === "local-inbox").status, "skipped");
  assert.equal(dispatchedBody.governance.routeSinkUrlsInDispatchResult, false);
  assert.equal(dispatchedBody.governance.storesEscalationSecrets, false);
  assert.equal(JSON.stringify(dispatchedBody).includes(String(sinkAddress.port)), false);
  assert.equal(JSON.stringify(dispatchedBody).includes("route-sink-token"), false);
  assert.equal(JSON.stringify(dispatchedBody).includes("SHOULD_NOT_DISPATCH"), false);

  assert.equal(receivedDispatches.length, 1);
  assert.equal(receivedDispatches[0].authorization, "Bearer route-sink-token");
  assert.equal(receivedDispatches[0].body.format, "agent-flow-builder.provider-telemetry-alert-route-dispatch.v1");
  assert.equal(receivedDispatches[0].body.route, "token-budget");
  assert.equal(receivedDispatches[0].body.alertCount, 1);
  assert.equal(receivedDispatches[0].body.maxDispatchPriority, 900);
  assert.equal(receivedDispatches[0].body.escalationBreakdown[0].level, "critical");
  assert.equal(receivedDispatches[0].body.alerts.items.length, 1);
  assert.equal(receivedDispatches[0].body.alerts.items[0].id, "provider-alert-token");
  assert.equal(receivedDispatches[0].body.alerts.items[0].escalationLevel, "critical");
  assert.equal(receivedDispatches[0].body.alerts.items[0].dispatchPriority, 900);
  assert.equal(receivedDispatches[0].body.alerts.escalationPolicy.configured, true);
  assert.equal(JSON.stringify(receivedDispatches[0].body).includes("route-sink-token"), false);
  assert.equal(JSON.stringify(receivedDispatches[0].body).includes("SHOULD_NOT_DISPATCH"), false);
});

test("Builder API applies provider telemetry alert delivery policy before dispatch", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const app = buildApp({ workspaceRoot });
  t.after(() => app.close());

  const previousRoutes = process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTES;
  const previousEscalationPolicy = process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ESCALATION_POLICY;
  const previousDeliveryPolicy = process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_DELIVERY_POLICY;
  const previousSinks = process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTE_SINKS;
  t.after(() => {
    if (previousRoutes === undefined) {
      delete process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTES;
    } else {
      process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTES = previousRoutes;
    }
    if (previousEscalationPolicy === undefined) {
      delete process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ESCALATION_POLICY;
    } else {
      process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ESCALATION_POLICY = previousEscalationPolicy;
    }
    if (previousDeliveryPolicy === undefined) {
      delete process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_DELIVERY_POLICY;
    } else {
      process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_DELIVERY_POLICY = previousDeliveryPolicy;
    }
    if (previousSinks === undefined) {
      delete process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTE_SINKS;
    } else {
      process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTE_SINKS = previousSinks;
    }
  });

  process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTES = JSON.stringify([
    {
      id: "token-budget",
      metric: "tokens",
      route: "token-budget",
      label: "Orçamento de tokens",
      minObservedPct: 100,
    },
  ]);
  process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ESCALATION_POLICY = JSON.stringify([
    {
      id: "repeat-token-budget",
      route: "token-budget",
      metric: "tokens",
      minObservedPct: 100,
      minOccurrences: 2,
      level: "critical",
      dispatchPriority: 900,
    },
  ]);
  process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_DELIVERY_POLICY = JSON.stringify({
    maxAlertsPerRoute: 1,
    minDispatchPriority: 900,
    cooldownMinutes: 60,
  });

  const receivedDispatches = [];
  const sinkServer = createServer(async (request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/alerts");
    receivedDispatches.push({
      body: await readJsonBody(request),
    });
    response.writeHead(202, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => sinkServer.listen(0, "127.0.0.1", resolve));
  t.after(() => sinkServer.close());
  const sinkAddress = sinkServer.address();
  process.env.AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTE_SINKS = JSON.stringify([
    {
      route: "token-budget",
      label: "Orçamento de tokens",
      url: `http://127.0.0.1:${sinkAddress.port}/alerts`,
    },
  ]);

  const savedProviderTelemetryAlerts = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/provider-telemetry-alerts",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.provider-telemetry-alerts.v1",
      exportedAt: "2026-07-02T13:00:00.000Z",
      flowId: "reference-interview",
      items: [
        {
          id: "provider-alert-token-a",
          flowId: "reference-interview",
          source: "provider-telemetry",
          route: "local-inbox",
          status: "open",
          severity: "warning",
          provider: "openai",
          model: "gpt-4.1-mini",
          metric: "tokens",
          observed: 1200,
          limit: 1000,
          message: "openai/gpt-4.1-mini excedeu limite de tokens.",
          windowHours: 24,
          firstSeenAt: "2026-07-02T13:00:00.000Z",
          lastSeenAt: "2026-07-02T13:03:00.000Z",
          acknowledgedAt: null,
          occurrenceCount: 3,
          retainedUntil: "2999-01-01T00:00:00.000Z",
        },
        {
          id: "provider-alert-token-b",
          flowId: "reference-interview",
          source: "provider-telemetry",
          route: "local-inbox",
          status: "open",
          severity: "warning",
          provider: "openai",
          model: "gpt-4.1-mini",
          metric: "tokens",
          observed: 1300,
          limit: 1000,
          message: "openai/gpt-4.1-mini excedeu limite de tokens novamente.",
          windowHours: 24,
          firstSeenAt: "2026-07-02T13:01:00.000Z",
          lastSeenAt: "2026-07-02T13:02:00.000Z",
          acknowledgedAt: null,
          occurrenceCount: 3,
          retainedUntil: "2999-01-01T00:00:00.000Z",
        },
      ],
    },
  });
  assert.equal(savedProviderTelemetryAlerts.statusCode, 200);
  assert.equal(savedProviderTelemetryAlerts.json().items.length, 2);

  const dispatchStatus = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/provider-telemetry-alerts/dispatch",
  });
  const dispatchStatusBody = dispatchStatus.json();
  assert.equal(dispatchStatus.statusCode, 200);
  assert.equal(dispatchStatusBody.deliveryPolicy.configured, true);
  assert.equal(dispatchStatusBody.deliveryPolicy.maxAlertsPerRoute, 1);
  assert.equal(dispatchStatusBody.deliveryPolicy.minDispatchPriority, 900);
  assert.equal(dispatchStatusBody.deliveryPolicy.cooldownMinutes, 60);
  assert.equal(
    dispatchStatusBody.governance.configuredDeliveryPolicyEnv,
    "AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_DELIVERY_POLICY",
  );

  const readiness = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/provider-telemetry-alerts/delivery-readiness",
  });
  const readinessBody = readiness.json();
  assert.equal(readiness.statusCode, 200);
  assert.equal(readinessBody.format, "agent-flow-builder.provider-telemetry-alert-delivery-readiness.v1");
  assert.equal(readinessBody.status, "partial");
  assert.equal(readinessBody.openAlertCount, 2);
  assert.equal(readinessBody.deliverableAlertCount, 1);
  assert.equal(readinessBody.partialRouteCount, 1);
  assert.equal(readinessBody.deliveryPolicy.configured, true);
  assert.equal(readinessBody.dispatch.configured, true);
  assert.equal(readinessBody.routes[0].route, "token-budget");
  assert.equal(readinessBody.routes[0].sinkConfigured, true);
  assert.equal(readinessBody.routes[0].openCount, 2);
  assert.equal(readinessBody.routes[0].selectedCount, 1);
  assert.equal(readinessBody.routes[0].skippedByPolicyCount, 1);
  assert.equal(readinessBody.routes[0].deliveryPolicy.cooldownMinutes, 60);
  assert.equal(readinessBody.governance.routeSinkUrlsInReport, false);
  assert.equal(readinessBody.governance.routeTokensInReport, false);
  assert.equal(readinessBody.governance.storesDeliverySecrets, false);
  assert.equal(JSON.stringify(readinessBody).includes(String(sinkAddress.port)), false);

  const firstDispatch = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/provider-telemetry-alerts/dispatch",
  });
  const firstDispatchBody = firstDispatch.json();
  const firstDelivery = firstDispatchBody.deliveries.find((delivery) => delivery.route === "token-budget");
  assert.equal(firstDispatch.statusCode, 200);
  assert.equal(firstDispatchBody.sentAlertCount, 1);
  assert.equal(firstDispatchBody.skippedAlertCount, 1);
  assert.equal(firstDelivery.status, "sent");
  assert.equal(firstDelivery.alertCount, 1);
  assert.equal(firstDelivery.availableOpenCount, 2);
  assert.equal(firstDelivery.skippedByPolicyCount, 1);
  assert.equal(firstDelivery.deliveryPolicy.selectedCount, 1);
  assert.equal(firstDelivery.deliveryPolicy.skippedByPolicyCount, 1);
  assert.equal(receivedDispatches.length, 1);
  assert.equal(receivedDispatches[0].body.alertCount, 1);
  assert.equal(receivedDispatches[0].body.availableOpenCount, 2);
  assert.equal(receivedDispatches[0].body.skippedByPolicyCount, 1);
  assert.equal(receivedDispatches[0].body.alerts.items[0].id, "provider-alert-token-a");

  const secondDispatch = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/provider-telemetry-alerts/dispatch",
  });
  const secondDispatchBody = secondDispatch.json();
  assert.equal(secondDispatch.statusCode, 200);
  assert.equal(secondDispatchBody.sentAlertCount, 1);
  assert.equal(secondDispatchBody.skippedAlertCount, 1);
  assert.equal(receivedDispatches.length, 2);
  assert.equal(receivedDispatches[1].body.alerts.items[0].id, "provider-alert-token-b");

  const thirdDispatch = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/provider-telemetry-alerts/dispatch",
  });
  const thirdDispatchBody = thirdDispatch.json();
  const thirdDelivery = thirdDispatchBody.deliveries.find((delivery) => delivery.route === "token-budget");
  assert.equal(thirdDispatch.statusCode, 200);
  assert.equal(thirdDispatchBody.status, "skipped");
  assert.equal(thirdDispatchBody.sentAlertCount, 0);
  assert.equal(thirdDispatchBody.skippedAlertCount, 2);
  assert.equal(thirdDelivery.status, "skipped");
  assert.equal(thirdDelivery.availableOpenCount, 2);
  assert.equal(thirdDelivery.skippedByPolicyCount, 2);
  assert.equal(receivedDispatches.length, 2);

  const storedAlerts = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/provider-telemetry-alerts",
  });
  assert.equal(storedAlerts.statusCode, 200);
  assert.equal(storedAlerts.json().items.every((item) => item.lastDispatchedAt), true);
  assert.equal(storedAlerts.json().items.every((item) => item.dispatchCount === 1), true);
  assert.equal(JSON.stringify(firstDispatchBody).includes(String(sinkAddress.port)), false);
});
