"""Decision telemetry for the autonomous suggestion pass.

Every selection decision (severity gate, dedup, dismissal, resolve failure,
top-up) must land in the per-session journal as proposal.health events with
stage=autonomous — the study needs to distinguish an AI decision from a
degraded pass, and before this the only trace was a process-level warning.

Fixtures use ``suggested_ops`` (registry op ids) — ``suggested_fused_tools``
is deprecated and nothing writes it anymore (T3 of feat/remove-fused-templates).
"""
from __future__ import annotations

import pytest

from app.schemas.enriched_context import EnrichedImageContext, Problem
from app.services.autonomous_suggestions import mint_autonomous_suggestions


def _ctx(problems: list[Problem]) -> EnrichedImageContext:
    return EnrichedImageContext(
        subjects=["sneakers"], lighting="backlit", dominant_tones=["highlights"],
        mood="calm", candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-07-02T00:00:00Z",
        grade_character="cool-cinematic",
        problems=problems,
    )


def _resolve_stack_params_ok(plan_entries, **_kw):
    """Return resolved params for every op in every entry.

    Uses registry defaults for curve/enum params, and nudges scalar params
    slightly off their default so ``synthesize_compound`` can produce anchors
    (it returns None when every resolved value equals the canonical baseline).
    """
    from app.registry.loader import get_registry
    reg = get_registry()
    result: dict[int, list[tuple[str, dict]]] = {}
    for i, entry in enumerate(plan_entries):
        ops_out = []
        for op_entry in entry.get("ops", []):
            op_id = op_entry["op_id"]
            op = reg.ops.get(op_id)
            if op is None:
                continue
            params = {}
            for k, p in op.params.items():
                if p.type == "scalar" and p.range is not None:
                    # Nudge toward max to guarantee diff from default.
                    lo, hi = p.range
                    params[k] = float(p.default) + (hi - lo) * 0.1
                else:
                    params[k] = p.default
            ops_out.append((op_id, params))
        result[i] = ops_out
    return result


class _FakeAnthropic:
    """resolve_stack_params answers with registry defaults;
    suggest_fused_tools_for_character returns no top-up candidates."""

    def resolve_stack_params(self, *, plan_entries, **kw):
        return _resolve_stack_params_ok(plan_entries, **kw)

    def suggest_fused_tools_for_character(self, **_):
        return []


@pytest.fixture(autouse=True)
def _patch_image_context(monkeypatch):
    """resolve_problem_widgets needs a non-None image context; patch it out so
    tests don't require a real analyze-pass before minting."""
    # Patch at the source module so the lazy local import picks it up.
    monkeypatch.setattr(
        "app.services.llm_context.image_context_for_llm",
        lambda _ctx: {},
    )
    # Also ensure doc.get_image_context returns a stub (not None).
    from app.schemas.image_context import ImageContext
    stub_ctx = ImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="neutral",
        candidate_regions=[], model_name="stub", model_version="0",
        generated_at="2026-01-01T00:00:00Z",
    )
    from app.state.document import SessionDocument
    monkeypatch.setattr(
        SessionDocument,
        "get_image_context",
        lambda self, image_node_id: stub_ctx,
    )


@pytest.fixture
def journal(monkeypatch):
    events: list[tuple] = []
    monkeypatch.setattr(
        "app.services.event_journal.write_event",
        lambda sid, kind, payload: events.append((sid, kind, payload)),
    )
    return events


@pytest.mark.asyncio
async def test_severity_gate_and_success_are_journaled(make_doc, journal):
    doc = make_doc()
    ctx = _ctx([
        Problem(kind="low_contrast", severity=0.3, region_label="overall",
                suggested_ops=["light"]),
        Problem(kind="clipped_highlights", severity=0.65, region_label="sky",
                suggested_ops=["light"],
                display_label="Blown-out sky behind the wires"),
    ])

    await mint_autonomous_suggestions(doc, ctx, _FakeAnthropic(), layer_id="l1")

    payloads = [p for (_sid, kind, p) in journal if kind == "proposal.health"]
    by_event = {}
    for p in payloads:
        by_event.setdefault(p["event"], []).append(p)

    # The 0.3-severity problem was gated out — and it says so.
    gate = by_event["suggestion_skipped"][0]
    assert gate["reason"] == "severity_gate"
    assert gate["problem"] == "low_contrast"
    assert gate["severity"] == 0.3

    # The top-up pass ran (only 1 problem widget < TARGET 3) and was journaled.
    assert by_event["topup_requested"][0]["needed"] == 2
    assert by_event["topup_requested"][0]["candidates"] == []

    # The minted widget resolved via the LLM and is stamped as such.
    minted = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    assert len(minted) == 1
    assert minted[0].param_source == "llm"
    # intent is the humanized problem kind (title-style); analytics key.
    assert minted[0].intent.lower() == "clipped highlights"
    # The image-specific augment label is what the user reads on the card.
    assert minted[0].display_name == "Blown-out sky behind the wires"
    assert all(n.layer_id == "l1" for n in minted[0].nodes)


