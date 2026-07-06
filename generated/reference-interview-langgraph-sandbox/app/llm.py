import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from openai import OpenAI

from app.settings import Settings


@dataclass(frozen=True)
class LLMResult:
    text: str
    provider: str
    model: str
    attempts: int
    fallback_reason: str | None = None
    setup_command: str | None = None
    docker_setup_command: str | None = None
    provider_error: str | None = None


class LLMClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def generate(
        self,
        *,
        system_prompt: str,
        user_message: str,
        context: dict[str, Any],
        recent_messages: list[dict[str, str]],
        adapter: str | None = None,
        model: str | None = None,
        token_callback: Any | None = None,
    ) -> LLMResult:
        selected_adapter = (adapter or self.settings.llm_adapter).strip()
        selected_model = (model or self.settings.openai_model).strip()
        if self.settings.mock_llm:
            text = (
                "Recebi sua mensagem e mantive o fluxo do agente ativo. "
                f"Você disse: {user_message}"
            )
            if callable(token_callback):
                for chunk in _iter_text_stream_chunks(text):
                    token_callback(chunk)
            return LLMResult(
                text=text,
                provider="mock",
                model=selected_model or "mock",
                attempts=1,
            )

        default_api_keys = json.loads("{\n  \"ollama\": \"ollama\"\n}")
        default_base_urls = json.loads("{\n  \"openrouter\": \"https://openrouter.ai/api/v1\",\n  \"ollama\": \"http://localhost:11434/v1\"\n}")
        client_kwargs: dict[str, Any] = {
            "api_key": self.settings.openai_api_key.strip()
            or default_api_keys.get(selected_adapter.lower(), "")
        }
        base_url = self.settings.openai_base_url.strip() or default_base_urls.get(selected_adapter.lower(), "")
        if base_url:
            client_kwargs["base_url"] = base_url
        client = OpenAI(**client_kwargs)

        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(recent_messages)
        messages.append(
            {
                "role": "user",
                "content": json.dumps(
                    {"context": context, "user_message": user_message},
                    ensure_ascii=False,
                ),
            }
        )

        max_attempts = max(1, int(self.settings.llm_max_retries or 1))
        last_error: Exception | None = None
        for attempt in range(1, max_attempts + 1):
            try:
                has_token_callback = callable(token_callback)
                if has_token_callback:
                    stream_response = client.responses.create(
                        model=selected_model,
                        input=messages,
                        stream=True,
                    )
                    stream_chunks: list[str] = []
                    for raw_chunk in stream_response:
                        chunk = _extract_llm_stream_text(raw_chunk)
                        if chunk:
                            stream_chunks.append(chunk)
                            token_callback(chunk)
                    response_text = "".join(stream_chunks).strip()
                    if response_text:
                        return LLMResult(
                            text=response_text,
                            provider=selected_adapter,
                            model=selected_model,
                            attempts=attempt,
                        )
                    response = client.responses.create(
                        model=selected_model,
                        input=messages,
                    )
                else:
                    response = client.responses.create(
                        model=selected_model,
                        input=messages,
                    )

                return LLMResult(
                    text=(response.output_text or "").strip() or "Sem resposta do modelo.",
                    provider=selected_adapter,
                    model=selected_model,
                    attempts=attempt,
                )
            except Exception as exc:
                last_error = exc
                if _is_ollama_missing_model_error(exc, selected_adapter):
                    return _ollama_missing_model_result(
                        model=selected_model,
                        provider=selected_adapter,
                        attempts=attempt,
                        error=exc,
                        token_callback=token_callback,
                    )
                if attempt < max_attempts:
                    time.sleep(min(0.25 * attempt, 1.0))
        raise RuntimeError(f"Falha ao chamar LLM após {max_attempts} tentativa(s): {last_error}") from last_error


def _iter_text_stream_chunks(text: str):
    for chunk in re.findall(r"\S+\s*", text):
        if chunk:
            yield chunk


def _extract_llm_stream_text(raw_chunk: Any) -> str:
    if raw_chunk is None:
        return ""
    payload: Any = raw_chunk
    if hasattr(payload, "model_dump"):
        try:
            payload = payload.model_dump()
        except Exception:
            payload = getattr(payload, "__dict__", {})
    elif not isinstance(payload, dict):
        try:
            payload = dict(payload)
        except Exception:
            return ""
    if not isinstance(payload, dict):
        return ""
    chunk_type = str(payload.get("type") or payload.get("event_type") or "")
    if not chunk_type.endswith("delta"):
        return ""
    candidate = payload.get("delta")
    if isinstance(candidate, dict):
        value = candidate.get("text")
    else:
        value = candidate
    if not isinstance(value, str):
        value = payload.get("text")
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return str(value.get("text") or "")
    return ""


def _is_ollama_missing_model_error(exc: Exception, adapter: str) -> bool:
    if adapter.strip().lower() != "ollama":
        return False
    text = _exception_text(exc).lower()
    if "model" not in text:
        return False
    missing_markers = (
        "not found",
        "not installed",
        "pull",
        "does not exist",
        "no such model",
        "modelo",
    )
    return any(marker in text for marker in missing_markers)


def _exception_text(exc: Exception) -> str:
    parts = [str(exc)]
    for attr in ("body", "response", "status_code"):
        value = getattr(exc, attr, None)
        if value is not None:
            parts.append(str(value))
    return " ".join(parts)


def _ollama_missing_model_result(
    *,
    model: str,
    provider: str,
    attempts: int,
    error: Exception,
    token_callback: Any | None,
) -> LLMResult:
    setup_command = f"ollama pull {model}"
    docker_setup_command = f"docker compose --profile model-setup up {_ollama_pull_service_name(model)}"
    text = (
        f"O modelo local {model} ainda não está disponível no Ollama. "
        f"Baixe o modelo com '{setup_command}' ou, no pacote Docker gerado, rode "
        f"'{docker_setup_command}'. Depois execute o turno novamente."
    )
    if callable(token_callback):
        for chunk in _iter_text_stream_chunks(text):
            token_callback(chunk)
    return LLMResult(
        text=text,
        provider=provider,
        model=model,
        attempts=attempts,
        fallback_reason="local_model_missing",
        setup_command=setup_command,
        docker_setup_command=docker_setup_command,
        provider_error=_exception_text(error)[:500],
    )


def _ollama_pull_service_name(model: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", f"ollama-pull-{model}".lower()).strip("-")
    return slug or "ollama-pull-model"


def load_prompt(name: str = "system.md") -> str:
    path = Path(__file__).resolve().parent / "prompts" / name
    return path.read_text(encoding="utf-8").strip()
