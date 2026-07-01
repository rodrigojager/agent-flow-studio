# Plano Mestre: Agent Flow Builder, Studio Local e API Docker

Data: 2026-06-30.

Este e o plano consolidado do produto a partir do que ja foi implementado, das decisoes de arquitetura, da pesquisa de LangSmith/n8n/Fleet, dos screenshots logados e das decisoes de UI/UX registradas em `docs/ux/`.

## Objetivo Final

Construir uma ferramenta local completa para criar, testar, depurar, aprovar e empacotar agentes de IA como APIs Docker independentes.

Fluxo principal:

```text
Desenhar -> Testar -> Depurar -> Aprovar -> Gerar API Docker
```

O usuario deve conseguir trabalhar em uma unica interface, sem precisar aprender LangGraph manualmente, abrir terminal, usar LangSmith Cloud ou alternar entre ferramentas para completar o caminho principal.

## Norte do Produto

O Agent Flow Builder nao e um clone de LangSmith, n8n ou Fleet. Ele deve se inspirar profundamente nos padroes que funcionam nesses produtos, mas resolver um objetivo proprio:

- criar agente visualmente;
- gerar codigo executavel;
- testar em sandbox local;
- observar runs, state, node IO, transcript, events e logs;
- aprovar uma versao por hash;
- gerar runtime FastAPI/Docker removivel da ferramenta;
- rodar a API final de forma independente.

## Base Ja Implementada

Ja existe uma base funcional importante:

- Flow Spec em TypeScript/Zod.
- Flow de referencia em `flows/reference-interview/agent.flow.json`.
- Baseline manual FastAPI/LangGraph.
- Codegen TypeScript para runtime Python/FastAPI.
- Codegen para sandbox LangGraph compatível.
- Codegen multiagente inicial por `runtime.manifest.json`.
- Editor visual inicial de `runtime.manifest.json` na aba `Runtime`, com metadata, LLM padrão, empacotamento, agentes e prefixos de rota.
- Mapa operacional inicial de bundle multiagente na aba `Runtime`, com app raiz, rotas montadas, runtime por agente e endpoints resolvidos pela validação.
- Identidade operacional inicial por agente com `agent_id` em `/metadata`, sessão, eventos, runs locais, resumo por agente e timeline filtrável no Studio.
- Builder API para flows, assets, validacao, artefatos, import/export, manifest e geracao.
- Builder UI inicial com React Flow, canvas, inspector, arquivos, validacao, artefatos e runtime.
- Suporte visual e runtime inicial para nodes avancados:
  - `http_request`;
  - `transform_json`;
  - `database_query`;
  - `database_save`;
  - `file_extract`;
  - `rag_retrieval`;
  - `approval_gate`;
  - `scoring`;
  - `analytics`.
- Sandbox local inicial com start/stop, logs e chamadas de sessao/turn/transcript/events.
- Artefato LangGraph separado com `langgraph.json`.
- Hash deterministico de projeto em `.agent-flow/generated-meta.json`.
- Aprovacao de sandbox e bloqueio de runtime aprovado se o hash mudou.
- Container final validado com Docker Compose, Postgres, Redis, `/health`, `/docs`, transcript e events.
- Builder API/UI ja possuem primeira camada operacional para o runtime Docker final aprovado: status, preparo de `.env`, build, compose up/down, smoke HTTP, inspeção `docker compose ps/logs`, Runtime URL local configuravel, histórico operacional local, auto-refresh opt-in, logs recentes e links para `/docs` e `/openapi.json` no painel de artefato.
- Documentacao UX consolidada em `docs/ux/`.

## Decisoes Que Devem Guiar Tudo

### Local-first

O fluxo principal deve funcionar sem LangSmith Cloud, sem `LANGSMITH_API_KEY` obrigatoria e sem billing externo.

LangGraph/LangSmith continuam como compatibilidade opcional:

- gerar pacote compatível;
- permitir `langgraph dev`;
- permitir Studio oficial se o usuario quiser.

Mas o fluxo principal e nosso Studio Local.

### Runtime Final Independente

O produto final nao e o builder. O produto final e uma API FastAPI/Docker independente, com contrato HTTP claro.

