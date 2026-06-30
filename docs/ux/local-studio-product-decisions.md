# Decisoes de Produto e UX: Agent Flow Builder Local Studio

Data: 2026-06-30.

Status: decisoes aceitas para orientar as proximas implementacoes, com revisao permitida apenas se houver nova evidencia de produto ou limitacao tecnica documentada.

## Contexto

Este documento converte a pesquisa, os screenshots logados e o plano local-first em decisoes praticas. Ele existe para evitar regressao de escopo e de experiencia durante a implementacao.

Fontes internas usadas:

- `docs/local-studio-plan.md`
- `docs/ux/source-research-langsmith-n8n.md`
- `docs/ux/agent-browser-sweep-notes.md`
- `docs/ux/logged-in-screenshot-raw-analysis.md`
- `docs/ux/local-studio-interface-spec.md`
- `docs/ux/local-studio-interaction-model.md`
- `docs/ux/design-system.md`
- `docs/ux/input-ai-element-fit-matrix.md`

## Norte do Produto

O Agent Flow Builder deve ser uma fabrica local de agentes, nao uma copia de uma plataforma cloud. O fluxo principal e:

```text
Desenhar -> Testar -> Depurar -> Aprovar -> Gerar API Docker
```

A inspiracao em LangSmith Studio, LangSmith Fleet e n8n serve para melhorar clareza, ergonomia e confianca. A implementacao final deve continuar propria, local-first e orientada ao runtime embarcavel.

## Decisoes Centrais

### 1. Local-first continua inegociavel

Decisao:

- O fluxo principal nao pode depender de LangSmith Cloud, conta externa, billing externo ou deploy gerenciado.
- Integracoes com LangSmith/LangGraph oficiais ficam opcionais.
- `langgraph dev` e Agent Server local podem ser compatibilidade, nao dependencia de UI.

Razao:

- O diferencial do produto e testar e empacotar agentes localmente, sem taxa obrigatoria.
- O runtime final deve ser uma API Docker independente.

Anti-regressao:

- Nao introduzir requisito obrigatorio de `LANGSMITH_API_KEY` para criar, testar, aprovar ou gerar API Docker.
- Nao transformar `Deployments` cloud em caminho principal.

### 2. A UI deve ser uma ferramenta operacional continua

Decisao:

- Usar shell unico com sidebar, top bar compacta, area central e paineis contextuais.
- Manter navegacao principal por etapas do nosso fluxo: `Flow`, `Studio Local`, `Artefatos`, `Runtime`, `Settings`.
- Evitar home de plataforma generica no caminho principal.

Razao:

- LangSmith e n8n mostram que navegacao persistente reduz desorientacao.
- Nosso produto precisa levar o usuario ate um container, nao apenas organizar varias ferramentas soltas.

Anti-regressao:

- O usuario nao deve sair da interface nem abrir terminal para o caminho principal.
- O mesmo flow selecionado deve permanecer em contexto entre Builder, Studio, Artefatos e Runtime.

### 3. O grafo de alto nivel e util, mas nao substitui o Flow Spec

Decisao:

- Adotar uma visao de "Agent Overview" inspirada nos blocos `Schedule`, `Channels`, `Agent`, `Toolbox`, `Sub-agents` e `Skills`.
- Essa visao deve ser uma camada de organizacao do agente, nao substituta do grafo executavel detalhado do `agent.flow.json`.
- O canvas atual de Flow continua sendo a fonte de verdade visual para nos, arestas, condicoes e runtime.

Razao:

- O grafo de alto nivel e excelente para usuarios novos entenderem o que falta configurar.
- O nosso codegen depende de um grafo operacional mais detalhado.

Anti-regressao:

- Nao reduzir o agente a um card central sem explicitar o grafo executavel.
- Nao duplicar duas fontes de verdade divergentes.

### 4. Estados e bloqueios devem ser visiveis

Decisao:

- Usar estados globais consistentes: `dirty`, `valid`, `invalid`, `generated`, `sandbox_running`, `tested`, `approved`, `approval_stale`, `runtime_built`, `runtime_running`.
- Botoes bloqueados precisam explicar o motivo por tooltip, inline message ou painel de problemas.

Razao:

- LangSmith/Fleet usa `Draft`, `Private`, botoes desabilitados e alertas de identidade.
- n8n usa dirty/stale para indicar dados antigos.
- Nosso fluxo tem bloqueios reais por hash, validacao e aprovacao.

