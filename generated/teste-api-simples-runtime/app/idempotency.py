import hashlib
import json
from datetime import datetime
from typing import Any, Callable

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app import repo


def normalize_idempotency_key(header_value: str | None, body_value: str | None) -> str:
    header = (header_value or "").strip()
    body = (body_value or "").strip()
    if header and body and header != body:
        raise HTTPException(
            status_code=400,
            detail="Header Idempotency-Key e campo idempotency_key possuem valores diferentes.",
        )
    key = header or body
    if not key:
        raise HTTPException(status_code=400, detail="Idempotency-Key é obrigatório para esta operação.")
    return key


def request_hash(payload: dict[str, Any]) -> str:
    cleaned = {key: value for key, value in payload.items() if key != "idempotency_key"}
    raw = json.dumps(cleaned, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def run_idempotent(
    session: Session,
    *,
    operation: str,
    idempotency_key: str,
    payload: dict[str, Any],
    handler: Callable[[], dict[str, Any]],
) -> dict[str, Any]:
    current_hash = request_hash(payload)
    existing = repo.get_idempotency_record(
        session,
        operation=operation,
        idempotency_key=idempotency_key,
    )
    if existing:
        if existing.request_hash != current_hash:
            raise HTTPException(
                status_code=409,
                detail="Chave de idempotência já usada com payload diferente.",
            )
        return dict(existing.response_json)

    response = handler()
    repo.save_idempotency_record(
        session,
        operation=operation,
        idempotency_key=idempotency_key,
        request_hash=current_hash,
        status_code=200,
        response_json=response,
    )
    return response
