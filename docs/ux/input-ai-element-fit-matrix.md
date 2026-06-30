# Matriz de Inputs, Elementos de IA e Funcionalidades

Data: 2026-06-30.

Este documento define qual tipo de entrada de informacao deve usar qual elemento de IA, qual componente visual e qual impacto no runtime. Ele complementa:

- `visual-behavior-reference-rules.md`
- `local-studio-product-decisions.md`
- `local-studio-interaction-model.md`

Objetivo: evitar que a interface copie apenas controles visuais. Cada controle precisa existir porque captura um tipo de informacao que alimenta uma funcao especifica do agente.

## Regra Base

Antes de criar qualquer campo, node, modal ou painel, responder:

1. Que tipo de informacao o usuario esta fornecendo?
2. Essa informacao e instrucao, dado de entrada, configuracao, credencial, memoria, estado, ferramenta, avaliacao ou artefato?
3. Ela altera o comportamento do agente ou apenas uma run de teste?
4. Ela precisa entrar no hash de aprovacao?
5. Ela deve aparecer no trace?
6. Ela deve ir para o runtime Docker final?

Se essas respostas nao estiverem claras, o controle ainda nao esta pronto para implementacao.

## Matriz Principal

| Tipo de input | Exemplos | Melhor UI | Melhor elemento de IA/runtime | Melhor uso | Evitar |
| --- | --- | --- | --- | --- | --- |
| Instrucao de sistema | identidade, regras, tom, limites | prompt blocks, `AGENTS.md`, editor visual + Markdown | LLM node, agent config | orientar comportamento geral do agente | guardar segredo ou dado de usuario aqui |
| Mensagem natural do usuario | pergunta, resposta de entrevista, pedido livre | chat input, playground, payload template | session `turn`, LLM node | conversa, coleta aberta, raciocinio | usar quando precisa de formato deterministico |
| Variavel de prompt | `{question}`, `{candidate_name}` | chips, input panel, form gerado por schema | template renderer | parametrizar prompts e cenarios | esconder estado ou config em variavel solta |
| Payload estruturado | JSON de `start`, formulario de sessao | schema form + JSON editor | session state, API contract | entrada de API e teste reproduzivel | substituir por prompt livre |
| Output estruturado | objeto JSON esperado, classificacao, score | output schema editor | structured output parser, tool/function calling | extrair dados, garantir contrato | usar para texto criativo livre |
| Arquivo | PDF, Markdown, CV, planilha, documento | upload/lista + preview + metadados | `file_extract`, RAG, state attachment | extracao, grounding, consulta documental | colar arquivo inteiro no prompt sem controle |
| Base de conhecimento | pasta, documentos versionados, chunks | dataset/doc panel, index status | RAG retrieval | responder com base em material local | usar memoria para substituir busca documental |
| URL/API externa | endpoint HTTP, webhook, MCP server | form de URL/auth/teste | `http_request`, MCP tool | buscar ou executar acao externa | colocar URL solta dentro do prompt |
| Tool/function | nome, descricao, argumentos tipados | manage tools modal, schema de argumentos | tool calling, MCP, deterministic node | acao externa ou computacao controlada | deixar LLM inventar argumentos sem schema |
| Credencial/secret | API key, token, header secreto | secret popover/panel, masked input | env var, provider auth, tool auth | autenticar chamadas | salvar em prompt, trace ou export sem intencao |
| Provider/modelo | OpenAI, OpenRouter, local model, mock | select compacto + advanced settings | LLM adapter | escolher motor de inferencia | misturar provider com prompt ou credencial |
| Estado da sessao | etapa atual, respostas coletadas, flags | state inspector, diff, JSON viewer | LangGraph state/checkpointer | continuidade do fluxo | tratar como memoria longa |
| Memoria longa | preferencias, fatos persistentes aprovados | memory panel + approval toggle | memory store | personalizacao entre sessoes | salvar tudo automaticamente sem aprovacao |
| Evento/log/trace | node rodou, input/output, erro, custo | timeline/waterfall + inspector | local trace store | debug e auditoria | usar como fonte de verdade de negocio |
| Cenario de teste | payload salvo, mock/pin data | scenarios panel, pin controls | local test fixture | reproduzir runs e bugs | misturar com runtime final sem rotulo |
| Dataset de avaliacao | exemplos, inputs/outputs esperados | dataset table | evaluator runner | regressao e comparacao | bloquear MVP antes de trace basico |
| Rubrica/evaluator | criterios, corretude, toxicidade | evaluator template/editor | scoring/evaluator node | medir qualidade/risco | substituir revisao humana em decisoes criticas |
| Human input | decisao, aprovacao, resposta manual | blocked state + resume panel | `human_input`, `approval_gate` | interromper e retomar fluxo | deixar LLM decidir acao irreversivel |
| Schedule/trigger | cron, daily, every few minutes | schedule modal | trigger/job worker | execucao automatica futura | prometer sem worker |
| Canal | Chat, Slack, email, Teams | channel card + connect/test | channel adapter | entrada/saida externa | aparecer ativo sem backend real |
| Subagente | agente especializado, worker logico | sub-agent card, manifest editor | multiagent runtime | separar responsabilidade complexa | criar subagente para logica simples |
| Artefato/runtime | Dockerfile, compose, OpenAPI | artifacts/runtime panel | codegen, Docker runner | empacotar API final | confundir sandbox com runtime final |
| Aprovacao/hash | assets cobertos, versao aprovada | approval review panel | release gate | liberar API Docker | aprovar sem run/teste/hash verificavel |

