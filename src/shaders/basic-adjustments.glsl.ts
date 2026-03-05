export const basicAdjustmentsFragment = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform float u_brightness;  // -1 to 1
uniform float u_contrast;    // -1 to 1
uniform float u_saturation;  // -1 to 1
uniform float u_hue;         // radians
uniform float u_temperature; // -1 to 1

vec3 rgb2hsl(vec3 c) {
  float maxC = max(c.r, max(c.g, c.b));
  float minC = min(c.r, min(c.g, c.b));
  float l = (maxC + minC) * 0.5;
  float s = 0.0;
  float h = 0.0;

  if (maxC != minC) {
    float d = maxC - minC;
    s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);
    if (maxC == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (maxC == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h, s, l);
}

float hue2rgb(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}

vec3 hsl2rgb(vec3 hsl) {
  float h = hsl.x, s = hsl.y, l = hsl.z;
  if (s == 0.0) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(
    hue2rgb(p, q, h + 1.0 / 3.0),
    hue2rgb(p, q, h),
    hue2rgb(p, q, h - 1.0 / 3.0)
  );
}

void main() {
  vec4 texel = texture(u_texture, v_texCoord);
  vec3 color = texel.rgb;

  // Brightness
  color += u_brightness;

  // Contrast
  float contrastFactor = 1.0 + u_contrast;
  color = (color - 0.5) * contrastFactor + 0.5;

  // Saturation
  float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(lum), color, 1.0 + u_saturation);

  // Hue rotation
  if (abs(u_hue) > 0.001) {
    vec3 hsl = rgb2hsl(clamp(color, 0.0, 1.0));
    hsl.x = fract(hsl.x + u_hue / (2.0 * 3.14159265));
    color = hsl2rgb(hsl);
  }

  // Temperature (shift blue-orange axis)
  color.r += u_temperature * 0.1;
  color.b -= u_temperature * 0.1;

  fragColor = vec4(clamp(color, 0.0, 1.0), texel.a);
}
`;
