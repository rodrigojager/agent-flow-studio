#!/usr/bin/env python3
"""Reference implementation for the Agent Flow VM runner contract.

This runner is intentionally a local contract runner, not a VM or security
sandbox. It is useful for validating payload shape, generated runtimes and
bundle wiring before replacing it with a real QEMU/Firecracker/Cloud Hypervisor
runner.
"""

from __future__ import annotations

import contextlib
import io
import json
import pathlib
import sys
import traceback
from typing import Any


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
                    "runner": "agent-flow-vm-runner-reference",
                },
                ensure_ascii=False,
            )
        )
        return 1


def run_request(request: dict[str, Any]) -> dict[str, Any]:
    if request.get("protocol") != "agent-flow-vm-runner.v1":
        return {
            "ok": False,
            "error": "unsupported_protocol",
            "expectedProtocol": "agent-flow-vm-runner.v1",
            "receivedProtocol": request.get("protocol"),
        }

    language = str(request.get("language") or "python").lower()
    if language != "python":
        return {
            "ok": False,
            "error": f"unsupported_language:{language}",
            "supportedLanguages": ["python"],
            "runner": "agent-flow-vm-runner-reference",
        }

    source = read_python_source(request)
    entry = str(request.get("entry") or "run")
    stdout_buffer = io.StringIO()
    globals_dict: dict[str, Any] = {
        "__name__": "__agent_flow_vm_reference__",
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
        "runner": "agent-flow-vm-runner-reference",
        "providesVmIsolation": False,
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
