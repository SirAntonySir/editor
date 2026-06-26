import pytest

from app.tools.agent_loop import dispatch_propose_adjustment


class _FakeEnvelope:
    def __init__(self, ok, data=None, error=None):
        self.ok = ok
        self.data = data
        self.error = error


class _FakeRegistry:
    def __init__(self, envelope):
        self._envelope = envelope
        self.calls = []

    async def invoke(self, name, session_id, raw_input):
        self.calls.append((name, session_id, raw_input))
        return self._envelope


@pytest.mark.asyncio
async def test_dispatch_builds_image_node_scope_and_invokes_propose_stack():
    reg = _FakeRegistry(_FakeEnvelope(ok=True, data={"widgets": [{"id": "w1"}, {"id": "w2"}]}))
    result = await dispatch_propose_adjustment(
        reg, "sid-1", target_image_node_id="in-1", layer_ids=["l-1"], intent="dramatic sky",
    )
    assert result == {"ok": True, "widget_count": 2}
    name, sid, raw = reg.calls[0]
    assert name == "propose_stack"
    assert sid == "sid-1"
    assert raw["intent"] == "dramatic sky"
    assert raw["origin"] == "mcp_user_prompt"
    assert raw["scope"] == {"kind": "image_node", "image_node_id": "in-1", "layer_ids": ["l-1"]}


@pytest.mark.asyncio
async def test_dispatch_returns_error_on_tool_failure():
    reg = _FakeRegistry(_FakeEnvelope(ok=False, error={"message": "boom"}))
    result = await dispatch_propose_adjustment(
        reg, "sid-1", target_image_node_id="in-1", layer_ids=["l-1"], intent="x",
    )
    assert result["ok"] is False
    assert "boom" in result["error"]
