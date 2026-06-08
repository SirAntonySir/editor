from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from app.registry.schema import RegistryOp, RegistryPreset


def _default_registry_root() -> Path:
    # backend/app/registry/loader.py → repo root → shared/registry
    return Path(__file__).resolve().parents[3] / "shared" / "registry"


@dataclass
class Registry:
    ops: dict[str, RegistryOp] = field(default_factory=dict)
    presets: dict[str, RegistryPreset] = field(default_factory=dict)


def load_registry(root: Path | None = None) -> Registry:
    root = root or _default_registry_root()
    if not root.exists():
        raise FileNotFoundError(f"registry root not found: {root}")

    reg = Registry()

    ops_dir = root / "ops"
    if ops_dir.exists():
        for path in sorted(ops_dir.glob("*.json")):
            data = json.loads(path.read_text())
            op = RegistryOp.model_validate(data)
            if op.id in reg.ops:
                raise ValueError(f"duplicate op id {op.id!r} in {path}")
            reg.ops[op.id] = op

    presets_dir = root / "presets"
    if presets_dir.exists():
        for path in sorted(presets_dir.glob("*.json")):
            data = json.loads(path.read_text())
            preset = RegistryPreset.model_validate(data)
            if preset.id in reg.presets:
                raise ValueError(f"duplicate preset id {preset.id!r} in {path}")
            # Validate each preset op references a known op id.
            for pop in preset.ops:
                if pop.op_id not in reg.ops:
                    raise ValueError(
                        f"preset {preset.id!r} references unknown op {pop.op_id!r}"
                    )
            reg.presets[preset.id] = preset

    return reg


# Singleton lazy-loaded for backend-app use.
_cached: Registry | None = None


def get_registry() -> Registry:
    global _cached
    if _cached is None:
        _cached = load_registry()
    return _cached


def reload_registry() -> Registry:
    """Force re-read (test helper)."""
    global _cached
    _cached = load_registry()
    return _cached
