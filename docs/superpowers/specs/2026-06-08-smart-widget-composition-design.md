# Smart Widget Composition — Design

**Status:** Draft
**Date:** 2026-06-08
**Author:** Anton (with Claude)
**Branch:** to be created off `feat/registry-followups`

---

## 1. Problem

After the Tool SSoT Registry landed, typing *"make it look like a vintage film"* in Cmd+K spawns 5 widgets — `levels`, `color`, `hsl`, `splitTone`, `grain` — one per op. Two UX problems with that:

1. **Conceptually-related ops scatter into separate widgets.** A user thinking "I want a warm fade" sees a Color widget and a Split Tone widget independently. Bundling them under one card matches how editors think.
2. **All widgets share the same name.** Each one's title is the user's prompt ("make it look like a vintage film"). Five identical headers in the inspector. No information about what each widget *does*.

The fused-template era handled #1 implicitly (vintage was one widget with five sliders), but at the cost of treating "vintage" as monolithic. We want both: per-op refinement *and* sensible bundling.

## 2. Goals

1. **Compose ops into multi-op widgets.** The planner decides which ops belong together; each top-level plan entry becomes one widget that may carry 1–5 ops.
2. **Give each widget a meaningful name.** The planner emits a `widget_name` per widget (2–4 words describing the effect, not the op).
3. **Category as guidance.** Each op declares a `category` (tone / color / detail / texture / effect) so the planner has a strong default for what bundles with what.
4. **Same-op dedup** as a safety net for LLM hiccups.
5. **No regression for existing paths** (`tool_invoked`, `preset_id`).

## 3. Non-goals

- Category-driven canvas sort/filter — out of scope, deferred.
- User-editable widget names in the inspector — deferred.
- Cross-widget param linking — deferred.
- Shared resolver context across grouped ops (each op still resolves independently in Phase 2) — out of scope; the planner can pass `starting_params` per op as a coordination hint.
- `time-of-day` compound widget integration — handled by a separate code path; not affected here.

## 4. Architecture overview

Three changes ripple front to back:

```
shared/registry/ops/*.json       +category field (per op)
  ↓
backend Pydantic + frontend Zod  +category field on RegistryOp
  ↓
Planner (Anthropic call)         response shape changes to nested
  Phase 1                          plan: [{widget_name, category, ops: [...]}]
  ↓
propose_stack._handle_llm_path   _build_widget_multi assembles N ops per Widget
  ↓
backend/app/schemas/widget.py    +display_name +category fields on Widget
  ↓
frontend RegistryDrivenPanel     two-level group rendering ("Color › Shadows")
frontend WidgetShell             header reads display_name with fallback
```

Phase 2 (resolver) is unchanged at the schema level; it iterates the flattened `(widget_index, op)` pairs in parallel and threads results back into the originating widget.

## 5. Component changes

### 5.1 Op JSON — add `category`

Each `shared/registry/ops/<id>.json` adds an optional `category: str` field:

| Category | Ops |
|---|---|
| `tone` | light, levels, curves |
| `color` | color, kelvin, hsl, splitTone |
| `detail` | clarity, sharpen, blur |
| `texture` | grain |
| `effect` | vignette |

The category is **guidance** for the planner, not a hard partition. The planner is free to mix categories within one widget when it has compositional reason.

### 5.2 Schemas — `category` on RegistryOp

