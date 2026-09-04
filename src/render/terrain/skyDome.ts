import { AdditiveBlending, BackSide, Color, Mesh, ShaderMaterial, SphereGeometry } from 'three';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';
import { secondSunUniforms } from '../lighting/secondSun';
import { SURFACE_LIGHT_GLSL, surfaceLightUniforms } from '../lighting/surfaceLight';
import {
  CLOUD_PATTERN_GLSL,
  cloudPatternUniforms,
  planetSeedOffset,
} from '../planet/cloudPattern';
import { createShadowUniforms, SHADOW_GLSL } from '../planet/shadows';
import type { Characterization } from '../../universe/planet/types';

const VERTEX = /* glsl */ `
varying vec3 vDir;

void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vDir;

uniform vec3 uLightColor;
uniform vec3 uSunDir;
uniform vec3 uLight2Dir;
uniform vec3 uLight2Color;
uniform vec3 uSeedOffset;
uniform float uTimeDays;
uniform float uCloudBaseRadius;

${SIMPLEX_NOISE_GLSL}
${CLOUD_PATTERN_GLSL}
${SHADOW_GLSL}
${SURFACE_LIGHT_GLSL}

const int SKY_SAMPLES = 16;
const float SKY_SCALE_HEIGHTS = 24.0;

// Forward distance from a point inside a sphere to its far boundary.
float sphereExit(vec3 origin, vec3 dir, float radius) {
  float along = dot(origin, dir);
  float discriminant = along * along - (dot(origin, origin) - radius * radius);
  return max(-along + sqrt(max(discriminant, 0.0)), 0.0);
}

// A view from below crosses the condensate layer at its base. The local
// procedural density gives the slant transmission along that ray; views from
// within or above the deck have no foreground cloud boundary.
vec2 cloudBoundary(vec3 dir) {
  float eyeRadius = length(cameraPosition);
  if (uCloudCoverage < 0.001 || uCloudBaseRadius <= eyeRadius) {
    return vec2(1e30, 1.0);
  }
  float distance = sphereExit(cameraPosition, dir, uCloudBaseRadius);
  vec3 point = cameraPosition + dir * distance;
  vec3 up = normalize(point);
  vec3 cloud = cloudDeckSample(
    up, dot(up, uSunDir), uSeedOffset, uTimeDays
  );
  float verticalTransmission = 1.0 - cloudOpacity(cloud.x);
  float slant = 1.0 / max(abs(dot(up, dir)), 0.08);
  return vec2(distance, pow(max(verticalTransmission, 0.0), slant));
}

// The first ground intersection, or a sentinel when the sightline
// clears the planet. Starting exactly on the datum and looking up must
// not count the root under the eye.
float groundDistance(vec3 origin, vec3 dir) {
  float along = dot(origin, dir);
  float discriminant = along * along - (dot(origin, origin) - uPlanetRadius * uPlanetRadius);
  if (discriminant < 0.0) return 1e30;
  float hit = -along - sqrt(discriminant);
  return hit > 1e-3 ? hit : 1e30;
}

// Vertical columns between an atmospheric parcel and its light. Above
// the local horizon this is the remaining upward column. Below it the
// ray descends to a tangent, crosses the far half, and escapes.
float sunColumn(
  float altitude,
  float radiusAtParcel,
  float mu,
  float height,
  float horizon
) {
  float above = exp(-altitude / max(height, 1e-4));
  if (mu >= 0.0) return above * airmassFor(mu, horizon);
  float tangentAltitude = radiusAtParcel * sqrt(max(1.0 - mu * mu, 0.0)) - uPlanetRadius;
  return max(
    2.0 * exp(-max(tangentAltitude, 0.0) / max(height, 1e-4)) * horizon
      - above * airmassFor(-mu, horizon),
    0.0
  );
}

// Fraction of the light's disc above the parcel's geometric horizon.
// The finite disc softens the planet-shadow boundary without a time
// constant: its centre can sit just below the limb while its upper arc
// still illuminates the air.
float sunDiscVisibility(float radiusAtParcel, float mu, float angularRadius) {
  float elevation = asin(clamp(mu, -1.0, 1.0));
  float horizonDip = acos(clamp(uPlanetRadius / radiusAtParcel, 0.0, 1.0));
  float halfWidth = max(angularRadius, 1e-5);
  return smoothstep(-halfWidth, halfWidth, elevation + horizonDip);
}

// Where a ray runs through the planet's own shadow behind its light:
// past the plane through the centre and inside the cylinder the planet
// casts, drawn in by the disc's upper limb so the penumbra stays with
// the lit side. Distances along the ray, empty when from >= to.
vec2 shadowSpan(vec3 origin, vec3 dir, vec3 lightDir, float angularRadius, float reachAlong) {
  float originAlong = dot(origin, lightDir);
  float dirAlong = dot(dir, lightDir);
  float nightFrom = 0.0;
  float nightTo = reachAlong;
  if (abs(dirAlong) < 1e-9) {
    if (originAlong >= 0.0) return vec2(0.0);
  } else {
    float atPlane = -originAlong / dirAlong;
    if (dirAlong > 0.0) nightTo = min(nightTo, atPlane);
    else nightFrom = max(nightFrom, atPlane);
  }
  if (nightTo <= nightFrom) return vec2(0.0);
  vec3 originAcross = origin - originAlong * lightDir;
  vec3 dirAcross = dir - dirAlong * lightDir;
  float a = dot(dirAcross, dirAcross);
  float b = dot(originAcross, dirAcross);
  float c0 = dot(originAcross, originAcross);
  float radius = uPlanetRadius;
  vec2 span = vec2(0.0);
  for (int pass = 0; pass < 2; pass++) {
    float c = c0 - radius * radius;
    float from = nightFrom;
    float to = nightTo;
    if (a < 1e-12) {
      if (c >= 0.0) return vec2(0.0);
    } else {
      float discriminant = b * b - a * c;
      if (discriminant <= 0.0) return vec2(0.0);
      float root = sqrt(discriminant);
      from = max(from, (-b - root) / a);
      to = min(to, (-b + root) / a);
    }
    if (to <= from) return vec2(0.0);
    span = vec2(from, to);
    // The exit's altitude sets how far into the geometric shadow the
    // disc's upper limb still reaches.
    float exitRadius = length(origin + dir * to);
    radius = uPlanetRadius
      - angularRadius * sqrt(max(exitRadius * exitRadius - uPlanetRadius * uPlanetRadius, 0.0));
  }
  return span;
}

// One light's share of the sky, integrated through the curved
// atmosphere. Every piece carries its own density, route to the eye,
// route to the sun, and eclipse state. High parcels therefore remain
// sunlit after the observer's sunset and fade continuously upward and
// outward as the planetary shadow climbs through the air.
//
// The ray is cut at every boundary the model has along it — the cloud
// deck, and where the planet's own shadow begins and ends — so no
// piece straddles one. Sampled whole, a segment would switch its deck
// or its shadow on and off as the view turned, and the sky would show
// each switch as a band.
vec3 scattered(
  vec3 dir,
  vec3 lightDir,
  vec3 lightColor,
  float angularRadius,
  float reach,
  vec2 deck,
  float meanDeckTransmission
) {
  if (max(max(lightColor.r, lightColor.g), lightColor.b) <= 0.0) return vec3(0.0);
  float gasHeight = max(uScaleHeight, 1e-4);
  float aerosolHeight = max(uAerosolScaleHeight, 1e-4);
  float topAltitude = SKY_SCALE_HEIGHTS * max(gasHeight, aerosolHeight);
  float eyeRadius = length(cameraPosition);
  if (eyeRadius >= uPlanetRadius + topAltitude) return vec3(0.0);

  float distance = min(
    sphereExit(cameraPosition, dir, uPlanetRadius + topAltitude),
    groundDistance(cameraPosition, dir)
  );
  vec2 shade = shadowSpan(cameraPosition, dir, lightDir, angularRadius, distance);
  float nearCut = min(deck.x, shade.x);
  float farCut = max(deck.x, shade.x);
  vec3 cuts = vec3(nearCut, min(farCut, shade.y), max(farCut, shade.y));

  vec3 viewDepth = vec3(0.0);
  vec3 radiance = vec3(0.0);
  float cosTheta = clamp(dot(dir, lightDir), -1.0, 1.0);
  vec3 phase = uRayleighDepth * rayleighPhase(cosTheta) / gasHeight;
  vec3 haze = uAerosolScatterDepth * hazePhase(cosTheta) / aerosolHeight;
  float deckView = displayTransmittance(deck.y);
  float deckSource = displayTransmittance(meanDeckTransmission);

  for (int i = 0; i < SKY_SAMPLES; i++) {
    float q0 = float(i) / float(SKY_SAMPLES);
    float q1 = float(i + 1) / float(SKY_SAMPLES);
    float start = distance * q0 * q0;
    float end = distance * q1 * q1;
    float from = start;
    for (int k = 0; k < 4; k++) {
      float cut = k == 0 ? cuts.x : k == 1 ? cuts.y : k == 2 ? cuts.z : end;
      float to = clamp(cut, start, end);
      float ds = to - from;
      if (ds <= 0.0) continue;
      float mid = 0.5 * (from + to);
      from = to;
      vec3 parcel = cameraPosition + dir * mid;
      float radiusAtParcel = length(parcel);
      float altitude = max(radiusAtParcel - uPlanetRadius, 0.0);
      vec3 parcelUp = parcel / max(radiusAtParcel, 1e-6);
      float gasDensity = exp(-altitude / gasHeight);
      float aerosolDensity = exp(-altitude / aerosolHeight);
      vec3 pieceDepth = (
        uRayleighDepth * gasDensity / gasHeight
          + uAerosolExtinction * aerosolDensity / aerosolHeight
      ) * ds;
      vec3 viewBeam = exp(-(viewDepth + 0.5 * pieceDepth));
      if (mid > deck.x) viewBeam *= deckView;
      viewDepth += pieceDepth;
      if (mid > shade.x && mid < shade.y) continue;

      float muSun = dot(lightDir, parcelUp);
      float discVisible = sunDiscVisibility(radiusAtParcel, muSun, angularRadius);
      if (discVisible <= 0.0) continue;
      float tangentMu = -sqrt(max(
        1.0 - (uPlanetRadius * uPlanetRadius) / (radiusAtParcel * radiusAtParcel),
        0.0
      ));
      float sourceMu = max(muSun, tangentMu);
      float gasSun = sunColumn(
        altitude, radiusAtParcel, sourceMu, gasHeight, uHorizonAirmass
      );
      float aerosolSun = sunColumn(
        altitude,
        radiusAtParcel,
        sourceMu,
        aerosolHeight,
        uAerosolHorizonAirmass
      );
      vec3 sunBeam = exp(-(
        uRayleighDepth * gasSun + uAerosolExtinction * aerosolSun
      ));
      vec3 source = phase * gasDensity + haze * aerosolDensity;
      float visible = shadowFactor(parcel, lightDir, angularRadius, reach);
      float sourceDeck = radiusAtParcel < uCloudBaseRadius ? deckSource : 1.0;
      radiance += source * sunBeam * viewBeam * visible * discVisible * sourceDeck * ds;
    }
  }
  return lightColor * radiance;
}

void main() {
  // The dome is coarse and the aureole is sharp: an interpolated
  // direction shortens toward each triangle's middle and the peak
  // facets into a diamond unless the direction is renormalized here.
  vec3 dir = normalize(vDir);
  vec2 deck = cloudBoundary(dir);
  // The global climate model supplies mean coverage rather than a second
  // weather map along the source ray. Its area-weighted transmission is the
  // physically correct expectation for direct light reaching air below it.
  float meanDeckTransmission = 1.0 - uCloudCoverage
    * (1.0 - exp(-uCloudOpticalDepth));
  // Scattering adds light; it never occludes, so the sun's disc (and
  // anything else bright enough) blazes through the daytime sky.
  vec3 sky = scattered(
    dir, uSunDir, uLightColor, uStarAngularRadius, 1e30,
    deck, meanDeckTransmission
  ) + scattered(
    dir, uLight2Dir, uLight2Color, uStar2AngularRadius, uLight2Reach,
    deck, meanDeckTransmission
  );
  gl_FragColor = vec4(sky, 1.0);
}
`;

