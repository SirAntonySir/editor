"""Pure disk I/O for SessionRecord persistence.

Layout per session:
    backend/.sessions/<sid>/
        image.<ext>     — raw uploaded bytes
        meta.json       — { mime_type, created_at, ai_access }
        context.json    — full ImageContext (or absent if not yet analysed)

This module is intentionally pure: it doesn't know about SessionStore,
SessionDocument, or any pydantic model. Caller serializes/deserializes
and hands plain bytes + dicts here.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class DiskRecord:
    image_bytes: bytes
    mime_type: str
    created_at: float
    context_json: dict[str, Any] | None
    # Study-design session constant. True = AI features available; False =
    # control condition (analysis / command-palette AI / suggestions hidden).
    # Defaults True so sessions persisted before this field existed read as
    # "AI on" — the pre-existing behaviour.
    ai_access: bool = True


# Anchor at the backend package root, NOT cwd. The launch scripts all
# `cd backend && uvicorn …` (see `npm run dev:backend` / Makefile:admin),
# so a relative `Path("backend/.sessions")` would resolve to
# `<repo>/backend/backend/.sessions/` — doubly-nested, and worse, it
# would silently move under us if some entrypoint launched from a
# different cwd. parents[2] from `app/services/disk_session_io.py` is
# `backend/`, regardless of how the process was launched.
_BACKEND_ROOT = Path(__file__).resolve().parents[2]
SESSIONS_DIR = _BACKEND_ROOT / ".sessions"


def _session_dir(sid: str) -> Path:
    return SESSIONS_DIR / sid


def migrate_legacy_sessions_dir() -> int:
    """Move any sessions found at the historical doubly-nested path
    (`<backend/>backend/.sessions/`, the cwd-relative artefact of launching
    uvicorn with `cd backend`) into the canonical SESSIONS_DIR. Returns the
    number of session directories moved. Safe to call multiple times: it
    no-ops when the legacy directory is empty or doesn't exist, and it
    refuses to clobber an existing canonical session of the same id.

    Called once at app startup so users who had data under the legacy
    path don't lose it after the SESSIONS_DIR anchoring change."""
    legacy = _BACKEND_ROOT / "backend" / ".sessions"
    try:
        legacy_resolved = legacy.resolve()
    except OSError:
        return 0
    if legacy_resolved == SESSIONS_DIR.resolve():
        return 0  # same path on the filesystem — paranoid guard
    if not legacy.exists() or not legacy.is_dir():
        return 0
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    moved = 0
    for entry in legacy.iterdir():
        if not entry.is_dir():
            continue
        target = SESSIONS_DIR / entry.name
        if target.exists():
            # Don't clobber a canonical session — the user can resolve
            # the duplicate by hand if they care.
            continue
        entry.rename(target)
        moved += 1
    return moved


_EXT_FOR_MIME = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


def _ext_for(mime: str) -> str:
    return _EXT_FOR_MIME.get(mime, "bin")


def save_session(
    sid: str,
    image_bytes: bytes,
    mime_type: str,
    created_at: float,
    ai_access: bool = True,
) -> None:
    """Write a new session's image + meta to disk. Idempotent — overwrites
    any existing files at the same path."""
    d = _session_dir(sid)
    d.mkdir(parents=True, exist_ok=True)
    (d / f"image.{_ext_for(mime_type)}").write_bytes(image_bytes)
    (d / "meta.json").write_text(
        json.dumps({
            "mime_type": mime_type,
            "created_at": created_at,
            "ai_access": ai_access,
        }),
    )


def save_ai_access(sid: str, ai_access: bool) -> None:
    """Flip the `ai_access` flag in an existing session's meta.json, preserving
    mime_type / created_at. No-op (creates nothing) when the session dir or
    meta.json is missing — the admin setter only targets sessions that exist."""
    meta_path = _session_dir(sid) / "meta.json"
    if not meta_path.exists():
        return
    try:
        meta = json.loads(meta_path.read_text())
    except (OSError, json.JSONDecodeError):
        return
    if not isinstance(meta, dict):
        return
    meta["ai_access"] = ai_access
    meta_path.write_text(json.dumps(meta))


