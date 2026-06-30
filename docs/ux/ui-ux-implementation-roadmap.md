# Roadmap UI/UX: Builder Completo e Studio Local

Este roadmap transforma a pesquisa e as especificacoes em etapas implementaveis.

## Fase UX-0: Inventario e Baseline

Objetivo:

- mapear a UI atual do Builder;
- identificar componentes reaproveitaveis;
- levantar gaps contra `docs/ux/local-studio-interface-spec.md`.

Entregaveis:

- inventario de componentes existentes;
- mapa de rotas/telas;
- lista de gaps por severidade;
- screenshots do estado atual em claro/escuro se ja existir tema parcial.

Aceite:

- nenhum trabalho visual comeca sem saber quais componentes atuais serao mantidos.

## Fase UX-1: Design System

Objetivo:

- criar tokens, temas e componentes base.

Entregaveis:

- tokens CSS;
- tema claro;
- tema escuro;
- botoes, tabs, badges, panels, drawers, tooltips;
- estados comuns: dirty, stale, running, error, approved.

Aceite:

- Builder atual funciona nos dois temas sem regressao visual evidente.

## Fase UX-2: Shell Unificado

Objetivo:

- criar a estrutura unica para Flow, Studio Local, Artefatos e Runtime.

Entregaveis:

- top bar;
- left rail;
- workspace panel;
- inspector;
- bottom drawer;
- persistencia de layout local.

Aceite:

- usuario navega entre as areas sem perder contexto do flow selecionado.

## Fase UX-3: Builder WYSIWYG Refinado

Objetivo:

- deixar o editor visual intuitivo para criar agentes sem editar JSON.

Entregaveis:

- palette pesquisavel;
- inspector por tipo de no;
- grupos e notas;
- diagnosticos clicaveis;
- estados dirty/stale;
- edicao visual de prompts e schemas comuns.

Aceite:

- usuario consegue criar ou ajustar o flow de referencia somente pela UI.

## Fase UX-4: Studio Local MVP

Objetivo:

- testar agente localmente sem terminal.

Entregaveis:

- iniciar/parar sandbox;
- criar sessao;
- start/turn/finish;
- transcript;
- events;
- logs;
- grafo com status por no;
- inspector de run.

Aceite:

- usuario valida um cenario completo sem abrir Swagger nem terminal.

## Fase UX-5: Observabilidade Visual

Objetivo:

- tornar debug de agente claro e navegavel.

Entregaveis:

- timeline sincronizada com grafo;
- node IO;
- prompt renderizado;
- resposta bruta de LLM;
- snapshots de state;
- diff;
- filtros;
- export JSON.

Aceite:

- usuario consegue responder: qual no rodou, com qual input, qual output gerou e qual estado mudou.

## Fase UX-6: Cenarios, Pinning e Replay

Objetivo:

- reduzir repeticao e facilitar teste de edge cases.

Entregaveis:

- cenarios salvos;
- pinning de payload/input/output;
- replay de run;
- fork de checkpoint como recurso avancado;
- comparacao entre runs.

Aceite:

- usuario consegue reproduzir uma falha e testar correcao com dados fixos.

## Fase UX-7: Aprovacao e Runtime Docker

Objetivo:

- completar o fluxo ate a API embarcada.

Entregaveis:

- painel de aprovacao por hash;
- bloqueios visuais quando hash muda;
- geracao runtime;
- build/up/down Docker;
- healthcheck;
- smoke test;
- links para `/docs` e `/openapi.json`.

Aceite:

- usuario sai de uma run aprovada para um container local validado pela UI.

## Fase UX-8: Multiagente e Recursos Avancados

Objetivo:

- escalar a experiencia para bundles multiagente.

Entregaveis:

- seletor de agente;
- runs por agente;
- traces separados;
- rotas por agente;
- grafo de orquestracao multiagente;
- worker/jobs;
- streaming;
- safety harness;
- auth avancada.

Aceite:

- multiagente continua compreensivel sem virar uma tela de logs.

## Definition of Done UX

Uma fase de UI so esta pronta quando:

- foi testada em tema claro e escuro;
- tem estado vazio, sucesso, erro e loading;
- nao exige terminal para o caminho principal;
- tem tooltips em icones nao obvios;
- tem mensagens de erro acionaveis;
- nao quebra em 1280x720;
- possui pelo menos um teste ou checklist manual documentado;
- foi validada com um flow real, nao apenas mock visual.

