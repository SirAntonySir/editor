import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { CurveEditor } from './CurveEditor';
import type { CurvesValue } from '@/types/widget';

afterEach(cleanup);

describe('CurveEditor — defensive value handling', () => {
  it('renders without crashing when value is the number 0', () => {
    // Reproduces the legacy fused-template bug (bw_cinematic / teal_orange /
    // sky_recovery) where the binding value collapses to the envelope
    // midpoint (0) because their LLM resolver schema omits the `points` key.
    expect(() =>
      render(<CurveEditor value={0 as unknown as CurvesValue} onChange={() => {}} />),
    ).not.toThrow();
  });

  it('renders without crashing when value is null', () => {
    expect(() =>
      render(<CurveEditor value={null as unknown as CurvesValue} onChange={() => {}} />),
    ).not.toThrow();
  });

  it('renders without crashing when value is partial (only one channel)', () => {
    const partial = { red: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } as unknown as CurvesValue;
    expect(() =>
      render(<CurveEditor value={partial} onChange={() => {}} />),
    ).not.toThrow();
  });
});
