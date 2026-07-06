# Agent Flow Studio

Ferramenta local para desenhar, testar, depurar, aprovar e empacotar agentes de IA como APIs Docker independentes.

O objetivo do projeto é oferecer um fluxo completo, visual e local-first:

```text
Desenhar -> Testar -> Depurar -> Aprovar -> Gerar API Docker
```

O Studio não é um clone de LangSmith, LangGraph Studio ou n8n. Ele se inspira em padrões úteis desses produtos, mas tem um objetivo próprio: permitir que um agente seja criado visualmente, validado em sandbox local, aprovado por versão e exportado como uma API removível da ferramenta.

## O Que Ele Faz

O Agent Flow Studio permite criar agentes a partir de um flow versionável (`agent.flow.json`) e gerar runtimes executáveis com LangGraph + FastAPI.

Na prática, a ferramenta cobre três camadas:

- **Builder visual**: edição do grafo, nós, arestas, prompts, schemas, adapters LLM incluindo Ollama local, arquivos e validações.
- **Studio local**: execução e depuração do agente com status global de operação, sessões, runs, timeline, transcript, events, state inspector, node IO, logs e contexto causal por nó.
- **Runtime final**: geração de uma API FastAPI/Docker independente ou bundle multiagente Docker, com Swagger/OpenAPI, persistência, cache opcional, API keys com scopes locais, streams de eventos por SSE/WebSocket, smoke test local por agente, smoke agregado de todos os agentes do bundle, runbook operacional exportável por agente e relatório de entrega com resumo sanitizado de operações/orquestração.

O fluxo principal foi desenhado para funcionar sem LangSmith Cloud, sem cobrança externa quando usado com mock/modelo local, e sem depender de terminal no caminho de produto. Integrações com LangGraph/LangSmith continuam possíveis como compatibilidade opcional.

O runtime Docker gerado usa `.env` opcional no Compose, `MOCK_LLM=true` e `LANGSMITH_TRACING=false` por padrão. Em 2026-07-04, o artefato `generated/reference-interview-runtime` foi validado novamente com Docker Compose real cobrindo API, Postgres, Redis, worker, sessão, turn, transcript, events, finish e job pós-finalização `succeeded`. O gate `test:portable-runtime` também valida o runtime como pacote removível: gera o artefato, copia para um diretório consumidor fora do workspace do Studio, remove a origem gerada e executa `pytest` a partir do pacote copiado. O gate `test:portable-runtime-bundle` aplica a mesma prova ao bundle multiagente, incluindo `app/worker.py` raiz e Compose com serviços `api`/`worker`.

## Recursos Implementados

### Builder Visual

- Canvas com React Flow para editar agentes.
- Finder, grupos, barra contextual e paleta de comandos para localizar/focar nós, organizar automaticamente o grafo, selecionar upstream/downstream/vizinhos diretos do nó por teclado, inserir etapa conectada após um nó ou no meio de uma aresta, conectar a seleção múltipla em sequência visual, alinhar/distribuir seleção, editar em lote tags, LLM/schema, safety/stage, timeout e parâmetros de nós code/HTTP, Transform, Banco, Arquivo/RAG, Approval, Scoring e Analytics, salvar/aplicar presets locais de edição em lote por flow e em biblioteca local reutilizável entre flows, revisar origem/escopos/uso do preset antes de aplicar, exportar/importar pacotes `.afbatchpresets.json`, ver resumo guiado de debug por nó com upstream/downstream/condições/cadeia causal, depurar nó ou vizinho no Studio, duplicar/remover seleção e abrir prompt/schema vinculados sem sair do fluxo visual.
- Aba `Visão` com roteiro de criação do agente, mapa visual do fluxo principal, status e drill-down de canais/subagentes a partir do runtime manifest, rotas/metadata/endpoints/contrato por agente, mapa de completude do agente, ações sugeridas por lacuna, diagnósticos clicáveis, resumo de nós/arestas/prompts/schemas e próxima melhor ação para configurar, validar ou executar o flow.
- Criação, listagem, leitura, salvamento e validação de flows.
- Edição visual de propriedades de nós, adapters LLM, modelos e variáveis de ambiente, com primeira camada de adapter local via Ollama/OpenAI-compatible em `http://localhost:11434/v1`, presets locais por perfil de hardware, verificação local do servidor e detecção guiada de modelos instalados.
- Criação e edição de prompts Markdown e schemas JSON referenciados pelo flow, com governança exportável de schema em `.afschemagovernance.json`.
- Editor visual de JSON Schema na aba `Arquivos`, com propriedades recursivas, required, enum, arrays/objetos aninhados, `$defs`, `$ref`, `additionalProperties`, composições `oneOf`/`allOf`/`anyOf`, validação semântica local de refs, required, arrays, enums e composições, navegação por diagnóstico, correções guiadas para criar `$defs`, limpar/deduplicar/normalizar `required`, preencher ou corrigir `items`, inicializar `properties`, corrigir `additionalProperties`, converter composições em lista, normalizar enum e deduplicar listas, biblioteca inicial de padrões reutilizáveis para mensagem, citação RAG, chamada de tool e erro estruturado, e biblioteca local/exportável/importável de padrões de schema `.afschemapatterns.json`, com preview/diff antes de aplicar, export/import/revisão governada `.afschemapatterndiff.json` com verificação de hash, histórico local/exportável/importável `.afschemapatternhistory.json`, comparação/export/import/revisão `.afschemapatternhistorydiff.json` e ambos sem schema bruto, curadoria local por status `rascunho`/`aprovado`/`deprecado`, assessment exportável de prontidão/risco sem schema bruto, revisões colaborativas estruturadas por curador (`aprovar`, `pedir ajustes`, `deprecar`) e thread/atribuição visual de curadoria (`Assumir`/`Liberar`) com lease padrão de 24h configurável por `AGENT_FLOW_SCHEMA_PATTERN_CURATION_LEASE_HOURS`, liberação automática de lease vencido e histórico compacto `curationThread.events` sem schema bruto, contagem de uso, último uso, sincronização compartilhada file-backed por flow em `.agent-flow/schema-patterns/` e sync central multiusuário opcional por `AGENT_FLOW_SCHEMA_PATTERN_CENTRAL_URL`, com resumo visual de ação, hash, contagens de merge, conflitos compactos com snapshots sem schema bruto, identidade local de curador/papel, resolução guiada por estratégia (`Aceitar atual`, `Aceitar recebido`, `Voltar anterior`, `Usar schema visual`), merge estrutural automático de schemas brutos sem colisão de propriedades/`$defs`, plano assistido sanitizado para colisões reais sem schema bruto, revisão em colunas Atual/Recebido/Schema visual, diff sanitizado por área com itens novos, somente atuais e colisões, diff textual local lado a lado quando o merge tem os dois schemas brutos na resposta, export `.afschemapatternmergeplan.json`, aplicação do schema aberto no editor visual como merge manual auditado, aplicação de metadados quando o schema selecionado já está presente, prevenção de reabertura da mesma divergência compacta já resolvida quando ela retorna por sync e token central somente no header.
- Conflitos compartilhados de padrões de schema também possuem revisão/diff governados por `GET /flows/:flowId/schema-pattern-library/conflicts-review` e `POST /flows/:flowId/schema-pattern-library/conflicts-review/diff`, com botões `Exportar revisão`/`Comparar revisão` e arquivos `.afschemapattern-conflicts.json`/`.afschemapattern-conflicts-diff.json` sem `schema` bruto, diff textual local, `items`, payloads ou secrets.
- Catálogo local inicial na aba `Catálogo`, com registry em `.agent-flow/catalog/registry.json`, busca/filtros por tipo/origem/tag, versão/revisão/hash de conteúdo por item, histórico local de revisões com comparação selecionável, diff visual compacto e restauração por revisão, seeds locais para prompt/schema/tools/templates de agente/skills, incluindo `pro-up-parity-complex-agent` para criar um flow complexo com conversa, consulta de conteúdo, geração de perguntas, estado, scoring, analytics, approval e escape hatch HTTP/código, primeira camada de tools/skills compostas por bundle de nós/arestas, resumo visual de blocos/templates com etapas, conexões, assets e preview JSON, curadoria visual de itens locais com edição de metadados, criação/reordenação/remoção de etapas, alteração de IDs com remapeamento de conexões, refs de prompt/schema, criação/remoção de conexões internas, condições, prompts/schemas internos com ID/path/conteúdo editáveis, validação guiada antes de salvar e editor guiado de schemas internos com métricas, ações para campo, `$defs`, `oneOf`, `additionalProperties` e validação semântica, importação/exportação de pacotes `.afcatalog.json`, painel de governança por item com checks de versionamento/metadados/conteúdo/reuso/histórico/portabilidade e exportação `.afcataloggovernance.json` sem conteúdo bruto ou secrets, governança agregada da biblioteca com exportação `.afcataloglibrarygovernance.json`, biblioteca compartilhável file-backed em `.agent-flow/catalog/shared-library.afcataloglibrary.json`, ações `Carregar compartilhado`/`Sincronizar compartilhado` com merge por `kind/id/updatedAt`, sync central opcional por `AGENT_FLOW_CATALOG_CENTRAL_URL` com token somente no header, resumo de hash/contagens/conflitos, detecção inicial de conflitos compartilhados por item com snapshots compactos sem conteúdo bruto, thread/atribuição visual de curadoria de conflito (`Assumir`/`Liberar`) com lease configurável por `AGENT_FLOW_CATALOG_CONFLICT_CURATION_LEASE_HOURS`, liberação automática de lease vencido e histórico compacto de eventos sem conteúdo bruto, curador local com papel `Owner`/`Reviewer`/`Viewer`, decisões `Manter biblioteca`, `Aceitar recebido` e `Voltar anterior` bloqueadas para Viewer, registrando `resolvedBy`, estratégia, nota, plano sanitizado e `resolutionHistory` com snapshot mantido/descartado sem conteúdo bruto, revisão governada por `GET /catalog/shared-library/conflicts-review`, comparação por `POST /catalog/shared-library/conflicts-review/diff`, botões `Exportar revisão`/`Comparar revisão` e arquivos `.afcatalog-conflicts.json`/`.afcatalog-conflicts-diff.json` sem itens completos, conteúdo bruto, `nodePatch`, input/output ou secrets, e usando a resolução anterior para não reabrir a mesma divergência compacta quando ela volta por sync, ações para salvar o prompt/schema atual, salvar o nó atual como tool/skill reutilizável, salvar subgrafos selecionados como tool/skill composta, aplicar prompt/schema/tool/skill no flow e criar um novo flow a partir de template reutilizável.
- Aba `Governança`, com primeira camada compartilhável de papéis/políticas/auditoria do workspace em `.agent-flow/governance/workspace.afgovernance.json`, participantes locais, políticas por área, conflitos de papel, resolução governada, export `.afgovernance.json` sem secrets/envs/runs brutas, checagem consultiva de acesso por ator/área/ação via `/workspace-governance/authorize`, enforcement local opcional por `AGENT_FLOW_WORKSPACE_GOVERNANCE_ENFORCE=true` nas mutações críticas de governança, catálogo, schemas, annotation queue, replay, safety, experimentos e entrega de runtime, e enforcement por papel/área da auth local do Builder nessas rotas protegidas quando a requisição usa uma chave autenticada.
- Visão `Pendências de colaboração` na aba `Governança`, baseada em `/collaboration/conflicts`, agregando revisões governadas de conflitos por workspace/flow, permitindo triagem por flow, área, severidade, responsável, papel e status, expondo o contrato `sourceActions` da área de origem para revisão, diff, curadoria, resolução e bloqueio de mutação por `viewer`, exportando revisão `.afcollaboration-conflicts.json` e comparando contra o estado atual por `/collaboration/conflicts/diff` com diff `.afcollaboration-conflicts-diff.json`, sem expor schema bruto, prompt bruto, input/output bruto, headers, tokens, payloads, candidatos completos ou secrets.
- Builder API possui primeira camada opcional de auth local própria: `AGENT_FLOW_BUILDER_AUTH_REQUIRED=true` exige chave por `X-Agent-Flow-Builder-Key` ou `Authorization: Bearer`, com chaves em `AGENT_FLOW_BUILDER_API_KEY`, `AGENT_FLOW_BUILDER_API_KEYS` ou `AGENT_FLOW_BUILDER_API_KEYS_PATH`, aceita JWT local assinado por `AGENT_FLOW_BUILDER_AUTH_JWT_SECRET` (`HS256`), `AGENT_FLOW_BUILDER_AUTH_JWT_PUBLIC_KEY` (`RS256`) ou JWKS por `AGENT_FLOW_BUILDER_AUTH_JWT_JWKS_PATH`/`AGENT_FLOW_BUILDER_AUTH_JWT_JWKS_URL`, e também descobre `jwks_uri` e `end_session_endpoint` por `AGENT_FLOW_BUILDER_AUTH_OIDC_ISSUER_URL` ou `AGENT_FLOW_BUILDER_AUTH_OIDC_DISCOVERY_URL`, com seleção por `kid`, cache local e issuer/audience/claims configuráveis, incluindo grupos corporativos por `AGENT_FLOW_BUILDER_AUTH_JWT_GROUPS_CLAIM`, diretório local de grupos por `AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY`/`AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_PATH`, diretório corporativo HTTP opcional por `AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_URL` com token opcional `AGENT_FLOW_BUILDER_AUTH_GROUP_DIRECTORY_TOKEN`, e política local por grupo em `AGENT_FLOW_BUILDER_AUTH_GROUP_POLICIES`/`AGENT_FLOW_BUILDER_AUTH_GROUP_POLICIES_PATH` para role/áreas/scopes efetivos, login OIDC local por authorization code + PKCE via `/builder-auth/oidc/login-url` e `/builder-auth/oidc/callback`, refresh OIDC de sessão via `/builder-auth/oidc/session/refresh` com `refresh_token` apenas em memória no backend, logout OIDC federado via `/builder-auth/oidc/logout-url` e `/builder-auth/oidc/logout-callback` usando discovery ou `AGENT_FLOW_BUILDER_AUTH_OIDC_END_SESSION_ENDPOINT`/`AGENT_FLOW_BUILDER_AUTH_OIDC_POST_LOGOUT_REDIRECT_URI`, `id_token_hint` da sessão OIDC em memória quando disponível e validação de state no retorno, primeira sessão local curta via `/builder-auth/session` com token `Bearer` hash-only em memória, renovação local via `/builder-auth/session/refresh` com rotação/revogação do token anterior, persistência central local hash-only por `AGENT_FLOW_BUILDER_AUTH_SESSION_PATH`, sync HTTP opcional de ciclo de vida de sessão por `AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_URL` com envio apenas de hashes/metadados, logout local via `/builder-auth/session/logout`, inventário seguro em `/builder-auth/status` sem valores brutos, auditoria local em `/builder-auth/audit` com persistência/reload JSONL opcional por `AGENT_FLOW_BUILDER_AUTH_AUDIT_PATH` e sink HTTP central opcional por `AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_URL`, com token opcional `AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_TOKEN` enviado só ao sink e nunca em status/export, filtros por status/ator/chave/rota/busca, resumo agregado por status/ator/chave/rota, export governado `.afbuilderauthaudit.json` sem headers/valores brutos, rotação/revogação local por arquivo em `/builder-auth/keys` e `/builder-auth/keys/:keyId/disable` salvando apenas hash da chave, injeção do ator autenticado na governança e campo mascarado na aba `Governança` para salvar a chave local no navegador. A UI permite entrar e sair por OIDC quando discovery/endpoints e client id estão configurados, criar/renovar/encerrar a sessão local, mostra persistência central local e serviço corporativo da sessão, mostra grupos da sessão quando presentes, mostra status de diretório/políticas de grupos, fonte externa do diretório, status JSONL/sink central da auditoria, mostra o status JWT/JWKS/OIDC sem segredo bruto e remove a chave bruta do navegador após criar sessão; a rotação inclui presets de escopo, expiração em 7/30 dias, opção sem expiração e resumo visual da política antes de gerar a chave.
- Sessões `Bearer afbs_*` do Builder podem exigir introspecção/decisão central por `AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_URL`, com token opcional, timeout, modo fail-closed por `AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_REQUIRED=true`, envio apenas do hash da sessão e metadados locais, override seguro da identidade efetiva e status visual sem expor URL/token.
- A Builder API/UI possui probe governado de integrações corporativas por `POST /builder-auth/external-probe` e botão `Testar integrações` na aba `Governança`, cobrindo serviço corporativo de sessão, introspecção central de sessão, sink central de auditoria e diretório corporativo de grupos. O relatório usa `HEAD` sem corpo para serviços/sinks, `GET` para diretório, envia tokens somente no header e não retorna URL, token, header, JWT, chave bruta, token de sessão ou token de provedor.
- A Builder API/UI também gera homologação corporativa local por `POST /builder-auth/corporate-homologation` e botão `Homologar auth`, salvando `.agent-flow/builder-auth/corporate-homologation.afbuilderauthhomologation.json` com status `blocked`/`verified`/`homologated`, evidências pendentes, snapshot sanitizado de configuração e componentes testados, sem URL, token, header, chave bruta, token de sessão, token de provedor ou path absoluto.
- Importação e exportação de workspace de flow.
- Diagnósticos estruturados de validação com navegação para o ponto afetado.
- Preview do JSON do flow.
- Tema claro e escuro persistente por `localStorage`.
- Auditoria automatizada de tema/layout com Playwright para shell principal, abas do inspector, tema claro/escuro, viewports desktop/compacta, runs locais com dados, aprovação desatualizada bloqueando a toolbar e o gate do Studio, fluxo `LangGraph` -> `Aprovar` -> `API Docker` e estados Docker de build/running/stopped/erro em workspace isolado.
- Atalhos iniciais: `Ctrl/Cmd+K` para abrir a paleta de comandos, `Ctrl/Cmd+S` para salvar workspace, `Ctrl/Cmd+Enter` para validar, `Esc` para limpar seleção, `A` para focar a paleta de nós, `F` para reenquadrar o canvas, `I` para inserir uma etapa conectada quando há nó/aresta selecionado, `C` para conectar nós selecionados em sequência e `Delete`/`Backspace` para remover a seleção do canvas quando o foco não está em campo editável.

