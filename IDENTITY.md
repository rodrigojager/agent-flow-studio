# AGENTES IA — fábrica de agentes de IA

Workspace de planejamento para uma ferramenta visual que gera agentes de IA como APIs independentes em LangGraph + FastAPI.

## Rules

- Preserve UTF-8 em todos os arquivos editados.
- Use acentos reais em português brasileiro; não use entidades HTML para letras acentuadas.
- O builder é ferramenta de desenvolvimento; o runtime gerado deve rodar independente dele.
- Decisões consolidadas devem ser registradas em ADR quando forem difíceis de reverter e envolverem trade-off real.
- Enquanto o goal de implementação completa estiver ativo, cada turno com mudanças no workspace deve terminar com um novo commit Git.

## Folder Map

```text
AGENTES IA/
├── IDENTITY.md        # Layer 0: identidade, regras e mapa do workspace
├── CONTEXT.md         # Layer 1: roteamento principal para sessões LLM
├── CONTEXT-MAP.md     # mapa dos contextos de domínio
├── package.json       # scripts do monorepo TypeScript
├── runtime.manifest.json # manifesto de agrupamento do runtime de referência
├── plano.txt          # briefing/plano original do usuário
├── apps/              # aplicações do builder em desenvolvimento
├── flows/             # fluxos versionáveis do builder
├── packages/          # pacotes TypeScript de flow spec e codegen
├── examples/          # runtimes de referência versionados
├── generated/         # artefatos gerados pelo codegen
└── docs/              # documentação planejada e decisões
    ├── CONTEXT.md     # roteamento da documentação
    ├── plan.md        # plano revisado consolidado
    ├── future-*.md    # melhorias futuras fora do baseline
    ├── domain/        # glossário e linguagem do domínio
    └── adr/           # ADRs do projeto
```

## Current Status

Baseline manual, flow spec inicial, manifesto de agrupamento inicial, Builder API mínima, Builder UI inicial, edição persistente de flow/prompts/schemas/nós/arestas, sandbox local inicial, codegen Python dirigido por nós/arestas do flow, bundle por manifesto e composição multiagente inicial em processo único implementados. Sandbox completo, codegen para recursos avançados e recursos avançados ainda não foram implementados.
