# Recent Changes — Handover (2026-07-08)

> **Purpose.** Delta handover for everything that landed *after* the
> 2026-07-06 (part B) handover (`docs/recent-changes-handover-2026-07-06b.md`,
> tip `22a05b7`). **30 commits, now on `main`, tip `b1e3c7e`**, pushed to
> `origin/main`. Working tree clean.
>
> Same convention as the other dated handovers: this is the **delta** — what
> changed, why, and where to look. Ordered by importance; a chronological commit
> index closes the document.
>
> Big picture: this batch is dominated by a **Duplicate/Copy vocabulary
> unification** (with a real deep-clone backend tool behind it), the promotion
> of the layer strip to a **first-class "layers" node**, a **hover-only mask**
> rework, and a cluster of **SSE / selection / provenance correctness fixes**
> shaken out of session forensics.

---

## 1 · Unified Duplicate/Copy vocabulary + deep duplicate + backend clone tool

Spec: `docs/superpowers/specs/2026-07-07-duplicate-copy-vocabulary-design.md`
(`95c0909`, supersedes the earlier object-layer cleanup spec). Landed across
four chunks (A+B `8165c4f`, C `ec3e72b`, D backend `395bd84`, menubar `b57516d`)
plus the reversible-Copy follow-up (`935c889`).

**One verb system across the whole workspace:** a *whole unit* (layer, image
node, group, info/widget node) → **Duplicate**; a *masked sub-region* → **Copy**
(was "Extract"); destructive **Move** is now internal-only.

**Objects (Extract → Copy), end to end (`8165c4f`):**
- `extractObject*` → `copyObjectToImageNode` / `copyObjectToLayer`.
- LLM tool `extract_object_to_image_node` → `copy_object_to_image_node`
  (file renamed, backend guidance strings updated).
- `CandidateVerb` now `'copy-node' | 'copy-layer'`; drag-out ghost label "Copy";
  all user strings → "Copy to image node" / "Copy to new layer".
- Internal primitives kept: `extractLayerFromMask`, drag/provenance, Rejoin.

**Layers converge to non-destructive Duplicate (`8165c4f`):**
- LayerStrip/LayerRow: "Duplicate layer" (in-place sibling) +
  "Duplicate to image node" (`duplicateLayerInPlace` /
  `duplicateLayerToNewImageNode`).
- Removed destructive "via Cut" (`moveLayerToNewImageNode` deleted),
  "Move to own image node", "Split last layer". `splitImageNode` retained as an
  internal primitive only.

**Deep image-node / group duplicate (`ec3e72b`):**
- `duplicateImageNode` — deep-duplicates a whole node: every layer copied
  (pixels + metadata) with a source→target layer mapping; adjustments + tethered
  widgets carried via the backend `duplicate_layer_edits` call. Replaces the old
  shallow flatten-to-PNG `duplicateActiveImageNode`.
- `duplicateSelection` — group duplicate of a multi-node selection at a uniform
  offset; co-selected info nodes repoint their tether at the duplicated node.
- **Cmd+D is now canvas-scoped + selection-aware** (`WorkspaceKeyHandler`):
  1 node → deep duplicate, N → group. The global chord was removed to avoid
  double-fire.

**Backend clone tool (`395bd84`) — the engine SSoT half:**
`SessionDocument.duplicate_layer_edits` + REST tool. Given a source→target layer
mapping, clones pixel-affecting state onto the target layers as an **independent
clone** (editing the copy never touches the original):
- canonical: deep-copy every baked (op, param) on the source layer;
- widgets: clone each ACTIVE widget targeting the source with a fresh widget id +
  remapped node ids, retargeted to the new layer only; bindings follow the
  remapped node ids;
- emits `widget.created` per clone (or one `history.applied` when only baked
  canonical was copied) so the frontend gets a fresh op_graph.
- 4 new state tests + full backend suite (482) green.

**Menu wiring (`b57516d`):** Layer menu Duplicate/Delete/Merge Visible hooked to
the active layer's owning image node (`duplicateLayerInPlace` / `removeLayer` /
`mergeVisibleLayers`). **New Layer / Flatten Image remain stubs.**

