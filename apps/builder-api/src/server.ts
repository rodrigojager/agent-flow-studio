import path from "node:path";
import { pathToFileURL } from "node:url";
import fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { agentFlowJsonSchema, llmAdapterCatalog, runtimeManifestJsonSchema } from "@agent-flow-builder/flow-spec";
import {
  authenticateBuilderRequest,
  createBuilderAuthAuditStore,
  createBuilderAuthOidcFlowStore,
  createBuilderAuthOidcLoginUrl,
  createBuilderAuthOidcLogoutFlowStore,
  createBuilderAuthOidcLogoutUrl,
  createBuilderAuthSessionStore,
  completeBuilderAuthOidcCallback,
  completeBuilderAuthOidcLogoutCallback,
  disableBuilderAuthKey,
  builderAuthStatus,
  homologateBuilderAuthCorporateIntegrations,
  probeBuilderAuthExternalIntegrations,
  refreshBuilderAuthOidcSession,
  rotateBuilderAuthKey,
  type BuilderAuthAuditStatus,
} from "./builder-auth.ts";
import {
  compareCollaborationConflictOverview,
  loadCollaborationConflictOverview,
} from "./collaboration-conflicts.ts";
import {
  compareDebugLayerSnapshotConflictReview,
  loadDebugLayerSnapshots,
  loadDebugLayerSnapshotConflictReview,
  loadDebugLayerSnapshotsCentralSyncStatus,
  mergeDebugLayerSnapshots,
  resolveDebugLayerSnapshotConflict,
  saveDebugLayerSnapshots,
  syncCentralDebugLayerSnapshots,
  updateDebugLayerSnapshotConflictCuration,
} from "./debug-layer-snapshots.ts";
import {
  DockerRuntimeManager,
  type DockerCommandRunner,
  type DockerBuildProgressStatus,
  type DockerRuntimeGpuDetector,
  type DockerRuntimeHistoryLevel,
  type DockerRuntimeModelExecutionProfile,
  type DockerRuntimeOperation,
  type DockerRuntimeOperationStatus,
} from "./docker-runtime.ts";
import { evaluateExternalEvaluator } from "./evaluators.ts";
import {
  checkLocalLlmProviderStatus,
  listLlmAdapterModels,
  type LlmModelCatalogQuery,
  type LocalLlmProviderStatusQuery,
} from "./llm-local-provider.ts";
import { SandboxManager } from "./sandbox.ts";
import { checkVmRunnerReadiness } from "./vm-runner.ts";
import {
  compareSafetyHarnessHistory,
  evaluateSafetyHarness,
  loadSafetyHarnessCentralSyncStatus,
  listSafetyHarnessRuns,
  reviewSafetyHarnessRun,
  syncCentralSafetyHarness,
} from "./safety-harness.ts";
import {
  compareStudioAnnotationQueueConflictReview,
  curateStudioAnnotationQueueConflict,
  loadStudioAnnotationQueueConflictReview,
  loadStudioAnnotationQueueCentralSyncStatus,
  loadStudioAnnotationQueue,
  mergeStudioAnnotationQueue,
  saveStudioAnnotationQueue,
  syncCentralStudioAnnotationQueue,
} from "./annotation-queue.ts";
import {
  compareStudioExperimentDashboardHistory,
  loadStudioExperimentDashboardHistory,
  loadStudioExperimentDashboardHistoryCentralSyncStatus,
  mergeStudioExperimentDashboardHistory,
  saveStudioExperimentDashboardSnapshot,
  syncCentralStudioExperimentDashboardHistory,
} from "./experiment-dashboard.ts";
import {
  compareProviderTelemetryDashboardHistory,
  loadProviderTelemetryDashboardCentralSyncStatus,
  loadProviderTelemetryDashboardHistory,
  mergeProviderTelemetryDashboardHistory,
  saveProviderTelemetryDashboardSnapshot,
  syncCentralProviderTelemetryDashboardHistory,
} from "./provider-telemetry-dashboard.ts";
import {
  compareRuntimeJobMetricsHistory,
  loadRuntimeJobMetricsCentralSyncStatus,
  loadRuntimeJobMetricsHistory,
  mergeRuntimeJobMetricsHistory,
  saveRuntimeJobMetricsSnapshot,
  syncCentralRuntimeJobMetricsHistory,
} from "./runtime-job-metrics-history.ts";
import {
  compareOrchestrationDebugHistory,
  loadOrchestrationDebugHistory,
  loadOrchestrationDebugHistoryCentralSyncStatus,
  mergeOrchestrationDebugHistory,
  saveOrchestrationDebugHistory,
  syncCentralOrchestrationDebugHistory,
} from "./orchestration-debug-history.ts";
import {
  loadProviderTelemetryAlertsCentralSyncStatus,
  loadProviderTelemetryAlertDeliveryReadiness,
  loadProviderTelemetryAlertDispatchStatus,
  loadProviderTelemetryAlerts,
  mergeProviderTelemetryAlerts,
  saveProviderTelemetryAlerts,
  syncCentralProviderTelemetryAlerts,
  dispatchProviderTelemetryAlerts,
} from "./provider-telemetry-alerts.js";
import {
  discoverModelImageCatalogs,
  discoverRemoteModelImageCatalogs,
  loadModelImageCatalogCentralStatus,
  loadModelImageCatalog,
  loadModelImageRemoteRegistry,
  mergeModelImageCatalog,
  removeModelImageRemoteRegistryEntry,
  registerRuntimeModelImage,
  saveModelImageRemoteRegistryEntry,
  syncCentralModelImageCatalogs,
  syncDiscoveredModelImageCatalogs,
  syncRemoteModelImageCatalogs,
} from "./model-image-catalog.ts";
import {
  compareReplayGovernanceHistoryConflictReview,
  loadReplayGovernanceHistoryConflictReview,
  loadReplayGovernanceHistoryCentralSyncStatus,
  loadReplayGovernanceHistory,
  mergeReplayGovernanceHistory,
  resolveReplayGovernanceHistoryConflict,
  saveReplayGovernanceHistory,
  syncCentralReplayGovernanceHistory,
  updateReplayGovernanceHistoryConflictCuration,
} from "./replay-governance-history.ts";
import {
  authorizeWorkspaceGovernance,
  loadWorkspaceGovernance,
  mergeWorkspaceGovernance,
  resolveWorkspaceGovernanceConflict,
  saveWorkspaceGovernance,
  type WorkspaceGovernanceAction,
} from "./workspace-governance.ts";
import {
  loadRegressionAlertsCentralSyncStatus,
  loadRegressionAlerts,
  mergeRegressionAlerts,
  saveRegressionAlerts,
  syncCentralRegressionAlerts,
} from "./regression-alerts.ts";
import {
  compareSchemaPatternConflictReview,
  loadSchemaPatternConflictReview,
  loadSchemaPatternHistory,
  loadSchemaPatternLibrary,
  loadSchemaPatternCentralSyncStatus,
  mergeSchemaPatternHistory,
  mergeSchemaPatternLibrary,
  resolveSchemaPatternLibraryConflict,
  saveSchemaPatternHistory,
  saveSchemaPatternLibrary,
  syncCentralSchemaPatterns,
} from "./schema-patterns.ts";
import {
  buildStudioProviderTelemetry,
  buildStudioSandboxTelemetry,
  compareStudioRuns,
  exportStudioRun,
  listStudioRuns,
  loadStudioRun,
  saveStudioRun,
} from "./studio-runs.ts";
import {
  compareStudioScenarioConflictReview,
  curateStudioScenarioConflict,
  loadStudioScenarioConflictReview,
  loadStudioScenarios,
  loadStudioScenariosCentralSyncStatus,
  mergeStudioScenarios,
  resolveStudioScenarioConflict,
  saveStudioScenarios,
  syncCentralStudioScenarios,
} from "./studio-scenarios.ts";
import {
  compareStudioNodePinConflictReview,
  curateStudioNodePinConflict,
  loadStudioNodePinConflictReview,
  loadStudioNodePinsCentralSyncStatus,
  loadStudioNodePins,
  mergeStudioNodePins,
  resolveStudioNodePinConflict,
  saveStudioNodePins,
  syncCentralStudioNodePins,
} from "./studio-node-pins.ts";
import {
  archiveGeneratedArtifact,
  approveLangGraphSandbox,
  compareSharedLocalCatalogConflictReview,
  curateSharedLocalCatalogConflict,
  createFlowFromCatalogTemplate,
  createFlowWorkspace,
  createPrompt,
  createSchemaAsset,
  deleteFlowWorkspace,
  deletePrompt,
  deleteSchemaAsset,
  exportLocalCatalogItem,
  exportFlowWorkspace,
  generateApprovedRuntime,
  generateApprovedRuntimeManifest,
  generateLangGraphSandboxArtifact,
  generateLangSmithCloudHandoff,
  importLocalCatalogItemPackage,
  importFlowWorkspace,
  listLocalCatalog,
  loadLocalCatalogCentralSyncStatus,
  loadLangSmithCloudDeploymentAutomationStatus,
  loadLangSmithCloudDeployments,
  loadLangSmithCloudDeploymentsCentralStatus,
  loadSharedLocalCatalog,
  loadSharedLocalCatalogConflictReview,
  loadSharedLocalCatalogIntoRegistry,
  generateRuntimeManifest,
  generateRuntime,
  listGeneratedArtifact,
  readLangGraphSandboxApprovalStatus,
  listFlows,
  loadFlowById,
  loadRuntimeManifest,
  normalizeWorkspaceRoot,
  readGeneratedArtifactFile,
  readPrompt,
  readSchemaAsset,
  recordLangSmithCloudDeployment,
  restoreLocalCatalogRevision,
  resolveSharedLocalCatalogConflict,
  saveLocalCatalogItem,
  mergeSharedLocalCatalog,
  saveFlow,
  savePrompt,
  saveRuntimeManifest,
  saveSchemaAsset,
  syncCentralLangSmithCloudDeployments,
  syncCentralLocalCatalog,
  triggerLangSmithCloudDeployment,
  validateRuntimeManifest,
  applyCatalogItemToFlow,
  validateFlow,
  WorkspaceError,
  type LangGraphSandboxApprovalEvidence,
  type LocalCatalogItemKind,
} from "./workspace.ts";

export interface BuildAppOptions {
  workspaceRoot?: string;
  logger?: boolean;
  dockerRunner?: DockerCommandRunner;
  dockerGpuDetector?: DockerRuntimeGpuDetector;
}

interface FlowParams {
  flowId: string;
}

interface StudioRunParams extends FlowParams {
  runId: string;
}

interface SafetyHarnessRunParams extends FlowParams {
  runId: string;
}

interface PromptParams extends FlowParams {
  promptId: string;
}

interface SchemaParams extends FlowParams {
  schemaId: string;
}

interface SchemaPatternConflictParams extends FlowParams {
  conflictId: string;
}

