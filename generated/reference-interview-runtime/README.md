# Agente de Referência

Runtime gerado a partir de `reference-interview`.


## Contrato

- `POST /sessions`
- `GET /sessions/{session_id}`
- `POST /sessions/{session_id}/start`
- `POST /sessions/{session_id}/turn`
- `POST /sessions/{session_id}/finish`
- `GET /sessions/{session_id}/transcript`
- `GET /sessions/{session_id}/events`
- `GET /sessions/{session_id}/events/stream` (SSE)
- `WS /sessions/{session_id}/events/ws` (WebSocket)
- `POST /sessions/{session_id}/turn/stream` (SSE token stream)
- `WS /sessions/{session_id}/turn/stream/ws` (WebSocket token stream)
- `GET /jobs`
- `GET /jobs/metrics`
- `POST /jobs/cleanup`
- `POST /jobs/run-pending`
- `POST /jobs/retry-failed`
- `GET /jobs/{job_id}`
- `POST /jobs/{job_id}/run`
- `POST /jobs/{job_id}/retry`
- `POST /jobs/{job_id}/schedule`
- `POST /jobs/{job_id}/recurrence`
- `GET /job-schedules`
- `POST /job-schedules/run-due`
- `POST /job-schedules/trigger-event`
- `POST /job-schedules/{schedule_id}/disable`

`GET /jobs/metrics?window_hours=24` retorna contadores por status/tipo, pendências, tentativas, taxa de sucesso, duração média/mínima/máxima/p95, janela configurável, finalizações/taxa/throughput na janela, próxima pendência agendada, finalizações na última hora e último término observado. `POST /jobs/cleanup` faz retenção governada de jobs antigos: por padrão retorna apenas uma prévia (`dry_run=true`) de jobs `succeeded`/`failed` finalizados há mais de 168 horas, e só remove registros quando `dry_run=false`. `POST /jobs/{job_id}/schedule` aceita `delay_seconds` ou `run_at` para reagendar jobs pendentes/falhos sem apagar histórico de erro/tentativas. Recorrências simples por intervalo ou cron básico usam `POST /jobs/{job_id}/recurrence`, `trigger_type`, `cron_expression`, `GET /job-schedules`, `POST /job-schedules/run-due` e `POST /job-schedules/{schedule_id}/disable`. Schedules orientados a evento usam `trigger_type="event"`, `event_type` e `POST /job-schedules/trigger-event`; o payload externo é redigido para chaves sensíveis óbvias antes de ser persistido no job.
Eventos podem ser acompanhados por polling em `GET /sessions/{session_id}/events`, por SSE em `GET /sessions/{session_id}/events/stream` ou por WebSocket em `/sessions/{session_id}/events/ws`, todos com suporte a `from_seq`.
`POST /sessions/{session_id}/turn/stream` preserva o mesmo contrato e idempotência de `POST /sessions/{session_id}/turn`, mas responde em SSE com `turn_started`, `token`, `turn_completed` e `stream_closed`. `WS /sessions/{session_id}/turn/stream/ws` oferece o mesmo ciclo por WebSocket usando `user_message` e `idempotency_key` na query. Tokens usam callback incremental do grafo/LLM quando disponível e carregam `source` para diferenciar `llm_callback` do fallback `assistant_message`.

## Autenticação

Com `AUTH_ENABLED=true`, o runtime exige `X-Agent-API-Key` nas rotas protegidas. `AGENT_API_KEY` mantém uma chave legada de acesso total. `AGENT_API_KEYS` permite múltiplas chaves com scopes como `metadata:read`, `auth:read`, `sessions:read`, `sessions:write`, `jobs:read`, `jobs:write`, `sessions:*` ou `*`. Em bundles multiagente, também é possível restringir por agente com `agents:<agent_id>:metadata:read`, `agents:<agent_id>:sessions:*`, `agents:<agent_id>:jobs:*`, `agents:<agent_id>:auth:read` ou `agents:<agent_id>:*`.
`AGENT_API_KEYS_PATH` aponta para um JSON local com o mesmo formato ou com `{ "keys": [{ "id": "...", "key": "...", "scopes": [...] }] }`; o runtime lê esse arquivo nas autenticações, permitindo rotação local sem rebuild ou restart. `GET /auth/keys` lista apenas `key_id`, origem e scopes, sem expor o valor bruto da chave.
Objetos de chave também aceitam `expires_at` ou `expiresAt` em ISO 8601 ou timestamp Unix; chaves expiradas são rejeitadas e aparecem com `expired=true` em `/auth/keys`.
`AGENT_API_REVOKED_KEY_IDS` e `AGENT_API_REVOKED_KEY_IDS_PATH` revogam chaves por `key_id` simples ou por identificador qualificado de origem, como `AGENT_API_KEYS_PATH:reader`; chaves revogadas são rejeitadas e aparecem com `revoked=true` em `/auth/keys`.
`AUTH_RATE_LIMIT_ENABLED=true` ativa limite local em memória por chave/scope, e `GET /auth/audit` lista a auditoria recente por `key_id`, scope, rota e status sem expor o valor da chave. Configure `AUTH_AUDIT_PATH` para persistir a auditoria local em JSONL.

