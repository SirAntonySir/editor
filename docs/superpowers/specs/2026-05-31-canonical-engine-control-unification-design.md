# Canonical Engine & Control Unification — Design

**Date:** 2026-05-31
**Status:** Approved design, pre-implementation
**Author:** Anton + Claude (brainstorming session)

## 1. Problem & Context

The editor today has **two overlapping control systems** and a **triplicated parameter
contract**, which together produce the user-visible symptoms: toolbar/AI widgets spawn
but sliders barely move the image, the Curves tool spawns a single slider instead of a
real curve editor, and toolstore widgets carry AI-only affordances (Refine/Why).

### Current architecture (as verified live)

- **Backend owns values (Engine SSoT doctrine).** `operation_graph` is projected from
  the active/accepted widgets ([operations.py](../../../backend/app/state/operations.py)).
  Each node = `{id, type, params, layer_id}`.
- **Frontend renders.** [image-node-renderer.ts](../../../src/lib/image-node-renderer.ts)
  → [PipelineManager](../../../src/lib/pipeline-manager.ts) → WebGL ping-pong shaders
  ([pipeline.ts](../../../src/shaders/pipeline.ts)). It filters `op_graph.nodes` by
  `layer_id`, maps node → Adjustment → shader uniforms, composites layers.
- **A widget** (AI or toolstore) = `nodes` (op-graph fragments) + `bindings`
  (UI controls mapped to node params) + scope/origin/reasoning.

### The three defects feeding the symptoms

