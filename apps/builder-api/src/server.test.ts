import { strict as assert } from "node:assert";
import { access, cp, mkdir, mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildApp } from "./server.ts";
import type { DockerCommandInvocation } from "./docker-runtime.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function createWorkspaceFixture(): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-builder-api-"));
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

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  return raw ? JSON.parse(raw) : {};
}

test("Builder API lists, validates, reads and generates the reference flow", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const dockerCalls: DockerCommandInvocation[] = [];
  let cancelNextBuild = false;
  const app = buildApp({
    workspaceRoot,
    dockerRunner: async (invocation) => {
      dockerCalls.push(invocation);
      if (invocation.args.join(" ") === "compose ps --format json") {
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              Name: "reference-api-1",
              Service: "api",
              State: "running",
              Status: "Up 10 seconds",
              Publishers: [{ PublishedPort: 8080, TargetPort: 8080 }],
            },
          ]),
          stderr: "",
        };
      }
      if (invocation.args.join(" ") === "compose logs --tail 120 --no-color") {
        return {
          exitCode: 0,
          stdout: "api-1  | Application startup complete.",
          stderr: "",
        };
      }
      if (invocation.args.join(" ") === "compose build api") {
        if (cancelNextBuild) {
          invocation.onOutput?.("#1 [internal] load build definition from Dockerfile\n");
          return new Promise((resolve) => {
            const finishCanceled = () =>
              resolve({
                exitCode: 130,
                stdout: "#1 [internal] load build definition from Dockerfile\n",
                stderr: "Comando cancelado pelo usuário.",
                aborted: true,
              });
            if (invocation.signal?.aborted) {
              finishCanceled();
              return;
            }
            invocation.signal?.addEventListener("abort", finishCanceled, { once: true });
          });
        }
        invocation.onOutput?.("#1 [internal] load build definition from Dockerfile\n");
        await new Promise((resolve) => setTimeout(resolve, 50));
        invocation.onOutput?.("#2 [internal] load metadata for docker.io/library/node:20\n#2 DONE 0.2s\n");
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          exitCode: 0,
          stdout:
            "#0 [internal] load .dockerignore\n" +
            "#1 [internal] load build definition from Dockerfile\n" +
            "#2 [internal] load metadata for docker.io/library/node:20\n" +
            "#2 DONE 0.2s\n" +
            "#3 [3/8] COPY . /app\n" +
            "#3 DONE 0.1s\n" +
            "#4 [4/8] RUN pip install -r requirements.txt\n" +
            "#4 DONE 2.5s\n" +
            "#5 [5/8] RUN pytest\n" +
            "#5 DONE 1.4s\n" +
            "#6 exporting to image\n" +
            " => exporting layers\n" +
            " => writing image sha256:...",
          stderr: "",
        };
      }
      return {
        exitCode: 0,
        stdout: `ok ${invocation.args.join(" ")}`,
        stderr: "",
      };
    },
  });
  t.after(() => app.close());

  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().status, "ok");

  const flows = await app.inject({ method: "GET", url: "/flows" });
  assert.equal(flows.statusCode, 200);
  assert.equal(flows.json().flows[0].id, "reference-interview");

  const adapters = await app.inject({ method: "GET", url: "/llm-adapters" });
  assert.equal(adapters.statusCode, 200);
  assert.ok(adapters.json().adapters.some((adapter: { id: string; status: string }) => adapter.id === "openrouter" && adapter.status === "supported"));

  const loaded = await app.inject({ method: "GET", url: "/flows/reference-interview" });
  assert.equal(loaded.statusCode, 200);
  assert.equal(loaded.json().flow.id, "reference-interview");

  const validated = await app.inject({ method: "POST", url: "/flows/reference-interview/validate" });
  assert.equal(validated.statusCode, 200);
  assert.equal(validated.json().status, "ok");
  assert.equal(validated.json().nodes, 6);
  assert.equal(validated.json().summary.errors, 0);
  assert.equal(validated.json().diagnostics.length, 0);

  const emptyStudioRuns = await app.inject({ method: "GET", url: "/flows/reference-interview/studio-runs" });
  assert.equal(emptyStudioRuns.statusCode, 200);
  assert.deepEqual(emptyStudioRuns.json().runs, []);

  const studioRun = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/studio-runs",
    headers: { "content-type": "application/json" },
    payload: {
      runtimeUrl: "http://127.0.0.1:8090",
      resourceName: "sessions",
      session: {
        session_id: "session-abc",
        status: "running",
        phase: "collecting",
        turn: 1,
        max_turns: 3,
        metadata: {
          source: "test",
          agent_id: "reference-interview",
          scenario: { id: "scenario-pinned", label: "Replay pinado", useNodePins: true },
          nodePins: { enabled: true, mode: "mock", items: [{ nodeId: "ask_question", output: { text: "pin" } }] },
        },
        is_complete: false,
      },
      transcript: [
        { seq: 1, role: "assistant", code: "QUESTION", content: "Qual é a meta?", metadata: {} },
        { seq: 2, role: "user", content: "Crescer vendas.", metadata: {} },
      ],
      events: [
        { seq: 1, event_type: "session_started", node: "start", payload: { turn: 0, custom: { marker: "left" } } },
        {
          seq: 2,
          event_type: "llm_completed",
          node: "ask_question",
          payload: {
            turn: 1,
            status: "ok",
            pinned: true,
            mock: true,
            usage: { total_tokens: 42 },
            cost: { total_usd: 0.0012 },
          },
        },
      ],
      logs: ["runtime ready"],
    },
  });
  assert.equal(studioRun.statusCode, 200);
  assert.equal(studioRun.json().id, "run-session-abc");
  assert.equal(studioRun.json().agentId, "reference-interview");
  assert.equal(studioRun.json().session.agent_id, "reference-interview");
  assert.equal(studioRun.json().events[0].agent_id, "reference-interview");
  assert.equal(studioRun.json().messageCount, 2);
  assert.equal(studioRun.json().eventCount, 2);
  assert.equal(studioRun.json().snapshotCount, 2);
  assert.equal(studioRun.json().nodeCount, 2);
  assert.deepEqual(studioRun.json().causalAnalysis, {
    failedEventSeq: null,
    failedEventType: null,
    failedNode: null,
    upstreamPath: [],
    impactPath: [],
    impactedNodes: [],
  });
  assert.equal(studioRun.json().stateSnapshots[1].node, "ask_question");
  assert.ok(studioRun.json().stateSnapshots[1].diff.some((entry: { path: string }) => entry.path.includes("nodes.ask_question")));

  const studioRuns = await app.inject({ method: "GET", url: "/flows/reference-interview/studio-runs" });
  assert.equal(studioRuns.statusCode, 200);
  assert.equal(studioRuns.json().runs.length, 1);
  assert.equal(studioRuns.json().runs[0].id, "run-session-abc");
  assert.equal(studioRuns.json().runs[0].agentId, "reference-interview");
  assert.equal(studioRuns.json().runs[0].runtimeUrl, "http://127.0.0.1:8090");
  assert.equal(studioRuns.json().runs[0].snapshotCount, 2);
  assert.equal(studioRuns.json().runs[0].causalAnalysis.failedNode, null);

  const errorStudioRun = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/studio-runs",
    headers: { "content-type": "application/json" },
    payload: {
      runtimeUrl: "http://127.0.0.1:8091",
      resourceName: "sessions",
      session: {
        session_id: "session-erro",
        status: "error",
        phase: "finalizing",
        turn: 3,
        max_turns: 3,
        metadata: {
          source: "test",
          scenario: {
            id: "scenario-error",
            label: "Erro controlado",
            regressionThresholds: { tokenGrowthPct: 7, costGrowthPct: 8, durationGrowthPct: 9 },
          },
        },
        is_complete: true,
      },
      transcript: [{ seq: 1, role: "assistant", code: "DONE", content: "Vamos encerrar.", metadata: {} }],
      events: [
        { seq: 1, event_type: "session_started", node: "start", payload: { turn: 0, custom: { marker: "right" } } },
        { seq: 2, event_type: "node_failed", node: "finish", payload: { status: "error" } },
      ],
      logs: ["erro de integração"],
    },
  });
  assert.equal(errorStudioRun.statusCode, 200);
  assert.equal(errorStudioRun.json().id, "run-session-erro");
  assert.equal(errorStudioRun.json().errorCount, 1);
  assert.equal(errorStudioRun.json().isComplete, true);
  assert.equal(errorStudioRun.json().causalAnalysis.failedEventSeq, 2);
  assert.equal(errorStudioRun.json().causalAnalysis.failedEventType, "node_failed");
  assert.equal(errorStudioRun.json().causalAnalysis.failedNode, "finish");
  assert.deepEqual(errorStudioRun.json().causalAnalysis.upstreamPath, ["finish"]);
  assert.deepEqual(errorStudioRun.json().causalAnalysis.impactPath, ["finish"]);
  assert.deepEqual(errorStudioRun.json().causalAnalysis.impactedNodes, ["finish"]);

  const multiParentCausalStudioRun = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/studio-runs",
    headers: { "content-type": "application/json" },
    payload: {
      runtimeUrl: "http://127.0.0.1:8092",
      resourceName: "sessions",
      session: {
        session_id: "session-multi-parent",
        status: "error",
        phase: "finalizing",
        turn: 3,
        max_turns: 3,
        metadata: { source: "test", agent_id: "support-agent" },
        is_complete: true,
      },
      transcript: [],
      events: [
        { seq: 1, event_type: "session_started", node: "start", payload: { turn: 0, status: "ok" } },
        { seq: 2, event_type: "node_completed", node: "deterministic_gate", payload: { status: "ok" } },
        { seq: 3, event_type: "node_failed", node: "end", payload: { status: "error" } },
      ],
      logs: ["falha de agregação", "rollback acionado"],
    },
  });
  assert.equal(multiParentCausalStudioRun.statusCode, 200);
  assert.equal(multiParentCausalStudioRun.json().agentId, "support-agent");
  assert.equal(multiParentCausalStudioRun.json().causalAnalysis.failedEventSeq, 3);
  assert.equal(multiParentCausalStudioRun.json().causalAnalysis.failedNode, "end");
  assert.deepEqual(
    multiParentCausalStudioRun.json().causalAnalysis.upstreamPath,
    ["deterministic_gate", "end"],
  );
  assert.deepEqual(multiParentCausalStudioRun.json().causalAnalysis.impactPath, ["end"]);
  assert.deepEqual(multiParentCausalStudioRun.json().causalAnalysis.impactedNodes, ["end"]);

  const impactAfterFailureStudioRun = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/studio-runs",
    headers: { "content-type": "application/json" },
    payload: {
      runtimeUrl: "http://127.0.0.1:8093",
      resourceName: "sessions",
      session: {
        session_id: "session-impact",
        status: "error",
        phase: "finalizing",
        turn: 3,
        max_turns: 3,
        metadata: { source: "test" },
        is_complete: true,
      },
      transcript: [],
      events: [
        { seq: 1, event_type: "session_started", node: "start", payload: { turn: 0, status: "ok" } },
        { seq: 2, event_type: "node_failed", node: "start", payload: { status: "failed" } },
        { seq: 3, event_type: "node_started", node: "input_safety_check", payload: { status: "running" } },
        { seq: 4, event_type: "node_completed", node: "llm_step", payload: { status: "ok" } },
        { seq: 5, event_type: "node_completed", node: "output_safety_check", payload: { status: "ok" } },
        { seq: 6, event_type: "node_completed", node: "deterministic_gate", payload: { status: "ok" } },
      ],
      logs: ["executou após falha"],
    },
  });
  assert.equal(impactAfterFailureStudioRun.statusCode, 200);
  assert.equal(impactAfterFailureStudioRun.json().causalAnalysis.failedEventSeq, 2);
  assert.equal(impactAfterFailureStudioRun.json().causalAnalysis.failedNode, "start");
  assert.deepEqual(impactAfterFailureStudioRun.json().causalAnalysis.upstreamPath, ["start"]);
  assert.equal(impactAfterFailureStudioRun.json().causalAnalysis.impactPath.at(0), "start");
  assert.equal(impactAfterFailureStudioRun.json().causalAnalysis.impactPath.at(-1), "deterministic_gate");
  assert.deepEqual(impactAfterFailureStudioRun.json().causalAnalysis.impactedNodes, [
    "start",
    "input_safety_check",
    "llm_step",
    "output_safety_check",
    "deterministic_gate",
  ]);

  const studioRunsFilteredByStatus = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-runs?status=error",
  });
  assert.equal(studioRunsFilteredByStatus.statusCode, 200);
  assert.equal(studioRunsFilteredByStatus.json().runs.length, 3);
  assert.ok(studioRunsFilteredByStatus.json().runs.some((run: { sessionId: string }) => run.sessionId === "session-erro"));
  assert.ok(studioRunsFilteredByStatus.json().runs.some((run: { sessionId: string }) => run.sessionId === "session-multi-parent"));
  assert.ok(studioRunsFilteredByStatus.json().runs.some((run: { sessionId: string }) => run.sessionId === "session-impact"));

  const studioRunsFilteredByHasErrors = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-runs?hasErrors=true",
  });
  assert.equal(studioRunsFilteredByHasErrors.statusCode, 200);
  assert.equal(studioRunsFilteredByHasErrors.json().runs.length, 3);
  assert.ok(studioRunsFilteredByHasErrors.json().runs.some((run: { sessionId: string }) => run.sessionId === "session-erro"));

  const studioRunsWithoutErrors = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-runs?hasErrors=false",
  });
  assert.equal(studioRunsWithoutErrors.statusCode, 200);
  assert.equal(studioRunsWithoutErrors.json().runs.length, 1);
  assert.equal(studioRunsWithoutErrors.json().runs[0].sessionId, "session-abc");

  const studioRunsFilteredBySearch = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-runs?q=session-abc",
  });
  assert.equal(studioRunsFilteredBySearch.statusCode, 200);
  assert.equal(studioRunsFilteredBySearch.json().runs.length, 1);
  assert.equal(studioRunsFilteredBySearch.json().runs[0].sessionId, "session-abc");

  const studioRunsFilteredByAgent = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-runs?agentId=support-agent",
  });
  assert.equal(studioRunsFilteredByAgent.statusCode, 200);
  assert.equal(studioRunsFilteredByAgent.json().runs.length, 1);
  assert.equal(studioRunsFilteredByAgent.json().runs[0].sessionId, "session-multi-parent");
  assert.equal(studioRunsFilteredByAgent.json().runs[0].agentId, "support-agent");

  const studioRunsCompared = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-runs/compare?left=run-session-abc&right=run-session-erro",
  });
  assert.equal(studioRunsCompared.statusCode, 200);
  assert.equal(studioRunsCompared.json().format, "agent-flow-builder.studio-run-comparison.v1");
  assert.equal(studioRunsCompared.json().flowId, "reference-interview");
  assert.equal(studioRunsCompared.json().leftRunId, "run-session-abc");
  assert.equal(studioRunsCompared.json().rightRunId, "run-session-erro");
  assert.equal(studioRunsCompared.json().metrics.statusChanged, true);
  assert.equal(studioRunsCompared.json().metrics.phaseChanged, true);
  assert.equal(studioRunsCompared.json().metrics.isCompleteChanged, true);
  assert.equal(studioRunsCompared.json().metrics.errorCountDelta, 1);
  assert.equal(studioRunsCompared.json().metrics.pinnedEventCountLeft, 1);
  assert.equal(studioRunsCompared.json().metrics.pinnedEventCountRight, 0);
  assert.equal(studioRunsCompared.json().metrics.mockEventCountLeft, 1);
  assert.equal(studioRunsCompared.json().metrics.totalTokensLeft, 42);
  assert.equal(studioRunsCompared.json().metrics.totalTokensRight, null);
  assert.equal(studioRunsCompared.json().metrics.totalCostUsdLeft, 0.0012);
  assert.equal(studioRunsCompared.json().metrics.runKindLeft, "pinned");
  assert.equal(studioRunsCompared.json().metrics.runKindRight, "live");
  assert.equal(studioRunsCompared.json().regression.severity, "fail");
  assert.equal(studioRunsCompared.json().regression.comparesPinnedToLive, true);
  assert.deepEqual(studioRunsCompared.json().regression.appliedThresholds, {
    tokenGrowthPct: 7,
    costGrowthPct: 8,
    durationGrowthPct: 9,
  });
  assert.ok(studioRunsCompared.json().regression.reasons.some((reason: string) => reason.includes("erros aumentaram")));
  assert.deepEqual(studioRunsCompared.json().nodeDiff.leftOnly, ["ask_question"]);
  assert.deepEqual(studioRunsCompared.json().nodeDiff.rightOnly, ["finish"]);
  assert.deepEqual(studioRunsCompared.json().nodeDiff.both, ["start"]);
  assert.equal(studioRunsCompared.json().nodeComparisons.length, 3);
  const startComparison = studioRunsCompared.json().nodeComparisons.find((node: { nodeId: string }) => node.nodeId === "start");
  assert.equal(typeof startComparison, "object");
  assert.equal(startComparison.changed, true);
  assert.deepEqual(
    studioRunsCompared.json().nodeComparisons
      .filter((node: { inLeft: boolean; inRight: boolean }) => node.inLeft && node.inRight)
      .map((node: { nodeId: string }) => node.nodeId),
    ["start"],
  );

  const studioRunsByStartNode = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-runs?node=start",
  });
  assert.equal(studioRunsByStartNode.statusCode, 200);
  assert.equal(studioRunsByStartNode.json().runs.length, 4);
  const studioRunsByAskNode = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-runs?node=ask_question",
  });
  assert.equal(studioRunsByAskNode.statusCode, 200);
  assert.equal(studioRunsByAskNode.json().runs.length, 1);
  assert.equal(studioRunsByAskNode.json().runs[0].id, "run-session-abc");
  const studioRunsByFinishNode = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-runs?node=finish",
  });
  assert.equal(studioRunsByFinishNode.statusCode, 200);
  assert.equal(studioRunsByFinishNode.json().runs.length, 1);
  assert.equal(studioRunsByFinishNode.json().runs[0].id, "run-session-erro");

  const studioRunAbcPath = path.join(workspaceRoot, "flows", "reference-interview", ".agent-flow", "studio-runs", "run-session-abc.json");
  const studioRunErroPath = path.join(workspaceRoot, "flows", "reference-interview", ".agent-flow", "studio-runs", "run-session-erro.json");
  const studioRunAbc = JSON.parse(await readFile(studioRunAbcPath, "utf-8")) as Record<string, unknown>;
  const studioRunErro = JSON.parse(await readFile(studioRunErroPath, "utf-8")) as Record<string, unknown>;
  studioRunAbc.createdAt = "2026-01-01T12:00:00.100Z";
  studioRunAbc.updatedAt = "2026-01-01T12:00:00.250Z";
  studioRunErro.createdAt = "2026-01-01T12:00:00.100Z";
  studioRunErro.updatedAt = "2026-01-01T12:00:05.500Z";
  studioRunErro.completedAt = "2026-01-01T12:00:05.500Z";
  await writeFile(studioRunAbcPath, JSON.stringify(studioRunAbc, null, 2), "utf-8");
  await writeFile(studioRunErroPath, JSON.stringify(studioRunErro, null, 2), "utf-8");

  const studioRunsFilteredByMinDuration = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-runs?minDurationMs=100",
  });
  assert.equal(studioRunsFilteredByMinDuration.statusCode, 200);
  assert.equal(studioRunsFilteredByMinDuration.json().runs.length, 2);

  const studioRunsFilteredByMaxDuration = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-runs?maxDurationMs=300",
  });
  assert.equal(studioRunsFilteredByMaxDuration.statusCode, 200);
  assert.equal(studioRunsFilteredByMaxDuration.json().runs.length, 3);

  const studioRunsFilteredByDurationRange = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-runs?minDurationMs=1000&maxDurationMs=10000",
  });
  assert.equal(studioRunsFilteredByDurationRange.statusCode, 200);
  assert.equal(studioRunsFilteredByDurationRange.json().runs.length, 1);
  assert.equal(studioRunsFilteredByDurationRange.json().runs[0].id, "run-session-erro");

  const studioRunsInvalidDurationRange = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-runs?minDurationMs=150&maxDurationMs=100",
  });
  assert.equal(studioRunsInvalidDurationRange.statusCode, 400);
  assert.equal(studioRunsInvalidDurationRange.json().error, "workspace_error");

  const invalidStudioRunComparison = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-runs/compare?left=run-session-abc&right=run-session-abc",
  });
  assert.equal(invalidStudioRunComparison.statusCode, 400);
  assert.equal(invalidStudioRunComparison.json().error, "workspace_error");

  const missingCompareParams = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-runs/compare?left=run-session-abc",
  });
  assert.equal(missingCompareParams.statusCode, 400);
  assert.equal(missingCompareParams.json().error, "workspace_error");

  const studioRunExport = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-runs/run-session-erro/export",
  });
  assert.equal(studioRunExport.statusCode, 200);
  assert.equal(studioRunExport.json().format, "agent-flow-builder.studio-run-export.v1");
  assert.equal(studioRunExport.json().flowId, "reference-interview");
  assert.equal(studioRunExport.json().run.id, "run-session-erro");
  assert.equal(studioRunExport.json().run.sessionId, "session-erro");
  assert.equal(studioRunExport.json().run.status, "error");

  const invalidHasErrorsQuery = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-runs?hasErrors=maybe",
  });
  assert.equal(invalidHasErrorsQuery.statusCode, 400);
  assert.equal(invalidHasErrorsQuery.json().error, "workspace_error");

  const invalidStudioRunDurationQuery = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-runs?minDurationMs=abc",
  });
  assert.equal(invalidStudioRunDurationQuery.statusCode, 400);
  assert.equal(invalidStudioRunDurationQuery.json().error, "workspace_error");

  const loadedStudioRun = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-runs/run-session-abc",
  });
  assert.equal(loadedStudioRun.statusCode, 200);
  assert.equal(loadedStudioRun.json().session.session_id, "session-abc");
  assert.equal(loadedStudioRun.json().transcript.length, 2);
  assert.equal(loadedStudioRun.json().events[1].node, "ask_question");
  assert.equal(loadedStudioRun.json().stateSnapshots.length, 2);
  assert.equal(loadedStudioRun.json().stateSnapshots[1].state.counters.nodes, 2);
  await access(path.join(workspaceRoot, "flows", "reference-interview", ".agent-flow", "studio-runs", "run-session-abc.json"));

  const studioRunErroLegacy = structuredClone(studioRunErro as Record<string, unknown>);
  delete studioRunErroLegacy.causalAnalysis;
  await writeFile(studioRunErroPath, JSON.stringify(studioRunErroLegacy, null, 2), "utf-8");
  const loadedLegacyRun = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-runs/run-session-erro",
  });
  assert.equal(loadedLegacyRun.statusCode, 200);
  assert.equal(loadedLegacyRun.json().causalAnalysis?.failedEventSeq, 2);
  assert.equal(loadedLegacyRun.json().causalAnalysis?.failedEventType, "node_failed");
  assert.equal(loadedLegacyRun.json().causalAnalysis?.failedNode, "finish");

  const generated = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/generate",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/reference-interview-runtime" },
  });
  assert.equal(generated.statusCode, 200);
  assert.equal(generated.json().status, "ok");
  assert.equal(generated.json().outDir, "generated/reference-interview-runtime");
  await access(path.join(workspaceRoot, "generated", "reference-interview-runtime", "app", "main.py"));

  const artifacts = await app.inject({
    method: "GET",
    url: "/artifacts?outDir=generated%2Freference-interview-runtime",
  });
  assert.equal(artifacts.statusCode, 200);
  assert.ok(artifacts.json().files.some((file: { path: string }) => file.path === "app/main.py"));

  const artifactFile = await app.inject({
    method: "GET",
    url: "/artifacts/file?outDir=generated%2Freference-interview-runtime&path=app%2Fmain.py",
  });
  assert.equal(artifactFile.statusCode, 200);
  assert.match(artifactFile.json().content, /FastAPI/);

  const archive = await app.inject({
    method: "GET",
    url: "/artifacts/archive?outDir=generated%2Freference-interview-runtime",
  });
  assert.equal(archive.statusCode, 200);
  assert.match(String(archive.headers["content-type"]), /application\/zip/);
  assert.equal(archive.body.slice(0, 2), "PK");

  const langGraphSandbox = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/generate-langgraph-sandbox",
    payload: { outDir: "generated/reference-interview-langgraph-sandbox" },
  });
  assert.equal(langGraphSandbox.statusCode, 200);
  assert.equal(langGraphSandbox.json().outDir, "generated/reference-interview-langgraph-sandbox");

  const langGraphConfig = await app.inject({
    method: "GET",
    url: "/artifacts/file?outDir=generated%2Freference-interview-langgraph-sandbox&path=langgraph.json",
  });
  assert.equal(langGraphConfig.statusCode, 200);
  assert.match(langGraphConfig.json().content, /app\/langgraph_app\.py:graph/);

  const unapprovedRuntime = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/generate-approved-runtime",
    payload: { outDir: "generated/reference-interview-approved-runtime" },
  });
  assert.equal(unapprovedRuntime.statusCode, 409);

  const sandboxApproval = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/approve-langgraph-sandbox",
    payload: { outDir: "generated/reference-interview-langgraph-sandbox" },
  });
  assert.equal(sandboxApproval.statusCode, 200);
  assert.equal(sandboxApproval.json().approval.status, "approved");
  assert.equal(sandboxApproval.json().approval.sandboxOutDir, "generated/reference-interview-langgraph-sandbox");
  assert.match(sandboxApproval.json().approval.flowHash, /^[a-f0-9]{64}$/);

  const approvedRuntime = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/generate-approved-runtime",
    payload: { outDir: "generated/reference-interview-approved-runtime" },
  });
  assert.equal(approvedRuntime.statusCode, 200);
  assert.equal(approvedRuntime.json().outDir, "generated/reference-interview-approved-runtime");
  assert.equal(approvedRuntime.json().approval.flowHash, sandboxApproval.json().approval.flowHash);
  await access(
    path.join(workspaceRoot, "generated", "reference-interview-approved-runtime", ".agent-flow", "langgraph-sandbox-approval.json"),
  );

  const dockerStatus = await app.inject({
    method: "GET",
    url: "/docker-runtime/status?outDir=generated%2Freference-interview-approved-runtime&runtimeUrl=http%3A%2F%2F127.0.0.1%3A9000",
  });
  assert.equal(dockerStatus.statusCode, 200);
  assert.equal(dockerStatus.json().ready, true);
  assert.equal(dockerStatus.json().target, "fastapi-runtime");
  assert.equal(dockerStatus.json().resourceName, "sessions");
  assert.equal(dockerStatus.json().docsUrl, "http://127.0.0.1:9000/docs");
  assert.equal(dockerStatus.json().envFile, false);
  assert.equal(dockerStatus.json().ports.api.hostPort, 8080);
  assert.equal(dockerStatus.json().ports.postgres.hostPort, 5433);
  assert.equal(dockerStatus.json().ports.redis.hostPort, 6380);

  const dockerPorts = await app.inject({
    method: "POST",
    url: "/docker-runtime/configure-ports",
    headers: { "content-type": "application/json" },
    payload: {
      outDir: "generated/reference-interview-approved-runtime",
      ports: { api: 9001, postgres: 5544, redis: 6680 },
    },
  });
  assert.equal(dockerPorts.statusCode, 200);
  assert.equal(dockerPorts.json().ok, true);
  assert.equal(dockerPorts.json().operation, "configure_ports");
  assert.equal(dockerPorts.json().runtimeUrl, "http://127.0.0.1:9001");
  assert.equal(dockerPorts.json().ports.api.hostPort, 9001);
  assert.equal(dockerPorts.json().ports.postgres.hostPort, 5544);
  assert.equal(dockerPorts.json().ports.redis.hostPort, 6680);

  const composeAfterPorts = await readFile(
    path.join(workspaceRoot, "generated", "reference-interview-approved-runtime", "docker-compose.yml"),
    "utf-8",
  );
  assert.match(composeAfterPorts, /9001:8080/);
  assert.match(composeAfterPorts, /5544:5432/);
  assert.match(composeAfterPorts, /6680:6379/);

  const dockerPrepareEnv = await app.inject({
    method: "POST",
    url: "/docker-runtime/prepare-env",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/reference-interview-approved-runtime" },
  });
  assert.equal(dockerPrepareEnv.statusCode, 200);
  assert.equal(dockerPrepareEnv.json().ok, true);
  assert.equal(dockerPrepareEnv.json().operation, "prepare_env");
  assert.equal(dockerPrepareEnv.json().envFile, true);
  await access(path.join(workspaceRoot, "generated", "reference-interview-approved-runtime", ".env"));

  const dockerBuildPromise = app.inject({
    method: "POST",
    url: "/docker-runtime/build",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/reference-interview-approved-runtime" },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const dockerBuildRunning = await app.inject({
    method: "GET",
    url: "/docker-runtime/status?outDir=generated%2Freference-interview-approved-runtime",
  });
  assert.equal(dockerBuildRunning.statusCode, 200);
  assert.equal(dockerBuildRunning.json().lastOperation, "build");
  assert.equal(dockerBuildRunning.json().lastStatus, "running");
  assert.ok((dockerBuildRunning.json().progress?.length ?? 0) >= 1);
  assert.equal(typeof dockerBuildRunning.json().progress[0].percent, "number");

  const dockerBuild = await dockerBuildPromise;
  assert.equal(dockerBuild.statusCode, 200);
  assert.equal(dockerBuild.json().ok, true);
  assert.deepEqual(dockerBuild.json().args, ["compose", "build", "api"]);
  assert.equal(Array.isArray(dockerBuild.json().progress), true);
  assert.ok(dockerBuild.json().progress.length >= 3);
  assert.ok(dockerBuild.json().progress.every((step: { stage: string }) => typeof step.stage === "string"));
  assert.ok(dockerBuild.json().progress.every((step: { percent?: number }) => typeof step.percent === "number"));
  assert.equal(dockerBuild.json().progress.at(-1).percent, 100);

  cancelNextBuild = true;
  const dockerBuildToCancelPromise = app.inject({
    method: "POST",
    url: "/docker-runtime/build",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/reference-interview-approved-runtime" },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const dockerCancel = await app.inject({
    method: "POST",
    url: "/docker-runtime/cancel",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/reference-interview-approved-runtime" },
  });
  assert.equal(dockerCancel.statusCode, 200);
  assert.equal(dockerCancel.json().operation, "cancel");
  assert.equal(dockerCancel.json().ok, true);

  const dockerBuildCanceled = await dockerBuildToCancelPromise;
  assert.equal(dockerBuildCanceled.statusCode, 200);
  assert.equal(dockerBuildCanceled.json().ok, false);
  assert.equal(dockerBuildCanceled.json().lastOperation, "build");
  assert.equal(dockerBuildCanceled.json().lastStatus, "canceled");
  assert.equal(dockerBuildCanceled.json().progress.at(-1).status, "canceled");
  assert.match(dockerBuildCanceled.json().message, /cancelado/i);
  cancelNextBuild = false;

  const dockerUp = await app.inject({
    method: "POST",
    url: "/docker-runtime/up",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/reference-interview-approved-runtime" },
  });
  assert.equal(dockerUp.statusCode, 200);
  assert.equal(dockerUp.json().lastStatus, "success");
  assert.deepEqual(dockerUp.json().args, ["compose", "up", "-d", "--build"]);

  const dockerInspect = await app.inject({
    method: "POST",
    url: "/docker-runtime/inspect",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/reference-interview-approved-runtime" },
  });
  assert.equal(dockerInspect.statusCode, 200);
  assert.equal(dockerInspect.json().ok, true);
  assert.equal(dockerInspect.json().operation, "inspect");
  assert.equal(dockerInspect.json().inspection.containers[0].service, "api");
  assert.match(dockerInspect.json().inspection.rawLogs, /Application startup complete/);

  const dockerDown = await app.inject({
    method: "POST",
    url: "/docker-runtime/down",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/reference-interview-approved-runtime" },
  });
  assert.equal(dockerDown.statusCode, 200);
  assert.equal(dockerDown.json().lastOperation, "down");
  assert.deepEqual(dockerDown.json().args, ["compose", "down"]);
  assert.equal(dockerCalls.length, 6);

  const dockerHistory = await app.inject({
    method: "GET",
    url: "/docker-runtime/history?outDir=generated%2Freference-interview-approved-runtime&limit=10",
  });
  assert.equal(dockerHistory.statusCode, 200);
  assert.equal(dockerHistory.json().outDir, "generated/reference-interview-approved-runtime");
  assert.ok(dockerHistory.json().entries.length >= 5);
  assert.equal(dockerHistory.json().entries[0].operation, "down");
  assert.ok(dockerHistory.json().entries.some((entry: { operation: string }) => entry.operation === "inspect"));
  const buildEntry = dockerHistory.json().entries.find((entry: { operation: string }) => entry.operation === "build");
  assert.equal(buildEntry?.operation, "build");
  assert.equal(Array.isArray(buildEntry?.progress), true);
  assert.ok((buildEntry?.progress?.length ?? 0) >= 1);

  const dockerHistoryFilteredOperation = await app.inject({
    method: "GET",
    url: "/docker-runtime/history?outDir=generated%2Freference-interview-approved-runtime&operation=build&limit=20",
  });
  assert.equal(dockerHistoryFilteredOperation.statusCode, 200);
  assert.ok(dockerHistoryFilteredOperation.json().entries.length >= 1);
  assert.ok(dockerHistoryFilteredOperation.json().entries.every((entry: { operation: string }) => entry.operation === "build"));

  const dockerHistoryFilteredCanceled = await app.inject({
    method: "GET",
    url: "/docker-runtime/history?outDir=generated%2Freference-interview-approved-runtime&status=canceled&limit=20",
  });
  assert.equal(dockerHistoryFilteredCanceled.statusCode, 200);
  assert.ok(dockerHistoryFilteredCanceled.json().entries.length >= 1);
  assert.ok(
    dockerHistoryFilteredCanceled.json().entries.every((entry: { status: string }) => entry.status === "canceled"),
  );

  const dockerHistoryFilteredStatus = await app.inject({
    method: "GET",
    url: "/docker-runtime/history?outDir=generated%2Freference-interview-approved-runtime&status=success&limit=20",
  });
  assert.equal(dockerHistoryFilteredStatus.statusCode, 200);
  assert.ok(
    dockerHistoryFilteredStatus.json().entries.every((entry: { status: string }) => entry.status === "success"),
  );

  const dockerHistoryFilteredOk = await app.inject({
    method: "GET",
    url: "/docker-runtime/history?outDir=generated%2Freference-interview-approved-runtime&ok=true&limit=20",
  });
  assert.equal(dockerHistoryFilteredOk.statusCode, 200);
  assert.ok(dockerHistoryFilteredOk.json().entries.every((entry: { ok: boolean }) => entry.ok === true));

  const dockerHistoryFilteredSearch = await app.inject({
    method: "GET",
    url: "/docker-runtime/history?outDir=generated%2Freference-interview-approved-runtime&search=compose&limit=20",
  });
  assert.equal(dockerHistoryFilteredSearch.statusCode, 200);
  assert.equal(Array.isArray(dockerHistoryFilteredSearch.json().entries), true);

  const dockerHistoryFilteredErrorLevel = await app.inject({
    method: "GET",
    url: "/docker-runtime/history?outDir=generated%2Freference-interview-approved-runtime&level=error&limit=20",
  });
  assert.equal(dockerHistoryFilteredErrorLevel.statusCode, 200);
  assert.ok(dockerHistoryFilteredErrorLevel.json().entries.length >= 1);
  assert.ok(
    dockerHistoryFilteredErrorLevel
      .json()
      .entries.every((entry: { ok: boolean; status: string; progress?: Array<{ status: string }> }) =>
        !entry.ok ||
        entry.status === "error" ||
        entry.status === "canceled" ||
        (entry.progress ?? []).some((step) => step.status === "error" || step.status === "canceled"),
      ),
  );

  const dockerHistoryFilteredSuccessLevel = await app.inject({
    method: "GET",
    url: "/docker-runtime/history?outDir=generated%2Freference-interview-approved-runtime&level=success&limit=20",
  });
  assert.equal(dockerHistoryFilteredSuccessLevel.statusCode, 200);
  assert.ok(dockerHistoryFilteredSuccessLevel.json().entries.length >= 1);
  assert.ok(
    dockerHistoryFilteredSuccessLevel
      .json()
      .entries.every((entry: { ok: boolean; status: string }) => entry.ok && entry.status === "success"),
  );

  const dockerHistoryFilteredProgressStage = await app.inject({
    method: "GET",
    url: "/docker-runtime/history?outDir=generated%2Freference-interview-approved-runtime&progressStage=metadata&limit=20",
  });
  assert.equal(dockerHistoryFilteredProgressStage.statusCode, 200);
  assert.ok(dockerHistoryFilteredProgressStage.json().entries.length >= 1);
  assert.ok(
    dockerHistoryFilteredProgressStage
      .json()
      .entries.every((entry: { progress?: Array<{ stage: string; message: string; line: string }> }) =>
        (entry.progress ?? []).some((step) =>
          [step.stage, step.message, step.line].some((value) => value.toLowerCase().includes("metadata")),
        ),
      ),
  );

  const dockerHistoryFilteredProgressStatus = await app.inject({
    method: "GET",
    url: "/docker-runtime/history?outDir=generated%2Freference-interview-approved-runtime&progressStatus=done&limit=20",
  });
  assert.equal(dockerHistoryFilteredProgressStatus.statusCode, 200);
  assert.ok(dockerHistoryFilteredProgressStatus.json().entries.length >= 1);
  assert.ok(
    dockerHistoryFilteredProgressStatus
      .json()
      .entries.every((entry: { progress?: Array<{ status: string }> }) =>
        (entry.progress ?? []).some((step) => step.status === "done"),
      ),
  );

  const dockerHistoryFilteredCanceledProgress = await app.inject({
    method: "GET",
    url: "/docker-runtime/history?outDir=generated%2Freference-interview-approved-runtime&progressStatus=canceled&limit=20",
  });
  assert.equal(dockerHistoryFilteredCanceledProgress.statusCode, 200);
  assert.ok(dockerHistoryFilteredCanceledProgress.json().entries.length >= 1);
  assert.ok(
    dockerHistoryFilteredCanceledProgress
      .json()
      .entries.every((entry: { progress?: Array<{ status: string }> }) =>
        (entry.progress ?? []).some((step) => step.status === "canceled"),
      ),
  );

  const oldest = dockerHistory.json().entries.at(-1)?.finishedAt;
  const newest = dockerHistory.json().entries[0]?.finishedAt;
  assert.ok(oldest && newest);
  const dockerHistoryFilteredRange = await app.inject({
    method: "GET",
    url: `/docker-runtime/history?outDir=generated%2Freference-interview-approved-runtime&from=${encodeURIComponent(oldest)}&to=${encodeURIComponent(newest)}&limit=20`,
  });
  assert.equal(dockerHistoryFilteredRange.statusCode, 200);
  assert.ok(dockerHistoryFilteredRange.json().entries.length >= 1);
  assert.ok(dockerHistoryFilteredRange.json().entries.every((entry: { finishedAt: string }) => {
    const finishedAt = Date.parse(entry.finishedAt);
    return finishedAt >= Date.parse(oldest) && finishedAt <= Date.parse(newest);
  }));

  const dockerHistoryLimit = await app.inject({
    method: "GET",
    url: "/docker-runtime/history?outDir=generated%2Freference-interview-approved-runtime&limit=2",
  });
  assert.equal(dockerHistoryLimit.statusCode, 200);
  assert.ok(dockerHistoryLimit.json().entries.length <= 2);

  const dockerHistoryInvalidRange = await app.inject({
    method: "GET",
    url: "/docker-runtime/history?outDir=generated%2Freference-interview-approved-runtime&from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z",
  });
  assert.equal(dockerHistoryInvalidRange.statusCode, 400);
  assert.equal(dockerHistoryInvalidRange.json().error, "workspace_error");

  const dockerHistoryInvalidLimit = await app.inject({
    method: "GET",
    url: "/docker-runtime/history?outDir=generated%2Freference-interview-approved-runtime&limit=0",
  });
  assert.equal(dockerHistoryInvalidLimit.statusCode, 400);
  assert.equal(dockerHistoryInvalidLimit.json().error, "workspace_error");

  const dockerHistoryInvalidOperation = await app.inject({
    method: "GET",
    url: "/docker-runtime/history?outDir=generated%2Freference-interview-approved-runtime&operation=invalid",
  });
  assert.equal(dockerHistoryInvalidOperation.statusCode, 400);
  assert.equal(dockerHistoryInvalidOperation.json().error, "workspace_error");

  const dockerHistoryInvalidProgressStatus = await app.inject({
    method: "GET",
    url: "/docker-runtime/history?outDir=generated%2Freference-interview-approved-runtime&progressStatus=invalid",
  });
  assert.equal(dockerHistoryInvalidProgressStatus.statusCode, 400);
  assert.equal(dockerHistoryInvalidProgressStatus.json().error, "workspace_error");

  const dockerHistoryInvalidLevel = await app.inject({
    method: "GET",
    url: "/docker-runtime/history?outDir=generated%2Freference-interview-approved-runtime&level=debug",
  });
  assert.equal(dockerHistoryInvalidLevel.statusCode, 400);
  assert.equal(dockerHistoryInvalidLevel.json().error, "workspace_error");

  const dockerHistoryInvalidFrom = await app.inject({
    method: "GET",
    url: "/docker-runtime/history?outDir=generated%2Freference-interview-approved-runtime&from=invalid-date",
  });
  assert.equal(dockerHistoryInvalidFrom.statusCode, 400);
  assert.equal(dockerHistoryInvalidFrom.json().error, "workspace_error");

  const outsideGenerated = await app.inject({ method: "GET", url: "/artifacts?outDir=flows%2Freference-interview" });
  assert.equal(outsideGenerated.statusCode, 400);
  assert.equal(outsideGenerated.json().error, "workspace_error");

  const dockerOutsideGenerated = await app.inject({
    method: "GET",
    url: "/docker-runtime/status?outDir=flows%2Freference-interview",
  });
  assert.equal(dockerOutsideGenerated.statusCode, 400);
  assert.equal(dockerOutsideGenerated.json().error, "workspace_error");

  const escapedArtifactFile = await app.inject({
    method: "GET",
    url: "/artifacts/file?outDir=generated%2Freference-interview-runtime&path=..%2Fagent.flow.json",
  });
  assert.equal(escapedArtifactFile.statusCode, 400);
  assert.equal(escapedArtifactFile.json().error, "workspace_error");
});

