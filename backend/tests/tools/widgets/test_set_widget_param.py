import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.tools.widgets.set_widget_param import SetWidgetParamTool


@pytest.fixture
def client():
    from app.main import app
    reg = deps.get_tool_registry()
    if "set_widget_param" not in reg._tools:
        reg.register(SetWidgetParamTool())
    yield TestClient(app)


def _push_widget_with_binding(sid: str) -> tuple[str, str]:
    """Push a widget with a single slider binding and return (widget_id, node_id)."""
    from app.schemas.widget import (
        ControlBinding,
        ControlSchema,
        GlobalScope,
        NodeParamTarget,
        Scope,
        SliderSchema,
        Widget,
        WidgetNode,
        WidgetOrigin,
        WidgetPreview,
    )
    doc = deps.get_session_store().get_document(sid)
    node_id = "n_swp_test"
    w = Widget(
        id="w_swp_test",
        intent="adjust temperature",
        scope=Scope(root=GlobalScope(kind="global")),
        origin=WidgetOrigin(kind="mcp_user_prompt", prompt="adjust temperature"),
        preview=WidgetPreview(kind="none"),
        nodes=[
            WidgetNode(
                id=node_id,
                type="basic",
                params={"temperature": 300.0},
                scope=Scope(root=GlobalScope(kind="global")),
                widget_id="w_swp_test",
            )
        ],
        bindings=[
            ControlBinding(
                param_key="temperature",
                label="Temperature",
                control_type="slider",
                target=NodeParamTarget(node_id=node_id, param_key="temperature"),
                control_schema=ControlSchema(
                    root=SliderSchema(control_type="slider", min=100, max=10000, step=50)
                ),
                value=300.0,
                default=300.0,
            )
        ],
    )
    doc.add_widget(w)
    return w.id, node_id


def test_set_widget_param_updates_binding_and_node(client) -> None:
    from io import BytesIO
    from PIL import Image
    buf = BytesIO()
    Image.new("RGB", (16, 16)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    wid, nid = _push_widget_with_binding(sid)

    body = client.post(
        "/api/tools/set_widget_param",
        json={"session_id": sid, "input": {
            "widget_id": wid,
            "param_key": "temperature",
            "value": 6500.0,
        }},
    ).json()
    assert body["ok"] is True

    doc = deps.get_session_store().get_document(sid)
    w = doc.widgets[wid]
    binding = next(b for b in w.bindings if b.param_key == "temperature")
    assert binding.value == 6500.0
    node = next(n for n in w.nodes if n.id == nid)
    assert node.params["temperature"] == 6500.0