### Tipos De Nó E Capacidades Do Flow

O contrato atual já suporta nós para:

- LLM.
- Entrada humana.
- Switch/condições.
- HTTP request.
- Transformação JSON.
- Consulta e gravação em banco.
- Extração de arquivo.
- RAG local.
- Approval gate.
- Scoring.
- Analytics.
- Código customizado.

O Safety Gate aceita política local configurável no próprio nó: modo padrão/custom, threshold de severidade, resposta segura padrão e regras `contains`/`regex` com categoria, severidade e ação (`warn`, `safe_redirect` ou `block`). O inspector também possui biblioteca local de políticas de Safety para salvar, aplicar, remover, exportar e importar pacotes `.afsafety.json`, além de um Safety Harness com avaliação local, provider HTTP externo opcional, histórico backend por workspace, dashboard local por flow/nó com taxa de bloqueio, origem local/externa, categorias e pendências, revisão humana simples ou rápida por run com identidade local/papel visível e exportado, bloqueio backend de revisão por `viewer`, export `.afsafetyhistory.json` com governança explícita sem input bruto, headers externos ou secrets, diff governado `.afsafetyhistory-diff.json` sem `inputPreview`, `matchedText`, headers externos, payloads brutos de provider ou secrets, sync central opcional por `AGENT_FLOW_SAFETY_HARNESS_CENTRAL_URL` com ações `Central`/`Sync central`, token somente no header, status sem URL/token, payload sanitizado sem `inputPreview`/`matchedText` e `resolutionHistory` compacta para colisões do mesmo run, mantendo a versão mais recente com `resolvedRole` sem expor input ou matched text. O runtime registra metadados da regra acionada no payload de safety, preserva o safety padrão quando o modo `default_and_custom` é usado e pode chamar provider HTTP externo por env vars `SAFETY_PROVIDER_*` antes de seguir para o LLM quando regras locais permitem.

O nó de código customizado aceita Python, JavaScript, TypeScript e Bash/Shell no runtime atual, por arquivo ou inline, com input/output tipado, logs de execução e inclusão no hash de aprovação. Também aceita `codeExecution: "http"` para executar comportamento externo por contrato JSON, `codeExecution: "sidecar"` para chamar um subprocesso local com JSON via stdin/stdout, `codeExecution: "mcp"` para chamar uma tool MCP local via stdio e `codeExecution: "runtime_adapter"` por endpoint HTTP ou pelo runner VM local quando `sandboxIsolation="vm"` e o adapter declara `codeInline` ou `codePath`.

Executores process-backed podem usar `sandboxIsolation: "ephemeral_workspace"` para rodar em cópia temporária de `app/code`, com `cwd` isolado, env allowlist opcional e descarte das escritas após a execução. Para Python e Bash/Shell `native`/`inline`/`file`, `sandboxIsolation: "dedicated_process"` executa o código em outro processo com contrato JSON por stdin/stdout, workspace temporário, `sandboxEnvAllowlist` e trace `dedicated_process` no Studio.

O inspector possui biblioteca local de perfis de sandbox/payload para salvar, aplicar, remover, exportar e importar pacotes `.afcodesandbox.json`, cobrindo isolamento, env allowlist, retry, allowlist de payload, redaction, payload máximo, imagem/engine de container, imagem gerenciada por executor, preset gerenciado de VM, runner/args/manifestos/imagem/engine/perfil de VM local e timeout. Dependências npm declaradas por `codeDependencies` entram no `app/code/package.json` do runtime gerado. Outras linguagens continuam possíveis via sidecar, MCP ou runtime adapter quando o runtime/container/VM tiver o executável necessário; adapters dedicados mais amplos continuam planejados para linguagens e isolamentos específicos.

Python, JavaScript, TypeScript e Bash/Shell `native`/`inline`/`file` também possuem a primeira camada de `sandboxIsolation: "container"`: o runtime gerado executa o worker em `docker` ou `podman` com `--network none`, workspace temporário montado em `/workspace`, env allowlist explícita e metadados `sandbox_image`, `sandbox_engine`, `sandbox_network`, `container` e política no trace. A imagem pode vir de um preset gerenciado no Studio, de `sandboxContainerImage` ou de `AGENT_FLOW_CODE_CONTAINER_IMAGE`; sem imagem ou engine disponível, a execução falha de forma observável sem fallback silencioso. Em JS/TS, o container reaproveita o `code_runner.mjs` gerado e executa o código com Node dentro da imagem escolhida; em Bash/Shell, o Studio oferece preset `bash:5.2`. O Studio também possui perfis de orquestração `baseline` e `hardened` para containers, com limites de memória/CPU/PIDs e hardening opcional (`read-only`, `cap-drop=ALL` e `no-new-privileges`), preservados em perfis `.afcodesandbox.json`.

