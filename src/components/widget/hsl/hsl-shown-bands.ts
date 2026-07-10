import type { Widget } from '@/types/widget';
import { HSL_BANDS } from './hsl-bands';

const CHANNELS = ['hue', 'sat', 'lum'] as const;
const BAND_ORDER = HSL_BANDS.map((b) => b.key);

/** Bands the widget has bindings for, in canonical band order. Backend now pads
 *  every HSL widget to all 8 bands; a subset only appears for legacy widgets. */
export function availableHslBands(widget: Widget): string[] {
  const present = new Set(widget.bindings.map((b) => b.paramKey.split('_')[0]));
  return BAND_ORDER.filter((k) => present.has(k));
}

/** Bands with at least one channel moved off its default, in canonical order. */
export function editedHslBands(widget: Widget): string[] {
  const byParam = new Map(widget.bindings.map((b) => [b.paramKey, b] as const));
  return BAND_ORDER.filter((band) =>
    CHANNELS.some((c) => {
      const b = byParam.get(`${band}_${c}`);
      return b ? b.value !== b.default : false;
    }),
  );
}

/**
 * Bands the widget should display: the union of edited bands and bands the user
 * revealed via "+", intersected with the bands the widget actually binds, in
 * canonical order. Falls back to the first available band (red) when nothing is
 * edited or revealed — so a fresh HSL widget opens on a single colour.
 */
export function shownHslBands(widget: Widget, revealed: readonly string[]): string[] {
  const available = new Set(availableHslBands(widget));
  const shown = new Set(
    [...editedHslBands(widget), ...revealed].filter((b) => available.has(b)),
  );
  const ordered = BAND_ORDER.filter((k) => shown.has(k));
  if (ordered.length > 0) return ordered;
  const first = BAND_ORDER.find((k) => available.has(k));
  return first ? [first] : [];
}
