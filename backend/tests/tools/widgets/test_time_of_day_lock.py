"""Time-of-Day lock-aware bundle recompute integration tests. Covers the
snap-back fix (dial drag recomputes the bundle and writes it through binding
+ node + canonical) and the implicit lock-on-edit behaviour (manually editing
a bundle key sticks even if the dial is later dragged).

The bespoke TimeOfDayTemplate has been retired (Task 7); widgets are now
spawned directly from the registry schema so the test focuses on
set_widget_param / unlock_widget_param behaviour only."""
from __future__ import annotations

import uuid
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.api import deps
from app.registry.interpolate import interpolate_1d as _interpolate_1d_generic
from app.registry.loader import get_registry
from app.schemas.enriched_context import EnrichedImageContext
from app.tools.widgets.set_widget_param import SetWidgetParamTool
from app.tools.widgets.unlock_widget_param import UnlockWidgetParamTool


def interpolate_1d(t: float) -> dict:
    """Adapter: call registry interpolate_1d with the TOD op anchors."""
    op = get_registry().ops["time-of-day"]
    return _interpolate_1d_generic(op.compound.anchors, t)  # type: ignore[union-attr]


_BUNDLE_KEYS = [
    "kelvin.kelvin",
    "light.exposure",
    "light.contrast",
    "light.highlights",
    "light.shadows",
    "color.vibrance",
    "hsl.orange_sat",
    "hsl.blue_sat",
    "filters.vignette_amount",
]
_SPAWN_POSITION = 0.30  # noon


@pytest.fixture
def client():
    from app.main import app
    reg = deps.get_tool_registry()
    for tool in (SetWidgetParamTool(), UnlockWidgetParamTool()):
        if tool.name not in reg._tools:
            reg.register(tool)
    yield TestClient(app)


def _session(client: TestClient) -> str:
    buf = BytesIO()
    Image.new("RGB", (16, 16), (50, 50, 100)).save(buf, format="JPEG")
    sid = client.post(
        "/api/session", files={"image": ("a.jpg", buf.getvalue(), "image/jpeg")},
    ).json()["session_id"]
    from app.state.document import DEFAULT_IMAGE_NODE_ID
    doc = deps.get_session_store().get_document(sid)
    ctx = EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[], model_name="x", model_version="y",
        generated_at="2026-05-21T00:00:00Z",
    )
    doc.set_image_context(DEFAULT_IMAGE_NODE_ID, ctx)
    deps.get_session_store().set_context(sid, ctx.model_dump(mode="json"))
    return sid


def _spawn_tod(sid: str) -> str:
    """Build a TOD widget directly from the registry and add it to the doc.
    Bypasses the LLM / fused-template path; this test targets lock behaviour
    in set_widget_param / unlock_widget_param which is independent of spawn."""
    from app.schemas.widget import (
        ControlBinding, ControlSchema, NodeParamTarget,
        Scope, Widget, WidgetNode, WidgetOrigin, WidgetPreview, SliderSchema,
    )

    op = get_registry().ops["time-of-day"]
    assert op.compound is not None

    position = _SPAWN_POSITION
    bundle = interpolate_1d(position)

    wid = f"w_{uuid.uuid4().hex[:8]}"
    nid = f"n_{uuid.uuid4().hex[:6]}"
    scope = Scope.model_validate({"kind": "global"})

    # All params (position + bundle) on one compound node.
    all_params = {"time_of_day.position": position, **bundle}
    node = WidgetNode(
        id=nid, type="compound", params=all_params,
        scope=scope, inputs=[], widget_id=wid, layer_id="layer_a",
    )

    # Build bindings from registry op.bindings so control_schema comes from the
    # same source as the live app.
    bindings: list[ControlBinding] = []
    for b in op.bindings:
        p = op.params[b.param_key]
        lo, hi = p.range if p.range else (0.0, 1.0)
        step = p.step if p.step is not None else 1.0
        value = all_params.get(b.param_key, p.default)
        bindings.append(ControlBinding(
            param_key=b.param_key,
            label=b.label,
            control_type=b.control_type,
            target=NodeParamTarget(node_id=nid, param_key=b.param_key),
            control_schema=ControlSchema(SliderSchema(control_type="slider", min=lo, max=hi, step=step)),
            value=value,
            default=value,
        ))

    widget = Widget(
        id=wid, intent="make it noon", reasoning=None,
        scope=scope,
        origin=WidgetOrigin(kind="mcp_user_prompt", prompt=None),
        op_id="time-of-day", composed=False,
        nodes=[node], bindings=bindings,
        preview=WidgetPreview(kind="thumbnail", auto_before_after=True),
        rejected_attempts=[], status="active", revision=1,
    )

    doc = deps.get_session_store().get_document(sid)
    doc.add_widget(widget)
    return wid


