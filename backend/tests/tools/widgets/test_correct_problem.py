"""correct_problem — the Info tab's "Correct" button.

Resolves the problem's suggested registry ops against the cached image context
and mints the widget directly onto the canvas (origin tool_invoked — an
explicit user action, never a pending suggestion chip).

Coverage:
1. Mints a widget WITH compound + driver_value via tool_invoked origin.
2. Empty / unknown suggested_ops → tool error (no applicable adjustments).
3. Widget is added to the document after minting.
4. Unknown problem_kind → error.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.widgets.correct_problem import CorrectProblemTool


# ---------------------------------------------------------------------------
# Fake Anthropic — mirrors the pattern in test_problem_widgets.py
# ---------------------------------------------------------------------------

class _FakeAnthropic:
    """Stub for anthropic.resolve_stack_params that returns a single entry."""

    def __init__(self, by_entry=None, raises=None):
        self._by_entry: dict[int, dict[str, dict]] = by_entry or {}
        self._raises = raises

    def resolve_stack_params(self, *, plan_entries, intent, image_context, registry, session_id):
        if self._raises is not None:
            raise self._raises
        result: dict[int, list[tuple[str, dict]]] = {}
        for i, ops_dict in self._by_entry.items():
            result[i] = [(op_id, params) for op_id, params in ops_dict.items()]
        return result


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_client(fake_anthropic: _FakeAnthropic) -> TestClient:
    from app.main import app
    deps._anthropic_client = fake_anthropic
    reg = deps.get_tool_registry()
    if "correct_problem" not in reg._tools:
        reg.register(CorrectProblemTool())
    return TestClient(app)


@pytest.fixture(autouse=True)
def _restore_anthropic():
    """Restore the anthropic client after each test."""
    prev = deps._anthropic_client
    yield
    deps._anthropic_client = prev


def _setup_session(client: TestClient, suggested_ops: list[str]) -> str:
    """Create a session with a minimal image + one problem using suggested_ops."""
    from io import BytesIO

    from PIL import Image

    from app.schemas.enriched_context import EnrichedImageContext, Problem
    from app.state.document import DEFAULT_IMAGE_NODE_ID

    buf = BytesIO()
    Image.new("RGB", (16, 16)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]

    doc = deps.get_session_store().get_document(sid)
    ctx = EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-07-09T00:00:00Z",
        problems=[
            Problem(
                kind="clipped_highlights",
                severity=0.9,
                region_label="sky",
                suggested_ops=suggested_ops,
                display_label="Blown-out sky",
            ),
        ],
    )
    doc.set_image_context(DEFAULT_IMAGE_NODE_ID, ctx)
    deps.get_session_store().set_context(sid, ctx.model_dump(mode="json"))
    return sid


def _invoke(client: TestClient, sid: str, input: dict) -> dict:
    return client.post(
        "/api/tools/correct_problem",
        json={"session_id": sid, "input": input},
    ).json()


# ---------------------------------------------------------------------------
# Test 1 — mints widget with compound + driver_value via tool_invoked origin
# ---------------------------------------------------------------------------

def test_mints_driver_widget_with_tool_invoked_origin():
    """correct_problem produces a widget with compound + driver_value and
    tool_invoked origin when the problem has valid suggested_ops."""
    from app.registry.loader import get_registry

    reg = get_registry()
    op_id = "light"
    assert op_id in reg.ops, "registry must contain the 'light' op"
    op = reg.ops[op_id]

    # Build params at defaults, but override exposure so synthesize_compound
    # always builds an anchor pair.
    resolved_params = {k: p.default for k, p in op.params.items()}
    resolved_params["exposure"] = -80

    fake = _FakeAnthropic(by_entry={0: {op_id: resolved_params}})
    client = _make_client(fake)
    sid = _setup_session(client, suggested_ops=[op_id])

    env = _invoke(client, sid, {
        "problemKind": "clipped_highlights",
        "regionLabel": "sky",
        "layerId": "l-1",
    })

    assert env["ok"] is True
    widget = env["output"]["widget"]

    # tool_invoked → tethered immediately, never a pending chip.
    assert widget["origin"]["kind"] == "tool_invoked"
    assert widget["status"] == "active"

    # All nodes should carry the caller-supplied layer_id.
    assert all(n["layerId"] == "l-1" for n in widget["nodes"])

    # display_name propagated from the problem's display_label.
    assert widget["displayName"] == "Blown-out sky"

    # Synthesized driver must be present.
    assert widget.get("compound") is not None
    assert widget.get("driverValue") == 1.0


# ---------------------------------------------------------------------------
# Test 2 — empty suggested_ops → tool error
# ---------------------------------------------------------------------------

def test_empty_suggested_ops_returns_tool_error():
    """When the problem has no suggested_ops, the tool surfaces an error
    (no applicable adjustments) rather than minting an empty widget."""
    fake = _FakeAnthropic(by_entry={})
    client = _make_client(fake)
    sid = _setup_session(client, suggested_ops=[])

    env = _invoke(client, sid, {
        "problemKind": "clipped_highlights",
        "regionLabel": "sky",
        "layerId": "l-1",
    })

    assert env["ok"] is False


# ---------------------------------------------------------------------------
# Test 2b — unknown suggested_ops (not in registry) → tool error
# ---------------------------------------------------------------------------

def test_unknown_suggested_ops_returns_tool_error():
    """When suggested_ops contains only op ids not in the registry, the tool
    surfaces the same 'no applicable adjustments' error."""
    fake = _FakeAnthropic(by_entry={})
    client = _make_client(fake)
    sid = _setup_session(client, suggested_ops=["not_a_real_op_xyz", "another_fake"])

    env = _invoke(client, sid, {
        "problemKind": "clipped_highlights",
        "regionLabel": "sky",
        "layerId": "l-1",
    })

    assert env["ok"] is False


# ---------------------------------------------------------------------------
# Test 2c — _InvalidInput surfaces as invalid_input error code (cleanup 6)
# ---------------------------------------------------------------------------

def test_empty_suggested_ops_surfaces_invalid_input_code():
    """_NoApplicableAdjustments was renamed _InvalidInput so it is matched by
    _classify_exception in registry.py (which checks cls.__name__ == '_InvalidInput').
    Verify the error code is 'invalid_input', not 'internal_error'."""
    fake = _FakeAnthropic(by_entry={})
    client = _make_client(fake)
    sid = _setup_session(client, suggested_ops=[])

    env = _invoke(client, sid, {
        "problemKind": "clipped_highlights",
        "regionLabel": "sky",
        "layerId": "l-1",
    })

    assert env["ok"] is False
    assert env["error"]["code"] == "invalid_input", (
        f"Expected 'invalid_input' but got {env['error']['code']!r} — "
        "_NoApplicableAdjustments must be named _InvalidInput for registry mapping"
    )


# ---------------------------------------------------------------------------
# Test 3 — widget is added to the document
# ---------------------------------------------------------------------------

def test_widget_added_to_document():
    """After a successful correct_problem call, the minted widget must be
    present in doc.widgets."""
    from app.registry.loader import get_registry

    reg = get_registry()
    op_id = "light"
    op = reg.ops[op_id]
    resolved_params = {k: p.default for k, p in op.params.items()}
    resolved_params["exposure"] = -80

    fake = _FakeAnthropic(by_entry={0: {op_id: resolved_params}})
    client = _make_client(fake)
    sid = _setup_session(client, suggested_ops=[op_id])

    env = _invoke(client, sid, {
        "problemKind": "clipped_highlights",
        "regionLabel": "sky",
        "layerId": "l-1",
    })

    assert env["ok"] is True
    widget_id = env["output"]["widget"]["id"]
    doc = deps.get_session_store().get_document(sid)
    assert widget_id in doc.widgets


# ---------------------------------------------------------------------------
# Test 4 — unknown problem_kind → error
# ---------------------------------------------------------------------------

def test_unknown_problem_kind_errors_cleanly():
    """Requesting a problem_kind that doesn't exist in the context returns
    ok=False without crashing."""
    from app.registry.loader import get_registry

    reg = get_registry()
    op_id = next(iter(reg.ops))
    op = reg.ops[op_id]
    resolved_params = {k: p.default for k, p in op.params.items()}

    fake = _FakeAnthropic(by_entry={0: {op_id: resolved_params}})
    client = _make_client(fake)
    sid = _setup_session(client, suggested_ops=[op_id])

    env = _invoke(client, sid, {
        "problemKind": "crushed_shadows",
        "regionLabel": None,
        "layerId": "l-1",
    })

    assert env["ok"] is False
