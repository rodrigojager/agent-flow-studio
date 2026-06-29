# Melhoria Futura: Jobs Pós-Finalização

O baseline não precisa incluir um worker separado obrigatório. Ele deve, porém, preservar estrutura para registrar ou acionar jobs pós-finalização, como análises, consolidações, exportações e notificações.

Evoluções possíveis:

- fila de jobs persistente;
- worker separado;
- agendamento com APScheduler ou equivalente;
- reprocessamento de jobs pendentes ou falhos;
- endpoints internos para enfileirar, consultar e reprocessar;
- métricas de sucesso, falha e duração.

No MVP, basta provar o ponto de extensão sem trazer toda a superfície operacional de worker da API ProUp.
