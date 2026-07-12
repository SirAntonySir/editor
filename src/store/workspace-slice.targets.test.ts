import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';
import type { Widget, WidgetNode } from '@/types/widget';

const edges = () => Object.values(useEditorStore.getState().tetherEdges);

function widget(id: string, node: Partial<WidgetNode>): Widget {
  return {
    id,
    status: 'active',
    nodes: [{ id: `n_${id}`, type: 'basic', params: {}, scope: { kind: 'global' },
      inputs: [], widgetId: id, ...node }],
  } as unknown as Widget;
}

describe('widget target actions', () => {
  beforeEach(() => { useEditorStore.getState().resetWorkspace(); });

  it('addWidgetTarget creates one edge per (widget, layer)', () => {
    useEditorStore.getState().addWidgetTarget('w1', 'img_a', 'L1');
    useEditorStore.getState().addWidgetTarget('w1', 'img_b', 'L2');
    expect(edges().map((e) => e.layerId).sort()).toEqual(['L1', 'L2']);
    expect(edges().every((e) => e.widgetNodeId === 'w1')).toBe(true);
    expect(useEditorStore.getState().tetherEdges['te-w1-L1']).toBeDefined();
  });

  it('addWidgetTarget is idempotent per (widget, layer)', () => {
    useEditorStore.getState().addWidgetTarget('w1', 'img_a', 'L1');
    useEditorStore.getState().addWidgetTarget('w1', 'img_a', 'L1');
    expect(edges()).toHaveLength(1);
  });

  it('retargetWidget swaps layer + node on an existing edge', () => {
    useEditorStore.getState().addWidgetTarget('w1', 'img_a', 'L1');
    useEditorStore.getState().retargetWidget('te-w1-L1', 'img_b', 'L2');
    expect(edges()).toHaveLength(1);
    expect(edges()[0]).toMatchObject({ id: 'te-w1-L2', targetImageNodeId: 'img_b', layerId: 'L2' });
  });

  it('removeWidgetTarget deletes only that edge', () => {
    useEditorStore.getState().addWidgetTarget('w1', 'img_a', 'L1');
    useEditorStore.getState().addWidgetTarget('w1', 'img_b', 'L2');
    useEditorStore.getState().removeWidgetTarget('te-w1-L1');
    expect(edges().map((e) => e.layerId)).toEqual(['L2']);
  });
});

describe('syncWidgetTethers', () => {
  beforeEach(() => { useEditorStore.getState().resetWorkspace(); });

  it('rebuilds edges from active widgets, resolving each layer to its node', () => {
    const store = useEditorStore.getState();
    const nodeA = store.addImageNode(['L1', 'L2'], { x: 0, y: 0 });
    const nodeB = store.addImageNode(['L3'], { x: 500, y: 0 });

    store.syncWidgetTethers([
      widget('w1', { layerId: 'L1', layerIds: ['L1', 'L3'] }), // replicate across nodes
      widget('w2', { layerId: 'L2', layerIds: null }),          // implicit single target
    ]);

    const te = useEditorStore.getState().tetherEdges;
    expect(te['te-w1-L1']).toMatchObject({ targetImageNodeId: nodeA, layerId: 'L1' });
    expect(te['te-w1-L3']).toMatchObject({ targetImageNodeId: nodeB, layerId: 'L3' });
    expect(te['te-w2-L2']).toMatchObject({ targetImageNodeId: nodeA, layerId: 'L2' });
    expect(Object.keys(te)).toHaveLength(3);
  });

  it('tethers a genfill widget (no op-graph nodes) via genfill.imageNodeId', () => {
    const store = useEditorStore.getState();
    const nodeA = store.addImageNode(['L1', 'L2'], { x: 0, y: 0 });

    // Real genfill widgets carry an empty `nodes` array; the tether must come
    // from `genfill.imageNodeId` → that node's first layer, and must survive
    // this full rebuild rather than being wiped.
    const genfillWidget = {
      id: 'gf1',
      status: 'active',
      nodes: [],
      genfill: { status: 'compose', prompt: '', seed: 1, maskId: 'm1', imageNodeId: nodeA },
    } as unknown as Widget;

    store.syncWidgetTethers([genfillWidget]);

    const te = useEditorStore.getState().tetherEdges;
    expect(te['te-gf1-L1']).toMatchObject({
      targetImageNodeId: nodeA, layerId: 'L1', widgetNodeId: 'gf1',
    });
    expect(Object.keys(te)).toHaveLength(1);
  });

  it('drops targets that no longer resolve and inactive widgets', () => {
    const store = useEditorStore.getState();
    store.addImageNode(['L1'], { x: 0, y: 0 });
    store.syncWidgetTethers([
      widget('w1', { layerId: 'L1', layerIds: ['L1', 'GONE'] }),
      { ...widget('w2', { layerId: 'L1' }), status: 'dismissed' } as unknown as Widget,
    ]);
    const te = useEditorStore.getState().tetherEdges;
    expect(Object.keys(te)).toEqual(['te-w1-L1']);
  });

  it('sweeps orphaned fused-slice nodes whose parent widget is no longer active', () => {
    const store = useEditorStore.getState();

    // The `widget()` helper generates node id as `n_${widgetId}`. The satellite
    // must reference that same nodeId so the detach guard leaves it intact.
    const activeSlice  = store.addFusedSliceNode('w-active',    'n_w-active', { x: 10, y: 10 });
    const orphanSlice  = store.addFusedSliceNode('w-dismissed', 'n_w-dismissed', { x: 20, y: 20 });

    expect(useEditorStore.getState().fusedSliceNodes[activeSlice]).toBeDefined();
    expect(useEditorStore.getState().fusedSliceNodes[orphanSlice]).toBeDefined();

    // Sync against a snapshot where only w-active is still active.
    store.syncWidgetTethers([widget('w-active', { layerId: 'L1' })]);

    const after = useEditorStore.getState();
    // Active parent with matching nodeId → satellite survives.
    expect(after.fusedSliceNodes[activeSlice]).toBeDefined();
    // Dismissed parent → satellite swept.
    expect(after.fusedSliceNodes[orphanSlice]).toBeUndefined();
  });
});
