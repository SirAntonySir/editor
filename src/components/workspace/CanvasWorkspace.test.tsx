import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, render, fireEvent } from '@testing-library/react';
import { CanvasWorkspace } from './CanvasWorkspace';
import { useEditorStore } from '@/store';

vi.mock('@/lib/backend-tools', () => ({
  backendTools: {
    delete_widget: vi.fn(),
  },
}));

beforeEach(() => {
  useEditorStore.getState().resetWorkspace();
  useEditorStore.setState({
    layers: [],
    activeLayerId: null,
  } as unknown as Parameters<typeof useEditorStore.setState>[0]);
});

afterEach(cleanup);

describe('CanvasWorkspace', () => {
  it('renders an empty workspace when no nodes exist', () => {
    render(<CanvasWorkspace />);
    expect(document.querySelector('.react-flow')).toBeTruthy();
  });

  it('renders an Image node for each entry in the store', () => {
    const id = useEditorStore.getState().addImageNode(['l-1'], { x: 50, y: 50 });
    render(<CanvasWorkspace />);
    expect(document.querySelector(`[data-id="${id}"]`)).toBeTruthy();
  });

  it('Delete key ignores keypresses originating from form inputs', async () => {
    const id = useEditorStore.getState().addImageNode(['l-1'], { x: 50, y: 50 });
    render(<CanvasWorkspace />);
    await new Promise((r) => setTimeout(r, 0));
    // Simulate a keypress whose target is an input — handler must early-out.
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'Delete' });
    expect(useEditorStore.getState().imageNodes[id]).toBeDefined();
    document.body.removeChild(input);
  });

  it('Delete key without selected nodes/edges is a no-op', async () => {
    const id = useEditorStore.getState().addImageNode(['l-1'], { x: 50, y: 50 });
    render(<CanvasWorkspace />);
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.keyDown(window, { key: 'Delete' });
    // Node still present because nothing was selected in React Flow's state.
    expect(useEditorStore.getState().imageNodes[id]).toBeDefined();
  });

  it('auto-creates an ImageNode from current layers when none exist', async () => {
    useEditorStore.getState().addLayer({
      id: 'l-1', type: 'image', name: 'Layer 1',
      visible: true, opacity: 1, blendMode: 'normal', locked: false,
    });
    useEditorStore.getState().addLayer({
      id: 'l-2', type: 'image', name: 'Layer 2',
      visible: true, opacity: 1, blendMode: 'normal', locked: false,
    });
    render(<CanvasWorkspace />);
    // Allow effect to run.
    await new Promise((r) => setTimeout(r, 0));
    const nodes = Object.values(useEditorStore.getState().imageNodes);
    expect(nodes.length).toBe(1);
    expect(nodes[0].layerIds).toEqual(['l-1', 'l-2']);
  });
});
