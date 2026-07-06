# Runbook de Modelos Locais e GPU

Este runbook cobre preparo, diagnostico e distribuicao de modelos locais para o Agent Flow Studio.

Status de referencia:

- MVP principal = 100%.
- plano total expandido = em andamento.
- LangSmith Cloud e opcional.
- A matriz real `real-model-gpu-matrix` continua evidencia externa antes de qualquer claim de 100% total.

## Caminho CPU Local

Use Ollama/OpenAI-compatible para rodar sem chave real de provedor:

```bash
ollama pull qwen3:8b
```

Variaveis esperadas no runtime/Studio quando usar modelo local:

```text
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_API_KEY=ollama
LLM_MODEL=qwen3:8b
MOCK_LLM=false
```

`OLLAMA_API_KEY=ollama` e dummy local, nao segredo real. Para desenvolvimento rapido, `MOCK_LLM=true` continua o caminho mais barato e deterministico.

## Setup Pelo Runtime Docker

Quando o flow usa adapter local, o runtime gerado pode incluir servicos one-shot no profile `model-setup`.

Comando operacional no pacote gerado:

```bash
docker compose --profile model-setup up
```

Depois do pull, suba a API normalmente:

```bash
docker compose up -d --build
```

## Caminho GPU NVIDIA

Antes de usar GPU, confirme o host:

```bash
nvidia-smi
docker info
```

Requisitos comuns:

- driver NVIDIA funcional;
- Docker com runtime NVIDIA;
- NVIDIA Container Toolkit instalado;
- imagem CUDA compativel;
- memoria suficiente para o modelo escolhido.

Quando o pacote gerado inclui override GPU, use:

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
```

Se o Studio mostrar GPU indisponivel, trate como falha de ambiente, nao como regressao do MVP principal.

## Distribuicao de Imagens de Modelo

Fluxo esperado para operadores:

1. construir imagem Ollama pre-carregada pelo Builder/Studio;
2. exportar a imagem como `.tar` quando precisar mover entre maquinas;
3. carregar a imagem no host destino;
4. opcionalmente publicar com `docker image push` quando a tag aponta para registry;
5. registrar a imagem no catalogo local/compartilhavel.

Sync central de catalogo pode usar `AGENT_FLOW_MODEL_IMAGE_CATALOG_CENTRAL_URL`. O catalogo nao deve conter credenciais Docker, valores de `.env`, tokens ou payloads brutos.

## Falhas Comuns

- Modelo nao existe: rode `ollama pull <modelo>` ou o profile `model-setup`.
- Memoria insuficiente: escolha preset menor, como `llama3.2:3b`, ou habilite GPU real.
- GPU ausente no container: revise NVIDIA Container Toolkit e runtime Docker.
- Imagem CUDA incompativel: troque tag CUDA ou valide driver/runtime.
- Registry bloqueado: valide login Docker fora dos exports governados.

## Evidencia Para Release

Gates locais/documentais:

```bash
npm run test:local-models-runbook
npm run test:expanded-plan-gate-matrix
```

Evidencia externa pendente em `docs/release-gate-matrix.md`:

- `real-model-gpu-matrix`: Windows + Docker Desktop, Linux, CPU only, NVIDIA GPU, NVIDIA Container Toolkit, imagens CUDA e modelos Ollama relevantes.

Essa matriz deve registrar ambiente, modelo, comando, resultado, falhas e acao corretiva sem secrets, headers, tokens, payload bruto ou paths locais sensiveis.
