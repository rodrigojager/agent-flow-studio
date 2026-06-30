# Plano de Implementação Completo — Studio Local, Fluxo Único e Capacidades ProUp

Data: 2026-06-30.

Este documento consolida o que já foi implementado, o que faltava e as decisões de execução para transformar o Agent Flow Builder na versão local completa (WYSIWYG + Studio Local + aprovação + runtime Docker), sem dependência obrigatória de LangSmith Cloud.

## 1) Objetivo e regra de sucesso

Entregar um fluxo contínuo e operável em uma única aplicação:

`Builder Visual -> Teste Local -> Depuração Studio -> Aprovação por hash -> Runtime Docker`

Sem custo de plataforma externa no caminho principal e mantendo o caminho opcional de exportação LangGraph/LangSmith para quem quiser usar rastreio cloud.

Regra de sucesso:
- O usuário consegue criar, testar, depurar, aprovar e gerar uma API Docker funcional sem sair da interface.
- Nenhum recurso essencial depende de serviços pagos para o funcionamento básico.
- Tem tema claro e escuro, painel único, grafo em execução, timeline, node-io, transcripts/events/state e logs correlacionados.
- O runtime final pode rodar fora da ferramenta e é independente.

## 2) Decisões tomadas (já válidas para o projeto inteiro)

1. **Direção local-first obrigatória no fluxo principal**  
   O Studio Local e a aprovação por hash passam a ser o caminho padrão; LangSmith/LangGraph ficam como integração opcional.

2. **Não há regressão de poder de construção**  
   Visual não pode limitar capacidades já possíveis em versão manual.  
   Se um caso de uso não couber no visual, deve existir um dos caminhos abaixo:
   - nó `code` com contrato claro;
   - `HTTP`/tool customizada;
   - MCP stdio/sidecar local/runtime adapter;
   - fluxo futuro dedicado por runtime.

3. **Proup como regra de capacidade**  
   O produto precisa reproduzir: sessão conversacional, turnos, transcript/events, idempotência, estado por conversa, perguntas, consulta de conteúdo, persistência/caching, mock/LLM real, safety, testes, pacote Docker.

4. **Linguagem dos comportamentos customizados**  
   Python, JavaScript e TypeScript são nativos (arquivo/inline).
   Outras linguagens entram como contrato suportado e podem ser executadas por HTTP, MCP stdio ou sidecar local até haver runtime adapter dedicado.

5. **Aprovação com rastreabilidade**  
   Hash cobre:
   - `agent.flow.json`;
   - prompts;
   - schemas;
   - arquivos em `files/` e `app/code/` referenciados;
   - opções de runtime relevantes.

   Qualquer alteração invalida aprovação anterior.

6. **UI por usabilidade, não por “clonagem”**  
   A referência visual do LangSmith/n8n é usada como inspiração de fluxo e padrões; sem copiar fonte/código/marca.

## 3) Status real (agora)

### Já implementado e operável
- CRUD de flow + assets, validação e geração.
- geração de sandbox LangGraph e approval JSON.
- geração de runtime FastAPI Docker + operações start/build/up/down/smoke/inspect.
- persistência de runs locais em arquivos por flow (`.agent-flow/studio-runs/`) com:
  - resumo;
  - transcript;
  - events;
  - snapshots derivados e diff incremental;
  - filtros por status/fase/erro/ texto;
  - export JSON de run.
- UI `Sandbox Panel` com grafo de execução, timeline, node-io e state inspector.
- Comparação de runs com diffs semânticos por nó (state/output), metadados de cenário e seletor de esquerda/direita.
- Cenários com pinning, marcação de favorito e execução reprodutível pelo botão de execução rápida.

### Ponto fraco atual (foco da próxima etapa)
- Progresso longo de build Docker e UX de operações long-running ainda limitada.
- Observabilidade por nó/erro com drill-down mais profundo ainda pendente (timeline-contextual e causalidade entre nós).

## 4) Itens para próximas 4 entregas (sem pular fases)

### Entrega A — Studio Debug Profundo (prioridade crítica)
Escopo:
- Comparação entre 2 runs (metria A/B) dentro do Studio Local:
  - seletor de run-base + run-candidato;
  - comparação de métricas (status, duração, eventos, nós, mensagens, erros);
  - diferença de estado agregada e de node-io.
- Diff semântico por nó:
  - antes/depois por nó no state;
  - campos alterados e campos suprimidos.
- Deep export de run:
  - export JSON completo e pacote de execução para análise externa.

Critério de aceite:
- O usuário consegue responder “por que esta run falhou e onde mudou”.

### Entrega B — Cenários e reprodução
Escopo:
- Salvar cenários (scenario) no flow:
  - input inicial + payload de user_message + mensagens de controle;
  - estado de sessão mockado (opcional);
  - run name/label + tags.
- Pin de cenário e reexecução repetível.
- “Último cenário” + “cenário favorito” com quick-run.

Critério de aceite:
- Reproduzir uma falha de forma determinística com 1 clique.

### Entrega C — UX de Studio de operação contínua
Escopo:
- Gráfico de grafo com estado por nó em tempo real:
  - running/erro/ok/pendente;
  - seleção no timeline destacando nó e mostrando node-io completo.
- Empty states com CTA única por painel.
- Status global de sessão/runs no topo do painel.

Critério de aceite:
- Usuário sem experiência ainda consegue seguir a execução até o nó com falha.

### Entrega D — Aprovação integrada e gate da operação
Escopo:
- Painel de aprovação no Studio:
  - hash atual;
  - versão e ativos cobertos;
  - bloqueio de geração quando inválido;
  - evidência de run base usada na aprovação.
- “Regenerar artefato sem aprovação” fica explicitamente bloqueado.

Critério de aceite:
- Não é possível gerar runtime final a partir de estado não aprovado.

## 5) Matriz de Inputs e Elementos (resumo executivo)

| Entrada / intenção | Elemento principal |
| --- | --- |
| Mensagem livre, conversa | Node LLM + sessão (`turn`) |
| JSON estruturado | node schema input + formulário |
| Arquivo base | file_extract / rag_retrieval |
| Regra de negócio | node `code` (python/js inline/file) |
| Integração externa | HTTP/MCP/tool |
| Controle/decisão humana | human_input |
| Policy/segurança | safety_gate / saída/entrada |
| Validação analítica | scoring / analytics |
| Pós-processamento | code / analytics |
| Mock de fluxo | idempotency + mock LLM |

## 6) Regras anti-regressão (Proup + fluxo atual)

Antes de considerar qualquer etapa pronta:
- mapear qual mecanismo cobre a capacidade ProUp equivalente;
- garantir edição visual ou caminho de escape (code/HTTP/MCP) disponível;
- garantir captura em trace local e inclusão no hash (quando comportamento afeta runtime);
- garantir que o cenário pode ser testado e reproduzido pelo Studio Local.

Se qualquer ponto faltar, a etapa não entra como pronta.

## 7) Próximo passo de implementação (este ciclo)

1. Finalizar comparação de runs no backend (`/studio-runs/:id/compare`) + view no UI.
2. Expandir snapshots com diff por nó (não só por estado agregado).
3. Implementar cenário “pin” e reexecução no Studio.
4. Ajustar progress bars/eventos durante build Docker longo.
5. Atualizar `docs/implementation-status.md` a cada ciclo com status verde/vermelho objetivo.
