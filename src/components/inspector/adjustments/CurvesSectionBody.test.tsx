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
    snapshot: { sessionId: 's1', imageContext: null, widgets: [], masksIndex: [],
      operationGraph: { id: 'g', userGoal: '', nodes: [], panelBindings: [], metadata: {} }, revision: 1 } as never } as never);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('writes per-channel canonical params on edit (matches the canvas curves widget shape)', () => {
  render(<CurvesSectionBody layerId="L1" />);
  fireEvent.click(screen.getByText('edit-curve'));
  vi.advanceTimersByTime(300);
  // Only the RGB channel changed in the mock — the other three keep their
  // identity values, so the body must NOT write them.
  expect(backendTools.set_param).toHaveBeenCalledWith(
    's1',
    expect.objectContaining({
      layer_id: 'L1', op: 'curves', param: 'rgb',
      value: [[0, 0], [127.5, 178.5], [255, 255]],
    }),
  );
  // Other channels stay at identity → no set_param call for them.
  for (const ch of ['red', 'green', 'blue']) {
    expect(backendTools.set_param).not.toHaveBeenCalledWith(
      's1', expect.objectContaining({ op: 'curves', param: ch }),
    );
  }
});
