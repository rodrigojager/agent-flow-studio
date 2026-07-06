import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import path from "node:path";

export type VmRunnerCheckLevel = "ok" | "warning" | "error";
export type VmRunnerCheckStatus = "ready" | "warning" | "blocked" | "not_vm";
export type VmRunnerValueSource = "node" | "env" | "manifest" | "none";

export interface VmRunnerCheckItem {
  id: string;
  label: string;
  level: VmRunnerCheckLevel;
  message: string;
  path?: string;
}

export interface VmRunnerManifestInfo {
  value: string;
  source: VmRunnerValueSource;
  resolved: boolean;
  path: string | null;
  format: string | null;
  protocol: string | null;
  runnerId: string | null;
  engines: string[];
  languages: string[];
  capabilities: {
    networkNone: boolean | null;
    readOnlyRootfs: boolean | null;
    workspaceMount: boolean | null;
    snapshotRestore: boolean | null;
  };
}

export interface VmImageManifestInfo {
  value: string;
  source: VmRunnerValueSource;
  resolved: boolean;
  path: string | null;
  format: string | null;
  imageId: string | null;
  engine: string | null;
  language: string | null;
  imagePath: string | null;
  imagePathResolved: boolean;
  imageSizeBytes: number | null;
  declaredSizeBytes: number | null;
  sha256: string | null;
  sha256Verified: boolean | null;
}

export interface VmRunnerCheckResult {
  format: "agent-flow-builder.vm-runner-check.v1";
  checkedAt: string;
  flowId: string;
  nodeId: string | null;
  status: VmRunnerCheckStatus;
  protocol: "agent-flow-vm-runner.v1";
  executesUserCode: false;
  runner: {
    value: string;
    source: VmRunnerValueSource;
    resolved: boolean;
    path: string | null;
    args: string[];
  };
  image: {
    value: string;
    source: VmRunnerValueSource;
    resolved: boolean;
    path: string | null;
  };
  runnerManifest: VmRunnerManifestInfo;
  imageManifest: VmImageManifestInfo;
  policy: {
    imageId: string | null;
    engine: string | null;
    profile: string;
    memory: string | null;
    cpus: string | null;
  };
  checks: VmRunnerCheckItem[];
}

interface VmRunnerCheckOptions {
  workspaceRoot: string;
  flowRoot: string;
  flowId: string;
  node: unknown;
  env?: NodeJS.ProcessEnv;
}

