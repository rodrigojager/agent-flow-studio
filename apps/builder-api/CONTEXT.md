# Builder API

## Purpose

API local de desenvolvimento para listar, ler, salvar, validar e gerar flows versionáveis, incluindo prompts e schemas referenciados pelo flow. No MVP, a fonte de verdade continua sendo o filesystem do workspace.

---

## Folder Structure

```text
builder-api/
├── package.json
└── src/
    ├── server.ts
    ├── sandbox.ts
    ├── workspace.ts
    └── server.test.ts
```

---

## Routing

| Task | Go To | Load First |
|------|-------|------------|
| Alterar endpoints HTTP | `src/server.ts` | `src/workspace.ts` |
| Alterar leitura/validação de flows | `src/workspace.ts` | `../../packages/flow-spec/src/index.ts` |
| Alterar salvamento de flows | `src/workspace.ts` | `../../packages/flow-spec/src/index.ts` |
| Alterar leitura/salvamento de prompts e schemas | `src/workspace.ts` | `src/server.ts` |
| Alterar geração pelo builder | `src/workspace.ts` | `../../packages/codegen-langgraph/src/index.ts` |
| Alterar sandbox local | `src/sandbox.ts` | `src/server.ts` |

## Commands

```bash
npm run test:builder-api
```
