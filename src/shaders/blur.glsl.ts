import { maskSnippet } from './mask-snippet.glsl';

/** Separable Gaussian blur — run twice (horizontal then vertical) with a
 *  different u_direction. 9-tap fixed kernel scaled by u_radius. */
export const blurFragment = `#version 300 es
precision highp float;
${maskSnippet}
in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform vec2 u_texel;
uniform vec2 u_direction;  // (1,0)*texel.x for H, (0,1)*texel.y for V
uniform float u_radius;    // 0..1 (registry-scaled)

void main() {
  vec4 texel = texture(u_texture, v_texCoord);
  float weights[5] = float[5](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
  vec2 stepv = u_direction * u_radius * 8.0;
  vec3 acc = texture(u_texture, v_texCoord).rgb * weights[0];
  for (int i = 1; i < 5; i++) {
    vec2 off = stepv * float(i);
    acc += texture(u_texture, v_texCoord + off).rgb * weights[i];
    acc += texture(u_texture, v_texCoord - off).rgb * weights[i];
  }
  vec4 adjusted = vec4(acc, texel.a);
  fragColor = applyMask(texel, adjusted, v_texCoord);
}
`;
