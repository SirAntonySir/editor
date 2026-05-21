import pytest

from app.schemas.enriched_context import EnrichedImageContext
from app.schemas.widget import Scope
from app.tools.fused.sky_recovery import SkyRecoveryTemplate
from app.tools.fused_framework import run_fused_tool


class _FakeAnthropic:
    def resolve_fused_tool(self, template_id, prompt_payload, response_schema, session_id=None):
        return {
            "values": {
                "highlights": -60,
                "whites": -30,
                "saturation": -10,
            },
            "reasoning": "recover blown sky",
        }


def _ctx() -> EnrichedImageContext:
    return EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z",
        clipped_highlights_pct=8.0,
    )


@pytest.mark.asyncio
async def test_sky_recovery_skeleton_is_stable() -> None:
    widget = await run_fused_tool(
        SkyRecoveryTemplate(), intent="recover sky",
        scope=Scope.model_validate({"kind": "global"}),
        ctx=_ctx(), prior=None, instruction=None,
        anthropic=_FakeAnthropic(),
    )
    assert [n.type for n in widget.nodes] == ["basic", "curves"]
    assert {b.param_key for b in widget.bindings} >= {"highlights", "whites", "saturation", "points"}


@pytest.mark.asyncio
async def test_sky_recovery_numbers_inside_envelope() -> None:
    widget = await run_fused_tool(
        SkyRecoveryTemplate(), intent="recover sky",
        scope=Scope.model_validate({"kind": "global"}),
        ctx=_ctx(), prior=None, instruction=None,
        anthropic=_FakeAnthropic(),
    )
    highlights_binding = next(b for b in widget.bindings if b.param_key == "highlights")
    assert -100 <= highlights_binding.value <= 100
