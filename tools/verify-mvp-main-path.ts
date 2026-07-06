import { strict as assert } from "node:assert";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../apps/builder-api/src/server.ts";
import type { DockerCommandInvocation } from "../apps/builder-api/src/docker-runtime.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const workspaceRoot = await createWorkspaceFixture();
  const dockerCalls: DockerCommandInvocation[] = [];
  const app = buildApp({
    workspaceRoot,
    dockerRunner: async (invocation) => {
      dockerCalls.push(invocation);
      invocation.onOutput?.(`#1 ${invocation.args.join(" ")}\n#1 DONE 0.1s\n`);
      return {
        exitCode: 0,
        stdout: `ok ${invocation.args.join(" ")}`,
        stderr: "",
      };
    },
  });

  const runtimeServer = createRuntimeSmokeServer();
  await listen(runtimeServer);
  const runtimeAddress = runtimeServer.address() as AddressInfo;
  const runtimeUrl = `http://127.0.0.1:${runtimeAddress.port}`;

  try {
    await app.ready();
    await exerciseFlowDraftAndValidation(app);
    await exerciseDebugEvidence(app);
    await exerciseApprovedRuntime(app, runtimeUrl);
    await exerciseApprovedManifestBundle(app, runtimeUrl);
    assert.ok(dockerCalls.some((call) => call.args.join(" ") === "compose --profile model-setup up ollama-pull-qwen3-8b"));
    assert.ok(dockerCalls.some((call) => call.args.join(" ") === "compose build api"));
    assert.ok(dockerCalls.some((call) => call.args.join(" ") === "compose up -d --build"));
    console.log("MVP main path verified: draft -> validate -> debug evidence -> approve -> runtime ZIP -> local model setup -> Docker smoke -> approved bundle.");
  } finally {
    await app.close();
    await new Promise<void>((resolve) => runtimeServer.close(() => resolve()));
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function createWorkspaceFixture(): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-flow-mvp-main-path-"));
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

async function exerciseFlowDraftAndValidation(app: ReturnType<typeof buildApp>): Promise<void> {
  const loaded = await injectJson(app, "GET", "/flows/reference-interview");
  const flow = loaded.flow;
  flow.llm = {
    adapter: "ollama",
    model: "qwen3:8b",
    apiKeyEnv: "OLLAMA_API_KEY",
    baseUrlEnv: "OLLAMA_BASE_URL",
    mockEnv: "MOCK_LLM",
  };
  flow.nodes = flow.nodes.map((node: Record<string, unknown>, index: number) => (
    index === 0
      ? { ...node, position: { x: 32, y: 48 } }
      : node.id === "llm_step"
        ? { ...node, llm: { adapter: "ollama", model: "qwen3:8b" } }
        : node
  ));
  const saved = await injectJson(app, "PUT", "/flows/reference-interview", flow);
  assert.equal(saved.flow.nodes[0].position.x, 32);

  const validation = await injectJson(app, "POST", "/flows/reference-interview/validate");
  assert.equal(validation.status, "ok");
  assert.equal(validation.summary.errors, 0);

  const blockedRuntime = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/generate-approved-runtime",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/mvp-approved-runtime" },
  });
  assert.equal(blockedRuntime.statusCode, 409);
}

async function exerciseDebugEvidence(app: ReturnType<typeof buildApp>): Promise<void> {
  const run = await injectJson(app, "POST", "/flows/reference-interview/studio-runs", {
    runtimeUrl: "http://127.0.0.1:8090",
    resourceName: "sessions",
    session: {
      session_id: "mvp-session",
      status: "running",
      phase: "collecting",
      turn: 1,
      max_turns: 3,
      metadata: { source: "mvp-main-path", agent_id: "reference-interview" },
      is_complete: false,
    },
    transcript: [
      { seq: 1, role: "assistant", code: "QUESTION", content: "Qual é a meta?", metadata: {} },
      { seq: 2, role: "user", content: "Crescer vendas.", metadata: {} },
    ],
    events: [
      { seq: 1, event_type: "session_started", node: "start", payload: { turn: 0 } },
      {
        seq: 2,
        event_type: "llm_completed",
        node: "llm_step",
        payload: {
          turn: 1,
          status: "ok",
          usage: { total_tokens: 42 },
          cost: { total_usd: 0.0012 },
          llm: { adapter: "ollama", model: "qwen3:8b" },
        },
      },
    ],
    logs: ["mvp verifier run"],
  });
  assert.equal(run.id, "run-mvp-session");
  assert.equal(run.messageCount, 2);
  assert.equal(run.eventCount, 2);
  assert.ok(run.snapshotCount >= 1);

  const runs = await injectJson(app, "GET", "/flows/reference-interview/studio-runs");
  assert.equal(runs.runs.length, 1);
  assert.equal(runs.runs[0].id, "run-mvp-session");
}

