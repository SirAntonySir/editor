import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CurvesSectionBody } from './CurvesSectionBody';
import { useBackendState } from '@/store/backend-state-slice';
import { backendTools } from '@/lib/backend-tools';
import { IDENTITY_CURVES } from '@/types/curve';

vi.mock('@/lib/backend-tools', () => ({ backendTools: { set_param: vi.fn().mockResolvedValue({ ok: true }) } }));
vi.mock('@/components/inspector/widget/primitives/CurveControl', () => ({
  CurveControl: ({ onChange }: { onChange: (v: unknown) => void }) => (
    <button onClick={() => onChange({ ...IDENTITY_CURVES, rgb: [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }] })}>edit-curve</button>
  ),
}));

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  useBackendState.setState({ sessionId: 's1', sseStatus: 'open', optimistic: new Map(),
    snapshot: { session_id: 's1', image_context: null, widgets: [], masks_index: [],
      operation_graph: { id: 'g', userGoal: '', nodes: [], panelBindings: [], metadata: {} }, revision: 1 } as never } as never);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('writes the canonical curve on edit', () => {
  render(<CurvesSectionBody layerId="L1" />);
  fireEvent.click(screen.getByText('edit-curve'));
  vi.advanceTimersByTime(300);
  expect(backendTools.set_param).toHaveBeenCalledWith('s1', expect.objectContaining({ layer_id: 'L1', op: 'curves', param: 'curves' }));
});
