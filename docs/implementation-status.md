# Status de Implementação

Última atualização: 2026-06-30.

## Implementado

- Estrutura ICM do workspace.
- Plano consolidado em `docs/plan.md`.
- ADRs de arquitetura de `0001` a `0018`.
- Baseline manual em `examples/reference-interview-runtime/`.
- Contrato FastAPI baseado em `/sessions`.
- Idempotência por `Idempotency-Key` com fallback `idempotency_key`.
- Transcript separado de eventos.
- LangGraph real no baseline.
- Persistência pública com SQLAlchemy.
- Checkpointer LangGraph com fallback in-memory para testes e opção Postgres para ambiente real.
- Cache quente Redis com fallback in-memory.
- LLMClient OpenAI/OpenAI-compatible/OpenRouter com mock determinístico.
- Safety Gate simples de entrada e saída.
- API key simples por header.
- Dockerfile, Docker Compose, `.env.example` e migration SQL do baseline.
- Flow de referência em `flows/reference-interview/agent.flow.json`.
- Flow Spec inicial em Zod/TypeScript.
- Flow Spec expõe catálogo canônico de adapters LLM com OpenAI, OpenAI-compatible, OpenRouter e entradas planejadas para opencode Go/Zen.
- Codegen em TypeScript gerando runtime Python executável em `generated/reference-interview-runtime/`.
- Validação mínima de equivalência do baseline: o runtime manual e o runtime gerado exercitam o mesmo contrato `/sessions`, idempotência, transcript, eventos, safety e fluxo LangGraph de referência.
- Verificação automatizada de paridade estrutural em `tools/verify_runtime_parity.py`, comparando flow spec, OpenAPI, schemas principais, metadata e cenários normalizados entre baseline manual e runtime gerado.
- Builder API em `apps/builder-api/` para criar, listar, ler, validar e gerar flows versionáveis.
- Builder UI inicial em `apps/builder-ui/` com canvas React Flow, lista de flows, criação de flow por template inicial, inspector, preview JSON, edição básica de propriedades, salvamento do `agent.flow.json` e ações de validar/gerar via Builder API.
- Builder API persiste flows versionáveis com `PUT /flows/{flowId}`, valida Flow Spec antes de gravar e bloqueia divergência de `id`.
- Builder API cria novos workspaces de flow com template inicial de conversa guiada, incluindo prompt, schema de estado, safety, switch, LLM, human input, gate determinístico e finish.
- Flow Spec expõe análise estruturada de flows com diagnósticos de grafo, referências, nós, arestas e compatibilidade inicial de codegen.
- Builder API cria, lê, salva e remove prompts Markdown e schemas JSON referenciados pelo flow, com validação de path dentro do diretório do flow, validação JSON para schemas e bloqueio de remoção quando o asset ainda está em uso.
- Builder API retorna validação visual rica com diagnósticos estruturados, contagem de erros/avisos e checagem de assets referenciados.
- Builder API expõe catálogo de adapters LLM via `/llm-adapters`.
- Builder API exporta e importa pacotes JSON versionados de workspace de flow, contendo `agent.flow.json`, prompts e schemas referenciados, com proteção contra conflito e path traversal.
- Builder API lista, lê e empacota artefatos gerados dentro de `generated/` via `/artifacts`, `/artifacts/file` e `/artifacts/archive`.
- Builder UI possui aba `Arquivos` para criar, remover e editar prompts e schemas referenciados pelo flow antes de validar, gerar ou iniciar sandbox.
- Builder UI permite exportar e importar workspace de flow pela toolbar, salvando alterações pendentes antes de exportar.
- Builder UI possui aba `Artefato` para pré-visualizar arquivos do runtime ou bundle gerado e baixar um zip do projeto.
- Builder UI possui aba `Validação` para exibir diagnósticos estruturados e navegar para nós, arestas, prompts ou schemas afetados.
- Builder UI permite editar adapter/modelo/env vars do LLM padrão do flow e adapter/modelo de nós LLM.
- Builder UI permite criar, remover, mover, conectar e reconectar nós/arestas no canvas, com posições persistidas no `agent.flow.json`.
- Flow Spec aceita `position` opcional em nós para preservar layout visual sem afetar o runtime gerado.
- Codegen LangGraph monta o grafo gerado a partir dos nós e arestas do `agent.flow.json`, com handlers por tipo de nó e eventos baseados nos nós realmente executados.
- Codegen LangGraph executa nós dedicados de `switch` e `human_input`, incluindo condições simples com `and`, comparações de estado e eventos operacionais específicos.
- Flow Spec, Builder UI e Codegen LangGraph possuem suporte inicial a nós avançados determinísticos `http_request`, `transform_json`, `database_query`, `database_save`, `file_extract` e `rag_retrieval`, com configuração visual, execução no runtime gerado, suporte a `mock://echo` para testes sem rede, tabela genérica `agent_node_records` para gravações JSON, cópia de assets de `files/` para `app/files/`, extração de texto/Markdown/PDF opcional via `pypdf`, busca lexical RAG local e eventos próprios em `/events`.
- Flow Spec, Builder UI e Codegen LangGraph possuem suporte inicial a nós `approval_gate`, `scoring` e `analytics`, com configuração visual, execução no runtime gerado e eventos próprios em `/events`.
- Codegen LangGraph valida adapters LLM pelo catálogo, gera runtime apenas com o adapter selecionado e respeita overrides de adapter/modelo em nós LLM.
- Codegen possui testes end-to-end com flow simplificado sem `deterministic_gate`, flow com `switch`/`human_input`, flow com `http_request`/`transform_json`, flow com `database_query`/`database_save`, flow com `file_extract`/`rag_retrieval`, flow com `approval_gate`/`scoring`/`analytics` e bundle multiagente, gerando runtimes temporários e executando pytest nos artefatos gerados.
- Flow Spec define `RuntimeManifest` para agrupamento monoagente ou multiagente, com agentes referenciando `agent.flow.json` por `flowPath`.
- Codegen gera bundle a partir de `runtime.manifest.json`, com metadados, README e um runtime independente por agente em `generated/reference-runtime-bundle/agents/`.
- Codegen gera app FastAPI raiz para manifestos `multiagent`, montando os agentes em um único processo pelos `routePrefix` e preservando idempotência por prefixo de rota.
- Builder API lê, valida e gera bundles por manifesto via rotas `/runtime-manifest`, `/runtime-manifest/validate` e `/runtime-manifest/generate`.
- Builder UI possui aba `Runtime` para carregar `runtime.manifest.json`, exibir agentes, validar o manifesto e gerar bundle por manifesto via Builder API.
- Sandbox local inicial: Builder API inicia/para o runtime gerado, lista runtimes em memória, acompanha status/logs e aceita porta configurável; Builder UI permite iniciar/parar/atualizar, acompanhar logs recentes, escolher porta e acionar criação de sessão, turnos, finalização, transcript e events.
- Codegen gera um artefato separado de sandbox LangSmith/LangGraph em `generated/reference-interview-langgraph-sandbox/`, com `langgraph.json`, `app/langgraph_app.py:graph`, `.env.example` com variáveis LangSmith, README próprio, testes de entrypoint LangGraph e dependência `langgraph-cli[inmem]` isolada do runtime FastAPI.
- Artefatos gerados incluem `.agent-flow/generated-meta.json` com target e hash determinístico do projeto do agente, cobrindo `agent.flow.json`, prompts, schemas, arquivos em `files/` e código customizado referenciado por `codePath`.
- Builder API expõe `/flows/{flowId}/generate-langgraph-sandbox`, `/flows/{flowId}/approve-langgraph-sandbox` e `/flows/{flowId}/generate-approved-runtime`, recusando gerar runtime aprovado quando o sandbox não foi gerado/aprovado ou quando o hash do flow/assets mudou.
- Builder UI expõe a sequência visual `LangGraph` -> `Aprovar` -> `API Docker`, separando o pacote de validação LangSmith/LangGraph do runtime final FastAPI/Docker.
- Builder API expõe controle operacional do runtime Docker final aprovado por `/docker-runtime/status`, `/docker-runtime/prepare-env`, `/docker-runtime/configure-ports`, `/docker-runtime/build`, `/docker-runtime/up`, `/docker-runtime/down`, `/docker-runtime/smoke` e `/docker-runtime/inspect`, validando que o artefato está em `generated/`, possui target `fastapi-runtime`, `Dockerfile`, `docker-compose.yml` e flow embutido antes de executar comandos.
- Builder API aceita `runtimeUrl` local para status, comandos e smoke test, permitindo testar uma porta customizada do runtime final sem alterar o Builder.
- Builder API persiste histórico operacional local do runtime Docker em `.agent-flow/docker-runtime-history/`, expõe `/docker-runtime/history` e mantém esse histórico fora do artefato exportável.
- Builder UI mostra controles `Status`, `Inspecionar`, `Preparar .env`, `Build`, `Up`, `Smoke` e `Down` no painel `Artefato` quando o pacote carregado é a API Docker final, com input de Runtime URL, edição visual das portas API/Postgres/Redis do `docker-compose.yml`, links para `/docs` e `/openapi.json`, serviços de `docker compose ps`, logs recentes, histórico operacional, auto-atualização opt-in, status da última operação, painel de progresso de build e resumo do smoke test.
- Plano mestre de implementação documentado em `docs/master-implementation-plan.md`, consolidando objetivo final, base já implementada, decisões, superfícies de produto, arquitetura alvo, fases, critérios de aceite e checklist anti-regressão.
- Paridade ProUp documentada em `docs/proup-capability-parity.md`, registrando as capacidades que a ferramenta precisa conseguir recriar e a politica de escape hatch para evitar engessamento visual.
- Flow Spec, Builder UI e Codegen LangGraph possuem contrato inicial para nós `code` customizados, com linguagem, modo de execução, arquivo, entry point, dependências, input path, result path e código inline. O codegen copia assets de `codePath` para `app/code/`, inclui esses arquivos no hash de aprovação, executa Python nativo por arquivo/inline e JavaScript por arquivo/inline via runner Node no runtime gerado, instala Node no Dockerfile final e registra `custom_code_executed`, `custom_code_declared` ou `custom_code_failed` em `/events`.
- Plano do Studio Local 100% local documentado em `docs/local-studio-plan.md`, cobrindo fluxo contínuo `Builder Visual -> Studio Local -> Aprovar Versão -> API Docker`, tema claro/escuro, grafo, runs, state inspector, node IO, timeline, logs e traces locais.
- Especificações de UI/UX do Studio Local documentadas em `docs/ux/`, cobrindo pesquisa de referências LangSmith/LangGraph Studio e n8n, varredura navegada com `agent-browser`, análise crua de screenshots logados, decisões de produto/UX para evitar regressões, regras visuais/comportamentais observadas, matriz de inputs e elementos de IA, interface alvo, modelo de interação, design system claro/escuro e roadmap visual.
- Builder UI possui tema claro/escuro persistente por `localStorage`, com tokens CSS para superfícies principais, canvas, inspector, controles, timeline e nós executados.
- Painel `Studio` inicial integrado ao Builder UI substitui o antigo painel cru de sandbox, mantendo start/stop/refresh do runtime e adicionando visão de run, métricas da sessão, timeline de eventos, seleção de evento, Node IO inferido, payload bruto, state inspector, transcript, eventos brutos, runtimes ativos e logs.
- Builder API persiste snapshots iniciais de runs locais do Studio em `flows/{flowId}/.agent-flow/studio-runs/`, expõe `/flows/{flowId}/studio-runs` e `/flows/{flowId}/studio-runs/{runId}`, salvando sessão, transcript, events, logs, métricas, snapshots derivados de state por evento e diffs incrementais.
- Builder UI lista runs locais no painel `Studio`, salva snapshots após avanço de sessão/turno/finalização e permite recarregar um run persistido para replay básico da timeline, Node IO, transcript, state inspector e diff do evento selecionado.
- Comparação de runs do Studio ganhou diffs semânticos por nó (state/output), filtro por nó e metadados de cenário para comparação (esquerda/direita/alterado).
- Causality do Studio foi incorporada ao fluxo persistido e ao grafo da UI (`upstream`, `impact`, `cascata`) com destaque de eventos/nós no replay, incluindo trilha visual no painel de grafo.
- Build Docker pela UI passa a expor progresso incremental por etapa em `docker compose build` e mantém log de progresso persistido no histórico operacional.
- Studio Local ganhou painel `Contexto do nó`, acionado pelo clique/filtro de nó, reunindo status, papel causal, erro relacionado, eventos recentes, input/output inferidos, estado do nó, diffs e logs correlacionados.
- Causalidade ao vivo da UI foi alinhada ao backend: usa a falha mais recente, o parent executado mais próximo antes da falha e descendentes realmente observados depois da falha.
- Ordenação de `impactedNodes` passou a seguir ordem causal/de execução, com o nó da falha primeiro e descendentes ordenados pelo primeiro evento impactado, em vez de lista alfabética.
- Topbar do Builder/Studio passou a conter overflow de toolbar localmente, evitando alargar o documento em viewport desktop comum.
- Docker Runtime Manager atualiza progresso de `docker compose build` enquanto o comando ainda está rodando, via callback de streaming no runner padrão e registro em memória consultável por `/docker-runtime/status`.
- Builder UI consulta `/docker-runtime/status` durante `Build`, mesmo com a operação ocupada, para atualizar painel de progresso/logs antes da resposta final do comando.
- Docker Runtime Manager registra operações Docker ativas por runtime, expõe `/docker-runtime/cancel` e aborta builds em andamento por `AbortController`, marcando o resultado final como `canceled` em status, progresso e histórico.
- Builder UI mostra ação `Cancelar` durante `Build`, mantendo polling de progresso até o backend confirmar o cancelamento e registrando o evento no histórico operacional.
- Histórico Docker aceita filtros por etapa textual do progresso (`progressStage`) e status/severidade do progresso (`progressStatus`: running/done/error/warning/info/canceled); a Builder UI expõe os filtros `Etapa` e `Progresso` no painel `Artefato` e aplica o mesmo recorte à lista de progresso visível.
- Parser de progresso Docker estima percentuais mesmo quando o output do BuildKit não traz contagem explícita, usando etapa inferida, contexto de linhas `#N DONE` e evento final em 100% para builds concluídos.
- Shell principal da Builder UI ganhou breakpoint responsivo abaixo de 760px: topbar passa a quebrar em duas linhas com toolbar rolável, workspace vira fluxo vertical sem largura mínima desktop, canvas mantém altura útil e inspector fica abaixo do canvas.
- Builder UI possui atalhos globais iniciais: `Ctrl/Cmd+S` salva flow/prompts/schemas sujos, `Ctrl/Cmd+Enter` valida o flow atual, `Esc` limpa a seleção do canvas, `A` foca a paleta e `F` reenquadra o canvas quando o foco não está em campo editável.
- Auditoria visual automatizada em Playwright (`npm run test:ui-theme`) prepara workspace isolado em `.tmp/ui-theme-workspace`, sobe API/UI em portas dedicadas, percorre tema claro/escuro em viewport desktop e compacta, abre as abas principais do inspector, valida atalhos iniciais, renderiza runs locais persistidos com timeline/cadeia causal/state/transcript, cobre aprovação desatualizada bloqueando `API Docker` e cobre o fluxo `LangGraph` -> `Aprovar` -> `API Docker` até o painel de artefato Docker final.

