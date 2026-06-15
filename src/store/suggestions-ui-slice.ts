import { enableMapSet } from 'immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

enableMapSet();

/** Frontend-only suggestion-UI state.
 *
 *  Kept OUT of `useBackendState` because that store mirrors the backend
 *  `SessionStateSnapshot` — these sets are pure UI gates the user drives
 *  via the SuggestionChips strip, the canvas preview eye, and the
 *  auto-tether hook.
 *
 *  - `acceptedSuggestions`: widgets the user has engaged at least once
 *    (clicked allow OR auto-tethered after session resume). Used by
 *    `useAutoTetherAiSuggestions` as a "tether-once" gate.
 *  - `pendingSuggestionIds`: autonomous widgets gated behind user
 *    Allow/Deny via chips. Populated reactively by `useBackendState`'s
 *    `widget.created` SSE handler (bridge call). Hides the widget from
 *    the inspector + canvas until resolved.
 *  - `previewingSuggestionIds`: subset of pending whose effect the user
 *    is canvas-previewing via the chip eye icon. */
export interface SuggestionsUiState {
  acceptedSuggestions: Set<string>;
  pendingSuggestionIds: Set<string>;
  previewingSuggestionIds: Set<string>;

  /** Mark a widget as engaged. Idempotent. */
  addAcceptedSuggestion: (widgetId: string) => void;
  /** Replace the pending set with `ids`. Called by the SSE handler when
   *  autonomous-origin widgets land in the snapshot. */
  markPending: (widgetIds: string[]) => void;
  /** Remove one id from pending; also clear its previewing flag. */
  resolvePending: (widgetId: string) => void;
  /** Toggle whether a pending suggestion's effect is shown on the canvas
   *  preview. `on=true` adds, `on=false` removes. */
  setPreview: (widgetId: string, on: boolean) => void;
  /** Drop all three sets — called by `useBackendState.reset()`. */
  reset: () => void;
}

export const useSuggestionsUi = create<SuggestionsUiState>()(
  immer((set) => ({
    acceptedSuggestions: new Set(),
    pendingSuggestionIds: new Set(),
    previewingSuggestionIds: new Set(),

    addAcceptedSuggestion: (widgetId) =>
      set((s) => {
        s.acceptedSuggestions.add(widgetId);
      }),

    markPending: (widgetIds) =>
      set((s) => {
        s.pendingSuggestionIds = new Set(widgetIds);
      }),

    resolvePending: (widgetId) =>
      set((s) => {
        s.pendingSuggestionIds.delete(widgetId);
        s.previewingSuggestionIds.delete(widgetId);
      }),

    setPreview: (widgetId, on) =>
      set((s) => {
        if (on) s.previewingSuggestionIds.add(widgetId);
        else s.previewingSuggestionIds.delete(widgetId);
      }),

    reset: () =>
      set((s) => {
        s.acceptedSuggestions = new Set();
        s.pendingSuggestionIds = new Set();
        s.previewingSuggestionIds = new Set();
      }),
  })),
);
