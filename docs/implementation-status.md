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
- Flow Spec, Builder API e Builder UI preservam metadados visuais de prompts/schemas no `agent.flow.json`: versão, descrição, tags e variáveis de prompt, com formulário dedicado na aba `Arquivos` e salvamento pelo mesmo fluxo dirty do workspace.
- Builder UI permite exportar e importar workspace de flow pela toolbar, salvando alterações pendentes antes de exportar.
- Builder UI possui aba `Artefato` para pré-visualizar arquivos do runtime ou bundle gerado e baixar um zip do projeto.
- Builder UI possui aba `Validação` para exibir diagnósticos estruturados e navegar para nós, arestas, prompts ou schemas afetados.
- Builder UI permite editar adapter/modelo/env vars do LLM padrão do flow e adapter/modelo de nós LLM.
- Builder UI permite criar, remover, mover, conectar e reconectar nós/arestas no canvas, com posições persistidas no `agent.flow.json`.
- Builder API expõe catálogo local reutilizável via `/catalog`, `/catalog/items`, `/catalog/items/restore-revision`, `/catalog/agent-templates/create-flow` e `/flows/{flowId}/catalog/apply`, persistindo itens do workspace em `.agent-flow/catalog/registry.json`, carregando seeds locais de prompt/schema/tools/templates de agente/skills, mantendo versão/revisão/hash de conteúdo por item e snapshots anteriores em `history`, criando novas revisões ao restaurar snapshots antigos, criando flows completos a partir de templates, aplicando prompts/schemas como assets reais, tools como patch/criação de nó e skills como bundle de prompt/schema/patch de nó selecionado.
- Builder UI possui aba `Catálogo`, com busca textual, filtros por tipo/origem/tag, refresh, cards de itens locais/built-in com versão/revisão/hash visíveis, histórico de revisões, diff compacto entre a última revisão salva e a atual e ação de restaurar revisão, além de ações para salvar o prompt/schema atual, salvar o nó selecionado como tool ou skill local, criar flow a partir de template de agente e adicionar/aplicar prompt, schema, tool ou skill no flow ou no nó selecionado.
- Flow Spec aceita `position` opcional em nós para preservar layout visual sem afetar o runtime gerado.
- Codegen LangGraph monta o grafo gerado a partir dos nós e arestas do `agent.flow.json`, com handlers por tipo de nó e eventos baseados nos nós realmente executados.
- Codegen LangGraph executa nós dedicados de `switch` e `human_input`, incluindo condições simples com `and`, comparações de estado e eventos operacionais específicos.
- Flow Spec, Builder UI e Codegen LangGraph possuem suporte inicial a nós avançados determinísticos `http_request`, `transform_json`, `database_query`, `database_save`, `file_extract` e `rag_retrieval`, com configuração visual, execução no runtime gerado, suporte a `mock://echo` para testes sem rede, tabela genérica `agent_node_records` para gravações JSON, cópia de assets de `files/` para `app/files/`, extração de texto/Markdown/PDF opcional via `pypdf`, busca lexical RAG local e eventos próprios em `/events`.
- Flow Spec, Builder UI e Codegen LangGraph possuem suporte inicial a nós `approval_gate`, `scoring` e `analytics`, com configuração visual, execução no runtime gerado e eventos próprios em `/events`.
- Codegen LangGraph valida adapters LLM pelo catálogo, gera runtime apenas com o adapter selecionado e respeita overrides de adapter/modelo em nós LLM.
- Codegen possui testes end-to-end com flow simplificado sem `deterministic_gate`, flow com `switch`/`human_input`, flow com `http_request`/`transform_json`, flow com `database_query`/`database_save`, flow com `file_extract`/`rag_retrieval`, flow com `approval_gate`/`scoring`/`analytics` e bundle multiagente, gerando runtimes temporários e executando pytest nos artefatos gerados.
- Flow Spec define `RuntimeManifest` para agrupamento monoagente ou multiagente, com agentes referenciando `agent.flow.json` por `flowPath`.
- Codegen gera bundle a partir de `runtime.manifest.json`, com metadados, README, `.agent-flow/generated-meta.json` no pacote raiz e um runtime independente por agente em `generated/reference-runtime-bundle/agents/`.
- Codegen gera app FastAPI raiz para manifestos `multiagent`, montando os agentes em um único processo pelos `routePrefix` e preservando idempotência por prefixo de rota.
- Runtime baseline, runtime gerado e bundles multiagente agora expõem `agent_id` em `/metadata`, sessão e eventos; o Studio envia `agent_id` na criação de sessão, persiste `agentId` nos runs locais, mostra resumo por agente e filtra runs/timeline por agente.
- Builder API lê, salva, valida e gera bundles por manifesto via rotas `/runtime-manifest`, `/runtime-manifest/validate` e `/runtime-manifest/generate`; a validação retorna flow, resourceName e contrato por agente para orientar endpoints reais do bundle.
- Builder UI possui aba `Runtime` para editar visualmente `runtime.manifest.json`, incluindo metadata, LLM padrão, empacotamento, agentes, prefixos de rota, validação e geração de bundle por manifesto via Builder API; a mesma aba mostra mapa operacional do bundle multiagente com app raiz, `/health`, `/metadata`, runtime por agente, rotas montadas e endpoint de sessão por resourceName.
- Sandbox local inicial: Builder API inicia/para o runtime gerado, lista runtimes em memória, acompanha status/logs e aceita porta configurável; Builder UI permite iniciar/parar/atualizar, acompanhar logs recentes, escolher porta e acionar criação de sessão, turnos, finalização, transcript e events.
- Codegen gera um artefato separado de sandbox LangSmith/LangGraph em `generated/reference-interview-langgraph-sandbox/`, com `langgraph.json`, `app/langgraph_app.py:graph`, `.env.example` com variáveis LangSmith, README próprio, testes de entrypoint LangGraph e dependência `langgraph-cli[inmem]` isolada do runtime FastAPI.
- Artefatos gerados incluem `.agent-flow/generated-meta.json` com target e hash determinístico do projeto do agente, cobrindo `agent.flow.json`, prompts, schemas, arquivos em `files/` e código customizado referenciado por `codePath`.
- Builder API expõe `/flows/{flowId}/generate-langgraph-sandbox`, `/flows/{flowId}/approve-langgraph-sandbox` e `/flows/{flowId}/generate-approved-runtime`, recusando gerar runtime aprovado quando o sandbox não foi gerado/aprovado ou quando o hash do flow/assets mudou.
- Builder UI expõe a sequência visual `LangGraph` -> `Aprovar` -> `API Docker`, separando o pacote de validação LangSmith/LangGraph do runtime final FastAPI/Docker.
- Builder API expõe controle operacional do runtime Docker final aprovado e do bundle multiagente por `/docker-runtime/status`, `/docker-runtime/prepare-env`, `/docker-runtime/configure-ports`, `/docker-runtime/build`, `/docker-runtime/up`, `/docker-runtime/down`, `/docker-runtime/smoke` e `/docker-runtime/inspect`, validando que o artefato está em `generated/`, possui target `fastapi-runtime` ou `runtime-manifest-bundle`, `Dockerfile`, `docker-compose.yml` e metadados necessários antes de executar comandos.
- Builder API aceita `runtimeUrl` local para status, comandos e smoke test, permitindo testar uma porta customizada do runtime final sem alterar o Builder.
- Builder API persiste histórico operacional local do runtime Docker em `.agent-flow/docker-runtime-history/`, expõe `/docker-runtime/history` e mantém esse histórico fora do artefato exportável.
- Builder UI mostra controles `Status`, `Inspecionar`, `Preparar .env`, `Build`, `Up`, `Smoke` e `Down` no painel `Artefato` quando o pacote carregado é a API Docker final ou bundle multiagente Docker, com input de Runtime URL, seletor de agente para smoke em bundles, edição visual das portas API/Postgres/Redis do `docker-compose.yml`, links para `/docs` e `/openapi.json`, serviços de `docker compose ps`, logs recentes, histórico operacional, auto-atualização opt-in, status da última operação, painel de progresso de build e resumo do smoke test.
- Plano mestre de implementação documentado em `docs/master-implementation-plan.md`, consolidando objetivo final, base já implementada, decisões, superfícies de produto, arquitetura alvo, fases, critérios de aceite e checklist anti-regressão.
- Paridade ProUp documentada em `docs/proup-capability-parity.md`, registrando as capacidades que a ferramenta precisa conseguir recriar e a politica de escape hatch para evitar engessamento visual.
- Flow Spec, Builder UI e Codegen LangGraph possuem contrato inicial para nós `code` customizados, com linguagem, modo de execução, arquivo, entry point, dependências, input path, result path, código inline, executor HTTP, MCP stdio e sidecar local. O codegen copia assets de `codePath` para `app/code/`, inclui esses arquivos no hash de aprovação, executa Python nativo por arquivo/inline, JavaScript/TypeScript por arquivo/inline via runner Node, `codeExecution: "http"` por contrato externo JSON, `codeExecution: "mcp"` por tool MCP local via stdio e `codeExecution: "sidecar"` por subprocesso local com JSON via stdin/stdout no runtime gerado, materializa `codeDependencies` em `app/code/package.json`, instala Node/NPM no Dockerfile final e registra `custom_code_executed`, `custom_code_declared` ou `custom_code_failed` em `/events`, com `execution_log` e `span` estruturados para cada execução customizada.
- Plano do Studio Local 100% local documentado em `docs/local-studio-plan.md`, cobrindo fluxo contínuo `Builder Visual -> Studio Local -> Aprovar Versão -> API Docker`, tema claro/escuro, grafo, runs, state inspector, node IO, timeline, logs e traces locais.
- Especificações de UI/UX do Studio Local documentadas em `docs/ux/`, cobrindo pesquisa de referências LangSmith/LangGraph Studio e n8n, varredura navegada com `agent-browser`, análise crua de screenshots logados, decisões de produto/UX para evitar regressões, regras visuais/comportamentais observadas, matriz de inputs e elementos de IA, interface alvo, modelo de interação, design system claro/escuro e roadmap visual.
- Builder UI possui tema claro/escuro persistente por `localStorage`, com tokens CSS para superfícies principais, canvas, inspector, controles, timeline e nós executados.
- Painel `Studio` inicial integrado ao Builder UI substitui o antigo painel cru de sandbox, mantendo start/stop/refresh do runtime e adicionando visão de run, métricas da sessão, timeline de eventos, seleção de evento, Node IO inferido, payload bruto, state inspector, transcript, eventos brutos, runtimes ativos e logs.
- Builder API persiste snapshots iniciais de runs locais do Studio em `flows/{flowId}/.agent-flow/studio-runs/`, expõe `/flows/{flowId}/studio-runs` e `/flows/{flowId}/studio-runs/{runId}`, salvando sessão, transcript, events, logs, métricas, snapshots derivados de state por evento e diffs incrementais.
- Builder UI lista runs locais no painel `Studio`, salva snapshots após avanço de sessão/turno/finalização e permite recarregar um run persistido para replay básico da timeline, Node IO, transcript, state inspector e diff do evento selecionado.
- Comparação de runs do Studio ganhou diffs semânticos por nó (state/output), filtro por nó e metadados de cenário para comparação (esquerda/direita/alterado).
- Comparação de runs do Studio agora agrega modo `live/mock/pinned`, eventos pinados/mock, tokens, custo estimado e resumo de regressão (`pass/warn/fail`) com motivos e indicação de comparação pinado vs real.
- Cenários do Studio carregam thresholds de regressão para crescimento de tokens, custo e duração; a UI persiste esses limites, a execução envia na metadata da sessão e a comparação aplica os valores do candidate.
- Cenários do Studio importam/exportam fixture JSON de replay com input, thresholds, checkpoint, pins ativos/stale e metadata de execução pronta para reaproveitamento.
- Cenários/fixtures do Studio podem ser executados em lote sequencial com resumo por cenário, sessão, duração, erro e comparação automática com o run anterior do mesmo cenário.
- O lote de cenários agora gera relatório JSON exportável (`agent-flow-builder.scenario-batch-report.v1`) com resumo, hash determinístico, resultados por cenário e aprovação local do lote quando não há erro de execução/comparação nem regressão `fail`.
- Cenários forkados agora enviam `restore.state` na metadata e o runtime FastAPI gerado restaura o estado inicial do novo thread usando checkpointer real por `sourceSessionId` quando disponível, com fallback para o snapshot serializado do Studio.
- Studio Local mostra a estratégia esperada de restauração do cenário forkado (`checkpointer -> snapshot` ou `snapshot`) e a origem observada emitida pelo runtime (`checkpointer` ou `snapshot`) no card do cenário e no `State inspector`.
- Checkpoints forkados do Studio agora registram assinatura de compatibilidade com `flowId`, versão, hash local do flow, hash de projeto/assets quando disponível e hash do nó; a UI mostra `ok/parcial/incompatível`, fixtures exportam essa assinatura e a execução bloqueia restore quando versão/hash/nó divergem.
- Causality do Studio foi incorporada ao fluxo persistido e ao grafo da UI (`upstream`, `impact`, `cascata`) com destaque de eventos/nós no replay, incluindo trilha visual no painel de grafo.
- Build Docker pela UI passa a expor progresso incremental por etapa em `docker compose build` e mantém log de progresso persistido no histórico operacional.
- Studio Local ganhou painel `Contexto do nó`, acionado pelo clique/filtro de nó, reunindo status, papel causal, erro relacionado, eventos recentes, metadados do nó/LLM, prompt renderizado, input/output inferidos, estado do nó, métricas de usage/custo/duração, logs estruturados de código customizado com busca, filtro por modo/status e exportação JSON, spans estruturados, diffs e logs correlacionados.
- Studio Local infere diagnóstico operacional por nó, com causa provável, próximas ações e evidências derivadas de payload, safety, status, fase, snapshot e cadeia causal, incluindo orientações específicas por tipo de nó para LLM, safety, code, HTTP, banco, arquivo/RAG, approval, scoring e analytics.
- Studio Local permite criar fork de checkpoint/evento a partir do `State inspector`, salvando um cenário local reexecutável com origem do run, sessão, evento, snapshot, input/output e metadata de execução para rastrear a nova sessão.
- Studio Local permite fixar input/output por nó no drill-down, persistindo pins locais por flow com origem de run/evento e indicador `atual/stale` quando a definição do nó muda.
- Studio Local permite ativar mock por pins no cenário; a execução envia pins ativos na metadata da sessão e o runtime gerado aplica `pinned/mock` por nó antes de chamar LLM, código, HTTP, banco, arquivos/RAG, approval, scoring, analytics ou handlers de controle.
- Causalidade ao vivo da UI foi alinhada ao backend: usa a falha mais recente, o parent executado mais próximo antes da falha e descendentes realmente observados depois da falha.
- Ordenação de `impactedNodes` passou a seguir ordem causal/de execução, com o nó da falha primeiro e descendentes ordenados pelo primeiro evento impactado, em vez de lista alfabética.
- Topbar do Builder/Studio passou a conter overflow de toolbar localmente, evitando alargar o documento em viewport desktop comum.
- Docker Runtime Manager atualiza progresso de `docker compose build` enquanto o comando ainda está rodando, via callback de streaming no runner padrão e registro em memória consultável por `/docker-runtime/status`.
- Builder UI consulta `/docker-runtime/status` durante `Build`, mesmo com a operação ocupada, para atualizar painel de progresso/logs antes da resposta final do comando.
- Docker Runtime Manager registra operações Docker ativas por runtime, expõe `/docker-runtime/cancel` e aborta builds em andamento por `AbortController`, marcando o resultado final como `canceled` em status, progresso e histórico.
- Builder UI mostra ação `Cancelar` durante `Build`, mantendo polling de progresso até o backend confirmar o cancelamento e registrando o evento no histórico operacional.
- Histórico Docker aceita filtros por nível (`level`: error/warning/info/success), etapa textual do progresso (`progressStage`) e status/severidade do progresso (`progressStatus`: running/done/error/warning/info/canceled); a Builder UI expõe os filtros `Nível`, `Etapa` e `Progresso` no painel `Artefato` e aplica o mesmo recorte à lista de progresso visível.
- Painel `Artefato` exibe alertas operacionais persistentes para `Build`, `Up` e `Smoke`, derivados do histórico Docker, com estados `ok`, `pendente`, `desatualizado` e `erro`, incluindo indicação de regressão quando a última execução falha após sucesso anterior.
- Parser de progresso Docker estima percentuais mesmo quando o output do BuildKit não traz contagem explícita, usando etapa inferida, contexto de linhas `#N DONE` e evento final em 100% para builds concluídos.
- Shell principal da Builder UI ganhou breakpoint responsivo abaixo de 760px: topbar passa a quebrar em duas linhas com toolbar rolável, workspace vira fluxo vertical sem largura mínima desktop, canvas mantém altura útil e inspector fica abaixo do canvas.
- Builder UI possui atalhos globais iniciais: `Ctrl/Cmd+S` salva flow/prompts/schemas sujos, `Ctrl/Cmd+Enter` valida o flow atual, `Esc` limpa a seleção do canvas, `A` foca a paleta e `F` reenquadra o canvas quando o foco não está em campo editável.
- Auditoria visual automatizada em Playwright (`npm run test:ui-theme`) prepara workspace isolado em `.tmp/ui-theme-workspace`, sobe API/UI em portas dedicadas, usa runner Docker mockado apenas por `AGENT_BUILDER_DOCKER_RUNNER=ui-audit-mock`, percorre tema claro/escuro em viewport desktop e compacta, abre as abas principais do inspector, valida atalhos iniciais, cobre busca/filtro/foco de nós no canvas, grupos colapsáveis por família sem alterar `agent.flow.json`, catálogo local com salvar prompt atual, aplicar HTTP JSON tool em nó existente e criar flow por template de agente, edição visual de `runtime.manifest.json`, mapa de bundle multiagente com endpoints resolvidos, renderiza runs locais persistidos com timeline/cadeia causal/state/transcript, cobre diagnóstico automático de safety, prompt renderizado, usage, custo, logs estruturados, spans e fork de checkpoint no drill-down de nó LLM, cobre status global de loading/erro fora do Docker, estados internos de loading/erro em `Arquivos`, `Runtime` e `Studio`, aprovação desatualizada bloqueando `API Docker`, o fluxo `LangGraph` -> `Aprovar` -> `API Docker` até o painel de artefato Docker final e exercita build/loading, inspect running, smoke com erro e inspect stopped.
- Painéis `Arquivos`, `Runtime` e `Studio` exibem estados internos acessíveis de loading/erro, usando `role=status` para carregamento, `role=alert` para falhas e mensagens locais no painel sem depender apenas do status global.
- Canvas da Builder UI possui finder compacto com busca textual, filtro por tipo, contador de resultados, chips de nós e foco/seleção do nó no React Flow sem alterar o contrato do `agent.flow.json`.
- Canvas da Builder UI possui grupos colapsáveis locais por família semântica (`Controle`, `Safety`, `IA/RAG`, `Integrações`, `Lógica`, `Outros`), escondendo nós/arestas do grupo recolhido e reabrindo automaticamente o grupo quando um nó oculto é escolhido pelo finder.
- Aba `Arquivos` possui editor visual recursivo para JSON Schema de objetos: lista propriedades, altera tipo, descrição, obrigatoriedade, enum e `items.type` de arrays, edita objetos aninhados e objetos dentro de arrays, adiciona/remove campos e sincroniza o textarea JSON usado pelo salvamento do schema.
- Canvas marca nós e arestas alterados no draft em relação ao último flow carregado/salvo, com borda/linha tracejada de aviso para orientar o que ainda está pendente de salvamento.
- Canvas marca nós com pins/checkpoints defasados como `stale` quando o hash salvo diverge da definição atual do nó, e destaca as arestas conectadas para mostrar impacto visual no grafo.

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
- `npm run test:builder-api` cobre o bundle multiagente como artefato Docker: `/docker-runtime/status` reconhece target `runtime-manifest-bundle`, lista agentes gerados e `/docker-runtime/smoke` com `agentId` executa `/metadata`, cria sessão e percorre `start`, `turn`, `transcript` e `events` na rota montada do agente.
- `npm run test:builder-api` cobre filtros de histórico/progresso Docker por `level=error`, `level=success`, `progressStage=metadata`, `progressStatus=done`, `progressStatus=canceled` e rejeição de `level`/`progressStatus` inválidos.
- `npm run test:builder-api` cobre percentuais estimados no progresso Docker ao vivo e 100% no evento final de build concluído.
- Builder UI validado por screenshots Playwright temporários em `1440x900` e `390x844`, tema claro e escuro; a correção responsiva removeu o corte lateral mobile do shell principal.
- `npm run typecheck` e `npm run build:builder-ui` passaram após a inclusão dos atalhos globais iniciais.
- `npm run test:codegen` cobre execução real de nó `code` TypeScript por arquivo, com `codeDependencies` materializado em `app/code/package.json`, execução real de `codeExecution: "http"` contra servidor HTTP local, execução real de `codeExecution: "mcp"` contra servidor MCP stdio local e execução real de `codeExecution: "sidecar"` por subprocesso Python no pytest gerado, além dos testes já existentes de Python e JavaScript; os casos customizados validam também `execution_log` e `span`.
- `npm run test:ui-theme` passou com 17 cenários: tema claro/escuro em viewport `1440x900` e `390x844`, cobrindo render inicial, atalhos `A`/`F`, abas `Editar/Arquivos/Validação/JSON/Artefato/Runtime/Studio/Catálogo`, busca/filtro/foco de nós no canvas, grupos colapsáveis e autoexpansão pelo finder, marcação dirty de nó editado, marcação stale por pin defasado, catálogo local com busca textual, filtro por origem, versão/revisão visível, histórico/diff de revisão, restauração de revisão, seeds, salvar prompt atual, salvar nó atual como tool/skill local, aplicar HTTP JSON tool em nó existente, aplicar skill de perguntas estruturadas no nó LLM e criar flow por template de agente com nós `retrieve_context`/`generate_questions`, edição visual de metadados de prompt/schema, propriedades top-level e propriedades aninhadas de JSON Schema com enum, `items.type`, required e descrição na aba `Arquivos`, edição visual e salvamento de `runtime.manifest.json`, mapa de bundle multiagente com rota `/reference-interview/sessions` e runtime `agents/reference-interview`, estados internos de loading/erro nos painéis `Arquivos`, `Runtime` e `Studio`, ausência de overflow horizontal/texto cortado, runs locais com dados em tema claro/escuro, origem observada de restore de checkpoint, pin local de input/output por nó, logs estruturados com filtro e exportação JSON, toggle de mock por pins em cenário, thresholds de regressão por cenário, importação/exportação de fixture JSON de replay, ação de execução em lote, comparação de runs com veredito de regressão, status global de loading/erro fora do Docker, aprovação desatualizada bloqueando `API Docker`, geração visual `LangGraph` -> `Aprovar` -> `API Docker` com controles `Status`, `Preparar .env`, `Build`, `Up`, `Smoke` e `Down`, alertas operacionais persistentes de Build/Up/Smoke, e estados Docker de loading/progresso, container running, smoke com erro e container stopped.

