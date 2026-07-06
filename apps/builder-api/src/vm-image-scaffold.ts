import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface VmImageScaffoldOptions {
  outDir: string;
  imageId?: string;
  createdAt?: string;
}

export interface VmImageScaffoldResult {
  format: "agent-flow-builder.vm-image-scaffold-result.v1";
  imageId: string;
  outDir: string;
  scaffoldManifestPath: string;
  runnerManifestPath: string;
  imageManifestTemplatePath: string;
  guestAgentPath: string;
  sshTransportPath: string;
  buildShellPath: string;
  buildPowerShellPath: string;
  bootShellPath: string;
  bootPowerShellPath: string;
  microvmRunnerPath?: string;
  preflightFirecrackerShellPath?: string;
  preflightFirecrackerPowerShellPath?: string;
  preflightCloudHypervisorShellPath?: string;
  preflightCloudHypervisorPowerShellPath?: string;
  microvmPolicyManifestPath?: string;
}

export async function createVmImageScaffold(options: VmImageScaffoldOptions): Promise<VmImageScaffoldResult> {
  const imageId = sanitizeSegment(options.imageId || "agent-flow-python-qemu");
  const createdAt = options.createdAt ?? new Date().toISOString();
  const outDir = path.resolve(options.outDir);
  const manifestsDir = path.join(outDir, "manifests");
  const cloudInitDir = path.join(outDir, "cloud-init");
  const guestDir = path.join(outDir, "guest");
  const runnerKitDir = path.join(outDir, "runner-kit");
  const scriptsDir = path.join(outDir, "scripts");
  const imagesDir = path.join(outDir, "images");

  await mkdir(manifestsDir, { recursive: true });
  await mkdir(cloudInitDir, { recursive: true });
  await mkdir(guestDir, { recursive: true });
  await mkdir(runnerKitDir, { recursive: true });
  await mkdir(scriptsDir, { recursive: true });
  await mkdir(imagesDir, { recursive: true });

  const scaffoldManifestPath = path.join(outDir, "vm-image-scaffold.json");
  const runnerManifestPath = path.join(manifestsDir, "runner.manifest.json");
  const imageManifestTemplatePath = path.join(manifestsDir, "image.manifest.template.json");
  const guestAgentPath = path.join(guestDir, "agent-flow-vm-guest-agent.py");
  const sshTransportPath = path.join(runnerKitDir, "agent-flow-vm-transport-ssh.py");
  const qemuRunnerPath = path.join(runnerKitDir, "agent-flow-vm-runner-qemu.py");
  const buildShellPath = path.join(scriptsDir, "build-image.sh");
  const buildPowerShellPath = path.join(scriptsDir, "build-image.ps1");
  const bootShellPath = path.join(scriptsDir, "boot-qemu.sh");
  const bootPowerShellPath = path.join(scriptsDir, "boot-qemu.ps1");

  const guestAgentSource = await readFile(guestAgentSourcePath(), "utf-8");
  await writeFile(path.join(cloudInitDir, "user-data.template"), buildCloudInitUserDataTemplate(guestAgentSource), "utf-8");
  await writeFile(path.join(cloudInitDir, "meta-data"), `instance-id: ${imageId}\nlocal-hostname: ${imageId}\n`, "utf-8");
  await copyFile(guestAgentSourcePath(), guestAgentPath);
  await copyFile(sshTransportSourcePath(), sshTransportPath);
  await copyFile(qemuRunnerSourcePath(), qemuRunnerPath);

  await writeJson(scaffoldManifestPath, {
    format: "agent-flow-builder.vm-image-scaffold.v1",
    imageId,
    createdAt,
    engine: "qemu",
    language: "python",
    guestAgent: "guest/agent-flow-vm-guest-agent.py",
    guestAgentProtocol: "agent-flow-vm-guest-agent.v1",
    sshTransport: "runner-kit/agent-flow-vm-transport-ssh.py",
    qemuRunner: "runner-kit/agent-flow-vm-runner-qemu.py",
    cloudInit: {
      userDataTemplate: "cloud-init/user-data.template",
      metaData: "cloud-init/meta-data",
    },
    scripts: {
      buildShell: "scripts/build-image.sh",
      buildPowerShell: "scripts/build-image.ps1",
      bootShell: "scripts/boot-qemu.sh",
      bootPowerShell: "scripts/boot-qemu.ps1",
    },
    outputs: {
      imagePath: `images/${imageId}.qcow2`,
      seedPath: "images/seed.iso",
      imageManifestPath: "manifests/image.manifest.json",
    },
    governance: {
      excludesSecrets: true,
      excludesPrivateKeys: true,
      excludesBaseImage: true,
      doesNotDownloadOrBootDuringScaffold: true,
      requiresUserProvidedBaseCloudImage: true,
      requiresUserProvidedSshPublicKey: true,
      supportsExternalGuestTransport: true,
    },
  });

  await writeJson(runnerManifestPath, {
    format: "agent-flow-builder.vm-runner-manifest.v1",
    protocol: "agent-flow-vm-runner.v1",
    runnerId: "agent-flow-qemu-ssh-transport",
    engines: ["qemu"],
    languages: ["python"],
    supportsNetworkNone: false,
    supportsReadOnlyRootfs: false,
    supportsWorkspaceMount: false,
    supportsSnapshotRestore: false,
    supportsExternalGuestTransport: true,
    guestAgentProtocol: "agent-flow-vm-guest-agent.v1",
  });

  await writeJson(imageManifestTemplatePath, {
    format: "agent-flow-builder.vm-image-manifest.v1",
    imageId,
    engine: "qemu",
    language: "python",
    imagePath: `../images/${imageId}.qcow2`,
    bootArtifacts: [
      {
        id: "cloud-init-seed",
        kind: "cloud-init-seed",
        path: "../images/seed.iso",
        requiredForBoot: true,
      },
    ],
    buildManifest: "../vm-image-scaffold.json",
  });

  await writeFile(buildShellPath, buildShellBuildScript(imageId), "utf-8");
  await writeFile(buildPowerShellPath, buildPowerShellBuildScript(imageId), "utf-8");
  await writeFile(bootShellPath, buildShellBootScript(imageId), "utf-8");
  await writeFile(bootPowerShellPath, buildPowerShellBootScript(imageId), "utf-8");
  await writeFile(path.join(outDir, "README.md"), buildScaffoldReadme(imageId), "utf-8");

  return {
    format: "agent-flow-builder.vm-image-scaffold-result.v1",
    imageId,
    outDir,
    scaffoldManifestPath,
    runnerManifestPath,
    imageManifestTemplatePath,
    guestAgentPath,
    sshTransportPath,
    buildShellPath,
    buildPowerShellPath,
    bootShellPath,
    bootPowerShellPath,
  };
}

