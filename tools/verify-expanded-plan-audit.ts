import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const REQUIRED_DOCS = [
  "projeto-final.md",
  "docs/implementation-status.md",
  "docs/master-implementation-plan.md",
  "docs/local-studio-plan.md",
  "docs/quickstart-10-min.md",
  "docs/user-guide.md",
  "docs/operator-guide.md",
  "docs/developer-guide.md",
  "docs/local-models-runbook.md",
  "docs/release-privacy-audit.md",
  "docs/external-integrations-homologation.md",
  "docs/isolation-levels-runbook.md",
  "docs/multiagent-operations-runbook.md",
  "docs/expanded-plan-requirement-audit.md",
  "docs/release-gate-matrix.md",
  "README.md",
] as const;

const REQUIRED_RELEASE_GATES = [
  "test:mvp-main-path",
  "test:portable-runtime",
  "test:portable-runtime-auth",
  "test:portable-runtime-bundle",
  "test:onboarding-docs",
  "test:local-models-runbook",
  "test:release-privacy-audit-contract",
  "test:external-integrations-homologation",
  "test:isolation-levels-runbook",
  "test:multiagent-operations-runbook",
  "test:collaboration-conflict-contract",
  "test:expanded-plan-audit",
  "test:expanded-plan-requirement-audit",
  "test:expanded-plan-gate-matrix",
  "test:expanded-plan-evidence-report",
  "test:docker-runtime-smoke",
  "test:builder-api",
  "test:ui-theme",
  "test:codegen",
  "test:multiagent-postgres",
  "test:vm-microvm-real-smoke",
  "test:builder-auth-corporate",
] as const;

const FRONT_KEYWORDS: Record<number, string[]> = {
  1: ["colaboracao", "conflitos", "curationThread", "resolutionHistory", "viewer"],
  2: ["UI", "tema claro", "tema escuro", "viewport", "responsiv"],
  3: ["Studio", "runs", "cenarios", "datasets", "evaluators", "annotation"],
  4: ["ProUp", "complexo", "code", "RAG", "analytics", "scoring"],
  5: ["runtime final", "portable-runtime", "Docker", "worker", "jobs"],
  6: ["multiagente", "orchestration", "handoff", "shared_memory", "agentIsolation"],
  7: ["Ollama", "GPU", "CUDA", "model", "catalogo"],
  8: ["sandbox", "microVM", "Firecracker", "Cloud Hypervisor", "QEMU"],
  9: ["LangSmith", "OIDC", "corporate", "integracoes externas", "token somente no header"],
  10: ["governanca", "redaction", "secrets", "payload bruto", "release"],
  11: ["README", "onboarding", "quickstart", "runbook", "documentacao"],
  12: ["gates", "evidencia", "test:portable-runtime", "test:docker-runtime-smoke", "release"],
};

interface PlanFront {
  number: number;
  title: string;
  startLine: number;
  body: string;
  missingItems: number;
  criteriaItems: number;
}

interface AuditFront {
  number: number;
  title: string;
  planLine: number;
  missingItems: number;
  criteriaItems: number;
  evidenceMatches: string[];
  pendingMatches: string[];
  status: "in_progress" | "needs_status_evidence";
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const docs = await readDocs();
  const fronts = parsePlanFronts(docs["projeto-final.md"]);
  const packageJson = JSON.parse(await readFile(path.join(REPO_ROOT, "package.json"), "utf-8")) as {
    scripts?: Record<string, string>;
  };

  assert.equal(fronts.length, 12, "projeto-final.md deve listar 12 frentes do plano total expandido.");
  assertStatusKeepsMvpAndExpandedPlanSeparate(docs["docs/implementation-status.md"]);
  assertQuickstartCoversMainPath(docs["docs/quickstart-10-min.md"]);
  assertNoUnsupportedTotalCompletionClaim(docs);
  assertReleaseGateScripts(packageJson.scripts ?? {});

  const evidenceCorpus = [
    docs["README.md"],
    docs["docs/implementation-status.md"],
    docs["docs/master-implementation-plan.md"],
    docs["docs/local-studio-plan.md"],
    docs["docs/quickstart-10-min.md"],
  ].join("\n");
  const pendingCorpus = sectionAfter(docs["docs/implementation-status.md"], "## Ainda não implementado");

