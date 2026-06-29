# Generated

## Purpose

Artefatos produzidos pelo codegen a partir dos flows. Esta pasta serve para inspeção e comparação durante o desenvolvimento do gerador.

---

## Folder Structure

```text
generated/
└── reference-interview-runtime/
    ├── .agent-flow/
    ├── app/
    ├── migrations/
    ├── tests/
    ├── Dockerfile
    ├── docker-compose.yml
    ├── pyproject.toml
    └── README.md
```

---

## Routing

| Task | Go To | Load First |
|------|-------|------------|
| Inspecionar saída do flow de referência | `reference-interview-runtime/` | `../flows/reference-interview/agent.flow.json` |
| Regenerar saída | `../packages/codegen-langgraph/` | `../packages/CONTEXT.md` |
