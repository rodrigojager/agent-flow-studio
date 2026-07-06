# Projeto Final: Plano Para Chegar a 100% do Plano Total

## Status Atual

O MVP principal do Agent Flow Studio esta 100% verificado e nao deve ser rebaixado por pendencias do plano completo. O caminho principal ja cobre o fluxo local:

`Desenhar -> Testar -> Depurar -> Aprovar -> Gerar API Docker`

O que ainda falta pertence ao plano total expandido, ou seja, recursos pos-MVP para tornar a ferramenta madura em colaboracao distribuida, operacao real, homologacao externa, isolamento forte, validacao ampla de modelos locais e acabamento final de UX/produto.

Este plano deve ser usado como lista de trabalho para completar o projeto sem perder o que ja foi decidido:

- local-first;
- sem dependencia obrigatoria de LangSmith Cloud;
- artefato final removivel e embarcavel como API Docker independente;
- Builder/Studio apenas como ferramenta de criacao, teste, debug, aprovacao e empacotamento;
- tema claro e escuro;
- UX inspirada em LangSmith Studio e n8n, mas sem copiar codigo-fonte;
- interface continua, intuitiva e sem exigir curso;
- governanca sem payload bruto, sem secrets e com evidencias auditaveis;
- nao executar varredura de PII/secrets a cada alteracao;
- nao fazer push automatico para GitHub;
- nao mexer em CyberVinci para este objetivo.

## O Que Ja Existe e Deve Ser Preservado

O projeto ja tem uma base grande. Antes de implementar qualquer item, o agente deve inspecionar o estado atual em vez de recriar funcionalidades.

Ja existem, entre outras coisas:

- Builder visual com React Flow, canvas, nos, arestas, grupos, finder, comandos contextuais, edicao em lote e debug por no.
- Studio local com runs, timeline, traces, debug, cenarios, datasets, evaluators e fila de anotacao/revisao.
- Geracao de sandbox LangGraph e runtime FastAPI/Docker aprovado.
- Runtime final independente com API, Dockerfile, Compose, auth local, jobs pos-finalizacao, worker e smoke test.
- Bundle multiagente com manifest, rotas por agente, smoke por agente, smoke agregado, runbook por agente e orquestracao inicial.
- Editor visual de JSON Schema com `$defs`, `$ref`, required, arrays, objetos, composicoes, validacao, governanca e biblioteca de padroes.
- Biblioteca compartilhavel de padroes de schema, historico, sync central opcional, conflito, resolucao, lease, revisao/diff governados de conflitos.
- Catalogo local de prompts, schemas, tools, templates e blocos compostos, com historico, governanca, sync e conflito/resolucao.
- Safety Harness, telemetria de providers, alertas, historicos exportaveis/comparaveis e sync central opcional.
- Auth local do Builder, sessoes, JWT/JWKS/OIDC, grupos, politicas, auditoria, rotacao de chaves e homologacao corporativa local.
- Adapter local OpenAI-compatible/Ollama, catalogo de imagens de modelo, setup de modelos, perfil CPU/GPU e probes.
- Sandbox de codigo por processo, container e ponte VM/microVM, com manifestos, preflights, runners e homologacao inicial.
- Documentacao de UI/UX, status, plano mestre e roadmap local.

## Principios de Implementacao

1. Preservar o MVP principal.
   - Nunca tratar uma pendencia pos-MVP como regressao do MVP.
   - Se precisar reportar percentual, separar claramente `MVP principal` de `plano total expandido`.

2. Trabalhar por evidencias.
   - Toda conclusao deve citar arquivo, rota, teste, build, smoke ou comportamento verificado.
   - Nao declarar 100% do plano total por intuicao, busca superficial ou ausencia de TODO.

3. Manter local-first.
   - LangSmith Cloud deve continuar opcional.
   - Qualquer integracao externa deve ser adaptador/handoff governado, nao dependencia obrigatoria do fluxo principal.

