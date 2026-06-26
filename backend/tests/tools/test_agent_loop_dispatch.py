import pytest

from app.tools.agent_loop import dispatch_propose_adjustment


class _FakeError:
    def __init__(self, message):
        self.message = message


class _FakeEnvelope:
    # Mirrors app.schemas.errors.ToolResponseEnvelope: ok / output / error
    # (error is a ToolError-like object exposing .message). Keep these field
    # names in sync with the real envelope — the dispatch reads them directly.
    def __init__(self, ok, output=None, error=None):
        self.ok = ok
        self.output = output
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
    reg = _FakeRegistry(_FakeEnvelope(ok=True, output={"widgets": [{"id": "w1"}, {"id": "w2"}]}))
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
    reg = _FakeRegistry(_FakeEnvelope(ok=False, error=_FakeError("boom")))
    result = await dispatch_propose_adjustment(
        reg, "sid-1", target_image_node_id="in-1", layer_ids=["l-1"], intent="x",
    )
    assert result["ok"] is False
    assert "boom" in result["error"]


@pytest.mark.asyncio
async def test_dispatch_reads_the_real_envelope_shape():
    # Regression: the dispatch must read the REAL ToolResponseEnvelope fields
    # (ok/output), not the fake's. This caught a .data vs .output mismatch.
    from app.schemas.errors import ToolResponseEnvelope

    reg = _FakeRegistry(ToolResponseEnvelope(ok=True, output={"widgets": [{"id": "w1"}]}))
    result = await dispatch_propose_adjustment(
        reg, "sid-1", target_image_node_id="in-1", layer_ids=["l-1"], intent="x",
    )
    assert result == {"ok": True, "widget_count": 1}
