import argparse
import inspect
import logging
import os
import time
import uuid
from typing import Any

from app import repo
from app.cache import build_cache
from app.db import init_db, session_scope
from app.graph import build_checkpointer, build_graph
from app.llm import LLMClient
from app.safety import SafetyGate
from app.service import ReferenceAgentService
from app.settings import get_settings


logger = logging.getLogger(__name__)


def build_worker_service() -> ReferenceAgentService:
    settings = get_settings()
    logging.basicConfig(level=settings.log_level)
    if settings.auto_create_tables:
        init_db()

    cache = build_cache(settings)
    llm_client = LLMClient(settings)
    safety_gate = SafetyGate()
    checkpointer = build_checkpointer(settings)
    graph = build_graph(
        settings=settings,
        llm_client=llm_client,
        safety_gate=safety_gate,
        checkpointer=checkpointer,
    )
    return ReferenceAgentService(settings=settings, graph=graph, cache=cache)


def _run_service_job(
    service: ReferenceAgentService,
    db,
    job_id: str,
    *,
    worker_id: str,
    lease_seconds: float,
):
    try:
        parameters = inspect.signature(service.run_job).parameters
    except (TypeError, ValueError):
        parameters = {}
    if "worker_id" in parameters:
        return service.run_job(db, job_id, worker_id=worker_id, lease_seconds=lease_seconds)
    return service.run_job(db, job_id)


def process_pending_jobs(
    service: ReferenceAgentService,
    *,
    limit: int = 20,
    retry_delay_seconds: float = 5.0,
    worker_id: str = "worker",
    lease_seconds: float = 60.0,
    cleanup_enabled: bool = False,
    cleanup_older_than_hours: float = 168.0,
    cleanup_limit: int = 100,
    cleanup_statuses: list[str] | None = None,
    bootstrap_flow_triggers: bool = True,
) -> dict[str, Any]:
    cleanup_result: dict[str, Any] | None = None
    agent_id = getattr(getattr(service, "settings", None), "agent_id", None)
    with session_scope() as db:
        if bootstrap_flow_triggers and hasattr(service, "ensure_flow_trigger_schedules"):
            service.ensure_flow_trigger_schedules(db)
        if hasattr(service, "run_due_job_schedules"):
            service.run_due_job_schedules(db, limit=limit)
        claimed_jobs = repo.claim_due_jobs(
            db,
            limit=limit,
            worker_id=worker_id,
            agent_id=agent_id,
            lease_seconds=lease_seconds,
        )
        job_ids = [job.job_id for job in claimed_jobs]

    processed = 0
    failed = 0
    retried = 0
    for job_id in job_ids:
        try:
            with session_scope() as db:
                _run_service_job(service, db, job_id, worker_id=worker_id, lease_seconds=lease_seconds)
            processed += 1
        except Exception as exc:
            logger.exception("Falha ao processar job %s", job_id)
            with session_scope() as db:
                job = repo.get_job_for_update(db, job_id)
                if job and job.status != "succeeded":
                    if job.status != "running":
                        repo.mark_job_running(db, job)
                    error = {"error": str(exc), "kind": job.kind, "attempt": int(job.attempts or 0)}
                    if int(job.attempts or 0) >= int(job.max_attempts or 1):
                        repo.mark_job_finished(db, job, status="failed", result_json=error)
                        event_type = "post_finish_failed"
                        failed += 1
                    else:
                        repo.mark_job_retry(db, job, error_json=error, delay_seconds=retry_delay_seconds)
                        event_type = "post_finish_retry_scheduled"
                        retried += 1
                    repo.append_event(
                        db,
                        session_id=job.session_id,
                        agent_id=job.agent_id,
                        event_type=event_type,
                        node=None,
                        payload={"kind": job.kind, "job_id": job.job_id, **error},
                    )

    if cleanup_enabled and hasattr(service, "cleanup_jobs"):
        with session_scope() as db:
            cleanup_result = service.cleanup_jobs(
                db,
                statuses=cleanup_statuses or ["succeeded", "failed"],
                older_than_hours=cleanup_older_than_hours,
                limit=cleanup_limit,
                dry_run=False,
            )

    result: dict[str, Any] = {"processed": processed, "failed": failed, "retried": retried, "pending_seen": len(job_ids)}
    if cleanup_result is not None:
        result["cleanup"] = cleanup_result
    return result


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
    parser = argparse.ArgumentParser(description="Processa jobs pendentes do runtime.")
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
        help="Máximo de jobs por ciclo.",
    )
    parser.add_argument(
        "--retry-delay",
        type=float,
        default=_env_float("WORKER_RETRY_DELAY_SECONDS", 5.0),
        help="Atraso em segundos antes de nova tentativa.",
    )
    parser.add_argument(
        "--worker-id",
        default=_env_str("WORKER_ID", f"afw_{uuid.uuid4().hex[:12]}"),
        help="Identidade operacional deste worker para claim de jobs.",
    )
    parser.add_argument(
        "--lease-seconds",
        type=float,
        default=_env_float("WORKER_LEASE_SECONDS", 60.0),
        help="Tempo de lease do job antes de outro worker poder retomá-lo.",
    )
    parser.add_argument(
        "--cleanup-enabled",
        action=argparse.BooleanOptionalAction,
        default=_env_bool("WORKER_CLEANUP_ENABLED", False),
        help="Executa limpeza governada de jobs terminais antigos após cada ciclo.",
    )
    parser.add_argument(
        "--cleanup-older-than-hours",
        type=float,
        default=_env_float("WORKER_CLEANUP_OLDER_THAN_HOURS", 168.0),
        help="Idade mínima, em horas, para cleanup automático de jobs terminais.",
    )
    parser.add_argument(
        "--cleanup-limit",
        type=int,
        default=_env_int("WORKER_CLEANUP_LIMIT", 100),
        help="Máximo de jobs removidos por ciclo de cleanup automático.",
    )
    parser.add_argument(
        "--cleanup-statuses",
        default=_env_str("WORKER_CLEANUP_STATUSES", "succeeded,failed"),
        help="Status terminais separados por vírgula para cleanup automático.",
    )
    args = parser.parse_args()

    service = build_worker_service()
    while True:
        result = process_pending_jobs(
            service,
            limit=max(1, args.limit),
            retry_delay_seconds=max(0.0, args.retry_delay),
            worker_id=str(args.worker_id),
            lease_seconds=max(1.0, args.lease_seconds),
            cleanup_enabled=bool(args.cleanup_enabled),
            cleanup_older_than_hours=max(0.0, args.cleanup_older_than_hours),
            cleanup_limit=max(1, args.cleanup_limit),
            cleanup_statuses=_split_statuses(str(args.cleanup_statuses)),
        )
        logger.info("Jobs processados: %s", result)
        if args.once:
            return 0 if result["failed"] == 0 else 1
        time.sleep(max(0.5, args.interval))


if __name__ == "__main__":
    raise SystemExit(main())
