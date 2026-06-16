# Image / Layer / Object — Conceptual Rework

**Status:** Design — pending implementation
**Date:** 2026-06-16
**Brainstorm:** in-session (this spec is the captured outcome)

## Motivation

The editor today has three separate "selection" concepts that don't sync and one feature flag that is on its way out:

- `workspace-slice.activeImageNodeId` — which image card on the canvas.
- `layer-slice.activeLayerId` — which layer in the layers panel.
- `selection-slice.activeScope` — a discriminated union covering mask /
  proposed-mask / named-region / image-node selection, all in one slot.

Three observable problems fall out of this:

1. **The Info tab steals focus on every new image.** `document.addImage`
   unconditionally calls `setActiveImageNode(newNodeId)`, so the Info
   tab snaps to the latest import even when the user is mid-edit on an
   earlier image. The user-visible symptom is "[Image #3] always shows."
2. **Layers don't feel intuitive.** A "Layer" today is everything at
   once: pixel container, adjustment carrier, mask owner, panel row.
3. **The drafting register has already replaced the standalone Layers
   panel as the primary navigator** (LayerStrip on the left margin,
   ObjectMarkers on the right). The panel still exists and the Classic
   variant is still branched on, leaving two answers for the same
   question.

This spec resolves all three by collapsing the model into three clean
units, deleting the Classic codepath, and replacing the standalone
Layers panel with an Inspector tab. The `.edp` save format that came up
in the same brainstorm is carved off as a follow-up.

## Conceptual model

Three units, each with one job:

| Unit | What it is | Where it lives in the drafting node |
|---|---|---|
| **Image node** | One photographic subject on the canvas. The primary selection unit. Multiple can coexist. | The whole card. Title in `TopMarginalia`, image in the frame. |
| **Pixel layer** | A stacked compositing element inside an image node: source photo, paint strokes, text, or pasted image. | Sheets in the **left margin** (`LayerStrip`). |
| **Object** | A mask + the adjustments scoped to it. SAM segments, AI regions, and brush-drawn masks all surface as Objects. The "whole image" is the implicit Object when none is selected. | Numbered markers in the **right margin** with leader lines into the image. |

**Vocabulary.** Drop "scope" from user-facing language; the user-facing
term is **Object**. The backend `Scope` type stays internal because the
operation graph already uses it.

**Adjustment binding.** Every adjustment widget binds to
`(image_node, pixel_layer, object)`. `object = null` means the whole
image. The backend already carries `layer_id` on operation-graph nodes
and `mask_ref` on widget bindings — no backend schema change.

## UI surfaces & interaction flow

| Surface | Shows | Source of truth |
|---|---|---|
| Canvas (React Flow) | Image nodes, widget nodes, tether edges. | `workspace-slice`. |
| Image node (drafting) | TopMarginalia, LayerStrip (left), image body + corner ticks → frame, ObjectMarkers + LeaderLines (right), BottomMarginalia. | Reads `layers`, `useImageNodeObjects(imageNodeId)`, `activeImageNodeId`, `activeLayerId`, `activeObjectId`. |
| Right sidebar — Inspector | Three tabs: **Info** (image-level: dims, format, AI Analyze, Regions, Color, Problems), **Layer** (per-layer compositing detail — rename, opacity, blend, layer mask, lock; no adjustments here), **Adjustments** (the widget bindings for the active `(layer, object)` pair). | Pure reads of slice + snapshot state. |
| Left rail — Toolrail | Six tools (Light / Color / WB / Curves / Levels / Filters). Gated on `activeImageNodeId` and `sseStatus === 'open'`. | Unchanged. |
| Standalone Layers panel | — | **Removed.** Its job moves to the on-node `LayerStrip` (navigate) and the Inspector → Layer tab (detail). |

**Selection flow** — one rule per click:

