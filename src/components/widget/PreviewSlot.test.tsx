import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PreviewSlot } from './PreviewSlot';

afterEach(cleanup);

describe('PreviewSlot', () => {
  it('renders nothing for kind="none"', () => {
    const { container } = render(<PreviewSlot kind="none" />);
    expect(container.firstChild).toBeNull();
  });
  it('renders a labeled histogram-delta block for kind="histogram_delta"', () => {
    render(<PreviewSlot kind="histogram_delta" />);
    expect(screen.getByLabelText('Histogram delta preview')).toBeInTheDocument();
  });
  it('renders a labeled thumbnail block for kind="thumbnail"', () => {
    render(<PreviewSlot kind="thumbnail" />);
    expect(screen.getByLabelText('Thumbnail preview')).toBeInTheDocument();
  });
  it('renders a labeled swatches block for kind="color_swatches"', () => {
    render(<PreviewSlot kind="color_swatches" />);
    expect(screen.getByLabelText('Color swatches preview')).toBeInTheDocument();
  });
});
