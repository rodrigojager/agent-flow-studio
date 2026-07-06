import argparse
import importlib
import json
import logging
import os
import sys
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any


AGENTS = json.loads("[\n  {\n    \"id\": \"reference-interview\",\n    \"runtime_dir\": \"agents/reference-interview\"\n  }\n]")
PROJECT_ROOT = Path(__file__).resolve().parents[1]

logger = logging.getLogger(__name__)


@contextmanager
def _isolated_agent_import(agent_root: Path) -> Iterator[None]:
    previous_path = list(sys.path)
    previous_modules = {
        name: module
        for name, module in sys.modules.items()
        if name == "app" or name.startswith("app.")
    }
    for name in list(previous_modules):
        sys.modules.pop(name, None)
    sys.path.insert(0, str(agent_root))
    importlib.invalidate_caches()
    try:
        yield
    finally:
        for name in [name for name in sys.modules if name == "app" or name.startswith("app.")]:
            sys.modules.pop(name, None)
        sys.modules.update(previous_modules)
        sys.path[:] = previous_path
        importlib.invalidate_caches()


def _process_agent_jobs(agent: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    agent_root = PROJECT_ROOT / agent["runtime_dir"]
    if not agent_root.exists():
        raise RuntimeError(f"Runtime do agente não encontrado: {agent_root}")
    with _isolated_agent_import(agent_root):
        worker_module = importlib.import_module("app.worker")
        service = worker_module.build_worker_service()
        result = worker_module.process_pending_jobs(
            service,
            limit=max(1, int(args.limit)),
            retry_delay_seconds=max(0.0, float(args.retry_delay)),
            worker_id=f"{args.worker_id}:{agent['id']}",
            lease_seconds=max(1.0, float(args.lease_seconds)),
            cleanup_enabled=bool(args.cleanup_enabled),
            cleanup_older_than_hours=max(0.0, float(args.cleanup_older_than_hours)),
            cleanup_limit=max(1, int(args.cleanup_limit)),
            cleanup_statuses=_split_statuses(str(args.cleanup_statuses)),
        )
    if not isinstance(result, dict):
        result = {}
    return {
        "agent_id": agent["id"],
        "runtime_dir": agent["runtime_dir"],
        "processed": int(result.get("processed") or 0),
        "failed": int(result.get("failed") or 0),
        "retried": int(result.get("retried") or 0),
        "pending_seen": int(result.get("pending_seen") or 0),
        **({"cleanup": result["cleanup"]} if "cleanup" in result else {}),
    }


def process_bundle_jobs(args: argparse.Namespace) -> dict[str, Any]:
    aggregate: dict[str, Any] = {
        "processed": 0,
        "failed": 0,
        "retried": 0,
        "pending_seen": 0,
        "agents": [],
    }
    for agent in AGENTS:
        result = _process_agent_jobs(agent, args)
        aggregate["agents"].append(result)
        for key in ["processed", "failed", "retried", "pending_seen"]:
            aggregate[key] += int(result.get(key) or 0)
    return aggregate


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name, "").strip().lower()
    if not value:
        return default
    return value in {"1", "true", "yes", "on"}


def _env_str(name: str, default: str) -> str:
    value = os.getenv(name, "").strip()
    return value or default


def _split_statuses(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description="Processa jobs pendentes de todos os agentes do bundle.")
    parser.add_argument("--once", action="store_true", help="Processa a fila uma vez e encerra.")
    parser.add_argument(
        "--interval",
        type=float,
        default=_env_float("WORKER_INTERVAL_SECONDS", 5.0),
        help="Intervalo em segundos entre ciclos.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=_env_int("WORKER_LIMIT", 20),
        help="Maximo de jobs por agente em cada ciclo.",
    )
    parser.add_argument(
        "--retry-delay",
        type=float,
        default=_env_float("WORKER_RETRY_DELAY_SECONDS", 5.0),
        help="Atraso em segundos antes de nova tentativa.",
    )
    parser.add_argument(
        "--worker-id",
        default=_env_str("WORKER_ID", f"afw_bundle_{uuid.uuid4().hex[:12]}"),
        help="Identidade operacional deste worker para claim de jobs.",
    )
    parser.add_argument(
        "--lease-seconds",
        type=float,
        default=_env_float("WORKER_LEASE_SECONDS", 60.0),
        help="Tempo de lease do job antes de outro worker poder retoma-lo.",
    )
    parser.add_argument(
        "--cleanup-enabled",
        action=argparse.BooleanOptionalAction,
        default=_env_bool("WORKER_CLEANUP_ENABLED", False),
        help="Executa limpeza governada de jobs terminais antigos apos cada ciclo.",
    )
    parser.add_argument(
        "--cleanup-older-than-hours",
        type=float,
        default=_env_float("WORKER_CLEANUP_OLDER_THAN_HOURS", 168.0),
        help="Idade minima, em horas, para cleanup automatico de jobs terminais.",
    )
    parser.add_argument(
        "--cleanup-limit",
        type=int,
        default=_env_int("WORKER_CLEANUP_LIMIT", 100),
        help="Maximo de jobs removidos por ciclo de cleanup automatico.",
    )
    parser.add_argument(
        "--cleanup-statuses",
        default=_env_str("WORKER_CLEANUP_STATUSES", "succeeded,failed"),
        help="Status terminais separados por virgula para cleanup automatico.",
    )
    args = parser.parse_args()

    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    while True:
        result = process_bundle_jobs(args)
        logger.info("Jobs do bundle processados: %s", result)
        if args.once:
            return 0 if result["failed"] == 0 else 1
        time.sleep(max(0.5, float(args.interval)))


if __name__ == "__main__":
    raise SystemExit(main())
