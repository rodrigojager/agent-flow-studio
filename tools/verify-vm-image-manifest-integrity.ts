import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checkVmRunnerReadiness } from "../apps/builder-api/src/vm-runner.ts";

const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-flow-vm-manifest-"));

try {
  const flowRoot = path.join(workspaceRoot, "flows", "reference-interview");
  const runnerPath = path.join(workspaceRoot, "bin", process.platform === "win32" ? "agent-flow-vm-runner.cmd" : "agent-flow-vm-runner");
  const runnerManifestPath = path.join(flowRoot, ".agent-flow", "vm-runners", "agent-flow-vm-runner.manifest.json");
  const imageDir = path.join(flowRoot, "images");
  const imagePath = path.join(imageDir, "agent-flow-python.qcow2");
  const imageManifestPath = path.join(imageDir, "agent-flow-python.afvmimage.json");
  const badImageManifestPath = path.join(imageDir, "agent-flow-python.bad.afvmimage.json");
  const imageBytes = "fake-qcow2-for-distribution-integrity-gate";
  const imageSha256 = createHash("sha256").update(imageBytes).digest("hex");

  await mkdir(path.dirname(runnerPath), { recursive: true });
  await mkdir(path.dirname(runnerManifestPath), { recursive: true });
  await mkdir(imageDir, { recursive: true });
  await writeFile(runnerPath, process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n", "utf-8");
  await writeFile(imagePath, imageBytes, "utf-8");
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
    }),
    "utf-8",
  );
  await writeFile(
    badImageManifestPath,
    JSON.stringify({
      format: "agent-flow-builder.vm-image-manifest.v1",
      imageId: "python-qemu-microvm",
      engine: "qemu",
      language: "python",
      imagePath: "agent-flow-python.qcow2",
      sizeBytes: Buffer.byteLength(imageBytes),
      sha256: "0".repeat(64),
    }),
    "utf-8",
  );

  const ready = checkVmRunnerReadiness({
    workspaceRoot,
    flowRoot,
    flowId: "reference-interview",
    node: {
      id: "vm_questions",
      type: "code",
      sandboxIsolation: "vm",
      sandboxVmImageId: "python-qemu-microvm",
      sandboxVmRunner: runnerPath,
      sandboxVmRunnerManifest: ".agent-flow/vm-runners/agent-flow-vm-runner.manifest.json",
      sandboxVmImageManifest: "images/agent-flow-python.afvmimage.json",
      sandboxVmEngine: "qemu",
      sandboxVmProfile: "hardened",
      sandboxVmMemory: "1024m",
      sandboxVmCpus: "1",
    },
    env: {},
  });

  assert.equal(ready.status, "ready");
  assert.equal(ready.executesUserCode, false);
  assert.equal(ready.imageManifest.sha256, imageSha256);
  assert.equal(ready.imageManifest.sha256Verified, true);
  assert.ok(ready.checks.some((check) => check.id === "image-manifest-sha256" && check.level === "ok"));
  assert.equal(ready.checks.every((check) => check.level === "ok"), true);

  const blocked = checkVmRunnerReadiness({
    workspaceRoot,
    flowRoot,
    flowId: "reference-interview",
    node: {
      id: "vm_questions",
      type: "code",
      sandboxIsolation: "vm",
      sandboxVmImageId: "python-qemu-microvm",
      sandboxVmRunner: runnerPath,
      sandboxVmRunnerManifest: ".agent-flow/vm-runners/agent-flow-vm-runner.manifest.json",
      sandboxVmImageManifest: "images/agent-flow-python.bad.afvmimage.json",
      sandboxVmEngine: "qemu",
      sandboxVmProfile: "hardened",
    },
    env: {},
  });

  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.executesUserCode, false);
  assert.equal(blocked.imageManifest.sha256Verified, false);
  assert.ok(blocked.checks.some((check) => check.id === "image-manifest-sha256" && check.level === "error"));

  console.log(
    JSON.stringify(
      {
        status: "ok",
        format: "agent-flow-builder.vm-image-manifest-integrity-gate.v1",
        checkedCases: ["sha256_match_ready", "sha256_mismatch_blocked"],
        executesUserCode: false,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(workspaceRoot, { recursive: true, force: true });
}
