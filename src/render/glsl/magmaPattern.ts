/**
 * The magma-sea surface, shared by the walk-up tile material and the
 * distant sphere: both evaluate it in the planet's kilometer frame with
 * the planet's seed, so the same plates and paterae sit in the same
 * places at every distance. Requires SIMPLEX_NOISE_GLSL and
 * CELLULAR_GLSL above it.
 */
export const MAGMA_PATTERN_GLSL = /* glsl */ `
vec3 magmaGlow(vec3 wKm, vec3 seed, float timeDays, float texelKm) {
  float drift = timeDays * 0.15;

  // Chilled crust rafts: polygonal plates a few km wide drifting on
  // the melt, which shows through the seams between them.
  vec3 q = (wKm + seed * 13.7) * 0.4 + vec3(drift * 0.12, 0.0, drift * 0.07);
  vec2 plates = cellularF12(q);
  float crack = 1.0 - smoothstep(0.0, 0.16, plates.y - plates.x);
  vec2 subPlates = cellularF12(q * 3.4 + seed.yzx);
  crack = max(crack, 0.55 * (1.0 - smoothstep(0.0, 0.24, subPlates.y - subPlates.x)));

  // Below the plate scale the lattice hands off to its mean: orbit
  // sees calm ember glow, not per-pixel speckle.
  crack = mix(0.12, crack, 1.0 - smoothstep(0.5, 2.4, texelKm));

  // Open melt pools cluster along active provinces, the way paterae
  // do — a uniform sprinkle reads as noise from orbit.
  float cluster = 0.5 + 0.5 * snoise(wKm * 0.0025 + seed.yxz);
  float activity = 0.5 + 0.5 * snoise(wKm * 0.012 + seed.zxy + vec3(0.0, drift * 0.2, 0.0));
  float open = smoothstep(0.82, 0.98, activity * (0.45 + 0.75 * cluster));

  return vec3(1.0, 0.3, 0.05) * (0.05 + 1.4 * crack + 1.1 * open)
    * (0.55 + 0.45 * activity);
}
`;
