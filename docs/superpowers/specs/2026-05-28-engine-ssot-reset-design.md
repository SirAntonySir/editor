# Engine SSoT Reset — design spec

**Date:** 2026-05-28
**Branch:** `feat/canvas-centric-ui` (continuation)
**Status:** Design locked (revised for MVP scope), ready for implementation plan

## 1. Goal

Two goals, in priority order:

1. **MVP strip** — delete everything not on the critical path for the thesis demo: graph editor, `.edp` save/load, IndexedDB session auto-save, complex history tree, text tool, crop tool, brush variants. Keep one image layer + AI-driven adjustment widgets + export.
2. **Single source of truth** — make the backend `SessionStateSnapshot` the only source for anything that affects pixels. Eliminate the seven architectural failures diagnosed in §2 (parallel Scope types, parallel render paths, six selection stores, four widget→pixel transforms, dead widget filter, naming collision, three data models in one snapshot).

**In scope:** strip + type unification + state consolidation + single render path + widget lifecycle simplification.
**Out of scope:** thesis control condition (non-AI mode), brush/text reintroduction, .edp project files, multi-layer UI, graph mode.

## 2. Problem statement

The current engine has seven architectural failures that compound:

1. **Two `Scope` types with the same name** — `src/types/widget.ts` (backend-mirror) and `src/types/scope.ts` (frontend-invented) define different unions. `widget-projection.ts:62` performs `as unknown as Scope` runtime casts to bridge them.
2. **Two parallel pixel-render paths** — `useAdjustmentPipeline.ts:117–123` combines backend-`operation_graph` nodes with frontend-`layer.adjustmentStack`. Accepting a widget switches the data source, producing visual snaps when the two paths drift.
3. **Six selection-related stores** — `activeScope`, `activeMaskRef`, `activeLayerId`, `useSegmentSelection`, `useFocusedWidget`, `useCursorBindStore` — three of them standalone `create()` stores that cannot be updated atomically together.
4. **Four widget→pixel transformation functions** — `palette-actions`, `widget-projection`, `materialize-adjustments`, `node-to-adjustment`, plus the `selectPipelineNodes` preview path. Each knows the next one's shape only approximately; `materialize-adjustments.ts:31–37` fakes a Node shape with `as unknown as Node`.
5. **Widget filter in `CanvasWidgetLayer.tsx:43–45` contains dead code** — `accepted.has(w.id)` can never matter because `widget.accepted` events remove the widget from the snapshot before that branch is hit (`backend-state-slice.ts:111–113`).
6. **Two registries both called "tool"** — `ToolRegistry` (canvas-interaction tools) and `ToolManifestRegistry` (LLM-facing tools) collide in mental model.
7. **`SessionStateSnapshot` mixes three data models** — Widget (user view), OperationGraph (pipeline view), ImageContext (LLM cache view) — with revision-skew between them requiring manual optimistic-patch invalidation in `backend-state-slice.ts:179–181`.

Layered on top: **scope creep** — graph mode, `.edp` files, IndexedDB persistence, text/crop/brush tools, complex history all eat maintenance budget without serving the thesis demo. Stripping them is the largest single quality-of-life improvement.

The user's reported symptoms — "AI suggestion widgets don't appear on canvas" and "adjustments are unreliable" — are downstream of these structural issues, not surface bugs.

## 3. Architectural doctrine

> **The backend `SessionStateSnapshot` is the source of truth for anything that affects pixels. The frontend reads it, displays it, and calls backend tools to mutate it. All widget spawns — user prompt, autonomous, tool-invoked — go through `backendTools.propose_widget`. One engine.**

| Owner | Responsibility |
|---|---|
| Backend `SessionStateSnapshot` | widgets, `operation_graph`, masks, image context, **adjustment data per layer** |
| Frontend `useEditorStore` | layer metadata (id, name, order, visibility, blend, opacity, layerMask, parentLayerId), viewport, document meta, simple linear undo stack, UI-only state |
| Frontend `pixelStore` / `CanvasRegistry` | Raw source bitmaps per layer |

