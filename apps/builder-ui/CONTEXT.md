# Builder UI

## Purpose

Interface visual local do builder para criar e inspecionar flows, criar/remover/mover/conectar nós e arestas, editar propriedades básicas, criar/remover/editar LLM/prompts/schemas, configurar nós HTTP/transform/banco/arquivo/RAG iniciais, salvar `agent.flow.json`, importar/exportar workspace de flow, validar especificações com diagnósticos visuais, operar `runtime.manifest.json`, acionar geração de runtimes pelo Builder API, pré-visualizar/baixar artefatos gerados e testar sandboxes locais com sessões, turnos, logs e porta configurável.

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
| Alterar criação de flow pela UI | `src/App.tsx`, `src/api.ts` e `src/types.ts` | `../builder-api/src/workspace.ts` |
| Alterar edição e salvamento visual | `src/App.tsx` | `../builder-api/src/workspace.ts` |
| Alterar import/export visual de workspace de flow | `src/App.tsx`, `src/api.ts` e `src/types.ts` | `../builder-api/src/workspace.ts` |
| Alterar edição visual de LLM/adapters | `src/App.tsx`, `src/api.ts` e `src/types.ts` | `../../packages/flow-spec/src/index.ts` |
| Alterar edição de nós/arestas no canvas | `src/App.tsx` | `../../packages/flow-spec/src/index.ts` |
| Alterar edição visual de nós HTTP/transform | `src/App.tsx` e `src/types.ts` | `../../packages/flow-spec/src/index.ts` |
| Alterar edição visual de nós de banco | `src/App.tsx` e `src/types.ts` | `../../packages/flow-spec/src/index.ts` |
| Alterar edição visual de nós arquivo/RAG | `src/App.tsx` e `src/types.ts` | `../../packages/flow-spec/src/index.ts` |
| Alterar aba de validação visual | `src/App.tsx`, `src/api.ts` e `src/types.ts` | `../builder-api/src/workspace.ts` |
| Alterar aba de prompts e schemas | `src/App.tsx`, `src/api.ts`, `src/types.ts` e `src/styles.css` | `../builder-api/src/workspace.ts` |
| Alterar aba de artefatos gerados | `src/App.tsx`, `src/api.ts`, `src/types.ts` e `src/styles.css` | `../builder-api/src/workspace.ts` |
| Alterar aba de runtime/manifesto | `src/App.tsx`, `src/api.ts` e `src/types.ts` | `../builder-api/src/workspace.ts` |
| Alterar contrato com Builder API | `src/api.ts` | `../builder-api/CONTEXT.md` |
| Alterar tipos do flow no front | `src/types.ts` | `../../packages/flow-spec/src/index.ts` |
| Alterar sandbox visual, sessões, logs, portas e lista de runtimes | `src/App.tsx` e `src/api.ts` | `../builder-api/src/sandbox.ts` |

## Commands

```bash
npm run build:builder-ui
npm run dev:builder-ui
```
