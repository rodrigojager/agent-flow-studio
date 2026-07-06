# Paridade ProUp E Capacidade De Desenvolvimento

Data: 2026-06-30.

Este documento registra o benchmark de nao regressao baseado na API ProUp informada no inicio do desenvolvimento.

A ferramenta nao deve limitar o que o usuario ja conseguia construir manualmente fora dela. A edicao visual deve acelerar a construcao, mas nao pode reduzir a potencia dos agentes.

## Decisao De Produto

A pergunta correta nao e "o usuario consegue fazer tudo visualmente?". A pergunta correta e:

```text
O usuario consegue recriar o mesmo comportamento dentro da ferramenta, por algum caminho suportado, testavel e empacotavel?
```

Esse caminho pode ser:

- no visual nativo;
- comportamento customizado por codigo;
- HTTP tool;
- MCP tool;
- worker/sidecar;
- pacote externo chamado por contrato;
- runtime adapter por endpoint ou por runner VM local quando o adapter tem `codeInline`/`codePath`.

Se a unica forma de preservar a capacidade for editar manualmente o runtime gerado depois da exportacao, a ferramenta ainda nao esta pronta para essa capacidade.

## Linguagens

Estado atual do projeto:

- Builder visual, validacao e codegen: TypeScript.
- Runtime final atual: Python, FastAPI, LangGraph, runner Node para nós JavaScript/TypeScript e executor Bash/Shell por processo para nós de script.

Regra de produto:

- Python, JavaScript, TypeScript e Bash/Shell podem ser caminhos nativos do runtime atual.
- Outra linguagem nao deve ser proibida como capacidade.
- Quando uma linguagem nao roda nativamente no runtime atual, ela deve entrar por HTTP, MCP, sidecar, pacote externo ou runtime adapter.

Portanto, a capacidade precisa ser reproduzivel; a linguagem pode variar.

Decisao adicional:

- a ferramenta nao precisa recriar a API ProUp na mesma linguagem original para ser considerada equivalente;
- a ferramenta precisa recriar o comportamento, o contrato HTTP, o estado, os efeitos colaterais, os testes e a capacidade de empacotar o agente;
- WYSIWYG nao pode ser o unico caminho para comportamento complexo;
- sempre que a configuracao visual ficar estreita demais, o produto deve oferecer codigo customizado, tool, adapter ou sidecar antes de exigir edicao manual do runtime exportado.

## Escape Hatch De Comportamento

O no `code` deve evoluir para um no de comportamento customizado real.

Ele deve permitir:

- declarar linguagem ou modo de execucao;
- declarar input schema;
- declarar output schema;
- declarar dependencias;
- acessar estado, contexto, arquivos, secrets, LLM client, banco e emissao de eventos por uma API controlada;
- testar isoladamente;
- aparecer no Studio Local com input, output, logs, erro, tempo e eventos;
- entrar no hash de aprovacao;
- ser empacotado no runtime Docker final.

Estado atual implementado:

- o Flow Spec aceita contrato explicito de linguagem, modo de execucao, arquivo, entry point, dependencias, input path, result path e codigo inline;
- o Builder UI edita esses campos no inspector do no `code`;
- o Codegen LangGraph copia arquivos referenciados por `codePath` para `app/code/` e inclui esses arquivos no hash de aprovacao;
- o runtime gerado executa codigo Python nativo por arquivo ou inline, com acesso controlado a input, state, settings, LLM client e helpers de contexto;
- o runtime gerado executa codigo JavaScript/TypeScript por arquivo ou inline via runner Node, com input e contexto serializados em JSON;
- o runtime gerado executa codigo Bash/Shell por arquivo ou inline via processo `bash`/`sh`, com contrato JSON por stdin/stdout e trace `shell_process`;
- o runtime gerado executa `codeExecution: "http"` por contrato externo com `input`, `context` e `contract` em JSON;
- o runtime gerado executa `codeExecution: "mcp"` contra tool MCP local via stdio, usando `initialize`, `notifications/initialized` e `tools/call`;
- o runtime gerado executa `codeExecution: "sidecar"` por subprocesso local com `input`, `context` e `contract` via stdin/stdout JSON;
- o runtime gerado executa `codeExecution: "runtime_adapter"` por endpoint de adapter com `input`, `context`, `contract` e metadados do adapter em JSON, ou pelo runner VM local quando `sandboxIsolation="vm"` e o adapter declara fonte local;
- executores externos de nós `code` aceitam `retryAttempts`, `payloadAllowPaths`, `redactPaths` e `maxPayloadBytes`, permitindo retry controlado, envio de estado por allowlist, redaction antes de sair do runtime e bloqueio de payload grande;
- o Builder UI possui biblioteca local de perfis de sandbox/payload para nós `code`, exportável/importável como `.afcodesandbox.json`, permitindo reutilizar isolamento, env allowlist, retry, allowlist, redaction, payload máximo e timeout sem copiar configuração manualmente;
- cada execução customizada registra metadados de sandbox/isolamento (`runtime_process`, `dedicated_process`, `node_runner_process`, `subprocess_stdio`, `external_endpoint`, `container`, `vm`, `declared_external` ou `ephemeral_workspace`) para manter depuração local e preparação para isolamento mais forte;
- executores process-backed (`sidecar`, `mcp`, Bash/Shell e JavaScript/TypeScript via runner Node) podem usar `sandboxIsolation: "ephemeral_workspace"` para rodar em cópia temporária de `app/code`, com `cwd` isolado, env allowlist opcional e descarte das escritas após a execução;
- código Python `native`/`inline`/`file` pode usar `sandboxIsolation: "dedicated_process"` para rodar em outro processo Python por stdin/stdout JSON, com cópia temporária de `app/code`, `sandboxEnvAllowlist`, trace `dedicated_process` e descarte das escritas após a execução;
- código Python `native`/`inline`/`file` também pode usar `sandboxIsolation: "container"` com `docker`/`podman`, `--network none`, imagem/engine configuráveis por preset gerenciado no Studio, por nó ou env, workspace temporário montado em `/workspace`, env allowlist e falha observável quando imagem/engine não estiverem disponíveis;
- código JavaScript/TypeScript `native`/`inline`/`file` também pode usar `sandboxIsolation: "container"` reutilizando o `code_runner.mjs` gerado, Node dentro da imagem escolhida ou de preset gerenciado, workspace temporário montado em `/workspace`, env allowlist e metadados de executor `node`;
- código Bash/Shell `native`/`inline`/`file` também pode usar `sandboxIsolation: "container"` com preset inicial `bash:5.2`, workspace temporário montado em `/workspace`, env allowlist e metadados de executor `bash`/`sh`;
- código Python/JavaScript/TypeScript/Bash-Shell `native`/`inline`/`file` também pode usar `sandboxIsolation: "vm"` como ponte para runner local externo, com `sandboxVmImageId`, presets gerenciados iniciais de VM para Python/Node, checker local de runner/imagem/manifestos VM sem executar código do usuário, validação opcional de SHA-256 da imagem, scaffold QEMU com cloud-init/build/boot/transportador SSH, scaffold microVM direct-kernel com política hardened, contrato de homologação `.afvmhomologation.json`, receita oficial local `vm-image:microvm-recipe`, registro consumível `vm-image:microvm-register`, empacotamento `.afvmimagebundle` com manifestos sanitizados, imagem copiada/verificada, `runner-kit` portátil auto-verificável, runner de referência opt-in para contrato Python local, runner QEMU/microVM de preflight, transporte externo explícito para guest e guest agent Python embutível na imagem, `sandboxVmRunner`, args, manifestos, engine, imagem, perfil, memória/vCPU, contrato `agent-flow-vm-runner.v1` por stdin/stdout JSON e trace `vm`/`microvm`;
- o runtime registra `custom_code_executed`, `custom_code_declared` ou `custom_code_failed` em `/events`, com `execution_log` e `span` estruturados para o Studio Local;
- outras linguagens continuam representaveis por contrato e podem rodar por HTTP, MCP, sidecar ou runtime adapter quando o runtime/container/VM tiver o executavel necessario.
- o catálogo built-in inclui o template `pro-up-parity-complex-agent`, que cria um flow completo com contrato `sessions-v1`, persistência Postgres/Redis, safety, transformação de contexto, consulta local por arquivo/RAG, escape hatch HTTP, LLM estruturado, código Python inline para estado, scoring, analytics, approval gate e pausa de input humano. Esse template serve como prova estrutural de paridade para conversa, perguntas, consulta de conteúdo, geração de perguntas, estado e avaliação sem exigir edição manual do runtime gerado.