def _set_param(client: TestClient, sid: str, wid: str, key: str, value: float) -> None:
    r = client.post("/api/tools/set_widget_param", json={"session_id": sid, "input": {
        "widget_id": wid, "param_key": key, "value": value,
    }})
    assert r.status_code == 200, r.text


def test_spawn_initialises_empty_locks_and_all_bindings(client) -> None:
    sid = _session(client)
    wid = _spawn_tod(sid)
    doc = deps.get_session_store().get_document(sid)
    w = doc.widgets[wid]

    assert w.locked_params == []
    binding_keys = {b.param_key for b in w.bindings}
    assert binding_keys == {"time_of_day.position", *_BUNDLE_KEYS}


def test_dial_drag_recomputes_bundle_on_node_and_bindings(client) -> None:
    sid = _session(client)
    wid = _spawn_tod(sid)

    _set_param(client, sid, wid, "time_of_day.position", 0.55)

    doc = deps.get_session_store().get_document(sid)
    w = doc.widgets[wid]
    expected = interpolate_1d(0.55)
    compound = next(n for n in w.nodes if n.type == "compound")
    for k in _BUNDLE_KEYS:
        assert compound.params[k] == pytest.approx(expected[k]), f"node param {k}"
        binding = next(b for b in w.bindings if b.param_key == k)
        assert binding.value == pytest.approx(expected[k]), f"binding {k}"


def test_editing_bundle_key_locks_only_that_key(client) -> None:
    sid = _session(client)
    wid = _spawn_tod(sid)

    # Snapshot the bundle at the spawn position so we can prove the other
    # keys aren't touched by the kelvin edit.
    doc = deps.get_session_store().get_document(sid)
    compound = next(n for n in doc.widgets[wid].nodes if n.type == "compound")
    before = {k: compound.params.get(k) for k in _BUNDLE_KEYS if k != "kelvin.kelvin"}

    _set_param(client, sid, wid, "kelvin.kelvin", 5500)

    w = deps.get_session_store().get_document(sid).widgets[wid]
    assert w.locked_params == ["kelvin.kelvin"]
    compound = next(n for n in w.nodes if n.type == "compound")
    assert compound.params["kelvin.kelvin"] == 5500
    kelvin_binding = next(b for b in w.bindings if b.param_key == "kelvin.kelvin")
    assert kelvin_binding.value == 5500
    for k, v in before.items():
        assert compound.params.get(k) == v, f"{k} unexpectedly changed"


def test_locked_key_survives_dial_drag(client) -> None:
    sid = _session(client)
    wid = _spawn_tod(sid)

    _set_param(client, sid, wid, "kelvin.kelvin", 5500)
    _set_param(client, sid, wid, "time_of_day.position", 0.30)

    w = deps.get_session_store().get_document(sid).widgets[wid]
    compound = next(n for n in w.nodes if n.type == "compound")
    expected = interpolate_1d(0.30)

    # kelvin.kelvin honours the lock and stays at 5500…
    assert compound.params["kelvin.kelvin"] == 5500
    kelvin_binding = next(b for b in w.bindings if b.param_key == "kelvin.kelvin")
    assert kelvin_binding.value == 5500
    # …while every other bundle key tracks the new position.
    for k in _BUNDLE_KEYS:
        if k == "kelvin.kelvin":
            continue
        assert compound.params[k] == pytest.approx(expected[k]), f"{k} did not recompute"


def test_unlock_restores_dial_derived_value(client) -> None:
    sid = _session(client)
    wid = _spawn_tod(sid)

    _set_param(client, sid, wid, "kelvin.kelvin", 5500)
    _set_param(client, sid, wid, "time_of_day.position", 0.30)

    r = client.post("/api/tools/unlock_widget_param", json={"session_id": sid, "input": {
        "widget_id": wid, "param_key": "kelvin.kelvin",
    }})
    assert r.status_code == 200, r.text

    w = deps.get_session_store().get_document(sid).widgets[wid]
    assert "kelvin.kelvin" not in w.locked_params
    expected = interpolate_1d(0.30)
    compound = next(n for n in w.nodes if n.type == "compound")
    assert compound.params["kelvin.kelvin"] == pytest.approx(expected["kelvin.kelvin"])
    kelvin_binding = next(b for b in w.bindings if b.param_key == "kelvin.kelvin")
    assert kelvin_binding.value == pytest.approx(expected["kelvin.kelvin"])
    # Canonical reflects the restored value too.
    doc = deps.get_session_store().get_document(sid)
    assert doc.canonical["layer_a"]["compound"]["kelvin.kelvin"] == pytest.approx(
        expected["kelvin.kelvin"],
    )
