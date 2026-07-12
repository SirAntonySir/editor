"""Tests for repeat_widget — template-free path (T5).

The widget fixture is built directly from the fused-compound helper so we
don't need the legacy fused framework at all.  A fake anthropic client
captures the rejected_attempts argument and returns deterministic params.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.widgets.repeat_widget import RepeatWidgetTool


# ---------------------------------------------------------------------------
# Fake anthropic: captures kwargs for assertion + returns deterministic values
# ---------------------------------------------------------------------------

class _FakeAnthropic:
    """Tracks calls to resolve_widget_params; returns params that change on
    each call so tests can verify the binding value actually updated."""

    def __init__(self):
        self.calls: list[dict] = []
        self._call_n = 0

    def resolve_widget_params(
        self, *, op, intent, rationale, starting_params,
        image_context, session_id=None, rejected_attempts=None,
    ) -> dict:
        self._call_n += 1
        self.calls.append({
            "op_id": op.id,
            "intent": intent,
            "rationale": rationale,
            "starting_params": dict(starting_params),
            "rejected_attempts": rejected_attempts,
        })
        # Return "max of range" for all scalar params to make values change
        # predictably across re-rolls (mirrors what the refine fake does).
        out = {}
        for k, p in op.params.items():
            if getattr(p, "range", None):
                # Alternate between range[0] and range[1] so successive calls
                # return different values — simulates a genuine re-roll.
                out[k] = p.range[1] if self._call_n % 2 == 1 else p.range[0]
            else:
                out[k] = p.default
        return out


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def fake_anthropic():
    return _FakeAnthropic()


@pytest.fixture
def client(fake_anthropic):
    from app.main import app
    _prev = deps._anthropic_client
    deps._anthropic_client = fake_anthropic
    reg = deps.get_tool_registry()
    if "repeat_widget" not in reg._tools:
        reg.register(RepeatWidgetTool())
    try:
        yield TestClient(app)
    finally:
        deps._anthropic_client = _prev


def _make_session_with_kelvin_widget(client) -> tuple[str, str]:
    """Create a session and add a kelvin registry-op widget directly.

    Uses propose_stack with warm_grade preset so the widget is a proper
    registry-op widget (kelvin, op_id="kelvin").  Context primed so
    repeat_widget's requires_context=True permission is satisfied.
    """
    from io import BytesIO
    from PIL import Image
    from app.schemas.enriched_context import EnrichedImageContext
    from app.tools.widgets.propose_stack import ProposeStackTool

    buf = BytesIO()
    Image.new("RGB", (16, 16)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]

    from app.state.document import DEFAULT_IMAGE_NODE_ID
    doc = deps.get_session_store().get_document(sid)
    ctx = EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z",
    )
    doc.set_image_context(DEFAULT_IMAGE_NODE_ID, ctx)
    deps.get_session_store().set_context(sid, ctx.model_dump(mode="json"))

    reg = deps.get_tool_registry()
    if "propose_stack" not in reg._tools:
        reg.register(ProposeStackTool())

    # warm_grade first widget is kelvin (op_id="kelvin")
    proposed = client.post(
        "/api/tools/propose_stack",
        json={"session_id": sid, "input": {
            "intent": "warmer", "scope": {"kind": "global"},
            "preset_id": "warm_grade", "origin": "mcp_user_prompt",
        }},
    ).json()
    assert proposed["ok"] is True, proposed
    wid = proposed["output"]["widgets"][0]["id"]
    return sid, wid


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_repeat_re_rolls_and_logs_rejection(client, fake_anthropic) -> None:
    """Repeat re-rolls params via resolve_widget_params and appends the
    prior values to rejected_attempts."""
    sid, wid = _make_session_with_kelvin_widget(client)
    doc = deps.get_session_store().get_document(sid)
    w_before = doc.widgets[wid]
    # Capture the initial kelvin binding value
    initial_kelvin = next(b for b in w_before.bindings if b.param_key == "kelvin").value

    body = client.post(
        "/api/tools/repeat_widget",
        json={"session_id": sid, "input": {"widget_id": wid}},
    ).json()
    assert body["ok"] is True, body

    # Fake resolver was called
    assert len(fake_anthropic.calls) == 1
    call = fake_anthropic.calls[0]
    assert call["op_id"] == "kelvin"

    # kelvin binding value must have changed (fake returns range[1]=10000 on first call)
    w_out = body["output"]["widget"]
    kelvin_binding = next(b for b in w_out["bindings"] if b["paramKey"] == "kelvin")
    assert kelvin_binding["value"] != initial_kelvin

    # rejected_attempts now has one entry (the values before the re-roll)
    doc_after = deps.get_session_store().get_document(sid)
    assert len(doc_after.widgets[wid].rejected_attempts) == 1
    # The rejected entry contains the original kelvin value
    assert doc_after.widgets[wid].rejected_attempts[0].values["kelvin"] == initial_kelvin


def test_repeat_passes_rejected_attempts_to_resolver(client, fake_anthropic) -> None:
    """After a first repeat, the second repeat passes both rejected attempts
    to resolve_widget_params so the resolver avoids repeating prior values."""
    sid, wid = _make_session_with_kelvin_widget(client)

    # First repeat
    body1 = client.post(
        "/api/tools/repeat_widget",
        json={"session_id": sid, "input": {"widget_id": wid}},
    ).json()
    assert body1["ok"] is True

    # Second repeat — resolver should receive the first attempt in rejected_attempts
    body2 = client.post(
        "/api/tools/repeat_widget",
        json={"session_id": sid, "input": {"widget_id": wid}},
    ).json()
    assert body2["ok"] is True

    assert len(fake_anthropic.calls) == 2
    second_call = fake_anthropic.calls[1]
    # rejected_attempts must be non-empty (contains at least the original + first re-roll)
    assert second_call["rejected_attempts"] is not None
    assert len(second_call["rejected_attempts"]) >= 2

    # Each entry must be a dict (param_key → value mapping)
    for entry in second_call["rejected_attempts"]:
        assert isinstance(entry, dict)
        assert "kelvin" in entry


def test_repeat_prompt_block_contains_prior_values(client, fake_anthropic) -> None:
    """The rejected_attempts list passed to the resolver contains the prior
    binding values — this is what drives the 'do not repeat' instruction."""
    sid, wid = _make_session_with_kelvin_widget(client)
    doc = deps.get_session_store().get_document(sid)
    w = doc.widgets[wid]
    original_kelvin = next(b for b in w.bindings if b.param_key == "kelvin").value

    body = client.post(
        "/api/tools/repeat_widget",
        json={"session_id": sid, "input": {"widget_id": wid}},
    ).json()
    assert body["ok"] is True

    call = fake_anthropic.calls[0]
    rejected = call["rejected_attempts"]
    assert rejected is not None and len(rejected) == 1
    # The single rejected entry is a dict with the original kelvin value
    assert rejected[0]["kelvin"] == original_kelvin


def test_repeat_updates_compound_target_anchor(client, fake_anthropic) -> None:
    """When the widget carries a compound block, repeat refreshes anchor-1
    for unlocked params so the driver's 100% tracks the re-rolled values."""
    from tests.tools.widgets.test_fused_compound import _fused_candidate_widget
    from app.tools.widgets.fused_compound import synthesize_compound

    sid, _ = _make_session_with_kelvin_widget(client)
    doc = deps.get_session_store().get_document(sid)

    # Use the light-op candidate widget (has compound anchors: exposure -80 → target)
    w = _fused_candidate_widget()
    w.op_id = "light"           # must be a registry op for repeat to accept
    w.compound = synthesize_compound(w, doc)
    assert w.compound is not None
    original_target = w.compound.anchors[1].values["n_a:exposure"]
    assert original_target == -80.0

    doc.add_widget(w)

    body = client.post(
        "/api/tools/repeat_widget",
        json={"session_id": sid, "input": {"widget_id": w.id}},
    ).json()
    assert body["ok"] is True, body

    # Fake resolver returns range[1]=100 on first call for "light" op
    w_out = doc.widgets[w.id]
    assert w_out.compound is not None
    # anchor-1 exposure must be updated to the newly resolved value (100)
    assert w_out.compound.anchors[1].values["n_a:exposure"] == 100.0


