# Packages

## Purpose

Pacotes TypeScript do builder/codegen. O `flow-spec` define o schema canônico em Zod, metadados visuais, manifestos de agrupamento, catálogo de adapters LLM, análise estruturada de flow e nós avançados iniciais; o `codegen-langgraph` gera runtimes Python LangGraph + FastAPI a partir de flows, incluindo nós MVP como LLM, safety, code, switch, human input, `http_request`, `transform_json`, `database_query`, `database_save`, `file_extract` e `rag_retrieval`, bundles por manifesto e apps FastAPI compartilhados para manifestos multiagente.

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
| Alterar análise estruturada de flow | `flow-spec/src/index.ts` | `../flows/CONTEXT.md` |
| Alterar catálogo de adapters LLM | `flow-spec/src/index.ts` e `codegen-langgraph/src/pythonRuntimeTemplates.ts` | `../docs/adr/0010-cliente-llm-com-adaptador-selecionado-no-codegen.md` |
| Alterar formato do manifesto | `flow-spec/src/index.ts` | `../docs/adr/0001-separar-fluxo-de-agente-e-manifesto-de-agrupamento.md` |
| Validar flow via CLI | `flow-spec/src/cli.ts` | `flow-spec/src/index.ts` |
| Alterar geração de runtime | `codegen-langgraph/src/index.ts` e `codegen-langgraph/src/pythonRuntimeTemplates.ts` | `../flows/CONTEXT.md` |
| Alterar execução de nós switch/human_input | `codegen-langgraph/src/pythonRuntimeTemplates.ts` e `codegen-langgraph/src/codegen.test.ts` | `flow-spec/src/index.ts` |
| Alterar execução de nós HTTP/transform | `flow-spec/src/index.ts`, `codegen-langgraph/src/pythonRuntimeTemplates.ts` e `codegen-langgraph/src/codegen.test.ts` | `../docs/plan.md` |
| Alterar execução de nós de banco | `flow-spec/src/index.ts`, `codegen-langgraph/src/pythonRuntimeTemplates.ts` e `codegen-langgraph/src/codegen.test.ts` | `../docs/adr/0008-persistencia-dupla-com-checkpointer-e-tabelas-publicas.md` |
| Alterar execução de nós arquivo/RAG | `codegen-langgraph/src/index.ts`, `flow-spec/src/index.ts`, `codegen-langgraph/src/pythonRuntimeTemplates.ts` e `codegen-langgraph/src/codegen.test.ts` | `../docs/plan.md` |
| Alterar app multiagente gerado | `codegen-langgraph/src/pythonBundleTemplates.ts` | `../docs/adr/0001-separar-fluxo-de-agente-e-manifesto-de-agrupamento.md` |
| Alterar testes do codegen | `codegen-langgraph/src/codegen.test.ts` | `codegen-langgraph/src/index.ts` |
| Alterar CLI de geração | `codegen-langgraph/src/cli.ts` | `codegen-langgraph/src/index.ts` |
| Alterar CLI de manifesto | `codegen-langgraph/src/manifest-cli.ts` | `codegen-langgraph/src/index.ts` |

## Commands

```bash
npm run typecheck
npm run validate:flow
npm run codegen:reference
npm run codegen:manifest
npm run test:codegen
npm run test:baseline
npm run test:generated
npm run test:manifest
```
