"""TDD tests for propose_widget layer_id + origin extensions (T17)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.widgets.propose_widget import ProposeWidgetTool


class _FakeAnthropic:
    def __init__(self):
        self._call_count = 0

    def resolve_fused_tool(self, template_id, prompt_payload, response_schema, session_id=None):
        self._call_count += 1
        return {
            "values": {"temperature": 600, "highlight_warmth": 8, "saturation_lift": 3},
            "reasoning": "image is cool",
        }

    def name_pick_fused_tool(self, intent, candidates, session_id=None):
        self._call_count += 1
        return "warm_grade"

    @property
    def messages(self):
        return self

    @property
    def create(self):
        return self._call_count > 0

    def reset_mock(self):
        self._call_count = 0


@pytest.fixture
def fake_anthropic():
    return _FakeAnthropic()


@pytest.fixture
def client(fake_anthropic):
    from app.main import app
    _prev = deps._anthropic_client
    deps._anthropic_client = fake_anthropic
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
    buf = BytesIO()
    Image.new("RGB", (16, 16), (50, 50, 100)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    doc = deps.get_session_store().get_document(sid)
    doc.image_context = EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-05-21T00:00:00Z",
    )
    deps.get_session_store().set_context(sid, doc.image_context.model_dump(mode="json"))
    return sid


def test_propose_widget_accepts_layer_id_and_origin(client) -> None:
    """propose_widget input now accepts layer_id + origin."""
    sid = _setup_session(client)
    body = client.post(
        "/api/tools/propose_widget",
        json={"session_id": sid, "input": {
            "intent": "Brighten",
            "scope": {"kind": "global"},
            "op_id": "warm_grade",
            "layer_id": "layer_a",
            "origin": "mcp_user_prompt",
        }},
    ).json()
    assert body["ok"] is True
    widget = body["output"]["widget"]
    # All nodes carry the supplied layer_id
    assert all(node["layer_id"] == "layer_a" for node in widget["nodes"])


def test_propose_widget_tool_invoked_skips_llm(client, fake_anthropic) -> None:
    """origin='tool_invoked' bypasses the Anthropic LLM call entirely."""
    sid = _setup_session(client)
    fake_anthropic.reset_mock()
    body = client.post(
        "/api/tools/propose_widget",
        json={"session_id": sid, "input": {
            "intent": "Curves",
            "scope": {"kind": "global"},
            "layer_id": "layer_a",
            "origin": "tool_invoked",
            "op_id": "curves",
        }},
    ).json()
    assert body["ok"] is True
    # Anthropic was never called (call_count is still 0)
    assert fake_anthropic._call_count == 0
    widget = body["output"]["widget"]
    assert widget["origin"]["kind"] == "tool_invoked"
    # Tool-invoked widgets spawn as an editable shell on the canvas. The user
    # tunes sliders, then commits via Apply (accept_widget). So a freshly
    # minted tool_invoked widget is "active", not pre-accepted.
    assert widget["status"] == "active"


def test_propose_widget_tool_invoked_unknown_tool_errors(client) -> None:
    """Unknown op_id raises a tool error when origin=tool_invoked."""
    sid = _setup_session(client)
    body = client.post(
        "/api/tools/propose_widget",
        json={"session_id": sid, "input": {
            "intent": "Garbage",
            "scope": {"kind": "global"},
            "layer_id": "layer_a",
            "origin": "tool_invoked",
            "op_id": "nonexistent_tool",
        }},
    ).json()
    assert body["ok"] is False
    assert body["error"]["code"] in ("unknown_tool", "validation_error", "invalid_input", "fused_tool_not_found")


def test_propose_widget_tool_invoked_nodes_have_correct_layer_id(client) -> None:
    """All nodes in a tool_invoked widget carry the supplied layer_id."""
    sid = _setup_session(client)
    body = client.post(
        "/api/tools/propose_widget",
        json={"session_id": sid, "input": {
            "intent": "Light",
            "scope": {"kind": "global"},
            "layer_id": "layer_xyz",
            "origin": "tool_invoked",
            "op_id": "light",
        }},
    ).json()
    assert body["ok"] is True
    widget = body["output"]["widget"]
    assert all(node["layer_id"] == "layer_xyz" for node in widget["nodes"])