async function exerciseApprovedRuntime(app: ReturnType<typeof buildApp>, runtimeUrl: string): Promise<void> {
  await injectJson(app, "POST", "/flows/reference-interview/generate-langgraph-sandbox", {
    outDir: "generated/mvp-langgraph-sandbox",
  });
  const approval = await injectJson(app, "POST", "/flows/reference-interview/approve-langgraph-sandbox", {
    outDir: "generated/mvp-langgraph-sandbox",
    approvalEvidence: {
      source: "studio",
      runId: "run-mvp-session",
      sessionId: "mvp-session",
      agentId: "reference-interview",
      eventCount: 2,
      visibleEventCount: 2,
      selectedEventSeq: 2,
      selectedEventType: "llm_completed",
      selectedNodeId: "llm_step",
      latestEventSeq: 2,
      latestEventType: "llm_completed",
      capturedAt: "2026-07-02T12:30:00.000Z",
      excludesRawPayloads: true,
      excludesSecretValues: true,
      rawPayload: { shouldNotPersist: true },
      secretValue: "should-not-persist",
    },
  });
  assert.equal(approval.approval.status, "approved");
  assert.equal(approval.approval.evidence.runId, "run-mvp-session");
  assert.equal(approval.approval.evidence.selectedNodeId, "llm_step");
  assert.equal(approval.approval.evidence.excludesRawPayloads, true);
  assert.equal(approval.approval.evidence.excludesSecretValues, true);
  assert.equal(approval.approval.evidence.rawPayload, undefined);
  assert.equal(approval.approval.evidence.secretValue, undefined);

  const handoff = await injectJson(app, "POST", "/flows/reference-interview/generate-langsmith-cloud-handoff");
  assert.equal(handoff.handoff.format, "agent-flow-builder.langsmith-cloud-handoff.v1");
  assert.equal(handoff.handoff.status, "ready");
  assert.equal(handoff.handoff.sandbox.status, "ready");
  assert.equal(handoff.handoff.approval.ready, true);
  assert.equal(handoff.handoff.approval.evidence.runId, "run-mvp-session");
  assert.equal(handoff.handoff.environment.includesEnvValues, false);
  assert.equal(handoff.handoff.governance.doesNotCallCloud, true);
  assert.equal(handoff.handoff.governance.cloudTokenNotStored, true);
  assert.equal(handoff.handoff.governance.includesSecrets, false);
  assert.equal(JSON.stringify(handoff.handoff).includes("should-not-persist"), false);
  assert.ok(handoff.handoff.commands.some((command: { command: string | null }) => command.command === "langgraph dev"));

  const cloudDeployment = await injectJson(app, "POST", "/flows/reference-interview/langsmith-cloud-deployments", {
    status: "verified",
    deploymentName: "MVP cloud evidence",
    deploymentUrl: "https://smith.langchain.com/o/acme/projects/demo?token=should-not-persist",
    recordedBy: "mvp-owner",
    recordedRole: "owner",
  });
  assert.equal(cloudDeployment.deployments.format, "agent-flow-builder.langsmith-cloud-deployments.v1");
  assert.equal(cloudDeployment.deployments.latestStatus, "verified");
  assert.equal(cloudDeployment.deployments.deployments[0].deploymentUrl, "https://smith.langchain.com/o/acme/projects/demo");
  assert.equal(cloudDeployment.deployments.deployments[0].handoffPackageHash, handoff.handoff.packageHash);
  assert.equal(JSON.stringify(cloudDeployment.deployments).includes("should-not-persist"), false);

  const runtime = await injectJson(app, "POST", "/flows/reference-interview/generate-approved-runtime", {
    outDir: "generated/mvp-approved-runtime",
  });
  assert.equal(runtime.outDir, "generated/mvp-approved-runtime");
  assert.equal(runtime.approval.flowHash, approval.approval.flowHash);
  assert.equal(runtime.approval.evidence.runId, "run-mvp-session");

  const listing = await injectJson(app, "GET", "/artifacts?outDir=generated%2Fmvp-approved-runtime");
  assert.equal(listing.exportAudit.ready, true);
  assert.equal(listing.exportAudit.target, "fastapi-runtime");
  assert.deepEqual(listing.exportAudit.blockers, []);
  const modelSetupStep = listing.exportAudit.runbook.steps.find((step: { id: string }) => step.id === "model_setup");
  assert.equal(modelSetupStep?.command, "docker compose --profile model-setup up ollama-pull-qwen3-8b");

  const archive = await app.inject({
    method: "GET",
    url: "/artifacts/archive?outDir=generated%2Fmvp-approved-runtime",
  });
  assert.equal(archive.statusCode, 200);
  assert.match(archive.body, /mvp-approved-runtime\/\.agent-flow\/export-manifest\.json/);
  assert.match(archive.body, /mvp-approved-runtime\/\.agent-flow\/langgraph-sandbox-approval\.json/);
  const runtimeApprovalFile = await injectJson(
    app,
    "GET",
    "/artifacts/file?outDir=generated%2Fmvp-approved-runtime&path=.agent-flow%2Flanggraph-sandbox-approval.json",
  );
  const runtimeApproval = JSON.parse(runtimeApprovalFile.content);
  assert.equal(runtimeApproval.evidence.runId, "run-mvp-session");
  assert.equal(runtimeApproval.evidence.rawPayload, undefined);

  const prepare = await injectJson(app, "POST", "/docker-runtime/prepare-env", {
    outDir: "generated/mvp-approved-runtime",
  });
  assert.equal(prepare.ok, true);

  const setupModels = await injectJson(app, "POST", "/docker-runtime/setup-models", {
    outDir: "generated/mvp-approved-runtime",
  });
  assert.equal(setupModels.ok, true);
  assert.deepEqual(setupModels.args, ["compose", "--profile", "model-setup", "up", "ollama-pull-qwen3-8b"]);

  const build = await injectJson(app, "POST", "/docker-runtime/build", {
    outDir: "generated/mvp-approved-runtime",
  });
  assert.equal(build.ok, true);

  const up = await injectJson(app, "POST", "/docker-runtime/up", {
    outDir: "generated/mvp-approved-runtime",
  });
  assert.equal(up.ok, true);

  const smoke = await injectJson(app, "POST", "/docker-runtime/smoke", {
    outDir: "generated/mvp-approved-runtime",
    runtimeUrl,
  });
  assert.equal(smoke.ok, true);
  assert.equal(smoke.target, "fastapi-runtime");
  assert.equal(smoke.smoke.basePath, "/sessions");
  assert.equal(smoke.smoke.transcriptCount, 1);
  assert.equal(smoke.smoke.eventsCount, 1);
}

