# Guia do Operador

Este guia cobre a operacao da API final gerada fora do Studio e os gates antes de release local.

Status de referencia:

- MVP principal = 100%.
- plano total expandido = em andamento.
- LangSmith Cloud e opcional.

## Artefato Final

O artefato final esperado e uma API FastAPI/Docker independente, com:

- `README.md`;
- `.env.example`;
- `docker-compose.yml`;
- `Dockerfile`;
- OpenAPI/Swagger;
- healthcheck;
- worker opcional para jobs;
- testes do pacote gerado.

O gate de portabilidade valida que o runtime pode ser copiado para fora do workspace do Studio e operado a partir desse pacote:

```bash
npm run test:portable-runtime
npm run test:portable-runtime-auth
npm run test:portable-runtime-bundle
```

## Subir Runtime Final

Dentro do pacote gerado ou copiado:

```bash
docker compose up -d --build
```

Verificacoes minimas:

- `GET /health`;
- `GET /metadata`;
- criar sessao;
- start;
- turn;
- transcript;
- events;
- finish;
- jobs pos-finalizacao quando aplicavel.

O gate repetivel do workspace e:

```bash
npm run test:docker-runtime-smoke
```

## Auth Local do Runtime

Quando `AUTH_ENABLED=true`, valide:

- chamada sem chave bloqueada;
- chaves com scopes minimos;
- inventario seguro de chaves;
- auditoria local persistida;
- ausencia de valores brutos de chave em payloads e JSONL.

Use o gate:

```bash
npm run test:portable-runtime-auth
```

## Modelos Locais

Para adapter Ollama/local:

- confirme o modelo instalado;
- use setup de modelos pelo Studio ou profile `model-setup`;
- registre/exporte imagens quando precisar distribuir modelo local;
- valide GPU apenas quando Docker/NVIDIA/runtime estiverem presentes.

O runbook operacional detalhado esta em `docs/local-models-runbook.md`.

A matriz real CPU/GPU/modelos locais continua evidencia externa do plano expandido.

## Gates de Release

Use `docs/release-gate-matrix.md` para separar:

- gates diarios;
- release local;
- VM/microVM opt-in;
- evidencias externas;
- auditoria final de privacidade/secrets.

Use `docs/isolation-levels-runbook.md` para escolher entre processo local, container, container hardened, VM e microVM. O contrato documental e validado por:

```bash
npm run test:isolation-levels-runbook
```

Use `docs/multiagent-operations-runbook.md` para operar bundles multiagente com rotas, handoffs, memoria compartilhada, debug trace e isolamento por agente. O contrato documental e validado por:

```bash
npm run test:multiagent-operations-runbook
```

Nao rode scan de PII/secrets a cada alteracao. Rode auditoria final quando estiver fechando release ou quando for explicitamente pedido.

## Integracoes Externas

IdP corporativo, auditoria central, diretorio corporativo, registries externos e LangSmith gerenciado continuam opcionais ou dependentes do ambiente do operador. Status e exports nao devem expor URL sensivel, token, header, payload bruto ou secret.

O contrato de homologacao real esta em `docs/external-integrations-homologation.md` e e validado por:

```bash
npm run test:external-integrations-homologation
```
