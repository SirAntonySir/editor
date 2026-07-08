// Which mask overlays paint. Masks are HOVER-ONLY: the persistent
// committed/selected paints were removed (they obscured the edits — user
// feedback on 2026-07-08); a mask shows while its pixels are hovered, plus
// the always-visible in-progress draft (SAM preview / lasso).
import { describe, it, expect } from 'vitest';
import { selectOverlayVisibility, objectsToPaint } from './overlay-visibility';

const base = {
  activeMaskRef: null as string | null,
  hoveredObjectId: null as string | null,
};

describe('selectOverlayVisibility', () => {
  it('draft mask (in-progress selection) always paints', () => {
    expect(selectOverlayVisibility({ ...base, activeMaskRef: 'd1' }).paintActiveDraft).toBe(true);
    expect(selectOverlayVisibility(base).paintActiveDraft).toBe(false);
  });

  it('hover paints whenever an object is hovered — including the active one', () => {
    expect(selectOverlayVisibility({ ...base, hoveredObjectId: 'o1' }).paintHover).toBe(true);
    expect(selectOverlayVisibility(base).paintHover).toBe(false);
  });
});

describe('objectsToPaint (ImageNodeObjectsLayer)', () => {
  const objs = [{ id: 'o1' }, { id: 'o2' }] as Array<{ id: string }>;

  it('paints only the hovered object', () => {
    expect(objectsToPaint(objs, 'o2').map((o) => o.id)).toEqual(['o2']);
  });

  it('paints nothing when no object is hovered', () => {
    expect(objectsToPaint(objs, null)).toEqual([]);
  });

  it('keeps the object visible while its context menu is open', () => {
    // Right-click opens the menu; the pointer then moves ONTO the menu, which
    // clears hover — the mask must not vanish mid-menu.
    expect(objectsToPaint(objs, null, 'o1').map((o) => o.id)).toEqual(['o1']);
  });

  it('dedupes when the hovered object also owns the open menu', () => {
    expect(objectsToPaint(objs, 'o1', 'o1').map((o) => o.id)).toEqual(['o1']);
  });

  it('paints both when hovering one object while another has its menu open', () => {
    expect(objectsToPaint(objs, 'o2', 'o1').map((o) => o.id).sort()).toEqual(['o1', 'o2']);
  });
});