interface StudioScenarioConflictParams extends FlowParams {
  conflictId: string;
}

interface CatalogSharedConflictParams {
  conflictId: string;
}

interface WorkspaceGovernanceConflictParams {
  conflictId: string;
}

interface GenerateBody {
  outDir?: string;
  approvalEvidence?: LangGraphSandboxApprovalEvidence;
}

interface CreateFlowBody {
  id?: string;
  name?: string;
  resourceName?: string;
}

interface ImportFlowWorkspaceBody {
  workspace?: unknown;
  overwrite?: boolean;
}

interface CatalogItemParams {
  kind: string;
  itemId: string;
}

interface ImportCatalogItemBody {
  package?: unknown;
}

interface AssetBody {
  content?: unknown;
}

interface ApplyCatalogItemBody {
  itemId?: string;
  kind?: string;
  targetNodeId?: string;
  id?: string;
}

interface SandboxBody {
  runtimeDir?: string;
  port?: number;
  env?: Record<string, unknown>;
}

interface DockerRuntimeBody {
  outDir?: string;
  runtimeUrl?: string;
  agentId?: string;
  notes?: string;
  modelExecutionProfile?: string;
  ports?: {
    api?: number;
    postgres?: number;
    redis?: number;
  };
}

interface DockerRuntimeHistoryQuery {
  limit?: string;
  operation?: string;
  status?: string;
  ok?: string;
  search?: string;
  level?: string;
  progressStage?: string;
  progressStatus?: string;
  from?: string;
  to?: string;
}

interface ArtifactQuery {
  outDir?: string;
  path?: string;
  runtimeUrl?: string;
}

interface DockerHistoryQuery extends ArtifactQuery {
  limit?: string;
  operation?: string;
  status?: string;
  ok?: string;
  search?: string;
  level?: string;
  progressStage?: string;
  progressStatus?: string;
  from?: string;
  to?: string;
}

interface StudioRunQuery {
  q?: string;
  agentId?: string;
  status?: string;
  phase?: string;
  hasErrors?: string;
  isComplete?: string;
  node?: string;
  minDurationMs?: string;
  maxDurationMs?: string;
}

interface StudioProviderTelemetryQuery {
  windowHours?: string;
  providerTokenBudget?: string;
  providerCostBudgetUsd?: string;
}

interface StudioSandboxTelemetryQuery {
  windowHours?: string;
  onlyFailures?: string;
}

interface BuilderAuthAuditQuery {
  limit?: string;
  status?: string;
  method?: string;
  route?: string;
  keyId?: string;
  actorId?: string;
  q?: string;
  from?: string;
  to?: string;
}

interface BuilderAuthKeyParams {
  keyId: string;
}

interface LlmAdapterParams {
  adapterId: string;
}

interface CollaborationConflictOverviewQuery {
  flowId?: string;
  area?: string;
  severity?: string;
  responsible?: string;
  role?: string;
  status?: string;
}

interface BuilderAuthOidcCallbackQuery {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const workspaceRoot = normalizeWorkspaceRoot(
    options.workspaceRoot ?? process.env.AGENT_BUILDER_WORKSPACE ?? process.cwd(),
  );
  const app = fastify({ logger: options.logger ?? false });
  const sandboxManager = new SandboxManager(workspaceRoot);
  const dockerRunner = options.dockerRunner ?? createEnvironmentDockerRunner();
  const dockerRuntimeManager = new DockerRuntimeManager(workspaceRoot, {
    runner: dockerRunner,
    gpuDetector: options.dockerGpuDetector,
  });
  const builderAuthAudit = createBuilderAuthAuditStore();
  const builderAuthSessions = createBuilderAuthSessionStore();
  const builderAuthOidcFlows = createBuilderAuthOidcFlowStore();
  const builderAuthOidcLogoutFlows = createBuilderAuthOidcLogoutFlowStore();

