# Modelo de Interacao: Studio Local

Este documento especifica os comportamentos esperados da interface. Ele deve guiar implementacao e testes de UX.

## Estados Globais

Todo flow deve expor estados claros:

- `saved`: sem alteracoes pendentes;
- `dirty`: alteracoes locais nao salvas;
- `valid`: passou na validacao;
- `invalid`: possui erros bloqueantes;
- `generated`: artefato gerado para o hash atual;
- `sandbox_running`: sandbox ativo;
- `tested`: existe run bem-sucedida no hash atual;
- `approved`: hash atual aprovado;
- `approval_stale`: aprovacao existe, mas hash mudou;
- `runtime_built`: container final buildado para o hash aprovado;
- `runtime_running`: API final ativa.

Esses estados aparecem como badges consistentes na top bar, no workspace panel e nas telas de artefato/runtime.

## Adicionar No

Fluxo:

1. Usuario abre palette.
2. Pesquisa por acao, tipo ou integracao.
3. Arrasta o no para o canvas ou clica para inserir no centro visivel.
4. Inspector abre automaticamente com os campos obrigatorios.
5. O no aparece com badge `configurar` enquanto faltar requisito.
6. A validacao visual lista exatamente o campo pendente.

Atalho:

- `A` abre palette.
- `Esc` fecha palette.

## Conectar Nos

Fluxo:

1. Usuario arrasta handle de saida para handle de entrada.
2. A conexao valida tipo, cardinalidade e ciclo antes de salvar.
3. Se houver condicao necessaria, inspector abre na aba `Condicao`.
4. Destino fica `stale` se havia dados de run anterior.

Feedback:

- conexao valida: linha solida;
- conexao condicional: linha com marcador;
- conexao invalida: linha vermelha e tooltip com motivo;
- conexao desatualizada por alteracao: linha com aviso discreto.

## Editar Prompt ou Schema

Fluxo:

1. Usuario edita no inspector ou na aba `Arquivos`.
2. Preview de variaveis e schema valida em tempo real.
3. Ao salvar, runs anteriores ficam marcadas como `stale`.
4. A aprovacao vira `approval_stale` se existia.
5. A acao sugerida passa a ser `Validar` ou `Rodar cenario`.

Regra:

- Alteracao de prompt, schema, arquivo em `files/`, edge, no ou adapter deve invalidar aprovacao por hash.

## Validar Flow

Ao clicar `Validar`:

- salvar alteracoes pendentes se for seguro;
- rodar Flow Spec validation;
- destacar nos/arestas com problema;
- abrir `Problems` no drawer;
- permitir clique em diagnostico para focar elemento;
- mostrar resumo: erros, avisos e itens prontos para codegen.

Se houver erro bloqueante, esconder acoes de geracao atras de uma explicacao curta.

## Iniciar Sandbox

Ao clicar `Iniciar sandbox`:

1. Garantir flow salvo e valido.
2. Gerar ou atualizar artefato de sandbox local.
3. Escolher porta disponivel.
4. Subir processo local.
5. Fazer healthcheck.
6. Abrir logs no drawer.
7. Habilitar `Nova sessao`.

Estados de falha:

- dependencia ausente;
- porta ocupada;
- erro de import do grafo;
- env var obrigatoria ausente;
- timeout de healthcheck.

Cada falha deve ter diagnostico objetivo e proxima acao.

## Criar Sessao e Rodar Cenario

Fluxo:

1. Usuario clica `Nova sessao`.
2. Studio cria session/thread local.
3. Playground preenche payload inicial pelo schema.
4. Usuario clica `Start`.
5. Grafo entra em replay ao vivo.
6. Timeline recebe eventos conforme o agente executa.
7. Inspector mostra output do no selecionado ou resumo da run.

Para `Turn`:

- manter transcript visivel;
- mostrar idempotency key;
- permitir reenviar a mesma turn e indicar resposta idempotente;
- separar mensagem visivel de evento operacional.

Para `Finish`:

- mostrar resumo da sessao;
- listar jobs/analises pendentes quando existirem;
- permitir smoke equivalente no runtime final depois da aprovacao.

## Selecionar No Durante Run

Ao selecionar um no:

