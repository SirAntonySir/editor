import type { DockedPosition } from '@/hooks/useWidgetDockLayout';

interface AnchorTickLayerProps {
  photo: { left: number; top: number; width: number; height: number };
  positions: DockedPosition[];
}

export function AnchorTickLayer({ photo, positions }: AnchorTickLayerProps) {
  const tickX = photo.left + photo.width - 1;
  return (
    <>
      {positions.filter((p) => p.isAnchored).map((p) => (
        <span
          key={p.widgetId}
          aria-label={`Anchor tick for ${p.widgetId}`}
          className="absolute w-[9px] h-[2px] bg-accent pointer-events-none"
          style={{ left: tickX, top: p.y + 15, boxShadow: '0 0 0 1.5px rgba(255,255,255,0.7)' }}
        />
      ))}
    </>
  );
}
