/** Shared by the streamer and both ground/fluid materials. */
export const TERRAIN_SPLIT_RATIO = 0.45;

export const TERRAIN_MORPH_GLSL = /* glsl */ `
uniform float uSplitRatio;

float terrainMorphWeight(vec3 reference, float tileKm) {
  // Both surfaces measure distance to the same unmorphed terrain vertex.
  // Independent water/ground distances would move their coast differently.
  float viewKm = length((modelViewMatrix * vec4(reference, 1.0)).xyz);
  float swapInKm = 2.0 * tileKm / uSplitRatio;
  return clamp((swapInKm - viewKm) / (0.8 * tileKm / uSplitRatio), 0.0, 1.0);
}

vec3 morphTerrainPosition(vec3 point, vec3 parentDelta, vec3 reference, float tileKm) {
  float blend = terrainMorphWeight(reference, tileKm);
  return point - parentDelta * (1.0 - blend);
}
`;