4. Evitar payload bruto.
   - Pacotes de revisao, diffs, historicos e syncs devem evitar schemas brutos, prompts brutos, input/output bruto, headers, tokens e secrets quando o objetivo for governanca compartilhavel.
   - Quando um dado bruto for inevitavel para operacao local, marcar como local-only e excluir de storage/export por padrao.

5. Seguir a identidade visual atual.
   - Usar os mesmos padroes de cards, paineis, botoes com icones, estados, labels, densidade e responsividade existentes.
   - Evitar landing page, hero, elementos decorativos soltos, gradientes chamativos e UI de marketing.
   - Ferramenta operacional deve ser densa, clara, previsivel e facil de escanear.

6. Evitar regressao de capacidade.
   - A ferramenta visual nao pode engessar o desenvolvimento.
   - Deve continuar permitindo agentes complexos, codigo Python/JavaScript/TypeScript/Bash quando necessario, HTTP, RAG, banco, arquivos, approval, scoring, analytics, multiagente e runtime embarcavel.

## Frentes Que Faltam Para 100% do Plano Total

### 1. Colaboracao Distribuida Avancada

Status atual: existe colaboracao local/file-backed e sync central opcional em varias areas. Ja ha conflitos, lease, curadoria, historico e tombstones em partes importantes.

O que falta:

- Criar uma experiencia unificada de colaboracao para todas as bibliotecas e artefatos compartilhaveis.
- Consolidar os padroes de `Exportar revisao`, `Comparar revisao`, `Assumir`, `Liberar`, `Resolver`, `Historico de resolucao`, `Lease expirado` e `Sync central`.
- Garantir que os modulos usem contratos semelhantes para:
  - conflitos;
  - curationThread;
  - resolutionHistory ou decisoes derivadas;
  - review/diff governado;
  - tombstone contra reabertura;
  - governanca sem bruto/secrets.
- Completar colaboracao distribuida mais profunda para:
  - padroes de schema;
  - catalogo;
  - cenarios/datasets/evaluators;
  - annotation queue;
  - replay governance;
  - pins de nos;
  - checkpoints;
  - camadas de debug;
  - historicos operacionais.
- Adicionar uma tela agregada de conflitos pendentes por workspace/flow.
- Permitir triagem por responsavel, papel, area e severidade.
- Garantir que `viewer` nunca consiga mutar ou resolver quando auth/governanca estiver ativa.
- Padronizar mensagens de erro e estados visuais quando o ator nao tem permissao.

Critérios de conclusao:

- Cada artefato compartilhavel importante tem pacote de revisao e diff governado.
- A UI mostra conflitos abertos/resolvidos, lease, responsavel e ultima decisao de forma consistente.
- Existe uma visao agregada para revisar pendencias de colaboracao.
- Testes cobrem rejeicao de payload bruto e bloqueio de `viewer`.

### 2. UI/UX Final e Fluxo Continuo

Status atual: a UI ja tem muitas telas e recursos. O risco agora e excesso de complexidade e dispersao.

O que falta:

- Fazer uma passada dedicada de UX para reduzir friccao nos fluxos longos.
- Consolidar nomenclaturas de acoes parecidas:
  - `Carregar compartilhado`;
  - `Sincronizar compartilhado`;
  - `Central`;
  - `Sync central`;
  - `Exportar revisao`;
  - `Comparar revisao`;
  - `Exportar diff`;
  - `Importar diff`.
- Melhorar hierarquia visual em paineis densos:
  - primeiro status;
  - depois acoes principais;
  - depois detalhes;
  - depois historico/diff.
- Adicionar empty states claros para areas sem dados.
- Garantir loading, erro, sucesso, permissao negada e dados obsoletos em todos os paineis criticos.
- Revalidar tema claro e escuro em telas densas.
- Revalidar responsividade em desktop e viewport compacto.
- Evitar texto explicativo excessivo dentro da aplicacao; a interface deve ser intuitiva pelo fluxo.
- Garantir que textos de botoes nao quebrem layout.
- Usar icones consistentes nos comandos.
- Evitar cards dentro de cards e paineis decorativos sem funcao.

