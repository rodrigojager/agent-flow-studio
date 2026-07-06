# Matriz de Gates do Plano Expandido

Status de referencia:

- MVP principal = 100%.
- plano total expandido = em andamento.
- LangSmith Cloud continua opcional.
- Nao rode scan de PII/secrets a cada alteracao; a auditoria de privacidade e secrets fica para release final ou pedido explicito.
- Nao declarar 100% total sem auditoria requisito por requisito.

Esta matriz separa rotina diaria, gates de release local, gates opt-in e evidencias externas. Ela nao substitui a auditoria final do plano completo; ela define o que precisa estar verde ou formalmente evidenciado antes de qualquer claim de release.

## daily-development

Uso: ciclo rapido de desenvolvimento antes de entregar uma alteracao local.

```bash
npm run typecheck
npm run test:builder-api
npm run build:builder-ui
```

## expanded-plan-governance

Uso: preservar a separacao entre MVP principal e plano expandido, validar a matriz de gates e gerar evidencia governada sem payload bruto.

```bash
npm run test:onboarding-docs
npm run test:local-models-runbook
npm run test:release-privacy-audit-contract
npm run test:external-integrations-homologation
npm run test:isolation-levels-runbook
npm run test:multiagent-operations-runbook
npm run test:collaboration-conflict-contract
npm run test:expanded-plan-audit
npm run test:expanded-plan-requirement-audit
npm run test:expanded-plan-gate-matrix
npm run test:expanded-plan-evidence-report
```

Use `docs/expanded-plan-requirement-audit.md` para gerar a lista governada de requisitos por frente antes de discutir fechamento total.

## core-local-release

Uso: release local do Builder/Studio e da API Docker removivel. Estes gates sao obrigatorios antes de afirmar que o caminho local principal e os artefatos locais seguem operaveis.

Use `docs/multiagent-operations-runbook.md` quando o release incluir bundle multiagente, handoffs, memoria compartilhada ou isolamento por agente.

```bash
npm run test:mvp-main-path
npm run test:portable-runtime
npm run test:portable-runtime-auth
npm run test:portable-runtime-bundle
npm run test:docker-runtime-smoke
npm run test:codegen
npm run test:multiagent-postgres
npm run test:builder-auth-corporate
npm run test:ui-theme
```

## vm-microvm-release

Uso: release de isolamento forte quando VM/microVM entra no escopo do ambiente. Os gates de smoke real rodam em dry-run por padrao e precisam de opt-in/artefatos do operador para provar boot real.

Use `docs/isolation-levels-runbook.md` para escolher o nivel de isolamento por risco antes de exigir VM/microVM.

```bash
npm run test:vm-image-manifest
npm run test:vm-image-bundle
npm run test:vm-image-scaffold
npm run test:vm-microvm-image-scaffold
npm run test:vm-image-real-smoke
npm run test:vm-microvm-real-smoke
npm run test:vm-microvm-homologation
npm run test:vm-microvm-official-recipe
npm run test:vm-microvm-release-registration
npm run test:vm-reference-runner
npm run test:vm-qemu-runner
npm run test:vm-microvm-runner
npm run test:vm-guest-agent
```

## Evidencias Externas

Estas frentes nao podem ser fechadas apenas com testes locais simulados:

- `real-model-gpu-matrix`: matriz real CPU/GPU/modelos locais em Windows/Docker Desktop, Linux, CPU only, NVIDIA GPU, NVIDIA Container Toolkit, imagens CUDA e modelos Ollama relevantes.
- `real-corporate-idp`: homologacao contra IdP, diretorio, introspeccao de sessao e auditoria central reais do operador. O contrato documental fica em `docs/external-integrations-homologation.md` e e validado por `npm run test:external-integrations-homologation`, sem chamar servicos externos.
- `managed-langsmith-provider`: deploy gerenciado LangSmith por provedor especifico, apenas se o operador escolher esse caminho opcional fora do core local-first. O mesmo contrato deve registrar `not_applicable` quando esse caminho nao for escolhido.
- `final-release-privacy-audit`: auditoria final de release para secrets, `.env`, tokens, paths locais, PII em exemplos, payload bruto em exports governados e logs/status. O contrato documental fica em `docs/release-privacy-audit.md` e e validado por `npm run test:release-privacy-audit-contract`, sem executar scan por rodada.

## Politica de Conclusao

O plano total expandido so pode ser marcado como 100% quando todos os grupos aplicaveis tiverem evidencia atual, os itens externos estiverem homologados ou formalmente classificados fora do core local, e a auditoria requisito por requisito confirmar que nenhuma frente de `projeto-final.md` segue pendente.