async function exerciseApprovedManifestBundle(app: ReturnType<typeof buildApp>, runtimeUrl: string): Promise<void> {
  const bundle = await injectJson(app, "POST", "/runtime-manifest/generate-approved", {
    outDir: "generated/mvp-approved-bundle",
  });
  assert.equal(bundle.outDir, "generated/mvp-approved-bundle");
  assert.equal(bundle.approvalPackagePath, ".agent-flow/langgraph-sandbox-approval.json");
  assert.equal(bundle.approvals.length, 1);
  assert.equal(bundle.approvals[0].evidence.runId, "run-mvp-session");

  const listing = await injectJson(app, "GET", "/artifacts?outDir=generated%2Fmvp-approved-bundle");
  assert.equal(listing.exportAudit.ready, true);
  assert.equal(listing.exportAudit.target, "runtime-manifest-bundle");
  assert.deepEqual(listing.exportAudit.blockers, []);
  const modelSetupStep = listing.exportAudit.runbook.steps.find((step: { id: string }) => step.id === "model_setup");
  assert.equal(modelSetupStep?.command, "docker compose --profile model-setup up ollama-pull-qwen3-8b");
  const bundleApprovalFile = await injectJson(
    app,
    "GET",
    "/artifacts/file?outDir=generated%2Fmvp-approved-bundle&path=.agent-flow%2Flanggraph-sandbox-approval.json",
  );
  const bundleApproval = JSON.parse(bundleApprovalFile.content);
  assert.equal(bundleApproval.approvals[0].evidence.runId, "run-mvp-session");

  const setupModels = await injectJson(app, "POST", "/docker-runtime/setup-models", {
    outDir: "generated/mvp-approved-bundle",
  });
  assert.equal(setupModels.ok, true);
  assert.deepEqual(setupModels.args, ["compose", "--profile", "model-setup", "up", "ollama-pull-qwen3-8b"]);

  const smoke = await injectJson(app, "POST", "/docker-runtime/smoke", {
    outDir: "generated/mvp-approved-bundle",
    runtimeUrl,
    agentId: "reference-interview",
  });
  assert.equal(smoke.ok, true);
  assert.equal(smoke.target, "runtime-manifest-bundle");
  assert.equal(smoke.smoke.agentId, "reference-interview");
  assert.equal(smoke.smoke.basePath, "/reference-interview/sessions");
}

