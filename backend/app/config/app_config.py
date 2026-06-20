"""AppConfig — top-level aggregator composing env / runtime / ui."""

from functools import lru_cache

from pydantic import BaseModel

from .env import EnvSettings
from .runtime import RuntimeConfig
from .ui import UiConfig


class AppConfig(BaseModel):
    """All application configuration in one place.

    Use `get_app_config()` to obtain the cached instance.

    For backwards compatibility, existing call sites that did
    `from app.config import get_settings` continue to work via the
    package-level re-export.
    """

    env: EnvSettings
    runtime: RuntimeConfig = RuntimeConfig()
    ui: UiConfig = UiConfig()


@lru_cache
def get_app_config() -> AppConfig:
    return AppConfig(env=EnvSettings())


@lru_cache
def get_settings() -> EnvSettings:
    """Backwards-compatible shim. Prefer `get_app_config().env` in new code."""
    return EnvSettings()
