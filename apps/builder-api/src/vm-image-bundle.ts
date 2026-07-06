import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface VmImageBundleOptions {
  workspaceRoot: string;
  flowRoot: string;
  runnerManifestPath: string;
  imageManifestPath: string;
  outDir: string;
  createdAt?: string;
}

export interface VmImageBundleResult {
  format: "agent-flow-builder.vm-image-bundle-result.v1";
  bundleId: string;
  outDir: string;
  imagePath: string;
  bootArtifactPaths: string[];
  policyManifestPath?: string;
  runnerManifestPath: string;
  imageManifestPath: string;
  bundleManifestPath: string;
  runnerKitDir: string;
  bundleCheckPath: string;
  powershellEnvPath: string;
  shellEnvPath: string;
  imageSha256: string;
  copiedImageSha256: string;
  copiedImageSha256Verified: boolean;
}

interface RunnerManifest {
  format: "agent-flow-builder.vm-runner-manifest.v1";
  protocol: "agent-flow-vm-runner.v1";
  runnerId: string;
  engines: string[];
  languages: string[];
  supportsNetworkNone?: boolean;
  supportsReadOnlyRootfs?: boolean;
  supportsWorkspaceMount?: boolean;
  supportsSnapshotRestore?: boolean;
}

interface ImageManifest {
  format: "agent-flow-builder.vm-image-manifest.v1";
  imageId: string;
  engine: string;
  language: string;
  imagePath: string;
  sizeBytes?: number;
  sha256?: string;
  bootArtifacts: BootArtifactManifest[];
  policyManifest?: string;
}

interface BootArtifactManifest {
  id: string;
  kind: string;
  path: string;
  requiredForBoot?: boolean;
  sizeBytes?: number;
  sha256?: string;
}

interface CopiedBootArtifact {
  id: string;
  kind: string;
  requiredForBoot: boolean;
  sourcePath: string;
  outPath: string;
  bundleRelativePath: string;
  manifestRelativePath: string;
  sizeBytes: number;
  sha256: string;
}

interface CopiedPolicyManifest {
  sourcePath: string;
  outPath: string;
  manifestRelativePath: string;
  bundleRelativePath: string;
  sizeBytes: number;
  sha256: string;
}

