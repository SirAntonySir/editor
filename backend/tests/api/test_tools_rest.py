import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.tools.base import BackendTool, ToolPermissions


class _EchoInput(BaseModel):
    msg: str


class _EchoOutput(BaseModel):
    echo: str


class _EchoTool(BackendTool[_EchoInput, _EchoOutput]):
    name = "echo"
    kind = "query"
    description = "echo"
    input_schema = _EchoInput
    output_schema = _EchoOutput
    permissions = ToolPermissions(requires_image=False)

    async def handler(self, doc, input):  # noqa: A002
        return _EchoOutput(echo=input.msg)


@pytest.fixture
def client_with_echo():
    from app.api import deps
    from app.main import app

    deps.get_tool_registry().register(_EchoTool())
    yield TestClient(app)
    # Clean up so other tests don't see "echo".
    reg = deps.get_tool_registry()
    reg._tools.pop("echo", None)


def test_post_tools_echo_happy_path(client_with_echo) -> None:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    resp = client_with_echo.post("/api/session", files=files)
    sid = resp.json()["session_id"]
    r = client_with_echo.post(
        "/api/tools/echo",
        json={"session_id": sid, "input": {"msg": "hi"}},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["output"] == {"echo": "hi"}


def test_post_tools_unknown_tool_returns_envelope(client_with_echo) -> None:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    sid = client_with_echo.post("/api/session", files=files).json()["session_id"]
    r = client_with_echo.post(
        "/api/tools/nope",
        json={"session_id": sid, "input": {}},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "unknown_tool"


def test_post_tools_invalid_input_returns_envelope(client_with_echo) -> None:
    files = {"image": ("a.jpg", b"\xff\xd8\xff", "image/jpeg")}
    sid = client_with_echo.post("/api/session", files=files).json()["session_id"]
    r = client_with_echo.post(
        "/api/tools/echo",
        json={"session_id": sid, "input": {"msg": 123}},
    )
    body = r.json()
    assert body["ok"] is False
    assert body["error"]["code"] == "invalid_input"