async function injectJson(
  app: ReturnType<typeof buildApp>,
  method: "GET" | "POST" | "PUT",
  url: string,
  payload?: unknown,
): Promise<any> {
  const response = await app.inject({
    method,
    url,
    headers: payload === undefined ? undefined : { "content-type": "application/json" },
    payload,
  });
  assert.equal(response.statusCode, 200, `${method} ${url} -> ${response.statusCode}: ${response.body}`);
  return response.json();
}

function createRuntimeSmokeServer() {
  return createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    const method = request.method ?? "GET";
    const url = request.url ?? "/";
    const body = method === "POST" ? await readJsonBody(request) : {};
    const normalized = url.replace(/\/+$/, "") || "/";
    const route = normalized.startsWith("/reference-interview")
      ? normalized.slice("/reference-interview".length) || "/"
      : normalized;
    const sessionPrefix = normalized.startsWith("/reference-interview") ? "/reference-interview" : "";

    if (method === "GET" && normalized === "/health") {
      return json(response, { status: "ok" });
    }
    if (method === "GET" && (normalized === "/metadata" || normalized === "/reference-interview/metadata")) {
      return json(response, {
        agent_id: "reference-interview",
        resource_name: "sessions",
        contract: "sessions-v1",
      });
    }
    if (method === "POST" && route === "/sessions") {
      assert.deepEqual((body as Record<string, unknown>).metadata, {
        source: "builder-api-smoke",
        ...(sessionPrefix ? { agent_id: "reference-interview" } : {}),
      });
      return json(response, { session: { session_id: sessionPrefix ? "bundle-smoke-session" : "smoke-session" } });
    }
    if (method === "POST" && /^\/sessions\/[^/]+\/start$/.test(route)) {
      return json(response, { ok: true });
    }
    if (method === "POST" && /^\/sessions\/[^/]+\/turn$/.test(route)) {
      return json(response, { ok: true, output: { content: "ok" } });
    }
    if (method === "GET" && /^\/sessions\/[^/]+\/transcript$/.test(route)) {
      return json(response, [{ seq: 1, role: "assistant", content: "ok" }]);
    }
    if (method === "GET" && /^\/sessions\/[^/]+\/events$/.test(route)) {
      return json(response, [{ seq: 1, event_type: "session_started" }]);
    }

    response.statusCode = 404;
    return json(response, { error: "not_found", method, url });
  });
}

function listen(server: ReturnType<typeof createRuntimeSmokeServer>): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  return raw ? JSON.parse(raw) : {};
}

function json(response: ServerResponse, payload: unknown): void {
  response.end(JSON.stringify(payload));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
