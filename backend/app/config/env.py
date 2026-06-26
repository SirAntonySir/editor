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
    # Latency-tier model for typing-time calls (palette smart-match) where
    # we trade a little quality for ~10x faster round-trip. Read by
    # AnthropicClient.smart_match — every other call site stays on the
    # primary `anthropic_model`.
    anthropic_fast_model: str = "claude-haiku-4-5-20251001"
    # Mid-tier model — read by the palette's Ask mode (`ask_about_image`).
    # Sonnet sits between Haiku's speed and Opus's quality at ~3× Haiku
    # cost. Q&A doesn't need Opus reasoning but benefits from Sonnet's
    # better grounded-narrative output over Haiku.
    anthropic_sonnet_model: str = "claude-sonnet-4-6"
    host: str = "127.0.0.1"
    port: int = 8787
    # Empty by default so a fresh prod install doesn't accidentally accept
    # `http://localhost:5173` requests from a co-located dev server. For
    # local development, set ALLOWED_ORIGINS in .env (see .env.example).
    allowed_origins: str = ""
    # Shared-secret gate. Empty = auth disabled (local / Tailscale). When set
    # (e.g. on a public Render deploy), every request except /health and CORS
    # preflight must present this token via `Authorization: Bearer <token>` or
    # a `?token=<token>` query param (the latter for the header-less SSE stream).
    backend_auth_token: str = ""
    # Dedicated secret for the /admin cockpit, SEPARATE from backend_auth_token.
    # backend_auth_token is shipped to the browser (VITE_BACKEND_TOKEN) so it
    # can't protect participant data; this one is server-only. Empty = admin
    # stays loopback-only (no remote access).
    admin_token: str = ""
    session_ttl_seconds: int = 1800
    max_image_bytes: int = 2 * 1024 * 1024
    sam_checkpoint_path: str | None = None
    sam_model_name: str = "facebook/sam2.1-hiera-base-plus"
    use_registry_planner: bool = Field(default=False, validation_alias="USE_REGISTRY_PLANNER")

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


Settings = EnvSettings
