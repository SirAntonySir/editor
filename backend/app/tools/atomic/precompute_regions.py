"""precompute_regions MCP tool — SAM box-decode for every candidate_region.

Runs after analyze_context. Pure: returns a list of decoded results, applies
them to the doc's image_context via model_copy. No model mutation in place.

NOTE: After Phase 4 (browser MobileSAM), this tool becomes a no-WebGPU
fallback. We keep it for the cross-browser path.
"""

from __future__ import annotations

import asyncio
import time

from pydantic import BaseModel

from app.api import deps
from app.schemas._camel import camel_config
from app.schemas.enriched_context import EnrichedImageContext
from app.state.document import SessionDocument
from app.tools.atomic._analyze_phases import (
    RegionMaskResult, apply_region_masks, decode_region_mask,
)
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    model_config = camel_config(extra="forbid")


class _Output(BaseModel):
    model_config = camel_config(extra="forbid")
    mask_ids: list[str]


class PrecomputeRegionsTool(BackendTool[_Input, _Output]):
    name = "precompute_regions"
    kind = "mutate"
    description = (
        "Run SAM box-decode for every candidate_region in the current "
        "image_context. Writes mask_png_base64 + paths back onto each "
        "region (via model_copy) and registers MaskRecords in doc.masks."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True, requires_context=True)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        if not isinstance(doc.image_context, EnrichedImageContext):
            return _Output(mask_ids=[])
        if doc.prepare_result is None or not doc.prepare_result.sam_ok:
            return _Output(mask_ids=[])

        sam = deps.get_sam_client()
        regions = doc.image_context.candidate_regions
        w_img = doc.prepare_result.image_width
        h_img = doc.prepare_result.image_height

        doc._emit_phase_started("mask_precompute", index=4, total=4)
        start = time.monotonic()
        results = await asyncio.gather(
            *(
                decode_region_mask(sam, doc.session_id, i, r, w_img, h_img)
                for i, r in enumerate(regions)
            ),
        )
        live: list[RegionMaskResult] = [r for r in results if r is not None]

        for r in live:
            doc.add_mask(r.mask_record)

        # Apply masks onto candidate_regions via model_copy (no mutation).
        new_ctx = apply_region_masks(doc.image_context, live)
        doc.image_context = new_ctx
        deps.get_session_store().set_context(
            doc.session_id, new_ctx.model_dump(mode="json", by_alias=True),
        )
        doc._emit_phase_completed(
            "mask_precompute", duration_ms=int((time.monotonic() - start) * 1000),
        )
        # Stream the updated regions so object-mode picks up paths without refetch.
        doc._emit(
            "context.updated",
            {"image_context": {"candidateRegions": [
                r.model_dump(mode="json", by_alias=True)
                for r in new_ctx.candidate_regions
            ]}},
        )
        return _Output(mask_ids=[r.mask_id for r in live])
