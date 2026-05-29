import asyncio
import json
import socket
import threading
import time

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
        assert body["session_id"] == sid
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
