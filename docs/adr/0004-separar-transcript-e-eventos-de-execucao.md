# Separar transcript e eventos de execução

O contrato canônico deve expor `transcript` para mensagens conversacionais e `events` para a trilha operacional da sessão. Essa separação evita misturar histórico visível ao consumidor com detalhes de depuração, execução de nós, decisões determinísticas, chamadas de LLM, safety, retries e erros.
