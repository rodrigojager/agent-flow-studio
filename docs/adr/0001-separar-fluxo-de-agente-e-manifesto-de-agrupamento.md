# Separar fluxo de agente e manifesto de agrupamento

O formato intermediário deve manter um arquivo de fluxo por agente, enquanto runtimes com vários agentes serão definidos por um manifesto de agrupamento separado. Essa decisão mantém o caso comum de um FastAPI monoagente simples e permite reproduzir casos como o serviço atual, em que vários agentes compartilham banco, autenticação operacional e um único conjunto de endpoints no mesmo processo.

## Considered Options

- Um `agent.flow.json` contendo vários agentes.
- Um `agent.flow.json` por agente, agrupado por um manifesto separado.

## Consequences

O gerador precisa aceitar dois modos de empacotamento: gerar um runtime monoagente diretamente de um fluxo ou gerar um runtime multiagente a partir de um manifesto que referencia vários fluxos.
