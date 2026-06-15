import asyncio
import json
import socket
import threading
import time
from contextlib import contextmanager

import httpx
import pytest
import uvicorn
from httpx import ASGITransport, AsyncClient

from app.api import deps
from app.schemas.widget import MaskRecord, Scope, Widget, WidgetOrigin, WidgetPreview


@pytest.mark.asyncio
async def test_state_snapshot_returns_revision() -> None:
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
        sid = (await ac.post("/api/session", files=files)).json()["session_id"]
        r = await ac.get(f"/api/state/{sid}")
        assert r.status_code == 200
        body = r.json()
        assert body["sessionId"] == sid
        assert body["revision"] == 0
        assert body["widgets"] == []


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.mark.asyncio
async def test_state_sse_delivers_widget_created() -> None:
    """SSE is unbuffered streaming — httpx.ASGITransport buffers the full
    response before returning, so it cannot observe an indefinite SSE stream.
    Run a real uvicorn server on a free port instead."""
    from app.main import app

    port = _free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="on")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    # Wait for the server to come up.
    for _ in range(50):
        if server.started:
            break
        time.sleep(0.05)
    assert server.started, "uvicorn did not start"

    try:
        base = f"http://127.0.0.1:{port}"
        async with httpx.AsyncClient(base_url=base, timeout=5.0) as ac:
            files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
            sid = (await ac.post("/api/session", files=files)).json()["session_id"]

            seen_event_lines: list[str] = []

            async def consume() -> dict | None:
                async with ac.stream("GET", f"/api/state/{sid}/events") as r:
                    async for raw in r.aiter_lines():
                        # The frontend consumes the stream via EventSource.onmessage,
                        # which only fires for UNNAMED events. A named "event:" line
                        # would route to addEventListener("<name>") instead and
                        # silently drop every live event. Guard against regressing
                        # back to named events.
                        if raw.startswith("event:"):
                            seen_event_lines.append(raw)
                        if not raw or not raw.startswith("data: "):
                            continue
                        payload = json.loads(raw[6:])
                        if payload.get("kind") == "widget.created":
                            return payload
                return None

            task = asyncio.create_task(consume())
            # Give the SSE handler time to subscribe.
            await asyncio.sleep(0.3)
            doc = deps.get_session_store().get_document(sid)
            doc.add_widget(Widget(
                id="w_1", intent="warm",
                scope=Scope.model_validate({"kind": "global"}),
                origin=WidgetOrigin(kind="mcp_user_prompt", prompt="warm"),
                preview=WidgetPreview(kind="thumbnail", auto_before_after=True),
            ))
            deps.get_event_bus().publish(sid, doc.history[-1])
            out = await asyncio.wait_for(task, timeout=3.0)
            assert out is not None
            assert out["kind"] == "widget.created"
            # Stream must be unnamed so EventSource.onmessage fires on the client.
            assert seen_event_lines == [], (
                f"SSE stream emitted named event lines (breaks onmessage): {seen_event_lines}"
            )
    finally:
        server.should_exit = True
        thread.join(timeout=5.0)


@pytest.mark.asyncio
async def test_get_mask_bytes_returns_png_b64() -> None:
    """GET /api/state/{sid}/masks/{mask_id} returns full mask record with png_b64."""
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
        sid = (await ac.post("/api/session", files=files)).json()["session_id"]

        # Inject a mask directly into the document.
        doc = deps.get_session_store().get_document(sid)
        mask = MaskRecord(
            id="m_test_1",
            width=4,
            height=4,
            png_b64="aGVsbG8=",  # base64("hello") — just needs to be non-empty
            source="sam_box",
            label="sky",
        )
        doc.masks[mask.id] = mask

        r = await ac.get(f"/api/state/{sid}/masks/{mask.id}")
        assert r.status_code == 200
        body = r.json()
        assert body["id"] == "m_test_1"
        assert body["width"] == 4
        assert body["height"] == 4
        assert body["source"] == "sam_box"
        assert body["label"] == "sky"
        assert body["png_b64"] == "aGVsbG8="


@pytest.mark.asyncio
async def test_get_mask_bytes_404_unknown_session() -> None:
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.get("/api/state/no_such_sid/masks/m_1")
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_get_mask_bytes_404_unknown_mask() -> None:
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
        sid = (await ac.post("/api/session", files=files)).json()["session_id"]
        r = await ac.get(f"/api/state/{sid}/masks/no_such_mask")
        assert r.status_code == 404


# ---------- Last-Event-Id replay ----------


