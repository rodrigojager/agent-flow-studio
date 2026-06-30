# Plano Revisado: Fábrica de Agentes de IA

Este plano consolida o objetivo original do `plano.txt`, a análise da API ProUp em `apps/ai-agents-service` e as decisões registradas nas ADRs. O foco é criar uma ferramenta visual e um gerador de código para produzir agentes de IA como APIs independentes, com suporte tanto a runtimes monoagente quanto multiagente.

## Objetivo

Criar uma fábrica de agentes de IA orientados a fluxo, estado e API. O usuário desenha um fluxo visual, configura prompts, schemas, regras e integrações, valida o fluxo, testa e depura o agente em um Studio Local 100% local, aprova o comportamento nesse sandbox e então gera o runtime FastAPI embarcável em container Docker para consumo por HTTP.

O produto não é um chatbot genérico e não é uma plataforma central obrigatória em produção. O builder existe para criar, validar e gerar. O runtime gerado deve rodar sozinho.

## Pipeline Alvo

O fluxo de uso do produto deve ter quatro etapas explícitas:

1. Builder WYSIWYG:
   - montar o agente visualmente;
   - editar prompts, schemas, nós, condições e integrações;
   - validar o `agent.flow.json`;
   - gerar o código intermediário do agente.

2. Studio Local:
   - iniciar o agente em sandbox local;
   - testar threads/sessions, runs, estado, checkpoints e comportamento dos nós;
   - visualizar grafo, timeline, node IO, transcript, events, state snapshots e logs;
   - ajustar o fluxo no builder quando a validação local apontar problemas;
   - marcar uma versão do agente como aprovada para empacotamento, vinculando a aprovação ao hash do flow, prompts, schemas e arquivos usados pelo agente.

3. Artefato LangGraph/LangSmith opcional:
   - manter compatibilidade com LangGraph Platform, incluindo `langgraph.json`, módulo Python exportando o grafo e `.env.example` com variáveis LangSmith;
   - permitir uso de `langgraph dev` e do Studio web oficial quando o usuário quiser;
   - não depender de LangSmith Cloud para o fluxo principal.

4. Runtime de API embarcada:
   - gerar o runtime FastAPI a partir da versão aprovada;
   - incluir contrato HTTP, Swagger/OpenAPI, autenticação inicial, persistência pública, transcript, events e idempotência;
   - gerar Dockerfile/compose e pacote implantável;
   - validar que o container roda sem depender do builder nem do sandbox.

O Studio Local, o artefato LangGraph opcional e o runtime de API podem compartilhar a maior parte do código do grafo, prompts e schemas, mas são alvos diferentes. O Studio Local existe para validação e observabilidade sem cloud. O artefato LangGraph mantém interoperabilidade com o ecossistema LangSmith/LangGraph. O runtime FastAPI/Docker é o produto final embarcado como API independente.

## Direção Local-First

O plano mestre de implementação está em `docs/master-implementation-plan.md`.
O plano completo do Studio Local está em `docs/local-studio-plan.md`.
As especificações de UX e interface ficam em `docs/ux/`, cobrindo pesquisa de referências, layout, interações, design system e roadmap visual.

A direção de produto passa a ser:

- funcionar 100% localmente sem conta LangSmith;
- não depender de taxas de plataforma cloud;
- manter uso opcional de provedores pagos de modelo, quando configurados pelo usuário;
- suportar mock e modelos locais para custo zero de inferência;
- oferecer tema claro e escuro;
- unificar Builder Visual, Studio Local, aprovação e Docker final na mesma interface.

## Referência Analisada

A API ProUp atual é um serviço FastAPI multiagente com padrões que devem ser reproduzíveis:

- endpoints de criação, início, turno, finalização e transcript;
- estado por conversa;
- idempotência por mensagem;
- prompts em arquivos;
- chamadas à OpenAI via SDK;
- mocks de LLM;
- SQLAlchemy/Postgres;
- Redis opcional;
- safety;
- análises pós-finalização;
- testes automatizados.

O objetivo não é copiar toda a regra de negócio da ProUp no MVP. O objetivo é garantir que a arquitetura gerada consiga reproduzir esse tipo de sistema quando necessário.

O mapeamento de paridade ProUp e a politica de escape hatch contra engessamento visual estao registrados em `docs/proup-capability-parity.md`.

## Decisões Centrais

O runtime gerado deve suportar dois modos de empacotamento:

- modo monoagente: um FastAPI para um agente;
- modo multiagente: um FastAPI hospedando vários agentes quando eles compartilham banco, operação e consumidor.

Cada agente terá um `agent.flow.json` próprio. O agrupamento multiagente será descrito por um manifesto separado, como `runtime.manifest.json`.

O contrato canônico para agentes interativos será baseado em sessões:

```text
POST /sessions
GET  /sessions/{session_id}
POST /sessions/{session_id}/start
POST /sessions/{session_id}/turn
POST /sessions/{session_id}/finish
GET  /sessions/{session_id}/transcript
GET  /sessions/{session_id}/events
GET  /health
GET  /metadata
GET  /docs
GET  /openapi.json
```

`POST /sessions` cria uma sessão. `POST /sessions/{session_id}/start` inicia o fluxo. O início automático na criação pode existir, mas precisa ser configuração explícita.

Idempotência será explícita por `Idempotency-Key` no header, com fallback por `idempotency_key` no corpo JSON. Chaves de negócio não controlam idempotência. Se header e body vierem com valores diferentes, a chamada deve ser rejeitada.

`turn` é a linguagem pública para agentes interativos. `resume` fica reservado para workflows não conversacionais ou para detalhes internos do LangGraph.

`transcript` contém mensagens visíveis. `events` contém trilha operacional: nós executados, gates, safety, retries, chamadas de LLM, erros e finalização.

## Arquitetura de Persistência

O runtime gerado terá persistência dupla:

- checkpointer PostgreSQL do LangGraph como fonte de verdade do estado executável;
- tabelas próprias da API para contrato público, sessões, transcript, eventos e idempotência.

O estado público não deve duplicar todo o checkpoint. Ele deve guardar projeções úteis, como status, fase, último nó, timestamps e informações de integração.

Redis será usado como cache quente para contexto recente, mensagens renderizadas e respostas idempotentes reconstruíveis. Em cache miss, o runtime deve reconstruir pelo banco e pelo checkpoint. Para desenvolvimento e testes, haverá fallback in-memory.

## LLM

Os nós devem chamar modelos por uma interface interna `LLMClient`, sem espalhar SDKs diretamente pelo código de cada nó.

O codegen deve incluir apenas o adaptador selecionado para aquele runtime. O catálogo do builder pode conhecer adapters como OpenAI/OpenAI-compatible, OpenRouter e outros gateways futuros, mas o artefato gerado não deve carregar adapters não usados.

Precedência de configuração:

```text
runtime.manifest.json
-> agent.flow.json
-> node-level override
```

O baseline implementa OpenAI/OpenAI-compatible primeiro, com mock determinístico, retries, prompt Markdown e eventos.

## Safety

O MVP terá Safety Gate simples, determinístico e configurável para entrada e saída:

```text
input_safety_check
llm_step
output_safety_check
```

O Safety Gate deve poder bloquear entrada, impedir chamada ao LLM, devolver resposta segura e registrar evento. No futuro, o sistema precisa aceitar um Safety Harness completo, mesmo que isso exija uma camada de implementação mais robusta ou um produto/componente separado.

## Autenticação

O baseline terá autenticação simples por API key em header, por exemplo `X-Agent-API-Key`, desativável em dev/test. OAuth, OIDC, permissões, multi-tenant e rotação de chaves ficam para evolução futura.

## Baseline de Geração

O primeiro entregável técnico será um agente de referência manual, enxuto e executável, em LangGraph + FastAPI.

Esse agente será parecido com uma entrevista guiada, mas quase como um hello world stateful:

- cria sessão;
- inicia fluxo;
- recebe turnos;
- passa por safety simples;
- chama LLM ou mock;
- aplica gate determinístico simples;
- registra transcript;
- registra eventos;
- persiste estado via LangGraph checkpointer;
- usa PostgreSQL;
- usa Redis como cache quente;
- lê prompt Markdown;
- trata retries e erros;
- finaliza sessão.

Ele não precisa reproduzir AAP, COPSOQ ou toda a entrevista ProUp. Ele precisa provar a estrutura.

Esse baseline ficará versionado no monorepo, por exemplo:

```text
examples/reference-interview-runtime/
```

Depois, o mesmo agente será descrito por `agent.flow.json` e gerado pelo codegen. O projeto gerado será comparado contra o baseline como critério de aceitação. O codegen não deve trapacear copiando diretamente os arquivos do baseline; ele deve produzir runtime equivalente a partir da especificação.

