import { renderHook, act } from '@testing-library/react';
import { it, expect, vi, beforeEach } from 'vitest';
import { useCanonicalParam } from './useCanonicalParam';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: { set_param: vi.fn().mockResolvedValue({ ok: true }) },
}));

function seedSnapshot(nodes: { id: string; type: string; layer_id: string; params: Record<string, unknown> }[]) {
  useBackendState.setState({
    sessionId: 's1',
    sseStatus: 'open',
    snapshot: {
      session_id: 's1', image_context: null, widgets: [], masks_index: [],
      operation_graph: { id: 'g', userGoal: '', nodes: nodes as never, panelBindings: [], metadata: {} },
      revision: 1,
    } as never,
    optimistic: new Map(),
  } as never);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useBackendState.getState().reset?.();
});

it('reads the canonical node param value', () => {
  seedSnapshot([{ id: 'canon:L1:basic', type: 'basic', layer_id: 'L1', params: { exposure: 42 } }]);
  const { result } = renderHook(() => useCanonicalParam('L1', 'basic', 'exposure', 0));
  expect(result.current[0]).toBe(42);
});

it('falls back to the default when no canonical node exists', () => {
  seedSnapshot([]);
  const { result } = renderHook(() => useCanonicalParam('L1', 'basic', 'exposure', 7));
  expect(result.current[0]).toBe(7);
});

it('setter applies optimistic immediately and debounces set_param', () => {
  seedSnapshot([]);
  const { result } = renderHook(() => useCanonicalParam('L1', 'basic', 'exposure', 0 as number));
  act(() => { result.current[1](55); });
  expect(result.current[0]).toBe(55);
  expect(backendTools.set_param).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(300); });
  expect(backendTools.set_param).toHaveBeenCalledWith('s1', { layer_id: 'L1', op: 'basic', param: 'exposure', value: 55 });
});
