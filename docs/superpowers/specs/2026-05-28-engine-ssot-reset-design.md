# Engine SSoT Reset — design spec

**Date:** 2026-05-28
**Branch:** `feat/canvas-centric-ui` (continuation)
**Status:** Design locked, ready for implementation plan

## 1. Goal

Replace the current tangled state architecture with a single doctrine: **anything that affects pixels lives in the backend snapshot; the frontend is a display + UI-state layer**. Eliminate parallel paths, redundant types, and magic state to make the engine maintainable again.

**In scope:** type unification, state-slice consolidation, single render path, widget lifecycle simplification, file deletions.
**Out of scope:** moving layer metadata to backend, backend-owned undo/redo, brush/text reintroduction, AI prompt-routing changes.

## 2. Problem statement

The current engine has seven architectural failures that compound:

1. **Two `Scope` types with the same name** — `src/types/widget.ts` (backend-mirror) and `src/types/scope.ts` (frontend-invented) define different unions. `widget-projection.ts:62` performs `as unknown as Scope` runtime casts to bridge them.
2. **Two parallel pixel-render paths** — `useAdjustmentPipeline.ts:117–123` combines backend-`operation_graph` nodes with frontend-`layer.adjustmentStack`. Accepting a widget switches the data source, producing visual snaps when the two paths drift.
3. **Six selection-related stores** — `activeScope`, `activeMaskRef`, `activeLayerId`, `useSegmentSelection`, `useFocusedWidget`, `useCursorBindStore` — three of them standalone `create()` stores that cannot be updated atomically together.
4. **Four widget→pixel transformation functions** — `palette-actions`, `widget-projection`, `materialize-adjustments`, `node-to-adjustment`, plus the `selectPipelineNodes` preview path. Each knows the next one's shape only approximately; `materialize-adjustments.ts:31–37` fakes a Node shape with `as unknown as Node`.
5. **Widget filter in `CanvasWidgetLayer.tsx:43–45` contains dead code** — `accepted.has(w.id)` can never matter because `widget.accepted` events remove the widget from the snapshot before that branch is hit (`backend-state-slice.ts:111–113`).
6. **Two registries both called "tool"** — `ToolRegistry` (canvas-interaction tools) and `ToolManifestRegistry` (LLM-facing tools) collide in mental model.
7. **`SessionStateSnapshot` mixes three data models** — Widget (user view), OperationGraph (pipeline view), ImageContext (LLM cache view) — with revision-skew between them requiring manual optimistic-patch invalidation in `backend-state-slice.ts:179–181`.

The user's reported symptoms — "AI suggestion widgets don't appear on canvas" and "adjustments are unreliable" — are downstream of these structural issues, not surface bugs.

## 3. Architectural doctrine

> **The backend `SessionStateSnapshot` is the source of truth for everything that affects pixels. The frontend reads it, displays it, and calls backend tools to mutate it. Frontend stores hold only UI-state and structural layer metadata.**

| Owner | Responsibility |
|---|---|
| Backend `SessionStateSnapshot` | widgets, `operation_graph`, masks, image context, **adjustment data per layer** |
| Frontend `useEditorStore` | layer metadata (id, name, order, visibility, blend, opacity, cropMeta, textMeta, layerMask, parentLayerId), viewport, document meta, history, UI-only state |
| Frontend `pixelStore` / `CanvasRegistry` | Raw source bitmaps per layer |

Concrete consequences:
- Tool-spawned widgets (user clicks "Curves" button) flow through the same backend path as AI-spawned widgets — `backendTools.propose_widget({ origin: 'tool_invoked', layer_id, ... })`. One widget pipeline, one source of truth.
- `layer.adjustmentStack` is removed entirely.
- WebGL pipeline reads only from `snapshot.operation_graph.nodes` filtered by current layer.
- "Accept" no longer materializes — it sets `widget.status = 'accepted'` on the backend; the widget and its nodes stay in the operation graph.

