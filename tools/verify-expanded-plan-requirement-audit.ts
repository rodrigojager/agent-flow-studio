import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_PATH = "projeto-final.md";

const REQUIRED_REFERENCE_DOCS = [
  "README.md",
  "docs/implementation-status.md",
  "docs/quickstart-10-min.md",
  "docs/developer-guide.md",
  "docs/release-gate-matrix.md",
  "docs/expanded-plan-requirement-audit.md",
] as const;

const COMMAND = "npm run test:expanded-plan-requirement-audit";
const AUDIT_DOC = "docs/expanded-plan-requirement-audit.md";
const FORMAT = "agent-flow-builder.expanded-plan-requirement-audit.v1";

interface RequirementItem {
  id: string;
  front: number;
  source: "missing" | "criterion";
  sourceLine: string;
  contentHash: string;
  status: "pending" | "completion_criterion";
}

interface FrontAudit {
  number: number;
  title: string;
  sourceLine: string;
  status: "in_progress";
  missingCount: number;
  criteriaCount: number;
  requirementIds: string[];
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const packageJson = JSON.parse(await readFile(path.join(REPO_ROOT, "package.json"), "utf-8")) as {
    scripts?: Record<string, string>;
  };
  const plan = await readFile(path.join(REPO_ROOT, PLAN_PATH), "utf-8");
  const docs = await readReferenceDocs();

  assert.equal(
    packageJson.scripts?.["test:expanded-plan-requirement-audit"],
    "tsx tools/verify-expanded-plan-requirement-audit.ts",
    "package.json precisa expor test:expanded-plan-requirement-audit.",
  );

  assertDocsReferenceRequirementAudit(docs);

  const parsedFronts = parsePlan(plan);
  assert.equal(parsedFronts.length, 12, "projeto-final.md deve manter 12 frentes auditaveis.");

  const fronts: FrontAudit[] = [];
  const requirements: RequirementItem[] = [];
  const seenIds = new Set<string>();
  const seenHashes = new Set<string>();

  for (const front of parsedFronts) {
    assert.ok(front.missing.length > 0, `Frente ${front.number} precisa manter itens em "O que falta".`);
    assert.ok(front.criteria.length > 0, `Frente ${front.number} precisa manter criterios de conclusao.`);

    const frontRequirements = [
      ...front.missing.map((item, index) => requirementFromBullet(front.number, "missing", index + 1, item)),
      ...front.criteria.map((item, index) => requirementFromBullet(front.number, "criterion", index + 1, item)),
    ];

    for (const requirement of frontRequirements) {
      assert.ok(!seenIds.has(requirement.id), `ID duplicado no audit: ${requirement.id}`);
      seenIds.add(requirement.id);
      seenHashes.add(requirement.contentHash);
    }

    fronts.push({
      number: front.number,
      title: front.title,
      sourceLine: `${PLAN_PATH}:${front.line}`,
      status: "in_progress",
      missingCount: front.missing.length,
      criteriaCount: front.criteria.length,
      requirementIds: frontRequirements.map((requirement) => requirement.id),
    });
    requirements.push(...frontRequirements);
  }

  assert.ok(requirements.length >= 70, "A auditoria requisito-a-requisito deve cobrir uma lista expandida substancial.");

  const report = {
    format: FORMAT,
    status: "in_progress",
    mvpPrincipal: "verified_100_percent",
    expandedPlan: "in_progress",
    completionClaim: "not_declared",
    source: PLAN_PATH,
    governance: {
      localFirst: true,
      langSmithCloudOptional: true,
      noRawRequirementText: true,
      noRawPayloadsHeadersTokensOrSecrets: true,
      piiSecretScanPolicy: "final_release_or_explicit_request_only",
    },
    totals: {
      fronts: fronts.length,
      requirements: requirements.length,
      missing: requirements.filter((requirement) => requirement.source === "missing").length,
      criteria: requirements.filter((requirement) => requirement.source === "criterion").length,
      duplicateContentHashes: requirements.length - seenHashes.size,
    },
    fronts,
    requirements,
  };

  assertGovernedReport(report);

  if (options.out) {
    const outPath = path.resolve(REPO_ROOT, options.out);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  }

  console.log(JSON.stringify(report, null, 2));
}

interface ParsedFront {
  number: number;
  title: string;
  line: number;
  missing: BulletItem[];
  criteria: BulletItem[];
}

interface BulletItem {
  text: string;
  line: number;
}