## Como Escolher o Elemento de IA

### Use LLM Node Quando

- a tarefa exige linguagem natural;
- ha ambiguidade semantica;
- o output pode variar, mas precisa seguir uma intencao;
- e aceitavel registrar prompt, resposta e custo no trace.

Nao usar LLM node para:

- transformacao JSON deterministica;
- roteamento simples por campo;
- chamada externa com contrato claro;
- validacao que pode ser feita por schema.

### Use Prompt Blocks Quando

- o usuario esta definindo comportamento linguistico;
- a ordem das mensagens importa;
- roles como system/human/AI/tool ajudam a explicar o prompt;
- variaveis precisam ficar visiveis.

UI recomendada:

- blocos por role;
- adicionar mensagem;
- output schema perto do prompt;
- tools perto do prompt;
- render/raw output.

### Use Structured Output Quando

- o runtime precisa consumir JSON;
- ha contrato de API;
- o resultado sera gravado em estado, banco, scoring ou analytics;
- erro de formato deve ser detectado antes de seguir.

UI recomendada:

- editor visual de propriedades;
- tipos;
- required;
- allowed values;
- politicas de propriedades adicionais;
- modo JSON/YAML avancado.

### Use Tool, MCP ou HTTP Request Quando

- o agente precisa agir fora do modelo;
- ha endpoint, funcao, banco, arquivo ou servico externo;
- argumentos podem ser tipados;
- precisa de teste de conexao e erro acionavel.

UI recomendada:

- nome;
- descricao;
- auth/secrets;
- argumentos;
- teste;
- mock opcional.

### Use RAG/File Extract Quando

- o agente precisa responder com base em documentos;
- arquivos podem ser versionados;
- e necessario citar ou rastrear origem;
- o conteudo e maior que um prompt saudavel.

UI recomendada:

- upload/lista;
- preview;
- status de indexacao;
- metadados;
- node IO mostrando trechos recuperados.

### Use State/Checkpoint Quando

- a informacao representa progresso do workflow;
- precisa sobreviver entre `start`, `turn` e `finish`;
- replay/time travel pode ser util;
- diff de estado ajuda debug.

Nao usar state como:

- memoria permanente de usuario;
- log operacional;
- substituto de transcript.

### Use Memory Quando

- a informacao deve persistir alem de uma sessao;
- o usuario ou operador aprovou salvar;
- o dado melhora interacoes futuras;
- pode ser inspecionado/removido.

Nao usar memory para:

- guardar todo transcript;
- guardar segredos;
- guardar trace/log.

### Use Evaluator/Scoring Quando

- e preciso medir qualidade;
- ha criterio explicito;
- queremos comparar versoes;
- ha dataset ou cenario salvo.

Nao usar evaluator para:

- desbloquear o MVP de Studio antes de trace local;
- tomar decisao irreversivel sem human approval.

### Use Human Input / Approval Gate Quando

- a decisao exige julgamento humano;
- ha risco operacional, financeiro, legal ou reputacional;
- o agente precisa pausar e retomar;
- a aprovacao precisa aparecer no trace.

UI recomendada:

- node em estado `blocked`;
- painel de decisao;
- motivo do bloqueio;
- payload a revisar;
- botao de continuar/rejeitar.

### Use Schedule/Channel Quando

- o agente precisa ser acionado fora do playground;
- ha evento externo ou periodicidade;
- existe runtime/worker capaz de executar sem UI aberta.

Nao usar schedule/channel como fachada antes de backend real.

## Impacto no Hash de Aprovacao

