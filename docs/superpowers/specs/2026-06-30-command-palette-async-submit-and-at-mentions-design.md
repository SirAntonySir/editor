# Command Palette — Async Submit (loading on the pill) + `@` Element Mentions

**Date:** 2026-06-30
**Status:** Design — pending review
**Area:** `src/components/CommandPalette.tsx`, `src/components/ui/CommandTrigger.tsx`, palette logic + runtime state

## Problem

Two related UX gaps in the Cmd+K command palette:

1. **The palette blocks while the agent works.** On submitting an Agent-mode prompt, the
   loading state (`pending` / `pendingPhase`) lives in `CommandPalette` local `useState`, the
   dialog **stays open** for the whole turn, and only closes on success. The minimized pill
   (`CommandTrigger`, a separate component) can't see the loading state, and the
   "elements we create" (the proposed widget stack / segmentation questions the turn spawns
   on the canvas) are hidden behind the open dialog. Reopening mid-flight resets `pending`,
   so the in-flight state is lost.

2. **No explicit way to reference an element.** Typing any word fuzzy-matches **regions only**
   and opens a caret-anchored dropdown (`RegionSuggestions`). There is no explicit trigger to
   pull up the full list, and **targets** (image nodes, layers) can't be referenced at all —
   `forced_targets` are only derived by extracting region chips, and the active node is sent
   implicitly.

## Goals

- **A.** Submitting a prompt **closes the palette immediately**; the **minimized pill shows the
  loading animation** for the whole turn; reopening mid-flight still shows it loading; a failed
  turn surfaces on the pill and restores the prompt on reopen.
- **B.** Typing **`@`** opens a dropdown of **all elements** (regions **+** targets: image nodes
  and layers), filtered by the text after `@`. Plain typing keeps its current region-only
  behavior. Selecting inserts a chip; target chips drive `forced_targets`.

## Non-Goals

- No change to how the agent turn streams proposals back or how suggestion widgets render on
  canvas (that surface already works while the palette is closed).
- No change to Ask mode.
- No queueing of a second prompt while one is in flight — submit stays blocked while `pending`.
- No new target kinds beyond image nodes and layers ("other targets" is out of scope for v1).

---

## Feature A — Async submit with loading on the pill

### A1. Shared runtime store

