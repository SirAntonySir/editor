"""Per-cohort (participant) study settings, persisted on disk.

A cohort is identified by the ``editor_uid`` cookie minted in api/session.py
(surfaced as ``user_id`` in the admin cockpit). For the AI_access study, the
experimenter sets a participant's condition once via the cockpit; then
``create_session`` stamps every new session that participant's browser opens
with the cohort's value — so the condition survives page reloads and new
image-opens, which each mint a fresh backend session.

Stored as a single JSON map ``{user_id: {"ai_access": bool}}`` next to the
session dirs. A flat file (not per-cohort dirs) keeps it trivially greppable
and, being a file, is ignored by the directory-only scanners in
disk_session_io / revive / prune.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.services import disk_session_io


def _cohorts_file() -> Path:
    # Resolved per-call (not a module constant) so tests that monkeypatch
    # disk_session_io.SESSIONS_DIR redirect this too.
    return disk_session_io.SESSIONS_DIR / "_cohorts.json"


def _load() -> dict[str, Any]:
    path = _cohorts_file()
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _save(data: dict[str, Any]) -> None:
    path = _cohorts_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data))


def get_cohort_ai_access(user_id: str | None) -> bool:
    """Return the participant's AI_access condition. Defaults True for unknown
    or empty cohorts so a participant whose condition was never set gets AI on
    (the pre-existing behaviour)."""
    if not user_id:
        return True
    entry = _load().get(user_id)
    if isinstance(entry, dict) and isinstance(entry.get("ai_access"), bool):
        return entry["ai_access"]
    return True


def set_cohort_ai_access(user_id: str | None, ai_access: bool) -> None:
    """Persist the participant's AI_access condition. No-op for an empty id."""
    if not user_id:
        return
    data = _load()
    entry = data.get(user_id)
    if not isinstance(entry, dict):
        entry = {}
    entry["ai_access"] = ai_access
    data[user_id] = entry
    _save(data)
