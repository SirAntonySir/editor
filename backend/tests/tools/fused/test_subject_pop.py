import pytest

from app.schemas.enriched_context import EnrichedImageContext
from app.schemas.widget import Scope
from app.tools.fused.subject_pop import SubjectPopTemplate
from app.tools.fused_framework import run_fused_tool


class _FakeAnthropic:
    def resolve_fused_tool(self, template_id, prompt_payload, response_schema, session_id=None):
        return {
            "values": {"contrast": 20, "saturation": 10},
            "reasoning": "boost local contrast and saturation to pop subject",
        }


def _ctx() -> EnrichedImageContext:
    return EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z",
    )


@pytest.mark.asyncio
async def test_subject_pop_skeleton_is_stable() -> None:
    widget = await run_fused_tool(
        SubjectPopTemplate(), intent="make subject pop",
        scope=Scope.model_validate({"kind": "named_region", "label": "left person"}),
        ctx=_ctx(), prior=None, instruction=None,
        anthropic=_FakeAnthropic(),
    )
    assert [n.type for n in widget.nodes] == ["basic"]
    assert {b.param_key for b in widget.bindings} >= {"contrast", "saturation"}


@pytest.mark.asyncio
async def test_subject_pop_numbers_inside_envelope() -> None:
    widget = await run_fused_tool(
        SubjectPopTemplate(), intent="make subject pop",
        scope=Scope.model_validate({"kind": "named_region", "label": "left person"}),
        ctx=_ctx(), prior=None, instruction=None,
        anthropic=_FakeAnthropic(),
    )
    contrast_binding = next(b for b in widget.bindings if b.param_key == "contrast")
    assert -50 <= contrast_binding.value <= 50
    saturation_binding = next(b for b in widget.bindings if b.param_key == "saturation")
    assert -30 <= saturation_binding.value <= 30