test("Builder API rejects generation outside the workspace", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const app = buildApp({ workspaceRoot });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/generate",
    headers: { "content-type": "application/json" },
    payload: { outDir: "../escape" },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "workspace_error");
});

test("Builder API reports LangGraph sandbox approval status", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const app = buildApp({ workspaceRoot });
  t.after(() => app.close());

  const statusMissing = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/langgraph-sandbox-approval-status",
  });
  assert.equal(statusMissing.statusCode, 200);
  assert.equal(statusMissing.json().status, "missing");

  const langGraphSandbox = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/generate-langgraph-sandbox",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/reference-interview-langgraph-sandbox-status" },
  });
  assert.equal(langGraphSandbox.statusCode, 200);

  const statusAfterGenerate = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/langgraph-sandbox-approval-status",
  });
  assert.equal(statusAfterGenerate.statusCode, 200);
  assert.equal(statusAfterGenerate.json().status, "missing");

  const sandboxApproval = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/approve-langgraph-sandbox",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/reference-interview-langgraph-sandbox-status" },
  });
  assert.equal(sandboxApproval.statusCode, 200);

  const statusApproved = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/langgraph-sandbox-approval-status",
  });
  assert.equal(statusApproved.statusCode, 200);
  assert.equal(statusApproved.json().status, "approved");
  assert.equal(statusApproved.json().approvedFor, "fastapi-runtime");

  const loadedFlow = await app.inject({ method: "GET", url: "/flows/reference-interview" });
  assert.equal(loadedFlow.statusCode, 200);
  const flow = loadedFlow.json().flow;
  flow.version = "999.0.0";
  const updatedFlow = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview",
    headers: { "content-type": "application/json" },
    payload: flow,
  });
  assert.equal(updatedFlow.statusCode, 200);

  const statusOutdated = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/langgraph-sandbox-approval-status",
  });
  assert.equal(statusOutdated.statusCode, 200);
  assert.equal(statusOutdated.json().status, "outdated");
});

