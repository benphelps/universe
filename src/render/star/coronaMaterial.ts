import { AdditiveBlending, ShaderMaterial } from 'three';
import type { Star } from '../../universe/star/types';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';
import { seedOffset } from './seedOffset';

/** Corona billboard extent as a multiple of the stellar radius. */
export const CORONA_SIZE_FACTOR = 8;

const VERTEX = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vCenter;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vCenter;

uniform vec3 uColor;
uniform vec3 uSeedOffset;
uniform float uTimeDays;
uniform float uDiscRadius;
uniform float uIntensity;
uniform float uPlaneHalfWidth;
uniform float uAxialTilt;
uniform float uRotationRadPerDay;
uniform float uDifferentialRotation;
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

void main() {
  // The billboard cuts through the star's center perpendicular to the view,
  // so world-space fragment positions sample a 3D field with true parallax.
  vec3 rel = (vWorldPos - vCenter) / uPlaneHalfWidth;
  float r = length(rel);
  vec3 dir = rel / max(r, 1e-4);

  // Into the star's frame: undo axial tilt, then co-rotate with the surface
  // (same differential-rotation law as the photosphere shader).
  dir = rotateZ(dir, -uAxialTilt);
  float latitude = asin(clamp(dir.y, -1.0, 1.0));
  float sinLat = dir.y;
  float angle = uTimeDays * uRotationRadPerDay * (1.0 - uDifferentialRotation * sinLat * sinLat);
  vec3 ds = rotateY(dir, angle);

  // Streamers: radial rays from a star-anchored field, evolving slowly.
  float streak = fbm(ds * 2.6 + uSeedOffset + r * 0.7 + vec3(0.0, 0.0, uTimeDays * 0.03));
  float structure = 0.55 + 0.45 * streak;

  // Active stars concentrate loop-like structure over their spot bands;
  // the spot field itself ties streamers to active-region longitudes.
  float bandDistance = (abs(latitude) - uSpotLatitude) / 0.35;
  float band = exp(-bandDistance * bandDistance);
  float spotField = fbm(ds * 4.0 + uSeedOffset.zxy) * 0.5 + 0.5;
  float activeRegion = band * (0.4 + 1.6 * smoothstep(0.5, 0.8, spotField));
  structure *= mix(1.0, 0.55 + activeRegion, uActivity);

  float falloff = pow(uDiscRadius / max(r, uDiscRadius), 3.2);
  float glow = falloff * structure;
  // Fade inside the disc (occluded by the photosphere) and at the plane edge.
  glow *= smoothstep(uDiscRadius * 0.85, uDiscRadius * 1.02, r);
  glow *= smoothstep(0.9, 0.5, r);

  gl_FragColor = vec4(uColor * glow * uIntensity, 1.0);
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
      uTimeDays: { value: 0 },
      uDiscRadius: { value: 2 / CORONA_SIZE_FACTOR },
      uIntensity: { value: 0.35 },
      uPlaneHalfWidth: { value: (star.radius * CORONA_SIZE_FACTOR) / 2 },
      uAxialTilt: { value: star.activity.axialTiltRad },
      uRotationRadPerDay: { value: (2 * Math.PI) / star.activity.rotationPeriodDays },
      uDifferentialRotation: { value: star.activity.differentialRotation },
      uSpotLatitude: { value: star.activity.spotLatitudeRad },
      uActivity: { value: Math.min(1, star.activity.spotCoverage * 10) },
    },
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
}
