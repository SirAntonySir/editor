export const blendFragment = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_base;
uniform sampler2D u_blend;
uniform float u_opacity;
uniform int u_blendMode;

vec3 blendMultiply(vec3 base, vec3 blend) { return base * blend; }
vec3 blendScreen(vec3 base, vec3 blend) { return 1.0 - (1.0 - base) * (1.0 - blend); }

vec3 blendOverlay(vec3 base, vec3 blend) {
  return mix(
    2.0 * base * blend,
    1.0 - 2.0 * (1.0 - base) * (1.0 - blend),
    step(0.5, base)
  );
}

vec3 blendDarken(vec3 base, vec3 blend) { return min(base, blend); }
vec3 blendLighten(vec3 base, vec3 blend) { return max(base, blend); }

vec3 blendSoftLight(vec3 base, vec3 blend) {
  return mix(
    2.0 * base * blend + base * base * (1.0 - 2.0 * blend),
    sqrt(base) * (2.0 * blend - 1.0) + 2.0 * base * (1.0 - blend),
    step(0.5, blend)
  );
}

vec3 blendHardLight(vec3 base, vec3 blend) {
  return mix(
    2.0 * base * blend,
    1.0 - 2.0 * (1.0 - base) * (1.0 - blend),
    step(0.5, blend)
  );
}

void main() {
  vec4 baseColor = texture(u_base, v_texCoord);
  vec4 blendColor = texture(u_blend, v_texCoord);

  vec3 result;
  if (u_blendMode == 1) result = blendMultiply(baseColor.rgb, blendColor.rgb);
  else if (u_blendMode == 2) result = blendScreen(baseColor.rgb, blendColor.rgb);
  else if (u_blendMode == 3) result = blendOverlay(baseColor.rgb, blendColor.rgb);
  else if (u_blendMode == 4) result = blendDarken(baseColor.rgb, blendColor.rgb);
  else if (u_blendMode == 5) result = blendLighten(baseColor.rgb, blendColor.rgb);
  else if (u_blendMode == 6) result = blendSoftLight(baseColor.rgb, blendColor.rgb);
  else if (u_blendMode == 7) result = blendHardLight(baseColor.rgb, blendColor.rgb);
  else result = blendColor.rgb; // normal

  // Mix with base using opacity
  result = mix(baseColor.rgb, result, u_opacity);

  fragColor = vec4(result, baseColor.a);
}
`;
