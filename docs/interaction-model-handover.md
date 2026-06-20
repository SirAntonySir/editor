# Interaction Model Handover — Image / Layer / Object Rework, Visibility-Driven Adjustments, AI Reach into Objects

> **Purpose.** A third sibling to
> `implementation-architecture-handover.md` and
> `design-ux-handover.md`. Where those two cover *what exists* and *why
> the visual register looks the way it does*, this brief captures the
> **interaction-model rework** the codebase went through between
> 2026-06-16 and 2026-06-20.
>
> Each cluster below is presented argumentatively: the **Problem** that
> motivated the change, the **Entscheidung** that resolved it, and the
> **Why** that explains the trade-off. Every decision is grounded in a
> spec or plan under `docs/superpowers/specs/` and `docs/superpowers/plans/`,
> and every section names the load-bearing file paths so a future agent
> or a thesis writer can pull the receipts.
>
> Audience: a second agent picking up the interaction surface, or the
> thesis writer documenting how the editor's mental model collapsed
> from "Photoshop pastiche" into "image-node + visibility + Objects".

---

## 0 · Thesis in one paragraph

The editor's interaction model was the part of the architecture where
the Engine-SSoT doctrine had not yet bitten. Selection, layer
identity, mask scope, adjustment binding, and AI reach were each
expressed through a different ad-hoc state field; the same concept
("the user's current edit target") appeared three times under three
names. The reworks in this period **collapsed those three names into
three orthogonal axes**: `activeImageNodeId` (the image card on the
canvas), `activeLayerId` (the row in the per-image Layer tab — UI
only), and `activeObjectId` (the masked region adjustments paint
into). Visibility became the user's primary handle on what
adjustments target — a slider drag now applies to every visible layer
of the active image-node, live, without an operation-graph mutation
per visibility toggle. The AI gained first-class reach into Objects —
list, select, extract, convert — and named regions and committed
Objects share a single label namespace so a prompt like *"boost the
sky"* works whether or not the user has manually segmented sky. The
result is a smaller surface to teach, smaller surface to test, and a
sharper match between what the user sees and what the AI can act on.

---

## 1 · The conceptual rework — collapsing three selection axes into one

### 1.1 · Problem

The editor maintained three independent "selection" fields whose
intersection had no formal definition:

- `workspace-slice.activeImageNodeId` — which image card on the canvas.
- `layer-slice.activeLayerId` — which row in the layers panel.
- `selection-slice.activeScope: Scope` — a discriminated union covering
  `global` · `mask` · `mask:proposed` · `named_region` · `image_node`.

Three observable bugs fell out:

1. The Info tab **stole focus on every new image**: `document.addImage`
   unconditionally called `setActiveImageNode(newNodeId)`, so the Info
   tab snapped to the latest import even when the user was mid-edit on
   an earlier one. The visible symptom was `[Image #3] always shows`.
2. **Layers did not feel intuitive.** A "Layer" was everything at once:
   pixel container, adjustment carrier, mask owner, panel row.
3. The drafting register **had already replaced the standalone Layers
   panel** as the primary navigator (LayerStrip in the left margin,
   ObjectMarkers in the right) — but the panel still existed and the
   Classic variant was still branched on. Two answers to the same
   question.

### 1.2 · Entscheidung — three units, each with one job

Per `docs/superpowers/specs/2026-06-16-image-layer-object-rework-design.md`:

| Unit | What it is | Where it lives in the drafting node |
|---|---|---|
| **Image node** | One photographic subject on the canvas. The primary selection unit. | The whole card. Title in `TopMarginalia`, image in the frame. |
| **Pixel layer** | A stacked compositing element inside an image node (photo, brush, text, pasted). | Sheets in the left margin (`LayerStrip`). |
| **Object** | A mask + the adjustments scoped to it. SAM segments, AI regions, brush-drawn masks all surface as Objects. The "whole image" is the implicit Object when none is selected. | Numbered markers in the right margin with leader lines into the image. |

