# Flow Spec canônico em Zod/TypeScript

O Flow Spec deve ter uma fonte canônica em Zod/TypeScript e exportar JSON Schema para validações fora do ecossistema TypeScript. Manter schemas paralelos em Zod e Pydantic para a mesma especificação aumentaria o risco de divergência entre builder, codegen e runtime gerado.

## Consequences

O Python gerado deve consumir artefatos derivados, como JSON Schema, quando precisar validar `agent.flow.json`. Mudanças no formato intermediário devem partir do pacote TypeScript do Flow Spec.
