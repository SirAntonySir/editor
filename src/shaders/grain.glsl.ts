import { maskSnippet } from './mask-snippet.glsl';

/** Procedural film-grain noise added to luminance. amount/roughness in 0..1;
 *  size is a relative scale factor (1.0 ≈ 1px grain at native resolution). */
export const grainFragment = `#version 300 es
precision highp float;
${maskSnippet}
in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform vec2 u_texel;
uniform float u_amount;     // 0..1
uniform float u_size;       // ~0.5..2
uniform float u_roughness;  // 0..1

float hash11(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec4 texel = texture(u_texture, v_texCoord);
  vec3 c = texel.rgb;

  // Resolution-aware grid: smaller u_size => larger grain (zoom into noise).
  vec2 pix = v_texCoord / max(u_texel * u_size, vec2(1e-6));
  float fine   = hash11(floor(pix));
  float coarse = hash11(floor(pix * 0.5));
  float n = mix(fine, coarse, u_roughness) * 2.0 - 1.0;   // -1..1

  float offset = n * u_amount * 0.5;                       // ±0.5 max
  vec3 grained = clamp(c + vec3(offset), 0.0, 1.0);
  vec4 adjusted = vec4(grained, texel.a);
  fragColor = applyMask(texel, adjusted, v_texCoord);
}
`;
