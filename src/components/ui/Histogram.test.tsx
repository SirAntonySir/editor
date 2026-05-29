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
});
