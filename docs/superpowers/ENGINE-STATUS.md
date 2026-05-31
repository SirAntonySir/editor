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

## Specs (designs)

- `specs/2026-05-31-canonical-engine-control-unification-design.md` — the umbrella: one
  contract, canonical state, views-as-controllers, extensible op registry. Phases 1→4.
- `specs/2026-05-31-adjustments-accordion-design.md` — the Adjustments tab as a Lightroom-style
  accordion (AI sections on top, 6 fixed tool sections), active-layer scoped, **built on the
  canonical state**, coexists with canvas widgets (shared value). Layers → own tab (deferred).

## Roadmap (remaining — sequential)

1. **Route fused/autonomous creation into canonical.** `propose_widget` (LLM path) + the
   autonomous-mint path must `doc.set_param(...)` their nodes' params (today only the
   tool_invoked path does). Until then, AI/fused widgets don't project after the Slice-1 switch.
2. **Frontend canonical hooks.** A read selector over `op_graph` canonical nodes + a
   `set_param(layer, op, param, value)` setter the views call (the canvas widget already routes
   via `set_widget_param`; accordion will use the same canonical path).
3. **Remove `Widget.nodes` (thin views).** Widgets stop owning params; bindings reference
   `(layer, op, param)` canonical slots. Cleanup of the now-redundant node ownership.
4. **Adjustments Accordion.** Build the accordion (per the spec) over the canonical state.

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
