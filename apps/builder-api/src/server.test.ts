import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
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

test("Builder API preserves Fastify client error status codes", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-builder-api-errors-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const app = buildApp({ workspaceRoot });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/flows/missing/validate",
    headers: { "content-type": "application/xml" },
    payload: "unsupported",
  });

  assert.equal(response.statusCode, 415);
  assert.equal(response.json().error, "request_error");
});

test("Builder API shares Studio node pins with secret-like fields redacted", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const app = buildApp({ workspaceRoot });

  const emptyPins = await app.inject({ method: "GET", url: "/flows/reference-interview/studio-node-pins" });
  assert.equal(emptyPins.statusCode, 200);
  assert.equal(emptyPins.json().format, "agent-flow-builder.studio-node-pins.v1");
  assert.equal(emptyPins.json().pinCount, 0);
  assert.equal(emptyPins.json().sharedSync.action, "empty");

  const savedPins = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/studio-node-pins",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.studio-node-pins.v1",
      flowId: "reference-interview",
      pins: [
        {
          id: "pin-llm",
          nodeId: "llm_step",
          nodeType: "llm",
          runId: "run-1",
          sessionId: "session-1",
          eventSeq: 3,
          eventType: "node_end",
          nodeHash: "node-hash-1",
          input: { user_message: "Olá", api_key: "secret-api-key" },
          output: { answer: "Oi", authorization: "Bearer secret-token" },
          createdAt: "2026-07-03T10:00:00.000Z",
          updatedAt: "2026-07-03T10:00:00.000Z",
        },
      ],
    },
  });
  assert.equal(savedPins.statusCode, 200);
  assert.equal(savedPins.json().pinCount, 1);
  assert.equal(savedPins.json().sharedSync.action, "save");
  assert.equal(savedPins.json().governance.includesPinInputOutput, true);
  assert.equal(savedPins.json().governance.redactsSecretLikeKeys, true);
  assert.equal(savedPins.json().pins[0].input.api_key, "[redacted]");
  assert.equal(savedPins.json().pins[0].output.authorization, "[redacted]");
  assert.equal(JSON.stringify(savedPins.json()).includes("secret-api-key"), false);
  assert.equal(JSON.stringify(savedPins.json()).includes("secret-token"), false);

  const mergedPins = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/studio-node-pins/merge",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.studio-node-pins.v1",
      flowId: "reference-interview",
      pins: [
        {
          id: "pin-llm-old",
          nodeId: "llm_step",
          nodeType: "llm",
          runId: "run-old",
          sessionId: "session-old",
          eventSeq: 1,
          eventType: "node_end",
          nodeHash: "node-hash-old",
          input: { user_message: "antigo" },
          output: { answer: "antigo" },
          createdAt: "2026-07-03T09:00:00.000Z",
          updatedAt: "2026-07-03T09:00:00.000Z",
        },
        {
          id: "pin-safety",
          nodeId: "input_safety_check",
          nodeType: "safety_gate",
          runId: "run-2",
          sessionId: "session-2",
          eventSeq: 2,
          eventType: "node_end",
          nodeHash: "node-hash-2",
          input: { text: "ok" },
          output: { allowed: true },
          createdAt: "2026-07-03T11:00:00.000Z",
          updatedAt: "2026-07-03T11:00:00.000Z",
        },
      ],
    },
  });
  assert.equal(mergedPins.statusCode, 200);
  assert.equal(mergedPins.json().pinCount, 2);
  assert.equal(mergedPins.json().sharedSync.action, "merge");
  assert.equal(mergedPins.json().sharedSync.addedCount, 1);
  assert.equal(mergedPins.json().sharedSync.unchangedCount, 1);
  assert.equal(mergedPins.json().conflictCount, 1);
  assert.equal(mergedPins.json().openConflictCount, 1);
  assert.equal(mergedPins.json().sharedSync.conflictCount, 1);
  const firstConflict = mergedPins.json().conflicts.find((conflict: any) => conflict.nodeId === "llm_step");
  assert.equal(firstConflict.status, "open");
  assert.deepEqual(new Set(firstConflict.pinIds), new Set(["pin-llm", "pin-llm-old"]));
  assert.equal(firstConflict.latestPinId, "pin-llm");
  assert.equal(firstConflict.governance.redactsSecretLikeKeys, true);
  assert.equal(firstConflict.governance.excludesSecretValues, true);
  assert.equal(JSON.stringify(firstConflict).includes("secret-api-key"), false);
  assert.equal(JSON.stringify(firstConflict).includes("secret-token"), false);
  const llmPin = mergedPins.json().pins.find((pin: any) => pin.nodeId === "llm_step");
  assert.equal(llmPin.runId, "run-1");
  assert.equal(llmPin.output.answer, "Oi");
  await access(path.join(workspaceRoot, "flows", "reference-interview", ".agent-flow", "studio-node-pins", "pins.afnodepins.json"));

  const persistedPins = await app.inject({ method: "GET", url: "/flows/reference-interview/studio-node-pins" });
  assert.equal(persistedPins.statusCode, 200);
  assert.equal(persistedPins.json().pinCount, 2);
  assert.equal(persistedPins.json().conflictCount, 1);
  assert.equal(JSON.stringify(persistedPins.json()).includes("secret-api-key"), false);
  assert.equal(JSON.stringify(persistedPins.json()).includes("secret-token"), false);

  const secondConflictMerge = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/studio-node-pins/merge",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.studio-node-pins.v1",
      flowId: "reference-interview",
      pins: [
        {
          id: "pin-safety-alt",
          nodeId: "input_safety_check",
          nodeType: "safety_gate",
          runId: "run-3",
          sessionId: "session-3",
          eventSeq: 5,
          eventType: "node_end",
          nodeHash: "node-hash-3",
          input: { text: "needs review", password: "second-secret" },
          output: { allowed: false, token: "second-token" },
          createdAt: "2026-07-03T11:30:00.000Z",
          updatedAt: "2026-07-03T11:30:00.000Z",
        },
      ],
    },
  });
  assert.equal(secondConflictMerge.statusCode, 200);
  assert.equal(secondConflictMerge.json().pinCount, 2);
  assert.equal(secondConflictMerge.json().conflictCount, 2);
  assert.equal(secondConflictMerge.json().openConflictCount, 2);
  assert.equal(JSON.stringify(secondConflictMerge.json()).includes("second-secret"), false);
  assert.equal(JSON.stringify(secondConflictMerge.json()).includes("second-token"), false);

  const llmConflict = secondConflictMerge.json().conflicts.find((conflict: any) => conflict.nodeId === "llm_step");
  const viewerAssignedNodePinConflict = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/studio-node-pins/conflicts/${encodeURIComponent(llmConflict.conflictId)}/curation`,
    headers: { "content-type": "application/json" },
    payload: {
      action: "assign",
      actor: "pin-viewer",
      role: "viewer",
      note: "Tentativa somente leitura.",
    },
  });
  assert.equal(viewerAssignedNodePinConflict.statusCode, 403);
  assert.equal(viewerAssignedNodePinConflict.json().details.code, "studio_node_pin_conflict_viewer_forbidden");

  const assignedNodePinConflict = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/studio-node-pins/conflicts/${encodeURIComponent(llmConflict.conflictId)}/curation`,
    headers: { "content-type": "application/json" },
    payload: {
      action: "assign",
      actor: "pin-curator",
      role: "reviewer",
      note: "Vou revisar pins divergentes.",
    },
  });
  assert.equal(assignedNodePinConflict.statusCode, 200);
  assert.equal(assignedNodePinConflict.json().sharedSync.action, "curate_conflict");
  const assignedNodePinThread = assignedNodePinConflict
    .json()
    .conflicts.find((conflict: any) => conflict.conflictId === llmConflict.conflictId).curationThread;
  assert.equal(assignedNodePinThread.status, "assigned");
  assert.equal(assignedNodePinThread.assignee, "pin-curator");
  assert.equal(assignedNodePinThread.lastAction, "assign");
  assert.equal(assignedNodePinThread.note, "Vou revisar pins divergentes.");
  assert.equal(assignedNodePinThread.events.length, 1);
  assert.equal(assignedNodePinThread.events[0].action, "assign");
  assert.equal(assignedNodePinThread.events[0].actor, "pin-curator");
  assert.equal(assignedNodePinThread.events[0].role, "reviewer");
  assert.equal(assignedNodePinThread.events[0].assignee, "pin-curator");
  assert.equal(assignedNodePinThread.governance.excludesRawPinInputOutput, true);
  assert.equal(assignedNodePinThread.governance.redactsSecretLikeKeys, true);
  assert.equal(assignedNodePinThread.governance.excludesSecretValues, true);
  assert.ok(assignedNodePinThread.leaseExpiresAt);
  assert.equal(assignedNodePinThread.leaseDurationHours, 24);
  assert.equal(assignedNodePinThread.leaseExpired, false);
  assert.equal(assignedNodePinThread.governance.autoReleasesExpiredAssignments, true);
  assert.equal(JSON.stringify(assignedNodePinConflict.json()).includes("secret-api-key"), false);
  assert.equal(JSON.stringify(assignedNodePinConflict.json()).includes("secret-token"), false);

  const releasedNodePinConflict = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/studio-node-pins/conflicts/${encodeURIComponent(llmConflict.conflictId)}/curation`,
    headers: { "content-type": "application/json" },
    payload: {
      action: "release",
      actor: "pin-curator",
      role: "reviewer",
    },
  });
  assert.equal(releasedNodePinConflict.statusCode, 200);
  const releasedNodePinThread = releasedNodePinConflict
    .json()
    .conflicts.find((conflict: any) => conflict.conflictId === llmConflict.conflictId).curationThread;
  assert.equal(releasedNodePinThread.status, "unassigned");
  assert.equal(releasedNodePinThread.assignee, "");
  assert.equal(releasedNodePinThread.lastAction, "release");
  assert.equal(releasedNodePinThread.events.length, 2);
  assert.equal(releasedNodePinThread.events[0].action, "release");
  assert.equal(releasedNodePinThread.events.some((event: any) => event.action === "assign"), true);

  const reassignedNodePinConflict = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/studio-node-pins/conflicts/${encodeURIComponent(llmConflict.conflictId)}/curation`,
    headers: { "content-type": "application/json" },
    payload: {
      action: "assign",
      actor: "pin-curator",
      role: "reviewer",
    },
  });
  assert.equal(reassignedNodePinConflict.statusCode, 200);
  assert.equal(
    reassignedNodePinConflict
      .json()
      .conflicts.find((conflict: any) => conflict.conflictId === llmConflict.conflictId).curationThread.status,
    "assigned",
  );
  const reassignedNodePinThread = reassignedNodePinConflict
    .json()
    .conflicts.find((conflict: any) => conflict.conflictId === llmConflict.conflictId).curationThread;
  assert.equal(reassignedNodePinThread.events.length, 3);
  assert.equal(reassignedNodePinThread.events[0].action, "assign");
  assert.equal(reassignedNodePinThread.events[0].role, "reviewer");
  assert.ok(reassignedNodePinThread.leaseExpiresAt);
  assert.equal(reassignedNodePinThread.leaseDurationHours, 24);

  const nodePinConflictReview = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-node-pins/conflicts-review",
  });
  assert.equal(nodePinConflictReview.statusCode, 200);
  const nodePinConflictReviewBody: any = nodePinConflictReview.json();
  const nodePinConflictReviewText = JSON.stringify(nodePinConflictReviewBody);
  assert.equal(nodePinConflictReviewBody.format, "agent-flow-builder.studio-node-pins-conflict-review.v1");
  assert.equal(nodePinConflictReviewBody.conflictCount, 2);
  assert.equal(nodePinConflictReviewBody.summary.nodeCount, 2);
  assert.equal(nodePinConflictReviewBody.summary.assignedConflictCount, 1);
  assert.equal(nodePinConflictReviewBody.governance.excludesCandidates, true);
  assert.equal(nodePinConflictReviewBody.governance.excludesRawPinInputOutput, true);
  assert.equal(nodePinConflictReviewBody.conflicts[0].candidates, undefined);
  assert.ok(Array.isArray(nodePinConflictReviewBody.conflicts[0].pinContentHashes));
  assert.equal(nodePinConflictReviewText.includes('"candidates"'), false);
  assert.equal(nodePinConflictReviewText.includes('"input"'), false);
  assert.equal(nodePinConflictReviewText.includes('"output"'), false);
  assert.equal(nodePinConflictReviewText.includes("secret-api-key"), false);
  assert.equal(nodePinConflictReviewText.includes("secret-token"), false);
  assert.equal(nodePinConflictReviewText.includes("second-secret"), false);
  assert.equal(nodePinConflictReviewText.includes("second-token"), false);

  const importedNodePinReview = JSON.parse(JSON.stringify(nodePinConflictReviewBody));
  importedNodePinReview.conflicts = importedNodePinReview.conflicts.slice(1);
  const nodePinConflictReviewDiff = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/studio-node-pins/conflicts-review/diff",
    headers: { "content-type": "application/json" },
    payload: { review: importedNodePinReview },
  });
  assert.equal(nodePinConflictReviewDiff.statusCode, 200);
  const nodePinConflictReviewDiffBody: any = nodePinConflictReviewDiff.json();
  const nodePinConflictReviewDiffText = JSON.stringify(nodePinConflictReviewDiffBody);
  assert.equal(nodePinConflictReviewDiffBody.format, "agent-flow-builder.studio-node-pins-conflict-review-diff.v1");
  assert.equal(nodePinConflictReviewDiffBody.current.conflictCount, 2);
  assert.equal(nodePinConflictReviewDiffBody.incoming.conflictCount, 1);
  assert.equal(nodePinConflictReviewDiffBody.summary.status, "changed");
  assert.equal(nodePinConflictReviewDiffBody.summary.onlyCurrentConflictCount, 1);
  assert.equal(nodePinConflictReviewDiffBody.governance.excludesCandidates, true);
  assert.equal(nodePinConflictReviewDiffBody.governance.excludesRawPinInputOutput, true);
  assert.equal(nodePinConflictReviewDiffText.includes('"candidates"'), false);
  assert.equal(nodePinConflictReviewDiffText.includes('"input"'), false);
  assert.equal(nodePinConflictReviewDiffText.includes('"output"'), false);
  assert.equal(nodePinConflictReviewDiffText.includes("secret-api-key"), false);
  assert.equal(nodePinConflictReviewDiffText.includes("second-secret"), false);

  const invalidNodePinConflictReviewDiff = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/studio-node-pins/conflicts-review/diff",
    headers: { "content-type": "application/json" },
    payload: {
      review: {
        ...nodePinConflictReviewBody,
        conflicts: [
          {
            ...nodePinConflictReviewBody.conflicts[0],
            candidates: [{ input: { api_key: "raw-secret" }, output: { token: "raw-token" } }],
          },
        ],
      },
    },
  });
  assert.equal(invalidNodePinConflictReviewDiff.statusCode, 400);

  const expiredNodePinPackage = reassignedNodePinConflict.json();
  expiredNodePinPackage.conflicts = expiredNodePinPackage.conflicts.map((conflict: any) =>
    conflict.conflictId === llmConflict.conflictId
      ? {
          ...conflict,
          curationThread: {
            ...conflict.curationThread,
            status: "assigned",
            assignee: "stale-pin-curator",
            openedAt: "2020-01-01T00:00:00.000Z",
            updatedAt: "2020-01-01T00:00:00.000Z",
            lastActor: "stale-pin-curator",
            lastAction: "assign",
            leaseExpiresAt: "2020-01-01T01:00:00.000Z",
            leaseDurationHours: 1,
            leaseExpired: false,
          },
        }
      : conflict,
  );
  const nodePinsPath = path.join(
    workspaceRoot,
    "flows",
    "reference-interview",
    ".agent-flow",
    "studio-node-pins",
    "pins.afnodepins.json",
  );
  await mkdir(path.dirname(nodePinsPath), { recursive: true });
  await writeFile(nodePinsPath, JSON.stringify(expiredNodePinPackage, null, 2));
  const expiredNodePinConflictResponse = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-node-pins",
  });
  assert.equal(expiredNodePinConflictResponse.statusCode, 200);
  const expiredNodePinThread = expiredNodePinConflictResponse
    .json()
    .conflicts.find((conflict: any) => conflict.conflictId === llmConflict.conflictId).curationThread;
  assert.equal(expiredNodePinThread.status, "unassigned");
  assert.equal(expiredNodePinThread.assignee, "");
  assert.equal(expiredNodePinThread.leaseExpired, true);
  assert.equal(expiredNodePinThread.leaseExpiresAt, null);
  assert.equal(expiredNodePinThread.lastAction, "lease_expired");
  assert.equal(expiredNodePinThread.events.some((event: any) => event.action === "lease_expired"), true);

  const viewerResolvedLlmConflict = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/studio-node-pins/conflicts/${encodeURIComponent(llmConflict.conflictId)}/resolve`,
    headers: { "content-type": "application/json" },
    payload: {
      keepPinId: "pin-llm-old",
      resolvedBy: "pin-viewer",
      resolvedRole: "viewer",
      resolutionNote: "Tentativa somente leitura.",
    },
  });
  assert.equal(viewerResolvedLlmConflict.statusCode, 403);
  assert.equal(viewerResolvedLlmConflict.json().details.code, "studio_node_pin_conflict_viewer_forbidden");

  const resolvedLlmConflict = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/studio-node-pins/conflicts/${encodeURIComponent(llmConflict.conflictId)}/resolve`,
    headers: { "content-type": "application/json" },
    payload: {
      keepPinId: "pin-llm-old",
      resolvedBy: "pin-curator",
      resolvedRole: "reviewer",
      resolutionNote: "Manter replay antigo.",
    },
  });
  assert.equal(resolvedLlmConflict.statusCode, 200);
  assert.equal(resolvedLlmConflict.json().sharedSync.action, "resolve_conflict");
  assert.equal(resolvedLlmConflict.json().pinCount, 2);
  assert.equal(resolvedLlmConflict.json().conflictCount, 1);
  assert.equal(resolvedLlmConflict.json().openConflictCount, 1);
  assert.equal(resolvedLlmConflict.json().resolutionHistoryCount, 1);
  assert.equal(resolvedLlmConflict.json().conflicts[0].nodeId, "input_safety_check");
  const resolutionRecord = resolvedLlmConflict.json().resolutionHistory[0];
  assert.equal(resolutionRecord.conflictId, llmConflict.conflictId);
  assert.equal(resolutionRecord.nodeId, "llm_step");
  assert.equal(resolutionRecord.resolvedBy, "pin-curator");
  assert.equal(resolutionRecord.resolvedRole, "reviewer");
  assert.equal(resolutionRecord.resolutionNote, "Manter replay antigo.");
  assert.equal(resolutionRecord.keptPinId, "pin-llm-old");
  assert.equal(resolutionRecord.keptRef.id, "pin-llm-old");
  assert.equal(resolutionRecord.discardedRefs.some((ref: any) => ref.id === "pin-llm"), true);
  assert.equal(resolutionRecord.governance.excludesRawPinInputOutput, true);
  const resolvedLlmPin = resolvedLlmConflict.json().pins.find((pin: any) => pin.nodeId === "llm_step");
  assert.equal(resolvedLlmPin.id, "pin-llm-old");
  assert.equal(resolvedLlmPin.output.answer, "antigo");
  assert.equal(JSON.stringify(resolvedLlmConflict.json()).includes("secret-api-key"), false);
  assert.equal(JSON.stringify(resolvedLlmConflict.json()).includes("secret-token"), false);
  assert.equal(JSON.stringify(resolvedLlmConflict.json()).includes("second-secret"), false);
  assert.equal(JSON.stringify(resolvedLlmConflict.json()).includes("second-token"), false);

  const reopenedDiscardedPinMerge = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/studio-node-pins/merge",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.studio-node-pins.v1",
      flowId: "reference-interview",
      pins: [
        {
          id: "pin-llm",
          nodeId: "llm_step",
          nodeType: "llm",
          runId: "run-1",
          sessionId: "session-1",
          eventSeq: 3,
          eventType: "node_end",
          nodeHash: "node-hash-1",
          input: { user_message: "Olá", api_key: "secret-api-key" },
          output: { answer: "Oi", authorization: "Bearer secret-token" },
          createdAt: "2026-07-03T10:00:00.000Z",
          updatedAt: "2026-07-03T10:00:00.000Z",
        },
      ],
    },
  });
  assert.equal(reopenedDiscardedPinMerge.statusCode, 200);
  assert.equal(reopenedDiscardedPinMerge.json().pinCount, 2);
  assert.equal(reopenedDiscardedPinMerge.json().conflictCount, 1);
  assert.equal(reopenedDiscardedPinMerge.json().openConflictCount, 1);
  assert.equal(reopenedDiscardedPinMerge.json().conflicts[0].nodeId, "input_safety_check");
  assert.equal(reopenedDiscardedPinMerge.json().resolutionHistoryCount, 1);
  const retainedAfterReopenAttempt = reopenedDiscardedPinMerge.json().pins.find((pin: any) => pin.nodeId === "llm_step");
  assert.equal(retainedAfterReopenAttempt.id, "pin-llm-old");
  assert.equal(JSON.stringify(reopenedDiscardedPinMerge.json()).includes("secret-api-key"), false);
  assert.equal(JSON.stringify(reopenedDiscardedPinMerge.json()).includes("secret-token"), false);

  const previousNodePinsCentralUrl = process.env.AGENT_FLOW_STUDIO_NODE_PINS_CENTRAL_URL;
  const previousNodePinsCentralToken = process.env.AGENT_FLOW_STUDIO_NODE_PINS_CENTRAL_TOKEN;
  const previousNodePinsCentralTimeout = process.env.AGENT_FLOW_STUDIO_NODE_PINS_CENTRAL_TIMEOUT_MS;
  t.after(() => {
    if (previousNodePinsCentralUrl === undefined) {
      delete process.env.AGENT_FLOW_STUDIO_NODE_PINS_CENTRAL_URL;
    } else {
      process.env.AGENT_FLOW_STUDIO_NODE_PINS_CENTRAL_URL = previousNodePinsCentralUrl;
    }
    if (previousNodePinsCentralToken === undefined) {
      delete process.env.AGENT_FLOW_STUDIO_NODE_PINS_CENTRAL_TOKEN;
    } else {
      process.env.AGENT_FLOW_STUDIO_NODE_PINS_CENTRAL_TOKEN = previousNodePinsCentralToken;
    }
    if (previousNodePinsCentralTimeout === undefined) {
      delete process.env.AGENT_FLOW_STUDIO_NODE_PINS_CENTRAL_TIMEOUT_MS;
    } else {
      process.env.AGENT_FLOW_STUDIO_NODE_PINS_CENTRAL_TIMEOUT_MS = previousNodePinsCentralTimeout;
    }
  });

  const centralPins = {
    format: "agent-flow-builder.studio-node-pins.v1",
    flowId: "reference-interview",
    pins: [
      {
        id: "pin-central-transform",
        nodeId: "normalize_context",
        nodeType: "transform_json",
        runId: "run-central",
        sessionId: "session-central",
        eventSeq: 4,
        eventType: "node_end",
        nodeHash: "node-hash-central",
        input: { text: "central", password: "central-password" },
        output: { normalized: true, token: "central-token-value" },
        createdAt: "2026-07-03T12:00:00.000Z",
        updatedAt: "2026-07-03T12:00:00.000Z",
      },
    ],
  };
  const nodePinsCentralRequests: Array<{ authorization: string | undefined; body: any }> = [];
  const nodePinsCentralServer = createServer(async (request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/sync");
    nodePinsCentralRequests.push({
      authorization: request.headers.authorization,
      body: await readJsonBody(request),
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ pins: centralPins }));
  });
  await new Promise<void>((resolve) => nodePinsCentralServer.listen(0, "127.0.0.1", resolve));
  t.after(() => nodePinsCentralServer.close());
  const nodePinsCentralAddress = nodePinsCentralServer.address() as AddressInfo;
  process.env.AGENT_FLOW_STUDIO_NODE_PINS_CENTRAL_URL = `http://127.0.0.1:${nodePinsCentralAddress.port}/sync`;
  process.env.AGENT_FLOW_STUDIO_NODE_PINS_CENTRAL_TOKEN = "studio-node-pins-central-token";
  process.env.AGENT_FLOW_STUDIO_NODE_PINS_CENTRAL_TIMEOUT_MS = "1500";

  const nodePinsCentralStatus = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-node-pins/central",
  });
  const nodePinsCentralStatusBody: any = nodePinsCentralStatus.json();
  assert.equal(nodePinsCentralStatus.statusCode, 200);
  assert.equal(nodePinsCentralStatusBody.format, "agent-flow-builder.studio-node-pins-central-sync-status.v1");
  assert.equal(nodePinsCentralStatusBody.configured, true);
  assert.equal(nodePinsCentralStatusBody.tokenConfigured, true);
  assert.equal(nodePinsCentralStatusBody.timeoutMs, 1500);
  assert.equal(nodePinsCentralStatusBody.governance.centralAuthTokenInHeaderOnly, true);
  assert.equal(nodePinsCentralStatusBody.governance.centralAuthTokenInBody, false);
  assert.equal(nodePinsCentralStatusBody.governance.storesCentralToken, false);
  assert.equal(nodePinsCentralStatusBody.governance.redactsSecretLikeKeys, true);
  assert.equal(JSON.stringify(nodePinsCentralStatusBody).includes("studio-node-pins-central-token"), false);
  assert.equal(JSON.stringify(nodePinsCentralStatusBody).includes(String(nodePinsCentralAddress.port)), false);

  const syncedNodePins = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/studio-node-pins/sync-central",
  });
  const syncedNodePinsBody: any = syncedNodePins.json();
  assert.equal(syncedNodePins.statusCode, 200);
  assert.equal(syncedNodePinsBody.format, "agent-flow-builder.studio-node-pins-central-sync-result.v1");
  assert.equal(syncedNodePinsBody.pushedPinCount, 2);
  assert.equal(syncedNodePinsBody.pulledPinCount, 1);
  assert.equal(syncedNodePinsBody.central.statusCode, 200);
  assert.equal(syncedNodePinsBody.pins.pinCount, 3);
  assert.equal(syncedNodePinsBody.governance.centralAuthTokenInHeaderOnly, true);
  assert.equal(syncedNodePinsBody.governance.centralAuthTokenInBody, false);
  assert.equal(syncedNodePinsBody.governance.redactsSecretLikeKeys, true);
  assert.equal(JSON.stringify(syncedNodePinsBody).includes("studio-node-pins-central-token"), false);
  assert.equal(JSON.stringify(syncedNodePinsBody).includes(String(nodePinsCentralAddress.port)), false);
  assert.equal(JSON.stringify(syncedNodePinsBody).includes("central-password"), false);
  assert.equal(JSON.stringify(syncedNodePinsBody).includes("central-token-value"), false);
  const centralPin = syncedNodePinsBody.pins.pins.find((pin: any) => pin.nodeId === "normalize_context");
  assert.equal(centralPin.input.password, "[redacted]");
  assert.equal(centralPin.output.token, "[redacted]");

  assert.equal(nodePinsCentralRequests.length, 1);
  assert.equal(nodePinsCentralRequests[0].authorization, "Bearer studio-node-pins-central-token");
  const nodePinsCentralBody = nodePinsCentralRequests[0].body;
  assert.equal(nodePinsCentralBody.format, "agent-flow-builder.studio-node-pins-central-sync-request.v1");
  assert.equal(nodePinsCentralBody.pinCount, 2);
  assert.equal(nodePinsCentralBody.pins.pinCount, 2);
  assert.equal(nodePinsCentralBody.governance.centralAuthTokenInHeaderOnly, true);
  assert.equal(nodePinsCentralBody.governance.centralAuthTokenInBody, false);
  assert.equal(nodePinsCentralBody.governance.redactsSecretLikeKeys, true);
  assert.equal(JSON.stringify(nodePinsCentralBody).includes("studio-node-pins-central-token"), false);
  assert.equal(JSON.stringify(nodePinsCentralBody).includes("secret-api-key"), false);
  assert.equal(JSON.stringify(nodePinsCentralBody).includes("secret-token"), false);
});

test("Builder API syncs experiment dashboard history with central service without raw run payloads", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const app = buildApp({ workspaceRoot });

  const dashboardPayload = {
    format: "agent-flow-builder.experiment-dashboard.v1",
    exportedAt: "2026-07-04T10:00:00.000Z",
    flow: {
      id: "reference-interview",
      name: "Reference Interview Agent",
      version: "0.1.0",
      flowHash: "flow-hash-central-a",
    },
    summary: {
      datasetCount: 1,
      datasetWithRunsCount: 1,
      scenarioCount: 2,
      runCount: 3,
      latestRunAt: "2026-07-04T09:59:00.000Z",
      averageOkRatePct: 90,
      averagePassRatePct: 80,
      regressingDatasetCount: 0,
      flowChangedRunCount: 0,
    },
    datasets: [
      {
        id: "dataset-a",
        name: "Dataset A",
        version: 1,
        scenarioCount: 2,
        runCount: 3,
        latestRunAt: "2026-07-04T09:59:00.000Z",
        latestSeverity: "pass",
        latestOkRatePct: 90,
        latestPassRatePct: 80,
        latestTrend: "stable",
        okRateDeltaPct: 0,
        flowChangedSincePrevious: false,
        bestOkRatePct: 90,
        worstOkRatePct: 90,
        issueRunCount: 0,
      },
    ],
  };

  const savedHistory = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/experiment-dashboard-history",
    headers: { "content-type": "application/json" },
    payload: dashboardPayload,
  });
  assert.equal(savedHistory.statusCode, 200);
  assert.equal(savedHistory.json().snapshotCount, 1);
  assert.equal(savedHistory.json().governance.includesRawRunEvents, false);
  assert.equal(savedHistory.json().governance.includesOnlyAggregateDashboardData, true);

  const centralServer = createServer(async (request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.headers.authorization, "Bearer central-experiment-token");
    const body = await readJsonBody(request);
    assert.equal((body as { format?: string }).format, "agent-flow-builder.experiment-dashboard-history-central-sync-request.v1");
    assert.equal(JSON.stringify(body).includes("central-experiment-token"), false);
    assert.equal(JSON.stringify(body).includes("observedOutput"), false);
    const history = (body as { history?: { snapshots?: unknown[] } }).history;
    assert.ok(history);
    const centralSnapshot = {
      id: "dashboard-central-extra",
      capturedAt: "2026-07-04T10:05:00.000Z",
      flow: {
        id: "reference-interview",
        name: "Reference Interview Agent",
        version: "0.1.0",
        flowHash: "flow-hash-central-b",
      },
      summary: {
        datasetCount: 1,
        datasetWithRunsCount: 1,
        scenarioCount: 2,
        runCount: 4,
        latestRunAt: "2026-07-04T10:04:00.000Z",
        averageOkRatePct: 95,
        averagePassRatePct: 85,
        regressingDatasetCount: 0,
        flowChangedRunCount: 1,
      },
      dashboard: {
        format: "agent-flow-builder.experiment-dashboard.v1",
        exportedAt: "2026-07-04T10:05:00.000Z",
        flow: {
          id: "reference-interview",
          name: "Reference Interview Agent",
          version: "0.1.0",
          flowHash: "flow-hash-central-b",
        },
        summary: {
          datasetCount: 1,
          datasetWithRunsCount: 1,
          scenarioCount: 2,
          runCount: 4,
          latestRunAt: "2026-07-04T10:04:00.000Z",
          averageOkRatePct: 95,
          averagePassRatePct: 85,
          regressingDatasetCount: 0,
          flowChangedRunCount: 1,
        },
        datasets: [
          {
            id: "dataset-a",
            name: "Dataset A",
            runCount: 4,
            latestOkRatePct: 95,
            latestPassRatePct: 85,
          },
        ],
      },
    };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      history: {
        ...history,
        snapshots: [centralSnapshot, ...(history.snapshots ?? [])],
      },
    }));
  });
  await new Promise<void>((resolve) => centralServer.listen(0, "127.0.0.1", resolve));
  t.after(() => centralServer.close());
  const centralAddress = centralServer.address() as AddressInfo;
  const previousUrl = process.env.AGENT_FLOW_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_URL;
  const previousToken = process.env.AGENT_FLOW_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_TOKEN;
  process.env.AGENT_FLOW_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_URL = `http://127.0.0.1:${centralAddress.port}/sync`;
  process.env.AGENT_FLOW_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_TOKEN = "central-experiment-token";
  t.after(() => {
    if (previousUrl === undefined) {
      delete process.env.AGENT_FLOW_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_URL;
    } else {
      process.env.AGENT_FLOW_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_URL = previousUrl;
    }
    if (previousToken === undefined) {
      delete process.env.AGENT_FLOW_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_TOKEN;
    } else {
      process.env.AGENT_FLOW_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_TOKEN = previousToken;
    }
  });

  const centralStatus = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/experiment-dashboard-history/central",
  });
  assert.equal(centralStatus.statusCode, 200);
  assert.equal(centralStatus.json().configured, true);
  assert.equal(centralStatus.json().tokenConfigured, true);
  assert.equal(JSON.stringify(centralStatus.json()).includes(String(centralAddress.port)), false);
  assert.equal(JSON.stringify(centralStatus.json()).includes("central-experiment-token"), false);

  const centralSync = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/experiment-dashboard-history/sync-central",
  });
  assert.equal(centralSync.statusCode, 200);
  assert.equal(centralSync.json().format, "agent-flow-builder.experiment-dashboard-history-central-sync-result.v1");
  assert.equal(centralSync.json().pushedSnapshotCount, 1);
  assert.equal(centralSync.json().pulledSnapshotCount, 2);
  assert.equal(centralSync.json().history.snapshotCount, 2);
  assert.equal(centralSync.json().history.sharedSync.action, "central_sync");
  assert.equal(JSON.stringify(centralSync.json()).includes("central-experiment-token"), false);

  const diffResponse = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/experiment-dashboard-history/diff",
    headers: { "content-type": "application/json" },
    payload: { history: savedHistory.json() },
  });
  assert.equal(diffResponse.statusCode, 200);
  assert.equal(diffResponse.json().format, "agent-flow-builder.experiment-dashboard-history-diff.v1");
  assert.equal(diffResponse.json().summary.removedCount, 1);
  assert.equal(diffResponse.json().governance.excludesRawDashboardPayload, true);
  assert.equal(JSON.stringify(diffResponse.json()).includes("\"dashboard\""), false);
  assert.equal(JSON.stringify(diffResponse.json()).includes("\"datasets\""), false);
  assert.equal(JSON.stringify(diffResponse.json()).includes("observedOutput"), false);
});

test("Builder API syncs runtime job metrics history with central service without raw job payloads", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const app = buildApp({ workspaceRoot });

  const emptyHistory = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/runtime-job-metrics-history",
  });
  assert.equal(emptyHistory.statusCode, 200);
  assert.equal(emptyHistory.json().format, "agent-flow-builder.runtime-job-metrics-history.v1");
  assert.equal(emptyHistory.json().snapshotCount, 0);
  assert.equal(emptyHistory.json().governance.includesRawJobPayloads, false);
  assert.equal(emptyHistory.json().governance.includesRawJobResults, false);

  const baseMetrics = {
    total: 1,
    by_status: { pending: 1 },
    by_kind: { post_finish_summary: 1 },
    attempts_total: 0,
    pending_due: 1,
    failed: 0,
    exhausted: 0,
    succeeded: 0,
    terminal: 0,
    success_rate: null,
    duration_ms_avg: null,
    duration_ms_min: null,
    duration_ms_max: null,
    duration_ms_p95: null,
    window_hours: 1,
    finished_in_window: 0,
    succeeded_in_window: 0,
    failed_in_window: 0,
    success_rate_in_window: null,
    window_duration_ms_avg: null,
    window_duration_ms_p95: null,
    throughput_per_hour: null,
    oldest_pending_at: null,
    next_due_at: null,
    finished_last_hour: 0,
    last_finished_at: null,
  };
  const firstSnapshot = {
    id: "runtime-job-metrics-a",
    capturedAt: "2026-07-04T10:00:00.000Z",
    flow: {
      id: "reference-interview",
      name: "Reference Interview Agent",
      version: "0.1.0",
      flowHash: "old-flow-hash",
    },
    windowHours: 1,
    summary: {
      total: 1,
      pendingDue: 1,
      failed: 0,
      exhausted: 0,
      successRate: null,
      successRateInWindow: null,
      durationMsAvg: null,
      durationMsP95: null,
      throughputPerHour: null,
      finishedInWindow: 0,
      finishedLastHour: 0,
      lastFinishedAt: null,
      nextDueAt: null,
    },
    metrics: baseMetrics,
    payload: { secret: "SHOULD_NOT_PERSIST" },
    result: { token: "SHOULD_NOT_PERSIST" },
    last_error: { message: "SHOULD_NOT_PERSIST" },
  };

  const savedHistory = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/runtime-job-metrics-history",
    headers: { "content-type": "application/json" },
    payload: firstSnapshot,
  });
  assert.equal(savedHistory.statusCode, 200);
  assert.equal(savedHistory.json().snapshotCount, 1);
  assert.equal(savedHistory.json().snapshots[0].summary.pendingDue, 1);
  assert.equal(savedHistory.json().governance.includesOnlyAggregateJobMetrics, true);
  assert.equal(JSON.stringify(savedHistory.json()).includes("SHOULD_NOT_PERSIST"), false);
  assert.equal(JSON.stringify(savedHistory.json()).includes("\"payload\""), false);
  assert.equal(JSON.stringify(savedHistory.json()).includes("\"last_error\""), false);
  await access(path.join(
    workspaceRoot,
    "flows",
    "reference-interview",
    ".agent-flow",
    "runtime-job-metrics-history",
    "history.json",
  ));

  const secondSnapshot = {
    ...firstSnapshot,
    id: "runtime-job-metrics-b",
    capturedAt: "2026-07-04T10:05:00.000Z",
    summary: {
      ...firstSnapshot.summary,
      pendingDue: 0,
      failed: 1,
      exhausted: 0,
      successRate: 0,
      successRateInWindow: 0,
      durationMsP95: 250,
      finishedInWindow: 1,
      finishedLastHour: 1,
      lastFinishedAt: "2026-07-04T10:04:00.000Z",
    },
    metrics: {
      ...baseMetrics,
      by_status: { failed: 1 },
      pending_due: 0,
      failed: 1,
      terminal: 1,
      success_rate: 0,
      duration_ms_p95: 250,
      window_duration_ms_p95: 250,
      finished_in_window: 1,
      failed_in_window: 1,
      success_rate_in_window: 0,
      finished_last_hour: 1,
      last_finished_at: "2026-07-04T10:04:00.000Z",
    },
  };
  const increasedHistory = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/runtime-job-metrics-history",
    headers: { "content-type": "application/json" },
    payload: secondSnapshot,
  });
  assert.equal(increasedHistory.statusCode, 200);
  assert.equal(increasedHistory.json().snapshotCount, 2);
  assert.equal(increasedHistory.json().analysis.latestTrend, "regressed");

  const centralServer = createServer(async (request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.headers.authorization, "Bearer runtime-job-token");
    const body = await readJsonBody(request);
    assert.equal((body as { format?: string }).format, "agent-flow-builder.runtime-job-metrics-history-central-sync-request.v1");
    assert.equal(JSON.stringify(body).includes("runtime-job-token"), false);
    assert.equal(JSON.stringify(body).includes("SHOULD_NOT_PERSIST"), false);
    assert.equal(JSON.stringify(body).includes("\"payload\""), false);
    assert.equal(JSON.stringify(body).includes("\"result\""), false);
    assert.equal(JSON.stringify(body).includes("\"last_error\""), false);
    const history = (body as { history?: { snapshots?: unknown[] } }).history;
    assert.ok(history);
    const centralSnapshot = {
      ...(increasedHistory.json().snapshots[0] as Record<string, unknown>),
      id: "runtime-job-metrics-central-extra",
      capturedAt: "2026-07-04T10:10:00.000Z",
      summary: {
        ...(increasedHistory.json().snapshots[0].summary as Record<string, unknown>),
        pendingDue: 0,
        failed: 0,
        exhausted: 0,
        successRate: 1,
        successRateInWindow: 1,
        throughputPerHour: 2,
      },
      metrics: {
        ...(increasedHistory.json().snapshots[0].metrics as Record<string, unknown>),
        by_status: { succeeded: 1 },
        failed: 0,
        succeeded: 1,
        success_rate: 1,
        success_rate_in_window: 1,
        throughput_per_hour: 2,
      },
    };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      history: {
        ...history,
        snapshots: [centralSnapshot, ...(history.snapshots ?? [])],
      },
    }));
  });
  await new Promise<void>((resolve) => centralServer.listen(0, "127.0.0.1", resolve));
  t.after(() => centralServer.close());
  const centralAddress = centralServer.address() as AddressInfo;
  const previousUrl = process.env.AGENT_FLOW_RUNTIME_JOB_METRICS_HISTORY_CENTRAL_URL;
  const previousToken = process.env.AGENT_FLOW_RUNTIME_JOB_METRICS_HISTORY_CENTRAL_TOKEN;
  process.env.AGENT_FLOW_RUNTIME_JOB_METRICS_HISTORY_CENTRAL_URL = `http://127.0.0.1:${centralAddress.port}/sync`;
  process.env.AGENT_FLOW_RUNTIME_JOB_METRICS_HISTORY_CENTRAL_TOKEN = "runtime-job-token";
  t.after(() => {
    if (previousUrl === undefined) {
      delete process.env.AGENT_FLOW_RUNTIME_JOB_METRICS_HISTORY_CENTRAL_URL;
    } else {
      process.env.AGENT_FLOW_RUNTIME_JOB_METRICS_HISTORY_CENTRAL_URL = previousUrl;
    }
    if (previousToken === undefined) {
      delete process.env.AGENT_FLOW_RUNTIME_JOB_METRICS_HISTORY_CENTRAL_TOKEN;
    } else {
      process.env.AGENT_FLOW_RUNTIME_JOB_METRICS_HISTORY_CENTRAL_TOKEN = previousToken;
    }
  });

  const centralStatus = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/runtime-job-metrics-history/central",
  });
  assert.equal(centralStatus.statusCode, 200);
  assert.equal(centralStatus.json().configured, true);
  assert.equal(centralStatus.json().tokenConfigured, true);
  assert.equal(JSON.stringify(centralStatus.json()).includes(String(centralAddress.port)), false);
  assert.equal(JSON.stringify(centralStatus.json()).includes("runtime-job-token"), false);

  const centralSync = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/runtime-job-metrics-history/sync-central",
  });
  assert.equal(centralSync.statusCode, 200);
  assert.equal(centralSync.json().format, "agent-flow-builder.runtime-job-metrics-history-central-sync-result.v1");
  assert.equal(centralSync.json().pushedSnapshotCount, 2);
  assert.equal(centralSync.json().pulledSnapshotCount, 3);
  assert.equal(centralSync.json().history.snapshotCount, 3);
  assert.equal(centralSync.json().history.sharedSync.action, "central_sync");
  assert.equal(JSON.stringify(centralSync.json()).includes("runtime-job-token"), false);

  const diffResponse = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/runtime-job-metrics-history/diff",
    headers: { "content-type": "application/json" },
    payload: { history: savedHistory.json() },
  });
  assert.equal(diffResponse.statusCode, 200);
  assert.equal(diffResponse.json().format, "agent-flow-builder.runtime-job-metrics-history-diff.v1");
  assert.equal(diffResponse.json().summary.removedCount, 2);
  assert.equal(diffResponse.json().governance.excludesRawJobPayloads, true);
  assert.equal(diffResponse.json().governance.excludesRawJobResults, true);
  assert.equal(JSON.stringify(diffResponse.json()).includes("\"payload\""), false);
  assert.equal(JSON.stringify(diffResponse.json()).includes("\"result\""), false);
  assert.equal(JSON.stringify(diffResponse.json()).includes("\"last_error\""), false);
});

test("Builder API shares Studio scenarios with central sync and redaction", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const app = buildApp({ workspaceRoot });

  const emptyScenarios = await app.inject({ method: "GET", url: "/flows/reference-interview/studio-scenarios" });
  assert.equal(emptyScenarios.statusCode, 200);
  assert.equal(emptyScenarios.json().format, "agent-flow-builder.studio-scenarios.v1");
  assert.equal(emptyScenarios.json().scenarioCount, 0);
  assert.equal(emptyScenarios.json().datasetCount, 0);
  assert.equal(emptyScenarios.json().sharedSync.action, "empty");

  const sharedPayload = {
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
        createdAt: "2026-07-03T15:00:00.000Z",
        updatedAt: "2026-07-03T15:00:00.000Z",
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
        createdAt: "2026-07-03T15:00:00.000Z",
        updatedAt: "2026-07-03T15:00:00.000Z",
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
        createdAt: "2026-07-03T15:00:00.000Z",
        updatedAt: "2026-07-03T15:00:00.000Z",
      },
    ],
  };

  const savedScenarios = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/studio-scenarios",
    headers: { "content-type": "application/json" },
    payload: sharedPayload,
  });
  assert.equal(savedScenarios.statusCode, 200);
  assert.equal(savedScenarios.json().scenarioCount, 1);
  assert.equal(savedScenarios.json().datasetCount, 1);
  assert.equal(savedScenarios.json().evaluatorCount, 1);
  assert.equal(savedScenarios.json().sharedSync.action, "save");
  assert.equal(savedScenarios.json().multiAgent.agentIds[0], "reference-interview");
  assert.equal(savedScenarios.json().multiAgent.datasetScenarioCoverage, 100);
  assert.equal(savedScenarios.json().scenarios[0].payload.api_key, "[redacted]");
  assert.equal(savedScenarios.json().scenarios[0].payload.nested.authorization, "[redacted]");
  assert.equal(savedScenarios.json().evaluators[0].external.token, "[redacted]");
  assert.equal(savedScenarios.json().evaluators[0].external.headers, "[redacted]");
  assert.equal(JSON.stringify(savedScenarios.json()).includes("scenario-api-key"), false);
  assert.equal(JSON.stringify(savedScenarios.json()).includes("scenario-token"), false);
  assert.equal(JSON.stringify(savedScenarios.json()).includes("evaluator-token"), false);

  await access(path.join(workspaceRoot, "flows", "reference-interview", ".agent-flow", "studio-scenarios", "scenarios.afscenarios.json"));

  const mergedScenarios = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/studio-scenarios/merge",
    headers: { "content-type": "application/json" },
    payload: {
      ...sharedPayload,
      scenarios: [
        {
          ...sharedPayload.scenarios[0],
          label: "Fluxo multiagente principal atualizado",
          updatedAt: "2026-07-03T15:05:00.000Z",
        },
        {
          id: "scenario-support",
          label: "Handoff suporte",
          input: "Encaminhar para suporte.",
          payload: { user_message: "Encaminhar para suporte.", token: "support-token" },
          tags: ["multiagent", "support"],
          createdAt: "2026-07-03T15:06:00.000Z",
          updatedAt: "2026-07-03T15:06:00.000Z",
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
          ...sharedPayload.datasets[0],
          scenarioIds: ["scenario-main", "scenario-support"],
          updatedAt: "2026-07-03T15:06:00.000Z",
        },
      ],
      evaluators: [
        {
          ...sharedPayload.evaluators[0],
          name: "Evaluator multiagente atualizado",
          updatedAt: "2026-07-03T15:07:00.000Z",
        },
      ],
    },
  });
  assert.equal(mergedScenarios.statusCode, 200);
  assert.equal(mergedScenarios.json().scenarioCount, 2);
  assert.equal(mergedScenarios.json().datasetCount, 1);
  assert.equal(mergedScenarios.json().evaluatorCount, 1);
  assert.equal(mergedScenarios.json().sharedSync.addedScenarioCount, 1);
  assert.equal(mergedScenarios.json().sharedSync.updatedScenarioCount, 1);
  assert.equal(mergedScenarios.json().sharedSync.updatedEvaluatorCount, 1);
  assert.equal(mergedScenarios.json().multiAgent.agentIds.includes("support-agent"), true);
  assert.equal(JSON.stringify(mergedScenarios.json()).includes("support-token"), false);
  assert.equal(mergedScenarios.json().conflictCount, 3);
  assert.equal(mergedScenarios.json().openConflictCount, 3);
  assert.equal(mergedScenarios.json().conflicts.some((conflict: any) => conflict.kind === "dataset"), true);
  assert.equal(mergedScenarios.json().conflicts.some((conflict: any) => conflict.kind === "evaluator"), true);
  const scenarioConflict = mergedScenarios.json().conflicts.find((conflict: any) => conflict.kind === "scenario");
  assert.equal(scenarioConflict.itemId, "scenario-main");
  assert.equal(scenarioConflict.candidateCount, 2);
  assert.ok(scenarioConflict.diff.changedFieldCount >= 1);
  assert.equal(scenarioConflict.diff.governance.excludesRawScenarioPayloads, true);
  assert.equal(scenarioConflict.diff.fields.some((field: any) => field.field === "label"), true);
  assert.equal(JSON.stringify(scenarioConflict).includes("scenario-api-key"), false);
  const evaluatorConflict = mergedScenarios.json().conflicts.find((conflict: any) => conflict.kind === "evaluator");
  assert.ok(evaluatorConflict.diff.changedFieldCount >= 1);
  assert.equal(evaluatorConflict.diff.fields.some((field: any) => field.field === "name"), true);
  assert.equal(JSON.stringify(evaluatorConflict.diff).includes("evaluator-token"), false);

  const scenarioConflictId = scenarioConflict.conflictId;
  const viewerCuratedScenarioConflict = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/studio-scenarios/conflicts/${scenarioConflictId}/curation`,
    headers: { "content-type": "application/json" },
    payload: { action: "assign", actor: "qa-viewer", role: "viewer", note: "Inspeção sem mutação." },
  });
  assert.equal(viewerCuratedScenarioConflict.statusCode, 403);

  const curatedScenarioConflict = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/studio-scenarios/conflicts/${scenarioConflictId}/curation`,
    headers: { "content-type": "application/json" },
    payload: { action: "assign", actor: "qa-curator", role: "reviewer", note: "Revisar divergência de cenário." },
  });
  assert.equal(curatedScenarioConflict.statusCode, 200);
  const assignedScenarioConflict = curatedScenarioConflict.json().conflicts.find((conflict: any) => conflict.conflictId === scenarioConflictId);
  assert.equal(assignedScenarioConflict.curationThread.status, "assigned");
  assert.equal(assignedScenarioConflict.curationThread.assignee, "qa-curator");
  assert.ok(assignedScenarioConflict.curationThread.leaseExpiresAt);
  assert.equal(assignedScenarioConflict.curationThread.leaseDurationHours, 24);
  assert.equal(assignedScenarioConflict.curationThread.leaseExpired, false);
  assert.equal(assignedScenarioConflict.curationThread.governance.autoReleasesExpiredAssignments, true);
  assert.equal(assignedScenarioConflict.curationThread.events[0].role, "reviewer");

  const expiredScenarioPackage = {
    ...curatedScenarioConflict.json(),
    conflicts: curatedScenarioConflict.json().conflicts.map((conflict: any) =>
      conflict.conflictId === scenarioConflictId
        ? {
            ...conflict,
            curationThread: {
              ...conflict.curationThread,
              status: "assigned",
              assignee: "stale-curator",
              updatedAt: "2020-01-01T00:00:00.000Z",
              leaseExpiresAt: "2020-01-01T01:00:00.000Z",
              leaseDurationHours: 1,
              leaseExpired: false,
              lastActor: "stale-curator",
              lastAction: "assign",
            },
          }
        : conflict,
    ),
  };
  await writeFile(
    path.join(workspaceRoot, "flows", "reference-interview", ".agent-flow", "studio-scenarios", "scenarios.afscenarios.json"),
    `${JSON.stringify(expiredScenarioPackage, null, 2)}\n`,
    "utf-8",
  );
  const expiredLeaseScenarios = await app.inject({ method: "GET", url: "/flows/reference-interview/studio-scenarios" });
  assert.equal(expiredLeaseScenarios.statusCode, 200);
  const expiredScenarioConflict = expiredLeaseScenarios.json().conflicts.find((conflict: any) => conflict.conflictId === scenarioConflictId);
  assert.equal(expiredScenarioConflict.curationThread.status, "unassigned");
  assert.equal(expiredScenarioConflict.curationThread.assignee, "");
  assert.equal(expiredScenarioConflict.curationThread.leaseExpired, true);
  assert.equal(expiredScenarioConflict.curationThread.leaseExpiresAt, null);
  assert.equal(expiredScenarioConflict.curationThread.lastAction, "lease_expired");
  assert.equal(expiredScenarioConflict.curationThread.events.some((event: any) => event.action === "lease_expired"), true);

  const viewerResolvedScenarioConflict = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/studio-scenarios/conflicts/${scenarioConflictId}/resolve`,
    headers: { "content-type": "application/json" },
    payload: {
      keepContentHash: assignedScenarioConflict.latestContentHash,
      resolvedBy: "qa-viewer",
      role: "viewer",
      resolutionNote: "Inspeção sem resolução.",
    },
  });
  assert.equal(viewerResolvedScenarioConflict.statusCode, 403);

  const resolvedScenarioConflict = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/studio-scenarios/conflicts/${scenarioConflictId}/resolve`,
    headers: { "content-type": "application/json" },
    payload: {
      keepContentHash: assignedScenarioConflict.latestContentHash,
      resolvedBy: "qa-curator",
      role: "reviewer",
      resolutionNote: "Manter revisão mais recente.",
    },
  });
  assert.equal(resolvedScenarioConflict.statusCode, 200);
  assert.equal(resolvedScenarioConflict.json().conflictCount, 2);
  assert.equal(resolvedScenarioConflict.json().openConflictCount, 2);
  assert.equal(resolvedScenarioConflict.json().conflicts.some((conflict: any) => conflict.kind === "dataset"), true);
  assert.equal(resolvedScenarioConflict.json().conflicts.some((conflict: any) => conflict.kind === "evaluator"), true);
  assert.equal(resolvedScenarioConflict.json().resolutionHistoryCount, 1);
  assert.equal(resolvedScenarioConflict.json().resolutionHistory[0].resolvedRole, "reviewer");
  assert.equal(resolvedScenarioConflict.json().resolutionHistory[0].discardedRefs.length, 1);
  assert.equal(resolvedScenarioConflict.json().sharedSync.action, "resolve_conflict");

  const centralRequests: Array<{ authorization: string | undefined; body: any }> = [];
  const centralServer = createServer(async (request, response) => {
    centralRequests.push({
      authorization: request.headers.authorization,
      body: await readJsonBody(request),
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        scenarios: {
          ...sharedPayload,
          scenarios: [
            {
              id: "scenario-central",
              label: "Cenário central",
              input: "Validar cenário recebido da central.",
              payload: { user_message: "Validar cenário recebido da central.", secret: "central-secret" },
              tags: ["central"],
              createdAt: "2026-07-03T15:10:00.000Z",
              updatedAt: "2026-07-03T15:10:00.000Z",
              sourceContext: {
                kind: "dataset_import",
                agentId: "reference-interview",
                primaryRunId: "run-central",
                sessionId: "session-central",
                nodeId: "llm_step",
                eventSeq: 6,
                label: "Central",
              },
            },
          ],
          datasets: [],
        },
      }),
    );
  });
  await new Promise<void>((resolve) => centralServer.listen(0, "127.0.0.1", resolve));
  t.after(() => centralServer.close());
  const centralAddress = centralServer.address() as AddressInfo;
  process.env.AGENT_FLOW_STUDIO_SCENARIOS_CENTRAL_URL = `http://127.0.0.1:${centralAddress.port}/sync`;
  process.env.AGENT_FLOW_STUDIO_SCENARIOS_CENTRAL_TOKEN = "studio-scenarios-central-token";
  t.after(() => {
    delete process.env.AGENT_FLOW_STUDIO_SCENARIOS_CENTRAL_URL;
    delete process.env.AGENT_FLOW_STUDIO_SCENARIOS_CENTRAL_TOKEN;
  });

  const centralStatus = await app.inject({ method: "GET", url: "/flows/reference-interview/studio-scenarios/central" });
  assert.equal(centralStatus.statusCode, 200);
  assert.equal(centralStatus.json().format, "agent-flow-builder.studio-scenarios-central-sync-status.v1");
  assert.equal(centralStatus.json().configured, true);
  assert.equal(centralStatus.json().tokenConfigured, true);
  assert.equal(JSON.stringify(centralStatus.json()).includes("studio-scenarios-central-token"), false);

  const centralSync = await app.inject({ method: "POST", url: "/flows/reference-interview/studio-scenarios/sync-central" });
  assert.equal(centralSync.statusCode, 200);
  assert.equal(centralSync.json().format, "agent-flow-builder.studio-scenarios-central-sync-result.v1");
  assert.equal(centralSync.json().scenarios.scenarioCount, 3);
  assert.equal(centralSync.json().scenarios.datasetCount, 1);
  assert.equal(centralSync.json().scenarios.evaluatorCount, 1);
  assert.equal(centralSync.json().central.pushedScenarioCount, 2);
  assert.equal(centralSync.json().central.pushedDatasetCount, 1);
  assert.equal(centralSync.json().central.pushedEvaluatorCount, 1);
  assert.equal(centralSync.json().central.pulledScenarioCount, 1);
  assert.equal(centralSync.json().central.pulledDatasetCount, 0);
  assert.equal(centralSync.json().central.pulledEvaluatorCount, 1);
  assert.equal(centralSync.json().pushedEvaluatorCount, 1);
  assert.equal(centralSync.json().pulledEvaluatorCount, 1);
  assert.equal(JSON.stringify(centralSync.json()).includes("central-secret"), false);
  assert.equal(JSON.stringify(centralSync.json()).includes("studio-scenarios-central-token"), false);
  assert.equal(centralRequests.length, 1);
  assert.equal(centralRequests[0].authorization, "Bearer studio-scenarios-central-token");
  assert.equal(centralRequests[0].body.format, "agent-flow-builder.studio-scenarios-central-sync-request.v1");
  assert.equal(centralRequests[0].body.scenarioCount, 2);
  assert.equal(centralRequests[0].body.datasetCount, 1);
  assert.equal(centralRequests[0].body.evaluatorCount, 1);
  assert.equal(JSON.stringify(centralRequests[0].body).includes("studio-scenarios-central-token"), false);
  assert.equal(JSON.stringify(centralRequests[0].body).includes("scenario-api-key"), false);
});

test("Builder API shares debug layer snapshots with central sync and sanitized evidence", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const app = buildApp({ workspaceRoot });
  t.after(() => app.close());

  const debugLayerSnapshot = (packageHash: string, exportedAt: string, evidence: Record<string, unknown>) => ({
    format: "agent-flow-builder.debug-layer-summary.v1",
    exportedAt,
    packageHash,
    scope: "run_comparison",
    flow: {
      id: "reference-interview",
      name: "Reference Interview Agent",
      version: "0.1.0",
      nodeCount: 4,
      edgeCount: 3,
    },
    summary: {
      status: "warning",
      statusLabel: "atenção",
      headline: "1 nó alterado, 2 diffs, 1 pin ativo",
      items: [
        {
          id: "state-output",
          title: "Estado/output",
          status: "changed",
          statusLabel: "com diff",
          summary: "state 1 · output 1",
          detail: "1 nó com state alterado",
          action: "Selecione o nó alterado para revisar.",
        },
      ],
    },
    evidence,
    governance: {
      excludesRawNodePayloads: true,
      excludesSecretValues: true,
      source: "studio-run-comparison",
    },
  });

  const emptySnapshots = await app.inject({ method: "GET", url: "/flows/reference-interview/debug-layer-snapshots" });
  assert.equal(emptySnapshots.statusCode, 200);
  assert.equal(emptySnapshots.json().format, "agent-flow-builder.debug-layer-snapshots.v1");
  assert.equal(emptySnapshots.json().snapshotCount, 0);

  const savedSnapshots = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/debug-layer-snapshots",
    headers: { "content-type": "application/json" },
    payload: debugLayerSnapshot("debug-layer-local", "2026-07-03T13:00:00.000Z", {
      runComparison: { leftRunId: "run-a", rightRunId: "run-b" },
      selectedNode: { nodeId: "llm_step", api_key: "debug-layer-api-key" },
      rawNodePayload: { password: "debug-layer-password" },
    }),
  });
  assert.equal(savedSnapshots.statusCode, 200);
  assert.equal(savedSnapshots.json().snapshotCount, 1);
  assert.equal(savedSnapshots.json().snapshots[0].evidence.selectedNode.api_key, "[redacted]");
  assert.equal(savedSnapshots.json().snapshots[0].evidence.rawNodePayload, "[redacted]");
  assert.equal(JSON.stringify(savedSnapshots.json()).includes("debug-layer-api-key"), false);
  assert.equal(JSON.stringify(savedSnapshots.json()).includes("debug-layer-password"), false);
  const debugLayerSnapshotsFilePath = path.join(
    workspaceRoot,
    "flows",
    "reference-interview",
    ".agent-flow",
    "debug-layers",
    "snapshots.afdebuglayers.json",
  );
  await access(debugLayerSnapshotsFilePath);

  const mergedSnapshots = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/debug-layer-snapshots/merge",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.debug-layer-snapshots.v1",
      flowId: "reference-interview",
      snapshots: [
        debugLayerSnapshot("debug-layer-local", "2026-07-03T13:00:00.000Z", {
          runComparison: { leftRunId: "run-a", rightRunId: "run-b" },
        }),
        debugLayerSnapshot("debug-layer-merge", "2026-07-03T13:05:00.000Z", {
          batch: { reportHash: "batch-a" },
        }),
      ],
    },
  });
  assert.equal(mergedSnapshots.statusCode, 200);
  assert.equal(mergedSnapshots.json().snapshotCount, 2);
  assert.equal(mergedSnapshots.json().sharedSync.addedCount, 1);
  assert.equal(mergedSnapshots.json().sharedSync.unchangedCount, 1);
  assert.equal(mergedSnapshots.json().conflictCount, 0);

  const conflictedSnapshots = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/debug-layer-snapshots/merge",
    headers: { "content-type": "application/json" },
    payload: debugLayerSnapshot("debug-layer-conflict", "2026-07-03T13:06:00.000Z", {
      runComparison: { leftRunId: "run-a", rightRunId: "run-b" },
      rawNodePayload: { token: "debug-layer-conflict-token" },
    }),
  });
  const conflictedSnapshotsBody: any = conflictedSnapshots.json();
  assert.equal(conflictedSnapshots.statusCode, 200);
  assert.equal(conflictedSnapshotsBody.snapshotCount, 3);
  assert.equal(conflictedSnapshotsBody.conflictCount, 1);
  assert.equal(conflictedSnapshotsBody.openConflictCount, 1);
  assert.equal(conflictedSnapshotsBody.sharedSync.conflictCount, 1);
  assert.equal(conflictedSnapshotsBody.conflicts[0].status, "open");
  assert.equal(conflictedSnapshotsBody.conflicts[0].packageHashes.includes("debug-layer-local"), true);
  assert.equal(conflictedSnapshotsBody.conflicts[0].packageHashes.includes("debug-layer-conflict"), true);
  assert.equal(JSON.stringify(conflictedSnapshotsBody.conflicts).includes("debug-layer-conflict-token"), false);
  assert.equal(conflictedSnapshotsBody.conflicts[0].curationThread.status, "unassigned");
  assert.equal(conflictedSnapshotsBody.conflicts[0].curationThread.events.length, 0);

  const viewerAssignedDebugLayerConflict = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/debug-layer-snapshots/conflicts/${conflictedSnapshotsBody.conflicts[0].conflictId}/curation`,
    headers: { "content-type": "application/json" },
    payload: {
      action: "assign",
      actor: "debug-viewer",
      role: "viewer",
      note: "Tentativa somente leitura.",
    },
  });
  assert.equal(viewerAssignedDebugLayerConflict.statusCode, 403);
  assert.equal(viewerAssignedDebugLayerConflict.json().details.code, "debug_layer_snapshot_conflict_viewer_forbidden");

  const assignedDebugLayerConflict = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/debug-layer-snapshots/conflicts/${conflictedSnapshotsBody.conflicts[0].conflictId}/curation`,
    headers: { "content-type": "application/json" },
    payload: {
      action: "assign",
      actor: "debug-curator",
      role: "reviewer",
      note: "Assumir conflito de camada para revisão.",
    },
  });
  const assignedDebugLayerConflictBody: any = assignedDebugLayerConflict.json();
  assert.equal(assignedDebugLayerConflict.statusCode, 200);
  assert.equal(assignedDebugLayerConflictBody.sharedSync.action, "curate_conflict");
  assert.equal(assignedDebugLayerConflictBody.openConflictCount, 1);
  assert.equal(assignedDebugLayerConflictBody.conflicts[0].curationThread.status, "assigned");
  assert.equal(assignedDebugLayerConflictBody.conflicts[0].curationThread.assignee, "debug-curator");
  assert.match(assignedDebugLayerConflictBody.conflicts[0].curationThread.leaseExpiresAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(assignedDebugLayerConflictBody.conflicts[0].curationThread.leaseDurationHours, 24);
  assert.equal(assignedDebugLayerConflictBody.conflicts[0].curationThread.leaseExpired, false);
  assert.equal(assignedDebugLayerConflictBody.conflicts[0].curationThread.events.length, 1);
  assert.equal(assignedDebugLayerConflictBody.conflicts[0].curationThread.events[0].action, "assign");
  assert.equal(assignedDebugLayerConflictBody.conflicts[0].curationThread.events[0].actor, "debug-curator");
  assert.equal(assignedDebugLayerConflictBody.conflicts[0].curationThread.events[0].role, "reviewer");
  assert.equal(
    assignedDebugLayerConflictBody.conflicts[0].curationThread.governance.autoReleasesExpiredAssignments,
    true,
  );
  assert.equal(
    assignedDebugLayerConflictBody.conflicts[0].curationThread.governance.configuredLeaseHoursEnv,
    "AGENT_FLOW_DEBUG_LAYER_SNAPSHOT_CONFLICT_CURATION_LEASE_HOURS",
  );

  const releasedDebugLayerConflict = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/debug-layer-snapshots/conflicts/${conflictedSnapshotsBody.conflicts[0].conflictId}/curation`,
    headers: { "content-type": "application/json" },
    payload: {
      action: "release",
      actor: "debug-curator",
      role: "reviewer",
      note: "Liberar para outro revisor.",
    },
  });
  const releasedDebugLayerConflictBody: any = releasedDebugLayerConflict.json();
  assert.equal(releasedDebugLayerConflict.statusCode, 200);
  assert.equal(releasedDebugLayerConflictBody.conflicts[0].curationThread.status, "unassigned");
  assert.equal(releasedDebugLayerConflictBody.conflicts[0].curationThread.assignee, "");
  assert.equal(releasedDebugLayerConflictBody.conflicts[0].curationThread.leaseExpiresAt, null);
  assert.equal(releasedDebugLayerConflictBody.conflicts[0].curationThread.leaseDurationHours, null);
  assert.equal(releasedDebugLayerConflictBody.conflicts[0].curationThread.leaseExpired, false);
  assert.equal(releasedDebugLayerConflictBody.conflicts[0].curationThread.events.length, 2);
  assert.equal(releasedDebugLayerConflictBody.conflicts[0].curationThread.events[0].action, "release");

  const reloadedDebugLayerConflicts = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/debug-layer-snapshots",
  });
  const reloadedDebugLayerConflictsBody: any = reloadedDebugLayerConflicts.json();
  assert.equal(reloadedDebugLayerConflicts.statusCode, 200);
  assert.equal(reloadedDebugLayerConflictsBody.conflicts[0].curationThread.events.length, 2);

  const reassignedDebugLayerConflict = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/debug-layer-snapshots/conflicts/${conflictedSnapshotsBody.conflicts[0].conflictId}/curation`,
    headers: { "content-type": "application/json" },
    payload: {
      action: "assign",
      actor: "stale-debug-curator",
      role: "reviewer",
      note: "Simula curadoria de camada abandonada.",
    },
  });
  const reassignedDebugLayerConflictBody: any = reassignedDebugLayerConflict.json();
  assert.equal(reassignedDebugLayerConflict.statusCode, 200);
  assert.equal(reassignedDebugLayerConflictBody.conflicts[0].curationThread.status, "assigned");
  assert.equal(reassignedDebugLayerConflictBody.conflicts[0].curationThread.assignee, "stale-debug-curator");
  assert.match(reassignedDebugLayerConflictBody.conflicts[0].curationThread.leaseExpiresAt, /^\d{4}-\d{2}-\d{2}T/);

  await writeFile(
    debugLayerSnapshotsFilePath,
    `${JSON.stringify(
      {
        ...reassignedDebugLayerConflictBody,
        conflicts: reassignedDebugLayerConflictBody.conflicts.map((conflict: Record<string, unknown>, index: number) =>
          index === 0
            ? {
                ...conflict,
                curationThread: {
                  ...(conflict.curationThread as Record<string, unknown>),
                  status: "assigned",
                  assignee: "stale-debug-curator",
                  openedAt: "2020-01-01T00:00:00.000Z",
                  updatedAt: "2020-01-01T00:00:00.000Z",
                  lastActor: "stale-debug-curator",
                  lastAction: "assign",
                  leaseExpiresAt: "2020-01-01T01:00:00.000Z",
                  leaseDurationHours: 1,
                  leaseExpired: false,
                },
              }
            : conflict,
        ),
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );

  const expiredDebugLayerConflicts = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/debug-layer-snapshots",
  });
  const expiredDebugLayerConflictsBody: any = expiredDebugLayerConflicts.json();
  assert.equal(expiredDebugLayerConflicts.statusCode, 200);
  assert.equal(expiredDebugLayerConflictsBody.conflicts[0].curationThread.status, "unassigned");
  assert.equal(expiredDebugLayerConflictsBody.conflicts[0].curationThread.assignee, "");
  assert.equal(expiredDebugLayerConflictsBody.conflicts[0].curationThread.lastAction, "lease_expired");
  assert.equal(expiredDebugLayerConflictsBody.conflicts[0].curationThread.leaseExpiresAt, null);
  assert.equal(expiredDebugLayerConflictsBody.conflicts[0].curationThread.leaseDurationHours, null);
  assert.equal(expiredDebugLayerConflictsBody.conflicts[0].curationThread.leaseExpired, true);
  assert.equal(
    expiredDebugLayerConflictsBody.conflicts[0].curationThread.events.some(
      (event: { action: string }) => event.action === "lease_expired",
    ),
    true,
  );

  await writeFile(debugLayerSnapshotsFilePath, `${JSON.stringify(reloadedDebugLayerConflictsBody, null, 2)}\n`, "utf-8");

  const debugLayerConflictReview = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/debug-layer-snapshots/conflicts-review",
  });
  const debugLayerConflictReviewBody: any = debugLayerConflictReview.json();
  assert.equal(debugLayerConflictReview.statusCode, 200);
  assert.equal(debugLayerConflictReviewBody.format, "agent-flow-builder.debug-layer-snapshots-conflict-review.v1");
  assert.equal(debugLayerConflictReviewBody.conflictCount, 1);
  assert.equal(debugLayerConflictReviewBody.openConflictCount, 1);
  assert.equal(debugLayerConflictReviewBody.summary.runComparisonConflictCount, 1);
  assert.equal(debugLayerConflictReviewBody.summary.unassignedConflictCount, 1);
  assert.equal(debugLayerConflictReviewBody.governance.excludesSnapshots, true);
  assert.equal(debugLayerConflictReviewBody.governance.excludesEvidence, true);
  assert.equal(debugLayerConflictReviewBody.governance.excludesRawNodePayloads, true);
  assert.equal(debugLayerConflictReviewBody.conflicts[0].snapshotContentHashes.includes("debug-layer-conflict"), true);
  const debugLayerConflictReviewText = JSON.stringify(debugLayerConflictReviewBody);
  assert.equal(debugLayerConflictReviewText.includes('"snapshots"'), false);
  assert.equal(debugLayerConflictReviewText.includes('"evidence"'), false);
  assert.equal(debugLayerConflictReviewText.includes("debug-layer-conflict-token"), false);
  assert.equal(debugLayerConflictReviewText.includes("debug-layer-password"), false);

  const importedDebugLayerConflictReview = JSON.parse(JSON.stringify(debugLayerConflictReviewBody));
  importedDebugLayerConflictReview.conflicts = [];
  importedDebugLayerConflictReview.conflictCount = 0;
  importedDebugLayerConflictReview.openConflictCount = 0;
  const debugLayerConflictReviewDiff = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/debug-layer-snapshots/conflicts-review/diff",
    headers: { "content-type": "application/json" },
    payload: { review: importedDebugLayerConflictReview },
  });
  const debugLayerConflictReviewDiffBody: any = debugLayerConflictReviewDiff.json();
  assert.equal(debugLayerConflictReviewDiff.statusCode, 200);
  assert.equal(debugLayerConflictReviewDiffBody.format, "agent-flow-builder.debug-layer-snapshots-conflict-review-diff.v1");
  assert.equal(debugLayerConflictReviewDiffBody.current.conflictCount, 1);
  assert.equal(debugLayerConflictReviewDiffBody.incoming.conflictCount, 0);
  assert.equal(debugLayerConflictReviewDiffBody.summary.status, "changed");
  assert.equal(debugLayerConflictReviewDiffBody.summary.onlyCurrentConflictCount, 1);
  assert.equal(debugLayerConflictReviewDiffBody.governance.excludesSnapshots, true);
  assert.equal(debugLayerConflictReviewDiffBody.governance.excludesEvidence, true);
  assert.equal(JSON.stringify(debugLayerConflictReviewDiffBody).includes('"snapshots"'), false);
  assert.equal(JSON.stringify(debugLayerConflictReviewDiffBody).includes('"evidence"'), false);

  const invalidDebugLayerConflictReviewDiff = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/debug-layer-snapshots/conflicts-review/diff",
    headers: { "content-type": "application/json" },
    payload: {
      review: {
        ...debugLayerConflictReviewBody,
        conflicts: [
          {
            ...debugLayerConflictReviewBody.conflicts[0],
            evidence: { rawNodePayload: { token: "debug-layer-raw-token" } },
          },
        ],
      },
    },
  });
  assert.equal(invalidDebugLayerConflictReviewDiff.statusCode, 400);

  const viewerResolvedDebugLayerConflict = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/debug-layer-snapshots/conflicts/${conflictedSnapshotsBody.conflicts[0].conflictId}/resolve`,
    headers: { "content-type": "application/json" },
    payload: {
      keepPackageHash: "debug-layer-local",
      resolvedBy: "debug-viewer",
      resolvedRole: "viewer",
      note: "Tentativa somente leitura.",
    },
  });
  assert.equal(viewerResolvedDebugLayerConflict.statusCode, 403);
  assert.equal(viewerResolvedDebugLayerConflict.json().details.code, "debug_layer_snapshot_conflict_viewer_forbidden");

  const resolvedSnapshots = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/debug-layer-snapshots/conflicts/${conflictedSnapshotsBody.conflicts[0].conflictId}/resolve`,
    headers: { "content-type": "application/json" },
    payload: {
      keepPackageHash: "debug-layer-local",
      resolvedBy: "ui-audit",
      resolvedRole: "reviewer",
      note: "manter snapshot escolhido",
    },
  });
  const resolvedSnapshotsBody: any = resolvedSnapshots.json();
  assert.equal(resolvedSnapshots.statusCode, 200);
  assert.equal(resolvedSnapshotsBody.snapshotCount, 2);
  assert.equal(resolvedSnapshotsBody.conflictCount, 0);
  assert.equal(resolvedSnapshotsBody.openConflictCount, 0);
  assert.equal(resolvedSnapshotsBody.sharedSync.action, "resolve_conflict");
  assert.equal(resolvedSnapshotsBody.resolutionHistoryCount, 1);
  assert.equal(resolvedSnapshotsBody.resolutionHistory[0].conflictId, conflictedSnapshotsBody.conflicts[0].conflictId);
  assert.equal(resolvedSnapshotsBody.resolutionHistory[0].resolvedBy, "ui-audit");
  assert.equal(resolvedSnapshotsBody.resolutionHistory[0].resolvedRole, "reviewer");
  assert.equal(resolvedSnapshotsBody.resolutionHistory[0].resolutionNote, "manter snapshot escolhido");
  assert.equal(resolvedSnapshotsBody.resolutionHistory[0].keptPackageHash, "debug-layer-local");
  assert.equal(resolvedSnapshotsBody.resolutionHistory[0].discardedRefs.length, 1);
  assert.equal(resolvedSnapshotsBody.resolutionHistory[0].discardedRefs[0].packageHash, "debug-layer-conflict");
  assert.equal(resolvedSnapshotsBody.resolutionHistory[0].governance.excludesRawNodePayloads, true);
  assert.equal(
    resolvedSnapshotsBody.snapshots.some((snapshot: any) => snapshot.packageHash === "debug-layer-local"),
    true,
  );
  assert.equal(
    resolvedSnapshotsBody.snapshots.some((snapshot: any) => snapshot.packageHash === "debug-layer-conflict"),
    false,
  );

  const reopenedDebugLayerConflict = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/debug-layer-snapshots/merge",
    headers: { "content-type": "application/json" },
    payload: debugLayerSnapshot("debug-layer-conflict", "2026-07-03T13:06:00.000Z", {
      runComparison: { leftRunId: "run-a", rightRunId: "run-b" },
      rawNodePayload: { token: "debug-layer-conflict-token" },
    }),
  });
  const reopenedDebugLayerBody: any = reopenedDebugLayerConflict.json();
  assert.equal(reopenedDebugLayerConflict.statusCode, 200);
  assert.equal(reopenedDebugLayerBody.snapshotCount, 2);
  assert.equal(reopenedDebugLayerBody.conflictCount, 0);
  assert.equal(reopenedDebugLayerBody.openConflictCount, 0);
  assert.equal(reopenedDebugLayerBody.resolutionHistoryCount, 1);
  assert.equal(
    reopenedDebugLayerBody.snapshots.some((snapshot: any) => snapshot.packageHash === "debug-layer-conflict"),
    false,
  );
  assert.equal(JSON.stringify(reopenedDebugLayerBody).includes("debug-layer-conflict-token"), false);

  const previousDebugLayerCentralUrl = process.env.AGENT_FLOW_DEBUG_LAYER_SNAPSHOTS_CENTRAL_URL;
  const previousDebugLayerCentralToken = process.env.AGENT_FLOW_DEBUG_LAYER_SNAPSHOTS_CENTRAL_TOKEN;
  const previousDebugLayerCentralTimeout = process.env.AGENT_FLOW_DEBUG_LAYER_SNAPSHOTS_CENTRAL_TIMEOUT_MS;
  t.after(() => {
    if (previousDebugLayerCentralUrl === undefined) {
      delete process.env.AGENT_FLOW_DEBUG_LAYER_SNAPSHOTS_CENTRAL_URL;
    } else {
      process.env.AGENT_FLOW_DEBUG_LAYER_SNAPSHOTS_CENTRAL_URL = previousDebugLayerCentralUrl;
    }
    if (previousDebugLayerCentralToken === undefined) {
      delete process.env.AGENT_FLOW_DEBUG_LAYER_SNAPSHOTS_CENTRAL_TOKEN;
    } else {
      process.env.AGENT_FLOW_DEBUG_LAYER_SNAPSHOTS_CENTRAL_TOKEN = previousDebugLayerCentralToken;
    }
    if (previousDebugLayerCentralTimeout === undefined) {
      delete process.env.AGENT_FLOW_DEBUG_LAYER_SNAPSHOTS_CENTRAL_TIMEOUT_MS;
    } else {
      process.env.AGENT_FLOW_DEBUG_LAYER_SNAPSHOTS_CENTRAL_TIMEOUT_MS = previousDebugLayerCentralTimeout;
    }
  });

  const centralDebugLayerPayload = debugLayerSnapshot("debug-layer-central", "2026-07-03T13:10:00.000Z", {
    runComparison: { leftRunId: "run-c", rightRunId: "run-d" },
    authorization: "Bearer debug-layer-central-secret",
  });
  const debugLayerCentralRequests: Array<{ authorization: string | undefined; body: any }> = [];
  const debugLayerCentralServer = createServer(async (request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/sync");
    debugLayerCentralRequests.push({
      authorization: request.headers.authorization,
      body: await readJsonBody(request),
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ snapshots: centralDebugLayerPayload }));
  });
  await new Promise<void>((resolve) => debugLayerCentralServer.listen(0, "127.0.0.1", resolve));
  t.after(() => debugLayerCentralServer.close());
  const debugLayerCentralAddress = debugLayerCentralServer.address() as AddressInfo;
  process.env.AGENT_FLOW_DEBUG_LAYER_SNAPSHOTS_CENTRAL_URL = `http://127.0.0.1:${debugLayerCentralAddress.port}/sync`;
  process.env.AGENT_FLOW_DEBUG_LAYER_SNAPSHOTS_CENTRAL_TOKEN = "debug-layer-central-token";
  process.env.AGENT_FLOW_DEBUG_LAYER_SNAPSHOTS_CENTRAL_TIMEOUT_MS = "1500";

  const centralStatus = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/debug-layer-snapshots/central",
  });
  const centralStatusBody: any = centralStatus.json();
  assert.equal(centralStatus.statusCode, 200);
  assert.equal(centralStatusBody.format, "agent-flow-builder.debug-layer-snapshots-central-sync-status.v1");
  assert.equal(centralStatusBody.configured, true);
  assert.equal(centralStatusBody.tokenConfigured, true);
  assert.equal(centralStatusBody.timeoutMs, 1500);
  assert.equal(centralStatusBody.governance.centralAuthTokenInHeaderOnly, true);
  assert.equal(centralStatusBody.governance.centralAuthTokenInBody, false);
  assert.equal(centralStatusBody.governance.storesCentralToken, false);
  assert.equal(JSON.stringify(centralStatusBody).includes("debug-layer-central-token"), false);
  assert.equal(JSON.stringify(centralStatusBody).includes(String(debugLayerCentralAddress.port)), false);

  const centralSync = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/debug-layer-snapshots/sync-central",
  });
  const centralSyncBody: any = centralSync.json();
  assert.equal(centralSync.statusCode, 200);
  assert.equal(centralSyncBody.format, "agent-flow-builder.debug-layer-snapshots-central-sync-result.v1");
  assert.equal(centralSyncBody.pushedSnapshotCount, 2);
  assert.equal(centralSyncBody.pulledSnapshotCount, 1);
  assert.equal(centralSyncBody.snapshots.snapshotCount, 3);
  assert.equal(centralSyncBody.governance.centralAuthTokenInHeaderOnly, true);
  assert.equal(centralSyncBody.governance.centralAuthTokenInBody, false);
  assert.equal(JSON.stringify(centralSyncBody).includes("debug-layer-central-token"), false);
  assert.equal(JSON.stringify(centralSyncBody).includes(String(debugLayerCentralAddress.port)), false);
  assert.equal(JSON.stringify(centralSyncBody).includes("debug-layer-central-secret"), false);

  assert.equal(debugLayerCentralRequests.length, 1);
  assert.equal(debugLayerCentralRequests[0].authorization, "Bearer debug-layer-central-token");
  const debugLayerCentralBody = debugLayerCentralRequests[0].body;
  assert.equal(debugLayerCentralBody.format, "agent-flow-builder.debug-layer-snapshots-central-sync-request.v1");
  assert.equal(debugLayerCentralBody.snapshotCount, 2);
  assert.equal(debugLayerCentralBody.snapshots.snapshotCount, 2);
  assert.equal(debugLayerCentralBody.governance.centralAuthTokenInHeaderOnly, true);
  assert.equal(debugLayerCentralBody.governance.centralAuthTokenInBody, false);
  assert.equal(JSON.stringify(debugLayerCentralBody).includes("debug-layer-central-token"), false);
  assert.equal(JSON.stringify(debugLayerCentralBody).includes("debug-layer-api-key"), false);
  assert.equal(JSON.stringify(debugLayerCentralBody).includes("debug-layer-password"), false);
  assert.equal(JSON.stringify(debugLayerCentralBody).includes("debug-layer-conflict-token"), false);
});

test("Builder API shares orchestration debug history with central sync and redaction", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const app = buildApp({ workspaceRoot });

  const orchestrationRun = (runId: string, createdAt: string, status = "completed") => ({
    format: "agent-flow-builder.runtime-orchestration-run.v1",
    manifest_id: "reference-runtime-bundle",
    manifest_version: "0.1.0",
    mode: "sequential_handoff",
    entry_agent_id: "reference-interview",
    status,
    steps: [
      {
        agent_id: "reference-interview",
        route_prefix: "/reference-interview",
        resource_name: "sessions",
        session_id: `session-${runId}`,
        turn: {
          assistant_message: {
            code: "ECHO",
            text: `Resposta ${runId}`,
          },
        },
      },
    ],
    shared_memory: {
      run_id: runId,
      authorization: "Bearer orchestration-shared-memory-token",
      outputs: [{ agent_id: "reference-interview", output_preview: `Resposta ${runId}` }],
    },
    debug_trace: {
      format: "agent-flow-builder.runtime-orchestration-debug-trace.v1",
      run_id: runId,
      manifest_id: "reference-runtime-bundle",
      manifest_version: "0.1.0",
      mode: "sequential_handoff",
      entry_agent_id: "reference-interview",
      started_at: createdAt,
      finished_at: createdAt,
      input: {
        user_message: `Mensagem ${runId}`,
        api_key: "orchestration-input-api-key",
      },
      summary: {
        status,
        step_count: 1,
        timeline_events: 2,
        matched_handoffs: 0,
        handoff_decisions: 0,
      },
      timeline: [
        {
          seq: 1,
          at: createdAt,
          type: "plan_created",
          status: "planned",
          entry_agent_id: "reference-interview",
          planned_step_count: 1,
        },
        {
          seq: 2,
          at: createdAt,
          type: "step_completed",
          status,
          agent_id: "reference-interview",
          session_id: `session-${runId}`,
          output_preview: `Resposta ${runId}`,
          token: "orchestration-event-token",
        },
      ],
      governance: {
        excludesSecretValues: true,
      },
    },
    governance: {
      excludesSecretValues: true,
    },
  });

  const emptyHistory = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/orchestration-debug-history",
  });
  assert.equal(emptyHistory.statusCode, 200);
  assert.equal(emptyHistory.json().format, "agent-flow-builder.orchestration-debug-history.v1");
  assert.equal(emptyHistory.json().entryCount, 0);
  assert.equal(emptyHistory.json().sharedSync.action, "empty");

  const savedHistory = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/orchestration-debug-history",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.orchestration-debug-history.v1",
      flowId: "reference-interview",
      entries: [
        {
          id: "entry-orch-1",
          createdAt: "2026-07-03T14:00:00.000Z",
          outDir: "generated/reference-runtime-bundle",
          runtimeUrl: "http://user:pass@127.0.0.1:8080?api_key=runtime-secret",
          message: "Mensagem run-orch-1",
          result: orchestrationRun("run-orch-1", "2026-07-03T14:00:00.000Z"),
        },
      ],
    },
  });
  assert.equal(savedHistory.statusCode, 200);
  assert.equal(savedHistory.json().entryCount, 1);
  assert.equal(savedHistory.json().sharedSync.action, "save");
  assert.equal(savedHistory.json().entries[0].runtimeUrl, "http://127.0.0.1:8080");
  assert.equal(savedHistory.json().entries[0].result.debug_trace.input.api_key, "[redacted]");
  assert.equal(savedHistory.json().entries[0].result.debug_trace.timeline[1].token, "[redacted]");
  assert.equal(savedHistory.json().entries[0].result.shared_memory.authorization, "[redacted]");
  assert.equal(JSON.stringify(savedHistory.json()).includes("orchestration-input-api-key"), false);
  assert.equal(JSON.stringify(savedHistory.json()).includes("orchestration-event-token"), false);
  assert.equal(JSON.stringify(savedHistory.json()).includes("runtime-secret"), false);
  await access(
    path.join(
      workspaceRoot,
      "flows",
      "reference-interview",
      ".agent-flow",
      "orchestration-debug",
      "history.aforchdebug.json",
    ),
  );

  const mergedHistory = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/orchestration-debug-history/merge",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.orchestration-debug-history.v1",
      flowId: "reference-interview",
      entries: [
        {
          id: "entry-orch-1-updated",
          createdAt: "2026-07-03T14:05:00.000Z",
          outDir: "generated/reference-runtime-bundle",
          runtimeUrl: "http://127.0.0.1:8080",
          message: "Mensagem atualizada",
          result: orchestrationRun("run-orch-1", "2026-07-03T14:05:00.000Z", "failed"),
        },
        {
          id: "entry-orch-2",
          createdAt: "2026-07-03T14:10:00.000Z",
          outDir: "generated/reference-runtime-bundle",
          runtimeUrl: "http://127.0.0.1:8080",
          message: "Mensagem run-orch-2",
          result: orchestrationRun("run-orch-2", "2026-07-03T14:10:00.000Z"),
        },
      ],
    },
  });
  const mergedHistoryBody: any = mergedHistory.json();
  assert.equal(mergedHistory.statusCode, 200);
  assert.equal(mergedHistoryBody.entryCount, 2);
  assert.equal(mergedHistoryBody.sharedSync.addedCount, 1);
  assert.equal(mergedHistoryBody.sharedSync.updatedCount, 1);
  assert.equal(mergedHistoryBody.entries[1].result.status, "failed");

  const governedDiff = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/orchestration-debug-history/diff",
    headers: { "content-type": "application/json" },
    payload: {
      leftRunId: "run-orch-1",
      rightRunId: "run-orch-2",
    },
  });
  const governedDiffBody: any = governedDiff.json();
  assert.equal(governedDiff.statusCode, 200);
  assert.equal(governedDiffBody.format, "agent-flow-builder.orchestration-debug-history-diff.v1");
  assert.equal(governedDiffBody.left.runId, "run-orch-1");
  assert.equal(governedDiffBody.right.runId, "run-orch-2");
  assert.equal(governedDiffBody.summary.status, "changed");
  assert.equal(governedDiffBody.summary.statusChanged, true);
  assert.equal(governedDiffBody.summary.stepDelta, 0);
  assert.equal(governedDiffBody.sections.some((section: any) => section.id === "summary"), true);
  assert.equal(governedDiffBody.sections.some((section: any) => section.id === "event-types"), true);
  assert.equal(governedDiffBody.governance.excludesRawRuntimePayloads, true);
  assert.equal(governedDiffBody.governance.redactsSecretLikeKeys, true);
  assert.equal(JSON.stringify(governedDiffBody).includes("orchestration-input-api-key"), false);
  assert.equal(JSON.stringify(governedDiffBody).includes("orchestration-event-token"), false);
  assert.equal(JSON.stringify(governedDiffBody).includes("orchestration-shared-memory-token"), false);

  const previousOrchestrationCentralUrl = process.env.AGENT_FLOW_ORCHESTRATION_DEBUG_HISTORY_CENTRAL_URL;
  const previousOrchestrationCentralToken = process.env.AGENT_FLOW_ORCHESTRATION_DEBUG_HISTORY_CENTRAL_TOKEN;
  const previousOrchestrationCentralTimeout = process.env.AGENT_FLOW_ORCHESTRATION_DEBUG_HISTORY_CENTRAL_TIMEOUT_MS;
  t.after(() => {
    if (previousOrchestrationCentralUrl === undefined) {
      delete process.env.AGENT_FLOW_ORCHESTRATION_DEBUG_HISTORY_CENTRAL_URL;
    } else {
      process.env.AGENT_FLOW_ORCHESTRATION_DEBUG_HISTORY_CENTRAL_URL = previousOrchestrationCentralUrl;
    }
    if (previousOrchestrationCentralToken === undefined) {
      delete process.env.AGENT_FLOW_ORCHESTRATION_DEBUG_HISTORY_CENTRAL_TOKEN;
    } else {
      process.env.AGENT_FLOW_ORCHESTRATION_DEBUG_HISTORY_CENTRAL_TOKEN = previousOrchestrationCentralToken;
    }
    if (previousOrchestrationCentralTimeout === undefined) {
      delete process.env.AGENT_FLOW_ORCHESTRATION_DEBUG_HISTORY_CENTRAL_TIMEOUT_MS;
    } else {
      process.env.AGENT_FLOW_ORCHESTRATION_DEBUG_HISTORY_CENTRAL_TIMEOUT_MS = previousOrchestrationCentralTimeout;
    }
  });

  const orchestrationCentralRequests: Array<{ authorization: string | undefined; body: any }> = [];
  const orchestrationCentralServer = createServer(async (request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/sync");
    orchestrationCentralRequests.push({
      authorization: request.headers.authorization,
      body: await readJsonBody(request),
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        history: {
          format: "agent-flow-builder.orchestration-debug-history.v1",
          flowId: "reference-interview",
          entries: [
            {
              id: "entry-orch-central",
              createdAt: "2026-07-03T14:20:00.000Z",
              outDir: "generated/reference-runtime-bundle",
              runtimeUrl: "http://127.0.0.1:8080",
              message: "Mensagem central",
              result: orchestrationRun("run-orch-central", "2026-07-03T14:20:00.000Z"),
            },
          ],
        },
      }),
    );
  });
  await new Promise<void>((resolve) => orchestrationCentralServer.listen(0, "127.0.0.1", resolve));
  t.after(() => orchestrationCentralServer.close());
  const orchestrationCentralAddress = orchestrationCentralServer.address() as AddressInfo;
  process.env.AGENT_FLOW_ORCHESTRATION_DEBUG_HISTORY_CENTRAL_URL =
    `http://127.0.0.1:${orchestrationCentralAddress.port}/sync`;
  process.env.AGENT_FLOW_ORCHESTRATION_DEBUG_HISTORY_CENTRAL_TOKEN = "orchestration-central-token";
  process.env.AGENT_FLOW_ORCHESTRATION_DEBUG_HISTORY_CENTRAL_TIMEOUT_MS = "1600";

  const centralStatus = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/orchestration-debug-history/central",
  });
  assert.equal(centralStatus.statusCode, 200);
  assert.equal(centralStatus.json().format, "agent-flow-builder.orchestration-debug-history-central-sync-status.v1");
  assert.equal(centralStatus.json().configured, true);
  assert.equal(centralStatus.json().tokenConfigured, true);
  assert.equal(centralStatus.json().timeoutMs, 1600);
  assert.equal(JSON.stringify(centralStatus.json()).includes("orchestration-central-token"), false);
  assert.equal(JSON.stringify(centralStatus.json()).includes(String(orchestrationCentralAddress.port)), false);

  const centralSync = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/orchestration-debug-history/sync-central",
  });
  const centralSyncBody: any = centralSync.json();
  assert.equal(centralSync.statusCode, 200);
  assert.equal(centralSyncBody.format, "agent-flow-builder.orchestration-debug-history-central-sync-result.v1");
  assert.equal(centralSyncBody.pushedEntryCount, 2);
  assert.equal(centralSyncBody.pulledEntryCount, 1);
  assert.equal(centralSyncBody.history.entryCount, 3);
  assert.equal(JSON.stringify(centralSyncBody).includes("orchestration-central-token"), false);
  assert.equal(JSON.stringify(centralSyncBody).includes(String(orchestrationCentralAddress.port)), false);
  assert.equal(JSON.stringify(centralSyncBody).includes("orchestration-input-api-key"), false);
  assert.equal(JSON.stringify(centralSyncBody).includes("orchestration-event-token"), false);

  assert.equal(orchestrationCentralRequests.length, 1);
  assert.equal(orchestrationCentralRequests[0].authorization, "Bearer orchestration-central-token");
  assert.equal(orchestrationCentralRequests[0].body.format, "agent-flow-builder.orchestration-debug-history-central-sync-request.v1");
  assert.equal(orchestrationCentralRequests[0].body.entryCount, 2);
  assert.equal(orchestrationCentralRequests[0].body.history.entryCount, 2);
  assert.equal(JSON.stringify(orchestrationCentralRequests[0].body).includes("orchestration-central-token"), false);
  assert.equal(JSON.stringify(orchestrationCentralRequests[0].body).includes("orchestration-input-api-key"), false);
  assert.equal(JSON.stringify(orchestrationCentralRequests[0].body).includes("orchestration-event-token"), false);
});

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
            {
              Name: "reference-worker-1",
              Service: "worker",
              State: "running",
              Status: "Up 10 seconds",
              Publishers: [],
            },
          ]),
          stderr: "",
        };
      }
      if (invocation.args.join(" ") === "compose logs --tail 120 --no-color") {
        return {
          exitCode: 0,
          stdout: "api-1  | Application startup complete.\nworker-1  | Jobs processados: {'processed': 0}",
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
  const ollamaAdapter = adapters.json().adapters.find((adapter: { id: string }) => adapter.id === "ollama");
  assert.ok(ollamaAdapter.localModelPresets.some((preset: { id: string; model: string }) => preset.id === "ollama-balanced-local" && preset.model === "qwen3:8b"));

  const evaluatorServer = createServer(async (request, response) => {
    assert.equal(request.method, "POST");
    const body = await readJsonBody(request);
    assert.equal((body as { observedOutput?: string }).observedOutput, "Pergunta gerada");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ pass: true, score: 0.92, reason: "Resposta atende à rubrica.", verdict: "judge-pass" }));
  });
  await new Promise<void>((resolve) => evaluatorServer.listen(0, "127.0.0.1", resolve));
  t.after(() => evaluatorServer.close());
  const evaluatorAddress = evaluatorServer.address() as AddressInfo;
  const externalEvaluator = await app.inject({
    method: "POST",
    url: "/evaluators/external",
    headers: { "content-type": "application/json" },
    payload: {
      endpointUrl: `http://127.0.0.1:${evaluatorAddress.port}/judge`,
      passPath: "pass",
      scorePath: "score",
      reasonPath: "reason",
      verdictPath: "verdict",
      minScore: 0.7,
      payload: {
        scenario: { id: "scenario-judge", label: "Judge externo" },
        observedOutput: "Pergunta gerada",
      },
    },
  });
  assert.equal(externalEvaluator.statusCode, 200);
  assert.equal(externalEvaluator.json().format, "agent-flow-builder.external-evaluator-result.v1");
  assert.equal(externalEvaluator.json().pass, true);
  assert.equal(externalEvaluator.json().score, 0.92);
  assert.equal(externalEvaluator.json().verdict, "judge-pass");

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

  const emptyAnnotationQueue = await app.inject({ method: "GET", url: "/flows/reference-interview/annotation-queue" });
  assert.equal(emptyAnnotationQueue.statusCode, 200);
  assert.equal(emptyAnnotationQueue.json().format, "agent-flow-builder.annotation-queue.v1");
  assert.equal(emptyAnnotationQueue.json().itemCount, 0);
  assert.equal(emptyAnnotationQueue.json().conflictCount, 0);
  assert.equal(emptyAnnotationQueue.json().openConflictCount, 0);
  assert.equal(emptyAnnotationQueue.json().auditCount, 0);
  assert.equal(emptyAnnotationQueue.json().permissionPolicy.mode, "open");

  const annotationQueue = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/annotation-queue",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.annotation-queue.v1",
      exportedAt: "2026-07-02T00:00:00.000Z",
      flow: { id: "reference-interview", name: "Reference Interview Agent", version: "0.1.0" },
      permissionPolicy: {
        mode: "assignee_only",
        reviewers: [{ name: "QA", role: "owner", updatedAt: "2026-07-02T00:00:00.000Z" }],
        updatedAt: "2026-07-02T00:00:00.000Z",
        updatedBy: "QA",
      },
      items: [
        {
          id: "annotation-shared-ui",
          scenarioId: "scenario-a",
          scenarioLabel: "Cenario A",
          sessionId: "session-a",
          runId: "run-a",
          resultStatus: "ok",
          comparisonSeverity: "warn",
          verdict: "Revisar resposta",
          reasons: ["baseline mudou"],
          observedOutput: "saida observada",
          batchHash: "batch-a",
          source: "batch-result",
          status: "pending",
          assignee: "QA",
          reviewedBy: "",
          reviewedAt: null,
          note: "",
          createdAt: "2026-07-02T00:00:00.000Z",
          updatedAt: "2026-07-02T00:00:00.000Z",
        },
      ],
    },
  });
  assert.equal(annotationQueue.statusCode, 200);
  assert.equal(annotationQueue.json().flow.id, "reference-interview");
  assert.equal(annotationQueue.json().itemCount, 1);
  assert.equal(annotationQueue.json().pendingCount, 1);
  assert.equal(annotationQueue.json().assigneeCounts.QA, 1);
  assert.equal(annotationQueue.json().conflictCount, 0);
  assert.equal(annotationQueue.json().auditCount, 0);
  assert.equal(annotationQueue.json().permissionPolicy.mode, "assignee_only");
  assert.equal(annotationQueue.json().permissionPolicy.updatedBy, "QA");
  assert.equal(annotationQueue.json().permissionPolicy.reviewers[0].name, "QA");
  assert.equal(annotationQueue.json().permissionPolicy.reviewers[0].role, "owner");

  const mergedAnnotationQueue = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/annotation-queue/merge",
    headers: { "content-type": "application/json" },
    payload: {
      permissionPolicy: {
        mode: "open",
        reviewers: [{ name: "local-user", role: "reviewer", updatedAt: "2026-07-02T00:04:00.000Z" }],
        updatedAt: "2026-07-02T00:04:00.000Z",
        updatedBy: "local-user",
      },
      items: [
        {
          ...annotationQueue.json().items[0],
          status: "accepted",
          reviewedBy: "local-user",
          reviewedAt: "2026-07-02T00:05:00.000Z",
          updatedAt: "2026-07-02T00:05:00.000Z",
        },
      ],
    },
  });
  assert.equal(mergedAnnotationQueue.statusCode, 200);
  assert.equal(mergedAnnotationQueue.json().itemCount, 1);
  assert.equal(mergedAnnotationQueue.json().pendingCount, 0);
  assert.equal(mergedAnnotationQueue.json().acceptedCount, 1);
  assert.equal(mergedAnnotationQueue.json().reviewedCount, 1);
  assert.equal(mergedAnnotationQueue.json().items[0].status, "accepted");
  assert.equal(mergedAnnotationQueue.json().permissionPolicy.mode, "open");
  assert.equal(mergedAnnotationQueue.json().permissionPolicy.updatedBy, "local-user");
  assert.equal(mergedAnnotationQueue.json().permissionPolicy.reviewers[0].name, "local-user");
  assert.equal(mergedAnnotationQueue.json().permissionPolicy.reviewers[0].role, "reviewer");

  const conflictingAnnotationQueue = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/annotation-queue/merge",
    headers: { "content-type": "application/json" },
    payload: {
      items: [
        {
          ...mergedAnnotationQueue.json().items[0],
          status: "rejected",
          reviewedBy: "remote-reviewer",
          reviewedAt: "2026-07-02T00:06:00.000Z",
          verdict: "Rejeitar resposta",
          observedOutput: "saida remota divergente",
          note: "revisao remota diverge",
          updatedAt: "2026-07-02T00:06:00.000Z",
        },
      ],
    },
  });
  assert.equal(conflictingAnnotationQueue.statusCode, 200);
  assert.equal(conflictingAnnotationQueue.json().itemCount, 1);
  assert.equal(conflictingAnnotationQueue.json().acceptedCount, 0);
  assert.equal(conflictingAnnotationQueue.json().rejectedCount, 1);
  assert.equal(conflictingAnnotationQueue.json().items[0].status, "rejected");
  assert.equal(conflictingAnnotationQueue.json().conflictCount, 1);
  assert.equal(conflictingAnnotationQueue.json().openConflictCount, 1);
  assert.equal(conflictingAnnotationQueue.json().conflicts[0].itemId, "annotation-shared-ui");
  assert.equal(conflictingAnnotationQueue.json().conflicts[0].existingReviewer, "local-user");
  assert.equal(conflictingAnnotationQueue.json().conflicts[0].incomingReviewer, "remote-reviewer");
  assert.equal(conflictingAnnotationQueue.json().conflicts[0].existingStatus, "accepted");
  assert.equal(conflictingAnnotationQueue.json().conflicts[0].incomingStatus, "rejected");
  assert.equal(conflictingAnnotationQueue.json().conflicts[0].existingSnapshot.status, "accepted");
  assert.equal(conflictingAnnotationQueue.json().conflicts[0].existingSnapshot.observedOutput, "saida observada");
  assert.equal(conflictingAnnotationQueue.json().conflicts[0].incomingSnapshot.status, "rejected");
  assert.equal(conflictingAnnotationQueue.json().conflicts[0].incomingSnapshot.observedOutput, "saida remota divergente");
  assert.equal(conflictingAnnotationQueue.json().conflicts[0].incomingSnapshot.verdict, "Rejeitar resposta");
  assert.equal(conflictingAnnotationQueue.json().auditCount, 1);
  assert.equal(conflictingAnnotationQueue.json().auditEntries[0].action, "conflict_detected");
  assert.equal(conflictingAnnotationQueue.json().auditEntries[0].actor, "remote-reviewer");

  const assignedAnnotationConflict = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/annotation-queue/conflicts/${encodeURIComponent(conflictingAnnotationQueue.json().conflicts[0].id)}/curation`,
    headers: { "content-type": "application/json" },
    payload: { action: "assign", actor: "annotation-curator", note: "Vou revisar a divergência." },
  });
  assert.equal(assignedAnnotationConflict.statusCode, 200);
  assert.equal(assignedAnnotationConflict.json().conflicts[0].curationThread.status, "assigned");
  assert.equal(assignedAnnotationConflict.json().conflicts[0].curationThread.assignee, "annotation-curator");
  assert.equal(assignedAnnotationConflict.json().conflicts[0].curationThread.lastAction, "assign");
  assert.equal(assignedAnnotationConflict.json().conflicts[0].curationThread.events.length, 1);
  assert.equal(assignedAnnotationConflict.json().conflicts[0].curationThread.events[0].action, "assign");
  assert.equal(assignedAnnotationConflict.json().conflicts[0].curationThread.events[0].actor, "annotation-curator");
  assert.equal(assignedAnnotationConflict.json().conflicts[0].curationThread.governance.excludesRawRunEvents, true);
  assert.equal(assignedAnnotationConflict.json().conflicts[0].curationThread.governance.excludesObservedOutputs, true);
  assert.ok(assignedAnnotationConflict.json().conflicts[0].curationThread.leaseExpiresAt);
  assert.equal(assignedAnnotationConflict.json().conflicts[0].curationThread.leaseDurationHours, 24);
  assert.equal(assignedAnnotationConflict.json().conflicts[0].curationThread.leaseExpired, false);
  assert.equal(assignedAnnotationConflict.json().conflicts[0].curationThread.governance.autoReleasesExpiredAssignments, true);
  assert.equal(assignedAnnotationConflict.json().auditEntries[0].action, "conflict_curated");

  const releasedAnnotationConflict = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/annotation-queue/conflicts/${encodeURIComponent(conflictingAnnotationQueue.json().conflicts[0].id)}/curation`,
    headers: { "content-type": "application/json" },
    payload: { action: "release", actor: "annotation-curator" },
  });
  assert.equal(releasedAnnotationConflict.statusCode, 200);
  assert.equal(releasedAnnotationConflict.json().conflicts[0].curationThread.status, "unassigned");
  assert.equal(releasedAnnotationConflict.json().conflicts[0].curationThread.assignee, "");
  assert.equal(releasedAnnotationConflict.json().conflicts[0].curationThread.lastAction, "release");
  assert.equal(releasedAnnotationConflict.json().conflicts[0].curationThread.events.length, 2);
  assert.equal(releasedAnnotationConflict.json().conflicts[0].curationThread.events[0].action, "release");

  const reassignedAnnotationConflict = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/annotation-queue/conflicts/${encodeURIComponent(conflictingAnnotationQueue.json().conflicts[0].id)}/curation`,
    headers: { "content-type": "application/json" },
    payload: { action: "assign", actor: "annotation-curator" },
  });
  assert.equal(reassignedAnnotationConflict.statusCode, 200);
  assert.equal(reassignedAnnotationConflict.json().conflicts[0].curationThread.status, "assigned");
  assert.equal(reassignedAnnotationConflict.json().conflicts[0].curationThread.events.length, 3);
  assert.equal(reassignedAnnotationConflict.json().conflicts[0].curationThread.events[0].action, "assign");
  assert.ok(reassignedAnnotationConflict.json().conflicts[0].curationThread.leaseExpiresAt);
  assert.equal(reassignedAnnotationConflict.json().conflicts[0].curationThread.leaseDurationHours, 24);

  const persistedAnnotationQueue = await app.inject({ method: "GET", url: "/flows/reference-interview/annotation-queue" });
  assert.equal(persistedAnnotationQueue.statusCode, 200);
  assert.equal(persistedAnnotationQueue.json().items[0].status, "rejected");
  assert.equal(persistedAnnotationQueue.json().openConflictCount, 1);
  assert.equal(persistedAnnotationQueue.json().conflicts[0].curationThread.assignee, "annotation-curator");
  const persistedAnnotationQueueBody = persistedAnnotationQueue.json();
  const annotationQueuePath = path.join(
    workspaceRoot,
    "flows",
    "reference-interview",
    ".agent-flow",
    "annotation-queue",
    "queue.afannotations.json",
  );
  const expiredAnnotationQueuePayload = JSON.parse(JSON.stringify(persistedAnnotationQueueBody));
  expiredAnnotationQueuePayload.conflicts[0].curationThread = {
    ...expiredAnnotationQueuePayload.conflicts[0].curationThread,
    status: "assigned",
    assignee: "stale-annotation-curator",
    openedAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    lastActor: "stale-annotation-curator",
    lastAction: "assign",
    leaseExpiresAt: "2020-01-01T01:00:00.000Z",
    leaseDurationHours: 1,
    leaseExpired: false,
  };
  await mkdir(path.dirname(annotationQueuePath), { recursive: true });
  await writeFile(annotationQueuePath, JSON.stringify(expiredAnnotationQueuePayload, null, 2));
  const expiredAnnotationQueue = await app.inject({ method: "GET", url: "/flows/reference-interview/annotation-queue" });
  assert.equal(expiredAnnotationQueue.statusCode, 200);
  assert.equal(expiredAnnotationQueue.json().conflicts[0].curationThread.status, "unassigned");
  assert.equal(expiredAnnotationQueue.json().conflicts[0].curationThread.assignee, "");
  assert.equal(expiredAnnotationQueue.json().conflicts[0].curationThread.leaseExpired, true);
  assert.equal(expiredAnnotationQueue.json().conflicts[0].curationThread.leaseExpiresAt, null);
  assert.equal(expiredAnnotationQueue.json().conflicts[0].curationThread.lastAction, "lease_expired");
  assert.equal(
    expiredAnnotationQueue.json().conflicts[0].curationThread.events.some((event: any) => event.action === "lease_expired"),
    true,
  );
  await writeFile(annotationQueuePath, JSON.stringify(persistedAnnotationQueueBody, null, 2));

  const resolvedAnnotationPayload = persistedAnnotationQueueBody;
  resolvedAnnotationPayload.conflicts[0] = {
    ...resolvedAnnotationPayload.conflicts[0],
    status: "resolved",
    resolution: "manual",
    resolvedAt: "2026-07-02T00:07:00.000Z",
    resolvedBy: "local-user",
  };
  const resolvedAnnotationQueue = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/annotation-queue",
    headers: { "content-type": "application/json" },
    payload: resolvedAnnotationPayload,
  });
  assert.equal(resolvedAnnotationQueue.statusCode, 200);
  assert.equal(resolvedAnnotationQueue.json().conflictCount, 1);
  assert.equal(resolvedAnnotationQueue.json().openConflictCount, 0);
  assert.equal(resolvedAnnotationQueue.json().conflicts[0].status, "resolved");
  assert.equal(resolvedAnnotationQueue.json().conflicts[0].resolvedBy, "local-user");
  assert.equal(resolvedAnnotationQueue.json().conflicts[0].curationThread.status, "resolved");
  assert.equal(resolvedAnnotationQueue.json().conflicts[0].curationThread.assignee, "annotation-curator");
  assert.equal(resolvedAnnotationQueue.json().conflicts[0].curationThread.lastAction, "resolve");
  assert.equal(resolvedAnnotationQueue.json().conflicts[0].curationThread.events.length, 4);
  assert.equal(
    resolvedAnnotationQueue.json().conflicts[0].curationThread.events.some((event: any) => event.action === "resolve"),
    true,
  );
  assert.equal(resolvedAnnotationQueue.json().resolutionHistoryCount, 1);
  assert.equal(resolvedAnnotationQueue.json().resolutionHistory[0].conflictId, conflictingAnnotationQueue.json().conflicts[0].id);
  assert.equal(resolvedAnnotationQueue.json().resolutionHistory[0].itemId, "annotation-shared-ui");
  assert.equal(resolvedAnnotationQueue.json().resolutionHistory[0].resolvedBy, "local-user");
  assert.equal(resolvedAnnotationQueue.json().resolutionHistory[0].resolution, "manual");
  assert.equal(resolvedAnnotationQueue.json().resolutionHistory[0].discardedRefs.length, 1);
  assert.equal(resolvedAnnotationQueue.json().resolutionHistory[0].governance.excludesObservedOutputs, true);
  assert.equal(resolvedAnnotationQueue.json().auditCount, 4);

  const reopenedAnnotationQueue = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/annotation-queue/merge",
    headers: { "content-type": "application/json" },
    payload: {
      items: [mergedAnnotationQueue.json().items[0]],
    },
  });
  assert.equal(reopenedAnnotationQueue.statusCode, 200);
  assert.equal(reopenedAnnotationQueue.json().conflictCount, 1);
  assert.equal(reopenedAnnotationQueue.json().openConflictCount, 0);
  assert.equal(reopenedAnnotationQueue.json().resolutionHistoryCount, 1);
  assert.equal(reopenedAnnotationQueue.json().items[0].status, "rejected");
  assert.equal(reopenedAnnotationQueue.json().items[0].observedOutput, "saida remota divergente");

  const emptySchemaPatternLibrary = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/schema-pattern-library",
  });
  assert.equal(emptySchemaPatternLibrary.statusCode, 200);
  assert.equal(emptySchemaPatternLibrary.json().format, "agent-flow-builder.schema-pattern-library.v1");
  assert.equal(emptySchemaPatternLibrary.json().itemCount, 0);
  assert.equal(emptySchemaPatternLibrary.json().sharedSync.action, "empty");
  assert.equal(emptySchemaPatternLibrary.json().sharedSync.subject, "library");
  assert.equal(emptySchemaPatternLibrary.json().sharedSync.finalCount, 0);
  assert.equal(emptySchemaPatternLibrary.json().sharedSync.governance.excludesSecretValues, true);

  const schemaPatternLibrary = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/schema-pattern-library",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.schema-pattern-library.v1",
      exportedAt: "2026-07-02T00:08:00.000Z",
      items: [
        {
          id: "schema-pattern-shared-message",
          name: "Mensagem compartilhada",
          description: "Contrato de mensagem reutilizável.",
          tags: ["mensagem", "rag"],
          curationStatus: "approved",
          createdAt: "2026-07-02T00:08:00.000Z",
          updatedAt: "2026-07-02T00:08:00.000Z",
          schemaHash: "schema-a",
          usageCount: 1,
          summary: { propertyCount: 1, definitionCount: 0 },
          schema: {
            type: "object",
            properties: {
              message: { type: "string" },
            },
          },
        },
      ],
    },
  });
  assert.equal(schemaPatternLibrary.statusCode, 200);
  assert.equal(schemaPatternLibrary.json().itemCount, 1);
  assert.equal(schemaPatternLibrary.json().items[0].id, "schema-pattern-shared-message");
  assert.equal(schemaPatternLibrary.json().items[0].curationStatus, "approved");
  assert.match(schemaPatternLibrary.json().packageHash, /^[a-f0-9]{8}$/);
  assert.equal(schemaPatternLibrary.json().sharedSync.action, "save");
  assert.equal(schemaPatternLibrary.json().sharedSync.incomingCount, 1);
  assert.equal(schemaPatternLibrary.json().sharedSync.existingCount, 0);
  assert.equal(schemaPatternLibrary.json().sharedSync.addedCount, 1);
  assert.equal(schemaPatternLibrary.json().sharedSync.finalCount, 1);
  assert.equal(schemaPatternLibrary.json().sharedSync.governance.excludesRawSchemaContent, false);

  const mergedSchemaPatternLibrary = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/schema-pattern-library/merge",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.schema-pattern-library.v1",
      exportedAt: "2026-07-02T00:09:00.000Z",
      items: [
        {
          ...schemaPatternLibrary.json().items[0],
          tags: ["mensagem", "revisado"],
          updatedAt: "2026-07-02T00:09:00.000Z",
          usageCount: 2,
        },
        {
          id: "schema-pattern-shared-citation",
          name: "Citação compartilhada",
          description: "Contrato de citação RAG reutilizável.",
          tags: ["citation"],
          curationStatus: "draft",
          createdAt: "2026-07-02T00:09:00.000Z",
          updatedAt: "2026-07-02T00:09:00.000Z",
          schema: {
            type: "object",
            properties: {
              source: { type: "string" },
              quote: { type: "string" },
            },
          },
        },
      ],
    },
  });
  assert.equal(mergedSchemaPatternLibrary.statusCode, 200);
  assert.equal(mergedSchemaPatternLibrary.json().itemCount, 2);
  assert.equal(mergedSchemaPatternLibrary.json().sharedSync.action, "merge");
  assert.equal(mergedSchemaPatternLibrary.json().sharedSync.incomingCount, 2);
  assert.equal(mergedSchemaPatternLibrary.json().sharedSync.existingCount, 1);
  assert.equal(mergedSchemaPatternLibrary.json().sharedSync.addedCount, 1);
  assert.equal(mergedSchemaPatternLibrary.json().sharedSync.updatedCount, 1);
  assert.equal(mergedSchemaPatternLibrary.json().sharedSync.conflictCount, 1);
  assert.equal(mergedSchemaPatternLibrary.json().sharedSync.finalCount, 2);
  assert.match(mergedSchemaPatternLibrary.json().sharedSync.contentHash, /^[a-f0-9]{8}$/);
  assert.equal(mergedSchemaPatternLibrary.json().conflictCount, 1);
  assert.equal(mergedSchemaPatternLibrary.json().openConflictCount, 1);
  assert.equal(mergedSchemaPatternLibrary.json().conflicts[0].itemId, "schema-pattern-shared-message");
  assert.equal(mergedSchemaPatternLibrary.json().conflicts[0].status, "open");
  assert.equal(mergedSchemaPatternLibrary.json().conflicts[0].existingSnapshot.name, "Mensagem compartilhada");
  assert.equal(mergedSchemaPatternLibrary.json().conflicts[0].incomingSnapshot.name, "Mensagem compartilhada");
  assert.equal(mergedSchemaPatternLibrary.json().conflicts[0].existingSnapshot.schema, undefined);
  assert.equal(mergedSchemaPatternLibrary.json().conflicts[0].incomingSnapshot.schema, undefined);
  const mergedMessageSchemaPattern = mergedSchemaPatternLibrary
    .json()
    .items.find((item: { id: string }) => item.id === "schema-pattern-shared-message");
  assert.ok(mergedMessageSchemaPattern);
  assert.equal(mergedMessageSchemaPattern.usageCount, 2);
  assert.deepEqual(mergedMessageSchemaPattern.tags, ["mensagem", "revisado"]);
  await access(path.join(workspaceRoot, "flows", "reference-interview", ".agent-flow", "schema-patterns", "library.afschemapatterns.json"));

  const schemaPatternConflictReview = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/schema-pattern-library/conflicts-review",
  });
  assert.equal(schemaPatternConflictReview.statusCode, 200);
  assert.equal(schemaPatternConflictReview.json().format, "agent-flow-builder.schema-pattern-conflict-review.v1");
  assert.equal(schemaPatternConflictReview.json().conflictCount, 1);
  assert.equal(schemaPatternConflictReview.json().openConflictCount, 1);
  assert.equal(schemaPatternConflictReview.json().resolutionCount, 0);
  assert.equal(schemaPatternConflictReview.json().governance.excludesRawSchemaContent, true);
  assert.equal(schemaPatternConflictReview.json().governance.excludesLocalRawTextDiff, true);
  assert.equal(schemaPatternConflictReview.json().items, undefined);
  assert.equal(JSON.stringify(schemaPatternConflictReview.json()).includes('"schema":'), false);
  assert.equal(JSON.stringify(schemaPatternConflictReview.json()).includes("rawSchemaTextDiff"), false);

  const resolvedSchemaPatternConflict = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/schema-pattern-library/conflicts/${mergedSchemaPatternLibrary.json().conflicts[0].id}/resolve`,
    headers: { "content-type": "application/json" },
    payload: {
      resolvedBy: "schema-curator",
      resolution: "accept_existing_snapshot",
      resolutionNote: "Retomar metadados aprovados anteriormente.",
    },
  });
  assert.equal(resolvedSchemaPatternConflict.statusCode, 200);
  assert.equal(resolvedSchemaPatternConflict.json().conflictCount, 1);
  assert.equal(resolvedSchemaPatternConflict.json().openConflictCount, 0);
  assert.equal(resolvedSchemaPatternConflict.json().sharedSync.action, "resolve_conflict");
  assert.equal(resolvedSchemaPatternConflict.json().sharedSync.updatedCount, 1);
  assert.equal(resolvedSchemaPatternConflict.json().sharedSync.conflictCount, 1);
  assert.equal(resolvedSchemaPatternConflict.json().conflicts[0].status, "resolved");
  assert.equal(resolvedSchemaPatternConflict.json().conflicts[0].resolvedBy, "schema-curator");
  assert.equal(resolvedSchemaPatternConflict.json().conflicts[0].resolution, "accept_existing_snapshot");
  assert.equal(resolvedSchemaPatternConflict.json().conflicts[0].resolutionNote, "Retomar metadados aprovados anteriormente.");
  assert.equal(resolvedSchemaPatternConflict.json().conflicts[0].resolutionPlan.selectedSnapshot, "existing_snapshot");
  assert.equal(resolvedSchemaPatternConflict.json().conflicts[0].resolutionPlan.schemaContentAction, "selected_schema_already_current");
  assert.equal(resolvedSchemaPatternConflict.json().conflicts[0].resolutionPlan.metadataAction, "selected_metadata_applied");
  assert.deepEqual(
    resolvedSchemaPatternConflict.json().conflicts[0].resolutionPlan.metadataFieldsChanged.sort(),
    ["tags", "usageCount"],
  );
  assert.equal(resolvedSchemaPatternConflict.json().conflicts[0].resolutionPlan.governance.excludesRawSchemaContent, true);
  assert.equal(resolvedSchemaPatternConflict.json().conflicts[0].existingSnapshot.schema, undefined);
  assert.equal(resolvedSchemaPatternConflict.json().conflicts[0].incomingSnapshot.schema, undefined);
  assert.equal(JSON.stringify(resolvedSchemaPatternConflict.json().conflicts[0]).includes('"schema":{"'), false);
  const resolvedMessageSchemaPattern = resolvedSchemaPatternConflict
    .json()
    .items.find((item: { id: string }) => item.id === "schema-pattern-shared-message");
  assert.ok(resolvedMessageSchemaPattern);
  assert.equal(resolvedMessageSchemaPattern.usageCount, 1);
  assert.deepEqual(resolvedMessageSchemaPattern.tags, ["mensagem", "rag"]);

  const schemaPatternConflictReviewDiff = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/schema-pattern-library/conflicts-review/diff",
    headers: { "content-type": "application/json" },
    payload: schemaPatternConflictReview.json(),
  });
  assert.equal(schemaPatternConflictReviewDiff.statusCode, 200);
  assert.equal(schemaPatternConflictReviewDiff.json().format, "agent-flow-builder.schema-pattern-conflict-review-diff.v1");
  assert.equal(schemaPatternConflictReviewDiff.json().current.openConflictCount, 0);
  assert.equal(schemaPatternConflictReviewDiff.json().incoming.openConflictCount, 1);
  assert.equal(schemaPatternConflictReviewDiff.json().sections.some((section: { id: string; changedCount: number }) => section.id === "conflicts" && section.changedCount === 1), true);
  assert.equal(schemaPatternConflictReviewDiff.json().sections.some((section: { id: string; changedCount: number }) => section.id === "resolutions" && section.changedCount === 1), true);
  assert.equal(JSON.stringify(schemaPatternConflictReviewDiff.json()).includes('"schema":'), false);

  const schemaPatternConflictReviewBody = schemaPatternConflictReview.json() as any;
  const invalidSchemaPatternConflictReviewDiff = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/schema-pattern-library/conflicts-review/diff",
    headers: { "content-type": "application/json" },
    payload: {
      ...schemaPatternConflictReviewBody,
      conflicts: [
        {
          ...schemaPatternConflictReviewBody.conflicts[0],
          incomingSnapshot: {
            ...schemaPatternConflictReviewBody.conflicts[0].incomingSnapshot,
            schema: { type: "object" },
          },
        },
      ],
    },
  });
  assert.equal(invalidSchemaPatternConflictReviewDiff.statusCode, 400);
  assert.match(invalidSchemaPatternConflictReviewDiff.json().message, /schema bruto/);

  const emptySchemaPatternHistory = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/schema-pattern-history",
  });
  assert.equal(emptySchemaPatternHistory.statusCode, 200);
  assert.equal(emptySchemaPatternHistory.json().format, "agent-flow-builder.schema-pattern-library-history.v1");
  assert.equal(emptySchemaPatternHistory.json().snapshotCount, 0);
  assert.equal(emptySchemaPatternHistory.json().governance.excludesRawSchemaContent, true);
  assert.equal(emptySchemaPatternHistory.json().sharedSync.action, "empty");
  assert.equal(emptySchemaPatternHistory.json().sharedSync.subject, "history");
  assert.equal(emptySchemaPatternHistory.json().sharedSync.governance.excludesRawSchemaContent, true);

  const schemaPatternHistory = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/schema-pattern-history",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.schema-pattern-library-history.v1",
      exportedAt: "2026-07-02T00:10:00.000Z",
      snapshots: [
        {
          id: "schema-pattern-history-a",
          capturedAt: "2026-07-02T00:10:00.000Z",
          currentSchemaHash: "schema-a",
          itemCount: 1,
          draftCount: 0,
          approvedCount: 1,
          deprecatedCount: 0,
          totalUsageCount: 2,
          tagCount: 2,
          items: [
            {
              id: "schema-pattern-shared-message",
              name: "Mensagem compartilhada",
              tags: ["mensagem", "revisado"],
              curationStatus: "approved",
              schemaHash: "schema-a",
              reviewedAt: "2026-07-02T00:09:00.000Z",
              reviewedBy: "QA",
              lastUsedAt: "2026-07-02T00:09:00.000Z",
              usageCount: 2,
              summary: { propertyCount: 1 },
            },
          ],
          snapshotHash: "snapshot-a",
        },
      ],
      governance: {
        excludesRawSchemaContent: true,
        excludesSecretValues: true,
      },
      packageHash: "old-package-hash",
    },
  });
  assert.equal(schemaPatternHistory.statusCode, 200);
  assert.equal(schemaPatternHistory.json().snapshotCount, 1);
  assert.equal(schemaPatternHistory.json().snapshots[0].snapshotHash, "snapshot-a");
  assert.notEqual(schemaPatternHistory.json().packageHash, "old-package-hash");
  assert.equal(schemaPatternHistory.json().sharedSync.action, "save");
  assert.equal(schemaPatternHistory.json().sharedSync.addedCount, 1);
  assert.equal(schemaPatternHistory.json().sharedSync.finalCount, 1);

  const mergedSchemaPatternHistory = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/schema-pattern-history/merge",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.schema-pattern-library-history.v1",
      exportedAt: "2026-07-02T00:11:00.000Z",
      snapshots: [
        {
          id: "schema-pattern-history-b",
          capturedAt: "2026-07-02T00:11:00.000Z",
          currentSchemaHash: "schema-b",
          itemCount: 2,
          draftCount: 1,
          approvedCount: 1,
          deprecatedCount: 0,
          totalUsageCount: 2,
          tagCount: 3,
          items: [],
          snapshotHash: "snapshot-b",
        },
      ],
    },
  });
  assert.equal(mergedSchemaPatternHistory.statusCode, 200);
  assert.equal(mergedSchemaPatternHistory.json().snapshotCount, 2);
  assert.equal(mergedSchemaPatternHistory.json().snapshots[0].snapshotHash, "snapshot-b");
  assert.equal(mergedSchemaPatternHistory.json().governance.excludesSecretValues, true);
  assert.equal(mergedSchemaPatternHistory.json().sharedSync.action, "merge");
  assert.equal(mergedSchemaPatternHistory.json().sharedSync.incomingCount, 1);
  assert.equal(mergedSchemaPatternHistory.json().sharedSync.existingCount, 1);
  assert.equal(mergedSchemaPatternHistory.json().sharedSync.addedCount, 1);
  assert.equal(mergedSchemaPatternHistory.json().sharedSync.finalCount, 2);
  assert.equal(JSON.stringify(mergedSchemaPatternHistory.json()).includes('"schema":{"'), false);
  await access(path.join(workspaceRoot, "flows", "reference-interview", ".agent-flow", "schema-patterns", "history.afschemapatternhistory.json"));

  const previousSchemaPatternCentralUrl = process.env.AGENT_FLOW_SCHEMA_PATTERN_CENTRAL_URL;
  const previousSchemaPatternCentralToken = process.env.AGENT_FLOW_SCHEMA_PATTERN_CENTRAL_TOKEN;
  const previousSchemaPatternCentralTimeout = process.env.AGENT_FLOW_SCHEMA_PATTERN_CENTRAL_TIMEOUT_MS;
  t.after(() => {
    if (previousSchemaPatternCentralUrl === undefined) {
      delete process.env.AGENT_FLOW_SCHEMA_PATTERN_CENTRAL_URL;
    } else {
      process.env.AGENT_FLOW_SCHEMA_PATTERN_CENTRAL_URL = previousSchemaPatternCentralUrl;
    }
    if (previousSchemaPatternCentralToken === undefined) {
      delete process.env.AGENT_FLOW_SCHEMA_PATTERN_CENTRAL_TOKEN;
    } else {
      process.env.AGENT_FLOW_SCHEMA_PATTERN_CENTRAL_TOKEN = previousSchemaPatternCentralToken;
    }
    if (previousSchemaPatternCentralTimeout === undefined) {
      delete process.env.AGENT_FLOW_SCHEMA_PATTERN_CENTRAL_TIMEOUT_MS;
    } else {
      process.env.AGENT_FLOW_SCHEMA_PATTERN_CENTRAL_TIMEOUT_MS = previousSchemaPatternCentralTimeout;
    }
  });
  const schemaPatternCentralRequests: Array<{ authorization: string | undefined; body: unknown }> = [];
  const centralSchemaPatternLibrary = {
    format: "agent-flow-builder.schema-pattern-library.v1",
    exportedAt: "2026-07-02T00:12:00.000Z",
    items: [
      {
        id: "schema-pattern-central-contact",
        name: "Contato central",
        description: "Contrato central reutilizável para contato.",
        tags: ["central", "contact"],
        curationStatus: "approved",
        createdAt: "2026-07-02T00:12:00.000Z",
        updatedAt: "2026-07-02T00:12:00.000Z",
        schema: {
          type: "object",
          properties: {
            email: { type: "string" },
          },
        },
      },
    ],
  };
  const centralSchemaPatternHistory = {
    format: "agent-flow-builder.schema-pattern-library-history.v1",
    exportedAt: "2026-07-02T00:12:00.000Z",
    snapshots: [
      {
        id: "schema-pattern-history-central",
        capturedAt: "2026-07-02T00:12:00.000Z",
        currentSchemaHash: "schema-central",
        itemCount: 1,
        draftCount: 0,
        approvedCount: 1,
        deprecatedCount: 0,
        totalUsageCount: 0,
        tagCount: 2,
        items: [
          {
            id: "schema-pattern-central-contact",
            name: "Contato central",
            tags: ["central", "contact"],
            curationStatus: "approved",
            schemaHash: "schema-central",
            reviewedAt: "2026-07-02T00:12:00.000Z",
            reviewedBy: "central-curator",
            lastUsedAt: null,
            usageCount: 0,
            summary: { propertyCount: 1 },
          },
        ],
        snapshotHash: "snapshot-central",
      },
    ],
    governance: {
      excludesRawSchemaContent: true,
      excludesSecretValues: true,
    },
  };
  const schemaPatternCentralServer = createServer(async (request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/sync");
    const body = await readJsonBody(request);
    schemaPatternCentralRequests.push({
      authorization: request.headers.authorization,
      body,
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ library: centralSchemaPatternLibrary, history: centralSchemaPatternHistory }));
  });
  await new Promise<void>((resolve) => schemaPatternCentralServer.listen(0, "127.0.0.1", resolve));
  t.after(() => schemaPatternCentralServer.close());
  const schemaPatternCentralAddress = schemaPatternCentralServer.address() as AddressInfo;
  process.env.AGENT_FLOW_SCHEMA_PATTERN_CENTRAL_URL = `http://127.0.0.1:${schemaPatternCentralAddress.port}/sync`;
  process.env.AGENT_FLOW_SCHEMA_PATTERN_CENTRAL_TOKEN = "schema-pattern-central-token";
  process.env.AGENT_FLOW_SCHEMA_PATTERN_CENTRAL_TIMEOUT_MS = "1200";

  const schemaPatternCentralStatus = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/schema-pattern-library/central",
  });
  assert.equal(schemaPatternCentralStatus.statusCode, 200);
  assert.equal(schemaPatternCentralStatus.json().format, "agent-flow-builder.schema-pattern-central-sync-status.v1");
  assert.equal(schemaPatternCentralStatus.json().configured, true);
  assert.equal(schemaPatternCentralStatus.json().tokenConfigured, true);
  assert.equal(schemaPatternCentralStatus.json().timeoutMs, 1200);
  assert.equal(schemaPatternCentralStatus.json().governance.configuredUrlEnv, "AGENT_FLOW_SCHEMA_PATTERN_CENTRAL_URL");
  assert.equal(schemaPatternCentralStatus.json().governance.centralAuthTokenInHeaderOnly, true);
  assert.equal(JSON.stringify(schemaPatternCentralStatus.json()).includes("schema-pattern-central-token"), false);
  assert.equal(JSON.stringify(schemaPatternCentralStatus.json()).includes(String(schemaPatternCentralAddress.port)), false);

  const schemaPatternCentralSync = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/schema-pattern-library/sync-central",
  });
  assert.equal(schemaPatternCentralSync.statusCode, 200);
  assert.equal(schemaPatternCentralSync.json().format, "agent-flow-builder.schema-pattern-central-sync-result.v1");
  assert.equal(schemaPatternCentralSync.json().flowId, "reference-interview");
  assert.equal(schemaPatternCentralSync.json().pushedLibraryItemCount, 2);
  assert.equal(schemaPatternCentralSync.json().pulledLibraryItemCount, 1);
  assert.equal(schemaPatternCentralSync.json().pushedHistorySnapshotCount, 2);
  assert.equal(schemaPatternCentralSync.json().pulledHistorySnapshotCount, 1);
  assert.equal(schemaPatternCentralSync.json().central.statusCode, 200);
  assert.equal(schemaPatternCentralSync.json().central.pushedLibraryItemCount, 2);
  assert.equal(schemaPatternCentralSync.json().central.pulledHistorySnapshotCount, 1);
  assert.equal(schemaPatternCentralSync.json().governance.centralAuthTokenInHeaderOnly, true);
  assert.equal(schemaPatternCentralSync.json().governance.centralAuthTokenInBody, false);
  assert.equal(schemaPatternCentralSync.json().library.itemCount, 3);
  assert.equal(schemaPatternCentralSync.json().history.snapshotCount, 3);
  assert.ok(schemaPatternCentralSync.json().library.items.some((item: { id: string }) => item.id === "schema-pattern-central-contact"));
  assert.equal(JSON.stringify(schemaPatternCentralSync.json()).includes("schema-pattern-central-token"), false);
  assert.equal(JSON.stringify(schemaPatternCentralSync.json()).includes(String(schemaPatternCentralAddress.port)), false);
  assert.equal(schemaPatternCentralRequests.length, 1);
  assert.equal(schemaPatternCentralRequests[0].authorization, "Bearer schema-pattern-central-token");
  const schemaPatternCentralRequestBody = schemaPatternCentralRequests[0].body as {
    format?: string;
    library?: { itemCount?: number };
    history?: { snapshotCount?: number };
    governance?: {
      centralAuthTokenInBody?: boolean;
      centralAuthTokenInHeaderOnly?: boolean;
      sendsRawSchemaContent?: boolean;
      sendsHistoryRawSchemaContent?: boolean;
    };
  };
  assert.equal(schemaPatternCentralRequestBody.format, "agent-flow-builder.schema-pattern-central-sync-request.v1");
  assert.equal(schemaPatternCentralRequestBody.library?.itemCount, 2);
  assert.equal(schemaPatternCentralRequestBody.history?.snapshotCount, 2);
  assert.equal(schemaPatternCentralRequestBody.governance?.centralAuthTokenInHeaderOnly, true);
  assert.equal(schemaPatternCentralRequestBody.governance?.centralAuthTokenInBody, false);
  assert.equal(schemaPatternCentralRequestBody.governance?.sendsRawSchemaContent, true);
  assert.equal(schemaPatternCentralRequestBody.governance?.sendsHistoryRawSchemaContent, false);
  assert.equal(JSON.stringify(schemaPatternCentralRequestBody).includes("schema-pattern-central-token"), false);

  const emptyReplayGovernanceHistory = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/replay-governance-history",
  });
  assert.equal(emptyReplayGovernanceHistory.statusCode, 200);
  assert.equal(emptyReplayGovernanceHistory.json().format, "agent-flow-builder.replay-governance-history.v1");
  assert.equal(emptyReplayGovernanceHistory.json().snapshotCount, 0);
  assert.equal(emptyReplayGovernanceHistory.json().governance.excludesRawScenarioPayload, true);
  assert.equal(emptyReplayGovernanceHistory.json().governance.excludesRawPinPayloads, true);
  assert.equal(emptyReplayGovernanceHistory.json().governance.excludesRawCheckpointState, true);
  assert.equal(emptyReplayGovernanceHistory.json().sharedSync.action, "empty");
  assert.equal(emptyReplayGovernanceHistory.json().sharedSync.governance.excludesRawScenarioPayload, true);

  const replayGovernanceSnapshot = {
    id: "replay-history-a",
    capturedAt: "2026-07-02T12:00:00.000Z",
    snapshotHash: "replay-hash-a",
    packageHash: "pkg-a",
    input: "SHOULD_NOT_PERSIST",
    payload: { secret: "SHOULD_NOT_PERSIST" },
    flow: {
      id: "reference-interview",
      name: "Reference Interview Agent",
      version: "0.1.0",
      flowHash: "flow-hash-a",
      projectHash: "project-hash-a",
    },
    scenario: {
      id: "scenario-a",
      label: "Replay A",
      sourceKind: "checkpoint_fork",
      sourceAgentId: "reference-interview",
      sourceRunId: "run-a",
      sourceNodeId: "llm_step",
      sourceEventSeq: 4,
      hasCheckpoint: true,
      useNodePins: true,
      evaluatorKind: "rules",
      evaluatorRuleCount: 1,
      payloadMode: "structured",
      input: "SHOULD_NOT_PERSIST",
    },
    comparison: {
      status: "ok",
      statusLabel: "pronto",
      summary: "4/4 camadas prontas",
      items: [
        {
          id: "checkpoint",
          label: "Checkpoint vs flow",
          status: "ok",
          expected: "hash atual",
          observed: "hash atual",
          evidence: "compatível",
          action: "Manter",
          input: "SHOULD_NOT_PERSIST",
        },
      ],
    },
    evidence: {
      checkpointEventSeq: 4,
      checkpointNodeId: "llm_step",
      compatibilityLabel: "compatibilidade: versão/hash atuais",
      restoreObserved: true,
      activePinCount: 1,
      stalePinCount: 0,
      checkpointState: { raw: "SHOULD_NOT_PERSIST" },
    },
    pins: [{ input: "SHOULD_NOT_PERSIST", output: "SHOULD_NOT_PERSIST" }],
  };

  const savedReplayGovernanceHistory = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/replay-governance-history",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.replay-governance-history.v1",
      exportedAt: "2026-07-02T12:00:00.000Z",
      flowId: "reference-interview",
      snapshots: [replayGovernanceSnapshot],
    },
  });
  assert.equal(savedReplayGovernanceHistory.statusCode, 200);
  assert.equal(savedReplayGovernanceHistory.json().snapshotCount, 1);
  assert.equal(savedReplayGovernanceHistory.json().snapshots[0].snapshotHash, "replay-hash-a");
  assert.equal(savedReplayGovernanceHistory.json().snapshots[0].comparison.items[0].input, undefined);
  assert.equal(savedReplayGovernanceHistory.json().snapshots[0].evidence.checkpointState, undefined);
  assert.equal(JSON.stringify(savedReplayGovernanceHistory.json()).includes("SHOULD_NOT_PERSIST"), false);
  assert.equal(savedReplayGovernanceHistory.json().governance.excludesRawScenarioPayload, true);
  assert.equal(savedReplayGovernanceHistory.json().governance.excludesRawPinPayloads, true);
  assert.equal(savedReplayGovernanceHistory.json().governance.excludesRawCheckpointState, true);
  assert.equal(savedReplayGovernanceHistory.json().sharedSync.action, "save");
  assert.equal(savedReplayGovernanceHistory.json().sharedSync.addedCount, 1);
  assert.equal(savedReplayGovernanceHistory.json().sharedSync.unchangedCount, 0);
  assert.equal(savedReplayGovernanceHistory.json().sharedSync.finalCount, 1);

  const mergedReplayGovernanceHistory = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/replay-governance-history/merge",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.replay-governance-history.v1",
      exportedAt: "2026-07-02T12:01:00.000Z",
      flowId: "reference-interview",
      snapshots: [
        replayGovernanceSnapshot,
        {
          ...replayGovernanceSnapshot,
          id: "replay-history-b",
          capturedAt: "2026-07-02T12:01:00.000Z",
          snapshotHash: "replay-hash-b",
          packageHash: "pkg-b",
          scenario: {
            ...replayGovernanceSnapshot.scenario,
            id: "scenario-b",
            label: "Replay B",
            sourceRunId: "run-b",
          },
          comparison: {
            ...replayGovernanceSnapshot.comparison,
            status: "warning",
            statusLabel: "atenção",
            summary: "1 camada pendente",
          },
        },
      ],
    },
  });
  assert.equal(mergedReplayGovernanceHistory.statusCode, 200);
  assert.equal(mergedReplayGovernanceHistory.json().snapshotCount, 2);
  assert.equal(mergedReplayGovernanceHistory.json().snapshots[0].snapshotHash, "replay-hash-b");
  assert.equal(mergedReplayGovernanceHistory.json().snapshots[1].snapshotHash, "replay-hash-a");
  assert.equal(mergedReplayGovernanceHistory.json().sharedSync.action, "merge");
  assert.equal(mergedReplayGovernanceHistory.json().sharedSync.incomingCount, 2);
  assert.equal(mergedReplayGovernanceHistory.json().sharedSync.existingCount, 1);
  assert.equal(mergedReplayGovernanceHistory.json().sharedSync.addedCount, 1);
  assert.equal(mergedReplayGovernanceHistory.json().sharedSync.unchangedCount, 1);
  assert.equal(mergedReplayGovernanceHistory.json().sharedSync.finalCount, 2);
  assert.equal(mergedReplayGovernanceHistory.json().conflictCount, 0);
  assert.equal(mergedReplayGovernanceHistory.json().openConflictCount, 0);
  assert.equal(JSON.stringify(mergedReplayGovernanceHistory.json()).includes("SHOULD_NOT_PERSIST"), false);
  const replayGovernanceHistoryFilePath = path.join(
    workspaceRoot,
    "flows",
    "reference-interview",
    ".agent-flow",
    "replay-governance",
    "history.afreplayhistory.json",
  );
  await access(replayGovernanceHistoryFilePath);

  const conflictingReplayGovernanceHistory = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/replay-governance-history/merge",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.replay-governance-history.v1",
      exportedAt: "2026-07-02T12:02:00.000Z",
      flowId: "reference-interview",
      snapshots: [
        {
          ...replayGovernanceSnapshot,
          id: "replay-history-a-review-b",
          capturedAt: "2026-07-02T12:02:00.000Z",
          snapshotHash: "replay-hash-a-review-b",
          packageHash: "pkg-a-review-b",
          review: {
            status: "needs_review",
            statusLabel: "precisa revisão",
            reviewer: "central-reviewer",
            reviewedAt: "2026-07-02T12:02:00.000Z",
            decision: "review_before_promotion",
            summary: "mesma evidência com curadoria divergente",
            reasons: ["curadoria central pediu revisão manual"],
            nextAction: "resolver conflito antes de promover",
            governance: {
              excludesRawScenarioPayload: true,
              excludesRawPinPayloads: true,
              excludesRawCheckpointState: true,
              excludesSecretValues: true,
              source: "studio-replay-governance-review",
            },
          },
        },
      ],
    },
  });
  const conflictingReplayGovernanceBody = conflictingReplayGovernanceHistory.json();
  assert.equal(conflictingReplayGovernanceHistory.statusCode, 200);
  assert.equal(conflictingReplayGovernanceBody.snapshotCount, 3);
  assert.equal(conflictingReplayGovernanceBody.conflictCount, 1);
  assert.equal(conflictingReplayGovernanceBody.openConflictCount, 1);
  assert.equal(conflictingReplayGovernanceBody.sharedSync.conflictCount, 1);
  assert.equal(conflictingReplayGovernanceBody.sharedSync.openConflictCount, 1);
  assert.equal(conflictingReplayGovernanceBody.conflicts[0].scenarioId, "scenario-a");
  assert.equal(conflictingReplayGovernanceBody.conflicts[0].snapshotCount, 2);
  assert.equal(conflictingReplayGovernanceBody.conflicts[0].curationThread.status, "unassigned");
  assert.equal(conflictingReplayGovernanceBody.conflicts[0].curationThread.events.length, 0);
  assert.equal(conflictingReplayGovernanceBody.conflicts[0].curationThread.governance.excludesRawScenarioPayload, true);
  assert.deepEqual(
    conflictingReplayGovernanceBody.conflicts[0].refs.map((ref: { snapshotHash: string }) => ref.snapshotHash).sort(),
    ["replay-hash-a", "replay-hash-a-review-b"],
  );
  assert.equal(conflictingReplayGovernanceBody.conflicts[0].governance.excludesRawScenarioPayload, true);
  assert.equal(JSON.stringify(conflictingReplayGovernanceBody.conflicts).includes("SHOULD_NOT_PERSIST"), false);

  const viewerAssignedReplayGovernanceConflict = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/replay-governance-history/conflicts/${encodeURIComponent(conflictingReplayGovernanceBody.conflicts[0].conflictId)}/curation`,
    headers: { "content-type": "application/json" },
    payload: {
      action: "assign",
      actor: "local-viewer",
      role: "viewer",
      note: "Tentativa somente leitura.",
    },
  });
  assert.equal(viewerAssignedReplayGovernanceConflict.statusCode, 403);
  assert.equal(
    viewerAssignedReplayGovernanceConflict.json().details.code,
    "replay_governance_history_conflict_viewer_forbidden",
  );

  const assignedReplayGovernanceConflict = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/replay-governance-history/conflicts/${encodeURIComponent(conflictingReplayGovernanceBody.conflicts[0].conflictId)}/curation`,
    headers: { "content-type": "application/json" },
    payload: {
      action: "assign",
      actor: "local-reviewer",
      role: "reviewer",
      note: "Assumiu curadoria do conflito de replay.",
    },
  });
  const assignedReplayGovernanceBody = assignedReplayGovernanceConflict.json();
  assert.equal(assignedReplayGovernanceConflict.statusCode, 200);
  assert.equal(assignedReplayGovernanceBody.sharedSync.action, "curate_conflict");
  assert.equal(assignedReplayGovernanceBody.conflicts[0].curationThread.status, "assigned");
  assert.equal(assignedReplayGovernanceBody.conflicts[0].curationThread.assignee, "local-reviewer");
  assert.equal(assignedReplayGovernanceBody.conflicts[0].curationThread.lastAction, "assign");
  assert.match(assignedReplayGovernanceBody.conflicts[0].curationThread.leaseExpiresAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(assignedReplayGovernanceBody.conflicts[0].curationThread.leaseDurationHours, 24);
  assert.equal(assignedReplayGovernanceBody.conflicts[0].curationThread.leaseExpired, false);
  assert.equal(assignedReplayGovernanceBody.conflicts[0].curationThread.events.length, 1);
  assert.equal(assignedReplayGovernanceBody.conflicts[0].curationThread.events[0].action, "assign");
  assert.equal(assignedReplayGovernanceBody.conflicts[0].curationThread.events[0].role, "reviewer");
  assert.equal(assignedReplayGovernanceBody.conflicts[0].curationThread.governance.excludesRawSecretValues, undefined);
  assert.equal(assignedReplayGovernanceBody.conflicts[0].curationThread.governance.excludesSecretValues, true);
  assert.equal(assignedReplayGovernanceBody.conflicts[0].curationThread.governance.autoReleasesExpiredAssignments, true);
  assert.equal(
    assignedReplayGovernanceBody.conflicts[0].curationThread.governance.configuredLeaseHoursEnv,
    "AGENT_FLOW_REPLAY_GOVERNANCE_CONFLICT_CURATION_LEASE_HOURS",
  );
  assert.equal(JSON.stringify(assignedReplayGovernanceBody.conflicts).includes("SHOULD_NOT_PERSIST"), false);

  const releasedReplayGovernanceConflict = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/replay-governance-history/conflicts/${encodeURIComponent(conflictingReplayGovernanceBody.conflicts[0].conflictId)}/curation`,
    headers: { "content-type": "application/json" },
    payload: {
      action: "release",
      actor: "local-reviewer",
      role: "reviewer",
      note: "Liberou curadoria do conflito de replay.",
    },
  });
  const releasedReplayGovernanceBody = releasedReplayGovernanceConflict.json();
  assert.equal(releasedReplayGovernanceConflict.statusCode, 200);
  assert.equal(releasedReplayGovernanceBody.conflicts[0].curationThread.status, "unassigned");
  assert.equal(releasedReplayGovernanceBody.conflicts[0].curationThread.assignee, "");
  assert.equal(releasedReplayGovernanceBody.conflicts[0].curationThread.lastAction, "release");
  assert.equal(releasedReplayGovernanceBody.conflicts[0].curationThread.leaseExpiresAt, null);
  assert.equal(releasedReplayGovernanceBody.conflicts[0].curationThread.leaseDurationHours, null);
  assert.equal(releasedReplayGovernanceBody.conflicts[0].curationThread.leaseExpired, false);
  assert.equal(releasedReplayGovernanceBody.conflicts[0].curationThread.events.length, 2);
  assert.equal(releasedReplayGovernanceBody.conflicts[0].curationThread.events[0].action, "release");
  assert.equal(releasedReplayGovernanceBody.conflicts[0].curationThread.events[1].action, "assign");

  const reloadedReplayGovernanceConflict = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/replay-governance-history",
  });
  const reloadedReplayGovernanceBody = reloadedReplayGovernanceConflict.json();
  assert.equal(reloadedReplayGovernanceConflict.statusCode, 200);
  assert.equal(reloadedReplayGovernanceBody.conflicts[0].curationThread.events.length, 2);
  assert.equal(reloadedReplayGovernanceBody.conflicts[0].curationThread.lastAction, "release");

  const reassignedReplayGovernanceConflict = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/replay-governance-history/conflicts/${encodeURIComponent(conflictingReplayGovernanceBody.conflicts[0].conflictId)}/curation`,
    headers: { "content-type": "application/json" },
    payload: {
      action: "assign",
      actor: "stale-replay-curator",
      role: "reviewer",
      note: "Simula curadoria abandonada.",
    },
  });
  const reassignedReplayGovernanceBody = reassignedReplayGovernanceConflict.json();
  assert.equal(reassignedReplayGovernanceConflict.statusCode, 200);
  assert.equal(reassignedReplayGovernanceBody.conflicts[0].curationThread.status, "assigned");
  assert.equal(reassignedReplayGovernanceBody.conflicts[0].curationThread.assignee, "stale-replay-curator");
  assert.match(reassignedReplayGovernanceBody.conflicts[0].curationThread.leaseExpiresAt, /^\d{4}-\d{2}-\d{2}T/);

  await writeFile(
    replayGovernanceHistoryFilePath,
    `${JSON.stringify(
      {
        ...reassignedReplayGovernanceBody,
        conflicts: reassignedReplayGovernanceBody.conflicts.map(
          (conflict: Record<string, unknown>, index: number) =>
            index === 0
              ? {
                  ...conflict,
                  curationThread: {
                    ...(conflict.curationThread as Record<string, unknown>),
                    status: "assigned",
                    assignee: "stale-replay-curator",
                    openedAt: "2020-01-01T00:00:00.000Z",
                    updatedAt: "2020-01-01T00:00:00.000Z",
                    lastActor: "stale-replay-curator",
                    lastAction: "assign",
                    leaseExpiresAt: "2020-01-01T01:00:00.000Z",
                    leaseDurationHours: 1,
                    leaseExpired: false,
                  },
                }
              : conflict,
        ),
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );

  const expiredReplayGovernanceConflict = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/replay-governance-history",
  });
  const expiredReplayGovernanceBody = expiredReplayGovernanceConflict.json();
  assert.equal(expiredReplayGovernanceConflict.statusCode, 200);
  assert.equal(expiredReplayGovernanceBody.conflicts[0].curationThread.status, "unassigned");
  assert.equal(expiredReplayGovernanceBody.conflicts[0].curationThread.assignee, "");
  assert.equal(expiredReplayGovernanceBody.conflicts[0].curationThread.lastAction, "lease_expired");
  assert.equal(expiredReplayGovernanceBody.conflicts[0].curationThread.leaseExpiresAt, null);
  assert.equal(expiredReplayGovernanceBody.conflicts[0].curationThread.leaseDurationHours, null);
  assert.equal(expiredReplayGovernanceBody.conflicts[0].curationThread.leaseExpired, true);
  assert.equal(
    expiredReplayGovernanceBody.conflicts[0].curationThread.events.some(
      (event: { action: string }) => event.action === "lease_expired",
    ),
    true,
  );

  await writeFile(replayGovernanceHistoryFilePath, `${JSON.stringify(reloadedReplayGovernanceBody, null, 2)}\n`, "utf-8");

  const replayGovernanceConflictReview = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/replay-governance-history/conflicts-review",
  });
  const replayGovernanceConflictReviewBody = replayGovernanceConflictReview.json();
  assert.equal(replayGovernanceConflictReview.statusCode, 200);
  assert.equal(
    replayGovernanceConflictReviewBody.format,
    "agent-flow-builder.replay-governance-history-conflict-review.v1",
  );
  assert.equal(replayGovernanceConflictReviewBody.conflictCount, 1);
  assert.equal(replayGovernanceConflictReviewBody.openConflictCount, 1);
  assert.equal(replayGovernanceConflictReviewBody.resolutionHistoryCount, 0);
  assert.equal(replayGovernanceConflictReviewBody.summary.scenarioCount, 1);
  assert.equal(replayGovernanceConflictReviewBody.summary.unassignedConflictCount, 1);
  assert.equal(replayGovernanceConflictReviewBody.summary.approvedDecisionCount, 1);
  assert.equal(replayGovernanceConflictReviewBody.summary.needsReviewDecisionCount, 1);
  assert.equal(replayGovernanceConflictReviewBody.conflicts[0].refs.length, 2);
  assert.equal(replayGovernanceConflictReviewBody.conflicts[0].curationThread.events.length, 2);
  assert.equal(replayGovernanceConflictReviewBody.governance.excludesSnapshots, true);
  assert.equal(replayGovernanceConflictReviewBody.governance.excludesRawScenarioPayload, true);
  assert.equal(replayGovernanceConflictReviewBody.governance.excludesRawPinPayloads, true);
  assert.equal(replayGovernanceConflictReviewBody.governance.excludesRawCheckpointState, true);
  assert.equal(JSON.stringify(replayGovernanceConflictReviewBody).includes("SHOULD_NOT_PERSIST"), false);
  assert.equal(JSON.stringify(replayGovernanceConflictReviewBody).includes('"snapshots"'), false);
  assert.equal(JSON.stringify(replayGovernanceConflictReviewBody).includes('"evidence"'), false);
  assert.equal(JSON.stringify(replayGovernanceConflictReviewBody).includes('"payload"'), false);
  assert.equal(JSON.stringify(replayGovernanceConflictReviewBody).includes('"input"'), false);
  assert.equal(JSON.stringify(replayGovernanceConflictReviewBody).includes('"output"'), false);
  assert.equal(JSON.stringify(replayGovernanceConflictReviewBody).includes('"checkpoint"'), false);
  assert.equal(JSON.stringify(replayGovernanceConflictReviewBody).includes('"state"'), false);

  const replayGovernanceConflictReviewDiff = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/replay-governance-history/conflicts-review/diff",
    headers: { "content-type": "application/json" },
    payload: {
      review: {
        ...replayGovernanceConflictReviewBody,
        conflicts: [],
        resolutionHistory: [],
      },
    },
  });
  const replayGovernanceConflictReviewDiffBody = replayGovernanceConflictReviewDiff.json();
  assert.equal(replayGovernanceConflictReviewDiff.statusCode, 200);
  assert.equal(
    replayGovernanceConflictReviewDiffBody.format,
    "agent-flow-builder.replay-governance-history-conflict-review-diff.v1",
  );
  assert.equal(replayGovernanceConflictReviewDiffBody.current.conflictCount, 1);
  assert.equal(replayGovernanceConflictReviewDiffBody.incoming.conflictCount, 0);
  assert.equal(replayGovernanceConflictReviewDiffBody.summary.status, "changed");
  assert.equal(replayGovernanceConflictReviewDiffBody.summary.onlyCurrentConflictCount, 1);
  assert.equal(replayGovernanceConflictReviewDiffBody.governance.excludesSnapshots, true);
  assert.equal(replayGovernanceConflictReviewDiffBody.governance.excludesRawScenarioPayload, true);
  assert.equal(JSON.stringify(replayGovernanceConflictReviewDiffBody).includes("SHOULD_NOT_PERSIST"), false);
  assert.equal(JSON.stringify(replayGovernanceConflictReviewDiffBody).includes('"snapshots"'), false);
  assert.equal(JSON.stringify(replayGovernanceConflictReviewDiffBody).includes('"evidence"'), false);
  assert.equal(JSON.stringify(replayGovernanceConflictReviewDiffBody).includes('"payload"'), false);
  assert.equal(JSON.stringify(replayGovernanceConflictReviewDiffBody).includes('"input"'), false);
  assert.equal(JSON.stringify(replayGovernanceConflictReviewDiffBody).includes('"output"'), false);
  assert.equal(JSON.stringify(replayGovernanceConflictReviewDiffBody).includes('"checkpoint"'), false);
  assert.equal(JSON.stringify(replayGovernanceConflictReviewDiffBody).includes('"state"'), false);

  const invalidReplayGovernanceConflictReviewDiff = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/replay-governance-history/conflicts-review/diff",
    headers: { "content-type": "application/json" },
    payload: {
      review: {
        ...replayGovernanceConflictReviewBody,
        evidence: { checkpointState: { token: "raw-replay-token" } },
      },
    },
  });
  assert.equal(invalidReplayGovernanceConflictReviewDiff.statusCode, 400);

  const invalidReplayGovernanceConflictResolution = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/replay-governance-history/conflicts/${encodeURIComponent(conflictingReplayGovernanceBody.conflicts[0].conflictId)}/resolve`,
    headers: { "content-type": "application/json" },
    payload: { keepSnapshotHash: "not-in-conflict" },
  });
  assert.equal(invalidReplayGovernanceConflictResolution.statusCode, 400);

  const viewerResolvedReplayGovernanceConflict = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/replay-governance-history/conflicts/${encodeURIComponent(conflictingReplayGovernanceBody.conflicts[0].conflictId)}/resolve`,
    headers: { "content-type": "application/json" },
    payload: {
      keepSnapshotHash: "replay-hash-a-review-b",
      resolvedBy: "local-viewer",
      resolvedRole: "viewer",
      resolutionNote: "Tentativa somente leitura.",
    },
  });
  assert.equal(viewerResolvedReplayGovernanceConflict.statusCode, 403);
  assert.equal(
    viewerResolvedReplayGovernanceConflict.json().details.code,
    "replay_governance_history_conflict_viewer_forbidden",
  );

  const resolvedReplayGovernanceHistory = await app.inject({
    method: "POST",
    url: `/flows/reference-interview/replay-governance-history/conflicts/${encodeURIComponent(conflictingReplayGovernanceBody.conflicts[0].conflictId)}/resolve`,
    headers: { "content-type": "application/json" },
    payload: {
      keepSnapshotHash: "replay-hash-a-review-b",
      resolvedBy: "local-reviewer",
      resolvedRole: "reviewer",
      resolutionNote: "Resolveu conflito de replay no Studio.",
    },
  });
  const resolvedReplayGovernanceBody = resolvedReplayGovernanceHistory.json();
  assert.equal(resolvedReplayGovernanceHistory.statusCode, 200);
  assert.equal(resolvedReplayGovernanceBody.snapshotCount, 2);
  assert.equal(resolvedReplayGovernanceBody.conflictCount, 0);
  assert.equal(resolvedReplayGovernanceBody.openConflictCount, 0);
  assert.equal(resolvedReplayGovernanceBody.sharedSync.action, "resolve_conflict");
  assert.equal(resolvedReplayGovernanceBody.sharedSync.existingCount, 3);
  assert.equal(resolvedReplayGovernanceBody.sharedSync.finalCount, 2);
  assert.equal(resolvedReplayGovernanceBody.resolutionHistoryCount, 1);
  assert.equal(resolvedReplayGovernanceBody.resolutionHistory[0].conflictId, conflictingReplayGovernanceBody.conflicts[0].conflictId);
  assert.equal(resolvedReplayGovernanceBody.resolutionHistory[0].resolvedBy, "local-reviewer");
  assert.equal(resolvedReplayGovernanceBody.resolutionHistory[0].resolvedRole, "reviewer");
  assert.equal(resolvedReplayGovernanceBody.resolutionHistory[0].resolutionNote, "Resolveu conflito de replay no Studio.");
  assert.equal(resolvedReplayGovernanceBody.resolutionHistory[0].keptSnapshotHash, "replay-hash-a-review-b");
  assert.equal(resolvedReplayGovernanceBody.resolutionHistory[0].discardedRefs.length, 1);
  assert.equal(resolvedReplayGovernanceBody.resolutionHistory[0].discardedRefs[0].snapshotHash, "replay-hash-a");
  assert.equal(resolvedReplayGovernanceBody.resolutionHistory[0].governance.excludesRawScenarioPayload, true);
  assert.ok(resolvedReplayGovernanceBody.snapshots.some((snapshot: { snapshotHash: string }) => snapshot.snapshotHash === "replay-hash-a-review-b"));
  assert.equal(resolvedReplayGovernanceBody.snapshots.some((snapshot: { snapshotHash: string }) => snapshot.snapshotHash === "replay-hash-a"), false);
  assert.equal(JSON.stringify(resolvedReplayGovernanceBody).includes("SHOULD_NOT_PERSIST"), false);

  const reopenedReplayGovernanceHistory = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/replay-governance-history/merge",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.replay-governance-history.v1",
      exportedAt: "2026-07-02T12:03:00.000Z",
      flowId: "reference-interview",
      snapshots: [replayGovernanceSnapshot],
    },
  });
  const reopenedReplayGovernanceBody = reopenedReplayGovernanceHistory.json();
  assert.equal(reopenedReplayGovernanceHistory.statusCode, 200);
  assert.equal(reopenedReplayGovernanceBody.snapshotCount, 2);
  assert.equal(reopenedReplayGovernanceBody.conflictCount, 0);
  assert.equal(reopenedReplayGovernanceBody.openConflictCount, 0);
  assert.equal(reopenedReplayGovernanceBody.resolutionHistoryCount, 1);
  assert.equal(
    reopenedReplayGovernanceBody.snapshots.some((snapshot: { snapshotHash: string }) => snapshot.snapshotHash === "replay-hash-a"),
    false,
  );
  assert.equal(JSON.stringify(reopenedReplayGovernanceBody).includes("SHOULD_NOT_PERSIST"), false);

  const invalidReplayGovernanceHistory = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/replay-governance-history",
    headers: { "content-type": "application/json" },
    payload: { format: "invalid" },
  });
  assert.equal(invalidReplayGovernanceHistory.statusCode, 400);

  const emptyRegressionAlerts = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/regression-alerts",
  });
  assert.equal(emptyRegressionAlerts.statusCode, 200);
  assert.equal(emptyRegressionAlerts.json().format, "agent-flow-builder.regression-alerts.v1");
  assert.equal(emptyRegressionAlerts.json().alertCount, 0);
  assert.equal(emptyRegressionAlerts.json().openCount, 0);
  assert.equal(emptyRegressionAlerts.json().sharedSync.action, "empty");
  assert.equal(emptyRegressionAlerts.json().sharedSync.governance.excludesRawRuns, true);
  assert.equal(emptyRegressionAlerts.json().sharedSync.governance.excludesRawNodePayloads, true);

  const regressionAlertItem = {
    id: "regression-alert-a",
    flowId: "reference-interview",
    source: "run-comparison",
    route: "local-inbox",
    status: "open",
    severity: "fail",
    baselineRunId: "run-ui-audit-ok",
    candidateRunId: "run-ui-audit-error",
    verdict: "Regressão detectada.",
    reasons: ["Erro novo", "Tokens cresceram"],
    appliedThresholds: {
      tokenGrowthPct: 12,
      costGrowthPct: 20,
      durationGrowthPct: 30,
      nodeTypeThresholds: {
        llm: {
          maxChangedNodes: 1,
          maxStateDiffs: 2,
          maxOutputDiffs: 3,
          rawPayload: "SHOULD_NOT_PERSIST",
        },
      },
      rawRun: "SHOULD_NOT_PERSIST",
    },
    metrics: {
      errorCountDelta: 1,
      eventCountDelta: 2,
      durationMsDelta: 1200,
      totalTokensDelta: 40,
      totalCostUsdDelta: 0.02,
      changedNodeCount: 1,
      stateDiffCount: 2,
      outputDiffCount: 1,
      nodeTypeThresholdCount: 1,
      comparesPinnedToLive: true,
      rawNodePayload: "SHOULD_NOT_PERSIST",
    },
    firstSeenAt: "2026-07-02T12:00:00.000Z",
    lastSeenAt: "2026-07-02T12:00:00.000Z",
    acknowledgedAt: null,
    occurrenceCount: 1,
    retainedUntil: "2999-01-01T00:00:00.000Z",
    left: { raw: "SHOULD_NOT_PERSIST" },
    right: { raw: "SHOULD_NOT_PERSIST" },
    payload: { raw: "SHOULD_NOT_PERSIST" },
  };

  const savedRegressionAlerts = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/regression-alerts",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.regression-alerts.v1",
      exportedAt: "2026-07-02T12:00:00.000Z",
      flowId: "reference-interview",
      items: [regressionAlertItem],
    },
  });
  assert.equal(savedRegressionAlerts.statusCode, 200);
  assert.equal(savedRegressionAlerts.json().alertCount, 1);
  assert.equal(savedRegressionAlerts.json().openCount, 1);
  assert.equal(savedRegressionAlerts.json().items[0].id, "regression-alert-a");
  assert.equal(savedRegressionAlerts.json().items[0].left, undefined);
  assert.equal(savedRegressionAlerts.json().items[0].right, undefined);
  assert.equal(savedRegressionAlerts.json().items[0].payload, undefined);
  assert.equal(savedRegressionAlerts.json().items[0].appliedThresholds.nodeTypeThresholds.llm.rawPayload, undefined);
  assert.equal(JSON.stringify(savedRegressionAlerts.json()).includes("SHOULD_NOT_PERSIST"), false);
  assert.equal(savedRegressionAlerts.json().retentionPolicy.excludesRawRuns, true);
  assert.equal(savedRegressionAlerts.json().retentionPolicy.excludesRawNodePayloads, true);
  assert.equal(savedRegressionAlerts.json().retentionPolicy.excludesSecretValues, true);
  assert.equal(savedRegressionAlerts.json().sharedSync.action, "save");
  assert.equal(savedRegressionAlerts.json().sharedSync.addedCount, 1);
  assert.equal(savedRegressionAlerts.json().sharedSync.finalCount, 1);

  const viewerAcknowledgedRegressionAlerts = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/regression-alerts/merge",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.regression-alerts.v1",
      exportedAt: "2026-07-02T12:02:00.000Z",
      flowId: "reference-interview",
      items: [
        {
          ...regressionAlertItem,
          status: "acknowledged",
          acknowledgedAt: "2026-07-02T12:02:00.000Z",
          acknowledgedBy: "qa-viewer",
          acknowledgedRole: "viewer",
        },
      ],
    },
  });
  assert.equal(viewerAcknowledgedRegressionAlerts.statusCode, 403);
  assert.equal(
    viewerAcknowledgedRegressionAlerts.json().details.code,
    "regression_alert_acknowledgement_viewer_forbidden",
  );

  const mergedRegressionAlerts = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/regression-alerts/merge",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.regression-alerts.v1",
      exportedAt: "2026-07-02T12:03:00.000Z",
      flowId: "reference-interview",
      items: [
        {
          ...regressionAlertItem,
          status: "acknowledged",
          acknowledgedAt: "2026-07-02T12:03:00.000Z",
          acknowledgedBy: "qa-reviewer",
          acknowledgedRole: "reviewer",
        },
        {
          ...regressionAlertItem,
          id: "regression-alert-b",
          severity: "warn",
          candidateRunId: "run-ui-audit-warning",
          verdict: "Regressão em atenção.",
          firstSeenAt: "2026-07-02T12:02:00.000Z",
          lastSeenAt: "2026-07-02T12:02:00.000Z",
          acknowledgedAt: null,
        },
      ],
    },
  });
  assert.equal(mergedRegressionAlerts.statusCode, 200);
  assert.equal(mergedRegressionAlerts.json().alertCount, 2);
  assert.equal(mergedRegressionAlerts.json().openCount, 1);
  assert.equal(mergedRegressionAlerts.json().items.find((item: { id: string }) => item.id === "regression-alert-a").status, "acknowledged");
  assert.equal(
    mergedRegressionAlerts.json().items.find((item: { id: string }) => item.id === "regression-alert-a").acknowledgedBy,
    "qa-reviewer",
  );
  assert.equal(
    mergedRegressionAlerts.json().items.find((item: { id: string }) => item.id === "regression-alert-a").acknowledgedRole,
    "reviewer",
  );
  assert.equal(mergedRegressionAlerts.json().sharedSync.action, "merge");
  assert.equal(mergedRegressionAlerts.json().sharedSync.incomingCount, 2);
  assert.equal(mergedRegressionAlerts.json().sharedSync.existingCount, 1);
  assert.equal(mergedRegressionAlerts.json().sharedSync.addedCount, 1);
  assert.equal(mergedRegressionAlerts.json().sharedSync.updatedCount, 1);
  assert.equal(mergedRegressionAlerts.json().sharedSync.finalCount, 2);
  assert.equal(JSON.stringify(mergedRegressionAlerts.json()).includes("SHOULD_NOT_PERSIST"), false);
  await access(path.join(workspaceRoot, "flows", "reference-interview", ".agent-flow", "regression-alerts", "inbox.afregressionalerts.json"));

  const invalidRegressionAlerts = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/regression-alerts",
    headers: { "content-type": "application/json" },
    payload: { format: "invalid" },
  });
  assert.equal(invalidRegressionAlerts.statusCode, 400);

  const emptyExperimentDashboardHistory = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/experiment-dashboard-history",
  });
  assert.equal(emptyExperimentDashboardHistory.statusCode, 200);
  assert.equal(emptyExperimentDashboardHistory.json().format, "agent-flow-builder.experiment-dashboard-history.v1");
  assert.equal(emptyExperimentDashboardHistory.json().snapshotCount, 0);

  const experimentDashboardPayload = {
    format: "agent-flow-builder.experiment-dashboard.v1",
    exportedAt: "2026-07-02T00:10:00.000Z",
    flow: {
      id: "reference-interview",
      name: "Reference Interview Agent",
      version: "0.1.0",
      flowHash: "flow-hash-a",
    },
    summary: {
      datasetCount: 1,
      datasetWithRunsCount: 1,
      scenarioCount: 2,
      runCount: 3,
      latestRunAt: "2026-07-02T00:09:00.000Z",
      averageOkRatePct: 100,
      averagePassRatePct: 67,
      improvingDatasetCount: 0,
      regressingDatasetCount: 1,
      stableDatasetCount: 0,
      newDatasetCount: 0,
      flowChangedRunCount: 1,
      severityCounts: { pass: 2, warn: 1, fail: 0, error: 0 },
    },
    datasets: [
      {
        id: "dataset-a",
        name: "Dataset A",
        version: 2,
        scenarioCount: 2,
        runCount: 3,
        latestRunAt: "2026-07-02T00:09:00.000Z",
        latestSeverity: "warn",
        latestOkRatePct: 100,
        latestPassRatePct: 67,
        latestTrend: "regressed",
        okRateDeltaPct: -10,
        flowChangedSincePrevious: true,
        bestOkRatePct: 100,
        worstOkRatePct: 90,
        issueRunCount: 1,
      },
    ],
  };
  const experimentDashboardHistory = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/experiment-dashboard-history",
    headers: { "content-type": "application/json" },
    payload: experimentDashboardPayload,
  });
  assert.equal(experimentDashboardHistory.statusCode, 200);
  assert.equal(experimentDashboardHistory.json().snapshotCount, 1);
  assert.equal(experimentDashboardHistory.json().snapshots[0].summary.runCount, 3);
  assert.equal(experimentDashboardHistory.json().snapshots[0].summary.averageOkRatePct, 100);

  const dedupedExperimentDashboardHistory = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/experiment-dashboard-history",
    headers: { "content-type": "application/json" },
    payload: {
      ...experimentDashboardPayload,
      exportedAt: "2026-07-02T00:11:00.000Z",
    },
  });
  assert.equal(dedupedExperimentDashboardHistory.statusCode, 200);
  assert.equal(dedupedExperimentDashboardHistory.json().snapshotCount, 1);
  assert.equal(dedupedExperimentDashboardHistory.json().snapshots[0].capturedAt, "2026-07-02T00:11:00.000Z");
  assert.equal(dedupedExperimentDashboardHistory.json().analysis.latestTrend, "new");
  assert.equal(dedupedExperimentDashboardHistory.json().analysis.bestSnapshotId, dedupedExperimentDashboardHistory.json().snapshots[0].id);

  const regressedExperimentDashboardHistory = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/experiment-dashboard-history",
    headers: { "content-type": "application/json" },
    payload: {
      ...experimentDashboardPayload,
      exportedAt: "2026-07-02T00:12:00.000Z",
      flow: {
        ...experimentDashboardPayload.flow,
        flowHash: "flow-hash-b",
      },
      summary: {
        ...experimentDashboardPayload.summary,
        runCount: 4,
        latestRunAt: "2026-07-02T00:12:00.000Z",
        averageOkRatePct: 80,
        averagePassRatePct: 50,
        regressingDatasetCount: 1,
        flowChangedRunCount: 2,
      },
      datasets: [
        {
          ...experimentDashboardPayload.datasets[0],
          runCount: 4,
          latestRunAt: "2026-07-02T00:12:00.000Z",
          latestOkRatePct: 80,
          latestPassRatePct: 50,
          latestTrend: "regressed",
          okRateDeltaPct: -20,
          flowChangedSincePrevious: true,
          worstOkRatePct: 80,
          issueRunCount: 2,
        },
      ],
    },
  });
  assert.equal(regressedExperimentDashboardHistory.statusCode, 200);
  assert.equal(regressedExperimentDashboardHistory.json().snapshotCount, 2);
  assert.equal(regressedExperimentDashboardHistory.json().analysis.latestTrend, "regressed");
  assert.equal(regressedExperimentDashboardHistory.json().analysis.latestOkRateDeltaPct, -20);
  assert.equal(regressedExperimentDashboardHistory.json().analysis.latestPassRateDeltaPct, -17);
  assert.equal(regressedExperimentDashboardHistory.json().analysis.latestRunCountDelta, 1);
  assert.equal(regressedExperimentDashboardHistory.json().analysis.latestFlowChanged, true);
  assert.equal(regressedExperimentDashboardHistory.json().analysis.averageOkRatePct, 90);
  assert.equal(
    regressedExperimentDashboardHistory.json().analysis.bestSnapshotId,
    dedupedExperimentDashboardHistory.json().snapshots[0].id,
  );
  assert.equal(
    regressedExperimentDashboardHistory.json().analysis.worstSnapshotId,
    regressedExperimentDashboardHistory.json().snapshots[0].id,
  );

  const emptySafetyHarnessHistory = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/safety-harness/runs",
  });
  assert.equal(emptySafetyHarnessHistory.statusCode, 200);
  assert.equal(emptySafetyHarnessHistory.json().format, "agent-flow-builder.safety-harness-history.v1");
  assert.equal(emptySafetyHarnessHistory.json().runCount, 0);

  const localSafetyHarness = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/safety-harness/evaluate",
    headers: { "content-type": "application/json" },
    payload: {
      nodeId: "input_safety_check",
      stage: "input",
      text: "Meu cpf apareceu na conversa.",
      policy: {
        mode: "custom",
        severityThreshold: "medium",
        fallbackResponse: "Resposta segura local.",
        rules: [
          {
            id: "privacy_document",
            match: "cpf",
            matchType: "contains",
            category: "privacy",
            severity: "high",
            action: "safe_redirect",
            safeResponse: "Não exponha dados pessoais.",
          },
        ],
      },
    },
  });
  assert.equal(localSafetyHarness.statusCode, 200);
  assert.equal(localSafetyHarness.json().runCount, 1);
  assert.equal(localSafetyHarness.json().blockedCount, 1);
  assert.equal(localSafetyHarness.json().pendingReviewCount, 1);
  assert.equal(localSafetyHarness.json().runs[0].final.category, "privacy");
  assert.equal(localSafetyHarness.json().runs[0].final.ruleId, "privacy_document");

  const safetyProviderServer = createServer(async (request, response) => {
    assert.equal(request.method, "POST");
    const body = await readJsonBody(request);
    assert.equal((body as { nodeId?: string }).nodeId, "input_safety_check");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      blocked: true,
      decision: "block",
      severity: "critical",
      category: "external_policy",
      reason: "Provider externo bloqueou.",
      safeResponse: "Resposta segura do provider.",
      score: 0.98,
    }));
  });
  await new Promise<void>((resolve) => safetyProviderServer.listen(0, "127.0.0.1", resolve));
  t.after(() => safetyProviderServer.close());
  const safetyProviderAddress = safetyProviderServer.address() as AddressInfo;
  const externalSafetyHarness = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/safety-harness/evaluate",
    headers: { "content-type": "application/json" },
    payload: {
      nodeId: "input_safety_check",
      stage: "input",
      text: "Mensagem limpa para provider externo.",
      policy: {
        mode: "custom",
        severityThreshold: "medium",
        fallbackResponse: "",
        rules: [],
      },
      external: {
        enabled: true,
        endpointUrl: `http://127.0.0.1:${safetyProviderAddress.port}/moderate`,
        blockedPath: "blocked",
        decisionPath: "decision",
        severityPath: "severity",
        reasonPath: "reason",
        categoryPath: "category",
        safeResponsePath: "safeResponse",
        scorePath: "score",
        timeoutMs: 5000,
      },
    },
  });
  assert.equal(externalSafetyHarness.statusCode, 200);
  assert.equal(externalSafetyHarness.json().runCount, 2);
  assert.equal(externalSafetyHarness.json().externalCount, 1);
  assert.equal(externalSafetyHarness.json().runs[0].final.source, "external");
  assert.equal(externalSafetyHarness.json().runs[0].final.category, "external_policy");
  const viewerReviewedSafetyRun = await app.inject({
    method: "PUT",
    url: `/flows/reference-interview/safety-harness/runs/${localSafetyHarness.json().runs[0].id}/review`,
    headers: { "content-type": "application/json" },
    payload: {
      status: "accepted",
      reviewer: "qa-viewer",
      role: "viewer",
      note: "Apenas leitura.",
    },
  });
  assert.equal(viewerReviewedSafetyRun.statusCode, 403);
  assert.equal(viewerReviewedSafetyRun.json().details.code, "safety_harness_review_viewer_forbidden");

  const reviewedSafetyRun = await app.inject({
    method: "PUT",
    url: `/flows/reference-interview/safety-harness/runs/${localSafetyHarness.json().runs[0].id}/review`,
    headers: { "content-type": "application/json" },
    payload: {
      status: "accepted",
      reviewer: "qa-local",
      role: "reviewer",
      note: "Bloqueio correto.",
    },
  });
  assert.equal(reviewedSafetyRun.statusCode, 200);
  assert.equal(reviewedSafetyRun.json().acceptedCount, 1);
  assert.equal(reviewedSafetyRun.json().runs.find((run: { id: string }) => run.id === localSafetyHarness.json().runs[0].id).review.reviewer, "qa-local");
  assert.equal(reviewedSafetyRun.json().runs.find((run: { id: string }) => run.id === localSafetyHarness.json().runs[0].id).review.role, "reviewer");

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
            llm: { adapter: "openai", model: "gpt-4.1-mini" },
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

  const providerTelemetry = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-runs/provider-telemetry",
  });
  assert.equal(providerTelemetry.statusCode, 200);
  assert.equal(providerTelemetry.json().format, "agent-flow-builder.studio-provider-telemetry.v1");
  assert.equal(providerTelemetry.json().runCount, 1);
  assert.equal(providerTelemetry.json().telemetryRunCount, 1);
  assert.equal(providerTelemetry.json().eventCount, 1);
  assert.equal(providerTelemetry.json().totalTokens, 42);
  assert.equal(providerTelemetry.json().totalCostUsd, 0.0012);
  assert.equal(providerTelemetry.json().items.length, 1);
  assert.equal(providerTelemetry.json().items[0].provider, "openai");
  assert.equal(providerTelemetry.json().items[0].model, "gpt-4.1-mini");
  assert.equal(providerTelemetry.json().items[0].runCount, 1);
  assert.equal(providerTelemetry.json().items[0].eventCount, 1);
  assert.equal(providerTelemetry.json().items[0].lastRunId, "run-session-abc");

  const providerTelemetryWithBudget = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-runs/provider-telemetry?providerTokenBudget=40&providerCostBudgetUsd=0.001&windowHours=24",
  });
  assert.equal(providerTelemetryWithBudget.statusCode, 200);
  assert.equal(providerTelemetryWithBudget.json().windowHours, 24);
  assert.equal(providerTelemetryWithBudget.json().providerTokenBudget, 40);
  assert.equal(providerTelemetryWithBudget.json().providerCostBudgetUsd, 0.001);
  assert.equal(providerTelemetryWithBudget.json().alertCount, 2);
  assert.equal(providerTelemetryWithBudget.json().items[0].alertSeverity, "warning");
  assert.equal(providerTelemetryWithBudget.json().items[0].tokenBudgetPct, 105);
  assert.equal(providerTelemetryWithBudget.json().items[0].costBudgetPct, 120);
  assert.ok(providerTelemetryWithBudget.json().alerts.some((alert: { metric: string }) => alert.metric === "tokens"));
  assert.ok(providerTelemetryWithBudget.json().alerts.some((alert: { metric: string }) => alert.metric === "cost"));
  const providerTelemetryWithBudgetBody = providerTelemetryWithBudget.json() as any;

  const emptyProviderTelemetryDashboardHistory = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/provider-telemetry-dashboard-history",
  });
  assert.equal(emptyProviderTelemetryDashboardHistory.statusCode, 200);
  assert.equal(
    emptyProviderTelemetryDashboardHistory.json().format,
    "agent-flow-builder.provider-telemetry-dashboard-history.v1",
  );
  assert.equal(emptyProviderTelemetryDashboardHistory.json().snapshotCount, 0);
  assert.equal(emptyProviderTelemetryDashboardHistory.json().governance.includesRawRunEvents, false);
  assert.equal(emptyProviderTelemetryDashboardHistory.json().governance.includesSecretValues, false);

  const savedProviderTelemetryDashboardHistory = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/provider-telemetry-dashboard-history",
    headers: { "content-type": "application/json" },
    payload: {
      ...providerTelemetryWithBudgetBody,
      secret: "SHOULD_NOT_PERSIST",
      rawEvents: [{ token: "SHOULD_NOT_PERSIST" }],
    },
  });
  assert.equal(savedProviderTelemetryDashboardHistory.statusCode, 200);
  assert.equal(savedProviderTelemetryDashboardHistory.json().snapshotCount, 1);
  assert.equal(savedProviderTelemetryDashboardHistory.json().analysis.latestTrend, "new");
  assert.equal(savedProviderTelemetryDashboardHistory.json().snapshots[0].summary.totalTokens, 42);
  assert.equal(savedProviderTelemetryDashboardHistory.json().snapshots[0].summary.totalCostUsd, 0.0012);
  assert.equal(savedProviderTelemetryDashboardHistory.json().snapshots[0].summary.alertCount, 2);
  assert.equal(JSON.stringify(savedProviderTelemetryDashboardHistory.json()).includes("SHOULD_NOT_PERSIST"), false);
  const duplicateProviderTelemetryCapturedAt = new Date(
    Date.parse(savedProviderTelemetryDashboardHistory.json().snapshots[0].capturedAt) + 1000,
  ).toISOString();
  await access(path.join(
    workspaceRoot,
    "flows",
    "reference-interview",
    ".agent-flow",
    "provider-telemetry-dashboard-history",
    "history.json",
  ));

  const duplicateProviderTelemetryDashboardHistory = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/provider-telemetry-dashboard-history",
    headers: { "content-type": "application/json" },
    payload: {
      ...providerTelemetryWithBudgetBody,
      generatedAt: duplicateProviderTelemetryCapturedAt,
    },
  });
  assert.equal(duplicateProviderTelemetryDashboardHistory.statusCode, 200);
  assert.equal(duplicateProviderTelemetryDashboardHistory.json().snapshotCount, 1);
  assert.equal(duplicateProviderTelemetryDashboardHistory.json().snapshots[0].capturedAt, duplicateProviderTelemetryCapturedAt);
  const increasedProviderTelemetryCapturedAt = new Date(
    Date.parse(duplicateProviderTelemetryCapturedAt) + 1000,
  ).toISOString();

  const increasedProviderTelemetryDashboardHistory = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/provider-telemetry-dashboard-history",
    headers: { "content-type": "application/json" },
    payload: {
      ...providerTelemetryWithBudgetBody,
      generatedAt: increasedProviderTelemetryCapturedAt,
      totalTokens: 88,
      totalCostUsd: 0.003,
      alertCount: 1,
      alerts: providerTelemetryWithBudgetBody.alerts.slice(0, 1),
      items: [
        {
          ...providerTelemetryWithBudgetBody.items[0],
          totalTokens: 88,
          totalCostUsd: 0.003,
          eventCount: 2,
        },
      ],
    },
  });
  assert.equal(increasedProviderTelemetryDashboardHistory.statusCode, 200);
  assert.equal(increasedProviderTelemetryDashboardHistory.json().snapshotCount, 2);
  assert.equal(increasedProviderTelemetryDashboardHistory.json().analysis.latestTrend, "increased");
  assert.equal(increasedProviderTelemetryDashboardHistory.json().analysis.latestTokenDelta, 46);
  assert.equal(increasedProviderTelemetryDashboardHistory.json().analysis.latestCostDeltaUsd, 0.0018);
  assert.equal(increasedProviderTelemetryDashboardHistory.json().analysis.latestAlertDelta, -1);
  assert.equal(
    increasedProviderTelemetryDashboardHistory.json().analysis.highestCostSnapshotId,
    increasedProviderTelemetryDashboardHistory.json().snapshots[0].id,
  );

  const providerTelemetryCentralServer = createServer(async (request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.headers.authorization, "Bearer provider-dashboard-token");
    const body = await readJsonBody(request);
    assert.equal((body as { format?: string }).format, "agent-flow-builder.provider-telemetry-dashboard-history-central-sync-request.v1");
    assert.equal(JSON.stringify(body).includes("provider-dashboard-token"), false);
    const history = (body as { history?: { snapshots?: unknown[] } }).history;
    assert.ok(history);
    const centralSnapshot = {
      ...(increasedProviderTelemetryDashboardHistory.json().snapshots[0] as Record<string, unknown>),
      id: "provider-telemetry-dashboard-central-extra",
      capturedAt: "2026-07-04T12:00:00.000Z",
      summary: {
        ...(increasedProviderTelemetryDashboardHistory.json().snapshots[0].summary as Record<string, unknown>),
        totalTokens: 128,
        totalCostUsd: 0.0042,
        alertCount: 1,
      },
      telemetry: {
        ...(increasedProviderTelemetryDashboardHistory.json().snapshots[0].telemetry as Record<string, unknown>),
        generatedAt: "2026-07-04T12:00:00.000Z",
        totalTokens: 128,
        totalCostUsd: 0.0042,
        alertCount: 1,
      },
    };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      history: {
        ...history,
        snapshots: [centralSnapshot, ...(history.snapshots ?? [])],
      },
    }));
  });
  await new Promise<void>((resolve) => providerTelemetryCentralServer.listen(0, "127.0.0.1", resolve));
  t.after(() => providerTelemetryCentralServer.close());
  const providerTelemetryCentralAddress = providerTelemetryCentralServer.address() as AddressInfo;
  const previousProviderTelemetryDashboardUrl = process.env.AGENT_FLOW_PROVIDER_TELEMETRY_DASHBOARD_HISTORY_CENTRAL_URL;
  const previousProviderTelemetryDashboardToken = process.env.AGENT_FLOW_PROVIDER_TELEMETRY_DASHBOARD_HISTORY_CENTRAL_TOKEN;
  process.env.AGENT_FLOW_PROVIDER_TELEMETRY_DASHBOARD_HISTORY_CENTRAL_URL =
    `http://127.0.0.1:${providerTelemetryCentralAddress.port}/sync`;
  process.env.AGENT_FLOW_PROVIDER_TELEMETRY_DASHBOARD_HISTORY_CENTRAL_TOKEN = "provider-dashboard-token";
  t.after(() => {
    if (previousProviderTelemetryDashboardUrl === undefined) {
      delete process.env.AGENT_FLOW_PROVIDER_TELEMETRY_DASHBOARD_HISTORY_CENTRAL_URL;
    } else {
      process.env.AGENT_FLOW_PROVIDER_TELEMETRY_DASHBOARD_HISTORY_CENTRAL_URL = previousProviderTelemetryDashboardUrl;
    }
    if (previousProviderTelemetryDashboardToken === undefined) {
      delete process.env.AGENT_FLOW_PROVIDER_TELEMETRY_DASHBOARD_HISTORY_CENTRAL_TOKEN;
    } else {
      process.env.AGENT_FLOW_PROVIDER_TELEMETRY_DASHBOARD_HISTORY_CENTRAL_TOKEN = previousProviderTelemetryDashboardToken;
    }
  });

  const providerTelemetryDashboardCentralStatus = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/provider-telemetry-dashboard-history/central",
  });
  assert.equal(providerTelemetryDashboardCentralStatus.statusCode, 200);
  assert.equal(providerTelemetryDashboardCentralStatus.json().configured, true);
  assert.equal(providerTelemetryDashboardCentralStatus.json().tokenConfigured, true);
  assert.equal(JSON.stringify(providerTelemetryDashboardCentralStatus.json()).includes(String(providerTelemetryCentralAddress.port)), false);
  assert.equal(JSON.stringify(providerTelemetryDashboardCentralStatus.json()).includes("provider-dashboard-token"), false);

  const providerTelemetryDashboardCentralSync = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/provider-telemetry-dashboard-history/sync-central",
  });
  assert.equal(providerTelemetryDashboardCentralSync.statusCode, 200);
  assert.equal(
    providerTelemetryDashboardCentralSync.json().format,
    "agent-flow-builder.provider-telemetry-dashboard-history-central-sync-result.v1",
  );
  assert.equal(providerTelemetryDashboardCentralSync.json().pushedSnapshotCount, 2);
  assert.equal(providerTelemetryDashboardCentralSync.json().pulledSnapshotCount, 3);
  assert.equal(providerTelemetryDashboardCentralSync.json().history.snapshotCount, 3);
  assert.equal(providerTelemetryDashboardCentralSync.json().history.sharedSync.action, "central_sync");
  assert.equal(JSON.stringify(providerTelemetryDashboardCentralSync.json()).includes("provider-dashboard-token"), false);

  const providerTelemetryDashboardDiff = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/provider-telemetry-dashboard-history/diff",
    headers: { "content-type": "application/json" },
    payload: { history: savedProviderTelemetryDashboardHistory.json() },
  });
  assert.equal(providerTelemetryDashboardDiff.statusCode, 200);
  assert.equal(providerTelemetryDashboardDiff.json().format, "agent-flow-builder.provider-telemetry-dashboard-history-diff.v1");
  assert.equal(providerTelemetryDashboardDiff.json().summary.removedCount, 2);
  assert.equal(providerTelemetryDashboardDiff.json().governance.excludesTelemetryPayload, true);
  assert.equal(JSON.stringify(providerTelemetryDashboardDiff.json()).includes("\"telemetry\""), false);
  assert.equal(JSON.stringify(providerTelemetryDashboardDiff.json()).includes("\"alerts\""), false);
  assert.equal(JSON.stringify(providerTelemetryDashboardDiff.json()).includes("\"rawEvents\""), false);

  const invalidProviderTelemetryBudget = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-runs/provider-telemetry?providerTokenBudget=0",
  });
  assert.equal(invalidProviderTelemetryBudget.statusCode, 400);
  assert.equal(invalidProviderTelemetryBudget.json().error, "workspace_error");

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
            regressionThresholds: {
              tokenGrowthPct: 7,
              costGrowthPct: 8,
              durationGrowthPct: 9,
              nodeTypeThresholds: {
                start: { maxChangedNodes: 0, maxStateDiffs: 0, maxOutputDiffs: 0 },
              },
            },
          },
        },
        is_complete: true,
      },
      transcript: [{ seq: 1, role: "assistant", code: "DONE", content: "Vamos encerrar.", metadata: {} }],
      events: [
        { seq: 1, event_type: "session_started", node: "start", payload: { turn: 0, custom: { marker: "right" } } },
        {
          seq: 2,
          event_type: "custom_code_failed",
          node: "finish",
          payload: {
            status: "error",
            custom: {
              status: "custom_code_failed",
              ok: false,
              error: "Cannot find module runner",
              execution_log: {
                mode: "file",
                sandbox_isolation: "container",
                sandbox_boundary: "container_workspace",
                sandbox_executor: "node",
                sandbox_transport: "docker_run",
                sandbox_image: "node:20-alpine",
                sandbox_engine: "docker",
                sandbox_network: "none",
              },
            },
          },
        },
      ],
      logs: ["erro de integração"],
    },
  });
  assert.equal(errorStudioRun.statusCode, 200);
  assert.equal(errorStudioRun.json().id, "run-session-erro");
  assert.equal(errorStudioRun.json().errorCount, 1);
  assert.equal(errorStudioRun.json().isComplete, true);
  assert.equal(errorStudioRun.json().causalAnalysis.failedEventSeq, 2);
  assert.equal(errorStudioRun.json().causalAnalysis.failedEventType, "custom_code_failed");
  assert.equal(errorStudioRun.json().causalAnalysis.failedNode, "finish");
  assert.deepEqual(errorStudioRun.json().causalAnalysis.upstreamPath, ["finish"]);
  assert.deepEqual(errorStudioRun.json().causalAnalysis.impactPath, ["finish"]);
  assert.deepEqual(errorStudioRun.json().causalAnalysis.impactedNodes, ["finish"]);

  const sandboxTelemetry = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-runs/sandbox-telemetry",
  });
  assert.equal(sandboxTelemetry.statusCode, 200);
  assert.equal(sandboxTelemetry.json().format, "agent-flow-builder.studio-sandbox-telemetry.v1");
  assert.equal(sandboxTelemetry.json().runCount, 2);
  assert.equal(sandboxTelemetry.json().telemetryRunCount, 1);
  assert.equal(sandboxTelemetry.json().eventCount, 1);
  assert.equal(sandboxTelemetry.json().failureCount, 1);
  assert.equal(sandboxTelemetry.json().containerEventCount, 1);
  assert.equal(sandboxTelemetry.json().containerFailureCount, 1);
  assert.equal(sandboxTelemetry.json().items.length, 1);
  assert.equal(sandboxTelemetry.json().items[0].nodeId, "finish");
  assert.equal(sandboxTelemetry.json().items[0].sandboxIsolation, "container");
  assert.equal(sandboxTelemetry.json().items[0].sandboxExecutor, "node");
  assert.equal(sandboxTelemetry.json().items[0].sandboxEngine, "docker");
  assert.equal(sandboxTelemetry.json().items[0].lastError, "Cannot find module runner");

  const sandboxTelemetryFailuresOnly = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-runs/sandbox-telemetry?onlyFailures=true&windowHours=24",
  });
  assert.equal(sandboxTelemetryFailuresOnly.statusCode, 200);
  assert.equal(sandboxTelemetryFailuresOnly.json().onlyFailures, true);
  assert.equal(sandboxTelemetryFailuresOnly.json().windowHours, 24);
  assert.equal(sandboxTelemetryFailuresOnly.json().failureCount, 1);

  const invalidSandboxTelemetryFilter = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-runs/sandbox-telemetry?onlyFailures=maybe",
  });
  assert.equal(invalidSandboxTelemetryFilter.statusCode, 400);
  assert.equal(invalidSandboxTelemetryFilter.json().error, "workspace_error");

  const microvmStudioRun = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/studio-runs",
    headers: { "content-type": "application/json" },
    payload: {
      runtimeUrl: "http://127.0.0.1:8093",
      resourceName: "sessions",
      session: {
        session_id: "session-microvm",
        status: "active",
        phase: "asking",
        turn: 1,
        max_turns: 3,
        metadata: { source: "test", agent_id: "support-agent" },
        is_complete: false,
      },
      transcript: [],
      events: [
        {
          seq: 1,
          event_type: "custom_code_executed",
          node: "vm_tool",
          payload: {
            status: "ok",
            custom: {
              status: "custom_code_executed",
              ok: true,
              vm_runner_provides_isolation: true,
              vm_policy: {
                profile: "hardened",
                image: "images/python-firecracker.rootfs.ext4",
                memory: "1536m",
                cpus: "2",
              },
              execution_log: {
                mode: "inline",
                sandbox_isolation: "vm",
                sandbox_boundary: "microvm",
                sandbox_executor: "python",
                sandbox_transport: "guest_agent",
                sandbox_engine: "agent-flow-vm-runner-microvm.py",
                sandbox_profile: "hardened",
              },
              sandbox: {
                isolation: "vm",
                boundary: "microvm",
                executor: "python",
                transport: "guest_agent",
                engine: "agent-flow-vm-runner-microvm.py",
                profile: "hardened",
                image: "images/python-firecracker.rootfs.ext4",
                assurance: "guest_vm",
                policy: {
                  profile: "hardened",
                  network: "none",
                  read_only_rootfs: true,
                  workspace_mount: false,
                  host_device_passthrough: false,
                },
              },
            },
          },
        },
      ],
      logs: ["microvm ok"],
    },
  });
  assert.equal(microvmStudioRun.statusCode, 200);

  const sandboxTelemetryWithMicrovm = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/studio-runs/sandbox-telemetry",
  });
  assert.equal(sandboxTelemetryWithMicrovm.statusCode, 200);
  assert.equal(sandboxTelemetryWithMicrovm.json().runCount, 3);
  assert.equal(sandboxTelemetryWithMicrovm.json().telemetryRunCount, 2);
  assert.equal(sandboxTelemetryWithMicrovm.json().eventCount, 2);
  assert.equal(sandboxTelemetryWithMicrovm.json().failureCount, 1);
  assert.equal(sandboxTelemetryWithMicrovm.json().containerEventCount, 1);
  assert.equal(sandboxTelemetryWithMicrovm.json().containerFailureCount, 1);
  assert.equal(sandboxTelemetryWithMicrovm.json().vmEventCount, 1);
  assert.equal(sandboxTelemetryWithMicrovm.json().vmFailureCount, 0);
  assert.equal(sandboxTelemetryWithMicrovm.json().microvmEventCount, 1);
  assert.equal(sandboxTelemetryWithMicrovm.json().microvmFailureCount, 0);
  assert.equal(sandboxTelemetryWithMicrovm.json().hardenedEventCount, 1);
  assert.equal(sandboxTelemetryWithMicrovm.json().verifiedVmIsolationEventCount, 1);
  const microvmItem = sandboxTelemetryWithMicrovm.json().items.find((item: { nodeId: string }) => item.nodeId === "vm_tool");
  assert.ok(microvmItem);
  assert.equal(microvmItem.sandboxIsolation, "vm");
  assert.equal(microvmItem.sandboxOrchestration, "microvm");
  assert.equal(microvmItem.sandboxHardening, "hardened");
  assert.equal(microvmItem.sandboxVmProvidesIsolation, true);
  assert.equal(microvmItem.sandboxVmAssurance, "guest_vm");
  assert.match(microvmItem.sandboxPolicySummary, /rootfs=read-only/);

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
  assert.equal(studioRunsWithoutErrors.json().runs.length, 2);
  assert.ok(studioRunsWithoutErrors.json().runs.some((run: { sessionId: string }) => run.sessionId === "session-abc"));
  assert.ok(studioRunsWithoutErrors.json().runs.some((run: { sessionId: string }) => run.sessionId === "session-microvm"));

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
  assert.equal(studioRunsFilteredByAgent.json().runs.length, 2);
  assert.ok(studioRunsFilteredByAgent.json().runs.some((run: { sessionId: string }) => run.sessionId === "session-multi-parent"));
  assert.ok(studioRunsFilteredByAgent.json().runs.some((run: { sessionId: string }) => run.sessionId === "session-microvm"));
  assert.ok(studioRunsFilteredByAgent.json().runs.every((run: { agentId: string }) => run.agentId === "support-agent"));

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
    nodeTypeThresholds: {
      start: { maxChangedNodes: 0, maxStateDiffs: 0, maxOutputDiffs: 0 },
    },
  });
  assert.ok(studioRunsCompared.json().regression.reasons.some((reason: string) => reason.includes("erros aumentaram")));
  assert.ok(studioRunsCompared.json().regression.reasons.some((reason: string) => reason.includes("tipo start")));
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
  assert.equal(studioRunsFilteredByMaxDuration.json().runs.length, 4);
  assert.ok(studioRunsFilteredByMaxDuration.json().runs.some((run: { sessionId: string }) => run.sessionId === "session-microvm"));

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
  assert.equal(loadedLegacyRun.json().causalAnalysis?.failedEventType, "custom_code_failed");
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

  const blockedLangSmithHandoff = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/generate-langsmith-cloud-handoff",
  });
  assert.equal(blockedLangSmithHandoff.statusCode, 200);
  assert.equal(blockedLangSmithHandoff.json().handoff.format, "agent-flow-builder.langsmith-cloud-handoff.v1");
  assert.equal(blockedLangSmithHandoff.json().handoff.status, "blocked");
  assert.equal(blockedLangSmithHandoff.json().handoff.sandbox.status, "ready");
  assert.equal(blockedLangSmithHandoff.json().handoff.approval.status, "missing");
  assert.equal(blockedLangSmithHandoff.json().handoff.governance.doesNotCallCloud, true);
  assert.equal(blockedLangSmithHandoff.json().handoff.governance.cloudTokenNotStored, true);

  const sandboxApproval = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/approve-langgraph-sandbox",
    payload: {
      outDir: "generated/reference-interview-langgraph-sandbox",
      approvalEvidence: {
        source: "studio",
        runId: "run-api-approval",
        sessionId: "session-api-approval",
        agentId: "reference-interview",
        eventCount: 7,
        visibleEventCount: 5,
        selectedEventSeq: 4,
        selectedEventType: "node_completed",
        selectedNodeId: "generate_questions",
        latestEventSeq: 7,
        latestEventType: "session_finished",
        capturedAt: "2026-07-02T12:00:00.000Z",
        excludesRawPayloads: true,
        excludesSecretValues: true,
      },
    },
  });
  assert.equal(sandboxApproval.statusCode, 200);
  assert.equal(sandboxApproval.json().approval.status, "approved");
  assert.equal(sandboxApproval.json().approval.sandboxOutDir, "generated/reference-interview-langgraph-sandbox");
  assert.match(sandboxApproval.json().approval.flowHash, /^[a-f0-9]{64}$/);
  assert.equal(sandboxApproval.json().approval.evidence.runId, "run-api-approval");
  assert.equal(sandboxApproval.json().approval.evidence.excludesRawPayloads, true);
  assert.equal(sandboxApproval.json().approval.evidence.excludesSecretValues, true);

  const langSmithHandoff = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/generate-langsmith-cloud-handoff",
  });
  assert.equal(langSmithHandoff.statusCode, 200);
  const handoff = langSmithHandoff.json().handoff;
  assert.equal(handoff.status, "ready");
  assert.equal(handoff.sandbox.status, "ready");
  assert.equal(handoff.approval.ready, true);
  assert.equal(handoff.approval.evidence.runId, "run-api-approval");
  assert.equal(handoff.environment.includesEnvValues, false);
  assert.equal(handoff.governance.includesSecrets, false);
  assert.match(handoff.packageHash, /^[a-f0-9]{64}$/);
  assert.equal(handoff.commands.some((command: { command: string | null }) => command.command?.includes("langgraph dev")), true);
  assert.equal(JSON.stringify(handoff).includes(workspaceRoot), false);
  const savedHandoff = JSON.parse(
    await readFile(
      path.join(workspaceRoot, "flows", "reference-interview", ".agent-flow", "langsmith-handoff.aflangsmithhandoff.json"),
      "utf-8",
    ),
  );
  assert.equal(savedHandoff.packageHash, handoff.packageHash);
  assert.equal(savedHandoff.governance.doesNotCallCloud, true);

  const viewerCloudDeployment = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/langsmith-cloud-deployments",
    payload: {
      status: "verified",
      deploymentName: "Cloud reviewer",
      deploymentUrl: "https://smith.langchain.com/o/acme/projects/demo?token=should-not-persist",
      recordedBy: "viewer",
      recordedRole: "viewer",
    },
  });
  assert.equal(viewerCloudDeployment.statusCode, 403);

  const cloudDeployment = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/langsmith-cloud-deployments",
    payload: {
      status: "verified",
      deploymentName: "Cloud reviewer",
      deploymentUrl: "https://smith.langchain.com/o/acme/projects/demo?token=should-not-persist",
      traceUrl: "https://smith.langchain.com/o/acme/runs/trace?api_key=should-not-persist",
      note: "verificado sem payload bruto",
      recordedBy: "owner-user",
      recordedRole: "owner",
    },
  });
  assert.equal(cloudDeployment.statusCode, 200);
  const deploymentPackage = cloudDeployment.json().deployments;
  assert.equal(deploymentPackage.format, "agent-flow-builder.langsmith-cloud-deployments.v1");
  assert.equal(deploymentPackage.deploymentCount, 1);
  assert.equal(deploymentPackage.latestStatus, "verified");
  assert.equal(deploymentPackage.deployments[0].handoffPackageHash, handoff.packageHash);
  assert.equal(deploymentPackage.deployments[0].recordedRole, "owner");
  assert.equal(deploymentPackage.deployments[0].deploymentUrl, "https://smith.langchain.com/o/acme/projects/demo");
  assert.equal(JSON.stringify(deploymentPackage).includes("should-not-persist"), false);
  assert.equal(deploymentPackage.governance.doesNotCallCloud, true);
  const loadedCloudDeployments = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/langsmith-cloud-deployments",
  });
  assert.equal(loadedCloudDeployments.statusCode, 200);
  assert.equal(loadedCloudDeployments.json().deploymentCount, 1);

  const previousLangSmithDeploymentsCentralUrl = process.env.AGENT_FLOW_LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_URL;
  const previousLangSmithDeploymentsCentralToken = process.env.AGENT_FLOW_LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_TOKEN;
  const previousLangSmithDeploymentsCentralTimeout = process.env.AGENT_FLOW_LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_TIMEOUT_MS;
  t.after(() => {
    if (previousLangSmithDeploymentsCentralUrl === undefined) {
      delete process.env.AGENT_FLOW_LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_URL;
    } else {
      process.env.AGENT_FLOW_LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_URL = previousLangSmithDeploymentsCentralUrl;
    }
    if (previousLangSmithDeploymentsCentralToken === undefined) {
      delete process.env.AGENT_FLOW_LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_TOKEN;
    } else {
      process.env.AGENT_FLOW_LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_TOKEN = previousLangSmithDeploymentsCentralToken;
    }
    if (previousLangSmithDeploymentsCentralTimeout === undefined) {
      delete process.env.AGENT_FLOW_LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_TIMEOUT_MS;
    } else {
      process.env.AGENT_FLOW_LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_TIMEOUT_MS = previousLangSmithDeploymentsCentralTimeout;
    }
  });

  const remoteDeploymentPackage = {
    ...deploymentPackage,
    updatedAt: "2026-07-03T12:30:00.000Z",
    deploymentCount: 1,
    latestStatus: "deployed",
    deployments: [
      {
        ...deploymentPackage.deployments[0],
        id: "langsmith-deploy-central-001",
        status: "deployed",
        deploymentName: "Central mirror",
        deploymentUrl: "https://smith.langchain.com/o/acme/projects/central?api_key=central-should-drop",
        traceUrl: "https://smith.langchain.com/o/acme/runs/central#secret",
        recordedBy: "central-reviewer",
        recordedRole: "reviewer",
        recordedAt: "2026-07-03T12:30:00.000Z",
      },
    ],
  };
  const langSmithCentralRequests: Array<{ authorization: string | undefined; body: any }> = [];
  const langSmithCentralServer = createServer(async (request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/sync");
    langSmithCentralRequests.push({
      authorization: request.headers.authorization,
      body: await readJsonBody(request),
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ deployments: remoteDeploymentPackage }));
  });
  await new Promise<void>((resolve) => langSmithCentralServer.listen(0, "127.0.0.1", resolve));
  t.after(() => langSmithCentralServer.close());
  const langSmithCentralAddress = langSmithCentralServer.address() as AddressInfo;
  process.env.AGENT_FLOW_LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_URL = `http://127.0.0.1:${langSmithCentralAddress.port}/sync`;
  process.env.AGENT_FLOW_LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_TOKEN = "langsmith-central-token";
  process.env.AGENT_FLOW_LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_TIMEOUT_MS = "1500";

  const langSmithDeploymentCentralStatus = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/langsmith-cloud-deployments/central",
  });
  const langSmithDeploymentCentralStatusBody = langSmithDeploymentCentralStatus.json();
  assert.equal(langSmithDeploymentCentralStatus.statusCode, 200);
  assert.equal(langSmithDeploymentCentralStatusBody.format, "agent-flow-builder.langsmith-cloud-deployments-central-sync-status.v1");
  assert.equal(langSmithDeploymentCentralStatusBody.configured, true);
  assert.equal(langSmithDeploymentCentralStatusBody.tokenConfigured, true);
  assert.equal(langSmithDeploymentCentralStatusBody.timeoutMs, 1500);
  assert.equal(langSmithDeploymentCentralStatusBody.governance.centralAuthTokenInHeaderOnly, true);
  assert.equal(langSmithDeploymentCentralStatusBody.governance.centralAuthTokenInBody, false);
  assert.equal(langSmithDeploymentCentralStatusBody.governance.storesCentralToken, false);
  assert.equal(JSON.stringify(langSmithDeploymentCentralStatusBody).includes("langsmith-central-token"), false);
  assert.equal(JSON.stringify(langSmithDeploymentCentralStatusBody).includes(String(langSmithCentralAddress.port)), false);

  const syncedLangSmithDeployments = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/langsmith-cloud-deployments/sync-central",
  });
  assert.equal(syncedLangSmithDeployments.statusCode, 200);
  const syncedLangSmithDeploymentsBody = syncedLangSmithDeployments.json();
  assert.equal(syncedLangSmithDeploymentsBody.format, "agent-flow-builder.langsmith-cloud-deployments-central-sync-result.v1");
  assert.equal(syncedLangSmithDeploymentsBody.pushedDeploymentCount, 1);
  assert.equal(syncedLangSmithDeploymentsBody.pulledDeploymentCount, 1);
  assert.equal(syncedLangSmithDeploymentsBody.deployments.deploymentCount, 2);
  assert.equal(syncedLangSmithDeploymentsBody.central.governance.centralAuthTokenInBody, false);
  assert.equal(langSmithCentralRequests.length, 1);
  assert.equal(langSmithCentralRequests[0].authorization, "Bearer langsmith-central-token");
  assert.equal(JSON.stringify(langSmithCentralRequests[0].body).includes("langsmith-central-token"), false);
  assert.equal(JSON.stringify(langSmithCentralRequests[0].body).includes("should-not-persist"), false);
  assert.equal(JSON.stringify(syncedLangSmithDeploymentsBody).includes("langsmith-central-token"), false);
  assert.equal(JSON.stringify(syncedLangSmithDeploymentsBody).includes("central-should-drop"), false);
  const syncedRemoteDeployment = syncedLangSmithDeploymentsBody.deployments.deployments.find(
    (item: { id: string }) => item.id === "langsmith-deploy-central-001",
  );
  assert.equal(syncedRemoteDeployment.deploymentUrl, "https://smith.langchain.com/o/acme/projects/central");
  assert.equal(syncedRemoteDeployment.traceUrl, "https://smith.langchain.com/o/acme/runs/central");

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
  const runtimeApproval = JSON.parse(
    await readFile(
      path.join(workspaceRoot, "generated", "reference-interview-approved-runtime", ".agent-flow", "langgraph-sandbox-approval.json"),
      "utf-8",
    ),
  );
  assert.equal(runtimeApproval.evidence.runId, "run-api-approval");
  assert.equal(runtimeApproval.evidence.selectedNodeId, "generate_questions");
  const approvedRuntimeArtifacts = await app.inject({
    method: "GET",
    url: "/artifacts?outDir=generated%2Freference-interview-approved-runtime",
  });
  assert.equal(approvedRuntimeArtifacts.statusCode, 200);
  assert.equal(approvedRuntimeArtifacts.json().exportAudit.format, "agent-flow-builder.generated-artifact-export-audit.v1");
  assert.equal(approvedRuntimeArtifacts.json().exportAudit.packageType, "runtime-final");
  assert.equal(approvedRuntimeArtifacts.json().exportAudit.target, "fastapi-runtime");
  assert.equal(approvedRuntimeArtifacts.json().exportAudit.ready, true);
  assert.equal(approvedRuntimeArtifacts.json().exportAudit.detachedFromBuilder, true);
  assert.equal(approvedRuntimeArtifacts.json().exportAudit.includesEnvValues, false);
  assert.equal(approvedRuntimeArtifacts.json().exportAudit.runbook.title, "Rodar runtime final fora do Builder");
  assert.equal(approvedRuntimeArtifacts.json().exportAudit.runbook.agents[0].sessionsUrl, "http://127.0.0.1:8080/sessions");
  assert.equal(
    approvedRuntimeArtifacts.json().exportAudit.runbook.steps.some(
      (step: { command: string | null }) => step.command === "docker compose up -d",
    ),
    true,
  );
  assert.deepEqual(approvedRuntimeArtifacts.json().exportAudit.blockers, []);
  assert.equal(
    approvedRuntimeArtifacts.json().exportAudit.requiredFiles.some(
      (file: { path: string; present: boolean }) => file.path === ".agent-flow/langgraph-sandbox-approval.json" && file.present,
    ),
    true,
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

  const approvedRuntimeArtifactsAfterPorts = await app.inject({
    method: "GET",
    url: "/artifacts?outDir=generated%2Freference-interview-approved-runtime",
  });
  assert.equal(approvedRuntimeArtifactsAfterPorts.statusCode, 200);
  assert.equal(approvedRuntimeArtifactsAfterPorts.json().exportAudit.runbook.runtimeBaseUrl, "http://127.0.0.1:9001");
  assert.equal(
    approvedRuntimeArtifactsAfterPorts.json().exportAudit.runbook.agents[0].sessionsUrl,
    "http://127.0.0.1:9001/sessions",
  );
  assert.equal(
    approvedRuntimeArtifactsAfterPorts.json().exportAudit.runbook.endpoints.find(
      (endpoint: { label: string }) => endpoint.label === "Docs",
    ).url,
    "http://127.0.0.1:9001/docs",
  );

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
  await writeFile(
    path.join(workspaceRoot, "generated", "reference-interview-approved-runtime", ".env"),
    "AGENT_FLOW_SECRET_SENTINEL=should-not-enter-export\n",
  );

  const approvedRuntimeArchive = await app.inject({
    method: "GET",
    url: "/artifacts/archive?outDir=generated%2Freference-interview-approved-runtime",
  });
  assert.equal(approvedRuntimeArchive.statusCode, 200);
  assert.match(String(approvedRuntimeArchive.headers["content-type"]), /application\/zip/);
  assert.equal(approvedRuntimeArchive.body.slice(0, 2), "PK");
  assert.match(approvedRuntimeArchive.body, /reference-interview-approved-runtime\/\.agent-flow\/export-manifest\.json/);
  assert.match(approvedRuntimeArchive.body, /"format": "agent-flow-builder\.generated-artifact-export\.v1"/);
  assert.match(approvedRuntimeArchive.body, /"packageType": "runtime-final"/);
  assert.match(approvedRuntimeArchive.body, /"target": "fastapi-runtime"/);
  assert.match(approvedRuntimeArchive.body, /"detachedFromBuilder": true/);
  assert.match(approvedRuntimeArchive.body, /"includesEnvValues": false/);
  assert.match(approvedRuntimeArchive.body, /"title": "Rodar runtime final fora do Builder"/);
  assert.match(approvedRuntimeArchive.body, /"runtimeBaseUrl": "http:\/\/127\.0\.0\.1:9001"/);
  assert.match(approvedRuntimeArchive.body, /"command": "docker compose up -d"/);
  assert.match(approvedRuntimeArchive.body, /"sessionsUrl": "http:\/\/127\.0\.0\.1:9001\/sessions"/);
  assert.doesNotMatch(approvedRuntimeArchive.body, /AGENT_FLOW_SECRET_SENTINEL/);

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
  assert.ok(dockerInspect.json().inspection.containers.some((container: { service: string }) => container.service === "worker"));
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

test("Builder API syncs annotation queue with the central service without leaking token", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const app = buildApp({ workspaceRoot });

  const savedAnnotationQueue = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/annotation-queue",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.annotation-queue.v1",
      exportedAt: "2026-07-02T00:00:00.000Z",
      flow: { id: "reference-interview", name: "Reference Interview Agent", version: "0.1.0" },
      permissionPolicy: {
        mode: "open",
        reviewers: [{ name: "QA", role: "owner", updatedAt: "2026-07-02T00:00:00.000Z" }],
        updatedAt: "2026-07-02T00:00:00.000Z",
        updatedBy: "QA",
      },
      items: [
        {
          id: "annotation-local-review",
          scenarioId: "scenario-local",
          scenarioLabel: "Cenario local",
          sessionId: "session-local",
          runId: "run-local",
          resultStatus: "ok",
          comparisonSeverity: "warn",
          verdict: "Revisar resposta local",
          reasons: ["baseline mudou"],
          observedOutput: "saida observada local",
          batchHash: "batch-local",
          source: "batch-result",
          status: "pending",
          assignee: "QA",
          reviewedBy: "",
          reviewedAt: null,
          note: "",
          createdAt: "2026-07-02T00:00:00.000Z",
          updatedAt: "2026-07-02T00:00:00.000Z",
        },
      ],
    },
  });
  assert.equal(savedAnnotationQueue.statusCode, 200);
  assert.equal(savedAnnotationQueue.json().itemCount, 1);

  const previousAnnotationCentralUrl = process.env.AGENT_FLOW_ANNOTATION_QUEUE_CENTRAL_URL;
  const previousAnnotationCentralToken = process.env.AGENT_FLOW_ANNOTATION_QUEUE_CENTRAL_TOKEN;
  const previousAnnotationCentralTimeout = process.env.AGENT_FLOW_ANNOTATION_QUEUE_CENTRAL_TIMEOUT_MS;
  t.after(() => {
    if (previousAnnotationCentralUrl === undefined) {
      delete process.env.AGENT_FLOW_ANNOTATION_QUEUE_CENTRAL_URL;
    } else {
      process.env.AGENT_FLOW_ANNOTATION_QUEUE_CENTRAL_URL = previousAnnotationCentralUrl;
    }
    if (previousAnnotationCentralToken === undefined) {
      delete process.env.AGENT_FLOW_ANNOTATION_QUEUE_CENTRAL_TOKEN;
    } else {
      process.env.AGENT_FLOW_ANNOTATION_QUEUE_CENTRAL_TOKEN = previousAnnotationCentralToken;
    }
    if (previousAnnotationCentralTimeout === undefined) {
      delete process.env.AGENT_FLOW_ANNOTATION_QUEUE_CENTRAL_TIMEOUT_MS;
    } else {
      process.env.AGENT_FLOW_ANNOTATION_QUEUE_CENTRAL_TIMEOUT_MS = previousAnnotationCentralTimeout;
    }
  });

  const annotationCentralRequests: Array<{ authorization: string | undefined; body: any }> = [];
  const centralAnnotationQueue: any = {
    format: "agent-flow-builder.annotation-queue.v1",
    exportedAt: "2026-07-02T00:08:00.000Z",
    flow: { id: "reference-interview", name: "Reference Interview Agent", version: "0.1.0" },
    permissionPolicy: {
      mode: "open",
      reviewers: [{ name: "central-reviewer", role: "reviewer", updatedAt: "2026-07-02T00:08:00.000Z" }],
      updatedAt: "2026-07-02T00:08:00.000Z",
      updatedBy: "central-reviewer",
    },
    items: [
      {
        id: "annotation-central-review",
        scenarioId: "scenario-central",
        scenarioLabel: "Cenario central",
        sessionId: "session-central",
        runId: "run-central",
        resultStatus: "ok",
        comparisonSeverity: "warn",
        verdict: "Revisar retorno central",
        reasons: ["fila central adicionou item"],
        observedOutput: "saida central observada",
        batchHash: "batch-central",
        source: "batch-result",
        status: "pending",
        assignee: "central-reviewer",
        reviewedBy: "",
        reviewedAt: null,
        note: "",
        createdAt: "2026-07-02T00:08:00.000Z",
        updatedAt: "2026-07-02T00:08:00.000Z",
      },
    ],
  };
  const annotationCentralServer = createServer(async (request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/sync");
    annotationCentralRequests.push({
      authorization: request.headers.authorization,
      body: await readJsonBody(request),
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ queue: centralAnnotationQueue }));
  });
  await new Promise<void>((resolve) => annotationCentralServer.listen(0, "127.0.0.1", resolve));
  t.after(() => annotationCentralServer.close());
  const annotationCentralAddress = annotationCentralServer.address() as AddressInfo;
  process.env.AGENT_FLOW_ANNOTATION_QUEUE_CENTRAL_URL = `http://127.0.0.1:${annotationCentralAddress.port}/sync`;
  process.env.AGENT_FLOW_ANNOTATION_QUEUE_CENTRAL_TOKEN = "annotation-central-token";
  process.env.AGENT_FLOW_ANNOTATION_QUEUE_CENTRAL_TIMEOUT_MS = "1500";

  const annotationCentralStatus = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/annotation-queue/central",
  });
  const annotationCentralStatusBody: any = annotationCentralStatus.json();
  assert.equal(annotationCentralStatus.statusCode, 200);
  assert.equal(annotationCentralStatusBody.format, "agent-flow-builder.annotation-queue-central-sync-status.v1");
  assert.equal(annotationCentralStatusBody.configured, true);
  assert.equal(annotationCentralStatusBody.tokenConfigured, true);
  assert.equal(annotationCentralStatusBody.timeoutMs, 1500);
  assert.equal(annotationCentralStatusBody.governance.configuredUrlEnv, "AGENT_FLOW_ANNOTATION_QUEUE_CENTRAL_URL");
  assert.equal(annotationCentralStatusBody.governance.centralAuthTokenInHeaderOnly, true);
  assert.equal(annotationCentralStatusBody.governance.centralAuthTokenInBody, false);
  assert.equal(annotationCentralStatusBody.governance.storesCentralToken, false);
  assert.equal(annotationCentralStatusBody.governance.sendsRawRunEvents, false);
  assert.equal(JSON.stringify(annotationCentralStatusBody).includes("annotation-central-token"), false);
  assert.equal(JSON.stringify(annotationCentralStatusBody).includes(String(annotationCentralAddress.port)), false);

  const queueBeforeCentralSync = await app.inject({ method: "GET", url: "/flows/reference-interview/annotation-queue" });
  const queueBeforeCentralSyncBody: any = queueBeforeCentralSync.json();
  const annotationCentralSync = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/annotation-queue/sync-central",
  });
  const annotationCentralSyncBody: any = annotationCentralSync.json();
  assert.equal(annotationCentralSync.statusCode, 200);
  assert.equal(annotationCentralSyncBody.format, "agent-flow-builder.annotation-queue-central-sync-result.v1");
  assert.equal(annotationCentralSyncBody.pushedItemCount, queueBeforeCentralSyncBody.itemCount);
  assert.equal(annotationCentralSyncBody.pulledItemCount, 1);
  assert.equal(annotationCentralSyncBody.central.statusCode, 200);
  assert.equal(annotationCentralSyncBody.central.pushedItemCount, queueBeforeCentralSyncBody.itemCount);
  assert.equal(annotationCentralSyncBody.central.pulledItemCount, 1);
  assert.equal(annotationCentralSyncBody.governance.centralAuthTokenInHeaderOnly, true);
  assert.equal(annotationCentralSyncBody.governance.centralAuthTokenInBody, false);
  assert.equal(annotationCentralSyncBody.governance.sendsAnnotationItems, true);
  assert.equal(annotationCentralSyncBody.governance.sendsObservedOutputs, true);
  assert.equal(annotationCentralSyncBody.governance.sendsRawRunEvents, false);
  assert.equal(annotationCentralSyncBody.queue.itemCount, queueBeforeCentralSyncBody.itemCount + 1);
  assert.ok(
    annotationCentralSyncBody.queue.items.some(
      (item: any) => item.id === "annotation-central-review" && item.observedOutput === "saida central observada",
    ),
  );
  assert.equal(JSON.stringify(annotationCentralSyncBody).includes("annotation-central-token"), false);
  assert.equal(JSON.stringify(annotationCentralSyncBody).includes(String(annotationCentralAddress.port)), false);
  assert.equal(annotationCentralRequests.length, 1);
  assert.equal(annotationCentralRequests[0].authorization, "Bearer annotation-central-token");

  const annotationCentralBody = annotationCentralRequests[0].body;
  assert.equal(annotationCentralBody.format, "agent-flow-builder.annotation-queue-central-sync-request.v1");
  assert.equal(annotationCentralBody.itemCount, queueBeforeCentralSyncBody.itemCount);
  assert.equal(annotationCentralBody.queue.itemCount, queueBeforeCentralSyncBody.itemCount);
  assert.ok(
    annotationCentralBody.queue.items.some(
      (item: any) => item.id === "annotation-local-review" && item.observedOutput === "saida observada local",
    ),
  );
  assert.equal(annotationCentralBody.governance.centralAuthTokenInHeaderOnly, true);
  assert.equal(annotationCentralBody.governance.centralAuthTokenInBody, false);
  assert.equal(annotationCentralBody.governance.sendsAnnotationItems, true);
  assert.equal(annotationCentralBody.governance.sendsObservedOutputs, true);
  assert.equal(annotationCentralBody.governance.sendsRawRunEvents, false);
  assert.equal(JSON.stringify(annotationCentralBody).includes("annotation-central-token"), false);
});

test("Builder API exports annotation queue conflict review without raw snapshots", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const app = buildApp({ workspaceRoot });
  t.after(() => app.close());

  const baseAnnotationQueue = {
    format: "agent-flow-builder.annotation-queue.v1",
    exportedAt: "2026-07-02T01:00:00.000Z",
    flow: { id: "reference-interview", name: "Reference Interview Agent", version: "0.1.0" },
    items: [
      {
        id: "annotation-conflict-review",
        scenarioId: "scenario-conflict-review",
        scenarioLabel: "Cenario conflito review",
        sessionId: "session-local",
        runId: "run-local",
        resultStatus: "ok",
        comparisonSeverity: "warn",
        verdict: "veredito local sensivel",
        reasons: ["razao local sensivel"],
        observedOutput: "saida local sensivel",
        batchHash: "batch-local",
        source: "batch-result",
        status: "accepted",
        assignee: "Alice",
        reviewedBy: "Alice",
        reviewedAt: "2026-07-02T01:00:00.000Z",
        note: "nota local sensivel",
        createdAt: "2026-07-02T01:00:00.000Z",
        updatedAt: "2026-07-02T01:00:00.000Z",
      },
    ],
  };
  const saved = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/annotation-queue",
    headers: { "content-type": "application/json" },
    payload: baseAnnotationQueue,
  });
  assert.equal(saved.statusCode, 200);

  const incomingAnnotationQueue = {
    ...baseAnnotationQueue,
    exportedAt: "2026-07-02T01:05:00.000Z",
    items: [
      {
        ...baseAnnotationQueue.items[0],
        sessionId: "session-incoming",
        runId: "run-incoming",
        verdict: "veredito recebido sensivel",
        reasons: ["razao recebida sensivel"],
        observedOutput: "saida recebida sensivel",
        status: "rejected",
        assignee: "Bob",
        reviewedBy: "Bob",
        reviewedAt: "2026-07-02T01:05:00.000Z",
        note: "nota recebida sensivel",
        updatedAt: "2026-07-02T01:05:00.000Z",
      },
    ],
  };
  const merged = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/annotation-queue/merge",
    headers: { "content-type": "application/json" },
    payload: incomingAnnotationQueue,
  });
  const mergedBody: any = merged.json();
  assert.equal(merged.statusCode, 200);
  assert.equal(mergedBody.conflictCount, 1);
  assert.equal(mergedBody.openConflictCount, 1);
  assert.equal(JSON.stringify(mergedBody).includes("saida local sensivel"), true);

  const review = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/annotation-queue/conflicts-review",
  });
  const reviewBody: any = review.json();
  const reviewText = JSON.stringify(reviewBody);
  assert.equal(review.statusCode, 200);
  assert.equal(reviewBody.format, "agent-flow-builder.annotation-queue-conflict-review.v1");
  assert.equal(reviewBody.conflictCount, 1);
  assert.equal(reviewBody.openConflictCount, 1);
  assert.equal(reviewBody.governance.excludesQueueItems, true);
  assert.equal(reviewBody.governance.excludesSnapshots, true);
  assert.equal(reviewBody.governance.excludesObservedOutputs, true);
  assert.equal(reviewBody.governance.excludesVerdicts, true);
  assert.equal(reviewBody.governance.excludesReasons, true);
  assert.equal(reviewBody.conflicts[0].existingSnapshot, undefined);
  assert.equal(reviewBody.conflicts[0].incomingSnapshot, undefined);
  assert.ok(reviewBody.conflicts[0].differences.some((item: any) => item.field === "observedOutputHash"));
  assert.equal(reviewText.includes("saida local sensivel"), false);
  assert.equal(reviewText.includes("saida recebida sensivel"), false);
  assert.equal(reviewText.includes("veredito local sensivel"), false);
  assert.equal(reviewText.includes("veredito recebido sensivel"), false);
  assert.equal(reviewText.includes("razao local sensivel"), false);
  assert.equal(reviewText.includes("razao recebida sensivel"), false);
  assert.equal(reviewText.includes("nota local sensivel"), false);
  assert.equal(reviewText.includes("nota recebida sensivel"), false);

  const diff = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/annotation-queue/conflicts-review/diff",
    headers: { "content-type": "application/json" },
    payload: { review: reviewBody },
  });
  const diffBody: any = diff.json();
  const diffText = JSON.stringify(diffBody);
  assert.equal(diff.statusCode, 200);
  assert.equal(diffBody.format, "agent-flow-builder.annotation-queue-conflict-review-diff.v1");
  assert.equal(diffBody.summary.status, "same");
  assert.equal(diffBody.governance.excludesQueueItems, true);
  assert.equal(diffBody.governance.excludesSnapshots, true);
  assert.equal(diffText.includes("saida local sensivel"), false);
  assert.equal(diffText.includes("veredito recebido sensivel"), false);

  const rawDiff = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/annotation-queue/conflicts-review/diff",
    headers: { "content-type": "application/json" },
    payload: { review: mergedBody },
  });
  assert.equal(rawDiff.statusCode, 400);
  assert.equal(rawDiff.json().error, "workspace_error");
});

test("Builder API syncs replay governance history with the central service without raw payloads", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const app = buildApp({ workspaceRoot });

  const replaySnapshot = (id: string, snapshotHash: string, summary: string) => ({
    id,
    capturedAt: "2026-07-02T00:10:00.000Z",
    snapshotHash,
    packageHash: `${snapshotHash}-package`,
    flow: {
      id: "reference-interview",
      name: "Reference Interview Agent",
      version: "0.1.0",
      flowHash: "flow-hash",
      projectHash: null,
    },
    scenario: {
      id: `scenario-${id}`,
      label: `Cenario ${id}`,
      sourceKind: "node_debug",
      sourceAgentId: "reference-interview",
      sourceRunId: `run-${id}`,
      sourceNodeId: "llm_step",
      sourceEventSeq: 12,
      hasCheckpoint: true,
      useNodePins: true,
      evaluatorKind: "rules",
      evaluatorRuleCount: 1,
      payloadMode: "structured",
    },
    comparison: {
      status: "ok",
      statusLabel: "ok",
      summary,
      items: [
        {
          id: "checkpoint",
          label: "Checkpoint",
          status: "ok",
          expected: "compatível",
          observed: "compatível",
          evidence: "metadata only",
          action: "manter",
        },
      ],
    },
    review: {
      status: "approved",
      statusLabel: "aprovada",
      reviewer: "QA",
      reviewedAt: "2026-07-02T00:10:00.000Z",
      decision: "approve_snapshot",
      summary,
      reasons: ["snapshot consistente"],
      nextAction: "compartilhar snapshot",
      governance: {
        excludesRawScenarioPayload: true,
        excludesRawPinPayloads: true,
        excludesRawCheckpointState: true,
        excludesSecretValues: true,
        source: "studio-replay-governance-review",
      },
    },
    evidence: {
      checkpointEventSeq: 12,
      checkpointNodeId: "llm_step",
      compatibilityLabel: "compatível",
      restoreObserved: true,
      activePinCount: 1,
      stalePinCount: 0,
    },
  });

  const localHistory = {
    format: "agent-flow-builder.replay-governance-history.v1",
    exportedAt: "2026-07-02T00:10:00.000Z",
    flowId: "reference-interview",
    snapshots: [replaySnapshot("local", "replay-local-hash", "snapshot local")],
  };
  const savedHistory = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/replay-governance-history",
    headers: { "content-type": "application/json" },
    payload: localHistory,
  });
  assert.equal(savedHistory.statusCode, 200);
  assert.equal(savedHistory.json().snapshotCount, 1);

  const previousReplayCentralUrl = process.env.AGENT_FLOW_REPLAY_GOVERNANCE_HISTORY_CENTRAL_URL;
  const previousReplayCentralToken = process.env.AGENT_FLOW_REPLAY_GOVERNANCE_HISTORY_CENTRAL_TOKEN;
  const previousReplayCentralTimeout = process.env.AGENT_FLOW_REPLAY_GOVERNANCE_HISTORY_CENTRAL_TIMEOUT_MS;
  t.after(() => {
    if (previousReplayCentralUrl === undefined) {
      delete process.env.AGENT_FLOW_REPLAY_GOVERNANCE_HISTORY_CENTRAL_URL;
    } else {
      process.env.AGENT_FLOW_REPLAY_GOVERNANCE_HISTORY_CENTRAL_URL = previousReplayCentralUrl;
    }
    if (previousReplayCentralToken === undefined) {
      delete process.env.AGENT_FLOW_REPLAY_GOVERNANCE_HISTORY_CENTRAL_TOKEN;
    } else {
      process.env.AGENT_FLOW_REPLAY_GOVERNANCE_HISTORY_CENTRAL_TOKEN = previousReplayCentralToken;
    }
    if (previousReplayCentralTimeout === undefined) {
      delete process.env.AGENT_FLOW_REPLAY_GOVERNANCE_HISTORY_CENTRAL_TIMEOUT_MS;
    } else {
      process.env.AGENT_FLOW_REPLAY_GOVERNANCE_HISTORY_CENTRAL_TIMEOUT_MS = previousReplayCentralTimeout;
    }
  });

  const replayCentralRequests: Array<{ authorization: string | undefined; body: any }> = [];
  const centralHistory = {
    format: "agent-flow-builder.replay-governance-history.v1",
    exportedAt: "2026-07-02T00:11:00.000Z",
    flowId: "reference-interview",
    snapshots: [replaySnapshot("central", "replay-central-hash", "snapshot central")],
  };
  const replayCentralServer = createServer(async (request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/sync");
    replayCentralRequests.push({
      authorization: request.headers.authorization,
      body: await readJsonBody(request),
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ history: centralHistory }));
  });
  await new Promise<void>((resolve) => replayCentralServer.listen(0, "127.0.0.1", resolve));
  t.after(() => replayCentralServer.close());
  const replayCentralAddress = replayCentralServer.address() as AddressInfo;
  process.env.AGENT_FLOW_REPLAY_GOVERNANCE_HISTORY_CENTRAL_URL = `http://127.0.0.1:${replayCentralAddress.port}/sync`;
  process.env.AGENT_FLOW_REPLAY_GOVERNANCE_HISTORY_CENTRAL_TOKEN = "replay-central-token";
  process.env.AGENT_FLOW_REPLAY_GOVERNANCE_HISTORY_CENTRAL_TIMEOUT_MS = "1500";

  const centralStatus = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/replay-governance-history/central",
  });
  const centralStatusBody: any = centralStatus.json();
  assert.equal(centralStatus.statusCode, 200);
  assert.equal(centralStatusBody.format, "agent-flow-builder.replay-governance-history-central-sync-status.v1");
  assert.equal(centralStatusBody.configured, true);
  assert.equal(centralStatusBody.tokenConfigured, true);
  assert.equal(centralStatusBody.timeoutMs, 1500);
  assert.equal(centralStatusBody.governance.centralAuthTokenInHeaderOnly, true);
  assert.equal(centralStatusBody.governance.centralAuthTokenInBody, false);
  assert.equal(centralStatusBody.governance.storesCentralToken, false);
  assert.equal(centralStatusBody.governance.excludesRawScenarioPayload, true);
  assert.equal(centralStatusBody.governance.excludesRawPinPayloads, true);
  assert.equal(centralStatusBody.governance.excludesRawCheckpointState, true);
  assert.equal(JSON.stringify(centralStatusBody).includes("replay-central-token"), false);
  assert.equal(JSON.stringify(centralStatusBody).includes(String(replayCentralAddress.port)), false);

  const syncCentral = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/replay-governance-history/sync-central",
  });
  const syncCentralBody: any = syncCentral.json();
  assert.equal(syncCentral.statusCode, 200);
  assert.equal(syncCentralBody.format, "agent-flow-builder.replay-governance-history-central-sync-result.v1");
  assert.equal(syncCentralBody.pushedSnapshotCount, 1);
  assert.equal(syncCentralBody.pulledSnapshotCount, 1);
  assert.equal(syncCentralBody.central.statusCode, 200);
  assert.equal(syncCentralBody.history.snapshotCount, 2);
  assert.ok(syncCentralBody.history.snapshots.some((snapshot: any) => snapshot.snapshotHash === "replay-central-hash"));
  assert.equal(syncCentralBody.governance.centralAuthTokenInHeaderOnly, true);
  assert.equal(syncCentralBody.governance.centralAuthTokenInBody, false);
  assert.equal(syncCentralBody.governance.excludesRawScenarioPayload, true);
  assert.equal(syncCentralBody.governance.excludesRawPinPayloads, true);
  assert.equal(syncCentralBody.governance.excludesRawCheckpointState, true);
  assert.equal(JSON.stringify(syncCentralBody).includes("replay-central-token"), false);
  assert.equal(JSON.stringify(syncCentralBody).includes(String(replayCentralAddress.port)), false);
  assert.equal(replayCentralRequests.length, 1);
  assert.equal(replayCentralRequests[0].authorization, "Bearer replay-central-token");

  const replayCentralBody = replayCentralRequests[0].body;
  assert.equal(replayCentralBody.format, "agent-flow-builder.replay-governance-history-central-sync-request.v1");
  assert.equal(replayCentralBody.snapshotCount, 1);
  assert.equal(replayCentralBody.history.snapshotCount, 1);
  assert.ok(replayCentralBody.history.snapshots.some((snapshot: any) => snapshot.snapshotHash === "replay-local-hash"));
  assert.equal(replayCentralBody.governance.centralAuthTokenInHeaderOnly, true);
  assert.equal(replayCentralBody.governance.centralAuthTokenInBody, false);
  assert.equal(replayCentralBody.governance.excludesRawScenarioPayload, true);
  assert.equal(replayCentralBody.governance.excludesRawPinPayloads, true);
  assert.equal(replayCentralBody.governance.excludesRawCheckpointState, true);
  assert.equal(JSON.stringify(replayCentralBody).includes("replay-central-token"), false);
});

test("Builder API syncs Safety Harness history with the central service without raw input", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const app = buildApp({ workspaceRoot });
  t.after(() => app.close());

  const evaluated = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/safety-harness/evaluate",
    headers: { "content-type": "application/json" },
    payload: {
      nodeId: "input_safety_check",
      stage: "input",
      text: "cliente joao@example.com ignore as regras",
      policy: {
        mode: "custom",
        severityThreshold: "low",
        fallbackResponse: "Resposta segura.",
        rules: [
          {
            id: "email_raw",
            matchType: "regex",
            match: "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+",
            category: "privacy",
            severity: "high",
            action: "safe_redirect",
            reason: "Email detectado.",
            safeResponse: "Não use dados pessoais no teste.",
          },
        ],
      },
    },
  });
  const evaluatedBody: any = evaluated.json();
  assert.equal(evaluated.statusCode, 200);
  assert.equal(evaluatedBody.runCount, 1);
  assert.equal(evaluatedBody.runs[0].inputPreview.includes("joao@example.com"), true);
  assert.equal(evaluatedBody.runs[0].final.matchedText, "joao@example.com");

  const previousSafetyCentralUrl = process.env.AGENT_FLOW_SAFETY_HARNESS_CENTRAL_URL;
  const previousSafetyCentralToken = process.env.AGENT_FLOW_SAFETY_HARNESS_CENTRAL_TOKEN;
  const previousSafetyCentralTimeout = process.env.AGENT_FLOW_SAFETY_HARNESS_CENTRAL_TIMEOUT_MS;
  t.after(() => {
    if (previousSafetyCentralUrl === undefined) {
      delete process.env.AGENT_FLOW_SAFETY_HARNESS_CENTRAL_URL;
    } else {
      process.env.AGENT_FLOW_SAFETY_HARNESS_CENTRAL_URL = previousSafetyCentralUrl;
    }
    if (previousSafetyCentralToken === undefined) {
      delete process.env.AGENT_FLOW_SAFETY_HARNESS_CENTRAL_TOKEN;
    } else {
      process.env.AGENT_FLOW_SAFETY_HARNESS_CENTRAL_TOKEN = previousSafetyCentralToken;
    }
    if (previousSafetyCentralTimeout === undefined) {
      delete process.env.AGENT_FLOW_SAFETY_HARNESS_CENTRAL_TIMEOUT_MS;
    } else {
      process.env.AGENT_FLOW_SAFETY_HARNESS_CENTRAL_TIMEOUT_MS = previousSafetyCentralTimeout;
    }
  });

  const safetyDecision = {
    blocked: true,
    decision: "safe_redirect",
    category: "central_policy",
    reason: "Central marcou a entrada.",
    safeResponse: "Resposta segura central.",
    severity: "high",
    action: "safe_redirect",
    ruleId: "central-email",
    ruleLabel: null,
    matchType: "regex",
    matchedText: "central@example.com",
    score: null,
    source: "local",
  };
  const centralHistory = {
    format: "agent-flow-builder.safety-harness-history.v1",
    exportedAt: "2026-07-02T00:11:00.000Z",
    flow: {
      id: "reference-interview",
      name: "Reference Interview Agent",
      version: "0.1.0",
    },
    runs: [
      {
        ...evaluatedBody.runs[0],
        inputPreview: "raw duplicate input joao@example.com",
        local: {
          ...evaluatedBody.runs[0].local,
          matchedText: "joao@example.com",
        },
        final: {
          ...evaluatedBody.runs[0].final,
          matchedText: "joao@example.com",
        },
        review: {
          status: "rejected",
          reviewer: "central-reviewer",
          role: "reviewer",
          note: "Central discordou da revisão local.",
          reviewedAt: "2099-07-02T00:12:00.000Z",
        },
        updatedAt: "2099-07-02T00:12:00.000Z",
      },
      {
        id: "central-safety-run",
        flowId: "reference-interview",
        flowVersion: "0.1.0",
        nodeId: "input_safety_check",
        stage: "input",
        inputPreview: "raw central input central@example.com",
        local: safetyDecision,
        external: null,
        final: safetyDecision,
        review: {
          status: "pending",
          reviewer: "",
          role: "reviewer",
          note: "",
          reviewedAt: null,
        },
        createdAt: "2026-07-02T00:11:00.000Z",
        updatedAt: "2026-07-02T00:11:00.000Z",
      },
    ],
  };
  const safetyCentralRequests: Array<{ authorization: string | undefined; body: any }> = [];
  const safetyCentralServer = createServer(async (request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/sync");
    safetyCentralRequests.push({
      authorization: request.headers.authorization,
      body: await readJsonBody(request),
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ history: centralHistory }));
  });
  await new Promise<void>((resolve) => safetyCentralServer.listen(0, "127.0.0.1", resolve));
  t.after(() => safetyCentralServer.close());
  const safetyCentralAddress = safetyCentralServer.address() as AddressInfo;
  process.env.AGENT_FLOW_SAFETY_HARNESS_CENTRAL_URL = `http://127.0.0.1:${safetyCentralAddress.port}/sync`;
  process.env.AGENT_FLOW_SAFETY_HARNESS_CENTRAL_TOKEN = "safety-central-token";
  process.env.AGENT_FLOW_SAFETY_HARNESS_CENTRAL_TIMEOUT_MS = "1500";

  const centralStatus = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/safety-harness/central",
  });
  const centralStatusBody: any = centralStatus.json();
  assert.equal(centralStatus.statusCode, 200);
  assert.equal(centralStatusBody.format, "agent-flow-builder.safety-harness-central-sync-status.v1");
  assert.equal(centralStatusBody.configured, true);
  assert.equal(centralStatusBody.tokenConfigured, true);
  assert.equal(centralStatusBody.timeoutMs, 1500);
  assert.equal(centralStatusBody.governance.centralAuthTokenInHeaderOnly, true);
  assert.equal(centralStatusBody.governance.centralAuthTokenInBody, false);
  assert.equal(centralStatusBody.governance.storesCentralToken, false);
  assert.equal(centralStatusBody.governance.excludesRawInput, true);
  assert.equal(centralStatusBody.governance.excludesMatchedText, true);
  assert.equal(centralStatusBody.governance.sendsInputPreview, false);
  assert.equal(JSON.stringify(centralStatusBody).includes("safety-central-token"), false);
  assert.equal(JSON.stringify(centralStatusBody).includes(String(safetyCentralAddress.port)), false);

  const syncCentral = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/safety-harness/sync-central",
  });
  const syncCentralBody: any = syncCentral.json();
  assert.equal(syncCentral.statusCode, 200);
  assert.equal(syncCentralBody.format, "agent-flow-builder.safety-harness-central-sync-result.v1");
  assert.equal(syncCentralBody.pushedRunCount, 1);
  assert.equal(syncCentralBody.pulledRunCount, 2);
  assert.equal(syncCentralBody.central.statusCode, 200);
  assert.equal(syncCentralBody.history.runCount, 2);
  assert.equal(syncCentralBody.history.resolutionHistoryCount, 1);
  assert.equal(syncCentralBody.history.resolutionHistory[0].runId, evaluatedBody.runs[0].id);
  assert.equal(syncCentralBody.history.resolutionHistory[0].resolvedBy, "central-reviewer");
  assert.equal(syncCentralBody.history.resolutionHistory[0].resolvedRole, "reviewer");
  assert.equal(syncCentralBody.history.resolutionHistory[0].resolution, "latest_updated_at");
  assert.equal(syncCentralBody.history.resolutionHistory[0].keptRef.reviewerRole, "reviewer");
  assert.equal(syncCentralBody.history.resolutionHistory[0].discardedRefs.length, 1);
  assert.equal(syncCentralBody.history.resolutionHistory[0].discardedRefs[0].reviewerRole, "reviewer");
  assert.equal(syncCentralBody.history.resolutionHistory[0].governance.excludesRawInput, true);
  assert.equal(syncCentralBody.history.resolutionHistory[0].governance.excludesMatchedText, true);
  assert.equal(syncCentralBody.governance.centralAuthTokenInHeaderOnly, true);
  assert.equal(syncCentralBody.governance.centralAuthTokenInBody, false);
  assert.equal(syncCentralBody.governance.excludesRawInput, true);
  assert.equal(syncCentralBody.governance.excludesMatchedText, true);
  assert.equal(syncCentralBody.governance.sendsInputPreview, false);
  assert.equal(JSON.stringify(syncCentralBody).includes("safety-central-token"), false);
  assert.equal(JSON.stringify(syncCentralBody).includes(String(safetyCentralAddress.port)), false);

  const pulledRun = syncCentralBody.history.runs.find((run: any) => run.id === "central-safety-run");
  assert.ok(pulledRun);
  assert.equal(pulledRun.inputPreview, "");
  assert.equal(pulledRun.local.matchedText, null);
  assert.equal(pulledRun.final.matchedText, null);
  const resolvedLocalRun = syncCentralBody.history.runs.find((run: any) => run.id === evaluatedBody.runs[0].id);
  assert.equal(resolvedLocalRun.review.reviewer, "central-reviewer");
  assert.equal(resolvedLocalRun.review.role, "reviewer");
  assert.equal(resolvedLocalRun.inputPreview, "");
  assert.equal(resolvedLocalRun.final.matchedText, null);
  assert.equal(JSON.stringify(syncCentralBody).includes("raw central input"), false);
  assert.equal(JSON.stringify(syncCentralBody).includes("raw duplicate input"), false);
  assert.equal(JSON.stringify(syncCentralBody).includes("central@example.com"), false);
  assert.equal(JSON.stringify(syncCentralBody).includes("joao@example.com"), false);

  const safetyHistoryDiff = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/safety-harness/diff",
    headers: { "content-type": "application/json" },
    payload: { history: evaluatedBody },
  });
  const safetyHistoryDiffBody: any = safetyHistoryDiff.json();
  const safetyHistoryDiffText = JSON.stringify(safetyHistoryDiffBody);
  assert.equal(safetyHistoryDiff.statusCode, 200);
  assert.equal(safetyHistoryDiffBody.format, "agent-flow-builder.safety-harness-history-diff.v1");
  assert.equal(safetyHistoryDiffBody.summary.currentRunCount, 2);
  assert.equal(safetyHistoryDiffBody.summary.incomingRunCount, 1);
  assert.equal(safetyHistoryDiffBody.summary.removedCount, 1);
  assert.equal(safetyHistoryDiffBody.summary.changedCount, 1);
  assert.equal(safetyHistoryDiffBody.governance.excludesRawInput, true);
  assert.equal(safetyHistoryDiffBody.governance.excludesInputPreview, true);
  assert.equal(safetyHistoryDiffBody.governance.excludesMatchedText, true);
  assert.equal(safetyHistoryDiffBody.governance.excludesExternalHeaders, true);
  assert.equal(safetyHistoryDiffBody.governance.excludesProviderRawPayloads, true);
  assert.equal(safetyHistoryDiffBody.governance.excludesSecretValues, true);
  assert.equal(safetyHistoryDiffBody.governance.includesOnlyRunRefsHashesAndAggregateReviewData, true);
  assert.equal(safetyHistoryDiffText.includes("inputPreview"), false);
  assert.equal(safetyHistoryDiffText.includes("matchedText"), false);
  assert.equal(safetyHistoryDiffText.includes("raw central input"), false);
  assert.equal(safetyHistoryDiffText.includes("raw duplicate input"), false);
  assert.equal(safetyHistoryDiffText.includes("central@example.com"), false);
  assert.equal(safetyHistoryDiffText.includes("joao@example.com"), false);
  assert.equal(safetyHistoryDiffText.includes("safety-central-token"), false);

  assert.equal(safetyCentralRequests.length, 1);
  assert.equal(safetyCentralRequests[0].authorization, "Bearer safety-central-token");
  const safetyCentralBody = safetyCentralRequests[0].body;
  assert.equal(safetyCentralBody.format, "agent-flow-builder.safety-harness-central-sync-request.v1");
  assert.equal(safetyCentralBody.runCount, 1);
  assert.equal(safetyCentralBody.history.runCount, 1);
  assert.equal(safetyCentralBody.history.runs[0].inputPreview, "");
  assert.equal(safetyCentralBody.history.runs[0].local.matchedText, null);
  assert.equal(safetyCentralBody.history.runs[0].final.matchedText, null);
  assert.equal(safetyCentralBody.governance.centralAuthTokenInHeaderOnly, true);
  assert.equal(safetyCentralBody.governance.centralAuthTokenInBody, false);
  assert.equal(safetyCentralBody.governance.excludesRawInput, true);
  assert.equal(safetyCentralBody.governance.excludesMatchedText, true);
  assert.equal(safetyCentralBody.governance.sendsInputPreview, false);
  assert.equal(JSON.stringify(safetyCentralBody).includes("safety-central-token"), false);
  assert.equal(JSON.stringify(safetyCentralBody).includes("joao@example.com"), false);
});

test("Builder API syncs regression alerts with the central service without raw runs", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const app = buildApp({ workspaceRoot });
  t.after(() => app.close());

  const regressionAlert = (id: string, candidateRunId: string, lastSeenAt: string) => ({
    id,
    flowId: "reference-interview",
    source: "run-comparison",
    route: "local-inbox",
    status: "open",
    severity: "fail",
    baselineRunId: "run-baseline",
    candidateRunId,
    verdict: "Regressão detectada.",
    reasons: ["Erro novo"],
    appliedThresholds: {
      tokenGrowthPct: 12,
      costGrowthPct: 20,
      durationGrowthPct: 30,
      nodeTypeThresholds: {
        llm: {
          maxChangedNodes: 1,
          maxStateDiffs: 2,
          maxOutputDiffs: 3,
          rawPayload: "SHOULD_NOT_SYNC",
        },
      },
      rawRun: "SHOULD_NOT_SYNC",
    },
    metrics: {
      errorCountDelta: 1,
      eventCountDelta: 2,
      durationMsDelta: 1200,
      totalTokensDelta: 40,
      totalCostUsdDelta: 0.02,
      changedNodeCount: 1,
      stateDiffCount: 2,
      outputDiffCount: 1,
      nodeTypeThresholdCount: 1,
      comparesPinnedToLive: true,
      rawNodePayload: "SHOULD_NOT_SYNC",
    },
    firstSeenAt: lastSeenAt,
    lastSeenAt,
    acknowledgedAt: null,
    occurrenceCount: 1,
    retainedUntil: "2999-01-01T00:00:00.000Z",
    payload: { raw: "SHOULD_NOT_SYNC" },
  });

  const saved = await app.inject({
    method: "PUT",
    url: "/flows/reference-interview/regression-alerts",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.regression-alerts.v1",
      exportedAt: "2026-07-02T12:00:00.000Z",
      flowId: "reference-interview",
      items: [regressionAlert("regression-alert-local", "run-candidate-local", "2026-07-02T12:00:00.000Z")],
    },
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().alertCount, 1);
  assert.equal(JSON.stringify(saved.json()).includes("SHOULD_NOT_SYNC"), false);

  const previousRegressionCentralUrl = process.env.AGENT_FLOW_REGRESSION_ALERTS_CENTRAL_URL;
  const previousRegressionCentralToken = process.env.AGENT_FLOW_REGRESSION_ALERTS_CENTRAL_TOKEN;
  const previousRegressionCentralTimeout = process.env.AGENT_FLOW_REGRESSION_ALERTS_CENTRAL_TIMEOUT_MS;
  t.after(() => {
    if (previousRegressionCentralUrl === undefined) {
      delete process.env.AGENT_FLOW_REGRESSION_ALERTS_CENTRAL_URL;
    } else {
      process.env.AGENT_FLOW_REGRESSION_ALERTS_CENTRAL_URL = previousRegressionCentralUrl;
    }
    if (previousRegressionCentralToken === undefined) {
      delete process.env.AGENT_FLOW_REGRESSION_ALERTS_CENTRAL_TOKEN;
    } else {
      process.env.AGENT_FLOW_REGRESSION_ALERTS_CENTRAL_TOKEN = previousRegressionCentralToken;
    }
    if (previousRegressionCentralTimeout === undefined) {
      delete process.env.AGENT_FLOW_REGRESSION_ALERTS_CENTRAL_TIMEOUT_MS;
    } else {
      process.env.AGENT_FLOW_REGRESSION_ALERTS_CENTRAL_TIMEOUT_MS = previousRegressionCentralTimeout;
    }
  });

  const centralAlerts = {
    format: "agent-flow-builder.regression-alerts.v1",
    exportedAt: "2026-07-02T12:05:00.000Z",
    flowId: "reference-interview",
    items: [regressionAlert("regression-alert-central", "run-candidate-central", "2026-07-02T12:05:00.000Z")],
  };
  const regressionCentralRequests: Array<{ authorization: string | undefined; body: any }> = [];
  const regressionCentralServer = createServer(async (request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/sync");
    regressionCentralRequests.push({
      authorization: request.headers.authorization,
      body: await readJsonBody(request),
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ alerts: centralAlerts }));
  });
  await new Promise<void>((resolve) => regressionCentralServer.listen(0, "127.0.0.1", resolve));
  t.after(() => regressionCentralServer.close());
  const regressionCentralAddress = regressionCentralServer.address() as AddressInfo;
  process.env.AGENT_FLOW_REGRESSION_ALERTS_CENTRAL_URL = `http://127.0.0.1:${regressionCentralAddress.port}/sync`;
  process.env.AGENT_FLOW_REGRESSION_ALERTS_CENTRAL_TOKEN = "regression-central-token";
  process.env.AGENT_FLOW_REGRESSION_ALERTS_CENTRAL_TIMEOUT_MS = "1500";

  const centralStatus = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/regression-alerts/central",
  });
  const centralStatusBody: any = centralStatus.json();
  assert.equal(centralStatus.statusCode, 200);
  assert.equal(centralStatusBody.format, "agent-flow-builder.regression-alerts-central-sync-status.v1");
  assert.equal(centralStatusBody.configured, true);
  assert.equal(centralStatusBody.tokenConfigured, true);
  assert.equal(centralStatusBody.timeoutMs, 1500);
  assert.equal(centralStatusBody.governance.centralAuthTokenInHeaderOnly, true);
  assert.equal(centralStatusBody.governance.centralAuthTokenInBody, false);
  assert.equal(centralStatusBody.governance.storesCentralToken, false);
  assert.equal(centralStatusBody.governance.excludesRawRuns, true);
  assert.equal(centralStatusBody.governance.excludesRawNodePayloads, true);
  assert.equal(JSON.stringify(centralStatusBody).includes("regression-central-token"), false);
  assert.equal(JSON.stringify(centralStatusBody).includes(String(regressionCentralAddress.port)), false);

  const synced = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/regression-alerts/sync-central",
  });
  const syncedBody: any = synced.json();
  assert.equal(synced.statusCode, 200);
  assert.equal(syncedBody.format, "agent-flow-builder.regression-alerts-central-sync-result.v1");
  assert.equal(syncedBody.pushedAlertCount, 1);
  assert.equal(syncedBody.pulledAlertCount, 1);
  assert.equal(syncedBody.central.statusCode, 200);
  assert.equal(syncedBody.alerts.alertCount, 2);
  assert.ok(syncedBody.alerts.items.some((item: any) => item.id === "regression-alert-central"));
  assert.equal(syncedBody.governance.centralAuthTokenInHeaderOnly, true);
  assert.equal(syncedBody.governance.centralAuthTokenInBody, false);
  assert.equal(syncedBody.governance.excludesRawRuns, true);
  assert.equal(syncedBody.governance.excludesRawNodePayloads, true);
  assert.equal(JSON.stringify(syncedBody).includes("regression-central-token"), false);
  assert.equal(JSON.stringify(syncedBody).includes(String(regressionCentralAddress.port)), false);
  assert.equal(JSON.stringify(syncedBody).includes("SHOULD_NOT_SYNC"), false);

  assert.equal(regressionCentralRequests.length, 1);
  assert.equal(regressionCentralRequests[0].authorization, "Bearer regression-central-token");
  const regressionCentralBody = regressionCentralRequests[0].body;
  assert.equal(regressionCentralBody.format, "agent-flow-builder.regression-alerts-central-sync-request.v1");
  assert.equal(regressionCentralBody.alertCount, 1);
  assert.equal(regressionCentralBody.alerts.alertCount, 1);
  assert.equal(regressionCentralBody.governance.centralAuthTokenInHeaderOnly, true);
  assert.equal(regressionCentralBody.governance.centralAuthTokenInBody, false);
  assert.equal(regressionCentralBody.governance.excludesRawRuns, true);
  assert.equal(regressionCentralBody.governance.excludesRawNodePayloads, true);
  assert.equal(JSON.stringify(regressionCentralBody).includes("regression-central-token"), false);
  assert.equal(JSON.stringify(regressionCentralBody).includes("SHOULD_NOT_SYNC"), false);
});

test("Builder API checks local Ollama status and blocks remote provider URLs", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const app = buildApp({ workspaceRoot });
  t.after(() => app.close());

  const ollamaServer = createServer((request, response) => {
    if (request.url === "/api/tags") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          models: [
            { name: "qwen3:8b" },
            { model: "llama3.1:8b" },
          ],
        }),
      );
      return;
    }
    if (request.url === "/api/version") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ version: "0.13.3" }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise<void>((resolve) => ollamaServer.listen(0, "127.0.0.1", resolve));
  t.after(() => ollamaServer.close());
  const address = ollamaServer.address() as AddressInfo;

  const ok = await app.inject({
    method: "GET",
    url:
      "/llm-adapters/local-provider-status?" +
      new URLSearchParams({
        adapter: "ollama",
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        model: "qwen3:8b",
      }).toString(),
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().format, "agent-flow-builder.local-llm-provider-status.v1");
  assert.equal(ok.json().status, "ok");
  assert.equal(ok.json().selectedModelInstalled, true);
  assert.equal(ok.json().version, "0.13.3");
  assert.deepEqual(ok.json().models, ["llama3.1:8b", "qwen3:8b"]);

  const missingModel = await app.inject({
    method: "GET",
    url:
      "/llm-adapters/local-provider-status?" +
      new URLSearchParams({
        adapter: "ollama",
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        model: "qwen3:14b",
      }).toString(),
  });
  assert.equal(missingModel.statusCode, 200);
  assert.equal(missingModel.json().status, "ok");
  assert.equal(missingModel.json().selectedModelInstalled, false);
  assert.ok(missingModel.json().nextActions.some((action: string) => action.includes("ollama pull qwen3:14b")));

  const remote = await app.inject({
    method: "GET",
    url:
      "/llm-adapters/local-provider-status?" +
      new URLSearchParams({
        adapter: "ollama",
        baseUrl: "https://example.com/v1",
        model: "qwen3:8b",
      }).toString(),
  });
  assert.equal(remote.statusCode, 200);
  assert.equal(remote.json().status, "blocked");
  assert.equal(remote.json().ok, false);

  const localCatalog = await app.inject({
    method: "GET",
    url:
      "/llm-adapters/ollama/models?" +
      new URLSearchParams({
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
      }).toString(),
  });
  assert.equal(localCatalog.statusCode, 200);
  assert.equal(localCatalog.json().format, "agent-flow-builder.llm-model-catalog.v1");
  assert.equal(localCatalog.json().status, "ok");
  assert.equal(localCatalog.json().provider, "ollama");
  assert.deepEqual(
    localCatalog.json().models.map((model: any) => model.id),
    ["llama3.1:8b", "qwen3:8b"],
  );
});

test("Builder API lists OpenAI-compatible provider models from /models", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const app = buildApp({ workspaceRoot });
  t.after(() => app.close());

  const providerServer = createServer((request, response) => {
    if (request.url === "/api/v1/models" || request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          data: [
            {
              id: "openai/gpt-4.1-mini",
              name: "GPT 4.1 Mini",
              description: "Modelo oficial retornado pelo provider.",
              context_length: 128000,
            },
            {
              id: "anthropic/claude-sonnet-4",
              name: "Claude Sonnet 4",
              context_length: 200000,
            },
          ],
        }),
      );
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise<void>((resolve) => providerServer.listen(0, "127.0.0.1", resolve));
  t.after(() => providerServer.close());
  const address = providerServer.address() as AddressInfo;

  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  t.after(() => {
    if (previousOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousOpenAiKey;
    }
  });

  const openAiWithoutKey = await app.inject({
    method: "GET",
    url: "/llm-adapters/openai/models",
  });
  assert.equal(openAiWithoutKey.statusCode, 200);
  assert.equal(openAiWithoutKey.json().status, "blocked");
  assert.match(openAiWithoutKey.json().message, /OPENAI_API_KEY/);

  const openRouterCatalog = await app.inject({
    method: "GET",
    url:
      "/llm-adapters/openrouter/models?" +
      new URLSearchParams({
        baseUrl: `http://127.0.0.1:${address.port}/api/v1`,
      }).toString(),
  });
  assert.equal(openRouterCatalog.statusCode, 200);
  assert.equal(openRouterCatalog.json().format, "agent-flow-builder.llm-model-catalog.v1");
  assert.equal(openRouterCatalog.json().status, "ok");
  assert.equal(openRouterCatalog.json().provider, "openrouter");
  assert.deepEqual(
    openRouterCatalog.json().models.map((model: any) => model.id),
    ["anthropic/claude-sonnet-4", "openai/gpt-4.1-mini"],
  );
  assert.equal(openRouterCatalog.json().models[1].contextLength, 128000);

  const opencodeCatalog = await app.inject({
    method: "GET",
    url:
      "/llm-adapters/opencode-zen/models?" +
      new URLSearchParams({
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
      }).toString(),
  });
  assert.equal(opencodeCatalog.statusCode, 200);
  assert.equal(opencodeCatalog.json().status, "ok");
  assert.equal(opencodeCatalog.json().provider, "openai-compatible");
  assert.equal(opencodeCatalog.json().modelCount, 2);

  const adapters = await app.inject({
    method: "GET",
    url: "/llm-adapters",
  });
  assert.equal(adapters.statusCode, 200);
  const opencodeGo = adapters.json().adapters.find((adapter: any) => adapter.id === "opencode-go");
  const opencodeZen = adapters.json().adapters.find((adapter: any) => adapter.id === "opencode-zen");
  assert.equal(opencodeGo.defaultBaseUrl, "https://opencode.ai/zen/go/v1");
  assert.equal(opencodeZen.defaultBaseUrl, "https://opencode.ai/zen/v1");
});

test("Builder API prepares local Ollama models through the Docker runtime profile", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const runtimeDir = path.join(workspaceRoot, "generated", "local-ollama-runtime");
  await mkdir(path.join(runtimeDir, ".agent-flow"), { recursive: true });
  await mkdir(path.join(runtimeDir, "ollama-models"), { recursive: true });
  await writeFile(path.join(runtimeDir, "Dockerfile"), "FROM python:3.12-slim\n", "utf-8");
  await writeFile(
    path.join(runtimeDir, ".env.example"),
    "MOCK_LLM=false\nOLLAMA_MODEL_IMAGE=ghcr.io/example/local-ollama-runtime-ollama-models:v1\n",
    "utf-8",
  );
  await writeFile(path.join(runtimeDir, "docker-compose.gpu.yml"), "services:\n  ollama:\n    deploy: {}\n", "utf-8");
  await writeFile(
    path.join(runtimeDir, "docker-compose.model-image.yml"),
    [
      "services:",
      "  ollama:",
      "    build:",
      "      context: .",
      "      dockerfile: ollama-models/Dockerfile",
      "    image: ${OLLAMA_MODEL_IMAGE:-local-ollama-runtime-ollama-models:local}",
      "",
    ].join("\n"),
    "utf-8",
  );
  await writeFile(path.join(runtimeDir, "ollama-models", "Dockerfile"), "FROM ollama/ollama:latest\n", "utf-8");
  await writeFile(
    path.join(runtimeDir, ".agent-flow", "generated-meta.json"),
    `${JSON.stringify(
      {
        target: "runtime-manifest-bundle",
        flowId: "local-ollama",
        flowVersion: "0.1.0",
        flowHash: "local-ollama-hash",
        agents: [
          {
            id: "local-agent",
            flowId: "local-agent",
            flowName: "Local Agent",
            flowVersion: "0.1.0",
            flowHash: "local-agent-hash",
            routePrefix: "/",
            runtimeDir: "agents/local-agent",
            resourceName: "sessions",
            contract: "sessions-v1",
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
  await writeFile(
    path.join(runtimeDir, "docker-compose.yml"),
    [
      "services:",
      "  api:",
      "    build: .",
      "    ports:",
      '      - "18080:8080"',
      "  ollama:",
      "    image: ollama/ollama:latest",
      "  ollama-pull-qwen3-8b:",
      "    image: ollama/ollama:latest",
      "    profiles:",
      "      - model-setup",
      "    command:",
      "      - pull",
      "      - qwen3:8b",
      "    depends_on:",
      "      - ollama",
      "  ollama-pull-llama3-2-3b:",
      "    image: ollama/ollama:latest",
      "    profiles:",
      "      - model-setup",
      '    command: "ollama pull llama3.2:3b"',
      "    depends_on:",
      "      - ollama",
      "",
    ].join("\n"),
    "utf-8",
  );

  const dockerCalls: DockerCommandInvocation[] = [];
  const app = buildApp({
    workspaceRoot,
    dockerGpuDetector: async () => ({
      available: true,
      devices: ["GPU 0: Test NVIDIA GPU"],
      dockerGpuRuntimeAvailable: true,
      dockerGpuRuntimeDetails: ["io.containerd.runc.v2", "nvidia", "runc"],
      dockerGpuRuntimeError: null,
      message: "GPU NVIDIA detectada: GPU 0: Test NVIDIA GPU. Runtime NVIDIA disponível no Docker.",
      error: null,
    }),
    dockerRunner: async (invocation) => {
      dockerCalls.push(invocation);
      if (invocation.args[0] === "run" && invocation.args.includes("nvidia-smi")) {
        return {
          exitCode: 0,
          stdout: "GPU 0: Test NVIDIA GPU\n",
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

  const status = await app.inject({
    method: "GET",
    url: "/docker-runtime/status?outDir=generated%2Flocal-ollama-runtime",
  });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().ready, true);
  assert.equal(status.json().modelSetup.required, true);
  assert.deepEqual(status.json().modelSetup.services, ["ollama-pull-llama3-2-3b", "ollama-pull-qwen3-8b"]);
  assert.deepEqual(status.json().modelSetup.models, ["llama3.2:3b", "qwen3:8b"]);
  assert.equal(
    status.json().modelSetup.command,
    "docker compose --profile model-setup up ollama-pull-llama3-2-3b ollama-pull-qwen3-8b",
  );
  assert.equal(status.json().modelSetup.execution.gpuComposeFile, true);
  assert.equal(status.json().modelSetup.execution.hostGpuDetected, true);
  assert.deepEqual(status.json().modelSetup.execution.hostGpuDevices, ["GPU 0: Test NVIDIA GPU"]);
  assert.equal(status.json().modelSetup.execution.dockerGpuRuntimeAvailable, true);
  assert.ok(status.json().modelSetup.execution.dockerGpuRuntimeDetails.includes("nvidia"));
  assert.equal(status.json().modelSetup.execution.recommendedProfile, "gpu");
  assert.equal(
    status.json().modelSetup.execution.gpuCommand,
    "docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build",
  );
  assert.equal(status.json().modelSetup.distribution.modelImageComposeFile, true);
  assert.equal(status.json().modelSetup.distribution.modelImageDockerfile, true);
  assert.equal(
    status.json().modelSetup.distribution.modelImageCommand,
    "docker compose -f docker-compose.yml -f docker-compose.model-image.yml build ollama",
  );
  assert.equal(status.json().modelSetup.distribution.modelImageTag, "ghcr.io/example/local-ollama-runtime-ollama-models:v1");
  assert.equal(
    status.json().modelSetup.distribution.modelImageArchivePath,
    "model-distribution/ghcr.io-example-local-ollama-runtime-ollama-models.v1.tar",
  );
  assert.equal(
    status.json().modelSetup.distribution.modelImageExportCommand,
    "docker image save -o model-distribution/ghcr.io-example-local-ollama-runtime-ollama-models.v1.tar ghcr.io/example/local-ollama-runtime-ollama-models:v1",
  );
  assert.equal(
    status.json().modelSetup.distribution.modelImageLoadCommand,
    "docker image load -i model-distribution/ghcr.io-example-local-ollama-runtime-ollama-models.v1.tar",
  );
  assert.equal(
    status.json().modelSetup.distribution.modelImagePushCommand,
    "docker image push ghcr.io/example/local-ollama-runtime-ollama-models:v1",
  );

  const appWithoutDockerGpuRuntime = buildApp({
    workspaceRoot,
    dockerGpuDetector: async () => ({
      available: true,
      devices: ["GPU 0: Test NVIDIA GPU"],
      dockerGpuRuntimeAvailable: false,
      dockerGpuRuntimeDetails: ["io.containerd.runc.v2", "runc"],
      dockerGpuRuntimeError: null,
      message: "GPU NVIDIA detectada, mas runtime NVIDIA do Docker não confirmado.",
      error: null,
    }),
    dockerRunner: async (invocation) => {
      dockerCalls.push(invocation);
      return {
        exitCode: 0,
        stdout: `ok ${invocation.args.join(" ")}`,
        stderr: "",
      };
    },
  });
  t.after(() => appWithoutDockerGpuRuntime.close());
  const noDockerGpuRuntimeStatus = await appWithoutDockerGpuRuntime.inject({
    method: "GET",
    url: "/docker-runtime/status?outDir=generated%2Flocal-ollama-runtime",
  });
  assert.equal(noDockerGpuRuntimeStatus.statusCode, 200);
  assert.equal(noDockerGpuRuntimeStatus.json().modelSetup.execution.hostGpuDetected, true);
  assert.equal(noDockerGpuRuntimeStatus.json().modelSetup.execution.dockerGpuRuntimeAvailable, false);
  assert.equal(noDockerGpuRuntimeStatus.json().modelSetup.execution.recommendedProfile, "cpu");
  assert.match(noDockerGpuRuntimeStatus.json().modelSetup.execution.reason, /runtime NVIDIA do Docker não foi confirmado/);

  const emptyModelImageCatalog = await app.inject({
    method: "GET",
    url: "/model-image-catalog",
  });
  assert.equal(emptyModelImageCatalog.statusCode, 200);
  assert.equal(emptyModelImageCatalog.json().format, "agent-flow-builder.model-image-catalog.v1");
  assert.equal(emptyModelImageCatalog.json().itemCount, 0);
  assert.equal(emptyModelImageCatalog.json().governance.storesDockerCredentials, false);

  const registerModelImage = await app.inject({
    method: "POST",
    url: "/model-image-catalog/register-runtime",
    headers: { "content-type": "application/json" },
    payload: {
      outDir: "generated/local-ollama-runtime",
      notes: "imagem validada no teste",
    },
  });
  assert.equal(registerModelImage.statusCode, 200);
  assert.equal(registerModelImage.json().created, true);
  assert.equal(registerModelImage.json().item.tag, "ghcr.io/example/local-ollama-runtime-ollama-models:v1");
  assert.deepEqual(registerModelImage.json().item.models, ["llama3.2:3b", "qwen3:8b"]);
  assert.equal(registerModelImage.json().item.registryHost, "ghcr.io");
  assert.equal(registerModelImage.json().item.versionTag, "v1");
  assert.equal(registerModelImage.json().item.pushCommand, "docker image push ghcr.io/example/local-ollama-runtime-ollama-models:v1");
  assert.equal(registerModelImage.json().item.governance.storesDockerCredentials, false);
  await access(path.join(workspaceRoot, ".agent-flow", "model-images", "catalog.afmodelimages.json"));

  const registeredModelImageCatalog = await app.inject({
    method: "GET",
    url: "/model-image-catalog",
  });
  assert.equal(registeredModelImageCatalog.statusCode, 200);
  assert.equal(registeredModelImageCatalog.json().itemCount, 1);
  assert.equal(registeredModelImageCatalog.json().items[0].tag, "ghcr.io/example/local-ollama-runtime-ollama-models:v1");

  const mergeModelImageCatalog = await app.inject({
    method: "POST",
    url: "/model-image-catalog/merge",
    headers: { "content-type": "application/json" },
    payload: registeredModelImageCatalog.json(),
  });
  assert.equal(mergeModelImageCatalog.statusCode, 200);
  assert.equal(mergeModelImageCatalog.json().unchanged, 1);

  const modelImageImportsDir = path.join(workspaceRoot, ".agent-flow", "model-images", "imports");
  await mkdir(modelImageImportsDir, { recursive: true });
  const discoveredCatalog = registeredModelImageCatalog.json();
  const discoveredItem = {
    ...discoveredCatalog.items[0],
    id: "model-image-discovered",
    tag: "ghcr.io/example/shared-ollama-models:v2",
    versionTag: "v2",
    updatedAt: "2030-01-01T00:00:00.000Z",
  };
  delete discoveredItem.contentHash;
  discoveredCatalog.items = [discoveredItem];
  discoveredCatalog.itemCount = 1;
  await writeFile(
    path.join(modelImageImportsDir, "shared-models.afmodelimages.json"),
    `${JSON.stringify(discoveredCatalog, null, 2)}\n`,
    "utf-8",
  );

  const discoveredModelImageCatalogs = await app.inject({
    method: "GET",
    url: "/model-image-catalog/discovery",
  });
  assert.equal(discoveredModelImageCatalogs.statusCode, 200);
  assert.equal(discoveredModelImageCatalogs.json().format, "agent-flow-builder.model-image-catalog-discovery.v1");
  assert.equal(discoveredModelImageCatalogs.json().catalogCount, 1);
  assert.equal(discoveredModelImageCatalogs.json().itemCount, 1);
  assert.equal(discoveredModelImageCatalogs.json().catalogs[0].tags[0], "ghcr.io/example/shared-ollama-models:v2");
  assert.equal(discoveredModelImageCatalogs.json().governance.storesDockerCredentials, false);
  assert.match(discoveredModelImageCatalogs.json().catalogs[0].path, /shared-models\.afmodelimages\.json$/);

  const syncDiscoveredModelImageCatalogs = await app.inject({
    method: "POST",
    url: "/model-image-catalog/sync-discovered",
  });
  assert.equal(syncDiscoveredModelImageCatalogs.statusCode, 200);
  assert.equal(syncDiscoveredModelImageCatalogs.json().mergedCatalogCount, 1);
  assert.equal(syncDiscoveredModelImageCatalogs.json().added, 1);
  assert.equal(syncDiscoveredModelImageCatalogs.json().catalog.itemCount, 2);
  assert.ok(
    syncDiscoveredModelImageCatalogs
      .json()
      .catalog.items.some((item: { tag: string }) => item.tag === "ghcr.io/example/shared-ollama-models:v2"),
  );

  const previousRemoteCatalogUrls = process.env.AGENT_FLOW_MODEL_IMAGE_CATALOG_REMOTE_URLS;
  const previousCentralCatalogUrl = process.env.AGENT_FLOW_MODEL_IMAGE_CATALOG_CENTRAL_URL;
  const previousCentralCatalogToken = process.env.AGENT_FLOW_MODEL_IMAGE_CATALOG_CENTRAL_TOKEN;
  const previousCentralCatalogTimeout = process.env.AGENT_FLOW_MODEL_IMAGE_CATALOG_CENTRAL_TIMEOUT_MS;
  t.after(() => {
    if (previousRemoteCatalogUrls === undefined) {
      delete process.env.AGENT_FLOW_MODEL_IMAGE_CATALOG_REMOTE_URLS;
    } else {
      process.env.AGENT_FLOW_MODEL_IMAGE_CATALOG_REMOTE_URLS = previousRemoteCatalogUrls;
    }
    if (previousCentralCatalogUrl === undefined) {
      delete process.env.AGENT_FLOW_MODEL_IMAGE_CATALOG_CENTRAL_URL;
    } else {
      process.env.AGENT_FLOW_MODEL_IMAGE_CATALOG_CENTRAL_URL = previousCentralCatalogUrl;
    }
    if (previousCentralCatalogToken === undefined) {
      delete process.env.AGENT_FLOW_MODEL_IMAGE_CATALOG_CENTRAL_TOKEN;
    } else {
      process.env.AGENT_FLOW_MODEL_IMAGE_CATALOG_CENTRAL_TOKEN = previousCentralCatalogToken;
    }
    if (previousCentralCatalogTimeout === undefined) {
      delete process.env.AGENT_FLOW_MODEL_IMAGE_CATALOG_CENTRAL_TIMEOUT_MS;
    } else {
      process.env.AGENT_FLOW_MODEL_IMAGE_CATALOG_CENTRAL_TIMEOUT_MS = previousCentralCatalogTimeout;
    }
  });
  const remoteCatalog = registeredModelImageCatalog.json();
  const remoteItem = {
    ...remoteCatalog.items[0],
    id: "model-image-remote",
    tag: "ghcr.io/example/remote-ollama-models:v3",
    versionTag: "v3",
    updatedAt: "2031-01-01T00:00:00.000Z",
  };
  delete remoteItem.contentHash;
  remoteCatalog.items = [remoteItem];
  remoteCatalog.itemCount = 1;
  const remoteCatalogServer = createServer((request, response) => {
    assert.equal(request.method, "GET");
    assert.equal(request.headers.authorization, undefined);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(remoteCatalog));
  });
  await new Promise<void>((resolve) => remoteCatalogServer.listen(0, "127.0.0.1", resolve));
  t.after(() => remoteCatalogServer.close());
  const remoteCatalogAddress = remoteCatalogServer.address() as AddressInfo;
  process.env.AGENT_FLOW_MODEL_IMAGE_CATALOG_REMOTE_URLS = `http://127.0.0.1:${remoteCatalogAddress.port}/catalog.afmodelimages.json`;

  const remoteModelImageCatalogs = await app.inject({
    method: "GET",
    url: "/model-image-catalog/remote",
  });
  assert.equal(remoteModelImageCatalogs.statusCode, 200);
  assert.equal(remoteModelImageCatalogs.json().format, "agent-flow-builder.model-image-catalog-remote-registry.v1");
  assert.equal(remoteModelImageCatalogs.json().registryCount, 1);
  assert.equal(remoteModelImageCatalogs.json().itemCount, 1);
  assert.equal(remoteModelImageCatalogs.json().registries[0].tags[0], "ghcr.io/example/remote-ollama-models:v3");
  assert.equal(remoteModelImageCatalogs.json().governance.sendsCredentials, false);

  const syncRemoteModelImageCatalogs = await app.inject({
    method: "POST",
    url: "/model-image-catalog/sync-remote",
  });
  assert.equal(syncRemoteModelImageCatalogs.statusCode, 200);
  assert.equal(syncRemoteModelImageCatalogs.json().mergedRegistryCount, 1);
  assert.equal(syncRemoteModelImageCatalogs.json().added, 1);
  assert.equal(syncRemoteModelImageCatalogs.json().catalog.itemCount, 3);
  assert.ok(
    syncRemoteModelImageCatalogs
      .json()
      .catalog.items.some((item: { tag: string }) => item.tag === "ghcr.io/example/remote-ollama-models:v3"),
  );

  const centralCatalog = registeredModelImageCatalog.json();
  const centralItem = {
    ...centralCatalog.items[0],
    id: "model-image-central",
    tag: "ghcr.io/example/central-ollama-models:v4",
    versionTag: "v4",
    updatedAt: "2032-01-01T00:00:00.000Z",
  };
  delete centralItem.contentHash;
  centralCatalog.items = [centralItem];
  centralCatalog.itemCount = 1;
  const centralRequests: Array<{ authorization: string | undefined; body: unknown }> = [];
  const centralCatalogServer = createServer(async (request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/sync");
    const body = await readJsonBody(request);
    centralRequests.push({ authorization: request.headers.authorization, body });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ catalog: centralCatalog }));
  });
  await new Promise<void>((resolve) => centralCatalogServer.listen(0, "127.0.0.1", resolve));
  t.after(() => centralCatalogServer.close());
  const centralCatalogAddress = centralCatalogServer.address() as AddressInfo;
  process.env.AGENT_FLOW_MODEL_IMAGE_CATALOG_CENTRAL_URL = `http://127.0.0.1:${centralCatalogAddress.port}/sync`;
  process.env.AGENT_FLOW_MODEL_IMAGE_CATALOG_CENTRAL_TOKEN = "central-model-token";
  process.env.AGENT_FLOW_MODEL_IMAGE_CATALOG_CENTRAL_TIMEOUT_MS = "1500";

  const centralModelImageCatalogStatus = await app.inject({
    method: "GET",
    url: "/model-image-catalog/central",
  });
  assert.equal(centralModelImageCatalogStatus.statusCode, 200);
  assert.equal(centralModelImageCatalogStatus.json().format, "agent-flow-builder.model-image-catalog-central-status.v1");
  assert.equal(centralModelImageCatalogStatus.json().configured, true);
  assert.equal(centralModelImageCatalogStatus.json().tokenConfigured, true);
  assert.equal(centralModelImageCatalogStatus.json().timeoutMs, 1500);
  assert.equal(centralModelImageCatalogStatus.json().governance.centralAuthTokenInHeaderOnly, true);
  assert.equal(centralModelImageCatalogStatus.json().governance.centralAuthTokenInBody, false);
  assert.equal(centralModelImageCatalogStatus.json().governance.storesDockerCredentials, false);
  assert.doesNotMatch(JSON.stringify(centralModelImageCatalogStatus.json()), /central-model-token/);
  assert.doesNotMatch(JSON.stringify(centralModelImageCatalogStatus.json()), new RegExp(String(centralCatalogAddress.port)));

  const syncCentralModelImageCatalogs = await app.inject({
    method: "POST",
    url: "/model-image-catalog/sync-central",
  });
  assert.equal(syncCentralModelImageCatalogs.statusCode, 200);
  assert.equal(syncCentralModelImageCatalogs.json().pushedItemCount, 3);
  assert.equal(syncCentralModelImageCatalogs.json().pulledItemCount, 1);
  assert.equal(syncCentralModelImageCatalogs.json().added, 1);
  assert.equal(syncCentralModelImageCatalogs.json().catalog.itemCount, 4);
  assert.equal(syncCentralModelImageCatalogs.json().central.statusCode, 200);
  assert.equal(syncCentralModelImageCatalogs.json().central.governance.centralAuthTokenInBody, false);
  assert.ok(
    syncCentralModelImageCatalogs
      .json()
      .catalog.items.some((item: { tag: string }) => item.tag === "ghcr.io/example/central-ollama-models:v4"),
  );
  assert.equal(centralRequests.length, 1);
  assert.equal(centralRequests[0]?.authorization, "Bearer central-model-token");
  const centralSyncRequest = centralRequests[0]?.body as {
    format?: string;
    catalog?: {
      itemCount?: number;
      governance?: { storesDockerCredentials?: boolean; storesEnvValues?: boolean };
    };
    governance?: {
      storesDockerCredentials?: boolean;
      storesEnvValues?: boolean;
      centralAuthTokenInBody?: boolean;
    };
  };
  assert.equal(centralSyncRequest.format, "agent-flow-builder.model-image-catalog-central-sync-request.v1");
  assert.equal(centralSyncRequest.catalog?.itemCount, 3);
  assert.equal(centralSyncRequest.catalog?.governance?.storesDockerCredentials, false);
  assert.equal(centralSyncRequest.catalog?.governance?.storesEnvValues, false);
  assert.equal(centralSyncRequest.governance?.storesDockerCredentials, false);
  assert.equal(centralSyncRequest.governance?.storesEnvValues, false);
  assert.equal(centralSyncRequest.governance?.centralAuthTokenInBody, false);
  assert.doesNotMatch(JSON.stringify(centralSyncRequest), /central-model-token/);

  delete process.env.AGENT_FLOW_MODEL_IMAGE_CATALOG_REMOTE_URLS;
  const emptyRemoteRegistry = await app.inject({
    method: "GET",
    url: "/model-image-catalog/remote-registry",
  });
  assert.equal(emptyRemoteRegistry.statusCode, 200);
  assert.equal(emptyRemoteRegistry.json().format, "agent-flow-builder.model-image-remote-registry.v1");
  assert.equal(emptyRemoteRegistry.json().registryCount, 0);

  const saveRemoteRegistry = await app.inject({
    method: "POST",
    url: "/model-image-catalog/remote-registry",
    headers: { "content-type": "application/json" },
    payload: {
      name: "Catálogo curado",
      url: `http://127.0.0.1:${remoteCatalogAddress.port}/catalog.afmodelimages.json`,
      enabled: true,
      status: "approved",
      notes: "registry salvo no workspace",
    },
  });
  assert.equal(saveRemoteRegistry.statusCode, 200);
  assert.equal(saveRemoteRegistry.json().created, true);
  assert.equal(saveRemoteRegistry.json().entry.name, "Catálogo curado");
  assert.equal(saveRemoteRegistry.json().entry.governance.sendsCredentials, false);
  assert.equal(saveRemoteRegistry.json().registry.enabledCount, 1);
  await access(path.join(workspaceRoot, ".agent-flow", "model-images", "remote-registries.afmodelregistry.json"));

  const savedRemoteModelImageCatalogs = await app.inject({
    method: "GET",
    url: "/model-image-catalog/remote",
  });
  assert.equal(savedRemoteModelImageCatalogs.statusCode, 200);
  assert.equal(savedRemoteModelImageCatalogs.json().registryCount, 1);
  assert.equal(savedRemoteModelImageCatalogs.json().registries[0].source, "workspace-registry");
  assert.equal(savedRemoteModelImageCatalogs.json().registries[0].name, "Catálogo curado");
  assert.equal(savedRemoteModelImageCatalogs.json().registries[0].tags[0], "ghcr.io/example/remote-ollama-models:v3");
  assert.equal(savedRemoteModelImageCatalogs.json().governance.workspaceRegistryPath, ".agent-flow/model-images/remote-registries.afmodelregistry.json");

  const syncSavedRemoteRegistry = await app.inject({
    method: "POST",
    url: "/model-image-catalog/sync-remote",
  });
  assert.equal(syncSavedRemoteRegistry.statusCode, 200);
  assert.equal(syncSavedRemoteRegistry.json().mergedRegistryCount, 1);
  assert.ok(syncSavedRemoteRegistry.json().unchanged >= 1);

  const syncedRemoteRegistry = await app.inject({
    method: "GET",
    url: "/model-image-catalog/remote-registry",
  });
  assert.equal(syncedRemoteRegistry.statusCode, 200);
  assert.equal(syncedRemoteRegistry.json().registries[0].lastStatusCode, 200);
  assert.equal(syncedRemoteRegistry.json().registries[0].lastItemCount, 1);
  assert.ok(syncedRemoteRegistry.json().registries[0].lastSyncedAt);

  const rejectCredentialedRegistry = await app.inject({
    method: "POST",
    url: "/model-image-catalog/remote-registry",
    headers: { "content-type": "application/json" },
    payload: {
      name: "Com segredo",
      url: `http://user:pass@127.0.0.1:${remoteCatalogAddress.port}/catalog.afmodelimages.json`,
    },
  });
  assert.equal(rejectCredentialedRegistry.statusCode, 422);

  const deleteRemoteRegistry = await app.inject({
    method: "DELETE",
    url: `/model-image-catalog/remote-registry/${saveRemoteRegistry.json().entry.id}`,
  });
  assert.equal(deleteRemoteRegistry.statusCode, 200);
  assert.equal(deleteRemoteRegistry.json().registryCount, 0);

  const artifacts = await app.inject({
    method: "GET",
    url: "/artifacts?outDir=generated%2Flocal-ollama-runtime",
  });
  assert.equal(artifacts.statusCode, 200);
  const modelSetupRunbookStep = artifacts
    .json()
    .exportAudit.runbook.steps.find((step: { id: string }) => step.id === "model_setup");
  assert.equal(modelSetupRunbookStep.label, "Preparar modelos locais");
  assert.equal(
    modelSetupRunbookStep.command,
    "docker compose --profile model-setup up ollama-pull-llama3-2-3b ollama-pull-qwen3-8b",
  );
  assert.match(modelSetupRunbookStep.detail, /llama3\.2:3b, qwen3:8b/);
  const modelImageRunbookStep = artifacts
    .json()
    .exportAudit.runbook.steps.find((step: { id: string }) => step.id === "model_image");
  assert.equal(modelImageRunbookStep.label, "Opcional: imagem Ollama pré-carregada");
  assert.equal(
    modelImageRunbookStep.command,
    "docker compose -f docker-compose.yml -f docker-compose.model-image.yml build ollama",
  );
  const modelImageExportRunbookStep = artifacts
    .json()
    .exportAudit.runbook.steps.find((step: { id: string }) => step.id === "model_image_export");
  assert.equal(modelImageExportRunbookStep.label, "Opcional: exportar imagem Ollama");
  assert.equal(
    modelImageExportRunbookStep.command,
    "docker image save -o model-distribution/ghcr.io-example-local-ollama-runtime-ollama-models.v1.tar ghcr.io/example/local-ollama-runtime-ollama-models:v1",
  );
  const modelImagePushRunbookStep = artifacts
    .json()
    .exportAudit.runbook.steps.find((step: { id: string }) => step.id === "model_image_push");
  assert.equal(modelImagePushRunbookStep.label, "Opcional: publicar imagem Ollama");
  assert.equal(
    modelImagePushRunbookStep.command,
    "docker image push ghcr.io/example/local-ollama-runtime-ollama-models:v1",
  );
  const modelGpuRunbookStep = artifacts
    .json()
    .exportAudit.runbook.steps.find((step: { id: string }) => step.id === "model_gpu");
  assert.equal(modelGpuRunbookStep.label, "Opcional: perfil GPU");
  assert.equal(
    modelGpuRunbookStep.command,
    "docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build",
  );
  const modelGpuProbeRunbookStep = artifacts
    .json()
    .exportAudit.runbook.steps.find((step: { id: string }) => step.id === "model_gpu_probe");
  assert.equal(modelGpuProbeRunbookStep.label, "Opcional: testar GPU Docker");
  assert.equal(
    modelGpuProbeRunbookStep.command,
    "docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi -L",
  );

  const archive = await app.inject({
    method: "GET",
    url: "/artifacts/archive?outDir=generated%2Flocal-ollama-runtime",
  });
  assert.equal(archive.statusCode, 200);
  assert.match(archive.body, /"id": "model_setup"/);
  assert.match(archive.body, /"id": "model_image"/);
  assert.match(archive.body, /"id": "model_image_export"/);
  assert.match(archive.body, /"id": "model_image_push"/);
  assert.match(archive.body, /"id": "model_gpu"/);
  assert.match(archive.body, /"id": "model_gpu_probe"/);
  assert.match(archive.body, /docker compose --profile model-setup up ollama-pull-llama3-2-3b ollama-pull-qwen3-8b/);
  assert.match(archive.body, /docker run --rm --gpus all nvidia\/cuda:12\.4\.1-base-ubuntu22\.04 nvidia-smi -L/);

  const buildModelImage = await app.inject({
    method: "POST",
    url: "/docker-runtime/build-model-image",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/local-ollama-runtime" },
  });
  assert.equal(buildModelImage.statusCode, 200);
  assert.equal(buildModelImage.json().ok, true);
  assert.equal(buildModelImage.json().operation, "build_model_image");
  assert.deepEqual(buildModelImage.json().args, [
    "compose",
    "-f",
    "docker-compose.yml",
    "-f",
    "docker-compose.model-image.yml",
    "build",
    "ollama",
  ]);

  const exportModelImage = await app.inject({
    method: "POST",
    url: "/docker-runtime/export-model-image",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/local-ollama-runtime" },
  });
  assert.equal(exportModelImage.statusCode, 200);
  assert.equal(exportModelImage.json().ok, true);
  assert.equal(exportModelImage.json().operation, "export_model_image");
  assert.deepEqual(exportModelImage.json().args, [
    "image",
    "save",
    "-o",
    "model-distribution/ghcr.io-example-local-ollama-runtime-ollama-models.v1.tar",
    "ghcr.io/example/local-ollama-runtime-ollama-models:v1",
  ]);

  const pushModelImage = await app.inject({
    method: "POST",
    url: "/docker-runtime/push-model-image",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/local-ollama-runtime" },
  });
  assert.equal(pushModelImage.statusCode, 200);
  assert.equal(pushModelImage.json().ok, true);
  assert.equal(pushModelImage.json().operation, "push_model_image");
  assert.deepEqual(pushModelImage.json().args, [
    "image",
    "push",
    "ghcr.io/example/local-ollama-runtime-ollama-models:v1",
  ]);

  const setupModels = await app.inject({
    method: "POST",
    url: "/docker-runtime/setup-models",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/local-ollama-runtime" },
  });
  assert.equal(setupModels.statusCode, 200);
  assert.equal(setupModels.json().ok, true);
  assert.equal(setupModels.json().operation, "setup_models");
  assert.equal(setupModels.json().lastOperation, "setup_models");
  assert.equal(setupModels.json().lastStatus, "success");
  assert.deepEqual(setupModels.json().args, [
    "compose",
    "--profile",
    "model-setup",
    "up",
    "ollama-pull-llama3-2-3b",
    "ollama-pull-qwen3-8b",
  ]);

  const checkGpu = await app.inject({
    method: "POST",
    url: "/docker-runtime/check-gpu",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/local-ollama-runtime" },
  });
  assert.equal(checkGpu.statusCode, 200);
  assert.equal(checkGpu.json().ok, true);
  assert.equal(checkGpu.json().operation, "check_gpu");
  assert.equal(checkGpu.json().lastOperation, "check_gpu");
  assert.equal(checkGpu.json().lastStatus, "success");
  assert.equal(checkGpu.json().gpuProbe.ok, true);
  assert.deepEqual(checkGpu.json().gpuProbe.devices, ["GPU 0: Test NVIDIA GPU"]);
  assert.deepEqual(checkGpu.json().args, [
    "run",
    "--rm",
    "--gpus",
    "all",
    "nvidia/cuda:12.4.1-base-ubuntu22.04",
    "nvidia-smi",
    "-L",
  ]);

  const upGpu = await app.inject({
    method: "POST",
    url: "/docker-runtime/up",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/local-ollama-runtime", modelExecutionProfile: "gpu" },
  });
  assert.equal(upGpu.statusCode, 200);
  assert.equal(upGpu.json().ok, true);
  assert.equal(upGpu.json().operation, "up");
  assert.deepEqual(upGpu.json().args, [
    "compose",
    "-f",
    "docker-compose.yml",
    "-f",
    "docker-compose.gpu.yml",
    "up",
    "-d",
    "--build",
  ]);
  assert.deepEqual(dockerCalls.map((call) => call.args), [
    ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.model-image.yml", "build", "ollama"],
    [
      "image",
      "save",
      "-o",
      "model-distribution/ghcr.io-example-local-ollama-runtime-ollama-models.v1.tar",
      "ghcr.io/example/local-ollama-runtime-ollama-models:v1",
    ],
    ["image", "push", "ghcr.io/example/local-ollama-runtime-ollama-models:v1"],
    ["compose", "--profile", "model-setup", "up", "ollama-pull-llama3-2-3b", "ollama-pull-qwen3-8b"],
    ["run", "--rm", "--gpus", "all", "nvidia/cuda:12.4.1-base-ubuntu22.04", "nvidia-smi", "-L"],
    ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.gpu.yml", "up", "-d", "--build"],
  ]);

  const history = await app.inject({
    method: "GET",
    url: "/docker-runtime/history?outDir=generated%2Flocal-ollama-runtime&operation=setup_models&limit=20",
  });
  assert.equal(history.statusCode, 200);
  assert.equal(history.json().entries.length, 1);
  assert.equal(history.json().entries[0].operation, "setup_models");
  assert.equal(history.json().entries[0].ok, true);

  const modelImageHistory = await app.inject({
    method: "GET",
    url: "/docker-runtime/history?outDir=generated%2Flocal-ollama-runtime&operation=build_model_image&limit=20",
  });
  assert.equal(modelImageHistory.statusCode, 200);
  assert.equal(modelImageHistory.json().entries.length, 1);
  assert.equal(modelImageHistory.json().entries[0].operation, "build_model_image");
  assert.equal(modelImageHistory.json().entries[0].ok, true);

  const modelImageExportHistory = await app.inject({
    method: "GET",
    url: "/docker-runtime/history?outDir=generated%2Flocal-ollama-runtime&operation=export_model_image&limit=20",
  });
  assert.equal(modelImageExportHistory.statusCode, 200);
  assert.equal(modelImageExportHistory.json().entries.length, 1);
  assert.equal(modelImageExportHistory.json().entries[0].operation, "export_model_image");
  assert.equal(modelImageExportHistory.json().entries[0].ok, true);

  const modelImagePushHistory = await app.inject({
    method: "GET",
    url: "/docker-runtime/history?outDir=generated%2Flocal-ollama-runtime&operation=push_model_image&limit=20",
  });
  assert.equal(modelImagePushHistory.statusCode, 200);
  assert.equal(modelImagePushHistory.json().entries.length, 1);
  assert.equal(modelImagePushHistory.json().entries[0].operation, "push_model_image");
  assert.equal(modelImagePushHistory.json().entries[0].ok, true);

  const gpuProbeHistory = await app.inject({
    method: "GET",
    url: "/docker-runtime/history?outDir=generated%2Flocal-ollama-runtime&operation=check_gpu&limit=20",
  });
  assert.equal(gpuProbeHistory.statusCode, 200);
  assert.equal(gpuProbeHistory.json().entries.length, 1);
  assert.equal(gpuProbeHistory.json().entries[0].operation, "check_gpu");
  assert.equal(gpuProbeHistory.json().entries[0].ok, true);
  assert.deepEqual(gpuProbeHistory.json().entries[0].gpuProbe.devices, ["GPU 0: Test NVIDIA GPU"]);

  const plainRuntimeDir = path.join(workspaceRoot, "generated", "plain-runtime");
  await mkdir(path.join(plainRuntimeDir, ".agent-flow"), { recursive: true });
  await writeFile(path.join(plainRuntimeDir, "Dockerfile"), "FROM python:3.12-slim\n", "utf-8");
  await writeFile(path.join(plainRuntimeDir, ".env.example"), "MOCK_LLM=true\n", "utf-8");
  await writeFile(
    path.join(plainRuntimeDir, ".agent-flow", "generated-meta.json"),
    `${JSON.stringify(
      {
        target: "runtime-manifest-bundle",
        flowId: "plain-runtime",
        flowVersion: "0.1.0",
        flowHash: "plain-runtime-hash",
        agents: [
          {
            id: "plain-agent",
            flowId: "plain-agent",
            routePrefix: "/",
            runtimeDir: "agents/plain-agent",
            resourceName: "sessions",
            contract: "sessions-v1",
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
  await writeFile(
    path.join(plainRuntimeDir, "docker-compose.yml"),
    ["services:", "  api:", "    build: .", "    ports:", '      - "18081:8080"', ""].join("\n"),
    "utf-8",
  );

  const plainStatus = await app.inject({
    method: "GET",
    url: "/docker-runtime/status?outDir=generated%2Fplain-runtime",
  });
  assert.equal(plainStatus.statusCode, 200);
  assert.equal(plainStatus.json().modelSetup.required, false);
  assert.deepEqual(plainStatus.json().modelSetup.services, []);
  assert.equal(plainStatus.json().modelSetup.execution.gpuComposeFile, false);
  assert.equal(plainStatus.json().modelSetup.execution.recommendedProfile, "cpu");
  assert.equal(plainStatus.json().modelSetup.distribution.modelImageComposeFile, false);
  assert.equal(plainStatus.json().modelSetup.distribution.modelImageDockerfile, false);
  assert.equal(plainStatus.json().modelSetup.distribution.modelImageTag, null);

  const plainGpuUp = await app.inject({
    method: "POST",
    url: "/docker-runtime/up",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/plain-runtime", modelExecutionProfile: "gpu" },
  });
  assert.equal(plainGpuUp.statusCode, 409);
  assert.equal(plainGpuUp.json().error, "workspace_error");

  const plainGpuProbe = await app.inject({
    method: "POST",
    url: "/docker-runtime/check-gpu",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/plain-runtime" },
  });
  assert.equal(plainGpuProbe.statusCode, 409);
  assert.equal(plainGpuProbe.json().error, "workspace_error");

  const plainModelImage = await app.inject({
    method: "POST",
    url: "/docker-runtime/build-model-image",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/plain-runtime" },
  });
  assert.equal(plainModelImage.statusCode, 409);
  assert.equal(plainModelImage.json().error, "workspace_error");

  const plainModelImageExport = await app.inject({
    method: "POST",
    url: "/docker-runtime/export-model-image",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/plain-runtime" },
  });
  assert.equal(plainModelImageExport.statusCode, 409);
  assert.equal(plainModelImageExport.json().error, "workspace_error");

  const plainModelImagePush = await app.inject({
    method: "POST",
    url: "/docker-runtime/push-model-image",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/plain-runtime" },
  });
  assert.equal(plainModelImagePush.statusCode, 409);
  assert.equal(plainModelImagePush.json().error, "workspace_error");

  const plainModelImageRegister = await app.inject({
    method: "POST",
    url: "/model-image-catalog/register-runtime",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/plain-runtime" },
  });
  assert.equal(plainModelImageRegister.statusCode, 409);
  assert.equal(plainModelImageRegister.json().error, "workspace_error");

  const plainSetup = await app.inject({
    method: "POST",
    url: "/docker-runtime/setup-models",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/plain-runtime" },
  });
  assert.equal(plainSetup.statusCode, 409);
  assert.equal(plainSetup.json().error, "workspace_error");
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
    payload: {
      outDir: "generated/reference-interview-langgraph-sandbox-status",
      approvalEvidence: {
        source: "studio",
        runId: "run-status-approval",
        sessionId: "session-status-approval",
        eventCount: 3,
        visibleEventCount: 3,
        capturedAt: "2026-07-02T12:10:00.000Z",
        excludesRawPayloads: true,
        excludesSecretValues: true,
      },
    },
  });
  assert.equal(sandboxApproval.statusCode, 200);
  assert.equal(sandboxApproval.json().approval.evidence.runId, "run-status-approval");

  const statusApproved = await app.inject({
    method: "GET",
    url: "/flows/reference-interview/langgraph-sandbox-approval-status",
  });
  assert.equal(statusApproved.statusCode, 200);
  assert.equal(statusApproved.json().status, "approved");
  assert.equal(statusApproved.json().approvedFor, "fastapi-runtime");
  assert.equal(statusApproved.json().evidence.runId, "run-status-approval");
  assert.equal(statusApproved.json().evidence.excludesSecretValues, true);

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

test("Builder API checks VM runner readiness without executing user code", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const app = buildApp({ workspaceRoot });
  t.after(() => app.close());

  const runnerPath = path.join(workspaceRoot, "agent-flow-vm-runner.cmd");
  const imageDir = path.join(workspaceRoot, "flows", "reference-interview", "images");
  const imagePath = path.join(imageDir, "agent-flow-python.qcow2");
  await mkdir(imageDir, { recursive: true });
  await writeFile(runnerPath, "@echo off\r\n", "utf-8");
  await writeFile(imagePath, "fake-qcow2-for-readiness-check", "utf-8");

  const ready = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/code-vm-runner/check",
    headers: { "content-type": "application/json" },
    payload: {
      node: {
        id: "vm_questions",
        type: "code",
        sandboxIsolation: "vm",
        sandboxVmImageId: "python-qemu-microvm",
        sandboxVmRunner: runnerPath,
        sandboxVmArgs: ["--engine", "qemu"],
        sandboxVmImage: "images/agent-flow-python.qcow2",
        sandboxVmProfile: "hardened",
        sandboxVmMemory: "1024m",
        sandboxVmCpus: "1",
      },
    },
  });
  assert.equal(ready.statusCode, 200);
  assert.equal(ready.json().format, "agent-flow-builder.vm-runner-check.v1");
  assert.equal(ready.json().status, "ready");
  assert.equal(ready.json().executesUserCode, false);
  assert.equal(ready.json().protocol, "agent-flow-vm-runner.v1");
  assert.equal(ready.json().runner.resolved, true);
  assert.equal(path.normalize(ready.json().runner.path), path.normalize(runnerPath));
  assert.equal(ready.json().runner.args.join(" "), "--engine qemu");
  assert.equal(ready.json().image.resolved, true);
  assert.equal(path.normalize(ready.json().image.path), path.normalize(imagePath));
  assert.equal(ready.json().policy.imageId, "python-qemu-microvm");
  assert.equal(ready.json().checks.every((check: { level: string }) => check.level === "ok"), true);

  const blocked = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/code-vm-runner/check",
    headers: { "content-type": "application/json" },
    payload: {
      node: {
        id: "vm_questions",
        type: "code",
        sandboxIsolation: "vm",
        sandboxVmRunner: "missing-agent-flow-vm-runner",
        sandboxVmImage: "images/missing.qcow2",
      },
    },
  });
  assert.equal(blocked.statusCode, 200);
  assert.equal(blocked.json().status, "blocked");
  assert.equal(blocked.json().executesUserCode, false);
  assert.equal(blocked.json().runner.resolved, false);
  assert.equal(blocked.json().image.resolved, false);
  assert.equal(blocked.json().checks.filter((check: { level: string }) => check.level === "error").length, 2);
});

test("Builder API validates VM runner and image manifests without executing user code", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const app = buildApp({ workspaceRoot });
  t.after(() => app.close());

  const runnerPath = path.join(workspaceRoot, "agent-flow-vm-runner.cmd");
  const runnerManifestDir = path.join(workspaceRoot, "flows", "reference-interview", ".agent-flow", "vm-runners");
  const runnerManifestPath = path.join(runnerManifestDir, "agent-flow-vm-runner.manifest.json");
  const imageDir = path.join(workspaceRoot, "flows", "reference-interview", "images");
  const imagePath = path.join(imageDir, "agent-flow-python.qcow2");
  const imageManifestPath = path.join(imageDir, "agent-flow-python.afvmimage.json");
  const imageBytes = "fake-qcow2-for-manifest-readiness-check";
  const imageSha256 = createHash("sha256").update(imageBytes).digest("hex");
  await mkdir(runnerManifestDir, { recursive: true });
  await mkdir(imageDir, { recursive: true });
  await writeFile(runnerPath, "@echo off\r\n", "utf-8");
  await writeFile(imagePath, imageBytes, "utf-8");
  await writeFile(
    runnerManifestPath,
    JSON.stringify({
      format: "agent-flow-builder.vm-runner-manifest.v1",
      protocol: "agent-flow-vm-runner.v1",
      runnerId: "local-qemu-runner",
      engines: ["qemu"],
      languages: ["python", "javascript", "typescript", "bash"],
      supportsNetworkNone: true,
      supportsReadOnlyRootfs: true,
      supportsWorkspaceMount: false,
      supportsSnapshotRestore: false,
    }),
    "utf-8",
  );
  await writeFile(
    imageManifestPath,
    JSON.stringify({
      format: "agent-flow-builder.vm-image-manifest.v1",
      imageId: "python-qemu-microvm",
      engine: "qemu",
      language: "python",
      imagePath: "agent-flow-python.qcow2",
      sizeBytes: Buffer.byteLength(imageBytes),
      sha256: imageSha256,
    }),
    "utf-8",
  );

  const ready = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/code-vm-runner/check",
    headers: { "content-type": "application/json" },
    payload: {
      node: {
        id: "vm_questions",
        type: "code",
        sandboxIsolation: "vm",
        sandboxVmImageId: "python-qemu-microvm",
        sandboxVmRunner: runnerPath,
        sandboxVmRunnerManifest: ".agent-flow/vm-runners/agent-flow-vm-runner.manifest.json",
        sandboxVmImageManifest: "images/agent-flow-python.afvmimage.json",
        sandboxVmEngine: "qemu",
        sandboxVmProfile: "hardened",
        sandboxVmMemory: "1024m",
        sandboxVmCpus: "1",
      },
    },
  });
  assert.equal(ready.statusCode, 200);
  assert.equal(ready.json().status, "ready");
  assert.equal(ready.json().executesUserCode, false);
  assert.equal(ready.json().runnerManifest.resolved, true);
  assert.equal(ready.json().runnerManifest.protocol, "agent-flow-vm-runner.v1");
  assert.deepEqual(ready.json().runnerManifest.engines, ["qemu"]);
  assert.equal(ready.json().imageManifest.resolved, true);
  assert.equal(ready.json().imageManifest.imageId, "python-qemu-microvm");
  assert.equal(ready.json().imageManifest.declaredSizeBytes, Buffer.byteLength(imageBytes));
  assert.equal(ready.json().imageManifest.sha256, imageSha256);
  assert.equal(ready.json().imageManifest.sha256Verified, true);
  assert.equal(ready.json().image.source, "manifest");
  assert.equal(path.normalize(ready.json().image.path), path.normalize(imagePath));
  assert.equal(ready.json().policy.engine, "qemu");
  assert.equal(ready.json().checks.every((check: { level: string }) => check.level === "ok"), true);

  const mismatched = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/code-vm-runner/check",
    headers: { "content-type": "application/json" },
    payload: {
      node: {
        id: "vm_questions",
        type: "code",
        sandboxIsolation: "vm",
        sandboxVmImageId: "node-qemu-microvm",
        sandboxVmRunner: runnerPath,
        sandboxVmRunnerManifest: ".agent-flow/vm-runners/agent-flow-vm-runner.manifest.json",
        sandboxVmImageManifest: "images/agent-flow-python.afvmimage.json",
        sandboxVmEngine: "firecracker",
        sandboxVmProfile: "hardened",
      },
    },
  });
  assert.equal(mismatched.statusCode, 200);
  assert.equal(mismatched.json().status, "blocked");
  assert.equal(mismatched.json().executesUserCode, false);
  assert.ok(
    mismatched.json().checks.some((check: { id: string; level: string }) => check.id === "image-manifest-id" && check.level === "error"),
  );
  assert.ok(
    mismatched
      .json()
      .checks.some((check: { id: string; level: string }) => check.id === "runner-manifest-engine" && check.level === "error"),
  );
});

test("Builder API creates a blank new flow workspace", async (t) => {
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
  assert.deepEqual(created.json().flow.nodes, []);
  assert.deepEqual(created.json().flow.edges, []);
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
  assert.equal(validated.json().status, "error");
  assert.ok(validated.json().summary.errors > 0);

  const generated = await app.inject({
    method: "POST",
    url: "/flows/new-agent/generate",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/new-agent-runtime" },
  });
  assert.equal(generated.statusCode, 422);
  assert.equal(generated.json().error, "workspace_error");
  assert.match(generated.json().message, /ainda não está pronto para geração/);

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

  const deleted = await app.inject({ method: "DELETE", url: "/flows/new-agent" });
  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.json().flowId, "new-agent");
  assert.equal(deleted.json().path, "flows/new-agent/agent.flow.json");
  await assert.rejects(access(path.join(workspaceRoot, "flows", "new-agent", "agent.flow.json")));

  await mkdir(path.join(workspaceRoot, "flows", "broken-flow"), { recursive: true });
  await writeFile(path.join(workspaceRoot, "flows", "broken-flow", "agent.flow.json"), "{", "utf-8");
  const listedWithInvalid = await app.inject({ method: "GET", url: "/flows" });
  assert.equal(listedWithInvalid.json().flows.some((flow: { id: string; valid: boolean }) => flow.id === "broken-flow" && !flow.valid), true);
  const deletedInvalid = await app.inject({ method: "DELETE", url: "/flows/broken-flow" });
  assert.equal(deletedInvalid.statusCode, 200);
  assert.equal(deletedInvalid.json().flowId, "broken-flow");
  await assert.rejects(access(path.join(workspaceRoot, "flows", "broken-flow", "agent.flow.json")));

  const missingDelete = await app.inject({ method: "DELETE", url: "/flows/new-agent" });
  assert.equal(missingDelete.statusCode, 404);
  assert.equal(missingDelete.json().error, "workspace_error");
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

  const supportFlow = await app.inject({
    method: "POST",
    url: "/catalog/agent-templates/create-flow",
    headers: { "content-type": "application/json" },
    payload: {
      itemId: "guided-conversation-agent",
      id: "support-agent",
      name: "Support Agent",
    },
  });
  assert.equal(supportFlow.statusCode, 200);

  const manifestDraft = loaded.json().manifest;
  manifestDraft.name = "Reference Runtime Visual";
  manifestDraft.packaging = "multiagent";
  manifestDraft.defaultLlm.mockEnv = "MOCK_LLM";
  manifestDraft.agents[0].routePrefix = "/reference-interview";
  manifestDraft.agents.push({
    id: "support-agent",
    flowPath: "flows/support-agent/agent.flow.json",
    routePrefix: "/support",
  });
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
  assert.equal(validated.json().agents[1].flowId, "support-agent");
  assert.equal(validated.json().agents[1].routePrefix, "/support");

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
  await access(path.join(workspaceRoot, "generated", "reference-runtime-bundle", "agents", "support-agent", "app", "main.py"));
  await access(path.join(workspaceRoot, "generated", "reference-runtime-bundle", "bundle.json"));
  const bundleArtifacts = await app.inject({
    method: "GET",
    url: "/artifacts?outDir=generated%2Freference-runtime-bundle",
  });
  assert.equal(bundleArtifacts.statusCode, 200);
  assert.equal(bundleArtifacts.json().exportAudit.packageType, "runtime-final");
  assert.equal(bundleArtifacts.json().exportAudit.target, "runtime-manifest-bundle");
  assert.equal(bundleArtifacts.json().exportAudit.runbook.runtimeBaseUrl, "http://127.0.0.1:8080");
  assert.equal(bundleArtifacts.json().exportAudit.runbook.agents.length, 2);
  assert.equal(
    bundleArtifacts.json().exportAudit.runbook.agents.find((agent: { id: string }) => agent.id === "support-agent").sessionsUrl,
    "http://127.0.0.1:8080/support/sessions",
  );

  const bundleStatus = await app.inject({
    method: "GET",
    url: "/docker-runtime/status?outDir=generated%2Freference-runtime-bundle&runtimeUrl=http%3A%2F%2F127.0.0.1%3A9020",
  });
  assert.equal(bundleStatus.statusCode, 200);
  assert.equal(bundleStatus.json().ready, true);
  assert.equal(bundleStatus.json().target, "runtime-manifest-bundle");
  assert.equal(bundleStatus.json().resourceName, "sessions");
  assert.equal(bundleStatus.json().runtimeUrl, "http://127.0.0.1:9020");
  assert.equal(bundleStatus.json().agents.length, 2);
  assert.equal(bundleStatus.json().agents[0].id, "reference-interview");
  assert.equal(bundleStatus.json().agents[0].routePrefix, "/reference-interview");
  assert.equal(bundleStatus.json().agents[0].resourceName, "sessions");
  assert.equal(bundleStatus.json().agents[1].id, "support-agent");
  assert.equal(bundleStatus.json().agents[1].routePrefix, "/support");

  const runtimeCalls: Array<{ method: string; url: string; body: unknown }> = [];
  const routeAgents: Record<string, { agentId: string; sessionId: string }> = {
    "/reference-interview": { agentId: "reference-interview", sessionId: "smoke-session" },
    "/support": { agentId: "support-agent", sessionId: "support-smoke-session" },
  };
  const runtimeJobOperationsByAgent: Record<string, unknown> = {
    "reference-interview": {
      enabled: true,
      manual_cleanup_endpoint: "POST /jobs/cleanup",
      worker: {
        command: "python -m app.worker",
        interval_seconds: 5,
        limit: 20,
        retry_delay_seconds: 5,
        lease_seconds: 60,
        multiworker_claims: true,
      },
      retention: {
        automatic_cleanup_enabled: false,
        older_than_hours: 168,
        limit: 100,
        statuses: ["succeeded", "failed"],
        terminal_statuses: ["failed", "succeeded"],
      },
      schedules: { interval: true, cron: "basic", event: true },
    },
    "support-agent": {
      enabled: true,
      manual_cleanup_endpoint: "POST /jobs/cleanup",
      worker: {
        command: "python -m app.worker",
        interval_seconds: 10,
        limit: 5,
        retry_delay_seconds: 15,
        lease_seconds: 90,
        multiworker_claims: true,
      },
      retention: {
        automatic_cleanup_enabled: true,
        older_than_hours: 72,
        limit: 50,
        statuses: ["succeeded"],
        terminal_statuses: ["failed", "succeeded"],
      },
      schedules: { interval: true, cron: "basic", event: false },
    },
  };
  let failSupportTurn = false;
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
      response.end(JSON.stringify({ kind: "bundle", agents: ["reference-interview", "support-agent"] }));
      return;
    }
    for (const [routePrefix, agent] of Object.entries(routeAgents)) {
      if (method === "GET" && url === `${routePrefix}/metadata`) {
        response.end(JSON.stringify({
          kind: "agent",
          id: agent.agentId,
          operations: { jobs: runtimeJobOperationsByAgent[agent.agentId] },
        }));
        return;
      }
      if (method === "POST" && url === `${routePrefix}/sessions`) {
        response.end(JSON.stringify({ session: { session_id: agent.sessionId } }));
        return;
      }
      if (method === "POST" && url === `${routePrefix}/sessions/${agent.sessionId}/start`) {
        response.end(JSON.stringify({ ok: true, phase: "started" }));
        return;
      }
      if (method === "POST" && url === `${routePrefix}/sessions/${agent.sessionId}/turn`) {
        if (failSupportTurn && agent.agentId === "support-agent") {
          response.statusCode = 500;
          response.end(JSON.stringify({ error: "support_turn_failed" }));
          return;
        }
        response.end(JSON.stringify({ ok: true, phase: "turn" }));
        return;
      }
      if (method === "GET" && url === `${routePrefix}/sessions/${agent.sessionId}/transcript`) {
        response.end(JSON.stringify([{ seq: 1, role: "assistant", content: "ok" }]));
        return;
      }
      if (method === "GET" && url === `${routePrefix}/sessions/${agent.sessionId}/events`) {
        response.end(JSON.stringify([{ seq: 1, event_type: "session_started" }]));
        return;
      }
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
  assert.equal(bundleSmoke.json().smoke.agentMetadata.operations.jobs.worker.command, "python -m app.worker");
  assert.equal(bundleSmoke.json().smoke.agentMetadata.operations.jobs.worker.retry_delay_seconds, 5);
  assert.equal(bundleSmoke.json().smoke.agentMetadata.operations.jobs.worker.multiworker_claims, true);
  assert.equal(bundleSmoke.json().smoke.agentMetadata.operations.jobs.retention.older_than_hours, 168);
  assert.equal(bundleSmoke.json().smoke.agentMetadata.operations.jobs.schedules.event, true);
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
  runtimeCalls.length = 0;

  const bundleSmokeAll = await app.inject({
    method: "POST",
    url: "/docker-runtime/smoke-all",
    headers: { "content-type": "application/json" },
    payload: {
      outDir: "generated/reference-runtime-bundle",
      runtimeUrl,
    },
  });
  assert.equal(bundleSmokeAll.statusCode, 200);
  assert.equal(bundleSmokeAll.json().ok, true);
  assert.equal(bundleSmokeAll.json().operation, "smoke");
  assert.equal(bundleSmokeAll.json().smokeAll.agentCount, 2);
  assert.equal(bundleSmokeAll.json().smokeAll.okCount, 2);
  assert.equal(bundleSmokeAll.json().smokeAll.failedCount, 0);
  assert.equal(bundleSmokeAll.json().smokeAll.results[0].agentId, "reference-interview");
  assert.equal(bundleSmokeAll.json().smokeAll.results[1].agentId, "support-agent");
  assert.equal(bundleSmokeAll.json().smokeAll.results[0].agentMetadata.operations.jobs.worker.limit, 20);
  assert.equal(bundleSmokeAll.json().smokeAll.results[1].agentMetadata.operations.jobs.worker.interval_seconds, 10);
  assert.equal(bundleSmokeAll.json().smokeAll.results[1].agentMetadata.operations.jobs.retention.automatic_cleanup_enabled, true);
  assert.equal(bundleSmokeAll.json().smokeAll.results[1].agentMetadata.operations.jobs.schedules.event, false);
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
      "GET /health",
      "GET /metadata",
      "GET /support/metadata",
      "POST /support/sessions",
      "POST /support/sessions/support-smoke-session/start",
      "POST /support/sessions/support-smoke-session/turn",
      "GET /support/sessions/support-smoke-session/transcript",
      "GET /support/sessions/support-smoke-session/events",
    ],
  );
  runtimeCalls.length = 0;
  failSupportTurn = true;

  const bundleSmokeFailure = await app.inject({
    method: "POST",
    url: "/docker-runtime/smoke",
    headers: { "content-type": "application/json" },
    payload: {
      outDir: "generated/reference-runtime-bundle",
      runtimeUrl,
      agentId: "support-agent",
    },
  });
  assert.equal(bundleSmokeFailure.statusCode, 200);
  assert.equal(bundleSmokeFailure.json().ok, false);
  assert.equal(bundleSmokeFailure.json().smokeFailure.agentId, "support-agent");
  assert.equal(bundleSmokeFailure.json().smokeFailure.routePrefix, "/support");
  assert.equal(bundleSmokeFailure.json().smokeFailure.resourceName, "sessions");
  assert.equal(bundleSmokeFailure.json().smokeFailure.basePath, "/support/sessions");
  assert.match(bundleSmokeFailure.json().smokeFailure.message, /500/);

  const supportSmokeHistory = await app.inject({
    method: "GET",
    url: "/docker-runtime/history?outDir=generated%2Freference-runtime-bundle&operation=smoke&search=support-agent&limit=20",
  });
  assert.equal(supportSmokeHistory.statusCode, 200);
  assert.ok(
    supportSmokeHistory.json().entries.some(
      (entry: {
        smokeAll?: {
          results?: Array<{
            agentId?: string;
            agentMetadata?: { operations?: { jobs?: { worker?: { interval_seconds?: number } } } };
          }>;
          failures?: Array<{ agentId?: string | null }>;
        };
        smokeFailure?: { agentId?: string | null };
      }) =>
        entry.smokeFailure?.agentId === "support-agent" ||
        entry.smokeAll?.results?.some(
          (result) =>
            result.agentId === "support-agent" &&
            result.agentMetadata?.operations?.jobs?.worker?.interval_seconds === 10,
        ) ||
        entry.smokeAll?.failures?.some((failure) => failure.agentId === "support-agent"),
    ),
  );

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
  const builtinHttpTool = catalog.json().items.find((item: { kind: string; id: string }) => item.kind === "tool" && item.id === "http-json-tool");
  assert.ok(builtinHttpTool);
  assert.equal(builtinHttpTool.version, "1.0.0");
  assert.equal(builtinHttpTool.revision, 1);
  assert.match(builtinHttpTool.contentHash, /^[0-9a-f]{12}$/);
  const builtinToolBundle = catalog
    .json()
    .items.find((item: { kind: string; id: string }) => item.kind === "tool" && item.id === "guarded-http-json-block");
  assert.ok(builtinToolBundle);
  assert.match(builtinToolBundle.content, /agent-flow-builder\.tool-bundle\.v1/);
  assert.ok(
    catalog
      .json()
      .items.some((item: { kind: string; id: string }) => item.kind === "agent_template" && item.id === "content-question-generator-agent"),
  );
  assert.ok(
    catalog
      .json()
      .items.some((item: { kind: string; id: string }) => item.kind === "agent_template" && item.id === "guided-conversation-agent"),
  );
  const builtinComplexAgentTemplate = catalog
    .json()
    .items.find((item: { kind: string; id: string }) => item.kind === "agent_template" && item.id === "pro-up-parity-complex-agent");
  assert.ok(builtinComplexAgentTemplate);
  assert.match(builtinComplexAgentTemplate.description, /conversa por sessão/);
  assert.ok(builtinComplexAgentTemplate.tags.includes("proup"));
  assert.ok(
    catalog
      .json()
      .items.some((item: { kind: string; id: string }) => item.kind === "skill" && item.id === "structured-question-generation-skill"),
  );
  const builtinCompositeSkill = catalog
    .json()
    .items.find((item: { kind: string; id: string }) => item.kind === "skill" && item.id === "context-review-composite-skill");
  assert.ok(builtinCompositeSkill);
  assert.match(builtinCompositeSkill.content, /"nodes"/);
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

  const createdComplexTemplate = await app.inject({
    method: "POST",
    url: "/catalog/agent-templates/create-flow",
    headers: { "content-type": "application/json" },
    payload: {
      itemId: "pro-up-parity-complex-agent",
      id: "catalog-proup-parity-agent",
      name: "Agente Complexo ProUp",
    },
  });
  assert.equal(createdComplexTemplate.statusCode, 200);
  const complexFlow = createdComplexTemplate.json().flow;
  assert.equal(complexFlow.id, "catalog-proup-parity-agent");
  assert.equal(complexFlow.api.contract, "sessions-v1");
  assert.equal(complexFlow.persistence.checkpointer, "postgres");
  assert.equal(complexFlow.persistence.cache, "redis");
  for (const nodeType of [
    "file_extract",
    "rag_retrieval",
    "http_request",
    "llm_structured",
    "code",
    "scoring",
    "analytics",
    "approval_gate",
    "human_input",
  ]) {
    assert.equal(
      complexFlow.nodes.some((node: { type: string }) => node.type === nodeType),
      true,
      `template complexo deve conter nó ${nodeType}`,
    );
  }
  assert.equal(
    complexFlow.schemas.some((schema: { id: string }) => schema.id === "conversation_turn"),
    true,
  );
  await access(path.join(workspaceRoot, "flows", "catalog-proup-parity-agent", "agent.flow.json"));
  assert.match(
    await readFile(path.join(workspaceRoot, "flows", "catalog-proup-parity-agent", "prompts", "system.md"), "utf-8"),
    /benchmark de paridade ProUp/,
  );
  const complexTemplateValidation = await app.inject({ method: "POST", url: "/flows/catalog-proup-parity-agent/validate" });
  assert.equal(complexTemplateValidation.statusCode, 200);
  assert.equal(complexTemplateValidation.json().summary.errors, 0);
  const complexRuntime = await app.inject({
    method: "POST",
    url: "/flows/catalog-proup-parity-agent/generate",
    headers: { "content-type": "application/json" },
    payload: {
      outDir: "generated/catalog-proup-parity-agent-runtime",
    },
  });
  assert.equal(complexRuntime.statusCode, 200);
  assert.equal(complexRuntime.json().flowId, "catalog-proup-parity-agent");
  await access(path.join(workspaceRoot, "generated", "catalog-proup-parity-agent-runtime", "app", "generated_flow.py"));

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
  assert.equal(savedPrompt.json().item.version, "1.0.0");
  assert.equal(savedPrompt.json().item.revision, 1);
  assert.equal(savedPrompt.json().item.history.length, 0);
  assert.match(savedPrompt.json().item.contentHash, /^[0-9a-f]{12}$/);
  await access(path.join(workspaceRoot, ".agent-flow", "catalog", "registry.json"));

  const savedPromptRevision = await app.inject({
    method: "POST",
    url: "/catalog/items",
    headers: { "content-type": "application/json" },
    payload: {
      kind: "prompt",
      id: "catalog-system",
      name: "Prompt catalogado",
      version: "1.1.0",
      description: "Prompt reutilizável local revisado.",
      tags: ["catalog", "test"],
      content: "Use {topic} para gerar uma resposta objetiva com exemplos.",
    },
  });
  assert.equal(savedPromptRevision.statusCode, 200);
  assert.equal(savedPromptRevision.json().item.version, "1.1.0");
  assert.equal(savedPromptRevision.json().item.revision, 2);
  assert.equal(savedPromptRevision.json().item.createdAt, savedPrompt.json().item.createdAt);
  assert.notEqual(savedPromptRevision.json().item.contentHash, savedPrompt.json().item.contentHash);
  assert.equal(savedPromptRevision.json().item.history.length, 1);
  assert.equal(savedPromptRevision.json().item.history[0].version, "1.0.0");
  assert.equal(savedPromptRevision.json().item.history[0].revision, 1);
  assert.equal(savedPromptRevision.json().item.history[0].contentHash, savedPrompt.json().item.contentHash);
  assert.match(savedPromptRevision.json().item.history[0].content, /resposta objetiva/);
  const storedCatalog = JSON.parse(await readFile(path.join(workspaceRoot, ".agent-flow", "catalog", "registry.json"), "utf-8"));
  const storedPrompt = storedCatalog.items.find((item: { id: string; kind: string }) => item.kind === "prompt" && item.id === "catalog-system");
  assert.equal(storedPrompt.history.length, 1);
  assert.equal(storedPrompt.history[0].revision, 1);

  const restoredPrompt = await app.inject({
    method: "POST",
    url: "/catalog/items/restore-revision",
    headers: { "content-type": "application/json" },
    payload: {
      itemId: "catalog-system",
      kind: "prompt",
      revision: 1,
    },
  });
  assert.equal(restoredPrompt.statusCode, 200);
  assert.equal(restoredPrompt.json().item.version, "1.0.0");
  assert.equal(restoredPrompt.json().item.revision, 3);
  assert.equal(restoredPrompt.json().item.contentHash, savedPrompt.json().item.contentHash);
  assert.equal(restoredPrompt.json().item.history.length, 2);
  assert.equal(restoredPrompt.json().item.history[1].revision, 2);
  assert.match(restoredPrompt.json().item.history[1].content, /exemplos/);

  const conflictLocalPrompt = await app.inject({
    method: "POST",
    url: "/catalog/items",
    headers: { "content-type": "application/json" },
    payload: {
      kind: "prompt",
      id: "catalog-conflict-prompt",
      name: "Prompt com conflito local",
      description: "Prompt local para detectar divergência compartilhada.",
      tags: ["catalog", "conflict"],
      content: "Conteúdo local para conflito.\n",
    },
  });
  assert.equal(conflictLocalPrompt.statusCode, 200);

  const emptySharedCatalog = await app.inject({ method: "GET", url: "/catalog/shared-library" });
  assert.equal(emptySharedCatalog.statusCode, 200);
  assert.equal(emptySharedCatalog.json().format, "agent-flow-builder.catalog-library.v1");
  assert.equal(emptySharedCatalog.json().itemCount, 0);
  assert.equal(emptySharedCatalog.json().conflictCount, 0);
  assert.equal(emptySharedCatalog.json().openConflictCount, 0);
  assert.equal(emptySharedCatalog.json().sharedSync.action, "empty");
  assert.equal(emptySharedCatalog.json().sharedSync.storage, ".agent-flow/catalog/shared-library.afcataloglibrary.json");
  assert.equal(emptySharedCatalog.json().sharedSync.governance.excludesRawConflictContent, true);

  const syncedSharedCatalog = await app.inject({
    method: "POST",
    url: "/catalog/shared-library/merge",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.catalog-library.v1",
      exportedAt: "2026-07-02T00:14:00.000Z",
      items: [restoredPrompt.json().item, conflictLocalPrompt.json().item],
    },
  });
  assert.equal(syncedSharedCatalog.statusCode, 200);
  assert.equal(syncedSharedCatalog.json().sharedLibrary.itemCount, 2);
  assert.equal(syncedSharedCatalog.json().sharedLibrary.sharedSync.action, "merge");
  assert.equal(syncedSharedCatalog.json().sharedLibrary.sharedSync.addedCount, 2);
  assert.equal(syncedSharedCatalog.json().sharedLibrary.sharedSync.finalCount, 2);
  assert.equal(syncedSharedCatalog.json().sharedLibrary.sharedSync.conflictCount, 0);
  assert.equal(syncedSharedCatalog.json().sharedLibrary.items[0].source, "local");
  assert.match(syncedSharedCatalog.json().sharedLibrary.packageHash, /^[0-9a-f]{12}$/);
  assert.match(syncedSharedCatalog.json().sharedLibrary.sharedSync.contentHash, /^[0-9a-f]{12}$/);
  await access(path.join(workspaceRoot, ".agent-flow", "catalog", "shared-library.afcataloglibrary.json"));

  const remoteConflictUpdatedAt = new Date(Date.parse(conflictLocalPrompt.json().item.updatedAt) + 1000).toISOString();
  const conflictingSharedCatalog = await app.inject({
    method: "POST",
    url: "/catalog/shared-library/merge",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.catalog-library.v1",
      exportedAt: "2026-07-02T00:16:00.000Z",
      items: [
        {
          ...conflictLocalPrompt.json().item,
          name: "Prompt com conflito remoto",
          description: "Prompt remoto divergente para revisar.",
          tags: ["catalog", "conflict", "remote"],
          version: "1.1.0",
          revision: 2,
          contentHash: "remote-catalog-conflict",
          updatedAt: remoteConflictUpdatedAt,
          content: "Conteúdo remoto divergente.\n",
        },
      ],
    },
  });
  assert.equal(conflictingSharedCatalog.statusCode, 200);
  assert.equal(conflictingSharedCatalog.json().sharedLibrary.itemCount, 2);
  assert.equal(conflictingSharedCatalog.json().sharedLibrary.sharedSync.updatedCount, 1);
  assert.equal(conflictingSharedCatalog.json().sharedLibrary.sharedSync.conflictCount, 1);
  assert.equal(conflictingSharedCatalog.json().sharedLibrary.conflictCount, 1);
  assert.equal(conflictingSharedCatalog.json().sharedLibrary.openConflictCount, 1);
  assert.equal(conflictingSharedCatalog.json().sharedLibrary.conflicts[0].itemKey, "prompt:catalog-conflict-prompt");
  assert.equal(conflictingSharedCatalog.json().sharedLibrary.conflicts[0].reason, "conteúdo, metadados, tags, versão");
  assert.equal(conflictingSharedCatalog.json().sharedLibrary.conflicts[0].existingSnapshot.content, undefined);
  assert.equal(conflictingSharedCatalog.json().sharedLibrary.conflicts[0].incomingSnapshot.content, undefined);
  assert.equal(conflictingSharedCatalog.json().sharedLibrary.conflicts[0].existingSnapshot.hasContent, true);
  assert.equal(conflictingSharedCatalog.json().sharedLibrary.conflicts[0].incomingSnapshot.hasContent, true);

  const viewerAssignedSharedCatalogConflict = await app.inject({
    method: "POST",
    url: `/catalog/shared-library/conflicts/${conflictingSharedCatalog.json().sharedLibrary.conflicts[0].id}/curation`,
    headers: { "content-type": "application/json" },
    payload: {
      actor: "catalog-viewer",
      role: "viewer",
      action: "assign",
      note: "Inspecionar sem curar.",
    },
  });
  assert.equal(viewerAssignedSharedCatalogConflict.statusCode, 403);

  const assignedSharedCatalogConflict = await app.inject({
    method: "POST",
    url: `/catalog/shared-library/conflicts/${conflictingSharedCatalog.json().sharedLibrary.conflicts[0].id}/curation`,
    headers: { "content-type": "application/json" },
    payload: {
      actor: "catalog-curator",
      role: "reviewer",
      action: "assign",
      note: "Vou revisar o conflito compartilhado.",
    },
  });
  assert.equal(assignedSharedCatalogConflict.statusCode, 200);
  assert.equal(assignedSharedCatalogConflict.json().sharedSync.action, "curate_conflict");
  assert.equal(assignedSharedCatalogConflict.json().conflicts[0].curationThread.status, "assigned");
  assert.equal(assignedSharedCatalogConflict.json().conflicts[0].curationThread.assignee, "catalog-curator");
  assert.equal(assignedSharedCatalogConflict.json().conflicts[0].curationThread.lastAction, "assign");
  assert.match(assignedSharedCatalogConflict.json().conflicts[0].curationThread.leaseExpiresAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(assignedSharedCatalogConflict.json().conflicts[0].curationThread.leaseDurationHours, 24);
  assert.equal(assignedSharedCatalogConflict.json().conflicts[0].curationThread.leaseExpired, false);
  assert.equal(assignedSharedCatalogConflict.json().conflicts[0].curationThread.events.length, 1);
  assert.equal(assignedSharedCatalogConflict.json().conflicts[0].curationThread.events[0].action, "assign");
  assert.equal(assignedSharedCatalogConflict.json().conflicts[0].curationThread.events[0].actor, "catalog-curator");
  assert.equal(assignedSharedCatalogConflict.json().conflicts[0].curationThread.events[0].role, "reviewer");
  assert.equal(assignedSharedCatalogConflict.json().conflicts[0].curationThread.governance.excludesRawCatalogContent, true);
  assert.equal(assignedSharedCatalogConflict.json().conflicts[0].curationThread.governance.autoReleasesExpiredAssignments, true);
  assert.equal(
    assignedSharedCatalogConflict.json().conflicts[0].curationThread.governance.configuredLeaseHoursEnv,
    "AGENT_FLOW_CATALOG_CONFLICT_CURATION_LEASE_HOURS",
  );
  assert.equal(JSON.stringify(assignedSharedCatalogConflict.json().conflicts[0]).includes("Conteúdo remoto divergente"), false);

  const releasedSharedCatalogConflict = await app.inject({
    method: "POST",
    url: `/catalog/shared-library/conflicts/${conflictingSharedCatalog.json().sharedLibrary.conflicts[0].id}/curation`,
    headers: { "content-type": "application/json" },
    payload: {
      actor: "catalog-curator",
      role: "reviewer",
      action: "release",
      note: "Liberado para outro curador.",
    },
  });
  assert.equal(releasedSharedCatalogConflict.statusCode, 200);
  assert.equal(releasedSharedCatalogConflict.json().conflicts[0].curationThread.status, "unassigned");
  assert.equal(releasedSharedCatalogConflict.json().conflicts[0].curationThread.assignee, "");
  assert.equal(releasedSharedCatalogConflict.json().conflicts[0].curationThread.lastAction, "release");
  assert.equal(releasedSharedCatalogConflict.json().conflicts[0].curationThread.leaseExpiresAt, null);
  assert.equal(releasedSharedCatalogConflict.json().conflicts[0].curationThread.leaseDurationHours, null);
  assert.equal(releasedSharedCatalogConflict.json().conflicts[0].curationThread.leaseExpired, false);
  assert.equal(releasedSharedCatalogConflict.json().conflicts[0].curationThread.events.length, 2);
  assert.equal(releasedSharedCatalogConflict.json().conflicts[0].curationThread.events[0].action, "release");

  const reassignedSharedCatalogConflict = await app.inject({
    method: "POST",
    url: `/catalog/shared-library/conflicts/${conflictingSharedCatalog.json().sharedLibrary.conflicts[0].id}/curation`,
    headers: { "content-type": "application/json" },
    payload: {
      actor: "catalog-curator",
      role: "reviewer",
      action: "assign",
    },
  });
  assert.equal(reassignedSharedCatalogConflict.statusCode, 200);
  assert.equal(reassignedSharedCatalogConflict.json().conflicts[0].curationThread.status, "assigned");
  assert.match(reassignedSharedCatalogConflict.json().conflicts[0].curationThread.leaseExpiresAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(reassignedSharedCatalogConflict.json().conflicts[0].curationThread.leaseDurationHours, 24);
  assert.equal(reassignedSharedCatalogConflict.json().conflicts[0].curationThread.leaseExpired, false);
  assert.equal(reassignedSharedCatalogConflict.json().conflicts[0].curationThread.events.length, 3);
  assert.equal(reassignedSharedCatalogConflict.json().conflicts[0].curationThread.events[0].action, "assign");

  const catalogConflictReview = await app.inject({
    method: "GET",
    url: "/catalog/shared-library/conflicts-review",
  });
  assert.equal(catalogConflictReview.statusCode, 200);
  const catalogConflictReviewBody = catalogConflictReview.json();
  assert.equal(catalogConflictReviewBody.format, "agent-flow-builder.catalog-conflict-review.v1");
  assert.equal(catalogConflictReviewBody.conflictCount, 1);
  assert.equal(catalogConflictReviewBody.openConflictCount, 1);
  assert.equal(catalogConflictReviewBody.summary.itemCount, 2);
  assert.equal(catalogConflictReviewBody.summary.promptConflictCount, 1);
  assert.equal(catalogConflictReviewBody.summary.assignedConflictCount, 1);
  assert.equal(catalogConflictReviewBody.summary.unassignedConflictCount, 0);
  assert.equal(catalogConflictReviewBody.source.storage, ".agent-flow/catalog/shared-library.afcataloglibrary.json");
  assert.equal(catalogConflictReviewBody.governance.excludesRawCatalogContent, true);
  assert.equal(catalogConflictReviewBody.governance.excludesRawConflictContent, true);
  assert.equal(catalogConflictReviewBody.governance.excludesSecretValues, true);
  assert.equal(JSON.stringify(catalogConflictReviewBody).includes("Conteúdo remoto divergente"), false);
  assert.equal(catalogConflictReviewBody.items, undefined);
  assert.equal(catalogConflictReviewBody.conflicts[0].existingSnapshot.content, undefined);
  assert.equal(catalogConflictReviewBody.conflicts[0].incomingSnapshot.content, undefined);
  assert.equal(catalogConflictReviewBody.conflicts[0].curationThread.events.length, 3);

  const catalogConflictReviewDiff = await app.inject({
    method: "POST",
    url: "/catalog/shared-library/conflicts-review/diff",
    headers: { "content-type": "application/json" },
    payload: {
      review: {
        ...catalogConflictReviewBody,
        conflicts: [],
        resolutionHistory: [],
      },
    },
  });
  assert.equal(catalogConflictReviewDiff.statusCode, 200);
  const catalogConflictReviewDiffBody = catalogConflictReviewDiff.json();
  assert.equal(catalogConflictReviewDiffBody.format, "agent-flow-builder.catalog-conflict-review-diff.v1");
  assert.equal(catalogConflictReviewDiffBody.current.conflictCount, 1);
  assert.equal(catalogConflictReviewDiffBody.incoming.conflictCount, 0);
  assert.equal(catalogConflictReviewDiffBody.governance.excludesRawCatalogContent, true);
  assert.equal(catalogConflictReviewDiffBody.governance.excludesRawConflictContent, true);
  assert.equal(catalogConflictReviewDiffBody.sections.some((section: any) => section.id === "conflicts" && section.changedCount >= 1), true);
  assert.equal(JSON.stringify(catalogConflictReviewDiffBody).includes("Conteúdo remoto divergente"), false);

  const invalidCatalogConflictReviewDiff = await app.inject({
    method: "POST",
    url: "/catalog/shared-library/conflicts-review/diff",
    headers: { "content-type": "application/json" },
    payload: {
      review: {
        ...catalogConflictReviewBody,
        items: [{ content: "Conteúdo bruto não deve entrar na revisão." }],
      },
    },
  });
  assert.equal(invalidCatalogConflictReviewDiff.statusCode, 400);

  const persistedSharedCatalog = await app.inject({
    method: "GET",
    url: "/catalog/shared-library",
  });
  assert.equal(persistedSharedCatalog.statusCode, 200);
  const persistedSharedCatalogBody = persistedSharedCatalog.json();
  const sharedCatalogPath = path.join(workspaceRoot, ".agent-flow", "catalog", "shared-library.afcataloglibrary.json");
  const expiredSharedCatalogPackage = {
    ...persistedSharedCatalogBody,
    conflicts: persistedSharedCatalogBody.conflicts.map((conflict: any, index: number) =>
      index === 0
        ? {
            ...conflict,
            curationThread: {
              ...conflict.curationThread,
              status: "assigned",
              assignee: "stale-catalog-curator",
              openedAt: "2020-01-01T00:00:00.000Z",
              updatedAt: "2020-01-01T00:00:00.000Z",
              lastActor: "stale-catalog-curator",
              lastAction: "assign",
              leaseExpiresAt: "2020-01-01T01:00:00.000Z",
              leaseDurationHours: 1,
              leaseExpired: false,
            },
          }
        : conflict,
    ),
  };
  await writeFile(sharedCatalogPath, JSON.stringify(expiredSharedCatalogPackage, null, 2));
  const expiredSharedCatalog = await app.inject({
    method: "GET",
    url: "/catalog/shared-library",
  });
  assert.equal(expiredSharedCatalog.statusCode, 200);
  const expiredSharedCatalogThread = expiredSharedCatalog.json().conflicts[0].curationThread;
  assert.equal(expiredSharedCatalogThread.status, "unassigned");
  assert.equal(expiredSharedCatalogThread.assignee, "");
  assert.equal(expiredSharedCatalogThread.leaseExpiresAt, null);
  assert.equal(expiredSharedCatalogThread.leaseDurationHours, null);
  assert.equal(expiredSharedCatalogThread.leaseExpired, true);
  assert.equal(expiredSharedCatalogThread.lastAction, "lease_expired");
  assert.equal(expiredSharedCatalogThread.events.some((event: any) => event.action === "lease_expired"), true);
  await writeFile(sharedCatalogPath, JSON.stringify(persistedSharedCatalogBody, null, 2));

  const viewerResolvedSharedCatalogConflict = await app.inject({
    method: "POST",
    url: `/catalog/shared-library/conflicts/${conflictingSharedCatalog.json().sharedLibrary.conflicts[0].id}/resolve`,
    headers: { "content-type": "application/json" },
    payload: {
      resolvedBy: "catalog-viewer",
      role: "viewer",
      resolution: "use_incoming",
      resolutionNote: "Inspecionar sem resolver.",
    },
  });
  assert.equal(viewerResolvedSharedCatalogConflict.statusCode, 403);

  const resolvedSharedCatalogConflict = await app.inject({
    method: "POST",
    url: `/catalog/shared-library/conflicts/${conflictingSharedCatalog.json().sharedLibrary.conflicts[0].id}/resolve`,
    headers: { "content-type": "application/json" },
    payload: {
      resolvedBy: "catalog-curator",
      role: "reviewer",
      resolution: "use_incoming",
      resolutionNote: "Aceita versão recebida da biblioteca compartilhada.",
    },
  });
  assert.equal(resolvedSharedCatalogConflict.statusCode, 200);
  assert.equal(resolvedSharedCatalogConflict.json().sharedSync.action, "resolve");
  assert.equal(resolvedSharedCatalogConflict.json().sharedSync.conflictCount, 1);
  assert.equal(resolvedSharedCatalogConflict.json().conflictCount, 1);
  assert.equal(resolvedSharedCatalogConflict.json().openConflictCount, 0);
  assert.equal(resolvedSharedCatalogConflict.json().conflicts[0].status, "resolved");
  assert.equal(resolvedSharedCatalogConflict.json().conflicts[0].curationThread.status, "resolved");
  assert.equal(resolvedSharedCatalogConflict.json().conflicts[0].curationThread.assignee, "catalog-curator");
  assert.equal(resolvedSharedCatalogConflict.json().conflicts[0].curationThread.lastAction, "resolve");
  assert.equal(resolvedSharedCatalogConflict.json().conflicts[0].curationThread.events.length, 4);
  assert.equal(resolvedSharedCatalogConflict.json().conflicts[0].curationThread.events[0].action, "resolve");
  assert.equal(resolvedSharedCatalogConflict.json().conflicts[0].curationThread.events[0].role, "reviewer");
  assert.equal(resolvedSharedCatalogConflict.json().conflicts[0].resolvedBy, "catalog-curator");
  assert.equal(resolvedSharedCatalogConflict.json().conflicts[0].resolvedRole, "reviewer");
  assert.equal(resolvedSharedCatalogConflict.json().conflicts[0].resolution, "use_incoming");
  assert.equal(resolvedSharedCatalogConflict.json().conflicts[0].resolutionNote, "Aceita versão recebida da biblioteca compartilhada.");
  assert.equal(resolvedSharedCatalogConflict.json().conflicts[0].resolutionPlan.selectedSnapshot, "incoming_snapshot");
  assert.equal(resolvedSharedCatalogConflict.json().conflicts[0].resolutionPlan.contentAction, "selected_content_already_current");
  assert.equal(resolvedSharedCatalogConflict.json().conflicts[0].resolutionPlan.metadataAction, "selected_metadata_already_current");
  assert.equal(resolvedSharedCatalogConflict.json().conflicts[0].resolutionPlan.requiresManualContentReview, false);
  assert.deepEqual(resolvedSharedCatalogConflict.json().conflicts[0].resolutionPlan.metadataFieldsChanged, []);
  assert.equal(resolvedSharedCatalogConflict.json().conflicts[0].resolutionPlan.governance.excludesRawCatalogContent, true);
  assert.equal(resolvedSharedCatalogConflict.json().resolutionHistoryCount, 1);
  assert.equal(resolvedSharedCatalogConflict.json().resolutionHistory[0].conflictId, conflictingSharedCatalog.json().sharedLibrary.conflicts[0].id);
  assert.equal(resolvedSharedCatalogConflict.json().resolutionHistory[0].itemKey, "prompt:catalog-conflict-prompt");
  assert.equal(resolvedSharedCatalogConflict.json().resolutionHistory[0].resolvedBy, "catalog-curator");
  assert.equal(resolvedSharedCatalogConflict.json().resolutionHistory[0].resolvedRole, "reviewer");
  assert.equal(resolvedSharedCatalogConflict.json().resolutionHistory[0].resolution, "use_incoming");
  assert.equal(resolvedSharedCatalogConflict.json().resolutionHistory[0].keptSnapshot.contentHash, "remote-catalog-conflict");
  assert.equal(resolvedSharedCatalogConflict.json().resolutionHistory[0].discardedSnapshots.length, 1);
  assert.equal(resolvedSharedCatalogConflict.json().resolutionHistory[0].governance.excludesRawCatalogContent, true);
  assert.equal(JSON.stringify(resolvedSharedCatalogConflict.json().conflicts[0]).includes("Conteúdo remoto divergente"), false);
  assert.equal(JSON.stringify(resolvedSharedCatalogConflict.json().resolutionHistory).includes("Conteúdo remoto divergente"), false);

  const staleCatalogConflictReplay = await app.inject({
    method: "POST",
    url: "/catalog/shared-library/merge",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.catalog-library.v1",
      exportedAt: "2026-07-02T00:17:00.000Z",
      items: [
        {
          ...conflictLocalPrompt.json().item,
          updatedAt: new Date(Date.parse(remoteConflictUpdatedAt) + 2000).toISOString(),
        },
      ],
    },
  });
  assert.equal(staleCatalogConflictReplay.statusCode, 200);
  assert.equal(staleCatalogConflictReplay.json().sharedLibrary.conflictCount, 1);
  assert.equal(staleCatalogConflictReplay.json().sharedLibrary.openConflictCount, 0);
  assert.equal(staleCatalogConflictReplay.json().sharedLibrary.sharedSync.conflictCount, 0);
  assert.equal(staleCatalogConflictReplay.json().sharedLibrary.conflicts[0].status, "resolved");
  assert.equal(staleCatalogConflictReplay.json().sharedLibrary.conflicts[0].resolvedBy, "catalog-curator");
  assert.equal(staleCatalogConflictReplay.json().sharedLibrary.resolutionHistoryCount, 1);
  const retainedCatalogPrompt = staleCatalogConflictReplay
    .json()
    .sharedLibrary.items.find((item: any) => item.id === "catalog-conflict-prompt");
  assert.equal(retainedCatalogPrompt.name, "Prompt com conflito remoto");
  assert.equal(retainedCatalogPrompt.version, "1.1.0");
  assert.equal(retainedCatalogPrompt.contentHash, "remote-catalog-conflict");

  const remoteSharedCatalog = await app.inject({
    method: "POST",
    url: "/catalog/shared-library/merge",
    headers: { "content-type": "application/json" },
    payload: {
      format: "agent-flow-builder.catalog-library.v1",
      exportedAt: "2026-07-02T00:15:00.000Z",
      items: [
        {
          id: "catalog-shared-schema",
          kind: "schema",
          name: "Schema compartilhado",
          description: "Schema trazido da biblioteca compartilhada.",
          tags: ["catalog", "shared"],
          scope: "local",
          source: "local",
          version: "1.0.0",
          revision: 1,
          createdAt: "2026-07-02T00:15:00.000Z",
          updatedAt: "2026-07-02T00:15:00.000Z",
          content: "{\"type\":\"object\",\"properties\":{\"answer\":{\"type\":\"string\"}}}",
          history: [],
        },
      ],
    },
  });
  assert.equal(remoteSharedCatalog.statusCode, 200);
  assert.equal(remoteSharedCatalog.json().sharedLibrary.itemCount, 3);
  assert.equal(remoteSharedCatalog.json().sharedLibrary.sharedSync.addedCount, 1);
  assert.ok(
    remoteSharedCatalog
      .json()
      .catalog.items.some((item: { kind: string; id: string }) => item.kind === "schema" && item.id === "catalog-shared-schema"),
  );

  const loadedSharedCatalog = await app.inject({ method: "POST", url: "/catalog/shared-library/load" });
  assert.equal(loadedSharedCatalog.statusCode, 200);
  assert.equal(loadedSharedCatalog.json().sharedLibrary.sharedSync.action, "load");
  assert.ok(
    loadedSharedCatalog
      .json()
      .catalog.items.some((item: { kind: string; id: string }) => item.kind === "schema" && item.id === "catalog-shared-schema"),
  );

  const previousCatalogCentralUrl = process.env.AGENT_FLOW_CATALOG_CENTRAL_URL;
  const previousCatalogCentralToken = process.env.AGENT_FLOW_CATALOG_CENTRAL_TOKEN;
  const previousCatalogCentralTimeout = process.env.AGENT_FLOW_CATALOG_CENTRAL_TIMEOUT_MS;
  t.after(() => {
    if (previousCatalogCentralUrl === undefined) {
      delete process.env.AGENT_FLOW_CATALOG_CENTRAL_URL;
    } else {
      process.env.AGENT_FLOW_CATALOG_CENTRAL_URL = previousCatalogCentralUrl;
    }
    if (previousCatalogCentralToken === undefined) {
      delete process.env.AGENT_FLOW_CATALOG_CENTRAL_TOKEN;
    } else {
      process.env.AGENT_FLOW_CATALOG_CENTRAL_TOKEN = previousCatalogCentralToken;
    }
    if (previousCatalogCentralTimeout === undefined) {
      delete process.env.AGENT_FLOW_CATALOG_CENTRAL_TIMEOUT_MS;
    } else {
      process.env.AGENT_FLOW_CATALOG_CENTRAL_TIMEOUT_MS = previousCatalogCentralTimeout;
    }
  });
  const catalogCentralRequests: Array<{ authorization: string | undefined; body: unknown }> = [];
  const centralCatalogLibrary = {
    format: "agent-flow-builder.catalog-library.v1",
    exportedAt: "2026-07-02T00:17:00.000Z",
    items: [
      {
        id: "catalog-central-prompt",
        kind: "prompt",
        name: "Prompt central",
        description: "Prompt recebido da central.",
        tags: ["catalog", "central"],
        scope: "local",
        source: "local",
        version: "1.0.0",
        revision: 1,
        createdAt: "2026-07-02T00:17:00.000Z",
        updatedAt: "2026-07-02T00:17:00.000Z",
        content: "Prompt central reutilizável.\n",
        history: [],
      },
    ],
  };
  const catalogCentralServer = createServer(async (request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/sync");
    const body = await readJsonBody(request);
    catalogCentralRequests.push({
      authorization: request.headers.authorization,
      body,
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ sharedLibrary: centralCatalogLibrary }));
  });
  await new Promise<void>((resolve) => catalogCentralServer.listen(0, "127.0.0.1", resolve));
  t.after(() => catalogCentralServer.close());
  const catalogCentralAddress = catalogCentralServer.address() as AddressInfo;
  process.env.AGENT_FLOW_CATALOG_CENTRAL_URL = `http://127.0.0.1:${catalogCentralAddress.port}/sync`;
  process.env.AGENT_FLOW_CATALOG_CENTRAL_TOKEN = "catalog-central-token";
  process.env.AGENT_FLOW_CATALOG_CENTRAL_TIMEOUT_MS = "1500";

  const catalogCentralStatus = await app.inject({ method: "GET", url: "/catalog/central" });
  assert.equal(catalogCentralStatus.statusCode, 200);
  assert.equal(catalogCentralStatus.json().format, "agent-flow-builder.catalog-central-sync-status.v1");
  assert.equal(catalogCentralStatus.json().configured, true);
  assert.equal(catalogCentralStatus.json().tokenConfigured, true);
  assert.equal(catalogCentralStatus.json().timeoutMs, 1500);
  assert.equal(catalogCentralStatus.json().governance.configuredUrlEnv, "AGENT_FLOW_CATALOG_CENTRAL_URL");
  assert.equal(catalogCentralStatus.json().governance.centralAuthTokenInHeaderOnly, true);
  assert.equal(JSON.stringify(catalogCentralStatus.json()).includes("catalog-central-token"), false);
  assert.equal(JSON.stringify(catalogCentralStatus.json()).includes(String(catalogCentralAddress.port)), false);

  const catalogCentralSync = await app.inject({ method: "POST", url: "/catalog/sync-central" });
  assert.equal(catalogCentralSync.statusCode, 200);
  assert.equal(catalogCentralSync.json().format, "agent-flow-builder.catalog-central-sync-result.v1");
  assert.equal(catalogCentralSync.json().pushedItemCount, 3);
  assert.equal(catalogCentralSync.json().pulledItemCount, 1);
  assert.equal(catalogCentralSync.json().central.statusCode, 200);
  assert.equal(catalogCentralSync.json().central.pushedItemCount, 3);
  assert.equal(catalogCentralSync.json().central.pulledItemCount, 1);
  assert.equal(catalogCentralSync.json().governance.centralAuthTokenInHeaderOnly, true);
  assert.equal(catalogCentralSync.json().governance.centralAuthTokenInBody, false);
  assert.equal(catalogCentralSync.json().sharedLibrary.itemCount, 4);
  assert.ok(
    catalogCentralSync
      .json()
      .catalog.items.some((item: { kind: string; id: string }) => item.kind === "prompt" && item.id === "catalog-central-prompt"),
  );
  assert.equal(JSON.stringify(catalogCentralSync.json()).includes("catalog-central-token"), false);
  assert.equal(JSON.stringify(catalogCentralSync.json()).includes(String(catalogCentralAddress.port)), false);
  assert.equal(catalogCentralRequests.length, 1);
  assert.equal(catalogCentralRequests[0].authorization, "Bearer catalog-central-token");
  const catalogCentralBody = catalogCentralRequests[0].body as {
    format?: string;
    sharedLibrary?: { itemCount?: number };
    governance?: {
      centralAuthTokenInBody?: boolean;
      centralAuthTokenInHeaderOnly?: boolean;
      sendsRawCatalogContent?: boolean;
      sendsRawConflictContent?: boolean;
    };
  };
  assert.equal(catalogCentralBody.format, "agent-flow-builder.catalog-central-sync-request.v1");
  assert.equal(catalogCentralBody.sharedLibrary?.itemCount, 3);
  assert.equal(catalogCentralBody.governance?.centralAuthTokenInHeaderOnly, true);
  assert.equal(catalogCentralBody.governance?.centralAuthTokenInBody, false);
  assert.equal(catalogCentralBody.governance?.sendsRawCatalogContent, true);
  assert.equal(catalogCentralBody.governance?.sendsRawConflictContent, false);
  assert.equal(JSON.stringify(catalogCentralBody).includes("catalog-central-token"), false);

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
    /resposta objetiva/,
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

  const savedTool = await app.inject({
    method: "POST",
    url: "/catalog/items",
    headers: { "content-type": "application/json" },
    payload: {
      kind: "tool",
      id: "local-deterministic-tool",
      name: "Tool determinística local",
      description: "Node patch salvo como tool local.",
      tags: ["tool", "local"],
      nodePatch: { type: "code", handler: "deterministic_gate" },
    },
  });
  assert.equal(savedTool.statusCode, 200);
  assert.equal(savedTool.json().item.source, "local");
  assert.equal(savedTool.json().item.nodePatch.handler, "deterministic_gate");

  const savedToolBundle = await app.inject({
    method: "POST",
    url: "/catalog/items",
    headers: { "content-type": "application/json" },
    payload: {
      kind: "tool",
      id: "local-tool-bundle",
      name: "Tool composta local",
      description: "Bundle local mínimo para reuso.",
      tags: ["tool", "bundle", "local"],
      content: JSON.stringify({
        format: "agent-flow-builder.tool-bundle.v1",
        nodes: [
          {
            id: "normalize_payload",
            type: "transform_json",
            inputPath: "input",
            outputPath: "normalized_payload",
          },
        ],
        edges: [],
      }),
    },
  });
  assert.equal(savedToolBundle.statusCode, 200);
  assert.equal(savedToolBundle.json().item.source, "local");
  assert.match(savedToolBundle.json().item.content, /agent-flow-builder\.tool-bundle\.v1/);
  assert.equal(savedToolBundle.json().item.nodePatch, undefined);

  const exportedToolBundle = await app.inject({
    method: "GET",
    url: "/catalog/items/tool/local-tool-bundle/export",
  });
  assert.equal(exportedToolBundle.statusCode, 200);
  assert.equal(exportedToolBundle.json().format, "agent-flow-builder.catalog-item.v1");
  assert.equal(exportedToolBundle.json().source.id, "local-tool-bundle");
  assert.equal(exportedToolBundle.json().item.id, "local-tool-bundle");
  assert.equal(exportedToolBundle.json().item.kind, "tool");
  assert.match(exportedToolBundle.json().item.content, /normalize_payload/);

  const importedToolBundle = await app.inject({
    method: "POST",
    url: "/catalog/items/import",
    headers: { "content-type": "application/json" },
    payload: {
      package: {
        ...exportedToolBundle.json(),
        item: {
          ...exportedToolBundle.json().item,
          id: "local-tool-bundle-copy",
          name: "Tool composta importada",
          tags: ["tool", "bundle", "imported"],
        },
      },
    },
  });
  assert.equal(importedToolBundle.statusCode, 200);
  assert.equal(importedToolBundle.json().item.source, "local");
  assert.equal(importedToolBundle.json().item.id, "local-tool-bundle-copy");
  assert.equal(importedToolBundle.json().item.revision, 1);
  assert.match(importedToolBundle.json().item.content, /normalize_payload/);

  const exportedBuiltinTool = await app.inject({
    method: "GET",
    url: "/catalog/items/tool/http-json-tool/export",
  });
  assert.equal(exportedBuiltinTool.statusCode, 200);
  const importedBuiltinTool = await app.inject({
    method: "POST",
    url: "/catalog/items/import",
    headers: { "content-type": "application/json" },
    payload: { package: exportedBuiltinTool.json() },
  });
  assert.equal(importedBuiltinTool.statusCode, 200);
  assert.equal(importedBuiltinTool.json().item.source, "local");
  assert.equal(importedBuiltinTool.json().item.id, "http-json-tool-imported");
  assert.equal(importedBuiltinTool.json().item.name, "HTTP JSON tool");

  const savedSkill = await app.inject({
    method: "POST",
    url: "/catalog/items",
    headers: { "content-type": "application/json" },
    payload: {
      kind: "skill",
      id: "local-empty-skill",
      name: "Skill local",
      description: "Skill local mínima.",
      tags: ["skill", "local"],
      content: JSON.stringify({
        format: "agent-flow-builder.skill.v1",
        prompts: [],
        schemas: [],
        targetNodePatch: { type: "code", handler: "deterministic_gate" },
      }),
    },
  });
  assert.equal(savedSkill.statusCode, 200);
  assert.equal(savedSkill.json().item.source, "local");
  assert.match(savedSkill.json().item.content, /agent-flow-builder\.skill\.v1/);

  const savedCompositeSkill = await app.inject({
    method: "POST",
    url: "/catalog/items",
    headers: { "content-type": "application/json" },
    payload: {
      kind: "skill",
      id: "local-composite-skill",
      name: "Skill composta local",
      description: "Skill local com subgrafo reutilizável.",
      tags: ["skill", "bundle", "local"],
      content: JSON.stringify({
        format: "agent-flow-builder.skill.v1",
        prompts: [],
        schemas: [],
        nodes: [
          {
            id: "score_payload",
            type: "scoring",
            inputPath: "user_message",
            resultPath: "scores.local_skill",
            threshold: 0.7,
          },
        ],
        edges: [],
      }),
    },
  });
  assert.equal(savedCompositeSkill.statusCode, 200);
  assert.equal(savedCompositeSkill.json().item.source, "local");
  assert.match(savedCompositeSkill.json().item.content, /score_payload/);

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

  const appliedToolBundle = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/catalog/apply",
    headers: { "content-type": "application/json" },
    payload: {
      itemId: "guarded-http-json-block",
      kind: "tool",
    },
  });
  assert.equal(appliedToolBundle.statusCode, 200);
  const bundleFlow = appliedToolBundle.json().flow;
  const preparedNode = bundleFlow.nodes.find((node: { id: string }) => node.id === "guarded-http-json-block-prepare_payload");
  const httpNode = bundleFlow.nodes.find((node: { id: string }) => node.id === "guarded-http-json-block-call_http_json");
  assert.equal(bundleFlow.nodes.length, appliedTool.json().flow.nodes.length + 2);
  assert.equal(appliedToolBundle.json().node.id, "guarded-http-json-block-prepare_payload");
  assert.equal(preparedNode.type, "transform_json");
  assert.equal(httpNode.codeExecution, "http");
  assert.ok(
    bundleFlow.edges.some(
      (edge: { from: string; to: string }) =>
        edge.from === "guarded-http-json-block-prepare_payload" && edge.to === "guarded-http-json-block-call_http_json",
    ),
  );

  const appliedSkill = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/catalog/apply",
    headers: { "content-type": "application/json" },
    payload: {
      itemId: "structured-question-generation-skill",
      kind: "skill",
      targetNodeId: "llm_step",
    },
  });
  assert.equal(appliedSkill.statusCode, 200);
  assert.equal(appliedSkill.json().prompt.id, "question_generation");
  assert.equal(appliedSkill.json().schema.id, "question_list");
  assert.equal(appliedSkill.json().node.id, "llm_step");
  assert.equal(appliedSkill.json().node.type, "llm_structured");
  assert.equal(appliedSkill.json().node.promptId, "question_generation");
  assert.equal(appliedSkill.json().node.outputSchema, "question_list");
  assert.match(
    await readFile(path.join(workspaceRoot, "flows", "reference-interview", "prompts", "question_generation.md"), "utf-8"),
    /transforma conteúdo em perguntas/,
  );

  const appliedCompositeSkill = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/catalog/apply",
    headers: { "content-type": "application/json" },
    payload: {
      itemId: "context-review-composite-skill",
      kind: "skill",
      targetNodeId: "llm_step",
    },
  });
  assert.equal(appliedCompositeSkill.statusCode, 200);
  assert.equal(appliedCompositeSkill.json().prompt.id, "context_review");
  assert.equal(appliedCompositeSkill.json().schema.id, "context_review_result");
  assert.equal(appliedCompositeSkill.json().node.id, "context-review-composite-skill-extract_context");
  const compositeFlow = appliedCompositeSkill.json().flow;
  const reviewNode = compositeFlow.nodes.find((candidate: { id: string }) => candidate.id === "context-review-composite-skill-review_context");
  assert.equal(reviewNode.promptId, "context_review");
  assert.equal(reviewNode.outputSchema, "context_review_result");
  assert.ok(
    compositeFlow.edges.some(
      (edge: { from: string; to: string }) =>
        edge.from === "context-review-composite-skill-retrieve_context" &&
        edge.to === "context-review-composite-skill-review_context",
    ),
  );

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
  importedPackage.secretPolicyProfiles = {
    format: "agent-flow-builder.secret-policy-profiles.v1",
    exportedAt: "2026-01-01T00:00:00.000Z",
    profileCount: 1,
    profiles: [
      {
        id: "shared-default",
        name: "Perfil Compartilhado",
        description: "Profile exportado junto ao workspace",
        requiredEnvNames: ["OPENAI_API_KEY"],
        protectedEnvNames: ["OPENAI_API_SECRET"],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  };
  importedPackage.selectedSecretPolicyProfileId = "shared-default";
  importedPackage.defaultSecretPolicyProfileId = "shared-default";

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

  const invalidEnvName = await app.inject({
    method: "POST",
    url: "/sandboxes/reference-interview/start",
    headers: { "content-type": "application/json" },
    payload: { runtimeDir: "generated/reference-interview-runtime", port: 40901, env: { "BAD-NAME": "x" } },
  });
  assert.equal(invalidEnvName.statusCode, 400);
  assert.match(invalidEnvName.json().message, /Env var inválida/);

  const invalidEnvValue = await app.inject({
    method: "POST",
    url: "/sandboxes/reference-interview/start",
    headers: { "content-type": "application/json" },
    payload: { runtimeDir: "generated/reference-interview-runtime", port: 40901, env: { OPENAI_API_KEY: 123 } },
  });
  assert.equal(invalidEnvValue.statusCode, 400);
  assert.match(invalidEnvValue.json().message, /OPENAI_API_KEY deve ser string/);
});
