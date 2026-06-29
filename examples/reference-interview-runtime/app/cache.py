import json
from typing import Any

import redis

from app.settings import Settings


class InMemoryCache:
    def __init__(self) -> None:
        self._store: dict[str, str] = {}

    def get_json(self, key: str) -> Any | None:
        raw = self._store.get(key)
        return json.loads(raw) if raw else None

    def set_json(self, key: str, value: Any, ttl_seconds: int | None = None) -> None:
        self._store[key] = json.dumps(value, ensure_ascii=False)

    def delete(self, *keys: str) -> None:
        for key in keys:
            self._store.pop(key, None)

    def ping(self) -> bool:
        return True


class RedisCache:
    def __init__(self, redis_url: str) -> None:
        self._client = redis.Redis.from_url(redis_url, decode_responses=True)

    def get_json(self, key: str) -> Any | None:
        raw = self._client.get(key)
        return json.loads(raw) if raw else None

    def set_json(self, key: str, value: Any, ttl_seconds: int | None = None) -> None:
        self._client.set(key, json.dumps(value, ensure_ascii=False), ex=ttl_seconds)

    def delete(self, *keys: str) -> None:
        if keys:
            self._client.delete(*keys)

    def ping(self) -> bool:
        return bool(self._client.ping())


def recent_key(session_id: str) -> str:
    return f"reference-runtime:{session_id}:recent"


def build_cache(settings: Settings):
    if settings.redis_enabled:
        return RedisCache(settings.redis_url)
    return InMemoryCache()