interface CliOptions {
  out?: string;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {};
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

async function readReferenceDocs(): Promise<Record<(typeof REQUIRED_REFERENCE_DOCS)[number], string>> {
  const entries = await Promise.all(
    REQUIRED_REFERENCE_DOCS.map(async (relativePath) => {
      const content = await readFile(path.join(REPO_ROOT, relativePath), "utf-8");
      assert.ok(content.trim(), `${relativePath} nao pode estar vazio.`);
      return [relativePath, content] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<(typeof REQUIRED_REFERENCE_DOCS)[number], string>;
}

function parsePlan(plan: string): ParsedFront[] {
  const lines = plan.split(/\r?\n/);
  const headingIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^### \d+\. /.test(line));

  return headingIndexes.map((heading, headingPosition) => {
    const match = /^### (\d+)\. (.+)$/.exec(heading.line);
    assert.ok(match, `Heading invalido em ${PLAN_PATH}:${heading.index + 1}`);
    const nextHeading = headingIndexes[headingPosition + 1]?.index ?? lines.length;
    const body = lines.slice(heading.index + 1, nextHeading).map((line, offset) => ({
      text: line,
      line: heading.index + 2 + offset,
    }));
    const missingMarkerIndex = body.findIndex((line) => fold(line.text).trim().startsWith("o que falta:"));
    const criteriaMarkerIndex = body.findIndex((line) => fold(line.text).trim().startsWith("criterios de conclusao:"));
    assert.ok(missingMarkerIndex >= 0, `Frente ${match[1]} precisa de secao "O que falta".`);
    assert.ok(criteriaMarkerIndex > missingMarkerIndex, `Frente ${match[1]} precisa de "Criterios de conclusao".`);

    return {
      number: Number(match[1]),
      title: match[2].trim(),
      line: heading.index + 1,
      missing: collectBullets(body.slice(missingMarkerIndex + 1, criteriaMarkerIndex)),
      criteria: collectBullets(body.slice(criteriaMarkerIndex + 1)),
    };
  });
}

function collectBullets(lines: Array<{ text: string; line: number }>): BulletItem[] {
  return lines.flatMap((line) => {
    const match = /^\s*-\s+(.+)$/.exec(line.text);
    if (!match) {
      return [];
    }
    return [{ text: normalizeRequirementText(match[1]), line: line.line }];
  });
}

function requirementFromBullet(
  front: number,
  source: RequirementItem["source"],
  index: number,
  item: BulletItem,
): RequirementItem {
  const id = `front-${String(front).padStart(2, "0")}-${source}-${String(index).padStart(3, "0")}`;
  return {
    id,
    front,
    source,
    sourceLine: `${PLAN_PATH}:${item.line}`,
    contentHash: hashRequirement(item.text),
    status: source === "missing" ? "pending" : "completion_criterion",
  };
}

function assertDocsReferenceRequirementAudit(docs: Record<string, string>): void {
  for (const [relativePath, content] of Object.entries(docs)) {
    assert.ok(content.includes(COMMAND), `${relativePath} deve citar ${COMMAND}.`);
    assert.ok(content.includes(AUDIT_DOC), `${relativePath} deve citar ${AUDIT_DOC}.`);
  }

  const auditDoc = docs[AUDIT_DOC];
  for (const requiredText of [
    FORMAT,
    "MVP principal = 100%",
    "plano total expandido = em andamento",
    "IDs estaveis",
    "sem texto bruto",
    "sem payload bruto",
    "sem tokens",
  ]) {
    assert.ok(auditDoc.includes(requiredText), `${AUDIT_DOC} deve documentar ${requiredText}.`);
  }
}

function assertGovernedReport(report: Record<string, unknown>): void {
  const body = JSON.stringify(report);
  assert.doesNotMatch(body, /Bearer\s+/i, "Audit nao deve conter bearer tokens.");
  assert.doesNotMatch(body, /X-Agent-API-Key/i, "Audit nao deve conter headers de auth.");
  assert.doesNotMatch(body, /-----BEGIN [A-Z ]+PRIVATE KEY-----/i, "Audit nao deve conter chave privada.");
  assert.doesNotMatch(body, /schema\s*:/i, "Audit nao deve copiar schema bruto.");
  assert.doesNotMatch(body, /prompt\s*:/i, "Audit nao deve copiar prompt bruto.");
  assert.equal(report.format, FORMAT);
  assert.equal(report.status, "in_progress");
  assert.equal(report.expandedPlan, "in_progress");
  assert.equal(report.completionClaim, "not_declared");
}

function normalizeRequirementText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function hashRequirement(value: string): string {
  return createHash("sha256").update(value, "utf-8").digest("hex").slice(0, 16);
}

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