## Verificado

```bash
npm run validate:flow
npm run codegen:reference
npm run codegen:sandbox
npm run codegen:manifest
npm run typecheck
npm run test:baseline
npm run test:generated
npm run test:manifest
npm run test:parity
npm run test:builder-api
npm run test:ui-theme
npm run test:codegen
npm run build:builder-ui
npm audit --audit-level=moderate
```

Resultado: todos passaram.

Também foi validado localmente:

- Builder API em `http://127.0.0.1:3333/health`.
- Builder UI servindo HTML em `http://127.0.0.1:5173`.
- Builder API listando e validando `reference-interview` via HTTP.
- Sandbox em `http://127.0.0.1:8090`, com smoke test de `POST /sessions`, `start`, `turn`, `transcript` e `events`.
- Builder API validando a promoção LangSmith/LangGraph: sem aprovação retorna 409, após aprovação gera runtime aprovado com `.agent-flow/langgraph-sandbox-approval.json`.
- Sandbox LangGraph validado em venv isolada `.venv/langgraph`, sem instalar `langgraph-cli` no ambiente FastAPI do runtime final: `pytest` do pacote sandbox passou, `langgraph --version` retornou 0.4.30 e `langgraph dev --no-browser --host 127.0.0.1 --port 2024 --no-reload --allow-blocking` subiu `/docs` em smoke temporário.
- Container final validado com `docker compose up -d --build` em `generated/reference-interview-runtime/`; `/health` respondeu `db_ok=true` e `cache_ok=true`, e o smoke HTTP criou sessão, executou `start`, `turn`, retornou `ECHO` e gravou eventos.
- Dockerfile final com runner Node validado por `docker compose build api` em `generated/reference-interview-runtime/` e `docker run --rm reference-interview-runtime-api node --version`, retornando `v20.19.2`.
- Builder UI validado em navegador local em `http://127.0.0.1:5173`: tema escuro aplicado, painel `Studio` aberto, runtime local ativo em `http://127.0.0.1:8090`, sessão criada, turno enviado, timeline/state inspector atualizados e tema claro reaplicado pelo toggle.
- Builder API validada com runner Docker falso em `npm run test:builder-api`, cobrindo status/configure-ports/prepare-env/build/up/down/inspect/history do runtime aprovado sem executar Docker real.
- Rota `/docker-runtime/status` validada por `app.inject` no workspace real para `generated/reference-interview-runtime`, retornando target `fastapi-runtime`, recurso `sessions`, `Dockerfile`, compose, portas API/Postgres/Redis e links `http://127.0.0.1:8080/docs` e `/openapi.json`.
- Rota `/docker-runtime/status` validada por `app.inject` com `runtimeUrl=http://127.0.0.1:9000`, retornando links customizados para `http://127.0.0.1:9000/docs` e `/openapi.json`.
- Rota `/docker-runtime/history` validada por `app.inject` no workspace real para `generated/reference-interview-runtime`, retornando lista vazia quando ainda não há histórico local.
- Rotas de runs locais do Studio validadas em `npm run test:builder-api`, cobrindo lista vazia, gravação de snapshot, snapshotCount, diff por node, listagem de resumo, carregamento completo e arquivo persistido em `.agent-flow/studio-runs/`.
- Rota `/flows/reference-interview/studio-runs` validada por `app.inject` no workspace real, retornando `200` e lista vazia quando ainda não há snapshot local.
- `npm run typecheck`, `npm run test:builder-api` e `npm --workspace @agent-flow-builder/builder-ui run build` passaram após o painel `Contexto do nó` e a nova ordenação causal.
- Builder UI validado via Playwright em `http://127.0.0.1:5173` com viewport `1440x900`: aba `Studio` abriu, clique no nó `start` preencheu `Contexto do nó` com 4 cards, tema alternou entre escuro/claro preservando o painel e `body.scrollWidth` permaneceu dentro do viewport.
- `npm run test:builder-api` cobre progresso incremental do Docker build: enquanto o `POST /docker-runtime/build` ainda está pendente, `GET /docker-runtime/status` retorna `lastOperation=build`, `lastStatus=running` e `progress` já preenchido.
- `npm run test:builder-api` cobre cancelamento de build Docker: `/docker-runtime/cancel` aborta o runner pendente via signal, o build retorna `lastStatus=canceled`, o progresso termina com status `canceled` e o filtro de histórico por `status=canceled` encontra a entrada cancelada.
- `npm run test:builder-api` cobre filtros de histórico/progresso Docker por `progressStage=metadata`, `progressStatus=done`, `progressStatus=canceled` e rejeição de `progressStatus` inválido.
- `npm run test:builder-api` cobre percentuais estimados no progresso Docker ao vivo e 100% no evento final de build concluído.
- Builder UI validado por screenshots Playwright temporários em `1440x900` e `390x844`, tema claro e escuro; a correção responsiva removeu o corte lateral mobile do shell principal.
- `npm run typecheck` e `npm run build:builder-ui` passaram após a inclusão dos atalhos globais iniciais.
- `npm run test:ui-theme` passou com 9 cenários: tema claro/escuro em viewport `1440x900` e `390x844`, cobrindo render inicial, atalhos `A`/`F`, abas `Editar/Arquivos/Validação/JSON/Artefato/Runtime/Studio`, ausência de overflow horizontal/texto cortado, runs locais com dados em tema claro/escuro, aprovação desatualizada bloqueando `API Docker` e geração visual `LangGraph` -> `Aprovar` -> `API Docker` com controles `Status`, `Preparar .env`, `Build`, `Up`, `Smoke` e `Down`.

