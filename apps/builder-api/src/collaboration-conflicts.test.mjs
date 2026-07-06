import { strict as assert } from "node:assert";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildApp } from "./server.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function createWorkspaceFixture() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-builder-collaboration-"));
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

test("Builder API exposes an aggregate governed collaboration conflict overview", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const app = buildApp({ workspaceRoot });

  const savedPins = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/studio-node-pins",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.studio-node-pins.v1",
      flowId: "reference-interview",
      pins: [
        {
          id: "pin-current",
          nodeId: "llm_step",
          nodeType: "llm",
          runId: "run-current",
          sessionId: "session-current",
          eventSeq: 3,
          eventType: "node_end",
          nodeHash: "node-hash-current",
          input: { text: "ola", api_key: "current-secret-api-key" },
          output: { answer: "atual", authorization: "Bearer current-secret-token" },
          createdAt: "2026-07-04T10:00:00.000Z",
          updatedAt: "2026-07-04T10:00:00.000Z",
        },
      ],
    },
  });
  assert.equal(savedPins.statusCode, 200);

  const conflictedPins = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/studio-node-pins/merge",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.studio-node-pins.v1",
      flowId: "reference-interview",
      pins: [
        {
          id: "pin-incoming",
          nodeId: "llm_step",
          nodeType: "llm",
          runId: "run-incoming",
          sessionId: "session-incoming",
          eventSeq: 4,
          eventType: "node_end",
          nodeHash: "node-hash-incoming",
          input: { text: "oi", password: "incoming-secret-password" },
          output: { answer: "recebido", token: "incoming-secret-token" },
          createdAt: "2026-07-04T10:05:00.000Z",
          updatedAt: "2026-07-04T10:05:00.000Z",
        },
      ],
    },
  });
  assert.equal(conflictedPins.statusCode, 200);
  assert.equal(conflictedPins.json().openConflictCount, 1);
  const nodePinConflictId = conflictedPins.json().conflicts[0].conflictId;

  const curatedPins = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/studio-node-pins/conflicts/${encodeURIComponent(nodePinConflictId)}/curation`,
    headers: { "content-type": "application/json" },
    payload: {
      action: "assign",
      actor: "ana-reviewer",
      role: "reviewer",
      note: "Triagem assumida pelo revisor local.",
    },
  });
  assert.equal(curatedPins.statusCode, 200);

  const overviewResponse = await app.inject({ method: "GET", url: "/collaboration/conflicts?flowId=reference-interview" });
  assert.equal(overviewResponse.statusCode, 200);
  const overview = overviewResponse.json();
  assert.equal(overview.format, "agent-flow-builder.collaboration-conflict-overview.v1");
  assert.equal(overview.scope.flowId, "reference-interview");
  assert.deepEqual(overview.scope.includedFlowIds, ["reference-interview"]);
  assert.equal(overview.governance.usesGovernedConflictReviewsOnly, true);
  assert.equal(overview.governance.excludesRawInputOutput, true);
  assert.equal(overview.governance.excludesTokens, true);
  assert.equal(overview.governance.excludesPayloads, true);
  assert.equal(overview.governance.excludesSecretValues, true);
  assert.equal(overview.totals.openConflictCount >= 1, true);
  assert.equal(overview.filteredTotals.openConflictCount >= 1, true);
  assert.equal(overview.filterOptions.responsible.some((option) => option.value === "ana-reviewer"), true);
  assert.equal(overview.filterOptions.roles.some((option) => option.value === "reviewer"), true);

  const nodePinsArea = overview.areas.find((area) => area.id === "studio-node-pins");
  assert.equal(nodePinsArea.flowId, "reference-interview");
  assert.equal(nodePinsArea.openConflictCount, 1);
  assert.equal(nodePinsArea.assignedConflictCount, 1);
  assert.equal(nodePinsArea.governanceArea, "replay_governance");
  assert.equal(nodePinsArea.reviewPath, "/flows/reference-interview/studio-node-pins/conflicts-review");
  assert.equal(nodePinsArea.sourceActions.reviewPath, nodePinsArea.reviewPath);
  assert.equal(nodePinsArea.sourceActions.diffPath, "/flows/reference-interview/studio-node-pins/conflicts-review/diff");
  assert.equal(
    nodePinsArea.sourceActions.curationPathTemplate,
    "/flows/reference-interview/studio-node-pins/conflicts/:conflictId/curation",
  );
  assert.equal(
    nodePinsArea.sourceActions.resolvePathTemplate,
    "/flows/reference-interview/studio-node-pins/conflicts/:conflictId/resolve",
  );
  assert.equal(nodePinsArea.sourceActions.viewerMutationBlocked, true);

  const nodePinConflict = overview.conflicts.find((conflict) => conflict.areaId === "studio-node-pins");
  assert.equal(nodePinConflict.flowId, "reference-interview");
  assert.equal(nodePinConflict.subject.includes("llm_step"), true);
  assert.equal(nodePinConflict.responsible, "ana-reviewer");
  assert.equal(nodePinConflict.role, "reviewer");
  assert.equal(nodePinConflict.severity, "attention");
  assert.deepEqual(nodePinConflict.sourceActions, nodePinsArea.sourceActions);

  const filteredResponse = await app.inject({
    method: "GET",
    url: "/collaboration/conflicts?flowId=reference-interview&area=studio-node-pins&severity=attention&responsible=ana-reviewer&role=reviewer&status=open",
  });
  assert.equal(filteredResponse.statusCode, 200);
  const filteredOverview = filteredResponse.json();
  assert.equal(filteredOverview.filters.area, "studio-node-pins");
  assert.equal(filteredOverview.filters.severity, "attention");
  assert.equal(filteredOverview.filters.responsible, "ana-reviewer");
  assert.equal(filteredOverview.filters.role, "reviewer");
  assert.equal(filteredOverview.filters.status, "open");
  assert.equal(filteredOverview.filteredTotals.conflictCount, 1);
  assert.equal(filteredOverview.filteredTotals.assignedConflictCount, 1);
  assert.equal(filteredOverview.conflicts.length, 1);
  assert.equal(filteredOverview.conflicts[0].conflictId, nodePinConflictId);

  const emptyFilteredResponse = await app.inject({
    method: "GET",
    url: "/collaboration/conflicts?flowId=reference-interview&responsible=outro-reviewer",
  });
  assert.equal(emptyFilteredResponse.statusCode, 200);
  assert.equal(emptyFilteredResponse.json().filteredTotals.conflictCount, 0);
  assert.equal(emptyFilteredResponse.json().conflicts.length, 0);

  const previousEnforce = process.env.AGENT_FLOW_WORKSPACE_GOVERNANCE_ENFORCE;
  process.env.AGENT_FLOW_WORKSPACE_GOVERNANCE_ENFORCE = "true";
  t.after(() => {
    if (previousEnforce === undefined) {
      delete process.env.AGENT_FLOW_WORKSPACE_GOVERNANCE_ENFORCE;
    } else {
      process.env.AGENT_FLOW_WORKSPACE_GOVERNANCE_ENFORCE = previousEnforce;
    }
  });
  const savedGovernance = await app.inject({
    method: "PUT",
    url: "/workspace-governance",
    headers: {
      "content-type": "application/json",
      "x-agent-flow-actor": "local-studio",
    },
    payload: {
      format: "agent-flow-builder.workspace-governance.v1",
      updatedBy: "local-studio",
      participants: [
        {
          id: "local-studio",
          name: "Local Studio",
          role: "owner",
          areas: ["*"],
          status: "active",
          updatedAt: "2026-07-04T11:00:00.000Z",
          updatedBy: "system",
        },
        {
          id: "qa-viewer",
          name: "QA Viewer",
          role: "viewer",
          areas: ["governance", "replay_governance"],
          status: "active",
          updatedAt: "2026-07-04T11:00:00.000Z",
          updatedBy: "local-studio",
        },
      ],
      policies: [
        {
          area: "governance",
          mode: "review_required",
          requiredRole: "reviewer",
          updatedAt: "2026-07-04T11:00:00.000Z",
          updatedBy: "local-studio",
        },
        {
          area: "replay_governance",
          mode: "review_required",
          requiredRole: "reviewer",
          updatedAt: "2026-07-04T11:00:00.000Z",
          updatedBy: "local-studio",
        },
      ],
    },
  });
  assert.equal(savedGovernance.statusCode, 200);

  const viewerCuration = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/studio-node-pins/conflicts/${encodeURIComponent(nodePinConflictId)}/curation`,
    headers: {
      "content-type": "application/json",
      "x-agent-flow-actor": "qa-viewer",
    },
    payload: {
      action: "release",
      actor: "qa-viewer",
      role: "viewer",
      note: "Viewer nao deve conseguir mutar conflito agregado.",
    },
  });
  assert.equal(viewerCuration.statusCode, 403);
  assert.equal(viewerCuration.json().details.decision.area, "replay_governance");
  assert.equal(viewerCuration.json().details.decision.action, "merge");

  const resolvedPins = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/studio-node-pins/conflicts/${encodeURIComponent(nodePinConflictId)}/resolve`,
    headers: {
      "content-type": "application/json",
      "x-agent-flow-actor": "local-studio",
    },
    payload: {
      keepPinId: "pin-current",
      resolvedBy: "local-studio",
      resolvedRole: "owner",
      resolutionNote: "Revisao agregada concluida pelo owner local.",
    },
  });
  assert.equal(resolvedPins.statusCode, 200);

  const diffResponse = await app.inject({
    method: "POST",
    url: "/collaboration/conflicts/diff?flowId=reference-interview",
    headers: {
      "content-type": "application/json",
      "x-agent-flow-actor": "local-studio",
    },
    payload: { overview },
  });
  assert.equal(diffResponse.statusCode, 200);
  const diff = diffResponse.json();
  assert.equal(diff.format, "agent-flow-builder.collaboration-conflict-overview-diff.v1");
  assert.equal(diff.governance.usesGovernedConflictReviewsOnly, true);
  assert.equal(diff.governance.excludesRawInputOutput, true);
  assert.equal(diff.governance.excludesHeaders, true);
  assert.equal(diff.governance.excludesTokens, true);
  assert.equal(diff.governance.excludesPayloads, true);
  assert.equal(diff.governance.excludesSecretValues, true);
  assert.equal(diff.governance.comparesHashesAndGovernedRefsOnly, true);
  assert.equal(diff.summary.status, "changed");
  assert.equal(diff.summary.openConflictDelta <= -1, true);
  assert.equal(diff.sections.some((section) => section.id === "conflicts" && section.changedCount >= 1), true);

  const rawDiffResponse = await app.inject({
    method: "POST",
    url: "/collaboration/conflicts/diff?flowId=reference-interview",
    headers: {
      "content-type": "application/json",
      "x-agent-flow-actor": "local-studio",
    },
    payload: {
      overview: {
        ...overview,
        payload: {
          token: "incoming-secret-token",
        },
      },
    },
  });
  assert.equal(rawDiffResponse.statusCode, 400);

  const serialized = JSON.stringify(overview);
  assert.equal(serialized.includes("current-secret-api-key"), false);
  assert.equal(serialized.includes("current-secret-token"), false);
  assert.equal(serialized.includes("incoming-secret-password"), false);
  assert.equal(serialized.includes("incoming-secret-token"), false);
  assert.equal(serialized.includes("authorization"), false);
  assert.equal(serialized.includes("password"), false);
  assert.equal(serialized.includes("candidates"), false);
  const serializedDiff = JSON.stringify(diff);
  assert.equal(serializedDiff.includes("current-secret-api-key"), false);
  assert.equal(serializedDiff.includes("current-secret-token"), false);
  assert.equal(serializedDiff.includes("incoming-secret-password"), false);
  assert.equal(serializedDiff.includes("incoming-secret-token"), false);
  assert.equal(serializedDiff.includes("authorization"), false);
  assert.equal(serializedDiff.includes("password"), false);
  assert.equal(serializedDiff.includes("candidates"), false);
});