def write_image(sid: str, image_node_id: str, image_bytes: bytes, mime_type: str) -> None:
    """Persist an additional image keyed by `image_node_id` next to the
    session's primary `image.<ext>` file. Layout:

        backend/.sessions/<sid>/
            image.<ext>           — primary (single-image carrier, unchanged)
            <image_node_id>.<ext> — additional image(s)

    The primary disk path is intentionally NOT touched even when the caller
    passes `image_node_id == "in-default"`, so the single-image bootstrap
    layout stays backwards-compatible. Creates the session dir if it doesn't
    already exist (defensive — callers usually create the session first via
    `save_session`).
    """
    d = _session_dir(sid)
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{image_node_id}.{_ext_for(mime_type)}").write_bytes(image_bytes)


# Inverse of _EXT_FOR_MIME — used by read_per_node_images to recover the
# MIME from a file extension on disk. Derived automatically at import time;
# adding a new MIME to _EXT_FOR_MIME is sufficient.
_MIME_FOR_EXT = {ext: mime for mime, ext in _EXT_FOR_MIME.items()}


def read_per_node_images(sid: str) -> dict[str, tuple[bytes, str]]:
    """Scan a session directory for per-image-node image files written by
    `write_image()`. Returns `{image_node_id: (bytes, mime_type)}`.

    Skips the primary `image.<ext>` (it lives in DiskRecord). Skips any
    file whose extension isn't a known image type — defends against
    incidental `.json` / `.txt` / dotfiles in the session dir. Assumes
    each stem appears with at most one known extension; today the caller
    in api/session.py mints fresh image_node_ids per upload, so this
    holds. If write_image is ever called twice for the same id with
    different MIME types, last-iterated wins (undefined filesystem order).

    Used by revive to restore SessionDocument.image_bytes_by_node +
    mime_type_by_node. Returns `{}` when the session dir doesn't exist.
    """
    d = _session_dir(sid)
    if not d.exists():
        return {}
    out: dict[str, tuple[bytes, str]] = {}
    for path in d.iterdir():
        if not path.is_file():
            continue
        stem = path.stem
        if stem == "image":
            continue  # primary, owned by save_session/load_session
        ext = path.suffix.lstrip(".")
        mime = _MIME_FOR_EXT.get(ext)
        if mime is None:
            continue
        out[stem] = (path.read_bytes(), mime)
    return out


def save_context(sid: str, context: dict[str, Any]) -> None:
    """Persist the per-session context.json. Creates the session dir if
    save_session hasn't been called yet (defensive — callers usually
    create the session first)."""
    d = _session_dir(sid)
    d.mkdir(parents=True, exist_ok=True)
    (d / "context.json").write_text(json.dumps(context))


def load_session(sid: str) -> DiskRecord | None:
    """Read a session from disk. Returns None if the session dir doesn't
    exist, the meta is missing, or the image file is missing."""
    d = _session_dir(sid)
    if not d.exists():
        return None
    meta_path = d / "meta.json"
    if not meta_path.exists():
        return None
    try:
        meta = json.loads(meta_path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    mime = meta.get("mime_type")
    if not isinstance(mime, str):
        return None
    image_path = d / f"image.{_ext_for(mime)}"
    if not image_path.exists():
        return None
    context_path = d / "context.json"
    context: dict[str, Any] | None = None
    if context_path.exists():
        try:
            loaded = json.loads(context_path.read_text())
            if isinstance(loaded, dict):
                context = loaded
        except (OSError, json.JSONDecodeError):
            context = None  # corrupt; caller treats as no-context
    return DiskRecord(
        image_bytes=image_path.read_bytes(),
        mime_type=mime,
        created_at=float(meta.get("created_at", time.time())),
        context_json=context,
        ai_access=bool(meta.get("ai_access", True)),
    )


def delete_session(sid: str) -> None:
    """Recursively remove a session's directory. No-op if it doesn't exist."""
    d = _session_dir(sid)
    if not d.exists():
        return
    # Two passes: files first, then empty dirs.
    for p in d.rglob("*"):
        if p.is_file():
            try:
                p.unlink()
            except OSError:
                pass
    for p in sorted(d.rglob("*"), reverse=True):
        if p.is_dir():
            try:
                p.rmdir()
            except OSError:
                pass
    try:
        d.rmdir()
    except OSError:
        pass
