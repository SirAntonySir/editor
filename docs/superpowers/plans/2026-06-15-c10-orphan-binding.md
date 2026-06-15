# C10 Orphan-Binding Silent Skip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close C10 by replacing the silent-skip-on-missing-node behaviour in `set_widget_param` with an explicit `orphan_binding` error envelope. The "race + lost-update" half of the audit framing turned out to be moot — the per-session `with_document_lock` (`tools/registry.py:118`) already serialises all mutating tools — so this cluster addresses the divergence bug that was actually present and documents the lock-protected status of the race scenario.

**Architecture:** Today `SetWidgetParamTool.handler` (lines 51-55) does `node = next((n for n in w.nodes if n.id == binding.target.node_id), None)` and then `if node is not None:` guards the canonical write. If the binding's target node has been removed (e.g. a future tool clears a widget node without also dropping its bindings), the FE-side `binding.value` is updated at line 50 but the canonical params are never set. The op_graph projection therefore omits the user's change, and the next render shows the old value — silent widget vs. op-graph divergence. The same gap exists in the compound-recompute path (lines 70-79): `compound_node = node` propagates the None, and the inner `if compound_node is not None:` guards canonical writes while still updating binding values, again producing partial state. Fix: raise a new `_OrphanBinding` exception when the binding's target node is missing, mapped to a new `orphan_binding` error envelope code. The handler bails BEFORE mutating the binding's value, so the widget state stays consistent. Add a doctrine comment explaining why the audit's "race" framing doesn't apply (the per-session lock).

**Tech Stack:** Python 3.12 / FastAPI / Pydantic v2 + pytest. Backend only.

---

## File Structure

**Modify:**
- `backend/app/schemas/errors.py` — add `"orphan_binding"` to the `ErrorCode` literal.
- `backend/app/tools/registry.py` — add the `_OrphanBinding` → `"orphan_binding"` mapping in `_classify_exception`.
- `backend/app/tools/widgets/set_widget_param.py` — define `_OrphanBinding(KeyError)`, raise it BEFORE the `binding.value = input.value` write when the target node is missing, and add a doctrine comment about the per-session lock.
- `backend/tests/tools/widgets/test_set_widget_param_orphan.py` — new test file with regression tests for the orphan path (single-node widget, compound widget).
- `docs/audit-2026-06-15.md` — flip C10 to `[x]` with notes on both halves (race framing protected by lock; silent-skip half fixed); bump progress snapshot to 12 of 14 Critical fully resolved.

**Not changed:**
- The happy path of `set_widget_param` — when the target node exists, behaviour is byte-identical.
- The on-wire shape of envelope responses (the new `orphan_binding` code follows the existing schema exactly).
- The compound resolver itself.
- Any other tool.

---

## Doctrine

> Mutating tools run under `with_document_lock(session_id)` (registry.py:117-118), so two `set_widget_param` calls on the same session serialise. The "concurrent set-param" race framing in the original audit therefore can't manifest in production. The bug the audit was actually circling — silent state divergence — lives in the missing-node path: the FE binding value gets updated, the canonical write is skipped, and the next op_graph projection silently lies. The fix raises `_OrphanBinding` BEFORE any mutation so the widget state stays consistent. Cleanup of dangling bindings (when a tool removes a node) is a separate concern; this cluster only ensures that an orphan binding can't poison the document mid-write.

---

### Task 1: Add `orphan_binding` error code + exception mapping + raise it from `set_widget_param`

**Files:**
- Modify: `backend/app/schemas/errors.py`
- Modify: `backend/app/tools/registry.py`
- Modify: `backend/app/tools/widgets/set_widget_param.py`

- [ ] **Step 1: Add `"orphan_binding"` to the `ErrorCode` literal**

Open `backend/app/schemas/errors.py`. Find:

```python
ErrorCode = Literal[
    "missing_session", "missing_image", "missing_context",
    "invalid_input", "unknown_tool", "unknown_widget",
    "unknown_region", "unknown_mask",
    "scope_unresolvable", "sam_failed",
    "llm_validation_failed", "llm_envelope_violation",
    "fused_tool_not_found", "skin_safety_violation",
    "transport_error", "internal_error",
]
```

Replace with:

```python
ErrorCode = Literal[
    "missing_session", "missing_image", "missing_context",
    "invalid_input", "unknown_tool", "unknown_widget",
    "unknown_region", "unknown_mask", "orphan_binding",
    "scope_unresolvable", "sam_failed",
    "llm_validation_failed", "llm_envelope_violation",
    "fused_tool_not_found", "skin_safety_violation",
    "transport_error", "internal_error",
]
```

- [ ] **Step 2: Wire `_OrphanBinding` into `_classify_exception`**

Open `backend/app/tools/registry.py`. Find `_classify_exception` (around lines 25-49). Inside the `if isinstance(exc, KeyError):` branch, find the existing `elif` chain for `_UnknownRegion`, `_UnknownMask`, etc. Add an `elif` for `_OrphanBinding`:

```python
        elif ex_name == "_OrphanBinding":
            code = "orphan_binding"
```

Place it alphabetically or logically — somewhere inside the existing branch chain. The final block should look like (showing context):

```python
    if isinstance(exc, KeyError):
        ex_name = exc.__class__.__name__
        code = "unknown_widget"
        if ex_name == "_UnknownRegion":
            code = "unknown_region"
        elif ex_name == "_UnknownMask":
            code = "unknown_mask"
        elif ex_name == "_OrphanBinding":
            code = "orphan_binding"
        elif ex_name == "_ScopeUnresolvable":
            code = "scope_unresolvable"
        elif ex_name == "_FusedToolNotFound":
            code = "fused_tool_not_found"
        return _err(code, str(exc), retryable=False)
```

- [ ] **Step 3: Rewrite `set_widget_param.handler`**

Open `backend/app/tools/widgets/set_widget_param.py`. The current `_UnknownWidget` and `_UnknownBinding` classes (lines 10-15) need a sibling. After the existing `_UnknownBinding` class, add:

```python
class _OrphanBinding(KeyError):
    """The binding points at a node that no longer exists on the widget.
    Mapped to `orphan_binding` in the envelope so the FE can surface a
    specific error rather than the value silently failing to round-trip
    through the op_graph projection."""
    pass
```

Then replace the `handler` method body. Current (lines 43-87):

```python
    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        w = doc.widgets.get(input.widget_id)
        if w is None:
            raise _UnknownWidget(input.widget_id)
        binding = next((b for b in w.bindings if b.param_key == input.param_key), None)
        if binding is None:
            raise _UnknownBinding(input.param_key)
        binding.value = input.value
        node = next((n for n in w.nodes if n.id == binding.target.node_id), None)
        if node is not None:
            node.params[binding.target.param_key] = input.value
            # Canonical write: the op_graph now projects from here.
            doc.set_param(node.layer_id, node.type, binding.target.param_key, input.value)

        # Compound widget driver-recompute / implicit lock.
        ...
```

Replace with:

```python
    async def handler(self, doc: SessionDocument, input: _Input) -> _Output:  # noqa: A002
        # Note on concurrency: this tool is `kind = "mutate"`, so the
        # registry runs it under `with_document_lock(session_id)`
        # (tools/registry.py:117). Two concurrent set_widget_param calls
        # on the same session therefore serialise — the audit's "race +
        # lost-update on locked_params" framing doesn't apply. The bug
        # this handler closes is the divergence one: if a binding points
        # at a node that no longer exists on the widget (e.g. a future
        # tool clears the node without dropping the binding), the
        # binding.value would update but the canonical write would
        # silently skip, leaving widget and op_graph drifting apart. We
        # raise `_OrphanBinding` BEFORE touching any state.
        w = doc.widgets.get(input.widget_id)
        if w is None:
            raise _UnknownWidget(input.widget_id)
        binding = next((b for b in w.bindings if b.param_key == input.param_key), None)
        if binding is None:
            raise _UnknownBinding(input.param_key)
        node = next((n for n in w.nodes if n.id == binding.target.node_id), None)
        if node is None:
            raise _OrphanBinding(
                f"binding {input.param_key!r} on widget {input.widget_id!r} "
                f"points at node {binding.target.node_id!r}, which is no longer "
                f"on the widget — widget needs cleanup"
            )

        binding.value = input.value
        node.params[binding.target.param_key] = input.value
        # Canonical write: the op_graph now projects from here.
        doc.set_param(node.layer_id, node.type, binding.target.param_key, input.value)

        # Compound widget driver-recompute / implicit lock.
        # - Driver param change: recompute the bundle via the registry's anchor
        #   table and write all non-locked derived keys back to the node + canon.
        # - Derived key edit: implicit lock-on-edit so a subsequent driver
        #   change won't overwrite the user's value.
        from app.registry.compound_resolver import resolve_compound
        from app.registry.loader import get_registry

        reg = get_registry()
        op = reg.ops.get(w.op_id) if w.op_id else None
        if op is not None and op.compound is not None:
            if input.param_key == op.compound.driver:
                derived = resolve_compound(w, op, float(input.value))
                # The bundle lives on the same node as the driver — `node`
                # is guaranteed non-None here because we'd have raised
                # `_OrphanBinding` above.
                for bkey, bvalue in derived.items():
                    node.params[bkey] = bvalue
                    doc.set_param(node.layer_id, node.type, bkey, bvalue)
                    bbind = next((b for b in w.bindings if b.param_key == bkey), None)
                    if bbind is not None:
                        bbind.value = bvalue
            else:
                # Derived key edit → implicit lock.
                if input.param_key not in w.locked_params:
                    w.locked_params.append(input.param_key)

        w.revision += 1
        doc.update_widget(w)
        return _Output(ok=True)
```

