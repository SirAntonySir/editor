# Unified Duplicate / Copy vocabulary across layers, nodes, objects & groups

**Date:** 2026-07-07
**Status:** Draft for review
**Supersedes:** the layer/object half of
`docs/superpowers/specs/2026-07-06-object-layer-adjustment-ux-cleanup-design.md`
(Extract→Copy, layer-menu convergence). That spec was approved but never
implemented; this one absorbs and extends it to a single system covering image
nodes, groups, connected nodes, and widget/info nodes.

## Goal

One predictable vocabulary for "make a new X from an existing X" across every
canvas entity, with each verb meaning exactly one thing, and one primary
affordance (`Cmd+D`) plus per-surface menus. Resolve the current sprawl of
four verbs — **duplicate / copy / move(cut/split) / extract** — used
inconsistently for what are really only two semantics.

## Vocabulary spine

| Verb | Meaning | Source kept? | Notes |
|---|---|---|---|
| **Duplicate** | Replicate a **whole unit** into an identical sibling | ✅ yes | layer, image node, group, widget/info |
| **Copy** | Pull a **masked sub-region** out into a new layer/node | ✅ yes (source photo untouched) | renames "Extract" |
| **Move** | Relocate a unit; source loses it | ❌ no | **internal primitive only — never a user-facing verb** |
| **Rejoin** | Inverse of a provenance-linked *Copy to image node* | — | unchanged |
| **Merge / Flatten** | Combine layers down into one raster | ❌ (bakes) | unchanged |
| **Delete** | Remove | ❌ | unchanged |

**The organizing rule:** *whole unit → Duplicate; masked sub-selection → Copy.*
Every user-facing "make a new X" is **non-destructive** — the source is always
preserved. Destructive relocation (`splitImageNode`, `moveLayerToNewImageNode`)
survives only as an internal primitive, never surfaced as a menu verb.

## Entity coverage

| Entity | Op | Verb + label | New/renamed symbol | Destructive |
|---|---|---|---|---|
| Layer | → sibling sheet, same node | **Duplicate layer** | `duplicateLayer` (exists) + attach to same node | no |
| Layer | → new image node | **Duplicate to image node** | `duplicateLayerToNewImageNode` (was `copyLayerToNewImageNode`) | no |
| Object (mask) | → new layer, same node | **Copy to new layer** | `copyObjectToLayer` (was `extractObjectToLayer`) | no |
| Object (mask) | → new image node | **Copy to image node** | `copyObjectToImageNode` (was `extractObjectToImageNode`) | no |
| Image node | → deep sibling node | **Duplicate** | `duplicateImageNode` (replaces shallow `duplicateActiveImageNode`) | no |
| Group (N nodes) | → duplicated set | **Duplicate** (same verb, multi) | `duplicateSelection` | no |
| Widget node | → sibling widget | **Duplicate** | `duplicateWidget` (backend, new) | no |
| Info node | → sibling info card | **Duplicate** | `duplicateInfoNode` (frontend) | no |

## Per-entity behaviour

### Layer
- **Duplicate layer** — `duplicateLayer(sourceId)` (pixels + metadata copy) and
  append to the *same* image node's `layerIds` directly above the source. Wires
  up the currently-disabled `Layer → Duplicate Layer` MenuBar stub and adds the
  item to the LayerRow + LayerStrip context menus.
- **Duplicate to image node** — `duplicateLayerToNewImageNode(layerId, srcNodeId)`
  (rename of `copyLayerToNewImageNode`; behaviour unchanged: duplicate the layer,
  attach to a new node, keep source). Replaces **three** current items:
  "Move to own image node" (LayerStrip), "via Copy" and "via Cut" (LayerRow).

### Object (SAM mask / selection)
- **Copy to new layer** — `copyObjectToLayer` (was `extractObjectToLayer`).
- **Copy to image node** — `copyObjectToImageNode` (was `extractObjectToImageNode`);
  still sets `sourceImageNodeId` provenance so **Rejoin** works.
- The canvas drag-out gesture label `'Extract'` → `'Copy'`; `CandidateVerb`
  `'extract-node' | 'extract-layer'` → `'copy-node' | 'copy-layer'`; the LLM tool
  `extract_object_to_image_node` → `copy_object_to_image_node` (+ manifest text).
- Lower-level primitive `extractLayerFromMask` keeps its name (internal, accurate).

### Image node — **Duplicate** (deep)
Replaces today's shallow `duplicateActiveImageNode` (which flattens the primary
layer to a PNG and drops adjustments + widgets). Deep duplicate produces a new
image node that carries:
1. **All layers** — each layer duplicated (pixels + metadata) with fresh ids.
2. **All adjustments** — the source layers' `operation_graph` nodes cloned onto
   the new layer ids (backend; see below).
3. **All tethered widgets** — widgets targeting the source's layers cloned to
   target the new layers (backend; see below).
New node is placed right of the source, named `"<name> copy"` /`" copy N"`
(existing `deriveDuplicateName`). The paired layers node is created by the
existing lifecycle cascade.

### Group (multi-select) — **Duplicate**
`Cmd+D` with N selected nodes → `duplicateSelection(selectedIds)`:
- Deep-duplicate each selected **image node** (as above).
- Duplicate selected **info nodes** (frontend clone).
- Recreate tethers **among the selection** on the duplicates; tethers to
  non-selected nodes are not recreated.
- Preserve relative layout: offset every duplicate by a single fixed delta so the
  cluster keeps its shape.
