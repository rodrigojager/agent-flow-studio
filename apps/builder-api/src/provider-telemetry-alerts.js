import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadFlowById, WorkspaceError } from "./workspace.ts";

const PROVIDER_TELEMETRY_ALERTS_FILE = ".agent-flow/provider-telemetry-alerts/inbox.aftelemetryalerts.json";
const PROVIDER_TELEMETRY_ALERTS_CENTRAL_SYNC_REQUEST_FORMAT =
  "agent-flow-builder.provider-telemetry-alerts-central-sync-request.v1";
const PROVIDER_TELEMETRY_ALERTS_CENTRAL_SYNC_RESULT_FORMAT =
  "agent-flow-builder.provider-telemetry-alerts-central-sync-result.v1";
const PROVIDER_TELEMETRY_ALERTS_CENTRAL_STATUS_FORMAT =
  "agent-flow-builder.provider-telemetry-alerts-central-sync-status.v1";
const PROVIDER_TELEMETRY_ALERTS_ROUTE_DISPATCH_STATUS_FORMAT =
  "agent-flow-builder.provider-telemetry-alert-route-dispatch-status.v1";
const PROVIDER_TELEMETRY_ALERTS_ROUTE_DISPATCH_RESULT_FORMAT =
  "agent-flow-builder.provider-telemetry-alert-route-dispatch-result.v1";
const PROVIDER_TELEMETRY_ALERTS_ROUTE_DISPATCH_REQUEST_FORMAT =
  "agent-flow-builder.provider-telemetry-alert-route-dispatch.v1";
const PROVIDER_TELEMETRY_ALERTS_DELIVERY_READINESS_FORMAT =
  "agent-flow-builder.provider-telemetry-alert-delivery-readiness.v1";
const PROVIDER_TELEMETRY_ALERTS_CENTRAL_URL_ENV = "AGENT_FLOW_PROVIDER_TELEMETRY_ALERTS_CENTRAL_URL";
const PROVIDER_TELEMETRY_ALERTS_CENTRAL_TOKEN_ENV = "AGENT_FLOW_PROVIDER_TELEMETRY_ALERTS_CENTRAL_TOKEN";
const PROVIDER_TELEMETRY_ALERTS_CENTRAL_TIMEOUT_ENV = "AGENT_FLOW_PROVIDER_TELEMETRY_ALERTS_CENTRAL_TIMEOUT_MS";
const PROVIDER_TELEMETRY_ALERT_ROUTES_ENV = "AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTES";
const PROVIDER_TELEMETRY_ALERT_ESCALATION_POLICY_ENV =
  "AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ESCALATION_POLICY";
const PROVIDER_TELEMETRY_ALERT_DELIVERY_POLICY_ENV =
  "AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_DELIVERY_POLICY";
const PROVIDER_TELEMETRY_ALERT_ROUTE_SINKS_ENV = "AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTE_SINKS";
const PROVIDER_TELEMETRY_ALERT_ROUTE_DISPATCH_TIMEOUT_ENV =
  "AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTE_DISPATCH_TIMEOUT_MS";
const PROVIDER_TELEMETRY_ALERTS_CENTRAL_TIMEOUT_MS = 5_000;
const PROVIDER_TELEMETRY_ALERTS_ROUTE_DISPATCH_TIMEOUT_MS = 5_000;
const PROVIDER_TELEMETRY_ALERTS_CENTRAL_MAX_BYTES = 2_000_000;
const MAX_PROVIDER_TELEMETRY_ALERTS = 96;

export async function loadProviderTelemetryAlerts(workspaceRoot, flowId) {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  try {
    const raw = await readFile(providerTelemetryAlertsPath(loaded.flowRoot), "utf-8");
    const payload = normalizePackage(JSON.parse(raw), loaded.flow.id, "merge");
    if (!payload) {
      throw new WorkspaceError("Inbox compartilhada de alertas de telemetria invalida.", 422);
    }
    return payload;
  } catch (error) {
    if (isFileNotFound(error)) {
      return buildPackage(loaded.flow.id, [], emptyStats("empty"));
    }
    if (error instanceof WorkspaceError) {
      throw error;
    }
    throw new WorkspaceError("Falha ao ler inbox compartilhada de alertas de telemetria.", 500, error);
  }
}

export async function saveProviderTelemetryAlerts(workspaceRoot, flowId, payload) {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const incoming = normalizePackage(payload, loaded.flow.id, "save");
  if (!incoming) {
    throw new WorkspaceError("Payload de alertas de telemetria invalido.", 400);
  }
  const existing = await loadProviderTelemetryAlerts(workspaceRoot, flowId);
  const stats = compareItems(readPackageItems(existing), incoming.items);
  const next = buildPackage(loaded.flow.id, incoming.items, {
    action: "save",
    ...stats,
    finalCount: incoming.items.length,
  });
  await writeProviderTelemetryAlerts(loaded.flowRoot, next);
  return next;
}

export async function mergeProviderTelemetryAlerts(workspaceRoot, flowId, payload) {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const incoming = normalizePackage(payload, loaded.flow.id, "merge");
  if (!incoming) {
    throw new WorkspaceError("Payload de merge de alertas de telemetria invalido.", 400);
  }
  const existing = await loadProviderTelemetryAlerts(workspaceRoot, flowId);
  const merged = mergeItems(readPackageItems(existing), incoming.items);
  const next = buildPackage(loaded.flow.id, merged.items, {
    action: "merge",
    ...merged.stats,
  });
  await writeProviderTelemetryAlerts(loaded.flowRoot, next);
  return next;
}

export async function loadProviderTelemetryAlertsCentralSyncStatus() {
  return buildCentralSyncStatus(centralSyncConfig());
}

export async function loadProviderTelemetryAlertDispatchStatus() {
  return buildRouteDispatchStatus(routeDispatchConfig());
}

