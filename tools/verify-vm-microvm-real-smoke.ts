import { strict as assert } from "node:assert";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createMicrovmImageScaffold } from "../apps/builder-api/src/vm-image-scaffold.ts";

type MicrovmEngine = "firecracker" | "cloud-hypervisor";

const realSmokeEnabled = process.env.AGENT_FLOW_MICROVM_REAL_SMOKE === "1";
const realBootEnabled = process.env.AGENT_FLOW_MICROVM_REAL_BOOT === "1";
const requestedEngine = normalizeEngine(process.env.AGENT_FLOW_MICROVM_ENGINE || process.env.AGENT_FLOW_CODE_VM_ENGINE || "firecracker");
const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "agent-flow-microvm-real-smoke-"));

try {
  const scaffoldDir = path.join(workspaceRoot, `${requestedEngine}.vmimage`);
  const result = await createMicrovmImageScaffold({
    outDir: scaffoldDir,
    imageId: `python-${requestedEngine}-microvm`,
    createdAt: "2026-07-03T00:00:00.000Z",
  });
  const readiness = collectReadiness(requestedEngine);

  if (!realSmokeEnabled) {
    console.log(
      JSON.stringify(
        {
          status: "ok",
          format: "agent-flow-builder.vm-microvm-real-smoke-gate.v1",
          mode: "dry-run",
          realSmokeEnabled: false,
          realBootEnabled: false,
          engine: requestedEngine,
          scaffoldReady: true,
          executesUserCode: false,
          bootsVm: false,
          message:
            "Set AGENT_FLOW_MICROVM_REAL_SMOKE=1 with real rootfs/kernel-or-firmware and Firecracker/Cloud Hypervisor binaries to run real preflight. Add AGENT_FLOW_MICROVM_REAL_BOOT=1 for a launch smoke.",
          readiness,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  assert.equal(readiness.preflight.ready, true, `MicroVM real preflight prerequisites missing: ${readiness.preflight.missing.join(", ")}`);

  runPrepareScript(result.buildPowerShellPath, result.buildShellPath, {
    ...process.env,
    AGENT_FLOW_MICROVM_ENGINE: requestedEngine,
  });

  const preflight = runMicrovmPreflight({
    runnerPath: result.microvmRunnerPath!,
    scaffoldDir,
    engine: requestedEngine,
    binaryPath: readiness.preflight.binaryPath!,
  });
  assert.equal(preflight.ok, true);
  assert.equal(preflight.engine, requestedEngine);
  assert.equal(preflight.executesUserCode, false);
  assert.equal(preflight.providesVmIsolation, true);

  if (!realBootEnabled) {
    console.log(
      JSON.stringify(
        {
          status: "ok",
          format: "agent-flow-builder.vm-microvm-real-smoke-gate.v1",
          mode: "real-preflight",
          engine: requestedEngine,
          realSmokeEnabled: true,
          realBootEnabled: false,
          scaffoldReady: true,
          imageManifestGenerated: true,
          preflight: "ok",
          bootsVm: false,
          executesUserCode: false,
          providesVmIsolation: true,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  const child = await launchMicrovm(preflight, scaffoldDir);
  try {
    const bootSeconds = Number(process.env.AGENT_FLOW_MICROVM_REAL_BOOT_SECONDS || "8");
    await delay(Math.max(1, bootSeconds) * 1000);
    if (child.exitCode !== null) {
      throw new Error(`MicroVM process exited during boot smoke with code ${child.exitCode}.`);
    }

    const transportConfigured = Boolean(process.env.AGENT_FLOW_MICROVM_GUEST_TRANSPORT_COMMAND);
    const execution = transportConfigured
      ? runMicrovmExecution({
          runnerPath: result.microvmRunnerPath!,
          scaffoldDir,
          engine: requestedEngine,
          binaryPath: readiness.preflight.binaryPath!,
        })
      : null;

    if (execution) {
      assert.equal(execution.ok, true);
      assert.equal(execution.providesVmIsolation, true);
      assert.equal(execution.guestAgentRunner, "agent-flow-vm-guest-agent");
    }

    console.log(
      JSON.stringify(
        {
          status: "ok",
          format: "agent-flow-builder.vm-microvm-real-smoke-gate.v1",
          mode: "real-boot",
          engine: requestedEngine,
          realSmokeEnabled: true,
          realBootEnabled: true,
          scaffoldReady: true,
          imageManifestGenerated: true,
          preflight: "ok",
          bootProcessStayedAlive: true,
          bootObservationSeconds: bootSeconds,
          guestAgentContract: execution ? "ok" : "not-run",
          providesVmIsolation: execution ? execution.providesVmIsolation === true : true,
          executesUserCode: execution ? execution.executesUserCode === true : false,
        },
        null,
        2,
      ),
    );
  } finally {
    child.kill();
  }
} finally {
  if (process.env.AGENT_FLOW_MICROVM_KEEP_SMOKE_WORKSPACE === "1") {
    console.error(`Keeping microVM smoke workspace: ${workspaceRoot}`);
  } else {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

interface Readiness {
  engine: MicrovmEngine;
  realSmokeEnabled: boolean;
  realBootEnabled: boolean;
  preflight: {
    ready: boolean;
    missing: string[];
    binaryValue: string;
    binaryPath: string | null;
    rootfsPath: string | null;
    kernelPath: string | null;
    firmwarePath: string | null;
    seedPath: string | null;
  };
  transport: {
    configured: boolean;
    commandPath: string | null;
    assurance: string;
  };
}

function collectReadiness(engine: MicrovmEngine): Readiness {
  const binaryValue =
    engine === "firecracker"
      ? process.env.AGENT_FLOW_FIRECRACKER_BINARY || "firecracker"
      : process.env.AGENT_FLOW_CLOUD_HYPERVISOR_BINARY || "cloud-hypervisor";
  const binaryPath = resolveCommand(binaryValue);
  const rootfsPath = existingFile(process.env.AGENT_FLOW_MICROVM_ROOTFS_IMAGE);
  const kernelPath = existingFile(process.env.AGENT_FLOW_MICROVM_KERNEL_IMAGE);
  const firmwarePath = existingFile(process.env.AGENT_FLOW_MICROVM_FIRMWARE_IMAGE);
  const seedPath = existingFile(process.env.AGENT_FLOW_MICROVM_SEED_IMAGE);
  const missing: string[] = [];
  if (!binaryPath) {
    missing.push(engine === "firecracker" ? "AGENT_FLOW_FIRECRACKER_BINARY" : "AGENT_FLOW_CLOUD_HYPERVISOR_BINARY");
  }
  if (!rootfsPath) {
    missing.push("AGENT_FLOW_MICROVM_ROOTFS_IMAGE");
  }
  if (engine === "firecracker" && !kernelPath) {
    missing.push("AGENT_FLOW_MICROVM_KERNEL_IMAGE");
  }
  if (engine === "cloud-hypervisor" && !kernelPath && !firmwarePath) {
    missing.push("AGENT_FLOW_MICROVM_KERNEL_IMAGE|AGENT_FLOW_MICROVM_FIRMWARE_IMAGE");
  }

  const transportCommand = process.env.AGENT_FLOW_MICROVM_GUEST_TRANSPORT_COMMAND || "";
  return {
    engine,
    realSmokeEnabled,
    realBootEnabled,
    preflight: {
      ready: missing.length === 0,
      missing,
      binaryValue,
      binaryPath,
      rootfsPath,
      kernelPath,
      firmwarePath,
      seedPath,
    },
    transport: {
      configured: Boolean(transportCommand),
      commandPath: transportCommand ? resolveCommand(transportCommand) : null,
      assurance: process.env.AGENT_FLOW_MICROVM_GUEST_TRANSPORT_ASSURANCE || "operator_configured",
    },
  };
}

function runPrepareScript(powerShellPath: string, shellPath: string, env: NodeJS.ProcessEnv): void {
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

function runMicrovmPreflight(options: {
  runnerPath: string;
  scaffoldDir: string;
  engine: MicrovmEngine;
  binaryPath: string;
}): Record<string, unknown> {
  return runMicrovmRunner(options.runnerPath, ["--preflight"], buildRunnerRequest(options));
}

function runMicrovmExecution(options: {
  runnerPath: string;
  scaffoldDir: string;
  engine: MicrovmEngine;
  binaryPath: string;
}): Record<string, unknown> {
  return runMicrovmRunner(options.runnerPath, [], {
    ...buildRunnerRequest(options),
    entry: "run",
    language: "python",
    input: "microvm real smoke",
    context: { node_id: "microvm_real_smoke" },
    contract: { sandbox_isolation: "vm" },
    inlineSource:
      "def run(value, context, contract):\n    return {'value': value, 'node': context['node_id'], 'isolation': contract['sandbox_isolation']}\n",
  });
}

function buildRunnerRequest(options: { scaffoldDir: string; engine: MicrovmEngine; binaryPath: string }): Record<string, unknown> {
  return {
    protocol: "agent-flow-vm-runner.v1",
    workspace: options.scaffoldDir,
    vm: {
      engine: options.engine,
      ...(options.engine === "firecracker" ? { firecrackerBinary: options.binaryPath } : { cloudHypervisorBinary: options.binaryPath }),
      image_manifest: "manifests/image.manifest.json",
      memory: process.env.AGENT_FLOW_MICROVM_MEMORY || "1024M",
      cpus: process.env.AGENT_FLOW_MICROVM_CPUS || "1",
      kernelArgs: process.env.AGENT_FLOW_MICROVM_KERNEL_ARGS,
      apiSocket: process.env.AGENT_FLOW_MICROVM_API_SOCKET,
      guestTransportCommand: process.env.AGENT_FLOW_MICROVM_GUEST_TRANSPORT_COMMAND,
      guestTransportArgs: parseArgsEnv(process.env.AGENT_FLOW_MICROVM_GUEST_TRANSPORT_ARGS),
      guestTransportAssurance: process.env.AGENT_FLOW_MICROVM_GUEST_TRANSPORT_ASSURANCE || "operator_configured",
      guestTransportTimeoutSeconds: process.env.AGENT_FLOW_MICROVM_GUEST_TRANSPORT_TIMEOUT_SECONDS || "30",
    },
  };
}

function runMicrovmRunner(runnerPath: string, args: string[], request: Record<string, unknown>): Record<string, unknown> {
  let stdout = "";
  try {
    stdout = execFileSync(process.env.AGENT_FLOW_VM_PYTHON_BINARY || "python", [runnerPath, ...args], {
      input: JSON.stringify(request),
      cwd: process.cwd(),
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    const failed = error as { stdout?: string | Buffer };
    stdout = Buffer.isBuffer(failed.stdout) ? failed.stdout.toString("utf-8") : String(failed.stdout || "");
  }
  return JSON.parse(stdout) as Record<string, unknown>;
}

async function launchMicrovm(preflight: Record<string, unknown>, scaffoldDir: string): Promise<ChildProcess> {
  if (preflight.engine === "firecracker") {
    const enginePlan = preflight.enginePlan as Record<string, unknown>;
    const configPath = String(enginePlan.configPath || path.join(scaffoldDir, "firecracker-config.json"));
    await writeFile(configPath, `${JSON.stringify(enginePlan.plannedConfig, null, 2)}\n`, "utf-8");
  }
  const plannedCommand = preflight.plannedCommand;
  assert.ok(Array.isArray(plannedCommand) && plannedCommand.every((item) => typeof item === "string"), "preflight did not return a command plan");
  const [command, ...args] = plannedCommand as string[];
  const child = spawn(command, args, {
    cwd: scaffoldDir,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-4000);
  });
  await delay(1000);
  if (child.exitCode !== null) {
    throw new Error(`MicroVM process exited immediately with code ${child.exitCode}: ${stderr}`);
  }
  return child;
}

function normalizeEngine(value: string): MicrovmEngine {
  const normalized = value.trim().toLowerCase();
  if (normalized === "firecracker" || normalized === "cloud-hypervisor") {
    return normalized;
  }
  throw new Error(`Unsupported AGENT_FLOW_MICROVM_ENGINE: ${value}`);
}

function existingFile(value: string | undefined): string | null {
  return value && existsSync(value) ? path.resolve(value) : null;
}

function resolveCommand(value: string): string | null {
  if (path.isAbsolute(value) && existsSync(value)) {
    return path.resolve(value);
  }
  const command = process.platform === "win32" ? "where.exe" : "sh";
  const args = process.platform === "win32" ? [value] : ["-c", 'command -v "$1"', "agent-flow-resolve-command", value];
  try {
    return (
      execFileSync(command, args, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] })
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) || null
    );
  } catch {
    return null;
  }
}

function parseArgsEnv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  }
  return trimmed.split(/\s+/).filter(Boolean);
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
