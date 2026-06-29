# Fábrica de Agentes de IA

Este contexto define a linguagem do produto que transforma fluxos de agentes em APIs executáveis e independentes do editor visual.

## Language

**Agente Gerado**:
Um agente de IA produzido a partir de um fluxo definido no builder e exposto para consumo por outros sistemas.
_Avoid_: chatbot genérico, automação solta

**Runtime Gerado**:
O artefato executável produzido pelo gerador para hospedar um ou mais agentes gerados fora do builder visual.
_Avoid_: builder, editor visual, plataforma central

**Modo Monoagente**:
Forma de empacotamento em que um runtime gerado hospeda exatamente um agente gerado.
_Avoid_: agente único quando a intenção for falar do empacotamento

**Modo Multiagente**:
Forma de empacotamento em que um runtime gerado hospeda vários agentes gerados no mesmo limite operacional.
_Avoid_: plataforma central, monólito de agentes

**Builder Visual**:
Ferramenta usada para desenhar, configurar, validar e gerar agentes, sem ser necessária para executar o agente em produção.
_Avoid_: runtime, agente final

**Fluxo de Agente**:
A definição versionável de um único agente gerado, incluindo estado, nós, conexões, prompts, schemas e contrato de execução.
_Avoid_: bundle, manifesto de runtime

**Manifesto de Agrupamento**:
A definição versionável que declara quais fluxos de agente serão hospedados juntos no mesmo runtime gerado.
_Avoid_: agent.flow.json multiagente, plataforma central

**Sessão**:
A instância stateful de interação com um agente gerado.
_Avoid_: run quando a interação for conversacional, conversa quando o agente não for necessariamente chat

**Chave de Idempotência**:
Um identificador técnico fornecido pelo consumidor para tornar uma operação repetida segura sem duplicar seus efeitos.
_Avoid_: chave de negócio, identificador externo

**Chave de Negócio**:
Um identificador do domínio do consumidor usado como contexto ou correlação, sem controlar idempotência por si só.
_Avoid_: chave de idempotência

**Operação Mutável**:
Uma chamada de API que pode criar, alterar ou finalizar estado persistente no runtime gerado.
_Avoid_: request comum, consulta

**Início Automático**:
Configuração em que a criação de uma sessão também executa o começo do fluxo até a primeira resposta ou pausa.
_Avoid_: init ambíguo

**Turno**:
Uma entrada do consumidor que retoma uma sessão interativa com uma nova resposta ou mensagem do usuário.
_Avoid_: resume quando a API pública for conversacional

**Transcript**:
O histórico conversacional de uma sessão, formado pelas mensagens visíveis trocadas entre consumidor, usuário e agente.
_Avoid_: eventos, logs

**Evento de Execução**:
Um registro operacional de algo que aconteceu durante a execução do agente, como nó executado, decisão de gate, chamada de LLM, retry, erro ou finalização.
_Avoid_: mensagem de conversa, transcript

**Agente de Referência**:
Um agente gerado mínimo usado para provar a arquitetura do runtime, mantendo a estrutura técnica real sem reproduzir toda a regra de negócio de um agente de produção.
_Avoid_: agente final, mock sem infraestrutura

**Baseline de Geração**:
O projeto de referência usado como comparação para validar se o fluxo intermediário, o codegen e o editor visual produzem um runtime equivalente.
_Avoid_: template copiado manualmente, exemplo descartável

**Exemplo Versionado**:
Um projeto mantido dentro do monorepo para demonstrar, testar ou validar uma capacidade do builder e do runtime gerado.
_Avoid_: pasta temporária, rascunho local

**Grafo de Execução**:
A representação executável do fluxo do agente no runtime gerado.
_Avoid_: fluxo visual quando estiver falando da execução em produção

**Estado Executável**:
O estado persistido necessário para o LangGraph continuar, recuperar ou depurar a execução do grafo.
_Avoid_: transcript, contrato público

**Estado Público**:
A projeção persistida do estado de uma sessão que compõe o contrato da API para consumidores externos.
_Avoid_: checkpoint, estado interno do grafo

**Cache Quente**:
Uma projeção temporária e reconstruível usada para acelerar turnos, respostas recentes e contexto já renderizado.
_Avoid_: fonte de verdade, banco de dados primário

**Cliente LLM**:
A interface interna usada pelos nós do runtime para chamar modelos de linguagem sem depender diretamente de um SDK específico.
_Avoid_: SDK OpenAI espalhado pelos nós

**Adaptador de LLM**:
A implementação selecionada do Cliente LLM para um provedor, gateway ou modelo específico.
_Avoid_: provedor fixo, dependência global

**Safety Gate**:
Uma etapa determinística ou configurável que avalia entrada, saída ou contexto antes de permitir avanço no fluxo.
_Avoid_: prompt de segurança solto, validação invisível

**Safety Harness**:
Um conjunto completo e reutilizável de scanners, regras, privacidade, resposta segura, tracing e alarmes para políticas de segurança avançadas.
_Avoid_: safety gate simples

**Chave de API do Agente**:
Um segredo simples enviado por header para autenticar consumidores de um runtime gerado.
_Avoid_: autenticação completa, usuário final

**Job Pós-Finalização**:
Uma tarefa disparada depois que uma sessão termina para consolidar, analisar, exportar ou notificar resultados.
_Avoid_: turno, evento de execução

**Codegen**:
O componente que transforma um fluxo de agente e, quando aplicável, um manifesto de agrupamento em um runtime gerado.
_Avoid_: runtime, builder visual

**Builder API**:
A API de desenvolvimento usada pelo builder visual para salvar fluxos, validar especificações, gerar código e acionar sandbox.
_Avoid_: API do agente gerado

**Flow Spec**:
O schema canônico que define a estrutura válida de um fluxo de agente.
_Avoid_: schema Python separado, contrato informal

**Workspace de Fluxos**:
A área versionável em disco onde o builder salva fluxos, prompts, manifests e exemplos antes da geração.
_Avoid_: banco do builder no MVP

**Prompt Versionável**:
Um arquivo Markdown em UTF-8 referenciado pelo fluxo de agente para orientar uma chamada de LLM.
_Avoid_: prompt embutido no JSON, texto sem versão

**Schema Versionável**:
Um JSON Schema em arquivo separado que define entradas, saídas estruturadas ou fragmentos de estado usados por um fluxo de agente.
_Avoid_: schema embutido no prompt, modelo preso ao runtime

**Ambiente de Referência**:
O conjunto de serviços e configurações usados para executar o baseline de forma próxima ao ambiente real.
_Avoid_: teste unitário isolado
