# Agent Flow Studio

Ferramenta local para desenhar, testar, depurar, aprovar e empacotar agentes de IA como APIs Docker independentes.

O objetivo do projeto é oferecer um fluxo completo, visual e local-first:

```text
Desenhar -> Testar -> Depurar -> Aprovar -> Gerar API Docker
```

O Studio não é um clone de LangSmith, LangGraph Studio ou n8n. Ele se inspira em padrões úteis desses produtos, mas tem um objetivo próprio: permitir que um agente seja criado visualmente, validado em sandbox local, aprovado por versão e exportado como uma API removível da ferramenta.

## O Que Ele Faz

O Agent Flow Studio permite criar agentes a partir de um flow versionável (`agent.flow.json`) e gerar runtimes executáveis com LangGraph + FastAPI.

Na prática, a ferramenta cobre três camadas:

- **Builder visual**: edição do grafo, nós, arestas, prompts, schemas, adapters LLM, arquivos e validações.
- **Studio local**: execução e depuração do agente com sessões, runs, timeline, transcript, events, state inspector, node IO, logs e contexto causal por nó.
- **Runtime final**: geração de uma API FastAPI/Docker independente, com Swagger/OpenAPI, persistência, cache opcional e smoke test local.

O fluxo principal foi desenhado para funcionar sem LangSmith Cloud, sem cobrança externa e sem depender de terminal no caminho de produto. Integrações com LangGraph/LangSmith continuam possíveis como compatibilidade opcional.

## Recursos Implementados

### Builder Visual

- Canvas com React Flow para editar agentes.
- Criação, listagem, leitura, salvamento e validação de flows.
- Edição visual de propriedades de nós, adapters LLM, modelos e variáveis de ambiente.
- Criação e edição de prompts Markdown e schemas JSON referenciados pelo flow.
- Importação e exportação de workspace de flow.
- Diagnósticos estruturados de validação com navegação para o ponto afetado.
- Preview do JSON do flow.
- Tema claro e escuro persistente por `localStorage`.
- Auditoria automatizada de tema/layout com Playwright para shell principal, abas do inspector, tema claro/escuro, viewports desktop/compacta, runs locais com dados, aprovação desatualizada, fluxo `LangGraph` -> `Aprovar` -> `API Docker` e estados Docker de build/running/stopped/erro em workspace isolado.
- Atalhos iniciais: `Ctrl/Cmd+S` para salvar workspace, `Ctrl/Cmd+Enter` para validar, `Esc` para limpar seleção, `A` para focar a paleta e `F` para reenquadrar o canvas.

### Tipos De Nó E Capacidades Do Flow

O contrato atual já suporta nós para:

- LLM.
- Entrada humana.
- Switch/condições.
- HTTP request.
- Transformação JSON.
- Consulta e gravação em banco.
- Extração de arquivo.
- RAG local.
- Approval gate.
- Scoring.
- Analytics.
- Código customizado.

O nó de código customizado aceita Python e JavaScript no runtime atual, por arquivo ou inline, com input/output tipado, logs de execução e inclusão no hash de aprovação. TypeScript e outras linguagens estão planejadas via adapter, sidecar, HTTP ou MCP.

### Codegen E Artefatos

- Flow Spec em TypeScript/Zod.
- Codegen para runtime Python/FastAPI/LangGraph.
- Codegen para pacote LangGraph compatível com `langgraph dev`.
- Codegen multiagente inicial via `runtime.manifest.json`.
- Geração de `.agent-flow/generated-meta.json` com hash determinístico do projeto.
- Separação clara entre pacote de sandbox LangGraph e runtime FastAPI/Docker final.
- Artefatos navegáveis pela UI e exportáveis em zip.

### Studio Local

- Start/stop de runtime local.
- Criação de sessão, start, turn, finish, transcript e events.
- Lista de runs locais persistidos por flow.
- Timeline de eventos.
- State inspector.
- Diferenças de estado por evento.
- Node IO inferido.
- Logs recentes.
- Comparação entre runs.
- Comparação de regressão entre runs com modo live/mock/pinned, eventos pinados/mock, tokens, custo estimado e veredito de revisão.
- Destaque causal no grafo: upstream, nó de falha, impacto e cascata.
- Painel "Contexto do nó" com status, papel causal, erro relacionado, eventos recentes, metadados do nó/LLM, prompt renderizado, input/output, estado, métricas, spans estruturados, diffs e logs correlacionados.
- Diagnóstico automático por nó com causa provável, próximas ações e evidências do evento/snapshot.
- Diagnóstico contextual por tipo de nó para LLM, safety, code, HTTP, banco, arquivo/RAG, approval, scoring e analytics.
- Fork de checkpoint/evento para cenário local reexecutável, preservando origem do run, evento, snapshot e metadata da reexecução.
- Restauração de cenário forkado no runtime gerado: o Studio envia `restore.state` e o FastAPI tenta primeiro recuperar estado real do checkpointer pelo `sourceSessionId`, caindo para o snapshot serializado quando necessário.
- Pin local de input/output por nó no Studio, com indicador `atual/stale` quando a definição do nó muda.
- Cenários podem usar pins ativos como mock/replay determinístico por nó; a execução envia os pins na metadata da sessão e o runtime gerado evita efeitos reais do nó quando há pin compatível.
- Cenários possuem thresholds de regressão para crescimento de tokens, custo e duração; esses limites acompanham a metadata da execução e controlam o veredito da comparação.
- Cenários importam/exportam fixture JSON de replay com input, thresholds, checkpoint, pins ativos/stale e metadata exata enviada ao runtime.
- Cenários/fixtures podem ser executados em lote sequencial, com resumo por cenário, sessão, duração, erro, comparação automática com o run anterior do mesmo cenário, relatório JSON exportável e aprovação local por hash do lote.

