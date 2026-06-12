import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const renderImageNodeCompositeMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/image-node-renderer', () => ({
  renderImageNodeComposite: renderImageNodeCompositeMock,
}));

vi.mock('@xyflow/react', () => ({
  useStore: (selector: (s: { transform: [number, number, number] }) => unknown) =>
    selector({ transform: [0, 0, 1] }),
}));

import { useImageNodeRender } from './useImageNodeRender';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import type { Widget } from '@/types/widget';

afterEach(cleanup);

function Consumer({ widgetId: _widgetId }: { widgetId: string }) {
  const { canvasRef } = useImageNodeRender({
    imageNodeId: 'in-1',
    layerIds: ['L1'],
    sourceWidth: 100,
    sourceHeight: 100,
  });
  return <canvas ref={canvasRef} data-testid="c" />;
}

function widgetWithNode(opts: { id: string; nodeId: string; layerId?: string; type?: string }): Widget {
  return {
    id: opts.id,
    intent: 'x',
    scope: { kind: 'global' },
    origin: { kind: 'tool_invoked' },
    composed: true,
    nodes: [
      { id: opts.nodeId, type: opts.type ?? 'basic', params: {}, scope: { kind: 'global' }, inputs: [], widgetId: opts.id, layerId: opts.layerId },
    ],
    bindings: [],
    preview: { kind: 'none', autoBeforeAfter: false },
    rejectedAttempts: [],
    status: 'active',
    revision: 1,
    createdAt: '',
    updatedAt: '',
    lockedParams: [],
  } as Widget;
}

describe('useImageNodeRender · hiddenNodeIds derivation', () => {
  beforeEach(() => {
    renderImageNodeCompositeMock.mockClear();
    const ids = Array.from(useEditorStore.getState().hiddenWidgetIds);
    for (const id of ids) useEditorStore.getState().toggleWidgetHidden(id);
    const cids = Array.from(useEditorStore.getState().hiddenCanonNodeIds);
    for (const id of cids) useEditorStore.getState().toggleCanonNodeHidden(id);
    useBackendState.setState({ snapshot: null });
  });

  it('derives hiddenNodeIds as canon:<layer>:<type> when widget node has layer_id', () => {
    const w = widgetWithNode({ id: 'w1', nodeId: 'n_abc', layerId: 'L1', type: 'basic' });
    useBackendState.setState({
      snapshot: { widgets: [w], operationGraph: { id: 'g', userGoal: '', nodes: [], panelBindings: [], metadata: {} }, masksIndex: [], revision: 1 } as never,
    });
    useEditorStore.getState().toggleWidgetHidden('w1');

    render(<Consumer widgetId="w1" />);

    const calls = renderImageNodeCompositeMock.mock.calls;
    const lastArgs = calls[calls.length - 1][0] as { hiddenNodeIds: Set<string> };
    expect(lastArgs.hiddenNodeIds.has('canon:L1:basic')).toBe(true);
    expect(lastArgs.hiddenNodeIds.has('n_abc')).toBe(false);
  });

  it('falls back to the widget-internal node id when layer_id is undefined', () => {
    const w = widgetWithNode({ id: 'w2', nodeId: 'n_xyz' });
    useBackendState.setState({
      snapshot: { widgets: [w], operationGraph: { id: 'g', userGoal: '', nodes: [], panelBindings: [], metadata: {} }, masksIndex: [], revision: 1 } as never,
    });
    useEditorStore.getState().toggleWidgetHidden('w2');

    render(<Consumer widgetId="w2" />);

    const lastArgs = renderImageNodeCompositeMock.mock.calls.slice(-1)[0][0] as { hiddenNodeIds: Set<string> };
    expect(lastArgs.hiddenNodeIds.has('n_xyz')).toBe(true);
  });

  it('does not add any node ids for widgets that are NOT hidden', () => {
    const w = widgetWithNode({ id: 'w3', nodeId: 'n_def', layerId: 'L1', type: 'kelvin' });
    useBackendState.setState({
      snapshot: { widgets: [w], operationGraph: { id: 'g', userGoal: '', nodes: [], panelBindings: [], metadata: {} }, masksIndex: [], revision: 1 } as never,
    });

    render(<Consumer widgetId="w3" />);

    const lastArgs = renderImageNodeCompositeMock.mock.calls.slice(-1)[0][0] as { hiddenNodeIds: Set<string> };
    expect(lastArgs.hiddenNodeIds.size).toBe(0);
  });

  it('also unions hiddenCanonNodeIds directly into the derived set', () => {
    useBackendState.setState({
      snapshot: { widgets: [], operationGraph: { id: 'g', userGoal: '', nodes: [], panelBindings: [], metadata: {} }, masksIndex: [], revision: 1 } as never,
    });
    useEditorStore.getState().toggleCanonNodeHidden('canon:L9:hsl');

    render(<Consumer widgetId="x" />);

    const lastArgs = renderImageNodeCompositeMock.mock.calls.slice(-1)[0][0] as { hiddenNodeIds: Set<string> };
    expect(lastArgs.hiddenNodeIds.has('canon:L9:hsl')).toBe(true);
  });
});
