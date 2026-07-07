import { render as rtlRender } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';
import { LayerNode } from './LayerNode';

// LayerNode renders LayerStrip (React Flow <Handle>s) + its own outlets, so it
// needs a ReactFlowProvider ancestor — in the app it's always inside the canvas.
const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: ReactFlowProvider });

const SEED_LAYERS = [
  { id: 'L1', type: 'image' as const, name: 'photo.jpg', visible: true, opacity: 1, blendMode: 'normal' as const, locked: false, order: 0 },
  { id: 'L2', type: 'brush' as const, name: 'paint',     visible: true, opacity: 1, blendMode: 'normal' as const, locked: false, order: 1 },
];

describe('LayerNode', () => {
  beforeEach(() => {
    useEditorStore.getState().resetWorkspace();
    useEditorStore.setState({ layers: SEED_LAYERS, activeLayerId: null });
  });

  it('renders the layer strip for its image node’s layers', () => {
    useEditorStore.setState({
      imageNodes: {
        'in-1': { id: 'in-1', layerIds: ['L1', 'L2'], position: { x: 0, y: 0 }, sourceSize: { w: 10, h: 10 }, size: { w: 10, h: 10 } },
      },
    } as never);
    const { getByTestId, container } = render(<LayerNode id="layers-in-1" data={{ imageNodeId: 'in-1' }} />);
    expect(getByTestId('layer-strip')).toBeInTheDocument();
    // Per-layer tether target ports come from the strip.
    expect(container.querySelector('[data-handleid="layer-tether-L1"]')).not.toBeNull();
    // Four attribution source outlets belong to the node itself.
    expect(container.querySelector('[data-handleid="tether-out-left"]')).not.toBeNull();
  });

  it('renders nothing when its image node is gone', () => {
    const { queryByTestId } = render(<LayerNode id="layers-missing" data={{ imageNodeId: 'missing' }} />);
    expect(queryByTestId('layer-strip')).not.toBeInTheDocument();
  });

  it('reads layerIds live from the store (not a frozen prop)', () => {
    useEditorStore.setState({
      imageNodes: {
        'in-1': { id: 'in-1', layerIds: ['L1'], position: { x: 0, y: 0 }, sourceSize: { w: 10, h: 10 }, size: { w: 10, h: 10 } },
      },
    } as never);
    const { container, rerender } = render(<LayerNode id="layers-in-1" data={{ imageNodeId: 'in-1' }} />);
    expect(container.querySelectorAll('[data-handleid^="layer-tether-"]')).toHaveLength(1);
    // Add a layer to the image node → the strip picks it up without a prop change.
    useEditorStore.setState({
      imageNodes: {
        'in-1': { id: 'in-1', layerIds: ['L1', 'L2'], position: { x: 0, y: 0 }, sourceSize: { w: 10, h: 10 }, size: { w: 10, h: 10 } },
      },
    } as never);
    rerender(<ReactFlowProvider><LayerNode id="layers-in-1" data={{ imageNodeId: 'in-1' }} /></ReactFlowProvider>);
    expect(container.querySelectorAll('[data-handleid^="layer-tether-"]')).toHaveLength(2);
  });
});
