from pathlib import Path
from unittest.mock import MagicMock

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api import deps
from app.api.deps import get_sam_client
from app.schemas.image_context import ImageContext
from app.schemas.operation_graph import OperationGraph


@pytest.fixture
def fake_client() -> MagicMock:
    fake = MagicMock()
    fake.analyze_image.return_value = ImageContext.model_validate({
        "subjects": [],
        "lighting": "flat",
        "dominant_tones": [],
        "mood": "neutral",
        "candidate_regions": [],
        "model_name": "claude-opus-4-7",
        "model_version": "2026-01",
        "generated_at": "2026-05-11T10:00:00Z",
    })
    fake.generate_panel.return_value = OperationGraph.model_validate({
        "id": "g1",
        "user_goal": "warmer",
        "reasoning": "white balance",
        "nodes": [
            {"id": "n1", "type": "kelvin", "scope": {"kind": "global"}, "params": {"temperature": 5800}}
        ],
        "panel_bindings": [
            {
                "node_id": "n1",
                "param_key": "temperature",
                "label": "warm cast",
                "control": "slider",
                "min": 3000, "max": 9000, "default": 5800, "step": 50,
            }
        ],
        "metadata": {"model_name": "claude-opus-4-7"},
    })
    return fake


@pytest.fixture
def client(fake_client: MagicMock, monkeypatch) -> TestClient:
    # panel.py uses _get_client() wrapper → monkeypatch on the deps module attribute
    monkeypatch.setattr(deps, "get_anthropic_client", lambda: fake_client)
    # analyze.py uses Depends(deps.get_sam_client) directly → dependency_overrides
    fake_sam = MagicMock()
    fake_sam.model_name = "vit_b"
    # Return an empty mask so _refine_regions short-circuits on the SAM pass and
    # the test never enters the contour/refinement path (analyze.py's Depends
    # captures deps.get_anthropic_client at import time, so the monkeypatch
    # above doesn't reach the /api/analyze endpoint — see panel.py's wrapper).
    fake_sam.decode_point.return_value = np.zeros((1, 1), dtype=bool)
    fake_sam.decode_combined.return_value = np.zeros((1, 1), dtype=bool)
    app.dependency_overrides[get_sam_client] = lambda: fake_sam
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def test_panel_returns_operation_graph(client: TestClient, fake_client: MagicMock) -> None:
    image_path = Path(__file__).parent / "fixtures" / "test_image.jpg"
    with image_path.open("rb") as fh:
        sid = client.post("/api/session", files={"image": ("t.jpg", fh, "image/jpeg")}).json()["session_id"]
    response = client.post("/api/panel", json={"session_id": sid, "user_goal": "make it warmer"})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["user_goal"] == "warmer"
    assert body["panel_bindings"][0]["label"] == "warm cast"
    # Verify analyze was called once (lazy, before panel)
    assert fake_client.analyze_image.call_count == 1


def test_panel_reuses_cached_context(client: TestClient, fake_client: MagicMock) -> None:
    image_path = Path(__file__).parent / "fixtures" / "test_image.jpg"
    with image_path.open("rb") as fh:
        sid = client.post("/api/session", files={"image": ("t.jpg", fh, "image/jpeg")}).json()["session_id"]
    client.post("/api/analyze", json={"session_id": sid})
    fake_client.analyze_image.reset_mock()
    client.post("/api/panel", json={"session_id": sid, "user_goal": "x"})
    client.post("/api/panel", json={"session_id": sid, "user_goal": "y"})
    assert fake_client.analyze_image.call_count == 0


def test_panel_unknown_session_404(client: TestClient) -> None:
    response = client.post("/api/panel", json={"session_id": "nope", "user_goal": "x"})
    assert response.status_code == 404