test("Builder API creates a new flow workspace from the starter template", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const app = buildApp({ workspaceRoot });
  t.after(() => app.close());

  const created = await app.inject({
    method: "POST",
    url: "/flows",
    headers: { "content-type": "application/json" },
    payload: { id: "new-agent", name: "Novo Agente" },
  });
  assert.equal(created.statusCode, 200);
  assert.equal(created.json().flow.id, "new-agent");
  assert.equal(created.json().flow.name, "Novo Agente");
  assert.equal(created.json().flow.nodes.some((node: { type: string }) => node.type === "switch"), true);
  assert.equal(created.json().flow.nodes.some((node: { type: string }) => node.type === "human_input"), true);
  await access(path.join(workspaceRoot, "flows", "new-agent", "agent.flow.json"));
  await access(path.join(workspaceRoot, "flows", "new-agent", "prompts", "system.md"));
  await access(path.join(workspaceRoot, "flows", "new-agent", "schemas", "session_state.schema.json"));

  const listed = await app.inject({ method: "GET", url: "/flows" });
  assert.ok(listed.json().flows.some((flow: { id: string }) => flow.id === "new-agent"));

  const prompt = await app.inject({ method: "GET", url: "/flows/new-agent/prompts/system" });
  assert.equal(prompt.statusCode, 200);
  assert.match(prompt.json().content, /Novo Agente/);

  const validated = await app.inject({ method: "POST", url: "/flows/new-agent/validate" });
  assert.equal(validated.statusCode, 200);
  assert.equal(validated.json().status, "ok");
  assert.equal(validated.json().summary.errors, 0);

  const generated = await app.inject({
    method: "POST",
    url: "/flows/new-agent/generate",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/new-agent-runtime" },
  });
  assert.equal(generated.statusCode, 200);
  await access(path.join(workspaceRoot, "generated", "new-agent-runtime", "app", "graph.py"));

  const duplicate = await app.inject({
    method: "POST",
    url: "/flows",
    headers: { "content-type": "application/json" },
    payload: { id: "new-agent" },
  });
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().error, "workspace_error");

  const invalid = await app.inject({
    method: "POST",
    url: "/flows",
    headers: { "content-type": "application/json" },
    payload: { id: "../escape" },
  });
  assert.equal(invalid.statusCode, 422);
  assert.equal(invalid.json().error, "workspace_error");
});

