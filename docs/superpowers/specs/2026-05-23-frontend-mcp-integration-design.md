# Frontend MCP Integration — Design

**Date:** 2026-05-23
**Status:** Approved for plan-writing
**Prerequisite:** Backend Plans 1, 2, 3 complete and merged (`plan3-mcp-stream-complete` tag).

## Goal

Wire the React editor to the backend's MCP/SSE contract so widgets become the first-class AI surface. Replace the legacy `ai-panel` layer model with a widget-driven inspector. Guarantee at least two autonomous suggestion widgets per image, regardless of how many high-severity problems Claude finds.

After this lands, an external MCP client can drive the editor's AI surface live: `propose_widget` over `/mcp` shows up in the user's inspector via the SSE state stream within one event loop.

## Out of scope

- Dismissed-widget "restore" history surface.
- Inline mask painting from a widget's `region_picker` (creating a new mask via SAM mid-edit).
- WebGL parity for `preview_widget` (CPU approximation is what we ship).
- Multi-session / shared cursors / CRDT.
- Migrating existing `.edp` documents with `ai-panel` layers: legacy layers are stripped on load with a `console.warn`.

## Architecture

The frontend becomes a renderer over the backend's `SessionStateSnapshot`. One new Zustand slice (`backend-state-slice`) holds the snapshot; one SSE subscriber patches it; one tool-call helper writes through `/api/tools/<name>`. The WebGL pipeline gets its inputs from a `selectPipelineNodes(snapshot)` selector. The inspector renders widgets directly — no more `ai-panel` layer materialization.

### Module layout

```
src/store/backend-state-slice.ts          # SessionStateSnapshot + applyOptimistic + applyEvent
src/lib/backend-tools.ts                  # typed wrappers around /api/tools/<name>
src/lib/sse-subscriber.ts                 # opens /api/state/{sid}/events, dispatches to slice
src/lib/palette-actions.ts                # replaces ai-palette-submit.ts; one fn: proposeFromPalette
src/components/inspector/widget/
  WidgetCard.tsx                          # header + binding list + LifecycleActions
  BindingRow.tsx                          # dispatches on binding.control_type
  PreviewThumbnail.tsx                    # consumes preview_widget REST; lazy + cached
  LifecycleActions.tsx                    # Accept / Refine / Repeat / Delete
  primitives/
    SliderControl.tsx
    ToggleControl.tsx
    ChoiceControl.tsx
    ColorControl.tsx
    RegionPickerControl.tsx
    MaskThumbnailControl.tsx
src/components/inspector/SuggestionsRail.tsx   # collapsed suggestion cards header
```

### Data flow

```
boot:     createSession → analyze_image (backend mints ≥2 suggestions)
          → GET /api/state/{sid}                  (initial snapshot)
          → open SSE /api/state/{sid}/events      (live patches)

slider:   WidgetCard onChange
          → applyOptimistic(slice)                (immediate WebGL rerender)
          → set_widget_param REST                 (fire-and-forget)
          → widget.updated SSE                    (clears optimistic flag)

palette:  proposeFromPalette(text, scope?)
          → propose_widget REST
          → widget.created SSE                    (widget appears in inspector)

external Claude over MCP:
          → SSE event arrives, frontend renders identically
```

### Files deleted

| Path | Reason |
|---|---|
| `src/store/ai-panel-actions.ts` | Layer-materialization gone. |
| `src/store/ai-chips-store.ts` | Chip selections replaced by `masks_index` + `RegionPickerControl`. |
| `src/lib/ai-palette-submit.ts` | Replaced by `palette-actions.ts`. |
| `src/components/inspector/AiPanelHeader.tsx` | Refine moves into per-widget `LifecycleActions`. |
| `src/components/inspector/AiPanelSection.tsx` | Replaced by `WidgetCard`. |

### Type / store surface removed

- `'ai-panel'` from the `LayerType` union.
- `layer.operationGraph`, `layer.panelBindings`, `layer.aiSteps`.
- `Adjustment.aiSource` (provenance reads from `widget.origin` + `widget.created_at`).
- `generatePanel` and `refinePanel` from `src/lib/ai-client.ts`.
- `resolveSmartTarget`, `renderTargetSnapshot`, the `TargetRef` and `InsertionIntent` types — scope is now a typed `Scope` from the backend.
- `useAiSession.lastAnalysedFingerprint` and the analyse-on-fingerprint-change branch (backend handles re-analyze idempotency).

