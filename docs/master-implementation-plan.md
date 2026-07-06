# Plano Mestre: Agent Flow Builder, Studio Local e API Docker

Data: 2026-06-30.

Este e o plano consolidado do produto a partir do que ja foi implementado, das decisoes de arquitetura, da pesquisa de LangSmith/n8n/Fleet, dos screenshots logados e das decisoes de UI/UX registradas em `docs/ux/`.

Nota de status: o MVP principal do fluxo local (`Desenhar -> Testar -> Depurar -> Aprovar -> Gerar API Docker`) esta 100% verificado. As pendencias abaixo pertencem ao plano completo expandido e nao reduzem esse marco.

## Objetivo Final

Construir uma ferramenta local completa para criar, testar, depurar, aprovar e empacotar agentes de IA como APIs Docker independentes.

Fluxo principal:

```text
Desenhar -> Testar -> Depurar -> Aprovar -> Gerar API Docker
```

O usuario deve conseguir trabalhar em uma unica interface, sem precisar aprender LangGraph manualmente, abrir terminal, usar LangSmith Cloud ou alternar entre ferramentas para completar o caminho principal.

## Norte do Produto

O Agent Flow Builder nao e um clone de LangSmith, n8n ou Fleet. Ele deve se inspirar profundamente nos padroes que funcionam nesses produtos, mas resolver um objetivo proprio:

- criar agente visualmente;
- gerar codigo executavel;
- testar em sandbox local;
- observar runs, state, node IO, transcript, events e logs;
- aprovar uma versao por hash;
- gerar runtime FastAPI/Docker removivel da ferramenta;
- rodar a API final de forma independente.

## Base Ja Implementada

Ja existe uma base funcional importante:

- Flow Spec em TypeScript/Zod.
- Flow de referencia em `flows/reference-interview/agent.flow.json`.
- Baseline manual FastAPI/LangGraph.
- Codegen TypeScript para runtime Python/FastAPI.
- Codegen para sandbox LangGraph compatível.
- Codegen multiagente inicial por `runtime.manifest.json`.
- Editor visual de `runtime.manifest.json` na aba `Runtime`, com metadata, LLM padrão, empacotamento, agentes, prefixos de rota, composição assistida multiagente, orquestração declarativa por entrada/handoffs e política visual de memória compartilhada.
- Mapa operacional inicial de bundle multiagente na aba `Runtime`, com app raiz, rotas montadas, runtime por agente e endpoints resolvidos pela validação.
- Identidade operacional inicial por agente com `agent_id` em `/metadata`, sessão, eventos, runs locais, resumo por agente e timeline filtrável no Studio.
- Builder API para flows, assets, validacao, artefatos, import/export, manifest e geracao.
- Builder UI inicial com React Flow, canvas, inspector, arquivos, validacao, artefatos e runtime.
- Suporte visual e runtime inicial para nodes avancados:
  - `http_request`;
  - `transform_json`;
  - `database_query`;
  - `database_save`;
  - `file_extract`;
  - `rag_retrieval`;
  - `approval_gate`;
  - `scoring`;
  - `analytics`.
- Sandbox local inicial com start/stop, logs e chamadas de sessao/turn/transcript/events.
- Streaming de eventos no runtime manual e gerado por SSE em `/events/stream` e por WebSocket em `/events/ws`, reaproveitando `from_seq`, limite de eventos, timeout e evento de fechamento controlado.
- Streaming do turno por SSE em `/turn/stream` e WebSocket em `/turn/stream/ws`, reaproveitando o mesmo payload/idempotência de `/turn`, emitindo `turn_started`, `token`, `turn_completed` e `stream_closed`, e usando callback incremental do grafo/LLM quando disponível com fallback por resposta final.
- Studio Local possui consumo visual inicial desses streams, com painel `Eventos ao vivo`, transporte selecionável WebSocket/SSE, conexão/desconexão manual e atualização incremental da timeline por `seq`.
- Studio Local consome visualmente `turn/stream` no envio de turno, mostrando `Resposta em streaming`, contador de tokens, origem dos chunks, texto incremental, conclusão e erro antes de atualizar transcript/events/run local.
- Primeira camada de jobs pós-finalização no runtime manual e gerado, com persistência em `agent_jobs`, criação de `post_finish_summary` ao finalizar sessão, `max_attempts`, `last_error`, `next_run_at`, claim/lease multiworker por `worker_id`, `locked_until` e `WORKER_LEASE_SECONDS`, retomada após lease expirado, métricas agregadas e operacionais (status/tipo, pendências, tentativas, taxa de sucesso, duração média/mínima/máxima, leases ativos/expirados, finalizações na última hora e último término), endpoints locais de consulta/execução/retry/schedule manual por job, recorrência por intervalo/cron/evento com `POST /job-schedules/trigger-event`, retenção governada por `POST /jobs/cleanup` com prévia `dry_run`, endpoints nativos de lote `POST /jobs/run-pending` e `POST /jobs/retry-failed`, worker CLI opcional `python -m app.worker --once`, serviço `worker` no Docker Compose final com `WORKER_CLEANUP_*` para cleanup automático governado desligado por padrão, eventos de pendência/conclusão/schedule/evento/retry/falha/limpeza e painel visual no Studio para métricas, escopo sessão/todos, filtro por status, payload, resultado, erro, histórico local/compartilhável/exportável/comparável/sincronizável de snapshots `.afjobmetrics.json`/`.afjobmetrics-diff.json`, execução/reprocessamento/reagendamento/limpeza individual e lote via UI.
- `/metadata` do runtime manual, gerado e bundle gerado agora publica `operations.jobs`, tornando explícita a política operacional de worker, lease, retenção/cleanup, status terminais e schedules sem expor secrets ou valores brutos de ambiente.
- Runtime manual e gerado aplicam migrações aditivas leves no startup quando `AUTO_CREATE_TABLES=true`, permitindo que o container final suba contra volumes PostgreSQL persistentes de versões anteriores sem quebrar por colunas novas como `agent_id` e campos de `agent_jobs`.
- O runtime gerado serializa criação/migração de schema em PostgreSQL com `pg_advisory_xact_lock`, evitando corrida de inicialização entre API e worker no Docker Compose.
- Artefato LangGraph separado com `langgraph.json`.
- Hash deterministico de projeto em `.agent-flow/generated-meta.json`.
- Aprovacao de sandbox e bloqueio de runtime aprovado se o hash mudou.
- Container final validado com Docker Compose, Postgres, Redis, worker de jobs, `/health`, `/docs`, transcript, events e stream de eventos SSE/WebSocket.
- Em 2026-07-03, o runtime gerado `generated/reference-interview-runtime` foi reconstruído e validado em Docker real; em 2026-07-04, o mesmo gate foi repetido no workspace atual com `/health`, `/metadata`, sessão, start, turn, transcript, events, finish e `GET /jobs?session_id=...`; o job pós-finalização terminou como `succeeded` e os logs não mostraram erros de schema nem tentativa de envio ao LangSmith Cloud. Esse caminho está codificado em `npm run test:docker-runtime-smoke`.
- Builder API/UI ja possuem primeira camada operacional para o runtime Docker final aprovado: status, preparo de `.env`, build, compose up/down, smoke HTTP, inspeção `docker compose ps/logs`, Runtime URL local configuravel, histórico operacional local, auto-refresh opt-in, logs recentes e links para `/docs` e `/openapi.json` no painel de artefato.
- Documentacao UX consolidada em `docs/ux/`.

## Decisoes Que Devem Guiar Tudo

### Local-first

O fluxo principal deve funcionar sem LangSmith Cloud, sem `LANGSMITH_API_KEY` obrigatoria e sem billing externo.

LangGraph/LangSmith continuam como compatibilidade opcional:

- gerar pacote compatível;
- permitir `langgraph dev`;
- permitir Studio oficial se o usuario quiser;
- gerar handoff local governado `.aflangsmithhandoff.json` com checklist/status, registrar evidência local `.aflangsmithdeployments.json` e sincronizar opcionalmente esses registros com central HTTP, sem chamar cloud nem salvar token.

Mas o fluxo principal e nosso Studio Local.

### Runtime Final Independente

O produto final nao e o builder. O produto final e uma API FastAPI/Docker independente, com contrato HTTP claro.

O runtime final deve:

- rodar separado do Builder;
- incluir OpenAPI/Swagger;
- manter estado entre turnos;
- preservar transcript e events;
- carregar apenas adapters/configs necessarios;
- conter comprovante de aprovacao quando gerado por versao aprovada.

### UI Operacional

A interface deve ser uma ferramenta operacional, nao uma landing page e nao uma plataforma cloud generica.

Regras:

- shell persistente;
- top bar compacta;
- sidebar/rail com grupos claros;
- canvas como superficie principal;
- paineis contextuais;
- split panes para trabalho tecnico;
- empty states com proxima acao;
- tooltips em botoes icon-only;
- validacao inline;
- tema claro e escuro em todas as telas.

### WYSIWYG Primeiro, JSON Como Escape Hatch

Configuracoes comuns precisam ter caminho visual:

- prompts;
- schemas;
- tools;
- LLM/provider/modelo;
- env vars;
- files/RAG;
- integracoes;
- approval;
- runtime.

JSON/YAML/source continuam disponiveis para usuarios avancados, mas nao substituem a experiencia visual.

### Sem Teto Visual De Capacidade

A edicao visual nao pode virar uma prisao. Ela deve acelerar o caso comum, mas nunca reduzir o que o usuario ja consegue criar manualmente fora da ferramenta.

O runtime atual decidido no projeto e Python/FastAPI/LangGraph, enquanto builder, validacao e codegen ficam em TypeScript. Essa e uma decisao de implementacao atual, nao uma restricao permanente de produto.

Regra de produto:

- todo comportamento importante precisa ser representavel por no visual, codigo customizado, tool externo, sidecar ou runtime futuro;
- se uma regra nao couber em um no visual, deve existir um escape hatch claro;
- o escape hatch deve ter input/output tipado, logs, trace, teste local e entrar no hash de aprovacao;
- o usuario nao deve precisar editar manualmente o runtime gerado depois da exportacao para recuperar capacidade;
- codigo Python, JavaScript, TypeScript e Bash/Shell podem ser caminhos nativos do runtime atual;
- codigo em outra linguagem deve ser suportavel por HTTP, sidecar, MCP ou adapter de runtime.

O no `code` deve funcionar como comportamento customizado com contrato explicito. O contrato inicial ja foi incorporado ao Flow Spec, Builder UI e Codegen LangGraph: linguagem, modo de execucao, arquivo, entry point, dependencias, input path, result path, codigo inline, executor HTTP, MCP stdio, sidecar local e `runtime_adapter`. O runtime gerado ja executa Python nativo por arquivo/inline, JavaScript/TypeScript por arquivo/inline via runner Node e Bash/Shell por arquivo/inline via processo com JSON por stdin/stdout; executa `codeExecution: "http"` como adapter externo por contrato JSON, executa `codeExecution: "mcp"` como chamada `tools/call` a servidor MCP local via stdio, executa `codeExecution: "sidecar"` como subprocesso local com JSON por stdin/stdout e executa `codeExecution: "runtime_adapter"` por endpoint de adapter com payload `input/context/contract/adapter` ou pelo runner VM local quando `sandboxIsolation="vm"` e o adapter declara `codeInline`/`codePath`. O codegen copia assets de `codePath` para `app/code/`, inclui esses arquivos no hash de aprovacao, instala Bash/Node/NPM no Dockerfile final, materializa dependencias npm quando aplicavel e registra `custom_code_executed`, `custom_code_declared` ou `custom_code_failed` com `execution_log` e `span` estruturados para o Studio Local. Para executores externos, o contrato tambem ja cobre `retryAttempts`, `payloadAllowPaths`, `redactPaths` e `maxPayloadBytes`, com allowlist de estado, redaction antes do envio, bloqueio por tamanho e metadados de tentativas/payload no trace. O inspector de nós `code` também possui biblioteca local de perfis de sandbox/payload, exportável/importável como `.afcodesandbox.json`, para reutilizar isolamento, env allowlist, retry, allowlist, redaction, payload máximo, imagem/engine de container, imagem gerenciada por executor, preset gerenciado de VM e timeout sem guardar secrets ou URLs. Cada execução customizada também registra `custom.sandbox`/`sandbox_*` para identificar se rodou em `runtime_process`, `dedicated_process`, `shell_process`, `node_runner_process`, `subprocess_stdio`, `external_endpoint`, `declared_external`, `container` ou `vm`; o Studio usa isso no Tool manager, filtro de logs e export JSON. A primeira camada de isolamento executável por no ja permite `sandboxIsolation: "ephemeral_workspace"` para executores process-backed (`sidecar`, `mcp`, Bash/Shell e JavaScript/TypeScript via runner Node), criando uma cópia temporária de `app/code`, executando com `cwd` nessa cópia, aplicando `sandboxEnvAllowlist` quando configurada e descartando escritas depois da execução. Para Python e Bash/Shell `native`/`inline`/`file`, `sandboxIsolation: "dedicated_process"` chama outro processo por stdin/stdout JSON, com workspace temporário, env allowlist e descarte das escritas do worker. Para Python, JavaScript, TypeScript e Bash/Shell `native`/`inline`/`file`, `sandboxIsolation: "container"` executa o worker em `docker`/`podman` com `--network none`, workspace temporário montado em `/workspace`, imagem/engine configuráveis por preset gerenciado ou campo manual, runner Python, `code_runner.mjs`/Node ou Bash/Shell conforme a linguagem e falha rastreável quando a imagem ou engine estiver indisponível.

