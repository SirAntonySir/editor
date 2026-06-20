from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

from app.registry.schema import OpModule, RegistryOp, RegistryPreset

# Default set of op modules included by load_registry. Override via
# load_registry(modules=...) or set EDITOR_OP_MODULES=core,experimental to
# enable experimental ops at runtime without changing call sites.
_DEFAULT_MODULES: frozenset[OpModule] = frozenset({"core", "preset"})


def _modules_from_env() -> frozenset[OpModule] | None:
    raw = os.environ.get("EDITOR_OP_MODULES")
    if not raw:
        return None
    parts = {m.strip() for m in raw.split(",") if m.strip()}
    return frozenset(parts) if parts else None  # type: ignore[arg-type]


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


def load_registry(
    root: Path | None = None,
    modules: frozenset[OpModule] | set[OpModule] | None = None,
) -> Registry:
    """Load ops + presets from `root`. `modules` filters which op modules
    end up in the registry; ops whose declared `module` isn't in the set
    are silently skipped (their JSON files stay on disk, just unregistered).

    Resolution order for `modules`:
      1. explicit arg
      2. `EDITOR_OP_MODULES` env var (comma-separated)
      3. `_DEFAULT_MODULES` = {"core", "preset"}
    Experimental ops only land when the caller opts in.
    """
    root = root or _default_registry_root()
    if not root.exists():
        raise FileNotFoundError(f"registry root not found: {root}")

    enabled: frozenset[OpModule]
    if modules is not None:
        enabled = frozenset(modules)
    else:
        enabled = _modules_from_env() or _DEFAULT_MODULES

    reg = Registry()

    # --- ops ---
    ops_dir = root / "ops"
    if ops_dir.exists():
        for path in sorted(ops_dir.glob("*.json")):
            data = json.loads(path.read_text())
            op = RegistryOp.model_validate(data)
            if op.module not in enabled:
                # Skip silently — the op JSON is on disk but its module
                # isn't enabled this run. Tests / dev / staging can flip
                # the env var to surface experimentals.
                continue
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


def effective_tool_defaults(op: RegistryOp) -> list[str]:
    """Return the curated `tool_defaults` list. When the op did not declare
    one, fall back to its binding param keys in declaration order. Mirrors
    the now-removed engine/registry.py view layer's `toolDefaults` field."""
    if op.tool_defaults is not None:
        return list(op.tool_defaults)
    return [b.param_key for b in op.bindings]


def param_label(op: RegistryOp, param_key: str) -> str:
    """Return the human-readable label for `param_key` on `op`. Resolved via
    the first binding that targets the param; falls back to the key when no
    binding exposes it (engine-internal params, future ops). Mirrors the
    now-removed engine view's `params[key]["label"]` field."""
    return next((b.label for b in op.bindings if b.param_key == param_key), param_key)