O runtime final deve:

- rodar separado do Builder;
- incluir OpenAPI/Swagger;
- manter estado entre turnos;
- preservar transcript e events;
- carregar apenas adapters/configs necessarios;
- conter comprovante de aprovacao quando gerado por versao aprovada.

### UI Operacional

A interface deve ser uma ferramenta operacional, nao uma landing page e nao uma plataforma cloud generica.

Regras:

- shell persistente;
- top bar compacta;
- sidebar/rail com grupos claros;
- canvas como superficie principal;
- paineis contextuais;
- split panes para trabalho tecnico;
- empty states com proxima acao;
- tooltips em botoes icon-only;
- validacao inline;
- tema claro e escuro em todas as telas.

### WYSIWYG Primeiro, JSON Como Escape Hatch

Configuracoes comuns precisam ter caminho visual:

- prompts;
- schemas;
- tools;
- LLM/provider/modelo;
- env vars;
- files/RAG;
- integracoes;
- approval;
- runtime.

JSON/YAML/source continuam disponiveis para usuarios avancados, mas nao substituem a experiencia visual.

### Sem Teto Visual De Capacidade

A edicao visual nao pode virar uma prisao. Ela deve acelerar o caso comum, mas nunca reduzir o que o usuario ja consegue criar manualmente fora da ferramenta.

O runtime atual decidido no projeto e Python/FastAPI/LangGraph, enquanto builder, validacao e codegen ficam em TypeScript. Essa e uma decisao de implementacao atual, nao uma restricao permanente de produto.

Regra de produto:

- todo comportamento importante precisa ser representavel por no visual, codigo customizado, tool externo, sidecar ou runtime futuro;
- se uma regra nao couber em um no visual, deve existir um escape hatch claro;
- o escape hatch deve ter input/output tipado, logs, trace, teste local e entrar no hash de aprovacao;
- o usuario nao deve precisar editar manualmente o runtime gerado depois da exportacao para recuperar capacidade;
- codigo Python, JavaScript e TypeScript podem ser caminhos nativos do runtime atual;
- codigo em outra linguagem deve ser suportavel por HTTP, sidecar, MCP ou adapter de runtime.

O no `code` deve funcionar como comportamento customizado com contrato explicito. O contrato inicial ja foi incorporado ao Flow Spec, Builder UI e Codegen LangGraph: linguagem, modo de execucao, arquivo, entry point, dependencias, input path, result path, codigo inline, executor HTTP, MCP stdio e sidecar local. O runtime gerado ja executa Python nativo por arquivo/inline e JavaScript/TypeScript por arquivo/inline via runner Node, executa `codeExecution: "http"` como adapter externo por contrato JSON, executa `codeExecution: "mcp"` como chamada `tools/call` a servidor MCP local via stdio, executa `codeExecution: "sidecar"` como subprocesso local com JSON por stdin/stdout, copia assets de `codePath` para `app/code/`, inclui esses arquivos no hash de aprovacao, instala Node/NPM no Dockerfile final, materializa dependencias npm quando aplicavel e registra `custom_code_executed`, `custom_code_declared` ou `custom_code_failed` com `execution_log` e `span` estruturados para o Studio Local. A etapa pendente e expandir esse contrato para runtime adapters dedicados, com isolamento dedicado por no quando necessario.

### Observabilidade Estruturada

Logs nao bastam. Toda run local precisa gerar evidencia estruturada:

- node executado;
- input;
- output;
- eventos;
- transcript;
- state snapshot/diff;
- erro;
- duracao;
- prompt renderizado;
- resposta bruta de LLM;
- tokens/custo quando disponivel.

### Aprovacao Por Hash

Runtime Docker final so pode ser gerado a partir de uma versao aprovada.

O hash cobre:

- `agent.flow.json`;
- prompts;
- schemas;
- arquivos em `files/` usados pelo agente;
- manifest multiagente quando aplicavel;
- configuracoes de runtime que alteram comportamento.

Secrets reais nao entram no hash publico nem devem ser exportados sem acao explicita.

### Paridade ProUp Como Anti-Regressao

