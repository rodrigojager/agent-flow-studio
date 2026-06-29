# AGENTES IA

## Purpose

Workspace para planejar e, em seguida, construir uma fábrica visual de agentes de IA que gera runtimes LangGraph + FastAPI independentes. Use este arquivo como roteamento ICM da raiz; o glossário de domínio fica em `docs/domain/CONTEXT.md`.

---

## Session Start

1. Leia `IDENTITY.md` para entender o mapa do workspace e as regras.
2. Leia `docs/plan.md` para o plano técnico consolidado.
3. Leia `docs/domain/CONTEXT.md` para linguagem do domínio.
4. Leia ADRs em `docs/adr/` conforme a decisão que estiver sendo alterada.

---

## Folder Structure

```text
AGENTES IA/
├── IDENTITY.md        # ICM Layer 0: identidade e mapa do workspace
├── CONTEXT.md         # ICM Layer 1: roteamento da raiz
├── CONTEXT-MAP.md     # mapa dos contextos de domínio
├── package.json       # scripts do monorepo TypeScript
├── runtime.manifest.json # manifesto de agrupamento do runtime de referência
├── plano.txt          # plano original fornecido pelo usuário
├── apps/              # aplicações do builder em desenvolvimento
├── flows/             # fluxos versionáveis do builder
├── packages/          # flow spec e codegen
├── examples/          # baseline manual versionado
├── generated/         # artefatos gerados pelo codegen
└── docs/
    ├── CONTEXT.md     # roteamento da documentação
    ├── plan.md        # plano revisado e consolidado
    ├── future-*.md    # melhorias futuras já identificadas
    ├── domain/        # glossário e linguagem do domínio
    └── adr/           # decisões arquiteturais
```

---

## Routing

| Task | Go To | Load First |
|------|-------|------------|
| Entender o objetivo do projeto | `docs/plan.md` | `IDENTITY.md` |
| Usar a linguagem correta do domínio | `docs/domain/CONTEXT.md` | `CONTEXT-MAP.md` |
| Revisar decisões arquiteturais | `docs/adr/` | `docs/adr/CONTEXT.md` |
| Comparar com o plano original | `plano.txt` | `docs/plan.md` |
| Evoluir melhorias futuras | `docs/future-*.md` | `docs/plan.md` |
| Ver status de implementação | `docs/implementation-status.md` | `docs/plan.md` |
| Trabalhar no baseline manual | `examples/reference-interview-runtime/` | `examples/reference-interview-runtime/CONTEXT.md` |
| Alterar Builder API | `apps/builder-api/` | `apps/builder-api/CONTEXT.md` |
| Alterar o flow de referência | `flows/reference-interview/` | `flows/CONTEXT.md` |
| Alterar validação ou codegen | `packages/` | `packages/CONTEXT.md` |
| Inspecionar saída gerada | `generated/reference-interview-runtime/` | `generated/CONTEXT.md` |

---

## Notes

Preserve UTF-8 e use acentos reais em português. Não use entidades HTML para substituir letras acentuadas.