Adjustment binding was defined exactly: every widget binds to
`(image_node, pixel_layer, object)`. `object = null` means "whole
image". The backend `operation_graph` node already carried `layer_id`
and `mask_ref`, so no schema change was required for the conceptual
half of the rework.

### 1.3 · Why this cut

Three reasons that compound:

1. **One axis per concept** removes the discriminated-union collision
   between "mask selected" and "image node selected". Before, those two
   shared a slot via `Scope.kind`. After, image-node lives in
   `workspace-slice`, object lives in `selection-slice`, and they no
   longer fight for the same register.
2. **The drafting register already had two surfaces** (LayerStrip,
   ObjectMarkers) doing this work; the conceptual model was lagging the
   UI. Codifying the model lets the UI be the spec, not its caricature.
3. **Vocabulary discipline.** "Scope" was developer-speak. Saying
   "Object" out loud — to the user, in tooltips, in the AI manifest —
   is the same word the user uses when they point at the sky. Every
   tooltip and label that used to say "scope" now says "object" or
   "target".

### 1.4 · Implementation seam

Five phases, each shippable on its own
(`docs/superpowers/plans/2026-06-16-image-layer-object-rework.md`):

1. **Selection slice collapse.** `activeScope` → `activeObjectId: string | null`
   (where `null` = whole image). A temporary bridge kept both fields in
   sync for one commit so consumers could be flipped one file at a time
   without breaking the canvas; the bridge was removed at the end of the
   phase. Net effect on consumers: a `kind === 'mask'` discriminant
   collapses to `=== id`, which is cheaper to read and cheaper to
   read about.
2. **`addImage` no-force-select + Info-tab subscription fix.** Adding
   an image only auto-activates when nothing was active; otherwise a
   coalesced toast ("Image added — click to edit") tells the user the
   image landed. Info tab subscribes to `activeImageNodeId` explicitly
   so the previously-transitive update is now defensive.
3. **Classic deletion.** `ImageNodeClassic`, `visualStyle`,
   `ObjectModeFooter`, classic CSS block, and the standalone
   `LayersPanel.tsx` all deleted. Drafting tokens promoted to the root
   scope. The persistence layer migrated stale `visualStyle: 'classic'`
   keys away on load so existing users didn't crash.
4. **Inspector Layer tab.** A new tab replaces the deleted panel as the
   per-layer detail view. Rename / blend / opacity / lock live here; the
   on-node LayerStrip remains the spatial navigator.
5. **Adjustment binding alignment.** A new helper
   `scopeFromSelection(activeObjectId)` is the single source of truth
   for every spawn path (`promote.ts`, `colour-band-spawn.ts`,
   `filters-tool.tsx`). The Adjustments tab grows a binding header
   ("Targets: Sky" / "Targets: Whole image") so the user can see, before
   dragging a slider, exactly what their next adjustment will affect.

The order matters: each phase is independently observable as a fix,
and each builds the foundation for the next.

---

## 2 · Visibility-driven adjustments — "what I see is what my adjustments are on"

### 2.1 · Problem

After Phase 1 landed, three more observations from the user broke into
the open
(`docs/superpowers/specs/2026-06-17-visibility-driven-adjustments-design.md`):

1. The LayerStrip's "click = set active layer" semantic was not
   load-bearing. The strip's job is to navigate a stack of layers
   visually. What the user actually wants from a layer-stack
   interface is to mute and unmute layers — the same gesture a
   switchboard provides.
2. Adjustments should not require picking a layer. When the user
   creates a curves widget, they expect it to affect the picture they
   see, which is every visible layer composited together.
3. The sidebar reads as broken when there is nothing to do. Showing
   tabs that say "Click an image" is worse than not showing the tabs
   at all — the canvas should reclaim the space until an image is in
   focus.

### 2.2 · Entscheidung — three small reframes, one ergonomic story

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

The user-chosen broadcast semantic is **live**: when the user toggles
a layer's visibility *after* spawning a widget, the adjustment
immediately stops applying to that layer (and resumes when re-shown),
with no `operation_graph` mutation. This is the spec text the user
endorsed against the snapshot-at-spawn alternative.