Key changes:
1. The `node is None` check moves UP (before `binding.value = input.value`) and raises `_OrphanBinding` instead of silently skipping.
2. The compound-recompute branch no longer needs `if compound_node is not None:` — `node` is guaranteed non-None at that point. The `compound_node` local alias is removed for clarity.
3. A long doctrine comment at the top of the handler explains the per-session lock + the orphan-binding fix.

- [ ] **Step 4: Run the backend suite**

```bash
cd /Users/anton/Dev/Projects/editor/backend && .venv/bin/pytest tests/ -q
```

Expected: all existing tests pass. The orphan path wasn't previously exercisable through a test (no fixture creates an orphan binding), so existing tests won't hit the new exception.

- [ ] **Step 5: Commit**

```bash
cd /Users/anton/Dev/Projects/editor
git add backend/app/schemas/errors.py backend/app/tools/registry.py backend/app/tools/widgets/set_widget_param.py
git commit -m "fix(set_widget_param): raise orphan_binding instead of silent canonical-skip"
```

Report the new commit SHA.

---

### Task 2: Regression tests

**Files:**
- Create: `backend/tests/tools/widgets/test_set_widget_param_orphan.py`

- [ ] **Step 1: Write the tests**

Create the file with EXACTLY this content (adapt fixture imports if the existing widget-tool tests use different patterns):