export async function createMicrovmImageScaffold(options: VmImageScaffoldOptions): Promise<VmImageScaffoldResult> {
  const imageId = sanitizeSegment(options.imageId || "agent-flow-python-direct-kernel");
  const createdAt = options.createdAt ?? new Date().toISOString();
  const outDir = path.resolve(options.outDir);
  const manifestsDir = path.join(outDir, "manifests");
  const guestDir = path.join(outDir, "guest");
  const runnerKitDir = path.join(outDir, "runner-kit");
  const scriptsDir = path.join(outDir, "scripts");
  const imagesDir = path.join(outDir, "images");

  await mkdir(manifestsDir, { recursive: true });
  await mkdir(guestDir, { recursive: true });
  await mkdir(runnerKitDir, { recursive: true });
  await mkdir(scriptsDir, { recursive: true });
  await mkdir(imagesDir, { recursive: true });

  const scaffoldManifestPath = path.join(outDir, "vm-image-scaffold.json");
  const runnerManifestPath = path.join(manifestsDir, "runner.manifest.json");
  const imageManifestTemplatePath = path.join(manifestsDir, "image.manifest.template.json");
  const microvmPolicyManifestPath = path.join(manifestsDir, "microvm.policy.json");
  const guestAgentPath = path.join(guestDir, "agent-flow-vm-guest-agent.py");
  const microvmRunnerPath = path.join(runnerKitDir, "agent-flow-vm-runner-microvm.py");
  const buildShellPath = path.join(scriptsDir, "prepare-direct-kernel-image.sh");
  const buildPowerShellPath = path.join(scriptsDir, "prepare-direct-kernel-image.ps1");
  const preflightFirecrackerShellPath = path.join(scriptsDir, "preflight-firecracker.sh");
  const preflightFirecrackerPowerShellPath = path.join(scriptsDir, "preflight-firecracker.ps1");
  const preflightCloudHypervisorShellPath = path.join(scriptsDir, "preflight-cloud-hypervisor.sh");
  const preflightCloudHypervisorPowerShellPath = path.join(scriptsDir, "preflight-cloud-hypervisor.ps1");

  await copyFile(guestAgentSourcePath(), guestAgentPath);
  await copyFile(microvmRunnerSourcePath(), microvmRunnerPath);

  await writeJson(scaffoldManifestPath, {
    format: "agent-flow-builder.vm-image-scaffold.v1",
    imageId,
    createdAt,
    engine: "microvm-direct-kernel",
    supportedEngines: ["firecracker", "cloud-hypervisor"],
    language: "python",
    guestAgent: "guest/agent-flow-vm-guest-agent.py",
    guestAgentProtocol: "agent-flow-vm-guest-agent.v1",
    microvmRunner: "runner-kit/agent-flow-vm-runner-microvm.py",
    scripts: {
      prepareShell: "scripts/prepare-direct-kernel-image.sh",
      preparePowerShell: "scripts/prepare-direct-kernel-image.ps1",
      preflightFirecrackerShell: "scripts/preflight-firecracker.sh",
      preflightFirecrackerPowerShell: "scripts/preflight-firecracker.ps1",
      preflightCloudHypervisorShell: "scripts/preflight-cloud-hypervisor.sh",
      preflightCloudHypervisorPowerShell: "scripts/preflight-cloud-hypervisor.ps1",
    },
    outputs: {
      imagePath: `images/${imageId}.rootfs.ext4`,
      kernelPath: "images/kernel",
      firmwarePath: "images/firmware",
      seedPath: "images/seed.iso",
      imageManifestPath: "manifests/image.manifest.json",
      policyManifestPath: "manifests/microvm.policy.json",
    },
    governance: {
      excludesSecrets: true,
      excludesPrivateKeys: true,
      excludesRootfs: true,
      excludesKernel: true,
      excludesFirmware: true,
      doesNotDownloadOrBootDuringScaffold: true,
      requiresUserProvidedRootfs: true,
      requiresUserProvidedKernelOrFirmware: true,
      supportsFirecracker: true,
      supportsCloudHypervisor: true,
      supportsExternalGuestTransport: true,
      includesHardenedPolicyManifest: true,
    },
  });

  await writeJson(runnerManifestPath, {
    format: "agent-flow-builder.vm-runner-manifest.v1",
    protocol: "agent-flow-vm-runner.v1",
    runnerId: "agent-flow-microvm-direct-kernel",
    engines: ["firecracker", "cloud-hypervisor"],
    languages: ["python"],
    supportsSnapshotRestore: false,
    supportsExternalGuestTransport: true,
    supportsFirecracker: true,
    supportsCloudHypervisor: true,
    supportsNetworkNone: true,
    supportsReadOnlyRootfs: true,
    supportsWorkspaceMount: false,
    supportsHostDevicePassthrough: false,
    guestAgentProtocol: "agent-flow-vm-guest-agent.v1",
  });

  await writeJson(microvmPolicyManifestPath, {
    format: "agent-flow-builder.vm-policy-manifest.v1",
    policyId: "agent-flow-microvm-hardened-local",
    profile: "hardened",
    isolation: "microvm",
    engines: ["firecracker", "cloud-hypervisor"],
    network: "none",
    readOnlyRootfs: true,
    workspaceMount: false,
    hostDevicePassthrough: false,
    snapshotRestore: false,
    requireGuestTransportAssurance: "guest_vm",
    maxMemoryMiB: 4096,
    maxCpus: 4,
    governance: {
      executesUserCodeDuringPolicyCheck: false,
      allowsNetworkByDefault: false,
      allowsHostPathMounts: false,
      requiresExplicitGuestTransport: true,
      requiresIsolationProof: true,
    },
  });

  await writeJson(imageManifestTemplatePath, {
    format: "agent-flow-builder.vm-image-manifest.v1",
    imageId,
    engine: "firecracker",
    language: "python",
    imagePath: `../images/${imageId}.rootfs.ext4`,
    bootArtifacts: [
      {
        id: "kernel",
        kind: "kernel",
        path: "../images/kernel",
        requiredForBoot: true,
      },
      {
        id: "cloud-init-seed",
        kind: "cloud-init-seed",
        path: "../images/seed.iso",
        requiredForBoot: false,
      },
    ],
    buildManifest: "../vm-image-scaffold.json",
    policyManifest: "microvm.policy.json",
  });

  await writeFile(buildShellPath, buildShellMicrovmPrepareScript(imageId), "utf-8");
  await writeFile(buildPowerShellPath, buildPowerShellMicrovmPrepareScript(imageId), "utf-8");
  await writeFile(preflightFirecrackerShellPath, buildShellMicrovmPreflightScript("firecracker"), "utf-8");
  await writeFile(preflightFirecrackerPowerShellPath, buildPowerShellMicrovmPreflightScript("firecracker"), "utf-8");
  await writeFile(preflightCloudHypervisorShellPath, buildShellMicrovmPreflightScript("cloud-hypervisor"), "utf-8");
  await writeFile(preflightCloudHypervisorPowerShellPath, buildPowerShellMicrovmPreflightScript("cloud-hypervisor"), "utf-8");
  await writeFile(path.join(outDir, "README.md"), buildMicrovmScaffoldReadme(imageId), "utf-8");

  return {
    format: "agent-flow-builder.vm-image-scaffold-result.v1",
    imageId,
    outDir,
    scaffoldManifestPath,
    runnerManifestPath,
    imageManifestTemplatePath,
    guestAgentPath,
    sshTransportPath: "",
    buildShellPath,
    buildPowerShellPath,
    bootShellPath: preflightFirecrackerShellPath,
    bootPowerShellPath: preflightFirecrackerPowerShellPath,
    microvmRunnerPath,
    preflightFirecrackerShellPath,
    preflightFirecrackerPowerShellPath,
    preflightCloudHypervisorShellPath,
    preflightCloudHypervisorPowerShellPath,
    microvmPolicyManifestPath,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function buildCloudInitUserDataTemplate(guestAgentSource: string): string {
  const indentedAgent = guestAgentSource
    .split(/\r?\n/)
    .map((line) => `      ${line}`)
    .join("\n");
  return `#cloud-config
users:
  - name: agentflow
    groups: sudo
    shell: /bin/bash
    sudo: ["ALL=(ALL) NOPASSWD:ALL"]
    ssh_authorized_keys:
      - __SSH_PUBLIC_KEY__
write_files:
  - path: /opt/agent-flow/agent-flow-vm-guest-agent.py
    owner: root:root
    permissions: "0755"
    content: |
${indentedAgent}
runcmd:
  - mkdir -p /opt/agent-flow/workspace
  - chown -R agentflow:agentflow /opt/agent-flow
`;
}

function buildShellBuildScript(imageId: string): string {
  return `#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
: "\${AGENT_FLOW_VM_BASE_IMAGE:?Set AGENT_FLOW_VM_BASE_IMAGE to a local cloud qcow2 image}"
: "\${AGENT_FLOW_VM_SSH_PUBLIC_KEY_PATH:?Set AGENT_FLOW_VM_SSH_PUBLIC_KEY_PATH to a public key file}"
QEMU_IMG="\${QEMU_IMG:-qemu-img}"
CLOUD_LOCALDS="\${CLOUD_LOCALDS:-cloud-localds}"
IMAGE="$ROOT/images/${imageId}.qcow2"
SEED="$ROOT/images/seed.iso"
USER_DATA="$ROOT/cloud-init/user-data"
PUBLIC_KEY=$(cat "$AGENT_FLOW_VM_SSH_PUBLIC_KEY_PATH")
sed "s#__SSH_PUBLIC_KEY__#$PUBLIC_KEY#g" "$ROOT/cloud-init/user-data.template" > "$USER_DATA"
"$QEMU_IMG" create -f qcow2 -F qcow2 -b "$AGENT_FLOW_VM_BASE_IMAGE" "$IMAGE"
"$CLOUD_LOCALDS" "$SEED" "$USER_DATA" "$ROOT/cloud-init/meta-data"
SIZE=$(wc -c < "$IMAGE" | tr -d ' ')
SHA=$(sha256sum "$IMAGE" | awk '{print $1}')
SEED_SIZE=$(wc -c < "$SEED" | tr -d ' ')
SEED_SHA=$(sha256sum "$SEED" | awk '{print $1}')
cat > "$ROOT/manifests/image.manifest.json" <<JSON
{
  "format": "agent-flow-builder.vm-image-manifest.v1",
  "imageId": "${imageId}",
  "engine": "qemu",
  "language": "python",
  "imagePath": "../images/${imageId}.qcow2",
  "sizeBytes": $SIZE,
  "sha256": "$SHA",
  "bootArtifacts": [
    {
      "id": "cloud-init-seed",
      "kind": "cloud-init-seed",
      "path": "../images/seed.iso",
      "requiredForBoot": true,
      "sizeBytes": $SEED_SIZE,
      "sha256": "$SEED_SHA"
    }
  ]
}
JSON
printf '%s\\n' "Built $IMAGE and $SEED"
`;
}

function buildPowerShellBuildScript(imageId: string): string {
  return `$ErrorActionPreference = "Stop"
function Get-AgentFlowSha256([string]$Path) {
  if (Get-Command Get-FileHash -ErrorAction SilentlyContinue) {
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
  }
  $Output = & certutil.exe -hashfile $Path SHA256
  $Hash = ($Output | Where-Object { $_ -match "^[0-9a-fA-F ]+$" } | Select-Object -First 1)
  if (-not $Hash) { throw "Could not calculate SHA256 for $Path" }
  return $Hash.Replace(" ", "").ToLowerInvariant()
}
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $env:AGENT_FLOW_VM_BASE_IMAGE) { throw "Set AGENT_FLOW_VM_BASE_IMAGE to a local cloud qcow2 image" }
if (-not $env:AGENT_FLOW_VM_SSH_PUBLIC_KEY_PATH) { throw "Set AGENT_FLOW_VM_SSH_PUBLIC_KEY_PATH to a public key file" }
$QemuImg = if ($env:QEMU_IMG) { $env:QEMU_IMG } else { "qemu-img" }
$CloudLocalDs = if ($env:CLOUD_LOCALDS) { $env:CLOUD_LOCALDS } else { "cloud-localds" }
$Image = Join-Path $Root "images\\${imageId}.qcow2"
$Seed = Join-Path $Root "images\\seed.iso"
$UserData = Join-Path $Root "cloud-init\\user-data"
$Template = Join-Path $Root "cloud-init\\user-data.template"
$PublicKey = Get-Content -Raw -LiteralPath $env:AGENT_FLOW_VM_SSH_PUBLIC_KEY_PATH
(Get-Content -Raw -LiteralPath $Template).Replace("__SSH_PUBLIC_KEY__", $PublicKey.Trim()) | Set-Content -NoNewline -LiteralPath $UserData
& $QemuImg create -f qcow2 -F qcow2 -b $env:AGENT_FLOW_VM_BASE_IMAGE $Image
& $CloudLocalDs $Seed $UserData (Join-Path $Root "cloud-init\\meta-data")
$Size = (Get-Item -LiteralPath $Image).Length
$Sha = Get-AgentFlowSha256 $Image
$SeedSize = (Get-Item -LiteralPath $Seed).Length
$SeedSha = Get-AgentFlowSha256 $Seed
@"
{
  "format": "agent-flow-builder.vm-image-manifest.v1",
  "imageId": "${imageId}",
  "engine": "qemu",
  "language": "python",
  "imagePath": "../images/${imageId}.qcow2",
  "sizeBytes": $Size,
  "sha256": "$Sha",
  "bootArtifacts": [
    {
      "id": "cloud-init-seed",
      "kind": "cloud-init-seed",
      "path": "../images/seed.iso",
      "requiredForBoot": true,
      "sizeBytes": $SeedSize,
      "sha256": "$SeedSha"
    }
  ]
}
"@ | Set-Content -LiteralPath (Join-Path $Root "manifests\\image.manifest.json")
Write-Output "Built $Image and $Seed"
`;
}

function buildShellBootScript(imageId: string): string {
  return `#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
QEMU_BIN="\${QEMU_BIN:-qemu-system-x86_64}"
SSH_PORT="\${AGENT_FLOW_VM_GUEST_SSH_PORT:-2222}"
SSH_BIND="\${AGENT_FLOW_VM_GUEST_SSH_BIND:-127.0.0.1}"
MACHINE="\${AGENT_FLOW_QEMU_MACHINE:-q35,accel=kvm:tcg}"
NET_DEVICE="\${AGENT_FLOW_QEMU_NET_DEVICE:-virtio-net-pci}"
case "$MACHINE" in
  microvm*)
    exec "$QEMU_BIN" \
      -nodefaults \
      -machine "$MACHINE" \
      -m "\${AGENT_FLOW_QEMU_MEMORY:-1024m}" \
      -smp "\${AGENT_FLOW_QEMU_CPUS:-1}" \
      -drive "file=$ROOT/images/${imageId}.qcow2,format=qcow2,if=none,id=rootfs" \
      -device "virtio-blk-device,drive=rootfs" \
      -drive "file=$ROOT/images/seed.iso,format=raw,if=none,id=seed,media=cdrom" \
      -device "virtio-blk-device,drive=seed" \
      -netdev "user,id=net0,hostfwd=tcp:$SSH_BIND:$SSH_PORT-:22" \
      -device "$NET_DEVICE,netdev=net0" \
      -display none \
      -serial stdio \
      -no-reboot
    ;;
  *)
    exec "$QEMU_BIN" \
      -nodefaults \
      -machine "$MACHINE" \
      -m "\${AGENT_FLOW_QEMU_MEMORY:-1024m}" \
      -smp "\${AGENT_FLOW_QEMU_CPUS:-1}" \
      -drive "file=$ROOT/images/${imageId}.qcow2,format=qcow2,if=virtio" \
      -drive "file=$ROOT/images/seed.iso,format=raw,if=virtio,media=cdrom" \
      -netdev "user,id=net0,hostfwd=tcp:$SSH_BIND:$SSH_PORT-:22" \
      -device "$NET_DEVICE,netdev=net0" \
      -display none \
      -serial stdio \
      -no-reboot
    ;;
esac
`;
}

function buildPowerShellBootScript(imageId: string): string {
  return `$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$QemuBin = if ($env:QEMU_BIN) { $env:QEMU_BIN } else { "qemu-system-x86_64" }
$SshPort = if ($env:AGENT_FLOW_VM_GUEST_SSH_PORT) { $env:AGENT_FLOW_VM_GUEST_SSH_PORT } else { "2222" }
$SshBind = if ($env:AGENT_FLOW_VM_GUEST_SSH_BIND) { $env:AGENT_FLOW_VM_GUEST_SSH_BIND } else { "127.0.0.1" }
$Machine = if ($env:AGENT_FLOW_QEMU_MACHINE) { $env:AGENT_FLOW_QEMU_MACHINE } else { "q35,accel=kvm:tcg" }
$NetDevice = if ($env:AGENT_FLOW_QEMU_NET_DEVICE) { $env:AGENT_FLOW_QEMU_NET_DEVICE } else { "virtio-net-pci" }
$Memory = if ($env:AGENT_FLOW_QEMU_MEMORY) { $env:AGENT_FLOW_QEMU_MEMORY } else { "1024m" }
$Cpus = if ($env:AGENT_FLOW_QEMU_CPUS) { $env:AGENT_FLOW_QEMU_CPUS } else { "1" }
$RootImage = Join-Path $Root "images\\${imageId}.qcow2"
$SeedImage = Join-Path $Root "images\\seed.iso"
if ($Machine.StartsWith("microvm")) {
  & $QemuBin \`
    -nodefaults \`
    -machine $Machine \`
    -m $Memory \`
    -smp $Cpus \`
    -drive "file=$RootImage,format=qcow2,if=none,id=rootfs" \`
    -device "virtio-blk-device,drive=rootfs" \`
    -drive "file=$SeedImage,format=raw,if=none,id=seed,media=cdrom" \`
    -device "virtio-blk-device,drive=seed" \`
    -netdev "user,id=net0,hostfwd=tcp:$SshBind:$SshPort-:22" \`
    -device "$NetDevice,netdev=net0" \`
    -display none \`
    -serial stdio \`
    -no-reboot
} else {
  & $QemuBin \`
    -nodefaults \`
    -machine $Machine \`
    -m $Memory \`
    -smp $Cpus \`
    -drive "file=$RootImage,format=qcow2,if=virtio" \`
    -drive "file=$SeedImage,format=raw,if=virtio,media=cdrom" \`
    -netdev "user,id=net0,hostfwd=tcp:$SshBind:$SshPort-:22" \`
    -device "$NetDevice,netdev=net0" \`
    -display none \`
    -serial stdio \`
    -no-reboot
}
`;
}

function buildScaffoldReadme(imageId: string): string {
  return `# Agent Flow QEMU VM Image Scaffold

This scaffold creates the files needed to build and boot a local QEMU image that contains the Agent Flow guest agent.

## Build

Provide a local cloud qcow2 base image and a public SSH key. No private key or API secret is stored in this scaffold.

\`\`\`bash
export AGENT_FLOW_VM_BASE_IMAGE=/path/to/base-cloud-image.qcow2
export AGENT_FLOW_VM_SSH_PUBLIC_KEY_PATH=$HOME/.ssh/id_ed25519.pub
./scripts/build-image.sh
\`\`\`

PowerShell:

\`\`\`powershell
$env:AGENT_FLOW_VM_BASE_IMAGE="C:\\path\\to\\base-cloud-image.qcow2"
$env:AGENT_FLOW_VM_SSH_PUBLIC_KEY_PATH="$HOME\\.ssh\\id_ed25519.pub"
.\\scripts\\build-image.ps1
\`\`\`

The build script writes \`images/${imageId}.qcow2\`, \`images/seed.iso\` and \`manifests/image.manifest.json\`.

## Boot

\`\`\`bash
./scripts/boot-qemu.sh
\`\`\`

PowerShell:

\`\`\`powershell
.\\scripts\\boot-qemu.ps1
\`\`\`

The boot script forwards guest SSH to \`127.0.0.1:2222\` by default and uses Q35 for generic cloud images. Set \`AGENT_FLOW_VM_GUEST_SSH_BIND=0.0.0.0\` only when the VM runs inside another isolation layer such as a disposable Docker smoke container. The script also has a \`microvm\` branch for images/boot flows that support QEMU's microVM machine type.

## Runner Transport

Configure the QEMU runner to call the guest agent over SSH:

\`\`\`bash
export AGENT_FLOW_CODE_VM_RUNNER=python
export AGENT_FLOW_CODE_VM_ARGS="$PWD/runner-kit/agent-flow-vm-runner-qemu.py"
export AGENT_FLOW_QEMU_GUEST_TRANSPORT_COMMAND=python
export AGENT_FLOW_QEMU_GUEST_TRANSPORT_ARGS="$PWD/runner-kit/agent-flow-vm-transport-ssh.py"
export AGENT_FLOW_QEMU_GUEST_TRANSPORT_ASSURANCE=guest_vm
export AGENT_FLOW_VM_GUEST_SSH_PORT=2222
\`\`\`

Only use \`guest_vm\` after the transport reaches the booted guest. Simulated/local transports are useful for contract tests but do not provide VM isolation.
`;
}

function buildShellMicrovmPrepareScript(imageId: string): string {
  return `#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
: "\${AGENT_FLOW_MICROVM_ROOTFS_IMAGE:?Set AGENT_FLOW_MICROVM_ROOTFS_IMAGE to a local ext4/rootfs image}"
ENGINE="\${AGENT_FLOW_MICROVM_ENGINE:-firecracker}"
case "$ENGINE" in
  firecracker|cloud-hypervisor) ;;
  *) printf '%s\\n' "Unsupported AGENT_FLOW_MICROVM_ENGINE=$ENGINE" >&2; exit 2 ;;
esac
if [ -z "\${AGENT_FLOW_MICROVM_KERNEL_IMAGE:-}" ] && [ -z "\${AGENT_FLOW_MICROVM_FIRMWARE_IMAGE:-}" ]; then
  printf '%s\\n' "Set AGENT_FLOW_MICROVM_KERNEL_IMAGE or AGENT_FLOW_MICROVM_FIRMWARE_IMAGE" >&2
  exit 2
fi
if [ "$ENGINE" = "firecracker" ] && [ -z "\${AGENT_FLOW_MICROVM_KERNEL_IMAGE:-}" ]; then
  printf '%s\\n' "Firecracker requires AGENT_FLOW_MICROVM_KERNEL_IMAGE" >&2
  exit 2
fi
ROOTFS="$ROOT/images/${imageId}.rootfs.ext4"
KERNEL="$ROOT/images/kernel"
FIRMWARE="$ROOT/images/firmware"
SEED="$ROOT/images/seed.iso"
cp "$AGENT_FLOW_MICROVM_ROOTFS_IMAGE" "$ROOTFS"
ROOTFS_SIZE=$(wc -c < "$ROOTFS" | tr -d ' ')
ROOTFS_SHA=$(sha256sum "$ROOTFS" | awk '{print $1}')
BOOT_ARTIFACTS=""
append_artifact() {
  if [ -n "$BOOT_ARTIFACTS" ]; then
    BOOT_ARTIFACTS="$BOOT_ARTIFACTS,"
  fi
  BOOT_ARTIFACTS="$BOOT_ARTIFACTS
    {
      \\"id\\": \\"$1\\",
      \\"kind\\": \\"$2\\",
      \\"path\\": \\"$3\\",
      \\"requiredForBoot\\": $4,
      \\"sizeBytes\\": $5,
      \\"sha256\\": \\"$6\\"
    }"
}
if [ -n "\${AGENT_FLOW_MICROVM_KERNEL_IMAGE:-}" ]; then
  cp "$AGENT_FLOW_MICROVM_KERNEL_IMAGE" "$KERNEL"
  KERNEL_SIZE=$(wc -c < "$KERNEL" | tr -d ' ')
  KERNEL_SHA=$(sha256sum "$KERNEL" | awk '{print $1}')
  append_artifact "kernel" "kernel" "../images/kernel" "true" "$KERNEL_SIZE" "$KERNEL_SHA"
fi
if [ -n "\${AGENT_FLOW_MICROVM_FIRMWARE_IMAGE:-}" ]; then
  cp "$AGENT_FLOW_MICROVM_FIRMWARE_IMAGE" "$FIRMWARE"
  FIRMWARE_SIZE=$(wc -c < "$FIRMWARE" | tr -d ' ')
  FIRMWARE_SHA=$(sha256sum "$FIRMWARE" | awk '{print $1}')
  append_artifact "firmware" "firmware" "../images/firmware" "true" "$FIRMWARE_SIZE" "$FIRMWARE_SHA"
fi
if [ -n "\${AGENT_FLOW_MICROVM_SEED_IMAGE:-}" ]; then
  cp "$AGENT_FLOW_MICROVM_SEED_IMAGE" "$SEED"
  SEED_SIZE=$(wc -c < "$SEED" | tr -d ' ')
  SEED_SHA=$(sha256sum "$SEED" | awk '{print $1}')
  append_artifact "cloud-init-seed" "cloud-init-seed" "../images/seed.iso" "false" "$SEED_SIZE" "$SEED_SHA"
fi
cat > "$ROOT/manifests/image.manifest.json" <<JSON
{
  "format": "agent-flow-builder.vm-image-manifest.v1",
  "imageId": "${imageId}",
  "engine": "$ENGINE",
  "language": "python",
  "imagePath": "../images/${imageId}.rootfs.ext4",
  "sizeBytes": $ROOTFS_SIZE,
  "sha256": "$ROOTFS_SHA",
  "policyManifest": "microvm.policy.json",
  "bootArtifacts": [
$BOOT_ARTIFACTS
  ]
}
JSON
printf '%s\\n' "Prepared $ROOTFS and manifests/image.manifest.json"
`;
}

function buildPowerShellMicrovmPrepareScript(imageId: string): string {
  return `$ErrorActionPreference = "Stop"
function Get-AgentFlowSha256([string]$Path) {
  if (Get-Command Get-FileHash -ErrorAction SilentlyContinue) {
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
  }
  $Output = & certutil.exe -hashfile $Path SHA256
  $Hash = ($Output | Where-Object { $_ -match "^[0-9a-fA-F ]+$" } | Select-Object -First 1)
  if (-not $Hash) { throw "Could not calculate SHA256 for $Path" }
  return $Hash.Replace(" ", "").ToLowerInvariant()
}
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $env:AGENT_FLOW_MICROVM_ROOTFS_IMAGE) { throw "Set AGENT_FLOW_MICROVM_ROOTFS_IMAGE to a local ext4/rootfs image" }
$Engine = if ($env:AGENT_FLOW_MICROVM_ENGINE) { $env:AGENT_FLOW_MICROVM_ENGINE } else { "firecracker" }
if ($Engine -notin @("firecracker", "cloud-hypervisor")) { throw "Unsupported AGENT_FLOW_MICROVM_ENGINE=$Engine" }
if (-not $env:AGENT_FLOW_MICROVM_KERNEL_IMAGE -and -not $env:AGENT_FLOW_MICROVM_FIRMWARE_IMAGE) { throw "Set AGENT_FLOW_MICROVM_KERNEL_IMAGE or AGENT_FLOW_MICROVM_FIRMWARE_IMAGE" }
if ($Engine -eq "firecracker" -and -not $env:AGENT_FLOW_MICROVM_KERNEL_IMAGE) { throw "Firecracker requires AGENT_FLOW_MICROVM_KERNEL_IMAGE" }
$Rootfs = Join-Path $Root "images\\${imageId}.rootfs.ext4"
$Kernel = Join-Path $Root "images\\kernel"
$Firmware = Join-Path $Root "images\\firmware"
$Seed = Join-Path $Root "images\\seed.iso"
Copy-Item -LiteralPath $env:AGENT_FLOW_MICROVM_ROOTFS_IMAGE -Destination $Rootfs -Force
$RootfsSize = (Get-Item -LiteralPath $Rootfs).Length
$RootfsSha = Get-AgentFlowSha256 $Rootfs
$BootArtifacts = @()
if ($env:AGENT_FLOW_MICROVM_KERNEL_IMAGE) {
  Copy-Item -LiteralPath $env:AGENT_FLOW_MICROVM_KERNEL_IMAGE -Destination $Kernel -Force
  $KernelSize = (Get-Item -LiteralPath $Kernel).Length
  $KernelSha = Get-AgentFlowSha256 $Kernel
  $BootArtifacts += @{
    id = "kernel"
    kind = "kernel"
    path = "../images/kernel"
    requiredForBoot = $true
    sizeBytes = $KernelSize
    sha256 = $KernelSha
  }
}
if ($env:AGENT_FLOW_MICROVM_FIRMWARE_IMAGE) {
  Copy-Item -LiteralPath $env:AGENT_FLOW_MICROVM_FIRMWARE_IMAGE -Destination $Firmware -Force
  $FirmwareSize = (Get-Item -LiteralPath $Firmware).Length
  $FirmwareSha = Get-AgentFlowSha256 $Firmware
  $BootArtifacts += @{
    id = "firmware"
    kind = "firmware"
    path = "../images/firmware"
    requiredForBoot = $true
    sizeBytes = $FirmwareSize
    sha256 = $FirmwareSha
  }
}
if ($env:AGENT_FLOW_MICROVM_SEED_IMAGE) {
  Copy-Item -LiteralPath $env:AGENT_FLOW_MICROVM_SEED_IMAGE -Destination $Seed -Force
  $SeedSize = (Get-Item -LiteralPath $Seed).Length
  $SeedSha = Get-AgentFlowSha256 $Seed
  $BootArtifacts += @{
    id = "cloud-init-seed"
    kind = "cloud-init-seed"
    path = "../images/seed.iso"
    requiredForBoot = $false
    sizeBytes = $SeedSize
    sha256 = $SeedSha
  }
}
$Manifest = @{
  format = "agent-flow-builder.vm-image-manifest.v1"
  imageId = "${imageId}"
  engine = $Engine
  language = "python"
  imagePath = "../images/${imageId}.rootfs.ext4"
  sizeBytes = $RootfsSize
  sha256 = $RootfsSha
  policyManifest = "microvm.policy.json"
  bootArtifacts = $BootArtifacts
}
$Manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $Root "manifests\\image.manifest.json")
Write-Output "Prepared $Rootfs and manifests\\image.manifest.json"
`;
}

function buildShellMicrovmPreflightScript(engine: "firecracker" | "cloud-hypervisor"): string {
  const binaryEnv = engine === "firecracker" ? "AGENT_FLOW_FIRECRACKER_BINARY" : "AGENT_FLOW_CLOUD_HYPERVISOR_BINARY";
  const binaryDefault = engine === "firecracker" ? "firecracker" : "cloud-hypervisor";
  const binaryField = engine === "firecracker" ? "firecrackerBinary" : "cloudHypervisorBinary";
  return `#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PYTHON_BIN="\${AGENT_FLOW_VM_PYTHON_BINARY:-python}"
MICROVM_BIN="\${${binaryEnv}:-${binaryDefault}}"
"$PYTHON_BIN" "$ROOT/runner-kit/agent-flow-vm-runner-microvm.py" --preflight <<JSON
{
  "protocol": "agent-flow-vm-runner.v1",
  "workspace": "$ROOT",
  "vm": {
    "engine": "${engine}",
    "${binaryField}": "$MICROVM_BIN",
    "image_manifest": "manifests/image.manifest.json",
    "policy_manifest": "manifests/microvm.policy.json"
  }
}
JSON
`;
}

function buildPowerShellMicrovmPreflightScript(engine: "firecracker" | "cloud-hypervisor"): string {
  const binaryEnv = engine === "firecracker" ? "AGENT_FLOW_FIRECRACKER_BINARY" : "AGENT_FLOW_CLOUD_HYPERVISOR_BINARY";
  const binaryDefault = engine === "firecracker" ? "firecracker" : "cloud-hypervisor";
  const binaryField = engine === "firecracker" ? "firecrackerBinary" : "cloudHypervisorBinary";
  return `$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$PythonBin = if ($env:AGENT_FLOW_VM_PYTHON_BINARY) { $env:AGENT_FLOW_VM_PYTHON_BINARY } else { "python" }
$MicrovmBin = if ($env:${binaryEnv}) { $env:${binaryEnv} } else { "${binaryDefault}" }
$Request = @{
  protocol = "agent-flow-vm-runner.v1"
  workspace = $Root.Path
  vm = @{
    engine = "${engine}"
    ${binaryField} = $MicrovmBin
    image_manifest = "manifests/image.manifest.json"
    policy_manifest = "manifests/microvm.policy.json"
  }
} | ConvertTo-Json -Depth 8
$Request | & $PythonBin (Join-Path $Root "runner-kit\\agent-flow-vm-runner-microvm.py") --preflight
`;
}

function buildMicrovmScaffoldReadme(imageId: string): string {
  return `# Agent Flow Firecracker/Cloud Hypervisor Image Scaffold

This scaffold prepares a direct-kernel microVM image bundle for the Agent Flow VM runner contract. It does not download binaries, boot a VM or store secrets.

## Prepare Files

Provide a local rootfs image and either a direct-boot kernel or firmware artifact. Firecracker requires a kernel; Cloud Hypervisor can use a kernel or firmware depending on the image profile. The rootfs must already contain \`guest/agent-flow-vm-guest-agent.py\` or an equivalent service that can receive the contract through your transport.

\`\`\`bash
export AGENT_FLOW_MICROVM_ENGINE=firecracker # or cloud-hypervisor
export AGENT_FLOW_MICROVM_ROOTFS_IMAGE=/path/to/rootfs.ext4
export AGENT_FLOW_MICROVM_KERNEL_IMAGE=/path/to/vmlinux
export AGENT_FLOW_MICROVM_FIRMWARE_IMAGE=/path/to/firmware # optional, mainly for cloud-hypervisor
export AGENT_FLOW_MICROVM_SEED_IMAGE=/path/to/seed.iso # optional
./scripts/prepare-direct-kernel-image.sh
\`\`\`

PowerShell:

\`\`\`powershell
$env:AGENT_FLOW_MICROVM_ENGINE="firecracker"
$env:AGENT_FLOW_MICROVM_ROOTFS_IMAGE="C:\\path\\to\\rootfs.ext4"
$env:AGENT_FLOW_MICROVM_KERNEL_IMAGE="C:\\path\\to\\vmlinux"
$env:AGENT_FLOW_MICROVM_FIRMWARE_IMAGE="C:\\path\\to\\firmware"
$env:AGENT_FLOW_MICROVM_SEED_IMAGE="C:\\path\\to\\seed.iso"
.\\scripts\\prepare-direct-kernel-image.ps1
\`\`\`

The prepare script writes \`images/${imageId}.rootfs.ext4\`, \`images/kernel\`, optional \`images/seed.iso\` and \`manifests/image.manifest.json\` with size and SHA-256 for every file. The scaffold also includes \`manifests/microvm.policy.json\`, a hardened local policy that requires network none, read-only rootfs launch plans, no workspace mounts, no host device passthrough and guest transport assurance \`guest_vm\` for real execution.

## Preflight

\`\`\`bash
./scripts/preflight-firecracker.sh
./scripts/preflight-cloud-hypervisor.sh
\`\`\`

PowerShell:

\`\`\`powershell
.\\scripts\\preflight-firecracker.ps1
.\\scripts\\preflight-cloud-hypervisor.ps1
\`\`\`

Set \`AGENT_FLOW_FIRECRACKER_BINARY\` or \`AGENT_FLOW_CLOUD_HYPERVISOR_BINARY\` if the binaries are not on PATH. Preflight validates the binary, rootfs, kernel/seed artifacts and launch plan without executing user code.

## Runner Transport

Normal execution still requires a host/guest transport that reaches the guest agent:

\`\`\`bash
export AGENT_FLOW_CODE_VM_RUNNER=python
export AGENT_FLOW_CODE_VM_ARGS="$PWD/runner-kit/agent-flow-vm-runner-microvm.py"
export AGENT_FLOW_CODE_VM_ENGINE=firecracker
export AGENT_FLOW_MICROVM_GUEST_TRANSPORT_COMMAND="your-vsock-or-ssh-client"
export AGENT_FLOW_MICROVM_GUEST_TRANSPORT_ARGS="..."
export AGENT_FLOW_MICROVM_GUEST_TRANSPORT_ASSURANCE=guest_vm
\`\`\`

Only use \`guest_vm\` after the transport reaches the booted guest. Simulated/local transports are useful for contract tests but do not provide VM isolation.
`;
}

function guestAgentSourcePath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../tools/agent-flow-vm-guest-agent.py");
}

function sshTransportSourcePath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../tools/agent-flow-vm-transport-ssh.py");
}

function qemuRunnerSourcePath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../tools/agent-flow-vm-runner-qemu.py");
}

function microvmRunnerSourcePath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../tools/agent-flow-vm-runner-microvm.py");
}

function sanitizeSegment(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "agent-flow-python-qemu";
}
