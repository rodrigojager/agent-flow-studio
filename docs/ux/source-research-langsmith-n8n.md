# Pesquisa UX: LangSmith Studio, n8n e skills de clone

Data da pesquisa: 2026-06-30.

Este documento consolida as referencias publicas usadas para orientar a experiencia do Studio Local do Agent Flow Builder. O objetivo e reproduzir o modelo mental, os fluxos de trabalho e a clareza operacional de produtos maduros, sem copiar codigo-fonte, assets, marca, textos proprietarios ou trade dress de terceiros.

Complemento: uma varredura navegada com a skill local `agent-browser` foi registrada em `docs/ux/agent-browser-sweep-notes.md`, com screenshots salvos em `docs/ux/_sweep-*.png`.

## Limite de Inspiracao

- Podemos nos inspirar em elementos publicamente observaveis: hierarquia de telas, sequencia de tarefas, estados visuais, nomes genericos de conceitos tecnicos, feedback de execucao e padroes de navegacao.
- Nao devemos copiar HTML, CSS, JavaScript, assets, marcas, textos especificos, icones proprietarios ou identidade visual distintiva.
- A interface final deve parecer uma ferramenta propria: mesma clareza de um studio de agente, mesma facilidade de um builder visual, mas identidade visual unica do Agent Flow Builder.

## LangSmith e LangGraph Studio

Fontes principais:

- `https://docs.langchain.com/langsmith/studio`
- `https://docs.langchain.com/langsmith/local-dev-testing`
- `https://docs.langchain.com/oss/python/langgraph/local-server`
- `https://docs.langchain.com/oss/python/langgraph/use-time-travel`

O LangSmith Studio e relevante porque organiza a experiencia em torno de um agente executavel, nao apenas de um diagrama. A documentacao publica descreve dois modos principais:

- modo de grafo, com escolha de assistant/thread/run, edicao de input do grafo e submissao de uma run;
- modo de chat, com mensagens, valores do grafo e visualizacao de execucao.

Tambem aparecem como conceitos centrais:

- assistants;
- threads;
- runs;
- historico de execucao;
- interrupcoes e human-in-the-loop;
- edicao manual de estado;
- checkpoints;
- time travel;
- fork a partir de um checkpoint;
- observabilidade de estado e fluxo.

A documentacao de desenvolvimento local mostra que `langgraph dev` sobe um Agent Server local, expoe API local, API docs e um link para Studio UI com `baseUrl` apontando para `127.0.0.1`. Isso confirma a separacao conceitual importante para o nosso produto:

- o servidor local executa o grafo;
- a UI controla, inspeciona e depura esse servidor;
- o Studio e uma camada de visualizacao e operacao.

Para o nosso Studio Local, a diferenca essencial e que nao queremos depender de LangSmith Cloud nem de `LANGSMITH_API_KEY` para o fluxo principal. Devemos implementar a camada de studio dentro do Agent Flow Builder e salvar traces localmente.

### O Que Aproveitar

- Abas ou modos para alternar entre grafo e conversa sem trocar de produto.
- Entidades claras: `Assistant`, `Thread`, `Run`, `Checkpoint`.
- Grafo como mapa do comportamento executavel, nao como decoracao.
- Painel de input/run sempre perto do grafo.
- Historico que permite voltar para runs anteriores e comparar estado.
- Fork/time travel como recurso avancado, escondido ate o usuario precisar.

### O Que Adaptar

- Trocar `Assistant` por `Agente` quando o contexto for do nosso produto.
- Usar `Thread/Sessao` em conjunto, porque o runtime FastAPI ja usa `/sessions`.
- Manter compatibilidade com LangGraph, mas fazer a UX principal funcionar sem cloud.
- Mostrar aprovacao por hash e geracao Docker, porque este e o diferencial do nosso fluxo.

## n8n

Fontes principais:

- `https://docs.n8n.io/workflows/components/nodes/`
- `https://docs.n8n.io/data/`
- `https://docs.n8n.io/data/data-pinning/`
- `https://docs.n8n.io/workflows/executions/manual-partial-and-production-executions/`
- `https://docs.n8n.io/workflows/executions/dirty-nodes/`
- `https://docs.n8n.io/workflows/components/sticky-notes/`
- `https://docs.n8n.io/workflows/components/canvas-groups/`
- `https://docs.n8n.io/code/expressions/`

