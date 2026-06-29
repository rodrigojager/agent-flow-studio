# Reference Interview Runtime

## Purpose

Baseline manual em LangGraph + FastAPI. Prova sessões, turnos, idempotência, transcript, eventos, LLMClient, safety simples, cache quente, Docker Compose e persistência pública.

---

## Folder Structure

```text
reference-interview-runtime/
├── app/                # API, grafo, serviços e infraestrutura do runtime
├── app/prompts/        # prompts Markdown do agente
├── migrations/         # SQL inicial para Postgres
├── tests/              # testes pytest do contrato
├── pyproject.toml      # dependências Python
├── Dockerfile
└── docker-compose.yml
```

---

## Routing

| Task | Go To | Load First |
|------|-------|------------|
| Alterar endpoints | `app/main.py` | `app/schemas.py` |
| Alterar fluxo LangGraph | `app/graph.py` | `app/service.py` |
| Alterar persistência | `app/models.py` | `app/repo.py` |
| Alterar LLM ou safety | `app/llm.py`, `app/safety.py` | `app/prompts/system.md` |
| Validar comportamento | `tests/` | `README.md` |

## Commands

```bash
pip install -e ".[dev]"
pytest -q
```
