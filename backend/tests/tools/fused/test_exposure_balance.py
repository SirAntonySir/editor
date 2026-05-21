import pytest

from app.schemas.enriched_context import EnrichedImageContext
from app.schemas.widget import Scope
from app.tools.fused.exposure_balance import ExposureBalanceTemplate
from app.tools.fused_framework import run_fused_tool


class _FakeAnthropic:
    def resolve_fused_tool(self, template_id, prompt_payload, response_schema, session_id=None):
        return {
            "values": {"shadows": 30, "highlights": -40, "whites": -20, "blacks": 10},
            "reasoning": "lift shadows, recover highlights",
        }


def _ctx() -> EnrichedImageContext:
    return EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z",
        clipped_shadows_pct=2.5, clipped_highlights_pct=1.2, median_luma=0.45,
    )


@pytest.mark.asyncio
async def test_exposure_balance_skeleton_is_stable() -> None:
    widget = await run_fused_tool(
        ExposureBalanceTemplate(), intent="balance exposure",
        scope=Scope.model_validate({"kind": "global"}),
        ctx=_ctx(), prior=None, instruction=None,
        anthropic=_FakeAnthropic(),
    )
    assert [n.type for n in widget.nodes] == ["basic"]
    assert {b.param_key for b in widget.bindings} >= {"shadows", "highlights", "whites", "blacks"}


@pytest.mark.asyncio
async def test_exposure_balance_numbers_inside_envelope() -> None:
    widget = await run_fused_tool(
        ExposureBalanceTemplate(), intent="balance exposure",
        scope=Scope.model_validate({"kind": "global"}),
        ctx=_ctx(), prior=None, instruction=None,
        anthropic=_FakeAnthropic(),
    )
    for key in ("shadows", "highlights", "whites", "blacks"):
        binding = next(b for b in widget.bindings if b.param_key == key)
        assert -100 <= binding.value <= 100