export async function packageVmImageBundle(options: VmImageBundleOptions): Promise<VmImageBundleResult> {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const runnerManifestFile = resolveLocalFile(options.runnerManifestPath, options.flowRoot, options.workspaceRoot);
  const imageManifestFile = resolveLocalFile(options.imageManifestPath, options.flowRoot, options.workspaceRoot);
  const runnerManifest = normalizeRunnerManifest(await readSmallJson(runnerManifestFile));
  const imageManifest = normalizeImageManifest(await readSmallJson(imageManifestFile));
  const sourceImagePath = resolveLocalFile(imageManifest.imagePath, path.dirname(imageManifestFile), options.workspaceRoot);
  const imageStats = await stat(sourceImagePath);
  if (!imageStats.isFile()) {
    throw new Error(`Imagem VM não é um arquivo: ${imageManifest.imagePath}`);
  }
  if (imageManifest.sizeBytes !== undefined && imageManifest.sizeBytes !== imageStats.size) {
    throw new Error(`Tamanho da imagem diverge do manifesto: esperado ${imageManifest.sizeBytes}, encontrado ${imageStats.size}.`);
  }
  if (runnerManifest.engines.length && !runnerManifest.engines.includes(imageManifest.engine)) {
    throw new Error(`Runner ${runnerManifest.runnerId} não declara suporte à engine ${imageManifest.engine}.`);
  }

  const sourceSha256 = await sha256File(sourceImagePath);
  if (imageManifest.sha256 && imageManifest.sha256 !== sourceSha256) {
    throw new Error(`SHA-256 da imagem diverge do manifesto: esperado ${imageManifest.sha256}, encontrado ${sourceSha256}.`);
  }

  const bundleId = sanitizeSegment(imageManifest.imageId || path.basename(sourceImagePath, path.extname(sourceImagePath)));
  const outDir = path.resolve(options.outDir);
  const imageFileName = `${bundleId}${path.extname(sourceImagePath) || ".img"}`;
  const bundleImageRelativePath = path.posix.join("images", imageFileName);
  const imageManifestRelativePath = path.posix.join("..", "images", imageFileName);
  const imageOutPath = path.join(outDir, "images", imageFileName);
  const manifestsDir = path.join(outDir, "manifests");
  const runnerKitDir = path.join(outDir, "runner-kit");
  const runnerManifestOutPath = path.join(manifestsDir, "runner.manifest.json");
  const imageManifestOutPath = path.join(manifestsDir, "image.manifest.json");
  const bundleManifestPath = path.join(outDir, "bundle.json");
  const policyManifestOutPath = path.join(manifestsDir, "microvm.policy.json");
  const bundleCheckPath = path.join(runnerKitDir, "check-bundle.mjs");
  const referenceRunnerPath = path.join(runnerKitDir, "agent-flow-vm-runner-reference.py");
  const qemuRunnerPath = path.join(runnerKitDir, "agent-flow-vm-runner-qemu.py");
  const microvmRunnerPath = path.join(runnerKitDir, "agent-flow-vm-runner-microvm.py");
  const guestAgentPath = path.join(runnerKitDir, "agent-flow-vm-guest-agent.py");
  const powershellEnvPath = path.join(runnerKitDir, "use-bundle.ps1");
  const shellEnvPath = path.join(runnerKitDir, "use-bundle.sh");
  const powershellReferenceEnvPath = path.join(runnerKitDir, "use-reference-runner.ps1");
  const shellReferenceEnvPath = path.join(runnerKitDir, "use-reference-runner.sh");
  const powershellQemuEnvPath = path.join(runnerKitDir, "use-qemu-runner.ps1");
  const shellQemuEnvPath = path.join(runnerKitDir, "use-qemu-runner.sh");
  const powershellMicrovmEnvPath = path.join(runnerKitDir, "use-microvm-runner.ps1");
  const shellMicrovmEnvPath = path.join(runnerKitDir, "use-microvm-runner.sh");

  await mkdir(path.dirname(imageOutPath), { recursive: true });
  await mkdir(manifestsDir, { recursive: true });
  await mkdir(runnerKitDir, { recursive: true });
  await copyFile(sourceImagePath, imageOutPath);
  const copiedSha256 = await sha256File(imageOutPath);
  const copiedImageSha256Verified = copiedSha256 === sourceSha256;
  if (!copiedImageSha256Verified) {
    throw new Error("SHA-256 da imagem copiada diverge da imagem de origem.");
  }

  const copiedBootArtifacts: CopiedBootArtifact[] = [];
  for (const artifact of imageManifest.bootArtifacts) {
    const sourceArtifactPath = resolveLocalFile(artifact.path, path.dirname(imageManifestFile), options.workspaceRoot);
    const artifactStats = await stat(sourceArtifactPath);
    if (!artifactStats.isFile()) {
      throw new Error(`Artefato de boot VM não é um arquivo: ${artifact.path}`);
    }
    if (artifact.sizeBytes !== undefined && artifact.sizeBytes !== artifactStats.size) {
      throw new Error(`Tamanho do artefato de boot ${artifact.id} diverge do manifesto: esperado ${artifact.sizeBytes}, encontrado ${artifactStats.size}.`);
    }
    const artifactSha256 = await sha256File(sourceArtifactPath);
    if (artifact.sha256 && artifact.sha256 !== artifactSha256) {
      throw new Error(`SHA-256 do artefato de boot ${artifact.id} diverge do manifesto: esperado ${artifact.sha256}, encontrado ${artifactSha256}.`);
    }
    const artifactFileName = `${bundleId}-${sanitizeSegment(artifact.id)}${path.extname(sourceArtifactPath) || ".bin"}`;
    const bundleRelativePath = path.posix.join("images", artifactFileName);
    const manifestRelativePath = path.posix.join("..", "images", artifactFileName);
    const artifactOutPath = path.join(outDir, "images", artifactFileName);
    await copyFile(sourceArtifactPath, artifactOutPath);
    const copiedArtifactSha256 = await sha256File(artifactOutPath);
    if (copiedArtifactSha256 !== artifactSha256) {
      throw new Error(`SHA-256 do artefato de boot copiado ${artifact.id} diverge da origem.`);
    }
    copiedBootArtifacts.push({
      id: artifact.id,
      kind: artifact.kind,
      requiredForBoot: artifact.requiredForBoot === true,
      sourcePath: sourceArtifactPath,
      outPath: artifactOutPath,
      bundleRelativePath,
      manifestRelativePath,
      sizeBytes: artifactStats.size,
      sha256: artifactSha256,
    });
  }

  let copiedPolicyManifest: CopiedPolicyManifest | null = null;
  if (imageManifest.policyManifest) {
    const sourcePolicyManifestPath = resolveLocalFile(imageManifest.policyManifest, path.dirname(imageManifestFile), options.workspaceRoot);
    const policyStats = await stat(sourcePolicyManifestPath);
    if (!policyStats.isFile()) {
      throw new Error(`Manifesto de política VM não é um arquivo: ${imageManifest.policyManifest}`);
    }
    const policyManifestJson = await readSmallJson(sourcePolicyManifestPath);
    if (!isRecord(policyManifestJson) || readString(policyManifestJson.format) !== "agent-flow-builder.vm-policy-manifest.v1") {
      throw new Error("Manifesto de política VM usa formato incompatível.");
    }
    const policySha256 = await sha256File(sourcePolicyManifestPath);
    await copyFile(sourcePolicyManifestPath, policyManifestOutPath);
    const copiedPolicySha256 = await sha256File(policyManifestOutPath);
    if (copiedPolicySha256 !== policySha256) {
      throw new Error("SHA-256 do manifesto de política VM copiado diverge da origem.");
    }
    copiedPolicyManifest = {
      sourcePath: sourcePolicyManifestPath,
      outPath: policyManifestOutPath,
      manifestRelativePath: "microvm.policy.json",
      bundleRelativePath: "manifests/microvm.policy.json",
      sizeBytes: policyStats.size,
      sha256: policySha256,
    };
  }

  const sanitizedRunnerManifest = {
    format: runnerManifest.format,
    protocol: runnerManifest.protocol,
    runnerId: runnerManifest.runnerId,
    engines: runnerManifest.engines,
    languages: runnerManifest.languages,
    supportsNetworkNone: runnerManifest.supportsNetworkNone === true,
    supportsReadOnlyRootfs: runnerManifest.supportsReadOnlyRootfs === true,
    supportsWorkspaceMount: runnerManifest.supportsWorkspaceMount === true,
    supportsSnapshotRestore: runnerManifest.supportsSnapshotRestore === true,
  };
  const sanitizedImageManifest = {
    format: imageManifest.format,
    imageId: imageManifest.imageId,
    engine: imageManifest.engine,
    language: imageManifest.language,
    imagePath: imageManifestRelativePath,
    sizeBytes: imageStats.size,
    sha256: sourceSha256,
    ...(copiedPolicyManifest ? { policyManifest: copiedPolicyManifest.manifestRelativePath } : {}),
    bootArtifacts: copiedBootArtifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      path: artifact.manifestRelativePath,
      requiredForBoot: artifact.requiredForBoot,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256,
    })),
  };
  const bundleManifest = {
    format: "agent-flow-builder.vm-image-bundle.v1",
    bundleId,
    createdAt,
    runner: {
      runnerId: sanitizedRunnerManifest.runnerId,
      protocol: sanitizedRunnerManifest.protocol,
      engines: sanitizedRunnerManifest.engines,
      languages: sanitizedRunnerManifest.languages,
      manifestPath: "manifests/runner.manifest.json",
    },
    image: {
      imageId: sanitizedImageManifest.imageId,
      engine: sanitizedImageManifest.engine,
      language: sanitizedImageManifest.language,
      imagePath: bundleImageRelativePath,
      manifestPath: "manifests/image.manifest.json",
      sizeBytes: sanitizedImageManifest.sizeBytes,
      sha256: sanitizedImageManifest.sha256,
      bootArtifacts: copiedBootArtifacts.map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        path: artifact.bundleRelativePath,
        requiredForBoot: artifact.requiredForBoot,
        sizeBytes: artifact.sizeBytes,
        sha256: artifact.sha256,
      })),
      ...(copiedPolicyManifest
        ? {
            policyManifest: {
              path: copiedPolicyManifest.bundleRelativePath,
              sizeBytes: copiedPolicyManifest.sizeBytes,
              sha256: copiedPolicyManifest.sha256,
            },
          }
        : {}),
    },
    runnerKit: {
      format: "agent-flow-builder.vm-runner-kit.v1",
      directory: "runner-kit",
      localCheck: "runner-kit/check-bundle.mjs",
      referenceRunner: "runner-kit/agent-flow-vm-runner-reference.py",
      qemuRunner: "runner-kit/agent-flow-vm-runner-qemu.py",
      microvmRunner: "runner-kit/agent-flow-vm-runner-microvm.py",
      guestAgent: "runner-kit/agent-flow-vm-guest-agent.py",
      guestAgentProtocol: "agent-flow-vm-guest-agent.v1",
      powershellEnv: "runner-kit/use-bundle.ps1",
      shellEnv: "runner-kit/use-bundle.sh",
      powershellReferenceEnv: "runner-kit/use-reference-runner.ps1",
      shellReferenceEnv: "runner-kit/use-reference-runner.sh",
      powershellQemuEnv: "runner-kit/use-qemu-runner.ps1",
      shellQemuEnv: "runner-kit/use-qemu-runner.sh",
      powershellMicrovmEnv: "runner-kit/use-microvm-runner.ps1",
      shellMicrovmEnv: "runner-kit/use-microvm-runner.sh",
      requiresExternalRunnerBinary: true,
      referenceRunnerProvidesVmIsolation: false,
      qemuRunnerProvidesVmIsolation: true,
      qemuRunnerRequiresGuestAgent: true,
      qemuRunnerContractExecutionImplemented: false,
      qemuRunnerSupportsExternalGuestTransport: true,
      microvmRunnerProvidesVmIsolation: true,
      microvmRunnerRequiresGuestAgent: true,
      microvmRunnerContractExecutionImplemented: false,
      microvmRunnerSupportsFirecracker: true,
      microvmRunnerSupportsCloudHypervisor: true,
      microvmRunnerSupportsExternalGuestTransport: true,
      defaultRunnerCommand: "agent-flow-vm-runner",
    },
    governance: {
      sourceFormat: "agent-flow-builder.vm-image-manifest.v1",
      packagerFormat: "agent-flow-builder.vm-image-bundle-packager.v1",
      excludesSourceLocalPaths: true,
      excludesRunnerBinary: true,
      excludesUserCode: true,
      includesPortableRunnerKit: true,
      includesReferenceContractRunner: true,
      includesQemuPreflightRunner: true,
      includesMicrovmPreflightRunner: true,
      includesGuestAgent: true,
      referenceRunnerProvidesVmIsolation: false,
      qemuRunnerProvidesVmIsolation: true,
      qemuRunnerRequiresGuestAgent: true,
      qemuRunnerContractExecutionImplemented: false,
      qemuRunnerSupportsExternalGuestTransport: true,
      microvmRunnerProvidesVmIsolation: true,
      microvmRunnerRequiresGuestAgent: true,
      microvmRunnerContractExecutionImplemented: false,
      microvmRunnerSupportsFirecracker: true,
      microvmRunnerSupportsCloudHypervisor: true,
      microvmRunnerSupportsExternalGuestTransport: true,
      copiedImageSha256Verified,
      copiedBootArtifactsSha256Verified: copiedBootArtifacts.every((artifact) => Boolean(artifact.sha256)),
      includesBootArtifacts: copiedBootArtifacts.length > 0,
      includesPolicyManifest: copiedPolicyManifest !== null,
      copiedPolicyManifestSha256Verified: copiedPolicyManifest !== null,
    },
  };

  await writeJson(runnerManifestOutPath, sanitizedRunnerManifest);
  await writeJson(imageManifestOutPath, sanitizedImageManifest);
  await writeJson(bundleManifestPath, bundleManifest);
  await writeFile(bundleCheckPath, buildBundleCheckScript(), "utf-8");
  await copyFile(referenceRunnerSourcePath(), referenceRunnerPath);
  await copyFile(qemuRunnerSourcePath(), qemuRunnerPath);
  await copyFile(microvmRunnerSourcePath(), microvmRunnerPath);
  await copyFile(guestAgentSourcePath(), guestAgentPath);
  await writeFile(
    powershellEnvPath,
    buildPowerShellEnvScript(bundleImageRelativePath, imageManifest.engine, copiedBootArtifacts, copiedPolicyManifest),
    "utf-8",
  );
  await writeFile(shellEnvPath, buildShellEnvScript(bundleImageRelativePath, imageManifest.engine, copiedBootArtifacts, copiedPolicyManifest), "utf-8");
  await writeFile(powershellReferenceEnvPath, buildPowerShellReferenceRunnerScript(), "utf-8");
  await writeFile(shellReferenceEnvPath, buildShellReferenceRunnerScript(), "utf-8");
  await writeFile(powershellQemuEnvPath, buildPowerShellQemuRunnerScript(), "utf-8");
  await writeFile(shellQemuEnvPath, buildShellQemuRunnerScript(), "utf-8");
  await writeFile(powershellMicrovmEnvPath, buildPowerShellMicrovmRunnerScript(), "utf-8");
  await writeFile(shellMicrovmEnvPath, buildShellMicrovmRunnerScript(), "utf-8");
  await writeFile(
    path.join(runnerKitDir, "README.md"),
    buildRunnerKitReadme({
      bundleId,
      imageId: imageManifest.imageId,
      engine: imageManifest.engine,
      language: imageManifest.language,
      sha256: sourceSha256,
    }),
    "utf-8",
  );

  return {
    format: "agent-flow-builder.vm-image-bundle-result.v1",
    bundleId,
    outDir,
    imagePath: imageOutPath,
    bootArtifactPaths: copiedBootArtifacts.map((artifact) => artifact.outPath),
    ...(copiedPolicyManifest ? { policyManifestPath: copiedPolicyManifest.outPath } : {}),
    runnerManifestPath: runnerManifestOutPath,
    imageManifestPath: imageManifestOutPath,
    bundleManifestPath,
    runnerKitDir,
    bundleCheckPath,
    powershellEnvPath,
    shellEnvPath,
    imageSha256: sourceSha256,
    copiedImageSha256: copiedSha256,
    copiedImageSha256Verified,
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

async function readSmallJson(filePath: string): Promise<unknown> {
  const fileStats = await stat(filePath);
  if (!fileStats.isFile()) {
    throw new Error(`Manifesto não é um arquivo: ${filePath}`);
  }
  if (fileStats.size > 1_000_000) {
    throw new Error("Manifesto excede 1 MB; use um JSON declarativo pequeno.");
  }
  return JSON.parse(await readFile(filePath, "utf-8")) as unknown;
}

function normalizeRunnerManifest(value: unknown): RunnerManifest {
  if (!isRecord(value)) {
    throw new Error("Manifesto do runner precisa ser um objeto JSON.");
  }
  const format = readString(value.format);
  const protocol = readString(value.protocol);
  if (format !== "agent-flow-builder.vm-runner-manifest.v1" || protocol !== "agent-flow-vm-runner.v1") {
    throw new Error("Manifesto do runner usa formato/protocolo incompatível.");
  }
  const runnerId = readString(value.runnerId);
  if (!runnerId) {
    throw new Error("Manifesto do runner precisa declarar runnerId.");
  }
  return {
    format,
    protocol,
    runnerId,
    engines: readStringArray(value.engines),
    languages: readStringArray(value.languages),
    supportsNetworkNone: value.supportsNetworkNone === true,
    supportsReadOnlyRootfs: value.supportsReadOnlyRootfs === true,
    supportsWorkspaceMount: value.supportsWorkspaceMount === true,
    supportsSnapshotRestore: value.supportsSnapshotRestore === true,
  };
}

function normalizeImageManifest(value: unknown): ImageManifest {
  if (!isRecord(value)) {
    throw new Error("Manifesto da imagem precisa ser um objeto JSON.");
  }
  const format = readString(value.format);
  if (format !== "agent-flow-builder.vm-image-manifest.v1") {
    throw new Error("Manifesto da imagem usa formato incompatível.");
  }
  const imageId = readString(value.imageId);
  const engine = readString(value.engine).toLowerCase();
  const language = readString(value.language).toLowerCase();
  const imagePath = readString(value.imagePath);
  if (!imageId || !engine || !language || !imagePath) {
    throw new Error("Manifesto da imagem precisa declarar imageId, engine, language e imagePath.");
  }
  const sha256 = readString(value.sha256).toLowerCase();
  if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error("sha256 do manifesto da imagem deve conter 64 caracteres hexadecimais.");
  }
  const sizeBytes = typeof value.sizeBytes === "number" && Number.isInteger(value.sizeBytes) && value.sizeBytes > 0 ? value.sizeBytes : undefined;
  const policyManifest = readString(value.policyManifest);
  return {
    format,
    imageId,
    engine,
    language,
    imagePath,
    ...(sizeBytes ? { sizeBytes } : {}),
    ...(sha256 ? { sha256 } : {}),
    ...(policyManifest ? { policyManifest } : {}),
    bootArtifacts: normalizeBootArtifacts(value.bootArtifacts),
  };
}

