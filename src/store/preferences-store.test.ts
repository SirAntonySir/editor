import { describe, it, expect } from 'vitest';
import { usePreferencesStore } from '@/store/preferences-store';

describe('preferences-store · useWorkspaceCanvas', () => {
  it('defaults to false and setter flips it', () => {
    usePreferencesStore.setState({ useWorkspaceCanvas: false });
    expect(usePreferencesStore.getState().useWorkspaceCanvas).toBe(false);
    usePreferencesStore.getState().setUseWorkspaceCanvas(true);
    expect(usePreferencesStore.getState().useWorkspaceCanvas).toBe(true);
  });
});
