import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { useBackendState, getPersistedSessionId } from './backend-state-slice';
import { useEditorStore } from '@/store';
import type { SessionStateSnapshot, StateEvent, Widget } from '@/types/widget';

function makeWidget(id: string, overrides: Partial<Widget> = {}): Widget {
  return {
    id,
    intent: `intent-${id}`,
    scope: { kind: 'global' },
    origin: { kind: 'mcp_user_prompt', prompt: 'x' },
    composed: false,
    nodes: [],
    bindings: [],
    preview: { kind: 'thumbnail', auto_before_after: true },
    rejected_attempts: [],
    status: 'active',
    revision: 1,
    created_at: '2026-05-23T00:00:00Z',
    updated_at: '2026-05-23T00:00:00Z',
    ...overrides,
  };
}

function baseSnapshot(): SessionStateSnapshot {
  return {
    session_id: 's1',
    image_context: null,
    widgets: [makeWidget('w_1')],
    masks_index: [],
    operation_graph: {
      id: 'projected-x',
      userGoal: 'w_1',
      reasoning: null,
      nodes: [],
      panelBindings: [],
      metadata: {},
    },
    revision: 1,
  };
}

beforeEach(() => useBackendState.getState().reset());

describe('BackendStateSlice', () => {
  it('reset clears snapshot, optimistic, and acceptedSuggestions', () => {
    useBackendState.setState({
      snapshot: baseSnapshot(),
      sessionId: 's1',
      acceptedSuggestions: new Set(['w_x']),
    });
    useBackendState.getState().reset();
    expect(useBackendState.getState().snapshot).toBeNull();
    expect(useBackendState.getState().sessionId).toBeNull();
    expect(useBackendState.getState().optimistic.size).toBe(0);
    expect(useBackendState.getState().acceptedSuggestions.size).toBe(0);
  });

  it('applyEvent widget.created appends a widget and bumps revision', () => {
    useBackendState.setState({ snapshot: baseSnapshot() });
    const ev: StateEvent = {
      revision: 2,
      kind: 'widget.created',
      payload: { widget: makeWidget('w_2') },
      emitted_at: '2026-05-23T00:00:01Z',
    };
    useBackendState.getState().applyEvent(ev);
    const snap = useBackendState.getState().snapshot!;
    expect(snap.widgets.map((w) => w.id)).toEqual(['w_1', 'w_2']);
    expect(snap.revision).toBe(2);
  });

  it('applyEvent widget.created swaps in the embedded operation_graph', () => {
    useBackendState.setState({ snapshot: baseSnapshot() });
    const ev: StateEvent = {
      revision: 2,
      kind: 'widget.created',
      payload: {
        widget: makeWidget('w_2'),
        operation_graph: {
          id: 'projected-y',
          nodes: [{ id: 'n_new', type: 'basic', layer_id: 'layer-1', params: { exposure: 40 } }],
        },
      },
      emitted_at: '2026-05-23T00:00:01Z',
    };
    useBackendState.getState().applyEvent(ev);
    const snap = useBackendState.getState().snapshot!;
    expect(snap.operation_graph.nodes.map((n) => n.id)).toEqual(['n_new']);
  });

  it('applyEvent widget.updated swaps in the embedded operation_graph', () => {
    useBackendState.setState({ snapshot: baseSnapshot() });
    useBackendState.getState().applyEvent({
      revision: 2,
      kind: 'widget.updated',
      payload: {
        widget: makeWidget('w_1', { revision: 2 }),
        operation_graph: {
          id: 'projected-z',
          nodes: [{ id: 'n_1', type: 'basic', layer_id: 'layer-1', params: { exposure: 90 } }],
        },
      },
      emitted_at: '2026-05-23T00:00:02Z',
    } as StateEvent);
    const snap = useBackendState.getState().snapshot!;
    expect(snap.operation_graph.nodes[0].params.exposure).toBe(90);
  });

  it('applyEvent widget.updated replaces in place', () => {
    useBackendState.setState({ snapshot: baseSnapshot() });
    const updated = makeWidget('w_1', { intent: 'changed', revision: 2 });
    useBackendState.getState().applyEvent({
      revision: 2, kind: 'widget.updated',
      payload: { widget: updated },
      emitted_at: '2026-05-23T00:00:01Z',
    });
    const snap = useBackendState.getState().snapshot!;
    expect(snap.widgets[0].intent).toBe('changed');
  });

  it('applyEvent widget.deleted flips status to dismissed', () => {
    useBackendState.setState({ snapshot: baseSnapshot() });
    useBackendState.getState().applyEvent({
      revision: 2, kind: 'widget.deleted',
      payload: { widget_id: 'w_1' },
      emitted_at: '2026-05-23T00:00:01Z',
    });
    const snap = useBackendState.getState().snapshot!;
    expect(snap.widgets[0].status).toBe('dismissed');
  });

  it('applyEvent drops optimistic patch when server revision is higher', () => {
    useBackendState.setState({ snapshot: baseSnapshot() });
    useBackendState.getState().applyOptimistic('w_1', {
      baseRevision: 1,
      bindings: [{ paramKey: 'temperature', value: 6500 }],
    });
    expect(useBackendState.getState().optimistic.size).toBe(1);
    useBackendState.getState().applyEvent({
      revision: 2, kind: 'widget.updated',
      payload: { widget: makeWidget('w_1', { revision: 2 }) },
      emitted_at: '2026-05-23T00:00:01Z',
    });
    expect(useBackendState.getState().optimistic.size).toBe(0);
  });

  it('applyEvent widget.accepted adds to acceptedSuggestions set', () => {
    useBackendState.setState({ snapshot: baseSnapshot() });
    useBackendState.getState().applyEvent({
      revision: 2, kind: 'widget.accepted',
      payload: { widget_id: 'w_1' },
      emitted_at: '2026-05-23T00:00:01Z',
    });
    expect(useBackendState.getState().acceptedSuggestions.has('w_1')).toBe(true);
  });

  it('applyEvent drops same-or-lower revision events defensively', () => {
    const snap = baseSnapshot();
    snap.revision = 5;
    useBackendState.setState({ snapshot: snap });
    useBackendState.getState().applyEvent({
      revision: 5, kind: 'widget.deleted',
      payload: { widget_id: 'w_1' },
      emitted_at: '2026-05-23T00:00:01Z',
    });
    expect(useBackendState.getState().snapshot!.widgets[0].status).toBe('active');
  });

  it('widget.accepted removes widget from snapshot (backend now owns adjustment materialization)', () => {
    const widget = makeWidget('w_x', { nodes: [{
      id: 'n1', type: 'kelvin', params: { temperature: 7000 },
      scope: { kind: 'global' }, inputs: [], widget_id: 'w_x',
    }] });
    useBackendState.setState({
      snapshot: { ...baseSnapshot(), widgets: [widget], revision: 1 },
    });

    useBackendState.getState().applyEvent({
      revision: 2, kind: 'widget.accepted',
      payload: { widget_id: 'w_x' },
      emitted_at: '2026-05-28T00:00:01Z',
    });

    // Widget is removed from snapshot.
    expect(useBackendState.getState().snapshot!.widgets.find(w => w.id === 'w_x')).toBeUndefined();
    // Widget ID is in acceptedSuggestions.
    expect(useBackendState.getState().acceptedSuggestions.has('w_x')).toBe(true);
  });
});

