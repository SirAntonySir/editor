from pathlib import Path
from unittest.mock import MagicMock

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api import deps
from app.api.deps import get_sam_client
from app.schemas.image_context import ImageContext


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
    # augment_context_soft_fields is called by the analyze_image tool after the
    # base analyze. Returns the _ContextSoftFields-shaped object used to enrich
    # the EnrichedImageContext. We give problems=[] so no autonomous suggestion
    # widgets are minted (keeps the test deterministic).
    fake.augment_context_soft_fields.return_value = _build_soft_fields_stub()
    # propose_stack (now used by the panel shim) uses plan_widget_stack + resolve_widget_params.
    # Pin it to a single light op so the test is deterministic and panel_bindings > 0.
    from app.registry.loader import get_registry
    fake.plan_widget_stack.return_value = {
        "plan": [{"op_id": "light", "rationale": "make it warmer"}],
        "overall_rationale": "light adjustment",
    }
    reg = get_registry()
    light_op = reg.ops["light"]
    fake.resolve_widget_params.return_value = {k: p.default for k, p in light_op.params.items()}
    return fake


def _build_soft_fields_stub():
    """Returns a _ContextSoftFields-shaped object matching the analyze_image
    tool's expectations. Built lazily so we don't import the private symbol
    until fixture eval (keeps the import surface clean if it ever moves)."""
    from app.services.anthropic_client import _ContextSoftFields
    return _ContextSoftFields(
        estimated_white_point=(255.0, 255.0, 255.0),
        wb_neutral_confidence=1.0,
        grade_character="neutral",
        problems=[],
        region_soft_fields=[],
    )


@pytest.fixture
def client(fake_client: MagicMock, monkeypatch) -> TestClient:
    # The shim and the analyze_image tool both pull the Anthropic client
    # through deps.get_anthropic_client at call time, so monkeypatching the
    # module attribute is sufficient.
    monkeypatch.setattr(deps, "get_anthropic_client", lambda: fake_client)
    # analyze.py uses Depends(deps.get_sam_client) directly → dependency_overrides.
    fake_sam = MagicMock()
    fake_sam.model_name = "vit_b"
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
    # Deprecation headers are emitted by the shim.
    assert response.headers.get("Deprecation") == "true"
    body = response.json()
    # user_goal is now derived from widget intent by project_to_graph; the shim
    # threads the request's user_goal through as the widget's intent, so the
    # response should reflect it (structurally, not literally).
    assert "make it warmer" in body["userGoal"]
    # Panel bindings come from the warm_grade fused template — assert structural
    # presence rather than label text (which is template-defined, not test-defined).
    assert isinstance(body["panelBindings"], list)
    assert len(body["panelBindings"]) > 0
    # Verify the lazy-analyze branch fired (no prior context on the session).
    # analyze_context internally calls client.analyze_image exactly once.
    assert fake_client.analyze_image.call_count == 1


def test_panel_reuses_cached_context(client: TestClient, fake_client: MagicMock) -> None:
    image_path = Path(__file__).parent / "fixtures" / "test_image.jpg"
    with image_path.open("rb") as fh:
        sid = client.post("/api/session", files={"image": ("t.jpg", fh, "image/jpeg")}).json()["session_id"]
    # Prime context via the legacy /api/analyze endpoint (calls fake.analyze_image).
    client.post("/api/analyze", json={"session_id": sid})
    fake_client.analyze_image.reset_mock()
    fake_client.augment_context_soft_fields.reset_mock()
    # Two subsequent /panel calls must not re-trigger analyze (context is cached).
    client.post("/api/panel", json={"session_id": sid, "user_goal": "x"})
    client.post("/api/panel", json={"session_id": sid, "user_goal": "y"})
    assert fake_client.analyze_image.call_count == 0
    assert fake_client.augment_context_soft_fields.call_count == 0


def test_panel_unknown_session_404(client: TestClient) -> None:
    response = client.post("/api/panel", json={"session_id": "nope", "user_goal": "x"})
    assert response.status_code == 404