  const auditFronts = fronts.map((front) => auditFront(front, evidenceCorpus, pendingCorpus));
  const frontsMissingEvidence = auditFronts.filter((front) => front.status === "needs_status_evidence");
  assert.deepEqual(
    frontsMissingEvidence.map((front) => `${front.number}. ${front.title}`),
    [],
    "Toda frente do plano precisa ter ao menos um sinal de status/evidencia nos docs atuais.",
  );
  assert.ok(
    auditFronts.some((front) => front.pendingMatches.length > 0),
    "O audit deve preservar pendencias explicitas do plano expandido em docs/implementation-status.md.",
  );

  const summary = {
    format: "agent-flow-builder.expanded-plan-audit.v1",
    status: "in_progress",
    mvpPrincipal: {
      status: "verified_100_percent",
      evidence: "docs/implementation-status.md separates MVP principal from expanded plan",
    },
    expandedPlan: {
      status: "in_progress",
      fronts: auditFronts.length,
      frontsWithPendingSignals: auditFronts.filter((front) => front.pendingMatches.length > 0).length,
      frontsWithoutPendingSignals: auditFronts.filter((front) => front.pendingMatches.length === 0).length,
      completionClaim: "not_declared",
    },
    releaseGates: REQUIRED_RELEASE_GATES,
    fronts: auditFronts,
  };

  if (options.selfTestReport) {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agent-flow-expanded-plan-report-"));
    try {
      const reportPath = path.join(tempRoot, "expanded-plan-evidence-report.json");
      const report = buildEvidenceReport(summary);
      await writeEvidenceReport(reportPath, report);
      const loaded = JSON.parse(await readFile(reportPath, "utf-8")) as Record<string, unknown>;
      assertEvidenceReport(loaded);
      console.log(JSON.stringify({ status: "ok", reportPath, format: loaded.format }, null, 2));
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
    return;
  }

  if (options.out) {
    await writeEvidenceReport(path.resolve(REPO_ROOT, options.out), buildEvidenceReport(summary));
  }

  console.log(JSON.stringify(summary, null, 2));
}

interface CliOptions {
  out?: string;
  selfTestReport: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { selfTestReport: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--out") {
      options.out = requireValue(args, ++index, arg);
      continue;
    }
    if (arg.startsWith("--out=")) {
      options.out = arg.slice("--out=".length);
      continue;
    }
    if (arg === "--self-test-report") {
      options.selfTestReport = true;
      continue;
    }
    throw new Error(`Argumento desconhecido: ${arg}`);
  }
  return options;
}

function requireValue(args: string[], index: number, name: string): string {
  const value = args[index];
  if (!value) {
    throw new Error(`${name} precisa de valor.`);
  }
  return value;
}

