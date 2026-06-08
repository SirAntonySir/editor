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

  it('renders an editable card for every bundle key, including zeros', () => {
    render(<TimeOfDayWidgetBody widget={makeTimeOfDayWidget()} />);
    // All 9 bundle keys render a card with a label, regardless of whether
    // the current position interpolates them to zero (e.g. Noon → Vibrance 0).
    ['WB', 'Exposure', 'Contrast', 'Highlights', 'Shadows',
     'Vibrance', 'Orange Sat', 'Blue Sat', 'Vignette']
      .forEach((label) => expect(screen.getByText(label)).toBeTruthy());
  });

  it('writes an optimistic patch keyed by the canonical compound node id when the slider moves', () => {
    render(<TimeOfDayWidgetBody widget={makeTimeOfDayWidget()} />);
    const slider = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '550' } }); // → 0.55 (Golden)
    // handleChange calls setPosition (which itself optimistically patches
    // time_of_day.position keyed by widget id) AND then applyOptimistic with
    // the compiled bundle keyed by `canon:<layer>:compound`. The renderer
    // reads the compound patch via that key.
    expect(mockApplyOptimistic).toHaveBeenCalled();
    const lastCall = mockApplyOptimistic.mock.calls.at(-1)!;
    const [key, patch] = lastCall;
    expect(key).toBe('canon:L1:compound');
    const keys = patch.bindings.map((b: { paramKey: string }) => b.paramKey);
    expect(keys).toContain('time_of_day.position');
    expect(keys).toContain('kelvin.kelvin');
    expect(keys).toContain('light.exposure');
  });
});