Three spawn paths, one backend call:

```ts
// 1. Cmd+K palette (user types a prompt)
backendTools.propose_widget(sid, {
  intent: text, scope: activeScope, prompt: text, layer_id: activeLayerId,
  origin: 'mcp_user_prompt',
});

// 2. Autonomous analyze (backend mints suggestions on its own)
// Triggered by the analyze phase server-side; no frontend call.

// 3. Toolrail button (user clicks Curves / Light / etc.)
backendTools.propose_widget(sid, {
  intent: 'Curves', scope: activeScope, layer_id: activeLayerId,
  origin: 'tool_invoked', fused_tool_id: 'curves',
});
```

Tool-invoked widgets are created with `status: 'accepted'` (the click is the accept) and skip the LLM call — the backend ships defaults from the tool manifest. AI widgets are created with `status: 'proposed'`.

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

`src/types/widget.ts` re-exports `Scope` from `scope.ts`. The old `mask:click` variant is renamed to `mask`. The frontend-only `maskRef` alias and `representativePoint` field are dropped.

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
  activeScope: Scope;
  hoveredScope: Scope | null;
  cycleStack: CycleStack | null;
  focusedWidgetId: string | null;
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

Deleted: `focus-slice.ts`, `segment-selection-slice.ts`, `cursor-bind-slice.ts`.
Shrunk: `segmentation-slice.ts` keeps only `encoderState`.

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
  parentLayerId?: string;  // kept for future AI-segment-as-layer flow
  layerMask?: string;
  // REMOVED: adjustmentStack, textMeta, cropMeta
}
```

Removed actions: every `*Adjustment*` action, `setActiveScope`. The slice becomes structural-only.

### 5.3 Simple linear undo

Replace `history.ts` + `history-tree.ts` + `transaction.ts` (~600 LOC) with a single linear stack (~80 LOC):

```ts
// src/core/history.ts (rewritten)
type Snapshot = SerializableState;
const stack: Snapshot[] = [];
let cursor = -1;
const MAX = 20;

function push(snap: Snapshot): void {
  stack.splice(cursor + 1);  // drop redo tail
  stack.push(snap);
  if (stack.length > MAX) stack.shift();
  cursor = stack.length - 1;
}
function undo(): Snapshot | null { /* return stack[--cursor] */ }
function redo(): Snapshot | null { /* return stack[++cursor] */ }
function clear(): void { stack.length = 0; cursor = -1; }
```

No pixel-blob snapshots, no destructive transactions, no debounced action groups (the slider drags through the backend's `set_widget_param` already coalesce on revision boundaries).

## 6. Render pipeline change

`useAdjustmentPipeline.ts` simplifies to one source:

```ts
function recompute() {
  const state = useEditorStore.getState();
  const layer = state.layers.find((l) => l.id === state.activeLayerId);
  if (!layer) return;

  const nodes = selectPipelineNodes().filter((n) => n.layer_id === layer.id);
  const adjustments = nodes.map(nodeToAdjustment);

  if (layer.visible) {
    PipelineManager.setSource(layer.id);
    PipelineManager.requestRender(adjustments);
  }
}

