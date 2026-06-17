import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useEditorStore } from '@/store';
import { LayerRow } from './LayerRow';
import type { Layer } from '@/store/layer-slice';

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
  useEditorStore.setState({ layers: [], activeLayerId: null });
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

describe('LayerRow — lock toggle', () => {
  it('flips layer.locked on lock click', () => {
    seedLayer({ locked: false });
    render(<LayerRow layer={getLayer()} isActive />);

    fireEvent.click(screen.getByRole('button', { name: /lock photo\.jpg/i }));
    expect(getLayer().locked).toBe(true);
  });
});

describe('LayerRow — opacity slider', () => {
  it('sets opacity to 0.5 when slider changes to 50', () => {
    seedLayer({ opacity: 1 });
    render(<LayerRow layer={getLayer()} isActive />);

    fireEvent.change(screen.getByRole('slider', { name: /opacity for photo\.jpg/i }), {
      target: { value: '50' },
    });

    expect(getLayer().opacity).toBeCloseTo(0.5);
  });
});

describe('LayerRow — blend mode select', () => {
  it('sets blendMode to multiply when selected', () => {
    seedLayer({ blendMode: 'normal' });
    render(<LayerRow layer={getLayer()} isActive />);

    fireEvent.change(screen.getByRole('combobox', { name: /blend mode for photo\.jpg/i }), {
      target: { value: 'multiply' },
    });

    expect(getLayer().blendMode).toBe('multiply');
  });
});
