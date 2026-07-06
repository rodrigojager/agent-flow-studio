#!/usr/bin/env python3
"""Guest-side Agent Flow contract executor for VM images.

This agent is meant to run inside a prepared VM/microVM image. It reads the
same `agent-flow-vm-runner.v1` request contract from stdin and writes a JSON
result to stdout, so a host runner can pass work into the guest over its chosen
transport.
"""

from __future__ import annotations

import contextlib
import io
import json
import pathlib
import sys
import traceback
from typing import Any


GUEST_AGENT_PROTOCOL = "agent-flow-vm-guest-agent.v1"
RUNNER_PROTOCOL = "agent-flow-vm-runner.v1"


def main() -> int:
    try:
        request = json.loads(sys.stdin.read() or "{}")
        result = run_request(request)
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result.get("ok") else 1
    except Exception as exc:  # pragma: no cover - defensive process boundary
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": str(exc),
                    "traceback": traceback.format_exc(),
                    "runner": "agent-flow-vm-guest-agent",
                    "guestAgentProtocol": GUEST_AGENT_PROTOCOL,
                    "executesInsideGuest": True,
                },
                ensure_ascii=False,
            )
        )
        return 1


def run_request(request: dict[str, Any]) -> dict[str, Any]:
    if request.get("protocol") != RUNNER_PROTOCOL:
        return {
            "ok": False,
            "error": "unsupported_protocol",
            "expectedProtocol": RUNNER_PROTOCOL,
            "receivedProtocol": request.get("protocol"),
            "runner": "agent-flow-vm-guest-agent",
            "guestAgentProtocol": GUEST_AGENT_PROTOCOL,
            "executesInsideGuest": True,
        }

    language = str(request.get("language") or "python").lower()
    if language not in {"python", "py"}:
        return {
            "ok": False,
            "error": f"unsupported_language:{language}",
            "supportedLanguages": ["python"],
            "runner": "agent-flow-vm-guest-agent",
            "guestAgentProtocol": GUEST_AGENT_PROTOCOL,
            "executesInsideGuest": True,
        }

    source = read_python_source(request)
    entry = str(request.get("entry") or "run")
    stdout_buffer = io.StringIO()
    globals_dict: dict[str, Any] = {
        "__name__": "__agent_flow_vm_guest__",
        "__file__": str(request.get("sourcePath") or "<inline>"),
    }
    with contextlib.redirect_stdout(stdout_buffer):
        exec(compile(source, globals_dict["__file__"], "exec"), globals_dict)
        candidate = globals_dict.get(entry)
        if not callable(candidate):
            return {
                "ok": False,
                "error": f"entry_not_callable:{entry}",
                "stdout": stdout_buffer.getvalue(),
                "runner": "agent-flow-vm-guest-agent",
                "guestAgentProtocol": GUEST_AGENT_PROTOCOL,
                "executesInsideGuest": True,
            }
        output = candidate(
            request.get("input"),
            request.get("context") or {},
            request.get("contract") or {},
        )

    return {
        "ok": True,
        "output": output,
        "stdout": stdout_buffer.getvalue(),
        "runner": "agent-flow-vm-guest-agent",
        "guestAgentProtocol": GUEST_AGENT_PROTOCOL,
        "executesInsideGuest": True,
        "workspaceIsolation": request.get("workspaceIsolation"),
        "vm": request.get("vm") or {},
    }


def read_python_source(request: dict[str, Any]) -> str:
    inline_source = request.get("inlineSource")
    if isinstance(inline_source, str) and inline_source.strip():
        return inline_source

    source_path = request.get("sourcePath")
    if not isinstance(source_path, str) or not source_path.strip():
        raise ValueError("inlineSource or sourcePath is required")

    workspace = pathlib.Path(str(request.get("workspace") or ".")).resolve()
    resolved_source = pathlib.Path(source_path).resolve()
    try:
        resolved_source.relative_to(workspace)
    except ValueError as exc:
        raise ValueError("sourcePath must stay inside workspace") from exc
    return resolved_source.read_text(encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
