import { maskSnippet } from './mask-snippet.glsl';

/** Single-pass unsharp via a 3x3 Laplacian, applied to LUMINANCE only.
 *  amount in 0..1 (registry-scaled).
 *
 *  Running the Laplacian on RGB independently boosts JPEG chroma noise into
 *  colored speckle (channels disagree on high-frequency content). Taking the
 *  luminance of the Laplacian and adding that scalar to all three channels
 *  preserves edge detection on real edges while suppressing chroma noise
 *  amplification.
 */
export const sharpenFragment = `#version 300 es
precision highp float;
${maskSnippet}
in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform vec2 u_texel;
uniform float u_amount;   // 0..1

const vec3 LUMA709 = vec3(0.2126, 0.7152, 0.0722);

void main() {
  vec4 texel = texture(u_texture, v_texCoord);
  vec3 c = texel.rgb;
  vec3 sum = vec3(0.0);
  sum += texture(u_texture, v_texCoord + vec2(-u_texel.x, 0.0)).rgb;
  sum += texture(u_texture, v_texCoord + vec2( u_texel.x, 0.0)).rgb;
  sum += texture(u_texture, v_texCoord + vec2(0.0, -u_texel.y)).rgb;
  sum += texture(u_texture, v_texCoord + vec2(0.0,  u_texel.y)).rgb;
  vec3 laplacian = c * 4.0 - sum;          // high-frequency detail
  float lumaLap = dot(laplacian, LUMA709); // scalar luma component
  vec3 sharpened = c + vec3(lumaLap) * u_amount;
  vec4 adjusted = vec4(sharpened, texel.a);
  fragColor = applyMask(texel, adjusted, v_texCoord);
}
`;