### Files untouched

`useEditorStore.layers` (image, text, brush, crop), per-layer adjustments from user-driven processing tools (`processing/*.tsx`), `pixelStore`, `maskStore`, `editorDocument`, `historyStore`, `ProcessingRegistry`, `ToolRegistry`, and all canvas tools (crop, brush, text).

## `BackendStateSlice` + SSE subscriber

```ts
// src/store/backend-state-slice.ts
type WidgetId = string;

/** Optimistic patches scope to binding value updates — the only mutation
 *  surface a drag can produce. Other mutations (refine/repeat/delete) are
 *  not optimistic; they wait for the SSE event. */
interface OptimisticPatch {
  bindings: { paramKey: string; value: number | string | boolean }[];
  baseRevision: number;
}

interface BackendState {
  sessionId: string | null;
  snapshot: SessionStateSnapshot | null;     // verbatim from /api/state/{sid}
  optimistic: Map<WidgetId, OptimisticPatch>;
  sseStatus: 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';
  hydrate(sessionId: string): Promise<void>;
  applyEvent(ev: StateEvent): void;
  applyOptimistic(widgetId: WidgetId, patch: OptimisticPatch): void;
  reset(): void;
}
```

Each `StateEvent.kind` (`widget.created` / `widget.updated` / `widget.deleted` / `widget.accepted` / `widget.restored` / `mask.created` / `selection.changed` / `context.updated` / `dismissal.added`) has one handler that produces a next snapshot via Immer. `applyEvent` also drops any optimistic patch whose `baseRevision < event.revision`.

### SSE subscriber

- `EventSource` on `/api/state/{sid}/events`.
- Each `MessageEvent.data` is JSON-parsed and routed to `applyEvent`.
- Exponential backoff on `onerror` (250ms → 4s cap).
- Reconnect strategy for v1: **refetch `GET /api/state/{sid}` and replace the snapshot.** No `Last-Event-ID` replay — simpler, lossy-but-correct.
- One subscriber per session, owned by `useBackendSession(sid)` (mounts in `EditorProvider`).

### Optimistic reconciliation

Slider drag → `applyOptimistic(widgetId, { baseRevision: snapshot.revision, bindings: [{paramKey, value}] })`. WebGL reads merged state (`snapshot ⊕ optimistic`). When `widget.updated` arrives at `revision > baseRevision`, the patch is dropped — server value becomes authoritative. If the server clamped differently than we sent, the next render reflects that automatically.

Out-of-order SSE events are last-write-wins by event `revision`. Events at `revision <= snapshot.revision` are dropped (defensive — backend already guarantees monotonic revisions).

## Widget renderers + `WidgetCard`

`WidgetCard` is the visual unit: header (intent + status badge), an ordered list of `BindingRow`s, and a footer with lifecycle actions. `BindingRow` dispatches on `binding.control_type` to the right primitive.

### Suggestion vs active visual

Suggestion cards (`origin.kind === 'mcp_autonomous'` + `status === 'active'` + never accepted) render collapsed with thumbnail + intent + [Accept] [Dismiss]. Expanding reveals bindings. Active cards render expanded with full controls.

Both live in the same `InspectorPanel` scroll surface, separated by a divider — no dedicated above-the-fold strip.

### Control-type → primitive

| `control_type` | Primitive | Schema fields |
|---|---|---|
| `slider` | `SliderControl` | `min`, `max`, `step`, `unit?` |
| `toggle` | `ToggleControl` | `on_label`, `off_label` |
| `choice` | `ChoiceControl` | `options: [{value, label, description?}]` |
| `color` | `ColorControl` | `mode: "rgb" \| "hex"` |
| `region_picker` | `RegionPickerControl` | masks_index-driven |
| `mask_thumbnail` | `MaskThumbnailControl` | read-only mask label (single mask by id) |

### Primitive call surface

