# Auditoria Final de Privacidade e Release

Este documento define o contrato da auditoria final de release do Agent Flow Studio.

Status de referencia:

- MVP principal = 100%.
- plano total expandido = em andamento.
- LangSmith Cloud e opcional.
- Nao rode scan de PII/secrets a cada alteracao.

Este runbook nao e um gate diario. Ele deve ser executado somente antes de publicacao/release, quando houver pedido explicito, ou quando existir uma razao concreta de seguranca para verificar antes de publicar.

## Escopo Da Auditoria Final

A auditoria final deve verificar:

- secrets reais;
- arquivos `.env`;
- tokens;
- paths locais;
- PII em exemplos;
- payloads brutos em exports governados;
- headers em status/export;
- logs/status com segredos;
- pacotes exportados principais;
- generated artifacts;
- exemplos e documentacao.

## Pacotes Governados

Pacotes governados nao devem conter:

- schema bruto;
- prompt bruto;
- input/output bruto;
- headers;
- tokens;
- payloads;
- secrets.

Quando dado bruto for necessario para operacao local, ele deve ser marcado como local-only e excluido de storage/export por padrao.

## Evidencia Esperada

A auditoria final deve produzir um registro local governado com:

```json
{
  "format": "agent-flow-builder.final-release-privacy-audit.v1",
  "status": "passed | failed | blocked",
  "scope": {
    "docs": true,
    "examples": true,
    "generatedArtifacts": true,
    "governedExports": true,
    "logsAndStatus": true
  },
  "summary": {
    "findings": 0,
    "blockingFindings": 0,
    "manualReviewRequired": false
  }
}
```

O registro final nao deve incluir valores brutos encontrados, tokens, headers, payloads, secrets, paths locais sensiveis ou trechos extensos de conteudo. Use refs compactas, hashes, nomes de arquivo relativos e categorias de achado.

## Procedimento De Release

Antes de publicar:

1. rode os gates de `docs/release-gate-matrix.md` aplicaveis ao release;
2. gere o relatorio governado do plano expandido com `npm run report:expanded-plan-evidence`;
3. execute a auditoria final com uma ferramenta de secrets/PII aprovada pelo operador;
4. revise exemplos, generated artifacts e exports governados;
5. corrija achados bloqueantes;
6. gere o registro `agent-flow-builder.final-release-privacy-audit.v1`;
7. somente entao considere claim de release, ainda separando `MVP principal = 100%` de `plano total expandido = em andamento` quando houver pendencias externas.

## Gate De Contrato

O gate abaixo valida este contrato documental. Ele nao executa scan:

```bash
npm run test:release-privacy-audit-contract
```

O item de evidencia externa/release-blocking na matriz continua sendo `final-release-privacy-audit`.
