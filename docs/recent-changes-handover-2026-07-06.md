# Recent Changes — Handover (2026-07-01 → 2026-07-06)

> **Purpose.** Delta handover covering everything that landed *after* the
> 2026-07-01 handover (`docs/recent-changes-handover-2026-07-01.md`, tip
> `5acee07`). **60 commits, now on `main`, tip `2fd5cc4`** (a merge of
> `feat/multi-target-tethers`). Working tree is clean.
>
> The dated handovers describe the *standing* architecture; this one is the
> **delta** — what changed, why, and where to look. Ordered by importance; a
> chronological commit index closes the document.
>
> ⚠️ **Three live bugs were diagnosed this period but NOT yet fixed** — see §8.
> They are the highest-value follow-ups.

---

## 1 · Generative fill (genfill) — the headline feature

A complete mask-based generative-fill pipeline, built out over 07-02 → 07-06.
The user paints/derives a mask, describes a fill, the backend generates via
Replicate, and the result is composited onto a new layer.

**Backend**
- Replicate client service + `REPLICATE_API_TOKEN` setting (`b1a908c`), later
  switched from `bria/genfill` to **FLUX Fill Pro** (`e492122`).
- `genfill_create` / `genfill_regenerate` tools with **background** generation
  (`e7fc9d2`); session **asset storage** + `GET` asset route under the
  `genfill-*` namespace (`ae97148`).
- `GenfillState` schema block on `Widget` (backend + shared + frontend types,
  `d6bac4a`). **Genfill widgets carry NO op-graph nodes** — their target lives
  on `genfill.imageNodeId` / `genfill.maskId`. Remember this; it trips up
  anything that assumes `widget.nodes[0].layerId` (see §2 and §7).

**Frontend**
- Tool wrappers + **spawn funnel** with layer-alpha mask registration
  (`b548629`, `src/lib/genfill-spawn.ts`).
- Bespoke widget body — `compose / generating / ready / error`, clip toggle,
  accept/discard (`ddd300c`, `GenfillWidgetBody.tsx`).
- Accept/discard actions — client-side mask **clip onto a new layer**
  (`8c18330`, `src/store/genfill-actions.ts`); accepted layer is attached to the
  **source image node** with scale-then-clip (`de5d849`).
- Entry points: right-click on object masks / layers / live selections
  (`2fae704`), and **Cmd+K genfill mode** with a required region chip
  (`5ff6f04`).
- Reload restores genfill layers; masked-region **before/after preview**
  (`cd84951`, `GenfillRegionPreview.tsx`).

**07-06 rework**
- Side-by-side before/after, wider node, fixed title (`9a6a0a8`).
- Center-spawn placement + **“Continue in command palette”** hand-off
  (`0c490ba`). Spec: `docs/superpowers/specs/` (genfill rework, `28a8821`).

**07-06 session fixes (in `7c08293`)**
- **Genfill widgets now get a tether edge.** They spawned edge-less because
  the tether system is layer-derived and genfill has no nodes. Fixed in **both**
  tether owners: `buildTetherForWidget` (`workspace-tether.ts`) and
  `syncWidgetTethers` (`workspace-slice.ts`) now resolve the target from
  `genfill.imageNodeId` → that image node’s first layer. Regression tests added.
- **Before/after preview no longer balloons the widget.** The canvas backing was
  the full source-crop resolution; because `WidgetNode` sizes the shell to
  `max-content`, a full-image fill blew the widget up. `GenfillRegionPreview`
  now scales the backing to the source node’s flow scale
  (`size/sourceSize`, clamped, capped at 384 px) — a true 1:1 magnifier.

---

## 2 · Multi-target tethers (`feat/multi-target-tethers`)

Widgets can now target **multiple layers**, and tethers are first-class,
directly manipulable edges. The key modelling decision, reached after a couple
of reverts: **`node.layer_ids` IS the target set** — no separate `ReplicateScope`
or `layer_ids_mode` (`b75d8e8`/`f33c780` added then reverted in `2a4d7f1`/
`4680411`).