def _parse_sse_lines(raw_lines: list[str]) -> list[dict]:
    """Group consecutive raw SSE lines into event dicts.
    Returns a list of {"id": str|None, "data": dict|None} per event."""
    events: list[dict] = []
    pending_id: str | None = None
    pending_data: str | None = None
    for line in raw_lines:
        if line.startswith("id:"):
            pending_id = line[3:].strip()
        elif line.startswith("data:"):
            pending_data = line[5:].strip()
        elif line == "":
            if pending_data is not None:
                events.append({"id": pending_id, "data": json.loads(pending_data)})
            pending_id = None
            pending_data = None
    return events


async def _collect_initial(stream, max_events: int, timeout: float = 1.5) -> list[dict]:
    """Read SSE lines until we've seen `max_events` complete events or the
    timeout fires. Used to capture the replay burst before the stream goes
    live (and blocks)."""
    lines: list[str] = []
    try:
        async with asyncio.timeout(timeout):
            async for raw in stream.aiter_lines():
                lines.append(raw)
                # Count blank-line separators — one per complete event.
                blank_count = sum(1 for L in lines if L == "")
                if blank_count >= max_events:
                    break
    except asyncio.TimeoutError:
        pass
    return _parse_sse_lines(lines)


@pytest.mark.asyncio
async def test_sse_replay_from_last_event_id() -> None:
    """Reconnect with Last-Event-ID < newest revision → backend replays the
    missing entries from doc.history (each with its own id: line)."""
    from app.main import app

    port = _free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="on")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(50):
        if server.started:
            break
        time.sleep(0.05)
    assert server.started

    try:
        base = f"http://127.0.0.1:{port}"
        async with httpx.AsyncClient(base_url=base, timeout=5.0) as ac:
            files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
            sid = (await ac.post("/api/session", files=files)).json()["session_id"]

            doc = deps.get_session_store().get_document(sid)
            # Build 5 events. Frontend pretends to have seen up to revision 2.
            for i in range(5):
                doc.set_param("layer-1", "basic", "exposure", float(i))
            assert doc.revision == 5

            async with ac.stream(
                "GET",
                f"/api/state/{sid}/events",
                headers={"Last-Event-ID": "2"},
            ) as r:
                # Expect 3 replay events (revisions 3, 4, 5), no gap.
                events = await _collect_initial(r, max_events=3, timeout=2.0)

            assert len(events) == 3, f"expected 3 replay events, got {len(events)}: {events}"
            revisions = [int(e["id"]) for e in events]
            assert revisions == [3, 4, 5]
            kinds = [e["data"]["kind"] for e in events]
            assert all(k == "canonical.updated" for k in kinds)
    finally:
        server.should_exit = True
        thread.join(timeout=5.0)


@pytest.mark.asyncio
async def test_sse_gap_event_when_last_event_id_older_than_history() -> None:
    """When Last-Event-ID points before the oldest entry in (a pruned)
    doc.history, the backend can't replay — it emits a synthetic
    state.gap event so the frontend knows to refetch the snapshot."""
    from app.main import app

    port = _free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="on")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(50):
        if server.started:
            break
        time.sleep(0.05)
    assert server.started

    try:
        base = f"http://127.0.0.1:{port}"
        async with httpx.AsyncClient(base_url=base, timeout=5.0) as ac:
            files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
            sid = (await ac.post("/api/session", files=files)).json()["session_id"]

            doc = deps.get_session_store().get_document(sid)
            # Emit a burst, then prune so oldest revision in history is 8+.
            for i in range(10):
                doc.set_param("layer-1", "basic", "exposure", float(i))
            doc.prune_history(3)
            # history now holds revisions {8, 9, 10}; pretend frontend last
            # saw revision 1 — much older than oldest (8).
            assert doc.history[0].revision == 8

            async with ac.stream(
                "GET",
                f"/api/state/{sid}/events",
                headers={"Last-Event-ID": "1"},
            ) as r:
                events = await _collect_initial(r, max_events=1, timeout=2.0)

            assert len(events) >= 1
            gap = events[0]
            assert gap["data"]["kind"] == "state.gap"
            assert gap["data"]["payload"] == {"reason": "history_pruned"}
            # id of the gap event is the newest revision so the browser
            # treats it as a forward marker, not a stale duplicate.
            assert int(gap["id"]) == 10
    finally:
        server.should_exit = True
        thread.join(timeout=5.0)


