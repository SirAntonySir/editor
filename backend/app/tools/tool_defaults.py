"""Per-tool default node + binding payloads for tool_invoked widgets.

Scalar ops (light, color, kelvin, levels) are GENERATED from the shared engine
registry so param keys, ranges and scale never drift from the shader pipeline.
curves + filter are LUT/texture based and stay hand-written until Phase 2.
"""
from typing import Any

from app.engine.registry import ENGINE_OPS

_SCALAR_OPS = ("light", "color", "kelvin", "levels")


def _scalar_tool(op: str) -> dict[str, Any]:
    spec = ENGINE_OPS[op]
    shader_binding = spec["shaderBinding"]
    params = spec["params"]
    exposed = spec["toolDefaults"]  # curated subset the tool shows today
    node_params = {key: params[key]["default"] for key in exposed}
    bindings = [
        {
            "param_key": key,
            "label": params[key]["label"],
            "control_type": "slider",
            "control_schema": {
                "control_type": "slider",
                "min": params[key]["min"],
                "max": params[key]["max"],
                "step": params[key]["step"],
            },
            "value": params[key]["default"],
            "default": params[key]["default"],
        }
        for key in exposed
    ]
    return {"nodes": [{"type": shader_binding, "params": node_params}], "bindings": bindings}


TOOL_DEFAULTS: dict[str, dict[str, Any]] = {op: _scalar_tool(op) for op in _SCALAR_OPS}

# --- LUT / texture ops: hand-written, Phase 2 will give them real controls ----
TOOL_DEFAULTS["curves"] = {
    "nodes": [{"type": "curves", "params": {"intensity": 1.0}}],
    "bindings": [
        {"param_key": "intensity", "label": "Intensity", "control_type": "slider",
         "control_schema": {"control_type": "slider", "min": 0, "max": 1, "step": 0.01},
         "value": 1.0, "default": 1.0},
    ],
}
TOOL_DEFAULTS["filter"] = {
    "nodes": [{"type": "lut", "params": {"intensity": 1.0}}],
    "bindings": [
        {"param_key": "intensity", "label": "Intensity", "control_type": "slider",
         "control_schema": {"control_type": "slider", "min": 0, "max": 1, "step": 0.01},
         "value": 1.0, "default": 1.0},
    ],
}
