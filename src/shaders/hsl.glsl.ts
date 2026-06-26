// src/shaders/hsl.glsl.ts
import { maskSnippet } from './mask-snippet.glsl';
import { colorSpaceSnippet } from './color-space.glsl';

/** 8-band targeted HSL. Each band has a hue-rotation, saturation-scale, and
 *  luminance-shift, weighted by the pixel's circular hue distance to the band
 *  centre. Uniform arrays are addressed per-band from the pipeline. */
export const hslFragment = `#version 300 es
precision highp float;
${maskSnippet}
${colorSpaceSnippet}
in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform float u_hslHue[8];   // each -1..1
uniform float u_hslSat[8];   // each -1..1
uniform float u_hslLum[8];   // each -1..1

// Band centres in normalized hue [0,1): red, orange, yellow, green, aqua, blue, purple, magenta
const float CENTERS[8] = float[8](0.0, 0.0833, 0.1667, 0.3333, 0.5, 0.6667, 0.75, 0.8333);

float bandWeight(float h, float center) {
  float d = abs(h - center);
  d = min(d, 1.0 - d);          // circular distance
  return max(0.0, 1.0 - d / 0.0833);  // triangular falloff, ~30deg half-width
}

void main() {
  vec4 texel = texture(u_texture, v_texCoord);
  vec3 hsl = rgb2hsl(clamp(texel.rgb, 0.0, 1.0));

  float hueShift = 0.0, satScale = 0.0, lumShift = 0.0, wsum = 0.0;
  for (int i = 0; i < 8; i++) {
    float w = bandWeight(hsl.x, CENTERS[i]);
    hueShift += w * u_hslHue[i];
    satScale += w * u_hslSat[i];
    lumShift += w * u_hslLum[i];
    wsum += w;
  }
  if (wsum > 0.0) { hueShift /= wsum; satScale /= wsum; lumShift /= wsum; }

  hsl.x = fract(hsl.x + hueShift * 0.0833);          // max ~±30deg
  hsl.y = clamp(hsl.y * (1.0 + satScale), 0.0, 1.0);  // ±100%
  hsl.z = clamp(hsl.z + lumShift * 0.25, 0.0, 1.0);   // ±0.25 lightness

  vec3 rgb = hsl2rgb(hsl);
  vec4 adjusted = vec4(rgb, texel.a);
  fragColor = applyMask(texel, adjusted, v_texCoord);
}
`;
