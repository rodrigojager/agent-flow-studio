# Runbook Do Smoke Real De VM

Este runbook cobre a prova prática de build/boot real de VM para o scaffold/contrato de VM.

## O Que O Gate Prova

`npm run test:vm-image-real-smoke` roda em dois modos:

- dry-run padrão: gera o scaffold QEMU, não executa código de usuário, não inicia VM e reporta prontidão do host;
- real opt-in: com `AGENT_FLOW_VM_REAL_SMOKE=1`, constrói a imagem e o `seed.iso`, grava manifesto com hashes da imagem e dos artefatos de boot, inicia QEMU, espera SSH e executa o contrato no guest agent com `providesVmIsolation=true`.

## Pré-Requisitos Do Host

O backend `host` precisa destes comandos ou variáveis apontando para binários locais:

- `QEMU_BIN` ou `qemu-system-x86_64`;
- `QEMU_IMG` ou `qemu-img`;
- `CLOUD_LOCALDS` ou `cloud-localds`;
- `AGENT_FLOW_VM_PYTHON_BINARY` ou `python`;
- `AGENT_FLOW_VM_SSH_BINARY` ou `ssh`;
- `AGENT_FLOW_VM_SSH_KEYGEN_BINARY` ou `ssh-keygen`;
- `AGENT_FLOW_VM_BASE_IMAGE` apontando para uma cloud image local em qcow2.

O gate não baixa imagem automaticamente e não guarda chave privada, API key ou segredo no scaffold.

O backend `docker` usa Docker Desktop ou Docker Engine para criar um container descartável com QEMU, `qemu-img`, `cloud-localds`, Python e SSH. Ele pode baixar/cachear a base Debian cloud image quando `AGENT_FLOW_VM_DOWNLOAD_BASE_IMAGE=1`.

## Execução

```bash
export AGENT_FLOW_VM_REAL_SMOKE=1
export AGENT_FLOW_VM_BASE_IMAGE=/path/to/base-cloud-image.qcow2
npm run test:vm-image-real-smoke
```

Backend Docker com download/cache da base Debian:

```powershell
$env:AGENT_FLOW_VM_REAL_SMOKE="1"
$env:AGENT_FLOW_VM_REAL_SMOKE_BACKEND="docker"
$env:AGENT_FLOW_VM_DOWNLOAD_BASE_IMAGE="1"
npm run test:vm-image-real-smoke
```

Em PowerShell:

```powershell
$env:AGENT_FLOW_VM_REAL_SMOKE="1"
$env:AGENT_FLOW_VM_BASE_IMAGE="C:\path\to\base-cloud-image.qcow2"
npm run test:vm-image-real-smoke
```

Se os binários não estiverem no `PATH`, defina `QEMU_BIN`, `QEMU_IMG`, `CLOUD_LOCALDS`, `AGENT_FLOW_VM_PYTHON_BINARY`, `AGENT_FLOW_VM_SSH_BINARY` e `AGENT_FLOW_VM_SSH_KEYGEN_BINARY`.

## Evidência Esperada

O modo real só deve ser considerado aprovado quando a saída JSON tiver:

- `status: "ok"`;
- `mode: "real"`;
- `bootedVm: true`;
- `guestAgentContract: "ok"`;
- `providesVmIsolation: true`.

Enquanto o gate estiver em `mode: "dry-run"`, a camada está preparada, mas o boot real da VM no host ainda não foi provado.

Em 2026-07-03, este workspace passou no modo real com `backend: "docker"`, QEMU em container, cloud image Debian cacheada, boot real, SSH, guest agent e `providesVmIsolation=true`.
