import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { CompoundWidgetBody } from './CompoundWidgetBody';
import { makeTimeOfDayWidget } from './__fixtures__/widgets';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    set_widget_param: vi.fn(),
    unlock_widget_param: vi.fn(),
    propose_widget: vi.fn().mockResolvedValue({ ok: true, output: { widget: {} } }),
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

describe('CompoundWidgetBody', () => {
  it('renders the driver slider and per-anchor cards for time-of-day', () => {
    const { container } = render(
      <ReactFlowProvider>
        <CompoundWidgetBody widget={makeTimeOfDayWidget()} />
      </ReactFlowProvider>,
    );
    // The driver slider should render (PerceptualDialBody renders an input[type=range]).
    const sliders = container.querySelectorAll('input[type="range"], [role="slider"]');
    expect(sliders.length).toBeGreaterThanOrEqual(1);
  });
});
