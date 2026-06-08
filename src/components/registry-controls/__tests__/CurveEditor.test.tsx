import { describe, expect, it, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { CurveEditor } from '../CurveEditor';

afterEach(cleanup);

const baseSchema = {
  type: 'curve_points' as const,
  default: [[0, 0], [1, 1]] as [number, number][],
};

describe('CurveEditor control (smoke tests)', () => {
  it('renders without crashing with valid curve_points value', () => {
    expect(() =>
      render(
        <CurveEditor
          paramKey="curve"
          label="Curve"
          value={[[0, 0], [0.5, 0.5], [1, 1]]}
          schema={baseSchema}
          onChange={() => undefined}
        />,
      ),
    ).not.toThrow();
  });

  it('renders label', () => {
    const { getByText } = render(
      <CurveEditor
        paramKey="curve"
        label="Tone Curve"
        value={[[0, 0], [1, 1]]}
        schema={baseSchema}
        onChange={() => undefined}
      />,
    );
    expect(getByText('Tone Curve')).toBeTruthy();
  });

  it('renders without crashing when value is invalid (falls back to identity)', () => {
    expect(() =>
      render(
        <CurveEditor
          paramKey="curve"
          label="Curve"
          value={null}
          schema={baseSchema}
          onChange={() => undefined}
        />,
      ),
    ).not.toThrow();
  });

  it('renders without crashing when value is a bare number (degenerate backend case)', () => {
    expect(() =>
      render(
        <CurveEditor
          paramKey="curve"
          label="Curve"
          value={0}
          schema={baseSchema}
          onChange={() => undefined}
        />,
      ),
    ).not.toThrow();
  });
});
