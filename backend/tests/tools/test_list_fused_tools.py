import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.atomic.list_fused_tools import ListFusedToolsTool


@pytest.fixture
def client():
    from app.main import app
    reg = deps.get_tool_registry()
    if "list_fused_tools" not in reg._tools:
        reg.register(ListFusedToolsTool())
    yield TestClient(app)


def test_list_fused_tools_returns_catalog(client) -> None:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    body = client.post(
        "/api/tools/list_fused_tools",
        json={"session_id": sid, "input": {}},
    ).json()
    assert body["ok"] is True
    ids = {t["id"] for t in body["output"]["tools"]}
    assert "warm_grade" in ids
    # Catalogue: 9 legacy + 8 tone bands + 5 moods + 4 atmospheres
    # + 4 light surgery + 3 contrast + 2 B&W variants + 2 finishing
    # + 3 colour theory = 40 total.
    # time-of-day retired from fused templates (Task 7): now registry-driven.
    assert len(ids) == 40
    # Spot-check one of each major addition family lands in the catalogue.
    for expected in ("tone_green", "moody", "golden_hour", "lift_shadows",
                     "detail_pop", "bw_high_contrast", "tinted_grade",
                     "complementary_grade"):
        assert expected in ids, f"missing template: {expected}"
    entry = next(t for t in body["output"]["tools"] if t["id"] == "warm_grade")
    assert entry["param_envelope"]["temperature"]["min"] == -1200
