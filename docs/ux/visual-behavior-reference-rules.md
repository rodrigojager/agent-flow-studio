# Regras Visuais e Comportamentais Inspiradas nas Referencias

Data: 2026-06-30.

Este documento consolida regras praticas inferidas dos screenshots logados, da varredura navegada e da pesquisa publica. Ele deve ser usado como referencia de implementacao junto com `design-system.md`.

Objetivo: inspirar profundamente a experiencia do Agent Flow Builder em padroes que funcionam, sem copiar marca, textos proprietarios, codigo, assets ou identidade visual distintiva.

Para escolher qual elemento de IA usar para cada tipo de informacao recebida do usuario, usar tambem `docs/ux/input-ai-element-fit-matrix.md`.

## Regra Mestra

A interface deve parecer uma ferramenta profissional de operacao de agentes:

- clara;
- densa;
- calma;
- orientada a fluxo;
- com proximo passo sempre visivel;
- com configuracoes avancadas acessiveis, mas nao dominantes.

O visual deve ser parecido no modelo mental, nao uma replica literal.

## 1. Shell Persistente

Observado:

- LangSmith e Fleet usam sidebar esquerda persistente.
- O contexto de workspace/usuario fica sempre disponivel.
- Areas do produto ficam agrupadas por familias.

Regra para nossa UI:

- Manter sidebar/rail persistente com navegacao principal.
- Manter top bar compacta com flow/agente atual, estados e acoes principais.
- Evitar abrir telas soltas que removem o usuario do contexto.

Aplicar em:

- `Flow`;
- `Studio Local`;
- `Artefatos`;
- `Runtime`;
- `Settings`.

Nao aplicar:

- Home pesada com muitas areas ainda nao implementadas.
- Navegacao que pareca plataforma cloud generica.

## 2. Canvas Como Superficie Primaria

Observado:

- O builder de agente usa canvas amplo, blocos compactos e conexoes curvas.
- O no central representa o agente; entradas ficam a esquerda; capacidades ficam a direita.
- Zoom fica no canto inferior direito.

Regra para nossa UI:

- O canvas deve ser a superficie dominante em `Flow` e `Studio Local`.
- Controles de zoom/pan/fit devem ficar agrupados no canto inferior direito.
- Nos devem ser compactos, com cabecalho, corpo e acoes locais.
- Conexoes devem ser curvas ou suaves, com cor/status discreto.

Aplicar como:

- `Agent Overview`: visao de alto nivel com entradas, agente e capacidades.
- `Flow Graph`: grafo executavel detalhado.
- `Execution Graph`: grafo com status da run.

Anti-regressao:

- Nao transformar o canvas em uma lista de formularios.
- Nao esconder handles, status de no ou zoom.

## 3. Blocos de Agente em Camadas

Observado:

- Blocos recorrentes: `Schedule`, `Channels`, `Agent`, `Toolbox`, `Sub-agents`, `Skills`.
- Blocos vazios indicam o que falta configurar.
- Acoes aparecem no cabecalho do bloco: `Add`, `Edit`, `Create`, `Connect`.

Regra para nossa UI:

- Criar blocos de alto nivel para:
  - `Entrada`;
  - `Canais`;
  - `Agente`;
  - `Instrucoes`;
  - `Ferramentas`;
  - `Subagentes`;
  - `Skills`;
  - `Saida/API`.
- O cabecalho do bloco deve ter titulo curto e acoes contextuais.
- O corpo do bloco deve mostrar estado vazio, resumo configurado ou erro.

Anti-regressao:

- Blocos vazios precisam ter CTA ou motivo do bloqueio.
- Acoes do bloco devem operar aquele bloco, nao abrir menus globais confusos.

## 4. Top Bar Compacta Com Estados

Observado:

- Top bar exibe titulo, descricao, badges, identidade, share, settings, import e criar.
- Botoes desabilitados continuam visiveis.
- Tooltips explicam botoes icon-only.

Regra para nossa UI:

- Top bar deve conter:
  - voltar;
  - nome do flow/agente;
  - descricao curta;
  - badges de estado;
  - modo de execucao/modelo;
  - tema;
  - import/export;
  - acao primaria da etapa atual.
