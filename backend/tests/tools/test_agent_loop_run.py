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

    async def propose_fn(target_image_node_id, intent, layer_ids=None):
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

    async def propose_fn(target_image_node_id, intent, layer_ids=None):
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
async def test_loop_threads_extracted_node_then_proposes_on_it():
    llm = _ScriptedLLM([
        _Resp("tool_use", [_Block("tool_use", "extract_object_to_image_node",
                                  {"maskId": "m1"}, "tu_1")]),
        _Resp("tool_use", [_Block("tool_use", "propose_adjustment_widgets",
                                  {"target_image_node_id": "in-9", "intent": "dramatic"}, "tu_2")]),
        _Resp("end_turn", [_Block("text")]),
    ])
    proposed = []

    async def propose_fn(target_image_node_id, intent, layer_ids=None):
        proposed.append((target_image_node_id, intent))
        return {"ok": True, "widget_count": 1}

    async def client_tool_fn(name, input):
        # Round-trip envelope: the tool's own return sits under `output`.
        return {"ok": True, "output": {"ok": True, "image_node_id": "in-9", "layer_ids": ["l-9"]}}

    out = await run_agent_turn(
        agent_step=llm, sid="sid-1", intent="extract sky and make it dramatic",
        attached_objects=[], client_tools=[], node_layers={"in-1": ["l-1"]},
        propose_fn=propose_fn, client_tool_fn=client_tool_fn,
    )
    assert out == {"ok": True, "tool_calls": 2}
    # The extracted node in-9 was threaded, so propose targeted it (not rejected).
    assert proposed == [("in-9", "dramatic")]


@pytest.mark.asyncio
async def test_loop_scopes_propose_to_requested_layer_ids():
    """The LLM can pass layer_ids to scope a proposal to a subset of a node's
    layers — so two regions on the same node get independent edits."""
    llm = _ScriptedLLM([
        _Resp("tool_use", [_Block("tool_use", "propose_adjustment_widgets",
              {"target_image_node_id": "in-1", "intent": "warm", "layer_ids": ["l-2"]}, "tu_1")]),
        _Resp("end_turn", [_Block("text")]),
    ])
    proposed = []

    async def propose_fn(node, intent, layer_ids=None):
        proposed.append((node, intent, layer_ids))
        return {"ok": True, "widget_count": 1}

    async def client_tool_fn(name, input):
        raise AssertionError("no client tool expected")

    await run_agent_turn(
        agent_step=llm, sid="s", intent="warm", attached_objects=[],
        client_tools=[], node_layers={"in-1": ["l-1", "l-2"]},
        propose_fn=propose_fn, client_tool_fn=client_tool_fn,
    )
    assert proposed == [("in-1", "warm", ["l-2"])]


@pytest.mark.asyncio
async def test_loop_defaults_to_all_layers_when_layer_ids_omitted():
    """Omitting layer_ids keeps the old behaviour: the proposal covers every
    layer of the target node."""
    llm = _ScriptedLLM([
        _Resp("tool_use", [_Block("tool_use", "propose_adjustment_widgets",
              {"target_image_node_id": "in-1", "intent": "warm"}, "tu_1")]),
        _Resp("end_turn", [_Block("text")]),
    ])
    proposed = []

    async def propose_fn(node, intent, layer_ids=None):
        proposed.append((node, intent, layer_ids))
        return {"ok": True, "widget_count": 1}

    async def client_tool_fn(name, input):
        raise AssertionError("no client tool expected")

    await run_agent_turn(
        agent_step=llm, sid="s", intent="warm", attached_objects=[],
        client_tools=[], node_layers={"in-1": ["l-1", "l-2"]},
        propose_fn=propose_fn, client_tool_fn=client_tool_fn,
    )
    assert proposed == [("in-1", "warm", ["l-1", "l-2"])]


@pytest.mark.asyncio
async def test_loop_filters_requested_layers_to_the_nodes_own():
    """Requested layer_ids that aren't on the node are dropped; the valid
    subset survives."""
    llm = _ScriptedLLM([
        _Resp("tool_use", [_Block("tool_use", "propose_adjustment_widgets",
              {"target_image_node_id": "in-1", "intent": "warm",
               "layer_ids": ["l-2", "l-NOPE"]}, "tu_1")]),
        _Resp("end_turn", [_Block("text")]),
    ])
    proposed = []

    async def propose_fn(node, intent, layer_ids=None):
        proposed.append((node, intent, layer_ids))
        return {"ok": True, "widget_count": 1}

    async def client_tool_fn(name, input):
        raise AssertionError("no client tool expected")

    await run_agent_turn(
        agent_step=llm, sid="s", intent="warm", attached_objects=[],
        client_tools=[], node_layers={"in-1": ["l-1", "l-2"]},
        propose_fn=propose_fn, client_tool_fn=client_tool_fn,
    )
    assert proposed == [("in-1", "warm", ["l-2"])]


@pytest.mark.asyncio
async def test_loop_rejects_when_no_requested_layer_belongs_to_node():
    """If none of the requested layers are on the node, don't propose — return
    an error the LLM can react to."""
    llm = _ScriptedLLM([
        _Resp("tool_use", [_Block("tool_use", "propose_adjustment_widgets",
              {"target_image_node_id": "in-1", "intent": "warm",
               "layer_ids": ["l-NOPE"]}, "tu_1")]),
        _Resp("end_turn", [_Block("text")]),
    ])
    proposed = []

    async def propose_fn(node, intent, layer_ids=None):
        proposed.append((node, intent, layer_ids))
        return {"ok": True, "widget_count": 1}

    async def client_tool_fn(name, input):
        raise AssertionError("no client tool expected")

    out = await run_agent_turn(
        agent_step=llm, sid="s", intent="warm", attached_objects=[],
        client_tools=[], node_layers={"in-1": ["l-1", "l-2"]},
        propose_fn=propose_fn, client_tool_fn=client_tool_fn,
    )
    assert proposed == []  # propose_fn never called
    assert out["tool_calls"] == 1  # the rejected call still counts


@pytest.mark.asyncio
async def test_loop_stops_at_max_tool_calls():
    forever = [_Resp("tool_use", [_Block("tool_use", "list_objects", {}, f"tu_{i}")]) for i in range(20)]
    llm = _ScriptedLLM(forever)

    async def propose_fn(target_image_node_id, intent, layer_ids=None):
        return {"ok": True, "widget_count": 0}

    async def client_tool_fn(name, input):
        return {"ok": True, "output": []}

    out = await run_agent_turn(
        agent_step=llm, sid="sid-1", intent="loop", attached_objects=[],
        client_tools=[], node_layers={}, propose_fn=propose_fn, client_tool_fn=client_tool_fn,
        max_tool_calls=3,
    )
    assert out == {"ok": True, "tool_calls": 3}
