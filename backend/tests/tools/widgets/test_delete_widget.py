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