- A acao primaria muda por tela:
  - `Flow`: `Validar`;
  - `Studio Local`: `Rodar cenario`;
  - `Artefatos`: `Gerar artefato`;
  - `Runtime`: `Subir API`.

Anti-regressao:

- Botao desabilitado precisa explicar por que esta bloqueado.
- Icon-only sem tooltip nao passa QA.

## 5. Popovers Para Decisoes Curtas

Observado:

- Identidade, API keys, tracing, reset e output mode usam popovers.
- Popover aparece ancorado perto do botao.
- Conteudo e curto, com opcoes claras.

Regra para nossa UI:

- Usar popover para:
  - escolher modo mock/local/API;
  - selecionar provider/modelo;
  - configurar secrets simples;
  - alternar render/raw;
  - mostrar motivo de bloqueio;
  - escolher fonte de credenciais.
- Popover nao deve conter formularios longos.

Anti-regressao:

- Se exigir scroll longo ou muitas secoes, virar painel/modal.

## 6. Modais Para Configuracao Estruturada

Observado:

- MCP, Schedule, Output Schema, Manage Tools e Annotation Queue usam modal/pagina focada.
- Fundo escurecido preserva contexto, mas reduz distracao.
- Formularios possuem validacao inline e botoes finais claros.

Regra para nossa UI:

- Usar modal para:
  - MCP/custom tool;
  - output schema;
  - tool arguments;
  - schedule futuro;
  - configuracao de conexao externa;
  - aprovacao por hash quando exigir revisao de assets.
- Modal deve ter:
  - titulo claro;
  - descricao curta;
  - campos agrupados;
  - validacao inline;
  - cancel/confirm no rodape;
  - botao confirm desabilitado ate estar valido.

Anti-regressao:

- Modal nao deve esconder erro atras de toast generico.
- Modal nao deve perder o contexto do flow selecionado.

## 7. Split Panes Para Trabalho Tecnico

Observado:

- Trace usa arvore/waterfall + detalhe.
- Playground usa prompt + inputs/output.
- Studio usa grafo + thread.
- Editor usa explorer + preview/source.

Regra para nossa UI:

- Usar split panes redimensionaveis para:
  - `Studio Local`: runs/grafo/inspector;
  - `Trace`: timeline ou arvore + node IO;
  - `Playground`: prompt/payload + output/transcript;
  - `Arquivos`: explorer + editor/preview.
- Cada pane deve preservar largura/altura escolhida pelo usuario.

Anti-regressao:

- Nao empilhar tudo verticalmente em desktop.
- Nao abrir input/output em paginas separadas.

## 8. Empty States Com Proxima Acao

Observado:

- Home, Monitoring, Prompts, Annotation Queues, Context Hub e Studio usam empty states com icone, frase curta e CTA.
- Muitos empty states apontam para a etapa anterior necessaria.

Regra para nossa UI:

- Todo empty state deve conter:
  - icone;
  - titulo curto;
  - uma frase;
  - CTA primario;
  - link opcional para etapa relacionada.
- Empty states devem indicar dependencia:
  - sem sandbox -> `Iniciar sandbox`;
  - sem sessao -> `Nova sessao`;
  - sem run -> `Rodar cenario`;
  - sem aprovacao -> `Aprovar versao`;
  - runtime bloqueado -> motivo e link para Studio.

Anti-regressao:

- Tela vazia sem CTA e regressao de UX.

## 9. Badges Pequenos e Consistentes

Observado:

- `Draft`, `Private`, `latest`, `New`, `Upgrade required` aparecem como chips pequenos.
- Estados nao tomam a tela; ficam proximos do objeto afetado.

Regra para nossa UI:

- Usar badges compactos para:
  - `Rascunho`;
  - `Privado/Local`;
  - `Salvo`;
  - `Sujo`;
  - `Valido`;
  - `Invalido`;
  - `Testado`;
  - `Aprovado`;
  - `Desatualizado`;
  - `Rodando`;
  - `Erro`.
- Badge deve ter cor, texto e quando necessario icone.

Anti-regressao:

- Nao depender apenas de cor para comunicar estado.

## 10. Tooltip Como Parte Obrigatoria da Interface

Observado:

