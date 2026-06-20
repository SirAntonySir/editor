# Visibility-Driven Adjustments

**Status:** Design — pending implementation
**Date:** 2026-06-17
**Brainstorm:** in-session

## Motivation

After the image/layer/object rework
(`docs/superpowers/specs/2026-06-16-image-layer-object-rework-design.md`)
landed, the user's mental model continued to shift. Three observations
about the current behaviour:

1. **The LayerStrip's "click = set active layer" semantic is not
   load-bearing.** The strip's job is to navigate a stack of layers
   visually. What the user actually wants from a layer-stack interface
   is to mute and unmute layers — the same gesture a switchboard
   provides.
2. **Adjustments shouldn't require picking a layer.** When the user
   creates a curves widget, they expect it to affect the picture they
   see, which is every visible layer composited together.
3. **The sidebar reads as broken when there's nothing to do.** Showing
   tabs that say "Click an image" is worse than not showing the tabs at
   all — the canvas should reclaim the space until an image is in
   focus.

This spec reworks three surfaces — the LayerStrip, the right sidebar
gate, and the widget targeting model — to express one consistent idea:
**what the user sees is what their adjustments are operating on**.

## Conceptual model

| Concept | Today | After |
|---|---|---|
| "Active layer" drives adjustments | Yes — widgets bind to `activeLayerId` | No — widgets bind to the **image-node** and broadcast |
| `Layer.visible` | Hides a layer from the composite | Also gates which layers an adjustment applies to (live) |
| LayerStrip click | Sets `activeLayerId` | Toggles `Layer.visible` |
| LayerStrip right-click | — | Per-layer context menu (Rename / Blend / Lock / Delete) |
| Image click | Sets `activeImageNodeId` | Same. No side-effect on the active layer. |
| Object (mask) | Mask + scope on one layer | Same mask narrows the broadcast; applies uniformly to every visible layer |
| `activeLayerId` | Drives the Inspector and adjustments | Drives only which row is "expanded" in the Layer tab |
| Right sidebar | Visible whenever any layer exists | Visible only when `activeImageNodeId !== null` |

**Vocabulary.** A widget now targets an **image-node**, not a layer.
The Adjustments tab header simplifies to `Targets: <object name>` or
`Targets: Whole image` — no "on \<layer\>" suffix.

What stays:

- `activeImageNodeId` is still the primary selection.
- `activeObjectId` still binds adjustments to a mask.
- The `(image-node, object)` pair fully describes a widget's target.
- Per-layer settings (rename, blend, opacity, lock, layerMask) still
  live on the layer slice and are mutated via the Layer tab and the
  new LayerStrip context menu.

## UI surfaces & interaction flow

### LayerStrip (left margin of image nodes)

| Gesture | Result |
|---|---|
| Click sheet | Toggle `Layer.visible`. Sheet renders ochre when visible, hairline outline only when hidden. |
| Right-click sheet | Open ContextMenu: Rename / Blend mode submenu / Lock / Delete. Reuses existing layer mutation actions. |
| Hover sheet | Reveal layer name + ordinal in Fraunces italic (unchanged). |
| Drag-reorder | Unchanged. |

No "active" state on the strip — the user can have any combination of
visibilities and the strip doesn't pick one.

### Image-node body click

