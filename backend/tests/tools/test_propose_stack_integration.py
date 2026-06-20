"""End-to-end: 'make it look like a vintage film' must spawn ≥3 widgets."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app.registry.loader import get_registry, reload_registry
from app.tools.widgets.propose_stack import ProposeStackTool, _Input


@pytest.mark.asyncio
async def test_vintage_intent_spawns_multi_widget_stack(make_doc, monkeypatch):
    doc = make_doc(with_image_context=True)
    tool = ProposeStackTool()

    # Fake planner returns 5-op stack.
    fake_plan = {
        "plan": [
            {"op_id": "levels",     "rationale": "lifted blacks"},
            {"op_id": "color",      "rationale": "slight desat"},
            {"op_id": "hsl",        "rationale": "warm shift"},
            {"op_id": "splitTone",  "rationale": "teal/orange"},
            {"op_id": "grain",      "rationale": "fine film grain"},
        ],
        "overall_rationale": "vintage film recipe",
    }

    # Fake resolver returns sensible per-op params (all defaults).
    def fake_resolve(*, op, **_):
        return {k: p.default for k, p in op.params.items()}

    from app.services import anthropic_client as ac

    monkeypatch.setattr(
        ac.AnthropicClient,
        "plan_widget_stack",
        MagicMock(return_value=fake_plan),
    )
    monkeypatch.setattr(
        ac.AnthropicClient,
        "resolve_widget_params",
        MagicMock(side_effect=fake_resolve),
    )
    # Ensure deps.get_anthropic_client returns a real-looking instance.
    monkeypatch.setattr(
        "app.api.deps.get_anthropic_client",
        lambda: ac.AnthropicClient(api_key="test", model="claude-opus-4-7"),
    )

    out = await tool.handler(doc, _Input(
        intent="make it look like a vintage film",
        scope={"kind": "global"},
        origin="mcp_user_prompt",
    ))
    assert len(out.widgets) == 5
    op_ids = {w["opId"] for w in out.widgets}
    assert {"levels", "color", "hsl", "splitTone", "grain"} == op_ids


@pytest.mark.asyncio
async def test_planner_empty_falls_back_to_keyword_preset(make_doc, monkeypatch):
    doc = make_doc(with_image_context=True)
    tool = ProposeStackTool()

    from app.services import anthropic_client as ac

    monkeypatch.setattr(
        ac.AnthropicClient,
        "plan_widget_stack",
        MagicMock(return_value={"plan": []}),
    )
    monkeypatch.setattr(
        ac.AnthropicClient,
        "resolve_widget_params",
        MagicMock(side_effect=lambda *, op, **_: {
            k: p.default for k, p in op.params.items()
        }),
    )
    monkeypatch.setattr(
        "app.api.deps.get_anthropic_client",
        lambda: ac.AnthropicClient(api_key="test", model="claude-opus-4-7"),
    )

    reg = reload_registry()
    assert "vintage" in reg.presets   # presets must be loaded

    out = await tool.handler(doc, _Input(
        intent="make it vintage",
        scope={"kind": "global"},
        origin="mcp_user_prompt",
    ))
    # Fallback used → at least one widget from the vintage preset
    assert len(out.widgets) >= 1


@pytest.mark.asyncio
async def test_vintage_produces_multi_op_widget(make_doc, monkeypatch):
    """The vintage prompt should produce a multi-op widget (color + splitTone)
    plus single-op widgets for the rest."""
    doc = make_doc(with_image_context=True)
    tool = ProposeStackTool()

    fake_plan = {
        "plan": [
            {"widget_name": "Lifted blacks", "category": "tone",
             "ops": [{"op_id": "levels", "rationale": "lift", "starting_params": {}}]},
            {"widget_name": "Warm fade", "category": "color",
             "ops": [
                 {"op_id": "color",     "rationale": "desat", "starting_params": {}},
                 {"op_id": "splitTone", "rationale": "teal/orange", "starting_params": {}},
             ]},
            {"widget_name": "Film grain", "category": "texture",
             "ops": [{"op_id": "grain", "rationale": "fine", "starting_params": {}}]},
        ],
        "overall_rationale": "vintage film",
    }

    def fake_resolve(*, op, **_):
        return {k: p.default for k, p in op.params.items()}

    from app.services import anthropic_client as ac
    monkeypatch.setattr(ac.AnthropicClient, "plan_widget_stack",
                        MagicMock(return_value=fake_plan))
    monkeypatch.setattr(ac.AnthropicClient, "resolve_widget_params",
                        MagicMock(side_effect=fake_resolve))
    monkeypatch.setattr("app.api.deps.get_anthropic_client",
                        lambda: ac.AnthropicClient(api_key="test", model="claude-opus-4-7"))

    out = await tool.handler(doc, _Input(
        intent="make it look like a vintage film",
        scope={"kind": "global"},
        origin="mcp_user_prompt",
    ))
    # 3 widgets
    assert len(out.widgets) == 3
    # Each has a display_name
    names = [w["displayName"] for w in out.widgets]
    assert "Lifted blacks" in names
    assert "Warm fade" in names
    assert "Film grain" in names
    # The "Warm fade" widget has 2 nodes (color + splitTone)
    warm_fade = next(w for w in out.widgets if w["displayName"] == "Warm fade")
    assert len(warm_fade["nodes"]) == 2
    node_types = {n["type"] for n in warm_fade["nodes"]}
    assert node_types == {"basic", "splitTone"}    # color → basic, splitTone → splitTone
    # Categories propagate
    assert warm_fade["category"] == "color"


@pytest.mark.asyncio
async def test_old_shape_plan_response_back_compat(make_doc, monkeypatch):
    """A planner returning the OLD flat shape still produces single-op widgets."""
    doc = make_doc(with_image_context=True)
    tool = ProposeStackTool()

    fake_plan = {
        "plan": [
            {"op_id": "levels", "rationale": "lift"},
            {"op_id": "grain",  "rationale": "fine"},
        ],
        "overall_rationale": "back-compat shape",
    }

    def fake_resolve(*, op, **_):
        return {k: p.default for k, p in op.params.items()}

    from app.services import anthropic_client as ac
    monkeypatch.setattr(ac.AnthropicClient, "plan_widget_stack",
                        MagicMock(return_value=fake_plan))
    monkeypatch.setattr(ac.AnthropicClient, "resolve_widget_params",
                        MagicMock(side_effect=fake_resolve))
    monkeypatch.setattr("app.api.deps.get_anthropic_client",
                        lambda: ac.AnthropicClient(api_key="test", model="claude-opus-4-7"))

    out = await tool.handler(doc, _Input(
        intent="t", scope={"kind": "global"}, origin="mcp_user_prompt",
    ))
    assert len(out.widgets) == 2
    # display_name is None when planner doesn't provide one
    assert all(w["displayName"] is None for w in out.widgets)
    assert all(len(w["nodes"]) == 1 for w in out.widgets)


# ---------------------------------------------------------------------------
# Cost regression — propose_stack strips heavy image_context fields
# ---------------------------------------------------------------------------
# Locks the cleanup that took ~7 parallel resolver calls × 32 k tokens of
# binary mask data + 256-bin histograms down to ~4 k useful tokens each.
# If a future code change reintroduces those fields into the LLM call,
# the next session of editing a single image costs ~$0.85 instead of
# ~$0.10 and nobody notices until the bill arrives. Fail loudly here.


@pytest.mark.asyncio
async def test_propose_stack_strips_heavy_fields_before_llm(make_doc, monkeypatch):
    """End-to-end: a doc with an enriched image_context (mask_png_base64,
    histograms, region_stats) must reach the planner + resolvers WITHOUT
    those fields. We capture the kwargs the Anthropic client was called
    with and assert key absences."""
    from app.schemas.enriched_context import EnrichedImageContext
    from app.schemas.image_context import CandidateRegion
    from app.state.document import DEFAULT_IMAGE_NODE_ID
    from app.services import anthropic_client as ac

    doc = make_doc()
    # Build a realistic enriched context with all the heavy fields populated.
    fat_ctx = EnrichedImageContext(
        subjects=["royal gramma fish"],
        lighting="side",
        dominant_tones=["shadows"],
        mood="serene",
        candidate_regions=[
            CandidateRegion(
                label="fish",
                description="centre frame",
                bbox=[0.1, 0.1, 0.5, 0.5],
                representative_point=[0.3, 0.3],
                paths=[[[0.1, 0.2], [0.3, 0.4]] * 80],            # ~160 floats
                mask_png_base64="iVBORw0KGgo" + ("A" * 12000),      # ~12 k chars
            ),
        ],
        model_name="claude",
        model_version="2026-01",
        generated_at="2026-01-01T00:00:00Z",
        luma_histogram=list(range(256)),
        rgb_histograms={"r": [0] * 256, "g": [0] * 256, "b": [0] * 256},
        grade_character="cool-cinematic",
    )
    doc.set_image_context(DEFAULT_IMAGE_NODE_ID, fat_ctx)

    # Capture every call into plan + resolve.
    plan_kwargs: dict = {}
    resolve_kwargs_list: list[dict] = []

    def capture_plan(**kwargs):
        plan_kwargs.update(kwargs)
        return {
            "plan": [
                {"op_id": "clarity", "rationale": "soften haze"},
                {"op_id": "blur",    "rationale": "dreamy"},
            ],
            "overall_rationale": "dreamy underwater",
        }

    def capture_resolve(*, op, **kwargs):
        resolve_kwargs_list.append({"op_id": op.id, **kwargs})
        return {k: p.default for k, p in op.params.items()}

    monkeypatch.setattr(ac.AnthropicClient, "plan_widget_stack",
                        MagicMock(side_effect=capture_plan))
    monkeypatch.setattr(ac.AnthropicClient, "resolve_widget_params",
                        MagicMock(side_effect=capture_resolve))
    monkeypatch.setattr("app.api.deps.get_anthropic_client",
                        lambda: ac.AnthropicClient(api_key="test", model="claude-opus-4-7"))

    out = await ProposeStackTool().handler(doc, _Input(
        intent="make it a dreamy underwater world",
        scope={"kind": "global"},
        origin="mcp_user_prompt",
    ))
    assert len(out.widgets) == 2
    assert len(resolve_kwargs_list) == 2

    # ── plan call ──────────────────────────────────────────────────────
    plan_ctx = plan_kwargs["image_context"]
    assert "lumaHistogram" not in plan_ctx and "luma_histogram" not in plan_ctx
    assert "rgbHistograms" not in plan_ctx and "rgb_histograms" not in plan_ctx
    assert "regionStats" not in plan_ctx and "region_stats" not in plan_ctx
    regions = plan_ctx.get("candidateRegions") or plan_ctx.get("candidate_regions") or []
    for r in regions:
        assert "maskPngBase64" not in r and "mask_png_base64" not in r, (
            "plan_widget_stack received a region with mask_png_base64. "
            "That is ~10 KB of base64 the LLM cannot read. Re-add the "
            "image_context_for_llm() call in propose_stack."
        )
        assert "paths" not in r

    # ── resolver calls ────────────────────────────────────────────────
    # The fat fixture is ~30 KB; the slim should be ~1 KB. Pin the bound.
    fat_size = len(str(fat_ctx.model_dump(mode="json", by_alias=True)))
    for r_kwargs in resolve_kwargs_list:
        ctx = r_kwargs["image_context"]
        # Heavy keys absent — same check at every resolver call.
        regions = ctx.get("candidateRegions") or ctx.get("candidate_regions") or []
        for region in regions:
            assert "maskPngBase64" not in region and "mask_png_base64" not in region
            assert "paths" not in region
        assert "lumaHistogram" not in ctx and "luma_histogram" not in ctx
        # And the size collapsed (sanity bound — if this trips, the helper
        # silently regressed even though the named keys are gone).
        assert len(str(ctx)) < fat_size * 0.2, (
            f"Resolver image_context is {len(str(ctx))} chars — close to "
            f"the original {fat_size}. Token cost ~unchanged."
        )

    # ── narrative survives ───────────────────────────────────────────
    # We dropped histograms but kept the actionable summary fields.
    assert plan_ctx.get("subjects") == ["royal gramma fish"]
    assert plan_ctx.get("gradeCharacter") == "cool-cinematic" \
        or plan_ctx.get("grade_character") == "cool-cinematic"
    region0 = (plan_ctx.get("candidateRegions") or plan_ctx.get("candidate_regions"))[0]
    assert region0["label"] == "fish"
    assert region0["bbox"] == [0.1, 0.1, 0.5, 0.5]
