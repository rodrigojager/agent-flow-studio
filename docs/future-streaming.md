# Melhoria Futura: Streaming

O baseline não precisa suportar streaming de resposta. Os agentes atuais usam chamadas request/response por turno, em que o consumidor envia uma entrada e recebe a resposta completa do agente.

Streaming pode ser útil futuramente para:

- interfaces de chat em tempo real;
- respostas muito longas;
- progresso ao vivo de execução do grafo;
- logs operacionais durante uma chamada;
- consumo via SSE ou WebSocket.

No MVP, o contrato deve priorizar `POST /sessions/{session_id}/turn` para resposta completa e `GET /sessions/{session_id}/events` para auditoria e depuração.
