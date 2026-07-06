# Plano Completo: Agent Flow Builder Local Studio

Este plano substitui a dependência operacional do LangSmith Studio por uma experiência 100% local dentro do Agent Flow Builder. A ferramenta continua podendo gerar artefato compatível com LangGraph Platform, mas o fluxo principal passa a ser local-first: desenhar, testar, debugar, aprovar e empacotar sem cloud obrigatória.

Nota de status: o MVP principal desse fluxo local-first esta 100% verificado. As pendencias deste documento se referem ao plano completo expandido, nao a reabertura do MVP principal.

## Objetivo

Transformar o Agent Flow Builder em uma ferramenta completa local para criação e validação de agentes:

```text
Builder Visual -> Studio Local -> Aprovar Versão -> API Docker
```

O usuário deve trabalhar em uma única interface, com a mesma identidade visual, tema claro/escuro, navegação contínua e sem alternar entre produtos externos para depurar o agente.

## Custo e Execução Local

Rodando tudo localmente, não há taxa do LangSmith Cloud. Os custos restantes são:

- recursos da própria máquina;
- Docker Desktop ou runtime equivalente;
- chamadas de modelo caso o usuário configure OpenAI/OpenRouter/outro provedor pago;
- zero custo de modelo se usar mock ou modelo local compatível.

O modo local deve funcionar sem `LANGSMITH_API_KEY` e sem conexão com `smith.langchain.com`.

Quando o usuário quiser levar um pacote para LangSmith/LangGraph Cloud, o Builder deve tratar isso como handoff opcional e governado: gerar um arquivo `.aflangsmithhandoff.json` com checklist, comandos e status de sandbox/aprovação, registrar evidência local de deploy/verificação externa em `.aflangsmithdeployments.json`, disparar deploy por endpoint governado configurado por env e sincronizar opcionalmente esses registros com uma central HTTP por env, sem acoplar o fluxo local a cloud, sem persistir token, enviando token somente no header e sem incluir secrets, payloads brutos, prompts ou schemas brutos. Deploy gerenciado diretamente contra um provedor específico fica fora do caminho principal local-first.

## Princípios de Produto

- Uma única identidade visual para builder, studio, aprovação e runtime.
- Tema claro e escuro como requisito de primeira classe.
- Fluxo contínuo, com mínimo de pop-ups e troca de contexto.
- Paridade funcional com o que o usuário espera de um studio de agente: grafo, threads, runs, estado, inputs/outputs, logs, eventos e traces.
- Implementação própria, sem copiar HTML, CSS, JS, marca ou assets proprietários de terceiros.
- Todos os dados de debug ficam em storage local do projeto.

## Especificações de UI/UX

O plano mestre consolidado de implementação está em `docs/master-implementation-plan.md`.

Este plano é detalhado pelos documentos de interface em `docs/ux/`:

- `docs/ux/source-research-langsmith-n8n.md`: pesquisa de referências públicas do LangSmith/LangGraph Studio, n8n e avaliação das skills de clone como metodologia.
- `docs/ux/agent-browser-sweep-notes.md`: varredura navegada com a skill local `agent-browser`, incluindo observações de snapshots e screenshots salvos.
- `docs/ux/logged-in-screenshot-raw-analysis.md`: análise crua dos screenshots logados fornecidos pelo usuário, imagem por imagem e por conexões de fluxo.
- `docs/ux/local-studio-product-decisions.md`: decisões de produto/UX sobre o que adotar, adaptar, rejeitar ou adiar para evitar regressões.
- `docs/ux/visual-behavior-reference-rules.md`: regras visuais e comportamentais observadas/inferidas das referências para orientar implementação fiel.
- `docs/ux/input-ai-element-fit-matrix.md`: matriz de tipos de entrada, melhor elemento de IA/runtime, UI recomendada, hash, trace e uso correto.
- `docs/ux/local-studio-interface-spec.md`: estrutura de interface para Builder, Studio Local, Artefatos e Runtime.
- `docs/ux/local-studio-interaction-model.md`: comportamentos esperados para edição, sandbox, runs, timeline, state, aprovação e Docker.
- `docs/ux/design-system.md`: tokens, temas claro/escuro, componentes, canvas, nós, arestas e QA visual.
- `docs/ux/ui-ux-implementation-roadmap.md`: fases de implementação focadas em usabilidade e critérios de aceite.

## Experiência Alvo

### 1. Builder Visual

O usuário monta o agente no canvas atual:

- cria nós e arestas;
- edita prompts, schemas e integrações;
- valida o flow;
- gera pacote de sandbox local;
- entra no Studio Local sem sair do app.

### 2. Studio Local

A aba `Studio Local` deve abrir o agente em modo de teste:

- visão do grafo executável;
- thread/session explorer;
- run explorer;
- playground de input;
- painel de estado atual;
- timeline de execução;
- inputs e outputs por nó;
- logs do processo sandbox;
- eventos e transcript;
- comparação entre runs;
- replay de uma run;
- aprovação da versão testada.

### 3. Aprovação por Hash

Após testar, o usuário aprova a versão:

- o hash cobre `agent.flow.json`, prompts, schemas e arquivos usados;
- o registro fica em `.agent-flow/langgraph-sandbox-approval.json`;
- qualquer alteração no flow/assets invalida a aprovação;
- a API Docker final só é gerada a partir de versão aprovada.

### 4. API Docker

O runtime final é gerado e testado:

- FastAPI;
- Dockerfile;
- docker-compose;
- Postgres/Redis quando configurado;
- `/docs`, `/openapi.json`, `/health`;
- smoke test local de sessão, start, turn, transcript e events.
- O artefato gerado deve subir sem `.env` obrigatório no Compose, usar `MOCK_LLM=true` por padrão e manter `LANGSMITH_TRACING=false` no `.env.example`, para que o modo local não tente chamar `smith.langchain.com`.
- Evidência atual: em 2026-07-03 o runtime `generated/reference-interview-runtime` subiu com Docker Compose real, Postgres, Redis, API e worker; o smoke HTTP cobriu health, metadata, sessão, start, turn, transcript, events, finish e jobs, com job final `succeeded`. O gate repetível é `npm run test:docker-runtime-smoke`.

## Arquitetura Proposta

### Builder UI

Adicionar uma navegação contínua:

```text
Flow | Studio Local | Artefatos | Runtime | Settings
```

O canvas atual continua sendo a origem do flow. O Studio Local não deve ser uma segunda ferramenta isolada; ele deve consumir o flow selecionado e mostrar execução real.

### Builder API

Novas responsabilidades:

- iniciar/parar sandbox LangGraph local;
- registrar processos, portas e status;
- coletar logs;
- criar threads/runs locais;
- persistir traces locais;
- expor APIs de timeline, state snapshots e node IO;
- controlar aprovação por hash;
- gerar runtime aprovado;
- subir/descer API Docker final em modo local.

