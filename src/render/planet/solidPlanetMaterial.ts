import { Color, ShaderMaterial } from 'three';
import { seedFromHex } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import type { Characterization } from '../../universe/planet/types';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';
import { createShadowUniforms, SHADOW_GLSL } from './shadows';

const VERTEX = /* glsl */ `
varying vec3 vObjPos;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

void main() {
  vObjPos = position;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const FRAGMENT = /* glsl */ `
varying vec3 vObjPos;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uSeedOffset;
uniform vec3 uLandA;
uniform vec3 uLandB;
uniform vec3 uOcean;
uniform vec3 uIce;
uniform vec3 uCloudColor;
uniform float uOceanCoverage;
uniform float uIceLat;
uniform float uCloudCoverage;
uniform float uLavaGlow;
uniform float uTimeDays;

${SIMPLEX_NOISE_GLSL}
${SHADOW_GLSL}

vec3 rotateY(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

void main() {
  vec3 p = normalize(vObjPos);
  float latitude = asin(clamp(p.y, -1.0, 1.0));

  // Continents: low-frequency shape plus detail, ocean below the level
  // implied by the water coverage.
  float terrain = fbm(p * 2.3 + uSeedOffset) + 0.35 * fbm(p * 5.5 + uSeedOffset);
  float oceanLevel = (uOceanCoverage - 0.5) * 1.5;
  float oceanMask = uOceanCoverage <= 0.0 ? 0.0
    : 1.0 - smoothstep(oceanLevel - 0.04, oceanLevel + 0.04, terrain);

  float tint = fbm(p * 6.0 + uSeedOffset.yzx) * 0.5 + 0.5;
  vec3 land = mix(uLandA, uLandB, tint);
  // Shorelines dry toward sand-lightened tones.
  land = mix(land, land * 1.3 + vec3(0.06, 0.05, 0.03),
    (1.0 - smoothstep(oceanLevel, oceanLevel + 0.25, terrain)) * step(0.01, uOceanCoverage));

  vec3 surface = mix(land, uOcean, oceanMask);

  // Ice caps with a noisy edge; frozen worlds have uIceLat = 0.
  float edgeNoise = 0.06 * fbm(p * 8.0 + uSeedOffset.zxy);
  float iceMask = smoothstep(uIceLat - 0.05, uIceLat + 0.1, abs(latitude) + edgeNoise);
  surface = mix(surface, uIce, iceMask);

  // Cloud deck drifts relative to the surface.
  vec3 cloudP = rotateY(p, uTimeDays * 0.35);
  float cloudField = fbm(cloudP * 3.2 + uSeedOffset + vec3(0.0, 0.0, uTimeDays * 0.02)) * 0.5 + 0.5;
  float cloudThreshold = 1.0 - uCloudCoverage;
  float cloudMask = smoothstep(cloudThreshold - 0.12, cloudThreshold + 0.12, cloudField);
  surface = mix(surface, uCloudColor, cloudMask * 0.95);

  // Lighting: star-lit day side with eclipse/ring shadows.
  vec3 normal = normalize(vWorldNormal);
  float ndotl = dot(normal, uLightDir);
  float shadow = shadowFactor(vWorldPos, uLightDir);
  float diffuse = max(ndotl, 0.0) * shadow;

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 halfDir = normalize(uLightDir + viewDir);
  float specular = pow(max(dot(normal, halfDir), 0.0), 90.0)
    * oceanMask * (1.0 - iceMask) * (1.0 - cloudMask) * 0.5;

  vec3 color = surface * uLightColor * (diffuse + 0.004) + uLightColor * specular * diffuse;

  // Magma worlds glow through the night side along crack networks.
  if (uLavaGlow > 0.0) {
    float cracks = pow(1.0 - abs(snoise(p * 9.0 + uSeedOffset)), 6.0);
    float night = 1.0 - smoothstep(-0.1, 0.15, ndotl);
    color += vec3(1.0, 0.22, 0.04) * cracks * (0.4 + 0.6 * night) * uLavaGlow * 1.6;
  }

  gl_FragColor = vec4(color, 1.0);
}
`;

/** Seed-stable noise offset so each planet's geography is unique. */
export function planetSeedOffset(seedHex: string): [number, number, number] {
  const rng = new Rng(seedFromHex(seedHex)).fork('surface-offset');
  return [rng.range(0, 100), rng.range(0, 100), rng.range(0, 100)];
}

export function createSolidPlanetMaterial(physical: Characterization): ShaderMaterial {
  const { appearance, climate } = physical;
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...createShadowUniforms(),
      uLightDir: { value: [0, 0, 1] },
      uLightColor: { value: new Color(1, 1, 1) },
      uSeedOffset: { value: planetSeedOffset(physical.seedHex) },
      uLandA: { value: appearance.landColorA },
      uLandB: { value: appearance.landColorB },
      uOcean: { value: appearance.oceanColor },
      uIce: { value: appearance.iceColor },
      uCloudColor: { value: appearance.cloudColor },
      uOceanCoverage: { value: climate.hydrosphere === 'oceans' ? climate.oceanCoverage : 0 },
      uIceLat: {
        value: climate.hydrosphere === 'ice-sheet' ? 0 : climate.iceCapLatitudeRad,
      },
      uCloudCoverage: { value: appearance.cloudCoverage },
      uLavaGlow: { value: appearance.lavaGlow },
      uTimeDays: { value: 0 },
    },
  });
}
