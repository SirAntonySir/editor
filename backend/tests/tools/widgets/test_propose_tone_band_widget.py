"""Integration test for the tone_band fused templates.

Pins the picker to `tone_green` for the prompt "green tones are not good" and
verifies the resulting widget renders a single-band HSL widget (frontend
detects single-band when `bindings[*].param_key.split('_')[0]` is a single
value, see `HslWidgetBody.tsx`).
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.widgets.propose_widget import ProposeWidgetTool


class _FakeAnthropic:
    def __init__(self):
        self.picked_for: list[str] = []

    def name_pick_fused_tool(self, intent, candidates, session_id=None):
        self.picked_for.append(intent)
        return "tone_green"

    def resolve_fused_tool(self, template_id, prompt_payload, response_schema, session_id=None):
        assert template_id == "tone_green"
        return {
            "values": {"green_hue": -20, "green_sat": -30, "green_lum": 0},
            "reasoning": "image has prominent unbalanced greens",
        }


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
    Image.new("RGB", (16, 16), (50, 100, 50)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    doc = deps.get_session_store().get_document(sid)
    doc.image_context = EnrichedImageContext(
        subjects=[], lighting="flat", dominant_tones=[], mood="calm",
        candidate_regions=[],
        model_name="x", model_version="y", generated_at="2026-06-01T00:00:00Z",
    )
    deps.get_session_store().set_context(sid, doc.image_context.model_dump(mode="json"))
    return sid


def test_tone_green_widget_carries_single_band_bindings(client) -> None:
    sid = _setup_session(client)
    body = client.post(
        "/api/tools/propose_widget",
        json={"session_id": sid, "input": {
            "intent": "green tones are not good",
            "scope": {"kind": "global"},
            "layer_id": "layer_a",
            "origin": "mcp_user_prompt",
        }},
    ).json()
    assert body["ok"] is True, body
    widget = body["output"]["widget"]
    assert widget["op_id"] == "tone_green"
    # Single hsl node carries the three green-band params.
    node_types = [n["type"] for n in widget["nodes"]]
    assert node_types == ["hsl"]
    node_params = widget["nodes"][0]["params"]
    assert set(node_params.keys()) == {"green_hue", "green_sat", "green_lum"}
    # Frontend HslWidgetBody splits on '_' and routes single-band → single-band
    # view; this assertion locks that contract in.
    binding_bands = {b["param_key"].split("_")[0] for b in widget["bindings"]}
    assert binding_bands == {"green"}