export function checkVmRunnerReadiness(options: VmRunnerCheckOptions): VmRunnerCheckResult {
  const env = options.env ?? process.env;
  const node = isRecord(options.node) ? options.node : {};
  const nodeId = readString(node.id);
  const isolation = readString(node.sandboxIsolation);
  const checks: VmRunnerCheckItem[] = [];

  if (isolation !== "vm") {
    return {
      format: "agent-flow-builder.vm-runner-check.v1",
      checkedAt: new Date().toISOString(),
      flowId: options.flowId,
      nodeId,
      status: "not_vm",
      protocol: "agent-flow-vm-runner.v1",
      executesUserCode: false,
      runner: { value: "", source: "none", resolved: false, path: null, args: [] },
      image: { value: "", source: "none", resolved: false, path: null },
      runnerManifest: emptyRunnerManifest(),
      imageManifest: emptyImageManifest(),
      policy: { imageId: null, engine: null, profile: "baseline", memory: null, cpus: null },
      checks: [
        {
          id: "sandbox-isolation",
          label: "Isolamento VM",
          level: "warning",
          message: "O nó não está configurado com sandboxIsolation=vm.",
        },
      ],
    };
  }

  checks.push({
    id: "protocol",
    label: "Contrato",
    level: "ok",
    message: "O checker usa o contrato agent-flow-vm-runner.v1 e não executa código do usuário.",
  });

  const runner = readString(node.sandboxVmRunner) || readString(env.AGENT_FLOW_CODE_VM_RUNNER);
  const runnerSource: VmRunnerValueSource = readString(node.sandboxVmRunner)
    ? "node"
    : readString(env.AGENT_FLOW_CODE_VM_RUNNER)
      ? "env"
      : "none";
  const runnerArgs = readStringList(node.sandboxVmArgs);
  const envRunnerArgs = runnerArgs.length ? [] : splitEnvArgs(readString(env.AGENT_FLOW_CODE_VM_ARGS));
  const resolvedRunner = runner ? resolveCommand(runner, options.workspaceRoot, env) : null;
  const effectiveRunnerArgs = runnerArgs.length ? runnerArgs : envRunnerArgs;
  const requestedEngine = normalizeVmEngine(
    readString(node.sandboxVmEngine) ||
      readString(env.AGENT_FLOW_CODE_VM_ENGINE) ||
      readEngineFromArgs(effectiveRunnerArgs),
  );

  const runnerManifestValue = readString(node.sandboxVmRunnerManifest) || readString(env.AGENT_FLOW_CODE_VM_RUNNER_MANIFEST);
  const runnerManifestSource: VmRunnerValueSource = readString(node.sandboxVmRunnerManifest)
    ? "node"
    : readString(env.AGENT_FLOW_CODE_VM_RUNNER_MANIFEST)
      ? "env"
      : "none";
  const resolvedRunnerManifest = runnerManifestValue
    ? resolveLocalFilePath(runnerManifestValue, options.flowRoot, options.workspaceRoot)
    : null;
  const runnerManifest = loadRunnerManifest(runnerManifestValue, runnerManifestSource, resolvedRunnerManifest, checks);

  const imageManifestValue = readString(node.sandboxVmImageManifest) || readString(env.AGENT_FLOW_CODE_VM_IMAGE_MANIFEST);
  const imageManifestSource: VmRunnerValueSource = readString(node.sandboxVmImageManifest)
    ? "node"
    : readString(env.AGENT_FLOW_CODE_VM_IMAGE_MANIFEST)
      ? "env"
      : "none";
  const resolvedImageManifest = imageManifestValue
    ? resolveLocalFilePath(imageManifestValue, options.flowRoot, options.workspaceRoot)
    : null;
  const imageManifest = loadImageManifest(
    imageManifestValue,
    imageManifestSource,
    resolvedImageManifest,
    options.workspaceRoot,
    checks,
  );

  if (!runner) {
    checks.push({
      id: "runner",
      label: "Runner VM",
      level: "error",
      message: "Configure sandboxVmRunner no nó ou AGENT_FLOW_CODE_VM_RUNNER no ambiente local.",
    });
  } else if (!resolvedRunner) {
    checks.push({
      id: "runner",
      label: "Runner VM",
      level: "error",
      message: `Runner VM não encontrado localmente: ${runner}.`,
    });
  } else {
    checks.push({
      id: "runner",
      label: "Runner VM",
      level: "ok",
      message: `Runner VM resolvido por ${runnerSource === "node" ? "configuração do nó" : "variável de ambiente"}.`,
      path: resolvedRunner,
    });
  }

  const image = readString(node.sandboxVmImage) || readString(env.AGENT_FLOW_CODE_VM_IMAGE);
  const imageSource: VmRunnerValueSource = readString(node.sandboxVmImage)
    ? "node"
    : readString(env.AGENT_FLOW_CODE_VM_IMAGE)
      ? "env"
      : imageManifest.imagePath
        ? "manifest"
        : "none";
  const effectiveImage = image || imageManifest.imagePath || "";
  const resolvedExplicitImage = image ? resolveImagePath(image, options.flowRoot, options.workspaceRoot) : null;
  const resolvedImage = resolvedExplicitImage || (imageManifest.imagePathResolved ? imageManifest.pathForImage ?? null : null);

  if (resolvedExplicitImage && imageManifest.pathForImage && path.normalize(resolvedExplicitImage) !== path.normalize(imageManifest.pathForImage)) {
    checks.push({
      id: "image-manifest-path-match",
      label: "Imagem do manifesto",
      level: "error",
      message: "sandboxVmImage e imagePath do manifesto apontam para arquivos diferentes.",
      path: imageManifest.pathForImage,
    });
  }

  if (!effectiveImage) {
    checks.push({
      id: "image",
      label: "Imagem VM",
      level: "warning",
      message: "Nenhuma imagem VM foi informada; o runner precisará escolher uma imagem padrão.",
    });
  } else if (!resolvedImage) {
    checks.push({
      id: "image",
      label: "Imagem VM",
      level: "error",
      message: `Imagem VM não encontrada localmente: ${effectiveImage}.`,
    });
  } else {
    checks.push({
      id: "image",
      label: "Imagem VM",
      level: "ok",
      message: `Imagem VM resolvida por ${sourceLabel(imageSource)}.`,
      path: resolvedImage,
    });
  }

  const imageId = readString(node.sandboxVmImageId) || null;
  const effectiveEngine = requestedEngine || imageManifest.engine || runnerManifest.engines[0] || null;
  addManifestCompatibilityChecks({
    checks,
    runnerManifest,
    imageManifest,
    imageId,
    requestedEngine,
    effectiveEngine,
    profile: normalizeVmProfile(readString(node.sandboxVmProfile)),
    resolvedImage,
  });

  const errorCount = checks.filter((check) => check.level === "error").length;
  const warningCount = checks.filter((check) => check.level === "warning").length;
  const status: VmRunnerCheckStatus = errorCount ? "blocked" : warningCount ? "warning" : "ready";

  return {
    format: "agent-flow-builder.vm-runner-check.v1",
    checkedAt: new Date().toISOString(),
    flowId: options.flowId,
    nodeId,
    status,
    protocol: "agent-flow-vm-runner.v1",
    executesUserCode: false,
    runner: {
      value: runner,
      source: runnerSource,
      resolved: Boolean(resolvedRunner),
      path: resolvedRunner,
      args: effectiveRunnerArgs,
    },
    image: {
      value: effectiveImage,
      source: imageSource,
      resolved: Boolean(resolvedImage),
      path: resolvedImage,
    },
    runnerManifest,
    imageManifest: stripImageManifestPrivatePath(imageManifest),
    policy: {
      imageId,
      engine: effectiveEngine,
      profile: normalizeVmProfile(readString(node.sandboxVmProfile)),
      memory: readString(node.sandboxVmMemory) || null,
      cpus: readString(node.sandboxVmCpus) || null,
    },
    checks,
  };
}