### Local Studio Runtime

Existem dois caminhos possíveis:

1. Usar `langgraph dev` como engine local quando disponível.
2. Usar um runner próprio em Python baseado no grafo gerado, com instrumentação própria.

O caminho inicial recomendado é híbrido:

- manter compatibilidade com `langgraph dev`;
- instrumentar o runtime gerado para salvar traces locais próprios;
- usar APIs internas do Builder para exibir o debug, em vez de depender da UI web do LangSmith.

### Storage Local

Começar com SQLite local do Builder e evoluir para Postgres opcional.

Tabelas sugeridas:

- `studio_runs`;
- `studio_threads`;
- `studio_events`;
- `studio_node_io`;
- `studio_state_snapshots`;
- `studio_logs`;
- `studio_approvals`.

## Identidade Visual

### Tema

Implementar tema por tokens CSS:

- `--surface-base`;
- `--surface-panel`;
- `--surface-raised`;
- `--border-subtle`;
- `--text-primary`;
- `--text-secondary`;
- `--accent`;
- `--accent-muted`;
- `--danger`;
- `--warning`;
- `--success`;
- `--node-start`;
- `--node-llm`;
- `--node-safety`;
- `--node-integration`;
- `--node-human`;
- `--node-end`.

Requisitos:

- tema claro;
- tema escuro;
- toggle persistente;
- respeitar preferência do sistema como padrão inicial;
- contraste adequado em canvas, sidebars, code blocks, inputs e badges.

### Layout

O produto deve parecer uma ferramenta operacional, não uma landing page:

- top bar compacta;
- sidebar esquerda para flows e navegação;
- canvas/visualização central;
- painel direito contextual;
- drawer inferior para logs/timeline quando útil;
- sem cards decorativos aninhados;
- alta densidade visual sem poluição.

## Paridade Funcional Esperada do Studio Local

### Grafo

- visualização do grafo executável;
- destaque do nó em execução;
- cores por tipo de nó;
- estado de cada nó: pending, running, success, blocked, error, skipped;
- clique no nó abre input/output/eventos daquele nó;
- zoom, pan, fit view e minimap.

### Threads e Runs

- criar nova thread/session;
- listar threads recentes;
- listar runs por thread;
- status da run;
- duração;
- número de nós executados;
- erros;
- replay.

### Playground

- payload editor;
- templates de payload por contrato;
- start/turn/finish;
- histórico de mensagens;
- resposta do agente;
- idempotency key visível/editável;
- modo mock LLM ligado/desligado.

### State Inspector

- estado completo em JSON;
- diff entre snapshots;
- busca dentro do state;
- copiar caminho de estado;
- destacar campos alterados pela run.

### Node IO

- entrada recebida pelo nó;
- saída produzida pelo nó;
- prompt renderizado;
- resposta bruta do modelo;
- schema usado;
- erros/retries;
- tempo de execução;
- eventos emitidos.

### Timeline

- lista cronológica de nós e eventos;
- filtros por tipo;
- colapso por run;
- links para nó no grafo;
- marcação de erro;
- export JSON.

### Logs

- logs do sandbox;
- logs do Builder API;
- logs da API Docker final;
- filtro por nível;
- pausa/seguir;
- copiar trecho.

### Aprovação

- botão `Aprovar versão`;
- resumo do hash;
- lista de assets cobertos;
- status `aprovado`, `desatualizado`, `não aprovado`;
- bloqueio visual da geração Docker se a aprovação estiver inválida.

## Fluxo Sem Interferências

O usuário deve conseguir fazer tudo nesta ordem:

1. Abrir o flow.
2. Editar o agente.
3. Validar.
4. Clicar `Studio Local`.
5. Rodar cenários.
6. Inspecionar grafo, estado e eventos.
7. Ajustar o flow se necessário.
8. Aprovar versão.
9. Gerar API Docker.
10. Rodar smoke test.
11. Baixar ou manter o runtime em `generated/`.

## Fases de Implementação

### Fase 7.0: Design System Local

Entregáveis:

- tokens CSS;
- tema claro;
- tema escuro;
- toggle persistente;
- revisão dos componentes existentes para usar tokens;
- estados visuais comuns: idle, dirty, running, success, warning, error.

Critério de sucesso:

- Builder atual e futuras telas do Studio usam a mesma identidade visual nos dois temas.

### Fase 7.1: Shell do Studio Local

Entregáveis:

- aba `Studio Local`;
- layout com grafo central, painel direito e timeline/logs;
- integração com o flow selecionado;
- estado vazio quando não houver sandbox.

Critério de sucesso:

- o usuário acessa o Studio Local sem sair do Builder.

### Fase 7.2: Orquestração Local de Sandbox

Entregáveis:

- iniciar/parar sandbox local;
- seleção automática de porta;
- healthcheck;
- logs;
- status persistido;
- limpeza de resíduos temporários.

Critério de sucesso:

- o Builder inicia o agente de teste local e mostra status confiável.

### Fase 7.3: Execução e Playground

Entregáveis:

- criar sessão/thread;
- start/turn/finish;
- editor de payload;
- transcript;
- events;
- idempotency key;
- modo mock LLM.

Critério de sucesso:

- o usuário testa o agente sem terminal e sem Swagger.

Status 2026-07-01:

- idempotency key visível/editável implementada para envio manual de turno, propagada no header `Idempotency-Key` também no consumo SSE de `turn/stream`.

### Fase 7.4: Trace Local

Entregáveis:

- persistir runs locais;
- timeline;
- state snapshots;
- node IO;
- eventos por nó;
- filtros e export JSON.

Critério de sucesso:

- o usuário entende o que cada nó recebeu, produziu e alterou no estado.

Status 2026-06-30:

- primeira persistencia de runs locais implementada em `flows/{flowId}/.agent-flow/studio-runs/`;
- Builder API lista, salva e carrega snapshots com sessão, transcript, events, logs, métricas, state derivado por evento e diff incremental;
- Builder UI lista runs locais, salva snapshots após execução e recarrega um run para replay básico com timeline, state e diff do evento selecionado;
- implementado: comparação entre runs com diffs semânticos por nó, cadeia causal visual (upstream/impact), pinning de cenário, cenário favorito, repetição do último cenário e execução reprodutível por atalho;
- implementado: progresso incremental de build no histórico e painel de progresso no artefato;
- implementado: runtime final gerado com `.env` opcional no Compose, LangSmith desligado por padrão, lock transacional de schema em PostgreSQL e smoke Docker real validando API/worker/jobs em 2026-07-03, agora coberto por `npm run test:docker-runtime-smoke`;
- implementado: drill-down contextual por nó com input/output, eventos, diffs, logs correlacionados, prompt renderizado, metadados LLM, métricas de usage/custo/duração, logs estruturados de código customizado com filtros/exportação JSON e spans estruturados;
- implementado: diagnóstico operacional por nó com causa provável, próximas ações e evidências derivadas de payload/safety/status/snapshot/cadeia causal, com regras específicas para LLM, safety, code, HTTP, banco, arquivo/RAG, approval, scoring e analytics;
- implementado: fork de checkpoint/evento para cenário local reexecutável, preservando origem de run, evento, snapshot, input/output e metadata da nova execução;
- implementado: status global acessível (`status`/`alert`) com cobertura visual automatizada de loading/erro fora do fluxo Docker em tema claro e escuro;
- implementado: faixa operacional `Status global do Studio` no topo do Studio, com sessão, runs, eventos, nó/falha em foco e CTA única contextual para iniciar, criar sessão, enviar turno ou abrir nó/falha;
- implementado: `Execução ao vivo` preserva o progresso de todos os nós do agente mesmo com timeline filtrada, destaca o nó selecionado pela timeline e abre o evento mais recente do nó ao clicar no card;
- implementado: timeline possui empty state com CTA única contextual para mostrar todos os eventos, iniciar o Studio, criar sessão ou enviar turno;
- implementado: pin local de input/output por nó, com origem run/evento e indicador `atual/stale` quando a definição do nó muda, além de primeira camada compartilhável file-backed em `.agent-flow/studio-node-pins/pins.afnodepins.json`, formato `agent-flow-builder.studio-node-pins.v1`, ações visuais `Carregar pins`/`Sincronizar pins`/`Exportar revisão`/`Comparar revisão`/`Central`/`Sync central`, painel `Conflitos de pins` com thread/atribuição local de curadoria (`Assumir`/`Liberar`), lease de curadoria configurável por `AGENT_FLOW_STUDIO_NODE_PIN_CONFLICT_CURATION_LEASE_HOURS`, liberação automática de conflito com lease vencido e histórico compacto de eventos, rotas `POST /flows/:flowId/studio-node-pins/conflicts/:conflictId/curation`, `POST /flows/:flowId/studio-node-pins/conflicts/:conflictId/resolve`, `GET /flows/:flowId/studio-node-pins/conflicts-review` e `POST /flows/:flowId/studio-node-pins/conflicts-review/diff`, export `.afnodepin-conflicts.json` e `.afnodepin-conflicts-diff.json` sem candidatos completos, `pins`, input/output bruto ou secrets, sync central opcional por `AGENT_FLOW_STUDIO_NODE_PINS_CENTRAL_URL`/`AGENT_FLOW_STUDIO_NODE_PINS_CENTRAL_TOKEN`, preservação de candidatos por `nodeId`/`id`, candidato mais recente ativo por nó, histórico governado de resolução com revisor/nota/pin mantido/refs descartadas sem input/output bruto, tombstone por `id`/`nodeId`/`contentHash` para não reabrir conflito quando o mesmo candidato descartado volta por sync, visualização dessa trilha no Studio, token somente no header, status sem URL/token e redaction de chaves sensíveis antes de salvar ou enviar input/output no pacote compartilhado;
- implementado: resumos multi-camadas de comparação/lote podem ser compartilhados por flow em `.agent-flow/debug-layers/snapshots.afdebuglayers.json`, formato `agent-flow-builder.debug-layer-snapshots.v1`, com ações visuais `Compartilhar resumo`, `Exportar revisão`, `Comparar revisão`, `Central` e `Sync central`, rotas `GET`/`PUT`/`POST merge`/`POST conflicts/:conflictId/curation`/`POST conflicts/:conflictId/resolve`/`GET conflicts-review`/`POST conflicts-review/diff` e sync central opcional por `AGENT_FLOW_DEBUG_LAYER_SNAPSHOTS_CENTRAL_URL`/`AGENT_FLOW_DEBUG_LAYER_SNAPSHOTS_CENTRAL_TOKEN`, merge por `packageHash`, painel visual `Conflitos de camadas` com thread/atribuição local de curadoria (`Assumir`/`Liberar`), lease configurável por `AGENT_FLOW_DEBUG_LAYER_SNAPSHOT_CONFLICT_CURATION_LEASE_HOURS`, liberação automática de lease vencido e histórico compacto de eventos, detecção/resolução inicial de conflitos por contexto escolhendo qual snapshot manter, export `.afdebuglayer-conflicts.json` e comparação `.afdebuglayer-conflicts-diff.json` sem snapshots completos, evidências, payload bruto, input/output ou secrets, histórico governado de resolução com revisor/nota/snapshot mantido/refs descartadas sem payload bruto, tombstone por ref descartada para não reabrir o mesmo conflito quando ela volta por sync, token somente no header, status sem URL/token e sanitização de evidências antes de persistir/enviar;
- implementado: histórico governado de replay compartilhado detecta conflito somente quando a mesma evidência/checkpoint/pins/evaluator recebe curadorias divergentes; o Studio mostra `Conflitos de replay` no roteiro do cenário com thread/atribuição local de curadoria (`Assumir`/`Liberar`), lease configurável por `AGENT_FLOW_REPLAY_GOVERNANCE_CONFLICT_CURATION_LEASE_HOURS`, liberação automática de lease vencido e eventos compactos, a API atualiza essa thread por `POST /flows/:flowId/replay-governance-history/conflicts/:conflictId/curation` e resolve por `POST /flows/:flowId/replay-governance-history/conflicts/:conflictId/resolve`, mantendo o snapshot escolhido sem persistir payload bruto de cenário, pins, checkpoint ou secrets, registrando histórico governado de resolução com revisor/nota/snapshot mantido/refs descartadas e tombstone para não reabrir a mesma ref descartada quando ela volta por sync; a revisão governada dos conflitos pode ser exportada e comparada por `GET /flows/:flowId/replay-governance-history/conflicts-review`, `POST /flows/:flowId/replay-governance-history/conflicts-review/diff`, botões `Exportar revisão`/`Comparar revisão` e arquivos `.afreplay-conflicts.json`/`.afreplay-conflicts-diff.json`, sem snapshots completos, payload de cenário, pins, checkpoint, input/output ou secrets;
- implementado: cenário pode ativar mock por pins de nó; a UI envia apenas pins ativos na metadata da sessão e o runtime gerado aplica o payload pinado antes de executar LLM, safety, code, HTTP, transform, banco, arquivo/RAG, approval, scoring, analytics, start/human/finish/noop;
- implementado: comparação de runs calcula modo `live/mock/pinned`, eventos pinados/mock, tokens, custo estimado e um resumo de regressão com severidade, motivos, indicação de pinado vs real e inbox local/exportável/compartilhada file-backed de alertas `.afregressionalerts.json` em `.agent-flow/regression-alerts/inbox.afregressionalerts.json`, sync central opcional por `AGENT_FLOW_REGRESSION_ALERTS_CENTRAL_URL`/`AGENT_FLOW_REGRESSION_ALERTS_CENTRAL_TOKEN` com ações `Central`/`Sync central`, token somente no header e sem runs brutas, payloads de nó ou secrets;
- implementado: thresholds de regressão por cenário para crescimento de tokens, custo e duração, enviados na metadata e aplicados ao veredito da comparação;
- implementado: importação/exportação de fixture JSON por cenário com input, thresholds, checkpoint, pins ativos/stale e metadata de replay;
- implementado: execução sequencial em lote de cenários/fixtures com resumo por cenário, sessão, duração, erro e comparação automática com o run anterior do mesmo cenário;
- implementado: primeira camada de templates visuais de cenário no Studio (`Caminho feliz`, `Bloqueio de safety`, `Replay com pins` e `Contrato JSON`), aplicando input, tags, evaluator local, pins e thresholds no formulário antes de salvar;
- implementado: relatório JSON exportável de lote com hash determinístico, resumo de severidade, resultados por cenário e aprovação local quando o lote não contém erro ou regressão `fail`;
- implementado: restauração de cenário forkado no runtime gerado, preferindo estado real do checkpointer por `sourceSessionId` e usando snapshot serializado do Studio como fallback;
- implementado: indicação visual da estratégia esperada e da origem observada da restauração de checkpoint (`checkpointer` ou `snapshot`) no cenário forkado e no `State inspector`;
- implementado: validação forte de compatibilidade de versão/hash para restauração de checkpoint, com assinatura no fork/fixture e bloqueio de execução quando `flowId`, versão, hash local, hash de projeto/assets ou hash de nó divergem;
- implementado: histórico operacional Docker com filtro por nível/severidade (`erro`, `aviso`, `info`, `sucesso`) além de operação, status, resultado, busca, etapa, progresso e período;
- implementado: alertas operacionais persistentes para Build, Up e Smoke, com estados de pendência, sucesso, desatualização, erro e regressão após sucesso anterior.

