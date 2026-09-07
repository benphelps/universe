import { Color, ShaderMaterial } from 'three';
import type { Characterization } from '../../universe/planet/types';
import { exposedMagmaTemperatureK } from '../../universe/planet/thermodynamics';
import { SECOND_SUN_GLSL, secondSunUniforms } from '../lighting/secondSun';
import { SURFACE_LIGHT_GLSL, surfaceLightUniforms } from '../lighting/surfaceLight';
import { thermalUniforms, ownThermalTexture, THERMAL_EMISSION_GLSL } from '../lighting/thermalMaterial';
import { MAGMA_PATTERN_GLSL } from '../glsl/magmaPattern';
import { SIMPLEX_NOISE_GLSL } from '../glsl/simplexNoise';
import { createShadowUniforms, SHADOW_GLSL } from '../planet/shadows';
import { TERRAIN_MORPH_GLSL, TERRAIN_SPLIT_RATIO } from './terrainMorph';

const VERTEX = /* glsl */ `
attribute vec4 aMorph;
attribute vec3 aTerrainPosition;
attribute vec3 aWaterMorph;
attribute vec2 aWaterIce;
${TERRAIN_MORPH_GLSL}
varying vec3 vNormal;
varying vec3 vViewPos;
varying vec3 vWorldPos;
varying float vWaterIce;

void main() {
  vNormal = normal;
  vWaterIce = mix(aWaterIce.y, aWaterIce.x, terrainMorphWeight(aTerrainPosition, aMorph.w));
  // Shadow rays only; clip runs through modelViewMatrix — see terrainMaterial.
  vec3 displaced = morphTerrainPosition(position, aWaterMorph, aTerrainPosition, aMorph.w);
  vWorldPos = (modelMatrix * vec4(displaced, 1.0)).xyz;
  vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
  vViewPos = mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT = /* glsl */ `
varying float vWaterIce;
varying vec3 vNormal;
varying vec3 vViewPos;
varying vec3 vWorldPos;

uniform vec3 uColor;
uniform vec3 uIceColor;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
${SECOND_SUN_GLSL}

${SIMPLEX_NOISE_GLSL}
${SHADOW_GLSL}
${SURFACE_LIGHT_GLSL}

// One sun's glint and grazing sheen off level water: the beam that
// reaches the surface, off the facet toward the eye.
vec3 sunSheen(vec3 normal, vec3 viewDir, vec3 lightDir, vec3 lightColor, float shadow) {
  float mu = dot(normal, lightDir);
  float fresnel = pow(clamp(1.0 - dot(normal, viewDir), 0.0, 1.0), 4.0);
  vec3 halfDir = normalize(lightDir + viewDir);
  float specular = pow(max(dot(normal, halfDir), 0.0), 220.0);
  return lightColor * beamTransmittance(uOpticalDepth, mu)
    * (fresnel * 0.25 + specular) * max(mu, 0.0) * shadow;
}

