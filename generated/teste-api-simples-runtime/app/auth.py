import json
import secrets
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Header, HTTPException, Query, Request


@dataclass(frozen=True)
class AgentAuthContext:
    key_id: str
    scopes: frozenset[str]
    source: str
    expires_at: str | None = None


class AgentRateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = {}

    def check(self, settings: Any, context: AgentAuthContext, *, scope: str | None = None) -> None:
        if not bool(getattr(settings, "auth_rate_limit_enabled", False)):
            return
        window_seconds = max(1, int(getattr(settings, "auth_rate_limit_window_seconds", 60) or 60))
        limit = max(1, int(getattr(settings, "auth_rate_limit_requests", 60) or 60))
        now = time.monotonic()
        bucket_key = f"{context.source}:{context.key_id}:{scope or '*'}"
        bucket = self._hits.setdefault(bucket_key, deque())
        while bucket and now - bucket[0] >= window_seconds:
            bucket.popleft()
        if len(bucket) >= limit:
            raise HTTPException(status_code=429, detail="Limite de requisições da chave de API excedido.")
        bucket.append(now)


class AgentAuthAuditLog:
    def __init__(self, max_entries: int = 200, path: str = "") -> None:
        self.max_entries = max(1, int(max_entries or 200))
        self._entries: deque[dict[str, Any]] = deque(maxlen=self.max_entries)
        self.total = 0
        self.path = str(path or "").strip()
        self.persistent = bool(self.path)
        if self.persistent:
            self._load_existing_entries()

    def record(
        self,
        *,
        request: Request | None,
        context: AgentAuthContext | None,
        scope: str | None,
        status: str,
        reason: str | None = None,
    ) -> None:
        self.total += 1
        entry = {
            "seq": self.total,
            "timestamp": time.time(),
            "method": request.method if request is not None else "WS",
            "path": request.url.path if request is not None else "",
            "scope": scope,
            "status": status,
            "reason": reason,
            "key_id": context.key_id if context is not None else "anonymous",
            "source": context.source if context is not None else "auth_failed",
        }
        self._entries.append(entry)
        self._append_entry(entry)

    def list_entries(self, limit: int = 100) -> list[dict[str, Any]]:
        normalized_limit = max(1, min(int(limit or 100), self.max_entries))
        return list(self._entries)[-normalized_limit:]

    def _load_existing_entries(self) -> None:
        audit_path = Path(self.path)
        if not audit_path.exists():
            return
        for line in audit_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(entry, dict):
                self._entries.append(entry)
                try:
                    self.total = max(self.total, int(entry.get("seq") or 0))
                except (TypeError, ValueError):
                    self.total += 1

    def _append_entry(self, entry: dict[str, Any]) -> None:
        if not self.persistent:
            return
        audit_path = Path(self.path)
        audit_path.parent.mkdir(parents=True, exist_ok=True)
        with audit_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False, separators=(",", ":")) + "\n")


def _audit_log(request: Request) -> AgentAuthAuditLog | None:
    audit = getattr(request.app.state, "auth_audit", None)
    settings = request.app.state.settings
    if audit is None or not bool(getattr(settings, "auth_audit_enabled", True)):
        return None
    return audit


def _apply_auth_controls(request: Request, context: AgentAuthContext, required_scope: str | None) -> AgentAuthContext:
    limiter = getattr(request.app.state, "auth_rate_limiter", None)
    audit = _audit_log(request)
    try:
        if limiter is not None:
            limiter.check(request.app.state.settings, context, scope=required_scope)
    except HTTPException as exc:
        if audit is not None:
            audit.record(request=request, context=context, scope=required_scope, status="rate_limited", reason=str(exc.detail))
        raise
    if audit is not None:
        audit.record(request=request, context=context, scope=required_scope, status="allowed")
    return context


def _record_auth_failure(request: Request, required_scope: str | None, exc: HTTPException) -> None:
    audit = _audit_log(request)
    if audit is not None:
        audit.record(request=request, context=None, scope=required_scope, status="rejected", reason=str(exc.detail))


