from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api import deps
from app.api.deps import get_anthropic_client, get_sam_client
from app.schemas.image_context import ImageContext


@pytest.fixture
def client_with_fake_anthropic() -> TestClient:
    fake_anthropic = MagicMock()
    fake_anthropic.analyze_image.return_value = ImageContext.model_validate({
        "subjects": ["person"],
        "lighting": "backlit",
        "dominant_tones": ["shadows"],
        "mood": "calm",
        "candidate_regions": [],
        "model_name": "claude-opus-4-7",
        "model_version": "2026-01",
        "generated_at": "2026-05-11T10:00:00Z",
    })
    fake_sam = MagicMock()
    fake_sam.model_name = "vit_b"

    app.dependency_overrides[get_anthropic_client] = lambda: fake_anthropic
    app.dependency_overrides[get_sam_client] = lambda: fake_sam
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def test_analyze_returns_context(client_with_fake_anthropic: TestClient) -> None:
    client = client_with_fake_anthropic
    image_path = Path(__file__).parent / "fixtures" / "test_image.jpg"
    with image_path.open("rb") as fh:
        create = client.post("/api/session", files={"image": ("t.jpg", fh, "image/jpeg")})
    sid = create.json()["session_id"]
    response = client.post("/api/analyze", json={"session_id": sid})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["lighting"] == "backlit"


def test_analyze_unknown_session_404(client_with_fake_anthropic: TestClient) -> None:
    client = client_with_fake_anthropic
    response = client.post("/api/analyze", json={"session_id": "nope"})
    assert response.status_code == 404


def test_analyze_bundles_region_masks(tmp_path):
    """When Claude returns regions with representative points, the analyze
    handler runs SAM at each point and bundles the mask into the response."""
    import base64
    import io

    import numpy as np
    from PIL import Image

    from app.api.deps import get_anthropic_client, get_sam_client, get_session_store
    from app.schemas.image_context import CandidateRegion, ImageContext
    from app.services.session_store import SessionStore

    img = Image.new("RGB", (8, 8), color=(0, 128, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    store = SessionStore(ttl_seconds=3600)
    sid = store.create(image_bytes=buf.getvalue(), mime_type="image/png")

    anthropic = MagicMock()
    anthropic.analyze_image.return_value = ImageContext(
        subjects=["plant"],
        lighting="flat",
        dominant_tones=["midtones"],
        mood="calm",
        candidate_regions=[
            CandidateRegion(
                label="plant",
                description="leafy plant in centre",
                representative_point=[4.0, 4.0],
            ),
        ],
        model_name="claude",
        model_version="test",
        generated_at="2025-01-01T00:00:00Z",
    )

    sam = MagicMock()
    sam.decode_point.return_value = np.ones((8, 8), dtype=bool)
    sam.model_name = "vit_b"

    app.dependency_overrides[get_session_store] = lambda: store
    app.dependency_overrides[get_anthropic_client] = lambda: anthropic
    app.dependency_overrides[get_sam_client] = lambda: sam

    try:
        with TestClient(app) as client:
            res = client.post("/api/analyze", json={"session_id": sid})
            assert res.status_code == 200
            body = res.json()
            assert len(body["candidate_regions"]) == 1
            region = body["candidate_regions"][0]
            assert region["mask"] is not None
            assert region["mask"]["width"] == 8
            assert region["mask"]["height"] == 8
            raw = base64.b64decode(region["mask"]["png_base64"])
            assert raw[:8] == b"\x89PNG\r\n\x1a\n"
        sam.embed.assert_called_once()
        sam.decode_point.assert_called_once()
    finally:
        app.dependency_overrides.clear()
