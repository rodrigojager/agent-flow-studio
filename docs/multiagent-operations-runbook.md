# Runbook de Operacao Multiagente

Este runbook cobre criacao, debug, aprovacao e operacao de bundles multiagente.

Status de referencia:

- MVP principal = 100%.
- plano total expandido = em andamento.
- LangSmith Cloud e opcional.

## Conceitos

- `flow`: definicao visual versionavel de um agente.
- `agent`: runtime montado a partir de um flow dentro do bundle.
- `route`: prefixo HTTP isolado usado por um agente no bundle.
- `handoff`: decisao de transferir execucao ou contexto para outro agente.
- `memory`: memoria compartilhada governada (`shared_memory`) com previews compactos.
- `orchestration step`: etapa executada pelo orquestrador, com agente, entrada, saida e decisao.
- `agentIsolation`: contrato de isolamento operacional por agente, rota, storage, idempotencia e scopes.

## Criacao E Validacao

Fluxo operacional:

1. edite flows individuais;
2. configure `runtime.manifest.json`;
3. valide composicao assistida;
4. revise rotas e `agent_id`;
5. configure handoffs e memoria compartilhada;
6. gere bundle aprovado por manifesto;
7. rode smoke por agente e smoke agregado.

Gates:

```bash
npm run codegen:manifest
npm run test:manifest
npm run test:portable-runtime-bundle
npm run test:multiagent-postgres
```

## Debug De Orquestracao

Use `POST /orchestration/run` no runtime final ou o painel `Debug orquestração` no Studio para capturar:

- plano;
- etapa;
- agente selecionado;
- entrada sanitizada;
- decisao de handoff;
- memoria compartilhada entregue;
- erro sanitizado;
- `debug_trace`;
- resumo governado.

O `debug_trace` deve evitar input bruto, output bruto, headers, tokens, payloads e secrets.

## Isolamento Por Agente

Verifique por agente:

- `routePrefix` unico;
- `agent_id` em `/metadata`;
- storage com escopo por agente;
- idempotencia por prefixo/agent;
- scopes `agents:<agent_id>:...`;
- smoke direto por agente;
- runbook JSON por agente sem secrets.

## Operacao Do Bundle

Antes de liberar um bundle:

- confirme smoke agregado;
- confirme smoke direto de cada agente;
- compare metadata raiz e metadata por agente;
- exporte runbook por agente;
- revise historico filtrado por agente;
- confirme que falha de um agente aparece com rota/agente claros;
- confirme que memoria compartilhada esta resumida e governada.

## Evidencia De Release

Evidencias esperadas:

- `runtime.manifest.json` aprovado;
- `bundle.json` com `orchestration` e `agentIsolation`;
- `debug_trace` governado para pelo menos um fluxo de orquestracao;
- smoke por agente;
- smoke agregado;
- bundle multiagente copiavel para fora do workspace do Studio com `app/worker.py` raiz, Compose com `api`/`worker` e pytest executado a partir do pacote copiado;
- teste PostgreSQL real compartilhado quando storage compartilhado entrar no escopo;
- README/runbook por agente.

O plano total expandido continua em andamento enquanto cenarios/evaluators multiagente e colaboracao distribuida profunda ainda nao estiverem homologados em workflows reais.
