import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.schemas.widget import (
    ControlBinding,
    ControlSchema,
    NodeParamTarget,
    Scope,
    Widget,
    WidgetNode,
    WidgetOrigin,
    WidgetPreview,
)
from app.tools.atomic.preview_widget import PreviewWidgetTool


@pytest.fixture
def client():
    from app.main import app
    reg = deps.get_tool_registry()
    if "preview_widget" not in reg._tools:
        reg.register(PreviewWidgetTool())
    yield TestClient(app)


def test_preview_returns_base64_jpeg(client) -> None:
    from io import BytesIO
    from PIL import Image
    buf = BytesIO()
    Image.new("RGB", (64, 64), (128, 128, 128)).save(buf, format="JPEG")
    files = {"image": ("a.jpg", buf.getvalue(), "image/jpeg")}
    sid = client.post("/api/session", files=files).json()["session_id"]
    doc = deps.get_session_store().get_document(sid)
    doc.add_widget(Widget(
        id="w_1", intent="warm",
        scope=Scope.model_validate({"kind": "global"}),
        origin=WidgetOrigin(kind="mcp_user_prompt", prompt="warm"),
        fused_tool_id="warm_grade",
        nodes=[WidgetNode(
            id="n_1", type="kelvin", params={"temperature": 800},
            scope=Scope.model_validate({"kind": "global"}),
            inputs=[], widget_id="w_1",
        )],
        bindings=[ControlBinding(
            param_key="temperature", label="T", control_type="slider",
            target=NodeParamTarget(node_id="n_1", param_key="temperature"),
            control_schema=ControlSchema.model_validate(
                {"control_type": "slider", "min": -1200, "max": 1200, "step": 50}
            ),
            value=800, default=0,
        )],
        preview=WidgetPreview(kind="thumbnail", auto_before_after=True),
    ))
    body = client.post(
        "/api/tools/preview_widget",
        json={"session_id": sid, "input": {"widget_id": "w_1", "max_dim": 64}},
    ).json()
    assert body["ok"] is True
    assert body["output"]["mime_type"] == "image/jpeg"
    assert body["output"]["image_b64"] is not None