  app.addHook("onRequest", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Headers", "authorization,content-type,x-agent-flow-actor,x-agent-flow-builder-key,x-agent-builder-api-key,x-api-key");
    reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    reply.header("Access-Control-Expose-Headers", "content-disposition");
    if (request.method === "OPTIONS") {
      return reply.status(204).send();
    }
    delete request.headers["x-agent-flow-builder-key-id"];
    delete request.headers["x-agent-flow-builder-role"];
    delete request.headers["x-agent-flow-builder-groups"];
    delete request.headers["x-agent-flow-builder-areas"];
    if (!isBuilderAuthPublicRoute(request)) {
      const builderAuth = await authenticateBuilderRequest(request.headers, process.env, { sessionStore: builderAuthSessions });
      await builderAuthAudit.record({
        result: builderAuth,
        method: request.method,
        route: request.url.split("?")[0] ?? request.url,
      });
      if (builderAuth.status === "missing") {
        throw new WorkspaceError("Autenticação local do Builder obrigatória.", 401, {
          auth: {
            status: builderAuth.status,
            reason: builderAuth.reason,
          },
        });
      }
      if (builderAuth.status === "rejected") {
        throw new WorkspaceError("Autenticação local do Builder rejeitada.", 403, {
          auth: {
            status: builderAuth.status,
            reason: builderAuth.reason,
          },
        });
      }
      if (builderAuth.status === "authenticated") {
        request.headers["x-agent-flow-actor"] = builderAuth.identity.actorId;
        request.headers["x-agent-flow-builder-key-id"] = builderAuth.identity.keyId;
        request.headers["x-agent-flow-builder-role"] = builderAuth.identity.role;
        request.headers["x-agent-flow-builder-groups"] = builderAuth.identity.groups.join(",");
        request.headers["x-agent-flow-builder-areas"] = builderAuth.identity.areas.join(",");
      }
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof WorkspaceError) {
      return reply.status(error.statusCode).send({
        error: "workspace_error",
        message: error.message,
        details: serializeErrorDetails(error.details),
      });
    }
    request.log.error(error);
    return reply.status(500).send({
      error: "internal_error",
      message: "Erro interno na Builder API.",
    });
  });

  app.get("/health", async () => ({
    status: "ok",
    workspaceRoot,
  }));

  app.get("/builder-auth/status", async () => builderAuthStatus());

  app.post("/builder-auth/external-probe", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "governance", "read");
    return probeBuilderAuthExternalIntegrations();
  });

  app.post("/builder-auth/corporate-homologation", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "governance", "write");
    return homologateBuilderAuthCorporateIntegrations({ workspaceRoot });
  });

  app.post("/builder-auth/oidc/login-url", async () => {
    return createBuilderAuthOidcLoginUrl(process.env, builderAuthOidcFlows);
  });

  app.post("/builder-auth/oidc/logout-url", async (request) => {
    return createBuilderAuthOidcLogoutUrl(process.env, builderAuthOidcLogoutFlows, {
      sessionStore: builderAuthSessions,
      sessionToken: optionalBuilderAuthSessionToken(request),
    });
  });

  app.get<{ Querystring: BuilderAuthOidcCallbackQuery }>("/builder-auth/oidc/callback", async (request, reply) => {
    const result = await completeBuilderAuthOidcCallback(
      request.query,
      process.env,
      builderAuthOidcFlows,
      builderAuthSessions,
    );
    const accept = firstHeaderValue(request.headers.accept);
    if (accept.includes("text/html")) {
      reply.type("text/html");
      return buildBuilderAuthOidcCallbackHtml(result);
    }
    return result;
  });

  app.get<{ Querystring: BuilderAuthOidcCallbackQuery }>("/builder-auth/oidc/logout-callback", async (request, reply) => {
    const result = await completeBuilderAuthOidcLogoutCallback(request.query, builderAuthOidcLogoutFlows);
    const accept = firstHeaderValue(request.headers.accept);
    if (accept.includes("text/html")) {
      reply.type("text/html");
      return buildBuilderAuthOidcLogoutCallbackHtml(result);
    }
    return result;
  });

  app.post("/builder-auth/session", async (request) => {
    const builderAuth = await authenticateBuilderRequest(request.headers, process.env, { sessionStore: builderAuthSessions });
    if (builderAuth.status !== "authenticated") {
      throw new WorkspaceError("Não foi possível criar sessão local do Builder.", builderAuth.status === "missing" ? 401 : 403, {
        auth: {
          status: builderAuth.status,
          reason: builderAuth.reason,
        },
      });
    }
    return builderAuthSessions.create(builderAuth.identity);
  });

  app.post("/builder-auth/session/refresh", async (request) => {
    return builderAuthSessions.refresh(requiredBuilderAuthSessionToken(request));
  });

  app.post("/builder-auth/oidc/session/refresh", async (request) => {
    return refreshBuilderAuthOidcSession(requiredBuilderAuthSessionToken(request), process.env, builderAuthSessions);
  });

  app.post("/builder-auth/session/logout", async (request) => {
    return builderAuthSessions.revoke(requiredBuilderAuthSessionToken(request));
  });

  app.get<{ Querystring: BuilderAuthAuditQuery }>("/builder-auth/audit", async (request) => {
    const from = parseDateQuery(request.query.from, "from");
    const to = parseDateQuery(request.query.to, "to");
    if (from && to && from > to) {
      throw new WorkspaceError("from deve ser menor ou igual a to.", 400);
    }
    return await builderAuthAudit.report({
      limit: optionalPositiveInteger(request.query.limit, "limit") ?? 100,
      status: optionalBuilderAuthAuditStatus(request.query.status, "status"),
      method: optionalQueryString(request.query.method, "method")?.toUpperCase(),
      route: optionalQueryString(request.query.route, "route"),
      keyId: optionalQueryString(request.query.keyId, "keyId"),
      actorId: optionalQueryString(request.query.actorId, "actorId"),
      q: optionalQueryString(request.query.q, "q"),
      from,
      to,
    });
  });

  app.post<{ Body: unknown }>("/builder-auth/keys", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "governance", "write");
    return rotateBuilderAuthKey(request.body ?? {});
  });

  app.post<{ Params: BuilderAuthKeyParams }>("/builder-auth/keys/:keyId/disable", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "governance", "write");
    return disableBuilderAuthKey(request.params.keyId);
  });

  app.get("/flow-schema", async () => agentFlowJsonSchema());

  app.get("/llm-adapters", async () => ({
    adapters: llmAdapterCatalog(),
  }));

  app.get<{ Querystring: LocalLlmProviderStatusQuery }>("/llm-adapters/local-provider-status", async (request) =>
    checkLocalLlmProviderStatus(request.query),
  );

  app.get<{ Params: LlmAdapterParams; Querystring: LlmModelCatalogQuery }>("/llm-adapters/:adapterId/models", async (request) =>
    listLlmAdapterModels(request.params.adapterId, request.query),
  );

  app.get("/runtime-manifest-schema", async () => runtimeManifestJsonSchema());

  app.post<{ Body: unknown }>("/evaluators/external", async (request) => evaluateExternalEvaluator(request.body));

  app.get("/workspace-governance", async () => loadWorkspaceGovernance(workspaceRoot));

  app.get<{ Querystring: CollaborationConflictOverviewQuery }>("/collaboration/conflicts", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "governance", "read");
    return loadCollaborationConflictOverview(workspaceRoot, request.query);
  });

  app.post<{ Querystring: CollaborationConflictOverviewQuery; Body: unknown }>("/collaboration/conflicts/diff", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "governance", "read");
    return compareCollaborationConflictOverview(workspaceRoot, request.body ?? {}, request.query);
  });

  app.put<{ Body: unknown }>("/workspace-governance", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "governance", "write");
    return saveWorkspaceGovernance(workspaceRoot, request.body ?? {});
  });

  app.post<{ Body: unknown }>("/workspace-governance/merge", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "governance", "merge");
    return mergeWorkspaceGovernance(workspaceRoot, request.body ?? {});
  });

  app.post<{ Body: unknown }>("/workspace-governance/authorize", async (request) =>
    authorizeWorkspaceGovernance(workspaceRoot, request.body ?? {}, {
      enforced: process.env.AGENT_FLOW_WORKSPACE_GOVERNANCE_ENFORCE === "true",
    }),
  );

  app.post<{ Params: WorkspaceGovernanceConflictParams; Body: unknown }>(
    "/workspace-governance/conflicts/:conflictId/resolve",
    async (request) => {
      await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "governance", "resolve_conflict");
      return resolveWorkspaceGovernanceConflict(workspaceRoot, request.params.conflictId, request.body ?? {});
    },
  );

  app.get("/catalog", async () => listLocalCatalog(workspaceRoot));

  app.get("/catalog/shared-library", async () => loadSharedLocalCatalog(workspaceRoot));

  app.get("/catalog/shared-library/conflicts-review", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "catalog", "read");
    return loadSharedLocalCatalogConflictReview(workspaceRoot);
  });

  app.post<{ Body: unknown }>("/catalog/shared-library/conflicts-review/diff", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "catalog", "read");
    return compareSharedLocalCatalogConflictReview(workspaceRoot, request.body ?? {});
  });

  app.get("/catalog/central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "catalog", "read");
    return loadLocalCatalogCentralSyncStatus();
  });

  app.post("/catalog/shared-library/load", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "catalog", "merge");
    return loadSharedLocalCatalogIntoRegistry(workspaceRoot);
  });

  app.post<{ Body: unknown }>("/catalog/shared-library/merge", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "catalog", "merge");
    return mergeSharedLocalCatalog(workspaceRoot, request.body ?? {});
  });

  app.post("/catalog/sync-central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "catalog", "merge");
    return syncCentralLocalCatalog(workspaceRoot);
  });

  app.post<{ Params: CatalogSharedConflictParams; Body: unknown }>(
    "/catalog/shared-library/conflicts/:conflictId/curation",
    async (request) => {
      await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "catalog", "resolve_conflict");
      return curateSharedLocalCatalogConflict(workspaceRoot, request.params.conflictId, request.body ?? {});
    },
  );

  app.post<{ Params: CatalogSharedConflictParams; Body: unknown }>(
    "/catalog/shared-library/conflicts/:conflictId/resolve",
    async (request) => {
      await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "catalog", "resolve_conflict");
      return resolveSharedLocalCatalogConflict(workspaceRoot, request.params.conflictId, request.body ?? {});
    },
  );

  app.post<{ Body: unknown }>("/catalog/items", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "catalog", "write");
    return saveLocalCatalogItem(workspaceRoot, request.body);
  });

  app.get<{ Params: CatalogItemParams }>("/catalog/items/:kind/:itemId/export", async (request) =>
    exportLocalCatalogItem(workspaceRoot, request.params.itemId, request.params.kind as LocalCatalogItemKind),
  );

  app.post<{ Body: ImportCatalogItemBody | unknown }>("/catalog/items/import", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "catalog", "merge");
    const body = request.body;
    const payload = body && typeof body === "object" && "package" in body ? (body as ImportCatalogItemBody).package : body;
    return importLocalCatalogItemPackage(workspaceRoot, payload);
  });

  app.post<{ Body: unknown }>("/catalog/items/restore-revision", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "catalog", "write");
    return restoreLocalCatalogRevision(workspaceRoot, request.body);
  });

  app.get("/model-image-catalog", async () => loadModelImageCatalog(workspaceRoot));

  app.get("/model-image-catalog/discovery", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "catalog", "read");
    return discoverModelImageCatalogs(workspaceRoot);
  });

  app.get("/model-image-catalog/remote", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "catalog", "read");
    return discoverRemoteModelImageCatalogs(workspaceRoot);
  });

  app.get("/model-image-catalog/central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "catalog", "read");
    return loadModelImageCatalogCentralStatus();
  });

  app.get("/model-image-catalog/remote-registry", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "catalog", "read");
    return loadModelImageRemoteRegistry(workspaceRoot);
  });

  app.post<{ Body: unknown }>("/model-image-catalog/remote-registry", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "catalog", "write");
    return saveModelImageRemoteRegistryEntry(workspaceRoot, request.body ?? {});
  });

  app.delete<{ Params: { entryId: string } }>("/model-image-catalog/remote-registry/:entryId", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "catalog", "write");
    return removeModelImageRemoteRegistryEntry(workspaceRoot, request.params.entryId);
  });

  app.post<{ Body: DockerRuntimeBody }>("/model-image-catalog/register-runtime", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "catalog", "write");
    const outDir = requiredBodyString(request.body?.outDir, "outDir");
    const status = await dockerRuntimeManager.status(outDir, optionalString(request.body?.runtimeUrl, "runtimeUrl"));
    return registerRuntimeModelImage(workspaceRoot, status, optionalString(request.body?.notes, "notes"));
  });

  app.post<{ Body: unknown }>("/model-image-catalog/merge", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "catalog", "merge");
    return mergeModelImageCatalog(workspaceRoot, request.body ?? {});
  });

  app.post("/model-image-catalog/sync-discovered", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "catalog", "merge");
    return syncDiscoveredModelImageCatalogs(workspaceRoot);
  });

  app.post("/model-image-catalog/sync-remote", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "catalog", "merge");
    return syncRemoteModelImageCatalogs(workspaceRoot);
  });

  app.post("/model-image-catalog/sync-central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "catalog", "merge");
    return syncCentralModelImageCatalogs(workspaceRoot);
  });

  app.post<{ Body: unknown }>("/catalog/agent-templates/create-flow", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "catalog", "write");
    const result = await createFlowFromCatalogTemplate(workspaceRoot, request.body);
    return {
      status: "ok",
      item: result.item,
      path: result.flowPath,
      flow: result.flow,
      prompts: result.prompts,
      schemas: result.schemas,
    };
  });

  app.get("/runtime-manifest", async () => {
    const loaded = await loadRuntimeManifest(workspaceRoot);
    return {
      path: loaded.relativePath,
      manifest: loaded.manifest,
    };
  });

  app.put<{ Body: unknown }>("/runtime-manifest", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "write");
    const saved = await saveRuntimeManifest(workspaceRoot, request.body);
    return {
      path: saved.relativePath,
      manifest: saved.manifest,
    };
  });

  app.post("/runtime-manifest/validate", async () => validateRuntimeManifest(workspaceRoot));

  app.post<{ Body: GenerateBody }>("/runtime-manifest/generate", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "run");
    const body = request.body ?? {};
    if (body.outDir !== undefined && typeof body.outDir !== "string") {
      throw new WorkspaceError("outDir deve ser string quando informado.", 400);
    }
    const result = await generateRuntimeManifest(workspaceRoot, body.outDir);
    return {
      status: "ok",
      manifestId: result.manifestId,
      manifestPath: result.manifestPath,
      outDir: result.outDir,
      agents: result.agents,
    };
  });

  app.post<{ Body: GenerateBody }>("/runtime-manifest/generate-approved", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "deliver_runtime");
    const body = request.body ?? {};
    if (body.outDir !== undefined && typeof body.outDir !== "string") {
      throw new WorkspaceError("outDir deve ser string quando informado.", 400);
    }
    const result = await generateApprovedRuntimeManifest(workspaceRoot, body.outDir);
    return {
      status: "ok",
      manifestId: result.manifestId,
      manifestPath: result.manifestPath,
      outDir: result.outDir,
      agents: result.agents,
      approvalPackagePath: result.approvalPackagePath,
      approvals: result.approvals,
    };
  });

  app.get("/flows", async () => ({
    flows: await listFlows(workspaceRoot),
  }));

  app.post<{ Body: CreateFlowBody }>("/flows", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "write");
    const result = await createFlowWorkspace(workspaceRoot, request.body);
    return {
      status: "ok",
      path: result.flowPath,
      flow: result.flow,
      prompts: result.prompts,
      schemas: result.schemas,
    };
  });

  app.delete<{ Params: FlowParams }>("/flows/:flowId", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "write");
    const result = await deleteFlowWorkspace(workspaceRoot, request.params.flowId);
    return {
      status: "ok",
      flowId: result.flowId,
      path: result.flowPath,
      root: result.flowRoot,
    };
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId", async (request) => {
    const loaded = await loadFlowById(workspaceRoot, request.params.flowId);
    return {
      path: loaded.relativePath,
      flow: loaded.flow,
    };
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/export", async (request) => {
    return exportFlowWorkspace(workspaceRoot, request.params.flowId);
  });

  app.post<{ Body: ImportFlowWorkspaceBody }>("/flows/import", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "merge");
    const body = request.body ?? {};
    const payload =
      body && typeof body === "object" && "workspace" in body ? (body as ImportFlowWorkspaceBody).workspace : body;
    if (body && typeof body === "object" && "overwrite" in body && typeof body.overwrite !== "boolean") {
      throw new WorkspaceError("overwrite deve ser boolean quando informado.", 400);
    }
    const result = await importFlowWorkspace(workspaceRoot, payload, { overwrite: body.overwrite });
    return {
      status: "ok",
      path: result.flowPath,
      flow: result.flow,
      prompts: result.prompts,
      schemas: result.schemas,
    };
  });

  app.put<{ Params: FlowParams; Body: unknown }>("/flows/:flowId", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "write");
    const result = await saveFlow(workspaceRoot, request.params.flowId, request.body);
    return {
      status: "ok",
      path: result.flowPath,
      flow: result.flow,
    };
  });

  app.get<{ Params: PromptParams }>("/flows/:flowId/prompts/:promptId", async (request) => {
    return readPrompt(workspaceRoot, request.params.flowId, request.params.promptId);
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/prompts", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "schemas", "write");
    const result = await createPrompt(workspaceRoot, request.params.flowId, request.body);
    return {
      status: "ok",
      path: result.flowPath,
      flow: result.flow,
      prompt: result.asset,
    };
  });

  app.put<{ Params: PromptParams; Body: AssetBody }>("/flows/:flowId/prompts/:promptId", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "schemas", "write");
    return savePrompt(workspaceRoot, request.params.flowId, request.params.promptId, request.body?.content);
  });

  app.delete<{ Params: PromptParams }>("/flows/:flowId/prompts/:promptId", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "schemas", "write");
    const result = await deletePrompt(workspaceRoot, request.params.flowId, request.params.promptId);
    return {
      status: "ok",
      path: result.flowPath,
      flow: result.flow,
      deleted: result.deleted,
    };
  });

  app.get<{ Params: SchemaParams }>("/flows/:flowId/schemas/:schemaId", async (request) => {
    return readSchemaAsset(workspaceRoot, request.params.flowId, request.params.schemaId);
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/schemas", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "schemas", "write");
    const result = await createSchemaAsset(workspaceRoot, request.params.flowId, request.body);
    return {
      status: "ok",
      path: result.flowPath,
      flow: result.flow,
      schema: result.asset,
    };
  });

  app.put<{ Params: SchemaParams; Body: AssetBody }>("/flows/:flowId/schemas/:schemaId", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "schemas", "write");
    return saveSchemaAsset(workspaceRoot, request.params.flowId, request.params.schemaId, request.body?.content);
  });

  app.delete<{ Params: SchemaParams }>("/flows/:flowId/schemas/:schemaId", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "schemas", "write");
    const result = await deleteSchemaAsset(workspaceRoot, request.params.flowId, request.params.schemaId);
    return {
      status: "ok",
      path: result.flowPath,
      flow: result.flow,
      deleted: result.deleted,
    };
  });

  app.post<{ Params: FlowParams; Body: ApplyCatalogItemBody }>("/flows/:flowId/catalog/apply", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "catalog", "write");
    return applyCatalogItemToFlow(workspaceRoot, request.params.flowId, request.body);
  });

  app.post<{ Params: FlowParams }>("/flows/:flowId/validate", async (request) => {
    return validateFlow(workspaceRoot, request.params.flowId);
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/code-vm-runner/check", async (request) => {
    const loaded = await loadFlowById(workspaceRoot, request.params.flowId);
    const flowRoot = path.dirname(path.join(workspaceRoot, loaded.relativePath));
    const body = isRecord(request.body) ? request.body : {};
    return checkVmRunnerReadiness({
      workspaceRoot,
      flowRoot,
      flowId: request.params.flowId,
      node: "node" in body ? body.node : request.body,
    });
  });

  app.post<{ Params: FlowParams; Body: GenerateBody }>("/flows/:flowId/generate", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "run");
    const body = request.body ?? {};
    if (body.outDir !== undefined && typeof body.outDir !== "string") {
      throw new WorkspaceError("outDir deve ser string quando informado.", 400);
    }
    const result = await generateRuntime(workspaceRoot, request.params.flowId, body.outDir);
    return {
      status: "ok",
      flowId: result.flowId,
      flowPath: result.flowPath,
      outDir: result.outDir,
    };
  });

  app.post<{ Params: FlowParams; Body: GenerateBody }>("/flows/:flowId/generate-langgraph-sandbox", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "run");
    const body = request.body ?? {};
    if (body.outDir !== undefined && typeof body.outDir !== "string") {
      throw new WorkspaceError("outDir deve ser string quando informado.", 400);
    }
    const result = await generateLangGraphSandboxArtifact(workspaceRoot, request.params.flowId, body.outDir);
    return {
      status: "ok",
      flowId: result.flowId,
      flowPath: result.flowPath,
      outDir: result.outDir,
    };
  });

  app.post<{ Params: FlowParams; Body: GenerateBody }>("/flows/:flowId/approve-langgraph-sandbox", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "approve");
    const body = request.body ?? {};
    if (body.outDir !== undefined && typeof body.outDir !== "string") {
      throw new WorkspaceError("outDir deve ser string quando informado.", 400);
    }
    if (body.approvalEvidence !== undefined && (typeof body.approvalEvidence !== "object" || body.approvalEvidence === null)) {
      throw new WorkspaceError("approvalEvidence deve ser objeto quando informado.", 400);
    }
    const approval = await approveLangGraphSandbox(workspaceRoot, request.params.flowId, body.outDir, body.approvalEvidence);
    return { status: "ok", approval };
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/langgraph-sandbox-approval-status", async (request) => {
    return readLangGraphSandboxApprovalStatus(workspaceRoot, request.params.flowId);
  });

  app.post<{ Params: FlowParams }>("/flows/:flowId/generate-langsmith-cloud-handoff", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "deliver_runtime");
    const handoff = await generateLangSmithCloudHandoff(workspaceRoot, request.params.flowId);
    return { status: "ok", handoff };
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/langsmith-cloud-deployments", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "read");
    return loadLangSmithCloudDeployments(workspaceRoot, request.params.flowId);
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/langsmith-cloud-deployments/central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "read");
    return loadLangSmithCloudDeploymentsCentralStatus();
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/langsmith-cloud-deployment-automation", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "read");
    return loadLangSmithCloudDeploymentAutomationStatus();
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/langsmith-cloud-deployments", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "deliver_runtime");
    const deployments = await recordLangSmithCloudDeployment(
      workspaceRoot,
      request.params.flowId,
      langSmithCloudDeploymentPayloadFromRequest(request),
    );
    return { status: "ok", deployments };
  });

  app.post<{ Params: FlowParams }>("/flows/:flowId/langsmith-cloud-deployments/sync-central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "deliver_runtime");
    return syncCentralLangSmithCloudDeployments(workspaceRoot, request.params.flowId);
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/langsmith-cloud-deployment-automation/deploy", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "deliver_runtime");
    return triggerLangSmithCloudDeployment(
      workspaceRoot,
      request.params.flowId,
      langSmithCloudDeploymentPayloadFromRequest(request),
    );
  });

  app.post<{ Params: FlowParams; Body: GenerateBody }>("/flows/:flowId/generate-approved-runtime", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "deliver_runtime");
    const body = request.body ?? {};
    if (body.outDir !== undefined && typeof body.outDir !== "string") {
      throw new WorkspaceError("outDir deve ser string quando informado.", 400);
    }
    const result = await generateApprovedRuntime(workspaceRoot, request.params.flowId, body.outDir);
    return {
      status: "ok",
      flowId: result.flowId,
      flowPath: result.flowPath,
      outDir: result.outDir,
      approval: result.approval,
    };
  });

  app.get<{ Querystring: ArtifactQuery }>("/artifacts", async (request) => {
    const outDir = requiredQueryString(request.query.outDir, "outDir");
    return listGeneratedArtifact(workspaceRoot, outDir);
  });

  app.get<{ Querystring: ArtifactQuery }>("/artifacts/file", async (request) => {
    const outDir = requiredQueryString(request.query.outDir, "outDir");
    const filePath = requiredQueryString(request.query.path, "path");
    return readGeneratedArtifactFile(workspaceRoot, outDir, filePath);
  });

  app.get<{ Querystring: ArtifactQuery }>("/artifacts/archive", async (request, reply) => {
    const outDir = requiredQueryString(request.query.outDir, "outDir");
    const archive = await archiveGeneratedArtifact(workspaceRoot, outDir);
    reply.header("content-type", "application/zip");
    reply.header("content-disposition", `attachment; filename="${archive.fileName}"`);
    reply.header("content-length", String(archive.sizeBytes));
    return reply.send(archive.content);
  });

  app.get<{ Querystring: ArtifactQuery }>("/docker-runtime/status", async (request) => {
    const outDir = requiredQueryString(request.query.outDir, "outDir");
    return dockerRuntimeManager.status(outDir, optionalString(request.query.runtimeUrl, "runtimeUrl"));
  });

  app.get<{ Querystring: DockerHistoryQuery }>("/docker-runtime/history", async (request) => {
    const outDir = requiredQueryString(request.query.outDir, "outDir");
    const runtimeUrl = optionalString(request.query.runtimeUrl, "runtimeUrl");
    const from = parseDateQuery(request.query.from, "from");
    const to = parseDateQuery(request.query.to, "to");
    if (from && to && from > to) {
      throw new WorkspaceError("from deve ser menor ou igual a to.", 400);
    }
    const operation = optionalDockerRuntimeOperation(request.query.operation, "operation");
    const status = optionalDockerRuntimeStatus(request.query.status, "status");
    const level = optionalDockerRuntimeHistoryLevel(request.query.level, "level");
    const progressStatus = optionalDockerBuildProgressStatus(request.query.progressStatus, "progressStatus");
    return dockerRuntimeManager.history(
      outDir,
      runtimeUrl,
      {
        limit: optionalPositiveInteger(request.query.limit, "limit") ?? 20,
        operation,
        status,
        ok: optionalBooleanQuery(request.query.ok, "ok"),
        search: optionalQueryString(request.query.search, "search"),
        level,
        progressStage: optionalQueryString(request.query.progressStage, "progressStage"),
        progressStatus,
        from,
        to,
      },
    );
  });

  app.post<{ Body: DockerRuntimeBody }>("/docker-runtime/build", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "deliver_runtime");
    const outDir = requiredBodyString(request.body?.outDir, "outDir");
    return dockerRuntimeManager.build(outDir, optionalString(request.body?.runtimeUrl, "runtimeUrl"));
  });

  app.post<{ Body: DockerRuntimeBody }>("/docker-runtime/setup-models", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "deliver_runtime");
    const outDir = requiredBodyString(request.body?.outDir, "outDir");
    return dockerRuntimeManager.setupModels(outDir, optionalString(request.body?.runtimeUrl, "runtimeUrl"));
  });

  app.post<{ Body: DockerRuntimeBody }>("/docker-runtime/build-model-image", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "deliver_runtime");
    const outDir = requiredBodyString(request.body?.outDir, "outDir");
    return dockerRuntimeManager.buildModelImage(outDir, optionalString(request.body?.runtimeUrl, "runtimeUrl"));
  });

  app.post<{ Body: DockerRuntimeBody }>("/docker-runtime/export-model-image", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "deliver_runtime");
    const outDir = requiredBodyString(request.body?.outDir, "outDir");
    return dockerRuntimeManager.exportModelImage(outDir, optionalString(request.body?.runtimeUrl, "runtimeUrl"));
  });

  app.post<{ Body: DockerRuntimeBody }>("/docker-runtime/push-model-image", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "deliver_runtime");
    const outDir = requiredBodyString(request.body?.outDir, "outDir");
    return dockerRuntimeManager.pushModelImage(outDir, optionalString(request.body?.runtimeUrl, "runtimeUrl"));
  });

  app.post<{ Body: DockerRuntimeBody }>("/docker-runtime/check-gpu", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "run");
    const outDir = requiredBodyString(request.body?.outDir, "outDir");
    return dockerRuntimeManager.checkGpu(outDir, optionalString(request.body?.runtimeUrl, "runtimeUrl"));
  });

  app.post<{ Body: DockerRuntimeBody }>("/docker-runtime/cancel", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "deliver_runtime");
    const outDir = requiredBodyString(request.body?.outDir, "outDir");
    return dockerRuntimeManager.cancel(outDir, optionalString(request.body?.runtimeUrl, "runtimeUrl"));
  });

  app.post<{ Body: DockerRuntimeBody }>("/docker-runtime/prepare-env", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "secrets", "manage_secrets");
    const outDir = requiredBodyString(request.body?.outDir, "outDir");
    return dockerRuntimeManager.prepareEnv(outDir, optionalString(request.body?.runtimeUrl, "runtimeUrl"));
  });

  app.post<{ Body: DockerRuntimeBody }>("/docker-runtime/configure-ports", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "deliver_runtime");
    const outDir = requiredBodyString(request.body?.outDir, "outDir");
    return dockerRuntimeManager.configurePorts(
      outDir,
      optionalPorts(request.body?.ports),
      optionalString(request.body?.runtimeUrl, "runtimeUrl"),
    );
  });

  app.post<{ Body: DockerRuntimeBody }>("/docker-runtime/up", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "deliver_runtime");
    const outDir = requiredBodyString(request.body?.outDir, "outDir");
    return dockerRuntimeManager.up(
      outDir,
      optionalString(request.body?.runtimeUrl, "runtimeUrl"),
      optionalModelExecutionProfile(request.body?.modelExecutionProfile),
    );
  });

  app.post<{ Body: DockerRuntimeBody }>("/docker-runtime/down", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "deliver_runtime");
    const outDir = requiredBodyString(request.body?.outDir, "outDir");
    return dockerRuntimeManager.down(outDir, optionalString(request.body?.runtimeUrl, "runtimeUrl"));
  });

  app.post<{ Body: DockerRuntimeBody }>("/docker-runtime/smoke", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "run");
    const outDir = requiredBodyString(request.body?.outDir, "outDir");
    return dockerRuntimeManager.smoke(
      outDir,
      optionalString(request.body?.runtimeUrl, "runtimeUrl"),
      optionalString(request.body?.agentId, "agentId"),
    );
  });

  app.post<{ Body: DockerRuntimeBody }>("/docker-runtime/smoke-all", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "run");
    const outDir = requiredBodyString(request.body?.outDir, "outDir");
    return dockerRuntimeManager.smokeAll(outDir, optionalString(request.body?.runtimeUrl, "runtimeUrl"));
  });

  app.post<{ Body: DockerRuntimeBody }>("/docker-runtime/inspect", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "read");
    const outDir = requiredBodyString(request.body?.outDir, "outDir");
    return dockerRuntimeManager.inspect(outDir, optionalString(request.body?.runtimeUrl, "runtimeUrl"));
  });

  app.get("/sandboxes", async () => ({
    sandboxes: sandboxManager.list(),
  }));

  app.get<{ Params: FlowParams }>("/sandboxes/:flowId/status", async (request) => {
    return sandboxManager.status(request.params.flowId);
  });

  app.post<{ Params: FlowParams; Body: SandboxBody }>("/sandboxes/:flowId/start", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "run");
    const body = request.body ?? {};
    if (body.runtimeDir !== undefined && typeof body.runtimeDir !== "string") {
      throw new WorkspaceError("runtimeDir deve ser string quando informado.", 400);
    }
    if (body.port !== undefined && typeof body.port !== "number") {
      throw new WorkspaceError("port deve ser número quando informado.", 400);
    }
    return sandboxManager.start(request.params.flowId, {
      runtimeDir: body.runtimeDir,
      port: body.port,
      env: optionalSandboxEnv(body.env),
    });
  });

  app.post<{ Params: FlowParams }>("/sandboxes/:flowId/stop", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "run");
    return sandboxManager.stop(request.params.flowId);
  });

  app.get<{ Params: FlowParams; Querystring: StudioRunQuery }>(
    "/flows/:flowId/studio-runs",
    async (request) => {
      const minDurationMs = optionalNonNegativeInteger(request.query.minDurationMs, "minDurationMs");
      const maxDurationMs = optionalNonNegativeInteger(request.query.maxDurationMs, "maxDurationMs");
      if (minDurationMs !== undefined && maxDurationMs !== undefined && minDurationMs > maxDurationMs) {
        throw new WorkspaceError("minDurationMs deve ser menor ou igual a maxDurationMs.", 400);
      }
      return listStudioRuns(workspaceRoot, request.params.flowId, {
        q: optionalQueryString(request.query.q, "q"),
        agentId: optionalQueryString(request.query.agentId, "agentId"),
        status: optionalQueryString(request.query.status, "status"),
        phase: optionalQueryString(request.query.phase, "phase"),
        hasErrors: optionalBooleanQuery(request.query.hasErrors, "hasErrors"),
        isComplete: optionalBooleanQuery(request.query.isComplete, "isComplete"),
        node: optionalQueryString(request.query.node, "node"),
        minDurationMs,
        maxDurationMs,
      });
    },
  );

  app.get<{ Params: FlowParams; Querystring: { left: string; right: string } }>(
    "/flows/:flowId/studio-runs/compare",
    async (request) => {
      const leftRunId = optionalQueryString(request.query.left, "left");
      const rightRunId = optionalQueryString(request.query.right, "right");
      if (!leftRunId || !rightRunId) {
        throw new WorkspaceError("left e right são obrigatórios.", 400);
      }
      return compareStudioRuns(workspaceRoot, request.params.flowId, leftRunId, rightRunId);
    },
  );

  app.get<{ Params: FlowParams; Querystring: StudioProviderTelemetryQuery }>(
    "/flows/:flowId/studio-runs/provider-telemetry",
    async (request) => {
      return buildStudioProviderTelemetry(workspaceRoot, request.params.flowId, {
        windowHours: optionalPositiveNumber(request.query.windowHours, "windowHours"),
        providerTokenBudget: optionalPositiveNumber(request.query.providerTokenBudget, "providerTokenBudget"),
        providerCostBudgetUsd: optionalPositiveNumber(request.query.providerCostBudgetUsd, "providerCostBudgetUsd"),
      });
    },
  );

  app.get<{ Params: FlowParams }>("/flows/:flowId/provider-telemetry-dashboard-history", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "read");
    return loadProviderTelemetryDashboardHistory(workspaceRoot, request.params.flowId);
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/provider-telemetry-dashboard-history/central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "read");
    return loadProviderTelemetryDashboardCentralSyncStatus();
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/provider-telemetry-dashboard-history/merge", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "merge");
    return mergeProviderTelemetryDashboardHistory(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/provider-telemetry-dashboard-history/diff", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "read");
    return compareProviderTelemetryDashboardHistory(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.post<{ Params: FlowParams }>("/flows/:flowId/provider-telemetry-dashboard-history/sync-central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "merge");
    return syncCentralProviderTelemetryDashboardHistory(workspaceRoot, request.params.flowId);
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/provider-telemetry-dashboard-history", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "write");
    return saveProviderTelemetryDashboardSnapshot(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/runtime-job-metrics-history", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "read");
    return loadRuntimeJobMetricsHistory(workspaceRoot, request.params.flowId);
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/runtime-job-metrics-history/central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "read");
    return loadRuntimeJobMetricsCentralSyncStatus();
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/runtime-job-metrics-history/merge", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "merge");
    return mergeRuntimeJobMetricsHistory(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/runtime-job-metrics-history/diff", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "read");
    return compareRuntimeJobMetricsHistory(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.post<{ Params: FlowParams }>("/flows/:flowId/runtime-job-metrics-history/sync-central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "merge");
    return syncCentralRuntimeJobMetricsHistory(workspaceRoot, request.params.flowId);
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/runtime-job-metrics-history", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "runtime_delivery", "write");
    return saveRuntimeJobMetricsSnapshot(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.get<{ Params: FlowParams; Querystring: StudioSandboxTelemetryQuery }>(
    "/flows/:flowId/studio-runs/sandbox-telemetry",
    async (request) => {
      return buildStudioSandboxTelemetry(workspaceRoot, request.params.flowId, {
        windowHours: optionalPositiveNumber(request.query.windowHours, "windowHours"),
        onlyFailures: optionalBooleanQuery(request.query.onlyFailures, "onlyFailures"),
      });
    },
  );

  app.get<{ Params: StudioRunParams }>("/flows/:flowId/studio-runs/:runId/export", async (request) => {
    return exportStudioRun(workspaceRoot, request.params.flowId, request.params.runId);
  });

  app.get<{ Params: StudioRunParams }>("/flows/:flowId/studio-runs/:runId", async (request) => {
    return loadStudioRun(workspaceRoot, request.params.flowId, request.params.runId);
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/studio-runs", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "write");
    return saveStudioRun(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/annotation-queue", async (request) => {
    return loadStudioAnnotationQueue(workspaceRoot, request.params.flowId);
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/annotation-queue/central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "annotation_queue", "read");
    return loadStudioAnnotationQueueCentralSyncStatus();
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/annotation-queue/conflicts-review", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "annotation_queue", "read");
    return loadStudioAnnotationQueueConflictReview(workspaceRoot, request.params.flowId);
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/annotation-queue/conflicts-review/diff", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "annotation_queue", "merge");
    return compareStudioAnnotationQueueConflictReview(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.put<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/annotation-queue", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "annotation_queue", "write");
    return saveStudioAnnotationQueue(
      workspaceRoot,
      request.params.flowId,
      request.body ?? {},
      annotationQueueMutationContextFromRequest(request),
    );
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/annotation-queue/merge", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "annotation_queue", "merge");
    return mergeStudioAnnotationQueue(
      workspaceRoot,
      request.params.flowId,
      request.body ?? {},
      annotationQueueMutationContextFromRequest(request),
    );
  });

  app.post<{ Params: FlowParams & { conflictId: string }; Body: unknown }>(
    "/flows/:flowId/annotation-queue/conflicts/:conflictId/curation",
    async (request) => {
      await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "annotation_queue", "write");
      return curateStudioAnnotationQueueConflict(
        workspaceRoot,
        request.params.flowId,
        request.params.conflictId,
        request.body ?? {},
        annotationQueueMutationContextFromRequest(request),
      );
    },
  );

  app.post<{ Params: FlowParams }>("/flows/:flowId/annotation-queue/sync-central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "annotation_queue", "merge");
    return syncCentralStudioAnnotationQueue(
      workspaceRoot,
      request.params.flowId,
      annotationQueueMutationContextFromRequest(request),
    );
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/schema-pattern-library", async (request) => {
    return loadSchemaPatternLibrary(workspaceRoot, request.params.flowId);
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/schema-pattern-library/central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "schemas", "read");
    return loadSchemaPatternCentralSyncStatus();
  });

  app.put<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/schema-pattern-library", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "schemas", "write");
    return saveSchemaPatternLibrary(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/schema-pattern-library/merge", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "schemas", "merge");
    return mergeSchemaPatternLibrary(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.post<{ Params: FlowParams }>("/flows/:flowId/schema-pattern-library/sync-central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "schemas", "merge");
    return syncCentralSchemaPatterns(workspaceRoot, request.params.flowId);
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/schema-pattern-library/conflicts-review", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "schemas", "read");
    return loadSchemaPatternConflictReview(workspaceRoot, request.params.flowId);
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/schema-pattern-library/conflicts-review/diff", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "schemas", "read");
    return compareSchemaPatternConflictReview(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.post<{ Params: SchemaPatternConflictParams; Body: unknown }>(
    "/flows/:flowId/schema-pattern-library/conflicts/:conflictId/resolve",
    async (request) => {
      await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "schemas", "resolve_conflict");
      return resolveSchemaPatternLibraryConflict(
        workspaceRoot,
        request.params.flowId,
        request.params.conflictId,
        request.body ?? {},
      );
    },
  );

  app.get<{ Params: FlowParams }>("/flows/:flowId/schema-pattern-history", async (request) => {
    return loadSchemaPatternHistory(workspaceRoot, request.params.flowId);
  });

  app.put<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/schema-pattern-history", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "schemas", "write");
    return saveSchemaPatternHistory(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/schema-pattern-history/merge", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "schemas", "merge");
    return mergeSchemaPatternHistory(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/experiment-dashboard-history", async (request) => {
    return loadStudioExperimentDashboardHistory(workspaceRoot, request.params.flowId);
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/experiment-dashboard-history/central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "read");
    return loadStudioExperimentDashboardHistoryCentralSyncStatus();
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/experiment-dashboard-history/merge", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "merge");
    return mergeStudioExperimentDashboardHistory(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/experiment-dashboard-history/diff", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "read");
    return compareStudioExperimentDashboardHistory(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.post<{ Params: FlowParams }>("/flows/:flowId/experiment-dashboard-history/sync-central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "merge");
    return syncCentralStudioExperimentDashboardHistory(workspaceRoot, request.params.flowId);
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/experiment-dashboard-history", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "write");
    return saveStudioExperimentDashboardSnapshot(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/replay-governance-history", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "read");
    return loadReplayGovernanceHistory(workspaceRoot, request.params.flowId);
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/studio-node-pins", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "read");
    return loadStudioNodePins(workspaceRoot, request.params.flowId);
  });

  app.put<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/studio-node-pins", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "write");
    return saveStudioNodePins(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/studio-node-pins/merge", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "merge");
    return mergeStudioNodePins(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/studio-node-pins/conflicts-review", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "read");
    return loadStudioNodePinConflictReview(workspaceRoot, request.params.flowId);
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/studio-node-pins/conflicts-review/diff", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "read");
    return compareStudioNodePinConflictReview(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.post<{ Params: FlowParams & { conflictId: string }; Body: unknown }>(
    "/flows/:flowId/studio-node-pins/conflicts/:conflictId/curation",
    async (request) => {
      await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "merge");
      return curateStudioNodePinConflict(workspaceRoot, request.params.flowId, request.params.conflictId, request.body ?? {});
    },
  );

  app.post<{ Params: FlowParams & { conflictId: string }; Body: unknown }>(
    "/flows/:flowId/studio-node-pins/conflicts/:conflictId/resolve",
    async (request) => {
      await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "merge");
      return resolveStudioNodePinConflict(workspaceRoot, request.params.flowId, request.params.conflictId, request.body ?? {});
    },
  );

  app.get<{ Params: FlowParams }>("/flows/:flowId/studio-node-pins/central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "read");
    return loadStudioNodePinsCentralSyncStatus();
  });

  app.post<{ Params: FlowParams }>("/flows/:flowId/studio-node-pins/sync-central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "merge");
    return syncCentralStudioNodePins(workspaceRoot, request.params.flowId);
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/debug-layer-snapshots", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "read");
    return loadDebugLayerSnapshots(workspaceRoot, request.params.flowId);
  });

  app.put<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/debug-layer-snapshots", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "write");
    return saveDebugLayerSnapshots(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/debug-layer-snapshots/merge", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "merge");
    return mergeDebugLayerSnapshots(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.post<{ Params: FlowParams & { conflictId: string }; Body: unknown }>(
    "/flows/:flowId/debug-layer-snapshots/conflicts/:conflictId/curation",
    async (request) => {
      await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "merge");
      return updateDebugLayerSnapshotConflictCuration(
        workspaceRoot,
        request.params.flowId,
        request.params.conflictId,
        request.body ?? {},
      );
    },
  );

  app.post<{ Params: FlowParams & { conflictId: string }; Body: unknown }>(
    "/flows/:flowId/debug-layer-snapshots/conflicts/:conflictId/resolve",
    async (request) => {
      await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "merge");
      return resolveDebugLayerSnapshotConflict(
        workspaceRoot,
        request.params.flowId,
        request.params.conflictId,
        request.body ?? {},
      );
    },
  );

  app.get<{ Params: FlowParams }>("/flows/:flowId/debug-layer-snapshots/conflicts-review", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "read");
    return loadDebugLayerSnapshotConflictReview(workspaceRoot, request.params.flowId);
  });

  app.post<{ Params: FlowParams; Body: unknown }>(
    "/flows/:flowId/debug-layer-snapshots/conflicts-review/diff",
    async (request) => {
      await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "read");
      return compareDebugLayerSnapshotConflictReview(workspaceRoot, request.params.flowId, request.body ?? {});
    },
  );

  app.get<{ Params: FlowParams }>("/flows/:flowId/debug-layer-snapshots/central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "read");
    return loadDebugLayerSnapshotsCentralSyncStatus();
  });

  app.post<{ Params: FlowParams }>("/flows/:flowId/debug-layer-snapshots/sync-central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "merge");
    return syncCentralDebugLayerSnapshots(workspaceRoot, request.params.flowId);
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/orchestration-debug-history", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "read");
    return loadOrchestrationDebugHistory(workspaceRoot, request.params.flowId);
  });

  app.put<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/orchestration-debug-history", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "write");
    return saveOrchestrationDebugHistory(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/orchestration-debug-history/merge", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "merge");
    return mergeOrchestrationDebugHistory(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/studio-scenarios", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "read");
    return loadStudioScenarios(workspaceRoot, request.params.flowId);
  });

  app.put<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/studio-scenarios", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "write");
    return saveStudioScenarios(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/studio-scenarios/merge", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "merge");
    return mergeStudioScenarios(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  const loadStudioScenarioConflictReviewHandler = async (request: any): Promise<unknown> => {
    const params = request.params as FlowParams;
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "read");
    return loadStudioScenarioConflictReview(workspaceRoot, params.flowId);
  };
  app.get("/flows/:flowId/studio-scenarios/conflicts-review", loadStudioScenarioConflictReviewHandler as any);

  const compareStudioScenarioConflictReviewHandler = async (request: any): Promise<Record<string, unknown>> => {
    const params = request.params as FlowParams;
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "read");
    return compareStudioScenarioConflictReview(workspaceRoot, params.flowId, request.body ?? {});
  };
  app.post(
    "/flows/:flowId/studio-scenarios/conflicts-review/diff",
    compareStudioScenarioConflictReviewHandler as any,
  );

  app.post<{ Params: StudioScenarioConflictParams; Body: unknown }>(
    "/flows/:flowId/studio-scenarios/conflicts/:conflictId/curation",
    async (request) => {
      await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "resolve_conflict");
      return curateStudioScenarioConflict(workspaceRoot, request.params.flowId, request.params.conflictId, request.body ?? {});
    },
  );

  app.post<{ Params: StudioScenarioConflictParams; Body: unknown }>(
    "/flows/:flowId/studio-scenarios/conflicts/:conflictId/resolve",
    async (request) => {
      await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "resolve_conflict");
      return resolveStudioScenarioConflict(workspaceRoot, request.params.flowId, request.params.conflictId, request.body ?? {});
    },
  );

  app.get<{ Params: FlowParams }>("/flows/:flowId/studio-scenarios/central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "read");
    return loadStudioScenariosCentralSyncStatus();
  });

  app.post<{ Params: FlowParams }>("/flows/:flowId/studio-scenarios/sync-central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "merge");
    return syncCentralStudioScenarios(workspaceRoot, request.params.flowId);
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/orchestration-debug-history/diff", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "read");
    return compareOrchestrationDebugHistory(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/orchestration-debug-history/central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "read");
    return loadOrchestrationDebugHistoryCentralSyncStatus();
  });

  app.post<{ Params: FlowParams }>("/flows/:flowId/orchestration-debug-history/sync-central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "merge");
    return syncCentralOrchestrationDebugHistory(workspaceRoot, request.params.flowId);
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/replay-governance-history/central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "read");
    return loadReplayGovernanceHistoryCentralSyncStatus();
  });

  app.put<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/replay-governance-history", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "write");
    return saveReplayGovernanceHistory(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/replay-governance-history/merge", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "merge");
    return mergeReplayGovernanceHistory(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/replay-governance-history/conflicts-review", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "read");
    return loadReplayGovernanceHistoryConflictReview(workspaceRoot, request.params.flowId);
  });

  app.post<{ Params: FlowParams; Body: unknown }>(
    "/flows/:flowId/replay-governance-history/conflicts-review/diff",
    async (request) => {
      await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "read");
      return compareReplayGovernanceHistoryConflictReview(workspaceRoot, request.params.flowId, request.body ?? {});
    },
  );

  app.post<{ Params: FlowParams & { conflictId: string }; Body: unknown }>(
    "/flows/:flowId/replay-governance-history/conflicts/:conflictId/curation",
    async (request) => {
      await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "merge");
      return updateReplayGovernanceHistoryConflictCuration(
        workspaceRoot,
        request.params.flowId,
        request.params.conflictId,
        request.body ?? {},
      );
    },
  );

  app.post<{ Params: FlowParams & { conflictId: string }; Body: unknown }>(
    "/flows/:flowId/replay-governance-history/conflicts/:conflictId/resolve",
    async (request) => {
      await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "merge");
      return resolveReplayGovernanceHistoryConflict(
        workspaceRoot,
        request.params.flowId,
        request.params.conflictId,
        request.body ?? {},
      );
    },
  );

  app.post<{ Params: FlowParams }>("/flows/:flowId/replay-governance-history/sync-central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "replay_governance", "merge");
    return syncCentralReplayGovernanceHistory(workspaceRoot, request.params.flowId);
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/regression-alerts", async (request) => {
    return loadRegressionAlerts(workspaceRoot, request.params.flowId);
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/regression-alerts/central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "read");
    return loadRegressionAlertsCentralSyncStatus();
  });

  app.put<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/regression-alerts", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "write");
    return saveRegressionAlerts(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/regression-alerts/merge", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "merge");
    return mergeRegressionAlerts(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.post<{ Params: FlowParams }>("/flows/:flowId/regression-alerts/sync-central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "merge");
    return syncCentralRegressionAlerts(workspaceRoot, request.params.flowId);
  });

  app.get("/flows/:flowId/provider-telemetry-alerts", async (request) => {
    const { flowId } = request.params as FlowParams;
    return loadProviderTelemetryAlerts(workspaceRoot, flowId);
  });

  app.get("/flows/:flowId/provider-telemetry-alerts/central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "read");
    return loadProviderTelemetryAlertsCentralSyncStatus();
  });

  app.get("/flows/:flowId/provider-telemetry-alerts/dispatch", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "read");
    return loadProviderTelemetryAlertDispatchStatus();
  });

  app.get("/flows/:flowId/provider-telemetry-alerts/delivery-readiness", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "read");
    const { flowId } = request.params as FlowParams;
    return loadProviderTelemetryAlertDeliveryReadiness(workspaceRoot, flowId);
  });

  app.put("/flows/:flowId/provider-telemetry-alerts", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "write");
    const { flowId } = request.params as FlowParams;
    return saveProviderTelemetryAlerts(workspaceRoot, flowId, request.body ?? {});
  });

  app.post("/flows/:flowId/provider-telemetry-alerts/merge", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "merge");
    const { flowId } = request.params as FlowParams;
    return mergeProviderTelemetryAlerts(workspaceRoot, flowId, request.body ?? {});
  });

  app.post("/flows/:flowId/provider-telemetry-alerts/sync-central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "merge");
    const { flowId } = request.params as FlowParams;
    return syncCentralProviderTelemetryAlerts(workspaceRoot, flowId);
  });

  app.post("/flows/:flowId/provider-telemetry-alerts/dispatch", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "experiments", "merge");
    const { flowId } = request.params as FlowParams;
    return dispatchProviderTelemetryAlerts(workspaceRoot, flowId);
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/safety-harness/runs", async (request) => {
    return listSafetyHarnessRuns(workspaceRoot, request.params.flowId);
  });

  app.get<{ Params: FlowParams }>("/flows/:flowId/safety-harness/central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "safety_harness", "read");
    return loadSafetyHarnessCentralSyncStatus();
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/safety-harness/evaluate", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "safety_harness", "run");
    return evaluateSafetyHarness(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.put<{ Params: SafetyHarnessRunParams; Body: unknown }>("/flows/:flowId/safety-harness/runs/:runId/review", async (request) => {
    await assertSafetyHarnessReviewAuthorized(workspaceRoot, request);
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "safety_harness", "approve");
    return reviewSafetyHarnessRun(
      workspaceRoot,
      request.params.flowId,
      request.params.runId,
      safetyHarnessReviewPayloadFromRequest(request),
    );
  });

  app.post<{ Params: FlowParams }>("/flows/:flowId/safety-harness/sync-central", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "safety_harness", "merge");
    return syncCentralSafetyHarness(workspaceRoot, request.params.flowId);
  });

  app.post<{ Params: FlowParams; Body: unknown }>("/flows/:flowId/safety-harness/diff", async (request) => {
    await assertWorkspaceGovernanceAuthorized(workspaceRoot, request, "safety_harness", "read");
    return compareSafetyHarnessHistory(workspaceRoot, request.params.flowId, request.body ?? {});
  });

  app.addHook("onClose", async () => {
    await sandboxManager.stopAll();
  });

  return app;
}

