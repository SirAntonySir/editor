# Recent Changes — Handover (2026-06-26 → 2026-06-30)

> **Purpose.** Delta handover covering everything that landed *after* the
> 2026-06-26 handover (`docs/recent-changes-handover-2026-06-26.md`, tip
> `b7d1475`). 26 commits on `main` plus a final bundle commit carrying the
> working tree (the command-palette async/`@`-mentions rework, the region
> extraction approval gate, and the layer-thumbnail panel work).
>
> The 2026-06-26 / 2026-06-24 / 2026-06-20 handovers describe the *standing*
> architecture; this one is the **delta** — what changed, why, and where to look.
>
> Audience: the next agent picking up the editor, and the thesis chapters on the
> AI interaction surface.

The work clusters into eight themes, reading order by importance (the AI
interaction surface first). A chronological commit index closes the document.

---

## 1 · The AI interaction surface — attach, gate, target

This is the thesis USP layer and it moved the most. Three connected changes turn
"attach a region and prompt" into a **gated, user-steered** flow.

### 1.1 Deterministic region pre-extraction → `forced_targets` (committed)

Before the agent loop runs, attached `@region` chips are **resolved
client-side** into concrete targets, and the backend is *forced* to propose onto
them rather than re-deciding.

- **Pure planner** `planForcedExtractions` (`6c2ea05`,
  `src/lib/segmentation/forced-extraction.ts`): partitions attached chips into
  `extractable` (already have a mask), `segmentable` (AI region with a
  representative point but no mask — the Render path has no server-side SAM), and
  `fallbackIds` (everything else → `attached_objects`).
- **Pre-extraction in `runAgentTurn`** (`4fd23fd`): extractable chips bake to
  their own image node; maskless-with-point chips **segment client-side
  (MobileSAM) first**, then extract (`b60b635`).
- **`agent_turn` accepts `forced_targets`** and seeds `node_layers` from them
  (`b394905`); the **system prompt forces** the agent to propose onto the
  pre-extracted targets (`945024c`).
- `serializePromptDoc` returns chip `sourceIds` so the turn can resolve + extract
  each region (`a1a2bea`, `src/lib/prompt-doc.ts`).

### 1.2 Command palette: `@` element mentions + async submit (this bundle)

**Spec:** `docs/superpowers/specs/2026-06-30-command-palette-async-submit-and-at-mentions-design.md`.

- **`@` element picker.** Typing `@` opens a dropdown of **all elements** —
  regions (committed objects + AI regions) **and** targets (image nodes +
  layers) — filtered as you type; plain typing keeps the region-only fuzzy
  behaviour. `triggerBeforeCaret` / `caretTokenToReplace` (`prompt-doc.ts`),
  `rankElements` + `PaletteElement` (`region-suggest.ts`), `buildTargetElements`
  (`command-palette.tsx`). Target chips serialize to `forced_targets`
  (`target:node:*` → the node's layers; `target:layer:*` → owner node + that
  layer, deduped) in `runAgentTurn`.
- **Submit closes immediately; loading lives on the pill.** In-flight Agent-turn
  state moved out of `CommandPalette` into a standalone store
  `src/store/palette-runtime.ts` (`pending` / `phase` / `error` / `restore`).
  The orchestration is `src/lib/palette-submit.ts` (`submitAgentPrompt`) at module
  scope so the turn survives the dialog closing. The minimized pill
  (`CommandTrigger`) shows the shimmer + spinner; a failed turn shows a red retry
  state and **restores your prompt + chips** on reopen.
- **`Regions` → `Elements` rename** (`2f5c066`) — the user-facing label, now that
  the picker spans regions *and* targets.

### 1.3 Region extraction approval gate (this bundle)

**Spec:** `docs/superpowers/specs/2026-06-30-region-extraction-approval-gate-design.md`.

The pre-extraction (§1.1) used to be silent — it selected + extracted attached
regions to a **new image node** with no prompt. Now each attached region pauses
for a **3-way choice** in the dock: **`→ New image node` / `→ New layer` /
`Deny`**.

- New gate store `src/store/region-extraction-approval.ts`
  (`request(label) → Promise<'node'|'layer'|'deny'>`) + dock chip
  `src/components/ui/RegionExtractionApproval.tsx`.
