import pytest

from app.schemas.enriched_context import EnrichedImageContext
from app.schemas.widget import Scope
from app.tools.fused.warm_grade import WarmGradeTemplate
from app.tools.fused_framework import run_fused_tool


class _FakeAnthropic:
    def resolve_fused_tool(self, template_id, prompt_payload, response_schema, session_id=None):
        return {
            "values": {"temperature": 600, "highlight_warmth": 12, "saturation_lift": 4},
            "reasoning": "image is cool",
        }


def _ctx() -> EnrichedImageContext:
    return EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z",
        cast_strength=0.4, cast_direction=(-6.0, -8.0), grade_character="cool-cinematic",
    )


@pytest.mark.asyncio
async def test_warm_grade_skeleton_is_stable() -> None:
    template = WarmGradeTemplate()
    widget = await run_fused_tool(
        template, intent="warm subject",
        scope=Scope.model_validate({"kind": "global"}),
        ctx=_ctx(),
        prior=None, instruction=None,
        anthropic=_FakeAnthropic(),
    )
    node_types = [n.type for n in widget.nodes]
    assert node_types == ["kelvin", "basic"]
    binding_keys = [b.param_key for b in widget.bindings]
    assert set(binding_keys) >= {"temperature", "highlight_warmth", "saturation_lift"}


@pytest.mark.asyncio
async def test_warm_grade_numbers_inside_envelope() -> None:
    template = WarmGradeTemplate()
    widget = await run_fused_tool(
        template, intent="warm",
        scope=Scope.model_validate({"kind": "global"}),
        ctx=_ctx(),
        prior=None, instruction=None,
        anthropic=_FakeAnthropic(),
    )
    temp_binding = next(b for b in widget.bindings if b.param_key == "temperature")
    assert -1200 <= temp_binding.value <= 1200
