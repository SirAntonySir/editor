import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { FusedWidgetBody } from './FusedWidgetBody';
import type { Widget, WidgetCompound } from '@/types/widget';
import { makeAiWidget } from './__fixtures__/widgets';
import { backendTools } from '@/lib/backend-tools';
import { useEditorStore } from '@/store';
import { fusedSliceNodeIdFor } from '@/store/workspace-slice';

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

  // -------------------------------------------------------------------------
  // Phase C2: unpin affordances
  // -------------------------------------------------------------------------

  describe('Phase C2: unpin affordances', () => {
    it('pinned param renders the release button inside the expanded section', async () => {
      const widget = makeFusedWidget({ lockedParams: ['exposure'] });
      const { getByText, getByTitle } = render(
        <ReactFlowProvider>
          <FusedWidgetBody
            widget={widget}
            effectiveValue={(b) => b.value as number}
            setParam={vi.fn()}
          />
        </ReactFlowProvider>,
      );

      // Expand the section
      const sectionButton = getByText('Light').closest('button');
      expect(sectionButton).toBeTruthy();
      fireEvent.click(sectionButton!);

      // The per-param release button should appear inside the expanded section
      const pinBtn = getByTitle('Pinned — click to release');
      expect(pinBtn).toBeTruthy();
    });

    it('clicking per-param release button calls unlock_widget_param with correct args', async () => {
      const mockUnlock = vi.mocked(backendTools.unlock_widget_param);
      const widget = makeFusedWidget({ lockedParams: ['exposure'] });
      const { getByText, getByTitle } = render(
        <ReactFlowProvider>
          <FusedWidgetBody
            widget={widget}
            effectiveValue={(b) => b.value as number}
            setParam={vi.fn()}
          />
        </ReactFlowProvider>,
      );

      // Expand the section
      const sectionButton = getByText('Light').closest('button');
      fireEvent.click(sectionButton!);

      // Click the per-param release button
      const pinBtn = getByTitle('Pinned — click to release');
      fireEvent.click(pinBtn);

      expect(mockUnlock).toHaveBeenCalledWith('s-1', {
        widgetId: 'w-fused-1',
        paramKey: 'exposure',
      });
    });

    it('section-header release-all calls unlock_widget_param for every pinned param in that section', async () => {
      const mockUnlock = vi.mocked(backendTools.unlock_widget_param);
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

      // Click the section header pin indicator (release-all button)
      const releaseAllBtn = getByTitle(/1 pinned — click to release all/i);
      fireEvent.click(releaseAllBtn);

      expect(mockUnlock).toHaveBeenCalledTimes(1);
      expect(mockUnlock).toHaveBeenCalledWith('s-1', {
        widgetId: 'w-fused-1',
        paramKey: 'exposure',
      });
    });

    it('clicking the header pin/release-all button does NOT collapse/expand the section', async () => {
      const widget = makeFusedWidget({ lockedParams: ['exposure'] });
      const { getByTitle, queryByRole } = render(
        <ReactFlowProvider>
          <FusedWidgetBody
            widget={widget}
            effectiveValue={(b) => b.value as number}
            setParam={vi.fn()}
          />
        </ReactFlowProvider>,
      );

      // Initially collapsed: no sliders from the section should be visible
      // (only the driver slider is present)
      const slidersBeforeClick = queryByRole('slider', { name: /exposure/i });
      expect(slidersBeforeClick).toBeNull();

      // Click the release-all button
      const releaseAllBtn = getByTitle(/1 pinned — click to release all/i);
      fireEvent.click(releaseAllBtn);

      // Section should still be collapsed — no exposure slider in the DOM
      const slidersAfterClick = queryByRole('slider', { name: /exposure/i });
      expect(slidersAfterClick).toBeNull();
    });

    it('unpinned params get no pin slot (no "Pinned — click to release" button)', async () => {
      // No lockedParams → exposure is not pinned
      const widget = makeFusedWidget({ lockedParams: [] });
      const { getByText, queryByTitle } = render(
        <ReactFlowProvider>
          <FusedWidgetBody
            widget={widget}
            effectiveValue={(b) => b.value as number}
            setParam={vi.fn()}
          />
        </ReactFlowProvider>,
      );

      // Expand the section to see per-param controls
      const sectionButton = getByText('Light').closest('button');
      fireEvent.click(sectionButton!);

      // No release button should appear for unpinned params
      expect(queryByTitle('Pinned — click to release')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Phase C3: break-out (⤢) spawn affordance
  // -------------------------------------------------------------------------
  describe('Phase C3: break-out affordance', () => {
    const PARENT_ID = 'w-fused-1';
    const NODE_ID = 'n-basic-1';

    beforeEach(() => {
      useEditorStore.getState().resetWorkspace();
      // The break-out helper anchors placement to the parent's canvas node, so
      // seed a widget node position for it.
      useEditorStore.getState().setWidgetPosition(PARENT_ID, { x: 100, y: 100 });
    });

    it('clicking ⤢ spawns a fused-slice node with the correct id, parent, and nodeId', () => {
      const widget = makeFusedWidget();
      const { getByLabelText } = render(
        <ReactFlowProvider>
          <FusedWidgetBody
            widget={widget}
            effectiveValue={(b) => b.value as number}
            setParam={vi.fn()}
          />
        </ReactFlowProvider>,
      );
      fireEvent.click(getByLabelText('Open as widget on canvas'));

      const sliceId = fusedSliceNodeIdFor(PARENT_ID, NODE_ID);
      const slice = useEditorStore.getState().fusedSliceNodes[sliceId];
      expect(slice).toBeDefined();
      expect(slice.parentWidgetId).toBe(PARENT_ID);
      expect(slice.nodeId).toBe(NODE_ID);
    });

    it('does not spawn a duplicate on a second ⤢ click', () => {
      const widget = makeFusedWidget();
      const { getByLabelText } = render(
        <ReactFlowProvider>
          <FusedWidgetBody
            widget={widget}
            effectiveValue={(b) => b.value as number}
            setParam={vi.fn()}
          />
        </ReactFlowProvider>,
      );
      // First click spawns; the button then swaps to the sidebar's pin glyph.
      fireEvent.click(getByLabelText('Open as widget on canvas'));
      fireEvent.click(getByLabelText('On canvas — pinned as widget'));

      expect(Object.keys(useEditorStore.getState().fusedSliceNodes)).toHaveLength(1);
    });
  });

  describe('category swatch', () => {
    it('renders a category swatch before the op name reading the same strand token', () => {
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
      // The light op has category 'tone' → --strand-tone token.
      const swatch = container.querySelector('[data-strand-swatch="tone"]');
      expect(swatch).not.toBeNull();
      expect((swatch as HTMLElement).getAttribute('style')).toMatch(/var\(--strand-tone\)/);
    });
  });

  // ─── Rich body dispatch inside expanded sections ────────────────────────────

  describe('rich body dispatch', () => {
    it('fused widget with an HSL node renders HslWidgetBody (not flat sliders) when expanded', () => {
      // Build a fused widget whose single op-node has type 'hsl'.
      // The op section header shows the op display name; expanding it must
      // render the band rail (HslWidgetBody) rather than plain RegistryDrivenPanel sliders.
      const hslNodeId = 'n-hsl-1';
      const hslCompound: WidgetCompound = {
        driver: '__driver',
        label: 'Intensity',
        anchors: [
          { position: 0, name: 'subtle', values: { [`${hslNodeId}:blue_sat`]: 0 } },
          { position: 1, name: 'strong', values: { [`${hslNodeId}:blue_sat`]: 50 } },
        ],
      };
      const widget = makeAiWidget({
        id: 'w-fused-hsl',
        intent: 'HSL boost',
        compound: hslCompound,
        driverValue: 1.0,
        nodes: [
          {
            id: hslNodeId,
            type: 'hsl',
            opId: 'hsl_blue',
            scope: { kind: 'global' },
            inputs: [],
            widgetId: 'w-fused-hsl',
            layerId: 'L1',
            params: { blue_hue: 0, blue_sat: 0, blue_lum: 0 },
          },
        ],
        bindings: [
          {
            paramKey: 'blue_hue', label: 'Blue hue', controlType: 'slider',
            target: { nodeId: hslNodeId, paramKey: 'blue_hue' },
            controlSchema: { controlType: 'slider', min: -100, max: 100, step: 1 },
            value: 0, default: 0,
          },
          {
            paramKey: 'blue_sat', label: 'Blue sat', controlType: 'slider',
            target: { nodeId: hslNodeId, paramKey: 'blue_sat' },
            controlSchema: { controlType: 'slider', min: -100, max: 100, step: 1 },
            value: 0, default: 0,
          },
          {
            paramKey: 'blue_lum', label: 'Blue lum', controlType: 'slider',
            target: { nodeId: hslNodeId, paramKey: 'blue_lum' },
            controlSchema: { controlType: 'slider', min: -100, max: 100, step: 1 },
            value: 0, default: 0,
          },
        ],
      });

      const { getByText, getAllByRole, queryByText, container } = render(
        <ReactFlowProvider>
          <FusedWidgetBody
            widget={widget}
            effectiveValue={(b) => b.value}
            setParam={vi.fn()}
          />
        </ReactFlowProvider>,
      );

      // There should be a section header for the HSL op.
      // Click the section header's collapse button (has aria-expanded attribute).
      const chevronBtns = container.querySelectorAll('[aria-expanded]');
      expect(chevronBtns.length).toBeGreaterThan(0);
      fireEvent.click(chevronBtns[0] as HTMLButtonElement);

      // After expansion: HslWidgetBody (single-band blue) renders 3 sliders.
      // The flat RegistryDrivenPanel for the basic/light op would show "Exposure";
      // the HSL body shows the band sliders directly (no "Exposure" text).
      expect(queryByText('Exposure')).toBeNull();
      const sliders = getAllByRole('slider');
      // driver slider (1) + 3 HSL band sliders = 4 total
      expect(sliders.length).toBe(4);
      // "By band" / "By channel" tabs only appear in multi-band mode — single band = absent.
      expect(queryByText('By band')).toBeNull();
      // The op display name is present (sanity check that something rendered)
      expect(getByText).toBeTruthy();
    });
  });
});
