import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.widgets.refine_widget import RefineWidgetTool


class _FakeAnthropic:
    def resolve_fused_tool(self, template_id, prompt_payload, response_schema, session_id=None):
        return {"values": {"temperature": 600, "highlight_warmth": 8, "saturation_lift": 3}, "reasoning": ""}
    def name_pick_fused_tool(self, intent, candidates, session_id=None):
        return "warm_grade"
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
    from io import BytesIO
    from PIL import Image
    from app.schemas.enriched_context import EnrichedImageContext
    buf = BytesIO(); Image.new("RGB", (16, 16)).save(buf, format="JPEG")
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


def test_refine_removes_a_binding(client) -> None:
    sid, wid = _setup(client)
    body = client.post(
        "/api/tools/refine_widget",
        json={"session_id": sid, "input": {
            "widget_id": wid,
            "edits": [{"param_key": "saturation_lift", "action": "remove"}],
            "additions": [],
        }},
    ).json()
    assert body["ok"] is True
    keys = [b["param_key"] for b in body["output"]["widget"]["bindings"]]
    assert "saturation_lift" not in keys
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
    keys = [b["param_key"] for b in body["output"]["widget"]["bindings"]]
    assert "skin_protect" in keys
