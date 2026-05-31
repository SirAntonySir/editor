import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScalarSectionBody } from './ScalarSectionBody';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import type { ParamDefinition } from '@/types/processing';

vi.mock('@/lib/backend-tools', () => ({ backendTools: { set_param: vi.fn().mockResolvedValue({ ok: true }) } }));

const params: ParamDefinition[] = [{ key: 'exposure', label: 'Exposure', min: -100, max: 100, default: 0 }];

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useBackendState.setState({ sessionId: 's1', sseStatus: 'open', optimistic: new Map(),
    snapshot: { session_id: 's1', image_context: null, widgets: [], masks_index: [],
      operation_graph: { id: 'g', userGoal: '', nodes: [], panelBindings: [], metadata: {} }, revision: 1 } as never } as never);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('renders a slider per param and writes canonical on edit', () => {
  render(<ScalarSectionBody layerId="L1" op="basic" params={params} />);
  const slider = screen.getByRole('slider');
  fireEvent.change(slider, { target: { value: '20' } });
  vi.advanceTimersByTime(300);
  expect(backendTools.set_param).toHaveBeenCalledWith('s1', { layer_id: 'L1', op: 'basic', param: 'exposure', value: 20 });
});

it('Reset writes the default for every param', () => {
  render(<ScalarSectionBody layerId="L1" op="basic" params={params} />);
  fireEvent.click(screen.getByText('Reset'));
  vi.advanceTimersByTime(300);
  expect(backendTools.set_param).toHaveBeenCalledWith('s1', { layer_id: 'L1', op: 'basic', param: 'exposure', value: 0 });
});
