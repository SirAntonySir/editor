import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { KelvinStrip } from '../KelvinStrip';

afterEach(cleanup);

const baseSchema = {
  type: 'scalar' as const,
  range: [2000, 12000] as [number, number],
  default: 6500,
  unit: 'K',
  step: 50,
};

describe('KelvinStrip control', () => {
  it('renders label', () => {
    const { getByText } = render(
      <KelvinStrip paramKey="kelvin" label="Temperature" value={6500} schema={baseSchema} onChange={() => undefined} />,
    );
    expect(getByText('Temperature')).toBeTruthy();
  });

  it('renders slider element', () => {
    const { getByRole } = render(
      <KelvinStrip paramKey="kelvin" label="Temperature" value={6500} schema={baseSchema} onChange={() => undefined} />,
    );
    expect(getByRole('slider')).toBeTruthy();
  });

  it('formats value with K suffix', () => {
    const { getByText } = render(
      <KelvinStrip paramKey="kelvin" label="Temperature" value={5500} schema={baseSchema} onChange={() => undefined} />,
    );
    expect(getByText('5500K')).toBeTruthy();
  });

  it('calls onChange when slider thumb is moved via keyboard', () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <KelvinStrip paramKey="kelvin" label="Temperature" value={6500} schema={baseSchema} onChange={onChange} />,
    );
    // Radix Slider uses a <span role="slider"> — interact via keyboard.
    // step for kelvin_strip with unit is 50; ArrowRight increments by step.
    fireEvent.keyDown(getByRole('slider'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith(6550);
  });

  it('throws when schema type is not scalar', () => {
    expect(() =>
      render(
        <KelvinStrip
          paramKey="mode"
          label="Mode"
          value="warm"
          schema={{ type: 'enum', values: ['warm'], default: 'warm' }}
          onChange={() => undefined}
        />,
      ),
    ).toThrow('KelvinStrip needs a scalar param with range');
  });
});
