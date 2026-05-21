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


from app.state.events import EventBus
from app.tools.registry import BackendToolRegistry

_event_bus = EventBus()
_registry: BackendToolRegistry | None = None


def get_event_bus() -> EventBus:
    return _event_bus


def get_tool_registry() -> BackendToolRegistry:
    global _registry
    if _registry is None:
        from app.tools.atomic import register_all_atomic_tools
        from app.tools.widgets import register_all_widget_tools
        _registry = BackendToolRegistry(store=_session_store, event_bus=_event_bus)
        register_all_atomic_tools(_registry)
        register_all_widget_tools(_registry)
    return _registry