export async function loadProviderTelemetryAlertDeliveryReadiness(workspaceRoot, flowId) {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const dispatchConfig = routeDispatchConfig();
  const routingPolicy = providerTelemetryAlertRoutingPolicy();
  const escalationPolicy = providerTelemetryAlertEscalationPolicy();
  const deliveryPolicy = providerTelemetryAlertDeliveryPolicy();
  const alerts = await loadProviderTelemetryAlerts(workspaceRoot, loaded.flow.id);
  const openAlerts = readPackageItems(alerts).filter((item) => item.status === "open");
  const sinkByRoute = new Map(dispatchConfig.sinks.map((sink) => [sink.route, sink]));
  const routeMap = new Map(routeBreakdown(openAlerts).map((route) => [route.route, route]));
  for (const sink of dispatchConfig.sinks) {
    if (!routeMap.has(sink.route)) {
      routeMap.set(sink.route, {
        route: sink.route,
        label: sink.label,
        alertCount: 0,
        openCount: 0,
      });
    }
  }
  const routes = Array.from(routeMap.values()).sort((left, right) => {
    const openDelta = right.openCount - left.openCount;
    return openDelta || right.alertCount - left.alertCount || left.route.localeCompare(right.route);
  });
  const routeReadiness = routes.map((route) => {
    const routeAlerts = openAlerts.filter((alert) => (readRoute(alert.route) ?? "local-inbox") === route.route);
    const deliveryPlan = planRouteDelivery(routeAlerts, route, deliveryPolicy);
    const sink = sinkByRoute.get(route.route);
    const status = routeAlerts.length === 0
      ? "idle"
      : !sink
        ? "blocked"
        : deliveryPlan.alerts.length > 0
          ? deliveryPlan.skippedByPolicyCount > 0
            ? "partial"
            : "ready"
          : "filtered";
    return {
      route: route.route,
      label: route.label,
      status,
      sinkConfigured: Boolean(sink),
      tokenConfigured: Boolean(sink?.token),
      tokenEnvConfigured: Boolean(sink?.tokenEnv),
      openCount: routeAlerts.length,
      eligibleCount: deliveryPlan.summary.eligibleCount,
      selectedCount: deliveryPlan.summary.selectedCount,
      skippedByPolicyCount: deliveryPlan.summary.skippedByPolicyCount,
      maxDispatchPriority: routeAlerts.reduce(
        (max, alert) => Math.max(max, readNonNegativeInteger(alert.dispatchPriority, 0)),
        0,
      ),
      escalationBreakdown: escalationBreakdown(routeAlerts),
      deliveryPolicy: deliveryPlan.summary,
    };
  });
  const deliverableAlertCount = routeReadiness.reduce((total, route) => total + route.selectedCount, 0);
  const blockedRouteCount = routeReadiness.filter((route) => route.status === "blocked").length;
  const filteredRouteCount = routeReadiness.filter((route) => route.status === "filtered").length;
  const partialRouteCount = routeReadiness.filter((route) => route.status === "partial").length;
  const invalidReason = dispatchConfig.invalidReason ?? deliveryPolicy.invalidReason ?? routingPolicy.invalidReason ?? escalationPolicy.invalidReason;
  const status = invalidReason
    ? "blocked"
    : openAlerts.length === 0
      ? "idle"
      : deliverableAlertCount === 0
        ? "blocked"
        : blockedRouteCount > 0 || filteredRouteCount > 0 || partialRouteCount > 0
          ? "partial"
          : "ready";
  return {
    format: PROVIDER_TELEMETRY_ALERTS_DELIVERY_READINESS_FORMAT,
    generatedAt: new Date().toISOString(),
    flowId: loaded.flow.id,
    status,
    invalidReason,
    alertCount: readPackageItems(alerts).length,
    openAlertCount: openAlerts.length,
    deliverableAlertCount,
    blockedRouteCount,
    filteredRouteCount,
    partialRouteCount,
    sinkCount: dispatchConfig.sinks.length,
    routingPolicy: routingPolicySummary(routingPolicy),
    escalationPolicy: escalationPolicySummary(escalationPolicy),
    deliveryPolicy: deliveryPolicySummary(deliveryPolicy),
    dispatch: buildRouteDispatchStatus(dispatchConfig),
    routes: routeReadiness,
    governance: {
      excludesRawRunEvents: true,
      excludesSecretValues: true,
      routeSinkUrlsInReport: false,
      routeTokensInReport: false,
      routeTokensInHeaderOnly: true,
      storesRouteSinkUrls: false,
      storesRouteTokens: false,
      storesEscalationSecrets: false,
      storesDeliverySecrets: false,
      configuredSinksEnv: PROVIDER_TELEMETRY_ALERT_ROUTE_SINKS_ENV,
      configuredEscalationPolicyEnv: PROVIDER_TELEMETRY_ALERT_ESCALATION_POLICY_ENV,
      configuredDeliveryPolicyEnv: PROVIDER_TELEMETRY_ALERT_DELIVERY_POLICY_ENV,
    },
  };
}

export async function dispatchProviderTelemetryAlerts(workspaceRoot, flowId) {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const config = routeDispatchConfig();
  if (config.invalidReason) {
    throw new WorkspaceError(`Configuração de envio de alertas de telemetria inválida: ${config.invalidReason}`, 422);
  }
  const deliveryPolicy = providerTelemetryAlertDeliveryPolicy();
  if (deliveryPolicy.invalidReason) {
    throw new WorkspaceError(`Política de entrega de alertas de telemetria inválida: ${deliveryPolicy.invalidReason}`, 422);
  }
  const alerts = await loadProviderTelemetryAlerts(workspaceRoot, loaded.flow.id);
  const openAlerts = readPackageItems(alerts).filter((item) => item.status === "open");
  const sinkByRoute = new Map(config.sinks.map((sink) => [sink.route, sink]));
  const routes = routeBreakdown(openAlerts);
  const deliveries = [];
  const sentAlertIds = new Set();
  let sentAlertCount = 0;
  let skippedAlertCount = 0;
  const dispatchedAt = new Date().toISOString();
  for (const route of routes) {
    const sink = sinkByRoute.get(route.route);
    const routeAlerts = openAlerts.filter((alert) => (readRoute(alert.route) ?? "local-inbox") === route.route);
    const deliveryPlan = planRouteDelivery(routeAlerts, route, deliveryPolicy);
    if (!sink) {
      skippedAlertCount += routeAlerts.length;
      deliveries.push({
        route: route.route,
        label: route.label,
        configured: false,
        status: "skipped",
        statusCode: null,
        alertCount: routeAlerts.length,
        openCount: routeAlerts.length,
        availableOpenCount: routeAlerts.length,
        skippedByPolicyCount: 0,
        maxDispatchPriority: routeAlerts.reduce(
          (max, alert) => Math.max(max, readNonNegativeInteger(alert.dispatchPriority, 0)),
          0,
        ),
        escalationBreakdown: escalationBreakdown(routeAlerts),
        deliveryPolicy: deliveryPlan.summary,
        deliveredAt: null,
        error: "Nenhum sink configurado para esta rota.",
      });
      continue;
    }
    if (deliveryPlan.alerts.length === 0) {
      skippedAlertCount += routeAlerts.length;
      deliveries.push({
        route: route.route,
        label: route.label,
        configured: true,
        status: "skipped",
        statusCode: null,
        alertCount: 0,
        openCount: 0,
        availableOpenCount: routeAlerts.length,
        skippedByPolicyCount: routeAlerts.length,
        maxDispatchPriority: 0,
        escalationBreakdown: [],
        deliveryPolicy: deliveryPlan.summary,
        deliveredAt: null,
        error: "Nenhum alerta elegível pela política de entrega.",
      });
      continue;
    }
    const delivery = await dispatchRouteAlerts(config, sink, loaded.flow.id, route, deliveryPlan);
    deliveries.push(delivery);
    if (delivery.status === "sent") {
      sentAlertCount += delivery.alertCount;
      skippedAlertCount += delivery.skippedByPolicyCount;
      for (const alert of deliveryPlan.alerts) {
        sentAlertIds.add(String(alert.id));
      }
    } else {
      skippedAlertCount += routeAlerts.length;
    }
  }
  if (sentAlertIds.size > 0) {
    const markedItems = readPackageItems(alerts).map((item) => {
      if (!sentAlertIds.has(String(item.id))) {
        return item;
      }
      return {
        ...item,
        lastDispatchedAt: dispatchedAt,
        dispatchCount: readNonNegativeInteger(item.dispatchCount, 0) + 1,
      };
    });
    await writeProviderTelemetryAlerts(
      loaded.flowRoot,
      buildPackage(loaded.flow.id, markedItems, {
        action: "dispatch",
        incomingCount: markedItems.length,
        existingCount: readPackageItems(alerts).length,
        addedCount: 0,
        updatedCount: sentAlertIds.size,
        unchangedCount: Math.max(0, markedItems.length - sentAlertIds.size),
        finalCount: markedItems.length,
      }),
    );
  }
  return {
    format: PROVIDER_TELEMETRY_ALERTS_ROUTE_DISPATCH_RESULT_FORMAT,
    generatedAt: new Date().toISOString(),
    flowId: loaded.flow.id,
    status: deliveries.some((delivery) => delivery.status === "error")
      ? "error"
      : sentAlertCount > 0
        ? "sent"
        : "skipped",
    dispatch: buildRouteDispatchStatus(config, {
      lastDispatchedAt: new Date().toISOString(),
      sentAlertCount,
      skippedAlertCount,
      attemptedRouteCount: deliveries.filter((delivery) => delivery.configured).length,
      errorCount: deliveries.filter((delivery) => delivery.status === "error").length,
    }),
    sentAlertCount,
    skippedAlertCount,
    attemptedRouteCount: deliveries.filter((delivery) => delivery.configured).length,
    deliveries,
    governance: routeDispatchGovernance(),
  };
}

