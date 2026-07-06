import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MATRIX_DOC = "docs/release-gate-matrix.md";

interface GateGroup {
  id: string;
  label: string;
  scope: "daily" | "expanded-plan-governance" | "local-release" | "opt-in-release";
  releaseBlocking: boolean;
  commands: string[];
}

interface ManualEvidence {
  id: string;
  label: string;
  releaseBlocking: boolean;
}

const GATE_GROUPS: GateGroup[] = [
  {
    id: "daily-development",
    label: "Daily development",
    scope: "daily",
    releaseBlocking: false,
    commands: ["npm run typecheck", "npm run test:builder-api", "npm run build:builder-ui"],
  },
  {
    id: "expanded-plan-governance",
    label: "Expanded plan governance",
    scope: "expanded-plan-governance",
    releaseBlocking: true,
    commands: [
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
    ],
  },
  {
    id: "core-local-release",
    label: "Core local release",
    scope: "local-release",
    releaseBlocking: true,
    commands: [
      "npm run test:mvp-main-path",
      "npm run test:portable-runtime",
      "npm run test:portable-runtime-auth",
      "npm run test:portable-runtime-bundle",
      "npm run test:docker-runtime-smoke",
      "npm run test:codegen",
      "npm run test:multiagent-postgres",
      "npm run test:builder-auth-corporate",
      "npm run test:ui-theme",
    ],
  },
  {
    id: "vm-microvm-release",
    label: "VM and microVM release",
    scope: "opt-in-release",
    releaseBlocking: true,
    commands: [
      "npm run test:vm-image-manifest",
      "npm run test:vm-image-bundle",
      "npm run test:vm-image-scaffold",
      "npm run test:vm-microvm-image-scaffold",
      "npm run test:vm-image-real-smoke",
      "npm run test:vm-microvm-real-smoke",
      "npm run test:vm-microvm-homologation",
      "npm run test:vm-microvm-official-recipe",
      "npm run test:vm-microvm-release-registration",
      "npm run test:vm-reference-runner",
      "npm run test:vm-qemu-runner",
      "npm run test:vm-microvm-runner",
      "npm run test:vm-guest-agent",
    ],
  },
];

const MANUAL_EVIDENCE: ManualEvidence[] = [
  {
    id: "real-model-gpu-matrix",
    label: "Real CPU/GPU/local model matrix",
    releaseBlocking: true,
  },
  {
    id: "real-corporate-idp",
    label: "Real corporate IdP and session services",
    releaseBlocking: true,
  },
  {
    id: "managed-langsmith-provider",
    label: "Managed LangSmith provider, only if selected by operator",
    releaseBlocking: false,
  },
  {
    id: "final-release-privacy-audit",
    label: "Final release privacy and secrets audit",
    releaseBlocking: true,
  },
];

async function main(): Promise<void> {
  const packageJson = JSON.parse(await readFile(path.join(REPO_ROOT, "package.json"), "utf-8")) as {
    scripts?: Record<string, string>;
  };
  const matrixDoc = await readFile(path.join(REPO_ROOT, MATRIX_DOC), "utf-8");
  const readme = await readFile(path.join(REPO_ROOT, "README.md"), "utf-8");
  const quickstart = await readFile(path.join(REPO_ROOT, "docs/quickstart-10-min.md"), "utf-8");
  const statusDoc = await readFile(path.join(REPO_ROOT, "docs/implementation-status.md"), "utf-8");

  assertGateScriptsExist(packageJson.scripts ?? {});
  assertMatrixDocCoversContract(matrixDoc);
  assertMainDocsLinkMatrix(readme, quickstart, statusDoc);
  assertNoGovernedLeakage(matrixDoc);

  const summary = {
    format: "agent-flow-builder.expanded-plan-gate-matrix.v1",
    status: "in_progress",
    mvpPrincipal: "verified_100_percent",
    expandedPlan: "in_progress",
    groups: GATE_GROUPS.map((group) => ({
      id: group.id,
      scope: group.scope,
      releaseBlocking: group.releaseBlocking,
      commandCount: group.commands.length,
    })),
    manualEvidence: MANUAL_EVIDENCE,
    commandCount: GATE_GROUPS.reduce((total, group) => total + group.commands.length, 0),
  };

  console.log(JSON.stringify(summary, null, 2));
}

function assertGateScriptsExist(scripts: Record<string, string>): void {
  const missingScripts = GATE_GROUPS.flatMap((group) =>
    group.commands
      .map((command) => command.replace(/^npm run\s+/, ""))
      .filter((scriptName) => !scripts[scriptName])
      .map((scriptName) => `${group.id}:${scriptName}`),
  );
  assert.deepEqual(missingScripts, [], "Toda entrada de gate automatizado deve existir em package.json.");
}

function assertMatrixDocCoversContract(matrixDoc: string): void {
  assert.match(matrixDoc, /MVP principal = 100%/, "A matriz deve preservar o status do MVP principal.");
  assert.match(
    matrixDoc,
    /plano total expandido = em andamento/,
    "A matriz deve preservar o plano expandido como em andamento.",
  );
  assert.match(matrixDoc, /LangSmith Cloud.*opcional/i, "LangSmith Cloud deve continuar opcional.");
  assert.match(
    matrixDoc,
    /Nao rode scan de PII\/secrets a cada alteracao/i,
    "A matriz deve manter a politica de nao rodar scan de PII/secrets a cada alteracao.",
  );
  assert.match(
    matrixDoc,
    /auditoria requisito por requisito/i,
    "A matriz deve bloquear claim de 100% total sem auditoria requisito por requisito.",
  );

  for (const group of GATE_GROUPS) {
    assert.ok(matrixDoc.includes(group.id), `Matriz deve documentar o grupo ${group.id}.`);
    for (const command of group.commands) {
      assert.ok(matrixDoc.includes(command), `Matriz deve documentar ${command}.`);
    }
  }

  for (const evidence of MANUAL_EVIDENCE) {
    assert.ok(matrixDoc.includes(evidence.id), `Matriz deve documentar evidencia manual ${evidence.id}.`);
  }
}

function assertMainDocsLinkMatrix(readme: string, quickstart: string, statusDoc: string): void {
  for (const [name, content] of [
    ["README.md", readme],
    ["docs/quickstart-10-min.md", quickstart],
    ["docs/implementation-status.md", statusDoc],
  ] as const) {
    assert.ok(content.includes(MATRIX_DOC), `${name} deve apontar para ${MATRIX_DOC}.`);
    assert.ok(
      content.includes("npm run test:expanded-plan-gate-matrix"),
      `${name} deve citar o gate test:expanded-plan-gate-matrix.`,
    );
  }
}

function assertNoGovernedLeakage(matrixDoc: string): void {
  assert.doesNotMatch(matrixDoc, /Bearer\s+/i, "Matriz nao deve conter bearer tokens.");
  assert.doesNotMatch(matrixDoc, /X-Agent-API-Key/i, "Matriz nao deve conter headers de runtime.");
  assert.doesNotMatch(matrixDoc, /-----BEGIN [A-Z ]+PRIVATE KEY-----/i, "Matriz nao deve conter chave privada.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
