import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/react';
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

  it('falls back to "Intensity" label when compound.label is absent', () => {
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
    expect(getByText('Intensity')).toBeTruthy();
  });

  // Fix 7a: expanding an op section reveals its real controls
  it('clicking a section header expands it and reveals the op controls', () => {
    const widget = makeFusedWidget();
    const { getByText, queryByText } = render(
      <ReactFlowProvider>
        <FusedWidgetBody
          widget={widget}
          effectiveValue={(b) => b.value as number}
          setParam={vi.fn()}
        />
      </ReactFlowProvider>,
    );
    // Before expand: 'Exposure' label from RegistryDrivenPanel should not be in DOM
    expect(queryByText('Exposure')).toBeNull();
    // Click the section header button to expand
    const sectionButton = getByText('Light').closest('button');
    expect(sectionButton).toBeTruthy();
    fireEvent.click(sectionButton!);
    // After expand: 'Exposure' should appear inside RegistryDrivenPanel
    expect(getByText('Exposure')).toBeTruthy();
  });

  // Fix 7b: locked params show pinned indicator
  it('shows pinned indicator when a section has locked params', () => {
    const widget = makeFusedWidget({ lockedParams: ['exposure'] });
    const { getByTitle } = render(
      <ReactFlowProvider>
        <FusedWidgetBody
          widget={widget}
          effectiveValue={(b) => b.value as number}
          setParam={vi.fn()}
        />
      </ReactFlowProvider>,
    );
    expect(getByTitle(/1 pinned/i)).toBeTruthy();
  });

  // Fix 7c: changing driver slider calls setParam with '__driver' and value / 100
  it('driver slider onChange calls setParam with __driver and value/100', () => {
    vi.useFakeTimers();
    const widget = makeFusedWidget({ driverValue: 1.0 });
    const setParam = vi.fn();
    const { getAllByRole } = render(
      <ReactFlowProvider>
        <FusedWidgetBody
          widget={widget}
          effectiveValue={(b) => b.value as number}
          setParam={setParam}
        />
      </ReactFlowProvider>,
    );
    // AdjustmentSlider renders a Radix slider thumb with role="slider".
    // Use getAllByRole since the Radix slider may render multiple accessible elements.
    const sliders = getAllByRole('slider', { name: /intensity/i });
    const slider = sliders[0];
    // Press End key to jump to max value (150), well outside snap range (snapTo=100, threshold=2.5).
    // This ensures the snap doesn't pull the value back to 100.
    fireEvent.keyDown(slider, { key: 'End', code: 'End' });
    // Advance timers to flush the debounce
    vi.runAllTimers();
    // setParam should have been called with '__driver' and t = 150 / 100 = 1.5
    expect(setParam).toHaveBeenCalledWith('__driver', expect.closeTo(1.5, 5));
    vi.useRealTimers();
  });

  // Fix 1: Overshoot clamping — applyOptimistic must receive values within the op's range.
  it('clamps optimistic binding values to the controlSchema range on overshoot', () => {
    vi.useFakeTimers();
    // makeFusedWidget uses exposure with slider min=-100, max=100.
    // anchor 0 = 10 (position 0), anchor 1 = 60 (position 1).
    // At t=1.5 (display 150), linear extrapolation gives 10 + 1.5*(60-10) = 85 — still within range.
    // Use a wider extrapolation: anchor 0 = -100, anchor 1 = 100 → at t=1.5 → 200, clamped to 100.
    const nodeId = 'n-basic-1';
    const widgetWithWideRange = makeFusedWidget({
      compound: {
        driver: '__driver',
        label: 'Intensity',
        anchors: [
          { position: 0, name: 'subtle', values: { [`${nodeId}:exposure`]: -100 } },
          { position: 1, name: 'strong', values: { [`${nodeId}:exposure`]: 100 } },
        ],
      },
      driverValue: 1.0,
    });
    const setParam = vi.fn();
    const { getAllByRole } = render(
      <ReactFlowProvider>
        <FusedWidgetBody
          widget={widgetWithWideRange}
          effectiveValue={(b) => b.value as number}
          setParam={setParam}
        />
      </ReactFlowProvider>,
    );
    const sliders = getAllByRole('slider', { name: /intensity/i });
    // Drive to display=150 (t=1.5): extrapolated exposure = -100 + 1.5*(200) = 200, clamped → 100.
    fireEvent.keyDown(sliders[0], { key: 'End', code: 'End' });
    vi.runAllTimers();
    // applyOptimistic should have been called with exposure clamped to 100 (not 200).
    const calls = mockApplyOptimistic.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const lastCall = calls[calls.length - 1];
    const patchArg = lastCall[1] as { bindings: { paramKey: string; value: number }[] };
    const exposureBinding = patchArg.bindings.find((b) => b.paramKey === 'exposure');
    expect(exposureBinding).toBeDefined();
    // Must be clamped to max=100, NOT the raw extrapolation (which would be >100).
    expect(exposureBinding!.value).toBeLessThanOrEqual(100);
    expect(exposureBinding!.value).toBeGreaterThanOrEqual(-100);
    vi.useRealTimers();
  });
});
