import { render as rtlRender, fireEvent } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';
import { usePreferencesStore } from '@/store/preferences-store';
import { LayerStrip } from './LayerStrip';

// The component takes `layerIds: string[]` directly (not imageNodeId).
// LayerStrip renders React Flow <Handle>s (per-layer tether ports), which need
// a ReactFlowProvider ancestor — in the app it's always inside the canvas.
const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: ReactFlowProvider });

const SEED_LAYERS = [
  { id: 'L1', type: 'image' as const, name: 'photo.jpg', visible: true, opacity: 1, blendMode: 'normal' as const, locked: false, order: 0 },
  { id: 'L2', type: 'brush' as const, name: 'paint',     visible: true, opacity: 1, blendMode: 'normal' as const, locked: false, order: 1 },
];

const LAYER_IDS = ['L1', 'L2'];

describe('LayerStrip — sheet selects active, eye toggles visibility', () => {
  beforeEach(() => {
    useEditorStore.setState({
      layers: SEED_LAYERS,
      activeLayerId: null,
    });
  });

  it('clicking a sheet sets it as the active edit layer', () => {
    const { getAllByRole } = render(<LayerStrip imageNodeId="n1" layerIds={LAYER_IDS} />);
    const sheets = getAllByRole('button', { name: /select layer/i });
    fireEvent.click(sheets[0]); // L1
    expect(useEditorStore.getState().activeLayerId).toBe('L1');
  });

  it('clicking a sheet also focuses the strip’s image node', () => {
    useEditorStore.setState({ layers: SEED_LAYERS, activeLayerId: null, activeImageNodeId: null });
    const { getAllByRole } = render(<LayerStrip imageNodeId="n1" layerIds={LAYER_IDS} />);
    fireEvent.click(getAllByRole('button', { name: /select layer/i })[0]);
    expect(useEditorStore.getState().activeImageNodeId).toBe('n1');
  });

  it('clicking a sheet does not change visibility', () => {
    const { getAllByRole } = render(<LayerStrip imageNodeId="n1" layerIds={LAYER_IDS} />);
    fireEvent.click(getAllByRole('button', { name: /select layer/i })[0]);
    expect(useEditorStore.getState().layers.find((l) => l.id === 'L1')?.visible).toBe(true);
  });

  it('clicking the eye toggles visibility without changing the active layer', () => {
    const { getAllByRole } = render(<LayerStrip imageNodeId="n1" layerIds={LAYER_IDS} />);
    const eyes = getAllByRole('button', { name: /hide layer|show layer/i });
    fireEvent.click(eyes[0]); // L1 visible -> false
    expect(useEditorStore.getState().layers.find((l) => l.id === 'L1')?.visible).toBe(false);
    expect(useEditorStore.getState().activeLayerId).toBeNull();
  });

  it('renders one tether port (handle) per layer, id encoding the layer', () => {
    const { container } = render(<LayerStrip imageNodeId="n1" layerIds={LAYER_IDS} />);
    const ports = container.querySelectorAll('[data-handleid^="layer-tether-"]');
    expect(ports).toHaveLength(2);
    expect(container.querySelector('[data-handleid="layer-tether-L1"]')).not.toBeNull();
    expect(container.querySelector('[data-handleid="layer-tether-L2"]')).not.toBeNull();
  });

  it('marks the active layer sheet with data-active', () => {
    useEditorStore.setState({ layers: SEED_LAYERS, activeLayerId: 'L2' });
    const { getAllByRole } = render(<LayerStrip imageNodeId="n1" layerIds={LAYER_IDS} />);
    const sheets = getAllByRole('button', { name: /select layer/i });
    expect(sheets[0].hasAttribute('data-active')).toBe(false); // L1
    expect(sheets[1].hasAttribute('data-active')).toBe(true);  // L2
  });
});

describe('LayerStrip — right-click context menu', () => {
  beforeEach(() => {
    useEditorStore.setState({
      layers: SEED_LAYERS,
    });
  });

  it('right-click opens a menu with Rename / Blend / Lock / Delete', async () => {
    const { getAllByRole, findByText } = render(<LayerStrip imageNodeId="n1" layerIds={['L1', 'L2']} />);
    fireEvent.contextMenu(getAllByRole('button', { name: /select layer/i })[0]);
    expect(await findByText(/rename/i)).toBeInTheDocument();
    expect(await findByText(/blend/i)).toBeInTheDocument();
    expect(await findByText(/lock/i)).toBeInTheDocument();
    expect(await findByText(/delete/i)).toBeInTheDocument();
  });

  it('Lock toggles layer.locked', async () => {
    const { getAllByRole, findByText } = render(<LayerStrip imageNodeId="n1" layerIds={['L1', 'L2']} />);
    fireEvent.contextMenu(getAllByRole('button', { name: /select layer/i })[0]);
    fireEvent.click(await findByText(/^lock$/i));
    const after = useEditorStore.getState().layers.find((l) => l.id === 'L1');
    expect(after?.locked).toBe(true);
  });

  it('Delete removes the layer', async () => {
    const { getAllByRole, findByText } = render(<LayerStrip imageNodeId="n1" layerIds={['L1', 'L2']} />);
    fireEvent.contextMenu(getAllByRole('button', { name: /select layer/i })[0]);
    fireEvent.click(await findByText(/delete/i));
    expect(useEditorStore.getState().layers.find((l) => l.id === 'L1')).toBeUndefined();
  });

  it('Move to own image node moves the layer off the source (not a copy)', async () => {
    const nodeId = useEditorStore.getState().addImageNode(['L1', 'L2']);
    const { getAllByRole, findByText } = render(<LayerStrip imageNodeId={nodeId} layerIds={['L1', 'L2']} />);
    fireEvent.contextMenu(getAllByRole('button', { name: /select layer/i })[0]); // L1
    fireEvent.click(await findByText(/move to own image node/i));

    const st = useEditorStore.getState();
    // Source node lost L1; a new node gained it.
    expect(st.imageNodes[nodeId].layerIds).not.toContain('L1');
    const withL1 = Object.values(st.imageNodes).filter((n) => n.layerIds.includes('L1'));
    expect(withL1.length).toBe(1); // moved, not copied — L1 lives in exactly one node
    expect(withL1[0].id).not.toBe(nodeId);
  });

  it('Move to own image node is hidden when the node has a single layer', () => {
    const nodeId = useEditorStore.getState().addImageNode(['L1']);
    const { getAllByRole, queryByText } = render(<LayerStrip imageNodeId={nodeId} layerIds={['L1']} />);
    fireEvent.contextMenu(getAllByRole('button', { name: /select layer/i })[0]);
    expect(queryByText(/move to own image node/i)).toBeNull();
  });

  it('Rename triggers requestRenameLayer, sets activeLayerId, and switches Inspector to Layer tab', async () => {
    const { getAllByRole, findByText } = render(<LayerStrip imageNodeId="n1" layerIds={['L1', 'L2']} />);
    fireEvent.contextMenu(getAllByRole('button', { name: /select layer/i })[0]);
    fireEvent.click(await findByText(/rename/i));
    expect(useEditorStore.getState().renamingLayerId).toBe('L1');
    expect(useEditorStore.getState().activeLayerId).toBe('L1');
    expect(usePreferencesStore.getState().inspectorTab).toBe('layer');
  });
});
