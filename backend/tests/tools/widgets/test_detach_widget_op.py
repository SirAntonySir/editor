"""detach_widget_op — unit + integration tests.

Uses the synchronous TestClient pattern (same as test_fused_driver.py) to
exercise the full HTTP → handler path including serialisation.

Fixture note: `_fused_candidate_widget` from test_fused_compound.py is
single-node and cannot be detached (guard raises _SingleNodeWidget). The
2-node fused widget built here by `_fused_2op_widget` is the base fixture for
all detach tests.
"""
from __future__ import annotations

from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.api import deps
from app.registry.schema import CompoundAnchor, OpCompoundConfig
from app.schemas.widget import (
    ControlBinding,
    ControlSchema,
    NodeParamTarget,
    Scope,
    Widget,
    WidgetNode,
    WidgetOrigin,
)
from app.tools.widgets.detach_widget_op import DetachWidgetOpTool


# ---------------------------------------------------------------------------
# Client / session helpers
# ---------------------------------------------------------------------------

def _client() -> TestClient:
    from app.main import app
    reg = deps.get_tool_registry()
    if "detach_widget_op" not in reg._tools:
        reg.register(DetachWidgetOpTool())
    return TestClient(app)


def _session(client: TestClient) -> str:
    buf = BytesIO()
    Image.new("RGB", (16, 16), (80, 80, 80)).save(buf, format="JPEG")
    resp = client.post(
        "/api/session",
        files={"image": ("x.jpg", buf.getvalue(), "image/jpeg")},
    )
    return resp.json()["session_id"]


def _call(client: TestClient, sid: str, widget_id: str, node_id: str) -> dict:
    """Return the tool output envelope.

    The registry wraps successful responses in {"ok": True, "output": {...}}.
    Error responses have {"ok": False, "error": ...} or {"error": "..."}.
    We return the inner "output" dict on success, and the raw envelope on error
    so callers can check for "error" in the result.
    """
    raw = client.post(
        "/api/tools/detach_widget_op",
        json={"session_id": sid, "input": {
            "widget_id": widget_id,
            "node_id": node_id,
        }},
    ).json()
    # Unwrap the output envelope on success.
    if raw.get("ok") is True and "output" in raw:
        return raw["output"]
    # Return raw on error so tests can assert "error" in out.
    return raw


# ---------------------------------------------------------------------------
# Fused 2-op widget factory (light + color)
# ---------------------------------------------------------------------------

def _make_scope() -> Scope:
    from app.schemas.widget import GlobalScope
    return Scope(root=GlobalScope(kind="global"))


def _fused_2op_widget(sid: str) -> Widget:
    """Inject a 2-op (light + color) fused widget directly into the session doc.

    Node layout:
      n_light  (type=basic, op_id=light, param: exposure=-80)
      n_color  (type=basic, op_id=color, param: saturation=30)
    Compound anchors are node-qualified: "n_light:exposure", "n_color:saturation".
    """
    doc = deps.get_session_store().get_document(sid)
    scope = _make_scope()
    widget_id = "w_fused2op"

    node_light = WidgetNode(
        id="n_light",
        type="basic",
        op_id="light",
        params={"exposure": -80.0},
        scope=scope,
        widget_id=widget_id,
        layer_id="layer-1",
    )
    node_color = WidgetNode(
        id="n_color",
        type="basic",
        op_id="color",
        params={"saturation": 30.0},
        scope=scope,
        widget_id=widget_id,
        layer_id="layer-1",
    )

    binding_exp = ControlBinding(
        param_key="exposure",
        label="Exposure",
        control_type="slider",
        control_schema=ControlSchema.model_validate(
            {"control_type": "slider", "min": -100, "max": 100, "step": 1},
        ),
        value=-80.0,
        default=0.0,
        target=NodeParamTarget(node_id="n_light", param_key="exposure"),
    )
    binding_sat = ControlBinding(
        param_key="saturation",
        label="Saturation",
        control_type="slider",
        control_schema=ControlSchema.model_validate(
            {"control_type": "slider", "min": -100, "max": 100, "step": 1},
        ),
        value=30.0,
        default=0.0,
        target=NodeParamTarget(node_id="n_color", param_key="saturation"),
    )

    compound = OpCompoundConfig(
        driver="__driver",
        label="Mood",
        anchors=[
            CompoundAnchor(
                position=0.0, name="as shot",
                values={"n_light:exposure": 0.0, "n_color:saturation": 0.0},
            ),
            CompoundAnchor(
                position=1.0, name="proposed",
                values={"n_light:exposure": -80.0, "n_color:saturation": 30.0},
            ),
        ],
    )

    w = Widget(
        id=widget_id,
        intent="dramatic mood",
        scope=scope,
        origin=WidgetOrigin(kind="mcp_user_prompt", prompt="dramatic mood"),
        op_id="light",
        nodes=[node_light, node_color],
        bindings=[binding_exp, binding_sat],
        status="active",
        revision=1,
        compound=compound,
        driver_value=1.0,
        locked_params=[],
    )
    doc.add_widget(w)

    # Write canonical so we can verify pixel-stability.
    doc.set_param("layer-1", "basic", "exposure", -80.0)
    doc.set_param("layer-1", "basic", "saturation", 30.0)

    return w


