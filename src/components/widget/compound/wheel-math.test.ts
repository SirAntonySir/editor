import { describe, expect, it } from 'vitest';
import {
  anchorAngles,
  positionToIndicatorAngle,
  angleToPosition,
  resolveWedgeColor,
  AUTO_PALETTE,
} from './wheel-math';

describe('anchorAngles', () => {
  it('evenly spaces N angles starting at 0 degrees (top)', () => {
    expect(anchorAngles(4)).toEqual([0, 90, 180, 270]);
    expect(anchorAngles(5)).toEqual([0, 72, 144, 216, 288]);
    expect(anchorAngles(2)).toEqual([0, 180]);
  });
});

describe('positionToIndicatorAngle', () => {
  const seasonAnchors = [
    { position: 0.00, name: 'spring' },
    { position: 0.33, name: 'summer' },
    { position: 0.66, name: 'autumn' },
    { position: 1.00, name: 'winter' },
  ];

  it('returns wedge center for exact anchor positions', () => {
    expect(positionToIndicatorAngle(seasonAnchors, 0.00)).toBeCloseTo(0, 3);
    expect(positionToIndicatorAngle(seasonAnchors, 0.33)).toBeCloseTo(90, 3);
    expect(positionToIndicatorAngle(seasonAnchors, 0.66)).toBeCloseTo(180, 3);
    expect(positionToIndicatorAngle(seasonAnchors, 1.00)).toBeCloseTo(270, 3);
  });

  it('linearly interpolates between adjacent wedge centers', () => {
    // halfway between summer (0.33 → 90°) and autumn (0.66 → 180°)
    const halfway = (0.33 + 0.66) / 2;
    expect(positionToIndicatorAngle(seasonAnchors, halfway)).toBeCloseTo(135, 3);
  });

  it('wraps cyclically past the last anchor', () => {
    // position 0.05 sits in [winter(1.0) → spring(0.0)] segment
    // winter wedge center is 270°, spring is 360° (= 0° in modulo)
    // 0.05 / (anchor_distance) of the way through that segment
    const angle = positionToIndicatorAngle(seasonAnchors, 0.05);
    // 0.05 sits PAST the last anchor (1.0) wrapped. Expect angle in [270°, 360°) range
    expect(angle).toBeGreaterThan(270);
    expect(angle).toBeLessThan(360);
  });

  it('clamps positions outside [0, 1] to wrapped equivalents', () => {
    expect(positionToIndicatorAngle(seasonAnchors, -0.1)).toBeCloseTo(
      positionToIndicatorAngle(seasonAnchors, 0.9), 3,
    );
    expect(positionToIndicatorAngle(seasonAnchors, 1.1)).toBeCloseTo(
      positionToIndicatorAngle(seasonAnchors, 0.1), 3,
    );
  });
});

describe('angleToPosition', () => {
  const seasonAnchors = [
    { position: 0.00, name: 'spring' },
    { position: 0.33, name: 'summer' },
    { position: 0.66, name: 'autumn' },
    { position: 1.00, name: 'winter' },
  ];

  it('inverts positionToIndicatorAngle at anchor positions', () => {
    for (const p of [0.00, 0.33, 0.66, 1.00]) {
      const a = positionToIndicatorAngle(seasonAnchors, p);
      expect(angleToPosition(seasonAnchors, a)).toBeCloseTo(p, 3);
    }
  });

  it('returns a position in [0, 1] for any angle', () => {
    for (const angle of [0, 45, 90, 135, 180, 270, 359]) {
      const p = angleToPosition(seasonAnchors, angle);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});

describe('resolveWedgeColor', () => {
  const palette = ['#22c55e', '#eab308', '#ea580c', '#3b82f6', '#a855f7'];

  it('returns anchor.color when set', () => {
    expect(resolveWedgeColor({ name: 'x', color: '#ff0000' }, 0, palette)).toBe('#ff0000');
  });

  it('cycles through palette when anchor.color is null/undefined', () => {
    expect(resolveWedgeColor({ name: 'a' }, 0, palette)).toBe(palette[0]);
    expect(resolveWedgeColor({ name: 'b' }, 1, palette)).toBe(palette[1]);
    expect(resolveWedgeColor({ name: 'f' }, 5, palette)).toBe(palette[0]);  // wraps
  });
});

describe('AUTO_PALETTE', () => {
  it('exports a stable default palette', () => {
    expect(AUTO_PALETTE.length).toBeGreaterThanOrEqual(4);
    for (const c of AUTO_PALETTE) {
      expect(c).toMatch(/^#[0-9a-f]{3,8}$/i);
    }
  });
});
