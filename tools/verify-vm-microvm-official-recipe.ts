import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createMicrovmHomologation } from "../apps/builder-api/src/vm-image-homologation.ts";
import { packageVmImageBundle } from "../apps/builder-api/src/vm-image-bundle.ts";
import { createMicrovmOfficialImageRecipe } from "../apps/builder-api/src/vm-microvm-official-recipe.ts";

const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-flow-microvm-official-recipe-"));

try {
  const recipeDir = path.join(workspaceRoot, "official-microvm.recipe");
  const imageId = "python-official-firecracker";
  const result = await createMicrovmOfficialImageRecipe({
    outDir: recipeDir,
    imageId,
    channel: "local",
    version: "2026.07.03",
    createdAt: "2026-07-03T00:00:00.000Z",
  });

  assert.equal(result.format, "agent-flow-builder.vm-microvm-official-image-recipe-result.v1");
  assert.equal(result.imageId, imageId);
  assert.equal(result.recipeId, `${imageId}-local-2026.07.03`);

  const recipe = JSON.parse(await readFile(result.recipeManifestPath, "utf-8")) as Record<string, any>;
  const scaffold = JSON.parse(await readFile(result.scaffoldManifestPath, "utf-8")) as Record<string, any>;
  const runnerManifest = JSON.parse(await readFile(result.runnerManifestPath, "utf-8")) as Record<string, any>;
  const imageManifestTemplate = JSON.parse(await readFile(result.imageManifestTemplatePath, "utf-8")) as Record<string, any>;
  const policyManifest = JSON.parse(await readFile(result.policyManifestPath, "utf-8")) as Record<string, any>;
  const readme = await readFile(result.readmePath, "utf-8");
  const buildShell = await readFile(result.buildPreflightShellPath, "utf-8");
  const buildPowerShell = await readFile(result.buildPreflightPowerShellPath, "utf-8");
  const homologateShell = await readFile(result.homologateBundleShellPath, "utf-8");
  const homologatePowerShell = await readFile(result.homologateBundlePowerShellPath, "utf-8");
  const publishShell = await readFile(result.publishShellPath, "utf-8");
  const publishPowerShell = await readFile(result.publishPowerShellPath, "utf-8");
  const releaseChecklist = await readFile(result.releaseChecklistPath, "utf-8");
  const preflightTemplate = JSON.parse(await readFile(result.preflightEvidenceTemplatePath, "utf-8")) as Record<string, any>;
  const bootTemplate = JSON.parse(await readFile(result.bootEvidenceTemplatePath, "utf-8")) as Record<string, any>;

  assert.equal(recipe.format, "agent-flow-builder.vm-microvm-official-image-recipe.v1");
  assert.equal(recipe.sourceScaffold.policyManifest, "image-source/manifests/microvm.policy.json");
  assert.equal(recipe.expectedEvidence.preflightEvidence, "evidence/preflight.firecracker.json");
  assert.equal(recipe.expectedEvidence.homologationManifest, "image-source/manifests/microvm.homologation.json");
  assert.equal(recipe.expectedEvidence.bundle, `dist/${imageId}.afvmimagebundle`);
  assert.equal(recipe.expectedEvidence.releaseRegistration, "release/microvm-image-release.afvmrelease.json");
  assert.equal(recipe.expectedEvidence.runtimeConfig, "release/microvm-runtime-config.json");
  assert.equal(recipe.releaseCriteria.requiresPreflightEvidence, true);
  assert.equal(recipe.releaseCriteria.requiresBootEvidenceForHomologatedStatus, true);
  assert.equal(recipe.releaseCriteria.requiresBundleLocalCheck, true);
  assert.equal(recipe.governance.doesNotDownloadDuringRecipeGate, true);
  assert.equal(recipe.governance.doesNotBootDuringRecipeGate, true);
  assert.equal(recipe.governance.doesNotExecuteUserCodeDuringRecipeGate, true);
  assert.equal(recipe.governance.requiresOperatorProvidedArtifacts, true);
  assert.equal(recipe.governance.supportsLocalPublicationWithoutCloudFees, true);

  assert.equal(scaffold.engine, "microvm-direct-kernel");
  assert.deepEqual(scaffold.supportedEngines, ["firecracker", "cloud-hypervisor"]);
  assert.equal(runnerManifest.protocol, "agent-flow-vm-runner.v1");
  assert.deepEqual(runnerManifest.engines, ["firecracker", "cloud-hypervisor"]);
  assert.equal(imageManifestTemplate.policyManifest, "microvm.policy.json");
  assert.equal(policyManifest.profile, "hardened");
  assert.equal(policyManifest.network, "none");
  assert.equal(policyManifest.readOnlyRootfs, true);
  assert.equal(policyManifest.workspaceMount, false);
  assert.equal(policyManifest.hostDevicePassthrough, false);
  assert.equal(policyManifest.requireGuestTransportAssurance, "guest_vm");

  assert.ok(readme.includes("scripts/01-build-and-preflight"));
  assert.ok(readme.includes("scripts/02-homologate-and-bundle"));
  assert.ok(readme.includes("scripts/03-publish-local-bundle"));
  assert.ok(readme.includes("vm-image:microvm-register"));
  assert.ok(readme.includes("AGENT_FLOW_MICROVM_ROOTFS_IMAGE"));
  assert.ok(buildShell.includes("preflight-firecracker.sh"));
  assert.ok(buildPowerShell.includes("preflight-firecracker.ps1"));
  assert.ok(homologateShell.includes("npm --prefix"));
  assert.ok(homologateShell.includes("vm-image:homologate"));
  assert.ok(homologateShell.includes("vm-image:bundle"));
  assert.ok(homologatePowerShell.includes("vm-image:homologate"));
  assert.ok(homologatePowerShell.includes("vm-image:bundle"));
  assert.ok(publishShell.includes("microvm-image-release.json"));
  assert.ok(publishPowerShell.includes("microvm-image-release.json"));
  assert.ok(releaseChecklist.includes("microvm.homologation.json"));
  assert.ok(releaseChecklist.includes("microvm-runtime-config.json"));
  assert.equal(preflightTemplate.format, "agent-flow-vm-runner-microvm-preflight.v1");
  assert.equal(bootTemplate.format, "agent-flow-builder.vm-microvm-real-smoke-gate.v1");
  assert.equal(bootTemplate.mode, "real-boot");

  const serializedRecipe = JSON.stringify({
    recipe,
    scaffold,
    runnerManifest,
    imageManifestTemplate,
    policyManifest,
    readme,
    buildShell,
    buildPowerShell,
    homologateShell,
    homologatePowerShell,
    publishShell,
    publishPowerShell,
    releaseChecklist,
    preflightTemplate,
    bootTemplate,
  });
  assert.equal(serializedRecipe.includes(workspaceRoot), false);
  assert.equal(/BEGIN (OPENSSH |RSA |EC )?PRIVATE KEY|api[_-]?secret|password\s*[:=]/i.test(serializedRecipe), false);
  assert.equal(/\b(curl|wget|Invoke-WebRequest|docker\s+pull)\b/i.test(`${buildShell}\n${buildPowerShell}`), false);

  const sourceDir = path.join(workspaceRoot, "operator-inputs");
  await mkdir(sourceDir, { recursive: true });
  const sourceRootfsPath = path.join(sourceDir, "rootfs.ext4");
  const sourceKernelPath = path.join(sourceDir, "vmlinux");
  const sourceSeedPath = path.join(sourceDir, "seed.iso");
  const firecrackerPath = path.join(sourceDir, process.platform === "win32" ? "firecracker.exe" : "firecracker");
  const rootfsBytes = "fake-rootfs-for-official-microvm-recipe";
  const kernelBytes = "fake-kernel-for-official-microvm-recipe";
  const seedBytes = "fake-seed-for-official-microvm-recipe";
  const rootfsSha256 = sha256(rootfsBytes);
  const kernelSha256 = sha256(kernelBytes);
  const seedSha256 = sha256(seedBytes);
  await writeFile(sourceRootfsPath, rootfsBytes, "utf-8");
  await writeFile(sourceKernelPath, kernelBytes, "utf-8");
  await writeFile(sourceSeedPath, seedBytes, "utf-8");
  await writeFile(firecrackerPath, "fake-firecracker-binary", "utf-8");

  runScript(result.buildPreflightPowerShellPath, result.buildPreflightShellPath, {
    ...process.env,
    AGENT_FLOW_MICROVM_ENGINE: "firecracker",
    AGENT_FLOW_MICROVM_ROOTFS_IMAGE: sourceRootfsPath,
    AGENT_FLOW_MICROVM_KERNEL_IMAGE: sourceKernelPath,
    AGENT_FLOW_MICROVM_SEED_IMAGE: sourceSeedPath,
    AGENT_FLOW_FIRECRACKER_BINARY: firecrackerPath,
  });

  const preparedManifestPath = path.join(result.scaffoldDir, "manifests", "image.manifest.json");
  const preparedManifest = JSON.parse(await readFile(preparedManifestPath, "utf-8")) as Record<string, any>;
  assert.equal(preparedManifest.imageId, imageId);
  assert.equal(preparedManifest.engine, "firecracker");
  assert.equal(preparedManifest.sha256, rootfsSha256);
  assert.equal(preparedManifest.policyManifest, "microvm.policy.json");
  assert.equal(preparedManifest.bootArtifacts.length, 2);
  assert.equal(preparedManifest.bootArtifacts.find((item: any) => item.id === "kernel").sha256, kernelSha256);
  assert.equal(preparedManifest.bootArtifacts.find((item: any) => item.id === "cloud-init-seed").sha256, seedSha256);

  const preflightEvidencePath = path.join(recipeDir, "evidence", "preflight.firecracker.json");
  const preflightEvidence = JSON.parse(await readFile(preflightEvidencePath, "utf-8")) as Record<string, any>;
  assert.equal(preflightEvidence.ok, true);
  assert.equal(preflightEvidence.engine, "firecracker");
  assert.equal(preflightEvidence.executesUserCode, false);
  assert.equal(preflightEvidence.providesVmIsolation, true);
  assert.equal(preflightEvidence.image.sha256, rootfsSha256);
  assert.equal(preflightEvidence.policy.network, "none");
  assert.equal(preflightEvidence.policy.readOnlyRootfs, true);

  const bootEvidencePath = path.join(recipeDir, "evidence", "boot.firecracker.json");
  await writeJson(bootEvidencePath, {
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

  const homologationPath = path.join(result.scaffoldDir, "manifests", "microvm.homologation.json");
  const homologationResult = await createMicrovmHomologation({
    workspaceRoot: recipeDir,
    flowRoot: result.scaffoldDir,
    runnerManifestPath: "manifests/runner.manifest.json",
    imageManifestPath: "manifests/image.manifest.json",
    preflightEvidencePath: "evidence/preflight.firecracker.json",
    bootEvidencePath: "evidence/boot.firecracker.json",
    outPath: homologationPath,
    createdAt: "2026-07-03T00:00:00.000Z",
  });
  assert.equal(homologationResult.status, "homologated");
  assert.equal(homologationResult.imageSha256, rootfsSha256);

  const bundleDir = path.join(recipeDir, "dist", `${imageId}.afvmimagebundle`);
  const bundleResult = await packageVmImageBundle({
    workspaceRoot: recipeDir,
    flowRoot: result.scaffoldDir,
    runnerManifestPath: "manifests/runner.manifest.json",
    imageManifestPath: "manifests/image.manifest.json",
    outDir: bundleDir,
    createdAt: "2026-07-03T00:00:00.000Z",
  });
  assert.equal(bundleResult.bundleId, imageId);
  assert.equal(bundleResult.copiedImageSha256Verified, true);
  assert.equal(bundleResult.imageSha256, rootfsSha256);
  assert.ok(bundleResult.policyManifestPath);

  const checkBundleOutput = execFileSync(process.execPath, [bundleResult.bundleCheckPath], {
    cwd: bundleDir,
    encoding: "utf-8",
  });
  const checkBundle = JSON.parse(checkBundleOutput) as Record<string, any>;
  assert.equal(checkBundle.status, "ok");
  assert.equal(checkBundle.policyManifest, "ok");
  assert.equal(checkBundle.executesUserCode, false);

  runScript(result.publishPowerShellPath, result.publishShellPath, process.env);
  const releaseIndexPath = path.join(recipeDir, "release", "microvm-image-release.json");
  const releaseIndex = JSON.parse(await readFile(releaseIndexPath, "utf-8")) as Record<string, any>;
  assert.equal(releaseIndex.format, "agent-flow-builder.vm-microvm-image-local-release.v1");
  assert.equal(releaseIndex.imageId, imageId);
  assert.equal(releaseIndex.bundlePath, `dist/${imageId}.afvmimagebundle`);
  assert.equal(releaseIndex.homologationManifest, "image-source/manifests/microvm.homologation.json");
  assert.equal(releaseIndex.governance.localOnly, true);

  const serializedOutput = JSON.stringify({
    homologation: JSON.parse(await readFile(homologationPath, "utf-8")),
    bundle: JSON.parse(await readFile(bundleResult.bundleManifestPath, "utf-8")),
    releaseIndex,
  });
  assert.equal(serializedOutput.includes(workspaceRoot), false);

  console.log(
    JSON.stringify(
      {
        status: "ok",
        format: "agent-flow-builder.vm-microvm-official-recipe-gate.v1",
        recipeId: result.recipeId,
        imageId,
        includesScaffold: true,
        includesHardenedPolicy: true,
        includesBuildPreflightScripts: true,
        includesHomologateBundleScripts: true,
        includesPublishScripts: true,
        preflightEvidence: "ok",
        homologationStatus: homologationResult.status,
        bundleCheck: checkBundle.status,
        localReleaseIndex: "ok",
        excludesResolvedLocalPaths: true,
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
