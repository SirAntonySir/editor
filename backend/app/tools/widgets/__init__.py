from app.config import get_settings
from app.services.replicate_client import ReplicateClient
from app.tools.registry import BackendToolRegistry

from .accept_widget import AcceptWidgetTool
from .delete_widget import DeleteWidgetTool
from .genfill import GenfillCreateTool, GenfillRegenerateTool
from .propose_stack import ProposeStackTool
from .refine_widget import RefineWidgetTool
from .repeat_widget import RepeatWidgetTool
from .restore_widget import RestoreWidgetTool
from .set_param import SetParamTool
from .set_widget_param import SetWidgetParamTool
from .unlock_widget_param import UnlockWidgetParamTool


def register_all_widget_tools(registry: BackendToolRegistry) -> None:
    registry.register(ProposeStackTool())
    registry.register(RefineWidgetTool())
    registry.register(RepeatWidgetTool())
    registry.register(DeleteWidgetTool())
    registry.register(RestoreWidgetTool())
    registry.register(AcceptWidgetTool())
    registry.register(SetWidgetParamTool())
    registry.register(UnlockWidgetParamTool())
    registry.register(SetParamTool())
    # Genfill tools are constructed WITH deps: they schedule background
    # generation that outlives the handler and must re-acquire the session
    # lock + publish SSE events themselves.
    replicate = ReplicateClient(api_token=get_settings().replicate_api_token)
    registry.register(GenfillCreateTool(
        store=registry.store, bus=registry.bus, replicate=replicate))
    registry.register(GenfillRegenerateTool(
        store=registry.store, bus=registry.bus, replicate=replicate))
