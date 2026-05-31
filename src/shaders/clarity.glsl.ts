import { maskSnippet } from './mask-snippet.glsl';

/** Clarity = large-radius unsharp. Combines the original with a blurred copy:
 *  out = original + amount * (original - blurred). */
export const clarityFragment = `#version 300 es
precision highp float;
${maskSnippet}
in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;   // original
uniform sampler2D u_blurred;   // blurred copy
uniform float u_amount;        // 0..1

void main() {
  vec4 texel = texture(u_texture, v_texCoord);
  vec3 blurred = texture(u_blurred, v_texCoord).rgb;
  vec3 detail = texel.rgb - blurred;
  vec3 result = texel.rgb + detail * u_amount;
  vec4 adjusted = vec4(clamp(result, 0.0, 1.0), texel.a);
  fragColor = applyMask(texel, adjusted, v_texCoord);
}
`;
