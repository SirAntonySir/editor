import { describe, it, expect, vi, beforeEach } from 'vitest';

// duplicateLayer's pixel/IDB side effects are covered elsewhere; here we only
// assert duplicateLayerToNewImageNode's wiring, so stub it to a deterministic id.
const duplicateLayer = vi.fn();
vi.mock('@/store/segment-actions', () => ({
  duplicateLayer: (...a: unknown[]) => duplicateLayer(...a),
}));

const { useEditorStore } = await import('@/store');
const { duplicateLayerInPlace, duplicateLayerToNewImageNode } = await import('./layer-node-actions');

beforeEach(() => {
  duplicateLayer.mockReset();
  useEditorStore.setState({ imageNodes: {}, activeImageNodeId: null });
});

describe('duplicateLayerToNewImageNode', () => {
  it('duplicates the layer into a NEW node, leaving the source node intact', () => {
    const srcNode = useEditorStore.getState().addImageNode(['l-1', 'l-2']);
    duplicateLayer.mockReturnValue('l-1-copy');

    const newNodeId = duplicateLayerToNewImageNode('l-1', srcNode);

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

    expect(duplicateLayerToNewImageNode('l-1', srcNode)).toBeNull();
    expect(Object.keys(useEditorStore.getState().imageNodes).length).toBe(before);
  });

  it('returns null without duplicating when the source node does not exist', () => {
    expect(duplicateLayerToNewImageNode('l-1', 'in-nope')).toBeNull();
    expect(duplicateLayer).not.toHaveBeenCalled();
  });
});

describe('duplicateLayerInPlace', () => {
  it('inserts the duplicate as a sibling directly above the source, source kept', () => {
    const srcNode = useEditorStore.getState().addImageNode(['l-1', 'l-2']);
    duplicateLayer.mockReturnValue('l-1-copy');

    const newLayerId = duplicateLayerInPlace('l-1', srcNode);

    expect(newLayerId).toBe('l-1-copy');
    const nodes = useEditorStore.getState().imageNodes;
    // Duplicate lands right after the source layer in the same node.
    expect(nodes[srcNode].layerIds).toEqual(['l-1', 'l-1-copy', 'l-2']);
  });

  it('returns null without touching the node when duplicateLayer fails', () => {
    const srcNode = useEditorStore.getState().addImageNode(['l-1']);
    duplicateLayer.mockReturnValue(null);

    expect(duplicateLayerInPlace('l-1', srcNode)).toBeNull();
    expect(useEditorStore.getState().imageNodes[srcNode].layerIds).toEqual(['l-1']);
  });

  it('returns null without duplicating when the node does not exist', () => {
    expect(duplicateLayerInPlace('l-1', 'in-nope')).toBeNull();
    expect(duplicateLayer).not.toHaveBeenCalled();
  });
});
