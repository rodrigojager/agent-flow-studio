# Autenticação Do Runtime

O runtime manual e o runtime gerado já possuem autenticação local por API key em `X-Agent-API-Key`, desativável por `AUTH_ENABLED=false` em dev/test.

A primeira camada avançada também já existe:

- `AGENT_API_KEY` continua como chave legada de acesso total;
- `AGENT_API_KEYS` permite múltiplas chaves;
- `AGENT_API_KEYS` aceita JSON object, JSON array ou lista simples separada por vírgulas;
- `AGENT_API_KEYS_PATH` permite carregar um JSON local de chaves, com suporte a `{ "keys": [{ "id": "...", "key": "...", "scopes": [...] }] }`, itens `enabled=false` e rotação local sem rebuild/restart;
- objetos de chave aceitam `expires_at` ou `expiresAt` em ISO 8601 ou timestamp Unix para expiração local;
- `AGENT_API_REVOKED_KEY_IDS` e `AGENT_API_REVOKED_KEY_IDS_PATH` permitem revogação local persistente por `key_id` simples ou qualificado por origem, como `AGENT_API_KEYS_PATH:reader`;
- cada chave pode declarar escopos globais como `metadata:read`, `auth:read`, `sessions:read`, `sessions:write`, `jobs:read`, `jobs:write`, `sessions:*` ou `*`;
- bundles multiagente podem limitar a permissão ao agente atual com scopes `agents:<agent_id>:metadata:read`, `agents:<agent_id>:sessions:*`, `agents:<agent_id>:jobs:*`, `agents:<agent_id>:auth:read` ou `agents:<agent_id>:*`;
- metadata, sessões e jobs validam o escopo mínimo da rota por header `X-Agent-API-Key`;
- SSE de eventos e WebSockets de eventos/turno aceitam a chave por header ou query `api_key`, para cobrir clientes de navegador que não enviam header customizado nesses transportes.
- `GET /auth/keys` lista `agent_id`, `key_id`, origem, scopes, metadados de expiração e status de revogação sem expor o valor bruto da chave;
- `AUTH_RATE_LIMIT_ENABLED=true` ativa rate limit local em memória por origem, chave e escopo;
- `AUTH_AUDIT_ENABLED=true` mantém trilha local de acessos permitidos, rejeitados e limitados, exposta por `GET /auth/audit` com escopo `metadata:read`;
- `AUTH_AUDIT_PATH=.agent-flow/auth-audit.jsonl` ativa persistência local append-only em JSONL, recarregada no startup para preservar a janela recente;
- a auditoria registra `key_id` derivado e nunca o valor bruto da chave.
- o Studio Local envia `X-Agent-API-Key` nas chamadas HTTP quando `STUDIO_RUNTIME_API_KEY` ou `AGENT_API_KEY` está configurada em `Secrets locais`, adiciona `api_key` em SSE/WebSocket de eventos e WebSocket de turno, o painel `Chaves de auth` consulta `/auth/keys`, resume ativas/expiradas/revogadas, exporta inventário `.afauthkeys.json` governado sem valores brutos/caminhos locais e prepara `AGENT_API_REVOKED_KEY_IDS` para o próximo start, e o painel `Auditoria de auth` consulta `/auth/audit` visualmente.

Exemplo:

```env
AUTH_ENABLED=true
AGENT_API_KEY=
AGENT_API_KEYS={"reader-key":["metadata:read","sessions:read"],"operator-key":["sessions:*"],"job-key":["jobs:*"]}
AGENT_API_KEYS_PATH=.agent-flow/api-keys.json
AGENT_API_REVOKED_KEY_IDS=
AGENT_API_REVOKED_KEY_IDS_PATH=.agent-flow/revoked-api-keys.json
AUTH_RATE_LIMIT_ENABLED=true
AUTH_RATE_LIMIT_REQUESTS=60
AUTH_RATE_LIMIT_WINDOW_SECONDS=60
AUTH_AUDIT_ENABLED=true
AUTH_AUDIT_PATH=.agent-flow/auth-audit.jsonl
```

Melhorias futuras a considerar:

- rotação governada de chaves além dos arquivos locais;
- políticas multiusuário para administrar escopos por agente em bundles;
- autenticação mútua entre serviços;
- JWT assinado por aplicação cliente;
- integração com OAuth/OIDC;
- rate limit distribuído/persistente por consumidor;
- auditoria centralizada por credencial fora do processo local;
- modo multi-tenant com segregação de dados.

Essas melhorias não devem bloquear o baseline atual, mas o contrato e o middleware devem continuar evitando acoplamento que impeça evolução posterior.

## Autenticação Do Builder

O Builder API também possui uma camada local própria, separada da autenticação do runtime final.

Já existe:

- `AGENT_FLOW_BUILDER_AUTH_REQUIRED=true` para proteger rotas não públicas;
- chaves locais por `AGENT_FLOW_BUILDER_API_KEY`, `AGENT_FLOW_BUILDER_API_KEYS` ou `AGENT_FLOW_BUILDER_API_KEYS_PATH`;
- rotação/revogação local por arquivo com hash da chave e valor bruto retornado uma única vez;
- sessão curta em `/builder-auth/session`, com token `afbs_*` armazenado apenas por hash em memória;
- auditoria local em `/builder-auth/audit`, com persistência JSONL opcional por `AGENT_FLOW_BUILDER_AUTH_AUDIT_PATH`;
- sink HTTP central opcional de auditoria por `AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_URL`, com `AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_TOKEN` enviado só ao sink, timeout por `AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_TIMEOUT_MS`, payload versionado `agent-flow-builder.builder-auth-audit-sink-event.v1` e envio sem chave bruta, token de sessão ou headers da requisição;
- JWT local inicial em `Authorization: Bearer`, assinado por `AGENT_FLOW_BUILDER_AUTH_JWT_SECRET` (`HS256`), `AGENT_FLOW_BUILDER_AUTH_JWT_PUBLIC_KEY` (`RS256`) ou JWKS por `AGENT_FLOW_BUILDER_AUTH_JWT_JWKS_PATH`/`AGENT_FLOW_BUILDER_AUTH_JWT_JWKS_URL`;
- seleção de chave JWKS por `kid`, cache de URL por `AGENT_FLOW_BUILDER_AUTH_JWT_JWKS_CACHE_SECONDS` e status governado sem material público bruto;
- discovery OIDC inicial por `AGENT_FLOW_BUILDER_AUTH_OIDC_ISSUER_URL` ou `AGENT_FLOW_BUILDER_AUTH_OIDC_DISCOVERY_URL`, lendo `.well-known/openid-configuration`, resolvendo `jwks_uri`, cacheando metadata e usando o `issuer` descoberto quando nenhum issuer manual foi configurado;
- login OIDC local por authorization code + PKCE com `POST /builder-auth/oidc/login-url` e `GET /builder-auth/oidc/callback`, usando `AGENT_FLOW_BUILDER_AUTH_OIDC_CLIENT_ID`, `AGENT_FLOW_BUILDER_AUTH_OIDC_REDIRECT_URI`, `AGENT_FLOW_BUILDER_AUTH_OIDC_CLIENT_SECRET` opcional, `AGENT_FLOW_BUILDER_AUTH_OIDC_SCOPES`, endpoints descobertos ou overrides `AGENT_FLOW_BUILDER_AUTH_OIDC_AUTHORIZATION_ENDPOINT`/`AGENT_FLOW_BUILDER_AUTH_OIDC_TOKEN_ENDPOINT`, validação de state/nonce/id_token, sessão local `afbs_*` e armazenamento temporário apenas em memória do `id_token` como hint de logout da sessão;
- refresh OIDC de sessão por `POST /builder-auth/oidc/session/refresh`, usando o `refresh_token` apenas em memória no backend, rotacionando a sessão `afbs_*`, validando o novo `id_token` e sem retornar refresh token ao navegador;
- persistência central local de sessões por `AGENT_FLOW_BUILDER_AUTH_SESSION_PATH`, armazenando apenas hash de token e metadados da identidade, sem token `afbs_*` bruto, `id_token`, `refresh_token` ou chave local;
- sync HTTP opcional de lifecycle de sessão por `AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_URL`, com token opcional `AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_TOKEN`, timeout `AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_TIMEOUT_MS`, eventos `created`/`refreshed`/`revoked` no formato `agent-flow-builder.builder-auth-session-service-event.v1` e envio apenas de hash de sessão/metadados sem token `afbs_*` bruto ou tokens do provedor;
- introspecção/decisão central de sessão por `AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_URL`, com token opcional `AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_TOKEN`, timeout `AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_TIMEOUT_MS` e modo fail-closed por `AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_REQUIRED=true`, enviando apenas hash de sessão e metadados locais para permitir decisão central e override seguro da identidade efetiva;
- logout OIDC federado avançado por `POST /builder-auth/oidc/logout-url` e `GET /builder-auth/oidc/logout-callback`, lendo `end_session_endpoint` do discovery ou `AGENT_FLOW_BUILDER_AUTH_OIDC_END_SESSION_ENDPOINT`, usando `AGENT_FLOW_BUILDER_AUTH_OIDC_POST_LOGOUT_REDIRECT_URI` quando definido, enviando `id_token_hint` quando a sessão OIDC local possui hint em memória, validando state no retorno e encerrando a sessão local;
- validação opcional de `AGENT_FLOW_BUILDER_AUTH_JWT_ISSUER` e `AGENT_FLOW_BUILDER_AUTH_JWT_AUDIENCE`;
- claims configuráveis para ator, nome, papel, grupos corporativos, áreas e scopes por `AGENT_FLOW_BUILDER_AUTH_JWT_*_CLAIM`, incluindo `AGENT_FLOW_BUILDER_AUTH_JWT_GROUPS_CLAIM`;
- políticas locais por grupo em `AGENT_FLOW_BUILDER_AUTH_GROUP_POLICIES` ou `AGENT_FLOW_BUILDER_AUTH_GROUP_POLICIES_PATH`, permitindo mapear grupos corporativos para papel, áreas e scopes efetivos sem armazenar tokens do provedor;
- diretório local de grupos em `AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY` ou `AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_PATH`, permitindo enriquecer grupos por ator antes da aplicação das políticas locais de grupo;
- diretório corporativo HTTP opcional em `AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_URL`, com token opcional `AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_TOKEN`, timeout `AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_TIMEOUT_MS`, payload no mesmo formato do diretório local e status sem expor URL/token;
- `/builder-auth/status` mostra o estado JWT/JWKS/OIDC/login/logout sem expor segredo, chave pública bruta ou token;
- a aba `Governança` mostra o status JWT/JWKS/OIDC, habilita `Entrar OIDC` e `Sair OIDC` quando o servidor está configurado, recebe o callback por popup/postMessage, salva apenas a sessão local e remove qualquer chave bruta salva no navegador.

