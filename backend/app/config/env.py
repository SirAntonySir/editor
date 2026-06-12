"""Env-layer settings — read from .env / environment variables only.

Use this for secrets, host/port, and anything the operator overrides at deploy time.
Constants that the codebase needs to consume internally live in runtime.py / ui.py.
"""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class EnvSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    anthropic_api_key: str
    anthropic_model: str = "claude-opus-4-7"
    host: str = "127.0.0.1"
    port: int = 8787
    allowed_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    session_ttl_seconds: int = 1800
    max_image_bytes: int = 2 * 1024 * 1024
    sam_checkpoint_path: str | None = None
    sam_model_name: str = "facebook/sam2.1-hiera-base-plus"
    use_registry_planner: bool = Field(default=False, validation_alias="USE_REGISTRY_PLANNER")

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


Settings = EnvSettings