void main() {
  // Water lies level: its normal is the local vertical.
  vec3 normal = normalize(vNormal);

  // World-space view direction (v·M applies the view rotation's inverse);
  // water tiles never rotate, so normals are already world-frame.
  vec3 viewDir = normalize(-vViewPos) * mat3(viewMatrix);

  float shadow = shadowFactor(vWorldPos, uLightDir, uStarAngularRadius, 1e30);
  vec3 light = surfaceLight(uOpticalDepth, uLightDir, uLightColor, normal, normal, shadow, diffuseShadow(shadow));
  vec3 sheen = sunSheen(normal, viewDir, uLightDir, uLightColor, shadow);
  bool lit2 = secondSunLit();
  if (lit2) {
    float shadow2 = shadowFactor(vWorldPos, uLight2Dir, uStar2AngularRadius, uLight2Reach);
    light += surfaceLight(uOpticalDepth, uLight2Dir, uLight2Color, normal, normal, shadow2, diffuseShadow(shadow2));
    sheen += sunSheen(normal, viewDir, uLight2Dir, uLight2Color, shadow2);
  }
  float ice = clamp(vWaterIce, 0.0, 1.0);
  vec3 color = mix(uColor, uIceColor, ice) * light + (1.0 - ice) * sheen;

  // Aerial perspective: the air along the run to the eye keeps some of
  // the ground's light and adds the sunlight it scatters — blue by day,
  // red under a low sun, nothing in a vacuum.
  float eyeAlt = length(cameraPosition) - uPlanetRadius;
  float pointAlt = length(vWorldPos) - uPlanetRadius;
  float run = length(vViewPos);
  vec3 column = airSegmentColumn(eyeAlt, pointAlt, run);
  vec3 midUp = normalize(0.5 * (cameraPosition + vWorldPos));
  vec3 midPoint = 0.5 * (cameraPosition + vWorldPos);
  vec3 toEye = normalize(cameraPosition - vWorldPos);
  float airShadow = shadowFactor(midPoint, uLightDir, uStarAngularRadius, 1e30);
  vec3 seen = color * exp(-column)
    + uLightColor * airSegmentScatter(column, 0.5 * (eyeAlt + pointAlt), dot(midUp, uLightDir), -dot(toEye, uLightDir)) * airShadow;
  if (lit2) {
    float airShadow2 = shadowFactor(midPoint, uLight2Dir, uStar2AngularRadius, uLight2Reach);
    seen += uLight2Color * airSegmentScatter(column, 0.5 * (eyeAlt + pointAlt), dot(midUp, uLight2Dir), -dot(toEye, uLight2Dir)) * airShadow2;
  }
  gl_FragColor = vec4(seen, 1.0);
}
`;

/**
 * Sea-surface material for chunk-aligned water tiles: fresnel-brightened
 * at grazing angles with a sun glint, sharing the terrain's aerial fog.
 * All lighting is world-frame (tiles never rotate). No polygon offset:
 * a slope-scaled depth bias floods shorelines at grazing view angles —
 * the shared-grid geometry and the altitude-scaled near plane make the
 * true depth test reliable on their own.
 */
export function createOceanMaterial(oceanColor: [number, number, number], iceColor: [number, number, number], splitRatio = TERRAIN_SPLIT_RATIO): ShaderMaterial {
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...createShadowUniforms(),
      ...surfaceLightUniforms(),
      uSplitRatio: { value: splitRatio },
      uColor: { value: new Color(...oceanColor) },
      uIceColor: { value: new Color(...iceColor) },
      uLightDir: { value: [0, 0, 1] },
      uLightColor: { value: new Color(1, 1, 1) },
      ...secondSunUniforms(),
    },
  });
  Object.assign(material.defaultAttributeValues, { aWaterIce: [0, 0] });
  return material;
}

const MAGMA_FRAGMENT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewPos;
varying vec3 vWorldPos;

uniform vec3 uColor;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
${SECOND_SUN_GLSL}
uniform vec3 uSeedOffset;
uniform float uTimeDays;
uniform float uMagmaTemperatureK;
uniform float uDayNightDeltaK;
${THERMAL_EMISSION_GLSL}

${SIMPLEX_NOISE_GLSL}
${MAGMA_PATTERN_GLSL}
${SHADOW_GLSL}
${SURFACE_LIGHT_GLSL}

// One sun's glint off the melt's broken facets.
vec3 meltSheen(vec3 bumped, vec3 up, vec3 viewDir, vec3 lightDir, vec3 lightColor, float hot, float shadow) {
  float mu = dot(up, lightDir);
  float fresnel = pow(clamp(1.0 - dot(bumped, viewDir), 0.0, 1.0), 4.0);
  vec3 halfDir = normalize(lightDir + viewDir);
  float specular = pow(max(dot(bumped, halfDir), 0.0), 90.0) * (0.25 + 0.75 * hot);
  return lightColor * beamTransmittance(uOpticalDepth, mu)
    * (fresnel * 0.05 + specular * 0.18) * max(mu, 0.0) * shadow;
}

void main() {
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(-vViewPos) * mat3(viewMatrix);

  vec3 magma = magmaSurfaceState(
    vWorldPos,
    uSeedOffset,
    uTimeDays,
    length(fwidth(vWorldPos)),
    uMagmaTemperatureK,
    uDayNightDeltaK,
    dot(normal, uLightDir)
  );

  // Resolved convection perturbs the fluid normal. Above the liquidus the
  // perturbation stays shallow; near the solidus, raft edges roughen it.
  vec3 sx = dFdx(vWorldPos);
  vec3 sy = dFdy(vWorldPos);
  vec3 tx = normalize(sx - normal * dot(sx, normal) + vec3(1e-6));
  vec3 ty = normalize(sy - normal * dot(sy, normal) + vec3(1e-6));
  float roughness = mix(0.55, 0.16, magma.y);
  float gx = clamp(dFdx(magma.z) / max(length(sx), 1e-5) * roughness, -0.18, 0.18);
  float gy = clamp(dFdy(magma.z) / max(length(sy), 1e-5) * roughness, -0.18, 0.18);
  vec3 bumped = normalize(normal - gx * tx - gy * ty);

  float shadow = shadowFactor(vWorldPos, uLightDir, uStarAngularRadius, 1e30);
  vec3 light = surfaceLight(uOpticalDepth, uLightDir, uLightColor, normal, normal, shadow, diffuseShadow(shadow));
  vec3 sheen = meltSheen(bumped, normal, viewDir, uLightDir, uLightColor, magma.y, shadow);
  bool lit2 = secondSunLit();
  float shadow2 = 1.0;
  if (lit2) {
    shadow2 = shadowFactor(vWorldPos, uLight2Dir, uStar2AngularRadius, uLight2Reach);
    light += surfaceLight(uOpticalDepth, uLight2Dir, uLight2Color, normal, normal, shadow2, diffuseShadow(shadow2));
    sheen += meltSheen(bumped, normal, viewDir, uLight2Dir, uLight2Color, magma.y, shadow2);
  }
  // Kirchhoff's law couples absorption and emission. Open silicate melt is
  // nearly black in reflection and therefore strongly emissive; a chilled
  // skin reflects a little more. The local spectrum supplies visible contrast.
  float emissivity = mix(0.84, 0.94, magma.y);
  vec3 thermal = surfaceThermal(magma.x) * emissivity;
  vec3 reflected = uColor * light * (1.0 - emissivity) + sheen;
  vec3 color = thermal + reflected;

  // Aerial perspective: the air along the run to the eye keeps some of
  // the ground's light and adds the sunlight it scatters — blue by day,
  // red under a low sun, nothing in a vacuum.
  float eyeAlt = length(cameraPosition) - uPlanetRadius;
  float pointAlt = length(vWorldPos) - uPlanetRadius;
  float run = length(vViewPos);
  vec3 column = airSegmentColumn(eyeAlt, pointAlt, run);
  vec3 midUp = normalize(0.5 * (cameraPosition + vWorldPos));
  vec3 toEye = normalize(cameraPosition - vWorldPos);
  vec3 seen = color * exp(-column)
    + uLightColor * airSegmentScatter(column, 0.5 * (eyeAlt + pointAlt), dot(midUp, uLightDir), -dot(toEye, uLightDir)) * shadow;
  if (lit2) {
    seen += uLight2Color * airSegmentScatter(column, 0.5 * (eyeAlt + pointAlt), dot(midUp, uLight2Dir), -dot(toEye, uLight2Dir)) * shadow2;
  }
  gl_FragColor = vec4(seen, 1.0);
}
`;

