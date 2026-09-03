/**
 * World-space normal under a non-uniform scale. Bodies are squashed
 * along their spin axis for oblateness, so the model matrix is R·S
 * with S diagonal: its inverse transpose is R·S⁻¹, reached by dividing
 * the normal by each column's squared length before the transform.
 * Rotating the normal by mat3(modelMatrix) alone tilts it toward the
 * poles and shifts the terminator on every flattened body.
 */
export const WORLD_NORMAL_GLSL = /* glsl */ `
vec3 worldNormal(mat4 model, vec3 n) {
  mat3 m = mat3(model);
  vec3 s2 = vec3(dot(m[0], m[0]), dot(m[1], m[1]), dot(m[2], m[2]));
  return normalize(m * (n / max(s2, vec3(1e-12))));
}
`;
