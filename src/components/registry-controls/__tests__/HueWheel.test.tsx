import { describe, expect, it, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { HueWheel } from '../HueWheel';

afterEach(cleanup);

const baseSchema = { type: 'scalar' as const, range: [0, 360] as [number, number], default: 0 };

describe('HueWheel control (v1 gradient slider)', () => {
  it('renders without crashing', () => {
    expect(() =>
      render(<HueWheel paramKey="hue" label="Hue" value={180} schema={baseSchema} onChange={() => undefined} />),
    ).not.toThrow();
  });

  it('renders the label', () => {
    const { getByText } = render(
      <HueWheel paramKey="hue" label="Hue" value={0} schema={baseSchema} onChange={() => undefined} />,
    );
    expect(getByText('Hue')).toBeTruthy();
  });

  it('renders a slider element', () => {
    const { getByRole } = render(
      <HueWheel paramKey="hue" label="Hue" value={90} schema={baseSchema} onChange={() => undefined} />,
    );
    expect(getByRole('slider')).toBeTruthy();
  });

  it('uses custom range when provided', () => {
    const schema = { type: 'scalar' as const, range: [-180, 180] as [number, number], default: 0 };
    expect(() =>
      render(<HueWheel paramKey="hue" label="Hue Shift" value={0} schema={schema} onChange={() => undefined} />),
    ).not.toThrow();
  });
});