- grafo destaca no e arestas relacionadas;
- inspector abre `Node IO`;
- timeline filtra visualmente eventos relacionados;
- se o no ainda nao executou, mostrar configuracao e estado esperado;
- se falhou, abrir erro, stack resumida e logs relacionados.

O painel `Node IO` deve sempre ter:

- input recebido;
- output produzido;
- diff do state;
- eventos emitidos;
- duracao;
- retries;
- prompt renderizado quando aplicavel;
- resposta bruta do modelo quando aplicavel.

## Timeline

Ao clicar em um evento:

- focar no correspondente;
- abrir detalhe no inspector;
- rolar logs para o trecho relacionado quando houver correlation id;
- mostrar snapshot de estado antes/depois se disponivel.

Filtros:

- todos;
- LLM;
- safety;
- integracao;
- humano;
- erro;
- sistema;
- runtime.

## State Inspector

Comportamentos:

- busca por chave ou valor;
- copiar path;
- copiar valor;
- comparar snapshots;
- mostrar campos adicionados, removidos e alterados;
- destacar alteracoes feitas pelo no selecionado;
- ocultar segredos por padrao.

Time travel/fork:

- recurso avancado, acessivel por menu da run ou checkpoint;
- exige nome para o fork;
- mostra que a linha do tempo original permanece intacta;
- run gerada por fork deve ter badge `fork`.

## Pinning e Mocking

Recursos:

- fixar payload inicial;
- fixar output de no deterministico;
- fixar resposta mock de LLM;
- salvar cenarios nomeados;
- editar dados fixados em JSON;
- duplicar cenario para edge cases.

Regras:

- pinning e mocking sao apenas para desenvolvimento local;
- dados fixados aparecem com badge visivel;
- mudar dados fixados marca downstream como `stale`;
- desfixar dados sugere executar novamente.

## Aprovacao

Ao clicar `Aprovar versao`:

1. Verificar se o flow atual esta salvo, valido e testado.
2. Calcular hash de flow, prompts, schemas e arquivos.
3. Mostrar assets cobertos.
4. Exigir confirmacao curta.
5. Gravar `.agent-flow/langgraph-sandbox-approval.json`.
6. Atualizar status para `approved`.
7. Liberar geracao Docker.

Se o hash mudar depois:

- status vira `approval_stale`;
- runtime build fica bloqueado;
- tooltip mostra quais grupos mudaram: flow, prompts, schemas, files ou manifest.

## Gerar e Subir Runtime Docker

Ao clicar `Gerar API Docker`:

1. Confirmar aprovacao valida.
2. Gerar runtime FastAPI.
3. Copiar comprovante de aprovacao.
4. Validar estrutura de arquivos.
5. Oferecer `Build` no modo Runtime.

Ao clicar `Build`:

- executar build Docker;
- mostrar logs;
- destacar erro com arquivo/linha quando possivel;
- manter botao `Copiar comando`.

Ao clicar `Up`:

- subir compose;
- fazer healthcheck;
- abrir link de `/docs`;
- habilitar smoke test.

Ao clicar `Smoke`:

- criar sessao;
- executar start/turn;
- ler transcript/events;
- mostrar resultado comparavel ao Studio Local.

## Erros e Recuperacao

Padroes:

- erro deve aparecer no local onde o usuario pode agir;
- drawer abre automaticamente em erro de execucao;
- top bar mostra apenas resumo;
- logs completos ficam disponiveis sem poluir a tela;
- cada erro deve ter uma proxima acao.

Mensagens devem ser curtas:

- `Schema invalido: campo "messages" precisa ser array.`
- `Aprovacao desatualizada: prompt principal mudou.`
- `Sandbox parou antes do healthcheck. Abra logs para ver o erro de import.`

## Atalhos

Atalhos iniciais:

- `Ctrl+S`: salvar;
- `Ctrl+Enter`: rodar acao primaria da tela atual;
- `A`: abrir palette;
- `F`: fit view;
- `Esc`: fechar overlay ou limpar selecao;
- `Ctrl+F`: buscar no painel ativo;
- `Ctrl+/`: abrir command menu.

Todos os atalhos devem aparecer em tooltips e command menu, nao em textos permanentes na tela.

