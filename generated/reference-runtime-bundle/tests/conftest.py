import json
import os
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
project_root_text = str(PROJECT_ROOT)
if project_root_text not in sys.path:
    sys.path.insert(0, project_root_text)


def set_test_env(db_path: str) -> None:
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    os.environ["REDIS_ENABLED"] = "false"
    os.environ["USE_POSTGRES_CHECKPOINTER"] = "false"
    os.environ["MOCK_LLM"] = "true"
    os.environ["AUTH_ENABLED"] = "false"
    os.environ["AGENT_API_KEYS"] = ""
    os.environ["AGENT_API_KEYS_PATH"] = ""
    os.environ["AGENT_API_REVOKED_KEY_IDS"] = ""
    os.environ["AGENT_API_REVOKED_KEY_IDS_PATH"] = ""
    os.environ["AUTH_RATE_LIMIT_ENABLED"] = "false"
    os.environ["AUTH_RATE_LIMIT_REQUESTS"] = "60"
    os.environ["AUTH_RATE_LIMIT_WINDOW_SECONDS"] = "60"
    os.environ["AUTH_AUDIT_ENABLED"] = "true"
    os.environ["AUTH_AUDIT_MAX_ENTRIES"] = "200"
    os.environ["AUTH_AUDIT_PATH"] = ""
    os.environ["SAFETY_PROVIDER_ENABLED"] = "false"
    os.environ["SAFETY_PROVIDER_URL"] = ""
    os.environ["SAFETY_PROVIDER_TIMEOUT_SECONDS"] = "3"
    os.environ["SAFETY_PROVIDER_FAIL_CLOSED"] = "false"
    os.environ["SAFETY_PROVIDER_HEADERS_JSON"] = ""
    os.environ["AUTO_CREATE_TABLES"] = "true"
