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

  it('startToolBind sets pendingBind', () => {
    useEditorStore.getState().startToolBind('curves');
    expect(useEditorStore.getState().pendingBind).toEqual({ kind: 'tool', toolName: 'curves' });
  });

  it('startSuggestionBind sets pendingBind', () => {
    useEditorStore.getState().startSuggestionBind('w_s1');
    expect(useEditorStore.getState().pendingBind).toEqual({ kind: 'suggestion', widgetId: 'w_s1' });
  });

  it('cancelBind clears pendingBind', () => {
    useEditorStore.getState().startToolBind('curves');
    useEditorStore.getState().cancelBind();
    expect(useEditorStore.getState().pendingBind).toBeNull();
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
    useEditorStore.getState().startToolBind('curves');
    useEditorStore.getState().setHoveredScope({ kind: 'mask:proposed', label: 'sky' });
    useEditorStore.getState().clearSelection();
    expect(useEditorStore.getState().activeScope).toEqual(GLOBAL_SCOPE);
    expect(useEditorStore.getState().focusedWidgetId).toBeNull();
    expect(useEditorStore.getState().pendingBind).toBeNull();
    expect(useEditorStore.getState().hoveredScope).toBeNull();
  });
});
