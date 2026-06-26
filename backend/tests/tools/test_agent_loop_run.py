import pytest

from app.tools.agent_loop import run_agent_turn


class _Block:
    def __init__(self, type, name=None, input=None, id=None):
        self.type = type
        self.name = name
        self.input = input
        self.id = id


class _Resp:
    def __init__(self, stop_reason, content):
        self.stop_reason = stop_reason
        self.content = content


class _ScriptedLLM:
    """Returns a queued response per call; records the messages it received."""
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []

    def __call__(self, system, messages, tools):
        self.calls.append({"system": system, "messages": list(messages), "tools": tools})
        return self._responses.pop(0)


@pytest.mark.asyncio
async def test_loop_dispatches_propose_then_ends():
    llm = _ScriptedLLM([
        _Resp("tool_use", [_Block("tool_use", "propose_adjustment_widgets",
                                  {"target_image_node_id": "in-1", "intent": "dramatic"}, "tu_1")]),
        _Resp("end_turn", [_Block("text")]),
    ])
    proposed = []

    async def propose_fn(target_image_node_id, intent):
        proposed.append((target_image_node_id, intent))
        return {"ok": True, "widget_count": 1}

    async def client_tool_fn(name, input):
        raise AssertionError("no client tool expected")

    out = await run_agent_turn(
        agent_step=llm, sid="sid-1", intent="make it dramatic", attached_objects=[],
        client_tools=[], node_layers={"in-1": ["l-1"]},
        propose_fn=propose_fn, client_tool_fn=client_tool_fn,
    )
    assert out == {"ok": True, "tool_calls": 1}
    assert proposed == [("in-1", "dramatic")]
    second_msgs = llm.calls[1]["messages"]
    assert any(
        m["role"] == "user" and isinstance(m["content"], list)
        and any(c.get("type") == "tool_result" and c.get("tool_use_id") == "tu_1" for c in m["content"])
        for m in second_msgs
    )


@pytest.mark.asyncio
async def test_loop_routes_client_tool_and_unknown_node_errors():
    llm = _ScriptedLLM([
        _Resp("tool_use", [_Block("tool_use", "list_objects", {}, "tu_1")]),
        _Resp("tool_use", [_Block("tool_use", "propose_adjustment_widgets",
                                  {"target_image_node_id": "in-UNKNOWN", "intent": "x"}, "tu_2")]),
        _Resp("end_turn", [_Block("text")]),
    ])

    async def propose_fn(target_image_node_id, intent):
        raise AssertionError("unknown node must not reach propose_fn")

    seen = []
    async def client_tool_fn(name, input):
        seen.append(name)
        return {"ok": True, "output": ["sky"]}

    out = await run_agent_turn(
        agent_step=llm, sid="sid-1", intent="list", attached_objects=[],
        client_tools=[], node_layers={"in-1": ["l-1"]},
        propose_fn=propose_fn, client_tool_fn=client_tool_fn,
    )
    assert out == {"ok": True, "tool_calls": 2}
    assert seen == ["list_objects"]


@pytest.mark.asyncio
async def test_loop_stops_at_max_tool_calls():
    forever = [_Resp("tool_use", [_Block("tool_use", "list_objects", {}, f"tu_{i}")]) for i in range(20)]
    llm = _ScriptedLLM(forever)

    async def propose_fn(target_image_node_id, intent):
        return {"ok": True, "widget_count": 0}

    async def client_tool_fn(name, input):
        return {"ok": True, "output": []}

    out = await run_agent_turn(
        agent_step=llm, sid="sid-1", intent="loop", attached_objects=[],
        client_tools=[], node_layers={}, propose_fn=propose_fn, client_tool_fn=client_tool_fn,
        max_tool_calls=3,
    )
    assert out == {"ok": True, "tool_calls": 3}
