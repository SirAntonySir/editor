# Refine-Widget Feedback via the Command-Palette Pill

**Date:** 2026-07-07
**Status:** Approved (design)
**Author:** Anton + Claude

## Problem

Submitting a refine instruction from a widget is currently fire-and-forget with
**no feedback**. In `WidgetShell.handleRefineSubmit`:

```ts
function handleRefineSubmit(instruction: string) {
  if (!sessionId || offline) return;
  setRefinePending(true);
  void backendTools
    .refine_widget(sessionId, { widgetId: widget.id, instruction, edits: [], additions: [] })
    .finally(() => {
      if (!mountedRef.current) return;
      setRefinePending(false);
      setRefineOpen(false);
    });
}
```

The handler **never inspects `envelope.ok` / `envelope.error`** — it uses
`.finally()` and closes the input regardless. Consequences:

- **Success and failure look identical**: the refine bar simply disappears.
- **Network / backend errors are silently swallowed.**
- **No loading signal** beyond the input disabling itself (no spinner, no shimmer).

`backendTools.refine_widget` returns a `ToolEnvelope<{ widget: Widget }>` shaped
`{ ok: boolean; output?; error? }`, so the success/failure information is already
available — it is just discarded.

## Goal

Give the user clear loading, success, and error feedback for a refine — **reusing
only mechanisms that already ship**. No new pill state, no revived (retired) code,
no new event plumbing.

## Non-Goals

- No `toast.success()` variant (does not exist today; would be new API).
- No revival of the retired `'success'` kind in `BackendStatusBar` / `useBackendStatus`.
- No new `success` state on the command-palette pill.
- No tagged-`restore` union or new events to make the pill "reopen the widget bar".

## Existing mechanisms being reused

1. **Command-palette pill** (`src/components/ui/CommandTrigger.tsx`) already renders
   three states driven by `usePaletteRuntime`:
   - `pending` → `Loader2` spin + `ai-shimmer`, text `Working… <prompt>`
   - `error` → red `AlertCircle`, "That didn't go through — click to retry"
   - idle → `Plus`, "Search Atelier…"
2. **`usePaletteRuntime`** (`src/store/palette-runtime.ts`) exposes
   `start(prompt, restore)`, `finish()`, `fail(error)`, `clearError()`.
3. **`toast.info(text)`** (`src/components/ui/Toast.tsx`) — the confirmation channel
   already used by genfill accept, image-add (`document.ts:46`), export errors, etc.
   Renders through the docked status strip and auto-dismisses (`RUNTIME.toastDismissMs`, 4 s).

## Design

### State → mechanism mapping

| State | Mechanism (all pre-existing) |
|---|---|
| **Loading** | `usePaletteRuntime.getState().start('Refining… ' + instruction)`. Pill shows `Loader2` + `ai-shimmer`. `RefineInput` stays disabled (`pending` prop) as today. |
| **Success** | `usePaletteRuntime.getState().finish()` (clears the pill) **+** `toast.info('Refined')`. Refine bar closes. |
| **Error** | `usePaletteRuntime.getState().fail({ message: 'Refine failed' })` → pill's existing red error state. **Refine bar stays open with the typed instruction preserved** → inline retry where the action started. |

### The core fix: rewrite `handleRefineSubmit`

```ts
async function handleRefineSubmit(instruction: string) {
  if (!sessionId || offline) return;
  const palette = usePaletteRuntime.getState();
  // Concurrency gate: one pill, one status at a time.
  if (palette.pending) return;

  setRefinePending(true);
  palette.start('Refining… ' + instruction); // restore arg now optional

  try {
    const envelope = await backendTools.refine_widget(sessionId, {
      widgetId: widget.id,
      instruction,
      edits: [],
      additions: [],
    });
    // Pill + toast are GLOBAL — settle them regardless of widget mount state.
    if (envelope.ok) {
      usePaletteRuntime.getState().finish();
      toast.info('Refined');
    } else {
      usePaletteRuntime.getState().fail({ message: 'Refine failed' });
    }
    // Widget-local UI — guard on mount.
    if (mountedRef.current) {
      setRefinePending(false);
      if (envelope.ok) setRefineOpen(false); // close on success; keep open on error
    }
  } catch {
    usePaletteRuntime.getState().fail({ message: 'Refine failed' }); // global
    if (mountedRef.current) setRefinePending(false); // keep bar open
  }
}
```

Notes:
- The **pill state and toast are global**, so `finish()` / `fail()` / `toast.info`
  run whether or not the widget is still mounted — the pill is never left stuck in
  `pending`. Only the widget-local `setRefinePending` / `setRefineOpen` are guarded
  by `mountedRef`.
