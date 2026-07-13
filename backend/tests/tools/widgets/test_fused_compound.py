"""Fused intent widgets — schema + synthesis tests."""
from __future__ import annotations

from app.registry.loader import get_registry
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


def test_synthesize_builds_three_anchors_from_default_baseline():
    """synthesize_compound emits 3 anchors: as-shot (0), proposal (1), max (1.5)."""
    w = _fused_candidate_widget()
    block = synthesize_compound(w, _FakeDoc(), driver_label="Blackness")
    assert block is not None
    assert block.driver == "__driver"
    assert block.label == "Blackness"
    assert block.interpolation == "linear_1d"
    assert [a.position for a in block.anchors] == [0.0, 1.0, 1.5]
    assert block.anchors[0].values["n_a:exposure"] == 0.0     # registry default (as shot)
    assert block.anchors[1].values["n_a:exposure"] == -80.0   # resolved (proposed)
    # delta = -80 - 0 = -80 (negative) → range lo = -100
    assert block.anchors[2].values["n_a:exposure"] == -100.0  # max = range lo (sign-aware)


def test_synthesize_max_anchor_positive_delta():
    """Positive delta (proposal > baseline) → max anchor = range hi."""
    w = _fused_candidate_widget()
    # Override: exposure = +60 (baseline 0, delta +60 → max = range hi = 100)
    w.nodes[0].params["exposure"] = 60.0
    block = synthesize_compound(w, _FakeDoc())
    assert block is not None
    assert block.anchors[2].values["n_a:exposure"] == 100.0   # range hi


def test_synthesize_max_anchor_no_range_uses_linear_continuation():
    """Params without a registry range use linear continuation at 1.5×."""
    from app.schemas.widget import ControlBinding, ControlSchema, NodeParamTarget, WidgetNode
    from app.registry.schema import CompoundAnchor, OpCompoundConfig

    # Build a widget whose node op has a param WITHOUT a range.
    # We simulate this by using a non-registry op (returns None) — fall-through.
    # Instead, directly call synthesize after patching a mock that has no range.
    # Simplest: create a widget with a custom mock node.
    import types
    mock_param = types.SimpleNamespace(type="scalar", default=0.0, range=None)
    mock_op = types.SimpleNamespace(params={"amount": mock_param})

    w = _fused_candidate_widget()
    # Replace the binding / node params to use 'amount' with no range.
    w.nodes[0].op_id = "mock_op"
    w.nodes[0].params = {"amount": 50.0}

    reg_real = get_registry()
    import unittest.mock as mock
    with mock.patch.object(reg_real, "ops", {**reg_real.ops, "mock_op": mock_op}):
        block = synthesize_compound(w, _FakeDoc())
    assert block is not None
    # baseline=0, proposal=50, delta=50 → max = 50 + 0.5*50 = 75 (linear continuation)
    assert block.anchors[2].values["n_a:amount"] == 75.0


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


def test_synthesize_returns_none_for_unknown_op():
    # A node whose op_id is not in the registry contributes no param diffs;
    # synthesize_compound returns None (nothing to drive).
    w = _fused_candidate_widget()
    w.nodes[0].op_id = "unknown-op-not-in-registry"
    w.nodes[0].type = "unknown"
    assert synthesize_compound(w, _FakeDoc()) is None


def test_update_target_anchor_rewrites_unlocked_only():
    """Refine rewrites the proposal anchor (position 1.0); locked keys stay."""
    w = _fused_candidate_widget()
    w.compound = synthesize_compound(w, _FakeDoc())
    assert w.compound is not None
    # Sanity: 3-anchor compound after synthesis.
    assert len(w.compound.anchors) == 3

    # Refine to -40: proposal anchor must update; max anchor recomputed.
    update_target_anchor(w, {"exposure": -40.0})
    proposal = next(a for a in w.compound.anchors if abs(a.position - 1.0) < 1e-9)
    max_a = next(a for a in w.compound.anchors if abs(a.position - 1.5) < 1e-9)
    assert proposal.values["n_a:exposure"] == -40.0
    # delta = -40 - 0 = -40 (negative) → max = range lo = -100
    assert max_a.values["n_a:exposure"] == -100.0

    # Lock exposure; further refine must not change it.
    w.locked_params = ["exposure"]
    update_target_anchor(w, {"exposure": -10.0})
    proposal2 = next(a for a in w.compound.anchors if abs(a.position - 1.0) < 1e-9)
    assert proposal2.values["n_a:exposure"] == -40.0  # locked → kept


def test_update_target_anchor_legacy_2anchor_graceful():
    """update_target_anchor on a legacy 2-anchor compound must not crash."""
    w = _fused_candidate_widget()
    # Manually build a 2-anchor legacy block (no max anchor).
    from app.registry.schema import CompoundAnchor, OpCompoundConfig
    w.compound = OpCompoundConfig(
        driver="__driver",
        anchors=[
            CompoundAnchor(position=0.0, name="as shot", values={"n_a:exposure": 0.0}),
            CompoundAnchor(position=1.0, name="proposed", values={"n_a:exposure": -80.0}),
        ],
    )
    # Should not raise; proposal anchor must be rewritten; no max anchor → skip.
    update_target_anchor(w, {"exposure": -50.0})
    proposal = next(a for a in w.compound.anchors if abs(a.position - 1.0) < 1e-9)
    assert proposal.values["n_a:exposure"] == -50.0


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