Python, JavaScript, TypeScript e Bash/Shell `native`/`inline`/`file`, além de `runtime_adapter` com fonte local, também possuem a primeira camada de `sandboxIsolation: "vm"` como ponte para runner local de VM/microVM. O flow/UI/codegen carregam `sandboxVmImageId`, `sandboxVmRunner`, `sandboxVmArgs`, `sandboxVmRunnerManifest`, `sandboxVmImage`, `sandboxVmImageManifest`, `sandboxVmEngine`, `sandboxVmProfile`, `sandboxVmMemory` e `sandboxVmCpus`; o Studio oferece presets gerenciados iniciais de VM para Python e Node, preserva a escolha nos perfis `.afcodesandbox.json`, possui verificação local de prontidão do runner/imagem/manifestos sem executar código do usuário, valida protocolo, engine, imageId, tamanho declarado, SHA-256 opcional e capabilities hardened quando manifestos estão presentes, exporta prontidão governada `.afvmreadiness.json`, e o runtime envia o contrato `agent-flow-vm-runner.v1` por stdin/stdout JSON para `sandboxVmRunner` ou `AGENT_FLOW_CODE_VM_RUNNER`, registra `vm`/`microvm`, imagem, manifestos, engine, runner, perfil e política no trace, e falha de forma observável quando o runner não está configurado. Pacotes `.afvmimagebundle` incluem `runner-kit` portátil com `check-bundle.mjs`, `agent-flow-vm-runner-reference.py`, `agent-flow-vm-runner-qemu.py`, `agent-flow-vm-runner-microvm.py`, `agent-flow-vm-guest-agent.py`, `use-bundle.ps1`, `use-bundle.sh`, scripts opt-in dos runners e README, sem paths locais de origem e sem executar código do usuário durante validação; o pacote também copia e verifica artefatos obrigatórios de boot como `kernel`, `firmware`, `initrd` e `seed.iso`, preserva e verifica `manifests/microvm.policy.json` quando a imagem declara `policyManifest`, expõe `AGENT_FLOW_CODE_VM_BOOT_ARTIFACTS`, `AGENT_FLOW_CODE_VM_SEED_IMAGE` e `AGENT_FLOW_MICROVM_POLICY_MANIFEST`, e revalida esses artefatos e a política no check local. Também existe `vm-image:scaffold`, que gera scaffold de imagem QEMU com cloud-init, guest agent, transportador SSH, scripts de build/boot e manifestos sem baixar imagem nem guardar secrets, além de scaffold microVM direct-kernel para Firecracker/Cloud Hypervisor com preparo local de rootfs/kernel ou firmware/seed, manifestos, política hardened, runner e preflights. O comando `vm-image:homologate` promove uma imagem microVM real fornecida pelo operador para um manifesto `.afvmhomologation.json`, com status `blocked`, `preflight_verified` ou `homologated`, unindo runner, imagem, artefatos de boot, política, preflight e boot evidence sem incluir paths locais resolvidos, secrets ou env values. O comando `vm-image:microvm-recipe` gera a receita oficial local reprodutível/publicável, com scaffold, runbook, scripts de build/preflight/homologação/bundle/publicação local, templates de evidência, checklist e índice de release local; o gate `test:vm-microvm-official-recipe` prova esse caminho sem baixar imagem, dar boot, executar código do usuário, guardar secrets ou embutir paths locais resolvidos. O runner de referência valida o contrato localmente, mas declara `providesVmIsolation=false`; o runner QEMU valida binário/imagem/artefatos de boot/hash/plano Q35 ou microVM, e o runner microVM valida Firecracker e Cloud Hypervisor direct-kernel com binário, rootfs, kernel/firmware, seed, manifesto de política hardened, plano de comando/config e transporte externo. Ambos falham fechado sem transporte e suportam encaminhar o contrato ao guest agent. O runtime também falha fechado se `sandboxIsolation="vm"` receber `ok=true` de um runner que não declare `providesVmIsolation=true`, salvo override explícito `AGENT_FLOW_CODE_VM_ALLOW_UNVERIFIED_ISOLATION`. Transportes simulados/locais são reportados como `providesVmIsolation=false`; somente transporte real para guest deve usar assurance `guest_vm`. O gate real opt-in também possui backend Docker descartável que instala QEMU/cloud-localds em container, baixa/cacheia uma cloud image Debian quando autorizado e provou build, boot, SSH, guest agent e `providesVmIsolation=true` neste host. Para microVM, `test:vm-microvm-real-smoke` roda em dry-run por padrão, e com opt-in valida artefatos reais, preflight real e boot launch smoke de Firecracker/Cloud Hypervisor quando os binários e imagens são fornecidos; `test:vm-microvm-homologation` valida o contrato de promoção para imagem homologada. O artefato binário oficial pronto depende da execução dessa receita com rootfs/kernel reais do operador e da publicação escolhida para o ambiente.

O comando `vm-image:microvm-register` complementa a receita oficial: lê `release/microvm-image-release.json`, valida o bundle, a homologação e `runner-kit/check-bundle.mjs`, e gera `release/microvm-image-release.afvmrelease.json`, `release/microvm-runtime-config.json` e scripts de ambiente consumíveis pelo Studio/runtime. O gate dedicado é `test:vm-microvm-release-registration`.

### Codegen E Artefatos

- Flow Spec em TypeScript/Zod.
- Codegen para runtime Python/FastAPI/LangGraph.
- Codegen para pacote LangGraph compatível com `langgraph dev`.
- Codegen multiagente inicial via `runtime.manifest.json`.
- Editor visual de `runtime.manifest.json`, com edição de metadata, LLM padrão, empacotamento, agentes, prefixos de rota e composição assistida multiagente com checklist de prontidão e recomendações de flows/agentes.
- Mapa operacional de bundle multiagente na aba `Runtime`, com app raiz, rotas, metadata, runtime por agente e endpoints de sessão após validação.
- Cards operacionais por agente no painel da API Docker/bundle, com rota, endpoint de metadata, endpoint de sessões, link direto de metadata, status/evidência de smoke por agente, resumo de `operations.jobs` observado no smoke (worker, retry/claim multiworker, retenção e schedules), a mesma política operacional no resultado imediato de smoke individual/agregado, detecção de smoke desatualizado após porta/build/up, ação direta `Smoke agora`, atalho `Histórico` com filtro por agente e export `.afagentrunbook.json` com URLs, comandos, checklist, evidência do agente, labels derivadas da política operacional de jobs e objeto bruto `jobsOperations` sem valores de `.env`.
- Bundle multiagente com `.agent-flow/generated-meta.json`, aprovação agregada em `.agent-flow/langgraph-sandbox-approval.json`, aprovação copiada por agente, `Dockerfile`, `docker-compose.yml`, metadata de agentes, contrato de storage compartilhado por `DATABASE_URL`/Postgres, contrato declarativo/executável inicial de orquestração `.runtime-manifest/orchestration.json`/`bundle.json#orchestration`/`POST /orchestration/run` e contrato de isolamento operacional `.runtime-manifest/agent-isolation.json`/`bundle.json#agentIsolation`, cobrindo entrada, handoffs, roteamento simples por `input contains:`/`output contains:` e por caminhos estruturados como `output.assistant_message.code == ECHO`, memória compartilhada governada com previews compactos, política visual `orchestration.memoryPolicy` para persistência `disabled`/`optional_jsonl`/`always_jsonl`, persistência default, caminho padrão, limites de entradas, retenção, preview, redaction e inclusão de saídas/decisões, persistência em JSONL via política, `memory_path`, `persist_memory` ou `ORCHESTRATION_MEMORY_PATH`, `debug_trace` step-by-step com plano, etapa, decisão de handoff, falha sanitizada e resumo governado, painel visual `Debug orquestração` no Docker/bundle para executar e inspecionar a timeline do runtime final, histórico local por artefato, filtros por tipo/status/agente, comparação com a execução anterior e export `.aforchdebug.json`, criação de sessões nos agentes montados, `start`/`turn`, `routePrefix` único, import isolado dos runtimes Python, idempotência por prefixo de rota, storage por `agent_id` e scopes `agents:<agent_id>:...`; o teste opcional `AGENT_FLOW_TEST_POSTGRES_URL=... pytest -q -m integration` valida escrita de dois agentes no mesmo banco real.
- Painel da API Docker/bundle com checklist guiado de entrega final (`Aprovar -> .env -> Modelos -> Build -> Up -> Smoke -> Exportar`), ação visual `Modelos` para executar o profile `model-setup` quando o Compose declara `ollama-pull-*`, ação visual `Build imagem` para construir a imagem Ollama pré-carregada quando o override existir, ação visual `Exportar imagem` para salvar a tag `OLLAMA_MODEL_IMAGE` como `.tar` versionável, ação visual `Publicar imagem` para executar `docker image push` quando `OLLAMA_MODEL_IMAGE` aponta para uma tag de registry, ação visual `Registrar catálogo` para salvar tag/modelos/comandos em `.agent-flow/model-images/catalog.afmodelimages.json`, lista visual do catálogo de imagens com atualização, export `.afmodelimages.json`, import/merge manual, descoberta de pacotes em `.agent-flow/model-images/imports` ou `AGENT_FLOW_MODEL_IMAGE_CATALOG_PATHS`, registry remoto salvo no workspace em `.agent-flow/model-images/remote-registries.afmodelregistry.json`, formulário visual para salvar/remover URLs curadas sem credenciais, sync visual de catálogos descobertos entre workspaces e sync remoto read-only por registries salvos ou URLs HTTP(S) em `AGENT_FLOW_MODEL_IMAGE_CATALOG_REMOTE_URLS` com botões `Remoto`/`Sync remoto`, timeout de 5s, limite de 1 MB por catálogo e merge sem envio de credenciais Docker/env values, detecção de GPU local por `nvidia-smi` e runtime NVIDIA no Docker por `docker info`, seletor visual `CPU/GPU` para subir modelos Ollama sem editar `.env`, ação visual `Testar GPU` para executar `docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi -L` e registrar o probe no histórico, diferenciação visual entre `Baixar zip preliminar` e `Baixar zip final`, auditoria estrutural de exportabilidade do ZIP, runbook para rodar fora do Builder com rotas reais por agente, porta real do `docker-compose.yml`, passo `model-setup` quando houver modelos locais e passos opcionais para imagem Ollama pré-carregada/exportável/publicável/perfil GPU/probe GPU quando os overrides existirem, runbook JSON por agente, relatório JSON de prontidão/exportação sem valores de `.env` com `agentOperations` para runtime monoagente ou bundle multiagente, política de jobs sanitizada e resumo sanitizado da última orquestração do bundle, sem input bruto, memória compartilhada bruta, payloads de etapa ou timeline bruta, ZIP exportado com `.agent-flow/export-manifest.json` identificando tipo/target do pacote, comandos de setup de modelo e smoke do agente selecionado ou agregado de todos os agentes do bundle.
- Runtime manual, runtime gerado e bundle gerado com autenticação local por API key: `AGENT_API_KEY` como chave legada de acesso total, `AGENT_API_KEYS` para múltiplas chaves, `AGENT_API_KEYS_PATH` para arquivo JSON local rotacionável sem rebuild/restart e `AGENT_API_REVOKED_KEY_IDS`/`AGENT_API_REVOKED_KEY_IDS_PATH` para revogação local persistente por `key_id`, com expiração local por `expires_at`/`expiresAt`, scopes globais `metadata:read`, `auth:read`, `sessions:read`, `sessions:write`, `jobs:read`, `jobs:write`, `sessions:*` ou `*` e scopes por agente em bundles (`agents:<agent_id>:metadata:read`, `agents:<agent_id>:sessions:*`, `agents:<agent_id>:jobs:*`, `agents:<agent_id>:auth:read` ou `agents:<agent_id>:*`), incluindo proteção de SSE/WebSocket, query `api_key` para SSE de eventos/WebSocket em clientes de navegador, inventário seguro em `/auth/keys`, rate limit local opcional por credencial/escopo e auditoria via `/auth/audit`, com persistência local opcional em JSONL por `AUTH_AUDIT_PATH`, sem registrar valores brutos de chave.
- Studio Local envia `X-Agent-API-Key` nas chamadas HTTP ao runtime quando `STUDIO_RUNTIME_API_KEY` ou `AGENT_API_KEY` está configurada em `Secrets locais`, adiciona `api_key` na URL de SSE/WebSocket de eventos quando necessário, possui painel `Chaves de auth` para consultar `/auth/keys`, ver ativas/expiradas/revogadas, preparar `AGENT_API_REVOKED_KEY_IDS` para o próximo start e exportar `.afauthkeys.json` governado sem valores brutos nem caminhos locais de arquivo, além do painel `Auditoria de auth` para consultar `/auth/audit`.
- `agent_id` operacional em metadata, sessões, eventos e runs locais, com resumo por agente e filtro por agente nos runs/timeline do Studio.
- Primeira camada de jobs pós-finalização no runtime manual e gerado, com tabela `agent_jobs`, evento `post_finish_pending`, listagem em `GET /jobs`, métricas agregadas e operacionais em `GET /jobs/metrics?window_hours=...` (status/tipo, pendências, tentativas, taxa de sucesso, duração média/mínima/máxima/p95, janela configurável, throughput, próxima pendência, leases ativos/expirados, finalizações na última hora e último término), retenção governada por `POST /jobs/cleanup` com `dry_run=true` por padrão para prévia e remoção explícita de jobs terminais antigos, detalhe em `GET /jobs/{job_id}`, execução manual em `POST /jobs/{job_id}/run`, reprocessamento por `POST /jobs/{job_id}/retry`, reagendamento explícito por `POST /jobs/{job_id}/schedule` com `delay_seconds` ou `run_at`, recorrência simples por intervalo, cron ou evento com `agent_job_schedules`, `POST /jobs/{job_id}/recurrence`, `GET /job-schedules`, `POST /job-schedules/run-due`, `POST /job-schedules/trigger-event` e `POST /job-schedules/{schedule_id}/disable`, lote nativo em `POST /jobs/run-pending` e `POST /jobs/retry-failed`, `max_attempts`, `last_error`, `next_run_at`, claim/lease multiworker por `worker_id`, `locked_until` e `WORKER_LEASE_SECONDS`, worker CLI opcional `python -m app.worker --once` e serviço `worker` no Docker Compose final configurável por `WORKER_INTERVAL_SECONDS`, `WORKER_LIMIT`, `WORKER_RETRY_DELAY_SECONDS`, `WORKER_LEASE_SECONDS` e `WORKER_CLEANUP_*`, com cleanup automático desligado por padrão e emitindo eventos de job, limpeza e agenda recorrente/event-driven.
- `/metadata` do runtime manual, gerado e bundle gerado expõe `operations.jobs` com comando do worker, intervalo, limite, retry delay, lease, suporte multiworker, política de retenção/cleanup automático, status terminais e suporte a schedules por intervalo, cron básico e evento, sem retornar chaves, URLs sensíveis ou valores de `.env`.
- Streaming do turno por SSE em `POST /sessions/{session_id}/turn/stream` e por WebSocket em `/sessions/{session_id}/turn/stream/ws`, emitindo `turn_started`, `token`, `turn_completed` e `stream_closed`, preservando idempotência e usando callback incremental do grafo/LLM quando disponível, com fallback por resposta final.
- Spans nativos do runtime durante a execução do grafo, emitidos como `span_started` e `span_completed` em `/events`, SSE e WebSocket, com `span_id`, `node_id`, `node_type`, `duration_ms`, `source=runtime_native_span` e `payload.span` consumível pelo Studio.
- Geração de `.agent-flow/generated-meta.json` com hash determinístico do projeto.
- Separação clara entre pacote de sandbox LangGraph e runtime FastAPI/Docker final.
- Artefatos navegáveis pela UI e exportáveis em zip.