function normalizeBootArtifacts(value: unknown): BootArtifactManifest[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("bootArtifacts do manifesto da imagem precisa ser uma lista.");
  }
  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`bootArtifacts[${index}] precisa ser um objeto JSON.`);
    }
    const id = sanitizeSegment(readString(item.id) || `boot-artifact-${index + 1}`);
    const kind = readString(item.kind).toLowerCase() || "auxiliary";
    const artifactPath = readString(item.path);
    if (!artifactPath) {
      throw new Error(`bootArtifacts[${index}] precisa declarar path.`);
    }
    const sha256 = readString(item.sha256).toLowerCase();
    if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) {
      throw new Error(`sha256 de bootArtifacts[${index}] deve conter 64 caracteres hexadecimais.`);
    }
    const sizeBytes = typeof item.sizeBytes === "number" && Number.isInteger(item.sizeBytes) && item.sizeBytes > 0 ? item.sizeBytes : undefined;
    return {
      id,
      kind,
      path: artifactPath,
      requiredForBoot: item.requiredForBoot === true,
      ...(sizeBytes ? { sizeBytes } : {}),
      ...(sha256 ? { sha256 } : {}),
    };
  });
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function buildBundleCheckScript(): string {
  return `import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const runnerKitDir = path.dirname(fileURLToPath(import.meta.url));
const bundleRoot = path.resolve(runnerKitDir, "..");
const bundle = JSON.parse(await readFile(path.join(bundleRoot, "bundle.json"), "utf-8"));
const imageManifest = JSON.parse(await readFile(path.join(bundleRoot, bundle.image.manifestPath), "utf-8"));
const runnerManifest = JSON.parse(await readFile(path.join(bundleRoot, bundle.runner.manifestPath), "utf-8"));
const imagePath = resolveInsideBundle(bundleRoot, bundle.image.imagePath);
const imageStats = await stat(imagePath);
const imageSha256 = await sha256File(imagePath);

if (bundle.format !== "agent-flow-builder.vm-image-bundle.v1") {
  throw new Error("Formato do bundle VM invalido.");
}
if (runnerManifest.protocol !== "agent-flow-vm-runner.v1") {
  throw new Error("Manifesto do runner nao declara agent-flow-vm-runner.v1.");
}
if (imageManifest.sha256 !== imageSha256 || bundle.image.sha256 !== imageSha256) {
  throw new Error("SHA-256 da imagem nao confere com os manifestos do bundle.");
}
if (imageManifest.sizeBytes !== imageStats.size || bundle.image.sizeBytes !== imageStats.size) {
  throw new Error("Tamanho da imagem nao confere com os manifestos do bundle.");
}
const bootArtifacts = Array.isArray(bundle.image.bootArtifacts) ? bundle.image.bootArtifacts : [];
for (const artifact of bootArtifacts) {
  const artifactPath = resolveInsideBundle(bundleRoot, artifact.path);
  const artifactStats = await stat(artifactPath);
  const artifactSha256 = await sha256File(artifactPath);
  if (artifact.sizeBytes !== artifactStats.size || artifact.sha256 !== artifactSha256) {
    throw new Error("Artefato de boot VM nao confere com o manifesto do bundle: " + artifact.id);
  }
  const matchingManifestArtifact = Array.isArray(imageManifest.bootArtifacts)
    ? imageManifest.bootArtifacts.find((item) => item.id === artifact.id)
    : undefined;
  if (!matchingManifestArtifact || matchingManifestArtifact.sha256 !== artifactSha256 || matchingManifestArtifact.sizeBytes !== artifactStats.size) {
    throw new Error("Artefato de boot VM nao confere com o manifesto da imagem: " + artifact.id);
  }
}
let policyManifestStatus = "not-declared";
const bundledPolicyManifest = bundle.image && bundle.image.policyManifest ? bundle.image.policyManifest : null;
if (bundledPolicyManifest) {
  if (!imageManifest.policyManifest) {
    throw new Error("Bundle declara manifesto de politica VM, mas manifesto da imagem nao referencia a politica.");
  }
  const policyManifestPath = resolveInsideBundle(bundleRoot, bundledPolicyManifest.path);
  const imageManifestPolicyPath = resolveInsideBundle(path.dirname(path.join(bundleRoot, bundle.image.manifestPath)), imageManifest.policyManifest);
  if (path.normalize(policyManifestPath) !== path.normalize(imageManifestPolicyPath)) {
    throw new Error("Manifesto de politica VM diverge entre bundle e manifesto da imagem.");
  }
  const policyManifestStats = await stat(policyManifestPath);
  const policyManifestSha256 = await sha256File(policyManifestPath);
  if (bundledPolicyManifest.sizeBytes !== policyManifestStats.size || bundledPolicyManifest.sha256 !== policyManifestSha256) {
    throw new Error("Manifesto de politica VM nao confere com o manifesto do bundle.");
  }
  const policyManifestJson = JSON.parse(await readFile(policyManifestPath, "utf-8"));
  if (policyManifestJson.format !== "agent-flow-builder.vm-policy-manifest.v1") {
    throw new Error("Manifesto de politica VM usa formato incompativel.");
  }
  policyManifestStatus = "ok";
}

console.log(JSON.stringify({
  status: "ok",
  format: "agent-flow-builder.vm-image-bundle-local-check.v1",
  bundleId: bundle.bundleId,
  runnerId: runnerManifest.runnerId,
  imageId: imageManifest.imageId,
  engine: imageManifest.engine,
  language: imageManifest.language,
  imageSha256,
  imageSizeBytes: imageStats.size,
  bootArtifactCount: bootArtifacts.length,
  policyManifest: policyManifestStatus,
  executesUserCode: false
}, null, 2));

function resolveInsideBundle(root, value) {
  const resolved = path.resolve(root, value);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Caminho fora do bundle: " + value);
  }
  return resolved;
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}
`;
}

