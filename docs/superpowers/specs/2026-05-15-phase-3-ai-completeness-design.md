# Phase 3 — AI Completeness — Design Spec

**Date:** 2026-05-15
**Author:** Anton Rockenstein
**Status:** Draft — awaiting user review
**Scope:** Implementation of Phase 3 from the thesis prototype plan (`docs/superpowers/specs/2026-05-11-thesis-prototype-implementation-design.md` §4 Phase 3). Covers backend `/api/refine`, AI adjustment provenance, multi-panel coexistence finalisation, refine + reset UX, reasoning-badge enrichment, and cache-hit verification. Out of scope: SAM / regions (Phase 4), comparison view + branching UI (Phase 5), polish (Phase 6).

---

## 1. Context

Phase 1 delivered the thin AI slice: backend with `/api/session`, `/api/analyze`, `/api/panel`; frontend Cmd+K palette; the `ai-panel` layer type with `operationGraph` + `panelBindings`; the `ReasoningBadge` primitive; the two-region inspector layout. Phase 2 rebuilt history as a tree, persisted through `.edp` v2 and IndexedDB.

Phase 3 finishes the AI surface so the thesis's T2 and T3 commitments are present in code: multi-panel coexistence, AI provenance on every adjustment, three revert granularities working independently, refine end-to-end, reset-to-suggestion, and verified prompt-cache reuse.

What already exists (do not rebuild):

- `OperationGraph` types + Zod schema (`src/types/operation-graph.ts`, `src/lib/operation-graph-schema.ts`).
- `materializePanel` creates a new `ai-panel` layer per call (it does NOT overwrite — multi-panel coexistence is already structurally supported).
- `AiPanelSection` renders bindings via `BindingRow` with `ReasoningBadge` per binding.
- Backend `/api/refine` is a 501 stub.
- `AdjustmentSlider` double-click resets to `defaultValue` (granularity 1 of three).
- LayersPanel exposes per-layer visibility toggle (granularity 2).
- Tree-history undo via Cmd+Z (granularity 3).

What is missing:

- Real `/api/refine` endpoint + frontend client method.
- `aiSource` provenance on `Adjustment` records (round-trips through history + `.edp` + session).
- Adjustments are not materialised at panel creation time — they appear lazily on first slider touch, which complicates provenance and history.
- `AiPanelSection` has no header — no refine, no reset-to-suggestion affordance.
- `ReasoningBadge` tooltip shows only `reasoning`; model name+version+timestamp from `aiSource` are not surfaced.
- Cache-control markers are not instrumented; ≥80% cache-hit verification is unproven.

---

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Refine is triggered by a **"Refine…" button** in the new `AiPanelSection` header — not by a Cmd+K mode or a global shortcut | Layer-scoped action; visible affordance is more discoverable than a hidden palette mode. |
| D2 | "Reset to model suggestion" lives as a **rewind icon next to the Refine button** in the panel header | Clusters AI-specific verbs in one spot; per-slider reset is already covered by double-click. |
| D3 | `aiSource` provenance is attached to **every adjustment at panel-creation time**, not lazily on first slider touch | Immutable from creation; predictable for history snapshots; no special-case "lazy materialisation" rule. Adjustments are synthesised with the model's defaults. |
| D4 | Cache-hit-rate is verified via **backend stdout logs of `cache_creation_input_tokens` + `cache_read_input_tokens`**, plus a **structural unit test** asserting `cache_control` markers are on the right prompt segments | Spec asks for verification, not visibility. Logging + structural test confirms wiring; the threshold is a one-time manual check, not a permanent UI feature. |
| D5 | On refine accept, a **new sibling `ai-panel` layer is created above the original**; the original is untouched. No preview / staging step | Matches the spec's "new layer created on accept" verbatim; non-destructive; supports the thesis's "multiple coexisting proposals" claim; minimal UI surface. |
| D6 | Frontend retries are **not** added for refine failures — user re-clicks the button | Manually-triggered action; backend already retries Pydantic validation up to twice (Phase 1 policy). |

