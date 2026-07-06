import { strict as assert } from "node:assert";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../apps/builder-api/src/server.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FLOW_ID = "reference-interview";

const EXPECTED_AREAS = [
  {
    id: "workspace-governance",
    governanceArea: "governance",
    reviewPath: "/workspace-governance",
    diffPath: null,
    curationPathTemplate: null,
    resolvePathTemplate: "/workspace-governance/conflicts/:conflictId/resolve",
  },
  {
    id: "catalog-shared-library",
    governanceArea: "catalog",
    reviewPath: "/catalog/shared-library/conflicts-review",
    diffPath: "/catalog/shared-library/conflicts-review/diff",
    curationPathTemplate: "/catalog/shared-library/conflicts/:conflictId/curation",
    resolvePathTemplate: "/catalog/shared-library/conflicts/:conflictId/resolve",
  },
  {
    id: "schema-patterns",
    governanceArea: "schemas",
    reviewPath: `/flows/${FLOW_ID}/schema-pattern-library/conflicts-review`,
    diffPath: `/flows/${FLOW_ID}/schema-pattern-library/conflicts-review/diff`,
    curationPathTemplate: null,
    resolvePathTemplate: `/flows/${FLOW_ID}/schema-pattern-library/conflicts/:conflictId/resolve`,
  },
  {
    id: "studio-scenarios",
    governanceArea: "experiments",
    reviewPath: `/flows/${FLOW_ID}/studio-scenarios/conflicts-review`,
    diffPath: `/flows/${FLOW_ID}/studio-scenarios/conflicts-review/diff`,
    curationPathTemplate: `/flows/${FLOW_ID}/studio-scenarios/conflicts/:conflictId/curation`,
    resolvePathTemplate: `/flows/${FLOW_ID}/studio-scenarios/conflicts/:conflictId/resolve`,
  },
  {
    id: "annotation-queue",
    governanceArea: "experiments",
    reviewPath: `/flows/${FLOW_ID}/annotation-queue/conflicts-review`,
    diffPath: `/flows/${FLOW_ID}/annotation-queue/conflicts-review/diff`,
    curationPathTemplate: `/flows/${FLOW_ID}/annotation-queue/conflicts/:conflictId/curation`,
    resolvePathTemplate: null,
  },
  {
    id: "studio-node-pins",
    governanceArea: "replay_governance",
    reviewPath: `/flows/${FLOW_ID}/studio-node-pins/conflicts-review`,
    diffPath: `/flows/${FLOW_ID}/studio-node-pins/conflicts-review/diff`,
    curationPathTemplate: `/flows/${FLOW_ID}/studio-node-pins/conflicts/:conflictId/curation`,
    resolvePathTemplate: `/flows/${FLOW_ID}/studio-node-pins/conflicts/:conflictId/resolve`,
  },
  {
    id: "debug-layer-snapshots",
    governanceArea: "replay_governance",
    reviewPath: `/flows/${FLOW_ID}/debug-layer-snapshots/conflicts-review`,
    diffPath: `/flows/${FLOW_ID}/debug-layer-snapshots/conflicts-review/diff`,
    curationPathTemplate: `/flows/${FLOW_ID}/debug-layer-snapshots/conflicts/:conflictId/curation`,
    resolvePathTemplate: `/flows/${FLOW_ID}/debug-layer-snapshots/conflicts/:conflictId/resolve`,
  },
  {
    id: "replay-governance",
    governanceArea: "replay_governance",
    reviewPath: `/flows/${FLOW_ID}/replay-governance-history/conflicts-review`,
    diffPath: `/flows/${FLOW_ID}/replay-governance-history/conflicts-review/diff`,
    curationPathTemplate: `/flows/${FLOW_ID}/replay-governance-history/conflicts/:conflictId/curation`,
    resolvePathTemplate: `/flows/${FLOW_ID}/replay-governance-history/conflicts/:conflictId/resolve`,
  },
] as const;