# ---------------------------------------------------------------------------
# Happy-path: detach the color node
# ---------------------------------------------------------------------------

def test_detach_moves_node_to_new_widget():
    client = _client()
    sid = _session(client)
    w = _fused_2op_widget(sid)

    out = _call(client, sid, w.id, "n_color")
    assert "widget" in out, f"unexpected response: {out}"
    assert "parent" in out

    new_w_id = out["widget"]["id"]
    assert new_w_id != w.id

    doc = deps.get_session_store().get_document(sid)

    # New widget is in doc.
    assert new_w_id in doc.widgets
    new_w = doc.widgets[new_w_id]

    # Node is on the new widget.
    assert any(n.id == "n_color" for n in new_w.nodes)
    assert new_w.nodes[0].widget_id == new_w_id

    # Parent no longer has the color node.
    parent = doc.widgets[w.id]
    assert not any(n.id == "n_color" for n in parent.nodes)
    assert any(n.id == "n_light" for n in parent.nodes)


def test_detach_origin_is_fused_expansion_with_parent_id():
    client = _client()
    sid = _session(client)
    w = _fused_2op_widget(sid)

    out = _call(client, sid, w.id, "n_color")
    new_w = deps.get_session_store().get_document(sid).widgets[out["widget"]["id"]]

    assert new_w.origin.kind == "fused_expansion"
    assert new_w.origin.parent_widget_id == w.id


def test_detach_bindings_move_to_new_widget():
    client = _client()
    sid = _session(client)
    w = _fused_2op_widget(sid)

    out = _call(client, sid, w.id, "n_color")
    doc = deps.get_session_store().get_document(sid)
    new_w = doc.widgets[out["widget"]["id"]]
    parent = doc.widgets[w.id]

    # The saturation binding moved.
    assert any(b.param_key == "saturation" for b in new_w.bindings)
    assert not any(b.param_key == "saturation" for b in parent.bindings)

    # The exposure binding stayed on the parent.
    assert any(b.param_key == "exposure" for b in parent.bindings)
    assert not any(b.param_key == "exposure" for b in new_w.bindings)


def test_detach_removes_anchor_entries_for_detached_node():
    client = _client()
    sid = _session(client)
    w = _fused_2op_widget(sid)

    _call(client, sid, w.id, "n_color")
    doc = deps.get_session_store().get_document(sid)
    parent = doc.widgets[w.id]

    assert parent.compound is not None, "parent should still have compound (light node remains)"
    for anchor in parent.compound.anchors:
        # n_color: prefixed keys must be gone.
        assert not any(k.startswith("n_color:") for k in anchor.values), (
            f"anchor still has n_color keys: {anchor.values}"
        )
        # n_light: prefixed keys must remain.
        assert any(k.startswith("n_light:") for k in anchor.values), (
            f"anchor is missing n_light keys: {anchor.values}"
        )


def test_detach_new_widget_has_no_compound():
    client = _client()
    sid = _session(client)
    w = _fused_2op_widget(sid)

    out = _call(client, sid, w.id, "n_color")
    doc = deps.get_session_store().get_document(sid)
    new_w = doc.widgets[out["widget"]["id"]]
    assert new_w.compound is None
    assert new_w.driver_value is None


