from __future__ import annotations

import asyncio
import io
import os
import time
import uuid

import numpy as np
from PIL import Image
from pydantic import BaseModel

from app.api import deps
from app.schemas.enriched_context import EnrichedImageContext, RegionStats
from app.schemas.image_context import CandidateRegion
from app.schemas.widget import MaskRecord
from app.state.context_stats import compute_cheap_pass
from app.state.document import SessionDocument
from app.tools.atomic.select_by_point import _encode_mask_png_b64
from app.tools.base import BackendTool, ToolPermissions


# Feature flag: run the SAM segmentation service during analyze (image embed +
# per-region mask precompute). Gated OFF by default — the heavy SAM embed shares
# the asyncio default executor with the Claude ai_context phase and starves it,
# leaving the analyze stepper stuck on "ai_context". The image context (Claude's
# understanding + labelled regions with bbox/representative_point) is produced
# without SAM. Set ANALYZE_SAM=1 to re-enable the on-load SAM service.
def _sam_enabled() -> bool:
    return os.environ.get("ANALYZE_SAM", "0") not in ("0", "", "false", "False")


class _Input(BaseModel):
    # The frontend's layer id for the image being analyzed. Stamped onto every
    # autonomous widget node so the renderer (which filters op_graph nodes by
    # exact layer_id match) actually applies them. Defaults to "legacy" for
    # callers that don't supply one (e.g. MCP / tests).
    layer_id: str = "legacy"


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
        # SAM is gated off by default (see _sam_enabled). When off we never load
        # the SAM client (avoids the heavy model load) nor run the embed.
        sam_on = _sam_enabled()
        sam = deps.get_sam_client() if sam_on else None

        # SAM is gated off, so the stepper shows only the 4 phases that actually
        # run: update, mechanical, ai_context, widget_mint. The sam_embed and
        # mask_precompute (Regions) phases are NOT emitted while SAM is off —
        # re-add them (and bump this count) when segmentation is brought back.
        TOTAL_PHASES = 4

        # Phase 1 — "update": load + decode the source image. Bracketed in its
        # own phase so the stepper shows a first active step while the
        # executor-bound decode runs.
        doc._emit_phase_started("update", index=1, total=TOTAL_PHASES)
        _update_start = time.monotonic()
        # Load image ONCE upfront, in an executor so the event loop stays free.
        # arr is used by mechanical (compute_cheap_pass) and sam_embed (sam.embed).
        arr = await asyncio.get_running_loop().run_in_executor(
            None,
            lambda: np.array(Image.open(io.BytesIO(doc.image_bytes)).convert("RGB")),
        )
        h_img, w_img = arr.shape[:2]
        doc._emit_phase_completed(
            "update", duration_ms=int((time.monotonic() - _update_start) * 1000),
        )

        async def _phase_mechanical():
            doc._emit_phase_started("mechanical", index=2, total=TOTAL_PHASES)
            start = time.monotonic()
            cheap = await asyncio.get_running_loop().run_in_executor(
                None, compute_cheap_pass, arr,
            )
            doc._emit_phase_completed(
                "mechanical", duration_ms=int((time.monotonic() - start) * 1000),
            )
            # Stream the cheap-pass fields as soon as they're ready so the
            # Info-tab Histograms + Color sections can flip from skeleton to
            # real data without waiting for ai_context.
            doc._emit("context.updated", {"image_context": {
                "luma_histogram": list(cheap.luma_histogram),
                "rgb_histograms": cheap.rgb_histograms,
                "clipped_shadows_pct": cheap.clipped_shadows_pct,
                "clipped_highlights_pct": cheap.clipped_highlights_pct,
                "median_luma": cheap.median_luma,
                "contrast_p10_p90": cheap.contrast_p10_p90,
                "color_palette": [s.model_dump(mode="json") for s in cheap.color_palette],
                "cast_strength": cheap.cast_strength,
                "cast_direction": list(cheap.cast_direction),
            }})
            return cheap

        async def _phase_sam_embed() -> bool:
            # No stepper phase while SAM is gated off (see TOTAL_PHASES). When
            # off this is an instant skip that never touches the shared executor,
            # so it can't starve the concurrent ai_context (Claude) phase.
            if not sam_on:
                return False
            try:
                await asyncio.get_running_loop().run_in_executor(
                    None, sam.embed, doc.session_id, arr,
                )
                return True
            except Exception as err:
                doc._emit("context.updated", {"sam_unavailable": True, "reason": str(err)})
                return False

        async def _phase_ai_context():
            doc._emit_phase_started("ai_context", index=3, total=TOTAL_PHASES)
            start = time.monotonic()
            base_ctx = await asyncio.get_running_loop().run_in_executor(
                None,
                lambda: client.analyze_image(
                    image_bytes=doc.image_bytes,
                    mime_type=doc.mime_type,
                    session_id=doc.session_id,
                ),
            )
            doc._emit_phase_completed(
                "ai_context", duration_ms=int((time.monotonic() - start) * 1000),
            )
            # Stream the base context (subjects / lighting / mood / regions)
            # so Semantic + Regions flip immediately. Soft fields and
            # region_stats come later via the soft-fields emission below.
            doc._emit("context.updated", {"image_context": base_ctx.model_dump(mode="json")})
            return base_ctx

        cheap, sam_ok, base_ctx = await asyncio.gather(
            _phase_mechanical(), _phase_sam_embed(), _phase_ai_context(),
        )

        # Soft fields and region stats run sequentially (depend on base_ctx + arr).
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
        deps.get_session_store().set_context(doc.session_id, ctx.model_dump(mode="json"))
        # Stream the soft-fields delta — completes Color (white_point /
        # WB confidence), populates Problems, and finalises region_stats so
        # the Regions section gains its skin/sky hints.
        doc._emit("context.updated", {"image_context": {
            "estimated_white_point": list(soft.estimated_white_point),
            "wb_neutral_confidence": soft.wb_neutral_confidence,
            "grade_character": soft.grade_character,
            "problems": [p.model_dump(mode="json") for p in soft.problems],
            "region_stats": [r.model_dump(mode="json") for r in region_stats],
        }})
        # Terminal "available" ping kept for any consumers that gate on it.
        doc._emit("context.updated", {"available": True})

        # Region mask precompute only runs when SAM is enabled (future re-enable).
        # While SAM is off there is no "Regions" phase at all.
        if sam_ok:
            await _precompute_region_masks(doc, base_ctx.candidate_regions, sam, w_img, h_img)

        doc._emit_phase_started("widget_mint", index=4, total=TOTAL_PHASES)
        start = time.monotonic()
        await _mint_autonomous_suggestions(doc, ctx, client, input.layer_id)
        doc._emit_phase_completed(
            "widget_mint", duration_ms=int((time.monotonic() - start) * 1000),
        )

        return _Output.model_validate(ctx.model_dump(mode="json"))


