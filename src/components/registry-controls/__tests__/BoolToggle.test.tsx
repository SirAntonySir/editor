import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { BoolToggle } from '../BoolToggle';

afterEach(cleanup);

const baseSchema = { type: 'bool' as const, default: false };

describe('BoolToggle control', () => {
  it('renders label', () => {
    const { getByText } = render(
      <BoolToggle paramKey="enabled" label="Enable" value={false} schema={baseSchema} onChange={() => undefined} />,
    );
    expect(getByText('Enable')).toBeTruthy();
  });

  it('reflects checked state', () => {
    const { getByRole } = render(
      <BoolToggle paramKey="enabled" label="Enable" value={true} schema={baseSchema} onChange={() => undefined} />,
    );
    expect((getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });

  it('reflects unchecked state', () => {
    const { getByRole } = render(
      <BoolToggle paramKey="enabled" label="Enable" value={false} schema={baseSchema} onChange={() => undefined} />,
    );
    expect((getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  });

  it('calls onChange with boolean when toggled', () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <BoolToggle paramKey="enabled" label="Enable" value={false} schema={baseSchema} onChange={onChange} />,
    );
    fireEvent.click(getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('falls back to schema default when value is not boolean', () => {
    const { getByRole } = render(
      <BoolToggle
        paramKey="enabled"
        label="Enable"
        value={undefined}
        schema={{ type: 'bool', default: true }}
        onChange={() => undefined}
      />,
    );
    expect((getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });
});