- On **error the bar is NOT closed** (contrast with today's unconditional
  `setRefineOpen(false)`), and `RefineInput`'s `text` state is preserved because
  the component stays mounted. The user edits and resends in place.
- The **concurrency gate** reads `pending` synchronously via `getState()` so a
  refine won't clobber an in-flight palette turn (or a second refine) that owns
  the pill.

### `palette-runtime.ts` tweak — optional `restore`

`start(prompt, restore)` currently requires a `PaletteRestore` snapshot
(`{ doc, attachedContext }`), which a refine does not have. Make the second
argument optional so refine can drive `pending` without fabricating a palette
snapshot:

```ts
start(prompt: string, restore?: PaletteRestore): void;
// impl:
start: (prompt, restore = null) =>
  set({ pending: prompt, phase: null, error: null, restore }),
```

Existing palette callers (which always pass a `restore`) are unchanged. When a
refine sets `pending` with `restore = null` and later `fail()`s, the pill shows
the error; clicking it opens the palette exactly as it does today — with a null
`restore` this is an ordinary fresh open (the palette already tolerates no
snapshot on normal open). No change required to the palette's restore consumer,
which already guards on a present `restore`.

### `RefineInput` — no change required

`RefineInput` already keeps its own `text` state and only disables on `pending`.
Because the component stays mounted on error, the typed text survives for retry.
No prop changes needed.

## Data flow

```
User types + Send (RefineInput)
      │
      ▼
WidgetShell.handleRefineSubmit(instruction)
      │  gate: bail if palette-runtime.pending already set
      ▼
usePaletteRuntime.start('Refining… ' + instruction)   ──▶ CommandTrigger pill: Loader2 + ai-shimmer
      │
      ▼
await backendTools.refine_widget(...)  →  ToolEnvelope<{ widget }>
      │
      ├── ok: true  ─▶ palette.finish()  + toast.info('Refined')  + close bar
      │                     └▶ pill returns to idle; status strip flashes "Refined"
      │
      └── ok: false / throw ─▶ palette.fail({ message: 'Refine failed' })  + keep bar open
                                    └▶ pill shows red error; user retries inline
```

## Error handling

- **Backend returns `ok: false`**: `fail({ message: 'Refine failed' })`; bar stays
  open with text; pill shows error.
- **Network / thrown exception**: same path via `catch`.
- **Component unmounts mid-flight**: the global pill state is always settled —
  `finish()` / `fail()` run in the resolved promise before any `mountedRef` guard —
  so the pill is never left stuck in `pending`. Only the widget-local
  `setRefinePending` / `setRefineOpen` updates are skipped when unmounted. (See test
  "unmount mid-flight clears the pill".)
- **Offline / no session**: existing early `return` unchanged; no pill activity.

## Testing

Unit / component tests (Vitest + RTL, matching existing widget tests):

1. **success**: `refine_widget` resolves `{ ok: true }` → `start` then `finish`
   called on the runtime; `toast.info('Refined')` emitted; refine bar closed
   (`refineOpen` false).
2. **error (ok:false)**: resolves `{ ok: false, error }` → `fail({message:'Refine failed'})`
   called; refine bar **still open**; the previously typed instruction still present
   in the input.
3. **error (throw)**: `refine_widget` rejects → same as (2) via `catch`.
4. **concurrency gate**: with `usePaletteRuntime` `pending` already set, calling
   `handleRefineSubmit` does not call `refine_widget` and does not touch runtime.
5. **loading**: while the promise is unresolved, `pending` on the runtime equals
   `'Refining… <instruction>'` and `RefineInput` is disabled.
6. **unmount mid-flight clears the pill**: unmount the widget before the promise
   resolves; on resolution the pill is not left in `pending` (runtime `finish`/`fail`
   ran).
7. **palette-runtime optional restore**: `start('x')` sets `pending:'x'`,
   `restore:null`; existing `start('x', snap)` still sets `restore:snap`.

Manual verification via preview: open a widget, Send a refine → pill shows
"Working… Refining…"; on success the strip flashes "Refined"; force a failure
(backend down) → pill shows error and the refine bar stays open with the text.

## Files touched

- `src/components/widget/WidgetShell.tsx` — rewrite `handleRefineSubmit`
  (await + `ok` check + pill wiring + `toast.info` + keep-bar-open-on-error + gate).
- `src/store/palette-runtime.ts` — make `restore` optional on `start`.
- Tests: `src/components/widget/WidgetShell.*test.tsx` (or the existing widget test
  file) covering the seven cases above.

## Rollback

The change is localized to one handler plus an optional-arg widening. Reverting
`handleRefineSubmit` to the `.finally()` form and dropping the optional `restore`
restores prior behavior with no schema or store-shape migration.
