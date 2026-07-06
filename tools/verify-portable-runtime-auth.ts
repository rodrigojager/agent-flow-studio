import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseAgentFlow } from "@agent-flow-builder/flow-spec";
import { generateLangGraphRuntime } from "../packages/codegen-langgraph/src/index.ts";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agent-flow-portable-runtime-auth-"));
  try {
    const flowPath = path.join(REPO_ROOT, "flows", "reference-interview", "agent.flow.json");
    const sourceRuntime = path.join(tempRoot, "studio-generated", "reference-interview-runtime");
    const portableRuntime = path.join(tempRoot, "consumer-runtime", "reference-interview-runtime");

    const flow = parseAgentFlow(JSON.parse(await readFile(flowPath, "utf-8")));
    await generateLangGraphRuntime({
      flow,
      flowRoot: path.dirname(flowPath),
      outDir: sourceRuntime,
    });
    await cp(sourceRuntime, portableRuntime, { recursive: true });
    await rm(path.dirname(sourceRuntime), { recursive: true, force: true });

    const smokeScript = path.join(portableRuntime, "portable_auth_smoke.py");
    await writeFile(smokeScript, portableAuthSmokePython(), "utf-8");
    const result = await execFileAsync("python", [smokeScript], {
      cwd: portableRuntime,
      timeout: 180_000,
      maxBuffer: 1024 * 1024 * 4,
    });

    const summary = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    assert.equal(summary.status, "ok");
    assert.equal(summary.authEnabled, true);
    assert.equal(summary.rawKeyLeakDetected, false);
    console.log(JSON.stringify({
      status: "ok",
      artifact: "reference-interview-runtime",
      portableRuntime,
      auth: summary,
    }, null, 2));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function portableAuthSmokePython(): string {
  return String.raw`
import json
import os
from pathlib import Path

from fastapi.testclient import TestClient

from app.generated_flow import API_RESOURCE
from tests.conftest import set_test_env


def _path(suffix=""):
    return f"/{API_RESOURCE}{suffix}"


runtime_root = Path(__file__).resolve().parent
db_path = runtime_root / "portable-auth.db"
audit_path = runtime_root / ".agent-flow" / "portable-auth-audit.jsonl"
audit_path.parent.mkdir(parents=True, exist_ok=True)

set_test_env(str(db_path))
os.environ["AUTH_ENABLED"] = "true"
os.environ["AGENT_API_KEY"] = ""
os.environ["AGENT_API_KEYS"] = json.dumps(
    {
        "keys": [
            {"id": "reader", "key": "portable-reader-key", "scopes": ["metadata:read", "sessions:read"]},
            {"id": "operator", "key": "portable-operator-key", "scopes": ["sessions:*", "jobs:*"]},
            {"id": "auth-viewer", "key": "portable-auth-key", "scopes": ["auth:read"]},
        ]
    }
)
os.environ["AUTH_AUDIT_ENABLED"] = "true"
os.environ["AUTH_AUDIT_PATH"] = str(audit_path)

from app.settings import get_settings

get_settings.cache_clear()

from app.db import engine
from app.main import create_app
from app.models import Base

Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)
client = TestClient(create_app())

assert client.get("/health").status_code == 200
assert client.get("/metadata").status_code == 403
assert client.get("/metadata", headers={"X-Agent-API-Key": "portable-reader-key"}).status_code == 200
assert client.post(_path(), headers={"X-Agent-API-Key": "portable-reader-key"}, json={"max_turns": 2}).status_code == 403

create_resp = client.post(
    _path(),
    headers={"X-Agent-API-Key": "portable-operator-key", "Idempotency-Key": "portable-auth-create"},
    json={"max_turns": 2},
)
assert create_resp.status_code == 200
session_id = create_resp.json()["session"]["session_id"]

assert client.get(_path(f"/{session_id}"), headers={"X-Agent-API-Key": "portable-reader-key"}).status_code == 200
assert client.post(
    _path(f"/{session_id}/start"),
    headers={"X-Agent-API-Key": "portable-reader-key"},
    json={},
).status_code == 403
assert client.post(
    _path(f"/{session_id}/start"),
    headers={"X-Agent-API-Key": "portable-operator-key", "Idempotency-Key": "portable-auth-start"},
    json={},
).status_code == 200

keys_resp = client.get("/auth/keys", headers={"X-Agent-API-Key": "portable-auth-key"})
assert keys_resp.status_code == 200
keys_payload = keys_resp.json()
assert {item["key_id"] for item in keys_payload["keys"]} == {"reader", "operator", "auth-viewer"}

audit_resp = client.get("/auth/audit?limit=50", headers={"X-Agent-API-Key": "portable-reader-key"})
assert audit_resp.status_code == 200
audit_payload = audit_resp.json()
statuses = {item["status"] for item in audit_payload["entries"]}
assert "allowed" in statuses
assert "rejected" in statuses

combined = json.dumps({"keys": keys_payload, "audit": audit_payload}, ensure_ascii=False)
raw_keys = ["portable-reader-key", "portable-operator-key", "portable-auth-key"]
raw_key_leak_detected = any(raw_key in combined for raw_key in raw_keys)
assert not raw_key_leak_detected

audit_file_text = audit_path.read_text(encoding="utf-8")
assert "portable-reader-key" not in audit_file_text
assert "portable-operator-key" not in audit_file_text
assert "portable-auth-key" not in audit_file_text

print(json.dumps({
    "status": "ok",
    "authEnabled": True,
    "sessionId": session_id,
    "keys": [item["key_id"] for item in keys_payload["keys"]],
    "auditStatuses": sorted(statuses),
    "rawKeyLeakDetected": raw_key_leak_detected,
}, ensure_ascii=False))
`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