function buildPowerShellEnvScript(
  bundleImageRelativePath: string,
  engine: string,
  bootArtifacts: CopiedBootArtifact[],
  policyManifest: CopiedPolicyManifest | null,
): string {
  const imagePath = bundleImageRelativePath.replace(/\//g, "\\");
  const seedArtifact = bootArtifacts.find((artifact) => artifact.kind === "cloud-init-seed");
  const seedLines = seedArtifact
    ? `$env:AGENT_FLOW_CODE_VM_SEED_IMAGE = Join-Path $BundleRoot "${seedArtifact.bundleRelativePath.replace(/\//g, "\\")}"\n`
    : "";
  const policyLines = policyManifest
    ? `$env:AGENT_FLOW_MICROVM_POLICY_MANIFEST = Join-Path $BundleRoot "${policyManifest.bundleRelativePath.replace(/\//g, "\\")}"\n`
    : "";
  const bootArtifactsJson = JSON.stringify(
    bootArtifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      path: artifact.bundleRelativePath,
      requiredForBoot: artifact.requiredForBoot,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256,
    })),
  );
  return `$ErrorActionPreference = "Stop"
$BundleRoot = Split-Path -Parent $PSScriptRoot
$env:AGENT_FLOW_CODE_VM_RUNNER_MANIFEST = Join-Path $BundleRoot "manifests\\runner.manifest.json"
$env:AGENT_FLOW_CODE_VM_IMAGE_MANIFEST = Join-Path $BundleRoot "manifests\\image.manifest.json"
$env:AGENT_FLOW_CODE_VM_IMAGE = Join-Path $BundleRoot "${imagePath}"
$env:AGENT_FLOW_CODE_VM_BOOT_ARTIFACTS = '${bootArtifactsJson.replace(/'/g, "''")}'
${seedLines}${policyLines}$env:AGENT_FLOW_CODE_VM_ENGINE = "${escapePowerShellString(engine)}"
if (-not $env:AGENT_FLOW_CODE_VM_RUNNER) {
  $env:AGENT_FLOW_CODE_VM_RUNNER = "agent-flow-vm-runner"
}
Write-Output "Agent Flow VM bundle loaded. Runner: $env:AGENT_FLOW_CODE_VM_RUNNER"
Write-Output "Validate first with: node .\\runner-kit\\check-bundle.mjs"
`;
}

