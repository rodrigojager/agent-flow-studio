import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseAgentFlow } from "@agent-flow-builder/flow-spec";
import { generateLangGraphRuntime } from "../packages/codegen-langgraph/src/index.ts";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agent-flow-portable-runtime-"));
  try {
    const flowPath = path.join(REPO_ROOT, "flows", "reference-interview", "agent.flow.json");
    const sourceRuntime = path.join(tempRoot, "studio-generated", "reference-interview-runtime");
    const portableRuntime = path.join(tempRoot, "consumer-runtime", "reference-interview-runtime");

    const flow = parseAgentFlow(JSON.parse(await readFile(flowPath, "utf-8")));
    await generateLangGraphRuntime({
      flow,
      flowRoot: path.dirname(flowPath),
      outDir: sourceRuntime,
    });

    await cp(sourceRuntime, portableRuntime, { recursive: true });
    await rm(path.dirname(sourceRuntime), { recursive: true, force: true });

    assertOutsideRepo(portableRuntime);
    await assertPortableRuntimeShape(portableRuntime);

    await execFileAsync("python", ["-m", "pytest", "-q", portableRuntime], {
      cwd: portableRuntime,
      timeout: 180_000,
      maxBuffer: 1024 * 1024 * 4,
    });

    console.log(JSON.stringify({
      status: "ok",
      artifact: "reference-interview-runtime",
      portableRuntime,
      checks: [
        "copied_outside_workspace",
        "source_generation_removed",
        "metadata_without_repo_path",
        "pytest_from_portable_cwd",
      ],
    }, null, 2));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function assertOutsideRepo(portableRuntime: string): void {
  const relative = path.relative(REPO_ROOT, portableRuntime);
  assert.ok(
    relative.startsWith("..") || path.isAbsolute(relative),
    `portable runtime deve ficar fora do workspace do Studio: ${portableRuntime}`,
  );
}

async function assertPortableRuntimeShape(portableRuntime: string): Promise<void> {
  const requiredFiles = [
    "README.md",
    ".env.example",
    "Dockerfile",
    "docker-compose.yml",
    "pyproject.toml",
    ".agent-flow/generated-meta.json",
    "app/main.py",
    "app/generated_flow.py",
    "tests/test_generated_runtime.py",
  ];

  for (const relativePath of requiredFiles) {
    await readFile(path.join(portableRuntime, relativePath), "utf-8");
  }

  const metadataRaw = await readFile(path.join(portableRuntime, ".agent-flow", "generated-meta.json"), "utf-8");
  const metadata = JSON.parse(metadataRaw) as Record<string, unknown>;
  assert.equal(metadata.target, "fastapi-runtime");
  assert.equal(metadata.flowId, "reference-interview");
  assert.doesNotMatch(metadataRaw, escapedRepoPathPattern(), "metadata nao deve conter path absoluto do workspace");

  const readme = await readFile(path.join(portableRuntime, "README.md"), "utf-8");
  assert.match(readme, /docker compose up -d/, "README deve conter comando operacional fora do Studio");
  assert.match(readme, /\/docs/, "README deve mencionar Swagger/OpenAPI");

  const compose = await readFile(path.join(portableRuntime, "docker-compose.yml"), "utf-8");
  assert.match(compose, /api:/, "compose deve declarar servico api");
  assert.match(compose, /worker:/, "compose deve declarar worker");
  assert.match(compose, /required:\s*false/, "compose deve aceitar .env ausente");
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
