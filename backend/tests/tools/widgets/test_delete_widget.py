import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.widgets.delete_widget import DeleteWidgetTool


class _FakeAnthropic:
    def resolve_fused_tool(self, template_id, prompt_payload, response_schema, session_id=None):
        return {"values": {"temperature": 500, "highlight_warmth": 5, "saturation_lift": 2}, "reasoning": ""}

    def name_pick_fused_tool(self, intent, candidates, session_id=None):
        return "warm_grade"


@pytest.fixture
def client():
    from app.main import app
    _prev = deps._anthropic_client
    deps._anthropic_client = _FakeAnthropic()
    reg = deps.get_tool_registry()
    if "delete_widget" not in reg._tools:
        reg.register(DeleteWidgetTool())
    try:
        yield TestClient(app)
    finally:
        deps._anthropic_client = _prev


def _setup(client) -> tuple[str, str]:
    from io import BytesIO
    from PIL import Image
    from app.schemas.enriched_context import EnrichedImageContext
    buf = BytesIO()
    Image.new("RGB", (16, 16)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    doc = deps.get_session_store().get_document(sid)
    doc.image_context = EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z",
    )
    deps.get_session_store().set_context(sid, doc.image_context.model_dump(mode="json"))
    proposed = client.post(
        "/api/tools/propose_widget",
        json={"session_id": sid, "input": {
            "intent": "warmer", "scope": {"kind": "global"}, "fused_tool_id": "warm_grade",
        }},
    ).json()
    return sid, proposed["output"]["widget"]["id"]


def _push_widget(sid: str) -> str:
    """Directly inject a widget with a WidgetNode so op-graph assertions are reliable."""
    from app.schemas.widget import (
        GlobalScope,
        Scope,
        Widget,
        WidgetNode,
        WidgetOrigin,
        WidgetPreview,
    )
    doc = deps.get_session_store().get_document(sid)
    wn = WidgetNode(
        id="node_delete_test",
        type="kelvin",
        scope=Scope(root=GlobalScope(kind="global")),
        params={"temperature": 5800},
        widget_id="w_delete_test",
        layer_id="layer_01",
    )
    w = Widget(
        id="w_delete_test",
        intent="make it warmer",
        scope=Scope(root=GlobalScope(kind="global")),
        origin=WidgetOrigin(kind="mcp_autonomous"),
        preview=WidgetPreview(kind="none"),
        nodes=[wn],
    )
    doc.add_widget(w)
    return w.id


def _create_session(client: TestClient) -> str:
    from io import BytesIO
    from PIL import Image
    buf = BytesIO()
    Image.new("RGB", (16, 16)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    return client.post("/api/session", files=files).json()["session_id"]


# ── pre-existing tests (unchanged contract) ──────────────────────────────────

def test_delete_with_suppress_dismisses_and_adds_rule(client) -> None:
    sid, wid = _setup(client)
    body = client.post(
        "/api/tools/delete_widget",
        json={"session_id": sid, "input": {"widget_id": wid, "suppress_similar": True}},
    ).json()
    assert body["ok"] is True
    doc = deps.get_session_store().get_document(sid)
    assert doc.widgets[wid].status == "dismissed"
    assert len(doc.dismissals) == 1
    assert doc.dismissals[0].source_widget_id == wid


def test_delete_without_suppress_dismisses_no_rule(client) -> None:
    sid, wid = _setup(client)
    body = client.post(
        "/api/tools/delete_widget",
        json={"session_id": sid, "input": {"widget_id": wid, "suppress_similar": False}},
    ).json()
    assert body["ok"] is True
    doc = deps.get_session_store().get_document(sid)
    assert doc.widgets[wid].status == "dismissed"
    assert doc.dismissals == []


# ── T19 tests: SSoT contract ─────────────────────────────────────────────────

def test_delete_widget_flips_status_to_dismissed(client) -> None:
    """delete_widget MUST flip widget.status to 'dismissed' and keep it in doc.widgets."""
    sid = _create_session(client)
    wid = _push_widget(sid)

    doc = deps.get_session_store().get_document(sid)
    assert doc.widgets[wid].status == "active"

    body = client.post(
        "/api/tools/delete_widget",
        json={"session_id": sid, "input": {"widget_id": wid, "suppress_similar": False}},
    ).json()
    assert body["ok"] is True

    assert wid in doc.widgets, "delete_widget must NOT remove widget from doc.widgets"
    assert wid in doc.widget_order, "delete_widget must NOT remove widget from doc.widget_order"
    assert doc.widgets[wid].status == "dismissed", (
        "delete_widget must flip widget.status to 'dismissed'"
    )


def test_delete_widget_resets_owned_canonical_params(client) -> None:
    """delete_widget IS the 'close (×)' action (Q2: 'close → value resets').
    It resets the canonical params the widget owns and prunes the now-empty
    slot, so the owned node disappears from the op_graph projection. (accept,
    by contrast, keeps canonical — see test_accept_widget.)"""
    from app.state.operations import project_to_graph

    sid = _create_session(client)
    wid = _push_widget(sid)  # node: layer_01 / kelvin / temperature=5800

    doc = deps.get_session_store().get_document(sid)
    canon_node_id = "canon:layer_01:kelvin"
    graph_before = project_to_graph(doc)
    assert any(n.id == canon_node_id for n in graph_before.nodes), (
        "test prerequisite: canonical node must be in op_graph before delete"
    )

    client.post(
        "/api/tools/delete_widget",
        json={"session_id": sid, "input": {"widget_id": wid, "suppress_similar": False}},
    )

    # Widget is dismissed AND its owned canonical params are reset → node gone.
    graph_after = project_to_graph(doc)
    assert not any(n.id == canon_node_id for n in graph_after.nodes), (
        "delete_widget (close) must reset the widget's owned canonical params"
    )


def test_delete_widget_emits_widget_deleted_event(client) -> None:
    """delete_widget MUST emit a 'widget.deleted' history event."""
    sid = _create_session(client)
    wid = _push_widget(sid)

    doc = deps.get_session_store().get_document(sid)

    body = client.post(
        "/api/tools/delete_widget",
        json={"session_id": sid, "input": {"widget_id": wid, "suppress_similar": False}},
    ).json()
    assert body["ok"] is True

    event_kinds = [ev.kind for ev in doc.history]
    assert "widget.deleted" in event_kinds, (
        f"delete_widget must emit 'widget.deleted' event. Got: {event_kinds}"
    )
