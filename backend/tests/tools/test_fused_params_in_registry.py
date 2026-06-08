# backend/tests/tools/test_fused_params_in_registry.py
"""Every param key a fused tool writes onto a node must exist in the shared
engine registry for that node's shader binding — otherwise the WebGL pipeline
silently drops it (no uniform to receive it)."""
from app.engine.registry import ENGINE_OPS
from app.tools.fused import all_fused_templates

# Node types that are texture/structured shaders (no scalar param contract),
# or synthetic frontend-only types (e.g. `compound` carries a bundle that the
# frontend explodes per-key into the per-op pipeline).
STRUCTURED_NODE_TYPES = {"curves", "lut", "compound"}

# Pre-existing, tracked gaps. Each entry is debt to fix separately, NOT a licence
# to add more. Do not extend without a tracking note.
KNOWN_UNBOUND = {
    # Fused kelvin nodes write 'temperature'; the kelvin op/shader read 'kelvin'.
    # TODO(kelvin-temp): rename to 'kelvin' in the kelvin fused templates.
    ("kelvin", "temperature"),
}


def _binding_to_params() -> dict[str, set[str]]:
    """shaderBinding -> union of scalar param keys across ops that bind to it."""
    out: dict[str, set[str]] = {}
    for op in ENGINE_OPS.values():
        out.setdefault(op["shaderBinding"], set()).update(op["params"].keys())
    return out


def test_every_fused_node_param_is_in_the_registry():
    binding_params = _binding_to_params()
    violations: list[str] = []
    for template in all_fused_templates():
        for nd in template.node_skeleton:
            node_type = nd.node_type
            keys = set(nd.tunable_param_keys) | set(nd.fixed_params.keys())
            for key in keys:
                if node_type in STRUCTURED_NODE_TYPES:
                    continue
                if (node_type, key) in KNOWN_UNBOUND:
                    continue
                if key not in binding_params.get(node_type, set()):
                    violations.append(f"{template.id}: ({node_type}, {key})")
    assert not violations, "fused params with no shader uniform: " + ", ".join(violations)