### Fase 7.5: Grafo Interativo de Execução

Entregáveis:

- grafo com status por nó;
- destaque em tempo real ou quase real;
- clique no nó abre detalhes;
- minimap e fit view;
- replay de run no grafo.

Critério de sucesso:

- a experiência de debug visual cobre o principal valor de um studio de agente.

### Fase 7.6: Aprovação Local e Docker Final

Entregáveis:

- aprovação por hash no Studio;
- indicação de aprovação inválida após alteração;
- geração da API Docker apenas quando aprovada;
- build/run/smoke do container pela UI;
- smoke agregado para todos os agentes de bundles multiagente pela UI;
- logs do container final.

Critério de sucesso:

- o usuário sai do Studio Local direto para uma API Docker validada.

### Fase 7.7: Multiagente Local

Entregáveis:

- visualizar manifestos multiagente;
- editar visualmente `runtime.manifest.json` com agentes, LLM padrão, empacotamento e prefixos de rota;
- visualizar mapa operacional do bundle com app raiz, rotas, metadata, runtime por agente e endpoint de sessão;
- sugerir composição multiagente no Runtime Manifest, incluindo flows ainda não adicionados, templates iniciais de papéis, checklist de prontidão e orquestração declarativa por entrada/handoffs;
- testar agentes por `agent_id`;
- isolamento por rota/agente;
- runs por agente;
- Postgres compartilhado em teste local;
- logs e traces separados por agente.
- runbook JSON exportável por agente e atalho de histórico filtrado por agente, com URLs reais, comandos de smoke manual, comando de setup de modelos locais quando aplicável, checklist e evidência operacional sem `.env`/secrets; o bundle multiagente também possui geração final aprovada por manifesto, com aprovação agregada e aprovação por agente embarcadas no pacote.

Critério de sucesso:

- bundles multiagente são depurados localmente com clareza operacional.

### Fase 7.8: Recursos Avançados

Entregáveis:

- Dashboards históricos adicionais e políticas ainda mais avançadas de entrega/escalonamento de alertas ainda podem evoluir; streams de eventos por SSE/WebSocket, spans nativos `span_started`/`span_completed` durante a chamada, callback incremental de tokens no grafo, `turn/stream` SSE/WebSocket, primeira camada visual de progresso por nó/uso por provider, telemetria histórica local com janela/alertas por orçamento, dashboard histórico dedicado por provider com snapshots/export/merge/sync central opcional/diff governado, arquivos `.afprovidertelemetryhistory.json`/`.afprovidertelemetryhistory-diff.json`, token central somente no header/status sem URL ou token, e inbox local/exportável/compartilhada file-backed de alertas de provider com sync central opcional, roteamento lógico por `AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTES`, escalonamento local por `AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ESCALATION_POLICY`, política de entrega por `AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_DELIVERY_POLICY`, prontidão exportável `.afproviderdelivery.json`, dispatch externo governado por rota via `AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTE_SINKS`, retenção/reconhecimento/reabertura por nova ocorrência no Studio já existem;
- consumo visual básico de `turn/stream` no envio de turno já existe, com painel de resposta incremental, contador de tokens, origem dos chunks e estado de conclusão/erro no Studio;
- histórico persistido, compartilhável, comparável e sincronizável de métricas para jobs pós-finalização; schedule manual por job, recorrência simples por intervalo, cron ou evento, endpoint `POST /job-schedules/trigger-event`, métricas agregadas com janela configurável/p95/throughput, leases ativos/expirados, retry, reprocessamento manual, limpeza governada com prévia, cleanup automático governado opcional por `WORKER_CLEANUP_*`, primeira camada persistente/manual/recorrente, worker CLI opcional, serviço `worker` configurável no Docker Compose, claim/lease multiworker com retomada após expiração e contrato `/metadata.operations.jobs` com worker/retenção/schedules sanitizados já existem, incluindo `.afjobmetrics.json`, `.afjobmetrics-diff.json` e sync central opcional por `AGENT_FLOW_RUNTIME_JOB_METRICS_HISTORY_CENTRAL_URL` sem token no corpo/status;
- Safety Harness avançado com governança de políticas, avaliação contínua, revisão humana e dashboards; a primeira camada local configurável por nó já existe no `safety_gate`, provider HTTP externo opcional já existe no Builder/runtime final, export governado `.afsafetyhistory.json` já existe sem input bruto/secrets, diff governado `.afsafetyhistory-diff.json` já existe sem `inputPreview`, `matchedText`, headers externos, payloads brutos de provider ou secrets, sync central opcional do histórico de Safety Harness já existe por `AGENT_FLOW_SAFETY_HARNESS_CENTRAL_URL`/`AGENT_FLOW_SAFETY_HARNESS_CENTRAL_TOKEN`, com ações visuais `Central`/`Sync central`, token somente no header, status sem URL/token, pacote sanitizado sem `inputPreview`/`matchedText` e `resolutionHistory` compacta para colisões do mesmo run, mantendo a revisão/decisão mais recente sem input bruto, matched text, headers externos ou secrets, o dashboard local agregado de experimentos já existe no Studio, o dashboard histórico dedicado local já mostra tendência entre snapshots, deltas, melhor/pior snapshot e drift de flow, o histórico experimental já é exportável/comparável por `.afexperiment-dashboard-history.json`/`.afexperiment-dashboard-history-diff.json` e sincronizável com central opcional por `AGENT_FLOW_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_URL` com token somente no header, status sem URL/token e diff sem dashboard bruto/runs brutas/saídas observadas, e a fila local de revisão já é compartilhável por pacote `.afannotations.json`, backend file-backed e sync central opcional por `AGENT_FLOW_ANNOTATION_QUEUE_CENTRAL_URL`/`AGENT_FLOW_ANNOTATION_QUEUE_CENTRAL_TOKEN`, com ações visuais `Central`/`Sync central`, token somente no header, status sem URL/token, sem envio de runs brutas, identidade local de revisor, triagem em lote para assumir/aprovar/reprovar pendências visíveis, policy local por responsável, papéis locais, auditoria compacta, snapshots históricos compactos/exportáveis `.afannotationhistory.json` sem payload bruto dos itens, detecção/resolução de conflitos de revisão com snapshots completos das versões conflitantes no pacote operacional, export/diff governado `.afannotation-conflicts.json`/`.afannotation-conflicts-diff.json` sem itens completos, snapshots, vereditos, razões, notas ou saídas observadas e thread/atribuição de curadoria de conflito (`Assumir`/`Liberar`) com lease configurável por `AGENT_FLOW_ANNOTATION_CONFLICT_CURATION_LEASE_HOURS`, liberação automática de lease vencido e histórico compacto de eventos;
- Editor visual de JSON Schema já possui primeira biblioteca local/exportável/importável de padrões `.afschemapatterns.json`, permitindo salvar o schema visual atual, ver preview/diff local de adições/conflitos, exportar/importar/revisar diff governado `.afschemapatterndiff.json` com verificação de hash, salvar/exportar/importar histórico `.afschemapatternhistory.json` sem schema bruto, comparar/exportar/importar/revisar diff histórico `.afschemapatternhistorydiff.json`, aplicar padrões por merge não destrutivo de propriedades, `$defs`, required e composições, aprovar/deprecar/remover padrões locais, calcular assessment exportável de prontidão/risco sem schema bruto, registrar revisões colaborativas estruturadas por curador (`approve`, `request_changes`, `deprecate`) sem schema bruto, assumir/liberar thread de curadoria por responsável local com lease padrão de 24h configurável por `AGENT_FLOW_SCHEMA_PATTERN_CURATION_LEASE_HOURS`, liberação automática de lease vencido e histórico compacto `curationThread.events` sem schema bruto, acompanhar uso/último uso, sincronizar biblioteca/histórico por backend file-backed em `.agent-flow/schema-patterns/` e executar sync central multiusuário opcional por `AGENT_FLOW_SCHEMA_PATTERN_CENTRAL_URL`/`AGENT_FLOW_SCHEMA_PATTERN_CENTRAL_TOKEN`, com resumo compacto de ação, hash, contagens de merge, conflitos compartilhados com snapshots sem schema bruto, identidade local de curador/papel, resolução guiada por estratégia (`accept_current_library`, `accept_existing_snapshot`, `accept_incoming_snapshot`, `apply_manual_schema_merge`), merge estrutural automático de schemas brutos quando propriedades/`$defs`/`additionalProperties` não colidem, plano assistido sanitizado para colisões reais sem schema bruto, revisão visual em colunas Atual/Recebido/Schema visual, diff sanitizado por área com itens novos, somente atuais e colisões, diff bruto textual local lado a lado quando a resposta de merge possui os dois schemas, export `.afschemapatternmergeplan.json`, aplicação do schema aberto no editor visual como merge manual auditado, aplicação de metadados quando o schema hash selecionado já está presente, prevenção de reabertura da mesma divergência compacta já resolvida quando ela retorna por sync, status central sem URL/token e envio do token somente no header; ainda fica pendente resolução distribuída avançada entre múltiplos autores/workspaces;
- Conflitos compartilhados de padrões de schema também possuem pacote governado de revisão e comparação por `GET /flows/:flowId/schema-pattern-library/conflicts-review` e `POST /flows/:flowId/schema-pattern-library/conflicts-review/diff`, com ações visuais `Exportar revisão`/`Comparar revisão` e artefatos `.afschemapattern-conflicts.json`/`.afschemapattern-conflicts-diff.json` sem schema bruto, diff textual local, `items`, payloads ou secrets;
- Catálogo local já possui biblioteca compartilhável file-backed em `.agent-flow/catalog/shared-library.afcataloglibrary.json`, com rotas de load/merge/resolução de conflito e curadoria de conflito, ações visuais `Carregar compartilhado`/`Sincronizar compartilhado`, atualização do registry local, resumo compacto de ação, hash, contagens e conflitos, sync central multiusuário opcional por `AGENT_FLOW_CATALOG_CENTRAL_URL` com token somente no header/status sem URL ou token, além de cards compactos de conflito por `kind/id` com snapshots sem conteúdo bruto, thread/atribuição visual de curadoria (`Assumir`/`Liberar`) com lease configurável por `AGENT_FLOW_CATALOG_CONFLICT_CURATION_LEASE_HOURS`, liberação automática de lease vencido e histórico compacto de eventos sem conteúdo bruto, curador local com papel `Owner`/`Reviewer`/`Viewer`, bloqueio de resolução para Viewer e decisões `keep_library`, `use_incoming` e `restore_existing_snapshot` com `resolvedBy`, nota, plano sanitizado, aplicação automática quando o conteúdo escolhido já está materializado, sinalização de revisão manual quando o snapshot compacto não permite reconstruir conteúdo bruto, `resolutionHistory` compacta com snapshot mantido/descartado sem conteúdo bruto, prevenção de reabertura quando a mesma divergência compacta já resolvida retorna por sync, revisão governada por `GET /catalog/shared-library/conflicts-review`, comparação por `POST /catalog/shared-library/conflicts-review/diff`, botões `Exportar revisão`/`Comparar revisão` e arquivos `.afcatalog-conflicts.json`/`.afcatalog-conflicts-diff.json` sem itens completos, conteúdo bruto, `nodePatch`, input/output ou secrets, além de edição guiada de schemas internos com métricas, `$defs`, composições e bloqueio de extras; ainda fica pendente governança colaborativa distribuída mais profunda do catálogo;
- A visão agregada `Pendências de colaboração` já consolida conflitos governados de workspace, catálogo, padrões de schema, cenários/datasets/evaluators, annotation queue, pins, camadas de debug e replay por `/collaboration/conflicts`, incluindo triagem por flow/área/severidade/responsável/papel/status, export/comparação governada e contrato `sourceActions` para revisão, diff, curadoria, resolução e bloqueio de mutação por `viewer` sem payload bruto;
- rotação governada de chaves, auditoria centralizada por credencial e autenticação corporativa além dos arquivos locais `AGENT_API_KEYS_PATH`/`AGENT_API_REVOKED_KEY_IDS_PATH`; expiração local por chave, arquivo local rotacionável, revogação local persistente por `key_id`, scopes por agente em bundles, inventário seguro `/auth/keys`, painel visual `Chaves de auth` no Studio com preparo de `AGENT_API_REVOKED_KEY_IDS`, export governado `.afauthkeys.json` sem valores brutos/caminhos locais, rate limit local, auditoria em memória e persistência local JSONL por `AUTH_AUDIT_PATH` já existem como primeira camada; no Builder, auth local por API key, primeira sessão local curta por token `Bearer` hash-only, persistência central local hash-only por `AGENT_FLOW_BUILDER_AUTH_SESSION_PATH`, renovação/logout local com rotação e revogação do token de sessão, JWT/JWKS/OIDC discovery por segredo `HS256`, chave pública `RS256`, JWKS em arquivo/URL ou `.well-known/openid-configuration`, login OIDC local por authorization code + PKCE com state/nonce/id_token/session local, refresh OIDC com refresh token apenas em memória, logout federado com `id_token_hint` de sessão em memória e callback validado por state, sincronização inicial de grupos corporativos por claim JWT/OIDC/local key, diretório local de grupos por env/arquivo, diretório corporativo HTTP opcional por `AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_URL`, política local por grupo para role/áreas/scopes efetivos, inventário, auditoria local com persistência/reload JSONL opcional, sink HTTP central opcional por `AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_URL`, sync HTTP externo de lifecycle de sessão por `AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_URL`, introspecção/decisão central obrigatória de sessão por `AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_URL`, probe governado `POST /builder-auth/external-probe` com ação visual `Testar integrações`, filtros/resumo por status/ator/chave/rota, rotação/revogação por arquivo, escopos/expiração guiados e export governado `.afbuilderauthaudit.json` já existem como camada local/centralizável, enquanto validação homologada contra serviço corporativo real e operação distribuída ampla seguem pendentes;
- `npm run test:builder-auth-corporate` valida essa camada centralizável contra serviços HTTP simulados de sessão, introspecção, auditoria e diretório de grupos, provando contrato e sanitização antes de uma homologação real com IdP/serviço corporativo;
- modelos locais: primeira camada via adapter `ollama` local/OpenAI-compatible já existe no Flow Spec, Builder API/UI e codegen, com default `qwen3:8b`, `OLLAMA_BASE_URL=http://localhost:11434/v1`, `OLLAMA_API_KEY=ollama` dummy, `LLM_MODEL`, compatibilidade com `OPENAI_MODEL`, presets iniciais por perfil de hardware (`llama3.2:3b`, `qwen3:8b`, `qwen3:14b`), healthcheck local no Builder, detecção visual de modelos instalados, chips clicáveis para aplicar modelo já instalado, sugestão de `ollama pull` quando o modelo do flow não estiver baixado, empacotamento Compose inicial do servidor Ollama, pull governado por serviços one-shot `ollama-pull-*` no profile `model-setup` dos runtimes/bundles gerados quando o flow usa adapter local, botão `Modelos` no painel da API Docker para executar esse profile pela UI, fallback prescritivo no runtime com `fallback_reason=local_model_missing`, tuning por variáveis Ollama, override `docker-compose.model-image.yml` com `ollama-models/Dockerfile` para imagem local pré-carregável, `OLLAMA_MODEL_IMAGE` como tag separada de distribuição, ação visual `Build imagem` para construir essa imagem pelo Builder, ação visual `Exportar imagem` para salvar `.tar` versionável e comando de load no runbook, ação visual `Publicar imagem` para `docker image push` quando a tag aponta para registry, catálogo local de imagens em `.agent-flow/model-images/catalog.afmodelimages.json` com registro pela UI, lista visual, export `.afmodelimages.json`, import/merge, descoberta/sync file-backed em `.agent-flow/model-images/imports` ou `AGENT_FLOW_MODEL_IMAGE_CATALOG_PATHS` entre workspaces, registry remoto curado salvo no workspace em `.agent-flow/model-images/remote-registries.afmodelregistry.json`, sync remoto read-only por registries salvos ou URLs HTTP(S) em `AGENT_FLOW_MODEL_IMAGE_CATALOG_REMOTE_URLS` sem envio de credenciais e sync central multiusuário por `AGENT_FLOW_MODEL_IMAGE_CATALOG_CENTRAL_URL` com token somente no header; ainda falta validação prática ampla em múltiplas combinações reais de driver, Docker Desktop/Linux, NVIDIA Container Toolkit e imagens CUDA;
- expandir templates avançados de cenários de teste além dos presets iniciais já aplicáveis no formulário do Studio;
- avaliação/scoring automatizada avançada por lote alem dos cenários, evaluators textuais/JSON path/HTTP/LLM-as-judge e datasets locais versionados/exportáveis/importáveis já existentes.