type InternalVmImageManifestInfo = VmImageManifestInfo & {
  pathForImage?: string | null;
};

function emptyRunnerManifest(): VmRunnerManifestInfo {
  return {
    value: "",
    source: "none",
    resolved: false,
    path: null,
    format: null,
    protocol: null,
    runnerId: null,
    engines: [],
    languages: [],
    capabilities: {
      networkNone: null,
      readOnlyRootfs: null,
      workspaceMount: null,
      snapshotRestore: null,
    },
  };
}

function emptyImageManifest(): InternalVmImageManifestInfo {
  return {
    value: "",
    source: "none",
    resolved: false,
    path: null,
    format: null,
    imageId: null,
    engine: null,
    language: null,
    imagePath: null,
    imagePathResolved: false,
    imageSizeBytes: null,
    declaredSizeBytes: null,
    sha256: null,
    sha256Verified: null,
    pathForImage: null,
  };
}

function loadRunnerManifest(
  value: string,
  source: VmRunnerValueSource,
  resolvedPath: string | null,
  checks: VmRunnerCheckItem[],
): VmRunnerManifestInfo {
  const info = { ...emptyRunnerManifest(), value, source };
  if (!value) {
    return info;
  }
  if (!resolvedPath) {
    checks.push({
      id: "runner-manifest",
      label: "Manifesto do runner",
      level: "error",
      message: `Manifesto do runner VM não encontrado localmente: ${value}.`,
    });
    return info;
  }
  info.resolved = true;
  info.path = resolvedPath;
  const parsed = readJsonFile(resolvedPath);
  if (!parsed.ok) {
    checks.push({
      id: "runner-manifest",
      label: "Manifesto do runner",
      level: "error",
      message: parsed.error,
      path: resolvedPath,
    });
    return info;
  }
  const manifest = parsed.value;
  info.format = readString(manifest.format) || null;
  info.protocol = readString(manifest.protocol) || null;
  info.runnerId = readString(manifest.runnerId) || null;
  info.engines = readNormalizedStringList(manifest.engines);
  info.languages = readNormalizedStringList(manifest.languages);
  info.capabilities = {
    networkNone: readOptionalBoolean(manifest.supportsNetworkNone ?? readRecordBoolean(manifest.capabilities, "networkNone")),
    readOnlyRootfs: readOptionalBoolean(manifest.supportsReadOnlyRootfs ?? readRecordBoolean(manifest.capabilities, "readOnlyRootfs")),
    workspaceMount: readOptionalBoolean(manifest.supportsWorkspaceMount ?? readRecordBoolean(manifest.capabilities, "workspaceMount")),
    snapshotRestore: readOptionalBoolean(manifest.supportsSnapshotRestore ?? readRecordBoolean(manifest.capabilities, "snapshotRestore")),
  };

  const level: VmRunnerCheckLevel =
    info.format === "agent-flow-builder.vm-runner-manifest.v1" && info.protocol === "agent-flow-vm-runner.v1" ? "ok" : "error";
  checks.push({
    id: "runner-manifest",
    label: "Manifesto do runner",
    level,
    message:
      level === "ok"
        ? `Manifesto do runner ${info.runnerId || "local"} compatível com agent-flow-vm-runner.v1.`
        : "Manifesto do runner precisa usar format=agent-flow-builder.vm-runner-manifest.v1 e protocol=agent-flow-vm-runner.v1.",
    path: resolvedPath,
  });
  return info;
}

