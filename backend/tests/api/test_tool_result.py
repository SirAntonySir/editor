from fastapi.testclient import TestClient

from app.main import app
from app.api import deps


def test_tool_result_resolves_pending_request():
    client = TestClient(app)
    store = deps.get_session_store()
    sid = store.create(image_bytes=b"x", mime_type="image/jpeg")
    request_id, fut = store.new_client_request(sid)

    resp = client.post(
        f"/api/state/{sid}/tool_result",
        json={"request_id": request_id, "ok": True, "output": {"image_node_id": "in-3"}},
    )
    assert resp.status_code == 200
    assert resp.json() == {"resolved": True}
    assert fut.done()
    assert fut.result() == {
        "ok": True, "output": {"image_node_id": "in-3"}, "error": None, "denied": False,
    }


def test_tool_result_unknown_request_returns_resolved_false():
    client = TestClient(app)
    store = deps.get_session_store()
    sid = store.create(image_bytes=b"x", mime_type="image/jpeg")
    resp = client.post(
        f"/api/state/{sid}/tool_result",
        json={"request_id": "nope", "ok": True},
    )
    assert resp.status_code == 200
    assert resp.json() == {"resolved": False}
