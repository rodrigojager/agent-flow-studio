import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createMicrovmHomologation } from "../apps/builder-api/src/vm-image-homologation.ts";

const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-flow-microvm-homologation-"));

try {
  const flowRoot = path.join(workspaceRoot, "python-microvm.vmimage");
  const manifestsDir = path.join(flowRoot, "manifests");
  const imagesDir = path.join(flowRoot, "images");
  const rootfsBytes = "fake-rootfs-for-microvm-homologation-gate";
  const kernelBytes = "fake-kernel-for-microvm-homologation-gate";
  const seedBytes = "fake-seed-for-microvm-homologation-gate";
  const rootfsSha256 = sha256(rootfsBytes);
  const kernelSha256 = sha256(kernelBytes);
  const seedSha256 = sha256(seedBytes);
  const policyManifest = {
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
  };

  await mkdir(manifestsDir, { recursive: true });
  await mkdir(imagesDir, { recursive: true });
  await writeFile(path.join(imagesDir, "python-firecracker.rootfs.ext4"), rootfsBytes, "utf-8");
  await writeFile(path.join(imagesDir, "kernel"), kernelBytes, "utf-8");
  await writeFile(path.join(imagesDir, "seed.iso"), seedBytes, "utf-8");
  await writeJson(path.join(manifestsDir, "runner.manifest.json"), {
    format: "agent-flow-builder.vm-runner-manifest.v1",
    protocol: "agent-flow-vm-runner.v1",
    runnerId: "agent-flow-microvm-direct-kernel",
    engines: ["firecracker", "cloud-hypervisor"],
    languages: ["python", "javascript", "typescript", "bash"],
    supportsNetworkNone: true,
    supportsReadOnlyRootfs: true,
    supportsWorkspaceMount: false,
    supportsHostDevicePassthrough: false,
    supportsSnapshotRestore: false,
    supportsExternalGuestTransport: true,
  });
  await writeJson(path.join(manifestsDir, "microvm.policy.json"), policyManifest);
  await writeJson(path.join(manifestsDir, "image.manifest.json"), {
    format: "agent-flow-builder.vm-image-manifest.v1",
    imageId: "python-firecracker-microvm",
    engine: "firecracker",
    language: "python",
    imagePath: "../images/python-firecracker.rootfs.ext4",
    sizeBytes: Buffer.byteLength(rootfsBytes),
    sha256: rootfsSha256,
    policyManifest: "microvm.policy.json",
    bootArtifacts: [
      {
        id: "kernel",
        kind: "kernel",
        path: "../images/kernel",
        requiredForBoot: true,
        sizeBytes: Buffer.byteLength(kernelBytes),
        sha256: kernelSha256,
      },
      {
        id: "cloud-init-seed",
        kind: "cloud-init-seed",
        path: "../images/seed.iso",
        requiredForBoot: false,
        sizeBytes: Buffer.byteLength(seedBytes),
        sha256: seedSha256,
      },
    ],
  });

  const blockedResult = await createMicrovmHomologation({
    workspaceRoot,
    flowRoot,
    runnerManifestPath: "manifests/runner.manifest.json",
    imageManifestPath: "manifests/image.manifest.json",
    outPath: path.join(flowRoot, "manifests", "microvm.blocked.afvmhomologation.json"),
    createdAt: "2026-07-03T00:00:00.000Z",
  });
  assert.equal(blockedResult.status, "blocked");
  assert.deepEqual(blockedResult.missingEvidence, ["microvm_preflight_ok", "microvm_real_boot_ok"]);

  await writeJson(path.join(flowRoot, "preflight.firecracker.json"), {
    ok: true,
    format: "agent-flow-vm-runner-microvm-preflight.v1",
    runner: "agent-flow-vm-runner-microvm",
    protocol: "agent-flow-vm-runner.v1",
    engine: "firecracker",
    providesVmIsolation: true,
    contractExecutionImplemented: false,
    supportsExternalGuestTransport: true,
    requiresGuestAgent: true,
    executesUserCode: false,
    image: {
      value: "manifests/image.manifest.json",
      resolved: true,
      sizeBytes: Buffer.byteLength(rootfsBytes),
      sha256: rootfsSha256,
      sha256Verified: true,
    },
    bootArtifacts: [
      { id: "kernel", kind: "kernel", sizeBytes: Buffer.byteLength(kernelBytes), sha256: kernelSha256 },
      { id: "cloud-init-seed", kind: "cloud-init-seed", sizeBytes: Buffer.byteLength(seedBytes), sha256: seedSha256 },
    ],
    policy: {
      profile: "hardened",
      memory: "1024M",
      cpus: "1",
      network: "none",
      readOnlyRootfs: true,
      workspaceMount: false,
      hostDevicePassthrough: false,
      snapshotRestore: false,
      guestTransportAssuranceRequired: "guest_vm",
      maxMemoryMiB: 4096,
      maxCpus: 4,
      policyManifest: "manifests/microvm.policy.json",
    },
  });

  const preflightResult = await createMicrovmHomologation({
    workspaceRoot,
    flowRoot,
    runnerManifestPath: "manifests/runner.manifest.json",
    imageManifestPath: "manifests/image.manifest.json",
    preflightEvidencePath: "preflight.firecracker.json",
    outPath: path.join(flowRoot, "manifests", "microvm.preflight.afvmhomologation.json"),
    createdAt: "2026-07-03T00:00:00.000Z",
  });
  assert.equal(preflightResult.status, "preflight_verified");
  assert.deepEqual(preflightResult.missingEvidence, ["microvm_real_boot_ok"]);

  await writeJson(path.join(flowRoot, "boot.firecracker.json"), {
    status: "ok",
    format: "agent-flow-builder.vm-microvm-real-smoke-gate.v1",
    mode: "real-boot",
    engine: "firecracker",
    realSmokeEnabled: true,
    realBootEnabled: true,
    scaffoldReady: true,
    imageManifestGenerated: true,
    preflight: "ok",
    bootProcessStayedAlive: true,
    bootObservationSeconds: 8,
    guestAgentContract: "ok",
    providesVmIsolation: true,
    executesUserCode: true,
  });

  const homologatedPath = path.join(flowRoot, "manifests", "microvm.homologated.afvmhomologation.json");
  const homologatedResult = await createMicrovmHomologation({
    workspaceRoot,
    flowRoot,
    runnerManifestPath: "manifests/runner.manifest.json",
    imageManifestPath: "manifests/image.manifest.json",
    preflightEvidencePath: "preflight.firecracker.json",
    bootEvidencePath: "boot.firecracker.json",
    outPath: homologatedPath,
    createdAt: "2026-07-03T00:00:00.000Z",
  });
  assert.equal(homologatedResult.status, "homologated");
  assert.deepEqual(homologatedResult.missingEvidence, []);
  assert.equal(homologatedResult.imageSha256, rootfsSha256);
  assert.equal(homologatedResult.policyProfile, "hardened");

  const homologation = JSON.parse(await readFile(homologatedPath, "utf-8")) as Record<string, any>;
  assert.equal(homologation.format, "agent-flow-builder.vm-microvm-homologation.v1");
  assert.equal(homologation.status, "homologated");
  assert.equal(homologation.homologationLevel, "real_boot_guest_transport");
  assert.equal(homologation.image.sha256, rootfsSha256);
  assert.equal(homologation.image.bootArtifacts.length, 2);
  assert.equal(homologation.policy.profile, "hardened");
  assert.equal(homologation.policy.network, "none");
  assert.equal(homologation.policy.readOnlyRootfs, true);
  assert.equal(homologation.policy.workspaceMount, false);
  assert.equal(homologation.policy.hostDevicePassthrough, false);
  assert.equal(homologation.policy.requireGuestTransportAssurance, "guest_vm");
  assert.equal(homologation.evidence.preflight.accepted, true);
  assert.equal(homologation.evidence.boot.accepted, true);
  assert.equal(homologation.governance.excludesResolvedLocalPaths, true);
  assert.equal(homologation.governance.executesUserCodeDuringManifestBuild, false);
  assert.equal(JSON.stringify(homologation).includes(workspaceRoot), false);

  console.log(
    JSON.stringify(
      {
        status: "ok",
        format: "agent-flow-builder.vm-microvm-homologation-gate.v1",
        blockedWithoutEvidence: blockedResult.status === "blocked",
        preflightVerified: preflightResult.status === "preflight_verified",
        homologated: homologatedResult.status === "homologated",
        policyProfile: homologatedResult.policyProfile,
        imageSha256: homologatedResult.imageSha256,
        excludesResolvedLocalPaths: true,
        executesUserCodeDuringManifestBuild: false,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(workspaceRoot, { recursive: true, force: true });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}
