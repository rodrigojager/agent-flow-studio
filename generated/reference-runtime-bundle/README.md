# Reference Runtime

Bundle gerado a partir de `runtime.manifest.json`.

## Empacotamento

- ID: `reference-runtime`
- Versão: `0.1.0`
- Modo: `multiagent`

## Agentes

- `reference-interview`: `reference-interview`, rota `/reference-interview`, runtime `agents/reference-interview`

## Storage Compartilhado

- Banco: um único `DATABASE_URL` no processo raiz e nos agentes montados.
- Docker: serviço `postgres` compartilhado por todos os agentes do bundle.
- Namespacing: tabelas persistentes carregam `agent_id` para separar sessões, eventos, mensagens, jobs e registros operacionais.
- Validação opcional: rode `AGENT_FLOW_TEST_POSTGRES_URL=postgresql+psycopg2://... pytest -q -m integration` para provar escrita de dois agentes no mesmo Postgres real.

## Isolamento Operacional Por Agente

- Contrato: `.runtime-manifest/agent-isolation.json` e campo `agentIsolation` em `bundle.json`.
- Rota: cada agente possui `routePrefix` único e só expõe metadata/sessões dentro do próprio prefixo.
- Import: o app raiz limpa temporariamente módulos `app`/`app.*` e restaura `sys.path` ao montar cada runtime.
- Request/storage: idempotência é namespaced por rota, e sessões/eventos/jobs são namespaced por `agent_id`.
- Auth: scopes por agente seguem `agents:<agent_id>:...`.

## Orquestração Declarativa

- Contrato: `.runtime-manifest/orchestration.json` e campo `orchestration` em `bundle.json`.
- Modo: `sequential`.
- Entrada: `reference-interview`.
- Handoffs: 0 ligação(ões) declarativas entre agentes, sem payload bruto ou secrets.
- Execução inicial: `POST /orchestration/run` cria sessões nos agentes montados e executa `start`/`turn` seguindo entrada e handoffs do manifesto. Condições textuais continuam como anotação declarativa; condições explícitas como `input contains: texto`, `output contains: texto` e caminhos estruturados como `output.assistant_message.code == ECHO` controlam roteamento simples. A resposta inclui `shared_memory` governada com previews compactos das saídas e decisões e `debug_trace` com timeline step-by-step de plano, etapa, decisão de handoff e falha sanitizada para o Studio Local; para persistir esse resumo em JSONL, envie `memory_path`, `persist_memory=true` ou defina `ORCHESTRATION_MEMORY_PATH`.

Este bundle também contém um app FastAPI raiz que monta todos os agentes em um único processo, usando os `routePrefix` do manifesto.
## Execução do bundle compartilhado

```powershell
python -m pip install -e ".[dev]"
pytest -q
uvicorn app.main:app --reload --port 8080
```

## Operação Docker Fora do Studio

O bundle raiz é removível: copie este diretório para outro workspace, ajuste `.env` se necessário e suba a API raiz sem abrir o Builder.

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

Verificações rápidas:

```powershell
Invoke-RestMethod http://127.0.0.1:8080/health
Invoke-RestMethod http://127.0.0.1:8080/metadata
Invoke-RestMethod http://127.0.0.1:8080/openapi.json
```

Cada agente continua exposto no próprio prefixo de rota, por exemplo `/reference-interview/metadata` e `/reference-interview/sessions`.
