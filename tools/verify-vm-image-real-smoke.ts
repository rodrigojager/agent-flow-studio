import { strict as assert } from "node:assert";
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createVmImageScaffold } from "../apps/builder-api/src/vm-image-scaffold.ts";

const realSmokeEnabled = process.env.AGENT_FLOW_VM_REAL_SMOKE === "1";
const requestedRealSmokeBackend = process.env.AGENT_FLOW_VM_REAL_SMOKE_BACKEND || "auto";
const defaultBaseImageUrl = "https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2";
const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-flow-vm-real-smoke-"));

try {
  const scaffoldDir = path.join(workspaceRoot, "python-qemu.vmimage");
  const keyPath = path.join(scaffoldDir, "smoke-key");
  const imageId = "python-qemu-microvm";
  const result = await createVmImageScaffold({
    outDir: scaffoldDir,
    imageId,
    createdAt: "2026-07-03T00:00:00.000Z",
  });

  const readiness = collectReadiness();
  const selectedBackend = selectRealSmokeBackend(readiness);
  if (!realSmokeEnabled) {
    console.log(
      JSON.stringify(
        {
          status: "ok",
          format: "agent-flow-builder.vm-image-real-smoke-gate.v1",
          mode: "dry-run",
          realSmokeEnabled: false,
          scaffoldReady: true,
          executesUserCode: false,
          bootsVm: false,
          selectedBackend,
          message:
            "Set AGENT_FLOW_VM_REAL_SMOKE=1 with QEMU tools and AGENT_FLOW_VM_BASE_IMAGE, or AGENT_FLOW_VM_REAL_SMOKE_BACKEND=docker, to run the real build/boot smoke.",
          readiness,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  generateSshKey(keyPath);
  if (selectedBackend === "docker") {
    const baseImagePath = await prepareBaseImagePath(workspaceRoot);
    const dockerResult = await runDockerRealSmoke(scaffoldDir, keyPath, baseImagePath);
    assertRealSmokeRunnerResult(dockerResult.runnerResult);
    console.log(
      JSON.stringify(
        {
          status: "ok",
          format: "agent-flow-builder.vm-image-real-smoke-gate.v1",
          mode: "real",
          backend: "docker",
          realSmokeEnabled: true,
          scaffoldReady: true,
          imageManifestGenerated: true,
          bootedVm: true,
          guestAgentContract: "ok",
          providesVmIsolation: true,
          dockerImage: dockerResult.dockerImage,
          baseImageSource: dockerResult.baseImageSource,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  assert.equal(readiness.host.ready, true, `VM real smoke host prerequisites missing: ${readiness.host.missing.join(", ")}`);
  const baseImagePath = await prepareBaseImagePath(workspaceRoot);
  runBuildScript(result.buildPowerShellPath, result.buildShellPath, {
    ...process.env,
    AGENT_FLOW_VM_BASE_IMAGE: baseImagePath,
    AGENT_FLOW_VM_SSH_PUBLIC_KEY_PATH: `${keyPath}.pub`,
  });

  const imageManifestPath = path.join(scaffoldDir, "manifests", "image.manifest.json");
  assert.equal(existsSync(imageManifestPath), true, "image.manifest.json was not generated");
  const imageManifest = JSON.parse(await readFile(imageManifestPath, "utf-8")) as Record<string, unknown>;
  assert.equal(imageManifest.format, "agent-flow-builder.vm-image-manifest.v1");

  const port = process.env.AGENT_FLOW_VM_GUEST_SSH_PORT || "2222";
  const bootProcess = spawnBoot(result.bootPowerShellPath, result.bootShellPath, { ...process.env, AGENT_FLOW_VM_GUEST_SSH_PORT: port });
  try {
    await waitForGuestSsh(keyPath, port, Number(process.env.AGENT_FLOW_VM_REAL_SMOKE_WAIT_SECONDS || "120"));
    const runnerResult = runQemuRunnerWithSshTransport(scaffoldDir, keyPath, port);
    assertRealSmokeRunnerResult(runnerResult);

    console.log(
      JSON.stringify(
        {
          status: "ok",
          format: "agent-flow-builder.vm-image-real-smoke-gate.v1",
          mode: "real",
          backend: "host",
          realSmokeEnabled: true,
          scaffoldReady: true,
          imageManifestGenerated: true,
          bootedVm: true,
          guestAgentContract: "ok",
          providesVmIsolation: true,
        },
        null,
        2,
      ),
    );
  } finally {
    bootProcess.kill();
  }
} finally {
  if (process.env.AGENT_FLOW_VM_KEEP_SMOKE_WORKSPACE === "1") {
    console.error(`Keeping VM smoke workspace: ${workspaceRoot}`);
  } else {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

interface Readiness {
  requestedBackend: string;
  host: {
    ready: boolean;
    missing: string[];
    tools: Record<string, string | null>;
  };
  docker: {
    ready: boolean;
    missing: string[];
    tools: Record<string, string | null>;
  };
  baseImage: { configured: boolean; downloadable: boolean; exists: boolean; path: string | null; url: string | null };
}

function collectReadiness(): Readiness {
  const hostTools = {
    qemuSystem: resolveCommand(process.env.QEMU_BIN || "qemu-system-x86_64"),
    qemuImg: resolveCommand(process.env.QEMU_IMG || "qemu-img"),
    cloudLocalds: resolveCommand(process.env.CLOUD_LOCALDS || "cloud-localds"),
    ssh: resolveCommand(process.env.AGENT_FLOW_VM_SSH_BINARY || "ssh"),
    sshKeygen: resolveCommand(process.env.AGENT_FLOW_VM_SSH_KEYGEN_BINARY || "ssh-keygen"),
    python: resolveCommand(process.env.AGENT_FLOW_VM_PYTHON_BINARY || "python"),
  };
  const dockerTools = {
    docker: resolveCommand(process.env.AGENT_FLOW_VM_DOCKER_BINARY || "docker"),
    sshKeygen: hostTools.sshKeygen,
  };
  const baseImagePath = process.env.AGENT_FLOW_VM_BASE_IMAGE || null;
  const baseImageUrl = process.env.AGENT_FLOW_VM_BASE_IMAGE_URL || defaultBaseImageUrl;
  const downloadable = process.env.AGENT_FLOW_VM_DOWNLOAD_BASE_IMAGE === "1";
  const baseImage = {
    configured: Boolean(baseImagePath) || downloadable,
    downloadable,
    exists: Boolean(baseImagePath && existsSync(baseImagePath)),
    path: baseImagePath,
    url: downloadable ? baseImageUrl : null,
  };
  const hostMissing = Object.entries(hostTools)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  const dockerMissing = Object.entries(dockerTools)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (!baseImage.configured) {
    hostMissing.push("AGENT_FLOW_VM_BASE_IMAGE");
    dockerMissing.push("AGENT_FLOW_VM_BASE_IMAGE");
  } else if (!baseImage.exists) {
    if (!baseImage.downloadable) {
      hostMissing.push("AGENT_FLOW_VM_BASE_IMAGE:file_not_found");
      dockerMissing.push("AGENT_FLOW_VM_BASE_IMAGE:file_not_found");
    }
  }
  return {
    requestedBackend: requestedRealSmokeBackend,
    host: {
      ready: hostMissing.length === 0,
      missing: hostMissing,
      tools: hostTools,
    },
    docker: {
      ready: dockerMissing.length === 0,
      missing: dockerMissing,
      tools: dockerTools,
    },
    baseImage,
  };
}

function selectRealSmokeBackend(readiness: Readiness): "host" | "docker" {
  if (requestedRealSmokeBackend === "host" || requestedRealSmokeBackend === "docker") {
    return requestedRealSmokeBackend;
  }
  if (readiness.host.ready) {
    return "host";
  }
  if (readiness.docker.ready) {
    return "docker";
  }
  return "host";
}

function generateSshKey(keyPath: string): void {
  execFileSync(process.env.AGENT_FLOW_VM_SSH_KEYGEN_BINARY || "ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", keyPath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function prepareBaseImagePath(targetDir: string): Promise<string> {
  const existingPath = process.env.AGENT_FLOW_VM_BASE_IMAGE;
  if (existingPath) {
    assert.equal(existsSync(existingPath), true, `AGENT_FLOW_VM_BASE_IMAGE file not found: ${existingPath}`);
    return existingPath;
  }
  assert.equal(
    process.env.AGENT_FLOW_VM_DOWNLOAD_BASE_IMAGE,
    "1",
    "Set AGENT_FLOW_VM_BASE_IMAGE or AGENT_FLOW_VM_DOWNLOAD_BASE_IMAGE=1 for the VM real smoke.",
  );
  const url = process.env.AGENT_FLOW_VM_BASE_IMAGE_URL || defaultBaseImageUrl;
  const cacheRoot = process.env.AGENT_FLOW_VM_BASE_IMAGE_CACHE_DIR || path.join(os.tmpdir(), "agent-flow-vm-base-images");
  const destination = process.env.AGENT_FLOW_VM_BASE_IMAGE_CACHE || path.join(cacheRoot, safeBaseImageFileName(url));
  await mkdir(path.dirname(destination), { recursive: true });
  if (!existsSync(destination)) {
    await downloadFile(url, destination);
  }
  return destination;
}

interface DockerRealSmokeResult {
  dockerImage: string;
  baseImageSource: "provided" | "downloaded";
  runnerResult: Record<string, unknown>;
}

async function runDockerRealSmoke(scaffoldDir: string, keyPath: string, baseImagePath: string): Promise<DockerRealSmokeResult> {
  const dockerImage = await ensureDockerQemuImage(scaffoldDir);
  const port = process.env.AGENT_FLOW_VM_GUEST_SSH_PORT || "2222";
  const waitSeconds = Number(process.env.AGENT_FLOW_VM_REAL_SMOKE_WAIT_SECONDS || "240");
  const requestPath = path.join(scaffoldDir, "smoke-request.json");
  const scriptPath = path.join(scaffoldDir, "docker-real-smoke.sh");
  const resultPath = path.join(scaffoldDir, "smoke-result.json");
  await writeFile(
    requestPath,
    `${JSON.stringify(buildRunnerRequest("/workspace", "/workspace/smoke-key", port, "python3", "qemu-system-x86_64"), null, 2)}\n`,
    "utf-8",
  );
  await writeFile(scriptPath, buildDockerRealSmokeScript(waitSeconds), "utf-8");

  const docker = process.env.AGENT_FLOW_VM_DOCKER_BINARY || "docker";
  const stdout = execFileSync(
    docker,
    [
      "run",
      "--rm",
      "-v",
      `${path.resolve(scaffoldDir)}:/workspace`,
      "-v",
      `${path.resolve(baseImagePath)}:/base/base.qcow2:ro`,
      dockerImage,
      "sh",
      "/workspace/docker-real-smoke.sh",
    ],
    {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: Number(process.env.AGENT_FLOW_VM_REAL_SMOKE_DOCKER_TIMEOUT_MS || "900000"),
    },
  );
  const runnerResult = JSON.parse(await readFile(resultPath, "utf-8")) as Record<string, unknown>;
  assert.ok(stdout.includes("agent-flow-vm-docker-real-smoke:runner-ok"));
  return {
    dockerImage,
    baseImageSource: process.env.AGENT_FLOW_VM_BASE_IMAGE ? "provided" : "downloaded",
    runnerResult,
  };
}

async function ensureDockerQemuImage(scaffoldDir: string): Promise<string> {
  const dockerImage = process.env.AGENT_FLOW_VM_REAL_SMOKE_DOCKER_IMAGE || "agent-flow-vm-real-smoke-qemu:local";
  const docker = process.env.AGENT_FLOW_VM_DOCKER_BINARY || "docker";
  const forceBuild = process.env.AGENT_FLOW_VM_REAL_SMOKE_DOCKER_REBUILD === "1";
  if (!forceBuild) {
    try {
      execFileSync(docker, ["image", "inspect", dockerImage], { stdio: ["ignore", "ignore", "ignore"] });
      return dockerImage;
    } catch {
      // Build below.
    }
  }
  const dockerfilePath = path.join(scaffoldDir, "Dockerfile.real-smoke");
  await writeFile(
    dockerfilePath,
    `FROM debian:12-slim
RUN apt-get update \\
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \\
    ca-certificates \\
    cloud-image-utils \\
    openssh-client \\
    python3 \\
    qemu-system-x86 \\
    qemu-utils \\
  && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
`,
    "utf-8",
  );
  execFileSync(docker, ["build", "-t", dockerImage, "-f", dockerfilePath, scaffoldDir], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: Number(process.env.AGENT_FLOW_VM_REAL_SMOKE_DOCKER_BUILD_TIMEOUT_MS || "900000"),
  });
  return dockerImage;
}

function buildDockerRealSmokeScript(waitSeconds: number): string {
  const waitLoops = Math.max(1, Math.ceil(waitSeconds / 2));
  return `#!/usr/bin/env sh
set -eu
cd /workspace
export AGENT_FLOW_VM_BASE_IMAGE=/base/base.qcow2
export AGENT_FLOW_VM_SSH_PUBLIC_KEY_PATH=/workspace/smoke-key.pub
export AGENT_FLOW_VM_GUEST_SSH_PORT="\${AGENT_FLOW_VM_GUEST_SSH_PORT:-2222}"
export AGENT_FLOW_VM_GUEST_SSH_BIND=127.0.0.1
export AGENT_FLOW_QEMU_MACHINE="\${AGENT_FLOW_QEMU_MACHINE:-q35,accel=tcg}"
export AGENT_FLOW_QEMU_NET_DEVICE="\${AGENT_FLOW_QEMU_NET_DEVICE:-virtio-net-pci}"
chmod 600 /workspace/smoke-key
sh /workspace/scripts/build-image.sh
sh /workspace/scripts/boot-qemu.sh > /workspace/qemu-smoke.log 2>&1 &
QEMU_PID=$!
cleanup() {
  kill "$QEMU_PID" 2>/dev/null || true
  wait "$QEMU_PID" 2>/dev/null || true
}
trap cleanup EXIT
i=1
while [ "$i" -le ${waitLoops} ]; do
  if ssh -o BatchMode=yes -o ConnectTimeout=2 -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i /workspace/smoke-key -p "$AGENT_FLOW_VM_GUEST_SSH_PORT" agentflow@127.0.0.1 test -x /opt/agent-flow/agent-flow-vm-guest-agent.py >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq ${waitLoops} ]; then
    tail -n 120 /workspace/qemu-smoke.log >&2 || true
    exit 64
  fi
  i=$((i + 1))
  sleep 2
done
set +e
python3 /workspace/runner-kit/agent-flow-vm-runner-qemu.py < /workspace/smoke-request.json > /workspace/smoke-result.json
RUNNER_STATUS=$?
set -e
cat /workspace/smoke-result.json
echo
if [ "$RUNNER_STATUS" -ne 0 ]; then
  tail -n 120 /workspace/qemu-smoke.log >&2 || true
  exit "$RUNNER_STATUS"
fi
echo agent-flow-vm-docker-real-smoke:runner-ok
`;
}

function safeBaseImageFileName(url: string): string {
  const pathname = new URL(url).pathname;
  const name = pathname.split("/").filter(Boolean).pop() || "base-cloud-image.qcow2";
  return name.replace(/[^A-Za-z0-9._-]+/g, "-") || "base-cloud-image.qcow2";
}

function runBuildScript(powerShellPath: string, shellPath: string, env: NodeJS.ProcessEnv): void {
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

function spawnBoot(powerShellPath: string, shellPath: string, env: NodeJS.ProcessEnv): ReturnType<typeof spawn> {
  if (process.platform === "win32") {
    return spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", powerShellPath], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  return spawn("sh", [shellPath], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForGuestSsh(keyPath: string, port: string, timeoutSeconds: number): Promise<void> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastError = "";
  const knownHostsFile = process.platform === "win32" ? "NUL" : "/dev/null";
  while (Date.now() < deadline) {
    try {
      execFileSync(
        process.env.AGENT_FLOW_VM_SSH_BINARY || "ssh",
        [
          "-o",
          "BatchMode=yes",
          "-o",
          "StrictHostKeyChecking=no",
          "-o",
          "ConnectTimeout=2",
          "-o",
          `UserKnownHostsFile=${knownHostsFile}`,
          "-i",
          keyPath,
          "-p",
          port,
          "agentflow@127.0.0.1",
          "test",
          "-x",
          "/opt/agent-flow/agent-flow-vm-guest-agent.py",
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error(`Timed out waiting for guest SSH: ${lastError}`);
}

function runQemuRunnerWithSshTransport(scaffoldDir: string, keyPath: string, port: string): Record<string, unknown> {
  const request = buildRunnerRequest(
    scaffoldDir,
    keyPath,
    port,
    process.env.AGENT_FLOW_VM_PYTHON_BINARY || "python",
    process.env.QEMU_BIN || "qemu-system-x86_64",
  );
  const stdout = execFileSync(process.env.AGENT_FLOW_VM_PYTHON_BINARY || "python", [path.join(scaffoldDir, "runner-kit", "agent-flow-vm-runner-qemu.py")], {
    input: JSON.stringify(request),
    cwd: scaffoldDir,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return JSON.parse(stdout) as Record<string, unknown>;
}

function buildRunnerRequest(workspace: string, keyPath: string, port: string, pythonCommand: string, qemuBinary: string): Record<string, unknown> {
  const transportPath = workspace.startsWith("/")
    ? path.posix.join(workspace, "runner-kit", "agent-flow-vm-transport-ssh.py")
    : path.join(workspace, "runner-kit", "agent-flow-vm-transport-ssh.py");
  return {
    protocol: "agent-flow-vm-runner.v1",
    workspace,
    entry: "run",
    language: "python",
    input: "real smoke",
    context: { node_id: "vm_real_smoke" },
    contract: { sandbox_isolation: "vm" },
    inlineSource:
      "def run(value, context, contract):\n    return {'value': value, 'node': context['node_id'], 'isolation': contract['sandbox_isolation']}\n",
    vm: {
      engine: "qemu",
      qemuBinary,
      image: "images/python-qemu-microvm.qcow2",
      guestTransportCommand: pythonCommand,
      guestTransportArgs: [transportPath],
      guestTransportAssurance: "guest_vm",
      guestSshIdentityFile: keyPath,
      guestSshPort: port,
      guestSshTimeoutSeconds: 30,
    },
  };
}

function assertRealSmokeRunnerResult(runnerResult: Record<string, unknown>): void {
  assert.equal(runnerResult.ok, true);
  assert.equal(runnerResult.runner, "agent-flow-vm-runner-qemu");
  assert.equal(runnerResult.providesVmIsolation, true);
  assert.equal(runnerResult.guestAgentRunner, "agent-flow-vm-guest-agent");
  assert.deepEqual(runnerResult.output, {
    value: "real smoke",
    node: "vm_real_smoke",
    isolation: "vm",
  });
}

async function downloadFile(url: string, destination: string, redirects = 0): Promise<void> {
  assert.ok(redirects <= 5, `Too many redirects while downloading VM base image: ${url}`);
  const client = url.startsWith("https:") ? https : http;
  await new Promise<void>((resolve, reject) => {
    const request = client.get(url, (response) => {
      const statusCode = response.statusCode || 0;
      const location = response.headers.location;
      if (statusCode >= 300 && statusCode < 400 && location) {
        response.resume();
        const nextUrl = new URL(location, url).toString();
        downloadFile(nextUrl, destination, redirects + 1).then(resolve, reject);
        return;
      }
      if (statusCode !== 200) {
        response.resume();
        reject(new Error(`Failed to download VM base image: HTTP ${statusCode} from ${url}`));
        return;
      }
      pipeline(response, createWriteStream(destination)).then(resolve, reject);
    });
    request.on("error", reject);
  });
}

function resolveCommand(value: string): string | null {
  if (path.isAbsolute(value) && existsSync(value)) {
    return value;
  }
  const command = process.platform === "win32" ? "where.exe" : "sh";
  const args = process.platform === "win32" ? [value] : ["-c", 'command -v "$1"', "agent-flow-resolve-command", value];
  try {
    return execFileSync(command, args, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || null;
  } catch {
    return null;
  }
}