Anti-regressao:

- Nunca bloquear `API Docker` sem dizer exatamente o motivo.
- Qualquer alteracao em flow, prompt, schema, files ou manifest deve invalidar aprovacao visualmente.

### 5. Identidade, modelo, secrets e credenciais sao configuracao de primeira classe

Decisao:

- Criar uma area contextual de configuracao do agente com modelo, provider, secrets, modo mock/local/API, tracing local e export.
- Adaptar a ideia de identidade/credentials para o nosso contexto:
  - `Credenciais do agente`: variaveis usadas pelo runtime gerado.
  - `Credenciais do operador`: credenciais usadas apenas no Studio Local ou teste manual.
- Comecar simples; modos multiusuario ficam para fase posterior.

Razao:

- Screenshots mostram que identidade e credenciais desbloqueiam canais e comportamento.
- Nosso runtime precisa de env vars e secrets previsiveis.

Anti-regressao:

- Segredos nao podem aparecer em texto claro por padrao.
- `.env.example` pode ser gerado; `.env` real nao deve ser empacotado por acidente.

### 6. Arquivos continuam importantes, mas a experiencia primaria e WYSIWYG

Decisao:

- Manter uma aba `Arquivos` ou painel equivalente para prompts, schemas, `agent.flow.json`, manifest e artefatos.
- Criar editores visuais para configuracoes comuns.
- JSON/YAML/source ficam como modo avancado, nao como caminho obrigatorio.

Razao:

- A tela de arquivos do Fleet mostra valor em expor `AGENTS.md`, config e tools.
- Nosso usuario quer WYSIWYG e nao deve precisar editar JSON para tarefas comuns.

Anti-regressao:

- Qualquer recurso novo precisa ter caminho visual antes de ser considerado completo para usuario final.
- JSON bruto sozinho nao conta como implementacao de UX.

### 7. Prompt Playground deve ser absorvido pelo nosso Studio, nao virar produto separado

Decisao:

- Implementar um playground local integrado ao flow selecionado.
- Adotar bloco de mensagens por role, variaveis, modelo, output schema, tools e render/raw output.
- Rejeitar no MVP: prompt marketplace publico, commits publicos, webhooks de prompt e compartilhamento externo.
- Manter versionamento local por hash/asset e historico do projeto.

Razao:

- O Playground do LangSmith e forte para iterar prompts e schemas.
- Nosso produto precisa conectar playground ao grafo, runs, aprovacao e runtime.

Anti-regressao:

- Playground isolado, sem impacto no flow ou na aprovacao, nao atende ao objetivo.
- Alterar prompt no playground deve marcar flow/assets como desatualizados quando aplicavel.

### 8. Schema e tools precisam de editor visual com escape hatch textual

Decisao:

- Adotar editor visual de output schema com:
  - name;
  - description;
  - properties;
  - required;
  - tipo;
  - allowed values;
  - politica de propriedades adicionais.
- Oferecer modo `JSON` e, se simples, `YAML` como escape hatch.
- Adotar modal de tools com argumentos tipados e opcao de salvar/reutilizar localmente.

Razao:

- Screenshots mostram que schema e tool editor reduzem friccao e erros.
- Nossa ferramenta ja depende de schemas e tipos para codegen seguro.

Anti-regressao:

- Nao aceitar schema invalido silenciosamente.
- Mudanca de schema precisa invalidar runs/aprovacao ligadas ao hash anterior.

### 9. MCP e integracoes entram como capacidades, nao como distração inicial

Decisao:

- Implementar MCP/custom tool como capacidade de agente com formulario: name, URL, auth, headers e teste de conexao.
- Integracoes de canais como Slack/Gmail/Outlook/Teams ficam como adapters futuros.
- O canal local `Chat` e a API HTTP devem ser os primeiros canais reais.

Razao:

- MCP e tools sao diretamente uteis para agentes locais.
- Canais SaaS exigem OAuth, seguranca e escopo operacional que podem atrasar o core.

Anti-regressao:

- Nao colocar botoes de integracoes sem backend real ou status claro de "planejado".
- Toda integracao exibida como ativa precisa ter teste de conexao e erro acionavel.

### 10. Schedule e triggers entram depois do caminho interativo basico

Decisao:

- Incluir `Schedule` como conceito visual e futuro node/trigger.
- No MVP do Studio Local, priorizar `Create session`, `Start`, `Turn`, `Finish`.
- Triggers agendados entram depois que runtime, aprovacao e traces estiverem estaveis.

