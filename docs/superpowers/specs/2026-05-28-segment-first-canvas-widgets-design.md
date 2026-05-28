# Segment-First Canvas Widgets — Design

**Date:** 2026-05-28
**Status:** Approved for plan-writing
**Prerequisite:** `frontend-mcp-integration-complete` tag merged on `dev`.

## Goal

Turn the editor into a segment-first surface: the user hovers SAM segments on the canvas, clicks to select one as a scope, and any tool or AI prompt operates inside that scope. Pull the inspector's job apart — keep a thin synced *list view* on the right, but move the actual interactive UI (sliders, spline editors, lifecycle buttons, AI suggestions) onto canvas-floating *widgets* anchored to the segments they affect.

After this lands:
- Loading an image kicks off a visible multi-phase analyze pipeline (mechanical stats, SAM embed, Anthropic context, per-region mask pre-compute, autonomous widget mint). Status strip + canvas skeleton widgets show progress.
- Anthropic's `candidate_regions` come back as hoverable SAM segments. Hovering highlights softly; clicking commits the selection; clicking again cycles outward through overlapping segments.
- Shift-click on a segment spawns an empty AI widget anchored to it. ⌘K opens a floating spawn palette with the selection as scope (or global).
- Selecting a tool (Curves, Light, Levels, Filters, Text, Brush) opens a canvas-floating widget for that tool, scoped to the selected segment if one is active.
- The right sidebar becomes a four-section linked list mirroring the canvas state (Selection · Active widgets · Suggestions · Segments).

## Out of scope

- Multi-segment selection (single-select only in v1).
- Persisting *pending* (un-accepted) AI suggestions in `.edp` — those are re-derived on reload.
- Persisting mask bytes in `.edp` — re-derived from analyze.
- Real-time widget collision/clustering math beyond auto-offset; if 8 widgets overlap, the user uses the inspector list to drive focus.
- Mobile/touch optimization.
- CRDT / multi-user.
- Migrating older `.edp` files that pre-date the original `aiSource` rename — already handled by Task 13 backwards-compat ignores.

## Architecture

Two data sources, one renderer, three views.

- **AI widgets** live in `BackendStateSlice.snapshot.widgets` (server-authoritative). They carry MCP semantics — `propose_widget`/`refine_widget`/`accept_widget` round-trip through the existing SSE event stream.
- **Tool widgets** are frontend-authoritative and read from one of three backing stores depending on the tool's nature:
  - **Adjustment-backed tools** (Curves, Light, Levels, Filters, Color, Kelvin) → `EditorStore.layers[*].adjustmentStack.adjustments[*]` with optional `scope` set to the selected segment's mask ref.
  - **Layer-meta-backed tools** (Text) → `EditorStore.layers[*].textMeta` of the active text layer.
  - **Transient-config-backed tools** (Brush, Crop) → ephemeral tool config in `ToolRegistry` / the brush slice, no document persistence beyond the strokes/results they produce.
- A new **unified projection** `selectAllWidgets()` merges all four sources (AI snapshot + three tool sources) into a uniform shape that both the canvas widget layer and the inspector list consume.

The user sees one consistent widget UI; the two storage paths are invisible.

### Module layout

```
src/store/
  segment-selection-slice.ts          # hover / select / cycle state
  focus-slice.ts                      # canvas↔inspector focused widget id
  backend-state-slice.ts              # extended: widget.accepted handler bakes Adjustments
  layer-slice.ts                      # extended: re-add AiSource (simpler provenance shape)

src/hooks/
  useSegmentInteraction.ts            # pointer state machine, RAF-throttled hit-test

src/lib/
  widget-projection.ts                # selectAllWidgets() merger
  scope-to-mask.ts                    # Scope → mask bytes resolver
  node-to-adjustment.ts               # widget Node[] → Adjustment[] for WebGL

src/components/
  canvas/
    SegmentOverlay.tsx                # hover + selected outlines on a sibling <canvas>
    useAdjustmentPipeline.ts          # wires node-to-adjustment.ts
  widget/
    CanvasWidgetLayer.tsx             # absolute-position host, syncs with Fabric transform
    SpawnPaletteWidget.tsx            # ⌘K floating spawn palette (replaces AiCommandPalette modal)
  inspector/
    InspectorPanel.tsx                # rewritten: four-section linked list
    InspectorWidgetRow.tsx            # compact list row
    widget/WidgetCard.tsx             # gains variant: 'ai' | 'tool'

backend/app/
  state/events.py                     # +phase.started / phase.progress / phase.completed
  tools/atomic/analyze_image.py       # restructured: parallel kick-off, phase events, mask pre-compute
  services/sam_client.py              # +decode_box_for_region(session_id, bbox, label)
```

