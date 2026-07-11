# Remove the Compound-Dial System — Design (System 1 of 2)

**Status:** Approved
**Date:** 2026-07-11
**Author:** Anton (with Claude)
**Branch:** `feat/remove-compound-dial` (off `main`)

---

## 1. Problem

The editor now has a generic **fused intent widget** (one synthesized driver slider over
collapsible op sections — see `2026-07-11-fused-intent-widgets-design.md`). It makes the
older **compound-dial** system redundant: five hand-authored registry ops
(`time-of-day`, `weather`, `mood`, `season`, `age`) with a bespoke dial UI, a render-time
node-expansion path, and dedicated planner routing. Two parallel "special widget" systems
is exactly the inconsistency we want gone. This spec removes the compound-dial system
entirely and lets those intents flow through the generic planner → primitive ops → new
driver path.

This is **System 1 of a two-part removal**. System 2 (the older fused-template framework
in `app/tools/fused/`) is a separate spec.

## 2. Goals

1. Delete the compound-dial UI, its render-time expansion path, the 5 registry ops, and
   the backend routing/resolution that fed them.
2. Keep the app fully working: former dial intents ("make it night", "winter sunset")
   compose primitive ops via the normal planner and each gets the new synthesized driver.
3. No dead references, no orphaned `compound` nodes, `npm run check` + backend suite green.
4. Preserve everything the *new* fused system depends on.

## 3. Non-goals

- Removing the fused-template framework (`app/tools/fused/`) — that's System 2.
- Reproducing the dials' hand-tuned cinematic anchor tables via presets. Accepted loss:
  former dial intents now get whatever the generic planner+resolver produce.
- Any change to the new fused-intent-widget behavior.

## 4. What the new system depends on (MUST NOT be removed)

- `src/lib/perceptual-dial/interpolate.ts` (`interpolate1D`, `interpolateExtended`) and
  `src/lib/perceptual-dial/types.ts` (`Anchor`, `CompoundParams`) — used by
  `FusedWidgetBody`.
