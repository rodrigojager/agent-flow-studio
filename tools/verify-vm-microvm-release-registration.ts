import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createMicrovmHomologation } from "../apps/builder-api/src/vm-image-homologation.ts";
import { packageVmImageBundle } from "../apps/builder-api/src/vm-image-bundle.ts";
import { createMicrovmOfficialImageRecipe } from "../apps/builder-api/src/vm-microvm-official-recipe.ts";
import { registerMicrovmImageRelease } from "../apps/builder-api/src/vm-microvm-release-registration.ts";
import { checkVmRunnerReadiness } from "../apps/builder-api/src/vm-runner.ts";

const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-flow-microvm-release-registration-"));

try {
  const recipeDir = path.join(workspaceRoot, "registered-microvm.recipe");
  const imageId = "python-registered-firecracker";
  const recipe = await createMicrovmOfficialImageRecipe({
    outDir: recipeDir,
    imageId,
    channel: "local",
    version: "2026.07.03",
    createdAt: "2026-07-03T00:00:00.000Z",
  });

  const sourceDir = path.join(workspaceRoot, "operator-inputs");
  await mkdir(sourceDir, { recursive: true });
  const rootfsBytes = "fake-rootfs-for-microvm-release-registration";
  const kernelBytes = "fake-kernel-for-microvm-release-registration";
  const seedBytes = "fake-seed-for-microvm-release-registration";
  const rootfsSha256 = sha256(rootfsBytes);
  const rootfsPath = path.join(sourceDir, "rootfs.ext4");
  const kernelPath = path.join(sourceDir, "vmlinux");
  const seedPath = path.join(sourceDir, "seed.iso");
  const firecrackerPath = path.join(sourceDir, process.platform === "win32" ? "firecracker.exe" : "firecracker");
  await writeFile(rootfsPath, rootfsBytes, "utf-8");
  await writeFile(kernelPath, kernelBytes, "utf-8");
  await writeFile(seedPath, seedBytes, "utf-8");
  await writeFile(firecrackerPath, "fake-firecracker-binary", "utf-8");

  runScript(recipe.buildPreflightPowerShellPath, recipe.buildPreflightShellPath, {
    ...process.env,
    AGENT_FLOW_MICROVM_ENGINE: "firecracker",
    AGENT_FLOW_MICROVM_ROOTFS_IMAGE: rootfsPath,
    AGENT_FLOW_MICROVM_KERNEL_IMAGE: kernelPath,
    AGENT_FLOW_MICROVM_SEED_IMAGE: seedPath,
    AGENT_FLOW_FIRECRACKER_BINARY: firecrackerPath,
  });

  await writeJson(path.join(recipeDir, "evidence", "boot.firecracker.json"), {
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

  const homologationPath = path.join(recipe.scaffoldDir, "manifests", "microvm.homologation.json");
  const homologation = await createMicrovmHomologation({
    workspaceRoot: recipeDir,
    flowRoot: recipe.scaffoldDir,
    runnerManifestPath: "manifests/runner.manifest.json",
    imageManifestPath: "manifests/image.manifest.json",
    preflightEvidencePath: "evidence/preflight.firecracker.json",
    bootEvidencePath: "evidence/boot.firecracker.json",
    outPath: homologationPath,
    createdAt: "2026-07-03T00:00:00.000Z",
  });
  assert.equal(homologation.status, "homologated");

  const bundleDir = path.join(recipeDir, "dist", `${imageId}.afvmimagebundle`);
  const bundle = await packageVmImageBundle({
    workspaceRoot: recipeDir,
    flowRoot: recipe.scaffoldDir,
    runnerManifestPath: "manifests/runner.manifest.json",
    imageManifestPath: "manifests/image.manifest.json",
    outDir: bundleDir,
    createdAt: "2026-07-03T00:00:00.000Z",
  });
  assert.equal(bundle.imageSha256, rootfsSha256);

  runScript(recipe.publishPowerShellPath, recipe.publishShellPath, process.env);
  const releaseIndexPath = path.join(recipeDir, "release", "microvm-image-release.json");
  const registrationResult = await registerMicrovmImageRelease({
    workspaceRoot: recipeDir,
    releaseIndexPath,
    createdAt: "2026-07-03T00:00:00.000Z",
  });
  assert.equal(registrationResult.status, "registered");
  assert.equal(registrationResult.imageId, imageId);
  assert.equal(registrationResult.engine, "firecracker");
  assert.equal(registrationResult.homologationStatus, "homologated");
  assert.equal(registrationResult.bundleCheckStatus, "ok");

  const registration = JSON.parse(await readFile(registrationResult.outPath, "utf-8")) as Record<string, any>;
  const runtimeConfig = JSON.parse(await readFile(registrationResult.runtimeConfigPath, "utf-8")) as Record<string, any>;
  const shellEnv = await readFile(registrationResult.shellEnvPath, "utf-8");
  const powershellEnv = await readFile(registrationResult.powershellEnvPath, "utf-8");

  assert.equal(registration.format, "agent-flow-builder.vm-microvm-image-release-registration.v1");
  assert.equal(registration.release.imageId, imageId);
  assert.equal(registration.bundle.localCheck.status, "ok");
  assert.equal(registration.bundle.localCheck.executesUserCode, false);
  assert.equal(registration.homologation.status, "homologated");
  assert.equal(registration.homologation.preflightAccepted, true);
  assert.equal(registration.homologation.bootAccepted, true);
  assert.equal(registration.image.sha256, rootfsSha256);
  assert.equal(registration.image.policyManifest.profile, "hardened");
  assert.equal(registration.image.policyManifest.network, "none");
  assert.equal(registration.image.policyManifest.readOnlyRootfs, true);
  assert.equal(registration.image.policyManifest.workspaceMount, false);
  assert.equal(registration.image.policyManifest.hostDevicePassthrough, false);
  assert.equal(registration.runtimeConfig.nodePatch.sandboxIsolation, "vm");
  assert.equal(registration.runtimeConfig.nodePatch.sandboxVmRunner, "python");
  assert.equal(registration.runtimeConfig.nodePatch.sandboxVmEngine, "firecracker");
  assert.equal(registration.runtimeConfig.nodePatch.sandboxVmProfile, "hardened");
  assert.equal(registration.governance.bundleLocalCheckPassed, true);
  assert.equal(registration.governance.consumableByStudioVmReadiness, true);
  assert.equal(registration.governance.executesUserCodeDuringRegistration, false);

  assert.equal(runtimeConfig.format, "agent-flow-builder.vm-microvm-runtime-config.v1");
  assert.equal(runtimeConfig.sandboxVmImageId, imageId);
  assert.equal(runtimeConfig.sandboxVmRunner, "python");
  assert.equal(runtimeConfig.sandboxVmEngine, "firecracker");
  assert.ok(runtimeConfig.sandboxVmArgs[0].endsWith("runner-kit/agent-flow-vm-runner-microvm.py"));
  assert.ok(runtimeConfig.sandboxVmRunnerManifest.endsWith("manifests/runner.manifest.json"));
  assert.ok(runtimeConfig.sandboxVmImageManifest.endsWith("manifests/image.manifest.json"));
  assert.ok(runtimeConfig.sandboxVmImage.includes("images/"));
  assert.ok(runtimeConfig.env.AGENT_FLOW_MICROVM_POLICY_MANIFEST.endsWith("manifests/microvm.policy.json"));
  assert.ok(shellEnv.includes("AGENT_FLOW_CODE_VM_ARGS"));
  assert.ok(powershellEnv.includes("AGENT_FLOW_CODE_VM_ARGS"));

  const serialized = JSON.stringify({ registration, runtimeConfig, shellEnv, powershellEnv });
  assert.equal(serialized.includes(workspaceRoot), false);
  assert.equal(/BEGIN (OPENSSH |RSA |EC )?PRIVATE KEY|api[_-]?secret|password\s*[:=]/i.test(serialized), false);

  const nodePatch = registration.runtimeConfig.nodePatch;
  const readiness = checkVmRunnerReadiness({
    workspaceRoot: recipeDir,
    flowRoot: recipeDir,
    flowId: "registered-release-flow",
    node: {
      id: "registered_microvm_code",
      ...nodePatch,
    },
    env: {
      ...process.env,
      PATH: process.env.PATH || "",
    },
  });
  assert.equal(readiness.status, "ready");
  assert.equal(readiness.executesUserCode, false);
  assert.equal(readiness.imageManifest.sha256Verified, true);
  assert.equal(readiness.policy.engine, "firecracker");
  assert.equal(readiness.checks.some((check) => check.id === "runner-manifest-capability-workspaceMount" && check.level === "ok"), true);

  console.log(
    JSON.stringify(
      {
        status: "ok",
        format: "agent-flow-builder.vm-microvm-release-registration-gate.v1",
        imageId,
        registered: true,
        homologationStatus: registrationResult.homologationStatus,
        bundleCheck: registrationResult.bundleCheckStatus,
        readiness: readiness.status,
        sha256Verified: readiness.imageManifest.sha256Verified,
        runtimeConfig: "ok",
        excludesResolvedLocalPaths: true,
        excludesSecrets: true,
        executesUserCodeDuringRegistration: false,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(workspaceRoot, { recursive: true, force: true });
}

function runScript(powerShellPath: string, shellPath: string, env: NodeJS.ProcessEnv): void {
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}
