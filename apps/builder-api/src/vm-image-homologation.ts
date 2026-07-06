import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export type MicrovmHomologationStatus = "blocked" | "preflight_verified" | "homologated";

export interface MicrovmHomologationOptions {
  workspaceRoot: string;
  flowRoot: string;
  runnerManifestPath: string;
  imageManifestPath: string;
  outPath: string;
  policyManifestPath?: string;
  preflightEvidencePath?: string;
  bootEvidencePath?: string;
  createdAt?: string;
}

export interface MicrovmHomologationResult {
  format: "agent-flow-builder.vm-microvm-homologation-result.v1";
  status: MicrovmHomologationStatus;
  outPath: string;
  imageId: string;
  engine: string;
  imageSha256: string;
  policyProfile: string;
  missingEvidence: string[];
}

interface RunnerManifest {
  format: string;
  protocol: string;
  runnerId: string;
  engines: string[];
  languages: string[];
  supportsNetworkNone: boolean;
  supportsReadOnlyRootfs: boolean;
  supportsWorkspaceMount: boolean;
  supportsHostDevicePassthrough: boolean;
  supportsExternalGuestTransport: boolean;
}

interface ImageManifest {
  format: string;
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

interface FileDigest {
  path: string;
  sizeBytes: number;
  sha256: string;
}

export async function createMicrovmHomologation(options: MicrovmHomologationOptions): Promise<MicrovmHomologationResult> {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const flowRoot = path.resolve(options.flowRoot);
  const runnerManifestFile = resolveLocalFile(options.runnerManifestPath, flowRoot, workspaceRoot);
  const imageManifestFile = resolveLocalFile(options.imageManifestPath, flowRoot, workspaceRoot);
  const runnerManifest = normalizeRunnerManifest(await readSmallJson(runnerManifestFile));
  const imageManifest = normalizeImageManifest(await readSmallJson(imageManifestFile));
  const imageManifestDir = path.dirname(imageManifestFile);
  const sourceImagePath = resolveLocalFile(imageManifest.imagePath, imageManifestDir, workspaceRoot);
  const imageDigest = await digestDeclaredFile(sourceImagePath, imageManifest.sizeBytes, imageManifest.sha256, "imagem microVM");

  const policyManifestValue = options.policyManifestPath || imageManifest.policyManifest || "";
  if (!policyManifestValue) {
    throw new Error("Homologação microVM exige policyManifest no manifesto da imagem ou --policy-manifest.");
  }
  const policyManifestFile = resolveLocalFile(policyManifestValue, imageManifestDir, workspaceRoot);
  const policyManifest = normalizePolicyManifest(await readSmallJson(policyManifestFile));
  const policyDigest = await digestDeclaredFile(policyManifestFile, undefined, undefined, "manifesto de política microVM");
  const bootArtifacts = await Promise.all(
    imageManifest.bootArtifacts.map(async (artifact) => {
      const artifactPath = resolveLocalFile(artifact.path, imageManifestDir, workspaceRoot);
      const digest = await digestDeclaredFile(artifactPath, artifact.sizeBytes, artifact.sha256, `artefato de boot ${artifact.id}`);
      return {
        id: artifact.id,
        kind: artifact.kind,
        requiredForBoot: artifact.requiredForBoot === true,
        path: normalizeManifestPath(artifact.path),
        sizeBytes: digest.sizeBytes,
        sha256: digest.sha256,
      };
    }),
  );

  const validationChecks = validateMicrovmContracts({
    runnerManifest,
    imageManifest,
    policyManifest,
    imageDigest,
  });

  const preflightEvidence = options.preflightEvidencePath
    ? normalizePreflightEvidence(await readSmallJson(resolveLocalFile(options.preflightEvidencePath, flowRoot, workspaceRoot)), imageManifest, policyManifest, imageDigest)
    : null;
  const bootEvidence = options.bootEvidencePath
    ? normalizeBootEvidence(await readSmallJson(resolveLocalFile(options.bootEvidencePath, flowRoot, workspaceRoot)), imageManifest)
    : null;

  const missingEvidence: string[] = [];
  if (!preflightEvidence?.accepted) {
    missingEvidence.push("microvm_preflight_ok");
  }
  if (!bootEvidence?.accepted) {
    missingEvidence.push("microvm_real_boot_ok");
  }

  const status: MicrovmHomologationStatus = bootEvidence?.accepted
    ? "homologated"
    : preflightEvidence?.accepted
      ? "preflight_verified"
      : "blocked";

  const homologationManifest = {
    format: "agent-flow-builder.vm-microvm-homologation.v1",
    createdAt,
    status,
    homologationLevel: status === "homologated" ? "real_boot_guest_transport" : status === "preflight_verified" ? "real_preflight_only" : "static_manifest_only",
    image: {
      imageId: imageManifest.imageId,
      engine: imageManifest.engine,
      language: imageManifest.language,
      imagePath: normalizeManifestPath(imageManifest.imagePath),
      sizeBytes: imageDigest.sizeBytes,
      sha256: imageDigest.sha256,
      bootArtifacts,
    },
    runner: {
      runnerId: runnerManifest.runnerId,
      protocol: runnerManifest.protocol,
      engines: runnerManifest.engines,
      languages: runnerManifest.languages,
      supportsExternalGuestTransport: runnerManifest.supportsExternalGuestTransport,
    },
    policy: {
      policyId: policyManifest.policyId,
      profile: policyManifest.profile,
      isolation: policyManifest.isolation,
      engines: policyManifest.engines,
      network: policyManifest.network,
      readOnlyRootfs: policyManifest.readOnlyRootfs,
      workspaceMount: policyManifest.workspaceMount,
      hostDevicePassthrough: policyManifest.hostDevicePassthrough,
      snapshotRestore: policyManifest.snapshotRestore,
      requireGuestTransportAssurance: policyManifest.requireGuestTransportAssurance,
      maxMemoryMiB: policyManifest.maxMemoryMiB,
      maxCpus: policyManifest.maxCpus,
      manifestPath: normalizeManifestPath(policyManifestValue),
      sizeBytes: policyDigest.sizeBytes,
      sha256: policyDigest.sha256,
    },
    evidence: {
      validationChecks,
      missingEvidence,
      preflight: preflightEvidence
        ? {
            accepted: preflightEvidence.accepted,
            format: preflightEvidence.format,
            engine: preflightEvidence.engine,
            providesVmIsolation: preflightEvidence.providesVmIsolation,
            executesUserCode: preflightEvidence.executesUserCode,
            readOnlyRootfs: preflightEvidence.readOnlyRootfs,
            guestTransportAssuranceRequired: preflightEvidence.guestTransportAssuranceRequired,
          }
        : null,
      boot: bootEvidence
        ? {
            accepted: bootEvidence.accepted,
            format: bootEvidence.format,
            mode: bootEvidence.mode,
            engine: bootEvidence.engine,
            bootProcessStayedAlive: bootEvidence.bootProcessStayedAlive,
            guestAgentContract: bootEvidence.guestAgentContract,
            providesVmIsolation: bootEvidence.providesVmIsolation,
            executesUserCode: bootEvidence.executesUserCode,
          }
        : null,
    },
    governance: {
      sourceFormat: "agent-flow-builder.vm-microvm-homologation.v1",
      excludesResolvedLocalPaths: true,
      excludesSecrets: true,
      excludesEnvValues: true,
      executesUserCodeDuringManifestBuild: false,
      requiresPolicyManifest: true,
      requiresPreflightEvidenceForUse: true,
      requiresBootEvidenceForHomologatedStatus: true,
      requiresGuestVmTransportForCodeExecution: true,
    },
  };

  const outPath = path.resolve(options.outPath);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(homologationManifest, null, 2)}\n`, "utf-8");

  return {
    format: "agent-flow-builder.vm-microvm-homologation-result.v1",
    status,
    outPath,
    imageId: imageManifest.imageId,
    engine: imageManifest.engine,
    imageSha256: imageDigest.sha256,
    policyProfile: policyManifest.profile,
    missingEvidence,
  };
}

function validateMicrovmContracts(details: {
  runnerManifest: RunnerManifest;
  imageManifest: ImageManifest;
  policyManifest: ReturnType<typeof normalizePolicyManifest>;
  imageDigest: FileDigest;
}): Array<{ id: string; level: "ok" | "error"; message: string }> {
  const checks: Array<{ id: string; level: "ok" | "error"; message: string }> = [];
  const add = (id: string, ok: boolean, message: string) => checks.push({ id, level: ok ? "ok" : "error", message });
  add("runner_protocol", details.runnerManifest.protocol === "agent-flow-vm-runner.v1", "Runner declara protocolo agent-flow-vm-runner.v1.");
  add("engine_supported_by_runner", details.runnerManifest.engines.includes(details.imageManifest.engine), "Runner suporta a engine da imagem.");
  add("engine_supported_by_policy", details.policyManifest.engines.includes(details.imageManifest.engine), "Política permite a engine da imagem.");
  add("policy_hardened", details.policyManifest.profile === "hardened", "Política usa perfil hardened.");
  add("policy_network_none", details.policyManifest.network === "none", "Política exige rede none.");
  add("policy_read_only_rootfs", details.policyManifest.readOnlyRootfs === true, "Política exige rootfs read-only.");
  add("policy_no_workspace_mount", details.policyManifest.workspaceMount === false, "Política bloqueia workspace mount.");
  add("policy_no_host_device_passthrough", details.policyManifest.hostDevicePassthrough === false, "Política bloqueia host device passthrough.");
  add("policy_guest_vm_transport", details.policyManifest.requireGuestTransportAssurance === "guest_vm", "Política exige assurance guest_vm.");
  add("image_digest_verified", Boolean(details.imageDigest.sha256), "Imagem possui SHA-256 calculado.");
  return checks;
}

function normalizePreflightEvidence(
  value: unknown,
  imageManifest: ImageManifest,
  policyManifest: ReturnType<typeof normalizePolicyManifest>,
  imageDigest: FileDigest,
): {
  accepted: boolean;
  format: string;
  engine: string;
  providesVmIsolation: boolean;
  executesUserCode: boolean;
  readOnlyRootfs: boolean;
  guestTransportAssuranceRequired: string;
} {
  if (!isRecord(value)) {
    throw new Error("Evidência de preflight microVM precisa ser um objeto JSON.");
  }
  const format = readString(value.format);
  const policy = isRecord(value.policy) ? value.policy : {};
  const image = isRecord(value.image) ? value.image : {};
  const engine = readString(value.engine);
  const providesVmIsolation = value.providesVmIsolation === true;
  const executesUserCode = value.executesUserCode === true;
  const readOnlyRootfs = policy.readOnlyRootfs === true;
  const guestTransportAssuranceRequired = readString(policy.guestTransportAssuranceRequired);
  const accepted =
    value.ok === true &&
    format === "agent-flow-vm-runner-microvm-preflight.v1" &&
    engine === imageManifest.engine &&
    providesVmIsolation &&
    !executesUserCode &&
    readString(image.sha256).toLowerCase() === imageDigest.sha256 &&
    readString(policy.network) === policyManifest.network &&
    readOnlyRootfs === policyManifest.readOnlyRootfs &&
    guestTransportAssuranceRequired === policyManifest.requireGuestTransportAssurance;
  return {
    accepted,
    format,
    engine,
    providesVmIsolation,
    executesUserCode,
    readOnlyRootfs,
    guestTransportAssuranceRequired,
  };
}

function normalizeBootEvidence(
  value: unknown,
  imageManifest: ImageManifest,
): {
  accepted: boolean;
  format: string;
  mode: string;
  engine: string;
  bootProcessStayedAlive: boolean;
  guestAgentContract: string;
  providesVmIsolation: boolean;
  executesUserCode: boolean;
} {
  if (!isRecord(value)) {
    throw new Error("Evidência de boot microVM precisa ser um objeto JSON.");
  }
  const format = readString(value.format);
  const mode = readString(value.mode);
  const engine = readString(value.engine);
  const bootProcessStayedAlive = value.bootProcessStayedAlive === true;
  const guestAgentContract = readString(value.guestAgentContract);
  const providesVmIsolation = value.providesVmIsolation === true;
  const executesUserCode = value.executesUserCode === true;
  const accepted =
    value.status === "ok" &&
    format === "agent-flow-builder.vm-microvm-real-smoke-gate.v1" &&
    mode === "real-boot" &&
    engine === imageManifest.engine &&
    bootProcessStayedAlive &&
    providesVmIsolation &&
    (guestAgentContract === "ok" || guestAgentContract === "not-run");
  return {
    accepted,
    format,
    mode,
    engine,
    bootProcessStayedAlive,
    guestAgentContract,
    providesVmIsolation,
    executesUserCode,
  };
}

async function digestDeclaredFile(filePath: string, declaredSize: number | undefined, declaredSha256: string | undefined, label: string): Promise<FileDigest> {
  const fileStats = await stat(filePath);
  if (!fileStats.isFile()) {
    throw new Error(`${label} não é um arquivo: ${filePath}`);
  }
  if (declaredSize !== undefined && declaredSize !== fileStats.size) {
    throw new Error(`Tamanho de ${label} diverge do manifesto: esperado ${declaredSize}, encontrado ${fileStats.size}.`);
  }
  const sha256 = await sha256File(filePath);
  if (declaredSha256 && declaredSha256.toLowerCase() !== sha256) {
    throw new Error(`SHA-256 de ${label} diverge do manifesto: esperado ${declaredSha256}, encontrado ${sha256}.`);
  }
  return { path: filePath, sizeBytes: fileStats.size, sha256 };
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
  return {
    format,
    protocol,
    runnerId: requiredString(value.runnerId, "runnerId"),
    engines: readStringArray(value.engines),
    languages: readStringArray(value.languages),
    supportsNetworkNone: value.supportsNetworkNone === true,
    supportsReadOnlyRootfs: value.supportsReadOnlyRootfs === true,
    supportsWorkspaceMount: value.supportsWorkspaceMount === true,
    supportsHostDevicePassthrough: value.supportsHostDevicePassthrough === true,
    supportsExternalGuestTransport: value.supportsExternalGuestTransport === true,
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
  const engine = readString(value.engine).toLowerCase();
  if (engine !== "firecracker" && engine !== "cloud-hypervisor") {
    throw new Error("Homologação microVM exige engine firecracker ou cloud-hypervisor.");
  }
  const sha256 = readString(value.sha256).toLowerCase();
  if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error("sha256 do manifesto da imagem deve conter 64 caracteres hexadecimais.");
  }
  const sizeBytes = typeof value.sizeBytes === "number" && Number.isInteger(value.sizeBytes) && value.sizeBytes > 0 ? value.sizeBytes : undefined;
  return {
    format,
    imageId: requiredString(value.imageId, "imageId"),
    engine,
    language: requiredString(value.language, "language").toLowerCase(),
    imagePath: requiredString(value.imagePath, "imagePath"),
    ...(sizeBytes ? { sizeBytes } : {}),
    ...(sha256 ? { sha256 } : {}),
    bootArtifacts: normalizeBootArtifacts(value.bootArtifacts),
    ...(readString(value.policyManifest) ? { policyManifest: readString(value.policyManifest) } : {}),
  };
}

function normalizeBootArtifacts(value: unknown): BootArtifactManifest[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Manifesto da imagem microVM precisa declarar bootArtifacts.");
  }
  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`bootArtifacts[${index}] precisa ser objeto JSON.`);
    }
    const sha256 = readString(item.sha256).toLowerCase();
    if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) {
      throw new Error(`sha256 de bootArtifacts[${index}] deve conter 64 caracteres hexadecimais.`);
    }
    const sizeBytes = typeof item.sizeBytes === "number" && Number.isInteger(item.sizeBytes) && item.sizeBytes > 0 ? item.sizeBytes : undefined;
    return {
      id: readString(item.id) || `boot-artifact-${index + 1}`,
      kind: requiredString(item.kind, `bootArtifacts[${index}].kind`).toLowerCase(),
      path: requiredString(item.path, `bootArtifacts[${index}].path`),
      requiredForBoot: item.requiredForBoot === true,
      ...(sizeBytes ? { sizeBytes } : {}),
      ...(sha256 ? { sha256 } : {}),
    };
  });
}

function normalizePolicyManifest(value: unknown): {
  format: string;
  policyId: string;
  profile: string;
  isolation: string;
  engines: string[];
  network: string;
  readOnlyRootfs: boolean;
  workspaceMount: boolean;
  hostDevicePassthrough: boolean;
  snapshotRestore: boolean;
  requireGuestTransportAssurance: string;
  maxMemoryMiB: number | null;
  maxCpus: number | null;
} {
  if (!isRecord(value)) {
    throw new Error("Manifesto de política microVM precisa ser objeto JSON.");
  }
  const format = readString(value.format);
  if (format !== "agent-flow-builder.vm-policy-manifest.v1") {
    throw new Error("Manifesto de política microVM usa formato incompatível.");
  }
  return {
    format,
    policyId: requiredString(value.policyId, "policyId"),
    profile: requiredString(value.profile, "profile"),
    isolation: requiredString(value.isolation, "isolation"),
    engines: readStringArray(value.engines),
    network: requiredString(value.network, "network"),
    readOnlyRootfs: value.readOnlyRootfs === true,
    workspaceMount: value.workspaceMount === true,
    hostDevicePassthrough: value.hostDevicePassthrough === true,
    snapshotRestore: value.snapshotRestore === true,
    requireGuestTransportAssurance: requiredString(value.requireGuestTransportAssurance, "requireGuestTransportAssurance"),
    maxMemoryMiB: typeof value.maxMemoryMiB === "number" && Number.isFinite(value.maxMemoryMiB) ? value.maxMemoryMiB : null,
    maxCpus: typeof value.maxCpus === "number" && Number.isFinite(value.maxCpus) ? value.maxCpus : null,
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
    throw new Error("Manifesto/evidência excede 1 MB; use JSON declarativo pequeno.");
  }
  return JSON.parse(await readFile(filePath, "utf-8")) as unknown;
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

function normalizeManifestPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function requiredString(value: unknown, label: string): string {
  const text = readString(value);
  if (!text) {
    throw new Error(`Campo obrigatório ausente: ${label}`);
  }
  return text;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(readString).map((item) => item.toLowerCase()).filter((item, index, items) => item && items.indexOf(item) === index)
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
