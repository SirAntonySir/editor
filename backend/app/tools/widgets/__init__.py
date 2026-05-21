from app.tools.registry import BackendToolRegistry

from .propose_widget import ProposeWidgetTool


def register_all_widget_tools(registry: BackendToolRegistry) -> None:
    registry.register(ProposeWidgetTool())
