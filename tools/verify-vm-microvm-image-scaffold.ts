import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createMicrovmImageScaffold } from "../apps/builder-api/src/vm-image-scaffold.ts";

const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-flow-vm-microvm-scaffold-"));

try {
  const outDir = path.join(workspaceRoot, "python-microvm.vmimage");
  const result = await createMicrovmImageScaffold({
    outDir,
    imageId: "python-direct-kernel-microvm",
    createdAt: "2026-07-03T00:00:00.000Z",
  });

  assert.equal(result.format, "agent-flow-builder.vm-image-scaffold-result.v1");
  assert.equal(result.imageId, "python-direct-kernel-microvm");
  assert.ok(result.microvmRunnerPath);
  assert.ok(result.preflightFirecrackerShellPath);
  assert.ok(result.preflightCloudHypervisorShellPath);
  assert.ok(result.microvmPolicyManifestPath);

  const scaffold = JSON.parse(await readFile(result.scaffoldManifestPath, "utf-8")) as Record<string, unknown>;
  const runnerManifest = JSON.parse(await readFile(result.runnerManifestPath, "utf-8")) as Record<string, unknown>;
  const imageManifestTemplate = JSON.parse(await readFile(result.imageManifestTemplatePath, "utf-8")) as Record<string, unknown>;
  const microvmPolicyManifest = JSON.parse(await readFile(result.microvmPolicyManifestPath!, "utf-8")) as Record<string, unknown>;

  assert.equal(scaffold.format, "agent-flow-builder.vm-image-scaffold.v1");
  assert.equal(scaffold.engine, "microvm-direct-kernel");
  assert.deepEqual(scaffold.supportedEngines, ["firecracker", "cloud-hypervisor"]);
  assert.equal(scaffold.microvmRunner, "runner-kit/agent-flow-vm-runner-microvm.py");
  assert.equal((scaffold.governance as Record<string, unknown>).requiresUserProvidedRootfs, true);
  assert.equal((scaffold.governance as Record<string, unknown>).requiresUserProvidedKernelOrFirmware, true);
  assert.equal((scaffold.governance as Record<string, unknown>).supportsFirecracker, true);
  assert.equal((scaffold.governance as Record<string, unknown>).supportsCloudHypervisor, true);
  assert.equal((scaffold.governance as Record<string, unknown>).doesNotDownloadOrBootDuringScaffold, true);
  assert.equal((scaffold.governance as Record<string, unknown>).includesHardenedPolicyManifest, true);

  assert.equal(runnerManifest.protocol, "agent-flow-vm-runner.v1");
  assert.deepEqual(runnerManifest.engines, ["firecracker", "cloud-hypervisor"]);
  assert.equal(runnerManifest.supportsFirecracker, true);
  assert.equal(runnerManifest.supportsCloudHypervisor, true);
  assert.equal(runnerManifest.supportsNetworkNone, true);
  assert.equal(runnerManifest.supportsReadOnlyRootfs, true);
  assert.equal(runnerManifest.supportsWorkspaceMount, false);
  assert.equal(runnerManifest.supportsHostDevicePassthrough, false);
  assert.equal(runnerManifest.guestAgentProtocol, "agent-flow-vm-guest-agent.v1");

  assert.equal(microvmPolicyManifest.format, "agent-flow-builder.vm-policy-manifest.v1");
  assert.equal(microvmPolicyManifest.profile, "hardened");
  assert.equal(microvmPolicyManifest.network, "none");
  assert.equal(microvmPolicyManifest.readOnlyRootfs, true);
  assert.equal(microvmPolicyManifest.workspaceMount, false);
  assert.equal(microvmPolicyManifest.hostDevicePassthrough, false);
  assert.equal(microvmPolicyManifest.requireGuestTransportAssurance, "guest_vm");
  assert.equal(microvmPolicyManifest.maxMemoryMiB, 4096);
  assert.equal(microvmPolicyManifest.maxCpus, 4);

  assert.equal(imageManifestTemplate.format, "agent-flow-builder.vm-image-manifest.v1");
  assert.equal(imageManifestTemplate.engine, "firecracker");
  assert.equal(imageManifestTemplate.imagePath, "../images/python-direct-kernel-microvm.rootfs.ext4");
  assert.equal(imageManifestTemplate.policyManifest, "microvm.policy.json");
  const bootArtifacts = imageManifestTemplate.bootArtifacts as Record<string, unknown>[];
  assert.equal(bootArtifacts.length, 2);
  assert.equal(bootArtifacts[0].id, "kernel");
  assert.equal(bootArtifacts[0].kind, "kernel");
  assert.equal(bootArtifacts[0].requiredForBoot, true);
  assert.equal(bootArtifacts[1].id, "cloud-init-seed");
  assert.equal(bootArtifacts[1].kind, "cloud-init-seed");

  const prepareShell = await readFile(result.buildShellPath, "utf-8");
  const preparePowerShell = await readFile(result.buildPowerShellPath, "utf-8");
  const preflightFirecrackerShell = await readFile(result.preflightFirecrackerShellPath!, "utf-8");
  const preflightCloudShell = await readFile(result.preflightCloudHypervisorShellPath!, "utf-8");
  const readme = await readFile(path.join(outDir, "README.md"), "utf-8");
  assert.ok(prepareShell.includes("AGENT_FLOW_MICROVM_ROOTFS_IMAGE"));
  assert.ok(prepareShell.includes("AGENT_FLOW_MICROVM_KERNEL_IMAGE"));
  assert.ok(prepareShell.includes("AGENT_FLOW_MICROVM_FIRMWARE_IMAGE"));
  assert.ok(prepareShell.includes('"bootArtifacts"'));
  assert.ok(preparePowerShell.includes("AGENT_FLOW_MICROVM_ENGINE"));
  assert.ok(preparePowerShell.includes("AGENT_FLOW_MICROVM_FIRMWARE_IMAGE"));
  assert.ok(preflightFirecrackerShell.includes("AGENT_FLOW_FIRECRACKER_BINARY"));
  assert.ok(preflightFirecrackerShell.includes("microvm.policy.json"));
  assert.ok(preflightCloudShell.includes("AGENT_FLOW_CLOUD_HYPERVISOR_BINARY"));
  assert.ok(preflightCloudShell.includes("microvm.policy.json"));
  assert.ok(readme.includes("preflight-firecracker"));
  assert.ok(readme.includes("preflight-cloud-hypervisor"));
  assert.ok(readme.includes("AGENT_FLOW_MICROVM_FIRMWARE_IMAGE"));
  assert.ok(readme.includes("read-only rootfs"));

  const rootfsPath = path.join(outDir, "images", "python-direct-kernel-microvm.rootfs.ext4");
  const kernelPath = path.join(outDir, "images", "kernel");
  const seedPath = path.join(outDir, "images", "seed.iso");
  const firecrackerPath = path.join(workspaceRoot, process.platform === "win32" ? "firecracker.exe" : "firecracker");
  const cloudHypervisorPath = path.join(workspaceRoot, process.platform === "win32" ? "cloud-hypervisor.exe" : "cloud-hypervisor");
  await writeFile(rootfsPath, "fake-rootfs-from-microvm-scaffold", "utf-8");
  await writeFile(kernelPath, "fake-kernel-from-microvm-scaffold", "utf-8");
  await writeFile(seedPath, "fake-seed-from-microvm-scaffold", "utf-8");
  await writeFile(firecrackerPath, "fake-firecracker", "utf-8");
  await writeFile(cloudHypervisorPath, "fake-cloud-hypervisor", "utf-8");

  const preflightFirecrackerStdout = execFileSync("python", [result.microvmRunnerPath!, "--preflight"], {
    input: JSON.stringify({
      protocol: "agent-flow-vm-runner.v1",
      workspace: outDir,
      vm: {
        engine: "firecracker",
        firecrackerBinary: firecrackerPath,
        image_manifest: "manifests/image.manifest.template.json",
      },
    }),
    cwd: outDir,
    encoding: "utf-8",
  });
  const preflightFirecracker = JSON.parse(preflightFirecrackerStdout) as Record<string, unknown>;
  assert.equal(preflightFirecracker.ok, true);
  assert.equal(preflightFirecracker.engine, "firecracker");
  assert.equal(preflightFirecracker.executesUserCode, false);
  assert.equal((preflightFirecracker.policy as Record<string, unknown>).network, "none");
  assert.equal((preflightFirecracker.policy as Record<string, unknown>).readOnlyRootfs, true);
  assert.equal(
    (((preflightFirecracker.enginePlan as Record<string, unknown>).plannedConfig as Record<string, unknown>).drives as Record<string, unknown>[])[0].is_read_only,
    true,
  );
  assert.ok(JSON.stringify(preflightFirecracker.enginePlan).includes("boot-source"));

  const preflightCloudStdout = execFileSync("python", [result.microvmRunnerPath!, "--preflight"], {
    input: JSON.stringify({
      protocol: "agent-flow-vm-runner.v1",
      workspace: outDir,
      vm: {
        engine: "cloud-hypervisor",
        cloudHypervisorBinary: cloudHypervisorPath,
        image_manifest: "manifests/image.manifest.template.json",
      },
    }),
    cwd: outDir,
    encoding: "utf-8",
  });
  const preflightCloud = JSON.parse(preflightCloudStdout) as Record<string, unknown>;
  assert.equal(preflightCloud.ok, true);
  assert.equal(preflightCloud.engine, "cloud-hypervisor");
  assert.equal(preflightCloud.executesUserCode, false);
  assert.equal((preflightCloud.policy as Record<string, unknown>).network, "none");
  assert.equal((preflightCloud.policy as Record<string, unknown>).readOnlyRootfs, true);
  assert.ok((preflightCloud.plannedCommand as string[]).includes("--kernel"));
  assert.ok((preflightCloud.plannedCommand as string[]).some((item) => item.includes("rootfs.ext4") && item.includes("readonly=on")));
  assert.ok((preflightCloud.plannedCommand as string[]).some((item) => item.includes("seed.iso")));

  const sourceRootfsPath = path.join(workspaceRoot, "source-rootfs.ext4");
  const sourceFirmwarePath = path.join(workspaceRoot, "source-firmware.bin");
  const sourceSeedPath = path.join(workspaceRoot, "source-seed.iso");
  await writeFile(sourceRootfsPath, "prepared-rootfs-from-microvm-scaffold", "utf-8");
  await writeFile(sourceFirmwarePath, "prepared-firmware-from-microvm-scaffold", "utf-8");
  await writeFile(sourceSeedPath, "prepared-seed-from-microvm-scaffold", "utf-8");
  runPrepareScript(result.buildPowerShellPath, result.buildShellPath, {
    ...process.env,
    AGENT_FLOW_MICROVM_ENGINE: "cloud-hypervisor",
    AGENT_FLOW_MICROVM_ROOTFS_IMAGE: sourceRootfsPath,
    AGENT_FLOW_MICROVM_FIRMWARE_IMAGE: sourceFirmwarePath,
    AGENT_FLOW_MICROVM_SEED_IMAGE: sourceSeedPath,
  });
  const preparedManifest = JSON.parse(await readFile(path.join(outDir, "manifests", "image.manifest.json"), "utf-8")) as Record<string, unknown>;
  assert.equal(preparedManifest.engine, "cloud-hypervisor");
  const preparedArtifacts = (preparedManifest.bootArtifacts as Record<string, unknown>[]) || [];
  assert.equal(preparedArtifacts.some((artifact) => artifact.kind === "firmware"), true);
  assert.equal(preparedArtifacts.some((artifact) => artifact.kind === "kernel"), false);
  assert.equal(preparedArtifacts.some((artifact) => artifact.kind === "cloud-init-seed"), true);

  const preflightFirmwareOnlyStdout = execFileSync("python", [result.microvmRunnerPath!, "--preflight"], {
    input: JSON.stringify({
      protocol: "agent-flow-vm-runner.v1",
      workspace: outDir,
      vm: {
        engine: "cloud-hypervisor",
        cloudHypervisorBinary: cloudHypervisorPath,
        image_manifest: "manifests/image.manifest.json",
      },
    }),
    cwd: outDir,
    encoding: "utf-8",
  });
  const preflightFirmwareOnly = JSON.parse(preflightFirmwareOnlyStdout) as Record<string, unknown>;
  assert.equal(preflightFirmwareOnly.ok, true);
  assert.equal(preflightFirmwareOnly.engine, "cloud-hypervisor");
  assert.ok((preflightFirmwareOnly.plannedCommand as string[]).includes("--firmware"));
  assert.equal((preflightFirmwareOnly.plannedCommand as string[]).includes("--kernel"), false);
  assert.equal((preflightFirmwareOnly.policy as Record<string, unknown>).readOnlyRootfs, true);

  const serialized = JSON.stringify({
    scaffold,
    runnerManifest,
    imageManifestTemplate,
    microvmPolicyManifest,
    prepareShell,
    preparePowerShell,
    preflightFirecrackerShell,
    preflightCloudShell,
    readme,
  });
  assert.equal(serialized.includes(workspaceRoot), false);
  assert.equal(/BEGIN (OPENSSH |RSA |EC )?PRIVATE KEY|api[_-]?secret|password\s*[:=]/i.test(serialized), false);

  console.log(
    JSON.stringify(
      {
        status: "ok",
        format: "agent-flow-builder.vm-microvm-image-scaffold-gate.v1",
        imageId: result.imageId,
        includesGuestAgent: true,
        includesMicrovmRunner: true,
        includesHardenedPolicyManifest: true,
        includesPrepareScripts: true,
        generatedPrepareSupportsFirmware: true,
        hardenedPolicyNetworkNone: true,
        hardenedPolicyReadOnlyRootfs: true,
        includesFirecrackerPreflight: true,
        includesCloudHypervisorPreflight: true,
        preflightFirecracker: "ok",
        preflightCloudHypervisor: "ok",
        preflightCloudHypervisorFirmwareOnly: "ok",
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

function runPrepareScript(powerShellPath: string, shellPath: string, env: NodeJS.ProcessEnv): void {
  if (process.platform === "win32") {
    execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", powerShellPath], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return;
  }
  execFileSync("sh", [shellPath], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