- `runAgentTurn`'s pre-extraction is now `resolveAttachedRegions(getChoice)`:
  `deny` drops the region (and never segments it); `node` →
  `extractObjectToImageNode`; `layer` → `extractObjectToLayer` (returns the same
  `{ image_node_id, layer_ids }` contract, image node = source node). `getChoice`
  defaults to the store; tests inject a stub.
- The agent's **in-loop** `extract_object_to_image_node` approval chip
  (`ClientToolApproval.tsx`) got the same Node/Layer/Deny upgrade for consistency
  (`select_object` / `convert_object_to_layer_mask` keep plain Allow/Deny).

> One chip covers both asks: **Deny** = "don't make this selection";
> **Node/Layer** = approve it and pick where it lands.

---

## 2 · Direct-action segmentation — drop the Save/Cancel step

**Spec:** `docs/superpowers/specs/...direct-action-segmentation...` (`64f07ea`).

Segmentation no longer has a separate "Save the mask, then act" step — the user
**works with a selection directly** (`883212c`).

- `runCandidateVerb` materializes the candidate mask, then dispatches the action
  verb in one move (`328479c`); `candidate-actions` helper
  (`materializeCandidate` + `invertMask`) (`35c8be2`).
- **`extractObjectToLayer`** (`a908fd5`, `src/lib/segmentation/object-actions.ts`)
  bakes the cutout into a **new layer on the same image node** (full source dims,
  not bbox-cropped) — the counterpart to `extractObjectToImageNode` and the
  "Layer" path of the new approval gate (§1.3).
- Extract-to-image-node now makes the **baked layer the active edit layer**
  (`c63abf2`).

---

## 3 · Layers panel — thumbnails, merge, delete, active/eye split

- **Merge visible layers** (`20d35c2`, spec `feb3e92`,
  `src/lib/merge-visible-layers.ts`): bakes the visible layers of a node to one
  flat raster via the on-screen renderer (`renderImageNodeComposite`,
  `bakePerLayerOnly`), leaving whole-node adjustments live on the op-graph.
- **LayerStrip semantics split** (`ab5ce62`, `1359741`): the strip's sheet
  selects the **active edit layer**; the eye toggles **visibility**
  (`fill marks active`, eye carries visibility).
- **Delete button in the inspector Layer row** (`1b1354d`).
- **`LayerThumb` primitive** (this bundle, `src/components/ui/LayerThumb.tsx`): a
  cover-cropped pixel thumbnail of one layer with an active-ring; redraws on
  `pixelVersion`. A cross-domain primitive used by both the workspace `LayerStrip`
  and the inspector `LayerRow`.

---

## 4 · WYSIWYG export — `f556ff4`

Export was rendering through a legacy `LayerCompositor.renderLayer` path that
**never applied crop/rotate geometry** and diverged from the on-screen renderer,
so saved files came out as the untouched original. Now both export entry points
(`exportImageNode`, the File-menu `handleExport`) render through the **same**
`renderImageNodeComposite` the canvas uses — full resolution, sized to the
cropped/rotated output, overlays suppressed (`skipOverlays`).

- `src/lib/export.ts` (`renderImageNodeToCanvas` + `exportImageNodeBlob`),
  `image-node-renderer.ts` (`skipOverlays`), `image-node-actions.ts`,
  `useFileIO.ts`. Regression test `src/lib/export-wysiwyg.test.tsx` asserts the
  export canvas is sized to the crop rect (geometry honoured).

---

## 5 · Workspace + menu polish

- **Curved tether edges** (`a7b7d92`): tether edges render as Béziers instead of
  orthogonal elbows.
- **Image-node context menu icons + Export submenu** (`59238ab`): every item in
  the image-node menu carries a Lucide icon; the three Export rows collapse into
  one **"Export as…"** submenu; the two Rotate rows read just "Rotate 90°"
  (direction conveyed by the `RotateCw`/`RotateCcw` icon); Delete → `Trash2`.
  Same commit also fixes the **margin object-line right-click menu**.
