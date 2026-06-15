# H23 — Collapse `engine/registry.py` into the SSoT Registry

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete `backend/app/engine/registry.py` (the `ENGINE_OPS` dict + `op_param()` helper). Migrate its handful of test + script consumers to use the SSoT `Registry` from `backend/app/registry/loader.py` directly.

**Architecture:** `engine/registry.py` is a derived view — at import time it transforms the SSoT registry's `RegistryOp` Pydantic models into a flatter dict shape `{shaderBinding, toolDefaults, params[key]: {label, default, min, max, step, unit}}`. The original motivation (replacing the old `engine-registry.json` reader) is obsolete: the consumer-shaped dict has effectively no production callers — only a fused-params consistency test and a one-shot migration script use it. The audit reference says "ENGINE_OPS vs registry/loader.py overlap — separate cluster left open for now"; closing it.

**Tech Stack:** Python 3.12, Pydantic v2, pytest.

**Audit reference:** `docs/audit-2026-06-15.md`, H23 (remaining piece).

---

## What we know about consumers

`grep -rln "ENGINE_OPS\|engine.registry import" backend/ --include='*.py' --exclude-dir='.venv' --exclude-dir='__pycache__'` returns exactly four files:

1. `backend/app/engine/registry.py` — the file we want to delete.
2. `backend/scripts/migrate_fused_to_presets.py` — one-shot migration; uses `ENGINE_OPS` for `op_id in ENGINE_OPS` membership checks.
3. `backend/tests/engine/test_registry.py` — directly tests the `ENGINE_OPS` shape (param keys, tool defaults, etc.).
4. `backend/tests/tools/test_fused_params_in_registry.py` — uses `ENGINE_OPS.values()` to validate that every fused-tool param has a shader binding.

Note: `backend/app/tools/widgets/propose_stack.py` came up in a name-only grep but the matches are local variable names (`op_params`), NOT references to `ENGINE_OPS` or `op_param`. Zero production consumers.

The migration script is acknowledged elsewhere in the audit as "blocks deletion of `tools/fused/`" — it's a candidate for separate removal. We will NOT delete it in this plan; we'll migrate its references.

## The shape we're collapsing

Engine view (today, from `_build_engine_ops`):
```python
ENGINE_OPS[op_id] = {
    "shaderBinding": op.engine.shader,
    "toolDefaults": op.tool_defaults if op.tool_defaults is not None else [b.param_key for b in op.bindings],
    "params": {
        k: {
            "label": next((b.label for b in op.bindings if b.param_key == k), k),
            "default": p.default,
            "min": p.range[0] if p.range else absent,
            "max": p.range[1] if p.range else absent,
            "step": p.step if p.step is not None else 1,
            "unit": p.unit if p.unit is not None else absent,
        }
        for k, p in op.params.items()
    }
}
```

After this plan, callers walk `get_registry().ops[op_id]` directly. The two derived fields (`toolDefaults` fallback to binding param keys; `label` lookup via bindings) are folded into small accessor functions in `app/registry/loader.py` so the *one* test that needs the label can call them too. The migration script only needs `op_id in registry.ops`, which is trivial.

---

## File structure

- Modify: `backend/app/registry/loader.py` — add two small accessor helpers.
- Delete: `backend/app/engine/registry.py`.
- Delete: `backend/app/engine/__init__.py` IF empty after.
- Modify: `backend/scripts/migrate_fused_to_presets.py` — swap `ENGINE_OPS` for direct registry access.
- Delete: `backend/tests/engine/test_registry.py` (its assertions move into `backend/tests/registry/test_registry_shape.py`).
- Create: `backend/tests/registry/test_registry_shape.py` (or append to existing `test_schema.py`).
- Modify: `backend/tests/tools/test_fused_params_in_registry.py` — use `get_registry()`.

---

## Task 1: Add accessor helpers to `app/registry/loader.py`

The engine view exposed two pieces of computed data that callers want directly:
- The effective `tool_defaults` (explicit list or fall back to binding param keys).
- The binding-derived `label` for a param.

We add small typed helpers so callers don't re-derive these.