async def _precompute_region_masks(
    doc: SessionDocument,
    regions: list[CandidateRegion],
    sam,
    w_img: int,
    h_img: int,
) -> None:
    """Decode SAM masks for each Anthropic-named candidate region. Stores
    them in doc.masks (the document-level MaskRecord store) so downstream
    tools can resolve `scope.named_region` -> mask. Soft-fails per region."""
    total = len(regions)
    doc._emit_phase_started("mask_precompute", index=5, total=6)
    start = time.monotonic()
    if total == 0:
        doc._emit_phase_completed(
            "mask_precompute", duration_ms=int((time.monotonic() - start) * 1000),
        )
        return

    done_count = {"n": 0}

    async def _decode_one(region: CandidateRegion) -> None:
        try:
            # Convert normalized [x, y, w, h] -> pixel [x1, y1, x2, y2]
            x, y, w, h = region.bbox
            pixel_bbox = np.array([
                x * w_img, y * h_img,
                (x + w) * w_img, (y + h) * h_img,
            ], dtype=np.float32)
            mask = await asyncio.get_running_loop().run_in_executor(
                None,
                lambda: sam.decode_box(doc.session_id, pixel_bbox),
            )
            mask_id = str(uuid.uuid4())
            png_b64 = _encode_mask_png_b64(mask)
            record = MaskRecord(
                id=mask_id,
                width=int(mask.shape[1]),
                height=int(mask.shape[0]),
                png_b64=png_b64,
                source="sam_box",
                label=region.label,
            )
            doc.add_mask(record)
        except Exception as err:
            print(f"[mask_precompute] failed for region {region.label!r}: {err}")
        finally:
            done_count["n"] += 1
            doc._emit_phase_progress(
                "mask_precompute", done=done_count["n"], total=total,
            )

    await asyncio.gather(*(_decode_one(r) for r in regions))
    doc._emit_phase_completed(
        "mask_precompute", duration_ms=int((time.monotonic() - start) * 1000),
    )


