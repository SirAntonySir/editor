# Smart Widget Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the planner emit one widget per conceptual group of ops (with a meaningful per-widget name) instead of one widget per op, so "vintage film" produces ~4 named widgets like "Lifted blacks" / "Warm fade" / "Film grain" instead of 5 unnamed slider-only widgets.

**Architecture:** Each op JSON declares a `category` field. Planner LLM returns a nested `plan: [{widget_name, category, ops: [...]}]` shape — each entry becomes one Widget with N nodes (one per op). The Widget schema gains `display_name` and `category` fields. Inspector renders multi-op widgets as section-per-op via the existing `RegistryDrivenSectionBody` wrapper. A dedup pass before Phase 2 protects against same-op-id duplicates from the LLM.

**Tech Stack:** Python 3.12 + Pydantic v2 (backend), TypeScript + Zod (frontend), Anthropic SDK (planner), Vitest + Pytest.

**Reference:** `docs/superpowers/specs/2026-06-08-smart-widget-composition-design.md`

---

## File Structure

### Modified
- `backend/app/registry/schema.py` — add `category: str | None` to `RegistryOp`
- `shared/registry/schema.ts` — add `category` to `RegistryOpSchema`
- `backend/app/schemas/widget.py` — add `display_name`, `category` to `Widget`
- `src/types/widget.ts` — mirror Widget fields
- `shared/registry/ops/*.json` (12 files) — add `category` field per op
- `backend/app/tools/widgets/propose_stack.py` — `_build_widget_multi`, `_dedup_plan`, new `_handle_llm_path`
- `backend/app/services/anthropic_client.py` — `plan_widget_stack` returns nested shape; old-shape fallback in caller
- `src/components/inspector/adjustments/RegistryDrivenSectionBody.tsx` — section-per-op for multi-op widgets
- `src/components/widget/WidgetShellHeader.tsx` — display_name fallback chain
- `src/components/widget/WhyPopover.tsx` — per-op rationales for multi-op widgets
- `src/index.css` — add `.registry-panel-section-title` utility class

### Tests (created or extended)
- `backend/tests/registry/test_schema.py` — extend for category field
- `backend/tests/registry/test_propose_stack.py` — `_build_widget_multi`, `_dedup_plan` cases
- `backend/tests/services/test_anthropic_planner.py` — nested shape; old-shape transform
- `backend/tests/tools/test_propose_stack_integration.py` — vintage produces multi-op widget
- `src/lib/registry/__tests__/schema.test.ts` — extend for category field
- `src/components/inspector/__tests__/RegistryDrivenSectionBody.test.tsx` — multi-op rendering
- `src/components/widget/WidgetShellHeader.test.tsx` — fallback chain
- `src/components/widget/WhyPopover.test.tsx` — per-op rationales

---

## Task 1: Schema additions (Pydantic + Zod + TS types)

**Files:**
- Modify: `backend/app/registry/schema.py`
- Modify: `shared/registry/schema.ts`
- Modify: `backend/app/schemas/widget.py`
- Modify: `src/types/widget.ts`
- Test: `backend/tests/registry/test_schema.py`, `src/lib/registry/__tests__/schema.test.ts`

- [ ] **Step 1: Write failing backend schema test**

Add to `backend/tests/registry/test_schema.py`:

```python
def test_registry_op_accepts_category():
    op = RegistryOp.model_validate({
        "id": "x", "display_name": "X",
        "category": "color",
        "llm": {"description": "d", "typical_use": "u", "semantic_tags": []},
        "params": {"a": {"type": "scalar", "range": [0, 1], "default": 0}},
        "bindings": [{"param_key": "a", "control_type": "slider", "label": "A"}],
        "engine": {"shader": "x", "render_order": 0, "node_type": "x"},
    })
    assert op.category == "color"


def test_registry_op_category_optional():
    op = RegistryOp.model_validate({
        "id": "x", "display_name": "X",
        "llm": {"description": "d", "typical_use": "u", "semantic_tags": []},
        "params": {"a": {"type": "scalar", "range": [0, 1], "default": 0}},
        "bindings": [{"param_key": "a", "control_type": "slider", "label": "A"}],
        "engine": {"shader": "x", "render_order": 0, "node_type": "x"},
    })
    assert op.category is None
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/registry/test_schema.py::test_registry_op_accepts_category -v`
Expected: FAIL — `category` is an unknown field (extra="forbid" rejects).

- [ ] **Step 3: Add `category` to RegistryOp**

In `backend/app/registry/schema.py`, in the `RegistryOp` class, add a field after `display_name`:

```python
class RegistryOp(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    display_name: str
    category: str | None = None    # NEW
    llm: OpLlmMetadata
    params: dict[str, OpParamSchema]
    bindings: list[OpBinding]
    engine: OpEngineConfig

    @model_validator(mode="after")
    def _bindings_reference_params(self) -> RegistryOp:
        for b in self.bindings:
            if b.param_key not in self.params:
                raise ValueError(f"binding param_key {b.param_key!r} not in params")
        return self
```

- [ ] **Step 4: Backend test passes**

Run: `cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/registry/test_schema.py -v`
Expected: all PASS (2 new + existing).

- [ ] **Step 5: Write failing frontend schema test**

Add to `src/lib/registry/__tests__/schema.test.ts`:

```typescript
describe('RegistryOpSchema category', () => {
  it('accepts a category', () => {
    const parsed = RegistryOpSchema.parse({
      id: 'x', display_name: 'X', category: 'color',
      llm: { description: 'd', typical_use: 'u', semantic_tags: [] },
      params: { a: { type: 'scalar', range: [0, 1], default: 0 } },
      bindings: [{ param_key: 'a', control_type: 'slider', label: 'A' }],
      engine: { shader: 'x', render_order: 0, node_type: 'x' },
    });
    expect(parsed.category).toBe('color');
  });

  it('treats category as optional', () => {
    const parsed = RegistryOpSchema.parse({
      id: 'x', display_name: 'X',
      llm: { description: 'd', typical_use: 'u', semantic_tags: [] },
      params: { a: { type: 'scalar', range: [0, 1], default: 0 } },
      bindings: [{ param_key: 'a', control_type: 'slider', label: 'A' }],
      engine: { shader: 'x', render_order: 0, node_type: 'x' },
    });
    expect(parsed.category).toBeUndefined();
  });
});
```

- [ ] **Step 6: Run test to confirm failure**

Run: `npx vitest run src/lib/registry/__tests__/schema.test.ts`
Expected: FAIL — `.strict()` rejects unknown `category` key.

- [ ] **Step 7: Add category to Zod**

In `shared/registry/schema.ts`, in `RegistryOpSchema`:

```typescript
export const RegistryOpSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  category: z.string().optional(),     // NEW
  llm: OpLlmMetadataSchema,
  params: z.record(z.string(), OpParamSchema),
  bindings: z.array(OpBindingSchema),
  engine: OpEngineConfigSchema,
}).strict().superRefine((op, ctx) => {
  for (const b of op.bindings) {
    if (!(b.param_key in op.params)) {
      ctx.addIssue({
        code: 'custom',
        message: `binding param_key "${b.param_key}" not in params`,
      });
    }
  }
});
```

- [ ] **Step 8: Run frontend test**

Run: `npx vitest run src/lib/registry/__tests__/schema.test.ts`
Expected: PASS.

- [ ] **Step 9: Add Widget schema fields (backend)**

In `backend/app/schemas/widget.py`, locate the `Widget` class. Add the two fields (after `revision: int` or any other trailing field; placement is cosmetic):

```python
class Widget(BaseModel):
    # ... existing fields unchanged ...
    display_name: str | None = None    # NEW — per-widget label
    category: str | None = None         # NEW — for grouping
```

- [ ] **Step 10: Add Widget type fields (frontend)**

In `src/types/widget.ts`, locate the `Widget` interface (it's the same file that owns `ControlBinding`, etc.). Add:

```typescript
export interface Widget {
  // ... existing fields unchanged ...
  display_name?: string | null;
  category?: string | null;
}
```

- [ ] **Step 11: Run full test sweep — no regressions**

Run:
```bash
cd /Users/anton/Dev/Projects/editor/backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/ 2>&1 | tail -5
cd /Users/anton/Dev/Projects/editor && npx vitest run 2>&1 | tail -5
cd /Users/anton/Dev/Projects/editor && npx tsc --noEmit -p tsconfig.json 2>&1 | head -10
```
Expected: all green; tsc clean.

- [ ] **Step 12: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add backend/app/registry/schema.py backend/app/schemas/widget.py backend/tests/registry/test_schema.py shared/registry/schema.ts src/types/widget.ts src/lib/registry/__tests__/schema.test.ts
git commit -m "feat(schemas): add category to RegistryOp; display_name + category to Widget"
```

---

## Task 2: Add `category` to 12 op JSONs

**Files:**
- Modify: `shared/registry/ops/{light,levels,curves,color,kelvin,hsl,splitTone,clarity,sharpen,blur,grain,vignette}.json`

Each file gets one new top-level field. The mapping is fixed by the spec.

- [ ] **Step 1: Add category to `tone` ops**

For each of these files, add `"category": "tone"` immediately after the `"display_name"` field:

- `shared/registry/ops/light.json`
- `shared/registry/ops/levels.json`
- `shared/registry/ops/curves.json`

Example edit (`light.json`):

```jsonc
{
  "id": "light",
  "display_name": "Light",
  "category": "tone",     // NEW
  "llm": { ... },
  ...
}
```

- [ ] **Step 2: Add category to `color` ops**

For each, add `"category": "color"` after `"display_name"`:

- `shared/registry/ops/color.json`
- `shared/registry/ops/kelvin.json`
- `shared/registry/ops/hsl.json`
- `shared/registry/ops/splitTone.json`

- [ ] **Step 3: Add category to `detail` ops**

For each, add `"category": "detail"`:

- `shared/registry/ops/clarity.json`
- `shared/registry/ops/sharpen.json`
- `shared/registry/ops/blur.json`

- [ ] **Step 4: Add category to `texture` and `effect` ops**

- `shared/registry/ops/grain.json` → `"category": "texture"`
- `shared/registry/ops/vignette.json` → `"category": "effect"`

- [ ] **Step 5: Run loader tests to confirm all JSONs validate**

Run: `cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/registry/test_loader.py -v`
Expected: PASS (the loader smoke-tests every op file).

Also:
```bash
cd /Users/anton/Dev/Projects/editor && npx vitest run src/lib/registry/__tests__/op-jsons.smoke.test.ts
```
Expected: PASS.

- [ ] **Step 6: Add an assertion that every op has a category**

Add to `backend/tests/registry/test_loader.py`:

```python
def test_all_ops_have_category():
    reg = reload_registry()
    expected_categories = {"tone", "color", "detail", "texture", "effect"}
    for op_id, op in reg.ops.items():
        assert op.category is not None, f"op {op_id} missing category"
        assert op.category in expected_categories, (
            f"op {op_id} category {op.category!r} not in {expected_categories}"
        )
```

Run: same command as Step 5. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add shared/registry/ops/ backend/tests/registry/test_loader.py
git commit -m "feat(registry): categorize 12 ops (tone/color/detail/texture/effect)"
```

---

## Task 3: `_build_widget_multi` (multi-op widget assembly)

**Files:**
- Modify: `backend/app/tools/widgets/propose_stack.py`
- Test: `backend/tests/registry/test_propose_stack.py`

- [ ] **Step 1: Write failing test for multi-op widget**

Add to `backend/tests/registry/test_propose_stack.py`:

```python
import pytest
from app.schemas.widget import Scope, WidgetOrigin
from app.tools.widgets.propose_stack import _build_widget_multi


def test_build_widget_multi_two_ops():
    scope = Scope.model_validate({"kind": "global"})
    origin = WidgetOrigin(kind="mcp_user_prompt", prompt="test", parent_widget_id=None)
    widget = _build_widget_multi(
        widget_name="Warm fade",
        category="color",
        ops=[
            ("color",     {"saturation": -15}),
            ("splitTone", {"shadow_hue": 200, "shadow_sat": 30}),
        ],
        intent="vintage",
        scope=scope, origin=origin,
        layer_id="legacy",
        image_node_layer_ids=None,
    )
    # One widget with two nodes
    assert widget.display_name == "Warm fade"
    assert widget.category == "color"
    assert len(widget.nodes) == 2
    # Nodes carry their op-specific types
    node_types = {n.type for n in widget.nodes}
    assert node_types == {"basic", "splitTone"}    # `color` op's engine.node_type is "basic"
    # Bindings concatenated, each pointing at its own node
    assert len(widget.bindings) == len(widget.nodes[0].params) + len(widget.nodes[1].params)
    # widget.op_id is the FIRST op's id
    assert widget.op_id == "color"


def test_build_widget_multi_single_op_equivalence():
    """The single-op wrapper produces a widget identical to today's _build_widget."""
    scope = Scope.model_validate({"kind": "global"})
    origin = WidgetOrigin(kind="tool_invoked", prompt=None, parent_widget_id=None)
    widget = _build_widget_multi(
        widget_name=None, category=None,
        ops=[("grain", {"amount": 18})],
        intent="grain", scope=scope, origin=origin,
        layer_id="legacy", image_node_layer_ids=None,
    )
    assert widget.display_name is None
    assert widget.category is None
    assert len(widget.nodes) == 1
    assert widget.nodes[0].type == "grain"
    assert widget.op_id == "grain"


def test_build_widget_multi_bindings_target_correct_nodes():
    """A binding from the 2nd op must target the 2nd node, not the 1st."""
    scope = Scope.model_validate({"kind": "global"})
    origin = WidgetOrigin(kind="mcp_user_prompt", prompt="t", parent_widget_id=None)
    widget = _build_widget_multi(
        widget_name="Mixed", category=None,
        ops=[
            ("color",     {"saturation": 0}),
            ("splitTone", {}),
        ],
        intent="t", scope=scope, origin=origin,
        layer_id="legacy", image_node_layer_ids=None,
    )
    color_node_id = widget.nodes[0].id
    split_node_id = widget.nodes[1].id
    for b in widget.bindings:
        # color params target node 0; splitTone params target node 1
        if b.param_key in ("saturation", "vibrance", "hue"):
            assert b.target.node_id == color_node_id, f"{b.param_key} should target color node"
        else:
            assert b.target.node_id == split_node_id, f"{b.param_key} should target splitTone node"


def test_build_widget_multi_preserves_binding_groups():
    """Bindings keep their original `group` field (no prefixing)."""
    scope = Scope.model_validate({"kind": "global"})
    origin = WidgetOrigin(kind="mcp_user_prompt", prompt="t", parent_widget_id=None)
    widget = _build_widget_multi(
        widget_name="Mixed", category=None,
        ops=[
            ("color",     {}),
            ("splitTone", {}),
        ],
        intent="t", scope=scope, origin=origin,
        layer_id="legacy", image_node_layer_ids=None,
    )
    # splitTone's shadow_hue binding has group "Shadows" in the registry
    shadow_binding = next(b for b in widget.bindings if b.param_key == "shadow_hue")
    # NOT prefixed — keeps registry value
    assert "›" not in (shadow_binding.target.param_key + (shadow_binding.target.node_id or ""))
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/registry/test_propose_stack.py::test_build_widget_multi_two_ops -v`
Expected: FAIL — `_build_widget_multi` not defined.

- [ ] **Step 3: Implement `_build_widget_multi`**

In `backend/app/tools/widgets/propose_stack.py`, add the new function above `_build_widget`. Then refactor `_build_widget` into a thin wrapper:

```python
def _build_widget_multi(
    *, widget_name: str | None,
    category: str | None,
    ops: list[tuple[str, dict[str, Any]]],
    intent: str,
    scope: Scope,
    origin: WidgetOrigin,
    layer_id: str,
    image_node_layer_ids: list[str] | None,
) -> Widget:
    """Build a single Widget composed of one or more ops. One WidgetNode per op."""
    if not ops:
        raise ValueError("_build_widget_multi requires at least one op")

    reg = get_registry()
    widget_id = f"w_{uuid.uuid4().hex[:8]}"

    nodes: list[WidgetNode] = []
    bindings: list[ControlBinding] = []
    for op_id, params in ops:
        if op_id not in reg.ops:
            raise ValueError(f"unknown op id: {op_id!r}")
        op = reg.ops[op_id]
        node_id = f"n_{uuid.uuid4().hex[:6]}"

        # Merge defaults into params for this op.
        full_params = {
            key: params.get(key, p.default) for key, p in op.params.items()
        }

        nodes.append(WidgetNode(
            id=node_id,
            type=op.engine.node_type,
            params=full_params,
            scope=scope,
            inputs=[],
            widget_id=widget_id,
            layer_id=(image_node_layer_ids[0] if image_node_layer_ids else layer_id),
            layer_ids=image_node_layer_ids,
        ))

        for b in op.bindings:
            bindings.append(ControlBinding(
                param_key=b.param_key,
                label=b.label,
                control_type=b.control_type,
                control_schema=_control_schema_for(op_id, b.param_key),
                value=full_params[b.param_key],
                default=op.params[b.param_key].default,
                target=NodeParamTarget(node_id=node_id, param_key=b.param_key),
            ))

    return Widget(
        id=widget_id,
        intent=intent,
        scope=scope,
        origin=origin,
        op_id=ops[0][0],          # first op's id for back-compat
        composed=False,
        nodes=nodes,
        bindings=bindings,
        preview=WidgetPreview(kind="none", auto_before_after=False),
        rejected_attempts=[],
        status="active",
        revision=1,
        display_name=widget_name,
        category=category,
    )


def _build_widget(
    *, op_id: str, params: dict, intent: str, scope: Scope,
    origin: WidgetOrigin, layer_id: str, image_node_layer_ids: list[str] | None,
    display_name: str | None = None, category: str | None = None,
) -> Widget:
    """Thin wrapper: build a single-op widget."""
    return _build_widget_multi(
        widget_name=display_name,
        category=category,
        ops=[(op_id, params)],
        intent=intent,
        scope=scope,
        origin=origin,
        layer_id=layer_id,
        image_node_layer_ids=image_node_layer_ids,
    )
```

(Note: the existing `_build_widget` may have direct field references rather than going through the wrapper. Just replace the function body with the call above — keep the signature.)

- [ ] **Step 4: Run tests**

Run: `cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/registry/test_propose_stack.py -v`
Expected: 4 new tests PASS + existing toolrail tests still PASS.

- [ ] **Step 5: Confirm no integration regression**

Run: `cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/tools/test_propose_stack_integration.py -v`
Expected: existing integration tests PASS (they exercise the single-op path through the wrapper).

- [ ] **Step 6: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add backend/app/tools/widgets/propose_stack.py backend/tests/registry/test_propose_stack.py
git commit -m "feat(propose_stack): _build_widget_multi for multi-op widgets"
```

---

## Task 4: `_dedup_plan` helper

**Files:**
- Modify: `backend/app/tools/widgets/propose_stack.py`
- Test: `backend/tests/registry/test_propose_stack.py`

- [ ] **Step 1: Write failing tests**

Add to `backend/tests/registry/test_propose_stack.py`:

```python
from app.tools.widgets.propose_stack import _dedup_plan


def test_dedup_within_widget_collapses_repeats():
    raw_plan = [
        {
            "widget_name": "HSL",
            "category": "color",
            "ops": [
                {"op_id": "hsl", "rationale": "warm reds", "starting_params": {"red_hue": 8}},
                {"op_id": "hsl", "rationale": "cooler greens", "starting_params": {"green_hue": -8}},
            ],
        },
    ]
    deduped = _dedup_plan(raw_plan)
    assert len(deduped) == 1
    ops = deduped[0]["ops"]
    assert len(ops) == 1
    assert ops[0]["starting_params"] == {"red_hue": 8, "green_hue": -8}
    assert "warm reds" in ops[0]["rationale"] and "cooler greens" in ops[0]["rationale"]


def test_dedup_cross_widget_merges_same_signature():
    raw_plan = [
        {
            "widget_name": "Lifted",
            "category": "tone",
            "ops": [{"op_id": "levels", "rationale": "lift", "starting_params": {"inBlack": 10}}],
        },
        {
            "widget_name": "Crushed",
            "category": "tone",
            "ops": [{"op_id": "levels", "rationale": "crush", "starting_params": {"inWhite": 240}}],
        },
    ]
    deduped = _dedup_plan(raw_plan)
    assert len(deduped) == 1
    # First widget wins on widget_name; params merge last-write-wins
    assert deduped[0]["widget_name"] == "Lifted"
    assert deduped[0]["ops"][0]["starting_params"] == {"inBlack": 10, "inWhite": 240}
    assert "lift" in deduped[0]["ops"][0]["rationale"]
    assert "crush" in deduped[0]["ops"][0]["rationale"]


def test_dedup_different_signatures_stay_separate():
    raw_plan = [
        {"widget_name": "A", "category": "tone",
         "ops": [{"op_id": "levels", "rationale": "x", "starting_params": {}}]},
        {"widget_name": "B", "category": "color",
         "ops": [{"op_id": "color", "rationale": "y", "starting_params": {}}]},
    ]
    deduped = _dedup_plan(raw_plan)
    assert len(deduped) == 2
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/registry/test_propose_stack.py::test_dedup_within_widget_collapses_repeats -v`
Expected: FAIL — `_dedup_plan` not defined.

- [ ] **Step 3: Implement `_dedup_plan`**

Add to `backend/app/tools/widgets/propose_stack.py` near the other helpers:

```python
def _dedup_plan(raw_plan: list[dict]) -> list[dict]:
    """Collapse same-op-id repeats.

    Within a widget: if `ops` has the same op_id twice, merge into one
    (params merged last-write-wins, rationales concatenated).

    Cross-widget: if two entries have the same sorted op_id signature,
    merge into one (first widget_name/category wins, per-op params merged).
    """
    # --- Within-widget dedup ---
    for entry in raw_plan:
        seen: dict[str, dict] = {}
        merged_ops: list[dict] = []
        for op in entry.get("ops", []):
            op_id = op.get("op_id")
            if op_id is None:
                continue
            if op_id in seen:
                target = seen[op_id]
                target["starting_params"] = {
                    **(target.get("starting_params") or {}),
                    **(op.get("starting_params") or {}),
                }
                if op.get("rationale"):
                    sep = " · " if target.get("rationale") else ""
                    target["rationale"] = (target.get("rationale") or "") + sep + op["rationale"]
            else:
                # Defensive copy so cross-widget pass doesn't mutate shared dicts.
                seen[op_id] = dict(op)
                seen[op_id]["starting_params"] = dict(op.get("starting_params") or {})
                merged_ops.append(seen[op_id])
        entry["ops"] = merged_ops

    # --- Cross-widget dedup ---
    by_signature: dict[tuple[str, ...], dict] = {}
    deduped: list[dict] = []
    for entry in raw_plan:
        sig = tuple(sorted(op["op_id"] for op in entry.get("ops", [])))
        if not sig:
            continue
        if sig in by_signature:
            target_entry = by_signature[sig]
            # Build a map of target ops by id for quick merge.
            target_ops_by_id = {o["op_id"]: o for o in target_entry["ops"]}
            for op in entry["ops"]:
                target_op = target_ops_by_id[op["op_id"]]
                target_op["starting_params"] = {
                    **(target_op.get("starting_params") or {}),
                    **(op.get("starting_params") or {}),
                }
                if op.get("rationale"):
                    sep = " · " if target_op.get("rationale") else ""
                    target_op["rationale"] = (target_op.get("rationale") or "") + sep + op["rationale"]
        else:
            by_signature[sig] = entry
            deduped.append(entry)
    return deduped
```

- [ ] **Step 4: Tests pass**

Run: `cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/registry/test_propose_stack.py -v`
Expected: 3 new dedup tests + existing tests all PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add backend/app/tools/widgets/propose_stack.py backend/tests/registry/test_propose_stack.py
git commit -m "feat(propose_stack): _dedup_plan collapses same-op-id duplicates"
```

---

## Task 5: Planner returns nested shape

**Files:**
- Modify: `backend/app/services/anthropic_client.py`
- Test: `backend/tests/services/test_anthropic_planner.py`

- [ ] **Step 1: Write failing test for nested-shape response**

In `backend/tests/services/test_anthropic_planner.py`, add:

```python
def test_plan_widget_stack_nested_shape(monkeypatch):
    client = AnthropicClient(api_key="test", model="claude-opus-4-7")
    fake = MagicMock()
    fake.content = [MagicMock(text=(
        '{"plan": ['
        '  {"widget_name": "Lifted blacks", "category": "tone",'
        '   "ops": [{"op_id": "levels", "rationale": "raise inBlack", "starting_params": {"inBlack": 12}}]},'
        '  {"widget_name": "Warm fade", "category": "color",'
        '   "ops": ['
        '     {"op_id": "color",     "rationale": "desat -15", "starting_params": {"saturation": -15}},'
        '     {"op_id": "splitTone", "rationale": "teal/orange", "starting_params": null}'
        '   ]}'
        '], "overall_rationale": "vintage film"}'
    ))]
    monkeypatch.setattr(client._client.messages, "create",
                         MagicMock(return_value=fake))

    reg = reload_registry()
    result = client.plan_widget_stack(
        intent="vintage film",
        scope={"kind": "global"},
        image_context={"palette": "warm"},
        existing_widgets=[],
        registry=reg,
        session_id="s1",
    )
    plan = result["plan"]
    assert len(plan) == 2
    assert plan[0]["widget_name"] == "Lifted blacks"
    assert plan[0]["category"] == "tone"
    assert len(plan[1]["ops"]) == 2
    assert plan[1]["ops"][0]["op_id"] == "color"
```

- [ ] **Step 2: Run test to confirm it passes already if shape is opaque**

The existing implementation just `json.loads`s the LLM text — it doesn't validate shape. The test above may already PASS without any change because `plan_widget_stack` just returns the parsed JSON.

Run: `cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/services/test_anthropic_planner.py::test_plan_widget_stack_nested_shape -v`
Expected: likely PASS already.

If it PASSES, skip steps 3–4 (the implementation is already shape-agnostic) and go to Step 5 (prompt update).

If it FAILS, proceed with Step 3.

- [ ] **Step 3: (Conditional) Update return-shape parsing**

If the existing implementation does any shape validation on the response (e.g. enforces `op_id` at top level), remove those constraints. The function should return whatever JSON the LLM emits — shape transformation happens in `_handle_llm_path` (Task 6).

- [ ] **Step 4: (Conditional) Re-run test**

Run: same command as Step 2.
Expected: PASS.

- [ ] **Step 5: Update planner system prompt and example**

In `backend/app/services/anthropic_client.py`, locate `_PLANNER_SYSTEM_PROMPT`. Update it:

```python
_PLANNER_SYSTEM_PROMPT = """You are a photo-editing composition planner.

Given a user intent and image context, return a stack of 1–6 conceptually-grouped
photo-editing widgets. Each widget can carry 1–5 raw ops that belong together
conceptually. Each widget becomes ONE card on the user's canvas they can
independently refine.

Rules:
- Group conceptually-related ops into the same widget. Use the `category`
  field as a strong default: ops with the same category usually belong
  together unless you have a specific reason to split.
- Give each widget a short, descriptive `widget_name` (2–4 words) describing
  the EFFECT, not the op (e.g. "Lifted blacks", not "Levels op").
- Prefer raw ops over presets unless the intent matches a preset closely.
- You may unfold a preset's ops as starting points and modify them.
- Order widgets by intent priority (most defining effect first).
- Return strict JSON. Do not include markdown fences.

Example for "vintage film":
{
  "plan": [
    {
      "widget_name": "Lifted blacks", "category": "tone",
      "ops": [{"op_id": "levels", "rationale": "raise inBlack to 12 for film fade"}]
    },
    {
      "widget_name": "Warm fade", "category": "color",
      "ops": [
        {"op_id": "color",     "rationale": "drop saturation -15"},
        {"op_id": "splitTone", "rationale": "warm shadows, cool highlights"}
      ]
    },
    {"widget_name": "Film grain", "category": "texture",
     "ops": [{"op_id": "grain", "rationale": "fine 18% grain"}]}
  ],
  "overall_rationale": "vintage film: faded blacks + warm desaturated color + grain"
}"""
```

- [ ] **Step 6: Update the user-message instructions to ask for the nested shape**

In `plan_widget_stack`, change the second content block in `messages` to specify the new response shape:

```python
{
    "type": "text",
    "text": (
        f"USER INTENT: {intent}\n"
        f"SCOPE: {scope}\n"
        f"IMAGE CONTEXT: {image_context}\n"
        f"EXISTING WIDGETS (avoid duplicating): {existing_widgets}\n\n"
        "Return JSON in this exact shape:\n"
        '{\n'
        '  "plan": [\n'
        '    {\n'
        '      "widget_name": "<2-4 words describing the effect>",\n'
        '      "category": "<tone|color|detail|texture|effect>",\n'
        '      "ops": [\n'
        '        {"op_id": "<id from catalog>", "rationale": "<one line>", "starting_params": {<optional>}}\n'
        '      ]\n'
        '    }\n'
        '  ],\n'
        '  "overall_rationale": "<one sentence>"\n'
        '}'
    ),
},
```

- [ ] **Step 7: Augment the ops catalog with `category`**

In `plan_widget_stack`, the catalog dict-comp currently emits `{id, description, typical_use, semantic_tags, params, render_order}`. Add `category`:

```python
ops_catalog = [
    {
        "id": op.id,
        "category": op.category,         # NEW
        "description": op.llm.description,
        "typical_use": op.llm.typical_use,
        "semantic_tags": op.llm.semantic_tags,
        "params": list(op.params.keys()),
        "render_order": op.engine.render_order,
    }
    for op in registry.ops.values()
]
```

- [ ] **Step 8: Verify tests still pass**

Run: `cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/services/test_anthropic_planner.py -v`
Expected: PASS (both the old `test_plan_widget_stack_returns_op_plan` if shape-agnostic, AND the new nested test).

- [ ] **Step 9: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add backend/app/services/anthropic_client.py backend/tests/services/test_anthropic_planner.py
git commit -m "feat(planner): nested response shape with widget_name + category + ops[]"
```

---

## Task 6: Wire `_handle_llm_path` to nested shape + dedup + multi-op

**Files:**
- Modify: `backend/app/tools/widgets/propose_stack.py`
- Test: `backend/tests/registry/test_propose_stack.py`, `backend/tests/tools/test_propose_stack_integration.py`

- [ ] **Step 1: Write failing integration test**

Add to `backend/tests/tools/test_propose_stack_integration.py`:

```python
@pytest.mark.asyncio
async def test_vintage_produces_multi_op_widget(make_doc, monkeypatch):
    """The vintage prompt should produce a multi-op widget (color + splitTone)
    plus single-op widgets for the rest."""
    doc = make_doc(with_image_context=True)
    tool = ProposeStackTool()

    fake_plan = {
        "plan": [
            {"widget_name": "Lifted blacks", "category": "tone",
             "ops": [{"op_id": "levels", "rationale": "lift", "starting_params": {}}]},
            {"widget_name": "Warm fade", "category": "color",
             "ops": [
                 {"op_id": "color",     "rationale": "desat", "starting_params": {}},
                 {"op_id": "splitTone", "rationale": "teal/orange", "starting_params": {}},
             ]},
            {"widget_name": "Film grain", "category": "texture",
             "ops": [{"op_id": "grain", "rationale": "fine", "starting_params": {}}]},
        ],
        "overall_rationale": "vintage film",
    }

    def fake_resolve(*, op, **_):
        return {k: p.default for k, p in op.params.items()}

    from app.services import anthropic_client as ac
    monkeypatch.setattr(ac.AnthropicClient, "plan_widget_stack",
                        MagicMock(return_value=fake_plan))
    monkeypatch.setattr(ac.AnthropicClient, "resolve_widget_params",
                        MagicMock(side_effect=fake_resolve))
    monkeypatch.setattr("app.api.deps.get_anthropic_client",
                        lambda: ac.AnthropicClient(api_key="test", model="claude-opus-4-7"))

    out = await tool.handler(doc, _Input(
        intent="make it look like a vintage film",
        scope={"kind": "global"},
        origin="mcp_user_prompt",
    ))
    # 3 widgets
    assert len(out.widgets) == 3
    # Each has a display_name
    names = [w["display_name"] for w in out.widgets]
    assert "Lifted blacks" in names
    assert "Warm fade" in names
    assert "Film grain" in names
    # The "Warm fade" widget has 2 nodes (color + splitTone)
    warm_fade = next(w for w in out.widgets if w["display_name"] == "Warm fade")
    assert len(warm_fade["nodes"]) == 2
    node_types = {n["type"] for n in warm_fade["nodes"]}
    assert node_types == {"basic", "splitTone"}    # color → basic, splitTone → splitTone
    # Categories propagate
    assert warm_fade["category"] == "color"


@pytest.mark.asyncio
async def test_old_shape_plan_response_back_compat(make_doc, monkeypatch):
    """A planner returning the OLD flat shape still produces single-op widgets."""
    doc = make_doc(with_image_context=True)
    tool = ProposeStackTool()

    fake_plan = {
        "plan": [
            {"op_id": "levels", "rationale": "lift"},
            {"op_id": "grain",  "rationale": "fine"},
        ],
        "overall_rationale": "back-compat shape",
    }

    def fake_resolve(*, op, **_):
        return {k: p.default for k, p in op.params.items()}

    from app.services import anthropic_client as ac
    monkeypatch.setattr(ac.AnthropicClient, "plan_widget_stack",
                        MagicMock(return_value=fake_plan))
    monkeypatch.setattr(ac.AnthropicClient, "resolve_widget_params",
                        MagicMock(side_effect=fake_resolve))
    monkeypatch.setattr("app.api.deps.get_anthropic_client",
                        lambda: ac.AnthropicClient(api_key="test", model="claude-opus-4-7"))

    out = await tool.handler(doc, _Input(
        intent="t", scope={"kind": "global"}, origin="mcp_user_prompt",
    ))
    assert len(out.widgets) == 2
    # display_name is None when planner doesn't provide one
    assert all(w["display_name"] is None for w in out.widgets)
    assert all(len(w["nodes"]) == 1 for w in out.widgets)
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/tools/test_propose_stack_integration.py::test_vintage_produces_multi_op_widget -v`
Expected: FAIL — current `_handle_llm_path` produces one widget per op (not the multi-op shape).

- [ ] **Step 3: Refactor `_handle_llm_path`**

Replace the existing `_handle_llm_path` in `backend/app/tools/widgets/propose_stack.py` with the version below:

```python
def _normalize_plan_entries(raw_entries: list[dict]) -> list[dict]:
    """Transform OLD-shape entries ({op_id, rationale}) into NEW shape
    ({widget_name: None, category: None, ops: [{op_id, rationale, starting_params}]}).
    NEW-shape entries pass through unchanged.
    """
    normalized: list[dict] = []
    for entry in raw_entries:
        if "ops" in entry:
            # Already new shape.
            normalized.append(entry)
            continue
        # Old shape — wrap into single-op widget.
        normalized.append({
            "widget_name": None,
            "category": None,
            "ops": [{
                "op_id": entry.get("op_id"),
                "rationale": entry.get("rationale", ""),
                "starting_params": entry.get("starting_params"),
            }],
        })
    return normalized


async def _handle_llm_path(
    self, doc: SessionDocument, input: _Input, scope: Scope,
) -> _Output:
    import asyncio
    from app.api import deps
    from app.registry.loader import get_registry

    reg = get_registry()
    anthropic = deps.get_anthropic_client()
    image_context = doc.image_context.model_dump(mode="json")

    plan_result = await asyncio.to_thread(
        anthropic.plan_widget_stack,
        intent=input.intent,
        scope=input.scope,
        image_context=image_context,
        existing_widgets=[
            {"op_id": w.op_id or "unknown"} for w in doc.widgets.values()
        ],
        registry=reg,
        session_id=doc.session_id,
    )

    raw_plan = plan_result.get("plan") or []
    # Old-shape → new-shape transform (back-compat).
    plan_entries = _normalize_plan_entries(raw_plan)
    # Dedup within and across widgets.
    plan_entries = _dedup_plan(plan_entries)

    # Fallback if nothing remains: keyword preset.
    if not plan_entries:
        fallback_ops = self._fallback_plan(input.intent, reg)
        plan_entries = [{
            "widget_name": None, "category": None,
            "ops": [{"op_id": op["op_id"], "rationale": "",
                     "starting_params": op.get("starting_params")} for op in fallback_ops],
        }] if fallback_ops else []

    # Phase 2: resolve each (entry_index, op) in parallel.
    async def _resolve_one(entry_index: int, op_entry: dict) -> tuple[int, str, dict] | None:
        op_id = op_entry.get("op_id")
        if op_id not in reg.ops:
            return None
        op = reg.ops[op_id]
        try:
            params = await asyncio.to_thread(
                anthropic.resolve_widget_params,
                op=op, intent=input.intent,
                rationale=op_entry.get("rationale", ""),
                starting_params=op_entry.get("starting_params") or {},
                image_context=image_context, session_id=doc.session_id,
            )
        except Exception as exc:    # noqa: BLE001
            print(f"[propose_stack] resolve failed for {op_id}: {exc}")
            return None
        return (entry_index, op_id, params)

    flat_ops = [
        (i, op) for i, entry in enumerate(plan_entries) for op in entry["ops"]
    ]
    resolved_flat = [r for r in await asyncio.gather(
        *(_resolve_one(i, op) for i, op in flat_ops)
    ) if r is not None]

    # Group resolved params by entry_index, preserving op order within each entry.
    by_entry: dict[int, list[tuple[str, dict]]] = {}
    for entry_index, op_id, params in resolved_flat:
        by_entry.setdefault(entry_index, []).append((op_id, params))

    image_node_layer_ids = (
        list(scope.root.layer_ids) if scope.root.kind == "image_node" else None
    )
    origin = WidgetOrigin(
        kind=input.origin, prompt=input.prompt or input.intent,
        parent_widget_id=None,
    )

    widgets: list[Widget] = []
    for entry_index, entry in enumerate(plan_entries):
        ops_for_entry = by_entry.get(entry_index, [])
        if not ops_for_entry:
            continue   # all ops failed resolution — drop the widget
        widget = _build_widget_multi(
            widget_name=entry.get("widget_name"),
            category=entry.get("category"),
            ops=ops_for_entry,
            intent=input.intent,
            scope=scope,
            origin=origin,
            layer_id=input.layer_id,
            image_node_layer_ids=image_node_layer_ids,
        )
        doc.add_widget(widget)
        widgets.append(widget)

    return _Output(widgets=[w.model_dump(mode="json") for w in widgets])
```

(The class method `_fallback_plan` is unchanged. The function `_normalize_plan_entries` is added at module scope above the class.)

- [ ] **Step 4: Run tests**

Run: `cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/tools/test_propose_stack_integration.py tests/registry/test_propose_stack.py -v`
Expected: all PASS, including the two new integration tests.

- [ ] **Step 5: Run the entire backend suite to confirm no regressions**

Run: `cd backend && set -a && source .env && set +a && .venv/bin/python -m pytest tests/ 2>&1 | tail -5`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add backend/app/tools/widgets/propose_stack.py backend/tests/tools/test_propose_stack_integration.py
git commit -m "feat(propose_stack): _handle_llm_path uses nested plan + multi-op assembly"
```

---

## Task 7: Frontend section-per-op rendering

**Files:**
- Modify: `src/components/inspector/adjustments/RegistryDrivenSectionBody.tsx`
- Modify: `src/index.css` (add `.registry-panel-section-title` token class)
- Test: `src/components/inspector/__tests__/RegistryDrivenSectionBody.test.tsx` (create or extend)

- [ ] **Step 1: Read the current `RegistryDrivenSectionBody.tsx` to find the binding-walk logic**

Open `/Users/anton/Dev/Projects/editor/src/components/inspector/adjustments/RegistryDrivenSectionBody.tsx`. Identify:
- How it receives the widget (or just widget bindings + a registry op)
- The current branch that calls `RegistryDrivenPanel`
- The dispatch path that decides which op to look up

The implementation goal: when the widget has >1 node, render one `RegistryDrivenPanel` per node, each wrapped in a section header.

- [ ] **Step 2: Write failing test**

Create or extend `src/components/inspector/__tests__/RegistryDrivenSectionBody.test.tsx`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { RegistryDrivenSectionBody } from '../adjustments/RegistryDrivenSectionBody';
import type { Widget } from '../../../types/widget';

function makeWidget(overrides: Partial<Widget> = {}): Widget {
  return {
    id: 'w_test',
    intent: 'test',
    scope: { kind: 'global' },
    origin: { kind: 'mcp_user_prompt', prompt: 'test', parent_widget_id: null },
    op_id: 'color',
    composed: false,
    nodes: [],
    bindings: [],
    preview: { kind: 'none', auto_before_after: false },
    rejected_attempts: [],
    status: 'active',
    revision: 1,
    display_name: null,
    category: null,
    ...overrides,
  };
}

describe('RegistryDrivenSectionBody multi-op rendering', () => {
  it('renders one section header per op when widget has multiple nodes', () => {
    const widget = makeWidget({
      op_id: 'color',
      display_name: 'Warm fade',
      nodes: [
        { id: 'n_a', type: 'basic',     params: { saturation: 0 } },
        { id: 'n_b', type: 'splitTone', params: { shadow_hue: 0 } },
      ] as unknown as Widget['nodes'],
      bindings: [
        // color's bindings
        { param_key: 'saturation', label: 'Saturation', control_type: 'slider',
          target: { node_id: 'n_a', param_key: 'saturation' }, value: 0, default: 0,
          control_schema: { control_type: 'slider', min: -100, max: 100, step: 1 } },
        // splitTone's bindings
        { param_key: 'shadow_hue', label: 'Hue', control_type: 'hue_wheel',
          target: { node_id: 'n_b', param_key: 'shadow_hue' }, value: 0, default: 0,
          control_schema: { control_type: 'hue_wheel', min: 0, max: 360 } },
      ] as unknown as Widget['bindings'],
    });

    const { getByText } = render(
      <RegistryDrivenSectionBody widget={widget} disabled={false} />,
    );
    // Section headers come from op.display_name
    expect(getByText('Color')).toBeTruthy();
    expect(getByText('Split Tone')).toBeTruthy();
  });

  it('renders flat (no section header) for single-op widgets', () => {
    const widget = makeWidget({
      op_id: 'grain',
      nodes: [
        { id: 'n_a', type: 'grain', params: { amount: 0, size: 100, roughness: 50 } },
      ] as unknown as Widget['nodes'],
      bindings: [
        { param_key: 'amount', label: 'Amount', control_type: 'slider',
          target: { node_id: 'n_a', param_key: 'amount' }, value: 0, default: 0,
          control_schema: { control_type: 'slider', min: 0, max: 100, step: 1 } },
      ] as unknown as Widget['bindings'],
    });

    const { queryByText } = render(
      <RegistryDrivenSectionBody widget={widget} disabled={false} />,
    );
    // No section header because there's only one op.
    expect(queryByText('Grain')).toBeFalsy();
  });
});
```

(If the existing test file's prop signature differs from `{widget, disabled}`, match the actual signature — read the existing test for the right shape.)

- [ ] **Step 3: Run tests to confirm failure**

Run: `npx vitest run src/components/inspector/__tests__/RegistryDrivenSectionBody.test.tsx`
Expected: FAIL — multi-op widget doesn't render section headers.

- [ ] **Step 4: Add the section-header CSS class**

In `src/index.css`, add (near other inspector panel styles):

```css
.registry-panel-section-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text-secondary);
  margin: var(--space-3) 0 var(--space-1) 0;
  letter-spacing: 0.02em;
}
```

(Replace the token names with whatever the project actually exports in `src/index.css` — read it to confirm the right token names. Don't hardcode hex/px.)

- [ ] **Step 5: Update RegistryDrivenSectionBody**

Modify the component to walk nodes and render one panel per op. The shape below assumes the component receives `widget` as a prop and dispatches today via a single `op` lookup. Adapt to the actual file structure:

```typescript
// Pseudocode showing the structural change — adapt to the existing component:

import { loadRegistry } from '../../../lib/registry/loader';
import { RegistryDrivenPanel } from '../RegistryDrivenPanel';
import type { Widget } from '../../../types/widget';

interface OpSlice {
  op: ReturnType<typeof loadRegistry>['ops'][string];
  values: Record<string, unknown>;
  bindings: Widget['bindings'];
  nodeId: string;
}

function sliceWidgetByOp(widget: Widget): OpSlice[] {
  const reg = loadRegistry();
  return widget.nodes.map((node) => {
    // Walk registry to find the op whose engine.node_type matches node.type.
    // Use first match (one-to-one in practice).
    const op = Object.values(reg.ops).find(o => o.engine.node_type === node.type);
    if (!op) {
      // Fallback handled by caller — see §7 failure handling.
      return null;
    }
    const bindings = widget.bindings.filter(b => b.target?.node_id === node.id);
    const values: Record<string, unknown> = {};
    for (const b of bindings) {
      values[b.param_key] = b.value;
    }
    return { op, values, bindings, nodeId: node.id };
  }).filter((s): s is OpSlice => s !== null);
}

// In the component's render path:
//   if widget.nodes.length === 1: render <RegistryDrivenPanel op={slice.op} values={slice.values} ... />
//   else: render slices.map(s => <section>{s.op.display_name}</section><RegistryDrivenPanel ... />)
```

Implementation steps inside the component:

1. Call `sliceWidgetByOp(widget)`.
2. If exactly 1 slice (single-op): call `<RegistryDrivenPanel>` as today (no header).
3. If multiple slices (multi-op): render each in a wrapper `<section>` with a `<div className="registry-panel-section-title">{slice.op.display_name}</div>` header, then `<RegistryDrivenPanel op={slice.op} values={slice.values} onParamChange={onParamChange} disabled={disabled} />`.
4. If a slice's op lookup fails (no matching `engine.node_type`): render a flat fallback header (e.g. the raw `node.type` string) plus a small `<div>Unknown op</div>` — emit `console.warn` once per render.

Edit the component file. Keep the existing store-connected wrapper logic for params / onParamChange.

- [ ] **Step 6: Run frontend tests**

Run: `npx vitest run src/components/inspector/`
Expected: PASS.

- [ ] **Step 7: Run full vitest + tsc**

```bash
cd /Users/anton/Dev/Projects/editor && npx vitest run 2>&1 | tail -5
cd /Users/anton/Dev/Projects/editor && npx tsc --noEmit -p tsconfig.json 2>&1 | head -10
```
Expected: all green.

- [ ] **Step 8: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add src/components/inspector/adjustments/RegistryDrivenSectionBody.tsx src/index.css src/components/inspector/__tests__/RegistryDrivenSectionBody.test.tsx
git commit -m "feat(inspector): section-per-op rendering for multi-op widgets"
```

