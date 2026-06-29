import { strict as assert } from "node:assert";
import { access, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  await cp(path.join(REPO_ROOT, "runtime.manifest.json"), path.join(workspaceRoot, "runtime.manifest.json"));
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

  const outsideGenerated = await app.inject({ method: "GET", url: "/artifacts?outDir=flows%2Freference-interview" });
  assert.equal(outsideGenerated.statusCode, 400);
  assert.equal(outsideGenerated.json().error, "workspace_error");

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

  const validated = await app.inject({ method: "POST", url: "/runtime-manifest/validate" });
  assert.equal(validated.statusCode, 200);
  assert.equal(validated.json().status, "ok");
  assert.equal(validated.json().agents[0].flowId, "reference-interview");

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
