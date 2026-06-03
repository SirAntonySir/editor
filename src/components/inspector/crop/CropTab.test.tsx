import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CropTab } from './CropTab';
import { useEditorStore } from '@/store';
import { useBackendState } from '@/store/backend-state-slice';

afterEach(cleanup);

// CanvasRegistry mock — return a small dummy canvas as the layer source.
vi.mock('@/lib/canvas-registry', () => {
  const sources = new Map<string, HTMLCanvasElement>();
  return {
    CanvasRegistry: {
      get: (id: string) => {
        if (!sources.has(id)) {
          const c = document.createElement('canvas');
          c.width = 800;
          c.height = 600;
          sources.set(id, c);
        }
        return sources.get(id);
      },
    },
  };
});

function seedActive(imageNodeId = 'in-1') {
  useEditorStore.setState({
    activeImageNodeId: imageNodeId,
    imageNodes: {
      [imageNodeId]: {
        id: imageNodeId,
        layerIds: ['L1'],
        position: { x: 0, y: 0 },
        size: { w: 800, h: 600 },
      },
    },
  } as never);
}

beforeEach(() => {
  useBackendState.setState({ sessionId: 'sess-1', snapshot: undefined } as never);
});

describe('CropTab initial state', () => {
  it('full source crop when no transform node exists', () => {
    seedActive();
    render(<CropTab />);
    const readout = screen.getByTestId('crop-readout');
    expect(readout).toHaveTextContent('800 × 600');
    // Free is the initial aspect.
    expect(screen.getByRole('button', { name: 'Free' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reads existing crop from snapshot', () => {
    seedActive();
    useBackendState.setState({
      sessionId: 'sess-1',
      snapshot: {
        revision: 1,
        operation_graph: {
          id: 'g', user_goal: '', reasoning: null, panel_bindings: [], metadata: {},
          nodes: [{
            id: 'transform:in-1:crop', type: 'crop',
            params: { x: 100, y: 50, w: 600, h: 400 },
            scope: { kind: 'global' }, inputs: [], layer_id: 'L1', layer_ids: ['L1'], widget_id: null,
          }],
        },
        masks_index: [], widgets: [], image_context: null,
      } as never,
    });
    render(<CropTab />);
    expect(screen.getByTestId('crop-readout')).toHaveTextContent('600 × 400');
  });

  it('reads existing rotate angle into the straighten slider', () => {
    seedActive();
    useBackendState.setState({
      sessionId: 'sess-1',
      snapshot: {
        revision: 1,
        operation_graph: {
          id: 'g', user_goal: '', reasoning: null, panel_bindings: [], metadata: {},
          nodes: [{
            id: 'transform:in-1:rotate', type: 'rotate',
            params: { angle: 5.0, flip_h: false, flip_v: false },
            scope: { kind: 'global' }, inputs: [], layer_id: 'L1', layer_ids: ['L1'], widget_id: null,
          }],
        },
        masks_index: [], widgets: [], image_context: null,
      } as never,
    });
    render(<CropTab />);
    const slider = screen.getByRole('slider', { name: /straighten/i }) as HTMLInputElement;
    expect(parseFloat(slider.value)).toBeCloseTo(5.0);
  });
});

describe('CropTab cropPreview wiring', () => {
  it('writes cropPreview on mount with the initial rect', () => {
    seedActive();
    render(<CropTab />);
    const preview = useEditorStore.getState().cropPreview;
    expect(preview).not.toBeNull();
    expect(preview!.crop).toEqual({ x: 0, y: 0, w: 800, h: 600 });
    expect(preview!.rotate).toBeNull();
  });

  it('writes cropPreview with rotate when angle is non-zero', () => {
    seedActive();
    useBackendState.setState({
      sessionId: 'sess-1',
      snapshot: {
        revision: 1,
        operation_graph: {
          id: 'g', user_goal: '', reasoning: null, panel_bindings: [], metadata: {},
          nodes: [{
            id: 'transform:in-1:rotate', type: 'rotate',
            params: { angle: 12.5, flip_h: false, flip_v: false },
            scope: { kind: 'global' }, inputs: [], layer_id: 'L1', layer_ids: ['L1'], widget_id: null,
          }],
        },
        masks_index: [], widgets: [], image_context: null,
      } as never,
    });
    render(<CropTab />);
    const preview = useEditorStore.getState().cropPreview;
    expect(preview!.rotate).toEqual({ angle: 12.5, flip_h: false, flip_v: false });
  });

  it('clears cropPreview on unmount', () => {
    seedActive();
    const { unmount } = render(<CropTab />);
    expect(useEditorStore.getState().cropPreview).not.toBeNull();
    unmount();
    expect(useEditorStore.getState().cropPreview).toBeNull();
  });
});