function buildShellEnvScript(
  bundleImageRelativePath: string,
  engine: string,
  bootArtifacts: CopiedBootArtifact[],
  policyManifest: CopiedPolicyManifest | null,
): string {
  const seedArtifact = bootArtifacts.find((artifact) => artifact.kind === "cloud-init-seed");
  const seedLine = seedArtifact
    ? `export AGENT_FLOW_CODE_VM_SEED_IMAGE="$BUNDLE_ROOT/${escapeShellDoubleQuoted(seedArtifact.bundleRelativePath)}"\n`
    : "";
  const policyLine = policyManifest
    ? `export AGENT_FLOW_MICROVM_POLICY_MANIFEST="$BUNDLE_ROOT/${escapeShellDoubleQuoted(policyManifest.bundleRelativePath)}"\n`
    : "";
  const bootArtifactsJson = JSON.stringify(
    bootArtifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      path: artifact.bundleRelativePath,
      requiredForBoot: artifact.requiredForBoot,
      sizeBytes: artifact.sizeBytes,
      sha256: artifact.sha256,
    })),
  );
  return `#!/usr/bin/env sh
set -eu
BUNDLE_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export AGENT_FLOW_CODE_VM_RUNNER_MANIFEST="$BUNDLE_ROOT/manifests/runner.manifest.json"
export AGENT_FLOW_CODE_VM_IMAGE_MANIFEST="$BUNDLE_ROOT/manifests/image.manifest.json"
export AGENT_FLOW_CODE_VM_IMAGE="$BUNDLE_ROOT/${escapeShellDoubleQuoted(bundleImageRelativePath)}"
export AGENT_FLOW_CODE_VM_BOOT_ARTIFACTS="${escapeShellDoubleQuoted(bootArtifactsJson)}"
${seedLine}${policyLine}export AGENT_FLOW_CODE_VM_ENGINE="${escapeShellDoubleQuoted(engine)}"
if [ -z "\${AGENT_FLOW_CODE_VM_RUNNER:-}" ]; then
  export AGENT_FLOW_CODE_VM_RUNNER="agent-flow-vm-runner"
fi
printf '%s\\n' "Agent Flow VM bundle loaded. Runner: $AGENT_FLOW_CODE_VM_RUNNER"
printf '%s\\n' "Validate first with: node ./runner-kit/check-bundle.mjs"
`;
}

