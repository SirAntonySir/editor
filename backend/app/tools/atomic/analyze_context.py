"""analyze_context MCP tool — Claude analyze + soft fields + region_stats.

Returns the EnrichedImageContext WITHOUT mask precompute or autonomous
suggestions. This is the user-visible result: the SSE-emitted context
behind 'Objects · N', the InfoTab semantic chips, the regions list.
Splitting it out from analyze_image means precompute_regions and
suggest_widgets can run after this returns, off the user's critical path.
"""

from __future__ import annotations

import asyncio
import time

from pydantic import BaseModel

from app.api import deps
from app.schemas._camel import camel_config
from app.schemas.enriched_context import EnrichedImageContext
from app.state.document import DEFAULT_IMAGE_NODE_ID, SessionDocument
from app.tools.atomic._analyze_phases import (
    PrepareResult,
    build_enriched,
    compute_region_stats,
    decode_image,
)
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    model_config = camel_config(extra="forbid")
    layer_id: str = "legacy"


class _Output(EnrichedImageContext):
    """The EnrichedImageContext envelope. camelCase on the wire via the
    schema's alias generator from Phase 1."""


class AnalyzeContextTool(BackendTool[_Input, _Output]):
    name = "analyze_context"
    kind = "mutate"
    description = (
        "Claude analyze + soft fields + region stats. Returns the "
        "EnrichedImageContext. Does NOT pre-decode SAM masks or mint widget "
        "suggestions — those are separate tools so they don't block the "
        "user-visible analyze."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True, requires_context=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        # Cached short-circuit: re-running on a doc that already has enriched
        # context returns it without re-billing Claude.
        cached_ctx = doc.get_image_context(DEFAULT_IMAGE_NODE_ID)
        if isinstance(cached_ctx, EnrichedImageContext):
            return _Output.model_validate(cached_ctx.model_dump())

        # Prepare-step results are required (mechanical stats). Lazily run
        # prepare so callers can skip the explicit prepare call.
        if doc.get_prepare_result(DEFAULT_IMAGE_NODE_ID) is None:
            from app.tools.atomic.prepare_image import PrepareImageTool
            from app.tools.atomic.prepare_image import _Input as _PI

            await PrepareImageTool().handler(doc, _PI())
        pr: PrepareResult = doc.get_prepare_result(DEFAULT_IMAGE_NODE_ID)
        assert pr is not None

        client = deps.get_anthropic_client()
        loop = asyncio.get_running_loop()

        # Decode image once for region_stats. The encoder embedding was done
        # in prepare; here we only need numeric stats off the source pixels.
        arr, _, _ = decode_image(doc.get_image_bytes(DEFAULT_IMAGE_NODE_ID))

        # Claude analyze (LLM).
        doc._emit_phase_started("ai_context", index=3, total=4)
        start = time.monotonic()
        base_ctx = await loop.run_in_executor(
            None,
            lambda: client.analyze_image(
                image_bytes=doc.get_image_bytes(DEFAULT_IMAGE_NODE_ID),
                mime_type=doc.get_mime_type(DEFAULT_IMAGE_NODE_ID),
                session_id=doc.session_id,
            ),
        )
        doc._emit_phase_completed(
            "ai_context", duration_ms=int((time.monotonic() - start) * 1000),
        )
        # Stream partial — InfoTab semantic chips flip immediately.
        doc._emit(
            "context.updated",
            {"imageContext": base_ctx.model_dump(mode="json", by_alias=True)},
        )

        # Soft fields (LLM, slower) + region_stats (cv2) — region_stats
        # depends on the base context regions.
        soft = await loop.run_in_executor(
            None,
            lambda: client.augment_context_soft_fields(
                image_bytes=doc.get_image_bytes(DEFAULT_IMAGE_NODE_ID),
                mime_type=doc.get_mime_type(DEFAULT_IMAGE_NODE_ID),
                base_context_json=base_ctx.model_dump(mode="json", by_alias=True),
                cheap_pass_summary={
                    "median_luma": pr.cheap.median_luma,
                    "clipped_shadows_pct": pr.cheap.clipped_shadows_pct,
                    "clipped_highlights_pct": pr.cheap.clipped_highlights_pct,
                    "contrast_p10_p90": pr.cheap.contrast_p10_p90,
                    "cast_strength": pr.cheap.cast_strength,
                    "cast_direction": list(pr.cheap.cast_direction),
                },
                session_id=doc.session_id,
            ),
        )
        region_stats = await loop.run_in_executor(
            None, compute_region_stats, arr, base_ctx, soft.region_soft_fields,
        )

        enriched = build_enriched(base_ctx, pr.cheap, soft, region_stats)
        doc.image_context = enriched
        doc.set_image_context(DEFAULT_IMAGE_NODE_ID, enriched)
        deps.get_session_store().set_context(
            doc.session_id, enriched.model_dump(mode="json", by_alias=True),
        )
        # Final SSE delta for the InfoTab — soft fields + region stats.
        doc._emit(
            "context.updated",
            {"imageContext": {
                "estimatedWhitePoint": list(soft.estimated_white_point),
                "wbNeutralConfidence": soft.wb_neutral_confidence,
                "gradeCharacter": soft.grade_character,
                "problems": [p.model_dump(mode="json", by_alias=True) for p in soft.problems],
                "regionStats": [r.model_dump(mode="json", by_alias=True) for r in region_stats],
            }},
        )
        doc._emit("context.updated", {"available": True})
        return _Output.model_validate(enriched.model_dump())
