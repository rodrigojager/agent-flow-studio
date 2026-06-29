# Melhorias Futuras de Autenticação

O MVP usa chave de API simples por header para proteger runtimes gerados. Essa escolha atende o cenário inicial de consumo por aplicações próprias em rede local ou ambiente controlado.

Melhorias futuras a considerar:

- múltiplas chaves por consumidor;
- rotação e expiração de chaves;
- escopos por agente, endpoint ou operação;
- autenticação mútua entre serviços;
- JWT assinado por aplicação cliente;
- integração com OAuth/OIDC;
- rate limit por consumidor;
- auditoria por credencial;
- modo multi-tenant com segregação de dados.

Essas melhorias não devem bloquear o baseline, mas o contrato e o middleware devem evitar acoplamento que impeça evolução posterior.
