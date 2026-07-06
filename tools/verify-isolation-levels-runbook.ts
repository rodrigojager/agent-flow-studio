import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNBOOK = "docs/isolation-levels-runbook.md";
const SCRIPT_NAME = "test:isolation-levels-runbook";

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

  assert.ok(packageJson.scripts?.[SCRIPT_NAME], `package.json deve expor ${SCRIPT_NAME}.`);
  assertSharedStatus(runbook);
  assertRunbookCoverage(runbook);
  assertLinked(readme, quickstart, statusDoc, gateMatrix, operatorGuide);
  assertNoGovernedLeakage(runbook);

  console.log(
    JSON.stringify(
      {
        format: "agent-flow-builder.isolation-levels-runbook.v1",
        status: "ok",
        runbook: RUNBOOK,
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
  assert.ok(content.includes("plano total expandido = em andamento"), "Runbook deve preservar plano expandido em andamento.");
  assert.match(content, /LangSmith Cloud.*opcional/i, "Runbook deve manter LangSmith Cloud opcional.");
}

function assertRunbookCoverage(content: string): void {
  for (const required of [
    "processo local",
    "workspace efemero",
    "processo dedicado",
    "container",
    "container hardened",
    "VM",
    "microVM",
    "sandboxIsolation=\"vm\"",
    "providesVmIsolation=true",
    "providesVmIsolation=false",
    "agent-flow-vm-runner.v1",
    "fail-closed",
    "npm run test:vm-image-manifest",
    "npm run test:vm-image-bundle",
    "npm run test:vm-qemu-runner",
    "npm run test:vm-microvm-runner",
    "npm run test:vm-image-real-smoke",
    "npm run test:vm-microvm-real-smoke",
    "npm run vm-image:microvm-recipe",
    "npm run vm-image:microvm-register",
    ".afvmimagebundle",
    ".afvmhomologation.json",
    ".afvmrelease.json",
  ]) {
    assert.ok(content.includes(required), `Runbook deve conter ${required}.`);
  }
}

function assertLinked(
  readme: string,
  quickstart: string,
  statusDoc: string,
  gateMatrix: string,
  operatorGuide: string,
): void {
  for (const [name, content] of [
    ["README.md", readme],
    ["docs/quickstart-10-min.md", quickstart],
    ["docs/implementation-status.md", statusDoc],
    ["docs/release-gate-matrix.md", gateMatrix],
    ["docs/operator-guide.md", operatorGuide],
  ] as const) {
    assert.ok(content.includes(RUNBOOK), `${name} deve apontar para ${RUNBOOK}.`);
    assert.ok(content.includes(`npm run ${SCRIPT_NAME}`), `${name} deve citar npm run ${SCRIPT_NAME}.`);
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
