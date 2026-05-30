import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as history from './history';
import { editorDocument } from './document';
import { useEditorStore } from '@/store';

interface FakeSnap { value: number }

describe('history (linear stack)', () => {
  beforeEach(() => history.clear());

  it('returns null undo when empty', () => {
    expect(history.undo()).toBeNull();
  });

  it('push then undo returns the prior snap', () => {
    history.initWith<FakeSnap>({ value: 1 });
    history.push<FakeSnap>({ value: 2 });
    expect(history.undo<FakeSnap>()).toEqual({ value: 1 });
  });

  it('undo then redo restores', () => {
    history.initWith<FakeSnap>({ value: 1 });
    history.push<FakeSnap>({ value: 2 });
    history.undo<FakeSnap>();
    expect(history.redo<FakeSnap>()).toEqual({ value: 2 });
  });

  it('push truncates redo tail', () => {
    history.initWith<FakeSnap>({ value: 1 });
    history.push<FakeSnap>({ value: 2 });
    history.push<FakeSnap>({ value: 3 });
    history.undo<FakeSnap>();
    history.undo<FakeSnap>();
    history.push<FakeSnap>({ value: 99 });
    expect(history.redo<FakeSnap>()).toBeNull();
  });

  it('caps stack at MAX_ENTRIES', () => {
    history.initWith<FakeSnap>({ value: 0 });
    for (let i = 1; i <= 25; i++) history.push<FakeSnap>({ value: i });
    let count = 0;
    while (history.undo<FakeSnap>() !== null) count++;
    expect(count).toBeLessThanOrEqual(20);
  });
});

// ─── Workspace undo/redo via editorDocument facade ───────────────────