Atualização 2026-07-02: a primeira camada de `sandboxIsolation: "container"` já existe para nós `code` Python/JavaScript/TypeScript/Bash-Shell `native`/`inline`/`file`, com `sandboxContainerImage`, `sandboxContainerEngine`, `sandboxContainerImageId`, presets gerenciados iniciais no Studio, preset `bash:5.2`, fallback por env `AGENT_FLOW_CODE_CONTAINER_IMAGE`/`AGENT_FLOW_CODE_CONTAINER_ENGINE`, execução `docker`/`podman` com `--network none`, workspace temporário montado em `/workspace`, env allowlist e falha rastreável quando imagem/engine não estiverem disponíveis. O Studio também possui a primeira camada de orquestração avançada de container por `sandboxContainerProfile=baseline|hardened`, limites de memória/CPU/PIDs, rootfs read-only, cap-drop e no-new-privileges, além da primeira camada de `sandboxIsolation: "vm"` como ponte para runner local por contrato `agent-flow-vm-runner.v1`, com `sandboxVmImageId`, `sandboxVmRunner`, `sandboxVmArgs`, `sandboxVmRunnerManifest`, `sandboxVmImage`, `sandboxVmImageManifest`, `sandboxVmEngine`, presets gerenciados iniciais de VM para Python/Node, checker local de runner/imagem/manifestos VM sem executar código do usuário, validação de protocolo, engine, imageId, tamanho declarado, SHA-256 opcional e capabilities hardened, export governado `.afvmreadiness.json` sem paths locais resolvidos, scaffold QEMU com cloud-init/build/boot/transportador SSH, scaffold microVM direct-kernel com preparo rootfs/kernel ou firmware/seed, política hardened e preflights Firecracker/Cloud Hypervisor, smoke real Docker/QEMU com cloud image Debian, gate microVM real opt-in para Firecracker/Cloud Hypervisor com dry-run, preflight real e boot launch smoke quando binários/artefatos são fornecidos, contrato de homologação `.afvmhomologation.json` com estados `blocked`, `preflight_verified` e `homologated`, receita oficial local `vm-image:microvm-recipe`, registro consumível `vm-image:microvm-register`, pacote `.afvmimagebundle` com manifestos sanitizados, imagem, artefatos obrigatórios de boot e manifesto de política copiados/verificados, `runner-kit` portátil auto-verificável, scripts de ambiente para `AGENT_FLOW_CODE_VM_BOOT_ARTIFACTS`/`AGENT_FLOW_CODE_VM_SEED_IMAGE`/`AGENT_FLOW_MICROVM_POLICY_MANIFEST`, runner de referência opt-in para contrato Python local, runner QEMU de preflight com plano Q35/microVM, runner Firecracker/Cloud Hypervisor de preflight direct-kernel e enforcement de política hardened, transporte externo explícito para guest, fail-closed quando o runner não prova `providesVmIsolation=true` e guest agent Python embutível na imagem VM, perfil, memória/vCPU e trace `vm`/`microvm`, incluindo execução Python, JavaScript, TypeScript e Bash/Shell pelo runner VM. A telemetria histórica de sandbox por flow agrega runs locais por nó/modo/isolamento/orquestração/executor/transporte/assurance/imagem/engine/rede/perfil/política, contadores de container, VM, microVM, hardening e isolamento VM verificado, com filtro de falhas e export governado `.afsandboxtelemetry.json` sem eventos brutos, state bruto, envs, secrets ou arquivos do workspace isolado. O pendente agora é executar/publicar artefato binário microVM real a partir da receita e evoluir políticas ainda mais fortes de orquestração.

### Observabilidade Estruturada

Logs nao bastam. Toda run local precisa gerar evidencia estruturada:

- node executado;
- input;
- output;
- eventos;
- transcript;
- state snapshot/diff;
- erro;
- duracao;
- prompt renderizado;
- resposta bruta de LLM;
- tokens/custo quando disponivel.

### Aprovacao Por Hash

Runtime Docker final so pode ser gerado a partir de uma versao aprovada.

O hash cobre:

- `agent.flow.json`;
- prompts;
- schemas;
- arquivos em `files/` usados pelo agente;
- manifest multiagente quando aplicavel;
- configuracoes de runtime que alteram comportamento.

Secrets reais nao entram no hash publico nem devem ser exportados sem acao explicita.

### Paridade ProUp Como Anti-Regressao

A API ProUp informada no inicio do desenvolvimento e o benchmark minimo de capacidade. A ferramenta deve conseguir recriar agentes/APIs desse nivel, mesmo que a implementacao interna seja diferente.

Capacidades que precisam continuar reproduziveis:

- API conversacional baseada em sessoes;
- criar, iniciar, processar turno, finalizar, consultar transcript e consultar events;
- agente capaz de conduzir perguntas;
- agente capaz de consultar conteudo/contexto;
- agente capaz de gerar perguntas a partir de conteudo;
- prompts versionaveis em arquivos;
- LLM por adapter;
- mock de LLM;
- estado por conversa;
- idempotencia por mensagem;
- Postgres/SQLAlchemy ou persistencia equivalente;
- Redis opcional ou cache equivalente;
- safety;
- analises pos-finalizacao;
- testes automatizados;
- empacotamento como API independente.

Cada capacidade acima precisa mapear para um destes mecanismos:

- no visual nativo;
- comportamento customizado por codigo;
- HTTP/MCP/tool adapter;
- recurso de runtime;
- configuracao de manifesto;
- teste gerado.

Se uma capacidade ProUp nao tiver mapeamento claro, a fase correspondente nao pode ser considerada pronta.

Status Safety 2026-07-01:

- o Safety Gate simples evoluiu para a primeira camada de Safety Harness local configurável por nó;
- `safety_gate` aceita modo `default`, `custom` ou `default_and_custom`, threshold de severidade, resposta segura padrão e regras versionáveis com match `contains`/`regex`, categoria, severidade e ação `warn`/`safe_redirect`/`block`;
- o inspector possui biblioteca local de políticas de Safety com salvar, aplicar, remover, exportar e importar `.afsafety.json`, reutilizando modo, severidade, fallback e regras entre nós/workspaces;
- o runtime gerado aplica regras custom antes/depois do LLM conforme `stage`, registra metadados da regra acionada no payload de safety e mantém compatibilidade com o comportamento determinístico anterior;
- implementado no Builder: Safety Harness no inspector do nó, com avaliação local da política atual, provider HTTP externo opcional, histórico backend em `.agent-flow/safety-harness/runs.json`, rotas `GET /flows/:flowId/safety-harness/runs`, `POST /flows/:flowId/safety-harness/evaluate` e `PUT /flows/:flowId/safety-harness/runs/:runId/review`, além de revisão humana simples por run com identidade local visível/exportada e bloqueio backend de `viewer` quando há auth local/ator do Builder;
- implementado no Builder: dashboard local do Safety Harness por flow/nó, com taxa de bloqueio, pendências, origem local/externa, categorias recentes, último run, ação rápida para aceitar/rejeitar o próximo pendente do nó, export `.afsafetyhistory.json` com governança explícita sem input bruto/secrets, diff governado `.afsafetyhistory-diff.json` por referências/hashes sem `inputPreview`, `matchedText`, headers externos, payloads brutos de provider ou secrets, sync central opcional por `AGENT_FLOW_SAFETY_HARNESS_CENTRAL_URL` com ações `Central`/`Sync central`, token só no header, status sem URL/token, payload sanitizado sem `inputPreview`/`matchedText` e `resolutionHistory` compacta para divergências do mesmo run;
- implementado no runtime final: provider HTTP externo opcional por env vars `SAFETY_PROVIDER_*`, com request JSON contendo `text`, `stage`, `nodeId`, `policy` e decisão local, resposta com `blocked`/`decision`/`category`/`reason`/`safeResponse`/`severity`/`score`, fail-open por padrão, fail-closed opcional e metadados `source`/`provider_score`/`provider_error` no payload de safety;
- ainda ficam para fase avançada os dashboards dedicados de safety, auth/permissões multiusuário reais, aprovação compartilhada e auditoria contínua; a primeira governança central file-backed do workspace já existe para papéis, políticas, conflitos, auditoria local sem secrets, auth local opcional do Builder por API key com inventário, auditoria local sem chave bruta e rotação/revogação file-backed, checagem consultiva de autorização por ator/área/ação, enforcement local opcional nas mutações críticas de governança, catálogo, schemas, annotation queue, replay, safety, experimentos e entrega de runtime e enforcement por papel/área da auth local do Builder nas rotas protegidas.

## Superficies Do Produto

### 1. Shell Principal

Navegacao alvo:

```text
Flow | Studio Local | Artefatos | Runtime | Settings
```

Tambem podem existir entradas laterais para:

- Arquivos;
- Validacao;
- Runs;
- Cenarios;
- Catalogo local;
- Providers/Secrets.

Obrigatorio:

- manter flow/agente atual em contexto;
- mostrar estado salvo/sujo/valido/invalido/aprovado/desatualizado;
- preservar tema e layout localmente;
- impedir acoes bloqueadas sem explicar motivo.

### 2. Flow Builder WYSIWYG

Objetivo:

- criar e editar o `agent.flow.json` visualmente.

Deve incluir:

- canvas React Flow refinado;
- palette pesquisavel por objetivo;
- inspector por tipo de node;
- edicao visual de prompts;
- edicao visual de schemas;
- edicao visual de tools;
- no de comportamento customizado para regras que nao cabem em componentes visuais;
- conexoes/condicoes;
- grupos e notas;
- diagnosticos clicaveis;
- estados `dirty`, `stale`, `invalid`, `ready`.

Inspiracao aplicada:

- n8n para canvas, node controls, dirty nodes, execucao parcial e input/output.
- Fleet para blocos compactos de agente e acoes locais.

### 3. Agent Overview

Objetivo:

- mostrar o agente em alto nivel para usuarios entenderem o que falta configurar.

Blocos sugeridos:

- Entrada;
- Canais;
- Agente;
- Instrucoes;
- Ferramentas;
- Subagentes;
- Skills;
- Saida/API.

Importante:

- esta visao nao substitui o grafo executavel;
- ela e camada de orientacao e completude;
- cada bloco vazio precisa ter CTA ou motivo de bloqueio.

### 4. Arquivos

Objetivo:

- expor arquivos do workspace sem obrigar o usuario a editar JSON.

Deve incluir:

- prompts Markdown;
- schemas JSON;
- `agent.flow.json`;
- `runtime.manifest.json`;
- arquivos em `files/`;
- artefatos gerados;
- preview/source;
- validacao por arquivo.

### 5. Studio Local

Objetivo:

- testar, depurar e aprovar o agente localmente.

Layout alvo:

```text
Sessões/Runs | Grafo de Execução | Inspector
             | Timeline/Logs    |
```

Deve incluir:

- iniciar/parar sandbox local;
- criar sessao/thread;
- start/turn/finish;
- playground de payload/mensagem;
- transcript;
- events;
- grafo com status por node;
- timeline/waterfall;
- node IO;
- state inspector;
- logs correlacionados;
- replay basico;
- comparacao entre runs;
- aprovacao por hash.

Inspiracao aplicada:

- LangSmith Studio para graph/thread/run, input/output, tracing e debug.
- LangSmith trace viewer para waterfall, custo, tokens e inspector.
- n8n para pin/mock data e dirty/stale downstream.

### 6. Playground Integrado

Objetivo:

- iterar prompts, inputs, schemas e tools dentro do contexto do flow.

Deve incluir:

- prompt por blocos de role;
- variaveis detectadas;
- input form por schema;
- editor JSON como modo avancado;
- modelo/provider;
- output renderizado/raw;
- output schema;
- tool manager;
- secrets locais mascarados;
- Start/Turn/Finish;
- cenario salvo;
- pin/mock de dados.

Decisao:

- nao criar prompt marketplace publico no MVP;
- nao copiar o modelo de prompt commits publicos;
- manter versionamento local por hash/assets.

Status 2026-07-01:

- Studio Local ganhou entrada guiada por schema para turno, derivando `user_message`, campos top-level adicionais, grupos aninhados de objetos tipados e arrays de itens simples ou estruturados do schema de estado carregado, com validação simples por tipo, preview do payload real enviado ao runtime e persistência do payload extra em cenários/fixtures;
- Studio Local ganhou bloco de saída do turno em modo renderizado e raw, associando a última resposta textual do agente ao evento/payload bruto relacionado;
- Studio Local ganhou consumo visual de resposta incremental via `turn/stream`, com painel de streaming, contador de tokens e estado de conclusão/erro no envio de turno;
- Studio Local ganhou primeira camada de operação contínua com faixa de status global no topo do painel, resumindo sessão, runs, eventos, nó/falha em foco e CTA contextual;
- Studio Local ganhou `Idempotency-Key` visível/editável no envio manual de turno, usando a chave também no fluxo `turn/stream`;
- Studio Local ganhou primeira camada de output schema guiado, comparando campos observados contra o schema do nó ou schema de saída do flow com aderência por campo;
- Studio Local ganhou primeira camada de tool manager dedicado, inventariando nós de código, HTTP, MCP/sidecar, banco, arquivo, RAG e transformações com status observado, último evento, contrato input/output, pin e ação de debug por nó;
- o Studio já possui triagem agregada de falhas de sandbox/executor customizado por nó/modo/sandbox, com contagem, último evento, causa provável, próxima ação e navegação direta para o detalhe;
- o painel `Contexto do nó` já possui resumo de falhas de sandbox/executor customizado, com causa provável, boundary, transporte, tentativas, payload, erro resumido e ação para filtrar logs estruturados do executor;
- Studio Local ganhou primeira camada de secrets locais mascarados, com valores por flow em `localStorage`, reveal temporário por campo, secrets customizados, envio como env vars apenas ao iniciar o sandbox e exportação manual controlada de `.env` local;
- Studio Local ganhou primeira camada de governança runtime/secrets, mostrando prontidão de envs obrigatórias, pendências, envs customizadas, valores enviados no start, contagem de envs exportáveis, políticas fixas do sandbox local e perfis compartilháveis de política de secrets;
- políticas de runtime/secrets podem ser salvas como perfis locais, aplicadas por flow, definidas como padrão da workspace, exportadas/importadas em pacote `.afsecrets.json`, embarcadas no export/import do workspace e respeitadas na exportação manual de `.env`.

### 7. Artefatos

Objetivo:

- separar claramente pacote de sandbox, runtime final e arquivos gerados.

Deve incluir:

- pacote LangGraph opcional;
- runtime FastAPI gerado;
- diff contra ultima geracao;
- hashes;
- `.agent-flow/generated-meta.json`;
- aprovacao atual;
- README;
- download/export ZIP rotulado.

Regra:

- nunca misturar "sandbox LangGraph" e "API Docker final" sem rotulo claro.

### 8. Runtime

Objetivo:

- controlar o container final a partir da UI.

Deve incluir:

- validar aprovacao;
- gerar API Docker;
- build;
- up/down;
- healthcheck;
- logs;
- smoke test;
- link `/docs`;
- link `/openapi.json`;
- portas;
- env vars;
- status de Postgres/Redis quando aplicavel.

Regra:

- `Runtime` substitui o conceito de `Deployments` cloud no nosso produto.

### 9. Settings, Providers e Secrets

Objetivo:

- controlar configuracoes sensiveis e reutilizaveis.

Deve incluir:

- provider/modelo;
- modo mock/local/API;
- env vars requeridas;
- secrets mascarados;
- escopo local do usuario vs workspace/runtime;
- catalogo local de tools/skills/templates;
- import/export.

## Matriz De Inputs E Elementos De IA

Cada input deve usar o elemento certo:

- instrucao de sistema -> prompt blocks / agent config;
- mensagem natural -> session turn / LLM node;
- payload estruturado -> form por schema / API contract;
- output estruturado -> output schema / parser;
- arquivo -> file extract / RAG;
- base documental -> RAG retrieval;
- URL/API -> HTTP node ou MCP tool;
- tool/function -> schema de argumentos tipado;
- secret -> masked input / env var;
- provider/modelo -> LLM adapter;
- estado -> LangGraph state/checkpointer;
- memoria longa -> memory store com aprovacao;
- evento/log/trace -> local trace store;
- regra de negocio customizada -> code node, HTTP tool, MCP tool, sidecar ou adapter futuro;
- codigo existente em outra linguagem -> HTTP, MCP stdio, sidecar local ou runtime adapter, nao reescrita obrigatoria;
- cenario de teste -> fixture local;
- dataset/evaluator -> avaliacao posterior;
- human approval -> approval gate;
- schedule/channel -> trigger/worker futuro;
- subagente -> manifest multiagente;
- runtime -> codegen/Docker.

Regra:

- se um controle nao deixa claro qual input captura, qual runtime consome, se entra no hash e se aparece no trace, ele nao deve ser implementado ainda.

## Arquitetura Alvo

### Frontend

- React/Vite.
- React Flow para canvas.
- Shell compartilhado.
- Design system por tokens.
- Persistencia local de tema/layout.
- Componentes reutilizaveis para:
  - top bar;
  - sidebar;
  - split pane;
  - inspector;
  - drawer;
  - modal;
  - popover;
  - JSON viewer;
  - logs viewer;
  - trace tree;
  - prompt block editor;
  - schema editor;
  - tool editor.

### Builder API

Responsabilidades:

- CRUD de flows;
- CRUD de prompts/schemas/files;
- validacao;
- codegen;
- import/export;
- artefatos;
- sandbox local;
- traces locais;
- node IO;
- state snapshots;
- approvals;
- Docker build/up/down/smoke.

### Storage Local

Comecar com SQLite local para Studio:

- `studio_threads`;
- `studio_runs`;
- `studio_events`;
- `studio_node_io`;
- `studio_state_snapshots`;
- `studio_logs`;
- `studio_approvals`;
- `studio_scenarios`;
- `studio_pins`.

Postgres real fica para runtime gerado e testes de runtime/multiagente.

### Runtime/Sandbox

Caminho recomendado:

- manter artefato LangGraph compatível;
- instrumentar o runtime gerado para traces locais;
- Builder API controla sandbox e coleta eventos;
- opcionalmente permitir conectar a Agent Server externo.

### Runtime Final

- FastAPI;
- LangGraph;
- SQLAlchemy/Postgres;
- Redis opcional;
- API key inicial;
- API keys locais com expiração, revogação persistente por `key_id`, escopos por rota e por agente via `AGENT_API_KEYS`, arquivo local rotacionável via `AGENT_API_KEYS_PATH`, lista local de revogação por `AGENT_API_REVOKED_KEY_IDS_PATH` e painel visual no Studio para inventário seguro/preparo de revogação local;
- transcript/events;
- idempotencia;
- Dockerfile/compose;
- OpenAPI;
- smoke test.

## Fases De Implementacao

### Fase 0: Consolidacao De Plano E Guardrails

Status: documentada.

Entregaveis:

- plano mestre;
- decisoes de produto/UX;
- regras visuais/comportamentais;
- matriz input -> elemento IA;
- checklist anti-regressao.

Aceite:

- futuras tarefas conseguem apontar para estes documentos como fonte de verdade.

### Fase 1: Design System E Tema Claro/Escuro

Objetivo:

- criar base visual comum para tudo.

Entregaveis:

- tokens CSS;
- tema claro;
- tema escuro;
- toggle persistente;
- componentes base;
- revisao de Builder UI atual para usar tokens;
- estados visuais comuns.

Aceite:

- Builder atual funciona em tema claro e escuro;
- canvas, inspector, arquivos, artefatos e runtime nao quebram visualmente;
- botoes icon-only tem tooltip;
- disabled explica motivo.

### Fase 2: Shell Unificado

Objetivo:

- reorganizar a aplicacao como ferramenta continua.

Entregaveis:

- top bar compacta;
- sidebar/rail;
- workspace panel;
- navegacao `Flow`, `Studio Local`, `Artefatos`, `Runtime`, `Settings`;
- badges globais de estado;
- empty states com CTA;
- layout persistente.

Aceite:

- o flow selecionado permanece em contexto;
- usuario entende o proximo passo em qualquer tela vazia;
- nenhuma etapa principal exige terminal.

### Fase 3: Builder WYSIWYG Refinado

Objetivo:

- tornar criacao/edicao de agente intuitiva.

Entregaveis:

- palette pesquisavel;
- node controls;
- inspector por tipo;
- edicao visual de LLM/provider/env vars;
- edicao visual de prompts por blocos;
- editor visual de schemas com propriedades comuns, `$defs`, `$ref`, `additionalProperties`, composições `oneOf`/`allOf`/`anyOf`, validação semântica local de refs, required, arrays, enums e composições, navegação por diagnóstico, correções guiadas iniciais, padrões reutilizáveis iniciais e governança exportável `.afschemagovernance.json`;
- editor visual de tools;
- grupos/notas;
- diagnostics clicaveis;
- dirty/stale states.

Aceite:

- usuario consegue criar/ajustar o flow de referencia pela UI;
- JSON bruto nao e necessario para configuracao comum;
- mudancas em prompts/schemas/files invalidam estado testado/aprovado quando aplicavel.

Status 2026-07-01:

- canvas ganhou comando `Organizar grafo`, que recalcula posições por camadas de execução, ações `Alinhar linha`/`Distribuir` para seleção múltipla, comandos de teclado para selecionar upstream/downstream/vizinhos diretos do nó, inserção de etapa conectada após um nó ou no meio de uma aresta, conexão sequencial de nós selecionados pela ordem visual, aplicação/limpeza de tags em lote nos nós selecionados, painel de edição em lote para tags, prompt/schema de nós LLM, stage de safety gates, timeout de nós de execução compatíveis e propriedades específicas de `code`, `http_request`, `transform_json`, `database_query`, `database_save`, `file_extract`, `rag_retrieval`, `approval_gate`, `scoring` e `analytics`, presets locais por flow e biblioteca local inicial reutilizável entre flows para salvar/reaplicar/remover ações de lote, painel de governança do preset selecionado com origem, escopos, contagem de uso, último uso e flow de origem, exportação/importação versionada `.afbatchpresets.json`, busca por tags no finder, resumo guiado de debug por nó no inspector e ação `Depurar` para abrir o Studio já filtrado no nó/evento selecionado, mantendo as alterações como draft visual salvável;
- paleta de comandos ganhou ações contextuais do canvas para inserir etapa conectada, conectar seleção em sequência, focar seleção, duplicar/remover, depurar, alinhar/distribuir, aplicar/limpar tags e abrir prompt/schema vinculados; `I` abre a paleta filtrada de inserção quando há nó/aresta selecionado, `C` conecta nós selecionados em sequência e `Delete`/`Backspace` remove a seleção do canvas quando o foco não está em campo editável;
- implementada primeira camada de caminho multi-camadas no debug guiado do nó, com upstream/downstream, condições de rota, status observado, cadeia causal/impacto e abertura direta de vizinhos no Studio;
- implementada primeira camada de comparação contextual do nó selecionado no Studio, reutilizando a comparação de runs para mostrar base/candidato, presença do nó, `seq`, status/fase e diffs de state/output;
- implementada ação para criar cenário de debug por nó a partir do run candidato da comparação, com checkpoint do evento, tags de debug/comparação/base/candidato e reaproveitamento de pins ativos para reexecução ou fixture;
- implementada primeira camada de resumo multi-camadas dentro da comparação de runs, agregando fluxo/execução, state/output, nó selecionado, eventos/erros, pins/mocks e checkpoints/cenários com status, contagens, próximo passo e ações guiadas por camada para focar nó/falha, criar cenário, exportar replay, usar pins e filtrar/executar checkpoints;
- implementada primeira camada de resumo multi-camadas para resultado de lote de cenários, agregando execução, comparações, regressões, pins, checkpoints e último diff detalhado quando disponível, com ações guiadas para executar filtrados, exportar relatório/camadas, revisar pendências, usar pins e filtrar/executar checkpoints;
- implementado export `.afdebuglayers.json` para resumos multi-camadas de comparação e lote, com formato `agent-flow-builder.debug-layer-summary.v1`, hash do pacote, evidência mínima e governança explícita sem payload bruto de nós ou valores de secrets; também há primeira camada compartilhável file-backed desses resumos em `.agent-flow/debug-layers/snapshots.afdebuglayers.json`, formato `agent-flow-builder.debug-layer-snapshots.v1`, rotas `GET`/`PUT`/`POST merge`/`POST conflicts/:conflictId/curation`/`POST conflicts/:conflictId/resolve`/`GET conflicts-review`/`POST conflicts-review/diff`, sync central opcional por `AGENT_FLOW_DEBUG_LAYER_SNAPSHOTS_CENTRAL_URL`, ações `Compartilhar resumo`/`Exportar revisão`/`Comparar revisão`/`Central`/`Sync central`, painel visual `Conflitos de camadas` com thread/atribuição local de curadoria (`Assumir`/`Liberar`), lease configurável por `AGENT_FLOW_DEBUG_LAYER_SNAPSHOT_CONFLICT_CURATION_LEASE_HOURS`, liberação automática de lease vencido e histórico compacto de eventos, merge por `packageHash`, detecção inicial de conflitos por contexto de comparação/lote, resolução escolhendo qual snapshot manter, revisão governada exportável `.afdebuglayer-conflicts.json`, diff governado `.afdebuglayer-conflicts-diff.json`, histórico governado de decisão com revisor/nota/snapshot mantido/refs descartadas sem snapshots completos, evidências, payload bruto ou secrets e prevenção de reabertura quando a mesma ref descartada volta por sync, token somente no header, status sem URL/token e sanitização recursiva de evidências antes de salvar/enviar;
- implementado primeiro artefato dedicado de replay governado por nó/candidato (`.afdebugreplay.json`, formato `agent-flow-builder.debug-replay-artifact.v1`), conectando comparação base/candidato, refs de diff sem `before/after`, ação recomendada de replay, checkpoints/pins sem payload bruto, cadeia causal e flags explícitas de exclusão de payload/secrets;
- implementado painel `Artefatos de replay` no Studio para importar `.afdebugreplay.json`, revisar recomendação, seguir roteiro visual de pacote/checkpoint/pins/cenário, carregar run base/candidato, focar o nó, promover o artefato para cenário local de revisão com checkpoint metadata-only e selecionar cenário já promovido pelo hash do pacote, sem reintroduzir payload bruto;
- implementada a primeira camada de execução guiada a partir desses artefatos/cenários, com próxima ação, preparação de fixture, restauração de checkpoint, pins, execução/observação, avaliação do resultado, comparação governada de checkpoint/pins/restore/evaluator, export `.afreplaygovernance.json`, histórico local/exportável `.afreplayhistory.json`, sincronização compartilhada file-backed em `.agent-flow/replay-governance/history.afreplayhistory.json`, sync central opcional por `AGENT_FLOW_REPLAY_GOVERNANCE_HISTORY_CENTRAL_URL` com token somente no header e sem payload bruto de cenário/pins/checkpoint, diff histórico `.afreplayhistorydiff.json` sem payload bruto, curadoria local por revisor nos pacotes/snapshots/diffs de replay e thread/atribuição local de conflitos de replay por `POST /flows/:flowId/replay-governance-history/conflicts/:conflictId/curation`; pins de nó também têm primeira camada compartilhável file-backed em `.agent-flow/studio-node-pins/pins.afnodepins.json`, formato `agent-flow-builder.studio-node-pins.v1`, rotas `GET`/`PUT`/`POST merge`/`POST conflicts/:conflictId/curation`/`POST conflicts/:conflictId/resolve`, sync central opcional por `AGENT_FLOW_STUDIO_NODE_PINS_CENTRAL_URL`, ações `Carregar pins`/`Sincronizar pins`/`Central`/`Sync central`, painel visual `Conflitos de pins` com thread/atribuição local de curadoria (`Assumir`/`Liberar`), lease configurável por `AGENT_FLOW_STUDIO_NODE_PIN_CONFLICT_CURATION_LEASE_HOURS`, liberação automática de lease vencido e histórico compacto de eventos, preservação de candidatos por `nodeId`/`id`, candidato mais recente ativo por nó, resolução escolhendo qual pin manter, histórico governado de decisões com revisor/nota/pin mantido/refs descartadas sem input/output bruto, tombstone por `id`/`nodeId`/`contentHash` para não reabrir conflito quando a mesma ref descartada volta por sync, token somente no header, status sem URL/token e redaction de chaves sensíveis antes de salvar ou enviar input/output compartilhado; resumos de camadas de debug também têm pacote compartilhável e central opcional próprios em `.agent-flow/debug-layers/snapshots.afdebuglayers.json`, com painel visual, detecção/resolução inicial de conflitos por contexto, thread/atribuição local de curadoria com lease configurável/expiração automática/eventos compactos, histórico governado de decisões e tombstone de refs descartadas sem payload bruto; ainda pendente: colaboração multiusuário avançada de checkpoints/camadas com resolução distribuída mais granular e colaboração distribuída mais profunda de conflitos de pins além da curadoria local com lease. O overview visual já possui roteiro de criação, completude e canais/subagentes, presets reutilizáveis têm governança local inicial e schemas têm governança exportável inicial, biblioteca local/exportável/importável de padrões, preview/diff local antes de aplicar padrões, export/import/revisão `.afschemapatterndiff.json` com verificação de hash, histórico `.afschemapatternhistory.json`, export/import/revisão de diff histórico `.afschemapatternhistorydiff.json`, primeira curadoria local por status/uso com lease expirável, histórico compacto `curationThread.events` e enforcement backend por ator autenticado local nas mutações de biblioteca/histórico de padrões de schema.
- implementado: conflitos do histórico compartilhado de replay são calculados por chave de evidência governada, não por mera diferença temporal. A mesma evidência/checkpoint/pins/evaluator com revisão divergente gera `conflictCount`/`openConflictCount`, aparece no painel `Conflitos de replay` do cenário com thread/atribuição local (`Assumir`/`Liberar`), lease configurável por `AGENT_FLOW_REPLAY_GOVERNANCE_CONFLICT_CURATION_LEASE_HOURS`, liberação automática de lease vencido e eventos compactos, pode ser curada por `POST /flows/:flowId/replay-governance-history/conflicts/:conflictId/curation`, resolvida por `POST /flows/:flowId/replay-governance-history/conflicts/:conflictId/resolve`, exportada por `GET /flows/:flowId/replay-governance-history/conflicts-review` e comparada por `POST /flows/:flowId/replay-governance-history/conflicts-review/diff`, com botões `Exportar revisão`/`Comparar revisão` e artefatos `.afreplay-conflicts.json`/`.afreplay-conflicts-diff.json`; a trilha mantém apenas refs compactas, registra `resolutionHistory`, evita reabertura quando a mesma ref descartada volta por sync e preserva flags sem snapshots completos, payload bruto ou secrets.
- implementado no Studio: primeira camada de templates visuais de cenário (`Caminho feliz`, `Bloqueio de safety`, `Replay com pins` e `Contrato JSON`) que preenche input, tags, evaluator local, pins e thresholds no formulário sem criar o cenário automaticamente.

### Fase 4: Agent Overview

Objetivo:

- adicionar visao de alto nivel para completude do agente.

Entregaveis:

- blocos Entrada/Canais/Agente/Instrucoes/Ferramentas/Subagentes/Skills/Saida;
- conexoes suaves;
- CTAs por bloco;
- status de completude;
- links para Flow detalhado.

Aceite:

- usuario novo entende o que falta configurar sem ler docs;
- overview nao cria segunda fonte de verdade.

Status 2026-07-01:

- implementada no inspector como aba `Visão`, derivada do `agent.flow.json` e do `runtime.manifest.json`, com roteiro sequencial de criação do agente, mapa visual do fluxo principal, etapas clicáveis com status, status de canais/subagentes com rotas e endpoints, drill-down por agente/canal com flowPath, runtime interno, metadata, endpoint de sessões, contrato, resourceName, checks guiados e CTA para Runtime, empty state quando manifesto/agentes ainda não existem, blocos Entrada/LLM/Ferramentas/Controle/Estado/Evidência, percentual de prontidão, resumo de nós/arestas/prompts/schemas, ações sugeridas por lacuna, diagnósticos clicáveis e próxima melhor ação;
- implementada a primeira camada de composição assistida no Runtime Manifest, com recomendações de flows/agentes, checklist de prontidão, templates iniciais de papéis, orquestração declarativa por modo/entrada/handoffs, primeira execução no bundle raiz por `POST /orchestration/run`, roteamento por condição textual/estruturada (`input contains:`, `output contains:`, `output.assistant_message.code == ECHO`), memória governada com previews, política visual `orchestration.memoryPolicy`, persistência JSONL opcional/default, caminho padrão, retenção, redaction e limites de preview/entradas, `debug_trace` step-by-step no formato `agent-flow-builder.runtime-orchestration-debug-trace.v1` e UI compacta `Debug orquestração` no painel Docker/bundle com histórico local por artefato, filtros, comparação com execução anterior, export `.aforchdebug.json`, histórico compartilhável file-backed em `.agent-flow/orchestration-debug/history.aforchdebug.json`, merge por `debug_trace.run_id`, redaction recursiva, sanitização de URL de runtime, sync central opcional por `AGENT_FLOW_ORCHESTRATION_DEBUG_HISTORY_CENTRAL_URL` com token somente no header, diff governado `.aforchdiff.json` por `POST /flows/:flowId/orchestration-debug-history/diff`, comparando status, etapas, eventos, agentes, handoffs e erros sem payload bruto, e primeira camada compartilhável/centralizável de cenários/datasets/evaluators do Studio por `.agent-flow/studio-scenarios/scenarios.afscenarios.json`, com detecção de conflitos por hash de conteúdo, diff compacto sanitizado, thread local `Assumir`/`Liberar`, lease de curadoria configurável por `AGENT_FLOW_STUDIO_SCENARIO_CONFLICT_CURATION_LEASE_HOURS`, liberação automática de lease vencido, curador visual com papel local e resolução escolhendo candidato com histórico governado; ainda fica pendente colaboração distribuída mais profunda em cenários multiusuário avançados.

- atualização: a curadoria de conflitos compartilhados de cenários/datasets/evaluators passou a ter enforcement backend para `viewer`, mantendo inspeção liberada e bloqueando mutações/resolução com 403; eventos e histórico registram o papel do curador.
- atualização: conflitos compartilhados de cenários/datasets/evaluators também possuem pacote governado de revisão em `GET /flows/:flowId/studio-scenarios/conflicts-review` e ação visual `Exportar revisão`, no formato `agent-flow-builder.studio-scenarios-conflict-review.v1`, preservando refs, diff compacto, thread de curadoria e histórico de resolução sem expor candidatos completos, input bruto, payload bruto ou secrets. A comparação governada de revisões também existe por `POST /flows/:flowId/studio-scenarios/conflicts-review/diff` e ação visual `Comparar revisão`, gerando `.afscenario-conflicts-diff.json` com deltas de resumo, conflitos e decisões sem reabrir candidatos completos ou payload bruto.
- atualização: a thread de curadoria desses conflitos passou a ter lease padrão de 24h, configurável por `AGENT_FLOW_STUDIO_SCENARIO_CONFLICT_CURATION_LEASE_HOURS`, com expiração automática que libera o conflito, registra evento `lease_expired` e mostra o vencimento no painel visual.