function buildPowerShellReferenceRunnerScript(): string {
  return `$ErrorActionPreference = "Stop"
. "$PSScriptRoot\\use-bundle.ps1"
$env:AGENT_FLOW_CODE_VM_RUNNER = "python"
$env:AGENT_FLOW_CODE_VM_ARGS = Join-Path $PSScriptRoot "agent-flow-vm-runner-reference.py"
Write-Output "Reference VM contract runner enabled. This runner does not provide VM isolation."
`;
}

function buildShellReferenceRunnerScript(): string {
  return `#!/usr/bin/env sh
set -eu
. "$(dirname -- "$0")/use-bundle.sh"
export AGENT_FLOW_CODE_VM_RUNNER="python"
export AGENT_FLOW_CODE_VM_ARGS="$BUNDLE_ROOT/runner-kit/agent-flow-vm-runner-reference.py"
printf '%s\\n' "Reference VM contract runner enabled. This runner does not provide VM isolation."
`;
}

function buildPowerShellQemuRunnerScript(): string {
  return `$ErrorActionPreference = "Stop"
. "$PSScriptRoot\\use-bundle.ps1"
$env:AGENT_FLOW_CODE_VM_RUNNER = "python"
$env:AGENT_FLOW_CODE_VM_ARGS = Join-Path $PSScriptRoot "agent-flow-vm-runner-qemu.py"
Write-Output "QEMU VM runner selected. Run preflight before execution:"
Write-Output "python .\\runner-kit\\agent-flow-vm-runner-qemu.py --preflight"
`;
}

