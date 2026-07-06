#!/usr/bin/env python3
"""SSH transport for Agent Flow VM guest-agent calls.

The host QEMU runner can use this script as an external guest transport. It
reads the Agent Flow VM runner request JSON from stdin, forwards it to the guest
agent over SSH, and writes the guest JSON result to stdout.
"""

from __future__ import annotations

import json
import os
import pathlib
import shutil
import subprocess
import sys
from typing import Any


def main() -> int:
    if "--self-check" in sys.argv[1:]:
        print(
            json.dumps(
                {
                    "status": "ok",
                    "format": "agent-flow-vm-ssh-transport-check.v1",
                    "transport": "ssh",
                    "executesUserCode": False,
                    "requiresGuestAgent": True,
                }
            )
        )
        return 0

    raw_request = sys.stdin.read() or "{}"
    try:
        request = json.loads(raw_request)
    except json.JSONDecodeError as exc:
        print(json.dumps({"ok": False, "error": f"invalid_json:{exc}", "transport": "ssh"}))
        return 1

    vm = request.get("vm") if isinstance(request.get("vm"), dict) else {}
    ssh_binary = read_string(vm.get("sshBinary") or os.environ.get("AGENT_FLOW_VM_SSH_BINARY") or "ssh")
    ssh_path = resolve_command(ssh_binary)
    if not ssh_path:
        print(json.dumps({"ok": False, "error": "ssh_binary_not_found", "transport": "ssh"}))
        return 1

    host = read_string(vm.get("guestSshHost") or os.environ.get("AGENT_FLOW_VM_GUEST_SSH_HOST") or "127.0.0.1")
    port = read_string(vm.get("guestSshPort") or os.environ.get("AGENT_FLOW_VM_GUEST_SSH_PORT") or "2222")
    user = read_string(vm.get("guestSshUser") or os.environ.get("AGENT_FLOW_VM_GUEST_SSH_USER") or "agentflow")
    identity_file = read_string(vm.get("guestSshIdentityFile") or os.environ.get("AGENT_FLOW_VM_GUEST_SSH_IDENTITY_FILE") or "")
    strict_host_key = read_string(os.environ.get("AGENT_FLOW_VM_SSH_STRICT_HOST_KEY_CHECKING") or "accept-new")
    guest_agent = read_string(
        vm.get("guestAgentPath") or os.environ.get("AGENT_FLOW_VM_GUEST_AGENT_PATH") or "/opt/agent-flow/agent-flow-vm-guest-agent.py"
    )
    timeout = read_positive_number(vm.get("guestSshTimeoutSeconds") or os.environ.get("AGENT_FLOW_VM_GUEST_SSH_TIMEOUT_SECONDS")) or 30.0

    command = [
        str(ssh_path),
        "-o",
        "BatchMode=yes",
        "-o",
        f"StrictHostKeyChecking={strict_host_key}",
        "-p",
        port,
    ]
    if identity_file:
        command.extend(["-i", str(pathlib.Path(identity_file).expanduser())])
    command.extend([f"{user}@{host}", "python3", guest_agent])

    try:
        completed = subprocess.run(
            command,
            input=raw_request,
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        print(json.dumps({"ok": False, "error": "ssh_transport_timeout", "transport": "ssh", "timeoutSeconds": timeout}))
        return 1

    if completed.stdout:
        sys.stdout.write(completed.stdout)
    else:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "ssh_transport_empty_stdout",
                    "transport": "ssh",
                    "returnCode": completed.returncode,
                    "stderrPreview": (completed.stderr or "")[:1000],
                }
            )
        )
    return completed.returncode


def resolve_command(value: str) -> pathlib.Path | None:
    raw = pathlib.Path(value)
    if raw.is_absolute() or raw.parent != pathlib.Path("."):
        return raw.resolve() if raw.exists() else None
    found = shutil.which(value)
    return pathlib.Path(found).resolve() if found else None


def read_string(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def read_positive_number(value: Any) -> float | None:
    try:
        parsed = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


if __name__ == "__main__":
    raise SystemExit(main())
