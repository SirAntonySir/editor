"""MCP wire-layer pairing registry.

This is NOT a session-lifecycle module — it just maps an MCP transport
session id (assigned by the JSON-RPC client at ``initialize``) to an editor
session id (a real session owned by ``services/session_store.py``). Used by
``mcp/server.py`` to look up which editor doc a ``tools/call`` should
target.

For the responsibility split across the four ``session*`` files, see the
header of ``app/api/session.py``.
"""

from __future__ import annotations

from threading import Lock


class MCPSessionNotPaired(KeyError):
    pass


class MCPSessionRegistry:
    """Maps an MCP transport session id (assigned by the wire layer) to an
    editor session_id (the actual document the MCP client is editing)."""

    def __init__(self) -> None:
        self._pairs: dict[str, str] = {}
        self._lock = Lock()

    def pair(self, mcp_session_id: str, editor_session_id: str) -> None:
        with self._lock:
            self._pairs[mcp_session_id] = editor_session_id

    def unpair(self, mcp_session_id: str) -> None:
        with self._lock:
            self._pairs.pop(mcp_session_id, None)

    def editor_session_id(self, mcp_session_id: str) -> str:
        with self._lock:
            if mcp_session_id not in self._pairs:
                raise MCPSessionNotPaired(mcp_session_id)
            return self._pairs[mcp_session_id]
