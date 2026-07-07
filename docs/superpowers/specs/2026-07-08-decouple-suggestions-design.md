# Decouple autonomous suggestions from analyze and direct prompts

**Date:** 2026-07-08
**Branch:** `feat/magic-lasso`
**Status:** Approved — ready for implementation

## Problem

Two related complaints:

1. **A direct Cmd+K prompt over an image surfaces autonomous suggestion chips**
   the user didn't ask for.
2. **There's no explicit "just suggest something" trigger** — suggestions are
   bundled into "Analyze with AI".

### Root cause (traced)

- The only producer of autonomous (`mcp_autonomous`) suggestion widgets is the
  `suggest_widgets` backend tool, invoked **only** from the frontend
  (`useImageContext.runAnalyse`). The agent turn mints `mcp_user_prompt` widgets
  (`agent_loop.py`), which never become suggestion chips.
- `runAnalyse({ suggest })` defaults `suggest` to **true**, so every "Analyze
  with AI" trigger (image menu, Info-tab CTA, menu bar, keyboard shortcut,
  TopMarginalia) fires `suggest_widgets`.
- `pendingSuggestionIds` (the set that drives `SuggestionChips`) is cleared only
  on a full `useBackendState.reset()` — **not** on a new analyze and **not** on a
  direct prompt. `palette-submit` already passes `suggest:false`, and if context
  already exists it skips analyze entirely. So autonomous suggestions minted by an
  earlier `suggest:true` run persist in `pendingSuggestionIds` + `snapshot.widgets`
  and linger through/after a later direct prompt — read as "I prompted and
  suggestions are still there."

## Goal

- Autonomous suggestions become **explicit opt-in**.
- "Analyze with AI" does analysis only (context + regions), no suggestions.
- A new "Suggest something" image-menu action is the single suggestion trigger.
- A direct prompt clears any lingering suggestions.

## Design

### Change 1 — Analyze no longer auto-suggests (default flip)

In `src/hooks/useImageContext.ts`, flip `runAnalyse`'s default:

```ts
const suggest = opts?.suggest ?? false;   // was: ?? true
```

Every existing "Analyze with AI" caller
(`NoContextState`, `keyboard-shortcuts`, `menu-actions`, `ImageNodeDrafting`,
`MenuBar`, `TopMarginalia`) becomes analysis-only with no call-site change.
`palette-submit` already passes `suggest:false` explicitly — unaffected. This
removes the main source of stray suggestions.

### Change 2 — "Suggest something" action (the opt-in)

New exported action `suggestForActiveImage()` in `useImageContext.ts`:

- **context missing** → `runAnalyse({ suggest: true })` (analyze, then suggest);
- **context present** → call `backendTools.suggest_widgets(sessionId, { layerId? })`
  directly (no redundant re-analyze).

Add a **"Suggest something"** item to the image (node) context menu in
`src/components/workspace/drafting/ImageNodeDrafting.tsx`, directly below
"Analyze with AI" (Sparkles-style icon). It targets that node's image layer (the
menu already resolves `id` → layer). This is the sole explicit trigger for the
`SuggestionChips` stack.

### Change 3 — A direct prompt dismisses lingering suggestions

New action `dismissAllPendingSuggestions()` (co-located with the suggestion UI
store / a small helper): for each id in `pendingSuggestionIds`, **deny** it —
`backendTools.delete_widget(sessionId, { widgetId, suppressSimilar: false })` +
`resolvePending(id)`. Denying (not merely un-pending) matters: un-pending alone
would leave the widget `active && !pending && !accepted`, which
`useAutoTetherAiSuggestions` would then materialise onto the image.

`submitAgentPrompt` (`src/lib/palette-submit.ts`) calls
`dismissAllPendingSuggestions()` at the start of the turn — "I'm driving; clear
the AI's suggestions."

## Non-goals

- **No backend changes.** `suggest_widgets`, `analyze_context`,
  `precompute_regions`, `agent_loop` unchanged.
- No change to how suggestion chips render or to the accept/deny chip UI.
- Not changing the stale-set-on-re-analyze behaviour beyond what Changes 1 + 3
  already cover (with analyze no longer suggesting and prompts dismissing, the
  residual leak path is closed for the reported flow).

## Data flow (after)

```
Analyze with AI (any trigger)
  → runAnalyse()            → suggest=false → context+regions only, NO chips

Suggest something (image menu)
  → suggestForActiveImage()
      context? → suggest_widgets            → chips
      no ctx?  → runAnalyse({suggest:true}) → analyze + chips

Cmd+K direct prompt
  → submitAgentPrompt()
      dismissAllPendingSuggestions()   → deny every pending suggestion (no chips)
      analyse({suggest:false}) if no context
      runAgentTurn(intent)             → mcp_user_prompt widgets only
```

## Testing

- `runAnalyse()` (no opts) does **not** call `suggest_widgets`; `{suggest:true}` does.
- `suggestForActiveImage`: context absent → runs analyze with suggest; context
  present → calls `suggest_widgets` only (no re-analyze).
- `dismissAllPendingSuggestions`: calls `delete_widget` for each pending id and
  empties `pendingSuggestionIds`.
- `submitAgentPrompt` invokes `dismissAllPendingSuggestions` before the turn.

## Files touched

- `src/hooks/useImageContext.ts` — default flip; `suggestForActiveImage`.
- `src/lib/palette-submit.ts` — dismiss pending suggestions at turn start.
- `src/store/suggestions-ui-slice.ts` (or a small helper) —
  `dismissAllPendingSuggestions`.
- `src/components/workspace/drafting/ImageNodeDrafting.tsx` — "Suggest something"
  menu item.
- Tests alongside each.
