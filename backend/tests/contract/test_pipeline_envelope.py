"""Contract tests: the analyze pipeline envelope and snapshot shape.

These pin the OBSERVABLE wire shape so subsequent refactor phases catch
regressions. They are deliberately structural (key presence + types),
not value-based, so they survive casing migrations with a single
search/replace.
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


def test_analyze_pipeline_envelope_shape(fake_anthropic, fake_sam, monkeypatch):
    """The 4-tool analyze pipeline must produce the envelope shape the
    frontend consumes and persist it into the session snapshot."""
    monkeypatch.setenv("ANALYZE_SAM", "1")
    client = TestClient(app)
    sid = _post_session(client)

    p = client.post("/api/tools/prepare_image", json={"session_id": sid, "input": {}})
    assert p.status_code == 200, p.text
    assert p.json()["ok"] is True

    a = client.post("/api/tools/analyze_context", json={"session_id": sid, "input": {}})
    assert a.status_code == 200, a.text
    assert a.json()["ok"] is True
    out = a.json()["output"]
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

    pr = client.post("/api/tools/precompute_regions", json={"session_id": sid, "input": {}})
    assert pr.status_code == 200, pr.text
    assert pr.json()["ok"] is True

    snap = client.get(f"/api/state/{sid}").json()
    for key in ("sessionId", "imageContext", "widgets", "masksIndex"):
        assert key in snap
    ic = snap["imageContext"]
    assert ic is not None
    assert "candidateRegions" in ic
    # After precompute_regions with SAM on, regions carry paths.
    assert any(r.get("paths") for r in ic["candidateRegions"])