function buildShellQemuRunnerScript(): string {
  return `#!/usr/bin/env sh
set -eu
. "$(dirname -- "$0")/use-bundle.sh"
export AGENT_FLOW_CODE_VM_RUNNER="python"
export AGENT_FLOW_CODE_VM_ARGS="$BUNDLE_ROOT/runner-kit/agent-flow-vm-runner-qemu.py"
printf '%s\\n' "QEMU VM runner selected. Run preflight before execution:"
printf '%s\\n' "python ./runner-kit/agent-flow-vm-runner-qemu.py --preflight"
`;
}

function buildPowerShellMicrovmRunnerScript(): string {
  return `$ErrorActionPreference = "Stop"
. "$PSScriptRoot\\use-bundle.ps1"
$env:AGENT_FLOW_CODE_VM_RUNNER = "python"
$env:AGENT_FLOW_CODE_VM_ARGS = Join-Path $PSScriptRoot "agent-flow-vm-runner-microvm.py"
Write-Output "Firecracker/Cloud Hypervisor VM runner selected. Run preflight before execution:"
Write-Output "python .\\runner-kit\\agent-flow-vm-runner-microvm.py --preflight"
`;
}

function buildShellMicrovmRunnerScript(): string {
  return `#!/usr/bin/env sh
set -eu
. "$(dirname -- "$0")/use-bundle.sh"
export AGENT_FLOW_CODE_VM_RUNNER="python"
export AGENT_FLOW_CODE_VM_ARGS="$BUNDLE_ROOT/runner-kit/agent-flow-vm-runner-microvm.py"
printf '%s\\n' "Firecracker/Cloud Hypervisor VM runner selected. Run preflight before execution:"
printf '%s\\n' "python ./runner-kit/agent-flow-vm-runner-microvm.py --preflight"
`;
}

