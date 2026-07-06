import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVmImageScaffold } from "../apps/builder-api/src/vm-image-scaffold.ts";

const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-flow-vm-image-scaffold-"));

try {
  const outDir = path.join(workspaceRoot, "python-qemu.vmimage");
  const result = await createVmImageScaffold({
    outDir,
    imageId: "python-qemu-microvm",
    createdAt: "2026-07-03T00:00:00.000Z",
  });

  assert.equal(result.format, "agent-flow-builder.vm-image-scaffold-result.v1");
  assert.equal(result.imageId, "python-qemu-microvm");

  const scaffold = JSON.parse(await readFile(result.scaffoldManifestPath, "utf-8")) as Record<string, unknown>;
  const runnerManifest = JSON.parse(await readFile(result.runnerManifestPath, "utf-8")) as Record<string, unknown>;
  const imageManifestTemplate = JSON.parse(await readFile(result.imageManifestTemplatePath, "utf-8")) as Record<string, unknown>;
  assert.equal(scaffold.format, "agent-flow-builder.vm-image-scaffold.v1");
  assert.equal(scaffold.guestAgent, "guest/agent-flow-vm-guest-agent.py");
  assert.equal(scaffold.sshTransport, "runner-kit/agent-flow-vm-transport-ssh.py");
  assert.equal((scaffold.governance as Record<string, unknown>).excludesSecrets, true);
  assert.equal((scaffold.governance as Record<string, unknown>).excludesPrivateKeys, true);
  assert.equal((scaffold.governance as Record<string, unknown>).doesNotDownloadOrBootDuringScaffold, true);
  assert.equal((scaffold.governance as Record<string, unknown>).supportsExternalGuestTransport, true);
  assert.equal(runnerManifest.protocol, "agent-flow-vm-runner.v1");
  assert.equal(runnerManifest.supportsExternalGuestTransport, true);
  assert.equal(runnerManifest.guestAgentProtocol, "agent-flow-vm-guest-agent.v1");
  assert.equal(imageManifestTemplate.format, "agent-flow-builder.vm-image-manifest.v1");
  assert.equal(imageManifestTemplate.imagePath, "../images/python-qemu-microvm.qcow2");
  const templateBootArtifacts = imageManifestTemplate.bootArtifacts as Record<string, unknown>[];
  assert.equal(templateBootArtifacts.length, 1);
  assert.equal(templateBootArtifacts[0].id, "cloud-init-seed");
  assert.equal(templateBootArtifacts[0].path, "../images/seed.iso");
  assert.equal(templateBootArtifacts[0].requiredForBoot, true);

  const userDataTemplate = await readFile(path.join(outDir, "cloud-init", "user-data.template"), "utf-8");
  const buildShell = await readFile(result.buildShellPath, "utf-8");
  const bootShell = await readFile(result.bootShellPath, "utf-8");
  const readme = await readFile(path.join(outDir, "README.md"), "utf-8");
  assert.ok(userDataTemplate.includes("__SSH_PUBLIC_KEY__"));
  assert.ok(userDataTemplate.includes("agent-flow-vm-guest-agent.py"));
  assert.ok(buildShell.includes("AGENT_FLOW_VM_BASE_IMAGE"));
  assert.ok(buildShell.includes("AGENT_FLOW_VM_SSH_PUBLIC_KEY_PATH"));
  assert.ok(buildShell.includes("SEED_SIZE"));
  assert.ok(buildShell.includes("cloud-init-seed"));
  assert.ok(buildShell.includes('"bootArtifacts"'));
  assert.ok(bootShell.includes("AGENT_FLOW_VM_GUEST_SSH_BIND"));
  assert.ok(bootShell.includes("hostfwd=tcp:$SSH_BIND:$SSH_PORT-:22"));
  assert.ok(bootShell.includes("virtio-blk-device,drive=rootfs"));
  assert.ok(readme.includes("AGENT_FLOW_QEMU_GUEST_TRANSPORT_COMMAND"));

  const serialized = JSON.stringify({
    scaffold,
    runnerManifest,
    imageManifestTemplate,
    userDataTemplate,
    buildShell,
    bootShell,
    readme,
  });
  assert.equal(serialized.includes(workspaceRoot), false);
  assert.equal(/BEGIN (OPENSSH |RSA |EC )?PRIVATE KEY|api[_-]?secret|password\s*[:=]/i.test(serialized), false);

  const transportSelfCheckStdout = execFileSync("python", [result.sshTransportPath, "--self-check"], {
    cwd: outDir,
    encoding: "utf-8",
  });
  const transportSelfCheck = JSON.parse(transportSelfCheckStdout) as Record<string, unknown>;
  assert.equal(transportSelfCheck.status, "ok");
  assert.equal(transportSelfCheck.format, "agent-flow-vm-ssh-transport-check.v1");
  assert.equal(transportSelfCheck.executesUserCode, false);

  console.log(
    JSON.stringify(
      {
        status: "ok",
        format: "agent-flow-builder.vm-image-scaffold-gate.v1",
        imageId: result.imageId,
        includesCloudInit: true,
        includesGuestAgent: true,
        includesSshTransport: true,
        includesBuildScripts: true,
        includesBootScripts: true,
        excludesSecrets: true,
        doesNotDownloadOrBootDuringGate: true,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(workspaceRoot, { recursive: true, force: true });
}