## 4. Type changes

### 4.1 One Scope union

```ts
// src/types/scope.ts (rewritten — replaces both prior definitions)
export type Scope =
  | { kind: 'global' }
  | { kind: 'mask'; mask_id: string }
  | { kind: 'mask:proposed'; label: string }
  | { kind: 'named_region'; label: string };

export function scopeEquals(a: Scope, b: Scope): boolean { /* … */ }
export const GLOBAL_SCOPE: Scope = { kind: 'global' };
```

`src/types/widget.ts` re-exports `Scope` from `scope.ts` to keep backend-mirror imports working. The old `mask:click` variant is renamed to `mask` (clearer). The frontend-only `maskRef` alias and `representativePoint` field are dropped — neither was used outside the file that defined it.

### 4.2 OperationGraph Node carries layer

```ts
// src/types/operation-graph.ts (modified)
export interface Node {
  id: string;
  type: string;
  scope: Scope;
  params: Record<string, number | string | boolean>;
  inputs: string[];
  layer_id: string;  // NEW — which frontend layer this node renders into
}
```

Backend schema (`backend/app/schemas/operation_graph.py`) gets the matching field.

## 5. State changes

### 5.1 New `selection-slice` (replaces 4 stores)

```ts
// src/store/selection-slice.ts (NEW)
export interface SelectionSlice {
  activeScope: Scope;                    // default: { kind: 'global' }
  hoveredScope: Scope | null;            // for outline preview
  cycleStack: CycleStack | null;         // canvas click-cycle state
  focusedWidgetId: string | null;        // for pulse / scroll-into-view
  pendingBind:
    | { kind: 'tool'; toolName: string }
    | { kind: 'suggestion'; widgetId: string }
    | null;

  setActiveScope: (scope: Scope) => void;
  setHoveredScope: (scope: Scope | null) => void;
  clickAt: (imageX: number, imageY: number, candidates: string[]) => void;
  focusWidget: (id: string | null) => void;
  startToolBind: (toolName: string) => void;
  startSuggestionBind: (widgetId: string) => void;
  cancelBind: () => void;
  clear: () => void;
}
```

Deleted:
- `src/store/focus-slice.ts`
- `src/store/segment-selection-slice.ts`
- `src/store/cursor-bind-slice.ts`

Shrunk:
- `src/store/segmentation-slice.ts` keeps only `encoderState` (SAM model loading status); `activeMaskRef`, `committedMaskRef`, `activeScope` are removed (encoded into the new `selection-slice.activeScope`).

### 5.2 Layer slice slim-down

```ts
// src/store/layer-slice.ts (modified)
export interface Layer {
  id: string;
  type: LayerType;
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  locked: boolean;
  order: number;
  textMeta?: TextMeta;
  cropMeta?: CropMeta;
  parentLayerId?: string;
  layerMask?: string;
  // REMOVED: adjustmentStack
}
```

Removed actions: `setAdjustment`, `addAdjustment`, `insertAdjustment`, `removeAdjustment`, `updateAdjustmentMeta`, `updateAdjustmentParams`, `toggleAdjustment`, `reorderAdjustments`, `setActiveScope` (moved to selection-slice).

Kept: `addLayer`, `removeLayer`, `setActiveLayer`, `updateLayer`, `reorderLayers`, `revertAll`, `bumpPixelVersion`.

## 6. Render pipeline change

`useAdjustmentPipeline.ts` simplifies to one source:

```ts
function recompute() {
  const state = useEditorStore.getState();
  const layer = state.layers.find((l) => l.id === state.activeLayerId);
  if (!layer) return;

  const nodes = selectPipelineNodes().filter((n) => n.layer_id === layer.id);
  const adjustments = nodes.map(nodeToAdjustment);

  if (state.editorMode === 'develop' && layer.visible) {
    PipelineManager.setSource(layer.id);
    PipelineManager.requestRender(adjustments);
  } else {
    LayerCompositor.requestComposite();
  }
}

useEditorStore.subscribe(recompute);
useBackendState.subscribe(recompute);
```

