import asyncio
import json
import os
import time
import pytest

from app.services.session_store import SessionStore, SessionNotFound, _last_activity_mtime


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
    from app.state.document import DEFAULT_IMAGE_NODE_ID
    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"abc", mime_type="image/jpeg")
    doc = store.get_document(sid)
    assert isinstance(doc, SessionDocument)
    assert doc.session_id == sid
    # Per-node doctrine: bytes live in per-node dict, not the legacy singleton.
    assert doc.image_bytes == b""
    assert doc.image_bytes_by_node[DEFAULT_IMAGE_NODE_ID] == b"abc"


def test_get_document_returns_same_instance_within_session() -> None:
    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"abc", mime_type="image/jpeg")
    doc_a = store.get_document(sid)
    doc_b = store.get_document(sid)
    assert doc_a is doc_b


def test_with_document_lock_serialises_mutations() -> None:
    """Concurrent coroutines must not interleave inside the document lock.
    Each (start, end) pair has to be adjacent in `order`.

    Async by design — `with_document_lock` is an asyncio context manager
    now. The threaded form the lock used to support became a footgun: any
    sync-lock acquire from inside an async handler would block the event
    loop on contention. asyncio.Lock queues coroutines cooperatively
    instead, which is what every real production caller does."""
    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"abc", mime_type="image/jpeg")
    order: list[str] = []

    async def worker(tag: str) -> None:
        async with store.with_document_lock(sid):
            order.append(f"{tag}-start")
            # Yield so any non-mutex implementation would interleave here.
            await asyncio.sleep(0)
            order.append(f"{tag}-end")

    async def runner() -> None:
        await asyncio.gather(*(worker(t) for t in ("a", "b", "c")))

    asyncio.run(runner())

    # Inside each lock the start/end must be adjacent — i.e. no interleaving.
    assert len(order) == 6
    for i in range(0, len(order), 2):
        tag = order[i].split("-")[0]
        assert order[i + 1] == f"{tag}-end"


def test_with_document_lock_on_unknown_session_raises() -> None:
    store = SessionStore(ttl_seconds=60)

    async def runner() -> None:
        async with store.with_document_lock("nope"):
            pass

    with pytest.raises(SessionNotFound):
        asyncio.run(runner())


def test_cancel_task_with_no_registration_returns_false() -> None:
    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"abc", mime_type="image/jpeg")
    assert store.cancel_task(sid) is False


def test_cancel_task_interrupts_registered_task() -> None:
    """register_task + cancel_task triggers CancelledError inside the running
    coroutine. This is the contract the tool registry relies on for the
    /session/{sid}/cancel endpoint."""
    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"abc", mime_type="image/jpeg")
    cancelled_flag = {"value": False}

    async def runner() -> None:
        task = asyncio.current_task()
        store.register_task(sid, task)
        # Schedule the cancel from a sibling task so it lands at the sleep below.
        async def fire_cancel() -> None:
            await asyncio.sleep(0)
            store.cancel_task(sid)
        asyncio.create_task(fire_cancel())
        try:
            await asyncio.sleep(1.0)
        except asyncio.CancelledError:
            cancelled_flag["value"] = True
            raise
        finally:
            store.clear_task(sid)

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(runner())
    assert cancelled_flag["value"] is True


def test_clear_task_removes_registration() -> None:
    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"abc", mime_type="image/jpeg")

    async def runner() -> None:
        store.register_task(sid, asyncio.current_task())
        store.clear_task(sid)
        # After clear_task, cancel_task is a no-op.
        assert store.cancel_task(sid) is False

    asyncio.run(runner())


def test_get_document_leaves_context_absent_on_corrupt_cache(tmp_path, monkeypatch):
    """If record.context is a malformed dict that doesn't satisfy
    EnrichedImageContext, _rehydrate_document_context's exception branch
    must leave BOTH the legacy singleton AND the per-node entry empty so
    the next analyze run repopulates cleanly."""
    from app.services import disk_session_io
    from app.services.session_store import SessionStore
    from app.state.document import DEFAULT_IMAGE_NODE_ID

    monkeypatch.setattr(disk_session_io, "SESSIONS_DIR", tmp_path)
    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"X", mime_type="image/jpeg")
    # Inject a malformed context dict on the record so the rehydration's
    # try/except fires when get_document instantiates the document.
    record = store.get(sid)
    record.context = {"this": "is not an EnrichedImageContext"}
    record.document = None  # force lazy creation on get_document
    doc = store.get_document(sid)
    assert doc.image_context is None
    assert DEFAULT_IMAGE_NODE_ID not in doc.image_context_by_node


