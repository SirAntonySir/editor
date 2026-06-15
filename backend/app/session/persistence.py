"""Pure disk I/O for the persisted SessionDocument artifact.

Storage layout under `backend/.sessions/<sid>/`:

    image.<ext>             — raw uploaded bytes (owned by disk_session_io)
    meta.json               — mime_type + created_at (owned by disk_session_io)
    context.json            — legacy ImageContext cache (owned by disk_session_io)
    document.v1.json        — full SessionDocument snapshot — owned by us
    document.v1.bak.json    — rotated previous version (crash recovery)

`document.v1.json` excludes fields that are either huge (image_bytes —
already on disk), regenerable (prepare_result — produced by prepare_image),
or runtime-only (private event-sink attrs).

This module is intentionally pure. Caller hands us a SessionDocument and a
session id; we serialise, write atomically, rotate. No knowledge of the
SessionStore, the engine, the event bus.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

from app.services import disk_session_io

# Bump when the on-disk shape of `document.v1.json` changes in a way that
# requires a migration. The current loader rejects any version it doesn't
# know — migrations land in app/session/migrations/ alongside this file.
SCHEMA_VERSION: int = 1

# Fields the persisted JSON intentionally omits. Order matches SessionDocument.
# Per-image-node doctrine: image_bytes are on disk under
# .sessions/<sid>/<image_node_id>.<ext>; prepare_result is a numpy-laden
# dataclass regenerated on demand by PrepareImageTool. image_context_by_node
# IS persisted (small + costly to regenerate). See _promote_singletons_to_per_node
# in app/state/document.py for the migration doctrine.
_EXCLUDE_FROM_PERSIST: set[str] = {
    "image_bytes",            # legacy singleton; multi-MB; image.<ext> already on disk
    "prepare_result",         # legacy singleton; regenerable by prepare_image tool
    "image_bytes_by_node",    # multi-MB per entry; restored on revive from disk
    "mime_type_by_node",      # restored on revive alongside the bytes
    "prepare_result_by_node", # numpy-laden dataclass; regenerable by prepare_image tool
}


def _document_path(sid: str) -> Path:
    return disk_session_io.SESSIONS_DIR / sid / f"document.v{SCHEMA_VERSION}.json"


def _backup_path(sid: str) -> Path:
    return disk_session_io.SESSIONS_DIR / sid / f"document.v{SCHEMA_VERSION}.bak.json"


def _atomic_write(path: Path, payload: bytes) -> None:
    """Write `payload` to `path` via a tmp-file + rename. Survives a crash
    mid-write — either the old file or the new one wins, never a half-write.

    `delete=False` and an explicit replace are required because NamedTemporaryFile
    auto-deletes on close otherwise. Same-directory tmp guarantees rename is
    atomic on the same filesystem (POSIX requirement)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".tmp-", suffix=path.suffix, dir=str(path.parent))
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def dump_document(doc: "Any", sid: str) -> None:
    """Serialise `doc` and atomically write it to disk. Rotates the existing
    document.v1.json to .bak.json so a corrupted write doesn't lose ground.

    `doc` is typed Any to avoid a circular import (app.state.document imports
    app.schemas, which we may need to import here for future migrations).
    Caller is expected to pass a SessionDocument.
    """
    payload_obj: dict[str, Any] = {
        "_schema_version": SCHEMA_VERSION,
        **doc.model_dump(mode="json", by_alias=False, exclude=_EXCLUDE_FROM_PERSIST),
    }
    payload = json.dumps(payload_obj, separators=(",", ":")).encode("utf-8")

    target = _document_path(sid)
    backup = _backup_path(sid)

    if target.exists():
        # Best-effort rotation — if the rename fails (perms, file gone), we
        # still try to write the new payload. Worst case a crash mid-write
        # leaves us without a backup; the next successful write restores it.
        try:
            os.replace(target, backup)
        except OSError:
            pass

    _atomic_write(target, payload)


class CorruptDocumentError(ValueError):
    """Raised when document.v1.json is present but unparseable / version
    mismatch / shape-invalid. Caller decides whether to fall back to .bak."""


def load_document(sid: str) -> dict[str, Any] | None:
    """Read document.v1.json and return the parsed dict (NOT a SessionDocument
    instance — the revive path knows how to rehydrate one from this dict
    together with image bytes from disk_session_io).

    Returns None when no document exists for this session — that's the normal
    case for a freshly-created session whose first analyze hasn't fired yet.

    Falls back to document.v1.bak.json automatically if the primary file is
    corrupt. Raises CorruptDocumentError only when BOTH the primary and
    backup are unreadable — that's a real data loss event the caller should
    surface.

    Older payloads (`_schema_version < SCHEMA_VERSION`) are forwarded through
    the migrations chain in `app.session.migrations`. Payloads from a NEWER
    backend (`> SCHEMA_VERSION`) are treated as corrupt — downgrade isn't
    supported.
    """
    from app.session.migrations import MigrationError, migrate_to_current

    target = _document_path(sid)
    backup = _backup_path(sid)

    primary_err: Exception | None = None
    for path in (target, backup):
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError) as exc:
            primary_err = exc
            continue
        if not isinstance(data, dict):
            primary_err = ValueError(f"{path.name}: top-level not an object")
            continue
        try:
            data = migrate_to_current(data, SCHEMA_VERSION)
        except MigrationError as exc:
            primary_err = exc
            continue
        return data

    if primary_err is not None:
        raise CorruptDocumentError(
            f"session {sid}: both document.v{SCHEMA_VERSION}.json and "
            f".bak unreadable: {primary_err!r}"
        )
    return None
