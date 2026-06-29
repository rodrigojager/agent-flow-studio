# Tools

## Purpose

Scripts auxiliares de validação do workspace. Estes comandos verificam propriedades transversais que atravessam baseline manual, flow spec, codegen e artefatos gerados.

---

## Folder Structure

```text
tools/
└── verify_runtime_parity.py  # compara baseline manual, flow spec e runtime gerado
```

---

## Routing

| Task | Go To | Load First |
|------|-------|------------|
| Alterar verificação de paridade do runtime | `verify_runtime_parity.py` | `../examples/reference-interview-runtime/CONTEXT.md` e `../generated/CONTEXT.md` |

## Commands

```bash
npm run test:parity
```
