"""Time-of-Day lock-aware bundle recompute integration tests. Covers the
snap-back fix (dial drag recomputes the bundle and writes it through binding
+ node + canonical) and the implicit lock-on-edit behaviour (manually editing
a bundle key sticks even if the dial is later dragged)."""
from __future__ import annotations

from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.api import deps
from app.schemas.enriched_context import EnrichedImageContext
from app.tools.fused._time_of_day_data import interpolate_1d
from app.tools.widgets.set_widget_param import SetWidgetParamTool
from app.tools.widgets.unlock_widget_param import UnlockWidgetParamTool


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
_SPAWN_POSITION = 0.30  # noon — what the fake LLM emits below


class _FakeAnthropic:
    """Pins the picker to `time-of-day` and emits a fixed position so the
    spawn-time bundle is deterministic. The template's own `resolve` adds the
    `interpolate_1d(position)` bundle on top."""

    def name_pick_fused_tool(self, intent, candidates, session_id=None):
        return "time-of-day"

    def resolve_fused_tool(self, template_id, prompt_payload, response_schema, session_id=None):
        assert template_id == "time-of-day"
        return {"values": {"time_of_day.position": _SPAWN_POSITION}}


@pytest.fixture
def fake_anthropic():
    return _FakeAnthropic()


@pytest.fixture
def client(fake_anthropic):
    from app.main import app
    _prev = deps._anthropic_client
    deps._anthropic_client = fake_anthropic
    reg = deps.get_tool_registry()
    for tool in (SetWidgetParamTool(), UnlockWidgetParamTool()):
        if tool.name not in reg._tools:
            reg.register(tool)
    try:
        yield TestClient(app)
    finally:
        deps._anthropic_client = _prev


def _session(client: TestClient) -> str:
    buf = BytesIO()
    Image.new("RGB", (16, 16), (50, 50, 100)).save(buf, format="JPEG")
    sid = client.post(
        "/api/session", files={"image": ("a.jpg", buf.getvalue(), "image/jpeg")},
    ).json()["session_id"]
    doc = deps.get_session_store().get_document(sid)
    doc.image_context = EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[], model_name="x", model_version="y",
        generated_at="2026-05-21T00:00:00Z",
    )
    deps.get_session_store().set_context(sid, doc.image_context.model_dump(mode="json"))
    return sid


async def _spawn_tod_direct(sid: str) -> str:
    """Spawn a time-of-day compound widget directly via the fused framework,
    bypassing the HTTP layer. propose_widget is now filter-only; this test
    targets set_widget_param lock behavior which is independent of the spawn path."""
    import asyncio
    from app.schemas.widget import Scope, WidgetOrigin
    from app.tools.fused import all_fused_templates
    from app.tools.fused_framework import run_fused_tool
    from app.schemas.enriched_context import EnrichedImageContext

    doc = deps.get_session_store().get_document(sid)
    templates = {t.id: t for t in all_fused_templates()}
    template = templates["time-of-day"]
    scope = Scope.model_validate({"kind": "global"})
    ctx = doc.image_context
    anthropic = deps.get_anthropic_client()
    origin = WidgetOrigin(kind="mcp_user_prompt", prompt=None)
    widget = await run_fused_tool(
        template, intent="make it noon",
        scope=scope, ctx=ctx, prior=None, instruction=None,
        anthropic=anthropic, origin=origin,
    )
    for node in widget.nodes:
        node.layer_id = "layer_a"
    doc.add_widget(widget)
    return widget.id


def _spawn_tod(client: TestClient, sid: str) -> str:
    import asyncio
    return asyncio.get_event_loop().run_until_complete(_spawn_tod_direct(sid))


def _set_param(client: TestClient, sid: str, wid: str, key: str, value: float) -> None:
    r = client.post("/api/tools/set_widget_param", json={"session_id": sid, "input": {
        "widget_id": wid, "param_key": key, "value": value,
    }})
    assert r.status_code == 200, r.text


def test_spawn_initialises_empty_locks_and_all_bindings(client) -> None:
    sid = _session(client)
    wid = _spawn_tod(client, sid)
    doc = deps.get_session_store().get_document(sid)
    w = doc.widgets[wid]

    assert w.locked_params == []
    binding_keys = {b.param_key for b in w.bindings}
    assert binding_keys == {"time_of_day.position", *_BUNDLE_KEYS}


def test_dial_drag_recomputes_bundle_on_node_and_bindings(client) -> None:
    sid = _session(client)
    wid = _spawn_tod(client, sid)

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
    wid = _spawn_tod(client, sid)

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
    wid = _spawn_tod(client, sid)

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
    wid = _spawn_tod(client, sid)

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
