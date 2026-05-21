import pytest

from app.schemas.enriched_context import EnrichedImageContext
from app.schemas.widget import Scope
from app.tools.fused.cool_grade import CoolGradeTemplate
from app.tools.fused_framework import run_fused_tool


class _FakeAnthropic:
    def resolve_fused_tool(self, template_id, prompt_payload, response_schema, session_id=None):
        return {
            "values": {"temperature": -600, "highlight_warmth": -10, "saturation_lift": -3},
            "reasoning": "image is warm, cooling it down",
        }


def _ctx() -> EnrichedImageContext:
    return EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z",
    )


@pytest.mark.asyncio
async def test_cool_grade_skeleton_is_stable() -> None:
    widget = await run_fused_tool(
        CoolGradeTemplate(), intent="cool image",
        scope=Scope.model_validate({"kind": "global"}),
        ctx=_ctx(), prior=None, instruction=None,
        anthropic=_FakeAnthropic(),
    )
    assert [n.type for n in widget.nodes] == ["kelvin", "basic"]
    assert {b.param_key for b in widget.bindings} >= {"temperature", "highlight_warmth", "saturation_lift"}


@pytest.mark.asyncio
async def test_cool_grade_numbers_inside_envelope() -> None:
    widget = await run_fused_tool(
        CoolGradeTemplate(), intent="cool",
        scope=Scope.model_validate({"kind": "global"}),
        ctx=_ctx(), prior=None, instruction=None,
        anthropic=_FakeAnthropic(),
    )
    temp_binding = next(b for b in widget.bindings if b.param_key == "temperature")
    assert -1200 <= temp_binding.value <= 1200
