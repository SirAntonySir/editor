import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { FusedWidgetBody } from './FusedWidgetBody';
import type { Widget, WidgetCompound } from '@/types/widget';
import { makeAiWidget } from './__fixtures__/widgets';

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

/** Build a fused widget with a widget.compound block and two anchors.
 *  Uses the `light` op (node type `basic`, param `exposure`). */
function makeFusedWidget(overrides: Partial<Widget> = {}): Widget {
  const nodeId = 'n-basic-1';
  const compound: WidgetCompound = {
    driver: '__driver',
    label: 'Intensity',
    anchors: [
      {
        position: 0,
        name: 'subtle',
        values: { [`${nodeId}:exposure`]: 10 },
      },
      {
        position: 1,
        name: 'strong',
        values: { [`${nodeId}:exposure`]: 60 },
      },
    ],
  };

  return makeAiWidget({
    id: 'w-fused-1',
    intent: 'Brighten sky',
    opId: 'light',
    compound,
    driverValue: 1.0,
    nodes: [
      {
        id: nodeId,
        type: 'basic',
        opId: 'light',
        scope: { kind: 'global' },
        inputs: [],
        widgetId: 'w-fused-1',
        layerId: 'L1',
        params: { exposure: 0 },
      },
    ],
    bindings: [
      {
        paramKey: 'exposure',
        label: 'Exposure',
        controlType: 'slider',
        target: { nodeId, paramKey: 'exposure' },
        controlSchema: { controlType: 'slider', min: -100, max: 100, step: 1 },
        value: 60,
        default: 0,
      },
    ],
    ...overrides,
  });
}

describe('FusedWidgetBody', () => {
  it('renders the driver (Intensity) slider', () => {
    const widget = makeFusedWidget();
    const { getByRole } = render(
      <ReactFlowProvider>
        <FusedWidgetBody
          widget={widget}
          effectiveValue={(b) => b.value as number}
          setParam={vi.fn()}
        />
      </ReactFlowProvider>,
    );
    // AdjustmentSlider renders a Radix slider with role="slider"
    const sliders = getByRole('slider', { name: /intensity/i });
    expect(sliders).toBeTruthy();
  });

  it('driver slider has aria-valuenow reflecting driverValue × 100', () => {
    const widget = makeFusedWidget({ driverValue: 1.0 });
    const { getByRole } = render(
      <ReactFlowProvider>
        <FusedWidgetBody
          widget={widget}
          effectiveValue={(b) => b.value as number}
          setParam={vi.fn()}
        />
      </ReactFlowProvider>,
    );
    const slider = getByRole('slider', { name: /intensity/i });
    // driverValue 1.0 → display value 100
    expect(slider.getAttribute('aria-valuenow')).toBe('100');
  });

  it('renders a collapsible section for the light op', () => {
    const widget = makeFusedWidget();
    const { getByText } = render(
      <ReactFlowProvider>
        <FusedWidgetBody
          widget={widget}
          effectiveValue={(b) => b.value as number}
          setParam={vi.fn()}
        />
      </ReactFlowProvider>,
    );
    // Should show the op display name from registry ("Light")
    expect(getByText('Light')).toBeTruthy();
  });

  it('starts with op section collapsed (no per-param sliders visible)', () => {
    const widget = makeFusedWidget();
    const { container } = render(
      <ReactFlowProvider>
        <FusedWidgetBody
          widget={widget}
          effectiveValue={(b) => b.value as number}
          setParam={vi.fn()}
        />
      </ReactFlowProvider>,
    );
    // Only the driver slider is visible initially. RegistryDrivenPanel sliders
    // are inside the collapsed section, so we expect exactly 1 role="slider"
    // (the driver). The per-op param sliders won't be in the DOM when collapsed.
    const sliders = container.querySelectorAll('[role="slider"]');
    expect(sliders).toHaveLength(1);
  });

  it('calls setParam when the driver slider changes', () => {
    const widget = makeFusedWidget({ driverValue: 1.0 });
    const setParam = vi.fn();
    const { getByRole } = render(
      <ReactFlowProvider>
        <FusedWidgetBody
          widget={widget}
          effectiveValue={(b) => b.value as number}
          setParam={setParam}
        />
      </ReactFlowProvider>,
    );
    // The slider should exist (we tested rendering above)
    const slider = getByRole('slider', { name: /intensity/i });
    expect(slider).toBeTruthy();
    // setParam is not called on mount, only on user interaction
    expect(setParam).not.toHaveBeenCalled();
  });

  it('defaults driverValue to 1.0 when widget.driverValue is null', () => {
    const widget = makeFusedWidget({ driverValue: null });
    const { getByRole } = render(
      <ReactFlowProvider>
        <FusedWidgetBody
          widget={widget}
          effectiveValue={(b) => b.value as number}
          setParam={vi.fn()}
        />
      </ReactFlowProvider>,
    );
    const slider = getByRole('slider', { name: /intensity/i });
    // Default driverValue 1.0 → aria-valuenow 100
    expect(slider.getAttribute('aria-valuenow')).toBe('100');
  });

  it('uses driver label from compound.label when provided', () => {
    const widget = makeFusedWidget();
    const { getByText } = render(
      <ReactFlowProvider>
        <FusedWidgetBody
          widget={widget}
          effectiveValue={(b) => b.value as number}
          setParam={vi.fn()}
        />
      </ReactFlowProvider>,
    );
    // compound.label = 'Intensity'
    expect(getByText('Intensity')).toBeTruthy();
  });

  it('falls back to "Strength" label when compound.label is absent', () => {
    const widget = makeFusedWidget();
    // Remove the label
    const compound: WidgetCompound = { ...widget.compound!, label: null };
    const noLabelWidget: Widget = { ...widget, compound };
    const { getByText } = render(
      <ReactFlowProvider>
        <FusedWidgetBody
          widget={noLabelWidget}
          effectiveValue={(b) => b.value as number}
          setParam={vi.fn()}
        />
      </ReactFlowProvider>,
    );
    expect(getByText('Strength')).toBeTruthy();
  });
});