function serializeErrorDetails(details: unknown): unknown {
  if (details instanceof Error) {
    return details.message;
  }
  return details;
}

function requiredQueryString(value: string | undefined, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkspaceError(`${name} é obrigatório.`, 400);
  }
  return value;
}

function requiredBodyString(value: string | undefined, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkspaceError(`${name} é obrigatório.`, 400);
  }
  return value;
}

function optionalString(value: string | undefined, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new WorkspaceError(`${name} deve ser string quando informado.`, 400);
  }
  return value;
}

function optionalQueryString(value: string | undefined, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new WorkspaceError(`${name} deve ser string quando informado.`, 400);
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function optionalPositiveInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new WorkspaceError(`${name} deve ser inteiro positivo quando informado.`, 400);
  }
  return parsed;
}

function optionalBuilderAuthAuditStatus(value: string | undefined, name: string): BuilderAuthAuditStatus | undefined {
  const normalized = optionalQueryString(value, name);
  if (normalized === undefined) {
    return undefined;
  }
  if (normalized === "allowed" || normalized === "missing" || normalized === "rejected") {
    return normalized;
  }
  throw new WorkspaceError(`${name} deve ser allowed, missing ou rejected.`, 400);
}

function optionalPositiveNumber(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new WorkspaceError(`${name} deve ser número quando informado.`, 400);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new WorkspaceError(`${name} deve ser número positivo quando informado.`, 400);
  }
  return parsed;
}

