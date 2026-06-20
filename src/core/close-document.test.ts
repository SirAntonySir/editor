// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { editorDocument } from './document';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';

describe('editorDocument.closeDocument', () => {
  beforeEach(() => {
    // Wire the facade to the editor store (App.tsx does this on mount; tests
    // mount no React tree so we do it manually).
    editorDocument.init(useEditorStore);
    // Seed a populated session as if a user had opened an image and the
    // backend had hydrated. Tests run against this baseline.
    useEditorStore.setState({
      layers: [{ id: 'L1', type: 'image', name: 'a.jpg', visible: true, opacity: 1, blendMode: 'normal', locked: false, order: 0 }],
      activeLayerId: 'L1',
      documentMeta: { id: 'doc', name: 'a', createdAt: 0, modifiedAt: 0, width: 100, height: 100 },
      isDirty: true,
    } as never);
    useEditorStore.getState().addImageNode(['L1'], { x: 10, y: 20 });
    useBackendState.getState().setSessionId('test-session-abc');
    useBackendState.getState().setSnapshot({
      sessionId: 'test-session-abc',
      revision: 5,
      widgets: [], masksIndex: [], imageContext: { lighting: 'flat' } as never,
      operationGraph: { id: 'g', userGoal: '', nodes: [], panelBindings: [], metadata: {} },
    } as never);
  });

  it('clears layers, workspace, backend session, and snapshot in one call', () => {
    editorDocument.closeDocument();

    const editor = useEditorStore.getState();
    expect(editor.layers).toEqual([]);
    expect(editor.activeLayerId).toBeNull();
    expect(editor.documentMeta).toBeNull();
    expect(Object.keys(editor.imageNodes)).toHaveLength(0);
    expect(editor.activeImageNodeId).toBeNull();

    const backend = useBackendState.getState();
    expect(backend.sessionId).toBeNull();
    expect(backend.snapshot).toBeNull();
  });

  it('removes the persisted session id from localStorage so a fresh upload starts clean', () => {
    expect(localStorage.getItem('editor.backend.sessionId')).toBe('test-session-abc');
    editorDocument.closeDocument();
    expect(localStorage.getItem('editor.backend.sessionId')).toBeNull();
  });
});
