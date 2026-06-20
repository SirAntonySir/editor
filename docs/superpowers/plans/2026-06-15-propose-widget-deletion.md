# `propose_widget` Deletion + Registry Consolidation (H23 + H24) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the "two entry points to widget spawning" (H24) finding by deleting `propose_widget.py` and routing the filter/LUT path through `propose_stack`. Also closes the live remnant of H23 (registry consolidation): `TOOL_DEFAULTS` only carries the `filter` entry — once `propose_stack` owns filter spawning, the whole `tool_defaults.py` module can go.

**Architecture:** Research showed `propose_widget` is now a deprecated fast-path that only handles `op_id="filter"` with `origin="tool_invoked"` and ONE frontend caller (`src/tools/filters-tool.tsx`). Every other adjustment moved to `propose_stack` long ago. The filter widget shape is small (one `lut` node + an `intensity` slider binding); `TOOL_DEFAULTS` holds it as a 7-line dict literal. We inline that shape into a new `_handle_filter_spawn` method on `ProposeStackTool`, migrate the one frontend caller, and delete the dead entry point + the dead defaults dict + the dead wrapper on the frontend. Behaviour-preserving — the produced widget is byte-identical.

The single cross-module coupling we have to handle: `propose_stack.py:337` imports `_MissingContext` from `propose_widget.py`. We move that exception into `propose_stack.py` (its only consumer), then `propose_widget.py` has nothing left.

**Tech Stack:** Python 3.12 / FastAPI / Pydantic v2 + React/TypeScript. Backend + a one-file frontend migration.

---

## File Structure

**Modify:**
- `backend/app/tools/widgets/propose_stack.py` — define `_MissingContext` locally; add `_handle_filter_spawn` and route `forced_ops == ["filter"]` to it; widen the `_Input` doc comment.
- `backend/app/tools/widgets/__init__.py` — drop `ProposeWidgetTool` from the registration list.
- `backend/app/mcp/test_server.py` *(if needed)* — drop `propose_widget` from the MCP tools-list assertion.
- `backend/tests/mcp/test_e2e_loop.py` — drop `propose_widget` from the tools-list assertion + the explanatory comment.
- `src/tools/filters-tool.tsx` — call `backendTools.propose_stack(sid, { ..., forcedOps: ['filter'], ... })` instead of `propose_widget`.
- `src/lib/backend-tools.ts` — drop the `propose_widget` wrapper.
- `src/components/widget/CompoundWidgetBody.test.tsx` — drop the `propose_widget` mock entry (only present if the test mocks `backendTools`).
- `docs/audit-2026-06-15.md` — flip H23 + H24 to `[x]`; bump progress snapshot from 10 → 12 of 26 High.

**Delete:**
- `backend/app/tools/widgets/propose_widget.py` — entire file.
- `backend/app/tools/tool_defaults.py` — entire file (now empty after the `filter` entry moves inline).

**Not changed:**
- The on-wire widget produced by the filter path (same `nodes`, same `bindings`, same `op_id="filter"`, same `intensity` slider). Verified by the test in Task 2.
- The frontend `LutRegistry.register(adjustmentId, ...)` flow — that lives entirely client-side and is unaffected.
- Any other call path through `propose_stack` (`forced_ops` for registry ops, `preset_id`, LLM, autonomous).

---

## Doctrine

> One entry point for widget spawning: `propose_stack`. The `filter` op_id is a recognised forced_ops member that builds a LUT widget without touching the registry — it's the only carve-out, deliberately small. If a future change models filter as a real registry op, the carve-out can fold into the standard `_handle_tool_invoked` path.

---

### Task 1: Move `_MissingContext` from `propose_widget.py` to `propose_stack.py`

`propose_stack.py` already imports `_MissingContext` from `propose_widget.py` at runtime (lazy import inside the LLM-path guard). Moving the exception out of `propose_widget.py` makes the latter ready to delete and removes a circular-ish smell.