function loadImageManifest(
  value: string,
  source: VmRunnerValueSource,
  resolvedPath: string | null,
  workspaceRoot: string,
  checks: VmRunnerCheckItem[],
): InternalVmImageManifestInfo {
  const info = { ...emptyImageManifest(), value, source };
  if (!value) {
    return info;
  }
  if (!resolvedPath) {
    checks.push({
      id: "image-manifest",
      label: "Manifesto da imagem",
      level: "error",
      message: `Manifesto da imagem VM não encontrado localmente: ${value}.`,
    });
    return info;
  }
  info.resolved = true;
  info.path = resolvedPath;
  const parsed = readJsonFile(resolvedPath);
  if (!parsed.ok) {
    checks.push({
      id: "image-manifest",
      label: "Manifesto da imagem",
      level: "error",
      message: parsed.error,
      path: resolvedPath,
    });
    return info;
  }
  const manifest = parsed.value;
  info.format = readString(manifest.format) || null;
  info.imageId = readString(manifest.imageId) || null;
  info.engine = normalizeVmEngine(readString(manifest.engine));
  info.language = readString(manifest.language).toLowerCase() || null;
  info.imagePath = readString(manifest.imagePath) || null;
  info.declaredSizeBytes = readFinitePositiveInteger(manifest.sizeBytes);
  info.sha256 = normalizeSha256(readString(manifest.sha256));
  if (info.imagePath) {
    info.pathForImage = resolveLocalFilePath(info.imagePath, path.dirname(resolvedPath), workspaceRoot);
    info.imagePathResolved = Boolean(info.pathForImage);
    info.imageSizeBytes = info.pathForImage ? safeFileSize(info.pathForImage) : null;
  }
  const formatOk = info.format === "agent-flow-builder.vm-image-manifest.v1";
  checks.push({
    id: "image-manifest",
    label: "Manifesto da imagem",
    level: formatOk ? "ok" : "error",
    message: formatOk
      ? `Manifesto da imagem ${info.imageId || "local"} lido sem executar código.`
      : "Manifesto da imagem precisa usar format=agent-flow-builder.vm-image-manifest.v1.",
    path: resolvedPath,
  });
  if (info.imagePath && !info.imagePathResolved) {
    checks.push({
      id: "image-manifest-image",
      label: "Arquivo da imagem",
      level: "error",
      message: `imagePath do manifesto não foi encontrado localmente: ${info.imagePath}.`,
    });
  }
  if (info.declaredSizeBytes !== null && info.imageSizeBytes !== null) {
    checks.push({
      id: "image-manifest-size",
      label: "Tamanho da imagem",
      level: info.declaredSizeBytes === info.imageSizeBytes ? "ok" : "error",
      message:
        info.declaredSizeBytes === info.imageSizeBytes
          ? `Tamanho da imagem confere com o manifesto (${info.imageSizeBytes} bytes).`
          : `Tamanho da imagem diverge do manifesto: esperado ${info.declaredSizeBytes}, encontrado ${info.imageSizeBytes}.`,
      ...(info.pathForImage ? { path: info.pathForImage } : {}),
    });
  }
  if (readString(manifest.sha256) && !info.sha256) {
    checks.push({
      id: "image-manifest-sha256",
      label: "Hash da imagem",
      level: "error",
      message: "sha256 do manifesto deve conter 64 caracteres hexadecimais.",
    });
  } else if (info.sha256 && info.pathForImage) {
    const actualSha256 = safeFileSha256(info.pathForImage);
    info.sha256Verified = actualSha256 === info.sha256;
    checks.push({
      id: "image-manifest-sha256",
      label: "Hash da imagem",
      level: info.sha256Verified ? "ok" : "error",
      message: info.sha256Verified
        ? "SHA-256 da imagem confere com o manifesto."
        : `SHA-256 da imagem diverge do manifesto: esperado ${info.sha256}, encontrado ${actualSha256 || "indisponível"}.`,
      path: info.pathForImage,
    });
  } else if (info.resolved && info.pathForImage && !info.sha256) {
    checks.push({
      id: "image-manifest-sha256",
      label: "Hash da imagem",
      level: "warning",
      message: "Manifesto da imagem não declara sha256; a distribuição não possui verificação forte de integridade.",
      path: info.pathForImage,
    });
  }
  return info;
}