**Reversible Copy (`935c889`) — supersedes the live-linked draft (rejected):**
Copy no longer bakes the source grade into flat pixels. `extractLayerFromMask`
gained `rawPixels` (clip the source's RAW canvas, not the rendered composite, so
cloned adjustments don't double-grade); `copyObjectTo*` then fires
`duplicate_layer_edits` to clone the source's adjustments onto the cutout as its
**own** independently-editable widgets. Copy looks identical to the source region
but its grade is separate. Fire-and-forget; **offline the copy is raw pixels
only.** The earlier `adjustmentSourceLayerId` live-link approach in
`0c42961`/`docs/…-reversible-copy-design.md` was rejected — spec was rewritten to
match the as-built.

---

## 2 · LayerStrip → standalone moveable "layers" node (`bdd7033`, `0936c29`, `b1e3c7e`)

Spec: `docs/superpowers/specs/2026-07-07-layers-node-design.md`.

The layer strip is no longer a gutter baked into the image node — it's a
first-class React Flow node, **one per image node** (`id: layers-<imageNodeId>`).

- **Tethers.** Widget→layer tethers land on the layers node's per-layer ports
  (rendered target reroutes to it; **stored scope + backend resolution keep
  keying on the image node** — no backend change). A single auto-routed
  attribution tether links the layers node to its image node; its four side
  anchors are invisible + non-connectable.
- **Lifecycle** cascades off image-node ops (create on add/split, remove on
  remove/merge, cleared on reset), back-filled for restored sessions, captured
  in undo/redo snapshot + `.edp` persistence. Selecting a layer now also focuses
  its image node.
- **Polish (`0936c29`):** hide the layers node when its image node has ≤1 layer
  (redundant) — tethers fall back to a per-layer port on the single-layer image
  node's body; context menu got icons + "Merge visible layers"; removed the
  non-functional Lock/Unlock; tether ports now straddle the node's left border
  like other outlets (padding moved onto rows; `LayerNode` re-measures RF handle
  geometry on layer-set changes).
- **Study gate (`b1e3c7e`):** the layers node is a *working-with-widgets*
  affordance, so it's now gated on `aiAccess` — the **baseline condition runs
  layer control through the inspector Layer tab**; the strip re-appears when AI
  is enabled. `LayerThumb` also switched to contain-fit (letterbox) so portrait
  layers show whole instead of cropped. `ai-access.ts` doc updated.

---

## 3 · Hover-only object masks + cursor tooltip (`3240401`)

Spec: `docs/superpowers/specs/2026-07-08-hover-only-mask-overlay-design.md`
(`c8b2147`).

Persistent masks were tinting the photo and **obscuring the very edit the
selection produced**. Now:
- `ImageNodeObjectsLayer` paints only the **hovered** object (plus the one whose
  context menu is open), dropped to `z=4` so the cursor tooltip
  (`SegmentHitLayer`, `z=5`) renders above the mask. The renderer overlay pass is
  hover-only too; the in-progress SAM/lasso draft still always shows. The interim
  `maskOverlayMuted` gate became dead code and was removed.
- Object names moved off-canvas into a **cursor-following glass tooltip** shown
  while hovering the mask pixels.
- Right-gutter numbered markers removed; `ObjectMarkers` survives only as the
  transient inline-rename input (context-menu Rename) — note the file shrank
  ~366→small.
- Extracted children now default to **mirror-preview ON**; the provenance-edge
  toggle still turns it off.
- New helper `src/lib/overlay-visibility.ts` (+ tests) centralises the hover/menu
  visibility decision; `selection-slice` + `workspace-slice` gained the small
  hover-state additions.

---

## 4 · Tag-selection segmentation: box+point SAM + "Draw it myself"

Spec: `docs/superpowers/specs/2026-07-07-bbox-tag-selection-design.md`
(`e20f51f`, synced to as-built in `86db7ac`).

- **Box+point SAM prompt (`fee7736`).** Tag selections (forced-extraction agent
  path) fed SAM only the region's representative point; every candidate region
  already carries a Claude-computed bbox that went unused. Threaded it through
  `planForcedExtractions` → `segmentRegionFromPoint` to build a box+point prompt
  (box bounds the object, point anchors it). If the combined mask fails
  `isMaskAcceptable`, it retries point-only — never worse than before.
- **"Draw it myself" — moved to a post-result per-object action (`ad6f352`,
  reverts the approval-gate version `312d9c4`).** The approval-gate choice fired
  *before* the auto-selection was visible and multiplied one chip per pending
  region. Now `redrawObject(maskId, imageNodeId)` lives in the per-object
  right-click menu (marker, label chip, drafting selected-object menu): drops the
  bad mask (`deleteObject`) and arms the node for a fresh magic-lasso draw
  (objects mode + magic tool). Exists only after the selection is committed +
  visible, once per object.
- **"Draw it myself" on extracted nodes (`68d2351`).** The Node-extraction choice
  bakes the selection into a *new image node*, whose own menu couldn't reach the
  per-object item. Added it beside "Rejoin source image" (gated on
  `sourceImageNodeId`); `redrawExtractedNode()` discards the extracted node
  (cutout + AI edits — clean start-over, not a rejoin) and arms the source node
  for a fresh draw.

---

## 5 · Autonomous suggestions are now opt-in (`1b9d3f7`)

Spec: `docs/superpowers/specs/2026-07-08-decouple-suggestions-design.md`
(`a47b40d`). Frontend-only; backend tools unchanged.

Decouples suggestions from analyze **and** from direct prompts — this removes the
main source of stray suggestion chips:
- `runAnalyse` default flips `suggest: true → false`, so every "Analyze with AI"
  trigger builds context + regions only, never fires `suggest_widgets`.
- New `suggestForImageNode()` is the **sole explicit suggestion trigger**
  (analyzes first when needed, else calls `suggest_widgets` directly). Wired to a
  new **"Suggest something"** item in the image-node menu.
- `submitAgentPrompt` now dismisses pending suggestions
  (`dismissAllPendingSuggestions` **denies** each via `delete_widget`, not just
  un-pends) so a direct prompt never trails suggestions.

---

## 6 · SSE self-heal + dismissed-widget guard (`2c3e2ce`)

Rooted in **session-87f7dd2e forensics** (see `[[project_session_forensics.md]]`):
the SSE stream died silently while REST kept working, leaving the frontend
editing a frozen snapshot for 26 min (zombie widget: dead deny, snap-back edits).
Guards in depth:
- `ToolResponseEnvelope.revision` + `probeLiveness()`: **every tool response
  doubles as a liveness probe** — if the backend is ahead and no event closes the
  gap within 2s, refetch the snapshot.
- `setSnapshot` floor guard: never replace with an older revision.
- `widget.created` dedup by id (parity with the earlier `mask.created`
  hardening).
- Backend rejects `set_widget_param` / `accept_widget` on **dismissed** widgets
  with a typed `widget_dismissed` error instead of silently editing a ghost
  (new `test_dismissed_widget_guard.py`).

---

## 7 · Selection / provenance / session correctness fixes

A cluster of small but load-bearing fixes, mostly fallout from the deep-duplicate
work:

- **Widget targets resolved from the replicate set, not the frozen `layerId`
  (`a3a23f8`).** New `widgetTargetLayerIds()` helper (`layerIds ?? [layerId]`,
  matches `[[project_widget_target_layers.md]]`) used by `WidgetNode` dimming +
  `ImageNodeDrafting`'s unapplied-changes check, so widgets tethered *after*
  spawn stop rendering muted/unrecognised. Backend `update_widget_targets`
  repoints the singular `layer_id` anchor when a connection change drops it out
  of the target set, so canon keys / per-op panels / refine writes follow a moved
  widget.
- **`activeLayerId` ⇄ `activeImageNodeId` kept in lock-step (`8c28ac8`).**
  `setActiveLayer` retargets the active image node to the one owning the layer;
  Cmd+D adopts the copy as the active selection once its node exists. Fixes edits
  showing in the inspector preview but not on the selected canvas image after
  duplicating.
- **Cloned adjustments re-originned as `tool_invoked` on duplicate (`1fbd035`).**
  Clones kept their `mcp_autonomous` origin, so the frontend treated the copy as a
  pending suggestion and the renderer hid it (copy showed raw pixels only).
  Provenance preserved via `parent_widget_id`.
- **`awaitSession()` readiness gate (`6166960`).** `useAiSession.awaitSession()`
  resolves the session id immediately when open, waits for an in-flight bootstrap
  when uploading, else resolves null. Lets pre-`openSession` callers (e.g.
  `addImage` during a multi-file drop) persist/upload under the right session
  instead of silently dropping it. Wired through `core/document.addImage`.
- **Point-tool decode debounce (`fac4b1f`).** `runDecode` ignores clicks while a
  SAM decode is pending (`decodingRef`), re-enabling when the result lands — no
  more stacked in-flight decodes from click-spam. Covers fresh + shift-click
  refinement; magic-lasso (draw-based) unaffected. *(Likely resolves the
  "MobileSAM in-flight" bug carried in the 07-06 handovers — see §10.)*

---

## 8 · Widget shell compaction (`b2ba40a`)

The mechanical **"Auto"** button moved off its own row into the per-widget action
strip (beside Reset); strip vertical padding tightened (`py-0.5 → py-px`). Removes
a full row from expanded flat-body widgets. Auto visibility unchanged (unpinned
flat-body widgets only) via a new `showAuto` gate. Bundled minor edits to
CommandPalette, RegionSuggestions, InfoNode, LayerStrip, genfill-spawn,
prompt-doc, index.css.

---

## 9 · Specs written, NOT yet implemented

- **Refine-widget feedback via command-palette pill** —
  `docs/superpowers/specs/2026-07-07-refine-widget-feedback-design.md`
  (`b5f168f`). **Spec only, no implementation.** Pick this up from the spec.
- **Magic lasso** — `docs/superpowers/specs/2026-07-07-magic-lasso-design.md`
  (`29542aa`). The module (`src/lib/segmentation/magic-lasso.ts`), the `'magic'`
  tool state, and the "Draw it myself" arming paths **are wired** (bundled into
  `8165c4f`/`fee7736`/§4). Cross-check the spec against the as-built before
  assuming full coverage — parts may still be in progress.

---

## 10 · Carried-forward bug status (from the 07-06 handovers §8/§2)

- **MobileSAM in-flight** — very likely **fixed** by `fac4b1f` (§7); confirm in
  the real app with rapid point-tool clicking.
- **`analyze_context` 500/CORS** — **not addressed this batch.** Still open.
- **Open-file decode** — **not directly addressed**, though `awaitSession`
  (`6166960`) touches the multi-file open/upload path; confirm whether the decode
  symptom persists.
- **Atelier results-list scroll fix** (07-06b §2) — still **needs one real-app
  confirmation** (wheel-over-list + wheel-over-input in Edit mode with enough
  rows to overflow). No further change this batch.

---

## Chronological commit index (22a05b7 → b1e3c7e, newest first)

```
b1e3c7e feat(study): withhold canvas layers node in baseline; contain-fit layer thumbs
3240401 feat(masks): hover-only object masks, cursor name tooltip, rename-only gutter
2c3e2ce fix(sse): self-heal snapshot divergence; reject mutations of dismissed widgets
a3a23f8 fix(widgets): resolve widget targets from the replicate set, not the frozen layerId
8c28ac8 fix(selection): keep activeLayerId and activeImageNodeId in lock-step
c8b2147 docs: spec for hover-only mask overlay + cursor tooltip
6166960 feat(session): awaitSession readiness gate for pre-openSession callers
1fbd035 fix(backend): re-origin cloned adjustments as tool_invoked on duplicate
fac4b1f fix(segment): block point-tool click spam while a decode is in flight
1b9d3f7 feat(ai): make autonomous suggestions opt-in; add 'Suggest something'
a47b40d docs: spec for decoupling autonomous suggestions from analyze + prompts
68d2351 feat(segment): 'Draw it myself' on extracted tag-selection nodes
ad6f352 feat(segment): move 'Draw it myself' to a post-result per-object menu action
86db7ac docs: sync tag-selection spec with as-built (approval-gate Draw choice)
312d9c4 feat(segment): 'Draw it myself' manual-draw escape hatch for tag selections
fee7736 feat(segment): box+point SAM prompt for tag selections
e20f51f docs: spec for box+point tag selection + 'Draw it myself' fallback
b5f168f docs: spec for refine-widget feedback via command-palette pill
935c889 feat(copy): reversible Copy — raw pixels + independent clone of source adjustments
0c42961 docs: spec for reversible (live-linked) Copy of a masked selection
0936c29 feat(workspace): layers-node polish — single-layer handling, menu icons, tether alignment
b57516d feat(menubar): wire Layer menu Duplicate/Delete/Merge Visible to the active layer
395bd84 feat(backend): duplicate_layer_edits clone tool for deep Duplicate (Chunk D)
ec3e72b feat(duplicate): deep image-node duplicate, group duplicate, context-aware Cmd+D (Chunk C)
8165c4f feat(vocab): unify object Copy + converge layer Duplicate menus (Chunks A+B)
95c0909 docs: unified Duplicate/Copy vocabulary spec (supersedes object-layer cleanup)
bdd7033 feat(workspace): promote LayerStrip to a standalone moveable "layers" node
29542aa docs: magic lasso design spec
f39c533 docs: spec for LayerStrip → standalone moveable "layers" node
b2ba40a feat(widget): host Auto pill inline on action strip, tighten padding
```