**Files:**
- Modify: `backend/app/tools/widgets/propose_stack.py`
- Modify: `backend/app/tools/widgets/propose_widget.py`

- [ ] **Step 1: Add `_MissingContext` to `propose_stack.py`**

Open `backend/app/tools/widgets/propose_stack.py`. After the existing imports block (after the `from app.tools.base import BackendTool, ToolPermissions` line), insert:

```python


class _MissingContext(Exception):
    """Mapped to missing_context in the envelope by the registry. Raised by
    the LLM path when analyze_context hasn't run yet."""
    pass
```

- [ ] **Step 2: Update the lazy import inside `_handle_llm_path` to use the local class**

In `propose_stack.py`, find:

```python
        if doc.get_image_context(DEFAULT_IMAGE_NODE_ID) is None:
            from app.tools.widgets.propose_widget import _MissingContext
            raise _MissingContext("call prepare_image then analyze_context first")
```

Replace with:

```python
        if doc.get_image_context(DEFAULT_IMAGE_NODE_ID) is None:
            raise _MissingContext("call prepare_image then analyze_context first")
```

- [ ] **Step 3: Update `propose_widget.py` to re-export `_MissingContext` from `propose_stack.py`**

`propose_widget.py` may still import or define `_MissingContext` for back-compat during the migration. Update its definition to:

```python
from app.tools.widgets.propose_stack import _MissingContext  # noqa: F401
```

(Keep the alias at the very end of the file — anyone still importing it gets the same class. This becomes moot in Task 4 when `propose_widget.py` is deleted.)

- [ ] **Step 4: Run the backend suite**

```bash
cd /Users/anton/Dev/Projects/editor/backend && .venv/bin/pytest tests/ -q
```

Expected: all green (631 passed).

- [ ] **Step 5: Commit**

```bash
cd /Users/anton/Dev/Projects/editor
git add backend/app/tools/widgets/propose_stack.py backend/app/tools/widgets/propose_widget.py
git commit -m "refactor(widgets): move _MissingContext to propose_stack (its only consumer)"
```

---

### Task 2: Add filter-spawn handling to `propose_stack` + an integration test

`ProposeStackTool._handle_tool_invoked` currently rejects any `forced_ops` member that isn't in `reg.ops`. The `filter` op_id is intentionally outside the registry (LUT presets are managed client-side via `LutRegistry`). Add a `_handle_filter_spawn` method that builds the LUT widget shape inline (replicating `TOOL_DEFAULTS["filter"]`) and route `forced_ops == ["filter"]` to it before the registry-lookup branch.

**Files:**
- Modify: `backend/app/tools/widgets/propose_stack.py`
- Create: `backend/tests/tools/widgets/test_propose_stack_filter.py` (new)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/tools/widgets/test_propose_stack_filter.py` with EXACTLY this content:

```python
"""propose_stack handles the `filter` op_id without touching the registry.

The widget shape is identical to what TOOL_DEFAULTS['filter'] used to
produce via the legacy propose_widget path: one lut node, one intensity
slider binding, scope passed through, origin tool_invoked."""

import pytest

from app.schemas.widget import Scope
from app.state.document import SessionDocument
from app.tools.widgets.propose_stack import ProposeStackTool