| Click target | State change | Side-effect |
|---|---|---|
| Image node body | `activeImageNodeId = id`; `activeLayerId = first layer of node`; `activeObjectId = null` | Inspector retargets; toolrail enabled. |
| Layer sheet (LayerStrip) | `activeLayerId = id` | Inspector → Layer & Adjustments tabs retarget. ImageNode stays. |
| Object marker | `activeObjectId = id` | Inspector → Adjustments tab narrows to that mask. LeaderLine + marker light. Re-click same marker = back to whole image. |
| Canvas blank | All three cleared. | Toolrail disabled; Inspector empty state. |
| New image added | Node lands at the right of the rightmost node. **Selection unchanged.** Toast: "Image added — click to edit." If nothing was selected, the new node *does* activate. | — |

The [Image #N] bug is a behavior change in one place: `document.addImage`
only calls `setActiveImageNode(newNodeId)` when
`activeImageNodeId === null`.

## Data model & state ownership

**Frontend slices**

| Slice | Today | Change |
|---|---|---|
| `workspace-slice` | `imageNodes`, `widgetNodes`, `tetherEdges`, `activeImageNodeId`. | `addImageNode` no longer force-sets `activeImageNodeId`. Toast event for non-stealing adds (collapses on burst). |
| `layer-slice` | `layers[]`, `activeLayerId`. | No schema change. Standalone panel is deleted; strip + Inspector read the same state. |
| `selection-slice` | `activeScope` (discriminated union), `hoveredScope`, `focusedWidgetId`, `cycleStack`. | **Collapse** `activeScope` → `activeObjectId: string \| null`. `hoveredScope` → `hoveredObjectId`. The `image_node` variant disappears (lives in `workspace-slice`). `cycleStack` + `focusedWidgetId` stay. |
| `preferences-store` | `visualStyle: 'classic' \| 'drafting'`. | **Remove** the field. Persist migrator deletes the key. |

Collapsing `activeScope` is the largest mechanical change. The
discriminated union let "select a mask" and "select an image node" share
a slot, but the new model puts them in different slices — no contention.

**Pixel data & masks** (unchanged; for reference)

| Store | Owns |
|---|---|
| `pixelStore` | `Map<layerId, { source, working }>` OffscreenCanvas pairs. |
| `maskStore` | `Map<maskRef, Mask>` alpha bitmaps + provenance (`layerId`, `source`). |

**Backend `SessionStateSnapshot`** — `operation_graph.nodes[*].layer_id`
and per-widget mask bindings already exist. No backend change.

**Object identity** — `Object` is not a new entity. It's the union of
mask sources surfaced by `useImageNodeObjects(imageNodeId)`:
`{ source: 'sam' | 'ai-region' | 'brush' | 'whole-image', maskRef? }`.
`activeObjectId === null` denotes whole-image; no special-casing.

## Edge cases & errors

| Case | Behavior |
|---|---|
| Object marker references a deleted mask | Removed during snapshot reconciliation. If `activeObjectId` pointed at it, clears to `null`. |
| `activeImageNodeId` points at a deleted node | Cleared on the same tick. |
| Image added while backend SSE is down | Image lands and is editable for pixel-level ops (positioning, deletion). Adjustments stay gated by `sseStatus`. When reconnected, the image uploads in the background. |
| Image node with zero layers | Cannot exist. Removing the last layer of a node deletes the node. |
| Two new images dragged in fast succession | Both land; selection stays put. Toast collapses to "2 images added." |
| Persisted preferences carry `visualStyle: 'classic'` | Persist migrator drops the key; default behavior continues. |

## Migration / cleanup

Files / areas touched by Classic removal and panel deletion:

| File / area | Action |
|---|---|
| `src/components/workspace/ImageNode.tsx` | Inline `ImageNodeDrafting` directly. Delete `ImageNodeClassic` and the branch wrapper. |
| `src/store/preferences-store.ts` | Drop `visualStyle` field + setter. Persist migrator bump. |
| `src/store/preferences-store.test.ts` | Remove visualStyle tests. |
| `src/components/PreferencesPage.tsx` | Remove the Visual Style toggle. |
| `src/components/workspace/ObjectModeFooter.tsx` | Delete. Drafting uses `BottomMarginalia`. |
| `src/index.css` | Remove `[data-visual-style="classic"]` block. Promote drafting tokens to root. |
| `ImageNodeObjectsLayer`, `SegmentMaskPreview`, `TopMarginalia` (classic conditionals) | Inline the drafting branch; delete the other. |
| `src/components/panels/LayersPanel.tsx` + tests | Delete. |
| Inspector | Add the **Layer** tab consuming the same `layer-slice` state the old panel did. |
| Consumers of `activeScope` / `hoveredScope` | Migrate to `activeObjectId` / `hoveredObjectId`. Audit: `ObjectMarkers`, `SegmentHitLayer`, `useImageNodeObjects`, `useWorkspaceSelection`, inspector adjustments. |

## Phased build

Five small, independently-shippable phases.

### Phase 1 — Selection slice collapse

Replace `activeScope` with `activeObjectId: string | null`. Update
`hoveredScope` → `hoveredObjectId`. Migrate all consumers. Pure
refactor; no user-visible change.

### Phase 2 — Info tab + add-image fix

`document.addImage` only auto-activates when `activeImageNodeId === null`.
Toast event for non-stealing adds (collapses on burst). `InfoTab`
subscribes strictly to `activeImageNodeId`. Smallest user-visible win.

### Phase 3 — Classic deletion

Remove `ImageNodeClassic`, `visualStyle` field, classic CSS block,
Preferences toggle, `ObjectModeFooter`, classic conditionals. Promote
drafting tokens to root. Preferences persist migrator.

### Phase 4 — Inspector Layer tab + delete standalone Layers panel

Add Layer tab to Inspector (rename, opacity, blend, layer mask, lock).
Delete `LayersPanel.tsx` and its tests. Wire layouts so the panel slot
collapses. Layer mask here is the existing `Layer.layerMask` (a
Photoshop-style compositing mask on the pixel layer), distinct from an
Object (an adjustment-scope mask).

### Phase 5 — Adjustment binding alignment

Audit the three `propose_widget` spawn paths (Cmd+K palette, backend
autonomous analyze, toolrail) so every call ships an explicit
`(layer_id, object_id?)` pair derived from `(activeLayerId, activeObjectId)`.
Today these paths can fall back to "the first layer of the active node"
without surfacing the choice in the request; after this phase, the
request and the UI agree on what's bound. Inspector "Adjustments" tab
shows the current binding plainly ("Sky on Photo base layer"). Tests
for all three paths.

## Tests

| Layer | Tests |
|---|---|
| `selection-slice` | `activeObjectId` set/clear; clearing follows mask removal; `null` means whole image. |
| `workspace-slice` | `addImageNode` does NOT auto-activate when something is already active; DOES activate when nothing is. |
| `InfoTab` | Renders for `activeImageNodeId`; doesn't snap to newest on add. |
| `LayerStrip`, `ObjectMarker`, `LeaderLines` | Existing drafting tests stay. Adapt the "Layers panel" tests into "Inspector → Layer tab" tests. |
| Inspector → Layer tab | Mount with multiple layers, click each, verify per-layer detail updates. Rename, opacity, blend, lock all mutate `layer-slice`. |
| Spawn paths | Cmd+K, autonomous, and toolrail all call `propose_widget` with an explicit `(layer_id, object_id?)` derived from the active selection. |
| Preferences migrator | Persisted state with `visualStyle: 'classic'` loads cleanly with the field dropped. |

## Verification

- `npm run check` green after each phase (tsc + eslint + no-nested-component).
- Manual: add a new image while a different node is active — selection holds; toast appears.
- Manual: click an Object marker, drag a curves slider — the curve binds to that mask. Re-click the marker to clear; the next slider binds to whole image.
- Manual: open the Inspector → Layer tab on a multi-layer image — rename, opacity, blend, lock all work.
- Visual: confirm there is no remaining Classic codepath (`grep -ri "visualStyle\|ImageNodeClassic\|classic"` in `src/` yields nothing except migration tests).

## Out of scope

- **`.edp` save/open format** — sources + recipe, mask prompts as
  source of truth with raster cache, flat export separate. Carved off
  as a follow-up spec so the schema, migration story, and worker
  pipeline get full attention.
- **Brush / text pixel layers gaining their own adjustment graph.**
  Today and after this spec, only the photo base layer carries one.
  This is a real future feature, not a regression.
- **Multi-image Objects.** Objects live on one image node; cross-node
  masks are a separate idea.