`nodeToAdjustment` becomes the single, real conversion point (the `as unknown as Node` cast in `materialize-adjustments` goes away because materialize itself is deleted).

## 7. Widget lifecycle change

### 7.1 Spawn (unified)

Both AI and tool spawns route through the backend:

```ts
// AI spawn (user types in Cmd-K palette or backend autonomous)
backendTools.propose_widget(sessionId, {
  intent, scope, prompt, layer_id, origin: 'mcp_user_prompt' | 'mcp_autonomous',
});

// Tool spawn (user clicks Curves button → cursor-bind drop)
backendTools.propose_widget(sessionId, {
  intent: 'Curves', scope: currentScope, layer_id: activeLayerId,
  origin: 'tool_invoked', fused_tool_id: 'curves',
});
```

Backend returns a Widget. SSE `widget.created` event adds it to snapshot. `CanvasWidgetLayer` renders it from snapshot — no client-side staging.

Tool-spawned widgets are created with `status: 'accepted'` — the user's act of invoking the tool is the accept gesture. AI-spawned widgets are created with `status: 'proposed'` and require an explicit accept (cursor-bind drop or Accept button).

### 7.2 Accept (no more materialize)

```ts
// backend-state-slice.ts → applyEvent('widget.accepted')
case 'widget.accepted': {
  const id = payload.widget_id as string;
  const widget = s.snapshot?.widgets.find((w) => w.id === id);
  if (widget) widget.status = 'accepted';
  break;
}
```

The widget stays in the snapshot. Its op_graph nodes were already being rendered by the pipeline. Accept just changes a status flag that affects the UI (no Accept button shown, different icon, etc.).

### 7.3 Reject / dismiss

`backendTools.delete_widget(sessionId, { widget_id, suppress_similar })` → SSE `widget.deleted` event → backend removes nodes from op_graph → pipeline re-renders without those nodes. Widget marked `status: 'dismissed'` in snapshot for the undo log.

### 7.4 Canvas widget filter — one rule

```ts
// CanvasWidgetLayer.tsx (simplified)
const widgets = (snapshot?.widgets ?? []).filter((w) => w.status !== 'dismissed');
```

All active widgets render on canvas — whether tool-spawned or AI-spawned, accepted or proposed. The right-panel Suggestions section still shows the same widgets, filtered by `status === 'proposed' && origin.kind !== 'tool_invoked'`. No more dead code in the filter.

## 8. Backend contract changes

These are the only backend changes needed. They are small and additive.

| Endpoint / Schema | Change |
|---|---|
| `OperationGraph.Node` schema | Add `layer_id: str` field |
| `propose_widget` input | Add `layer_id: str` and `origin: WidgetOriginKind` to input |
| `propose_widget` handler | Persist nodes with the given `layer_id`; accept `origin: 'tool_invoked'` and skip the LLM call when set (defaults shipped from the tool manifest) |
| `accept_widget` handler | Set `widget.status = 'accepted'`; do NOT remove the widget or its nodes from the snapshot |
| `delete_widget` handler | Set `widget.status = 'dismissed'`; remove the widget's nodes from `operation_graph.nodes` |
| SSE `widget.accepted` event | Payload unchanged; semantics is now status-flip only |

The MCP tool surface (`backend/app/tools/`) is otherwise unchanged.

## 9. Backend-down behavior

When `useBackendState.sseStatus !== 'open'`:

- `BackendStatusBar` shows red "Backend disconnected" with retry button.
- All toolbar buttons disabled (`ToolRegistry.getForMode()` filter checks SSE status).
- ⌘K palette disabled.
- Canvas remains visible at last-rendered state (Fabric image shows last `PipelineManager` output).
- Layers panel disabled — no add/remove/reorder.
- No silent failures, no half-states.

