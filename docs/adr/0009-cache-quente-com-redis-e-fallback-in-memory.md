# Cache quente com Redis e fallback in-memory

O runtime gerado deve incluir uma camada de cache quente para acelerar turnos e reduzir consultas repetidas ao banco, usando Redis em ambientes compartilhados e fallback in-memory para desenvolvimento e testes. O cache não é fonte de verdade: em cache miss, o runtime deve reconstruir contexto recente a partir do checkpointer PostgreSQL e das tabelas públicas.

## Consequences

O baseline deve exercitar cache quente, invalidação por TTL e fallback in-memory, sem tornar Redis obrigatório para a correção do agente.
