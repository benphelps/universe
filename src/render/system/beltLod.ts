export const BELT_MESH_MIN_ANGULAR_RADIUS = 0.002;
export const BELT_MESH_FULL_ANGULAR_RADIUS = 0.004;

/** The glint yields only to an admitted mesh, through this shared interval. */
export const BELT_LOD_GLSL = /* glsl */ `
float beltMeshWeight(float angularRadius) {
  return smoothstep(${BELT_MESH_MIN_ANGULAR_RADIUS}, ${BELT_MESH_FULL_ANGULAR_RADIUS}, angularRadius);
}
`;
