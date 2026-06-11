"""prepare_image MCP tool — mechanical stats + SAM embed.

Splits out the cheap, no-LLM preparatory phase that previously lived inside
analyze_image. This tool is fast (~100–300ms for the cv2 pass, +200–800ms
for the SAM encoder if ANALYZE_SAM=1) and has no LLM dependency. Output is
what every downstream phase needs.
"""

from __future__ import annotations

import asyncio
import os

from pydantic import BaseModel

from app.api import deps
from app.schemas._camel import camel_config
from app.state.context_stats import CheapPassResult
from app.state.document import SessionDocument
from app.tools.atomic._analyze_phases import (
    PrepareResult,
    decode_image,
    run_mechanical,
    run_sam_embed,
)
from app.tools.base import BackendTool, ToolPermissions


def _sam_enabled() -> bool:
    return os.environ.get("ANALYZE_SAM", "0") not in ("0", "", "false", "False")


class _Input(BaseModel):
    model_config = camel_config(extra="forbid")


class _Output(BaseModel):
    model_config = camel_config(extra="forbid")
    sam_ok: bool
    image_width: int
    image_height: int
    cheap: CheapPassResult


class PrepareImageTool(BackendTool[_Input, _Output]):
    name = "prepare_image"
    kind = "mutate"
    description = (
        "Run the cheap mechanical pass (histograms, palette, cast detection) and "
        "the SAM image-encoder embed in parallel. No LLM. No mutation of "
        "candidate_regions. Idempotent: re-running on the same session re-uses "
        "cached results when present."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True, requires_context=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        # Idempotency: if prepare already ran on this doc, return its result.
        if doc.prepare_result is not None:
            pr = doc.prepare_result
            return _Output(
                sam_ok=pr.sam_ok,
                image_width=pr.image_width,
                image_height=pr.image_height,
                cheap=pr.cheap,
            )

        sam_on = _sam_enabled()
        sam = deps.get_sam_client() if sam_on else None
        arr, w_img, h_img = decode_image(doc.image_bytes)

        if sam_on and sam is not None:
            cheap, sam_ok = await asyncio.gather(
                run_mechanical(arr), run_sam_embed(sam, doc.session_id, arr),
            )
        else:
            cheap = await run_mechanical(arr)
            sam_ok = False

        doc.prepare_result = PrepareResult(
            cheap=cheap, sam_ok=sam_ok, image_width=w_img, image_height=h_img,
        )
        return _Output(
            sam_ok=sam_ok, image_width=w_img, image_height=h_img, cheap=cheap,
        )
