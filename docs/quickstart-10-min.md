# Quickstart de 10 Minutos

Este guia leva um usuario novo do workspace local ate uma API FastAPI/Docker gerada pelo Agent Flow Studio. O caminho principal continua local-first: LangSmith Cloud e opcional, e o runtime final e um pacote removivel do Studio.

## Antes de Comecar

Requisitos locais:

- Node.js com npm.
- Python disponivel como `python`.
- Docker Desktop ou Docker Engine somente para validar a API Docker final.
- Dependencias instaladas no repo com `npm install`.

Use dois terminais na raiz do repositorio.

## 1. Subir o Builder

Terminal 1:

```powershell
npm run dev:builder-api
```

Terminal 2:

```powershell
npm run dev:builder-ui
```

Abra a UI em `http://127.0.0.1:5173`. A API do Builder fica em `http://127.0.0.1:3333/health`.

## 2. Abrir e Validar o Flow

Na UI:

1. Selecione `reference-interview`.
2. Revise o grafo na aba `Editar`.
3. Abra `Validacao`.
4. Execute `Validar`.

Pelo terminal, o equivalente rapido e:

```powershell
npm run validate:flow
```

## 3. Testar Localmente

Para gerar o sandbox LangGraph local:

```powershell
npm run codegen:sandbox
```

Para validar o runtime gerado sem Docker:

```powershell
npm run codegen:reference
npm run test:generated
```

No Studio, use um runtime local ou sandbox disponivel, rode uma sessao, envie um turno e confirme timeline, eventos, state e output antes de aprovar.

## 4. Aprovar e Gerar API Docker

Na UI, siga o gate do Studio:

1. Gere ou atualize a evidencia de debug.
2. Registre a aprovacao do hash atual.
3. Gere o runtime final.
4. Abra `Artefato` e confira o pacote Docker.

O caminho automatizado do MVP principal e validado por:

```powershell
npm run test:mvp-main-path
```

## 5. Rodar a API Final Fora do Studio

Depois de gerar o runtime final, o pacote pode ser operado sem abrir o Builder/Studio.

```powershell
cd generated/reference-interview-runtime
docker compose up -d --build
```

Verifique:

- Swagger/OpenAPI: `http://127.0.0.1:8080/docs`
- Health: `http://127.0.0.1:8080/health`
- Metadata: `http://127.0.0.1:8080/metadata`

O smoke Docker real do repo cobre health, metadata, sessao, start, turn, transcript, events, finish, jobs e logs:

```powershell
npm run test:docker-runtime-smoke
```

O caminho de pacote removivel fora do workspace do Studio e coberto por:

```powershell
npm run test:portable-runtime
npm run test:portable-runtime-auth
npm run test:portable-runtime-bundle
```

## 6. Modelos Locais

O runtime usa `MOCK_LLM=true` por padrao. Para modelo local Ollama, configure o flow para adapter `ollama`, use o painel `Modelos` na UI ou rode o profile gerado:

```powershell
docker compose --profile model-setup up ollama-pull-qwen3-8b
```

LangSmith Cloud nao e necessario para este fluxo. Se for usado, trate como handoff ou deploy opcional governado, sem salvar token no flow versionado.

## Checks Rapidos

Durante desenvolvimento:

```powershell
npm run typecheck
npm run test:builder-api
npm run build:builder-ui
```

Antes de falar em release do plano expandido, rode os gates apropriados e o audit do plano:

```powershell
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

Use `docs/release-gate-matrix.md` para escolher entre gates diarios, release local, gates opt-in de VM/microVM e evidencias externas. Esse audit deve continuar reportando `MVP principal = 100%` e `plano total expandido = em andamento` ate existir evidencia requisito por requisito para fechar todas as frentes.

Guias por perfil:

- `docs/user-guide.md`: uso visual do Builder/Studio.
- `docs/operator-guide.md`: operacao do runtime final.
- `docs/developer-guide.md`: continuidade de desenvolvimento no monorepo.
- `docs/local-models-runbook.md`: preparo de modelos locais, GPU e distribuicao de imagens.
- `docs/release-privacy-audit.md`: contrato da auditoria final de privacidade/release sem scan por rodada.
- `docs/external-integrations-homologation.md`: contrato de homologacao de integracoes externas opcionais.
- `docs/isolation-levels-runbook.md`: escolha de isolamento por risco.
- `docs/multiagent-operations-runbook.md`: operacao de bundles multiagente.
- `docs/expanded-plan-requirement-audit.md`: auditoria requisito-a-requisito governada do plano expandido.
