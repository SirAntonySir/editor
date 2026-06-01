import { maskSnippet } from './mask-snippet.glsl';

export const kelvinFragment = `#version 300 es
precision highp float;
${maskSnippet}
in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform float u_kelvin; // 1000 to 15000
uniform float u_tint;   // -1 to 1

// Convert color temperature (Kelvin) to RGB using Tanner Helland's algorithm
// based on the Planckian locus approximation
vec3 kelvinToRGB(float kelvin) {
  float temp = kelvin / 100.0;
  float r, g, b;

  // Red
  if (temp <= 66.0) {
    r = 255.0;
  } else {
    r = temp - 60.0;
    r = 329.698727446 * pow(r, -0.1332047592);
    r = clamp(r, 0.0, 255.0);
  }

  // Green
  if (temp <= 66.0) {
    g = temp;
    g = 99.4708025861 * log(g) - 161.1195681661;
    g = clamp(g, 0.0, 255.0);
  } else {
    g = temp - 60.0;
    g = 288.1221695283 * pow(g, -0.0755148492);
    g = clamp(g, 0.0, 255.0);
  }

  // Blue
  if (temp >= 66.0) {
    b = 255.0;
  } else if (temp <= 19.0) {
    b = 0.0;
  } else {
    b = temp - 10.0;
    b = 138.5177312231 * log(b) - 305.0447927307;
    b = clamp(b, 0.0, 255.0);
  }

  return vec3(r, g, b) / 255.0;
}

void main() {
  vec4 texel = texture(u_texture, v_texCoord);
  vec3 color = texel.rgb;

  // Convention: slider RIGHT (higher u_kelvin) → image WARMER; slider LEFT
  // (lower u_kelvin) → image COOLER. Matches Lightroom-style WB sliders
  // where the slider value represents the colour temperature you're
  // correcting FOR — to add warmth you tell the editor the scene was lit
  // by warmer light, which it then compensates back. The inverse ratio
  // (daylight / kelvinColor) produces that direction; the prior version
  // mapped the slider the wrong way round.
  vec3 kelvinColor = kelvinToRGB(u_kelvin);
  vec3 daylight = kelvinToRGB(6500.0);
  vec3 multiplier = daylight / kelvinColor;

  color *= multiplier;

  // Tint (shift green-magenta axis)
  color.g += u_tint * 0.1;

  vec4 adjusted = vec4(clamp(color, 0.0, 1.0), texel.a);
  fragColor = applyMask(texel, adjusted, v_texCoord);
}
`;