**Files:**
- Modify: `backend/app/registry/loader.py` (add near `get_registry()`, around line 121)
- Modify: `backend/app/registry/schema.py` (only if `RegistryOp` doesn't already expose the helpers — likely needs read-only methods; do not add fields)

- [ ] **Step 1: Read the schema**

```bash
cat /Users/anton/Dev/Projects/editor/backend/app/registry/schema.py
```

Note the existing shape of `RegistryOp`, `OpBinding`, and `OpParam`. The fields used by `_build_engine_ops` are: `op.engine.shader`, `op.tool_defaults`, `op.bindings[].param_key`, `op.bindings[].label`, `op.params[].default`, `op.params[].range`, `op.params[].step`, `op.params[].unit`.

- [ ] **Step 2: Write failing tests for the new helpers**

Create `backend/tests/registry/test_op_accessors.py`:

```python
"""Accessor helpers on RegistryOp.

These were previously implicit in the now-deleted engine/registry.py
view layer. Promoted into the loader so consumers don't re-derive."""

from app.registry.loader import get_registry, effective_tool_defaults, param_label


def test_effective_tool_defaults_uses_explicit_when_present():
    """An op declaring `tool_defaults` returns that list verbatim."""
    reg = get_registry()
    op = reg.ops["light"]
    assert effective_tool_defaults(op) == ["exposure", "contrast", "highlights", "shadows"]


def test_effective_tool_defaults_falls_back_to_binding_keys():
    """An op without explicit tool_defaults falls back to the binding param keys
    in declaration order (matches the old engine view's behaviour)."""
    reg = get_registry()
    # Pick an op known to have no tool_defaults. If `sharpen` declares them,
    # find another by scanning the registry:
    candidates = [op for op in reg.ops.values() if op.tool_defaults is None]
    assert candidates, "no op without explicit tool_defaults found — adjust test fixture"
    op = candidates[0]
    expected = [b.param_key for b in op.bindings]
    assert effective_tool_defaults(op) == expected


def test_param_label_from_binding():
    """When a binding maps a param to a label, param_label returns the label."""
    reg = get_registry()
    op = reg.ops["kelvin"]
    # Find a binding for the op's first param
    first_param = next(iter(op.params))
    binding = next((b for b in op.bindings if b.param_key == first_param), None)
    if binding is None:
        # Fall back to a different op if kelvin doesn't have this shape
        return
    assert param_label(op, first_param) == binding.label


def test_param_label_falls_back_to_key_when_no_binding():
    """When no binding exposes the param, return the key itself."""
    reg = get_registry()
    op = reg.ops["light"]
    # Construct a guaranteed-missing key by suffixing a real param.
    missing_key = next(iter(op.params)) + "_does_not_exist"
    assert param_label(op, missing_key) == missing_key
```

- [ ] **Step 3: Run the test and confirm it fails**

```bash
cd /Users/anton/Dev/Projects/editor/backend && .venv/bin/pytest tests/registry/test_op_accessors.py -v
```

Expected: import error / NameError on `effective_tool_defaults` / `param_label`.

- [ ] **Step 4: Implement the helpers in `loader.py`**

Open `backend/app/registry/loader.py`. After the `reload_registry()` function (around line 127), add:

```python
from app.registry.schema import RegistryOp


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
```

Add the `RegistryOp` import at the top if it's not already there (it likely isn't — `loader.py` imports `OpModule, RegistryOp, RegistryPreset` already; verify with a quick read).

- [ ] **Step 5: Run the test and confirm it passes**

```bash
cd /Users/anton/Dev/Projects/editor/backend && .venv/bin/pytest tests/registry/test_op_accessors.py -v
```

Expected: all 4 PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/registry/loader.py backend/tests/registry/test_op_accessors.py
git commit -m "$(cat <<'EOF'
feat(registry): add effective_tool_defaults + param_label accessors

Promotes the derived bits of the engine/registry.py view layer (the
tool_defaults binding-key fallback and the binding-derived label lookup)
into the SSoT loader, so callers don't re-derive. Preparation for
deleting engine/registry.py.

Audit follow-up — H23.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Migrate `tests/tools/test_fused_params_in_registry.py`

This test uses `ENGINE_OPS.values()` to iterate ops and check that every fused-tool param resolves to a shader binding.

**Files:**
- Modify: `backend/tests/tools/test_fused_params_in_registry.py`

- [ ] **Step 1: Read the current test**

```bash
cat /Users/anton/Dev/Projects/editor/backend/tests/tools/test_fused_params_in_registry.py
```

Note exactly what shape it walks. Likely something like:

```python
for op in ENGINE_OPS.values():
    for key, p in op["params"].items():
        ...
```

- [ ] **Step 2: Rewrite to use `get_registry()`**

Replace the import:
```python
# OLD: from app.engine.registry import ENGINE_OPS
# NEW:
from app.registry.loader import get_registry
```

Replace the iteration:
```python
# OLD: for op in ENGINE_OPS.values():
#        for key in op["params"]: ...
# NEW:
reg = get_registry()
for op in reg.ops.values():
    for key in op.params:
        # `op` is now a RegistryOp model. Field access is op.id, op.params[key].default,
        # op.engine.shader, etc. Use accessor helpers from Task 1 where applicable.
        ...
```

Keep the assertions semantically identical; only the access shape changes (dict-style `op["params"]` → attribute-style `op.params`).

- [ ] **Step 3: Run the test and confirm green**

```bash
cd /Users/anton/Dev/Projects/editor/backend && .venv/bin/pytest tests/tools/test_fused_params_in_registry.py -v
```

