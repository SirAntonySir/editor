"""Fused intent widgets — schema + synthesis tests."""
from __future__ import annotations

from app.registry.schema import CompoundAnchor, OpCompoundConfig
from app.schemas.widget import Widget


def _minimal_widget_dict() -> dict:
    return {
        "id": "w_test1234",
        "intent": "make it black",
        "scope": {"kind": "global"},
        "origin": {"kind": "mcp_user_prompt", "prompt": "make it black"},
    }


def test_widget_accepts_compound_and_driver_value():
    d = _minimal_widget_dict()
    d["compound"] = {
        "driver": "__driver",
        "label": "Blackness",
        "anchors": [
            {"position": 0.0, "name": "as shot", "values": {"n_a:exposure": 0.0}},
            {"position": 1.0, "name": "proposed", "values": {"n_a:exposure": -80.0}},
        ],
    }
    d["driverValue"] = 1.0
    w = Widget.model_validate(d)
    assert w.compound is not None
    assert w.compound.label == "Blackness"
    assert w.compound.driver == "__driver"
    assert w.driver_value == 1.0
    # Round-trips back to camelCase wire format.
    dumped = w.model_dump(mode="json", by_alias=True)
    assert dumped["driverValue"] == 1.0
    assert dumped["compound"]["label"] == "Blackness"


def test_widget_without_compound_defaults_to_none():
    w = Widget.model_validate(_minimal_widget_dict())
    assert w.compound is None
    assert w.driver_value is None


def test_op_compound_config_label_is_optional():
    cfg = OpCompoundConfig(
        driver="__driver",
        anchors=[
            CompoundAnchor(position=0.0, name="a", values={"k": 0.0}),
            CompoundAnchor(position=1.0, name="b", values={"k": 1.0}),
        ],
    )
    assert cfg.label is None