Critérios de conclusao:

- Smoke visual cobre claro/escuro e viewport compacto nas telas principais.
- Fluxo principal continua obvio sem documentacao externa.
- Paineis avancados continuam densos, mas escaneaveis.

### 3. Studio Local Avancado

Status atual: o Studio local ja cobre runs, traces, cenarios, evaluators, datasets, annotation queue, replay e debug.

O que falta:

- Aprofundar o fluxo de comparacao entre runs, cenarios e datasets para workflows reais.
- Melhorar a navegacao entre:
  - flow;
  - run;
  - evento;
  - no;
  - input/output;
  - evaluator;
  - anotacao;
  - replay;
  - aprovacao.
- Criar trilhas mais claras para:
  - reproduzir um bug;
  - transformar run em cenario;
  - transformar falha em item de anotacao;
  - comparar run atual com baseline;
  - aprovar versao final.
- Aprofundar datasets/evaluators multiusuario.
- Evoluir suite de experimentos para casos reais:
  - baseline;
  - regressao;
  - drift;
  - score por criterio;
  - julgamento externo;
  - revisao humana.
- Melhorar filtros por agente/run/sessao/no/tipo/status.

Critérios de conclusao:

- Um usuario consegue sair de uma execucao falha ate um cenario versionado e uma correcao aprovada sem perder contexto.
- Experimentos tem historico, comparacao e revisao humana suficientes para uso continuo.

### 4. Paridade Com Agentes Complexos do Usuario

Status atual: o projeto ja suporta muitos tipos de nos e runtime. Ainda assim, o plano total exige nao reduzir a capacidade que o usuario ja tinha fora da ferramenta.

O que falta:

- Revalidar a paridade com agentes como o caso Proup:
  - API de conversacao;
  - capacidade de fazer perguntas;
  - consultar conteudo;
  - gerar perguntas;
  - manter estado;
  - usar fontes e ferramentas;
  - controlar fluxo com condicoes;
  - executar codigo quando necessario.
- Garantir que o builder visual permita etapas de codigo quando a edicao visual for limitada.
- Garantir que Python/JavaScript/TypeScript/Bash possam ser usados em etapas adequadas, com politicas de sandbox claras.
- Garantir que HTTP, RAG, banco, arquivo, approval, scoring e analytics continuem combinaveis.
- Criar templates reais de agentes complexos, nao apenas exemplo simples.
- Adicionar testes de paridade que provem que os templates gerados conseguem reproduzir workflows complexos.

Critérios de conclusao:

- Existe pelo menos um template/agente complexo demonstrando conversacao, perguntas, consulta de conteudo, geracao de perguntas, estado e avaliacao.
- O runtime gerado executa esse fluxo como API Docker independente.
- A edicao visual nao remove a possibilidade de usar codigo quando necessario.

### 5. Runtime Final e API Embarcada

Status atual: a geracao de API Docker independente ja existe e o MVP principal foi validado.

O que falta:

- Hardening final do runtime para producao local/embarcada.
- Melhorar versionamento do contrato HTTP.
- Garantir migracoes e compatibilidade de banco em upgrades.
- Refinar runbooks operacionais.
- Amadurecer worker, jobs recorrentes, retry, limpeza e metricas em cenarios longos.
- Melhorar isolamento entre agentes em bundles complexos.
- Adicionar mais testes de clean clone/consumer path.
- Validar que o artefato final pode ser removido do Studio e operado de forma independente.

Critérios de conclusao:

- Um usuario consegue gerar, copiar, subir, testar e operar a API final sem abrir o Studio.
- O pacote final tem README, `.env.example`, OpenAPI/Swagger, healthcheck, smoke e runbook.
- O smoke cobre sessao, turno, eventos, jobs e auth quando aplicavel.

### 6. Orquestracao Multiagente Avancada

