import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RegionHighlightLayer } from './RegionHighlightLayer';

afterEach(cleanup);

describe('RegionHighlightLayer', () => {
  it('renders nothing when no widget is hovered', () => {
    const { container } = render(
      <RegionHighlightLayer
        photo={{ left: 32, top: 100, width: 480, height: 320 }}
        anchorBoxes={{}}
        hoveredWidgetId={null}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a highlight rect when a matching anchor box exists', () => {
    render(
      <RegionHighlightLayer
        photo={{ left: 32, top: 100, width: 480, height: 320 }}
        anchorBoxes={{ 'w-1': [0, 0, 1, 0.4] }}
        hoveredWidgetId="w-1"
      />,
    );
    expect(screen.getByLabelText('Region highlight for w-1')).toBeInTheDocument();
  });
});