1. **Param contract is triplicated and drifts.** Each op's param keys + ranges + scale
   are defined three times, out of sync:
   - Backend: [tool_defaults.py](../../../backend/app/tools/tool_defaults.py) (binding
     `control_schema`, e.g. exposure `min:-1, max:1`).
   - Frontend: [src/processing/*.tsx](../../../src/processing) `ProcessingDefinition`
     (e.g. [light.tsx](../../../src/processing/light.tsx) exposure `min:-100, max:100`).
   - Frontend: [pipeline.ts](../../../src/shaders/pipeline.ts) uniform mapping
     (`u_exposure = exposure / 100`).

   **Consequence ("no effect"):** the canvas widget slider writes `-1..1`; the pipeline
   divides by 100; the shader receives `~0.01` → invisible. Kelvin writes param `temp`
   but the shader reads `kelvin` (key mismatch). Curves writes `intensity` but the curves
   shader reads a LUT (no such uniform).

2. **Two parallel control systems.**
   - *Legacy:* `ProcessingRegistry` + `ProcessingDefinition.Panel` (the real curves
     editor: [curves.tsx](../../../src/processing/curves.tsx) → `CurvesPanel`) +
     [use-processing-param.ts](../../../src/lib/use-processing-param.ts). **Orphaned** —
     [InspectorPanel](../../../src/components/inspector/InspectorPanel.tsx) renders only
     Suggestions + Layers, not these panels.
   - *New:* MCP widget + `WidgetShell` + generic [BindingRow](../../../src/components/inspector/widget/BindingRow.tsx).
   - The two define every tool's params independently and disagree.

3. **No shared canonical value.** Each widget owns its own nodes. An AI contrast widget
   and a separate Contrast tool would be two independent nodes — they cannot move
   together. Optimistic-preview keys also disagree: `WidgetShell` keys by `node_id`
   (renderer matches), `use-processing-param` keys by `widget_id` (renderer does not).

### Already landed this session (foundation)

- `tool_invoked` widgets are minted `status="active"` so they render as editable shells.
- `analyze_image` stamps the real frontend `layer_id` (not `"legacy"`).
- Widget lifecycle SSE events embed the projected `operation_graph` so newly
  created/edited widgets reach the renderer without a full re-fetch.

These remain correct under the new model (the projection source changes in Phase 3).

## 2. Goals & Non-Goals

**Goals**
- One declarative engine contract; no param/scale/key drift possible.
- One control system; rich controls (curve editor, levels histogram) are control types.
- Canonical value per `(layer, op, param)`; every UI is a view/controller → bidirectional
  sync ("AI turns up contrast → the Contrast tool's slider moves too").
- Toolstore views are deterministic chrome (no Refine/Why); AI views keep them.
- The engine is **extensible**: the AI can register new ops/shaders (compose USP).

**Non-Goals (for this spec's near phases)**
- Multiple independent instances of the *same* op on *one* layer (stacking is via layers).
- Moving rendering, undo, session, or persistence off the backend. Backend stays the
  values SSoT; frontend stays the renderer.

## 3. Key Decisions (locked during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Control model | **One canonical value per `(layer, op, param)`; UIs are views/controllers** |
| D2 | Vocabulary | **Extensible registry** — fixed core ops + AI can register new ops/shaders |
| D3 | SSoT location | **Shared contract** — one declarative registry consumed by BE + FE; values stay in backend op_graph; shaders stay frontend keyed by binding-id |
| D4 | Spec scope | **One spec, phased implementation** (Phases 1–4) |

## 4. Architecture

### 4.A Shared engine registry (the contract)

A single **neutral JSON schema** is the source of truth for the engine vocabulary. The
frontend imports it directly; the backend loads the same file. No codegen step, no drift.

Per op, the registry declares:

```
EngineOp {
  op: string                 // "light", "color", "kelvin", "curves", "levels", "lut", "ai_*"
  shaderBinding: string      // which shader program renders it ("basic", "kelvin", …)
  params: EngineParam[]
}
EngineParam {
  key: string                // canonical param key (globally unique within the op)
  uniform: string            // shader uniform name the renderer drives
  range: { min, max } | "lut"
  scale?: number             // e.g. 100 → uniform = value / scale  (one place only)
  default: number
}
```

Consumers:
- **Backend:** op_graph projection, AI fused-template/default generation, `set_param`
  validation. Replaces the hand-written `control_schema` blocks in `tool_defaults.py`.
- **Frontend:** control ranges/labels, the pipeline uniform mapping (replaces the
  hardcoded `/100` etc. in [pipeline.ts](../../../src/shaders/pipeline.ts)), and which
  shader program to use per op.

**Result:** scale and keys are identical *by construction*. The `-1..1`-vs-`-100..100`
class of bug becomes structurally impossible.

> Decision detail to settle in the plan: physical location of the JSON (e.g.
> `shared/engine-registry.json` imported by Vite and read by FastAPI at startup) and how
> the frontend gets typed access (import with a generated/handwritten `.d.ts`).

### 4.B Canonical state, identity & bidirectional sync

- **Identity = `(layer_id, op, param_key)`.** Per layer there is one slot per op
  (Lightroom-develop-module style). A layer holds canonical adjustment values:
  `Sky.light.contrast = 40`, `Sky.kelvin = 6200`, etc.
- **Views own no values.** A view binding references `(op, param_key)`; the layer
  context comes from the view's target layer.
- **Write path:** a control calls `set_param(layer_id, op, param_key, value)`. The
  backend writes the single canonical value; the change propagates (op_graph + SSE);
  every view bound to that param reads the new value and moves together.
- **op_graph is projected from the canonical per-layer state**, not from widget-owned
  nodes. Renderer is unchanged except for its input source.
- **Dedup is the point:** two "contrast" views do not stack into two nodes — they share
  one value. Independent stacking of the same effect is done via multiple layers
  (non-goal to support otherwise in early phases).

This subsumes the current optimistic-key inconsistency: optimistic patches are keyed
canonically by `(layer, op, param)` (or the projected node id derived from it), used by
both the canvas shell and any panel.

### 4.C Views: one control system; tools vs AI = chrome only

- A **view** (`widget`) = `{ id, label, origin, reasoning?, controls: Control[] }` where
  `Control = { bind: (op, param_key), control_type, viewLabel?, viewRange? }`. It is a
  curated, presentational surface over canonical params.
- **Control registry:** `slider · toggle · choice · color · curve-editor ·
  levels-histogram · region-picker · mask-thumbnail`. Rich controls (the real curve
  editor from `CurvesPanel`) become a `control_type`, not a separate ProcessingDefinition
  system. The orphaned legacy panels are folded in and removed.
- **Tools vs AI differ only in chrome:** same structure, but `origin = tool_invoked`
  → deterministic → no Refine/Why, no reasoning row. AI views (`mcp_autonomous` /
  `mcp_user_prompt`) keep reasoning + Refine + Why.
  - Concretely: gate the [WidgetShell](../../../src/components/widget/WidgetShell.tsx)
    footer affordances on `origin`.

This directly fixes "Curves spawns one slider" (→ `curve-editor` control) and
"toolstore needs no Refine/Why."

### 4.D Rendering & AI extensibility

- **Rendering:** `canonical layer state → project op_graph → (registry) param→uniform →
  WebGL pipeline → composite`. Minimal change; the renderer reads canonical state and
  uses the registry for uniform mapping instead of hardcoded divisors.
- **AI extends (Phase 4 / compose USP):** `MCP compose → register op (params + shader
  source/binding) → sandbox preview → promote → canonical op like any other`. A promoted
  op gets canonical slots and is controllable by views like the built-ins. Sandbox keeps
  unvetted shaders isolated until promoted.

## 5. Phased Implementation Plan (one spec, staged build)

**Phase 1 — Contract + correctness.** Introduce the shared `engine-registry`. Route
backend defaults, frontend controls, and the pipeline uniform mapping through it. Fix
scales/keys (exposure, kelvin `temp`→`kelvin`, curves). Toolstore views drop Refine/Why.
Unify the optimistic key. **Ship criterion:** dragging a real UI slider visibly changes
the image for every toolstore + AI widget.

**Phase 2 — One control system.** Add the control registry; implement `curve-editor` and
`levels-histogram` as control types; fold in / delete the orphaned ProcessingDefinition
panels; render all views uniformly. **Ship:** Curves spawns a real curve editor.

**Phase 3 — Canonical state + sync.** Introduce per-`(layer, op, param)` canonical state;
project op_graph from it; make `set_param` canonical; dedup views. **Ship:** AI changes
contrast and the Contrast tool's slider moves with it.

**Phase 4 — AI extends the engine.** MCP compose API; register new ops/shaders;
sandbox → promote. **Ship:** the compose USP — AI mints a genuinely new working effect.

## 6. Migration & Compatibility

- The backend stays the values SSoT; the SSE/`op_graph` contract is preserved (Phase 3
  changes the *projection source*, not the wire shape consumed by the renderer).
- `tool_defaults.py` and the `ProcessingDefinition` param lists are replaced by reads
  from the registry; behavior is preserved where it was already correct.
- Each phase is independently shippable and leaves the app working.

## 7. Risks & Open Questions

- **One-instance-per-op constraint** (D1 consequence). Accepted; revisit only if a
  concrete need for same-op stacking on one layer appears. Multi-instance would require a
  richer identity than `(layer, op, param)`.
- **Registry sharing mechanism** (4.A): exact file location + frontend typing approach to
  be fixed in the implementation plan.
- **AI-composed shader safety** (Phase 4): sandboxing/validating generated GLSL before
  promote. Scoped to Phase 4; not blocking 1–3.

## 8. Testing Strategy

- **Registry:** a single test asserting BE and FE resolve identical ranges/scale/keys per
  op (guards against re-drift).
- **Phase 1:** per-op test that a max-range slider value yields a non-trivial pixel delta
  through the real `set_param` → projection → render path (not via direct optimistic
  injection).
- **Phase 3:** test that two views bound to the same `(layer, op, param)` reflect a single
  write (bidirectional sync) and that op_graph projection dedups.
- Continue TDD (red→green) per the repo's existing `npm run check` + backend `pytest`.