- atualização: conflitos compartilhados de pins de nó também possuem pacote governado de revisão em `GET /flows/:flowId/studio-node-pins/conflicts-review` e ação visual `Exportar revisão`, no formato `agent-flow-builder.studio-node-pins-conflict-review.v1`, preservando refs, hashes de conteúdo, thread de curadoria e histórico de resolução sem expor candidatos completos, `pins`, input/output bruto ou secrets. A comparação governada de revisões existe por `POST /flows/:flowId/studio-node-pins/conflicts-review/diff` e ação visual `Comparar revisão`, gerando `.afnodepin-conflicts-diff.json` com deltas de resumo, conflitos e decisões sem reintroduzir payload bruto de pins.
- atualização: conflitos compartilhados de pins de nó também possuem lease padrão de 24h, configurável por `AGENT_FLOW_STUDIO_NODE_PIN_CONFLICT_CURATION_LEASE_HOURS`, com expiração automática que libera o conflito, registra evento `lease_expired` e mostra o prazo/expiração no painel visual.
- atualização: a biblioteca compartilhada do catálogo também passou a bloquear `viewer` no backend para assumir/liberar/resolver conflitos, registrando papel nos eventos compactos e no histórico governado.
- atualização: conflitos da biblioteca compartilhada do catálogo também possuem revisão governada por `GET /catalog/shared-library/conflicts-review` e comparação por `POST /catalog/shared-library/conflicts-review/diff`, com ações visuais `Exportar revisão`/`Comparar revisão` e artefatos `.afcatalog-conflicts.json`/`.afcatalog-conflicts-diff.json`; os pacotes preservam snapshots compactos, thread e histórico de resolução sem itens completos, conteúdo bruto, `nodePatch`, input/output ou secrets.

### Fase 5: Sandbox E Studio Local MVP

Objetivo:

- testar agente localmente sem terminal.

Entregaveis:

- start/stop sandbox;
- porta automatica/configuravel;
- healthcheck;
- logs;
- criar sessao/thread;
- start/turn/finish;
- transcript;
- events;
- playground basico;
- grafo com status por node.

Aceite:

- usuario executa cenario completo pela UI;
- erros de sandbox mostram causa e proxima acao;
- run basica gera evidencia consultavel.

### Fase 6: Trace Local Estruturado

Objetivo:

- dar ao Studio Local poder real de debug.

Entregaveis:

- `studio_runs`;
- timeline/waterfall;
- node IO;
- prompt renderizado;
- resposta bruta;
- state snapshots/diff;
- logs correlacionados;
- filtros;
- export JSON;
- replay basico.

Aceite:

- usuario consegue responder qual node rodou, com que input, que output gerou, que estado mudou e onde falhou.

Status 2026-06-30:

- implementada primeira persistencia de `studio_runs` em arquivos locais por flow, com sessão, transcript, events, logs e métricas;
- Builder API expoe lista, carga e gravação de runs locais por flow;
- Builder API deriva snapshots de state por evento e diffs incrementais para cada run salvo;
- Builder UI salva snapshots após execução e permite recarregar run para replay básico de timeline, Node IO, transcript, state inspector e diff do evento selecionado;
- já implementado: comparação por run com métricas e diffs semânticos por nó;
- já implementado: cadeia causal por nó (upstream/impact path), destaque no grafo/linha do tempo e status causal no painel de studio;
- já implementado: comparação contextual do nó selecionado, ligando a comparação geral de runs ao painel `Contexto do nó` com base/candidato, presença, status/fase e diff de state/output;
- já implementado: criação de cenário de debug por nó diretamente da comparação carregada, materializando checkpoint, tags e uso de pins ativos para o fluxo de replay/lote/fixture existente;
- já implementado: promoção de `.afdebugreplay.json` importado para cenário local de revisão com checkpoint metadata-only, com roteiro visual e seleção do cenário já promovido pelo hash do pacote, permitindo transformar um pacote governado em reexecução/lote/fixture sem carregar payload bruto no artefato;
- ainda pendente: colaboração multiusuário avançada de camadas/checkpoints e colaboração distribuída mais profunda de conflitos de pins além da thread/atribuição local com eventos compactos; a visualização agregada inicial, export `.afdebuglayers.json`, primeiro artefato dedicado importável `.afdebugreplay.json`, roteiro do replay, promoção inicial do replay para cenário, primeira execução guiada por cenário, export governado `.afreplaygovernance.json`, histórico local/exportável `.afreplayhistory.json`, sincronização compartilhada file-backed em `.agent-flow/replay-governance/history.afreplayhistory.json`, sync central opcional com token somente no header, diff histórico `.afreplayhistorydiff.json`, curadoria local por revisor, thread/atribuição local de conflitos de replay e de camadas de debug com eventos compactos, histórico governado e prevenção de reabertura idêntica de refs descartadas, além da primeira camada compartilhável/centralizável de pins de nó em `.agent-flow/studio-node-pins/pins.afnodepins.json` com detecção, thread/atribuição local, eventos compactos, resolução visual e histórico governado de decisões já existem no Studio.

### Fase 7: Playground Avancado, Pinning E Cenarios

Objetivo:

- tornar iteracao repetivel e produtiva.

Entregaveis:

- cenarios salvos;
- pin/mock data;
- restore de checkpoint por checkpointer/snapshot;
- output render/raw;
- input form por schema;
- secrets locais mascarados;
- comparacao entre runs;
- relatorio exportavel e aprovacao local de lote;
- idempotency key visivel.

Aceite:

- usuario reproduz falha com dados fixos;
- usuario reexecuta cenário forkado continuando do turno/estado restaurado;
- usuario exporta um lote aprovado como evidencia JSON com hash;
- pin/mock local nao contamina runtime final sem decisao explicita.

Status 2026-07-01:

- implementado: cenários salvos com input/payload guiado, tags, origem estruturada por agente/run/sessão/nó/evento (`sourceContext`), filtros de cenário por tipo de origem/agente/run, cenário fixado, cenário favorito, repetição do último cenário por quick-run, execução de lote filtrado, seleção dos filtrados para dataset e ações guiadas por camada para replay/checkpoints/pins, thresholds de tokens/custo/duração e limites por tipo de nó para nós alterados/diffs de state/output, inbox local/exportável/compartilhada file-backed de alertas de regressão `.afregressionalerts.json` em `.agent-flow/regression-alerts/inbox.afregressionalerts.json`, sync central opcional por `AGENT_FLOW_REGRESSION_ALERTS_CENTRAL_URL` com token somente no header e sem runs/payloads brutos, restore por checkpoint/snapshot, importação/exportação de fixture JSON, execução individual, execução em lote, comparação com baseline anterior por cenário, relatório JSON e aprovação local por hash;
- implementado: roteiro guiado no card do cenário selecionado, mostrando Origem, Compatibilidade, Restore, Pins e Execução com ações para focar origem, filtrar origem, executar replay, ativar pins e exportar fixture guiada;
- implementado: critérios textuais locais por cenário (`contém`, `não contém`, `começa com`, `termina com`, `igual`, `regex`), persistidos em fixture/metadata e aplicados no resumo do lote como primeira camada de avaliação local;
- implementado: biblioteca local de evaluators/rubricas textuais e estruturais reutilizáveis, com salvar/aplicar/remover/exportar/importar pacote `.afevaluators.json`, regras compostas com operador `todas`/`qualquer`, modos `JSON path existe`/`JSON path preenchido` para saídas serializadas e preservação do evaluator aplicado em cenário, fixture, dataset e metadata;
- implementado: datasets locais por flow, com seleção multi-cenário no painel, versão do conjunto, execução como lote filtrado, histórico local de execução com resumo/hash, versão/hash do flow, agregação experimental de sucesso, comparação contra execução anterior com indicação de mudança de flow, painel compacto de histórico experimental com tendência, ok/pass médio, melhor/pior execução, drift de flow, dashboard agregado por flow com export `.afexperiment-dashboard.json`, snapshots históricos backend em `.agent-flow/experiment-dashboard-history/history.json`, análise histórica dedicada no pacote `agent-flow-builder.experiment-dashboard-history.v1`, painel histórico dedicado com tendência entre snapshots, deltas de OK/pass/runs, melhor/pior snapshot, drift de flow e janela histórica, ação `Salvar snapshot` no Studio, export/comparação visual `.afexperiment-dashboard-history.json`/`.afexperiment-dashboard-history-diff.json`, merge e sync central opcional por `AGENT_FLOW_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_URL` com token somente no header/status sem URL ou token, rotas `GET`/`POST`/`POST merge`/`POST diff`/`GET central`/`POST sync-central` em `/flows/:flowId/experiment-dashboard-history`, e export `.afexperiments.json`, além de export/import `.afdataset.json` com cenários/histórico embutidos;
- implementado: fila de anotação/revisão por flow, alimentada por resultados de lote, com status pendente/aprovado/reprovado, responsável, identidade local de revisor, triagem em lote para assumir/aprovar/reprovar pendências visíveis, policy local `open`/`assignee_only` com papéis `owner`/`reviewer`/`viewer`, enforcement backend por ator quando há `x-agent-flow-actor` ou auth local do Builder, nota local opcional, filtros por status/responsável, cache no navegador, deduplicação por run/lote, sincronização backend file-backed em `.agent-flow/annotation-queue/queue.afannotations.json`, ação explícita de merge no Studio, sync central opcional por `GET /flows/:flowId/annotation-queue/central` e `POST /flows/:flowId/annotation-queue/sync-central` com ações visuais `Central`/`Sync central`, token somente no header, status sem URL/token e sem runs brutas, histórico compacto/audit trail no pacote, snapshots históricos locais/exportáveis da fila em `.afannotationhistory.json` sem payload bruto dos itens, export/import com merge de `.afannotations.json` e primeira camada de detecção/visibilidade/curadoria/resolução de conflitos de revisão com snapshots completos no pacote operacional, rota `POST /flows/:flowId/annotation-queue/conflicts/:conflictId/curation`, ações `Assumir`/`Liberar`, lease de curadoria configurável por `AGENT_FLOW_ANNOTATION_CONFLICT_CURATION_LEASE_HOURS`, liberação automática de lease vencido e histórico compacto de eventos para atribuir responsável antes de restaurar a versão compartilhada ou recebida, export/diff governado de conflitos por `.afannotation-conflicts.json`/`.afannotation-conflicts-diff.json` via `/flows/:flowId/annotation-queue/conflicts-review` sem itens completos, snapshots, vereditos, razões, notas ou saídas observadas, `resolutionHistory` compacta sem saída observada bruta e tombstone para não reabrir conflito quando a revisão descartada volta por sync;
- ainda pendentes: experiment suite avançada multiusuário, colaboração distribuída mais profunda de annotation queues além da resolução/tombstone/lease local file-backed e replay/artefatos governados mais profundos para camadas de debug; a camada local já possui regras determinísticas, JSON path, evaluators HTTP/LLM-as-judge acionados pelo Studio, snapshots backend de dashboard por workspace, dashboard histórico dedicado local, histórico de dashboard exportável/comparável/sincronizável com central opcional, backend compartilhado por workspace para fila de revisão, sync central opcional da annotation queue, policy local com enforcement backend por ator, snapshots históricos compactos/exportáveis da fila, conflitos de revisão resolvíveis com thread de curadoria por responsável, lease expirável e tombstone de revisões descartadas, visualização/export inicial de camadas de debug por comparação e por lote e histórico governado local de replay.

### Fase 8: Aprovacao Integrada Ao Studio

Objetivo:

- tornar promocao para runtime final clara e auditavel.

Entregaveis:

- painel de aprovacao;
- hash atual;
- assets cobertos;
- run usada como evidencia;
- status aprovado/desatualizado/nao aprovado;
- bloqueios visuais;
- gravacao de `.agent-flow/langgraph-sandbox-approval.json`.

