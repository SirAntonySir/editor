import { describe, it, expect } from 'vitest';
import { nextSpawnPositionFor, pickSpawnSide, MAX_TARGET_SPAWN_OFFSET, type Viewport } from './workspace-layout';

describe('nextSpawnPositionFor', () => {
  const widgetSize = { w: 226, h: 60 };
  const imageSize = { w: 240, h: 180 };

  it('places widgets to the right of the target image node', () => {
    const target = { position: { x: 100, y: 50 }, size: { w: 240, h: 180 } };
    expect(nextSpawnPositionFor(target, widgetSize, 'widget', [])).toEqual({ x: 364, y: 95 });
  });

  it('places new images to the right with a 24px gap', () => {
    const target = { position: { x: 0, y: 0 }, size: { w: 240, h: 180 } };
    expect(nextSpawnPositionFor(target, imageSize, 'image', [])).toEqual({ x: 264, y: 0 });
  });

  it('shifts down when a node already occupies the slot', () => {
    const target = { position: { x: 0, y: 0 }, size: { w: 240, h: 180 } };
    const occupied = [{ position: { x: 264, y: 0 }, size: { w: 240, h: 180 } }];
    expect(nextSpawnPositionFor(target, imageSize, 'image', occupied)).toEqual({ x: 264, y: 204 });
  });

  it('caps the x-offset so widgets stay close even for source-size image nodes', () => {
    const target = { position: { x: 100, y: 100 }, size: { w: 6000, h: 4000 } };
    const pos = nextSpawnPositionFor(target, widgetSize, 'widget', []);
    // xOffset capped at MAX_TARGET_SPAWN_OFFSET (not the full 6000).
    expect(pos.x).toBe(100 + MAX_TARGET_SPAWN_OFFSET + 24);
  });

  it('places widgets to the LEFT when side="left"', () => {
    const target = { position: { x: 500, y: 50 }, size: { w: 240, h: 180 } };
    // x = 500 - 226 - 24 = 250; y = 50 + 45 = 95
    expect(nextSpawnPositionFor(target, widgetSize, 'widget', [], 'left'))
      .toEqual({ x: 250, y: 95 });
  });

  it('preserves right-side behavior when side defaulted', () => {
    const target = { position: { x: 100, y: 50 }, size: { w: 240, h: 180 } };
    expect(nextSpawnPositionFor(target, widgetSize, 'widget', []))
      .toEqual({ x: 364, y: 95 });
  });
});

describe('nextSpawnPositionFor: overflow to opposite side', () => {
  const widgetSize = { w: 226, h: 60 };
  const target = { position: { x: 500, y: 50 }, size: { w: 240, h: 180 } };
  // Image bottom = 230; COLUMN_OVERFLOW_PAD = 100; yLimit = 330.

  it('overflows to opposite side when preferred column is full', () => {
    const leftX = 500 - 226 - 24;  // = 250
    const occupied = [
      { position: { x: leftX, y: 95 },  size: widgetSize },
      { position: { x: leftX, y: 179 }, size: widgetSize },
      { position: { x: leftX, y: 263 }, size: widgetSize },
    ];
    // Next widget should overflow to RIGHT: x = 500 + min(240,400) + 24 = 764
    const pos = nextSpawnPositionFor(target, widgetSize, 'widget', occupied, 'left');
    expect(pos.x).toBe(764);
    expect(pos.y).toBe(95);   // right column empty → top
  });

  it('falls back to stacking past yLimit when BOTH sides are full', () => {
    const leftX = 500 - 226 - 24;
    const rightX = 500 + 240 + 24;
    const yPositions = [95, 179, 263, 347, 431];
    const occupied = [
      ...yPositions.map(y => ({ position: { x: leftX,  y }, size: widgetSize })),
      ...yPositions.map(y => ({ position: { x: rightX, y }, size: widgetSize })),
    ];
    const pos = nextSpawnPositionFor(target, widgetSize, 'widget', occupied, 'left');
    // Fallback: stay on preferred (LEFT) side, keep stacking past yLimit.
    expect(pos.x).toBe(leftX);
    expect(pos.y).toBeGreaterThan(430);
  });
});

describe('pickSpawnSide', () => {
  const target = { position: { x: 0, y: 0 }, size: { w: 200, h: 100 } };
  const screen = { w: 1200, h: 800 };

  it('returns RIGHT when image is in the LEFT half of the viewport', () => {
    // viewport center in canvas = (screen.w/2 - pan.x)/zoom = (600 - 0)/1 = 600
    // image center in canvas    = 0 + 100 = 100; 100 < 600 → image LEFT → spawn RIGHT
    const viewport: Viewport = { pan: { x: 0, y: 0 }, zoom: 1, screen };
    expect(pickSpawnSide(target, viewport)).toBe('right');
  });

  it('returns LEFT when image is in the RIGHT half of the viewport', () => {
    // viewport center = (600 - 0)/1 = 600
    // image center = 700 + 100 = 800; 800 > 600 → image RIGHT → spawn LEFT
    const targetRight = { position: { x: 700, y: 0 }, size: { w: 200, h: 100 } };
    const viewport: Viewport = { pan: { x: 0, y: 0 }, zoom: 1, screen };
    expect(pickSpawnSide(targetRight, viewport)).toBe('left');
  });

  it('returns LEFT (tie default) when image is at viewport center', () => {
    // viewport center = 600; image center = 500 + 100 = 600 → tie band → LEFT
    const targetCenter = { position: { x: 500, y: 0 }, size: { w: 200, h: 100 } };
    const viewport: Viewport = { pan: { x: 0, y: 0 }, zoom: 1, screen };
    expect(pickSpawnSide(targetCenter, viewport)).toBe('left');
  });

  it('accounts for pan offset', () => {
    // pan.x = -1000 shifts the viewport center in canvas: (600 - (-1000))/1 = 1600
    // image at x=100 (center 200) is far LEFT of viewport center 1600 → spawn RIGHT
    const viewport: Viewport = { pan: { x: -1000, y: 0 }, zoom: 1, screen };
    expect(pickSpawnSide(target, viewport)).toBe('right');
  });
});
