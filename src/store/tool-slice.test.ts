import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';

describe('tool-slice · widget shell state', () => {
  beforeEach(() => {
    const s = useEditorStore.getState();
    s.collapseAllWidgets();
    s.setHoveredWidget(null);
    // Clear hidden ids between tests so order-independence holds.
    for (const id of Array.from(s.hiddenWidgetIds)) s.toggleWidgetHidden(id);
    for (const id of Array.from(s.hiddenCanonNodeIds)) s.toggleCanonNodeHidden(id);
  });

  it('toggleWidgetExpanded toggles a widget id in expandedWidgetIds', () => {
    const s = useEditorStore.getState();
    expect(s.expandedWidgetIds.has('w-1')).toBe(false);
    s.toggleWidgetExpanded('w-1');
    expect(useEditorStore.getState().expandedWidgetIds.has('w-1')).toBe(true);
    s.toggleWidgetExpanded('w-1');
    expect(useEditorStore.getState().expandedWidgetIds.has('w-1')).toBe(false);
  });

  it('multi-expand allowed (toggling one does not affect another)', () => {
    const s = useEditorStore.getState();
    s.toggleWidgetExpanded('w-1');
    s.toggleWidgetExpanded('w-2');
    const ids = useEditorStore.getState().expandedWidgetIds;
    expect(ids.has('w-1')).toBe(true);
    expect(ids.has('w-2')).toBe(true);
  });

  it('collapseAllWidgets empties the set', () => {
    const s = useEditorStore.getState();
    s.toggleWidgetExpanded('w-1');
    s.toggleWidgetExpanded('w-2');
    s.collapseAllWidgets();
    expect(useEditorStore.getState().expandedWidgetIds.size).toBe(0);
  });

  it('setHoveredWidget stores + clears the id', () => {
    const s = useEditorStore.getState();
    s.setHoveredWidget('w-1');
    expect(useEditorStore.getState().hoveredWidgetId).toBe('w-1');
    s.setHoveredWidget(null);
    expect(useEditorStore.getState().hoveredWidgetId).toBeNull();
  });

  it('toggleSectionExpanded adds then removes a section id', () => {
    const { toggleSectionExpanded } = useEditorStore.getState();
    toggleSectionExpanded('light');
    expect(useEditorStore.getState().expandedSectionIds.has('light')).toBe(true);
    toggleSectionExpanded('light');
    expect(useEditorStore.getState().expandedSectionIds.has('light')).toBe(false);
  });

  it('toggleWidgetHidden adds then removes a widget id in hiddenWidgetIds', () => {
    const s = useEditorStore.getState();
    expect(s.hiddenWidgetIds.has('w-1')).toBe(false);
    s.toggleWidgetHidden('w-1');
    expect(useEditorStore.getState().hiddenWidgetIds.has('w-1')).toBe(true);
    s.toggleWidgetHidden('w-1');
    expect(useEditorStore.getState().hiddenWidgetIds.has('w-1')).toBe(false);
  });

  it('toggleWidgetHidden is independent per id', () => {
    const s = useEditorStore.getState();
    s.toggleWidgetHidden('w-1');
    s.toggleWidgetHidden('w-2');
    const ids = useEditorStore.getState().hiddenWidgetIds;
    expect(ids.has('w-1')).toBe(true);
    expect(ids.has('w-2')).toBe(true);
  });

  it('toggleCanonNodeHidden adds then removes a canon id', () => {
    const s = useEditorStore.getState();
    expect(s.hiddenCanonNodeIds.has('canon:L1:basic')).toBe(false);
    s.toggleCanonNodeHidden('canon:L1:basic');
    expect(useEditorStore.getState().hiddenCanonNodeIds.has('canon:L1:basic')).toBe(true);
    s.toggleCanonNodeHidden('canon:L1:basic');
    expect(useEditorStore.getState().hiddenCanonNodeIds.has('canon:L1:basic')).toBe(false);
  });

  it('hiddenCanonNodeIds and hiddenWidgetIds are independent sets', () => {
    const s = useEditorStore.getState();
    s.toggleCanonNodeHidden('canon:L1:basic');
    s.toggleWidgetHidden('w-1');
    expect(useEditorStore.getState().hiddenCanonNodeIds.has('canon:L1:basic')).toBe(true);
    expect(useEditorStore.getState().hiddenWidgetIds.has('w-1')).toBe(true);
    expect(useEditorStore.getState().hiddenCanonNodeIds.has('w-1')).toBe(false);
    expect(useEditorStore.getState().hiddenWidgetIds.has('canon:L1:basic')).toBe(false);
  });
});
