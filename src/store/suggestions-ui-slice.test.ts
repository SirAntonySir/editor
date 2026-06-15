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

  it('reset clears all three sets', () => {
    useSuggestionsUi.getState().addAcceptedSuggestion('w_a');
    useSuggestionsUi.getState().markPending(['w_p']);
    useSuggestionsUi.getState().setPreview('w_pv', true);
    useSuggestionsUi.getState().reset();
    const s = useSuggestionsUi.getState();
    expect(s.acceptedSuggestions.size).toBe(0);
    expect(s.pendingSuggestionIds.size).toBe(0);
    expect(s.previewingSuggestionIds.size).toBe(0);
  });
});
