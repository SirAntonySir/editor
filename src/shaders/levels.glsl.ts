export const levelsFragment = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform float u_inBlack;   // 0..1 (normalized from 0..255)
uniform float u_inWhite;   // 0..1
uniform float u_gamma;     // 0.1..10 (midtones)
uniform float u_outBlack;  // 0..1
uniform float u_outWhite;  // 0..1

void main() {
  vec4 texel = texture(u_texture, v_texCoord);
  vec3 color = texel.rgb;

  // Input levels: remap from [inBlack, inWhite] to [0, 1]
  float range = max(u_inWhite - u_inBlack, 0.001);
  color = clamp((color - u_inBlack) / range, 0.0, 1.0);

  // Gamma (midtones)
  color = pow(color, vec3(1.0 / max(u_gamma, 0.01)));

  // Output levels: remap from [0, 1] to [outBlack, outWhite]
  color = mix(vec3(u_outBlack), vec3(u_outWhite), color);

  fragColor = vec4(clamp(color, 0.0, 1.0), texel.a);
}
`;
