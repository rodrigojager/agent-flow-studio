# Plano Completo: Agent Flow Builder Local Studio

Este plano substitui a dependência operacional do LangSmith Studio por uma experiência 100% local dentro do Agent Flow Builder. A ferramenta continua podendo gerar artefato compatível com LangGraph Platform, mas o fluxo principal passa a ser local-first: desenhar, testar, debugar, aprovar e empacotar sem cloud obrigatória.

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
- implementado: comparação entre runs com diffs semânticos por nó, cadeia causal visual (upstream/impact), pinning de cenário e execução reprodutível;
- implementado: progresso incremental de build no histórico e painel de progresso no artefato;
- implementado: drill-down contextual por nó com input/output, eventos, diffs, logs correlacionados, prompt renderizado, metadados LLM, métricas de usage/custo/duração e spans estruturados;
- implementado: diagnóstico operacional por nó com causa provável, próximas ações e evidências derivadas de payload/safety/status/snapshot/cadeia causal, com regras específicas para LLM, safety, code, HTTP, banco, arquivo/RAG, approval, scoring e analytics;
- implementado: fork de checkpoint/evento para cenário local reexecutável, preservando origem de run, evento, snapshot, input/output e metadata da nova execução;
- pendente: filtros avançados de histórico operacional e restauração real de estado por checkpointer/runtime.

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
- logs do container final.

Critério de sucesso:

- o usuário sai do Studio Local direto para uma API Docker validada.

### Fase 7.7: Multiagente Local

Entregáveis:

- visualizar manifestos multiagente;
- testar agentes por `agent_id`;
- isolamento por rota/agente;
- runs por agente;
- Postgres compartilhado em teste local;
- logs e traces separados por agente.

Critério de sucesso:

- bundles multiagente são depurados localmente com clareza operacional.

### Fase 7.8: Recursos Avançados

Entregáveis:

- streaming SSE/WebSocket;
- worker de jobs pós-finalização;
- Safety Harness completo;
- autenticação avançada local;
- modelos locais;
- templates de cenários de teste;
- avaliação/scoring por lote.

Critério de sucesso:

- a ferramenta cobre workflows reais além do agente de referência.

## O Que Sai do Escopo Principal

Integração com LangSmith Cloud vira opcional:

- exportar pacote compatível;
- copiar comando `langgraph dev`;
- configurar `LANGSMITH_API_KEY`;
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
- permite evolução para multiagente, streaming, jobs, safety e auth avançada.

## Plano de Entrega Atual (continuidade)

### Prioridade 1 (semana atual)

1. aprofundar o drill-down contextual no Studio:
   - abrir node-io e eventos no mesmo clique do nó falho/impactado;
   - ampliar cobertura de exemplos e cenários salvos para as regras específicas por tipo de nó;
   - evoluir o fork local de checkpoint para restauração real quando o runtime expuser retomada por estado/checkpointer.
2. melhorar inspeção de execução longa:
   - histórico operacional com filtro por nível;
   - status persistente de build/up/smoke com alertas visuais de regressão.

### Prioridade 2 (próxima semana)

3. consolidar cenários:
   - pin/mocking de payload por cenário;
   - pin por nó e marca de "dirty/stale";
   - replay com comparação de métricas.
4. auditoria completa de tema:
   - verificar fluxo em ambas paletas;
   - revisar contraste e tooltips em telas `Flow`, `Studio`, `Artefatos`, `Runtime`.

### Prioridade 3 (seguinte)

5. capacidade não nativa expandida:
   - contrato por nó de saída para HTTP/MCP/sidecar;
   - logs estruturados por nó customizado no Studio.
6. multiagente operacional:
   - `agent_id` em runtime de teste e final;
   - filtros por agente em runs e execução.

## Regra de decisão para novos comportamentos

Sempre que uma necessidade não couber no no visual nativo:

- usar `code` quando for lógica local/transformação/integração simples;
- usar HTTP/MCP/sidecar para TypeScript/ambiente externo;
- validar no Studio (input/output/erros/execução);
- incluir no hash de aprovação;
- não exigir edição manual do runtime final para manter a capacidade.