### Studio Local

- Start/stop de runtime local.
- Faixa `Status global do Studio` no topo do painel, resumindo sessão, runs, eventos, nó/falha em foco e uma ação primária contextual.
- Gate de aprovação no Studio, com status por hash, versão, cobertura `flow/assets`, artefato, evidência de run/sessão/eventos e CTAs `Preparar sandbox`, `Registrar aprovação`, `Handoff cloud`, `Endpoint`, `Deploy cloud` e `Gerar runtime final`, mantendo o runtime final bloqueado até aprovação válida, persistindo a evidência resumida no approval JSON sem payload bruto nem secrets, gerando handoff opcional `.aflangsmithhandoff.json` para LangSmith/LangGraph Cloud sem chamar cloud nem salvar token, registrando evidência local de deploy/verificação externa em `.aflangsmithdeployments.json` com URLs sanitizadas e bloqueio de `viewer`, disparando deploy opcional por endpoint governado `AGENT_FLOW_LANGSMITH_CLOUD_DEPLOY_URL`/`AGENT_FLOW_LANGSMITH_CLOUD_DEPLOY_TOKEN` com token somente no header, e sincronizando opcionalmente esses registros com central HTTP por `AGENT_FLOW_LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_URL`/`AGENT_FLOW_LANGSMITH_CLOUD_DEPLOYMENTS_CENTRAL_TOKEN`, com token somente no header e status sem URL/token.
- Criação de sessão, start, turn, finish, transcript, events, stream SSE de eventos em `/events/stream` e WebSocket de eventos em `/events/ws`.
- Painel `Eventos ao vivo` no Studio para conectar/desconectar stream do runtime por WebSocket ou SSE e acompanhar novos eventos sem esperar atualização manual.
- Painel `Execução ao vivo` no Studio, derivado da timeline atual, com progresso por nó, último evento, spans observados, duração, tokens/custo e uso por provider/modelo.
- Painel `Telemetria histórica` no Studio, agregado a partir dos runs locais persistidos por flow, com janela configurável, runs/eventos medidos, tokens, custo, provider/modelo, erros, último run/evento observado, alertas locais por limite de tokens/custo por provider, dashboard histórico dedicado por provider com snapshots persistidos em `.agent-flow/provider-telemetry-dashboard-history/history.json`, tendência/deltas/maior custo/maior uso, export/comparação `.afprovidertelemetryhistory.json`/`.afprovidertelemetryhistory-diff.json`, merge e sync central opcional por `AGENT_FLOW_PROVIDER_TELEMETRY_DASHBOARD_HISTORY_CENTRAL_URL` com token somente no header/status sem URL ou token e diff sem payload de telemetria bruto, além de inbox local/exportável/compartilhada file-backed de alertas `.aftelemetryalerts.json` em `.agent-flow/provider-telemetry-alerts/inbox.aftelemetryalerts.json`, sync central opcional por `AGENT_FLOW_PROVIDER_TELEMETRY_ALERTS_CENTRAL_URL`/`AGENT_FLOW_PROVIDER_TELEMETRY_ALERTS_CENTRAL_TOKEN`, roteamento lógico local por `AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTES` com regra aplicada, canal, motivo e breakdown visual, escalonamento local por `AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ESCALATION_POLICY` com nível, prioridade e motivo, política de entrega por `AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_DELIVERY_POLICY` com prioridade mínima, limite de lote por rota e cooldown local por alerta, relatório governado de prontidão por `GET /flows/:flowId/provider-telemetry-alerts/delivery-readiness` e export `.afproviderdelivery.json`, entrega externa governada por rota via `AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTE_SINKS`/`AGENT_FLOW_PROVIDER_TELEMETRY_ALERT_ROUTE_DISPATCH_TIMEOUT_MS`, ações `Central`/`Sync central`/`Rotas`/`Prontidão`/`Enviar rotas`, token somente no header, status sem URL/token, retenção, reconhecimento governado com `acknowledgedBy`/`acknowledgedRole`, bloqueio de `viewer`, reabertura por nova ocorrência e exclusão de eventos brutos, URLs de webhook ou secrets.
- Painel `Histórico de sandbox` no Studio, agregado a partir dos runs locais persistidos por flow, com janela configurável, filtro de falhas, runs/eventos/falhas, contagem de containers, VMs, microVMs, hardening, isolamento VM verificado, isolamentos gerais, agrupamento por nó, modo, isolamento, orquestração, executor, transporte, assurance, imagem/engine/rede/perfil/política, último erro, último run/evento observado e export governado `.afsandboxtelemetry.json` sem eventos brutos, state bruto, envs, secrets ou arquivos do workspace isolado.
- Consumo visual básico de `turn/stream` por SSE ou WebSocket no Studio, com painel `Resposta em streaming`, seletor de transporte, contador de tokens, origem dos chunks, texto incremental, conclusão e erro do stream.
- Painel `Jobs pós-finalização` no Studio, com resumo de `operations.jobs` observado em `/metadata` para worker, retry/claim multiworker, retenção e schedules, métricas agregadas e operacionais de sucesso/duração/atividade recente, janela de telemetria selecionável, breakdown por status/tipo, filtro por sessão/todos/status, payload/resultado/erro, ações individuais ou em lote para executar pendentes e reprocessar falhos, prévia e execução de limpeza governada de jobs terminais antigos em 7 dias, histórico local e compartilhável por workspace de snapshots de métricas em `.agent-flow/runtime-job-metrics-history/history.json`, exportação `.afjobmetrics.json`, comparação governada `.afjobmetrics-diff.json`, sync central opcional por `AGENT_FLOW_RUNTIME_JOB_METRICS_HISTORY_CENTRAL_URL` com token somente no header/status sem URL ou token e diff sem payload/resultado/erro bruto de jobs, além de criação, listagem, enfileiramento de vencidas e desativação de agendas recorrentes por intervalo no runtime local.
- Painel `Chaves de auth` no Studio, carregando `/auth/keys` com status de chaves ativas, expiradas e revogadas, origem, escopos, `agent_id`, revogação configurada, export governado `.afauthkeys.json` sem valores brutos/caminhos locais e ação `Revogar no próximo start`, que prepara `AGENT_API_REVOKED_KEY_IDS` nos Secrets locais sem mostrar valores brutos de chave.
- Entrada guiada por schema no Studio, derivando `user_message`, campos top-level adicionais, grupos aninhados de objetos tipados e arrays de itens simples ou estruturados, com validação simples por tipo, preview do payload real enviado ao runtime e persistência desse payload em cenários/fixtures.
- Idempotency key visível/editável para o envio manual de turno no Studio, enviada no header `Idempotency-Key` também no fluxo `turn/stream`.
- Saída do turno em modo renderizado e raw, associando a última resposta do transcript ao evento/payload bruto relacionado.
- Schema guiado de saída no Studio, comparando campos observados no output contra o schema do nó ou schema de saída do flow, com status de aderência por campo.
- Tool manager dedicado no Studio, inventariando nós de código, HTTP, MCP/sidecar, banco, arquivo, RAG e transformações, com status observado, último evento, contrato input/output, pin e ação de debug por nó, além de triagem agregada de falhas de sandbox por executor/nó com navegação direta para o evento.
- Secrets locais mascarados no Studio, derivados das env vars do flow, persistidos só no navegador e enviados ao backend apenas ao iniciar o sandbox local.
- Governança runtime/secrets no Studio, com prontidão de envs obrigatórias, pendências, envs customizadas, valores que serão enviados no start, políticas fixas do sandbox local e exportação manual controlada de `.env` local sem incluir envs protegidas do sandbox.
- Cenários, evaluators textuais/JSON path compostos, evaluators HTTP externos/LLM-as-judge, datasets locais por flow, origem estruturada por agente/run/sessão/nó/evento, filtros de cenários por tipo de origem/agente/run com execução de lote filtrado e seleção dos filtrados para dataset, cenário fixado, cenário favorito e repetição do último cenário por quick-run, dashboard local agregado de experimentos com snapshots históricos backend por workspace, painel histórico dedicado com tendência entre snapshots, deltas de OK/pass/runs, melhor/pior snapshot, drift de flow e janela histórica, export/comparação governada do histórico `.afexperiment-dashboard-history.json`/`.afexperiment-dashboard-history-diff.json` e sync central opcional por `AGENT_FLOW_EXPERIMENT_DASHBOARD_HISTORY_CENTRAL_URL` com token somente no header/status sem URL ou token, fila de anotação/revisão com cache local, sincronização backend por workspace, sync central opcional por `AGENT_FLOW_ANNOTATION_QUEUE_CENTRAL_URL`/`AGENT_FLOW_ANNOTATION_QUEUE_CENTRAL_TOKEN` com ações visuais `Central`/`Sync central`, token somente no header, status sem URL/token e sem envio de runs brutas, execução filtrada, histórico experimental, tendência contra execução anterior, melhor/pior execução, drift de flow, status pendente/aprovado/reprovado, responsável, ações de assumir, aprovar e reprovar pendências visíveis em lote, identidade local de revisor, policy local `open`/`assignee_only` com papéis `owner`/`reviewer`/`viewer`, enforcement backend por ator quando `x-agent-flow-actor` ou auth local do Builder está presente, filtros, trilha de auditoria compacta, histórico local/exportável de snapshots compactos da fila em `.afannotationhistory.json` sem payload bruto dos itens, primeira camada de detecção/resolução de conflitos de revisão com snapshots completos das versões compartilhada/recebida no pacote operacional, export/diff governado `.afannotation-conflicts.json`/`.afannotation-conflicts-diff.json` sem itens completos, snapshots, vereditos, razões, notas ou saídas observadas, diferenças compactas na UI, thread/atribuição visual de curadoria (`Assumir`/`Liberar`) com lease configurável por `AGENT_FLOW_ANNOTATION_CONFLICT_CURATION_LEASE_HOURS`, liberação automática de lease vencido, histórico compacto de eventos antes da decisão final, `resolutionHistory` compacta sem output observado bruto e tombstone para não reabrir conflito quando uma revisão descartada volta por sync, biblioteca compartilhável file-backed de cenários/datasets/evaluators em `.agent-flow/studio-scenarios/scenarios.afscenarios.json`, detecção de conflitos por hash de conteúdo de cenário/dataset/evaluator, diff compacto sanitizado por conflito sem input/payload bruto, painel `Conflitos de cenários compartilhados`, curadoria `Assumir`/`Liberar` com identidade local, papéis `owner`/`reviewer`/`viewer` e lease de atribuição configurável por `AGENT_FLOW_STUDIO_SCENARIO_CONFLICT_CURATION_LEASE_HOURS`, bloqueio visual de `viewer` para assumir/resolver, liberação automática de conflitos com lease vencido, resolução visual escolhendo qual candidato manter e histórico governado com refs mantida/descartadas, sync central opcional por `AGENT_FLOW_STUDIO_SCENARIOS_CENTRAL_URL` com token somente no header e ações visuais junto da biblioteca de datasets, import/export e merge de pacotes `.afevaluators.json`/`.afexperiments.json`/`.afexperiment-dashboard.json`/`.afannotations.json`.
- A revisão governada de conflitos compartilhados de cenários/datasets/evaluators expõe `GET /flows/:flowId/studio-scenarios/conflicts-review` e botão visual `Exportar revisão`, gerando `.afscenario-conflicts.json` com refs, diff compacto, thread de curadoria e histórico de resolução, sem candidatos completos, input bruto, payload bruto ou secrets. O Builder também compara uma revisão exportada contra o estado atual por `POST /flows/:flowId/studio-scenarios/conflicts-review/diff` e botão `Comparar revisão`, baixando `.afscenario-conflicts-diff.json` com deltas de conflitos, curadoria e histórico sem reintroduzir candidatos ou payload bruto.
- Cenários compartilhados também possuem enforcement backend: `viewer` pode inspecionar conflitos, mas recebe 403 ao tentar assumir/liberar ou resolver.
- Catálogo compartilhado também possui enforcement backend para conflitos: `viewer` pode inspecionar divergências, mas não consegue assumir/liberar ou resolver via API direta; eventos e histórico preservam o papel do curador, com lease padrão de 24h para liberar automaticamente conflitos assumidos e abandonados.
- Lista de runs locais persistidos por flow.
- Timeline de eventos.
- State inspector.
- Diferenças de estado por evento.
- Node IO inferido.
- Logs recentes.
- Comparação entre runs.
- Comparação de regressão entre runs com modo live/mock/pinned, eventos pinados/mock, tokens, custo estimado, veredito de revisão, thresholds por tipo de nó e inbox local/exportável/compartilhada file-backed de alertas `.afregressionalerts.json` em `.agent-flow/regression-alerts/inbox.afregressionalerts.json`, reconhecimento governado com `acknowledgedBy`/`acknowledgedRole` e bloqueio de `viewer`, sync central opcional por `AGENT_FLOW_REGRESSION_ALERTS_CENTRAL_URL` com ações `Central`/`Sync central`, token somente no header, status sem URL/token e sem runs brutas, payloads de nó ou secrets.
- Destaque causal no grafo: upstream, nó de falha, impacto e cascata.
- Painel "Contexto do nó" com status, papel causal, erro relacionado, eventos recentes, metadados do nó/LLM, prompt renderizado, input/output, estado, métricas, falhas de sandbox/executor customizado com causa provável e ação direta para filtrar logs, logs estruturados de código customizado com filtros/exportação JSON, spans estruturados, diffs e logs correlacionados.
- Diagnóstico automático por nó com causa provável, próximas ações e evidências do evento/snapshot, além de comparação contextual do nó selecionado entre run base e candidato com diffs de state/output, resumo multi-camadas de debug para fluxo/execução, estado/output, nó selecionado, eventos/erros, pins/mocks e checkpoints/cenários, ações guiadas por camada para focar nó/falha, criar cenário, exportar replay, usar pins, filtrar/executar checkpoints e revisar lote, roteiro guiado do cenário selecionado com origem, compatibilidade, restore, pins, execução, próxima ação, execução guiada passo a passo, comparação governada de checkpoint/pins/restore/evaluator, export `.afreplaygovernance.json`, histórico local/exportável `.afreplayhistory.json`, diff histórico `.afreplayhistorydiff.json`, histórico compartilhado file-backed por flow em `.agent-flow/replay-governance/history.afreplayhistory.json` e sync central opcional por `AGENT_FLOW_REPLAY_GOVERNANCE_HISTORY_CENTRAL_URL` com ações visuais `Central`/`Sync central`, todos sem payload bruto de cenário, pins, checkpoint ou secrets, além de ações de foco/filtro/replay/fixture, export `.afdebuglayers.json` sem payload bruto/secrets, compartilhamento file-backed dos resumos de camadas em `.agent-flow/debug-layers/snapshots.afdebuglayers.json` com formato `agent-flow-builder.debug-layer-snapshots.v1`, ações `Compartilhar resumo`/`Exportar revisão`/`Comparar revisão`/`Central`/`Sync central`, painel `Conflitos de camadas` com thread/atribuição local de curadoria (`Assumir`/`Liberar`), lease configurável por `AGENT_FLOW_DEBUG_LAYER_SNAPSHOT_CONFLICT_CURATION_LEASE_HOURS`, liberação automática de lease vencido e histórico compacto de eventos antes de resolver contexto duplicado escolhendo qual snapshot manter, revisão governada por `GET /flows/:flowId/debug-layer-snapshots/conflicts-review` e comparação por `POST /flows/:flowId/debug-layer-snapshots/conflicts-review/diff`, gerando `.afdebuglayer-conflicts.json` e `.afdebuglayer-conflicts-diff.json` sem snapshots completos, evidências, payload bruto, input/output ou secrets, histórico governado de resolução com revisor, papel local `owner`/`reviewer`/`viewer`, nota, snapshot mantido e refs descartadas sem payload bruto, bloqueio backend de `viewer` para assumir ou resolver conflitos, prevenção de reabertura quando a mesma ref descartada volta por sync, sync opcional por `AGENT_FLOW_DEBUG_LAYER_SNAPSHOTS_CENTRAL_URL` e token somente no header, export/import dedicado `.afdebugreplay.json` para replay governado do nó/candidato sem payload bruto de nós, pins ou checkpoint, painel de artefatos de replay com ação recomendada, roteiro visual de pacote/checkpoint/pins/cenário, foco no nó, carregamento de run base/candidato e promoção do replay importado para cenário local de revisão com checkpoint metadata-only, além da criação de cenário de debug reexecutável a partir do candidato.
- Curadoria governada de replay por revisor local, registrando decisão `approved`/`needs_review`/`monitor`, motivos, próxima ação e flags sem payload bruto dentro dos pacotes `.afreplaygovernance.json`, snapshots `.afreplayhistory.json` e diffs `.afreplayhistorydiff.json`.
- Conflitos de curadoria no histórico compartilhado de replay aparecem quando a mesma evidência/checkpoint/pins/evaluator recebe revisões divergentes; o Studio mostra `Conflitos de replay` com thread/atribuição local de curadoria (`Assumir`/`Liberar`), lease configurável por `AGENT_FLOW_REPLAY_GOVERNANCE_CONFLICT_CURATION_LEASE_HOURS`, liberação automática de lease vencido e histórico compacto de eventos com papel `owner`/`reviewer`/`viewer`, a API atualiza essa thread por `POST /flows/:flowId/replay-governance-history/conflicts/:conflictId/curation` e resolve por `POST /flows/:flowId/replay-governance-history/conflicts/:conflictId/resolve`, bloqueando `viewer` no backend, mantendo o snapshot escolhido sem payload bruto ou secrets, registrando `resolutionHistory` com revisor/papel/nota/snapshot mantido/refs descartadas e impedindo que a mesma ref descartada reabra o conflito quando retorna por sync; a revisão governada desses conflitos também pode ser exportada/comparada pelos botões `Exportar revisão`/`Comparar revisão`, rotas `GET /flows/:flowId/replay-governance-history/conflicts-review` e `POST /flows/:flowId/replay-governance-history/conflicts-review/diff`, arquivos `.afreplay-conflicts.json` e `.afreplay-conflicts-diff.json`, sem snapshots completos, payload de cenário, pins, checkpoint, input/output ou secrets.
- Diagnóstico contextual por tipo de nó para LLM, safety, code, HTTP, banco, arquivo/RAG, approval, scoring e analytics.
- Fork de checkpoint/evento para cenário local reexecutável, preservando origem estruturada do agente, run, sessão, evento, snapshot e metadata da reexecução.
- Restauração de cenário forkado no runtime gerado: o Studio envia `restore.state` e o FastAPI tenta primeiro recuperar estado real do checkpointer pelo `sourceSessionId`, caindo para o snapshot serializado quando necessário.
- Indicação visual da estratégia esperada e da origem observada do restore (`checkpointer` ou `snapshot`) no card do cenário e no `State inspector`.
- Validação de compatibilidade do checkpoint por `flowId`, versão, hash local, hash de projeto/assets e hash do nó, com bloqueio de execução quando o replay não combina com o flow atual.
- Pin local de input/output por nó no Studio, com indicador `atual/stale` quando a definição do nó muda, primeira camada compartilhável file-backed em `.agent-flow/studio-node-pins/pins.afnodepins.json`, formato `agent-flow-builder.studio-node-pins.v1`, ações visuais `Carregar pins`/`Sincronizar pins`, painel `Conflitos de pins` com thread/atribuição local de curadoria (`Assumir`/`Liberar`), lease de atribuição configurável por `AGENT_FLOW_STUDIO_NODE_PIN_CONFLICT_CURATION_LEASE_HOURS`, liberação automática de lease vencido e histórico compacto de eventos antes de escolher qual candidato divergente fica ativo, rotas `POST /flows/:flowId/studio-node-pins/conflicts/:conflictId/curation` e `POST /flows/:flowId/studio-node-pins/conflicts/:conflictId/resolve` e sync central opcional por `AGENT_FLOW_STUDIO_NODE_PINS_CENTRAL_URL`/`AGENT_FLOW_STUDIO_NODE_PINS_CENTRAL_TOKEN` com ações `Central`/`Sync central`; conflitos também possuem revisão governada por `GET /flows/:flowId/studio-node-pins/conflicts-review` e comparação por `POST /flows/:flowId/studio-node-pins/conflicts-review/diff`, com botões `Exportar revisão`/`Comparar revisão`, gerando `.afnodepin-conflicts.json` e `.afnodepin-conflicts-diff.json` sem candidatos completos, `pins`, input/output bruto ou secrets. O pacote preserva candidatos por `nodeId`/`id`, mantém ativo o candidato mais recente por nó, registra histórico governado de resolução com revisor, papel local `owner`/`reviewer`/`viewer`, nota, pin mantido e refs descartadas sem input/output bruto, bloqueia `viewer` no backend para assumir ou resolver conflitos, usa esse histórico para não reabrir conflito quando o mesmo candidato descartado volta por sync, mostra essa trilha no Studio, usa token somente no header, status sem URL/token e redaction de chaves sensíveis antes de salvar ou enviar input/output pinado.
- Cenários podem usar pins ativos como mock/replay determinístico por nó; a execução envia os pins na metadata da sessão e o runtime gerado evita efeitos reais do nó quando há pin compatível.
- Studio Local inclui templates visuais de cenário para `Caminho feliz`, `Bloqueio de safety`, `Replay com pins` e `Contrato JSON`, preenchendo formulário, input, tags, evaluator local, pins e thresholds sem salvar automaticamente.
- Cenários possuem thresholds de regressão para crescimento de tokens, custo e duração, além de limites explícitos por tipo de nó para quantidade de nós alterados e diffs de state/output; esses limites acompanham a metadata da execução, fixture e comparação e controlam o veredito de revisão.
- Cenários podem declarar critério textual `Saída contém`, enviado na metadata, preservado em fixture e usado no lote para falhar quando a resposta observada não contém o texto esperado.
- Cenários importam/exportam fixture JSON de replay com input, thresholds, checkpoint, pins ativos/stale e metadata exata enviada ao runtime.
- Cenários/fixtures podem ser executados em lote sequencial, com resumo por cenário, sessão, duração, erro, comparação automática com o run anterior do mesmo cenário, resumo multi-camadas agregado do lote, export `.afdebuglayers.json`, artefatos `.afdebugreplay.json` por nó/candidato importáveis no painel de replay, relatório JSON exportável e aprovação local por hash do lote.

