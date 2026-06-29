import { strict as assert } from "node:assert";
import { access, cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildApp } from "./server.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function createWorkspaceFixture(): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-builder-api-"));
  await mkdir(path.join(workspaceRoot, "flows"), { recursive: true });
  await cp(
    path.join(REPO_ROOT, "flows", "reference-interview"),
    path.join(workspaceRoot, "flows", "reference-interview"),
    { recursive: true },
  );
  return workspaceRoot;
}

test("Builder API lists, validates, reads and generates the reference flow", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const app = buildApp({ workspaceRoot });
  t.after(() => app.close());

  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().status, "ok");

  const flows = await app.inject({ method: "GET", url: "/flows" });
  assert.equal(flows.statusCode, 200);
  assert.equal(flows.json().flows[0].id, "reference-interview");

  const loaded = await app.inject({ method: "GET", url: "/flows/reference-interview" });
  assert.equal(loaded.statusCode, 200);
  assert.equal(loaded.json().flow.id, "reference-interview");

  const validated = await app.inject({ method: "POST", url: "/flows/reference-interview/validate" });
  assert.equal(validated.statusCode, 200);
  assert.equal(validated.json().status, "ok");
  assert.equal(validated.json().nodes, 6);

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

test("Builder API exposes sandbox status and validates runtime directories", async (t) => {
  const workspaceRoot = await createWorkspaceFixture();
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));

  const app = buildApp({ workspaceRoot });
  t.after(() => app.close());

  const status = await app.inject({ method: "GET", url: "/sandboxes/reference-interview/status" });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().running, false);

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
