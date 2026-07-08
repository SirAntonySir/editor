import { render, cleanup, fireEvent } from '@testing-library/react';
import { it, describe, expect, beforeEach, afterEach } from 'vitest';
import { ReactFlowProvider } from '@xyflow/react';
import { ObjectMarkers } from './ObjectMarkers';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';
import { maskStore } from '@/core/mask-store';
import { objectOwnership } from '@/lib/segmentation/object-ownership';
import { renameObject } from '@/lib/segmentation/object-actions';
import { vi } from 'vitest';

vi.mock('@/lib/segmentation/object-actions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/segmentation/object-actions')>()),
  renameObject: vi.fn(async () => {}),
}));

// The gutter markers were removed (2026-07-08 hover-only-mask-overlay spec +
// follow-up): objects have no persistent visual presence — masks show on
// hover, the name lives in the cursor tooltip. This surface now exists ONLY
// as the transient inline-rename input (context-menu Rename →
// pendingObjectRenameId), collapsing to nothing otherwise.
describe('ObjectMarkers — transient rename-only surface', () => {
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
      pendingObjectRenameId: null,
    } as never);
  });
  afterEach(() => cleanup());

  it('renders nothing when no rename is pending — no dots, no numbers, no names', () => {
    const { container } = render(
      <ReactFlowProvider>
        <ObjectMarkers imageNodeId={nodeId} widthPx={200} heightPx={200} marginWidth={80} />
      </ReactFlowProvider>,
    );
    expect(container.querySelector('[data-testid="object-markers"]')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('mounts the inline rename input while pendingObjectRenameId targets an object of this node', () => {
    useEditorStore.setState({ pendingObjectRenameId: maskId } as never);
    const { container } = render(
      <ReactFlowProvider>
        <ObjectMarkers imageNodeId={nodeId} widthPx={200} heightPx={200} marginWidth={80} />
      </ReactFlowProvider>,
    );
    const input = container.querySelector('input');
    expect(input).not.toBeNull();
    expect((input as HTMLInputElement).value).toBe('Sky');
  });

  it('Enter commits the rename and collapses the surface', () => {
    useEditorStore.setState({ pendingObjectRenameId: maskId } as never);
    const { container } = render(
      <ReactFlowProvider>
        <ObjectMarkers imageNodeId={nodeId} widthPx={200} heightPx={200} marginWidth={80} />
      </ReactFlowProvider>,
    );
    const input = container.querySelector('input')! as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Beer can' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(renameObject).toHaveBeenCalledWith(maskId, 'Beer can');
    expect(container.querySelector('input')).toBeNull();
  });
});