Razao:

- O schedule modal e intuitivo, mas exige semantica de jobs/worker.
- O plano ainda tem jobs pos-finalizacao e worker como futuro.

Anti-regressao:

- Nao prometer schedule funcional sem worker/runtime que execute fora da UI.

### 11. Studio Local deve imitar o modelo mental do Studio, mas com traces locais

Decisao:

- Usar layout de Studio com:
  - grafo/execucao no centro;
  - sessao/thread e runs;
  - inspector de input/output/state/logs;
  - timeline/waterfall;
  - transcript.
- Persistir traces em storage local do Builder.
- Permitir conectar a Agent Server externo/local apenas como modo avancado.

Razao:

- LangSmith Studio e forte em graph/thread/run.
- Nossa diferenca e nao depender de cloud e ligar tudo a aprovacao/hash/Docker.

Anti-regressao:

- Studio Local sem grafo de execucao e sem node IO nao e paridade suficiente.
- Logs soltos nao substituem trace estruturado.

### 12. Observabilidade minima obrigatoria: node IO, estado, eventos e custos quando existirem

Decisao:

- Toda run local deve registrar:
  - node executado;
  - input;
  - output;
  - eventos;
  - duracao;
  - erro;
  - diff/snapshot de estado quando possivel.
- Para LLM, registrar prompt renderizado, modelo, resposta bruta, tokens e custo estimado quando o provider fornecer.

Razao:

- Screenshots de trace mostram que tempo, tokens, custo e input/output proximos do span tornam debug rapido.
- Nossa API ja separa transcript de events; a UI deve explorar isso.

Anti-regressao:

- Nao declarar uma run "testada" se nao houver evidencia local consultavel.

### 13. Avaliacoes entram em camadas, nao antes do core de run/trace

Decisao:

- Fase inicial: cenarios salvos, smoke tests e scoring nodes ja previstos.
- Fase seguinte: datasets locais simples e comparacao entre runs.
- Fase posterior: evaluators, annotation queues e rubricas humanas.

Razao:

- LangSmith tem suite ampla de datasets, experiments, evaluators e annotation queues.
- Nosso backlog principal ainda e Studio Local, tema, trace, aprovacao e Docker.

Anti-regressao:

- Nao deixar evaluators/annotation queues atrasarem o Studio Local basico.
- Nao criar dashboards vazios que nao ajudem a testar/aprovar agente.

### 14. Runtime substitui Deployments cloud no nosso fluxo

Decisao:

- A area equivalente a `Deployments` deve ser `Runtime` ou `API Docker`.
- Ela controla geracao, build, up/down, healthcheck, Swagger e smoke test local.
- Nao usar linguagem de upgrade/pricing/deploy cloud no caminho principal.

Razao:

- Nosso produto final e container embarcavel.
- LangSmith Deployments e pago/gerenciado, portanto nao corresponde ao objetivo local sem taxas.

Anti-regressao:

- Nao chamar geracao Docker de "deploy cloud".
- O container final deve continuar removivel da ferramenta e executavel sozinho.

### 15. Import/export ZIP e artefatos sao parte do fluxo principal

Decisao:

- Manter import/export de workspace/agent como recurso visivel.
- `Artefatos` deve mostrar sandbox LangGraph opcional, runtime gerado, metadados, hashes e arquivos.
- Export ZIP deve deixar claro se exporta workspace do builder, sandbox ou runtime final.

Razao:

- Screenshots mostram import/export como acao de primeira classe.
- Nosso fluxo precisa transportar o agente e o runtime final.

Anti-regressao:

- Nao misturar pacote de sandbox com API Docker final sem rotulo claro.

### 16. Home e empty states devem orientar, nao virar portal pesado

Decisao:

- Usar empty states com icone, mensagem curta e CTA.
- Evitar uma home cheia de modulos de plataforma no MVP.
- O workspace panel pode assumir papel de hub com flows recentes, status e proxima acao.

Razao:

- Empty states do LangSmith ajudam muito na descoberta.
- Nossa ferramenta precisa reduzir, nao aumentar, a quantidade de superficies.

Anti-regressao:

- Nenhuma tela vazia deve ficar sem proxima acao.
- Nao criar secoes como Monitoring/Datasets/Annotation se nao houver funcao real.

### 17. Context Hub vira Catalogo Local de agentes, skills e templates

