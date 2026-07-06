import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-flow-vm-microvm-runner-"));

try {
  const runnerPath = path.resolve("tools", "agent-flow-vm-runner-microvm.py");
  const guestAgentPath = path.resolve("tools", "agent-flow-vm-guest-agent.py");
  const fakeFirecrackerPath = path.join(workspaceRoot, process.platform === "win32" ? "firecracker.exe" : "firecracker");
  const fakeCloudHypervisorPath = path.join(workspaceRoot, process.platform === "win32" ? "cloud-hypervisor.exe" : "cloud-hypervisor");
  const imageDir = path.join(workspaceRoot, "images");
  const imagePath = path.join(imageDir, "rootfs.ext4");
  const kernelPath = path.join(imageDir, "vmlinux.bin");
  const seedPath = path.join(imageDir, "seed.iso");
  const imageManifestPath = path.join(imageDir, "agent-flow-firecracker.afvmimage.json");
  const hardenedPolicyPath = path.join(imageDir, "microvm.policy.json");
  const hardenedImageManifestPath = path.join(imageDir, "agent-flow-firecracker-hardened.afvmimage.json");
  const imageBytes = "fake-rootfs-for-microvm-runner-preflight";
  const kernelBytes = "fake-direct-kernel-for-microvm-runner-preflight";
  const seedBytes = "fake-cloud-init-seed-for-microvm-runner-preflight";
  const imageSha256 = createHash("sha256").update(imageBytes).digest("hex");
  const kernelSha256 = createHash("sha256").update(kernelBytes).digest("hex");
  const seedSha256 = createHash("sha256").update(seedBytes).digest("hex");

  await mkdir(imageDir, { recursive: true });
  await writeFile(fakeFirecrackerPath, process.platform === "win32" ? "firecracker fake\r\n" : "firecracker fake\n", "utf-8");
  await writeFile(fakeCloudHypervisorPath, process.platform === "win32" ? "cloud hypervisor fake\r\n" : "cloud hypervisor fake\n", "utf-8");
  await writeFile(imagePath, imageBytes, "utf-8");
  await writeFile(kernelPath, kernelBytes, "utf-8");
  await writeFile(seedPath, seedBytes, "utf-8");
  await writeFile(
    imageManifestPath,
    JSON.stringify({
      format: "agent-flow-builder.vm-image-manifest.v1",
      imageId: "python-firecracker-microvm",
      engine: "firecracker",
      language: "python",
      imagePath: "rootfs.ext4",
      sizeBytes: Buffer.byteLength(imageBytes),
      sha256: imageSha256,
      bootArtifacts: [
        {
          id: "kernel",
          kind: "kernel",
          path: "vmlinux.bin",
          requiredForBoot: true,
          sizeBytes: Buffer.byteLength(kernelBytes),
          sha256: kernelSha256,
        },
        {
          id: "cloud-init-seed",
          kind: "cloud-init-seed",
          path: "seed.iso",
          requiredForBoot: false,
          sizeBytes: Buffer.byteLength(seedBytes),
          sha256: seedSha256,
        },
      ],
    }),
    "utf-8",
  );
  await writeFile(
    hardenedPolicyPath,
    JSON.stringify({
      format: "agent-flow-builder.vm-policy-manifest.v1",
      policyId: "agent-flow-microvm-hardened-local",
      profile: "hardened",
      isolation: "microvm",
      engines: ["firecracker", "cloud-hypervisor"],
      network: "none",
      readOnlyRootfs: true,
      workspaceMount: false,
      hostDevicePassthrough: false,
      snapshotRestore: false,
      requireGuestTransportAssurance: "guest_vm",
      maxMemoryMiB: 4096,
      maxCpus: 4,
    }),
    "utf-8",
  );
  await writeFile(
    hardenedImageManifestPath,
    JSON.stringify({
      format: "agent-flow-builder.vm-image-manifest.v1",
      imageId: "python-firecracker-microvm-hardened",
      engine: "firecracker",
      language: "python",
      imagePath: "rootfs.ext4",
      sizeBytes: Buffer.byteLength(imageBytes),
      sha256: imageSha256,
      policyManifest: "microvm.policy.json",
      bootArtifacts: [
        {
          id: "kernel",
          kind: "kernel",
          path: "vmlinux.bin",
          requiredForBoot: true,
          sizeBytes: Buffer.byteLength(kernelBytes),
          sha256: kernelSha256,
        },
        {
          id: "cloud-init-seed",
          kind: "cloud-init-seed",
          path: "seed.iso",
          requiredForBoot: false,
          sizeBytes: Buffer.byteLength(seedBytes),
          sha256: seedSha256,
        },
      ],
    }),
    "utf-8",
  );

  const firecrackerPreflight = runMicrovmRunner(runnerPath, ["--preflight"], {
    protocol: "agent-flow-vm-runner.v1",
    workspace: workspaceRoot,
    vm: {
      engine: "firecracker",
      firecrackerBinary: fakeFirecrackerPath,
      image_manifest: path.relative(workspaceRoot, imageManifestPath),
      memory: "512M",
      cpus: "2",
      kernelArgs: "console=ttyS0 root=/dev/vda rw",
    },
  });

  assert.equal(firecrackerPreflight.ok, true);
  assert.equal(firecrackerPreflight.format, "agent-flow-vm-runner-microvm-preflight.v1");
  assert.equal(firecrackerPreflight.runner, "agent-flow-vm-runner-microvm");
  assert.equal(firecrackerPreflight.engine, "firecracker");
  assert.equal(firecrackerPreflight.providesVmIsolation, true);
  assert.equal(firecrackerPreflight.contractExecutionImplemented, false);
  assert.equal(firecrackerPreflight.supportsExternalGuestTransport, true);
  assert.equal(firecrackerPreflight.requiresGuestAgent, true);
  assert.equal(firecrackerPreflight.executesUserCode, false);
  assert.equal((firecrackerPreflight.image as Record<string, unknown>).sha256, imageSha256);
  assert.equal(((firecrackerPreflight.bootArtifacts as Record<string, unknown>[])[0]).sha256, kernelSha256);
  assert.equal(((firecrackerPreflight.bootArtifacts as Record<string, unknown>[])[1]).sha256, seedSha256);
  assert.ok((firecrackerPreflight.plannedCommand as string[]).includes("--config-file"));
  assert.ok(JSON.stringify(firecrackerPreflight.enginePlan).includes("boot-source"));
  assert.ok(JSON.stringify(firecrackerPreflight.enginePlan).includes("cloudinit"));

  const firecrackerHardenedPreflight = runMicrovmRunner(runnerPath, ["--preflight"], {
    protocol: "agent-flow-vm-runner.v1",
    workspace: workspaceRoot,
    vm: {
      engine: "firecracker",
      firecrackerBinary: fakeFirecrackerPath,
      image_manifest: path.relative(workspaceRoot, hardenedImageManifestPath),
      memory: "1024M",
      cpus: "2",
    },
  });
  assert.equal(firecrackerHardenedPreflight.ok, true);
  assert.equal((firecrackerHardenedPreflight.policy as Record<string, unknown>).profile, "hardened");
  assert.equal((firecrackerHardenedPreflight.policy as Record<string, unknown>).network, "none");
  assert.equal((firecrackerHardenedPreflight.policy as Record<string, unknown>).readOnlyRootfs, true);
  assert.equal(
    (((firecrackerHardenedPreflight.enginePlan as Record<string, unknown>).plannedConfig as Record<string, unknown>).drives as Record<string, unknown>[])[0].is_read_only,
    true,
  );

  const memoryPolicyFailure = runMicrovmRunner(runnerPath, ["--preflight"], {
    protocol: "agent-flow-vm-runner.v1",
    workspace: workspaceRoot,
    vm: {
      engine: "firecracker",
      firecrackerBinary: fakeFirecrackerPath,
      image_manifest: path.relative(workspaceRoot, hardenedImageManifestPath),
      memory: "8192M",
      cpus: "2",
    },
  });
  assert.equal(memoryPolicyFailure.ok, false);
  assert.equal(memoryPolicyFailure.error, "microvm_policy_memory_limit_exceeded");
  assert.equal(memoryPolicyFailure.executesUserCode, false);

  const cloudHypervisorPreflight = runMicrovmRunner(runnerPath, ["--preflight"], {
    protocol: "agent-flow-vm-runner.v1",
    workspace: workspaceRoot,
    vm: {
      engine: "cloud-hypervisor",
      cloudHypervisorBinary: fakeCloudHypervisorPath,
      image_manifest: path.relative(workspaceRoot, imageManifestPath),
      memory: "768M",
      cpus: "3",
      kernelArgs: "console=hvc0 root=/dev/vda rw",
    },
  });

  assert.equal(cloudHypervisorPreflight.ok, true);
  assert.equal(cloudHypervisorPreflight.engine, "cloud-hypervisor");
  assert.equal(cloudHypervisorPreflight.executesUserCode, false);
  assert.equal((cloudHypervisorPreflight.image as Record<string, unknown>).sha256, imageSha256);
  assert.ok((cloudHypervisorPreflight.plannedCommand as string[]).includes("--kernel"));
  assert.ok((cloudHypervisorPreflight.plannedCommand as string[]).some((item) => item.includes("seed.iso")));
  assert.ok((cloudHypervisorPreflight.plannedCommand as string[]).includes("--api-socket"));

  const missingKernelManifestPath = path.join(imageDir, "missing-kernel.afvmimage.json");
  await writeFile(
    missingKernelManifestPath,
    JSON.stringify({
      format: "agent-flow-builder.vm-image-manifest.v1",
      imageId: "python-firecracker-missing-kernel",
      engine: "firecracker",
      language: "python",
      imagePath: "rootfs.ext4",
      sizeBytes: Buffer.byteLength(imageBytes),
      sha256: imageSha256,
    }),
    "utf-8",
  );
  const missingKernel = runMicrovmRunner(runnerPath, ["--preflight"], {
    protocol: "agent-flow-vm-runner.v1",
    workspace: workspaceRoot,
    vm: {
      engine: "firecracker",
      firecrackerBinary: fakeFirecrackerPath,
      image_manifest: path.relative(workspaceRoot, missingKernelManifestPath),
    },
  });
  assert.equal(missingKernel.ok, false);
  assert.equal(missingKernel.error, "microvm_kernel_artifact_required");
  assert.equal(missingKernel.executesUserCode, false);

  const normalExecution = runMicrovmRunner(runnerPath, [], {
    protocol: "agent-flow-vm-runner.v1",
    workspace: workspaceRoot,
    vm: {
      engine: "firecracker",
      firecrackerBinary: fakeFirecrackerPath,
      image_manifest: path.relative(workspaceRoot, imageManifestPath),
    },
  });
  assert.equal(normalExecution.ok, false);
  assert.equal(normalExecution.error, "microvm_guest_transport_not_configured");
  assert.equal(normalExecution.requiresGuestAgent, true);
  assert.equal(normalExecution.supportsExternalGuestTransport, true);
  assert.equal(normalExecution.executesUserCode, false);

  const transportExecution = runMicrovmRunner(runnerPath, [], {
    protocol: "agent-flow-vm-runner.v1",
    workspace: workspaceRoot,
    entry: "run",
    language: "python",
    input: "conteudo transportado",
    context: { node_id: "microvm_questions" },
    contract: { sandbox_isolation: "vm" },
    inlineSource: "def run(value, context, contract):\n    return {'value': value, 'node': context['node_id'], 'isolation': contract['sandbox_isolation']}\n",
    vm: {
      engine: "firecracker",
      firecrackerBinary: fakeFirecrackerPath,
      image_manifest: path.relative(workspaceRoot, imageManifestPath),
      guestTransportCommand: "python",
      guestTransportArgs: [guestAgentPath],
      guestTransportAssurance: "simulated",
    },
  });
  assert.equal(transportExecution.ok, true);
  assert.equal(transportExecution.runner, "agent-flow-vm-runner-microvm");
  assert.equal(transportExecution.engine, "firecracker");
  assert.equal(transportExecution.contractExecutionImplemented, true);
  assert.equal(transportExecution.supportsExternalGuestTransport, true);
  assert.equal(transportExecution.requiresGuestAgent, true);
  assert.equal(transportExecution.executesUserCode, true);
  assert.equal(transportExecution.providesVmIsolation, false);
  assert.equal(transportExecution.microvmPreflightProvidesVmIsolation, true);
  assert.equal(transportExecution.guestAgentRunner, "agent-flow-vm-guest-agent");
  assert.equal(transportExecution.guestAgentProtocol, "agent-flow-vm-guest-agent.v1");
  assert.deepEqual(transportExecution.output, {
    value: "conteudo transportado",
    node: "microvm_questions",
    isolation: "vm",
  });

  const weakTransportExecution = runMicrovmRunner(runnerPath, [], {
    protocol: "agent-flow-vm-runner.v1",
    workspace: workspaceRoot,
    entry: "run",
    language: "python",
    input: "conteudo transportado",
    context: { node_id: "microvm_questions" },
    contract: { sandbox_isolation: "vm" },
    inlineSource: "def run(value, context, contract):\n    return {'value': value}\n",
    vm: {
      engine: "firecracker",
      firecrackerBinary: fakeFirecrackerPath,
      image_manifest: path.relative(workspaceRoot, hardenedImageManifestPath),
      guestTransportCommand: "python",
      guestTransportArgs: [guestAgentPath],
      guestTransportAssurance: "simulated",
    },
  });
  assert.equal(weakTransportExecution.ok, false);
  assert.equal(weakTransportExecution.error, "microvm_guest_transport_assurance_too_weak");
  assert.equal(weakTransportExecution.executesUserCode, false);

  console.log(
    JSON.stringify(
      {
        status: "ok",
        format: "agent-flow-builder.vm-microvm-runner-preflight-gate.v1",
        firecrackerPreflight: "ok",
        cloudHypervisorPreflight: "ok",
        validatesImageSha256: true,
        validatesKernelArtifactSha256: true,
        validatesSeedArtifactSha256: true,
        hardenedPolicyManifest: "ok",
        hardenedPolicyReadOnlyRootfs: true,
        hardenedPolicyLimits: "ok",
        weakTransportAssuranceFailsClosed: true,
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

function runMicrovmRunner(runnerPath: string, args: string[], request: Record<string, unknown>): Record<string, unknown> {
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
