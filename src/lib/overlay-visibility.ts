/**
 * Which mask overlays paint.
 *
 * Masks are HOVER-ONLY: persistent committed/'selected' paints were removed —
 * they tinted the photo and obscured the very edit the selection produced
 * (user feedback, 2026-07-08). A mask shows while its pixels are hovered
 * (cursor tooltip carries the name); the in-progress draft (SAM preview /
 * lasso) always shows — it's active gesture feedback, not chrome.
 *
 * Pure so the decisions are unit-testable without a canvas. Consumed by
 * `paintOverlays` (image-node-renderer) and ImageNodeObjectsLayer.
 */
export interface OverlayVisibilityInput {
  activeMaskRef: string | null;
  hoveredObjectId: string | null;
}

export interface OverlayVisibility {
  /** Draft mask (SAM preview / lasso in progress) — never gated. */
  paintActiveDraft: boolean;
  /** 'hover' segmentation overlay for hoveredObjectId. */
  paintHover: boolean;
}

export function selectOverlayVisibility(s: OverlayVisibilityInput): OverlayVisibility {
  return {
    paintActiveDraft: s.activeMaskRef !== null,
    paintHover: s.hoveredObjectId !== null,
  };
}

/** Objects the ImageNodeObjectsLayer canvas paints: the hovered one, plus
 *  the one whose context menu is open — right-clicking moves the pointer
 *  onto the menu (clearing hover), and the mask must not vanish mid-menu. */
export function objectsToPaint<T extends { id: string }>(
  objects: T[],
  hoveredObjectId: string | null,
  contextMenuObjectId: string | null = null,
): T[] {
  if (hoveredObjectId === null && contextMenuObjectId === null) return [];
  return objects.filter((o) => o.id === hoveredObjectId || o.id === contextMenuObjectId);
}
