# Próximos Passos: APIs Agenticas Com Rotas Internas Customizadas

## Objetivo

Evoluir o Agent Flow Studio para que ele deixe de ser apenas um construtor de agentes expostos pelo contrato `sessions-v1` e passe a ser também um construtor completo de microserviços agenticos.

O objetivo final é permitir que um usuário crie do zero, dentro do Studio, uma API agentica prática e completa, com:

- múltiplos agentes com prefixos próprios de rota;
- endpoints conversacionais padronizados quando fizer sentido;
- endpoints internos e operacionais customizados;
- endpoints de observabilidade, saúde, métricas, auditoria e diagnóstico;
- endpoints para disparo manual de workers, jobs, schedules e rotinas de manutenção;
- endpoints de configuração e reload controlados por autenticação;
- endpoints não-IA mapeados para métodos internos, nós de flow, serviços auxiliares ou handlers customizados;
- geração de FastAPI/Docker removível, sem exigir edição manual do runtime exportado;
- representação visual e governada desses endpoints no Builder UI;
- testes gerados e documentação OpenAPI coerente com o que foi modelado.

A pergunta de aceite deixa de ser somente:

```text
O Studio consegue gerar um agente com sessão, turno e eventos?
```

E passa a ser:

```text
O Studio consegue gerar uma API agentica completa, com agentes e rotas de serviço, sem forçar o usuário a editar o runtime gerado manualmente?
```

## Estado Atual

Hoje o Studio já possui uma base forte:

- `agent.flow.json` modela agentes com nós, arestas, prompts, schemas, LLM, persistência, cache e triggers.
- O contrato `sessions-v1` gera endpoints de sessão, turno, transcript, eventos, streaming, jobs, auth e metadata.
- `runtime.manifest.json` permite bundle multiagente com `routePrefix` por agente.
- O runtime gerado já possui Postgres, Redis, worker, job schedules, cleanup, auditoria de auth e Docker Compose.
- O Builder API e o Builder UI já operam flows, artefatos, catálogo, validações, execução local, aprovação e exportação.
- Nós `code`, `http_request`, `database_query`, `database_save`, `analytics`, `scoring`, `safety_gate`, `rag_retrieval` e outros permitem comportamento customizado dentro do grafo.

A limitação central é que a superfície HTTP gerada é fechada em torno de `sessions-v1`. O usuário consegue mudar o nome do recurso principal, por exemplo `sessions`, `conversas` ou `atendimentos`, mas não consegue declarar livremente endpoints como:

```text
POST /internal/config/reload
GET /observability/runtime
POST /workers/aap/run
POST /jobs/reprocess-behavior
GET /settings/current
POST /v1/quiz
```

Essas rotas hoje só existiriam se alguém editasse o FastAPI gerado após a exportação, o que quebra a proposta do produto.

## Princípios De Produto

1. O usuário deve conseguir criar endpoints internos sem sair do Studio.
2. O runtime final deve ser removível e autossuficiente.
3. O contrato HTTP gerado deve ser previsível, documentado e testável.
4. Rotas customizadas devem entrar no hash de aprovação.
5. Nenhuma rota customizada deve expor secrets, paths locais ou payloads sensíveis por padrão.
6. Endpoints de serviço devem poder chamar lógica interna sem precisar simular uma conversa.
7. Endpoints conversacionais e endpoints operacionais devem coexistir.
8. O usuário deve conseguir usar a UI para entender quais endpoints existem, qual handler executam, quais schemas usam e quais permissões exigem.
9. O backend deve manter validação forte para evitar path traversal, conflito de rotas, conflito de nomes, handlers inexistentes e contratos ambíguos.
10. A experiência deve continuar local-first, com Docker Compose, testes e OpenAPI gerados.

## Resultado Esperado

Ao final, um usuário deve conseguir criar um projeto com a seguinte estrutura conceitual:

```text
API Agentica
  Agentes
    /v1/interviews
      POST /ensure
      POST /{id}/start
      POST /{id}/turn
      GET  /{id}/transcript
      POST /{id}/finish
    /v1/support-chat
      POST /ensure
      POST /{id}/turn
      GET  /{id}/transcript
      POST /{id}/finish
  Rotas Internas
    POST /internal/config/reload
    GET  /internal/config/status
  Observabilidade
    GET  /observability/runtime
    GET  /observability/jobs
    GET  /observability/events
  Workers
    POST /workers/run-due
    POST /workers/retry-failed
    POST /workers/aap-analytics/run
  Utilitários
    POST /v1/quiz
    POST /v1/safety/sandbox
```

Cada endpoint deve poder ser modelado, testado, documentado, aprovado e exportado pelo Studio.

## Nova Abstração: Service Routes

Adicionar ao Flow Spec uma abstração chamada `serviceRoutes`.

Ela representa endpoints HTTP customizados que não precisam seguir o ciclo de sessão `create/start/turn/finish`.

Exemplo inicial:

```json
{
  "api": {
    "contract": "service-v1",
    "resourceName": "sessions",
    "autoStartOnCreate": false,
    "serviceRoutes": [
      {
        "id": "reload-config",
        "method": "POST",
        "path": "/internal/config/reload",
        "summary": "Recarrega configurações em memória.",
        "description": "Executa o reload controlado das configurações runtime.",
        "kind": "internal",
        "handler": {
          "type": "code",
          "nodeId": "reload_config_handler"
        },
        "requestSchemaRef": "schemas/reload_config_request.schema.json",
        "responseSchemaRef": "schemas/reload_config_response.schema.json",
        "auth": {
          "mode": "api_key",
          "requiredScope": "internal:write"
        },
        "idempotency": {
          "enabled": false
        },
        "observability": {
          "emitEvent": true,
          "eventType": "config_reloaded"
        }
      }
    ]
  }
}
```

O campo `contract` precisa evoluir de literal único para uma enumeração compatível:

```text
sessions-v1
service-v1
sessions-and-service-v1
```

Interpretação:

- `sessions-v1`: mantém comportamento atual.
- `service-v1`: gera apenas rotas customizadas e rotas operacionais essenciais.
- `sessions-and-service-v1`: gera o contrato de sessão atual e também as rotas customizadas.

## Modelo De Dados Do Flow Spec

### ServiceRoute

Adicionar um schema Zod `ServiceRouteSchema` com os campos:

- `id`: identificador estável da rota.
- `method`: `GET`, `POST`, `PUT`, `PATCH` ou `DELETE`.
- `path`: caminho absoluto começando com `/`.
- `summary`: título curto para OpenAPI e UI.
- `description`: descrição opcional.
- `kind`: categoria da rota.
- `handler`: alvo executável.
- `requestSchemaRef`: schema JSON opcional para body.
- `responseSchemaRef`: schema JSON opcional para resposta.
- `querySchemaRef`: schema opcional para query params.
- `pathParamsSchemaRef`: schema opcional para path params.
- `auth`: política de autenticação/autorização.
- `idempotency`: política de idempotência.
- `rateLimit`: política local opcional.
- `timeoutSeconds`: limite de execução.
- `cache`: política de cache de resposta opcional.
- `observability`: emissão de eventos, span e auditoria.
- `deprecated`: marcação OpenAPI.
- `enabled`: permite manter rota desenhada, mas desativada.
- `tags`: tags OpenAPI.

### RouteKind

Categorias iniciais:

- `public`: rota pública do produto final.
- `agent`: rota relacionada a um agente.
- `internal`: rota interna entre serviços.
- `observability`: rota de métricas, eventos ou diagnóstico.
- `worker`: rota que dispara jobs, schedules ou worker cycles.
- `config`: rota de leitura ou atualização de configuração.
- `admin`: rota administrativa.
- `utility`: rota utilitária, como quiz, sandbox, normalização ou validação.
- `compatibility`: rota para compatibilidade com contratos externos.

### HandlerTarget

Tipos de handler:

- `code`: chama um nó `code` do flow.
- `flow_node`: inicia execução em um nó específico do grafo.
- `flow_trigger`: dispara um trigger já declarado no flow.
- `job`: cria ou executa um job.
- `worker`: executa uma rotina de worker.
- `builtin`: chama uma função interna suportada pelo runtime.
- `http`: proxy controlado para endpoint externo.
- `mcp`: chama tool MCP.
- `sidecar`: chama subprocesso/sidecar.
- `runtime_adapter`: chama adapter externo ou VM runner.

Exemplo:

```json
{
  "handler": {
    "type": "builtin",
    "builtin": "runtime.reload_config"
  }
}
```

Exemplo com nó:

```json
{
  "handler": {
    "type": "code",
    "nodeId": "generate_quiz"
  }
}
```

Exemplo com job:

```json
{
  "handler": {
    "type": "job",
    "jobKind": "aap_analytics",
    "mode": "enqueue"
  }
}
```

## Built-ins Iniciais Do Runtime

Criar um catálogo de built-ins seguros para evitar que o usuário precise escrever código para operações comuns.

### Observabilidade

- `runtime.health`: health detalhado.
- `runtime.metadata`: metadata sanitizada.
- `runtime.events.list`: lista eventos.
- `runtime.events.stream`: stream de eventos.
- `runtime.jobs.metrics`: métricas de jobs.
- `runtime.openapi.summary`: resumo de rotas.
- `runtime.storage.status`: status de banco, cache e checkpointer.

### Workers E Jobs

- `jobs.run_pending`: executa jobs pendentes.
- `jobs.retry_failed`: reprocessa falhas.
- `jobs.cleanup`: limpeza governada.
- `job_schedules.run_due`: executa schedules vencidos.
- `job_schedules.trigger_event`: dispara schedules por evento.
- `worker.run_once`: ciclo único do worker.
- `worker.status`: status operacional do worker.

### Configuração

- `runtime.config.status`: retorna fontes de configuração, sem valores sensíveis.
- `runtime.config.reload`: recarrega configuração runtime.
- `runtime.config.validate`: valida configuração atual.

### Segurança

- `auth.keys`: inventário sanitizado de chaves.
- `auth.audit`: auditoria.
- `safety.sandbox`: avaliação local de safety.
- `safety.provider_probe`: teste governado de provider externo.

