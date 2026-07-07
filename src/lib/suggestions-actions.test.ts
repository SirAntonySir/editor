import { describe, it, expect, beforeEach, vi } from 'vitest';
import { dismissAllPendingSuggestions } from './suggestions-actions';
import { useSuggestionsUi } from '@/store/suggestions-ui-slice';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';

beforeEach(() => {
  useSuggestionsUi.getState().reset();
  useBackendState.getState().setSessionId('s1');
});

describe('dismissAllPendingSuggestions', () => {
  it('denies every pending suggestion and empties the pending set', async () => {
    const spy = vi
      .spyOn(backendTools, 'delete_widget')
      .mockResolvedValue({ ok: true, output: { ok: true } } as never);
    useSuggestionsUi.getState().markPending(['A', 'B']);

    await dismissAllPendingSuggestions();

    // Each pending suggestion is denied on the backend...
    expect(spy).toHaveBeenCalledWith('s1', { widgetId: 'A', suppressSimilar: false });
    expect(spy).toHaveBeenCalledWith('s1', { widgetId: 'B', suppressSimilar: false });
    // ...and the local pending set is emptied so no chips linger.
    expect(useSuggestionsUi.getState().pendingSuggestionIds.size).toBe(0);
  });

  it('is a no-op when there are no pending suggestions', async () => {
    const spy = vi.spyOn(backendTools, 'delete_widget');
    await dismissAllPendingSuggestions();
    expect(spy).not.toHaveBeenCalled();
  });
});