# ---------------------------------------------------------------------------
# Compound cleared when all nodes detached (edge: serial detach clears it)
# ---------------------------------------------------------------------------

def test_detach_clears_compound_when_anchors_become_empty():
    """If we build a widget with only ONE compound-eligible op (the other has
    no scalar diffs), detaching the lone compound op empties the anchor tables →
    compound must be cleared."""
    client = _client()
    sid = _session(client)

    # Manually build a 2-node widget where only n_light has anchor entries.
    doc = deps.get_session_store().get_document(sid)
    scope = _make_scope()
    widget_id = "w_sparse"

    node_light = WidgetNode(
        id="n_lx", type="basic", op_id="light",
        params={"exposure": -80.0},
        scope=scope, widget_id=widget_id, layer_id="layer-1",
    )
    node_color = WidgetNode(
        id="n_cx", type="basic", op_id="color",
        params={"saturation": 0.0},
        scope=scope, widget_id=widget_id, layer_id="layer-1",
    )

    compound = OpCompoundConfig(
        driver="__driver",
        label="Mood",
        anchors=[
            CompoundAnchor(position=0.0, name="as shot", values={"n_lx:exposure": 0.0}),
            CompoundAnchor(position=1.0, name="proposed", values={"n_lx:exposure": -80.0}),
        ],
    )
    w = Widget(
        id=widget_id, intent="test", scope=scope,
        origin=WidgetOrigin(kind="mcp_user_prompt"),
        op_id="light", nodes=[node_light, node_color],
        bindings=[], status="active", revision=1,
        compound=compound, driver_value=1.0,
    )
    doc.add_widget(w)

    # Detach the light node — anchors will be empty.
    out = _call(client, sid, widget_id, "n_lx")
    assert "widget" in out
    parent = doc.widgets[widget_id]
    assert parent.compound is None
    assert parent.driver_value is None


# ---------------------------------------------------------------------------
# Driver still works on remaining op after detach
# ---------------------------------------------------------------------------

def test_driver_still_drives_remaining_op_after_detach():
    """After detaching n_color, __driver on the parent should still interpolate
    n_light:exposure between anchor 0 and anchor 1."""
    from app.tools.widgets.set_widget_param import SetWidgetParamTool

    client = _client()
    reg = deps.get_tool_registry()
    if "set_widget_param" not in reg._tools:
        reg.register(SetWidgetParamTool())

    sid = _session(client)
    w = _fused_2op_widget(sid)

    # Detach color.
    _call(client, sid, w.id, "n_color")

    # Drive parent to 0 (baseline).
    set_resp = client.post(
        "/api/tools/set_widget_param",
        json={"session_id": sid, "input": {
            "widget_id": w.id,
            "param_key": "__driver",
            "value": 0.0,
        }},
    ).json()
    assert set_resp.get("ok") is True

    doc = deps.get_session_store().get_document(sid)
    parent = doc.widgets[w.id]
    light_node = next(n for n in parent.nodes if n.id == "n_light")
    assert light_node.params["exposure"] == 0.0

    # Detached color node is untouched.
    new_w_id = next(
        wid for wid, widget in doc.widgets.items()
        if wid != w.id and widget.origin.kind == "fused_expansion"
    )
    new_w = doc.widgets[new_w_id]
    color_node = next(n for n in new_w.nodes if n.id == "n_color")
    assert color_node.params["saturation"] == 30.0  # unchanged


# ---------------------------------------------------------------------------
# Locked params of detached node removed from parent's locked_params
# ---------------------------------------------------------------------------

def test_locked_params_of_detached_node_removed_from_parent():
    client = _client()
    sid = _session(client)
    w = _fused_2op_widget(sid)

    # Mark saturation as locked on the parent.
    doc = deps.get_session_store().get_document(sid)
    doc.widgets[w.id].locked_params = ["exposure", "saturation"]

    _call(client, sid, w.id, "n_color")

    parent = doc.widgets[w.id]
    assert "saturation" not in parent.locked_params
    assert "exposure" in parent.locked_params


# ---------------------------------------------------------------------------
# Pixel stability: canonical params unchanged by detach
# ---------------------------------------------------------------------------