- Tooltips explicam import, reset, avaliacao e acoes icon-only.

Regra para nossa UI:

- Todo botao icon-only precisa de tooltip.
- Todo badge bloqueante ou desabilitado precisa explicar causa.
- Tooltips devem ser curtos e acionaveis.

Exemplos:

- `Aprovacao desatualizada: prompt principal mudou.`
- `Importar workspace ZIP.`
- `Rodar cenario atual.`

Anti-regressao:

- Tooltip nao substitui erro inline quando o usuario precisa corrigir campo.

## 11. Formularios Com Validacao Inline

Observado:

- Schedule mostra erro abaixo do campo.
- Create buttons ficam desabilitados ate preencher requisitos.
- Schema/tools usam campos tipados, required e delete inline.

Regra para nossa UI:

- Validar no local do campo.
- Desabilitar confirmacao enquanto houver erro bloqueante.
- Mostrar o primeiro erro perto do campo.
- Agrupar campos por secao.

Aplicar em:

- prompt;
- schema;
- tool;
- MCP;
- runtime env;
- approval;
- Docker settings.

Anti-regressao:

- Toast generico sem campo afetado nao e suficiente.

## 12. Prompt Builder Por Blocos

Observado:

- Prompt e formado por blocos System/Human/AI/Tool/Function/etc.
- Roles sao dropdowns.
- Acoes estruturais aparecem no bloco.
- Pode adicionar message, output schema, tool e escolher f-string/Mustache.

Regra para nossa UI:

- Prompt visual deve ser sequencia de blocos por role.
- Cada bloco deve permitir:
  - mudar role;
  - editar conteudo;
  - duplicar;
  - apagar;
  - colapsar;
  - ver variaveis.
- Output schema e tools devem ficar perto do prompt, nao em settings distantes.

Anti-regressao:

- Editor Markdown unico pode existir, mas nao substitui blocos visuais para prompt estruturado.

## 13. Schema Visual Com Modos Editor/JSON

Observado:

- Output schema tem editor visual, tipos, required, allowed values e politica de propriedades.
- Ha modo Editor/JSON/YAML.

Regra para nossa UI:

- Schema deve ter editor visual primeiro.
- Modos textuais devem existir para usuarios avancados.
- Alteracoes em qualquer modo devem validar e sincronizar.

Anti-regressao:

- Nao deixar schema quebrado ser salvo sem diagnostico.

## 14. Tools Como Funcoes Tipadas

Observado:

- `Manage tools` mostra lista lateral, formulario central, tool type, argumentos tipados, required e registry.

Regra para nossa UI:

- Tool visual deve ter:
  - nome;
  - descricao;
  - tipo;
  - argumentos;
  - required;
  - allowed values;
  - teste ou mock.
- Registry local pode guardar tools reutilizaveis.

Anti-regressao:

- Tool configurada sem schema de argumentos deve ser marcada incompleta.

## 15. Secrets Com Escopo e Mascara

Observado:

- Secrets/API keys aparece em popover.
- Escopos `Browser` e `Workspace`.
- Campo mascara valor e tem icone de olho.

Regra para nossa UI:

- Separar escopos:
  - `Local do usuario` para testes no Studio;
  - `Workspace/runtime` para env vars do artefato.
- Mascarar por padrao.
- Mostrar quais secrets faltam sem revelar valores.

Anti-regressao:

- Nunca gravar secret real em artefato exportado sem acao explicita.

## 16. Trace/Run Em Arvore Com Inspector

Observado:

- Trace mostra arvore/waterfall com spans, duracao, tokens e custo.
- Selecionar span mostra input/output no inspector.
- Hover mostra breakdown de tempo/custo.

Regra para nossa UI:

- Studio Local deve ter uma arvore/timeline de run.
- Cada node/span deve mostrar:
  - status;
  - duracao;
  - tokens/custo quando houver;
  - erro quando houver.
- Inspector deve mostrar:
  - input;
  - output;
  - prompt renderizado;
  - state diff;
  - events/logs relacionados.

Anti-regressao:

- Run sem node IO estruturado nao esta pronta.

## 17. Input/Output Com Alternancia Render/Raw

Observado:

- Output permite `Default` e `Raw Output`.
- Input/output aparecem em Markdown, com copia por bloco.

