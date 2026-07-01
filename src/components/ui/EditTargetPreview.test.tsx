import { render, screen, cleanup } from '@testing-library/react';
import { it, describe, expect, afterEach } from 'vitest';
import { EditTargetPreview } from './EditTargetPreview';
import { useEditorStore } from '@/store';

describe('EditTargetPreview', () => {
  afterEach(() => cleanup());

  it('renders nothing when no image node is active', () => {
    useEditorStore.setState({ activeImageNodeId: null, imageNodes: {} } as never);
    const { container } = render(<EditTargetPreview />);
    expect(container.firstChild).toBeNull();
  });

  it('captions the preview with the node label and active layer name', () => {
    useEditorStore.setState({
      activeImageNodeId: 'in_1',
      activeLayerId: 'L1',
      layers: [{ id: 'L1', name: 'Sky retouch' }],
      imageNodes: {
        in_1: {
          id: 'in_1', name: 'Beach.jpg', layerIds: ['L1'],
          position: { x: 0, y: 0 }, size: { w: 100, h: 75 }, sourceSize: { w: 800, h: 600 },
        },
      },
    } as never);
    render(<EditTargetPreview />);
    expect(screen.getByText('Beach.jpg')).toBeTruthy();
    expect(screen.getByText('Sky retouch')).toBeTruthy();
  });
});
