# LayerStrip → standalone "layers" node

**Date:** 2026-07-07
**Status:** Draft for review

## Goal

Promote the LayerStrip from a fixed gutter *inside* `ImageNodeDrafting` to a
first-class, moveable React Flow node — one per image node, joined to its image
node by an attribution tether. Widgets keep tethering to individual layers, but
those per-layer ports now live on the standalone layers node (decision:
**full first-class**, confirmed with the user).

## Current state (what we're moving away from)

- `LayerStrip` renders inside `ImageNodeDrafting`'s body row, in a negative-margin
  left gutter hugging the image body ([ImageNodeDrafting.tsx:573–580](../../../src/components/workspace/drafting/ImageNodeDrafting.tsx#L573)).
- Each layer row carries a React Flow **target** `Handle` with id
  `layer-tether-<layerId>` — the *only* surface widget tethers connect to.
- Widget tether edges are rendered with `target = te.targetImageNodeId` and
  `targetHandle = layer-tether-<layerId>` ([CanvasWorkspace.tsx:360–371](../../../src/components/workspace/CanvasWorkspace.tsx#L360)).
  The tether's *scope* (backend truth) is `targetImageNodeId` + `scope.layerId`.
- Node registry: `{ image, widget, info }`. `InfoNode` is the existing precedent
  for a detached, tethered, moveable auxiliary node.

## Architecture

### 1. New node type `layers`

- Register `LayerNode` in `nodeTypes` alongside `image` / `widget` / `info`.
- `LayerNode` is a thin RF wrapper (mirrors `InfoNode`) that:
  - reads its image node from the store (`imageNodes[data.imageNodeId]`) so its
    `layerIds` stay live without RF data-prop churn;
  - renders the existing `LayerStrip` UI (which already emits the per-layer
    `layer-tether-<layerId>` **target** handles);
  - adds four **source** outlet handles (`tether-out-{top,bottom,left,right}`,
    `.tether-outlet`) for the attribution edge back to the image node — same
    pattern as `InfoNode`;
  - measures itself (`ResizeObserver` + `useUpdateNodeInternals`) so handle
    geometry tracks the rendered box.

### 2. State model (`workspace-slice.ts`)

Add:

```ts
interface LayerNodeState { id: string; imageNodeId: string; position: Point; size?: Size }
layerNodes: Record<string, LayerNodeState>;   // keyed by id
```

- **Deterministic id:** `layers-<imageNodeId>` (e.g. `layers-in-3`). 1:1 with the
  image node, so no separate seq counter and cascades need no lookup. Content is
  fully derived from the image node's `layerIds`; the record persists only
  position (and measured size for edge routing).
- New actions: `setLayerNodePosition(id, position)`, `setLayerNodeSize(id, size)`.
  Creation/removal are folded into the image-node lifecycle ops (below), not a
  standalone `addLayerNode`.

### 3. Lifecycle (SSoT in the slice, cascaded off image nodes)

| Image-node op | Layers-node effect |
|---|---|
| `addImageNode` | create `layers-<id>` at `{ x: image.x − LAYER_NODE_WIDTH − GAP, y: image.y }` |
| `removeImageNode` | delete `layers-<id>` |
| `splitImageNode` | create a layers node for the new node |
| `mergeImageNodes(src,tgt)` | delete `layers-<src>` (target's node now shows merged `layerIds` automatically) |
| `resetWorkspace` | clear `layerNodes` |
| `resyncNodeSeq` | no-op (deterministic ids, no counter) |

Once spawned, the layers node is **positionally independent** — it does not
follow its image node on drag (matches "moveable"; same freedom widgets have).

### 4. Tether reroute (the crux)

Only the **rendered RF target** changes; backend scope is untouched.

- In `derivedEdges`, for each widget tether `te`, resolve the layers node
  `layers-<te.targetImageNodeId>`, look up *its* geometry in `rfLookup`, and emit
  the edge with `target = layers-<te.targetImageNodeId>` (was `te.targetImageNodeId`).
  `targetHandle` stays `layer-tether-<te.layerId>` (handles moved with the strip).
- `te.targetImageNodeId` + `scope.layerId` in the store are **unchanged** — backend
  scope resolution, `syncWidgetTethers`, `addWidgetTarget`, `retargetWidget` all
  keep keying on the image node id.
- Connection validation is unchanged: handle ids are identical, so
  `parseLayerHandle` / `isValidTetherConnection` still work. `onConnect` resolves
  layer → image node via `imageNodeForLayer`, exactly as today.
- `rfLookup` gains layers nodes (size from `measured` ?? `LayerNodeState.size` ??
  a default) so both the widget edge and the attribution edge can route.

### 5. Image ↔ layers attribution tether

Add a calm, non-selectable tether in `derivedEdges`:
`id: layers-link-<imageNodeId>`, `source: layers-<id>`, `target: <imageNodeId>`,
`scopeKind: 'node'`, routed with `pickTetherHandles` like the info/extracted
tethers. Purely visual grouping — no DAG semantics (consistent with the
architecture doc's tether rule).

### 6. ImageNodeDrafting cleanup

- Remove the left-gutter `<LayerStrip>` block and its `leftGutter` width math
  (the `MIN_LEFT_GUTTER` reservation for the strip). The image body's left
  margin no longer needs to reserve strip space; keep whatever margin the
  marker/typography layout still needs.

### 7. Selection coupling

Clicking a layer row now also sets the **active image node**
(`setActiveImageNode(imageNodeId)`) in addition to the active layer. Today that
was implicit (the strip lived inside the active image node); standalone, we make
it explicit so toolrail gating (which needs `activeImageNodeId`) still lights up
when the user works from the layers node.

### 8. Persistence (`.edp` / `editor-state-persistence.ts`)

Add `layerNodes` to the persisted `WorkspaceStateSnapshot` (capture + dirty-check
+ rehydrate), alongside `imageNodes` / `widgetNodes` / `tetherEdges` / `infoNodes`.

### 9. Visual register

The strip no longer floats over photo content, so it moves from the frosted
`.glass-overlay` (the [glass-over-image](../../../src/index.css) exception) to the
flat `.overlay` register used by widget/info nodes. The whole card becomes the
drag handle (`.workspace-drag-handle`); per-row buttons already
`stopPropagation` on pointer-down so they stay clickable.

## Testing

- `workspace-slice`: layers node is created on `addImageNode`/`splitImageNode`,
  removed on `removeImageNode`/`mergeImageNodes`, cleared on `resetWorkspace`.
- Tether routing: a widget tether's rendered edge targets `layers-<imageNodeId>`
  with handle `layer-tether-<layerId>`; backend scope still stores the image node id.
- `ImageNode.test.tsx`: assert LayerStrip is **no longer** inside the image node.
- `LayerStrip.test.tsx`: largely unchanged (renders the component directly); add
  a case that selecting a layer sets the active image node.
- `editor-state-persistence`: `layerNodes` round-trips through capture/rehydrate.

## Risks / open choices

- **Position independence vs. follow:** spec says independent once spawned. If
  image-node drags should drag the layers node along, that's a follow-on.
- **Empty state:** an image node with a single layer still gets a layers node
  (one row). Acceptable; revisit if it feels heavy.
- **Multi-image tether geometry:** with the layers node draggable far from its
  image, widget tethers may cross the canvas. `pickTetherHandles` already routes
  to the nearest side, so this is cosmetic.

## Out of scope

Backend changes (none — scope model is untouched), inspector Layer tab, and any
change to how layers are ordered/blended.
