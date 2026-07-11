from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.api import deps


def test_agent_turn_runs_loop_and_returns_count():
    client = TestClient(app)
    store = deps.get_session_store()
    sid = store.create(image_bytes=b"x", mime_type="image/jpeg")

    async def fake_run_agent_turn(**kwargs):
        assert kwargs["sid"] == sid
        assert kwargs["intent"] == "dramatic"
        assert kwargs["attached_objects"] == ["mask_sky"]
        return {"ok": True, "tool_calls": 2}

    with patch("app.api.state.run_agent_turn", fake_run_agent_turn):
        resp = client.post(
            f"/api/state/{sid}/agent_turn",
            json={"intent": "dramatic", "attached_objects": ["mask_sky"], "client_tools": []},
        )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "tool_calls": 2}


def test_agent_turn_seeds_node_layers_from_active_node():
    client = TestClient(app)
    store = deps.get_session_store()
    sid = store.create(image_bytes=b"x", mime_type="image/jpeg")
    captured = {}

    async def fake_run_agent_turn(**kwargs):
        captured["node_layers"] = kwargs["node_layers"]
        return {"ok": True, "tool_calls": 0}

    with patch("app.api.state.run_agent_turn", fake_run_agent_turn):
        resp = client.post(
            f"/api/state/{sid}/agent_turn",
            json={
                "intent": "x", "attached_objects": [], "client_tools": [],
                "active_node": {"image_node_id": "in-2", "layer_ids": ["l-a", "l-b"]},
            },
        )
    assert resp.status_code == 200
    assert captured["node_layers"] == {"in-2": ["l-a", "l-b"]}


def test_agent_turn_forced_targets_seed_node_layers():
    client = TestClient(app)
    store = deps.get_session_store()
    sid = store.create(image_bytes=b"x", mime_type="image/jpeg")
    captured = {}

    async def fake_run_agent_turn(**kwargs):
        captured["node_layers"] = kwargs["node_layers"]
        captured["forced_targets"] = kwargs["forced_targets"]
        return {"ok": True, "tool_calls": 0}

    with patch("app.api.state.run_agent_turn", fake_run_agent_turn):
        resp = client.post(
            f"/api/state/{sid}/agent_turn",
            json={
                "intent": "make it pop", "attached_objects": [], "client_tools": [],
                "forced_targets": [{"image_node_id": "node-new", "layer_ids": ["L1"]}],
                "active_node": {"image_node_id": "node-src", "layer_ids": ["L0"]},
            },
        )
    assert resp.status_code == 200
    assert captured["node_layers"]["node-new"] == ["L1"]
    assert captured["forced_targets"] == ["node-new"]


def test_agent_turn_threads_layer_labels_to_loop():
    client = TestClient(app)
    store = deps.get_session_store()
    sid = store.create(image_bytes=b"x", mime_type="image/jpeg")
    captured = {}

    async def fake_run_agent_turn(**kwargs):
        captured["layer_labels"] = kwargs["layer_labels"]
        return {"ok": True, "tool_calls": 0}

    with patch("app.api.state.run_agent_turn", fake_run_agent_turn):
        resp = client.post(
            f"/api/state/{sid}/agent_turn",
            json={
                "intent": "x", "attached_objects": [], "client_tools": [],
                "layer_labels": {"L1": "Sky", "L2": "Grass"},
            },
        )
    assert resp.status_code == 200
    assert captured["layer_labels"] == {"L1": "Sky", "L2": "Grass"}


def test_agent_turn_reference_kept_out_of_targets_and_summarized():
    """A reference node must not enter node_layers (the target whitelist) and
    must arrive as a `references` summary — so it's matched, never edited."""
    import io

    import numpy as np
    from PIL import Image

    client = TestClient(app)
    store = deps.get_session_store()
    sid = store.create(image_bytes=b"x", mime_type="image/jpeg")
    # Attach a real reference image (warm) under node id in-2.
    doc = store.get_document(sid)
    arr = np.zeros((32, 32, 3), dtype=np.uint8)
    arr[:, :, 0] = 210; arr[:, :, 1] = 150; arr[:, :, 2] = 60  # warm
    buf = io.BytesIO(); Image.fromarray(arr, "RGB").save(buf, "JPEG", quality=95)
    doc.set_image_bytes("in-2", buf.getvalue(), mime_type="image/jpeg")

    captured = {}

    async def fake_run_agent_turn(**kwargs):
        captured["node_layers"] = kwargs["node_layers"]
        captured["references"] = kwargs["references"]
        return {"ok": True, "tool_calls": 0}

    with patch("app.api.state.run_agent_turn", fake_run_agent_turn):
        resp = client.post(
            f"/api/state/{sid}/agent_turn",
            json={
                "intent": "make image1 look like image2",
                "attached_objects": [], "client_tools": [],
                "reference_targets": [{"image_node_id": "in-2", "layer_ids": ["lr"]}],
                "active_node": {"image_node_id": "in-1", "layer_ids": ["lt"]},
            },
        )
    assert resp.status_code == 200
    # in-2 is NOT a target...
    assert "in-2" not in captured["node_layers"]
    assert captured["node_layers"] == {"in-1": ["lt"]}
    # ...but arrives as a reference summary the loop can match against.
    refs = captured["references"]
    assert len(refs) == 1 and refs[0]["image_node_id"] == "in-2"
    assert isinstance(refs[0]["summary"], str) and refs[0]["summary"]


def test_agent_turn_unknown_session_404():
    client = TestClient(app)
    resp = client.post(
        "/api/state/nope/agent_turn",
        json={"intent": "x", "attached_objects": [], "client_tools": []},
    )
    assert resp.status_code == 404
