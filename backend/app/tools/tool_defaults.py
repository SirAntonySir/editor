"""Per-tool default node + binding payloads for tool_invoked widgets.

When the user clicks a toolrail button (Light, Curves, Levels, Kelvin, Color,
Filters), the backend ships these defaults instead of calling the LLM. Keys
must match the fused_tool_id sent by the frontend.

Match the param ranges and defaults to the frontend ProcessingDefinitions
in src/processing/*.tsx.
"""
from typing import Any

TOOL_DEFAULTS: dict[str, dict[str, Any]] = {
    "light": {
        "nodes": [{
            "type": "basic",
            "params": {
                "exposure": 0.0, "contrast": 0.0,
                "highlights": 0.0, "shadows": 0.0,
            },
        }],
        "bindings": [
            {"param_key": "exposure", "label": "Exposure", "control_type": "slider",
             "control_schema": {"control_type": "slider", "min": -1, "max": 1, "step": 0.01},
             "value": 0.0, "default": 0.0},
            {"param_key": "contrast", "label": "Contrast", "control_type": "slider",
             "control_schema": {"control_type": "slider", "min": -1, "max": 1, "step": 0.01},
             "value": 0.0, "default": 0.0},
            {"param_key": "highlights", "label": "Highlights", "control_type": "slider",
             "control_schema": {"control_type": "slider", "min": -1, "max": 1, "step": 0.01},
             "value": 0.0, "default": 0.0},
            {"param_key": "shadows", "label": "Shadows", "control_type": "slider",
             "control_schema": {"control_type": "slider", "min": -1, "max": 1, "step": 0.01},
             "value": 0.0, "default": 0.0},
        ],
    },
    "color": {
        "nodes": [{
            "type": "basic",
            "params": {"saturation": 0.0, "vibrance": 0.0},
        }],
        "bindings": [
            {"param_key": "saturation", "label": "Saturation", "control_type": "slider",
             "control_schema": {"control_type": "slider", "min": -1, "max": 1, "step": 0.01},
             "value": 0.0, "default": 0.0},
            {"param_key": "vibrance", "label": "Vibrance", "control_type": "slider",
             "control_schema": {"control_type": "slider", "min": -1, "max": 1, "step": 0.01},
             "value": 0.0, "default": 0.0},
        ],
    },
    "kelvin": {
        "nodes": [{
            "type": "kelvin",
            "params": {"temp": 5500.0, "tint": 0.0},
        }],
        "bindings": [
            {"param_key": "temp", "label": "Temperature", "control_type": "slider",
             "control_schema": {"control_type": "slider", "min": 2000, "max": 10000, "step": 50, "unit": "K"},
             "value": 5500.0, "default": 5500.0},
            {"param_key": "tint", "label": "Tint", "control_type": "slider",
             "control_schema": {"control_type": "slider", "min": -1, "max": 1, "step": 0.01},
             "value": 0.0, "default": 0.0},
        ],
    },
    "curves": {
        "nodes": [{
            "type": "curves",
            "params": {"intensity": 1.0},
        }],
        "bindings": [
            {"param_key": "intensity", "label": "Intensity", "control_type": "slider",
             "control_schema": {"control_type": "slider", "min": 0, "max": 1, "step": 0.01},
             "value": 1.0, "default": 1.0},
        ],
    },
    "levels": {
        "nodes": [{
            "type": "levels",
            "params": {"black": 0.0, "white": 1.0, "gamma": 1.0},
        }],
        "bindings": [
            {"param_key": "black", "label": "Black Point", "control_type": "slider",
             "control_schema": {"control_type": "slider", "min": 0, "max": 1, "step": 0.01},
             "value": 0.0, "default": 0.0},
            {"param_key": "white", "label": "White Point", "control_type": "slider",
             "control_schema": {"control_type": "slider", "min": 0, "max": 1, "step": 0.01},
             "value": 1.0, "default": 1.0},
            {"param_key": "gamma", "label": "Gamma", "control_type": "slider",
             "control_schema": {"control_type": "slider", "min": 0.1, "max": 3.0, "step": 0.01},
             "value": 1.0, "default": 1.0},
        ],
    },
    "filter": {
        "nodes": [{
            "type": "lut",
            "params": {"intensity": 1.0},
        }],
        "bindings": [
            {"param_key": "intensity", "label": "Intensity", "control_type": "slider",
             "control_schema": {"control_type": "slider", "min": 0, "max": 1, "step": 0.01},
             "value": 1.0, "default": 1.0},
        ],
    },
}