@pytest.mark.asyncio
async def test_propose_stack_filter_spawns_lut_widget_with_intensity_binding():
    doc = SessionDocument(session_id="s1")
    tool = ProposeStackTool()
    scope = Scope.model_validate({"kind": "global"})
    out = await tool.handler(
        doc,
        ProposeStackTool.input_schema.model_validate({
            "intent": "Apply Vintage filter",
            "scope": {"kind": "global"},
            "origin": "tool_invoked",
            "forcedOps": ["filter"],
            "layerId": "L1",
        }),
    )
    assert len(out.widgets) == 1
    w = out.widgets[0]
    assert w["opId"] == "filter"
    assert w["origin"]["kind"] == "tool_invoked"
    assert w["scope"] == scope.model_dump(mode="json", by_alias=True)
    # One lut node with intensity=1.0
    assert len(w["nodes"]) == 1
    node = w["nodes"][0]
    assert node["type"] == "lut"
    assert node["params"] == {"intensity": 1.0}
    # One intensity slider binding
    assert len(w["bindings"]) == 1
    b = w["bindings"][0]
    assert b["paramKey"] == "intensity"
    assert b["label"] == "Intensity"
    assert b["controlType"] == "slider"
    assert b["value"] == 1.0
    assert b["default"] == 1.0
    # Binding targets the node we just built.
    assert b["target"]["nodeId"] == node["id"]
    assert b["target"]["paramKey"] == "intensity"


@pytest.mark.asyncio
async def test_propose_stack_filter_with_image_node_scope_propagates_layer_ids():
    """When scope.kind == 'image_node', the node carries layer_ids and the
    legacy single layer_id is the first entry — mirrors what propose_widget
    used to do."""
    doc = SessionDocument(session_id="s1")
    tool = ProposeStackTool()
    out = await tool.handler(
        doc,
        ProposeStackTool.input_schema.model_validate({
            "intent": "Apply Vintage filter",
            "scope": {"kind": "image_node", "imageNodeId": "in-1", "layerIds": ["L1", "L2"]},
            "origin": "tool_invoked",
            "forcedOps": ["filter"],
            "layerId": "ignored",
        }),
    )
    w = out.widgets[0]
    assert w["nodes"][0]["layerId"] == "L1"
    assert w["nodes"][0]["layerIds"] == ["L1", "L2"]


@pytest.mark.asyncio
async def test_propose_stack_filter_combined_with_registry_op_is_rejected():
    """Mixed forced_ops (filter + a registry op in the same call) is not
    supported — the filter path is single-op only."""
    doc = SessionDocument(session_id="s1")
    tool = ProposeStackTool()
    with pytest.raises(ValueError, match="filter"):
        await tool.handler(
            doc,
            ProposeStackTool.input_schema.model_validate({
                "intent": "irrelevant",
                "scope": {"kind": "global"},
                "origin": "tool_invoked",
                "forcedOps": ["filter", "basic"],
                "layerId": "L1",
            }),
        )
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/anton/Dev/Projects/editor/backend && .venv/bin/pytest tests/tools/widgets/test_propose_stack_filter.py -v
```

Expected: all 3 FAIL (today `propose_stack._handle_tool_invoked` raises `ValueError: unknown op id: 'filter'`).

- [ ] **Step 3: Implement `_handle_filter_spawn` in `propose_stack.py`**

Open `backend/app/tools/widgets/propose_stack.py`. Add a `_handle_filter_spawn` method on `ProposeStackTool`, immediately after `_handle_tool_invoked`. Use EXACTLY this body:

```python
    def _handle_filter_spawn(
        self, doc: SessionDocument, input: _Input, scope: Scope,
    ) -> _Output:
        """Build a LUT widget without touching the registry.

        Filter/LUT presets are managed client-side via LutRegistry — the
        backend just produces the widget shell (one lut node + an
        intensity slider). This is the only forced_ops member that's not
        a registry op. If filter ever moves into the registry, this
        carve-out can fold into the normal _handle_tool_invoked path.
        """
        widget_id = f"w_{uuid.uuid4().hex[:8]}"

        image_node_layer_ids: list[str] | None = None
        if scope.root.kind == "image_node":
            image_node_layer_ids = list(scope.root.layer_ids)
            layer_id_for_node = (
                image_node_layer_ids[0] if image_node_layer_ids else input.layer_id
            )
        else:
            layer_id_for_node = input.layer_id

        node_id = f"n_{uuid.uuid4().hex[:6]}"
        node = WidgetNode(
            id=node_id,
            type="lut",
            params={"intensity": 1.0},
            scope=scope,
            inputs=[],
            widget_id=widget_id,
            layer_id=layer_id_for_node,
            layer_ids=image_node_layer_ids,
        )

        binding = ControlBinding(
            param_key="intensity",
            label="Intensity",
            control_type="slider",
            control_schema=ControlSchema.model_validate({
                "control_type": "slider", "min": 0, "max": 1, "step": 0.01,
            }),
            value=1.0,
            default=1.0,
            target=NodeParamTarget(node_id=node_id, param_key="intensity"),
        )

        widget = Widget(
            id=widget_id,
            intent=input.intent,
            scope=scope,
            origin=WidgetOrigin(kind="tool_invoked", prompt=None, parent_widget_id=None),
            op_id="filter",
            composed=False,
            nodes=[node],
            bindings=[binding],
            preview=WidgetPreview(kind="none", auto_before_after=False),
            rejected_attempts=[],
            status="active",
            revision=1,
        )
        doc.add_widget(widget)
        return _Output(widgets=[widget.model_dump(mode="json", by_alias=True)])
