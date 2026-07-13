"""unlock_widget_param — release semantics on fused widgets.

Releasing a lock must be VISIBLE: the param snaps back onto the driver's
curve (the value the driver would have given it at its current position),
so clicking the Lock affordance demonstrably "gives the param back".
Non-fused widgets keep the plain lock-removal behaviour.

TestClient pattern, mirroring test_fused_driver.py.
"""
from __future__ import annotations

from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from app.api import deps
from app.tools.widgets.set_widget_param import SetWidgetParamTool
from app.tools.widgets.unlock_widget_param import UnlockWidgetParamTool


def _client() -> TestClient:
    from app.main import app
    reg = deps.get_tool_registry()
    for t in (SetWidgetParamTool(), UnlockWidgetParamTool()):
        if t.name not in reg._tools:
            reg.register(t)
    return TestClient(app)


def _session(client: TestClient) -> str:
    buf = BytesIO()
    Image.new("RGB", (16, 16), (80, 80, 80)).save(buf, format="JPEG")
    resp = client.post(
        "/api/session",
        files={"image": ("x.jpg", buf.getvalue(), "image/jpeg")},
    )
    return resp.json()["session_id"]


def _set_param(client: TestClient, sid: str, widget_id: str, param_key: str, value: float) -> dict:
    return client.post(
        "/api/tools/set_widget_param",
        json={"session_id": sid, "input": {
            "widget_id": widget_id, "param_key": param_key, "value": value,
        }},
    ).json()


def _unlock(client: TestClient, sid: str, widget_id: str, param_key: str) -> dict:
    return client.post(
        "/api/tools/unlock_widget_param",
        json={"session_id": sid, "input": {
            "widget_id": widget_id, "param_key": param_key,
        }},
    ).json()


def _make_fused_widget(sid: str):
    from tests.tools.widgets.test_fused_compound import (
        _FakeDoc,
        _fused_candidate_widget,
    )
    from app.tools.widgets.fused_compound import synthesize_compound

    doc = deps.get_session_store().get_document(sid)
    w = _fused_candidate_widget()
    w.compound = synthesize_compound(w, _FakeDoc(), driver_label="Blackness")
    w.driver_value = 1.0
    doc.add_widget(w)
    return w


def test_unlock_snaps_param_back_onto_driver_curve():
    """Hand-edit exposure (implicit lock), move the driver, then release —
    exposure must jump to the driver's CURRENT interpolated value, not stay
    at the hand-set one."""
    client = _client()
    sid = _session(client)
    w = _make_fused_widget(sid)
    doc = deps.get_session_store().get_document(sid)

    # Hand-edit → implicit lock at -55.
    _set_param(client, sid, w.id, "exposure", -55.0)
    assert "exposure" in doc.widgets[w.id].locked_params
    # Driver to 0.5: exposure would be -40 (linear baseline 0 → proposal -80),
    # but it's locked so it stays -55.
    _set_param(client, sid, w.id, "__driver", 0.5)
    assert doc.widgets[w.id].nodes[0].params["exposure"] == -55.0

    # Release → snaps to the driver's current curve value (-40).
    out = _unlock(client, sid, w.id, "exposure")
    assert out.get("ok") is not False
    live = doc.widgets[w.id]
    assert "exposure" not in live.locked_params
    assert live.nodes[0].params["exposure"] == -40.0
    binding = next(b for b in live.bindings if b.param_key == "exposure")
    assert binding.value == -40.0


def test_unlock_without_driver_move_snaps_to_proposal():
    """Lock at spawn driver position (1.0) → release returns the param to the
    proposal value."""
    client = _client()
    sid = _session(client)
    w = _make_fused_widget(sid)
    doc = deps.get_session_store().get_document(sid)

    _set_param(client, sid, w.id, "exposure", -10.0)
    _unlock(client, sid, w.id, "exposure")
    assert doc.widgets[w.id].nodes[0].params["exposure"] == -80.0  # proposal


def test_unlock_param_not_in_anchors_keeps_value():
    """Params the driver never drove (not in the anchor table) just unlock —
    no snap, value untouched."""
    client = _client()
    sid = _session(client)
    w = _make_fused_widget(sid)
    doc = deps.get_session_store().get_document(sid)

    # 'brightness' had zero delta at synthesis, so it is NOT in the anchors
    # (and the fixture carries no binding for it) — seed the lock directly.
    live = doc.widgets[w.id]
    live.nodes[0].params["brightness"] = 33.0
    live.locked_params.append("brightness")
    _unlock(client, sid, w.id, "brightness")
    live = doc.widgets[w.id]
    assert "brightness" not in live.locked_params
    assert live.nodes[0].params["brightness"] == 33.0


def test_unlock_on_non_fused_widget_is_plain_removal():
    """No compound → releasing a lock never touches values."""
    from tests.tools.widgets.test_fused_compound import _fused_candidate_widget

    client = _client()
    sid = _session(client)
    doc = deps.get_session_store().get_document(sid)
    w = _fused_candidate_widget()  # no compound attached
    doc.add_widget(w)

    _set_param(client, sid, w.id, "exposure", -55.0)
    # Non-fused widgets don't implicit-lock, so force one for the test.
    doc.widgets[w.id].locked_params = ["exposure"]
    _unlock(client, sid, w.id, "exposure")
    live = doc.widgets[w.id]
    assert live.locked_params == []
    assert live.nodes[0].params["exposure"] == -55.0