- **Preset "less is more" tuning** (`59238ab`): the older corrective/tonal preset
  JSONs (`recover_highlights`, `contrast_punch`, `deepen_blacks`, `lift_shadows`,
  `levels_stretch`, `detail_pop`, `micro_contrast`, `gritty`, `dreamy`, `moody`,
  `matte_film`, `overcast`) had their default magnitudes pulled back roughly by
  half — they were sitting at raw envelope midpoints. The already-restrained
  Jun-26 grades/tones and the B&W presets were left alone.
- **Title clipping fix** (`2c746e0`): the italic image-node title no longer clips
  on the right.
- **Spawn footprint** (`bf35c2e`): spawned widgets now clear each other's real
  footprint instead of overlapping.

---

## 6 · Admin cockpit — dedicated `ADMIN_TOKEN`

Follow-up to the 2026-06-26 admin token gate. A **dedicated `ADMIN_TOKEN`**
secures the admin cockpit independently of `BACKEND_AUTH_TOKEN` (`817f61e`,
`bd7d645`) — remote cockpit access without sharing the study auth token.

---

## 7 · SSE robustness — `e9e0e5e`

When a `StateEvent` arrives **before** the snapshot it references exists, the
client now **refetches the snapshot** instead of dropping the event — closes a
race where an early event (e.g. a fast agent `widget_mint`) landed before the
initial snapshot fetch resolved.

---

## 8 · Verification status at handover

- All §1.1, §2–§7 work is **committed** on `main` (tip before the bundle:
  `2f5c066`).
- The **working tree** (§1.2, §1.3, §3 LayerThumb, the two 2026-06-30 specs, and
  this handover) lands in the **bundle commit at the tip**.
- `npm run check` (tsc + eslint + the no-nested-component rule + the full vitest
  suite) was **green — 1106 tests** — immediately before the bundle commit.
- Backend pytest was **not** re-run for this handover. Prior-handover caveat
  still stands: `test_prune_disk_removes_old_records` is a pre-existing time/FS
  flake.

---

## Commit index (chronological, 2026-06-26 → 2026-06-30, after `b7d1475`)

- `817f61e` feat(admin): implement ADMIN_TOKEN for secure access to admin cockpit
- `bd7d645` feat(admin): remote cockpit access via dedicated ADMIN_TOKEN
- `a1a2bea` feat(palette): serializePromptDoc returns chip sourceIds
- `6c2ea05` feat(agent): pure planner for forced region extraction
- `4fd23fd` feat(agent): deterministically extract attached region chips before the loop
- `b394905` feat(agent): agent_turn accepts forced_targets and seeds node_layers
- `945024c` feat(agent): force propose onto pre-extracted targets in the system prompt
- `e9e0e5e` fix(sse): refetch snapshot when an event arrives before it exists
- `feb3e92` docs(layers): spec for merge-visible-layers + LayerStrip upgrades
- `20d35c2` feat(layers): merge visible layers + LayerStrip/menu polish
- `bf35c2e` fix(workspace): spawn widgets clear of each other's real footprint
- `59238ab` fix(objects): make margin object-line right-click menu work; menu icons (+ preset tuning)
- `64f07ea` docs(spec): direct-action segmentation (drop Save/Cancel step)
- `a908fd5` feat(segment): extractObjectToLayer — bake cutout into a new layer in-place
- `35c8be2` feat(segment): candidate-actions helper (materializeCandidate + invertMask)
- `328479c` feat(segment): runCandidateVerb — materialize then dispatch the action verb
- `883212c` feat(segment): work with a selection directly — drop Save/Cancel step
- `b60b635` fix(agent): segment maskless AI regions client-side before forcing
- `f556ff4` feat(export): WYSIWYG export path
- `c63abf2` fix(segment): make extract-to-image-node's baked layer the active edit layer
- `ab5ce62` feat(layers): LayerStrip — sheet selects the active edit layer, eye toggles visibility
- `1359741` fix(layers): LayerStrip fill marks the active layer; eye carries visibility
- `2c746e0` fix(workspace): stop italic image-node title clipping on the right
- `1b1354d` feat(layers): delete button in the inspector Layer panel row
- `a7b7d92` feat(workspace): curve tether edges (Bézier) instead of orthogonal elbows
- `2f5c066` refactor(ui): rename the user-facing 'Regions' label to 'Elements'
- `<bundle>` feat(palette+agent): async submit + `@` mentions + region extraction approval gate; layer thumbnails