```env
AUTH_ENABLED=true
AGENT_API_KEY=
AGENT_API_KEYS={"reader-key":["metadata:read","sessions:read"],"operator-key":["sessions:*"],"job-key":["jobs:*"]}
AGENT_API_KEYS_PATH=.agent-flow/api-keys.json
AGENT_API_REVOKED_KEY_IDS=
AGENT_API_REVOKED_KEY_IDS_PATH=.agent-flow/revoked-api-keys.json
AUTH_RATE_LIMIT_ENABLED=true
AUTH_RATE_LIMIT_REQUESTS=60
AUTH_RATE_LIMIT_WINDOW_SECONDS=60
AUTH_AUDIT_ENABLED=true
AUTH_AUDIT_MAX_ENTRIES=200
AUTH_AUDIT_PATH=.agent-flow/auth-audit.jsonl
```

O SSE de eventos em `GET /sessions/{session_id}/events/stream` e os WebSockets também aceitam a chave por query `api_key` quando o cliente de navegador não permite enviar header.

## Safety externo

O runtime sempre executa as regras locais do `safety_gate` primeiro. Se nenhuma regra local bloquear e `SAFETY_PROVIDER_ENABLED=true`, ele chama `SAFETY_PROVIDER_URL` por HTTP POST com `text`, `stage`, `nodeId`, `policy` e decisão local. A resposta pode usar campos como `blocked`, `decision`, `category`, `reason`, `safeResponse`, `severity` e `score`. Use `SAFETY_PROVIDER_HEADERS_JSON` apenas em `.env`, nunca no flow versionado.

```env
SAFETY_PROVIDER_ENABLED=true
SAFETY_PROVIDER_URL=https://safety.local/evaluate
SAFETY_PROVIDER_TIMEOUT_SECONDS=3
SAFETY_PROVIDER_FAIL_CLOSED=false
SAFETY_PROVIDER_HEADERS_JSON={"Authorization":"Bearer ..."}
```

## Execução local

```powershell
python -m pip install -e ".[dev]"
pytest -q
uvicorn app.main:app --reload --port 8080
```

Para processar jobs pós-finalização pendentes sem a UI:

```powershell
python -m app.worker --once
WORKER_INTERVAL_SECONDS=10 WORKER_LIMIT=50 WORKER_RETRY_DELAY_SECONDS=30 python -m app.worker
WORKER_LEASE_SECONDS=60 python -m app.worker --interval 5 --limit 20 --retry-delay 5
WORKER_CLEANUP_ENABLED=true WORKER_CLEANUP_OLDER_THAN_HOURS=168 python -m app.worker
```

Se o fluxo usa nó `code` em JavaScript ou TypeScript, o ambiente local também precisa ter `node` disponível. O Dockerfile gerado já instala `nodejs`/`npm` e executa `npm install --prefix app/code --omit=dev` para preparar dependências declaradas por `codeDependencies`.

## Container Docker

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

A cópia de `.env.example` é opcional para o caminho mock/local padrão; use-a quando precisar ajustar chaves, provider, auth ou variáveis operacionais. O `docker-compose.yml` aceita `.env` ausente, sobe com `MOCK_LLM=true` e o `.env.example` mantém `LANGSMITH_TRACING=false` para não enviar traces ao LangSmith Cloud por padrão.

A API fica em `http://127.0.0.1:8080/docs`.
O Compose também sobe o serviço `worker`, que executa jobs pós-finalização pendentes com `python -m app.worker`. Ajuste `WORKER_INTERVAL_SECONDS`, `WORKER_LIMIT`, `WORKER_RETRY_DELAY_SECONDS` e `WORKER_LEASE_SECONDS` no ambiente para controlar frequência, escala por ciclo, atraso de retry e tempo de lease sem reconstruir a imagem. A limpeza automática governada fica desligada por padrão; ative `WORKER_CLEANUP_ENABLED=true` para remover jobs terminais antigos após cada ciclo usando `WORKER_CLEANUP_OLDER_THAN_HOURS`, `WORKER_CLEANUP_LIMIT` e `WORKER_CLEANUP_STATUSES`. Para escala horizontal, suba múltiplas réplicas do serviço `worker`: cada processo claim jobs por `worker_id` e `locked_until`, outro worker ignora o job enquanto o lease está ativo e pode retomá-lo quando o lease expira.

## Validação LangSmith/LangGraph

Para testar no sandbox LangSmith/LangGraph, gere o pacote separado pelo botão `LangGraph` do builder ou pelo script `npm run codegen:sandbox`. Esse runtime é o alvo final FastAPI/Docker e não instala o CLI do LangGraph para evitar conflito de dependências com FastAPI.

Este pacote ainda inclui `langgraph.json` e `app/langgraph_app.py` para rastreabilidade do grafo aprovado, mas o artefato preferencial para upload/teste no LangSmith é `generated/reference-interview-langgraph-sandbox`.

## Nós

- `start_node` (start)
- `input_safety_check` (safety_gate)
- `llm_step` (llm_prompt)
- `output_safety_check` (safety_gate)
- `deterministic_gate` (code)
- `finish_node` (end)
