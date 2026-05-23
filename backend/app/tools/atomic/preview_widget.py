from __future__ import annotations

from pydantic import BaseModel, Field

from app.state.document import SessionDocument
from app.state.preview_renderer import render_widget_preview
from app.tools.base import BackendTool, ToolPermissions


class _UnknownWidget(KeyError):
    """Mapped to unknown_widget in the envelope by the registry."""
    pass


class _Input(BaseModel):
    widget_id: str
    max_dim: int = Field(default=256, ge=32, le=1024)


class _Output(BaseModel):
    mime_type: str
    image_b64: str | None = None
    reason: str | None = None


class PreviewWidgetTool(BackendTool[_Input, _Output]):
    name = "preview_widget"
    kind = "query"
    description = (
        "Render a small JPEG preview of the widget applied to the image at its current "
        "binding values. CPU pipeline approximation — limited to kelvin / basic / curves / levels."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        widget = doc.widgets.get(input.widget_id)
        if widget is None:
            raise _UnknownWidget(input.widget_id)
        b64 = render_widget_preview(doc.image_bytes, doc.mime_type, widget, max_dim=input.max_dim)
        if b64 is None:
            return _Output(mime_type="image/jpeg", image_b64=None, reason="unsupported_node_type")
        return _Output(mime_type="image/jpeg", image_b64=b64)
