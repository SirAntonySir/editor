from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api import deps
from app.schemas.image_context import ImageContext


@pytest.fixture
def client_with_fake_anthropic(monkeypatch) -> TestClient:
    fake = MagicMock()
    fake.analyze_image.return_value = ImageContext.model_validate({
        "subjects": ["person"],
        "lighting": "backlit",
        "dominant_tones": ["shadows"],
        "mood": "calm",
        "candidate_regions": [],
        "model_name": "claude-opus-4-7",
        "model_version": "2026-01",
        "generated_at": "2026-05-11T10:00:00Z",
    })
    monkeypatch.setattr(deps, "get_anthropic_client", lambda: fake)
    return TestClient(app)


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