Reconnect resumes from the latest persisted snapshot (loaded via `editorDocument.restoreSession`).

## 10. Migration

Old `.edp` files (session saves) are **dropped** at the format boundary. The serializer's `load()` returns an error if it encounters the old `adjustmentStack` shape; the user gets an "old format unsupported" dialog. No in-app migration code.

This is acceptable because the project is pre-1.0 and no production users hold valuable `.edp` artifacts.

## 11. File-by-file change inventory

### Delete

```
src/lib/materialize-adjustments.ts
src/lib/materialize-adjustments.test.ts
src/lib/widget-projection.ts
src/lib/widget-projection.test.ts
src/lib/scope-match.ts
src/lib/scope-match.test.ts
src/store/focus-slice.ts
src/store/segment-selection-slice.ts
src/store/segment-selection-slice.test.ts
src/store/cursor-bind-slice.ts
src/store/cursor-bind-slice.test.ts
```

### Rewrite

```
src/types/scope.ts                — single Scope union
src/types/widget.ts               — re-export Scope from scope.ts; drop local definition
src/types/operation-graph.ts      — add Node.layer_id
src/store/selection-slice.ts      — NEW (merges focus + segment-selection + cursor-bind)
src/store/segmentation-slice.ts   — shrink to encoderState only
src/store/layer-slice.ts          — drop adjustmentStack + adjustment actions + activeScope
src/store/index.ts                — register selection-slice; drop deleted slices
src/components/widget/CanvasWidgetLayer.tsx — read snapshot directly; one filter rule
src/components/canvas/useAdjustmentPipeline.ts — single recompute path
src/lib/scope-to-mask.ts          — adapt to the renamed mask variant
src/lib/select-pipeline-nodes.ts  — adapt to Node.layer_id (used as filter key)
src/lib/palette-actions.ts        — pass layer_id + origin in propose_widget input
```

### Rename

```
src/lib/tool-registry.ts          → src/lib/canvas-tool-registry.ts (export CanvasToolRegistry)
src/lib/tool-manifest/registry.ts → src/lib/tool-manifest/llm-tool-registry.ts (export LlmToolRegistry)
```

### Backend

```
backend/app/schemas/operation_graph.py     — add Node.layer_id
backend/app/schemas/widget.py              — confirm WidgetOriginKind includes 'tool_invoked'
backend/app/tools/propose_widget.py        — accept layer_id, origin; tool_invoked path skips LLM
backend/app/tools/accept_widget.py         — flip status, don't delete
backend/app/tools/delete_widget.py         — flip status, remove from op_graph
backend/app/state/snapshot.py              — verify status field handling
backend/tests/test_propose_widget.py       — coverage for tool_invoked path
backend/tests/test_accept_widget.py        — coverage for status-flip semantics
```

## 12. Migration plan — 4 phases, 5–8 days

Each phase ends with a green build (`npm run check`) and a manually verified app state. The branch stays on `feat/canvas-centric-ui` — no new branch needed; commits are linear.

### Phase 1 — Type unification (1–2 days)

Goal: One Scope union, no runtime casts.

- Rewrite `src/types/scope.ts` to the new union (see §4.1).
- Update `src/types/widget.ts` to re-export from `scope.ts`.
- Update all imports (mostly mechanical — the `mask:click` → `mask` rename is the only behavioral change).
- Delete `scope-match.ts`; replace callers with direct equality via `scopeEquals`.
- Simplify `scope-to-mask.ts` to the single Scope shape.
- Remove `as unknown as Scope` casts in `widget-projection.ts`.

Exit criteria: lint + typecheck + tests pass, app boots, manual smoke test of "click mask → outline appears" still works.

### Phase 2 — Single render path (2–3 days)

Goal: Backend snapshot owns all adjustment data.

