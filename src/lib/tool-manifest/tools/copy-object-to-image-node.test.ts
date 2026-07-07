import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { objectOwnership } from '@/lib/segmentation/object-ownership';

vi.mock('@/lib/segmentation/object-actions', () => ({
  copyObjectToImageNode: vi.fn(),
  selectInvertedObject: vi.fn(),
  renameObject: vi.fn(),
  deleteObject: vi.fn(),
  startObjectRename: vi.fn(),
}));

const { copyObjectToImageNodeTool } = await import('./copy-object-to-image-node');
const { copyObjectToImageNode } = await import('@/lib/segmentation/object-actions');

beforeEach(() => {
  maskStore.clear();
  objectOwnership._resetForTests();
  useEditorStore.getState().resetWorkspace();
  useEditorStore.setState({ activeImageNodeId: null } as unknown as Parameters<typeof useEditorStore.setState>[0]);
  vi.clearAllMocks();
});

describe('copy_object_to_image_node handler', () => {
  it('calls copyObjectToImageNode with the mask id and resolved image node', () => {
    const maskId = maskStore.register({
      layerId: 'L1',
      width: 10, height: 10,
      data: new Uint8Array(100), source: 'sam-point', createdAt: 0,
    });
    objectOwnership.set(maskId, 'node-A');
    (copyObjectToImageNode as ReturnType<typeof vi.fn>).mockReturnValue({
      imageNodeId: 'in-3', layerId: 'layer-uuid',
    });

    const result = copyObjectToImageNodeTool.handler({ maskId });

    expect(result).toMatchObject({ ok: true, image_node_id: 'in-3', layer_ids: ['layer-uuid'] });
    expect(copyObjectToImageNode).toHaveBeenCalledWith(maskId, 'node-A');
  });

  it('uses explicit imageNodeId when provided', () => {
    const maskId = maskStore.register({
      layerId: 'L1',
      width: 10, height: 10,
      data: new Uint8Array(100), source: 'sam-point', createdAt: 0,
    });
    // Ownership points to node-A, but explicit arg overrides.
    objectOwnership.set(maskId, 'node-A');
    (copyObjectToImageNode as ReturnType<typeof vi.fn>).mockReturnValue({
      imageNodeId: 'in-9', layerId: 'l9',
    });

    const result = copyObjectToImageNodeTool.handler({ maskId, imageNodeId: 'node-B' });

    expect(result.ok).toBe(true);
    expect(copyObjectToImageNode).toHaveBeenCalledWith(maskId, 'node-B');
  });

  it('returns ok: false when the extract is a no-op (null)', () => {
    const maskId = maskStore.register({
      layerId: 'L1',
      width: 10, height: 10,
      data: new Uint8Array(100), source: 'sam-point', createdAt: 0,
    });
    objectOwnership.set(maskId, 'node-A');
    (copyObjectToImageNode as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const result = copyObjectToImageNodeTool.handler({ maskId });
    expect(result.ok).toBe(false);
  });

  it('returns ok: false when mask does not exist', () => {
    const result = copyObjectToImageNodeTool.handler({ maskId: 'missing' });
    expect(result.ok).toBe(false);
    expect(copyObjectToImageNode).not.toHaveBeenCalled();
  });

  it('returns ok: false when no image node can be resolved', () => {
    const maskId = maskStore.register({
      layerId: 'L1',
      width: 10, height: 10,
      data: new Uint8Array(100), source: 'sam-point', createdAt: 0,
    });
    // No ownership, no active node.

    const result = copyObjectToImageNodeTool.handler({ maskId });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/could not resolve/i);
  });
});
