#!/usr/bin/env python3
"""Firecracker/Cloud Hypervisor preflight for the Agent Flow VM contract.

This runner validates a direct-kernel microVM launch plan without booting the
guest or executing user code. Normal execution still requires an explicit
host/guest transport command that reaches the guest agent embedded in the image.
"""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
import shutil
import shlex
import subprocess
import sys
import traceback
from typing import Any


SUPPORTED_ENGINES = {"firecracker", "cloud-hypervisor"}


def main() -> int:
    try:
        request = json.loads(sys.stdin.read() or "{}")
        if "--preflight" in sys.argv[1:]:
            result = preflight(request)
        else:
            result = execute_with_transport(request)
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result.get("ok") else 1
    except Exception as exc:  # pragma: no cover - defensive process boundary
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": str(exc),
                    "traceback": traceback.format_exc(),
                    "runner": "agent-flow-vm-runner-microvm",
                },
                ensure_ascii=False,
            )
        )
        return 1


def preflight(request: dict[str, Any]) -> dict[str, Any]:
    if request.get("protocol") != "agent-flow-vm-runner.v1":
        return {
            "ok": False,
            "error": "unsupported_protocol",
            "expectedProtocol": "agent-flow-vm-runner.v1",
            "receivedProtocol": request.get("protocol"),
            "executesUserCode": False,
        }

    vm = request.get("vm") if isinstance(request.get("vm"), dict) else {}
    workspace = pathlib.Path(str(request.get("workspace") or os.getcwd())).resolve()
    engine = read_string(vm.get("engine") or os.environ.get("AGENT_FLOW_CODE_VM_ENGINE") or "firecracker").lower()
    if engine not in SUPPORTED_ENGINES:
        return {
            "ok": False,
            "error": f"unsupported_engine:{engine}",
            "supportedEngines": sorted(SUPPORTED_ENGINES),
            "executesUserCode": False,
        }

    binary_value = microvm_binary_value(vm, engine)
    binary_path = resolve_command(binary_value)
    if not binary_path:
        return {
            "ok": False,
            "error": f"{engine}_binary_not_found",
            "binary": {"value": binary_value, "resolved": False, "path": None},
            "executesUserCode": False,
        }

    image_manifest_value = read_string(
        vm.get("image_manifest")
        or vm.get("imageManifest")
        or os.environ.get("AGENT_FLOW_CODE_VM_IMAGE_MANIFEST")
        or ""
    )
    image_value = read_string(vm.get("image") or os.environ.get("AGENT_FLOW_CODE_VM_IMAGE") or "")
    image_manifest = load_image_manifest(image_manifest_value, workspace) if image_manifest_value else {}
    policy_manifest_value = read_string(
        vm.get("policy_manifest")
        or vm.get("policyManifest")
        or image_manifest.get("policyManifest")
        or os.environ.get("AGENT_FLOW_MICROVM_POLICY_MANIFEST")
        or ""
    )
    policy_manifest = load_policy_manifest(policy_manifest_value, pathlib.Path(str(image_manifest.get("_manifest_dir") or workspace)).resolve(), workspace) if policy_manifest_value else {}
    image_path_value = image_value or read_string(image_manifest.get("imagePath"))
    image_base = pathlib.Path(str(image_manifest.get("_manifest_dir") or workspace)).resolve()
    image_path = resolve_local_path(image_path_value, image_base, workspace) if image_path_value else None
    if not image_path or not image_path.is_file():
        return {
            "ok": False,
            "error": "microvm_image_not_found",
            "image": {"value": image_path_value, "resolved": False, "path": str(image_path) if image_path else None},
            "executesUserCode": False,
        }

    image_size = image_path.stat().st_size
    image_sha256 = sha256_file(image_path)
    declared_size = image_manifest.get("sizeBytes")
    declared_sha256 = read_string(image_manifest.get("sha256")).lower()
    if isinstance(declared_size, int) and declared_size > 0 and declared_size != image_size:
        return {
            "ok": False,
            "error": "microvm_image_size_mismatch",
            "expectedSizeBytes": declared_size,
            "actualSizeBytes": image_size,
            "executesUserCode": False,
        }
    if declared_sha256 and declared_sha256 != image_sha256:
        return {
            "ok": False,
            "error": "microvm_image_sha256_mismatch",
            "expectedSha256": declared_sha256,
            "actualSha256": image_sha256,
            "executesUserCode": False,
        }

    boot_artifacts, boot_artifact_error = resolve_boot_artifacts(vm, image_manifest, image_base, workspace)
    if boot_artifact_error:
        return boot_artifact_error

    kernel_artifact = first_artifact(boot_artifacts, {"kernel", "linux-kernel", "pvh-kernel", "vmlinux"})
    firmware_artifact = first_artifact(boot_artifacts, {"firmware", "hypervisor-firmware"})
    initrd_artifact = first_artifact(boot_artifacts, {"initrd", "initramfs"})
    seed_artifact = first_artifact(boot_artifacts, {"cloud-init-seed"})

    if engine == "firecracker" and not kernel_artifact:
        return {
            "ok": False,
            "error": "microvm_kernel_artifact_required",
            "engine": engine,
            "requiredKind": "kernel",
            "executesUserCode": False,
        }
    if engine == "cloud-hypervisor" and not kernel_artifact and not firmware_artifact:
        return {
            "ok": False,
            "error": "microvm_kernel_or_firmware_artifact_required",
            "engine": engine,
            "requiredKinds": ["kernel", "firmware"],
            "executesUserCode": False,
        }

    memory = read_string(vm.get("memory") or os.environ.get("AGENT_FLOW_MICROVM_MEMORY") or "1024M")
    cpus = read_string(vm.get("cpus") or os.environ.get("AGENT_FLOW_MICROVM_CPUS") or "1")
    memory_mib = parse_memory_mib(memory)
    cpu_count = parse_int(cpus) or 1
    policy, policy_error = normalize_microvm_policy(vm, policy_manifest, memory_mib, cpu_count)
    if policy_error:
        return policy_error
    kernel_args = read_string(
        vm.get("kernelArgs")
        or vm.get("kernel_args")
        or os.environ.get("AGENT_FLOW_MICROVM_KERNEL_ARGS")
        or default_kernel_args(engine, firmware_artifact is not None)
    )
    api_socket = read_string(
        vm.get("apiSocket")
        or vm.get("api_socket")
        or os.environ.get("AGENT_FLOW_MICROVM_API_SOCKET")
        or str(workspace / f"agent-flow-{engine}.sock")
    )

    if engine == "firecracker":
        planned_config_path = read_string(vm.get("configPath") or os.environ.get("AGENT_FLOW_FIRECRACKER_CONFIG_PATH") or str(workspace / "firecracker-config.json"))
        planned_config = build_firecracker_config(
            image_path=image_path,
            kernel_path=pathlib.Path(str(kernel_artifact["path"])),
            initrd_path=pathlib.Path(str(initrd_artifact["path"])) if initrd_artifact else None,
            seed_path=pathlib.Path(str(seed_artifact["path"])) if seed_artifact else None,
            kernel_args=kernel_args,
            memory_mib=memory_mib,
            cpu_count=cpu_count,
            read_only_rootfs=bool(policy["readOnlyRootfs"]),
        )
        planned_command = [str(binary_path), "--api-sock", api_socket, "--config-file", planned_config_path]
        engine_plan = {
            "configPath": planned_config_path,
            "plannedConfig": planned_config,
            "writesConfigFile": False,
        }
    else:
        planned_command = build_cloud_hypervisor_command(
            binary_path=binary_path,
            image_path=image_path,
            kernel_path=pathlib.Path(str(kernel_artifact["path"])) if kernel_artifact else None,
            firmware_path=pathlib.Path(str(firmware_artifact["path"])) if firmware_artifact else None,
            initrd_path=pathlib.Path(str(initrd_artifact["path"])) if initrd_artifact else None,
            seed_path=pathlib.Path(str(seed_artifact["path"])) if seed_artifact else None,
            kernel_args=kernel_args,
            memory_mib=memory_mib,
            cpu_count=cpu_count,
            api_socket=api_socket,
            read_only_rootfs=bool(policy["readOnlyRootfs"]),
        )
        engine_plan = {"apiSocket": api_socket}

    return {
        "ok": True,
        "format": "agent-flow-vm-runner-microvm-preflight.v1",
        "runner": "agent-flow-vm-runner-microvm",
        "protocol": "agent-flow-vm-runner.v1",
        "engine": engine,
        "providesVmIsolation": True,
        "contractExecutionImplemented": False,
        "supportsExternalGuestTransport": True,
        "requiresGuestAgent": True,
        "executesUserCode": False,
        "binary": {"value": binary_value, "resolved": True, "path": str(binary_path)},
        "image": {
            "value": image_path_value,
            "resolved": True,
            "path": str(image_path),
            "sizeBytes": image_size,
            "sha256": image_sha256,
            "sha256Verified": bool(declared_sha256) and declared_sha256 == image_sha256,
        },
        "bootArtifacts": boot_artifacts,
        "policy": {
            "profile": policy["profile"],
            "memory": f"{memory_mib}M",
            "cpus": str(cpu_count),
            "kernelArgs": kernel_args,
            "network": policy["network"],
            "readOnlyRootfs": policy["readOnlyRootfs"],
            "workspaceMount": policy["workspaceMount"],
            "hostDevicePassthrough": policy["hostDevicePassthrough"],
            "snapshotRestore": policy["snapshotRestore"],
            "guestTransportAssuranceRequired": policy["requireGuestTransportAssurance"],
            "maxMemoryMiB": policy["maxMemoryMiB"],
            "maxCpus": policy["maxCpus"],
            "policyManifest": policy.get("policyManifest"),
            "apiSocket": api_socket,
        },
        "enginePlan": engine_plan,
        "plannedCommand": planned_command,
    }