### 2.3 · Why this cut

1. **The strip is a switchboard.** Treating a visual stack of sheets as
   a "selector" wasted the affordance. Wiring click to visibility makes
   the strip's gesture match its purpose.
2. **Live broadcast removes a mental step.** Before, the user had to
   pick which layer to adjust before they could adjust it. After, they
   pick what to *see*, and the adjustment follows. The "select before
   act" friction disappears in the common case (one photo layer) and
   remains expressive in the rare case (multi-layer composite with a
   brush overlay): solo a layer on the strip, spawn the widget,
   unsolo. No per-widget pin toggle in v1 — the escape hatch is the
   strip itself.
3. **Sidebar unmount honours the empty state.** The previous gate
   (`layers.length > 0`) showed the sidebar permanently because every
   document has at least one layer. Gating on `activeImageNodeId !== null`
   makes "no focus = no sidebar" literal: the canvas reclaims the
   horizontal column, and the user does not see disabled affordances
   pretending to be active.

### 2.4 · Implementation seam

Four phases
(`docs/superpowers/plans/2026-06-17-visibility-driven-adjustments.md`):

1. **Sidebar gate flip.** `RightSidebar.tsx` swaps its gate to
   `activeImageNodeId !== null`. Tested. The most-visible immediate
   improvement, independent of any data model change.
2. **LayerStrip role flip.** Click toggles `Layer.visible`; right-click
   opens a Radix ContextMenu mirroring `ImageNodeObjectsLayer`'s
   styling. `aria-pressed={layer.visible}` carries the state for
   assistive tech.
3. **Spawn paths ship `layerIds`.** All three frontend `proposeStack`
   call sites now populate `args.layerIds = imageNode.layerIds`. The
   backend schema already permitted `layerIds: string[] | null`, so no
   backend change.
4. **Renderer per-visible-layer.** A new `matchesLayer(node, layerId)`
   helper in `select-pipeline-nodes.ts` matches both the single-layer
   pinned widgets (`n.layerId === layerId`) and the new broadcast
   widgets (`n.layerIds?.includes(layerId)`). The `image-node-renderer`
   per-layer loop excludes broadcast nodes so they route through the
   *existing* composite-then-apply pass — a deliberate interpretation
   noted in a `docs(renderer)` comment so future maintainers know why
   the routing is asymmetric.

A footnote: the spec text says "for each layer apply the widget"; the
implementation routes broadcast through composite-then-apply. For
linear scalar ops with `source-over` blends the two converge; for
non-linear ops on exotic blends they diverge. In the dominant photo +
optional brush case the divergence is invisible; the interpretation is
worth revisiting when multi-photo-layer compositions become a thesis
claim.

### 2.5 · Rename plumbing

The right-click "Rename" item on the strip needed a way to trigger the
existing inline rename UI in the Layer tab. A one-shot flag —
`layer-slice.renamingLayerId` set via `requestRenameLayer(id)` and
consumed-and-cleared by `LayerRow`'s `useEffect` — connects the two
without lifting all of rename mode into a slice. The strip's Rename
also switches the Inspector tab to "Layer" via
`usePreferencesStore.setInspectorTab('layer')` so the input is mounted
when the request fires.

---

## 3 · Object actions — Select Inverted, non-destructive convert, restorative rejoin

### 3.1 · The destructive pattern that broke trust

Three Object actions felt destructive when the user tested them:

- **Convert to Layer Mask** showed a toast saying it was applied but
  produced no visible second layer. It overwrote the source layer's
  existing mask in-place.
- **Rejoin source image** silently dropped the extracted cutout layer
  during its `deleteImageNode` call.
- **(After the fix to rejoin)** the cutout reappeared at `(0, 0)` of
  the source instead of its original bounding-box position.

Each one violated the same promise: a destructive action should be
*reversible*, and a "convert" / "rejoin" action should *preserve* the
work that produced the input. The fixes all share one shape — defer
destruction, materialise the new state first.

