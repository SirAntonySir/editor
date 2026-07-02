"""Decision telemetry for the autonomous suggestion pass.

Every selection decision (severity gate, dedup, dismissal, resolve failure,
top-up) must land in the per-session journal as proposal.health events with
stage=autonomous — the study needs to distinguish an AI decision from a
degraded pass, and before this the only trace was a process-level warning.
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


_IN_ENVELOPE_VALUES = {
    "recover_highlights": {"highlights": -30, "whites": -20},
    "complementary_grade": {"orange_hue": 10, "orange_sat": 15, "blue_hue": -10, "blue_sat": 15},
}


class _FakeAnthropic:
    """resolve_fused_tool answers in-envelope per template;
    suggest_fused_tools_for_character returns no top-up candidates."""

    def resolve_fused_tool(self, template_id, prompt_payload, response_schema, session_id=None):
        return {"values": _IN_ENVELOPE_VALUES[template_id], "reasoning": "grounded"}

    def suggest_fused_tools_for_character(self, **_):
        return []


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
                suggested_fused_tools=["contrast_punch"]),
        Problem(kind="clipped_highlights", severity=0.65, region_label="sky",
                suggested_fused_tools=["recover_highlights"],
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
    assert minted[0].intent == "clipped highlights"  # canonical analytics key
    # The image-specific augment label is what the user reads on the card.
    assert minted[0].display_name == "Blown-out sky behind the wires"
    assert all(n.layer_id == "l1" for n in minted[0].nodes)


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
                suggested_fused_tools=[]),
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
                suggested_fused_tools=["recover_highlights"]),
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
                suggested_fused_tools=["recover_highlights"]),
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
                suggested_fused_tools=["recover_highlights"]),
    ])

    await mint_autonomous_suggestions(doc, ctx, _FakeAnthropic(), layer_id="l1")

    minted = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    assert len(minted) == 1
    assert minted[0].scope.root.kind == "global"
    assert not any(p.get("event") == "scope_fallback" for (_s, _k, p) in journal)


@pytest.mark.asyncio
async def test_topup_widget_gets_template_label_as_display_name(make_doc, journal):
    doc = make_doc()
    ctx = _ctx([])  # no problems at all → pure top-up

    class _WithTopup(_FakeAnthropic):
        def suggest_fused_tools_for_character(self, **_):
            return ["complementary_grade"]

    await mint_autonomous_suggestions(doc, ctx, _WithTopup(), layer_id="l1")

    minted = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    assert len(minted) == 1
    assert minted[0].display_name == "Complementary grade"
    assert minted[0].param_source == "llm"


@pytest.mark.asyncio
async def test_resolve_failure_is_journaled_not_swallowed(make_doc, journal):
    doc = make_doc()
    ctx = _ctx([
        Problem(kind="clipped_highlights", severity=0.8, region_label="sky",
                suggested_fused_tools=["recover_highlights"]),
    ])

    class _Boom(_FakeAnthropic):
        def resolve_fused_tool(self, *a, **k):
            raise RuntimeError("api down")

    await mint_autonomous_suggestions(doc, ctx, _Boom(), layer_id="l1")

    # ResolverError inside run_fused_tool → 3 resolver_retry (fused_resolve
    # stage) → midpoint seed. The widget still ships, honestly stamped.
    payloads = [p for (_s, _k, p) in journal]
    stages = {p["stage"] for p in payloads}
    assert "fused_resolve" in stages
    assert any(p["event"] == "midpoint_seeded" for p in payloads)
    minted = [w for w in doc.widgets.values() if w.origin.kind == "mcp_autonomous"]
    assert len(minted) == 1
    assert minted[0].param_source == "midpoint"
