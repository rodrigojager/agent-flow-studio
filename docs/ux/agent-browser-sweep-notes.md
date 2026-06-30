# Varredura Navegada: LangSmith Studio e n8n

Data: 2026-06-30.

Ferramenta usada: skill local `agent-browser` via CLI `agent-browser 0.27.0`.

Objetivo: complementar a pesquisa documental com uma leitura navegada das superficies publicas, usando snapshots de arvore acessivel e screenshots. Esta varredura nao acessou codigo-fonte, assets internos, sessoes autenticadas nem dados privados.

## Evidencias Salvas

- `docs/ux/_sweep-langsmith-studio.png`
- `docs/ux/_sweep-n8n-work-with-nodes.png`
- `docs/ux/_sweep-n8n-pin-mock-data.png`

## LangSmith Studio

URLs navegadas:

- `https://docs.langchain.com/langsmith/studio`
- `https://docs.langchain.com/langsmith/use-studio`
- `https://docs.langchain.com/langsmith/local-dev-testing`
- `https://docs.langchain.com/langsmith/observability-studio`
- `https://smith.langchain.com/`

### Observacoes do Snapshot

A pagina publica de Studio expõe as secoes:

- `Features`;
- `Graph mode`;
- `Chat mode`;
- `Deploy from Studio`;
- `Video guide`.

A pagina `How to use Studio` expõe:

- tabs `Graph` e `Chat`;
- especificacao de input;
- run settings;
- assistant;
- streaming;
- breakpoints;
- submit run;
- runs;
- threads;
- gerenciamento de assistants;
- gerenciamento e edicao de threads;
- edicao de historico de thread.

A pagina de observabilidade expõe:

- iterate on prompts;
- direct node editing;
- graph configuration;
- editing prompts in the UI;
- playground;
- experiments over datasets;
- debug traces;
- open deployed threads;
- testing local agents with remote traces;
- clone thread;
- add node to dataset.

A pagina de desenvolvimento local compara:

- `langgraph dev`;
- `langgraph up`;
- uso para desenvolvimento, validacao e deploy;
- diferenca entre in-memory/local directory e PostgreSQL;
- hot reload;
- portas padrao;
- Docker/Postgres/Redis para validacao mais proxima de producao;
- troubleshooting de Docker e portas.

O app real `https://smith.langchain.com/` sem autenticacao mostrou apenas a tela publica de entrada/login/signup. Portanto, nao foi feita varredura autenticada da UI privada.

### Decisoes Para Nossa UI

- Manter modos equivalentes a `Graph` e `Chat`, mas com nomes alinhados ao produto: `Grafo` e `Conversa`.
- Tratar `Sessao/Thread`, `Run`, `Assistant/Agente`, `Checkpoint`, `Breakpoint` e `Replay/Fork` como entidades visuais de primeira classe.
- Colocar streaming, breakpoints e time travel como recursos avancados, visiveis mas sem poluir o fluxo basico.
- O modo local deve espelhar o ciclo `langgraph dev` para iteracao e o ciclo Docker para validacao final.
- Nosso diferencial deve ficar sempre visivel: aprovacao por hash e container API embarcavel.

## n8n

URLs navegadas:

- `https://docs.n8n.io/build/understand-workflows/workflow-components/work-with-nodes`
- `https://docs.n8n.io/build/understand-workflows/understand-executions`
- `https://docs.n8n.io/build/work-with-data/pin-and-mock-data`
- `https://docs.n8n.io/build/understand-workflows/understand-executions/understand-dirty-nodes`
- `https://docs.n8n.io/build/understand-workflows/workflow-components/canvas-groups`

### Observacoes do Snapshot

A pagina `Work with nodes` expõe:

- adicionar node em workflow vazio;
- adicionar node em workflow existente;
- trigger nodes;
- node controls;
- execute step;
- deactivate node;
- delete node;
- context menu;
- node settings.

A pagina de executions expõe:

- execution modes;
- execution lists;
- workflow-level executions;
- all executions;
- custom execution data;
- execution data redaction;
- debug executions;
- stream real-time responses.

A pagina de pin/mock expõe:

- data mocking approaches;
- pin data;
- unpin data;
- edit pinned data;
- edit output data;
- use data from previous executions;
- combine mocking with pinning.

A pagina de dirty nodes expõe:

- como reconhecer dados dirty;
- por que nodes ficam dirty;
- como resolver dirty nodes;
- relacao com partial execution.

A pagina de canvas groups expõe:

- criar grupo;
- nomear grupo;
- colapsar/expandir;
- desagrupar;
- atalhos `Ctrl/Cmd + G` e `Ctrl/Cmd + Shift + G`.

### Decisoes Para Nossa UI

- Reproduzir o principio de node controls sempre perto do node: executar, desativar, apagar e menu contextual.
- Expor execucao parcial e execucao completa como opcoes claras no Studio Local.
- Implementar `stale/dirty` como estado visual obrigatorio quando prompt, schema, edge, node, pinning ou dados de teste mudarem.
- Adotar pinning/mocking como recurso de desenvolvimento local para repetir cenarios.
- Incluir grupos colapsaveis no canvas para organizar subfluxos e multiagente.
- Separar execution lists/runs por flow, por sessao e futuramente por agente.

## Limites da Varredura

- Nao houve login em LangSmith Cloud.
- Nao houve login em n8n Cloud.
- Nao foi lido codigo-fonte das aplicacoes.
- A varredura usou documentacao publica, snapshots acessiveis e screenshots.
- Os resultados devem orientar comportamento e arquitetura de UX, nao copia visual literal.