### 3.2 · Entscheidung — duplicate-then-mask, merge-then-delete, un-crop-on-rejoin

- **Convert to Layer Mask** now calls `duplicateLayer(sourceLayerId)`,
  applies the mask to the duplicate, and appends it to the
  image-node's `layerIds`. The original layer is untouched. A new
  sheet appears on the LayerStrip; the user sees what they just did.
- **Rejoin source image** now calls
  `editorDocument.workspace.mergeImageNodes(extractedId, sourceId)`,
  which moves the extracted node's `layerIds` to the source before
  deletion, so the lifecycle hook never drops the layer's pixels.
- **Rejoin position restoration** un-crops the cutout's pixel canvas
  back to the source's `sourceSize` before merging, placing the
  cutout pixels at the recorded `sourceOrigin` offset (set at
  extract time). The cutout reappears where it came from, not at
  `(0, 0)`.

### 3.3 · Select Inverted — preview / save semantics

The user wanted "select inverted" to flip the active selection to
everything *outside* the current Object. The simplest implementation
would have registered a client-only mask and pointed `activeObjectId`
at it — but then the inverted region would not be a real Object: it
would not appear as a right-margin marker, the per-Object menu
(Rename / Convert / Extract / Delete) would be unreachable, and the
backend would not know about it.

**Entscheidung:** Route Select Inverted through the same
preview-and-save flow a fresh SAM pick uses. `selectInvertedObject`
dispatches a `segment-hit:external-candidate` window event with the
inverted alpha bytes; `SegmentHitLayer` listens, sets the candidate
state, and the user sees the same hint banner they get after a SAM
click — *"Enter save · Esc cancel · Shift + click to refine"*. The
verb was renamed from "Commit" to "Save" because "commit" is
developer-speak.

The Save path then calls `backendTools.propose_mask(...)` exactly the
way SAM clicks do, so an inverted selection becomes a real Object
with a backend `maskId` and the full Object menu — including
"Select Inverted" on the inverted Object (a tiny accidental
reversibility that the implementation preserves for free).

---

## 4 · AI reach into Objects — and the name-bridge to AI regions

### 4.1 · The asymmetry that prompted the fix

The agent already had `list_named_regions` and `select_named_region`
in its tool manifest, but those resolved AI-precomputed regions only.
Committed Objects — the masks the user has saved via SAM, brush, or
"Save Inverted" — were inaccessible. The agent could not act on what
the user had already done; the user, in turn, could not ask the agent
to do something against an Object they had named themselves.

A second asymmetry: the Cmd+K palette had no surface for either
regions or Objects. The user could not type "sky" and pick the sky.

### 4.2 · Entscheidung — four object tools + a label bridge

**Object tools** added to `LlmToolRegistry`
(`src/lib/tool-manifest/tools/`):

| Tool | Purpose |
|---|---|
| `list_objects` | Returns every committed Object in (optionally) one image-node — id, label, layerId, imageNodeId, dimensions. The agent's view of the user's segmentation work. |
| `select_object` | Sets `activeObjectId` to a given mask id. Subsequent `propose_stack` calls bind their scope to it. |
| `extract_object_to_image_node` | Wraps the existing extract helper. |
| `convert_object_to_layer_mask` | Wraps the existing (now non-destructive) convert helper. |

**The label bridge.** `select_named_region` was extended to **prefer a
committed Object whose label matches** (case-insensitive) before
falling back to the AI-precomputed region. `list_named_regions` now
returns the merged set with `origin: 'object' | 'ai_region'` so the
agent can prefer Objects (more permanent, user-blessed) over AI
guesses.

**Cmd+K palette.** A "Regions" section in the palette
(`src/lib/command-palette.tsx:buildRegionsSections`) lists the same
merged set. Picking an item either selects the Object directly
(instant) or arms the AI region as a candidate.

### 4.3 · Why this cut