function optionalDockerRuntimeOperation(value: string | undefined, name: string): DockerRuntimeOperation | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  if (
    normalized === "prepare_env" ||
    normalized === "configure_ports" ||
    normalized === "setup_models" ||
    normalized === "build_model_image" ||
    normalized === "export_model_image" ||
    normalized === "push_model_image" ||
    normalized === "check_gpu" ||
    normalized === "build" ||
    normalized === "up" ||
    normalized === "down" ||
    normalized === "smoke" ||
    normalized === "inspect" ||
    normalized === "cancel"
  ) {
    return normalized;
  }
  throw new WorkspaceError(`${name} deve ser prepare_env, configure_ports, setup_models, build_model_image, export_model_image, push_model_image, check_gpu, build, up, down, smoke, inspect ou cancel.`, 400);
}

function optionalDockerRuntimeStatus(value: string | undefined, name: string): DockerRuntimeOperationStatus | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "idle" || normalized === "running" || normalized === "success" || normalized === "error" || normalized === "canceled") {
    return normalized;
  }
  throw new WorkspaceError(`${name} deve ser idle, running, success, error ou canceled.`, 400);
}

function optionalDockerRuntimeHistoryLevel(value: string | undefined, name: string): DockerRuntimeHistoryLevel | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "error" || normalized === "warning" || normalized === "info" || normalized === "success") {
    return normalized;
  }
  throw new WorkspaceError(`${name} deve ser error, warning, info ou success.`, 400);
}

