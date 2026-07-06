import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface MicrovmRuntimeConfigForEnv {
  imageId: string;
  sandboxVmArgs: string[];
  sandboxVmRunnerManifest: string;
  sandboxVmImageManifest: string;
  sandboxVmImage: string;
  sandboxVmEngine: string;
  env: {
    AGENT_FLOW_MICROVM_POLICY_MANIFEST?: string;
  };
}

export interface MicrovmReleaseRegistrationOptions {
  workspaceRoot: string;
  releaseIndexPath: string;
  outPath?: string;
  recipeRoot?: string;
  createdAt?: string;
}

export interface MicrovmReleaseRegistrationResult {
  format: "agent-flow-builder.vm-microvm-release-registration-result.v1";
  status: "registered";
  outPath: string;
  imageId: string;
  engine: string;
  bundlePath: string;
  homologationStatus: string;
  bundleCheckStatus: string;
  runtimeConfigPath: string;
  shellEnvPath: string;
  powershellEnvPath: string;
}

export async function registerMicrovmImageRelease(
  options: MicrovmReleaseRegistrationOptions,
): Promise<MicrovmReleaseRegistrationResult> {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const releaseIndexPath = resolveLocalFile(options.releaseIndexPath, workspaceRoot, workspaceRoot);
  const releaseDir = path.dirname(releaseIndexPath);
  const recipeRoot = path.resolve(options.recipeRoot || path.join(releaseDir, ".."));
  const releaseIndex = normalizeReleaseIndex(await readSmallJson(releaseIndexPath));

  const bundleDir = resolveLocalDirectory(releaseIndex.bundlePath, recipeRoot, workspaceRoot, "bundle microVM");
  const bundleManifestPath = path.join(bundleDir, "bundle.json");
  const bundleManifest = normalizeBundleManifest(await readSmallJson(bundleManifestPath));
  const runnerManifestPath = path.join(bundleDir, "manifests", "runner.manifest.json");
  const imageManifestPath = path.join(bundleDir, "manifests", "image.manifest.json");
  const runnerManifest = normalizeRunnerManifest(await readSmallJson(runnerManifestPath));
  const imageManifest = normalizeImageManifest(await readSmallJson(imageManifestPath));
  const homologationPath = resolveLocalFile(releaseIndex.homologationManifest, recipeRoot, workspaceRoot);
  const homologationManifest = normalizeHomologationManifest(await readSmallJson(homologationPath));

  if (homologationManifest.status !== "homologated") {
    throw new Error("Registro de release microVM exige homologation status=homologated.");
  }
  if (releaseIndex.imageId !== imageManifest.imageId || releaseIndex.imageId !== homologationManifest.image.imageId) {
    throw new Error("Release, bundle e homologação apontam para imagens diferentes.");
  }
  if (bundleManifest.image.imageId !== imageManifest.imageId || bundleManifest.image.sha256 !== imageManifest.sha256) {
    throw new Error("Bundle manifest e image manifest divergem para a imagem microVM.");
  }
  if (!runnerManifest.engines.includes(imageManifest.engine)) {
    throw new Error(`Runner do bundle não declara suporte à engine ${imageManifest.engine}.`);
  }

  const bundleCheckPath = path.join(bundleDir, "runner-kit", "check-bundle.mjs");
  const bundleCheck = await runBundleCheck(bundleCheckPath, bundleDir);
  if (bundleCheck.status !== "ok") {
    throw new Error(`Bundle check falhou: ${bundleCheck.status}.`);
  }
  if (bundleCheck.executesUserCode !== false) {
    throw new Error("Bundle check precisa declarar executesUserCode=false.");
  }

  const outPath = path.resolve(options.outPath || path.join(releaseDir, "microvm-image-release.afvmrelease.json"));
  const outDir = path.dirname(outPath);
  const runtimeConfigPath = path.join(outDir, "microvm-runtime-config.json");
  const shellEnvPath = path.join(outDir, "use-microvm-release.sh");
  const powershellEnvPath = path.join(outDir, "use-microvm-release.ps1");
  const bundleRelative = relativePosix(recipeRoot, bundleDir);
  const releaseIndexRelative = relativePosix(recipeRoot, releaseIndexPath);
  const homologationRelative = relativePosix(recipeRoot, homologationPath);
  const registrationRelative = relativePosix(recipeRoot, outPath);
  const runnerRelative = posixJoin(bundleRelative, "runner-kit/agent-flow-vm-runner-microvm.py");
  const runnerManifestRelative = posixJoin(bundleRelative, "manifests/runner.manifest.json");
  const imageManifestRelative = posixJoin(bundleRelative, "manifests/image.manifest.json");
  const imageRelative = posixJoin(bundleRelative, normalizeManifestPath(bundleManifest.image.imagePath));
  const policyRelative = bundleManifest.image.policyManifest?.path
    ? posixJoin(bundleRelative, normalizeManifestPath(bundleManifest.image.policyManifest.path))
    : null;

  const runtimeConfig = {
    format: "agent-flow-builder.vm-microvm-runtime-config.v1",
    imageId: imageManifest.imageId,
    engine: imageManifest.engine,
    language: imageManifest.language,
    sandboxIsolation: "vm",
    sandboxVmImageId: imageManifest.imageId,
    sandboxVmRunner: "python",
    sandboxVmArgs: [runnerRelative],
    sandboxVmRunnerManifest: runnerManifestRelative,
    sandboxVmImageManifest: imageManifestRelative,
    sandboxVmImage: imageRelative,
    sandboxVmEngine: imageManifest.engine,
    sandboxVmProfile: homologationManifest.policy.profile || "hardened",
    sandboxVmMemory: "1024M",
    sandboxVmCpus: "1",
    env: {
      AGENT_FLOW_CODE_VM_RUNNER: "python",
      AGENT_FLOW_CODE_VM_ARGS: runnerRelative,
      AGENT_FLOW_CODE_VM_RUNNER_MANIFEST: runnerManifestRelative,
      AGENT_FLOW_CODE_VM_IMAGE_MANIFEST: imageManifestRelative,
      AGENT_FLOW_CODE_VM_IMAGE: imageRelative,
      AGENT_FLOW_CODE_VM_ENGINE: imageManifest.engine,
      ...(policyRelative ? { AGENT_FLOW_MICROVM_POLICY_MANIFEST: policyRelative } : {}),
    },
    envScripts: {
      shell: "release/use-microvm-release.sh",
      powershell: "release/use-microvm-release.ps1",
    },
    governance: {
      sourceFormat: "agent-flow-builder.vm-microvm-runtime-config.v1",
      excludesResolvedLocalPaths: true,
      excludesSecrets: true,
      excludesEnvValues: true,
      requiresGuestVmTransportForExecution: true,
      providesVmIsolationOnlyWithGuestTransport: true,
    },
  };

  const registrationManifest = {
    format: "agent-flow-builder.vm-microvm-image-release-registration.v1",
    createdAt,
    release: {
      recipeId: releaseIndex.recipeId,
      imageId: releaseIndex.imageId,
      channel: releaseIndex.channel,
      version: releaseIndex.version,
      releaseIndex: releaseIndexRelative,
      localOnly: releaseIndex.governance.localOnly === true,
    },
    bundle: {
      bundleId: bundleManifest.bundleId,
      path: bundleRelative,
      manifest: posixJoin(bundleRelative, "bundle.json"),
      localCheck: {
        status: bundleCheck.status,
        format: bundleCheck.format,
        executesUserCode: bundleCheck.executesUserCode,
      },
    },
    image: {
      imageId: imageManifest.imageId,
      engine: imageManifest.engine,
      language: imageManifest.language,
      imagePath: imageRelative,
      imageManifest: imageManifestRelative,
      sizeBytes: imageManifest.sizeBytes,
      sha256: imageManifest.sha256,
      bootArtifacts: imageManifest.bootArtifacts.map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        path: posixJoin(bundleRelative, normalizeManifestPath(artifact.path).replace(/^\.\.\//, "")),
        requiredForBoot: artifact.requiredForBoot === true,
        sizeBytes: artifact.sizeBytes,
        sha256: artifact.sha256,
      })),
      ...(policyRelative
        ? {
            policyManifest: {
              path: policyRelative,
              profile: homologationManifest.policy.profile,
              network: homologationManifest.policy.network,
              readOnlyRootfs: homologationManifest.policy.readOnlyRootfs,
              workspaceMount: homologationManifest.policy.workspaceMount,
              hostDevicePassthrough: homologationManifest.policy.hostDevicePassthrough,
              requireGuestTransportAssurance: homologationManifest.policy.requireGuestTransportAssurance,
            },
          }
        : {}),
    },
    runner: {
      runnerId: runnerManifest.runnerId,
      protocol: runnerManifest.protocol,
      engines: runnerManifest.engines,
      languages: runnerManifest.languages,
      runnerPath: runnerRelative,
      runnerManifest: runnerManifestRelative,
      command: "python",
      args: [runnerRelative],
    },
    homologation: {
      path: homologationRelative,
      status: homologationManifest.status,
      homologationLevel: homologationManifest.homologationLevel,
      imageSha256: homologationManifest.image.sha256,
      preflightAccepted: homologationManifest.evidence.preflight?.accepted === true,
      bootAccepted: homologationManifest.evidence.boot?.accepted === true,
      requiresGuestVmTransportForCodeExecution:
        homologationManifest.governance.requiresGuestVmTransportForCodeExecution === true,
    },
    runtimeConfig: {
      path: relativePosix(recipeRoot, runtimeConfigPath),
      nodePatch: {
        sandboxIsolation: runtimeConfig.sandboxIsolation,
        sandboxVmImageId: runtimeConfig.sandboxVmImageId,
        sandboxVmRunner: runtimeConfig.sandboxVmRunner,
        sandboxVmArgs: runtimeConfig.sandboxVmArgs,
        sandboxVmRunnerManifest: runtimeConfig.sandboxVmRunnerManifest,
        sandboxVmImageManifest: runtimeConfig.sandboxVmImageManifest,
        sandboxVmImage: runtimeConfig.sandboxVmImage,
        sandboxVmEngine: runtimeConfig.sandboxVmEngine,
        sandboxVmProfile: runtimeConfig.sandboxVmProfile,
        sandboxVmMemory: runtimeConfig.sandboxVmMemory,
        sandboxVmCpus: runtimeConfig.sandboxVmCpus,
      },
      envScripts: runtimeConfig.envScripts,
    },
    governance: {
      sourceFormat: "agent-flow-builder.vm-microvm-image-local-release.v1",
      registrationFormat: "agent-flow-builder.vm-microvm-image-release-registration.v1",
      bundleLocalCheckPassed: true,
      requiresHomologatedStatus: true,
      homologationStatus: homologationManifest.status,
      excludesResolvedLocalPaths: true,
      excludesSecrets: true,
      excludesEnvValues: true,
      executesUserCodeDuringRegistration: false,
      consumableByStudioVmReadiness: true,
      registrationPath: registrationRelative,
    },
  };

  await mkdir(outDir, { recursive: true });
  await writeJson(outPath, registrationManifest);
  await writeJson(runtimeConfigPath, runtimeConfig);
  await writeFile(shellEnvPath, buildShellEnvScript(runtimeConfig), "utf-8");
  await writeFile(powershellEnvPath, buildPowerShellEnvScript(runtimeConfig), "utf-8");

  return {
    format: "agent-flow-builder.vm-microvm-release-registration-result.v1",
    status: "registered",
    outPath,
    imageId: imageManifest.imageId,
    engine: imageManifest.engine,
    bundlePath: bundleDir,
    homologationStatus: homologationManifest.status,
    bundleCheckStatus: bundleCheck.status,
    runtimeConfigPath,
    shellEnvPath,
    powershellEnvPath,
  };
}

