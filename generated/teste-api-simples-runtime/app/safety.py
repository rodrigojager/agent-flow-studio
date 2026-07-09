import json
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Literal


Decision = Literal["allow", "block", "safe_redirect"]
Action = Literal["warn", "safe_redirect", "block"]


@dataclass(frozen=True)
class SafetyDecision:
    blocked: bool
    decision: Decision
    category: str | None = None
    reason: str | None = None
    safe_response: str | None = None
    severity: str | None = None
    action: str | None = None
    rule_id: str | None = None
    rule_label: str | None = None
    match_type: str | None = None
    matched_text: str | None = None
    source: str = "local"
    provider_score: float | None = None
    provider_error: str | None = None


class SafetyGate:
    def __init__(self) -> None:
        self._severity_score = {"low": 1, "medium": 2, "high": 3, "critical": 4}
        self._provider_enabled = self._env_bool("SAFETY_PROVIDER_ENABLED", False)
        self._provider_url = os.getenv("SAFETY_PROVIDER_URL", "").strip()
        self._provider_timeout_seconds = self._env_float("SAFETY_PROVIDER_TIMEOUT_SECONDS", 3.0)
        self._provider_fail_closed = self._env_bool("SAFETY_PROVIDER_FAIL_CLOSED", False)
        self._provider_headers = self._load_provider_headers(os.getenv("SAFETY_PROVIDER_HEADERS_JSON", ""))
        self._default_input_rules = [
            {
                "id": "empty_input",
                "matchType": "empty",
                "match": "",
                "category": "empty_input",
                "action": "safe_redirect",
                "reason": "Mensagem vazia.",
                "safeResponse": "Envie uma mensagem com conteúdo para continuarmos.",
            },
            {
                "id": "self_harm_1",
                "matchType": "contains",
                "match": "vou me matar",
                "category": "self_harm",
                "action": "block",
                "reason": "Termo sensível detectado: vou me matar",
                "safeResponse": (
                    "Sinto muito que você esteja passando por isso. "
                    "Procure apoio humano imediato. Se houver risco agora, ligue 188, 192 ou 190."
                ),
            },
            {
                "id": "self_harm_2",
                "matchType": "contains",
                "match": "quero me matar",
                "category": "self_harm",
                "action": "block",
                "reason": "Termo sensível detectado: quero me matar",
                "safeResponse": (
                    "Sinto muito que você esteja passando por isso. "
                    "Procure apoio humano imediato. Se houver risco agora, ligue 188, 192 ou 190."
                ),
            },
            {
                "id": "self_harm_3",
                "matchType": "contains",
                "match": "não aguento mais viver",
                "category": "self_harm",
                "action": "block",
                "reason": "Termo sensível detectado: não aguento mais viver",
                "safeResponse": (
                    "Sinto muito que você esteja passando por isso. "
                    "Procure apoio humano imediato. Se houver risco agora, ligue 188, 192 ou 190."
                ),
            },
            {
                "id": "self_harm_4",
                "matchType": "contains",
                "match": "nao aguento mais viver",
                "category": "self_harm",
                "action": "block",
                "reason": "Termo sensível detectado: nao aguento mais viver",
                "safeResponse": (
                    "Sinto muito que você esteja passando por isso. "
                    "Procure apoio humano imediato. Se houver risco agora, ligue 188, 192 ou 190."
                ),
            },
            {
                "id": "jailbreak_1",
                "matchType": "contains",
                "match": "ignore as regras",
                "category": "jailbreak",
                "action": "safe_redirect",
                "reason": "Termo bloqueado detectado: ignore as regras",
                "safeResponse": "Não posso seguir com esse pedido, mas posso continuar com uma resposta segura.",
            },
            {
                "id": "jailbreak_2",
                "matchType": "contains",
                "match": "ignore o sistema",
                "category": "jailbreak",
                "action": "safe_redirect",
                "reason": "Termo bloqueado detectado: ignore o sistema",
                "safeResponse": "Não posso seguir com esse pedido, mas posso continuar com uma resposta segura.",
            },
            {
                "id": "policy_leak_1",
                "matchType": "contains",
                "match": "vazar prompt",
                "category": "policy_leak",
                "action": "safe_redirect",
                "reason": "Termo bloqueado detectado: vazar prompt",
                "safeResponse": "Não posso seguir com esse pedido, mas posso continuar com uma resposta segura.",
            },
            {
                "id": "secret_request_1",
                "matchType": "contains",
                "match": "senha secreta",
                "category": "secret_request",
                "action": "safe_redirect",
                "reason": "Termo bloqueado detectado: senha secreta",
                "safeResponse": "Não posso seguir com esse pedido, mas posso continuar com uma resposta segura.",
            },
        ]
        self._default_output_rules = [
            {
                "id": "policy_leak_output_1",
                "matchType": "contains",
                "match": "system prompt",
                "category": "policy_leak",
                "action": "safe_redirect",
                "reason": "A saída tentou expor detalhes operacionais.",
                "safeResponse": "Posso responder sem expor detalhes internos do agente.",
            },
            {
                "id": "policy_leak_output_2",
                "matchType": "contains",
                "match": "chave interna",
                "category": "policy_leak",
                "action": "safe_redirect",
                "reason": "A saída tentou expor detalhes operacionais.",
                "safeResponse": "Posso responder sem expor detalhes internos do agente.",
            },
        ]

    def check_input(self, text: str, config: dict[str, Any] | None = None) -> SafetyDecision:
        return self.check(text, stage="input", config=config)

    def check_output(self, text: str, config: dict[str, Any] | None = None) -> SafetyDecision:
        return self.check(text, stage="output", config=config)

    def check(self, text: str, *, stage: str, config: dict[str, Any] | None = None) -> SafetyDecision:
        normalized = (text or "").strip().lower()
        mode = str((config or {}).get("safetyMode") or "default_and_custom")
        rules: list[dict[str, Any]] = []
        if mode in {"default", "default_and_custom"}:
            rules.extend(self._default_input_rules if stage == "input" else self._default_output_rules)
        if mode in {"custom", "default_and_custom"}:
            custom_rules = (config or {}).get("safetyRules")
            if isinstance(custom_rules, list):
                rules.extend([rule for rule in custom_rules if isinstance(rule, dict)])
        threshold = str((config or {}).get("safetySeverityThreshold") or "low")
        fallback_response = str((config or {}).get("safetyFallbackResponse") or "").strip()
        for rule in rules:
            decision = self._evaluate_rule(rule, text or "", normalized, threshold, fallback_response)
            if decision is not None:
                return decision
        external_decision = self._check_external_provider(
            text or "",
            stage=stage,
            config=config or {},
            fallback_response=fallback_response,
        )
        if external_decision is not None:
            return external_decision
        return SafetyDecision(blocked=False, decision="allow")

    def _check_external_provider(
        self,
        text: str,
        *,
        stage: str,
        config: dict[str, Any],
        fallback_response: str,
    ) -> SafetyDecision | None:
        if not self._provider_enabled or not self._provider_url:
            return None

        payload = {
            "text": text,
            "stage": stage,
            "nodeId": str(config.get("id") or ""),
            "policy": {
                "mode": config.get("safetyMode"),
                "severityThreshold": config.get("safetySeverityThreshold"),
                "fallbackResponse": config.get("safetyFallbackResponse"),
                "rules": config.get("safetyRules") if isinstance(config.get("safetyRules"), list) else [],
            },
            "local": {"blocked": False, "decision": "allow"},
        }
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers = {"Content-Type": "application/json", **self._provider_headers}
        request = urllib.request.Request(self._provider_url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=self._provider_timeout_seconds) as response:
                raw_body = response.read(1_000_000).decode("utf-8")
            data = json.loads(raw_body or "{}")
        except (OSError, TimeoutError, ValueError, urllib.error.URLError) as exc:
            if self._provider_fail_closed:
                return SafetyDecision(
                    blocked=True,
                    decision="safe_redirect",
                    category="external_safety_unavailable",
                    reason=f"Provider externo de safety indisponível: {exc}",
                    safe_response=fallback_response or "A política de segurança externa precisa responder antes de continuar.",
                    severity="high",
                    action="safe_redirect",
                    source="external",
                    provider_error=str(exc),
                )
            return SafetyDecision(
                blocked=False,
                decision="allow",
                category="external_safety_unavailable",
                reason=f"Provider externo de safety indisponível: {exc}",
                source="external",
                provider_error=str(exc),
            )

        if not isinstance(data, dict):
            if self._provider_fail_closed:
                return SafetyDecision(
                    blocked=True,
                    decision="safe_redirect",
                    category="external_safety_invalid_response",
                    reason="Provider externo de safety retornou payload inválido.",
                    safe_response=fallback_response or "A política de segurança externa precisa ser revisada antes de continuar.",
                    severity="high",
                    action="safe_redirect",
                    source="external",
                    provider_error="invalid_response",
                )
            return SafetyDecision(
                blocked=False,
                decision="allow",
                category="external_safety_invalid_response",
                reason="Provider externo de safety retornou payload inválido.",
                source="external",
                provider_error="invalid_response",
            )
        return self._decision_from_provider(data, fallback_response)

    def _decision_from_provider(self, data: dict[str, Any], fallback_response: str) -> SafetyDecision:
        raw_decision = str(data.get("decision") or "").strip().lower()
        blocked = bool(data.get("blocked"))
        if raw_decision in {"block", "safe_redirect"}:
            blocked = True
            decision: Decision = "block" if raw_decision == "block" else "safe_redirect"
        elif blocked:
            decision = "safe_redirect"
        else:
            decision = "allow"

        score = self._optional_float(data.get("score") if "score" in data else data.get("providerScore"))
        return SafetyDecision(
            blocked=blocked,
            decision=decision,
            category=str(data.get("category") or ("external_safety_policy" if blocked else "external_safety_allow")),
            reason=str(data.get("reason") or ("Provider externo bloqueou a mensagem." if blocked else "Provider externo permitiu a mensagem.")),
            safe_response=str(
                data.get("safeResponse")
                or data.get("safe_response")
                or fallback_response
                or "Não posso seguir com esse pedido, mas posso continuar com uma resposta segura."
            ) if blocked else None,
            severity=str(data.get("severity") or ("high" if blocked else "low")),
            action=str(data.get("action") or ("safe_redirect" if blocked else "allow")),
            rule_id=str(data.get("ruleId") or data.get("rule_id") or ""),
            rule_label=str(data.get("ruleLabel") or data.get("rule_label") or ""),
            source="external",
            provider_score=score,
        )

    def _load_provider_headers(self, raw_headers: str) -> dict[str, str]:
        if not raw_headers.strip():
            return {}
        try:
            decoded = json.loads(raw_headers)
        except ValueError:
            return {}
        if not isinstance(decoded, dict):
            return {}
        return {str(key): str(value) for key, value in decoded.items() if str(key).strip()}

    def _env_bool(self, name: str, default: bool) -> bool:
        value = os.getenv(name)
        if value is None:
            return default
        return value.strip().lower() in {"1", "true", "yes", "on"}

    def _env_float(self, name: str, default: float) -> float:
        value = os.getenv(name)
        if value is None:
            return default
        try:
            return max(0.1, float(value))
        except ValueError:
            return default

    def _optional_float(self, value: Any) -> float | None:
        if value is None or value == "":
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _evaluate_rule(
        self,
        rule: dict[str, Any],
        raw_text: str,
        normalized: str,
        threshold: str,
        fallback_response: str,
    ) -> SafetyDecision | None:
        match_type = str(rule.get("matchType") or rule.get("match_type") or "contains")
        pattern = str(rule.get("match") or "")
        matched_text: str | None = None
        if match_type == "empty":
            if normalized:
                return None
            matched_text = ""
        elif match_type == "regex":
            try:
                match = re.search(pattern, raw_text, flags=re.IGNORECASE)
            except re.error as exc:
                return SafetyDecision(
                    blocked=True,
                    decision="safe_redirect",
                    category="invalid_safety_rule",
                    reason=f"Regex inválida na regra {rule.get('id') or 'sem_id'}: {exc}",
                    safe_response=fallback_response or "A política de segurança precisa ser revisada antes de continuar.",
                    severity="high",
                    action="safe_redirect",
                    rule_id=str(rule.get("id") or ""),
                    rule_label=str(rule.get("label") or ""),
                    match_type=match_type,
                    matched_text=pattern,
                )
            if not match:
                return None
            matched_text = match.group(0)
        else:
            if pattern.lower() not in normalized:
                return None
            matched_text = pattern

        action = str(rule.get("action") or "safe_redirect")
        severity = str(rule.get("severity") or "medium")
        if self._severity_score.get(severity, 2) < self._severity_score.get(threshold, 1):
            action = "warn"
        if action == "warn":
            return SafetyDecision(
                blocked=False,
                decision="allow",
                category=str(rule.get("category") or "safety_warning"),
                reason=str(rule.get("reason") or f"Regra de safety acionada em modo aviso: {rule.get('id') or matched_text}."),
                severity=severity,
                action=action,
                rule_id=str(rule.get("id") or ""),
                rule_label=str(rule.get("label") or ""),
                match_type=match_type,
                matched_text=matched_text,
            )
        decision: Decision = "block" if action == "block" else "safe_redirect"
        return SafetyDecision(
            blocked=True,
            decision=decision,
            category=str(rule.get("category") or "safety_policy"),
            reason=str(rule.get("reason") or f"Regra de safety acionada: {rule.get('id') or matched_text}."),
            safe_response=str(rule.get("safeResponse") or fallback_response or "Não posso seguir com esse pedido, mas posso continuar com uma resposta segura."),
            severity=severity,
            action=action,
            rule_id=str(rule.get("id") or ""),
            rule_label=str(rule.get("label") or ""),
            match_type=match_type,
            matched_text=matched_text,
        )
