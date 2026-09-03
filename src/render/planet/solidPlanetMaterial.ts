import { Color, ShaderMaterial } from 'three';
import { secondSunUniforms } from '../lighting/secondSun';
import { seedFromHex } from '../../core/rng/hash';
import { Rng } from '../../core/rng/rng';
import { atmosphereColumn, columnAbove } from '../../universe/planet/atmosphere';
import type { Characterization } from '../../universe/planet/types';
import { MAGMA_PATTERN_GLSL } from '../glsl/magmaPattern';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';
import { WORLD_NORMAL_GLSL } from '../glsl/worldNormal';
import {
  horizonAirmass,
  SURFACE_LIGHT_GLSL,
  surfaceLightUniforms,
} from '../lighting/surfaceLight';
import { createShadowUniforms, SHADOW_GLSL } from './shadows';
import { AIR_REFRACT_GLSL, AIR_VIEW_GLSL, airViewUniforms } from '../lighting/airView';

const VERTEX = /* glsl */ `
varying vec3 vObjPos;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;

${WORLD_NORMAL_GLSL}

${AIR_REFRACT_GLSL}

void main() {
  vObjPos = position;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vWorldNormal = worldNormal(modelMatrix, normal);
  gl_Position = projectionMatrix * viewMatrix * vec4(airRefractPosition(worldPos.xyz), 1.0);
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
uniform vec3 uCloudOpticalDepth;
#ifdef HAS_SURFACE
uniform samplerCube uSurfaceCube;
#endif

${SIMPLEX_NOISE_GLSL}
${MAGMA_PATTERN_GLSL}
${SHADOW_GLSL}
${SURFACE_LIGHT_GLSL}
${AIR_VIEW_GLSL}

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

  // Molten worlds: the magma seas radiate their own light, day and
  // night — evaluated in the planet's kilometer frame with the same
  // pattern the walk-up lava tiles use, so the same melt streams sit
  // in the same places at every distance.
  vec3 lavaGlowC = vec3(0.0);
  float lavaHot = 0.0;
  if (uLavaGlow > 0.0 && liquid > 0.0) {
    vec3 wKm = p * uRadiusKm;
    lavaGlowC = magmaGlow(wKm, uSeedOffset, uTimeDays, length(fwidth(wKm)));
    lavaHot = smoothstep(0.2, 0.9, dot(lavaGlowC, vec3(0.3, 0.59, 0.11)));
  }

  // Lighting: each sun through the air above the ground — or above
  // the cloud tops where the deck covers — with eclipse/ring shadows.
  // The oblate body's true normal is also its local vertical.
  vec3 normal = normalize(vWorldNormal);
  float ndotl = dot(normal, uLightDir);
  float ndotl2 = dot(normal, uLight2Dir);
  float shadow = shadowFactor(vWorldPos, uLightDir, uStarAngularRadius, 1e30);
  float shadow2 = shadowFactor(vWorldPos, uLight2Dir, uStar2AngularRadius, uLight2Reach);
  vec3 tau = mix(uOpticalDepth, uCloudOpticalDepth, cloudMask);
  vec3 light = surfaceLight(tau, uLightDir, uLightColor, normal, normal, shadow)
    + surfaceLight(tau, uLight2Dir, uLight2Color, normal, normal, shadow2);

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  // Chilled crust is matte; only the hot open melt keeps a sheen.
  float gloss = uLavaGlow > 0.0 ? 0.2 * (0.2 + 0.8 * lavaHot) : 0.5;
  float sheen = liquid * (1.0 - cloudMask) * gloss;
  vec3 halfDir = normalize(uLightDir + viewDir);
  vec3 specular = uLightColor * beamTransmittance(tau, ndotl)
    * pow(max(dot(normal, halfDir), 0.0), 90.0) * sheen * max(ndotl, 0.0) * shadow;
  vec3 halfDir2 = normalize(uLight2Dir + viewDir);
  specular += uLight2Color * beamTransmittance(tau, ndotl2)
    * pow(max(dot(normal, halfDir2), 0.0), 90.0) * sheen * max(ndotl2, 0.0) * shadow2;

  vec3 color = surface * (light + uNightFloor) + specular;

  // The way out: the disc seen from space keeps its light through the
  // column above and gains the sunlight that column scatters toward
  // the eye — limb darkening and the bright blue limb, one integral.
  float xv = airmass(dot(normal, viewDir));
  color = color * airColumnThrough(vec3(0.0), tau, xv)
    + uLightColor * airColumnScatter(vec3(0.0), tau, xv, airmass(ndotl), -dot(viewDir, uLightDir))
      * twilight(ndotl) * shadow
    + uLight2Color * airColumnScatter(vec3(0.0), tau, xv, airmass(ndotl2), -dot(viewDir, uLight2Dir))
      * twilight(ndotl2) * shadow2;

  color += lavaGlowC * liquid * uLavaGlow * (1.0 - cloudMask * 0.85);

  gl_FragColor = vec4(color * airTransmittanceTo(vWorldPos), 1.0);
}
`;

/** Seed-stable noise offset so each planet's geography is unique. */
export function planetSeedOffset(seedHex: string): [number, number, number] {
  const rng = new Rng(seedFromHex(seedHex)).fork('surface-offset');
  return [rng.range(0, 100), rng.range(0, 100), rng.range(0, 100)];
}

export function createSolidPlanetMaterial(physical: Characterization): ShaderMaterial {
  const { appearance, bulk, atmosphere } = physical;
  const radiusKm = bulk.radiusEarth * 6371;
  const column = atmosphereColumn(atmosphere, bulk);
  // The deck stands where the focus view's shell would put it over a
  // flat sea: a few kilometres, or most of a scale height.
  const deckKm = Math.max(3, atmosphere.scaleHeightKm * 0.9);
  const above = columnAbove(column, atmosphere, deckKm);
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...createShadowUniforms(),
      ...airViewUniforms(),
      ...surfaceLightUniforms({
        ...column,
        horizon: horizonAirmass(radiusKm, atmosphere.scaleHeightKm),
        radius: radiusKm,
        scaleHeight: atmosphere.scaleHeightKm,
      }),
      uCloudOpticalDepth: {
        value: new Color(
          above.rayleigh[0] + above.aerosol[0],
          above.rayleigh[1] + above.aerosol[1],
          above.rayleigh[2] + above.aerosol[2],
        ),
      },
      uLightDir: { value: [0, 0, 1] },
      uLightColor: { value: new Color(1, 1, 1) },
      ...secondSunUniforms(),
      uSeedOffset: { value: planetSeedOffset(physical.seedHex) },
      uLandA: { value: appearance.landColorA },
      uLandB: { value: appearance.landColorB },
      uCloudColor: { value: appearance.cloudColor },
      uCloudCoverage: { value: appearance.cloudCoverage },
      uLavaGlow: { value: appearance.lavaGlow },
      uRadiusKm: { value: radiusKm },
      uSurfaceCube: { value: null },
      uTimeDays: { value: 0 },
    },
  });
}