The thesis claim of the editor — "AI agent has structured access to
what the user is working on" — was leaking. The AI saw only its own
suggestions, never the user's commits. The label bridge fixes that
without inventing a new vocabulary: the same word ("sky") reaches the
same region whether the source was a brush stroke or a precomputed
candidate. Crucially the agent does **not** need to know which source
the name resolves to; the resolution is centralised in
`select_named_region`'s handler. Users never need to know either —
the palette presents both kinds under one heading.

---

## 5 · The History dropdown — see, jump, revert

### 5.1 · Why the existing primitives weren't enough

The backend has had a rich `HistoryEngine` since Phase 3 of the
architecture — `HistoryEntry { id, ts, label, before, after,
coalesce_key }` per entry, with slider drags coalescing into a
single entry via `coalesce_key`. But the surface exposed to the
frontend was only `undo`, `redo`, `revert_all`. The user could not
see the log; they could only step through it one entry at a time.

### 5.2 · Entscheidung — surface the log, add jump-to-cursor, enrich labels

Backend (~80 lines total):

- `HistoryEngine.jump_to(target_cursor)` — seeks to an absolute index,
  returns the snapshot to apply, `None` for invalid or no-op targets.
- `GET /api/state/{sid}/history` — returns
  `{ entries: [{id, ts, label}], cursor, can_undo, can_redo }`.
  Snapshots are omitted; only the chrome data the frontend needs to
  render the list.
- `POST /api/state/{sid}/jump/{target_cursor}` — calls `jump_to`,
  applies the snapshot, broadcasts `history.applied`. The frontend
  refetches on the event.
- `ToolBase.history_label(input, output)` — defaults to `cls.name`.
  Per-tool overrides for the most-used user-action tools so the log
  reads as `Setting saturation = +0.42` rather than `set_param`.
  Coverage: `set_param`, `set_widget_param`, `propose_stack`,
  `accept_widget`, `delete_widget`, `restore_widget`, `refine_widget`,
  `repeat_widget`, `set_image_node_transform`.

Frontend:

- `backendTools.listHistory(sid)` + `backendTools.jumpHistory(sid, c)`.
- `useHistoryLog()` hook — fetches on `snapshot.revision` change (the
  existing reactive signal already mirrors `history.applied`).
- `HistoryDropdown` Radix Popover next to Undo / Redo in MenuBar.
  Drafting-token chrome, header pinned outside the ScrollArea so
  it's always visible. Each row: ochre dot for the current cursor,
  hairline dot for past, hidden for future (the redo branch dims via
  opacity). Click a row → `jumpHistory(sid, index)` → backend seeks
  → state.replaced broadcasts → canvas repaints.

### 5.3 · The slider-drag log pollution that was already fixed

A small but important detail: the user reported sliders pushing
many entries per drag. The infrastructure — `coalesce_key` +
`coalesce_window_s` (2000ms) — was already in place for `set_param`,
but `set_widget_param` had no `coalesce_key`. Adding one
(`f"set_widget_param:{widget_id}:{param}"`) merges widget-slider
drags into a single entry. Net effect: each visible action is one
log row, regardless of how long the user held the slider.

---

## 6 · Cmd+K context chips — moving from "Ask AI about this" to *attach to context*

### 6.1 · The metric-chip flow that already worked, and the chips that didn't

The Info tab's MetricChip family (EXIF, mechanical-context numbers)
already had a Radix DropdownMenu with "Ask AI about this" that
dispatched `spawn-palette:open` with `detail.attachContext: [{label,
value, sourceId}]`. The Cmd+K palette listened, deduped, merged into
its `attachedContext` state, and rendered the chips in a banner
above the input. The `proposeFromPalette` action prefixed the user
prompt with a structured `Image context (pinned by user):` preamble
made from the chips.

**The other Info-tab chip types were inert `<span>`s.** Subjects,
dominant tones, problems, region labels, palette swatches — visually
chip-shaped, no onClick. The user clicked, nothing happened.

### 6.2 · Entscheidung — clickable everywhere + chips inside the input row

