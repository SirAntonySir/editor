import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ImageNodeBody } from './ImageNodeBody';
import { useBackendState } from '@/store/backend-state-slice';

vi.mock('@/hooks/useImageNodeRender', () => ({
  useImageNodeRender: () => ({ canvasRef: { current: null } }),
}));

afterEach(cleanup);

function seedSnapshot(nodes: unknown[]) {
  useBackendState.setState({
    snapshot: {
      revision: 1,
      operation_graph: { id: 'g', user_goal: '', reasoning: null, nodes, panel_bindings: [], metadata: {} },
      masks_index: [], widgets: [], image_context: null,
    } as never,
  });
}

const baseProps = { imageNodeId: 'in-1', layerIds: ['L1'], sourceWidth: 800, sourceHeight: 600 };

describe('ImageNodeBody — CSS transforms', () => {
  it('renders the canvas at source dims and the wrapper at source dims when no transform node is set', () => {
    seedSnapshot([]);
    render(<ImageNodeBody {...baseProps} />);
    const wrapper = document.querySelector('[data-testid="image-node-body"]') as HTMLDivElement;
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    expect(wrapper.style.width).toBe('800px');
    expect(wrapper.style.height).toBe('600px');
    expect(canvas.style.width).toBe('800px');
    expect(canvas.style.height).toBe('600px');
    expect(canvas.style.transform).toContain('translate(-50%, -50%)');
    expect(canvas.style.clipPath).toBe('');
  });

  it('applies rotate(90deg) when a rotate node has angle 90', () => {
    seedSnapshot([{
      id: 'transform:in-1:rotate', type: 'rotate',
      params: { angle: 90, flip_h: false, flip_v: false },
      scope: { kind: 'global' }, inputs: [], layer_id: 'L1', layer_ids: ['L1'], widget_id: null,
    }]);
    render(<ImageNodeBody {...baseProps} />);
    const wrapper = document.querySelector('[data-testid="image-node-body"]') as HTMLDivElement;
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    // Wrapper takes effective dims (swap for 90/270): 800x600 → 600x800.
    expect(wrapper.style.width).toBe('600px');
    expect(wrapper.style.height).toBe('800px');
    // Canvas keeps source dims so the layer composite paints at the correct aspect.
    expect(canvas.style.width).toBe('800px');
    expect(canvas.style.height).toBe('600px');
    // Transform: centring then rotation.
    expect(canvas.style.transform).toContain('translate(-50%, -50%)');
    expect(canvas.style.transform).toContain('rotate(90deg)');
  });

  it('applies scaleX(-1) for flip_h, no rotate', () => {
    seedSnapshot([{
      id: 'transform:in-1:rotate', type: 'rotate',
      params: { angle: 0, flip_h: true, flip_v: false },
      scope: { kind: 'global' }, inputs: [], layer_id: 'L1', layer_ids: ['L1'], widget_id: null,
    }]);
    render(<ImageNodeBody {...baseProps} />);
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    const wrapper = document.querySelector('[data-testid="image-node-body"]') as HTMLDivElement;
    // No rotation → no swap.
    expect(wrapper.style.width).toBe('800px');
    expect(wrapper.style.height).toBe('600px');
    expect(canvas.style.transform).toContain('scaleX(-1)');
    expect(canvas.style.transform).not.toContain('scaleY(-1)');
  });

  it('applies scaleY(-1) for flip_v', () => {
    seedSnapshot([{
      id: 'transform:in-1:rotate', type: 'rotate',
      params: { angle: 0, flip_h: false, flip_v: true },
      scope: { kind: 'global' }, inputs: [], layer_id: 'L1', layer_ids: ['L1'], widget_id: null,
    }]);
    render(<ImageNodeBody {...baseProps} />);
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.style.transform).toContain('scaleY(-1)');
  });

  it('combines rotate, flip_h, flip_v into one transform', () => {
    seedSnapshot([{
      id: 'transform:in-1:rotate', type: 'rotate',
      params: { angle: 180, flip_h: true, flip_v: true },
      scope: { kind: 'global' }, inputs: [], layer_id: 'L1', layer_ids: ['L1'], widget_id: null,
    }]);
    render(<ImageNodeBody {...baseProps} />);
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    const t = canvas.style.transform;
    expect(t).toContain('rotate(180deg)');
    expect(t).toContain('scaleX(-1)');
    expect(t).toContain('scaleY(-1)');
  });

  it('applies clip-path inset when a crop node is present', () => {
    seedSnapshot([{
      id: 'transform:in-1:crop', type: 'crop',
      params: { x: 100, y: 50, w: 600, h: 400 },
      scope: { kind: 'global' }, inputs: [], layer_id: 'L1', layer_ids: ['L1'], widget_id: null,
    }]);
    render(<ImageNodeBody {...baseProps} />);
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    // clip-path inset: top right bottom left
    // top = 50, right = 800 - (100 + 600) = 100, bottom = 600 - (50 + 400) = 150, left = 100
    expect(canvas.style.clipPath).toBe('inset(50px 100px 150px 100px)');
  });

  it('swaps wrapper dims for 270° too', () => {
    seedSnapshot([{
      id: 'transform:in-1:rotate', type: 'rotate',
      params: { angle: 270, flip_h: false, flip_v: false },
      scope: { kind: 'global' }, inputs: [], layer_id: 'L1', layer_ids: ['L1'], widget_id: null,
    }]);
    render(<ImageNodeBody {...baseProps} />);
    const wrapper = document.querySelector('[data-testid="image-node-body"]') as HTMLDivElement;
    expect(wrapper.style.width).toBe('600px');
    expect(wrapper.style.height).toBe('800px');
  });

  it('does NOT swap for 0° or 180°', () => {
    seedSnapshot([{
      id: 'transform:in-1:rotate', type: 'rotate',
      params: { angle: 180, flip_h: false, flip_v: false },
      scope: { kind: 'global' }, inputs: [], layer_id: 'L1', layer_ids: ['L1'], widget_id: null,
    }]);
    render(<ImageNodeBody {...baseProps} />);
    const wrapper = document.querySelector('[data-testid="image-node-body"]') as HTMLDivElement;
    expect(wrapper.style.width).toBe('800px');
    expect(wrapper.style.height).toBe('600px');
  });
});
