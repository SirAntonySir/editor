"""Revive — rehydrate persisted SessionDocuments on backend startup.

Runs once at FastAPI startup (via the lifespan hook in main.py). Scans
SESSIONS_DIR for session directories containing a document.v1.json and
restores each into the SessionStore so the next API request finds an
already-hydrated record.

Errors per session are logged and skipped — one bad session doesn't
prevent the rest from coming back. The disk_session_io image file is
required (no document is useful without its source image); sessions
without one are left alone (they'll be cleaned up by prune_disk).
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from app.services import disk_session_io
from app.session import persistence
from app.session.persistence import CorruptDocumentError

if TYPE_CHECKING:
    from app.services.session_store import SessionStore

logger = logging.getLogger(__name__)


def revive_all(store: "SessionStore") -> int:
    """Restore every persisted session under SESSIONS_DIR into `store`.
    Returns the count revived. Safe to call multiple times — sessions
    already present in the store are skipped.
    """
    root = disk_session_io.SESSIONS_DIR
    if not root.exists():
        return 0

    revived = 0
    for entry in root.iterdir():
        if not entry.is_dir():
            continue
        sid = entry.name

        # Sanity: needs the image + meta to be useful.
        disk = disk_session_io.load_session(sid)
        if disk is None:
            logger.debug("revive: skip %s (no image/meta)", sid)
            continue

        try:
            payload = persistence.load_document(sid)
        except CorruptDocumentError:
            logger.warning("revive: skip %s (corrupt document)", sid)
            continue
        if payload is None:
            # Image present but no document.v1.json — fresh session that
            # never analysed. Let the existing on-demand path handle it.
            continue

        try:
            _hydrate_into_store(store, sid, disk, payload)
            revived += 1
        except Exception:
            logger.exception("revive: failed to hydrate sid=%s", sid)

    if revived:
        logger.info("revive: restored %d session(s) from disk", revived)
    return revived


def _hydrate_into_store(
    store: "SessionStore",
    sid: str,
    disk: disk_session_io.DiskRecord,
    payload: dict,
) -> None:
    """Build a SessionDocument from `payload` (already-validated dict) and a
    SessionRecord around it, register it with the store."""
    import time

    from app.services.session_store import SessionRecord
    from app.state.document import SessionDocument

    # Drop the version marker so model_validate doesn't trip on `extra="forbid"`.
    doc_dict = {k: v for k, v in payload.items() if k != "_schema_version"}
    # image_bytes is excluded from persistence; re-attach from disk_session_io.
    doc_dict["image_bytes"] = disk.image_bytes
    doc_dict["mime_type"] = disk.mime_type

    doc = SessionDocument.model_validate(doc_dict)

    now = time.monotonic()
    record = SessionRecord(
        image_bytes=disk.image_bytes,
        mime_type=disk.mime_type,
        created_at=now,
        last_seen=now,
        context=disk.context_json,
        document=doc,
    )
    # Direct insertion — we want to skip the on-demand lazy hydration since
    # we just did it ourselves. SessionStore exposes _records as a plain dict
    # and locks via _lock.
    with store._lock:
        store._records[sid] = record