Every primitive accepts `(value, default, onChange)`. `value` reads from `snapshot ⊕ optimistic` via `useWidgetBinding(widgetId, paramKey)`. `onChange` calls `applyOptimistic` then `backendTools.set_widget_param`. Same write surface for every control — no per-type logic.

### Reasoning + provenance

`ReasoningBadge` reads `binding.reasoning` (per-binding) falling back to `widget.reasoning` (per-widget). Origin/timestamp come from `widget.origin.kind` + `widget.created_at`.

### Preview thumbnails

`PreviewThumbnail` is lazy — fires `preview_widget` REST on first mount, caches the b64 in component state keyed by `(widget_id, widget.revision)`. Every `widget.updated` event bumps the widget's revision, which invalidates the cache and triggers a refetch — so previews stay accurate after slider drags settle. If `image_b64: null` (unsupported node type) we render a CSS-only placeholder with the widget's intent text. No error surfaced — `kind="none"` is a valid state.

## WebGL pipeline integration

Today's `useAdjustmentPipeline` reads adjustments from `useEditorStore.layers[].adjustments`. After this refactor the WebGL inputs come from the projected `OperationGraph` instead.

```ts
// src/store/backend-state-slice.ts (selector)
export function selectPipelineNodes(): PipelineNode[] {
  const snap = useBackendState.getState().snapshot;
  const opt  = useBackendState.getState().optimistic;
  if (!snap) return [];
  return mergeOptimistic(snap.operation_graph.nodes, opt).map(toPipelineNode);
}
```

`PipelineNode` is the existing `pipeline-manager` input shape (id, type, params, scope). `toPipelineNode` is a pure mapper from one `Node` of the projected graph. No `pipeline-manager` surgery; just a new producer.

### Two parallel pipeline inputs

1. **Per-layer adjustments** (existing path, unchanged) — for user-driven processing tools like `light` / `curves` / `levels`. They write to `layer.adjustments`.
2. **Session-wide widget projection** (new) — for AI-authored ops. Composed as a session-wide overlay above the per-layer adjustments.

This keeps the two worlds cleanly separated. User-driven processing tools do not go through the backend.

### Scope translation

`operation_graph.nodes[].scope` arrives as `{kind:"global"}` / `{kind:"mask:proposed", label}` / `{kind:"mask:click"}`. The pipeline knows global and per-mask; mask-scoped nodes look up the matching mask in `snapshot.masks_index` (id + bbox + thumbnail b64). Full mask pixels come from `maskStore`, populated when a `mask.created` SSE event lands (the subscriber writes the PNG b64 through `maskPngBase64ToBytes`).

### Re-render

Every optimistic patch causes a re-render. Slider drags throttle at the source via `requestAnimationFrame` (existing pattern), so the load profile is the same as today's adjustment-driven pipeline.

## Inspector restructure

```
┌─ Inspector ──────────────────────────────┐
│  ┌─ Suggestions (3) ────────[ collapse ]┐ │
│  │ • [thumb] Recover sky highlights     │ │
│  │   [Accept] [Dismiss]                 │ │
│  │ • [thumb] Warm grade                 │ │
│  │   [Accept] [Dismiss]                 │ │
│  │ • [thumb] Subject pop                │ │
│  │   [Accept] [Dismiss]                 │ │
│  └──────────────────────────────────────┘ │
│  ┌─ Active widgets ─────────────────────┐ │
│  │ ▾ Warmer skin                        │ │
│  │   [slider] Temperature       6500K   │ │
│  │   [slider] Highlight warmth     8    │ │
│  │   [toggle] Skin protect         on   │ │
│  │   ──────────────────────────────     │ │
│  │   [Refine] [Repeat] [Delete]         │ │
│  │ ▸ Exposure balance                   │ │
│  └──────────────────────────────────────┘ │
│  ┌─ Layer properties ───────────────────┐ │
│  │ Opacity / Blend mode (unchanged)     │ │
│  └──────────────────────────────────────┘ │
└────────────────────────────────────────────┘
```

`InspectorPanel.tsx` reads three slices from `useBackendState`:
- `suggestions = widgets.filter(w => w.origin.kind === 'mcp_autonomous' && w.status === 'active' && !w.acceptedAt)`
- `actives = widgets.filter(w => w.status === 'active' && !suggestions.includes(w))`
- everything else dismissed/restorable lives in a deferred "history" surface (out of scope).

