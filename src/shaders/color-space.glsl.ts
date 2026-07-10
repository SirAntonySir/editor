// src/shaders/color-space.glsl.ts
/** Shared RGB↔HSL helpers (GLSL ES 3.00). Included verbatim into shaders that
 *  need per-pixel hue/sat/lum manipulation (basic adjustments, HSL). */
export const colorSpaceSnippet = /* glsl */`
vec3 rgb2hsl(vec3 c) {
  float maxC = max(c.r, max(c.g, c.b));
  float minC = min(c.r, min(c.g, c.b));
  float l = (maxC + minC) * 0.5;
  float s = 0.0;
  float h = 0.0;
  if (maxC != minC) {
    float d = maxC - minC;
    s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);
    if (maxC == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (maxC == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h, s, l);
}

float hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}

vec3 hsl2rgb(vec3 hsl) {
  float h = hsl.x, s = hsl.y, l = hsl.z;
  if (s == 0.0) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(
    hue2rgb(p, q, h + 1.0 / 3.0),
    hue2rgb(p, q, h),
    hue2rgb(p, q, h - 1.0 / 3.0)
  );
}
`;

/** sRGB ↔ linear transfer functions (piecewise IEC 61966-2-1, not a 2.2 pow
 *  approximation). For adjustments that model light physically — white balance
 *  multipliers, exposure — which are only correct on linear values; the
 *  pipeline's textures are sRGB-gamma-encoded. Inputs are clamped at 0 before
 *  pow() (negative lobes from prior passes would be undefined); values >1 from
 *  the 16F framebuffers pass through the pow branch unclamped. */
export const srgbTransferSnippet = /* glsl */`
vec3 srgbToLinear(vec3 c) {
  c = max(c, vec3(0.0));
  vec3 low  = c / 12.92;
  vec3 high = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(high, low, vec3(lessThanEqual(c, vec3(0.04045))));
}

vec3 linearToSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  vec3 low  = c * 12.92;
  vec3 high = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(high, low, vec3(lessThanEqual(c, vec3(0.0031308))));
}
`;
