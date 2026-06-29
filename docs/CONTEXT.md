# Docs

## Purpose

Documentação de planejamento do projeto, incluindo plano consolidado, ADRs, glossário de domínio e melhorias futuras.

---

## Folder Structure

```text
docs/
├── CONTEXT.md            # roteamento desta pasta
├── plan.md               # plano revisado principal
├── future-authentication.md
├── future-background-jobs.md
├── future-streaming.md
├── implementation-status.md
├── domain/               # glossário de domínio
└── adr/                  # decisões arquiteturais
```

---

## Routing

| Task | Go To | Load First |
|------|-------|------------|
| Entender o plano atual | `plan.md` | `../IDENTITY.md` |
| Atualizar linguagem do domínio | `domain/CONTEXT.md` | `../CONTEXT-MAP.md` |
| Criar ou revisar ADR | `adr/` | `adr/CONTEXT.md` |
| Ver melhorias futuras | `future-*.md` | `plan.md` |
| Ver progresso implementado | `implementation-status.md` | `plan.md` |
