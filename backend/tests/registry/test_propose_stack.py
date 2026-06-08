"""Tests for propose_stack: the toolrail fast path is non-LLM and can be
tested without mocking Anthropic. Phase 1/2 LLM paths are tested in
test_propose_stack_integration with mocked clients (Task 12).
"""
from __future__ import annotations

import pytest

from app.state.document import SessionDocument
from app.tools.widgets.propose_stack import ProposeStackTool, _Input


@pytest.mark.asyncio
async def test_toolrail_single_op_spawns_one_widget(make_doc):
    doc: SessionDocument = make_doc()
    tool = ProposeStackTool()
    out = await tool.handler(doc, _Input(
        intent="grain",
        scope={"kind": "global"},
        origin="tool_invoked",
        forced_ops=["grain"],
    ))
    assert len(out.widgets) == 1
    assert out.widgets[0]["nodes"][0]["type"] == "grain"


@pytest.mark.asyncio
async def test_toolrail_multi_op_spawns_multiple(make_doc):
    doc: SessionDocument = make_doc()
    tool = ProposeStackTool()
    out = await tool.handler(doc, _Input(
        intent="vintage",
        scope={"kind": "global"},
        origin="tool_invoked",
        forced_ops=["grain", "vignette"],
    ))
    assert len(out.widgets) == 2
