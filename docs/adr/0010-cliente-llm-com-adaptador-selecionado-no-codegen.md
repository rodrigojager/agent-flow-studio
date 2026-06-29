# Cliente LLM com adaptador selecionado no codegen

O runtime gerado deve chamar modelos por uma interface `LLMClient`, e o codegen deve incluir apenas o adaptador de LLM selecionado para aquele agente ou bundle. O catálogo do builder pode conhecer vários adaptadores, como OpenAI/OpenAI-compatible, OpenRouter ou alternativas futuras, mas o artefato gerado não deve carregar adapters não usados.

## Consequences

Trocar de provedor deve exigir regenerar/recompilar o runtime com outro adaptador já suportado pelo codegen, sem reescrever os nós do agente. A configuração pode existir em três níveis, com precedência de manifesto de agrupamento, override do fluxo de agente e override do nó quando necessário. O baseline implementa OpenAI/OpenAI-compatible primeiro, com mock determinístico, retries, leitura de prompt Markdown e eventos de chamada.
