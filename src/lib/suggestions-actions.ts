import { useSuggestionsUi } from '@/store/suggestions-ui-slice';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';

/**
 * Dismiss every pending autonomous suggestion. Called when the user takes
 * explicit control (a direct Cmd+K prompt) so lingering suggestion chips don't
 * follow their prompt.
 *
 * Each suggestion is *denied* (`delete_widget`), not merely un-pended: an
 * un-pended-but-still-active widget would be materialised onto the image by
 * `useAutoTetherAiSuggestions`. `resolvePending` then drops it from the UI sets.
 */
export async function dismissAllPendingSuggestions(): Promise<void> {
  const ui = useSuggestionsUi.getState();
  const ids = [...ui.pendingSuggestionIds];
  if (ids.length === 0) return;
  const sessionId = useBackendState.getState().sessionId;
  await Promise.all(
    ids.map(async (widgetId) => {
      if (sessionId) {
        try {
          await backendTools.delete_widget(sessionId, { widgetId, suppressSimilar: false });
        } catch {
          // Best-effort: still drop it from the UI so the chip clears.
        }
      }
      useSuggestionsUi.getState().resolvePending(widgetId);
    }),
  );
}