---

## 3. Architecture

Four concerns layered onto Phase 1+2:

1. **Backend gains a real `/api/refine` and cache instrumentation.** Same Claude+Pydantic+cache-control pipeline as `/api/panel`. The prompt includes the prior graph as text plus the user's refinement instruction. Session store gains an in-memory `graphs: dict[str, OperationGraph]` so refine can recall the proposal verbatim. The Anthropic client logs cache hit/read tokens; a structural unit test asserts `cache_control` is on the system+image+context prefix for both panel and refine paths.

2. **Frontend `ai-client.ts` gains `refinePanel(sessionId, priorGraphId, instruction)`.** Returns a new `OperationGraph`. Caller (the AI panel header) materialises it as a new sibling `ai-panel` layer above the original.

3. **AI panels become "fully materialised at creation":** `materializePanel(graph)` not only stores `operationGraph` + `panelBindings` on the new layer, it also synthesises one `Adjustment` per panel-binding's `nodeId` at the model's defaults, each carrying an `aiSource: { graphId, nodeId, label, reasoning, modelName, modelVersion, generatedAt }`. The user touching a slider mutates an existing adjustment instead of creating a new one. Provenance is immutable from creation and history-correct.

4. **`AiPanelSection` gets a header bar** (`AiPanelHeader`, level-2 component). Two affordances: **Refine…** (toggles an inline text input → calls `refinePanel` → creates a new sibling layer on success) and **Reset to suggestion** (walks the layer's adjustments and restores each to its binding default, recorded as one undoable step). `ReasoningBadge` is enriched with model name+version+timestamp from the binding's source adjustment's `aiSource`.

---

## 4. Component Inventory

### Backend (new + modified)

| Path | Status | Responsibility |
|---|---|---|
| `backend/app/services/session_store.py` | Modify | Add `graphs: dict[str, OperationGraph]` per session; `store_graph(session_id, graph)`, `get_graph(session_id, graph_id)`. |
| `backend/app/services/panel_generator.py` | Create | Extract `/api/panel`'s Claude-call logic from `app/api/panel.py` into a reusable service. Refine reuses the cache-prefix construction. |
| `backend/app/services/refine_generator.py` | Create | Composes prompt `[system, image, context, prior_graph_json, instruction]` with `cache_control` on the first three blocks. Calls Claude → Pydantic-validates (≤2 retries) → returns `OperationGraph`. |
| `backend/app/api/panel.py` | Modify | Refactor to call `panel_generator`; store returned graph in session.graphs. |
| `backend/app/api/refine.py` | Replace | Replace 501 stub: load session, load prior graph, dispatch to `refine_generator`, store new graph, return it. |
| `backend/app/services/anthropic_client.py` | Modify | After every Messages call, log `{call: 'panel'|'refine', session_id, cache_creation_input_tokens, cache_read_input_tokens, total_input_tokens}` to stdout as JSON. |
| `backend/tests/test_refine.py` | Create | Endpoint tests (happy, 404 session, 404 graph, 400 instruction, 502 Claude, Pydantic-retry path). |
| `backend/tests/test_cache_markers.py` | Create | Unit test asserting `cache_control` markers on system+image+context prompt blocks for both panel and refine paths. |

### Frontend (new + modified)

| Path | Status | Responsibility |
|---|---|---|
| `src/types/ai-source.ts` | Create | `AiSource` interface. |
| `src/store/layer-slice.ts` | Modify | Add `aiSource?: AiSource` to `Adjustment`. |
| `src/store/ai-panel-actions.ts` | Modify | `materializePanel(graph)` synthesises adjustments + provenance; new `materializeRefinedPanel(priorLayerId, graph)` inserts above the prior layer; new `resetPanelToSuggestion(layerId)` walks the layer's adjustments and restores defaults. |
| `src/store/ai-panel-actions.test.ts` | Create | Vitest unit tests on materialise + refined-materialise + reset semantics. |
| `src/lib/ai-client.ts` | Modify | Add `refinePanel(sessionId, priorGraphId, instruction): Promise<OperationGraph>`. |
| `src/components/inspector/AiPanelHeader.tsx` | Create | Level-2 component. Refine button (toggles inline input) + Reset button (rewind icon). |
| `src/components/inspector/AiPanelSection.tsx` | Modify | Render `AiPanelHeader` above the bindings. |
| `src/components/ui/ReasoningBadge.tsx` | Modify | Accept `modelName`, `modelVersion`, `generatedAt` props; render in tooltip below reasoning. |
| `src/components/ui/Toast.tsx` | Create-if-missing | Primitive toast. Only build if Phase 1 didn't already; verify before Plan phase. |
| `src/core/serializer.ts` | Modify | Round-trip `aiSource` on adjustments via existing serialize/deserialize loop. |
| `src/core/session-storage.ts` | Modify | Same — `aiSource` survives session reload. |

### Spec-mandated and intentionally NOT modified

- `src/core/history.ts` / `history-tree.ts` — adjustments-with-provenance round-trip through existing snapshot machinery (provenance is just another field).
- `src/components/panels/LayersPanel.tsx` — visibility toggle already handles the "hide panel" revert granularity.
- `src/components/inspector/AdjustmentSlider.tsx` — double-click reset already handles the "single control" revert granularity.

---

## 5. Data Flow

### Panel creation (existing, refined)

```
Cmd+K "make it warmer"
  → POST /api/panel { sessionId, goal }
  → backend: load image+context from session (cached prefix), call Claude
  → backend: structured tool output → OperationGraph (Pydantic validated)
  → backend: session_store.store_graph(sessionId, graph)
  → backend: log {cache_create, cache_read}; return graph
  → frontend: materializePanel(graph)
  → new ai-panel layer with:
       layer.operationGraph    = graph (immutable proposal)
       layer.panelBindings     = graph.panelBindings
       layer.adjustmentStack   = [{ id, type: node.type,
                                    params: { [binding.paramKey]: binding.default,
                                              … (other params from binding defaults
                                                  on the same node, if any) },
                                    aiSource: { graphId: graph.id,
                                                nodeId: node.id,
                                                label: binding.label,
                                                reasoning: binding.reasoning,
                                                modelName: metadata.modelName,
                                                modelVersion: metadata.modelVersion,
                                                generatedAt: metadata.generatedAt } }
                                  for each node in graph.nodes ]
       layer.order             = topmost
```

> Note: one adjustment per `OperationGraph.Node`. Multiple `PanelBinding`s targeting the same `nodeId` share one adjustment; their `paramKey`s become keys in that adjustment's `params`. `aiSource.label` carries the *first* binding's label for that node (good enough for the tooltip; the full per-binding labels live on `panelBindings`).

### Refine (new)

```
User clicks "Refine…" on AiPanelHeader (layerId)
  → input shown inline, user types "more subtle", presses Enter
  → frontend: aiClient.refinePanel(sessionId, priorGraphId=layer.operationGraph.id, instruction)
  → POST /api/refine { sessionId, priorGraphId, instruction }
  → backend: load session, load graph by id (404 if absent)
  → backend: build prompt [system, image, context, prior_graph_json, instruction]
  → backend: cache_control on first three blocks
  → backend: Claude → new OperationGraph → store + return
  → frontend: materializeRefinedPanel(priorLayerId, newGraph)
  → new ai-panel layer inserted at order = priorLayer.order + 1
  → original ai-panel layer untouched
```

### Reset to suggestion

```
User clicks rewind icon on AiPanelHeader (layerId)
  → editorDocument.recordAction("Reset to suggestion", () => {
       for each adjustment in layer.adjustmentStack:
         for each binding where binding.nodeId === adjustment.aiSource?.nodeId:
           adjustment.params[binding.paramKey] = binding.default
     })
  → single undoable step recorded by the existing 250 ms action-debouncer
```

### Three revert granularities

| Granularity | Affordance | Mechanism |
|---|---|---|
| Single control | Double-click slider | `AdjustmentSlider` `resetValue` (Phase 1) |
| Whole panel — values | Header rewind button | `resetPanelToSuggestion(layerId)` |
| Whole panel — visibility | LayersPanel visibility toggle | `layer.visible = false` (existing) |
| History | Cmd+Z | Tree.undo via Phase 2 |

The spec called for three; "values" and "visibility" are distinct meaningful actions. Both already have mechanisms — Phase 3 adds the values reset; visibility is just verified.

---

## 6. Error Handling

### Backend `/api/refine`

| Failure | Response | Frontend reaction |
|---|---|---|
| `sessionId` unknown / expired | `404 {detail: "session not found"}` | Toast: "Session expired. Re-open the image." |
| `priorGraphId` not in session.graphs | `404 {detail: "prior graph not found"}` | Toast: "Couldn't find the panel to refine." (rare; defensive) |
| Claude call throws (network/auth) | `502 {detail: "model unreachable"}` | Toast: "Refine failed. Try again." |
| Pydantic validation fails on Claude output | Retry ≤2 times; if still failing → `502 {detail: "model returned invalid graph"}` | Toast: "Refine failed. Try again." |
| `instruction` empty / >500 chars | `400 {detail: "instruction must be 1–500 chars"}` | Inline validation in the refine input — don't even POST |

### Frontend `materializePanel`

Validates the returned graph with the existing Zod schema (Phase 1). On Zod failure → toast "AI response invalid"; no layer created. For refine specifically, the original layer stays untouched.

### Reset to suggestion

Pure local, no backend. Wrapped in `editorDocument.recordAction(…)` so it's one undoable step.

### Cache instrumentation

Cache-token counts are observational. If the response lacks them (e.g. anthropic SDK change), log a warning, don't fail the call.

### No frontend retries

If `/api/refine` fails, the user re-clicks the button.

### Toast primitive availability

If `src/components/ui/Toast.tsx` doesn't exist at plan-writing time, the plan adds it as a tiny primitive (Radix-less, level: `ui/`): a single absolute-positioned `<div>` with `framer-motion` enter/exit, dismissed after 4 s, queue length 1 (newer replaces older). Driven by a `useToast` hook backed by a tiny module-level store. To be confirmed in the plan.

---

## 7. Testing

### Backend (`backend/tests/`)

- `test_refine.py` — happy path with mocked Anthropic client: post `{sessionId, priorGraphId, instruction}`, assert 200 + valid `OperationGraph` body, assert prior graph was loaded from session, assert new graph stored under its own ID.
- `test_refine.py` — error paths: 404 on missing session, 404 on missing graph, 400 on empty/oversize instruction, 502 on Claude exception.
- `test_refine.py` — Pydantic-retry path: mock returns 2 invalid graphs then a valid one → 200; mock returns 3 invalid → 502.
- `test_cache_markers.py` — unit test on the prompt-builder helpers (panel + refine): assert system+image+context blocks carry `cache_control: {"type": "ephemeral"}` and that subsequent blocks (goal, prior-graph, instruction) do NOT. No real Claude call.

### Frontend (`src/store/ai-panel-actions.test.ts`, new)

- `materializePanel(graph)` produces a layer whose adjustments carry `aiSource` with the right `nodeId`, `label`, `reasoning`, `graphId` from the input graph. One adjustment per `Node`; param keys merged.
- `materializeRefinedPanel(priorLayerId, graph)` inserts at `priorLayer.order + 1`; original layer untouched.
- `resetPanelToSuggestion(layerId)` restores each adjustment param to its binding default; non-AI adjustments left alone (defensive — shouldn't be present on an `ai-panel` layer, but the test pins the contract).

No DOM-rendered tests for `AiPanelHeader` — the component is exercised by the manual smoke. (Phase 6 polish could add `happy-dom`-backed tests if needed.)

### Manual smoke checklist (user-driven, at phase exit)

- [ ] Open image, wait for "analysing → ready" pill.
- [ ] Cmd+K "make it warmer" → panel appears with reasoning badges on each control. Hover any badge: shows reasoning + model name + version + timestamp.
- [ ] Drag a slider; image updates. Cmd+Z reverts to model defaults. Cmd+Shift+Z restores.
- [ ] Toggle layer visibility in LayersPanel → image flips between "with suggestion" and "without".
- [ ] Click rewind on panel header → all sliders snap to defaults in one undoable step.
- [ ] Click Refine, type "more subtle" → new panel layer appears above the original; both visible; both editable; both togglable.
- [ ] Cmd+K "darken the background" → second AI suggestion appears as a third panel. All three coexist.
- [ ] Save `.edp`, reload, open: `aiSource` survives on every adjustment; reasoning tooltips still show model identity.
- [ ] Backend log: 5 sequential `/api/panel` calls in one session show `cache_read_input_tokens > 0` on calls 2–5 (≥80 % ratio).

### Spec exit-criteria mapping (§4 P3)

| Spec exit criterion | Covered by |
|---|---|
| Two AI panels visible simultaneously; toggling each changes the image | Smoke check (toggle, second Cmd+K) |
| Hover any AI control: tooltip shows reasoning + model identity | Smoke check (hover badge) |
| Reset-control / hide-panel / undo all work and do different things | Smoke check (rewind, visibility, Cmd+Z) |
| Cache-hit rate ≥80 % across 5 sequential panel requests | Backend log + smoke check |
| `npm run check` passes | CI gate |

---

## 8. Types

### `AiSource` (new, `src/types/ai-source.ts`)

```ts
export interface AiSource {
  /** ID of the OperationGraph that produced this adjustment. */
  graphId: string;
  /** ID of the node within the graph (1:1 with adjustment). */
  nodeId: string;
  /** User-facing label from the first binding targeting this node. */
  label: string;
  /** Optional reasoning string from the binding (preferred) or graph. */
  reasoning?: string;
  /** Model identity for the tooltip. */
  modelName: string;
  modelVersion: string;
  /** ISO timestamp from the OperationGraph metadata. */
  generatedAt: string;
}
```

### `Adjustment` extension (`src/store/layer-slice.ts`)

```ts
export interface Adjustment {
  // ... existing fields ...
  aiSource?: AiSource;
}
```

`aiSource` is optional — non-AI adjustments (manual `Light`/`Color`/etc) have no source. AI-panel adjustments always have one.

### Backend Pydantic mirror (`backend/app/schemas/ai_source.py` — created as part of the panel/refine output)

Already covered transitively: `OperationGraph.metadata` carries `modelName` / `modelVersion` / `generatedAt`. The frontend reads from `metadata` and pins it onto each `aiSource`. No new backend schema needed — the existing `OperationGraph` schema already has the fields.

---

## 9. Out of Scope (Explicit)

- SAM / region-aware edits — Phase 4.
- Branching UI / split-canvas comparison — Phase 5.
- Milestone-naming UI — Phase 5.
- `OffscreenCanvas` migration, WebP snapshot encoding, performance tuning — Phase 6.
- IndexedDB / DOM integration tests for `editorDocument.undo/redo` — Phase 6 if needed.
- Multi-language UI / localisation — out of thesis scope.

---

## 10. Open Items

- **Toast primitive existence:** confirm at plan-writing time whether `src/components/ui/Toast.tsx` exists from Phase 1. If yes, reuse; if no, plan adds a tiny primitive (see §6).
- **`AdjustmentSlider` double-click reset confirmation:** verified by code inspection (`AdjustmentSlider.tsx:31,105` — `resetValue` falls back to midpoint when `defaultValue` is undefined). `AiPanelSection` passes `defaultValue={binding.default}` → so the reset target matches the model's suggestion for that single control. Good.
- **Refine input UX:** plan to use an inline `<input>` in the header that grows from a small chip on click; Esc cancels, Enter submits. Final styling decided during implementation (token-based, no new motion curves).
