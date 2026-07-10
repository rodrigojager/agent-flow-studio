import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request

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
        default_base_urls = json.loads("{\n  \"openrouter\": \"https://openrouter.ai/api/v1\",\n  \"ollama\": \"http://localhost:11434/v1\",\n  \"opencode-go\": \"https://opencode.ai/zen/go/v1\",\n  \"opencode-zen\": \"https://opencode.ai/zen/v1\"\n}")
        api_key = self.settings.openai_api_key.strip() or default_api_keys.get(selected_adapter.lower(), "")
        client_kwargs: dict[str, Any] = {"api_key": api_key}
        base_url = self.settings.openai_base_url.strip() or default_base_urls.get(selected_adapter.lower(), "")
        if base_url:
            client_kwargs["base_url"] = base_url
        client = OpenAI(**client_kwargs)
        request_model = _provider_model_id(selected_adapter, selected_model)
        endpoint_protocol = _llm_endpoint_protocol(selected_adapter, request_model)

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
                response_text = _call_llm_endpoint(
                    client=client,
                    protocol=endpoint_protocol,
                    base_url=base_url,
                    api_key=api_key,
                    model=request_model,
                    messages=messages,
                    token_callback=token_callback if callable(token_callback) else None,
                ).strip()
                return LLMResult(
                    text=response_text or "Sem resposta do modelo.",
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


def _provider_model_id(adapter: str, model: str) -> str:
    adapter_id = adapter.strip().lower()
    model_id = model.strip()
    if adapter_id == "opencode-zen" and model_id.startswith("opencode/"):
        return model_id.split("/", 1)[1]
    if adapter_id == "opencode-go" and model_id.startswith("opencode-go/"):
        return model_id.split("/", 1)[1]
    return model_id


def _llm_endpoint_protocol(adapter: str, model: str) -> str:
    adapter_id = adapter.strip().lower()
    model_id = model.strip().lower()
    if adapter_id == "opencode-go":
        if model_id.startswith("minimax-") or model_id.startswith("qwen3."):
            return "anthropic_messages"
        return "chat_completions"
    if adapter_id == "opencode-zen":
        if model_id.startswith("gpt-"):
            return "responses"
        if model_id.startswith("claude-") or model_id.startswith("qwen3."):
            return "anthropic_messages"
        if model_id.startswith("gemini-"):
            return "google_model"
        return "chat_completions"
    return "responses"


def _call_llm_endpoint(
    *,
    client: OpenAI,
    protocol: str,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    token_callback: Any | None,
) -> str:
    if protocol == "responses":
        return _call_openai_responses(client=client, model=model, messages=messages, token_callback=token_callback)
    if protocol == "chat_completions":
        return _call_openai_chat_completions(client=client, model=model, messages=messages, token_callback=token_callback)
    if protocol == "anthropic_messages":
        return _call_anthropic_messages(base_url=base_url, api_key=api_key, model=model, messages=messages, token_callback=token_callback)
    if protocol == "google_model":
        return _call_google_model(base_url=base_url, api_key=api_key, model=model, messages=messages, token_callback=token_callback)
    raise ValueError(f"Protocolo LLM não suportado: {protocol}")


def _call_openai_responses(
    *,
    client: OpenAI,
    model: str,
    messages: list[dict[str, str]],
    token_callback: Any | None,
) -> str:
    if callable(token_callback):
        stream_response = client.responses.create(
            model=model,
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
            return response_text
    response = client.responses.create(
        model=model,
        input=messages,
    )
    return str(response.output_text or "")


def _call_openai_chat_completions(
    *,
    client: OpenAI,
    model: str,
    messages: list[dict[str, str]],
    token_callback: Any | None,
) -> str:
    if callable(token_callback):
        stream_response = client.chat.completions.create(
            model=model,
            messages=messages,
            stream=True,
        )
        stream_chunks: list[str] = []
        for raw_chunk in stream_response:
            chunk = _extract_chat_stream_text(raw_chunk)
            if chunk:
                stream_chunks.append(chunk)
                token_callback(chunk)
        response_text = "".join(stream_chunks).strip()
        if response_text:
            return response_text
    response = client.chat.completions.create(
        model=model,
        messages=messages,
    )
    return _extract_chat_completion_text(response)


def _call_anthropic_messages(
    *,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    token_callback: Any | None,
) -> str:
    payload = {
        "model": model,
        "max_tokens": 4096,
        "system": _system_prompt_from_messages(messages),
        "messages": _anthropic_messages_from_openai(messages),
    }
    response = _post_json(
        _join_url(base_url, "messages"),
        payload,
        _json_auth_headers(api_key, anthropic=True),
    )
    text = _extract_anthropic_messages_text(response)
    if callable(token_callback):
        for chunk in _iter_text_stream_chunks(text):
            token_callback(chunk)
    return text


def _call_google_model(
    *,
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    token_callback: Any | None,
) -> str:
    payload: dict[str, Any] = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": _user_prompt_from_messages(messages)}],
            }
        ]
    }
    system_prompt = _system_prompt_from_messages(messages)
    if system_prompt:
        payload["systemInstruction"] = {"parts": [{"text": system_prompt}]}
    model_url = _join_url(base_url, f"models/{model}:generateContent")
    try:
        response = _post_json(model_url, payload, _json_auth_headers(api_key, google=True))
    except RuntimeError as exc:
        if "HTTP 404" not in str(exc):
            raise
        response = _post_json(_join_url(base_url, f"models/{model}"), payload, _json_auth_headers(api_key, google=True))
    text = _extract_google_text(response)
    if callable(token_callback):
        for chunk in _iter_text_stream_chunks(text):
            token_callback(chunk)
    return text


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


