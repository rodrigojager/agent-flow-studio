# Validar codegen contra baseline de geração

O agente de referência manual deve virar um baseline de geração para validar o `agent.flow.json`, o codegen e, depois, o editor visual. O objetivo é que o projeto gerado seja equivalente ao baseline por transformação da especificação, sem copiar diretamente os arquivos do baseline como atalho.

## Consequences

Os testes do codegen devem comparar estrutura, contratos, prompts, schemas, endpoints e comportamento observável do runtime gerado contra o baseline, permitindo diferenças mecânicas apenas quando forem explicitamente justificadas.