export async function syncCentralProviderTelemetryAlerts(workspaceRoot, flowId) {
  const loaded = await loadFlowById(workspaceRoot, flowId);
  const config = centralSyncConfig();
  if (config.invalidReason) {
    throw new WorkspaceError(`Configuração da central de alertas de telemetria inválida: ${config.invalidReason}`, 422);
  }
  if (!config.url) {
    throw new WorkspaceError("Central de alertas de telemetria não configurada.", 400);
  }
  const existing = await loadProviderTelemetryAlerts(workspaceRoot, flowId);
  const fetched = await fetchCentralSync(config, flowId, existing);
  let parsed;
  try {
    parsed = JSON.parse(fetched.body);
  } catch (error) {
    throw new WorkspaceError("Resposta central de alertas de telemetria não é JSON válido.", 502, error);
  }
  const centralAlertsPayload = isRecord(parsed) && parsed.alerts !== undefined ? parsed.alerts : parsed;
  const incoming = normalizePackage(centralAlertsPayload, loaded.flow.id, "merge");
  if (!incoming) {
    throw new WorkspaceError("Resposta central de alertas de telemetria não respeita o formato esperado.", 502);
  }
  const merged = mergeItems(readPackageItems(existing), incoming.items);
  const next = buildPackage(loaded.flow.id, merged.items, {
    action: "merge",
    ...merged.stats,
  });
  await writeProviderTelemetryAlerts(loaded.flowRoot, next);
  const syncedAt = new Date().toISOString();
  return {
    format: PROVIDER_TELEMETRY_ALERTS_CENTRAL_SYNC_RESULT_FORMAT,
    flowId,
    alerts: next,
    central: buildCentralSyncStatus(config, {
      lastSyncedAt: syncedAt,
      statusCode: fetched.statusCode,
      pushedAlertCount: existing.alertCount,
      pulledAlertCount: incoming.alertCount,
      error: null,
    }),
    pushedAlertCount: existing.alertCount,
    pulledAlertCount: incoming.alertCount,
    governance: {
      excludesRawRunEvents: true,
      excludesSecretValues: true,
      sendsProviderMetrics: true,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  };
}

function emptyStats(action) {
  return {
    action,
    incomingCount: 0,
    existingCount: 0,
    addedCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    finalCount: 0,
  };
}

function providerTelemetryAlertsPath(flowRoot) {
  return path.join(flowRoot, PROVIDER_TELEMETRY_ALERTS_FILE);
}

async function writeProviderTelemetryAlerts(flowRoot, value) {
  const filePath = providerTelemetryAlertsPath(flowRoot);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await rename(tempPath, filePath);
}

function centralSyncConfig() {
  const configuredUrl = process.env[PROVIDER_TELEMETRY_ALERTS_CENTRAL_URL_ENV]?.trim() ?? "";
  let url = null;
  let invalidReason = null;
  if (configuredUrl) {
    try {
      url = validateCentralUrl(configuredUrl);
    } catch (error) {
      invalidReason = errorMessage(error);
    }
  }
  const timeoutValue = Number(process.env[PROVIDER_TELEMETRY_ALERTS_CENTRAL_TIMEOUT_ENV] ?? "");
  const timeoutMs = Number.isFinite(timeoutValue)
    ? Math.min(Math.max(Math.floor(timeoutValue), 100), 60_000)
    : PROVIDER_TELEMETRY_ALERTS_CENTRAL_TIMEOUT_MS;
  return {
    url,
    token: process.env[PROVIDER_TELEMETRY_ALERTS_CENTRAL_TOKEN_ENV]?.trim() || null,
    timeoutMs,
    invalidReason,
  };
}

function routeDispatchConfig() {
  const timeoutValue = Number(process.env[PROVIDER_TELEMETRY_ALERT_ROUTE_DISPATCH_TIMEOUT_ENV] ?? "");
  const timeoutMs = Number.isFinite(timeoutValue)
    ? Math.min(Math.max(Math.floor(timeoutValue), 100), 60_000)
    : PROVIDER_TELEMETRY_ALERTS_ROUTE_DISPATCH_TIMEOUT_MS;
  const raw = process.env[PROVIDER_TELEMETRY_ALERT_ROUTE_SINKS_ENV]?.trim() ?? "";
  if (!raw) {
    return {
      configured: false,
      invalidReason: null,
      timeoutMs,
      sinks: [],
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      configured: true,
      invalidReason: `JSON inválido em ${PROVIDER_TELEMETRY_ALERT_ROUTE_SINKS_ENV}: ${errorMessage(error)}`,
      timeoutMs,
      sinks: [],
    };
  }
  if (!Array.isArray(parsed)) {
    return {
      configured: true,
      invalidReason: `${PROVIDER_TELEMETRY_ALERT_ROUTE_SINKS_ENV} deve ser uma lista de sinks.`,
      timeoutMs,
      sinks: [],
    };
  }
  const sinks = [];
  for (let index = 0; index < parsed.length; index += 1) {
    const sink = normalizeRouteSink(parsed[index], index);
    if (sink.invalidReason) {
      return {
        configured: true,
        invalidReason: sink.invalidReason,
        timeoutMs,
        sinks: [],
      };
    }
    if (sink.value) {
      sinks.push(sink.value);
    }
  }
  return {
    configured: true,
    invalidReason: null,
    timeoutMs,
    sinks,
  };
}

function normalizeRouteSink(value, index) {
  if (!isRecord(value)) {
    return { value: null, invalidReason: null };
  }
  const route = readRoute(value.route);
  if (!route) {
    return {
      value: null,
      invalidReason: `Sink ${index + 1} em ${PROVIDER_TELEMETRY_ALERT_ROUTE_SINKS_ENV} precisa de route válido.`,
    };
  }
  const urlValue = readString(value.url);
  if (!urlValue) {
    return {
      value: null,
      invalidReason: `Sink ${route} precisa de url HTTP/HTTPS.`,
    };
  }
  let url;
  try {
    url = validateCentralUrl(urlValue);
  } catch (error) {
    return {
      value: null,
      invalidReason: errorMessage(error),
    };
  }
  const tokenEnv = readEnvName(value.tokenEnv);
  return {
    value: {
      route,
      label: readString(value.label) ?? routeLabel(route),
      url,
      tokenEnv,
      token: tokenEnv ? process.env[tokenEnv]?.trim() || null : null,
    },
    invalidReason: null,
  };
}

function buildCentralSyncStatus(config, sync = {}) {
  return {
    format: PROVIDER_TELEMETRY_ALERTS_CENTRAL_STATUS_FORMAT,
    generatedAt: new Date().toISOString(),
    configured: Boolean(config.url && !config.invalidReason),
    urlConfigured: Boolean(process.env[PROVIDER_TELEMETRY_ALERTS_CENTRAL_URL_ENV]?.trim()),
    tokenConfigured: Boolean(config.token),
    timeoutMs: config.timeoutMs,
    invalidReason: config.invalidReason,
    lastSyncedAt: sync.lastSyncedAt ?? null,
    statusCode: sync.statusCode ?? null,
    pushedAlertCount: sync.pushedAlertCount ?? null,
    pulledAlertCount: sync.pulledAlertCount ?? null,
    error: sync.error ?? null,
    governance: {
      excludesRawRunEvents: true,
      excludesSecretValues: true,
      sendsProviderMetrics: true,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
      storesCentralToken: false,
      configuredUrlEnv: PROVIDER_TELEMETRY_ALERTS_CENTRAL_URL_ENV,
      configuredTokenEnv: PROVIDER_TELEMETRY_ALERTS_CENTRAL_TOKEN_ENV,
      configuredTimeoutEnv: PROVIDER_TELEMETRY_ALERTS_CENTRAL_TIMEOUT_ENV,
      maxPayloadBytes: PROVIDER_TELEMETRY_ALERTS_CENTRAL_MAX_BYTES,
    },
  };
}

function buildRouteDispatchStatus(config, dispatch = {}) {
  const escalationPolicy = providerTelemetryAlertEscalationPolicy();
  const deliveryPolicy = providerTelemetryAlertDeliveryPolicy();
  return {
    format: PROVIDER_TELEMETRY_ALERTS_ROUTE_DISPATCH_STATUS_FORMAT,
    generatedAt: new Date().toISOString(),
    configured: config.configured && config.sinks.length > 0 && !config.invalidReason,
    sinkCount: config.sinks.length,
    timeoutMs: config.timeoutMs,
    invalidReason: config.invalidReason,
    lastDispatchedAt: dispatch.lastDispatchedAt ?? null,
    attemptedRouteCount: dispatch.attemptedRouteCount ?? null,
    sentAlertCount: dispatch.sentAlertCount ?? null,
    skippedAlertCount: dispatch.skippedAlertCount ?? null,
    errorCount: dispatch.errorCount ?? null,
    routes: config.sinks.map((sink) => ({
      route: sink.route,
      label: sink.label,
      tokenConfigured: Boolean(sink.token),
      tokenEnvConfigured: Boolean(sink.tokenEnv),
    })),
    escalationPolicy: escalationPolicySummary(escalationPolicy),
    deliveryPolicy: deliveryPolicySummary(deliveryPolicy),
    governance: routeDispatchGovernance(),
  };
}

function routeDispatchGovernance() {
  return {
    excludesRawRunEvents: true,
    excludesSecretValues: true,
    sendsProviderMetrics: true,
    routeSinkUrlsInStatus: false,
    routeSinkUrlsInDispatchResult: false,
    routeTokensInHeaderOnly: true,
    routeTokensInBody: false,
    storesRouteSinkUrls: false,
    storesRouteTokens: false,
    storesEscalationSecrets: false,
    configuredSinksEnv: PROVIDER_TELEMETRY_ALERT_ROUTE_SINKS_ENV,
    configuredTimeoutEnv: PROVIDER_TELEMETRY_ALERT_ROUTE_DISPATCH_TIMEOUT_ENV,
    configuredEscalationPolicyEnv: PROVIDER_TELEMETRY_ALERT_ESCALATION_POLICY_ENV,
    configuredDeliveryPolicyEnv: PROVIDER_TELEMETRY_ALERT_DELIVERY_POLICY_ENV,
    maxPayloadBytes: PROVIDER_TELEMETRY_ALERTS_CENTRAL_MAX_BYTES,
  };
}

async function dispatchRouteAlerts(config, sink, flowId, route, deliveryPlan) {
  const prioritizedAlerts = sortDispatchAlerts(deliveryPlan.alerts);
  const body = JSON.stringify({
    format: PROVIDER_TELEMETRY_ALERTS_ROUTE_DISPATCH_REQUEST_FORMAT,
    generatedAt: new Date().toISOString(),
    flowId,
    route: route.route,
    label: route.label,
    alertCount: prioritizedAlerts.length,
    openCount: prioritizedAlerts.length,
    availableOpenCount: deliveryPlan.availableOpenCount,
    skippedByPolicyCount: deliveryPlan.skippedByPolicyCount,
    maxDispatchPriority: prioritizedAlerts.reduce(
      (max, alert) => Math.max(max, readNonNegativeInteger(alert.dispatchPriority, 0)),
      0,
    ),
    escalationBreakdown: escalationBreakdown(prioritizedAlerts),
    deliveryPolicy: deliveryPlan.summary,
    alerts: buildPackage(flowId, prioritizedAlerts, {
      action: "dispatch",
      incomingCount: prioritizedAlerts.length,
      existingCount: prioritizedAlerts.length,
      addedCount: 0,
      updatedCount: 0,
      unchangedCount: prioritizedAlerts.length,
      finalCount: prioritizedAlerts.length,
    }),
    governance: routeDispatchGovernance(),
  });
  if (Buffer.byteLength(body, "utf-8") > PROVIDER_TELEMETRY_ALERTS_CENTRAL_MAX_BYTES) {
    return {
      route: route.route,
      label: route.label,
      configured: true,
      status: "error",
      statusCode: null,
      alertCount: prioritizedAlerts.length,
      openCount: prioritizedAlerts.length,
      availableOpenCount: deliveryPlan.availableOpenCount,
      skippedByPolicyCount: deliveryPlan.skippedByPolicyCount,
      maxDispatchPriority: prioritizedAlerts.reduce(
        (max, alert) => Math.max(max, readNonNegativeInteger(alert.dispatchPriority, 0)),
        0,
      ),
      escalationBreakdown: escalationBreakdown(prioritizedAlerts),
      deliveryPolicy: deliveryPlan.summary,
      deliveredAt: null,
      error: "Payload de envio excede o limite permitido.",
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const headers = {
      accept: "application/json",
      "content-type": "application/json",
    };
    if (sink.token) {
      headers.authorization = `Bearer ${sink.token}`;
    }
    const response = await fetch(sink.url, {
      method: "POST",
      signal: controller.signal,
      headers,
      body,
      redirect: "follow",
    });
    return {
      route: route.route,
      label: route.label,
      configured: true,
      status: response.ok ? "sent" : "error",
      statusCode: response.status,
      alertCount: prioritizedAlerts.length,
      openCount: prioritizedAlerts.length,
      availableOpenCount: deliveryPlan.availableOpenCount,
      skippedByPolicyCount: deliveryPlan.skippedByPolicyCount,
      maxDispatchPriority: prioritizedAlerts.reduce(
        (max, alert) => Math.max(max, readNonNegativeInteger(alert.dispatchPriority, 0)),
        0,
      ),
      escalationBreakdown: escalationBreakdown(prioritizedAlerts),
      deliveryPolicy: deliveryPlan.summary,
      deliveredAt: new Date().toISOString(),
      error: response.ok ? null : `Sink respondeu HTTP ${response.status}.`,
    };
  } catch (error) {
    return {
      route: route.route,
      label: route.label,
      configured: true,
      status: "error",
      statusCode: null,
      alertCount: prioritizedAlerts.length,
      openCount: prioritizedAlerts.length,
      availableOpenCount: deliveryPlan.availableOpenCount,
      skippedByPolicyCount: deliveryPlan.skippedByPolicyCount,
      maxDispatchPriority: prioritizedAlerts.reduce(
        (max, alert) => Math.max(max, readNonNegativeInteger(alert.dispatchPriority, 0)),
        0,
      ),
      escalationBreakdown: escalationBreakdown(prioritizedAlerts),
      deliveryPolicy: deliveryPlan.summary,
      deliveredAt: null,
      error: isRecord(error) && error.name === "AbortError" ? "Timeout ao enviar alertas da rota." : errorMessage(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCentralSync(config, flowId, alerts) {
  if (!config.url) {
    throw new WorkspaceError("Central de alertas de telemetria não configurada.", 400);
  }
  const body = JSON.stringify({
    format: PROVIDER_TELEMETRY_ALERTS_CENTRAL_SYNC_REQUEST_FORMAT,
    generatedAt: new Date().toISOString(),
    flowId,
    alerts,
    alertCount: alerts.alertCount,
    governance: {
      excludesRawRunEvents: true,
      excludesSecretValues: true,
      sendsProviderMetrics: true,
      centralAuthTokenInHeaderOnly: true,
      centralAuthTokenInBody: false,
    },
  });
  if (Buffer.byteLength(body, "utf-8") > PROVIDER_TELEMETRY_ALERTS_CENTRAL_MAX_BYTES) {
    throw new WorkspaceError("Inbox de alertas de telemetria excede o limite de tamanho permitido para sync central.", 413);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const headers = {
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
    if (Number.isFinite(contentLength) && contentLength > PROVIDER_TELEMETRY_ALERTS_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central de alertas de telemetria excede o limite de tamanho permitido.", 413);
    }
    if (!response.ok) {
      throw new WorkspaceError(`Central de alertas de telemetria respondeu HTTP ${response.status}.`, response.status);
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > PROVIDER_TELEMETRY_ALERTS_CENTRAL_MAX_BYTES) {
      throw new WorkspaceError("Resposta central de alertas de telemetria excede o limite de tamanho permitido.", 413);
    }
    return {
      statusCode: response.status,
      body: Buffer.from(buffer).toString("utf-8"),
    };
  } catch (error) {
    if (isRecord(error) && error.name === "AbortError") {
      throw new WorkspaceError("Timeout ao sincronizar central de alertas de telemetria.", 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function validateCentralUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new WorkspaceError(`${PROVIDER_TELEMETRY_ALERTS_CENTRAL_URL_ENV} deve ser uma URL HTTP/HTTPS válida.`, 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WorkspaceError(`${PROVIDER_TELEMETRY_ALERTS_CENTRAL_URL_ENV} deve usar http ou https.`, 400);
  }
  return parsed.toString();
}

function normalizePackage(value, fallbackFlowId, action) {
  if (!isRecord(value) || value.format !== "agent-flow-builder.provider-telemetry-alerts.v1" || !Array.isArray(value.items)) {
    return null;
  }
  const flowId = readString(value.flowId) ?? fallbackFlowId;
  const items = syncItems(value.items.map((item) => normalizeItem(item, flowId)).filter(Boolean));
  return buildPackage(flowId, items, {
    action,
    incomingCount: items.length,
    existingCount: 0,
    addedCount: items.length,
    updatedCount: 0,
    unchangedCount: 0,
    finalCount: items.length,
  });
}

function buildPackage(flowId, items, stats) {
  const routingPolicy = providerTelemetryAlertRoutingPolicy();
  const escalationPolicy = providerTelemetryAlertEscalationPolicy();
  const normalized = syncItems(
    items
      .map((item) => applyRoutingPolicy(item, routingPolicy))
      .map((item) => applyEscalationPolicy(item, escalationPolicy)),
  ).slice(
    0,
    MAX_PROVIDER_TELEMETRY_ALERTS,
  );
  const withoutHash = {
    format: "agent-flow-builder.provider-telemetry-alerts.v1",
    exportedAt: new Date().toISOString(),
    flowId,
    retentionPolicy: {
      mode: "shared-file",
      source: "provider-telemetry",
      excludesRawRunEvents: true,
      excludesSecretValues: true,
    },
    routingPolicy: routingPolicySummary(routingPolicy),
    escalationPolicy: escalationPolicySummary(escalationPolicy),
    routeBreakdown: routeBreakdown(normalized),
    escalationBreakdown: escalationBreakdown(normalized),
    alertCount: normalized.length,
    openCount: normalized.filter((item) => item.status === "open").length,
    items: normalized,
  };
  return {
    ...withoutHash,
    packageHash: shortHash(stableStringify(withoutHash)),
    sharedSync: {
      action: stats.action,
      updatedAt: new Date().toISOString(),
      storage: PROVIDER_TELEMETRY_ALERTS_FILE,
      contentHash: shortHash(stableStringify({ flowId, items: normalized })),
      incomingCount: stats.incomingCount,
      existingCount: stats.existingCount,
      addedCount: stats.addedCount,
      updatedCount: stats.updatedCount,
      unchangedCount: stats.unchangedCount,
      finalCount: normalized.length,
      governance: {
        excludesRawRunEvents: true,
        excludesSecretValues: true,
        routesAreLogicalChannels: true,
        storesRouteWebhookUrls: false,
        storesEscalationSecrets: false,
      },
    },
  };
}

function mergeItems(existingItems, incomingItems) {
  const existing = syncItems(existingItems);
  const incoming = syncItems(incomingItems);
  const byId = new Map(existing.map((item) => [String(item.id), item]));
  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  for (const incomingItem of incoming) {
    const current = byId.get(String(incomingItem.id));
    if (!current) {
      byId.set(String(incomingItem.id), incomingItem);
      addedCount += 1;
      continue;
    }
    const selected = selectFresherItem(current, incomingItem);
    if (stableStringify(selected) === stableStringify(current)) {
      unchangedCount += 1;
    } else {
      byId.set(String(incomingItem.id), selected);
      updatedCount += 1;
    }
  }
  const items = syncItems(Array.from(byId.values()));
  return {
    items,
    stats: {
      incomingCount: incoming.length,
      existingCount: existing.length,
      addedCount,
      updatedCount,
      unchangedCount,
      finalCount: items.length,
    },
  };
}

function compareItems(existingItems, incomingItems) {
  const existingById = new Map(syncItems(existingItems).map((item) => [String(item.id), item]));
  const incoming = syncItems(incomingItems);
  let addedCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  for (const item of incoming) {
    const existing = existingById.get(String(item.id));
    if (!existing) {
      addedCount += 1;
    } else if (stableStringify(existing) === stableStringify(item)) {
      unchangedCount += 1;
    } else {
      updatedCount += 1;
    }
  }
  return {
    incomingCount: incoming.length,
    existingCount: existingById.size,
    addedCount,
    updatedCount,
    unchangedCount,
    finalCount: incoming.length,
  };
}

function syncItems(items) {
  const now = Date.now();
  const byId = new Map();
  for (const item of items) {
    const retainedUntil = Date.parse(String(item.retainedUntil ?? ""));
    if (Number.isFinite(retainedUntil) && retainedUntil < now) {
      continue;
    }
    const id = String(item.id ?? "");
    if (!id) {
      continue;
    }
    const current = byId.get(id);
    byId.set(id, current ? selectFresherItem(current, item) : item);
  }
  return Array.from(byId.values()).sort((left, right) => itemFreshness(right) - itemFreshness(left));
}

function selectFresherItem(left, right) {
  const leftFreshness = itemFreshness(left);
  const rightFreshness = itemFreshness(right);
  if (rightFreshness > leftFreshness) {
    return right;
  }
  if (leftFreshness > rightFreshness) {
    return left;
  }
  if (left.status === "acknowledged" && right.status === "open") {
    return left;
  }
  if (right.status === "acknowledged" && left.status === "open") {
    return right;
  }
  return readPositiveInteger(right.occurrenceCount, 1) > readPositiveInteger(left.occurrenceCount, 1) ? right : left;
}

function itemFreshness(item) {
  return Math.max(parsedTime(item.acknowledgedAt), parsedTime(item.lastSeenAt), parsedTime(item.firstSeenAt));
}

function normalizeItem(value, fallbackFlowId) {
  if (!isRecord(value)) {
    return null;
  }
  const provider = readString(value.provider);
  const model = readString(value.model);
  const metric = value.metric === "cost" || value.metric === "tokens" ? value.metric : null;
  if (!provider || !model || !metric) {
    return null;
  }
  const flowId = readString(value.flowId) ?? fallbackFlowId;
  const now = new Date().toISOString();
  const route = readRoute(value.route) ?? "local-inbox";
  const status = value.status === "acknowledged" ? "acknowledged" : "open";
  const acknowledgedRole = status === "acknowledged" ? normalizeReviewerRole(value.acknowledgedRole) : null;
  assertProviderTelemetryAlertAcknowledgementAllowed(acknowledgedRole);
  return {
    id: readString(value.id) ?? `provider-alert-${shortHash(`${flowId}|${provider}|${model}|${metric}`)}`,
    flowId,
    source: "provider-telemetry",
    route,
    routeLabel: readString(value.routeLabel) ?? routeLabel(route),
    routingRuleId: readString(value.routingRuleId),
    routingReason: readString(value.routingReason) ?? "Sem regra de roteamento aplicada.",
    escalationLevel: normalizeEscalationLevel(value.escalationLevel) ?? "normal",
    escalationRuleId: readString(value.escalationRuleId),
    escalationReason: readString(value.escalationReason) ?? "Sem regra de escalonamento aplicada.",
    dispatchPriority: readNonNegativeInteger(value.dispatchPriority, 0),
    escalatedAt: readIsoDate(value.escalatedAt),
    lastDispatchedAt: readIsoDate(value.lastDispatchedAt),
    dispatchCount: readNonNegativeInteger(value.dispatchCount, 0),
    status,
    severity: "warning",
    provider,
    model,
    metric,
    observed: readFiniteNumber(value.observed, 0),
    limit: readFiniteNumber(value.limit, 0),
    message: readString(value.message) ?? `${provider}/${model} excedeu limite de ${metric}.`,
    windowHours: readNullableNumber(value.windowHours),
    firstSeenAt: readIsoDate(value.firstSeenAt) ?? now,
    lastSeenAt: readIsoDate(value.lastSeenAt) ?? now,
    acknowledgedAt: status === "acknowledged" ? readIsoDate(value.acknowledgedAt) ?? now : null,
    acknowledgedBy:
      status === "acknowledged" ? readString(value.acknowledgedBy) ?? readString(value.acknowledgedActor) ?? "local-studio" : null,
    acknowledgedRole,
    occurrenceCount: readPositiveInteger(value.occurrenceCount, 1),
    retainedUntil: readIsoDate(value.retainedUntil) ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

function normalizeReviewerRole(value) {
  if (value === "owner" || value === "operator" || value === "viewer") {
    return value;
  }
  return "reviewer";
}

function assertProviderTelemetryAlertAcknowledgementAllowed(role) {
  if (role !== "viewer") {
    return;
  }
  throw new WorkspaceError("Viewer não pode reconhecer alertas de telemetria.", 403, {
    code: "provider_telemetry_alert_acknowledgement_viewer_forbidden",
    role,
    requiredRole: "reviewer",
  });
}

function providerTelemetryAlertRoutingPolicy() {
  const raw = process.env[PROVIDER_TELEMETRY_ALERT_ROUTES_ENV]?.trim() ?? "";
  if (!raw) {
    return {
      configured: false,
      invalidReason: null,
      rules: [],
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      configured: true,
      invalidReason: `JSON inválido em ${PROVIDER_TELEMETRY_ALERT_ROUTES_ENV}: ${errorMessage(error)}`,
      rules: [],
    };
  }
  if (!Array.isArray(parsed)) {
    return {
      configured: true,
      invalidReason: `${PROVIDER_TELEMETRY_ALERT_ROUTES_ENV} deve ser uma lista de regras.`,
      rules: [],
    };
  }
  const rules = parsed.map((rule, index) => normalizeRoutingRule(rule, index)).filter(Boolean);
  return {
    configured: true,
    invalidReason: null,
    rules,
  };
}

function normalizeRoutingRule(value, index) {
  if (!isRecord(value)) {
    return null;
  }
  const route = readRoute(value.route);
  if (!route) {
    return null;
  }
  const id = readRoute(value.id) ?? `route-rule-${index + 1}`;
  const metric = value.metric === "cost" || value.metric === "tokens" ? value.metric : null;
  const minObservedPct = readFiniteOptionalNumber(value.minObservedPct);
  const minObserved = readFiniteOptionalNumber(value.minObserved);
  return {
    id,
    route,
    label: readString(value.label) ?? routeLabel(route),
    provider: readString(value.provider)?.toLowerCase() ?? null,
    model: readString(value.model)?.toLowerCase() ?? null,
    metric,
    minObservedPct: minObservedPct === null ? null : Math.max(0, minObservedPct),
    minObserved: minObserved === null ? null : Math.max(0, minObserved),
  };
}

function applyRoutingPolicy(item, routingPolicy) {
  const rule = routingPolicy.rules.find((candidate) => routingRuleMatches(candidate, item));
  if (!rule) {
    return {
      ...item,
      route: readRoute(item.route) ?? "local-inbox",
      routeLabel: readString(item.routeLabel) ?? routeLabel(item.route),
      routingRuleId: readString(item.routingRuleId),
      routingReason: readString(item.routingReason) ?? "Sem regra de roteamento aplicada.",
    };
  }
  return {
    ...item,
    route: rule.route,
    routeLabel: rule.label,
    routingRuleId: rule.id,
    routingReason: routingRuleReason(rule, item),
  };
}

function routingRuleMatches(rule, item) {
  if (rule.provider && rule.provider !== String(item.provider ?? "").toLowerCase()) {
    return false;
  }
  if (rule.model && rule.model !== String(item.model ?? "").toLowerCase()) {
    return false;
  }
  if (rule.metric && rule.metric !== item.metric) {
    return false;
  }
  if (rule.minObserved !== null && readFiniteNumber(item.observed, 0) < rule.minObserved) {
    return false;
  }
  if (rule.minObservedPct !== null) {
    const limit = readFiniteNumber(item.limit, 0);
    if (limit <= 0) {
      return false;
    }
    const observedPct = (readFiniteNumber(item.observed, 0) / limit) * 100;
    if (observedPct < rule.minObservedPct) {
      return false;
    }
  }
  return true;
}

function routingRuleReason(rule, item) {
  const pieces = [];
  if (rule.metric) {
    pieces.push(`metric=${rule.metric}`);
  }
  if (rule.provider) {
    pieces.push(`provider=${rule.provider}`);
  }
  if (rule.model) {
    pieces.push(`model=${rule.model}`);
  }
  if (rule.minObserved !== null) {
    pieces.push(`observed>=${rule.minObserved}`);
  }
  if (rule.minObservedPct !== null) {
    pieces.push(`usage>=${rule.minObservedPct}%`);
  }
  return pieces.length
    ? `Regra ${rule.id} aplicada (${pieces.join(", ")}).`
    : `Regra ${rule.id} aplicada ao alerta ${item.metric}.`;
}

function routingPolicySummary(routingPolicy) {
  return {
    configured: routingPolicy.configured,
    invalidReason: routingPolicy.invalidReason,
    ruleCount: routingPolicy.rules.length,
    rules: routingPolicy.rules.map((rule) => ({
      id: rule.id,
      route: rule.route,
      label: rule.label,
      provider: rule.provider,
      model: rule.model,
      metric: rule.metric,
      minObservedPct: rule.minObservedPct,
      minObserved: rule.minObserved,
    })),
    governance: {
      configuredRulesEnv: PROVIDER_TELEMETRY_ALERT_ROUTES_ENV,
      routesAreLogicalChannels: true,
      storesRouteWebhookUrls: false,
      storesRouteSecrets: false,
    },
  };
}

function providerTelemetryAlertEscalationPolicy() {
  const raw = process.env[PROVIDER_TELEMETRY_ALERT_ESCALATION_POLICY_ENV]?.trim() ?? "";
  if (!raw) {
    return {
      configured: false,
      invalidReason: null,
      rules: [],
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      configured: true,
      invalidReason: `JSON inválido em ${PROVIDER_TELEMETRY_ALERT_ESCALATION_POLICY_ENV}: ${errorMessage(error)}`,
      rules: [],
    };
  }
  const rawRules = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.rules)
      ? parsed.rules
      : null;
  if (!rawRules) {
    return {
      configured: true,
      invalidReason: `${PROVIDER_TELEMETRY_ALERT_ESCALATION_POLICY_ENV} deve ser uma lista de regras ou { rules: [...] }.`,
      rules: [],
    };
  }
  const rules = rawRules.map((rule, index) => normalizeEscalationRule(rule, index)).filter(Boolean);
  return {
    configured: true,
    invalidReason: null,
    rules,
  };
}

function normalizeEscalationRule(value, index) {
  if (!isRecord(value)) {
    return null;
  }
  const level = normalizeEscalationLevel(value.level);
  if (!level || level === "normal") {
    return null;
  }
  const id = readRoute(value.id) ?? `escalation-rule-${index + 1}`;
  const metric = value.metric === "cost" || value.metric === "tokens" ? value.metric : null;
  const minObservedPct = readFiniteOptionalNumber(value.minObservedPct);
  const minObserved = readFiniteOptionalNumber(value.minObserved);
  const minOccurrences = readNonNegativeInteger(value.minOccurrences, 0);
  const minAgeMinutes = readNonNegativeInteger(value.minAgeMinutes, 0);
  const dispatchPriority = readNonNegativeInteger(value.dispatchPriority, escalationPriorityForLevel(level));
  return {
    id,
    level,
    dispatchPriority,
    label: readString(value.label) ?? escalationLevelLabel(level),
    route: readRoute(value.route),
    provider: readString(value.provider)?.toLowerCase() ?? null,
    model: readString(value.model)?.toLowerCase() ?? null,
    metric,
    minObservedPct: minObservedPct === null ? null : Math.max(0, minObservedPct),
    minObserved: minObserved === null ? null : Math.max(0, minObserved),
    minOccurrences,
    minAgeMinutes,
  };
}

function applyEscalationPolicy(item, escalationPolicy) {
  const rule = escalationPolicy.rules.find((candidate) => escalationRuleMatches(candidate, item));
  if (!rule) {
    return {
      ...item,
      escalationLevel: "normal",
      escalationRuleId: null,
      escalationReason: "Sem regra de escalonamento aplicada.",
      dispatchPriority: 0,
      escalatedAt: null,
    };
  }
  return {
    ...item,
    escalationLevel: rule.level,
    escalationRuleId: rule.id,
    escalationReason: escalationRuleReason(rule, item),
    dispatchPriority: rule.dispatchPriority,
    escalatedAt: readIsoDate(item.escalatedAt) ?? readIsoDate(item.lastSeenAt) ?? readIsoDate(item.firstSeenAt),
  };
}

function escalationRuleMatches(rule, item) {
  if (rule.route && rule.route !== (readRoute(item.route) ?? "local-inbox")) {
    return false;
  }
  if (rule.provider && rule.provider !== String(item.provider ?? "").toLowerCase()) {
    return false;
  }
  if (rule.model && rule.model !== String(item.model ?? "").toLowerCase()) {
    return false;
  }
  if (rule.metric && rule.metric !== item.metric) {
    return false;
  }
  if (rule.minOccurrences > 0 && readPositiveInteger(item.occurrenceCount, 1) < rule.minOccurrences) {
    return false;
  }
  if (rule.minObserved !== null && readFiniteNumber(item.observed, 0) < rule.minObserved) {
    return false;
  }
  if (rule.minObservedPct !== null) {
    const limit = readFiniteNumber(item.limit, 0);
    if (limit <= 0) {
      return false;
    }
    const observedPct = (readFiniteNumber(item.observed, 0) / limit) * 100;
    if (observedPct < rule.minObservedPct) {
      return false;
    }
  }
  if (rule.minAgeMinutes > 0) {
    const firstSeen = parsedTime(item.firstSeenAt);
    if (!firstSeen || Date.now() - firstSeen < rule.minAgeMinutes * 60_000) {
      return false;
    }
  }
  return true;
}

function escalationRuleReason(rule, item) {
  const pieces = [];
  if (rule.route) {
    pieces.push(`route=${rule.route}`);
  }
  if (rule.metric) {
    pieces.push(`metric=${rule.metric}`);
  }
  if (rule.provider) {
    pieces.push(`provider=${rule.provider}`);
  }
  if (rule.model) {
    pieces.push(`model=${rule.model}`);
  }
  if (rule.minObserved !== null) {
    pieces.push(`observed>=${rule.minObserved}`);
  }
  if (rule.minObservedPct !== null) {
    pieces.push(`usage>=${rule.minObservedPct}%`);
  }
  if (rule.minOccurrences > 0) {
    pieces.push(`occurrences>=${rule.minOccurrences}`);
  }
  if (rule.minAgeMinutes > 0) {
    pieces.push(`age>=${rule.minAgeMinutes}m`);
  }
  return pieces.length
    ? `Regra ${rule.id} escalou para ${rule.level} (${pieces.join(", ")}).`
    : `Regra ${rule.id} escalou o alerta ${item.metric} para ${rule.level}.`;
}

function escalationPolicySummary(escalationPolicy) {
  return {
    configured: escalationPolicy.configured,
    invalidReason: escalationPolicy.invalidReason,
    ruleCount: escalationPolicy.rules.length,
    rules: escalationPolicy.rules.map((rule) => ({
      id: rule.id,
      level: rule.level,
      label: rule.label,
      dispatchPriority: rule.dispatchPriority,
      route: rule.route,
      provider: rule.provider,
      model: rule.model,
      metric: rule.metric,
      minObservedPct: rule.minObservedPct,
      minObserved: rule.minObserved,
      minOccurrences: rule.minOccurrences,
      minAgeMinutes: rule.minAgeMinutes,
    })),
    governance: {
      configuredPolicyEnv: PROVIDER_TELEMETRY_ALERT_ESCALATION_POLICY_ENV,
      storesEscalationSecrets: false,
      storesRouteWebhookUrls: false,
      storesRouteTokens: false,
    },
  };
}

function escalationBreakdown(items) {
  const byLevel = new Map();
  for (const item of items) {
    const level = normalizeEscalationLevel(item.escalationLevel) ?? "normal";
    const current = byLevel.get(level) ?? {
      level,
      label: escalationLevelLabel(level),
      alertCount: 0,
      openCount: 0,
      maxDispatchPriority: 0,
    };
    current.alertCount += 1;
    if (item.status === "open") {
      current.openCount += 1;
    }
    current.maxDispatchPriority = Math.max(current.maxDispatchPriority, readNonNegativeInteger(item.dispatchPriority, 0));
    byLevel.set(level, current);
  }
  return Array.from(byLevel.values()).sort((left, right) => {
    const priorityDelta = escalationPriorityForLevel(right.level) - escalationPriorityForLevel(left.level);
    return priorityDelta || right.openCount - left.openCount || right.alertCount - left.alertCount;
  });
}

function normalizeEscalationLevel(value) {
  const raw = readString(value)?.toLowerCase();
  if (raw === "watch" || raw === "escalated" || raw === "critical" || raw === "normal") {
    return raw;
  }
  return null;
}

function escalationPriorityForLevel(level) {
  if (level === "critical") {
    return 300;
  }
  if (level === "escalated") {
    return 200;
  }
  if (level === "watch") {
    return 100;
  }
  return 0;
}

function escalationLevelLabel(level) {
  if (level === "critical") {
    return "Crítico";
  }
  if (level === "escalated") {
    return "Escalado";
  }
  if (level === "watch") {
    return "Observação";
  }
  return "Normal";
}

function providerTelemetryAlertDeliveryPolicy() {
  const raw = process.env[PROVIDER_TELEMETRY_ALERT_DELIVERY_POLICY_ENV]?.trim() ?? "";
  if (!raw) {
    return {
      configured: false,
      invalidReason: null,
      maxAlertsPerRoute: null,
      minDispatchPriority: 0,
      cooldownMinutes: 0,
      rules: [],
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      configured: true,
      invalidReason: `JSON inválido em ${PROVIDER_TELEMETRY_ALERT_DELIVERY_POLICY_ENV}: ${errorMessage(error)}`,
      maxAlertsPerRoute: null,
      minDispatchPriority: 0,
      cooldownMinutes: 0,
      rules: [],
    };
  }
  if (!isRecord(parsed)) {
    return {
      configured: true,
      invalidReason: `${PROVIDER_TELEMETRY_ALERT_DELIVERY_POLICY_ENV} deve ser um objeto JSON.`,
      maxAlertsPerRoute: null,
      minDispatchPriority: 0,
      cooldownMinutes: 0,
      rules: [],
    };
  }
  const rules = Array.isArray(parsed.rules)
    ? parsed.rules.map((rule, index) => normalizeDeliveryRule(rule, index)).filter(Boolean)
    : [];
  return {
    configured: true,
    invalidReason: null,
    maxAlertsPerRoute: readPositiveOptionalInteger(parsed.maxAlertsPerRoute),
    minDispatchPriority: readNonNegativeInteger(parsed.minDispatchPriority, 0),
    cooldownMinutes: readNonNegativeInteger(parsed.cooldownMinutes, 0),
    rules,
  };
}

function normalizeDeliveryRule(value, index) {
  if (!isRecord(value)) {
    return null;
  }
  const route = readRoute(value.route);
  if (!route) {
    return null;
  }
  return {
    id: readRoute(value.id) ?? `delivery-rule-${index + 1}`,
    route,
    maxAlertsPerRoute: readPositiveOptionalInteger(value.maxAlertsPerRoute),
    minDispatchPriority: readNonNegativeInteger(value.minDispatchPriority, 0),
    cooldownMinutes: readNonNegativeInteger(value.cooldownMinutes, 0),
  };
}

function deliveryPolicySummary(deliveryPolicy) {
  return {
    configured: deliveryPolicy.configured,
    invalidReason: deliveryPolicy.invalidReason,
    maxAlertsPerRoute: deliveryPolicy.maxAlertsPerRoute,
    minDispatchPriority: deliveryPolicy.minDispatchPriority,
    cooldownMinutes: deliveryPolicy.cooldownMinutes,
    ruleCount: deliveryPolicy.rules.length,
    rules: deliveryPolicy.rules.map((rule) => ({
      id: rule.id,
      route: rule.route,
      maxAlertsPerRoute: rule.maxAlertsPerRoute,
      minDispatchPriority: rule.minDispatchPriority,
      cooldownMinutes: rule.cooldownMinutes,
    })),
    governance: {
      configuredPolicyEnv: PROVIDER_TELEMETRY_ALERT_DELIVERY_POLICY_ENV,
      storesDeliverySecrets: false,
      storesRouteWebhookUrls: false,
      storesRouteTokens: false,
    },
  };
}

function effectiveDeliveryPolicyForRoute(route, deliveryPolicy) {
  const routeRule = deliveryPolicy.rules.find((rule) => rule.route === route.route);
  return {
    configured: deliveryPolicy.configured,
    route: route.route,
    maxAlertsPerRoute: routeRule?.maxAlertsPerRoute ?? deliveryPolicy.maxAlertsPerRoute,
    minDispatchPriority: routeRule?.minDispatchPriority ?? deliveryPolicy.minDispatchPriority,
    cooldownMinutes: routeRule?.cooldownMinutes ?? deliveryPolicy.cooldownMinutes,
    ruleId: routeRule?.id ?? null,
  };
}

function planRouteDelivery(alerts, route, deliveryPolicy) {
  const effectivePolicy = effectiveDeliveryPolicyForRoute(route, deliveryPolicy);
  const sorted = sortDispatchAlerts(alerts);
  const eligible = sorted.filter((alert) => deliveryPolicyAllowsAlert(alert, effectivePolicy));
  const selected =
    effectivePolicy.maxAlertsPerRoute === null ? eligible : eligible.slice(0, effectivePolicy.maxAlertsPerRoute);
  return {
    alerts: selected,
    availableOpenCount: alerts.length,
    skippedByPolicyCount: Math.max(0, alerts.length - selected.length),
    summary: {
      configured: effectivePolicy.configured,
      route: effectivePolicy.route,
      ruleId: effectivePolicy.ruleId,
      maxAlertsPerRoute: effectivePolicy.maxAlertsPerRoute,
      minDispatchPriority: effectivePolicy.minDispatchPriority,
      cooldownMinutes: effectivePolicy.cooldownMinutes,
      availableOpenCount: alerts.length,
      eligibleCount: eligible.length,
      selectedCount: selected.length,
      skippedByPolicyCount: Math.max(0, alerts.length - selected.length),
    },
  };
}

function deliveryPolicyAllowsAlert(alert, effectivePolicy) {
  if (readNonNegativeInteger(alert.dispatchPriority, 0) < effectivePolicy.minDispatchPriority) {
    return false;
  }
  if (effectivePolicy.cooldownMinutes > 0) {
    const lastDispatchedAt = parsedTime(alert.lastDispatchedAt);
    if (lastDispatchedAt && Date.now() - lastDispatchedAt < effectivePolicy.cooldownMinutes * 60_000) {
      return false;
    }
  }
  return true;
}

function sortDispatchAlerts(alerts) {
  return alerts.slice().sort((left, right) => {
    const priorityDelta =
      readNonNegativeInteger(right.dispatchPriority, 0) - readNonNegativeInteger(left.dispatchPriority, 0);
    return priorityDelta || itemFreshness(right) - itemFreshness(left) || String(left.id).localeCompare(String(right.id));
  });
}

function routeBreakdown(items) {
  const byRoute = new Map();
  for (const item of items) {
    const route = readRoute(item.route) ?? "local-inbox";
    const current = byRoute.get(route) ?? {
      route,
      label: readString(item.routeLabel) ?? routeLabel(route),
      alertCount: 0,
      openCount: 0,
    };
    current.alertCount += 1;
    if (item.status === "open") {
      current.openCount += 1;
    }
    byRoute.set(route, current);
  }
  return Array.from(byRoute.values()).sort((left, right) => {
    const openDelta = right.openCount - left.openCount;
    return openDelta || right.alertCount - left.alertCount || left.route.localeCompare(right.route);
  });
}

function routeLabel(route) {
  const normalized = readRoute(route) ?? "local-inbox";
  if (normalized === "local-inbox") {
    return "Inbox local";
  }
  return normalized
    .split(/[-_.]+/g)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function readPackageItems(value) {
  return isRecord(value) && Array.isArray(value.items) ? value.items.filter(isRecord) : [];
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readRoute(value) {
  const raw = readString(value)?.toLowerCase() ?? null;
  if (!raw || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(raw)) {
    return null;
  }
  return raw;
}

function readEnvName(value) {
  const raw = readString(value);
  if (!raw || !/^[A-Z_][A-Z0-9_]{0,127}$/.test(raw)) {
    return null;
  }
  return raw;
}

function readIsoDate(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  return Number.isNaN(Date.parse(value)) ? null : value.trim();
}

function readFiniteNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readNullableNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readFiniteOptionalNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readPositiveInteger(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function readPositiveOptionalInteger(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function readNonNegativeInteger(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function parsedTime(value) {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function stableStringify(value) {
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

function shortHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileNotFound(error) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