test("Builder API reads, validates and generates a runtime manifest bundle", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const app = buildApp({ workspaceRoot });
  t.after(() => app.close());

  const schema = await app.inject({ method: "GET", url: "/runtime-manifest-schema" });
  assert.equal(schema.statusCode, 200);
  assert.ok(schema.json().definitions.RuntimeManifest);

  const loaded = await app.inject({ method: "GET", url: "/runtime-manifest" });
  assert.equal(loaded.statusCode, 200);
  assert.equal(loaded.json().manifest.id, "reference-runtime");

  const manifestDraft = loaded.json().manifest;
  manifestDraft.name = "Reference Runtime Visual";
  manifestDraft.packaging = "multiagent";
  manifestDraft.defaultLlm.mockEnv = "MOCK_LLM";
  manifestDraft.agents[0].routePrefix = "/reference-interview";
  const saved = await app.inject({
    method: "PUT",
    url: "/runtime-manifest",
    headers: { "content-type": "application/json" },
    payload: manifestDraft,
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().manifest.name, "Reference Runtime Visual");
  assert.equal(saved.json().manifest.packaging, "multiagent");
  assert.equal(saved.json().manifest.agents[0].routePrefix, "/reference-interview");
  const savedFile = JSON.parse(await readFile(path.join(workspaceRoot, "runtime.manifest.json"), "utf-8"));
  assert.equal(savedFile.defaultLlm.mockEnv, "MOCK_LLM");

  const validated = await app.inject({ method: "POST", url: "/runtime-manifest/validate" });
  assert.equal(validated.statusCode, 200);
  assert.equal(validated.json().status, "ok");
  assert.equal(validated.json().agents[0].flowId, "reference-interview");
  assert.equal(validated.json().agents[0].routePrefix, "/reference-interview");
  assert.equal(validated.json().agents[0].resourceName, "sessions");
  assert.equal(validated.json().agents[0].contract, "sessions-v1");
  assert.equal(validated.json().agents[0].flowPath, "flows/reference-interview/agent.flow.json");

  const generated = await app.inject({
    method: "POST",
    url: "/runtime-manifest/generate",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/reference-runtime-bundle" },
  });
  assert.equal(generated.statusCode, 200);
  assert.equal(generated.json().status, "ok");
  assert.equal(generated.json().outDir, "generated/reference-runtime-bundle");
  await access(
    path.join(workspaceRoot, "generated", "reference-runtime-bundle", "agents", "reference-interview", "app", "main.py"),
  );
  await access(path.join(workspaceRoot, "generated", "reference-runtime-bundle", "bundle.json"));

  const bundleStatus = await app.inject({
    method: "GET",
    url: "/docker-runtime/status?outDir=generated%2Freference-runtime-bundle&runtimeUrl=http%3A%2F%2F127.0.0.1%3A9020",
  });
  assert.equal(bundleStatus.statusCode, 200);
  assert.equal(bundleStatus.json().ready, true);
  assert.equal(bundleStatus.json().target, "runtime-manifest-bundle");
  assert.equal(bundleStatus.json().resourceName, "sessions");
  assert.equal(bundleStatus.json().runtimeUrl, "http://127.0.0.1:9020");
  assert.equal(bundleStatus.json().agents.length, 1);
  assert.equal(bundleStatus.json().agents[0].id, "reference-interview");
  assert.equal(bundleStatus.json().agents[0].routePrefix, "/reference-interview");
  assert.equal(bundleStatus.json().agents[0].resourceName, "sessions");

  const runtimeCalls: Array<{ method: string; url: string; body: unknown }> = [];
  const runtimeServer = createServer(async (request, response) => {
    const method = request.method ?? "GET";
    const url = request.url ?? "/";
    const body = method === "GET" ? null : await readJsonBody(request);
    runtimeCalls.push({ method, url, body });
    response.setHeader("content-type", "application/json");

    if (method === "GET" && url === "/health") {
      response.end(JSON.stringify({ status: "ok", db_ok: true, cache_ok: true }));
      return;
    }
    if (method === "GET" && url === "/metadata") {
      response.end(JSON.stringify({ kind: "bundle", agents: ["reference-interview"] }));
      return;
    }
    if (method === "GET" && url === "/reference-interview/metadata") {
      response.end(JSON.stringify({ kind: "agent", id: "reference-interview" }));
      return;
    }
    if (method === "POST" && url === "/reference-interview/sessions") {
      response.end(JSON.stringify({ session: { session_id: "smoke-session" } }));
      return;
    }
    if (method === "POST" && url === "/reference-interview/sessions/smoke-session/start") {
      response.end(JSON.stringify({ ok: true, phase: "started" }));
      return;
    }
    if (method === "POST" && url === "/reference-interview/sessions/smoke-session/turn") {
      response.end(JSON.stringify({ ok: true, phase: "turn" }));
      return;
    }
    if (method === "GET" && url === "/reference-interview/sessions/smoke-session/transcript") {
      response.end(JSON.stringify([{ seq: 1, role: "assistant", content: "ok" }]));
      return;
    }
    if (method === "GET" && url === "/reference-interview/sessions/smoke-session/events") {
      response.end(JSON.stringify([{ seq: 1, event_type: "session_started" }]));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found", url }));
  });
  t.after(() => new Promise<void>((resolve) => runtimeServer.close(() => resolve())));
  await new Promise<void>((resolve) => runtimeServer.listen(0, "127.0.0.1", () => resolve()));
  const runtimeAddress = runtimeServer.address() as AddressInfo;
  const runtimeUrl = `http://127.0.0.1:${runtimeAddress.port}`;

  const bundleSmoke = await app.inject({
    method: "POST",
    url: "/docker-runtime/smoke",
    headers: { "content-type": "application/json" },
    payload: {
      outDir: "generated/reference-runtime-bundle",
      runtimeUrl,
      agentId: "reference-interview",
    },
  });
  assert.equal(bundleSmoke.statusCode, 200);
  assert.equal(bundleSmoke.json().ok, true);
  assert.equal(bundleSmoke.json().target, "runtime-manifest-bundle");
  assert.equal(bundleSmoke.json().smoke.agentId, "reference-interview");
  assert.equal(bundleSmoke.json().smoke.routePrefix, "/reference-interview");
  assert.equal(bundleSmoke.json().smoke.resourceName, "sessions");
  assert.equal(bundleSmoke.json().smoke.basePath, "/reference-interview/sessions");
  assert.equal(bundleSmoke.json().smoke.sessionId, "smoke-session");
  assert.equal(bundleSmoke.json().smoke.transcriptCount, 1);
  assert.equal(bundleSmoke.json().smoke.eventsCount, 1);
  assert.deepEqual(
    runtimeCalls.map((call) => `${call.method} ${call.url}`),
    [
      "GET /health",
      "GET /metadata",
      "GET /reference-interview/metadata",
      "POST /reference-interview/sessions",
      "POST /reference-interview/sessions/smoke-session/start",
      "POST /reference-interview/sessions/smoke-session/turn",
      "GET /reference-interview/sessions/smoke-session/transcript",
      "GET /reference-interview/sessions/smoke-session/events",
    ],
  );
  const createSessionCall = runtimeCalls.find((call) => call.url === "/reference-interview/sessions");
  assert.deepEqual(createSessionCall?.body, {
    metadata: { source: "builder-api-smoke", agent_id: "reference-interview" },
    max_turns: 2,
  });

  await writeFile(
    path.join(workspaceRoot, "runtime.manifest.json"),
    JSON.stringify(
      {
        id: "broken",
        name: "Broken",
        version: "0.1.0",
        packaging: "monoagent",
        agents: [{ id: "reference-interview", flowPath: "../escape/agent.flow.json", routePrefix: "" }],
      },
      null,
      2,
    ),
    "utf-8",
  );
  const escaped = await app.inject({ method: "POST", url: "/runtime-manifest/validate" });
  assert.equal(escaped.statusCode, 400);
  assert.equal(escaped.json().error, "workspace_error");
});

test("Builder API saves a valid flow and rejects id mismatch", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const app = buildApp({ workspaceRoot });
  t.after(() => app.close());

  const loaded = await app.inject({ method: "GET", url: "/flows/reference-interview" });
  assert.equal(loaded.statusCode, 200);
  const flow = loaded.json().flow;
  flow.name = "Agente de Referência Editado";
  flow.nodes[0].description = "Descrição editada pelo teste.";

  const saved = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview",
    headers: { "content-type": "application/json" },
    payload: flow,
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().flow.name, "Agente de Referência Editado");

  const reloaded = await app.inject({ method: "GET", url: "/flows/reference-interview" });
  assert.equal(reloaded.json().flow.nodes[0].description, "Descrição editada pelo teste.");

  flow.id = "outro-id";
  const mismatch = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview",
    headers: { "content-type": "application/json" },
    payload: flow,
  });
  assert.equal(mismatch.statusCode, 409);
  assert.equal(mismatch.json().error, "workspace_error");
});

