import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.atomic.analyze_image import AnalyzeImageTool


class _FakeClaude:
    def analyze_image(self, image_bytes, mime_type, session_id=None):
        from app.schemas.image_context import ImageContext

        return ImageContext(
            subjects=["person"],
            lighting="flat",
            dominant_tones=["midtones"],
            mood="calm",
            candidate_regions=[],
            model_name="fake",
            model_version="0",
            generated_at="2026-05-21T00:00:00Z",
        )


class _FakeClaudeFull(_FakeClaude):
    def augment_context_soft_fields(self, image_bytes, mime_type, base_context_json, cheap_pass_summary, session_id=None):
        from app.services.anthropic_client import _ContextSoftFields
        from app.schemas.enriched_context import Problem
        return _ContextSoftFields(
            estimated_white_point=(255, 255, 255),
            wb_neutral_confidence=0.5,
            grade_character="neutral",
            problems=[Problem(kind="low_contrast", severity=0.6, suggested_fused_tools=["exposure_balance"])],
            region_soft_fields=[],
        )


@pytest.fixture
def client():
    from app.main import app

    _prev = deps._anthropic_client
    deps._anthropic_client = _FakeClaudeFull()
    reg = deps.get_tool_registry()
    if "analyze_image" not in reg._tools:
        reg.register(AnalyzeImageTool())
    try:
        yield TestClient(app)
    finally:
        deps._anthropic_client = _prev


def test_analyze_image_runs_and_caches(client) -> None:
    from io import BytesIO

    from PIL import Image

    buf = BytesIO()
    Image.new("RGB", (8, 8), (50, 80, 100)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    body = client.post(
        "/api/tools/analyze_image",
        json={"session_id": sid, "input": {}},
    ).json()
    assert body["ok"] is True
    assert body["output"]["mood"] == "calm"
    body2 = client.post(
        "/api/tools/analyze_image",
        json={"session_id": sid, "input": {}},
    ).json()
    assert body2["output"]["mood"] == "calm"


def test_analyze_image_syncs_record_context(client) -> None:
    from io import BytesIO

    from PIL import Image

    buf = BytesIO()
    Image.new("RGB", (8, 8), (50, 80, 100)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    client.post("/api/tools/analyze_image", json={"session_id": sid, "input": {}})
    record = deps.get_session_store().get(sid)
    assert record.context is not None
    assert record.context["mood"] == "calm"


def test_analyze_image_fills_cheap_pass_and_soft_fields(client) -> None:
    from app.schemas.enriched_context import EnrichedImageContext
    from io import BytesIO

    from PIL import Image

    buf = BytesIO()
    Image.new("RGB", (32, 32), (128, 128, 128)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    body = client.post(
        "/api/tools/analyze_image",
        json={"session_id": sid, "input": {}},
    ).json()
    assert body["ok"] is True
    ctx = body["output"]
    assert ctx["grade_character"] == "neutral"
    assert ctx["clipped_shadows_pct"] == 0.0
    assert any(p["kind"] == "low_contrast" for p in ctx["problems"])
    doc = deps.get_session_store().get_document(sid)
    assert isinstance(doc.image_context, EnrichedImageContext)
