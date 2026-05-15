from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    anthropic_api_key: str
    anthropic_model: str = "claude-opus-4-7"
    host: str = "127.0.0.1"
    port: int = 8787
    allowed_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    session_ttl_seconds: int = 1800
    max_image_bytes: int = 2 * 1024 * 1024
    sam_model_name: Literal['vit_b', 'vit_l', 'vit_h'] = 'vit_b'
    sam_checkpoint_path: str = './models/sam_vit_b_01ec64.pth'

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
