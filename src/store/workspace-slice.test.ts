import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';

describe('workspace-slice', () => {
  beforeEach(() => {
    const s = useEditorStore.getState();
    s.resetWorkspace();
  });

  it('addImageNode returns a new id and stores the layerIds + position', () => {
    const s = useEditorStore.getState();
    const id = s.addImageNode(['l-1'], { x: 100, y: 50 });
    const node = useEditorStore.getState().imageNodes[id];
    expect(node.layerIds).toEqual(['l-1']);
    expect(node.position).toEqual({ x: 100, y: 50 });
    expect(node.size).toEqual({ w: 240, h: 180 });
  });

  it('addImageNode persists a caller-provided size', () => {
    const s = useEditorStore.getState();
    const id = s.addImageNode(['l-1'], { x: 0, y: 0 }, { w: 4000, h: 3000 });
    const node = useEditorStore.getState().imageNodes[id];
    expect(node.size).toEqual({ w: 4000, h: 3000 });
  });

  it('splitImageNode peels one layer onto a new node and source survives minus that layer', () => {
    const s = useEditorStore.getState();
    const a = s.addImageNode(['L1', 'L2']);
    const newId = s.splitImageNode(a, 'L1');
    expect(newId).not.toBeNull();
    const after = useEditorStore.getState();
    expect(after.imageNodes[a].layerIds).toEqual(['L2']);
    expect(after.imageNodes[newId!].layerIds).toEqual(['L1']);
    expect(newId).not.toBe(a);
  });

  it('splitImageNode inherits the source node size', () => {
    const s = useEditorStore.getState();
    const a = s.addImageNode(['L1', 'L2'], { x: 0, y: 0 }, { w: 4000, h: 3000 });
    const newId = s.splitImageNode(a, 'L1');
    const after = useEditorStore.getState();
    expect(after.imageNodes[newId!].size).toEqual({ w: 4000, h: 3000 });
    // New node sits to the right of the source by source-width + gap.
    expect(after.imageNodes[newId!].position.x).toBe(4000 + 24);
  });

  it('splitImageNode returns null when the source does not exist', () => {
    const s = useEditorStore.getState();
    expect(s.splitImageNode('does-not-exist', 'L1')).toBeNull();
  });

  it('splitImageNode returns null when the layer is not on the source', () => {
    const s = useEditorStore.getState();
    const a = s.addImageNode(['L1']);
    expect(s.splitImageNode(a, 'L-other')).toBeNull();
  });

  it('splitImageNode migrates layer-scoped edges to the new node', () => {
    const s = useEditorStore.getState();
    const a = s.addImageNode(['L1', 'L2']);
    s.setEdge({
      id: 'te-test-1',
      widgetNodeId: 'w1',
      targetImageNodeId: a,
      scope: { kind: 'layer', layerId: 'L1' },
    });
    s.setEdge({
      id: 'te-test-2',
      widgetNodeId: 'w2',
      targetImageNodeId: a,
      scope: { kind: 'layer', layerId: 'L2' },
    });
    s.setEdge({
      id: 'te-test-3',
      widgetNodeId: 'w3',
      targetImageNodeId: a,
      scope: { kind: 'node' },
    });
    const newId = s.splitImageNode(a, 'L1');
    expect(newId).not.toBeNull();
    const after = useEditorStore.getState();
    expect(after.tetherEdges['te-test-1'].targetImageNodeId).toBe(newId);
    expect(after.tetherEdges['te-test-2'].targetImageNodeId).toBe(a);
    expect(after.tetherEdges['te-test-3'].targetImageNodeId).toBe(a);
    expect(after.imageNodes[a].layerIds).toEqual(['L2']);
    expect(after.imageNodes[newId!].layerIds).toEqual(['L1']);
  });

  it('mergeImageNodes appends source layers to target, removes source, target keeps id', () => {
    const s = useEditorStore.getState();
    const a = s.addImageNode(['l-1']);
    const b = s.addImageNode(['l-2']);
    s.mergeImageNodes(a, b);
    const after = useEditorStore.getState();
    expect(after.imageNodes[a]).toBeUndefined();
    expect(after.imageNodes[b].layerIds).toEqual(['l-2', 'l-1']);
  });

  it('mergeImageNodes redirects all edges from source to target and preserves target id', () => {
    const s = useEditorStore.getState();
    const a = s.addImageNode(['L1']);
    const b = s.addImageNode(['L2']);
    s.setEdge({
      id: 'te-a',
      widgetNodeId: 'w1',
      targetImageNodeId: a,
      scope: { kind: 'node' },
    });
    s.setEdge({
      id: 'te-b',
      widgetNodeId: 'w2',
      targetImageNodeId: b,
      scope: { kind: 'layer', layerId: 'L2' },
    });
    s.mergeImageNodes(a, b);
    const after = useEditorStore.getState();
    expect(after.imageNodes[a]).toBeUndefined();
    expect(after.imageNodes[b]).toBeDefined();
    expect(after.imageNodes[b].layerIds).toEqual(['L2', 'L1']);
    expect(after.tetherEdges['te-a'].targetImageNodeId).toBe(b);
    expect(after.tetherEdges['te-a'].scope).toEqual({ kind: 'node' });
    expect(after.tetherEdges['te-b'].targetImageNodeId).toBe(b);
    expect(after.tetherEdges['te-b'].scope).toEqual({ kind: 'layer', layerId: 'L2' });
  });

  it('removeImageNode removes the node', () => {
    const s = useEditorStore.getState();
    const a = s.addImageNode(['L1']);
    s.removeImageNode(a);
    expect(useEditorStore.getState().imageNodes[a]).toBeUndefined();
  });

  it('removeImageNode cascades to tether edges targeting the removed node, leaves others', () => {
    const s = useEditorStore.getState();
    const a = s.addImageNode(['L1']);
    const b = s.addImageNode(['L2']);
    s.setEdge({
      id: 'te-on-a',
      widgetNodeId: 'w1',
      targetImageNodeId: a,
      scope: { kind: 'node' },
    });
    s.setEdge({
      id: 'te-on-b',
      widgetNodeId: 'w2',
      targetImageNodeId: b,
      scope: { kind: 'node' },
    });
    s.removeImageNode(a);
    const after = useEditorStore.getState();
    expect(after.tetherEdges['te-on-a']).toBeUndefined();
    expect(after.tetherEdges['te-on-b']).toBeDefined();
    expect(after.tetherEdges['te-on-b'].targetImageNodeId).toBe(b);
  });

  it('removeImageNode clears activeImageNodeId if it matched', () => {
    const s = useEditorStore.getState();
    const a = s.addImageNode(['L1']);
    s.setActiveImageNode(a);
    expect(useEditorStore.getState().activeImageNodeId).toBe(a);
    s.removeImageNode(a);
    expect(useEditorStore.getState().activeImageNodeId).toBeNull();
  });

  it('removeImageNode does not clear activeImageNodeId when it was a different node', () => {
    const s = useEditorStore.getState();
    const a = s.addImageNode(['L1']);
    const b = s.addImageNode(['L2']);
    s.setActiveImageNode(b);
    s.removeImageNode(a);
    expect(useEditorStore.getState().activeImageNodeId).toBe(b);
  });

  it('setEdge inserts an edge by caller-supplied id', () => {
    const s = useEditorStore.getState();
    const img = s.addImageNode(['l-1']);
    s.setEdge({
      id: 'te-keep',
      widgetNodeId: 'w-1',
      targetImageNodeId: img,
      scope: { kind: 'layer', layerId: 'l-1' },
    });
    const after = useEditorStore.getState();
    expect(after.tetherEdges['te-keep'].widgetNodeId).toBe('w-1');
    expect(after.tetherEdges['te-keep'].scope).toEqual({ kind: 'layer', layerId: 'l-1' });
  });

  it('setEdge replaces an existing edge by id', () => {
    const s = useEditorStore.getState();
    const img = s.addImageNode(['l-1']);
    s.setEdge({
      id: 'te-keep',
      widgetNodeId: 'w-1',
      targetImageNodeId: img,
      scope: { kind: 'layer', layerId: 'l-1' },
    });
    s.setEdge({
      id: 'te-keep',
      widgetNodeId: 'w-2',
      targetImageNodeId: img,
      scope: { kind: 'node' },
    });
    const after = useEditorStore.getState();
    expect(after.tetherEdges['te-keep'].widgetNodeId).toBe('w-2');
    expect(after.tetherEdges['te-keep'].scope).toEqual({ kind: 'node' });
  });

  it('unbindEdge removes an edge by id', () => {
    const s = useEditorStore.getState();
    const img = s.addImageNode(['l-1']);
    s.setEdge({
      id: 'te-keep',
      widgetNodeId: 'w-1',
      targetImageNodeId: img,
      scope: { kind: 'node' },
    });
    s.unbindEdge('te-keep');
    expect(useEditorStore.getState().tetherEdges['te-keep']).toBeUndefined();
  });

  it('setWidgetPosition stores a WidgetNodeState keyed by id', () => {
    const s = useEditorStore.getState();
    s.setWidgetPosition('w-1', { x: 10, y: 20 });
    const node = useEditorStore.getState().widgetNodes['w-1'];
    expect(node).toEqual({ id: 'w-1', position: { x: 10, y: 20 } });
    s.setWidgetPosition('w-1', { x: 30, y: 40 });
    expect(useEditorStore.getState().widgetNodes['w-1']?.position).toEqual({ x: 30, y: 40 });
  });

  it('setActiveImageNode mirrors the active image node id', () => {
    const s = useEditorStore.getState();
    const img = s.addImageNode(['l-1']);
    s.setActiveImageNode(img);
    expect(useEditorStore.getState().activeImageNodeId).toBe(img);
    s.setActiveImageNode(null);
    expect(useEditorStore.getState().activeImageNodeId).toBeNull();
  });
});