## Ainda não implementado

- Ergonomia refinada do canvas ainda precisa de comandos contextuais mais completos; o editor visual de JSON Schema ainda não cobre recursos avançados como `oneOf`, `allOf`, `anyOf`, `$ref` navegável e mapas dinâmicos por `additionalProperties`.
- O catálogo local ainda precisa evoluir de prompts/schemas/tools/templates/skills iniciais para skills compostas, tools compostas, comparação avançada de revisões, curadoria visual completa e compartilhamento opcional.
- Adapters externos para contratos de código customizado fora dos executores nativos Python/JavaScript/TypeScript, HTTP, MCP stdio e sidecar local, incluindo runtime adapter dedicado para outras linguagens, sandbox isolado por nó e painel avançado de logs/erros por sandbox no Studio Local.
- Evoluir a composição multiagente inicial para visão dedicada de bundle, isolamento operacional mais explícito por rota/agente e testes com banco PostgreSQL real compartilhado.
- Safety Harness completo.
- Jobs pós-finalização com worker.
- Streaming.
- Autenticação avançada.
- Integração opcional com LangSmith Cloud pelo Builder UI, caso o usuário queira publicar/deployar fora do modo 100% local.

## Próximos Passos (ciclo atual)

Para chegar ao objetivo completo de "studio local + aprovação + API Docker" sem regressão de capacidade, a sequência recomendada é:

1. **Canvas/produtos de trabalho refinados (Média prioridade)**
   - ampliar comandos contextuais para executar ações comuns sem depender de mouse.
   - ampliar o editor visual de JSON Schema para composições (`oneOf`/`allOf`/`anyOf`), `$ref` navegável e mapas dinâmicos quando isso for necessário para agentes mais complexos.

2. **Cenários + pinning avançado (Média prioridade)**
   - consolidar cenários nomeados por agente/run;
   - ampliar replay por pins com thresholds por tipo de nó;
   - reexecução determinística com histórico de comparação.

3. **Adapters de código não nativos (Média/Longo prazo)**
   - adicionar runtime adapters dedicados quando sidecar/MCP nao forem suficientes;
   - mapa de segurança (timeout, retry, payload whitelist, redaction);
   - ampliar logs avançados de sandbox isolado e mapear isolamento dedicado por nó quando necessário.

4. **Multiagente operacional**
   - rota/agent_id estável no runtime e no Studio já possui primeira implementação;
   - ampliar ações operacionais por agente dentro do bundle além do mapa inicial de rotas/endpoints;
   - validar bundle multiagente com PostgreSQL real compartilhado.

## Regras de bloqueio até fechamento de uma fase

- Nenhuma etapa pode ser marcada "concluída" enquanto não cumprir:
  - paridade da capacidade equivalente à de um fluxo de referência real (ProUp/semântica de conversa);
  - aprovação por hash válida para geração do runtime final;
  - evidência local de debug (run+timeline+state diff+node IO);
  - tema claro e escuro testado no fluxo alvo;
  - fluxo completo sem troca para ferramentas externas no caminho principal.