Critério de sucesso:

- a ferramenta cobre workflows reais além do agente de referência.

## O Que Sai do Escopo Principal

Integração com LangSmith Cloud vira opcional:

- exportar pacote compatível;
- gerar handoff governado `.aflangsmithhandoff.json`;
- registrar evidência local de deploy/verificação externa `.aflangsmithdeployments.json` com URLs sanitizadas;
- disparar deploy opcional por endpoint governado `AGENT_FLOW_LANGSMITH_CLOUD_DEPLOY_URL`, com token somente no header e resposta salva como evidência local;
- sincronizar opcionalmente os registros `.aflangsmithdeployments.json` com central HTTP por `AGENT_FLOW_LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_URL`, token somente no header e status sem URL/token;
- copiar comando `langgraph dev` e checklist de importação;
- configurar `LANGSMITH_API_KEY` somente fora do Builder, se o operador decidir usar cloud;
- abrir Studio web oficial se o usuário quiser.

Mas a ferramenta não deve depender disso para operar.

## Critérios de Aceite do Produto Completo

- funciona sem internet para mock/modelos locais;
- não exige conta LangSmith;
- tem tema claro e escuro;
- permite criar, testar, debugar e aprovar agente localmente;
- mostra grafo, state, timeline, eventos, logs e node IO;
- gera container final aprovado;
- roda smoke test do container pela UI;
- preserva hash e rastreabilidade da versão;
- mantém identidade visual única do Agent Flow Builder;
- permite evolução para multiagente, streaming, jobs, safety e autenticação corporativa.

## Plano de Entrega Atual (continuidade)

