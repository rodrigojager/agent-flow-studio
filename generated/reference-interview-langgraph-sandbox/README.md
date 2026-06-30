# Agente de Referência - Sandbox LangGraph

Artefato gerado a partir de `reference-interview` para validação no sandbox LangSmith/LangGraph.

Este pacote não é o runtime FastAPI/Docker final.

## Execução

```powershell
Copy-Item .env.example .env
python -m pip install -e ".[dev]"
pytest -q
langgraph dev
```

Configure `LANGSMITH_API_KEY`, `LANGSMITH_TRACING=true` e `LANGSMITH_PROJECT` em `.env` para registrar traces no LangSmith.
Para testar sem chamada real de modelo, mantenha `MOCK_LLM=true`.

## Entry Point

- `langgraph.json`
- `app/langgraph_app.py:graph`

## Depois da aprovação

Volte ao builder, registre a aprovação do sandbox e gere o runtime FastAPI/Docker. O builder valida o hash do flow aprovado antes de criar o pacote final da API.

## Nós

- `start_node` (start)
- `input_safety_check` (safety_gate)
- `llm_step` (llm_prompt)
- `output_safety_check` (safety_gate)
- `deterministic_gate` (code)
- `finish_node` (end)
