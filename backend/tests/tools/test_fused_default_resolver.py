"""Default `FusedToolTemplate.resolve` behaviour: schema generation from
`param_envelope`, payload assembly from `context_inputs`, exception wrapping
in `ResolverError`."""
from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.schemas.enriched_context import EnrichedImageContext
from app.schemas.widget import Scope
from app.tools.fused.tone_band import ToneBandTemplate
from app.tools.fused_framework import ResolverError


class _RecordingClient:
    """Captures the (template_id, prompt_payload, response_schema) of the
    single `resolve_fused_tool` call. Returns a canned values dict."""

    def __init__(self, returns: dict[str, Any]) -> None:
        self._returns = returns
        self.calls: list[dict[str, Any]] = []

    def resolve_fused_tool(self, *, template_id, prompt_payload, response_schema, session_id=None):
        self.calls.append({
            "template_id": template_id,
            "prompt_payload": prompt_payload,
            "response_schema": response_schema,
            "session_id": session_id,
        })
        return self._returns


class _RaisingClient:
    def resolve_fused_tool(self, *, template_id, prompt_payload, response_schema, session_id=None):
        raise RuntimeError("boom")


def _empty_ctx() -> EnrichedImageContext:
    return EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-06-01T00:00:00Z",
    )


def test_default_resolver_builds_schema_from_envelope() -> None:
    template = ToneBandTemplate("green")
    client = _RecordingClient(returns={"values": {
        "green_hue": -10, "green_sat": -20, "green_lum": 0,
    }})
    resolved = asyncio.run(template.resolve(
        intent="green tones are not good",
        scope=Scope.model_validate({"kind": "global"}),
        ctx=_empty_ctx(),
        prior_widget=None,
        instruction=None,
        anthropic=client,
    ))
    schema = client.calls[0]["response_schema"]
    required = schema["properties"]["values"]["required"]
    assert set(required) == {"green_hue", "green_sat", "green_lum"}
    assert resolved.values["green_hue"] == -10


def test_default_resolver_payload_includes_context_inputs() -> None:
    template = ToneBandTemplate("blue")
    client = _RecordingClient(returns={"values": {
        "blue_hue": 0, "blue_sat": 0, "blue_lum": 0,
    }})
    asyncio.run(template.resolve(
        intent="cool down the blues",
        scope=Scope.model_validate({"kind": "global"}),
        ctx=_empty_ctx(),
        prior_widget=None,
        instruction="please",
        anthropic=client,
    ))
    payload = client.calls[0]["prompt_payload"]
    assert payload["intent"] == "cool down the blues"
    assert payload["instruction"] == "please"
    assert "color_palette" in payload["context_summary"]
    assert "region_stats" in payload["context_summary"]
    assert "grade_character" in payload["context_summary"]


def test_default_resolver_wraps_exceptions_in_resolver_error() -> None:
    template = ToneBandTemplate("red")
    with pytest.raises(ResolverError):
        asyncio.run(template.resolve(
            intent="redder",
            scope=Scope.model_validate({"kind": "global"}),
            ctx=_empty_ctx(),
            prior_widget=None,
            instruction=None,
            anthropic=_RaisingClient(),
        ))


def test_default_resolver_missing_context_attr_degrades_to_none() -> None:
    """If `context_inputs` names an attribute that doesn't exist on ctx,
    the payload entry is None rather than crashing."""
    template = ToneBandTemplate("aqua")
    template.context_inputs = ["color_palette", "doesnt_exist_field"]
    client = _RecordingClient(returns={"values": {
        "aqua_hue": 0, "aqua_sat": 0, "aqua_lum": 0,
    }})
    asyncio.run(template.resolve(
        intent="aqua check",
        scope=Scope.model_validate({"kind": "global"}),
        ctx=_empty_ctx(),
        prior_widget=None,
        instruction=None,
        anthropic=client,
    ))
    payload = client.calls[0]["prompt_payload"]
    assert payload["context_summary"]["doesnt_exist_field"] is None
