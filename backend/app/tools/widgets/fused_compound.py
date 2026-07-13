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

    Not applicable when: no scalar param actually differs from its baseline
    (resolver landed on defaults, or the op is not in the registry).

    Emits THREE anchors and ``interpolation="linear_1d"``:
    - 0.0 "as shot"  = baseline values (canonical or registry default)
    - 1.0 "proposed" = AI-resolved values
    - 1.5 "max"      = op-range extreme in the proposal's direction.
      For params WITH a registry range: ``hi`` if delta > 0, else ``lo``.
      For params WITHOUT a range:       ``proposed + 0.5 * delta``
                                        (linear continuation, same as the
                                        old 2-anchor extrapolation behaviour).

    Params whose delta is within ``_EPSILON`` of zero are excluded from all
    three anchors (driving them would just add float noise).
    """
    reg = get_registry()

    baseline: dict[str, float] = {}
    target: dict[str, float] = {}
    maximum: dict[str, float] = {}

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
            delta = float(resolved) - float(base)
            if abs(delta) < _EPSILON:
                continue
            qkey = f"{node.id}:{key}"
            baseline[qkey] = float(base)
            target[qkey] = float(resolved)
            # Max anchor: op-range extreme in the proposal's direction.
            if param.range is not None:
                lo, hi = param.range
                maximum[qkey] = hi if delta > 0 else lo
            else:
                maximum[qkey] = float(resolved) + 0.5 * delta

    if not target:
        return None

    return OpCompoundConfig(
        driver=DRIVER_KEY,
        label=driver_label,
        interpolation="linear_1d",
        anchors=[
            CompoundAnchor(position=0.0, name="as shot", values=baseline),
            CompoundAnchor(position=1.0, name="proposed", values=target),
            CompoundAnchor(position=DRIVER_MAX, name="max", values=maximum),
        ],
    )


def update_target_anchor(widget: Any, resolved: dict) -> None:
    """Refine hook: rewrite the PROPOSAL anchor (position 1.0) for UNLOCKED
    resolved params, then recompute the MAX anchor (position DRIVER_MAX) from
    the new proposal's direction.

    `resolved` is keyed by bare binding param_key (the resolver's namespace);
    we re-qualify through the binding's target. Baseline (anchor 0) is
    untouched — "as shot" doesn't change because the AI re-thought the target.

    Legacy 2-anchor compounds (no max anchor) are handled gracefully:
    the proposal anchor is rewritten; the max-recompute step is skipped.
    """
    if widget.compound is None or not widget.compound.anchors:
        return

    # Find anchors by position rather than index so this is robust to 2- or 3-anchor tables.
    proposal_anchor = next(
        (a for a in widget.compound.anchors if abs(a.position - 1.0) < _EPSILON),
        None,
    )
    max_anchor = next(
        (a for a in widget.compound.anchors if abs(a.position - DRIVER_MAX) < _EPSILON),
        None,
    )
    baseline_anchor = next(
        (a for a in widget.compound.anchors if abs(a.position - 0.0) < _EPSILON),
        None,
    )
    if proposal_anchor is None:
        return

    locked = set(widget.locked_params or [])
    reg = get_registry()

    for key, value in resolved.items():
        if key in locked:
            continue
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            continue
        binding = next((b for b in widget.bindings if b.param_key == key), None)
        if binding is None:
            continue
        qkey = f"{binding.target.node_id}:{binding.target.param_key}"
        if qkey not in proposal_anchor.values:
            continue

        proposal_anchor.values[qkey] = float(value)

        # Recompute the max anchor for this key if it exists.
        if max_anchor is not None and qkey in max_anchor.values:
            base_val = (
                baseline_anchor.values.get(qkey, 0.0) if baseline_anchor is not None else 0.0
            )
            new_delta = float(value) - base_val
            if abs(new_delta) < _EPSILON:
                # Delta collapsed — keep existing max value (don't drive noise).
                continue
            # Find the registry range for this param to do sign-aware extreme.
            node_id = binding.target.node_id
            param_key = binding.target.param_key
            node = next((n for n in widget.nodes if n.id == node_id), None)
            op = reg.ops.get(node.op_id or "") if node is not None else None
            param_schema = op.params.get(param_key) if op is not None else None
            if param_schema is not None and param_schema.range is not None:
                lo, hi = param_schema.range
                max_anchor.values[qkey] = hi if new_delta > 0 else lo
            else:
                max_anchor.values[qkey] = float(value) + 0.5 * new_delta