async function readDocs(): Promise<Record<(typeof REQUIRED_DOCS)[number], string>> {
  const entries = await Promise.all(
    REQUIRED_DOCS.map(async (relativePath) => {
      const content = await readFile(path.join(REPO_ROOT, relativePath), "utf-8");
      assert.ok(content.trim(), `${relativePath} nao pode estar vazio.`);
      return [relativePath, content] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<(typeof REQUIRED_DOCS)[number], string>;
}

function parsePlanFronts(plan: string): PlanFront[] {
  const lines = plan.split(/\r?\n/);
  const headings = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^### \d+\. /.test(line));

  return headings.map((heading, itemIndex) => {
    const match = /^### (\d+)\. (.+)$/.exec(heading.line);
    assert.ok(match, `Heading invalido em projeto-final.md:${heading.index + 1}`);
    const nextHeading = headings[itemIndex + 1]?.index ?? lines.findIndex((line, index) => index > heading.index && line.startsWith("## Ordem Recomendada"));
    const bodyLines = lines.slice(heading.index + 1, nextHeading > heading.index ? nextHeading : undefined);
    const body = bodyLines.join("\n");
    const missingBlock = sectionBetween(body, "O que falta:", "Crit");
    const criteriaBlock = sectionAfter(body, "Crit");
    return {
      number: Number(match[1]),
      title: match[2].trim(),
      startLine: heading.index + 1,
      body,
      missingItems: countBullets(missingBlock),
      criteriaItems: countBullets(criteriaBlock),
    };
  });
}

function auditFront(front: PlanFront, evidenceCorpus: string, pendingCorpus: string): AuditFront {
  assert.ok(front.missingItems > 0, `Frente ${front.number} precisa manter lista "O que falta".`);
  assert.ok(front.criteriaItems > 0, `Frente ${front.number} precisa manter criterios de conclusao.`);

  const keywords = FRONT_KEYWORDS[front.number] ?? [front.title];
  const evidenceMatches = keywords.filter((keyword) => containsFolded(evidenceCorpus, keyword));
  const pendingMatches = keywords.filter((keyword) => containsFolded(pendingCorpus, keyword));

  return {
    number: front.number,
    title: front.title,
    planLine: front.startLine,
    missingItems: front.missingItems,
    criteriaItems: front.criteriaItems,
    evidenceMatches,
    pendingMatches,
    status: evidenceMatches.length > 0 ? "in_progress" : "needs_status_evidence",
  };
}

function assertStatusKeepsMvpAndExpandedPlanSeparate(statusDoc: string): void {
  assert.match(statusDoc, /MVP principal.*100%/i, "Status deve preservar MVP principal = 100%.");
  assert.match(
    statusDoc,
    /plano (?:completo|total) expandido.*(?:continua|em andamento|evolu)/i,
    "Status deve deixar o plano expandido como em andamento/evolucao.",
  );
  assert.match(statusDoc, /## Ainda não implementado/i, "Status deve manter secao de pendencias.");
}

function assertNoUnsupportedTotalCompletionClaim(docs: Record<string, string>): void {
  const scannedDocs = ["README.md", "docs/implementation-status.md", "docs/master-implementation-plan.md", "docs/local-studio-plan.md"];
  const forbidden: string[] = [];
  const claimPattern = /plano\s+(?:total|completo(?:\s+expandido)?).{0,80}(?:100%|conclu[ií]do|finalizado)/giu;
  for (const relativePath of scannedDocs) {
    const content = docs[relativePath] ?? "";
    for (const match of content.matchAll(claimPattern)) {
      const text = match[0];
      if (/(nao|não|sem|continua|em andamento|evolu)/i.test(text)) {
        continue;
      }
      forbidden.push(`${relativePath}: ${text}`);
    }
  }
  assert.deepEqual(forbidden, [], "Docs nao podem declarar 100% do plano total sem auditoria requisito por requisito.");
}

function assertReleaseGateScripts(scripts: Record<string, string>): void {
  const missing = REQUIRED_RELEASE_GATES.filter((scriptName) => !scripts[scriptName]);
  assert.deepEqual(missing, [], "package.json precisa manter a matriz minima de gates de evidencia.");
}

function assertQuickstartCoversMainPath(quickstart: string): void {
  for (const requiredText of [
    "npm run dev:builder-api",
    "npm run dev:builder-ui",
    "npm run validate:flow",
    "npm run test:mvp-main-path",
    "docker compose up -d --build",
    "npm run test:docker-runtime-smoke",
    "npm run test:portable-runtime",
    "npm run test:portable-runtime-auth",
    "npm run test:portable-runtime-bundle",
    "npm run test:onboarding-docs",
    "npm run test:local-models-runbook",
    "npm run test:release-privacy-audit-contract",
    "npm run test:external-integrations-homologation",
    "npm run test:isolation-levels-runbook",
    "npm run test:multiagent-operations-runbook",
    "npm run test:collaboration-conflict-contract",
    "npm run test:expanded-plan-audit",
    "npm run test:expanded-plan-requirement-audit",
    "npm run test:expanded-plan-gate-matrix",
    "npm run test:expanded-plan-evidence-report",
  ]) {
    assert.ok(quickstart.includes(requiredText), `quickstart deve incluir ${requiredText}`);
  }
  assert.match(quickstart, /LangSmith Cloud.*opcional/i, "quickstart deve manter LangSmith Cloud opcional.");
  assert.ok(
    quickstart.includes("docs/release-gate-matrix.md"),
    "quickstart deve apontar para a matriz de gates do plano expandido.",
  );
  for (const docPath of [
    "docs/user-guide.md",
    "docs/operator-guide.md",
    "docs/developer-guide.md",
    "docs/local-models-runbook.md",
    "docs/release-privacy-audit.md",
    "docs/external-integrations-homologation.md",
    "docs/isolation-levels-runbook.md",
    "docs/multiagent-operations-runbook.md",
    "docs/expanded-plan-requirement-audit.md",
  ]) {
    assert.ok(quickstart.includes(docPath), `quickstart deve apontar para ${docPath}.`);
  }
  assert.match(
    quickstart,
    /plano total expandido = em andamento/i,
    "quickstart deve separar o plano expandido do MVP.",
  );
}

function buildEvidenceReport(summary: Record<string, any>): Record<string, any> {
  return {
    format: "agent-flow-builder.expanded-plan-evidence-report.v1",
    status: summary.status,
    governance: {
      localFirst: true,
      langSmithCloudOptional: true,
      noTotalCompletionClaim: true,
      noRawPayloadsOrSecrets: true,
      piiSecretScanPolicy: "final_release_or_explicit_request_only",
    },
    mvpPrincipal: summary.mvpPrincipal,
    expandedPlan: summary.expandedPlan,
    requiredDocs: REQUIRED_DOCS,
    dailyGates: ["typecheck", "test:builder-api", "build:builder-ui"],
    gateMatrix: "docs/release-gate-matrix.md",
    releaseGates: summary.releaseGates,
    fronts: summary.fronts,
    completionPolicy: {
      required: "requirement_by_requirement_audit",
      currentClaim: "expanded_plan_in_progress",
      externalDependenciesRemainPending: true,
    },
  };
}

async function writeEvidenceReport(reportPath: string, report: Record<string, any>): Promise<void> {
  const body = JSON.stringify(report, null, 2) + "\n";
  assert.doesNotMatch(body, /Bearer\s+/i, "Relatorio de evidencia nao deve conter bearer tokens.");
  assert.doesNotMatch(body, /X-Agent-API-Key/i, "Relatorio de evidencia nao deve conter headers de auth.");
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, body, "utf-8");
}

function assertEvidenceReport(report: Record<string, unknown>): void {
  assert.equal(report.format, "agent-flow-builder.expanded-plan-evidence-report.v1");
  assert.equal(report.status, "in_progress");
  assert.deepEqual((report.mvpPrincipal as Record<string, unknown>).status, "verified_100_percent");
  assert.deepEqual((report.expandedPlan as Record<string, unknown>).status, "in_progress");
  assert.equal((report.expandedPlan as Record<string, unknown>).completionClaim, "not_declared");
  assert.ok(Array.isArray(report.releaseGates));
  assert.ok((report.releaseGates as string[]).includes("test:expanded-plan-gate-matrix"));
  assert.ok((report.releaseGates as string[]).includes("test:expanded-plan-requirement-audit"));
  assert.ok((report.releaseGates as string[]).includes("test:collaboration-conflict-contract"));
  assert.ok((report.releaseGates as string[]).includes("test:portable-runtime-auth"));
  assert.ok((report.releaseGates as string[]).includes("test:portable-runtime-bundle"));
  assert.ok(Array.isArray(report.fronts));
  assert.equal((report.fronts as unknown[]).length, 12);
  const body = JSON.stringify(report);
  assert.doesNotMatch(body, /Bearer\s+/i);
  assert.doesNotMatch(body, /X-Agent-API-Key/i);
}

function sectionBetween(content: string, startMarker: string, endPrefix: string): string {
  const start = content.indexOf(startMarker);
  if (start < 0) {
    return "";
  }
  const afterStart = content.slice(start + startMarker.length);
  const end = afterStart.search(new RegExp(`\\n${escapeRegExp(endPrefix)}`));
  return end >= 0 ? afterStart.slice(0, end) : afterStart;
}

function sectionAfter(content: string, marker: string): string {
  const start = content.indexOf(marker);
  return start >= 0 ? content.slice(start + marker.length) : "";
}

function countBullets(block: string): number {
  return block.split(/\r?\n/).filter((line) => /^\s*-\s+/.test(line)).length;
}

function containsFolded(content: string, needle: string): boolean {
  return fold(content).includes(fold(needle));
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