Expected: PASS.

- [ ] **Step 4: Run the full backend suite to confirm nothing else broke**

```bash
cd /Users/anton/Dev/Projects/editor/backend && .venv/bin/pytest -q
```

Expected: same pass count as before this task (no new tests added in this step).

- [ ] **Step 5: Commit**

```bash
git add backend/tests/tools/test_fused_params_in_registry.py
git commit -m "$(cat <<'EOF'
refactor(tests): drop ENGINE_OPS usage from fused-params consistency test

Walks get_registry().ops directly. No semantic change; preparation for
deleting engine/registry.py.

Audit follow-up — H23.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Migrate `scripts/migrate_fused_to_presets.py`

One-shot script. Only uses `ENGINE_OPS` for membership checks like `op_id in ENGINE_OPS` and `node.node_type in ENGINE_OPS`.

**Files:**
- Modify: `backend/scripts/migrate_fused_to_presets.py`

- [ ] **Step 1: Confirm usage**

```bash
grep -n "ENGINE_OPS\|engine.registry" /Users/anton/Dev/Projects/editor/backend/scripts/migrate_fused_to_presets.py
```

Expected: import line at top + 2–3 `in ENGINE_OPS` membership checks.

- [ ] **Step 2: Replace**

Swap the import:
```python
# OLD: from app.engine.registry import ENGINE_OPS
# NEW:
from app.registry.loader import get_registry
```

Near the top of the function that does the checks, materialise the op-id set once:
```python
known_op_ids = set(get_registry().ops)
```

Replace each `op_id in ENGINE_OPS` and `node.node_type in ENGINE_OPS` with `op_id in known_op_ids` / `node.node_type in known_op_ids`.

- [ ] **Step 3: Smoke-run the script with `--dry-run` if it supports one, or just `--help`**

```bash
cd /Users/anton/Dev/Projects/editor/backend && .venv/bin/python -m scripts.migrate_fused_to_presets --help 2>&1 | head -10
```

Expected: prints usage (or runs without crashing). The goal is just to confirm the import swap didn't break the module's top-level.

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/migrate_fused_to_presets.py
git commit -m "$(cat <<'EOF'
refactor(scripts): drop ENGINE_OPS usage from migrate_fused_to_presets

Materialises the op-id set from get_registry().ops at the start of the
check, swaps the in-set membership tests. Preparation for deleting
engine/registry.py.

Audit follow-up — H23.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Replace `tests/engine/test_registry.py` with a registry-shape test

The existing file tests the now-obsolete view shape (`ENGINE_OPS["light"]["params"]` etc.). Its assertions are still valuable as a CI sanity net — they validate that the registry has known ops with known param keys and known tool defaults. We migrate those assertions to walk the `Registry` directly, then delete the old file.

**Files:**
- Create: `backend/tests/registry/test_registry_shape.py` (consolidates the assertions)
- Delete: `backend/tests/engine/test_registry.py`
- Maybe delete: `backend/tests/engine/__init__.py` and `backend/tests/engine/` dir if empty

- [ ] **Step 1: Read the existing test file**

```bash
cat /Users/anton/Dev/Projects/editor/backend/tests/engine/test_registry.py
```

Note the 5–6 assertions (op-id set, light tool defaults, kelvin/levels param keys, sharpen shape, op_param ranges).

- [ ] **Step 2: Write the new test file**

Create `backend/tests/registry/test_registry_shape.py`:

```python
"""Sanity assertions about the SSoT registry's shape.

Migrated from tests/engine/test_registry.py, which tested the
now-removed engine/registry.py view layer. The assertions here walk
get_registry() directly and use the new accessor helpers."""

from app.registry.loader import (
    effective_tool_defaults,
    get_registry,
    param_label,
)


def test_registry_contains_known_ops():
    """The registry has the expected core ops."""
    reg = get_registry()
    assert set(reg.ops) == {
        "light",
        "color",
        "kelvin",
        "curves",
        "levels",
        "filter",
        "sharpen",
        "clarity",
        "blur",
        "noise",
        "vignette",
        "grain",
        "split_tone",
        "hsl",
    }
    # ^ EDIT this set to match what the deleted test_registry.py asserted.
    # Run `grep -A 12 "set(ENGINE_OPS) ==" /Users/anton/Dev/Projects/editor/backend/tests/engine/test_registry.py`
    # to read the canonical list and paste it verbatim.


def test_light_tool_defaults():
    reg = get_registry()
    assert effective_tool_defaults(reg.ops["light"]) == [
        "exposure", "contrast", "highlights", "shadows",
    ]


def test_kelvin_param_keys():
    reg = get_registry()
    keys = set(reg.ops["kelvin"].params)
    # EDIT this set to the canonical kelvin keys from the deleted test.
    assert "kelvin" in keys