Decisao:

- Adaptar `Context Hub` como catalogo local de:
  - agentes;
  - templates;
  - skills/tools reutilizaveis;
  - talvez snippets de prompt/schema.
- Public/private vira local/shared apenas quando houver compartilhamento real.

Razao:

- Catalogar agentes e skills ajuda multiagente e reutilizacao.
- Marketplace/public hub nao e necessario para o fluxo local.

Anti-regressao:

- Nao expor "publico" se nao existir publicacao real.

### 18. Tema claro e escuro sao requisito de aceite

Decisao:

- Qualquer tela nova precisa nascer com tokens e funcionar em tema claro/escuro.
- Tema deve cobrir canvas, modais, popovers, code blocks, logs e JSON viewers.

Razao:

- O usuario pediu explicitamente tema claro e escuro.
- Ferramenta operacional exige legibilidade em uso prolongado.

Anti-regressao:

- Tela sem tema escuro nao deve ser considerada pronta.

### 19. Nomenclatura deve favorecer clareza local

Decisao:

- Usar portugues nos labels principais quando a UI estiver em portugues:
  - `Sessao` com `Thread ID` tecnico;
  - `Run` pode permanecer como termo tecnico;
  - `Aprovacao`;
  - `API Docker`;
  - `Artefatos`;
  - `Cenario`;
  - `Grafo`.
- Evitar importar nomes proprietarios como `Claw`, `Fleet` ou `LangSmith Engine`.

Razao:

- Termos copiados aumentam confusao e aproximam demais a identidade visual.
- Alguns termos tecnicos como `Run`, `MCP`, `JSON`, `Docker` podem permanecer.

Anti-regressao:

- Nao usar naming proprietario de produto terceiro em UI propria.

## O Que Fica Fora do MVP

- Deploy cloud gerenciado.
- Billing, planos, upgrade e pricing.
- Prompt marketplace publico.
- Public/private sharing real.
- Annotation queues completas.
- Dashboards de monitoring custom.
- OAuth completo para canais SaaS.
- Multiusuario com credenciais por usuario.
- Publicacao de agents/skills em hub remoto.
- Experiment suite completa com datasets/evaluators antes do trace local basico.

## O Que Deve Entrar Antes de Avancar Para Recursos Avancados

1. Design system com tema claro/escuro.
2. Shell unico com Flow, Studio Local, Artefatos, Runtime e Settings.
3. Estados globais e bloqueios explicados.
4. Editor visual melhorado para prompts, schemas, tools e configuracao LLM.
5. Studio Local com runs, graph, node IO, state, timeline, transcript e logs.
6. Persistencia local de traces.
7. Aprovacao por hash integrada ao Studio.
8. Geracao da API Docker apenas de versao aprovada.
9. Build/up/smoke do container pela UI.
10. Import/export claro de workspace, sandbox e runtime.

## Checklist Anti-Regressao

Antes de marcar qualquer etapa como pronta, verificar:

- O fluxo principal funciona sem LangSmith Cloud.
- O usuario nao precisa abrir terminal para caminho principal.
- O estado do flow mostra salvo/sujo/valido/invalido/aprovado/desatualizado.
- Alterar flow/prompt/schema/files/manifest invalida aprovacao.
- A API Docker nao gera se a aprovacao estiver ausente ou desatualizada.
- Studio Local mostra trace estruturado, nao apenas logs.
- Run mostra node IO, transcript e events.
- Prompt/schema/tool tem caminho visual, nao apenas JSON.
- Segredos ficam mascarados.
- Icon-only buttons tem tooltip.
- Estados vazios possuem CTA claro.
- Tema claro e escuro foram testados.
- Runtime final roda separado do builder.
- Artefato sandbox e runtime final sao rotulados como coisas diferentes.

## Decisao de Sequencia

A proxima implementacao deve seguir esta ordem:

1. Consolidar design system e shell.
2. Refinar Builder WYSIWYG e editores visuais.
3. Implementar Studio Local MVP com sandbox/runs/node IO.
4. Persistir traces locais e replay basico.
5. Integrar aprovacao por hash dentro do Studio.
6. Integrar Runtime Docker com build/up/smoke pela UI.
7. Evoluir para cenarios, pinning, evals, schedules, channels e multiagente.

Essa ordem reduz risco porque protege o caminho principal antes de adicionar areas amplas como evaluators, datasets, dashboards ou annotation queues.
