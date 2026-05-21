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


@pytest.fixture
def client():
    from app.main import app

    _prev = deps._anthropic_client
    deps._anthropic_client = _FakeClaude()
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
