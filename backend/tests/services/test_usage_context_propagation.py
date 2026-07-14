"""Analyze-path LLM calls must report usage through the active doc.

`_log_cache_stats` finds the session doc via a contextvar. Worker threads
only see it when the call site copies the context (`asyncio.to_thread`);
`run_in_executor` does not, which silently dropped every analyze-path
`mcp.usage` event (the admin cockpit undercounted session cost). These
tests run the real handlers with an active doc and instrumented client
fakes that invoke the real `_log_cache_stats`, then assert the usage
events landed in `doc.history` — they fail under `run_in_executor`.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.services import anthropic_client
from app.state.active_doc import reset_active_doc, set_active_doc


def _fake_response():
    return SimpleNamespace(
        usage=SimpleNamespace(
            input_tokens=100,
            output_tokens=50,
            cache_creation_input_tokens=10,
            cache_read_input_tokens=20,
        ),
    )


def _usage_calls(doc) -> list[str]:
    return [ev.payload["call"] for ev in doc.history if ev.kind == "mcp.usage"]


@pytest.fixture(autouse=True)
def _no_disk_journal(monkeypatch):
    """The fallback path writes to the on-disk journal; keep tests off disk."""
    monkeypatch.setattr(
        "app.services.event_journal.write_event", lambda *a, **kw: None,
    )


@pytest.mark.asyncio
async def test_analyze_context_reports_usage_through_active_doc(make_doc, monkeypatch):
    """analyze + augment usage must reach the doc (SSE + journal mirror),
    not be dropped in a context-less worker thread."""
    from pathlib import Path
    from unittest.mock import MagicMock

    from tests.contract._fixtures import _CANNED_CONTEXT
    from app.api import deps as _deps
    from app.services.anthropic_client import AnthropicClient, _ContextSoftFields
    from app.tools.atomic.analyze_context import AnalyzeContextTool, _Input

    monkeypatch.setenv("ANALYZE_SAM", "0")
    monkeypatch.setattr(
        _deps, "get_session_store", lambda: MagicMock(set_context=MagicMock()),
    )

    def _analyze(*_args, **kwargs):
        anthropic_client._log_cache_stats("analyze", kwargs.get("session_id"), _fake_response())
        return _CANNED_CONTEXT.model_copy(deep=True)

    def _augment(*_args, **kwargs):
        anthropic_client._log_cache_stats("augment_context", kwargs.get("session_id"), _fake_response())
        return _ContextSoftFields(
            estimated_white_point=(0.5, 0.5, 0.5),
            wb_neutral_confidence=0.8,
            grade_character="neutral",
            problems=[],
            region_soft_fields=[],
        )

    monkeypatch.setattr(AnthropicClient, "analyze_image", _analyze)
    monkeypatch.setattr(AnthropicClient, "augment_context_soft_fields", _augment)

    doc = make_doc()
    img = Path(__file__).parent.parent / "fixtures" / "test_image.jpg"
    doc.image_bytes = img.read_bytes()

    token = set_active_doc(doc)
    try:
        await AnalyzeContextTool().handler(doc, _Input())
    finally:
        reset_active_doc(token)

    calls = _usage_calls(doc)
    assert "analyze" in calls
    assert "augment_context" in calls


@pytest.mark.asyncio
async def test_topup_suggest_reports_usage_through_active_doc(make_doc, monkeypatch):
    """The autonomous top-up's suggest call must reach the doc too."""
    from app.registry.loader import get_registry
    from app.schemas.enriched_context import EnrichedImageContext
    from app.schemas.image_context import ImageContext
    from app.services.autonomous_suggestions import mint_autonomous_suggestions
    from app.state.document import SessionDocument

    if not get_registry().presets:
        pytest.skip("no presets in registry")

    # Same context stubs the autonomous-suggestions tests use.
    monkeypatch.setattr(
        "app.services.llm_context.image_context_for_llm", lambda _ctx: {},
    )
    stub_ctx = ImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="neutral",
        candidate_regions=[], model_name="stub", model_version="0",
        generated_at="2026-01-01T00:00:00Z",
    )
    monkeypatch.setattr(
        SessionDocument, "get_image_context", lambda self, image_node_id: stub_ctx,
    )

    class _Fake:
        def resolve_stack_params(self, *, plan_entries, **kw):
            from app.registry.loader import get_registry as _gr
            reg = _gr()
            result: dict[int, list[tuple[str, dict]]] = {}
            for i, entry in enumerate(plan_entries):
                ops_out = []
                for op_entry in entry.get("ops", []):
                    op = reg.ops.get(op_entry["op_id"])
                    if op is None:
                        continue
                    params = {}
                    for k, p in op.params.items():
                        if p.type == "scalar" and p.range is not None:
                            lo, hi = p.range
                            params[k] = float(p.default) + (hi - lo) * 0.1
                        else:
                            params[k] = p.default
                    ops_out.append((op_entry["op_id"], params))
                result[i] = ops_out
            return result

        def suggest_fused_tools_for_character(self, **kwargs):
            anthropic_client._log_cache_stats(
                "suggest_fused_tools_for_character",
                kwargs.get("session_id"), _fake_response(),
            )
            return [next(iter(get_registry().presets))]

    doc = make_doc()
    ctx = EnrichedImageContext(
        subjects=["sneakers"], lighting="backlit", dominant_tones=["highlights"],
        mood="calm", candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-07-02T00:00:00Z",
        grade_character="cool-cinematic", problems=[],
    )

    token = set_active_doc(doc)
    try:
        await mint_autonomous_suggestions(doc, ctx, _Fake(), layer_id="l1")
    finally:
        reset_active_doc(token)

    assert "suggest_fused_tools_for_character" in _usage_calls(doc)