### Existing modules deleted or radically slimmed

- `src/components/AiCommandPalette.tsx` — replaced by `SpawnPaletteWidget.tsx`. The thin remnant from Task 13 (text input + propose call) is the seed of the new spawn widget.
- `src/components/inspector/InspectorPanel.tsx` — rewritten end-to-end, drops from ~80 lines to ~80 lines but with a different purpose (list view, not card host).

## Data Model

### `Widget` type extension

```ts
// src/types/widget.ts
export type WidgetOriginKind =
  | 'mcp_user_prompt'
  | 'mcp_autonomous'
  | 'fused_expansion'
  | 'refine'
  | 'repeat'
  | 'tool_invoked';        // NEW — applies to local tool widgets

export interface WidgetOrigin {
  kind: WidgetOriginKind;
  prompt?: string | null;
  parent_widget_id?: string | null;
  anchor?:                  // NEW — optional spatial anchor for canvas placement
    | { kind: 'region_label'; label: string }
    | { kind: 'mask_id'; mask_id: string }
    | { kind: 'image_point'; x: number; y: number }
    | { kind: 'global' };
}
```

### Tool widget projection shape

Tool widgets aren't stored as `Widget` objects — they're projected. The projection emits a uniform shape:

```ts
// src/lib/widget-projection.ts
export interface UnifiedWidget {
  id: string;
  variant: 'ai' | 'tool';
  intent: string;             // 'Warm skin', 'Curves', etc.
  scope: Scope;
  anchor: WidgetOrigin['anchor'];
  bindings: ControlBinding[]; // empty for tool widgets that use processingDef.Panel
  processingId?: string;      // tool widgets only — points to ProcessingRegistry entry
  status: 'active' | 'pending';
  source: 'backend-state' | 'editor-store';
}
```

The canvas widget renderer and the inspector list both consume `UnifiedWidget[]`. They never see the underlying storage.

### `AiSource` re-introduced (simpler)

Task 13 deleted the original `AiSource` which was tangled with the legacy `ai-panel` graph. This design re-adds it in a thinner shape:

```ts
// src/store/layer-slice.ts
export interface AiSource {
  widgetId: string;     // originating widget (for log/trace; widget itself is gone post-accept)
  intent: string;       // 'Warm skin'
  reasoning?: string;   // optional Claude reasoning
  acceptedAt: string;   // ISO timestamp
}

export interface Adjustment {
  // ... existing fields
  aiSource?: AiSource;  // present on adjustments born from an accepted AI widget
}
```

### Segment selection state

```ts
// src/store/segment-selection-slice.ts
export interface CycleStack {
  originX: number;          // image-space coords of the click that built the stack
  originY: number;
  candidates: string[];     // mask ids, smallest → largest
  cursor: number;           // current index
}

interface SegmentSelectionState {
  hoveredSegmentId: string | null;
  selectedSegmentId: string | null;
  cycleStack: CycleStack | null;
  setHovered: (id: string | null) => void;
  clickAt: (imageX: number, imageY: number) => void;  // computes overlap, builds/advances cycle
  shiftClickAt: (imageX: number, imageY: number) => void;  // selects smallest, opens AI widget
  clear: () => void;
}
```

## Canvas Interaction

### Pointer state machine

Lives in `useSegmentInteraction()`, mounted from `EditorCanvas`. Subscribes to Fabric pointer events.

| Event | Behavior |
|---|---|
| `pointermove` | RAF-throttle → image-space hit-test against all masks in `maskStore` → pick smallest containing mask → `setHovered(maskId)`. If none, `setHovered(null)`. |
| `click` (pointerup with no drag, no modifier) | If no segment under cursor: `clear()`. Else: `clickAt(x, y)` which either builds a new cycle stack (sorted smallest-first by mask pixel count) or advances the cursor if the click is within ±8px of the last cycle origin. Selected segment = `cycleStack.candidates[cursor]`. |
| `shift+click` | `shiftClickAt(x, y)` — selects smallest matching segment, opens an empty AI widget anchored to it with focused text input. No cycle. |
| `pointerdown` while a non-select tool is active (Curves, Brush, Text…) | Pointer is consumed by the tool. Hover still updates (so the user sees segment hints) but click doesn't change selection. |
| `Escape` key | `clear()`. |
| `⌘K` | Open `SpawnPaletteWidget`. Scope auto-fills from `selectedSegmentId` or `'global'`. |

