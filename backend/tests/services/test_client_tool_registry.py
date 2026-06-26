import asyncio

import pytest

from app.services.session_store import SessionStore


def test_new_request_returns_id_and_pending_future():
    store = SessionStore(ttl_seconds=3600)
    request_id, fut = store.new_client_request("sid-1")
    assert isinstance(request_id, str) and request_id
    assert isinstance(fut, asyncio.Future)
    assert not fut.done()


@pytest.mark.asyncio
async def test_resolve_sets_future_result():
    store = SessionStore(ttl_seconds=3600)
    request_id, fut = store.new_client_request("sid-1")
    ok = store.resolve_client_request("sid-1", request_id, {"ok": True, "output": 42})
    assert ok is True
    assert await fut == {"ok": True, "output": 42}


def test_resolve_unknown_request_returns_false():
    store = SessionStore(ttl_seconds=3600)
    assert store.resolve_client_request("sid-1", "nope", {"ok": True}) is False


@pytest.mark.asyncio
async def test_cancel_resolves_pending_as_denied():
    store = SessionStore(ttl_seconds=3600)
    _, fut = store.new_client_request("sid-1")
    n = store.cancel_client_requests("sid-1")
    assert n == 1
    assert await fut == {"ok": False, "denied": True, "error": "cancelled"}


@pytest.mark.asyncio
async def test_resolve_is_one_shot():
    store = SessionStore(ttl_seconds=3600)
    request_id, fut = store.new_client_request("sid-1")
    assert store.resolve_client_request("sid-1", request_id, {"ok": True}) is True
    # Second resolve of the same id no longer finds a pending future.
    assert store.resolve_client_request("sid-1", request_id, {"ok": True}) is False
    await fut


@pytest.mark.asyncio
async def test_cancel_task_also_rejects_pending_client_calls():
    store = SessionStore(ttl_seconds=3600)
    _, fut = store.new_client_request("sid-1")
    # cancel_task with no asyncio.Task registered still must drain client calls.
    store.cancel_task("sid-1")
    assert await fut == {"ok": False, "denied": True, "error": "cancelled"}
