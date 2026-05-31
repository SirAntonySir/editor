import { describe, it, expect } from 'vitest';
import { engineUniformValue, engineParam, ENGINE_OPS } from './registry';

describe('engine registry', () => {
  it('scales exposure by 100 (−100..100 → −1..1 for the shader)', () => {
    expect(engineUniformValue('exposure', 100)).toBeCloseTo(1);
    expect(engineUniformValue('exposure', -50)).toBeCloseTo(-0.5);
  });

  it('converts hue degrees to radians', () => {
    expect(engineUniformValue('hue', 180)).toBeCloseTo(Math.PI);
  });

  it('passes kelvin through unscaled', () => {
    expect(engineUniformValue('kelvin', 6500)).toBe(6500);
  });

  it('exposes param metadata with the canonical range', () => {
    expect(engineParam('exposure')).toMatchObject({ uniform: 'u_exposure', min: -100, max: 100 });
  });

  it('uses canonical keys — no legacy temp/black aliases', () => {
    const allParamKeys = Object.values(ENGINE_OPS).flatMap((op) => Object.keys(op.params));
    expect(allParamKeys).toContain('kelvin');
    expect(allParamKeys).toContain('inBlack');
    expect(allParamKeys).not.toContain('temp');
    expect(allParamKeys).not.toContain('black');
  });
});
