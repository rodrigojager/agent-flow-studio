# Apps

## Purpose

Aplicações de desenvolvimento do builder. Elas ajudam a criar, validar, gerar e testar agentes, mas não são dependências do runtime gerado em produção.

---

## Folder Structure

```text
apps/
├── builder-api/
│   └── src/
└── builder-ui/
    └── src/
```

---

## Routing

| Task | Go To | Load First |
|------|-------|------------|
| Alterar API do builder | `builder-api/` | `builder-api/CONTEXT.md` |
| Alterar UI do builder | `builder-ui/` | `builder-ui/CONTEXT.md` |
| Integrar UI futura com geração | `builder-api/src/server.ts` | `../packages/CONTEXT.md` |