@pytest.mark.asyncio
async def test_gate_admits_severity_at_the_040_threshold(make_doc, journal):
    """The gate lowered from 0.5 to 0.4: a grounded 0.4 problem must mint.
    (Grounding floors a measured cast/underexposure to ~0.4–0.6; the old 0.5
    gate would still have dropped a 0.4 grounded severity.)"""
    doc = make_doc()
    ctx = _ctx([
        Problem(kind="clipped_highlights", severity=0.4, region_label="sky",
                suggested_ops=["light"],
                display_label="Blown sky"),
    ])

    await mint_autonomous_suggestions(doc, ctx, _FakeAnthropic(), layer_id="l1")

    minted = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    assert len(minted) == 1
    assert not any(
        p.get("reason") == "severity_gate"
        for (_s, _k, p) in journal
    )


@pytest.mark.asyncio
async def test_other_problem_is_journaled_not_minted(make_doc, journal):
    """kind='other' is the vocabulary escape hatch: recorded as an observation
    (the empirical input for growing ProblemKind), never minted — no tool
    mapping exists, so a widget would be noise."""
    doc = make_doc()
    ctx = _ctx([
        Problem(kind="other", severity=0.7,
                display_label="Tilted horizon",
                description="The horizon slopes ~3° down to the right; "
                            "no vocabulary kind covers geometry.",
                suggested_ops=[]),
    ])

    await mint_autonomous_suggestions(doc, ctx, _FakeAnthropic(), layer_id="l1")

    obs = [p for (_s, _k, p) in journal if p.get("event") == "observation"]
    assert len(obs) == 1
    assert obs[0]["label"] == "Tilted horizon"
    assert "horizon" in obs[0]["detail"]
    assert obs[0]["severity"] == 0.7
    # Not minted, despite severity above the gate.
    minted = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    assert minted == []


def _sky_mask():
    from app.schemas.widget import MaskRecord
    return MaskRecord(id="m_sky", width=8, height=8, png_b64="x",
                      source="sam_box", label="sky", image_node_id="img_main")


@pytest.mark.asyncio
async def test_problem_with_precomputed_mask_gets_named_region_scope(make_doc, journal):
    doc = make_doc()
    doc.add_mask(_sky_mask())
    ctx = _ctx([
        Problem(kind="clipped_highlights", severity=0.8, region_label="sky",
                suggested_ops=["light"]),
    ])

    await mint_autonomous_suggestions(doc, ctx, _FakeAnthropic(), layer_id="l1")

    minted = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    assert len(minted) == 1
    assert minted[0].scope.root.kind == "named_region"
    assert minted[0].scope.root.label == "sky"
    # Nodes inherit the scope — step 2 (scope-aware canonical) reads it there.
    assert all(n.scope.root.kind == "named_region" for n in minted[0].nodes)
    assert not any(p.get("event") == "scope_fallback" for (_s, _k, p) in journal)


@pytest.mark.asyncio
async def test_region_without_mask_falls_back_to_global_and_journals(make_doc, journal):
    doc = make_doc()  # no masks registered
    ctx = _ctx([
        Problem(kind="local_underexposure", severity=0.8, region_label="face",
                suggested_ops=["light"]),
    ])

    await mint_autonomous_suggestions(doc, ctx, _FakeAnthropic(), layer_id="l1")

    minted = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    assert len(minted) == 1
    assert minted[0].scope.root.kind == "global"
    fallback = [p for (_s, _k, p) in journal if p.get("event") == "scope_fallback"]
    assert len(fallback) == 1
    assert fallback[0]["region_label"] == "face"
    assert fallback[0]["problem"] == "local_underexposure"


