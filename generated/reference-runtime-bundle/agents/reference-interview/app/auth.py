from fastapi import Header, HTTPException, Request


def require_agent_api_key(
    request: Request,
    x_agent_api_key: str | None = Header(default=None, alias="X-Agent-API-Key"),
) -> None:
    settings = request.app.state.settings
    if not settings.auth_enabled:
        return
    if (x_agent_api_key or "").strip() != settings.agent_api_key:
        raise HTTPException(status_code=403, detail="Chave de API inválida.")
