from __future__ import annotations

import base64
import io
import uuid
from typing import Literal

import numpy as np
from PIL import Image
from pydantic import BaseModel

from app.schemas.widget import MaskRecord
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _UnknownMask(KeyError):
    pass


class _Input(BaseModel):
    op: Literal["union", "intersect", "subtract"]
    a: str
    b: str


class _Output(BaseModel):
    mask_id: str


def _decode(b64: str) -> np.ndarray:
    raw = base64.b64decode(b64)
    img = Image.open(io.BytesIO(raw)).convert("L")
    return np.array(img) > 127


def _encode(m: np.ndarray) -> str:
    arr = (m.astype("uint8")) * 255
    img = Image.fromarray(arr, mode="L")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


class CombineMasksTool(BackendTool[_Input, _Output]):
    name = "combine_masks"
    kind = "mutate"
    description = "Compose two masks via union, intersect or subtract."
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        if input.a not in doc.masks:
            raise _UnknownMask(input.a)
        if input.b not in doc.masks:
            raise _UnknownMask(input.b)
        a = _decode(doc.masks[input.a].png_b64)
        b = _decode(doc.masks[input.b].png_b64)
        if a.shape != b.shape:
            raise _UnknownMask("masks differ in shape")
        if input.op == "union":
            m = a | b
        elif input.op == "intersect":
            m = a & b
        else:
            m = a & ~b
        mid = f"m_{uuid.uuid4().hex[:8]}"
        record = MaskRecord(
            id=mid, width=m.shape[1], height=m.shape[0],
            png_b64=_encode(m), source="combined",
            parent_mask_ids=[input.a, input.b],
        )
        doc.add_mask(record)
        return _Output(mask_id=mid)