**Backend**
- `update_widget_targets` tool — add / remove / retarget (`6b4ccf3`).
- `set_widget_param` writes to **all** target layers (`4285f95`); canonical
  seed/reset **fans out** over all target layers (`d5a39ea`).

**Frontend**
- Per-layer tether targets: types, store actions, sync, spawn (`4fb9240`).
- Per-layer tether **rail handles** + `update_widget_targets` client (`800de2a`).
- Connect / reconnect / delete tethers via rail handles (`a57514a`).

**07-06 session work (in `7c08293`)**
- **Edges are clickable + deletable.** They couldn’t be selected because
  `<ReactFlow>` had no `onEdgesChange`; added the local edge-state mirror +
  `applyEdgeChanges` (same selection-preservation dance as nodes), so a click
  selects a tether and Delete/Backspace removes that one target via the existing
  `onEdgesDelete`.
- **Handle hitboxes enlarged + release-to-connect animation.** Layer ports and
  widget outlets got oversized transparent hit targets (dot drawn via `::after`),
  wider `connectionRadius`/`reconnectRadius`, and a pulse on the
  `.connectingto.valid` handle so a valid drop is obvious before release
  (`index.css`, `WidgetNode.tsx`, `CanvasWorkspace.tsx`).
- Tether handle **anchoring** fix + per-layer LOD scratch (`7c08293`).

---

## 3 · Region-scoped suggestions & accept-time extraction

- Autonomous suggestions now carry **real region scopes** (`facdf62` spec;
  `d980d98` enrichment), plus a **problem-vocabulary hybrid** (free labels,
  “other” escape hatch, severity anchors) and study measures.
- **Accept on a region suggestion extracts it into its own SAM node**
  (`6e9382a`), via the `runAgentTurnForRegion` accept-time helper (`abccfee`).
  Spec: `63c5ffd`.

## 4 · Lasso selection in object mode

Freehand polygon → mask, **no SAM** round-trip (`6ec5006`, spec `1e359a7`).
Draw is suppressed while interacting with the candidate menu (`9add0b4`).

## 5 · Holistic stack resolution + fused-tool telemetry

- **One call budgets the whole stack** — holistic param resolution with
  structured planner output and no garbage fallback (`0b04da2`, spec `9b2f7b1`).
- Fused-tool **resolution telemetry** + clamp-on-last-retry + `param_source`
  stamp (`4d62203`); the param envelope (bounds) now ships to the resolver in
  both schema and payload (`bf8f6ee`).

## 6 · Layers → new image node via Copy / Cut

Right-click a layer → extract it to its own image node, copy (keep) or cut
(remove from source) (`a899baf`).

---

## 7 · Performance audit + quick wins (07-06 session, in `7c08293`)

A full read-only performance/logic audit was run (four parallel subsystem
sweeps, findings independently re-verified) and written up in
**`docs/audit-2026-07-06-performance.md`** — the authoritative list of current
bottlenecks with severities, file:line evidence, and a ranked roadmap. Read it
before optimization work.

**Three quick wins landed** (roadmap items 1–3):

1. **Scoped optimistic subscriptions.** The `optimistic` Map’s identity churns
   every slider tick; `useImageNodeRender` and `WidgetShell` subscribed to it
   whole, so one slider drag re-composited *every* image node and re-rendered
   *every* widget shell. Now each subscribes to a **scoped signature** (the map
   is keyed by op-graph node id `canon:<layerId>:<op>`, so relevance is read off
   the key); the render effect reads the full map non-reactively at paint time,
   so rendering is unchanged but only re-fires for this node’s own layers.
