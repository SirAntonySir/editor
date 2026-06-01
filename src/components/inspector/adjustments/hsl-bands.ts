/**
 * HSL band metadata — the single source of truth for the panel's colour cues.
 *
 * `centerHue` mirrors `CENTERS[]` in src/shaders/hsl.glsl.ts (normalised hue
 * 0..1). Display colours are derived from the centre hue as CSS `hsl()` strings
 * — band identity is *data* (a fixed hue), not a themeable design token, so this
 * is the one place colours are computed rather than read from index.css. The
 * saturation/lightness display constants below are intentionally local.
 */

export interface HslBand {
  key: string;
  label: string;
  /** Band centre, normalised hue 0..1 (matches the shader). */
  centerHue: number;
}

export const HSL_BANDS: readonly HslBand[] = [
  { key: 'red', label: 'Red', centerHue: 0.0 },
  { key: 'orange', label: 'Orange', centerHue: 0.0833 },
  { key: 'yellow', label: 'Yellow', centerHue: 0.1667 },
  { key: 'green', label: 'Green', centerHue: 0.3333 },
  { key: 'aqua', label: 'Aqua', centerHue: 0.5 },
  { key: 'blue', label: 'Blue', centerHue: 0.6667 },
  { key: 'purple', label: 'Purple', centerHue: 0.75 },
  { key: 'magenta', label: 'Magenta', centerHue: 0.8333 },
];

/** Display saturation / lightness for a band's representative colour. */
const BAND_SAT = 85;
const BAND_LUM = 55;
/** Half-width (in degrees) of the hue-track preview window. */
const HUE_WINDOW_DEG = 30;

/** Centre hue → wrapped, rounded degrees (optionally offset). */
function hueDeg(centerHue: number, offsetDeg = 0): number {
  return Math.round(((centerHue * 360 + offsetDeg) % 360 + 360) % 360);
}

/** A band's representative colour as a CSS `hsl()` string. */
export function bandDisplayColor(centerHue: number): string {
  return `hsl(${hueDeg(centerHue)} ${BAND_SAT}% ${BAND_LUM}%)`;
}

/** Hue track: rotate-left ← centre → rotate-right, a 3-stop preview. */
export function hueTrack(centerHue: number): string {
  const l = `hsl(${hueDeg(centerHue, -HUE_WINDOW_DEG)} ${BAND_SAT}% ${BAND_LUM}%)`;
  const c = `hsl(${hueDeg(centerHue)} ${BAND_SAT}% ${BAND_LUM}%)`;
  const r = `hsl(${hueDeg(centerHue, HUE_WINDOW_DEG)} ${BAND_SAT}% ${BAND_LUM}%)`;
  return `linear-gradient(90deg, ${l}, ${c}, ${r})`;
}

/** Saturation track: desaturated → full band colour. */
export function satTrack(centerHue: number): string {
  const h = hueDeg(centerHue);
  return `linear-gradient(90deg, hsl(${h} 8% 80%), hsl(${h} ${BAND_SAT}% ${BAND_LUM}%))`;
}

/** Luminance track: dark → band colour → light. */
export function lumTrack(centerHue: number): string {
  const h = hueDeg(centerHue);
  return `linear-gradient(90deg, hsl(${h} 55% 18%), hsl(${h} ${BAND_SAT}% ${BAND_LUM}%), hsl(${h} ${BAND_SAT}% 90%))`;
}
