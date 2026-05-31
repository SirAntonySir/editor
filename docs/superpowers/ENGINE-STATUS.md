# Engine Unification — Status & Roadmap (compact)

_Compact reference for the canonical-engine + accordion program. Last updated 2026-05-31._

## Done (merged into `feat/canvas-workspace`)

- **Phase 1 — shared engine contract.** `shared/engine-registry.json` is the single SSoT for
  each op's param keys / range / scale / uniform. Backend tool defaults + the WebGL pipeline
  scaling both read it → killed the −1..1-vs-−100..100 + key drift. Toolstore widgets drop
  Refine/Why. (plan: `plans/2026-05-31-phase1-engine-contract.md`)
- **Phase 2a — curve editor through the engine.** Curve points live in the op_graph node
  (`CurvesValue`); renderer evaluates points→LUTs; the Curves tool spawns the real SVG editor
  (`CurveEditor`/`CurveControl`). (plan: `plans/2026-05-31-phase2a-curve-editor-engine.md`)
- **analyze SAM gate.** `ANALYZE_SAM` (default off) — the `analyze_image` tool no longer runs
  SAM embed/precompute (it was starving the concurrent ai_context phase → stepper hung).
  Claude image context still produced. `SamClient` untouched; re-enable with `ANALYZE_SAM=1`.
- **Phase 3 Slice 1 — backend canonical core.** `SessionDocument.canonical[layer][op][param]`
  is the op_graph projection source (`project_to_graph` → `canonical_to_nodes`, dedup by
  (layer,op)). `set_param` + `set_widget_param` + tool spawns write it. Two views of one op
  dedup to one node. (plan: `plans/2026-05-31-phase3-canonical-core.md`)
- **Phase 3 Slice 2 — route fused/autonomous into canonical.** `add_widget` seeds canonical
  centrally from a widget's nodes, so ALL creation paths (tool_invoked, fused/LLM, autonomous)
  project after the Slice-1 switch. Projection source is canonical, not `widget.nodes`.
- **Phase 3 Slice 3 — widget-less writes + accept/close semantics.** New `set_param` REST tool
  (`/api/tools/set_param`, `layer_id/op/param/value`) writes canonical with no widget — the
  accordion's direct edit path. `delete_widget` (close ×) now resets the param keys the widget
  owns (`clear_param_value`, prunes emptied slots); `restore_widget` re-seeds them.
  `accept_widget` unchanged — canonical already persists (Apply keeps the value, drops the
  view). Seeding/resetting factored into `_seed_canonical_from_widget` / `_reset_canonical_from_widget`.
- **Adjustments Accordion (frontend) — DONE.** The Adjustments tab is now the Lightroom-style
  accordion over canonical state (`src/components/inspector/adjustments/`). `backendTools.set_param`
  + `useCanonicalParam` (optimistic + 300ms debounce, keyed on the `canon:{layer}:{op}` node id)
  are the widget-less read/write path. 6 tool sections from `ProcessingRegistry` (Light/Color/
  Kelvin/Curves/Levels/Filters; light+color share the `basic` node, filtered by param key);
  curves param key is `'curves'`. AI sections pinned on top (Apply→`accept_widget`, ×→`delete_widget`).
  Per-section `↗ Open on canvas` promotes via `propose_widget`. Filters (lut) is promote-only for
  now; AI **Refine** deferred (TODO in `AiSection.tsx`). 10 TDD tasks, ~298 FE tests green.
  (plan: `plans/2026-05-31-adjustments-accordion.md`)

## Specs (designs)

- `specs/2026-05-31-canonical-engine-control-unification-design.md` — the umbrella: one
  contract, canonical state, views-as-controllers, extensible op registry. Phases 1→4.
- `specs/2026-05-31-adjustments-accordion-design.md` — the Adjustments tab as a Lightroom-style
  accordion (AI sections on top, 6 fixed tool sections), active-layer scoped, **built on the
  canonical state**, coexists with canvas widgets (shared value). Layers → own tab (deferred).

## Roadmap (remaining — sequential)

1. ~~Route fused/autonomous creation into canonical.~~ **DONE (Slice 2).**
2. ~~Widget-less `set_param` + accept/close canonical semantics (backend).~~ **DONE (Slice 3).**
3. ~~Adjustments Accordion (incl. frontend canonical hooks).~~ **DONE** — see Done list above.
   (plan: `plans/2026-05-31-adjustments-accordion.md`.) Follow-ups left: AI **Refine** wiring,
   **Filters/LUT-over-canonical** (currently promote-only), and a test for the AI binding/reset
   write path.
4. **Remove `Widget.nodes` (thin views).** Widgets stop owning params; bindings reference
   `(layer, op, param)` canonical slots. Cleanup of the now-redundant node ownership. (After the
   accordion proves the widget-less path end-to-end.)

## Refined model (decided after Slice 2)

- **Canonical is the base; widgets are optional views.** An adjustment (canonical
  `(layer,op,param)` value) can exist WITHOUT a widget; a widget never exists without its
  canonical adjustment. → the accordion edits canonical **directly** (widget-less
  `set_param`); a per-section **↗ affordance** optionally "opens"/spawns a canvas widget
  bound to that adjustment. Editing a section does NOT auto-spawn a widget.
- **accept vs close:** `accept` (Apply) → canonical value STAYS, widget (view) goes (commit).
  `close` (×) → canonical value RESETS, widget goes (discard). Note: reset only the param
  keys that widget/section owns, not the whole shared (layer,op) slot.
- **Backend for this model: DONE (Slice 3).** `set_param` tool ships; `delete_widget` resets
  owned canonical; `accept_widget` keeps canonical. The remaining "drop the widget view" on
  accept is a **frontend** rendering concern (don't render `accepted` widgets as canvas shells);
  backend keeps the record so panel_bindings/history stay intact.

## Open decisions / behavior flags (from Slice 1)

- **`layer_ids` forwarding lost:** canonical projects per-(layer,op) with `layer_ids=None`;
  image_node-scope (multi-layer composite) adjustments need a canonical `layer_ids` concept
  later.
- **Delete widget no longer clears the adjustment:** canonical persists (SSoT). Product
  decision pending: "delete" = remove view vs. reset adjustment.

## Working state

- Branch `feat/canvas-workspace`. User has in-flight **frontend** WIP (command-palette:
  `App.tsx`, `MenuBar.tsx`, `CommandTrigger.tsx`, `index.css`, `BackendStatusBadge.*`) — keep
  backend commits disjoint; pre-commit hook runs `npm run check` (frontend), so backend work
  goes through an **isolated worktree off HEAD** (symlink `node_modules` + `backend/.venv`).
- Pre-existing unrelated test failure: `backend/tests/test_panel_endpoint.py::test_panel_reuses_cached_context` (no `ANTHROPIC_API_KEY`).
