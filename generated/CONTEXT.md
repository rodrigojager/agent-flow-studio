# Generated

## Purpose

Artefatos produzidos pelo codegen a partir dos flows. Esta pasta serve para inspeção e comparação durante o desenvolvimento do gerador, incluindo a saída versionada de handlers genéricos como `http_request`, `transform_json`, `database_query`, `database_save`, `file_extract` e `rag_retrieval`.

---

## Folder Structure

```text
generated/
├── reference-interview-runtime/
│   ├── .agent-flow/
│   ├── app/
│   ├── migrations/
│   ├── tests/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── pyproject.toml
│   └── README.md
└── reference-runtime-bundle/
    ├── .runtime-manifest/
    ├── agents/
    ├── bundle.json
    └── README.md
```

---

## Routing

| Task | Go To | Load First |
|------|-------|------------|
| Inspecionar saída do flow de referência | `reference-interview-runtime/` | `../flows/reference-interview/agent.flow.json` |
| Inspecionar bundle do manifesto de referência | `reference-runtime-bundle/` | `../runtime.manifest.json` |
| Regenerar saída | `../packages/codegen-langgraph/` | `../packages/CONTEXT.md` |
