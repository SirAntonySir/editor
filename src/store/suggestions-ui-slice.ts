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
export interface SuggestionHistoryEntry {
  /** Widget id at the moment of the decision. The widget itself may be
   *  gone from the snapshot (denied = deleted), so the id is purely a
   *  uniqueness key here, not a live reference. */
  id: string;
  /** widget.intent at decision time — the user-facing summary. */
  intent: string;
  /** widget.reasoning at decision time — the Claude "why" blurb if any. */
  reasoning?: string;
  /** Allow click vs. Deny click in the SuggestionChips strip. */
  decision: 'allowed' | 'denied';
  /** Wall-clock ms at decision time (Date.now() in production). */
  decidedAt: number;
}

const HISTORY_CAP = 50;

export interface SuggestionsUiState {
  acceptedSuggestions: Set<string>;
  pendingSuggestionIds: Set<string>;
  previewingSuggestionIds: Set<string>;
  /** Ring of past Allow / Deny decisions, newest first. Capped at
   *  HISTORY_CAP so a chatty session can't blow memory. Surfaced by the
   *  MenuBar AI > Suggestion history submenu. */
  suggestionHistory: SuggestionHistoryEntry[];

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
  /** Append a decision to the history ring (newest first; capped). */
  recordSuggestionDecision: (entry: SuggestionHistoryEntry) => void;
  /** Drop all three sets + the history — called by `useBackendState.reset()`. */
  reset: () => void;
}

export const useSuggestionsUi = create<SuggestionsUiState>()(
  immer((set) => ({
    acceptedSuggestions: new Set(),
    pendingSuggestionIds: new Set(),
    previewingSuggestionIds: new Set(),
    suggestionHistory: [],

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

    recordSuggestionDecision: (entry) =>
      set((s) => {
        s.suggestionHistory.unshift(entry);
        if (s.suggestionHistory.length > HISTORY_CAP) {
          s.suggestionHistory.length = HISTORY_CAP;
        }
      }),

    reset: () =>
      set((s) => {
        s.acceptedSuggestions = new Set();
        s.pendingSuggestionIds = new Set();
        s.previewingSuggestionIds = new Set();
        s.suggestionHistory = [];
      }),
  })),
);
