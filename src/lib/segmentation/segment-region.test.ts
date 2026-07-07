import { describe, expect, it } from 'vitest';
import { buildRegionPrompt } from './segment-region';

describe('buildRegionPrompt', () => {
  it('emits a single positive point when no bbox is available', () => {
    expect(buildRegionPrompt([0.5, 0.4])).toEqual([{ x: 0.5, y: 0.4, label: 1 }]);
  });

  it('prepends box corners (labels 2/3) before the positive point when a bbox is given', () => {
    const prompt = buildRegionPrompt([0.5, 0.4], { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 });
    expect(prompt).toEqual([
      { x: 0.1, y: 0.1, label: 2 },
      { x: 0.9, y: 0.9, label: 3 },
      { x: 0.5, y: 0.4, label: 1 },
    ]);
  });
});