- `OpCompoundConfig` (+ `CompoundAnchor`) in `backend/app/registry/schema.py` and its
  generated TS mirror — this is the type of `Widget.compound` (the new system's block).
  Only the `RegistryOp.compound` **field** is removed, not the config class.
- The `set_widget_param` `__driver` branch (keyed on `w.compound`) and
  `interpolate_extended` — the new driver path. Only the registry-op `op.compound`
  branch (keyed on `RegistryOp.compound`) is removed.

## 5. Removal map

### 5.1 Frontend — dial UI
- Delete `src/components/widget/CompoundWidgetBody.tsx` (+ `.test.tsx`).
- Delete `src/components/widget/compound/CircularDial.tsx` (+ `.test.tsx`); remove the now-empty `compound/` dir.
- Delete `src/components/workspace/PerceptualDialBody.tsx` (+ `.test.tsx`).

### 5.2 Frontend — dispatch
- `src/components/widget/WidgetShell.tsx`: remove the `CompoundWidgetBody` import and its
  dispatch branch (`!isFused && loadRegistry().ops[opId]?.compound`); remove the
  `!loadRegistry().ops[widget.opId]?.compound` clause from `usesFlatBody`.
- `src/components/inspector/adjustments/ToolSection.tsx`: remove the `CompoundWidgetBody`
  import, the `compoundWidget` snapshot selector, and its dispatch branch. Compound ops no
  longer exist, so the selector is dead.

### 5.3 Frontend — render-time expansion
- Delete `src/lib/perceptual-dial/expand-compound.ts` (+ `.test.ts`) and
  `src/lib/perceptual-dial/compile.ts` (+ `.test.ts`) — the compound render-expansion pair.
- `src/lib/select-pipeline-nodes.ts`: drop the `expandCompoundNodes(...)` wrap (line ~105)
  — pass the merged nodes straight to `.map(toPipelineNode)`.
- `src/lib/image-node-renderer.ts`: remove the compound-node optimistic-merge block
  (~lines 250–275: the `n.type !== 'compound'` merge + `expandCompoundNodes`), keeping the
  non-compound `withOptimistic` path intact.
- No dedicated `compound` shader exists — the op JSON's `shader: "compound"` was never a
  real shader; `expandCompoundNodes` replaces a `compound` node with real op nodes
  (basic/kelvin/…) *before* the pipeline, so those nodes use their own existing shaders.
  Removing the expansion path is the complete story. Verify no code path still emits or
  branches on `type: 'compound'` after the deletions.

### 5.4 Frontend — processing wiring
- `src/processing/registry-ops.ts` and `src/processing/index.ts`: the compound references
  are comments describing the old dispatch. Update/remove them; confirm nothing registers a
  compound-specific processing body.

### 5.5 Backend
- Delete `shared/registry/ops/{time-of-day,weather,mood,season,age}.json`.
- `backend/app/registry/schema.py`: remove the `compound: OpCompoundConfig | None` field
  from `RegistryOp` and its `compound` validation in `_bindings_reference_params`. **Keep**
  `OpCompoundConfig` + `CompoundAnchor` (used by `Widget.compound`).
- `backend/app/services/anthropic_client.py`: remove the "COMPOUND DIAL OPS" section and
  the two compound-dial worked examples from `_PLANNER_SYSTEM_PROMPT`; remove the
  `compound_dial` catalog injection (~line 1346).
- `backend/app/tools/widgets/set_widget_param.py`: remove the registry-op compound branch
  (`op.compound is not None` → `resolve_compound`) and the `resolve_compound` import.
  **Keep** the `w.compound` `__driver` branch.
- Delete `backend/app/registry/compound_resolver.py` (+ its test) — only the registry-op
  dial path used it; the new driver uses `interpolate_extended` directly.
- Regenerate shared types (`OpCompoundConfig` stays; `RegistryOp.compound` disappears).

### 5.6 Tests
- Delete tests bound to deleted units: `CompoundWidgetBody.test.tsx`,
  `CircularDial.test.tsx`, `PerceptualDialBody.test.tsx`, `compile.test.ts`,
  `expand-compound.test.ts`, `compound_resolver` test, loader tests asserting the 5 ops,
  planner tests asserting compound-dial routing.
- Add one planner test: a former dial intent (e.g. "make it a night scene") now returns a
  plan of **primitive ops** (no `compound_dial`, no `time-of-day` op).
- Keep `interpolate` tests (both `interpolate1D` and `interpolateExtended`).

## 6. Data flow after removal

```
"make it night" (Cmd+K)
  → propose_stack._handle_llm_path
  → planner composes primitive ops (light / color / vignette / …)   [no dial routing]
  → resolver → _build_widget_multi → _attach_fused_compound
  → widget with synthesized driver (the NEW fused component)
```

No `compound` node ever enters the operation graph, so the render pipeline's
compound-expansion path is genuinely dead and removed.

## 7. Risks & mitigations

- **Orphaned `compound` node in a persisted/old session.** After removal the renderer no
  longer expands `type: 'compound'` nodes. Mitigation: these are backend-session artifacts;
  a stale snapshot with a compound node would render that node as a no-op (its shader is
  gone). Acceptable — old sessions predating this change aren't a support target, and a
  fresh `openImage` resets the session. Note it in the PR; no migration.
- **Planner quality regression for atmosphere intents.** "Make it night" via composed
  primitives may look less curated than the hand-tuned dial. Accepted per Non-goals; the
  new driver still lets the user scale intensity.
- **Hidden importer of a deleted module.** Mitigation: `tsc`/`eslint` (via `npm run check`)
  and the backend import suite catch any dangling reference; the plan greps for each
  deleted symbol before deleting.

## 8. Testing strategy

- `npm run check` (tsc + eslint + vitest) green — proves no dangling frontend imports.
- Backend `pytest tests/ -q` green — proves registry loads without the 5 ops, planner
  prompt/tool valid, `set_widget_param` + `refine`/`repeat` unaffected.
- New planner test: former dial intent → primitive-op plan.
- Manual: open image, Cmd+K "make it night" → composed op widgets each with a driver;
  the canvas renders; no console errors about a missing `compound` shader.

## 9. Phasing (single plan, ordered so the tree stays green)

1. Backend removal (ops, planner, set_widget_param branch, compound_resolver, schema field)
   + regen types + backend tests.
2. Frontend render-path removal (expand-compound/compile, select-pipeline-nodes,
   image-node-renderer, compound shader).
3. Frontend UI + dispatch removal (CompoundWidgetBody/CircularDial/PerceptualDialBody,
   WidgetShell, ToolSection, processing wiring).
4. Test cleanup + new planner test + full `npm run check` and backend suite.

Each step ends green; deleting producers (backend ops/planner) before consumers keeps
intermediate states coherent.
