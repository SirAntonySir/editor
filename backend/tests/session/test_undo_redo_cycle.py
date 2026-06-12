"""20-step undo/redo/revert cycle through the real tool registry path.

Closes Phase 3 task #23. The other tests cover the engine + endpoints
in isolation; this one drives the full pipeline:
  POST /api/tools/set_param (is_user_action=True)
  → registry captures Snapshot before/after, pushes HistoryEntry
  → /api/state/{sid}/undo flips canonical back via apply_snapshot
  → /api/state/{sid} reflects the restored projection
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.api import deps


async def _client_with_session(monkeypatch, tmp_path, *, coalesce: bool):
    """Shared fixture body. `coalesce=False` disables history coalescing so
    each set_param produces its own entry — useful for the multi-step
    mechanical tests that pre-date the coalesce default."""
    from app.main import app
    from app.services import disk_session_io
    from app.services.session_store import SessionStore

    monkeypatch.setattr(disk_session_io, "SESSIONS_DIR", tmp_path)
    if not coalesce:
        from app.config import get_app_config
        monkeypatch.setattr(
            get_app_config().runtime, "history_coalesce_window_ms", 0
        )
    store = SessionStore(ttl_seconds=3600)
    monkeypatch.setattr(deps, "_session_store", store)
    registry = deps.get_tool_registry()
    monkeypatch.setattr(registry, "_store", store)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
        sid = (await ac.post("/api/session", files=files)).json()["session_id"]
        yield ac, sid, store


@pytest.fixture
async def client_with_session(monkeypatch, tmp_path):
    """Isolate per-test SessionStore + disk dir. Coalesce DISABLED so the
    pre-existing multi-step tests see one entry per set_param. The
    coalesce-on workflow is covered by the dedicated tests below."""
    async for triple in _client_with_session(monkeypatch, tmp_path, coalesce=False):
        yield triple


@pytest.fixture
async def client_with_coalesce(monkeypatch, tmp_path):
    """Coalesce ENABLED — exercises the slider-drag workflow."""
    async for triple in _client_with_session(monkeypatch, tmp_path, coalesce=True):
        yield triple


async def _set_exposure(ac: AsyncClient, sid: str, value: float) -> None:
    r = await ac.post("/api/tools/set_param", json={
        "session_id": sid,
        "input": {
            "layerId": "layer-1",
            "op": "basic",
            "param": "exposure",
            "value": value,
        },
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"], body


async def _current_exposure(ac: AsyncClient, sid: str) -> float | None:
    snap = (await ac.get(f"/api/state/{sid}")).json()
    for node in snap["operationGraph"]["nodes"]:
        if node.get("layerId") == "layer-1" and node["type"] == "basic":
            return node["params"].get("exposure")
    return None


@pytest.mark.asyncio
async def test_20_step_undo_redo_cycle_through_tool_registry(client_with_session):
    ac, sid, _store = client_with_session

    # 20 forward steps.
    values = [round(i * 0.05, 4) for i in range(1, 21)]  # 0.05 .. 1.00
    for v in values:
        await _set_exposure(ac, sid, v)
    assert await _current_exposure(ac, sid) == values[-1]

    # 20 undos — each restores the previous value, last undo lands on
    # the pre-history baseline (no exposure node at all).
    expected_after_undo = list(reversed(values[:-1])) + [None]
    for step, expected in enumerate(expected_after_undo):
        r = await ac.post(f"/api/state/{sid}/undo")
        assert r.status_code == 200, f"undo step {step}: {r.status_code} {r.text}"
        assert r.json()["applied"] == "undo"
        actual = await _current_exposure(ac, sid)
        assert actual == expected, (
            f"undo step {step}: expected exposure={expected}, got {actual}"
        )

    # 21st undo is a no-op (cursor at -1).
    r = await ac.post(f"/api/state/{sid}/undo")
    assert r.status_code == 409

    # 20 redos walk forward through `values`.
    for step, expected in enumerate(values):
        r = await ac.post(f"/api/state/{sid}/redo")
        assert r.status_code == 200, f"redo step {step}: {r.status_code} {r.text}"
        actual = await _current_exposure(ac, sid)
        assert actual == expected, (
            f"redo step {step}: expected exposure={expected}, got {actual}"
        )

    # 21st redo is a no-op.
    r = await ac.post(f"/api/state/{sid}/redo")
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_revert_from_mid_cycle_jumps_to_baseline(client_with_session):
    ac, sid, _store = client_with_session
    for v in (0.1, 0.2, 0.3, 0.4, 0.5):
        await _set_exposure(ac, sid, v)
    # Undo twice, then revert — revert should land us at the pre-history
    # baseline (no exposure node), regardless of cursor position.
    await ac.post(f"/api/state/{sid}/undo")
    await ac.post(f"/api/state/{sid}/undo")
    assert await _current_exposure(ac, sid) == 0.3

    r = await ac.post(f"/api/state/{sid}/revert")
    assert r.status_code == 200
    assert r.json()["applied"] == "revert"
    assert await _current_exposure(ac, sid) is None

    # Redo after revert walks forward from step 1 (the entries survive).
    r = await ac.post(f"/api/state/{sid}/redo")
    assert r.status_code == 200
    assert await _current_exposure(ac, sid) == 0.1


@pytest.mark.asyncio
async def test_new_action_after_undo_truncates_redo_branch(client_with_session):
    ac, sid, _store = client_with_session
    await _set_exposure(ac, sid, 0.1)
    await _set_exposure(ac, sid, 0.2)
    await _set_exposure(ac, sid, 0.3)
    # Undo twice → cursor at step 1, can redo to 0.2 / 0.3.
    await ac.post(f"/api/state/{sid}/undo")
    await ac.post(f"/api/state/{sid}/undo")
    assert await _current_exposure(ac, sid) == 0.1

    # New action — should forfeit the 0.2 / 0.3 redo branch.
    await _set_exposure(ac, sid, 0.7)
    assert await _current_exposure(ac, sid) == 0.7

    r = await ac.post(f"/api/state/{sid}/redo")
    assert r.status_code == 409, "redo branch must be truncated by new action"


@pytest.mark.asyncio
async def test_consecutive_set_param_calls_coalesce_into_one_undo(client_with_coalesce):
    """Slider drags fire many debounced set_params on the SAME
    (layer, op, param) — they must collapse into one undo entry, not
    a tower. Otherwise the user clicks undo 20 times to walk one drag back."""
    ac, sid, store = client_with_coalesce
    for v in (0.10, 0.15, 0.20, 0.25, 0.30):
        await _set_exposure(ac, sid, v)

    # All five commits merged.
    history = store.get_history(sid)
    assert len(history.entries) == 1

    # One undo lands us back at the pre-drag baseline (no exposure).
    r = await ac.post(f"/api/state/{sid}/undo")
    assert r.status_code == 200
    assert await _current_exposure(ac, sid) is None


@pytest.mark.asyncio
async def test_set_param_on_different_targets_does_not_coalesce(client_with_coalesce):
    ac, sid, store = client_with_coalesce
    await _set_exposure(ac, sid, 0.5)
    # A different param breaks the coalesce chain.
    await ac.post("/api/tools/set_param", json={
        "session_id": sid,
        "input": {
            "layerId": "layer-1",
            "op": "basic",
            "param": "contrast",
            "value": 0.3,
        },
    })
    await _set_exposure(ac, sid, 0.7)
    # Three distinct entries: exposure / contrast / exposure.
    assert len(store.get_history(sid).entries) == 3


@pytest.mark.asyncio
async def test_undo_emits_history_applied_event_with_full_projection(client_with_session):
    """The SSE history.applied event carries the full restored projection
    so the frontend can swap snapshot state in one shot. Verify the
    payload shape coming out of the registry-driven path."""
    ac, sid, store = client_with_session
    await _set_exposure(ac, sid, 0.5)
    await _set_exposure(ac, sid, 0.9)

    doc = store.get_document(sid)
    history_len_before = len(doc.history)

    r = await ac.post(f"/api/state/{sid}/undo")
    assert r.status_code == 200
    # Exactly one history.applied event added.
    new_events = doc.history[history_len_before:]
    applied = [e for e in new_events if e.kind == "history.applied"]
    assert len(applied) == 1
    p = applied[0].payload
    assert "operationGraph" in p
    assert "widgets" in p
    assert "masksIndex" in p
