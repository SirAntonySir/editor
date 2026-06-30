import { describe, expect, it, vi, beforeEach } from 'vitest';

// The slice's refetch path dynamically imports fetchSnapshot from here.
const fetchSnapshotMock = vi.fn();
vi.mock('@/lib/sse-subscriber', () => ({
  fetchSnapshot: (...a: unknown[]) => fetchSnapshotMock(...a),
}));

const { useBackendState } = await import('./backend-state-slice');

function widgetCreatedEvent(rev: number) {
  return {
    revision: rev,
    kind: 'widget.created',
    payload: {
      widget: {
        id: 'w1',
        origin: { kind: 'tool_invoked' },
        nodes: [],
        bindings: [],
        status: 'active',
      },
    },
  } as never;
}

function snapshotWith(widgets: { id: string }[]) {
  return {
    sessionId: 'sid-1',
    revision: 5,
    widgets,
    masksIndex: [],
    operationGraph: { id: '', userGoal: '', nodes: [], panelBindings: [], metadata: {} },
    imageContext: null,
    aiAccess: true,
  } as never;
}

beforeEach(() => {
  fetchSnapshotMock.mockReset();
  useBackendState.setState({ sessionId: 'sid-1', snapshot: null });
});

describe('snapshot refetch when an event arrives before the snapshot exists', () => {
  it('refetches and applies the snapshot for a widget.created while snapshot is null', async () => {
    fetchSnapshotMock.mockResolvedValue(snapshotWith([{ id: 'w1' }]));

    useBackendState.getState().applyEvent(widgetCreatedEvent(3));

    await vi.waitFor(() => expect(fetchSnapshotMock).toHaveBeenCalledWith('sid-1'));
    await vi.waitFor(() =>
      expect(useBackendState.getState().snapshot?.widgets).toEqual([{ id: 'w1' }]),
    );
  });

  it('does NOT refetch when there is no active session', async () => {
    useBackendState.setState({ sessionId: null, snapshot: null });
    useBackendState.getState().applyEvent(widgetCreatedEvent(3));
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchSnapshotMock).not.toHaveBeenCalled();
  });
});
