import { describe, it, expect } from 'vitest';
import { IDENTITY_CURVES, type CurvesValue } from './widget';

describe('curve value model', () => {
  it('IDENTITY_CURVES has identity points for all four channels', () => {
    const ch: (keyof CurvesValue)[] = ['rgb', 'red', 'green', 'blue'];
    for (const c of ch) {
      expect(IDENTITY_CURVES[c]).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    }
  });

  it('channels are distinct arrays', () => {
    expect(IDENTITY_CURVES.rgb).not.toBe(IDENTITY_CURVES.red);
  });
});