A API ProUp informada no inicio do desenvolvimento e o benchmark minimo de capacidade. A ferramenta deve conseguir recriar agentes/APIs desse nivel, mesmo que a implementacao interna seja diferente.

Capacidades que precisam continuar reproduziveis:

- API conversacional baseada em sessoes;
- criar, iniciar, processar turno, finalizar, consultar transcript e consultar events;
- agente capaz de conduzir perguntas;
- agente capaz de consultar conteudo/contexto;
- agente capaz de gerar perguntas a partir de conteudo;
- prompts versionaveis em arquivos;
- LLM por adapter;
- mock de LLM;
- estado por conversa;
- idempotencia por mensagem;
- Postgres/SQLAlchemy ou persistencia equivalente;
- Redis opcional ou cache equivalente;
- safety;
- analises pos-finalizacao;
- testes automatizados;
- empacotamento como API independente.

Cada capacidade acima precisa mapear para um destes mecanismos:

- no visual nativo;
- comportamento customizado por codigo;
- HTTP/MCP/tool adapter;
- recurso de runtime;
- configuracao de manifesto;
- teste gerado.

Se uma capacidade ProUp nao tiver mapeamento claro, a fase correspondente nao pode ser considerada pronta.

## Superficies Do Produto

### 1. Shell Principal

Navegacao alvo:

```text
Flow | Studio Local | Artefatos | Runtime | Settings
```

Tambem podem existir entradas laterais para:

- Arquivos;
- Validacao;
- Runs;
- Cenarios;
- Catalogo local;
- Providers/Secrets.

Obrigatorio:

- manter flow/agente atual em contexto;
- mostrar estado salvo/sujo/valido/invalido/aprovado/desatualizado;
- preservar tema e layout localmente;
- impedir acoes bloqueadas sem explicar motivo.

### 2. Flow Builder WYSIWYG

Objetivo:

- criar e editar o `agent.flow.json` visualmente.

Deve incluir:

- canvas React Flow refinado;
- palette pesquisavel por objetivo;
- inspector por tipo de node;
- edicao visual de prompts;
- edicao visual de schemas;
- edicao visual de tools;
- no de comportamento customizado para regras que nao cabem em componentes visuais;
- conexoes/condicoes;
- grupos e notas;
- diagnosticos clicaveis;
- estados `dirty`, `stale`, `invalid`, `ready`.

Inspiracao aplicada:

- n8n para canvas, node controls, dirty nodes, execucao parcial e input/output.
- Fleet para blocos compactos de agente e acoes locais.

### 3. Agent Overview

Objetivo:

- mostrar o agente em alto nivel para usuarios entenderem o que falta configurar.

Blocos sugeridos:

- Entrada;
- Canais;
- Agente;
- Instrucoes;
- Ferramentas;
- Subagentes;
- Skills;
- Saida/API.

Importante:

- esta visao nao substitui o grafo executavel;
- ela e camada de orientacao e completude;
- cada bloco vazio precisa ter CTA ou motivo de bloqueio.

### 4. Arquivos

Objetivo:

- expor arquivos do workspace sem obrigar o usuario a editar JSON.

Deve incluir:

- prompts Markdown;
- schemas JSON;
- `agent.flow.json`;
- `runtime.manifest.json`;
- arquivos em `files/`;
- artefatos gerados;
- preview/source;
- validacao por arquivo.

### 5. Studio Local

Objetivo:

- testar, depurar e aprovar o agente localmente.

Layout alvo:

```text
Sessões/Runs | Grafo de Execução | Inspector
             | Timeline/Logs    |
```

Deve incluir:

- iniciar/parar sandbox local;
- criar sessao/thread;
- start/turn/finish;
- playground de payload/mensagem;
- transcript;
- events;
- grafo com status por node;
- timeline/waterfall;
- node IO;
- state inspector;
- logs correlacionados;
- replay basico;
- comparacao entre runs;
- aprovacao por hash.

Inspiracao aplicada:

- LangSmith Studio para graph/thread/run, input/output, tracing e debug.
- LangSmith trace viewer para waterfall, custo, tokens e inspector.
- n8n para pin/mock data e dirty/stale downstream.