function addManifestCompatibilityChecks({
  checks,
  runnerManifest,
  imageManifest,
  imageId,
  requestedEngine,
  effectiveEngine,
  profile,
  resolvedImage,
}: {
  checks: VmRunnerCheckItem[];
  runnerManifest: VmRunnerManifestInfo;
  imageManifest: VmImageManifestInfo;
  imageId: string | null;
  requestedEngine: string | null;
  effectiveEngine: string | null;
  profile: string;
  resolvedImage: string | null;
}): void {
  if (requestedEngine) {
    checks.push({
      id: "vm-engine",
      label: "Engine VM",
      level: "ok",
      message: `Engine VM declarada: ${requestedEngine}.`,
    });
  }
  if (imageId && imageManifest.imageId) {
    checks.push({
      id: "image-manifest-id",
      label: "ID da imagem",
      level: imageId === imageManifest.imageId ? "ok" : "error",
      message:
        imageId === imageManifest.imageId
          ? `sandboxVmImageId confere com o manifesto (${imageId}).`
          : `sandboxVmImageId=${imageId} diverge do manifesto (${imageManifest.imageId}).`,
    });
  }
  if (effectiveEngine && runnerManifest.engines.length) {
    checks.push({
      id: "runner-manifest-engine",
      label: "Engine do runner",
      level: runnerManifest.engines.includes(effectiveEngine) ? "ok" : "error",
      message: runnerManifest.engines.includes(effectiveEngine)
        ? `Runner declara suporte a ${effectiveEngine}.`
        : `Runner não declara suporte a ${effectiveEngine}.`,
    });
  }
  if (effectiveEngine && imageManifest.engine) {
    checks.push({
      id: "image-manifest-engine",
      label: "Engine da imagem",
      level: effectiveEngine === imageManifest.engine ? "ok" : "error",
      message:
        effectiveEngine === imageManifest.engine
          ? `Imagem declara compatibilidade com ${effectiveEngine}.`
          : `Imagem declara engine ${imageManifest.engine}, mas a política usa ${effectiveEngine}.`,
    });
  }
  if (resolvedImage && imageManifest.declaredSizeBytes === null && imageManifest.resolved) {
    checks.push({
      id: "image-manifest-size",
      label: "Tamanho da imagem",
      level: "warning",
      message: "Manifesto da imagem não declara sizeBytes; a checagem de integridade leve fica incompleta.",
    });
  }
  if (profile === "hardened" && runnerManifest.resolved) {
    const capabilities = runnerManifest.capabilities;
    for (const requirement of [
      ["networkNone", "rede desabilitada", true],
      ["workspaceMount", "sem montagem de workspace", false],
      ["readOnlyRootfs", "rootfs read-only", true],
    ] as const) {
      const [key, label, expected] = requirement;
      const value = capabilities[key];
      const ok = value === expected;
      checks.push({
        id: `runner-manifest-capability-${key}`,
        label: `Hardened: ${label}`,
        level: ok ? "ok" : value === null ? "warning" : "error",
        message:
          value === null
            ? `Manifesto do runner não informa ${label}.`
            : ok
              ? expected
                ? `Runner declara suporte a ${label}.`
                : `Runner declara ${label}.`
              : expected
                ? `Runner não declara suporte a ${label}.`
                : `Runner ainda permite ${label}.`,
      });
    }
  }
}

function stripImageManifestPrivatePath(info: InternalVmImageManifestInfo): VmImageManifestInfo {
  const { pathForImage: _pathForImage, ...publicInfo } = info;
  return publicInfo;
}