### Aprovação E Runtime Docker

- Geração de sandbox LangGraph.
- Aprovação por hash de flow/assets.
- Approval JSON registra evidência resumida do Studio (`runId`, sessão, contagens, evento/nó em foco e flags sem payload bruto/secrets) e essa evidência é copiada para o runtime final aprovado.
- Bloqueio de geração do runtime final quando o hash aprovado está desatualizado.
- Geração de API FastAPI/Docker final aprovada.
- Controle operacional local pela UI:
  - status;
  - preparar `.env`;
  - configurar portas;
  - build;
  - cancelamento de build em andamento;
  - compose up;
  - compose down;
  - smoke test, incluindo seleção de agente e smoke agregado em bundles multiagente;
  - inspeção de serviços;
  - logs;
  - histórico operacional com filtros por operação, status, resultado, nível, texto, etapa de build e status do progresso.
- Docker Compose final sobe `api`, `worker`, `postgres` e `redis`; o worker processa jobs pós-finalização pendentes sem expor porta.
- Alertas operacionais persistentes para Build, Up e Smoke, destacando pendência, sucesso, erro e regressão após sucesso anterior.
- Progresso incremental durante `docker compose build`, com percentuais estimados quando o output do Docker não traz contagem explícita.
- Links para `/docs` e `/openapi.json` do runtime final.

