"""Unit tests for FusedToolTemplate.resolve()'s context-summary assembly.

The base resolver derives prompt_payload['context_summary'] from
context_inputs: flat keys come from `getattr(ctx, key, None)`; dotted
keys `container.field` get grouped under their container into a list
of {label, field1, field2, ...} dicts per entry."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest
from pydantic import BaseModel

from app.schemas.widget import Scope
from app.tools.fused_framework import (
    BindingSkeleton,
    FusedToolTemplate,
    NodeSkeleton,
    ParamRange,
    ResolvedNumbers,
)


class _StubCtx(BaseModel):
    """Minimal stand-in for EnrichedImageContext. Pydantic ensures
    attribute access works through model_dump."""
    cast_direction: list[float] = [0.1, 0.2]
    wb_neutral_confidence: float = 0.8
    model_version: str = "v"
    region_stats: list[Any] = []


class _RegionStat(BaseModel):
    label: str
    contrast_p10_p90: float
    is_skin_likely: bool
    mean_rgb: list[float]


class _SimpleTemplate(FusedToolTemplate):
    """Concrete template that exercises only param_envelope + context_inputs."""
    id = "_t"
    label = "Test"
    description = ""
    typical_use = ""
    node_skeleton = [NodeSkeleton(node_type="basic", fixed_params={}, tunable_param_keys=["a"])]
    bindings_skeleton: list[BindingSkeleton] = []
    preview = {"kind": "thumbnail", "auto_before_after": True}
    requires_scope = "any"
    param_envelope = {"a": ParamRange(min=0, max=10, step=1)}
    safety: dict[str, Any] = {}
    context_inputs: list[str] = []


def _capture_payload() -> tuple[MagicMock, dict]:
    """Return a MagicMock whose `resolve_fused_tool` records its
    prompt_payload kwarg and returns a valid ResolvedNumbers."""
    captured: dict[str, Any] = {}

    def _capture(template_id: str, prompt_payload: dict, response_schema: dict, session_id: str | None):
        captured["payload"] = prompt_payload
        captured["schema"] = response_schema
        return {"values": {"a": 5.0}}

    client = MagicMock()
    client.resolve_fused_tool = MagicMock(side_effect=_capture)
    return client, captured


@pytest.mark.asyncio
async def test_flat_context_inputs_passes_through_via_getattr():
    class T(_SimpleTemplate):
        context_inputs = ["cast_direction", "wb_neutral_confidence"]

    ctx = _StubCtx()
    scope = Scope.model_validate({"kind": "global"})
    client, captured = _capture_payload()
    result = await T().resolve("intent", scope, ctx, None, None, client)

    assert isinstance(result, ResolvedNumbers)
    assert captured["payload"]["context_summary"] == {
        "cast_direction": [0.1, 0.2],
        "wb_neutral_confidence": 0.8,
    }


@pytest.mark.asyncio
async def test_dotted_context_inputs_slice_container_entries():
    class T(_SimpleTemplate):
        context_inputs = ["region_stats.contrast_p10_p90", "region_stats.is_skin_likely"]

    ctx = _StubCtx(region_stats=[
        _RegionStat(label="sky", contrast_p10_p90=0.4, is_skin_likely=False, mean_rgb=[120, 130, 200]),
        _RegionStat(label="face", contrast_p10_p90=0.6, is_skin_likely=True, mean_rgb=[220, 180, 160]),
    ])
    scope = Scope.model_validate({"kind": "global"})
    client, captured = _capture_payload()
    await T().resolve("intent", scope, ctx, None, None, client)

    assert captured["payload"]["context_summary"] == {
        "region_stats": [
            {"label": "sky", "contrast_p10_p90": 0.4, "is_skin_likely": False},
            {"label": "face", "contrast_p10_p90": 0.6, "is_skin_likely": True},
        ],
    }


@pytest.mark.asyncio
async def test_mixed_flat_and_dotted_context_inputs():
    class T(_SimpleTemplate):
        context_inputs = ["wb_neutral_confidence", "region_stats.contrast_p10_p90"]

    ctx = _StubCtx(
        wb_neutral_confidence=0.5,
        region_stats=[_RegionStat(label="sky", contrast_p10_p90=0.4, is_skin_likely=False, mean_rgb=[0, 0, 0])],
    )
    scope = Scope.model_validate({"kind": "global"})
    client, captured = _capture_payload()
    await T().resolve("intent", scope, ctx, None, None, client)

    assert captured["payload"]["context_summary"] == {
        "wb_neutral_confidence": 0.5,
        "region_stats": [{"label": "sky", "contrast_p10_p90": 0.4}],
    }


@pytest.mark.asyncio
async def test_dotted_inputs_with_empty_container_yields_empty_list():
    class T(_SimpleTemplate):
        context_inputs = ["region_stats.contrast_p10_p90"]

    ctx = _StubCtx(region_stats=[])
    scope = Scope.model_validate({"kind": "global"})
    client, captured = _capture_payload()
    await T().resolve("intent", scope, ctx, None, None, client)

    assert captured["payload"]["context_summary"] == {"region_stats": []}


@pytest.mark.asyncio
async def test_dotted_inputs_omit_label_when_entry_has_no_label_attr():
    """Defensive: not every container element is guaranteed to have a `label`.
    If absent, the per-entry dict only carries the requested fields."""
    class _NoLabel(BaseModel):
        contrast_p10_p90: float

    class T(_SimpleTemplate):
        context_inputs = ["region_stats.contrast_p10_p90"]

    ctx = _StubCtx(region_stats=[_NoLabel(contrast_p10_p90=0.3)])
    scope = Scope.model_validate({"kind": "global"})
    client, captured = _capture_payload()
    await T().resolve("intent", scope, ctx, None, None, client)

    assert captured["payload"]["context_summary"] == {
        "region_stats": [{"contrast_p10_p90": 0.3}],
    }


@pytest.mark.asyncio
async def test_response_schema_derived_from_param_envelope_keys():
    class T(_SimpleTemplate):
        param_envelope = {
            "a": ParamRange(min=0, max=10, step=1),
            "b": ParamRange(min=-1, max=1, step=0.1),
        }

    ctx = _StubCtx()
    scope = Scope.model_validate({"kind": "global"})
    client, captured = _capture_payload()
    # Override the side_effect so the captured schema is still recorded.
    client.resolve_fused_tool.side_effect = lambda **kw: (
        captured.update({"payload": kw["prompt_payload"], "schema": kw["response_schema"]})
        or {"values": {"a": 5.0, "b": 0.1}}
    )
    await T().resolve("intent", scope, ctx, None, None, client)

    schema = captured["schema"]
    assert sorted(schema["properties"]["values"]["required"]) == ["a", "b"]
    assert set(schema["properties"]["values"]["properties"].keys()) == {"a", "b"}
