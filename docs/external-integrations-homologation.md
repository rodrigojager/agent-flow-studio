# Homologacao de Integracoes Externas

Este documento define o contrato de homologacao de integracoes externas reais do Agent Flow Studio.

Status de referencia:

- MVP principal = 100%.
- plano total expandido = em andamento.
- LangSmith Cloud e opcional.
- O fluxo local-first nao pode depender de IdP, diretorio, auditoria central, registry externo ou LangSmith gerenciado.

## Escopo

Integracoes externas cobertas:

- IdP corporativo real;
- introspeccao central de sessao;
- servico corporativo de lifecycle de sessao;
- sink central de auditoria;
- diretorio corporativo de grupos;
- registries remotos de modelo/imagem;
- deploy gerenciado LangSmith, apenas se o operador escolher esse caminho opcional.

## Regras De Governanca

- Tokens externos devem ser enviados somente em header.
- Status, exports, relatorios e homologacoes nao devem conter token, header bruto, URL sensivel, payload bruto, JWT bruto, chave bruta, token de sessao, token de provedor ou path absoluto local.
- Falha de integracao externa nao pode quebrar o fluxo local principal.
- LangSmith Cloud deve permanecer handoff opcional, nao dependencia do Builder/Studio/API Docker local.
- Qualquer registro de homologacao deve usar refs compactas, hashes, nomes de componente e status sanitizado.

## Evidencia Esperada

Registro local governado:

```json
{
  "format": "agent-flow-builder.external-integrations-homologation.v1",
  "status": "blocked | verified | homologated",
  "components": {
    "corporateIdp": "blocked | verified | homologated | not_applicable",
    "sessionIntrospection": "blocked | verified | homologated | not_applicable",
    "auditSink": "blocked | verified | homologated | not_applicable",
    "groupDirectory": "blocked | verified | homologated | not_applicable",
    "modelRegistries": "blocked | verified | homologated | not_applicable",
    "managedLangSmithProvider": "not_applicable | blocked | verified | homologated"
  },
  "governance": {
    "localFirstPreserved": true,
    "tokensOnlyInHeaders": true,
    "statusHasNoSensitiveUrlOrToken": true,
    "cloudOptional": true
  }
}
```

O registro final nao deve incluir endpoint completo sensivel, token, header, payload bruto, JWT bruto, chave bruta, token de sessao, token de provedor ou path absoluto local.

## Procedimento

1. Configure as integracoes por variaveis locais do operador.
2. Rode os probes governados existentes do Builder quando aplicavel.
3. Homologue auth corporativa com `npm run test:builder-auth-corporate` como contrato local simulado e evidencias reais do operador quando houver IdP/servicos reais.
4. Homologue registries de modelo/imagem com consultas read-only sem credenciais em corpo/status.
5. Para LangSmith gerenciado, registre explicitamente se o caminho e `not_applicable` ou se o operador escolheu um provedor.
6. Gere o registro `agent-flow-builder.external-integrations-homologation.v1`.
7. Mantenha a API Docker local operavel mesmo com integracoes externas indisponiveis, salvo quando o operador configurar fail-closed explicitamente para auth corporativa.

## Evidencias Externas

Itens de `docs/release-gate-matrix.md`:

- `real-corporate-idp`: IdP, diretorio, introspeccao de sessao e auditoria central reais do operador.
- `managed-langsmith-provider`: deploy gerenciado LangSmith por provedor especifico, somente se escolhido pelo operador.

## Gate De Contrato

O gate abaixo valida este contrato documental. Ele nao chama IdP, diretorio, registry, auditoria central nem LangSmith:

```bash
npm run test:external-integrations-homologation
```