```

- [ ] **Step 4: Route `forced_ops == ["filter"]` to the new method**

Find `_handle_tool_invoked` in `propose_stack.py`. At the very top of its body (after the `if not input.forced_ops:` guard), add:

```python
        # Filter/LUT is intentionally outside the registry (presets live
        # client-side via LutRegistry). Route the single-op `filter` case
        # to its own builder. Mixed lists are explicitly rejected.
        if "filter" in input.forced_ops:
            if input.forced_ops != ["filter"]:
                raise ValueError(
                    "forced_ops with 'filter' must contain only 'filter' — "
                    "the LUT path is single-op."
                )
            return self._handle_filter_spawn(doc, input, scope)
```

Place it AFTER `if not input.forced_ops: raise ValueError(...)` and BEFORE `reg = get_registry()`.

- [ ] **Step 5: Run the new tests + the full backend suite**

```bash
cd /Users/anton/Dev/Projects/editor/backend && .venv/bin/pytest tests/tools/widgets/test_propose_stack_filter.py -v
cd /Users/anton/Dev/Projects/editor/backend && .venv/bin/pytest tests/ -q
```

Expected: 3 new pass; total 634 passed (was 631 + 3 new). The existing `propose_widget` tests still pass because that file still exists (deleted in Task 4).

- [ ] **Step 6: Commit**

```bash
cd /Users/anton/Dev/Projects/editor
git add backend/app/tools/widgets/propose_stack.py backend/tests/tools/widgets/test_propose_stack_filter.py
git commit -m "feat(propose_stack): handle 'filter' op_id without touching the registry"
```

---

### Task 3: Migrate the one frontend caller to `propose_stack`

`src/tools/filters-tool.tsx` calls `backendTools.propose_widget(sid, { intent, scope, opId: 'filter', layerId, origin: 'tool_invoked' })`. Replace with the equivalent `propose_stack` call: `backendTools.propose_stack(sid, { intent, scope, forcedOps: ['filter'], layerId, origin: 'tool_invoked' })`.

**Files:**
- Modify: `src/tools/filters-tool.tsx`

- [ ] **Step 1: Edit the `applyFilter` callback**

Open `src/tools/filters-tool.tsx`. Find the `void backendTools.propose_widget(sid, { ... })` call (around line 95). Replace the surrounding block (current state shown for orientation):

```ts
    // Propose a filter widget — default scope to active selection, then to the
    // active ImageNode (so the backend knows which canvas the filter targets),
    // and finally fall back to Global. NOTE: filters/LUT remain on
    // propose_widget; the 'filter' op_id is not yet modeled in the SSoT
    // registry (it uses TOOL_DEFAULTS + LutRegistry instead).
    const state = useEditorStore.getState();
    const active = state.activeScope ?? { kind: 'global' as const };
    const node = state.activeImageNodeId ? state.imageNodes[state.activeImageNodeId] : null;
    const scope =
      active.kind !== 'global'
        ? active
        : node
          ? { kind: 'image_node' as const, imageNodeId: node.id, layerIds: [...node.layerIds] }
          : { kind: 'global' as const };
    void backendTools.propose_widget(sid, {
      intent: `Apply ${lut.title} filter`,
      scope,
      opId: 'filter',
      layerId: activeLayerId,
      origin: 'tool_invoked',
    });