Two parallel fixes:

1. Every chip in `SemanticSection`, `ProblemsSection`, `RegionsSection`,
   and `ColorSection` became a `<button>` that dispatches the same
   `spawn-palette:open` event with `{label, value, sourceId}` derived
   from its content. Subject → `{label: 'Subject', value: 'sky'}`;
   color swatch → `{label: 'Color', value: '#4a78b3'}`; problem →
   `{label: 'Problem', value: 'crushed shadows (60%) @ foreground'}`.
2. The context strip moved from "banner above the input" to "chips
   inside the input row". The search icon, the chips, and the input
   share a single `flex flex-wrap` row; when many chips attach, they
   wrap to a second line above the input rather than push it out of
   view. The TargetChip stays on the right.

### 6.3 · Why this matters for the thesis

The thesis claim is that Cmd+K is the *translation layer* between
user intent and an LLM tool call. Context chips narrow the
translation layer's input domain: the user has done the disambiguation
by pointing at a region or a colour rather than leaving the LLM to
infer which slice of the image the goal refers to. The chips also
make the model's grounding *legible* — the user can see exactly what
the LLM will receive as fact before they hit Enter, which is harder
to argue with than a hidden prompt template.

---

## 7 · Multi-image clarity — focus, target labels, per-image AI menu

### 7.1 · Three small bugs that one selection change exposed

Once visibility-driven adjustments shipped, multi-image documents
surfaced three new issues:

1. **The sidebar dismounted on Layer-tab clicks.** React Flow's
   `onSelectionChange` fired with `nodes: []` when focus moved to the
   sidebar, the handler set `activeImageNodeId = null`, the gate
   unmounted the sidebar mid-click.
2. **Drag-to-move selected an image.** React Flow marks a node as
   selected at drag-start; the same `onSelectionChange` handler then
   activated the image, mounting the sidebar.
3. **Clicking a different image showed the *previous* image's
   widgets.** Phase 1's "click only sets `activeImageNodeId`" was
   correct for the conceptual rework, but the Adjustments tab reads
   `useLayerWidgets(activeLayerId)`. Without a layer update, the tab
   showed the wrong widgets and slider writes landed on the wrong
   widgets.

### 7.2 · Entscheidung — explicit click events for focus, layer follows click

- Replaced `onSelectionChange` with `onNodeClick` + `onPaneClick`.
  Selection state — React Flow's internal "selected" — no longer
  drives `activeImageNodeId`. Only explicit clicks on the React Flow
  surface do. Drag-to-move never fires a click. Sidebar interactions
  never reach React Flow's pane.
