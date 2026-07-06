import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNBOOK = "docs/local-models-runbook.md";

async function main(): Promise<void> {
  const [runbook, readme, quickstart, statusDoc, gateMatrix, operatorGuide, packageJsonRaw] = await Promise.all([
    readRequired(RUNBOOK),
    readRequired("README.md"),
    readRequired("docs/quickstart-10-min.md"),
    readRequired("docs/implementation-status.md"),
    readRequired("docs/release-gate-matrix.md"),
    readRequired("docs/operator-guide.md"),
    readRequired("package.json"),
  ]);
  const packageJson = JSON.parse(packageJsonRaw) as { scripts?: Record<string, string> };

  assert.ok(packageJson.scripts?.["test:local-models-runbook"], "package.json deve expor test:local-models-runbook.");
  assertSharedStatus(runbook);
  assertRunbookCoverage(runbook);
  assertMainDocsLinkRunbook(readme, quickstart, statusDoc, operatorGuide);
  assert.ok(gateMatrix.includes("npm run test:local-models-runbook"), "Matriz deve incluir test:local-models-runbook.");
  assert.ok(gateMatrix.includes("real-model-gpu-matrix"), "Matriz deve manter evidencia externa real-model-gpu-matrix.");
  assertNoGovernedLeakage(runbook);

  console.log(
    JSON.stringify(
      {
        format: "agent-flow-builder.local-models-runbook.v1",
        status: "ok",
        runbook: RUNBOOK,
        externalEvidence: "real-model-gpu-matrix",
        expandedPlan: "in_progress",
      },
      null,
      2,
    ),
  );
}

async function readRequired(relativePath: string): Promise<string> {
  const content = await readFile(path.join(REPO_ROOT, relativePath), "utf-8");
  assert.ok(content.trim(), `${relativePath} nao pode estar vazio.`);
  return content;
}

function assertSharedStatus(content: string): void {
  assert.ok(content.includes("MVP principal = 100%"), "Runbook deve preservar MVP principal = 100%.");
  assert.ok(
    content.includes("plano total expandido = em andamento"),
    "Runbook deve preservar plano total expandido = em andamento.",
  );
  assert.match(content, /LangSmith Cloud.*opcional/i, "Runbook deve manter LangSmith Cloud opcional.");
}

function assertRunbookCoverage(content: string): void {
  for (const required of [
    "Ollama",
    "ollama pull qwen3:8b",
    "OLLAMA_BASE_URL=http://localhost:11434/v1",
    "OLLAMA_API_KEY=ollama",
    "LLM_MODEL=qwen3:8b",
    "MOCK_LLM=false",
    "model-setup",
    "docker-compose.gpu.yml",
    "nvidia-smi",
    "NVIDIA Container Toolkit",
    "docker image push",
    ".tar",
    "AGENT_FLOW_MODEL_IMAGE_CATALOG_CENTRAL_URL",
    "npm run test:local-models-runbook",
    "docs/release-gate-matrix.md",
    "real-model-gpu-matrix",
  ]) {
    assert.ok(content.includes(required), `Runbook deve conter ${required}.`);
  }
}

function assertMainDocsLinkRunbook(readme: string, quickstart: string, statusDoc: string, operatorGuide: string): void {
  for (const [name, content] of [
    ["README.md", readme],
    ["docs/quickstart-10-min.md", quickstart],
    ["docs/implementation-status.md", statusDoc],
    ["docs/operator-guide.md", operatorGuide],
  ] as const) {
    assert.ok(content.includes(RUNBOOK), `${name} deve apontar para ${RUNBOOK}.`);
  }
}

function assertNoGovernedLeakage(content: string): void {
  assert.doesNotMatch(content, /Bearer\s+/i, "Runbook nao deve conter bearer tokens.");
  assert.doesNotMatch(content, /X-Agent-API-Key/i, "Runbook nao deve conter header de runtime.");
  assert.doesNotMatch(content, /-----BEGIN [A-Z ]+PRIVATE KEY-----/i, "Runbook nao deve conter chave privada.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
