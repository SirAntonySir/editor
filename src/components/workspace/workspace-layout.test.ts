import { describe, it, expect } from 'vitest';
import { nextSpawnPositionFor } from './workspace-layout';

describe('nextSpawnPositionFor', () => {
  it('places widgets to the right of the target image node', () => {
    const target = { position: { x: 100, y: 50 }, size: { w: 240, h: 180 } };
    expect(nextSpawnPositionFor(target, 'widget', [])).toEqual({ x: 364, y: 95 });
  });

  it('places new images to the right with a 24px gap', () => {
    const target = { position: { x: 0, y: 0 }, size: { w: 240, h: 180 } };
    expect(nextSpawnPositionFor(target, 'image', [])).toEqual({ x: 264, y: 0 });
  });

  it('shifts down when a node already occupies the slot', () => {
    const target = { position: { x: 0, y: 0 }, size: { w: 240, h: 180 } };
    const occupied = [{ position: { x: 264, y: 0 }, size: { w: 240, h: 180 } }];
    expect(nextSpawnPositionFor(target, 'image', occupied)).toEqual({ x: 264, y: 204 });
  });
});
