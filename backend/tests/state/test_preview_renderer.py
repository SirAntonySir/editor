import io

import numpy as np
from PIL import Image

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
from app.state.preview_renderer import render_widget_preview


def _grey_image(size: int = 64) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (size, size), (128, 128, 128)).save(buf, format="JPEG")
    return buf.getvalue()


def _kelvin_widget(temperature: float) -> Widget:
    return Widget(
        id="w_k",
        intent="warm",
        scope=Scope.model_validate({"kind": "global"}),
        origin=WidgetOrigin(kind="mcp_user_prompt", prompt="warm"),
        fused_tool_id="warm_grade",
        nodes=[
            WidgetNode(
                id="n_k",
                type="kelvin",
                params={"temperature": temperature},
                scope=Scope.model_validate({"kind": "global"}),
                inputs=[],
                widget_id="w_k",
            )
        ],
        bindings=[
            ControlBinding(
                param_key="temperature",
                label="T",
                control_type="slider",
                target=NodeParamTarget(node_id="n_k", param_key="temperature"),
                control_schema=ControlSchema.model_validate(
                    {"control_type": "slider", "min": -1200, "max": 1200, "step": 50}
                ),
                value=temperature,
                default=0,
            )
        ],
        preview=WidgetPreview(kind="thumbnail", auto_before_after=True),
    )


def test_warm_kelvin_pushes_red_higher() -> None:
    img = _grey_image(64)
    out_b64 = render_widget_preview(img, "image/jpeg", _kelvin_widget(800.0), max_dim=64)
    assert out_b64 is not None
    import base64

    raw = base64.b64decode(out_b64)
    rendered = np.array(Image.open(io.BytesIO(raw)).convert("RGB"))
    # Warm kelvin should raise R relative to B; original is neutral grey.
    assert rendered[:, :, 0].mean() > rendered[:, :, 2].mean()


def test_unsupported_node_returns_none() -> None:
    w = _kelvin_widget(800.0)
    w.nodes[0].type = "weird_filter_no_one_supports"
    out = render_widget_preview(_grey_image(32), "image/jpeg", w, max_dim=32)
    assert out is None
