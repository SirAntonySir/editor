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
        return ResolvedNumbers(values={"temperature": 9999}, reasoning="too hot")


class _InEnvelope(_AlwaysOutOfEnvelope):
    id = "in_env"

    async def resolve(self, intent, scope, ctx, prior_widget, instruction, anthropic):
        return ResolvedNumbers(values={"temperature": 800})


class _AlwaysRaises(_AlwaysOutOfEnvelope):
    id = "raises"

    async def resolve(self, intent, scope, ctx, prior_widget, instruction, anthropic):
        raise ResolverError("nope")


class _ThirdTimeLucky(_AlwaysOutOfEnvelope):
    """Violates the envelope twice, then answers in-envelope."""
    id = "third_lucky"

    def __init__(self):
        self.calls = 0

    async def resolve(self, intent, scope, ctx, prior_widget, instruction, anthropic):
        self.calls += 1
        if self.calls < 3:
            return ResolvedNumbers(values={"temperature": 9999})
        return ResolvedNumbers(values={"temperature": 800})


def _scope_global():
    return Scope.model_validate({"kind": "global"})


def _ctx():
    from app.schemas.enriched_context import EnrichedImageContext
    return EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z",
    )


@pytest.fixture
def journal(monkeypatch):
    """Capture proposal.health writes as (session_id, kind, payload) tuples."""
    events: list[tuple] = []
    monkeypatch.setattr(
        "app.services.event_journal.write_event",
        lambda sid, kind, payload: events.append((sid, kind, payload)),
    )
    return events


@pytest.mark.asyncio
async def test_in_envelope_runs_first_try(journal) -> None:
    template = _InEnvelope()
    widget = await run_fused_tool(
        template, intent="warm", scope=_scope_global(), ctx=_ctx(),
        prior=None, instruction=None, anthropic=None, session_id="s1",
    )
    assert isinstance(widget, Widget)
    assert widget.nodes[0].params == {"temperature": 800}
    assert widget.bindings[0].value == 800
    assert widget.param_source == "llm"
    assert journal == []  # clean resolution → no health events


@pytest.mark.asyncio
async def test_envelope_violation_clamps_on_last_attempt(journal) -> None:
    """The docstring always promised 'clamp on last retry' — an answer with
    one out-of-range param is image-informed and must not be discarded for
    mechanical midpoints (the w_64c4ca12 session failure mode)."""
    template = _AlwaysOutOfEnvelope()
    widget = await run_fused_tool(
        template, intent="warm", scope=_scope_global(), ctx=_ctx(),
        prior=None, instruction=None, anthropic=None, session_id="s1",
    )
    # Clamped to the envelope max, NOT seeded to the midpoint (0.0).
    assert widget.nodes[0].params == {"temperature": 1200.0}
    assert widget.param_source == "llm_clamped"
    assert widget.reasoning == "too hot"  # LLM reasoning survives the clamp
    events = [p for (_sid, kind, p) in journal if kind == "proposal.health"]
    assert [e["event"] for e in events] == [
        "resolver_retry", "resolver_retry", "envelope_clamped",
    ]
    assert events[-1]["params"] == ["temperature"]
    assert all(e["stage"] == "fused_resolve" for e in events)


@pytest.mark.asyncio
async def test_retry_recovers_before_last_attempt(journal) -> None:
    template = _ThirdTimeLucky()
    widget = await run_fused_tool(
        template, intent="warm", scope=_scope_global(), ctx=_ctx(),
        prior=None, instruction=None, anthropic=None, session_id="s1",
    )
    assert widget.nodes[0].params == {"temperature": 800}
    assert widget.param_source == "llm"
    assert [p["event"] for (_s, _k, p) in journal] == [
        "resolver_retry", "resolver_retry",
    ]


@pytest.mark.asyncio
async def test_resolver_error_falls_back_to_seed(journal) -> None:
    template = _AlwaysRaises()
    widget = await run_fused_tool(
        template, intent="warm", scope=_scope_global(), ctx=_ctx(),
        prior=None, instruction=None, anthropic=None, session_id="s1",
    )
    assert widget.nodes[0].params == {"temperature": 0.0}
    assert widget.param_source == "midpoint"
    # The Why popover must not present mechanical values as an AI decision.
    assert widget.reasoning is not None and "fallback" in widget.reasoning.lower()
    assert [p["event"] for (_s, _k, p) in journal] == [
        "resolver_retry", "resolver_retry", "resolver_retry", "midpoint_seeded",
    ]


@pytest.mark.asyncio
async def test_no_session_id_skips_journal(journal) -> None:
    """Old callers / direct tests pass no session_id — resolution must work
    and telemetry must stay silent."""
    widget = await run_fused_tool(
        _AlwaysRaises(), intent="warm", scope=_scope_global(), ctx=_ctx(),
        prior=None, instruction=None, anthropic=None,
    )
    assert widget.param_source == "midpoint"
    assert journal == []


@pytest.mark.asyncio
async def test_widget_carries_op_id_and_origin() -> None:
    template = _InEnvelope()
    widget = await run_fused_tool(
        template, intent="warm", scope=_scope_global(), ctx=_ctx(),
        prior=None, instruction=None, anthropic=None,
    )
    assert widget.op_id == "in_env"
    assert widget.composed is False
