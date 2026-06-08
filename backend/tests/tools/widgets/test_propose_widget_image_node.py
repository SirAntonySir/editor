"""T18 — propose_widget must accept ImageNodeScope and stamp layer_ids."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.widgets.propose_widget import ProposeWidgetTool


class _FakeAnthropic:
    """Minimal fake matching what propose_widget's LLM path expects."""

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


def test_tool_invoked_image_node_stamps_layer_ids(client, fake_anthropic) -> None:
    """tool_invoked + image_node scope populates layer_ids on every node and
    sets layer_id to the first scope layer."""
    sid = _setup_session(client)
    fake_anthropic._call_count = 0
    body = client.post(
        "/api/tools/propose_widget",
        json={"session_id": sid, "input": {
            "intent": "Light",
            "scope": {
                "kind": "image_node",
                "image_node_id": "in-1",
                "layer_ids": ["l-1", "l-2"],
            },
            "layer_id": "fallback_layer",
            "origin": "tool_invoked",
            "op_id": "light",
        }},
    ).json()
    assert body["ok"] is True
    # LLM is NOT called on the tool_invoked path.
    assert fake_anthropic._call_count == 0
    widget = body["output"]["widget"]
    assert widget["nodes"], "test prerequisite: widget should have at least one node"
    for node in widget["nodes"]:
        assert node["layer_ids"] == ["l-1", "l-2"]
        # First scope layer wins for the legacy single-layer attribution.
        assert node["layer_id"] == "l-1"


def test_llm_path_image_node_stamps_layer_ids(client) -> None:
    """LLM path + image_node scope propagates layer_ids onto every node."""
    sid = _setup_session(client)
    body = client.post(
        "/api/tools/propose_widget",
        json={"session_id": sid, "input": {
            "intent": "warmer",
            "scope": {
                "kind": "image_node",
                "image_node_id": "in-1",
                "layer_ids": ["la", "lb", "lc"],
            },
            "op_id": "warm_grade",
            "layer_id": "fallback_layer",
            "origin": "mcp_user_prompt",
        }},
    ).json()
    assert body["ok"] is True
    widget = body["output"]["widget"]
    assert widget["nodes"], "test prerequisite: widget should have at least one node"
    for node in widget["nodes"]:
        assert node["layer_ids"] == ["la", "lb", "lc"]
        # First scope layer wins.
        assert node["layer_id"] == "la"


def test_tool_invoked_image_node_empty_layer_ids_uses_input_fallback(client) -> None:
    """Empty image_node.layer_ids → layer_ids=[] and layer_id falls back to input.layer_id."""
    sid = _setup_session(client)
    body = client.post(
        "/api/tools/propose_widget",
        json={"session_id": sid, "input": {
            "intent": "Light",
            "scope": {
                "kind": "image_node",
                "image_node_id": "in-empty",
                "layer_ids": [],
            },
            "layer_id": "fallback_layer",
            "origin": "tool_invoked",
            "op_id": "light",
        }},
    ).json()
    assert body["ok"] is True
    widget = body["output"]["widget"]
    assert widget["nodes"]
    for node in widget["nodes"]:
        assert node["layer_ids"] == []
        # When scope has no layers, fall back to input.layer_id.
        assert node["layer_id"] == "fallback_layer"


def test_global_scope_leaves_layer_ids_none(client) -> None:
    """Non-image_node scopes must NOT set layer_ids (stays None)."""
    sid = _setup_session(client)
    body = client.post(
        "/api/tools/propose_widget",
        json={"session_id": sid, "input": {
            "intent": "Light",
            "scope": {"kind": "global"},
            "layer_id": "layer_a",
            "origin": "tool_invoked",
            "op_id": "light",
        }},
    ).json()
    assert body["ok"] is True
    widget = body["output"]["widget"]
    assert widget["nodes"]
    for node in widget["nodes"]:
        assert node["layer_ids"] is None
        assert node["layer_id"] == "layer_a"