### Hit-test

Mask bytes are dense `Uint8Array` in image-pixel space. Lookup is `mask.data[y * width + x] !== 0`. For ~8 masks at 1024-edge resolution, one hit-test per pointer-move is ~8 array reads — negligible at RAF cadence. No spatial index needed in v1.

### Rendering

`<SegmentOverlay>` is a sibling of `<EditorCanvas>` inside the canvas container. It owns one `<canvas>` element matched to the Fabric image's screen-space transform via `useImageTransform` listeners. It draws:

- Hovered segment: 1.5px solid outline (color picked from a per-mask palette), 8% fill, no label.
- Selected segment: 2.5px outline + 12% fill + 1px shadow ring + label badge at the bbox top-left.

Outlines are computed once per mask (marching-squares contour) and cached on the `Mask` object in `maskStore`. Pan/zoom only re-renders the overlay layer, not the contours.

### Tool integration

Every tool's `onActivate(ctx)` reads `useSegmentSelection.getState().selectedSegmentId`. If non-null:
- The tool widget that appears uses `{ kind: 'mask:click', mask_id }` as the `Adjustment.scope`.
- The WebGL pipeline applies the adjustment masked.

If null, scope stays `{ kind: 'global' }`. Switching tools while a segment is selected re-anchors the new tool's widget to the same selection.

### Coexistence with existing select tools

`SelectPointTool`, `SelectBoxTool`, `SelectMultiPointTool` continue to function — they create *new* masks via SAM that register in `maskStore` and immediately become hoverable like AI-found ones. Segment-first interaction is the default canvas behavior; explicit select tools are an escape hatch for masks Anthropic didn't pre-flag.

## Analyze Pipeline + Progress

### Phases

| Phase | Work | Backend marker |
|---|---|---|
| `mechanical` | Histograms, color cast, palette, per-region statistics. Existing code. | Wraps `_compute_region_stats` etc. |
| `sam_embed` | SAM image embedding (~1–2s). Moved from lazy/on-click to eager at analyze start. | Wraps `SamClient.embed(session_id)`. |
| `ai_context` | Anthropic call (~3–5s) — `candidate_regions` + `problems` + `suggested_fused_tools`. | Wraps `anthropic_client.analyze_image_context(...)`. |
| `mask_precompute` | For each `candidate_region.bbox`, run SAM decode → register `MaskSummary` with the region label. Parallel via `asyncio.gather`. | New `_precompute_region_masks(doc, ctx, sam_client)`. |
| `widget_mint` | Existing `_mint_autonomous_suggestions` (≥2 widgets guaranteed). | Existing. |

### Parallelism

```
upload (instant)
   │
   ├── mechanical            (independent, fast)
   └── sam_embed             (independent, ~1–2s)
           │  ── joins ──
           ▼
        ai_context           (depends on image only)
           │
           ▼
        mask_precompute      (gated on sam_embed + ai_context, parallel decodes)
           │
           ▼
        widget_mint          (gated on ai_context)
```

`mechanical`, `sam_embed`, and `ai_context` can all start at upload time and proceed independently. The orchestrator awaits on the necessary upstreams before each gated step.

### SSE events

Three new event kinds added to `backend/app/state/events.py`:

```python
class PhaseStartedEvent(StateEvent):
    kind: Literal["phase.started"]
    payload: dict  # { phase: str, index: int, total: int }

class PhaseProgressEvent(StateEvent):
    kind: Literal["phase.progress"]
    payload: dict  # { phase: str, done: int, total: int }  # only mask_precompute uses this

class PhaseCompletedEvent(StateEvent):
    kind: Literal["phase.completed"]
    payload: dict  # { phase: str, duration_ms: int }
```

