import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { CanvasWorkspace } from './CanvasWorkspace';
import { useEditorStore } from '@/store';

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
