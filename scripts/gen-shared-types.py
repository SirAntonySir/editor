#!/usr/bin/env python3
"""Generate frontend bindings from backend Pydantic config.

This script is the runtime/UI half of the shared-schema SSOT pipeline.
It reads `backend/app/config/runtime.py` and `backend/app/config/ui.py`,
extracts the default values, and emits a single TypeScript file at
`shared/types/generated-config.ts` that the frontend imports.

Why a custom emitter instead of `json-schema-to-typescript`?
  - Config values are *literal defaults*, not just structural types. We want
    the frontend to use the actual numbers, not just know that they are
    numbers. A const-object emitter gives us both shape and value in one
    artifact.
  - Zero npm install — the script is self-contained Python.

The wire schema half (Pydantic models for SessionStateSnapshot, Widget, etc.)
is exported as JSON Schema files under `shared/schemas/` for downstream
consumers (planned: a follow-up step that runs `json-schema-to-typescript`
to produce a generated.ts companion file). Today the schema generation is
artifact-only; widget.ts continues to be hand-maintained until the migration
lands.

Usage:
    python scripts/gen-shared-types.py
    python scripts/gen-shared-types.py --check     # exit non-zero if drift
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "backend"
SHARED_DIR = REPO_ROOT / "shared"
CONFIG_OUT = SHARED_DIR / "types" / "generated-config.ts"
SCHEMA_OUT_DIR = SHARED_DIR / "schemas"

# Make the backend package importable.
sys.path.insert(0, str(BACKEND_DIR))


HEADER = """\
// THIS FILE IS GENERATED — DO NOT EDIT BY HAND.
// Run `python scripts/gen-shared-types.py` (or `npm run gen:types`) to refresh.
// Source of truth: backend/app/config/runtime.py + backend/app/config/ui.py

/* eslint-disable */
"""


def _emit_const_block(name: str, fields: dict[str, Any], doc: str) -> str:
    """Emit a `as const` object plus a derived type."""
    lines: list[str] = []
    lines.append(f"/** {doc} */")
    lines.append(f"export const {name} = {{")
    for key, value in fields.items():
        camel = _snake_to_camel(key)
        lines.append(f"  {camel}: {_lit(value)},")
    lines.append("} as const;")
    lines.append(f"export type {name}Type = typeof {name};")
    return "\n".join(lines)


def _snake_to_camel(snake: str) -> str:
    head, *tail = snake.split("_")
    return head + "".join(p.capitalize() for p in tail)


def _lit(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, str):
        return json.dumps(value)
    raise TypeError(f"unsupported config literal type: {type(value).__name__}")


def gen_config_ts() -> str:
    from app.config.runtime import RuntimeConfig
    from app.config.ui import UiConfig

    runtime_defaults = RuntimeConfig().model_dump()
    ui_defaults = UiConfig().model_dump()

    parts = [HEADER.rstrip(), ""]
    parts.append(
        _emit_const_block(
            "RUNTIME",
            runtime_defaults,
            "Runtime constants — timings, limits, LLM budgets. "
            "Mirrors backend RuntimeConfig.",
        )
    )
    parts.append("")
    parts.append(
        _emit_const_block(
            "UI",
            ui_defaults,
            "UI numeric tokens — z-index, motion, layout bounds. "
            "Mirrors backend UiConfig.",
        )
    )
    parts.append("")
    return "\n".join(parts)


# ----- Pydantic schema export (artifact-only for now) -----

_SCHEMA_MODELS: list[tuple[str, str, str]] = [
    # (module, attr, output filename stem)
    ("app.schemas.widget", "Widget", "widget"),
    ("app.schemas.widget", "Scope", "scope"),
    ("app.schemas.widget", "ControlBinding", "control-binding"),
    ("app.state.snapshot", "SessionStateSnapshot", "session-state-snapshot"),
    ("app.state.events", "StateEvent", "state-event"),
    ("app.schemas.image_context", "ImageContext", "image-context"),
    ("app.schemas.enriched_context", "EnrichedImageContext", "enriched-image-context"),
    ("app.schemas.operation_graph", "OperationGraph", "operation-graph"),
]


def gen_schemas() -> dict[Path, str]:
    """Return a mapping of {output path: JSON-Schema text}."""
    import importlib

    out: dict[Path, str] = {}
    for module_name, attr, stem in _SCHEMA_MODELS:
        try:
            module = importlib.import_module(module_name)
        except Exception as exc:
            print(f"WARN: skip {module_name}.{attr}: {exc}", file=sys.stderr)
            continue
        model = getattr(module, attr, None)
        if model is None:
            print(f"WARN: {attr} not found in {module_name}", file=sys.stderr)
            continue
        try:
            schema = model.model_json_schema(by_alias=True, mode="serialization")
        except Exception as exc:
            print(f"WARN: schema gen failed for {module_name}.{attr}: {exc}", file=sys.stderr)
            continue
        out[SCHEMA_OUT_DIR / f"{stem}.schema.json"] = json.dumps(schema, indent=2, sort_keys=True) + "\n"
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="Exit non-zero if the generated files differ from what's on disk.",
    )
    args = parser.parse_args()

    SHARED_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_OUT.parent.mkdir(parents=True, exist_ok=True)
    SCHEMA_OUT_DIR.mkdir(parents=True, exist_ok=True)

    config_ts = gen_config_ts()
    schemas = gen_schemas()

    pending: list[tuple[Path, str]] = [(CONFIG_OUT, config_ts)]
    pending.extend(schemas.items())

    if args.check:
        diffs: list[str] = []
        for path, want in pending:
            have = path.read_text() if path.exists() else ""
            if have != want:
                diffs.append(str(path.relative_to(REPO_ROOT)))
        if diffs:
            print("Out-of-date generated files:", file=sys.stderr)
            for d in diffs:
                print(f"  {d}", file=sys.stderr)
            print("Run `python scripts/gen-shared-types.py` to refresh.", file=sys.stderr)
            return 1
        print("Generated files are up to date.")
        return 0

    for path, content in pending:
        path.write_text(content)
        print(f"wrote {path.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
