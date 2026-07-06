from functools import lru_cache

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    service_name: str = "reference-interview-langgraph-sandbox"
    agent_id: str = "reference-interview"
    database_url: str = "sqlite:///./agent_runtime.db"
    redis_url: str = "redis://localhost:6379/0"
    redis_enabled: bool = True
    redis_ttl_seconds: int = 3600
    use_postgres_checkpointer: bool = True
    mock_llm: bool = Field(default=True, validation_alias="MOCK_LLM")
    openai_api_key: str = Field(default="", validation_alias="OPENAI_API_KEY")
    openai_model: str = Field(default="gpt-4.1-mini", validation_alias=AliasChoices("LLM_MODEL", "OPENAI_MODEL"))
    openai_base_url: str = Field(default="", validation_alias="OPENAI_BASE_URL")
    llm_adapter: str = "openai"
    llm_max_retries: int = 2
    auth_enabled: bool = False
    agent_api_key: str = ""
    agent_api_keys: str = ""
    agent_api_keys_path: str = ""
    agent_api_revoked_key_ids: str = ""
    agent_api_revoked_key_ids_path: str = ""
    auth_rate_limit_enabled: bool = False
    auth_rate_limit_requests: int = 60
    auth_rate_limit_window_seconds: int = 60
    auth_audit_enabled: bool = True
    auth_audit_max_entries: int = 200
    auth_audit_path: str = ""
    auto_create_tables: bool = True
    log_level: str = "INFO"
    langsmith_tracing: bool = False
    langsmith_api_key: str = ""
    langsmith_project: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8-sig",
        env_prefix="",
        case_sensitive=False,
    )

    @model_validator(mode="after")
    def validate_runtime_settings(self):
        has_auth_key = self.agent_api_key.strip() or self.agent_api_keys.strip() or self.agent_api_keys_path.strip()
        if self.auth_enabled and not has_auth_key:
            raise ValueError("AGENT_API_KEY, AGENT_API_KEYS ou AGENT_API_KEYS_PATH é obrigatória quando AUTH_ENABLED=true.")
        requires_api_key = self.llm_adapter.strip().lower() not in {"ollama"}
        if not self.mock_llm and requires_api_key and not self.openai_api_key.strip():
            raise ValueError("OPENAI_API_KEY é obrigatória quando MOCK_LLM=false.")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
