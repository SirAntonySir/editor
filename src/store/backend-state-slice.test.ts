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
    createdAt: '2026-05-23T00:00:00Z',
    updatedAt: '2026-05-23T00:00:00Z',
    ...overrides,
  };
}

function baseSnapshot(): SessionStateSnapshot {
  return {
    sessionId: 's1',
    imageContext: null,
    widgets: [makeWidget('w_1')],
    masksIndex: [],
    operationGraph: {
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
  it('reset clears snapshot and optimistic', () => {
    useBackendState.setState({
      snapshot: baseSnapshot(),
      sessionId: 's1',
    });
    useBackendState.getState().reset();
    expect(useBackendState.getState().snapshot).toBeNull();
    expect(useBackendState.getState().sessionId).toBeNull();
    expect(useBackendState.getState().optimistic.size).toBe(0);
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
        operationGraph: {
          id: 'projected-y',
          nodes: [{ id: 'n_new', type: 'basic', layerId: 'layer-1', params: { exposure: 40 } }],
        },
      },
      emitted_at: '2026-05-23T00:00:01Z',
    };
    useBackendState.getState().applyEvent(ev);
    const snap = useBackendState.getState().snapshot!;
    expect(snap.operationGraph.nodes.map((n) => n.id)).toEqual(['n_new']);
  });

  it('applyEvent widget.updated swaps in the embedded operation_graph', () => {
    useBackendState.setState({ snapshot: baseSnapshot() });
    useBackendState.getState().applyEvent({
      revision: 2,
      kind: 'widget.updated',
      payload: {
        widget: makeWidget('w_1', { revision: 2 }),
        operationGraph: {
          id: 'projected-z',
          nodes: [{ id: 'n_1', type: 'basic', layerId: 'layer-1', params: { exposure: 90 } }],
        },
      },
      emitted_at: '2026-05-23T00:00:02Z',
    } as StateEvent);
    const snap = useBackendState.getState().snapshot!;
    expect(snap.operationGraph.nodes[0].params.exposure).toBe(90);
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
      payload: { widgetId: 'w_1' },
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

  it('applyEvent widget.accepted removes the widget from the snapshot', () => {
    useBackendState.setState({ snapshot: baseSnapshot() });
    useBackendState.getState().applyEvent({
      revision: 2, kind: 'widget.accepted',
      payload: { widgetId: 'w_1' },
      emitted_at: '2026-05-23T00:00:01Z',
    });
    expect(useBackendState.getState().snapshot?.widgets.find((w) => w.id === 'w_1')).toBeUndefined();
  });

  it('applyEvent drops same-or-lower revision events defensively', () => {
    const snap = baseSnapshot();
    snap.revision = 5;
    useBackendState.setState({ snapshot: snap });
    useBackendState.getState().applyEvent({
      revision: 5, kind: 'widget.deleted',
      payload: { widgetId: 'w_1' },
      emitted_at: '2026-05-23T00:00:01Z',
    });
    expect(useBackendState.getState().snapshot!.widgets[0].status).toBe('active');
  });

  it('widget.accepted removes widget from snapshot (backend now owns adjustment materialization)', () => {
    const widget = makeWidget('w_x', { nodes: [{
      id: 'n1', type: 'kelvin', params: { temperature: 7000 },
      scope: { kind: 'global' }, inputs: [], widgetId: 'w_x',
    }] });
    useBackendState.setState({
      snapshot: { ...baseSnapshot(), widgets: [widget], revision: 1 },
    });

    useBackendState.getState().applyEvent({
      revision: 2, kind: 'widget.accepted',
      payload: { widgetId: 'w_x' },
      emitted_at: '2026-05-28T00:00:01Z',
    });

    // Widget is removed from snapshot.
    expect(useBackendState.getState().snapshot!.widgets.find(w => w.id === 'w_x')).toBeUndefined();
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
      nodes: [{ id: 'n1', type: 'light', params: {}, scope: { kind: 'global' }, inputs: [], widgetId: 'w_tool', layerId: 'layer-a' }],
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
      nodes: [{ id: 'n1', type: 'light', params: {}, scope: { kind: 'global' }, inputs: [], widgetId: 'w_ai', layerId: 'layer-a' }],
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
      nodes: [{ id: 'n1', type: 'light', params: {}, scope: { kind: 'global' }, inputs: [], widgetId: 'w_tool', layerId: 'layer-x' }],
    });
    fireCreated(w);
    const editor = useEditorStore.getState();
    expect(editor.widgetNodes[w.id]).toBeUndefined();
    expect(Object.values(editor.tetherEdges)).toEqual([]);
  });

  it('applyEvent widget.created bridges autonomous origin to useSuggestionsUi.markPending', async () => {
    const { useSuggestionsUi } = await import('./suggestions-ui-slice');
    useSuggestionsUi.getState().reset();
    useEditorStore.getState().resetWorkspace();

    // Seed snapshot at revision 0 so subsequent widget.created events apply.
    useBackendState.setState({
      sessionId: 's_1',
      snapshot: {
        sessionId: 's_1',
        revision: 0,
        imageContext: null,
        widgets: [],
        masksIndex: [],
        operationGraph: { id: 'g_1', userGoal: '', nodes: [], panelBindings: [], metadata: {} },
      } as never,
      sseStatus: 'open',
    });

    const fire = (id: string, kind: 'mcp_autonomous' | 'tool_invoked', revision: number) =>
      useBackendState.getState().applyEvent({
        revision,
        kind: 'widget.created',
        emitted_at: new Date().toISOString(),
        payload: {
          widget: makeWidget(id, {
            origin: { kind, prompt: kind === 'mcp_autonomous' ? null : 'test' },
            nodes: [{ id: `n_${id}`, type: 'light', params: {}, scope: { kind: 'global' }, inputs: [], widgetId: id }],
          }),
          operationGraph: { id: 'g_1', userGoal: '', nodes: [], panelBindings: [], metadata: {} },
        },
      } as never);

    fire('w_auto_1', 'mcp_autonomous', 1);
    fire('w_auto_2', 'mcp_autonomous', 2);
    fire('w_tool', 'tool_invoked', 3);  // must NOT land in pending

    const pending = useSuggestionsUi.getState().pendingSuggestionIds;
    expect(pending.has('w_auto_1')).toBe(true);
    expect(pending.has('w_auto_2')).toBe(true);
    expect(pending.has('w_tool')).toBe(false);
    expect(pending.size).toBe(2);
  });

  it('reset clears the cross-store useSuggestionsUi state too', async () => {
    const { useSuggestionsUi } = await import('./suggestions-ui-slice');
    useSuggestionsUi.getState().reset();
    useSuggestionsUi.getState().addAcceptedSuggestion('w_accepted');
    useSuggestionsUi.getState().markPending(['w_pending']);
    useSuggestionsUi.getState().setPreview('w_preview', true);

    useBackendState.getState().reset();

    const ui = useSuggestionsUi.getState();
    expect(ui.acceptedSuggestions.size).toBe(0);
    expect(ui.pendingSuggestionIds.size).toBe(0);
    expect(ui.previewingSuggestionIds.size).toBe(0);
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

  it('phase.cancelled sets mcpAnalyzeCancelled and clears the cancelling flag', () => {
    useBackendState.getState().applyEvent(started('update', 1, 1));
    useBackendState.getState().setCancelling(true);
    useBackendState.getState().applyEvent({
      revision: 2, kind: 'phase.cancelled', payload: {}, emitted_at: 'x',
    } as StateEvent);
    expect(useBackendState.getState().mcpAnalyzeCancelled).toBe(true);
    expect(useBackendState.getState().cancelling).toBe(false);
  });

  it('mcp.usage accumulates input/output tokens across calls', () => {
    useBackendState.getState().applyEvent(started('update', 1, 1));
    useBackendState.getState().applyEvent({
      revision: 2, kind: 'mcp.usage',
      payload: { call: 'analyze', input_tokens: 100, output_tokens: 20, cache_create: 80, cache_read: 0 },
      emitted_at: 'x',
    } as StateEvent);
    useBackendState.getState().applyEvent({
      revision: 3, kind: 'mcp.usage',
      payload: { call: 'panel', input_tokens: 50, output_tokens: 10, cache_create: 0, cache_read: 80 },
      emitted_at: 'x',
    } as StateEvent);
    const u = useBackendState.getState().usage!;
    expect(u.inputTokens).toBe(150);
    expect(u.outputTokens).toBe(30);
    expect(u.cacheCreate).toBe(80);
    expect(u.cacheRead).toBe(80);
  });

  it('a new run (phase.started index=1) resets usage and cancellation state', () => {
    useBackendState.getState().applyEvent(started('update', 1, 1));
    useBackendState.getState().applyEvent({
      revision: 2, kind: 'mcp.usage',
      payload: { call: 'analyze', input_tokens: 100, output_tokens: 20 },
      emitted_at: 'x',
    } as StateEvent);
    useBackendState.getState().applyEvent({
      revision: 3, kind: 'phase.cancelled', payload: {}, emitted_at: 'x',
    } as StateEvent);
    expect(useBackendState.getState().mcpAnalyzeCancelled).toBe(true);
    // second analyze begins
    useBackendState.getState().applyEvent(started('update', 1, 4));
    expect(useBackendState.getState().mcpAnalyzeCancelled).toBe(false);
    expect(useBackendState.getState().usage).toBeNull();
  });
});

describe('BackendStateSlice — applyOptimistic merge', () => {
  beforeEach(() => useBackendState.getState().reset());

  it('applyOptimistic merges bindings on the same node by paramKey', () => {
    const s = useBackendState.getState();
    s.applyOptimistic('canon:L1:basic', { bindings: [{ paramKey: 'highlights', value: 40 }], baseRevision: 1 });
    s.applyOptimistic('canon:L1:basic', { bindings: [{ paramKey: 'shadows', value: -20 }], baseRevision: 1 });
    const patch = useBackendState.getState().optimistic.get('canon:L1:basic');
    const byKey = Object.fromEntries((patch?.bindings ?? []).map((b) => [b.paramKey, b.value]));
    expect(byKey).toEqual({ highlights: 40, shadows: -20 });
  });

  it('applyOptimistic overwrites the same paramKey rather than duplicating', () => {
    const s = useBackendState.getState();
    s.applyOptimistic('canon:L1:basic', { bindings: [{ paramKey: 'highlights', value: 40 }], baseRevision: 1 });
    s.applyOptimistic('canon:L1:basic', { bindings: [{ paramKey: 'highlights', value: 10 }], baseRevision: 1 });
    const patch = useBackendState.getState().optimistic.get('canon:L1:basic');
    expect(patch?.bindings).toEqual([{ paramKey: 'highlights', value: 10 }]);
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
