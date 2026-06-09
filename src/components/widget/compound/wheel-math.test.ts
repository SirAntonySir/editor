import { describe, expect, it } from 'vitest';
import {
  activeWedgeIndexFromAngle,
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

  it('positions inside the normal segments interpolate against the first segment, not the seam', () => {
    // seasonAnchors span [0.00, 1.00] without a gap, so position 0.05 sits 5%
    // through the FIRST segment (0.00 → 0.33), at ~13.6°. NOT in the seam.
    expect(positionToIndicatorAngle(seasonAnchors, 0.05)).toBeCloseTo(13.636, 2);
  });

  it('clamps positions outside [0, 1] to wrapped equivalents', () => {
    expect(positionToIndicatorAngle(seasonAnchors, -0.1)).toBeCloseTo(
      positionToIndicatorAngle(seasonAnchors, 0.9), 3,
    );
    expect(positionToIndicatorAngle(seasonAnchors, 1.1)).toBeCloseTo(
      positionToIndicatorAngle(seasonAnchors, 0.1), 3,
    );
  });

  describe('irregular anchor positions (cyclic seam handling)', () => {
    // Time-of-day style: anchors at [0.10, 0.30, 0.55, 0.80, 1.00] — there's a
    // genuine cyclic gap from 1.00 → 1.10 (wrapping to 0.10) that the seam
    // segment must cover. Five anchors → angles [0, 72, 144, 216, 288].
    const todAnchors = [
      { position: 0.10, name: 'dawn'   },
      { position: 0.30, name: 'noon'   },
      { position: 0.55, name: 'golden' },
      { position: 0.80, name: 'blue'   },
      { position: 1.00, name: 'night'  },
    ];

    it('exact anchor positions map to evenly-spaced wedge centers', () => {
      expect(positionToIndicatorAngle(todAnchors, 0.10)).toBeCloseTo(0,   3);
      expect(positionToIndicatorAngle(todAnchors, 0.30)).toBeCloseTo(72,  3);
      expect(positionToIndicatorAngle(todAnchors, 0.55)).toBeCloseTo(144, 3);
      expect(positionToIndicatorAngle(todAnchors, 0.80)).toBeCloseTo(216, 3);
      expect(positionToIndicatorAngle(todAnchors, 1.00)).toBeCloseTo(288, 3);
    });

    it('positions in the normal segment between two anchors do NOT use the seam', () => {
      // 0.90 sits halfway between blue(0.80) and night(1.00). Expect halfway
      // between angles[3]=216 and angles[4]=288, i.e. 252°. The old buggy
      // seam test caught 0.90 in [0.9, 1.0] as "seam" and produced wrong angle.
      expect(positionToIndicatorAngle(todAnchors, 0.90)).toBeCloseTo(252, 3);
    });

    it('positions inside the cyclic seam map between angles[last] and angles[0]+360', () => {
      // 0.05 wraps to 1.05 in extended space, halfway through the seam
      // (1.00, 1.10). Expect halfway between 288° and 360°, i.e. 324°.
      expect(positionToIndicatorAngle(todAnchors, 0.05)).toBeCloseTo(324, 3);
    });

    it('inverse round-trips at anchor positions', () => {
      for (const a of todAnchors) {
        const angle = positionToIndicatorAngle(todAnchors, a.position);
        expect(angleToPosition(todAnchors, angle)).toBeCloseTo(a.position, 3);
      }
    });

    it('inverse round-trips inside the seam', () => {
      // 0.05 → 324° → 0.05.
      const angle = positionToIndicatorAngle(todAnchors, 0.05);
      expect(angleToPosition(todAnchors, angle)).toBeCloseTo(0.05, 3);
    });

    it('inverse round-trips inside a normal segment', () => {
      const angle = positionToIndicatorAngle(todAnchors, 0.90);
      expect(angleToPosition(todAnchors, angle)).toBeCloseTo(0.90, 3);
    });
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

describe('activeWedgeIndexFromAngle', () => {
  it('returns 0 at angle 0 (top, wedge 0 centered there)', () => {
    expect(activeWedgeIndexFromAngle(4, 0)).toBe(0);
    expect(activeWedgeIndexFromAngle(5, 0)).toBe(0);
  });

  it('switches wedge exactly at the visual boundary halfway between centers', () => {
    // N=4: wedge centers [0, 90, 180, 270], boundaries at [45, 135, 225, 315].
    expect(activeWedgeIndexFromAngle(4, 44.999)).toBe(0);
    expect(activeWedgeIndexFromAngle(4, 45)).toBe(1);
    expect(activeWedgeIndexFromAngle(4, 134.999)).toBe(1);
    expect(activeWedgeIndexFromAngle(4, 135)).toBe(2);
  });

  it('wraps wedge 0 across the seam (covers [315, 360) ∪ [0, 45))', () => {
    expect(activeWedgeIndexFromAngle(4, 320)).toBe(0);
    expect(activeWedgeIndexFromAngle(4, 359)).toBe(0);
    expect(activeWedgeIndexFromAngle(4, 30)).toBe(0);
  });

  it('handles N=5 with 72° wedges', () => {
    // boundaries at [36, 108, 180, 252, 324]
    expect(activeWedgeIndexFromAngle(5, 0)).toBe(0);
    expect(activeWedgeIndexFromAngle(5, 35.999)).toBe(0);
    expect(activeWedgeIndexFromAngle(5, 36)).toBe(1);
    expect(activeWedgeIndexFromAngle(5, 107.999)).toBe(1);
    expect(activeWedgeIndexFromAngle(5, 108)).toBe(2);
    expect(activeWedgeIndexFromAngle(5, 323.999)).toBe(4);
    expect(activeWedgeIndexFromAngle(5, 324)).toBe(0);
  });

  it('returns -1 when there are no anchors', () => {
    expect(activeWedgeIndexFromAngle(0, 0)).toBe(-1);
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
