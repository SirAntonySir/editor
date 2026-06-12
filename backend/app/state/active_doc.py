"""Active SessionDocument carried via a contextvar so deep call sites can
emit live SSE events without being threaded an explicit reference.

Set by BackendToolRegistry.invoke around the handler call; read by the
Anthropic client to emit `mcp.usage` events after each Claude response.

A contextvar is correct here (not a global): each FastAPI request runs in
its own asyncio context, and asyncio.create_task copies the context — so
the value is request-scoped and does not leak between concurrent sessions.
"""
from __future__ import annotations

from contextvars import ContextVar
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app.state.document import SessionDocument

_active_doc: ContextVar["SessionDocument | None"] = ContextVar("active_doc", default=None)


def set_active_doc(doc: "SessionDocument | None"):
    """Set the active document for the current async context.

    Returns the Token that the caller must reset() in a finally block."""
    return _active_doc.set(doc)


def reset_active_doc(token: Any) -> None:
    _active_doc.reset(token)


def get_active_doc() -> "SessionDocument | None":
    return _active_doc.get()