function resolveCommand(command: string, workspaceRoot: string, env: NodeJS.ProcessEnv): string | null {
  const candidates: string[] = [];
  if (path.isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    candidates.push(path.isAbsolute(command) ? command : path.resolve(workspaceRoot, command));
  } else {
    const pathEntries = (env.PATH || "").split(path.delimiter).filter(Boolean);
    const extensions =
      process.platform === "win32"
        ? (env.PATHEXT || ".EXE;.CMD;.BAT;.COM")
            .split(";")
            .map((item) => item.toLowerCase())
        : [""];
    for (const entry of pathEntries) {
      candidates.push(path.join(entry, command));
      if (process.platform === "win32" && !path.extname(command)) {
        for (const extension of extensions) {
          candidates.push(path.join(entry, `${command}${extension}`));
        }
      }
    }
  }
  return firstExistingFile(candidates);
}

function resolveImagePath(image: string, flowRoot: string, workspaceRoot: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(image)) {
    return null;
  }
  return resolveLocalFilePath(image, flowRoot, workspaceRoot);
}

function resolveLocalFilePath(filePath: string, primaryRoot: string, workspaceRoot: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(filePath)) {
    return null;
  }
  const candidates = path.isAbsolute(filePath)
    ? [filePath]
    : [path.resolve(primaryRoot, filePath), path.resolve(workspaceRoot, filePath)];
  return firstExistingFile(candidates);
}

function firstExistingFile(candidates: string[]): string | null {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = path.normalize(candidate);
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    try {
      if (existsSync(normalized) && statSync(normalized).isFile()) {
        return normalized;
      }
    } catch {
      // Ignore unreadable candidates and keep checking the next path.
    }
  }
  return null;
}

function normalizeVmProfile(value: string): string {
  return value === "hardened" ? "hardened" : "baseline";
}

function normalizeVmEngine(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (["qemu", "firecracker", "cloud-hypervisor", "custom"].includes(normalized)) {
    return normalized;
  }
  return normalized || null;
}

function readEngineFromArgs(args: string[]): string {
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === "--engine" && args[index + 1]) {
      return args[index + 1];
    }
    if (current.startsWith("--engine=")) {
      return current.slice("--engine=".length);
    }
  }
  return "";
}

function sourceLabel(source: VmRunnerValueSource): string {
  if (source === "node") {
    return "configuração do nó";
  }
  if (source === "env") {
    return "variável de ambiente";
  }
  if (source === "manifest") {
    return "manifesto da imagem";
  }
  return "configuração local";
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(readString).filter(Boolean) : [];
}

function readNormalizedStringList(value: unknown): string[] {
  return readStringList(value)
    .map((item) => item.toLowerCase())
    .filter((item, index, items) => item && items.indexOf(item) === index);
}

function readOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  return null;
}

function readRecordBoolean(value: unknown, key: string): boolean | null {
  if (!isRecord(value)) {
    return null;
  }
  return readOptionalBoolean(value[key]);
}

function readFinitePositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return null;
  }
  return value;
}

function normalizeSha256(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function safeFileSize(filePath: string): number | null {
  try {
    return statSync(filePath).size;
  } catch {
    return null;
  }
}

function safeFileSha256(filePath: string): string | null {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let fd: number | null = null;
  try {
    fd = openSync(filePath, "r");
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        break;
      }
      hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest("hex");
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Ignore close failures after a best-effort integrity check.
      }
    }
  }
}

function readJsonFile(filePath: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  let size = 0;
  try {
    size = statSync(filePath).size;
  } catch {
    return { ok: false, error: `Manifesto não pôde ser lido: ${filePath}.` };
  }
  if (size > 1_000_000) {
    return { ok: false, error: "Manifesto excede 1 MB; use um JSON declarativo pequeno." };
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
    if (!isRecord(parsed)) {
      return { ok: false, error: "Manifesto precisa ser um objeto JSON." };
    }
    return { ok: true, value: parsed };
  } catch (error) {
    return {
      ok: false,
      error: `Manifesto JSON inválido: ${error instanceof Error ? error.message : String(error)}.`,
    };
  }
}

function splitEnvArgs(value: string): string[] {
  if (!value) {
    return [];
  }
  return value.match(/"[^"]*"|'[^']*'|\S+/g)?.map((item) => item.replace(/^["']|["']$/g, "")) ?? [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
