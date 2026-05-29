import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Swatch } from './Swatch';

describe('Swatch', () => {
  afterEach(cleanup);

  it('renders a div with the given rgb background', () => {
    const { container } = render(<Swatch rgb={[255, 0, 128]} />);
    const div = container.firstElementChild as HTMLElement;
    expect(div.style.backgroundColor).toBe('rgb(255, 0, 128)');
  });

  it('uses the size prop for width and height', () => {
    const { container } = render(<Swatch rgb={[0, 0, 0]} size={24} />);
    const div = container.firstElementChild as HTMLElement;
    expect(div.style.width).toBe('24px');
    expect(div.style.height).toBe('24px');
  });

  it('sets a hex title attribute', () => {
    const { container } = render(<Swatch rgb={[255, 0, 128]} />);
    const div = container.firstElementChild as HTMLElement;
    expect(div.getAttribute('title')).toBe('#ff0080');
  });
});