def test_repeat_rejects_composed_widget(client) -> None:
    sid, wid = _make_session_with_kelvin_widget(client)
    doc = deps.get_session_store().get_document(sid)
    doc.widgets[wid].composed = True
    body = client.post(
        "/api/tools/repeat_widget",
        json={"session_id": sid, "input": {"widget_id": wid}},
    ).json()
    assert body["ok"] is False
    assert body["error"]["code"] == "invalid_input"


def test_repeat_rejects_widget_with_no_op_id(client) -> None:
    """A widget without op_id (e.g., manually composed) is rejected by repeat."""
    sid, wid = _make_session_with_kelvin_widget(client)
    doc = deps.get_session_store().get_document(sid)
    doc.widgets[wid].op_id = None
    body = client.post(
        "/api/tools/repeat_widget",
        json={"session_id": sid, "input": {"widget_id": wid}},
    ).json()
    assert body["ok"] is False
    assert body["error"]["code"] == "invalid_input"


def test_repeat_skips_locked_params(client, fake_anthropic) -> None:
    """Locked params survive repeat — Phase A doctrine: pins are inviolable."""
    from tests.tools.widgets.test_fused_compound import _fused_candidate_widget

    sid, _ = _make_session_with_kelvin_widget(client)
    doc = deps.get_session_store().get_document(sid)

    w = _fused_candidate_widget()
    w.op_id = "light"
    doc.add_widget(w)

    original_exposure = w.nodes[0].params.get("exposure", 0.0)
    w.locked_params = ["exposure"]
    doc.update_widget(w)

    body = client.post(
        "/api/tools/repeat_widget",
        json={"session_id": sid, "input": {"widget_id": w.id}},
    ).json()
    assert body["ok"] is True, body

    w_out = doc.widgets[w.id]
    assert w_out.nodes[0].params.get("exposure") == original_exposure, (
        f"locked param 'exposure' must survive repeat, "
        f"got {w_out.nodes[0].params.get('exposure')!r}"
    )


def test_resolve_widget_params_with_no_rejected_attempts_unchanged(client, fake_anthropic) -> None:
    """resolve_widget_params with rejected_attempts=None behaves exactly as
    before — the rejected_attempts block is absent from the call."""
    # Indirectly test via refine (which never passes rejected_attempts)
    from app.tools.widgets.refine_widget import RefineWidgetTool
    reg = deps.get_tool_registry()
    if "refine_widget" not in reg._tools:
        reg.register(RefineWidgetTool())

    from tests.tools.widgets.test_fused_compound import _fused_candidate_widget
    sid, _ = _make_session_with_kelvin_widget(client)
    doc = deps.get_session_store().get_document(sid)
    w = _fused_candidate_widget()
    w.op_id = "light"
    doc.add_widget(w)

    body = client.post(
        "/api/tools/refine_widget",
        json={"session_id": sid, "input": {
            "widget_id": w.id,
            "edits": [],
            "additions": [],
            "instruction": "darker",
        }},
    ).json()
    assert body["ok"] is True

    # The refine path doesn't pass rejected_attempts — fake must have received None
    assert len(fake_anthropic.calls) == 1
    assert fake_anthropic.calls[0]["rejected_attempts"] is None
