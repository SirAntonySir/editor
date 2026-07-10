import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';
import { usePreferencesStore } from '@/store/preferences-store';
import { makeHslWidget, makeAiWidget } from '@/components/widget/__fixtures__/widgets';
import { showWidgetInSidebar, widgetHasSidebarSection } from './widget-show-in-sidebar';

describe('widgetHasSidebarSection', () => {
  it('is true for an op-backed widget', () => {
    // makeHslWidget with >1 band carries the registry op id 'hsl'.
    expect(widgetHasSidebarSection(makeHslWidget(['red', 'blue']))).toBe(true);
  });

  it('is false for a widget with no opId (preset / compound / genfill)', () => {
    expect(widgetHasSidebarSection(makeAiWidget())).toBe(false);
  });
});

describe('showWidgetInSidebar', () => {
  beforeEach(() => {
    usePreferencesStore.setState({ rightSidebarCollapsed: true, inspectorTab: 'info' });
    useEditorStore.getState().setActiveLayer(null);
    useEditorStore.getState().consumeSectionScroll();
  });

  it('opens Adjustments, scopes to the target layer, and scrolls to the op section', () => {
    showWidgetInSidebar(makeHslWidget(['red', 'blue'])); // opId 'hsl', target layer 'L1'

    const prefs = usePreferencesStore.getState();
    expect(prefs.rightSidebarCollapsed).toBe(false);
    expect(prefs.inspectorTab).toBe('adjustments');

    const editor = useEditorStore.getState();
    expect(editor.activeLayerId).toBe('L1');
    expect(editor.sectionScrollTarget).toBe('hsl');
    expect(editor.expandedSectionIds.has('hsl')).toBe(true);
  });

  it('is a no-op on the store when the widget has no opId', () => {
    showWidgetInSidebar(makeAiWidget());
    // Sidebar still opens (harmless), but no section scroll is queued.
    expect(useEditorStore.getState().sectionScrollTarget).toBeNull();
  });
});