Proxima etapa necessaria: executar/publicar imagens VM/microVM reais e políticas de container/VM ainda mais fortes quando endpoint/sidecar/MCP/workspace temporário/processo dedicado/container Python/JavaScript/TypeScript/Bash-Shell com imagens gerenciadas, presets VM, scaffold QEMU/microVM, homologação `.afvmhomologation.json`, receita oficial local `vm-image:microvm-recipe`, registro consumível `vm-image:microvm-register`, pacote `.afvmimagebundle` com runner-kit, runner de referência sem isolamento VM, runners QEMU/microVM de preflight, transporte externo explícito, guest agent embutível, perfil hardened e ponte VM local nao forem suficientes, além de recursos avancados de logs por sandbox isolado.

## Capacidades ProUp Que Precisam Ser Recriaveis

| Capacidade | Representacao Na Ferramenta | Observacao |
| --- | --- | --- |
| API conversacional | contrato `sessions-v1` | Criar, iniciar, turno, finalizar, transcript e events. |
| Agente que faz perguntas | prompt blocks, LLM node, switch, state | Deve suportar entrevista guiada e perguntas dinamicas. |
| Consultar conteudo | file node, RAG node, HTTP/MCP tool, code node | Conteudo pode vir de arquivo, banco, API ou ferramenta externa. |
| Gerar perguntas a partir de conteudo | LLM structured node com schema | Tambem pode usar code node para pos-processamento. |
| Estado por conversa | LangGraph state/checkpointer ou equivalente | Estado executavel separado de projecoes publicas da API. |
| Transcript | tabelas publicas da API | Mensagens visiveis separadas de eventos operacionais. |
| Events | trace/event store | Nos executados, LLM, safety, tools, erros e gates. |
| Idempotencia | runtime API + testes | Header `Idempotency-Key` e validacao de conflito. |
| Prompts em arquivos | asset editor + prompt refs | Versionaveis e cobertos por hash. |
| Schemas estruturados | schema editor + JSON Schema | Input/output/state schemas. |
| LLM real | LLM adapter | Adapter selecionado entra no runtime. |
| Mock LLM | mock env/config | Necessario para testes baratos e deterministas. |
| Persistencia relacional | runtime storage | Postgres/SQLAlchemy atual ou equivalente futuro. |
| Cache | runtime cache | Redis atual ou equivalente futuro. |
| Safety | safety gate + future harness | MVP simples, evolucao para harness. |
| Analises pos-finalizacao | analytics/scoring/job futuro/code node | Deve ter caminho, mesmo que nao seja MVP completo. |
| Testes automatizados | codegen de testes + smoke UI | Runtime gerado deve trazer testes relevantes. |
| Multiagente | `runtime.manifest.json` | Um FastAPI pode hospedar varios agentes quando fizer sentido. |
| Logica de negocio customizada | code node/tool/sidecar | Principal protecao contra engessamento visual. |
| Integracoes externas | HTTP/MCP/tool nodes | Evita acoplar regra externa no core. |

## Regra De Aceite

Antes de chamar uma fase de pronta, deve ser possivel apontar onde cada capacidade ProUp aparece:

- no flow visual;
- no manifesto;
- no runtime gerado;
- no Studio Local;
- no teste gerado;
- ou em backlog explicitamente marcado como dependencia da fase seguinte.

Se uma capacidade ProUp nao tiver representacao clara, ela vira requisito aberto, nao detalhe opcional.