## Objetivo De Produto

O objetivo é permitir que um usuário construa agentes tão completos quanto APIs feitas manualmente, sem perder capacidade por usar uma interface visual.

Isso inclui:

- conversas baseadas em sessão;
- perguntas guiadas pelo agente;
- consulta de conteúdo;
- geração de perguntas a partir de conteúdo;
- prompts versionáveis;
- LLM por adapter;
- mock determinístico;
- estado por conversa;
- idempotência;
- transcript;
- eventos;
- streaming de eventos do runtime por SSE/WebSocket;
- jobs pós-finalização com ponto de extensão local;
- safety;
- persistência;
- cache opcional;
- testes automatizados;
- empacotamento em API independente.

A interface visual deve acelerar o caso comum, mas sempre manter escape hatches para código customizado, tools externas, MCP, sidecars, adapters HTTP e runtimes futuros.

## Recursos Planejados

### Próximo Ciclo

- Ampliar auditoria visual automatizada para estados gerais de erro/loading em painéis específicos além do status global e do fluxo Docker.
- Melhorar ergonomia avançada do canvas com fluxos de debug guiados e curadoria compartilhável de presets de edição em lote; a primeira camada de edição em lote por seleção já cobre tags, LLM/schema, safety/stage, timeout, code/HTTP, Transform, Banco, Arquivo/RAG, Approval, Scoring e Analytics, com barra contextual, paleta de comandos contextual, inserção conectada de etapas por nó/aresta, conexão sequencial de seleção múltipla, remoção por `Delete`/`Backspace`, presets locais por flow, biblioteca local reutilizável entre flows, governança visual de origem/escopos/uso e exportação/importação `.afbatchpresets.json`.
- Evoluir edição visual de prompts, schemas e metadados para curadoria avançada de padrões reutilizáveis; a governança exportável do schema aberto, a biblioteca local/exportável de padrões de schema, preview/diff local de aplicação, export/import/revisão `.afschemapatterndiff.json`, histórico `.afschemapatternhistory.json`, export/import/revisão de diff histórico `.afschemapatternhistorydiff.json`, a primeira curadoria local por status/uso com lease expirável e histórico compacto `curationThread.events`, a sincronização file-backed por flow, a auditoria compacta de sync, o sync central opcional de padrões de schema com token somente no header, a detecção/visibilidade/resolução inicial de conflitos compartilhados de schemas e catálogo, o merge estrutural automático de schemas brutos sem colisão, a aplicação manual auditada pelo schema visual, a prevenção de reabertura idêntica em divergências compactas já resolvidas e o enforcement backend por ator autenticado local em mutações de padrões de schema já existem. Ainda falta governança multiusuário avançada de curadoria/colaboração.
- Refinar replay por pins e restauração de estado com execução passo a passo mais profunda; export/import governado `.afdebugreplay.json`, ações por camada, roteiro guiado do cenário selecionado, histórico local/exportável `.afreplayhistory.json`, histórico compartilhado file-backed em `.agent-flow/replay-governance/`, sync central opcional com token só no header, diff histórico `.afreplayhistorydiff.json`, curadoria local por revisor, thread/atribuição local para conflitos de replay, histórico governado de resolução/tombstone de replay e histórico governado de resolução de conflitos de pins com thread/atribuição local, lease/expiração e eventos compactos já existem como primeira camada.

### Médio Prazo

- Refinar governança de runtime/secrets com políticas compartilháveis opcionais; exportação manual controlada de `.env` local já existe.
- Alertas de regressão colaborativos/multiusuário avançados além da primeira inbox compartilhada file-backed e do sync central opcional já exportável por flow.
- Evoluir o catálogo local para governança compartilhada avançada entre workspaces; a primeira camada de governança local/exportável por item/biblioteca, a primeira biblioteca compartilhável file-backed com load/merge, sync central opcional com token somente no header, thread/atribuição visual de curadoria com lease/expiração, resolução guiada por estratégia, prevenção de reabertura idêntica de conflito resolvido e edição guiada de schemas internos já existem.
- Aprofundar a orquestração multiagente além da camada executável atual; assistente de composição no Runtime Manifest, contrato `orchestration`, política visual `memoryPolicy`, `POST /orchestration/run`, roteamento simples por condição explícita/textual/estruturada, memória governada da execução com persistência JSONL governada, `debug_trace` step-by-step, painel `Debug orquestração` no Docker/bundle com histórico local/filtros/comparação/export, contrato `agentIsolation`, cards por agente, link de metadata, seleção direta para smoke, histórico filtrado por agente, smoke agregado, runbook JSON por agente e primeira camada compartilhável/centralizável de cenários/datasets/evaluators do Studio com conflito/curadoria/resolução já existem. O pendente é colaboração distribuída mais profunda em cenários multiusuário avançados.
- Manter `npm run test:docker-runtime-smoke` como evidência repetível do container final real, `npm run test:portable-runtime-bundle` como evidência repetível de bundle multiagente removível fora do Studio e `npm run test:multiagent-postgres` como evidência repetível de PostgreSQL real compartilhado em bundles multiagente.
- Ampliar isolamento de código além das primeiras camadas container e VM runner local: a receita oficial local para preparar/publicar imagens microVM kernel-direct prontas já existe, e políticas de orquestração ainda mais fortes continuam como evolução para ambientes que exigirem isolamento próprio mais rígido. A primeira camada de imagens gerenciadas por executor, presets gerenciados de VM, manifestos verificáveis de runner/imagem VM com integridade SHA-256 opcional, scaffold QEMU com cloud-init/build/boot/transportador SSH, scaffold microVM direct-kernel com rootfs/kernel ou firmware/seed, política hardened e preflights Firecracker/Cloud Hypervisor, smoke real Docker/QEMU com cloud image Debian, smoke real opt-in Firecracker/Cloud Hypervisor por artefatos fornecidos, contrato de homologação `.afvmhomologation.json`, receita oficial local `vm-image:microvm-recipe`, pacotes `.afvmimagebundle` com manifestos sanitizados, imagem, artefatos de boot e manifesto de política copiados/verificados, `runner-kit` portátil auto-verificável, runner de referência para contrato Python local, runner QEMU de preflight com plano Q35/microVM, runner Firecracker/Cloud Hypervisor de preflight direct-kernel, guest agent Python para embutir na imagem, orquestração hardened de container, ponte VM local, histórico agregado por executor/sandbox/microVM/hardening/assurance e export governado de telemetria já existem no Studio.

### Longo Prazo

- Safety Harness avançado com governança contínua multiusuário; a primeira camada local configurável por nó, biblioteca exportável/importável de políticas, provider HTTP externo opcional no Builder e no runtime final, histórico backend por workspace, dashboard local por flow/nó, revisão humana simples/rápida com identidade local visível/exportada, bloqueio backend de revisão por `viewer` quando há auth local/ator do Builder, export `.afsafetyhistory.json` sem input bruto/secrets, diff governado `.afsafetyhistory-diff.json`, sync central opcional por `AGENT_FLOW_SAFETY_HARNESS_CENTRAL_URL` com token só no header e payload sanitizado, e histórico governado de resolução automática para colisões do mesmo run já existem.
- Políticas ainda mais avançadas de entrega/escalonamento ainda podem evoluir; streams de eventos por SSE/WebSocket, spans nativos durante a chamada, callback incremental de tokens no grafo, `turn/stream` SSE/WebSocket, painel de resposta incremental, painel visual de progresso por nó/uso por provider, telemetria histórica local com janela/alertas por orçamento, dashboard histórico dedicado por provider com snapshots/export/merge/sync central opcional/diff governado, inbox local/exportável/compartilhada file-backed, roteamento lógico por regra, escalonamento local por política, política de entrega com lote/cooldown/prioridade, prontidão exportável, dispatch externo governado por rota e sync central opcional de alertas de provider já existem.
- Isolamento operacional mais forte, escala e operação contínua refinada para jobs pós-finalização; schedule manual por job, recorrência simples por intervalo, cron ou evento, endpoint `POST /job-schedules/trigger-event`, endpoints nativos de lote, claim/lease multiworker, visualização operacional, telemetria com janela/p95/throughput, histórico local/compartilhável/exportável/comparável/sincronizável de métricas, limpeza governada com prévia e ações em lote via Studio já existem.
- Schedules operacionais avançados.
- Experiment suite avançada com colaboração multiusuário além dos cenários, evaluators locais/HTTP/LLM-as-judge, datasets, dashboard local com snapshots backend, painel histórico dedicado de experimentos, export/comparação/sync central opcional do histórico experimental, fila de revisão com backend por workspace, identidade local de revisor, policy local por responsável, papéis locais, auditoria compacta, curadoria atribuível de conflitos e detecção/resolução inicial de conflitos já existentes.
- Annotation queues colaborativas com colaboração distribuída mais profunda além da camada local/file-backed atual; já existem resolução governada, histórico/tombstone de conflitos, primeira governança central file-backed do workspace, checagem consultiva de autorização local, enforcement opcional nas rotas críticas do Builder e enforcement backend de `open`/`assignee_only` por ator quando há auth/header.
- Validação enterprise homologada de auth multiusuário contra IdP/serviço corporativo e operação distribuída fora do processo local; expiração local por chave, arquivo local rotacionável por `AGENT_API_KEYS_PATH`, revogação local persistente por `AGENT_API_REVOKED_KEY_IDS_PATH`, scopes por agente em bundles, `/auth/keys`, rate limit local, auditoria em memória e persistência local JSONL por `AUTH_AUDIT_PATH` já existem como primeira camada no runtime, e o Builder API/UI já possui auth local opcional por API key, JWT/JWKS/OIDC discovery, sincronização inicial de grupos por claims, diretório local de grupos, diretório corporativo HTTP opcional, política local por grupo, login OIDC local por authorization code + PKCE, refresh OIDC de sessão em memória, logout OIDC federado com `id_token_hint` de sessão em memória e callback validado por state, sessão local curta com renovação/logout local, persistência central local hash-only por `AGENT_FLOW_BUILDER_AUTH_SESSION_PATH`, sync HTTP externo de lifecycle de sessão por `AGENT_FLOW_BUILDER_AUTH_SESSION_SERVICE_URL`, introspecção/decisão central de sessão por `AGENT_FLOW_BUILDER_AUTH_SESSION_INTROSPECTION_URL`, probe governado `/builder-auth/external-probe`, inventário, auditoria local, sink HTTP central opcional de auditoria por `AGENT_FLOW_BUILDER_AUTH_AUDIT_SINK_URL`, rotação/revogação local por arquivo, escopos e expiração guiados como primeira camada própria.
- O gate `npm run test:builder-auth-corporate` valida o contrato corporativo local do Builder contra serviços HTTP simulados de sessão, introspecção central, audit sink e diretório de grupos, provando token apenas no header, persistência hash-only, fail-closed de sessão e respostas sem URLs/tokens/chaves brutas. Isso não substitui homologação contra um IdP real.
- Integração opcional com LangSmith Cloud além do handoff local governado, do registro local de deploy/verificação externa, do deploy por endpoint governado e do sync central opcional desses registros já gerados pelo Builder; deploy gerenciado acoplado diretamente a um provedor específico continua fora do caminho local-first.
- Runtime adapters dedicados para outras linguagens.

