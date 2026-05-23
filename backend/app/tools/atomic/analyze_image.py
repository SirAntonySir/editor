from __future__ import annotations

import io

import numpy as np
from PIL import Image
from pydantic import BaseModel

from app.api import deps
from app.schemas.enriched_context import EnrichedImageContext, RegionStats
from app.state.context_stats import compute_cheap_pass
from app.state.document import SessionDocument
from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    pass


class _Output(EnrichedImageContext):
    pass


class AnalyzeImageTool(BackendTool[_Input, _Output]):
    name = "analyze_image"
    kind = "mutate"
    description = (
        "Run image analysis (cached). Returns the EnrichedImageContext including "
        "cheap-pass statistics and Claude-augmented soft fields."
    )
    input_schema = _Input
    output_schema = _Output
    permissions = ToolPermissions(requires_image=True, requires_context=False)

    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        if isinstance(doc.image_context, EnrichedImageContext):
            return _Output.model_validate(doc.image_context.model_dump(mode="json"))

        client = deps.get_anthropic_client()
        # 1. Base analysis (existing AnthropicClient call).
        base_ctx = client.analyze_image(
            image_bytes=doc.image_bytes,
            mime_type=doc.mime_type,
            session_id=doc.session_id,
        )

        # 2. Cheap-pass stats.
        img = Image.open(io.BytesIO(doc.image_bytes)).convert("RGB")
        arr = np.array(img)
        cheap = compute_cheap_pass(arr)

        # 3. Claude-augmented soft fields.
        soft = client.augment_context_soft_fields(
            image_bytes=doc.image_bytes,
            mime_type=doc.mime_type,
            base_context_json=base_ctx.model_dump(mode="json"),
            cheap_pass_summary={
                "median_luma": cheap.median_luma,
                "clipped_shadows_pct": cheap.clipped_shadows_pct,
                "clipped_highlights_pct": cheap.clipped_highlights_pct,
                "contrast_p10_p90": cheap.contrast_p10_p90,
                "cast_strength": cheap.cast_strength,
                "cast_direction": list(cheap.cast_direction),
            },
            session_id=doc.session_id,
        )

        # 4. Per-region stats (deterministic).
        region_stats = _compute_region_stats(arr, base_ctx, soft.region_soft_fields)

        ctx = EnrichedImageContext(
            **base_ctx.model_dump(),
            luma_histogram=cheap.luma_histogram,
            rgb_histograms=cheap.rgb_histograms,
            clipped_shadows_pct=cheap.clipped_shadows_pct,
            clipped_highlights_pct=cheap.clipped_highlights_pct,
            median_luma=cheap.median_luma,
            contrast_p10_p90=cheap.contrast_p10_p90,
            color_palette=cheap.color_palette,
            cast_strength=cheap.cast_strength,
            cast_direction=cheap.cast_direction,
            region_stats=region_stats,
            estimated_white_point=soft.estimated_white_point,
            wb_neutral_confidence=soft.wb_neutral_confidence,
            grade_character=soft.grade_character,
            problems=soft.problems,
        )
        doc.image_context = ctx
        # Keep the legacy SessionRecord.context in sync (preserved from Plan 1 cleanup).
        deps.get_session_store().set_context(doc.session_id, ctx.model_dump(mode="json"))
        # Emit context.updated for SSE subscribers (preserved from Plan 1 cleanup).
        doc._emit("context.updated", {"available": True})  # type: ignore[attr-defined]
        await _mint_autonomous_suggestions(doc, ctx, client)
        return _Output.model_validate(ctx.model_dump(mode="json"))


