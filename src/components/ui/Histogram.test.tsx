import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Histogram } from './Histogram';

describe('Histogram', () => {
  afterEach(cleanup);

  it('renders an aria-hidden svg', () => {
    const { container } = render(<Histogram bins={[1, 2, 3]} color="#fff" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders a path whose fill matches the color prop', () => {
    const { container } = render(<Histogram bins={[1, 2, 3]} color="#abcdef" />);
    const path = container.querySelector('path');
    expect(path?.getAttribute('fill')).toBe('#abcdef');
  });

  it('uses the bins length to set the viewBox width', () => {
    const { container } = render(<Histogram bins={[0, 0, 0, 0]} color="#fff" width={200} height={40} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 200 40');
  });

  it('renders nothing visible when bins are all zero (no NaN in path)', () => {
    const { container } = render(<Histogram bins={[0, 0, 0]} color="#fff" />);
    const d = container.querySelector('path')?.getAttribute('d') ?? '';
    expect(d).not.toContain('NaN');
  });

  it('renders an empty path when bins is empty', () => {
    const { container } = render(<Histogram bins={[]} color="#fff" />);
    const d = container.querySelector('path')?.getAttribute('d') ?? '';
    expect(d).toBe('');
  });

  it('renders one path per series in overlay mode', () => {
    const { container } = render(
      <Histogram
        series={[
          { bins: [1, 2, 3], color: '#aaa', fill: true },
          { bins: [3, 2, 1], color: '#f00', fill: false },
          { bins: [1, 3, 2], color: '#0f0', fill: false },
        ]}
      />,
    );
    expect(container.querySelectorAll('path').length).toBe(3);
  });

  it('strokes (not fills) line series and fills area series', () => {
    const { container } = render(
      <Histogram
        series={[
          { bins: [1, 2], color: '#aaa', fill: true },
          { bins: [2, 1], color: '#f00', fill: false },
        ]}
      />,
    );
    const paths = container.querySelectorAll('path');
    expect(paths[0].getAttribute('fill')).toBe('#aaa');
    expect(paths[1].getAttribute('fill')).toBe('none');
    expect(paths[1].getAttribute('stroke')).toBe('#f00');
  });
});