async function runBundleCheck(
  bundleCheckPath: string,
  bundleDir: string,
): Promise<{ format: string; status: string; executesUserCode: boolean }> {
  if (!existsSync(bundleCheckPath)) {
    throw new Error(`Check local do bundle não encontrado: ${bundleCheckPath}.`);
  }
  const output = await execFileAsync(process.execPath, [bundleCheckPath], {
    cwd: bundleDir,
    windowsHide: true,
    timeout: 30_000,
  });
  const parsed = normalizeRecord(JSON.parse(output.stdout));
  return {
    format: readString(parsed.format),
    status: readString(parsed.status),
    executesUserCode: parsed.executesUserCode === true,
  };
}

function buildShellEnvScript(runtimeConfig: MicrovmRuntimeConfigForEnv): string {
  return `#!/usr/bin/env sh
set -eu
RECIPE_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export AGENT_FLOW_CODE_VM_RUNNER="python"
export AGENT_FLOW_CODE_VM_ARGS="$RECIPE_ROOT/${escapeShellDoubleQuoted(runtimeConfig.sandboxVmArgs[0])}"
export AGENT_FLOW_CODE_VM_RUNNER_MANIFEST="$RECIPE_ROOT/${escapeShellDoubleQuoted(runtimeConfig.sandboxVmRunnerManifest)}"
export AGENT_FLOW_CODE_VM_IMAGE_MANIFEST="$RECIPE_ROOT/${escapeShellDoubleQuoted(runtimeConfig.sandboxVmImageManifest)}"
export AGENT_FLOW_CODE_VM_IMAGE="$RECIPE_ROOT/${escapeShellDoubleQuoted(runtimeConfig.sandboxVmImage)}"
export AGENT_FLOW_CODE_VM_ENGINE="${escapeShellDoubleQuoted(runtimeConfig.sandboxVmEngine)}"
${runtimeConfig.env.AGENT_FLOW_MICROVM_POLICY_MANIFEST ? `export AGENT_FLOW_MICROVM_POLICY_MANIFEST="$RECIPE_ROOT/${escapeShellDoubleQuoted(runtimeConfig.env.AGENT_FLOW_MICROVM_POLICY_MANIFEST)}"\n` : ""}printf '%s\\n' "Agent Flow registered microVM release loaded: ${escapeShellDoubleQuoted(runtimeConfig.imageId)}"
`;
}