### 6. Playground Integrado

Objetivo:

- iterar prompts, inputs, schemas e tools dentro do contexto do flow.

Deve incluir:

- prompt por blocos de role;
- variaveis detectadas;
- input form por schema;
- editor JSON como modo avancado;
- modelo/provider;
- output renderizado/raw;
- output schema;
- tool manager;
- secrets locais mascarados;
- Start/Turn/Finish;
- cenario salvo;
- pin/mock de dados.

Decisao:

- nao criar prompt marketplace publico no MVP;
- nao copiar o modelo de prompt commits publicos;
- manter versionamento local por hash/assets.

### 7. Artefatos

Objetivo:

- separar claramente pacote de sandbox, runtime final e arquivos gerados.

Deve incluir:

- pacote LangGraph opcional;
- runtime FastAPI gerado;
- diff contra ultima geracao;
- hashes;
- `.agent-flow/generated-meta.json`;
- aprovacao atual;
- README;
- download/export ZIP rotulado.

Regra:

- nunca misturar "sandbox LangGraph" e "API Docker final" sem rotulo claro.

### 8. Runtime

Objetivo:

- controlar o container final a partir da UI.

Deve incluir:

- validar aprovacao;
- gerar API Docker;
- build;
- up/down;
- healthcheck;
- logs;
- smoke test;
- link `/docs`;
- link `/openapi.json`;
- portas;
- env vars;
- status de Postgres/Redis quando aplicavel.

Regra:

- `Runtime` substitui o conceito de `Deployments` cloud no nosso produto.

### 9. Settings, Providers e Secrets

Objetivo:

- controlar configuracoes sensiveis e reutilizaveis.

Deve incluir:

- provider/modelo;
- modo mock/local/API;
- env vars requeridas;
- secrets mascarados;
- escopo local do usuario vs workspace/runtime;
- catalogo local de tools/skills/templates;
- import/export.

## Matriz De Inputs E Elementos De IA

Cada input deve usar o elemento certo:

- instrucao de sistema -> prompt blocks / agent config;
- mensagem natural -> session turn / LLM node;
- payload estruturado -> form por schema / API contract;
- output estruturado -> output schema / parser;
- arquivo -> file extract / RAG;
- base documental -> RAG retrieval;
- URL/API -> HTTP node ou MCP tool;
- tool/function -> schema de argumentos tipado;
- secret -> masked input / env var;
- provider/modelo -> LLM adapter;
- estado -> LangGraph state/checkpointer;
- memoria longa -> memory store com aprovacao;
- evento/log/trace -> local trace store;
- regra de negocio customizada -> code node, HTTP tool, MCP tool, sidecar ou adapter futuro;
- codigo existente em outra linguagem -> HTTP, MCP stdio, sidecar local ou runtime adapter, nao reescrita obrigatoria;
- cenario de teste -> fixture local;
- dataset/evaluator -> avaliacao posterior;
- human approval -> approval gate;
- schedule/channel -> trigger/worker futuro;
- subagente -> manifest multiagente;
- runtime -> codegen/Docker.

Regra:

- se um controle nao deixa claro qual input captura, qual runtime consome, se entra no hash e se aparece no trace, ele nao deve ser implementado ainda.

## Arquitetura Alvo

### Frontend

- React/Vite.
- React Flow para canvas.
- Shell compartilhado.
- Design system por tokens.
- Persistencia local de tema/layout.
- Componentes reutilizaveis para:
  - top bar;
  - sidebar;
  - split pane;
  - inspector;
  - drawer;
  - modal;
  - popover;
  - JSON viewer;
  - logs viewer;
  - trace tree;
  - prompt block editor;
  - schema editor;
  - tool editor.

### Builder API

Responsabilidades:

- CRUD de flows;
- CRUD de prompts/schemas/files;
- validacao;
- codegen;
- import/export;
- artefatos;
- sandbox local;
- traces locais;
- node IO;
- state snapshots;
- approvals;
- Docker build/up/down/smoke.

### Storage Local

Comecar com SQLite local para Studio:

- `studio_threads`;
- `studio_runs`;
- `studio_events`;
- `studio_node_io`;
- `studio_state_snapshots`;
- `studio_logs`;
- `studio_approvals`;
- `studio_scenarios`;
- `studio_pins`.

Postgres real fica para runtime gerado e testes de runtime/multiagente.

### Runtime/Sandbox

Caminho recomendado:

- manter artefato LangGraph compatível;
- instrumentar o runtime gerado para traces locais;
- Builder API controla sandbox e coleta eventos;
- opcionalmente permitir conectar a Agent Server externo.

### Runtime Final

- FastAPI;
- LangGraph;
- SQLAlchemy/Postgres;
- Redis opcional;
- API key inicial;
- transcript/events;
- idempotencia;
- Dockerfile/compose;
- OpenAPI;
- smoke test.

## Fases De Implementacao

### Fase 0: Consolidacao De Plano E Guardrails

Status: documentada.

Entregaveis:

- plano mestre;
- decisoes de produto/UX;
- regras visuais/comportamentais;
- matriz input -> elemento IA;
- checklist anti-regressao.

Aceite:

- futuras tarefas conseguem apontar para estes documentos como fonte de verdade.

### Fase 1: Design System E Tema Claro/Escuro

Objetivo:

- criar base visual comum para tudo.

Entregaveis:

- tokens CSS;
- tema claro;
- tema escuro;
- toggle persistente;
- componentes base;
- revisao de Builder UI atual para usar tokens;
- estados visuais comuns.

Aceite:

- Builder atual funciona em tema claro e escuro;
- canvas, inspector, arquivos, artefatos e runtime nao quebram visualmente;
- botoes icon-only tem tooltip;
- disabled explica motivo.

### Fase 2: Shell Unificado

Objetivo:

- reorganizar a aplicacao como ferramenta continua.

Entregaveis:

- top bar compacta;
- sidebar/rail;
- workspace panel;
- navegacao `Flow`, `Studio Local`, `Artefatos`, `Runtime`, `Settings`;
- badges globais de estado;
- empty states com CTA;
- layout persistente.

Aceite:

- o flow selecionado permanece em contexto;
- usuario entende o proximo passo em qualquer tela vazia;
- nenhuma etapa principal exige terminal.

### Fase 3: Builder WYSIWYG Refinado

Objetivo:

- tornar criacao/edicao de agente intuitiva.

Entregaveis:

- palette pesquisavel;
- node controls;
- inspector por tipo;
- edicao visual de LLM/provider/env vars;
- edicao visual de prompts por blocos;
- editor visual de schemas;
- editor visual de tools;
- grupos/notas;
- diagnostics clicaveis;
- dirty/stale states.

Aceite:

- usuario consegue criar/ajustar o flow de referencia pela UI;
- JSON bruto nao e necessario para configuracao comum;
- mudancas em prompts/schemas/files invalidam estado testado/aprovado quando aplicavel.

### Fase 4: Agent Overview

Objetivo:

- adicionar visao de alto nivel para completude do agente.

Entregaveis:

- blocos Entrada/Canais/Agente/Instrucoes/Ferramentas/Subagentes/Skills/Saida;
- conexoes suaves;
- CTAs por bloco;
- status de completude;
- links para Flow detalhado.

Aceite:

- usuario novo entende o que falta configurar sem ler docs;
- overview nao cria segunda fonte de verdade.

### Fase 5: Sandbox E Studio Local MVP

Objetivo:

- testar agente localmente sem terminal.

Entregaveis:

- start/stop sandbox;
- porta automatica/configuravel;
- healthcheck;
- logs;
- criar sessao/thread;
- start/turn/finish;
- transcript;
- events;
- playground basico;
- grafo com status por node.

Aceite:

- usuario executa cenario completo pela UI;
- erros de sandbox mostram causa e proxima acao;
- run basica gera evidencia consultavel.

### Fase 6: Trace Local Estruturado

Objetivo:

- dar ao Studio Local poder real de debug.

Entregaveis:

- `studio_runs`;
- timeline/waterfall;
- node IO;
- prompt renderizado;
- resposta bruta;
- state snapshots/diff;
- logs correlacionados;
- filtros;
- export JSON;
- replay basico.

