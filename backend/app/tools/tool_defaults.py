"""Per-tool default node + binding payloads for tool_invoked widgets.

Only the 'filter' entry remains here; all scalar and curve ops have been
migrated to propose_stack (which reads defaults directly from the registry).
The 'filter'/LUT op is not yet modeled in the SSoT registry and stays here
until Phase 2 gives it real registry-side controls.
"""
from typing import Any

TOOL_DEFAULTS: dict[str, dict[str, Any]] = {}

# --- LUT / texture ops: hand-written, Phase 2 will give them real controls ----
TOOL_DEFAULTS["filter"] = {
    "nodes": [{"type": "lut", "params": {"intensity": 1.0}}],
    "bindings": [
        {"param_key": "intensity", "label": "Intensity", "control_type": "slider",
         "control_schema": {"control_type": "slider", "min": 0, "max": 1, "step": 0.01},
         "value": 1.0, "default": 1.0},
    ],
}
