"""Unit tests for the resolve_problem_widgets helper (T2 of feat/remove-fused-templates).

These tests verify:
1. Valid problem → widget with compound + driver_value == 1.0 + correct driver_label
2. Unknown op ids filtered; problem with no valid ops skipped + journaled (no_valid_ops)
3. Resolver raising → [] + journaled (resolver_failed)
4. param_source stamping: "llm" when resolver supplied all ops, "llm_clamped" when any clamped
5. Missing image context → [] + journaled (missing_context)
"""
from __future__ import annotations

import pytest

from app.schemas.enriched_context import Problem


# ---------------------------------------------------------------------------
# Helpers / fakes
# ---------------------------------------------------------------------------


def _problem(kind="clipped_highlights", severity=0.7, suggested_ops=None) -> Problem:
    return Problem(
        kind=kind,
        severity=severity,
        suggested_ops=suggested_ops or ["light"],
    )


class _FakeAnthropic:
    """Minimal stub for anthropic.resolve_stack_params.

    ``by_entry`` maps entry_index → {op_id: params dict}.
    """

    def __init__(self, by_entry=None, raises=None):
        # by_entry[i][op_id] = {param_key: value}
        self._by_entry: dict[int, dict[str, dict]] = by_entry or {}
        self._raises = raises

    def resolve_stack_params(self, *, plan_entries, intent, image_context, registry, session_id):
        if self._raises is not None:
            raise self._raises
        # Return dict[int, list[tuple[str, dict]]] — same as real return type.
        result: dict[int, list[tuple[str, dict]]] = {}
        for i, ops_dict in self._by_entry.items():
            result[i] = [(op_id, params) for op_id, params in ops_dict.items()]
        return result


@pytest.fixture
def journal(monkeypatch):
    events: list[tuple] = []
    monkeypatch.setattr(
        "app.services.event_journal.write_event",
        lambda sid, kind, payload: events.append((sid, kind, payload)),
    )
    return events


@pytest.fixture
def doc_with_ctx(make_doc):
    """SessionDocument with a minimal image context on DEFAULT_IMAGE_NODE_ID."""
    from app.schemas.image_context import ImageContext
    from app.state.document import DEFAULT_IMAGE_NODE_ID

    d = make_doc(with_image_context=False)
    d.set_image_context(DEFAULT_IMAGE_NODE_ID, ImageContext(
        subjects=["person"],
        lighting="backlit",
        dominant_tones=["shadows"],
        mood="calm",
        candidate_regions=[],
        model_name="claude-opus-4-7",
        model_version="2026-01",
        generated_at="2026-01-01T00:00:00Z",
    ))
    return d


def _global_scope_for(problem):
    from app.schemas.widget import Scope
    return Scope.model_validate({"kind": "global"})


# ---------------------------------------------------------------------------
# Test 1 — valid problem produces widget with compound + driver_value
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_valid_problem_mints_widget_with_compound(doc_with_ctx, journal):
    """Fixture guarantees synthesis succeeds: resolver returns exposure=-80
    which clearly differs from the registry default of 0.  compound and
    driver_value must both be set unconditionally."""
    from app.services.problem_widgets import resolve_problem_widgets, _humanize
    from app.registry.loader import get_registry

    reg = get_registry()
    # Use the 'light' op whose 'exposure' param has default 0; -80 is far from
    # default so synthesize_compound always builds an anchor pair.
    op_id = "light"
    assert op_id in reg.ops, "registry must contain the 'light' op"
    op = reg.ops[op_id]

    # Build full param dict at defaults, then override exposure.
    resolved_params = {k: p.default for k, p in op.params.items()}
    resolved_params["exposure"] = -80  # clearly different from default 0

    problem = _problem(kind="clipped_highlights", suggested_ops=[op_id])
    anthropic = _FakeAnthropic(by_entry={0: {op_id: resolved_params}})

    widgets = await resolve_problem_widgets(
        doc_with_ctx,
        [problem],
        scope_for=_global_scope_for,
        origin_kind="mcp_autonomous",
        anthropic=anthropic,
        session_id="test-session",
    )

    assert len(widgets) == 1
    w = widgets[0]
    assert w.origin.kind == "mcp_autonomous"
    # Synthesis must succeed — no conditional here.
    assert w.compound is not None
    assert w.driver_value == 1.0
    # driver_label should derive from the humanized problem kind
    expected_label = _humanize("clipped_highlights")
    assert w.compound.label == expected_label