## Como Rodar Localmente

Pré-requisitos principais:

- Node.js.
- npm.
- Python para os testes/runtimes gerados.
- Docker, apenas para validar o runtime final em container.

Instale dependências:

```bash
npm install
```

Rode a API do Builder:

```bash
npm run dev:builder-api
```

Por padrão, ela sobe em:

```text
http://127.0.0.1:3333
```

Opcionalmente, configure catálogos remotos de imagens Ollama antes de iniciar a API do Builder. As URLs podem ser separadas por `;` ou `,`; o Builder só faz `GET` HTTP(S), não envia credenciais e rejeita payloads acima de 1 MB. A mesma configuração também pode ser salva pela UI no arquivo governado `.agent-flow/model-images/remote-registries.afmodelregistry.json`.

```powershell
$env:AGENT_FLOW_MODEL_IMAGE_CATALOG_REMOTE_URLS="https://exemplo.local/catalog.afmodelimages.json"
npm run dev:builder-api
```

Para sincronizar o catálogo de imagens/modelos entre máquinas por um serviço central próprio, configure o endpoint de sync central. O Builder envia o catálogo local por `POST`, recebe um catálogo de volta para merge, usa o token apenas no header `Authorization` e não coloca credenciais Docker, valores de `.env`, URL central ou token no status da UI.

```powershell
$env:AGENT_FLOW_MODEL_IMAGE_CATALOG_CENTRAL_URL="https://catalogo-interno.local/model-images/sync"
$env:AGENT_FLOW_MODEL_IMAGE_CATALOG_CENTRAL_TOKEN="token-do-servico"
$env:AGENT_FLOW_MODEL_IMAGE_CATALOG_CENTRAL_TIMEOUT_MS="5000"
npm run dev:builder-api
```

Para sincronizar o catálogo local de prompts/schemas/tools/templates/skills por um serviço central próprio, configure o endpoint central do catálogo. O Builder envia apenas a biblioteca compartilhável de itens locais, recebe uma biblioteca de volta para merge, mantém built-ins fora do pacote e não retorna URL/token no status.

```powershell
$env:AGENT_FLOW_CATALOG_CENTRAL_URL="https://catalogo-interno.local/catalog/sync"
$env:AGENT_FLOW_CATALOG_CENTRAL_TOKEN="token-do-servico"
$env:AGENT_FLOW_CATALOG_CENTRAL_TIMEOUT_MS="5000"
npm run dev:builder-api
```

Rode a UI:

```bash
npm run dev:builder-ui
```

Por padrão, ela sobe em:

```text
http://127.0.0.1:5173
```

Para abrir a mesma experiência como aplicativo desktop Electron local, rode:

```bash
npm run dev:desktop
```

O aplicativo desktop compila a UI, sobe a Builder API local em `127.0.0.1` quando ela ainda não estiver saudável, injeta a URL da API pelo preload e carrega o Studio sem depender de LangSmith Cloud.

## Comandos Úteis

Validar o flow de referência:

```bash
npm run validate:flow
```

Gerar runtime FastAPI/LangGraph:

```bash
npm run codegen:reference
```

Gerar sandbox LangGraph:

```bash
npm run codegen:sandbox
```

Gerar bundle por manifesto:

```bash
npm run codegen:manifest
```

Empacotar imagem VM por manifestos verificados:

```bash
npm run vm-image:bundle -- --flow-root flows/reference-interview --runner-manifest .agent-flow/vm-runners/agent-flow-vm-runner.manifest.json --image-manifest images/agent-flow-python.afvmimage.json --out dist/python-qemu-microvm.afvmimagebundle
```

Gerar scaffold local de imagem QEMU com cloud-init, guest agent, build/boot e transporte SSH:

```bash
npm run vm-image:scaffold -- --image-id python-qemu-microvm --out dist/python-qemu.vmimage
```

Gerar scaffold local de imagem microVM direct-kernel para Firecracker/Cloud Hypervisor, com rootfs, kernel ou firmware, seed opcional, runner e preflights:

```bash
npm run vm-image:scaffold -- --engine microvm --image-id python-direct-kernel-microvm --out dist/python-microvm.vmimage
```

Promover uma imagem microVM real preparada para um manifesto de homologação local:

```bash
npm run vm-image:homologate -- --flow-root dist/python-microvm.vmimage --runner-manifest manifests/runner.manifest.json --image-manifest manifests/image.manifest.json --preflight-evidence preflight.firecracker.json --boot-evidence boot.firecracker.json --out dist/python-microvm.vmimage/manifests/microvm.homologation.json
```

Gerar uma receita oficial local reprodutível para preparar, homologar, empacotar e publicar localmente uma imagem microVM kernel-direct:

```bash
npm run vm-image:microvm-recipe -- --image-id python-official-firecracker --channel local --version 0.1.0 --out dist/python-official-microvm.recipe
```

Registrar a release local gerada pela receita como configuração consumível pelo Studio/runtime:

```bash
npm run vm-image:microvm-register -- --release-index dist/python-official-microvm.recipe/release/microvm-image-release.json --out dist/python-official-microvm.recipe/release/microvm-image-release.afvmrelease.json
```

Executar verificações principais:

```bash
npm run typecheck
npm run test:mvp-main-path
npm run test:docker-runtime-smoke
npm run test:portable-runtime
npm run test:portable-runtime-auth
npm run test:portable-runtime-bundle
npm run test:onboarding-docs
npm run test:local-models-runbook
npm run test:release-privacy-audit-contract
npm run test:external-integrations-homologation
npm run test:isolation-levels-runbook
npm run test:multiagent-operations-runbook
npm run test:collaboration-conflict-contract
npm run test:expanded-plan-audit
npm run test:expanded-plan-requirement-audit
npm run test:expanded-plan-gate-matrix
npm run test:expanded-plan-evidence-report
npm run test:builder-auth-corporate
npm run test:vm-image-manifest
npm run test:vm-image-bundle
npm run test:vm-image-scaffold
npm run test:vm-microvm-image-scaffold
npm run test:vm-image-real-smoke
npm run test:vm-microvm-real-smoke
npm run test:vm-microvm-homologation
npm run test:vm-microvm-official-recipe
npm run test:vm-microvm-release-registration
npm run test:vm-reference-runner
npm run test:vm-qemu-runner
npm run test:vm-microvm-runner
npm run test:vm-guest-agent
npm run test:builder-api
npm run test:ui-theme
npm run test:codegen
npm run test:multiagent-postgres
npm run build:builder-ui
```

O gate `test:mvp-main-path` cobre o fluxo principal de ponta a ponta, incluindo aprovação por hash com evidência sanitizada do Studio, ZIP/runtime final com approval JSON embarcado, smoke Docker mockado e bundle multiagente aprovado.

O gate `test:docker-runtime-smoke` cobre o runtime gerado com Docker real: valida compose sem `.env` obrigatório, sobe API/Postgres/Redis/worker, testa health, metadata, sessão, start, turn, transcript, events, finish, jobs pós-finalização e logs sem erros críticos.

O gate `test:portable-runtime` cobre o pacote FastAPI removível fora do Studio: gera o runtime, copia o artefato para um diretório temporário consumidor fora do workspace, remove a origem gerada, valida metadados sem path absoluto do repo, README/Compose operacionais e executa `pytest` usando o pacote copiado como `cwd`.

O gate `test:portable-runtime-auth` cobre auth no pacote removível fora do Studio: ativa `AUTH_ENABLED=true`, valida bloqueio sem chave, scoped keys para metadata/sessões/auth, criação/start de sessão com chave operacional, `/auth/keys`, `/auth/audit` persistido e ausência de valores brutos de chave nos payloads e no JSONL.

O gate `test:portable-runtime-bundle` cobre o bundle multiagente removível fora do Studio: gera o pacote por `runtime.manifest.json`, copia para um diretório consumidor fora do workspace, remove a origem, valida metadata/`bundle.json` sem paths absolutos, Compose com `api`/`worker`, `app/worker.py` raiz com isolamento de import por agente e executa `pytest` a partir do pacote copiado.

O gate `test:onboarding-docs` valida a documentacao por perfil em `docs/user-guide.md`, `docs/operator-guide.md` e `docs/developer-guide.md`, preservando MVP principal 100%, plano expandido em andamento, local-first e regras de governanca.

O gate `test:local-models-runbook` valida `docs/local-models-runbook.md`, cobrindo Ollama local, `model-setup`, GPU NVIDIA, distribuicao de imagens de modelo e a evidencia externa `real-model-gpu-matrix`.

O gate `test:release-privacy-audit-contract` valida `docs/release-privacy-audit.md` como contrato da auditoria final de privacidade/release. Ele nao executa scan de PII/secrets por rodada; a evidencia real `final-release-privacy-audit` continua exigida antes de release/publicacao.

O gate `test:external-integrations-homologation` valida `docs/external-integrations-homologation.md` como contrato de homologacao de IdP, sessao central, auditoria central, diretorio, registries e LangSmith opcional. Ele nao chama servicos externos; as evidencias reais `real-corporate-idp` e `managed-langsmith-provider` continuam dependentes do operador.

O gate `test:isolation-levels-runbook` valida `docs/isolation-levels-runbook.md`, documentando quando usar processo local, workspace efemero, processo dedicado, container, container hardened, VM e microVM, incluindo fail-closed quando o runner nao prova isolamento.

O gate `test:multiagent-operations-runbook` valida `docs/multiagent-operations-runbook.md`, documentando operacao de bundles complexos, diferenca entre flow/agent/route/handoff/memory/orchestration step, debug trace, smoke por agente e isolamento por agente.

O gate `test:collaboration-conflict-contract` valida a visão agregada de pendências de colaboração, cobrindo áreas, templates de revisão/diff/curadoria/resolução, bloqueio de viewer por contrato e comparação governada sem schema/prompt/input/output/header/token/payload bruto.

O gate `test:expanded-plan-audit` cobre a regra de status do plano total expandido: extrai as 12 frentes de `projeto-final.md`, confirma que cada uma mantém itens pendentes e critérios, verifica que o MVP principal segue separado como 100%, bloqueia claim indevido de 100% do plano total e valida a matriz mínima de gates de evidência.

O gate `test:expanded-plan-requirement-audit` valida `docs/expanded-plan-requirement-audit.md` e emite o contrato `agent-flow-builder.expanded-plan-requirement-audit.v1`, listando IDs estaveis, linha de origem e hash por requisito do plano expandido sem texto bruto, payloads, headers, tokens ou secrets.

