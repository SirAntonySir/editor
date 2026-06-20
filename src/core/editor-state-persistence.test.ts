import { describe, it, expect } from 'vitest';
import type { PersistedEditorState } from './editor-state-persistence';
import type { EditorState } from '@/store';

/**
 * Compile-time gate: every field on the persisted shape must be reachable
 * from EditorState. The shape used to silently exclude the workspace graph
 * (imageNodes / widgetNodes / tetherEdges / infoNodes / activeImageNodeId)
 * which led to multi-image-node sessions collapsing into a single node on
 * reload. This test catches a regression at type-check time without needing
 * to actually exercise the IDB / Zustand machinery.
 */
describe('PersistedEditorState shape', () => {
  it('carries every workspace-graph field needed to round-trip a multi-node session', () => {
    type RequiredKeys =
      | 'layers'
      | 'activeLayerId'
      | 'pixelVersion'
      | 'documentMeta'
      | 'imageNodes'
      | 'widgetNodes'
      | 'tetherEdges'
      | 'infoNodes'
      | 'activeImageNodeId'
      | 'imageNodeMode';

    // Assignability: every required key must be present on the persisted
    // shape. A missing key would make the assignment fail compilation.
    type _AssertHasKeys = PersistedEditorState extends Record<RequiredKeys, unknown>
      ? true
      : never;
    const ok: _AssertHasKeys = true;
    expect(ok).toBe(true);
  });

  it('every persisted key resolves to a field on EditorState', () => {
    // Assignability the other way: the persisted shape can not invent keys
    // that don't exist on the live store, otherwise the restore setState
    // would silently no-op them.
    type _AssertAllKeysExistOnEditorState = keyof PersistedEditorState extends keyof EditorState
      ? true
      : never;
    const ok: _AssertAllKeysExistOnEditorState = true;
    expect(ok).toBe(true);
  });
});
