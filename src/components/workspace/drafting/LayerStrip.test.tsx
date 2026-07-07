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

  it('right-click opens a menu with Rename / Blend / Delete', async () => {
    const { getAllByRole, findByText } = render(<LayerStrip imageNodeId="n1" layerIds={['L1', 'L2']} />);
    fireEvent.contextMenu(getAllByRole('button', { name: /select layer/i })[0]);
    expect(await findByText(/rename/i)).toBeInTheDocument();
    expect(await findByText(/blend/i)).toBeInTheDocument();
    expect(await findByText(/delete/i)).toBeInTheDocument();
  });

  it('does not offer a Lock item (removed — non-functional)', async () => {
    const { getAllByRole, findByText, queryByText } = render(<LayerStrip imageNodeId="n1" layerIds={['L1', 'L2']} />);
    fireEvent.contextMenu(getAllByRole('button', { name: /select layer/i })[0]);
    await findByText(/rename/i); // menu is open
    expect(queryByText(/^lock$/i)).toBeNull();
    expect(queryByText(/^unlock$/i)).toBeNull();
  });

  it('Delete removes the layer', async () => {
    const { getAllByRole, findByText } = render(<LayerStrip imageNodeId="n1" layerIds={['L1', 'L2']} />);
    fireEvent.contextMenu(getAllByRole('button', { name: /select layer/i })[0]);
    fireEvent.click(await findByText(/delete/i));
    expect(useEditorStore.getState().layers.find((l) => l.id === 'L1')).toBeUndefined();
  });

  it('Duplicate to image node keeps the source layer and spawns a new node (non-destructive)', async () => {
    const nodeId = useEditorStore.getState().addImageNode(['L1', 'L2']);
    const nodesBefore = Object.keys(useEditorStore.getState().imageNodes).length;
    const { getAllByRole, findByText } = render(<LayerStrip imageNodeId={nodeId} layerIds={['L1', 'L2']} />);
    fireEvent.contextMenu(getAllByRole('button', { name: /select layer/i })[0]); // L1
    fireEvent.click(await findByText(/duplicate to image node/i));

    const st = useEditorStore.getState();
    // Source node still owns L1 (a COPY was made, not a move).
    expect(st.imageNodes[nodeId].layerIds).toContain('L1');
    // A new image node was created.
    expect(Object.keys(st.imageNodes).length).toBe(nodesBefore + 1);
  });

  it('Duplicate to image node is available even on a single-layer node (non-destructive)', async () => {
    const nodeId = useEditorStore.getState().addImageNode(['L1']);
    const { getAllByRole, findByText } = render(<LayerStrip imageNodeId={nodeId} layerIds={['L1']} />);
    fireEvent.contextMenu(getAllByRole('button', { name: /select layer/i })[0]);
    expect(await findByText(/duplicate to image node/i)).toBeTruthy();
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
