from app.tools.registry import BackendToolRegistry

from .get_image_context import GetImageContextTool
from .get_widget import GetWidgetTool
from .list_widgets import ListWidgetsTool


def register_all_atomic_tools(registry: BackendToolRegistry) -> None:
    registry.register(GetImageContextTool())
    registry.register(ListWidgetsTool())
    registry.register(GetWidgetTool())