`analyze_image` emits one `phase.started` + one `phase.completed` per phase. `mask_precompute` additionally emits `phase.progress` as masks land (parallel decodes can finish out of order, that's fine).

### Frontend status strip

Extends `BackendStatusBar` / `useBackendStatus` to subscribe to `phase.*` events:

- Slides in on the first `phase.started`.
- Shows current phase label from a `PHASE_LABELS` map: `'Reading histograms…'`, `'Indexing image regions…'`, `'Asking Claude…'`, `'Tracing regions… (3/8)'`, `'Drafting suggestions…'`.
- Slides out 400ms after the final `phase.completed` (widget_mint).

### Skeleton widgets

Client-side only, no backend data. On `phase.completed` for `ai_context`, the frontend:
1. Reads `snapshot.image_context.candidate_regions[]`.
2. For each region, renders a skeleton card at the region's bbox centroid (dashed grey border, animated pulse, three placeholder rows).
3. As `mask.created` events arrive, the corresponding region's segment becomes hoverable (automatic — it's in `masks_index`).
4. On `phase.completed` for `widget_mint`, real widgets stream in via `widget.created`. The frontend cross-references real widgets to skeletons by `scope.label`. Skeletons without a matching widget fade out.

### Failure modes

| Failure | Behavior |
|---|---|
| `sam_embed` fails (e.g., backend out of memory, model unavailable) | Mark `sam_embed` phase failed. Skip `mask_precompute`. Continue to `widget_mint`. Status strip shows a soft error: "Segments unavailable — using full-image scope". No hover highlights. |
| `ai_context` fails (e.g., Anthropic rate limit) | Status strip shows: "AI context unavailable — try again". No suggestions, no skeleton widgets. The user can still edit manually; the tool widgets still work. |
| A single `mask_precompute` decode fails | Skip that region. Emit `phase.progress` with the decremented total. Other regions land normally. |

## Inspector — Linked List

The rewrite reduces the inspector to four small sections.

### Sections

1. **Selection** (single card, top)
   - Shows the currently selected segment: label + pixel % + mean luma + "click empty to clear" hint.
   - Empty state when no selection.

