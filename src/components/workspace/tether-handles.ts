/** Pick which React Flow handles a tether edge should connect to, given the
 *  widget's and image's horizontal extents.
 *
 *  Routes to the image's NEAREST edge to the widget (left or right), then the
 *  widget's outlet faces that edge. Centre-vs-centre comparison breaks for
 *  wide images where widgets spawn inside the image's bounding box; this
 *  edge-aware variant keeps the edge from crossing the widget body in that
 *  case.
 */
export interface TetherHandlePick {
  sourceHandle: 'tether-out-left' | 'tether-out-right';
  targetHandle: 'tether-in-left' | 'tether-in-right';
}

export function pickTetherHandles(
  widgetCenterX: number,
  imageLeftX: number,
  imageRightX: number,
): TetherHandlePick {
  const imageNearestIsLeft =
    Math.abs(widgetCenterX - imageLeftX) <= Math.abs(widgetCenterX - imageRightX);
  const imageEdgeX = imageNearestIsLeft ? imageLeftX : imageRightX;
  const widgetExitsRight = imageEdgeX > widgetCenterX;
  return {
    sourceHandle: widgetExitsRight ? 'tether-out-right' : 'tether-out-left',
    targetHandle: imageNearestIsLeft ? 'tether-in-left' : 'tether-in-right',
  };
}