- Widget nodes are not directly selectable-for-duplicate on their own here — they
  come along with their image node when that node is in the selection.

### Widget / info node
- **Info node** — `duplicateInfoNode(id)`: frontend `structuredClone` of content
  at an offset position; header/ctx menu item + palette.
- **Widget node** — `duplicateWidget(id)`: backend clone (new tool) creating a new
  widget with the same op + bindings + targets; offset position. Header/ctx item.

## Bindings

- **`Cmd+D`** — duplicate the current canvas selection, dispatched in
  `keyboard-shortcuts.ts`:
  - exactly 1 node selected → that entity's Duplicate (image node = deep;
    info/widget = its clone),
  - N>1 selected → `duplicateSelection`,
  - nothing selected → no-op (was: always active-image-node).
- **Context menus** — Layer strip/row: *Duplicate layer* · *Duplicate to image
  node*. Object: *Copy to new layer* · *Copy to image node*. Image-node header/ctx:
  *Duplicate*. Widget/info header: *Duplicate*.
- **Command palette + MenuBar `Layer` menu** — mirror the above; wire the disabled
  `Duplicate Layer` / `Delete Layer` / `Merge Visible` / `Flatten Image` stubs.

## Backend deep-duplicate (new capability)

No clone tool exists today (`backend-tools.ts` has only propose/refine/accept/
delete/set_widget_param/update_widget_targets). Deep duplicate needs a backend
tool that, given a source→target layer-id mapping, copies the pixel-affecting
state:

- **Tool:** `duplicate_layer_edits(sessionId, { mapping: Array<{ fromLayerId, toLayerId }> })`
  - For each `operation_graph` node scoped to a `fromLayerId`, emit a clone scoped
    to `toLayerId` (new node id).
  - For each **widget** whose target nodes reference `fromLayerId`, create a clone
    widget with identical op + bindings, retargeted to `toLayerId`, status active.
  - One backend revision (one undo step), returns the new snapshot.
- **Frontend contract:** the image-node/group duplicate flow (a) creates the new
  layer ids + image node in the store, (b) calls `duplicate_layer_edits` with the
  mapping, (c) lets `syncWidgetTethers` reconcile the cloned widgets' tethers from
  the returned snapshot.
- **Widget-only duplicate** (`duplicateWidget`) is the single-widget case of the
  same clone path (one widget, same layer targets, offset node position).

*The exact Python backend implementation is part of this work but will need its
own read of `backend/` during the plan; this section defines the contract the
frontend depends on.*

## Removals

- **"Split last layer"** (image-node menu) — **dropped entirely** (it was a
  destructive move; users reach the same end via *Duplicate to image node* on the
  layer row).
- **"via Cut" / `moveLayerToNewImageNode`** — removed from UI and deleted if it has
  no other callers.
- `splitImageNode` — **kept** as an internal primitive (used by merge/rejoin
  machinery), no longer surfaced as a user verb.
- Shallow `duplicateActiveImageNode` — replaced by deep `duplicateImageNode`.

## Code-level rename map

| Old symbol / label | New |
|---|---|
| `extractObjectToImageNode` | `copyObjectToImageNode` |
| `extractObjectToLayer` | `copyObjectToLayer` |
| drag gesture `label: 'Extract'` | `label: 'Copy'` |
| `CandidateVerb 'extract-node' \| 'extract-layer'` | `'copy-node' \| 'copy-layer'` |
| LLM tool `extract_object_to_image_node` | `copy_object_to_image_node` |
| `copyLayerToNewImageNode` | `duplicateLayerToNewImageNode` |
| `moveLayerToNewImageNode` | *(removed)* |
| `duplicateActiveImageNode` | `duplicateImageNode` (deep) |
| "Move to own image node" / "via Copy" / "via Cut" | "Duplicate to image node" |
| "Extract to Image Node" / "Extract to Layer" | "Copy to image node" / "Copy to new layer" |
| "Split last layer" | *(removed)* |

## Testing

- Vocabulary: no user-facing string or exported symbol contains "extract" for
  object ops; no "Cut"/"Split"/"Move" verb in any menu (grep-guard test).
- Layer duplicate: sibling lands in same node above source, source intact.
- Layer → node duplicate: new node holds a copy, source node keeps its layer.
- Object copy: `copyObjectToLayer` / `copyObjectToImageNode` behave as the old
  extract fns (reuse existing tests, renamed).
- Deep image-node duplicate: new node has N duplicated layers; a mock
  `duplicate_layer_edits` is called with the correct from→to mapping; cloned
  widgets tether to the new layers.
- Group duplicate: relative offsets preserved; intra-selection tethers recreated,
  cross-selection tethers absent.
- `Cmd+D` dispatch: 1 node → node duplicate; N → group; none → no-op.
- Info-node duplicate: content structuredClone, offset position.

## Risks / open items

- **Backend clone semantics** — cloning `operation_graph` nodes + widgets is the
  heaviest piece and the only backend surface; the tool contract above must be
  validated against `backend/` during the plan.
- **Widget identity** — cloned widgets need fresh ids and correct `origin`
  (likely `tool_invoked`/a new `duplicated` origin) so they don't read as new AI
  suggestions.
- **Undo granularity** — deep duplicate should be one undo step spanning the
  frontend node/layer creation + the backend revision.

## Out of scope

Clipboard `Cmd+C`/`Cmd+V` of nodes (distinct from Duplicate); reordering; blend/
opacity; the Rejoin/Merge/Delete mechanics (unchanged).
