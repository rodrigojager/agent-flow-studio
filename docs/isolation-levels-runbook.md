# Runbook de Niveis de Isolamento

Este runbook orienta a escolha do nivel de isolamento para execucao de codigo, ferramentas e runners do Agent Flow Studio.

Status de referencia:

- MVP principal = 100%.
- plano total expandido = em andamento.
- LangSmith Cloud e opcional.

## Escolha Por Risco

| Nivel | Quando usar | Garantia esperada | Gate relacionado |
| --- | --- | --- | --- |
| processo local | codigo proprio simples, sem risco de escrita externa | rastreabilidade e logs locais | `npm run test:codegen` |
| workspace efemero | codigo proprio que pode escrever arquivos temporarios | descarte de workspace apos execucao | `npm run test:codegen` |
| processo dedicado | codigo Python/Bash local que precisa isolamento de processo | stdin/stdout JSON, env allowlist e descarte | `npm run test:codegen` |
| container | codigo local com dependencias e rede bloqueada | workspace montado, `--network none`, imagem controlada | `npm run test:codegen` |
| container hardened | codigo de risco maior sem exigir VM | limites CPU/mem/PIDs, rootfs read-only, cap-drop, no-new-privileges | `npm run test:codegen` |
| VM | isolamento forte quando runner externo prova VM | contrato `agent-flow-vm-runner.v1` com `providesVmIsolation=true` | `npm run test:vm-qemu-runner` |
| microVM | isolamento forte kernel-direct quando ambiente exige Firecracker/Cloud Hypervisor | boot/preflight real, politica hardened e transporte guest real | `npm run test:vm-microvm-real-smoke` |

## Politica Fail-Closed

Quando uma etapa exige `sandboxIsolation="vm"`, o runtime deve falhar fechado (`fail-closed`) se o runner retornar sucesso sem declarar `providesVmIsolation=true`, salvo override local explicito do operador.

Transportes simulados, locais ou sem guest real devem ser tratados como `providesVmIsolation=false`.

## Preflight

Antes de usar VM/microVM:

- valide manifesto do runner;
- valide manifesto da imagem;
- valide hashes SHA-256 declarados;
- valide artefatos de boot obrigatorios;
- valide politica hardened quando aplicavel;
- registre readiness governado sem path absoluto local.

Gates:

```bash
npm run test:vm-image-manifest
npm run test:vm-image-bundle
npm run test:vm-qemu-runner
npm run test:vm-microvm-runner
```

## Smokes Reais Opt-In

Os gates abaixo rodam em dry-run por padrao. Para provar ambiente real, o operador deve fornecer binarios/artefatos e opt-in por env:

```bash
npm run test:vm-image-real-smoke
npm run test:vm-microvm-real-smoke
```

Use `docs/vm-real-smoke-runbook.md` para QEMU real. Para microVM real, use a receita oficial local:

```bash
npm run vm-image:microvm-recipe
npm run vm-image:microvm-register
```

## Evidencia De Release

Para release com isolamento forte no escopo:

- pacote `.afvmimagebundle` validado;
- `runner-kit` auto-verificavel;
- homologacao `.afvmhomologation.json`;
- registro `.afvmrelease.json`;
- evidencia de preflight real;
- evidencia de boot real quando o status for `homologated`;
- nenhum secret, env value, payload bruto ou path local sensivel nos manifestos finais.

O plano total expandido segue em andamento enquanto artefatos microVM reais/oficiais do operador e smokes reais fora de dry-run nao forem homologados quando exigidos pelo ambiente.
