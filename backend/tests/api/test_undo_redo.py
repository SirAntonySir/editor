"""HTTP round-trip for /api/state/{sid}/undo|redo|revert."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.api import deps


def _mutate(doc, layer: str, op: str, param: str, value):
    """Direct doc mutation that matches what a `set_param` tool call does
    (canonical write + event). The registry's history-engine push only
    fires through the tool path, so these tests separately drive the
    history engine to keep concerns isolated."""
    return doc.set_param(layer, op, param, value)


def _push_history(store, sid: str, doc, label: str = "step"):
    """Capture a Snapshot pair from doc and push onto the session's history
    engine. Mirrors what the registry does when is_user_action=True."""
    from app.session.history import Snapshot
    before = Snapshot.capture(doc)
    # Caller mutates between before / after.
    yield_after = lambda: store.get_history(sid).push(
        label=label, before=before, after=Snapshot.capture(doc)
    )
    return yield_after


@pytest.fixture
async def client_with_session(monkeypatch, tmp_path):
    """Boot an isolated SessionStore + create one session, return
    (client, sid, store)."""
    from app.main import app
    from app.services import disk_session_io
    from app.services.session_store import SessionStore

    monkeypatch.setattr(disk_session_io, "SESSIONS_DIR", tmp_path)
    store = SessionStore(ttl_seconds=3600)
    monkeypatch.setattr(deps, "_session_store", store)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
        sid = (await ac.post("/api/session", files=files)).json()["session_id"]
        yield ac, sid, store


@pytest.mark.asyncio
async def test_undo_409_when_nothing_to_undo(client_with_session):
    ac, sid, _store = client_with_session
    r = await ac.post(f"/api/state/{sid}/undo")
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_undo_redo_round_trip(client_with_session):
    ac, sid, store = client_with_session
    doc = store.get_document(sid)
    from app.session.history import Snapshot

    # Step 1: exposure 0.5
    before_1 = Snapshot.capture(doc)
    _mutate(doc, "layer-1", "basic", "exposure", 0.5)
    store.get_history(sid).push("set exposure", before_1, Snapshot.capture(doc))

    # Step 2: contrast 0.3
    before_2 = Snapshot.capture(doc)
    _mutate(doc, "layer-1", "basic", "contrast", 0.3)
    store.get_history(sid).push("set contrast", before_2, Snapshot.capture(doc))

    # Verify GET state before undo: both params landed.
    snap_now = (await ac.get(f"/api/state/{sid}")).json()
    params_now = next(
        n["params"] for n in snap_now["operationGraph"]["nodes"]
        if n.get("layerId") == "layer-1" and n["type"] == "basic"
    )
    assert params_now == {"exposure": 0.5, "contrast": 0.3}

    # Undo step 2 → contrast is gone, exposure remains.
    r = await ac.post(f"/api/state/{sid}/undo")
    assert r.status_code == 200, r.text
    assert r.json()["applied"] == "undo"

    snap = (await ac.get(f"/api/state/{sid}")).json()
    params = next(
        n["params"] for n in snap["operationGraph"]["nodes"]
        if n.get("layerId") == "layer-1" and n["type"] == "basic"
    )
    assert params == {"exposure": 0.5}

    # Undo step 1 → no nodes.
    r = await ac.post(f"/api/state/{sid}/undo")
    assert r.status_code == 200
    snap = (await ac.get(f"/api/state/{sid}")).json()
    assert snap["operationGraph"]["nodes"] == []

    # Redo brings exposure back.
    r = await ac.post(f"/api/state/{sid}/redo")
    assert r.status_code == 200
    assert r.json()["applied"] == "redo"
    snap = (await ac.get(f"/api/state/{sid}")).json()
    params = next(
        n["params"] for n in snap["operationGraph"]["nodes"]
        if n.get("layerId") == "layer-1" and n["type"] == "basic"
    )
    assert params == {"exposure": 0.5}


@pytest.mark.asyncio
async def test_revert_returns_to_baseline_and_keeps_redo(client_with_session):
    ac, sid, store = client_with_session
    doc = store.get_document(sid)
    from app.session.history import Snapshot

    for i, v in enumerate([0.1, 0.2, 0.3]):
        b = Snapshot.capture(doc)
        _mutate(doc, "layer-1", "basic", "exposure", v)
        store.get_history(sid).push(f"step-{i}", b, Snapshot.capture(doc))

    r = await ac.post(f"/api/state/{sid}/revert")
    assert r.status_code == 200
    assert r.json()["applied"] == "revert"

    snap = (await ac.get(f"/api/state/{sid}")).json()
    assert snap["operationGraph"]["nodes"] == []

    # Redo after revert walks forward through the saved entries.
    r = await ac.post(f"/api/state/{sid}/redo")
    assert r.status_code == 200
    snap = (await ac.get(f"/api/state/{sid}")).json()
    params = next(
        n["params"] for n in snap["operationGraph"]["nodes"]
        if n.get("layerId") == "layer-1" and n["type"] == "basic"
    )
    assert params == {"exposure": 0.1}


@pytest.mark.asyncio
async def test_undo_redo_revert_404_on_unknown_session():
    from app.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        for path in ("undo", "redo", "revert"):
            r = await ac.post(f"/api/state/no_such_sid/{path}")
            assert r.status_code == 404, f"{path}: {r.status_code} {r.text}"
