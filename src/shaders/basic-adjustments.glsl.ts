import { maskSnippet } from './mask-snippet.glsl';
import { colorSpaceSnippet } from './color-space.glsl';

export const basicAdjustmentsFragment = `#version 300 es
precision highp float;
${maskSnippet}
${colorSpaceSnippet}
in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform float u_brightness;  // -1 to 1
uniform float u_contrast;    // -1 to 1
uniform float u_saturation;  // -1 to 1
uniform float u_hue;         // radians
uniform float u_temperature; // -1 to 1
uniform float u_exposure;    // -1 to 1
uniform float u_highlights;  // -1 to 1
uniform float u_shadows;     // -1 to 1
uniform float u_whites;      // -1 to 1
uniform float u_blacks;      // -1 to 1
uniform float u_vibrance;    // -1 to 1

void main() {
  vec4 texel = texture(u_texture, v_texCoord);
  vec3 color = texel.rgb;

  // Exposure (EV-stop, applied first)
  color *= pow(2.0, u_exposure);

  // Brightness
  color += u_brightness;

  // Contrast
  float contrastFactor = 1.0 + u_contrast;
  color = (color - 0.5) * contrastFactor + 0.5;

  // Highlights & Shadows
  float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float highlightMask = smoothstep(0.3, 0.8, lum);
  color += u_highlights * highlightMask * 0.5;
  float shadowMask = 1.0 - smoothstep(0.2, 0.7, lum);
  color += u_shadows * shadowMask * 0.5;

  // Whites & Blacks — act on the tonal extremes (vs highlights/shadows midtones)
  float whitesMask = smoothstep(0.6, 1.0, lum);
  color += u_whites * whitesMask * 0.5;
  float blacksMask = 1.0 - smoothstep(0.0, 0.4, lum);
  color += u_blacks * blacksMask * 0.5;

  // Saturation (recompute lum after tone changes)
  lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(lum), color, 1.0 + u_saturation);

  // Vibrance (smart saturation — boosts less-saturated pixels more)
  float maxC = max(color.r, max(color.g, color.b));
  float minC = min(color.r, min(color.g, color.b));
  float sat = (maxC - minC) / (maxC + 0.001);
  float vibAmount = u_vibrance * (1.0 - sat);
  color = mix(vec3(lum), color, 1.0 + vibAmount);

  // Hue rotation
  if (abs(u_hue) > 0.001) {
    vec3 hsl = rgb2hsl(clamp(color, 0.0, 1.0));
    hsl.x = fract(hsl.x + u_hue / (2.0 * 3.14159265));
    color = hsl2rgb(hsl);
  }

  // Temperature (shift blue-orange axis)
  color.r += u_temperature * 0.1;
  color.b -= u_temperature * 0.1;

  // No output clamp: 8-bit clamps at the FBO/present; the float (RAW-16)
  // path keeps >1.0 so a later adjustment can recover pushed highlights.
  vec4 adjusted = vec4(color, texel.a);
  fragColor = applyMask(texel, adjusted, v_texCoord);
}
`;
