import type { Characterization } from '../../universe/planet/types';

/** One procedural weather field shared by distant solid spheres and the
 *  focus cloud shell. Coverage decides where condensate exists; density
 *  and height remain separate so an overcast deck still has structure. */
export const CLOUD_PATTERN_GLSL = /* glsl */ `
uniform float uCloudCoverage;
uniform float uCloudOpticalDepth;
uniform float uCloudScale;
uniform float uCloudDrift;
uniform float uCloudRelief;
uniform float uCloudStellarBias;

vec3 cloudRotateY(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

// x is condensate density, y cloud-top height and z radiometric structure.
// Broad domain-warped weather systems establish the footprint; an
// anisotropic octave draws fronts through them and a finer octave erodes
// their edges. No one smooth fBm value owns shape, opacity and lighting.
vec3 cloudDeckSample(
  vec3 surfaceDir,
  float muSun,
  vec3 seedOffset,
  float timeDays
) {
  if (uCloudCoverage < 0.001) return vec3(0.0);

  float phase = timeDays * uCloudDrift;
  vec3 q = cloudRotateY(normalize(surfaceDir), phase);
  vec3 slow = q * 1.25 + seedOffset * 0.17;
  vec3 warp = vec3(
    snoise(slow),
    snoise(slow.yzx + 19.7),
    snoise(slow.zxy - 11.3)
  );
  q = normalize(q + 0.12 * warp);

  float scale = max(uCloudScale, 0.8);
  float broad = 0.5 + 0.5 * fbm(
    q * scale + seedOffset + vec3(0.0, 0.0, phase * 0.08)
  );
  // Meridionally narrow, zonally long: fronts rather than isotropic fog.
  vec3 frontP = vec3(q.x * 1.7, q.y * 0.72, q.z * 1.7) * scale;
  float front = 0.5 + 0.5 * snoise(frontP + seedOffset.zxy - vec3(phase * 0.05));
  float fine = 0.5 + 0.5 * snoise(
    q * scale * 5.2 + seedOffset.yzx + vec3(phase * 0.03, 0.0, -phase * 0.04)
  );

  float field = 0.78 * broad + 0.16 * front + 0.06 * fine;
  field += 0.12 * uCloudStellarBias * muSun;
  // The field is bell-shaped rather than uniformly distributed. This
  // sine approximation keeps the requested coverage useful near 0 and 1.
  float threshold = 0.5 + 0.23 * sin((0.5 - uCloudCoverage) * 3.14159265);
  float signedEdge = field - threshold + (fine - 0.5) * 0.04 * uCloudRelief;
  // Condensate thins across a broad, noisy fringe instead of ending at
  // an alpha-cutout contour. fwidth also keeps that fringe stable once
  // it becomes smaller than a pixel in the distant view.
  float edgeWidth = max(0.085, 1.5 * fwidth(signedEdge));
  float cover = smoothstep(-edgeWidth, edgeWidth, signedEdge);
  float fringeBreakup = mix(0.45 + 0.55 * fine, 1.0,
    smoothstep(-0.02, edgeWidth, signedEdge));
  cover *= fringeBreakup;
  // A true global deck has no holes, but its density and top height vary.
  cover = mix(cover, 1.0, smoothstep(0.94, 0.995, uCloudCoverage));

  // Deep convection is a population of towers with gaps between them;
  // flat stratus is much more uniform. Keeping that distinction inside
  // the footprint stops a wet planet becoming white cut-paper continents.
  float densityTexture = mix(0.9, 0.32 + 0.68 * fine, uCloudRelief);
  float density = cover * densityTexture;
  float height = cover * clamp(
    mix(0.42 + 0.58 * broad, 0.3 + 0.48 * broad + 0.22 * fine, uCloudRelief),
    0.0,
    1.0
  );
  // An independent radiometric structure channel remains visible even
  // where a global deck's opacity has saturated to one.
  float structure = clamp(
    0.5 + 1.35 * (broad - 0.5) + 0.55 * (front - 0.5) + 0.25 * (fine - 0.5),
    0.0,
    1.0
  );
  return vec3(density, height, structure);
}

// Treat height as a shallow relief surface. Screen derivatives recover its
// tangent slope without six more noise evaluations per fragment.
vec3 cloudReliefNormal(vec3 up, float height) {
  vec3 dx = dFdx(up);
  vec3 dy = dFdy(up);
  vec3 gradient = dx * (dFdx(height) / max(dot(dx, dx), 1e-7))
    + dy * (dFdy(height) / max(dot(dy, dy), 1e-7));
  gradient *= min(1.0, 1.5 / max(length(gradient), 1e-5));
  return normalize(up - gradient * (0.01 + 0.035 * uCloudRelief));
}

float cloudOpacity(float density) {
  // Dense condensate saturates through a cubic core, while a much thinner
  // linear component keeps the surrounding wisps visible. The latter is
  // tied to the footprint density, so it cannot become a global haze.
  float condensate = max(density * density * density, 0.0);
  float core = 1.0 - exp(-0.42 * uCloudOpticalDepth * condensate);
  float fringe = 1.0 - exp(-0.045 * uCloudOpticalDepth * max(density, 0.0));
  return 1.0 - (1.0 - core) * (1.0 - fringe);
}
`;

export function cloudPatternUniforms(
  physical: Characterization,
): Record<string, { value: number }> {
  const radiusKm = physical.bulk.radiusEarth * 6371;
  const clouds = physical.appearance.clouds;
  return {
    uCloudCoverage: { value: clouds.coverage },
    uCloudOpticalDepth: { value: clouds.opticalDepth },
    uCloudScale: { value: radiusKm / Math.max(clouds.featureScaleKm, 1) },
    uCloudDrift: { value: clouds.driftRadPerDay },
    uCloudRelief: { value: clouds.relief },
    uCloudStellarBias: { value: clouds.stellarBias },
  };
}
