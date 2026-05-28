import pytest

from app.schemas.widget import (
    ControlSchema,
    NodeParamTarget,
    Scope,
    Widget,
    WidgetOrigin,
)
from app.tools.fused_framework import (
    BindingSkeleton,
    FusedToolTemplate,
    NodeSkeleton,
    ParamRange,
    ResolvedNumbers,
    ResolverError,
    run_fused_tool,
)


class _AlwaysOutOfEnvelope(FusedToolTemplate):
    id = "out_of_env"
    label = "Test"
    description = "always returns out-of-envelope"
    typical_use = "test"
    node_skeleton = [
        NodeSkeleton(
            node_type="kelvin", fixed_params={},
            tunable_param_keys=["temperature"],
        )
    ]
    bindings_skeleton = [
        BindingSkeleton(
            param_key="temperature", label="Warmth",
            control_type="slider",
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -1200, "max": 1200, "step": 50}
            ),
            target=NodeParamTarget(node_id="n_kelvin", param_key="temperature"),
            tunable_default=True,
        )
    ]
    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    param_envelope = {
        "temperature": ParamRange(min=-1200, max=1200, step=50, skin_safe_max=400),
    }
    safety = {}
    context_inputs = []

    async def resolve(self, intent, scope, ctx, prior_widget, instruction, anthropic):
        return ResolvedNumbers(values={"temperature": 9999})


class _InEnvelope(_AlwaysOutOfEnvelope):
    id = "in_env"

    async def resolve(self, intent, scope, ctx, prior_widget, instruction, anthropic):
        return ResolvedNumbers(values={"temperature": 800})


class _AlwaysRaises(_AlwaysOutOfEnvelope):
    id = "raises"

    async def resolve(self, intent, scope, ctx, prior_widget, instruction, anthropic):
        raise ResolverError("nope")


def _scope_global():
    return Scope.model_validate({"kind": "global"})


def _ctx():
    from app.schemas.enriched_context import EnrichedImageContext
    return EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z",
    )


@pytest.mark.asyncio
async def test_in_envelope_runs_first_try() -> None:
    template = _InEnvelope()
    widget = await run_fused_tool(
        template, intent="warm", scope=_scope_global(), ctx=_ctx(),
        prior=None, instruction=None, anthropic=None,
    )
    assert isinstance(widget, Widget)
    assert widget.nodes[0].params == {"temperature": 800}
    assert widget.bindings[0].value == 800


@pytest.mark.asyncio
async def test_triple_miss_falls_back_to_envelope_seed() -> None:
    template = _AlwaysOutOfEnvelope()
    widget = await run_fused_tool(
        template, intent="warm", scope=_scope_global(), ctx=_ctx(),
        prior=None, instruction=None, anthropic=None,
    )
    assert widget.nodes[0].params == {"temperature": 0.0}


@pytest.mark.asyncio
async def test_resolver_error_also_falls_back_to_seed() -> None:
    template = _AlwaysRaises()
    widget = await run_fused_tool(
        template, intent="warm", scope=_scope_global(), ctx=_ctx(),
        prior=None, instruction=None, anthropic=None,
    )
    assert widget.nodes[0].params == {"temperature": 0.0}


@pytest.mark.asyncio
async def test_widget_carries_fused_tool_id_and_origin() -> None:
    template = _InEnvelope()
    widget = await run_fused_tool(
        template, intent="warm", scope=_scope_global(), ctx=_ctx(),
        prior=None, instruction=None, anthropic=None,
    )
    assert widget.fused_tool_id == "in_env"
    assert widget.composed is False
