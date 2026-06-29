# Builder API

## Purpose

API local de desenvolvimento para listar, ler, salvar, validar, importar, exportar e gerar flows versionáveis, incluindo prompts, schemas, bundles por manifesto e sandboxes locais de runtime gerado. No MVP, a fonte de verdade continua sendo o filesystem do workspace.

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
| Alterar import/export de workspace de flow | `src/workspace.ts` e `src/server.ts` | `src/server.test.ts` |
| Alterar leitura/salvamento de prompts e schemas | `src/workspace.ts` | `src/server.ts` |
| Alterar geração pelo builder | `src/workspace.ts` | `../../packages/codegen-langgraph/src/index.ts` |
| Alterar manifesto de runtime | `src/workspace.ts` e `src/server.ts` | `../../runtime.manifest.json` |
| Alterar sandbox local, status, logs, portas e listagem de runtimes | `src/sandbox.ts` | `src/server.ts` |

## Commands

```bash
npm run test:builder-api
```
