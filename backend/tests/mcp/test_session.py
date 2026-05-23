import pytest

from app.mcp.session import MCPSessionRegistry, MCPSessionNotPaired


def test_pair_and_lookup() -> None:
    reg = MCPSessionRegistry()
    reg.pair("mcp-1", "editor-sid")
    assert reg.editor_session_id("mcp-1") == "editor-sid"


def test_unpaired_raises() -> None:
    reg = MCPSessionRegistry()
    with pytest.raises(MCPSessionNotPaired):
        reg.editor_session_id("nope")


def test_unpair() -> None:
    reg = MCPSessionRegistry()
    reg.pair("mcp-1", "editor-sid")
    reg.unpair("mcp-1")
    with pytest.raises(MCPSessionNotPaired):
        reg.editor_session_id("mcp-1")
