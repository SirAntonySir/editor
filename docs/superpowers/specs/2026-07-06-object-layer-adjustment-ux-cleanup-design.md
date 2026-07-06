# Object / Layer / Adjustment UX cleanup

**Date:** 2026-07-06
**Status:** Approved (design) — pending spec review before implementation plan.
**Scope:** Four independent, low-risk UX cleanups on the canvas + inspector:
A. Rename object "Extract" → "Copy" (labels + code).
B. Rename layer "Move to own image node" → "Duplicate", non-destructive; converge the
   two layer menus onto one op; drop the destructive move from the UI.
C. Add a visibility eye on the widget tether edge (keep the header eye).
D. Remove "Convert to Layer Mask" entirely (UI + action + LLM tool + agent + tests).

These share no state and can land in any order, but are specced together as one
cleanup pass. Each is small.

---

## Background / current state

The vocabulary for "make a new node/layer from X" is inconsistent:

- **Object ops** (on a segmented mask): `extractObjectToImageNode`,
  `extractObjectToLayer`, drag gesture labelled `'Extract'`, verbs
  `'extract-node' | 'extract-layer'`, LLM tool `extract_object_to_image_node`.
- **Layer ops**, split across two menus:
  - Inspector `LayerRow` context menu: **"via Copy"** →
    `copyLayerToNewImageNode` (non-destructive) and **"via Cut"** →
    `moveLayerToNewImageNode` (destructive).
  - Canvas `LayerStrip` context menu: **"Move to own image node"** →
    `splitImageNode` (destructive).
- `splitImageNode` is the store primitive underneath the destructive paths and is
  also used by `ImageNodeDrafting` and the `editorDocument.workspace` facade.

Two visibility eyes exist:

- Adjustment widget eye — `WidgetShellHeader` (canvas widget header), toggles
  `hiddenWidgetIds` via `toggleWidgetHidden`.
- Extracted-node **edge** eye — `TetherEdge.tsx` renders a mirror-preview toggle at
  the edge midpoint (via `EdgeLabelRenderer`) for `variant === 'extracted'` edges,
  bound to `mirrorPreview[extractedChildId]` / `toggleMirrorPreview`.

"Convert to Layer Mask" is a fully client-side feature (no backend Python), reachable
from 4 menus, one action function, one candidate verb, and one registered LLM tool.

---

## A. Object "Extract" → "Copy" (full rename)

Rename user-facing labels **and** internal symbols so UI and code agree (no lingering
"extract" in code). Both targets are kept (image node + new layer).

**Labels**

| Current | New |
|---|---|
| `Extract to Image Node` | `Copy to Image Node` |
| `Extract to new layer`  | `Copy to new layer` |
| drag gesture `label: 'Extract'` | `label: 'Copy'` |

Label sites: `ObjectMarkers.tsx`, `SegmentHitLayer.tsx`, `ImageNodeObjectsLayer.tsx`,
`ImageNodeDrafting.tsx`, drag label in `SegmentHitLayer.tsx:141`.

**Symbols**

| Current | New |
|---|---|
| `extractObjectToImageNode` | `copyObjectToImageNode` |
| `extractObjectToLayer` | `copyObjectToLayer` |
| `CandidateVerb 'extract-node' \| 'extract-layer'` | `'copy-node' \| 'copy-layer'` |
| LLM tool `extract_object_to_image_node` | `copy_object_to_image_node` |
| `AGENT_LOOP_TOOLS` entry | updated to new tool name |
| `ClientToolApproval` string for the tool | updated wording |

Update all imports, the verb router in `candidate-actions.ts`, the tool-manifest file
(rename file + `name`), `tool-manifest/index.ts` registration, and all tests that
reference the old names. `extractLayerFromMask` (in `segment-actions`) is a different
lower-level primitive — leave its name unless it reads confusingly at the call site;
default: leave it.

---

## B. Layer "Move to own image node" → "Duplicate" (non-destructive, converged)

Single non-destructive layer op, one label, wired to the existing non-destructive
function (renamed for consistency).

- Rename `copyLayerToNewImageNode` → `duplicateLayerToNewImageNode` (behavior
  unchanged: `duplicateLayer` + attach to a new standalone image node; source keeps
  its layer).
- **Canvas `LayerStrip.tsx:206`**: replace `splitImageNode(imageNodeId, layer.id)`
  ("Move to own image node") with `duplicateLayerToNewImageNode(layer.id, imageNodeId)`
  labelled **"Duplicate to image node"**.
