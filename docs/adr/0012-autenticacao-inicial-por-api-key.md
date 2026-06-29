# Autenticação inicial por API key

O baseline e os runtimes gerados devem suportar autenticação simples por chave de API em header, desativável em desenvolvimento e testes. Esse padrão é suficiente para o uso inicial esperado, em que agentes rodam em rede local ou são consumidos por aplicações próprias, sem introduzir OAuth, usuários, permissões ou multi-tenant no MVP.