### Agentes

- `agent.session.create`: cria sessão.
- `agent.session.start`: inicia sessão.
- `agent.session.turn`: processa turno.
- `agent.session.finish`: finaliza sessão.
- `agent.transcript.list`: transcript.
- `agent.events.list`: eventos.

Esses built-ins devem ter documentação, schemas e testes próprios.

## Mudanças No Runtime Gerado

### Gerador FastAPI

Alterar `packages/codegen-langgraph/src/pythonRuntimeTemplates.ts` para gerar:

- `app/routes/__init__.py`
- `app/routes/service_routes.py`
- `app/service_route_handlers.py`
- `app/service_route_schemas.py`
- `app/service_route_auth.py`
- `app/service_route_observability.py`

O `app/main.py` deve continuar criando o app principal, mas precisa incluir:

```python
from app.routes.service_routes import router as service_routes_router

app.include_router(service_routes_router)
```

Para cada `serviceRoute`, gerar uma função FastAPI tipada. Exemplo conceitual:

```python
@router.post(
    "/internal/config/reload",
    response_model=ReloadConfigResponse,
    tags=["internal", "config"],
)
def reload_config_endpoint(
    payload: ReloadConfigRequest,
    request: Request,
    db: Session = Depends(get_session),
    auth=Depends(require_service_scope("internal:write")),
):
    return execute_service_route(
        route_id="reload-config",
        payload=payload.model_dump(mode="json"),
        request=request,
        db=db,
    )
```

### Executor De Service Routes

Implementar um executor comum:

```python
def execute_service_route(route_id, payload, request, db):
    route = ROUTE_REGISTRY[route_id]
    with service_route_span(route, request):
        authorize_route(route, request)
        validate_payload(route, payload)
        result = dispatch_route_handler(route, payload, request, db)
        validate_response(route, result)
        emit_route_event(route, result)
        return result
```

Esse executor deve centralizar:

- autenticação;
- idempotência;
- auditoria;
- rate limit;
- timeout;
- redaction;
- emissão de eventos;
- logs estruturados;
- validação de schema;
- erros HTTP padronizados.

### Registry De Rotas

Gerar um registry Python:

```python
SERVICE_ROUTES = {
    "reload-config": {
        "method": "POST",
        "path": "/internal/config/reload",
        "kind": "internal",
        "handler": {"type": "builtin", "builtin": "runtime.config.reload"},
        "auth": {"mode": "api_key", "requiredScope": "internal:write"},
    }
}
```

Esse registry também deve aparecer em `/metadata`, sem secrets.

### OpenAPI

Cada rota customizada deve aparecer no `/openapi.json` com:

- path correto;
- método correto;
- tags;
- summary;
- request body;
- response model;
- status codes;
- auth scheme;
- deprecation quando aplicável.

### Erros Padronizados

Criar modelo comum:

```json
{
  "detail": "Mensagem segura.",
  "error_code": "route_handler_failed",
  "route_id": "reload-config",
  "correlation_id": "..."
}
```

Não retornar stack trace, secrets, headers brutos, URLs com query sensível ou paths absolutos.

## Mudanças No Bundle Multiagente

O `runtime.manifest.json` precisa permitir rotas de bundle além de rotas por agente.

Exemplo:

```json
{
  "serviceRoutes": [
    {
      "id": "bundle-worker-run-due",
      "method": "POST",
      "path": "/workers/run-due",
      "handler": {
        "type": "builtin",
        "builtin": "worker.run_once"
      }
    }
  ],
  "agents": [
    {
      "id": "interviews",
      "flowPath": "flows/interviews/agent.flow.json",
      "routePrefix": "/v1/interviews"
    },
    {
      "id": "support-chat",
      "flowPath": "flows/support-chat/agent.flow.json",
      "routePrefix": "/v1/support-chat"
    }
  ]
}
```

### Rotas Por Agente

Cada agente deve poder ter:

- o contrato `sessions-v1` padrão;
- rotas customizadas próprias montadas sob seu `routePrefix`;
- rotas de compatibilidade.

Exemplo:

```text
/v1/interviews/sessions
/v1/interviews/{entrevistaid}/behavior-analysis
/v1/support-chat/ensure
/v1/support-chat/{conversation_id}/turn
```

### Rotas Do Bundle

Rotas do bundle ficam no app raiz:

```text
/health
/metadata
/orchestration/run
/workers/run-due
/observability/runtime
/internal/config/reload
```

### Conflitos

O validador deve impedir:

- duas rotas com mesmo método e path;
- rota customizada colidindo com `/health`, `/metadata`, `/openapi.json` ou docs;
- rota de bundle colidindo com `routePrefix` de agente;
- routePrefix de agente colidindo com rota estática raiz;
- path param ambíguo no mesmo nível, por exemplo `/{id}` e `/{slug}` no mesmo prefixo.

## Mudanças No Builder API

### Endpoints Novos Do Builder

Adicionar rotas no Builder API para CRUD de service routes:

```text
GET    /flows/:flowId/service-routes
POST   /flows/:flowId/service-routes
GET    /flows/:flowId/service-routes/:routeId
PUT    /flows/:flowId/service-routes/:routeId
DELETE /flows/:flowId/service-routes/:routeId
POST   /flows/:flowId/service-routes/:routeId/validate
POST   /flows/:flowId/service-routes/:routeId/test
POST   /flows/:flowId/service-routes/:routeId/generate-schemas
POST   /flows/:flowId/service-routes/:routeId/duplicate
```

Para manifestos:

```text
GET    /runtime-manifest/service-routes
POST   /runtime-manifest/service-routes
PUT    /runtime-manifest/service-routes/:routeId
DELETE /runtime-manifest/service-routes/:routeId
POST   /runtime-manifest/service-routes/:routeId/test
```

### Validação Backend

O Builder API deve validar:

- método e path;
- path começando com `/`;
- path sem `..`, `//`, caracteres inválidos ou query string embutida;
- path params compatíveis com schema;
- request/response schema existentes;
- handler existente;
- permissões válidas;
- scopes consistentes;
- idempotência obrigatória para mutações quando configurada como padrão do workspace;
- rotas desativadas não geradas no runtime, salvo opção explícita de gerar como 404/410;
- conflitos contra rotas geradas automaticamente.

### Teste Local De Rota

O Builder API deve permitir testar uma rota sem gerar o runtime completo, quando possível.

Fluxo:

1. UI envia payload de teste.
2. Builder API carrega flow e route.
3. Builder API executa handler em modo sandbox/local, se o handler permitir.
4. Retorna:
   - status;
   - body;
   - headers seguros;
   - eventos gerados;
   - logs sanitizados;
   - tempo;
   - spans;
   - diagnóstico de schema.

Quando o handler depende do runtime final, o Builder API deve exibir uma resposta explicando que o teste exige sandbox/runtime gerado.

### Geração De Schemas

Adicionar assistente para criar schemas iniciais:

- request vazio;
- response padrão;
- erro padrão;
- query params;
- path params detectados automaticamente.

Exemplo para `/workers/{worker_id}/run`:

```json
{
  "type": "object",
  "properties": {
    "worker_id": {
      "type": "string"
    }
  },
  "required": ["worker_id"]
}
```

## Mudanças No Banco De Dados Do Runtime

O runtime gerado já possui tabelas de sessões, eventos, mensagens, jobs e idempotência. Para rotas customizadas, adicionar tabelas opcionais:

### service_route_invocations

Registra chamadas de rotas customizadas.

Campos:

- `invocation_id`
- `route_id`
- `method`
- `path_template`
- `status_code`
- `status`
- `duration_ms`
- `actor_id`
- `key_id`
- `correlation_id`
- `idempotency_key`
- `request_hash`
- `response_hash`
- `error_code`
- `created_at`

Não armazenar payload bruto por padrão.

### service_route_events

Eventos operacionais específicos de rotas.

Campos:

- `event_id`
- `route_id`
- `seq`
- `event_type`
- `payload`
- `created_at`

Payload deve ser sanitizado.

### service_route_artifacts

Opcional para rotas que geram artefatos.

Campos:

- `artifact_id`
- `route_id`
- `kind`
- `content_type`
- `storage_ref`
- `sha256`
- `created_at`

Por padrão, evitar armazenar conteúdo bruto no banco.

## Migrações

O codegen deve gerar migrations aditivas:

```text
migrations/002_service_routes.sql
```

Ou incorporar no `init_db()` com proteção para:

- SQLite em testes;
- Postgres real;
- criação concorrente entre API e worker;
- upgrade de runtimes anteriores.

## Integração Com Auth

Hoje o runtime já possui API keys e scopes. Service routes devem reutilizar essa base.

### Modos De Auth

- `none`: somente para rotas locais explicitamente públicas.
- `api_key`: usa `X-Agent-API-Key` ou `Authorization: Bearer`.
- `internal_token`: usa header configurável, por exemplo `X-Agent-Internal-Token`.
- `agent_scope`: scopes por agente em bundles.
- `custom`: handler de auth customizado.

### Scopes Padrão

- `service-routes:read`
- `service-routes:write`
- `observability:read`
- `workers:write`
- `config:read`
- `config:write`
- `internal:write`
- `agents:<agent_id>:service-routes:read`
- `agents:<agent_id>:service-routes:write`

### UI De Auth

Na aba `Governança`, adicionar uma seção `Rotas da API` mostrando:

- rotas públicas;
- rotas internas;
- scopes exigidos;
- rotas sem auth, destacadas como risco;
- rotas com token interno;
- rotas com rate limit;
- rotas com auditoria ligada/desligada.

## Integração Com Observabilidade

Cada service route deve emitir:

- span de início;
- span de fim;
- evento de sucesso ou falha;
- métrica de duração;
- contagem por status code;
- contagem por route kind;
- erro agregado por `error_code`;
- correlação com job, agente ou sessão quando aplicável.

### Endpoints Gerados De Observabilidade

Adicionar built-ins e rotas opcionais:

```text
GET /observability/routes
GET /observability/routes/:route_id
GET /observability/routes/:route_id/invocations
GET /observability/runtime
GET /observability/storage
GET /observability/jobs
```

