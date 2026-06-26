"""Backend→client tool-call bridge.

Lets a backend coroutine (the agent loop, Plan 2) ask the frontend to run an
LlmToolRegistry tool and await its result. The request rides a transient
`client.tool_request` StateEvent published straight to the EventBus — it is
NOT appended to doc.history, so it never replays on SSE reconnect (a replayed
request would re-trigger the tool). The reply arrives via POST /tool_result,
which resolves the correlation Future registered on the SessionStore.
"""

from __future__ import annotations

import asyncio
from typing import Any

from app.schemas.widget import StateEvent
from app.services.session_store import SessionStore
from app.state.events import EventBus


async def request_client_tool(
    store: SessionStore,
    bus: EventBus,
    sid: str,
    *,
    name: str,
    input: dict[str, Any],
    kind: str,
    timeout: float = 60.0,
) -> dict[str, Any]:
    """Emit a client.tool_request and await the client's result.

    Returns the client's result dict (shape {ok, output?|error?|denied?}).
    On timeout returns a denial and drops the pending entry so a late reply
    is ignored. Never raises for tool-level failures — those are encoded in
    the returned dict.
    """
    request_id, fut = store.new_client_request(sid)
    # Current revision only — the control event does not mutate state, and we
    # deliberately do NOT call doc._emit (which would append to history).
    doc = store.get_document(sid)
    ev = StateEvent(
        revision=doc.revision,
        kind="client.tool_request",
        payload={"request_id": request_id, "name": name, "input": input, "kind": kind},
    )
    bus.publish(sid, ev)
    try:
        return await asyncio.wait_for(fut, timeout=timeout)
    except asyncio.TimeoutError:
        # Drop the now-orphaned Future so a late POST is a no-op.
        store.resolve_client_request(sid, request_id, {"ok": False})
        return {"ok": False, "denied": True, "error": "timeout"}
