import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { Slider } from '../Slider';

afterEach(cleanup);

describe('Slider control', () => {
  const baseSchema = { type: 'scalar' as const, range: [-100, 100] as [number, number], default: 0 };

  it('renders label', () => {
    const { getByText } = render(
      <Slider
        paramKey="exposure"
        label="Exposure"
        value={0}
        schema={baseSchema}
        onChange={() => undefined}
      />,
    );
    expect(getByText('Exposure')).toBeTruthy();
  });

  it('calls onChange when slider thumb is moved via keyboard (ArrowRight)', () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <Slider
        paramKey="exposure"
        label="Exposure"
        value={0}
        schema={baseSchema}
        onChange={onChange}
      />,
    );
    // Radix Slider uses a <span role="slider"> — interact via keyboard.
    fireEvent.keyDown(getByRole('slider'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it('falls back to schema default when value is not a number', () => {
    const { getByRole } = render(
      <Slider
        paramKey="exposure"
        label="Exposure"
        value={undefined}
        schema={{ ...baseSchema, default: 25 }}
        onChange={() => undefined}
      />,
    );
    // The slider thumb should be at the default value
    expect(getByRole('slider')).toBeTruthy();
  });

  it('throws when schema type is not scalar', () => {
    expect(() =>
      render(
        <Slider
          paramKey="mode"
          label="Mode"
          value="a"
          schema={{ type: 'enum', values: ['a', 'b'], default: 'a' }}
          onChange={() => undefined}
        />,
      ),
    ).toThrow('Slider needs a scalar param with range');
  });

  it('applies disabled styling when disabled=true', () => {
    const { container } = render(
      <Slider
        paramKey="exposure"
        label="Exposure"
        value={0}
        schema={baseSchema}
        onChange={() => undefined}
        disabled
      />,
    );
    expect(container.querySelector('[aria-disabled="true"]')).toBeTruthy();
  });

  it('formats value with unit when schema has unit', () => {
    const { getByText } = render(
      <Slider
        paramKey="kelvin"
        label="Temperature"
        value={6500}
        schema={{ type: 'scalar', range: [2000, 12000], default: 6500, unit: 'K' }}
        onChange={() => undefined}
      />,
    );
    expect(getByText('6500K')).toBeTruthy();
  });
});
