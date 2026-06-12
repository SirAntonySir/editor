"""Domain config facade — reads op param ranges from shared/registry/ops.

Backend code that needs e.g. "what's the valid range for kelvin?" should ask
this module rather than hard-coding `(2000, 10000)`. The op JSON files under
shared/registry/ops are the single source of truth for op param schemas.

This module is intentionally thin: it delegates to the existing registry
loader so we don't fork the schema. The point is to give backend code a
clearly-named import that signals 'read this from the registry, don't
re-type it inline'.
"""

from __future__ import annotations

from app.registry.loader import load_registry
from app.registry.schema import OpParamSchema, RegistryOp


def get_op(op_id: str) -> RegistryOp:
    """Return the registry definition for an op, or raise KeyError."""
    registry = load_registry()
    op = registry.ops.get(op_id)
    if op is None:
        raise KeyError(f"unknown op: {op_id}")
    return op


def get_param(op_id: str, param_key: str) -> OpParamSchema:
    """Return the param schema for `op_id.param_key`."""
    op = get_op(op_id)
    param = op.params.get(param_key)
    if param is None:
        raise KeyError(f"unknown param: {op_id}.{param_key}")
    return param