## Monorepo

Estrutura proposta:

```text
agent-flow-builder/
  apps/
    builder-ui/
    builder-api/

  packages/
    flow-spec/
    codegen-langgraph/
    shared/

  flows/
    reference-interview/
      agent.flow.json
      prompts/
      schemas/

  examples/
    reference-interview-runtime/

  generated/
    reference-interview-runtime/

  docs/
    adr/
    plan.md

  runtime.manifest.json
```

Tecnologias:

- builder-ui: React, React Flow, TypeScript, Zod, Monaco;
- builder-api: Node/Fastify ou equivalente em TypeScript;
- flow-spec: Zod/TypeScript como fonte canônica;
- codegen: TypeScript com templates;
- runtime gerado: Python, FastAPI, LangGraph, Pydantic, SQLAlchemy, Redis, OpenAI SDK e runner Node para nós JavaScript/TypeScript;
- containers: Docker e Docker Compose.

O Flow Spec será canônico em Zod/TypeScript e exportará JSON Schema. O Python gerado consome artefatos derivados quando precisar validar especificações.

## Artefatos Versionáveis

O builder salva arquivos no workspace, não em banco próprio no MVP.

Prompts ficam em Markdown separado:

```text
prompts/system.md
prompts/evaluate_answer.md
```

Schemas ficam em JSON Schema separado:

```text
schemas/session_input.schema.json
schemas/llm_output.schema.json
schemas/evaluation.schema.json
```

O `agent.flow.json` referencia prompts e schemas por identificador, caminho, versão e metadados.

## Fases

### Fase 0: Runtime Manual de Referência

Criar o baseline LangGraph + FastAPI manual.

Entregáveis:

- FastAPI com contrato `/sessions`;
- LangGraph real;
- PostgreSQL com checkpointer e tabelas públicas;
- Redis cache com fallback in-memory;
- prompts Markdown;
- LLMClient com OpenAI/OpenAI-compatible e mock;
- Safety Gate simples;
- retries e tratamento de erro;
- API key por header;
- Dockerfile e docker-compose;
- testes automatizados.

Critério de sucesso:

- o baseline executa o fluxo de referência ponta a ponta;
- cache miss é reconstruível;
- idempotência funciona;
- transcript e events são separados;
- OpenAPI fica claro.

### Fase 1: Flow Spec

Definir o formato intermediário.

Entregáveis:

- pacote `flow-spec`;
- Zod schemas;
- export JSON Schema;
- exemplo `flows/reference-interview/agent.flow.json`;
- validação CLI.

Critério de sucesso:

- o agente de referência pode ser descrito sem código Python manual.

### Fase 2: Codegen LangGraph Base

Gerar a base Python do agente a partir do flow.

Entregáveis:

- geração de `graph.py`;
- geração de nodes;
- geração de prompts e schemas;
- geração de README;
- testes de equivalência contra baseline.

Critério de sucesso:

- o grafo gerado se comporta como o baseline sem copiar diretamente os arquivos do baseline.

### Fase 2.5: Artefato LangGraph Compatível

Gerar o pacote compatível com LangGraph Platform e útil para o Studio Local antes de criar a API embarcada.

Entregáveis:

- geração de `langgraph.json`;
- módulo Python exportando um grafo carregável pela LangGraph Platform;
- `.env.example` com `LANGSMITH_API_KEY`, `LANGSMITH_TRACING`, `LANGSMITH_PROJECT` e variáveis de modelo;
- comandos documentados para `langgraph dev` ou fluxo equivalente;
- smoke test que valida carregamento do grafo pelo entrypoint do LangGraph;
- metadado determinístico do projeto gerado para permitir aprovação por hash;
- instruções para abrir runs/traces no LangSmith quando o uso cloud for desejado.

Critério de sucesso:

- o agente gerado pelo builder pode ser carregado localmente e também permanece compatível com LangGraph/LangSmith quando o usuário quiser usar esse ecossistema.

### Fase 3: Builder Visual MVP

Criar editor visual para montar o flow.

Entregáveis:

- canvas React Flow;
- palette de nós;
- painel de propriedades;
- editor de prompt;
- preview JSON;
- validação visual;
- import/export de workspace.

Critério de sucesso:

- o usuário monta visualmente o agente de referência e exporta o mesmo `agent.flow.json` esperado.

### Fase 4: Integração Builder + Codegen

Permitir gerar os artefatos pela interface.

Entregáveis:

- botão gerar código base;
- botão gerar pacote de sandbox LangSmith/LangGraph;
- botão para aprovar a versão testada no sandbox;
- botão para gerar a API Docker a partir da versão aprovada;
- preview de arquivos;
- download ou escrita em workspace;
- mensagens de erro úteis;
- comparação contra baseline.

Critério de sucesso:

- o builder visual gera o código equivalente ao baseline e o pacote de sandbox carregável.

### Fase 5: Sandbox

Testar agentes gerados rapidamente em dois níveis: sandbox local integrado ao Builder e artefato LangGraph opcional.

Entregáveis:

- iniciar o artefato LangGraph em sandbox local;
- link ou instrução clara para abrir traces/runs no LangSmith apenas como integração opcional;
- iniciar runtime gerado localmente;
- link para Swagger;
- formulário para criar sessão, start, turn e finish;
- visualização de transcript e events;
- logs básicos.

Critério de sucesso:

- o usuário consegue validar o comportamento localmente e, depois, testar a API local sem montar comandos manualmente.

### Fase 5.5: Container da API Embarcada

Gerar o container final somente depois da validação do agente no sandbox LangSmith/LangGraph.

Entregáveis:

- geração de FastAPI;
- geração de migrations;
- geração de Dockerfile/compose;
- comprovante `.agent-flow/langgraph-sandbox-approval.json` no runtime final;
- healthcheck e documentação de execução;
- validação automática do container ou smoke test equivalente;
- OpenAPI exposto em `/docs` e `/openapi.json`.

Critério de sucesso:

- o container final sobe a API independente, mantém estado entre turnos e reproduz o comportamento aprovado no sandbox.

### Fase 6: Recursos Avançados

Adicionar nós e capacidades além do baseline:

- RAG retrieval;
- PDF/file extract;
- HTTP request;
- database query/save;
- approval gate;
- structured output avançado;
- scoring;
- analytics;
- jobs pós-finalização;
- bundles multiagente.

### Fase 7: Studio Local Completo

Substituir a dependência do Studio web externo por uma experiência própria, local e integrada ao Agent Flow Builder.

Entregáveis:

- especificação de UX baseada em referências públicas do LangSmith/LangGraph Studio e n8n, sem copiar código, assets ou marca;
- tema claro e escuro com tokens de design compartilhados;
- aba `Studio Local`;
- orquestração local de sandbox;
- visualização interativa do grafo em execução;
- playground para start/turn/finish;
- threads, runs e replay;
- timeline de eventos;
- state inspector com snapshots e diff;
- painel de input/output por nó;
- logs do sandbox e do container final;
- traces persistidos localmente;
- aprovação por hash dentro do Studio;
- geração e smoke test da API Docker final pela UI;
- suporte posterior a multiagente, streaming, worker, safety e auth avançada.

Critério de sucesso:

- o usuário cria, testa, depura, aprova e empacota um agente sem sair do Agent Flow Builder e sem depender de LangSmith Cloud.

## Melhorias Futuras Já Identificadas

Autenticação avançada:

- múltiplas chaves;
- rotação;
- escopos;
- JWT;
- OAuth/OIDC;
- rate limit;
- multi-tenant.

Streaming:

- SSE;
- WebSocket;
- resposta incremental;
- progresso ao vivo do grafo.

Jobs pós-finalização:

- fila persistente;
- worker separado;
- agendamento;
- reprocessamento;
- métricas.

Safety Harness completo:

- scanners avançados;
- privacidade;
- tracing;
- alarmes;
- política por agente ou organização;
- possível extração como produto/componente próprio.

## Critérios de Sucesso do Produto

O projeto será bem-sucedido se:

- criar o segundo agente for muito mais rápido que programar FastAPI/LangGraph manualmente;
- o runtime gerado for legível e enxuto;
- monoagente e multiagente forem suportados;
- os contratos HTTP forem claros;
- idempotência for explícita e confiável;
- o estado executável for persistido corretamente;
- transcript e events forem auditáveis;
- prompts e schemas forem versionáveis;
- o codegen gerar runtime equivalente ao baseline;
- o artefato gerado puder ser testado no sandbox LangSmith/LangGraph antes do empacotamento final;
- o agente final rodar independente do builder;
- Docker/compose permitirem execução local previsível.

## Próximo Passo

Depois deste plano, preparar o diretório na estrutura ICM para manter contexto, decisões e roteamento documental organizados conforme o projeto evoluir.
