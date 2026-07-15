# "Suggest something" — Zero-Result Feedback + Busy Indicator

**Date:** 2026-07-15
**Status:** Approved for implementation

## Problem

Clicking the bulb ("Suggest something") can legitimately produce nothing:

- Every detected problem sits below `SEVERITY_GATE` (0.4), AND a corrective
  problem at severity ≥ `_OPEN_CORRECTIVE_SEVERITY` (0.35) suppresses the
  aesthetic top-up ("never decorate a broken image") — the 0.35–0.39 dead
  zone guarantees zero widgets.
- The backend cooldown swallows a rapid second click (`_recent_run`).
- Three active autonomous suggestions already exist.

In all these cases the run completes silently: no widget events, no toast,
nothing on screen. The only in-flight indicator is a subtle opacity pulse on
the 12px bulb. From the user's chair the button looks broken.

`BackendStatusBar` was designed to cover the run — `suggest_widgets` emits
the `widget_mint` phase precisely so the bar can resolve — but once a prior
analyze completed, `mcpAnalyzeComplete` keeps the bar hidden, so standalone
suggest runs show nothing.

## Decisions (made with Anton)

| Question | Decision |
|---|---|
| Scope | Zero-result toast + stronger busy indicator. Surfacing the dead-zone *reason text* ("minor issue below threshold") is OUT of scope. |
| Toast detail | Backend `reason` field so the toast is truthful per case (not one generic message). |
| Busy indicator | Approach A: bulb spinner + re-armed `BackendStatusBar` (over spinner-only or start-toast). |

## Design

### 1. Backend — `suggest_widgets` output reason

`_Output` (backend/app/tools/atomic/suggest_widgets.py) gains:

```python
class _Output(BaseModel):
    widget_ids: list[str]
    # Why widget_ids is empty; null when widgets minted.
    reason: Literal["cooldown", "no_context", "nothing_to_suggest"] | None = None
```

- Cooldown early-return → `reason="cooldown"`.
- Missing-context early-return → `reason="no_context"`.
- Normal path with zero minted → `reason="nothing_to_suggest"`.
- ≥1 minted → `reason=None`.

Regenerate shared types (`gen:types` is enforced by `npm run check`); update
`SuggestWidgetsOutput` on the frontend accordingly.

### 2. Frontend — zero-result toast

- `suggestForImageNode` (src/hooks/useImageContext.ts) returns the tool
  output (`SuggestWidgetsOutput | null`; null when the analyze path was taken
  instead — analyze-with-suggest feedback flows through the status bar and
  chips as today).
- The bulb's click handler (`ImageNodeDrafting`) inspects the result: empty
  `widget_ids` → `toast.info(...)` via the existing `@/components/ui/Toast`:
  - `nothing_to_suggest` → "No new suggestions — nothing stood out on this image."
  - `cooldown` → "Suggestions were just refreshed — try again in a moment."
  - `no_context` → "Analyze the image first." (defensive; the bulb self-serves
    analyze so this shouldn't be reachable from this path.)
- ≥1 widget minted → no toast (the appearing chips are the feedback).
- Tool call rejected/error → existing error handling unchanged; no new toast.

### 3. Frontend — busy indicator

- **Bulb:** while `suggestBusy`, render `Loader2` with `animate-spin` in
  place of the `Lightbulb` (same 12px slot, stays `disabled`). Replaces the
  opacity pulse.
- **Status bar:** `useBackendState` currently latches `mcpAnalyzeComplete`
  once `widget_mint` completes and never un-latches, hiding the bar for
  later standalone suggest runs. Fix: a fresh `phase.started` for
  `widget_mint` (arriving while the previous run is complete) resets the
  latch (and stale phase map) so `BackendStatusBar` shows its progress line
  for the suggest-only run and resolves on the phase's completion, exactly
  as it does at the end of a full analyze.

### 4. Testing

- **Backend** (`tests/tools/test_suggest_widgets.py`): reason values for all
  three empty paths; `reason is None` when widgets mint.
- **Frontend:**
  - `suggestForImageNode` returns the tool output on the has-context path.
  - Bulb handler: toast text per reason; no toast when `widget_ids`
    non-empty.
  - `TopMarginalia`: spinner rendered while `suggestBusy`.
  - Backend-state slice: fresh `widget_mint` `phase.started` after a
    completed analyze un-latches `mcpAnalyzeComplete` / re-populates phases.

## Out of scope

- Explaining the dead zone in user-facing copy (severity numbers stay
  internal; the journal already records `suggestion_skipped` /
  `topup_skipped` reasons for study forensics).
- Changing `SEVERITY_GATE` / `_OPEN_CORRECTIVE_SEVERITY` values.
- Feedback changes to any other suggestion entry point (palette, Info tab
  Correct button).