@pytest.mark.asyncio
async def test_driver_label_humanizes_problem_kind(doc_with_ctx, journal):
    """The driver_label passed to _attach_fused_compound is "Clipped highlights"
    (first-letter uppercase, underscores/camelCase → spaces)."""
    from app.services.problem_widgets import _humanize

    assert _humanize("clipped_highlights") == "Clipped highlights"
    assert _humanize("low_contrast") == "Low contrast"
    assert _humanize("underexposed_shadows") == "Underexposed shadows"


# ---------------------------------------------------------------------------
# Test 2 — unknown op ids filtered, problem with none skipped + journaled
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_unknown_ops_filtered_and_problem_skipped(doc_with_ctx, journal):
    from app.services.problem_widgets import resolve_problem_widgets

    problem = _problem(
        kind="clipped_highlights",
        suggested_ops=["not_a_real_op_xyz", "another_fake_op"],
    )
    anthropic = _FakeAnthropic(by_entry={})

    widgets = await resolve_problem_widgets(
        doc_with_ctx,
        [problem],
        scope_for=_global_scope_for,
        origin_kind="mcp_autonomous",
        anthropic=anthropic,
        session_id="test-session",
    )

    assert widgets == []

    health_events = [
        p for (_sid, kind, p) in journal
        if kind == "proposal.health" and p.get("event") == "resolve_failed"
    ]
    assert len(health_events) == 1
    assert health_events[0]["reason"] == "no_valid_ops"
    assert health_events[0]["kind"] == "clipped_highlights"


@pytest.mark.asyncio
async def test_mixed_ops_only_valid_ones_used(doc_with_ctx, journal):
    """A problem whose suggested_ops contain both valid and invalid op ids:
    the helper should build an entry with only the valid ops and mint a widget."""
    from app.services.problem_widgets import resolve_problem_widgets
    from app.registry.loader import get_registry

    reg = get_registry()
    op_id = next(iter(reg.ops))
    op = reg.ops[op_id]
    resolved_params = {k: p.default for k, p in op.params.items()}

    problem = _problem(
        kind="clipped_highlights",
        suggested_ops=["not_a_real_op_xyz", op_id],
    )
    anthropic = _FakeAnthropic(by_entry={0: {op_id: resolved_params}})

    widgets = await resolve_problem_widgets(
        doc_with_ctx,
        [problem],
        scope_for=_global_scope_for,
        origin_kind="mcp_autonomous",
        anthropic=anthropic,
        session_id="test-session",
    )

    assert len(widgets) == 1
    # No no_valid_ops event should have been emitted.
    no_valid = [
        p for (_s, _k, p) in journal
        if p.get("event") == "resolve_failed" and p.get("reason") == "no_valid_ops"
    ]
    assert no_valid == []


# ---------------------------------------------------------------------------
# Test 3 — resolver raising → [] + journaled (resolver_failed)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_resolver_failure_returns_empty_and_journals(doc_with_ctx, journal):
    from app.services.problem_widgets import resolve_problem_widgets
    from app.registry.loader import get_registry

    reg = get_registry()
    op_id = next(iter(reg.ops))

    problem = _problem(kind="low_contrast", suggested_ops=[op_id])
    anthropic = _FakeAnthropic(raises=RuntimeError("Anthropic timed out"))

    widgets = await resolve_problem_widgets(
        doc_with_ctx,
        [problem],
        scope_for=_global_scope_for,
        origin_kind="mcp_autonomous",
        anthropic=anthropic,
        session_id="test-session",
    )

    assert widgets == []

    health = [
        p for (_s, kind, p) in journal
        if kind == "proposal.health" and p.get("event") == "resolver_failed"
    ]
    assert len(health) == 1
    assert "timed out" in (health[0].get("detail") or "").lower()