### Lifecycle actions per card

| Action | Tool call | UI |
|---|---|---|
| Accept (suggestions) | `accept_widget(widget_id)` | Promotes collapsed → expanded |
| Refine | `refine_widget(widget_id, instruction)` | Inline input + submit, per widget |
| Repeat | `repeat_widget(widget_id)` | One-shot re-roll button |
| Delete | `delete_widget(widget_id, suppress_similar?)` | Suggestion variant fires `suppress_similar=true`; active widget fires without |

Restore is deferred (no dismissed-history surface in v1).

## Palette migration

```ts
// src/lib/palette-actions.ts — replaces ai-palette-submit.ts
export async function proposeFromPalette(
  text: string,
  scope: Scope = { kind: 'global' },
): Promise<void> {
  const sid = useBackendState.getState().sessionId;
  if (!sid) return;
  await backendTools.propose_widget({ intent: text, scope, prompt: text });
  // widget.created SSE will render the new widget into InspectorPanel
}
```

The palette gets an optional scope picker (dropdown of `masks_index` named regions + "Whole image"). Default is global.

No frontend layer materialization, no client-side target resolution, no `renderTargetSnapshot` snapshot upload — the backend already has the image and projects scope at render time.

## Backend ≥2 suggestion top-up

In `backend/app/tools/atomic/analyze_image.py`, after the existing problem-driven loop:

```python
MIN_AUTONOMOUS_SUGGESTIONS = 2

current = [w for w in doc.widgets.values()
           if w.origin.kind == "mcp_autonomous" and w.status == "active"]
if len(current) >= MIN_AUTONOMOUS_SUGGESTIONS:
    return

needed = MIN_AUTONOMOUS_SUGGESTIONS - len(current)
already_used = {w.fused_tool_id for w in current if w.fused_tool_id}
candidates = anthropic.suggest_fused_tools_for_character(
    grade_character=ctx.grade_character,
    lighting=ctx.lighting,
    dominant_tones=ctx.dominant_tones,
    subjects=ctx.subjects,
    exclude=list(already_used),
    n=needed,
    session_id=doc.session_id,
)
for fused_id in candidates:
    if fused_id not in templates or _dismissed(fused_id, Scope.model_validate({"kind": "global"})): continue
    origin = WidgetOrigin(kind="mcp_autonomous", prompt=None)
    intent = templates[fused_id].typical_use[:60]
    widget = await run_fused_tool(
        templates[fused_id], intent=intent, scope=Scope.model_validate({"kind": "global"}),
        ctx=ctx, prior=None, instruction=None, anthropic=anthropic, origin=origin,
    )
    if widget is not None:
        doc.add_widget(widget)
```

### New `AnthropicClient` method

```python
def suggest_fused_tools_for_character(
    self, *, grade_character, lighting, dominant_tones, subjects,
    exclude, n, session_id=None,
) -> list[str]:
    """Ask Claude to name N fused-tool IDs that fit the image's overall
    character, excluding ones we've already suggested. Returns template
    ids in priority order."""
```

Single tool-use call with `output_schema = {"picks": list[str]}`. Caches the prompt prefix (catalog + character schema). Same `templates` catalog passed in as `name_pick_fused_tool`.

### Scope for top-ups

Always `global`. Problem-driven suggestions keep per-problem scope (already handled).

### Cost

Worst case one extra Claude call per `analyze_image` (on the cold path only when problems are sparse).

## Error handling

| Scenario | Behavior |
|---|---|
| SSE drops | `sseStatus: 'reconnecting'`, exponential backoff. On reconnect, refetch snapshot. Inspector footer shows `Connecting…` after >2s offline. |
| `set_widget_param` non-2xx | Discard optimistic patch; toast the message; slider snaps to snapshot. |
| `propose_widget` returns `{ok:false}` | Palette shows `error.message`; `recovery_hint` renders as secondary line; no widget appears. |
| `refine_widget` returns `{ok:false}` | Widget card shows error chip inline; refine input stays open with the failed text. |
| `preview_widget` returns `image_b64:null` | `PreviewThumbnail` renders CSS placeholder. Not an error. |
| Backend unreachable on boot | Top-of-screen banner; rest of editor (layers, brush, crop, export) keeps working from local state. |
| Stale SSE (`revision <= snapshot.revision`) | Dropped silently. |
| Out-of-order SSE | Last-write-wins by event `revision`. |