Esses endpoints devem ser opt-in no flow ou no manifesto para não inflar runtimes simples.

## Interface: Nova Aba "API"

Adicionar uma aba principal chamada `API`.

Local sugerido:

```text
Builder UI
  Visão
  Canvas
  Arquivos
  Validação
  Studio
  API
  Catálogo
  Governança
  Artefato
```

### Objetivo Da Aba

Permitir que o usuário modele a superfície HTTP final de forma visual e prática.

### Layout

Dividir a tela em três áreas:

1. Lista lateral de rotas.
2. Editor central da rota selecionada.
3. Painel direito de contrato, teste e diagnóstico.

### Lista De Rotas

Mostrar agrupamento por categoria:

- Sessões geradas automaticamente.
- Rotas customizadas.
- Observabilidade.
- Workers.
- Configuração.
- Internas.
- Rotas por agente.

Cada item deve mostrar:

- método com cor discreta;
- path;
- status de validação;
- auth resumida;
- handler;
- tag de enabled/disabled/deprecated;
- indicador de conflito.

Interações:

- criar rota;
- duplicar rota;
- remover rota;
- desativar rota;
- filtrar por método, kind, agente, auth e status;
- busca por path ou handler;
- ordenar por path, método ou categoria.

### Editor De Rota

Campos:

- ID.
- Método.
- Path.
- Summary.
- Description.
- Categoria.
- Tags.
- Enabled.
- Deprecated.
- Agente associado, quando aplicável.
- Prefixo efetivo.
- Handler type.
- Handler target.
- Request schema.
- Response schema.
- Query schema.
- Path params schema.
- Auth mode.
- Required scope.
- Idempotency.
- Timeout.
- Rate limit.
- Observability.

Não usar texto explicativo excessivo dentro da interface. Usar tooltips em ícones e diagnósticos curtos.

### Seletor De Handler

Componente principal para mapear rota para comportamento.

Opções:

- Built-in.
- Nó do flow.
- Trigger.
- Job.
- Worker.
- HTTP.
- MCP.
- Sidecar.
- Runtime adapter.

Para `Built-in`, mostrar catálogo pesquisável:

- Health.
- Metadata.
- Jobs.
- Worker.
- Config.
- Safety.
- Auth.
- Observability.

Para `Nó do flow`, mostrar nós compatíveis:

- `code`
- `database_query`
- `database_save`
- `http_request`
- `transform_json`
- `analytics`
- `scoring`
- `rag_retrieval`

Para `Job`, mostrar:

- tipo do job;
- modo `enqueue`, `run_now`, `retry`, `schedule`;
- payload mapping;
- resposta síncrona ou assíncrona.

### Editor De Mapping

Service routes precisam mapear HTTP para input interno.

Criar um editor de mapping visual:

```text
request.body.user_message -> input.user_message
request.path.empresa_id   -> input.empresa_id
request.query.force       -> input.force
request.headers.X-Trace   -> context.trace_id
```

Também permitir JSON avançado:

```json
{
  "input": {
    "empresa_id": "{{path.empresa_id}}",
    "force": "{{body.force}}",
    "actor": "{{auth.actor_id}}"
  }
}
```

O editor deve validar:

- path param inexistente;
- campo obrigatório sem origem;
- segredo em mapping para resposta;
- tipos incompatíveis com schema;
- rota sem response mapping.

### Painel De Teste

Na aba `API`, para cada rota:

- formulário gerado pelo schema de request;
- campos de path params;
- campos de query params;
- headers permitidos;
- botão `Testar`;
- botão `Testar no runtime`;
- botão `Copiar curl`;
- resposta;
- status code;
- tempo;
- eventos;
- logs sanitizados;
- validação de schema.

O teste local deve ser possível para built-ins e handlers simples. Para rotas dependentes do runtime final, orientar a usar o sandbox/runtime.

### Painel OpenAPI

Mostrar preview da rota como OpenAPI:

- path;
- method;
- requestBody;
- responses;
- security;
- tags.

Adicionar ação:

- `Exportar OpenAPI parcial`;
- `Comparar com runtime gerado`;
- `Ver conflitos`.

## Interface: Canvas

No canvas, rotas customizadas devem aparecer de forma integrada sem poluir o grafo principal.

### Entrada Por Rota

Adicionar um tipo visual de entrada chamado `API Route`.

Ele representa uma rota que inicia um subfluxo ou chama um handler.

Exemplo:

```text
[POST /v1/quiz] -> [generate_quiz code] -> [response mapping]
```

Esse nó deve ser diferente de `start`, porque ele representa uma entrada HTTP direta e não o ciclo de sessão.

### Node Type Novo

Adicionar `api_route` ao catálogo de nós apenas se a decisão de arquitetura for representar rotas também no grafo.

Alternativa mais simples:

- manter service routes fora de `nodes`;
- permitir handler apontar para nós existentes.

Recomendação:

- fase 1: service routes fora do grafo;
- fase 2: visualização opcional como camada de entrada no canvas.

### Visualização De Rotas No Canvas

Adicionar filtro/camada:

- `Fluxo agentico`;
- `Entradas HTTP`;
- `Jobs`;
- `Observabilidade`;
- `Tudo`.

Quando a camada `Entradas HTTP` estiver ativa:

- mostrar chips de endpoints conectados aos handlers;
- permitir clicar no chip para abrir o editor na aba `API`;
- exibir conflitos visualmente.

## Interface: Visão

Na aba `Visão`, adicionar um bloco `Superfície da API`.

Conteúdo:

- total de endpoints;
- endpoints gerados por contrato;
- endpoints customizados;
- endpoints internos;
- endpoints sem auth;
- endpoints com erro de schema;
- endpoints por agente;
- rotas deprecated;
- rotas desativadas.

Ações:

- `Abrir API`;
- `Validar rotas`;
- `Gerar OpenAPI`;
- `Testar endpoints principais`.

## Interface: Studio

Na aba `Studio`, adicionar suporte a execução de service routes.

### Seção "Chamadas De API"

Mostrar histórico local de chamadas:

- rota;
- método;
- status;
- duração;
- handler;
- actor;
- correlation id;
- eventos emitidos.

### Execução Ao Vivo

Quando uma rota customizada for testada:

- exibir spans;
- logs;
- eventos;
- payload sanitizado;
- chamadas a nós;
- jobs criados;
- resposta final.

### Depuração

Permitir abrir:

- input mapping;
- output mapping;
- handler;
- job associado;
- evento associado;
- chamada de banco, se houver.

## Interface: Governança

Adicionar painel `Governança De Rotas`.

Itens:

- rotas sem auth;
- rotas internas públicas por engano;
- rotas com método mutável sem idempotência;
- rotas que chamam código customizado sem sandbox adequado;
- rotas que expõem dados operacionais;
- rotas com response schema ausente;
- rotas que usam headers sensíveis;
- rotas com payload logging habilitado.

Ações:

- aplicar scope sugerido;
- ligar auditoria;
- exigir idempotência;
- marcar como interna;
- desativar rota;
- exportar relatório `.afapigovernance.json`.

## Interface: Artefato

Na aba `Artefato`, mostrar:

- arquivos gerados para service routes;
- OpenAPI completo;
- lista de endpoints;
- curl examples;
- runbook operacional;
- testes gerados;
- migrations geradas.

Adicionar filtros:

- rotas de sessão;
- rotas customizadas;
- rotas internas;
- rotas por agente;
- observabilidade;
- workers.

## Interface: Catálogo

Adicionar templates de rotas reutilizáveis.

### Templates Built-in

- Health avançado.
- Runtime status.
- Config reload.
- Worker run once.
- Jobs metrics.
- Safety sandbox.
- Quiz simples.
- Webhook receiver.
- Reprocess pending.
- Internal token protected route.
- Public read-only utility route.

### Pacote Exportável

Permitir exportar/importar `.afroutes.json`.

Conteúdo:

- rotas;
- schemas;
- mappings;
- handlers referenciados;
- políticas de auth;
- governança sanitizada.

## Builder API E UI: Fluxo De Usuário

### Criar Rota Simples

1. Usuário abre aba `API`.
2. Clica em `Nova rota`.
3. Escolhe template `Utilitário`.
4. Define `POST /v1/quiz`.
5. Escolhe handler `code`.
6. Seleciona ou cria nó `generate_quiz`.
7. Cria request schema com campo `prompt`.
8. Cria response schema com campo `resposta`.
9. Testa payload.
10. Valida rota.
11. Gera runtime.
12. OpenAPI contém `/v1/quiz`.

### Criar Rota Interna

1. Usuário abre aba `API`.
2. Escolhe template `Config reload`.
3. Path sugerido: `/internal/config/reload`.
4. Handler sugerido: `runtime.config.reload`.
5. Auth sugerido: `internal_token`.
6. Scope sugerido: `config:write`.
7. Auditoria ligada por padrão.
8. Payload vazio.
9. Response schema gerado.
10. Teste retorna status sanitizado.

### Criar Worker Manual

1. Usuário abre aba `API`.
2. Escolhe template `Worker run due`.
3. Path: `/workers/run-due`.
4. Handler: `job_schedules.run_due`.
5. Request schema: `limit`, `worker_id`.
6. Response schema: jobs processados, falhas, duração.
7. Auth: `workers:write`.
8. Observability ligada.
9. Rota aparece no runbook.

### Criar Multiagente Com Prefixos

1. Usuário abre Runtime Manifest.
2. Adiciona agente `interviews` com prefixo `/v1/interviews`.
3. Adiciona agente `support-chat` com prefixo `/v1/support-chat`.
4. Para cada agente, define rotas próprias.
5. O validador verifica conflitos.
6. O bundle gera app raiz com agentes montados.
7. OpenAPI raiz inclui todos os prefixos.

## Backend: Implementação Por Fases

### Fase 1: Especificação E Validação

Objetivo: representar service routes no modelo, sem ainda gerar runtime completo.

Tarefas:

- Criar `ServiceRouteSchema`.
- Criar `ServiceRouteHandlerSchema`.
- Criar `ServiceRouteAuthSchema`.
- Criar `ServiceRouteObservabilitySchema`.
- Expandir `AgentFlowSchema.api`.
- Expandir `RuntimeManifestSchema`.
- Adicionar diagnósticos de rotas.
- Atualizar `agentFlowJsonSchema()`.
- Atualizar `runtimeManifestJsonSchema()`.
- Criar testes de validação.

Critérios de aceite:

- Flow com service routes passa no parser.
- Rotas inválidas geram diagnósticos claros.
- Conflitos de método/path são detectados.
- Handlers inexistentes são detectados.
- Schemas inexistentes são detectados.

### Fase 2: Builder API

Objetivo: CRUD e validação de rotas pelo backend do Studio.

Tarefas:

- Implementar endpoints `/flows/:flowId/service-routes`.
- Implementar endpoints equivalentes para manifestos.
- Persistir mudanças no `agent.flow.json`.
- Integrar com assets de schemas.
- Criar geração de schemas iniciais.
- Criar teste local de rota para built-ins simples.
- Incluir rotas no resumo de validação do flow.

Critérios de aceite:

- Usuário consegue criar, editar e remover rota via API.
- Validação aponta rota com erro sem corromper o flow.
- Testes de Builder API cobrem CRUD, conflitos e schemas.

### Fase 3: Codegen FastAPI

Objetivo: gerar rotas customizadas no runtime final.

Tarefas:

- Gerar registry de rotas.
- Gerar `service_routes.py`.
- Gerar modelos Pydantic por schema.
- Gerar dispatcher.
- Gerar auth por rota.
- Gerar observability por rota.
- Incluir rotas no `main.py`.
- Incluir rotas no `/metadata`.
- Incluir migrations opcionais.
- Atualizar README gerado.
- Atualizar `.env.example`.
- Atualizar Docker Compose se houver worker/config route.

Critérios de aceite:

- Runtime gerado sobe.
- `/openapi.json` contém rotas customizadas.
- Rota built-in executa.
- Rota com nó `code` executa.
- Erros são seguros.
- Testes gerados passam.

### Fase 4: UI Aba API

Objetivo: permitir modelagem visual das rotas.

Tarefas:

- Criar aba `API`.
- Criar lista de rotas.
- Criar editor de rota.
- Criar seletor de handler.
- Criar editor de auth.
- Criar editor de schemas.
- Criar editor de mapping.
- Criar painel de teste.
- Criar preview OpenAPI.
- Integrar com validação.
- Integrar com dirty state e salvamento.

Critérios de aceite:

- Usuário cria rota sem editar JSON.
- Usuário seleciona handler.
- Usuário gera schema inicial.
- Usuário testa rota.
- Diagnósticos navegam para o campo correto.

### Fase 5: Multiagente E Bundle

Objetivo: suportar rotas customizadas por agente e no app raiz.

Tarefas:

- Adicionar `serviceRoutes` no manifesto.
- Permitir rotas por agente.
- Permitir rotas de bundle.
- Atualizar codegen de bundle.
- Atualizar isolamento por rota.
- Atualizar auth por agente.
- Atualizar OpenAPI raiz.
- Atualizar testes multiagente.

Critérios de aceite:

- Dois agentes com prefixos diferentes têm rotas próprias.
- Rota raiz de worker não colide com agentes.
- Idempotência é namespaced corretamente.
- OpenAPI raiz mostra tudo.

### Fase 6: Observabilidade E Governança

Objetivo: tornar service routes operáveis.

Tarefas:

- Criar tabelas de invocação.
- Criar eventos por rota.
- Criar métricas por rota.
- Criar painel em `Studio`.
- Criar painel em `Governança`.
- Criar export governado.
- Criar filtros por status, handler, kind e actor.

Critérios de aceite:

- Chamada de rota aparece no Studio.
- Métricas agregadas funcionam.
- Falha aparece com erro seguro.
- Governança identifica rota interna sem auth.

### Fase 7: Catálogo E Templates

Objetivo: tornar criação prática para usuários não especialistas.

Tarefas:

- Criar templates de rotas.
- Criar pacote `.afroutes.json`.
- Permitir aplicar template no flow.
- Permitir salvar rota existente no catálogo.
- Criar comparação/diff de pacotes.
- Criar governança de templates.

Critérios de aceite:

- Usuário cria endpoint de worker a partir de template.
- Usuário exporta/importa rotas entre workspaces.
- Templates não carregam secrets.

## Testes Necessários

### Flow Spec

- parse de `sessions-v1` legado.
- parse de `sessions-and-service-v1`.
- service route com built-in.
- service route com nó `code`.
- conflito de método/path.
- path inválido.
- handler inexistente.
- schema inexistente.
- auth inválida.
- routePrefix com conflito.

### Builder API

- CRUD de rotas.
- geração de schema.
- validação de rota.
- teste local de built-in.
- bloqueio de path traversal.
- import/export de workspace com rotas.
- catálogo de templates.

### Codegen Runtime

