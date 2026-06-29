# Flows

## Purpose

Workspace de fluxos versionáveis usados pelo builder e pelo codegen. Cada subpasta representa um agente.

---

## Folder Structure

```text
flows/
└── reference-interview/
    ├── agent.flow.json
    ├── prompts/
    └── schemas/
```

---

## Routing

| Task | Go To | Load First |
|------|-------|------------|
| Alterar flow de referência | `reference-interview/agent.flow.json` | `../packages/flow-spec/src/index.ts` |
| Alterar prompt do flow | `reference-interview/prompts/` | `../docs/adr/0016-prompts-em-markdown-referenciados-pelo-flow.md` |
| Alterar schema do flow | `reference-interview/schemas/` | `../docs/adr/0017-schemas-estruturados-em-json-schema-versionavel.md` |