def _extract_chat_stream_text(raw_chunk: Any) -> str:
    payload = _payload_to_dict(raw_chunk)
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0]
    if not isinstance(first, dict):
        return ""
    delta = first.get("delta")
    if not isinstance(delta, dict):
        return ""
    content = delta.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(_text_from_content_part(part) for part in content)
    return ""


def _extract_chat_completion_text(response: Any) -> str:
    payload = _payload_to_dict(response)
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0]
    if not isinstance(first, dict):
        return ""
    message = first.get("message")
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(_text_from_content_part(part) for part in content)
    return ""


def _extract_anthropic_messages_text(response: dict[str, Any]) -> str:
    content = response.get("content")
    if isinstance(content, list):
        return "".join(_text_from_content_part(part) for part in content)
    if isinstance(content, str):
        return content
    return str(response.get("text") or "")


def _extract_google_text(response: dict[str, Any]) -> str:
    candidates = response.get("candidates")
    if isinstance(candidates, list) and candidates:
        first = candidates[0]
        if isinstance(first, dict):
            content = first.get("content")
            if isinstance(content, dict):
                parts = content.get("parts")
                if isinstance(parts, list):
                    return "".join(_text_from_content_part(part) for part in parts)
            text = first.get("text")
            if isinstance(text, str):
                return text
    return str(response.get("text") or "")


def _payload_to_dict(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    if hasattr(value, "model_dump"):
        try:
            payload = value.model_dump()
            return payload if isinstance(payload, dict) else {}
        except Exception:
            return getattr(value, "__dict__", {}) if isinstance(getattr(value, "__dict__", {}), dict) else {}
    try:
        payload = dict(value)
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return getattr(value, "__dict__", {}) if isinstance(getattr(value, "__dict__", {}), dict) else {}


def _text_from_content_part(part: Any) -> str:
    if isinstance(part, str):
        return part
    if not isinstance(part, dict):
        return ""
    text = part.get("text")
    if isinstance(text, str):
        return text
    if part.get("type") == "text" and isinstance(part.get("content"), str):
        return str(part.get("content"))
    return ""


def _system_prompt_from_messages(messages: list[dict[str, str]]) -> str:
    for message in messages:
        if str(message.get("role") or "") == "system":
            return str(message.get("content") or "")
    return ""


def _user_prompt_from_messages(messages: list[dict[str, str]]) -> str:
    parts: list[str] = []
    for message in messages:
        role = str(message.get("role") or "")
        if role == "system":
            continue
        content = str(message.get("content") or "")
        if content:
            parts.append(f"{role}: {content}")
    return "\n\n".join(parts)


def _anthropic_messages_from_openai(messages: list[dict[str, str]]) -> list[dict[str, str]]:
    converted: list[dict[str, str]] = []
    for message in messages:
        role = str(message.get("role") or "")
        if role == "system":
            continue
        converted.append({
            "role": "assistant" if role == "assistant" else "user",
            "content": str(message.get("content") or ""),
        })
    return converted or [{"role": "user", "content": ""}]


def _join_url(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def _json_auth_headers(api_key: str, *, anthropic: bool = False, google: bool = False) -> dict[str, str]:
    headers = {
        "content-type": "application/json",
        "accept": "application/json",
    }
    if api_key:
        headers["authorization"] = f"Bearer {api_key}"
        if anthropic:
            headers["x-api-key"] = api_key
        if google:
            headers["x-goog-api-key"] = api_key
    if anthropic:
        headers["anthropic-version"] = "2023-06-01"
    return headers


def _post_json(url: str, payload: dict[str, Any], headers: dict[str, str]) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib_request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib_request.urlopen(request, timeout=60) as response:
            raw = response.read().decode("utf-8")
    except urllib_error.HTTPError as exc:
        raw_error = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} from {url}: {raw_error[:500]}") from exc
    except urllib_error.URLError as exc:
        raise RuntimeError(f"Falha de rede chamando {url}: {exc}") from exc
    if not raw.strip():
        return {}
    parsed = json.loads(raw)
    return parsed if isinstance(parsed, dict) else {}


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