Aceite:

- usuario consegue responder qual node rodou, com que input, que output gerou, que estado mudou e onde falhou.

Status 2026-06-30:

- implementada primeira persistencia de `studio_runs` em arquivos locais por flow, com sessão, transcript, events, logs e métricas;
- Builder API expoe lista, carga e gravação de runs locais por flow;
- Builder API deriva snapshots de state por evento e diffs incrementais para cada run salvo;
- Builder UI salva snapshots após execução e permite recarregar run para replay básico de timeline, Node IO, transcript, state inspector e diff do evento selecionado;
- já implementado: comparação por run com métricas e diffs semânticos por nó;
- já implementado: cadeia causal por nó (upstream/impact path), destaque no grafo/linha do tempo e status causal no painel de studio;
- ainda pendentes: refinamento de UX para cenários reprodutíveis e caminhos de depuração multi-camadas.

### Fase 7: Playground Avancado, Pinning E Cenarios

Objetivo:

- tornar iteracao repetivel e produtiva.

Entregaveis:

- cenarios salvos;
- pin/mock data;
- restore de checkpoint por checkpointer/snapshot;
- output render/raw;
- input form por schema;
- secrets locais mascarados;
- comparacao entre runs;
- relatorio exportavel e aprovacao local de lote;
- idempotency key visivel.

Aceite:

- usuario reproduz falha com dados fixos;
- usuario reexecuta cenário forkado continuando do turno/estado restaurado;
- usuario exporta um lote aprovado como evidencia JSON com hash;
- pin/mock local nao contamina runtime final sem decisao explicita.

### Fase 8: Aprovacao Integrada Ao Studio

Objetivo:

- tornar promocao para runtime final clara e auditavel.

Entregaveis:

- painel de aprovacao;
- hash atual;
- assets cobertos;
- run usada como evidencia;
- status aprovado/desatualizado/nao aprovado;
- bloqueios visuais;
- gravacao de `.agent-flow/langgraph-sandbox-approval.json`.

Aceite:

- API Docker so pode ser gerada quando hash atual estiver aprovado;
- se qualquer asset coberto mudar, aprovacao fica desatualizada.

### Fase 9: Runtime Docker Pela UI

Objetivo:

- sair do Studio direto para API validada.

Entregaveis:

- gerar runtime aprovado;
- build Docker;
- compose up/down;
- healthcheck;
- logs;
- smoke test;
- links `/docs` e `/openapi.json`;
- edicao visual de portas API/Postgres/Redis no `docker-compose.yml`;
- export ZIP do runtime.

Aceite:

- container final sobe e responde sem Builder;
- smoke cria sessao, roda start/turn, le transcript/events;
- erro de build/runtime aparece com acao clara.

Status 2026-06-30:

- implementada a primeira camada de API/UI para status, preparo de `.env`, build, up, down, smoke, logs e links do runtime Docker final aprovado;
- implementada inspeção explícita por `docker compose ps --format json` e `docker compose logs --tail 120 --no-color`, exibindo serviços e logs no painel de artefato;
- implementado campo de Runtime URL local para status/smoke em portas customizadas;
- implementada edicao visual de portas API/Postgres/Redis no `docker-compose.yml`, com status retornando as portas atuais e historico da operacao;
- implementado histórico operacional local em `.agent-flow/docker-runtime-history/` e listagem no painel de artefato;
- implementado reconhecimento do bundle multiagente como artefato Docker operacional, com lista de agentes e smoke test direcionado por `agentId` na rota montada do agente;
- implementado auto-refresh opt-in para inspeção/status/logs enquanto o usuário está no painel de artefato;
- verificado por teste automatizado com runner Docker falso, build da UI e `app.inject` no runtime gerado real;
- implementado painel de progresso por etapa no build Docker (`docker compose build`) com persistência em histórico operacional;
- implementado filtro por nível/severidade no histórico operacional (`error`, `warning`, `info`, `success`);
- implementados alertas operacionais persistentes para leitura de regressões em build/up/smoke.

### Fase 10: Catalogo Local, Skills E Tools Reutilizaveis

Objetivo:

- melhorar reutilizacao sem criar marketplace cloud.