```

Replace with:

```ts
    // Propose a filter widget via propose_stack with forced_ops=['filter'].
    // The 'filter' op_id is intentionally outside the SSoT registry —
    // LUT presets live client-side in LutRegistry. propose_stack carves
    // it out as a single-op forced spawn (see _handle_filter_spawn).
    const state = useEditorStore.getState();
    const active = state.activeScope ?? { kind: 'global' as const };
    const node = state.activeImageNodeId ? state.imageNodes[state.activeImageNodeId] : null;
    const scope =
      active.kind !== 'global'
        ? active
        : node
          ? { kind: 'image_node' as const, imageNodeId: node.id, layerIds: [...node.layerIds] }
          : { kind: 'global' as const };
    void backendTools.propose_stack(sid, {
      intent: `Apply ${lut.title} filter`,
      scope,
      forcedOps: ['filter'],
      layerId: activeLayerId,
      origin: 'tool_invoked',
    });
```

- [ ] **Step 2: Run `npm run check`**

```bash
cd /Users/anton/Dev/Projects/editor && npm run check
```

Expected: 0 errors. Lint warning count unchanged (5 preexisting). If TypeScript complains that `propose_stack` doesn't accept `forcedOps`, check the type definition in `src/lib/backend-tools.ts` and confirm it does — if the type lists `forced_ops` (snake_case), use that key in the call.

- [ ] **Step 3: Commit**

```bash
cd /Users/anton/Dev/Projects/editor
git add src/tools/filters-tool.tsx
git commit -m "refactor(filters): use propose_stack(forcedOps=['filter']) instead of propose_widget"
```

---

### Task 4: Delete `propose_widget.py`, `tool_defaults.py`, and the frontend wrapper

Both the backend tool and its supporting defaults dict are now dead. Same for the frontend `backendTools.propose_widget` wrapper. Plus a handful of test references that hardcode `propose_widget` need to drop it.

**Files:**
- Delete: `backend/app/tools/widgets/propose_widget.py`
- Delete: `backend/app/tools/tool_defaults.py`
- Modify: `backend/app/tools/widgets/__init__.py` — drop `ProposeWidgetTool` import + registration.
- Modify: `backend/tests/mcp/test_e2e_loop.py` — drop `propose_widget` from the tools-list assertion + the explanatory comment.
- Modify: `backend/tests/mcp/test_server.py` — drop the `propose_widget` assertion if present.
- Modify: `src/lib/backend-tools.ts` — drop the `propose_widget` wrapper.
- Modify: `src/components/widget/CompoundWidgetBody.test.tsx` — drop the `propose_widget` mock (if present in the `vi.mock` block).

- [ ] **Step 1: Confirm no remaining real callers**

```bash
cd /Users/anton/Dev/Projects/editor
grep -rnE "propose_widget|TOOL_DEFAULTS" backend/app/ src/ --include='*.py' --include='*.ts' --include='*.tsx' | grep -v "test_propose_stack_filter\|# .*propose_widget\|// .*propose_widget"
```

Expected hits: only the imports/registrations in the files this task deletes/modifies. If a real new caller is found that wasn't in scope, STOP and report.

- [ ] **Step 2: Delete the backend files**

```bash
cd /Users/anton/Dev/Projects/editor
git rm backend/app/tools/widgets/propose_widget.py backend/app/tools/tool_defaults.py
```

- [ ] **Step 3: Update `backend/app/tools/widgets/__init__.py`**

Open the file. Remove the `from .propose_widget import ProposeWidgetTool` import and any line that registers `ProposeWidgetTool` (e.g. `register(ProposeWidgetTool())`). Confirm the rest of the file still imports cleanly.

- [ ] **Step 4: Update `backend/tests/mcp/test_e2e_loop.py`**

Find:
```python
            assert {"propose_stack", "propose_widget", "refine_widget", "repeat_widget", "delete_widget"}.issubset(names)
