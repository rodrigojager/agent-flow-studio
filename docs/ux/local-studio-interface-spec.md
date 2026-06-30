# Especificacao de Interface: Studio Local

Este documento descreve a interface alvo do Agent Flow Builder quando ele evoluir para uma ferramenta completa: Builder WYSIWYG, Studio Local, aprovacao e Runtime Docker em uma unica experiencia.

## Estrutura Geral

```text
Top Bar
Left Rail | Workspace Panel | Main Canvas / Studio Surface | Inspector
Bottom Drawer: Timeline / Logs / Events
```

A UI deve ser compacta, operacional e previsivel. O usuario deve conseguir entender o produto pelo proprio fluxo visual:

```text
Desenhar -> Testar -> Aprovar -> Empacotar
```

## Top Bar

Elementos:

- seletor de flow/agente;
- indicador de alteracoes nao salvas;
- status de validacao;
- status do sandbox;
- navegacao principal: `Flow`, `Studio Local`, `Artefatos`, `Runtime`, `Settings`;
- seletor de tema claro/escuro;
- modo de modelo: `Mock`, `Local`, `API`;
- acoes primarias contextuais.

Comportamento:

- em `Flow`, a acao primaria e `Validar`;
- em `Studio Local`, a acao primaria e `Rodar cenario`;
- em `Artefatos`, a acao primaria e `Gerar pacote`;
- em `Runtime`, a acao primaria e `Subir API`;
- se houver pendencias, a acao primaria mostra o bloqueio diretamente no botao ou no tooltip.

## Left Rail

O rail esquerdo e fixo e estreito. Ele deve conter icones com tooltip para:

- flows;
- arquivos;
- validacao;
- studio;
- runs;
- artefatos;
- runtime;
- configuracoes.

No modo expandido, abre um painel de workspace com:

- lista de flows;
- busca;
- status por flow;
- ultima run;
- aprovacao atual;
- atalhos para abrir artefato ou runtime gerado.

## Flow Mode

O modo `Flow` e o builder visual.

### Canvas

O canvas deve conter:

- pan, zoom e fit view;
- minimap;
- grid discreto;
- selecao por clique e marquee;
- drag de nos;
- conexoes por handles;
- insercao de no no meio de uma aresta;
- grupos colapsaveis;
- notas de canvas.

### Palette

A palette deve ser pesquisavel e organizada por objetivo:

- entrada;
- LLM;
- roteamento;
- safety;
- dados;
- integracoes;
- humano;
- avaliacao;
- finalizacao.

Cada item precisa mostrar:

- icone;
- nome curto;
- descricao de uma linha;
- quando usar;
- requisitos de configuracao.

### Inspector

O inspector direito muda conforme selecao:

- sem selecao: resumo do flow, diagnosticos e proximas acoes;
- no selecionado: configuracao do no;
- aresta selecionada: condicao, origem, destino e fallback;
- grupo selecionado: nome, descricao e colapso;
- arquivo selecionado: editor de prompt/schema.

O usuario nunca deve precisar editar JSON bruto para uma configuracao comum. O JSON deve existir como modo avancado.

## Studio Local Mode

O modo `Studio Local` e a area de teste, debug e aprovacao.

### Layout Padrao

```text
Threads/Runs | Execution Graph | Run Inspector
             | Timeline Drawer |
```

### Threads e Runs

Painel esquerdo:

- botao `Nova sessao`;
- lista de sessoes recentes;
- busca por id, nome ou status;
- lista de runs da sessao selecionada;
- badges: running, success, blocked, error, stale;
- duracao e horario;
- menu de run: replay, fork, exportar JSON, comparar.

Termos exibidos:

- usar `Sessao` como termo principal;
- mostrar `Thread ID` como detalhe tecnico;
- usar `Run` para cada execucao dentro da sessao.

### Execution Graph

O grafo de execucao deve ser o centro da tela.

Estados de no:

- `idle`: ainda nao executado;
- `queued`: aguardando;
- `running`: executando;
- `success`: concluiu;
- `blocked`: esperando humano ou aprovacao;
- `error`: falhou;
- `skipped`: ignorado por condicao;
- `stale`: resultado antigo invalido por mudanca posterior.