async function main(): Promise<void> {
  const workspaceRoot = await createWorkspaceFixture();
  try {
    const app = buildApp({ workspaceRoot });
    const response = await app.inject({
      method: "GET",
      url: `/collaboration/conflicts?flowId=${encodeURIComponent(FLOW_ID)}`,
    });
    assert.equal(response.statusCode, 200);
    const overview = response.json();
    assert.equal(overview.format, "agent-flow-builder.collaboration-conflict-overview.v1");
    assert.equal(overview.scope.flowId, FLOW_ID);
    assert.deepEqual(overview.scope.includedFlowIds, [FLOW_ID]);
    assert.equal(overview.governance.usesGovernedConflictReviewsOnly, true);
    assert.equal(overview.governance.viewerMutationBlockedBySourceRoutes, true);
    assert.equal(overview.governance.excludesRawSchemas, true);
    assert.equal(overview.governance.excludesRawPrompts, true);
    assert.equal(overview.governance.excludesRawInputOutput, true);
    assert.equal(overview.governance.excludesHeaders, true);
    assert.equal(overview.governance.excludesTokens, true);
    assert.equal(overview.governance.excludesPayloads, true);
    assert.equal(overview.governance.excludesSecretValues, true);

    for (const expected of EXPECTED_AREAS) {
      const area = overview.areas.find((item: any) => item.id === expected.id);
      assert.ok(area, `Area ausente na visao agregada: ${expected.id}`);
      assert.equal(area.governanceArea, expected.governanceArea);
      assert.equal(area.reviewPath, expected.reviewPath);
      assert.equal(area.sourceActions.reviewPath, expected.reviewPath);
      assert.equal(area.sourceActions.diffPath, expected.diffPath);
      assert.equal(area.sourceActions.curationPathTemplate, expected.curationPathTemplate);
      assert.equal(area.sourceActions.resolvePathTemplate, expected.resolvePathTemplate);
      assert.equal(area.sourceActions.viewerMutationBlocked, true);
    }

    const diffResponse = await app.inject({
      method: "POST",
      url: `/collaboration/conflicts/diff?flowId=${encodeURIComponent(FLOW_ID)}`,
      headers: { "content-type": "application/json" },
      payload: { overview },
    });
    assert.equal(diffResponse.statusCode, 200);
    const diff = diffResponse.json();
    assert.equal(diff.format, "agent-flow-builder.collaboration-conflict-overview-diff.v1");
    assert.match(diff.summary.status, /^(changed|unchanged)$/);
    assert.equal(diff.summary.areaCountDelta, 0);
    assert.equal(diff.summary.conflictCountDelta, 0);
    assert.equal(diff.summary.openConflictDelta, 0);
    assert.equal(diff.summary.assignedConflictDelta, 0);
    assert.equal(diff.summary.unassignedConflictDelta, 0);
    assert.equal(diff.summary.expiredLeaseDelta, 0);
    assert.equal(diff.summary.resolutionHistoryDelta, 0);
    assert.equal(diff.sections.every((section: any) => section.changedCount === 0), true);
    assert.equal(diff.governance.comparesHashesAndGovernedRefsOnly, true);
    assertNoRawCollaborationContent(JSON.stringify({ overview, diff }));

    console.log(JSON.stringify({
      format: "agent-flow-builder.collaboration-conflict-contract.v1",
      status: "ok",
      mvpPrincipal: "verified_100_percent",
      expandedPlan: "in_progress",
      flowId: FLOW_ID,
      areaCount: EXPECTED_AREAS.length,
      checks: [
        "aggregate_conflict_overview",
        "source_action_templates",
        "viewer_mutation_blocked_contract",
        "governed_diff_without_raw_payloads",
      ],
    }, null, 2));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function createWorkspaceFixture(): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-flow-collaboration-contract-"));
  await mkdir(path.join(workspaceRoot, "flows"), { recursive: true });
  await cp(
    path.join(REPO_ROOT, "flows", FLOW_ID),
    path.join(workspaceRoot, "flows", FLOW_ID),
    { recursive: true },
  );
  await rm(path.join(workspaceRoot, "flows", FLOW_ID, ".agent-flow"), { recursive: true, force: true });
  await cp(path.join(REPO_ROOT, "runtime.manifest.json"), path.join(workspaceRoot, "runtime.manifest.json"));
  return workspaceRoot;
}

function assertNoRawCollaborationContent(serialized: string): void {
  assert.doesNotMatch(serialized, /Bearer\s+\S+/i);
  assert.doesNotMatch(serialized, /-----BEGIN [A-Z ]+PRIVATE KEY-----/i);
  assert.doesNotMatch(serialized, /current-secret|incoming-secret/i);
  assert.doesNotMatch(serialized, /"input"\s*:/i);
  assert.doesNotMatch(serialized, /"output"\s*:/i);
  assert.doesNotMatch(serialized, /"payload"\s*:/i);
  assert.doesNotMatch(serialized, /"headers"\s*:/i);
  assert.doesNotMatch(serialized, /"candidates"\s*:/i);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
