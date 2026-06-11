"""Pure disk I/O for SessionRecord persistence.

Layout per session:
    backend/.sessions/<sid>/
        image.<ext>     — raw uploaded bytes
        meta.json       — { mime_type, created_at }
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


SESSIONS_DIR = Path("backend/.sessions")


def _session_dir(sid: str) -> Path:
    return SESSIONS_DIR / sid


_EXT_FOR_MIME = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


def _ext_for(mime: str) -> str:
    return _EXT_FOR_MIME.get(mime, "bin")


def save_session(sid: str, image_bytes: bytes, mime_type: str, created_at: float) -> None:
    """Write a new session's image + meta to disk. Idempotent — overwrites
    any existing files at the same path."""
    d = _session_dir(sid)
    d.mkdir(parents=True, exist_ok=True)
    (d / f"image.{_ext_for(mime_type)}").write_bytes(image_bytes)
    (d / "meta.json").write_text(
        json.dumps({"mime_type": mime_type, "created_at": created_at}),
    )


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
