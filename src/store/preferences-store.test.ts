import { describe, it, expect, beforeEach } from 'vitest';
import { usePreferencesStore, migratePreferences } from './preferences-store';

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

describe('migratePreferences', () => {
  it('drops visualStyle from old persisted state', () => {
    const before = { themeMode: 'dark', visualStyle: 'classic' };
    const after = migratePreferences(before, 0);
    expect('visualStyle' in (after as object)).toBe(false);
    expect((after as { themeMode: string }).themeMode).toBe('dark');
  });

  it('is a no-op when visualStyle is absent and accent already matches a current colour', () => {
    // Pick an accent that isn't the migration trigger (#0071e3) so this
    // case still exercises the unchanged-passthrough branch.
    const before = { themeMode: 'light', accentColor: '#ef4444' };
    const after = migratePreferences(before, 1);
    expect(after).toEqual({ themeMode: 'light', accentColor: '#ef4444' });
  });

  it('lifts the v1 default Blue accent to LMU Green on v1 → v2', () => {
    // Anyone whose persisted state holds the old default rides forward to
    // the new brand colour. An explicit non-default choice (handled in the
    // case above) is preserved.
    const before = { themeMode: 'system', accentColor: '#0071e3' };
    const after = migratePreferences(before, 1);
    expect(after).toEqual({ themeMode: 'system', accentColor: '#00883a' });
  });

  it('does not touch the accent when the persisted state is already v2+', () => {
    // Re-running the migrator over v2 state must be idempotent — the
    // accent stays whatever the user has it on, even if it happens to be
    // the old default (they explicitly chose it post-migration).
    const before = { themeMode: 'system', accentColor: '#0071e3' };
    const after = migratePreferences(before, 2);
    expect(after).toEqual({ themeMode: 'system', accentColor: '#0071e3' });
  });

  it('handles null/non-object state safely', () => {
    expect(migratePreferences(null, 0)).toBeNull();
    expect(migratePreferences('bad', 0)).toBe('bad');
  });
});
