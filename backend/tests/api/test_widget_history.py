"""HTTP round-trip for the per-widget history endpoints:
GET  /api/state/{sid}/widget-history/{widget_id}
POST /api/state/{sid}/restore-widget/{widget_id}/{entry_id}
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.api import deps
from app.schemas.widget import Scope, Widget, WidgetNode, WidgetOrigin


def _widget(wid: str, nid: str, params: dict) -> Widget:
    g = Scope.model_validate({"kind": "global"})
    return Widget(
        id=wid, intent="Warm light", scope=g,
        origin=WidgetOrigin(kind="mcp_user_prompt", prompt="x"), op_id="basic",
        nodes=[WidgetNode(id=nid, type="basic", scope=g, widget_id=wid,
                          layer_id="layer-1", params=params)],
        bindings=[],
    )


@pytest.fixture
async def client_with_session(monkeypatch, tmp_path):
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
async def test_widget_history_filters_entries_and_renders_deltas(client_with_session):
    ac, sid, store = client_with_session
    doc = store.get_document(sid)
    from app.session.history import Snapshot

    doc.add_widget(_widget("w1", "n1", {"exposure": 0.3}))
    hist = store.get_history(sid)
    e1 = hist.push(
        "Setting exposure = 0.30", Snapshot.capture(doc), Snapshot.capture(doc),
        affected_widget_ids=["w1"],
        widget_params_before={"w1": {"n1": {"exposure": 0.5}}},
        widget_params_after={"w1": {"n1": {"exposure": 0.3}}},
    )
    # An unrelated entry for another widget — must not leak into w1's timeline.
    hist.push("other", Snapshot.capture(doc), Snapshot.capture(doc),
              affected_widget_ids=["w2"])

    r = await ac.get(f"/api/state/{sid}/widget-history/w1")
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["entries"]) == 1
    entry = body["entries"][0]
    assert entry["id"] == e1.id
    assert entry["label"] == "Setting exposure = 0.30"
    assert entry["params_before"] == {"n1": {"exposure": 0.5}}
    assert entry["params_after"] == {"n1": {"exposure": 0.3}}
    assert body["current_entry_id"] == e1.id


@pytest.mark.asyncio
async def test_widget_history_current_matches_live_params_not_cursor(client_with_session):
    # Live widget sits at exposure 0.5, which matches the OLDER entry — proving
    # current is derived from params, not the cursor tip.
    ac, sid, store = client_with_session
    doc = store.get_document(sid)
    from app.session.history import Snapshot
    doc.add_widget(_widget("w1", "n1", {"exposure": 0.5}))
    hist = store.get_history(sid)
    eA = hist.push("set 0.5", Snapshot.capture(doc), Snapshot.capture(doc),
                   affected_widget_ids=["w1"],
                   widget_params_after={"w1": {"n1": {"exposure": 0.5}}})
    hist.push("set 0.3", Snapshot.capture(doc), Snapshot.capture(doc),
              affected_widget_ids=["w1"],
              widget_params_after={"w1": {"n1": {"exposure": 0.3}}})

    body = (await ac.get(f"/api/state/{sid}/widget-history/w1")).json()
    assert body["current_entry_id"] == eA.id


@pytest.mark.asyncio
async def test_widget_history_excludes_restore_entries(client_with_session):
    ac, sid, store = client_with_session
    doc = store.get_document(sid)
    from app.session.history import Snapshot
    doc.add_widget(_widget("w1", "n1", {"exposure": 0.5}))
    hist = store.get_history(sid)
    hist.push("set 0.5", Snapshot.capture(doc), Snapshot.capture(doc),
              affected_widget_ids=["w1"],
              widget_params_after={"w1": {"n1": {"exposure": 0.5}}})
    hist.push("Restored to earlier state", Snapshot.capture(doc), Snapshot.capture(doc),
              affected_widget_ids=["w1"], is_restore=True,
              widget_params_after={"w1": {"n1": {"exposure": 0.5}}})

    body = (await ac.get(f"/api/state/{sid}/widget-history/w1")).json()
    assert len(body["entries"]) == 1  # restore entry hidden from the timeline


@pytest.mark.asyncio
async def test_widget_history_empty_for_untouched_widget(client_with_session):
    ac, sid, _store = client_with_session
    r = await ac.get(f"/api/state/{sid}/widget-history/ghost")
    assert r.status_code == 200
    body = r.json()
    assert body["entries"] == []
    assert body["current_entry_id"] is None


@pytest.mark.asyncio
async def test_widget_history_404_unknown_session():
    from app.main import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/state/nope/widget-history/w1")
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_restore_widget_reapplies_params_as_new_forward_entry(client_with_session):
    ac, sid, store = client_with_session
    doc = store.get_document(sid)
    from app.session.history import Snapshot

    doc.add_widget(_widget("w1", "n1", {"exposure": 0.3}))
    hist = store.get_history(sid)
    entry = hist.push(
        "Setting exposure = 0.50", Snapshot.capture(doc), Snapshot.capture(doc),
        affected_widget_ids=["w1"],
        widget_params_before={"w1": {"n1": {"exposure": 0.9}}},
        widget_params_after={"w1": {"n1": {"exposure": 0.5}}},
    )
    # User has since moved exposure to 0.3 (the live value).
    doc.widgets["w1"].nodes[0].params["exposure"] = 0.3
    entries_before = len(hist.entries)

    r = await ac.post(f"/api/state/{sid}/restore-widget/w1/{entry.id}")
    assert r.status_code == 200, r.text
    assert r.json()["applied"] == "restore_widget_params"

    doc = store.get_document(sid)
    # Widget node + canonical restored to the entry's after-value.
    assert doc.widgets["w1"].nodes[0].params["exposure"] == 0.5
    assert doc.canonical["layer-1"]["basic"]["exposure"] == 0.5
    # Restore is itself a new forward history entry (synced with global history).
    assert len(store.get_history(sid).entries) == entries_before + 1


@pytest.mark.asyncio
async def test_restore_404_on_unknown_entry(client_with_session):
    ac, sid, store = client_with_session
    doc = store.get_document(sid)
    doc.add_widget(_widget("w1", "n1", {"exposure": 0.3}))
    r = await ac.post(f"/api/state/{sid}/restore-widget/w1/no_such_entry")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_restore_404_when_widget_not_in_entry(client_with_session):
    ac, sid, store = client_with_session
    doc = store.get_document(sid)
    from app.session.history import Snapshot
    doc.add_widget(_widget("w1", "n1", {"exposure": 0.3}))
    entry = store.get_history(sid).push(
        "other", Snapshot.capture(doc), Snapshot.capture(doc),
        affected_widget_ids=["w2"],
        widget_params_after={"w2": {"n9": {"contrast": 0.2}}},
    )
    r = await ac.post(f"/api/state/{sid}/restore-widget/w1/{entry.id}")
    assert r.status_code == 404
