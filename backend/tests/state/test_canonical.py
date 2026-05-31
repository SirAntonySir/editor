from app.state.canonical import clear_param_value, set_param_value, canonical_to_nodes


def test_set_param_value_creates_nested_slots():
    canonical: dict = {}
    set_param_value(canonical, "layer_a", "basic", "exposure", 40)
    set_param_value(canonical, "layer_a", "basic", "contrast", -10)
    assert canonical == {"layer_a": {"basic": {"exposure": 40, "contrast": -10}}}


def test_set_param_value_overwrites_same_slot():
    canonical: dict = {}
    set_param_value(canonical, "layer_a", "basic", "exposure", 40)
    set_param_value(canonical, "layer_a", "basic", "exposure", 90)
    assert canonical["layer_a"]["basic"]["exposure"] == 90  # one value, not two


def test_canonical_to_nodes_one_node_per_layer_op():
    canonical = {
        "layer_a": {"basic": {"exposure": 40}, "kelvin": {"kelvin": 6200}},
        "layer_b": {"basic": {"contrast": 10}},
    }
    nodes = canonical_to_nodes(canonical)
    keys = [(n["layer_id"], n["type"]) for n in nodes]
    assert keys == [("layer_a", "basic"), ("layer_a", "kelvin"), ("layer_b", "basic")]
    a_basic = next(n for n in nodes if n["layer_id"] == "layer_a" and n["type"] == "basic")
    assert a_basic["params"] == {"exposure": 40}
    assert a_basic["id"] == "canon:layer_a:basic"


def test_clear_param_value_removes_one_key_and_prunes_empty():
    canonical = {"layer_a": {"basic": {"exposure": 40, "contrast": -10}}}
    # Clearing one key leaves the sibling key intact.
    assert clear_param_value(canonical, "layer_a", "basic", "exposure") is True
    assert canonical == {"layer_a": {"basic": {"contrast": -10}}}
    # Clearing the last key prunes the empty op AND empty layer dicts.
    assert clear_param_value(canonical, "layer_a", "basic", "contrast") is True
    assert canonical == {}


def test_clear_param_value_missing_is_noop():
    canonical = {"layer_a": {"basic": {"exposure": 40}}}
    assert clear_param_value(canonical, "layer_a", "kelvin", "kelvin") is False
    assert clear_param_value(canonical, "nope", "basic", "exposure") is False
    assert canonical == {"layer_a": {"basic": {"exposure": 40}}}
