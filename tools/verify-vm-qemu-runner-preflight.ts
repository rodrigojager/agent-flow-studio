import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-flow-vm-qemu-runner-"));

try {
  const runnerPath = path.resolve("tools", "agent-flow-vm-runner-qemu.py");
  const guestAgentPath = path.resolve("tools", "agent-flow-vm-guest-agent.py");
  const fakeQemuPath = path.join(workspaceRoot, process.platform === "win32" ? "qemu-system-x86_64.exe" : "qemu-system-x86_64");
  const imageDir = path.join(workspaceRoot, "images");
  const imagePath = path.join(imageDir, "agent-flow-python.qcow2");
  const seedPath = path.join(imageDir, "seed.iso");
  const imageManifestPath = path.join(imageDir, "agent-flow-python.afvmimage.json");
  const imageBytes = "fake-qcow2-for-qemu-runner-preflight";
  const seedBytes = "fake-cloud-init-seed-for-qemu-runner-preflight";
  const imageSha256 = createHash("sha256").update(imageBytes).digest("hex");
  const seedSha256 = createHash("sha256").update(seedBytes).digest("hex");

  await mkdir(imageDir, { recursive: true });
  await writeFile(fakeQemuPath, process.platform === "win32" ? "qemu fake\r\n" : "qemu fake\n", "utf-8");
  await writeFile(imagePath, imageBytes, "utf-8");
  await writeFile(seedPath, seedBytes, "utf-8");
  await writeFile(
    imageManifestPath,
    JSON.stringify({
      format: "agent-flow-builder.vm-image-manifest.v1",
      imageId: "python-qemu-microvm",
      engine: "qemu",
      language: "python",
      imagePath: "agent-flow-python.qcow2",
      sizeBytes: Buffer.byteLength(imageBytes),
      sha256: imageSha256,
      bootArtifacts: [
        {
          id: "cloud-init-seed",
          kind: "cloud-init-seed",
          path: "seed.iso",
          requiredForBoot: true,
          sizeBytes: Buffer.byteLength(seedBytes),
          sha256: seedSha256,
        },
      ],
    }),
    "utf-8",
  );

  const preflight = runQemuRunner(runnerPath, ["--preflight"], {
    protocol: "agent-flow-vm-runner.v1",
    workspace: workspaceRoot,
    vm: {
      engine: "qemu",
      qemuBinary: fakeQemuPath,
      image_manifest: path.relative(workspaceRoot, imageManifestPath),
      memory: "768m",
      cpus: "2",
    },
  });

  assert.equal(preflight.ok, true);
  assert.equal(preflight.format, "agent-flow-vm-runner-qemu-preflight.v1");
  assert.equal(preflight.runner, "agent-flow-vm-runner-qemu");
  assert.equal(preflight.providesVmIsolation, true);
  assert.equal(preflight.contractExecutionImplemented, false);
  assert.equal(preflight.supportsExternalGuestTransport, true);
  assert.equal(preflight.requiresGuestAgent, true);
  assert.equal(preflight.executesUserCode, false);
  assert.equal((preflight.image as Record<string, unknown>).sha256, imageSha256);
  assert.equal((preflight.image as Record<string, unknown>).sha256Verified, true);
  assert.equal(((preflight.bootArtifacts as Record<string, unknown>[])[0]).sha256, seedSha256);
  assert.deepEqual(preflight.policy, {
    memory: "768m",
    cpus: "2",
    machine: "q35,accel=kvm:tcg",
    network: "user-forwarded-ssh",
    netDevice: "virtio-net-pci",
    sshBind: "127.0.0.1",
    sshPort: "2222",
  });
  assert.ok((preflight.plannedCommand as string[]).some((item) => item.includes("agent-flow-python.qcow2")));
  assert.ok((preflight.plannedCommand as string[]).some((item) => item.includes("seed.iso")));

  const missingBinary = runQemuRunner(runnerPath, ["--preflight"], {
    protocol: "agent-flow-vm-runner.v1",
    workspace: workspaceRoot,
    vm: {
      engine: "qemu",
      qemuBinary: path.join(workspaceRoot, "missing-qemu"),
      image_manifest: path.relative(workspaceRoot, imageManifestPath),
    },
  });
  assert.equal(missingBinary.ok, false);
  assert.equal(missingBinary.error, "qemu_binary_not_found");
  assert.equal(missingBinary.executesUserCode, false);

  const normalExecution = runQemuRunner(runnerPath, [], {
    protocol: "agent-flow-vm-runner.v1",
    workspace: workspaceRoot,
    vm: {
      engine: "qemu",
      qemuBinary: fakeQemuPath,
      image_manifest: path.relative(workspaceRoot, imageManifestPath),
    },
  });
  assert.equal(normalExecution.ok, false);
  assert.equal(normalExecution.error, "qemu_guest_transport_not_configured");
  assert.equal(normalExecution.requiresGuestAgent, true);
  assert.equal(normalExecution.supportsExternalGuestTransport, true);
  assert.equal(normalExecution.executesUserCode, false);

  const transportExecution = runQemuRunner(runnerPath, [], {
    protocol: "agent-flow-vm-runner.v1",
    workspace: workspaceRoot,
    entry: "run",
    language: "python",
    input: "conteudo transportado",
    context: { node_id: "vm_questions" },
    contract: { sandbox_isolation: "vm" },
    inlineSource: "def run(value, context, contract):\n    return {'value': value, 'node': context['node_id'], 'isolation': contract['sandbox_isolation']}\n",
    vm: {
      engine: "qemu",
      qemuBinary: fakeQemuPath,
      image_manifest: path.relative(workspaceRoot, imageManifestPath),
      guestTransportCommand: "python",
      guestTransportArgs: [guestAgentPath],
      guestTransportAssurance: "simulated",
    },
  });
  assert.equal(transportExecution.ok, true);
  assert.equal(transportExecution.runner, "agent-flow-vm-runner-qemu");
  assert.equal(transportExecution.contractExecutionImplemented, true);
  assert.equal(transportExecution.supportsExternalGuestTransport, true);
  assert.equal(transportExecution.requiresGuestAgent, true);
  assert.equal(transportExecution.executesUserCode, true);
  assert.equal(transportExecution.providesVmIsolation, false);
  assert.equal(transportExecution.qemuPreflightProvidesVmIsolation, true);
  assert.equal(transportExecution.guestAgentRunner, "agent-flow-vm-guest-agent");
  assert.equal(transportExecution.guestAgentProtocol, "agent-flow-vm-guest-agent.v1");
  assert.deepEqual(transportExecution.output, {
    value: "conteudo transportado",
    node: "vm_questions",
    isolation: "vm",
  });
  assert.deepEqual(transportExecution.transport, {
    kind: "external_command",
    command: "python",
    argsCount: 1,
    resolved: true,
    assurance: "simulated",
    timeoutSeconds: 30,
  });

  console.log(
    JSON.stringify(
      {
        status: "ok",
        format: "agent-flow-builder.vm-qemu-runner-preflight-gate.v1",
        qemuPreflight: "ok",
        validatesImageSha256: true,
        validatesBootArtifactSha256: true,
        plansQemuCommand: true,
        plansBootArtifacts: true,
        normalExecutionFailsClosed: true,
        externalGuestTransportContract: "ok",
        simulatedTransportProvidesVmIsolation: false,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(workspaceRoot, { recursive: true, force: true });
}

function runQemuRunner(runnerPath: string, args: string[], request: Record<string, unknown>): Record<string, unknown> {
  let stdout = "";
  try {
    stdout = execFileSync("python", [runnerPath, ...args], {
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
