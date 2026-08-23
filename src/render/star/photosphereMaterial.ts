import { ShaderMaterial, type DataTexture } from 'three';
import type { Star } from '../../universe/star/types';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';
import { seedOffset } from './seedOffset';

const VERTEX = /* glsl */ `
varying vec3 vObjPos;
varying vec3 vWorldNormal;
varying vec3 vViewDir;

void main() {
  vObjPos = position;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vViewDir = normalize(cameraPosition - worldPos.xyz);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vObjPos;
varying vec3 vWorldNormal;
varying vec3 vViewDir;

uniform sampler2D uLut;
uniform float uTeff;
uniform float uTimeDays;
uniform float uRotationRadPerDay;
uniform float uDifferentialRotation;
uniform float uGranuleFrequency;
uniform float uSpotCoverage;
uniform float uSpotLatitude;
uniform float uLimbU;
uniform float uIntensity;
uniform float uLuminosityMultiplier;
uniform vec3 uSeedOffset;

${SIMPLEX_NOISE_GLSL}

// Mired-parameterized blackbody LUT coordinate (matches core/color/blackbody).
float lutCoord(float temperature) {
  float mired = 1.0e6 / max(temperature, 1.0);
  return clamp((mired - 20.0) / 980.0, 0.0, 1.0);
}

vec3 rotateY(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

void main() {
  vec3 p = normalize(vObjPos);
  float latitude = asin(clamp(p.y, -1.0, 1.0));

  // Differential rotation: equator leads, poles lag.
  float sinLat = sin(latitude);
  float angle = uTimeDays * uRotationRadPerDay * (1.0 - uDifferentialRotation * sinLat * sinLat);
  vec3 ps = rotateY(p, angle);

  // Granulation: temperature texture advected slowly in a fourth dimension.
  vec3 granulePos = ps * uGranuleFrequency + uSeedOffset;
  float granule = fbm(granulePos + vec3(0.0, 0.0, uTimeDays * 0.5));
  float deltaT = granule * 180.0;

  // Spot bands at activity latitudes, mirrored across the equator.
  float bandDistance = (abs(latitude) - uSpotLatitude) / 0.25;
  float band = exp(-bandDistance * bandDistance);
  float spotField = fbm(ps * 4.0 + uSeedOffset.zxy) * 0.5 + 0.5;
  float threshold = 1.0 - uSpotCoverage * 2.2;
  float spot = smoothstep(threshold, threshold + 0.12, spotField) * band;
  deltaT -= 1600.0 * spot;

  float localT = uTeff + deltaT;
  vec3 color = texture2D(uLut, vec2(lutCoord(localT), 0.5)).rgb;

  // Local radiance follows T⁴; limb darkening from the linear law.
  float radiance = pow(localT / uTeff, 4.0);
  float mu = clamp(dot(normalize(vWorldNormal), normalize(vViewDir)), 0.0, 1.0);
  float limb = 1.0 - uLimbU * (1.0 - mu);

  vec3 hdr = color * radiance * limb * uIntensity * uLuminosityMultiplier;
  gl_FragColor = vec4(hdr, 1.0);
}
`;

export function createPhotosphereMaterial(star: Star, lut: DataTexture): ShaderMaterial {
  const granuleFrequency = Math.min(
    160,
    Math.max(3, 110 / Math.sqrt(star.activity.granuleRelativeScale)),
  );
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uLut: { value: lut },
      uTeff: { value: star.tEff },
      uTimeDays: { value: 0 },
      uRotationRadPerDay: { value: (2 * Math.PI) / star.activity.rotationPeriodDays },
      uDifferentialRotation: { value: star.activity.differentialRotation },
      uGranuleFrequency: { value: granuleFrequency },
      uSpotCoverage: { value: star.activity.spotCoverage },
      uSpotLatitude: { value: star.activity.spotLatitudeRad },
      uLimbU: { value: star.activity.limbDarkeningU },
      uIntensity: { value: 1.05 },
      uLuminosityMultiplier: { value: 1 },
      uSeedOffset: { value: seedOffset(star) },
    },
  });
}