2. **Dirty-flagged GPU source upload.** `RenderImageNodeCompositeArgs.sourceDirty`
   (driven by `pixelVersion`) lets the per-layer `setSourceCanvas`/`setHiBitSource`
   skip the full `texImage2D` (or RAW uint16→float normalise) when only a param
   moved — the pipeline’s `sourceIdentity` guard reuses the on-GPU texture. The
   node-scope pass always uploads (its `internal` canvas keeps identity but its
   pixels change each frame).
3. **Collapsed op-graph selectors.** The five separate crop/rotate
   `useBackendState` selectors (each re-scanning the whole graph) became **one
   `useShallow` selector, single scan** returning primitives.

Plus per-layer LOD scratch tightening in `image-node-geometry.ts`.

> Roadmap items **4–10 are still open**: tether-divergence rollback, unbounded
> cache eviction, GPU mask multiply, snapshot revision guard, undo/redo rework.
> See the audit doc.

## 8 · ⚠️ Known live bugs (diagnosed 07-06, NOT fixed)

1. **MobileSAM `Session already started` / `Session mismatch`.**
   `useMobileSam.decode` has **no in-flight guard**; rapid clicks fire concurrent
   `samEncode()` on the single shared ONNX session (non-reentrant), and the
   racers throw. Fix: dedupe concurrent encodes with a per-`imageNodeId`
   in-flight promise. (`useMobileSam.ts`, `mobile-sam-client.ts`.)
2. **`analyze_context` 500 masquerading as CORS.** The backend returns a **500**
   whose error response lacks `Access-Control-Allow-Origin`, so Chrome reports a
   CORS block and the frontend logs `Failed to fetch`. Two fixes: find the
   server-side 500 cause, and make the backend error path emit CORS headers.
3. **`open-file.ts` unhandled decode failure.** `createImageBitmap` throws
   `InvalidStateError: The source image could not be decoded` for **HEIC/HEIF and
   TIFF** — which the picker’s accept list advertises but Chromium can’t decode —
   and the `async onchange` handler has no `try/catch`, so it surfaces as an
   uncaught rejection with no user feedback. Fix: wrap decode in `try/catch` +
   toast in `openImage`/`addImage` (covers drop/paste too), and either trim the
   accept list or route HEIC/TIFF through the backend develop path like RAW.

## 9 · Misc fixes

- `Select Inverted` un-muted in the live-selection menu (`df2a9fb`).
- Header object-mode + Analyze buttons; mirror-preview on extracted edges
  (`558f128`).
- Candidate context menu no longer loses clicks to the image-node menu
  (`fb9c1ac`); object delete/rename no longer bails before AI analyze (`dad5c5f`).
- Genfill hardening: session id from `useBackendState` not `useAiSession`
  (`b66e528`), source-bytes fallback to primary node (`c02732e`), mask luminance
  threshold when alpha is uniformly opaque (`831709a`).
- Deploy: `SESSIONS_DIR` override + persistent Render disk (`1da0010`);
  `prune_disk` aligned to last-activity (mtime) semantics (`90a9c84`).

---

## Chronological commit index (5acee07 → 2fd5cc4, newest first)