Status atual: ja existe bundle multiagente, manifest, handoffs, memoria governada, debug trace e smoke por agente.

O que falta:

- Aprofundar orquestracao para bundles complexos.
- Melhorar composicao visual de varios agentes.
- Tornar mais clara a diferenca entre:
  - flow;
  - agent;
  - route;
  - handoff;
  - memory;
  - orchestration step.
- Evoluir condicoes de roteamento e validacao.
- Melhorar debug de handoffs e memoria compartilhada.
- Amadurecer cenarios/evaluators multiagente.
- Garantir isolamento operacional por agente.

Critérios de conclusao:

- Um bundle multiagente complexo pode ser criado, depurado, aprovado e empacotado sem scripts manuais fora do fluxo.
- O Studio mostra claramente qual agente fez cada etapa, por que houve handoff e quais dados foram compartilhados.

### 7. Modelos Locais, GPU e Distribuicao de Imagens

Status atual: existe adapter local Ollama/OpenAI-compatible, healthcheck, setup de modelos, imagem pre-carregavel, catalogo e perfil CPU/GPU.

O que falta:

- Validar amplamente combinacoes reais:
  - Windows + Docker Desktop;
  - Linux;
  - CPU only;
  - NVIDIA GPU;
  - NVIDIA Container Toolkit;
  - imagens CUDA;
  - diferentes modelos Ollama.
- Melhorar diagnosticos quando o modelo local nao existe, nao cabe na memoria ou a GPU nao esta disponivel.
- Amadurecer distribuicao de imagens de modelos:
  - build;
  - export `.tar`;
  - load;
  - push;
  - catalogo local/remoto;
  - sync central.
- Criar runbook claro para usuario comum preparar modelos locais.

Critérios de conclusao:

- O Studio orienta o usuario ate um modelo local funcional sem editar arquivos manualmente.
- Falhas comuns de GPU/modelo aparecem com acao sugerida.
- Pelo menos uma matriz real CPU/GPU foi validada e documentada.

### 8. Sandbox, Container, VM e MicroVM

Status atual: ja ha execucao por processo/container, perfil hardened inicial, VM runner contract, scaffolds, preflights e homologacao.

O que falta:

- Publicar/operar imagens microVM kernel-direct reais/oficiais quando o ambiente exigir.
- Validar Firecracker/Cloud Hypervisor/QEMU em ambientes reais fora de dry-run.
- Fortalecer politicas de isolamento por executor.
- Consolidar runner kits para uso por operadores.
- Melhorar diagnosticos de preflight quando binarios ou artefatos estao ausentes.
- Documentar claramente quando usar:
  - processo local;
  - container;
  - container hardened;
  - VM;
  - microVM.

Critérios de conclusao:

- O usuario consegue escolher o nivel de isolamento por risco.
- O runtime falha fechado quando uma etapa exige isolamento forte e o runner nao prova as garantias.
- Ha runbook para preparar, homologar e registrar imagem microVM real.

### 9. Integracoes Externas Reais

Status atual: integracoes externas existem como opcionais, governadas e geralmente com tokens apenas em header.

O que falta:

- Homologar auth corporativa contra IdP e servicos reais.
- Homologar introspeccao central de sessao, auditoria central e diretorio corporativo reais.
- Decidir se LangSmith Cloud tera deploy gerenciado acoplado a um provedor especifico.
- Se sim, criar adaptador/handoff de producao sem quebrar o fluxo 100% local.
- Validar registries de modelo externos reais quando aplicavel.
- Criar runbooks para operadores configurarem essas integracoes sem expor tokens.

Critérios de conclusao:

- Integracoes externas continuam opcionais.
- Status nunca mostra URL sensivel/token/header bruto.
- Tokens sao enviados somente em header.
- Falha externa nao quebra o fluxo local principal.

### 10. Governanca, Seguranca e Privacidade de Release

Status atual: ha muita sanitizacao, redaction, governanca e testes especificos. O usuario pediu para nao rodar scan de PII/secrets a cada alteracao.

