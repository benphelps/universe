/**
 * The magma-sea surface, shared by the walk-up tile material and the
 * distant sphere: both evaluate it in the planet's kilometer frame with
 * the planet's seed, so the same melt streams sit in the same places at
 * every distance. Flow-noise construction: every octave rides a
 * displacement field whose direction curls over time, so the melt
 * churns and streams zonally instead of sitting in static cells;
 * sin-ridged octaves marble it into filaments, and a reciprocal
 * palette turns the filament floor white-hot against dark cooling
 * crust. Requires SIMPLEX_NOISE_GLSL above it.
 */
export const MAGMA_PATTERN_GLSL = /* glsl */ `
vec3 magmaRotAxis(vec3 v, vec3 axis, float theta) {
  float c = cos(theta);
  float s = sin(theta);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

vec3 magmaGrad(vec3 p) {
  float e = 0.25;
  float c = snoise(p);
  return vec3(
    snoise(p + vec3(e, 0.0, 0.0)) - c,
    snoise(p + vec3(0.0, e, 0.0)) - c,
    snoise(p + vec3(0.0, 0.0, e)) - c
  );
}

/** Nine sin-ridged octaves from ~180 km channels down to ~0.7 km
 *  filaments, so the melt keeps the same character at every altitude.
 *  The three coarsest skip the flow displacement — invisible at their
 *  scale — and each octave fades at its own Nyquist limit with its
 *  mean substituted (texel0 is the sample footprint in domain units),
 *  so the reciprocal palette's brightness holds at every distance and
 *  no sub-texel octave aliases into quilting. */
float meltFlow(vec3 p0, vec3 radial, vec3 east, float t, float texel0) {
  float z = 2.0;
  float rz = 0.0;
  float used = 0.0;
  float wavelength = 1.0;
  vec3 p = p0;
  vec3 bp = p0;
  for (int i = 1; i <= 9; i++) {
    float fade = 1.0 - smoothstep(0.2, 0.45, texel0 / wavelength);
    if (fade <= 0.0) break;
    p += east * (t * 0.6);
    bp += east * (t * 1.9);
    if (i > 3) {
      vec3 g = magmaGrad(p * (0.34 * float(i - 3)) + vec3(0.0, t * 0.35, 0.0));
      g = magmaRotAxis(g, radial, t * 2.1 - dot(p, east + radial.yzx) * 1.3);
      p += g * 0.5;
    }
    rz += (sin(snoise(p) * 6.0) * 0.5 + 0.5) * fade / z;
    used += fade / z;
    p = mix(bp, p, 0.77);
    z *= 1.4;
    p *= 2.0;
    bp *= 1.9;
    wavelength *= 0.5;
  }
  return rz + 0.5 * (1.664 - used);
}

vec3 magmaGlow(vec3 wKm, vec3 seed, float timeDays, float texelKm) {
  vec3 radial = normalize(wKm);
  vec3 east = cross(vec3(0.0, 1.0, 0.0), radial);
  float len = length(east);
  east = len > 0.05 ? east / len : vec3(1.0, 0.0, 0.0);
  float rz = meltFlow((wKm + seed * 13.7) * 0.0055, radial, east, timeDays * 1.5,
    texelKm * 0.0055);
  // Regional vigor: broad provinces run hotter, the way real lava
  // fields vary — smooth, no sprinkle.
  float activity = 0.65 + 0.35 * snoise(wKm * 0.002 + seed.yxz);
  return pow(vec3(0.35, 0.12, 0.021) / max(rz, 0.1), vec3(1.35)) * activity;
}
`;
