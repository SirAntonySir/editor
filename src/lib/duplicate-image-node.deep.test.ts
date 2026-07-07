import { describe, it, expect, vi, beforeEach } from 'vitest';

// duplicateLayer's pixel/IDB side effects are covered elsewhere — stub it to a
// deterministic id so we can assert the deep-duplicate wiring (layer mapping,
// new node, name, backend carry).
const duplicateLayer = vi.fn();
vi.mock('@/store/segment-actions', () => ({
  duplicateLayer: (...a: unknown[]) => duplicateLayer(...a),
}));

const duplicate_layer_edits = vi.fn(async () => ({ ok: true }));
vi.mock('@/lib/backend-tools', () => ({
  backendTools: { duplicate_layer_edits: (...a: unknown[]) => duplicate_layer_edits(...a) },
}));

const { useEditorStore } = await import('@/store');
const { useBackendState } = await import('@/store/backend-state-slice');
const { duplicateImageNode } = await import('./duplicate-image-node');
const { duplicateSelection } = await import('./duplicate-selection');

let seq = 0;
beforeEach(() => {
  useEditorStore.getState().resetWorkspace();
  duplicateLayer.mockReset();
  duplicate_layer_edits.mockClear();
  seq = 0;
  // Each call returns a fresh id so multi-layer nodes map cleanly.
  duplicateLayer.mockImplementation((id: string) => `${id}-copy${++seq}`);
  useBackendState.setState({ sessionId: null, sseStatus: 'closed' } as never);
});

describe('duplicateImageNode (deep)', () => {
  it('duplicates every layer onto a new node beside the source, source intact', () => {
    const src = useEditorStore.getState().addImageNode(['a', 'b'], { x: 10, y: 20 });
    useEditorStore.getState().setImageNodeName(src, 'Sky');

    const dupId = duplicateImageNode(src)!;

    expect(duplicateLayer).toHaveBeenCalledTimes(2);
    const nodes = useEditorStore.getState().imageNodes;
    // Source unchanged.
    expect(nodes[src].layerIds).toEqual(['a', 'b']);
    // New node holds a copy of each layer.
    expect(nodes[dupId].layerIds).toEqual(['a-copy1', 'b-copy2']);
    // Named "<name> copy".
    expect(nodes[dupId].name).toBe('Sky copy');
    // Placed to the right of the source.
    expect(nodes[dupId].position.x).toBeGreaterThan(10);
  });

  it('carries adjustments/widgets via the backend clone when a session is open', () => {
    useBackendState.setState({ sessionId: 'sid', sseStatus: 'open' } as never);
    const src = useEditorStore.getState().addImageNode(['a']);

    duplicateImageNode(src);

    expect(duplicate_layer_edits).toHaveBeenCalledWith('sid', {
      mapping: [{ fromLayerId: 'a', toLayerId: 'a-copy1' }],
    });
  });

  it('skips the backend clone when offline (structural duplicate still lands)', () => {
    const src = useEditorStore.getState().addImageNode(['a']);
    const dupId = duplicateImageNode(src)!;
    expect(useEditorStore.getState().imageNodes[dupId].layerIds).toEqual(['a-copy1']);
    expect(duplicate_layer_edits).not.toHaveBeenCalled();
  });

  it('returns null when no layer could be duplicated', () => {
    const src = useEditorStore.getState().addImageNode(['a']);
    duplicateLayer.mockReturnValue(null);
    expect(duplicateImageNode(src)).toBeNull();
  });
});

describe('duplicateSelection (group)', () => {
  it('deep-duplicates each selected image node with a uniform offset', () => {
    const a = useEditorStore.getState().addImageNode(['la'], { x: 0, y: 0 });
    const b = useEditorStore.getState().addImageNode(['lb'], { x: 400, y: 0 });

    const newIds = duplicateSelection([a, b]);

    expect(newIds).toHaveLength(2);
    const nodes = useEditorStore.getState().imageNodes;
    // Both copies exist and preserve the +400 horizontal gap between them.
    const [dupA, dupB] = newIds;
    expect(nodes[dupB].position.x - nodes[dupA].position.x).toBe(400);
  });

  it('repoints a co-selected info node’s tether at the duplicated image node', () => {
    const img = useEditorStore.getState().addImageNode(['l']);
    const info = useEditorStore.getState().addInfoNode(
      { kind: 'stats', items: [] },
      { targetImageNodeId: img },
    );

    const newIds = duplicateSelection([img, info]);
    const nodes = useEditorStore.getState();
    const dupImg = newIds.find((id) => nodes.imageNodes[id]);
    const dupInfo = newIds.find((id) => nodes.infoNodes[id]);
    expect(nodes.infoNodes[dupInfo!].targetImageNodeId).toBe(dupImg);
  });
});
