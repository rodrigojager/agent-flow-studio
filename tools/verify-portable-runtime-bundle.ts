import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseAgentFlow, parseRuntimeManifest } from "@agent-flow-builder/flow-spec";
import { generateManifestRuntime, type ManifestAgentRuntime } from "../packages/codegen-langgraph/src/index.ts";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agent-flow-portable-runtime-bundle-"));
  try {
    const manifestPath = path.join(REPO_ROOT, "runtime.manifest.json");
    const sourceBundle = path.join(tempRoot, "studio-generated", "reference-runtime-bundle");
    const portableBundle = path.join(tempRoot, "consumer-bundle", "reference-runtime-bundle");

    const manifest = parseRuntimeManifest(JSON.parse(await readFile(manifestPath, "utf-8")));
    const agents = await loadManifestAgents(manifest.agents);
    await generateManifestRuntime({
      manifest,
      agents,
      outDir: sourceBundle,
    });

    await cp(sourceBundle, portableBundle, { recursive: true });
    await rm(path.dirname(sourceBundle), { recursive: true, force: true });

    assertOutsideRepo(portableBundle);
    await assertPortableBundleShape(portableBundle, agents.map((agent) => agent.id));

    await execFileAsync("python", ["-m", "pytest", "-q", path.join(portableBundle, "tests", "test_multiagent_bundle.py")], {
      cwd: portableBundle,
      timeout: 180_000,
      maxBuffer: 1024 * 1024 * 4,
    });

    console.log(JSON.stringify({
      status: "ok",
      artifact: "reference-runtime-bundle",
      portableBundle,
      agents: agents.map((agent) => agent.id),
      checks: [
        "copied_outside_workspace",
        "source_generation_removed",
        "root_metadata_without_repo_path",
        "agent_metadata_without_repo_path",
        "bundle_pytest_from_portable_cwd",
      ],
    }, null, 2));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function loadManifestAgents(manifestAgents: Array<{ id: string; flowPath: string; routePrefix: string }>): Promise<ManifestAgentRuntime[]> {
  const agents: ManifestAgentRuntime[] = [];
  for (const agent of manifestAgents) {
    const flowPath = path.resolve(REPO_ROOT, agent.flowPath);
    const flow = parseAgentFlow(JSON.parse(await readFile(flowPath, "utf-8")));
    assert.equal(flow.id, agent.id, `Manifesto referencia agente ${agent.id}, mas o flow tem id ${flow.id}.`);
    agents.push({
      id: agent.id,
      routePrefix: agent.routePrefix,
      flow,
      flowRoot: path.dirname(flowPath),
    });
  }
  return agents;
}

function assertOutsideRepo(portableBundle: string): void {
  const relative = path.relative(REPO_ROOT, portableBundle);
  assert.ok(
    relative.startsWith("..") || path.isAbsolute(relative),
    `bundle portatil deve ficar fora do workspace do Studio: ${portableBundle}`,
  );
}

async function assertPortableBundleShape(portableBundle: string, agentIds: string[]): Promise<void> {
  const requiredFiles = [
    "README.md",
    ".env.example",
    "Dockerfile",
    "docker-compose.yml",
    "pyproject.toml",
    "bundle.json",
    ".agent-flow/generated-meta.json",
    ".runtime-manifest/runtime.manifest.json",
    ".runtime-manifest/agent-isolation.json",
    ".runtime-manifest/orchestration.json",
    "app/main.py",
    "app/worker.py",
    "tests/test_multiagent_bundle.py",
  ];

  for (const relativePath of requiredFiles) {
    await readFile(path.join(portableBundle, relativePath), "utf-8");
  }

  const metadataRaw = await readFile(path.join(portableBundle, ".agent-flow", "generated-meta.json"), "utf-8");
  const metadata = JSON.parse(metadataRaw) as Record<string, unknown>;
  assert.equal(metadata.target, "runtime-manifest-bundle");
  assert.equal(metadata.manifestId, "reference-runtime");
  assert.doesNotMatch(metadataRaw, escapedRepoPathPattern(), "metadata raiz nao deve conter path absoluto do workspace");

  const bundleRaw = await readFile(path.join(portableBundle, "bundle.json"), "utf-8");
  assert.doesNotMatch(bundleRaw, escapedRepoPathPattern(), "bundle.json nao deve conter path absoluto do workspace");
  const bundle = JSON.parse(bundleRaw) as Record<string, unknown>;
  assert.equal(bundle.generatedKind, "runtime-bundle");
  assert.equal(bundle.packaging, "multiagent");

  const isolationRaw = await readFile(path.join(portableBundle, ".runtime-manifest", "agent-isolation.json"), "utf-8");
  assert.doesNotMatch(isolationRaw, escapedRepoPathPattern(), "agent-isolation nao deve conter path absoluto do workspace");
  assert.doesNotMatch(isolationRaw, /OPENAI_API_KEY|Bearer\s+\S+|password\s*[:=]|token\s*[:=]/i, "agent-isolation nao deve conter valores sensiveis");

  const readme = await readFile(path.join(portableBundle, "README.md"), "utf-8");
  assert.match(readme, /docker compose up -d/, "README do bundle deve conter comando operacional fora do Studio");
  assert.match(readme, /\/metadata/, "README do bundle deve mencionar metadata operacional");

  const compose = await readFile(path.join(portableBundle, "docker-compose.yml"), "utf-8");
  assert.match(compose, /api:/, "compose do bundle deve declarar servico api");
  assert.match(compose, /worker:/, "compose do bundle deve declarar worker");
  assert.match(compose, /command:\s*\["python", "-m", "app\.worker"\]/, "worker do bundle deve usar app.worker raiz");
  assert.match(compose, /required:\s*false/, "compose do bundle deve aceitar .env ausente");

  const rootWorker = await readFile(path.join(portableBundle, "app", "worker.py"), "utf-8");
  assert.doesNotMatch(rootWorker, escapedRepoPathPattern(), "worker raiz nao deve conter path absoluto do workspace");
  assert.match(rootWorker, /def process_bundle_jobs/, "worker raiz deve processar todos os agentes");
  assert.match(rootWorker, /_isolated_agent_import/, "worker raiz deve isolar importacao de app.* por agente");

  for (const agentId of agentIds) {
    const agentRoot = path.join(portableBundle, "agents", safeSegment(agentId));
    await readFile(path.join(agentRoot, "README.md"), "utf-8");
    await readFile(path.join(agentRoot, ".agent-flow", "generated-meta.json"), "utf-8");
    await readFile(path.join(agentRoot, "app", "main.py"), "utf-8");
    await readFile(path.join(agentRoot, "tests", "test_generated_runtime.py"), "utf-8");
    const agentMetadataRaw = await readFile(path.join(agentRoot, ".agent-flow", "generated-meta.json"), "utf-8");
    assert.doesNotMatch(
      agentMetadataRaw,
      escapedRepoPathPattern(),
      `metadata do agente ${agentId} nao deve conter path absoluto do workspace`,
    );
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function escapedRepoPathPattern(): RegExp {
  return new RegExp(escapeRegExp(REPO_ROOT.replace(/\\/g, "\\\\")), "i");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