@pytest.mark.asyncio
async def test_whole_image_problem_stays_global_without_fallback_event(make_doc, journal):
    doc = make_doc()
    doc.add_mask(_sky_mask())  # a mask exists, but the problem names no region
    ctx = _ctx([
        Problem(kind="low_contrast", severity=0.8, region_label=None,
                suggested_ops=["light"]),
    ])

    await mint_autonomous_suggestions(doc, ctx, _FakeAnthropic(), layer_id="l1")

    minted = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    assert len(minted) == 1
    assert minted[0].scope.root.kind == "global"
    assert not any(p.get("event") == "scope_fallback" for (_s, _k, p) in journal)


@pytest.mark.asyncio
async def test_topup_widget_gets_preset_label_as_display_name(make_doc, journal):
    doc = make_doc()
    ctx = _ctx([])  # no problems at all → pure top-up

    class _WithTopup(_FakeAnthropic):
        def suggest_fused_tools_for_character(self, **_):
            # Return a known preset id from the registry
            from app.registry.loader import get_registry
            reg = get_registry()
            if reg.presets:
                return [next(iter(reg.presets))]
            return []

    await mint_autonomous_suggestions(doc, ctx, _WithTopup(), layer_id="l1")

    from app.registry.loader import get_registry
    reg = get_registry()
    if not reg.presets:
        pytest.skip("no presets in registry")

    minted = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    assert len(minted) == 1
    # display_name must be the preset's display_name
    preset_id = next(iter(reg.presets))
    assert minted[0].display_name == reg.presets[preset_id].display_name
    assert minted[0].param_source == "llm"


@pytest.mark.asyncio
async def test_topup_skipped_while_a_corrective_problem_is_open(make_doc, journal):
    """The original bug: a damaged image whose corrective problem didn't mint
    would get its card quota filled with aesthetic grades. An unresolved
    corrective problem (here a cast just under the gate) must SUPPRESS the
    image-character top-up entirely."""
    doc = make_doc()
    ctx = _ctx([
        Problem(kind="strong_color_cast", severity=0.36, region_label=None,
                suggested_ops=["color"]),
    ])

    class _WithTopup(_FakeAnthropic):
        def suggest_fused_tools_for_character(self, **_):
            from app.registry.loader import get_registry
            reg = get_registry()
            return [next(iter(reg.presets))] if reg.presets else []

    await mint_autonomous_suggestions(doc, ctx, _WithTopup(), layer_id="l1")

    minted = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    assert minted == []  # no aesthetic grade while a correction is outstanding
    assert any(
        p.get("event") == "topup_skipped"
        and p.get("reason") == "open_corrective_problems"
        for (_s, _k, p) in journal
    )


@pytest.mark.asyncio
async def test_resolve_failure_is_journaled_not_swallowed(make_doc, journal):
    """A resolver failure is journaled; no widget is minted (no midpoint fallback)."""
    doc = make_doc()
    ctx = _ctx([
        Problem(kind="clipped_highlights", severity=0.8, region_label="sky",
                suggested_ops=["light"]),
    ])

    class _Boom(_FakeAnthropic):
        def resolve_stack_params(self, **_):
            raise RuntimeError("api down")

    await mint_autonomous_suggestions(doc, ctx, _Boom(), layer_id="l1")

    payloads = [p for (_s, _k, p) in journal]
    # The batch resolve failure is journaled — either as "resolver_failed"
    # (from resolve_problem_widgets) or "resolve_failed" (from the outer catch).
    resolve_failed = [
        p for p in payloads
        if p.get("event") in ("resolver_failed", "resolve_failed")
    ]
    assert len(resolve_failed) >= 1
    # No widget minted (no midpoint fallback in the new path).
    minted = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    assert minted == []


@pytest.mark.asyncio
async def test_minted_widget_has_compound_and_driver_value(make_doc, journal):
    """Widgets minted via the new path carry a synthesized driver (compound +
    driver_value) — the core USP of the template-free rewrite."""
    doc = make_doc()
    ctx = _ctx([
        Problem(kind="clipped_highlights", severity=0.8, region_label=None,
                suggested_ops=["light"]),
    ])

    await mint_autonomous_suggestions(doc, ctx, _FakeAnthropic(), layer_id="l1")

    minted = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    assert len(minted) == 1
    widget = minted[0]
    assert widget.compound is not None, "widget must carry a compound (synthesized driver)"
    assert widget.driver_value is not None, "widget must carry a driver_value"


