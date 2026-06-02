import { describe, it, expect } from 'vitest';
import { computeEffectiveSize } from './image-node-geometry';

describe('computeEffectiveSize', () => {
  const source = { w: 800, h: 600 };

  it('returns source dims when no rotate, no crop', () => {
    expect(computeEffectiveSize(source, null, null)).toEqual({ w: 800, h: 600 });
  });

  it('swaps source dims for 90°', () => {
    expect(computeEffectiveSize(source, 90, null)).toEqual({ w: 600, h: 800 });
  });

  it('swaps source dims for 270°', () => {
    expect(computeEffectiveSize(source, 270, null)).toEqual({ w: 600, h: 800 });
  });

  it('does not swap for 0°', () => {
    expect(computeEffectiveSize(source, 0, null)).toEqual({ w: 800, h: 600 });
  });

  it('does not swap for 180°', () => {
    expect(computeEffectiveSize(source, 180, null)).toEqual({ w: 800, h: 600 });
  });

  it('crop replaces source dims when no rotate', () => {
    const crop = { x: 100, y: 50, w: 600, h: 400 };
    expect(computeEffectiveSize(source, 0, crop)).toEqual({ w: 600, h: 400 });
  });

  it('crop dims swap on 90°', () => {
    const crop = { x: 100, y: 50, w: 600, h: 400 };
    expect(computeEffectiveSize(source, 90, crop)).toEqual({ w: 400, h: 600 });
  });

  it('normalises negative angle (-90 → 270 → swap)', () => {
    expect(computeEffectiveSize(source, -90, null)).toEqual({ w: 600, h: 800 });
  });

  it('does not swap for angles within 1° of 0', () => {
    expect(computeEffectiveSize(source, 0.5, null)).toEqual({ w: 800, h: 600 });
  });

  it('swaps for angles within 1° of 90', () => {
    expect(computeEffectiveSize(source, 89.5, null)).toEqual({ w: 600, h: 800 });
  });
});
