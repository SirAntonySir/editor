import { describe, it, expect, vi, beforeEach } from 'vitest';

// duplicateLayer's pixel/IDB side effects are covered elsewhere; here we only
// assert copyLayerToNewImageNode's wiring, so stub it to a deterministic id.
const duplicateLayer = vi.fn();
vi.mock('@/store/segment-actions', () => ({
  duplicateLayer: (...a: unknown[]) => duplicateLayer(...a),
}));

const { useEditorStore } = await import('@/store');
const { copyLayerToNewImageNode, moveLayerToNewImageNode } = await import('./layer-node-actions');

beforeEach(() => {
  duplicateLayer.mockReset();
  useEditorStore.setState({ imageNodes: {}, activeImageNodeId: null });
});

describe('copyLayerToNewImageNode', () => {
  it('duplicates the layer into a NEW node, leaving the source node intact', () => {
    const srcNode = useEditorStore.getState().addImageNode(['l-1', 'l-2']);
    duplicateLayer.mockReturnValue('l-1-copy');

    const newNodeId = copyLayerToNewImageNode('l-1', srcNode);

    expect(duplicateLayer).toHaveBeenCalledWith('l-1');
    expect(newNodeId).toBeTruthy();
    const nodes = useEditorStore.getState().imageNodes;
    // Source node unchanged (non-destructive copy).
    expect(nodes[srcNode].layerIds).toEqual(['l-1', 'l-2']);
    // New node holds only the duplicated layer.
    expect(nodes[newNodeId!].layerIds).toEqual(['l-1-copy']);
    // Selection moves to the new node.
    expect(useEditorStore.getState().activeImageNodeId).toBe(newNodeId);
  });

  it('returns null (no node created) when duplicateLayer fails', () => {
    const srcNode = useEditorStore.getState().addImageNode(['l-1']);
    const before = Object.keys(useEditorStore.getState().imageNodes).length;
    duplicateLayer.mockReturnValue(null);

    expect(copyLayerToNewImageNode('l-1', srcNode)).toBeNull();
    expect(Object.keys(useEditorStore.getState().imageNodes).length).toBe(before);
  });

  it('returns null without duplicating when the source node does not exist', () => {
    expect(copyLayerToNewImageNode('l-1', 'in-nope')).toBeNull();
    expect(duplicateLayer).not.toHaveBeenCalled();
  });
});

describe('moveLayerToNewImageNode', () => {
  it('detaches the layer out of the source node into a new one', () => {
    const srcNode = useEditorStore.getState().addImageNode(['l-1', 'l-2']);

    const newNodeId = moveLayerToNewImageNode('l-1', srcNode);

    const nodes = useEditorStore.getState().imageNodes;
    expect(newNodeId).toBeTruthy();
    // Source node lost the moved layer.
    expect(nodes[srcNode].layerIds).toEqual(['l-2']);
    // New node holds the moved layer.
    expect(nodes[newNodeId!].layerIds).toEqual(['l-1']);
    expect(useEditorStore.getState().activeImageNodeId).toBe(newNodeId);
  });

  it('returns null when the layer is not on the source node', () => {
    const srcNode = useEditorStore.getState().addImageNode(['l-1']);
    expect(moveLayerToNewImageNode('l-missing', srcNode)).toBeNull();
  });
});
