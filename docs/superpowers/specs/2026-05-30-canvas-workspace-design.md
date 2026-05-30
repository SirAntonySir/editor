# Canvas Workspace — React Flow Infinite Surface with Image & Widget Nodes

- **Date:** 2026-05-30
- **Status:** Approved (design), pending spec review
- **Branch:** `feat/canvas-centric-ui` (continuing after the widget-shell project)
- **Scope:** Replace the Fabric-based `EditorCanvas` viewport with a **React Flow infinite workspace**. Image data renders inside custom `ImageNode`s; adjustments render inside custom `WidgetNode`s; a single attribution-edge type ("tether") shows which Image each Widget affects. No DAG/workflow semantics on the edges — `operation_graph` remains the engine SSoT.

---

## 1. Goal

Turn the photo editor's canvas from "one centred image with on-canvas widgets" into a **Figma-style infinite workspace** of richly-bodied nodes:

- **Image nodes** render N composited layers (full-res) via the existing WebGL pipeline, freely placed and pannable/zoomable.
- **Widget nodes** wear the existing `WidgetShell` anatomy as their body; spawn near their target Image with soft auto-layout, then move freely.
- **Tether edges** carry attribution only ("this widget adjusts that Image"); they have no workflow meaning and don't define render order.
- Multiple Image nodes coexist (sources + baked outputs + alternates). Layer panel disappears — layers *are* nodes, or layers *inside* a stacked node.

### Non-goals
- Not a graph/compositor editor. Tether edges never define data flow between widgets.
- No new modes (no Develop/Compose/Graph split — that was the previous attempt and was stripped). One workspace.
- No multi-document tabs in v1. The workspace holds the layers of the current document; opening a new document replaces the workspace contents.
- No persistence-on-disk schema changes (`.edp`) in v1. Workspace positions live in the local session/store; persistence is a follow-up.

---

