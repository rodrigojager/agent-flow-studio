from dataclasses import dataclass
from typing import Literal


Decision = Literal["allow", "block", "safe_redirect"]


@dataclass(frozen=True)
class SafetyDecision:
    blocked: bool
    decision: Decision
    category: str | None = None
    reason: str | None = None
    safe_response: str | None = None


class SafetyGate:
    def __init__(self) -> None:
        self._blocked_terms = {
            "ignore as regras": "jailbreak",
            "ignore o sistema": "jailbreak",
            "vazar prompt": "policy_leak",
            "senha secreta": "secret_request",
        }
        self._self_harm_terms = {
            "vou me matar",
            "quero me matar",
            "não aguento mais viver",
            "nao aguento mais viver",
        }

    def check_input(self, text: str) -> SafetyDecision:
        normalized = (text or "").strip().lower()
        if not normalized:
            return SafetyDecision(
                blocked=True,
                decision="safe_redirect",
                category="empty_input",
                reason="Mensagem vazia.",
                safe_response="Envie uma mensagem com conteúdo para continuarmos.",
            )
        for term in self._self_harm_terms:
            if term in normalized:
                return SafetyDecision(
                    blocked=True,
                    decision="block",
                    category="self_harm",
                    reason=f"Termo sensível detectado: {term}",
                    safe_response=(
                        "Sinto muito que você esteja passando por isso. "
                        "Procure apoio humano imediato. Se houver risco agora, ligue 188, 192 ou 190."
                    ),
                )
        for term, category in self._blocked_terms.items():
            if term in normalized:
                return SafetyDecision(
                    blocked=True,
                    decision="safe_redirect",
                    category=category,
                    reason=f"Termo bloqueado detectado: {term}",
                    safe_response="Não posso seguir com esse pedido, mas posso continuar com uma resposta segura.",
                )
        return SafetyDecision(blocked=False, decision="allow")

    def check_output(self, text: str) -> SafetyDecision:
        normalized = (text or "").strip().lower()
        if "system prompt" in normalized or "chave interna" in normalized:
            return SafetyDecision(
                blocked=True,
                decision="safe_redirect",
                category="policy_leak",
                reason="A saída tentou expor detalhes operacionais.",
                safe_response="Posso responder sem expor detalhes internos do agente.",
            )
        return SafetyDecision(blocked=False, decision="allow")