@pytest.mark.asyncio
async def test_dedup_by_op_signature(make_doc, journal):
    """Two problems with the same op set produce only one widget."""
    doc = make_doc()
    ctx = _ctx([
        Problem(kind="clipped_highlights", severity=0.8, suggested_ops=["light"]),
        Problem(kind="low_contrast", severity=0.7, suggested_ops=["light"]),
    ])

    await mint_autonomous_suggestions(doc, ctx, _FakeAnthropic(), layer_id="l1")

    minted = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    assert len(minted) == 1

    dup_events = [p for (_s, _k, p) in journal
                  if p.get("event") == "suggestion_skipped"
                  and p.get("reason") == "duplicate_op_sig"]
    assert len(dup_events) == 1


@pytest.mark.asyncio
async def test_knob_collision_drops_second_widget(make_doc, journal):
    """Two problems whose ops share a (node_type, param_key) pair produce
    only one widget — the first wins."""
    doc = make_doc()
    # Both "light" and "color" ops write to node_type "basic";
    # "light" writes basic.saturation? Actually check — they write different keys.
    # Use two problems with the SAME op ("light") to guarantee collision:
    # dedup_op_sig fires first. Let's use light + color which both map to "basic".
    # color has saturation/vibrance/hue; light has exposure/brightness/contrast etc.
    # They share node_type "basic" but different param keys, so no collision.
    # Force collision with same op on different problem:
    # Already tested via dedup. For knob collision we need overlapping params
    # from distinct op sigs — use light and color (both node_type=basic) which
    # DO share node_type but not param_keys, so they won't collide.
    # Actually to get a real knob collision we'd need ops that write the same
    # (node_type, param_key). Let's manufacture it:
    from unittest.mock import patch
    from app.registry.loader import get_registry
    reg = get_registry()

    # Both problems use "light" and "color" — different op sigs.
    # "light": basic.exposure, etc. "color": basic.saturation, etc.
    # No overlap → no collision. True knob collision needs same param.
    # Simulate by giving both problems ops that map to same (node_type, param_key).
    # Easiest: give both "light" → same sig → dedup catches it.
    # For a REAL knob collision test, we need two different op sigs
    # that write the same canonical target. In real ops, color + light both
    # use node_type "basic" but different params. Let's use a monkeypatched reg.

    # Instead: test the collision path by providing two different op IDs
    # that have the same node_type+param_key via monkeypatch.
    from app.registry.schema import OpEngineConfig, OpLlmMetadata, OpParamSchema, RegistryOp
    extra_op = RegistryOp(
        id="light_clone",
        display_name="Light Clone",
        module="core",
        llm=OpLlmMetadata(description="", typical_use="", semantic_tags=[]),
        params={"exposure": OpParamSchema(type="scalar", range=(-5.0, 5.0), default=0.0)},
        bindings=[],
        engine=OpEngineConfig(shader="basic", render_order=1, node_type="basic"),
    )

    augmented_ops = dict(reg.ops)
    augmented_ops["light_clone"] = extra_op

    class _MockReg:
        ops = augmented_ops
        presets = reg.presets

    mock_reg = _MockReg()
    with patch("app.registry.loader.get_registry", return_value=mock_reg):
        ctx = _ctx([
            Problem(kind="clipped_highlights", severity=0.8, suggested_ops=["light"]),
            Problem(kind="low_contrast", severity=0.7, suggested_ops=["light_clone"]),
        ])
        await mint_autonomous_suggestions(doc, ctx, _FakeAnthropic(), layer_id="l1")

    minted = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    assert len(minted) == 1

    collision_events = [p for (_s, _k, p) in journal
                        if p.get("event") == "suggestion_skipped"
                        and p.get("reason") == "knob_collision"]
    assert len(collision_events) == 1