---

## Task 8: Widget header (display_name fallback) + Why? popover per-op rationales

**Files:**
- Modify: `src/components/widget/WidgetShellHeader.tsx`
- Modify: `src/components/widget/WhyPopover.tsx`
- Test: `src/components/widget/WidgetShellHeader.test.tsx`, `src/components/widget/WhyPopover.test.tsx`

- [ ] **Step 1: Write failing test for header fallback chain**

Add to `src/components/widget/WidgetShellHeader.test.tsx`:

```typescript
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { WidgetShellHeader } from '../WidgetShellHeader';
import type { Widget } from '../../../types/widget';

function makeWidget(overrides: Partial<Widget> = {}): Widget {
  return {
    id: 'w', intent: 'make it warmer',
    scope: { kind: 'global' },
    origin: { kind: 'mcp_user_prompt', prompt: 'make it warmer', parent_widget_id: null },
    op_id: 'kelvin',
    composed: false, nodes: [], bindings: [],
    preview: { kind: 'none', auto_before_after: false },
    rejected_attempts: [], status: 'active', revision: 1,
    display_name: null, category: null,
    ...overrides,
  };
}

describe('WidgetShellHeader title resolution', () => {
  it('uses display_name when present', () => {
    const w = makeWidget({ display_name: 'Warm shift' });
    const { getByText } = render(<WidgetShellHeader widget={w} /* other required props */ />);
    expect(getByText('Warm shift')).toBeTruthy();
  });

  it('falls back to registry op display_name when display_name is null and single-op', () => {
    const w = makeWidget({ display_name: null, op_id: 'kelvin' });
    const { getByText } = render(<WidgetShellHeader widget={w} /* */ />);
    expect(getByText('White Balance')).toBeTruthy();   // kelvin op's display_name
  });

  it('falls back to intent for unknown op_id (no registry match)', () => {
    const w = makeWidget({ display_name: null, op_id: 'unknown_op' });
    const { getByText } = render(<WidgetShellHeader widget={w} /* */ />);
    expect(getByText('make it warmer')).toBeTruthy();
  });
});
```

