import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { selectObjectTool } from './select-object';

beforeEach(() => {
  maskStore.clear();
  useEditorStore.getState().resetWorkspace();
  useEditorStore.setState({ activeObjectId: null } as unknown as Parameters<typeof useEditorStore.setState>[0]);
});

describe('select_object handler', () => {
  it('sets activeObjectId when the mask exists', () => {
    const maskId = maskStore.register({
      layerId: 'L1',
      width: 10, height: 10,
      data: new Uint8Array(100), source: 'sam-point', createdAt: 0,
    });

    const result = selectObjectTool.handler({ maskId });

    expect(result.ok).toBe(true);
    expect(useEditorStore.getState().activeObjectId).toBe(maskId);
  });

  it('returns ok: false when mask does not exist', () => {
    const result = selectObjectTool.handler({ maskId: 'nonexistent-id' });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no object with id/i);
    expect(useEditorStore.getState().activeObjectId).toBeNull();
  });

  it('includes list_objects hint in the error message', () => {
    const result = selectObjectTool.handler({ maskId: 'bad-id' });
    expect(result.message).toMatch(/list_objects/);
  });
});