def execute_with_transport(request: dict[str, Any]) -> dict[str, Any]:
    preflight_result = preflight(request)
    if not preflight_result.get("ok"):
        result = dict(preflight_result)
        result["executesUserCode"] = False
        return result

    vm = request.get("vm") if isinstance(request.get("vm"), dict) else {}
    transport = resolve_guest_transport(vm)
    if not transport:
        return {
            "ok": False,
            "error": "microvm_guest_transport_not_configured",
            "runner": "agent-flow-vm-runner-microvm",
            "protocol": "agent-flow-vm-runner.v1",
            "engine": preflight_result.get("engine"),
            "requiresGuestAgent": True,
            "supportsExternalGuestTransport": True,
            "executesUserCode": False,
            "message": "Set vm.guestTransportCommand or AGENT_FLOW_MICROVM_GUEST_TRANSPORT_COMMAND to a command that reaches the guest agent.",
        }

    command_path = resolve_command(transport["command"])
    if not command_path:
        return {
            "ok": False,
            "error": "microvm_guest_transport_command_not_found",
            "runner": "agent-flow-vm-runner-microvm",
            "transport": {
                "kind": "external_command",
                "command": transport["command"],
                "resolved": False,
            },
            "requiresGuestAgent": True,
            "executesUserCode": False,
        }

    timeout_seconds = read_positive_number(vm.get("guestTransportTimeoutSeconds")) or read_positive_number(
        os.environ.get("AGENT_FLOW_MICROVM_GUEST_TRANSPORT_TIMEOUT_SECONDS")
    ) or 30.0
    transport_assurance = read_string(
        vm.get("guestTransportAssurance") or os.environ.get("AGENT_FLOW_MICROVM_GUEST_TRANSPORT_ASSURANCE") or "operator_configured"
    )
    preflight_policy = preflight_result.get("policy") if isinstance(preflight_result.get("policy"), dict) else {}
    required_transport_assurance = read_string(preflight_policy.get("guestTransportAssuranceRequired") if isinstance(preflight_policy, dict) else "")
    if required_transport_assurance and transport_assurance != required_transport_assurance:
        return {
            "ok": False,
            "error": "microvm_guest_transport_assurance_too_weak",
            "runner": "agent-flow-vm-runner-microvm",
            "engine": preflight_result.get("engine"),
            "requiredAssurance": required_transport_assurance,
            "actualAssurance": transport_assurance,
            "requiresGuestAgent": True,
            "executesUserCode": False,
        }
    command = [str(command_path), *transport["args"]]
    try:
        completed = subprocess.run(
            command,
            input=json.dumps(request, ensure_ascii=False),
            text=True,
            capture_output=True,
            timeout=timeout_seconds,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return {
            "ok": False,
            "error": "microvm_guest_transport_timeout",
            "runner": "agent-flow-vm-runner-microvm",
            "engine": preflight_result.get("engine"),
            "transport": {
                "kind": "external_command",
                "command": transport["command"],
                "argsCount": len(transport["args"]),
                "assurance": transport_assurance,
                "timeoutSeconds": timeout_seconds,
            },
            "requiresGuestAgent": True,
            "executesUserCode": True,
        }

    if not completed.stdout:
        return {
            "ok": False,
            "error": "microvm_guest_transport_empty_stdout",
            "runner": "agent-flow-vm-runner-microvm",
            "engine": preflight_result.get("engine"),
            "returnCode": completed.returncode,
            "stderrPreview": (completed.stderr or "")[:1000],
            "requiresGuestAgent": True,
            "executesUserCode": True,
        }

    try:
        guest_result = json.loads(completed.stdout)
    except json.JSONDecodeError:
        return {
            "ok": False,
            "error": "microvm_guest_transport_invalid_json",
            "runner": "agent-flow-vm-runner-microvm",
            "engine": preflight_result.get("engine"),
            "returnCode": completed.returncode,
            "stdoutPreview": (completed.stdout or "")[:1000],
            "stderrPreview": (completed.stderr or "")[:1000],
            "requiresGuestAgent": True,
            "executesUserCode": True,
        }

    if not isinstance(guest_result, dict):
        return {
            "ok": False,
            "error": "microvm_guest_transport_non_object_result",
            "runner": "agent-flow-vm-runner-microvm",
            "engine": preflight_result.get("engine"),
            "returnCode": completed.returncode,
            "requiresGuestAgent": True,
            "executesUserCode": True,
        }

    provides_vm_isolation = transport_assurance == "guest_vm"
    return {
        **guest_result,
        "ok": bool(guest_result.get("ok")) and completed.returncode == 0,
        "runner": "agent-flow-vm-runner-microvm",
        "protocol": "agent-flow-vm-runner.v1",
        "engine": preflight_result.get("engine"),
        "contractExecutionImplemented": True,
        "supportsExternalGuestTransport": True,
        "requiresGuestAgent": True,
        "executesUserCode": True,
        "providesVmIsolation": provides_vm_isolation,
        "microvmPreflightProvidesVmIsolation": preflight_result.get("providesVmIsolation") is True,
        "guestAgentRunner": guest_result.get("runner"),
        "guestAgentProtocol": guest_result.get("guestAgentProtocol"),
        "transport": {
            "kind": "external_command",
            "command": transport["command"],
            "argsCount": len(transport["args"]),
            "resolved": True,
            "assurance": transport_assurance,
            "timeoutSeconds": timeout_seconds,
        },
        "microvmPreflight": {
            "ok": True,
            "format": preflight_result.get("format"),
            "engine": preflight_result.get("engine"),
            "image": preflight_result.get("image"),
            "policy": preflight_result.get("policy"),
        },
    }


def build_firecracker_config(
    *,
    image_path: pathlib.Path,
    kernel_path: pathlib.Path,
    initrd_path: pathlib.Path | None,
    seed_path: pathlib.Path | None,
    kernel_args: str,
    memory_mib: int,
    cpu_count: int,
    read_only_rootfs: bool,
) -> dict[str, Any]:
    boot_source: dict[str, Any] = {
        "kernel_image_path": str(kernel_path),
        "boot_args": kernel_args,
    }
    if initrd_path:
        boot_source["initrd_path"] = str(initrd_path)
    drives = [
        {
            "drive_id": "rootfs",
            "path_on_host": str(image_path),
            "is_root_device": True,
            "is_read_only": read_only_rootfs,
        }
    ]
    if seed_path:
        drives.append(
            {
                "drive_id": "cloudinit",
                "path_on_host": str(seed_path),
                "is_root_device": False,
                "is_read_only": True,
            }
        )
    return {
        "boot-source": boot_source,
        "drives": drives,
        "machine-config": {
            "vcpu_count": cpu_count,
            "mem_size_mib": memory_mib,
            "smt": False,
            "track_dirty_pages": False,
        },
    }


def build_cloud_hypervisor_command(
    *,
    binary_path: pathlib.Path,
    image_path: pathlib.Path,
    kernel_path: pathlib.Path | None,
    firmware_path: pathlib.Path | None,
    initrd_path: pathlib.Path | None,
    seed_path: pathlib.Path | None,
    kernel_args: str,
    memory_mib: int,
    cpu_count: int,
    api_socket: str,
    read_only_rootfs: bool,
) -> list[str]:
    command = [str(binary_path)]
    if firmware_path:
        command.extend(["--firmware", str(firmware_path)])
    elif kernel_path:
        command.extend(["--kernel", str(kernel_path)])
        if kernel_args:
            command.extend(["--cmdline", kernel_args])
    if initrd_path:
        command.extend(["--initramfs", str(initrd_path)])
    root_disk = f"path={image_path}"
    if read_only_rootfs:
        root_disk = f"{root_disk},readonly=on"
    command.extend(["--disk", root_disk])
    if seed_path:
        command.extend(["--disk", f"path={seed_path},readonly=on"])
    command.extend(
        [
            "--cpus",
            f"boot={cpu_count}",
            "--memory",
            f"size={memory_mib}M",
            "--console",
            "off",
            "--serial",
            "tty",
            "--api-socket",
            f"path={api_socket}",
        ]
    )
    return command


def resolve_boot_artifacts(
    vm: dict[str, Any],
    image_manifest: dict[str, Any],
    image_base: pathlib.Path,
    workspace: pathlib.Path,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    candidates: list[tuple[dict[str, Any], pathlib.Path]] = []
    manifest_artifacts = image_manifest.get("bootArtifacts")
    if isinstance(manifest_artifacts, list):
        for item in manifest_artifacts:
            if isinstance(item, dict):
                candidates.append((item, image_base))

    vm_artifacts = vm.get("bootArtifacts")
    if isinstance(vm_artifacts, list):
        for item in vm_artifacts:
            if isinstance(item, dict):
                candidates.append((item, workspace))

    for item in parse_boot_artifacts_env(os.environ.get("AGENT_FLOW_CODE_VM_BOOT_ARTIFACTS")):
        candidates.append((item, workspace))

    kernel_image = read_string(vm.get("kernelImage") or vm.get("kernel_image") or os.environ.get("AGENT_FLOW_MICROVM_KERNEL_IMAGE") or "")
    if kernel_image and not any(read_string(item.get("kind")).lower() in {"kernel", "linux-kernel", "pvh-kernel", "vmlinux"} for item, _root in candidates):
        candidates.append(({"id": "kernel", "kind": "kernel", "path": kernel_image, "requiredForBoot": True}, workspace))

    firmware_image = read_string(vm.get("firmwareImage") or vm.get("firmware_image") or os.environ.get("AGENT_FLOW_MICROVM_FIRMWARE_IMAGE") or "")
    if firmware_image and not any(read_string(item.get("kind")).lower() in {"firmware", "hypervisor-firmware"} for item, _root in candidates):
        candidates.append(({"id": "firmware", "kind": "firmware", "path": firmware_image, "requiredForBoot": True}, workspace))

    seed_image = read_string(vm.get("seedImage") or vm.get("seed_image") or os.environ.get("AGENT_FLOW_CODE_VM_SEED_IMAGE") or "")
    if seed_image and not any(read_string(item.get("kind")).lower() == "cloud-init-seed" for item, _root in candidates):
        candidates.append(({"id": "cloud-init-seed", "kind": "cloud-init-seed", "path": seed_image, "requiredForBoot": False}, workspace))

    resolved: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for index, (artifact, root) in enumerate(candidates):
        artifact_id = read_string(artifact.get("id")) or f"boot-artifact-{index + 1}"
        kind = (read_string(artifact.get("kind")) or "auxiliary").lower()
        artifact_path_value = read_string(artifact.get("path"))
        required_for_boot = artifact.get("requiredForBoot") is True
        if not artifact_path_value:
            return [], {
                "ok": False,
                "error": "microvm_boot_artifact_path_missing",
                "artifactId": artifact_id,
                "executesUserCode": False,
            }
        artifact_path = resolve_local_path(artifact_path_value, root, workspace)
        if not artifact_path or not artifact_path.is_file():
            return [], {
                "ok": False,
                "error": "microvm_boot_artifact_not_found",
                "artifactId": artifact_id,
                "kind": kind,
                "path": artifact_path_value,
                "requiredForBoot": required_for_boot,
                "executesUserCode": False,
            }
        key = (artifact_id, kind, str(artifact_path))
        if key in seen:
            continue
        seen.add(key)
        artifact_size = artifact_path.stat().st_size
        artifact_sha256 = sha256_file(artifact_path)
        declared_size = artifact.get("sizeBytes")
        declared_sha256 = read_string(artifact.get("sha256")).lower()
        if isinstance(declared_size, int) and declared_size > 0 and declared_size != artifact_size:
            return [], {
                "ok": False,
                "error": "microvm_boot_artifact_size_mismatch",
                "artifactId": artifact_id,
                "kind": kind,
                "expectedSizeBytes": declared_size,
                "actualSizeBytes": artifact_size,
                "executesUserCode": False,
            }
        if declared_sha256 and declared_sha256 != artifact_sha256:
            return [], {
                "ok": False,
                "error": "microvm_boot_artifact_sha256_mismatch",
                "artifactId": artifact_id,
                "kind": kind,
                "expectedSha256": declared_sha256,
                "actualSha256": artifact_sha256,
                "executesUserCode": False,
            }
        resolved.append(
            {
                "id": artifact_id,
                "kind": kind,
                "path": str(artifact_path),
                "requiredForBoot": required_for_boot,
                "sizeBytes": artifact_size,
                "sha256": artifact_sha256,
                "sha256Verified": bool(declared_sha256) and declared_sha256 == artifact_sha256,
            }
        )

    return resolved, None


def first_artifact(artifacts: list[dict[str, Any]], kinds: set[str]) -> dict[str, Any] | None:
    return next((artifact for artifact in artifacts if read_string(artifact.get("kind")).lower() in kinds), None)


def parse_boot_artifacts_env(value: str | None) -> list[dict[str, Any]]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [item for item in parsed if isinstance(item, dict)]


def resolve_guest_transport(vm: dict[str, Any]) -> dict[str, Any] | None:
    command = read_string(vm.get("guestTransportCommand") or os.environ.get("AGENT_FLOW_MICROVM_GUEST_TRANSPORT_COMMAND") or "")
    args = read_string_array(vm.get("guestTransportArgs"))
    if not args:
        args = parse_args_env(os.environ.get("AGENT_FLOW_MICROVM_GUEST_TRANSPORT_ARGS"))
    if not command:
        return None
    return {"command": command, "args": args}


def microvm_binary_value(vm: dict[str, Any], engine: str) -> str:
    if engine == "firecracker":
        return read_string(
            vm.get("firecrackerBinary")
            or vm.get("firecracker_binary")
            or os.environ.get("AGENT_FLOW_FIRECRACKER_BINARY")
            or "firecracker"
        )
    return read_string(
        vm.get("cloudHypervisorBinary")
        or vm.get("cloud_hypervisor_binary")
        or os.environ.get("AGENT_FLOW_CLOUD_HYPERVISOR_BINARY")
        or "cloud-hypervisor"
    )


def load_image_manifest(value: str, workspace: pathlib.Path) -> dict[str, Any]:
    manifest_path = resolve_local_path(value, workspace, workspace)
    if not manifest_path or not manifest_path.is_file():
        raise FileNotFoundError(f"Image manifest not found: {value}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("format") != "agent-flow-builder.vm-image-manifest.v1":
        raise ValueError("Image manifest format must be agent-flow-builder.vm-image-manifest.v1")
    manifest["_manifest_dir"] = str(manifest_path.parent)
    return manifest


def load_policy_manifest(value: str, primary_root: pathlib.Path, workspace: pathlib.Path) -> dict[str, Any]:
    manifest_path = resolve_local_path(value, primary_root, workspace)
    if not manifest_path or not manifest_path.is_file():
        raise FileNotFoundError(f"MicroVM policy manifest not found: {value}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("format") != "agent-flow-builder.vm-policy-manifest.v1":
        raise ValueError("MicroVM policy manifest format must be agent-flow-builder.vm-policy-manifest.v1")
    manifest["_manifest_path"] = str(manifest_path)
    manifest["_manifest_dir"] = str(manifest_path.parent)
    return manifest


def normalize_microvm_policy(
    vm: dict[str, Any],
    policy_manifest: dict[str, Any],
    memory_mib: int,
    cpu_count: int,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    profile = read_string(vm.get("profile") or vm.get("policyProfile") or policy_manifest.get("profile") or "baseline").lower()
    if profile not in {"baseline", "hardened"}:
        profile = "baseline"
    network = read_string(vm.get("network") or vm.get("networkMode") or policy_manifest.get("network") or policy_manifest.get("networkMode") or "none").lower()
    read_only_rootfs = read_bool(
        vm.get("readOnlyRootfs")
        if "readOnlyRootfs" in vm
        else os.environ.get("AGENT_FLOW_MICROVM_READ_ONLY_ROOTFS")
        if os.environ.get("AGENT_FLOW_MICROVM_READ_ONLY_ROOTFS") is not None
        else policy_manifest.get("readOnlyRootfs")
        if "readOnlyRootfs" in policy_manifest
        else profile == "hardened"
    )
    workspace_mount = read_bool(vm.get("workspaceMount") if "workspaceMount" in vm else policy_manifest.get("workspaceMount") or False)
    host_device_passthrough = read_bool(
        vm.get("hostDevicePassthrough") if "hostDevicePassthrough" in vm else policy_manifest.get("hostDevicePassthrough") or False
    )
    snapshot_restore = read_bool(vm.get("snapshotRestore") if "snapshotRestore" in vm else policy_manifest.get("snapshotRestore") or False)
    require_guest_transport_assurance = read_string(
        vm.get("requireGuestTransportAssurance")
        or policy_manifest.get("requireGuestTransportAssurance")
        or ("guest_vm" if profile == "hardened" else "")
    )
    max_memory_mib = parse_int(policy_manifest.get("maxMemoryMiB")) or (4096 if profile == "hardened" else 0)
    max_cpus = parse_int(policy_manifest.get("maxCpus")) or (4 if profile == "hardened" else 0)

    if network != "none":
        return {}, {
            "ok": False,
            "error": "microvm_policy_network_not_supported",
            "network": network,
            "supportedNetwork": "none",
            "executesUserCode": False,
        }
    if workspace_mount:
        return {}, {
            "ok": False,
            "error": "microvm_policy_workspace_mount_not_allowed",
            "workspaceMount": True,
            "executesUserCode": False,
        }
    if host_device_passthrough:
        return {}, {
            "ok": False,
            "error": "microvm_policy_host_device_passthrough_not_allowed",
            "hostDevicePassthrough": True,
            "executesUserCode": False,
        }
    if max_memory_mib and memory_mib > max_memory_mib:
        return {}, {
            "ok": False,
            "error": "microvm_policy_memory_limit_exceeded",
            "requestedMemoryMiB": memory_mib,
            "maxMemoryMiB": max_memory_mib,
            "executesUserCode": False,
        }
    if max_cpus and cpu_count > max_cpus:
        return {}, {
            "ok": False,
            "error": "microvm_policy_cpu_limit_exceeded",
            "requestedCpus": cpu_count,
            "maxCpus": max_cpus,
            "executesUserCode": False,
        }

    return {
        "profile": profile,
        "network": "none",
        "readOnlyRootfs": read_only_rootfs,
        "workspaceMount": False,
        "hostDevicePassthrough": False,
        "snapshotRestore": snapshot_restore,
        "requireGuestTransportAssurance": require_guest_transport_assurance,
        "maxMemoryMiB": max_memory_mib or None,
        "maxCpus": max_cpus or None,
        "policyManifest": policy_manifest.get("_manifest_path"),
    }, None


def resolve_command(value: str) -> pathlib.Path | None:
    raw = pathlib.Path(value)
    if raw.is_absolute() or raw.parent != pathlib.Path("."):
        return raw.resolve() if raw.exists() else None
    found = shutil.which(value)
    return pathlib.Path(found).resolve() if found else None


def resolve_local_path(value: str, primary_root: pathlib.Path, workspace: pathlib.Path) -> pathlib.Path | None:
    if not value:
        return None
    raw = pathlib.Path(value)
    if raw.is_absolute():
        return raw.resolve()
    primary = (primary_root / raw).resolve()
    if primary.exists():
        return primary
    return (workspace / raw).resolve()


def sha256_file(file_path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def default_kernel_args(engine: str, firmware_boot: bool) -> str:
    if firmware_boot:
        return ""
    if engine == "cloud-hypervisor":
        return "console=hvc0 root=/dev/vda rw"
    return "console=ttyS0 reboot=k panic=1 pci=off root=/dev/vda rw"


def parse_memory_mib(value: str) -> int:
    raw = (value or "1024M").strip().lower()
    multiplier = 1
    if raw.endswith("g") or raw.endswith("gb"):
        multiplier = 1024
        raw = raw[:-2] if raw.endswith("gb") else raw[:-1]
    elif raw.endswith("m") or raw.endswith("mb"):
        raw = raw[:-2] if raw.endswith("mb") else raw[:-1]
    parsed = parse_int(raw)
    return max(1, (parsed or 1024) * multiplier)


def parse_int(value: Any) -> int | None:
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def read_string(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def read_string_array(value: Any) -> list[str]:
    return [item for item in (read_string(item) for item in value) if item] if isinstance(value, list) else []


def read_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def parse_args_env(value: str | None) -> list[str]:
    return shlex.split(value or "", posix=os.name != "nt")


def read_positive_number(value: Any) -> float | None:
    try:
        parsed = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


if __name__ == "__main__":
    raise SystemExit(main())
