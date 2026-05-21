import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.atomic.add_note import AddNoteTool


@pytest.fixture
def client():
    from app.main import app
    reg = deps.get_tool_registry()
    if "add_note" not in reg._tools:
        reg.register(AddNoteTool())
    yield TestClient(app)


def test_add_note_image_anchor(client) -> None:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    body = client.post(
        "/api/tools/add_note",
        json={"session_id": sid, "input": {
            "text": "remember to check exposure",
            "anchor": {"kind": "image"},
        }},
    ).json()
    assert body["ok"] is True
    doc = deps.get_session_store().get_document(sid)
    assert len(doc.notes) == 1
    assert doc.notes[0].text == "remember to check exposure"
    assert doc.history[-1].kind == "note.created"