Já existe renovação/logout local da sessão `afbs_*` do Builder, com rotação de token, revogação do token antigo, persistência central local hash-only opcional, sync HTTP opcional de lifecycle de sessão, introspecção/decisão central fail-closed opcional e encerramento hash-only no backend. Também existe refresh OIDC de sessão com refresh token apenas em memória, logout federado OIDC com `id_token_hint` de sessão em memória, callback de logout validado por state, sincronização inicial de grupos corporativos a partir de JWT/OIDC/local key, diretório local e HTTP externo de grupos, política local por grupo para role/áreas/scopes efetivos e sink HTTP opcional de auditoria externa por identidade/chave sem payload bruto. Ainda falta validar essa camada contra um IdP/serviço corporativo real e ampliar operação multiusuário distribuída fora do processo local do Builder.

Exemplo mínimo:

```env
AGENT_FLOW_BUILDER_AUTH_REQUIRED=true
AGENT_FLOW_BUILDER_AUTH_OIDC_ISSUER_URL=https://issuer.example.com
AGENT_FLOW_BUILDER_AUTH_OIDC_CLIENT_ID=agent-flow-builder
AGENT_FLOW_BUILDER_AUTH_OIDC_CLIENT_SECRET=
AGENT_FLOW_BUILDER_AUTH_OIDC_REDIRECT_URI=http://127.0.0.1:3333/builder-auth/oidc/callback
AGENT_FLOW_BUILDER_AUTH_OIDC_SCOPES=openid profile email
AGENT_FLOW_BUILDER_AUTH_JWT_ALGORITHMS=RS256
AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_URL=
AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_TOKEN=
AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_URL=
AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_TOKEN=
AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_URL=
AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_TOKEN=
AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_REQUIRED=true
AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_URL=
AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_TOKEN=
```