# ---------------------------------------------------------------------------
# Test 4a — param_source == "llm" when resolver supplied params for all ops
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_param_source_llm_when_resolver_supplies_all(doc_with_ctx, journal):
    from app.services.problem_widgets import resolve_problem_widgets
    from app.registry.loader import get_registry

    reg = get_registry()
    op_id = next(iter(reg.ops))
    op = reg.ops[op_id]
    resolved_params = {k: p.default for k, p in op.params.items()}

    problem = _problem(kind="low_contrast", suggested_ops=[op_id])
    anthropic = _FakeAnthropic(by_entry={0: {op_id: resolved_params}})

    widgets = await resolve_problem_widgets(
        doc_with_ctx,
        [problem],
        scope_for=_global_scope_for,
        origin_kind="mcp_autonomous",
        anthropic=anthropic,
        session_id="test-session",
    )

    assert len(widgets) == 1
    assert widgets[0].param_source == "llm"


# ---------------------------------------------------------------------------
# Test 4b — param_source == "llm_clamped" when any op fell back to clamp
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_param_source_llm_clamped_when_op_omitted_by_resolver(doc_with_ctx, journal):
    """When the resolver omits an op from its response, the helper falls back
    to clamp_op_params and stamps param_source='llm_clamped'."""
    from app.services.problem_widgets import resolve_problem_widgets
    from app.registry.loader import get_registry

    reg = get_registry()
    ops = list(reg.ops.keys())
    if len(ops) < 2:
        pytest.skip("need at least 2 ops in registry")
    op_id_a, op_id_b = ops[0], ops[1]
    op_a = reg.ops[op_id_a]
    resolved_params_a = {k: p.default for k, p in op_a.params.items()}

    # Problem has two ops; resolver only returns params for op_id_a; op_id_b falls back.
    problem = _problem(kind="low_contrast", suggested_ops=[op_id_a, op_id_b])
    anthropic = _FakeAnthropic(by_entry={0: {op_id_a: resolved_params_a}})  # op_id_b omitted

    widgets = await resolve_problem_widgets(
        doc_with_ctx,
        [problem],
        scope_for=_global_scope_for,
        origin_kind="mcp_autonomous",
        anthropic=anthropic,
        session_id="test-session",
    )

    assert len(widgets) == 1
    assert widgets[0].param_source == "llm_clamped"


# ---------------------------------------------------------------------------
# Test 5 — missing image context → [] + journaled (missing_context)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_missing_context_returns_empty_and_journals(make_doc, journal):
    """When no image context is set on the document, resolve_problem_widgets
    journals missing_context and returns [] without calling the resolver."""
    from app.services.problem_widgets import resolve_problem_widgets
    from app.registry.loader import get_registry

    reg = get_registry()
    op_id = next(iter(reg.ops))

    # doc with NO image context
    doc = make_doc(with_image_context=False)

    problem = _problem(kind="clipped_highlights", suggested_ops=[op_id])
    anthropic = _FakeAnthropic(by_entry={0: {op_id: {}}})

    widgets = await resolve_problem_widgets(
        doc,
        [problem],
        scope_for=_global_scope_for,
        origin_kind="mcp_autonomous",
        anthropic=anthropic,
        session_id="test-session",
    )

    assert widgets == []

    health = [
        p for (_s, kind, p) in journal
        if kind == "proposal.health" and p.get("event") == "resolve_failed"
    ]
    assert len(health) == 1
    assert health[0]["reason"] == "missing_context"
