import { strict as assert } from "node:assert";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildApp } from "./server.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function createWorkspaceFixture() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-builder-scenario-review-"));
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

test("Builder API exports governed Studio scenario conflict review without raw candidates", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const app = buildApp({ workspaceRoot });

  const basePackage = {
    format: "agent-flow-builder.studio-scenarios.v1",
    flowId: "reference-interview",
    scenarios: [
      {
        id: "scenario-main",
        label: "Fluxo multiagente principal",
        input: "Criar perguntas sobre o conteúdo.",
        payload: {
          user_message: "Criar perguntas sobre o conteúdo.",
          api_key: "scenario-api-key",
          nested: { authorization: "Bearer scenario-token" },
        },
        tags: ["multiagent", "questions"],
        expectedOutputText: "pergunta",
        createdAt: "2026-07-04T10:00:00.000Z",
        updatedAt: "2026-07-04T10:00:00.000Z",
        sourceContext: {
          kind: "checkpoint_fork",
          agentId: "reference-interview",
          primaryRunId: "run-main",
          baselineRunId: null,
          candidateRunId: null,
          sessionId: "session-main",
          nodeId: "llm_step",
          eventSeq: 4,
          label: "Run multiagente",
        },
      },
    ],
    datasets: [
      {
        id: "dataset-main",
        name: "Regressão multiagente",
        description: "Dataset compartilhado",
        scenarioIds: ["scenario-main"],
        tags: ["multiagent"],
        version: 1,
        createdAt: "2026-07-04T10:00:00.000Z",
        updatedAt: "2026-07-04T10:00:00.000Z",
        lastRunAt: null,
        runHistory: [],
      },
    ],
    evaluators: [
      {
        id: "evaluator-main",
        name: "Evaluator multiagente",
        description: "Valida resposta com pergunta gerada.",
        kind: "external_http",
        operator: "all",
        expectedText: "pergunta",
        matchMode: "contains",
        caseSensitive: false,
        rules: [],
        external: {
          endpointUrl: "http://127.0.0.1:8080/judge",
          token: "evaluator-token",
          headers: { authorization: "Bearer evaluator-secret" },
        },
        createdAt: "2026-07-04T10:00:00.000Z",
        updatedAt: "2026-07-04T10:00:00.000Z",
      },
    ],
  };

  const saved = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/studio-scenarios",
    headers: { "content-type": "application/json" },
    payload: basePackage,
  });
  assert.equal(saved.statusCode, 200);

  const merged = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/studio-scenarios/merge",
    headers: { "content-type": "application/json" },
    payload: {
      ...basePackage,
      scenarios: [
        {
          ...basePackage.scenarios[0],
          label: "Fluxo multiagente principal atualizado",
          updatedAt: "2026-07-04T10:05:00.000Z",
        },
        {
          id: "scenario-support",
          label: "Handoff suporte",
          input: "Encaminhar para suporte.",
          payload: { user_message: "Encaminhar para suporte.", token: "support-token" },
          tags: ["multiagent", "support"],
          createdAt: "2026-07-04T10:06:00.000Z",
          updatedAt: "2026-07-04T10:06:00.000Z",
          sourceContext: {
            kind: "node_debug",
            agentId: "support-agent",
            primaryRunId: "run-support",
            sessionId: "session-support",
            nodeId: "support_llm",
            eventSeq: 2,
            label: "Handoff suporte",
          },
        },
      ],
      datasets: [
        {
          ...basePackage.datasets[0],
          scenarioIds: ["scenario-main", "scenario-support"],
          updatedAt: "2026-07-04T10:06:00.000Z",
        },
      ],
      evaluators: [
        {
          ...basePackage.evaluators[0],
          name: "Evaluator multiagente atualizado",
          updatedAt: "2026-07-04T10:07:00.000Z",
        },
      ],
    },
  });
  assert.equal(merged.statusCode, 200);
  assert.equal(merged.json().conflictCount, 3);
  const scenarioConflict = merged.json().conflicts.find((conflict) => conflict.kind === "scenario");
  assert.ok(scenarioConflict);

  const curated = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/studio-scenarios/conflicts/${scenarioConflict.conflictId}/curation`,
    headers: { "content-type": "application/json" },
    payload: { action: "assign", actor: "qa-curator", role: "reviewer", note: "Revisar divergência sem abrir payload bruto." },
  });
  assert.equal(curated.statusCode, 200);

  const review = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-scenarios/conflicts-review",
  });
  assert.equal(review.statusCode, 200);
  const reviewBody = review.json();
  const reviewText = JSON.stringify(reviewBody);
  assert.equal(reviewBody.format, "agent-flow-builder.studio-scenarios-conflict-review.v1");
  assert.equal(reviewBody.conflictCount, 3);
  assert.equal(reviewBody.summary.scenarioConflictCount, 1);
  assert.equal(reviewBody.summary.datasetConflictCount, 1);
  assert.equal(reviewBody.summary.evaluatorConflictCount, 1);
  assert.equal(reviewBody.summary.assignedConflictCount, 1);
  assert.equal(reviewBody.governance.excludesCandidates, true);
  assert.equal(reviewBody.governance.excludesRawScenarioInputs, true);
  assert.equal(reviewBody.governance.excludesRawScenarioPayloads, true);
  assert.equal(reviewBody.conflicts[0].candidates, undefined);
  assert.ok(Array.isArray(reviewBody.conflicts[0].candidateContentHashes));
  assert.equal(reviewText.includes("Criar perguntas sobre o conteúdo."), false);
  assert.equal(reviewText.includes("Encaminhar para suporte."), false);
  assert.equal(reviewText.includes("scenario-api-key"), false);
  assert.equal(reviewText.includes("scenario-token"), false);
  assert.equal(reviewText.includes("support-token"), false);
  assert.equal(reviewText.includes("evaluator-token"), false);

  const importedReview = JSON.parse(JSON.stringify(reviewBody));
  importedReview.conflicts = importedReview.conflicts.slice(1);
  const diff = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/studio-scenarios/conflicts-review/diff",
    headers: { "content-type": "application/json" },
    payload: { review: importedReview },
  });
  assert.equal(diff.statusCode, 200);
  const diffBody = diff.json();
  const diffText = JSON.stringify(diffBody);
  assert.equal(diffBody.format, "agent-flow-builder.studio-scenarios-conflict-review-diff.v1");
  assert.equal(diffBody.current.conflictCount, 3);
  assert.equal(diffBody.incoming.conflictCount, 2);
  assert.equal(diffBody.summary.status, "changed");
  assert.equal(diffBody.summary.onlyCurrentConflictCount, 1);
  assert.equal(diffBody.governance.excludesCandidates, true);
  assert.equal(diffBody.governance.excludesRawScenarioInputs, true);
  assert.equal(diffBody.governance.excludesRawScenarioPayloads, true);
  assert.equal(diffText.includes('"candidates"'), false);
  assert.equal(diffText.includes("Criar perguntas sobre o conteúdo."), false);
  assert.equal(diffText.includes("Encaminhar para suporte."), false);
  assert.equal(diffText.includes("scenario-api-key"), false);
  assert.equal(diffText.includes("evaluator-token"), false);

  const invalidDiff = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/studio-scenarios/conflicts-review/diff",
    headers: { "content-type": "application/json" },
    payload: {
      review: {
        ...reviewBody,
        conflicts: [
          {
            ...reviewBody.conflicts[0],
            candidates: [{ input: "Criar perguntas sobre o conteúdo.", payload: { token: "raw-token" } }],
          },
        ],
      },
    },
  });
  assert.equal(invalidDiff.statusCode, 400);

  const resolved = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/studio-scenarios/conflicts/${scenarioConflict.conflictId}/resolve`,
    headers: { "content-type": "application/json" },
    payload: {
      keepContentHash: scenarioConflict.latestContentHash,
      resolvedBy: "qa-curator",
      role: "reviewer",
      resolutionNote: "Manter revisão mais recente.",
    },
  });
  assert.equal(resolved.statusCode, 200);

  const resolvedReview = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-scenarios/conflicts-review",
  });
  assert.equal(resolvedReview.statusCode, 200);
  assert.equal(resolvedReview.json().conflictCount, 2);
  assert.equal(resolvedReview.json().resolutionHistoryCount, 1);
  assert.equal(resolvedReview.json().resolutionHistory[0].resolvedBy, "qa-curator");
  assert.equal(JSON.stringify(resolvedReview.json()).includes("Criar perguntas sobre o conteúdo."), false);
});
