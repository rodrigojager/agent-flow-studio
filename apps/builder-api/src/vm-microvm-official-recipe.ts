import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createMicrovmImageScaffold } from "./vm-image-scaffold.ts";

export interface MicrovmOfficialImageRecipeOptions {
  outDir: string;
  imageId?: string;
  channel?: string;
  version?: string;
  createdAt?: string;
}

export interface MicrovmOfficialImageRecipeResult {
  format: "agent-flow-builder.vm-microvm-official-image-recipe-result.v1";
  recipeId: string;
  imageId: string;
  channel: string;
  version: string;
  outDir: string;
  recipeManifestPath: string;
  readmePath: string;
  scaffoldDir: string;
  scaffoldManifestPath: string;
  runnerManifestPath: string;
  imageManifestTemplatePath: string;
  policyManifestPath: string;
  buildPreflightShellPath: string;
  buildPreflightPowerShellPath: string;
  homologateBundleShellPath: string;
  homologateBundlePowerShellPath: string;
  publishShellPath: string;
  publishPowerShellPath: string;
  releaseChecklistPath: string;
  preflightEvidenceTemplatePath: string;
  bootEvidenceTemplatePath: string;
}

export async function createMicrovmOfficialImageRecipe(
  options: MicrovmOfficialImageRecipeOptions,
): Promise<MicrovmOfficialImageRecipeResult> {
  const imageId = sanitizeSegment(options.imageId || "agent-flow-python-microvm-official");
  const channel = sanitizeSegment(options.channel || "local");
  const version = sanitizeVersion(options.version || "0.1.0");
  const createdAt = options.createdAt ?? new Date().toISOString();
  const recipeId = `${imageId}-${channel}-${version}`;
  const outDir = path.resolve(options.outDir);
  const scaffoldDir = path.join(outDir, "image-source");
  const scriptsDir = path.join(outDir, "scripts");
  const evidenceDir = path.join(outDir, "evidence");
  const releaseDir = path.join(outDir, "release");
  const distDir = path.join(outDir, "dist");

  await mkdir(scriptsDir, { recursive: true });
  await mkdir(evidenceDir, { recursive: true });
  await mkdir(releaseDir, { recursive: true });
  await mkdir(distDir, { recursive: true });

  const scaffold = await createMicrovmImageScaffold({
    outDir: scaffoldDir,
    imageId,
    createdAt,
  });
  if (!scaffold.microvmPolicyManifestPath) {
    throw new Error("Scaffold microVM nao retornou manifesto de politica.");
  }

  const recipeManifestPath = path.join(outDir, "microvm-official-image.recipe.json");
  const readmePath = path.join(outDir, "README.md");
  const buildPreflightShellPath = path.join(scriptsDir, "01-build-and-preflight.sh");
  const buildPreflightPowerShellPath = path.join(scriptsDir, "01-build-and-preflight.ps1");
  const homologateBundleShellPath = path.join(scriptsDir, "02-homologate-and-bundle.sh");
  const homologateBundlePowerShellPath = path.join(scriptsDir, "02-homologate-and-bundle.ps1");
  const publishShellPath = path.join(scriptsDir, "03-publish-local-bundle.sh");
  const publishPowerShellPath = path.join(scriptsDir, "03-publish-local-bundle.ps1");
  const releaseChecklistPath = path.join(releaseDir, "release-checklist.md");
  const preflightEvidenceTemplatePath = path.join(evidenceDir, "preflight.firecracker.template.json");
  const bootEvidenceTemplatePath = path.join(evidenceDir, "boot.firecracker.template.json");

  const recipeManifest = {
    format: "agent-flow-builder.vm-microvm-official-image-recipe.v1",
    recipeId,
    imageId,
    channel,
    version,
    createdAt,
    sourceScaffold: {
      path: "image-source",
      scaffoldManifest: "image-source/vm-image-scaffold.json",
      runnerManifest: "image-source/manifests/runner.manifest.json",
      imageManifestTemplate: "image-source/manifests/image.manifest.template.json",
      imageManifest: "image-source/manifests/image.manifest.json",
      policyManifest: "image-source/manifests/microvm.policy.json",
      guestAgent: "image-source/guest/agent-flow-vm-guest-agent.py",
      microvmRunner: "image-source/runner-kit/agent-flow-vm-runner-microvm.py",
    },
    scripts: {
      buildAndPreflightShell: "scripts/01-build-and-preflight.sh",
      buildAndPreflightPowerShell: "scripts/01-build-and-preflight.ps1",
      homologateAndBundleShell: "scripts/02-homologate-and-bundle.sh",
      homologateAndBundlePowerShell: "scripts/02-homologate-and-bundle.ps1",
      publishLocalBundleShell: "scripts/03-publish-local-bundle.sh",
      publishLocalBundlePowerShell: "scripts/03-publish-local-bundle.ps1",
    },
    expectedEvidence: {
      preflightEvidence: "evidence/preflight.firecracker.json",
      bootEvidence: "evidence/boot.firecracker.json",
      homologationManifest: "image-source/manifests/microvm.homologation.json",
      bundle: `dist/${imageId}.afvmimagebundle`,
      releaseIndex: "release/microvm-image-release.json",
      releaseRegistration: "release/microvm-image-release.afvmrelease.json",
      runtimeConfig: "release/microvm-runtime-config.json",
    },
    operatorInputs: {
      required: [
        "AGENT_FLOW_MICROVM_ROOTFS_IMAGE",
        "AGENT_FLOW_MICROVM_KERNEL_IMAGE or AGENT_FLOW_MICROVM_FIRMWARE_IMAGE",
        "AGENT_FLOW_FIRECRACKER_BINARY or AGENT_FLOW_CLOUD_HYPERVISOR_BINARY",
        "AGENT_FLOW_MICROVM_GUEST_TRANSPORT_COMMAND for homologated execution evidence",
      ],
      optional: [
        "AGENT_FLOW_MICROVM_ENGINE",
        "AGENT_FLOW_MICROVM_SEED_IMAGE",
        "AGENT_FLOW_REPO_ROOT",
        "AGENT_FLOW_MICROVM_BOOT_EVIDENCE",
      ],
    },
    pipeline: [
      {
        id: "scaffold",
        command: `npm run vm-image:scaffold -- --engine microvm --image-id ${imageId} --out dist/${recipeId}/image-source`,
        coveredByGate: "test:vm-microvm-image-scaffold",
      },
      {
        id: "prepare",
        command: "scripts/01-build-and-preflight",
        output: "image-source/manifests/image.manifest.json",
      },
      {
        id: "homologate",
        command: "scripts/02-homologate-and-bundle",
        output: "image-source/manifests/microvm.homologation.json",
        coveredByGate: "test:vm-microvm-homologation",
      },
      {
        id: "bundle",
        command: "npm run vm-image:bundle",
        output: `dist/${imageId}.afvmimagebundle`,
        coveredByGate: "test:vm-image-bundle",
      },
      {
        id: "publish-local",
        command: "scripts/03-publish-local-bundle",
        output: "release/microvm-image-release.json",
      },
      {
        id: "register-release",
        command: "npm run vm-image:microvm-register",
        output: "release/microvm-image-release.afvmrelease.json",
      },
    ],
    releaseCriteria: {
      requiresImageManifestSha256: true,
      requiresHardenedPolicyManifest: true,
      requiresPreflightEvidence: true,
      requiresBootEvidenceForHomologatedStatus: true,
      requiresGuestVmTransportForCodeExecution: true,
      requiresAfvmImageBundle: true,
      requiresBundleLocalCheck: true,
    },
    governance: {
      sourceFormat: "agent-flow-builder.vm-microvm-official-image-recipe.v1",
      recipeGate: "test:vm-microvm-official-recipe",
      excludesResolvedLocalPaths: true,
      excludesSecrets: true,
      excludesEnvValues: true,
      excludesPrivateKeys: true,
      excludesRootfsBinary: true,
      excludesKernelBinary: true,
      excludesFirmwareBinary: true,
      doesNotDownloadDuringRecipeGate: true,
      doesNotBootDuringRecipeGate: true,
      doesNotExecuteUserCodeDuringRecipeGate: true,
      requiresOperatorProvidedArtifacts: true,
      supportsLocalPublicationWithoutCloudFees: true,
    },
  };

  await writeJson(recipeManifestPath, recipeManifest);
  await writeFile(readmePath, buildReadme(imageId, recipeId), "utf-8");
  await writeFile(buildPreflightShellPath, buildBuildPreflightShellScript(), "utf-8");
  await writeFile(buildPreflightPowerShellPath, buildBuildPreflightPowerShellScript(), "utf-8");
  await writeFile(homologateBundleShellPath, buildHomologateBundleShellScript(imageId), "utf-8");
  await writeFile(homologateBundlePowerShellPath, buildHomologateBundlePowerShellScript(imageId), "utf-8");
  await writeFile(publishShellPath, buildPublishShellScript(imageId, recipeId, channel, version), "utf-8");
  await writeFile(publishPowerShellPath, buildPublishPowerShellScript(imageId, recipeId, channel, version), "utf-8");
  await writeFile(releaseChecklistPath, buildReleaseChecklist(imageId, recipeId), "utf-8");
  await writeJson(preflightEvidenceTemplatePath, buildPreflightEvidenceTemplate(imageId));
  await writeJson(bootEvidenceTemplatePath, buildBootEvidenceTemplate());

  return {
    format: "agent-flow-builder.vm-microvm-official-image-recipe-result.v1",
    recipeId,
    imageId,
    channel,
    version,
    outDir,
    recipeManifestPath,
    readmePath,
    scaffoldDir,
    scaffoldManifestPath: scaffold.scaffoldManifestPath,
    runnerManifestPath: scaffold.runnerManifestPath,
    imageManifestTemplatePath: scaffold.imageManifestTemplatePath,
    policyManifestPath: scaffold.microvmPolicyManifestPath,
    buildPreflightShellPath,
    buildPreflightPowerShellPath,
    homologateBundleShellPath,
    homologateBundlePowerShellPath,
    publishShellPath,
    publishPowerShellPath,
    releaseChecklistPath,
    preflightEvidenceTemplatePath,
    bootEvidenceTemplatePath,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function buildBuildPreflightShellScript(): string {
  return `#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENGINE="\${AGENT_FLOW_MICROVM_ENGINE:-firecracker}"
case "$ENGINE" in
  firecracker|cloud-hypervisor) ;;
  *) printf '%s\\n' "Unsupported AGENT_FLOW_MICROVM_ENGINE=$ENGINE" >&2; exit 2 ;;
esac
"$ROOT/image-source/scripts/prepare-direct-kernel-image.sh"
mkdir -p "$ROOT/evidence"
case "$ENGINE" in
  firecracker)
    "$ROOT/image-source/scripts/preflight-firecracker.sh" > "$ROOT/evidence/preflight.firecracker.json"
    ;;
  cloud-hypervisor)
    "$ROOT/image-source/scripts/preflight-cloud-hypervisor.sh" > "$ROOT/evidence/preflight.cloud-hypervisor.json"
    ;;
esac
printf '%s\\n' "Prepared image-source/manifests/image.manifest.json and evidence/preflight.$ENGINE.json"
printf '%s\\n' "Next: provide real boot evidence, then run scripts/02-homologate-and-bundle.sh"
`;
}

function buildBuildPreflightPowerShellScript(): string {
  return `$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Engine = if ($env:AGENT_FLOW_MICROVM_ENGINE) { $env:AGENT_FLOW_MICROVM_ENGINE } else { "firecracker" }
if ($Engine -notin @("firecracker", "cloud-hypervisor")) { throw "Unsupported AGENT_FLOW_MICROVM_ENGINE=$Engine" }
& (Join-Path $Root "image-source\\scripts\\prepare-direct-kernel-image.ps1")
New-Item -ItemType Directory -Force -Path (Join-Path $Root "evidence") | Out-Null
if ($Engine -eq "firecracker") {
  & (Join-Path $Root "image-source\\scripts\\preflight-firecracker.ps1") | Set-Content -LiteralPath (Join-Path $Root "evidence\\preflight.firecracker.json")
} else {
  & (Join-Path $Root "image-source\\scripts\\preflight-cloud-hypervisor.ps1") | Set-Content -LiteralPath (Join-Path $Root "evidence\\preflight.cloud-hypervisor.json")
}
Write-Output "Prepared image-source\\manifests\\image.manifest.json and evidence\\preflight.$Engine.json"
Write-Output "Next: provide real boot evidence, then run scripts\\02-homologate-and-bundle.ps1"
`;
}

function buildHomologateBundleShellScript(imageId: string): string {
  return `#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
REPO_ROOT="\${AGENT_FLOW_REPO_ROOT:-$(CDPATH= cd -- "$ROOT/../.." && pwd)}"
ENGINE="\${AGENT_FLOW_MICROVM_ENGINE:-firecracker}"
PREFLIGHT="\${AGENT_FLOW_MICROVM_PREFLIGHT_EVIDENCE:-evidence/preflight.$ENGINE.json}"
BOOT="\${AGENT_FLOW_MICROVM_BOOT_EVIDENCE:-evidence/boot.$ENGINE.json}"
HOMOLOGATION="image-source/manifests/microvm.homologation.json"
BUNDLE_OUT="dist/${imageId}.afvmimagebundle"
if [ ! -f "$ROOT/$PREFLIGHT" ]; then
  printf '%s\\n' "Missing preflight evidence: $PREFLIGHT" >&2
  exit 2
fi
if [ ! -f "$ROOT/$BOOT" ]; then
  printf '%s\\n' "Missing boot evidence: $BOOT" >&2
  exit 2
fi
npm --prefix "$REPO_ROOT" run vm-image:homologate -- \\
  --workspace-root "$ROOT" \\
  --flow-root image-source \\
  --runner-manifest manifests/runner.manifest.json \\
  --image-manifest manifests/image.manifest.json \\
  --preflight-evidence "$PREFLIGHT" \\
  --boot-evidence "$BOOT" \\
  --out "$HOMOLOGATION"
npm --prefix "$REPO_ROOT" run vm-image:bundle -- \\
  --workspace-root "$ROOT" \\
  --flow-root image-source \\
  --runner-manifest manifests/runner.manifest.json \\
  --image-manifest manifests/image.manifest.json \\
  --out "$BUNDLE_OUT"
node "$ROOT/$BUNDLE_OUT/runner-kit/check-bundle.mjs"
printf '%s\\n' "Homologated $HOMOLOGATION and bundled $BUNDLE_OUT"
`;
}

function buildHomologateBundlePowerShellScript(imageId: string): string {
  return `$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$RepoRoot = if ($env:AGENT_FLOW_REPO_ROOT) { Resolve-Path $env:AGENT_FLOW_REPO_ROOT } else { Resolve-Path (Join-Path $Root "..\\..") }
$Engine = if ($env:AGENT_FLOW_MICROVM_ENGINE) { $env:AGENT_FLOW_MICROVM_ENGINE } else { "firecracker" }
$Preflight = if ($env:AGENT_FLOW_MICROVM_PREFLIGHT_EVIDENCE) { $env:AGENT_FLOW_MICROVM_PREFLIGHT_EVIDENCE } else { "evidence\\preflight.$Engine.json" }
$Boot = if ($env:AGENT_FLOW_MICROVM_BOOT_EVIDENCE) { $env:AGENT_FLOW_MICROVM_BOOT_EVIDENCE } else { "evidence\\boot.$Engine.json" }
$Homologation = "image-source\\manifests\\microvm.homologation.json"
$BundleOut = "dist\\${imageId}.afvmimagebundle"
if (-not (Test-Path -LiteralPath (Join-Path $Root $Preflight))) { throw "Missing preflight evidence: $Preflight" }
if (-not (Test-Path -LiteralPath (Join-Path $Root $Boot))) { throw "Missing boot evidence: $Boot" }
$HomologateArgs = @(
  "--prefix", $RepoRoot.Path,
  "run", "vm-image:homologate", "--",
  "--workspace-root", $Root.Path,
  "--flow-root", "image-source",
  "--runner-manifest", "manifests/runner.manifest.json",
  "--image-manifest", "manifests/image.manifest.json",
  "--preflight-evidence", $Preflight,
  "--boot-evidence", $Boot,
  "--out", $Homologation
)
& npm @HomologateArgs
$BundleArgs = @(
  "--prefix", $RepoRoot.Path,
  "run", "vm-image:bundle", "--",
  "--workspace-root", $Root.Path,
  "--flow-root", "image-source",
  "--runner-manifest", "manifests/runner.manifest.json",
  "--image-manifest", "manifests/image.manifest.json",
  "--out", $BundleOut
)
& npm @BundleArgs
node (Join-Path $Root "$BundleOut\\runner-kit\\check-bundle.mjs")
Write-Output "Homologated $Homologation and bundled $BundleOut"
`;
}

function buildPublishShellScript(imageId: string, recipeId: string, channel: string, version: string): string {
  return `#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BUNDLE="dist/${imageId}.afvmimagebundle"
HOMOLOGATION="image-source/manifests/microvm.homologation.json"
RELEASE="release/microvm-image-release.json"
if [ ! -d "$ROOT/$BUNDLE" ]; then
  printf '%s\\n' "Missing bundle directory: $BUNDLE" >&2
  exit 2
fi
if [ ! -f "$ROOT/$HOMOLOGATION" ]; then
  printf '%s\\n' "Missing homologation manifest: $HOMOLOGATION" >&2
  exit 2
fi
node "$ROOT/$BUNDLE/runner-kit/check-bundle.mjs" >/dev/null
cat > "$ROOT/$RELEASE" <<JSON
{
  "format": "agent-flow-builder.vm-microvm-image-local-release.v1",
  "recipeId": "${recipeId}",
  "imageId": "${imageId}",
  "channel": "${channel}",
  "version": "${version}",
  "bundle": "${imageId}.afvmimagebundle",
  "bundlePath": "$BUNDLE",
  "homologationManifest": "$HOMOLOGATION",
  "governance": {
    "localOnly": true,
    "requiresBundleLocalCheck": true,
    "requiresHomologationManifest": true,
    "excludesSecrets": true,
    "excludesResolvedLocalPaths": true
  }
}
JSON
printf '%s\\n' "Published local release index $RELEASE"
`;
}

function buildPublishPowerShellScript(imageId: string, recipeId: string, channel: string, version: string): string {
  return `$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Bundle = "dist\\${imageId}.afvmimagebundle"
$Homologation = "image-source\\manifests\\microvm.homologation.json"
$Release = "release\\microvm-image-release.json"
if (-not (Test-Path -LiteralPath (Join-Path $Root $Bundle) -PathType Container)) { throw "Missing bundle directory: $Bundle" }
if (-not (Test-Path -LiteralPath (Join-Path $Root $Homologation) -PathType Leaf)) { throw "Missing homologation manifest: $Homologation" }
node (Join-Path $Root "$Bundle\\runner-kit\\check-bundle.mjs") | Out-Null
$ReleaseManifest = @{
  format = "agent-flow-builder.vm-microvm-image-local-release.v1"
  recipeId = "${recipeId}"
  imageId = "${imageId}"
  channel = "${channel}"
  version = "${version}"
  bundle = "${imageId}.afvmimagebundle"
  bundlePath = "dist/${imageId}.afvmimagebundle"
  homologationManifest = "image-source/manifests/microvm.homologation.json"
  governance = @{
    localOnly = $true
    requiresBundleLocalCheck = $true
    requiresHomologationManifest = $true
    excludesSecrets = $true
    excludesResolvedLocalPaths = $true
  }
}
$ReleaseManifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $Root $Release)
Write-Output "Published local release index $Release"
`;
}

function buildReadme(imageId: string, recipeId: string): string {
  return `# Agent Flow Official Local microVM Image Recipe

Recipe ID: \`${recipeId}\`

This directory is the reproducible local publication path for an Agent Flow direct-kernel microVM image. It keeps the binary rootfs, kernel, firmware, boot evidence and registry publication outside git unless the operator explicitly decides where to store them.

## What This Recipe Produces

- \`image-source/manifests/image.manifest.json\` with size and SHA-256 for the rootfs and boot artifacts.
- \`image-source/manifests/microvm.policy.json\` with hardened policy: network \`none\`, read-only rootfs, no workspace mount, no host device passthrough and \`guest_vm\` transport assurance.
- \`image-source/manifests/microvm.homologation.json\` after real preflight and boot evidence are supplied.
- \`dist/${imageId}.afvmimagebundle\` with the image, boot artifacts, policy, guest agent and runner kit.
- \`release/microvm-image-release.json\` as the local publication index.

## Required Operator Inputs

\`\`\`bash
export AGENT_FLOW_MICROVM_ENGINE=firecracker
export AGENT_FLOW_MICROVM_ROOTFS_IMAGE=/path/to/rootfs.ext4
export AGENT_FLOW_MICROVM_KERNEL_IMAGE=/path/to/vmlinux
export AGENT_FLOW_FIRECRACKER_BINARY=/path/to/firecracker
export AGENT_FLOW_MICROVM_GUEST_TRANSPORT_COMMAND=/path/to/guest-transport
export AGENT_FLOW_REPO_ROOT=/path/to/agent-flow-studio
\`\`\`

Cloud Hypervisor can use \`AGENT_FLOW_MICROVM_FIRMWARE_IMAGE\` when the image profile supports firmware boot. Use \`AGENT_FLOW_MICROVM_SEED_IMAGE\` when the image needs seed data.

## Pipeline

1. Run \`scripts/01-build-and-preflight\` to copy operator-provided artifacts into \`image-source/images\`, write \`image.manifest.json\` and capture preflight evidence.
2. Generate real boot evidence with \`npm run test:vm-microvm-real-smoke\` in opt-in real boot mode or with an equivalent local boot probe that reaches the guest agent.
3. Put the boot evidence at \`evidence/boot.firecracker.json\` or set \`AGENT_FLOW_MICROVM_BOOT_EVIDENCE\`.
4. Run \`scripts/02-homologate-and-bundle\` to create \`.afvmhomologation.json\`, package \`.afvmimagebundle\` and run the bundle local check.
5. Run \`scripts/03-publish-local-bundle\` to write the local release index.
6. Run \`npm run vm-image:microvm-register -- --release-index <recipe>/release/microvm-image-release.json\` to generate \`release/microvm-image-release.afvmrelease.json\`, \`release/microvm-runtime-config.json\` and environment scripts consumable by the Studio/runtime.

The automated recipe gate validates the structure and the full manifest path without downloading images, booting a VM, executing user code or storing secrets.
`;
}

function buildReleaseChecklist(imageId: string, recipeId: string): string {
  return `# microVM Image Release Checklist

- [ ] Recipe ID is \`${recipeId}\`.
- [ ] \`image-source/manifests/image.manifest.json\` exists and every binary has size plus SHA-256.
- [ ] \`image-source/manifests/microvm.policy.json\` is hardened: network none, read-only rootfs, no workspace mount, no host device passthrough.
- [ ] Preflight evidence exists for the selected engine.
- [ ] Boot evidence proves real boot, guest agent contract and \`providesVmIsolation=true\`.
- [ ] \`image-source/manifests/microvm.homologation.json\` has status \`homologated\`.
- [ ] \`dist/${imageId}.afvmimagebundle/runner-kit/check-bundle.mjs\` passes.
- [ ] \`release/microvm-image-release.json\` points to the local bundle and homologation manifest.
- [ ] \`release/microvm-image-release.afvmrelease.json\` and \`release/microvm-runtime-config.json\` exist and pass the Studio VM readiness checker.
- [ ] No API key, password, private key, env value or resolved private local path was added to the recipe artifacts.
`;
}

function buildPreflightEvidenceTemplate(imageId: string): Record<string, unknown> {
  return {
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
      imageId,
      sizeBytes: 0,
      sha256: "replace-with-real-rootfs-sha256",
      sha256Verified: true,
    },
    bootArtifacts: [
      {
        id: "kernel",
        kind: "kernel",
        sizeBytes: 0,
        sha256: "replace-with-real-kernel-sha256",
      },
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
  };
}

function buildBootEvidenceTemplate(): Record<string, unknown> {
  return {
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
  };
}

function sanitizeSegment(value: string): string {
  const sanitized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!sanitized) {
    throw new Error("Identificador da receita microVM ficou vazio apos sanitizacao.");
  }
  return sanitized.slice(0, 96);
}

function sanitizeVersion(value: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9._+-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!sanitized) {
    throw new Error("Versao da receita microVM ficou vazia apos sanitizacao.");
  }
  return sanitized.slice(0, 64);
}