Comportamento:

- clicar no no abre input/output/eventos no inspector;
- passar mouse mostra duracao, status e ultima mensagem;
- clicar em evento da timeline destaca o no correspondente;
- `fit run` enquadra apenas os nos executados;
- replay anima a execucao pelos eventos salvos.

### Playground

O playground pode ficar no inspector ou em painel lateral quando a run nao iniciou.

Campos:

- payload inicial;
- mensagem do usuario para `turn`;
- idempotency key;
- modo mock;
- variaveis de ambiente visiveis sem revelar segredos;
- botoes `Criar sessao`, `Start`, `Turn`, `Finish`.

Regras:

- payloads devem ter templates derivados do schema do flow;
- erros de schema aparecem inline antes de enviar;
- cada envio cria um evento visivel na timeline;
- o transcript aparece junto da resposta do agente.

### Run Inspector

Tabs do inspector:

- `Resumo`: status, duracao, entrada, saida, erros e proximas acoes;
- `Node IO`: input, output, prompt renderizado, resposta bruta, schema e retries;
- `State`: snapshot atual, diff, busca e copiar path;
- `Transcript`: mensagens visiveis da sessao;
- `Events`: eventos operacionais;
- `Logs`: stdout/stderr do sandbox filtrado por run;
- `Aprovacao`: hash, assets cobertos e status da versao.

Visoes de dados:

- `Schema`;
- `Table`;
- `JSON`;
- `Diff`.

## Bottom Drawer

O drawer inferior e redimensionavel e persistente por usuario.

Tabs:

- `Timeline`;
- `Events`;
- `Logs`;
- `Problems`;
- `Artifacts`.

Comportamento:

- pode ficar recolhido sem perder notificacoes;
- abre automaticamente em erro;
- filtros por nivel, no, run e texto;
- clicar em item sincroniza grafo e inspector;
- suporta copiar trecho e exportar JSON.

## Artefatos Mode

O modo `Artefatos` mostra os arquivos gerados antes do runtime final.

Areas:

- pacote LangGraph opcional;
- runtime FastAPI gerado;
- diff entre versao atual e ultima gerada;
- metadados `.agent-flow/generated-meta.json`;
- hash do projeto;
- README e comandos.

O usuario deve conseguir abrir, baixar e regenerar artefatos sem sair da interface.

## Runtime Mode

O modo `Runtime` controla o container final.

Painel principal:

- status Docker;
- build log;
- compose services;
- healthcheck;
- Swagger link;
- smoke test;
- portas;
- variaveis de ambiente;
- botoes `Build`, `Up`, `Down`, `Smoke`, `Abrir docs`.

Bloqueios:

- se a versao nao estiver aprovada, `Build` fica bloqueado;
- se o hash mudou, mostrar `Aprovacao desatualizada`;
- se Docker nao estiver disponivel, mostrar acao de diagnostico e comandos equivalentes.

## Tema Claro e Escuro

Requisitos:

- toggle persistente;
- seguir preferencia do sistema no primeiro uso;
- tokens compartilhados entre todas as telas;
- contraste adequado em canvas, texto, JSON, badges e code blocks;
- nao depender de uma unica familia de cor;
- feedback de status deve funcionar nos dois temas sem perder legibilidade.

## Estados Vazios

Estados vazios devem sempre explicar a proxima acao:

- sem flow: `Criar flow` ou `Importar`;
- flow invalido: abrir diagnosticos;
- sem sandbox: `Iniciar sandbox`;
- sem sessao: `Nova sessao`;
- sem run: `Rodar cenario`;
- sem aprovacao: `Aprovar versao testada`;
- runtime bloqueado: mostrar motivo e link para o passo anterior.

## Personalidade Visual

A experiencia deve se aproximar da clareza do LangSmith Studio no debug de agentes e da fluidez do n8n na construcao visual, mas com identidade propria:

- superficies planas;
- bordas sutis;
- alta densidade organizada;
- tipografia legivel;
- icones funcionais;
- feedback direto;
- sem layout de marketing;
- sem cartoes decorativos aninhados.

