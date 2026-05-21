from app.tools.registry import BackendToolRegistry

from .get_active_selection import GetActiveSelectionTool
from .get_image_context import GetImageContextTool
from .get_widget import GetWidgetTool
from .list_layers import ListLayersTool
from .list_named_regions import ListNamedRegionsTool
from .list_widgets import ListWidgetsTool


def register_all_atomic_tools(registry: BackendToolRegistry) -> None:
    registry.register(GetImageContextTool())
    registry.register(ListWidgetsTool())
    registry.register(GetWidgetTool())
    registry.register(ListNamedRegionsTool())
    registry.register(ListLayersTool())
    registry.register(GetActiveSelectionTool())