New standalone Zustand store `src/store/palette-runtime.ts` (kept out of the composed
`EditorStore` so we don't touch slice wiring). Both the palette and the pill subscribe.

```ts
interface PaletteRuntimeState {
  pending: string | null;                       // submitted prompt text, null when idle
  phase: 'analyze' | 'propose' | null;          // sub-phase for placeholder/pill text
  error: { message: string; hint?: string } | null;
  // Snapshot to repopulate the editor if the turn fails after the palette closed.
  restore: { doc: PromptDoc; attachedContext: AttachedContextItem[] } | null;

  start(prompt: string, restore: { doc: PromptDoc; attachedContext: AttachedContextItem[] }): void;
  setPhase(phase: 'analyze' | 'propose' | null): void;
  finish(): void;                               // success → clear everything
  fail(error: { message: string; hint?: string }): void; // keep `restore`, set error, clear pending
  clearError(): void;
}
```

`AttachedContextItem` moves from a `CommandPalette`-local interface to an exported type
(`src/lib/command-palette.tsx` or a small shared types module) so the store and palette share it.

### A2. Turn orchestration moves out of the component

New `src/lib/palette-submit.ts`:

```ts
export async function submitAgentPrompt(
  doc: PromptDoc,
  attachedContext: AttachedContextItem[],
): Promise<void>
```

Moves the existing `kind === 'ai'` block out of `CommandPalette.run`:
1. `serializePromptDoc(doc, attachedContext)` → `{ intent, chipSourceIds }`; bail if empty.
2. `usePaletteRuntime.start(intent, { doc, attachedContext })`.
3. If no AI context: `setPhase('analyze')` → `analyseActiveImageLayer({ suggest: false })`
   (on throw → `fail(...)`, return). Then `setPhase('propose')`; bail if context still null
   (user ESC'd analyze) → `finish()`.
4. `runAgentTurn(intent, chipSourceIds)` → `ok` ? `finish()` : `fail({ message: 'The agent could not complete that request.' })`.

Because this is module-level, it survives the palette unmounting its dialog content.

### A3. Submit closes the palette immediately

In `CommandPalette.run`, the `kind === 'ai'` branch becomes:
```ts
if (cmd.kind === 'ai') {
  if (usePaletteRuntime.getState().pending) return;     // block double-submit
  const { intent } = serializePromptDoc(doc, attachedContext);
  if (!intent) return;
  void submitAgentPrompt(doc, attachedContext);         // fire, do not await
  resetPalette();
  setOpen(false);
}
```

### A4. The pill shows the loader

`CommandTrigger` subscribes to `usePaletteRuntime`:
- `pending` truthy → pill renders the shimmer (`ai-shimmer`) + `Loader2` spinner and a truncated
  prompt label (e.g. `Working… "brighten the sky"`). Phase may refine the verb
  (Analyzing / Working).
- `error` truthy → pill renders a red alert state (`AlertCircle`); clicking reopens the palette
  (existing `spawn-palette:open`).
- otherwise → today's idle pill.

The pill only mounts while the palette is closed (`!paletteOpen`), which is exactly the
in-flight window, so no extra gating is needed. The Framer `layoutId` morph is unchanged.

### A5. Reopen behavior

`CommandPalette`'s open handler **no longer resets** `pending`/`phase`/`error` (those live in the
store now). On open:
- If `pending` → show disabled input + phase-aware placeholder, same visuals as today but driven
  by the store.
- If `error` → call nothing destructive; **restore** `doc` + `attachedContext` from
  `runtime.restore` into the editor, show the existing error banner ("Press Enter to retry").
  Retry re-runs `submitAgentPrompt`. `clearError()` on edit.

### A6. Data flow (A)

```
Enter (ai row)
  → submitAgentPrompt(doc, ctx)         [palette-submit.ts]
      runtime.start(intent, {doc,ctx})
      (close palette + resetPalette in CommandPalette, immediately)
      [analyze?] runtime.setPhase('analyze') → analyse… → setPhase('propose')
      runAgentTurn(intent, chipSourceIds) → backendTools.agentTurn(...)
        ok  → runtime.finish()           → pill returns to idle
        err → runtime.fail({message})    → pill red; reopen restores doc+ctx
  ── meanwhile ──
  CommandTrigger subscribes runtime → shimmer/spinner while pending
  proposed widgets/segmentation questions stream onto the canvas (existing path)
```

---

## Feature B — `@` element mentions (regions + targets)

### B1. Trigger detection

New helper in `src/lib/prompt-doc.ts`:
```ts
export function triggerBeforeCaret(textBeforeCaret: string): { trigger: '@' | null; query: string };
// "fix the @sky" → { trigger: '@', query: 'sky' }
// "fix the sky"  → { trigger: null,  query: 'sky' }   (existing word path)
```
`PromptEditor`'s caret reporting passes the raw `textBeforeCaret`; `CommandPalette.handleCaretWord`
branches: `@` → full element list filtered by `query`; otherwise → today's region-only ranking.

### B2. Unified element model

```ts
export interface PaletteElement {
  kind: 'region' | 'target';
  targetKind?: 'node' | 'layer';     // when kind === 'target'
  label: string;
  sourceId: string;                  // region:object:* | region:ai:* | target:node:* | target:layer:*
}
```

`elementList` (memoized in `CommandPalette`) = existing `regionList` (regions) **+**
- image nodes → `{ kind:'target', targetKind:'node', label: imageNodeLabel(node), sourceId:`target:node:${id}` }`
- layers → `{ kind:'target', targetKind:'layer', label: layer.name, sourceId:`target:layer:${id}` }`

`region-suggest.ts` generalizes `rankRegions` → `rankElements(elements, query)` (same fuzzy
scoring over `label`). Plain typing passes `regions only`; `@` passes the full `elementList`.

### B3. Dropdown rendering

`RegionSuggestions.tsx` renders a per-kind affordance:
- region → `MapPin`, tag "Region" (today's look)
- target/node → `Image` icon, tag "Image"
- target/layer → `Layers` icon, tag "Layer"

### B4. Chip insertion + serialization

Selection inserts a chip at the caret, stripping the `@query` token (extend the editor's
word-strip to also consume a leading `@`). Chips reuse the inline-chip DOM.

Serialization (in `runAgentTurn` / `prompt-doc.ts`):
- `region:object:*` / `region:ai:*` → **unchanged** (force-extract or fallback `attached_objects`).
- `target:node:<id>` → push `{ image_node_id: id, layer_ids: node.layerIds }` to `forced_targets`.
- `target:layer:<id>` → resolve the layer's owning image node; push
  `{ image_node_id: ownerNodeId, layer_ids: [layerId] }` to `forced_targets`.

Dedup `forced_targets` by `image_node_id` (merge `layer_ids`) so an image-node chip plus one of
its layer chips don't double-target.

### B5. Data flow (B)

```
type "@"            → triggerBeforeCaret → {trigger:'@', query:''}
                    → rankElements(elementList, '') → dropdown: all regions + targets
type "@sk"          → rankElements(elementList, 'sk') → filtered
Enter/click element → insertChipAtCaret(label, sourceId)   (strip "@sk")
…submit             → serializePromptDoc → region ids + NEW target sourceIds
                    → runAgentTurn: regions→extract/fallback, targets→forced_targets
```

---

## Files touched

**New**
- `src/store/palette-runtime.ts` — shared in-flight store (A1).
- `src/lib/palette-submit.ts` — `submitAgentPrompt` orchestration (A2).

**Edited**
- `src/components/CommandPalette.tsx` — submit closes immediately + fires `submitAgentPrompt`;
  read runtime store for in-flight/error/restore; `@` branch in `handleCaretWord`; build
  `elementList`; pass kind to the dropdown.
- `src/components/ui/CommandTrigger.tsx` — subscribe to runtime store; loading + error pill states.
- `src/lib/prompt-doc.ts` — `triggerBeforeCaret`; target-chip serialization helpers.
- `src/lib/palette-actions.agent.ts` — `runAgentTurn` consumes target chips → `forced_targets`
  (dedup with region-derived targets).
- `src/lib/region-suggest.ts` — `rankRegions` → `rankElements` (regions stay a subset).
- `src/lib/command-palette.tsx` — `PaletteElement` type; export `AttachedContextItem`; a
  `buildTargetElements(imageNodes, layers)` helper.
- `src/components/RegionSuggestions.tsx` — per-kind icon + tag.
- `src/components/ui/PromptEditor.tsx` / `prompt-editor-dom.ts` — strip a leading `@` on insert;
  surface `textBeforeCaret` for trigger detection.

## Edge cases

- **Double submit** — blocked while `runtime.pending` is set.
- **ESC during analyze** — `submitAgentPrompt` bails and `finish()`es (no error).
- **Reopen during flight** — shows in-flight state; closing again re-shows the pill loader (both
  read the same store).
- **Failure** — pill red + toast; reopen restores `doc` + `attachedContext`, shows error banner.
- **Empty `@`** — dropdown lists everything; if there are zero elements, no dropdown.
- **Node + its layer both chipped** — `forced_targets` dedup by `image_node_id`, merge `layer_ids`.
- **Target chip but image deleted before submit** — drop unresolved target sourceIds silently.

## Testing

- `palette-runtime` store: start/setPhase/finish/fail/clearError transitions (unit).
- `triggerBeforeCaret`: `@`, `@sky`, plain word, `@` mid-word vs after space (unit).
- `rankElements`: regions-only vs full list filtering (unit).
- target serialization in `runAgentTurn`: node chip → forced_targets; layer chip → owner node +
  layer; dedup node+layer (unit, mock `backendTools.agentTurn`).
- `CommandPalette` submit: fires `submitAgentPrompt` and closes immediately; reopen mid-pending
  shows loading; reopen after fail restores prompt (component test, mock submit).
- `CommandTrigger`: renders spinner when `pending`, red state when `error` (component test).

## Open questions

None blocking. "Other targets" beyond image nodes/layers intentionally deferred.