function buildPowerShellEnvScript(runtimeConfig: MicrovmRuntimeConfigForEnv): string {
  return `$ErrorActionPreference = "Stop"
$RecipeRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$env:AGENT_FLOW_CODE_VM_RUNNER = "python"
$env:AGENT_FLOW_CODE_VM_ARGS = Join-Path $RecipeRoot "${escapePowerShellString(runtimeConfig.sandboxVmArgs[0].replace(/\//g, "\\"))}"
$env:AGENT_FLOW_CODE_VM_RUNNER_MANIFEST = Join-Path $RecipeRoot "${escapePowerShellString(runtimeConfig.sandboxVmRunnerManifest.replace(/\//g, "\\"))}"
$env:AGENT_FLOW_CODE_VM_IMAGE_MANIFEST = Join-Path $RecipeRoot "${escapePowerShellString(runtimeConfig.sandboxVmImageManifest.replace(/\//g, "\\"))}"
$env:AGENT_FLOW_CODE_VM_IMAGE = Join-Path $RecipeRoot "${escapePowerShellString(runtimeConfig.sandboxVmImage.replace(/\//g, "\\"))}"
$env:AGENT_FLOW_CODE_VM_ENGINE = "${escapePowerShellString(runtimeConfig.sandboxVmEngine)}"
${runtimeConfig.env.AGENT_FLOW_MICROVM_POLICY_MANIFEST ? `$env:AGENT_FLOW_MICROVM_POLICY_MANIFEST = Join-Path $RecipeRoot "${escapePowerShellString(runtimeConfig.env.AGENT_FLOW_MICROVM_POLICY_MANIFEST.replace(/\//g, "\\"))}"\n` : ""}Write-Output "Agent Flow registered microVM release loaded: ${escapePowerShellString(runtimeConfig.imageId)}"
`;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

async function readSmallJson(filePath: string): Promise<unknown> {
  const fileStats = await stat(filePath);
  if (!fileStats.isFile()) {
    throw new Error(`JSON esperado não é arquivo: ${filePath}`);
  }
  if (fileStats.size > 1_000_000) {
    throw new Error("JSON excede 1 MB; use manifesto declarativo pequeno.");
  }
  return JSON.parse(await readFile(filePath, "utf-8")) as unknown;
}

function normalizeReleaseIndex(value: unknown): {
  format: string;
  recipeId: string;
  imageId: string;
  channel: string;
  version: string;
  bundlePath: string;
  homologationManifest: string;
  governance: Record<string, unknown>;
} {
  const record = normalizeRecord(value);
  if (readString(record.format) !== "agent-flow-builder.vm-microvm-image-local-release.v1") {
    throw new Error("Release index microVM usa formato incompatível.");
  }
  return {
    format: readString(record.format),
    recipeId: requiredString(record.recipeId, "recipeId"),
    imageId: requiredString(record.imageId, "imageId"),
    channel: requiredString(record.channel, "channel"),
    version: requiredString(record.version, "version"),
    bundlePath: requiredString(record.bundlePath, "bundlePath"),
    homologationManifest: requiredString(record.homologationManifest, "homologationManifest"),
    governance: normalizeRecord(record.governance),
  };
}

function normalizeBundleManifest(value: unknown): {
  format: string;
  bundleId: string;
  image: {
    imageId: string;
    engine: string;
    language: string;
    imagePath: string;
    manifestPath: string;
    sizeBytes: number;
    sha256: string;
    bootArtifacts: Array<{ id: string; kind: string; path: string; requiredForBoot: boolean; sizeBytes: number; sha256: string }>;
    policyManifest?: { path: string; sizeBytes: number; sha256: string };
  };
} {
  const record = normalizeRecord(value);
  if (readString(record.format) !== "agent-flow-builder.vm-image-bundle.v1") {
    throw new Error("Bundle microVM usa formato incompatível.");
  }
  const image = normalizeRecord(record.image);
  const policyManifestRaw = isRecord(image.policyManifest) ? image.policyManifest : null;
  return {
    format: readString(record.format),
    bundleId: requiredString(record.bundleId, "bundleId"),
    image: {
      imageId: requiredString(image.imageId, "bundle.image.imageId"),
      engine: requiredString(image.engine, "bundle.image.engine"),
      language: requiredString(image.language, "bundle.image.language"),
      imagePath: requiredString(image.imagePath, "bundle.image.imagePath"),
      manifestPath: requiredString(image.manifestPath, "bundle.image.manifestPath"),
      sizeBytes: requiredPositiveNumber(image.sizeBytes, "bundle.image.sizeBytes"),
      sha256: requiredSha256(image.sha256, "bundle.image.sha256"),
      bootArtifacts: readArray(image.bootArtifacts).map((artifact, index) => {
        const item = normalizeRecord(artifact);
        return {
          id: requiredString(item.id, `bundle.image.bootArtifacts[${index}].id`),
          kind: requiredString(item.kind, `bundle.image.bootArtifacts[${index}].kind`),
          path: requiredString(item.path, `bundle.image.bootArtifacts[${index}].path`),
          requiredForBoot: item.requiredForBoot === true,
          sizeBytes: requiredPositiveNumber(item.sizeBytes, `bundle.image.bootArtifacts[${index}].sizeBytes`),
          sha256: requiredSha256(item.sha256, `bundle.image.bootArtifacts[${index}].sha256`),
        };
      }),
      ...(policyManifestRaw
        ? {
            policyManifest: {
              path: requiredString(policyManifestRaw.path, "bundle.image.policyManifest.path"),
              sizeBytes: requiredPositiveNumber(policyManifestRaw.sizeBytes, "bundle.image.policyManifest.sizeBytes"),
              sha256: requiredSha256(policyManifestRaw.sha256, "bundle.image.policyManifest.sha256"),
            },
          }
        : {}),
    },
  };
}

function normalizeRunnerManifest(value: unknown): {
  format: string;
  protocol: string;
  runnerId: string;
  engines: string[];
  languages: string[];
} {
  const record = normalizeRecord(value);
  if (readString(record.format) !== "agent-flow-builder.vm-runner-manifest.v1") {
    throw new Error("Runner manifest VM usa formato incompatível.");
  }
  if (readString(record.protocol) !== "agent-flow-vm-runner.v1") {
    throw new Error("Runner manifest VM usa protocolo incompatível.");
  }
  return {
    format: readString(record.format),
    protocol: readString(record.protocol),
    runnerId: requiredString(record.runnerId, "runnerId"),
    engines: readStringArray(record.engines),
    languages: readStringArray(record.languages),
  };
}

function normalizeImageManifest(value: unknown): {
  format: string;
  imageId: string;
  engine: string;
  language: string;
  imagePath: string;
  sizeBytes: number;
  sha256: string;
  bootArtifacts: Array<{ id: string; kind: string; path: string; requiredForBoot: boolean; sizeBytes: number; sha256: string }>;
  policyManifest?: string;
} {
  const record = normalizeRecord(value);
  if (readString(record.format) !== "agent-flow-builder.vm-image-manifest.v1") {
    throw new Error("Image manifest VM usa formato incompatível.");
  }
  return {
    format: readString(record.format),
    imageId: requiredString(record.imageId, "imageId"),
    engine: requiredString(record.engine, "engine"),
    language: requiredString(record.language, "language"),
    imagePath: requiredString(record.imagePath, "imagePath"),
    sizeBytes: requiredPositiveNumber(record.sizeBytes, "sizeBytes"),
    sha256: requiredSha256(record.sha256, "sha256"),
    bootArtifacts: readArray(record.bootArtifacts).map((artifact, index) => {
      const item = normalizeRecord(artifact);
      return {
        id: requiredString(item.id, `bootArtifacts[${index}].id`),
        kind: requiredString(item.kind, `bootArtifacts[${index}].kind`),
        path: requiredString(item.path, `bootArtifacts[${index}].path`),
        requiredForBoot: item.requiredForBoot === true,
        sizeBytes: requiredPositiveNumber(item.sizeBytes, `bootArtifacts[${index}].sizeBytes`),
        sha256: requiredSha256(item.sha256, `bootArtifacts[${index}].sha256`),
      };
    }),
    ...(readString(record.policyManifest) ? { policyManifest: readString(record.policyManifest) } : {}),
  };
}

function normalizeHomologationManifest(value: unknown): {
  format: string;
  status: string;
  homologationLevel: string;
  image: { imageId: string; sha256: string };
  policy: {
    profile: string;
    network: string;
    readOnlyRootfs: boolean;
    workspaceMount: boolean;
    hostDevicePassthrough: boolean;
    requireGuestTransportAssurance: string;
  };
  evidence: { preflight: { accepted: boolean } | null; boot: { accepted: boolean } | null };
  governance: { requiresGuestVmTransportForCodeExecution?: boolean };
} {
  const record = normalizeRecord(value);
  if (readString(record.format) !== "agent-flow-builder.vm-microvm-homologation.v1") {
    throw new Error("Manifesto de homologação microVM usa formato incompatível.");
  }
  const image = normalizeRecord(record.image);
  const policy = normalizeRecord(record.policy);
  const evidence = normalizeRecord(record.evidence);
  const preflight = isRecord(evidence.preflight) ? { accepted: evidence.preflight.accepted === true } : null;
  const boot = isRecord(evidence.boot) ? { accepted: evidence.boot.accepted === true } : null;
  return {
    format: readString(record.format),
    status: requiredString(record.status, "homologation.status"),
    homologationLevel: requiredString(record.homologationLevel, "homologation.homologationLevel"),
    image: {
      imageId: requiredString(image.imageId, "homologation.image.imageId"),
      sha256: requiredSha256(image.sha256, "homologation.image.sha256"),
    },
    policy: {
      profile: requiredString(policy.profile, "homologation.policy.profile"),
      network: requiredString(policy.network, "homologation.policy.network"),
      readOnlyRootfs: policy.readOnlyRootfs === true,
      workspaceMount: policy.workspaceMount === true,
      hostDevicePassthrough: policy.hostDevicePassthrough === true,
      requireGuestTransportAssurance: requiredString(
        policy.requireGuestTransportAssurance,
        "homologation.policy.requireGuestTransportAssurance",
      ),
    },
    evidence: { preflight, boot },
    governance: normalizeRecord(record.governance),
  };
}

function resolveLocalFile(value: string, primaryRoot: string, workspaceRoot: string): string {
  const trimmed = value.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    throw new Error(`Caminho local inválido: ${value}`);
  }
  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }
  const primary = path.resolve(primaryRoot, trimmed);
  if (existsSync(primary)) {
    return primary;
  }
  return path.resolve(workspaceRoot, trimmed);
}

