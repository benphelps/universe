/** Slant through a thin condensate layer above a unit-radius deep deck.
 * The ray meets the elevated layer at a steeper angle than it leaves the
 * deck. Using the deck's horizon airmass makes an artificial black shadow. */
export function upperCloudAirmass(cosine: number, altitudeRatio: number): number {
  const h = Math.max(altitudeRatio, 0);
  return (1 + h) / Math.sqrt(Math.max(cosine * cosine + h * (2 + h), 1e-8));
}

export const GIANT_CLOUD_TRANSPORT_GLSL = /* glsl */ `
float upperCloudAirmass(float cosine, float altitudeRatio) {
  float h = max(altitudeRatio, 0.0);
  return (1.0 + h) / sqrt(max(cosine * cosine + h * (2.0 + h), 1e-8));
}

// Conservative scattering-slab closure, also used for transmitted cloud
// illumination by the volume-cloud renderer. Extinction redistributes light;
// it must not extinguish the sky as though the condensate were black smoke.
float cloudDiffuseTransmission(float opticalDepth) {
  return 1.0 / (1.0 + 0.75 * max(opticalDepth, 0.0));
}
vec3 lightThroughUpperCloud(vec3 totalLight, vec3 directLight, float sunDepth,
    float sunMass, float localDepth) {
  vec3 skyLight = max(totalLight - directLight, vec3(0.0));
  // The direct beam plus its forward-scattered flux. Hemispheric skylight
  // crosses the local overhead cloud, not a displaced sun-shadow sample.
  return directLight * cloudDiffuseTransmission(sunDepth * sunMass)
    + skyLight * cloudDiffuseTransmission(2.0 * localDepth);
}
`;