@pytest.mark.asyncio
async def test_sse_no_replay_when_last_event_id_at_or_past_newest() -> None:
    """Last-Event-ID == newest revision → nothing to replay, stream goes
    live with no preamble. Same for a future/garbage id."""
    from app.main import app

    port = _free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="on")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(50):
        if server.started:
            break
        time.sleep(0.05)
    assert server.started

    try:
        base = f"http://127.0.0.1:{port}"
        async with httpx.AsyncClient(base_url=base, timeout=5.0) as ac:
            files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
            sid = (await ac.post("/api/session", files=files)).json()["session_id"]
            doc = deps.get_session_store().get_document(sid)
            for i in range(3):
                doc.set_param("layer-1", "basic", "exposure", float(i))

            # Last-Event-ID equal to newest — no replay expected.
            async with ac.stream(
                "GET",
                f"/api/state/{sid}/events",
                headers={"Last-Event-ID": "3"},
            ) as r:
                events = await _collect_initial(r, max_events=1, timeout=1.0)
            assert events == []

            # Garbage Last-Event-ID — treated as "no Last-Event-ID", still
            # no replay (replay only triggers on a parseable value < newest).
            async with ac.stream(
                "GET",
                f"/api/state/{sid}/events",
                headers={"Last-Event-ID": "not-a-number"},
            ) as r:
                events = await _collect_initial(r, max_events=1, timeout=1.0)
            assert events == []
    finally:
        server.should_exit = True
        thread.join(timeout=5.0)


# ---------- C9 regression: read routes acquire the document write lock ----------


@pytest.mark.asyncio
async def test_state_snapshot_acquires_document_lock(monkeypatch: pytest.MonkeyPatch) -> None:
    """C9 regression: GET /api/state/{sid} reads under the document write lock."""
    from app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        files = {"image": ("t.jpg", b"\xff\xd8\xff" + b"\x00" * 100, "image/jpeg")}
        r = await ac.post("/api/session", files=files)
        assert r.status_code == 200
        sid = r.json()["session_id"]

        store = deps.get_session_store()
        calls: list[str] = []
        real_lock = store.with_document_lock

        @contextmanager
        def spy(s: str):
            calls.append(s)
            with real_lock(s) as doc:
                yield doc

        monkeypatch.setattr(store, "with_document_lock", spy)
        r = await ac.get(f"/api/state/{sid}")
        assert r.status_code == 200
        assert sid in calls


@pytest.mark.asyncio
async def test_state_events_acquires_document_lock(monkeypatch: pytest.MonkeyPatch) -> None:
    """C9 regression: GET /api/state/{sid}/events captures the replay under the lock."""
    from app.main import app

    port = _free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="on")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(50):
        if server.started:
            break
        time.sleep(0.05)
    assert server.started, "uvicorn did not start"

    try:
        base = f"http://127.0.0.1:{port}"
        async with httpx.AsyncClient(base_url=base, timeout=5.0) as ac:
            files = {"image": ("t.jpg", b"\xff\xd8\xff" + b"\x00" * 100, "image/jpeg")}
            r = await ac.post("/api/session", files=files)
            assert r.status_code == 200
            sid = r.json()["session_id"]

            store = deps.get_session_store()
            calls: list[str] = []
            real_lock = store.with_document_lock

            @contextmanager
            def spy(s: str):
                calls.append(s)
                with real_lock(s) as doc:
                    yield doc

            monkeypatch.setattr(store, "with_document_lock", spy)

            # Open the SSE stream and collect the initial burst; the lock is
            # acquired during the subscribe + replay prologue before the live loop.
            async with ac.stream("GET", f"/api/state/{sid}/events") as resp:
                assert resp.status_code == 200
                # Read at least one line to ensure the prologue has run.
                await _collect_initial(resp, max_events=0, timeout=0.5)

            assert sid in calls
    finally:
        server.should_exit = True
        thread.join(timeout=5.0)


@pytest.mark.asyncio
async def test_get_mask_bytes_acquires_document_lock(monkeypatch: pytest.MonkeyPatch) -> None:
    """C9 regression: GET /api/state/{sid}/masks/{mid} reads under the lock.
    A missing mask id produces a 404 that is raised INSIDE the lock block,
    so the lock is still acquired before the not-found response."""
    from app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        files = {"image": ("t.jpg", b"\xff\xd8\xff" + b"\x00" * 100, "image/jpeg")}
        r = await ac.post("/api/session", files=files)
        assert r.status_code == 200
        sid = r.json()["session_id"]

        store = deps.get_session_store()
        calls: list[str] = []
        real_lock = store.with_document_lock

        @contextmanager
        def spy(s: str):
            calls.append(s)
            with real_lock(s) as doc:
                yield doc

        monkeypatch.setattr(store, "with_document_lock", spy)
        r = await ac.get(f"/api/state/{sid}/masks/m_missing")
        assert r.status_code == 404
        assert sid in calls
