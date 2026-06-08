/**
 * Kelvin SSoT — which direction is "warm"?
 *
 * The WebGL kelvin shader (`u_kelvin` in `src/shaders/kelvin.glsl.ts`) uses
 * the Lightroom convention: `u_kelvin` is the *claimed* colour temperature
 * of the light source.
 *
 *   - HIGH `u_kelvin` → "scene was lit by cool light, warm it up" → image WARMER.
 *   - LOW  `u_kelvin` → "scene was lit by warm light, cool it down" → image COOLER.
 *
 * This is the **inverse** of physical lighting kelvin (a 3200 K tungsten lamp
 * gives warm-looking light). The convention is borrowed from Lightroom and
 * matches the existing `KelvinPanel` slider semantics and the backend's
 * `temperature`-delta resolvers (warm grade → +K delta → higher absolute
 * kelvin → image warms).
 *
 * Every stored kelvin value in the codebase MUST be in this shader convention
 * so it can flow into `u_kelvin` verbatim. The Time-of-Day anchor tables
 * (JS + Python) follow this rule.
 *
 * For UI affordances that need to display the *perceptual* colour of a
 * stored kelvin (gradient strips, swatch chips), translate back to physical
 * kelvin via `shaderKelvinToDisplayKelvin` before calling any
 * Planckian-locus colour function (e.g. `kelvinToRgb`). Without this
 * translation, a "golden hour" anchor (stored as e.g. 9600) would render
 * as a cool-blue swatch — the inverse of what the image will look like.
 */

export const KELVIN_NEUTRAL = 6500;

/**
 * Reflect a stored shader-kelvin around the neutral daylight point to get the
 * physical kelvin whose Planckian colour matches the image's apparent warmth.
 *
 * Symmetric: `shaderKelvinToDisplayKelvin(shaderKelvinToDisplayKelvin(x)) === x`.
 */
export function shaderKelvinToDisplayKelvin(stored: number): number {
  return 2 * KELVIN_NEUTRAL - stored;
}