(Read the existing `WidgetShellHeader` test for its actual prop signature — the example may need additional required props.)

- [ ] **Step 2: Run test to confirm failure**

Run: `npx vitest run src/components/widget/WidgetShellHeader.test.tsx`
Expected: FAIL — header doesn't currently read display_name.

- [ ] **Step 3: Update WidgetShellHeader title resolution**

Open `src/components/widget/WidgetShellHeader.tsx`. Find where the title string is computed. Replace with:

```typescript
import { loadRegistry } from '../../lib/registry/loader';

function resolveTitle(widget: Widget): string {
  if (widget.display_name) return widget.display_name;
  const reg = loadRegistry();
  const op = widget.op_id ? reg.ops[widget.op_id] : undefined;
  if (op) return op.display_name;
  return widget.intent;
}
```

Then use `resolveTitle(widget)` wherever the title was previously read.

- [ ] **Step 4: Run header test**

Run: `npx vitest run src/components/widget/WidgetShellHeader.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write failing test for WhyPopover per-op rationales**

Add to `src/components/widget/WhyPopover.test.tsx` (or create if missing):

```typescript
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { WhyPopover } from '../WhyPopover';
import type { Widget } from '../../../types/widget';

describe('WhyPopover multi-op rationales', () => {
  it('lists each node\'s op when widget has multiple nodes', () => {
    const widget = {
      id: 'w', intent: 'vintage',
      scope: { kind: 'global' },
      origin: { kind: 'mcp_user_prompt', prompt: 'vintage', parent_widget_id: null },
      op_id: 'color',
      composed: false,
      nodes: [
        { id: 'n_a', type: 'basic',     params: {} },
        { id: 'n_b', type: 'splitTone', params: {} },
      ],
      bindings: [],
      preview: { kind: 'none', auto_before_after: false },
      rejected_attempts: [], status: 'active', revision: 1,
      display_name: 'Warm fade', category: 'color',
    } as unknown as Widget;
    const { getByText } = render(<WhyPopover widget={widget} /* required props */ />);
    expect(getByText(/Color/)).toBeTruthy();        // op display_name for `basic` node
    expect(getByText(/Split Tone/)).toBeTruthy();   // op display_name for `splitTone` node
  });
});
```

- [ ] **Step 6: Run test to confirm failure**

Run: `npx vitest run src/components/widget/WhyPopover.test.tsx`
Expected: FAIL.

- [ ] **Step 7: Update WhyPopover**

Open `src/components/widget/WhyPopover.tsx`. Find the body section.

Read the current implementation first — the file already renders `widget.intent` and origin metadata. Add a block that lists the per-op breakdown for multi-op widgets:

```typescript
import { loadRegistry } from '../../lib/registry/loader';

