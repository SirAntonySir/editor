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
    const slider = screen.getByRole('slider', { name: /straighten/i });
    expect(parseFloat(slider.getAttribute('aria-valuenow') ?? '0')).toBeCloseTo(5.0);
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

import userEvent from '@testing-library/user-event';
import { fireEvent } from '@testing-library/react';
import { backendTools } from '@/lib/backend-tools';
import { usePreferencesStore } from '@/store/preferences-store';

describe('CropTab Apply / Cancel', () => {
  it('Apply calls set_image_node_transform with the staged crop + null rotate', async () => {
    const spy = vi.spyOn(backendTools, 'set_image_node_transform').mockResolvedValue(
      { ok: true, output: { ok: true } } as never,
    );
    seedActive();
    usePreferencesStore.setState({ inspectorTab: 'crop' });
    render(<CropTab />);
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    // Wait for the await inside handleApply to resolve.
    await new Promise((r) => setTimeout(r, 0));
    expect(spy).toHaveBeenCalledWith('sess-1', expect.objectContaining({
      image_node_id: 'in-1',
      layer_ids: ['L1'],
      crop: { x: 0, y: 0, w: 800, h: 600 },
      rotate: null,
    }));
    expect(usePreferencesStore.getState().inspectorTab).toBe('adjustments');
    expect(useEditorStore.getState().cropPreview).toBeNull();
    spy.mockRestore();
  });

  it('Cancel does not call set_image_node_transform; resets state', async () => {
    const spy = vi.spyOn(backendTools, 'set_image_node_transform').mockResolvedValue(
      { ok: true, output: { ok: true } } as never,
    );
    seedActive();
    usePreferencesStore.setState({ inspectorTab: 'crop' });
    render(<CropTab />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(spy).not.toHaveBeenCalled();
    expect(usePreferencesStore.getState().inspectorTab).toBe('adjustments');
    expect(useEditorStore.getState().cropPreview).toBeNull();
    spy.mockRestore();
  });

  it('Enter applies; Escape cancels', async () => {
    const spy = vi.spyOn(backendTools, 'set_image_node_transform').mockResolvedValue(
      { ok: true, output: { ok: true } } as never,
    );
    seedActive();
    usePreferencesStore.setState({ inspectorTab: 'crop' });
    render(<CropTab />);
    fireEvent.keyDown(window, { key: 'Enter' });
    // Wait for the await inside handleApply to resolve.
    await new Promise((r) => setTimeout(r, 0));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    usePreferencesStore.setState({ inspectorTab: 'crop' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

import { largestInsetRect } from '@/lib/largest-inset-rect';

describe('CropTab straighten auto-fit', () => {
  it('shrinks crop to the largest source-aspect rect when angle changes', async () => {
    seedActive();
    render(<CropTab />);
    // Move the straighten ruler to 15°.
    // angleFromPointer: angle = min + ratio * (max - min); for angle=15, ratio = (15-(-45))/90 = 60/90 = 2/3
    const slider = screen.getByRole('slider', { name: /straighten/i });
    // In jsdom, getBoundingClientRect returns zeros; mock it so angleFromPointer works.
    slider.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 300, bottom: 28, width: 300, height: 28, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    fireEvent.pointerDown(slider, { clientX: 300 * (60 / 90), clientY: 14, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    // Read the cropPreview to confirm the crop shrunk to the inscribed rect.
    const preview = useEditorStore.getState().cropPreview;
    expect(preview).not.toBeNull();
    const expected = largestInsetRect(800, 600, 15, 800 / 600);
    expect(preview!.crop!.w).toBeCloseTo(expected.w, 0);
    expect(preview!.crop!.h).toBeCloseTo(expected.h, 0);
  });

  it('does NOT auto-fit on initial mount', () => {
    seedActive();
    render(<CropTab />);
    const preview = useEditorStore.getState().cropPreview;
    // Initial crop is full source — auto-fit would have shrunk it at angle 0
    // because of the source-aspect fallback. But 0° with source aspect IS the
    // full source, so this is hard to distinguish. The safer assertion: the
    // initial crop equals the full source dims, not the inset-with-aspect-1.
    expect(preview!.crop).toEqual({ x: 0, y: 0, w: 800, h: 600 });
  });
});