O que falta:

- Fazer auditoria final de release, nao por rodada:
  - secrets;
  - `.env`;
  - tokens;
  - paths locais;
  - PII em exemplos;
  - payloads brutos em exports governados.
- Garantir `.gitignore` e exemplos seguros.
- Validar pacotes exportados principais.
- Validar que os pacotes governados nao incluem bruto indevido.
- Garantir que logs/status nao exponham segredos.

Critérios de conclusao:

- Auditoria final documentada antes de publicacao/release.
- Nenhum secret real em exemplos, generated artifacts ou docs.
- Testes cobrem redaction nos pontos criticos.

### 11. Documentacao e Onboarding

Status atual: ja existem README, planos, status, docs de UX e runbooks parciais.

O que falta:

- Consolidar documentacao final para usuario:
  - o que e a ferramenta;
  - quando usar;
  - fluxo principal;
  - como criar agente;
  - como testar;
  - como aprovar;
  - como gerar API Docker;
  - como operar a API final;
  - como usar modelos locais;
  - como usar codigo em etapas;
  - como usar multiagente;
  - como fazer governanca/revisao.
- Separar documentacao de usuario, operador e desenvolvedor.
- Criar quickstart de 10 minutos.
- Criar exemplos reais, incluindo agente complexo.
- Atualizar screenshots ou referencias visuais quando a UI estabilizar.

Critérios de conclusao:

- Um usuario novo consegue rodar o Studio e gerar uma API final seguindo o README.
- Um operador consegue subir a API final sem saber detalhes internos do Builder.
- Um desenvolvedor consegue continuar o projeto sem ler o historico da conversa.

### 12. Testes, Gates e Evidencia Final

Status atual: muitos testes existem e o MVP principal ja passou em gates amplos.

O que falta:

- Definir matriz final de gates para o plano total.
- Separar gates rapidos de desenvolvimento e gates de release.
- Rodar clean clone/consumer path antes de declarar release.
- Garantir que os testes cobrem:
  - backend;
  - UI claro/escuro;
  - build da UI;
  - codegen;
  - runtime gerado;
  - Docker smoke;
  - multiagente;
  - modelos locais quando possivel;
  - VM/microVM quando opt-in;
  - governanca e redaction;
  - exports/imports.
- Criar relatorio final de evidencia.

Critérios de conclusao:

- Existe uma lista curta de comandos para desenvolvimento diario.
- Existe uma lista completa de comandos para release.
- O status final aponta para evidencias reais, nao para intencao.

## Ordem Recomendada de Implementacao

1. Fechar colaboracao distribuida avancada em artefatos que ja tem base pronta.
2. Fazer passada de UI/UX final nas telas densas.
3. Criar/agregar painel unico de pendencias/conflitos de colaboracao.
4. Revalidar paridade com agente complexo tipo Proup.
5. Fortalecer runtime final e bundle multiagente complexo.
6. Validar modelos locais/GPU em ambientes reais.
7. Amadurecer VM/microVM e runbooks de isolamento forte.
8. Homologar integracoes externas reais quando forem realmente usadas.
9. Fechar documentacao final.
10. Rodar auditoria final de release e matriz completa de gates.

## Prompt Para Outro Agente Implementar

Use o prompt abaixo para iniciar outro agente sem contexto previo.

