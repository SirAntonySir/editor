import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.widgets.refine_widget import RefineWidgetTool


class _FakeAnthropic:
    def flesh_out_binding(self, request, widget, response_schema=None, session_id=None):
        return {
            "binding": {
                "param_key": "skin_protect",
                "label": "Skin protect",
                "control_type": "toggle",
                "target": {"node_id": "n_extra", "param_key": "skin_protect"},
                "control_schema": {"control_type": "toggle", "on_label": "Protect", "off_label": "Off"},
                "value": True,
                "default": True,
            },
            "additional_nodes": [
                {"type": "basic", "params": {"skin_protect": True}, "scope": {"kind": "global"}},
            ],
        }


@pytest.fixture
def client():
    from app.main import app
    _prev = deps._anthropic_client
    deps._anthropic_client = _FakeAnthropic()
    reg = deps.get_tool_registry()
    if "refine_widget" not in reg._tools:
        reg.register(RefineWidgetTool())
    try:
        yield TestClient(app)
    finally:
        deps._anthropic_client = _prev


def _setup(client) -> tuple[str, str]:
    """Spawn a warm_grade preset widget (kelvin + light + color) via propose_stack.
    Context is required by refine_widget (requires_context=True permission)."""
    from io import BytesIO
    from PIL import Image
    from app.schemas.enriched_context import EnrichedImageContext
    from app.tools.widgets.propose_stack import ProposeStackTool
    buf = BytesIO(); Image.new("RGB", (16, 16)).save(buf, format="JPEG")
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
    proposed = client.post(
        "/api/tools/propose_stack",
        json={"session_id": sid, "input": {
            "intent": "warmer", "scope": {"kind": "global"},
            "preset_id": "warm_grade", "origin": "mcp_user_prompt",
        }},
    ).json()
    # Use the first widget (kelvin) as the target for refine tests
    return sid, proposed["output"]["widgets"][0]["id"]


def test_refine_removes_a_binding(client) -> None:
    """Remove the kelvin binding from a warm_grade kelvin widget."""
    sid, wid = _setup(client)
    doc = deps.get_session_store().get_document(sid)
    w = doc.widgets[wid]
    first_key = w.bindings[0].param_key if w.bindings else "kelvin"
    body = client.post(
        "/api/tools/refine_widget",
        json={"session_id": sid, "input": {
            "widget_id": wid,
            "edits": [{"param_key": first_key, "action": "remove"}],
            "additions": [],
        }},
    ).json()
    assert body["ok"] is True
    keys = [b["paramKey"] for b in body["output"]["widget"]["bindings"]]
    assert first_key not in keys
    assert body["output"]["widget"]["composed"] is True


def test_refine_adds_a_binding(client) -> None:
    sid, wid = _setup(client)
    body = client.post(
        "/api/tools/refine_widget",
        json={"session_id": sid, "input": {
            "widget_id": wid,
            "edits": [],
            "additions": [{"request": "add a skin-protect toggle"}],
        }},
    ).json()
    assert body["ok"] is True
    keys = [b["paramKey"] for b in body["output"]["widget"]["bindings"]]
    assert "skin_protect" in keys


def test_refine_preserves_layer_id_on_appended_nodes(client) -> None:
    """Composition refine appends LLM-fleshed nodes. Those nodes don't carry
    layer anchoring info, so without explicit stamping they end up with the
    WidgetNode default ("legacy") and the frontend's tether snaps the widget
    away from its current image. Regression guard."""
    sid, wid = _setup(client)
    doc = deps.get_session_store().get_document(sid)
    w = doc.widgets[wid]
    prior_layer_id = w.nodes[0].layer_id
    body = client.post(
        "/api/tools/refine_widget",
        json={"session_id": sid, "input": {
            "widget_id": wid,
            "edits": [],
            "additions": [{"request": "add a skin-protect toggle"}],
        }},
    ).json()
    assert body["ok"] is True
    out_nodes = body["output"]["widget"]["nodes"]
    # Every node — original + newly fleshed — must share the same anchor.
    for n in out_nodes:
        assert n["layerId"] == prior_layer_id, (
            f"node {n['id']!r} has layer_id={n['layerId']!r}, expected {prior_layer_id!r}"
        )