function optionalModelExecutionProfile(value: string | undefined): DockerRuntimeModelExecutionProfile {
  if (!value) {
    return "cpu";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "cpu" || normalized === "gpu") {
    return normalized;
  }
  throw new WorkspaceError("modelExecutionProfile deve ser cpu ou gpu.", 400);
}

function optionalDockerBuildProgressStatus(value: string | undefined, name: string): DockerBuildProgressStatus | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  if (
    normalized === "running" ||
    normalized === "done" ||
    normalized === "error" ||
    normalized === "warning" ||
    normalized === "info" ||
    normalized === "canceled"
  ) {
    return normalized;
  }
  throw new WorkspaceError(`${name} deve ser running, done, error, warning, info ou canceled.`, 400);
}

function parseDateQuery(value: string | undefined, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    throw new WorkspaceError(`${name} deve ser uma data ISO válida.`, 400);
  }
  return new Date(parsed).toISOString();
}

function optionalNonNegativeInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new WorkspaceError(`${name} deve ser inteiro quando informado.`, 400);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new WorkspaceError(`${name} deve ser inteiro não negativo quando informado.`, 400);
  }
  return parsed;
}

function optionalBooleanQuery(value: string | undefined, name: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new WorkspaceError(`${name} deve ser boolean quando informado.`, 400);
  }
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new WorkspaceError(`${name} deve ser true, false, 1 ou 0.`, 400);
}

