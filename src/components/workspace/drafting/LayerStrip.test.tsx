import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';
import { LayerStrip } from './LayerStrip';

// The component takes `layerIds: string[]` directly (not imageNodeId).

const SEED_LAYERS = [
  { id: 'L1', type: 'image' as const, name: 'photo.jpg', visible: true, opacity: 1, blendMode: 'normal' as const, locked: false, order: 0 },
  { id: 'L2', type: 'brush' as const, name: 'paint',     visible: true, opacity: 1, blendMode: 'normal' as const, locked: false, order: 1 },
];

const LAYER_IDS = ['L1', 'L2'];

describe('LayerStrip — click toggles visibility', () => {
  beforeEach(() => {
    useEditorStore.setState({
      layers: SEED_LAYERS,
      activeLayerId: null,
    });
  });

  it('clicking a visible sheet flips visible to false', () => {
    const { getAllByRole } = render(<LayerStrip layerIds={LAYER_IDS} />);
    const sheets = getAllByRole('button');
    // DOM order matches layerIds order: sheets[0] = L1
    fireEvent.click(sheets[0]);
    const after = useEditorStore.getState().layers.find((l) => l.id === 'L1');
    expect(after?.visible).toBe(false);
  });

  it('clicking a hidden sheet flips visible to true', () => {
    useEditorStore.setState({
      layers: SEED_LAYERS.map((l) => l.id === 'L2' ? { ...l, visible: false } : l),
    });
    const { getAllByRole } = render(<LayerStrip layerIds={LAYER_IDS} />);
    const sheets = getAllByRole('button');
    // DOM order: sheets[1] = L2
    fireEvent.click(sheets[1]);
    const after = useEditorStore.getState().layers.find((l) => l.id === 'L2');
    expect(after?.visible).toBe(true);
  });

  it('does not touch activeLayerId', () => {
    const { getAllByRole } = render(<LayerStrip layerIds={LAYER_IDS} />);
    fireEvent.click(getAllByRole('button')[0]);
    expect(useEditorStore.getState().activeLayerId).toBeNull();
  });
});

describe('LayerStrip — right-click context menu', () => {
  beforeEach(() => {
    useEditorStore.setState({
      layers: SEED_LAYERS,
    });
  });

  it('right-click opens a menu with Rename / Blend / Lock / Delete', async () => {
    const { getAllByRole, findByText } = render(<LayerStrip layerIds={['L1', 'L2']} />);
    fireEvent.contextMenu(getAllByRole('button')[0]);
    expect(await findByText(/rename/i)).toBeInTheDocument();
    expect(await findByText(/blend/i)).toBeInTheDocument();
    expect(await findByText(/lock/i)).toBeInTheDocument();
    expect(await findByText(/delete/i)).toBeInTheDocument();
  });

  it('Lock toggles layer.locked', async () => {
    const { getAllByRole, findByText } = render(<LayerStrip layerIds={['L1', 'L2']} />);
    fireEvent.contextMenu(getAllByRole('button')[0]);
    fireEvent.click(await findByText(/^lock$/i));
    const after = useEditorStore.getState().layers.find((l) => l.id === 'L1');
    expect(after?.locked).toBe(true);
  });

  it('Delete removes the layer', async () => {
    const { getAllByRole, findByText } = render(<LayerStrip layerIds={['L1', 'L2']} />);
    fireEvent.contextMenu(getAllByRole('button')[0]);
    fireEvent.click(await findByText(/delete/i));
    expect(useEditorStore.getState().layers.find((l) => l.id === 'L1')).toBeUndefined();
  });
});
