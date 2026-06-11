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


def test_expired_session_no_disk_raises(tmp_path, monkeypatch) -> None:
    # Redirect disk I/O to a fresh temp dir. The session is created but then
    # the disk copy is removed, so after the in-memory TTL expires there is
    # nowhere to rehydrate from → SessionNotFound must be raised.
    from app.services import disk_session_io
    monkeypatch.setattr("app.services.disk_session_io.SESSIONS_DIR", tmp_path)
    store = SessionStore(ttl_seconds=0)
    sid = store.create(image_bytes=b"abc", mime_type="image/jpeg")
    # Purge the disk copy so the expiry cannot fall back.
    disk_session_io.delete_session(sid)
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


from app.state.document import SessionDocument


def test_get_document_returns_aggregate() -> None:
    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"abc", mime_type="image/jpeg")
    doc = store.get_document(sid)
    assert isinstance(doc, SessionDocument)
    assert doc.session_id == sid
    assert doc.image_bytes == b"abc"


def test_get_document_returns_same_instance_within_session() -> None:
    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"abc", mime_type="image/jpeg")
    doc_a = store.get_document(sid)
    doc_b = store.get_document(sid)
    assert doc_a is doc_b


def test_with_document_lock_serialises_mutations() -> None:
    import threading
    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"abc", mime_type="image/jpeg")
    order: list[str] = []

    def worker(tag: str) -> None:
        with store.with_document_lock(sid):
            order.append(f"{tag}-start")
            order.append(f"{tag}-end")

    threads = [threading.Thread(target=worker, args=(t,)) for t in ("a", "b", "c")]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # Inside each lock the start/end must be adjacent — i.e. no interleaving.
    for i in range(0, len(order), 2):
        tag = order[i].split("-")[0]
        assert order[i + 1] == f"{tag}-end"


def test_with_document_lock_on_unknown_session_raises() -> None:
    store = SessionStore(ttl_seconds=60)
    with pytest.raises(SessionNotFound):
        with store.with_document_lock("nope"):
            pass
