import type { Widget } from '@/types/widget';

interface Props {
  widget: Widget;
}

/**
 * LOD placeholder for a widget at extreme zoom-out. Renders as a small
 * canvas-space circle colored by the widget's category so the user can
 * scan multiple widgets at a glance during overview navigation.
 *
 * Used by WidgetNode when `useChromeVisible()` returns false.
 */
const CATEGORY_COLORS: Record<string, string> = {
  tone:    '#3b82f6',  // blue
  color:   '#a855f7',  // purple
  detail:  '#22c55e',  // green
  texture: '#eab308',  // yellow
  effect:  '#ec4899',  // pink
  mood:    '#6d5cff',  // indigo
};

const FALLBACK_COLOR = '#6d5cff';

export function MarkerDot({ widget }: Props) {
  const color = CATEGORY_COLORS[widget.category ?? ''] ?? FALLBACK_COLOR;
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      style={{ pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" fill={color} fillOpacity="0.85" />
      <circle cx="8" cy="8" r="6" fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}
