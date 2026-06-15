from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from app.schemas._camel import camel_config

from app.schemas.enriched_context import EnrichedImageContext
from app.schemas.operation_graph import OperationGraph
from app.schemas.widget import Widget
from app.state.document import DEFAULT_IMAGE_NODE_ID, SessionDocument
from app.state.operations import project_to_graph


class SessionStateSnapshot(BaseModel):
    model_config = camel_config(extra="forbid", arbitrary_types_allowed=True)
    session_id: str
    image_context: EnrichedImageContext | None
    widgets: list[Widget]
    masks_index: list[dict]
    operation_graph: OperationGraph
    revision: int


def compute_snapshot(doc: SessionDocument) -> SessionStateSnapshot:
    ctx = doc.get_image_context(DEFAULT_IMAGE_NODE_ID)
    return SessionStateSnapshot(
        session_id=doc.session_id,
        image_context=ctx if isinstance(ctx, EnrichedImageContext) else None,
        widgets=[doc.widgets[wid] for wid in doc.widget_order],
        masks_index=[
            {"id": m.id, "width": m.width, "height": m.height,
             "source": m.source, "label": m.label,
             "imageNodeId": m.image_node_id}
            for m in doc.masks.values()
        ],
        operation_graph=project_to_graph(doc),
        revision=doc.revision,
    )
