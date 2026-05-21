from typing import Any

import pytest
from pydantic import BaseModel

from app.tools.base import BackendTool, ToolPermissions


class _Input(BaseModel):
    name: str


class _Output(BaseModel):
    greeting: str


class _GreetTool(BackendTool[_Input, _Output]):
    name = "greet"
    kind = "query"
    description = "say hello"
    input_schema = _Input
    output_schema = _Output

    async def handler(self, doc: Any, input: _Input) -> _Output:  # noqa: A002
        return _Output(greeting=f"hi {input.name}")


def test_default_permissions() -> None:
    perms = ToolPermissions()
    assert perms.expose_mcp is True
    assert perms.expose_rest is True
    assert perms.requires_image is True
    assert perms.requires_context is False


def test_tool_subclass_carries_name_and_kind() -> None:
    t = _GreetTool()
    assert t.name == "greet"
    assert t.kind == "query"


@pytest.mark.asyncio
async def test_tool_handler_is_called_directly() -> None:
    t = _GreetTool()
    out = await t.handler(doc=None, input=_Input(name="anna"))
    assert out.greeting == "hi anna"
