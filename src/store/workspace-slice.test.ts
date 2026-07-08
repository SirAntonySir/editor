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
    // Default sourceSize = 240×180 → display width caps at 600, aspect 4:3 → 600×450.
    expect(node.sourceSize).toEqual({ w: 240, h: 180 });
    expect(node.size).toEqual({ w: 600, h: 450 });
  });

  it('addImageNode with a sourceImageNodeId defaults mirror preview ON for the extracted child', () => {
    const s = useEditorStore.getState();
    const srcId = s.addImageNode(['l-src'], { x: 0, y: 0 });
    const childId = useEditorStore.getState().addImageNode(['l-cut'], { x: 100, y: 0 }, undefined, srcId);
    expect(useEditorStore.getState().mirrorPreview[childId]).toBe(true);
    // A plain (non-extracted) node gets no entry — toggle stays off.
    expect(useEditorStore.getState().mirrorPreview[srcId]).toBeUndefined();
    // The edge toggle still turns it off.
    useEditorStore.getState().toggleMirrorPreview(childId);
    expect(useEditorStore.getState().mirrorPreview[childId]).toBe(false);
  });

  it('addImageNode persists a caller-provided sourceSize and derives display dims at the default canvas width', () => {
    const s = useEditorStore.getState();
    const id = s.addImageNode(['l-1'], { x: 0, y: 0 }, { w: 4000, h: 3000 });
    const node = useEditorStore.getState().imageNodes[id];
    expect(node.sourceSize).toEqual({ w: 4000, h: 3000 });
    // Display: fixed 600 wide × 600 / (4/3) = 450 tall.
    expect(node.size).toEqual({ w: 600, h: 450 });
  });

  it('setImageNodeDisplayWidth resizes the display box and keeps aspect locked to source', () => {
    const s = useEditorStore.getState();
    const id = s.addImageNode(['l-1'], { x: 0, y: 0 }, { w: 4000, h: 2000 });
    s.setImageNodeDisplayWidth(id, 800);
    const node = useEditorStore.getState().imageNodes[id];
    // Aspect 2:1 → 800 × 400.
    expect(node.size).toEqual({ w: 800, h: 400 });
    // Source remains untouched.
    expect(node.sourceSize).toEqual({ w: 4000, h: 2000 });
  });

  it('setImageNodeDisplayWidth clamps to min/max', () => {
    const s = useEditorStore.getState();
    const id = s.addImageNode(['l-1'], { x: 0, y: 0 }, { w: 4000, h: 3000 });
    s.setImageNodeDisplayWidth(id, 50);   // below MIN (120)
    expect(useEditorStore.getState().imageNodes[id].size.w).toBe(120);
    s.setImageNodeDisplayWidth(id, 10000); // above MAX (4000)
    expect(useEditorStore.getState().imageNodes[id].size.w).toBe(4000);
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

  it('splitImageNode inherits the source node size + sourceSize', () => {
    const s = useEditorStore.getState();
    const a = s.addImageNode(['L1', 'L2'], { x: 0, y: 0 }, { w: 4000, h: 3000 });
    const newId = s.splitImageNode(a, 'L1');
    const after = useEditorStore.getState();
    // Source: 4000×3000 → display 600×450 (default canvas width).
    expect(after.imageNodes[newId!].size).toEqual({ w: 600, h: 450 });
    expect(after.imageNodes[newId!].sourceSize).toEqual({ w: 4000, h: 3000 });
    // New node sits to the right of the source by display-width + gap.
    expect(after.imageNodes[newId!].position.x).toBe(600 + 24);
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

  describe('previousImageNodeId tracking', () => {
    it('starts null and updates when active switches to a different non-null id', () => {
      const s = useEditorStore.getState();
      const a = s.addImageNode(['l-1']);
      const b = s.addImageNode(['l-2']);
      expect(useEditorStore.getState().previousImageNodeId).toBeNull();
      s.setActiveImageNode(a);
      expect(useEditorStore.getState().previousImageNodeId).toBeNull();
      s.setActiveImageNode(b);
      expect(useEditorStore.getState().previousImageNodeId).toBe(a);
      expect(useEditorStore.getState().activeImageNodeId).toBe(b);
    });

    it('preserves previous when active is cleared to null', () => {
      const s = useEditorStore.getState();
      const a = s.addImageNode(['l-1']);
      const b = s.addImageNode(['l-2']);
      s.setActiveImageNode(a);
      s.setActiveImageNode(b);
      s.setActiveImageNode(null);
      expect(useEditorStore.getState().previousImageNodeId).toBe(a);
      expect(useEditorStore.getState().activeImageNodeId).toBeNull();
    });

    it('selecting the same node twice is a no-op for previous', () => {
      const s = useEditorStore.getState();
      const a = s.addImageNode(['l-1']);
      const b = s.addImageNode(['l-2']);
      s.setActiveImageNode(a);
      s.setActiveImageNode(b);
      s.setActiveImageNode(b);
      expect(useEditorStore.getState().previousImageNodeId).toBe(a);
    });

    it('A→B→A leaves previous=B (cycling)', () => {
      const s = useEditorStore.getState();
      const a = s.addImageNode(['l-1']);
      const b = s.addImageNode(['l-2']);
      s.setActiveImageNode(a);
      s.setActiveImageNode(b);
      s.setActiveImageNode(a);
      expect(useEditorStore.getState().previousImageNodeId).toBe(b);
      expect(useEditorStore.getState().activeImageNodeId).toBe(a);
    });

    it('removeImageNode clears previousImageNodeId if it matched', () => {
      const s = useEditorStore.getState();
      const a = s.addImageNode(['l-1']);
      const b = s.addImageNode(['l-2']);
      s.setActiveImageNode(a);
      s.setActiveImageNode(b);
      expect(useEditorStore.getState().previousImageNodeId).toBe(a);
      s.removeImageNode(a);
      expect(useEditorStore.getState().previousImageNodeId).toBeNull();
    });

    it('mergeImageNodes redirects active when the source was active (target survives)', () => {
      const s = useEditorStore.getState();
      const a = s.addImageNode(['l-1']);
      const b = s.addImageNode(['l-2']);
      s.setActiveImageNode(a);
      s.setActiveImageNode(b);
      // Merging b into a: source=b (active), target=a (previous).
      s.mergeImageNodes(b, a);
      const after = useEditorStore.getState();
      expect(after.imageNodes[b]).toBeUndefined();
      // Active redirects to the surviving target.
      expect(after.activeImageNodeId).toBe(a);
      // Previous was `a`, which still exists — so it stays.
      expect(after.previousImageNodeId).toBe(a);
    });

    it('mergeImageNodes clears previous when the source was the previous', () => {
      const s = useEditorStore.getState();
      const a = s.addImageNode(['l-1']);
      const b = s.addImageNode(['l-2']);
      const c = s.addImageNode(['l-3']);
      s.setActiveImageNode(a);
      s.setActiveImageNode(c);
      // active=c, previous=a. Merge a into b → a is the deleted source.
      s.mergeImageNodes(a, b);
      const after = useEditorStore.getState();
      expect(after.imageNodes[a]).toBeUndefined();
      expect(after.previousImageNodeId).toBeNull();
    });
  });

  describe('mirrorPreview', () => {
    beforeEach(() => useEditorStore.getState().resetWorkspace());

    it('toggleMirrorPreview flips the per-node flag', () => {
      const id = useEditorStore.getState().addImageNode(['l1']);
      expect(useEditorStore.getState().mirrorPreview[id]).toBeFalsy();
      useEditorStore.getState().toggleMirrorPreview(id);
      expect(useEditorStore.getState().mirrorPreview[id]).toBe(true);
      useEditorStore.getState().toggleMirrorPreview(id);
      expect(useEditorStore.getState().mirrorPreview[id]).toBe(false);
    });

    it('removeImageNode clears the node\'s mirror flag', () => {
      const id = useEditorStore.getState().addImageNode(['l1']);
      useEditorStore.getState().toggleMirrorPreview(id);
      useEditorStore.getState().removeImageNode(id);
      expect(useEditorStore.getState().mirrorPreview[id]).toBeUndefined();
    });
  });

  describe('imageNodeMode', () => {
    beforeEach(() => useEditorStore.getState().resetWorkspace());

    it('defaults to empty record', () => {
      expect(useEditorStore.getState().imageNodeMode).toEqual({});
    });

    it('setImageNodeMode persists the mode per node', () => {
      const id = useEditorStore.getState().addImageNode(['l1']);
      useEditorStore.getState().setImageNodeMode(id, 'layers');
      expect(useEditorStore.getState().imageNodeMode[id]).toBe('layers');
      useEditorStore.getState().setImageNodeMode(id, 'objects');
      expect(useEditorStore.getState().imageNodeMode[id]).toBe('objects');
    });

    it('resetWorkspace clears it', () => {
      const id = useEditorStore.getState().addImageNode(['l1']);
      useEditorStore.getState().setImageNodeMode(id, 'layers');
      useEditorStore.getState().resetWorkspace();
      expect(useEditorStore.getState().imageNodeMode).toEqual({});
    });

    it('removeImageNode drops the mode entry', () => {
      const id = useEditorStore.getState().addImageNode(['l1']);
      useEditorStore.getState().setImageNodeMode(id, 'layers');
      useEditorStore.getState().removeImageNode(id);
      expect(useEditorStore.getState().imageNodeMode[id]).toBeUndefined();
    });
  });

  describe('resyncNodeSeq (reload id-collision guard)', () => {
    // Repro for the reload bug: on reload, imageNodes are restored from IDB but
    // `_nextNodeSeq` is NOT persisted, so it resets to 1. The next addImageNode
    // (e.g. from Extract-to-Image-Node) then mints `in-1` again and OVERWRITES
    // the restored source node. resyncNodeSeq derives the counter from existing
    // node ids so new ids never collide with restored ones.
    it('keeps addImageNode from overwriting a restored node after a reset counter', () => {
      // Simulate a post-reload store: a restored node `in-1` with the counter
      // back at its reset default.
      useEditorStore.setState({
        imageNodes: {
          'in-1': {
            id: 'in-1',
            layerIds: ['source-layer'],
            position: { x: 0, y: 0 },
            sourceSize: { w: 788, h: 709 },
            size: { w: 600, h: 540 },
          },
        },
        _nextNodeSeq: 1,
      });

      useEditorStore.getState().resyncNodeSeq();
      const newId = useEditorStore.getState().addImageNode(['cutout-layer']);

      const after = useEditorStore.getState();
      expect(newId).not.toBe('in-1');
      // Source node survives untouched.
      expect(after.imageNodes['in-1']).toBeTruthy();
      expect(after.imageNodes['in-1'].layerIds).toEqual(['source-layer']);
      // New node is its own entry.
      expect(after.imageNodes[newId].layerIds).toEqual(['cutout-layer']);
    });

    it('also accounts for restored info- node ids (shared counter)', () => {
      useEditorStore.setState({
        imageNodes: {
          'in-2': { id: 'in-2', layerIds: ['l'], position: { x: 0, y: 0 }, sourceSize: { w: 10, h: 10 }, size: { w: 10, h: 10 } },
        },
        infoNodes: { 'info-5': { id: 'info-5' } as never },
        _nextNodeSeq: 1,
      });
      useEditorStore.getState().resyncNodeSeq();
      // Next id must clear the highest existing suffix (info-5).
      expect(useEditorStore.getState()._nextNodeSeq).toBe(6);
    });
  });

  describe('layers-node lifecycle', () => {
    it('addImageNode spawns a paired layers node left of the image node', () => {
      const s = useEditorStore.getState();
      const id = s.addImageNode(['l-1'], { x: 500, y: 200 });
      const ln = useEditorStore.getState().layerNodes[`layers-${id}`];
      expect(ln).toBeTruthy();
      expect(ln.imageNodeId).toBe(id);
      // Seeded to the left of, and top-aligned with, the image node.
      expect(ln.position.x).toBeLessThan(500);
      expect(ln.position.y).toBe(200);
    });

    it('removeImageNode drops its layers node', () => {
      const s = useEditorStore.getState();
      const id = s.addImageNode(['l-1']);
      expect(useEditorStore.getState().layerNodes[`layers-${id}`]).toBeTruthy();
      useEditorStore.getState().removeImageNode(id);
      expect(useEditorStore.getState().layerNodes[`layers-${id}`]).toBeUndefined();
    });

    it('splitImageNode gives the peeled node its own layers node', () => {
      const s = useEditorStore.getState();
      const a = s.addImageNode(['L1', 'L2']);
      const newId = useEditorStore.getState().splitImageNode(a, 'L1')!;
      const lns = useEditorStore.getState().layerNodes;
      expect(lns[`layers-${a}`]).toBeTruthy();
      expect(lns[`layers-${newId}`]).toBeTruthy();
      expect(lns[`layers-${newId}`].imageNodeId).toBe(newId);
    });

    it('mergeImageNodes removes only the merged-away node’s layers node', () => {
      const s = useEditorStore.getState();
      const a = s.addImageNode(['L1']);
      const b = s.addImageNode(['L2']);
      useEditorStore.getState().mergeImageNodes(b, a); // fold b into a
      const lns = useEditorStore.getState().layerNodes;
      expect(lns[`layers-${a}`]).toBeTruthy();
      expect(lns[`layers-${b}`]).toBeUndefined();
    });

    it('ensureLayerNode back-fills a missing node and is idempotent', () => {
      // Simulate a session restored before layers nodes existed.
      useEditorStore.setState({
        imageNodes: {
          'in-9': { id: 'in-9', layerIds: ['l'], position: { x: 0, y: 0 }, sourceSize: { w: 10, h: 10 }, size: { w: 10, h: 10 } },
        },
        layerNodes: {},
      } as never);
      const s = useEditorStore.getState();
      s.ensureLayerNode('in-9');
      const first = useEditorStore.getState().layerNodes['layers-in-9'];
      expect(first).toBeTruthy();
      // Second call is a no-op — must not replace the (possibly moved) node.
      useEditorStore.getState().setLayerNodePosition('layers-in-9', { x: 42, y: 7 });
      useEditorStore.getState().ensureLayerNode('in-9');
      expect(useEditorStore.getState().layerNodes['layers-in-9'].position).toEqual({ x: 42, y: 7 });
    });

    it('resetWorkspace clears layers nodes', () => {
      const s = useEditorStore.getState();
      s.addImageNode(['l-1']);
      expect(Object.keys(useEditorStore.getState().layerNodes).length).toBe(1);
      useEditorStore.getState().resetWorkspace();
      expect(useEditorStore.getState().layerNodes).toEqual({});
    });
  });

  describe('duplicateInfoNode', () => {
    it('clones content + title + size at an offset, deep-copying the payload', () => {
      const srcId = useEditorStore.getState().addInfoNode(
        { kind: 'stats', items: [{ id: 'i1', label: 'X', value: '1' }] },
        { position: { x: 100, y: 100 }, title: 'Stats', targetImageNodeId: 'in-1' },
      );
      const dupId = useEditorStore.getState().duplicateInfoNode(srcId)!;
      const src = useEditorStore.getState().infoNodes[srcId];
      const dup = useEditorStore.getState().infoNodes[dupId];
      expect(dup.title).toBe('Stats');
      expect(dup.targetImageNodeId).toBe('in-1');
      expect(dup.position).toEqual({ x: 124, y: 124 });
      // Deep clone — mutating the source content must not touch the copy.
      expect(dup.content).not.toBe(src.content);
    });

    it('retargetTo overrides the clone’s target image node', () => {
      const srcId = useEditorStore.getState().addInfoNode(
        { kind: 'stats', items: [] },
        { targetImageNodeId: 'in-1' },
      );
      const dupId = useEditorStore.getState().duplicateInfoNode(srcId, 'in-2')!;
      expect(useEditorStore.getState().infoNodes[dupId].targetImageNodeId).toBe('in-2');
    });

    it('returns null when the source info node is missing', () => {
      expect(useEditorStore.getState().duplicateInfoNode('nope')).toBeNull();
    });
  });
});
