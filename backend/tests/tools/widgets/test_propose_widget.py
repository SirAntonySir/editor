import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.widgets.propose_widget import ProposeWidgetTool


class _FakeAnthropic:
    def resolve_fused_tool(self, template_id, prompt_payload, response_schema, session_id=None):
        return {
            "values": {"temperature": 600, "highlight_warmth": 8, "saturation_lift": 3},
            "reasoning": "image is cool",
        }
    def name_pick_fused_tool(self, intent, candidates, session_id=None):
        return "warm_grade"


@pytest.fixture
def client():
    from app.main import app
    _prev = deps._anthropic_client
    deps._anthropic_client = _FakeAnthropic()
    reg = deps.get_tool_registry()
    if "propose_widget" not in reg._tools:
        reg.register(ProposeWidgetTool())
    try:
        yield TestClient(app)
    finally:
        deps._anthropic_client = _prev


def _setup_session(client) -> str:
    from io import BytesIO
    from PIL import Image
    from app.schemas.enriched_context import EnrichedImageContext
    buf = BytesIO(); Image.new("RGB", (16, 16), (50, 50, 100)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    doc = deps.get_session_store().get_document(sid)
    doc.image_context = EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z",
    )
    # propose_widget requires_context=True, which checks SessionRecord.context.
    # Bridge it manually since this test doesn't call analyze_image.
    deps.get_session_store().set_context(sid, doc.image_context.model_dump(mode="json"))
    return sid


def test_propose_widget_with_explicit_fused_id(client) -> None:
    sid = _setup_session(client)
    body = client.post(
        "/api/tools/propose_widget",
        json={"session_id": sid, "input": {
            "intent": "warmer",
            "scope": {"kind": "global"},
            "fused_tool_id": "warm_grade",  # backwards-compat alias
        }},
    ).json()
    assert body["ok"] is True
    w = body["output"]["widget"]
    assert w["op_id"] == "warm_grade"
    binding_keys = [b["param_key"] for b in w["bindings"]]
    assert "temperature" in binding_keys


def test_propose_widget_with_no_fused_id_uses_name_pick(client) -> None:
    sid = _setup_session(client)
    body = client.post(
        "/api/tools/propose_widget",
        json={"session_id": sid, "input": {
            "intent": "warm subject",
            "scope": {"kind": "global"},
        }},
    ).json()
    assert body["ok"] is True
    assert body["output"]["widget"]["op_id"] == "warm_grade"


def test_propose_widget_unknown_fused_id_returns_envelope_error(client) -> None:
    sid = _setup_session(client)
    body = client.post(
        "/api/tools/propose_widget",
        json={"session_id": sid, "input": {
            "intent": "warmer",
            "scope": {"kind": "global"},
            "fused_tool_id": "nope",  # backwards-compat alias
        }},
    ).json()
    assert body["ok"] is False
    assert body["error"]["code"] == "fused_tool_not_found"
