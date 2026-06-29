# Builder UI

## Purpose

Interface visual local do builder para inspecionar flows, editar propriedades básicas, editar prompts/schemas, salvar `agent.flow.json`, validar especificações e acionar geração de runtimes pelo Builder API.

---

## Folder Structure

```text
builder-ui/
├── index.html
├── package.json
├── vite.config.ts
└── src/
    ├── App.tsx
    ├── api.ts
    ├── main.tsx
    ├── styles.css
    └── types.ts
```

---

## Routing

| Task | Go To | Load First |
|------|-------|------------|
| Alterar layout do editor | `src/App.tsx` | `src/styles.css` |
| Alterar edição e salvamento visual | `src/App.tsx` | `../builder-api/src/workspace.ts` |
| Alterar aba de prompts e schemas | `src/App.tsx` e `src/api.ts` | `../builder-api/src/workspace.ts` |
| Alterar contrato com Builder API | `src/api.ts` | `../builder-api/CONTEXT.md` |
| Alterar tipos do flow no front | `src/types.ts` | `../../packages/flow-spec/src/index.ts` |
| Alterar sandbox visual | `src/App.tsx` e `src/api.ts` | `../builder-api/src/sandbox.ts` |

## Commands

```bash
npm run build:builder-ui
npm run dev:builder-ui
```