Entregaveis:

- catalogo local inicial de prompts, schemas, tools, templates de agente e skills reutilizaveis;
- registry local em `.agent-flow/catalog/registry.json`;
- busca e filtros locais por tipo/origem/tag;
- versionamento local basico por versão, revisão e hash de conteúdo;
- histórico local de revisões com diff visual compacto;
- restauração de revisão antiga como nova revisão local;
- comparação selecionável de revisões históricas contra a revisão atual;
- seeds locais para prompts, schemas, tools comuns, templates de agente e skills;
- salvar prompt/schema atual no registry local;
- salvar nó atual como tool/skill local reutilizável;
- salvar subgrafos selecionados como tool/skill composta reutilizável;
- reutilizar prompt/schema/tool/skill em flows sem copiar arquivos manualmente;
- criar novo flow a partir de template de agente;
- evoluir catalogo para editor visual completo de tools/skills compostas;
- filtro shared quando existir compartilhamento real.

Aceite:

- usuario reutiliza assets sem copiar arquivos manualmente;
- nada e apresentado como publico se nao houver publicacao real.

Status 2026-06-30:

- implementada primeira camada do catalogo local na Builder API via `/catalog`, `/catalog/items`, `/catalog/agent-templates/create-flow` e `/flows/{flowId}/catalog/apply`;
- implementado registry de workspace em `.agent-flow/catalog/registry.json`, combinado com itens built-in locais;
- prompts e schemas aplicados pelo catalogo viram assets reais no flow e podem atualizar o no selecionado;
- tools aplicadas pelo catalogo criam ou atualizam no `code` com contrato visual/runtime existente, ou materializam bundles compostos de nós/arestas com IDs únicos e conexão automática de entrada/saída;
- templates de agente criam novos flows completos; os seeds atuais incluem conversa guiada e gerador de perguntas por conteúdo/RAG;
- skills aplicadas pelo catalogo materializam bundles de prompt/schema, podem transformar o no selecionado por patch seguro e agora também podem materializar subgrafos compostos com remapeamento de prompt/schema; os seeds atuais incluem geração estruturada de perguntas e revisão com contexto/RAG;
- implementada aba `Catalogo` na Builder UI com busca textual, filtros por tipo/origem/tag, refresh, cards de itens, salvar prompt/schema atual, salvar nó selecionado como tool/skill, criar flow por template e aplicar item/skill no flow/no selecionado;
- implementada primeira camada de tool composta: item `tool` pode usar `content` no formato `agent-flow-builder.tool-bundle.v1`, o seed `Bloco HTTP JSON validado` cria `transform_json -> code/http`, e a UI diferencia `Criar bloco` de `Criar nó`;
- implementada primeira camada de skill composta: item `skill` pode declarar `nodes`/`edges` no formato `agent-flow-builder.skill.v1`, o seed `Skill composta de revisão com contexto` cria `file_extract -> rag_retrieval -> llm_structured`, e a UI trata a skill como bloco anexável;
- implementada primeira camada de curadoria visual de blocos: seleção múltipla no canvas pode ser salva diretamente como tool composta ou skill composta, preservando posições relativas e arestas internas;
- implementada primeira camada de versionamento/curadoria: itens do catalogo carregam versão, revisão local incremental e hash curto de conteúdo, com metadados visíveis nos cards;
- implementado histórico local de revisões: ao sobrescrever item local, o snapshot anterior fica em `history` e o card mostra diff compacto contra a revisão atual;
- implementada restauração de revisão: snapshots antigos podem ser restaurados pela API/UI, criando nova revisão sem apagar o histórico;
- implementada comparação selecionável: a UI permite escolher qual revisão histórica será comparada com a atual antes de restaurar ou reutilizar o item;
- verificado por `npm run test:builder-api` e `npm run test:ui-theme`;
- pendente evoluir para editor visual completo de tools/skills compostas, curadoria visual completa e compartilhamento real.

### Fase 11: Multiagente Local

Objetivo:

- amadurecer bundles multiagente.

Entregaveis:

- modelo publico com `agent_id` ja iniciado em runtime baseline/gerado, bundle e runs locais;
- manifest editor visual inicial ja implementado para `runtime.manifest.json`;
- runs por agente ja possuem filtro inicial no Studio;
- trace por agente ja possui filtro inicial na timeline e resumo por agente no Studio;
- mapa de bundle multiagente ja implementado para app raiz, rotas, metadata, runtime por agente e endpoint de sessão;
- isolamento por rota/agente;
- Postgres compartilhado em teste real;
- validacao de bundle pela UI.

Aceite:

- bundle multiagente e testado, depurado e empacotado localmente com clareza.

### Fase 12: Recursos Avancados

Entram depois do core:

- Safety Harness completo;
- streaming SSE/WebSocket;
- jobs/worker pos-finalizacao;
- schedule/trigger real;
- canais SaaS;
- OAuth;
- evaluators/datasets locais;
- annotation queues;
- dashboards;
- auth avancada;
- integracao opcional com LangSmith Cloud.

Aceite:

- nenhum recurso avancado pode quebrar o fluxo principal local-first.

## Fora Do MVP

Nao implementar agora:

- deploy cloud gerenciado;
- billing/pricing/upgrade;
- prompt marketplace publico;
- sharing publico real;
- annotation queues completas;
- dashboards custom;
- OAuth completo de canais SaaS;
- multiusuario com credenciais por usuario;
- publicacao remota de agents/skills;
- experiment suite completa antes de trace local.

## Criterios Globais De Aceite

Uma etapa so esta pronta quando:

- funciona em tema claro e escuro;
- nao exige terminal no caminho principal;
- possui estado vazio, loading, sucesso e erro;
- mostra proxima acao;
- botoes icon-only tem tooltip;
- bloqueios explicam motivo;
- validacao aparece perto do campo;
- mudancas relevantes invalidam aprovacao;
- run gera evidencia local estruturada;
- artefato sandbox e runtime final sao distintos;
- runtime final roda separado do Builder;
- testes ou checklists manuais foram registrados.

## Checklist Anti-Regressao

Antes de declarar a ferramenta pronta para uma fase:

- O fluxo principal funciona sem LangSmith Cloud.
- O usuario consegue desenhar, testar, depurar, aprovar e gerar API Docker na mesma UI.
- Tema claro e escuro foram verificados.
- O flow atual permanece em contexto entre telas.
- Studio Local mostra grafo, run, node IO, state, transcript, events e logs.
- Logs nao substituem trace estruturado.
- Prompt/schema/tool possuem caminho visual.
- Secrets ficam mascarados.
- Alteracoes em assets cobertos invalidam aprovacao.
- Runtime aprovado so gera se hash atual bater.
- Docker final sobe sem Builder.
- Import/export identifica claramente o tipo de pacote.
- UI nao usa naming proprietario de produto terceiro.

## Ordem Recomendada De Execucao

1. Design system e temas.
2. Shell unificado.
3. Builder WYSIWYG refinado.
4. Agent Overview.
5. Studio Local MVP.
6. Trace local estruturado.
7. Playground avancado, pinning e cenarios.
8. Aprovacao integrada ao Studio.
9. Runtime Docker pela UI.
10. Catalogo local/tools reutilizaveis.
11. Multiagente local.
12. Recursos avancados.

Essa ordem protege o fluxo principal antes de adicionar areas amplas como evaluators, dashboards, annotation queues, canais SaaS ou deploy cloud opcional.

## Documentos De Referencia

- `docs/plan.md`
- `docs/implementation-status.md`
- `docs/local-studio-plan.md`
- `docs/proup-capability-parity.md`
- `docs/ux/source-research-langsmith-n8n.md`
- `docs/ux/agent-browser-sweep-notes.md`
- `docs/ux/logged-in-screenshot-raw-analysis.md`
- `docs/ux/local-studio-product-decisions.md`
- `docs/ux/visual-behavior-reference-rules.md`
- `docs/ux/input-ai-element-fit-matrix.md`
- `docs/ux/local-studio-interface-spec.md`
- `docs/ux/local-studio-interaction-model.md`
- `docs/ux/design-system.md`
- `docs/ux/ui-ux-implementation-roadmap.md`
