from app.tools.registry import BackendToolRegistry

from .add_note import AddNoteTool
from .apply_adjustment import ApplyAdjustmentTool
from .clear_selection import ClearSelectionTool
from .create_session import CreateSessionTool
from .combine_masks import CombineMasksTool
from .get_active_selection import GetActiveSelectionTool
from .get_image_context import GetImageContextTool
from .get_widget import GetWidgetTool
from .highlight_region import HighlightRegionTool
from .list_layers import ListLayersTool
from .list_named_regions import ListNamedRegionsTool
from .list_widgets import ListWidgetsTool
from .preview_widget import PreviewWidgetTool
from .select_by_box import SelectByBoxTool
from .select_by_point import SelectByPointTool
from .list_fused_tools import ListFusedToolsTool
from .analyze_context import AnalyzeContextTool
from .prepare_image import PrepareImageTool
from .precompute_regions import PrecomputeRegionsTool
from .select_named_region import SelectNamedRegionTool
from .suggest_widgets import SuggestWidgetsTool
from .delete_mask import DeleteMaskTool
from .propose_mask import ProposeMaskTool
from .rename_mask import RenameMaskTool
from .set_image_node_transform import SetImageNodeTransformTool
from .smart_match_command import SmartMatchCommandTool


def register_all_atomic_tools(registry: BackendToolRegistry) -> None:
    registry.register(GetImageContextTool())
    registry.register(ListWidgetsTool())
    registry.register(GetWidgetTool())
    registry.register(ListNamedRegionsTool())
    registry.register(ListLayersTool())
    registry.register(GetActiveSelectionTool())
    registry.register(SelectNamedRegionTool())
    registry.register(ClearSelectionTool())
    registry.register(SelectByPointTool())
    registry.register(SelectByBoxTool())
    registry.register(CombineMasksTool())
    registry.register(ApplyAdjustmentTool())
    registry.register(HighlightRegionTool())
    registry.register(AddNoteTool())
    registry.register(CreateSessionTool())
    registry.register(PrepareImageTool())
    registry.register(AnalyzeContextTool())
    registry.register(PrecomputeRegionsTool())
    registry.register(SuggestWidgetsTool())
    registry.register(ListFusedToolsTool())
    registry.register(PreviewWidgetTool())
    registry.register(SetImageNodeTransformTool())
    registry.register(ProposeMaskTool())
    registry.register(DeleteMaskTool())
    registry.register(RenameMaskTool())
    registry.register(SmartMatchCommandTool())
