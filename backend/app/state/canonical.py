"""Canonical per-(layer, op) adjustment state — the single source the op_graph
is projected from. `op` is the shader-binding node type (basic, kelvin, curves,
levels, lut). One slot per (layer, op); editing a param overwrites the one value.
"""
from __future__ import annotations

from typing import Any

# canonical: dict[layer_id][op][param_key] -> value
Canonical = dict[str, dict[str, dict[str, Any]]]


def set_param_value(canonical: Canonical, layer_id: str, op: str, param: str, value: Any) -> None:
    canonical.setdefault(layer_id, {}).setdefault(op, {})[param] = value


def clear_param_value(canonical: Canonical, layer_id: str, op: str, param: str) -> bool:
    """Remove one (layer, op, param) value, pruning now-empty op and layer
    dicts so the slot disappears from `canonical_to_nodes`. Returns True if a
    value was removed, False if it was absent (no-op)."""
    layer = canonical.get(layer_id)
    if not layer:
        return False
    ops = layer.get(op)
    if not ops or param not in ops:
        return False
    del ops[param]
    if not ops:
        del layer[op]
    if not layer:
        del canonical[layer_id]
    return True


def canonical_to_nodes(canonical: Canonical) -> list[dict[str, Any]]:
    """Project the canonical state into op_graph node dicts — one node per
    (layer, op), params merged. Deterministic order: layer then op."""
    nodes: list[dict[str, Any]] = []
    for layer_id in sorted(canonical):
        for op in sorted(canonical[layer_id]):
            params = canonical[layer_id][op]
            if not params:
                continue
            nodes.append({
                "id": f"canon:{layer_id}:{op}",
                "type": op,
                "layer_id": layer_id,
                "params": dict(params),
            })
    return nodes
