# Persistência dupla com checkpointer e tabelas públicas

O runtime gerado deve usar o checkpointer PostgreSQL do LangGraph como fonte de verdade do estado executável do grafo, enquanto tabelas próprias da API mantêm sessões, transcript, eventos e idempotência como contrato público. Essa divisão evita duplicar todo o estado interno do grafo nas tabelas da API e, ao mesmo tempo, preserva dados necessários para integração, auditoria, depuração e reenvio seguro de operações mutáveis.

## Consequences

O baseline deve provar a integração entre checkpointer PostgreSQL e tabelas próprias. O estado público pode conter projeções como status, fase, último nó e timestamps, mas não deve tentar substituir o checkpoint do LangGraph.
