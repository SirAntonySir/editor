import { render, cleanup, fireEvent } from '@testing-library/react';
import { it, describe, expect, beforeEach, afterEach } from 'vitest';
import { ImageNodeObjectsLayer } from './ImageNodeObjectsLayer';
import { useBackendState } from '@/store/backend-state-slice';
import { useEditorStore } from '@/store';
import { maskStore } from '@/core/mask-store';
import { objectOwnership } from '@/lib/segmentation/object-ownership';

describe('ImageNodeObjectsLayer stacking', () => {
  const nodeId = 'in_1';

  beforeEach(() => {
    objectOwnership._resetForTests();
    const data = new Uint8Array(16);
    data[5] = 255;
    const maskId = maskStore.register({
      layerId: 'L1', label: 'Sky', width: 4, height: 4, data,
      source: 'sam-point', createdAt: 0,
    });
    objectOwnership.set(maskId, nodeId);
    useBackendState.setState({
      snapshot: {
        sessionId: 's1', imageContext: null, widgets: [],
        masksIndex: [{ id: maskId, label: 'Sky', imageNodeId: nodeId }],
        operationGraph: { id: 'g', userGoal: '', nodes: [], panelBindings: [], metadata: {} },
        revision: 1,
      } as never,
    } as never);
    useEditorStore.setState({ hoveredObjectId: null } as never);
  });
  afterEach(() => cleanup());

  it('sits BELOW SegmentHitLayer (z=5) so the cursor tooltip renders above the mask', () => {
    // Regression: at zIndex 6 the mask canvas covered the hover tooltip
    // (which lives inside SegmentHitLayer's z=5 stacking context).
    const { getByTestId } = render(
      <ImageNodeObjectsLayer imageNodeId={nodeId} widthPx={200} heightPx={200} hideLabels />,
    );
    const z = Number(getByTestId('image-node-objects-layer').style.zIndex);
    expect(z).toBeLessThan(5);
  });

  it('opening the object context menu records contextMenuObjectId; closing clears it', () => {
    // The mask paints while hovered OR while its menu is open
    // (objectsToPaint) — right-clicking moves the pointer onto the menu,
    // which clears hover, and the mask must not vanish mid-menu.
    const { container } = render(
      <ImageNodeObjectsLayer imageNodeId={nodeId} widthPx={200} heightPx={200} hideLabels />,
    );
    const trigger = container.querySelector('[data-object-id]')!;
    expect(trigger).not.toBeNull();
    fireEvent.contextMenu(trigger);
    const openedId = useEditorStore.getState().contextMenuObjectId;
    expect(openedId).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useEditorStore.getState().contextMenuObjectId).toBeNull();
  });
});
