import { beforeEach, describe, expect, it } from 'vitest';
import { useSuggestionsUi } from './suggestions-ui-slice';

beforeEach(() => {
  useSuggestionsUi.getState().reset();
});

describe('useSuggestionsUi', () => {
  it('starts empty for all three sets', () => {
    const s = useSuggestionsUi.getState();
    expect(s.acceptedSuggestions.size).toBe(0);
    expect(s.pendingSuggestionIds.size).toBe(0);
    expect(s.previewingSuggestionIds.size).toBe(0);
  });

  it('addAcceptedSuggestion adds to acceptedSuggestions', () => {
    useSuggestionsUi.getState().addAcceptedSuggestion('w_1');
    useSuggestionsUi.getState().addAcceptedSuggestion('w_2');
    const s = useSuggestionsUi.getState();
    expect(s.acceptedSuggestions.has('w_1')).toBe(true);
    expect(s.acceptedSuggestions.has('w_2')).toBe(true);
    expect(s.acceptedSuggestions.size).toBe(2);
  });

  it('markPending replaces the pending set wholesale', () => {
    useSuggestionsUi.getState().markPending(['w_1', 'w_2']);
    expect(useSuggestionsUi.getState().pendingSuggestionIds.size).toBe(2);
    useSuggestionsUi.getState().markPending(['w_3']);
    const s = useSuggestionsUi.getState();
    expect(s.pendingSuggestionIds.size).toBe(1);
    expect(s.pendingSuggestionIds.has('w_3')).toBe(true);
    expect(s.pendingSuggestionIds.has('w_1')).toBe(false);
  });

  it('resolvePending removes from pending AND from previewing', () => {
    useSuggestionsUi.getState().markPending(['w_1', 'w_2']);
    useSuggestionsUi.getState().setPreview('w_1', true);
    useSuggestionsUi.getState().setPreview('w_2', true);
    useSuggestionsUi.getState().resolvePending('w_1');
    const s = useSuggestionsUi.getState();
    expect(s.pendingSuggestionIds.has('w_1')).toBe(false);
    expect(s.previewingSuggestionIds.has('w_1')).toBe(false);
    expect(s.pendingSuggestionIds.has('w_2')).toBe(true);
    expect(s.previewingSuggestionIds.has('w_2')).toBe(true);
  });

  it('setPreview on=true adds; on=false removes', () => {
    useSuggestionsUi.getState().setPreview('w_1', true);
    expect(useSuggestionsUi.getState().previewingSuggestionIds.has('w_1')).toBe(true);
    useSuggestionsUi.getState().setPreview('w_1', false);
    expect(useSuggestionsUi.getState().previewingSuggestionIds.has('w_1')).toBe(false);
  });

  it('recordSuggestionDecision appends an entry; newest first', () => {
    useSuggestionsUi.getState().recordSuggestionDecision({
      id: 'w_1', intent: 'Warm up shadows', decision: 'allowed', decidedAt: 100,
    });
    useSuggestionsUi.getState().recordSuggestionDecision({
      id: 'w_2', intent: 'Cool highlights', decision: 'denied', decidedAt: 200,
    });
    const hist = useSuggestionsUi.getState().suggestionHistory;
    expect(hist).toHaveLength(2);
    expect(hist[0]).toMatchObject({ id: 'w_2', decision: 'denied' });
    expect(hist[1]).toMatchObject({ id: 'w_1', decision: 'allowed' });
  });

  it('recordSuggestionDecision is capped at 50 entries (oldest drops off)', () => {
    for (let i = 0; i < 55; i++) {
      useSuggestionsUi.getState().recordSuggestionDecision({
        id: `w_${i}`, intent: `s ${i}`, decision: 'allowed', decidedAt: i,
      });
    }
    const hist = useSuggestionsUi.getState().suggestionHistory;
    expect(hist).toHaveLength(50);
    // Newest is last-added (i=54); oldest kept is i=5.
    expect(hist[0].id).toBe('w_54');
    expect(hist[hist.length - 1].id).toBe('w_5');
  });

  it('reset clears all three sets', () => {
    useSuggestionsUi.getState().addAcceptedSuggestion('w_a');
    useSuggestionsUi.getState().markPending(['w_p']);
    useSuggestionsUi.getState().setPreview('w_pv', true);
    useSuggestionsUi.getState().recordSuggestionDecision({
      id: 'w_h', intent: 'historical', decision: 'allowed', decidedAt: 1,
    });
    useSuggestionsUi.getState().reset();
    const s = useSuggestionsUi.getState();
    expect(s.acceptedSuggestions.size).toBe(0);
    expect(s.pendingSuggestionIds.size).toBe(0);
    expect(s.previewingSuggestionIds.size).toBe(0);
    expect(s.suggestionHistory).toHaveLength(0);
  });
});
