# Agente de Referência

Runtime gerado a partir de `reference-interview`.

## Contrato

- `POST /sessions`
- `GET /sessions/{session_id}`
- `POST /sessions/{session_id}/start`
- `POST /sessions/{session_id}/turn`
- `POST /sessions/{session_id}/finish`
- `GET /sessions/{session_id}/transcript`
- `GET /sessions/{session_id}/events`

## Execução local

```powershell
python -m pip install -e ".[dev]"
pytest -q
uvicorn app.main:app --reload --port 8080
```

## Container Docker

```powershell
Copy-Item .env.example .env
docker compose up --build
```

A API fica em `http://127.0.0.1:8080/docs`.

## Validação LangSmith/LangGraph

Para testar no sandbox LangSmith/LangGraph, gere o pacote separado pelo botão `LangGraph` do builder ou pelo script `npm run codegen:sandbox`. Esse runtime é o alvo final FastAPI/Docker e não instala o CLI do LangGraph para evitar conflito de dependências com FastAPI.

Este pacote ainda inclui `langgraph.json` e `app/langgraph_app.py` para rastreabilidade do grafo aprovado, mas o artefato preferencial para upload/teste no LangSmith é `generated/reference-interview-langgraph-sandbox`.

## Nós

- `start_node` (start)
- `input_safety_check` (safety_gate)
- `llm_step` (llm_prompt)
- `output_safety_check` (safety_gate)
- `deterministic_gate` (code)
- `finish_node` (end)
