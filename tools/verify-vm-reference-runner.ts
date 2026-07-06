import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-flow-vm-reference-runner-"));
const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "agent-flow-vm-reference-runner-outside-"));

try {
  const runnerPath = path.resolve("tools", "agent-flow-vm-runner-reference.py");
  const codeDir = path.join(workspaceRoot, "code");
  const codePath = path.join(codeDir, "question_tool.py");
  await mkdir(codeDir, { recursive: true });
  await writeFile(
    codePath,
    [
      "def run(value, context, contract):",
      "    return {",
      "        'value': value,",
      "        'node': context['node_id'],",
      "        'isolation': contract['sandbox_isolation'],",
      "        'source': 'file',",
      "    }",
      "",
    ].join("\n"),
    "utf-8",
  );

  const inlineResult = runReferenceRunner(runnerPath, {
    protocol: "agent-flow-vm-runner.v1",
    entry: "run",
    language: "python",
    input: "conteudo inline",
    context: { node_id: "inline_node" },
    contract: { sandbox_isolation: "vm" },
    inlineSource: [
      "def run(value, context, contract):",
      "    print('stdout controlado')",
      "    return {'value': value, 'node': context['node_id'], 'isolation': contract['sandbox_isolation'], 'source': 'inline'}",
      "",
    ].join("\n"),
    workspace: workspaceRoot,
    workspaceIsolation: "vm",
  });
  assert.equal(inlineResult.ok, true);
  assert.equal(inlineResult.runner, "agent-flow-vm-runner-reference");
  assert.equal(inlineResult.providesVmIsolation, false);
  assert.equal(inlineResult.stdout, "stdout controlado\n");
  assert.deepEqual(inlineResult.output, {
    value: "conteudo inline",
    node: "inline_node",
    isolation: "vm",
    source: "inline",
  });

  const fileResult = runReferenceRunner(runnerPath, {
    protocol: "agent-flow-vm-runner.v1",
    entry: "run",
    language: "python",
    input: "conteudo arquivo",
    context: { node_id: "file_node" },
    contract: { sandbox_isolation: "vm" },
    sourcePath: codePath,
    workspace: workspaceRoot,
    workspaceIsolation: "vm",
  });
  assert.equal(fileResult.ok, true);
  assert.deepEqual(fileResult.output, {
    value: "conteudo arquivo",
    node: "file_node",
    isolation: "vm",
    source: "file",
  });

  const outsidePath = path.join(outsideRoot, "outside.py");
  await writeFile(outsidePath, "def run(value, context, contract):\n    return {}\n", "utf-8");
  const outsideResult = runReferenceRunner(runnerPath, {
    protocol: "agent-flow-vm-runner.v1",
    entry: "run",
    language: "python",
    input: "fora",
    context: { node_id: "outside_node" },
    contract: { sandbox_isolation: "vm" },
    sourcePath: outsidePath,
    workspace: workspaceRoot,
    workspaceIsolation: "vm",
  });
  assert.equal(outsideResult.ok, false);
  assert.match(String(outsideResult.error), /sourcePath must stay inside workspace/);

  console.log(
    JSON.stringify(
      {
        status: "ok",
        format: "agent-flow-builder.vm-reference-runner-gate.v1",
        runner: "agent-flow-vm-runner-reference",
        inlineContract: "ok",
        fileContract: "ok",
        blocksSourceOutsideWorkspace: true,
        providesVmIsolation: false,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(workspaceRoot, { recursive: true, force: true });
  await rm(outsideRoot, { recursive: true, force: true });
}

function runReferenceRunner(runnerPath: string, request: Record<string, unknown>): Record<string, unknown> {
  let stdout = "";
  try {
    stdout = execFileSync("python", [runnerPath], {
      input: JSON.stringify(request),
      cwd: process.cwd(),
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    const failed = error as { stdout?: string | Buffer };
    stdout = Buffer.isBuffer(failed.stdout) ? failed.stdout.toString("utf-8") : String(failed.stdout || "");
  }
  return JSON.parse(stdout) as Record<string, unknown>;
}
