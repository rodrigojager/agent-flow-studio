import { strict as assert } from "node:assert";
import { access, cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildApp } from "./server.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function createWorkspaceFixture() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-builder-api-approved-manifest-"));
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

test("Builder API generates an approved runtime manifest bundle with embedded approvals", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const app = buildApp({ workspaceRoot });

  const blockedBundle = await app.inject({
    method: "POST",
    url: "/runtime-manifest/generate-approved",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/reference-runtime-bundle-approved" },
  });
  assert.equal(blockedBundle.statusCode, 409);

  const sandbox = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/generate-langgraph-sandbox",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/reference-interview-langgraph-sandbox" },
  });
  assert.equal(sandbox.statusCode, 200);

  const approval = await app.inject({
    method: "POST",
    url: "/flows/reference-interview/approve-langgraph-sandbox",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/reference-interview-langgraph-sandbox" },
  });
  assert.equal(approval.statusCode, 200);
  assert.equal(approval.json().approval.status, "approved");

  const approvedBundle = await app.inject({
    method: "POST",
    url: "/runtime-manifest/generate-approved",
    headers: { "content-type": "application/json" },
    payload: { outDir: "generated/reference-runtime-bundle-approved" },
  });
  assert.equal(approvedBundle.statusCode, 200);
  assert.equal(approvedBundle.json().outDir, "generated/reference-runtime-bundle-approved");
  assert.equal(approvedBundle.json().approvalPackagePath, ".agent-flow/langgraph-sandbox-approval.json");
  assert.equal(approvedBundle.json().approvals.length, 1);
  assert.equal(approvedBundle.json().approvals[0].flowId, "reference-interview");

  await access(path.join(
    workspaceRoot,
    "generated",
    "reference-runtime-bundle-approved",
    ".agent-flow",
    "langgraph-sandbox-approval.json",
  ));
  await access(path.join(
    workspaceRoot,
    "generated",
    "reference-runtime-bundle-approved",
    "agents",
    "reference-interview",
    ".agent-flow",
    "langgraph-sandbox-approval.json",
  ));

  const artifacts = await app.inject({
    method: "GET",
    url: "/artifacts?outDir=generated%2Freference-runtime-bundle-approved",
  });
  assert.equal(artifacts.statusCode, 200);
  assert.equal(artifacts.json().exportAudit.target, "runtime-manifest-bundle");
  assert.equal(artifacts.json().exportAudit.ready, true);
  assert.deepEqual(artifacts.json().exportAudit.blockers, []);
  assert.equal(
    artifacts.json().exportAudit.requiredFiles.some(
      (file) => file.path === ".agent-flow/langgraph-sandbox-approval.json" && file.present,
    ),
    true,
  );

  const archive = await app.inject({
    method: "GET",
    url: "/artifacts/archive?outDir=generated%2Freference-runtime-bundle-approved",
  });
  assert.equal(archive.statusCode, 200);
  assert.match(String(archive.headers["content-type"]), /application\/zip/);
  assert.equal(archive.body.slice(0, 2), "PK");
  assert.match(archive.body, /reference-runtime-bundle-approved\/\.agent-flow\/export-manifest\.json/);
  assert.match(archive.body, /reference-runtime-bundle-approved\/\.agent-flow\/langgraph-sandbox-approval\.json/);
  assert.match(archive.body, /"target": "runtime-manifest-bundle"/);
});
