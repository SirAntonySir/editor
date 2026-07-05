# Deletable / Reconnectable Tethers & Multi-Target Widgets

**Date:** 2026-07-05
**Status:** Design approved, pending implementation plan
**Area:** Workspace canvas (React Flow) · widget↔image-node tethers · Engine SSoT scope model

## Summary

Make widget tethers on the React Flow canvas **deletable** and **reconnectable**, and let a
single widget apply the same adjustment to **multiple image nodes / layers** ("replicate
independently"). The connection surface moves from the image body onto the **layers rail**:
every layer thumbnail becomes a React Flow handle, and a widget owns a *set* of
`(imageNodeId, layerId)` targets, one derived tether per target.

All three capabilities collapse into one mechanism — **moving a tether endpoint between layer
thumbnails**:

- **Connect / add target** — drag from the widget's out-nub onto a layer thumbnail.
- **Reconnect / retarget** — drag a tether's target end from one thumbnail to another (same or
  different photo).
- **Delete** — drag a tether end into empty space, or select the tether and press ⌫.

## Motivation

Today (`CanvasWorkspace.tsx`), tether edges are **derived** (recomputed in a `useMemo` from
widget/info/image-node state), rendered `selectable: false`, and `onConnect` is a no-op. A widget
resolves to exactly **one** target image node (`workspace-tether.ts`, via `widget.nodes[0].layerId`
→ owning node, else `activeImageNodeId`). There is no way to delete a connection except by deleting
the widget, no way to re-point a widget at a different node, and no way to apply one widget to
several photos.

Users want to batch the same edit across multiple photos (e.g. apply one Exposure to a whole shoot)
and to rewire attributions after the fact.

## Semantic decision: "replicate independently"

When one widget targets multiple layers/nodes, it applies **the same op with the same params to
each target separately** — each photo keeps its own pixels. This is distinct from the existing
`layerIds` "composite-then-apply" semantic (merge listed layers, apply once), which is **left
untouched**.

Rejected alternatives:
- *Merge then adjust* — that is the existing composite semantic; wrong for batch-applying a look.
- *Mirrored clones* — N linked widget instances; same visual result but heavier state and N undo
  entries. A single shared broadcaster is cleaner.

## Current architecture (grounding)

- **`LayerStrip.tsx`** — left rail; one row per layer: `[eye toggle] [ordinal "01"] [LayerThumb 52×40]`,
  right-aligned, newest-first (`flex-col-reverse`). Reads `useEditorStore(s => s.layers)` filtered by
  the node's `layerIds`.
- **`ImageNodeDrafting.tsx`** — renders 8 invisible node-body handles
  (`tether-in/out-{top,bottom,left,right}`) anchored to the image rectangle.
- **`tether-handles.ts` `pickTetherHandles()`** — spatially chooses which of the 8 handles a tether
  uses.
- **`TetherEdge.tsx`** — Bézier edge; variants for layer-scope, node-scope, and `extracted`.
- **`workspace-slice.ts`** — `tetherEdges: Record<string, TetherEdgeState>`; actions `setEdge`,
  `unbindEdge` (both history-tracked); cascade delete on `removeImageNode`; redirect on
  split/merge.
- **`TetherEdgeState`** (`types/workspace.ts`) — `{ id, widgetNodeId, targetImageNodeId, scope }`
  where `scope` is `{ kind:'layer', layerId } | { kind:'node' }`.
- **Scope** (`types/scope.ts`) — includes `{ kind:'image_node', imageNodeId, layerIds: string[] }`
  (wire-only, produced by backend `propose_stack`).
- **`image-node-renderer.ts`** — per-layer pass:
  `matchesLayer(n, layerId) && !Array.isArray(n.layerIds)`; composite-then-apply pass for nodes
  whose `layerIds.every(lid => layerSetForComposite.has(lid))`.
- **`ImageNodeState`** — one node owns `layerIds: string[]`.

## Design

### 1. Per-layer rail handles

- In `LayerStrip.tsx`, each layer row renders a React Flow `<Handle>` on the thumbnail's outer
  (left) edge, id `layer-tether-${layerId}`. It serves as the **target** for incoming widget
  tethers (and, if simplest, a matching source is not needed on the image side — the widget is
  always the source).
- The 8 node-body handles are **retired for widget tethers**. (They may remain for info/extracted
  edges — see Scope Boundaries.)
- Single-layer photos → exactly one handle; behavior for the common case is unchanged.
- `pickTetherHandles()` is reworked/retired for widget tethers: the target is now a specific
  layer handle on the rail (always left side), so routing simplifies to "widget out-nub → that
  layer's rail handle." The widget's own outlet side can still be chosen spatially.

### 2. Widget target set

- A widget's binding becomes a set of `(imageNodeId, layerId)` pairs rather than one resolved
  target. Each pair derives one tether edge.
- **Representation:** extend the derived-edge computation to emit one edge per target pair. The
  authoritative target set lives with the widget (frontend workspace state mirroring backend
  scope). `TetherEdgeState` either gains a `layerId` and is stored one-per-pair, or a new
  `widgetTargets` structure keyed by widget id is introduced — chosen during planning to minimize
  churn against `setEdge`/`unbindEdge`.
