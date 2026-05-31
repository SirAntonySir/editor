import { maskSnippet } from './mask-snippet.glsl';

/** Single-pass unsharp via a 3x3 Laplacian. amount in 0..1 (registry-scaled). */
export const sharpenFragment = `#version 300 es
precision highp float;
${maskSnippet}
in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform vec2 u_texel;
uniform float u_amount;   // 0..1

void main() {
  vec4 texel = texture(u_texture, v_texCoord);
  vec3 c = texel.rgb;
  vec3 sum = vec3(0.0);
  sum += texture(u_texture, v_texCoord + vec2(-u_texel.x, 0.0)).rgb;
  sum += texture(u_texture, v_texCoord + vec2( u_texel.x, 0.0)).rgb;
  sum += texture(u_texture, v_texCoord + vec2(0.0, -u_texel.y)).rgb;
  sum += texture(u_texture, v_texCoord + vec2(0.0,  u_texel.y)).rgb;
  vec3 laplacian = c * 4.0 - sum;          // high-frequency detail
  vec3 sharpened = c + laplacian * u_amount;
  vec4 adjusted = vec4(clamp(sharpened, 0.0, 1.0), texel.a);
  fragColor = applyMask(texel, adjusted, v_texCoord);
}
`;