| Mudanca | Invalida aprovacao? | Observacao |
| --- | --- | --- |
| `agent.flow.json` | Sim | Fonte de verdade do grafo |
| Prompt referenciado | Sim | Altera comportamento |
| Schema referenciado | Sim | Altera contrato e validacao |
| Arquivos em `files/` usados pelo agente | Sim | Altera grounding/extracao |
| Manifest multiagente | Sim | Altera composicao do runtime |
| Config de provider/modelo | Sim, se fizer parte do runtime | Valor de secret nao entra no hash |
| Nome de env var exigida | Sim | Contrato do runtime mudou |
| Valor real de secret | Nao | Deve ficar fora do artefato/hash publico |
| Cenario de teste salvo | Nao, por padrao | Entra em evidencia de teste, nao no runtime |
| Pin/mock local | Nao, se for apenas teste | Se virar fixture embarcada, documentar |
| Run/trace/event/log | Nao | Evidencia, nao fonte de comportamento |
| Aprovacao anterior | Nao | E resultado do hash, nao entrada |

## Impacto no Trace

Deve aparecer no trace:

- input de run;
- output de run;
- node executado;
- prompt renderizado;
- output estruturado;
- tool call;
- HTTP/MCP request sem segredo;
- resposta de tool;
- erro;
- retry;
- safety decision;
- human approval;
- state diff;
- tokens/custo quando disponivel.

Nao deve aparecer em texto claro no trace:

- API key;
- token;
- password;
- header secreto;
- valor de env var sensivel;
- dado marcado como segredo.

## Mapeamento Para Telas Do Produto

### Flow

Usar para:

- criar nos;
- conectar fluxo;
- editar configuracoes estaveis;
- definir prompts/schemas/tools;
- ver erros de validacao.

Inputs principais:

- flow graph;
- prompt;
- schema;
- tool;
- adapter/modelo;
- files.

### Studio Local

Usar para:

- criar sessao;
- rodar cenario;
- testar start/turn/finish;
- ver trace;
- ver node IO;
- comparar run;
- aprovar versao.

Inputs principais:

- payload;
- mensagem do usuario;
- mock/pin data;
- secrets locais;
- human input.

### Artefatos

Usar para:

- ver sandbox LangGraph opcional;
- ver runtime gerado;
- ver diff;
- ver metadata/hash;
- exportar ZIP.

Inputs principais:

- target de geracao;
- assets cobertos;
- manifest;
- arquivos gerados.

### Runtime

Usar para:

- build Docker;
- up/down compose;
- healthcheck;
- smoke test;
- abrir `/docs`.

Inputs principais:

- env vars;
- portas;
- compose settings;
- aprovacao valida.

## Regras de UI Por Tipo de Input

### Texto Livre

- Usar textarea ou bloco de mensagem.
- Mostrar role quando for prompt.
- Mostrar variaveis detectadas.
- Oferecer preview renderizado quando houver template.

### JSON

- Usar form por schema quando possivel.
- Oferecer JSON editor como modo avancado.
- Validar antes de salvar/enviar.
- Mostrar path em erros.

### Segredo

- Input mascarado.
- Botao de revelar temporario.
- Escopo explicito.
- Nunca copiar automaticamente para trace.

### Arquivo

- Upload ou seletor local.
- Preview e metadados.
- Status de processamento.
- Aviso se arquivo entra no hash.

### Tool

- Nome e descricao obrigatorios.
- Argumentos tipados.
- Teste de chamada.
- Mock ou resposta exemplo.

### Avaliacao

- Template ou rubrica.
- Dataset/cenario associado.
- Resultado historico por versao.
- Nao bloquear criacao basica do agente.

## Exemplos de Escolha Correta

### Entrevista Guiada

- Pergunta ao candidato: prompt block + LLM node.
- Resposta do candidato: session turn.
- Extracao de dados da resposta: structured output.
- Score da resposta: scoring/evaluator.
- Pausa para revisao humana: approval gate.
- Persistencia publica: transcript/events.

### Agente Com Documento

- PDF/CV: file input + file extract.
- Pergunta sobre conteudo: RAG retrieval + LLM.
- Trechos recuperados: node IO.
- Resultado JSON: output schema.

### Agente Com Integracao Externa

- Endpoint CRM: HTTP/tool node.
- Token CRM: secret.
- Payload CRM: schema visual.
- Erro da chamada: event/log + node IO.
- Acao irreversivel: approval gate antes da chamada.

### Agente Multiagente

- Especialista separado: subagent.
- Roteamento deterministico: switch/router.
- Estado compartilhado: manifest/runtime state.
- Trace separado por agente: run inspector com filtro por agent id.

## Checklist De Implementacao

Para cada novo campo ou controle, registrar:

- tipo de input;
- componente visual usado;
- elemento de IA/runtime que consome;
- validacao;
- persistencia;
- se entra no hash;
- se aparece no trace;
- se vai para o runtime Docker;
- comportamento em tema claro/escuro;
- empty state;
- erro inline;
- tooltip se for icon-only.

