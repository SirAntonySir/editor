import { maskSnippet } from './mask-snippet.glsl';

/** Clarity = large-radius unsharp. Combines the original with a blurred copy:
 *  out = original + amount * (original - blurred)
 *
 *  amount range: -1..1 (mapped from UI range -100..100 via /100 scale)
 *  - positive: sharpens mid-tone texture (classic clarity / local contrast)
 *  - zero:     pass-through
 *  - negative: softens / hazes (subtracts detail → blends toward blurred)
 *              At -1.0 the formula yields exactly `blurred`.
 */
export const clarityFragment = `#version 300 es
precision highp float;
${maskSnippet}
in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;   // original
uniform sampler2D u_blurred;   // blurred copy (large-radius Gaussian)
uniform float u_amount;        // -1..1

void main() {
  vec4 texel = texture(u_texture, v_texCoord);
  vec3 blurred = texture(u_blurred, v_texCoord).rgb;
  vec3 detail = texel.rgb - blurred;
  // positive: adds detail (sharpen); negative: subtracts detail (soften/haze)
  vec3 result = texel.rgb + detail * u_amount;
  vec4 adjusted = vec4(clamp(result, 0.0, 1.0), texel.a);
  fragColor = applyMask(texel, adjusted, v_texCoord);
}
`;
