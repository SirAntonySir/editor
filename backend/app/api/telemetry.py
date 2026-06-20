"""Frontend → backend telemetry sink for the admin cockpit.

The frontend posts lightweight UI events (Info-tab opens, Compare
shift-holds, History dropdown opens, panel resizes, etc.) so the
cockpit can score thesis-relevant interactions like "did the user
check the Info tab before applying an AI widget?".

One endpoint, one schema, journal-write only — no validation beyond
"must reference a known session." Bad data here is research noise, not
a security issue: the journal is admin-only anyway.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.services.event_journal import write_event
from app.services.session_store import SessionNotFound, SessionStore

from .deps import get_session_store

router = APIRouter()


class _TelemetryEvent(BaseModel):
    """Free-form UI event. `name` is a dotted string (`info.open`,
    `compare.hold`, `history.open`, …). `props` is whatever the
    frontend wants to attach — durations, panel ids, scroll positions."""

    name: str = Field(..., min_length=1, max_length=128)
    props: dict[str, Any] = Field(default_factory=dict)


@router.post("/telemetry/{sid}/event")
async def post_telemetry_event(
    sid: str,
    body: _TelemetryEvent,
    store: SessionStore = Depends(get_session_store),
) -> dict[str, str]:
    """Append a frontend UI event to the session journal.

    Returns 204-shaped {"ok": "ok"} so a fire-and-forget client can
    drop the response. 404 only on truly-unknown session — the editor
    is the only caller and this should never fire in production.
    """
    try:
        store.touch(sid)
    except SessionNotFound:
        raise HTTPException(status_code=404, detail="unknown or expired session")
    write_event(sid, f"telemetry.{body.name}", body.props)
    return {"ok": "ok"}