async def _mint_autonomous_suggestions(doc, ctx, anthropic) -> None:
    """For each high-severity Problem, run the suggested fused tool with
    origin.kind='mcp_autonomous'. Suggestions whose (fused_tool_id, scope)
    matches an existing dismissal rule are skipped."""
    from app.schemas.widget import Scope, WidgetOrigin
    from app.tools.fused import all_fused_templates
    from app.tools.fused_framework import run_fused_tool

    templates = {t.id: t for t in all_fused_templates()}

    def _scope_for(problem) -> Scope:
        if problem.region_label:
            return Scope.model_validate({"kind": "named_region", "label": problem.region_label})
        return Scope.model_validate({"kind": "global"})

    def _dismissed(fused_id: str, scope: Scope) -> bool:
        root = scope.root
        if root.kind == "global":
            sig = "global"
        elif root.kind == "named_region":
            sig = f"named_region:{root.label}"
        else:
            sig = f"mask:{root.mask_id}"
        for rule in doc.dismissals:
            if rule.fused_tool_id == fused_id and rule.scope_signature == sig:
                return True
        return False

    for problem in ctx.problems:
        if problem.severity < 0.5:
            continue
        for fused_id in problem.suggested_fused_tools:
            if fused_id not in templates:
                continue
            scope = _scope_for(problem)
            if _dismissed(fused_id, scope):
                continue
            origin = WidgetOrigin(kind="mcp_autonomous", prompt=None)
            try:
                widget = await run_fused_tool(
                    templates[fused_id], intent=problem.kind.replace("_", " "),
                    scope=scope, ctx=ctx, prior=None, instruction=None,
                    anthropic=anthropic, origin=origin,
                )
            except Exception:
                continue
            doc.add_widget(widget)
            break  # one per problem

    # >=2 guarantee - top up via image-character match if the problem-driven
    # pass produced fewer than 2 autonomous widgets.
    MIN_AUTONOMOUS_SUGGESTIONS = 2

    def _count_autonomous_active() -> int:
        return sum(
            1 for w in doc.widgets.values()
            if w.origin.kind == "mcp_autonomous" and w.status == "active"
        )

    if _count_autonomous_active() >= MIN_AUTONOMOUS_SUGGESTIONS:
        return

    already_used = {
        w.fused_tool_id for w in doc.widgets.values()
        if w.origin.kind == "mcp_autonomous" and w.fused_tool_id
    }
    dismissed_global = {
        rule.fused_tool_id for rule in doc.dismissals
        if rule.scope_signature == "global"
    }
    needed = MIN_AUTONOMOUS_SUGGESTIONS - _count_autonomous_active()
    exclude = list(already_used | dismissed_global)
    candidates = anthropic.suggest_fused_tools_for_character(
        grade_character=ctx.grade_character,
        lighting=ctx.lighting,
        dominant_tones=ctx.dominant_tones,
        subjects=ctx.subjects,
        exclude=exclude,
        n=needed,
        session_id=doc.session_id,
    )

    global_scope = Scope.model_validate({"kind": "global"})
    for fused_id in candidates:
        if _count_autonomous_active() >= MIN_AUTONOMOUS_SUGGESTIONS:
            break
        if fused_id not in templates or fused_id in already_used:
            continue
        if _dismissed(fused_id, global_scope):
            continue
        origin = WidgetOrigin(kind="mcp_autonomous", prompt=None)
        intent = templates[fused_id].typical_use[:60] if templates[fused_id].typical_use else fused_id
        try:
            widget = await run_fused_tool(
                templates[fused_id], intent=intent, scope=global_scope,
                ctx=ctx, prior=None, instruction=None,
                anthropic=anthropic, origin=origin,
            )
        except Exception:
            continue
        if widget is None:
            continue
        doc.add_widget(widget)
        already_used.add(fused_id)


def _compute_region_stats(
    image_rgb: np.ndarray,
    base_ctx,
    region_soft_fields: list[dict],
) -> list[RegionStats]:
    """For each candidate_region with a bbox, compute per-region stats."""
    import cv2
    soft_by_label = {r.get("label"): r for r in region_soft_fields}
    out: list[RegionStats] = []
    h, w = image_rgb.shape[:2]
    for region in base_ctx.candidate_regions:
        if not region.bbox:
            continue
        x, y, bw, bh = region.bbox
        x0 = max(0, int(x * w)); y0 = max(0, int(y * h))
        x1 = min(w, int((x + bw) * w)); y1 = min(h, int((y + bh) * h))
        if x1 <= x0 or y1 <= y0:
            continue
        crop = image_rgb[y0:y1, x0:x1]
        if crop.size == 0:
            continue
        luma = (
            0.299 * crop[:, :, 0] + 0.587 * crop[:, :, 1] + 0.114 * crop[:, :, 2]
        ).astype(np.uint8)
        hist, _ = np.histogram(luma, bins=32, range=(0, 256))
        p10 = float(np.percentile(luma, 10))
        p90 = float(np.percentile(luma, 90))
        hsv = cv2.cvtColor(crop, cv2.COLOR_RGB2HSV)
        sat_mean = float(hsv[:, :, 1].mean()) / 255.0
        soft = soft_by_label.get(region.label, {})
        out.append(RegionStats(
            label=region.label,
            pixel_count=int((y1 - y0) * (x1 - x0)),
            mean_luma=float(luma.mean()),
            luma_histogram=hist.astype(int).tolist(),
            mean_rgb=(float(crop[:, :, 0].mean()), float(crop[:, :, 1].mean()), float(crop[:, :, 2].mean())),
            dominant_swatches=[],
            is_skin_likely=bool(soft.get("is_skin_likely", False)),
            is_sky_likely=bool(soft.get("is_sky_likely", False)),
            saturation_mean=sat_mean,
            contrast_p10_p90=p90 - p10,
        ))
    return out
