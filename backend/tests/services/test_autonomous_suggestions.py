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


class _FakeAnthropic:
    """resolve_fused_tool answers in-envelope for recover_highlights;
    suggest_fused_tools_for_character returns no top-up candidates."""

    def resolve_fused_tool(self, template_id, prompt_payload, response_schema, session_id=None):
        return {"values": {"highlights": -30, "whites": -20}, "reasoning": "pull back sky"}

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
                suggested_fused_tools=["recover_highlights"]),
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
    assert minted[0].intent == "clipped highlights"  # named after the problem
    assert all(n.layer_id == "l1" for n in minted[0].nodes)


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