useEditorStore.subscribe(recompute);
useBackendState.subscribe(recompute);
```

`nodeToAdjustment` becomes the single, real conversion point. Compose mode + multi-layer compositor stay in code (single-layer MVP doesn't exercise them, but the path is intact for future re-enable).

## 7. Widget lifecycle change

### 7.1 Spawn (unified — three call sites, one path)

All spawns go through `backendTools.propose_widget(sid, ...)`. See §3 for the three call shapes.

Backend returns a Widget. SSE `widget.created` event adds it to snapshot. `CanvasWidgetLayer` renders it from snapshot — no client-side staging.

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

The widget stays in the snapshot. Its op_graph nodes were already being rendered. Accept just flips a status flag that affects the UI (no Accept button shown).

### 7.3 Reject / dismiss

`backendTools.delete_widget(sid, { widget_id, suppress_similar })` → SSE `widget.deleted` → backend removes nodes from op_graph → pipeline re-renders without them. Widget marked `status: 'dismissed'` in snapshot for the undo log.

### 7.4 Canvas widget filter — one rule

```ts
// CanvasWidgetLayer.tsx (simplified)
const widgets = (snapshot?.widgets ?? []).filter((w) => w.status !== 'dismissed');
```

All active widgets render on canvas. The right-panel Suggestions section shows the same widgets filtered by `status === 'proposed' && origin.kind !== 'tool_invoked'`.

## 8. Backend contract changes

| Endpoint / Schema | Change |
|---|---|
| `OperationGraph.Node` schema | Add `layer_id: str` field |
| `propose_widget` input | Add `layer_id: str` and `origin: WidgetOriginKind` |
| `propose_widget` handler | Persist nodes with the given `layer_id`; accept `origin: 'tool_invoked'` and skip the LLM call when set (defaults shipped from the tool manifest) |
| `accept_widget` handler | Set `widget.status = 'accepted'`; do NOT remove from snapshot |
| `delete_widget` handler | Set `widget.status = 'dismissed'`; remove the widget's nodes from `operation_graph.nodes` |

The MCP tool surface (`backend/app/tools/`) is otherwise unchanged.

## 9. Backend-down behavior

When `useBackendState.sseStatus !== 'open'`:

- `BackendStatusBar` shows red "Backend disconnected" with retry button.
- All toolrail buttons disabled.
- Cmd+K palette disabled.
- Canvas remains visible at last-rendered state.
- Layers panel disabled.
- No silent failures, no half-states.

Reconnect resumes from `/api/sessions/<id>` if still alive, otherwise prompts the user to "Re-analyze image".

## 10. Migration

Old `.edp` files are **gone** at this commit. The `Save` / `Save As` menu items are removed. The only persistence is "Export as PNG/JPG". Sessions are not auto-saved across reloads.

This is acceptable because the project is pre-1.0 and the thesis demo can start from a freshly loaded image each time.

## 11. File-by-file change inventory

### Delete — MVP strip

```
# Graph editor
src/components/graph/                                  # entire folder
src/core/derived-graph.ts
src/store/graph-store.ts
# remove @xyflow/react + elkjs from package.json

# .edp save / load + IndexedDB
src/core/serializer.ts
src/core/serializer.test.ts
src/core/session-storage.ts
src/core/transaction.ts
src/core/history-tree.ts
src/core/history-tree.test.ts

# Crop
src/lib/crop-display.ts
src/lib/crop-rect.ts
src/lib/crop-utils.ts
src/store/crop-editing-slice.ts
src/components/canvas/CropOverlay.tsx
src/tools/crop-tool.tsx

# Text
src/tools/text-tool.tsx
# TextMeta interface in layer-slice — drop field

