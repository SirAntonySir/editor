"""propose_mask MCP tool — commit a client-refined mask into masks_index.

Called by the browser MobileSAM path after the user refines a segmentation
mask on the frontend. Decodes the PNG to extract dimensions, builds a
MaskRecord, registers it in doc.masks, and streams a mask.proposed SSE event
so the frontend snapshot consumer can append it to masksIndex live without a
full re-fetch.

Valid origins: "client_refinement", "client_new", "client_extracted".
"""

from __future__ import annotations

import base64
import io
import uuid

from pydantic import BaseModel, Field

from app.schemas._camel import camel_config
from app.schemas.widget import MaskRecord
from app.state.document import DEFAULT_IMAGE_NODE_ID, SessionDocument
from app.tools.base import BackendTool, ToolPermissions

try:
    from PIL import Image as _PILImage
    _PIL_AVAILABLE = True
except ImportError:  # pragma: no cover
    _PIL_AVAILABLE = False


class _Input(BaseModel):
    model_config = camel_config(extra="forbid")

    image_node_id: str = Field(min_length=1)
    png_base64: str = Field(min_length=1)
    paths: list[list[list[float]]] = Field(default_factory=list)
    label: str | None = None
    origin: str = Field(min_length=1)


class _Output(BaseModel):
    model_config = camel_config(extra="forbid")

    mask_id: str


_ORIGIN_TO_SOURCE: dict[str, str] = {
    "client_refinement": "sam_box",
    "client_new": "sam_point",
    "client_extracted": "sam_point",
}


class ProposeMaskTool(BackendTool[_Input, _Output]):
    name = "propose_mask"
    kind = "mutate"
    description = (
        "Commit a client-refined mask (from browser MobileSAM) into the "
        "session's masks_index. Returns the new maskId so the frontend can "
        "reference it in subsequent tool calls."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True, requires_context=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        # Decode PNG and extract dimensions.
        try:
            raw_bytes = base64.b64decode(input.png_base64)
        except Exception as exc:
            raise ValueError(f"propose_mask: invalid base64 in pngBase64 — {exc}") from exc

        try:
            img = _PILImage.open(io.BytesIO(raw_bytes))
            width, height = img.size
        except Exception as exc:
            raise ValueError(f"propose_mask: could not decode PNG — {exc}") from exc

        mask_id = f"client-{uuid.uuid4()}"
        source = _ORIGIN_TO_SOURCE.get(input.origin, "sam_point")

        # Embed origin into label when no explicit label is given.
        label = input.label or input.origin

        record = MaskRecord(
            id=mask_id,
            width=width,
            height=height,
            png_b64=input.png_base64,
            source=source,  # type: ignore[arg-type]
            label=label,
            image_node_id=DEFAULT_IMAGE_NODE_ID,
        )

        # add_mask already fires `mask.created` SSE which the frontend
        # handler merges into snapshot.masksIndex. No additional emit
        # needed — a previous `mask.proposed` event here was redundant.
        doc.add_mask(record)

        return _Output(mask_id=mask_id)