def test_canonical_params_unchanged_after_detach():
    """Detaching a node must not alter any canonical param values."""
    client = _client()
    sid = _session(client)
    w = _fused_2op_widget(sid)

    doc = deps.get_session_store().get_document(sid)
    canon_before_exp = doc.canonical.get("layer-1", {}).get("basic", {}).get("exposure")
    canon_before_sat = doc.canonical.get("layer-1", {}).get("basic", {}).get("saturation")

    _call(client, sid, w.id, "n_color")

    canon_after_exp = doc.canonical.get("layer-1", {}).get("basic", {}).get("exposure")
    canon_after_sat = doc.canonical.get("layer-1", {}).get("basic", {}).get("saturation")

    assert canon_before_exp == canon_after_exp
    assert canon_before_sat == canon_after_sat


# ---------------------------------------------------------------------------
# Guard: single-node widget
# ---------------------------------------------------------------------------

def test_single_node_widget_raises_error():
    """Detaching the only node must return an error, not 500."""
    from tests.tools.widgets.test_fused_compound import (
        _FakeDoc,
        _fused_candidate_widget,
    )
    from app.tools.widgets.fused_compound import synthesize_compound

    client = _client()
    sid = _session(client)
    doc = deps.get_session_store().get_document(sid)

    # Inject a 1-op fused widget.
    w1 = _fused_candidate_widget()
    w1.compound = synthesize_compound(w1, _FakeDoc(), driver_label="Blackness")
    w1.driver_value = 1.0
    doc.add_widget(w1)

    out = _call(client, sid, w1.id, "n_a")
    # The registry wraps handler errors in a top-level error envelope.
    assert "error" in out or out.get("ok") is False, (
        f"Expected error for single-node detach, got: {out}"
    )


# ---------------------------------------------------------------------------
# Guard: non-fused widget
# ---------------------------------------------------------------------------

def test_non_fused_widget_raises_error():
    """detach_widget_op on a widget with no compound block must return an error."""
    from app.schemas.widget import GlobalScope

    client = _client()
    sid = _session(client)
    doc = deps.get_session_store().get_document(sid)

    scope = Scope(root=GlobalScope(kind="global"))
    node_a = WidgetNode(
        id="n_flat_a", type="basic", op_id="light",
        params={"exposure": -20.0},
        scope=scope, widget_id="w_flat", layer_id="layer-1",
    )
    node_b = WidgetNode(
        id="n_flat_b", type="basic", op_id="color",
        params={"saturation": 10.0},
        scope=scope, widget_id="w_flat", layer_id="layer-1",
    )
    w = Widget(
        id="w_flat", intent="flat widget", scope=scope,
        origin=WidgetOrigin(kind="tool_invoked"),
        op_id="light", nodes=[node_a, node_b],
        bindings=[], status="active", revision=1,
        compound=None,
    )
    doc.add_widget(w)

    out = _call(client, sid, "w_flat", "n_flat_a")
    assert "error" in out or out.get("ok") is False, (
        f"Expected error for non-fused detach, got: {out}"
    )


# ---------------------------------------------------------------------------
# Guard: unknown widget
# ---------------------------------------------------------------------------

def test_unknown_widget_returns_error():
    client = _client()
    sid = _session(client)

    out = _call(client, sid, "w_does_not_exist", "n_any")
    assert "error" in out or out.get("ok") is False, (
        f"Expected error for unknown widget, got: {out}"
    )


# ---------------------------------------------------------------------------
# Guard: dismissed widget
# ---------------------------------------------------------------------------

def test_dismissed_widget_returns_error():
    client = _client()
    sid = _session(client)
    w = _fused_2op_widget(sid)

    doc = deps.get_session_store().get_document(sid)
    doc.dismiss_widget(w.id)

    out = _call(client, sid, w.id, "n_color")
    assert "error" in out or out.get("ok") is False, (
        f"Expected error for dismissed widget detach, got: {out}"
    )


# ---------------------------------------------------------------------------
# Guard: node not on widget
# ---------------------------------------------------------------------------

def test_node_not_on_widget_returns_error():
    client = _client()
    sid = _session(client)
    w = _fused_2op_widget(sid)

    out = _call(client, sid, w.id, "n_does_not_exist")
    assert "error" in out or out.get("ok") is False, (
        f"Expected error for bad node_id, got: {out}"
    )
