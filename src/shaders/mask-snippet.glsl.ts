export const maskSnippet = /* glsl */`
uniform sampler2D u_mask;
uniform int u_useMask;

vec4 applyMask(vec4 base, vec4 adjusted, vec2 uv) {
  if (u_useMask == 0) return adjusted;
  float a = texture(u_mask, uv).r;
  return mix(base, adjusted, a);
}
`;