### Aprovação E Runtime Docker

- Geração de sandbox LangGraph.
- Aprovação por hash de flow/assets.
- Bloqueio de geração do runtime final quando o hash aprovado está desatualizado.
- Geração de API FastAPI/Docker final aprovada.
- Controle operacional local pela UI:
  - status;
  - preparar `.env`;
  - configurar portas;
  - build;
  - cancelamento de build em andamento;
  - compose up;
  - compose down;
  - smoke test;
  - inspeção de serviços;
  - logs;
  - histórico operacional com filtros por operação, status, resultado, texto, etapa de build e status do progresso.
- Progresso incremental durante `docker compose build`, com percentuais estimados quando o output do Docker não traz contagem explícita.
- Links para `/docs` e `/openapi.json` do runtime final.

## Objetivo De Produto

O objetivo é permitir que um usuário construa agentes tão completos quanto APIs feitas manualmente, sem perder capacidade por usar uma interface visual.

Isso inclui:

- conversas baseadas em sessão;
- perguntas guiadas pelo agente;
- consulta de conteúdo;
- geração de perguntas a partir de conteúdo;
- prompts versionáveis;
- LLM por adapter;
- mock determinístico;
- estado por conversa;
- idempotência;
- transcript;
- eventos;
- safety;
- persistência;
- cache opcional;
- testes automatizados;
- empacotamento em API independente.

A interface visual deve acelerar o caso comum, mas sempre manter escape hatches para código customizado, tools externas, sidecars, adapters HTTP/MCP e runtimes futuros.

## Recursos Planejados

### Próximo Ciclo

- Ampliar auditoria visual automatizada para estados gerais de erro/loading em painéis específicos além do status global e do fluxo Docker.
- Melhorar ergonomia do canvas com grupos, estado dirty/stale e controles contextuais.
- Evoluir edição visual de prompts, schemas e metadados sem depender do JSON bruto.
- Refinar replay por pins e restauração de estado com UX mais guiada.

### Médio Prazo

- Playground avançado com forms derivados de schema, output render/raw e secrets locais mascarados.
- Alertas de regressão configuráveis por tipo de nó.
- Catálogo local de templates, tools, skills e agents reutilizáveis.
- Editor visual de manifesto multiagente.
- Trace filtrável por agente.
- Testes com PostgreSQL real compartilhado em bundles multiagente.

### Longo Prazo

- Safety Harness completo.
- Streaming SSE/WebSocket.
- Jobs e workers pós-finalização.
- Triggers e schedules.
- Evaluators e datasets locais.
- Annotation queues locais.
- Auth avançada.
- Integração opcional com LangSmith Cloud.
- Adapters para TypeScript e outras linguagens via sidecar, HTTP, MCP ou runtime adapter.

## Como Rodar Localmente

Pré-requisitos principais:

- Node.js.
- npm.
- Python para os testes/runtimes gerados.
- Docker, apenas para validar o runtime final em container.

Instale dependências:

```bash
npm install
```

Rode a API do Builder:

```bash
npm run dev:builder-api
```

Por padrão, ela sobe em:

```text
http://127.0.0.1:3333
```

Rode a UI:

```bash
npm run dev:builder-ui
```

Por padrão, ela sobe em:

```text
http://127.0.0.1:5173
```

## Comandos Úteis

Validar o flow de referência:

```bash
npm run validate:flow
```

Gerar runtime FastAPI/LangGraph:

```bash
npm run codegen:reference
```

Gerar sandbox LangGraph:

```bash
npm run codegen:sandbox
```

Gerar bundle por manifesto:

```bash
npm run codegen:manifest
```

Executar verificações principais:

```bash
npm run typecheck
npm run test:builder-api
npm run test:ui-theme
npm run test:codegen
npm run build:builder-ui
```

Executar a bateria mais ampla usada no projeto:

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
```

## Estrutura Do Repositório

```text
apps/
  builder-api/     API local do Builder/Studio
  builder-ui/      interface visual em React/Vite
packages/
  flow-spec/       contrato do agent.flow.json
  codegen-langgraph/ codegen para LangGraph/FastAPI
flows/
  reference-interview/ flow de referência versionável
generated/
  reference-interview-runtime/ runtime FastAPI gerado
  reference-interview-langgraph-sandbox/ sandbox LangGraph gerado
  reference-runtime-bundle/ bundle multiagente gerado
examples/
  reference-interview-runtime/ baseline manual
docs/
  documentação de plano, status, arquitetura e UX
tools/
  verificadores auxiliares
```

## Documentação Principal

- `docs/implementation-status.md`: estado real implementado, verificado e pendente.
- `docs/master-implementation-plan.md`: plano mestre do produto.
- `docs/local-studio-plan.md`: plano do Studio Local.
- `docs/proup-capability-parity.md`: benchmark de capacidade para evitar regressão.
- `docs/ux/`: decisões de UI/UX, regras visuais, análise de referências e roadmap visual.
- `docs/plan.md`: plano técnico consolidado original do workspace.

## Status

Este repositório está em desenvolvimento ativo.

A base atual já permite editar flows, gerar artefatos, executar sandbox local, inspecionar runs e gerar runtime Docker aprovado. Ainda há trabalho planejado em refinamento de UX, playground avançado, cenários, pinning, multiagente operacional e adapters de runtime mais amplos.