async def _mint_autonomous_suggestions(doc, ctx, anthropic, layer_id: str = "legacy") -> None:
    """For each high-severity Problem, run the suggested fused tool with
    origin.kind='mcp_autonomous'. Suggestions whose (fused_tool_id, scope)
    matches an existing dismissal rule are skipped.

    Every minted widget's nodes are stamped with ``layer_id`` (the frontend's
    real layer id) so the renderer applies them — the fused framework leaves
    nodes on the "legacy" default otherwise."""

    def _stamp(widget) -> None:
        for node in widget.nodes:
            node.layer_id = layer_id
    from app.schemas.widget import Scope, WidgetOrigin
    from app.tools.fused import all_fused_templates
    from app.tools.fused_framework import run_fused_tool

    templates = {t.id: t for t in all_fused_templates()}

    def _canonical_targets(template) -> set[tuple[str, str]]:
        """The `(node_type, param_key)` pairs the template will write to
        canonical. Used to detect KNOB collisions — two suggestions both
        binding `basic.saturation` produce two sliders fighting over the
        same canonical param, last-write-wins. Drop the later one."""
        node_types = {n.node_type for n in template.node_skeleton}
        result: set[tuple[str, str]] = set()
        for b in template.bindings_skeleton:
            node_id = b.target.node_id
            hint = node_id[2:] if node_id.startswith("n_") else node_id
            if hint in node_types:
                result.add((hint, b.target.param_key))
        return result

    def _scope_for(problem) -> Scope:
        # Currently SAM is gated off (see _sam_enabled), so region masks
        # are not precomputed and a `named_region` scope has nothing to
        # apply through — the resulting widget shows on the canvas but
        # produces no pixel change. Force everything to global scope until
        # masks come back; the original region_label still lives in
        # `widget.reasoning` via the augment prompt, so the user can see
        # WHERE the problem was detected even when we can't restrict the
        # adjustment to that area yet.
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

    # Target band: aim for at least TARGET autonomous suggestions, but allow up
    # to MAX from the problem-driven pass if Claude flagged that many issues.
    # Counts hover at exactly TARGET only when the analyze pass yields fewer
    # than TARGET problems and the character-match top-up has to fill the gap;
    # rich images can land 3-5 suggestions naturally.
    TARGET_AUTONOMOUS_SUGGESTIONS = 3
    MAX_AUTONOMOUS_SUGGESTIONS = 5

    def _count_autonomous_active() -> int:
        return sum(
            1 for w in doc.widgets.values()
            if w.origin.kind == "mcp_autonomous" and w.status == "active"
        )

    # Two-layer dedup, tracked across problem-driven + top-up passes:
    #   - `used_fused_ids` — no widget shares its fused_tool_id with another;
    #     prevents two identical templates landing at different scopes.
    #   - `used_targets`   — no two widgets bind to the same canonical
    #     `(node_type, param_key)`. Catches the saturation-triplet case
    #     where cast_correct, warm_grade, subject_pop, etc. all want the
    #     same `basic.saturation` knob — only the first wins; later
    #     candidates fall through to their next suggestion.
    used_fused_ids: set[str] = set()
    used_targets: set[tuple[str, str]] = set()
    for problem in ctx.problems:
        if _count_autonomous_active() >= MAX_AUTONOMOUS_SUGGESTIONS:
            break
        if problem.severity < 0.5:
            continue
        for tool_index, fused_id in enumerate(problem.suggested_fused_tools):
            if fused_id not in templates:
                continue
            if fused_id in used_fused_ids:
                continue
            template = templates[fused_id]
            targets = _canonical_targets(template)
            if targets & used_targets:
                continue
            scope = _scope_for(problem)
            if _dismissed(fused_id, scope):
                continue
            # Intent text: when we use the problem's PRIMARY suggestion the
            # tool was hand-picked to match the problem, so naming the widget
            # after the problem reads naturally ("strong color cast"). When
            # we fall through to a later suggestion the tool no longer
            # matches the problem name (e.g. exposure_balance for an
            # uneven_white_balance fall-through has only light sliders),
            # so we label it after the TOOL instead to keep the title and
            # the controls aligned. The problem context still lives in
            # `widget.reasoning` / the Why popover.
            intent = (
                problem.kind.replace("_", " ") if tool_index == 0 else template.label
            )
            origin = WidgetOrigin(kind="mcp_autonomous", prompt=None)
            try:
                widget = await run_fused_tool(
                    template, intent=intent,
                    scope=scope, ctx=ctx, prior=None, instruction=None,
                    anthropic=anthropic, origin=origin,
                )
            except Exception:
                continue
            _stamp(widget)
            doc.add_widget(widget)
            used_fused_ids.add(fused_id)
            used_targets |= targets
            break  # one per problem

    # Top up via image-character match only when the problem-driven pass
    # produced fewer than TARGET widgets. Once TARGET is met, additional
    # problem-driven suggestions can push the count up to MAX naturally.
    if _count_autonomous_active() >= TARGET_AUTONOMOUS_SUGGESTIONS:
        return

    already_used = {
        w.fused_tool_id for w in doc.widgets.values()
        if w.origin.kind == "mcp_autonomous" and w.fused_tool_id
    }
    dismissed_global = {
        rule.fused_tool_id for rule in doc.dismissals
        if rule.scope_signature == "global"
    }
    needed = TARGET_AUTONOMOUS_SUGGESTIONS - _count_autonomous_active()
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
        if _count_autonomous_active() >= TARGET_AUTONOMOUS_SUGGESTIONS:
            break
        if fused_id not in templates or fused_id in already_used:
            continue
        template = templates[fused_id]
        # Same knob-collision check the problem-driven pass uses — a
        # character-match pick that fights existing widgets for the same
        # canonical params is also a dupe we don't want.
        targets = _canonical_targets(template)
        if targets & used_targets:
            continue
        if _dismissed(fused_id, global_scope):
            continue
        origin = WidgetOrigin(kind="mcp_autonomous", prompt=None)
        intent = template.label
        try:
            widget = await run_fused_tool(
                template, intent=intent, scope=global_scope,
                ctx=ctx, prior=None, instruction=None,
                anthropic=anthropic, origin=origin,
            )
        except Exception:
            continue
        if widget is None:
            continue
        _stamp(widget)
        doc.add_widget(widget)
        already_used.add(fused_id)
        used_targets |= targets


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
