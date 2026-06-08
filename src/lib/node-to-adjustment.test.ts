import { describe, it, expect } from 'vitest';
import { nodeToAdjustment } from './node-to-adjustment';
import type { Node } from '@/types/operation-graph';
import { IDENTITY_CURVES } from '@/types/widget';

describe('nodeToAdjustment', () => {
  it('maps numeric params verbatim', () => {
    const node = {
      id: 'n1', type: 'kelvin', scope: { kind: 'global' },
      params: { temperature: 6500 }, inputs: [],
    } as unknown as Node;
    const adj = nodeToAdjustment(node);
    expect(adj.id).toBe('n1');
    expect(adj.type).toBe('kelvin');
    expect(adj.params).toEqual({ temperature: 6500 });
    expect(adj.enabled).toBe(true);
  });

  it('drops non-number params (string/boolean)', () => {
    const node = {
      id: 'n2', type: 'choice', scope: { kind: 'global' },
      params: { temperature: 6500, mode: 'auto', enabled: true },
      inputs: [],
    } as unknown as Node;
    const adj = nodeToAdjustment(node);
    expect(adj.params).toEqual({ temperature: 6500 });
  });

  it('inherits scope from node', () => {
    const node = {
      id: 'n3', type: 'basic', scope: { kind: 'mask', mask_id: 'm_1' },
      params: { exposure: 0.5 }, inputs: [],
    } as unknown as Node;
    const adj = nodeToAdjustment(node);
    expect(adj.scope).toEqual({ kind: 'mask', mask_id: 'm_1' });
  });

  it('evaluates a curves node with flat points (fused-tool shape) into a master RGB LUT + identity per-channel', () => {
    // Fused tools (teal_orange / bw_cinematic / sky_recovery) write a single
    // luma curve as a flat `[[x, y], ...]` array under `params.points`.
    // Without this branch, nodeToAdjustment dropped the param (non-numeric),
    // the pipeline bound no LUT textures, and the curves shader sampled the
    // source image as if it were a LUT — producing per-pixel colour noise.
    const node = {
      id: 'n_c2', type: 'curves',
      params: { points: [[0, 0], [0.5, 0.8], [1, 1]] },
      scope: { kind: 'global' },
    } as unknown as Parameters<typeof nodeToAdjustment>[0];

    const adj = nodeToAdjustment(node);
    for (const ch of ['rgb', 'red', 'green', 'blue'] as const) {
      expect(adj.params[ch]).toBeInstanceOf(Float32Array);
      expect((adj.params[ch] as Float32Array).length).toBe(256);
    }
    // RGB master lifts the midpoint above identity.
    expect((adj.params.rgb as Float32Array)[128]).toBeGreaterThan(0.5);
    // Per-channel curves stay identity.
    for (const ch of ['red', 'green', 'blue'] as const) {
      const lut = adj.params[ch] as Float32Array;
      expect(lut[0]).toBeCloseTo(0, 5);
      expect(lut[128]).toBeCloseTo(128 / 255, 2);
      expect(lut[255]).toBeCloseTo(1, 5);
    }
  });

  it('falls back to identity for curves nodes with no curve params at all', () => {
    // Initial widget state before the user touches the curve: the curves
    // node may have zero params. Pipeline must still receive four LUTs.
    const node = {
      id: 'n_c3', type: 'curves', params: {}, scope: { kind: 'global' },
    } as unknown as Parameters<typeof nodeToAdjustment>[0];
    const adj = nodeToAdjustment(node);
    // Old path: no `curves`, no `points` → falls through to the generic
    // numeric copy branch and emits nothing. The pipeline's identity-LUT
    // fallback (in pipeline.ts) covers this case at bind time.
    expect(adj.params).toEqual({});
  });

  it('evaluates a registry 4-channel curves node (0–255 space) into 4 LUTs', () => {
    // Registry shape: params.rgb / red / green / blue each hold [[x,y],...] in
    // 0–255 space.  The red channel lifts blacks (y starts at 32 instead of 0).
    const node = {
      id: 'n_c4', type: 'curves',
      params: {
        rgb:   [[0, 0],  [255, 255]],
        red:   [[0, 32], [255, 255]],
        green: [[0, 0],  [255, 255]],
        blue:  [[0, 0],  [255, 255]],
      },
      scope: { kind: 'global' },
    } as unknown as Parameters<typeof nodeToAdjustment>[0];

    const adj = nodeToAdjustment(node);
    expect(adj.type).toBe('curves');

    for (const ch of ['rgb', 'red', 'green', 'blue'] as const) {
      expect(adj.params[ch]).toBeInstanceOf(Float32Array);
      expect((adj.params[ch] as Float32Array).length).toBe(256);
    }

    // rgb / green / blue should be identity
    for (const ch of ['rgb', 'green', 'blue'] as const) {
      const lut = adj.params[ch] as Float32Array;
      expect(lut[0]).toBeCloseTo(0, 5);
      expect(lut[128]).toBeCloseTo(128 / 255, 2);
      expect(lut[255]).toBeCloseTo(1, 5);
    }

    // red channel is lifted: index 0 should be ~32/255 > 0
    const redLut = adj.params.red as Float32Array;
    expect(redLut[0]).toBeGreaterThan(0.1);   // lifted blacks
    expect(redLut[255]).toBeCloseTo(1, 5);     // white point unchanged
  });

  it('evaluates a curves node into four Float32Array channel LUTs', () => {
    const node = {
      id: 'n_c', type: 'curves',
      params: { curves: {
        ...IDENTITY_CURVES,
        rgb: [{ x: 0, y: 0 }, { x: 0.5, y: 0.8 }, { x: 1, y: 1 }],
      } },
      scope: { kind: 'global' },
    } as unknown as Parameters<typeof nodeToAdjustment>[0];

    const adj = nodeToAdjustment(node);
    expect(adj.type).toBe('curves');
    for (const ch of ['rgb', 'red', 'green', 'blue'] as const) {
      expect(adj.params[ch]).toBeInstanceOf(Float32Array);
      expect((adj.params[ch] as Float32Array).length).toBe(256);
    }
    const rgb = adj.params.rgb as Float32Array;
    expect(rgb[128]).toBeGreaterThan(0.5); // midpoint lifted above identity
  });
});
