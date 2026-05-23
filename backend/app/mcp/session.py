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
