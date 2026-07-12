import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/react';
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
});
