# Separar criação de sessão e início do fluxo

O contrato canônico deve separar `POST /sessions`, que cria a sessão, de `POST /sessions/{session_id}/start`, que inicia a execução do fluxo. O builder pode configurar início automático na criação quando a API desejada for mais simples, mas essa opção deve ser explícita para não tornar ambíguo se uma chamada apenas reservou estado ou também executou o agente.
