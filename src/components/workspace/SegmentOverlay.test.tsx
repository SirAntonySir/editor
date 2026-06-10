import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SegmentOverlay } from './SegmentOverlay';

describe('SegmentOverlay', () => {
  it('renders one svg path per hovered polygon', () => {
    const { container } = render(
      <SegmentOverlay
        widthPx={200}
        heightPx={100}
        hoveredPolygons={[[[0, 0], [1, 0], [1, 1], [0, 1]]]}
        selectedPolygons={[]}
      />,
    );
    expect(container.querySelectorAll('svg path')).toHaveLength(1);
  });

  it('renders both hovered and selected polygons', () => {
    const { container } = render(
      <SegmentOverlay
        widthPx={200}
        heightPx={100}
        hoveredPolygons={[[[0, 0], [1, 0], [1, 1], [0, 1]]]}
        selectedPolygons={[[[0, 0], [0.5, 0], [0.25, 0.5]]]}
      />,
    );
    expect(container.querySelectorAll('svg path')).toHaveLength(2);
  });

  it('renders no paths when both lists are empty', () => {
    const { container } = render(
      <SegmentOverlay
        widthPx={200}
        heightPx={100}
        hoveredPolygons={[]}
        selectedPolygons={[]}
      />,
    );
    expect(container.querySelectorAll('svg path')).toHaveLength(0);
  });
});
