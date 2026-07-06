# Melhoria Futura: Jobs Pós-Finalização Avançados

O baseline já possui a primeira camada de jobs pós-finalização: tabela `agent_jobs`, criação de job `post_finish_summary` ao finalizar sessão, endpoints locais para listar/detalhar/executar/reprocessar/reagendar/limpar jobs, endpoint `POST /jobs/{job_id}/schedule` com `delay_seconds` ou `run_at`, recorrência simples por intervalo, cron básico ou evento em `agent_job_schedules` com `trigger_type`, `cron_expression`, `event_type`, `POST /jobs/{job_id}/recurrence`, `GET /job-schedules`, `POST /job-schedules/run-due`, `POST /job-schedules/trigger-event` e `POST /job-schedules/{schedule_id}/disable`, retenção governada por `POST /jobs/cleanup` com `dry_run=true` por padrão, endpoints nativos de lote `POST /jobs/run-pending` e `POST /jobs/retry-failed`, métricas agregadas e operacionais em `GET /jobs/metrics?window_hours=...` (status/tipo, pendências, tentativas, taxa de sucesso, duração média/mínima/máxima/p95, janela configurável, throughput, próxima pendência, leases ativos/expirados, finalizações na última hora e último término), `max_attempts`, `last_error`, `next_run_at`, claim/lease multiworker por `worker_id`, `locked_until` e `WORKER_LEASE_SECONDS`, retomada de job abandonado após lease expirado, worker CLI opcional `python -m app.worker --once`, serviço `worker` no Docker Compose final com defaults por `WORKER_INTERVAL_SECONDS`, `WORKER_LIMIT`, `WORKER_RETRY_DELAY_SECONDS`, `WORKER_LEASE_SECONDS` e `WORKER_CLEANUP_*`, cleanup automático governado desligado por padrão, eventos `post_finish_pending`/`post_finish_completed`/`post_finish_scheduled`/`post_finish_retry_scheduled`/`post_finish_failed`/`post_finish_retry_requested`/`jobs_cleanup_completed`/`job_schedule_created`/`job_schedule_enqueued`/`job_schedule_event_triggered`/`job_schedule_disabled` e painel visual no Studio para acompanhar métricas, escolher janela, filtrar por escopo/status, inspecionar payload/resultado/erro, executar/reprocessar/reagendar jobs individualmente, criar/desativar/disparar agendas recorrentes simples, executar/reprocessar/enfileirar vencidas em lote e limpar jobs terminais antigos pela UI.

O contrato `/metadata` também expõe `operations.jobs` no runtime manual e gerado, com comando do worker, intervalo, limite, retry delay, lease, suporte multiworker, política de retenção/cleanup automático, status terminais e suporte a schedules, sem incluir valores brutos de segredo, chave ou `.env`.

O que continua futuro é a camada operacional avançada: triggers ricos além de intervalo fixo/cron básico/evento simples, isolamento dedicado mais forte por tipo de job e políticas administradas de capacidade/retention por ambiente.

Evoluções possíveis:

- perfis administrados de escala para múltiplas réplicas do serviço `worker` do compose quando fizer sentido;
- triggers avançados com APScheduler ou equivalente para casos além do intervalo fixo e cron básico atual;
- reprocessamento em lote com políticas avançadas e critérios persistidos;
- endpoints internos para enfileirar jobs por tipo e prioridade;
- histórico persistente de métricas por período e drill-down por tipo/agente além da janela calculada sob demanda.

No MVP, basta provar o ponto de extensão local sem trazer toda a superfície operacional de worker da API ProUp.
