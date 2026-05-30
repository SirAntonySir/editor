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

  it('splitImageNode (1 layer) returns the same id; (N layers) returns N new ids', () => {
    const s = useEditorStore.getState();
    const id1 = s.addImageNode(['l-1']);
    expect(s.splitImageNode(id1)).toEqual([id1]);
    const idN = s.addImageNode(['l-2', 'l-3']);
    const out = s.splitImageNode(idN);
    expect(out).toHaveLength(2);
    expect(out).not.toContain(idN);
    expect(useEditorStore.getState().imageNodes[idN]).toBeUndefined();
  });

  it('mergeImageNodes combines layerIds and removes the originals', () => {
    const s = useEditorStore.getState();
    const a = s.addImageNode(['l-1']);
    const b = s.addImageNode(['l-2']);
    const merged = s.mergeImageNodes([a, b]);
    expect(useEditorStore.getState().imageNodes[merged].layerIds).toEqual(['l-1', 'l-2']);
    expect(useEditorStore.getState().imageNodes[a]).toBeUndefined();
    expect(useEditorStore.getState().imageNodes[b]).toBeUndefined();
  });

  it('setEdge + unbindEdge round-trip', () => {
    const s = useEditorStore.getState();
    const img = s.addImageNode(['l-1']);
    s.setEdge('w-1', img, { kind: 'layer', layerId: 'l-1' });
    const edge = Object.values(useEditorStore.getState().tetherEdges)[0];
    expect(edge.widgetNodeId).toBe('w-1');
    expect(edge.targetImageNodeId).toBe(img);
    expect(edge.scope.kind).toBe('layer');
    s.unbindEdge(edge.id);
    expect(useEditorStore.getState().tetherEdges[edge.id]).toBeUndefined();
  });

  it('toggleWorkspaceExpanded toggles widget expansion id', () => {
    const s = useEditorStore.getState();
    s.toggleWorkspaceExpanded('w-1');
    expect(useEditorStore.getState().workspaceExpandedWidgetIds.has('w-1')).toBe(true);
    s.toggleWorkspaceExpanded('w-1');
    expect(useEditorStore.getState().workspaceExpandedWidgetIds.has('w-1')).toBe(false);
  });

  it('activeImageNodeId updates when a single image node is selected', () => {
    const s = useEditorStore.getState();
    const img = s.addImageNode(['l-1']);
    s.setSelection([img], []);
    expect(useEditorStore.getState().activeImageNodeId).toBe(img);
    s.setSelection([], []);
    expect(useEditorStore.getState().activeImageNodeId).toBeNull();
  });
});