function buildRunnerKitReadme(details: {
  bundleId: string;
  imageId: string;
  engine: string;
  language: string;
  sha256: string;
}): string {
  return `# Agent Flow VM Runner Kit

This directory makes the VM image bundle portable and self-checking.

- Bundle: \`${details.bundleId}\`
- Image: \`${details.imageId}\`
- Engine: \`${details.engine}\`
- Language: \`${details.language}\`
- SHA-256: \`${details.sha256}\`

## Validate The Bundle

\`\`\`bash
node runner-kit/check-bundle.mjs
\`\`\`

The check verifies the bundle manifest, runner manifest, image manifest, image size, image SHA-256, declared boot artifacts such as \`seed.iso\` and the VM policy manifest when present. It does not execute user code.

## Load Runtime Variables

PowerShell:

\`\`\`powershell
. .\\runner-kit\\use-bundle.ps1
\`\`\`

sh/bash:

\`\`\`bash
. ./runner-kit/use-bundle.sh
\`\`\`

The scripts set \`AGENT_FLOW_CODE_VM_RUNNER_MANIFEST\`, \`AGENT_FLOW_CODE_VM_IMAGE_MANIFEST\`, \`AGENT_FLOW_CODE_VM_IMAGE\`, \`AGENT_FLOW_CODE_VM_BOOT_ARTIFACTS\`, \`AGENT_FLOW_CODE_VM_SEED_IMAGE\` when available, \`AGENT_FLOW_MICROVM_POLICY_MANIFEST\` when the image declares a VM policy and \`AGENT_FLOW_CODE_VM_ENGINE\` relative to the bundle location.

The actual VM runner binary is still external. Put a compatible \`agent-flow-vm-runner\` on PATH or set \`AGENT_FLOW_CODE_VM_RUNNER\` before loading this bundle.

For local contract testing only, this bundle also includes \`agent-flow-vm-runner-reference.py\`. It executes Python code in the local process boundary and does not provide VM isolation.

PowerShell opt-in:

\`\`\`powershell
. .\\runner-kit\\use-reference-runner.ps1
\`\`\`

sh/bash opt-in:

\`\`\`bash
. ./runner-kit/use-reference-runner.sh
\`\`\`

For QEMU/microVM preflight, this bundle includes \`agent-flow-vm-runner-qemu.py\`. It validates QEMU binary discovery, image manifest, image hash and launch plan without executing user code. Contract execution inside the guest still requires a VM image that embeds the guest agent and a host/guest transport that calls it.

For Firecracker or Cloud Hypervisor direct-kernel preflight, this bundle includes \`agent-flow-vm-runner-microvm.py\`. It validates the selected binary, root image, kernel or firmware artifact, optional initrd/cloud-init seed artifact and launch plan without executing user code. Use image manifest \`bootArtifacts\` with kinds such as \`kernel\`, \`firmware\`, \`initrd\` and \`cloud-init-seed\`.

When the image manifest declares \`policyManifest\`, the bundle carries that file under \`manifests/microvm.policy.json\`, verifies its SHA-256 in the local check and exports \`AGENT_FLOW_MICROVM_POLICY_MANIFEST\` so the microVM runner can enforce network, read-only rootfs, mount and transport-assurance rules.

The guest-side executor template is included as \`agent-flow-vm-guest-agent.py\`. Bake this file into the VM image and wire your QEMU/Firecracker/Cloud Hypervisor transport to pass the \`agent-flow-vm-runner.v1\` JSON request to it over stdin and read JSON from stdout. The file itself does not boot a VM; it is the in-guest component required for real isolated execution.

When you have a transport command, configure:

\`\`\`bash
export AGENT_FLOW_QEMU_GUEST_TRANSPORT_COMMAND="your-vsock-or-ssh-client"
export AGENT_FLOW_QEMU_GUEST_TRANSPORT_ARGS="..."
export AGENT_FLOW_QEMU_GUEST_TRANSPORT_ASSURANCE="guest_vm"
\`\`\`

For Firecracker/Cloud Hypervisor transport, configure:

\`\`\`bash
export AGENT_FLOW_CODE_VM_ENGINE="firecracker" # or cloud-hypervisor
export AGENT_FLOW_MICROVM_KERNEL_IMAGE="/path/to/vmlinux-or-bzimage"
export AGENT_FLOW_MICROVM_GUEST_TRANSPORT_COMMAND="your-vsock-or-ssh-client"
export AGENT_FLOW_MICROVM_GUEST_TRANSPORT_ARGS="..."
export AGENT_FLOW_MICROVM_GUEST_TRANSPORT_ASSURANCE="guest_vm"
\`\`\`

Use \`guest_vm\` only when the command really reaches the guest. Local/simulated transports are useful for contract tests but are reported as not providing VM isolation.

PowerShell opt-in:

\`\`\`powershell
. .\\runner-kit\\use-qemu-runner.ps1
\`\`\`

sh/bash opt-in:

\`\`\`bash
. ./runner-kit/use-qemu-runner.sh
\`\`\`

Firecracker/Cloud Hypervisor opt-in:

\`\`\`bash
. ./runner-kit/use-microvm-runner.sh
\`\`\`
`;
}

function referenceRunnerSourcePath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../tools/agent-flow-vm-runner-reference.py");
}

function qemuRunnerSourcePath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../tools/agent-flow-vm-runner-qemu.py");
}

function microvmRunnerSourcePath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../tools/agent-flow-vm-runner-microvm.py");
}

function guestAgentSourcePath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../tools/agent-flow-vm-guest-agent.py");
}

function escapePowerShellString(value: string): string {
  return value.replace(/`/g, "``").replace(/"/g, '`"');
}

function escapeShellDoubleQuoted(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`");
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(readString).map((item) => item.toLowerCase()).filter((item, index, items) => item && items.indexOf(item) === index)
    : [];
}

function sanitizeSegment(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "vm-image";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