### Prioridade 1 (semana atual)

1. aprofundar o drill-down contextual no Studio:
   - abrir node-io e eventos no mesmo clique do nó falho/impactado;
   - ampliar cobertura de exemplos e cenários salvos para as regras específicas por tipo de nó;
   - validação forte de compatibilidade de versão/hash para restauração de checkpoint já implementada.
2. melhorar inspeção de execução longa:
   - histórico operacional com filtro por nível já implementado;
   - status persistente de build/up/smoke com alertas visuais de regressão já implementado.

### Prioridade 2 (próxima semana)

3. consolidar cenários:
   - replay por pins já salvo como mock determinístico por cenário;
   - histórico governado local/exportável, compartilhado file-backed e sync central opcional de replay (`.afreplayhistory.json` em `.agent-flow/replay-governance/` e `AGENT_FLOW_REPLAY_GOVERNANCE_HISTORY_CENTRAL_URL`) já implementado sem payload bruto de cenário, pins, checkpoint ou secrets;
   - conflito de curadoria do histórico de replay já é detectado por evidência governada, pode ser assumido/liberado por responsável local com lease configurável, expiração automática, eventos compactos e é resolvido visualmente/API mantendo o snapshot escolhido;
   - diff histórico governado entre snapshots de replay (`.afreplayhistorydiff.json`) já implementado sem payload bruto;
   - comparação básica de métricas/regressão entre replay pinado e run real já implementada;
   - thresholds configuráveis por cenário já implementados para tokens/custo/duração;
   - fixtures importáveis/exportáveis por cenário já implementadas;
   - execução sequencial em lote de fixtures já implementada;
   - comparação automática de baseline/candidate por lote já implementada;
   - relatório/aprovação exportável de lote já implementado;
   - restauração por checkpointer/snapshot já implementada no runtime gerado;
   - assinatura de compatibilidade por checkpoint/fixture já implementada.
4. auditoria completa de tema:
   - verificar fluxo em ambas paletas;
   - revisar contraste e tooltips em telas `Flow`, `Studio`, `Artefatos`, `Runtime`;
   - ampliar estados internos de erro/loading em painéis específicos além do status global já coberto.
5. governança runtime/secrets:
   - secrets locais mascarados e enviados ao sandbox apenas no start já implementados;
   - exportação manual controlada de `.env` local já implementada, incluindo somente envs configuradas e não protegidas pelo sandbox;
   - políticas compartilháveis opcionais já implementadas via perfis locais exportáveis/importáveis (`.afsecrets.json`), seleção por flow, padrão de workspace, export/import junto do workspace e bloqueio de variáveis protegidas no `.env` local.

### Prioridade 3 (seguinte)

6. capacidade não nativa expandida:
   - HTTP, MCP stdio, sidecar local e `runtime_adapter` por endpoint já possuem contrato inicial por nó de código; `runtime_adapter` também já possui primeira execução por runner VM local quando `sandboxIsolation="vm"` e o adapter declara `codeInline` ou `codePath`;
   - retry, allowlist de payload, redaction e limite máximo de payload já possuem primeira implementação visual/canônica para executores externos de nós `code`;
   - metadados de sandbox/isolamento por execução customizada já são registrados no runtime e exibidos/exportados no Studio Local;
   - `sandboxIsolation: "ephemeral_workspace"` já cria uma cópia temporária de `app/code` para executores process-backed (`sidecar`, `mcp` e runner Node), executa com `cwd` nessa cópia, permite `sandboxEnvAllowlist` e descarta escritas após a execução;
   - `sandboxIsolation: "dedicated_process"` já executa Python `native`/`inline`/`file` em outro processo Python por stdin/stdout JSON, também com workspace temporário, `sandboxEnvAllowlist`, trace dedicado e descarte das escritas do worker;
   - `sandboxIsolation: "container"` já executa Python, JavaScript e TypeScript `native`/`inline`/`file` em `docker`/`podman` com `--network none`, imagem/engine configuráveis por preset gerenciado ou campo manual, workspace temporário, env allowlist, perfil `baseline`/`hardened`, limites de memória/CPU/PIDs, rootfs read-only, cap-drop, no-new-privileges e trace de imagem/engine/rede/perfil;
- `sandboxIsolation: "vm"` já funciona como ponte local para runner externo de VM/microVM, com `sandboxVmImageId`, presets gerenciados iniciais de VM para Python/Node, checker local de runner/imagem/manifestos VM sem executar código do usuário, validação de protocolo, engine, imageId, tamanho declarado, SHA-256 opcional e capabilities hardened quando manifestos estão presentes, export governado `.afvmreadiness.json` sem paths locais resolvidos, scaffold QEMU com cloud-init/build/boot/transportador SSH, scaffold microVM direct-kernel com preparo rootfs/kernel ou firmware/seed, política hardened e preflights Firecracker/Cloud Hypervisor, smoke real Docker/QEMU com cloud image Debian, gate microVM real opt-in para Firecracker/Cloud Hypervisor com dry-run, preflight real e boot launch smoke quando binários/artefatos são fornecidos, contrato de homologação `.afvmhomologation.json` com estados `blocked`, `preflight_verified` e `homologated`, receita oficial local `vm-image:microvm-recipe` com scripts de build/preflight/homologação/bundle/publicação local, registro consumível `vm-image:microvm-register`, pacote `.afvmimagebundle` com manifestos sanitizados, imagem, artefatos obrigatórios de boot e `microvm.policy.json` copiados/verificados, `runner-kit` portátil auto-verificável, scripts de ambiente para `AGENT_FLOW_CODE_VM_BOOT_ARTIFACTS`/`AGENT_FLOW_CODE_VM_SEED_IMAGE`/`AGENT_FLOW_MICROVM_POLICY_MANIFEST`, runner de referência opt-in para contrato Python local, runner QEMU de preflight com plano Q35/microVM, runner Firecracker/Cloud Hypervisor de preflight direct-kernel com rootfs/kernel/firmware/seed e política hardened verificados, transporte externo explícito para guest, fail-closed quando o runner não prova `providesVmIsolation=true` e guest agent Python embutível na imagem, runner/args/manifestos/imagem/engine/perfil/memória/vCPU no Flow Spec, Builder UI, perfis `.afcodesandbox.json`, codegen e trace `vm`/`microvm`, cobrindo Python, JavaScript, TypeScript e Bash/Shell pelo contrato `agent-flow-vm-runner.v1`; artefatos binários microVM prontos/oficiais e políticas de isolamento ainda mais fortes continuam pendentes para ambientes que exigirem sandbox próprio mais forte;
   - logs estruturados por nó customizado já possuem implementação inicial no Studio com busca, filtro por modo/status/sandbox, exportação JSON, painel por nó `Falhas de sandbox` com causa provável, boundary, transporte, tentativas, payload e ação direta para filtrar logs, visão agregada por executor/nó com navegação direta para a falha e painel histórico de sandbox por flow com janela/filtro de falhas, containers, VMs, microVMs, isolamentos, hardening, isolamento VM verificado, orquestração, executor, transporte, assurance, imagem/engine/rede/perfil/política, último erro e export governado `.afsandboxtelemetry.json` sem eventos brutos/secrets.
