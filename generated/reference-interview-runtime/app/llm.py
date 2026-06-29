import json
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
    ) -> LLMResult:
        selected_adapter = (adapter or self.settings.llm_adapter).strip()
        selected_model = (model or self.settings.openai_model).strip()
        if self.settings.mock_llm:
            return LLMResult(
                text=(
                    "Recebi sua mensagem e mantive o fluxo do agente ativo. "
                    f"Você disse: {user_message}"
                ),
                provider="mock",
                model=selected_model or "mock",
                attempts=1,
            )

        client_kwargs: dict[str, Any] = {"api_key": self.settings.openai_api_key}
        default_base_urls = {"openrouter": "https://openrouter.ai/api/v1"}
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
                if attempt < max_attempts:
                    time.sleep(min(0.25 * attempt, 1.0))
        raise RuntimeError(f"Falha ao chamar LLM após {max_attempts} tentativa(s): {last_error}") from last_error


def load_prompt(name: str = "system.md") -> str:
    path = Path(__file__).resolve().parent / "prompts" / name
    return path.read_text(encoding="utf-8").strip()
