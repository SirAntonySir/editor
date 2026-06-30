# Direct-Action Segmentation (no Save/Cancel) — Design Spec

**Date:** 2026-06-30
**Status:** Approved (pending spec review)
**Scope:** Frontend (`src/`) — segmentation candidate flow. No backend changes.

## 1. Summary

Today a SAM pick produces a **candidate** mask that the user must explicitly
**Save** (or Cancel) before it becomes usable. Save (`commitCandidate` in
`SegmentHitLayer.tsx`) is the only thing that calls `propose_mask`, registers
the mask, auto-names it, and makes it the active scope.

This intermediate Save/Cancel step ("Zwischenschritt") is removed. A SAM pick
produces a **live selection** — a transient mask that is *only a mask until you
act on it*. The user works with it directly: right-click offers the real action
verbs, and **committing becomes a side-effect of whichever verb is chosen**
rather than a separate step.

This also eliminates a latent problem in the current flow: a "Saved" mask the
user never uses becomes an orphaned committed Object. In the new model an unacted
selection simply evaporates — nothing is registered, nothing to clean up.

## 2. Locked decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Save/Cancel step | **Removed.** Replaced by a direct action menu on the selection. |
| When the mask commits | **Lazily, inside each committing verb** (extract / convert), not as a separate step. |
| Adjusting *just a selection* | **Via "Convert to Layer Mask" first** (choice A). A bare selection is not a toolrail/Cmd+K target. |
| Select Inverted | Transforms the live selection into its inverse; **stays transient (no commit)**. |
| "Extract to new layer" vs "Convert to Layer Mask" | **Distinct.** Convert = non-destructive masked duplicate (looks unchanged until edited; for selection-scoped edits). Extract to new layer = baked cutout (visible isolation). Both offered. |
| After a permanent action | Drop back to **layers mode** (user is done segmenting). |
| Backend disconnected | Extract/Convert verbs unavailable; **Select Inverted still works** (local-only). |
| Refine | Unchanged — Shift+click adds/removes SAM points. |
| Discard | Esc, click empty area, or start a new pick. No cleanup needed. |

## 3. Behavior

A SAM pick (objects mode, plain click) → live selection (live SAM preview).

- **Refine:** Shift+click appends a point (positive outside the mask, negative
  inside) and re-decodes. Unchanged.
- **Discard:** Esc, an empty-area click, or a fresh pick clears the selection.
  Nothing was registered, so there is no orphaned mask.
- **Right-click on the selection → action menu** (replaces Save/Cancel):
  - **Extract to new layer** *(new)* — baked cutout into a new layer on top of
    the source layer, **same image node**. Permanent.
  - **Extract to new image node** *(exists)* — baked cutout into a new node.
    Permanent.
  - **Convert to Layer Mask** *(exists)* — non-destructive masked duplicate
    layer; adjusting that layer edits only the selection. Permanent.
  - **Select Inverted** *(exists, reworked)* — replaces the live selection with
    its inverse. Transient.

## 4. Architecture & component boundaries

### 4.A `materializeCandidate` — the commit side-effect (new, in `SegmentHitLayer.tsx`)

Refactor today's `commitCandidate` into a helper that **registers the selection
and returns its mask id**, instead of ending in a "Saved" toast:

```ts
// Registers the live selection as a real mask and returns its id, or null on
// failure (caller keeps the selection so the user doesn't lose their pick).
async function materializeCandidate(): Promise<string | null>
```

Body (lifted from `commitCandidate`):
1. `maskToPngBase64(candidate.mask)`.
2. Auto-name: `candidate.label ?? matchRegionLabelByBbox(...) ?? "Object N"`.
3. `backendTools.propose_mask(...)` → `maskId`. On failure → toast, return `null`
   (do **not** clear the candidate).
4. `objectOwnership.set(maskId, imageNodeId)` + `maskStore.injectWithId(...)` with
   the bytes already in hand.
5. Return `maskId`. (It does **not** itself set active scope, toast "Saved", or
   change mode — the calling verb owns post-action UX.)

### 4.B Verb wiring (in `SegmentHitLayer.tsx`)

Each permanent verb: `materializeCandidate()` → run the existing action with the
returned id → clear the selection → drop to layers mode.