O gate `test:expanded-plan-gate-matrix` valida `docs/release-gate-matrix.md`, separando rotina diaria, release local, gates opt-in de VM/microVM e evidencias externas sem declarar 100% total.

O gate `test:expanded-plan-evidence-report` valida o contrato do relatório governado do plano expandido. Para gerar o JSON de evidência local em `.agent-flow/expanded-plan-evidence-report.json`, use `npm run report:expanded-plan-evidence`; o relatório preserva o status `in_progress`, lista as frentes/gates e não inclui tokens, headers ou payloads brutos.

O gate `test:builder-auth-corporate` cobre o contrato corporativo local do Builder com serviços HTTP simulados, validando session service, introspecção central obrigatória, audit sink, diretório de grupos e sanitização de payloads.

O gate `test:vm-image-manifest` cobre a integridade distribuível de imagens VM, validando manifesto de runner/imagem, SHA-256 correto e bloqueio por hash divergente sem executar código do usuário.

O gate `test:vm-image-bundle` cobre o empacotamento local `.afvmimagebundle`, validando manifestos sanitizados, imagem, artefatos de boot e `microvm.policy.json` copiados com SHA-256 verificado, ausência de paths locais de origem, variáveis portáveis para `AGENT_FLOW_CODE_VM_BOOT_ARTIFACTS`/`AGENT_FLOW_CODE_VM_SEED_IMAGE`/`AGENT_FLOW_MICROVM_POLICY_MANIFEST`, `runner-kit` portátil, check local do próprio pacote, runner de referência embarcado, guest agent embarcado, preflight QEMU, preflight Firecracker lendo a política empacotada e prontidão revalidada a partir do pacote.

O gate `test:vm-image-scaffold` cobre o scaffold local de imagem QEMU, validando cloud-init com guest agent, scripts de build/boot, transportador SSH, manifestos com `seed.iso` como artefato obrigatório de boot, ausência de paths locais/secrets e que o gate não baixa imagem nem inicia VM.

O gate `test:vm-microvm-image-scaffold` cobre o scaffold local direct-kernel para Firecracker/Cloud Hypervisor, validando scripts de preparo de rootfs/kernel ou firmware/seed, manifestos, runner microVM, preflight Firecracker, preflight Cloud Hypervisor com kernel e com firmware-only, ausência de paths locais/secrets e que o gate não baixa imagem nem inicia VM.

O gate `test:vm-image-real-smoke` roda em dry-run por padrão, gera o scaffold e reporta readiness do host sem iniciar VM. Com `AGENT_FLOW_VM_REAL_SMOKE=1`, ele pode usar QEMU/cloud-localds do host ou `AGENT_FLOW_VM_REAL_SMOKE_BACKEND=docker`; no backend Docker, `AGENT_FLOW_VM_DOWNLOAD_BASE_IMAGE=1` baixa/cacheia a cloud image Debian oficial, constrói a imagem QEMU, inicia a VM, espera SSH e executa o contrato no guest agent com `providesVmIsolation=true`. O runbook operacional está em `docs/vm-real-smoke-runbook.md`.

O gate `test:vm-microvm-real-smoke` roda em dry-run por padrão, gera o scaffold e reporta readiness para Firecracker ou Cloud Hypervisor sem iniciar VM. Com `AGENT_FLOW_MICROVM_REAL_SMOKE=1`, ele prepara rootfs/kernel ou firmware/seed fornecidos pelo operador e executa preflight real. Com `AGENT_FLOW_MICROVM_REAL_BOOT=1`, também escreve o config Firecracker quando necessário e inicia o processo microVM por uma janela curta; se `AGENT_FLOW_MICROVM_GUEST_TRANSPORT_COMMAND` estiver configurado com assurance `guest_vm`, valida o contrato no guest agent.

O gate `test:vm-microvm-homologation` cobre o contrato de homologação `.afvmhomologation.json`, validando os três estados: `blocked` sem evidência real, `preflight_verified` com evidência de preflight Firecracker/Cloud Hypervisor e `homologated` quando há evidência de boot real com isolamento VM. O manifesto final não inclui paths locais resolvidos, secrets nem env values.

O gate `test:vm-microvm-official-recipe` cobre a receita oficial local de publicação microVM: gera scaffold direct-kernel, scripts de build/preflight/homologação/bundle/publicação local, templates de evidência e checklist, prepara artefatos falsos sem download/boot, valida preflight real do runner, homologa com evidência sintética, empacota `.afvmimagebundle`, executa `runner-kit/check-bundle.mjs` e grava `release/microvm-image-release.json`, sem paths locais resolvidos ou secrets nos manifestos finais.

O gate `test:vm-microvm-release-registration` cobre o registro consumível da release microVM: lê `microvm-image-release.json`, valida bundle/homologação/check-bundle, gera `.afvmrelease.json`, `microvm-runtime-config.json` e scripts de ambiente, e confirma que a configuração registrada fica `ready` no checker local de VM sem executar código do usuário.

O gate `test:vm-reference-runner` cobre o runner de referência do contrato VM para Python inline/file, incluindo bloqueio de `sourcePath` fora do workspace e declaração explícita `providesVmIsolation=false`.

O gate `test:vm-qemu-runner` cobre o runner QEMU de preflight e transporte externo, validando descoberta de binário, manifesto/imagem/artefatos de boot com SHA-256, plano de comando Q35/microVM com `seed.iso`, ausência de execução de código do usuário no preflight, falha fechada sem transporte e execução do contrato via guest agent quando um transporte explícito é configurado. O teste usa transporte simulado e confirma `providesVmIsolation=false` nesse modo.

O gate `test:vm-microvm-runner` cobre o runner Firecracker/Cloud Hypervisor de preflight e transporte externo, validando descoberta de binário, manifesto/rootfs, kernel/seed com SHA-256, plano Firecracker por `--api-sock`/config e plano Cloud Hypervisor por `--kernel`/`--disk`/`--api-socket`, ausência de execução de código do usuário no preflight, falha fechada sem transporte e execução do contrato via guest agent quando um transporte explícito é configurado.

O gate `test:vm-guest-agent` cobre o executor Python que deve ser embutido na imagem VM, validando contrato inline/file por stdin/stdout JSON, bloqueio de `sourcePath` fora do workspace e falha fechada para protocolo ou linguagem não suportada.

Executar a bateria mais ampla usada no projeto:

```bash
npm run validate:flow
npm run codegen:reference
npm run codegen:sandbox
npm run codegen:manifest
npm run typecheck
npm run test:baseline
npm run test:generated
npm run test:manifest
npm run test:parity
npm run test:mvp-main-path
npm run test:docker-runtime-smoke
npm run test:portable-runtime
npm run test:portable-runtime-auth
npm run test:portable-runtime-bundle
npm run test:onboarding-docs
npm run test:local-models-runbook
npm run test:release-privacy-audit-contract
npm run test:external-integrations-homologation
npm run test:isolation-levels-runbook
npm run test:multiagent-operations-runbook
npm run test:collaboration-conflict-contract
npm run test:expanded-plan-audit
npm run test:expanded-plan-requirement-audit
npm run test:expanded-plan-gate-matrix
npm run test:expanded-plan-evidence-report
npm run test:builder-auth-corporate
npm run test:vm-image-manifest
npm run test:vm-image-bundle
npm run test:vm-image-scaffold
npm run test:vm-microvm-image-scaffold
npm run test:vm-image-real-smoke
npm run test:vm-microvm-real-smoke
npm run test:vm-microvm-homologation
npm run test:vm-microvm-official-recipe
npm run test:vm-microvm-release-registration
npm run test:vm-reference-runner
npm run test:vm-qemu-runner
npm run test:vm-microvm-runner
npm run test:vm-guest-agent
npm run test:multiagent-postgres
npm run test:builder-api
npm run test:ui-theme
npm run test:codegen
npm run build:builder-ui
```

## Estrutura Do Repositório

```text
apps/
  builder-api/     API local do Builder/Studio
  builder-ui/      interface visual em React/Vite
packages/
  flow-spec/       contrato do agent.flow.json
  codegen-langgraph/ codegen para LangGraph/FastAPI
flows/
  reference-interview/ flow de referência versionável
generated/
  reference-interview-runtime/ runtime FastAPI gerado
  reference-interview-langgraph-sandbox/ sandbox LangGraph gerado
  reference-runtime-bundle/ bundle multiagente gerado
examples/
  reference-interview-runtime/ baseline manual
docs/
  documentação de plano, status, arquitetura e UX
tools/
  verificadores auxiliares
```

## Documentação Principal

- `docs/implementation-status.md`: estado real implementado, verificado e pendente.
- `docs/quickstart-10-min.md`: caminho curto para um usuario novo subir o Builder, validar um flow e operar a API final fora do Studio.
- `docs/user-guide.md`: guia para criar, testar, depurar, aprovar e gerar API Docker pela interface.
- `docs/operator-guide.md`: guia para operar o runtime final, auth local, modelos, gates e integracoes externas.
- `docs/developer-guide.md`: guia para continuar o monorepo preservando contratos, testes e identidade visual.
- `docs/local-models-runbook.md`: preparo de Ollama/modelos locais, GPU NVIDIA, imagens de modelo e evidencias externas.
- `docs/release-privacy-audit.md`: contrato da auditoria final de privacidade/release sem scan por rodada.
- `docs/external-integrations-homologation.md`: contrato de homologacao de integracoes externas opcionais sem chamada real no gate.
- `docs/isolation-levels-runbook.md`: escolha de processo, container, hardened, VM e microVM por risco.
- `docs/multiagent-operations-runbook.md`: operacao, debug, handoffs, memoria e isolamento de bundles multiagente.
- `docs/expanded-plan-requirement-audit.md`: auditoria requisito-a-requisito governada do plano expandido.
- `docs/release-gate-matrix.md`: matriz de gates diarios, release local, opt-in e evidencias externas do plano expandido.
- `docs/master-implementation-plan.md`: plano mestre do produto.
- `docs/local-studio-plan.md`: plano do Studio Local.
- `docs/proup-capability-parity.md`: benchmark de capacidade para evitar regressão.
- `docs/ux/`: decisões de UI/UX, regras visuais, análise de referências e roadmap visual.
- `docs/plan.md`: plano técnico consolidado original do workspace.

## Status

Este repositório está em desenvolvimento ativo.

A base atual já permite editar flows, selecionar e verificar adapter local Ollama, gerar artefatos, executar sandbox local, inspecionar runs, gerar runtime Docker aprovado, incluir serviço Ollama, detectar e executar pela UI o pull governado de modelos via profile `model-setup` no `docker-compose.yml` gerado quando o flow usa adapter local, retornar fallback prescritivo quando o modelo Ollama ainda não está baixado, gerar override para imagem local pré-carregada de modelos, construir, exportar como `.tar`, publicar essa imagem pelo Builder via `OLLAMA_MODEL_IMAGE`, registrá-la em catálogo local compartilhável sem credenciais, exportar/importar/mesclar esse catálogo pela UI, sincronizar pacotes `.afmodelimages.json` descobertos localmente entre workspaces, salvar/remover registries remotos curados no workspace, mesclar catálogos remotos HTTP(S) configurados por UI ou `AGENT_FLOW_MODEL_IMAGE_CATALOG_REMOTE_URLS`, sincronizar o catálogo central multiusuário por `AGENT_FLOW_MODEL_IMAGE_CATALOG_CENTRAL_URL`, gerar override GPU NVIDIA, escolher CPU/GPU no painel Docker sem editar `.env` com recomendação baseada em GPU local e runtime NVIDIA do Docker, executar probe manual de GPU em container CUDA descartável, e operar o primeiro bundle Docker multiagente com smoke por agente e smoke agregado. Ainda há trabalho planejado em refinamento de UX, playground avançado, cenários, pinning, orquestração multiagente avançada, validação prática ampla de Docker/GPU e adapters de runtime mais amplos.