- On `onNodeClick`, set both `activeImageNodeId` *and* `activeLayerId`
  (to the clicked image-node's first photo layer). The Adjustments
  tab now follows; slider writes land on the right widgets. The Layer
  tab follows for free because it already reads `activeImageNodeId`.

A related fix: the `CanvasWorkspace` had a `useEffect` that
auto-promoted the first image-node to active whenever
`activeImageNodeId === null`. On every blank-canvas click this
effect immediately re-promoted, defeating the sidebar's unmount. A
`useRef` makes the auto-promote one-shot — it fires on the first
arrival of image-nodes (fresh open / restore / Cmd+O) and never
again.

### 7.3 · The AI menu — per-image clarity and the labelled submenu

The MenuBar's "Analyze with AI" item had two problems with multiple
images:

- It said "Re-analyze image" the moment any image had been analyzed,
  even if the active target was a different image.
- It didn't show which image it targeted.

**Entscheidung — per-image analyzed state + dynamic menu shape:**

- `useAiSession.analysedImageNodeIds: string[]` + `markAnalysed(id)`,
  populated by `analyseImageLayer(id)` on success, cleared by
  `reset()`. The verb is computed per id: `Analyze` if not in the
  set, `Re-analyze` if in.
- With 1 image on canvas, the menu keeps its single-item shape
  (`Analyze "<name>"` / `Re-analyze "<name>"`), bound to `Cmd+Alt+A`.
- With >1 images, the menu becomes:
  - A top row carrying the active image's state-aware action with the
    `Cmd+Alt+A` shortcut and an ochre dot indicator.
  - A submenu `Analyze image…` listing every image, each with its own
    state-aware verb; the active one is marked with the dot.

A complementary action lives on the per-image right-click menu in
`ImageNodeDrafting.tsx`: an "Analyze with AI" item with the violet
Sparkles icon, which calls `analyseImageLayer(node.id)` directly.
The user does not need to make the image active first.

---

## 8 · Quiet polish

A loosely-coupled bag of UX wins that landed alongside the bigger
reworks. Each is small individually; together they tighten the
register.

- **Layer tab restyle** — the previous LayerRow rendered as a pink
  active fill on cream paper because `bg-accent/10` of the ochre
  accent at 10% reads pink. Replaced with an ochre 2px left bar (no
  fill), Fraunces italic title, ochre custom slider, hairline
  blend select with a Lucide chevron, and an ochre tab-strip
  underline. Mirrors the LayerStrip's "ochre = visible, hairline =
  not" vocabulary.
- **Reuse over invent.** The first LayerRow restyle hand-rolled
  slider styling and a custom `<select>`. Replaced with the project's
  existing `AdjustmentSlider` (Radix Slider with provenance tinting)
  and a Radix `DropdownMenu` matching `LayerProperties.tsx` exactly.
  Less code, consistent behaviour, instantly inherits future slider
  improvements.
- **Live layer reactivity** — `useImageNodeRender`'s `useEffect` deps
  array had no layer fields, so toggling visibility / opacity / blend
  / order / layerMask only repainted after the next unrelated state
  change. Added a `layersSignature` selector — a stringified record of
  the composite-relevant fields for the layers in this image-node —
  and put it in the deps. Toggles now repaint live.
- **Widget pill decision pair always visible.** Apply (✓) and Close
  (✕) used to be gated to the expanded view, forcing the user to
  open every widget before they could accept or dismiss it. Lifted
  the gate so the decision pair lives in the header in both states.
  Refine / Why / Reset stay expanded-only — those imply working in
  the widget, not deciding on it.
- **Slider drag, one history entry.** The backend already had
  coalescing infrastructure (`coalesce_key` + 2-second window) for
  `set_param`; `set_widget_param` was missing its key. Added one. A
  long slider drag now produces one undoable step, not a tower.
- **History dropdown scrolling.** Two false starts (flex column on
  Popover.Content, then a wrapping div) before realising the project
  `ScrollArea` needs an explicit height. Replacing
  `flex-1 min-h-0` with `h-[280px]` settled it.
- **History toolbar button matches its neighbours.** The trigger
  initially used `w-7 h-7` with a background hover; the Undo / Redo
  / Revert cluster uses `w-5 h-5` with text-only hover. Switching to
  the shared `btnClass` made the four feel like a unit instead of
  three plus one.
- **Adjustments header copy.** With broadcast widgets, the
  "Targets: \<object\> on \<layer\>" suffix is no longer accurate.
  Dropped the layer half. Reads as "Targets: Sky" or "Targets:
  Whole image". One assertion in `AdjustmentsAccordion.test.tsx`
  was rewritten to enforce the absence of " on " in the header.

---

## 9 · The discipline that made the rework cheap

Three habits, all from `superpowers`, paid for the bigger reworks:

1. **Brainstorm → spec → plan → subagent-driven execution.** Every
   non-trivial change went through this loop. The two big specs
   (`2026-06-16-image-layer-object-rework-design.md` and
   `2026-06-17-visibility-driven-adjustments-design.md`) ran 200–280
   lines each and were committed before any code. Plans were 800–1500
   lines, with every step containing actual code and an exact commit
   message. The 73-commit sequence merged into `refactor/pipeline`
   came out of two of these loops.
2. **Worktree-per-spec.** Each plan executed inside
   `.worktrees/<branch>` from HEAD; the work merged back via `--no-ff`
   so the merge commit acts as the receipts row. The user's parallel
   backend work continued on `refactor/pipeline` without conflict.
3. **TDD per task.** Each plan task carried a failing test, an
   implementation, and a passing test as separate steps. Coverage
   grew from 800 to 944 tests through this period; every reworked
   surface kept a focused test next to it.

A practical consequence: when the user reported "still no scrolling"
on the History dropdown twice in succession, each fix was small enough
that the cycle (read code → adjust → verify → commit) took ~5 minutes.
Without the existing test density, the same loop would have spent its
time re-running the user's manual flow instead of running `npm run check`.

---

## 10 · Out of scope (intentional)

For the thesis writer's footnotes — what was *not* done, with the
reason:

- **`.edp` save format.** Brainstormed alongside the image-layer-object
  rework; carved off because the schema + migration story deserves its
  own spec. The recipe-only-with-prompts model (sources + recipe; mask
  prompts as source of truth with raster cache; flat export separate)
  is the path.
- **Brush / text pixel layers gaining their own adjustment graph.** Only
  the photo base layer carries one today. Real future feature, not a
  regression of any of the reworks above.
- **Multi-image Objects.** Objects live on one image node; cross-node
  masks are a separate idea.
- **Per-widget single-layer pin.** Solo-then-spawn is the escape hatch.
  No per-widget toggle in v1.
- **Backfilling old single-layer widgets to broadcast.** Pre-existing
  widgets stay single-layer forever; only widgets created after the
  visibility-driven adjustments rework broadcast.
- **Live label updates on AI region → Object promotion.** If the user
  segments a region after the AI named it, the AI's text continues to
  reference the original AI region until the next analyse pass. The
  label bridge in `select_named_region` makes the *behaviour* correct
  (Objects win); the rendered text in suggestion cards is a follow-up.
- **Backend round-trip for the inverted mask.** The Save flow does send
  a `propose_mask` for inverted candidates, so the user-facing pattern
  is correct. But an Object created by an LLM (`select_inverted_object`
  is not yet a backend tool) would need a `create_mask` round-trip to
  persist server-side. Tracked in passing.

---

## 11 · Pointer index for the second agent

| If you want | Read |
|---|---|
| Conceptual model + new vocabulary | `docs/superpowers/specs/2026-06-16-image-layer-object-rework-design.md` |
| Phased build with code per step | `docs/superpowers/plans/2026-06-16-image-layer-object-rework.md` |
| Visibility-driven adjustments + broadcast model | `docs/superpowers/specs/2026-06-17-visibility-driven-adjustments-design.md` |
| Phased build for visibility | `docs/superpowers/plans/2026-06-17-visibility-driven-adjustments.md` |
| Why a pink Layer-tab active fill was the wrong choice | `git show 3d3ff6d` |
| The matchesLayer helper + composite-then-apply interpretation | `src/lib/select-pipeline-nodes.ts:matchesLayer` + the `docs(renderer)` comment in `src/lib/image-node-renderer.ts:218-219` |
| AI tools for Objects | `src/lib/tool-manifest/tools/{list,select,extract_to,convert_to}*.ts` |
| Label bridge — regions ↔ Objects | `src/lib/tool-manifest/tools/select-named-region.ts` |
| Cmd+K palette section assembly | `src/lib/command-palette.tsx:buildRegionsSections` |
| History engine on the backend | `backend/app/session/history.py` (especially `HistoryEntry`, `coalesce`, and the new `jump_to`) |
| History dropdown component | `src/components/toolbar/HistoryDropdown.tsx` + `src/hooks/useHistoryLog.ts` |
| Per-image AI menu | `src/components/toolbar/MenuBar.tsx:AiMenu` |
| Per-image analyzed state | `src/hooks/useImageContext.ts:analysedImageNodeIds` / `markAnalysed` |

Every section above can be traced to a commit in the
`124f7e4..HEAD` range on `refactor/pipeline`. Use
`git log --oneline 124f7e4..HEAD` to see the full sequence.
