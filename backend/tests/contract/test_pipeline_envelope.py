"""Contract tests: the analyze tool envelope and snapshot shape.

These pin the OBSERVABLE wire shape so subsequent refactor phases catch
regressions. They are deliberately structural (key presence + types),
not value-based, so they survive Phase 1's casing migration with a
single search/replace.
"""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from tests.contract._fixtures import fake_anthropic, fake_sam  # noqa: F401

_FIXTURE_IMAGE = Path(__file__).parent.parent / "fixtures" / "test_image.jpg"


def _post_session(client: TestClient) -> str:
    with _FIXTURE_IMAGE.open("rb") as f:
        resp = client.post("/api/session", files={"image": f})
    assert resp.status_code == 200, resp.text
    return resp.json()["session_id"]


def test_analyze_envelope_shape(fake_anthropic, fake_sam, monkeypatch):
    """The analyze_image tool envelope must carry the keys the frontend
    consumes. Values are not asserted; this is a shape contract."""
    monkeypatch.setenv("ANALYZE_SAM", "1")
    client = TestClient(app)
    sid = _post_session(client)

    resp = client.post(
        "/api/tools/analyze_image",
        json={"session_id": sid, "input": {}},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is True
    out = body["output"]
    # Top-level keys the frontend reads (camelCase on the wire as of Phase 1).
    for key in (
        "subjects",
        "lighting",
        "dominantTones",
        "mood",
        "candidateRegions",
        "modelName",
        "modelVersion",
        "generatedAt",
    ):
        assert key in out, f"missing top-level key: {key}"
    assert isinstance(out["candidateRegions"], list)
    assert len(out["candidateRegions"]) >= 1
    region = out["candidateRegions"][0]
    for key in ("label", "description", "bbox", "representativePoint"):
        assert key in region, f"missing region key: {key}"


def test_state_snapshot_shape(fake_anthropic, fake_sam, monkeypatch):
    """The /api/state/{sid} snapshot must surface image_context with the
    same regions list. Pins the SSE-merged shape consumers depend on."""
    monkeypatch.setenv("ANALYZE_SAM", "1")
    client = TestClient(app)
    sid = _post_session(client)
    client.post("/api/tools/analyze_image", json={"session_id": sid, "input": {}})

    snap = client.get(f"/api/state/{sid}").json()
    for key in ("sessionId", "imageContext", "widgets", "masksIndex"):
        assert key in snap
    ic = snap["imageContext"]
    assert ic is not None
    assert "candidateRegions" in ic
    assert isinstance(ic["candidateRegions"], list)
