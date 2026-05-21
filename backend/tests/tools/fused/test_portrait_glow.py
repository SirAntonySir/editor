import pytest

from app.schemas.enriched_context import EnrichedImageContext
from app.schemas.widget import Scope
from app.tools.fused.portrait_glow import PortraitGlowTemplate
from app.tools.fused_framework import run_fused_tool


class _FakeAnthropic:
    def resolve_fused_tool(self, template_id, prompt_payload, response_schema, session_id=None):
        return {
            "values": {"clarity": -25, "kelvin_nudge": 150},
            "reasoning": "soft glow for portrait",
        }


def _ctx() -> EnrichedImageContext:
    return EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z",
    )


@pytest.mark.asyncio
async def test_portrait_glow_skeleton_is_stable() -> None:
    widget = await run_fused_tool(
        PortraitGlowTemplate(), intent="portrait glow",
        scope=Scope.model_validate({"kind": "named_region", "label": "left person"}),
        ctx=_ctx(), prior=None, instruction=None,
        anthropic=_FakeAnthropic(),
    )
    assert [n.type for n in widget.nodes] == ["basic", "kelvin"]
    assert {b.param_key for b in widget.bindings} >= {"clarity", "kelvin_nudge"}


@pytest.mark.asyncio
async def test_portrait_glow_numbers_inside_envelope() -> None:
    widget = await run_fused_tool(
        PortraitGlowTemplate(), intent="portrait glow",
        scope=Scope.model_validate({"kind": "named_region", "label": "left person"}),
        ctx=_ctx(), prior=None, instruction=None,
        anthropic=_FakeAnthropic(),
    )
    clarity_binding = next(b for b in widget.bindings if b.param_key == "clarity")
    assert -50 <= clarity_binding.value <= 0
    kelvin_binding = next(b for b in widget.bindings if b.param_key == "kelvin_nudge")
    assert -400 <= kelvin_binding.value <= 400
