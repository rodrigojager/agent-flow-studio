# Packages

## Purpose

Pacotes TypeScript do builder/codegen. O `flow-spec` define o schema canônico em Zod, incluindo metadados visuais como posição de nós, e o `codegen-langgraph` gera runtimes Python LangGraph + FastAPI a partir de nós e arestas do flow.

---

## Folder Structure

```text
packages/
├── flow-spec/
│   └── src/
└── codegen-langgraph/
    └── src/
```

---

## Routing

| Task | Go To | Load First |
|------|-------|------------|
| Alterar formato do flow | `flow-spec/src/index.ts` | `../docs/adr/0014-flow-spec-canonico-em-zod-typescript.md` |
| Validar flow via CLI | `flow-spec/src/cli.ts` | `flow-spec/src/index.ts` |
| Alterar geração de runtime | `codegen-langgraph/src/index.ts` e `codegen-langgraph/src/pythonRuntimeTemplates.ts` | `../flows/CONTEXT.md` |
| Alterar testes do codegen | `codegen-langgraph/src/codegen.test.ts` | `codegen-langgraph/src/index.ts` |
| Alterar CLI de geração | `codegen-langgraph/src/cli.ts` | `codegen-langgraph/src/index.ts` |

## Commands

```bash
npm run typecheck
npm run validate:flow
npm run codegen:reference
npm run test:codegen
npm run test:baseline
npm run test:generated
```