```

Replace with:
```python
            assert {"propose_stack", "refine_widget", "repeat_widget", "delete_widget"}.issubset(names)
```

Find the comment `# 5. propose_stack via MCP (migrated from propose_widget for LLM path).` — leave it as historical context, OR shorten to `# 5. propose_stack via MCP.` if it reads cleaner.

- [ ] **Step 5: Update `backend/tests/mcp/test_server.py`**

Find:
```python
        assert "propose_widget" in names
```

Delete that line.

- [ ] **Step 6: Update `src/lib/backend-tools.ts`**

Find the `propose_widget(sessionId, args)` wrapper (around lines 96-105). Delete the entire method.

- [ ] **Step 7: Update `src/components/widget/CompoundWidgetBody.test.tsx`**

Find the `propose_widget: vi.fn().mockResolvedValue({ ok: true, output: { widget: {} } })` line inside a `vi.mock('@/lib/backend-tools', ...)` block. Delete that property from the mock object.

- [ ] **Step 8: Run both suites**

```bash
cd /Users/anton/Dev/Projects/editor/backend && .venv/bin/pytest tests/ -q
cd /Users/anton/Dev/Projects/editor && npm run check
```

Expected: backend all green (around 630 passed — `test_propose_widget.py` and `test_propose_stack_integration.py` cases that targeted the deleted tool may need to go, see below); frontend 785+ green.

If `tests/tools/widgets/test_propose_widget.py` exists, delete it (`git rm`). Same for any `tests/tools/widgets/test_propose_widget*.py` files — they exercise behavior that no longer exists. Drop and re-run.

- [ ] **Step 9: Commit**

```bash
cd /Users/anton/Dev/Projects/editor
git add backend/app/tools/widgets/__init__.py \
        backend/tests/mcp/test_e2e_loop.py \
        backend/tests/mcp/test_server.py \
        src/lib/backend-tools.ts \
        src/components/widget/CompoundWidgetBody.test.tsx
# git rm already staged the deletions above
git commit -m "refactor(widgets): delete propose_widget + tool_defaults — propose_stack owns filter"
```

---

### Task 5: Audit doc flip H23 + H24

`docs/audit-2026-06-15.md` carries both H23 and H24. Mark both `[x]` and bump the progress snapshot.

**Files:**
- Modify: `docs/audit-2026-06-15.md`

- [ ] **Step 1: Edit H23**

Find:

```markdown
- [ ] **H23** — Two registries with overlapping op metadata: `backend/app/registry/loader.py` ↔ `backend/app/engine/registry.py` (`ENGINE_OPS`) ↔ `backend/app/tools/tool_defaults.py`. `TOOL_DEFAULTS` is acknowledged debt — only LUT/filter still hand-written.
```

Replace with:

```markdown
- [x] **H23** — Two registries with overlapping op metadata: `backend/app/registry/loader.py` ↔ `backend/app/engine/registry.py` (`ENGINE_OPS`) ↔ `backend/app/tools/tool_defaults.py`. `TOOL_DEFAULTS` is acknowledged debt — only LUT/filter still hand-written. **Fix landed:** `tool_defaults.py` deleted; the lone `filter` entry moved inline into `propose_stack._handle_filter_spawn`. The remaining overlap (`engine/registry.py:ENGINE_OPS` vs. `registry/loader.py`) is a separate cluster — left open for now.
```

(Note: H23 has two pieces. The `TOOL_DEFAULTS` piece is closed; the `ENGINE_OPS` overlap is a separate body of work, so the entry stays as `[x]` for the `TOOL_DEFAULTS` half but explicitly defers the other half. Adjust wording per your preference.)