def test_levels_param_keys():
    reg = get_registry()
    keys = set(reg.ops["levels"].params)
    assert {"black", "white", "gamma"} <= keys


def test_sharpen_shape():
    """Sharpen's shader binding + params are present and well-formed."""
    reg = get_registry()
    sharpen = reg.ops["sharpen"]
    assert sharpen.engine.shader  # truthy shader binding
    assert sharpen.params  # has params


def test_kelvin_param_metadata():
    reg = get_registry()
    op = reg.ops["kelvin"]
    p = op.params["kelvin"]
    assert p.range is not None
    assert p.default is not None
    # Label resolves via the binding:
    label = param_label(op, "kelvin")
    assert isinstance(label, str) and label


def test_levels_gamma_param_metadata():
    reg = get_registry()
    op = reg.ops["levels"]
    p = op.params["gamma"]
    assert p.range is not None
    assert p.default is not None
```

**Critical:** the actual op-set and param-key assertions must match what the deleted file asserted. Before writing this test, run:
```bash
cat /Users/anton/Dev/Projects/editor/backend/tests/engine/test_registry.py
```
and copy the canonical literal values into the new file.

- [ ] **Step 3: Run the new test**

```bash
cd /Users/anton/Dev/Projects/editor/backend && .venv/bin/pytest tests/registry/test_registry_shape.py -v
```

Expected: all PASS (assuming you copied the canonical sets correctly).

- [ ] **Step 4: Delete the old test file**

```bash
cd /Users/anton/Dev/Projects/editor
git rm backend/tests/engine/test_registry.py
# If the dir is empty (no other test files) also remove __init__ and the dir:
ls backend/tests/engine/
# If only __init__.py remains:
git rm backend/tests/engine/__init__.py
rmdir backend/tests/engine 2>/dev/null || true
```

- [ ] **Step 5: Run the full backend suite**

```bash
cd /Users/anton/Dev/Projects/editor/backend && .venv/bin/pytest -q
```

Expected: same pass count, minus the count from the deleted file plus the count from the new file. Net should be ≈zero or slightly positive (we added more granular helper tests in Task 1).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(tests): rehome registry-shape tests from engine/ to registry/

The deleted tests/engine/test_registry.py covered the ENGINE_OPS view
shape. Its assertions move into tests/registry/test_registry_shape.py
and now walk get_registry() directly via the accessor helpers added in
the earlier slice.

Audit follow-up — H23.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Delete `engine/registry.py`

The view layer has no remaining consumers.

**Files:**
- Delete: `backend/app/engine/registry.py`
- Maybe delete: `backend/app/engine/__init__.py` and `backend/app/engine/` dir if empty

- [ ] **Step 1: Final consumer check**

```bash
cd /Users/anton/Dev/Projects/editor && grep -rln "ENGINE_OPS\|from app.engine.registry\|engine.registry import" backend/ --include='*.py' | grep -v ".venv\|__pycache__"
```

Expected output: ONLY `backend/app/engine/registry.py` itself. If anything else lists, that's a missed migration — go back to Task 2 or 3 and migrate it.

- [ ] **Step 2: Delete the file**

```bash
cd /Users/anton/Dev/Projects/editor
git rm backend/app/engine/registry.py
ls backend/app/engine/
# If only __init__.py remains:
git rm backend/app/engine/__init__.py
rmdir backend/app/engine 2>/dev/null || true
```

- [ ] **Step 3: Run the full backend suite**

```bash
cd /Users/anton/Dev/Projects/editor/backend && .venv/bin/pytest -q
```

Expected: all pass. No import errors anywhere.

- [ ] **Step 4: Run `npm run check` from repo root for good measure**

```bash
cd /Users/anton/Dev/Projects/editor && npm run check
```

Expected: 0 errors (nothing on the frontend touched).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(engine): delete engine/registry.py — collapsed into SSoT registry

The derived view layer (ENGINE_OPS, op_param) had no production
consumers after the preceding migration commits. Its two derived
fields are now accessor helpers on the SSoT registry
(effective_tool_defaults, param_label).

Closes the remaining piece of audit H23.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Out of scope

- Deleting `migrate_fused_to_presets.py` itself (the audit M-bucket flags it as a separate cleanup).
- Touching `app/registry/schema.py` field shapes — purely additive helpers.
- Frontend registry consumers — `shared/registry/ops/*.json` is the SSoT for both sides; this plan is backend-only.

## Done when

- 5 commits land on the branch (Tasks 1–5).
- `grep -rln "ENGINE_OPS\|engine.registry" backend/ --include='*.py' --exclude-dir='.venv' --exclude-dir='__pycache__'` returns nothing.
- `cd backend && .venv/bin/pytest -q` is green.
- `backend/app/engine/` is gone (or empty).