2. **Active widgets** (merged list)
   - AI-accepted widgets + tool widgets, sorted by most-recently-touched.
   - Row: 14px origin icon (AI = blue square with "AI" text; tool = grey square with the processing's lucide icon), name, scope label, status.
   - Focused row gets a left blue rail + tinted background.

3. **Suggestions** (compact rows)
   - AI widgets where `origin.kind === 'mcp_autonomous'` and not in `acceptedSuggestions`.
   - Row: dot + name + scope label.

4. **Segments** (chip cloud)
   - All masks in `snapshot.masks_index`.
   - Selected segment's chip is filled blue. Click a chip → set `selectedSegmentId`.

### Bidirectional sync

`useFocusedWidget()` is the single source of truth for "which widget is currently focused":

- Inspector row click → `setFocused(id)` → canvas widget animates to expanded state + camera nudges if offscreen.
- Canvas widget click → `setFocused(id)` → inspector row highlights + scrolls into view.
- Inspector row hover / canvas widget hover → `setHovered(id)` → soft glow on the other side. Cleared on `pointerleave`.

Both sides subscribe to one Zustand slice. No DOM-event coupling between them.

## Persistence — `.edp` Story

| Data | Survives `.edp` reload? | Stored where |
|---|---|---|
| Adjustment tool widgets (Curves, Light, Levels, Filters, Color, Kelvin) | ✅ Yes | Existing `Adjustment[]` per layer |
| Text tool widget content | ✅ Yes | `Layer.textMeta` already serialized |
| Transient tool widgets (Brush options, Crop config) | Reappear when the tool is re-activated; the underlying brush strokes / crop result persists via existing layer data | Active-tool slice (not in `.edp`) |
| Accepted AI widgets | ✅ Yes — baked to `Adjustment[]` on accept | Via `aiSource` provenance |
| Pending AI suggestions | ❌ No | Backend session, re-derived from analyze |
| SAM masks (segments) | ❌ No | Backend session, re-derived |
| Selected segment | ❌ No | Transient state slice |
| Anthropic image context | ✅ Yes (fingerprint cache) | Existing `useImageContext` disk cache |

### Accept = bake

When the user clicks **Accept** on an AI widget:

1. Backend `accept_widget` tool flips status + emits `widget.accepted` SSE event with payload `{ widget_id, nodes, bindings }` — the resolved adjustment shape.
2. Frontend SSE handler:
   ```ts
   case 'widget.accepted': {
     const { widget_id, nodes, bindings } = payload;
     // Map widget nodes + current binding values into Adjustment[] entries
     const adjustments = materializeAdjustments(nodes, bindings, widget);
     // Append to the active layer's adjustmentStack
     useEditorStore.getState().appendAdjustments(activeLayerId, adjustments);
     // Remove widget from snapshot
     s.snapshot.widgets = s.snapshot.widgets.filter(w => w.id !== widget_id);
   }
   ```
3. Each emitted `Adjustment` carries `aiSource = { widgetId, intent, reasoning?, acceptedAt }`.
4. The serializer round-trips `aiSource?` on adjustments — small addition to the existing field set.

### On `.edp` reload

- Layers + adjustments come back as today.
- An accepted-AI-origin adjustment renders as a tool widget on the canvas (it *is* a tool widget structurally); the header shows a tiny "AI" tag pulled from `aiSource.intent`.
- If the image fingerprint matches the cached `useImageContext`, segments + suggestions re-derive (or restore from cache) in the background.
- Re-analysis is automatic — same UX as a fresh upload.

## Refactor list

### New modules — frontend

| File | Job |
|---|---|
| `src/store/segment-selection-slice.ts` | hover / select / cycle |
| `src/store/focus-slice.ts` | focused widget id (canvas↔inspector sync) |
| `src/hooks/useSegmentInteraction.ts` | pointer state machine |
| `src/components/canvas/SegmentOverlay.tsx` | hover + selected outline rendering |
| `src/components/widget/CanvasWidgetLayer.tsx` | absolute-positioned widget host |
| `src/components/widget/SpawnPaletteWidget.tsx` | ⌘K floating spawn palette |
| `src/components/inspector/InspectorWidgetRow.tsx` | compact list row |
| `src/lib/widget-projection.ts` | `selectAllWidgets()` merger |
| `src/lib/scope-to-mask.ts` | Scope → mask bytes resolver |
| `src/lib/node-to-adjustment.ts` | widget Node[] → Adjustment[] |

### New modules — backend

| File | Job |
|---|---|
| `backend/app/state/events.py` | `phase.started` / `phase.progress` / `phase.completed` event kinds |
| `backend/app/tools/atomic/analyze_image.py` | Restructured: parallel kick-off, phase events, mask pre-compute |
| `backend/app/services/sam_client.py` | `decode_box_for_region(session_id, bbox, label)` convenience |

### Extended existing modules

| File | Change |
|---|---|
| `src/types/widget.ts` | `'tool_invoked'` origin kind + `anchor` field |
| `src/store/layer-slice.ts` | Re-add `AiSource` (simpler shape) |
| `src/store/backend-state-slice.ts` | `widget.accepted` materializes Adjustments |
| `src/components/inspector/InspectorPanel.tsx` | Rewrite to four-section linked list |
| `src/components/canvas/useAdjustmentPipeline.ts` | Wire `node-to-adjustment.ts` (memory follow-up #2) |
| `src/components/inspector/widget/WidgetCard.tsx` | `variant: 'ai' \| 'tool'`, `mode: 'canvas' \| 'inspector-row'` |
| `src/components/inspector/widget/LifecycleActions.tsx` | Tool variant: just a close (×) button |
| `src/core/serializer.ts` | Round-trip `aiSource?` on adjustments |
| `src/core/session-storage.ts` | Same |
| `src/components/EditorProvider.tsx` | Mount `useSegmentInteraction()` |

### Deleted

- `src/components/AiCommandPalette.tsx` — superseded by `SpawnPaletteWidget`.

### Memory follow-ups resolved by this plan

| Memory item | How |
|---|---|
| WebGL doesn't consume widget nodes (item #2) | `node-to-adjustment.ts` wires the pipeline end-to-end |
| Palette lost target selection (item #1) | `SpawnPaletteWidget` reads `selectedSegmentId` as scope |

## Open design decisions (locked-in defaults for v1)

| Decision | Default |
|---|---|
| Tool widget anchor when no segment selected | Top-right of canvas, user-draggable, position remembered per tool in `localStorage`. |
| Overlap cycle window | ±8px of last cycle origin in screen space. |
| Hover throttle | RAF-throttled (~60Hz cap). |
| Skeleton-to-real widget identity | Cross-reference by `scope.label`. Skeletons without a matching widget fade out at `widget_mint.completed`. |
| Stale `.edp` Anthropic context | Silently re-analyze in background. |
| Accept-then-undo | Undo restores the pre-accept state (widget back in snapshot, adjustment removed). |
| Empty-area click during select tool | Tool consumes the click. Use `Escape` to clear selection. |

## Tech stack

- React 19 + Vite + TypeScript strict
- Zustand v5 + Immer (existing)
- Fabric.js v7 (existing)
- Custom WebGL filter pipeline (existing)
- shadcn/ui + Radix + Tailwind v4 (existing)
- Python 3.12 + FastAPI + pytest (backend)
- vitest + Testing Library (frontend tests)
