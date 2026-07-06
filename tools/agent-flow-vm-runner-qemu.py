#!/usr/bin/env python3
"""QEMU runner preflight for the Agent Flow VM runner contract.

This runner prepares and validates a QEMU/microVM launch plan. It does not yet
boot a managed guest by itself. Normal execution requires an explicit host/guest
transport command that forwards the contract JSON to the guest agent embedded in
the image. Without that transport it fails closed instead of falling back to the
host.
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
                    "runner": "agent-flow-vm-runner-qemu",
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
    engine = read_string(vm.get("engine") or os.environ.get("AGENT_FLOW_CODE_VM_ENGINE") or "qemu").lower()
    if engine != "qemu":
        return {"ok": False, "error": f"unsupported_engine:{engine}", "executesUserCode": False}

    binary_value = read_string(
        vm.get("qemuBinary")
        or vm.get("qemu_binary")
        or os.environ.get("AGENT_FLOW_QEMU_BINARY")
        or "qemu-system-x86_64"
    )
    binary_path = resolve_command(binary_value)
    if not binary_path:
        return {
            "ok": False,
            "error": "qemu_binary_not_found",
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
    image_path_value = image_value or read_string(image_manifest.get("imagePath"))
    image_base = pathlib.Path(str(image_manifest.get("_manifest_dir") or workspace)).resolve()
    image_path = resolve_local_path(image_path_value, image_base, workspace) if image_path_value else None
    if not image_path or not image_path.is_file():
        return {
            "ok": False,
            "error": "qemu_image_not_found",
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
            "error": "qemu_image_size_mismatch",
            "expectedSizeBytes": declared_size,
            "actualSizeBytes": image_size,
            "executesUserCode": False,
        }
    if declared_sha256 and declared_sha256 != image_sha256:
        return {
            "ok": False,
            "error": "qemu_image_sha256_mismatch",
            "expectedSha256": declared_sha256,
            "actualSha256": image_sha256,
            "executesUserCode": False,
        }

    boot_artifacts, boot_artifact_error = resolve_boot_artifacts(vm, image_manifest, image_base, workspace)
    if boot_artifact_error:
        return boot_artifact_error

    memory = read_string(vm.get("memory") or "1024m")
    cpus = read_string(vm.get("cpus") or "1")
    machine = read_string(vm.get("machine") or vm.get("qemuMachine") or os.environ.get("AGENT_FLOW_QEMU_MACHINE") or "q35,accel=kvm:tcg")
    net_device = read_string(vm.get("netDevice") or os.environ.get("AGENT_FLOW_QEMU_NET_DEVICE") or "virtio-net-pci")
    ssh_bind = read_string(vm.get("sshBind") or os.environ.get("AGENT_FLOW_VM_GUEST_SSH_BIND") or "127.0.0.1")
    ssh_port = read_string(vm.get("sshPort") or os.environ.get("AGENT_FLOW_VM_GUEST_SSH_PORT") or "2222")
    seed_artifact = next((artifact for artifact in boot_artifacts if artifact.get("kind") == "cloud-init-seed"), None)
    planned_command = build_planned_qemu_command(
        binary_path=binary_path,
        image_path=image_path,
        seed_path=pathlib.Path(str(seed_artifact["path"])) if seed_artifact else None,
        machine=machine,
        memory=memory,
        cpus=cpus,
        net_device=net_device,
        ssh_bind=ssh_bind,
        ssh_port=ssh_port,
    )

    return {
        "ok": True,
        "format": "agent-flow-vm-runner-qemu-preflight.v1",
        "runner": "agent-flow-vm-runner-qemu",
        "protocol": "agent-flow-vm-runner.v1",
        "engine": "qemu",
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
            "memory": memory,
            "cpus": cpus,
            "machine": machine,
            "network": "user-forwarded-ssh",
            "netDevice": net_device,
            "sshBind": ssh_bind,
            "sshPort": ssh_port,
        },
        "plannedCommand": planned_command,
    }


def build_planned_qemu_command(
    *,
    binary_path: pathlib.Path,
    image_path: pathlib.Path,
    seed_path: pathlib.Path | None,
    machine: str,
    memory: str,
    cpus: str,
    net_device: str,
    ssh_bind: str,
    ssh_port: str,
) -> list[str]:
    if machine.startswith("microvm"):
        planned_command = [
            str(binary_path),
            "-nodefaults",
            "-machine",
            machine,
            "-m",
            memory,
            "-smp",
            cpus,
            "-drive",
            f"file={image_path},format=qcow2,if=none,id=rootfs",
            "-device",
            "virtio-blk-device,drive=rootfs",
        ]
        if seed_path:
            planned_command.extend(
                [
                    "-drive",
                    f"file={seed_path},format=raw,if=none,id=seed,media=cdrom",
                    "-device",
                    "virtio-blk-device,drive=seed",
                ]
            )
    else:
        planned_command = [
            str(binary_path),
            "-nodefaults",
            "-machine",
            machine,
            "-m",
            memory,
            "-smp",
            cpus,
            "-drive",
            f"file={image_path},format=qcow2,if=virtio",
        ]
        if seed_path:
            planned_command.extend(["-drive", f"file={seed_path},format=raw,if=virtio,media=cdrom"])

    planned_command.extend(
        [
            "-netdev",
            f"user,id=net0,hostfwd=tcp:{ssh_bind}:{ssh_port}-:22",
            "-device",
            f"{net_device},netdev=net0",
            "-display",
            "none",
            "-serial",
            "stdio",
            "-no-reboot",
        ]
    )
    return planned_command


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

    seed_image = read_string(vm.get("seedImage") or vm.get("seed_image") or os.environ.get("AGENT_FLOW_CODE_VM_SEED_IMAGE") or "")
    if seed_image and not any(read_string(item.get("kind")).lower() == "cloud-init-seed" for item, _root in candidates):
        candidates.append(({"id": "cloud-init-seed", "kind": "cloud-init-seed", "path": seed_image, "requiredForBoot": True}, workspace))

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
                "error": "qemu_boot_artifact_path_missing",
                "artifactId": artifact_id,
                "executesUserCode": False,
            }
        artifact_path = resolve_local_path(artifact_path_value, root, workspace)
        if not artifact_path or not artifact_path.is_file():
            return [], {
                "ok": False,
                "error": "qemu_boot_artifact_not_found",
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
                "error": "qemu_boot_artifact_size_mismatch",
                "artifactId": artifact_id,
                "kind": kind,
                "expectedSizeBytes": declared_size,
                "actualSizeBytes": artifact_size,
                "executesUserCode": False,
            }
        if declared_sha256 and declared_sha256 != artifact_sha256:
            return [], {
                "ok": False,
                "error": "qemu_boot_artifact_sha256_mismatch",
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
            "error": "qemu_guest_transport_not_configured",
            "runner": "agent-flow-vm-runner-qemu",
            "protocol": "agent-flow-vm-runner.v1",
            "requiresGuestAgent": True,
            "supportsExternalGuestTransport": True,
            "executesUserCode": False,
            "message": "Set vm.guestTransportCommand or AGENT_FLOW_QEMU_GUEST_TRANSPORT_COMMAND to a command that reaches the guest agent.",
        }

    command_path = resolve_command(transport["command"])
    if not command_path:
        return {
            "ok": False,
            "error": "qemu_guest_transport_command_not_found",
            "runner": "agent-flow-vm-runner-qemu",
            "transport": {
                "kind": "external_command",
                "command": transport["command"],
                "resolved": False,
            },
            "requiresGuestAgent": True,
            "executesUserCode": False,
        }

    timeout_seconds = read_positive_number(vm.get("guestTransportTimeoutSeconds")) or read_positive_number(
        os.environ.get("AGENT_FLOW_QEMU_GUEST_TRANSPORT_TIMEOUT_SECONDS")
    ) or 30.0
    transport_assurance = read_string(
        vm.get("guestTransportAssurance") or os.environ.get("AGENT_FLOW_QEMU_GUEST_TRANSPORT_ASSURANCE") or "operator_configured"
    )
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
            "error": "qemu_guest_transport_timeout",
            "runner": "agent-flow-vm-runner-qemu",
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
            "error": "qemu_guest_transport_empty_stdout",
            "runner": "agent-flow-vm-runner-qemu",
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
            "error": "qemu_guest_transport_invalid_json",
            "runner": "agent-flow-vm-runner-qemu",
            "returnCode": completed.returncode,
            "stdoutPreview": (completed.stdout or "")[:1000],
            "stderrPreview": (completed.stderr or "")[:1000],
            "requiresGuestAgent": True,
            "executesUserCode": True,
        }

    if not isinstance(guest_result, dict):
        return {
            "ok": False,
            "error": "qemu_guest_transport_non_object_result",
            "runner": "agent-flow-vm-runner-qemu",
            "returnCode": completed.returncode,
            "requiresGuestAgent": True,
            "executesUserCode": True,
        }

    provides_vm_isolation = transport_assurance == "guest_vm"
    return {
        **guest_result,
        "ok": bool(guest_result.get("ok")) and completed.returncode == 0,
        "runner": "agent-flow-vm-runner-qemu",
        "protocol": "agent-flow-vm-runner.v1",
        "engine": "qemu",
        "contractExecutionImplemented": True,
        "supportsExternalGuestTransport": True,
        "requiresGuestAgent": True,
        "executesUserCode": True,
        "providesVmIsolation": provides_vm_isolation,
        "qemuPreflightProvidesVmIsolation": preflight_result.get("providesVmIsolation") is True,
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
        "qemuPreflight": {
            "ok": True,
            "format": preflight_result.get("format"),
            "engine": preflight_result.get("engine"),
            "image": preflight_result.get("image"),
            "policy": preflight_result.get("policy"),
        },
    }


def resolve_guest_transport(vm: dict[str, Any]) -> dict[str, Any] | None:
    command = read_string(vm.get("guestTransportCommand") or os.environ.get("AGENT_FLOW_QEMU_GUEST_TRANSPORT_COMMAND") or "")
    args = read_string_array(vm.get("guestTransportArgs"))
    if not args:
        args = parse_args_env(os.environ.get("AGENT_FLOW_QEMU_GUEST_TRANSPORT_ARGS"))
    if not command:
        return None
    return {"command": command, "args": args}


def load_image_manifest(value: str, workspace: pathlib.Path) -> dict[str, Any]:
    manifest_path = resolve_local_path(value, workspace, workspace)
    if not manifest_path or not manifest_path.is_file():
        raise FileNotFoundError(f"Image manifest not found: {value}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("format") != "agent-flow-builder.vm-image-manifest.v1":
        raise ValueError("Image manifest format must be agent-flow-builder.vm-image-manifest.v1")
    manifest["_manifest_dir"] = str(manifest_path.parent)
    return manifest


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


def read_string(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def read_string_array(value: Any) -> list[str]:
    return [item for item in (read_string(item) for item in value) if item] if isinstance(value, list) else []


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
