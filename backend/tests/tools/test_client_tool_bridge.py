import asyncio

import pytest

from app.services.session_store import SessionStore
from app.state.events import EventBus
from app.tools.client_tool_bridge import request_client_tool


@pytest.mark.asyncio
async def test_request_emits_event_and_returns_resolved_result():
    store = SessionStore(ttl_seconds=3600)
    store.create(image_bytes=b"x", mime_type="image/jpeg")
    sid = next(iter(store._records.keys()))
    bus = EventBus()
    queue = bus.subscribe(sid)

    async def fake_client():
        ev = await queue.get()
        assert ev.kind == "client.tool_request"
        request_id = ev.payload["request_id"]
        assert ev.payload["name"] == "list_objects"
        assert ev.payload["kind"] == "query"
        store.resolve_client_request(sid, request_id, {"ok": True, "output": ["a"]})

    client = asyncio.create_task(fake_client())
    result = await request_client_tool(
        store, bus, sid, name="list_objects", input={}, kind="query", timeout=2.0
    )
    await client
    assert result == {"ok": True, "output": ["a"]}


@pytest.mark.asyncio
async def test_request_times_out_as_denied():
    store = SessionStore(ttl_seconds=3600)
    store.create(image_bytes=b"x", mime_type="image/jpeg")
    sid = next(iter(store._records.keys()))
    bus = EventBus()
    bus.subscribe(sid)  # subscriber exists but never resolves
    result = await request_client_tool(
        store, bus, sid, name="extract_object_to_image_node", input={"maskId": "m1"},
        kind="mutate", timeout=0.05,
    )
    assert result == {"ok": False, "denied": True, "error": "timeout"}