test("Builder API edits prompt and schema assets referenced by a flow", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const app = buildApp({ workspaceRoot });
  t.after(() => app.close());

  const prompt = await app.inject({ method: "GET", url: "/flows/reference-interview/prompts/system" });
  assert.equal(prompt.statusCode, 200);
  assert.match(prompt.json().content, /agente de referência/);

  const savedPrompt = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/prompts/system",
    headers: { "content-type": "application/json" },
    payload: { content: "# Prompt editado\n\nVocê é um agente editado.\n" },
  });
  assert.equal(savedPrompt.statusCode, 200);
  assert.match(savedPrompt.json().content, /agente editado/);

  const schema = await app.inject({ method: "GET", url: "/flows/reference-interview/schemas/session_state" });
  assert.equal(schema.statusCode, 200);
  assert.match(schema.json().content, /object/);

  const savedSchema = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/schemas/session_state",
    headers: { "content-type": "application/json" },
    payload: { content: "{\"type\":\"object\",\"properties\":{\"edited\":{\"type\":\"boolean\"}}}" },
  });
  assert.equal(savedSchema.statusCode, 200);
  assert.match(savedSchema.json().content, /edited/);

  const invalidSchema = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/schemas/session_state",
    headers: { "content-type": "application/json" },
    payload: { content: "{invalid" },
  });
  assert.equal(invalidSchema.statusCode, 422);
  assert.equal(invalidSchema.json().error, "workspace_error");

  const createdPrompt = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/prompts",
    headers: { "content-type": "application/json" },
    payload: {
      id: "draft_prompt",
      path: "prompts/draft_prompt.md",
      version: "v1",
      description: "Prompt de rascunho para edição visual.",
      tags: ["draft", "llm"],
      variables: ["user_message"],
      content: "# Prompt novo\n\nVocê é um prompt criado pela API.\n",
    },
  });
  assert.equal(createdPrompt.statusCode, 200);
  assert.equal(createdPrompt.json().prompt.id, "draft_prompt");
  const draftPromptRef = createdPrompt.json().flow.prompts.find((item: { id: string }) => item.id === "draft_prompt");
  assert.ok(draftPromptRef);
  assert.equal(draftPromptRef.description, "Prompt de rascunho para edição visual.");
  assert.deepEqual(draftPromptRef.tags, ["draft", "llm"]);
  assert.deepEqual(draftPromptRef.variables, ["user_message"]);
  assert.match(await readFile(path.join(workspaceRoot, "flows", "reference-interview", "prompts", "draft_prompt.md"), "utf-8"), /Prompt novo/);

  const duplicatePrompt = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/prompts",
    headers: { "content-type": "application/json" },
    payload: { id: "draft_prompt", path: "prompts/other.md" },
  });
  assert.equal(duplicatePrompt.statusCode, 409);
  assert.equal(duplicatePrompt.json().error, "workspace_error");

  const deleteReferencedPrompt = await app.inject({ method: "DELETE", url: "/flows/reference-interview/prompts/system" });
  assert.equal(deleteReferencedPrompt.statusCode, 409);
  assert.equal(deleteReferencedPrompt.json().error, "workspace_error");

  const deletedPrompt = await app.inject({ method: "DELETE", url: "/flows/reference-interview/prompts/draft_prompt" });
  assert.equal(deletedPrompt.statusCode, 200);
  assert.equal(deletedPrompt.json().deleted.id, "draft_prompt");
  await assert.rejects(access(path.join(workspaceRoot, "flows", "reference-interview", "prompts", "draft_prompt.md")));

  const createdSchema = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/schemas",
    headers: { "content-type": "application/json" },
    payload: {
      id: "draft_schema",
      path: "schemas/draft.schema.json",
      version: "v2",
      description: "Schema de rascunho para edição visual.",
      tags: ["draft", "contract"],
      content: "{\"type\":\"object\",\"properties\":{\"ok\":{\"type\":\"boolean\"}}}",
    },
  });
  assert.equal(createdSchema.statusCode, 200);
  assert.equal(createdSchema.json().schema.id, "draft_schema");
  const draftSchemaRef = createdSchema.json().flow.schemas.find((item: { id: string }) => item.id === "draft_schema");
  assert.ok(draftSchemaRef);
  assert.equal(draftSchemaRef.version, "v2");
  assert.equal(draftSchemaRef.description, "Schema de rascunho para edição visual.");
  assert.deepEqual(draftSchemaRef.tags, ["draft", "contract"]);

  const deleteStateSchema = await app.inject({ method: "DELETE", url: "/flows/reference-interview/schemas/session_state" });
  assert.equal(deleteStateSchema.statusCode, 409);
  assert.equal(deleteStateSchema.json().error, "workspace_error");

  const deletedSchema = await app.inject({ method: "DELETE", url: "/flows/reference-interview/schemas/draft_schema" });
  assert.equal(deletedSchema.statusCode, 200);
  assert.equal(deletedSchema.json().deleted.id, "draft_schema");
  await assert.rejects(access(path.join(workspaceRoot, "flows", "reference-interview", "schemas", "draft.schema.json")));

  const escapedCreate = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/prompts",
    headers: { "content-type": "application/json" },
    payload: { id: "escaped_prompt", path: "../escape.md" },
  });
  assert.equal(escapedCreate.statusCode, 400);
  assert.equal(escapedCreate.json().error, "workspace_error");

  const loaded = await app.inject({ method: "GET", url: "/flows/reference-interview" });
  const flow = loaded.json().flow;
  flow.prompts[0].path = "../escape.md";
  const savedEscapingFlow = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview",
    headers: { "content-type": "application/json" },
    payload: flow,
  });
  assert.equal(savedEscapingFlow.statusCode, 200);

  const escapedPrompt = await app.inject({ method: "GET", url: "/flows/reference-interview/prompts/system" });
  assert.equal(escapedPrompt.statusCode, 400);
  assert.equal(escapedPrompt.json().error, "workspace_error");

  const analyzed = await app.inject({ method: "POST", url: "/flows/reference-interview/validate" });
  assert.equal(analyzed.statusCode, 200);
  assert.equal(analyzed.json().status, "error");
  assert.ok(analyzed.json().diagnostics.some((item: { code: string }) => item.code === "missing_prompt_file"));
});

