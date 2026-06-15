from __future__ import annotations

import io
import uuid

import numpy as np
from PIL import Image
from pydantic import BaseModel, Field

from app.api import deps
from app.schemas.widget import MaskRecord
from app.state.document import SessionDocument
from app.tools.atomic.select_by_point import _SamFailed, _encode_mask_png_b64
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    w: float = Field(gt=0.0, le=1.0)
    h: float = Field(gt=0.0, le=1.0)
    commit: bool = True


class _Output(BaseModel):
    ok: bool
    mask_id: str


class SelectByBoxTool(BackendTool[_Input, _Output]):
    name = "select_by_box"
    kind = "mutate"
    description = "Box-style selection: SAM decodes a mask inside the bbox (normalised)."
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        img = Image.open(io.BytesIO(doc.get_image_bytes("in-default"))).convert("RGB")
        arr = np.array(img)
        h_img, w_img = arr.shape[:2]
        sam = deps.get_sam_client()
        sam.embed(doc.session_id, arr)
        x1 = input.x * w_img
        y1 = input.y * h_img
        x2 = (input.x + input.w) * w_img
        y2 = (input.y + input.h) * h_img
        try:
            mask = sam.decode_box(doc.session_id, np.array([x1, y1, x2, y2], dtype=np.float32))
        except RuntimeError as e:
            raise _SamFailed(str(e))
        if mask is None or not mask.any():
            raise _SamFailed("empty mask")
        png_b64 = _encode_mask_png_b64(mask)
        mid = f"m_{uuid.uuid4().hex[:8]}"
        record = MaskRecord(
            id=mid, width=mask.shape[1], height=mask.shape[0],
            png_b64=png_b64, source="sam_box",
        )
        doc.add_mask(record)
        if input.commit:
            doc.active_mask_id = None
            doc.committed_mask_id = mid
            state = "committed"
        else:
            doc.active_mask_id = mid
            state = "active"
        doc.emit_selection_changed(mid, state, None)
        return _Output(ok=True, mask_id=mid)
