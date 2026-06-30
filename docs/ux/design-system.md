# Design System: Agent Flow Builder e Studio Local

Este documento define os fundamentos visuais para unificar Builder, Studio Local, Artefatos e Runtime.

## Direcao Visual

A ferramenta deve parecer um ambiente operacional de engenharia de agentes:

- clara;
- densa sem ser confusa;
- previsivel;
- orientada a tarefa;
- com feedback visual constante;
- sem estetica de landing page.

Inspiracoes funcionais:

- LangSmith Studio para debug de agentes, grafo, runs, threads e estado;
- n8n para canvas, nos, conexoes, execucao parcial, input/output e organizacao visual.

A identidade final deve ser propria.

Regras visuais e comportamentais mais especificas, derivadas dos screenshots logados e da varredura navegada, ficam em `docs/ux/visual-behavior-reference-rules.md`.

## Tokens

Tokens obrigatorios:

```css
--surface-base
--surface-panel
--surface-raised
--surface-overlay
--border-subtle
--border-strong
--text-primary
--text-secondary
--text-muted
--accent
--accent-muted
--focus-ring
--danger
--danger-muted
--warning
--warning-muted
--success
--success-muted
--info
--info-muted
--node-start
--node-llm
--node-safety
--node-data
--node-integration
--node-human
--node-eval
--node-end
```

## Tema Claro

Direcao:

- base clara neutra;
- paineis levemente elevados;
- bordas visiveis sem pesar;
- texto primario forte;
- status por cor e icone, nao so por cor;
- canvas com grid muito discreto.

## Tema Escuro

Direcao:

- base escura neutra;
- evitar fundo preto puro em grandes areas;
- paineis com separacao por borda e elevacao sutil;
- cores de status menos saturadas que no claro;
- code blocks com contraste alto;
- foco e selecao sempre perceptiveis.

## Tipografia

Requisitos:

- fonte sans legivel para UI;
- fonte mono para JSON, logs, IDs, paths e codigo;
- tamanhos compactos para paineis operacionais;
- headings pequenos em inspectors e drawers;
- sem letter spacing negativo;
- sem escalar fonte pelo viewport.

Escala sugerida:

- 12px: metadata, badges, labels;
- 13px: controles e linhas de tabela;
- 14px: corpo principal;
- 16px: titulos de painel;
- 18px: titulos de tela compactos.

## Espacamento e Layout

Escala:

- 4px: micro gap;
- 8px: gap padrao;
- 12px: padding compacto;
- 16px: padding de painel;
- 24px: separacao de secoes.

Regras:

- usar split panes redimensionaveis;
- manter dimensoes estaveis para toolbar, botoes, minimap e drawers;
- evitar cards dentro de cards;
- usar paineis e barras, nao caixas decorativas;
- em telas pequenas, inspector vira drawer lateral ou inferior.

## Componentes

### Botoes

Tipos:

- primary;
- secondary;
- ghost;
- danger;
- icon-only.

Regras:

- usar icone quando a acao for reconhecivel;
- tooltip em todo botao icon-only;
- texto curto;
- loading nao pode mudar largura do botao;
- disabled deve explicar motivo em tooltip.

### Tabs e Segmented Controls

Uso:

- tabs para paineis com conteudo diferente;
- segmented controls para modos mutuamente exclusivos.

Exemplos:

- `Flow | Studio Local | Artefatos | Runtime`;
- `Schema | Table | JSON | Diff`;
- `Mock | Local | API`.

### Badges

Badges devem combinar cor, icone e texto:

- `saved`;
- `dirty`;
- `valid`;
- `invalid`;
- `running`;
- `blocked`;
- `error`;
- `stale`;
- `approved`;
- `approval stale`.

### Drawers e Panels

Regras:

- drawers sao redimensionaveis;
- painel fechado preserva estado;
- erro pode abrir drawer automaticamente;
- usuario pode fixar largura/altura;
- preferencias ficam em storage local.

### JSON Viewer

Requisitos:

- colapso por objeto/array;
- busca;
- copiar path;
- copiar valor;
- mascarar segredos;
- diff antes/depois;
- mono font;
- quebra de linha configuravel.

### Logs Viewer

Requisitos:

- seguir/pausar;
- filtro por texto;
- filtro por nivel;
- copiar selecao;
- timestamp;
- correlation id;
- link para run/no quando possivel.

## Nos do Canvas

Cada no deve ter:

- icone;
- titulo;
- tipo;
- status;
- handles claros;
- resumo de configuracao;
- badges de erro/configuracao;
- porta de entrada e saida estaveis;
- menu contextual.

Cores por tipo:

- start: verde/teal;
- LLM: azul;
- safety: amarelo/laranja;
- data: ciano;
- integration: violeta moderado;
- human: rosa/magenta discreto;
- eval/scoring: indigo;
- end: cinza/verde.

Regras:

- status de execucao deve ser mais importante que cor de tipo durante run;
- no selecionado usa borda/focus ring, nao apenas sombra;
- no em erro mostra icone e borda de erro;
- no stale usa aviso discreto, nao vermelho;
- no bloqueado por humano usa estado bem visivel.

## Arestas

Tipos:

- normal;
- condicional;
- fallback;
- erro;
- human resume.

Comportamento:

- hover engrossa a linha;
- selecao mostra handles e label;
- erro de conexao aparece no proprio edge;
- durante run, aresta ativa recebe destaque temporario;
- edges nao executados ficam discretos no replay.

## Acessibilidade

Requisitos:

- contraste AA para texto essencial;
- foco visivel por teclado;
- tooltips acessiveis;
- labels em inputs;
- nao depender somente de cor;
- regioes redimensionaveis com limites minimos;
- testes em 1280x720, 1440x900, 1920x1080 e largura mobile.

## Responsividade

Desktop e o alvo principal, mas a UI nao pode quebrar em larguras menores.

Comportamento:

- abaixo de 1100px, workspace panel pode recolher;
- abaixo de 900px, inspector vira drawer;
- abaixo de 760px, top tabs viram menu;
- canvas mantem fit view e controles acessiveis;
- texto de botoes pode virar icone com tooltip.

## Checklist de QA Visual

Antes de declarar uma tela pronta:

- testar tema claro;
- testar tema escuro;
- testar flow vazio;
- testar flow com erro;
- testar run bem-sucedida;
- testar run com erro;
- testar aprovacao valida;
- testar aprovacao desatualizada;
- testar container parado, subindo e ativo;
- validar que textos nao se sobrepoem;
- validar que resize de paineis nao quebra o canvas;
- validar que todos os botoes icon-only possuem tooltip.
