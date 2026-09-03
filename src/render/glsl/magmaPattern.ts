import {
  SILICATE_LIQUIDUS_K,
  SILICATE_SOLIDUS_K,
} from '../../universe/planet/thermodynamics';

/**
 * Temperature structure for an exposed silicate melt. The field is shared by
 * the orbital sphere and streamed ground tiles, evaluated in planet-space km.
 * Its color and total radiance are deliberately absent: callers derive those
 * from the magma temperature's blackbody emission.
 *
 * Broad, advected cells carry most of the contrast. Finer shear and capillary
 * structure is admitted only when the pixel footprint resolves it, which keeps
 * the same surface calm from orbit and detailed near ground level without the
 * former orange crack lattice aliasing into continents.
 * Requires SIMPLEX_NOISE_GLSL above it.
 */
export const MAGMA_PATTERN_GLSL = /* glsl */ `
float magmaFilteredNoise(vec3 p, float footprintInDomain) {
  float resolved = 1.0 - smoothstep(0.18, 0.48, footprintInDomain);
  return mix(0.5, 0.5 + 0.5 * snoise(p), resolved);
}

vec3 magmaSurfaceState(
  vec3 wKm,
  vec3 seed,
  float timeDays,
  float texelKm,
  float meanTemperatureK,
  float dayNightDeltaK,
  float muSun
) {
  vec3 radial = normalize(wKm);
  vec3 east = cross(vec3(0.0, 1.0, 0.0), radial);
  float eastLength = length(east);
  east = eastLength > 0.05 ? east / eastLength : vec3(1.0, 0.0, 0.0);
  vec3 north = normalize(cross(radial, east));

  float phase = timeDays * 0.32;
  vec3 base = (wKm + seed * 19.3) * 0.0042;
  vec3 advect = east * phase + north * (0.18 * sin(phase * 0.37));
  float broad = magmaFilteredNoise(base + advect, texelKm * 0.0042);

  // Convection bends the smaller structures instead of drawing a static
  // cellular texture over them.
  vec3 warp = (east * (broad - 0.5) + north * (0.5 - broad)) * 1.7;
  float cell = magmaFilteredNoise(
    base * 6.0 + warp + north * phase * 0.7,
    texelKm * 0.0252
  );
  float shear = magmaFilteredNoise(
    base * 32.0 + warp * 2.3 - east * phase * 2.1,
    texelKm * 0.1344
  );
  float ripple = magmaFilteredNoise(
    base * 210.0 + vec3(phase * 4.0) + warp * 4.0,
    texelKm * 0.882
  );
  float micro = magmaFilteredNoise(
    base * 1300.0 - north * phase * 7.0,
    texelKm * 5.46
  );

  float structure = clamp(
    0.52 * broad + 0.25 * cell + 0.13 * shear + 0.07 * ripple + 0.03 * micro,
    0.0,
    1.0
  );

  // Convective temperature differences are a modest fraction of the
  // composition's solidus-to-liquidus interval. Whether a patch can carry a
  // chilled skin follows from that local temperature, not a painted mask.
  const float SILICATE_SOLIDUS = ${SILICATE_SOLIDUS_K.toFixed(1)};
  const float SILICATE_LIQUIDUS = ${SILICATE_LIQUIDUS_K.toFixed(1)};
  float phaseSpanK = SILICATE_LIQUIDUS - SILICATE_SOLIDUS;
  float localReferenceK = meanTemperatureK
    + dayNightDeltaK * clamp(muSun, -1.0, 1.0) * 0.5;
  float localTemperatureK = max(
    300.0,
    localReferenceK + (structure - 0.5) * phaseSpanK * 0.16
  );
  float liquidFraction = smoothstep(
    SILICATE_SOLIDUS,
    SILICATE_LIQUIDUS,
    localTemperatureK
  );
  return vec3(localTemperatureK, liquidFraction, structure);
}
`;
