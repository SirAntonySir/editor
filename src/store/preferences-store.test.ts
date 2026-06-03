import { describe, it, expect, beforeEach } from 'vitest';
import { usePreferencesStore } from './preferences-store';

beforeEach(() => {
  usePreferencesStore.setState({ rightSidebarCollapsed: true, inspectorTab: 'adjustments' });
});

it('showImageContext opens the sidebar and selects the Info tab', () => {
  usePreferencesStore.getState().showImageContext();
  const s = usePreferencesStore.getState();
  expect(s.rightSidebarCollapsed).toBe(false);
  expect(s.inspectorTab).toBe('info');
});

it('setInspectorTab updates the inspector tab', () => {
  usePreferencesStore.getState().setInspectorTab('info');
  expect(usePreferencesStore.getState().inspectorTab).toBe('info');
});

describe('showCrop', () => {
  beforeEach(() => {
    usePreferencesStore.setState({ rightSidebarCollapsed: true, inspectorTab: 'adjustments' });
  });

  it('opens the sidebar and selects the crop tab', () => {
    usePreferencesStore.getState().showCrop();
    expect(usePreferencesStore.getState().rightSidebarCollapsed).toBe(false);
    expect(usePreferencesStore.getState().inspectorTab).toBe('crop');
  });
});
