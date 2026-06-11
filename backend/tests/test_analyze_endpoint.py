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


def test_analyze_bundles_region_paths(tmp_path, monkeypatch):
    """When Claude returns regions with representative points, the analyze
    handler runs SAM at each point and bundles simplified polygon paths into
    the response."""
    import io

    import numpy as np
    from PIL import Image

    # Pre-segmentation + pass-2 refinement are off by default. Opt in for this
    # test so we still exercise the legacy bundling code path.
    monkeypatch.setenv("ANALYZE_PRESEGMENT", "1")
    monkeypatch.setenv("ANALYZE_REFINE", "1")

    from app.api.deps import get_anthropic_client, get_sam_client, get_session_store
    from app.schemas.image_context import CandidateRegion, ImageContext
    from app.services.session_store import SessionStore

    img = Image.new("RGB", (64, 64), color=(0, 128, 0))
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
                representative_point=[32.0, 32.0],
            ),
        ],
        model_name="claude",
        model_version="test",
        generated_at="2025-01-01T00:00:00Z",
    )

    # Filled central square — yields a single polygon contour after simplification.
    mask = np.zeros((64, 64), dtype=bool)
    mask[16:48, 16:48] = True
    sam = MagicMock()
    sam.decode_combined.return_value = mask
    sam.model_name = "vit_b"

    # Refinement pass: accept the single region as-is so we don't re-run SAM
    # with refined prompts. Pass-1 mask becomes the final mask.
    from app.schemas.image_context import ContextRefinements, RegionRefinement
    anthropic.refine_image_context.return_value = ContextRefinements(
        refinements=[RegionRefinement(region_index=1, action="accept")],
    )

    app.dependency_overrides[get_session_store] = lambda: store
    app.dependency_overrides[get_anthropic_client] = lambda: anthropic
    app.dependency_overrides[get_sam_client] = lambda: sam

    try:
        with TestClient(app) as client:
            res = client.post("/api/analyze", json={"session_id": sid})
            assert res.status_code == 200, res.text
            body = res.json()
            assert len(body["candidateRegions"]) == 1
            region = body["candidateRegions"][0]
            assert region["paths"] is not None
            assert len(region["paths"]) == 1
            poly = region["paths"][0]
            assert len(poly) >= 3
            for x, y in poly:
                assert 0.0 <= x <= 1.0
                assert 0.0 <= y <= 1.0
        sam.embed.assert_called_once()
        sam.decode_combined.assert_called()
        anthropic.refine_image_context.assert_called_once()
    finally:
        app.dependency_overrides.clear()