O n8n e relevante pelo lado de construcao visual. A experiencia e intuitiva porque o usuario entende rapidamente a relacao entre canvas, nos, conexoes, input/output e execucao parcial.

Padroes importantes:

- painel de nos/paleta pesquisavel;
- canvas com nos conectados;
- duplo clique ou selecao para abrir detalhes do no;
- input e output do no em visoes estruturadas;
- dados em formato `Schema`, `Table` e `JSON`;
- execucao manual, parcial e de workflow inteiro;
- nodes "dirty" quando os dados anteriores ficam desatualizados apos mudancas;
- pinning/mocking de dados para testar sem repetir chamadas externas;
- sticky notes e grupos de canvas para explicar e organizar workflows;
- referencias e expressoes que ajudam o usuario a mapear dados anteriores.

### O Que Aproveitar

- Paleta pesquisavel por tipo de no e objetivo.
- Acoes contextuais sobre o no: executar, renomear, duplicar, desativar, excluir.
- Painel de detalhe com input/output lado a lado.
- Visoes `Schema`, `Table` e `JSON` para dados de execucao.
- Estado "stale/dirty" quando prompt, schema, conexao ou parametro muda depois de uma run.
- Pinning de payload, input de no e resposta mock para testes repetiveis.
- Grupos colapsaveis para trechos do agente, especialmente em fluxos multiagente.

### O Que Adaptar

- O nosso no de LLM precisa mostrar prompt renderizado, modelo, tokens, custo estimado e resposta bruta.
- O nosso no de safety precisa mostrar regra disparada, severidade e decisao.
- O nosso no de human input precisa mostrar interrupcao pendente, payload esperado e acao para continuar.
- O pinning deve ser chamado de "fixar cenario" ou "fixar dados de teste", para ficar claro que e recurso de desenvolvimento local.

## Skills Avaliadas

Fontes:

- `https://skillsllm.com/skill/ai-website-cloner-template`
- `https://terminalskills.io/skills/clone-website`

A skill `ai-website-cloner-template` e apresentada como uma skill open-source para clonar sites com agentes de codigo. A pagina do SkillsLLM mostra que ela tem alerta de seguranca em auditoria automatizada. Ela nao deve ser instalada nem usada como dependencia para este trabalho.

A skill `clone-website` do Terminal Skills e mais util como metodologia: reconhecimento com browser, extracao de tokens, especificacao de componentes, construcao por secoes e QA visual. Mesmo assim, o objetivo dela e clonar websites em Next.js, enquanto nosso objetivo e especificar uma ferramenta de produto propria.

Depois dessa avaliacao, a varredura pratica foi feita com a skill local instalada `agent-browser`, nao com essas duas skills externas. Elas continuam sendo referencias metodologicas, nao dependencias do projeto.

### Decisao

Usar as duas skills apenas como inspiracao metodologica:

- inventariar telas e estados;
- mapear componentes;
- descrever comportamento antes de implementar;
- validar responsividade;
- exigir QA visual;
- registrar gaps de paridade.

Nao usar como cloner literal, nao copiar codigo e nao substituir uma especificacao de produto por reconstrucao de pagina.

## Principios Derivados Para o Agent Flow Builder

- O primeiro clique deve deixar claro o proximo passo: editar, testar, aprovar ou empacotar.
- O canvas e o debug precisam conversar: selecionar um evento seleciona o no, selecionar o no mostra eventos, input, output e estado.
- O usuario nunca deve precisar abrir terminal para iniciar sandbox, rodar cenario, aprovar versao ou subir container final.
- Mudancas que invalidam testes anteriores devem ser visiveis como estado `desatualizado`, nao como erro misterioso.
- A interface precisa ter densidade de ferramenta operacional, nao aparencia de landing page.
- Tema claro e tema escuro precisam compartilhar tokens, espacamento, tipografia, estados e contrastes.
- A geracao Docker e parte do fluxo, nao um artefato escondido.