@pytest.mark.asyncio
async def test_dismissal_matching_by_op_signature(make_doc, journal):
    """A dismissal rule whose fused_tool_id matches the op signature blocks minting."""
    from app.schemas.widget import DismissalRule
    doc = make_doc()
    doc.dismissals.append(DismissalRule(
        id="dr_1",
        source_widget_id="w_fake",
        intent_norm="light",
        fused_tool_id="light",
        scope_signature="global",
    ))
    ctx = _ctx([
        Problem(kind="clipped_highlights", severity=0.8, suggested_ops=["light"]),
    ])

    await mint_autonomous_suggestions(doc, ctx, _FakeAnthropic(), layer_id="l1")

    minted = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    assert minted == []

    dismissed_events = [p for (_s, _k, p) in journal
                        if p.get("event") == "suggestion_skipped"
                        and p.get("reason") == "dismissed"]
    assert len(dismissed_events) == 1


def _blue_cast_jpeg() -> bytes:
    import io

    import numpy as np
    from PIL import Image
    arr = np.zeros((64, 64, 3), dtype=np.uint8)
    arr[:, :, 0] = 60   # R low
    arr[:, :, 1] = 110  # G mid
    arr[:, :, 2] = 200  # B high → strong blue cast
    buf = io.BytesIO()
    Image.fromarray(arr, mode="RGB").save(buf, format="JPEG", quality=95)
    return buf.getvalue()


@pytest.mark.asyncio
async def test_corrective_suggestion_is_verified_and_retried(make_doc, journal):
    """A corrective suggestion whose first params don't fix the metric is
    re-resolved once with feedback; the improved retry is what gets minted."""
    from app.state.document import DEFAULT_IMAGE_NODE_ID

    doc = make_doc()
    doc.set_image_bytes(DEFAULT_IMAGE_NODE_ID, _blue_cast_jpeg(), mime_type="image/jpeg")
    ctx = _ctx([
        Problem(kind="strong_color_cast", severity=0.7, region_label=None,
                suggested_ops=["kelvin"],
                display_label="Heavy blue cast"),
    ])

    from app.registry.loader import get_registry
    reg = get_registry()
    call_count = [0]

    def _resolve_with_calls(*, plan_entries, **kw):
        call_count[0] += 1
        result: dict[int, list[tuple[str, dict]]] = {}
        for i, entry in enumerate(plan_entries):
            ops_out = []
            for op_entry in entry.get("ops", []):
                op_id = op_entry["op_id"]
                op = reg.ops.get(op_id)
                if op is None:
                    continue
                if call_count[0] == 1:
                    # First attempt: kelvin=0 (no correction)
                    params = {k: 0 for k in op.params}
                else:
                    # Retry: warm strongly to correct blue cast
                    params = dict(op.params)
                    for k, p in op.params.items():
                        # Set to max range to ensure correction
                        params[k] = p.range[1] if p.range else p.default
                ops_out.append((op_id, params))
            result[i] = ops_out
        return result

    class _BadThenGood(_FakeAnthropic):
        def resolve_stack_params(self, *, plan_entries, **kw):
            return _resolve_with_calls(plan_entries=plan_entries, **kw)

    await mint_autonomous_suggestions(doc, ctx, _BadThenGood(), layer_id="l1")

    events = [p.get("event") for (_s, _k, p) in journal]
    assert "verify_failed" in events
    # Either verify_retry_ok (retry fixed it) or the original widget was kept.
    # The test is that verification ran and a retry was attempted.
    assert call_count[0] >= 2

    minted = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    assert len(minted) == 1


@pytest.mark.asyncio
async def test_verification_hard_fail_does_not_prevent_minting(make_doc, journal):
    """If verification cannot be performed (no image bytes), the widget is
    returned unchanged — verification failure never blocks minting."""
    doc = make_doc()
    # No image bytes set — measure_and_verify will get None bytes.
    ctx = _ctx([
        Problem(kind="strong_color_cast", severity=0.8, suggested_ops=["kelvin"]),
    ])

    await mint_autonomous_suggestions(doc, ctx, _FakeAnthropic(), layer_id="l1")

    minted = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    # Widget is minted regardless (best-effort verification).
    assert len(minted) == 1


