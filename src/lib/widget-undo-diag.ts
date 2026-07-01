// TEMP DIAGNOSTIC — investigating "undo of apply/deny doesn't bring the widget
// chip back". Logs the pending/accepted suggestion sets alongside the backend
// snapshot's widget statuses at each boundary. REMOVE after triage.
import { useSuggestionsUi } from '@/store/suggestions-ui-slice';
import { useBackendState } from '@/store/backend-state-slice';

export function logWidgetUndoDiag(tag: string, extra?: Record<string, unknown>): void {
  const ui = useSuggestionsUi.getState();
  const snap = useBackendState.getState().snapshot;
  const widgets = (snap?.widgets ?? []).map((w) => ({
    id: w.id,
    status: w.status,
    origin: w.origin?.kind,
  }));
  // eslint-disable-next-line no-console
  console.warn(`[widget-undo-diag] ${tag}`, {
    ...extra,
    revision: snap?.revision,
    pending: [...ui.pendingSuggestionIds],
    accepted: [...ui.acceptedSuggestions],
    widgets,
  });
}
