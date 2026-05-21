from typing import Any

import pytest
from pydantic import BaseModel

from app.services.session_store import SessionStore
from app.state.document import SessionDocument
from app.state.events import EventBus
from app.tools.base import BackendTool, ToolPermissions
from app.tools.registry import BackendToolRegistry


class _PingInput(BaseModel):
    pass


class _PingOutput(BaseModel):
    pong: bool


class _PingTool(BackendTool[_PingInput, _PingOutput]):
    name = "ping"
    kind = "query"
    description = "health probe"
    input_schema = _PingInput
    output_schema = _PingOutput
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc: SessionDocument, input: _PingInput) -> _PingOutput:  # noqa: A002
        return _PingOutput(pong=True)


def _make_registry(store: SessionStore | None = None) -> BackendToolRegistry:
    bus = EventBus()
    reg = BackendToolRegistry(store=store or SessionStore(ttl_seconds=60), event_bus=bus)
    return reg


def test_register_and_get() -> None:
    reg = _make_registry()
    reg.register(_PingTool())
    assert reg.get("ping").name == "ping"


def test_duplicate_registration_raises() -> None:
    reg = _make_registry()
    reg.register(_PingTool())
    with pytest.raises(ValueError):
        reg.register(_PingTool())


@pytest.mark.asyncio
async def test_invoke_unknown_tool_returns_error_envelope() -> None:
    reg = _make_registry()
    env = await reg.invoke("nope", session_id="s1", raw_input={})
    assert env.ok is False
    assert env.error.code == "unknown_tool"


@pytest.mark.asyncio
async def test_invoke_missing_session_returns_envelope_error() -> None:
    reg = _make_registry()
    reg.register(_PingTool())
    env = await reg.invoke("ping", session_id="nope", raw_input={})
    assert env.ok is False
    assert env.error.code == "missing_session"


@pytest.mark.asyncio
async def test_invoke_invalid_input_returns_envelope_error() -> None:
    class _StrictIn(BaseModel):
        n: int

    class _StrictTool(BackendTool[_StrictIn, _PingOutput]):
        name = "strict"
        kind = "query"
        description = "x"
        input_schema = _StrictIn
        output_schema = _PingOutput
        permissions = ToolPermissions(requires_image=False)

        async def handler(self, doc: SessionDocument, input: _StrictIn) -> _PingOutput:  # noqa: A002
            return _PingOutput(pong=True)

    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"x", mime_type="image/jpeg")
    reg = _make_registry(store)
    reg.register(_StrictTool())
    env = await reg.invoke("strict", session_id=sid, raw_input={"n": "not-an-int"})
    assert env.ok is False
    assert env.error.code == "invalid_input"


@pytest.mark.asyncio
async def test_invoke_happy_path_returns_output() -> None:
    store = SessionStore(ttl_seconds=60)
    sid = store.create(image_bytes=b"x", mime_type="image/jpeg")
    reg = _make_registry(store)
    reg.register(_PingTool())
    env = await reg.invoke("ping", session_id=sid, raw_input={})
    assert env.ok is True
    assert env.output == {"pong": True}


def test_list_for_filters_by_transport() -> None:
    class _RestOnlyTool(_PingTool):
        name = "rest_only"
        permissions = ToolPermissions(requires_image=False, expose_mcp=False)

    reg = _make_registry()
    reg.register(_PingTool())
    reg.register(_RestOnlyTool())
    mcp_names = {t.name for t in reg.list_for("mcp")}
    rest_names = {t.name for t in reg.list_for("rest")}
    assert "ping" in mcp_names and "ping" in rest_names
    assert "rest_only" not in mcp_names
    assert "rest_only" in rest_names
