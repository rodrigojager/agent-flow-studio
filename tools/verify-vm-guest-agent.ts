import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-flow-vm-guest-agent-"));
const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "agent-flow-vm-guest-agent-outside-"));

try {
  const guestAgentPath = path.resolve("tools", "agent-flow-vm-guest-agent.py");
  const codeDir = path.join(workspaceRoot, "code");
  const codePath = path.join(codeDir, "question_tool.py");
  await mkdir(codeDir, { recursive: true });
  await writeFile(
    codePath,
    [
      "def run(value, context, contract):",
      "    print('guest stdout')",
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

  const inlineResult = runGuestAgent(guestAgentPath, {
    protocol: "agent-flow-vm-runner.v1",
    entry: "run",
    language: "python",
    input: "conteudo inline",
    context: { node_id: "inline_node" },
    contract: { sandbox_isolation: "vm" },
    inlineSource: [
      "def run(value, context, contract):",
      "    return {'value': value, 'node': context['node_id'], 'isolation': contract['sandbox_isolation'], 'source': 'inline'}",
      "",
    ].join("\n"),
    workspace: workspaceRoot,
    workspaceIsolation: "vm",
    vm: { engine: "qemu", imageId: "python-qemu-microvm" },
  });
  assert.equal(inlineResult.ok, true);
  assert.equal(inlineResult.runner, "agent-flow-vm-guest-agent");
  assert.equal(inlineResult.guestAgentProtocol, "agent-flow-vm-guest-agent.v1");
  assert.equal(inlineResult.executesInsideGuest, true);
  assert.deepEqual(inlineResult.output, {
    value: "conteudo inline",
    node: "inline_node",
    isolation: "vm",
    source: "inline",
  });

  const fileResult = runGuestAgent(guestAgentPath, {
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
  assert.equal(fileResult.stdout, "guest stdout\n");
  assert.deepEqual(fileResult.output, {
    value: "conteudo arquivo",
    node: "file_node",
    isolation: "vm",
    source: "file",
  });

  const outsidePath = path.join(outsideRoot, "outside.py");
  await writeFile(outsidePath, "def run(value, context, contract):\n    return {}\n", "utf-8");
  const outsideResult = runGuestAgent(guestAgentPath, {
    protocol: "agent-flow-vm-runner.v1",
    entry: "run",
    language: "python",
    sourcePath: outsidePath,
    workspace: workspaceRoot,
  });
  assert.equal(outsideResult.ok, false);
  assert.match(String(outsideResult.error), /sourcePath must stay inside workspace/);

  const unsupportedLanguage = runGuestAgent(guestAgentPath, {
    protocol: "agent-flow-vm-runner.v1",
    language: "ruby",
    inlineSource: "puts 'nope'",
    workspace: workspaceRoot,
  });
  assert.equal(unsupportedLanguage.ok, false);
  assert.equal(unsupportedLanguage.error, "unsupported_language:ruby");

  const unsupportedProtocol = runGuestAgent(guestAgentPath, {
    protocol: "agent-flow-vm-runner.v0",
    language: "python",
    inlineSource: "def run(value, context, contract):\n    return {}\n",
    workspace: workspaceRoot,
  });
  assert.equal(unsupportedProtocol.ok, false);
  assert.equal(unsupportedProtocol.error, "unsupported_protocol");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        format: "agent-flow-builder.vm-guest-agent-gate.v1",
        guestAgent: "agent-flow-vm-guest-agent",
        guestAgentProtocol: "agent-flow-vm-guest-agent.v1",
        inlineContract: "ok",
        fileContract: "ok",
        blocksSourceOutsideWorkspace: true,
        unsupportedLanguageFailsClosed: true,
        unsupportedProtocolFailsClosed: true,
        executesInsideGuest: true,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(workspaceRoot, { recursive: true, force: true });
  await rm(outsideRoot, { recursive: true, force: true });
}

function runGuestAgent(guestAgentPath: string, request: Record<string, unknown>): Record<string, unknown> {
  let stdout = "";
  try {
    stdout = execFileSync("python", [guestAgentPath], {
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