```ts
async function runExtractToImageNode() {
  const id = await materializeCandidate(); if (!id) return;
  extractObjectToImageNode(id, imageNodeId);
  finishSelection(); // setCandidate(null) + setImageNodeMode(imageNodeId,'layers')
}
async function runConvertToLayerMask() {
  const id = await materializeCandidate(); if (!id) return;
  convertObjectToLayerMask(id, imageNodeId);
  finishSelection();
}
async function runExtractToLayer() {
  const id = await materializeCandidate(); if (!id) return;
  extractObjectToLayer(id, imageNodeId);   // §4.D
  finishSelection();
}
```

**Select Inverted** does not materialize — it inverts the candidate's bytes and
sets a new candidate locally:

```ts
function runSelectInverted() {
  const m = candidate?.mask; if (!m) return;
  const inv = new Uint8Array(m.data.length);
  for (let i = 0; i < m.data.length; i++) inv[i] = 255 - m.data[i];
  setCandidate({ points: [], mask: { width: m.width, height: m.height, data: inv },
                 label: candidate.label });
}
```

### 4.C Menu + hint changes (in `SegmentHitLayer.tsx`)

- The candidate `ContextMenu.Content` renders the **4 verbs** above instead of
  Save / Cancel. Extract/Convert items are `disabled` when `!sessionId`.
- Remove the **Enter = commit** keybinding; keep **Esc = discard**.
- Update the candidate hint from `⏎ save · esc cancel · ⇧ + click to refine` to
  `⇧+click refine · right-click actions · esc discard`.

### 4.D `extractObjectToLayer` — new action (in `src/lib/segmentation/object-actions.ts`)

Sibling of `extractObjectToImageNode`, but the baked layer joins the **existing**
node instead of a new one:

```ts
/** Bake the masked pixels into a new layer on top of the source layer, in the
 *  SAME image node (a visible cutout, transparent elsewhere). Returns the new
 *  layer id, or null on failure. */
export function extractObjectToLayer(
  maskId: string,
  sourceImageNodeId: string,
): string | null
```

- Resolve `sourceLayerId` the same way `extractObjectToImageNode` does
  (real-layer check → active layer on node → first layer).
- `extractLayerFromMask({ sourceLayerId, maskRef: maskId, cropToMaskBbox: false })`
  — `false` keeps the cutout at full source dimensions so it stays aligned on top
  of the source rather than cropped to a floating box.
- Append `newLayerId` to the node's `layerIds` (so it renders on top), set it
  active. Return `newLayerId`.

### 4.E Committed-object menu parity (in `ImageNodeObjectsLayer.tsx`)

Add an **Extract to new layer** item to the committed object's context menu
(calling `extractObjectToLayer(obj.id, imageNodeId)`), so the verb set is
consistent between a live selection and a committed object.

## 5. Error handling

- `propose_mask` fails → toast the error, return `null`, **keep the selection**.
- No `sessionId` → Extract/Convert disabled in the menu; Select Inverted works.
- `extractLayerFromMask` throws → `extractObjectToLayer` toasts and returns
  `null`; the verb wrapper leaves the selection intact (the `if (!id) return`
  guard already covers the materialize failure; the bake failure toasts inside
  the action, matching `extractObjectToImageNode`).

## 6. Testing

Frontend (`vitest`):
- **`materializeCandidate`**: calls `propose_mask`, injects into `maskStore`,
  sets ownership, returns the id; on `propose_mask` failure returns `null` and
  the candidate state is untouched.
- **Verb wiring**: each permanent verb calls `materializeCandidate` then its
  action with the returned id, and clears the selection + drops to layers mode;
  a `null` materialize short-circuits (action not called, selection kept).
- **Select Inverted**: produces an inverted candidate and does **not** call
  `propose_mask`.
- **`extractObjectToLayer`**: bakes a cutout, appends a layer to the same node's
  `layerIds`, returns the new id; mirrors existing `object-actions.test.ts`
  setup (register a mask + source layer pixels).
- **Menu**: candidate menu no longer exposes Save/Cancel; exposes the 4 verbs;
  extract/convert disabled when offline.

## 7. Out of scope

- No backend changes (`propose_mask` and the mask schema are unchanged).
- No change to refine (SAM point) mechanics.
- No change to how committed objects are adjusted via the toolrail / Cmd+K
  (that already works through scope/layer once a mask exists).
