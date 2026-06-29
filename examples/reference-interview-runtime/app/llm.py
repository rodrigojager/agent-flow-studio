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
    ) -> LLMResult:
        if self.settings.mock_llm:
            return LLMResult(
                text=(
                    "Recebi sua mensagem e mantive o fluxo do agente ativo. "
                    f"Você disse: {user_message}"
                ),
                provider="mock",
                model="mock",
                attempts=1,
            )

        client_kwargs: dict[str, Any] = {"api_key": self.settings.openai_api_key}
        if self.settings.openai_base_url.strip():
            client_kwargs["base_url"] = self.settings.openai_base_url.strip()
        client = OpenAI(**client_kwargs)

        messages = [{"role": "system", "content": system_prompt}]
        messages.append(
            {
                "role": "user",
                "content": json.dumps(
                    {"context": context, "user_message": user_message},
                    ensure_ascii=False,
                ),
            }
        )
        messages.extend(recent_messages)

        max_attempts = max(1, int(self.settings.llm_max_retries or 1))
        last_error: Exception | None = None
        for attempt in range(1, max_attempts + 1):
            try:
                response = client.responses.create(
                    model=self.settings.openai_model,
                    input=messages,
                )
                return LLMResult(
                    text=(response.output_text or "").strip() or "Sem resposta do modelo.",
                    provider=self.settings.llm_adapter,
                    model=self.settings.openai_model,
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
