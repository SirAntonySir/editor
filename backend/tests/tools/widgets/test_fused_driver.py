"""__driver handling on fused intent widgets.

Uses the synchronous TestClient pattern (same as test_set_widget_param.py)
rather than the async direct-handler pattern in the brief.  TestClient is
proven, avoids anyio fixture plumbing, and exercises the full HTTP → handler
path including serialisation.
"""
from __future__ import annotations

from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.api import deps
from app.tools.widgets.set_widget_param import SetWidgetParamTool


# ---------------------------------------------------------------------------
# Session / client helpers
# ---------------------------------------------------------------------------

def _client() -> TestClient:
    from app.main import app
    reg = deps.get_tool_registry()
    if "set_widget_param" not in reg._tools:
        reg.register(SetWidgetParamTool())
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
            "widget_id": widget_id,
            "param_key": param_key,
            "value": value,
        }},
    ).json()


# ---------------------------------------------------------------------------
# Fused widget factory
# ---------------------------------------------------------------------------

def _make_fused_widget(sid: str):
    """Add a 1-op light widget with a synthesised compound block to the session
    document and return the widget object."""
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


# ---------------------------------------------------------------------------
# Tests — RED phase: all should FAIL before the __driver branch is added
# ---------------------------------------------------------------------------

def test_driver_zero_returns_to_baseline():
    """Setting __driver to 0.0 should interpolate exposure back to anchor-0 (0.0)."""
    client = _client()
    sid = _session(client)
    w = _make_fused_widget(sid)

    resp = _set_param(client, sid, w.id, "__driver", 0.0)
    assert resp.get("ok") is True

    doc = deps.get_session_store().get_document(sid)
    w2 = doc.widgets[w.id]
    assert w2.nodes[0].params["exposure"] == 0.0
    assert w2.driver_value == 0.0


def test_driver_one_lands_on_resolved():
    """Setting __driver to 1.0 should land exposure at anchor-1 value (−80.0)."""
    client = _client()
    sid = _session(client)
    w = _make_fused_widget(sid)

    _set_param(client, sid, w.id, "__driver", 0.5)
    _set_param(client, sid, w.id, "__driver", 1.0)

    doc = deps.get_session_store().get_document(sid)
    w2 = doc.widgets[w.id]
    assert w2.nodes[0].params["exposure"] == -80.0


def test_driver_overshoot_extrapolates_and_clamps():
    """__driver=1.5 extrapolates to −120, which must clamp to the registry floor (−100)."""
    client = _client()
    sid = _session(client)
    w = _make_fused_widget(sid)

    resp = _set_param(client, sid, w.id, "__driver", 1.5)
    assert resp.get("ok") is True

    doc = deps.get_session_store().get_document(sid)
    w2 = doc.widgets[w.id]
    assert w2.nodes[0].params["exposure"] == -100.0
    assert w2.driver_value == 1.5


def test_driver_skips_locked_params():
    """Locked params must not be overwritten by the driver."""
    client = _client()
    sid = _session(client)
    w = _make_fused_widget(sid)

    # Lock exposure while it's at −80 (the resolved position at driver_value=1.0).
    doc = deps.get_session_store().get_document(sid)
    doc.widgets[w.id].locked_params = ["exposure"]

    _set_param(client, sid, w.id, "__driver", 0.0)

    doc = deps.get_session_store().get_document(sid)
    w2 = doc.widgets[w.id]
    # exposure was NOT rewritten — stays at the value it had when locked (−80).
    assert w2.nodes[0].params["exposure"] == -80.0


def test_derived_edit_on_fused_widget_implicit_locks():
    """Editing a derived param directly should add it to locked_params."""
    client = _client()
    sid = _session(client)
    w = _make_fused_widget(sid)

    resp = _set_param(client, sid, w.id, "exposure", -55.0)
    assert resp.get("ok") is True

    doc = deps.get_session_store().get_document(sid)
    w2 = doc.widgets[w.id]
    assert "exposure" in w2.locked_params


def test_driver_updates_binding_values():
    """The exposure binding's .value must track the interpolated result."""
    client = _client()
    sid = _session(client)
    w = _make_fused_widget(sid)

    _set_param(client, sid, w.id, "__driver", 0.5)

    doc = deps.get_session_store().get_document(sid)
    w2 = doc.widgets[w.id]
    exposure_binding = next(b for b in w2.bindings if b.param_key == "exposure")
    assert exposure_binding.value == -40.0
