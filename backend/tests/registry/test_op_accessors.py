"""Accessor helpers on RegistryOp.

These were previously implicit in the now-deleted engine/registry.py
view layer. Promoted into the loader so consumers don't re-derive."""

from app.registry.loader import (
    effective_tool_defaults,
    get_registry,
    param_label,
)


def test_effective_tool_defaults_uses_explicit_when_present():
    """An op declaring `tool_defaults` returns that list verbatim."""
    reg = get_registry()
    op = reg.ops["light"]
    assert effective_tool_defaults(op) == ["exposure", "contrast", "highlights", "shadows"]


def test_effective_tool_defaults_falls_back_to_binding_keys():
    """An op without explicit tool_defaults falls back to the binding param keys
    in declaration order (matches the old engine view's behaviour)."""
    reg = get_registry()
    candidates = [op for op in reg.ops.values() if op.tool_defaults is None]
    assert candidates, "no op without explicit tool_defaults found — adjust test fixture"
    op = candidates[0]
    expected = [b.param_key for b in op.bindings]
    assert effective_tool_defaults(op) == expected


def test_param_label_from_binding():
    """When a binding maps a param to a label, param_label returns the label."""
    reg = get_registry()
    op = reg.ops["kelvin"]
    first_param = next(iter(op.params))
    binding = next((b for b in op.bindings if b.param_key == first_param), None)
    if binding is None:
        return  # fallback for if kelvin's first param ever drops its binding
    assert param_label(op, first_param) == binding.label


def test_param_label_falls_back_to_key_when_no_binding():
    """When no binding exposes the param, return the key itself."""
    reg = get_registry()
    op = reg.ops["light"]
    missing_key = next(iter(op.params)) + "_does_not_exist"
    assert param_label(op, missing_key) == missing_key