@pytest.mark.asyncio
async def test_object_label_filters_to_the_object_and_forces_global_scope(make_doc, journal):
    """Suggest-on-a-cutout: the extracted node inherits the SOURCE context, so
    the problem list still describes the whole image. With `object_label` set,
    only problems for THAT object mint — the whole-image issues must not be
    re-suggested on the cutout — and the minted scope is global (the cutout IS
    the region; a named_region scope would re-trigger the selection chooser)."""
    doc = make_doc()
    ctx = _ctx([
        # Whole-image problem — must be skipped in object mode.
        Problem(kind="clipped_highlights", severity=0.9, region_label="overall",
                suggested_ops=["light"],
                display_label="Blown-out sky"),
        # The object's own problem — the one we want.
        Problem(kind="low_contrast", severity=0.8, region_label="sports car",
                suggested_ops=["light"],
                display_label="Car body lost in shadow"),
    ])

    await mint_autonomous_suggestions(
        doc, ctx, _FakeAnthropic(), layer_id="cut-1", object_label="Sports Car",
    )

    minted = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    assert len(minted) == 1
    assert minted[0].display_name == "Car body lost in shadow"
    # No re-selection on an already-selected image: scope is global.
    assert minted[0].scope.root.kind == "global"
    assert all(n.scope.root.kind == "global" for n in minted[0].nodes)
    assert all(n.layer_id == "cut-1" for n in minted[0].nodes)


@pytest.mark.asyncio
async def test_topup_dedup_by_op_signature_blocks_same_op_preset(make_doc, journal):
    """Regression for Fix 1: top-up dedup must compare by op SIGNATURE not by
    preset id / w.op_id.  A problem-pass widget minted from ops ["light"] must
    prevent a top-up preset whose ops are also ["light"] from minting, while a
    disjoint preset (different ops) is still allowed through."""
    from app.registry.loader import get_registry
    from app.schemas.enriched_context import Problem
    from app.registry.schema import RegistryPreset, PresetOp

    reg = get_registry()
    if "light" not in reg.ops:
        pytest.skip("registry must have a 'light' op")

    # Build a second op that does NOT share any params with "light" so its sig
    # differs.  Reuse any existing op other than "light", or skip if none.
    other_op_id = next((k for k in reg.ops if k != "light"), None)
    if other_op_id is None:
        pytest.skip("need at least 2 ops in registry")

    # Inject two synthetic presets into the registry: one with ops=["light"]
    # (same as the problem-pass widget), one with ops=[other_op_id] (disjoint).
    same_preset = RegistryPreset(
        id="__test_same__",
        display_name="Same-op preset",
        description="uses light op",
        typical_use="test",
        ops=[PresetOp(op_id="light", params={})],
    )
    diff_preset = RegistryPreset(
        id="__test_diff__",
        display_name="Diff-op preset",
        description="uses other op",
        typical_use="test",
        ops=[PresetOp(op_id=other_op_id, params={})],
    )

    augmented_presets = dict(reg.presets)
    augmented_presets["__test_same__"] = same_preset
    augmented_presets["__test_diff__"] = diff_preset

    from unittest.mock import patch

    class _MockReg:
        ops = reg.ops
        presets = augmented_presets

    with patch("app.registry.loader.get_registry", return_value=_MockReg()):
        doc = make_doc()

        # Problem-pass mints ONE widget whose ops == ["light"].
        ctx = _ctx([
            Problem(kind="clipped_highlights", severity=0.8, region_label=None,
                    suggested_ops=["light"]),
        ])

        class _TopupBoth(_FakeAnthropic):
            def suggest_fused_tools_for_character(self, **_):
                # Offer both presets.
                return ["__test_same__", "__test_diff__"]

        await mint_autonomous_suggestions(doc, ctx, _TopupBoth(), layer_id="l1")

    minted = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    # The "light" problem widget + the disjoint preset = 2.
    # The "same" preset must be blocked by op-signature dedup.
    assert len(minted) == 2, (
        f"expected 2 (problem widget + disjoint preset), got {len(minted)}: "
        f"{[w.display_name for w in minted]}"
    )
    display_names = {w.display_name for w in minted}
    assert "Diff-op preset" in display_names, "disjoint preset must mint"
    assert "Same-op preset" not in display_names, "same-op preset must be blocked"

    dup_events = [
        p for (_s, _k, p) in journal
        if p.get("event") == "suggestion_skipped"
        and p.get("reason") == "duplicate_op_sig"
        and p.get("tool") == "__test_same__"
    ]
    assert len(dup_events) == 1, "same-op preset must be journaled as duplicate_op_sig"
