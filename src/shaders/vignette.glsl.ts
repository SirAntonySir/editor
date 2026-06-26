import { maskSnippet } from './mask-snippet.glsl';

/** Radial vignette. amount in -1..1 (negative darkens edges, positive
 *  brightens), midpoint/feather in 0..1, roundness in -1..1 (>0 → circle,
 *  <0 → oval). Aspect-corrected via u_texel ratio. */
export const vignetteFragment = `#version 300 es
precision highp float;
${maskSnippet}
in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform vec2 u_texel;
uniform float u_amount;     // -1..1
uniform float u_midpoint;   // 0..1
uniform float u_feather;    // 0..1
uniform float u_roundness;  // -1..1

void main() {
  vec4 texel = texture(u_texture, v_texCoord);
  vec3 c = texel.rgb;

  // Aspect correction: u_texel = (1/width, 1/height). aspect = w/h.
  float aspect = u_texel.y / u_texel.x;
  vec2 uv = v_texCoord - 0.5;

  // roundness>0 → squish toward circle; roundness<0 → exaggerate aspect.
  float circle = clamp(u_roundness, 0.0, 1.0);
  float oval   = clamp(-u_roundness, 0.0, 1.0);
  uv.x *= mix(aspect, 1.0, circle);
  uv.y *= mix(1.0, aspect, oval);

  float d = length(uv) * 1.4142136;  // 0..~1 from center to corner
  float start = u_midpoint;
  float end   = clamp(u_midpoint + u_feather, start + 1e-4, 2.0);
  float falloff = smoothstep(start, end, d); // 0 in center → 1 at edge

  float darken  = max(-u_amount, 0.0);
  float lighten = max( u_amount, 0.0);
  vec3 result = c * (1.0 - falloff * darken);
  result = mix(result, vec3(1.0), falloff * lighten);

  vec4 adjusted = vec4(result, texel.a);
  fragColor = applyMask(texel, adjusted, v_texCoord);
}
`;
