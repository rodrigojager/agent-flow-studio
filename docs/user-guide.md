# Guia do Usuario

Este guia cobre o uso do Agent Flow Studio por quem cria e valida agentes pela interface visual.

Status de referencia:

- MVP principal = 100%.
- plano total expandido = em andamento.
- LangSmith Cloud e opcional.

## Fluxo Principal

O caminho principal continua:

```text
Desenhar -> Testar -> Depurar -> Aprovar -> Gerar API Docker
```

O Builder/Studio e a ferramenta de criacao, teste, debug, aprovacao e empacotamento. O produto final gerado e uma API FastAPI/Docker removivel da ferramenta.

## Inicio Rapido

Instale dependencias e suba os dois processos locais:

```bash
npm install
npm run dev:builder-api
npm run dev:builder-ui
```

URLs padrao:

- Builder API: `http://127.0.0.1:3333`
- Builder UI: `http://127.0.0.1:5173`

O caminho curto completo esta em `docs/quickstart-10-min.md`.

## Criar e Validar

Use a UI para:

- abrir ou criar um flow;
- editar nos, arestas, prompts, schemas, adapters e arquivos;
- validar o flow;
- corrigir diagnosticos no canvas, inspector ou aba Arquivos.

Validacao local repetivel:

```bash
npm run validate:flow
npm run test:mvp-main-path
```

## Testar e Depurar

Na aba Studio Local:

- iniciar sandbox;
- criar sessao;
- enviar start/turn/finish;
- ver transcript, events, timeline, state, node IO e logs;
- comparar runs, usar cenarios, pins, checkpoints e avaliadores quando necessario.

O Studio deve manter dados locais e evidencias governadas sem depender de LangSmith Cloud.

## Aprovar e Gerar API Docker

Depois de uma run valida:

1. revise a evidencia local;
2. aprove a versao por hash;
3. gere a API Docker final;
4. rode o smoke do runtime final.

Se qualquer asset coberto pelo hash mudar, a aprovacao fica desatualizada e deve ser refeita.

## Regras de Uso

- Nao coloque secrets em prompts, schemas, exemplos ou exports governados.
- Use secrets locais apenas nos paineis/campos proprios para ambiente local.
- Use LangSmith Cloud apenas como handoff opcional.
- Nao trate pendencias do plano expandido como regressao do MVP principal.