Unchanged. Already sets `activeImageNodeId` without touching
`activeLayerId` (after the prior refactor's Phase 2). The "image click
= focus" requirement is already satisfied; no code change here.

### Right sidebar (Inspector)

| Condition | Sidebar |
|---|---|
| `activeImageNodeId === null` | Unmounts. Canvas reclaims the space. |
| `activeImageNodeId !== null` | Mounts. Inspector tabs render normally. |

Implementation: replace
`useEditorStore((s) => s.layers.length > 0)` in `RightSidebar.tsx:18`
with `useEditorStore((s) => s.activeImageNodeId !== null)`.

### Inspector → Layer tab

| Element | Today | After |
|---|---|---|
| Layer rows | Click sets `activeLayerId`; controls inline per row | Click expands that row's inline controls; `activeLayerId` drives which row is expanded |
| Visibility eye on the row | Yes | Stays. Two surfaces (strip + row eye) toggle the same `Layer.visible` field. |
| Adjustments tab header | "Targets: \<object\> on \<layer\>" | "Targets: \<object name or 'Whole image'\>" |

## Data model & broadcast mechanic

### Frontend slices

No schema changes. `Layer.visible` keeps its meaning. `selection-slice`
and `workspace-slice` are unchanged.

### Widget anchoring — the live-broadcast model

A widget anchors to an **image-node**, not a layer. The backend
`WidgetNode` schema already has both `layerId: string` (required) and
`layerIds: string[] | null` (optional). We use them as follows:

| Field | Meaning |
|---|---|
| `WidgetNode.layerId` | Stable anchor layer in the target image-node — used for graph identity, undo, and back-compat with single-layer widgets. Default: the image-node's first photo layer. |
| `WidgetNode.layerIds` | Discovery hint — the full set of layers the image-node carried at spawn time. NOT the runtime target. The renderer reads the current set live, filtered by `Layer.visible`. |
| Renderer behavior | At composite time, for each layer in the widget's image-node that is `visible`, apply the widget's params to it. |

`layerIds` is a discovery hint for tooling (history view, AI agents,
debug overlays). The live truth at render time is "all visible layers
of the widget's image-node."

### Renderer change

Where the renderer today filters `operation_graph.nodes` by
`layer_id === currentLayerId` per-layer, it now also picks up any
widget whose anchoring image-node contains `currentLayerId` AND whose
`Layer.visible` is true at this frame. One pass; live; no
operation_graph mutation on visibility toggles.

### Mask interaction

`Scope.kind === 'mask'` still narrows where the adjustment paints. The
mask lives in image-node coordinate space and applies per visible
layer uniformly. No mask-data change — only the layer iteration in the
renderer.

### Three spawn paths — what they ship

All three frontend spawn helpers (`promote.ts`,
`colour-band-spawn.ts`, `filters-tool.tsx`) build the request as:

```ts
const node = useEditorStore.getState().imageNodes[activeImageNodeId];
const photoLayerId = node.layerIds.find(
  (lid) => editor.layers.find((l) => l.id === lid)?.type === 'image',
) ?? node.layerIds[0];

proposeStack(sessionId, {
  intent, scope, origin,
  layerId: photoLayerId,
  layerIds: node.layerIds,
});
```

`scope` continues to come from
`scopeFromSelection(activeObjectId)`. There is no per-widget
"single-layer pin" UI; if the user wants a single-layer effect they
solo a layer (hide the others on the strip), spawn the widget, then
unsolo. Future opt-in for explicit pinning if it comes up.

## Edge cases

| Case | Behavior |
|---|---|
| All layers hidden, widget exists | Widget renders no effect. Inspector still shows the widget. Toggling any layer visible brings the effect back live. |
| Image-node has one layer | Identical to old behaviour. |
| Image-node deleted while sidebar is mounted | `activeImageNodeId` cleared on the same tick; sidebar unmounts. |
| User adds a new layer to an image-node with widgets | New layer is `visible: true` by default → widgets apply immediately. Symmetric on add + visibility. |
| Click blank canvas | `activeImageNodeId = null` → sidebar unmounts. Toolrail already gated on the same condition. |
| Old single-layer widgets (pre-broadcast, `layerIds: null`) | Renderer continues to apply them to the single `layerId`. Not auto-promoted to broadcast. |
| Object selected, anchor layer hidden | Mask applies on any remaining visible layer. Object stays selected. |
| Object's anchor is the only visible layer, then hidden | Widget renders no effect, same as "all hidden". |
| User adds a Layer Mask to a layer receiving a broadcast widget | Layer Mask narrows that layer's pixels in the composite. Widget still applies to the (now-masked) layer. Layer Mask and Object mask compose multiplicatively. |

## Migration

| Item | Behavior |
|---|---|
| Old widgets (`layerIds: null`) | Stay single-layer forever. No data migration. |
| Old persisted preferences | Untouched. |
| Tests asserting `activeLayerId` set by `addImage` / image click | Already pass — decoupled in the prior refactor's Phase 2. |
| Spawn-path tests | Updated to assert on `(imageNodeId → layerIds[])` instead of `(layerId)`. |
| LayerRow visibility eye | Stays. |

Specifically what we don't migrate: pre-existing widgets are not
backfilled with `layerIds`. They stay pinned to a single layer. Only
widgets created after this change broadcast. This keeps the migration
risk-free and matches the live-broadcast semantic — the user spawned
those widgets on a single layer, so they remain there.

## Phased build

Four small, independently-shippable phases.

### Phase 1 — Sidebar gate

Swap `RightSidebar.tsx`'s gate from `layers.length > 0` to
`activeImageNodeId !== null`. Test the unmount/remount transition.

Independent of any other change. Ships the most visible improvement
immediately.

### Phase 2 — LayerStrip role flip

Click → toggle `Layer.visible` (instead of `setActiveLayer`). Add a
right-click ContextMenu (Rename / Blend mode submenu / Lock / Delete)
that reuses existing layer mutation actions. Hover and drag-reorder
stay. Update LayerStrip tests.

Independent of the broadcast change. Visibility toggling on the strip
is useful before adjustments respond to it.

### Phase 3 — Broadcast: spawn paths ship `layerIds`

All three frontend spawn helpers (`promote.ts`,
`colour-band-spawn.ts`, `filters-tool.tsx`) build
`args.layerIds = node.layerIds` and
`args.layerId = first photo layer`. Tests assert the new request
shape. Pre-existing widgets are not migrated.

Verify the backend accepts and persists `layerIds` (the schema already
permits it; we just need to confirm round-trip).

### Phase 4 — Renderer: apply per-visible-layer

Where `useImageNodeRender` / `image-node-renderer` iterates layers and
picks up adjustments, add: "also pick up widgets whose anchoring
image-node includes this layer and where `Layer.visible === true`."
Old single-layer widgets continue to match by `layerId`.

After this phase the user can verify the full flow: spawn a widget on
a multi-layer image, toggle layers, watch the effect follow visibility.

## Tests

| Layer | Tests |
|---|---|
| `RightSidebar` | Unmounts when `activeImageNodeId === null`; remounts when it becomes non-null. |
| `LayerStrip` | Click toggles `Layer.visible`; right-click opens menu with Rename / Blend / Lock / Delete. |
| Layer tab | Visibility eye still works; click row expands details; `activeLayerId` follows the click. |
| Spawn paths | All three (`promote`, `colour-band-spawn`, `filters-tool`) ship `layerIds = node.layerIds` and `layerId = first photo layer`. |
| Renderer | A widget on image-node N broadcasts to all visible layers of N; toggling visibility flips the effect on/off live. |
| Adjustments tab header | Shows "Targets: \<object name or 'Whole image'\>" without a layer suffix. |
| Back-compat | An old single-layer widget (`layerIds: null`) renders on its single layer regardless of broadcast logic. |

## Verification

- `npm run check` green after each phase.
- Phase 1: click blank canvas → sidebar disappears; click image →
  sidebar reappears.
- Phase 2: click a layer sheet on the strip → composite shows/hides
  that layer; right-click → menu opens with the listed items.
- Phase 3: spawn a Light widget → backend snapshot shows the widget
  with `layerIds` populated.
- Phase 4: with multiple visible layers, drag the Exposure slider →
  all visible layers change; hide one → its effect drops off live;
  show it again → effect returns.

## Out of scope

- **Per-widget "single-layer pin" UI.** Solo-then-spawn is the escape
  hatch.
- **Backfilling old widgets to broadcast.** Pre-existing widgets stay
  single-layer.
- **Visibility cycling animations** beyond the existing strip motion.
- **"Solo" gesture on the strip** (Cmd/Shift+click). Future opt-in.
- **Layer-mask UI in the Layer tab** carried over from the prior
  spec's out-of-scope list.
