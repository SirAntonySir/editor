from app.tools.registry import BackendToolRegistry

from .accept_widget import AcceptWidgetTool
from .delete_widget import DeleteWidgetTool
from .propose_widget import ProposeWidgetTool
from .refine_widget import RefineWidgetTool
from .repeat_widget import RepeatWidgetTool
from .restore_widget import RestoreWidgetTool
from .set_param import SetParamTool
from .set_widget_param import SetWidgetParamTool


def register_all_widget_tools(registry: BackendToolRegistry) -> None:
    registry.register(ProposeWidgetTool())
    registry.register(RefineWidgetTool())
    registry.register(RepeatWidgetTool())
    registry.register(DeleteWidgetTool())
    registry.register(RestoreWidgetTool())
    registry.register(AcceptWidgetTool())
    registry.register(SetWidgetParamTool())
    registry.register(SetParamTool())