describe('history — workspace ops via editorDocument', () => {
  beforeEach(() => {
    history.clear();
    useEditorStore.getState().resetWorkspace();
    editorDocument.init(useEditorStore);
    // Seed the history root with the current (empty workspace) state so the
    // first push has a predecessor to undo back to.
    history.initWith({
      layers: [],
      activeLayerId: null,
      pixelVersion: 0,
      imageNodes: {},
      widgetNodes: {},
      tetherEdges: {},
      activeImageNodeId: null,
    });
  });

  afterEach(() => {
    editorDocument.dispose();
  });

  it('split → undo restores the source node layerIds and removes the peeled node', () => {
    // Arrange: a single image node with three layers (no history entry — direct slice call).
    const srcId = useEditorStore.getState().addImageNode(['L1', 'L2', 'L3']);
    // Seed root snapshot after the arrange so undo lands on the pre-split state.
    const root = {
      layers: [],
      activeLayerId: null,
      pixelVersion: 0,
      imageNodes: structuredClone(useEditorStore.getState().imageNodes),
      widgetNodes: {},
      tetherEdges: {},
      activeImageNodeId: null,
    };
    history.clear();
    history.initWith(root);

    // Act: split through the facade (pushes a history entry).
    const newId = editorDocument.workspace.splitImageNode(srcId, 'L3');
    expect(newId).not.toBeNull();
    expect(useEditorStore.getState().imageNodes[srcId].layerIds).toEqual(['L1', 'L2']);
    expect(useEditorStore.getState().imageNodes[newId!].layerIds).toEqual(['L3']);

    // Undo
    editorDocument.undo();
    const after = useEditorStore.getState();
    expect(after.imageNodes[srcId].layerIds).toEqual(['L1', 'L2', 'L3']);
    expect(after.imageNodes[newId!]).toBeUndefined();
  });

  it('removeImageNode → undo restores the node and its edges', () => {
    // Arrange: an image node with a tether edge pointing at it.
    const srcId = useEditorStore.getState().addImageNode(['L1']);
    useEditorStore.getState().setWidgetPosition('w1', { x: 50, y: 50 });
    useEditorStore.getState().setEdge({
      id: 'te-1',
      widgetNodeId: 'w1',
      targetImageNodeId: srcId,
      scope: { kind: 'layer', layerId: 'L1' },
    });
    history.clear();
    history.initWith({
      layers: [],
      activeLayerId: null,
      pixelVersion: 0,
      imageNodes: structuredClone(useEditorStore.getState().imageNodes),
      widgetNodes: structuredClone(useEditorStore.getState().widgetNodes),
      tetherEdges: structuredClone(useEditorStore.getState().tetherEdges),
      activeImageNodeId: null,
    });

    // Act: remove via facade (cascades the edge).
    editorDocument.workspace.removeImageNode(srcId);
    expect(useEditorStore.getState().imageNodes[srcId]).toBeUndefined();
    expect(useEditorStore.getState().tetherEdges['te-1']).toBeUndefined();

    // Undo
    editorDocument.undo();
    const after = useEditorStore.getState();
    expect(after.imageNodes[srcId]).toBeDefined();
    expect(after.imageNodes[srcId].layerIds).toEqual(['L1']);
    expect(after.tetherEdges['te-1']).toBeDefined();
    expect(after.tetherEdges['te-1'].targetImageNodeId).toBe(srcId);
  });

  it('unbindEdge → undo restores the edge', () => {
    const srcId = useEditorStore.getState().addImageNode(['L1']);
    useEditorStore.getState().setEdge({
      id: 'te-1',
      widgetNodeId: 'w1',
      targetImageNodeId: srcId,
      scope: { kind: 'node' },
    });
    history.clear();
    history.initWith({
      layers: [],
      activeLayerId: null,
      pixelVersion: 0,
      imageNodes: structuredClone(useEditorStore.getState().imageNodes),
      widgetNodes: {},
      tetherEdges: structuredClone(useEditorStore.getState().tetherEdges),
      activeImageNodeId: null,
    });

    editorDocument.workspace.unbindEdge('te-1');
    expect(useEditorStore.getState().tetherEdges['te-1']).toBeUndefined();

    editorDocument.undo();
    expect(useEditorStore.getState().tetherEdges['te-1']).toBeDefined();
    expect(useEditorStore.getState().tetherEdges['te-1'].targetImageNodeId).toBe(srcId);
  });

  it('setNodePosition → undo restores the prior position', () => {
    const id = useEditorStore.getState().addImageNode(['L1'], { x: 10, y: 20 });
    history.clear();
    history.initWith({
      layers: [],
      activeLayerId: null,
      pixelVersion: 0,
      imageNodes: structuredClone(useEditorStore.getState().imageNodes),
      widgetNodes: {},
      tetherEdges: {},
      activeImageNodeId: null,
    });

    editorDocument.workspace.setNodePosition(id, { x: 500, y: 600 });
    expect(useEditorStore.getState().imageNodes[id].position).toEqual({ x: 500, y: 600 });

    editorDocument.undo();
    expect(useEditorStore.getState().imageNodes[id].position).toEqual({ x: 10, y: 20 });
  });

  it('setWidgetPosition → undo restores the prior position', () => {
    useEditorStore.getState().setWidgetPosition('w1', { x: 0, y: 0 });
    history.clear();
    history.initWith({
      layers: [],
      activeLayerId: null,
      pixelVersion: 0,
      imageNodes: {},
      widgetNodes: structuredClone(useEditorStore.getState().widgetNodes),
      tetherEdges: {},
      activeImageNodeId: null,
    });

    editorDocument.workspace.setWidgetPosition('w1', { x: 300, y: 400 });
    expect(useEditorStore.getState().widgetNodes['w1'].position).toEqual({ x: 300, y: 400 });

    editorDocument.undo();
    expect(useEditorStore.getState().widgetNodes['w1'].position).toEqual({ x: 0, y: 0 });
  });

  it('undo then redo round-trips the workspace mutation', () => {
    const id = useEditorStore.getState().addImageNode(['L1'], { x: 0, y: 0 });
    history.clear();
    history.initWith({
      layers: [],
      activeLayerId: null,
      pixelVersion: 0,
      imageNodes: structuredClone(useEditorStore.getState().imageNodes),
      widgetNodes: {},
      tetherEdges: {},
      activeImageNodeId: null,
    });

    editorDocument.workspace.setNodePosition(id, { x: 100, y: 100 });
    editorDocument.undo();
    expect(useEditorStore.getState().imageNodes[id].position).toEqual({ x: 0, y: 0 });
    editorDocument.redo();
    expect(useEditorStore.getState().imageNodes[id].position).toEqual({ x: 100, y: 100 });
  });

  it('recordSnapshot skips no-op mutations (drag-stop with zero displacement)', () => {
    const id = useEditorStore.getState().addImageNode(['L1'], { x: 42, y: 84 });
    history.clear();
    history.initWith({
      layers: [],
      activeLayerId: null,
      pixelVersion: 0,
      imageNodes: structuredClone(useEditorStore.getState().imageNodes),
      widgetNodes: {},
      tetherEdges: {},
      activeImageNodeId: null,
    });

    // Sanity: the seed snapshot is the only entry — nothing to undo back to.
    expect(history.historyStore.getState().canUndo).toBe(false);

    // Setting the position to the same value must NOT create a history entry.
    editorDocument.workspace.setNodePosition(id, { x: 42, y: 84 });
    expect(history.historyStore.getState().canUndo).toBe(false);

    // A real displacement DOES create one.
    editorDocument.workspace.setNodePosition(id, { x: 100, y: 200 });
    expect(history.historyStore.getState().canUndo).toBe(true);
  });

  it('SSE batched placement + user drag → undo restores SSE position, then removes the widget', () => {
    // Arrange: an image node exists (snapshot A). Seed root.
    const imageNodeId = useEditorStore.getState().addImageNode(['L1'], { x: 0, y: 0 });
    history.clear();
    history.initWith({
      layers: [],
      activeLayerId: null,
      pixelVersion: 0,
      imageNodes: structuredClone(useEditorStore.getState().imageNodes),
      widgetNodes: {},
      tetherEdges: {},
      activeImageNodeId: null,
    });

    // Simulate SSE-driven placement: batched position + edge → snapshot B.
    editorDocument.workspace.batch('Tether widget', () => {
      useEditorStore.getState().setWidgetPosition('w1', { x: 150, y: 50 });
      useEditorStore.getState().setEdge({
        id: 'te-w1',
        widgetNodeId: 'w1',
        targetImageNodeId: imageNodeId,
        scope: { kind: 'layer', layerId: 'L1' },
      });
    });
    expect(useEditorStore.getState().widgetNodes['w1'].position).toEqual({ x: 150, y: 50 });
    expect(useEditorStore.getState().tetherEdges['te-w1']).toBeDefined();

    // User drags the widget → snapshot C.
    editorDocument.workspace.setWidgetPosition('w1', { x: 400, y: 300 });
    expect(useEditorStore.getState().widgetNodes['w1'].position).toEqual({ x: 400, y: 300 });

    // Undo once: back to SSE position, edge still intact.
    editorDocument.undo();
    let s = useEditorStore.getState();
    expect(s.widgetNodes['w1'].position).toEqual({ x: 150, y: 50 });
    expect(s.tetherEdges['te-w1']).toBeDefined();

    // Undo again: SSE placement rolled back entirely → no widget, no edge.
    editorDocument.undo();
    s = useEditorStore.getState();
    expect(s.widgetNodes['w1']).toBeUndefined();
    expect(s.tetherEdges['te-w1']).toBeUndefined();
  });
});
