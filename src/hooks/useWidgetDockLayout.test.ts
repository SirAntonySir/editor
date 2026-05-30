import { describe, it, expect } from 'vitest';
import { computeDockLayout } from './useWidgetDockLayout';

const photo = { left: 32, top: 100, width: 480, height: 320 };
// Column origin x: photo.right + 12 = 32+480+12 = 524

describe('computeDockLayout · anchored', () => {
  it('region_label anchored y aligns to centroid; tick is anchored', () => {
    const out = computeDockLayout({
      widgets: [{ id: 'w-1', anchor: { kind: 'region_label', label: 'sky' }, cardHeight: 30 }],
      photo,
      candidateRegions: [{ label: 'sky', bbox: [0, 0, 1, 0.4] }], // top 40% strip
    });
    expect(out[0].isAnchored).toBe(true);
    expect(out[0].x).toBe(524);
    // centroid y = photo.top + 0.20 * photo.height = 100 + 64 = 164; minus cardHeight/2 = 149
    expect(out[0].y).toBe(149);
  });

  it('image_point anchored y uses the normalized coordinate', () => {
    const out = computeDockLayout({
      widgets: [{ id: 'w-2', anchor: { kind: 'image_point', x: 0.5, y: 0.5 }, cardHeight: 200 }],
      photo,
    });
    // centroid_y = 100 + 0.5*320 = 260; minus 100 = 160
    expect(out[0].y).toBe(160);
  });

  it('falls back to global slot when region centroid cannot be resolved', () => {
    const out = computeDockLayout({
      widgets: [{ id: 'w-3', anchor: { kind: 'region_label', label: 'gone' }, cardHeight: 30 }],
      photo,
      candidateRegions: [],
    });
    expect(out[0].isAnchored).toBe(false);
  });
});

describe('computeDockLayout · global slots', () => {
  it('global widgets stack top-down with 5px gap', () => {
    const out = computeDockLayout({
      widgets: [
        { id: 'g1', anchor: { kind: 'global' }, cardHeight: 30 },
        { id: 'g2', anchor: { kind: 'global' }, cardHeight: 30 },
      ],
      photo,
    });
    expect(out[0].y).toBe(124); // photo.top + 24 column top
    expect(out[1].y).toBe(124 + 30 + 5);
  });
});

describe('computeDockLayout · anchored + global interleave', () => {
  it('anchored placed first; global fills next free slot below', () => {
    const out = computeDockLayout({
      widgets: [
        { id: 'a1', anchor: { kind: 'image_point', x: 0.5, y: 0.5 }, cardHeight: 30 },
        { id: 'g1', anchor: { kind: 'global' }, cardHeight: 30 },
      ],
      photo,
    });
    // a1 placed at y = 100 + 160 - 15 = 245
    expect(out[0].y).toBe(245);
    // g1 falls into the first free slot from the top, NOT colliding with a1
    // column top = 124; a1 occupies [245, 275); g1 fits at 124
    expect(out[1].y).toBe(124);
  });

  it('two anchored widgets at near-identical centroids push down', () => {
    const out = computeDockLayout({
      widgets: [
        { id: 'a1', anchor: { kind: 'image_point', x: 0.5, y: 0.5 }, cardHeight: 30 },
        { id: 'a2', anchor: { kind: 'image_point', x: 0.5, y: 0.51 }, cardHeight: 30 },
      ],
      photo,
    });
    expect(out[0].y).toBe(245);
    expect(out[1].y).toBe(245 + 30 + 5);
  });
});

describe('computeDockLayout · drag override', () => {
  it('manual override wins regardless of anchor', () => {
    const out = computeDockLayout({
      widgets: [{ id: 'w-1', anchor: { kind: 'image_point', x: 0.5, y: 0.5 }, cardHeight: 30 }],
      photo,
      dragOverrides: new Map([['w-1', { x: 700, y: 250 }]]),
    });
    expect(out[0]).toEqual({ widgetId: 'w-1', x: 700, y: 250, isAnchored: true });
  });
});
