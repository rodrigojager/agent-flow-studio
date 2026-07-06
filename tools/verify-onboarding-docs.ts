import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DOCS = {
  user: "docs/user-guide.md",
  operator: "docs/operator-guide.md",
  developer: "docs/developer-guide.md",
} as const;

async function main(): Promise<void> {
  const [userGuide, operatorGuide, developerGuide, readme, quickstart, statusDoc, packageJsonRaw] = await Promise.all([
    readRequired(DOCS.user),
    readRequired(DOCS.operator),
    readRequired(DOCS.developer),
    readRequired("README.md"),
    readRequired("docs/quickstart-10-min.md"),
    readRequired("docs/implementation-status.md"),
    readRequired("package.json"),
  ]);
  const packageJson = JSON.parse(packageJsonRaw) as { scripts?: Record<string, string> };

  assert.ok(packageJson.scripts?.["test:onboarding-docs"], "package.json deve expor test:onboarding-docs.");
  assertSharedStatus(userGuide, DOCS.user);
  assertSharedStatus(operatorGuide, DOCS.operator);
  assertSharedStatus(developerGuide, DOCS.developer);
  assertUserGuide(userGuide);
  assertOperatorGuide(operatorGuide);
  assertDeveloperGuide(developerGuide);
  assertMainDocsLinkGuides(readme, quickstart, statusDoc);
  assertNoGovernedLeakage(`${userGuide}\n${operatorGuide}\n${developerGuide}`);

  console.log(
    JSON.stringify(
      {
        format: "agent-flow-builder.onboarding-docs.v1",
        status: "ok",
        docs: Object.values(DOCS),
        mvpPrincipal: "verified_100_percent",
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

function assertSharedStatus(content: string, relativePath: string): void {
  assert.ok(content.includes("MVP principal = 100%"), `${relativePath} deve preservar MVP principal = 100%.`);
  assert.ok(
    content.includes("plano total expandido = em andamento"),
    `${relativePath} deve preservar plano total expandido = em andamento.`,
  );
  assert.match(content, /LangSmith Cloud.*opcional/i, `${relativePath} deve manter LangSmith Cloud opcional.`);
}

function assertUserGuide(content: string): void {
  for (const required of [
    "Desenhar -> Testar -> Depurar -> Aprovar -> Gerar API Docker",
    "npm run dev:builder-api",
    "npm run dev:builder-ui",
    "npm run validate:flow",
    "npm run test:mvp-main-path",
    "docs/quickstart-10-min.md",
  ]) {
    assert.ok(content.includes(required), `docs/user-guide.md deve conter ${required}.`);
  }
}

function assertOperatorGuide(content: string): void {
  for (const required of [
    "docker compose up -d --build",
    "npm run test:portable-runtime",
    "npm run test:portable-runtime-auth",
    "npm run test:portable-runtime-bundle",
    "npm run test:docker-runtime-smoke",
    "AUTH_ENABLED=true",
    "docs/release-gate-matrix.md",
    "Nao rode scan de PII/secrets a cada alteracao",
  ]) {
    assert.ok(content.includes(required), `docs/operator-guide.md deve conter ${required}.`);
  }
}

function assertDeveloperGuide(content: string): void {
  for (const required of [
    "apps/builder-api/src/server.ts",
    "apps/builder-ui/src/App.tsx",
    "packages/flow-spec",
    "packages/codegen-langgraph",
    "npm run typecheck",
    "npm run test:builder-api",
    "npm run build:builder-ui",
    "git diff --check",
    "npm run test:onboarding-docs",
    "Nao mexa em CyberVinci",
    "Nao faca push automatico",
    "Nao rode scan de PII/secrets a cada alteracao",
  ]) {
    assert.ok(content.includes(required), `docs/developer-guide.md deve conter ${required}.`);
  }
}

function assertMainDocsLinkGuides(readme: string, quickstart: string, statusDoc: string): void {
  for (const docPath of Object.values(DOCS)) {
    assert.ok(readme.includes(docPath), `README.md deve apontar para ${docPath}.`);
    assert.ok(quickstart.includes(docPath), `docs/quickstart-10-min.md deve apontar para ${docPath}.`);
    assert.ok(statusDoc.includes(docPath), `docs/implementation-status.md deve apontar para ${docPath}.`);
  }
}

function assertNoGovernedLeakage(content: string): void {
  assert.doesNotMatch(content, /Bearer\s+/i, "Guias nao devem conter bearer tokens.");
  assert.doesNotMatch(content, /X-Agent-API-Key/i, "Guias nao devem conter header de runtime.");
  assert.doesNotMatch(content, /-----BEGIN [A-Z ]+PRIVATE KEY-----/i, "Guias nao devem conter chave privada.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
