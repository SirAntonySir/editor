import { describe, it, expect, beforeEach, vi } from 'vitest';

const calls: string[] = [];

vi.mock('@/lib/suggestions-actions', () => ({
  dismissAllPendingSuggestions: vi.fn(async () => {
    calls.push('dismiss');
  }),
}));

vi.mock('@/lib/palette-actions.agent', () => ({
  runAgentTurn: vi.fn(async () => {
    calls.push('turn');
    return { ok: true, toolCalls: 0 };
  }),
}));

vi.mock('@/hooks/useImageContext', () => ({
  // Context already present → submit skips the analyze precursor.
  useAiSession: { getState: () => ({ context: {} }) },
  analyseActiveImageLayer: vi.fn(),
}));

vi.mock('@/lib/prompt-doc', () => ({
  serializePromptDoc: () => ({ intent: 'make it pop', chipSourceIds: [] }),
}));

import { submitAgentPrompt } from './palette-submit';
import { dismissAllPendingSuggestions } from '@/lib/suggestions-actions';
import { runAgentTurn } from '@/lib/palette-actions.agent';
import { usePaletteRuntime } from '@/store/palette-runtime';

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  usePaletteRuntime.getState().finish();
});

describe('submitAgentPrompt', () => {
  it('dismisses pending suggestions before running the agent turn', async () => {
    await submitAgentPrompt({} as never, []);

    expect(dismissAllPendingSuggestions).toHaveBeenCalledTimes(1);
    expect(runAgentTurn).toHaveBeenCalledTimes(1);
    // A direct prompt clears the AI's suggestions first, then acts.
    expect(calls).toEqual(['dismiss', 'turn']);
  });
});
