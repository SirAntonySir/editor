"""Fused intent widgets — mechanical compound-block synthesis.

After the phase-2 resolver lands, every LLM-proposed widget gets a
widget-local compound block: anchor 0 = the pre-widget baseline (canonical
value if the layer already had one, else the registry default), anchor 1 =
the resolved targets. `set_widget_param('__driver')` then interpolates
between them (and extrapolates up to t=1.5).

Anchor value keys are node-qualified ("{node_id}:{param_key}") because a
multi-op widget can expose the same bare param_key twice (e.g. `amount` on
clarity + sharpen).

See docs/superpowers/specs/2026-07-11-fused-intent-widgets-design.md.
"""
from __future__ import annotations

from typing import Any

from app.registry.loader import get_registry
from app.registry.schema import CompoundAnchor, OpCompoundConfig

DRIVER_KEY = "__driver"
DRIVER_MAX = 1.5  # Frontend renders this ×100 as the AdjustmentSlider max={150} in FusedWidgetBody.tsx

# Resolver values within this distance of the baseline don't earn an anchor
# entry — driving them would just add float noise.
_EPSILON = 1e-9


def synthesize_compound(
    widget: Any, doc: Any, driver_label: str | None = None,
) -> OpCompoundConfig | None:
    """Build the widget-local compound block, or None when not applicable.

    Not applicable when: the widget is a single-op registry dial (its
    compound lives in the registry and CompoundWidgetBody owns the UI), or
    no scalar param actually differs from its baseline.
    """
    reg = get_registry()

    if len(widget.nodes) == 1:
        only_op = reg.ops.get(widget.nodes[0].op_id or "")
        if only_op is not None and only_op.compound is not None:
            return None

    baseline: dict[str, float] = {}
    target: dict[str, float] = {}
    for node in widget.nodes:
        op = reg.ops.get(node.op_id or "")
        if op is None:
            continue
        canonical = (doc.canonical.get(node.layer_id, {}) or {}).get(node.type, {}) or {}
        for key, param in op.params.items():
            if param.type != "scalar":
                continue  # curves / enums can't ride a 1-D interpolation
            resolved = node.params.get(key)
            if not isinstance(resolved, (int, float)) or isinstance(resolved, bool):
                continue
            base = canonical.get(key, param.default)
            if not isinstance(base, (int, float)) or isinstance(base, bool):
                continue
            if abs(float(resolved) - float(base)) < _EPSILON:
                continue
            qkey = f"{node.id}:{key}"
            baseline[qkey] = float(base)
            target[qkey] = float(resolved)

    if not target:
        return None

    return OpCompoundConfig(
        driver=DRIVER_KEY,
        label=driver_label,
        anchors=[
            CompoundAnchor(position=0.0, name="as shot", values=baseline),
            CompoundAnchor(position=1.0, name="proposed", values=target),
        ],
    )


def update_target_anchor(widget: Any, resolved: dict) -> None:
    """Refine hook: rewrite anchor-1 values for UNLOCKED resolved params.

    `resolved` is keyed by bare binding param_key (the resolver's namespace);
    we re-qualify through the binding's target. Baseline (anchor 0) is
    untouched — "as shot" doesn't change because the AI re-thought the target.
    """
    if widget.compound is None or not widget.compound.anchors:
        return
    target = widget.compound.anchors[-1]
    locked = set(widget.locked_params or [])
    for key, value in resolved.items():
        if key in locked:
            continue
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            continue
        binding = next((b for b in widget.bindings if b.param_key == key), None)
        if binding is None:
            continue
        qkey = f"{binding.target.node_id}:{binding.target.param_key}"
        if qkey in target.values:
            target.values[qkey] = float(value)
