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

## Nós

- `start_node` (start)
- `input_safety_check` (safety_gate)
- `llm_step` (llm_prompt)
- `output_safety_check` (safety_gate)
- `deterministic_gate` (code)
- `finish_node` (end)