Aceite:

- API Docker so pode ser gerada quando hash atual estiver aprovado;
- se qualquer asset coberto mudar, aprovacao fica desatualizada.

### Fase 9: Runtime Docker Pela UI

Objetivo:

- sair do Studio direto para API validada.

Entregaveis:

- gerar runtime aprovado;
- build Docker;
- compose up/down;
- healthcheck;
- logs;
- smoke test;
- links `/docs` e `/openapi.json`;
- edicao visual de portas API/Postgres/Redis no `docker-compose.yml`;
- export ZIP do runtime.

Aceite:

- container final sobe e responde sem Builder;
- smoke cria sessao, roda start/turn, le transcript/events;
- erro de build/runtime aparece com acao clara.

Status 2026-06-30:

- implementada a primeira camada de API/UI para status, preparo de `.env`, build, up, down, smoke, smoke agregado multiagente, logs e links do runtime Docker final aprovado;
- implementada inspeção explícita por `docker compose ps --format json` e `docker compose logs --tail 120 --no-color`, exibindo serviços e logs no painel de artefato;
- implementado campo de Runtime URL local para status/smoke em portas customizadas;
- implementada edicao visual de portas API/Postgres/Redis no `docker-compose.yml`, com status retornando as portas atuais e historico da operacao;
- implementado histórico operacional local em `.agent-flow/docker-runtime-history/` e listagem no painel de artefato;
- implementado reconhecimento do bundle multiagente como artefato Docker operacional, com lista de agentes e smoke test direcionado por `agentId` na rota montada do agente;
- implementado bundle final aprovado por manifesto, com rota `/runtime-manifest/generate-approved`, bloqueio quando algum agente não possui sandbox aprovado, aprovação agregada em `.agent-flow/langgraph-sandbox-approval.json`, aprovação copiada por agente e botão `Gerar bundle aprovado` na aba `Runtime`;
- implementados cards operacionais por agente no painel Docker/bundle, com rota, metadata, endpoint de sessões, link direto de metadata, status/evidência de smoke por agente, resumo de `operations.jobs` observado no smoke para worker/retenção/schedules, detecção de smoke desatualizado após porta/build/up, ação direta `Smoke agora`, ação para selecionar o agente do smoke test, atalho para histórico filtrado por agente e export `.afagentrunbook.json` por agente com URLs reais, comandos manuais, checklist, evidência e política operacional de jobs sem `.env`/secrets;
- implementado `POST /docker-runtime/smoke-all` e botão `Smoke todos` para executar smoke sequencial em todos os agentes do bundle, com resumo de sucesso/falha por agente;
- implementado contrato de storage compartilhado no bundle multiagente (`DATABASE_URL`, serviço `postgres`, `agent_id` como namespace) e teste opcional `AGENT_FLOW_TEST_POSTGRES_URL=... pytest -q -m integration` para validar dois agentes no mesmo Postgres real;
- implementado contrato de isolamento operacional por agente no bundle multiagente (`.runtime-manifest/agent-isolation.json`, `bundle.json#agentIsolation`, `/metadata` e `/health`), cobrindo `routePrefix` único, import isolado dos runtimes Python, idempotência por prefixo de rota, storage por `agent_id`, scopes `agents:<agent_id>:...` e flags de governança sem secrets/env values/payloads;
- implementado `npm run test:multiagent-postgres`, que gera bundle temporário de dois agentes, sobe Postgres real em Docker e prova escrita dos dois agentes no mesmo banco compartilhado;
- implementado `npm run test:portable-runtime-bundle`, que gera o bundle multiagente, copia o pacote para fora do workspace do Studio, remove a origem gerada, valida metadata/`bundle.json` sem path absoluto, Compose com `api`/`worker`, `app/worker.py` raiz com import isolado por agente e executa `pytest` a partir do pacote copiado;
- implementado auto-refresh opt-in para inspeção/status/logs enquanto o usuário está no painel de artefato;
- verificado por teste automatizado com runner Docker falso, build da UI e `app.inject` no runtime gerado real;
- implementado painel de progresso por etapa no build Docker (`docker compose build`) com persistência em histórico operacional;
- implementado filtro por nível/severidade no histórico operacional (`error`, `warning`, `info`, `success`);
- implementados alertas operacionais persistentes para leitura de regressões em build/up/smoke.
- implementado checklist guiado de entrega final no painel `Artefato`, derivando a próxima ação de aprovação embarcada, `.env`, setup visual de modelos locais via profile `model-setup`, build, container em execução, smoke e exportação do pacote.
- implementado relatório JSON de prontidão/exportação do runtime final, registrando arquivos obrigatórios, aprovação embarcada, status Docker, checklist, operações críticas, `agentOperations` para runtime monoagente ou bundle multiagente, política operacional de jobs sanitizada e contrato de exportação sem valores de `.env`.
- implementado manifesto embarcado no ZIP (`.agent-flow/export-manifest.json`) com tipo do pacote, target, arquivos, exclusão de `.env` e flag de runtime final removível do Builder.
- implementada auditoria estrutural de exportabilidade no listing do artefato, com checks de manifesto embarcado, tipo/target, arquivos obrigatórios, exclusão de `.env` e runtime removível.
- implementada distinção visual entre ZIP preliminar e ZIP final validado, mantendo download para inspeção mas orientando que a entrega final depende do checklist completo.
- implementado runbook destacável no manifesto/auditoria/relatório/painel, com passos mínimos para preparar `.env`, baixar modelos locais via `model-setup` quando o Compose declarar `ollama-pull-*`, fazer build, subir Docker Compose e executar smoke manual fora do Builder.
- implementado fallback prescritivo no runtime para adapter `ollama` quando o modelo local ainda não está baixado, devolvendo comandos `ollama pull ...` e `docker compose --profile model-setup up ...` e registrando `fallback_reason=local_model_missing` no payload LLM.
- implementada primeira camada de distribuição local avançada de modelos Ollama, com `OLLAMA_IMAGE`, `OLLAMA_MODEL_IMAGE`, `OLLAMA_MODEL_NAMES`, variáveis de capacidade/concurrency, `docker-compose.model-image.yml`, `ollama-models/Dockerfile`, operação visual `Build imagem` para construir a imagem Ollama pré-carregada, operação visual `Exportar imagem` para salvar `.tar` versionável por `docker image save`, operação visual `Publicar imagem` para `docker image push` quando a tag aponta para registry externo, catálogo local `.agent-flow/model-images/catalog.afmodelimages.json` com registro, listagem, export `.afmodelimages.json`, import/merge visual, descoberta em `.agent-flow/model-images/imports` ou `AGENT_FLOW_MODEL_IMAGE_CATALOG_PATHS`, sync file-backed entre workspaces, registry remoto curado salvo no workspace em `.agent-flow/model-images/remote-registries.afmodelregistry.json`, sync remoto read-only por registries salvos ou URLs HTTP(S) em `AGENT_FLOW_MODEL_IMAGE_CATALOG_REMOTE_URLS` sem credenciais, sync central multiusuário por `AGENT_FLOW_MODEL_IMAGE_CATALOG_CENTRAL_URL` com token somente no header e sem credenciais no corpo/status, comandos de `docker image load`/push no runbook quando aplicável, `docker-compose.gpu.yml`, detecção de GPU local por `nvidia-smi`, inspeção do runtime `nvidia` do Docker por `docker info`, recomendação CPU/GPU no status do runtime, seletor visual `CPU/GPU` no painel Docker, operação visual `Testar GPU` para executar `docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi -L` e registrar histórico `check_gpu`, e passos opcionais no runbook para imagem pré-carregada, exportável, publicável, catalogável e perfil NVIDIA GPU.
- runbook destacável agora inclui agentes e rotas reais (`metadata` e coleção de sessões) para runtime monoagente e bundle multiagente, usando a porta real publicada no `docker-compose.yml` exportado.

### Fase 10: Catalogo Local, Skills E Tools Reutilizaveis

Objetivo:

- melhorar reutilizacao sem criar marketplace cloud.

Entregaveis:

- catalogo local inicial de prompts, schemas, tools, templates de agente e skills reutilizaveis;
- registry local em `.agent-flow/catalog/registry.json`;
- busca e filtros locais por tipo/origem/tag;
- versionamento local basico por versão, revisão e hash de conteúdo;
- histórico local de revisões com diff visual compacto;
- restauração de revisão antiga como nova revisão local;
- comparação selecionável de revisões históricas contra a revisão atual;
- seeds locais para prompts, schemas, tools comuns, templates de agente e skills;
- salvar prompt/schema atual no registry local;
- salvar nó atual como tool/skill local reutilizável;
- salvar subgrafos selecionados como tool/skill composta reutilizável;
- inspecionar visualmente blocos/templates com etapas, conexões internas, assets e preview JSON compacto;
- editar visualmente a curadoria de itens locais, incluindo metadados, etapas, refs de prompt/schema e condições internas;
- criar, reordenar e remover etapas de blocos locais, remapeando conexões quando o ID da etapa muda;
- criar e remover conexões internas de blocos locais com validação antes do salvamento;
- editar prompts e schemas internos de skills/templates locais com ID, path, conteúdo, validação antes do salvamento e painel guiado de schema interno;
- reutilizar prompt/schema/tool/skill em flows sem copiar arquivos manualmente;
- criar novo flow a partir de template de agente;
- exportar e importar pacotes versionados de itens reutilizáveis;
- evoluir catalogo para biblioteca compartilhável opcional e edição guiada de schemas internos;
- filtro shared quando existir compartilhamento real.

Aceite:

- usuario reutiliza assets sem copiar arquivos manualmente;
- nada e apresentado como publico se nao houver publicacao real.

Status 2026-07-01:

- implementada primeira camada do catalogo local na Builder API via `/catalog`, `/catalog/items`, `/catalog/agent-templates/create-flow` e `/flows/{flowId}/catalog/apply`;
- implementado registry de workspace em `.agent-flow/catalog/registry.json`, combinado com itens built-in locais;
- prompts e schemas aplicados pelo catalogo viram assets reais no flow e podem atualizar o no selecionado;
- tools aplicadas pelo catalogo criam ou atualizam no `code` com contrato visual/runtime existente, ou materializam bundles compostos de nós/arestas com IDs únicos e conexão automática de entrada/saída;
- templates de agente criam novos flows completos; os seeds atuais incluem conversa guiada e gerador de perguntas por conteúdo/RAG;
- skills aplicadas pelo catalogo materializam bundles de prompt/schema, podem transformar o no selecionado por patch seguro e agora também podem materializar subgrafos compostos com remapeamento de prompt/schema; os seeds atuais incluem geração estruturada de perguntas e revisão com contexto/RAG;
- implementada aba `Catalogo` na Builder UI com busca textual, filtros por tipo/origem/tag, refresh, cards de itens, salvar prompt/schema atual, salvar nó selecionado como tool/skill, criar flow por template e aplicar item/skill no flow/no selecionado;
- implementada primeira camada de tool composta: item `tool` pode usar `content` no formato `agent-flow-builder.tool-bundle.v1`, o seed `Bloco HTTP JSON validado` cria `transform_json -> code/http`, e a UI diferencia `Criar bloco` de `Criar nó`;
- implementada primeira camada de skill composta: item `skill` pode declarar `nodes`/`edges` no formato `agent-flow-builder.skill.v1`, o seed `Skill composta de revisão com contexto` cria `file_extract -> rag_retrieval -> llm_structured`, e a UI trata a skill como bloco anexável;
- implementada primeira camada de curadoria visual de blocos: seleção múltipla no canvas pode ser salva diretamente como tool composta ou skill composta, preservando posições relativas e arestas internas;
- cards de catálogo agora mostram resumo visual de tools/skills compostas e templates de agente, incluindo etapas, conexões internas, contagem de prompts/schemas, patch alvo e preview JSON compacto;
- itens locais do catalogo agora podem ser curados visualmente: nome, versão, descrição, tags, criação/reordenação/remoção de etapas, alteração de IDs com remapeamento de conexões e patch alvo, descrição/tipo de etapas, refs de prompt/schema, criação/remoção de conexões internas, condições internas, prompts/schemas internos com ID/path/conteúdo editáveis, validação guiada e painel `Schema guiado` com métricas, ações para campo, `$defs`, `oneOf` e `additionalProperties`; tudo é salvo como nova revisão local;
- implementada primeira camada de versionamento/curadoria: itens do catalogo carregam versão, revisão local incremental e hash curto de conteúdo, com metadados visíveis nos cards;
- implementado histórico local de revisões: ao sobrescrever item local, o snapshot anterior fica em `history` e o card mostra diff compacto contra a revisão atual;
- implementada restauração de revisão: snapshots antigos podem ser restaurados pela API/UI, criando nova revisão sem apagar o histórico;
- implementada comparação selecionável: a UI permite escolher qual revisão histórica será comparada com a atual antes de restaurar ou reutilizar o item;
- implementado import/export dedicado de itens reutilizáveis via pacotes `agent-flow-builder.catalog-item.v1` (`.afcatalog.json`), com cópia local segura quando o pacote tenta reutilizar ID de item built-in;
- implementada primeira camada de governança local por item de catálogo: cada card mostra checks de versionamento, metadados, conteúdo, forma de reuso, histórico e portabilidade, além de export `.afcataloggovernance.json` no formato `agent-flow-builder.catalog-governance.v1` sem conteúdo bruto do catálogo ou valores de secrets;
- implementada primeira camada de governança agregada da biblioteca do catálogo, com contagem por origem/tipo, itens prontos, portabilidade, avisos por check e export `.afcataloglibrarygovernance.json` no formato `agent-flow-builder.catalog-library-governance.v1` sem conteúdo bruto ou secrets;
- implementada primeira camada de biblioteca compartilhável do catálogo, com pacote `agent-flow-builder.catalog-library.v1` em `.agent-flow/catalog/shared-library.afcataloglibrary.json`, rotas `GET /catalog/shared-library`, `POST /catalog/shared-library/load`, `POST /catalog/shared-library/merge`, `POST /catalog/shared-library/conflicts/:conflictId/curation`, `POST /catalog/shared-library/conflicts/:conflictId/resolve`, `GET /catalog/central` e `POST /catalog/sync-central`, ações visuais `Carregar compartilhado`/`Sincronizar compartilhado`/`Central`/`Sync central`, merge por `kind`/`id`/`updatedAt`, atualização do registry local, resumo compacto de ação, hash, storage, contagens e conflitos, sync central opcional por `AGENT_FLOW_CATALOG_CENTRAL_URL` com token somente no header, detecção inicial de conflito por item, snapshots compactos sem conteúdo bruto, thread/atribuição visual de curadoria (`Assumir`/`Liberar`) com lease padrão de 24h configurável por `AGENT_FLOW_CATALOG_CONFLICT_CURATION_LEASE_HOURS`, liberação automática de lease vencido e histórico compacto de eventos sem conteúdo bruto, curador local com papel `Owner`/`Reviewer`/`Viewer`, bloqueio de resolução para Viewer e decisões `Manter biblioteca`, `Aceitar recebido` e `Voltar anterior`, registrando estratégia, `resolvedBy`, nota, plano sanitizado e `resolutionHistory` compacta sem conteúdo bruto; a biblioteca também usa conflitos resolvidos como tombstone compacto para não reabrir a mesma divergência de `kind/id`/hash quando ela retorna por sync;
- verificado por `npm run test:builder-api` e `npm run test:ui-theme`;
- implementada primeira camada de biblioteca compartilhável de padrões de schema por flow, com rotas `GET`/`PUT`/`POST merge` para biblioteca e histórico, resolução por `POST /flows/:flowId/schema-pattern-library/conflicts/:conflictId/resolve` usando identidade local de curador/papel no Studio, persistência file-backed em `.agent-flow/schema-patterns/`, ações visuais `Carregar compartilhado`/`Sincronizar compartilhado`, sync central opcional por `GET /flows/:flowId/schema-pattern-library/central` e `POST /flows/:flowId/schema-pattern-library/sync-central`, merge por ID/hash, histórico sem schema bruto, assessment local/exportável de prontidão/risco de curadoria sem schema bruto, revisões colaborativas estruturadas por curador sem schema bruto, thread/atribuição com lease padrão de 24h configurável por `AGENT_FLOW_SCHEMA_PATTERN_CURATION_LEASE_HOURS`, liberação automática de lease vencido, histórico compacto `curationThread.events` e merge por ID no sync, detecção de conflitos por divergência compacta de metadados/hash, estratégia explícita de resolução (`accept_current_library`, `accept_existing_snapshot`, `accept_incoming_snapshot`, `apply_manual_schema_merge`), merge estrutural automático de schemas brutos quando propriedades/`$defs`/`additionalProperties` não colidem, plano assistido sanitizado para colisões reais sem schema bruto, revisão visual em colunas Atual/Recebido/Schema visual, diff sanitizado por área com itens novos, somente atuais e colisões, diff bruto textual local lado a lado retornado no merge quando os dois schemas brutos estão disponíveis e excluído do storage/export por padrão, export `.afschemapatternmergeplan.json`, aplicação do schema aberto no editor visual como merge manual auditado, aplicação de metadados quando o schema hash escolhido já está presente e prevenção de reabertura da mesma divergência compacta já resolvida quando ela retorna por sync, com resumo `sharedSync`/central de ação, hash de conteúdo, storage, contagens, conflitos e flags de governança;
- atualização: conflitos compartilhados de padrões de schema também possuem revisão/diff governados por `GET /flows/:flowId/schema-pattern-library/conflicts-review` e `POST /flows/:flowId/schema-pattern-library/conflicts-review/diff`, com ações visuais `Exportar revisão`/`Comparar revisão`, artefatos `.afschemapattern-conflicts.json`/`.afschemapattern-conflicts-diff.json`, comparação de resumo/conflitos/decisões e bloqueio de pacotes que contenham schema bruto, diff textual local, `items`, payloads ou secrets;
- pendente evoluir para governança compartilhada multiusuário avançada com resolução colaborativa distribuída; a governança exportável inicial do schema aberto já existe via `.afschemagovernance.json`, a biblioteca local/exportável/importável de padrões de schema já existe via `.afschemapatterns.json`, o histórico compacto e o diff histórico revisável de padrões já existem via `.afschemapatternhistory.json`/`.afschemapatternhistorydiff.json`, a primeira biblioteca compartilhável file-backed de schemas com auditoria compacta, sync central opcional com token somente no header, assessment local/exportável de prontidão/risco, revisões colaborativas estruturadas sem schema bruto, atribuição/thread de curadoria por responsável local com lease expirável, histórico compacto `curationThread.events` sem schema bruto, resolução guiada de conflitos sem schema bruto, merge estrutural automático de schemas brutos não conflitantes, plano assistido sanitizado para colisões reais, revisão visual por colunas, diff sanitizado por área, diff bruto textual local lado a lado retornado no merge e não salvo/exportado por padrão, export `.afschemapatternmergeplan.json`, aplicação manual auditada pelo schema visual, prevenção de reabertura idêntica de conflito resolvido e enforcement backend por ator autenticado local para mutações já existe, a governança local/compartilhável inicial do catálogo com sync central opcional, thread/atribuição de curadoria de conflitos, detecção/resolução inicial de conflitos, histórico governado explícito de resolução, prevenção de reabertura idêntica de conflito resolvido e edição guiada de schemas internos já existem via `.afcataloggovernance.json`/`.afcataloglibrarygovernance.json`/`.afcataloglibrary.json`, e a primeira governança central do workspace já existe via `.agent-flow/governance/workspace.afgovernance.json`, incluindo decisão consultiva `/workspace-governance/authorize` para ator, área e ação, enforcement opcional nas rotas críticas do Builder e enforcement por papel/área da auth local do Builder nas rotas protegidas.

### Fase 11: Multiagente Local

Objetivo:

- amadurecer bundles multiagente.

Entregaveis:

- modelo publico com `agent_id` ja iniciado em runtime baseline/gerado, bundle e runs locais;
- manifest editor visual inicial ja implementado para `runtime.manifest.json`;
- composição assistida multiagente ja implementada no Runtime Manifest, com recomendações de flows/agentes, templates iniciais de papéis e checklist visual de prontidão;
- orquestração declarativa ja implementada no Runtime Manifest e no bundle gerado, com modo, agente de entrada, handoffs, `.runtime-manifest/orchestration.json`, `bundle.json#orchestration` e metadata raiz;
- primeira execução de orquestração ja implementada no bundle raiz por `POST /orchestration/run`, criando sessões nos agentes montados e executando `start`/`turn` com idempotência por etapa/agente/operação;
- roteamento condicional simples e memória governada ja implementados no bundle raiz, com `input contains:`/`output contains:`, decisões de handoff, `shared_memory` com previews compactos e metadata de memória entregue aos agentes seguintes;
- roteamento por dados estruturados e persistência governada ja implementados no bundle raiz, com resolução de `input.*`/`output.*`/`memory.*`, `memory_path`/`persist_memory`/`ORCHESTRATION_MEMORY_PATH` e JSONL `agent-flow-builder.runtime-orchestration-memory-record.v1`;
- primeira camada de debug step-by-step ja implementada no bundle raiz, com capabilities `debugTrace`/`structuredConditions`, timeline `debug_trace` de plano, etapa, decisão de handoff, enfileiramento, falha sanitizada, resumo governado e persistência opcional junto do JSONL;
- primeira UI compacta de debug de orquestração ja implementada no painel Docker/bundle, chamando `POST /orchestration/run` no runtime final e exibindo status, erro sanitizado e timeline `debug_trace`;
- histórico local de debug de orquestração ja implementado por artefato, com filtros por tipo/status/agente, comparação contra a execução anterior, carregamento do último trace, export `.aforchdebug.json`, histórico compartilhável file-backed por flow em `.agent-flow/orchestration-debug/history.aforchdebug.json`, sync central opcional e diff governado exportável `.aforchdiff.json`;
- runs por agente ja possuem filtro inicial no Studio;
- trace por agente ja possui filtro inicial na timeline e resumo por agente no Studio;
- mapa de bundle multiagente ja implementado para app raiz, rotas, metadata, runtime por agente e endpoint de sessão;
- cards operacionais por agente no runtime Docker/bundle ja implementados para metadata, endpoint de sessões, seleção de smoke, histórico filtrado e runbook JSON exportável por agente;
- relatório de entrega do runtime Docker/bundle ja resume operações por agente e a última orquestração multiagente de forma sanitizada, sem input bruto, memória compartilhada bruta, payloads de etapa ou timeline bruta;
- smoke agregado de todos os agentes do bundle ja implementado no Builder API/UI;
- contrato de Postgres compartilhado e teste opcional de integração ja implementados no bundle gerado;
- isolamento por rota/agente ja materializado em `.runtime-manifest/agent-isolation.json`, `bundle.json#agentIsolation`, `/metadata` e `/health`, cobrindo `routePrefix` único, import isolado dos runtimes Python, idempotência por prefixo de rota, storage por `agent_id` e scopes `agents:<agent_id>:...`;
- execução registrada contra Postgres real compartilhado via `npm run test:multiagent-postgres`;
- bundle multiagente removível validado fora do workspace do Studio via `npm run test:portable-runtime-bundle`;
- validacao de bundle pela UI.

Aceite:

- bundle multiagente e testado, depurado e empacotado localmente com clareza.

### Fase 12: Recursos Avancados

Entram depois do core:

- Safety Harness avançado com governança contínua multiusuário; a primeira camada local configurável por nó, a biblioteca local exportável/importável, o provider HTTP externo opcional no Builder e no runtime final, o histórico backend por workspace, o dashboard local por flow/nó, a revisão humana simples/rápida com identidade local visível/exportada, o bloqueio backend de revisão por `viewer` quando há auth local/ator do Builder, o export `.afsafetyhistory.json`, o diff governado `.afsafetyhistory-diff.json`, o sync central opcional com token só no header e payload sanitizado, a resolução automática governada de colisões do mesmo run com refs compactas, a governança central file-backed do workspace, a auth local opcional do Builder, a checagem consultiva de autorização local e o enforcement opcional nas rotas críticas do Builder já existem;
- Dashboards históricos adicionais e políticas ainda mais avançadas de entrega/escalonamento de alertas ainda podem evoluir; streams de eventos por SSE/WebSocket, spans nativos `span_started`/`span_completed` durante a chamada, callback incremental de tokens no grafo, `turn/stream` SSE/WebSocket, consumo visual de eventos/resposta incremental, primeira camada de progresso por nó/uso por provider, telemetria histórica local com janela/alertas por orçamento, dashboard histórico dedicado por provider com snapshots/export/merge/sync central opcional/diff governado, arquivos `.afprovidertelemetryhistory.json`/`.afprovidertelemetryhistory-diff.json`, token central somente no header/status sem URL ou token, e inbox local/exportável/compartilhada file-backed de alertas de provider com sync central opcional, roteamento lógico por `AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTES`, escalonamento local por `AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ESCALATION_POLICY`, política de entrega por `AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_DELIVERY_POLICY`, prontidão exportável `.afproviderdelivery.json`, dispatch externo governado por rota via `AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTE_SINKS`, canal/motivo/regra aplicada, retenção/reconhecimento/reabertura por nova ocorrência no Studio ja existem;
- isolamento operacional mais forte, escala e operação contínua refinada para jobs pos-finalizacao; schedule manual por job, recorrência simples por intervalo, cron ou evento, endpoint `POST /job-schedules/trigger-event`, endpoints nativos de lote, métricas agregadas e operacionais com janela configurável/p95/throughput e leases ativos/expirados, histórico local/compartilhável/exportável/comparável/sincronizável de snapshots `.afjobmetrics.json`/`.afjobmetrics-diff.json`, retry, reprocessamento manual, limpeza governada com prévia, ações em lote via Studio, painel visual inicial no Studio, primeira camada persistente/manual/recorrente, worker CLI opcional, serviço `worker` configurável no Docker Compose e claim/lease multiworker ja existem;
- executar/publicar artefatos binários microVM kernel-direct reais e políticas de orquestração mais fortes além da primeira camada de container Python/JavaScript/TypeScript/Bash-Shell, ponte VM local Python/Node/Bash-Shell, imagens gerenciadas de container, presets gerenciados de VM, checker local de runner/imagem/manifestos VM, validação de protocolo/engine/imageId/tamanho/SHA-256/capabilities hardened, scaffold QEMU com cloud-init/build/boot/transportador SSH, scaffold microVM direct-kernel com preparo rootfs/kernel ou firmware/seed, política hardened e preflights, smoke real Docker/QEMU com cloud image Debian, gate microVM real opt-in para Firecracker/Cloud Hypervisor, contrato de homologação `.afvmhomologation.json`, receita oficial local `vm-image:microvm-recipe`, registro consumível `vm-image:microvm-register`, pacote `.afvmimagebundle` com manifestos sanitizados, imagem, artefatos obrigatórios de boot e manifesto de política copiados/verificados, `runner-kit` portátil auto-verificável, runner de referência de contrato Python local, runner QEMU de preflight com plano Q35/microVM, runner Firecracker/Cloud Hypervisor de preflight direct-kernel com enforcement de política hardened, transporte externo explícito para guest, guest agent Python embutível na imagem, export governado `.afvmreadiness.json`, perfil hardened, telemetria histórica local de sandbox e export governado `.afsandboxtelemetry.json` já implementados para nós `code`;
- triggers operacionais adicionais além de intervalo, cron e evento;
- canais SaaS;
- OAuth;
- experiment suite avançada alem da camada local de datasets/evaluators textuais/JSON path/HTTP/LLM-as-judge, dashboard agregado com snapshots backend, dashboard histórico dedicado local, fila de revisão com backend por workspace, identidade local de revisor, policy local por responsável, papéis locais, enforcement backend por ator em `open`/`assignee_only`, auditoria compacta, snapshots históricos compactos/exportáveis da fila, curadoria atribuível, detecção/resolução/export inicial de conflitos e exports/imports `.afevaluators.json`/`.afexperiments.json`/`.afexperiment-dashboard.json`/`.afannotations.json`/`.afannotationhistory.json`, com colaboração multiusuário de annotation queues e dashboards históricos multiusuário;
- annotation queues colaborativas com multiusuário distribuído mais profundo além da resolução governada/tombstone local, da governança central file-backed do workspace, da decisão consultiva local de autorização, do enforcement opcional nas rotas críticas do Builder e do enforcement backend específico da fila por ator;
- dashboards;
- auditoria centralizada por credencial, integração com diretório corporativo externo/centralizado, serviço externo de sessão corporativa e auth multiusuario alem dos arquivos locais `AGENT_API_KEYS_PATH`/`AGENT_API_REVOKED_KEY_IDS_PATH`; expiracao local por chave, revogacao local persistente por `key_id`, arquivo local rotacionavel, scopes por agente em bundles, inventario seguro `/auth/keys`, painel visual de chaves no Studio, export governado `.afauthkeys.json` sem valores brutos/caminhos locais, rate limit local, auditoria em memoria e persistencia local JSONL por `AUTH_AUDIT_PATH` ja existem como primeira camada no runtime final; no Builder API/UI, a primeira auth local opcional por API key já existe com `/builder-auth/status`, `/builder-auth/session`, `/builder-auth/session/refresh`, `/builder-auth/oidc/session/refresh`, `/builder-auth/session/logout`, `/builder-auth/audit`, `/builder-auth/external-probe`, `/builder-auth/corporate-homologation`, login OIDC local por authorization code + PKCE em `/builder-auth/oidc/login-url` e `/builder-auth/oidc/callback`, refresh OIDC com refresh token apenas em memória, logout OIDC federado avançado em `/builder-auth/oidc/logout-url` e `/builder-auth/oidc/logout-callback` por `end_session_endpoint`, com `id_token_hint` de sessão em memória, state hash-only e callback validado sem retornar tokens do provedor, sessão local curta por token `Bearer` hash-only em memória com renovação local, revogação do token anterior, persistência central local hash-only por `AGENT_FLOW_BUILDER_AUTH_SESSION_PATH` e logout local, JWT/JWKS/OIDC discovery por segredo `HS256`, chave pública `RS256`, JWKS em arquivo/URL ou discovery `.well-known/openid-configuration` com seleção por `kid`, issuer/audience/claims configuráveis incluindo grupos corporativos por `AGENT_FLOW_BUILDER_AUTH_JWT_GROUPS_CLAIM`, diretório local de grupos em `AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY`/`AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_PATH`, diretório corporativo HTTP opcional em `AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_URL` com token fora de status/export, política local por grupo em `AGENT_FLOW_BUILDER_AUTH_GROUP_POLICIES`/`AGENT_FLOW_BUILDER_AUTH_GROUP_POLICIES_PATH` para role/áreas/scopes efetivos, sync HTTP externo de lifecycle de sessão por `AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_URL`, introspeccao/decisao central obrigatoria de sessao por `AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_URL`, persistência/reload JSONL opcional, sink HTTP central opcional por `AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_URL` com payload sem headers/chaves/tokens, filtros e resumo por status/ator/chave/rota, export governado `.afbuilderauthaudit.json` sem headers/valores brutos, probe corporativo visual com `HEAD` sem corpo para serviços/sinks e `GET` para diretório sem retornar URL/token/header, homologação corporativa local em `.agent-flow/builder-auth/corporate-homologation.afbuilderauthhomologation.json` com status `blocked`/`verified`/`homologated` sem URL/token/header/path absoluto, ator governado, rotação/revogação file-backed em `/builder-auth/keys`, valor bruto retornado uma única vez, campo mascarado/inventário/auditoria/rotação/sessão/JWT/OIDC na aba `Governança` e política visual inicial de escopos/expiração, mas ainda faltam execução dessa homologação contra IdP/serviços corporativos reais do operador nos ambientes alvo e operação distribuída ampla de credenciais do Builder;
- `npm run test:builder-auth-corporate` passa como gate dedicado do contrato corporativo local do Builder, cobrindo session service, introspecção central obrigatória/fail-closed, audit sink, diretório de grupos, persistência hash-only, homologação `.afbuilderauthhomologation.json` e sanitização de URL/token/chave bruta/path absoluto;
- integracao opcional com LangSmith Cloud alem do handoff local governado, do registro local de deploy/verificação externa, do deploy por endpoint governado e do sync central opcional desses registros ja implementados; deploy gerenciado acoplado diretamente a um provedor especifico segue opcional e fora do caminho principal.

Aceite:

- nenhum recurso avancado pode quebrar o fluxo principal local-first.

## Fora Do MVP

Nao implementar agora:

- deploy cloud gerenciado diretamente por provedor especifico;
- billing/pricing/upgrade;
- prompt marketplace publico;
- sharing publico real;
- annotation queues multiusuário com resolução avançada de conflitos;
- dashboards custom;
- OAuth completo de canais SaaS;
- multiusuario com credenciais por usuario;
- publicacao remota de agents/skills;
- experiment suite completa antes de trace local.

## Criterios Globais De Aceite

Uma etapa so esta pronta quando:

- funciona em tema claro e escuro;
- nao exige terminal no caminho principal;
- possui estado vazio, loading, sucesso e erro;
- mostra proxima acao;
- botoes icon-only tem tooltip;
- bloqueios explicam motivo;
- validacao aparece perto do campo;
- mudancas relevantes invalidam aprovacao;
- run gera evidencia local estruturada;
- artefato sandbox e runtime final sao distintos;
- runtime final roda separado do Builder;
- testes ou checklists manuais foram registrados.

## Checklist Anti-Regressao

Antes de declarar a ferramenta pronta para uma fase:

- O fluxo principal funciona sem LangSmith Cloud.
- `npm run test:mvp-main-path` passa como gate end-to-end do caminho principal do MVP.
- `npm run test:docker-runtime-smoke` passa como gate de Docker real do runtime final gerado.
- `npm run test:builder-auth-corporate` passa como gate de contrato corporativo local do Builder.
- O usuario consegue desenhar, testar, depurar, aprovar e gerar API Docker na mesma UI.
- Tema claro e escuro foram verificados.
- O flow atual permanece em contexto entre telas.
- Studio Local mostra grafo, run, node IO, state, transcript, events e logs.
- Logs nao substituem trace estruturado.
- Prompt/schema/tool possuem caminho visual.
- Secrets ficam mascarados.
- Alteracoes em assets cobertos invalidam aprovacao.
- Runtime aprovado so gera se hash atual bater.
- Docker final sobe sem Builder.
- Import/export identifica claramente o tipo de pacote.
- UI nao usa naming proprietario de produto terceiro.

Status 2026-07-04: os gates `npm run test:mvp-main-path`, `npm run test:docker-runtime-smoke`, `npm run test:builder-auth-corporate`, `npm run typecheck`, `npm run build:builder-ui` e os testes Playwright focados de entrega Docker/orquestração passaram no workspace atual. O MVP principal está verificado; o plano completo segue aberto para recursos avançados e integrações externas reais.

## Ordem Recomendada De Execucao

1. Design system e temas.
2. Shell unificado.
3. Builder WYSIWYG refinado.
4. Agent Overview.
5. Studio Local MVP.
6. Trace local estruturado.
7. Playground avancado, pinning e cenarios.
8. Aprovacao integrada ao Studio.
9. Runtime Docker pela UI.
10. Catalogo local/tools reutilizaveis.
11. Multiagente local.
12. Recursos avancados.

Essa ordem protege o fluxo principal antes de adicionar areas amplas como evaluators, dashboards, annotation queues, canais SaaS ou deploy cloud opcional.

## Documentos De Referencia

- `docs/plan.md`
- `docs/implementation-status.md`
- `docs/local-studio-plan.md`
- `docs/proup-capability-parity.md`
- `docs/ux/source-research-langsmith-n8n.md`
- `docs/ux/agent-browser-sweep-notes.md`
- `docs/ux/logged-in-screenshot-raw-analysis.md`
- `docs/ux/local-studio-product-decisions.md`
- `docs/ux/visual-behavior-reference-rules.md`
- `docs/ux/input-ai-element-fit-matrix.md`
- `docs/ux/local-studio-interface-spec.md`
- `docs/ux/local-studio-interaction-model.md`
- `docs/ux/design-system.md`
- `docs/ux/ui-ux-implementation-roadmap.md`