## 2. Locked decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Workspace technology | **React Flow** (`@xyflow/react`) — re-introduce as a dep |
| 2 | Image node = ? | **Holds N layers (N ≥ 1)** as a stack; renders the composite via the existing pipeline. Mergeable + splittable. |
| 3 | Multi-layer scope for v1 | **Full design now** — node-scope adjustments + merge/split + tether edges from day one |
| 4 | Workspace placement | **Soft auto-layout on spawn, freeform drag** afterward |
| 5 | Layers panel | **Gone** — layers are nodes (or layers inside a stacked node, shown inline on selection) |
| 6 | Tether style | **Solid accent line** for layer-scope; **dashed accent line** for node-scope. Subtle. No arrows. |
| 7 | Image-node body zoom | **Scales with workspace zoom** (React Flow's CSS transform; bodies render via WebGL into an OffscreenCanvas at intrinsic size) |
| 8 | Selection | **Single-click select; shift-click multi; rubber-band area-select.** Click empty workspace deselects. Edges selectable; `Delete` on selected edge unbinds the widget (scope → "Unbound", widget stays alive). |
| 9 | Toolrail click | **Requires an active `ImageNode` selection.** Spawns a widget node tethered to that Image; default scope = active layer within the node → fallback "Whole node". Buttons disabled with a tooltip when no Image selected. |
| 10 | Sidebar Suggestions | Stay. Click ↗ tethers to active Image, same as toolrail. |
| 11 | Masks & segmentation | Rendered **inside the Image-node body** (existing SAM-derived overlay style). No separate mask nodes in v1. |
| 12 | Performance v1 | One OffscreenCanvas per Image node via the existing pipeline; React Flow viewport-culling. **Decimation on zoom-out deferred.** |
| 13 | Bake behaviour for stacked nodes | Applying a node-scope adjustment bakes the **composite** into the operation_graph; **source layers remain untouched in the layer store** (non-destructive). |
| 14 | Undo / redo | New workspace operations (move, split, merge, edge bind/unbind) push to the existing `editorDocument.historyStore`. The store gets a small `workspace` mutation kind. |

---

## 3. Frontend architecture

### 3.1 Component layout

```
src/components/workspace/
  CanvasWorkspace.tsx          # NEW · React Flow scaffold; replaces EditorCanvas
                               #   Mounts ReactFlow with our nodeTypes / edgeTypes.
                               #   Owns the workspace ref for selection + viewport.
  ImageNode.tsx                # NEW · custom node type
                               #   Header (icon · name · "N LAYERS" badge · ⋯)
                               #   Body  (ImageNodeBody)
                               #   Footer (dims · active-layer label)
                               #   Inline stack strip (when stacked + selected)
                               #   Corner split/merge affordance (when selected)
  ImageNodeBody.tsx            # NEW · drives the WebGL pipeline → OffscreenCanvas
                               #   Reads layer ids; renders the composite via pipeline.ts;
                               #   draws mask/annotation overlays in the same canvas.
  WidgetNode.tsx               # NEW · custom node type · body = <WidgetShell widget={…}/>
  TetherEdge.tsx               # NEW · custom React Flow edge
                               #   Solid stroke for layer-scope · dashed for node-scope
                               #   Two endpoint dots; no arrowhead.
  workspace-layout.ts          # NEW · soft-auto placement helper
                               #   nextSpawnPositionFor(targetImageNode, kind) → {x, y}
  workspace-fit.ts             # NEW · "fit selection" / "frame all" zoom helpers
src/store/
  workspace-slice.ts           # NEW · imageNodes, edges, selection, viewport
  tool-slice.ts                # UPDATE · drop dock fields (expandedWidgetIds,
                               #   hoveredWidgetId, sessionDragOverrides);
                               #   add activeImageNodeId.
src/hooks/
  useImageNodeRender.ts        # NEW · per-ImageNode pipeline driver
                               #   Inputs: layer ids, list of widgets tethered to this node
                               #   Output: a stable HTMLCanvasElement / OffscreenCanvas ref
  useWorkspaceSelection.ts     # NEW · derived "active image node id" / selected widget id
src/types/
  workspace.ts                 # NEW · ImageNodeState · TetherEdgeState · WorkspaceViewport
```

**Reused unchanged:** `WidgetShell.tsx`, `WidgetShellHeader.tsx`, `WidgetShellFooter.tsx`, `PreviewSlot.tsx`, `RefineInput.tsx`, `WhyPopover.tsx`, all 6 control primitives, `BindingRow.tsx`, `pipeline.ts`, the shader catalog, `ProcessingRegistry`, `backend-tools.ts`, the `Suggestions` sidebar + `AskAiInput`.

**Deleted (in this project):**
- `src/components/canvas/EditorCanvas.tsx`
- `src/components/canvas/useFabricOverlays.ts`
- `src/components/canvas/useAdjustmentPipeline.ts` (logic merges into `useImageNodeRender`)
- `src/components/canvas/SelectionActionsOverlay.tsx` — its **logic** ("create layer" / "discard committed mask") is rebuilt as a new small `ImageNodeSelectionPopover.tsx` mounted from `ImageNode`; the old file is deleted.
- `src/components/canvas/SegmentOverlay.tsx` (rendering moves into `ImageNodeBody`)
- `src/components/canvas/FullImageOutline.tsx`
- `src/components/widget/CanvasWidgetLayer.tsx`
- `src/components/widget/AnchorTickLayer.tsx`
- `src/components/widget/RegionHighlightLayer.tsx`
- `src/hooks/useWidgetDockLayout.ts`
- `src/hooks/useWidgetExpansion.ts` — selector hook deleted; its `expandedWidgetIds` Set moves out of `tool-slice` into `workspace-slice` (still keyed by widget id). The new selector lives in `useWorkspaceSelection.ts`.
- `src/hooks/useHoveredWidget.ts` (React Flow built-in hover replaces it)
- `src/hooks/useDragOverride.ts` (React Flow owns node positions)
- `src/hooks/useCursorBind.ts` (cursor-bind UX retired — replaced by select-then-spawn)
- `src/components/widget/CursorBindGhost.tsx`
- Layer panel components (`LayersPanel`/related) and the `LayersSection` already-removed/now-fully-removed.
- `fabric` from `package.json`.

### 3.2 Dependencies

**Add:**
- `@xyflow/react` (the React Flow package)

**Remove:**
- `fabric`

ELK / auto-layout libraries are explicitly **not** reintroduced; soft-auto placement is hand-rolled (it only needs `nextFreeSlotFor(targetNode)`).

---

## 4. Data model

### 4.1 Frontend (`src/types/workspace.ts`)

```ts
export interface ImageNodeState {
  id: string;                     // React Flow node id
  layerIds: string[];             // 1+ layer ids from the existing layer store
  position: { x: number; y: number };
  size: { w: number; h: number }; // body dims in workspace units
  selected: boolean;
}

export interface WidgetNodeState {
  id: string;                     // React Flow node id; matches Widget.id
  position: { x: number; y: number };
}

export interface TetherEdgeState {
  id: string;
  widgetNodeId: string;
  targetImageNodeId: string;
  scope:
    | { kind: 'layer'; layerId: string }
    | { kind: 'node' };           // composite of all layers in the target node
}

export interface WorkspaceViewport {
  zoom: number;
  pan: { x: number; y: number };
}
```

### 4.2 `workspace-slice.ts`

```ts
interface WorkspaceSlice {
  imageNodes: Record<string, ImageNodeState>;
  widgetPositions: Record<string, { x: number; y: number }>;
  tetherEdges: Record<string, TetherEdgeState>;
  viewport: WorkspaceViewport;
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;
  expandedWidgetIds: Set<string>;   // moved from tool-slice; still drives WidgetShell expand state
  activeImageNodeId: string | null; // last-selected ImageNode; drives toolrail spawn target

  addImageNode(layerIds: string[], position?: { x: number; y: number }): string;
  splitImageNode(id: string): string[];           // → array of new node ids, one per layer
  mergeImageNodes(ids: string[]): string;          // → new node id
  setNodePosition(id: string, pos: { x: number; y: number }): void;
  setEdge(widgetId: string, target: TetherEdgeState['scope'], targetNodeId: string): void;
  unbindEdge(edgeId: string): void;
  setSelection(nodes: string[], edges: string[]): void;
  setViewport(v: WorkspaceViewport): void;
  toggleExpanded(widgetId: string): void;
}
```

### 4.3 Backend (`backend/app/schemas/widget.py`)

Extend the `Scope` discriminated union with one new variant:

```python
class ImageNodeScope(BaseModel):
    kind: Literal["image_node"]
    image_node_id: str
    layer_ids: list[str]            # the layers to composite before applying the adjustment
```

Add to the `Scope = Union[...]` root model. The frontend already-existing `Scope` (in `src/types/scope.ts`) gets the mirror variant.

**Behavioural rule:** when a widget's `scope.kind === 'image_node'`, the rendering pipeline must composite the listed `layer_ids` first (with their existing per-layer adjustments applied), then apply the widget's adjustment to that composite output. The composite render becomes the input to the widget's shader pass.

**Compatibility:** the existing `Scope` variants (`global`, `mask`, `mask:proposed`, `named_region`) and `WidgetNode.layer_id` are unchanged. Layer-scope widgets behave exactly as today.

### 4.4 `WidgetOrigin.anchor` deprecation

The anchor-on-photo concept that drove the tick layer in widget-shell v1 is no longer needed (no calculated dock, no photo right-edge). `WidgetOrigin.anchor` is kept on the type for backwards-compatibility with stored widgets but the workspace ignores it. Suggestion-row clicks use the active ImageNode as the implicit target.

---

## 5. Rendering pipeline

### 5.1 Per-ImageNode render

Each `ImageNode` mounts an `ImageNodeBody` that owns a single `<canvas>`. `useImageNodeRender({ imageNodeId, layerIds })`:

1. For each layer id in the node, run the existing per-layer pipeline (`pipeline-manager.ts` filtered by `layer_id === id`).
2. Composite the per-layer outputs in layer order using the existing `layer-compositor.ts` blend-mode logic.
3. For each widget tethered to this node with `scope.kind === 'image_node'`, run its shader pass against the composite output (additional pipeline stage). Per-widget-layer adjustments have already been applied in step 1.
4. Draw masks/annotation overlays into the canvas on top of the composite.
5. Expose the canvas element to React Flow's body slot.

React Flow's CSS transform handles zoom/pan; the canvas resolution is the layer's intrinsic resolution (or capped at a configurable max).

### 5.2 Tether rendering

`TetherEdge` is a custom React Flow edge component. Reads its `scope` field, picks `stroke-dasharray` accordingly, draws two endpoint dots at the source/target connection points (default port positions on the right edge of the widget header and the left edge of the Image node).

### 5.3 Soft auto-layout (`workspace-layout.ts`)

```ts
nextSpawnPositionFor(targetImageNode, kind: 'widget' | 'image'): { x, y }
```

- Widget: target node's `position.x + size.w + GAP` (default 24), vertical centre of target.
- New Image node (e.g. split result): cluster to the right of the source node with a 24px gap, staggered vertically.

Collision avoidance: if the computed slot overlaps an existing node, increment y by `node.size.h + GAP` until free.

---

## 6. UX behavior

### 6.1 Selection

- Single-click an ImageNode or WidgetNode → selects (replaces selection).
- Shift+click → adds to selection.
- Click empty workspace → clears selection.
- Drag in empty workspace → rubber-band area select (React Flow built-in).
- Single-click an edge → selects the edge.
- `Delete` while an edge is selected → `unbindEdge` (scope becomes "Unbound"; widget stays). `Delete` while a node is selected → `delete_widget` for WidgetNode; ImageNode requires confirmation.

### 6.2 Toolrail click

Disabled (with tooltip "Select an Image node first") when `activeImageNodeId === null`. Otherwise:

```
backendTools.propose_widget({
  origin: 'tool_invoked',
  fused_tool_id,
  scope: activeLayerInSelectedImageNode
    ? { kind: 'layer', layerId: activeLayerInSelectedImageNode }
    : { kind: 'image_node', image_node_id: activeImageNodeId, layer_ids: imageNodes[activeImageNodeId].layerIds },
})
```

**"Active layer within an ImageNode"** = the layer most recently selected in that ImageNode's stack strip. When an ImageNode is single-layer, the active layer is trivially that layer. When stacked, default to the topmost layer; clicking a thumbnail in the inline stack strip changes the active layer for that node. The stack strip shows the active layer with a 1.5px accent outline (`scope-region` token).

The new WidgetNode spawns at `nextSpawnPositionFor(activeImageNode, 'widget')`. A `TetherEdgeState` is created from the widget to the active ImageNode with the matching scope.

### 6.3 Sidebar Suggestions

Clicking `↗` on a Suggestions row: adds to `acceptedSuggestions` (same engage semantics as today), spawns the widget tethered to the active ImageNode with the same default-scope rule. If `activeImageNodeId === null`, ↗ is disabled with the same tooltip.

### 6.4 ImageNode operations

- **Header `⋯` menu:** Split, Merge with neighbours, Rename, Delete.
- **Split** (only on stacked nodes): decomposes the stack into N single-layer ImageNodes; existing tethers re-bind to the node containing the original target layer; node-scope tethers are duplicated to all resulting nodes with a warning toast ("node-scope split — adjust manually").
- **Merge** (multi-selection of ImageNodes): collects all `layerIds`, creates one new ImageNode; existing tethers redirect; layer-scope tethers retarget unchanged; node-scope tethers retarget to the new node.
- **Rename / Delete:** straightforward.

### 6.5 Masks & segmentation

- SAM-derived overlays render inside `ImageNodeBody`'s canvas in the same place they used to render in Fabric.
- The "Create layer / Discard" floating panel returns as `ImageNodeSelectionPopover` — anchored above the ImageNode header (via Radix Popover, same surface style as `WhyPopover`), shown only when a committed selection exists in one of that node's layers.

### 6.6 Undo / redo

Workspace mutations push into `editorDocument.historyStore` with a new kind `'workspace'`. Undoable ops:
- Move node (debounced, one entry per drag-end)
- Split / Merge
- Edge bind / unbind
- Image-node delete
- Widget spawn (paired with backend `propose_widget` so undo also fires `delete_widget`)

Viewport changes (zoom, pan) are not undoable (matches existing pan/zoom behaviour).

---

## 7. Migration

This is a substantial refactor. Order it so each step keeps `npm run check` green:

1. Add `@xyflow/react` dep; add `workspace-slice.ts`, `workspace.ts` types; no UI change yet.
2. Build `ImageNode`, `ImageNodeBody`, `TetherEdge`, `WidgetNode`, `CanvasWorkspace` with mocked data and tests. Not mounted in the app yet.
3. Hide-feature-flag swap: introduce a `useWorkspaceCanvas` boolean (env or pref). When true, mount `CanvasWorkspace` instead of `EditorCanvas` in `MainLayout`. Test both branches green.
4. Port the WebGL pipeline driver from `useAdjustmentPipeline` → `useImageNodeRender`; verify pixel output matches.
5. Port mask/annotation overlay rendering from `useFabricOverlays` → `ImageNodeBody`.
6. Wire toolrail / Suggestions ↗ / cursor-bind retirement.
7. Backend: add `ImageNodeScope` to `Scope` union; teach `propose_widget` to accept it; teach the rendering side of `apply_adjustment` to composite-then-apply when scope is `image_node`.
8. Delete Fabric path: remove `EditorCanvas`, `fabric` dep, the `useFabricOverlays` etc. (file-touch map in §3.1 is authoritative).
9. Docs: rewrite `design.md` §11 (Widget Shell → Canvas Workspace) and update `CLAUDE.md`'s component-architecture rule to reflect React Flow as the canvas surface.

The feature-flag step (3) lets the project ship behind a flag while the migration completes; the flag is removed in the final commit.

---

## 8. Testing

### 8.1 Unit
- `workspace-layout.test.ts` — `nextSpawnPositionFor` math; collision shifting.
- `workspace-slice.test.ts` — addImageNode, split (1 → N), merge (N → 1), tether bind/unbind, selection, undo entries created.
- `useImageNodeRender.test.ts` — given layer ids + a mock pipeline, returns a canvas element of the expected size.
- `TetherEdge.test.tsx` — renders solid for layer-scope, dashed for image_node-scope.
- `ImageNode.test.tsx` — renders header / body / footer; corner affordance only on selected; stack strip only when `layerIds.length > 1` AND selected.
- `WidgetNode.test.tsx` — wraps a `WidgetShell` and forwards width.
- `CanvasWorkspace.test.tsx` — given fixtures of image+widget nodes and tethers, renders the right React Flow tree.

### 8.2 Integration
- Toolrail click flow: select ImageNode → click Light → assert `propose_widget` called with the right scope + a new WidgetNode appears at the soft-auto position + a TetherEdge connects them.
- Suggestion ↗: assert engage path adds to `acceptedSuggestions` AND creates a TetherEdge.
- Split flow: split a 2-layer stack → 2 ImageNodes + a "node-scope split" warning toast if any node-scope tether existed.

### 8.3 Manual browser pass
- Spawn multiple Image nodes, drag them around, zoom in/out smoothly.
- Stack: import an image into a layer; split it; observe the result.
- Apply a layer-scope adjustment; tether reads solid; effect visible on the right layer.
- Apply a node-scope adjustment; tether reads dashed; effect visible on the composite.
- Apply on a stacked node; bake; confirm source layers remain untouched in the layer store.
- Undo / redo each workspace op.
- Delete a tether edge; confirm widget becomes "Unbound" and effect is removed.

---

## 9. Backend impact

Minimal but real:

| File | Change |
|---|---|
| `backend/app/schemas/widget.py` | Add `ImageNodeScope` variant to the `Scope` discriminated union. Widget.scope, WidgetOrigin.anchor (when present), and any other path that validates a `Scope` value gain the new variant automatically through the union. No separate `node_scope` field on `Widget` itself. |
| `backend/app/tools/propose_widget.py` | Accept `image_node` scope from the frontend; pass-through into the widget body |
| `backend/app/tools/accept_widget.py` | When materialising a node-scope widget into `operation_graph`, emit `WidgetNode` entries that carry `layer_ids` instead of a single `layer_id` |
| Tests | One per change, mirroring the existing per-tool tests |

No new MCP tools. No changes to image analysis, masks, or fused tools. Backend has no awareness of node positions or workspace viewport — that's all frontend.

---

## 10. Risks + explicit follow-ups

1. **Performance with many Image nodes.** Each Image node owns a WebGL context (or shares one via OffscreenCanvas). With 10+ Image nodes carrying full-res photos, GPU memory + paint cost may matter. Mitigation: cap the per-node canvas dimensions; decimate when zoom-out goes below a threshold. Decimation deferred unless measured to be a problem.
2. **React Flow + WebGL interop.** React Flow's CSS-transform zoom is independent of canvas resolution. A naive implementation may blur the canvas at zoom > 1×. The fix is well-known (render the canvas at `zoom × intrinsic_size` and let React Flow size the container) but the spec calls it out so the implementer reads it.
3. **node_scope composite re-render frequency.** Editing a slider on a node-scope widget triggers a full re-composite of the node's layers. For multi-layer nodes that's heavier than per-layer adjust. Acceptable in v1; revisit if drag-while-editing feels sluggish.
4. **Undo integration.** Workspace ops are pure frontend. The existing `editorDocument.historyStore` handles per-document state. Plan: extend the history-entry kind union with `'workspace_move' | 'workspace_split' | 'workspace_merge' | 'workspace_bind' | 'workspace_unbind' | 'widget_spawn'`; each entry carries the inverse op so `undo()` can replay. Adjustment-edit history entries (set_widget_param etc.) are untouched. Implementation must run the existing history tests AND new workspace-history tests before declaring the migration done.
5. **Persistence.** Workspace positions and the imageNode → layerIds mapping are not persisted to disk in v1 (no `.edp` extension). They live in the in-session store. A reload starts with one auto-spawned ImageNode containing all current layers. Persistence is a clear follow-up.
6. **Cursor-bind retirement.** The previous `useCursorBind` flow is removed. Any other consumer of `pendingBind` / `startToolBind` (e.g. inspector code) needs auditing during implementation.
7. **Spec → code drift on Fabric removal.** Fabric's removal touches a lot of files indirectly (zoom handling, space-to-pan, drop targets). The implementation plan must enumerate every Fabric usage site.

---

## 11. Out of scope (explicitly)

- Multiple documents / tabs.
- Persisting workspace state to `.edp` files.
- Auto-layout libraries (ELK and the like).
- Custom edge interactions beyond click-to-select + Delete-to-unbind.
- A minimap (React Flow can add one later; not in v1).
- Workspace search ("find by name") — single document, won't need it yet.
- Touch gesture support beyond what React Flow gives for free.
