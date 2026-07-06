import { strict as assert } from "node:assert";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { packageVmImageBundle } from "../apps/builder-api/src/vm-image-bundle.ts";
import { checkVmRunnerReadiness } from "../apps/builder-api/src/vm-runner.ts";

const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-flow-vm-bundle-"));
const execFileAsync = promisify(execFile);

try {
  const flowRoot = path.join(workspaceRoot, "flows", "reference-interview");
  const runnerPath = path.join(workspaceRoot, "bin", process.platform === "win32" ? "agent-flow-vm-runner.cmd" : "agent-flow-vm-runner");
  const runnerManifestPath = path.join(flowRoot, ".agent-flow", "vm-runners", "agent-flow-vm-runner.manifest.json");
  const imageDir = path.join(flowRoot, "images");
  const imagePath = path.join(imageDir, "agent-flow-python.qcow2");
  const kernelPath = path.join(imageDir, "vmlinux.bin");
  const seedPath = path.join(imageDir, "seed.iso");
  const policyManifestPath = path.join(imageDir, "microvm.policy.json");
  const imageManifestPath = path.join(imageDir, "agent-flow-python.afvmimage.json");
  const outDir = path.join(workspaceRoot, "dist", "python-qemu-microvm.afvmimagebundle");
  const imageBytes = "fake-qcow2-for-vm-image-bundle-gate";
  const kernelBytes = "fake-direct-kernel-for-vm-image-bundle-gate";
  const seedBytes = "fake-cloud-init-seed-for-vm-image-bundle-gate";
  const policyManifestJson = `${JSON.stringify(
    {
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
    },
    null,
    2,
  )}\n`;
  const imageSha256 = createHash("sha256").update(imageBytes).digest("hex");
  const kernelSha256 = createHash("sha256").update(kernelBytes).digest("hex");
  const seedSha256 = createHash("sha256").update(seedBytes).digest("hex");
  const policyManifestSha256 = createHash("sha256").update(policyManifestJson).digest("hex");

  await mkdir(path.dirname(runnerPath), { recursive: true });
  await mkdir(path.dirname(runnerManifestPath), { recursive: true });
  await mkdir(imageDir, { recursive: true });
  await writeFile(runnerPath, process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n", "utf-8");
  await writeFile(imagePath, imageBytes, "utf-8");
  await writeFile(kernelPath, kernelBytes, "utf-8");
  await writeFile(seedPath, seedBytes, "utf-8");
  await writeFile(policyManifestPath, policyManifestJson, "utf-8");
  await writeFile(
    runnerManifestPath,
    JSON.stringify({
      format: "agent-flow-builder.vm-runner-manifest.v1",
      protocol: "agent-flow-vm-runner.v1",
      runnerId: "local-qemu-runner",
      engines: ["qemu"],
      languages: ["python", "javascript", "typescript", "bash"],
      supportsNetworkNone: true,
      supportsReadOnlyRootfs: true,
      supportsWorkspaceMount: false,
      supportsSnapshotRestore: false,
    }),
    "utf-8",
  );
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
          requiredForBoot: true,
          sizeBytes: Buffer.byteLength(seedBytes),
          sha256: seedSha256,
        },
      ],
    }),
    "utf-8",
  );

  const result = await packageVmImageBundle({
    workspaceRoot,
    flowRoot,
    runnerManifestPath: ".agent-flow/vm-runners/agent-flow-vm-runner.manifest.json",
    imageManifestPath: "images/agent-flow-python.afvmimage.json",
    outDir,
    createdAt: "2026-07-03T00:00:00.000Z",
  });

  assert.equal(result.bundleId, "python-qemu-microvm");
  assert.equal(result.copiedImageSha256Verified, true);
  assert.equal(result.imageSha256, imageSha256);
  assert.equal(result.bootArtifactPaths.length, 2);
  assert.ok(result.policyManifestPath);
  const copiedPolicyManifest = JSON.parse(await readFile(result.policyManifestPath, "utf-8")) as Record<string, unknown>;
  assert.equal(copiedPolicyManifest.format, "agent-flow-builder.vm-policy-manifest.v1");
  assert.equal(copiedPolicyManifest.profile, "hardened");
  assert.equal(copiedPolicyManifest.readOnlyRootfs, true);

  const bundle = JSON.parse(await readFile(result.bundleManifestPath, "utf-8")) as Record<string, unknown>;
  const imageManifest = JSON.parse(await readFile(result.imageManifestPath, "utf-8")) as Record<string, unknown>;
  const runnerManifest = JSON.parse(await readFile(result.runnerManifestPath, "utf-8")) as Record<string, unknown>;
  assert.equal(bundle.format, "agent-flow-builder.vm-image-bundle.v1");
  assert.equal(bundle.bundleId, "python-qemu-microvm");
  assert.equal((bundle.governance as Record<string, unknown>).excludesSourceLocalPaths, true);
  assert.equal((bundle.governance as Record<string, unknown>).copiedImageSha256Verified, true);
  assert.equal((bundle.governance as Record<string, unknown>).copiedBootArtifactsSha256Verified, true);
  assert.equal((bundle.governance as Record<string, unknown>).includesBootArtifacts, true);
  assert.equal((bundle.governance as Record<string, unknown>).includesPolicyManifest, true);
  assert.equal((bundle.governance as Record<string, unknown>).copiedPolicyManifestSha256Verified, true);
  assert.equal((bundle.governance as Record<string, unknown>).includesPortableRunnerKit, true);
  assert.equal(JSON.stringify(bundle).includes(workspaceRoot), false);
  assert.equal(JSON.stringify(imageManifest).includes(workspaceRoot), false);
  assert.equal(JSON.stringify(runnerManifest).includes(workspaceRoot), false);
  assert.equal(imageManifest.imagePath, "../images/python-qemu-microvm.qcow2");
  assert.equal(imageManifest.sha256, imageSha256);
  assert.equal(imageManifest.policyManifest, "microvm.policy.json");
  const bundledPolicyManifest = ((bundle.image as Record<string, unknown>).policyManifest as Record<string, unknown>) || {};
  assert.equal(bundledPolicyManifest.path, "manifests/microvm.policy.json");
  assert.equal(bundledPolicyManifest.sizeBytes, Buffer.byteLength(policyManifestJson));
  assert.equal(bundledPolicyManifest.sha256, policyManifestSha256);
  const bundledBootArtifacts = ((bundle.image as Record<string, unknown>).bootArtifacts as Record<string, unknown>[]) || [];
  const imageBootArtifacts = (imageManifest.bootArtifacts as Record<string, unknown>[]) || [];
  assert.equal(bundledBootArtifacts.length, 2);
  assert.equal(imageBootArtifacts.length, 2);
  const bundledKernelArtifact = bundledBootArtifacts.find((artifact) => artifact.id === "kernel") || {};
  const bundledSeedArtifact = bundledBootArtifacts.find((artifact) => artifact.id === "cloud-init-seed") || {};
  const imageKernelArtifact = imageBootArtifacts.find((artifact) => artifact.id === "kernel") || {};
  const imageSeedArtifact = imageBootArtifacts.find((artifact) => artifact.id === "cloud-init-seed") || {};
  assert.equal(bundledKernelArtifact.kind, "kernel");
  assert.equal(bundledKernelArtifact.sha256, kernelSha256);
  assert.equal(bundledSeedArtifact.kind, "cloud-init-seed");
  assert.equal(bundledSeedArtifact.sha256, seedSha256);
  assert.equal(imageKernelArtifact.path, "../images/python-qemu-microvm-kernel.bin");
  assert.equal(imageKernelArtifact.sha256, kernelSha256);
  assert.equal(imageSeedArtifact.path, "../images/python-qemu-microvm-cloud-init-seed.iso");
  assert.equal(imageSeedArtifact.sha256, seedSha256);

  const runnerKit = bundle.runnerKit as Record<string, unknown>;
  assert.equal(runnerKit.format, "agent-flow-builder.vm-runner-kit.v1");
  assert.equal(runnerKit.localCheck, "runner-kit/check-bundle.mjs");
  assert.equal(runnerKit.referenceRunner, "runner-kit/agent-flow-vm-runner-reference.py");
  assert.equal(runnerKit.qemuRunner, "runner-kit/agent-flow-vm-runner-qemu.py");
  assert.equal(runnerKit.microvmRunner, "runner-kit/agent-flow-vm-runner-microvm.py");
  assert.equal(runnerKit.guestAgent, "runner-kit/agent-flow-vm-guest-agent.py");
  assert.equal(runnerKit.guestAgentProtocol, "agent-flow-vm-guest-agent.v1");
  assert.equal(runnerKit.requiresExternalRunnerBinary, true);
  assert.equal(runnerKit.referenceRunnerProvidesVmIsolation, false);
  assert.equal(runnerKit.qemuRunnerProvidesVmIsolation, true);
  assert.equal(runnerKit.qemuRunnerRequiresGuestAgent, true);
  assert.equal(runnerKit.qemuRunnerContractExecutionImplemented, false);
  assert.equal(runnerKit.qemuRunnerSupportsExternalGuestTransport, true);
  assert.equal(runnerKit.microvmRunnerProvidesVmIsolation, true);
  assert.equal(runnerKit.microvmRunnerRequiresGuestAgent, true);
  assert.equal(runnerKit.microvmRunnerContractExecutionImplemented, false);
  assert.equal(runnerKit.microvmRunnerSupportsFirecracker, true);
  assert.equal(runnerKit.microvmRunnerSupportsCloudHypervisor, true);
  assert.equal(runnerKit.microvmRunnerSupportsExternalGuestTransport, true);
  assert.equal((bundle.governance as Record<string, unknown>).includesReferenceContractRunner, true);
  assert.equal((bundle.governance as Record<string, unknown>).includesQemuPreflightRunner, true);
  assert.equal((bundle.governance as Record<string, unknown>).includesMicrovmPreflightRunner, true);
  assert.equal((bundle.governance as Record<string, unknown>).includesGuestAgent, true);
  assert.equal((bundle.governance as Record<string, unknown>).referenceRunnerProvidesVmIsolation, false);
  assert.equal((bundle.governance as Record<string, unknown>).qemuRunnerProvidesVmIsolation, true);
  assert.equal((bundle.governance as Record<string, unknown>).qemuRunnerRequiresGuestAgent, true);
  assert.equal((bundle.governance as Record<string, unknown>).qemuRunnerContractExecutionImplemented, false);
  assert.equal((bundle.governance as Record<string, unknown>).qemuRunnerSupportsExternalGuestTransport, true);
  assert.equal((bundle.governance as Record<string, unknown>).microvmRunnerProvidesVmIsolation, true);
  assert.equal((bundle.governance as Record<string, unknown>).microvmRunnerRequiresGuestAgent, true);
  assert.equal((bundle.governance as Record<string, unknown>).microvmRunnerContractExecutionImplemented, false);
  assert.equal((bundle.governance as Record<string, unknown>).microvmRunnerSupportsFirecracker, true);
  assert.equal((bundle.governance as Record<string, unknown>).microvmRunnerSupportsCloudHypervisor, true);
  assert.equal((bundle.governance as Record<string, unknown>).microvmRunnerSupportsExternalGuestTransport, true);

  const checkScript = await readFile(result.bundleCheckPath, "utf-8");
  const referenceRunnerPath = path.join(outDir, "runner-kit", "agent-flow-vm-runner-reference.py");
  const qemuRunnerPath = path.join(outDir, "runner-kit", "agent-flow-vm-runner-qemu.py");
  const microvmRunnerPath = path.join(outDir, "runner-kit", "agent-flow-vm-runner-microvm.py");
  const guestAgentPath = path.join(outDir, "runner-kit", "agent-flow-vm-guest-agent.py");
  const referenceRunner = await readFile(referenceRunnerPath, "utf-8");
  const qemuRunner = await readFile(qemuRunnerPath, "utf-8");
  const microvmRunner = await readFile(microvmRunnerPath, "utf-8");
  const guestAgent = await readFile(guestAgentPath, "utf-8");
  const powershellEnv = await readFile(result.powershellEnvPath, "utf-8");
  const shellEnv = await readFile(result.shellEnvPath, "utf-8");
  assert.equal(checkScript.includes(workspaceRoot), false);
  assert.equal(referenceRunner.includes(workspaceRoot), false);
  assert.equal(qemuRunner.includes(workspaceRoot), false);
  assert.equal(microvmRunner.includes(workspaceRoot), false);
  assert.equal(guestAgent.includes(workspaceRoot), false);
  assert.equal(powershellEnv.includes(workspaceRoot), false);
  assert.equal(shellEnv.includes(workspaceRoot), false);
  assert.ok(powershellEnv.includes("AGENT_FLOW_CODE_VM_BOOT_ARTIFACTS"));
  assert.ok(powershellEnv.includes("AGENT_FLOW_CODE_VM_SEED_IMAGE"));
  assert.ok(powershellEnv.includes("AGENT_FLOW_MICROVM_POLICY_MANIFEST"));
  assert.ok(shellEnv.includes("AGENT_FLOW_CODE_VM_BOOT_ARTIFACTS"));
  assert.ok(shellEnv.includes("AGENT_FLOW_CODE_VM_SEED_IMAGE"));
  assert.ok(shellEnv.includes("AGENT_FLOW_MICROVM_POLICY_MANIFEST"));

  const localCheckOutput = await execFileAsync(process.execPath, [result.bundleCheckPath], { cwd: outDir });
  const localCheck = JSON.parse(localCheckOutput.stdout) as Record<string, unknown>;
  assert.equal(localCheck.format, "agent-flow-builder.vm-image-bundle-local-check.v1");
  assert.equal(localCheck.status, "ok");
  assert.equal(localCheck.imageSha256, imageSha256);
  assert.equal(localCheck.bootArtifactCount, 2);
  assert.equal(localCheck.policyManifest, "ok");
  assert.equal(localCheck.executesUserCode, false);

  const runnerRequest = {
    protocol: "agent-flow-vm-runner.v1",
    entry: "run",
    language: "python",
    input: "conteudo",
    context: { node_id: "vm_questions", session_id: "session-1", input_path: "assistant_message.text" },
    contract: { sandbox_isolation: "vm", sandbox_vm_image_id: "python-qemu-microvm" },
    vm: { profile: "hardened", image: "images/python-qemu-microvm.qcow2" },
    inlineSource: "def run(value, context, contract):\n    return {'value': value, 'node': context['node_id'], 'isolation': contract['sandbox_isolation']}\n",
    workspace: outDir,
    workspaceIsolation: "vm",
  };
  const referenceRunnerStdout = execFileSync("python", [referenceRunnerPath], {
    input: JSON.stringify(runnerRequest),
    cwd: outDir,
    encoding: "utf-8",
  });
  const referenceRunnerResult = JSON.parse(referenceRunnerStdout) as Record<string, unknown>;
  assert.equal(referenceRunnerResult.ok, true);
  assert.equal(referenceRunnerResult.runner, "agent-flow-vm-runner-reference");
  assert.equal(referenceRunnerResult.providesVmIsolation, false);
  assert.deepEqual(referenceRunnerResult.output, { value: "conteudo", node: "vm_questions", isolation: "vm" });

  const guestAgentStdout = execFileSync("python", [guestAgentPath], {
    input: JSON.stringify({
      ...runnerRequest,
      inlineSource: "def run(value, context, contract):\n    return {'value': value, 'node': context['node_id'], 'guest': True}\n",
    }),
    cwd: outDir,
    encoding: "utf-8",
  });
  const guestAgentResult = JSON.parse(guestAgentStdout) as Record<string, unknown>;
  assert.equal(guestAgentResult.ok, true);
  assert.equal(guestAgentResult.runner, "agent-flow-vm-guest-agent");
  assert.equal(guestAgentResult.guestAgentProtocol, "agent-flow-vm-guest-agent.v1");
  assert.equal(guestAgentResult.executesInsideGuest, true);
  assert.deepEqual(guestAgentResult.output, { value: "conteudo", node: "vm_questions", guest: true });

  const qemuPreflightStdout = execFileSync("python", [qemuRunnerPath, "--preflight"], {
    input: JSON.stringify({
      protocol: "agent-flow-vm-runner.v1",
      workspace: outDir,
      vm: {
        engine: "qemu",
        qemuBinary: runnerPath,
        image_manifest: "manifests/image.manifest.json",
        memory: "1024m",
        cpus: "1",
      },
    }),
    cwd: outDir,
    encoding: "utf-8",
  });
  const qemuPreflight = JSON.parse(qemuPreflightStdout) as Record<string, unknown>;
  assert.equal(qemuPreflight.ok, true);
  assert.equal(qemuPreflight.format, "agent-flow-vm-runner-qemu-preflight.v1");
  assert.equal(qemuPreflight.providesVmIsolation, true);
  assert.equal(qemuPreflight.contractExecutionImplemented, false);
  assert.equal(qemuPreflight.requiresGuestAgent, true);
  assert.equal(qemuPreflight.supportsExternalGuestTransport, true);
  assert.equal(qemuPreflight.executesUserCode, false);
  assert.equal((qemuPreflight.image as Record<string, unknown>).sha256, imageSha256);
  const qemuPreflightSeed = (qemuPreflight.bootArtifacts as Record<string, unknown>[]).find((artifact) => artifact.kind === "cloud-init-seed") || {};
  assert.equal(qemuPreflightSeed.sha256, seedSha256);
  assert.ok((qemuPreflight.plannedCommand as string[]).some((item) => item.includes("cloud-init-seed.iso")));

  const microvmPreflightStdout = execFileSync("python", [microvmRunnerPath, "--preflight"], {
    input: JSON.stringify({
      protocol: "agent-flow-vm-runner.v1",
      workspace: outDir,
      vm: {
        engine: "firecracker",
        firecrackerBinary: runnerPath,
        image_manifest: "manifests/image.manifest.json",
        memory: "1024m",
        cpus: "1",
      },
    }),
    cwd: outDir,
    encoding: "utf-8",
  });
  const microvmPreflight = JSON.parse(microvmPreflightStdout) as Record<string, unknown>;
  assert.equal(microvmPreflight.ok, true);
  assert.equal(microvmPreflight.format, "agent-flow-vm-runner-microvm-preflight.v1");
  assert.equal(microvmPreflight.engine, "firecracker");
  assert.equal(microvmPreflight.providesVmIsolation, true);
  assert.equal(microvmPreflight.executesUserCode, false);
  const microvmPolicy = microvmPreflight.policy as Record<string, unknown>;
  assert.equal(microvmPolicy.profile, "hardened");
  assert.equal(microvmPolicy.network, "none");
  assert.equal(microvmPolicy.readOnlyRootfs, true);
  assert.equal(microvmPolicy.workspaceMount, false);
  assert.equal(microvmPolicy.hostDevicePassthrough, false);
  assert.equal(microvmPolicy.guestTransportAssuranceRequired, "guest_vm");
  assert.equal(microvmPolicy.maxMemoryMiB, 4096);
  assert.equal(microvmPolicy.maxCpus, 4);
  assert.ok(String(microvmPolicy.policyManifest).includes("microvm.policy.json"));
  const microvmEnginePlan = microvmPreflight.enginePlan as Record<string, unknown>;
  const microvmPlannedConfig = microvmEnginePlan.plannedConfig as Record<string, unknown>;
  const microvmRootDrive = ((microvmPlannedConfig.drives as Record<string, unknown>[]) || []).find((drive) => drive.drive_id === "rootfs") || {};
  assert.equal(microvmRootDrive.is_read_only, true);

  const qemuTransportStdout = execFileSync("python", [qemuRunnerPath], {
    input: JSON.stringify({
      ...runnerRequest,
      inlineSource: "def run(value, context, contract):\n    return {'value': value, 'node': context['node_id'], 'guest': True}\n",
      vm: {
        engine: "qemu",
        qemuBinary: runnerPath,
        image_manifest: "manifests/image.manifest.json",
        guestTransportCommand: "python",
        guestTransportArgs: [guestAgentPath],
        guestTransportAssurance: "simulated",
      },
    }),
    cwd: outDir,
    encoding: "utf-8",
  });
  const qemuTransport = JSON.parse(qemuTransportStdout) as Record<string, unknown>;
  assert.equal(qemuTransport.ok, true);
  assert.equal(qemuTransport.runner, "agent-flow-vm-runner-qemu");
  assert.equal(qemuTransport.contractExecutionImplemented, true);
  assert.equal(qemuTransport.supportsExternalGuestTransport, true);
  assert.equal(qemuTransport.providesVmIsolation, false);
  assert.equal(qemuTransport.qemuPreflightProvidesVmIsolation, true);
  assert.equal(qemuTransport.guestAgentRunner, "agent-flow-vm-guest-agent");
  assert.deepEqual(qemuTransport.output, { value: "conteudo", node: "vm_questions", guest: true });

  const bundledReadiness = checkVmRunnerReadiness({
    workspaceRoot,
    flowRoot: outDir,
    flowId: "bundled-vm-image",
    node: {
      id: "vm_questions",
      type: "code",
      sandboxIsolation: "vm",
      sandboxVmImageId: "python-qemu-microvm",
      sandboxVmRunner: runnerPath,
      sandboxVmRunnerManifest: "manifests/runner.manifest.json",
      sandboxVmImageManifest: "manifests/image.manifest.json",
      sandboxVmEngine: "qemu",
      sandboxVmProfile: "hardened",
    },
    env: {},
  });

  assert.equal(bundledReadiness.status, "ready");
  assert.equal(bundledReadiness.imageManifest.sha256Verified, true);
  assert.equal(bundledReadiness.executesUserCode, false);

  console.log(
    JSON.stringify(
      {
        status: "ok",
        format: "agent-flow-builder.vm-image-bundle-gate.v1",
        bundleId: result.bundleId,
        copiedImageSha256Verified: result.copiedImageSha256Verified,
        bootArtifactCount: result.bootArtifactPaths.length,
        bundledReadiness: bundledReadiness.status,
        portableRunnerKit: true,
        localCheck: "ok",
        referenceRunnerContract: "ok",
        referenceRunnerProvidesVmIsolation: false,
        guestAgentContract: "ok",
        guestAgentProtocol: "agent-flow-vm-guest-agent.v1",
        qemuPreflight: "ok",
        microvmPreflight: "ok",
        policyManifest: "ok",
        microvmPolicyReadOnlyRootfs: true,
        microvmRunnerKit: true,
        qemuRunnerRequiresGuestAgent: true,
        qemuExternalGuestTransportContract: "ok",
        qemuSimulatedTransportProvidesVmIsolation: false,
        excludesSourceLocalPaths: true,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(workspaceRoot, { recursive: true, force: true });
}
