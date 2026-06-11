import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.widgets.repeat_widget import RepeatWidgetTool


_call_counter = {"n": 0}


class _FakeAnthropic:
    """Deterministic fake: first resolve call → temperature=400, second → 800."""
    def resolve_fused_tool(self, template_id, prompt_payload, response_schema, session_id=None):
        _call_counter["n"] += 1
        return {
            "values": {"temperature": 400 if _call_counter["n"] == 1 else 800,
                       "highlight_warmth": 6, "saturation_lift": 2},
            "reasoning": "",
        }


@pytest.fixture
def client():
    from app.main import app
    _call_counter["n"] = 0
    _prev = deps._anthropic_client
    deps._anthropic_client = _FakeAnthropic()
    reg = deps.get_tool_registry()
    if "repeat_widget" not in reg._tools:
        reg.register(RepeatWidgetTool())
    try:
        yield TestClient(app)
    finally:
        deps._anthropic_client = _prev


def _setup(client) -> tuple[str, str]:
    """Spawn a warm_grade fused widget directly via run_fused_tool.
    propose_widget is now filter-only; repeat_widget is fused-template-only,
    so we use the fused framework directly for the test fixture."""
    import asyncio
    from io import BytesIO
    from PIL import Image
    from app.schemas.enriched_context import EnrichedImageContext
    from app.schemas.widget import Scope, WidgetOrigin
    from app.tools.fused import all_fused_templates
    from app.tools.fused_framework import run_fused_tool

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

    templates = {t.id: t for t in all_fused_templates()}
    template = templates["warm_grade"]
    scope = Scope.model_validate({"kind": "global"})
    origin = WidgetOrigin(kind="mcp_user_prompt", prompt=None)
    anthropic = deps.get_anthropic_client()
    widget = asyncio.get_event_loop().run_until_complete(
        run_fused_tool(template, intent="warmer", scope=scope, ctx=doc.image_context,
                       prior=None, instruction=None, anthropic=anthropic, origin=origin)
    )
    doc.add_widget(widget)
    return sid, widget.id


def test_repeat_re_rolls_and_logs_rejection(client) -> None:
    sid, wid = _setup(client)
    body = client.post(
        "/api/tools/repeat_widget",
        json={"session_id": sid, "input": {"widget_id": wid}},
    ).json()
    assert body["ok"] is True
    w = body["output"]["widget"]
    temp = next(b for b in w["bindings"] if b["paramKey"] == "temperature")
    assert temp["value"] == 800
    doc = deps.get_session_store().get_document(sid)
    assert len(doc.widgets[wid].rejected_attempts) == 1


def test_repeat_rejects_composed_widget(client) -> None:
    sid, wid = _setup(client)
    doc = deps.get_session_store().get_document(sid)
    doc.widgets[wid].composed = True
    body = client.post(
        "/api/tools/repeat_widget",
        json={"session_id": sid, "input": {"widget_id": wid}},
    ).json()
    assert body["ok"] is False
    assert body["error"]["code"] == "invalid_input"
