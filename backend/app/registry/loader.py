from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

from app.registry.schema import RegistryOp, RegistryPreset


def _default_registry_root() -> Path:
    # backend/app/registry/loader.py → repo root → shared/registry
    return Path(__file__).resolve().parents[3] / "shared" / "registry"


def _user_presets_dir() -> Path | None:
    raw = os.environ.get("EDITOR_USER_PRESETS_DIR")
    if raw:
        return Path(raw)
    home = Path.home() / ".editor" / "presets"
    return home if home.exists() else None


@dataclass
class Registry:
    ops: dict[str, RegistryOp] = field(default_factory=dict)
    presets: dict[str, RegistryPreset] = field(default_factory=dict)


def load_registry(root: Path | None = None) -> Registry:
    root = root or _default_registry_root()
    if not root.exists():
        raise FileNotFoundError(f"registry root not found: {root}")

    reg = Registry()

    # --- ops (unchanged) ---
    ops_dir = root / "ops"
    if ops_dir.exists():
        for path in sorted(ops_dir.glob("*.json")):
            data = json.loads(path.read_text())
            op = RegistryOp.model_validate(data)
            if op.id in reg.ops:
                raise ValueError(f"duplicate op id {op.id!r} in {path}")
            reg.ops[op.id] = op

    # --- presets: multi-source ---
    sources: list[tuple[str, Path]] = []
    builtin = root / "presets"
    if builtin.exists():
        sources.append(("builtin", builtin))
    user = _user_presets_dir()
    if user and user.exists():
        sources.append(("user", user))
    # Project source hook: callers may extend `sources` before invoking
    # _load_presets directly; deferred until .edp embedding spec lands.

    for source_label, source_dir in sources:
        for path in sorted(source_dir.glob("*.json")):
            data = json.loads(path.read_text())
            data.setdefault("source", source_label)
            preset = RegistryPreset.model_validate(data)
            if preset.id in reg.presets:
                raise ValueError(f"duplicate preset id {preset.id!r} in {path}")
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