# Brush + leftover tools
src/tools/brush-tool.tsx
src/tools/brush-mask-tool.tsx
src/tools/select-box-tool.ts
src/hooks/useSegmentInteraction.ts  # only if its callers are all dropped — verify
```

### Delete — SSoT cleanup

```
src/lib/materialize-adjustments.ts
src/lib/materialize-adjustments.test.ts
src/lib/widget-projection.ts
src/lib/widget-projection.test.ts
src/lib/scope-match.ts
src/lib/scope-match.test.ts
src/store/focus-slice.ts
src/store/focus-slice.test.ts
src/store/segment-selection-slice.ts
src/store/segment-selection-slice.test.ts
src/store/cursor-bind-slice.ts
src/store/cursor-bind-slice.test.ts
```

### Rewrite

```
src/types/scope.ts                — single Scope union
src/types/widget.ts               — re-export Scope; drop local definition
src/types/operation-graph.ts      — add Node.layer_id
src/store/selection-slice.ts      — NEW (merges focus + segment-selection + cursor-bind)
src/store/segmentation-slice.ts   — shrink to encoderState only
src/store/layer-slice.ts          — drop adjustmentStack, textMeta, cropMeta, activeScope, every *Adjustment* action
src/store/index.ts                — register selection-slice; drop deleted slices
src/store/tool-slice.ts           — drop 'compose' and 'graph' from EditorMode; keep only 'develop'
src/core/history.ts               — rewrite as linear stack (~80 LOC)
src/core/document.ts              — drop save/saveAs/openEdp/restoreSession/transactions; keep init/openImage/export/undo/redo
src/core/session-storage.ts       — DELETE (entry above)
src/components/widget/CanvasWidgetLayer.tsx — single filter rule, read snapshot directly
src/components/canvas/useAdjustmentPipeline.ts — single recompute path
src/components/toolbar/MenuBar.tsx — drop Save/Save As/Open EDP entries
src/components/toolbar/Toolbar.tsx — keep, but only renders the 6 adjustment buttons + Cmd+K hint
src/lib/scope-to-mask.ts          — adapt to the renamed mask variant
src/lib/select-pipeline-nodes.ts  — adapt to Node.layer_id (used as filter key)
src/lib/palette-actions.ts        — pass layer_id + origin in propose_widget input
src/App.tsx                       — drop crop/text/brush/graph imports, registrations, mounts
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
backend/app/tools/propose_widget.py        — accept layer_id, origin; tool_invoked path skips LLM, ships manifest defaults
backend/app/tools/accept_widget.py         — flip status, don't delete
backend/app/tools/delete_widget.py         — flip status, remove from op_graph
backend/app/state/snapshot.py              — verify status field handling
backend/tests/test_propose_widget.py       — coverage for tool_invoked path
backend/tests/test_accept_widget.py        — coverage for status-flip semantics
```

## 12. Migration plan — 5 phases, ~5 days

Each phase ends with a green build (`npm run check`) and a manually verified app state. The branch stays on `feat/canvas-centric-ui`.

### Phase 1 — MVP strip (1 day)

Goal: Pure deletes. Smallest viable codebase.

- Delete every file in the "MVP strip" delete list (§11).
- Update `App.tsx` to drop crop/text/brush/graph imports + tool registrations + mounted overlays.
- Update `MenuBar.tsx` to drop Save / Save As / Open EDP menu entries.
- Update `document.ts` to drop save/saveAs/openEdp/restoreSession/transactions (the methods become no-ops or are removed; callers updated).
- Drop `@xyflow/react` + `elkjs` + `fflate` (only used by the EDP zipper) from `package.json`, re-`npm install`.
- Replace `history.ts` with the linear stack rewrite.
- Drop `TextMeta` and `CropMeta` fields from layer-slice.
- Drop `EditorMode` non-`'develop'` values.

Exit criteria: lint + typecheck + tests pass, app boots, image opens, slider drags work via the old layer.adjustmentStack path. (Phase 2 will move adjustments to backend.)

### Phase 2 — Type unification (1 day)

Goal: One Scope, no runtime casts.

- Rewrite `src/types/scope.ts` to the new union (§4.1).
- Update `src/types/widget.ts` to re-export from `scope.ts`.
- Update all imports (the `mask:click` → `mask` rename is the only behavioral change).
- Delete `scope-match.ts`; replace callers with `scopeEquals`.
- Simplify `scope-to-mask.ts` to the single Scope shape.
- Remove `as unknown as Scope` casts in `widget-projection.ts` (file will be deleted in Phase 3 — just clean for now).

Exit criteria: lint + typecheck + tests pass, app boots, manual smoke: "click mask → outline appears" still works.

### Phase 3 — Backend SSoT for adjustments (2 days)

Goal: One render path. `layer.adjustmentStack` deleted. Backend owns all adjustment data.

- Backend: add `Node.layer_id` field; persist on `propose_widget`.
- Backend: `accept_widget` flips status, does not remove.
- Backend: `delete_widget` flips status, removes nodes from op_graph.
- Backend: `propose_widget` with `origin: 'tool_invoked'` skips LLM, ships defaults.
- Frontend: rewrite `useAdjustmentPipeline.recompute()` to single-source from `selectPipelineNodes().filter(layer_id)`.
- Frontend: delete `materialize-adjustments.ts`.
- Frontend: drop `Layer.adjustmentStack` field and related slice actions.
- Frontend: repoint all readers of `layer.adjustmentStack` (`LayersSection`, `ActiveSection`, `SuggestionsSection`, `ToolWidgetCard`, `InspectorWidgetRow`, `LayerProperties`) to read `snapshot.widgets` filtered by `layer_id`. Each call site gets a small `useLayerWidgets(layerId)` helper to keep the read uniform.
- Frontend: `palette-actions.proposeFromPalette` passes `layer_id` + `origin: 'mcp_user_prompt'`.
- Frontend: toolrail button handlers call `backendTools.propose_widget` with `origin: 'tool_invoked'`.

Exit criteria: click toolrail Curves button → widget appears on canvas → slider drag re-renders image. Cmd+K with prompt → AI widget appears → accept removes Accept button but pixels unchanged. Delete unwinds pixels.

### Phase 4 — Selection unification (1 day)

Goal: One selection-slice, atomic updates.

- Create `src/store/selection-slice.ts` (§5.1).
- Register in `src/store/index.ts`.
- Migrate consumers: every `useSegmentSelection`, `useFocusedWidget`, `useCursorBindStore`, `useEditorStore.activeScope` call gets repointed.
- Delete the three obsolete stores.
- Shrink `segmentation-slice.ts` to `encoderState` only.

Exit criteria: click-cycle still works; tool-button cursor-bind drop still works; widget pulse on row-click still works; scope outline still updates.

### Phase 5 — Polish (0.5 day)

- Rename `ToolRegistry` → `CanvasToolRegistry`, `ToolManifestRegistry` → `LlmToolRegistry`.
- Delete `widget-projection.ts` (callers now read snapshot directly).
- ESLint clean (no warnings in `src/`).
- Update `CLAUDE.md` "Project Structure" and "Store separation" sections to match.
- Smoke test: open image → analyze → AI widget appears → click toolrail Curves → both widgets coexist → slider drag → undo → redo → export PNG.

Exit criteria: `npm run check` clean, manual smoke test passes, no console warnings.

## 13. Open risks

| Risk | Mitigation |
|---|---|
| Backend `propose_widget` LLM latency feels slow for tool-invoked clicks | Tool-invoked path skips LLM entirely; defaults from manifest are returned in <100ms |
| Pipeline re-renders on every backend SSE event become a perf hit | `selectPipelineNodes` already memoizes; profile during Phase 3 if drag feels janky |
| Linear undo loses pixel snapshots used by destructive ops (transactions) | No destructive ops in MVP — text/crop/brush all gone — so this is a non-issue |
| Code paths I haven't fully traced (e.g. `useSegmentInteraction`) might be load-bearing | Phase 1 grep-check before deletion; keep if any non-deleted file imports it |

## 14. Out of scope (post-MVP)

- Thesis control condition (non-AI / manual-only mode) — a separate build flag or branch, not this work.
- `.edp` project files / IndexedDB session persistence.
- Multi-layer UI (multi-layer code paths stay intact for future re-enable).
- Graph mode workspace.
- Brush, text, crop tool reintroduction.
- Backend-owned undo/redo (snapshot revision walking).
- Compose mode UI affordances.

## 15. Success criteria

The cleanup is done when:

1. `npm run check` is clean (0 errors, 0 warnings in `src/`).
2. There is exactly one `Scope` type and one selection store.
3. The WebGL pipeline reads from exactly one source.
4. All three spawn paths (Cmd+K, autonomous, toolrail) flow through `backendTools.propose_widget` and produce identical-shape widgets in the snapshot.
5. A new "fix the widget-doesn't-show bug" task takes <1 hour because the code path is obvious.
6. `npm run dev` boots in <300ms, total `src/` line count drops from ~21k to <12k.
7. CLAUDE.md's architecture sections accurately describe the code.
