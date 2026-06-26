import { maskSnippet } from './mask-snippet.glsl';

export const curvesFragment = `#version 300 es
precision highp float;
${maskSnippet}
in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform sampler2D u_lut_rgb;
uniform sampler2D u_lut_red;
uniform sampler2D u_lut_green;
uniform sampler2D u_lut_blue;

void main() {
  vec4 texel = texture(u_texture, v_texCoord);
  vec3 color = texel.rgb;

  // Apply per-channel curves via LUT lookup
  // Sample at the center of the texel to avoid interpolation artifacts
  color.r = texture(u_lut_red, vec2(color.r, 0.5)).r;
  color.g = texture(u_lut_green, vec2(color.g, 0.5)).r;
  color.b = texture(u_lut_blue, vec2(color.b, 0.5)).r;

  // Apply master RGB curve
  color.r = texture(u_lut_rgb, vec2(color.r, 0.5)).r;
  color.g = texture(u_lut_rgb, vec2(color.g, 0.5)).r;
  color.b = texture(u_lut_rgb, vec2(color.b, 0.5)).r;

  vec4 adjusted = vec4(color, texel.a);
  fragColor = applyMask(texel, adjusted, v_texCoord);
}
`;
