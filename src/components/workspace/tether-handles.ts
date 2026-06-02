/** Pick which React Flow handles a tether edge should connect to.
 *
 *  Routes to the image's NEAREST edge (top, bottom, left, or right).
 *
 *  Resolution order:
 *   1. Compute the outside-gap on each axis (0 when widget is within the band).
 *   2. If exactly one axis has a non-zero gap → use that axis (widget is clearly
 *      to the side / above / below the image).
 *   3. If both axes have a gap → use whichever gap is smaller (nearest escape).
 *   4. If both gaps are zero (widget centre inside the image bbox) → fall back
 *      to the nearest of the four individual edges; widget outlet exits on the
 *      SAME side as the image handle (both face the same edge).
 *
 *  For cases 1-3 (widget outside on at least one axis), the widget outlet is on
 *  the OPPOSITE side from the image handle (widget exits toward the image edge).
 *  For case 4 (widget inside image), the outlet is on the SAME side so the
 *  tether doesn't loop back across the widget body.
 */
export type ImageHandleId =
  | 'tether-in-top' | 'tether-in-bottom' | 'tether-in-left' | 'tether-in-right';
export type WidgetHandleId =
  | 'tether-out-top' | 'tether-out-bottom' | 'tether-out-left' | 'tether-out-right';

export interface TetherHandlePick {
  sourceHandle: WidgetHandleId;
  targetHandle: ImageHandleId;
}

export interface ImageBounds {
  x0: number; y0: number; x1: number; y1: number;
}

export interface Point { x: number; y: number; }

export function pickTetherHandles(
  widgetCenter: Point,
  image: ImageBounds,
): TetherHandlePick {
  // Gap outside the bounding box on each axis (0 when widget is inside the band).
  const hGap = Math.max(0, image.x0 - widgetCenter.x, widgetCenter.x - image.x1);
  const vGap = Math.max(0, image.y0 - widgetCenter.y, widgetCenter.y - image.y1);

  if (hGap === 0 && vGap === 0) {
    // Widget centre is inside the image bbox — use nearest of the four edges.
    // Widget outlet exits on the SAME side (both face the shared edge).
    const dLeft   = Math.abs(widgetCenter.x - image.x0);
    const dRight  = Math.abs(widgetCenter.x - image.x1);
    const dTop    = Math.abs(widgetCenter.y - image.y0);
    const dBottom = Math.abs(widgetCenter.y - image.y1);
    const minH = Math.min(dLeft, dRight);
    const minV = Math.min(dTop, dBottom);
    if (minH <= minV) {
      // Horizontal edge wins (tie → prefer horizontal).
      return dLeft <= dRight
        ? { sourceHandle: 'tether-out-left',   targetHandle: 'tether-in-left' }
        : { sourceHandle: 'tether-out-right',  targetHandle: 'tether-in-right' };
    } else {
      return dTop <= dBottom
        ? { sourceHandle: 'tether-out-top',    targetHandle: 'tether-in-top' }
        : { sourceHandle: 'tether-out-bottom', targetHandle: 'tether-in-bottom' };
    }
  }

  // Widget is outside on at least one axis.
  // Use the axis with a non-zero gap; if both non-zero, pick the smaller gap.
  // Widget outlet is on the OPPOSITE side from the image handle.
  const useVertical = vGap > 0 && (hGap === 0 || vGap < hGap);

  if (useVertical) {
    const useTop = Math.abs(widgetCenter.y - image.y0) <= Math.abs(widgetCenter.y - image.y1);
    return useTop
      ? { sourceHandle: 'tether-out-bottom', targetHandle: 'tether-in-top' }
      : { sourceHandle: 'tether-out-top',    targetHandle: 'tether-in-bottom' };
  }

  const useLeft = Math.abs(widgetCenter.x - image.x0) <= Math.abs(widgetCenter.x - image.x1);
  return useLeft
    ? { sourceHandle: 'tether-out-right', targetHandle: 'tether-in-left' }
    : { sourceHandle: 'tether-out-left',  targetHandle: 'tether-in-right' };
}