def test_get_document_on_fresh_session_uses_per_node_bytes(tmp_path, monkeypatch):
    """A session whose document is being lazy-created (never persisted yet)
    must end up with the upload bytes in image_bytes_by_node[in-default]
    and the legacy singleton empty — matching the post-revive shape."""
    from app.services import disk_session_io
    from app.services.session_store import SessionStore
    from app.state.document import DEFAULT_IMAGE_NODE_ID

    monkeypatch.setattr(disk_session_io, "SESSIONS_DIR", tmp_path)
    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"PAYLOAD", mime_type="image/png")
    doc = store.get_document(sid)
    assert doc.image_bytes == b""
    assert doc.mime_type == "image/jpeg"  # neutral default — never touched
    assert doc.image_bytes_by_node[DEFAULT_IMAGE_NODE_ID] == b"PAYLOAD"
    assert doc.mime_type_by_node[DEFAULT_IMAGE_NODE_ID] == "image/png"


def _mk_session_dir(root, sid: str, *, files: dict[str, bytes], mtime_offset: float = 0.0):
    """Stand up a minimal on-disk session directory at root/sid and stamp
    each file's mtime to `now - mtime_offset` seconds. Returns the path."""
    d = root / sid
    d.mkdir(parents=True, exist_ok=True)
    now = time.time()
    for name, payload in files.items():
        p = d / name
        p.write_bytes(payload)
        os.utime(p, (now - mtime_offset, now - mtime_offset))
    return d


def test_prune_disk_uses_last_activity_not_creation(tmp_path, monkeypatch) -> None:
    """A session whose meta.json says 'created 2h ago' but whose events.jsonl
    was written 1 minute ago must survive a 1h pruner — the pruner keys off
    last activity, not creation. Regression guard for the asymmetry that
    used to wipe an active long-running session."""
    from app.services import disk_session_io
    monkeypatch.setattr("app.services.disk_session_io.SESSIONS_DIR", tmp_path)

    # Old creation marker but a freshly-written events.jsonl.
    d = _mk_session_dir(
        tmp_path,
        "active-session",
        files={
            "meta.json": json.dumps({"created_at": time.time() - 7200}).encode(),
            "events.jsonl": b'{"kind":"state.replaced"}\n',
        },
    )
    # Make meta.json look old (2h) while events.jsonl stays fresh.
    old = time.time() - 7200
    os.utime(d / "meta.json", (old, old))

    store = SessionStore(ttl_seconds=60)
    pruned = store.prune_disk(max_age_seconds=3600)
    assert pruned == 0
    assert d.exists()


def test_prune_disk_deletes_truly_idle_session(tmp_path, monkeypatch) -> None:
    """A session whose *all* mutating files are older than the cutoff is
    deleted. Confirms the pruner still does its job for genuinely stale
    state."""
    from app.services import disk_session_io
    monkeypatch.setattr("app.services.disk_session_io.SESSIONS_DIR", tmp_path)

    d = _mk_session_dir(
        tmp_path,
        "idle-session",
        files={
            "meta.json": b"{}",
            "events.jsonl": b'{"kind":"state.replaced"}\n',
            "state.json": b"{}",
        },
        mtime_offset=7200,  # 2h ago across the board
    )

    store = SessionStore(ttl_seconds=60)
    pruned = store.prune_disk(max_age_seconds=3600)
    assert pruned == 1
    assert not d.exists()


def test_prune_disk_skips_incomplete_directory(tmp_path, monkeypatch) -> None:
    """A session directory with none of the canonical mutating files is
    treated as incomplete and skipped rather than deleted — caller might
    be mid-write."""
    from app.services import disk_session_io
    monkeypatch.setattr("app.services.disk_session_io.SESSIONS_DIR", tmp_path)

    d = tmp_path / "half-baked"
    d.mkdir()
    (d / "image.png").write_bytes(b"PNG")  # not in the candidate list

    store = SessionStore(ttl_seconds=60)
    pruned = store.prune_disk(max_age_seconds=3600)
    assert pruned == 0
    assert d.exists()


def test_last_activity_mtime_returns_newest(tmp_path) -> None:
    """_last_activity_mtime picks the newest mtime across the candidate
    files; missing files don't disqualify the session."""
    d = tmp_path / "sess"
    d.mkdir()
    now = time.time()
    (d / "meta.json").write_bytes(b"{}")
    os.utime(d / "meta.json", (now - 3600, now - 3600))
    (d / "events.jsonl").write_bytes(b'{}\n')
    os.utime(d / "events.jsonl", (now - 30, now - 30))
    # state.json absent
    mtime = _last_activity_mtime(d)
    assert mtime is not None
    assert abs(mtime - (now - 30)) < 2  # the newest wins
