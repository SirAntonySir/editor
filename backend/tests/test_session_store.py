import time
import pytest

from app.services.session_store import SessionStore, SessionNotFound


def test_create_and_get() -> None:
    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"abc", mime_type="image/jpeg")
    record = store.get(sid)
    assert record.image_bytes == b"abc"
    assert record.mime_type == "image/jpeg"
    assert record.context is None


def test_set_context() -> None:
    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"abc", mime_type="image/jpeg")
    store.set_context(sid, {"mood": "calm"})
    record = store.get(sid)
    assert record.context == {"mood": "calm"}


def test_expired_session_raises() -> None:
    store = SessionStore(ttl_seconds=0)
    sid = store.create(image_bytes=b"abc", mime_type="image/jpeg")
    time.sleep(0.01)
    with pytest.raises(SessionNotFound):
        store.get(sid)


def test_unknown_session_raises() -> None:
    store = SessionStore(ttl_seconds=60)
    with pytest.raises(SessionNotFound):
        store.get("nope")


def test_touch_refreshes_ttl() -> None:
    store = SessionStore(ttl_seconds=1)
    sid = store.create(image_bytes=b"abc", mime_type="image/jpeg")
    time.sleep(0.6)
    store.touch(sid)
    time.sleep(0.6)
    record = store.get(sid)  # would expire without touch
    assert record.image_bytes == b"abc"
