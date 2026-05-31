"""Loads the shared engine registry (the single param contract).

Same JSON the frontend imports — guarantees param keys, ranges and scale never
drift between backend defaults and the WebGL pipeline."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

# backend/app/engine/registry.py → parents[3] == repo root
_REGISTRY_PATH = Path(__file__).resolve().parents[3] / "shared" / "engine-registry.json"


@lru_cache(maxsize=1)
def _load() -> dict[str, Any]:
    with _REGISTRY_PATH.open(encoding="utf-8") as fh:
        return json.load(fh)


def _ops() -> dict[str, Any]:
    return _load()["ops"]


# Eager snapshot for ergonomic access (registry is static at runtime).
ENGINE_OPS: dict[str, Any] = _ops()


def op_param(op: str, key: str) -> dict[str, Any]:
    return ENGINE_OPS[op]["params"][key]
