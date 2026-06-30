"""Entrypoint do LangGraph Platform para sandbox LangSmith/LangGraph.

Este modulo exporta `graph` no formato esperado por `langgraph.json`.
O runtime FastAPI continua em `app.main:app`; este arquivo existe para
validar o comportamento do agente no sandbox antes do empacotamento final.
"""

from app.db import init_db
from app.graph import build_graph
from app.llm import LLMClient
from app.safety import SafetyGate
from app.settings import get_settings


settings = get_settings()
if settings.auto_create_tables:
    init_db()

llm_client = LLMClient(settings)
safety_gate = SafetyGate()

graph = build_graph(
    settings=settings,
    llm_client=llm_client,
    safety_gate=safety_gate,
    checkpointer=None,
)
