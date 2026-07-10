from app.schemas.widget import ControlBinding, ControlSchema, NodeParamTarget, WidgetNode
from app.tools.hsl_bindings import pad_hsl_bindings

_SLIDER = ControlSchema.model_validate(
    {"control_type": "slider", "min": -100, "max": 100, "step": 1}
)


def _hsl_node() -> WidgetNode:
    return WidgetNode(
        id="n1", type="hsl", params={}, scope={"kind": "global"},
        inputs=[], widget_id="w1",
    )


def test_pad_completes_all_24_bindings_for_an_hsl_node():
    existing = ControlBinding(
        param_key="red_hue", label="Hue", control_type="slider",
        target=NodeParamTarget(node_id="n1", param_key="red_hue"),
        control_schema=_SLIDER, value=15, default=0,
    )
    out = pad_hsl_bindings([_hsl_node()], [existing])

    keys = [b.param_key for b in out]
    assert len(out) == 24
    assert len(set(keys)) == 24  # no duplicates

    # The pre-existing binding (and its edited value) is preserved untouched.
    red_hue = next(b for b in out if b.param_key == "red_hue")
    assert red_hue.value == 15

    # A padded band targets the hsl node and rests at default 0.
    blue_lum = next(b for b in out if b.param_key == "blue_lum")
    assert blue_lum.target.node_id == "n1"
    assert blue_lum.value == 0 and blue_lum.default == 0
    assert blue_lum.label == "Luminance"


def test_pad_is_a_noop_without_an_hsl_node():
    node = WidgetNode(
        id="n1", type="basic", params={}, scope={"kind": "global"},
        inputs=[], widget_id="w1",
    )
    assert pad_hsl_bindings([node], []) == []