test("Builder API saves and applies local catalog items", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const app = buildApp({ workspaceRoot });
  t.after(() => app.close());

  const catalog = await app.inject({ method: "GET", url: "/catalog" });
  assert.equal(catalog.statusCode, 200);
  assert.equal(catalog.json().format, "agent-flow-builder.local-catalog.v1");
  assert.ok(catalog.json().items.some((item: { kind: string; id: string }) => item.kind === "tool" && item.id === "http-json-tool"));
  assert.ok(
    catalog
      .json()
      .items.some((item: { kind: string; id: string }) => item.kind === "agent_template" && item.id === "content-question-generator-agent"),
  );
  assert.ok(catalog.json().items.every((item: { scope: string }) => item.scope === "local"));

  const createdFromTemplate = await app.inject({
    method: "POST",
    url: "/catalog/agent-templates/create-flow",
    headers: { "content-type": "application/json" },
    payload: {
      itemId: "content-question-generator-agent",
      id: "catalog-question-agent",
      name: "Agente de Perguntas",
    },
  });
  assert.equal(createdFromTemplate.statusCode, 200);
  assert.equal(createdFromTemplate.json().item.kind, "agent_template");
  assert.equal(createdFromTemplate.json().flow.id, "catalog-question-agent");
  assert.equal(createdFromTemplate.json().flow.name, "Agente de Perguntas");
  assert.equal(createdFromTemplate.json().flow.nodes.some((node: { type: string }) => node.type === "file_extract"), true);
  assert.equal(createdFromTemplate.json().flow.nodes.some((node: { type: string }) => node.type === "rag_retrieval"), true);
  assert.equal(createdFromTemplate.json().flow.nodes.some((node: { type: string }) => node.type === "llm_structured"), true);
  await access(path.join(workspaceRoot, "flows", "catalog-question-agent", "agent.flow.json"));
  assert.match(
    await readFile(path.join(workspaceRoot, "flows", "catalog-question-agent", "prompts", "system.md"), "utf-8"),
    /transforma conteúdo em perguntas/,
  );
  const templateValidation = await app.inject({ method: "POST", url: "/flows/catalog-question-agent/validate" });
  assert.equal(templateValidation.statusCode, 200);
  assert.equal(templateValidation.json().summary.errors, 0);

  const savedPrompt = await app.inject({
    method: "POST",
    url: "/catalog/items",
    headers: { "content-type": "application/json" },
    payload: {
      kind: "prompt",
      id: "catalog-system",
      name: "Prompt catalogado",
      description: "Prompt reutilizável local.",
      tags: ["catalog", "test"],
      content: "Use {topic} para gerar uma resposta objetiva.",
    },
  });
  assert.equal(savedPrompt.statusCode, 200);
  assert.equal(savedPrompt.json().item.source, "local");
  await access(path.join(workspaceRoot, ".agent-flow", "catalog", "registry.json"));

  const appliedPrompt = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/catalog/apply",
    headers: { "content-type": "application/json" },
    payload: {
      itemId: "catalog-system",
      kind: "prompt",
      targetNodeId: "llm_step",
    },
  });
  assert.equal(appliedPrompt.statusCode, 200);
  assert.equal(appliedPrompt.json().prompt.id, "catalog-system");
  assert.equal(appliedPrompt.json().flow.nodes.find((node: { id: string }) => node.id === "llm_step").promptId, "catalog-system");
  assert.match(
    await readFile(path.join(workspaceRoot, "flows", "reference-interview", "prompts", "catalog-system.md"), "utf-8"),
    /topic/,
  );

  const savedSchema = await app.inject({
    method: "POST",
    url: "/catalog/items",
    headers: { "content-type": "application/json" },
    payload: {
      kind: "schema",
      id: "catalog-result",
      name: "Resultado catalogado",
      description: "Schema reutilizável local.",
      tags: ["catalog", "schema"],
      content: "{\"type\":\"object\",\"properties\":{\"summary\":{\"type\":\"string\"}}}",
    },
  });
  assert.equal(savedSchema.statusCode, 200);
  assert.match(savedSchema.json().item.content, /summary/);

  const appliedSchema = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/catalog/apply",
    headers: { "content-type": "application/json" },
    payload: {
      itemId: "catalog-result",
      kind: "schema",
      targetNodeId: "llm_step",
    },
  });
  assert.equal(appliedSchema.statusCode, 200);
  assert.equal(appliedSchema.json().schema.id, "catalog-result");
  assert.equal(appliedSchema.json().flow.nodes.find((node: { id: string }) => node.id === "llm_step").outputSchema, "catalog-result");

  const appliedTool = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/catalog/apply",
    headers: { "content-type": "application/json" },
    payload: {
      itemId: "http-json-tool",
      kind: "tool",
      targetNodeId: "deterministic_gate",
    },
  });
  assert.equal(appliedTool.statusCode, 200);
  assert.equal(appliedTool.json().node.id, "deterministic_gate");
  assert.equal(appliedTool.json().node.type, "code");
  assert.equal(appliedTool.json().node.codeExecution, "http");
  assert.equal(appliedTool.json().node.url, "http://127.0.0.1:9001/run");

  const validated = await app.inject({ method: "POST", url: "/flows/reference-interview/validate" });
  assert.equal(validated.statusCode, 200);
  assert.equal(validated.json().status, "ok");

  const duplicateBuiltin = await app.inject({
    method: "POST",
    url: "/catalog/items",
    headers: { "content-type": "application/json" },
    payload: {
      kind: "tool",
      id: "http-json-tool",
      name: "Tentativa",
      nodePatch: { type: "code" },
    },
  });
  assert.equal(duplicateBuiltin.statusCode, 409);
  assert.equal(duplicateBuiltin.json().error, "workspace_error");
});

