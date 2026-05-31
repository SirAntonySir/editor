import { describe, it, expect } from 'vitest';
import { nextSpawnPositionFor, MAX_TARGET_SPAWN_OFFSET } from './workspace-layout';

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
});
