# ADR

## Purpose

Registro das decisões arquiteturais tomadas durante o refinamento do plano. Cada arquivo documenta uma decisão curta, o motivo e consequências relevantes.

---

## Folder Structure

```text
adr/
├── CONTEXT.md
├── 0001-*.md    # fluxo por agente e manifesto de agrupamento
├── ...
└── 0018-*.md    # baseline com Docker Compose, Postgres e Redis
```

---

## Routing

| Task | Go To | Load First |
|------|-------|------------|
| Entender decisões do MVP | `0005-*` até `0018-*` | `../plan.md` |
| Revisar contrato HTTP | `0002-*`, `0003-*`, `0004-*` | `../plan.md` |
| Revisar persistência/cache | `0008-*`, `0009-*` | `../plan.md` |
| Revisar builder/codegen | `0013-*`, `0014-*`, `0015-*` | `../plan.md` |
