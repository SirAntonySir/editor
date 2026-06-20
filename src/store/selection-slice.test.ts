import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from './index';

describe('selection-slice', () => {
  beforeEach(() => {
    useEditorStore.getState().clearSelection();
  });

  it('focusWidget sets focusedWidgetId', () => {
    useEditorStore.getState().focusWidget('w1');
    expect(useEditorStore.getState().focusedWidgetId).toBe('w1');
  });

  it('clickAt with empty candidates clears selection', () => {
    useEditorStore.getState().setActiveObjectId('m1');
    useEditorStore.getState().clickAt(10, 10, []);
    expect(useEditorStore.getState().activeObjectId).toBeNull();
  });

  it('clearSelection resets everything', () => {
    useEditorStore.getState().setActiveObjectId('m1');
    useEditorStore.getState().focusWidget('w1');
    useEditorStore.getState().setHoveredObjectId('m2');
    useEditorStore.getState().clearSelection();
    expect(useEditorStore.getState().activeObjectId).toBeNull();
    expect(useEditorStore.getState().focusedWidgetId).toBeNull();
    expect(useEditorStore.getState().hoveredObjectId).toBeNull();
  });
});

describe('selection-slice — activeObjectId', () => {
  beforeEach(() => {
    useEditorStore.getState().clearSelection();
  });

  it('starts null (whole image)', () => {
    expect(useEditorStore.getState().activeObjectId).toBeNull();
  });

  it('setActiveObjectId stores the maskRef', () => {
    useEditorStore.getState().setActiveObjectId('mask-42');
    expect(useEditorStore.getState().activeObjectId).toBe('mask-42');
  });

  it('setActiveObjectId(null) clears', () => {
    useEditorStore.getState().setActiveObjectId('mask-42');
    useEditorStore.getState().setActiveObjectId(null);
    expect(useEditorStore.getState().activeObjectId).toBeNull();
  });

  it('hoveredObjectId tracks separately from active', () => {
    useEditorStore.getState().setHoveredObjectId('mask-7');
    expect(useEditorStore.getState().hoveredObjectId).toBe('mask-7');
    expect(useEditorStore.getState().activeObjectId).toBeNull();
  });
});
