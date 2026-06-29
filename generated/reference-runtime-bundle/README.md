# Reference Runtime

Bundle gerado a partir de `runtime.manifest.json`.

## Empacotamento

- ID: `reference-runtime`
- Versão: `0.1.0`
- Modo: `monoagent`

## Agentes

- `reference-interview`: `reference-interview`, rota `/`, runtime `agents/reference-interview`

Cada subdiretório em `agents/` contém um runtime FastAPI independente gerado a partir do respectivo `agent.flow.json`. O próximo passo do suporte multiagente é compor esses agentes em um único processo FastAPI compartilhado quando `packaging` for `multiagent`.
