import pytest

from app.schemas.enriched_context import EnrichedImageContext
from app.schemas.widget import Scope
from app.tools.fused.bw_cinematic import BwCinematicTemplate
from app.tools.fused_framework import run_fused_tool


class _FakeAnthropic:
    def resolve_fused_tool(self, template_id, prompt_payload, response_schema, session_id=None):
        return {
            "values": {},
            "reasoning": "cinematic s-curve for b&w",
        }


def _ctx() -> EnrichedImageContext:
    return EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z",
        contrast_p10_p90=0.55,
    )


@pytest.mark.asyncio
async def test_bw_cinematic_skeleton_is_stable() -> None:
    widget = await run_fused_tool(
        BwCinematicTemplate(), intent="black and white cinematic",
        scope=Scope.model_validate({"kind": "global"}),
        ctx=_ctx(), prior=None, instruction=None,
        anthropic=_FakeAnthropic(),
    )
    assert [n.type for n in widget.nodes] == ["lut", "curves"]
    assert {b.param_key for b in widget.bindings} >= {"points"}


@pytest.mark.asyncio
async def test_bw_cinematic_lut_params_are_fixed() -> None:
    widget = await run_fused_tool(
        BwCinematicTemplate(), intent="black and white cinematic",
        scope=Scope.model_validate({"kind": "global"}),
        ctx=_ctx(), prior=None, instruction=None,
        anthropic=_FakeAnthropic(),
    )
    lut_node = next(n for n in widget.nodes if n.type == "lut")
    assert lut_node.params.get("lutId") == "bw_cinematic"
