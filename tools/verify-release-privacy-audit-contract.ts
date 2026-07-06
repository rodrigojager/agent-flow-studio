import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUDIT_DOC = "docs/release-privacy-audit.md";
const SCRIPT_NAME = "test:release-privacy-audit-contract";

async function main(): Promise<void> {
  const [auditDoc, readme, quickstart, statusDoc, gateMatrix, developerGuide, packageJsonRaw] = await Promise.all([
    readRequired(AUDIT_DOC),
    readRequired("README.md"),
    readRequired("docs/quickstart-10-min.md"),
    readRequired("docs/implementation-status.md"),
    readRequired("docs/release-gate-matrix.md"),
    readRequired("docs/developer-guide.md"),
    readRequired("package.json"),
  ]);
  const packageJson = JSON.parse(packageJsonRaw) as { scripts?: Record<string, string> };

  assert.ok(packageJson.scripts?.[SCRIPT_NAME], `package.json deve expor ${SCRIPT_NAME}.`);
  assertSharedStatus(auditDoc);
  assertAuditContract(auditDoc);
  assertLinked(readme, quickstart, statusDoc, gateMatrix, developerGuide);
  assertNoGovernedLeakage(auditDoc);

  console.log(
    JSON.stringify(
      {
        format: "agent-flow-builder.release-privacy-audit-contract.v1",
        status: "ok",
        auditDocument: AUDIT_DOC,
        doesNotRunScan: true,
        externalEvidence: "final-release-privacy-audit",
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
  assert.ok(content.includes("MVP principal = 100%"), "Audit doc deve preservar MVP principal = 100%.");
  assert.ok(
    content.includes("plano total expandido = em andamento"),
    "Audit doc deve preservar plano total expandido = em andamento.",
  );
  assert.match(content, /LangSmith Cloud.*opcional/i, "Audit doc deve manter LangSmith Cloud opcional.");
  assert.match(
    content,
    /Nao rode scan de PII\/secrets a cada alteracao/i,
    "Audit doc deve manter politica de nao escanear por rodada.",
  );
}

function assertAuditContract(content: string): void {
  for (const required of [
    "agent-flow-builder.final-release-privacy-audit.v1",
    "secrets reais",
    "arquivos `.env`",
    "tokens",
    "paths locais",
    "PII em exemplos",
    "payloads brutos em exports governados",
    "headers em status/export",
    "logs/status com segredos",
    "pacotes exportados principais",
    "generated artifacts",
    "schema bruto",
    "prompt bruto",
    "input/output bruto",
    "local-only",
    "npm run test:release-privacy-audit-contract",
    "nao executa scan",
    "final-release-privacy-audit",
  ]) {
    assert.ok(content.includes(required), `Audit doc deve conter ${required}.`);
  }
}

function assertLinked(
  readme: string,
  quickstart: string,
  statusDoc: string,
  gateMatrix: string,
  developerGuide: string,
): void {
  for (const [name, content] of [
    ["README.md", readme],
    ["docs/quickstart-10-min.md", quickstart],
    ["docs/implementation-status.md", statusDoc],
    ["docs/release-gate-matrix.md", gateMatrix],
    ["docs/developer-guide.md", developerGuide],
  ] as const) {
    assert.ok(content.includes(AUDIT_DOC), `${name} deve apontar para ${AUDIT_DOC}.`);
    assert.ok(content.includes(`npm run ${SCRIPT_NAME}`), `${name} deve citar npm run ${SCRIPT_NAME}.`);
  }
}

function assertNoGovernedLeakage(content: string): void {
  assert.doesNotMatch(content, /Bearer\s+/i, "Audit doc nao deve conter bearer tokens.");
  assert.doesNotMatch(content, /X-Agent-API-Key/i, "Audit doc nao deve conter header de runtime.");
  assert.doesNotMatch(content, /-----BEGIN [A-Z ]+PRIVATE KEY-----/i, "Audit doc nao deve conter chave privada.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
