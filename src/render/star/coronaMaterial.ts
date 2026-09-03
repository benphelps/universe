import { AdditiveBlending, ShaderMaterial } from 'three';
import type { Star } from '../../universe/star/types';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';
import { seedOffset } from './seedOffset';
import { AIR_REFRACT_GLSL, AIR_VIEW_GLSL, airViewUniforms } from '../lighting/airView';

/** Corona billboard extent as a multiple of the stellar radius. */
export const CORONA_SIZE_FACTOR = 8;

const VERTEX = /* glsl */ `
varying vec3 vRel;
varying vec3 vAirDir;

${AIR_REFRACT_GLSL}

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vAirDir = normalize(worldPos.xyz - cameraPosition);
  // Normalized billboard offset, scale-free: the world half-width comes
  // from the model matrix, so the shader works in any scene unit.
  float halfWidth = 0.5 * length(vec3(modelMatrix[0]));
  vRel = (worldPos.xyz - (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz) / halfWidth;
  gl_Position = projectionMatrix * viewMatrix * vec4(airRefractPosition(worldPos.xyz), 1.0);
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vRel;
varying vec3 vAirDir;

${AIR_VIEW_GLSL}

uniform vec3 uColor;
uniform vec3 uSeedOffset;
uniform float uDiscRadius;
uniform float uIntensity;
uniform float uAxialTilt;
uniform float uRotationPhase;
uniform float uEvolutionEpoch;
uniform float uEvolutionPhase;
uniform float uSpotLatitude;
uniform float uActivity;

${SIMPLEX_NOISE_GLSL}

vec3 rotateY(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

vec3 rotateZ(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
}

float smooth01(float value) {
  float x = clamp(value, 0.0, 1.0);
  return x * x * (3.0 - 2.0 * x);
}

vec3 epochOffset(float epoch) {
  float e = mod(epoch, 4096.0);
  return 9.0 * vec3(
    sin(e * 1.6180339 + 0.7),
    sin(e * 2.4142136 + 2.1),
    sin(e * 3.1415927 + 4.3)
  );
}

float evolvingNoise(vec3 p) {
  return mix(
    snoise(p + epochOffset(uEvolutionEpoch)),
    snoise(p + epochOffset(uEvolutionEpoch + 1.0)),
    smooth01(uEvolutionPhase)
  );
}

void main() {
  // The billboard cuts through the star's center perpendicular to the view,
  // so its fragments sample a 3D star-anchored field with true parallax.
  vec3 rel = vRel;
  float r = length(rel);
  vec3 dir = rel / max(r, 1e-4);

  // Into the star's frame: undo axial tilt, then co-rotate with the finite
  // active-region field used by the photosphere.
  dir = rotateZ(dir, -uAxialTilt);
  float latitude = asin(clamp(dir.y, -1.0, 1.0));
  float radialRatio = max(r / max(uDiscRadius, 1e-4), 1.0);
  // Magnetic streamers expand and curve with altitude. Sampling the same
  // angular value at every radius made the former corona an array of
  // infinitely straight "hyperspace" rays.
  // Bend reverses continuously across the equator. A hard sign(dir.y)
  // made the sampled noise field jump at y=0, exposing a horizontal seam.
  float hemisphereBend = sin(latitude);
  float twist = log(radialRatio) * (0.18 + 0.34 * uActivity) * hemisphereBend;
  vec3 ds = rotateY(dir, uRotationPhase + twist);

  // Broad inner halo plus sparse, altitude-decohering streamers. Radial
  // evolution and a second scale break the perfect spokes while retaining
  // a magnetic connection to active longitudes.
  float coarse = evolvingNoise(ds * 2.4 + uSeedOffset
    + vec3(r * 1.7, -r * 0.9, r * 0.6));
  float fine = evolvingNoise(ds * 5.6 - uSeedOffset.yzx
    + vec3(-r * 3.1, r * 2.2, r * 1.1));
  float streamer = smoothstep(0.34, 0.76, 0.68 * coarse + 0.32 * fine);
  float structure = 0.82 + 0.18 * coarse;

  // Active stars concentrate loop-like structure over their spot bands;
  // the spot field itself ties streamers to active-region longitudes.
  float bandDistance = (abs(latitude) - uSpotLatitude) / 0.35;
  float band = exp(-bandDistance * bandDistance);
  float spotField = evolvingNoise(ds * 3.7 + uSeedOffset.zxy
    + vec3(0.0, -r * 0.7, r * 1.3)) * 0.5 + 0.5;
  float activeRegion = band * smoothstep(0.54, 0.78, spotField);
  streamer *= mix(0.55, 0.55 + 1.25 * activeRegion, uActivity);

  float innerFalloff = pow(uDiscRadius / max(r, uDiscRadius), 3.0);
  float streamerFalloff = pow(uDiscRadius / max(r, uDiscRadius), 1.65);
  float glow = innerFalloff * structure
    + streamerFalloff * streamer * (0.08 + 0.28 * uActivity);
  // Fade inside the disc (occluded by the photosphere) and at the plane edge.
  glow *= smoothstep(uDiscRadius * 0.85, uDiscRadius * 1.02, r);
  glow *= 1.0 - smoothstep(0.5, 0.9, r);

  gl_FragColor = vec4(uColor * glow * uIntensity * airTransmittance(vAirDir), 1.0);
}
`;

/** Corona hue: photosphere color washed toward white (scattered, hotter plasma). */
export function createCoronaMaterial(star: Star): ShaderMaterial {
  const [r, g, b] = star.linearRgb;
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uColor: { value: [r * 0.5 + 0.5, g * 0.5 + 0.5, b * 0.5 + 0.5] },
      uSeedOffset: { value: seedOffset(star) },
      uDiscRadius: { value: 2 / CORONA_SIZE_FACTOR },
      ...airViewUniforms(),
      uIntensity: { value: 0.2 },
      uAxialTilt: { value: star.activity.axialTiltRad },
      uRotationPhase: { value: 0 },
      uEvolutionEpoch: { value: 0 },
      uEvolutionPhase: { value: 0 },
      uSpotLatitude: { value: star.activity.spotLatitudeRad },
      uActivity: { value: Math.min(1, star.activity.spotCoverage * 10) },
    },
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
}
