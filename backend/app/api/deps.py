from app.config import get_settings
from app.services.anthropic_client import AnthropicClient
from app.services.sam_client import SamClient
from app.services.session_store import SessionStore

_settings = get_settings()
_session_store = SessionStore(ttl_seconds=_settings.session_ttl_seconds)
_anthropic_client = AnthropicClient(
    api_key=_settings.anthropic_api_key,
    model=_settings.anthropic_model,
)
_sam_client: SamClient | None = None


def get_session_store() -> SessionStore:
    return _session_store


def get_anthropic_client() -> AnthropicClient:
    return _anthropic_client


def get_sam_client() -> SamClient:
    global _sam_client
    if _sam_client is None:
        _sam_client = SamClient(_settings)
    return _sam_client
