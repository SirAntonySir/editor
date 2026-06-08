"""One-shot migration: read all FusedToolTemplate subclasses and emit preset JSONs.

For each template:
- id, display_name (from label), description, typical_use → preset metadata
- semantic_tags inferred from id (id split on _) plus tag "mood"
- Each NodeSkeleton + bindings_skeleton → one PresetOp with starting params
  derived from `param_envelope` midpoints (so the LLM has a strong prior).

Special handling:
- `basic` node type → split into `light` and/or `color` ops by param key membership.
- `kelvin` node type → remap `temperature` key → `kelvin` (fused uses delta
  "temperature" but registry op param is "kelvin").
- `lut` node type → SKIPped (no registry op).
- `curves` node type with legacy `points` param → SKIPped (registry uses
  rgb/red/green/blue curve_points params, not a single `points` key).
- `compound` node type (time-of-day) → unfolded into constituent ops by
  parsing bundle keys of the form `<op_id>.<param_key>`.

Run once, commit the JSON output. Script is kept under backend/scripts/ for
auditability; Task 15 will delete the fused/ Python code.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.engine.registry import ENGINE_OPS
from app.tools.fused import all_fused_templates
from app.tools.fused_framework import FusedToolTemplate, NodeSkeleton


REPO_ROOT = Path(__file__).resolve().parents[2]
PRESETS_DIR = REPO_ROOT / "shared" / "registry" / "presets"

# Param keys that belong to the `light` op (basic shader, tonal controls).
LIGHT_KEYS = {"exposure", "contrast", "highlights", "shadows", "whites", "blacks", "brightness"}
# Param keys that belong to the `color` op (basic shader, colour controls).
COLOR_KEYS = {"saturation", "vibrance", "hue"}


def _midpoint(lo: float, hi: float) -> float:
    """Center of [lo, hi] range as a starting prior, rounded to 2 dp."""
    return round((lo + hi) / 2, 2)


def _build_param_lookup(template: FusedToolTemplate) -> dict[str, str]:
    """Return a map from node-param-key → envelope-key by inspecting bindings.

    Most fused templates use the same name for both, but a few rename: e.g.
    warm_grade uses envelope key `highlight_warmth` targeting node param
    `highlights`. For those we need the reverse map so we can pull the correct
    midpoint when iterating tunable_param_keys.
    """
    # node_param_key → envelope_key
    mapping: dict[str, str] = {}
    for b in template.bindings_skeleton:
        node_param = b.target.param_key
        envelope_key = b.param_key
        # Only add if there IS an envelope entry for it.
        if envelope_key in template.param_envelope:
            mapping[node_param] = envelope_key
    return mapping


def _node_params(
    template: FusedToolTemplate,
    node: NodeSkeleton,
) -> dict[str, Any]:
    """Return the combined params dict for this node (fixed + envelope midpoints)."""
    # Start with fixed params.
    params: dict[str, Any] = dict(node.fixed_params)
    lookup = _build_param_lookup(template)

    for key in node.tunable_param_keys:
        env_key = lookup.get(key, key)  # fall back to same name
        env = template.param_envelope.get(env_key)
        if env is not None:
            params[key] = _midpoint(env.min, env.max)
        else:
            params[key] = 0
    return params


def _handle_basic_node(
    template: FusedToolTemplate,
    node: NodeSkeleton,
    preset_ops: list[dict[str, Any]],
) -> None:
    """Split a `basic` node into light/color ops based on param key membership."""
    all_params = _node_params(template, node)

    light_params = {k: v for k, v in all_params.items() if k in LIGHT_KEYS}
    color_params = {k: v for k, v in all_params.items() if k in COLOR_KEYS}
    # Fixed params like `saturation: -100` end up in all_params; route them.
    unknown = {k: v for k, v in all_params.items()
               if k not in LIGHT_KEYS and k not in COLOR_KEYS}
    if unknown:
        print(f"  WARN: {template.id} basic node has unrecognised param keys: {list(unknown)}")

    if light_params:
        preset_ops.append({"op_id": "light", "params": light_params})
    if color_params:
        preset_ops.append({"op_id": "color", "params": color_params})
    if not light_params and not color_params:
        print(f"  WARN: {template.id} basic node produced no light or color params")


def _handle_kelvin_node(
    template: FusedToolTemplate,
    node: NodeSkeleton,
    preset_ops: list[dict[str, Any]],
) -> None:
    """Kelvin node: fused templates use `temperature` (delta), registry uses `kelvin`.

    Delta values from the fused framework (e.g. envelope min=-1200, max=1200)
    don't map directly to the registry's kelvin range [2000, 10000]. We emit the
    neutral default (6500 K) for the `kelvin` param and carry through any `tint`.
    """
    all_params = _node_params(template, node)
    registry_params: dict[str, Any] = {}

    for k, v in all_params.items():
        if k == "temperature":
            # Delta mid-point: 0 means no shift → neutral 6500 K.
            registry_params["kelvin"] = 6500
        elif k == "tint":
            registry_params["tint"] = v
        else:
            registry_params[k] = v

    # Always ensure kelvin is present if not already set.
    if "kelvin" not in registry_params and "temperature" not in all_params:
        registry_params["kelvin"] = 6500

    preset_ops.append({"op_id": "kelvin", "params": registry_params})


def _handle_compound_node(
    template: FusedToolTemplate,
    node: NodeSkeleton,
    preset_ops: list[dict[str, Any]],
) -> None:
    """Unfold a compound node into per-op preset ops.

    Bundle keys have the form `<op_id>.<param_key>` (e.g. `light.exposure`,
    `kelvin.kelvin`). We group them by op_id and emit one PresetOp each.
    Special key `time_of_day.position` is skipped (meta-param, not a shader op).
    `filters.*` bundle keys are also skipped (no `filters` op in registry).
    """
    lookup = _build_param_lookup(template)
    op_buckets: dict[str, dict[str, Any]] = {}

    for key in node.tunable_param_keys:
        if "." not in key:
            print(f"  WARN: {template.id} compound key {key!r} has no dot; skipping")
            continue
        op_id, param_key = key.split(".", 1)
        if op_id in ("time_of_day", "filters"):
            continue  # skip meta/unsupported ops
        if op_id not in ENGINE_OPS:
            print(f"  WARN: {template.id} compound bundle op {op_id!r} not in ENGINE_OPS; skipping")
            continue

        env_key = lookup.get(key, key)
        env = template.param_envelope.get(env_key)
        value = _midpoint(env.min, env.max) if env is not None else 0

        op_buckets.setdefault(op_id, {})[param_key] = value

    # Map the `color` op to its actual node_type but they should already be valid.
    for op_id, params in op_buckets.items():
        preset_ops.append({"op_id": op_id, "params": params})


def _process_template(template: FusedToolTemplate) -> list[dict[str, Any]]:
    """Return list of PresetOp dicts for a template; empty if nothing usable."""
    preset_ops: list[dict[str, Any]] = []

    for node in template.node_skeleton:
        if node.node_type == "basic":
            _handle_basic_node(template, node, preset_ops)

        elif node.node_type == "kelvin":
            _handle_kelvin_node(template, node, preset_ops)

        elif node.node_type in ENGINE_OPS:
            # Direct 1:1 mapping (hsl, levels, sharpen, blur, clarity, etc.)
            params = _node_params(template, node)
            preset_ops.append({"op_id": node.node_type, "params": params})

        elif node.node_type == "compound":
            _handle_compound_node(template, node, preset_ops)

        elif node.node_type == "lut":
            print(f"  INFO: {template.id} has lut node (no registry op); skipping node")

        elif node.node_type == "curves":
            # Legacy `points` param doesn't match registry curve_points schema.
            # Registry curves op uses rgb/red/green/blue params instead.
            # Skip unless tunable_param_keys map cleanly to registry params.
            params = _node_params(template, node)
            registry_curves_params = {"rgb", "red", "green", "blue"}
            usable = {k: v for k, v in params.items() if k in registry_curves_params}
            if usable:
                preset_ops.append({"op_id": "curves", "params": usable})
            else:
                print(f"  INFO: {template.id} curves node has no registry-compatible params; skipping node")

        else:
            print(f"  SKIP node: {template.id} node_type={node.node_type!r} not in registry")

    return preset_ops


def _semantic_tags(template_id: str) -> list[str]:
    # Split on both _ and - to get word components.
    import re
    parts = re.split(r"[_\-]", template_id)
    base = {"mood"}
    return sorted(base | set(p for p in parts if p))


def migrate() -> None:
    PRESETS_DIR.mkdir(parents=True, exist_ok=True)
    count = 0
    skipped = 0

    for template in all_fused_templates():
        preset_ops = _process_template(template)

        if not preset_ops:
            print(f"  SKIP {template.id}: no usable ops produced")
            skipped += 1
            continue

        preset = {
            "id": template.id,
            "display_name": template.label,
            "source": "builtin",
            "description": template.description,
            "typical_use": template.typical_use,
            "semantic_tags": _semantic_tags(template.id),
            "ops": preset_ops,
        }

        # Use sanitised filename (replace - with _ for filesystem friendliness).
        filename = template.id.replace("-", "_") + ".json"
        out_path = PRESETS_DIR / filename
        out_path.write_text(json.dumps(preset, indent=2) + "\n")
        print(f"  WROTE {out_path.relative_to(REPO_ROOT)}")
        count += 1

    print(f"\nWrote {count} preset(s), skipped {skipped}.")


if __name__ == "__main__":
    migrate()
