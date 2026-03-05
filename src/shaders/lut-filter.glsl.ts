export const lutFilterFragment = `#version 300 es
precision highp float;
precision highp sampler3D;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform sampler3D u_lut;
uniform float u_intensity; // 0..1 blend with original

void main() {
  vec4 texel = texture(u_texture, v_texCoord);
  vec3 original = texel.rgb;

  // Scale to LUT coordinates — sample from center of texels
  vec3 lutCoord = clamp(original, 0.0, 1.0);
  vec3 filtered = texture(u_lut, lutCoord).rgb;

  // Blend based on intensity
  vec3 result = mix(original, filtered, u_intensity);

  fragColor = vec4(clamp(result, 0.0, 1.0), texel.a);
}
`;
