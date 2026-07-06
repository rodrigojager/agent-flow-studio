# Guia do Desenvolvedor

Este guia cobre continuidade de desenvolvimento no monorepo.

Status de referencia:

- MVP principal = 100%.
- plano total expandido = em andamento.
- LangSmith Cloud e opcional.

## Estrutura

Pontos principais:

- `apps/builder-api/src/server.ts`: rotas da API local do Builder/Studio.
- `apps/builder-ui/src/App.tsx`: superficie principal da UI.
- `apps/builder-ui/src/styles.css`: identidade visual operacional, temas claro/escuro e densidade.
- `packages/flow-spec`: contrato do `agent.flow.json`.
- `packages/codegen-langgraph`: geracao do runtime FastAPI/LangGraph e bundles.
- `tools`: verificadores e gates repetiveis.
- `docs`: planos, status, UX, onboarding e matriz de gates.

## Regras de Implementacao

- Preserve o MVP principal como 100%.
- Mantenha o plano total expandido como em andamento ate auditoria requisito por requisito.
- Nao mexa em CyberVinci.
- Nao faca push automatico.
- Nao rode scan de PII/secrets a cada alteracao.
- Preserve local-first; LangSmith Cloud deve seguir opcional.
- Nao exporte schema bruto, prompt bruto, input/output bruto, headers, tokens, payloads ou secrets em contratos governados.
- Tokens externos devem ir apenas por headers nas chamadas reais, nunca em status/export.

## Padroes de UI

Mantenha a identidade atual:

- ferramenta operacional;
- densidade alta, mas escaneavel;
- tema claro/escuro;
- botoes com icones;
- estados claros de loading, erro, sucesso, permissao negada e dados obsoletos;
- sem landing page, hero ou decoracao gratuita;
- sem cards dentro de cards.

## Comandos Rapidos

```bash
npm run typecheck
npm run test:builder-api
npm run build:builder-ui
git diff --check
```

Para mudancas de plano expandido/onboarding:

```bash
npm run test:onboarding-docs
npm run test:expanded-plan-audit
npm run test:expanded-plan-requirement-audit
npm run test:expanded-plan-gate-matrix
npm run test:expanded-plan-evidence-report
npm run test:release-privacy-audit-contract
```

## Antes de Declarar Pronto

Use `docs/release-gate-matrix.md` para escolher o escopo correto. Use `docs/expanded-plan-requirement-audit.md` e `npm run test:expanded-plan-requirement-audit` para listar IDs estaveis por requisito sem texto bruto. O plano total expandido so pode ser fechado quando as frentes de `projeto-final.md` tiverem evidencia atual, as dependencias externas estiverem homologadas ou formalmente fora do core local, e a matriz completa de gates aplicavel passar.

O contrato de auditoria final esta em `docs/release-privacy-audit.md`. O gate `npm run test:release-privacy-audit-contract` valida o procedimento, mas nao executa scan de PII/secrets por rodada.
