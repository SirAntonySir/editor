import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '@/store';
import { RightSidebar } from './RightSidebar';

describe('RightSidebar — gate on activeImageNodeId', () => {
  beforeEach(() => {
    useEditorStore.setState({
      imageNodes: {},
      activeImageNodeId: null,
      layers: [],
    });
  });

  it('unmounts when activeImageNodeId is null, even when layers exist', () => {
    useEditorStore.setState({
      layers: [{ id: 'L1', type: 'image', name: 'photo.jpg', visible: true, opacity: 1, blendMode: 'normal', locked: false, order: 0 }],
      activeImageNodeId: null,
    });
    const { container } = render(<RightSidebar />);
    expect(container.firstChild).toBeNull();
  });

  it('mounts when activeImageNodeId is non-null', () => {
    useEditorStore.setState({
      imageNodes: {
        'in-1': { id: 'in-1', layerIds: ['L1'], position: { x: 0, y: 0 }, size: { w: 100, h: 100 }, sourceSize: { w: 100, h: 100 } },
      },
      layers: [{ id: 'L1', type: 'image', name: 'photo.jpg', visible: true, opacity: 1, blendMode: 'normal', locked: false, order: 0 }],
      activeImageNodeId: 'in-1',
    });
    const { container } = render(<RightSidebar />);
    expect(container.firstChild).not.toBeNull();
  });
});
