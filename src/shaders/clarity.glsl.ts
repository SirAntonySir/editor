import { maskSnippet } from './mask-snippet.glsl';

/** Clarity = large-radius unsharp on LUMINANCE only:
 *  detail   = luma(original) - luma(blurred)
 *  out.rgb  = original.rgb + detail * amount   (same delta in all channels)
 *
 *  Operating only on the luminance component keeps clarity from amplifying
 *  per-channel chroma noise: classic colored speckle on JPEG sources comes
 *  from the unsharp pass running independently on R/G/B, so any RGB-
 *  discordant noise gets boosted into visible colored dots. Adding the
 *  scalar luminance delta to all three channels eliminates that path while
 *  still sharpening (or softening) texture exactly as before in luminance.
 *
 *  amount range: -1..1 (mapped from UI range -100..100 via /100 scale)
 *  - positive: sharpens mid-tone texture (classic clarity / local contrast)
 *  - zero:     pass-through
 *  - negative: softens / hazes (subtracts luma detail → reduces local contrast).
 *              No longer collapses to a blurred copy at -1; chroma is preserved.
 */
export const clarityFragment = `#version 300 es
precision highp float;
${maskSnippet}
in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_texture;   // original
uniform sampler2D u_blurred;   // blurred copy (large-radius Gaussian)
uniform float u_amount;        // -1..1

const vec3 LUMA709 = vec3(0.2126, 0.7152, 0.0722);

void main() {
  vec4 texel = texture(u_texture, v_texCoord);
  vec3 blurred = texture(u_blurred, v_texCoord).rgb;
  // Luminance-only high-pass: scalar delta, added equally to R, G, B.
  float detail = dot(texel.rgb - blurred, LUMA709);
  vec3 result = texel.rgb + vec3(detail) * u_amount;
  vec4 adjusted = vec4(result, texel.a);
  fragColor = applyMask(texel, adjusted, v_texCoord);
}
`;
