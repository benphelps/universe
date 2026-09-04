import { Color, ShaderMaterial } from 'three';
import { SECOND_SUN_GLSL, secondSunUniforms } from '../lighting/secondSun';
import { atmosphereColumn, columnAbove } from '../../universe/planet/atmosphere';
import type { Characterization } from '../../universe/planet/types';
import { exposedMagmaTemperatureK } from '../../universe/planet/thermodynamics';
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
import { CLOUD_PATTERN_GLSL, cloudPatternUniforms, planetSeedOffset } from './cloudPattern';
import { blackbodySurfaceEmission } from '../lighting/thermalEmission';

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
${SECOND_SUN_GLSL}
uniform vec3 uSeedOffset;
uniform vec3 uLandA;
uniform vec3 uLandB;
uniform vec3 uCloudColor;
uniform float uLavaGlow;
uniform float uMagmaCoverage;
uniform float uMagmaTemperatureK;
uniform float uDayNightDeltaK;
uniform vec3 uThermalColor;
uniform float uThermalStrength;
uniform float uRadiusKm;
uniform float uTimeDays;
uniform vec3 uCloudAirDepth;
#ifdef HAS_SURFACE
uniform samplerCube uSurfaceCube;
#endif

${SIMPLEX_NOISE_GLSL}
${CLOUD_PATTERN_GLSL}
${MAGMA_PATTERN_GLSL}
${SHADOW_GLSL}
${SURFACE_LIGHT_GLSL}
${AIR_VIEW_GLSL}

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
  // A world above the liquidus is already known to be a continuous fluid
  // shell; do not flash rigid terrain while its surface bake is pending.
  liquid = step(0.999, uMagmaCoverage);
