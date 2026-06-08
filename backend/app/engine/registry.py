"""Engine operation registry — derived from the SSoT registry loader.

Replaces the old engine-registry.json reader. ENGINE_OPS is built at import
time from shared/registry/ops/*.json via the registry loader, so param keys,
ranges, and defaults are always in sync with the frontend registry.

Consumers read: ENGINE_OPS[op_id]["shaderBinding"],
                ENGINE_OPS[op_id]["toolDefaults"],
                ENGINE_OPS[op_id]["params"][key]["label"],
                ENGINE_OPS[op_id]["params"][key]["default"],
                ENGINE_OPS[op_id]["params"][key]["min"],
                ENGINE_OPS[op_id]["params"][key]["max"],
                ENGINE_OPS[op_id]["params"][key]["step"],   (optional)
                ENGINE_OPS[op_id]["params"][key]["unit"],   (optional)
"""
from __future__ import annotations

from typing import Any

from app.registry.loader import get_registry


def _build_engine_ops() -> dict[str, Any]:
    reg = get_registry()
    ops: dict[str, Any] = {}
    for op in reg.ops.values():
        # Curated tool_defaults: use explicit list if present, else all binding keys.
        tool_defaults = op.tool_defaults if op.tool_defaults is not None else [
            b.param_key for b in op.bindings
        ]

        params: dict[str, Any] = {}
        for k, p in op.params.items():
            entry: dict[str, Any] = {
                "label": next(
                    (b.label for b in op.bindings if b.param_key == k), k
                ),
                "default": p.default,
            }
            if p.range is not None:
                entry["min"] = p.range[0]
                entry["max"] = p.range[1]
            entry["step"] = p.step if p.step is not None else 1
            if p.unit is not None:
                entry["unit"] = p.unit
            params[k] = entry

        ops[op.id] = {
            "shaderBinding": op.engine.shader,
            "toolDefaults": tool_defaults,
            "params": params,
        }
    return ops


ENGINE_OPS: dict[str, Any] = _build_engine_ops()


def op_param(op: str, key: str) -> dict[str, Any]:
    return ENGINE_OPS[op]["params"][key]