- runtime com apenas `sessions-v1`.
- runtime com `sessions-and-service-v1`.
- runtime com rota `GET`.
- runtime com rota `POST`.
- rota com path params.
- rota com query params.
- rota com request body.
- rota com response schema.
- rota com built-in.
- rota com nó `code`.
- rota com job enqueue.
- rota com auth.
- rota sem auth marcada como pública.
- rota com idempotência.
- rota com erro de handler.
- OpenAPI contém schemas.
- README contém endpoints.

### Bundle Multiagente

- agente A e agente B com prefixos.
- rota customizada por agente.
- rota customizada raiz.
- conflito de rotas bloqueado.
- scopes por agente.
- storage namespaced por `agent_id`.
- OpenAPI raiz.

### UI

- criação de rota.
- edição de método/path.
- seleção de handler.
- geração de schema.
- teste de rota.
- diagnóstico de conflito.
- filtros de lista.
- preview OpenAPI.
- tela compacta/mobile.
- tema claro/escuro.

## Compatibilidade Com O Contrato Atual

Não quebrar usuários existentes.

Regras:

- Flows sem `serviceRoutes` continuam iguais.
- `api.contract = "sessions-v1"` continua válido.
- `resourceName` continua funcionando.
- Runtime gerado antigo continua com os mesmos endpoints.
- Bundle multiagente atual continua montando agentes por `routePrefix`.
- Novos campos devem ter defaults seguros.

## Riscos

### Complexidade De Produto

Adicionar rotas customizadas pode transformar o Studio em um construtor de backend genérico demais.

Mitigação:

- limitar fase inicial a handlers seguros;
- usar templates;
- manter UI orientada por casos comuns;
- esconder opções avançadas atrás de seções expansíveis.

### Segurança

Rotas internas podem ser expostas sem auth.

Mitigação:

- auth sugerida por kind;
- alerta forte para `internal` sem auth;
- governança bloqueante opcional;
- auditoria ligada por padrão em rotas internas.

### OpenAPI Complexo

Gerar Pydantic a partir de JSON Schema pode ter limitações.

Mitigação:

- começar com schemas simples;
- fallback para `dict[str, Any]` com validação JSON Schema manual;
- melhorar geração Pydantic depois.

### Handler Ambíguo

Usuário pode não entender diferença entre nó, trigger, job e built-in.

Mitigação:

- templates;
- seletor de handler com categorias;
- preview do fluxo de execução;
- teste rápido.

### Manutenção Do Codegen

O template Python já é grande.

Mitigação:

- extrair renderizadores menores;
- criar arquivos Python separados;
- adicionar snapshots focados;
- evitar inflar `main.py`.

## Marcos De Entrega

### Marco 1: Contrato Declarativo

Entregável:

- Flow Spec com `serviceRoutes`.
- Validação e testes.
- Sem UI completa.

Valor:

- base técnica segura para tudo que vem depois.

### Marco 2: Runtime Com Built-ins

Entregável:

- codegen gera rotas customizadas para built-ins.
- OpenAPI correto.
- testes gerados.

Valor:

- já permite health avançado, config reload, worker run e observabilidade.

### Marco 3: UI Aba API

Entregável:

- usuário cria e edita rotas pela interface.
- teste local básico.
- preview OpenAPI.

Valor:

- recurso vira produto, não só JSON manual.

### Marco 4: Handlers Customizados

Entregável:

- rotas chamam nós `code`, jobs, HTTP, MCP e triggers.
- mapping visual.

Valor:

- endpoints internos e utilitários reais.

### Marco 5: Multiagente Completo

Entregável:

- rotas por agente e rotas de bundle.
- isolamento e scopes por agente.

Valor:

- microserviço agentico completo com múltiplas áreas funcionais.

### Marco 6: Governança E Operação

Entregável:

- métricas por rota.
- auditoria.
- governança.
- catálogo de templates.

Valor:

- uso prático em ambiente real.

## Definição De Pronto

O recurso só deve ser considerado pronto quando for possível:

1. Criar uma rota customizada pela UI.
2. Mapear a rota para um built-in.
3. Mapear a rota para um nó `code`.
4. Validar request e response por schema.
5. Exigir auth e scope.
6. Gerar runtime FastAPI sem editar arquivos manualmente.
7. Ver a rota no OpenAPI.
8. Rodar teste gerado.
9. Ver chamada da rota no Studio.
10. Ver auditoria e métricas da rota.
11. Exportar o runtime Docker e executar fora do Studio.
12. Fazer o mesmo em bundle multiagente com prefixos.

## Exemplo Final Desejado

Um usuário cria dois agentes:

```text
interviews      -> /v1/interviews
support-chat    -> /v1/support-chat
```

Depois adiciona rotas customizadas:

```text
POST /v1/quiz
POST /v1/safety/sandbox
POST /internal/config/reload
GET  /observability/runtime
POST /workers/run-due
POST /workers/retry-failed
```

O Studio gera:

- FastAPI com todas as rotas;
- OpenAPI completo;
- Docker Compose com API, worker, Postgres e Redis;
- migrations;
- testes;
- README/runbook;
- metadata sanitizada;
- auth scopes;
- eventos e métricas.

O usuário consegue operar tudo sem editar o runtime gerado.