```text
Voce vai trabalhar no repositorio Agent Flow Studio. Objetivo: completar o plano total expandido do projeto sem reabrir nem rebaixar o MVP principal.

Contexto essencial:
- O MVP principal ja esta 100% verificado: Desenhar -> Testar -> Depurar -> Aprovar -> Gerar API Docker.
- O trabalho restante e pos-MVP/plano total: colaboracao distribuida avancada, UX final, runtime hardening, multiagente avancado, validacao ampla de modelos locais/GPU, microVM real, integracoes externas homologadas, documentacao final e gates de release.
- Nao mexa em CyberVinci.
- Nao faca push automatico.
- Nao rode scan de PII/secrets a cada alteracao. Auditoria de secrets e apenas para release ou quando explicitamente pedida.
- Nao declare 100% total sem auditoria requisito por requisito e evidencia atual.
- Preserve o fluxo local-first. LangSmith Cloud e opcional, nao dependencia do caminho principal.
- A UI deve manter a identidade atual: operacional, densa, clara, com tema claro/escuro, botoes com icones, estados claros, sem landing page, sem hero, sem decoracao gratuita, sem cards dentro de cards.
- Inspire-se em LangSmith Studio e n8n em experiencia e comportamento, mas nao copie codigo-fonte nem crie clone literal.
- O produto final nao e o builder: e uma API Docker/FastAPI independente, removivel e embarcavel. O Builder/Studio serve para criar, testar, depurar, aprovar e empacotar.

Antes de editar:
1. Leia `projeto-final.md`.
2. Leia `docs/implementation-status.md`, `docs/master-implementation-plan.md`, `docs/local-studio-plan.md` e `README.md`.
3. Inspecione o worktree atual; ha muitos arquivos modificados/untracked que fazem parte do plano. Nao reverta mudancas que voce nao fez.
4. Escolha uma lacuna objetiva do plano total que tenha impacto real e seja verificavel.

Prioridade sugerida:
1. Completar colaboracao distribuida avancada nos artefatos compartilhaveis restantes.
2. Padronizar revisao/diff governado, conflitos, lease, curadoria, resolucao, tombstones e bloqueio de viewer.
3. Melhorar UX das telas densas sem mudar a identidade visual.
4. Revalidar paridade com agentes complexos como API de conversacao capaz de perguntar, consultar conteudo e gerar perguntas.
5. Fortalecer runtime final e bundle multiagente.

Padroes tecnicos:
- Use os padroes existentes do repositorio.
- Para backend, prefira contratos JSON versionados, sanitizados e testaveis.
- Pacotes compartilhaveis/governados nao devem incluir schema bruto, prompt bruto, input/output bruto, headers, tokens, payloads ou secrets, salvo quando o arquivo for explicitamente local-only.
- Tokens externos devem ir apenas em headers; status/export nao deve mostrar URL sensivel nem token.
- Para UI, use os componentes/estilos existentes em `apps/builder-ui/src/App.tsx` e `apps/builder-ui/src/styles.css`.
- Para API, use `apps/builder-api/src/server.ts` e modulos dedicados em `apps/builder-api/src/`.
- Adicione testes focados no modulo alterado. Se mexer em UI, rode `npm run build:builder-ui` e smoke visual relevante.

Comandos de validacao comuns:
- `npm run typecheck`
- teste focado do backend alterado, por exemplo `npx tsx --test apps/builder-api/src/<arquivo>.test.ts`
- teste focado de `server.test.ts` quando adicionar rota
- `npm run build:builder-ui`
- `npm run test:ui-theme -- --grep "studio runs with data render"` para smoke visual amplo
- `git diff --check` nos arquivos tocados

Como reportar progresso:
- Sempre separe: MVP principal = 100%; plano total expandido = em andamento.
- Diga exatamente o que foi implementado e quais comandos passaram.
- Nao diga que o plano total esta completo sem auditoria completa.
- Se algo depende de ambiente externo real, marque como pendente/homologacao externa, nao finja que esta completo.
```

## Definicao de 100% Total

O plano total so pode ser marcado como 100% quando:

- todas as frentes acima tiverem implementacao ou decisao explicita de escopo;
- as pendencias externas estiverem homologadas ou formalmente classificadas como opcionais fora do core local;
- a UI tiver passado por revisao final claro/escuro/responsiva;
- agentes complexos estiverem reproduziveis pela ferramenta;
- o runtime final estiver validado como artefato independente;
- docs de usuario, operador e desenvolvedor estiverem atualizadas;
- auditoria final de release nao encontrar secrets/PII;
- a matriz completa de gates passar no estado atual do workspace.