`backend/app/registry/schema.py` and `shared/registry/schema.ts` each add `category: str | None = None` to `RegistryOp` / `OpLlmMetadataSchema` (preference: top-level on RegistryOp, not nested under `llm`, since it's used by frontend grouping and is conceptually about the op, not the LLM).

### 5.3 Planner contract

The Phase 1 LLM response shape changes from:

```json
{
  "plan": [
    { "op_id": "levels",    "rationale": "..." },
    { "op_id": "color",     "rationale": "..." },
    { "op_id": "splitTone", "rationale": "..." },
    ...
  ]
}
```

to:

```json
{
  "plan": [
    {
      "widget_name": "Lifted blacks",
      "category": "tone",
      "ops": [
        { "op_id": "levels", "rationale": "...", "starting_params": {"inBlack": 12} }
      ]
    },
    {
      "widget_name": "Warm fade",
      "category": "color",
      "ops": [
        { "op_id": "color",     "rationale": "drop saturation -15" },
        { "op_id": "splitTone", "rationale": "warm shadows, cool highlights" }
      ]
    },
    {
      "widget_name": "Film grain",
      "category": "texture",
      "ops": [
        { "op_id": "grain", "rationale": "fine 18% grain" }
      ]
    }
  ],
  "overall_rationale": "vintage film: faded blacks + warm desaturated color + grain"
}
```

The planner's system prompt is extended with:

> Each plan entry becomes ONE widget on the user's canvas. Group conceptually-related ops into the same widget. Use the `category` field as a strong default: ops with the same category usually belong together unless you have a specific reason to split. Always give each widget a short, descriptive `widget_name` (2–4 words) describing the EFFECT not the op (e.g. "Lifted blacks", not "Levels op").

**Old-shape fallback:** if `plan` entries lack `widget_name` / `ops`, the assembly layer transforms each `{op_id, rationale}` into a single-op widget with `widget_name = None`. This protects against prompt drift or in-flight stale responses for one release cycle.

### 5.4 Widget schema — `display_name` + `category`

`backend/app/schemas/widget.py`:

```python
class Widget(BaseModel):
    # ... existing fields unchanged ...
    display_name: str | None = None
    category: str | None = None
```

Both optional, default `None`. No backwards-compat alias needed — existing widgets simply lack the fields and load fine.

Frontend `src/types/widget.ts` mirrors:

```typescript
export interface Widget {
  // ... existing fields ...
  display_name?: string | null;
  category?: string | null;
}
```

### 5.5 Assembly: `_build_widget_multi`

`backend/app/tools/widgets/propose_stack.py`:

```python
def _build_widget_multi(
    *, widget_name: str | None,
    category: str | None,
    ops: list[tuple[str, dict[str, Any]]],   # [(op_id, resolved_params), ...]
    intent: str,
    scope: Scope,
    origin: WidgetOrigin,
    layer_id: str,
    image_node_layer_ids: list[str] | None,
) -> Widget:
    """Build a single Widget composed of multiple ops."""
```

Behavior:
- Generate one `widget_id`
- For each `(op_id, params)`:
  - Generate one `node_id`
  - Build one `WidgetNode` with `type=op.engine.node_type`, `params=full_params`
  - Build one `ControlBinding` per `op.bindings[]`, with:
    - `target.node_id` pointing at THIS op's node (not always the first)
    - `group` preserved as-is from the registry (no prefix; section-per-op grouping happens in the inspector wrapper, not in binding data — see §5.7)
- Concatenate all bindings in op order
- Set `widget.display_name = widget_name`, `widget.category = category`
- Set `widget.op_id` to the FIRST op's id (preserves single-op compatibility for code that reads `widget.op_id`)

The single-op `_build_widget` becomes a thin wrapper:

```python
def _build_widget(op_id, params, ..., display_name=None, category=None) -> Widget:
    return _build_widget_multi(
        widget_name=display_name, category=category,
        ops=[(op_id, params)],
        ...
    )
```

### 5.6 Dedup pass

Runs BEFORE Phase 2 resolution, on the planner output:

```python
def _dedup_plan(raw_plan: list[dict]) -> list[dict]:
    # Within-widget: collapse same op_id within one entry.
    for entry in raw_plan:
        seen: dict[str, dict] = {}
        merged_ops = []
        for op in entry["ops"]:
            if op["op_id"] in seen:
                seen[op["op_id"]]["starting_params"] = {
                    **(seen[op["op_id"]].get("starting_params") or {}),
                    **(op.get("starting_params") or {}),
                }
                seen[op["op_id"]]["rationale"] += " · " + op.get("rationale", "")
            else:
                seen[op["op_id"]] = op
                merged_ops.append(op)
        entry["ops"] = merged_ops

    # Cross-widget: collapse entries with identical op_id sets.
    by_signature: dict[tuple[str, ...], dict] = {}
    deduped = []
    for entry in raw_plan:
        sig = tuple(sorted(op["op_id"] for op in entry["ops"]))
        if sig in by_signature:
            # Merge into earlier entry, last-write-wins on per-op params.
            target = by_signature[sig]
            for op in entry["ops"]:
                for target_op in target["ops"]:
                    if target_op["op_id"] == op["op_id"]:
                        target_op["starting_params"] = {
                            **(target_op.get("starting_params") or {}),
                            **(op.get("starting_params") or {}),
                        }
                        target_op["rationale"] += " · " + op.get("rationale", "")
                        break
        else:
            by_signature[sig] = entry
            deduped.append(entry)
    return deduped
```

### 5.7 Inspector layout

Two changes:

1. **Widget header** (`WidgetShell` or equivalent): title = `widget.display_name ?? (single-op? op.display_name : widget.intent)`.

2. **Multi-op rendering** in `RegistryDrivenSectionBody` (the store-connected wrapper Task 14 introduced):
   - Single-op widget (`widget.nodes.length === 1`): call `RegistryDrivenPanel` once with the op — unchanged from today.
   - Multi-op widget: derive the list of `(op, op_values, op_bindings)` triples by walking `widget.nodes` and looking up each node's op via the registry loader (`loadRegistry().ops[node.type]`). Render one section per op, each with:
     - A section header showing the op's `display_name` (styled via a new `.registry-panel-section-title` utility class in `src/index.css`)
     - A `RegistryDrivenPanel` call scoped to just that op's bindings + values
   - The existing sub-group rendering inside `RegistryDrivenPanel` (e.g. splitTone's `Shadows` / `Highlights` groups) is unchanged — each per-op panel still groups its own bindings normally.

`RegistryDrivenPanel`'s prop signature stays the same. The multi-op orchestration lives entirely in the wrapper. No binding-data trickery (no separator characters, no string parsing).

### 5.8 "Why?" popover

Single-op widgets unchanged. Multi-op widgets get a per-op rationale list in the popover body (one line per op), with the planner's `overall_rationale` at the top.

## 6. Data flow

```
Frontend Cmd+K: "make it vintage"
  → backendTools.proposeStack({ intent, scope, origin: "mcp_user_prompt" })
  ↓
Backend /tools/propose_stack:

  Phase 1 — PLAN
    plan_widget_stack(...)
      → returns nested plan with widget_name + category + ops[]

  _dedup_plan(plan)
    → cross-widget + within-widget merges

  Phase 2 — RESOLVE (parallel)
    for each (widget_index, op) flatten:
      asyncio.to_thread(anthropic.resolve_widget_params, op=...)

  Assemble — for each plan entry:
    widget = _build_widget_multi(
      widget_name=entry.widget_name,
      category=entry.category,
      ops=[(op_id, resolved_params) for ...],
      ...
    )
    doc.add_widget(widget)

  Return _Output(widgets=[w.model_dump() for w in widgets])
  ↓
Frontend: SSE widget.created per widget → workspace adds nodes
  Inspector: renders RegistryDrivenPanel with two-level groups
```

## 7. Failure handling

| Failure | Behavior |
|---|---|
| Planner JSON malformed | `plan_widget_stack` returns `{"plan": []}` → keyword-matched preset fallback, wrapped as single-op widgets |
| Planner returns OLD shape (`{op_id, rationale}` flat) | Transform on the fly into nested shape with `widget_name=None`. Per-widget name falls back to registry op display_name. |
| Empty plan | Same as today — keyword-matched preset fallback. |
| Resolver fails for ONE op in a multi-op widget | Drop that op; build the widget with the remaining ops. If all ops fail, drop the widget entirely. |
| Dedup leaves a widget with empty `ops` | Drop the widget with a warning event. |
| Frontend Zod rejects unknown `category` | Don't enforce closed enum on `category`; use `z.string().optional()`. |
| Multi-op widget has a node whose `type` is not in the registry | Fall back to flat rendering with the node's `type` as the section header; emit a console warning. |

## 8. Migration & rollout

No feature flag, no data migration. The change is strictly additive at the schema layer.

**Commit ordering** (each commit is independently revertable):

1. **Schemas** — add `category` to `RegistryOp` (Pydantic + Zod). Add `display_name` + `category` to `Widget` (Pydantic + TS). No behavior change.
2. **Op JSONs** — add `category` to 12 op JSON files. No behavior change.
3. **`_build_widget_multi`** — backend assembly extension. Single-op path unchanged. Tests for multi-op.
4. **Dedup pass** — `_dedup_plan` helper + tests.
5. **Planner contract** — update `plan_widget_stack` system prompt + response schema. Old-shape fallback. Tests with mocked Anthropic for both shapes.
6. **`_handle_llm_path` wired** — uses dedup + multi-op assembly + new plan shape. Integration test: vintage prompt → ≥2 widgets, ≥1 multi-op widget, all non-null display_name.
7. **Inspector two-level groups** — frontend `RegistryDrivenPanel` change + CSS. Frontend test for multi-op layout.
8. **Widget header** — `display_name` fallback chain. Why-popover per-op rationale list. Frontend test.

## 9. Definition of done

After commit 8:

- Cmd+K "make it look like a vintage film" produces 3-5 widgets, AT LEAST ONE of which has 2+ ops (`color` + `splitTone` is the canonical case).
- Each widget shows a meaningful, distinct display_name in the inspector header (not the user prompt).
- A 2-op widget renders with two-level group structure ("Color" section, "Split Tone" section with nested "Shadows"/"Highlights" sub-groups).
- "Why?" popover shows the planner's overall_rationale plus per-op rationales.
- Toolrail clicks still spawn single-op widgets with the registry op's display_name as the header (no regression).
- `preset_id` path still works — each preset's ops still flatten to single-op widgets, but each gets a sensible display_name from the registry.
- Old-shape planner responses (back-compat) still produce widgets (each treated as single-op).
- Same op_id appearing twice in the plan results in one widget, not two.
- Backend test suite: 471+ tests passing.
- Frontend test suite: 547+ tests passing.
- `tsc --noEmit` clean.

## 10. Test plan

### 10.1 Schema tests
- `RegistryOp` validates with and without `category`.
- `Widget` validates with and without `display_name` + `category`.
- Unknown `category` string accepted (no closed enum).

### 10.2 Assembly tests
- `_build_widget_multi` with 2 ops produces 2 nodes + bindings concatenated.
- Each binding's `target.node_id` points at the correct op's node.
- Binding `group` fields preserved verbatim from registry (no prefixing).
- Single-op `_build_widget` wrapper produces identical output to today (no behavior regression).

### 10.3 Dedup tests
- Cross-widget: two entries with same `[op_id]` set → merge into one, last-write-wins on params, rationales concatenated.
- Within-widget: same op_id twice in one `ops` list → collapse to one op.
- Multi-op widgets with different op_id sets stay separate.

### 10.4 Planner tests
- Mocked planner returns NESTED shape → assembly produces correct widgets.
- Mocked planner returns OLD shape → fallback produces single-op widgets.
- Mocked planner returns mixed (some entries new shape, some old) → both handled.

### 10.5 Integration test
- "vintage" prompt with fully mocked Anthropic (planner returns 3 widgets, one with 2 ops):
  - 3 widgets created.
  - Multi-op widget has 2 nodes, bindings from both ops, group prefixes set correctly.
  - All widgets have non-null `display_name`.
  - Resolver runs once per op (not per widget).

### 10.6 Frontend tests
- Multi-op widget renders one section per op via `RegistryDrivenSectionBody`, each section showing the op's `display_name` as header.
- Single-op widget renders identically to today (no section header).
- `WidgetShell` header reads `display_name` first, falls back to op display_name, falls back to intent.
- "Why?" popover renders per-op rationales when multi-op.

### 10.7 Failure tests
- Planner returns empty plan → preset fallback fires.
- One op in a 2-op widget fails resolution → widget spawns with 1 node.
- All ops in a widget fail → widget dropped, warning event emitted.

## 11. Open questions deferred

1. **Category-aware planner prompt examples.** Do we hand the planner 3-5 worked compositions ("vintage" → these 3 widgets, "golden hour" → these 4) to anchor its output? Probably yes in a follow-up — adds maybe 1k tokens to prompt cache but improves consistency.
2. **Widget reorder via category.** Should the inspector list widgets in category order (tone → color → detail → texture → effect) regardless of planner order? Today the planner picks order. Deferred to a UX pass.
3. **Multi-op widget "split" UX.** Should the user be able to drag a sub-op out of a widget into its own widget? Conceptually clean but adds UX complexity. Deferred.
4. **Per-op enable toggle inside a multi-op widget.** Visually clean (eye icon per section) but adds backend state. Deferred.

## 12. Why these choices

**Why a `category` field on the op rather than the planner deciding categories freely?**
With free-form categories, the planner would emit "tone" sometimes and "tonal" other times. Filtering or sorting downstream becomes a string-match exercise. A declared category per op gives the planner a strong default and gives the frontend a stable enum. The planner can still place ops cross-category when needed — the field is a hint, not a fence.

**Why `display_name` on the Widget rather than repurposing `intent`?**
`intent` carries the user's prompt — useful for "Why?" popover, debugging, repeat-widget, and as the spawning context. Per-widget labels are distinct semantic data ("Lifted blacks" describes the EFFECT, not the user's ASK). Keeping them separate avoids overloading.

**Why dedup BEFORE Phase 2 resolution?**
Resolution is the expensive step (one LLM call per op). Deduplicating after would mean paying for resolves we'll discard. Doing it on the planner output is cheap and keeps the resolver oblivious to merging.

**Why no feature flag?**
The change is additive at the schema layer. Old planner responses are auto-transformed. Single-op widgets still work identically. There's no behavior path that benefits from a flag — rollout is one branch.

**Why section-per-op rendering in the wrapper instead of encoding op-level grouping into binding data?**
The early draft of this spec used a `"›"` separator in `binding.group` to express two-level grouping. Two reasons we backed out of that:
1. The Inspector wrapper already walks `widget.nodes` to resolve ops. Adding a section-header layer there is one component change with no schema implications.
2. Encoding structural information into a free-form string is a low-grade smell — it works until a registry author writes `"Café › Crème"` as a group label and the parser splits at the wrong place.
   Section-per-op rendering keeps the `binding.group` field semantically pure (just the op's own sub-grouping) and pushes layout concerns to the layout component.
