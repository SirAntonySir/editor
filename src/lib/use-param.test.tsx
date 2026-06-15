import { renderHook, act } from '@testing-library/react';
import { it, expect, vi, beforeEach } from 'vitest';
import { useParam } from './use-param';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    set_param: vi.fn().mockResolvedValue({ ok: true }),
    set_widget_param: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

function seedSnapshot(nodes: { id: string; type: string; layerId: string; params: Record<string, unknown> }[], widgets: { id: string; bindings: { paramKey: string; value: unknown }[] }[] = []) {
  useBackendState.setState({
    sessionId: 's1',
    sseStatus: 'open',
    snapshot: {
      sessionId: 's1', imageContext: null, widgets: widgets as never, masksIndex: [],
      operationGraph: { id: 'g', userGoal: '', nodes: nodes as never, panelBindings: [], metadata: {} },
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

// ---- canonical target ----

it('canonical target reads the canonical op-graph node param', () => {
  seedSnapshot([{ id: 'canon:L1:basic', type: 'basic', layerId: 'L1', params: { exposure: 42 } }]);
  const { result } = renderHook(() => useParam({ kind: 'canonical', layerId: 'L1', op: 'basic', param: 'exposure' }, 0));
  expect(result.current[0]).toBe(42);
});

it('canonical target falls back to default when no node exists', () => {
  seedSnapshot([]);
  const { result } = renderHook(() => useParam({ kind: 'canonical', layerId: 'L1', op: 'basic', param: 'exposure' }, 7));
  expect(result.current[0]).toBe(7);
});

it('canonical setter applies optimistic immediately + debounces set_param', () => {
  seedSnapshot([]);
  const { result } = renderHook(() => useParam({ kind: 'canonical', layerId: 'L1', op: 'basic', param: 'exposure' }, 0 as number));
  act(() => { result.current[1](55); });
  expect(result.current[0]).toBe(55);
  expect(backendTools.set_param).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(300); });
  expect(backendTools.set_param).toHaveBeenCalledWith('s1', { layerId: 'L1', op: 'basic', param: 'exposure', value: 55 });
});

it('canonical setter aborts when a history op cleared optimistic mid-debounce', () => {
  seedSnapshot([]);
  const { result } = renderHook(() => useParam({ kind: 'canonical', layerId: 'L1', op: 'basic', param: 'exposure' }, 0 as number));
  act(() => { result.current[1](77); });
  act(() => {
    useBackendState.setState((s) => ({ ...s, optimistic: new Map() } as never));
    vi.advanceTimersByTime(400);
  });
  expect(backendTools.set_param).not.toHaveBeenCalled();
});

// ---- widget target ----

it('widget target prefers a widget binding over the op-graph node', () => {
  seedSnapshot(
    [{ id: 'w1', type: 'basic', layerId: 'L1', params: { exposure: 10 } }],
    [{ id: 'w1', bindings: [{ paramKey: 'exposure', value: 99 }] }],
  );
  const { result } = renderHook(() => useParam({ kind: 'widget', widgetId: 'w1', paramKey: 'exposure' }, 0));
  expect(result.current[0]).toBe(99);
});

it('widget target falls back to op-graph node when no binding matches', () => {
  seedSnapshot([{ id: 'w1', type: 'basic', layerId: 'L1', params: { exposure: 33 } }]);
  const { result } = renderHook(() => useParam({ kind: 'widget', widgetId: 'w1', paramKey: 'exposure' }, 0));
  expect(result.current[0]).toBe(33);
});

it('widget target falls back to default when neither binding nor node exists', () => {
  seedSnapshot([]);
  const { result } = renderHook(() => useParam({ kind: 'widget', widgetId: 'w1', paramKey: 'exposure' }, 5));
  expect(result.current[0]).toBe(5);
});

it('widget setter debounces set_widget_param', () => {
  seedSnapshot([{ id: 'w1', type: 'basic', layerId: 'L1', params: { exposure: 0 } }]);
  const { result } = renderHook(() => useParam({ kind: 'widget', widgetId: 'w1', paramKey: 'exposure' }, 0 as number));
  act(() => { result.current[1](44); });
  expect(result.current[0]).toBe(44);
  expect(backendTools.set_widget_param).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(300); });
  expect(backendTools.set_widget_param).toHaveBeenCalledWith('s1', { widgetId: 'w1', paramKey: 'exposure', value: 44 });
});

it('cleanup on unmount cancels a pending debounced write', () => {
  seedSnapshot([]);
  const { result, unmount } = renderHook(() => useParam({ kind: 'canonical', layerId: 'L1', op: 'basic', param: 'exposure' }, 0 as number));
  act(() => { result.current[1](88); });
  unmount();
  act(() => { vi.advanceTimersByTime(400); });
  expect(backendTools.set_param).not.toHaveBeenCalled();
});

// ---- disabled paths ----

it('canonical setter is a no-op when layerId is null', () => {
  seedSnapshot([]);
  const { result } = renderHook(() => useParam({ kind: 'canonical', layerId: null, op: 'basic', param: 'exposure' }, 0 as number));
  act(() => { result.current[1](42); });
  act(() => { vi.advanceTimersByTime(400); });
  expect(backendTools.set_param).not.toHaveBeenCalled();
});

it('widget setter is a no-op when widgetId is undefined', () => {
  seedSnapshot([]);
  const { result } = renderHook(() => useParam({ kind: 'widget', widgetId: undefined, paramKey: 'exposure' }, 0 as number));
  act(() => { result.current[1](42); });
  act(() => { vi.advanceTimersByTime(400); });
  expect(backendTools.set_widget_param).not.toHaveBeenCalled();
});

it('setter is a no-op when sseStatus is not open (offline)', () => {
  seedSnapshot([]);
  useBackendState.setState((s) => ({ ...s, sseStatus: 'closed' } as never));
  const { result } = renderHook(() => useParam({ kind: 'canonical', layerId: 'L1', op: 'basic', param: 'exposure' }, 0 as number));
  act(() => { result.current[1](99); });
  act(() => { vi.advanceTimersByTime(400); });
  expect(backendTools.set_param).not.toHaveBeenCalled();
});