## Testing

### Unit (vitest)

- `backend-state-slice.applyEvent` — one test per `kind`, fixture snapshot + event → expected next snapshot.
- `mergeOptimistic` — no overlap; overlap with lower revision (keep); overlap with higher revision (drop).
- `toPipelineNode` — one fixture per node type (`kelvin`, `basic`, `curves`, `levels`, `lut`).
- `palette-actions.proposeFromPalette` — mocks `backendTools.propose_widget`; asserts payload shape.

### Component (vitest + Testing Library)

- Each control primitive — fires `onChange`, asserts rendered value updates.
- `WidgetCard` — suggestion-collapsed, active-expanded, dismissed-hidden; asserts `LifecycleActions` show the right buttons per state.
- `InspectorPanel` — fixture snapshot with 3 suggestions + 1 active widget; asserts both sections render with correct counts.

### Integration (Playwright)

- Boot flow: upload image → ≥2 suggestion cards within 5s against a fake-Claude backend.
- Accept → suggestion graduates to active section; controls become live.
- Slider drag → canvas updates within one frame; backend roundtrip confirmed via per-widget revision incrementing.
- External MCP call: harness POSTs `/mcp tools/call propose_widget` while the browser is open → new widget appears in the inspector via SSE.
- SSE drop: kill backend, restart, browser shows reconnection banner then recovers.

### Backend (extending pytest)

- §6 top-up tests: zero problems → top-up fills 2; one high-severity problem → top-up fills 1; two+ → top-up not called; dismissed candidates skipped.
- `suggest_fused_tools_for_character` schema-validation against a fake Claude.

## Rollout slices

Each slice is its own implementation plan task — small enough to ship green between commits.

1. **Backend ≥2 suggestion top-up** (`backend/`). Smallest; the rest of the work consumes it.
2. **`BackendStateSlice` + SSE subscriber + `useBackendSession`**. Dark-shipped (no UI changes yet).
3. **Widget renderers + `WidgetCard`**. Built against fixture data; not yet mounted.
4. **`InspectorPanel` rewrite + WebGL pipeline switch + `ai-panel` materialization deletion**. Behind `VITE_BACKEND_WIDGETS=1` env gate so both paths can run side-by-side during this slice.
5. **Palette migration**: `propose_widget` instead of `generatePanel`.
6. **Cleanup**: delete dead files (`ai-panel-actions`, `ai-chips-store`, `ai-palette-submit`, `AiPanelHeader`, `AiPanelSection`), shrink `useAiSession`, drop `aiSource` from `Adjustment`, drop `'ai-panel'` from `LayerType`, remove `VITE_BACKEND_WIDGETS` flag, run `npm run check` clean.

## Success criteria

- Opening any image produces ≥2 widgets in the inspector within 5 seconds (cold start, real Anthropic API).
- All six control types render and write through.
- An external MCP client calling `propose_widget` mid-session shows up in the inspector live, no refresh.
- Refine / Repeat / Delete / Accept work per-widget; no global "regenerate the panel" affordance remains.
- `npm run check` (tsc + eslint + no-nested-component rule) clean.
- Backend pytest suite stays green; new tests pass.
- `npm test` (frontend vitest) — green.
- `grep -r "ai-panel" src/` returns zero hits.

## Legacy session handling

Documents saved with the old `ai-panel` `LayerType` strip those layers on load with a `console.warn`. The OperationGraph data is lost. Acceptable for v1 (single-user, mid-thesis); revisit if real users have saved sessions.

## Open questions deferred to implementation plan

- Exact `MIN_AUTONOMOUS_SUGGESTIONS` constant placement (module-level vs. config) — pick whichever matches sibling backend constants.
- Should `RegionPickerControl` open in a popover or a sheet on mobile-width inspectors? Defer to writing-plans / implementation taste.
- The error chip styling on failed `refine_widget` — matches existing toast register or its own affordance? Pick during the §3 widget-renderer task.
