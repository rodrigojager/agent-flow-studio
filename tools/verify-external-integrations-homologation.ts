import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOMOLOGATION_DOC = "docs/external-integrations-homologation.md";
const SCRIPT_NAME = "test:external-integrations-homologation";

async function main(): Promise<void> {
  const [doc, readme, quickstart, statusDoc, gateMatrix, operatorGuide, packageJsonRaw] = await Promise.all([
    readRequired(HOMOLOGATION_DOC),
    readRequired("README.md"),
    readRequired("docs/quickstart-10-min.md"),
    readRequired("docs/implementation-status.md"),
    readRequired("docs/release-gate-matrix.md"),
    readRequired("docs/operator-guide.md"),
    readRequired("package.json"),
  ]);
  const packageJson = JSON.parse(packageJsonRaw) as { scripts?: Record<string, string> };

  assert.ok(packageJson.scripts?.[SCRIPT_NAME], `package.json deve expor ${SCRIPT_NAME}.`);
  assertSharedStatus(doc);
  assertContractCoverage(doc);
  assertLinked(readme, quickstart, statusDoc, gateMatrix, operatorGuide);
  assertNoGovernedLeakage(doc);

  console.log(
    JSON.stringify(
      {
        format: "agent-flow-builder.external-integrations-homologation-contract.v1",
        status: "ok",
        document: HOMOLOGATION_DOC,
        callsExternalServices: false,
        externalEvidence: ["real-corporate-idp", "managed-langsmith-provider"],
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
  assert.ok(content.includes("MVP principal = 100%"), "Doc deve preservar MVP principal = 100%.");
  assert.ok(content.includes("plano total expandido = em andamento"), "Doc deve preservar plano expandido em andamento.");
  assert.match(content, /LangSmith Cloud.*opcional/i, "LangSmith Cloud deve permanecer opcional.");
  assert.match(content, /local-first/i, "Doc deve preservar local-first.");
}

function assertContractCoverage(content: string): void {
  for (const required of [
    "agent-flow-builder.external-integrations-homologation.v1",
    "IdP corporativo real",
    "introspeccao central de sessao",
    "servico corporativo de lifecycle de sessao",
    "sink central de auditoria",
    "diretorio corporativo de grupos",
    "registries remotos de modelo/imagem",
    "deploy gerenciado LangSmith",
    "Tokens externos devem ser enviados somente em header",
    "Falha de integracao externa nao pode quebrar o fluxo local principal",
    "localFirstPreserved",
    "tokensOnlyInHeaders",
    "statusHasNoSensitiveUrlOrToken",
    "cloudOptional",
    "real-corporate-idp",
    "managed-langsmith-provider",
    "npm run test:builder-auth-corporate",
    "npm run test:external-integrations-homologation",
    "nao chama IdP",
  ]) {
    assert.ok(content.includes(required), `Doc deve conter ${required}.`);
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
    assert.ok(content.includes(HOMOLOGATION_DOC), `${name} deve apontar para ${HOMOLOGATION_DOC}.`);
    assert.ok(content.includes(`npm run ${SCRIPT_NAME}`), `${name} deve citar npm run ${SCRIPT_NAME}.`);
  }
}

function assertNoGovernedLeakage(content: string): void {
  assert.doesNotMatch(content, /Bearer\s+/i, "Doc nao deve conter bearer tokens.");
  assert.doesNotMatch(content, /X-Agent-API-Key/i, "Doc nao deve conter header de runtime.");
  assert.doesNotMatch(content, /-----BEGIN [A-Z ]+PRIVATE KEY-----/i, "Doc nao deve conter chave privada.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