- **Spawn seeds one target:** existing spawn (`workspace-tether.ts`) produces exactly one pair
  (`widget.nodes[0].layerId` + its owning node). Existing Cmd+K / toolrail / autonomous flows are
  unchanged; the user drags to add further targets.

### 3. Interactions (React Flow in `CanvasWorkspace.tsx`)

| Gesture | RF mechanism | Effect |
|---|---|---|
| Connect / add | `onConnect` + `isValidConnection` | widget out-nub → layer handle: add pair to target set |
| Reconnect / retarget | `edgesReconnectable={true}` + `onReconnect` (+ `reconnectRadius`) | drag tether **target** end → another thumbnail: swap old pair → new pair. Source (widget) end not draggable. |
| Delete | selectable tethers + `deleteKeyCode`/`onEdgesDelete`; also `onReconnectEnd` with null target | remove just that pair; other targets untouched |

- `isValidConnection` allows only widget→layer-handle; rejects image↔image, widget↔widget, and
  duplicate `(imageNodeId, layerId)` pairs.
- Tether edges become `selectable: true` (currently `false`). Selection styling per `design.md`.

### 4. Data flow (edges are derived — write back to source of truth)

Each gesture does **not** mutate an edge object; it updates the widget's target set, and edges
re-derive:

1. RF handler fires → workspace action (`addWidgetTarget` / `retargetWidget` / `removeWidgetTarget`)
   updates the target set and calls `setEdge` / `unbindEdge` (already history-tracked; batch for a
   single undo step).
2. The target-set change is sent to the backend as a scope mutation (Engine SSoT — the backend owns
   `operation_graph`).
3. **Replicate rendering:** the widget's op node carries the target set; `image-node-renderer.ts`'s
   per-layer pass includes the op for any layer in that set (extend `matchesLayer` /
   `selectPipelineNodes`). Because each image node renders independently against its own layers, one
   op naturally replicates across photos with shared params, applied separately — no compositing.
   Kept distinct from the `layerIds` composite-then-apply pass, which is unchanged.

### 5. Backend (Engine SSoT) — main unknown

The op/scope model in `backend/` must represent a multi-`(node,layer)` **replicate** target set,
separate from the existing composite `layerIds`. **This has not yet been inspected.** The first
task of the implementation plan is to read the backend scope/op model and confirm feasibility;
the design assumes a single op node carrying a replicate target set with shared params.

## Decisions (defaults, approved)

- **Orphaned widget:** removing the last target keeps the widget on canvas, marked visually
  "unbound" (muted/dashed), rather than auto-deleting. Non-destructive; re-wirable.
- **Feature scope:** only **widget→layer** tethers move to the rail. **Info-node** and
  **extracted-image** edges keep their current node-level handles and behavior.
- **Delete affordances:** both select-and-⌫ *and* drag-off-to-empty.

## Testing

- Unit — `addWidgetTarget` / `retargetWidget` / `removeWidgetTarget`: add, retarget, remove,
  duplicate-pair rejection, last-target → unbound state; undo/redo coalescing.
- Unit — extended per-layer node selection (`selectPipelineNodes` / `matchesLayer`) includes a
  replicate op for every layer in its target set and excludes non-targets; existing composite
  `layerIds` behavior unchanged (regression).
- Component — `LayerStrip` renders exactly one handle per layer; `isValidConnection` rejects
  image↔image, widget↔widget, and duplicate pairs.
- Component — `onReconnect` swaps a pair; `onEdgesDelete` removes only the selected pair.

## Scope boundaries (out)

- Multi-widget group operations.
- Dragging whole photos (image nodes) to connect.
- Reordering targets within the set.
- Info-node and extracted-image edge rework.
- Mirrored/linkable independent widget instances (rejected semantic).

## Key files

- `src/components/workspace/drafting/LayerStrip.tsx` — per-layer handles
- `src/components/workspace/drafting/ImageNodeDrafting.tsx` — retire body handles for widget tethers
- `src/components/workspace/tether-handles.ts` — rework/retire `pickTetherHandles` for rail targets
- `src/components/workspace/CanvasWorkspace.tsx` — `onConnect` / `onReconnect` / `onEdgesDelete` /
  `isValidConnection` / `edgesReconnectable`; derived-edge fan-out per target pair
- `src/components/workspace/TetherEdge.tsx` — selectable + unbound styling
- `src/store/workspace-slice.ts` — `addWidgetTarget` / `retargetWidget` / `removeWidgetTarget`
- `src/types/workspace.ts` — `TetherEdgeState` / target-set representation
- `src/types/scope.ts` — replicate target-set scope
- `src/lib/image-node-renderer.ts` + `select-pipeline-nodes` — replicate per-layer matching
- `src/lib/workspace-tether.ts` — spawn seeds one target
- `backend/` — replicate scope/op model (feasibility TBD, first plan task)
