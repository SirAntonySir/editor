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

it('renders a slider per param', () => {
  render(<ScalarSectionBody layerId="L1" op="basic" params={params} />);
  // Radix slider exposes its thumb with role="slider".
  expect(screen.getAllByRole('slider').length).toBe(1);
});

it('typing a new value into the number field writes canonical', () => {
  render(<ScalarSectionBody layerId="L1" op="basic" params={params} />);
  // The value label scrubs on drag and opens a text input on a plain click
  // (pointer down + up with no movement).
  const num = screen.getByTitle('Drag to scrub · click to type');
  fireEvent.pointerDown(num, { clientX: 0, pointerId: 1 });
  fireEvent.pointerUp(num, { clientX: 0, pointerId: 1 });
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: '20' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  vi.advanceTimersByTime(300);
  expect(backendTools.set_param).toHaveBeenCalledWith('s1', { layer_id: 'L1', op: 'basic', param: 'exposure', value: 20 });
});

// The per-section Reset button used to live in ScalarSectionBody as a
// trailing row. It's been consolidated into the clickable touched-count
// badge in `ToolSection` — see ToolSection.test.tsx for that coverage.
it('no longer renders an inline Reset button (consolidated into the count badge)', () => {
  render(<ScalarSectionBody layerId="L1" op="basic" params={params} />);
  expect(screen.queryByText('Reset')).toBeNull();
});