```python
"""C10 regression: set_widget_param raises orphan_binding when the
binding's target node is missing from the widget. Without the fix the
binding.value update would land but the canonical write would silently
skip, leaving widget vs. op_graph drift."""

import pytest

from app.schemas.widget import (
    ControlBinding, ControlSchema, NodeParamTarget,
    Scope, Widget, WidgetNode, WidgetOrigin, WidgetPreview,
)
from app.state.document import SessionDocument
from app.tools.widgets.set_widget_param import (
    SetWidgetParamTool, _OrphanBinding,
)


def _widget_with_orphan_binding() -> Widget:
    """Build a widget whose only binding references a node id NOT in
    `widget.nodes`. Simulates the post-cleanup-by-other-tool state."""
    scope = Scope.model_validate({"kind": "global"})
    return Widget(
        id="w_1", intent="test", scope=scope,
        origin=WidgetOrigin(kind="tool_invoked", prompt=None, parent_widget_id=None),
        op_id="basic", composed=False,
        nodes=[
            WidgetNode(
                id="n_present", type="basic", params={"exposure": 0.0},
                scope=scope, inputs=[], widget_id="w_1",
            ),
        ],
        bindings=[
            ControlBinding(
                param_key="exposure", label="Exposure", control_type="slider",
                control_schema=ControlSchema.model_validate(
                    {"control_type": "slider", "min": -2, "max": 2, "step": 0.1},
                ),
                value=0.0, default=0.0,
                # Targets a node id that doesn't exist on the widget.
                target=NodeParamTarget(node_id="n_ghost", param_key="exposure"),
            ),
        ],
        preview=WidgetPreview(kind="none", auto_before_after=False),
        rejected_attempts=[], status="active", revision=1,
    )


@pytest.mark.asyncio
async def test_set_widget_param_raises_orphan_binding_when_node_missing():
    doc = SessionDocument(session_id="s1")
    doc.add_widget(_widget_with_orphan_binding())
    tool = SetWidgetParamTool()
    with pytest.raises(_OrphanBinding, match="n_ghost"):
        await tool.handler(
            doc,
            SetWidgetParamTool.input_schema.model_validate({
                "widgetId": "w_1", "paramKey": "exposure", "value": 1.5,
            }),
        )


@pytest.mark.asyncio
async def test_set_widget_param_does_not_mutate_state_on_orphan():
    """Critical invariant: the orphan path raises BEFORE mutating
    `binding.value`. After the failure, the widget's bindings are
    untouched and no canonical entry was created."""
    doc = SessionDocument(session_id="s1")
    doc.add_widget(_widget_with_orphan_binding())
    tool = SetWidgetParamTool()
    try:
        await tool.handler(
            doc,
            SetWidgetParamTool.input_schema.model_validate({
                "widgetId": "w_1", "paramKey": "exposure", "value": 1.5,
            }),
        )
    except _OrphanBinding:
        pass
    w = doc.widgets["w_1"]
    assert w.bindings[0].value == 0.0  # original value preserved
    # Canonical (the op_graph projection source) is untouched.
    assert doc.canonical == {}


@pytest.mark.asyncio
async def test_set_widget_param_normal_path_still_works():
    """Sanity: a binding that DOES point at an existing node mutates
    binding.value, node.params, AND canonical, as before."""
    scope = Scope.model_validate({"kind": "global"})
    doc = SessionDocument(session_id="s1")
    w = Widget(
        id="w_1", intent="test", scope=scope,
        origin=WidgetOrigin(kind="tool_invoked", prompt=None, parent_widget_id=None),
        op_id="basic", composed=False,
        nodes=[
            WidgetNode(
                id="n_1", type="basic", params={"exposure": 0.0},
                scope=scope, inputs=[], widget_id="w_1", layer_id="L1",
            ),
        ],
        bindings=[
            ControlBinding(
                param_key="exposure", label="Exposure", control_type="slider",
                control_schema=ControlSchema.model_validate(
                    {"control_type": "slider", "min": -2, "max": 2, "step": 0.1},
                ),
                value=0.0, default=0.0,
                target=NodeParamTarget(node_id="n_1", param_key="exposure"),
            ),
        ],
        preview=WidgetPreview(kind="none", auto_before_after=False),
        rejected_attempts=[], status="active", revision=1,
    )
    doc.add_widget(w)
    tool = SetWidgetParamTool()
    out = await tool.handler(
        doc,
        SetWidgetParamTool.input_schema.model_validate({
            "widgetId": "w_1", "paramKey": "exposure", "value": 1.5,
        }),
    )
    assert out.ok is True
    w_after = doc.widgets["w_1"]
    assert w_after.bindings[0].value == 1.5
    assert w_after.nodes[0].params["exposure"] == 1.5
    # Canonical was set via doc.set_param.
    assert doc.canonical["L1"]["basic"]["exposure"] == 1.5
```

NOTE: the test file imports `_OrphanBinding` directly. The `model_validate({"widgetId": ...})` uses camelCase per the `camel_config` aliases on the input schema — match existing test-file conventions.

### Step 2: Run the new tests

```bash
cd /Users/anton/Dev/Projects/editor/backend && .venv/bin/pytest tests/tools/widgets/test_set_widget_param_orphan.py -v
```

Expected: 3 passed.

### Step 3: Run the full backend suite

```bash
cd /Users/anton/Dev/Projects/editor/backend && .venv/bin/pytest tests/ -q
```

Expected: 640 passed (637 prior + 3 new).

### Step 4: Commit

```bash
cd /Users/anton/Dev/Projects/editor
git add backend/tests/tools/widgets/test_set_widget_param_orphan.py
git commit -m "test(set_widget_param): cover orphan_binding raise + state invariant"
```

Report the new commit SHA.

---

### Task 3: Audit doc flip

**Files:**
- Modify: `docs/audit-2026-06-15.md`

- [ ] **Step 1: Edit C10 entry**

Find:

```markdown
- [ ] **C10. Race + lost-update on compound widget edits** — open
  - `backend/app/tools/widgets/set_widget_param.py:82-83` — two concurrent set-param calls on different keys of the same compound widget both read empty `locked_params`, both append, second overwrites first. Lock state lost.
  - Same file 44-55: if `node` is None (binding exists, target node deleted), the canonical write is silently skipped → widget vs. op-graph divergence.
```

Replace with:

```markdown
- [x] **C10. Race + lost-update on compound widget edits** — resolved
  - [x] `backend/app/tools/widgets/set_widget_param.py:82-83` — two concurrent set-param calls on different keys of the same compound widget both read empty `locked_params`, both append, second overwrites first. Lock state lost. **Audit framing didn't apply:** `set_widget_param` is `kind="mutate"`, so the tool registry already serialises calls per session via `with_document_lock` (`tools/registry.py:117`). Two concurrent calls on the same session queue; no in-process race. Documented in the handler's doctrine comment so future readers don't reintroduce the concern.
  - [x] Same file 44-55: if `node` is None (binding exists, target node deleted), the canonical write is silently skipped → widget vs. op-graph divergence. **Fix landed:** now raises `_OrphanBinding` BEFORE any state mutation; mapped to a new `orphan_binding` error envelope code. Tests cover (a) the raise, (b) the state-invariant that no binding/canonical mutation occurs on the orphan path, and (c) the happy path still works.
```

- [ ] **Step 2: Bump the progress snapshot**

Find:

```markdown
**Progress snapshot:** 14 Critical → 11 fully resolved, 2 partial, 1 open. 26 High → 13 resolved (13 open). Medium & Low buckets largely open; a handful of Low items landed in the mechanical wave.
```

Replace with:

```markdown
**Progress snapshot:** 14 Critical → 12 fully resolved, 2 partial, 0 open. 26 High → 13 resolved (13 open). Medium & Low buckets largely open; a handful of Low items landed in the mechanical wave.
```

NOTE: the previous "13 resolved" High line carries an off-by-one from a prior commit (actual fully-resolved High count is 12 per the bullet checkboxes). Do NOT fix that here; this commit is C10-scoped. If you notice the discrepancy, leave it alone — a separate audit-tidy commit can address it.

- [ ] **Step 3: Commit**

```bash
cd /Users/anton/Dev/Projects/editor
git add docs/audit-2026-06-15.md
git commit -m "docs(audit): mark C10 (orphan-binding silent skip) resolved"
```

Report the new commit SHA.

---

## Self-Review

**Spec coverage:**

| Audit finding | Addressed in |
|---|---|
| C10 bullet 1 — concurrent locked_params race | Task 1 Step 3 doctrine comment (audit framing doesn't apply) |
| C10 bullet 2 — silent canonical-skip on orphan binding | Task 1 Step 3 (raises _OrphanBinding); Task 2 (regression tests) |

Both bullets close. The first as "framing didn't apply" with documentation; the second as a real fix.

**Behavioural preservation:**
- The happy path is byte-identical: same binding.value update, same canonical write, same compound recompute, same lock-on-edit, same `update_widget` call.
- The compound-recompute branch's removal of the `compound_node is not None` guard is safe — at that point `node` is guaranteed non-None because the handler raised earlier if it was None.
- Any callers (frontend's `useParam` hook chain, REST endpoint, MCP routes) that previously experienced a silent-skip and stale op_graph value now get a typed `orphan_binding` envelope. That's the desired surface — they can show an error or trigger widget cleanup instead of pretending the write succeeded.

**Placeholder scan:** none. Tests include real Widget/WidgetNode/ControlBinding instances; no skeletons.

**Type consistency:** `_OrphanBinding` inherits from `KeyError` (matching the existing `_UnknownWidget` / `_UnknownBinding` siblings); `_classify_exception` picks it up via the `isinstance(exc, KeyError)` branch + class name check. `orphan_binding` is added to the `ErrorCode` literal so envelope construction passes pydantic validation.

**Risk analysis:**
- A real session that had an orphan binding pre-this-commit (rare; would require a future tool removing nodes without cleaning bindings, which doesn't exist today) would silently misbehave; after this commit it returns an `orphan_binding` envelope. That's an improvement, not a regression.
- The compound-recompute branch's `node.params[bkey] = bvalue` + `doc.set_param(...)` now both fire unconditionally. Confirmed: if the driver edit reached the bundle loop, `node` is the driver's node and is non-None by construction.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-15-c10-orphan-binding.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
