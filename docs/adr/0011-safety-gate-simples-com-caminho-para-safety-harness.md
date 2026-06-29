# Safety Gate simples com caminho para Safety Harness

O baseline deve incluir um Safety Gate simplificado e determinístico para entrada e saída, suficiente para provar bloqueio, resposta segura, eventos e decisão de não chamar o LLM. A arquitetura deve, porém, preservar um caminho para integrar um Safety Harness completo no futuro, mesmo que isso exija reformular a camada de implementação ou separá-lo como produto/componente próprio.

## Consequences

O MVP não deve copiar todo o safety harness da referência, mas o formato de fluxo e o codegen não podem assumir que safety será apenas uma lista simples de palavras ou regras locais.
