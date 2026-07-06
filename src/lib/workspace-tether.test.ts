import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  tetherWorkspaceWidget,
  tetherWorkspaceWidgetOnEngage,
} from '@/lib/workspace-tether';
import { useEditorStore } from '@/store';
import type { Widget } from '@/types/widget';

function makeWidget(id: string, overrides: Partial<Widget> = {}): Widget {
  return {
    id,
    intent: `intent-${id}`,
    scope: { kind: 'global' },
    origin: { kind: 'mcp_autonomous' },
    composed: false,
    nodes: [],
    bindings: [],
    preview: { kind: 'thumbnail', auto_before_after: true },
    rejected_attempts: [],
    status: 'active',
    revision: 1,
    createdAt: '2026-05-30T00:00:00Z',
    updatedAt: '2026-05-30T00:00:00Z',
    ...overrides,
  };
}

describe('tetherWorkspaceWidgetOnEngage', () => {
  beforeEach(() => {
    useEditorStore.getState().resetWorkspace();
  });

  it('no active image node → no edge created', () => {
    // No image nodes added; no activeImageNodeId.
    const w = makeWidget('w_ai', {
      origin: { kind: 'mcp_autonomous' },
      nodes: [{ id: 'n1', type: 'light', params: {}, scope: { kind: 'global' }, inputs: [], widgetId: 'w_ai', layerId: 'layer-missing' }],
    });
    tetherWorkspaceWidgetOnEngage(w);

    const editor = useEditorStore.getState();
    expect(editor.widgetNodes[w.id]).toBeUndefined();
    expect(Object.values(editor.tetherEdges)).toEqual([]);
  });

  it('AI-origin widget + active node → edge + position written', () => {
    const nodeId = useEditorStore.getState().addImageNode(['layer-a'], { x: 100, y: 50 });
    useEditorStore.getState().setActiveImageNode(nodeId);

    const w = makeWidget('w_ai', {
      origin: { kind: 'mcp_autonomous' },
      nodes: [{ id: 'n1', type: 'light', params: {}, scope: { kind: 'global' }, inputs: [], widgetId: 'w_ai', layerId: 'layer-a' }],
    });
    tetherWorkspaceWidgetOnEngage(w);

    const editor = useEditorStore.getState();
    expect(editor.widgetNodes[w.id]?.position).toBeDefined();
    const edges = Object.values(editor.tetherEdges);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      id: `te-${w.id}-layer-a`,
      widgetNodeId: w.id,
      targetImageNodeId: nodeId,
      layerId: 'layer-a',
      scope: { kind: 'layer', layerId: 'layer-a' },
    });
  });

  it('mcp_user_prompt widget + active node → edge + position written', () => {
    const nodeId = useEditorStore.getState().addImageNode(['layer-a'], { x: 0, y: 0 });
    useEditorStore.getState().setActiveImageNode(nodeId);

    const w = makeWidget('w_prompt', {
      origin: { kind: 'mcp_user_prompt', prompt: 'warmer' },
      nodes: [{ id: 'n1', type: 'kelvin', params: {}, scope: { kind: 'global' }, inputs: [], widgetId: 'w_prompt', layerId: 'layer-a' }],
    });
    tetherWorkspaceWidgetOnEngage(w);

    const editor = useEditorStore.getState();
    expect(editor.widgetNodes[w.id]?.position).toBeDefined();
    expect(Object.values(editor.tetherEdges)).toHaveLength(1);
  });

  it('falls back to activeImageNodeId when widget node layer_id does not match any image node', () => {
    const nodeId = useEditorStore.getState().addImageNode(['layer-a'], { x: 0, y: 0 });
    useEditorStore.getState().setActiveImageNode(nodeId);

    const w = makeWidget('w_ai', {
      origin: { kind: 'mcp_autonomous' },
      nodes: [{ id: 'n1', type: 'light', params: {}, scope: { kind: 'global' }, inputs: [], widgetId: 'w_ai', layerId: 'layer-unknown' }],
    });
    tetherWorkspaceWidgetOnEngage(w);

    const editor = useEditorStore.getState();
    const edges = Object.values(editor.tetherEdges);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      widgetNodeId: w.id,
      targetImageNodeId: nodeId,
      // Scope still carries the widget's layer_id even if the image node
      // doesn't own that layer — caller intent is preserved.
      scope: { kind: 'layer', layerId: 'layer-unknown' },
    });
  });
});

describe('tetherWorkspaceWidget — origin filter (regression)', () => {
  beforeEach(() => {
    useEditorStore.getState().resetWorkspace();
  });

  it('rejects autonomous AI widgets (only tool_invoked + mcp_user_prompt pass through)', () => {
    const nodeId = useEditorStore.getState().addImageNode(['layer-a'], { x: 0, y: 0 });
    useEditorStore.getState().setActiveImageNode(nodeId);

    const w = makeWidget('w_ai', {
      origin: { kind: 'mcp_autonomous' },
      nodes: [{ id: 'n1', type: 'light', params: {}, scope: { kind: 'global' }, inputs: [], widgetId: 'w_ai', layerId: 'layer-a' }],
    });
    tetherWorkspaceWidget(w);

    const editor = useEditorStore.getState();
    expect(editor.widgetNodes[w.id]).toBeUndefined();
    expect(Object.values(editor.tetherEdges)).toEqual([]);
  });

  it('tethers mcp_user_prompt widgets (Cmd+K palette)', () => {
    const nodeId = useEditorStore.getState().addImageNode(['layer-a'], { x: 0, y: 0 });
    useEditorStore.getState().setActiveImageNode(nodeId);

    const w = makeWidget('w_prompt', {
      origin: { kind: 'mcp_user_prompt', prompt: 'warmer' },
      nodes: [{ id: 'n1', type: 'kelvin', params: {}, scope: { kind: 'global' }, inputs: [], widgetId: 'w_prompt', layerId: 'layer-a' }],
    });
    tetherWorkspaceWidget(w);

    const editor = useEditorStore.getState();
    expect(editor.widgetNodes[w.id]?.position).toBeDefined();
    expect(Object.values(editor.tetherEdges)).toHaveLength(1);
  });

  it('genfill widget spawns at the viewport center + tethers to source', () => {
    // Image node placed FAR from the viewport so a beside-image placement would
    // land nowhere near center — proving the genfill widget re-centers.
    const nodeId = useEditorStore.getState().addImageNode(['layer-a'], { x: 5000, y: 5000 });
    useEditorStore.getState().setActiveImageNode(nodeId);

    const w = makeWidget('w_gf', {
      origin: { kind: 'tool_invoked' },
      nodes: [{ id: 'n1', type: 'genfill', params: {}, scope: { kind: 'global' }, inputs: [], widgetId: 'w_gf', layerId: 'layer-a' }],
      genfill: { status: 'compose', prompt: '', seed: 1, maskId: 'm1', imageNodeId: nodeId },
    } as never);
    tetherWorkspaceWidget(w, { pan: { x: 0, y: 0 }, zoom: 1, screen: { w: 1000, h: 800 } });

    const editor = useEditorStore.getState();
    // Flow-space screen center (500, 400) minus half the 226×220 spawn footprint.
    expect(editor.widgetNodes[w.id]?.position).toEqual({ x: 500 - 113, y: 400 - 110 });
    const edges = Object.values(editor.tetherEdges);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ layerId: 'layer-a', targetImageNodeId: nodeId });
  });
});
