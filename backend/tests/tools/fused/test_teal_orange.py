import pytest

from app.schemas.enriched_context import EnrichedImageContext
from app.schemas.widget import Scope
from app.tools.fused.teal_orange import TealOrangeTemplate
from app.tools.fused_framework import run_fused_tool


class _FakeAnthropic:
    def resolve_fused_tool(self, template_id, prompt_payload, response_schema, session_id=None):
        return {
            "values": {"sat_boost": 12},
            "reasoning": "teal-orange with slight saturation boost",
        }


def _ctx() -> EnrichedImageContext:
    return EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z",
        grade_character="warm-golden",
    )


@pytest.mark.asyncio
async def test_teal_orange_skeleton_is_stable() -> None:
    widget = await run_fused_tool(
        TealOrangeTemplate(), intent="teal orange grade",
        scope=Scope.model_validate({"kind": "global"}),
        ctx=_ctx(), prior=None, instruction=None,
        anthropic=_FakeAnthropic(),
    )
    assert [n.type for n in widget.nodes] == ["curves", "basic"]
    assert {b.param_key for b in widget.bindings} >= {"points", "sat_boost"}


@pytest.mark.asyncio
async def test_teal_orange_sat_boost_inside_envelope() -> None:
    widget = await run_fused_tool(
        TealOrangeTemplate(), intent="teal orange grade",
        scope=Scope.model_validate({"kind": "global"}),
        ctx=_ctx(), prior=None, instruction=None,
        anthropic=_FakeAnthropic(),
    )
    sat_binding = next(b for b in widget.bindings if b.param_key == "sat_boost")
    assert -50 <= sat_binding.value <= 50
