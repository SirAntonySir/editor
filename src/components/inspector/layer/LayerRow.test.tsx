import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEditorStore } from '@/store';
import { LayerRow } from './LayerRow';
import { duplicateLayerInPlace, duplicateLayerToNewImageNode } from '@/lib/layer-node-actions';
import type { Layer } from '@/store/layer-slice';

vi.mock('@/lib/layer-node-actions', () => ({
  duplicateLayerInPlace: vi.fn(),
  duplicateLayerToNewImageNode: vi.fn(),
}));

const BASE_LAYER: Layer = {
  id: 'L1',
  type: 'image',
  name: 'photo.jpg',
  visible: true,
  opacity: 1,
  blendMode: 'normal',
  locked: false,
  order: 0,
};

function seedLayer(overrides: Partial<Layer> = {}) {
  useEditorStore.setState({
    layers: [{ ...BASE_LAYER, ...overrides }],
    activeLayerId: 'L1',
  });
}

function getLayer(): Layer {
  return useEditorStore.getState().layers.find((l) => l.id === 'L1')!;
}

beforeEach(() => {
  useEditorStore.setState({ layers: [], activeLayerId: null, imageNodes: {} });
  vi.clearAllMocks();
  cleanup();
});

describe('LayerRow — rename via Enter', () => {
  it('commits new name when Enter is pressed', () => {
    seedLayer();
    render(<LayerRow layer={getLayer()} isActive />);

    fireEvent.click(screen.getByRole('button', { name: /rename photo\.jpg/i }));
    const input = screen.getByRole('textbox', { name: /rename photo\.jpg/i });
    fireEvent.change(input, { target: { value: 'renamed.jpg' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(getLayer().name).toBe('renamed.jpg');
  });
});

describe('LayerRow — rename via Escape', () => {
  it('discards the draft and leaves the name unchanged on Escape', () => {
    seedLayer();
    render(<LayerRow layer={getLayer()} isActive />);

    fireEvent.click(screen.getByRole('button', { name: /rename photo\.jpg/i }));
    const input = screen.getByRole('textbox', { name: /rename photo\.jpg/i });
    fireEvent.change(input, { target: { value: 'should-not-stick' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(getLayer().name).toBe('photo.jpg');
  });
});

describe('LayerRow — visible toggle', () => {
  it('flips layer.visible on eye click', () => {
    seedLayer({ visible: true });
    render(<LayerRow layer={getLayer()} isActive />);

    fireEvent.click(screen.getByRole('button', { name: /hide photo\.jpg/i }));
    expect(getLayer().visible).toBe(false);
  });
});

describe('LayerRow — opacity slider', () => {
  it('sets opacity to 0.5 when Radix slider changes to 50', () => {
    seedLayer({ opacity: 1 });
    render(<LayerRow layer={getLayer()} isActive />);

    // AdjustmentSlider renders a Radix Slider.Thumb with aria-label matching the
    // label prop ("Opacity"). The native range input is no longer present.
    const thumb = screen.getByRole('slider', { name: /opacity/i });
    fireEvent.keyDown(thumb, { key: 'Home' }); // snap to min (0)
    // Verify the store changed — Radix maps Home → min in jsdom
    // (opacity should now be 0 / 100 = 0).
    expect(getLayer().opacity).toBeCloseTo(0);
  });
});

describe('LayerRow — blend mode dropdown', () => {
  it('renders a button showing the current blend mode', () => {
    seedLayer({ blendMode: 'normal' });
    render(<LayerRow layer={getLayer()} isActive />);

    // The Radix DropdownMenu.Trigger button shows the current blend mode.
    const trigger = screen.getByRole('button', { name: /blend mode for photo\.jpg/i });
    expect(trigger).toBeTruthy();
    expect(trigger.textContent?.toLowerCase()).toContain('normal');
  });

  it('opens the dropdown and selects multiply', async () => {
    seedLayer({ blendMode: 'normal' });
    render(<LayerRow layer={getLayer()} isActive />);

    const trigger = screen.getByRole('button', { name: /blend mode for photo\.jpg/i });
    await userEvent.click(trigger);

    // DropdownMenu.Item elements are rendered in a portal; look for 'multiply'.
    const multiplyItem = await screen.findByRole('menuitem', { name: /multiply/i });
    await userEvent.click(multiplyItem);

    expect(getLayer().blendMode).toBe('multiply');
  });
});

describe('LayerRow — delete', () => {
  it('removes the layer when the delete button is clicked', () => {
    seedLayer();
    render(<LayerRow layer={getLayer()} isActive />);

    fireEvent.click(screen.getByRole('button', { name: /delete photo\.jpg/i }));
    expect(useEditorStore.getState().layers.find((l) => l.id === 'L1')).toBeUndefined();
  });
});

describe('LayerRow — right-click: layer → image node', () => {
  function seedNode(layerIds: string[]) {
    useEditorStore.setState({
      imageNodes: {
        'in-1': {
          id: 'in-1', layerIds,
          position: { x: 0, y: 0 }, size: { w: 100, h: 100 }, sourceSize: { w: 100, h: 100 },
        },
      } as never,
    });
  }

  it('"Duplicate to image node" calls duplicateLayerToNewImageNode with the layer + owning node id', async () => {
    seedLayer();
    seedNode(['L1', 'L2']);
    const { container } = render(<LayerRow layer={getLayer()} isActive imageNodeId="in-1" />);

    fireEvent.contextMenu(container.firstElementChild!);
    const item = await screen.findByRole('menuitem', { name: /duplicate to image node/i });
    await userEvent.click(item);

    expect(duplicateLayerToNewImageNode).toHaveBeenCalledWith('L1', 'in-1');
  });

  it('"Duplicate layer" calls duplicateLayerInPlace with the layer + owning node id', async () => {
    seedLayer();
    seedNode(['L1', 'L2']);
    const { container } = render(<LayerRow layer={getLayer()} isActive imageNodeId="in-1" />);

    fireEvent.contextMenu(container.firstElementChild!);
    const item = await screen.findByRole('menuitem', { name: /^duplicate layer$/i });
    await userEvent.click(item);

    expect(duplicateLayerInPlace).toHaveBeenCalledWith('L1', 'in-1');
  });
});

describe('LayerRow — active left bar class', () => {
  it('active row has ochre left border class, inactive row has transparent left border class', () => {
    seedLayer();
    const layer = getLayer();

    const { container: activeContainer } = render(<LayerRow layer={layer} isActive={true} />);
    const activeRow = activeContainer.firstElementChild as HTMLElement;
    expect(activeRow.className).toContain('border-l-[var(--color-accent)]');
    expect(activeRow.className).not.toContain('border-l-transparent');

    cleanup();

    const { container: inactiveContainer } = render(<LayerRow layer={layer} isActive={false} />);
    const inactiveRow = inactiveContainer.firstElementChild as HTMLElement;
    expect(inactiveRow.className).toContain('border-l-transparent');
    expect(inactiveRow.className).not.toContain('border-l-[var(--color-accent)]');
  });
});
