from app.tools.registry import BackendToolRegistry

from .propose_widget import ProposeWidgetTool
from .refine_widget import RefineWidgetTool
from .repeat_widget import RepeatWidgetTool


def register_all_widget_tools(registry: BackendToolRegistry) -> None:
    registry.register(ProposeWidgetTool())
    registry.register(RefineWidgetTool())
    registry.register(RepeatWidgetTool())