describe('BackendStateSlice — workspace tether on widget.created', () => {
  beforeEach(() => {
    useBackendState.getState().reset();
    useEditorStore.getState().resetWorkspace();
  });

  function fireCreated(widget: Widget, revision = 2): void {
    useBackendState.setState({ snapshot: baseSnapshot() });
    useBackendState.getState().applyEvent({
      revision,
      kind: 'widget.created',
      payload: { widget },
      emitted_at: '2026-05-30T00:00:01Z',
    });
  }

  it('tool_invoked widget gets positioned + tethered to the layer\'s ImageNode', () => {
    const nodeId = useEditorStore.getState().addImageNode(['layer-a'], { x: 100, y: 50 });
    useEditorStore.getState().setActiveImageNode(nodeId);

    const w = makeWidget('w_tool', {
      origin: { kind: 'tool_invoked' },
      nodes: [{ id: 'n1', type: 'light', params: {}, scope: { kind: 'global' }, inputs: [], widget_id: 'w_tool', layer_id: 'layer-a' }],
    });
    fireCreated(w);

    const editor = useEditorStore.getState();
    // Widget got a position
    expect(editor.widgetNodes[w.id]?.position).toBeDefined();
    // A tether edge exists with the expected scope + target
    const edges = Object.values(editor.tetherEdges);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      id: `te-${w.id}`,
      widgetNodeId: w.id,
      targetImageNodeId: nodeId,
      scope: { kind: 'layer', layerId: 'layer-a' },
    });
  });

  it('AI-origin widgets are not auto-tethered', () => {
    const nodeId = useEditorStore.getState().addImageNode(['layer-a'], { x: 0, y: 0 });
    useEditorStore.getState().setActiveImageNode(nodeId);

    const w = makeWidget('w_ai', {
      origin: { kind: 'mcp_autonomous' },
      nodes: [{ id: 'n1', type: 'light', params: {}, scope: { kind: 'global' }, inputs: [], widget_id: 'w_ai', layer_id: 'layer-a' }],
    });
    fireCreated(w);

    const editor = useEditorStore.getState();
    expect(editor.widgetNodes[w.id]).toBeUndefined();
    expect(Object.values(editor.tetherEdges)).toEqual([]);
  });

  it('falls back to activeImageNodeId when widget has no node layer_id', () => {
    const nodeId = useEditorStore.getState().addImageNode(['layer-a'], { x: 0, y: 0 });
    useEditorStore.getState().setActiveImageNode(nodeId);

    const w = makeWidget('w_tool', {
      origin: { kind: 'tool_invoked' },
      nodes: [],
    });
    fireCreated(w);

    const editor = useEditorStore.getState();
    const edges = Object.values(editor.tetherEdges);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      widgetNodeId: w.id,
      targetImageNodeId: nodeId,
      scope: { kind: 'node' },
    });
  });

  it('skips when no active image node is selectable', () => {
    // No image nodes, no activeImageNodeId.
    const w = makeWidget('w_tool', {
      origin: { kind: 'tool_invoked' },
      nodes: [{ id: 'n1', type: 'light', params: {}, scope: { kind: 'global' }, inputs: [], widget_id: 'w_tool', layer_id: 'layer-x' }],
    });
    fireCreated(w);
    const editor = useEditorStore.getState();
    expect(editor.widgetNodes[w.id]).toBeUndefined();
    expect(Object.values(editor.tetherEdges)).toEqual([]);
  });
});

