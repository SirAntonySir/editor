export const lutFragment = `#version 300 es
precision highp float;
precision highp sampler3D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform sampler3D u_lut;
uniform float u_lutSize;

void main() {
  vec4 texel = texture(u_texture, v_texCoord);

  // Scale coordinates to sample from center of texels
  float scale = (u_lutSize - 1.0) / u_lutSize;
  float offset = 0.5 / u_lutSize;
  vec3 lutCoord = clamp(texel.rgb, 0.0, 1.0) * scale + offset;

  vec3 color = texture(u_lut, lutCoord).rgb;
  fragColor = vec4(color, texel.a);
}
`;
