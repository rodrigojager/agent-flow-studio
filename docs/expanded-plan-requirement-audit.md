# Auditoria Requisito a Requisito do Plano Expandido

Status de referencia:

- MVP principal = 100%.
- plano total expandido = em andamento.
- LangSmith Cloud continua opcional.
- Nao declarar 100% total sem evidencia por requisito.

Este contrato transforma as 12 frentes de `projeto-final.md` em uma lista governada de requisitos verificaveis. Ele existe para dar rastreabilidade ao plano total expandido sem reabrir o MVP principal.

Arquivo canonico: `docs/expanded-plan-requirement-audit.md`.

## Como Rodar

```bash
npm run test:expanded-plan-requirement-audit
```

Para gravar um relatorio local:

```bash
npm run test:expanded-plan-requirement-audit -- --out .agent-flow/expanded-plan-requirement-audit.json
```

## Saida Governada

O formato da saida e `agent-flow-builder.expanded-plan-requirement-audit.v1`.

O relatorio inclui:

- status `in_progress`;
- `MVP principal = 100%` como `verified_100_percent`;
- `plano total expandido = em andamento`;
- `completionClaim = not_declared`;
- IDs estaveis por frente e tipo, como `front-01-missing-001` e `front-01-criterion-001`;
- linha de origem em `projeto-final.md`;
- hash curto do conteudo normalizado.

O relatorio e sem texto bruto dos requisitos, sem payload bruto e sem tokens. Ele nao inclui schema bruto, prompt bruto, input bruto, output bruto, headers de auth ou secrets.

## Criterio De Uso

Use este gate quando uma frente do plano expandido mudar, quando a matriz de gates mudar ou antes de qualquer discussao de fechamento total. O resultado esperado enquanto existirem pendencias externas, opt-in ou dependentes de operador e `plano total expandido = em andamento`.

Para release, combine este gate com `docs/release-gate-matrix.md`, `npm run test:expanded-plan-audit`, `npm run test:expanded-plan-gate-matrix` e `npm run test:expanded-plan-evidence-report`.
