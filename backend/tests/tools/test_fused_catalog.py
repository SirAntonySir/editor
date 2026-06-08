"""Catalogue contract: every template's bindings target a node it actually
declares, every `param_envelope` key exists in some node's tunable keys
(or in a binding's `param_key` for synthetic LLM names that map onto a node
param via the binding), and IDs are unique.

This pins the structural invariants the framework relies on so a typo'd
template doesn't ship with bindings pointing at non-existent nodes."""
from __future__ import annotations

import pytest

from app.tools.fused import all_fused_templates


_TEMPLATES = list(all_fused_templates())


def test_catalog_size() -> None:
    assert len(_TEMPLATES) == 41


def test_ids_are_unique() -> None:
    ids = [t.id for t in _TEMPLATES]
    assert len(set(ids)) == len(ids), f"duplicate template ids: {ids}"


@pytest.mark.parametrize("template", _TEMPLATES, ids=lambda t: t.id)
def test_bindings_reference_declared_nodes(template) -> None:
    """Each binding's `target.node_id` must reference a node_skeleton entry
    (either by `n_<node_type>` placeholder or already-resolved id)."""
    declared_node_types = {n.node_type for n in template.node_skeleton}
    for binding in template.bindings_skeleton:
        node_id = binding.target.node_id
        assert node_id.startswith("n_"), (
            f"{template.id}: binding {binding.param_key} has non-placeholder "
            f"node_id {node_id!r}"
        )
        type_hint = node_id[2:]
        assert type_hint in declared_node_types, (
            f"{template.id}: binding {binding.param_key} targets node {node_id!r} "
            f"but skeleton declares only {sorted(declared_node_types)}"
        )


@pytest.mark.parametrize("template", _TEMPLATES, ids=lambda t: t.id)
def test_envelope_keys_match_tunable_params_or_bindings(template) -> None:
    """Every `param_envelope` key must be the `param_key` of some binding —
    that's the contract the clamp logic in `run_fused_tool` enforces."""
    binding_keys = {b.param_key for b in template.bindings_skeleton}
    for envelope_key in template.param_envelope:
        assert envelope_key in binding_keys, (
            f"{template.id}: param_envelope key {envelope_key!r} has no "
            f"matching binding (bindings: {sorted(binding_keys)})"
        )


@pytest.mark.parametrize("template", _TEMPLATES, ids=lambda t: t.id)
def test_required_descriptive_fields_present(template) -> None:
    assert template.id, f"empty id on {type(template).__name__}"
    assert template.label, f"empty label on {template.id}"
    assert template.description, f"empty description on {template.id}"
    assert template.typical_use, f"empty typical_use on {template.id}"
