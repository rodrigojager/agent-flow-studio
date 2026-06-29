# Reference Interview Runtime

Baseline manual em LangGraph + FastAPI para validar a arquitetura da fábrica de agentes.

## Executar local

```bash
cp .env.example .env
docker compose up --build
```

Swagger:

```text
http://localhost:8080/docs
```

## Fluxo mínimo

```bash
curl -X POST http://localhost:8080/sessions \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: create-1" \
  -d '{"metadata":{"source":"curl"},"max_turns":3}'

curl -X POST http://localhost:8080/sessions/{session_id}/start \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: start-1" \
  -d '{}'

curl -X POST http://localhost:8080/sessions/{session_id}/turn \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: turn-1" \
  -d '{"user_message":"Minha resposta de teste."}'
```

## Testes

```bash
pip install -e ".[dev]"
pytest -q
```
