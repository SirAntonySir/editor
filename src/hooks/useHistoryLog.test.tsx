import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useHistoryLog } from './useHistoryLog';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    listHistory: vi.fn(),
  },
}));

const mockListHistory = vi.mocked(backendTools.listHistory);

function seedBackendState(sessionId: string | null, revision: number | null) {
  useBackendState.setState({
    sessionId,
    sseStatus: sessionId ? 'open' : 'idle',
    snapshot: revision !== null
      ? { sessionId: sessionId ?? '', revision, widgets: [], masksIndex: [], operationGraph: { id: 'g', userGoal: '', nodes: [], panelBindings: [], metadata: {} }, imageContext: null } as never
      : null,
    optimistic: new Map(),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  seedBackendState(null, null);
});

describe('useHistoryLog', () => {
  it('returns null when no session is open', () => {
    const { result } = renderHook(() => useHistoryLog());
    expect(result.current).toBeNull();
    expect(mockListHistory).not.toHaveBeenCalled();
  });

  it('fetches history when a session is set', async () => {
    mockListHistory.mockResolvedValue({
      entries: [{ id: 'e1', ts: 1000, label: 'set exposure' }],
      cursor: 0,
      can_undo: true,
      can_redo: false,
    });

    const { result } = renderHook(() => useHistoryLog());

    await act(async () => {
      seedBackendState('sess-1', 1);
    });

    expect(mockListHistory).toHaveBeenCalledWith('sess-1');
    expect(result.current).not.toBeNull();
    expect(result.current?.entries).toHaveLength(1);
    expect(result.current?.entries[0].label).toBe('set exposure');
    expect(result.current?.cursor).toBe(0);
    expect(result.current?.canUndo).toBe(true);
    expect(result.current?.canRedo).toBe(false);
  });

  it('refetches when revision changes', async () => {
    mockListHistory
      .mockResolvedValueOnce({
        entries: [{ id: 'e1', ts: 1000, label: 'step A' }],
        cursor: 0,
        can_undo: true,
        can_redo: false,
      })
      .mockResolvedValueOnce({
        entries: [
          { id: 'e1', ts: 1000, label: 'step A' },
          { id: 'e2', ts: 2000, label: 'step B' },
        ],
        cursor: 1,
        can_undo: true,
        can_redo: false,
      });

    const { result } = renderHook(() => useHistoryLog());

    await act(async () => {
      seedBackendState('sess-1', 1);
    });

    expect(result.current?.entries).toHaveLength(1);

    await act(async () => {
      seedBackendState('sess-1', 2);
    });

    expect(mockListHistory).toHaveBeenCalledTimes(2);
    expect(result.current?.entries).toHaveLength(2);
    expect(result.current?.cursor).toBe(1);
  });

  it('resets to null when session is cleared', async () => {
    mockListHistory.mockResolvedValue({
      entries: [{ id: 'e1', ts: 1000, label: 'step A' }],
      cursor: 0,
      can_undo: true,
      can_redo: false,
    });

    const { result } = renderHook(() => useHistoryLog());

    await act(async () => {
      seedBackendState('sess-1', 1);
    });

    expect(result.current).not.toBeNull();

    act(() => {
      seedBackendState(null, null);
    });

    expect(result.current).toBeNull();
  });
});
