import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { Swatch } from '../Swatch';

afterEach(cleanup);

const baseSchema = { type: 'color_hsv' as const, default: [0, 0, 1] };

describe('Swatch control', () => {
  it('renders label', () => {
    const { getByText } = render(
      <Swatch paramKey="color" label="Colour" value={[0, 0, 1]} schema={baseSchema} onChange={() => undefined} />,
    );
    expect(getByText('Colour')).toBeTruthy();
  });

  it('renders color input', () => {
    const { container } = render(
      <Swatch paramKey="color" label="Colour" value={[0, 0, 1]} schema={baseSchema} onChange={() => undefined} />,
    );
    expect(container.querySelector('input[type="color"]')).toBeTruthy();
  });

  it('calls onChange when color changes', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Swatch paramKey="color" label="Colour" value={[0, 0, 1]} schema={baseSchema} onChange={onChange} />,
    );
    const input = container.querySelector('input[type="color"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: '#ff0000' } });
    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([expect.any(Number)]));
  });

  it('handles invalid/missing value gracefully', () => {
    expect(() =>
      render(<Swatch paramKey="color" label="Colour" value={null} schema={baseSchema} onChange={() => undefined} />),
    ).not.toThrow();
  });
});
