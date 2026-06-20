import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { objectOwnership } from '@/lib/segmentation/object-ownership';

vi.mock('@/lib/segmentation/object-actions', () => ({
  extractObjectToImageNode: vi.fn(),
  convertObjectToLayerMask: vi.fn(),
  selectInvertedObject: vi.fn(),
  renameObject: vi.fn(),
  deleteObject: vi.fn(),
  startObjectRename: vi.fn(),
}));

const { convertObjectToLayerMaskTool } = await import('./convert-object-to-layer-mask');
const { convertObjectToLayerMask } = await import('@/lib/segmentation/object-actions');

beforeEach(() => {
  maskStore.clear();
  objectOwnership._resetForTests();
  useEditorStore.getState().resetWorkspace();
  useEditorStore.setState({ activeImageNodeId: null } as unknown as Parameters<typeof useEditorStore.setState>[0]);
  vi.clearAllMocks();
});

describe('convert_object_to_layer_mask handler', () => {
  it('calls convertObjectToLayerMask with the mask id and resolved image node', () => {
    const maskId = maskStore.register({
      layerId: 'L1',
      width: 10, height: 10,
      data: new Uint8Array(100), source: 'sam-point', createdAt: 0,
    });
    objectOwnership.set(maskId, 'node-A');

    const result = convertObjectToLayerMaskTool.handler({ maskId });

    expect(result.ok).toBe(true);
    expect(convertObjectToLayerMask).toHaveBeenCalledWith(maskId, 'node-A');
  });

  it('uses explicit imageNodeId when provided', () => {
    const maskId = maskStore.register({
      layerId: 'L1',
      width: 10, height: 10,
      data: new Uint8Array(100), source: 'sam-point', createdAt: 0,
    });
    objectOwnership.set(maskId, 'node-A');

    const result = convertObjectToLayerMaskTool.handler({ maskId, imageNodeId: 'node-B' });

    expect(result.ok).toBe(true);
    expect(convertObjectToLayerMask).toHaveBeenCalledWith(maskId, 'node-B');
  });

  it('returns ok: false when mask does not exist', () => {
    const result = convertObjectToLayerMaskTool.handler({ maskId: 'missing' });
    expect(result.ok).toBe(false);
    expect(convertObjectToLayerMask).not.toHaveBeenCalled();
  });
});