def _normalize_scopes(value: Any) -> frozenset[str]:
    if value is None:
        return frozenset({"*"})
    if isinstance(value, str):
        scopes = [item.strip() for item in value.replace(";", ",").split(",") if item.strip()]
        return frozenset(scopes or ["*"])
    if isinstance(value, list):
        scopes = [str(item).strip() for item in value if str(item).strip()]
        return frozenset(scopes or ["*"])
    raise ValueError("Escopos de AGENT_API_KEYS devem ser string ou lista.")


def _normalize_expiration(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _parse_expiration(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        if value.isdigit():
            return datetime.fromtimestamp(float(value), timezone.utc)
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ValueError("Expiração de API key deve ser ISO 8601 ou timestamp Unix.") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _is_expired(value: str | None) -> bool:
    expires_at = _parse_expiration(value)
    return bool(expires_at and expires_at <= datetime.now(timezone.utc))


def _append_revoked_key_ids(revoked: set[str], parsed: Any, *, source: str) -> None:
    if isinstance(parsed, str):
        for item in parsed.replace(";", ",").split(","):
            clean_item = item.strip()
            if clean_item:
                revoked.add(clean_item)
        return

    if isinstance(parsed, list):
        for item in parsed:
            clean_item = str(item or "").strip()
            if clean_item:
                revoked.add(clean_item)
        return

    if isinstance(parsed, dict):
        for key in ("revoked", "revoked_key_ids", "keys", "ids"):
            if key in parsed:
                _append_revoked_key_ids(revoked, parsed[key], source=source)
                return
        for key, value in parsed.items():
            if value:
                clean_item = str(key or "").strip()
                if clean_item:
                    revoked.add(clean_item)
        return

    raise ValueError(f"{source} deve ser JSON object, JSON array ou lista separada por vírgulas.")


def _load_revoked_key_ids_file(settings: Any, revoked: set[str]) -> None:
    raw_path = str(getattr(settings, "agent_api_revoked_key_ids_path", "") or "").strip()
    if not raw_path:
        return
    revoked_path = Path(raw_path)
    if not revoked_path.exists():
        raise ValueError("AGENT_API_REVOKED_KEY_IDS_PATH não encontrado.")
    try:
        parsed = json.loads(revoked_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError("AGENT_API_REVOKED_KEY_IDS_PATH deve conter JSON válido.") from exc
    _append_revoked_key_ids(revoked, parsed, source="AGENT_API_REVOKED_KEY_IDS_PATH")


def _iter_revoked_key_ids(settings: Any) -> set[str]:
    revoked: set[str] = set()
    raw_revoked = str(getattr(settings, "agent_api_revoked_key_ids", "") or "").strip()
    if raw_revoked:
        try:
            parsed = json.loads(raw_revoked)
        except json.JSONDecodeError:
            parsed = raw_revoked
        _append_revoked_key_ids(revoked, parsed, source="AGENT_API_REVOKED_KEY_IDS")
    _load_revoked_key_ids_file(settings, revoked)
    return revoked


def _is_revoked(settings: Any, context: AgentAuthContext, revoked_key_ids: set[str] | None = None) -> bool:
    revoked = revoked_key_ids if revoked_key_ids is not None else _iter_revoked_key_ids(settings)
    candidates = {context.key_id, f"{context.source}:{context.key_id}"}
    return bool(candidates.intersection(revoked))


def _append_configured_key(
    configured: list[tuple[str, AgentAuthContext]],
    *,
    key_id: str,
    api_key: Any,
    scopes: Any,
    source: str,
    expires_at: Any = None,
) -> None:
    clean_key = str(api_key or "").strip()
    if not clean_key:
        return
    normalized_expiration = _normalize_expiration(expires_at)
    configured.append(
        (
            clean_key,
            AgentAuthContext(
                key_id=str(key_id or f"key-{len(configured) + 1}"),
                scopes=_normalize_scopes(scopes),
                source=source,
                expires_at=normalized_expiration,
            ),
        )
    )


def _append_configured_keys_from_payload(
    configured: list[tuple[str, AgentAuthContext]],
    parsed: Any,
    *,
    source: str,
) -> None:
    if isinstance(parsed, dict) and isinstance(parsed.get("keys"), list):
        parsed = parsed["keys"]

    if isinstance(parsed, dict):
        for index, (api_key, scopes) in enumerate(parsed.items(), start=1):
            _append_configured_key(
                configured,
                key_id=f"key-{index}",
                api_key=api_key,
                scopes=scopes,
                source=source,
            )
        return

    if isinstance(parsed, list):
        for index, item in enumerate(parsed, start=1):
            if isinstance(item, str):
                _append_configured_key(
                    configured,
                    key_id=f"key-{index}",
                    api_key=item,
                    scopes="*",
                    source=source,
                )
                continue
            if isinstance(item, dict):
                if item.get("enabled") is False:
                    continue
                _append_configured_key(
                    configured,
                    key_id=str(item.get("id") or item.get("name") or f"key-{index}"),
                    api_key=item.get("key") or item.get("api_key"),
                    scopes=item.get("scopes"),
                    source=source,
                    expires_at=item.get("expires_at") or item.get("expiresAt"),
                )
                continue
            raise ValueError(f"Itens de {source} devem ser strings ou objetos.")
        return

    raise ValueError(f"{source} deve ser JSON object, JSON array ou lista separada por vírgulas.")


def _load_configured_keys_file(settings: Any, configured: list[tuple[str, AgentAuthContext]]) -> None:
    raw_path = str(getattr(settings, "agent_api_keys_path", "") or "").strip()
    if not raw_path:
        return
    keys_path = Path(raw_path)
    if not keys_path.exists():
        raise ValueError("AGENT_API_KEYS_PATH não encontrado.")
    try:
        parsed = json.loads(keys_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError("AGENT_API_KEYS_PATH deve conter JSON válido.") from exc
    _append_configured_keys_from_payload(configured, parsed, source="AGENT_API_KEYS_PATH")


def _iter_configured_keys(settings: Any) -> list[tuple[str, AgentAuthContext]]:
    configured: list[tuple[str, AgentAuthContext]] = []
    legacy_key = (getattr(settings, "agent_api_key", "") or "").strip()
    if legacy_key:
        configured.append(
            (
                legacy_key,
                AgentAuthContext(key_id="legacy", scopes=frozenset({"*"}), source="AGENT_API_KEY"),
            )
        )

    raw_keys = (getattr(settings, "agent_api_keys", "") or "").strip()
    if not raw_keys:
        _load_configured_keys_file(settings, configured)
        return configured

    try:
        parsed = json.loads(raw_keys)
    except json.JSONDecodeError:
        parsed = [item.strip() for item in raw_keys.split(",") if item.strip()]

    _append_configured_keys_from_payload(configured, parsed, source="AGENT_API_KEYS")
    _load_configured_keys_file(settings, configured)
    return configured


def describe_agent_auth_keys(settings: Any) -> dict[str, Any]:
    configured = _iter_configured_keys(settings)
    revoked_key_ids = _iter_revoked_key_ids(settings)
    file_path = str(getattr(settings, "agent_api_keys_path", "") or "").strip()
    file_info: dict[str, Any] = {"configured": bool(file_path), "path": file_path or None}
    if file_path:
        path = Path(file_path)
        file_info["exists"] = path.exists()
        if path.exists():
            stat = path.stat()
            file_info["mtime"] = stat.st_mtime
            file_info["size"] = stat.st_size

    revoked_file_path = str(getattr(settings, "agent_api_revoked_key_ids_path", "") or "").strip()
    revoked_file_info: dict[str, Any] = {"configured": bool(revoked_file_path), "path": revoked_file_path or None}
    if revoked_file_path:
        revoked_path = Path(revoked_file_path)
        revoked_file_info["exists"] = revoked_path.exists()
        if revoked_path.exists():
            stat = revoked_path.stat()
            revoked_file_info["mtime"] = stat.st_mtime
            revoked_file_info["size"] = stat.st_size

    source_counts: dict[str, int] = {}
    keys: list[dict[str, Any]] = []
    for _, context in configured:
        source_counts[context.source] = source_counts.get(context.source, 0) + 1
        keys.append(
            {
                "key_id": context.key_id,
                "source": context.source,
                "scopes": sorted(context.scopes),
                "expires_at": context.expires_at,
                "expired": _is_expired(context.expires_at),
                "revoked": _is_revoked(settings, context, revoked_key_ids),
            }
        )
    return {
        "enabled": bool(getattr(settings, "auth_enabled", False)),
        "agent_id": str(getattr(settings, "agent_id", "") or ""),
        "total": len(configured),
        "sources": source_counts,
        "file": file_info,
        "revocation": {
            "configured": bool(revoked_key_ids),
            "total": len(revoked_key_ids),
            "file": revoked_file_info,
        },
        "keys": keys,
    }


def _scope_pattern_matches(scope: str, required_scope: str) -> bool:
    if scope == "*" or scope == required_scope:
        return True
    required_prefix = required_scope.split(":", 1)[0]
    if scope == required_prefix or scope == f"{required_prefix}:*":
        return True
    return bool(scope.endswith(":*") and required_scope.startswith(scope[:-1]))


def _scope_matches(scopes: frozenset[str], required_scope: str | None, *, agent_id: str | None = None) -> bool:
    if not required_scope:
        return True
    if any(_scope_pattern_matches(scope, required_scope) for scope in scopes):
        return True

    normalized_agent_id = str(agent_id or "").strip()
    if not normalized_agent_id:
        return False
    agent_required_scopes = [
        f"agents:{normalized_agent_id}:{required_scope}",
        f"agent:{normalized_agent_id}:{required_scope}",
    ]
    for agent_required_scope in agent_required_scopes:
        if any(_scope_pattern_matches(scope, agent_required_scope) for scope in scopes):
            return True
    return False


def authenticate_agent_api_key(
    settings: Any,
    api_key: str | None,
    required_scope: str | None = None,
) -> AgentAuthContext:
    if not settings.auth_enabled:
        return AgentAuthContext(key_id="disabled", scopes=frozenset({"*"}), source="auth_disabled")

    provided_key = (api_key or "").strip()
    if not provided_key:
        raise HTTPException(status_code=403, detail="Chave de API inválida.")

    try:
        configured_keys = _iter_configured_keys(settings)
        revoked_key_ids = _iter_revoked_key_ids(settings)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    for configured_key, context in configured_keys:
        if secrets.compare_digest(provided_key, configured_key):
            if _is_revoked(settings, context, revoked_key_ids):
                raise HTTPException(status_code=403, detail="Chave de API revogada.")
            if _is_expired(context.expires_at):
                raise HTTPException(status_code=403, detail="Chave de API expirada.")
            if _scope_matches(context.scopes, required_scope, agent_id=getattr(settings, "agent_id", "")):
                return context
            raise HTTPException(status_code=403, detail="Chave de API sem permissão para este recurso.")

    raise HTTPException(status_code=403, detail="Chave de API inválida.")


def require_agent_api_key(
    request: Request,
    x_agent_api_key: str | None = Header(default=None, alias="X-Agent-API-Key"),
) -> AgentAuthContext:
    try:
        context = authenticate_agent_api_key(request.app.state.settings, x_agent_api_key)
    except HTTPException as exc:
        _record_auth_failure(request, None, exc)
        raise
    return _apply_auth_controls(request, context, None)


def require_agent_scope(required_scope: str):
    def dependency(
        request: Request,
        x_agent_api_key: str | None = Header(default=None, alias="X-Agent-API-Key"),
    ) -> AgentAuthContext:
        try:
            context = authenticate_agent_api_key(request.app.state.settings, x_agent_api_key, required_scope)
        except HTTPException as exc:
            _record_auth_failure(request, required_scope, exc)
            raise
        return _apply_auth_controls(request, context, required_scope)

    return dependency


def require_agent_scope_from_header_or_query(required_scope: str):
    def dependency(
        request: Request,
        x_agent_api_key: str | None = Header(default=None, alias="X-Agent-API-Key"),
        api_key: str | None = Query(default=None, alias="api_key"),
    ) -> AgentAuthContext:
        token = x_agent_api_key if (x_agent_api_key or "").strip() else api_key
        try:
            context = authenticate_agent_api_key(request.app.state.settings, token, required_scope)
        except HTTPException as exc:
            _record_auth_failure(request, required_scope, exc)
            raise
        return _apply_auth_controls(request, context, required_scope)

    return dependency
