# Idempotência explícita, não derivada de chave de negócio

As APIs geradas devem tratar idempotência por uma chave técnica própria enviada pelo consumidor, e não por chaves de negócio como aluno, aula, inscrição, referência ou contexto externo. Chaves de negócio podem participar da regra do agente, mas não devem ser usadas implicitamente para deduplicar criação de sessão, envio de turno ou outras operações com efeitos persistentes.

## Consequences

Os contratos gerados precisam expor idempotência nas operações mutáveis relevantes, preferencialmente pelo header `Idempotency-Key` e com fallback pelo campo `idempotency_key` no corpo JSON. O runtime deve normalizar os dois formatos para uma única chave, rejeitar a requisição quando header e corpo conflitarem, e persistir a resposta associada a essa chave para retornar o mesmo resultado em reenvios.