```
2fd5cc4 Merge branch 'feat/multi-target-tethers'
7c08293 fix(canvas): tether handle anchoring + per-layer LOD scratch, plus branch perf work
df2a9fb fix(segment): un-mute 'Select Inverted' in the live-selection menu
0c490ba feat(genfill): center-spawn + 'Continue in command palette' hand-off
9a6a0a8 feat(genfill): side-by-side before/after, wider node, fixed title
28a8821 docs: add spawn-center + palette hand-off to genfill rework spec
e38e95b docs: spec for generative-fill widget rework
a899baf feat(layers): right-click layer → new image node via Copy / Cut
a57514a feat(canvas): connect/reconnect/delete widget tethers via rail handles
800de2a feat(rail): per-layer tether handles + update_widget_targets client
4fb9240 feat(workspace): per-layer tether targets — types, store actions, sync, spawn
d631501 docs(plan): mark Tasks 1 & 6 dropped (node.layer_ids is the target set)
6b4ccf3 feat(backend): update_widget_targets tool (add/remove/retarget)
4680411 revert: drop ReplicateScope — node.layer_ids is the target set
b9f808f docs(plan): drop Tasks 2,5,17 — replicate works via canonical fan-out
2a4d7f1 revert: drop unused Node.layer_ids_mode
4285f95 feat(backend): set_widget_param writes to all target layers
d5a39ea feat(backend): fan canonical seed/reset over all widget target layers
f33c780 feat(backend): add Node.layer_ids_mode (composite|replicate)
b75d8e8 feat(backend): add ReplicateScope widget scope variant
e492122 refactor(genfill): transition from bria/genfill to FLUX Fill Pro
037b40d docs: implementation plan + backend-resolved spec for multi-target tethers
b194d2e docs: spec for deletable/reconnectable tethers & multi-target widgets
6e9382a feat(widget): accept on a region suggestion extracts it into its own SAM node
abccfee feat(palette): runAgentTurnForRegion — accept-time region extraction helper
63c5ffd docs: spec for autonomous region extraction on accept
cd84951 fix(genfill): restore genfill layers on reload + masked-region before/after preview
9add0b4 fix(workspace): prevent lasso draw when interacting with candidate menu
de5d849 fix(genfill): attach accepted layer to the source image node + scale-then-clip
dad5c5f fix(workspace): object delete/rename silently bailed before AI analyze
831709a fix(genfill): threshold mask luminance when alpha is uniformly opaque
c02732e fix(genfill): resolve source image bytes with fallback to the primary node
b66e528 fix(genfill): read session id from useBackendState, not useAiSession
ca9a751 Merge branch 'feat/genfill-widget'
5ff6f04 feat(genfill): Cmd+K generative-fill mode with region-chip requirement
2fae704 feat(genfill): right-click entry points on object masks, layers, live selections
ddd300c feat(genfill): bespoke widget body — compose/generating/ready/error, clip, accept/discard
8c18330 feat(genfill): accept/discard actions — client-side mask clip onto a new layer
b548629 feat(genfill): frontend tool wrappers + spawn funnel with layer-alpha mask registration
e7fc9d2 feat(genfill): genfill_create/genfill_regenerate tools with background Replicate generation
ae97148 feat(genfill): session asset storage + GET asset route (genfill-* namespace)
fb9c1ac fix(workspace): candidate context menu no longer loses clicks to the image-node menu
d6bac4a feat(genfill): GenfillState schema block on Widget (backend + shared + frontend types)
b1a908c feat(genfill): Replicate client service + REPLICATE_API_TOKEN setting
d980d98 feat(suggestions): problem vocabulary hybrid + study measures + region-scope enrichment
1da0010 feat(deploy): SESSIONS_DIR env override + persistent Render disk for session state
90a9c84 test: align prune_disk test with last-activity (mtime) semantics
6ec5006 feat(workspace): lasso selection in object mode — freehand polygon to mask, no SAM
1e359a7 docs(spec): lasso selection in object mode — freehand path to mask, no SAM
e4fcd09 docs(spec): genfill widget — mask-based generative fill via Replicate bria/genfill
facdf62 docs(spec): autonomous suggestions get real region scopes (step 1)
b4fb825 docs(spec): problem vocabulary hybrid — free labels, 'other' escape hatch, severity anchors
bf8f6ee fix(fused): ship the param envelope to the resolver — bounds in schema + payload
4d62203 feat(fused): resolution telemetry + clamp-on-last-retry, param_source stamp
e9d5195 docs(spec): fused-tool resolution telemetry + clamp-on-last-retry
0b04da2 feat(propose): holistic stack resolution — one call budgets the whole stack
9b2f7b1 docs(spec): holistic stack resolution — single-call param budgeting
14a2163 docs(study): spec for logging measures (segmentation, manual-share, telemetry)
558f128 feat(workspace): header object-mode + Analyze buttons, and mirror-preview on extracted edges
```
