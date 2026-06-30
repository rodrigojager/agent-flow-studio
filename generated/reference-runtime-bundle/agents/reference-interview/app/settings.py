from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    service_name: str = "reference-interview-runtime"
    database_url: str = "sqlite:///./agent_runtime.db"
    redis_url: str = "redis://localhost:6379/0"
    redis_enabled: bool = True
    redis_ttl_seconds: int = 3600
    use_postgres_checkpointer: bool = True
    mock_llm: bool = Field(default=True, validation_alias="MOCK_LLM")
    openai_api_key: str = Field(default="", validation_alias="OPENAI_API_KEY")
    openai_model: str = "gpt-4.1-mini"
    openai_base_url: str = Field(default="", validation_alias="OPENAI_BASE_URL")
    llm_adapter: str = "openai"
    llm_max_retries: int = 2
    auth_enabled: bool = False
    agent_api_key: str = ""
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
        if self.auth_enabled and not self.agent_api_key.strip():
            raise ValueError("AGENT_API_KEY é obrigatória quando AUTH_ENABLED=true.")
        if not self.mock_llm and not self.openai_api_key.strip():
            raise ValueError("OPENAI_API_KEY é obrigatória quando MOCK_LLM=false.")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
