import { Color, ShaderMaterial } from 'three';
import { secondSunUniforms } from '../lighting/secondSun';
import { seedFromHex } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import type { Characterization } from '../../universe/planet/types';
import { CELLULAR_GLSL } from '../glsl/cellularNoise';
import { MAGMA_PATTERN_GLSL } from '../glsl/magmaPattern';
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
uniform vec3 uLight2Dir;
uniform vec3 uLight2Color;
uniform vec3 uSeedOffset;
uniform vec3 uLandA;
uniform vec3 uLandB;
uniform vec3 uCloudColor;
uniform float uCloudCoverage;
uniform float uLavaGlow;
uniform float uRadiusKm;
uniform float uTimeDays;
#ifdef HAS_SURFACE
uniform samplerCube uSurfaceCube;
#endif

${SIMPLEX_NOISE_GLSL}
${CELLULAR_GLSL}
${MAGMA_PATTERN_GLSL}
${SHADOW_GLSL}

vec3 rotateY(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

void main() {
  vec3 p = normalize(vObjPos);

  // The surface is the baked cube — the same field the streamed
  // terrain walks on, so orbit and ground agree on every coastline,
  // desert, and ice cap. Until the bake lands, a flat mineral blend.
  vec3 surface;
  float liquid;
#ifdef HAS_SURFACE
  vec4 baked = textureCube(uSurfaceCube, p);
  surface = baked.rgb * baked.rgb;
  liquid = baked.a;
#else
  float tint = fbm(p * 2.3 + uSeedOffset) * 0.5 + 0.5;
  surface = mix(uLandA, uLandB, tint);
  liquid = 0.0;
#endif

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
  float gloss = uLavaGlow > 0.0 ? 0.2 : 0.5;
  float specular = pow(max(dot(normal, halfDir), 0.0), 90.0)
    * liquid * (1.0 - cloudMask) * gloss;

  float diffuse2 = max(dot(normal, uLight2Dir), 0.0) * shadowFactor(vWorldPos, uLight2Dir);
  vec3 color = surface * (uLightColor * (diffuse + 0.004) + uLight2Color * diffuse2)
    + uLightColor * specular * diffuse;

  // Molten worlds: the magma seas radiate their own light, day and
  // night — evaluated in the planet's kilometer frame with the same
  // pattern the walk-up lava tiles use, so the plates and paterae sit
  // in the same places at every distance.
  if (uLavaGlow > 0.0 && liquid > 0.0) {
    vec3 wKm = p * uRadiusKm;
    vec3 glow = magmaGlow(wKm, uSeedOffset, uTimeDays, length(fwidth(wKm)));
    color += glow * liquid * uLavaGlow * (1.0 - cloudMask * 0.85);
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
  const { appearance, bulk } = physical;
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...createShadowUniforms(),
      uLightDir: { value: [0, 0, 1] },
      uLightColor: { value: new Color(1, 1, 1) },
      ...secondSunUniforms(),
      uSeedOffset: { value: planetSeedOffset(physical.seedHex) },
      uLandA: { value: appearance.landColorA },
      uLandB: { value: appearance.landColorB },
      uCloudColor: { value: appearance.cloudColor },
      uCloudCoverage: { value: appearance.cloudCoverage },
      uLavaGlow: { value: appearance.lavaGlow },
      uRadiusKm: { value: bulk.radiusEarth * 6371 },
      uSurfaceCube: { value: null },
      uTimeDays: { value: 0 },
    },
  });
}