/**
 * Ground-level sky: a camera-centered dome that integrates the curved
 * air between the eye and space, singly scattering each sun — blue
 * from a clear Rayleigh atmosphere, red toward a setting sun, black in
 * a vacuum — thinning with altitude and shadowed parcel by parcel in
 * an eclipse. Its atmospheric properties are seated by the viewer with
 * the rest of the ground materials.
 */
export function createSkyDome(
  physical: Characterization,
  cloudBaseRadiusKm = 0,
): Mesh {
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...createShadowUniforms(),
      ...surfaceLightUniforms(),
      ...cloudPatternUniforms(physical),
      uLightColor: { value: new Color(1, 1, 1) },
      ...secondSunUniforms(),
      uSunDir: { value: [0, 0, 1] },
      uSeedOffset: { value: planetSeedOffset(physical.seedHex) },
      uTimeDays: { value: 0 },
      uCloudBaseRadius: { value: cloudBaseRadiusKm },
    },
    side: BackSide,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const dome = new Mesh(new SphereGeometry(600, 48, 24), material);
  // The air shines in front of everything beyond it, so the dome draws
  // after the sky-layer composite and the star points (reversed-Z:
  // lowest order last). At -1 it tied the composite and lost: a dark
  // cloud's occlusion multiplied the twilight haze away, punching a
  // black patch into an atmosphere that stands between it and the eye.
  // Additive, so its order against the additive stars is indifferent.
  dome.renderOrder = -2.25;
  dome.frustumCulled = false;
  return dome;
}
