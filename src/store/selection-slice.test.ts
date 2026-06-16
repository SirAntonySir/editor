import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from './index';
import { GLOBAL_SCOPE } from '@/types/scope';

describe('selection-slice', () => {
  beforeEach(() => {
    useEditorStore.getState().clearSelection();
  });

  it('default activeScope is global', () => {
    expect(useEditorStore.getState().activeScope).toEqual(GLOBAL_SCOPE);
  });

  it('setActiveScope updates activeScope', () => {
    useEditorStore.getState().setActiveScope({ kind: 'mask', mask_id: 'm1' });
    expect(useEditorStore.getState().activeScope).toEqual({ kind: 'mask', mask_id: 'm1' });
  });

  it('focusWidget sets focusedWidgetId', () => {
    useEditorStore.getState().focusWidget('w1');
    expect(useEditorStore.getState().focusedWidgetId).toBe('w1');
  });

  it('clickAt with empty candidates clears selection to global', () => {
    useEditorStore.getState().setActiveScope({ kind: 'mask', mask_id: 'm1' });
    useEditorStore.getState().clickAt(10, 10, []);
    expect(useEditorStore.getState().activeScope).toEqual(GLOBAL_SCOPE);
  });

  it('setHoveredScope updates hoveredScope', () => {
    useEditorStore.getState().setHoveredScope({ kind: 'mask', mask_id: 'm1' });
    expect(useEditorStore.getState().hoveredScope).toEqual({ kind: 'mask', mask_id: 'm1' });
    useEditorStore.getState().setHoveredScope(null);
    expect(useEditorStore.getState().hoveredScope).toBeNull();
  });

  it('clearSelection resets everything', () => {
    useEditorStore.getState().setActiveScope({ kind: 'mask', mask_id: 'm1' });
    useEditorStore.getState().focusWidget('w1');
    useEditorStore.getState().setHoveredScope({ kind: 'mask:proposed', label: 'sky' });
    useEditorStore.getState().clearSelection();
    expect(useEditorStore.getState().activeScope).toEqual(GLOBAL_SCOPE);
    expect(useEditorStore.getState().focusedWidgetId).toBeNull();
    expect(useEditorStore.getState().hoveredScope).toBeNull();
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