7. multiagente operacional:
   - `agent_id` em runtime de teste e final já foi implementado em `/metadata`, sessão e eventos;
   - filtros por agente em runs locais do Studio já foram implementados;
   - resumo por agente e filtro por agente na timeline já foram implementados;
   - editor visual inicial de `runtime.manifest.json` já foi implementado na aba `Runtime`;
   - composição assistida multiagente já foi implementada na aba `Runtime`, com recomendações de flows/agentes, templates iniciais de papéis e checklist visual de prontidão;
   - orquestração declarativa já foi implementada na aba `Runtime`, com modo, agente de entrada, handoffs editáveis, sugestão automática e export em `.runtime-manifest/orchestration.json`/`bundle.json#orchestration`;
   - primeira execução de orquestração no bundle raiz já foi implementada em `POST /orchestration/run`, criando sessões nos agentes montados e executando `start`/`turn` conforme entrada e handoffs;
   - roteamento condicional simples e memória compartilhada governada já foram implementados em `POST /orchestration/run`, com `input contains:`/`output contains:`, decisões de handoff, previews compactos em `shared_memory` e política visual `orchestration.memoryPolicy` para persistência, retenção, redaction e limites;
   - roteamento por caminhos estruturados e persistência governada já foram implementados em `POST /orchestration/run`, com condições como `output.assistant_message.code == ECHO`, resolução de `input.*`/`output.*`/`memory.*` e JSONL opcional por `memory_path`/`persist_memory`/`ORCHESTRATION_MEMORY_PATH`;
   - primeira camada de depuração step-by-step da orquestração já foi implementada em `POST /orchestration/run`, com `debug_trace` no formato `agent-flow-builder.runtime-orchestration-debug-trace.v1`, eventos de plano, etapa, decisão de handoff, enfileiramento, falha sanitizada, resumo governado e persistência opcional junto do JSONL de memória;
   - primeira UI compacta para essa depuração já foi implementada no painel Docker/bundle como `Debug orquestração`, chamando diretamente o runtime final, usando a chave local de runtime quando configurada e exibindo status, erro sanitizado e timeline de `debug_trace`;
   - histórico local de `Debug orquestração` já foi implementado por artefato, com carregamento do último trace, filtros por tipo/status/agente, comparação com execução anterior e export `.aforchdebug.json` governado;
   - histórico compartilhável de `Debug orquestração` já foi implementado por flow em `.agent-flow/orchestration-debug/history.aforchdebug.json`, com rotas `GET`/`PUT`/`merge`, merge por `debug_trace.run_id`, redaction recursiva de chaves sensíveis, sanitização de URL de runtime, ações visuais `Carregar compartilhado`/`Sincronizar compartilhado` e sync central opcional por `AGENT_FLOW_ORCHESTRATION_DEBUG_HISTORY_CENTRAL_URL`/`AGENT_FLOW_ORCHESTRATION_DEBUG_HISTORY_CENTRAL_TOKEN`, enviando token somente no header e retornando status sem URL/token;
   - diff governado entre execuções de `Debug orquestração` já foi implementado por `POST /flows/:flowId/orchestration-debug-history/diff`, com pacote `agent-flow-builder.orchestration-debug-history-diff.v1`, export `.aforchdiff.json`, comparação por `debug_trace.run_id`, deltas de status/etapas/eventos/handoffs, seções agregadas por tipo de evento/agente/handoff/erro e governança sem payload bruto de runtime ou secrets;
   - mapa inicial de bundle multiagente já foi implementado na aba `Runtime`;
   - cards operacionais por agente no painel Docker/bundle já foram implementados com rota, metadata, endpoint de sessões e seleção para smoke;
   - smoke agregado por todos os agentes do bundle já foi implementado no painel Docker/bundle;
   - runbook JSON por agente e atalho de histórico filtrado por agente já foram implementados no painel Docker/bundle, com URLs reais, comandos manuais, checklist e evidência de smoke sem `.env`/secrets;
   - bundle aprovado por manifesto já foi implementado via `/runtime-manifest/generate-approved`, com bloqueio sem aprovação, aprovação agregada na raiz, aprovação por agente e auditoria do ZIP pronta;
   - contrato de storage compartilhado e teste com `AGENT_FLOW_TEST_POSTGRES_URL` já foram implementados no bundle gerado;
   - `npm run test:multiagent-postgres` já valida dois agentes escrevendo no mesmo PostgreSQL real em Docker;
   - `npm run test:portable-runtime-bundle` já valida o bundle multiagente como pacote removível fora do workspace do Studio, com Compose `api`/`worker`, `app/worker.py` raiz e pytest executado a partir do pacote copiado;
   - a primeira camada compartilhável/centralizável de cenários, datasets e evaluators do Studio já existe em `.agent-flow/studio-scenarios/scenarios.afscenarios.json`, com rotas por flow, redaction de chaves sensíveis, token central somente no header, ações visuais junto da biblioteca de datasets, detecção de conflitos por hash de conteúdo, diff compacto sanitizado por campo divergente, painel `Conflitos de cenários compartilhados`, thread local `Assumir`/`Liberar`, lease de curadoria configurável por `AGENT_FLOW_STUDIO_SCENARIO_CONFLICT_CURATION_LEASE_HOURS`, liberação automática de conflito com lease vencido, curador visual com papel `owner`/`reviewer`/`viewer`, bloqueio de `viewer` para mutação e resolução escolhendo candidato mantido com histórico governado de refs mantida/descartadas;
   - falta aprofundar isolamento e orquestração executável rica por agente em bundles complexos, principalmente colaboração distribuída mais profunda em cenários multiusuário avançados.

- atualização: os conflitos compartilhados de cenários/datasets/evaluators agora bloqueiam `viewer` também no backend, não só na UI, e preservam o papel do curador nos eventos e no histórico de resolução.
- atualização: conflitos da biblioteca compartilhada do catálogo agora seguem a mesma regra: `viewer` continua como papel de inspeção, enquanto curadoria/resolução exigem `reviewer`/`owner` e gravam `role`/`resolvedRole` para auditoria.

## Regra de decisão para novos comportamentos

Sempre que uma necessidade não couber no no visual nativo:

- usar `code` quando for lógica local/transformação/integração simples;
- usar HTTP/MCP/sidecar para ambiente externo ou linguagem não nativa;
- validar no Studio (input/output/erros/execução);
- incluir no hash de aprovação;
- não exigir edição manual do runtime final para manter a capacidade.
