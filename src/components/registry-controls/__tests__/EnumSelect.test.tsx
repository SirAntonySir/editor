import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { EnumSelect } from '../EnumSelect';

afterEach(cleanup);

const baseSchema = {
  type: 'enum' as const,
  values: ['none', 'warm', 'cool'],
  default: 'none',
};

describe('EnumSelect control', () => {
  it('renders label', () => {
    const { getByText } = render(
      <EnumSelect paramKey="lut" label="Look" value="none" schema={baseSchema} onChange={() => undefined} />,
    );
    expect(getByText('Look')).toBeTruthy();
  });

  it('renders all options', () => {
    const { getByRole } = render(
      <EnumSelect paramKey="lut" label="Look" value="none" schema={baseSchema} onChange={() => undefined} />,
    );
    const select = getByRole('combobox') as HTMLSelectElement;
    expect(select.options.length).toBe(3);
    expect(select.options[0].value).toBe('none');
    expect(select.options[1].value).toBe('warm');
    expect(select.options[2].value).toBe('cool');
  });

  it('shows the current value as selected', () => {
    const { getByRole } = render(
      <EnumSelect paramKey="lut" label="Look" value="warm" schema={baseSchema} onChange={() => undefined} />,
    );
    const select = getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('warm');
  });

  it('calls onChange when selection changes', () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <EnumSelect paramKey="lut" label="Look" value="none" schema={baseSchema} onChange={onChange} />,
    );
    fireEvent.change(getByRole('combobox'), { target: { value: 'cool' } });
    expect(onChange).toHaveBeenCalledWith('cool');
  });

  it('throws when schema type is not enum', () => {
    expect(() =>
      render(
        <EnumSelect
          paramKey="exp"
          label="Exposure"
          value={0}
          schema={{ type: 'scalar', range: [-100, 100], default: 0 }}
          onChange={() => undefined}
        />,
      ),
    ).toThrow('EnumSelect needs an enum param with values');
  });
});