test("Builder API exports and imports a flow workspace package", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const app = buildApp({ workspaceRoot });
  t.after(() => app.close());

  const exported = await app.inject({ method: "GET", url: "/flows/reference-interview/export" });
  assert.equal(exported.statusCode, 200);
  assert.equal(exported.json().format, "agent-flow-builder.flow-workspace.v1");
  assert.equal(exported.json().flow.id, "reference-interview");
  assert.ok(exported.json().prompts.some((prompt: { id: string }) => prompt.id === "system"));
  assert.ok(exported.json().schemas.some((schema: { id: string }) => schema.id === "session_state"));

  const conflict = await app.inject({
    method: "POST",
    url: "/flows/import",
    headers: { "content-type": "application/json" },
    payload: { workspace: exported.json() },
  });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error, "workspace_error");

  const importedPackage = exported.json();
  importedPackage.flow.id = "imported-reference";
  importedPackage.flow.name = "Referência Importada";
  importedPackage.flow.api.resourceName = "imported_sessions";
  importedPackage.prompts = importedPackage.prompts.map((prompt: { id: string; content: string }) =>
    prompt.id === "system" ? { ...prompt, content: "# Prompt importado\n\nVocê é um agente importado.\n" } : prompt,
  );

  const imported = await app.inject({
    method: "POST",
    url: "/flows/import",
    headers: { "content-type": "application/json" },
    payload: { workspace: importedPackage },
  });
  assert.equal(imported.statusCode, 200);
  assert.equal(imported.json().status, "ok");
  assert.equal(imported.json().flow.id, "imported-reference");
  assert.equal(imported.json().prompts, importedPackage.prompts.length);
  assert.equal(imported.json().schemas, importedPackage.schemas.length);
  await access(path.join(workspaceRoot, "flows", "imported-reference", "agent.flow.json"));

  const flows = await app.inject({ method: "GET", url: "/flows" });
  assert.ok(flows.json().flows.some((flow: { id: string }) => flow.id === "imported-reference"));

  const prompt = await app.inject({ method: "GET", url: "/flows/imported-reference/prompts/system" });
  assert.equal(prompt.statusCode, 200);
  assert.match(prompt.json().content, /agente importado/);
});

test("Builder API exposes sandbox status and validates runtime directories", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const app = buildApp({ workspaceRoot });
  t.after(() => app.close());

  const status = await app.inject({ method: "GET", url: "/sandboxes/reference-interview/status" });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().running, false);

  const listed = await app.inject({ method: "GET", url: "/sandboxes" });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(listed.json().sandboxes, []);

  const missingRuntime = await app.inject({
    method: "POST",
    url: "/sandboxes/reference-interview/start",
    headers: { "content-type": "application/json" },
    payload: { runtimeDir: "generated/reference-interview-runtime", port: 40901 },
  });
  assert.equal(missingRuntime.statusCode, 404);
  assert.equal(missingRuntime.json().error, "workspace_error");

  const escapedRuntime = await app.inject({
    method: "POST",
    url: "/sandboxes/reference-interview/start",
    headers: { "content-type": "application/json" },
    payload: { runtimeDir: "../escape", port: 40901 },
  });
  assert.equal(escapedRuntime.statusCode, 400);
  assert.equal(escapedRuntime.json().error, "workspace_error");
});
