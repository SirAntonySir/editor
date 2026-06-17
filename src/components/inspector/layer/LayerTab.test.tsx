import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';
import { LayerTab } from './LayerTab';

describe('LayerTab', () => {
  beforeEach(() => {
    // Reset minimal store fields needed by the tab.
    useEditorStore.setState({
      imageNodes: {},
      activeImageNodeId: null,
      layers: [],
      activeLayerId: null,
    });
  });

  it('renders one row per layer of the active image node', () => {
    useEditorStore.setState({
      imageNodes: {
        'in-1': {
          id: 'in-1',
          layerIds: ['L1', 'L2'],
          position: { x: 0, y: 0 },
          size: { w: 600, h: 400 },
          sourceSize: { w: 600, h: 400 },
        },
      },
      activeImageNodeId: 'in-1',
      layers: [
        { id: 'L1', type: 'image', name: 'photo.jpg', visible: true, opacity: 1, blendMode: 'normal', locked: false, order: 0 },
        { id: 'L2', type: 'brush', name: 'paint',     visible: true, opacity: 1, blendMode: 'normal', locked: false, order: 1 },
      ],
      activeLayerId: 'L1',
    });
    const { getByText } = render(<LayerTab />);
    expect(getByText('photo.jpg')).toBeInTheDocument();
    expect(getByText('paint')).toBeInTheDocument();
  });

  it('shows an empty state when no image node is active', () => {
    useEditorStore.setState({ activeImageNodeId: null });
    const { getByText } = render(<LayerTab />);
    expect(getByText(/select an image/i)).toBeInTheDocument();
  });

  it('LayerRow enters rename mode when renamingLayerId matches', () => {
    useEditorStore.setState({
      imageNodes: {
        'in-1': {
          id: 'in-1',
          layerIds: ['L1'],
          position: { x: 0, y: 0 },
          size: { w: 600, h: 400 },
          sourceSize: { w: 600, h: 400 },
        },
      },
      activeImageNodeId: 'in-1',
      layers: [
        { id: 'L1', type: 'image', name: 'photo.jpg', visible: true, opacity: 1, blendMode: 'normal', locked: false, order: 0 },
      ],
      activeLayerId: 'L1',
      renamingLayerId: 'L1',
    });
    const { getByRole } = render(<LayerTab />);
    // The inline rename input should be present and focused.
    const input = getByRole('textbox', { name: /rename photo\.jpg/i });
    expect(input).toBeInTheDocument();
    expect((input as HTMLInputElement).value).toBe('photo.jpg');
    // The one-shot flag is cleared after the effect fires.
    expect(useEditorStore.getState().renamingLayerId).toBeNull();
  });
});
