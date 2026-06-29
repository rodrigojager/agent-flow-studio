# Status de Implementação

Última atualização: 2026-06-29.

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
- LLMClient OpenAI/OpenAI-compatible com mock determinístico.
- Safety Gate simples de entrada e saída.
- API key simples por header.
- Dockerfile, Docker Compose, `.env.example` e migration SQL do baseline.
- Flow de referência em `flows/reference-interview/agent.flow.json`.
- Flow Spec inicial em Zod/TypeScript.
- Codegen em TypeScript gerando runtime Python executável em `generated/reference-interview-runtime/`.
- Validação mínima de equivalência do baseline: o runtime manual e o runtime gerado exercitam o mesmo contrato `/sessions`, idempotência, transcript, eventos, safety e fluxo LangGraph de referência.
- Builder API mínima em `apps/builder-api/` para listar, ler, validar e gerar flows versionáveis.
- Builder UI inicial em `apps/builder-ui/` com canvas React Flow, lista de flows, inspector, preview JSON, edição básica de propriedades, salvamento do `agent.flow.json` e ações de validar/gerar via Builder API.
- Builder API persiste flows versionáveis com `PUT /flows/{flowId}`, valida Flow Spec antes de gravar e bloqueia divergência de `id`.
- Builder API lê e salva prompts Markdown e schemas JSON referenciados pelo flow, com validação de path dentro do diretório do flow e validação JSON para schemas.
- Builder UI possui aba `Arquivos` para editar prompts e schemas referenciados pelo flow antes de validar, gerar ou iniciar sandbox.
- Builder UI permite criar, remover, mover, conectar e reconectar nós/arestas no canvas, com posições persistidas no `agent.flow.json`.
- Flow Spec aceita `position` opcional em nós para preservar layout visual sem afetar o runtime gerado.
- Codegen LangGraph monta o grafo gerado a partir dos nós e arestas do `agent.flow.json`, com handlers por tipo de nó e eventos baseados nos nós realmente executados.
- Codegen possui teste end-to-end com flow simplificado sem `deterministic_gate`, gerando runtime temporário e executando pytest no artefato gerado.
- Flow Spec define `RuntimeManifest` para agrupamento monoagente ou multiagente, com agentes referenciando `agent.flow.json` por `flowPath`.
- Codegen gera bundle a partir de `runtime.manifest.json`, com metadados, README e um runtime independente por agente em `generated/reference-runtime-bundle/agents/`.
- Codegen gera app FastAPI raiz para manifestos `multiagent`, montando os agentes em um único processo pelos `routePrefix` e preservando idempotência por prefixo de rota.
- Builder API lê, valida e gera bundles por manifesto via rotas `/runtime-manifest`, `/runtime-manifest/validate` e `/runtime-manifest/generate`.
- Sandbox local inicial: Builder API inicia/para o runtime gerado, acompanha status/logs, e Builder UI aciona criação de sessão, turnos, finalização, transcript e events.

## Verificado

```bash
npm run validate:flow
npm run codegen:reference
npm run codegen:manifest
npm run typecheck
npm run test:baseline
npm run test:generated
npm run test:manifest
npm run test:builder-api
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

## Ainda não implementado

- Codegen genérico para recursos avançados e execução real de todos os tipos futuros de nós.
- Teste automatizado de equivalência estrutural mais estrito entre baseline manual, flow spec e runtime gerado.
- Edição visual avançada de prompts/schemas, validação visual rica, import/export de workspace e ergonomia refinada do canvas.
- Sandbox visual mais completo, com logs ao vivo, gerenciamento de múltiplos runtimes e seleção de portas.
- Evoluir a composição multiagente inicial para modelos públicos com `agent_id`, isolamento operacional mais explícito e testes com banco PostgreSQL real compartilhado.
- Catálogo real de adapters além do OpenAI/OpenAI-compatible.
- Safety Harness completo.
- Jobs pós-finalização com worker.
- Streaming.
- Autenticação avançada.
- Nós avançados como RAG, PDF extract, HTTP request, database query/save, approval gate, scoring e analytics.
