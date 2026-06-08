import { maskSnippet } from './mask-snippet.glsl';
import { colorSpaceSnippet } from './color-space.glsl';

/** Two-tone split toning: tint shadows and highlights with independent hues,
 *  blended by luma. Hues in radians (deg2rad via registry), sats in 0..1,
 *  balance in -1..1 shifts the shadow/highlight cutoff. */
export const splitToneFragment = `#version 300 es
precision highp float;
${maskSnippet}
${colorSpaceSnippet}
in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform float u_shadowHue;     // radians
uniform float u_shadowSat;     // 0..1
uniform float u_highlightHue;  // radians
uniform float u_highlightSat;  // 0..1
uniform float u_balance;       // -1..1

const float TWO_PI = 6.28318530718;

void main() {
  vec4 texel = texture(u_texture, v_texCoord);
  vec3 c = texel.rgb;

  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  float threshold = 0.5 + u_balance * 0.25;          // 0.25..0.75
  float w_hi = smoothstep(threshold - 0.15, threshold + 0.15, luma);
  float w_lo = 1.0 - w_hi;

  vec3 shadowTint    = hsl2rgb(vec3(u_shadowHue    / TWO_PI, 1.0, 0.5));
  vec3 highlightTint = hsl2rgb(vec3(u_highlightHue / TWO_PI, 1.0, 0.5));

  // Soft tint: lerp luma toward tint, then re-mix with original by strength.
  vec3 tinted = c;
  tinted = mix(tinted, tinted * shadowTint    * 2.0, w_lo * u_shadowSat);
  tinted = mix(tinted, tinted * highlightTint * 2.0, w_hi * u_highlightSat);

  vec4 adjusted = vec4(clamp(tinted, 0.0, 1.0), texel.a);
  fragColor = applyMask(texel, adjusted, v_texCoord);
}
`;