- [ ] **Step 2: Edit H24**

Find:

```markdown
- [ ] **H24** — `backend/app/tools/widgets/propose_widget.py` is now a deprecated fast-path that only handles `tool_invoked` for LUT/filter, but coexists with `propose_stack._handle_tool_invoked()` doing nearly the same work. Two entry points to widget spawning.
```

Replace with:

```markdown
- [x] **H24** — `backend/app/tools/widgets/propose_widget.py` is now a deprecated fast-path that only handles `tool_invoked` for LUT/filter, but coexists with `propose_stack._handle_tool_invoked()` doing nearly the same work. Two entry points to widget spawning. **Fix landed:** `propose_widget.py` deleted; the LUT/filter spawn moved to `propose_stack._handle_filter_spawn`; the one frontend caller (`src/tools/filters-tool.tsx`) migrated to `propose_stack(forcedOps: ['filter'])`. Single entry point now.
```

- [ ] **Step 3: Bump the progress snapshot**

Find:

```markdown
**Progress snapshot:** 14 Critical → 11 resolved (1 partial, 2 open). 26 High → 10 resolved (16 open). Medium & Low buckets largely open; a handful of Low items landed in the mechanical wave.
```

Replace with:

```markdown
**Progress snapshot:** 14 Critical → 11 resolved (1 partial, 2 open). 26 High → 12 resolved (14 open). Medium & Low buckets largely open; a handful of Low items landed in the mechanical wave.
```

- [ ] **Step 4: Commit**

```bash
cd /Users/anton/Dev/Projects/editor
git add docs/audit-2026-06-15.md
git commit -m "docs(audit): mark H23 (tool_defaults) + H24 (propose_widget) resolved"
```

---

## Self-Review

**Spec coverage:**

| Audit finding | Addressed in |
|---|---|
| H24 — two entry points to widget spawning | Task 1 (move exception) + Task 2 (filter handling in propose_stack) + Task 3 (FE migration) + Task 4 (delete) |
| H23 — `TOOL_DEFAULTS` debt (the LUT/filter half) | Task 2 (inlines the defaults) + Task 4 (deletes tool_defaults.py) |
| H23 — `ENGINE_OPS` vs `registry/loader.py` overlap | NOT addressed; deferred to a future cluster. Audit doc notes the deferral. |

The `ENGINE_OPS` overlap is a deeper issue (the engine registry is a transformed projection of the source registry, not a true second registry). Conflating it with H24 would balloon scope. Flagged as a deferral.

**Behavioural preservation:**
- The widget produced by `propose_stack(forcedOps=['filter'])` is identical to what `propose_widget` produced: same `op_id`, same node type/params, same binding shape, same scope propagation, same origin. Verified by Task 2's 3-test suite.
- The frontend's `LutRegistry.register(adjustmentId, ...)` flow is untouched — it's purely client-side.

**Placeholder scan:** none.

**Type consistency:** `_MissingContext` defined in Task 1 is the same class referenced by Task 3's deletion. `_handle_filter_spawn` defined in Task 2 is the method routed to from `_handle_tool_invoked`. `forcedOps` is the existing camelCase wire shape (Pydantic alias of `forced_ops`).

**Risk analysis:**
- The MCP tool registration change (drop `ProposeWidgetTool`) means MCP clients that still call `propose_widget` get a "tool not found" error. Real-world callers: there's one (`src/tools/filters-tool.tsx`) and Task 3 migrates it. Outside-repo clients (LLMs) — none, because `propose_widget` was already constrained to `origin="tool_invoked"` which only the frontend uses.
- The `_handle_filter_spawn` method intentionally rejects `forced_ops=["filter", "basic"]` mixed lists. This is a behaviour change vs. nothing today (the registry-side `_handle_tool_invoked` would have raised on `'filter'` anyway). No real caller does this.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-15-propose-widget-deletion.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
