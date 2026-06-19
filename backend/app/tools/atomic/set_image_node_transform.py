"""set_image_node_transform — upsert (or clear) crop and rotate transforms for
an image node. REST-only — invoked by the frontend image-node header dropdown
and the CropOverlay modal. Sending both crop and rotate as None clears the
entry; sending only a delta replaces the prior value for that key."""
from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas._camel import camel_config
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _CropRect(BaseModel):
    model_config = camel_config(extra="forbid")
    x: int
    y: int
    w: int = Field(gt=0)
    h: int = Field(gt=0)


class _RotateState(BaseModel):
    model_config = camel_config(extra="forbid")
    angle: float
    flip_h: bool = False
    flip_v: bool = False


class _Input(BaseModel):
    model_config = camel_config(extra="forbid")
    image_node_id: str = Field(min_length=1)
    layer_ids: list[str] = Field(min_length=1)
    crop: _CropRect | None = None
    rotate: _RotateState | None = None


class _Output(BaseModel):
    ok: bool


class SetImageNodeTransformTool(BackendTool[_Input, _Output]):
    name = "set_image_node_transform"
    kind = "mutate"
    description = (
        "Upsert non-destructive crop / rotate for an image node. "
        "Sending both crop=None and rotate=None clears the entry. REST-only."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(
        expose_mcp=False, expose_rest=True, requires_image=False,
    )
    is_user_action = True

    def history_label(self, input: _Input, output: _Output) -> str:  # noqa: A002
        parts: list[str] = []
        if input.crop is not None:
            parts.append("Crop")
        if input.rotate is not None:
            parts.append("Rotate")
        if not parts:
            return "Cleared transform"
        return " & ".join(parts)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        doc.set_image_node_transform(
            input.image_node_id,
            input.layer_ids,
            input.crop.model_dump() if input.crop else None,
            input.rotate.model_dump() if input.rotate else None,
        )
        return _Output(ok=True)
