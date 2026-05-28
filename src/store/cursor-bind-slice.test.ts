import { describe, it, expect, beforeEach } from 'vitest';
import { useCursorBindStore } from './cursor-bind-slice';

beforeEach(() => useCursorBindStore.getState().cancel());

describe('cursor-bind slice', () => {
  it('starts idle', () => {
    expect(useCursorBindStore.getState().pending).toBeNull();
    expect(useCursorBindStore.getState().cursor).toBeNull();
  });

  it('startTool sets pending with tool kind + scope', () => {
    useCursorBindStore.getState().startTool('curves', { kind: 'global' });
    const p = useCursorBindStore.getState().pending;
    expect(p?.kind).toBe('tool');
    expect(p?.kind === 'tool' && p.toolName).toBe('curves');
    expect(p?.scope?.kind).toBe('global');
  });

  it('startSuggestion sets pending with suggestion kind', () => {
    useCursorBindStore.getState().startSuggestion('w_1', { kind: 'mask', mask_id: 'm1' });
    const p = useCursorBindStore.getState().pending;
    expect(p?.kind).toBe('suggestion');
    expect(p?.kind === 'suggestion' && p.widgetId).toBe('w_1');
  });

  it('updateCursor stores last cursor coords', () => {
    useCursorBindStore.getState().startTool('curves', null);
    useCursorBindStore.getState().updateCursor(120, 80);
    expect(useCursorBindStore.getState().cursor).toEqual({ x: 120, y: 80 });
  });

  it('cancel clears pending and cursor', () => {
    useCursorBindStore.getState().startTool('curves', { kind: 'global' });
    useCursorBindStore.getState().updateCursor(50, 50);
    useCursorBindStore.getState().cancel();
    expect(useCursorBindStore.getState().pending).toBeNull();
    expect(useCursorBindStore.getState().cursor).toBeNull();
  });
});
