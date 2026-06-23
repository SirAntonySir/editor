"""Revive — rehydrate persisted SessionDocuments on backend startup.

Runs once at FastAPI startup (via the lifespan hook in main.py). Scans
SESSIONS_DIR for session directories containing a document.v1.json and
restores each into the SessionStore so the next API request finds an
already-hydrated record.

Errors per session are logged and skipped — one bad session doesn't
prevent the rest from coming back. The disk_session_io image file is
required (no document is useful without its source image); sessions
without one are left alone (they'll be cleaned up by prune_disk).

Per-image-node doctrine (see app/state/document.py):
  After model_validate, every revived document is passed through
  `_promote_singletons_to_per_node()` so legacy singleton state is
  promoted into the per-node dicts and the singletons are cleared.
  Then `disk_session_io.read_per_node_images()` rebuilds any
  additional per-node image bytes from disk (written by
  `api/session.py:add_image_to_session`). After revive, no document
  in the store has any data in the legacy singleton fields.
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
    SessionRecord around it, register it with the store.

    The on-disk document never carries image_bytes / mime / per-node image
    bytes — those are reattached here from disk_session_io. After
    model_validate we run `_promote_singletons_to_per_node()` so any
    pre-migration payload (singleton image_context / prepare_result) converges
    to the per-node-only doctrine before any tool touches it.
    """
    import time

    from app.services.session_store import SessionRecord
    from app.state.document import DEFAULT_IMAGE_NODE_ID, SessionDocument

    # Drop the version marker so model_validate doesn't trip on `extra="forbid"`.
    doc_dict = {k: v for k, v in payload.items() if k != "_schema_version"}
    # Legacy singletons may carry stale (or absent) data; we'll empty them
    # in the promotion step below. Re-attach the primary image just so
    # _promote_singletons_to_per_node can move it into in-default.
    doc_dict["image_bytes"] = disk.image_bytes
    doc_dict["mime_type"] = disk.mime_type

    doc = SessionDocument.model_validate(doc_dict)
    # Step 1: promote any legacy singleton state into the per-node dicts.
    # After this, doc.image_bytes / doc.image_context / doc.prepare_result
    # are empty; everything lives under image_*_by_node.
    doc._promote_singletons_to_per_node()
    # Step 2: rehydrate any additional per-node images written via
    # api/session.py:add_image_to_session. read_per_node_images returns
    # {image_node_id: (bytes, mime)} for every file other than the primary.
    for image_node_id, (data, mime) in disk_session_io.read_per_node_images(sid).items():
        # Don't overwrite — promotion above already put the primary at in-default.
        if image_node_id in doc.image_bytes_by_node:
            continue
        doc.set_image_bytes(image_node_id, data, mime_type=mime)

    now = time.monotonic()
    record = SessionRecord(
        image_bytes=disk.image_bytes,
        mime_type=disk.mime_type,
        created_at=now,
        last_seen=now,
        context=disk.context_json,
        ai_access=disk.ai_access,
        document=doc,
    )
    # Direct insertion — we want to skip the on-demand lazy hydration since
    # we just did it ourselves. SessionStore exposes _records as a plain dict
    # and locks via _lock.
    with store._lock:
        store._records[sid] = record