/** Magma-sea surface for the same water tiles: a temperature-derived,
 * convecting fluid that emits its own light day and night. */
export function createMagmaMaterial(
  physical: Characterization,
  seedOffset: [number, number, number],
  splitRatio = TERRAIN_SPLIT_RATIO,
): ShaderMaterial {
  const magmaTemperatureK = physical.climate.magmaTemperatureK ?? exposedMagmaTemperatureK(
    physical.climate.surfaceMeanK,
    physical.climate.oceanCoverage,
  );
  return ownThermalTexture(new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: MAGMA_FRAGMENT,
    uniforms: {
      ...createShadowUniforms(),
      ...surfaceLightUniforms(),
      uSplitRatio: { value: splitRatio },
      uColor: { value: new Color(...physical.appearance.oceanColor) },
      uLightDir: { value: [0, 0, 1] },
      uLightColor: { value: new Color(1, 1, 1) },
      ...secondSunUniforms(),
      uSeedOffset: { value: seedOffset },
      uTimeDays: { value: 0 },
      uMagmaTemperatureK: { value: magmaTemperatureK },
      // The solved hotspot already includes the illumination contrast.
      uDayNightDeltaK: { value: physical.climate.magmaTemperatureK === undefined ? physical.climate.dayNightDeltaK : 0 },
      ...thermalUniforms(),
    },
  }));
}