Regra para nossa UI:

- Todo output deve ter pelo menos:
  - renderizado;
  - raw JSON;
  - copiar.
- Input deve ter schema/template quando disponivel.

Anti-regressao:

- Nao mostrar apenas string final se houver payload estruturado.

## 18. Local Server Como Conexao Explicita

Observado:

- Studio connection usa `http://localhost:2024`, headers e advanced settings.
- Quickstart explica CLI e env.

Regra para nossa UI:

- Nosso Studio Local deve esconder isso no caminho principal, porque o Builder deve iniciar o sandbox.
- Modo avancado pode permitir conectar a Agent Server externo com base URL e headers.

Anti-regressao:

- Usuario nao deve precisar configurar URL local manualmente para testar flow gerado pelo proprio Builder.

## 19. Import/Export Sempre Rotulado Por Tipo

Observado:

- Fleet tem import ZIP e download ZIP.

Regra para nossa UI:

- Separar claramente:
  - `Importar workspace`;
  - `Exportar workspace`;
  - `Exportar sandbox LangGraph`;
  - `Exportar runtime API Docker`.

Anti-regressao:

- ZIP sem tipo ou sem README/metadados e fonte de erro.

## 20. Densidade Visual

Observado:

- Telas usam bastante espaco, mas componentes internos sao compactos.
- Muitos controles ficam em linhas de toolbar.
- Cards sao simples, bordas sutis, raio pequeno.

Regra para nossa UI:

- Preferir paineis, linhas, toolbars e split panes.
- Usar cards apenas para itens repetidos ou blocos do canvas.
- Manter raio visual discreto.
- Evitar hero, gradientes decorativos e textos explicativos longos.

Anti-regressao:

- Interface operacional nao deve parecer landing page.

## 21. Sidebar e Grupos de Navegacao

Observado:

- Sidebar organiza areas em grupos: Application, observability, prompt/studio/context, deployment.

Regra para nossa UI:

- Agrupar navegacao por fluxo:
  - `Construir`: Flow, Arquivos, Validacao;
  - `Testar`: Studio Local, Runs, Cenarios;
  - `Empacotar`: Artefatos, Runtime;
  - `Configurar`: Settings, Providers, Secrets.

Anti-regressao:

- Nao expor secoes futuras se elas nao tem acao real.

## 22. Cores e Linhas do Grafo

Observado:

- Linhas entre blocos sao suaves, pontilhadas e coloridas por categoria.
- Pontos/handles sao pequenos e escuros.

Regra para nossa UI:

- Usar cor de aresta por categoria:
  - entrada/trigger;
  - canal;
  - tool;
  - subagente;
  - skill;
  - runtime/output.
- Durante execucao, status sobrepoe categoria.

Anti-regressao:

- Cor decorativa nao pode competir com status de erro/running/blocked.

## 23. Microcopy Curto

Observado:

- Estados vazios e descricoes usam uma frase curta.
- Formularios usam placeholders praticos.

Regra para nossa UI:

- Textos devem indicar acao ou estado.
- Evitar explicacoes longas dentro da tela principal.
- Usar docs/help apenas quando necessario.

Exemplos:

- `Nenhuma run ainda. Rode um cenario para ver o trace.`
- `Aprovacao desatualizada: schema mudou.`
- `Sem tools configuradas.`

Anti-regressao:

- Texto permanente de tutorial longo dentro da ferramenta vira ruido.

## Checklist Visual Obrigatorio

Antes de aprovar qualquer tela:

- Sidebar/top bar preservam contexto.
- A acao primaria da tela esta clara.
- Todo estado vazio tem CTA.
- Todo botao icon-only tem tooltip.
- Todo disabled explica motivo.
- Formularios mostram erro inline.
- Tema claro e escuro funcionam.
- Layout nao quebra em 1280x720.
- Split panes preservam proporcao usavel.
- Canvas tem zoom/fit/pan acessiveis.
- Modal/popover nao esconde contexto necessario.
- Prompt/schema/tool tem modo visual.
- Trace/run mostra input/output estruturado.
- Segredos estao mascarados.
- Nao ha copia de naming proprietario de produto terceiro.
