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


from app.tools.widgets.fused_compound import synthesize_compound, update_target_anchor
from app.schemas.widget import (
    ControlBinding, ControlSchema, NodeParamTarget, WidgetNode, WidgetOrigin,
)


class _FakeDoc:
    """Just enough of SessionDocument for synthesis: `.canonical`."""
    def __init__(self, canonical=None):
        self.canonical = canonical or {}


def _fused_candidate_widget() -> Widget:
    """A 1-op 'light' widget as _build_widget_multi would produce it, with the
    resolver having set exposure=-80 (registry default 0)."""
    w = Widget.model_validate(_minimal_widget_dict())
    w.nodes = [WidgetNode(
        id="n_a", type="basic", op_id="light",
        params={"exposure": -80.0},
        scope=w.scope, widget_id=w.id, layer_id="layer-1",
    )]
    w.bindings = [ControlBinding(
        param_key="exposure", label="Exposure", control_type="slider",
        control_schema=ControlSchema.model_validate(
            {"control_type": "slider", "min": -100, "max": 100, "step": 1},
        ),
        value=-80.0, default=0.0,
        target=NodeParamTarget(node_id="n_a", param_key="exposure"),
    )]
    return w


def test_synthesize_builds_two_anchors_from_default_baseline():
    w = _fused_candidate_widget()
    block = synthesize_compound(w, _FakeDoc(), driver_label="Blackness")
    assert block is not None
    assert block.driver == "__driver"
    assert block.label == "Blackness"
    assert [a.position for a in block.anchors] == [0.0, 1.0]
    assert block.anchors[0].values["n_a:exposure"] == 0.0     # registry default
    assert block.anchors[1].values["n_a:exposure"] == -80.0   # resolved


def test_synthesize_baseline_prefers_canonical_over_default():
    w = _fused_candidate_widget()
    doc = _FakeDoc(canonical={"layer-1": {"basic": {"exposure": 15.0}}})
    block = synthesize_compound(w, doc)
    assert block is not None
    assert block.anchors[0].values["n_a:exposure"] == 15.0


def test_synthesize_returns_none_when_nothing_changed():
    w = _fused_candidate_widget()
    w.nodes[0].params["exposure"] = 0.0   # resolver landed on the default
    assert synthesize_compound(w, _FakeDoc()) is None


def test_synthesize_skips_registry_dial_single_op():
    w = _fused_candidate_widget()
    w.nodes[0].op_id = "time-of-day"
    w.nodes[0].type = "time_of_day"
    assert synthesize_compound(w, _FakeDoc()) is None


def test_update_target_anchor_rewrites_unlocked_only():
    w = _fused_candidate_widget()
    w.compound = synthesize_compound(w, _FakeDoc())
    assert w.compound is not None
    update_target_anchor(w, {"exposure": -40.0})
    assert w.compound.anchors[1].values["n_a:exposure"] == -40.0
    w.locked_params = ["exposure"]
    update_target_anchor(w, {"exposure": -10.0})
    assert w.compound.anchors[1].values["n_a:exposure"] == -40.0  # locked → kept


from app.tools.widgets.propose_stack import _normalize_plan_entries, _attach_fused_compound


def test_attach_fused_compound_sets_block_and_driver_value():
    w = _fused_candidate_widget()          # origin kind mcp_user_prompt
    _attach_fused_compound(w, _FakeDoc(), driver_label="Blackness")
    assert w.compound is not None
    assert w.driver_value == 1.0


def test_attach_fused_compound_noop_for_tool_invoked():
    w = _fused_candidate_widget()
    w.origin = WidgetOrigin(kind="tool_invoked")
    _attach_fused_compound(w, _FakeDoc(), driver_label=None)
    assert w.compound is None
    assert w.driver_value is None


def test_normalize_old_shape_adds_driver_label_none():
    out = _normalize_plan_entries([{"op_id": "light", "rationale": "darken"}])
    assert out[0]["driver_label"] is None


def test_normalize_new_shape_passes_driver_label_through():
    entry = {"widget_name": "Make it black", "driver_label": "Blackness",
             "ops": [{"op_id": "light"}]}
    out = _normalize_plan_entries([entry])
    assert out[0]["driver_label"] == "Blackness"