function optionalSandboxEnv(value: SandboxBody["env"] | undefined): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkspaceError("env deve ser objeto quando informado.", 400);
  }
  const env: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new WorkspaceError(`Env var inválida: ${key}`, 400);
    }
    if (typeof rawValue !== "string") {
      throw new WorkspaceError(`Env var ${key} deve ser string.`, 400);
    }
    env[key] = rawValue;
  }
  return env;
}

function optionalPorts(value: DockerRuntimeBody["ports"] | undefined): NonNullable<DockerRuntimeBody["ports"]> {
  if (value === undefined) {
    return {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorkspaceError("ports deve ser objeto quando informado.", 400);
  }
  for (const [key, port] of Object.entries(value)) {
    if (!["api", "postgres", "redis"].includes(key)) {
      throw new WorkspaceError(`Porta desconhecida: ${key}`, 400);
    }
    if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      throw new WorkspaceError(`Porta ${key} deve ser inteiro entre 1 e 65535.`, 400);
    }
  }
  return value;
}

function createEnvironmentDockerRunner(): DockerCommandRunner | undefined {
  if (process.env.AGENT_BUILDER_DOCKER_RUNNER !== "ui-audit-mock") {
    return undefined;
  }
  let state: "stopped" | "running" = "stopped";
  return async (invocation) => {
    const args = invocation.args.join(" ");
    if (args === "compose build api") {
      const chunks = [
        "#1 [internal] load build definition from Dockerfile\n",
        "#2 [internal] load metadata for docker.io/library/python:3.12-slim\n#2 DONE 0.1s\n",
        "#3 [3/8] COPY . /app\n#3 DONE 0.1s\n",
        "#4 [4/8] RUN pip install -r requirements.txt\n#4 DONE 0.2s\n",
        "#5 exporting to image\n#5 DONE 0.1s\n",
      ];
      let stdout = "";
      for (const chunk of chunks) {
        if (invocation.signal?.aborted) {
          return {
            exitCode: 130,
            stdout,
            stderr: "Comando cancelado pelo usuário.",
            aborted: true,
          };
        }
        await delay(180);
        stdout += chunk;
        invocation.onOutput?.(chunk);
      }
      return { exitCode: 0, stdout, stderr: "" };
    }
    if (args === "compose up -d --build") {
      state = "running";
      return {
        exitCode: 0,
        stdout: "Container reference-api-1 Started\nContainer reference-postgres-1 Started\nContainer reference-redis-1 Started\n",
        stderr: "",
      };
    }
    if (args === "compose down") {
      state = "stopped";
      return {
        exitCode: 0,
        stdout: "Container reference-api-1 Stopped\nContainer reference-postgres-1 Stopped\nContainer reference-redis-1 Stopped\n",
        stderr: "",
      };
    }
    if (args === "compose ps --format json") {
      return {
        exitCode: 0,
        stdout: JSON.stringify([
          {
            Name: "reference-api-1",
            Service: "api",
            State: state === "running" ? "running" : "exited",
            Status: state === "running" ? "Up 12 seconds" : "Exited (0) 3 seconds ago",
            Publishers: [{ PublishedPort: 8080, TargetPort: 8080 }],
          },
          {
            Name: "reference-postgres-1",
            Service: "postgres",
            State: state === "running" ? "running" : "exited",
            Status: state === "running" ? "Up 12 seconds" : "Exited (0) 3 seconds ago",
            Publishers: [{ PublishedPort: 5433, TargetPort: 5432 }],
          },
          {
            Name: "reference-redis-1",
            Service: "redis",
            State: state === "running" ? "running" : "exited",
            Status: state === "running" ? "Up 12 seconds" : "Exited (0) 3 seconds ago",
            Publishers: [{ PublishedPort: 6380, TargetPort: 6379 }],
          },
        ]),
        stderr: "",
      };
    }
    if (args === "compose logs --tail 120 --no-color") {
      return {
        exitCode: 0,
        stdout: state === "running"
          ? "api-1  | Application startup complete.\npostgres-1  | database system is ready\nredis-1  | Ready to accept connections\n"
          : "api-1  | Graceful shutdown complete.\n",
        stderr: "",
      };
    }
    return { exitCode: 0, stdout: `ok ${args}`, stderr: "" };
  };
}

