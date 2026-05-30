interface RegionHighlightLayerProps {
  photo: { left: number; top: number; width: number; height: number };
  anchorBoxes: Record<string, [number, number, number, number]>; // widgetId → normalized [x,y,w,h]
  hoveredWidgetId: string | null;
}

export function RegionHighlightLayer({ photo, anchorBoxes, hoveredWidgetId }: RegionHighlightLayerProps) {
  if (!hoveredWidgetId) return null;
  const bbox = anchorBoxes[hoveredWidgetId];
  if (!bbox) return null;
  const [x, y, w, h] = bbox;
  return (
    <div
      aria-label={`Region highlight for ${hoveredWidgetId}`}
      className="absolute pointer-events-none border-[1.5px] border-accent bg-accent/15 rounded-[var(--radius-sm)]"
      style={{
        left: photo.left + x * photo.width,
        top: photo.top + y * photo.height,
        width: w * photo.width,
        height: h * photo.height,
      }}
    />
  );
}
