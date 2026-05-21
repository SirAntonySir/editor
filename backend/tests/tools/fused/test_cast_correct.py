import pytest

from app.schemas.enriched_context import EnrichedImageContext
from app.schemas.widget import Scope
from app.tools.fused.cast_correct import CastCorrectTemplate
from app.tools.fused_framework import run_fused_tool


class _FakeAnthropic:
    def resolve_fused_tool(self, template_id, prompt_payload, response_schema, session_id=None):
        return {
            "values": {"corrective_kelvin": 350, "sat_correction": -8},
            "reasoning": "warm cast detected, cooling and desaturating",
        }


def _ctx() -> EnrichedImageContext:
    return EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z",
        cast_strength=0.6, cast_direction=(10.0, 5.0), wb_neutral_confidence=0.3,
    )


@pytest.mark.asyncio
async def test_cast_correct_skeleton_is_stable() -> None:
    widget = await run_fused_tool(
        CastCorrectTemplate(), intent="fix colour cast",
        scope=Scope.model_validate({"kind": "global"}),
        ctx=_ctx(), prior=None, instruction=None,
        anthropic=_FakeAnthropic(),
    )
    assert [n.type for n in widget.nodes] == ["kelvin", "basic"]
    assert {b.param_key for b in widget.bindings} >= {"corrective_kelvin", "sat_correction"}


@pytest.mark.asyncio
async def test_cast_correct_numbers_inside_envelope() -> None:
    widget = await run_fused_tool(
        CastCorrectTemplate(), intent="fix colour cast",
        scope=Scope.model_validate({"kind": "global"}),
        ctx=_ctx(), prior=None, instruction=None,
        anthropic=_FakeAnthropic(),
    )
    kelvin_binding = next(b for b in widget.bindings if b.param_key == "corrective_kelvin")
    assert -2000 <= kelvin_binding.value <= 2000
    sat_binding = next(b for b in widget.bindings if b.param_key == "sat_correction")
    assert -30 <= sat_binding.value <= 30