describe('BackendStateSlice phase events', () => {
  beforeEach(() => useBackendState.getState().reset());

  const started = (phase: string, index: number, revision: number): StateEvent =>
    ({ revision, kind: 'phase.started', payload: { phase, index, total: 6 }, emitted_at: 'x' } as StateEvent);
  const completed = (phase: string, revision: number): StateEvent =>
    ({ revision, kind: 'phase.completed', payload: { phase, duration_ms: 1 }, emitted_at: 'x' } as StateEvent);

  it('phase.started(update, index=1) initializes the map with update active', () => {
    useBackendState.getState().applyEvent(started('update', 1, 1));
    const phases = useBackendState.getState().phases!;
    expect(phases.update.status).toBe('active');
    expect(phases.mechanical.status).toBe('pending');
    expect(useBackendState.getState().mcpAnalyzeComplete).toBe(false);
  });

  it('applies phase events with no snapshot present (regression: events were dropped)', () => {
    expect(useBackendState.getState().snapshot).toBeNull();
    useBackendState.getState().applyEvent(started('update', 1, 1));
    expect(useBackendState.getState().phases!.update.status).toBe('active');
  });

  it('concurrent phases each stay active until individually completed', () => {
    useBackendState.getState().applyEvent(started('update', 1, 1));
    useBackendState.getState().applyEvent(completed('update', 2));
    // mechanical, sam_embed, ai_context all start before any completes
    useBackendState.getState().applyEvent(started('mechanical', 2, 3));
    useBackendState.getState().applyEvent(started('sam_embed', 3, 4));
    useBackendState.getState().applyEvent(started('ai_context', 4, 5));
    let p = useBackendState.getState().phases!;
    expect(p.update.status).toBe('done');
    expect(p.mechanical.status).toBe('active');
    expect(p.sam_embed.status).toBe('active');
    expect(p.ai_context.status).toBe('active');
    // ai_context finishes first — only it flips to done
    useBackendState.getState().applyEvent(completed('ai_context', 6));
    p = useBackendState.getState().phases!;
    expect(p.ai_context.status).toBe('done');
    expect(p.mechanical.status).toBe('active');
    expect(p.sam_embed.status).toBe('active');
  });

  it('phase.progress records the mask_precompute sub-count', () => {
    useBackendState.getState().applyEvent(started('update', 1, 1));
    useBackendState.getState().applyEvent(started('mask_precompute', 5, 5));
    useBackendState.getState().applyEvent({
      revision: 6, kind: 'phase.progress',
      payload: { phase: 'mask_precompute', done: 3, total: 8 }, emitted_at: 'x',
    } as StateEvent);
    const p = useBackendState.getState().phases!.mask_precompute;
    expect(p.done).toBe(3);
    expect(p.total).toBe(8);
  });

  it('phase.completed(widget_mint) marks it done and sets mcpAnalyzeComplete', () => {
    useBackendState.getState().applyEvent(started('update', 1, 1));
    useBackendState.getState().applyEvent(completed('widget_mint', 12));
    expect(useBackendState.getState().phases!.widget_mint.status).toBe('done');
    expect(useBackendState.getState().mcpAnalyzeComplete).toBe(true);
  });

  it('a new run (phase.started index=1) clears stale completion state', () => {
    useBackendState.getState().applyEvent(started('update', 1, 1));
    useBackendState.getState().applyEvent(completed('widget_mint', 6));
    expect(useBackendState.getState().mcpAnalyzeComplete).toBe(true);
    // second analyze begins
    useBackendState.getState().applyEvent(started('update', 1, 7));
    expect(useBackendState.getState().mcpAnalyzeComplete).toBe(false);
    expect(useBackendState.getState().phases!.widget_mint.status).toBe('pending');
  });
});

describe('BackendStateSlice — session persistence', () => {
  // Provide a minimal localStorage mock in the node test environment.
  const store: Record<string, string> = {};
  const localStorageMock = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = val; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };

  beforeEach(() => {
    localStorageMock.clear();
    vi.stubGlobal('localStorage', localStorageMock);
    useBackendState.getState().reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('setSessionId persists to localStorage', () => {
    useBackendState.getState().setSessionId('sid_abc');
    expect(getPersistedSessionId()).toBe('sid_abc');
  });

  it('setSessionId(null) clears localStorage', () => {
    useBackendState.getState().setSessionId('sid_abc');
    useBackendState.getState().setSessionId(null);
    expect(getPersistedSessionId()).toBeNull();
  });

  it('reset() clears localStorage', () => {
    useBackendState.getState().setSessionId('sid_abc');
    useBackendState.getState().reset();
    expect(getPersistedSessionId()).toBeNull();
  });
});
