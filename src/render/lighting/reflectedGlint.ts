/** A diffuse-sphere phase approximation, normalized at full phase.
 * Rough regolith/opposition surges need a calibrated asteroid phase law. */
export const REFLECTED_GLINT_GLSL = /* glsl */ `
float reflectedPhase(vec3 toSun, vec3 toEye) {
  float cosine = clamp(dot(normalize(toSun), normalize(toEye)), -1.0, 1.0);
  float angle = acos(cosine);
  return max(0.0, (sqrt(max(0.0, 1.0 - cosine * cosine))
    + (3.14159265359 - angle) * cosine) / 3.14159265359);
}

// Existing adapted glint display curve, with no positive flux floor.
// Zero illumination must stay black, at every observer distance.
float reflectedGlintEnergy(float flux) {
  return clamp(0.055 * pow(max(0.0, flux) * 131072.0, 0.36), 0.0, 1.7);
}
`;
