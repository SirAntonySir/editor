import { describe, it, expect } from 'vitest';
import { usePreferencesStore } from '@/store/preferences-store';

describe('preferences-store · useWorkspaceCanvas', () => {
  it('defaults to true and setter flips it', () => {
    usePreferencesStore.setState({ useWorkspaceCanvas: true });
    expect(usePreferencesStore.getState().useWorkspaceCanvas).toBe(true);
    usePreferencesStore.getState().setUseWorkspaceCanvas(false);
    expect(usePreferencesStore.getState().useWorkspaceCanvas).toBe(false);
  });
});