function opsForWidget(widget: Widget) {
  const reg = loadRegistry();
  return widget.nodes.map((node) => {
    const op = Object.values(reg.ops).find(o => o.engine.node_type === node.type);
    return { node, op };
  });
}

// In the JSX, when widget.nodes.length > 1:
//   <div className="why-popover-ops">
//     <div className="why-popover-label">Ops in this widget</div>
//     {opsForWidget(widget).map(({ op, node }) => (
//       <div key={node.id} className="why-popover-op-row">
//         {op ? op.display_name : node.type}
//       </div>
//     ))}
//   </div>
```

(Use existing classes / tokens for layout — read `src/index.css` for the right utility classes.)

- [ ] **Step 8: Run test**

Run: `npx vitest run src/components/widget/WhyPopover.test.tsx`
Expected: PASS.

- [ ] **Step 9: Run full vitest + tsc**

```bash
cd /Users/anton/Dev/Projects/editor && npx vitest run 2>&1 | tail -5
cd /Users/anton/Dev/Projects/editor && npx tsc --noEmit -p tsconfig.json 2>&1 | head -10
```
Expected: all green.

- [ ] **Step 10: Commit**

```bash
cd /Users/anton/Dev/Projects/editor && git add src/components/widget/WidgetShellHeader.tsx src/components/widget/WhyPopover.tsx src/components/widget/WidgetShellHeader.test.tsx src/components/widget/WhyPopover.test.tsx
git commit -m "feat(widget): header reads display_name; Why? popover lists ops"
```

---

## Definition of Done

After Task 8:

- Cmd+K "make it look like a vintage film" produces 3–5 widgets, at least one of which has 2+ ops (e.g. `color` + `splitTone`).
- Each widget shows a meaningful, distinct `display_name` in the inspector header.
- Multi-op widgets render section-per-op (one `<RegistryDrivenPanel>` per op, each with the op's `display_name` as a section header).
- Single-op widgets render identically to today (no section header, no regression).
- "Why?" popover shows the user prompt plus, for multi-op widgets, the list of ops by display_name.
- Toolrail clicks still spawn single-op widgets with the registry op's `display_name` as the header.
- `preset_id` path still works (each preset's ops flatten to single-op widgets with registry display_name).
- Old-shape planner responses still produce widgets (each treated as a single-op widget with `display_name = null`).
- Same op_id appearing in two planner entries results in one widget, not two.
- Backend test suite: ≥471 tests passing.
- Frontend test suite: ≥547 tests passing.
- `npx tsc --noEmit` clean.
