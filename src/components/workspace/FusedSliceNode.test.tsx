import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, fireEvent, act } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { FusedSliceNode } from './FusedSliceNode';
import { useEditorStore } from '@/store';
import type { Widget, WidgetCompound } from '@/types/widget';
import { makeAiWidget } from '@/components/widget/__fixtures__/widgets';
import { backendTools } from '@/lib/backend-tools';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    set_widget_param: vi.fn(),
    unlock_widget_param: vi.fn(),
    detach_widget_op: vi.fn(),
  },
}));

const mockApplyOptimistic = vi.fn();

// Mutable snapshot widget list so tests can drop the parent widget.
let snapshotWidgets: Widget[] = [];

vi.mock('@/store/backend-state-slice', async () => {
  const actual = await vi.importActual<typeof import('@/store/backend-state-slice')>('@/store/backend-state-slice');
  const buildState = () => ({
    sessionId: 's-1',
    optimistic: new Map(),
    snapshot: { masksIndex: [], revision: 1, widgets: snapshotWidgets, operationGraph: { nodes: [] } },
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

const NODE_ID = 'n-basic-1';
const NODE_ID_2 = 'n-basic-2';
const PARENT_ID = 'w-fused-1';

function makeFusedWidget(overrides: Partial<Widget> = {}): Widget {
  const compound: WidgetCompound = {
    driver: '__driver',
    label: 'Intensity',
    anchors: [
      { position: 0, name: 'subtle', values: { [`${NODE_ID}:exposure`]: 10 } },
      { position: 1, name: 'strong', values: { [`${NODE_ID}:exposure`]: 60 } },
    ],
  };
  return makeAiWidget({
    id: PARENT_ID,
    intent: 'Brighten sky',
    displayName: 'Make it black',
    opId: 'light',
    compound,
    driverValue: 1.0,
    nodes: [
      {
        id: NODE_ID,
        type: 'basic',
        opId: 'light',
        scope: { kind: 'global' },
        inputs: [],
        widgetId: PARENT_ID,
        layerId: 'L1',
        params: { exposure: 0 },
      },
    ],
    bindings: [
      {
        paramKey: 'exposure',
        label: 'Exposure',
        controlType: 'slider',
        target: { nodeId: NODE_ID, paramKey: 'exposure' },
        controlSchema: { controlType: 'slider', min: -100, max: 100, step: 1 },
        value: 60,
        default: 0,
      },
    ],
    ...overrides,
  });
}

/** A parent widget with two nodes (multi-node scenario for detach test). */
function makeFusedWidgetMultiNode(overrides: Partial<Widget> = {}): Widget {
  return makeFusedWidget({
    nodes: [
      {
        id: NODE_ID,
        type: 'basic',
        opId: 'light',
        scope: { kind: 'global' },
        inputs: [],
        widgetId: PARENT_ID,
        layerId: 'L1',
        params: { exposure: 0 },
      },
      {
        id: NODE_ID_2,
        type: 'basic',
        opId: 'color',
        scope: { kind: 'global' },
        inputs: [],
        widgetId: PARENT_ID,
        layerId: 'L1',
        params: { saturation: 0 },
      },
    ],
    ...overrides,
  });
}

function renderSlice(sliceId: string) {
  return render(
    <ReactFlowProvider>
      <FusedSliceNode data={{ sliceId }} selected={false} />
    </ReactFlowProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.getState().resetWorkspace();
  snapshotWidgets = [makeFusedWidget()];
});

describe('FusedSliceNode', () => {
  it('renders the parent op controls and the "from …" provenance line', () => {
    const sliceId = useEditorStore.getState().addFusedSliceNode(PARENT_ID, NODE_ID, { x: 0, y: 0 });
    const { getByText } = renderSlice(sliceId);
    // Op display name (from the real registry) + parent provenance.
    expect(getByText('Light')).toBeTruthy();
    expect(getByText(/from/i)).toBeTruthy();
    expect(getByText(/Make it black/)).toBeTruthy();
    // The op's real control (Exposure) is rendered unconditionally (satellite
    // shows the op panel directly — no collapse).
    expect(getByText('Exposure')).toBeTruthy();
  });

  it('routes an edit to set_widget_param with the PARENT widget id', () => {
    vi.useFakeTimers();
    const sliceId = useEditorStore.getState().addFusedSliceNode(PARENT_ID, NODE_ID, { x: 0, y: 0 });
    const { getByRole } = renderSlice(sliceId);
    const slider = getByRole('slider', { name: /exposure/i });
    fireEvent.keyDown(slider, { key: 'End', code: 'End' });
    vi.runAllTimers();
    expect(backendTools.set_widget_param).toHaveBeenCalledWith(
      's-1',
      expect.objectContaining({ widgetId: PARENT_ID, paramKey: 'exposure' }),
    );
    vi.useRealTimers();
  });

  it('close button removes the slice node from the store', () => {
    const sliceId = useEditorStore.getState().addFusedSliceNode(PARENT_ID, NODE_ID, { x: 0, y: 0 });
    const { getByLabelText } = renderSlice(sliceId);
    expect(useEditorStore.getState().fusedSliceNodes[sliceId]).toBeDefined();
    fireEvent.click(getByLabelText('Close projection'));
    expect(useEditorStore.getState().fusedSliceNodes[sliceId]).toBeUndefined();
  });

  it('renders nothing and self-prunes when the parent widget is gone', () => {
    const sliceId = useEditorStore.getState().addFusedSliceNode(PARENT_ID, NODE_ID, { x: 0, y: 0 });
    snapshotWidgets = []; // parent dismissed
    const { container } = renderSlice(sliceId);
    // No card rendered.
    expect(container.querySelector('.overlay')).toBeNull();
    // And the store entry is pruned.
    expect(useEditorStore.getState().fusedSliceNodes[sliceId]).toBeUndefined();
  });

  it('renders nothing when the op-node is gone (e.g. detached)', () => {
    // Parent present but its node array no longer contains NODE_ID.
    snapshotWidgets = [makeFusedWidget({ nodes: [], bindings: [] })];
    const sliceId = useEditorStore.getState().addFusedSliceNode(PARENT_ID, NODE_ID, { x: 0, y: 0 });
    const { container } = renderSlice(sliceId);
    expect(container.querySelector('.overlay')).toBeNull();
    expect(useEditorStore.getState().fusedSliceNodes[sliceId]).toBeUndefined();
  });

  it('shows the pin release affordance for a pinned param', () => {
    snapshotWidgets = [makeFusedWidget({ lockedParams: ['exposure'] })];
    const sliceId = useEditorStore.getState().addFusedSliceNode(PARENT_ID, NODE_ID, { x: 0, y: 0 });
    const { getByTitle } = renderSlice(sliceId);
    expect(getByTitle('Pinned — click to release')).toBeTruthy();
  });

  // ─── DetachButton tests ─────────────────────────────────────────────────────

  describe('DetachButton — armed/confirm flow', () => {
    it('first click arms the button (aria-label changes to confirm)', () => {
      // Multi-node parent so detach is enabled.
      snapshotWidgets = [makeFusedWidgetMultiNode()];
      const sliceId = useEditorStore.getState().addFusedSliceNode(PARENT_ID, NODE_ID, { x: 0, y: 0 });
      const { getByLabelText } = renderSlice(sliceId);

      const detachBtn = getByLabelText('Detach from intent');
      fireEvent.click(detachBtn);

      // After first click the button is armed → aria-label updates.
      expect(getByLabelText('Confirm detach from intent')).toBeTruthy();
      // No backend call yet.
      expect(backendTools.detach_widget_op).not.toHaveBeenCalled();
    });

    it('second click calls detach_widget_op with correct parentWidgetId + nodeId', async () => {
      vi.mocked(backendTools.detach_widget_op).mockResolvedValue({
        ok: true,
        output: { widget: makeFusedWidgetMultiNode(), parent: makeFusedWidgetMultiNode() },
      });

      snapshotWidgets = [makeFusedWidgetMultiNode()];
      const sliceId = useEditorStore.getState().addFusedSliceNode(PARENT_ID, NODE_ID, { x: 0, y: 0 });
      const { getByLabelText } = renderSlice(sliceId);

      // Arm.
      fireEvent.click(getByLabelText('Detach from intent'));
      // Confirm.
      await act(async () => {
        fireEvent.click(getByLabelText('Confirm detach from intent'));
      });

      expect(backendTools.detach_widget_op).toHaveBeenCalledWith('s-1', {
        widgetId: PARENT_ID,
        nodeId: NODE_ID,
      });
    });

    it('on success: removeFusedSliceNode is called to close the satellite', async () => {
      vi.mocked(backendTools.detach_widget_op).mockResolvedValue({
        ok: true,
        output: { widget: makeFusedWidgetMultiNode(), parent: makeFusedWidgetMultiNode() },
      });

      snapshotWidgets = [makeFusedWidgetMultiNode()];
      const sliceId = useEditorStore.getState().addFusedSliceNode(PARENT_ID, NODE_ID, { x: 0, y: 0 });
      expect(useEditorStore.getState().fusedSliceNodes[sliceId]).toBeDefined();

      const { getByLabelText } = renderSlice(sliceId);
      fireEvent.click(getByLabelText('Detach from intent'));
      await act(async () => {
        fireEvent.click(getByLabelText('Confirm detach from intent'));
      });

      expect(useEditorStore.getState().fusedSliceNodes[sliceId]).toBeUndefined();
    });

    it('auto-resets armed state after timeout without confirming', () => {
      vi.useFakeTimers();
      snapshotWidgets = [makeFusedWidgetMultiNode()];
      const sliceId = useEditorStore.getState().addFusedSliceNode(PARENT_ID, NODE_ID, { x: 0, y: 0 });
      const { getByLabelText } = renderSlice(sliceId);

      fireEvent.click(getByLabelText('Detach from intent'));
      expect(getByLabelText('Confirm detach from intent')).toBeTruthy();

      // Advance past DETACH_REARM_MS (3000ms).
      act(() => { vi.advanceTimersByTime(3100); });

      // Should be back to initial label.
      expect(getByLabelText('Detach from intent')).toBeTruthy();
      expect(backendTools.detach_widget_op).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  describe('DetachButton — single-node guard', () => {
    it('is disabled when the parent has only one node', () => {
      // Default makeFusedWidget has 1 node.
      snapshotWidgets = [makeFusedWidget()];
      const sliceId = useEditorStore.getState().addFusedSliceNode(PARENT_ID, NODE_ID, { x: 0, y: 0 });
      const { getByTitle } = renderSlice(sliceId);

      const btn = getByTitle('Only adjustment — dismiss the widget instead');
      expect(btn).toBeTruthy();
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    });

    it('clicking disabled button does not arm or call backend', () => {
      snapshotWidgets = [makeFusedWidget()];
      const sliceId = useEditorStore.getState().addFusedSliceNode(PARENT_ID, NODE_ID, { x: 0, y: 0 });
      const { getByTitle } = renderSlice(sliceId);

      const btn = getByTitle('Only adjustment — dismiss the widget instead');
      fireEvent.click(btn);
      expect(backendTools.detach_widget_op).not.toHaveBeenCalled();
    });
  });

  // ─── Rich body dispatch in satellites ─────────────────────────────────────

  describe('rich body dispatch — HSL satellite', () => {
    const HSL_NODE_ID = 'n-hsl-sat';

    function makeFusedHslWidget(): Widget {
      const compound: WidgetCompound = {
        driver: '__driver',
        label: 'Intensity',
        anchors: [
          { position: 0, name: 'subtle', values: { [`${HSL_NODE_ID}:blue_sat`]: 0 } },
          { position: 1, name: 'strong', values: { [`${HSL_NODE_ID}:blue_sat`]: 50 } },
        ],
      };
      return makeAiWidget({
        id: PARENT_ID,
        intent: 'HSL boost',
        compound,
        driverValue: 1.0,
        nodes: [
          {
            id: HSL_NODE_ID,
            type: 'hsl',
            opId: 'hsl_blue',
            scope: { kind: 'global' },
            inputs: [],
            widgetId: PARENT_ID,
            layerId: 'L1',
            params: { blue_hue: 0, blue_sat: 0, blue_lum: 0 },
          },
        ],
        bindings: [
          {
            paramKey: 'blue_hue', label: 'Blue hue', controlType: 'slider',
            target: { nodeId: HSL_NODE_ID, paramKey: 'blue_hue' },
            controlSchema: { controlType: 'slider', min: -100, max: 100, step: 1 },
            value: 0, default: 0,
          },
          {
            paramKey: 'blue_sat', label: 'Blue sat', controlType: 'slider',
            target: { nodeId: HSL_NODE_ID, paramKey: 'blue_sat' },
            controlSchema: { controlType: 'slider', min: -100, max: 100, step: 1 },
            value: 0, default: 0,
          },
          {
            paramKey: 'blue_lum', label: 'Blue lum', controlType: 'slider',
            target: { nodeId: HSL_NODE_ID, paramKey: 'blue_lum' },
            controlSchema: { controlType: 'slider', min: -100, max: 100, step: 1 },
            value: 0, default: 0,
          },
        ],
      });
    }

    beforeEach(() => {
      snapshotWidgets = [makeFusedHslWidget()];
    });

    it('satellite of an HSL node renders the HSL band rail (3 sliders)', () => {
      const sliceId = useEditorStore.getState().addFusedSliceNode(PARENT_ID, HSL_NODE_ID, { x: 0, y: 0 });
      const { getAllByRole, queryByText } = renderSlice(sliceId);

      // HslWidgetBody single-band mode: 3 sliders (hue/sat/lum), no "By band" tabs.
      expect(getAllByRole('slider').length).toBe(3);
      expect(queryByText('By band')).toBeNull();
      // No flat "Exposure" label from RegistryDrivenPanel.
      expect(queryByText('Exposure')).toBeNull();
    });

    it('an HSL slider edit in the satellite routes set_widget_param to the PARENT widget id', () => {
      vi.useFakeTimers();
      const sliceId = useEditorStore.getState().addFusedSliceNode(PARENT_ID, HSL_NODE_ID, { x: 0, y: 0 });
      const { getAllByRole } = renderSlice(sliceId);

      // Drive the first slider (blue_hue) to max via keyboard.
      const sliders = getAllByRole('slider');
      expect(sliders.length).toBe(3);
      fireEvent.keyDown(sliders[0], { key: 'End', code: 'End' });
      vi.runAllTimers();

      // Must route to the PARENT widget id, not the node id or the satellite.
      expect(backendTools.set_widget_param).toHaveBeenCalledWith(
        's-1',
        expect.objectContaining({ widgetId: PARENT_ID }),
      );
      vi.useRealTimers();
    });
  });
});
