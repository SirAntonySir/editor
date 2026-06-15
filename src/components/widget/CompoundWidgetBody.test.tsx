import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { CompoundWidgetBody, pickDialComponent } from './CompoundWidgetBody';
import { CircularDial } from './compound/CircularDial';
import { PerceptualDialBody } from '@/components/workspace/PerceptualDialBody';
import { makeTimeOfDayWidget } from './__fixtures__/widgets';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    set_widget_param: vi.fn(),
    unlock_widget_param: vi.fn(),
  },
}));

const mockApplyOptimistic = vi.fn();

vi.mock('@/store/backend-state-slice', async () => {
  const actual = await vi.importActual<typeof import('@/store/backend-state-slice')>('@/store/backend-state-slice');
  const buildState = () => ({
    sessionId: 's-1',
    optimistic: new Map(),
    snapshot: { masksIndex: [], revision: 1, widgets: [], operationGraph: { nodes: [] } },
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

describe('pickDialComponent', () => {
  it('returns PerceptualDialBody for linear topology', () => {
    expect(pickDialComponent('linear')).toBe(PerceptualDialBody);
  });
  it('returns PerceptualDialBody by default (undefined)', () => {
    expect(pickDialComponent(undefined)).toBe(PerceptualDialBody);
  });
  it('returns CircularDial for wheel topology', () => {
    expect(pickDialComponent('wheel')).toBe(CircularDial);
  });
});

describe('CompoundWidgetBody', () => {
  it('renders the driver dial for time-of-day (wheel topology)', () => {
    // time-of-day's compound.topology is 'wheel' → CompoundWidgetBody
    // renders CircularDial, which paints an <svg>. The body also renders
    // a grid of EditableParamCard entries for the per-bundle params.
    const { container } = render(
      <ReactFlowProvider>
        <CompoundWidgetBody widget={makeTimeOfDayWidget()} />
      </ReactFlowProvider>,
    );
    expect(container.querySelector('svg')).not.toBeNull();
    // FOLLOW-UP: CircularDial should expose role="slider" + aria-valuenow
    // so this assertion can match every compound topology by accessible
    // role rather than tag.
  });
});
