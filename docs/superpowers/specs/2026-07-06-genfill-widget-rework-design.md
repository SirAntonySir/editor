# Generative-Fill Widget Rework

**Date:** 2026-07-06
**Status:** Design approved, pending implementation plan
**Area:** Genfill widget UI (`GenfillRegionPreview`, `GenfillWidgetBody`, `WidgetShell`) + backend intent

## Summary

Five refinements to the generative-fill widget:

1. **Side-by-side before/after** — replace the Before/After toggle with two previews shown next to each other.
2. **Wider genfill node** — a genfill-specific minimum width (420px) so the two previews are legible.
3. **Fixed title** — stop using the prompt as the widget title (long prompts widen the node); the header shows a constant "Generative fill".
4. **Spawn centered + edge to source** — the widget appears at the viewport center on spawn, with a tether edge back to its source image.
5. **"Continue in command palette" button** — moves the widget's context (target region + typed prompt) into Cmd+K in genfill mode and closes the widget.

No change to the genfill generation flow, crop geometry, mask handling, or accept/discard behavior.

## Motivation

- The single-canvas Before/After **toggle** hides half the comparison; showing both at once is the natural way to judge a fill.
- At the current shared widget min width (226px) two previews can't sit side by side legibly.
- The widget's title is the backend `intent`, and genfill sets `intent = prompt`, so a long prompt stretches the node header. The prompt already lives in the body input, so the title carrying it is redundant *and* harmful to layout.
- Genfill currently spawns beside its image via collision-aware placement; landing it center-screen (where the user's attention is) with a clear edge to the source makes the just-created fill obvious.
- The Cmd+K palette has richer composition (attach more context, agent tooling). A one-click hand-off lets the user escalate a quick fill into the palette without retyping the prompt or re-selecting the region.

## Current state (grounding)

- `src/components/widget/GenfillRegionPreview.tsx` — one `<canvas>` plus a `mode: 'before' | 'after'` toggle; a `useEffect` redraws that canvas per `mode` (before = source crop via `pixelStore`, after = fetched result crop). Crop geometry via `cropRectFor` (mask bbox → source px, padded). Rendered at the node's on-canvas display scale.
- `src/components/widget/GenfillWidgetBody.tsx` — renders `<GenfillRegionPreview>` in the `ready` state; owns prompt input, seed/regenerate, clip toggle, accept/discard. Unchanged by this work.
- `src/components/widget/WidgetShell.tsx` — `WIDGET_SHELL_MIN_WIDTH = 226` applied to every expanded widget (`minWidth`); collapsed pill is a separate fixed width. WidgetShell already branches to the genfill body, so it can detect genfill widgets.
- `backend/app/tools/widgets/genfill.py:240` — `intent=prompt or "Generative fill"`. `genfill_regenerate` does not touch `intent`.
- `src/lib/workspace-tether.ts` `buildTetherForWidget` — genfill (origin `tool_invoked`) flows through the same auto-tether path as other widgets; position comes from `nextSpawnPositionFor` (collision-aware, beside the target image). The widget's `layerId` points at the source image layer, so the tether resolves to that layer (a rail port under the per-layer tether model).
- `src/components/CommandPalette.tsx` — opens on a `spawn-palette:open` window `CustomEvent`; its `detail` already supports `{ mode?: PaletteMode, attachContext?: Array<Omit<AttachedContextItem,'id'>> }`. It has a `genfill` mode whose `genfillTarget` resolves `{ maskId, imageNodeId }` from `masksIndex` + the attached region context. The `detail` does NOT yet carry prompt text (the prompt `doc` is only restored on a failed-turn retry).
- `src/store/genfill-actions.ts` — `discardGenfill(widgetId)`; `backendTools.delete_widget` dismisses a widget.

## Design

### 1. Side-by-side previews (`GenfillRegionPreview.tsx`)

- Remove the `mode` state and the Before/After toggle buttons.
- Render **two canvases in a flex row**, each `flex-1` so they split the node's content width evenly, with a small gap. Each canvas sets `aspect-ratio` from the crop rect (`rect.w / rect.h`) so its height follows the shared width — this is the "split the content width" sizing decision (each preview scales to fit its half; tiny regions may upscale, which is accepted).
- Small uppercase caption above each: **BEFORE** (left), **AFTER** (right), using existing label styling tokens.
- Draw both on mount / geometry change: left canvas ← source crop (sync, `drawBefore`), right canvas ← fetched result crop (async, `drawAfter`). Two refs replace the single `canvasRef`; the mode branch in the effect goes away (both draw unconditionally). Canvas internal resolution stays the source-crop resolution (`rect.w × rect.h`); CSS scales it down to the half-width.
- Loading/error states are unchanged (they live in `GenfillWidgetBody`, which only mounts the preview when `status === 'ready'`).

### 2. Genfill-specific min width (`WidgetShell.tsx`)

- Keep `WIDGET_SHELL_MIN_WIDTH = 226` as the global default.
- Add `export const GENFILL_MIN_WIDTH = 420`.
- When the widget is a genfill widget (same condition WidgetShell already uses to render `GenfillWidgetBody`), use `GENFILL_MIN_WIDTH` for the expanded `minWidth`. Collapsed-pill width is unchanged.
- 420px gives each of the two previews ~190px — legible for typical masked regions without dominating the canvas.

### 3. Fixed title (`backend/app/tools/widgets/genfill.py`)

- Change `intent=prompt or "Generative fill"` → `intent="Generative fill"` (constant).
- The header title (rendered from `intent`) no longer varies with the prompt, so it can't widen the node. The prompt remains in the body input where it is edited.
- No other backend change; `genfill_regenerate` already leaves `intent` alone.

### 4. Spawn centered + edge to source (`workspace-tether.ts`)

- In `buildTetherForWidget`, when the widget is a genfill widget (`widget.genfill`), override the spawn position with the **viewport center** in flow coordinates (derived from the `viewport` bounds already passed in) instead of `nextSpawnPositionFor`. All other widgets keep collision-aware placement.
- The tether to the source forms via the existing path (genfill's `layerId` → source layer → its rail port). No change to tether creation itself — only where the widget lands.
- Undo batching (position + tether in one snapshot) is preserved.

### 5. "Continue in command palette" button (`GenfillWidgetBody.tsx` + `CommandPalette.tsx`)

- Add a button to `GenfillWidgetBody` (shown in compose and ready states) — e.g. "Continue in Cmd+K".
- On click it dispatches `spawn-palette:open` with:
  - `mode: 'genfill'`,
  - `attachContext: [ <region item for widget.genfill.maskId> ]` (label = region name, carrying the mask id so the palette's `genfillTarget` resolves to `{ maskId, imageNodeId }`),
  - `promptText: <current prompt>` (new field).
- **Palette extension:** `onOpen` reads an optional `promptText` and seeds the prompt `doc` from it (plain text → single-segment `PromptDoc`; inverse of the existing `docToPlainText`). Existing openers omit it and are unaffected.
- After dispatching, the button **dismisses the genfill widget** (`backendTools.delete_widget`), completing the move. The palette (genfill mode) spawns a fresh genfill widget from the same region on submit, so no state is lost.

## Testing

- `GenfillRegionPreview` test: asserts **two** canvases render in the `ready` state and the Before/After toggle buttons are gone; existing geometry assertions preserved.
- `WidgetShell` test: a genfill widget renders with the `GENFILL_MIN_WIDTH` min width; a non-genfill widget keeps `WIDGET_SHELL_MIN_WIDTH`.
- Backend test: `genfill_create` with a long prompt yields a widget whose `intent == "Generative fill"` (and the prompt is still stored on `genfill.prompt`).
- `workspace-tether` test: spawning a genfill widget positions it at the viewport center (not the beside-image slot) and creates a tether edge to the source layer.
- `GenfillWidgetBody` test: clicking "Continue in Cmd+K" dispatches `spawn-palette:open` with `mode: 'genfill'`, the mask region in `attachContext`, and `promptText` = the current prompt, then calls `delete_widget`.
- `CommandPalette` test: a `spawn-palette:open` carrying `promptText` seeds the prompt doc.

## Scope boundaries (out)

- No change to generation, seeds, clip-to-region, accept/discard, mask/crop geometry.
- No change to the collapsed-pill width or other widget types' min width.
- No new comparison affordances (slider wipe, zoom) — just the two static previews.
- The "continue in palette" hand-off targets **genfill mode only** (not agent/ask); it moves (deletes the widget), not copies.
- No change to how other widget types spawn (only genfill re-centers).

## Key files

- `src/components/widget/GenfillRegionPreview.tsx` — two canvases, drop toggle
- `src/components/widget/WidgetShell.tsx` — `GENFILL_MIN_WIDTH` + genfill branch
- `src/components/widget/GenfillWidgetBody.tsx` — "Continue in Cmd+K" button
- `src/lib/workspace-tether.ts` — genfill spawns at viewport center
- `src/components/CommandPalette.tsx` — `promptText` seed in `spawn-palette:open`
- `backend/app/tools/widgets/genfill.py` — constant `intent`
- Tests: `GenfillRegionPreview.test.tsx`, `WidgetShell.test.tsx`, `GenfillWidgetBody.test.tsx`, `CommandPalette.test.tsx`, `workspace-tether.test.ts`, `backend/tests/tools/test_genfill_tools.py`