function resolveLocalDirectory(value: string, primaryRoot: string, workspaceRoot: string, label: string): string {
  const resolved = resolveLocalFile(value, primaryRoot, workspaceRoot);
  if (!existsSync(resolved)) {
    throw new Error(`${label} não encontrado: ${value}`);
  }
  return resolved;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("JSON precisa ser um objeto.");
  }
  return value;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function requiredString(value: unknown, label: string): string {
  const text = readString(value);
  if (!text) {
    throw new Error(`Campo obrigatório ausente: ${label}`);
  }
  return text;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(readString).filter(Boolean) : [];
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function requiredPositiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    throw new Error(`Campo numérico positivo obrigatório ausente: ${label}`);
  }
  return value;
}

function requiredSha256(value: unknown, label: string): string {
  const text = requiredString(value, label).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(text)) {
    throw new Error(`Campo ${label} precisa ser SHA-256 hexadecimal.`);
  }
  return text;
}

function relativePosix(root: string, value: string): string {
  return normalizeManifestPath(path.relative(root, value));
}

function posixJoin(...values: string[]): string {
  return path.posix.join(...values.map(normalizeManifestPath));
}

function normalizeManifestPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function escapeShellDoubleQuoted(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`");
}

function escapePowerShellString(value: string): string {
  return value.replace(/`/g, "``").replace(/"/g, '`"');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