#endif

  vec3 normal = normalize(vWorldNormal);
  vec3 cloud = cloudDeckSample(p, dot(normal, uLightDir), uSeedOffset, uTimeDays);
  float cloudMask = cloudOpacity(cloud.x);
  vec3 cloudNormal = cloudReliefNormal(normal, cloud.y);

  // Molten worlds: the magma seas radiate their own light, day and
  // night — evaluated in the planet's kilometer frame with the same
  // pattern the walk-up lava tiles use, so the same convective structures
  // sit in the same places at every distance.
  vec3 magma = vec3(uMagmaTemperatureK, 0.0, 0.5);
  if (uLavaGlow > 0.0 && liquid > 0.0) {
    vec3 wKm = p * uRadiusKm;
    magma = magmaSurfaceState(
      wKm,
      uSeedOffset,
      uTimeDays,
      length(fwidth(wKm)),
      uMagmaTemperatureK,
      uDayNightDeltaK,
      dot(normal, uLightDir)
    );
  }

  // Lighting: each sun through the air above the ground — or above
  // the cloud tops where the deck covers — with eclipse/ring shadows.
  // The oblate body's true normal is also its local vertical.
  float ndotl = dot(normal, uLightDir);
  float shadow = shadowFactor(vWorldPos, uLightDir, uStarAngularRadius, 1e30);
  vec3 groundLight = surfaceLight(uOpticalDepth, uLightDir, uLightColor, normal, normal, shadow, diffuseShadow(shadow));
  vec3 cloudLight = surfaceLight(uCloudAirDepth, uLightDir, uLightColor, cloudNormal, normal, shadow, diffuseShadow(shadow));
  bool lit2 = secondSunLit();
  float ndotl2 = 0.0;
  float shadow2 = 1.0;
  if (lit2) {
    ndotl2 = dot(normal, uLight2Dir);
    shadow2 = shadowFactor(vWorldPos, uLight2Dir, uStar2AngularRadius, uLight2Reach);
    groundLight += surfaceLight(uOpticalDepth, uLight2Dir, uLight2Color, normal, normal, shadow2, diffuseShadow(shadow2));
    cloudLight += surfaceLight(uCloudAirDepth, uLight2Dir, uLight2Color, cloudNormal, normal, shadow2, diffuseShadow(shadow2));
  }

  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  // Chilled crust is matte; only the hot open melt keeps a sheen.
  float gloss = uLavaGlow > 0.0 ? 0.2 * (0.2 + 0.8 * magma.y) : 0.5;
  float sheen = liquid * (1.0 - cloudMask) * gloss;
  vec3 halfDir = normalize(uLightDir + viewDir);
  vec3 specular = uLightColor * beamTransmittance(uOpticalDepth, ndotl)
    * pow(max(dot(normal, halfDir), 0.0), 90.0) * sheen * max(ndotl, 0.0) * shadow;
  if (lit2) {
    vec3 halfDir2 = normalize(uLight2Dir + viewDir);
    specular += uLight2Color * beamTransmittance(uOpticalDepth, ndotl2)
      * pow(max(dot(normal, halfDir2), 0.0), 90.0) * sheen * max(ndotl2, 0.0) * shadow2;
  }

  vec3 solidGround = surface * groundLight + specular;
  float magmaEmissivity = mix(0.84, 0.94, magma.y);
  float thermalRatio = pow(magma.x / max(uMagmaTemperatureK, 1.0), 4.0);
  vec3 moltenGround =
    uThermalColor * uThermalStrength * thermalRatio * magmaEmissivity * uLavaGlow
    + surface * groundLight * (1.0 - magmaEmissivity)
    + specular;
  vec3 groundColor = mix(solidGround, moltenGround, liquid);
  // Optical opacity determines whether the ground shows through; height
  // independently gives thick towers bright tops and darker shoulders.
  vec3 cloudSurface = uCloudColor * mix(0.65, 1.12, cloud.z);
  vec3 cloudColor = cloudSurface * cloudLight;
  vec3 color = mix(groundColor, cloudColor, cloudMask);
  vec3 tau = mix(uOpticalDepth, uCloudAirDepth, cloudMask);

  // The way out: the disc seen from space keeps its light through the
  // column above and gains the sunlight that column scatters toward
  // the eye — limb darkening and the bright blue limb, one integral.
  float xv = airmass(dot(normal, viewDir));
  color = color * airColumnThrough(vec3(0.0), tau, xv)
    + uLightColor * airColumnScatter(vec3(0.0), tau, xv, airmass(ndotl), -dot(viewDir, uLightDir))
      * twilight(ndotl) * shadow;
  if (lit2) {
    color += uLight2Color * airColumnScatter(vec3(0.0), tau, xv, airmass(ndotl2), -dot(viewDir, uLight2Dir))
      * twilight(ndotl2) * shadow2;
  }

  gl_FragColor = vec4(color * airTransmittanceTo(vWorldPos), 1.0);
}
`;

export function createSolidPlanetMaterial(physical: Characterization): ShaderMaterial {
  const { appearance, bulk, atmosphere } = physical;
  const radiusKm = bulk.radiusEarth * 6371;
  const column = atmosphereColumn(atmosphere, bulk);
  // The distant sphere sees the same physically placed top as the focus
  // shell (terrain clearance is the only focus-only adjustment).
  const deckKm = appearance.clouds.topAltitudeKm;
  const above = columnAbove(column, atmosphere, deckKm);
  const magmaCoverage = physical.climate.hydrosphere === 'magma'
    ? physical.climate.oceanCoverage
    : 0;
  const magmaTemperatureK = exposedMagmaTemperatureK(
    physical.climate.surfaceMeanK,
    magmaCoverage,
  );
  const thermalEmission = blackbodySurfaceEmission(magmaTemperatureK);
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...createShadowUniforms(),
      ...airViewUniforms(),
      ...cloudPatternUniforms(physical),
      ...surfaceLightUniforms({
        ...column,
        horizon: horizonAirmass(radiusKm, atmosphere.scaleHeightKm),
        radius: radiusKm,
        scaleHeight: atmosphere.scaleHeightKm,
      }),
      uCloudAirDepth: {
        value: new Color(
          above.rayleigh[0] + above.aerosolExtinction[0],
          above.rayleigh[1] + above.aerosolExtinction[1],
          above.rayleigh[2] + above.aerosolExtinction[2],
        ),
      },
      uLightDir: { value: [0, 0, 1] },
      uLightColor: { value: new Color(1, 1, 1) },
      ...secondSunUniforms(),
      uSeedOffset: { value: planetSeedOffset(physical.seedHex) },
      uLandA: { value: appearance.landColorA },
      uLandB: { value: appearance.landColorB },
      uCloudColor: { value: appearance.clouds.color },
      uLavaGlow: { value: appearance.lavaGlow },
      uMagmaCoverage: { value: magmaCoverage },
      uMagmaTemperatureK: { value: magmaTemperatureK },
      uDayNightDeltaK: { value: physical.climate.dayNightDeltaK },
      uThermalColor: { value: new Color(...thermalEmission.color) },
      uThermalStrength: { value: thermalEmission.strength },
      uRadiusKm: { value: radiusKm },
      uSurfaceCube: { value: null },
      uTimeDays: { value: 0 },
    },
  });
}
