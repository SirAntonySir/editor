import { describe, it, expect, beforeEach } from 'vitest';
import { useBackendState } from './backend-state-slice';
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
  it('reset clears snapshot and optimistic', () => {
    useBackendState.setState({ snapshot: baseSnapshot(), sessionId: 's1' });
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
});