- Backend: add `Node.layer_id` field; persist on `propose_widget`.
- Backend: `accept_widget` flips status, does not remove widget/nodes.
- Backend: `delete_widget` flips status and removes nodes from op_graph.
- Frontend: rewrite `useAdjustmentPipeline.recompute()` to single-source from `selectPipelineNodes().filter(layer_id)` (see §6).
- Frontend: delete `materialize-adjustments.ts` and all `addAdjustment` callers.
- Frontend: drop `Layer.adjustmentStack` field and related slice actions.
- Frontend: repoint all readers of `layer.adjustmentStack` (`LayersSection`, `ActiveSection`, `SuggestionsSection`, `ToolWidgetCard`, `InspectorWidgetRow`, `LayerProperties`, `derived-graph`, session serializer, history capture) to `snapshot.widgets` filtered by `layer_id`. Each call site gets a small `useLayerWidgets(layerId)` helper to keep the read uniform.
- Frontend: update `CanvasWidgetLayer` filter (see §7.4).
- Frontend: `palette-actions.proposeFromPalette` passes `layer_id` from `activeLayerId`.

Exit criteria: drop a Light widget on the canvas, slider drags re-render the image, accept makes the Accept button disappear but pixels unchanged. Delete removes from canvas and unwinds pixels.

### Phase 3 — Selection unification (1–2 days)

Goal: One selection-slice, atomic updates.

- Create `src/store/selection-slice.ts` (see §5.1).
- Register in `src/store/index.ts`.
- Migrate consumers: every `useSegmentSelection`, `useFocusedWidget`, `useCursorBindStore`, `useEditorStore.activeScope` call gets repointed.
- Delete the three obsolete stores.
- Shrink `segmentation-slice.ts` to `encoderState` only.

Exit criteria: click-cycle still works; drop a Curves tool widget via cursor-bind; widget pulse on row-click still works; scope outline still updates.

### Phase 4 — Polish (1 day)

- Rename registries (see §11).
- Delete `widget-projection.ts` (callers read snapshot directly via small inline helpers if needed).
- ESLint clean of all warnings introduced by the cleanup.
- Smoke test: open image → analyze → AI widget appears → drop on canvas → slider works → accept → undo → redo.
- Update CLAUDE.md to reflect the simplified architecture.

Exit criteria: `npm run check` clean, manual smoke test passes, no console warnings.

## 13. Open risks

| Risk | Mitigation |
|---|---|
| Backend `propose_widget` LLM call latency for `tool_invoked` widgets feels slow | Tool-invoked path skips the LLM entirely; backend ships defaults from the tool manifest |
| Pipeline re-renders on every backend SSE event become a perf hit | `selectPipelineNodes` already memoizes on the `optimistic` map size + revision; should be cheap, but profile in Phase 2 |
| Old session-restore code references `adjustmentStack` | Phase 2 also removes restore-side deserialization; old `.edp` files emit a clear error dialog |
| `Node.layer_id` migration in existing backend snapshots | Pre-1.0 — drop in-memory state, re-analyze image to get new snapshot |

## 14. Out of scope (post-cleanup work)

These are good follow-ups but explicitly deferred to keep this spec focused:

- Moving layer structural metadata (id, order, blend mode) to backend.
- Backend-owned undo/redo (snapshot revision walking).
- Brush / brush-mask reintroduction.
- Graph-mode workspace re-enablement.
- Crop into the backend op_graph (currently still frontend-side via `cropMeta`).
- Performance profiling of the unified pipeline under heavy slider drag.

## 15. Success criteria

The cleanup is done when:

1. `npm run check` is clean (0 errors, 0 warnings in `src/`).
2. There is exactly one `Scope` type and one selection store.
3. The WebGL pipeline reads from exactly one source.
4. A new "fix the widget-doesn't-show bug" task takes <1 hour because the code path is obvious.
5. CLAUDE.md's "store separation" and "registry" sections accurately describe the code.
