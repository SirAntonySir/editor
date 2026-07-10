"""Normalize HSL widgets so every band exposes a full Hue/Sat/Lum triple.

Widgets carrying an `hsl` node get padded to all 24 band-channel bindings. The
frontend then owns *which* bands are visible (single band on spawn, more via the
widget's "+ add colour"), but every band must be BOUND so revealing it yields
editable sliders that write through `set_widget_param`. Bands the AI already
bound keep their values; the rest are added at default 0.
"""
from __future__ import annotations

from app.schemas.widget import ControlBinding, ControlSchema, NodeParamTarget, WidgetNode

_BANDS = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"]
_CHANNELS = [("hue", "Hue"), ("sat", "Saturation"), ("lum", "Luminance")]


def _slider_schema() -> ControlSchema:
    return ControlSchema.model_validate(
        {"control_type": "slider", "min": -100, "max": 100, "step": 1}
    )


def pad_hsl_bindings(
    nodes: list[WidgetNode], bindings: list[ControlBinding]
) -> list[ControlBinding]:
    """Return `bindings` with every band's Hue/Sat/Lum present for each hsl node.

    Existing bindings (and their values) are preserved; missing ones are appended
    at default 0. A no-op when the widget has no hsl node.
    """
    hsl_nodes = [n for n in nodes if n.type == "hsl"]
    if not hsl_nodes:
        return bindings

    existing = {b.param_key for b in bindings}
    out = list(bindings)
    for node in hsl_nodes:
        for band in _BANDS:
            for channel, label in _CHANNELS:
                key = f"{band}_{channel}"
                if key in existing:
                    continue
                existing.add(key)
                out.append(
                    ControlBinding(
                        param_key=key,
                        label=label,
                        control_type="slider",
                        target=NodeParamTarget(node_id=node.id, param_key=key),
                        control_schema=_slider_schema(),
                        value=0,
                        default=0,
                    )
                )
    return out
