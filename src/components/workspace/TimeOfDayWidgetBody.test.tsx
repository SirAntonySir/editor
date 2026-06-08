import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { TimeOfDayWidgetBody } from './TimeOfDayWidgetBody';
import { makeTimeOfDayWidget } from '@/components/widget/__fixtures__/widgets';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    set_widget_param: vi.fn(),
    propose_widget: vi.fn().mockResolvedValue({ ok: true, output: { widget: {} } }),
    delete_widget: vi.fn().mockResolvedValue({ ok: true, output: { widget_id: 'x' } }),
  },
}));

const mockApplyOptimistic = vi.fn();

vi.mock('@/store/backend-state-slice', async () => {
  const actual = await vi.importActual<typeof import('@/store/backend-state-slice')>('@/store/backend-state-slice');
  const buildState = () => ({
    sessionId: 's-1',
    optimistic: new Map(),
    snapshot: { masks_index: [], revision: 1, widgets: [], operation_graph: { nodes: [] } },
    sseStatus: 'open',
    applyOptimistic: mockApplyOptimistic,
  });
  return {
    ...actual,
    useBackendState: Object.assign(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (selector: (s: any) => any) => selector(buildState()),
      { getState: () => buildState() },
    ),
  };
});

afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); });

describe('TimeOfDayWidgetBody', () => {
  it('renders the 5 anchor labels and a slider', () => {
    render(<TimeOfDayWidgetBody widget={makeTimeOfDayWidget()} />);
    ['Dawn', 'Noon', 'Golden', 'Blue', 'Night'].forEach((l) => {
      expect(screen.getByText(l)).toBeTruthy();
    });
    expect(screen.getByRole('slider')).toBeTruthy();
  });

  it('renders a compiled read-out with at least one entry at the default position', () => {
    render(<TimeOfDayWidgetBody widget={makeTimeOfDayWidget()} />);
    // At position 0.30 (noon anchor), the anchor table includes 'Blue Sat' +15
    // which is among the top-4 by absolute value, so the CompiledReadout
    // surfaces it as a label.
    expect(screen.getByText('Blue Sat')).toBeTruthy();
  });

  it('writes an optimistic patch with compiled bindings when the slider moves', () => {
    render(<TimeOfDayWidgetBody widget={makeTimeOfDayWidget()} />);
    const slider = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '550' } }); // → 0.55 (Golden)
    // handleChange calls setPosition (which itself optimistically patches
    // time_of_day.position) AND then applyOptimistic with the compiled bundle.
    // The last call is the explicit compiled patch — it must include compound keys.
    expect(mockApplyOptimistic).toHaveBeenCalled();
    const lastCall = mockApplyOptimistic.mock.calls.at(-1)!;
    const [widgetId, patch] = lastCall;
    expect(widgetId).toBe('w-tod-1');
    const keys = patch.bindings.map((b: { paramKey: string }) => b.paramKey);
    expect(keys).toContain('kelvin.kelvin');
    expect(keys.length).toBeGreaterThan(1);
  });
});