## Ainda não implementado

- Studio Local: evoluir o drill-down do nó com prompt renderizado, custos/tokens quando existirem, spans estruturados e reexecução/fork por checkpoint.
- Tema claro e escuro ainda precisa ampliar a auditoria visual para estados de erro/loading e Docker ativo/parado; o shell principal, abas base, runs locais com dados, aprovação desatualizada e fluxo aprovado até o artefato Docker final já têm gate automatizado.
- Edição visual avançada de metadados de prompts/schemas e ergonomia refinada do canvas.
- Adapters externos para contratos de código customizado fora dos executores nativos Python/JavaScript, incluindo TypeScript via sidecar/runtime adapter, dependências npm controladas por nó, HTTP/MCP configurável, sandbox isolado por nó e UI de logs/erros dedicada no Studio Local.
- Evoluir a composição multiagente inicial para modelos públicos com `agent_id`, isolamento operacional mais explícito e testes com banco PostgreSQL real compartilhado.
- Safety Harness completo.
- Jobs pós-finalização com worker.
- Streaming.
- Autenticação avançada.
- Integração opcional com LangSmith Cloud pelo Builder UI, caso o usuário queira publicar/deployar fora do modo 100% local.

## Próximos Passos (ciclo atual)

Para chegar ao objetivo completo de "studio local + aprovação + API Docker" sem regressão de capacidade, a sequência recomendada é:

1. **Auditoria visual completa de tema claro/escuro (Alta prioridade)**
   - ampliar `npm run test:ui-theme` para estados de erro/loading e Docker ativo/parado;
   - corrigir contraste, overflow e estados vazios/erro/loading que ainda escaparem;
   - manter checklist manual objetivo para pontos ainda difíceis de automatizar.

2. **Canvas/produtos de trabalho refinados (Média prioridade)**
   - grupos colapsáveis e estado dirty/stale por nó/aresta;
   - edição visual de metadados e esquemas no painel lateral sem precisar abrir JSON;
   - ampliar comandos contextuais para buscar nós, filtrar e executar ações comuns sem depender de mouse.

3. **Cenários + pinning avançado (Média prioridade)**
   - consolidar cenários nomeados por agente/run;
   - pinning de payload e output por nó com indicador visual;
   - reexecução determinística com histórico de comparação.

4. **Adapters de código não nativos (Média/Longo prazo)**
   - adicionar contrato de execução HTTP/MCP/sidecar;
   - mapa de segurança (timeout, retry, payload whitelist, redaction);
   - logs por nó no Studio Local e inclusão no hash de aprovação.

5. **Multiagente operacional**
   - rota/agent_id estável no runtime e no Studio;
   - trace e histórico por agente no UI.

## Regras de bloqueio até fechamento de uma fase

- Nenhuma etapa pode ser marcada "concluída" enquanto não cumprir:
  - paridade da capacidade equivalente à de um fluxo de referência real (ProUp/semântica de conversa);
  - aprovação por hash válida para geração do runtime final;
  - evidência local de debug (run+timeline+state diff+node IO);
  - tema claro e escuro testado no fluxo alvo;
  - fluxo completo sem troca para ferramentas externas no caminho principal.