async function assertWorkspaceGovernanceAuthorized(
  workspaceRoot: string,
  request: FastifyRequest,
  area: string,
  action: WorkspaceGovernanceAction,
): Promise<void> {
  assertBuilderAuthAreaAuthorized(request, area, action);
  if (process.env.AGENT_FLOW_WORKSPACE_GOVERNANCE_ENFORCE !== "true") {
    return;
  }
  const actorId = workspaceGovernanceActorFromRequest(request);
  const decision = await authorizeWorkspaceGovernance(workspaceRoot, { actorId, area, action }, { enforced: true });
  if (!decision.allowed) {
    throw new WorkspaceError("Ação bloqueada pela governança do workspace.", 403, { decision });
  }
}

function workspaceGovernanceActorFromRequest(request: FastifyRequest): string {
  const header = request.headers["x-agent-flow-actor"];
  if (typeof header === "string" && header.trim()) {
    return header.trim();
  }
  if (Array.isArray(header)) {
    const first = header.find((item) => item.trim());
    if (first) {
      return first.trim();
    }
  }
  const body = request.body;
  if (isRecord(body)) {
    for (const key of ["actorId", "updatedBy", "resolvedBy"]) {
      const value = body[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  return "local-studio";
}

function annotationQueueMutationContextFromRequest(request: FastifyRequest): {
  actorId: string;
  enforcePermissions: boolean;
} {
  return {
    actorId: workspaceGovernanceActorFromRequest(request),
    enforcePermissions: requestHasAgentFlowActorHeader(request),
  };
}

function assertBuilderAuthAreaAuthorized(
  request: FastifyRequest,
  area: string,
  action: WorkspaceGovernanceAction,
): void {
  const role = builderAuthRoleFromRequest(request);
  if (!role) {
    return;
  }
  const actorId = workspaceGovernanceActorFromRequest(request);
  const groups = builderAuthGroupsFromRequest(request);
  const areas = builderAuthAreasFromRequest(request);
  const requiredRole = builderAuthRequiredRoleForAction(action);
  const reasons: string[] = [];
  if (!builderAuthRoleMeets(role, requiredRole)) {
    reasons.push(`Papel ${role} não atende ao mínimo ${requiredRole} para ${action}.`);
  }
  if (!builderAuthActorHasArea(areas, area)) {
    reasons.push(`Ator ${actorId} não possui acesso à área ${area}.`);
  }
  if (!reasons.length) {
    return;
  }
  throw new WorkspaceError("Ação bloqueada pela auth local do Builder.", 403, {
    decision: {
      format: "agent-flow-builder.builder-auth-area-decision.v1",
      evaluatedAt: new Date().toISOString(),
      actorId,
      role,
      groups,
      areas,
      area,
      action,
      requiredRole,
      allowed: false,
      effect: "blocked",
      reasons,
      governance: {
        localOnly: true,
        excludesRawPayload: true,
        excludesSecretValues: true,
      },
    },
  });
}

async function assertSafetyHarnessReviewAuthorized(
  workspaceRoot: string,
  request: FastifyRequest,
): Promise<void> {
  if (!requestHasAgentFlowActorHeader(request)) {
    return;
  }
  const actorId = workspaceGovernanceActorFromRequest(request);
  const role = builderAuthRoleFromRequest(request);
  if (role) {
    const areas = builderAuthAreasFromRequest(request);
    const groups = builderAuthGroupsFromRequest(request);
    const allowed = builderAuthRoleMeets(role, "reviewer") && builderAuthActorHasArea(areas, "safety_harness");
    if (!allowed) {
      throw new WorkspaceError("Revisão do Safety Harness bloqueada pela política multiusuário local.", 403, {
        decision: {
          format: "agent-flow-builder.safety-harness-permission-decision.v1",
          evaluatedAt: new Date().toISOString(),
          actorId,
          role,
          groups,
          areas,
          action: "approve",
          allowed: false,
          effect: "blocked",
          reasons: [
            !builderAuthRoleMeets(role, "reviewer")
              ? `Papel ${role} não atende ao mínimo reviewer para revisar Safety Harness.`
              : `Ator ${actorId} não possui acesso à área safety_harness.`,
          ],
          governance: {
            localOnly: true,
            excludesRawInput: true,
            excludesSecretValues: true,
          },
        },
      });
    }
    return;
  }
  const decision = await authorizeWorkspaceGovernance(
    workspaceRoot,
    { actorId, area: "safety_harness", action: "approve" },
    { enforced: true },
  );
  if (!decision.allowed) {
    throw new WorkspaceError("Revisão do Safety Harness bloqueada pela governança do workspace.", 403, { decision });
  }
}

function safetyHarnessReviewPayloadFromRequest(request: FastifyRequest): unknown {
  const body = isRecord(request.body) ? request.body : {};
  if (!requestHasAgentFlowActorHeader(request)) {
    return body;
  }
  return {
    ...body,
    reviewer: workspaceGovernanceActorFromRequest(request),
    role: builderAuthRoleFromRequest(request) ?? body.role,
  };
}

function langSmithCloudDeploymentPayloadFromRequest(request: FastifyRequest): unknown {
  const body = isRecord(request.body) ? request.body : {};
  if (!requestHasAgentFlowActorHeader(request)) {
    return body;
  }
  return {
    ...body,
    recordedBy: workspaceGovernanceActorFromRequest(request),
    recordedRole: builderAuthRoleFromRequest(request) ?? body.recordedRole,
  };
}

function builderAuthRoleFromRequest(request: FastifyRequest): "owner" | "operator" | "reviewer" | "viewer" | null {
  if (!firstHeaderValue(request.headers["x-agent-flow-builder-key-id"])) {
    return null;
  }
  const value = firstHeaderValue(request.headers["x-agent-flow-builder-role"]);
  if (value === "owner" || value === "operator" || value === "reviewer" || value === "viewer") {
    return value;
  }
  return value ? "reviewer" : null;
}

function builderAuthGroupsFromRequest(request: FastifyRequest): string[] {
  const value = firstHeaderValue(request.headers["x-agent-flow-builder-groups"]);
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function builderAuthAreasFromRequest(request: FastifyRequest): string[] {
  const value = firstHeaderValue(request.headers["x-agent-flow-builder-areas"]);
  if (!value) {
    return ["*"];
  }
  const areas = value.split(",").map((item) => item.trim()).filter(Boolean);
  return areas.length ? areas : ["*"];
}

function firstHeaderValue(value: string | string[] | undefined): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.find((item) => item.trim())?.trim() ?? "";
  }
  return "";
}

function requiredBuilderAuthSessionToken(request: FastifyRequest): string {
  const authorization = firstHeaderValue(request.headers.authorization);
  const match = /^Bearer\s+(afbs_[^\s]+)$/i.exec(authorization);
  const token = match?.[1]?.trim() ?? "";
  if (!token) {
    throw new WorkspaceError("Use uma sessão local do Builder por Authorization: Bearer afbs_*.", 400);
  }
  return token;
}

function optionalBuilderAuthSessionToken(request: FastifyRequest): string | undefined {
  const authorization = firstHeaderValue(request.headers.authorization);
  return /^Bearer\s+(afbs_[^\s]+)$/i.exec(authorization)?.[1]?.trim() || undefined;
}

function builderAuthRequiredRoleForAction(action: WorkspaceGovernanceAction): "owner" | "operator" | "reviewer" | "viewer" {
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

function builderAuthRoleMeets(
  actual: "owner" | "operator" | "reviewer" | "viewer",
  required: "owner" | "operator" | "reviewer" | "viewer",
): boolean {
  const rank = { viewer: 0, reviewer: 1, operator: 2, owner: 3 };
  return rank[actual] >= rank[required];
}

function builderAuthActorHasArea(areas: string[], area: string): boolean {
  return areas.includes("*") || areas.includes(area);
}

function requestHasAgentFlowActorHeader(request: FastifyRequest): boolean {
  const header = request.headers["x-agent-flow-actor"];
  if (typeof header === "string") {
    return header.trim().length > 0;
  }
  return Array.isArray(header) && header.some((item) => item.trim().length > 0);
}

function isBuilderAuthPublicRoute(request: FastifyRequest): boolean {
  const pathname = request.url.split("?")[0] ?? request.url;
  return (
    pathname === "/health" ||
    pathname === "/builder-auth/status" ||
    pathname === "/builder-auth/oidc/login-url" ||
    pathname === "/builder-auth/oidc/logout-url" ||
    pathname === "/builder-auth/oidc/callback" ||
    pathname === "/builder-auth/oidc/logout-callback"
  );
}

function buildBuilderAuthOidcCallbackHtml(result: unknown): string {
  const payload = JSON.stringify({
    type: "agent-flow-builder.builder-auth-oidc-callback.v1",
    result,
  }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Agent Flow Builder OIDC</title>
</head>
<body>
  <script>
    const payload = ${payload};
    if (window.opener) {
      window.opener.postMessage(payload, "*");
    }
    document.body.textContent = "Login OIDC concluido. Esta janela pode ser fechada.";
    window.close();
  </script>
</body>
</html>`;
}

function buildBuilderAuthOidcLogoutCallbackHtml(result: unknown): string {
  const payload = JSON.stringify({
    type: "agent-flow-builder.builder-auth-oidc-logout-callback.v1",
    result,
  }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Agent Flow Builder OIDC Logout</title>
</head>
<body>
  <script>
    const payload = ${payload};
    if (window.opener) {
      window.opener.postMessage(payload, "*");
    }
    document.body.textContent = "Logout OIDC validado. Esta janela pode ser fechada.";
    window.close();
  </script>
</body>
</html>`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3333);
  const host = process.env.HOST ?? "127.0.0.1";
  const app = buildApp({ logger: true });
  await app.listen({ port, host });
}
