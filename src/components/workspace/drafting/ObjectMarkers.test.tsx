import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { it, describe, expect, beforeEach, afterEach } from 'vitest';
import { ReactFlowProvider } from '@xyflow/react';
import { ObjectMarkers } from './ObjectMarkers';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { maskStore } from '@/core/mask-store';
import { objectOwnership } from '@/lib/segmentation/object-ownership';

// Repro: clicking a margin object marker must set activeObjectId so the
// adjustment "Target" tracks it.
describe('ObjectMarker click selects the object (repro)', () => {
  let maskId: string;
  const nodeId = 'in_1';

  beforeEach(() => {
    objectOwnership._resetForTests();
    const data = new Uint8Array(16);
    data[5] = 255;
    maskId = maskStore.register({
      layerId: 'L1', label: 'Sky', width: 4, height: 4, data,
      source: 'sam-point', createdAt: 0,
    });
    objectOwnership.set(maskId, nodeId);
    useBackendState.setState({
      sessionId: 's1', sseStatus: 'open', optimistic: new Map(),
      snapshot: {
        sessionId: 's1', imageContext: null, widgets: [],
        masksIndex: [{ id: maskId, label: 'Sky', imageNodeId: nodeId }],
        operationGraph: { id: 'g', userGoal: '', nodes: [], panelBindings: [], metadata: {} },
        revision: 1,
      } as never,
    } as never);
    useEditorStore.setState({
      activeObjectId: null, activeImageNodeId: null, activeLayerId: 'L1',
    } as never);
  });
  afterEach(() => cleanup());

  it('sets activeObjectId + activeImageNodeId on click', () => {
    render(
      <ReactFlowProvider>
        <ObjectMarkers imageNodeId={nodeId} widthPx={200} heightPx={200} marginWidth={80} />
      </ReactFlowProvider>,
    );
    const label = screen.getByText('Sky');
    fireEvent.click(label);
    expect(useEditorStore.getState().activeObjectId).toBe(maskId);
    expect(useEditorStore.getState().activeImageNodeId).toBe(nodeId);
  });

  it('marks the clickable marker nodrag/nopan so React Flow does not eat the click', () => {
    const { container } = render(
      <ReactFlowProvider>
        <ObjectMarkers imageNodeId={nodeId} widthPx={200} heightPx={200} marginWidth={80} />
      </ReactFlowProvider>,
    );
    const marker = container.querySelector(`[data-object-marker="${maskId}"]`);
    expect(marker).not.toBeNull();
    expect(marker?.classList.contains('nodrag')).toBe(true);
    expect(marker?.classList.contains('nopan')).toBe(true);
  });
});
