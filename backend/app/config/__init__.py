"""Application configuration package.

Single source of truth for:
  - env-layer settings (env.py): secrets, host/port, deploy-time overrides
  - runtime constants (runtime.py): timings, limits, LLM token budgets
  - UI tokens (ui.py): z-index tiers, motion, layout bounds

Frontend consumes runtime + ui via shared/types/generated.ts.

Op param ranges are NOT in this package — backend code that needs them
goes through `app.registry.loader.load_registry()` directly.

Common imports:
    from app.config import get_app_config
    cfg = get_app_config()
    cfg.runtime.slider_debounce_ms    # int
    cfg.env.anthropic_api_key         # str

Legacy imports preserved during migration:
    from app.config import get_settings, Settings  # = EnvSettings
"""

from .app_config import AppConfig, get_app_config, get_settings
from .env import EnvSettings, Settings
from .runtime import RuntimeConfig
from .ui import UiConfig

__all__ = [
    "AppConfig",
    "EnvSettings",
    "RuntimeConfig",
    "Settings",
    "UiConfig",
    "get_app_config",
    "get_settings",
]