- **Inspector `LayerRow.tsx`**: relabel "via Copy" → **"Duplicate to image node"**
  (now `duplicateLayerToNewImageNode`); **remove the "via Cut" item**.
- **Remove `moveLayerToNewImageNode`** (its only UI caller was "via Cut"). Confirm no
  other references before deleting.
- **Keep `splitImageNode`** — still used by `ImageNodeDrafting.tsx:290` and the facade;
  it is no longer surfaced as a user "move" menu item.

Result: both layer menus expose exactly one "Duplicate to image node" (non-destructive);
no destructive layer-move remains in the UI.

---

## C. Visibility eye on the widget tether edge

Add a second visibility toggle on the widget-attribution tether edge, mirroring the
extracted-node edge eye. The header eye stays (both drive the same state).

- In `TetherEdge.tsx`, for **widget-attribution** edges (the default variant carrying a
  `widgetId` in `edge.data`, i.e. `variant !== 'extracted'`), render an eye button at
  the edge midpoint using the same `EdgeLabelRenderer` + 18px circular button pattern as
  the mirror eye (`nodrag nopan`, accent when active).
- Bind it to `hiddenWidgetIds.has(widgetId)` / `toggleWidgetHidden(widgetId)` — the same
  state the `WidgetShellHeader` eye uses, so header and edge stay in sync.
- `Eye` when visible, `EyeOff` when hidden (matches the header eye semantics; the mirror
  eye only uses `Eye`, but this toggle represents hide/show so it should show both).
- Multi-target widgets have several tether edges → each shows the eye and reflects the
  same per-widget hidden state. Acceptable (visibility is per-widget, not per-target).
- Guard: only render when `edge.data.widgetId` resolves to an active widget.

No new store state.

## D. Remove "Convert to Layer Mask"

Full removal — the feature has no remaining use case.

**UI labels (remove the menu items):**
- `ImageNodeObjectsLayer.tsx:249–251`
- `SegmentHitLayer.tsx:610–612`
- `ObjectMarkers.tsx:336–338`
- `ImageNodeDrafting.tsx:411–416`
- Remove the now-unused `convertObjectToLayerMask` import in each.

**Action + verb:**
- Delete `convertObjectToLayerMask` from `object-actions.ts:129–171`.
- Remove `'convert-mask'` from `CandidateVerb` and its branch in
  `candidate-actions.ts` (+ the import).

**LLM tool / agent:**
- Delete `tool-manifest/tools/convert-object-to-layer-mask.ts` and its `.test.ts`.
- Remove import + registration in `tool-manifest/index.ts`.
- Remove `'convert_object_to_layer_mask'` from `AGENT_LOOP_TOOLS`
  (`palette-actions.agent.ts`).
- Remove the client-approval string in `ClientToolApproval.tsx:93` and its test case
  (`ClientToolApproval.test.tsx:57`).

**Tests:**
- Remove the `convertObjectToLayerMask` describe block in `object-actions.test.ts`.
- Remove `'convert-mask'` cases in `candidate-actions.test.ts`.
- Update `client-tool-approval-slice.test.ts` if it references the tool.

**Docs:** grep `docs/` for `convert_object_to_layer_mask` / "Convert to Layer Mask" and
prune stale references.

---

## Testing

- **A:** unit tests for the renamed action functions + verb router still pass under new
  names; tool-manifest test asserts the new tool `name`. A grep gate: no `extractObjectTo`
  / `'extract-node'` / `'extract-layer'` / `extract_object_to_image_node` remain.
- **B:** test that the layer "Duplicate" menu calls `duplicateLayerToNewImageNode` and the
  source layer still exists on the source node afterward (non-destructive); no UI path
  calls `moveLayerToNewImageNode`.
- **C:** `TetherEdge` renders an eye on a widget-attribution edge; clicking it flips
  `hiddenWidgetIds` for that `widgetId`; extracted edges still render the mirror eye
  (unchanged).
- **D:** grep gate that `convert` / `'convert-mask'` / `convert_object_to_layer_mask` are
  gone from `src/`; the deleted-tool test files are removed; suite green.

## Out of scope

- No change to `splitImageNode` behavior or the object segmentation pipeline.
- No new per-target (per-tether) visibility state — the edge eye reuses per-widget
  visibility.
- No renaming of lower-level primitives (`extractLayerFromMask`, `duplicateLayer`) unless
  a call site reads confusingly.
