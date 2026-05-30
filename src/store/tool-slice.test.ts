import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';

describe('tool-slice · widget shell state', () => {
  beforeEach(() => {
    const s = useEditorStore.getState();
    s.collapseAllWidgets();
    s.setHoveredWidget(null);
    s.clearDragOverrides();
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

  it('setDragOverride stores per-widget position; clearDragOverrides resets', () => {
    const s = useEditorStore.getState();
    s.setDragOverride('w-1', { x: 600, y: 120 });
    expect(useEditorStore.getState().sessionDragOverrides.get('w-1')).toEqual({ x: 600, y: 120 });
    s.clearDragOverride('w-1');
    expect(useEditorStore.getState().sessionDragOverrides.has('w-1')).toBe(false);
    s.setDragOverride('w-2', { x: 0, y: 0 });
    s.clearDragOverrides();
    expect(useEditorStore.getState().sessionDragOverrides.size).toBe(0);
  });
});
